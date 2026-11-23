import { overlaysUpdateRouteEnabled } from "@modovik/install-engine/overlays-update-route.js";

/*
 * Наложения тела (тату, бороды) через контейнер в `update.rpf` со стороны приложения (GTA 5 RP, 20.11.2026, `docs/RP-OVERLAYS-CONTAINER.md`): выключатель и журнал.
 * Выключатель — `ASTRAL_OVERLAYS_VIA_UPDATE` (`1`, `true`, `container`), свой, не общий с одеждой: механизм другой (картинка по имени), и откат одного не трогает другое.
 * Пусто — `null`, в настройки установки не попадает ничего: путь прежний, байт в байт (условие «не сломать Majestic»: у кого выключатель пуст, ничего не меняется).
 * Видимых человеку строк нет: строки уходят в журнал приложения.
 */
export function appOverlaysUpdateRoute({ note = () => {}, env = process.env } = {}) {
  if (!overlaysUpdateRouteEnabled(env)) return null;
  return { note };
}
