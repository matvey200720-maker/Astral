import { useRef, useEffect } from "react";
import * as Fonts from "../../../../features/workshop/emblem/emblem-fonts.js";
import * as Studio from "@modovik/gun-studio";
import * as Prints from "./sticker-prints.js";
import * as Baked from "./baked-textures.js";
import * as Patterns from "./gun-patterns.js";
import * as Canvas from "./gun-canvas.js";
import * as Images from "./gun-images.js";
import * as Detach from "./gun-detach.js";
import * as Gate from "./sync-gate.js";
import * as ItemMask from "./item-mask.js";
import { createEmptyHint } from "./item-empty-hint.js";

export { stickerBakeKey } from "./sticker-prints.js";

export const useGunSurfaces = ({ scene, project, onProjectChange, onBody = null, modelId = "", clothing = false, onHands = null, markItem = false, onItems = null }) => {
  const holder = useRef(null);
  // Один экземпляр на жизнь хука: между отрисовками он не меняется, зависимости эффектов стабильны.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bench = (holder.current ||= new Workbench());
  bench.attach({ scene, project, onBody, modelId, clothing, onHands, markItem, onItems });

  useEffect(() => bench.follow(project), [bench, project]);
  useEffect(() => () => bench.release(), [bench]);

  return bench.publish({ scene, onProjectChange });
};

/* ---------- мелкие помощники ---------- */

const byId = (id) => (item) => item.id === id;
const byName = (name) => (item) => item.name === name;
const nextTick = () => new Promise((resume) => setTimeout(resume, 0));
const blankCanvas = (width, height) => Object.assign(document.createElement("canvas"), { width, height });
const attempt = (job) => job.then((changed) => ({ ok: true, changed }), () => ({ ok: false, changed: false }));
const toPngBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, PNG));
const penOf = (canvas, ...options) => canvas.getContext("2d", ...options);

// Размеры, вписанные в side по длинной стороне (меньший лист тоже растёт)
const fitSide = (side, ...dims) => {
  const factor = side / Math.max(...dims, 1);
  return dims.map((dim) => Math.max(1, Math.round(dim * factor)));
};

// Часы непрерывной работы: пора ли отпустить поток
function makePacer(limitMs) {
  let mark = performance.now();
  return {
    tired: () => performance.now() - mark > limitMs,
    rested() {
      mark = performance.now();
    },
  };
}

// Сколько записей хранилища не вошло в живые id; лишние удаляются
function dropMissing(store, alive) {
  let dropped = 0;
  for (const id of [...store.keys()]) {
    if (alive.has(id)) continue;
    store.delete(id);
    dropped += 1;
  }
  return dropped;
}

async function blobToBase64(blob) {
  const bytes = await blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  const parts = Array.from({ length: Math.ceil(bytes.length / BASE64_CHUNK) }, (_, n) =>
    String.fromCharCode(...bytes.subarray(n * BASE64_CHUNK, (n + 1) * BASE64_CHUNK)),
  );
  return btoa(parts.join(""));
}

/* ---------- что просит проект ---------- */

const layerPairs = (project) =>
  (project?.materials ?? []).flatMap((material) => material.layers.map((layer) => [material, layer]));

const pickLayers = ({ layers }, only) => (only ? layers.filter(({ id }) => only.has(id)) : layers);

const activeWear = ({ wear }) => (wear && Number(wear.amount) > 0 ? wear : null);

// id → источник; наклейка с тем же id перебивает слой, а место в порядке остаётся первым
function imageRequests(project) {
  const fromLayers = layerPairs(project)
    .filter(([, layer]) => layer.kind === "image" && layer.source)
    .map(([, layer]) => [layer.id, layer.source]);
  const fromStickers = (project?.stickers ?? [])
    .filter((sticker) => sticker.source)
    .map((sticker) => [sticker.id, sticker.source]);
  return new Map([...fromLayers, ...fromStickers]);
}

function fontRequests(project) {
  const fromLayers = layerPairs(project)
    .filter(([, layer]) => layer.kind === "text" && layer.font === "custom")
    .map(([, layer]) => layer.fontAsset);
  const fromStickers = (project?.stickers ?? [])
    .filter((sticker) => sticker.text && sticker.font === "custom")
    .map((sticker) => sticker.fontAsset);
  return new Set([...fromLayers, ...fromStickers].filter(Boolean));
}

// Растры слоя: у кисти ещё и своё data, маска может быть у любого слоя
function rasterSlots({ id, kind, data, mask }) {
  const own = kind === "paint" ? [[id, data || null]] : [];
  return [...own, [Canvas.maskKey(id), mask || null]];
}

