/*
 * Обложка «Зоны» редукса: весь остров с отмеченными зонами (13.11.2026, владелец: «зоны тоже … они там показываются не полностью»).
 *
 * Прежде кадр брал охват самих зон: у «Зон ВЗХ» — три красных квадрата и увеличенный кусок карты, остров обрезан краями кадра; у зелёной зоны остров почти целиком, но окно страницы мода
 * ещё и подгоняло кадр под одни зелёные пятна. Теперь кадр — весь остров (весь атлас большой карты) в рамке-карточке (`@modovik/gfx/map-card`), чтобы окно показывало его целиком.
 *
 * На всём острове маленькая зона мельче глаза (квадрат в 200 м — десяток точек), поэтому у малого числа мелких зон (не больше `MAX_INSETS`) рядом с островом стоят врезки: увеличенный кусок карты вокруг
 * зоны, зона на нём — настоящего размера; номер на врезке и на отметке острова один (цифры, перевода не нужно). У россыпи (зелёная зона: десятки точек) врезок нет — она видна и так.
 *
 * Рисует окно-съёмщик (`paintVectorCanvas` — тот же радар, что у кадров мест и зон); раскладка и выбор врезок — чистые функции, их проверяет тест.
 */

import { contentRoom } from "@modovik/gfx/map-card";

/** Врезок не больше: три красных квадрата ВЗХ — три врезки; больше зон — они и так видны россыпью. */
export const MAX_INSETS = 3;
/** Зона мельче этого на острове (точек по большей стороне, ~1,2 км мира) — «мелкая»: при трёх зонах и меньше у неё врезка (квадраты ВЗХ ~0,5 км — на острове 25 точек, с врезкой видно, где они). */
export const SMALL_ZONE = 60;
/** Сторона врезки и промежутки, точек. */
const INSET_SIDE = 208;
const INSET_GAP = 16;
const COLUMN_GAP = 22;
/** Метки: диаметр точки-отметки мелкой зоны на острове (много зон — мельче) и кольцо вокруг неё у зон с врезкой. */
const MARK = 14;
const MARK_CROWD = 11;
const CROWD = 12;
const RING = 19;
/** Охват врезки: во столько раз больше зоны, но не меньше `INSET_MIN` игровых единиц от центра до края. */
const INSET_FACTOR = 1.7;
const INSET_MIN = 200;
/** Зоны ближе друг к другу, чем на столько игровых единиц между охватами, — одна группа. */
const CLUSTER_GAP = 150;

const extent = (values) =>
  values.reduce(
    (span, v) => [Math.min(span[0], v), Math.max(span[1], v)],
    [Infinity, -Infinity],
  );
const spanOf = (values) => extent(values).reduce((low, high) => high - low);
const middleOf = (values) =>
  extent(values).reduce((low, high) => (high + low) / 2);

/**
 * Раскладка кадра `size`: остров слева (весь атлас, высота — по месту в кадре), справа колонка из `insets` врезок; `content` — вся фигура, вокруг неё идёт рамка.
 * @param {{ width: number, height: number }} size
 * @param {number} insets число врезок (0…`MAX_INSETS`)
 * @param {number} [aspect] ширина острова к высоте (атлас большой карты — 2 : 3)
 */
export function islandLayout(size, insets, aspect = 2 / 3) {
  const room = contentRoom(size);
  const count = Math.max(0, Math.min(MAX_INSETS, Math.round(insets)));
  const height = room.height;
  const width = Math.round(height * aspect);
  const side = count
    ? Math.min(
        INSET_SIDE,
        Math.floor((height - INSET_GAP * (count - 1)) / count),
      )
    : 0;
  const total = width + (count ? COLUMN_GAP + side : 0);
  const left = Math.round((size.width - total) / 2);
  const top = Math.round((size.height - height) / 2);
  const column = side * count + INSET_GAP * Math.max(0, count - 1);
  const first = top + Math.round((height - column) / 2);
  return {
    island: { x: left, y: top, width, height },
    insets: Array.from({ length: count }, (_, at) => ({
      x: left + width + COLUMN_GAP,
      y: first + at * (side + INSET_GAP),
      size: side,
    })),
    content: { x: left, y: top, width: total, height },
  };
}

