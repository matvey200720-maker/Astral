import { clothingUpdateRouteEnabled } from "@modovik/install-engine/clothing-update-route.js";

/*
 * Одежда через контейнер в `update.rpf` со стороны приложения (GTA 5 RP, 20.11.2026, `docs/RP-CLOTHING-CONTAINER.md`): выключатель и журнал.
 *
 * Выключатель — `ASTRAL_CLOTHING_VIA_UPDATE` (`1`, `true`, `container`); пуст — `null`, и в настройки установки не попадает ничего: путь прежний.
 * Режим берёт пакеты только вместе с дозаписью (`ASTRAL_ENGINE_CATALOG_APPEND=catalog`). Переписи игры одежда не просит: папка педа уже стоит в записи пакета.
 * Видимых человеку строк нет: строки уходят в журнал приложения.
 */
export function appClothingUpdateRoute({ note = () => {}, env = process.env } = {}) {
  if (!clothingUpdateRouteEnabled(env)) return null;
  return { note };
}
