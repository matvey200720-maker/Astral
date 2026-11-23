import { arenaObjects } from "./arena-objects.js";

// Какие модели арены считать экранами (rp-route, 20.11.2026, правило владельца: «в мастерской люди ставят как хотят, свои модельки и т. д.»).
//
// Правило одно для любого проекта, не подгонка под одну арену:
//   — картинка на экране, мониторе или табло — всегда листом на месте; модель экрана не заменяется;
//   — объёмная картинка («Своя картинка → объём»), поставленная на экран, встаёт ОТДЕЛЬНОЙ дописанной сущностью зала ПЕРЕД экраном,
//     а сам экран остаётся серверным (в Majestic его замена ломала стену: у №200033 «festival_monitor_modified» стена исчезала, а плита
//     вставала посреди зала, кадры 21 и 31 разбора 20.11.2026);
//   — вещь, чья замена задумана пользователем (аирдроп), остаётся перенаправлением (способ Б2, `recolor-arenas.js`).
// Список имён — здесь и только здесь; им пользуются сборщик (`recolor-arena-screens.js`), проверка самопроверки и предпросмотр мастерской.

/* Части имени модели игры или сервера, по которым вещь считается экраном (регистр не важен). `fake_screen`, `longscreen`,
   `circle_screen`, `screen_touch` ловит `screen`; `gamingmonitor_solo`, `festival_monitor_modified` — `monitor`. */
export const ARENA_SCREEN_NAME_PARTS = Object.freeze([
  "monitor",
  "screen",
  "standings",
  "scoreboard",
  "tv_",
]);

/* Модели, что по имени похожи на экран, но им не являются: решение руками, с причиной. */
export const ARENA_SCREEN_NOT_SCREENS = Object.freeze([
  /* Крышка шкафа/домика, а не экран: имя содержит `screen` случайно (на сегодня таких в описи Majestic нет). */
]);

/** Имя модели → экран ли это. */
export function isArenaScreenModel(name) {
  const text = String(name || "").toLowerCase();
  if (!text || ARENA_SCREEN_NOT_SCREENS.includes(text)) return false;
  return ARENA_SCREEN_NAME_PARTS.some((part) => text.includes(part));
}

/** Зазор между лицом экрана и объёмной картинкой перед ним, м (решение ведущей 20.11.2026). */
export const ARENA_SCREEN_PLATE_GAP = 0.5;

/**
 * Группа предметов зала — «Своя картинка → объём» на экране (Majestic): экран остаётся, плита встаёт перед ним (сборщик
 * `arenaScreenPlateGroups`, кадр мастерской `arenaItemKeys`). Одно правило на сборку и кадр.
 */
export function isArenaScreenPlateGroup(server, group) {
  if (server !== "majestic" || group?.kind !== "picture" || !group.keys?.length)
    return false;
  const objects = arenaObjects(server);
  if (!objects) return false;
  return group.keys.every((key) =>
    isArenaScreenModel(objects.models[objects.byKey.get(key)?.model]?.name),
  );
}
