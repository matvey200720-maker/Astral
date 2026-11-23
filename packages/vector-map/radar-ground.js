/*
 * Земля радара под полупрозрачными зонами (02.11.2026, владелец в альфе на Majestic: «на мини-карте зоны другие»).
 *
 * На карте паузы заливка зоны МЦЛ — режим «цвет» (оттенок зоны, светлота карты), и тёмные дороги идут сквозь
 * цветной район; заливка с прозрачностью (зоны Majestic, свои зоны) тоже пропускает дороги. На мини-карте зона
 * лежала плоской плотной заливкой поверх дорог: кадр владельца 104 — внутри «15-КА» и «ГАЗЕТЫ» ни одной дороги.
 *
 * Причина — порядок рисования радара. Наши треугольники — одна модель, дописанная в конец последней рисовалки
 * суши плитки (`MinimapRadar.Overlay.cs`, `radar_overlay.rs`), и игра рисует её после штатных дорог: высота
 * вершины порядок со штатной геометрией не решает. Заливка на высоте 3 («под кварталами и дорогами», 22.10)
 * и 11,99 («под дорогами», 19.10) всё равно ложилась поверх дорог, а прозрачной быть не может — сквозь неё
 * видна игра (22.10, альфа 255 у каждой вершины).
 *
 * Поэтому полупрозрачная заливка зоны на радар идёт не плоским цветом, а копией самой земли радара внутри
 * зоны: каждый штатный треугольник (суша, кварталы, дороги, рельсы — `radar-geometry.js`), который зона
 * накрывает, обрезается её контуром и красится тем же смешением, что на карте паузы (`blendColor`, режим
 * «цвет» или обычный с долей), поверх цвета, в который радар перекрашен парами той же установки. Копии
 * плотные и идут в порядке штатной геометрии — так дороги внутри зоны остаются дорогами, как на карте паузы.
 * Вторая зона поверх первой смешивается с уже окрашенной копией, а не со штатной землёй: порядок — как у
 * канвы.
 *
 * Модуль чистый: на входе геометрия радара (`decodeRadarGeometry`) и пары перекраски, на выходе треугольники.
 */

import { hexToRgb } from "./color.js";
import { blendColor } from "./raster.js";

/* Сторона клетки поиска, метры: штатный треугольник — от метра (дорога) до километров (суша). */
const CELL = 64;

/* Треугольник площадью меньше этого (м²) — шов, а не земля: на радаре он не виден. */
const MIN_AREA = 1e-4;

/** Пары перекраски радара («RRGGBBAA=RRGGBBAA») → `{ RRGGBB штатный: [r, g, b] после перекраски }`. */
export function radarPaintTable(pairs) {
  const table = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const match = /^([0-9A-F]{6})[0-9A-F]{2}=([0-9A-F]{6})[0-9A-F]{2}$/i.exec(String(pair || ""));
    if (!match) continue;
    const to = match[2];
    table.set(match[1].toUpperCase(), [0, 2, 4].map((at) => parseInt(to.slice(at, at + 2), 16)));
  }
  return table;
}

/** Цвет `backdrop` [r, g, b] под заливкой `source` [r, g, b] с долей `alpha` (0…1) в режиме `mode` — [r, g, b]. */
export function blendRadarColour(backdrop, source, alpha, mode = "normal") {
  const out = [0, 0, 0];
  const [br, bg, bb] = backdrop.map((value) => value / 255);
  blendColor(out, mode || "normal", br, bg, bb, source[0] / 255, source[1] / 255, source[2] / 255);
  const share = Math.max(0, Math.min(1, alpha));
  const mix = (base, top) => Math.round(Math.max(0, Math.min(1, base + (Math.max(0, Math.min(1, top)) - base) * share)) * 255);
  return [mix(br, out[0]), mix(bg, out[1]), mix(bb, out[2])];
}

