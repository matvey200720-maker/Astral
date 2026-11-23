/*
 * Вкладки выбора цели «На что поставить?» (владелец, 14.11.2026): GTA — штатные вещи игры, что продаются в магазинах на любом сервере (RAGE MP и Majestic), Majestic и GTA 5 RP —
 * вещи самих проектов. `server` — проект вещей вкладки (`null` — у штатной вещи проекта нет); маршрут установки решает сама вещь-цель (`target.server`), а не вкладка
 * (`apps/desktop/src/clothing-route.js`). RMRP во вкладках нет — его данные и код базы остаются (`SERVERS` в `taxonomy.js`).
 *
 * Отдельным модулем, не в `taxonomy.js`: словарь вида вещи живёт в стартовом куске окна, а вкладки нужны только выбору цели (грузится лениво).
 */

const TAB_ROWS = [
  ["gta", "GTA", null],
  ["majestic", "Majestic", "majestic"],
  ["gta5rp", "GTA 5 RP", "gta5rp"],
];

export const TARGET_TABS = Object.freeze(
  TAB_ROWS.map(([id, label, server]) => Object.freeze({ id, label, server })),
);

/** Вкладка штатных вещей игры: по умолчанию, проекта у неё нет. */
export const GTA_TAB = TAB_ROWS[0][0];

/** Вкладка по id: своя или `null` (у RMRP и неизвестных вкладки нет). */
export function tabById(tab) {
  return TARGET_TABS.find((entry) => entry.id === tab) ?? null;
}

/** Проект вкладки: «gta» — `null` (штатные вещи), «majestic» / «gta5rp» — их id; неизвестная вкладка — `null`. */
export function tabServer(tab) {
  return tabById(tab)?.server ?? null;
}

/** Вкладка вещи по её проекту: без проекта — «GTA», у проекта без вкладки (RMRP) — `null`. */
export function tabOfServer(server) {
  if (!server) return GTA_TAB;
  return TARGET_TABS.find((entry) => entry.server === server)?.id ?? null;
}
