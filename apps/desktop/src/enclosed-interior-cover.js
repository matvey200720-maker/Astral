/*
 * Маппинг, закрытый оболочкой: кадр изнутри (13.11.2026, UZI PURPLE V2 REDUX · uzicasino: казино внутри глухого короба 149 × 129 × 16 м).
 *
 * Карты части ставят одну модель-короб (`fr_mj_cas_black_box`, двенадцать треугольников) и внутрь него — комнаты. Снаружи виден только короб, и обложка с галереей выходили серым
 * параллелепипедом на тёмном фоне. Владелец (13.11.2026): интерьер показывается ИЗНУТРИ, текстуры автора один в один. Здесь — как это узнаётся и снимается.
 *
 * Закрытая оболочка узнаётся по геометрии поставленных моделей, а не по именам. Поставленные картой модели читаются по картам части (`.ymap`) и типам (`.ytyp`: имя вещи → модель):
 *   • оболочка — крупная поставленная модель (больше `PROP_EXTENT` по земле), внутри которой лежат центры большинства остальных поставленных моделей (не меньше `ENCLOSED_SHARE`):
 *     центр каждой — не ближе `WALL_MARGIN` к стенке рамки (наложение на стену — не содержимое), а из центра луч вверх и не меньше трёх из четырёх лучей вбок упираются в её
 *     треугольники (крыша есть, стены есть; пола у здания может не быть). Двойник оболочки (та же рамка: уровень детализации `_lod`) содержимым не считается;
 *   • здание без оболочки, полотно на стене здания, один дом, земля с вещами сверху — оболочками не бывают, и такая часть снимается как раньше (`part-covers.js`).
 *
 * Снимается тем, что уже есть у интерьеров редукса (`redux-interior-cover.js`): сборка комнаты — здесь, ракурсы — `planInteriorViews` (глаз на полу под потолком, шестнадцать курсов,
 * мелкий z-буфер), кадры — съёмщик зала арены окна. Сцена — содержимое оболочки на тех местах, что поставили карты (поворот и масштаб — как у игры), листы — файлы автора и,
 * где у модели листа нет, штатные из игры; сама оболочка в сцену не идёт (камера внутри неё). Модели части, которых карты не ставят, в кадр не попадают: где они стоят, часть не говорит.
 * Нарисованного в кадре нет. Зал из нескольких крупных оболочек (комната — одна сетка на всё помещение) снимается с мягкими мерками (`ENCLOSED_RULES`).
 */

import * as placement from "@modovik/climb-contract/recolor/placement";
import { buildRaster, rasterize } from "./arena-view-plan.js";
import { PROP_EXTENT } from "./model-cover-plan.js";
import { isDrawn, modelFact, modelsScene } from "./mod-model-scene.js";
import { firstDrawable } from "./mod-place-scene.js";
import { joaat, readMapData, readMapTypes } from "./project-interiors/meta.js";
import { WINDOW_SCENE_MAX_BYTES } from "./project-interiors/scene.js";
import { encodeShopScene, entityDrawnInView } from "./recolor-shops-scene.js";
import {
  bareMaterials,
  interiorCover,
  solidsOf,
} from "./redux-interior-cover.js";
import { ROOM_RULES, planInteriorViews } from "./redux-interior-views.js";

const MODEL_FILE = /\.(ydr|yft)$/i;
const MAP_FILE = /\.ymap$/i;
const TYPES_FILE = /\.ytyp$/i;
const SHEETS_FILE = /\.ytd$/i;