/* Удвоенная площадь со знаком. */
const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/* Точка в треугольнике, включая край. */
function inTriangle(px, py, t) {
  const d1 = cross(t[0], t[1], t[2], t[3], px, py);
  const d2 = cross(t[2], t[3], t[4], t[5], px, py);
  const d3 = cross(t[4], t[5], t[0], t[1], px, py);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/* Отрезки пересекаются (касание тоже). */
function segmentsMeet(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (px, py, qx, qy, rx, ry, d) =>
    d === 0 && Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
  return on(cx, cy, dx, dy, ax, ay, d1) || on(cx, cy, dx, dy, bx, by, d2) || on(ax, ay, bx, by, cx, cy, d3) || on(ax, ay, bx, by, dx, dy, d4);
}

/* Точка внутри контуров по правилу «чёт-нечет» (как заливка карты). */
function insideLoops(loops, x, y) {
  let inside = false;
  for (const ring of loops) {
    const count = ring.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const xi = ring[i * 2];
      const yi = ring[i * 2 + 1];
      const xj = ring[j * 2];
      const yj = ring[j * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/*
 * Выпуклый многоугольник (X, Y подряд), обрезанный выпуклым треугольником `clip` против часовой стрелки
 * (Сазерленд — Ходжман). Пустой — меньше трёх точек.
 */
function clipConvex(subject, clip) {
  let polygon = subject;
  for (let edge = 0; edge < 3 && polygon.length >= 6; edge += 1) {
    const ax = clip[edge * 2];
    const ay = clip[edge * 2 + 1];
    const bx = clip[((edge + 1) % 3) * 2];
    const by = clip[((edge + 1) % 3) * 2 + 1];
    const out = [];
    const count = polygon.length / 2;
    for (let i = 0; i < count; i += 1) {
      const px = polygon[i * 2];
      const py = polygon[i * 2 + 1];
      const qx = polygon[((i + 1) % count) * 2];
      const qy = polygon[((i + 1) % count) * 2 + 1];
      const dp = cross(ax, ay, bx, by, px, py);
      const dq = cross(ax, ay, bx, by, qx, qy);
      if (dp >= 0) out.push(px, py);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        out.push(px + (qx - px) * t, py + (qy - py) * t);
      }
    }
    polygon = out;
  }
  return polygon.length >= 6 ? polygon : null;
}

/*
 * Земля радара: штатные треугольники с цветом после перекраски, в порядке рисования, и клетки поиска. Копии,
 * которые кладут зоны, дописываются сюда же: следующая зона смешивается уже с ними.
 */
function createGround(geometry, paint) {
  const xs = [];
  const colours = [];
  const cells = new Map();
  const add = (corners, rgb) => {
    const id = colours.length;
    for (const value of corners) xs.push(value);
    colours.push(rgb);
    const x0 = Math.floor(Math.min(corners[0], corners[2], corners[4]) / CELL);
    const x1 = Math.floor(Math.max(corners[0], corners[2], corners[4]) / CELL);
    const y0 = Math.floor(Math.min(corners[1], corners[3], corners[5]) / CELL);
    const y1 = Math.floor(Math.max(corners[1], corners[3], corners[5]) / CELL);
    for (let cx = x0; cx <= x1; cx += 1)
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = cx * 65536 + cy;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(id);
      }
    return id;
  };
  for (const group of geometry?.groups || []) {
    const stock = String(group.color || "").slice(1).toUpperCase();
    const rgb = paint.get(stock) || hexToRgb(group.color).slice(0, 3);
    const p = group.positions;
    for (let at = 0; at + 5 < p.length; at += 6) add([p[at], p[at + 1], p[at + 2], p[at + 3], p[at + 4], p[at + 5]], rgb);
  }
  let stamp = 0;
  const seen = new Uint32Array(Math.max(1024, colours.length * 2));
  let marks = seen;
  return {
    add,
    corners: (id) => [xs[id * 6], xs[id * 6 + 1], xs[id * 6 + 2], xs[id * 6 + 3], xs[id * 6 + 4], xs[id * 6 + 5]],
    colour: (id) => colours[id],
    /** Номера треугольников, чья клетка задевает рамку, — по возрастанию (порядок рисования). */
    near(box) {
      stamp += 1;
      if (marks.length < colours.length) {
        const grown = new Uint32Array(colours.length * 2);
        grown.set(marks);
        marks = grown;
      }
      const found = [];
      const x0 = Math.floor(box.x0 / CELL);
      const x1 = Math.floor(box.x1 / CELL);
      const y0 = Math.floor(box.y0 / CELL);
      const y1 = Math.floor(box.y1 / CELL);
      for (let cx = x0; cx <= x1; cx += 1)
        for (let cy = y0; cy <= y1; cy += 1) {
          const list = cells.get(cx * 65536 + cy);
          if (!list) continue;
          for (const id of list) {
            if (marks[id] === stamp) continue;
            marks[id] = stamp;
            found.push(id);
          }
        }
      return found.sort((a, b) => a - b);
    },
    get size() {
      return colours.length;
    },
  };
}

const boxOf = (points) => {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let at = 0; at + 1 < points.length; at += 2) {
    box.x0 = Math.min(box.x0, points[at]);
    box.x1 = Math.max(box.x1, points[at]);
    box.y0 = Math.min(box.y0, points[at + 1]);
    box.y1 = Math.max(box.y1, points[at + 1]);
  }
  return box;
};

const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/**
 * Земля радара под полупрозрачными заливками.
 *
 * @param {{ groups: { color: string, positions: Float32Array }[] }} geometry штатный радар игры
 *   (`decodeRadarGeometry`): треугольники в мировых метрах по ролям, в порядке рисования
 * @param {string[]} [pairs] пары перекраски радара той же установки («RRGGBBAA=RRGGBBAA»)
 * @returns {{ cover: Function, stats: object }|null} `null` — геометрии нет
 */
export function createRadarGround(geometry, pairs = []) {
  if (!geometry?.groups?.length) return null;
  const ground = createGround(geometry, radarPaintTable(pairs));
  const stats = { fills: 0, triangles: 0, whole: 0, split: 0 };
  return {
    stats,
    /**
     * Земля внутри заливки — окрашенными копиями.
     *
     * @param {number[][]} loops контуры заливки в мировых метрах (X, Y подряд)
     * @param {ArrayLike<number>} points вершины её треугольников (X, Y подряд)
     * @param {ArrayLike<number>} triangles номера вершин по три
     * @param {number[]} rgb цвет заливки
     * @param {number} alpha доля заливки 0…1 (как на карте паузы)
     * @param {string} mode режим наложения карты паузы: `color` или обычный
     * @returns {{ points: number[], triangles: number[], colours: Uint8Array }} треугольники без общих вершин,
     *   цвет — на каждой вершине, альфа 255; порядок — порядок рисования
     */
    cover(loops, points, triangles, rgb, alpha, mode) {
      const clips = [];
      for (let at = 0; at + 2 < triangles.length; at += 3) {
        const tri = [];
        for (let corner = 0; corner < 3; corner += 1) tri.push(points[triangles[at + corner] * 2], points[triangles[at + corner] * 2 + 1]);
        /* Обрезка ждёт обход против часовой. */
        if (cross(tri[0], tri[1], tri[2], tri[3], tri[4], tri[5]) < 0) tri.push(...tri.splice(2, 2));
        clips.push({ tri, box: boxOf(tri) });
      }
      const edges = [];
      for (const ring of loops) {
        const count = ring.length / 2;
        for (let i = 0; i < count; i += 1) {
          const j = (i + 1) % count;
          const edge = [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]];
          edges.push({ edge, box: boxOf(edge) });
        }
      }
      const out = { points: [], triangles: [], colours: [] };
      const emitted = [];
      const emit = (polygon, colour) => {
        const count = polygon.length / 2;
        for (let i = 1; i + 1 < count; i += 1) {
          const tri = [polygon[0], polygon[1], polygon[i * 2], polygon[i * 2 + 1], polygon[i * 2 + 2], polygon[i * 2 + 3]];
          if (Math.abs(cross(...tri)) / 2 < MIN_AREA) continue;
          const base = out.points.length / 2;
          out.points.push(...tri);
          out.triangles.push(base, base + 1, base + 2);
          for (let corner = 0; corner < 3; corner += 1) out.colours.push(colour[0], colour[1], colour[2], 255);
          emitted.push({ tri, colour });
        }
      };
      const box = boxOf(points);
      for (const id of ground.near(box)) {
        const subject = ground.corners(id);
        const own = boxOf(subject);
        if (!overlaps(own, box)) continue;
        const colour = blendRadarColour(ground.colour(id), rgb, alpha, mode);
        /* Край зоны треугольник не задевает — он целиком внутри или целиком снаружи. */
        const crossed = edges.some(
          ({ edge, box: edgeBox }) =>
            overlaps(own, edgeBox) &&
            (inTriangle(edge[0], edge[1], subject) ||
              inTriangle(edge[2], edge[3], subject) ||
              segmentsMeet(edge[0], edge[1], edge[2], edge[3], subject[0], subject[1], subject[2], subject[3]) ||
              segmentsMeet(edge[0], edge[1], edge[2], edge[3], subject[2], subject[3], subject[4], subject[5]) ||
              segmentsMeet(edge[0], edge[1], edge[2], edge[3], subject[4], subject[5], subject[0], subject[1])),
        );
        if (!crossed) {
          const cx = (subject[0] + subject[2] + subject[4]) / 3;
          const cy = (subject[1] + subject[3] + subject[5]) / 3;
          if (!insideLoops(loops, cx, cy)) continue;
          stats.whole += 1;
          emit(subject, colour);
          continue;
        }
        stats.split += 1;
        /* Обход против часовой и для обрезки, и для веера. */
        const ccw = cross(...subject) < 0 ? [subject[0], subject[1], subject[4], subject[5], subject[2], subject[3]] : subject;
        for (const clip of clips) {
          if (!overlaps(own, clip.box)) continue;
          const piece = clipConvex(ccw, clip.tri);
          if (piece) emit(piece, colour);
        }
      }
      /* Копии — земля для следующих зон. */
      for (const item of emitted) ground.add(item.tri, item.colour);
      stats.fills += 1;
      stats.triangles += emitted.length;
      return { points: out.points, triangles: out.triangles, colours: Uint8Array.from(out.colours) };
    },
  };
}
