import { PLACES_DLC_SETS, PLACES_MAP_SETS } from "./places-dlc.js";
import { RECOLOR_SETS } from "./recolor-manifest-trust.js";
import { ROADS_CONTAINER_MAX_BYTES, roadsBudgetBytes, roadsCostBytes } from "./roads-update-route.js";

/*
 * Места мастерской через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026, разбор `rp-places-design.md`): набор кладётся в свой контейнер слоя `x64/astral/astral_<набор>.rpf` самого `update.rpf` —
 * архив, который клиент GTA 5 RP открывает (пакеты `astral_*` на RP не монтируются; сервер контейнер читает, снято владельцем 20.11). Контейнер Astral перекрывает потоковые модели и словари по имени.
 *
 * Едет НАБОР ЦЕЛИКОМ или отказ с кодом до первой записи — половина набора даёт дыры. Целиком — десять наборов без перекрытий карт и типов Rockstar (`overrides` = 0) и без сетевой карты
 * (`GROUP_MAP`): типы и карты из `patchday*` главнее контейнера, а `hei_`-файлы идут в архивы сетевой карты пакета. Остальные восемь — отказ `overrides` / `map-set`.
 * Бюджет — общий с дорогами и растительностью (`roadsBudgetBytes`): по ЖИВОЙ длине `update.rpf`, где уже лежат поставленные контейнеры. Выключатель `ASTRAL_PLACES_VIA_UPDATE=container`, по умолчанию
 * ВЫКЛЮЧЕН: без него поведение прежнее байт в байт (для Majestic ничего не меняется). Если режим включён САМ (метка `ASTRAL_RP_MODE_AUTO`), отказ превращается в «ставим прежним путём» (решает вызывающий).
 * Модуль чистый: ввода-вывода нет.
 */

export const PLACES_VIA_UPDATE_ENV = "ASTRAL_PLACES_VIA_UPDATE";
/** Метка режима RP в альфе: список выключателей, которые поставил сам режим (читается без импорта, как `isRpModeAuto`). */
export const PLACES_RP_MODE_AUTO_ENV = "ASTRAL_RP_MODE_AUTO";
export const PLACES_UPDATE_TARGET = "update/update.rpf";

export const PLACES_REFUSAL_CODES = Object.freeze(["over-budget", "container-too-big", "overrides", "map-set", "packs-standing", "no-visible"]);

/** Наборы, что едут целиком: без перекрытий карт и типов игры и без сетевой карты. */
export const PLACES_WHOLE_SETS = Object.freeze(PLACES_DLC_SETS.filter((id) => RECOLOR_SETS[id] && RECOLOR_SETS[id].overrides.length === 0 && !PLACES_MAP_SETS.includes(id)));

/** Наборы, что на RP едут ЧАСТЬЮ (21.11.2026, `arena-rp-parts.js`, `places-rp-parts.js`): перекрытия карт и типов игры и всё, что едет только с ними, не кладутся; остальное — контейнером. Ответ `placesEligibility` у них прежний (`overrides` или `map-set`). */
export const PLACES_PARTIAL_SETS = Object.freeze(["arenas", "factory", "mapping", "megamall", "youtool", "billboards"]);

export const placesPartialSet = (setId) => PLACES_PARTIAL_SETS.includes(setId);

export function placesUpdateRouteEnabled(env = {}) {
  return ["container", "1", "true"].includes(String(env?.[PLACES_VIA_UPDATE_ENV] ?? "").trim().toLowerCase());
}

