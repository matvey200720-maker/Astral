// Части вещей сцены для панели «Предметы» и кадра: подписи, щелчок, подсветка, видимость.
import { tr } from "../../../locales/ui.js";
import { itemSurfacePoints } from "./items-focus.js";
import { entityBounds } from "./items-frame.js";
import { itemPartsOf, partAt } from "./item-parts.js";

const SEEN_SLACK = 0.05;
const SPEC_BASE = Object.freeze({ logical: true, steady: true });
const never = () => false;

// Слабые таблицы: память уходит вместе со сценой и частями.
const viewsByParts = new WeakMap();
const numbersByScene = new WeakMap();
const anchorsByPart = new WeakMap();
let scenesNumbered = 0;

// Значение, посчитанное один раз на ключ (в том числе null); ключ-не-объект — TypeError таблицы.
const remember = (table, key, make) => (table.has(key) ? table.get(key) : table.set(key, make()).get(key));

// ── вид частей ──

// Поле вида -> как оно берётся из части потока; подпись добавляется отдельно, на чтении.
const VIEW_FIELDS = {
  index: (part) => part.index,
  triangles: (part) => part.triangles,
  runs: (part) => part.runs,
  own: (part) => part.own || part.runs,
  box: (part) => part.box ?? null,
  sceneBox: ({ min, max }) => ({ min, max }),
};

function viewOf(part) {
  const view = {};
  for (const [name, read] of Object.entries(VIEW_FIELDS)) view[name] = read(part);
  return Object.defineProperty(view, "label", {
    get: () => tr("Часть {0}").replace("{0}", part.index + 1),
    enumerable: true,
    configurable: true,
  });
}

export const scenePartsOf = (asset, key, place = null) => {
  const parts = asset && Number.isInteger(key) ? itemPartsOf(asset, key, place) : [];
  if (parts === null) return null;
  return parts.length > 1 ? remember(viewsByParts, parts, () => parts.map((part) => viewOf(part))) : [];
};

// ── щелчок ──

// Щелчок не про части: нет попадания, двойной щелчок, плашка кадра, номер вещи не целый.
const clickIgnored = (hit) => !hit || Boolean(hit.whole || hit.pick) || !Number.isInteger(hit.entity);

export function partAtHit(parts, hit) {
  const found = parts?.length && !clickIgnored(hit) ? partAt(parts, hit.meshIndex, hit.faceIndex) : -1;
  return found >= 0 ? found : null;
}

// ── подсветка ──

function sceneNumber(asset) {
  const known = numbersByScene.get(asset);
  if (known !== undefined) return known;
  numbersByScene.set(asset, scenesNumbered + 1); // не объект — TypeError, счётчик тогда не двигается
  scenesNumbered += 1;
  return scenesNumbered;
}

const runsKeyOf = (asset, key, part) => `item-part:${sceneNumber(asset)}:${key}:${part.index}`;

export const partSpec = (asset, key, part) =>
  part ? { ...SPEC_BASE, runs: part.runs, runsKey: runsKeyOf(asset, key, part), where: never } : null;

// ── рамка цели ──

const boundsOf = (asset, key) => (asset ? (entityBounds(asset).get(key) ?? null) : null);

export const targetBox = (asset, key, part = null) => (part ? part.sceneBox : boundsOf(asset, key));

const centerOf = ({ min, max }) => Array.from({ length: 3 }, (_, axis) => (min[axis] + max[axis]) / 2);

// ── видно ли выбранное ──

const triples = (list) =>
  Array.from({ length: Math.floor(list.length / 3) }, (_, at) => [list[at * 3], list[at * 3 + 1], list[at * 3 + 2]]);

// Вершины треугольников островов части (тройки «сетка, от, до»); нет сетки — тройка пропускается.
function* islandSpots(meshes, spans) {
  for (const [meshAt, from, to] of triples(spans)) {
    const mesh = meshes[meshAt];
    if (!mesh) continue;
    for (let slot = from * 3; slot < to * 3; slot += 1) {
      const base = mesh.indices[slot] * 3;
      yield [0, 1, 2].map((axis) => mesh.positions[base + axis]);
    }
  }
}

// Ближайшая к `goal` точка из потока; при равных остаётся первая.
function nearestSpot(spots, goal) {
  let best = { sq: Infinity, spot: null };
  for (const spot of spots) {
    const sq = spot.reduce((sum, value, axis) => {
      const d = value - goal[axis];
      return sum + d * d;
    }, 0);
    if (sq < best.sq) best = { sq, spot };
  }
  return best.spot;
}

const partAnchor = (asset, part, box) =>
  remember(anchorsByPart, part, () => nearestSpot(islandSpots(asset.meshes, part.own), centerOf(box)));

// Луч до точки чист, если не задел ничего, плашку, саму вещь или чужую вещь, не заслоняющую точку.
const pathClear = ({ hit, depth, hitDepth }, key) =>
  !hit || Boolean(hit.pick) || hit.entity === key || hitDepth >= depth - SEEN_SLACK;

// Ответ кадра: ничего — видна; вне кадра (или ответ без inside) — нет; иначе решает луч.
const pointSeen = (stage, point, key) => {
  const reply = stage.seenAt(point);
  return !reply || (Boolean(reply.inside) && pathClear(reply, key));
};

export function itemSeen(stage, asset, key, part = null) {
  const box = stage?.seenAt && asset && Number.isInteger(key) ? targetBox(asset, key, part) : null;
  if (!box) return true;
  const probes = part
    ? [partAnchor(asset, part, box), centerOf(box)]
    : [box.anchor, centerOf(box), ...itemSurfacePoints(asset, key)];
  return probes.some((point) => point != null && pointSeen(stage, point, key));
}
