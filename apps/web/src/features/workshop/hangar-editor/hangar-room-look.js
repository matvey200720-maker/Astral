/*
 * Мастерская ангара — цвета, часть В: облик комнаты в кадре.
 * Договор крючка (общий у частей А, Б, В): `(project, info, look) → look` — облик материала кадра после предыдущих частей; `info` — материал сцены (`group`, `sheet`, `colour`, `emissive` …).
 *
 * Тон листа — та же арифметика, что у установщика: цвет и опорная яркость листа даёт `hangarRoomSheetLook` договора (`hangar-room.js`); лист комнаты красится БЕЗ чистки (`clean: false`: чистка задумана для
 * ржавчины стен ангара, а у комнаты её нет), рисунок штатного листа остаётся целиком — и в кадре (`look.clean` не ставится), и в установщике.
 * Листы комнаты в кадре — материалы нутра без группы: штатный облик у них «как есть», тон кладёт этот крючок. Листа нет в описи или цвет не задан — облик как есть: заглушек цветом нет.
 */
import { hangarRoomSheetLook } from "@modovik/climb-contract/recolor/hangar-room";

/* Быстрые цвета потолка: светлые, серые и тёмные. */
export const HANGAR_ROOM_CEILING_SWATCHES = Object.freeze(["#e9ecef", "#cfd4da", "#8d949c", "#3d4a5c", "#1b1d22", "#f1e6c8", "#c9a227", "#1f5fae"]);
/* Быстрые цвета стен комнаты: нейтральные, тёплые и яркие. */
export const HANGAR_ROOM_WALLS_SWATCHES = Object.freeze(["#8d949c", "#e9ecef", "#3d4a5c", "#1b1d22", "#7a7457", "#b8a3cc", "#a4161a", "#1f5fae", "#3f6b4f", "#f2c200"]);
/* Быстрые цвета плитки пола: серые, тёмные и тёплые. */
export const HANGAR_ROOM_FLOOR_SWATCHES = Object.freeze(["#6d6f6a", "#8d949c", "#cfd4da", "#3d4a5c", "#1b1d22", "#7a7457", "#a4161a", "#1f5fae"]);
/* Быстрые цвета ковра: тёмные, яркие и приглушённые. */
export const HANGAR_ROOM_RUG_SWATCHES = Object.freeze(["#1f5fae", "#a4161a", "#3f6b4f", "#1b1d22", "#8d949c", "#5a2a82", "#d9621f", "#f2c200"]);

export function hangarRoomFrameLook(project, info, look) {
  if (!look || look.visible === false || look.tint) return look;
  const room = hangarRoomSheetLook(project, info?.sheet);
  if (!room) return look;
  /* Без чистки листа (`room.clean === false`): у комнаты рисунок штатного листа остаётся целиком — как в установщике. */
  return { ...look, tint: { colour: room.colour, ref: room.ref, brightness: room.brightness } };
}
