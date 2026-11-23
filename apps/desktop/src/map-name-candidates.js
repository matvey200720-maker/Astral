/*
 * Имена, которые дороги и растительность вправе писать, — кандидаты для чтения `GROUP_MAP` игры (`game-map-names.js`, 26.10.2026). Читатель сверяет с ними
 * архивы `GROUP_MAP` штатных пакетов и оставляет только те имена, что лежат исключительно там; один список на набор — один кэш на набор и игру.
 */

import roads from "@modovik/climb-contract/recolor/inventory/roads";
import { PLACES_MAP_SETS } from "@modovik/install-engine/places-dlc.js";
import { RECOLOR_SETS } from "@modovik/install-engine/recolor-manifest-trust.js";
import { VEGETATION_ALLOWED_NAMES } from "@modovik/install-engine/vegetation-manifest-trust.js";

const lower = (name) => String(name).toLowerCase();

/** Словари и модели дорог из описи (`inventory/roads.js`). */
export const roadsMapCandidates = () => new Set([...roads.files, ...(roads.models || [])].map((file) => lower(file.name)));

/** Все имена, какие манифест растительности вправе везти. */
export const vegetationMapCandidates = () => new Set([...VEGETATION_ALLOWED_NAMES].map(lower));

/**
 * Все имена мест с архивами сетевой карты (`PLACES_MAP_SETS`: завод, ангар, маппинг, магазины, билборды): файлы, типы и карты набора, перекрытия игры.
 * Один список на все места — один проход по игре и один кэш; каждое место берёт из ответа своё.
 */
export const placesMapCandidates = () =>
  new Set(PLACES_MAP_SETS.flatMap((setId) => [...RECOLOR_SETS[setId].files, ...RECOLOR_SETS[setId].extra, ...(RECOLOR_SETS[setId].optional || []), ...(RECOLOR_SETS[setId].overrides || [])]).map(lower));

/** Кандидаты набора мастерской (`roads`, `vegetation`, `places`) или `null`, если у набора сетевой карты по игре нет. */
export function mapCandidatesOf(setId) {
  if (setId === "roads") return roadsMapCandidates();
  if (setId === "vegetation") return vegetationMapCandidates();
  if (setId === "places") return placesMapCandidates();
  return null;
}