function* savedLinks(layers) {
  for (const layer of layers) {
    for (const slot of rasterSlots(layer)) {
      if (slot[1]) yield slot;
    }
  }
}

function* rasterKeys(layers) {
  for (const { id } of layers) {
    yield id;
    yield Canvas.maskKey(id);
  }
}

const parseRasterKey = (key) =>
  key.startsWith(MASK_PREFIX)
    ? { id: key.slice(MASK_PREFIX.length), field: "mask" }
    : { id: key, field: "data" };

const rasterRef = (surface, key) => (surface.rasterIsEmpty(key) ? null : surface.exportRaster(key));

function* snapshotsOf(surface, keys) {
  for (const key of keys) {
    if (surface.rasterCanvas(key)) yield [key, rasterRef(surface, key)];
  }
}

/* ---------- обновители проекта и отделённые куски ---------- */

// Обновитель проекта для снятого растра: без нужного слоя отдаёт сам проект
function rasterPatch(materialName, key, value) {
  const { id, field } = parseRasterKey(key);
  const seek = (tree) => tree.materials.find(byName(materialName))?.layers.find(byId(id));
  return (current) => {
    if (!seek(current)) return current;
    const copy = structuredClone(current);
    Object.assign(seek(copy), { [field]: value });
    return copy;
  };
}

function writeSnapshots(target, snapshots) {
  snapshots.forEach((value, key) => {
    const { id, field } = parseRasterKey(key);
    const layer = target.layers.find(byId(id));
    if (layer) layer[field] = value;
  });
}

function detachPatch(materialName, record, snapshots) {
  return (current) => {
    const known = Studio.normalizeDetached(current.detached);
    const detached = { ...known, [materialName]: [...(known[materialName] ?? []), record] };
    const copy = { ...structuredClone(current), detached };
    const target = copy.materials.find(byName(materialName));
    if (target) writeSnapshots(target, snapshots);
    return copy;
  };
}

function roomLeft(project) {
  if (Studio.projectTouchesDetached(project)) return true;
  const { length } = Studio.normalizeDecorations(project?.decorations);
  return length < Studio.MAX_DECORATIONS;
}

// Попадание, пересчитанное на новое место куска
function retargetHit(hit, record) {
  const [u, v] = Detach.mapUv(record, hit.u, hit.v);
  const island = `${hit.island.slice(0, hit.island.lastIndexOf(":"))}:${record.island}`;
  return { ...hit, u, v, repeats: false, island };
}

function shiftSurface(stage, name, surface, records) {
  const { placed = [], returned = [] } = stage.syncDetached(name, records) ?? {};
  returned.forEach(({ rects }) => surface.returnRegion(rects.to));
  placed.forEach(({ rects }) => surface.moveRegion(rects.from, rects.to, { rasters: false }));
  return returned.length + placed.length > 0;
}

/* ---------- печать для игры: вырезки и общий лист ---------- */

class Cut {
  constructor(surface, piece, texture) {
    const { to } = piece.record;
    this.texture = texture;
    this.geometry = { positions: piece.positions, normals: piece.normals };
    this.uvs = piece.uvs;
    this.rect = to;
    this.sheet = [surface.width, surface.height];
    this.canvas = blankCanvas(Math.max(1, to.w), Math.max(1, to.h));
    const from = [to.x, to.y, to.w, to.h];
    penOf(this.canvas)?.drawImage(surface.canvas, ...from, 0, 0, this.canvas.width, this.canvas.height);
  }

  get size() {
    return { w: this.canvas.width, h: this.canvas.height };
  }

  paste(pen, at, scale) {
    pen.drawImage(this.canvas, at.x, at.y, this.canvas.width * scale, this.canvas.height * scale);
  }

  // Развёртка из долей листа детали в доли общего листа
  describe(pack, at) {
    const axes = [
      [this.sheet[0], this.rect.x, at.x, pack.width],
      [this.sheet[1], this.rect.y, at.y, pack.height],
    ];
    const uvs = Array.from(this.uvs, (value, i) => {
      const [size, origin, shift, extent] = axes[i % 2];
      return ((value * size - origin) * pack.scale + shift) / extent;
    });
    return { texture: this.texture, ...this.geometry, uvs };
  }
}

