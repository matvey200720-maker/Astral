import { appCatalogAppend } from "./catalog-append.js";
import { appClothingUpdateRoute } from "./clothing-update-install.js";
import { appOverlaysUpdateRoute } from "./overlays-update-install.js";

/*
 * Настройки установки «одежда через контейнер в update.rpf» для замен мастерской и каталога (`clothing-replace.js`, 20.11.2026): маршрут и дозапись.
 * Выключатель пуст (`ASTRAL_CLOTHING_VIA_UPDATE`) — пустой объект, и установка идёт как раньше. Дозапись включена своим выключателем
 * (`ASTRAL_ENGINE_CATALOG_APPEND=catalog`); без неё маршрут сам откажется строкой в журнале.
 * Наложения тела (`ASTRAL_OVERLAYS_VIA_UPDATE`, свой выключатель) идут тем же объектом: `overlaysUpdateRoute`.
 * `deps.clothingContainer` — подмена для тестов (`{ clothingUpdateRoute, overlaysUpdateRoute, appendInstall }`).
 */
export async function clothingContainerOptions(stateDir, deps = {}, env = process.env) {
  if (deps.clothingContainer) return deps.clothingContainer;
  const note = (message) => console.warn(`[astral] ${message}`);
  const clothingUpdateRoute = appClothingUpdateRoute({ env, note });
  const overlaysUpdateRoute = appOverlaysUpdateRoute({ env, note });
  if (!clothingUpdateRoute && !overlaysUpdateRoute) return {};
  const appendInstall = appCatalogAppend({ stateDir, env, note });
  return { ...(clothingUpdateRoute ? { clothingUpdateRoute } : {}), ...(overlaysUpdateRoute ? { overlaysUpdateRoute } : {}), ...(appendInstall ? { appendInstall } : {}) };
}