const boxOf = (points) => {
  const [x0, x1] = extent(points.map((point) => point[0]));
  const [y0, y1] = extent(points.map((point) => point[1]));
  return { x0, x1, y0, y1 };
};
const touch = (a, b, gap) =>
  a.x0 - gap <= b.x1 &&
  b.x0 - gap <= a.x1 &&
  a.y0 - gap <= b.y1 &&
  b.y0 - gap <= a.y1;

/**
 * Зоны, лежащие вплотную (до `CLUSTER_GAP` игровых единиц между охватами), — одна группа: квадрат ВЗХ в файлах — две полосы друг над другом, а для глаза это одна зона.
 * Группа: `{ points, colour, alpha, members }` — все точки группы (по ним центр и охват врезки), цвет и прозрачность первой зоны, сами зоны.
 * @param {{ points: number[][], colour: string, alpha: number }[]} zones
 */
export function zoneGroups(zones) {
  const boxes = zones.map((zone) => boxOf(zone.points));
  const parent = zones.map((_, at) => at);
  const root = (at) =>
    parent[at] === at ? at : (parent[at] = root(parent[at]));
  boxes.forEach((box, from) =>
    boxes.forEach((other, to) => {
      if (to > from && touch(box, other, CLUSTER_GAP))
        parent[root(to)] = root(from);
    }),
  );
  const groups = new Map();
  zones.forEach((zone, at) =>
    groups.set(root(at), [...(groups.get(root(at)) || []), zone]),
  );
  return [...groups.values()].map((members) => ({
    points: members.flatMap((zone) => zone.points),
    colour: members[0].colour,
    alpha: members[0].alpha,
    members,
  }));
}

/**
 * Группы зон, у которых есть врезка: мелкие на острове (`SMALL_ZONE` точек), если групп немного. `pixelsPerUnit` — масштаб острова. Порядок — с севера на юг (как идут врезки сверху вниз).
 * @param {{ points: number[][] }[]} zones зоны в мире игры
 */
export function insetZones(zones, pixelsPerUnit) {
  const groups = zoneGroups(zones);
  if (groups.length === 0 || groups.length > MAX_INSETS) return [];
  const small = (zone) =>
    Math.max(
      spanOf(zone.points.map((point) => point[0])),
      spanOf(zone.points.map((point) => point[1])),
    ) *
      pixelsPerUnit <
    SMALL_ZONE;
  return groups
    .filter(small)
    .sort(
      (left, right) =>
        middleOf(right.points.map((point) => point[1])) -
        middleOf(left.points.map((point) => point[1])),
    );
}

/** Мир врезки вокруг зоны: квадрат `x0, x1, y0 (север), y1`. */
export function insetWorld(zone) {
  const xs = zone.points.map((point) => point[0]);
  const ys = zone.points.map((point) => point[1]);
  const half = Math.max(
    INSET_MIN,
    (Math.max(spanOf(xs), spanOf(ys)) / 2) * INSET_FACTOR,
  );
  const [cx, cy] = [middleOf(xs), middleOf(ys)];
  return { x0: cx - half, x1: cx + half, y0: cy + half, y1: cy - half };
}

const rectInAtlas = (world, atlas, size) => ({
  u: (world.x0 - atlas.originX) / size.width,
  v: (atlas.originY - world.y0) / size.height,
  width: (world.x1 - world.x0) / size.width,
  height: (world.y0 - world.y1) / size.height,
});

function tracePath(context, pixels) {
  context.beginPath();
  pixels.forEach(([x, y], at) => context[at ? "lineTo" : "moveTo"](x, y));
  context.closePath();
}

function paintZone(context, zone, pixels, { outline, mark }) {
  tracePath(context, pixels);
  context.globalAlpha = Math.max(0.28, Math.min(0.85, zone.alpha / 255));
  context.fillStyle = zone.colour;
  context.fill();
  context.globalAlpha = 1;
  context.lineWidth = outline;
  context.strokeStyle = zone.colour;
  context.stroke();
  const xs = pixels.map((pixel) => pixel[0]);
  const ys = pixels.map((pixel) => pixel[1]);
  if (!mark || !(spanOf(xs) < mark && spanOf(ys) < mark)) return;
  context.beginPath();
  context.arc(middleOf(xs), middleOf(ys), mark / 2, 0, Math.PI * 2);
  context.fillStyle = zone.colour;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "rgba(0, 0, 0, 0.7)";
  context.stroke();
}