function buildAtlas(cuts) {
  const pack = Detach.packCrops(cuts.map((cut) => cut.size));
  if (!pack) return [];
  const atlas = blankCanvas(pack.width, pack.height);
  const pen = penOf(atlas);
  const pieces = cuts.map((cut, index) => {
    const at = pack.places[index];
    cut.paste(pen, at, pack.scale);
    return cut.describe(pack, at);
  });
  const url = atlas.toDataURL(PNG);
  return [{ png: url.slice(url.indexOf(",") + 1), pieces }];
}

// Лист для экспорта: подложки под переехавшими кусками возвращены на место
function flatSheet(surface) {
  const regions = surface.savedRegions?.() ?? [];
  if (!regions.length) return surface.canvas;
  const { canvas } = surface;
  const copy = blankCanvas(canvas.width, canvas.height);
  const pen = penOf(copy);
  pen.drawImage(canvas, 0, 0);
  for (const region of regions) pen.putImageData(region.data, region.x, region.y);
  return copy;
}

// Картинка листа для data: сжатая до side, пиксели прочитаны сразу
function inkOf(surface, side) {
  const [width, height] = fitSide(side, surface.width, surface.height);
  const pen = penOf(blankCanvas(width, height), { willReadFrequently: true });
  if (!pen) return null;
  const box = [0, 0, width, height];
  pen.drawImage(surface.canvas, ...box);
  const { data } = pen.getImageData(...box);
  return { width, height, data };
}

/* ---------- всё, что хук помнит между отрисовками ---------- */

class Workbench {
  scene = null;
  project = null;
  onBody = null;
  modelId = "";
  clothing = false;
  onHands = null;
  onItems = null;
  markItem = false;

  itemSheets = new Map();
  itemState = new Map();
  itemMarksKey = undefined;
  /* Подсказка «это место отмечено как кожа и закрыто» (`ItemOnlyBar`): после первого «пустого» мазка, гаснет после правки отметки, одна на вещь (`item-empty-hint.js`). */
  emptyHint = createEmptyHint();
  surfaces = new Map();
  images = new Map();
  rasterRefs = new Map();
  prints = new Map();
  showcase = new Map();
  saves = new Map();
  fontsReady = new Set();
  gate = Gate.createSyncGate();
  slots = new Map();
  pieces = [];
  patterns = null;
  frame = null;
  loadNo = 0;
  dragging = null;

  attach({ scene, project, onBody, modelId, clothing, onHands, markItem, onItems }) {
    const marking = markItem === true;
    const changed = marking !== this.markItem;
    /* Другая вещь — подсказка снова положена: по одной на вещь. */
    if (modelId !== this.modelId) this.emptyHint.reset();
    Object.assign(this,{ scene, project, onBody, modelId, clothing: clothing === true, onHands, onItems, markItem: marking });
    if (changed && this.surfaces.size > 0) this.scheduleRender();
  }

  /* --- результат хука: ссылка живёт, пока не поменялись её зависимости --- */

  publish(handles) {
    return Object.fromEntries(
      API_SHAPE.map(([name, ...inputs]) => [name, this.slotFor(name, inputs, handles)]),
    );
  }

  slotFor(name, inputs, handles) {
    const deps = inputs.map((input) => handles[input]);
    const slot = this.slots.get(name);
    if (slot && deps.every((dep, at) => Object.is(dep, slot.deps[at]))) return slot.fn;
    const fn = this.linkApi(name, inputs, handles);
    this.slots.set(name, { deps, fn });
    return fn;
  }

  linkApi(name, inputs, handles) {
    const method = this[name].bind(this);
    if (!inputs.includes("onProjectChange")) return method;
    return (...args) => method(handles.onProjectChange, ...args);
  }

  /* --- жизнь эффектов --- */

  follow(project) {
    const run = { stale: false };
    this.scheduleRender();
    const moved = this.syncPieces(project);
    this.applyItemMasks(project);
    this.gate.track(this.catchUp(project, run, moved));
    return () => void (run.stale = true);
  }

  release() {
    const { frame, patterns } = this;
    this.frame = null;
    this.patterns = null;
    if (frame !== null) cancelAnimationFrame(frame);
    patterns?.dispose();
  }

  async catchUp(project, run, moved) {
    const pulls = [this.pullImages, this.pullRasters, this.pullFonts];
    const verdicts = await Promise.all(pulls.map((pull) => attempt(pull.call(this, project))));
    if (run.stale || verdicts.some((verdict) => !verdict.ok)) return;
    const baked = this.bakeAll(project);
    const touched = moved || baked || verdicts.some((verdict) => verdict.changed);
    if (touched) this.renderAll();
  }

  settled() {
    return this.gate.settled();
  }