/** Центр содержимого лежит от стенки рамки оболочки не ближе этого (м): модель на самой стене — наложение, а не содержимое. */
export const WALL_MARGIN = 1.5;
/** Доля прочих поставленных моделей, что лежит внутри оболочки, с которой она — «закрытая». */
export const ENCLOSED_SHARE = 0.6;
/** Сколько самых больших по объёму моделей проверяется как оболочка. */
const SHELL_CANDIDATES = 4;
/** Из четырёх лучей вбок в стену упираются не меньше стольких (вверх — обязательно). */
const SIDES_NEEDED = 3;
/** Две модели — двойники (рамки совпадают): центры и размеры различаются не больше чем на это (м) плюс доля размера. */
const TWIN_SLACK = 0.5;
const TWIN_SHARE = 0.05;
/** Больше такой доли непрозрачной поверхности зала без листа нигде — зал из болванок, кадр не выпускается (как у комнаты, `redux-interior-cover.js`). */
const MAX_BARE_SHARE = 0.2;
/** Не больше стольких карт-сущностей читается ради оболочки: у части с тысячами вещей (залазы, трава) оболочки нет, а чтение дорого. */
const PLACED_LIMIT = 4000;

const baseName = (name) =>
  String(name || "")
    .split(/[\\/]/)
    .pop();
const stemOf = (name) =>
  baseName(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "");
const sizeOf = (box) => box.max.map((value, axis) => value - box.min[axis]);
const centreOf = (box) =>
  box.min.map((value, axis) => (value + box.max[axis]) / 2);
const volumeOf = (box) =>
  sizeOf(box).reduce((product, value) => product * Math.max(value, 0), 1);

async function bytesOf(file) {
  const raw =
    file.bytes ?? (typeof file.read === "function" ? await file.read() : null);
  return raw?.length ? new Uint8Array(raw) : null;
}

/* ------------------------------------------------------------------ *
 * Что поставлено
 * ------------------------------------------------------------------ */

/** Рамка модели в мире (оси игры): восемь углов её рамки через место сущности (поворот и масштаб — как у игры). */
export function worldBox(fact, entity) {
  const move = placement.placementTransform(entity);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [fact.min[0], fact.max[0]])
    for (const y of [fact.min[1], fact.max[1]])
      for (const z of [fact.min[2], fact.max[2]])
        move([x, y, z]).forEach((value, axis) => {
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
        });
  return { min, max };
}

/**
 * Поставленные картами части модели: `[{ stem, file, entity, fact, box }]`. Вещь карты называет архетип (хеш имени); типы (`.ytyp`) говорят, какая модель за ним стоит
 * (`assetName`), а без типов модель — файл с тем же именем. Не берутся: сущности, что игра рисует только в тенях и отражениях, теневые прокси, вещи без модели в файлах части.
 * @param {{ name: string, bytes?: Uint8Array, read?: () => Promise<Uint8Array> }[]} files файлы части
 */
export async function readPlacements(files) {
  const named = (pattern) =>
    files.filter((file) => pattern.test(baseName(file.name)));
  const byHash = new Map();
  for (const file of named(MODEL_FILE)) {
    const hash = joaat(stemOf(file.name)) >>> 0;
    if (!byHash.has(hash)) byHash.set(hash, file);
  }
  const types = new Map();
  for (const file of named(TYPES_FILE)) {
    try {
      for (const archetype of readMapTypes(await bytesOf(file)).archetypes)
        if (!types.has(archetype.name >>> 0))
          types.set(archetype.name >>> 0, archetype);
    } catch {
      /* битые или нечитаемые типы: вещи этого файла найдутся по имени модели */
    }
  }
  const facts = new Map();
  const factOf = async (file) => {
    if (!facts.has(file)) {
      const bytes = await bytesOf(file).catch(() => null);
      facts.set(file, bytes ? modelFact(baseName(file.name), bytes) : null);
    }
    return facts.get(file);
  };
  const placed = [];
  /* Вещи карт, у которых модели в файлах части нет (штатные пропсы игры): хеш имени → сколько раз. */
  placed.noModel = new Map();
  for (const file of named(MAP_FILE)) {
    let entities = [];
    try {
      entities = readMapData(await bytesOf(file)).entities;
    } catch {
      continue;
    }
    for (const entity of entities) {
      if (placed.length >= PLACED_LIMIT) return placed;
      if (!entityDrawnInView(entity.flags)) continue;
      const type = types.get(entity.archetype >>> 0);
      if (type && placement.isShadowProxy(type)) continue;
      const model =
        byHash.get((type?.assetName || entity.archetype) >>> 0) ||
        byHash.get(entity.archetype >>> 0);
      const fact = model ? await factOf(model) : null;
      if (!fact) {
        const hash = (type?.assetName || entity.archetype) >>> 0;
        placed.noModel.set(hash, (placed.noModel.get(hash) || 0) + 1);
      }
      if (fact)
        placed.push({
          stem: stemOf(fact.name),
          file: model,
          entity,
          fact,
          box: worldBox(fact, entity),
        });
    }
  }
  return placed;
}