/* Номер врезки: кружок и цифра. */
function badge(context, text, x, y, colour) {
  context.beginPath();
  context.arc(x, y, 11, 0, Math.PI * 2);
  context.fillStyle = "rgba(0, 0, 0, 0.72)";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = colour;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "700 14px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y + 0.5);
}

function roundedClip(context, { x, y, size }, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + size, y, x + size, y + size, radius);
  context.arcTo(x + size, y + size, x, y + size, radius);
  context.arcTo(x, y + size, x, y, radius);
  context.arcTo(x, y, x + size, y, radius);
  context.closePath();
}

/**
 * Холст обложки: весь остров, зоны на нём, врезки к мелким зонам. Поля и рамки нет — вокруг прозрачно (`@modovik/gfx/map-card`).
 * @param {{ paintVectorCanvas: Function }} render `world-map-vector-render.js`
 * @param {{ geometry: object, atlas: object, atlasSize: { width: number, height: number } }} source радар и атлас
 * @param {{ points: number[][], colour: string, alpha: number }[]} zones
 * @param {{ width: number, height: number }} size
 * @param {() => { canvas: HTMLCanvasElement, context: CanvasRenderingContext2D }} makeCanvas пустой (прозрачный) холст кадра: поля у обложки нет
 * @returns {HTMLCanvasElement|null}
 */
export function paintIslandZones({ render, source, zones, size, makeCanvas }) {
  const { geometry, atlas, atlasSize } = source;
  const aspect = atlasSize.width / atlasSize.height;
  const room = contentRoom(size);
  const islandHeight = room.height;
  const pixelsPerUnit = islandHeight / atlasSize.height;
  const marked = insetZones(zones, pixelsPerUnit);
  const layout = islandLayout(size, marked.length, aspect);
  const { island } = layout;

  const map = render.paintVectorCanvas(
    { geometry, atlas },
    { u: 0, v: 0, width: 1, height: 1 },
    island.width,
    island.height,
  );
  if (!map) return null;
  const { canvas, context } = makeCanvas();
  context.drawImage(map, island.x, island.y);
  context.lineJoin = "round";

  const toIsland = ([x, y]) => [
    island.x + ((x - atlas.originX) / atlasSize.width) * island.width,
    island.y + ((atlas.originY - y) / atlasSize.height) * island.height,
  ];
  const crowd = zones.length > CROWD;
  zones.forEach((zone) =>
    paintZone(context, zone, zone.points.map(toIsland), {
      outline: zones.length > 1 ? 2.5 : 4,
      mark: crowd ? MARK_CROWD : MARK,
    }),
  );

  marked.forEach((zone, at) => {
    const place = layout.insets[at];
    const [cx, cy] = [
      middleOf(zone.points.map((point) => point[0])),
      middleOf(zone.points.map((point) => point[1])),
    ];
    const [px, py] = toIsland([cx, cy]);
    context.beginPath();
    context.arc(px, py, RING, 0, Math.PI * 2);
    context.lineWidth = 3;
    context.strokeStyle = zone.colour;
    context.stroke();
    badge(context, String(at + 1), px - RING - 8, py - RING - 8, zone.colour);

    const world = insetWorld(zone);
    const piece = render.paintVectorCanvas(
      { geometry, atlas },
      rectInAtlas(world, atlas, atlasSize),
      place.size,
      place.size,
    );
    if (!piece) return;
    context.save();
    roundedClip(context, place, 14);
    context.clip();
    context.drawImage(piece, place.x, place.y);
    const toInset = ([x, y]) => [
      place.x + ((x - world.x0) / (world.x1 - world.x0)) * place.size,
      place.y + ((world.y0 - y) / (world.y0 - world.y1)) * place.size,
    ];
    (zone.members || [zone]).forEach((member) =>
      paintZone(context, member, member.points.map(toInset), {
        outline: 3,
        mark: 0,
      }),
    );
    context.restore();
    roundedClip(context, place, 14);
    context.lineWidth = 3;
    context.strokeStyle = zone.colour;
    context.stroke();
    badge(context, String(at + 1), place.x + 20, place.y + 20, zone.colour);
  });

  return canvas;
}
