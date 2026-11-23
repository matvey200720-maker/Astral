import { roomWallSheet } from "@modovik/climb-contract/recolor/room-walls";

// Служебные «комнаты» таблицы покраски: вся арена и стены без номера комнаты.
const MARKERS = { everywhere: "*", unnumbered: "-" };
export const { everywhere: SHELL_PAINT_ALL, unnumbered: SHELL_PAINT_NONE } = MARKERS;

// Запрет режима «В комнате»: сервер и вид части, для которых листа не хватает.
export const shellRoomBlocked = (server, kind, room, material) =>
  server === "gta5rp" && kind === "structure" && !roomWallSheet(room, material);

// Ключ записи: оба значения приводятся к строке как есть («undefined», «null»).
export const shellPaintKey = (room, material) => [room, material].map(String).join("|");

export function shellRoomKey(room) {
  return room ? room : SHELL_PAINT_NONE;
}

// Своя запись комнаты важнее «всей арены»; ложные цвета пропускаются.
// Без комнаты или материала красить нечего, даже при общей записи.
export function shellPaintOf(paint, room, material) {
  if (!(paint && room && material)) return null;
  const pick = (found, owner) => found || paint[shellPaintKey(owner, material)];
  return [room, SHELL_PAINT_ALL].reduce(pick, null) || null;
}