  syncing() {
    return this.gate.busy();
  }

  /* --- догрузки: каждая отдаёт «что-то изменилось» --- */

  pictureReady(id, source) {
    return this.cachedFor({ id, source }) !== null;
  }

  async pullImages(project) {
    const wanted = imageRequests(project);
    let changed = dropMissing(this.images, wanted) > 0;
    for (const [id, source] of wanted) {
      if (this.pictureReady(id, source)) continue;
      let entry;
      try {
        entry = Object.assign(await Images.resolveGunImage(source), { astralSource: source });
        changed = true;
      } catch {
        entry = { astralSource: source, broken: true };
      }
      this.images.set(id, entry);
    }
    return changed;
  }

  *rasterJobs(project) {
    for (const [material, layer] of layerPairs(project)) {
      const owner = material.name;
      const surface = this.surfaces.get(owner);
      if (surface) yield* rasterSlots(layer).map(([key, ref]) => ({ surface, owner, key, ref }));
    }
  }

  async pullRasters(project) {
    let touched = 0;
    for (const { surface, owner, key, ref } of this.rasterJobs(project)) {
      if ((this.rasterRefs.get(key) ?? null) === ref) continue;
      this.rasterRefs.set(key, ref);
      if (ref === null) {
        surface.clearLayer(key);
        touched += 1;
        continue;
      }
      const picture = await Images.resolveGunImage(ref);
      const current = this.rasterRefs.get(key) === ref && this.surfaces.get(owner) === surface;
      if (current) {
        surface.restoreRasterImage(key, picture);
        touched += 1;
      }
    }
    return touched > 0;
  }

  async pullFonts(project) {
    let loaded = 0;
    for (const asset of fontRequests(project)) {
      if (this.fontsReady.has(asset) || !(await Fonts.ensureEmblemFont(asset))) continue;
      this.fontsReady.add(asset);
      loaded += 1;
    }
    return loaded > 0;
  }

  /* --- куски развёртки --- */

  syncPieces(project) {
    const scene = this.scene;
    const stage = scene.current;
    if (typeof stage?.syncDetached !== "function") return false;
    const known = Studio.normalizeDetached(project?.detached);
    const outcomes = [...this.surfaces].map(([name, surface]) =>
      shiftSurface(stage, name, surface, known[name] ?? []),
    );
    const moved = outcomes.some(Boolean);
    if (moved) {
      this.prints.clear();
      this.scanItemSheets();
    }
    return moved;
  }

  /* --- «красить только вещь» (`item-mask.js`) --- */

  /* Руки и перчатки (`onHands`), у которых кожа лежит на том же листе, что и вещь (ногти: кожа рук и торса с тёмными пятнами ногтей). Для ствола и остальной одежды не считается вовсе. */
  itemOnFor() {
    return this.clothing && this.onHands?.() === true;
  }

  /* Тяжёлая часть, раз на загрузку и сдвиг кусков: острова листа, их цвета (чтение листа) и догадка. Лёгкая часть — `applyItemMasks`: отметка человека и маска. */
  scanItemSheets() {
    this.itemSheets.clear();
    const stage = this.scene?.current;
    if (this.itemOnFor() && typeof stage?.itemParts === "function") {
      for (const [name, surface] of this.surfaces) {
        const parts = stage.itemParts(name);
        if (!parts || parts.length < 2) continue;
        const withTones = ItemMask.withTones(parts, surface.readTones(parts.map((part) => part.triangles)));
        this.itemSheets.set(name, { parts: withTones, guess: ItemMask.guessItemIslands(withTones) });
      }
    }
    this.itemMarksKey = undefined;
    this.applyItemMasks(this.project);
  }