/* ------------------------------------------------------------------ *
 * Закрытая оболочка
 * ------------------------------------------------------------------ */

/** Двойники: рамки почти совпадают (модель и её копия уровня детализации стоят в одном месте). */
export function sameBox(one, other) {
  const [sizeOne, sizeOther] = [sizeOf(one), sizeOf(other)];
  const [centreOne, centreOther] = [centreOf(one), centreOf(other)];
  return [0, 1, 2].every((axis) => {
    const big = Math.max(sizeOne[axis], sizeOther[axis]);
    return (
      Math.abs(centreOne[axis] - centreOther[axis]) <=
        TWIN_SLACK + TWIN_SHARE * big &&
      Math.abs(sizeOne[axis] - sizeOther[axis]) <= TWIN_SLACK + TWIN_SHARE * big
    );
  });
}

/** Центр рамки лежит внутри рамки оболочки не ближе `WALL_MARGIN` к любой стенке. */
export function wellInside(box, shell) {
  return centreOf(box).every(
    (value, axis) =>
      value >= shell.min[axis] + WALL_MARGIN &&
      value <= shell.max[axis] - WALL_MARGIN,
  );
}

/** Луч из `origin` по `direction` упирается хотя бы в один треугольник сеток `meshes` (`{ positions, indices }` в осях мира; грань любой стороной). */
export function rayHits(origin, direction, meshes) {
  for (const { positions, indices } of meshes)
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      const e1x = positions[b] - positions[a];
      const e1y = positions[b + 1] - positions[a + 1];
      const e1z = positions[b + 2] - positions[a + 2];
      const e2x = positions[c] - positions[a];
      const e2y = positions[c + 1] - positions[a + 1];
      const e2z = positions[c + 2] - positions[a + 2];
      const px = direction[1] * e2z - direction[2] * e2y;
      const py = direction[2] * e2x - direction[0] * e2z;
      const pz = direction[0] * e2y - direction[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const sx = origin[0] - positions[a];
      const sy = origin[1] - positions[a + 1];
      const sz = origin[2] - positions[a + 2];
      const u = (sx * px + sy * py + sz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v =
        (direction[0] * qx + direction[1] * qy + direction[2] * qz) / det;
      if (v < 0 || u + v > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) / det > 1e-3) return true;
    }
  return false;
}

const UP = [0, 0, 1];
const SIDES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];

/** Оболочка стоит вокруг точки: над ней крыша, а из четырёх сторон стена — не меньше `SIDES_NEEDED` (пола у здания может не быть). */
export function wallsAround(point, skin) {
  return (
    rayHits(point, UP, skin) &&
    SIDES.filter((direction) => rayHits(point, direction, skin)).length >=
      SIDES_NEEDED
  );
}

/* Двойники друг друга в списке содержимого: остаётся тот, что тяжелее (больше треугольников). */
function withoutTwins(items) {
  const kept = [];
  for (const item of [...items].sort(
    (left, right) => right.fact.triangles - left.fact.triangles,
  ))
    if (!kept.some((other) => sameBox(other.box, item.box))) kept.push(item);
  return kept;
}

