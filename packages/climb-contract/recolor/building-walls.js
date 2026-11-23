/*
 * Своя картинка у стены здания (3В ТЗ 18.10.2026, путь А из оценки 3Б).
 *
 * Лист стены повторяется по развёртке и общий у многих мест, поэтому правка листа
 * расходится по всем повторам. Своя картинка «только этой стене» едет в игру тем же
 * путём, что стороны и эмблемы, — плашкой перед стеной (`compile-emblem-plates`):
 * студия отдаёт стену, развёрнутую в плоскость (RGBA в пикселях стены, альфа — по
 * контуру её треугольников: проёмы и витрины прозрачны), а договор хранит, где эта
 * стена стоит.
 *
 * Запись стены (`walls` работы здания):
 *   id      — `w1`…`w99`;
 *   key     — какая это стена (центр, нормаль, размер): та же стена при повторном
 *             открытии студии заменяет свою плашку, а не заводит вторую;
 *   asset   — картинка в хранилище окна (`hangar-emblem:<sha256>`), name, width, height — её пиксели;
 *   point   — центр рамки стены в метрах сцены, на плоскости самой выступающей её точки;
 *   normal  — куда стена смотрит (наружу);
 *   angle   — поворот осей рамки вокруг нормали, градусы: оси стены («вверх» — мировая Z,
 *             «вправо» — вверх × нормаль) могут разойтись с осями наклейки у наклонных стен;
 *   metres  — размер рамки стены, метры (ширина, высота): плашка ровно такая;
 *   part    — часть здания, откуда стена (`walls`, `roof`, …), для подписи в списке.
 *
 * Плашка прилегает к стене (`hug`): у стены нет выступов-«перед» — кирпич и наличники,
 * что стоят перед плоскостью, остаются перед плашкой, как в игре; с остальными плашками здания
 * она делит стену и ложится под них (отступ 3 см, у сторон — 0, у надписей и эмблем — больше).
 */

import { sidePlateSize } from "./building-images.js";

/** Плашек стен у здания не больше (имена в доверии пакета). */
export const BUILDING_WALL_LIMIT = 16;
/** Больше стольких плашек — предупреждение: каждая — до 5,6 МБ видеопамяти с мип-уровнями. */
export const BUILDING_WALL_WARN = 8;
/** Длинная сторона листа плашки стены, px. */
export const BUILDING_WALL_SIDE = 2048;
/** Отступ плашки стены от плоскости стены, м (перед сторонами, за надписями и эмблемами). */
export const BUILDING_WALL_OFFSET = 0.03;
/** Размер рамки стены, м. */
export const BUILDING_WALL_METRES = Object.freeze([0.5, 200]);

const ID = /^w[1-9][0-9]?$/;
const IMAGE_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;
const PART = /^[a-z][a-z0-9:_-]{0,23}$/;

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const vector = (value, limit) => (Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item))) ? value.map((item) => Math.min(limit, Math.max(-limit, Number(item)))) : null);

/** Стена по месту: центр, нормаль и размер рамки (сантиметры) — одна и та же стена даёт один и тот же ключ. */
export function buildingWallKey(point, normal, metres) {
  const cm = (value) => Math.round(value * 100);
  return `${point.map(cm).join(",")}|${normal.map((value) => Math.round(value * 100)).join(",")}|${metres.map(cm).join("x")}`;
}

/**
 * Место стены в порядке: `{ point, normal, metres, key }` или `null` (нет места, размер не тот). Одна арифметика у
 * записи и у кадра: студия по ней узнаёт стену, у которой плашка уже стоит.
 */
export function buildingWallIdentity({ point: rawPoint, normal: rawNormalInput, metres: rawMetres } = {}) {
  const point = vector(rawPoint, 600);
  const rawNormal = vector(rawNormalInput, 1e6);
  const size = Array.isArray(rawMetres) && rawMetres.length === 2 ? rawMetres.map(Number) : null;
  if (!point || !rawNormal || !size || !size.every(Number.isFinite)) return null;
  const length = Math.hypot(...rawNormal);
  if (!(length > 1e-9)) return null;
  const normal = rawNormal.map((value) => round(value / length, 4));
  const [low, high] = BUILDING_WALL_METRES;
  const metres = size.map((value) => round(Math.min(high, Math.max(low, value)), 2));
  const centre = point.map((value) => round(value, 3));
  return { point: centre, normal, metres, key: buildingWallKey(centre, normal, metres) };
}

