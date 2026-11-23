/*
 * Предметы сцены в кадре — общее у редакторов с панелью «Предметы» (ТЗ владельца 26.10.2026, п. A): рамки вещей по номеру
 * сущности, описание подсветки «ровно этой вещи», охват выбора по описи, куда лететь камере. Чистые функции без React и
 * three: их берут кадры (что обвести под курсором и после щелчка), панель и тесты.
 *
 * Сетка сцены версии 2 несёт номер вещи (`mesh.entity`): по нему кадр знает, чья вещь под лучом, а подсветка
 * (`selection-highlight.js`, поле `where`) обводит только сетки с нужными номерами — соседняя вещь той же модели и тот же
 * лист у другой вещи в рамку не попадают. Арены (`arena-editor/arena-items.js`) берут отсюда рамки и подсветку и добавляют своё
 * (части экрана и корпуса, оболочка зала, перелёт камеры внутри зала); маппинг и мегамолл — как есть.
 */

import { focusFrame } from "../model-stage/focus-frame.js";

/* Рамки сцены: `WeakMap(сцена → { out, cursor })` — подсчёт идёт по сеткам и может остановиться посередине (прогрев в простое). */
const cache = new WeakMap();
/* Сколько логических сеток подсветка берёт: у одной вещи их единицы, у «всех таких» — вся тысяча семьсот. */
const ONE_LIMIT = 900;
const ALL_LIMIT = 4000;

/* Точка на самой вещи ближе всего к середине её рамки: считается по первому вопросу (одна вещь — единицы сеток), а не для всей сцены. */
function anchorOf(box) {
  const middle = [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2);
  let best = null;
  let bestGap = Infinity;
  for (const mesh of box.meshes) {
    const at = mesh.positions;
    for (let index = 0; index < at.length; index += 3) {
      const gap = (at[index] - middle[0]) ** 2 + (at[index + 1] - middle[1]) ** 2 + (at[index + 2] - middle[2]) ** 2;
      if (gap < bestGap) {
        bestGap = gap;
        best = [at[index], at[index + 1], at[index + 2]];
      }
    }
  }
  return best;
}

function newBox() {
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], textures: new Set(), meshes: [] };
  let anchor;
  /* Якорь считается лениво и один раз: нужен «Найти» и перелёту камеры, а не всем вещам сцены сразу. */
  Object.defineProperty(box, "anchor", {
    enumerable: true,
    get() {
      if (anchor === undefined) anchor = anchorOf(box);
      return anchor;
    },
  });
  return box;
}

function stateOf(asset) {
  let state = cache.get(asset);
  if (!state) {
    state = { out: new Map(), cursor: 0 };
    cache.set(asset, state);
  }
  return state;
}

/* Подсчёт рамок от места, где остановились, до конца сеток или до `until` (миллисекунды по `performance.now`). Возвращает, дошёл ли до конца. */
function advance(asset, state, until = Infinity) {
  const meshes = asset.meshes || [];
  const { out } = state;
  while (state.cursor < meshes.length) {
    if (until !== Infinity && performance.now() > until) return false;
    const mesh = meshes[state.cursor];
    state.cursor += 1;
    if (!Number.isInteger(mesh.entity)) continue;
    let box = out.get(mesh.entity);
    if (!box) {
      box = newBox();
      out.set(mesh.entity, box);
    }
    box.meshes.push(mesh);
    const name = asset.materials?.[mesh.material]?.name;
    if (name) box.textures.add(name);
    const at = mesh.positions;
    const [minX, minY, minZ] = box.min;
    const [maxX, maxY, maxZ] = box.max;
    let [lowX, lowY, lowZ, highX, highY, highZ] = [minX, minY, minZ, maxX, maxY, maxZ];
    for (let index = 0; index < at.length; index += 3) {
      const x = at[index];
      const y = at[index + 1];
      const z = at[index + 2];
      if (x < lowX) lowX = x;
      if (x > highX) highX = x;
      if (y < lowY) lowY = y;
      if (y > highY) highY = y;
      if (z < lowZ) lowZ = z;
      if (z > highZ) highZ = z;
    }
    box.min = [lowX, lowY, lowZ];
    box.max = [highX, highY, highZ];
  }
  return true;
}

