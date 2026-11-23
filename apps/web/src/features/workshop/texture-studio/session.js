/*
 * Сессия студии текстур (ТЗ 18.10.2026, Session 1, задача 6): документ,
 * холсты слоёв, сборка, история, выделение — одно место, где правка слоя
 * становится шагом. Без React: окно подписывается (`subscribe`) и читает
 * снимок (`snapshot`), а инструменты зовут методы.
 *
 * Правка пикселей — всегда кусок: `before` и `after` одной рамки на шаг истории
 * (`pixelStep`). Правка структуры (слои, свойства) — новый документ в шаге.
 * Тяжёлое (палочка, фильтры, коррекции на куске, «убрать фон») идёт в рабочем
 * потоке (`heavy.js`); пока оно считается, `busy` поднят — окно показывает
 * ожидание, а не подвисает.
 */

import {
  addLayer,
  blendOperation,
  createDocument,
  documentAssets,
  documentFonts,
  duplicateLayer,
  isPixelLayer,
  layerOf,
  mergeDown,
  moveLayer,
  nextLayerId,
  normalizeDocument,
  parseDocument,
  patchLayer,
  removeLayer,
  reorderLayer,
  resizeDocument,
  selectLayer,
  serializeDocument,
} from "./engine/document.js";
import { ADJUST_LABELS } from "./engine/adjust.js";
import { FILTER_LABELS, filterPadding, normalizeFilterParams } from "./engine/filters.js";
import { bucketRegion, fillMaskRegion, gradientFill, hexToRgb } from "./engine/fill.js";
import {
  applyPatch,
  canRedo,
  canUndo,
  createHistory,
  currentEntry,
  historyDocument,
  jumpTo,
  pushEntry,
  redoStep,
  undoStep,
} from "./engine/history.js";
import { combineMasks, createMask, featherMask, invertMask, isEmptyMask, lockedSelection, maskBounds, offsetMask, selectAllMask } from "./engine/selection.js";
import { createCompositor, exportBlob } from "./compositor.js";
import { isEmblemFontReady } from "../emblem/emblem-fonts.js";
import { prepareOwnFonts } from "../emblem/own-font.js";
import { closeHeavy, runHeavy } from "./heavy.js";
import { clampRect, createRasterStore, maskKey } from "./raster-store.js";
import { beginStroke } from "./strokes.js";

const FULL = (doc) => ({ x: 0, y: 0, width: doc.width, height: doc.height });