  /* Маска листа из догадки и отметки человека (`project.itemOnly`): отметка главнее; уверенная догадка ставит маску сама; неуверенная — лист закрыт (красить нечего, пока человек не отметит вещь);
     кожи на листе нет — маски нет. Перерисовывается только при смене отметки или после `scanItemSheets`. */
  applyItemMasks(project) {
    const marked = Studio.normalizeItemOnly(project?.itemOnly);
    const key = JSON.stringify(marked);
    if (key === this.itemMarksKey) return false;
    /* Отметку поправили (а не первая раскладка после загрузки листа) — подсказка своё сказала и больше не появится. */
    if (this.itemMarksKey !== undefined) this.emptyHint.corrected();
    this.itemMarksKey = key;
    this.itemState = new Map();
    for (const [name, surface] of this.surfaces) {
      const sheet = this.itemSheets.get(name);
      /* Листу без кожи и без прежней маски трогать нечего (так же — у ствола и остальной одежды). */
      if (!sheet && !surface.itemMask) continue;
      const decision = sheet ? ItemMask.decideItemMask(sheet.parts, sheet.guess, marked[name]) : { state: "none", item: [], suggest: [] };
      const chosen = new Set(decision.item);
      const closed = decision.state === "closed";
      const suggested = new Set(decision.suggest);
      surface.setItemMask(decision.state === "none" ? null : ItemMask.joinTriangles(sheet.parts.filter((part) => chosen.has(part.key))), {
        closed,
        /* закрытый лист показывает догадку розовым как предложение: вещь — вне розового */
        hint: closed ? ItemMask.joinTriangles(sheet.parts.filter((part) => suggested.has(part.key))) : null,
      });
      if (decision.state !== "none") this.itemState.set(name, { ...decision, parts: sheet.parts });
    }
    this.scheduleRender();
    this.onItems?.();
    return true;
  }

  /* Что решено для листа `name`: `{ state: "marked" | "auto" | "closed", item, suggest, parts }` или null — кожи на листе нет (маски нет). */
  itemMaskOf(name) {
    return this.itemState.get(name) ?? null;
  }

  /* Листы, на которых вещь отмечается (есть кожа): названия по порядку. */
  itemSheetNames() {
    return [...this.itemState.keys()];
  }

  /* Часть вещи под щелчком (`hit` — попадание луча кисти): ключ «сетка:остров» или null. */
  itemPartAt(hit) {
    return this.scene?.current?.itemPartKey?.(hit) ?? null;
  }

  /* Мазок или заливка пришлись на закрытое (кожу) и ничего не закрасили: первый такой на вещь включает подсказку полосы (`itemEmptyHint`); дальше — молча. */
  noteEmptyStroke() {
    if (!this.emptyHint.note()) return false;
    this.onItems?.();
    return true;
  }

  /* Показывать ли подсказку: был «пустой» мазок и отметку ещё не поправляли. */
  itemEmptyHint() {
    return this.emptyHint.shown;
  }

  /* Режим отметки начинается с того, что видно сейчас: догадка (уверенная или нет) записывается как отметка, и человек правит её, а не рисует с нуля. */
  beginItemMarks(onProjectChange) {
    const fresh = [...this.itemState].filter(([, state]) => state.state !== "marked" && state.suggest.length > 0);
    if (fresh.length === 0) return false;
    onProjectChange((current) => {
      const marks = { ...Studio.normalizeItemOnly(current.itemOnly) };
      for (const [name, state] of fresh) marks[name] = [...state.suggest];
      return { ...current, itemOnly: marks };
    }, "item-only");
    return true;
  }

  /* Щелчок в режиме отметки: часть вещи переключается; шаг — сетка, если их несколько, иначе остров. */
  toggleItemPart(onProjectChange, name, key) {
    const state = this.itemState.get(name);
    if (!state || !key) return false;
    return this.markItemKeys(onProjectChange, name, ItemMask.toggleItemPart(state.parts, state.item, key));
  }

  /* «Похожие части»: к отмеченному добавляются части того же цвета, у всех листов с кожей. */
  similarItemParts(onProjectChange) {
    const edits = [...this.itemState].map(([name, state]) => [name, ItemMask.addSimilarParts(state.parts, state.item)]);
    return this.markManyItemKeys(onProjectChange, edits);
  }

  /* «Сбросить отметку»: отметка снимается, решает догадка. */
  clearItemMarks(onProjectChange) {
    return this.markManyItemKeys(onProjectChange, [...this.itemState.keys()].map((name) => [name, []]));
  }

  markItemKeys(onProjectChange, name, keys) {
    return this.markManyItemKeys(onProjectChange, [[name, keys]]);
  }

  markManyItemKeys(onProjectChange, edits) {
    if (edits.length === 0) return false;
    onProjectChange((current) => {
      const marks = { ...Studio.normalizeItemOnly(current.itemOnly) };
      for (const [name, keys] of edits) {
        const list = [...new Set(keys)];
        if (list.length > 0) marks[name] = list;
        else delete marks[name];
      }
      return { ...current, itemOnly: marks };
    }, "item-only");
    return true;
  }

  /* --- загрузка модели --- */

