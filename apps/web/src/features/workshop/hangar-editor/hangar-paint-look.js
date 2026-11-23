/*
 * Мастерская ангара — цвета, часть Б: облик конструкций и труб в кадре.
 * Договор крючка (общий у частей А, Б, В): `(project, info, look) → look` — облик материала кадра после предыдущих частей; `info` — материал сцены (`group`, `sheet`, `colour`, `emissive` …).
 *
 * Тон листа — та же арифметика, что у установщика: цвет и опорная яркость листа даёт `hangarPaintSheetLook` договора (`hangar-paint.js`); листы крана, вентиляции, галереи и труб красятся БЕЗ чистки (`clean: false`,
 * рисунок игры остаётся целиком) — `look.clean` не ставится, как и в установщике.
 * Лист балок стоит в группе «frame» и красится штатным путём (`hangarSheetLook`: цвет конструкций перебивает цвет «внутри», лист чистится, как у стен), у него в облике уже есть `tint` — крючок его не трогает.
 * Листа нет в описи — облик как есть: заглушек цветом нет.
 */
import { hangarPaintSheetLook } from "@modovik/climb-contract/recolor/hangar-paint";

/* Быстрые цвета конструкций: сталь, чернь, армейские, жёлтый кран, яркие для банд и семей. */
export const HANGAR_STRUCTURE_SWATCHES = Object.freeze(["#8d949c", "#3d4a5c", "#1b1d22", "#4f5d3a", "#d6b01c", "#f2c200", "#d9621f", "#a4161a", "#1f5fae", "#e9ecef"]);
/* Быстрые цвета труб: синяя краска игры, сталь, чернь, жёлтая, красная, зелёная. */
export const HANGAR_PIPES_SWATCHES = Object.freeze(["#1f5fae", "#8d949c", "#1b1d22", "#f2c200", "#a4161a", "#3f6b4f", "#e9ecef", "#d9621f"]);

/* `table` — опись красящихся листов (по умолчанию настоящая; подставляется в проверках). */
export function hangarPaintFrameLook(project, info, look, table = undefined) {
  if (!look || look.visible === false || look.tint) return look;
  const paint = hangarPaintSheetLook(project, info?.sheet, table);
  if (!paint) return look;
  return { ...look, tint: { colour: paint.colour, ref: paint.ref, brightness: paint.brightness } };
}