/**
 * Рамки сущностей сцены: `Map(номер → { min, max, textures, meshes, anchor })` — рамка в метрах сцены, имена листов (`Set`), сетки вещи и точка
 * на самой вещи ближе всего к середине рамки (у дуги середина рамки — в пустоте, глядеть надо на саму вещь; считается при первом
 * обращении к `anchor`). Считается один раз на сцену (`WeakMap`), сетки без номера пропускаются. Прогрев в простое
 * (`warmEntityBounds`) мог посчитать часть — недостающее досчитывается здесь же.
 */
export function entityBounds(asset) {
  if (!asset) return new Map();
  const state = stateOf(asset);
  advance(asset, state);
  return state.out;
}

/**
 * Прогреть рамки вещей, пока окно простаивает (ТЗ 26.10.2026: первый щелчок по вещи арены ждал 155–260 мс на подсчёт рамок всей сцены).
 * Считает кусками по несколько миллисекунд между кадрами; щелчок, пришедший раньше, досчитывает остаток сам. Возвращает отмену.
 */
export function warmEntityBounds(asset, { slice = 6, schedule = scheduleIdle } = {}) {
  if (!asset?.meshes?.length) return () => {};
  const state = stateOf(asset);
  let live = true;
  let cancel = () => {};
  const step = (deadline) => {
    if (!live) return;
    const room = typeof deadline?.timeRemaining === "function" ? Math.min(slice, Math.max(1, deadline.timeRemaining())) : slice;
    if (!advance(asset, state, performance.now() + room)) cancel = schedule(step);
  };
  cancel = schedule(step);
  return () => {
    live = false;
    cancel();
  };
}

function scheduleIdle(callback) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: 1500 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(() => callback(null), 16);
  return () => clearTimeout(id);
}

/** Общая рамка нескольких сущностей (`null`, если у них нет сеток в сцене). */
export function boundsOfEntities(asset, keys) {
  const all = entityBounds(asset);
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let any = false;
  for (const key of keys) {
    const one = all.get(key);
    if (!one) continue;
    any = true;
    for (let axis = 0; axis < 3; axis += 1) {
      box.min[axis] = Math.min(box.min[axis], one.min[axis]);
      box.max[axis] = Math.max(box.max[axis], one.max[axis]);
    }
  }
  return any ? box : null;
}

/**
 * Что подсветить: сетки сущностей из `entities` (`Set` номеров) — описание для кадра (`ModelStage highlight` и `aimTarget`).
 * Берутся логические сетки сцены (`logical`): пачки, что рисуются, склеивают вещи одного листа, и обвод по пачке задел бы всех
 * соседей. Обводится сам силуэт вещи — и у одной, и у «всех таких». `extra(info, mesh)` — своё условие поверх номера
 * (арены: часть экрана или корпуса, материал стены). Пустое множество — нечего обводить.
 */
export function itemSpec(entities, asset = null, scope = "one", extra = null) {
  if (!entities || !entities.size) return { none: true };
  /* Сущностей нет в сцене — обводить нечего. */
  if (scope !== "one" && !asset?.meshes?.some((mesh) => entities.has(mesh.entity))) return { none: true };
  return {
    logical: true,
    /* Вещь со своей картинкой, цветом или моделью стоит копией — объектом кадра с `userData.pick = { kind: "item", key }`, а её сетки сцены спрятаны:
       обводится копия (владелец 01.11.2026: «монитор со своей картинкой выбран, а в кадре не обведён»). */
    withObjects: true,
    /* Выбор вещи держится видимым (не вспышка): вид и контур остаются, пока выбрано. */
    steady: true,
    limit: scope === "one" ? ONE_LIMIT : ALL_LIMIT,
    where: (info, mesh) => {
      const pick = mesh.userData.pick;
      if (pick) return pick.kind === "item" && entities.has(pick.key) && (!extra || extra(null, mesh));
      return entities.has(mesh.userData.entity) && (!extra || extra(info, mesh));
    },
  };
}

/**
 * Номера вещей, что заденет описание подсветки `spec` (группа инструмента: «Реквизит», «Корпуса»): шапка группы пишет, сколько их
 * («Реквизит · 38 вещей», п. 7 `docs/3D-ELEMENTS-PICTURES.md`). Считает по загруженной сцене, без кадра; нет сцены или условия — пусто.
 */