  async adoptModel(materials, ...rest) {
    const [materialLayers = new Map(), isCancelled = () => false] = rest;
    const turn = ++this.loadNo;
    const fresh = new Map();
    const remembered = new Map();
    const described = [];
    const pacer = makePacer(BREATH_AFTER_MS);

    for (const material of materials) {
      const surface = Canvas.createSurface(material);
      const { name, width, height } = material;
      fresh.set(name, surface);
      described.push({ name, width, height });

      if (pacer.tired()) {
        await nextTick();
        if (isCancelled() || turn !== this.loadNo) return null;
        pacer.rested();
      }

      for (const [key, ref] of savedLinks(materialLayers.get(name) ?? [])) {
        remembered.set(key, ref);
        try {
          surface.restoreRasterImage(key, await Images.resolveGunImage(ref));
        } catch {
          // одна нечитаемая ссылка не мешает остальным
        }
      }
    }
    if (turn !== this.loadNo) return null;

    Object.assign(this, { surfaces: fresh, rasterRefs: remembered });
    this.prints.clear();
    this.bindAll(fresh);
    this.syncPieces(this.project);
    this.scanItemSheets();
    return described;
  }

  bindAll(surfaces) {
    const scene = this.scene;
    const glowOf = (surface) => () => surface.glow;
    surfaces.forEach((surface, name) => {
      scene.current?.bindSurface(name, surface.canvas, glowOf(surface));
    });
  }

  surfaceOf(name) {
    return this.surfaces.get(name) ?? null;
  }

  /* --- сборка холстов --- */

  materialOf(name) {
    for (const entry of this.project?.materials ?? []) {
      if (entry.name === name) return entry;
    }
    return undefined;
  }

  layersOf(name) {
    return this.materialOf(name)?.layers ?? [];
  }

  stickerLayers(name) {
    const shown = (sticker) => sticker.visible !== false && sticker.id !== this.dragging;
    return (this.project?.stickers ?? []).filter(shown).flatMap((sticker) => {
      const { blend, opacity } = sticker;
      const record = this.prints.get(sticker.id);
      const canvas = record && record.byMaterial.get(name);
      return canvas ? [{ canvas, blend, opacity }] : [];
    });
  }

  sourcesFor(name) {
    const { project } = this;
    return {
      name,
      images: this.images,
      patterns: this.patternCache(),
      stickers: this.stickerLayers(name),
      wear: project?.wear,
      skinOff: !!project?.skinOff,
      markItem: this.markItem,
    };
  }

  renderMaterial(name) {
    const surface = this.surfaces.get(name);
    if (surface === undefined) return;
    const scene = this.scene;
    surface.render(this.layersOf(name), this.sourcesFor(name));
    scene.current?.refreshSurface(name);
  }

  renderAll() {
    this.surfaces.forEach((_, name) => this.renderMaterial(name));
  }