/**
 * Закрытая оболочка среди поставленных моделей: `{ shell, contents, twins, others }` или `null`.
 * @param {{ stem: string, box: { min: number[], max: number[] }, fact: { triangles: number } }[]} placed `readPlacements`
 * @param {(item: object) => Promise<{ positions: ArrayLike<number>, indices: ArrayLike<number> }[]>} skinOf треугольники модели в мире (читаются только у кандидатов)
 */
export async function findEnclosure(placed, skinOf) {
  const roomy = placed.filter(
    (item) => Math.max(...sizeOf(item.box).slice(0, 2)) > PROP_EXTENT,
  );
  const candidates = [...roomy]
    .sort((left, right) => volumeOf(right.box) - volumeOf(left.box))
    .slice(0, SHELL_CANDIDATES);
  for (const shell of candidates) {
    const twins = placed.filter(
      (item) => item !== shell && sameBox(item.box, shell.box),
    );
    const others = placed.filter(
      (item) => item !== shell && !twins.includes(item),
    );
    const needed = Math.max(1, Math.ceil(ENCLOSED_SHARE * others.length));
    const near = others.filter((item) => wellInside(item.box, shell.box));
    if (near.length < needed) continue;
    const skin = await skinOf(shell);
    if (!skin.length) continue;
    const walled = near.filter((item) => wallsAround(centreOf(item.box), skin));
    if (walled.length < needed) continue;
    return {
      shell,
      contents: withoutTwins(walled),
      twins,
      others: others.length,
      noModel: placed.noModel || new Map(),
    };
  }
  return null;
}

/** Треугольники модели в мире (оси игры): сетки, что рисуются, через место сущности. */
export async function worldSkin(file, entity) {
  const bytes = await bytesOf(file).catch(() => null);
  const drawable = bytes ? firstDrawable(bytes) : null;
  if (!drawable) return [];
  const move = placement.placementTransform(entity);
  return drawable.meshes.filter(isDrawn).map((mesh) => {
    const positions = new Float32Array(mesh.positions.length);
    for (let at = 0; at + 2 < positions.length; at += 3)
      positions.set(
        move([
          mesh.positions[at],
          -mesh.positions[at + 2],
          mesh.positions[at + 1],
        ]),
        at,
      );
    return { positions, indices: mesh.indices };
  });
}

/* ------------------------------------------------------------------ *
 * Модели комнат, которых карты автора не ставят
 * ------------------------------------------------------------------ */

/** Модель комнатного масштаба: по земле не меньше стольких метров. Меньше — мебель и мелочь: у неё своё место, а его карты автора не называют. */
export const ROOM_SCALE = 8;
/** Модель комнаты не выходит за оболочку своей комнаты больше чем на столько метров (иначе она не «в осях комнаты»). */
const FIT_SLACK = 2;
/** Не рисуются как комната: тени, подделки-заглушки, двойники оболочек. */
const NOT_ROOM = /shadow|fake|black_box|_lod$|collision/;
/** Какой комнате принадлежит модель по имени: `[комната, признак в имени]`. Первое совпадение. */
const ROOM_OF = [
  ["black_jack", /black_?jack|_black_|det_black|dec_black|rams_black/],
  ["roullet", /roul/],
  ["horse", /horse/],
  ["poker", /poker/],
  ["vip", /vip/],
  ["gambling_lobby", /gambling|_gam_|^gam_|diamonds_gam|luckywheel/],
  ["lobby", /lobby/],
];

const horizontal = (fact) =>
  Math.max(fact.max[0] - fact.min[0], fact.max[1] - fact.min[1]);

/** Какая это комната, по имени (`fr_mj_cas_shell_poker_lod` → `poker`). */
export function shellRoom(stem) {
  return ROOM_OF.find(([, pattern]) => pattern.test(stem))?.[0] ?? "";
}

/**
 * Модели части, которых карты не ставят: комнатные (HD-слой комнат: декор, подсветка, рамы, картины) стоят в осях своей комнаты — их центр на нуле, как у оболочки, — и ставятся на
 * место оболочки той же комнаты. Остальное — мебель и мелочь без расстановки — в сцену не идёт, и это называется словами (`unplaced`), а не молчит.
 * @returns {{ items: object[], unplaced: { stem: string, why: string }[] }}
 */
