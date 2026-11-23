/*
 * Листы меток из игры игрока, запомненные окном (задача 21 ТЗ 18.10.2026): редактор прочёл их один раз
 * (`readGroupMarkers`), а обложка полки рисуется без обращения к игре — берёт их отсюда. Лежат в
 * хранилище окна PNG по 128 точек на метку (около 30 КБ всего); игры не было — обложка рисует
 * метки очерком Astral и говорит об этом подсказкой.
 */

const STORAGE_KEY = "astral.group-markers.stock.v1";

/** Лист метки для окна: самый крупный из её листов (у накладки радара — её штатная картинка) в PNG base64 или `null`. */
export const largestStockPng = (entry) =>
  entry?.overlay?.stockPng || [...(entry?.targets || [])].filter((target) => target.stockPng).sort((a, b) => b.width * b.height - a.width * a.height)[0]?.stockPng || null;

/** Запомнить листы из ответа `readGroupMarkers`. */
export function rememberGroupMarkerStock(state, storage = globalThis.localStorage) {
  const stock = {};
  for (const entry of state?.marks || []) {
    const png = largestStockPng(entry);
    if (png) stock[entry.id] = png;
  }
  if (!Object.keys(stock).length) return false;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(stock));
    return true;
  } catch {
    return false;
  }
}

/** Запомненные листы: `{ id: PNG base64 }` (пусто, если игры ещё не читали). */
export function readGroupMarkerStock(storage = globalThis.localStorage) {
  try {
    const stock = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}");
    return stock && typeof stock === "object" && !Array.isArray(stock) ? stock : {};
  } catch {
    return {};
  }
}
