/*
 * Метки Majestic (ТЗ 18.10, задача 1.5): зоны и точки сервера — тайники, ВЗА,
 * клады, зелёные и красные зоны, охота, рыбалка, дальнобойщики, камеры DMV,
 * грибы, рубка леса, собирательство, мусорные баки, счастливые телефоны.
 *
 * Данные (`majestic-marks.json`, вики Majestic RP, 10.10.2026) большие, и
 * подгружаются отдельным куском, когда метки включены или открыт инструмент:
 * `loadMajesticMarks()`. Сцена рисует их обычными примитивами — путь зоны
 * (заливка и контур) и глиф точки на плашке цвета категории, — поэтому метки
 * видны в окне сразу и запекаются в плитки при установке, как всё остальное.
 *
 * Вид — как у эталона: значок и толщина контура идут от одного «Размера»
 * (метры; контур — 12 % размера, от 2 до 16 м, в долях толщины стиля), заливка
 * зоны — доля стиля, умноженная на «Заливку» и на 1,5, не плотнее 90 %; значок
 * не больше 85 % расстояния до ближайшего соседа, чтобы кучки не слипались
 * (точки ближе трёх метров — одно место, значок на нём один).
 *
 * Метки по одной (19.10, задача 36): у каждой точки и зоны — свой ключ (`majesticMarkKey`: категория, `p` или `z`, номер в данных); в
 * проекте (`majestic.marks`) у метки может быть своя краска и она может быть спрятана. Метка под курсором и её рамка —
 * `majesticMarkAt`, `majesticMarkBounds`; зоны с правками рисуются отдельно, остальные — общим путём стиля, как раньше.
 */

import { MAJESTIC_CATALOG } from "./majestic-catalog.js";
import { GLYPH_BOX } from "./glyphs.js";
import { markerGlyph } from "./pack-overlays.js";

let data = null;
let loading = null;

/* Расстояние до ближайшего соседа. Точки ближе трёх метров — одно место (две будки
   рядом, два тайника в одном дворе): друг друга они «не теснят», значок рисуется на
   месте обеих, иначе у такой пары не оставалось бы ни одного. */
const SAME_SPOT = 3;
const nearestOf = (points) => {
  const result = new Float32Array(points.length).fill(Infinity);
  for (let a = 0; a < points.length; a += 1)
    for (let b = a + 1; b < points.length; b += 1) {
      const gap = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
      if (gap < SAME_SPOT) continue;
      if (gap < result[a]) result[a] = gap;
      if (gap < result[b]) result[b] = gap;
    }
  return result;
};

function prepare(raw) {
  const categories = new Map();
  for (const category of raw.categories) categories.set(category.id, { ...category, nearest: nearestOf(category.points) });
  return { source: raw.source, date: raw.date, categories };
}

/** Подгружает данные меток (один раз, отдельным куском сборки). */
export function loadMajesticMarks() {
  loading ??= import("./majestic-marks-data.js").then((module) => {
    data = prepare(module.default);
    return data;
  });
  return loading;
}

/** Загруженные данные или `null`, пока их нет. */
export const majesticMarksData = () => data;

/** Включена ли хоть одна категория. */
export const majesticMarksOn = (section) => Boolean(section) && Object.values(section.categories || {}).some((item) => item.on);

/** Включённые категории раздела в порядке каталога. */
export const majesticEnabled = (section) => MAJESTIC_CATALOG.filter((entry) => section?.categories?.[entry.id]?.on);

const round = (value) => Math.round(value * 100) / 100;

/* Строки путей зон не зависят от вида (цвет, толщина, заливка) — только от того,
   как карта лежит в сцене: считаются раз на атлас, а не на каждый шаг ползунка. */
const pathCache = new Map();

/** Путь одной зоны: внешний контур и отверстия. */
function zonePath(zone, projector) {
  const ring = (flat) => {
    let d = "";
    for (let at = 0; at + 1 < flat.length; at += 2) {
      const point = projector.point({ x: flat[at], y: flat[at + 1] });
      d += `${at ? "L" : "M"}${round(point.x)} ${round(point.y)}`;
    }
    return `${d}Z`;
  };
  return `${ring(zone.o)}${(zone.h || []).map(ring).join("")}`;
}

