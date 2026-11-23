/*
 * Высоты зданий по районам штата (21.11.2026) — для «3D-зданий» геометрией (`stack-minimap-tiles` нативного хоста, проба).
 *
 * Настоящих высот у нас нет: ни в плитках радара (кварталы — плоские слои на высоте 6), ни в данных редактора. Поэтому высота — оценка по
 * району: центр города высокий, окраины низкие. Список ниже — не измерение, а договорённость «похоже на GTA V»: небоскрёбы Downtown и
 * Pillbox Hill (до ~90 м, у Maze Bank Tower настоящие 200+, но кварталы радара — это склейки соседних домов, и такая высота съела бы
 * карту), средние кварталы Рокфорда и Вайнвуда, низкие Давис и Ранчо, сельские районы совсем низкие. Дальше нативный хост домножает на
 * площадь квартала (огромные склады и аэродромы — низкие, мелкие сараи — ниже) и добавляет стабильный разброс ±22 %.
 *
 * Модуль чистый: сетка — `Uint8Array` метров на клетку 50 м по атласу карты паузы; ноль — «нет данных» (хост берёт запасное значение).
 */

import ZONE_CELLS from "./zone-cells.json" with { type: "json" };
import { DEFAULT_ATLAS, atlasSize } from "./projection.js";
import { WORLD_DISTRICTS } from "./districts.js";

/** Высота по коду зоны игры, метры. Что не названо — `WILD` у диких районов, `DEFAULT` у остальных. */
export const ZONE_HEIGHT = Object.freeze({
  /* Центр. */
  Downt: 90,
  LegSqu: 80,
  PBOX: 70,
  TEXTI: 60,
  SKID: 34,
  /* Богатые и деловые. */
  Morn: 45,
  Rockf: 40,
  Burton: 40,
  Hawick: 38,
  Alta: 36,
  DTVine: 34,
  Koreat: 32,
  Richm: 30,
  WVine: 28,
  Vine: 24,
  DelPe: 24,
  RGLEN: 22,
  LAct: 22,
  Vesp: 20,
  Mirr: 20,
  East_V: 20,
  /* Жилые и промышленные. */
  Banning: 18,
  Termina: 18,
  DelSol: 18,
  STRAW: 18,
  ELGorL: 18,
  VCana: 16,
  Elysian: 16,
  Stad: 16,
  Davis: 14,
  ChamH: 14,
  Cypre: 14,
  LMesa: 14,
  LosPuer: 14,
  Murri: 14,
  Movie: 14,
  HumLab: 14,
  RANCHO: 12,
  Beach: 12,
  DelBe: 12,
  /* Низкие: аэропорт, гольф, посёлки. */
  AirP: 10,
  Sandy: 8,
  Paleto: 8,
  Harmo: 8,
  GrapeS: 7,
  Golf: 6,
});
const DEFAULT = 10;
const WILD = 5;
const CELL = 50;

const wildCodes = new Set(WORLD_DISTRICTS.filter((district) => district.wild).map((district) => district.zoneCode));

/** Высота по коду зоны. */
export const zoneHeight = (code) => ZONE_HEIGHT[code] ?? (wildCodes.has(code) ? WILD : DEFAULT);

/**
 * Сетка высот по атласу карты паузы: `{ x0, y0, cell, cols, rows, fallback, values }`. Зоны рисуются от больших к малым: у перекрывающихся
 * районов побеждает меньший (Вайнвуд внутри Лос-Сантоса).
 */
export function blockHeightGrid({ atlas = DEFAULT_ATLAS, cell = CELL } = {}) {
  const size = atlasSize(atlas);
  const cols = Math.ceil(size.width / cell);
  const rows = Math.ceil(size.height / cell);
  const values = new Uint8Array(cols * rows);
  const rects = [];
  for (const [code, list] of Object.entries(ZONE_CELLS))
    for (const rect of list) rects.push({ ...rect, height: zoneHeight(code) });
  rects.sort((left, right) => (right.maxX - right.minX) * (right.maxY - right.minY) - (left.maxX - left.minX) * (left.maxY - left.minY));
  for (const rect of rects) {
    const c0 = Math.max(0, Math.floor((rect.minX - atlas.originX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((rect.maxX - atlas.originX) / cell));
    const r0 = Math.max(0, Math.floor((atlas.originY - rect.maxY) / cell));
    const r1 = Math.min(rows - 1, Math.floor((atlas.originY - rect.minY) / cell));
    for (let row = r0; row <= r1; row += 1)
      for (let column = c0; column <= c1; column += 1) values[row * cols + column] = rect.height;
  }
  return { x0: atlas.originX, y0: atlas.originY, cell, cols, rows, fallback: DEFAULT, values };
}