/** Сессия студии: `width × height` — размер холста, `doc` — открыть с готовым документом. */
export function createSession({ width, height, doc = null, background = "#000000" } = {}) {
  const start = doc ? normalizeDocument(doc) : createDocument({ width, height, background });
  const store = createRasterStore(start.width, start.height);
  const assets = new Map();
  const compositor = createCompositor({ store, assets });
  const listeners = new Set();
  let state = {
    doc: start,
    history: createHistory(start),
    selection: null,
    busy: "",
    flatVersion: 0,
    saved: true,
    notice: null,
  };
  let snapshotCache = null;
  let loadingAssets = new Set();
  let selectionRevision = 0;
  /*
   * Замок поверхности (ТЗ 18.10.2026, Session 1, задача 3): студия открыта на одной
   * поверхности листа — кисть, заливка, ластик и фильтры правят только её область
   * (`lock` — прямоугольник холста), а не соседние места того же листа. Не часть
   * документа и не шаг истории: окно ставит замок на открытии и снимает кнопкой
   * «Весь лист». С выделением замок пересекается.
   */
  let lock = null;
  let lockRevision = 0;
  /*
   * Плитка (вид «стена», 3Б ТЗ 18.10.2026): лист повторяется на стене, поэтому мазок,
   * дошедший до края листа, продолжается с противоположного — `dab(x, y)` принимает точку
   * вне листа (непрерывный путь по стене) и кладёт кисть по модулю листа, дублируя её на
   * соседние края, если она их задевает.
   */
  let wrap = false;
  let editCache = { selection: null, revision: -1, mask: null };
  function editSelection() {
    if (!lock) return state.selection;
    if (editCache.revision === lockRevision && editCache.selection === state.selection) return editCache.mask;
    const mask = lockedSelection(state.doc.width, state.doc.height, lock, state.selection);
    editCache = { selection: state.selection, revision: lockRevision, mask };
    return mask;
  }

  const snapshot = () => {
    if (snapshotCache) return snapshotCache;
    snapshotCache = {
      doc: state.doc,
      entries: state.history.entries.map((entry) => ({ id: entry.id, label: entry.label })),
      index: state.history.index,
      canUndo: canUndo(state.history),
      canRedo: canRedo(state.history),
      selection: state.selection ? { revision: selectionRevision, bounds: maskBounds(state.selection) } : null,
      busy: state.busy,
      flatVersion: state.flatVersion,
      dirty: !state.saved,
      notice: state.notice,
    };
    return snapshotCache;
  };

  function emit(event) {
    snapshotCache = null;
    for (const listener of listeners) listener(event);
  }

  /** Пересобрать кусок (весь холст, если `rect` пуст) и сообщить окну. */
  function render(rect = null) {
    const area = compositor.render(state.doc, rect);
    state = { ...state, flatVersion: state.flatVersion + 1 };
    emit({ kind: "pixels", rect: area || FULL(state.doc) });
  }

  /* Недостающие картинки слоёв-картинок: грузятся и пересобирают холст. */
  /* Свои шрифты надписей: файл открывается из хранилища окна, и холст пересобирается им (до того писал бы запасным). */
  const requestedFonts = new Set();
  function ensureFonts() {
    for (const asset of documentFonts(state.doc)) {
      if (requestedFonts.has(asset)) continue;
      requestedFonts.add(asset);
      void prepareOwnFonts(asset).then((ready) => {
        if (ready) render();
        else requestedFonts.delete(asset);
      });
    }
  }

  function ensureAssets(loader) {
    ensureFonts();
    if (!loader) return;
    for (const key of documentAssets(state.doc)) {
      if (assets.has(key) || loadingAssets.has(key)) continue;
      loadingAssets.add(key);
      Promise.resolve(loader(key))
        .then((bitmap) => {
          if (bitmap) {
            assets.set(key, bitmap);
            render();
          }
        })
        .catch(() => {})
        .finally(() => loadingAssets.delete(key));
    }
  }
  let assetLoader = null;

  /* Шаг истории: документ после, куски пикселей, ключ склейки. */
  function record(label, nextDoc, patches = [], mergeKey = null) {
    state = { ...state, doc: nextDoc, history: pushEntry(state.history, { label, doc: nextDoc, patches, mergeKey }), saved: false };
  }

  const session = {
    store,
    compositor,
    assets,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    get doc() {
      return state.doc;
    },
    get selection() {
      return state.selection;
    },
    get width() {
      return state.doc.width;
    },
    get height() {
      return state.doc.height;
    },
    setAssetLoader(loader) {
      assetLoader = loader;
      ensureAssets(loader);
    },
    /** Слой, который сейчас правится. */
    activeLayer: () => layerOf(state.doc, state.doc.active),

    /* ------------------------------ основа ------------------------------ */

    /** Основа — картинкой (`ImageBitmap` / холст / `<img>`), растянутой на холст. */
    loadBase(source) {
      const surface = store.get("base");
      if (!surface) return;
      surface.context.clearRect(0, 0, state.doc.width, state.doc.height);
      surface.context.imageSmoothingQuality = "high";
      surface.context.drawImage(source, 0, 0, state.doc.width, state.doc.height);
      render();
    },
    /** Основа — ровным цветом. */
    fillBase(colour) {
      const surface = store.get("base");
      if (!surface || !colour || colour === "transparent") return;
      surface.context.fillStyle = colour;
      surface.context.fillRect(0, 0, state.doc.width, state.doc.height);
      render();
    },
    /** Сессия открыта и основа положена — это начало: сохранять пока нечего. */
    markSaved() {
      state = { ...state, saved: true };
      emit({ kind: "history" });
    },

    /* ----------------------------- структура ---------------------------- */

    /** Новый документ-шаг: `edit(doc)` → документ после. */
    commitDocument(label, edit, { mergeKey = null, patches = [] } = {}) {
      const next = normalizeDocument(edit(state.doc));
      record(label, next, patches, mergeKey);
      ensureAssets(assetLoader);
      render();
      emit({ kind: "doc" });
      return next;
    },
    select(id) {
      const next = selectLayer(state.doc, id);
      if (next === state.doc) return;
      state = { ...state, doc: next };
      emit({ kind: "doc" });
    },
    addRaster(name = "Слой") {
      const id = nextLayerId(state.doc);
      session.commitDocument("Новый слой", (doc) => addLayer(doc, { type: "raster", id, name }));
      return id;
    },
    addFill(colour = "#808080") {
      const id = nextLayerId(state.doc);
      session.commitDocument("Новая заливка", (doc) => addLayer(doc, { type: "fill", id, colour }));
      return id;
    },
    addAdjust(kind) {
      const id = nextLayerId(state.doc);
      session.commitDocument("Коррекция", (doc) => addLayer(doc, { type: "adjust", id, kind }));
      return id;
    },
    addText(x, y, { value = "Текст", colour = "#ffffff", size = Math.round(state.doc.height / 8), font = "sans", fontAsset = "", fontName = "" } = {}) {
      const id = nextLayerId(state.doc);
      session.commitDocument("Текст", (doc) => addLayer(doc, { type: "text", id, value, x, y, colour, size, font, ...(fontAsset ? { fontAsset, fontName } : {}), name: value }));
      return id;
    },
    addShape(shape, x1, y1, x2, y2, { stroke = "#ffffff", fill = null, strokeWidth = 8 } = {}) {
      const id = nextLayerId(state.doc);
      session.commitDocument("Фигура", (doc) => addLayer(doc, { type: "shape", id, shape, x1, y1, x2, y2, stroke, fill, strokeWidth }));
      return id;
    },
    /** Картинка слоем: вписана в 60 % холста по центру. */
    addImage({ asset, bitmap, name = "Картинка", fitTo = 0.6 }) {
      if (bitmap) assets.set(asset, bitmap);
      const width = bitmap?.width || 256;
      const height = bitmap?.height || 256;
      const scale = Math.min((state.doc.width * fitTo) / width, (state.doc.height * fitTo) / height, 1e6);
      const id = nextLayerId(state.doc);
      session.commitDocument("Вставка картинки", (doc) =>
        addLayer(doc, { type: "image", id, asset, name, width: width * scale, height: height * scale, x: (doc.width - width * scale) / 2, y: (doc.height - height * scale) / 2 }),
      );
      return id;
    },
    patchLayer(id, patch, label = "Слой", mergeKey = null) {
      session.commitDocument(label, (doc) => patchLayer(doc, id, patch), { mergeKey: mergeKey || `layer:${id}:${Object.keys(patch).join(",")}` });
    },
    removeLayer(id) {
      session.commitDocument("Удалить слой", (doc) => removeLayer(doc, id));
    },
    duplicate(id) {
      const copyId = nextLayerId(state.doc);
      const { doc: next, copy } = duplicateLayer(state.doc, id, copyId);
      if (!copy) return null;
      if (store.has(id)) store.copy(id, copyId);
      if (store.has(maskKey(id))) store.copy(maskKey(id), maskKey(copyId));
      session.commitDocument("Дублировать слой", () => next);
      return copyId;
    },
    moveLayer(id, step) {
      session.commitDocument("Порядок слоёв", (doc) => moveLayer(doc, id, step));
    },
    reorder(id, to) {
      session.commitDocument("Порядок слоёв", (doc) => reorderLayer(doc, id, to));
    },
    /** Склейка с нижним: пиксели верхнего ложатся на нижний с режимом и непрозрачностью. */
    mergeDown(id) {
      const top = layerOf(state.doc, id);
      const next = mergeDown(state.doc, id);
      if (!top || next === state.doc) return false;
      const below = next.active;
      const rect = FULL(state.doc);
      const before = store.read(below, rect);
      store.mergeInto(below, id, { opacity: top.opacity / 100, operation: blendOperation(top.blend) });
      const after = store.read(below, rect);
      session.commitDocument("Склеить с нижним", () => next, { patches: [{ layer: below, ...rect, before: before.data, after: after.data }] });
      return true;
    },
    /** Слой маской: добавить или убрать (маска — альфа-канал холста `mask:<id>`; по умолчанию всё видно). */
    toggleMask(id) {
      const layer = layerOf(state.doc, id);
      if (!layer) return;
      if (!layer.mask) {
        const surface = store.get(maskKey(id));
        surface.context.fillStyle = "#fff";
        surface.context.fillRect(0, 0, state.doc.width, state.doc.height);
      }
      session.commitDocument(layer.mask ? "Убрать маску" : "Маска слоя", (doc) => patchLayer(doc, id, { mask: !layer.mask }));
    },
    resize(widthPx, heightPx) {
      const next = resizeDocument(state.doc, widthPx, heightPx);
      store.resize(next.width, next.height);
      compositor.resize();
      state = { ...state, selection: null };
      lock = null;
      lockRevision += 1;
      session.commitDocument("Размер холста", () => next);
    },

    /* ------------------------------ выделение --------------------------- */

    setSelection(mask, op = "new") {
      const next = mask && !isEmptyMask(mask) ? combineMasks(state.selection, mask, op) : op === "new" ? null : state.selection;
      state = { ...state, selection: next && !isEmptyMask(next) ? next : null };
      selectionRevision += 1;
      emit({ kind: "selection" });
    },
    selectAll() {
      session.setSelection(selectAllMask(state.doc.width, state.doc.height), "new");
    },
    deselect() {
      session.setSelection(null, "new");
    },
    invertSelection() {
      session.setSelection(state.selection ? invertMask(state.selection) : selectAllMask(state.doc.width, state.doc.height), "new");
    },
    featherSelection(radius) {
      if (state.selection) session.setSelection(featherMask(state.selection, radius), "new");
    },
    moveSelection(dx, dy) {
      if (state.selection) session.setSelection(offsetMask(state.selection, Math.round(dx), Math.round(dy)), "new");
    },

    /** Замок поверхности: `{ x, y, width, height }` в пикселях холста или `null` (весь лист). */
    get lock() {
      return lock;
    },
    /** Вид «стена»: мазок заворачивается через край листа (`wrap`) — лист повторяется плиткой. */
    get wrap() {
      return wrap;
    },
    setWrap(on) {
      wrap = Boolean(on);
    },
    setLock(rect) {
      const area = rect ? clampRect(rect, state.doc.width, state.doc.height) : null;
      if (JSON.stringify(area) === JSON.stringify(lock)) return;
      lock = area;
      lockRevision += 1;
      emit({ kind: "selection" });
    },

    /* ------------------------------- пиксели ---------------------------- */

    /**
     * Шаг по пикселям слоя `id`: `mutate(piece)` правит `piece.data` (RGBA куска
     * `rect`) на месте. Ответ — рамка или `null`.
     */
    pixelStep(label, id, rect, mutate, { mergeKey = null } = {}) {
      const area = clampRect(rect || FULL(state.doc), state.doc.width, state.doc.height);
      if (!area) return null;
      const before = store.read(id, area);
      if (!before) return null;
      const data = new Uint8ClampedArray(before.data);
      const changed = mutate({ ...area, data });
      if (changed === false) return null;
      store.write(id, area, data);
      record(label, state.doc, [{ layer: id, ...area, before: before.data, after: data }], mergeKey);
      render(area);
      emit({ kind: "history" });
      return area;
    },

    /**
     * Слой, на котором можно править пиксели: активный растровый как есть; у
     * слоя-картинки, текста, фигуры или заливки — свой растр: `paint` кладёт
     * новый прозрачный слой сверху (кисть, заливка, градиент), иначе слой
     * растрируется на месте (ластик, ретушь, фильтры). Коррекция, закреплённый
     * и скрытый слои — `null`.
     */
    pixelLayer({ paint = false } = {}) {
      let layer = layerOf(state.doc, state.doc.active);
      if (!layer || layer.locked || !layer.visible) return null;
      if (isPixelLayer(layer)) return layer;
      if (layer.type === "adjust") return null;
      if (paint) session.addRaster();
      else if (!session.rasterize(layer.id)) return null;
      layer = layerOf(state.doc, state.doc.active);
      return isPixelLayer(layer) ? layer : null;
    },

    /** Мазок: `begin(params)` → `{ dab, takeDirty, end, spacing }`; конец кладёт шаг. */
    beginStroke(params) {
      const layer = session.pixelLayer({ paint: params.tool === "brush" });
      if (!layer) return null;
      const surface = store.get(layer.id);
      if (!surface) return null;
      const stroke = beginStroke(surface, { ...params, selection: editSelection() });
      const reach = Math.ceil((Number(params.size) || 30) / 2) + 2;
      return {
        spacing: stroke.spacing,
        dab(x, y) {
          if (!wrap) {
            const rect = stroke.dab(x, y);
            if (rect) render(rect);
            return rect;
          }
          const { width, height } = state.doc;
          const cx = ((x % width) + width) % width;
          const cy = ((y % height) + height) % height;
          const shifts = (c, size) => [0, ...(c - reach < 0 ? [size] : []), ...(c + reach > size ? [-size] : [])];
          let last = null;
          for (const dx of shifts(cx, width))
            for (const dy of shifts(cy, height)) {
              const rect = stroke.dab(cx + dx, cy + dy);
              if (rect) {
                render(rect);
                last = rect;
              }
            }
          return last;
        },
        end(label) {
          const result = stroke.end();
          if (!result) return null;
          record(label, state.doc, [{ layer: layer.id, ...result.rect, before: result.before, after: result.after }]);
          emit({ kind: "history" });
          return result.rect;
        },
      };
    },

    /** Все пиксели слоя или собранного холста (для палочки и пипетки): `Uint8ClampedArray`. */
    readPixels(id, rect = null) {
      const area = rect || FULL(state.doc);
      if (id === "flat") return compositor.flat.context.getImageData(area.x, area.y, area.width, area.height).data;
      return store.read(id, area)?.data || null;
    },
    pickColour(x, y, { sampleAll = true } = {}) {
      const px = Math.max(0, Math.min(state.doc.width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(state.doc.height - 1, Math.round(y)));
      const data = sampleAll ? compositor.flat.context.getImageData(px, py, 1, 1).data : store.read(state.doc.active, { x: px, y: py, width: 1, height: 1 })?.data;
      if (!data) return null;
      return `#${[data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    },

    /* ------------------------------ тяжёлое ----------------------------- */

    async withBusy(label, work) {
      state = { ...state, busy: label };
      emit({ kind: "busy" });
      try {
        return await work();
      } finally {
        state = { ...state, busy: "" };
        emit({ kind: "busy" });
      }
    },

    /** Волшебная палочка по точке: пиксели слоя или собранного холста. */
    async wand(x, y, { tolerance = 32, contiguous = true, sampleAll = false, op = "new", feather = 0 } = {}) {
      const source = sampleAll ? "flat" : state.doc.active;
      const full = FULL(state.doc);
      const pixels = session.readPixels(source, full);
      if (!pixels) return;
      const answer = await session.withBusy("Палочка", () => runHeavy("wand", { pixels, width: full.width, height: full.height, x, y, tolerance, contiguous }));
      let mask = { width: full.width, height: full.height, data: new Uint8Array(answer.mask) };
      if (feather >= 1) mask = featherMask(mask, feather);
      session.setSelection(mask, op);
    },

    /** «Убрать фон» слоя: фон по краю становится прозрачным (мягкий край — `feather`). */
    async removeBackground({ tolerance = 40, feather = 1 } = {}) {
      const layer = session.pixelLayer();
      if (!layer) return false;
      const full = FULL(state.doc);
      const pixels = session.readPixels(layer.id, full);
      const answer = await session.withBusy("Убираем фон", () => runHeavy("background", { pixels, width: full.width, height: full.height, tolerance, feather }));
      const mask = answer.mask;
      session.pixelStep("Убрать фон", layer.id, full, (piece) => {
        for (let at = 0; at < mask.length; at += 1) if (mask[at]) piece.data[at * 4 + 3] = piece.data[at * 4 + 3] * (1 - mask[at] / 255);
      });
      return true;
    },

    /** Фильтр слоя (в пределах выделения): кусок идёт в поток с запасом по краям. */
    async filter(kind, input) {
      const layer = session.pixelLayer();
      if (!layer) return false;
      const params = normalizeFilterParams(kind, input);
      const bounds = editSelection() ? maskBounds(editSelection()) : FULL(state.doc);
      if (!bounds) return false;
      const pad = filterPadding(kind, params);
      const region = clampRect({ x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 }, state.doc.width, state.doc.height);
      const piece = store.read(layer.id, region);
      if (!piece) return false;
      let mask = null;
      if (editSelection()) {
        mask = new Uint8Array(region.width * region.height);
        for (let row = 0; row < region.height; row += 1) mask.set(editSelection().data.subarray((region.y + row) * state.doc.width + region.x, (region.y + row) * state.doc.width + region.x + region.width), row * region.width);
      }
      const answer = await session.withBusy("Фильтр", () => runHeavy("filter", { pixels: piece.data, width: region.width, height: region.height, kind, params, mask }));
      if (!answer.known) return false;
      session.pixelStep(`Фильтр: ${FILTER_LABELS[kind] || kind}`, layer.id, region, (target) => {
        target.data.set(answer.pixels);
      });
      return true;
    },

    /** Коррекция «в слой»: применяется к пикселям слоя и тут же забывается (в пределах выделения). */
    async adjustPixels(kind, params) {
      const layer = session.pixelLayer();
      if (!layer) return false;
      const bounds = editSelection() ? maskBounds(editSelection()) : FULL(state.doc);
      if (!bounds) return false;
      const piece = store.read(layer.id, bounds);
      let mask = null;
      if (editSelection()) {
        mask = new Uint8Array(bounds.width * bounds.height);
        for (let row = 0; row < bounds.height; row += 1) mask.set(editSelection().data.subarray((bounds.y + row) * state.doc.width + bounds.x, (bounds.y + row) * state.doc.width + bounds.x + bounds.width), row * bounds.width);
      }
      const answer = await session.withBusy("Коррекция", () => runHeavy("adjust", { pixels: piece.data, width: bounds.width, height: bounds.height, kind, params, mask }));
      if (!answer.known) return false;
      session.pixelStep(`Коррекция: ${ADJUST_LABELS[kind] || kind}`, layer.id, bounds, (target) => {
        target.data.set(answer.pixels);
      });
      return true;
    },

    /** Залить выделение (или слой целиком) цветом. */
    fillSelection(colour, opacity = 1) {
      const layer = session.pixelLayer({ paint: true });
      if (!layer) return false;
      const bounds = editSelection() ? maskBounds(editSelection()) : FULL(state.doc);
      if (!bounds) return false;
      const rgb = hexToRgb(colour);
      return Boolean(
        session.pixelStep("Заливка", layer.id, bounds, (piece) => {
          fillMaskRegion(piece.data, piece.width, piece.height, rgb, { opacity, selection: editSelection(), origin: { x: piece.x, y: piece.y }, canvasWidth: state.doc.width });
        }),
      );
    },

    /** «Ведро»: по близости цвета (связная область или по всему слою). */
    async bucket(x, y, colour, { tolerance = 32, contiguous = true, opacity = 1, sampleAll = false } = {}) {
      const layer = session.pixelLayer({ paint: true });
      if (!layer) return false;
      const full = FULL(state.doc);
      const source = session.readPixels(sampleAll ? "flat" : layer.id, full);
      const answer = await session.withBusy("Заливка", () => runHeavy("wand", { pixels: source, width: full.width, height: full.height, x, y, tolerance, contiguous }));
      const mask = { width: full.width, height: full.height, data: new Uint8Array(answer.mask) };
      const bounds = maskBounds(mask);
      if (!bounds) return false;
      const rgb = hexToRgb(colour);
      return Boolean(
        session.pixelStep("Заливка", layer.id, bounds, (piece) => {
          bucketRegion(piece.data, piece.width, piece.height, mask, rgb, { opacity, selection: editSelection(), origin: { x: piece.x, y: piece.y } });
        }),
      );
    },

    /** Градиент слоя по линии `from → to`. */
    gradient(from, to, stops, { kind = "linear", opacity = 1 } = {}) {
      const layer = session.pixelLayer({ paint: true });
      if (!layer) return false;
      const bounds = editSelection() ? maskBounds(editSelection()) : FULL(state.doc);
      if (!bounds) return false;
      return Boolean(
        session.pixelStep("Градиент", layer.id, bounds, (piece) => {
          const local = (point) => [point[0] - piece.x, point[1] - piece.y];
          let selection = null;
          if (editSelection()) {
            selection = createMask(piece.width, piece.height);
            for (let row = 0; row < piece.height; row += 1) selection.data.set(editSelection().data.subarray((piece.y + row) * state.doc.width + piece.x, (piece.y + row) * state.doc.width + piece.x + piece.width), row * piece.width);
          }
          gradientFill(piece.data, piece.width, piece.height, local(from), local(to), stops, { kind, opacity, selection });
        }),
      );
    },

    /** Стереть выделенное (или весь слой) до прозрачного. */
    clearSelection() {
      const layer = session.pixelLayer();
      if (!layer) return false;
      const bounds = editSelection() ? maskBounds(editSelection()) : FULL(state.doc);
      if (!bounds) return false;
      return Boolean(
        session.pixelStep("Стереть", layer.id, bounds, (piece) => {
          for (let row = 0; row < piece.height; row += 1)
            for (let col = 0; col < piece.width; col += 1) {
              const weight = editSelection() ? editSelection().data[(piece.y + row) * state.doc.width + piece.x + col] / 255 : 1;
              if (weight > 0) piece.data[(row * piece.width + col) * 4 + 3] *= 1 - weight;
            }
        }),
      );
    },

    /** Растрировать слой-картинку/текст/фигуру/заливку: пиксели — в растр, структура — растр. */
    rasterize(id) {
      const layer = layerOf(state.doc, id);
      if (!layer || ["raster", "base", "adjust"].includes(layer.type)) return false;
      const only = { ...state.doc, layers: [{ ...layer, blend: "normal", opacity: 100, mask: false, visible: true }], background: "transparent" };
      const scratch = createCompositor({ store, assets });
      scratch.render(only);
      const surface = store.get(id);
      surface.context.clearRect(0, 0, state.doc.width, state.doc.height);
      surface.context.drawImage(scratch.flat.canvas, 0, 0);
      scratch.dispose();
      session.commitDocument("Растрировать слой", (doc) => patchLayer({ ...doc, layers: doc.layers.map((item) => (item.id === id ? { ...item, type: "raster" } : item)) }, id, {}));
      return true;
    },

    /* ------------------------------- история ---------------------------- */

    applyEntries(steps) {
      for (const { entry, direction } of steps)
        for (const patch of entry.patches) {
          const surface = store.get(patch.layer);
          if (!surface) continue;
          const live = surface.context.getImageData(patch.x, patch.y, patch.width, patch.height);
          const target = { data: live.data, width: patch.width, height: patch.height };
          applyPatch(target, { ...patch, x: 0, y: 0 }, direction);
          surface.context.putImageData(live, patch.x, patch.y);
        }
    },
    undo() {
      const { history, steps } = undoStep(state.history);
      if (!steps.length) return;
      session.applyEntries(steps);
      state = { ...state, history, doc: historyDocument(history), saved: false };
      ensureAssets(assetLoader);
      render();
      emit({ kind: "doc" });
    },
    redo() {
      const { history, steps } = redoStep(state.history);
      if (!steps.length) return;
      session.applyEntries(steps);
      state = { ...state, history, doc: historyDocument(history), saved: false };
      ensureAssets(assetLoader);
      render();
      emit({ kind: "doc" });
    },
    jump(target) {
      const { history, steps } = jumpTo(state.history, target);
      if (!steps.length) return;
      session.applyEntries(steps);
      state = { ...state, history, doc: historyDocument(history), saved: false };
      ensureAssets(assetLoader);
      render();
      emit({ kind: "doc" });
    },
    currentLabel: () => currentEntry(state.history).label,

    /* ------------------------------ итог -------------------------------- */

    /** Плоская картинка холста: `Blob` PNG (или другого типа). */
    exportBlob: async (type = "image/png", quality = undefined) => {
      /* Свой шрифт — на холст до итоговой картинки: в текстуре для игры не должно оказаться запасного. */
      const fonts = documentFonts(state.doc);
      if (fonts.some((asset) => !isEmblemFontReady(asset))) {
        await prepareOwnFonts(...fonts);
        render();
      }
      return exportBlob(compositor, type, quality);
    },

    /** Документ и растры для хранилища: `{ doc, rasters: { <ключ>: Blob } }`. */
    async save() {
      const rasters = {};
      for (const key of store.ids()) {
        const surface = store.get(key);
        const blob = typeof surface.canvas.convertToBlob === "function" ? await surface.canvas.convertToBlob({ type: "image/png" }) : await new Promise((resolve) => surface.canvas.toBlob(resolve, "image/png"));
        if (blob) rasters[key] = blob;
      }
      return { doc: serializeDocument(state.doc), rasters };
    },
    /** Открыть сохранённое: документ и растры слоёв. */
    async restore(saved) {
      const next = parseDocument(saved.doc);
      if (!next) return false;
      if (next.width !== state.doc.width || next.height !== state.doc.height) {
        store.resize(next.width, next.height);
        compositor.resize();
      }
      for (const [key, blob] of Object.entries(saved.rasters || {})) {
        const bitmap = await createImageBitmap(blob);
        store.clear(key);
        store.draw(key, bitmap, 0, 0);
        bitmap.close?.();
      }
      state = { ...state, doc: next, history: createHistory(next), selection: null, saved: true };
      ensureAssets(assetLoader);
      render();
      emit({ kind: "doc" });
      return true;
    },
    setNotice(notice) {
      state = { ...state, notice };
      emit({ kind: "notice" });
    },
    dispose() {
      closeHeavy();
      compositor.dispose();
      store.dispose();
      listeners.clear();
      for (const bitmap of assets.values()) bitmap?.close?.();
      assets.clear();
    },
  };
  return session;
}