export function groupKeys(asset, spec) {
  const keys = new Set();
  if (!asset?.meshes || !spec || spec.none) return keys;
  const materials = spec.materials ? new Set(spec.materials) : null;
  const parts = spec.parts ? new Set(spec.parts) : null;
  for (const mesh of asset.meshes) {
    if (!Number.isInteger(mesh.entity)) continue;
    if (materials && !materials.has(mesh.material)) continue;
    if (parts && !parts.has(mesh.part)) continue;
    if (spec.where && !spec.where(asset.materials?.[mesh.material] || null, { userData: { material: mesh.material, part: mesh.part, entity: mesh.entity } })) continue;
    keys.add(mesh.entity);
  }
  return keys;
}

/**
 * Номера вещей под охват выбора по описи `objects` (`sceneInventory`): «этот» — вещь, «в комнате» — вещи той же модели в той
 * же комнате, «во всём» — вещи той же модели по всей сцене, «род» — все вещи того же рода разметки (кнопка «Выбрать все такие»).
 * Неизвестный номер — пустое множество.
 */
export function sceneItemScope(objects, key, scope = "one") {
  const item = objects?.byKey.get(key);
  if (!item) return new Set();
  const model = objects.models[item.model];
  if (scope === "kind") return new Set(model.selectionKind ? objects.byKind.get(model.selectionKind) : [key]);
  if (scope === "arena") return new Set(model.keys);
  if (scope === "room") return new Set(objects.items.filter((entry) => entry.model === item.model && entry.room === item.room).map((entry) => entry.key));
  return new Set([key]);
}

/**
 * Откуда по умолчанию смотрит кадр сцены под открытым небом (маппинг, здания): точка далеко в стороне взгляда `yaw` от середины
 * сцены. Снимки плиток встают с этой же стороны — вещи на плитках видны так, как их видно в кадре. `null` — сцены нет.
 */
export function viewHome(asset, yaw, distance = 500) {
  if (!asset?.bounds) return null;
  const middle = [0, 1, 2].map((axis) => (asset.bounds.min[axis] + asset.bounds.max[axis]) / 2);
  return [middle[0] + Math.sin(yaw) * distance, middle[1] - Math.cos(yaw) * distance, middle[2]];
}

/**
 * Рамка кадра, что держит одну вещь в середине (`setFrame` у `orbit-stage.js`, камера летит из нынешнего места): центр вращения —
 * на вещи (у дуги — на самой вещи, `anchor`), приближение — по её размеру относительно всей сцены. Пол и размах — сцены, чтобы кадр не
 * менял её плашку под вещью. `box` — своя рамка (часть вещи, `scene-parts.js`), иначе рамка вещи. `null` — вещи нет в сцене.
 */
export function itemFrame(asset, key, { yaw = -0.62, pitch = 0.4, box: given = null } = {}) {
  const box = given || entityBounds(asset).get(key);
  if (!box || !asset?.bounds) return null;
  const size = (axis) => box.max[axis] - box.min[axis];
  const diagonal = Math.hypot(size(0), size(1), size(2));
  const whole = Math.hypot(...[0, 1, 2].map((axis) => asset.bounds.max[axis] - asset.bounds.min[axis])) || 1;
  const centre = diagonal <= 7 && box.anchor ? box.anchor : [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2);
  /* Вещь целиком в кадре — общим фокусом (`model-stage/focus-frame.js`): около четырёх метров у вещи обычного размера, крупная — целиком,
     мелкая — ближе, но не вплотную; кадр проверит линию взгляда и подойдёт ближе или выше, если вещь закрыта. */
  const focused = focusFrame({ point: centre, size: [size(0), size(1), size(2)], yaw, pitch }, asset.bounds);
  if (focused) return { bounds: asset.bounds, ground: true, ...focused, glide: true };
  /* Без точки (сетка без вершин) — прежняя доля сцены. */
  const zoom = Math.max(0.04, Math.min(0.6, (diagonal / whole) * 1.6 + 0.03));
  return { bounds: asset.bounds, ground: true, centre, view: { yaw, pitch, zoom }, glide: true };
}