  scheduleRender() {
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.runFrame());
  }

  runFrame() {
    this.frame = null;
    this.renderAll();
  }

  patternCache() {
    return (this.patterns ||= Patterns.createPatternCache({ onReady: () => this.scheduleRender() }));
  }

  setDragging(stickerId) {
    this.dragging = stickerId || null;
    this.renderAll();
  }

  stickerMaterials() {
    return Array.from(this.surfaces.keys()).filter((name) => this.stickerLayers(name).length > 0);
  }

  /* --- наклейки --- */

  imageOf(id) {
    const entry = this.images.get(id);
    if (!entry || entry.broken) return null;
    return entry;
  }

  stickerImage(sticker) {
    const picture = sticker.text ? Images.textArtwork(sticker) : this.imageOf(sticker.id);
    return Images.stickerArtwork(picture, sticker);
  }

  cachedFor({ id, source }) {
    const entry = this.images.get(id);
    if (!entry || entry.broken) return null;
    return entry.astralSource === source ? entry : null;
  }

  async artworkFor(sticker) {
    if (sticker?.text) return Images.stickerArtwork(Images.textArtwork(sticker), sticker);
    if (!sticker?.source) return null;
    const picture = this.cachedFor(sticker) ?? (await Images.resolveGunImage(sticker.source));
    return Images.stickerArtwork(picture, sticker);
  }

  keep(id, record) {
    this.prints.set(id, record);
    this.showcase.set(id, record);
  }

  // Берёт из витрины то, что подходит к вещи; иначе забывает прежний оттиск
  borrowShowcase(sticker, key, have) {
    const seen = this.showcase.get(sticker.id);
    const fits = seen?.key === key && seen.modelId === this.modelId;
    if (fits) this.prints.set(sticker.id, seen);
    else if (have) this.prints.delete(sticker.id);
    return fits || Boolean(have);
  }

  bakeOne(stage, sticker) {
    const key = Prints.stickerBakeKey(sticker);
    const have = this.prints.get(sticker.id);
    if (have?.key === key) return false;
    if (this.onBody?.()) return this.borrowShowcase(sticker, key, have);
    const artwork = this.stickerImage(sticker);
    if (!artwork) return false;
    const byMaterial = stage.bakeSticker(sticker, artwork);
    this.keep(sticker.id, { key, byMaterial, modelId: this.modelId });
    Prints.rememberStickerPrint(this.modelId, sticker, key, byMaterial);
    return true;
  }

  bakeAll(project) {
    const scene = this.scene;
    const stage = scene.current;
    if (!stage || this.surfaces.size === 0) return false;
    const stickers = project?.stickers ?? [];
    const alive = new Set(stickers.map(({ id }) => id));
    let changed = dropMissing(this.prints, alive) > 0;
    dropMissing(this.showcase, alive);
    for (const sticker of stickers) changed = this.bakeOne(stage, sticker) || changed;
    return changed;
  }

  async bakeNow(sticker) {
    const artwork = await this.artworkFor(sticker);
    const scene = this.scene;
    const stage = scene.current;
    if (!artwork || !stage || this.onBody?.()) return;
    const byMaterial = stage.bakeSticker(sticker, artwork);
    this.keep(sticker.id, { key: Prints.stickerBakeKey(sticker), byMaterial, modelId: this.modelId });
  }

  /* --- растры слоёв и куски под кистью --- */

  commitRaster(onProjectChange, materialName, layerId, label) {
    const surface = this.surfaces.get(materialName);
    if (surface === undefined) return;
    const token = {};
    this.saves.set(layerId, token);
    const superseded = () => this.saves.get(layerId) !== token;

    const land = (value) => {
      if (superseded()) return;
      this.rasterRefs.set(layerId, value);
      onProjectChange(rasterPatch(materialName, layerId, value), label);
    };

    const canvas = surface.rasterCanvas(layerId);
    if (canvas && !surface.rasterIsEmpty(layerId)) {
      Images.storeGunRaster(canvas)
        .catch(() => surface.exportRaster(layerId))
        .then(land);
      return;
    }
    land(null);
  }

  snapshotRasters(surface, materialName) {
    const taken = new Map(snapshotsOf(surface, rasterKeys(this.layersOf(materialName))));
    taken.forEach((snapshot, key) => this.rasterRefs.set(key, snapshot));
    return taken;
  }

  askScene(hit, options) {
    const scene = this.scene;
    const stage = scene.current;
    const asked = Object.assign({}, options, { room: roomLeft(this.project) });
    return typeof stage?.detachIsland === "function" ? stage.detachIsland(hit, asked) : null;
  }

  applyDetach(onProjectChange, surface, { material, record, rects }) {
    surface.moveRegion(rects.from, rects.to);
    const snapshots = this.snapshotRasters(surface, material);
    const label = `detach:${material}:${record.mesh}:${record.island}`;
    onProjectChange(detachPatch(material, record, snapshots), label);
    this.prints.clear();
    this.renderMaterial(material);
  }

  detachUnder(onProjectChange, hit, options) {
    const result = this.askScene(hit, options);
    if (!result) return hit;
    if (result.crowded) return { ...hit, crowded: true };
    const surface = this.surfaces.get(result.material);
    if (!surface) return hit;
    this.applyDetach(onProjectChange, surface, result);
    return retargetHit(hit, result.record);
  }

  forgetLayer(materialName, layerId) {
    const surface = this.surfaces.get(materialName);
    [layerId, Canvas.maskKey(layerId)].forEach((key) => surface?.forget(key));
    this.images.delete(layerId);
    const cache = this.patterns;
    if (cache) [layerId, `wear:${materialName}`].forEach((id) => cache.forget(id));
  }

  /* --- печать для игры --- */

  // Что печатать у детали, или null, если печатать нечего
  planSheet(material, project, options) {
    const outside = options.only ? !options.only.has(material.name) : false;
    const surface = this.surfaces.get(material.name);
    if (outside || !surface) return null;
    const layers = pickLayers(material, options.layers);
    const stickers = options.stickers === false ? [] : this.stickerLayers(material.name);
    const wear = activeWear(project);
    const reasons = [project.skinOff, layers.length, stickers.length, wear && surface.opaque];
    return reasons.some(Boolean) ? { material, surface, layers, stickers, wear } : null;
  }

  async exactPatterns({ width, height }, layers, wear) {
    const byLayer = new Map();
    const visible = layers.filter((layer) => layer.kind === "pattern" && layer.visible !== false);
    for (const layer of visible) {
      const exact = await this.patternCache().exact("pattern", patternParams(layer), width, height);
      byLayer.set(layer.id, exact);
    }
    const params = wear && { amount: wear.amount, seed: wear.seed };
    const worn = wear ? await this.patternCache().exact("wear", params, width, height) : null;
    return { pattern: (layer) => byLayer.get(layer.id) ?? null, wear: () => worn };
  }

  async printSheet(job, project, options, textureNameOf, cuts) {
    const { material, surface, layers, stickers, wear } = job;
    const patterns = await this.exactPatterns(surface, layers, wear);
    surface.render(layers, {
      name: material.name,
      images: this.images,
      patterns,
      stickers,
      wear,
      skinOff: !!project.skinOff,
      bare: !!options.bare,
    });
    const pieces = this.scene.current?.detachedPieces?.(material.name) ?? [];
    for (const piece of pieces) cuts.push(new Cut(surface, piece, textureNameOf(material.name)));

    const blob = await toPngBlob(flatSheet(surface));
    if (!blob) return null;
    const entry = {
      texture: textureNameOf(material.name),
      png: await blobToBase64(blob),
      opaque: surface.opaque,
    };
    return { entry, painted: layers.length > 0 || stickers.length > 0 };
  }

  async bakeTextures(textureNameOf, options = {}) {
    this.pieces = [];
    if (await this.pullFonts(this.project)) this.renderAll();

    const { project } = this;
    const textures = Baked.createBakedTextures();
    const cuts = [];
    for (const material of project?.materials ?? []) {
      const job = this.planSheet(material, project, options);
      const printed = job && (await this.printSheet(job, project, options, textureNameOf, cuts));
      if (printed) textures.add(printed.entry, printed.painted);
    }

    this.pieces = buildAtlas(cuts);
    this.renderAll();
    return textures.list;
  }

  takePaintPieces() {
    const taken = this.pieces;
    this.pieces = [];
    return taken;
  }

  inkOne(name, side, only) {
    const surface = this.surfaces.get(name);
    const material = this.materialOf(name);
    if (!surface || !material) return undefined;
    const own = pickLayers(material, only);
    const stickers = this.stickerLayers(name);
    if (!own.length && !stickers.length) return undefined;

    const patterns = this.patternCache();
    surface.render(own, { name, images: this.images, patterns, stickers, bare: true });
    const ink = inkOf(surface, side);
    this.renderMaterial(name);
    return ink && { name, ...ink };
  }

  inkImages(names, { side = INK_SIDE, layers = null } = {}) {
    if (typeof document === "undefined") return [];
    return [...names].map((name) => this.inkOne(name, side, layers)).filter(Boolean);
  }
}

