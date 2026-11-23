/*
 * Третий пакет растительности по каналам (19.11.2026, решение по итогам проверки в игре —
 * `launcher_app/docs/VEGETATION-THIRD-PACK.md`, раздел 4).
 *
 * В альфе работа, которой мало двух пакетов, ложится в три сама: в сюжетном режиме GTA V три пакета сверены (загрузка,
 * кадры, снятие, переход между раскладками, откат на прежнюю сборку). На серверах (Majestic, GTA 5 RP) их никто не
 * смотрел, поэтому в бете и релизе выключатель остаётся выключенным — там такая работа по-прежнему получает отказ.
 *
 * Слово в окружении (`off`, `1`, `force`) сильнее умолчания канала. Видимых человеку строк здесь нет.
 */

import { VEGETATION_THIRD_PACK_ENV } from "@modovik/install-engine/vegetation-ids.js";

/** Канал, где третий пакет включён по умолчанию. */
export const VEGETATION_THIRD_PACK_CHANNEL = "alpha";

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyVegetationThirdPackDefault({ channel, env = process.env } = {}) {
  if (channel !== VEGETATION_THIRD_PACK_CHANNEL) return null;
  if (String(env[VEGETATION_THIRD_PACK_ENV] ?? "").trim() !== "") return null;
  env[VEGETATION_THIRD_PACK_ENV] = "1";
  return "1";
}
