import * as THREE from "three";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import {
  itemElementFront,
  itemElementIsland,
  itemElementKey,
  itemElementNames,
  itemElementPlacement,
  itemElementPlane,
  itemElementProjectedIsland,
  itemElementProjectedUvs,
  itemElementProjection,
  itemElementWord,
  itemElementWrap,
  itemMeshesFrame,
} from "@modovik/climb-contract/recolor/item-elements";
import { tr } from "../../../locales/ui.js";
import { applyRecolourLook, createRecolourMaterial } from "../model-stage/recolor-material.js";
import { useEffect, useRef, useState } from "react";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { meanLuma } from "@modovik/climb-contract/recolor/colour";

const GRID = 64;
const SHEET = { base: 512, floor: 64, ceil: 2048, tone: 64, scene: 512, backdrop: "#000000" };
const SCREEN_WORD = "Экран";
const LAYER_OFFSET = Object.assign({ polygonOffset: true }, { polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
const PICTURE_LOOK = { transparent: true, depthWrite: false, alphaTest: 0.02, roughness: 0.7, metalness: 0 };
const NO_LAYERS = [];

/* ------------------------------------------------------------------ */
/* Память по сцене: доли, обёртки и рамки вещей; картинки — на окно     */
/* ------------------------------------------------------------------ */

const sceneMemo = new WeakMap();

function memoOf(scene) {
  let memo = sceneMemo.get(scene);
  if (memo === undefined) {
    memo = { shares: new Map(), wraps: new Map(), frames: new Map() };
    sceneMemo.set(scene, memo);
  }
  return memo;
}

function cached(shelf, id, make) {
  let value = shelf.get(id);
  if (value === undefined) {
    value = make();
    shelf.set(id, value);
  }
  return value;
}

const pictureShelf = new Map();

function thingFrame(scene, entity) {
  return cached(memoOf(scene).frames, entity, () =>
    itemMeshesFrame(scene.meshes.filter((mesh) => mesh.entity === entity)),
  );
}

/* ------------------------------------------------------------------ */
/* Листы вещи                                                          */
/* ------------------------------------------------------------------ */

function materialKey(scene, { texture, name }) {
  if (typeof texture === "string") return itemElementKey(texture);
  return Number.isInteger(texture) ? itemElementKey(name || scene.textures?.[texture]?.texture) : null;
}

export function sceneMaterialElement(scene, index) {
  const material = scene?.materials?.[index];
  return material ? materialKey(scene, material) : null;
}

/* Запись листа сцены, из которой читается картинка игры. */
function recordOf(scene, material) {
  const factory = typeof material.texture === "string";
  const slot = factory ? material.vanilla : material.texture;
  if (!Number.isInteger(slot)) return undefined;
  return scene.textures?.[slot];
}

class Sheet {
  constructor(key, scene, material, mesh) {
    this.key = key;
    this.meshes = [mesh];
    this.colour = material.colour || "";
    this.alpha = material.alpha || "opaque";
    this.doubleSided = Boolean(material.doubleSided);
    this.record = recordOf(scene, material);
  }
}

/* Листы одной вещи в порядке сцены: ключ листа → Sheet. */
function gatherSheets(scene, entity) {
  const sheets = new Map();
  const own = (scene?.meshes ?? []).filter((mesh) => mesh.entity === entity && mesh.uvs);
  const keyed = own.map((mesh) => ({
    mesh,
    material: scene.materials[mesh.material],
    key: sceneMaterialElement(scene, mesh.material),
  }));
  for (const { mesh, material, key } of keyed) {
    if (!key) continue;
    const sheet = sheets.get(key);
    if (sheet) sheet.meshes.push(mesh);
    else sheets.set(key, new Sheet(key, scene, material, mesh));
  }
  return sheets;
}

/* ------------------------------------------------------------------ */
/* Геометрия: проход по треугольникам, рамка, площадь                   */
/* ------------------------------------------------------------------ */

function forTriangles(indices, visit) {
  const triangles = Math.floor(indices.length / 3);
  for (let t = 0; t < triangles; t++) visit(indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]);
}

function extent(meshes) {
  const low = Array(3).fill(Infinity);
  const high = Array(3).fill(-Infinity);
  for (const { positions } of meshes) {
    const whole = positions.length - (positions.length % 3);
    for (let at = 0; at < whole; at++) {
      const axis = at % 3;
      if (positions[at] < low[axis]) low[axis] = positions[at];
      if (positions[at] > high[axis]) high[axis] = positions[at];
    }
  }
  return { low, high };
}

const edge = (p, from, to) => [0, 1, 2].map((axis) => p[to * 3 + axis] - p[from * 3 + axis]);

function halfCross(p, a, b, c) {
  const [x, y, z] = cross3(edge(p, a, b), edge(p, a, c));
  return Math.sqrt(x * x + y * y + z * z) / 2;
}

function areaOf(meshes) {
  let total = 0;
  for (const { positions, indices } of meshes) {
    forTriangles(indices, (a, b, c) => {
      total += halfCross(positions, a, b, c);
    });
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Видимая доля: буфер глубины 64 × 64 с семнадцати сторон              */
/* ------------------------------------------------------------------ */

function cross3([ax, ay, az], [bx, by, bz]) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function normalised(vector) {
  const length = Math.hypot(...vector);
  return vector.map((part) => part / length);
}

const dotAt = (flat, at, axis) => flat[at] * axis[0] + flat[at + 1] * axis[1] + flat[at + 2] * axis[2];

/* Направления к наблюдателю: сверху, затем по кругу — горизонтально и под 45°. */
function* sightDirections() {
  yield [0, 0, 1];
  for (let step = 0; step < 8; step++) {
    const phi = (step / 8) * 2 * Math.PI;
    const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
    yield [cos, sin, 0];
    yield [cos * Math.SQRT1_2, sin * Math.SQRT1_2, Math.SQRT1_2];
  }
}

const UP_Y = [0, 1, 0];
const UP_Z = [0, 0, 1];

const SIGHTS = Array.from(sightDirections(), (dir) => {
  const up = Math.abs(dir[2]) > 0.9 ? UP_Y : UP_Z;
  const right = normalised(cross3(up, dir));
  return { dir, right, top: cross3(dir, right) };
});

function createDepthGrid() {
  const depth = new Float32Array(GRID * GRID);
  const owner = new Int32Array(GRID * GRID);
  const reset = () => {
    depth.fill(-Infinity);
    owner.fill(-1);
  };
  reset();
  const clip = (lo, hi) => [Math.max(0, Math.floor(lo)), Math.min(GRID - 1, Math.ceil(hi))];
  return {
    /* Треугольник a, b, c в колонках (горизонталь, вертикаль, глубина). */
    stamp({ g, v, d }, a, b, c, who) {
      const twice = (v[b] - v[c]) * (g[a] - g[c]) + (g[c] - g[b]) * (v[a] - v[c]);
      if (Math.abs(twice) < 1e-9) return;
      const [col0, col1] = clip(Math.min(g[a], g[b], g[c]), Math.max(g[a], g[b], g[c]));
      const [row0, row1] = clip(Math.min(v[a], v[b], v[c]), Math.max(v[a], v[b], v[c]));
      const first = v[b] - v[c];
      const second = v[c] - v[a];
      for (let row = row0; row <= row1; row++) {
        const rowShift = row + 0.5 - v[c];
        const tail1 = (g[c] - g[b]) * rowShift;
        const tail2 = (g[a] - g[c]) * rowShift;
        for (let col = col0; col <= col1; col++) {
          const colShift = col + 0.5 - g[c];
          const [w1, w2] = [(first * colShift + tail1) / twice, (second * colShift + tail2) / twice];
          const w3 = 1 - w1 - w2;
          if (Math.min(w1, w2, w3) < 0) continue;
          const cell = row * GRID + col;
          const here = w1 * d[a] + w2 * d[b] + w3 * d[c];
          if (here > depth[cell]) {
            depth[cell] = here;
            owner[cell] = who;
          }
        }
      }
    },
    collect(counts) {
      for (const who of owner) {
        if (who >= 0) counts[who]++;
      }
    },
    reset,
  };
}

/* Вершины относительно центра — один раз на сетку. */
function centred(positions, centre) {
  const length = Math.floor(positions.length / 3) * 3;
  return Float64Array.from({ length }, (_, at) => positions[at] - centre[at % 3]);
}

function projectCloud(rel, sight, radius) {
  const count = rel.length / 3;
  const cols = { g: new Float64Array(count), v: new Float64Array(count), d: new Float64Array(count) };
  const half = GRID / 2;
  for (let i = 0; i < count; i++) {
    cols.g[i] = (dotAt(rel, i * 3, sight.right) / radius) * half + half;
    cols.v[i] = (dotAt(rel, i * 3, sight.top) / radius) * half + half;
    cols.d[i] = dotAt(rel, i * 3, sight.dir);
  }
  return cols;
}

function sweepSights(sheets, centre, radius) {
  const grid = createDepthGrid();
  const counts = sheets.map(() => 0);
  const clouds = new Map(sheets.flatMap((sheet) => sheet.meshes).map((mesh) => [mesh, centred(mesh.positions, centre)]));
  for (const sight of SIGHTS) {
    sheets.forEach((sheet, who) => {
      for (const mesh of sheet.meshes) {
        const cols = projectCloud(clouds.get(mesh), sight, radius);
        forTriangles(mesh.indices, (a, b, c) => grid.stamp(cols, a, b, c, who));
      }
    });
    grid.collect(counts);
    grid.reset();
  }
  return counts;
}

/* Доля клеток, в которых лист ближе всех к наблюдателю; ключ листа → число. */
function visibleShares(sheets) {
  const { low, high } = extent(sheets.flatMap((sheet) => sheet.meshes));
  const centre = low.map((value, axis) => (value + high[axis]) / 2);
  const radius = Math.hypot(...high.map((value, axis) => value - low[axis])) / 2;
  const counts = radius > 0 ? sweepSights(sheets, centre, radius) : sheets.map(() => 0);
  const sum = counts.reduce((acc, count) => acc + count, 0);
  return new Map(sheets.map((sheet, who) => [sheet.key, sum > 0 ? counts[who] / sum : 0]));
}

/* ------------------------------------------------------------------ */
/* Список элементов вещи                                               */
/* ------------------------------------------------------------------ */

/* Лист входит в обёртку, если его проекция — обёртка по всей вещи. */
function wrapFlags(scene, entity, sheets) {
  const front = itemElementFront(null);
  const frame = thingFrame(scene, entity);
  const flags = new Map();
  for (const { key, meshes } of sheets) {
    const projection = itemElementProjection(meshes, { front, frame });
    flags.set(key, projection?.kind === "wrap");
  }
  return flags;
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const byProminence = (a, b) => b.seen - a.seen || b.area - a.area || compareText(a.texture, b.texture);

const spokenName = ({ word, index }) => (index ? `${tr(word)} ${index}` : tr(word));

function rowOf(sheet, seen, wrap) {
  const { low, high } = extent(sheet.meshes);
  return { texture: sheet.key, colour: sheet.colour, area: areaOf(sheet.meshes), seen, wrap, box: [low, high] };
}

/* Видимая доля и признак обёртки считаются раз на сцену и вещь. */
function sheetFacts(scene, key, sheets) {
  const memo = memoOf(scene);
  const shares = sheets.length > 1 ? cached(memo.shares, key, () => visibleShares(sheets)) : null;
  const wraps = cached(memo.wraps, key, () => wrapFlags(scene, key, sheets));
  return { shares, wraps };
}

function labelRows(rows) {
  const names = itemElementNames(rows);
  return rows.map((row, at) => Object.assign({}, row, { label: spokenName(names[at]) }));
}

const sheetList = (scene, key) => Array.from(gatherSheets(scene, key).values());

export function sceneItemElements(scene, key) {
  const sheets = sheetList(scene, key);
  if (sheets.length === 0) return [];
  const { shares, wraps } = sheetFacts(scene, key, sheets);
  const seenOf = (sheet) => (shares ? (shares.get(sheet.key) ?? 0) : 1);
  const rows = sheets.map((sheet) => rowOf(sheet, seenOf(sheet), wraps.get(sheet.key) ?? false));
  return labelRows(rows.sort(byProminence));
}

export function sceneMainElement(scene, key) {
  const rows = sceneItemElements(scene, key);
  for (const row of rows) {
    if (itemElementWord(row.texture, row.colour) !== SCREEN_WORD) return row;
  }
  return rows[0] ?? null;
}

/* Остров листа: из проекции, если она есть, иначе из развёртки игры. */
function islandOf(sheet, scene, key, place) {
  const front = itemElementFront(place);
  const frame = thingFrame(scene, key);
  const projection = itemElementProjection(sheet.meshes, { front, frame });
  return projection ? itemElementProjectedIsland(projection) : itemElementIsland(sheet.meshes);
}

export function sceneElementIsland(scene, key, texture, place) {
  const sheets = gatherSheets(scene, key);
  const sheet = sheets.get(itemElementKey(texture));
  return sheet === undefined ? null : islandOf(sheet, scene, key, place);
}

/* ------------------------------------------------------------------ */
/* Холст листа                                                         */
/* ------------------------------------------------------------------ */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* Сторона холста: степень двойки не меньше 512 / доля, в пределах 64…2048. */
function sheetSide(share) {
  const wanted = SHEET.base / Math.max(share, 1 / SHEET.ceil);
  return clamp(2 ** Math.ceil(Math.log2(wanted)), SHEET.floor, SHEET.ceil);
}

function blankCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/* Шаги рисунка: массив — вызов метода, объект — присвоение свойств. */
function paintScript(image, field, background, matrix) {
  return [
    ["save"],
    ["beginPath"],
    ["rect", ...field],
    ["clip"],
    ...(background ? [{ fillStyle: background }, ["fillRect", ...field]] : []),
    ["setTransform", ...matrix],
    { imageSmoothingQuality: "high" },
    ["drawImage", image, 0, 0, 1, 1],
    ["restore"],
  ];
}

export function elementSheetCanvas(island, image, fit, options) {
  const { background = "" } = options ?? {};
  const { rect } = island;
  const across = rect[2] - rect[0];
  const down = rect[3] - rect[1];
  const canvas = blankCanvas(sheetSide(across), sheetSide(down));
  const pen = canvas.getContext("2d");
  if (!pen) return null;
  const { width, height } = canvas;
  const { origin, u, v } = itemElementPlacement(island, { width: image.width, height: image.height }, fit);
  const inPixels = (values) => values.map((part, at) => part * (at % 2 ? height : width));
  const field = inPixels([rect[0], rect[1], across, down]);
  const matrix = inPixels([u[0], u[1], v[0], v[1], origin[0], origin[1]]);
  for (const step of paintScript(image, field, background, matrix)) {
    if (Array.isArray(step)) pen[step[0]](...step.slice(1));
    else Object.assign(pen, step);
  }
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Слои кадра: картинка или цвет поверх листа                           */
/* ------------------------------------------------------------------ */

const asFloats = (values) => (values instanceof Float32Array ? values : new Float32Array(values));

function sheetTexture(texture, colorSpace) {
  return Object.assign(texture, { flipY: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace });
}

async function readPicture(asset) {
  try {
    const blob = await getWorkshopAsset(asset);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  }
}

/* Картинка хранилища: удача запоминается, неудача нет. */
function fetchPicture(asset) {
  if (!asset) return Promise.resolve(null);
  const known = pictureShelf.get(asset);
  if (known) return known;
  const reading = readPicture(asset);
  pictureShelf.set(asset, reading);
  reading.then((bitmap) => bitmap || pictureShelf.delete(asset));
  return reading;
}

/* Опора тона листа: средняя яркость, 0,5 без холста. */
function toneOf(sheetImage) {
  const surface = blankCanvas(SHEET.tone, SHEET.tone);
  const pen = surface.getContext?.("2d", { willReadFrequently: true }) ?? null;
  if (pen === null) return 0.5;
  Object.assign(pen, { imageSmoothingQuality: "high" });
  pen.drawImage(sheetImage, 0, 0, SHEET.tone, SHEET.tone);
  return meanLuma(pen.getImageData(0, 0, SHEET.tone, SHEET.tone).data);
}

class World {
  constructor(scene, entityOf, placeOf) {
    this.scene = scene;
    this.entityOf = entityOf;
    this.placeOf = placeOf;
    this.byEntity = new Map();
  }

  placeAt(key) {
    return this.placeOf ? this.placeOf(key) : null;
  }

  sheetsOf(key) {
    const entity = this.entityOf(key);
    return cached(this.byEntity, entity, () => gatherSheets(this.scene, entity));
  }

  frameOf(key) {
    return thingFrame(this.scene, this.entityOf(key));
  }
}

/* Готовый слой: материал, текстура и вид проекции (wrap, plane или нет). */
class Layer {
  constructor(material, texture, projection = null) {
    this.material = material;
    this.texture = texture;
    this.projection = projection;
  }

  discard() {
    this.material.dispose();
    this.texture.dispose();
  }

  /* Развёртка слоя по плоскости или обёртке вещи; null — остаётся развёртка игры. */
  uvsFor(world, key, meshes) {
    if (!this.projection) return null;
    const plane =
      this.projection === "wrap"
        ? itemElementWrap(meshes, itemElementFront(world.placeAt(key)), world.frameOf(key))
        : itemElementPlane(meshes);
    return plane ? itemElementProjectedUvs(meshes, plane) : null;
  }

  /* Сетки-копии листа одного ключа добавляются в держатель; отдаёт их геометрии. */
  mount(holder, world, key, sheet) {
    const projected = this.uvsFor(world, key, sheet.meshes);
    return sheet.meshes.map((source, at) => {
      const geometry = layerGeometry(source, projected?.[at]);
      const mesh = new THREE.Mesh(geometry, this.material);
      Object.assign(mesh, { receiveShadow: true, renderOrder: 1 });
      holder.add(mesh);
      return geometry;
    });
  }

  /* Держатель: по сетке-копии на каждый ключ группы и каждую сетку листа. */
  raise(world, group, element) {
    const holder = new THREE.Group();
    const geometries = [...new Set(group.keys)].flatMap((key) => {
      const sheet = world.sheetsOf(key).get(element.texture);
      return sheet ? this.mount(holder, world, key, sheet) : [];
    });
    return {
      object: holder,
      dispose: () => {
        geometries.forEach((geometry) => geometry.dispose());
        this.discard();
      },
    };
  }
}

const GEOMETRY_FIELDS = [
  ["position", "positions", 3],
  ["normal", "normals", 3],
  ["uv", "uvs", 2],
];

function layerGeometry(mesh, uvs) {
  const source = { positions: mesh.positions, normals: mesh.normals, uvs: uvs ?? mesh.uvs };
  const geometry = new THREE.BufferGeometry();
  for (const [name, field, size] of GEOMETRY_FIELDS) {
    geometry.setAttribute(name, new THREE.BufferAttribute(asFloats(source[field]), size));
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
  return geometry;
}

/* Проекция листа для картинки и остров, в который она ляжет. */
function pictureGround(world, group, element, sheet) {
  const lead = group.keys[0];
  const projection = itemElementProjection(sheet.meshes, {
    front: itemElementFront(world.placeAt(lead)),
    frame: world.frameOf(lead),
    around: element.around === true,
  });
  const island = projection ? itemElementProjectedIsland(projection) : itemElementIsland(sheet.meshes);
  return { projection, island };
}

const projectionKind = (projection) => (projection ? (projection.kind === "wrap" ? "wrap" : "plane") : null);

async function pictureLayer(world, group, element, sheet) {
  const { projection, island } = pictureGround(world, group, element, sheet);
  if (!island) return null;
  const image = await fetchPicture(element.picture?.asset);
  if (!image) return null;
  const canvas = elementSheetCanvas(island, image, element.fit, { background: projection ? SHEET.backdrop : "" });
  if (!canvas) return null;
  const texture = sheetTexture(new THREE.CanvasTexture(canvas), THREE.SRGBColorSpace);
  const material = new THREE.MeshStandardMaterial({
    ...PICTURE_LOOK,
    ...LAYER_OFFSET,
    map: texture,
    side: sheet.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  return new Layer(material, texture, projectionKind(projection));
}

/* Материал перекраски поверх прежнего листа, со смещением полигонов. */
function recolourMaterial(sheet, texture, tint) {
  const doubleSided = sheet.doubleSided || sheet.alpha === "blend";
  const material = createRecolourMaterial({ alpha: sheet.alpha, doubleSided });
  applyRecolourLook(material, { map: texture, tint });
  return Object.assign(material, LAYER_OFFSET);
}

async function colourLayer(element, sheet) {
  const sheetImage = sheet.record ? await loadSceneImage(sheet.record, SHEET.scene) : null;
  if (!sheetImage) return null;
  const ref = toneOf(sheetImage);
  const texture = sheetTexture(new THREE.Texture(sheetImage), THREE.NoColorSpace);
  texture.needsUpdate = true;
  return new Layer(recolourMaterial(sheet, texture, { colour: element.colour, ref, brightness: 1, strength: 1 }), texture);
}

async function makeLayer(world, group, element) {
  const sheet = world.sheetsOf(group.keys[0]).get(element.texture);
  if (!sheet) return null;
  const build = element.colour ? () => colourLayer(element, sheet) : () => pictureLayer(world, group, element, sheet);
  return build();
}

/* Один прогон сборки: отмена освобождает всё уже собранное. */
class BuildRun {
  constructor() {
    this.aborted = false;
    this.made = [];
  }

  abort() {
    this.aborted = true;
    this.made.forEach((made) => made.dispose());
  }
}

/* Сборка по группам и элементам; false — сборку отменили в ожидании. */
async function buildLayers(run, world, groups) {
  const tasks = groups.flatMap((group) => group.elements.map((element) => ({ group, element })));
  for (const { group, element } of tasks) {
    const layer = await makeLayer(world, group, element);
    if (run.aborted) {
      layer?.discard();
      return false;
    }
    if (layer) run.made.push(layer.raise(world, group, element));
  }
  return true;
}

const groupSignature = (group) => [
  group.keys,
  group.elements.map((el) => [el.texture, el.picture?.asset ?? el.colour, el.fit ?? null, el.around ? 1 : 0]),
];

/* Группы вида «elements»: прежний список, пока не изменилась подпись. */
function useElementGroups(groups, scene, active) {
  const held = useRef(null);
  const wanted = (groups ?? []).filter((group) => group.kind === "elements");
  const signature = active && scene ? JSON.stringify(wanted.map(groupSignature)) : "[]";
  if (held.current?.signature !== signature) held.current = { signature, list: wanted };
  return held.current.list;
}

function useLayerBuild(elementGroups, scene, entityOf, placeOf) {
  const [layers, setLayers] = useState(NO_LAYERS);
  useEffect(() => {
    setLayers((prev) => (prev.length ? NO_LAYERS : prev));
    if (elementGroups.length === 0 || !scene) return undefined;
    const run = new BuildRun();
    buildLayers(run, new World(scene, entityOf, placeOf), elementGroups).then((finished) => {
      if (finished && !run.aborted) setLayers(run.made);
    });
    return () => run.abort();
  }, [elementGroups, scene, entityOf, placeOf]);
  return layers;
}

const sameEntity = (key) => key;

export function useItemElementObjects(options) {
  const { groups, scene, active = true, placeOf = null } = options;
  const entityOf = options.entityOf === undefined ? sameEntity : options.entityOf;
  return useLayerBuild(useElementGroups(groups, scene, active), scene, entityOf, placeOf);
}