/* Пути стилей категории; `skip` — номера зон с правками (спрятанных и перекрашенных): общий путь стиля идёт без них. */
function pathsOf(category, projector, skip = null) {
  const origin = projector.point({ x: 0, y: 0 });
  const signature = skip?.size ? [...skip].sort((a, b) => a - b).join(",") : "";
  const key = `${category.id}|${round(origin.x)}|${round(origin.y)}|${round(projector.length(1000))}|${signature}`;
  let cached = pathCache.get(key);
  if (cached) return cached;
  cached = new Map();
  category.zones.forEach((zone, index) => {
    if (skip?.has(index)) return;
    cached.set(zone.s, (cached.get(zone.s) || "") + zonePath(zone, projector));
  });
  if (pathCache.size > 40) pathCache.clear();
  pathCache.set(key, cached);
  return cached;
}

/** Ключ метки в `majestic.marks`: категория, `p` (точка) или `z` (зона) и номер в данных. */
export const majesticMarkKey = (id, kind, index) => `${id}:${kind === "zone" || kind === "z" ? "z" : "p"}${index}`;

/** Ключ метки обратно в выбор `{ id, kind, index, key }` или `null`. */
export function majesticMarkFromKey(key) {
  const parsed = /^([a-zA-Z]{3,16}):([pz])([0-9]{1,5})$/.exec(String(key || ""));
  return parsed ? { id: parsed[1], kind: parsed[2] === "z" ? "zone" : "point", index: Number(parsed[3]), key: String(key) } : null;
}

/** Правка метки по ключу или `null`. */
const markOf = (section, id, kind, index) => section?.marks?.[majesticMarkKey(id, kind, index)] || null;

/**
 * Раздел Majestic с изменённой меткой: `change` — `{ hidden?, color? }`. Пустая правка (не спрятана, цвета нет) убирает запись.
 * Нормализация — на вызывающем (`normalizeWorldMap`).
 */
export function patchMajesticMark(section, key, change) {
  const next = { ...(section.marks || {}) };
  const merged = { ...(next[key] || {}), ...change };
  if (!merged.hidden) delete merged.hidden;
  if (!merged.color) delete merged.color;
  if (Object.keys(merged).length) next[key] = merged;
  else delete next[key];
  return { ...section, marks: next };
}

/* Точка внутри кольца (плоские X, Y): луч вправо, чёт-нечет. */
function insideRing(flat, x, y) {
  let inside = false;
  for (let a = 0, b = flat.length - 2; a < flat.length; b = a, a += 2) {
    const ax = flat[a];
    const ay = flat[a + 1];
    const bx = flat[b];
    const by = flat[b + 1];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const insideZone = (zone, x, y) => insideRing(zone.o, x, y) && !(zone.h || []).some((hole) => insideRing(hole, x, y));

const ringBox = (flat) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let at = 0; at + 1 < flat.length; at += 2) {
    if (flat[at] < x0) x0 = flat[at];
    if (flat[at] > x1) x1 = flat[at];
    if (flat[at + 1] < y0) y0 = flat[at + 1];
    if (flat[at + 1] > y1) y1 = flat[at + 1];
  }
  return { x0, y0, x1, y1 };
};

/**
 * Метка Majestic под точкой (метры карты): `{ id, kind: "point" | "zone", index, key }` или `null`. Берутся метки включённых
 * категорий; точка важнее зоны (ближайшая в пределах значка и допуска), из зон — меньшая по площади рамки. Спрятанные метки
 * тоже берутся (их показывает рамка-призрак) — так их можно вернуть. Данные ещё не приехали — `null`.
 */
export function majesticMarkAt(section, x, y, tolerance = 0) {
  if (!data || !majesticMarksOn(section)) return null;
  let best = null;
  for (const entry of majesticEnabled(section)) {
    const category = data.categories.get(entry.id);
    if (!category) continue;
    const own = section.categories[entry.id];
    const reach = Math.max(tolerance, (section.size * own.icon) / 200);
    category.points.forEach(([px, py], index) => {
      const distance = Math.hypot(px - x, py - y);
      if (distance <= reach && (!best || best.kind !== "point" || distance < best.distance)) best = { id: entry.id, kind: "point", index, key: majesticMarkKey(entry.id, "point", index), distance };
    });
  }
  if (best) {
    delete best.distance;
    return best;
  }
  let smallest = Infinity;
  for (const entry of majesticEnabled(section)) {
    const category = data.categories.get(entry.id);
    if (!category) continue;
    category.zones.forEach((zone, index) => {
      if (!insideZone(zone, x, y)) return;
      const box = ringBox(zone.o);
      const area = (box.x1 - box.x0) * (box.y1 - box.y0);
      if (area < smallest) {
        smallest = area;
        best = { id: entry.id, kind: "zone", index, key: majesticMarkKey(entry.id, "zone", index) };
      }
    });
  }
  return best;
}