export async function attachRoomModels(files, found) {
  const taken = new Set([
    ...found.contents.map((item) => item.file),
    found.shell.file,
    ...found.twins.map((item) => item.file),
  ]);
  const items = [];
  const unplaced = [];
  for (const file of files.filter((one) =>
    MODEL_FILE.test(baseName(one.name)),
  )) {
    if (taken.has(file)) continue;
    const stem = stemOf(file.name);
    if (NOT_ROOM.test(stem)) continue;
    const bytes = await bytesOf(file).catch(() => null);
    const fact = bytes ? modelFact(baseName(file.name), bytes) : null;
    if (!fact) {
      unplaced.push({
        stem,
        why: "нет рисуемых сеток (наклейка или тень) либо файл не читается",
      });
      continue;
    }
    const room = shellRoom(stem);
    const shell = room
      ? found.contents.find((item) => shellRoom(item.stem) === room)
      : null;
    if (!shell) {
      unplaced.push({
        stem,
        why: room
          ? "оболочки этой комнаты в карте нет"
          : "комната не названа в имени",
      });
      continue;
    }
    if (horizontal(fact) < ROOM_SCALE) {
      unplaced.push({
        stem,
        why: "мебель или мелочь: места в комнате карты автора не называют",
      });
      continue;
    }
    const inside = sizeOf(shell.box);
    if (horizontal(fact) > Math.max(inside[0], inside[1]) + FIT_SLACK) {
      unplaced.push({ stem, why: "больше оболочки своей комнаты" });
      continue;
    }
    items.push({
      stem,
      file,
      entity: shell.entity,
      fact,
      box: worldBox(fact, shell.entity),
      room,
    });
  }
  return { items, unplaced };
}

/** Закрытая оболочка части: читает поставленное и ищет её (`null` — часть не закрыта, снимается как раньше). */
export async function enclosureOfPart(files) {
  const placed = await readPlacements(files);
  if (placed.length < 2) return null;
  return findEnclosure(placed, (item) => worldSkin(item.file, item.entity));
}

/* ------------------------------------------------------------------ *
 * Зал
 * ------------------------------------------------------------------ */

/** Мерки ракурсов зала: комната — одна сетка на всё помещение, потолок высокий (выше оболочки он быть не может — `ceilingMax` берётся по её высоте). */
export const ENCLOSED_RULES = Object.freeze({
  minStems: 1,
  topStem: 1,
  ceilingMax: ROOM_RULES.ceilingMax,
});

/** Мест для глаз на зал: комнат несколько, а мест по умолчанию шестьдесят делятся по площади — все лучшие кадры доставались самой большой комнате. */
const ENCLOSED_EYES = 180;

/** В какой комнате стоит глаз: модель под ним (мелкий кадр прямо вниз) — у зала из оболочек комнату называет её оболочка. */
export function roomUnder(raster, pose) {
  const shot = rasterize(
    raster,
    { eye: pose.eye, yaw: 0, pitch: -1.5, fov: 20 },
    { width: 3, height: 3 },
  );
  const hit = shot.hit[4];
  return hit >= 0 ? raster.meta[hit].stem : "";
}

const refuse = (refusal) => ({ refusal });

/**
 * Сцена зала из содержимого оболочки: `{ bytes, sheets, solids, ownStems, bareNames, rooms, report, rules }` или `{ refusal }` (то, что берёт `interiorCover` как сборку комнаты).
 * Содержимое стоит на местах карт (поворот и масштаб игры), сцена сдвинута к центру оболочки; сама оболочка в сцену не идёт — камера внутри неё.
 * @param {{ files: { name: string, bytes: Uint8Array }[], found: { shell: object, contents: object[] }, fill?: Function|null }} input
 */