/** Включено ли автоматически: выключатель назван в метке режима RP (а не поставлен человеком). */
export function placesRouteAuto(env = {}) {
  return String(env?.[PLACES_RP_MODE_AUTO_ENV] ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(PLACES_VIA_UPDATE_ENV);
}

function setOf(setId) {
  const set = RECOLOR_SETS[setId];
  if (!set || !PLACES_DLC_SETS.includes(setId)) throw new Error(`Набора мест «${setId}» нет: в контейнер update.rpf едут только наборы мест.`);
  return set;
}

/** Может ли набор ехать контейнером: `{ ok: true }` или `{ ok: false, code, count }` (`map-set` — сетевая карта, `overrides` — перекрытия карт и типов игры). */
export function placesEligibility(setId) {
  const set = setOf(setId);
  /* Арена в сетевую карту кладёт только здание Majestic (`ARENA_MAP_FILES`, 21.11.2026; с 26.11 — зеркалом к копии на старте): отказ контейнеру у неё прежний — перекрытия типов и карт. */
  if (setId !== "arenas" && PLACES_MAP_SETS.includes(setId)) return { ok: false, code: "map-set", count: set.overrides.length };
  if (set.overrides.length) return { ok: false, code: "overrides", count: set.overrides.length };
  return { ok: true, code: null, count: 0 };
}

/** Запись файла набора в `update.rpf`: в контейнер слоя набора (`x64/astral/astral_<набор>.rpf`), имя как у файла. */
export const placesContainerEntry = (setId, name) => `${setOf(setId).layer}/${String(name)}`;

/** Бюджет тот же, что у дорог и растительности: предел минус живая длина `update.rpf`, резерв и запас. */
export const placesBudgetBytes = (options) => roadsBudgetBytes(options);

/**
 * Выбор набора под бюджет: набор целиком или никак. `files` — `[{ name, size }]` (размеры собранных или штатных файлов). Ответ: `{ fits, code, bytes, cost, budget, count }`;
 * `code`: `null`, `over-budget` (цена не влезла) или `container-too-big` (контейнер больше предела 1 ГиБ).
 */
export function selectPlacesSet({ setId, files = [], budget } = {}) {
  setOf(setId);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Бюджет мест не назван.");
  let bytes = 0;
  for (const file of files) {
    if (!Number.isFinite(file?.size) || file.size < 0) throw new Error(`У файла ${file?.name} неверный размер.`);
    bytes += file.size;
  }
  const cost = roadsCostBytes(files.length, bytes);
  const base = { bytes, cost, budget, count: files.length };
  if (cost > ROADS_CONTAINER_MAX_BYTES) return { ...base, fits: false, code: "container-too-big" };
  if (cost > budget) return { ...base, fits: false, code: "over-budget" };
  return { ...base, fits: true, code: null };
}

const PACK_TARGET = /^update\/x64\/dlcpacks\/astral_places\/dlc\.rpf$/i;

/** Стоит ли этот набор мест в пакете `astral_places` (по записям установленных работ): режим при этом отказывает — автопереноса нет. */
export function placesPacksStanding({ setId, installed = [] } = {}) {
  const mark = `local-legacy-${setId}-`;
  return (installed || []).some((item) => String(item?.modId || "").startsWith(mark) && (item?.archiveEntries || []).some((entry) => PACK_TARGET.test(String(entry?.target || ""))));
}

const LINES = {
  "over-budget": ({ setId, needMiB, budgetMiB }) => `набор ${setId} не влезает в update.rpf (нужно ${needMiB ?? "?"} МиБ, свободно ${budgetMiB ?? "?"} МиБ) и остаётся как в игре`,
  "container-too-big": ({ setId }) => `набор ${setId} больше предела одного контейнера (1 ГиБ) и в update.rpf не помещается`,
  overrides: ({ setId, count }) => `набор ${setId} перекрывает ${count ?? "?"} файлов карт и типов игры: из контейнера их перебьёт пакет Rockstar, половина набора дала бы дыры — ставьте набор пакетом`,
  "map-set": ({ setId }) => `набор ${setId} кладёт файлы в архивы сетевой карты (GROUP_MAP): контейнером они не едут — ставьте набор пакетом`,
  /* Билборды (21.11.2026): ни один щит работы на RP не виден; слова человеку — окно (`rp-update-notes.js`), здесь строка журнала. */
  "no-visible": ({ setId, total }) => `ни один из ${total ?? "?"} щитов работы набора ${setId} не виден на GTA 5 RP: листы щитов лежат в пакетах игры дальше границы проб, а копии словарей и типы районов контейнером не едут`,
  "packs-standing": ({ setId }) => `набор ${setId} уже стоит в пакете astral_places: снимите его («Откатить») и поставьте через update.rpf заново`,
};

/** Строка журнала об отказе: с кодом и числами, без внутренностей кода. */
export function placesRefusalLine(code, params = {}) {
  const build = LINES[code];
  if (!build) throw new Error(`Неизвестный код отказа мест: ${code}`);
  return `Места через update.rpf, отказ ${code}: ${build(params)}.`;
}
