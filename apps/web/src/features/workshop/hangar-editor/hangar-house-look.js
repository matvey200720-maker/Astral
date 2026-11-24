/*
 * Мастерская ангара — «Дом» внутри ангара: облик дома в кадре.
 * Договор крючка (общий у частей А, Б): `(project, info, look) → look` — облик материала кадра после предыдущих частей; `info` — материал сцены (`sheet`, `group`, `colour`).
 *
 * Тон листа — та же арифметика, что у установщика: цвет и опорная яркость листа даёт `hangarHouseSheetLook` договора (`hangar-house.js`). Чистки листа нет ни здесь, ни у установщика
 * (`look.clean === false`): у блоков и стекла дома нет ржавчины стен ангара, рисунок штатного листа остаётся целиком. Листы дома в кадре — материалы нутра без группы: штатный облик у них
 * «как есть», тон кладёт этот крючок. Цоколь «Снаружи» (тот же лист `im_wall_brick_38` в модели корпуса, группа outside) сюда не попадает: его красит облик «Снаружи».
 */
import { hangarHouseSheetLook } from "@modovik/climb-contract/recolor/hangar-house";

/* Быстрые цвета стен дома: светлые, тёплые и яркие. */
export const HANGAR_HOUSE_WALLS_SWATCHES = Object.freeze(["#bebcb6", "#e9ecef", "#8d949c", "#3d4a5c", "#1b1d22", "#7a7457", "#a4161a", "#1f5fae", "#3f6b4f", "#f2c200"]);
/* Быстрые цвета окон: голубые, серые и тёмные. */
export const HANGAR_HOUSE_WINDOWS_SWATCHES = Object.freeze(["#7f9bb3", "#8d949c", "#3d4a5c", "#1b1d22", "#1f5fae", "#3f6b4f", "#a4161a", "#f2c200"]);

export function hangarHouseFrameLook(project, info, look) {
  if (!look || look.visible === false || look.tint) return look;
  /* Только материал нутра: у корпуса тот же лист блоков — цоколь, его красит «Снаружи». */
  if (info?.group === "outside" || info?.group === "inside" || info?.group === "floor") return look;
  const house = hangarHouseSheetLook(project, info?.sheet);
  if (!house) return look;
  return { ...look, tint: { colour: house.colour, ref: house.ref, brightness: house.brightness } };
}