/* ---------- таблицы и константы ---------- */

// Порядок = порядок ключей результата; после имени — от чего зависит ссылка на функцию
const API_SHAPE = [
  ["surfaceOf"],
  ["adoptModel", "scene"],
  ["renderMaterial", "scene"],
  ["renderAll", "scene"],
  ["scheduleRender", "scene"],
  ["commitRaster", "onProjectChange"],
  ["detachUnder", "scene", "onProjectChange"],
  ["itemMaskOf"],
  ["itemSheetNames"],
  ["itemPartAt"],
  ["noteEmptyStroke"],
  ["itemEmptyHint"],
  ["beginItemMarks", "onProjectChange"],
  ["toggleItemPart", "onProjectChange"],
  ["similarItemParts", "onProjectChange"],
  ["clearItemMarks", "onProjectChange"],
  ["takePaintPieces"],
  ["forgetLayer"],
  ["imageOf"],
  ["stickerImage"],
  ["artworkFor"],
  ["bakeNow", "scene"],
  ["bakeTextures", "scene"],
  ["inkImages", "scene"],
  ["stickerMaterials"],
  ["settled"],
  ["syncing"],
  ["setDragging", "scene"],
  ["patternCache"],
];

const PATTERN_FIELDS = ["pattern", "colours", "scale", "rotation", "seed"];

const patternParams = (layer) => ({
  ...Object.fromEntries(PATTERN_FIELDS.map((field) => [field, layer[field]])),
  contrast: layer.contrast ?? 100,
});

const MASK_PREFIX = "mask:";
const BREATH_AFTER_MS = 12;
const INK_SIDE = 256;
const BASE64_CHUNK = 0x8000;
const PNG = "image/png";