export async function buildEnclosedHall({ files, found, fill = null }) {
  const centre = centreOf(found.shell.box);
  const items = [...found.contents, ...(found.attached || [])].map(
    ({ file, entity }) => {
      const shifted = {
        ...entity,
        position: entity.position.map((value, axis) => value - centre[axis]),
      };
      /* `exact` — лист автора как есть, без подтяжки тёмного: экспозицию кадра выбирает окно, а текстуру автора менять нельзя. */
      return {
        name: file.name,
        move: placement.placementTransform(shifted),
        turn: placement.placementRotation(entity),
        exact: true,
      };
    },
  );
  const built = await modelsScene({
    files,
    plan: { items },
    fill,
    asScene: true,
  });
  if (!built?.scene)
    return refuse(
      "из моделей, что стоят внутри оболочки, не вышло ни одной сетки",
    );
  const { scene } = built;
  /* Чья сетка: по порядку добавления (`spans`). Накладка без листа (стекло, наклейка) серым пятном в кадре — её сетки не берутся; корпус без листа остаётся и считается. */
  const owner = [];
  for (const span of built.spans)
    for (let at = span.from; at < span.to; at += 1)
      owner[at] = stemOf(span.name);
  const { bare, names: bareNames } = bareMaterials(scene);
  const kept = [];
  scene.meshes.forEach((mesh, at) => {
    const material = scene.materials[mesh.material];
    if (!(
      bare.has(mesh.material) &&
      (material.alpha === "blend" || material.decal)
    ))
      kept.push(at);
  });
  scene.meshes = kept.map((at) => scene.meshes[at]);
  const stems = kept.map((at) => owner[at] || "model");
  if (!scene.meshes.length)
    return refuse(
      "из моделей, что стоят внутри оболочки, не вышло ни одной сетки",
    );
  const surface = { opaque: 0, all: 0 };
  for (const mesh of scene.meshes) {
    const material = scene.materials[mesh.material];
    if (material.alpha === "blend" || material.decal) continue;
    const triangles = mesh.indices.length / 3;
    surface.all += triangles;
    if (bare.has(mesh.material)) surface.opaque += triangles;
  }
  if (surface.all && surface.opaque > surface.all * MAX_BARE_SHARE)
    return refuse(
      `у ${Math.round((surface.opaque / surface.all) * 100)}% поверхностей зала нет листа ни у автора, ни в игре: ${bareNames.slice(0, 8).join(", ")}`,
    );
  const bytes = encodeShopScene(scene);
  if (bytes.byteLength > WINDOW_SCENE_MAX_BYTES)
    return refuse(
      `зал слишком тяжёлый для кадра: ${Math.round(bytes.byteLength / 1048576)} МБ`,
    );
  /* Те же сетки для ракурсов: `solidsOf` берёт модель сетки из `parts[сетка.part]`, а болванки — из таблицы номеров материалов. */
  const solids = solidsOf(
    {
      meshes: scene.meshes.map((mesh, at) => ({ ...mesh, part: at })),
      materials: scene.materials,
      parts: stems.map((model) => ({ model })),
    },
    bare,
  );
  const height = sizeOf(found.shell.box)[2];
  return {
    bytes: new Uint8Array(bytes),
    sheets: built.sheets,
    solids,
    ownStems: [...new Set(stems)],
    bareNames,
    rooms: [],
    rules: {
      ...ENCLOSED_RULES,
      ceilingMax: Math.max(ENCLOSED_RULES.ceilingMax, Math.ceil(height)),
    },
    report: {
      shell: found.shell.stem,
      contents: found.contents.map((item) => item.stem),
      attached: (found.attached || []).map((item) => item.stem),
      twins: found.twins.map((item) => item.stem),
      meshes: scene.meshes.length,
      sheets: built.sheets.length,
      textured: built.textured,
      filled: built.filled,
      bare: built.bare,
      bareSheets: bareNames,
    },
  };
}