/** Запись стены или `null` (нет картинки, нет места, размер не тот). */
export function normalizeBuildingWall(input) {
  const source = plain(input);
  const asset = IMAGE_ASSET.test(String(source.asset || "")) ? String(source.asset) : "";
  const place = asset ? buildingWallIdentity(source) : null;
  if (!place) return null;
  const { point: centre, normal, metres, key } = place;
  const angle = Number(source.angle);
  const part = PART.test(String(source.part || "")) ? String(source.part) : "";
  return {
    id: ID.test(String(source.id)) ? String(source.id) : "",
    key,
    asset,
    name: String(source.name ?? "").slice(0, 80),
    width: Math.round(Math.min(8192, Math.max(1, Number(source.width) || 1))),
    height: Math.round(Math.min(8192, Math.max(1, Number(source.height) || 1))),
    point: centre,
    normal,
    angle: Number.isFinite(angle) ? round(((((angle + 180) % 360) + 360) % 360) - 180, 2) + 0 : 0,
    metres,
    part,
  };
}

/** Свободный `id` в списке: `w1`…`w99`. */
function nextWallId(items) {
  const taken = new Set(items.map((item) => item.id));
  for (let index = 1; index < 100; index += 1) if (!taken.has(`w${index}`)) return `w${index}`;
  return "w99";
}

/**
 * Список стен работы: не больше `BUILDING_WALL_LIMIT`, свой `id` — если он не повторяется;
 * та же стена (`key`) — одна запись, последняя замещает прежнюю.
 */
export function normalizeBuildingWalls(source) {
  const raw = Array.isArray(source) ? source : [];
  const out = [];
  for (const item of raw.slice(0, BUILDING_WALL_LIMIT * 2)) {
    const wall = normalizeBuildingWall(item);
    if (!wall) continue;
    const same = out.findIndex((other) => other.key === wall.key);
    if (same >= 0) out.splice(same, 1);
    out.push(wall);
  }
  const used = new Set();
  const limited = out.slice(-BUILDING_WALL_LIMIT);
  for (const item of limited)
    if (item.id && !used.has(item.id)) used.add(item.id);
    else item.id = "";
  for (const item of limited)
    if (!item.id) {
      item.id = nextWallId(limited);
      used.add(item.id);
    }
  return limited;
}

/** Наклейка стены для кадра, плашки и дальних планов: `{ id, key, asset, point, normal, width, height, angle, opacity }`. */
export function buildingWallDecal(wall) {
  return { id: wall.id, key: wall.key, asset: wall.asset, point: wall.point, normal: wall.normal, width: wall.metres[0], height: wall.metres[1], angle: wall.angle, opacity: 1 };
}

/** Лист плашки стены по размеру рамки: степени двойки по пропорции, длинная сторона — `BUILDING_WALL_SIDE` (или меньше, если картинка меньше). */
export function buildingWallSheet(metres, longest = BUILDING_WALL_SIDE) {
  return sidePlateSize(metres[0], metres[1], longest);
}

/** Лист плашки по самой картинке: степени двойки не больше `BUILDING_WALL_SIDE` (картинку установщик не растягивает сверх своего размера). */
export function buildingWallTexture(image) {
  const powerOfTwo = (value) => Math.min(BUILDING_WALL_SIDE, Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, value)))));
  return [powerOfTwo(image.width), powerOfTwo(image.height)];
}

/** Плотность картинки на стене, пикселей на метр: по худшей из двух осей. */
export const buildingWallDensity = (sheet, metres) => round(Math.min(sheet[0] / metres[0], sheet[1] / metres[1]), 1);

/** Отступ плашки стены, м: каждая следующая на 1,5 мм дальше (шестнадцатая — всё ещё под плашками надписей, 6 см). */
export const buildingWallOffset = (index) => round(BUILDING_WALL_OFFSET + index * 0.0015, 4);
