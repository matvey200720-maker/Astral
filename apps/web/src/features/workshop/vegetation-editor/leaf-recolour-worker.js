/*
 * Поток перекраски листов растительности (ТЗ 22.10.2026, п. 1: «В разнобой» лагает).
 *
 * Цвет палитры, густота и свой цвет породы перекрашивали листы на главном потоке: лист 256×256 стоит ~7 мс,
 * 512×512 ~27 мс, в роще на смену цвета их набиралось десятки подряд, и окно стояло в долгих кадрах (Chrome ×4:
 * ~0,5–1,5 с главного потока на шаг палитры). Правка та же — `recolourLeafLevel`, что у установщика: пиксели те
 * же байт в байт, меняется только поток, где они считаются.
 *
 * Задание: `{ id, key, base?, params }` — `base` (`{ rgba, width, height }`, исходный лист игры) приходит один раз
 * на ключ, дальше поток держит его у себя; `params` — то, что берёт `recolourLeafLevel` (эффект уже собран в окне).
 * Ответ: `{ id, rgba }` (передаётся без копии) или `{ id, error }`. Поток везёт только пиксельный цикл: ни слов
 * окна, ни разбора работы — закрытие держит его уровнем light (`LIGHT_WEB_CHUNKS`).
 */

import { recolourLeafLevel } from "@modovik/climb-contract/recolor/vegetation";

/* Исходных листов в кадре — десятки; старые ключи (прежняя сцена) уходят первыми. */
const BASE_LIMIT = 220;
const bases = new Map();

self.onmessage = (event) => {
  const { id, key, base, params } = event.data || {};
  try {
    if (base) {
      bases.delete(key);
      bases.set(key, base);
      while (bases.size > BASE_LIMIT) bases.delete(bases.keys().next().value);
    }
    const source = bases.get(key);
    if (!source) {
      self.postMessage({ id, error: "base" });
      return;
    }
    const done = recolourLeafLevel(source.rgba, source.width, source.height, params);
    /* Ничего не меняется — тот же массив: отдаём копию, исходный остаётся у потока. */
    const out = done === source.rgba ? new Uint8ClampedArray(done) : done;
    self.postMessage({ id, rgba: out }, [out.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