/** Рамка метки в метрах карты (`{ x0, y0, x1, y1 }`) или `null`: точка — по размеру значка, зона — по контуру. */
export function majesticMarkBounds(section, id, kind, index) {
  const category = data?.categories.get(id);
  if (!category) return null;
  if (kind === "zone") {
    const zone = category.zones[index];
    return zone ? ringBox(zone.o) : null;
  }
  const point = category.points[index];
  if (!point) return null;
  const half = Math.max(8, ((section?.size || 40) * (section?.categories?.[id]?.icon || 100)) / 200);
  return { x0: point[0] - half, y0: point[1] - half, x1: point[0] + half, y1: point[1] + half };
}

/** Сколько меток тронуто (спрятаны или перекрашены). */
export const majesticMarksEdited = (section) => Object.keys(section?.marks || {}).length;

const luminance = (hex) => {
  const value = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""))?.[1];
  if (!value) return 0;
  const channel = (at) => parseInt(value.slice(at, at + 2), 16) / 255;
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Толщина контура зоны в метрах: от размера, в долях толщины стиля (3 — обычная). */
export const majesticLineMetres = (size, style, line = 100) => (clamp(size * 0.12, 2, 16) * (style.w / 3) * line) / 100;

/** Плотность заливки зоны, 0…0,9. */
export const majesticFillAlpha = (style, own = 100, general = 100) =>
  Math.round(Math.min(0.9, style.f * (own / 100) * (general / 100) * 1.5) * 1000) / 1000;

/**
 * Примитивы сцены для включённых категорий: `{ zones, points }`.
 * Зоны — пути (заливка и контур по стилям), точки — глифы на плашке; подпись
 */
export function majesticMarkItems(section, projector) {
  const result = { zones: [], points: [] };
  const marks = data;
  if (!marks || !majesticMarksOn(section)) return result;
  for (const entry of majesticEnabled(section)) {
    const category = marks.categories.get(entry.id);
    const own = section.categories[entry.id];
    if (!category) continue;
    const colourOf = (style) => own.color || style.c || entry.color;
    if (category.zones.length) {
      /* Зоны с правками (спрятанные, перекрашенные) идут мимо общего пути стиля. */
      const touched = new Set();
      category.zones.forEach((_, index) => {
        if (markOf(section, entry.id, "zone", index)) touched.add(index);
      });
      const paths = pathsOf(category, projector, touched.size ? touched : null);
      /* Одна зона стилем и краской: заливка и контур. */
      const draw = (d, style, colour, id) => {
        const alpha = majesticFillAlpha(style, own.fill, section.fill);
        if (alpha > 0)
          result.zones.push({ kind: "path", id: `majestic-fill-${id}`, d, fill: colour, fillOpacity: round(alpha), stroke: null });
        const metres = majesticLineMetres(section.size, style, own.line);
        if (metres > 0) {
          const width = round(projector.length(metres));
          result.zones.push({
            kind: "path",
            id: `majestic-line-${id}`,
            d,
            fill: null,
            stroke: colour,
            strokeWidth: width,
            lineJoin: "round",
            lineCap: "butt",
            ...(style.d ? { dash: [width, round(width * 3)] } : null),
          });
        }
      };
      category.styles.forEach((style, index) => {
        const d = paths.get(index);
        if (d) draw(d, style, colourOf(style), `${entry.id}-${index}`);
      });
      for (const index of touched) {
        const mark = markOf(section, entry.id, "zone", index);
        const zone = category.zones[index];
        const style = category.styles[zone.s];
        if (!mark?.color || mark.hidden || !style) continue;
        draw(zonePath(zone, projector), style, mark.color, `${entry.id}-z${index}`);
      }
    }
    const path = entry.glyph ? markerGlyph(entry.glyph) : null;
    if (path && category.points.length) {
      const colour = category.styles[0]?.c || entry.color;
      const wanted = (section.size * own.icon) / 100;
      category.points.forEach(([x, y, limit], index) => {
        const mark = markOf(section, entry.id, "point", index);
        if (mark?.hidden) return;
        const metres = Math.min(wanted, category.nearest[index] * 0.85, limit > 0 ? limit : Infinity);
        if (!(metres > 1)) return;
        const at = projector.point({ x, y });
        /* Краска одной метки важнее краски категории; цвет рисунка — по плашке, если своего нет. */
        const badge = mark?.color || own.color || colour;
        const ink = own.ink || (luminance(badge) > 0.72 ? "#1b2230" : "#ffffff");
        result.points.push({
          kind: "glyph",
          id: `majestic-point-${entry.id}-${index}`,
          path,
          box: GLYPH_BOX,
          x: round(at.x),
          y: round(at.y),
          size: round(projector.length(metres)),
          fill: ink,
          badge: { fill: badge },
        });
      });
    }
  }
  return result;
}