/**
 * Обложка и галерея закрытого маппинга изнутри: `{ png, caption, gallery }` (кадры галереи — `{ bytes, caption }`), `{ png: null, why }` — оболочка есть, а снять не вышло
 * (причина словами идёт в журнал печи), `null` — оболочки у части нет (вызывающий снимает её как раньше).
 * `files` — файлы части `[{ name, bytes | read }]`, `fill` — листы игры тем, чего у автора нет (`modelsScene`), остальное — как у `interiorCover`.
 */
export async function enclosedCover({
  files,
  name = "",
  render,
  source = null,
  fill = null,
  onGallery = null,
  onStaged = null,
  deps = {},
}) {
  const say = deps.debug || (() => {});
  /* Не прочиталось поставленное — оболочки «нет», часть снимается как раньше; сбой съёмки ниже наружу идёт как сбой. */
  const found = await enclosureOfPart(files).catch((failure) => {
    say(
      name,
      "закрытая оболочка не искалась:",
      String(failure?.message || failure),
    );
    return null;
  });
  if (!found) return null;
  say(
    name,
    "закрытая оболочка:",
    found.shell.stem,
    "внутри",
    found.contents.length,
    "из",
    found.others,
    "поставленных:",
    found.contents.map((item) => item.stem).join(", "),
  );
  const extra = await attachRoomModels(files, found).catch((failure) => {
    say(
      name,
      "комнатные модели не привязаны:",
      String(failure?.message || failure),
    );
    return { items: [], unplaced: [] };
  });
  found.attached = extra.items;
  say(
    name,
    "привязано к комнатам:",
    extra.items.length,
    "·",
    extra.items.map((item) => `${item.stem}→${item.room}`).join(", "),
  );
  /* Не названное словами не пропускается: что осталось без места и почему — в журнал. */
  say(
    name,
    "без места (карты автора его не называют):",
    extra.unplaced.length,
    "·",
    extra.unplaced.map((item) => `${item.stem} [${item.why}]`).join("; "),
  );
  say(
    name,
    "вещи карт без модели в файлах части (штатные пропсы игры):",
    found.noModel.size,
    "·",
    [...found.noModel]
      .map(([hash, count]) => `${(hash >>> 0).toString(16)}×${count}`)
      .join(", "),
  );
  const needed = new Set(
    [...found.contents, ...found.attached].map((item) => item.file),
  );
  const room = files.filter(
    (file) => needed.has(file) || SHEETS_FILE.test(baseName(file.name)),
  );
  let rules = ENCLOSED_RULES;
  const shot = await interiorCover({
    files: room,
    name,
    render,
    source,
    onGallery,
    onStaged,
    deps: {
      ...deps,
      hall: async (input) => {
        const hall = await buildEnclosedHall({
          files: input.files,
          found,
          fill,
        });
        if (hall.rules) rules = hall.rules;
        /* Строка счётчиков, как у интерьеров MLO (`missingModels` — модели автора без места в карте, список выше). */
        if (hall.report)
          say(
            name,
            "комната:",
            JSON.stringify({
              entities: found.contents.length + found.attached.length,
              noModel: [...found.noModel.values()].reduce(
                (sum, count) => sum + count,
                0,
              ),
              missingModels: extra.unplaced.length,
              sheets: hall.report.sheets,
              lostSheets: hall.report.bareSheets.length,
              bareSheets: hall.report.bareSheets,
              textured: hall.report.textured,
              filled: hall.report.filled,
              bare: hall.report.bare,
            }),
          );
        return hall;
      },
      plan: (input) => {
        const raster = buildRaster(
          (input.solids || []).filter(
            (solid) => !solid.blend && solid.indices?.length,
          ),
        );
        return planInteriorViews({
          ...input,
          rules,
          eyes: ENCLOSED_EYES,
          groupOf: (pose) => roomUnder(raster, pose),
        });
      },
    },
  });
  if (!shot.png) return shot;
  return {
    ...shot,
    gallery: (shot.gallery || []).map((bytes) => ({
      bytes,
      caption: shot.caption,
    })),
  };
}
