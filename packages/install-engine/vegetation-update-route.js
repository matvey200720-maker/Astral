import {
  ROADS_BUDGET_ALIGN_BYTES,
  ROADS_BUDGET_MARGIN_BYTES,
  ROADS_BUDGET_RESERVE_BYTES,
  ROADS_CONTAINER_MAX_BYTES,
  roadsBudgetBytes,
  roadsCostBytes,
} from "./roads-update-route.js";

/*
 * Растительность через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026): те же файлы, что сегодня едут в пакеты `astral_vegetation*`, но малым набором —
 * листва, модели и дальние планы выбранных ПОРОД — кладутся в контейнеры слоя `x64/astral/astral_rp_vegetation(_b).rpf` самого `update.rpf`. На RP пакеты
 * `astral_*` не монтируются, `update.rpf` читается; контейнер Astral перекрывает базовый словарь по имени файла (E8, X1b). На сервере RP не проверено,
 * поэтому режим за выключателем `ASTRAL_VEGETATION_VIA_UPDATE=container` и по умолчанию ВЫКЛЮЧЕН: без него поведение прежнее байт в байт (для Majestic ничего не меняется).
 *
 * Единица выбора — порода целиком (листва + модели + дальние планы): половина породы даёт дыры. Бюджет тот же, что у дорог (`roadsBudgetBytes`): он считается по ЖИВОЙ длине
 * `update.rpf`, а в ней уже лежат поставленные контейнеры дорог, одежды и оружия — второй набор сам видит меньшее место. Модуль чистый: ввода-вывода нет.
 */

export const VEGETATION_VIA_UPDATE_ENV = "ASTRAL_VEGETATION_VIA_UPDATE";
export const VEGETATION_UPDATE_TARGET = "update/update.rpf";
export const VEGETATION_UPDATE_CONTAINERS = Object.freeze(["astral_rp_vegetation.rpf", "astral_rp_vegetation_b.rpf"]);
const CONTAINER_ROOT = "x64/astral";

/** Порядок предложения пород: от малых к большим (кадр на МиБ, оценка); «растения» (дальние планы, ≈ 365 МиБ) — последними. */
export const VEGETATION_SPECIES_PRIORITY = Object.freeze([
  "palm",
  "oak",
  "birch",
  "maple",
  "cypress",
  "olive",
  "ficus",
  "mesquite",
  "joshua",
  "willow",
  "eucalyptus",
  "pine",
  "cedar",
  "bush",
  "tree",
  "plant",
]);

export const VEGETATION_REFUSAL_CODES = Object.freeze(["over-budget", "nothing-fits", "part-unavailable", "global-trees", "packs-standing"]);

export function vegetationUpdateRouteEnabled(env = {}) {
  return ["container", "1", "true"].includes(String(env?.[VEGETATION_VIA_UPDATE_ENV] ?? "").trim().toLowerCase());
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Контейнер для файла: FNV-1a имени строчными, чётное — первый, нечётное — второй. */
export const vegetationContainerOf = (name) => VEGETATION_UPDATE_CONTAINERS[fnv1a(String(name).toLowerCase()) % VEGETATION_UPDATE_CONTAINERS.length];

/** Запись файла в `update.rpf`: строчными, в корне контейнера слоя. */
export const vegetationUpdateEntry = (name) => `${CONTAINER_ROOT}/${vegetationContainerOf(name)}/${String(name).toLowerCase()}`;

/** Бюджет тот же, что у дорог: предел минус живая длина `update.rpf` (в ней уже все поставленные контейнеры), резерв и запас. */
export const vegetationBudgetBytes = (options) => roadsBudgetBytes(options);
export const vegetationCostBytes = roadsCostBytes;
export { ROADS_BUDGET_ALIGN_BYTES as VEGETATION_BUDGET_ALIGN_BYTES, ROADS_BUDGET_MARGIN_BYTES as VEGETATION_BUDGET_MARGIN_BYTES, ROADS_BUDGET_RESERVE_BYTES as VEGETATION_BUDGET_RESERVE_BYTES };
export const VEGETATION_CONTAINER_MAX_BYTES = ROADS_CONTAINER_MAX_BYTES;

function heaviestContainerCost(files) {
  const sides = new Map(VEGETATION_UPDATE_CONTAINERS.map((container) => [container, { count: 0, bytes: 0 }]));
  for (const [name, size] of files) {
    const side = sides.get(vegetationContainerOf(name));
    side.count += 1;
    side.bytes += size;
  }
  return Math.max(...[...sides.values()].map((side) => roadsCostBytes(side.count, side.bytes)));
}

function checkedGroups(groups) {
  const seen = new Set();
  return (groups || []).map((group) => {
    if (!VEGETATION_SPECIES_PRIORITY.includes(group?.id)) throw new Error(`Неизвестная порода: ${group?.id}`);
    if (seen.has(group.id)) throw new Error(`Порода ${group.id} названа дважды.`);
    seen.add(group.id);
    const files = (group.files || []).map((file) => {
      if (typeof file?.name !== "string" || !file.name) throw new Error(`Имя файла породы ${group.id} не названо.`);
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`У файла ${file.name} неверный размер.`);
      return { name: file.name.toLowerCase(), size: file.size };
    });
    return { id: group.id, files };
  });
}

/**
 * Выбор пород под бюджет: порода — целиком или никак. `groups` — `[{ id, files: [{ name, size }] }]`, `budget` — из `vegetationBudgetBytes`. Порода берётся, если объединение
 * файлов выбранных помещается (общий файл — один раз) и ни один контейнер не выходит за предел; иначе — `over-budget`, следующая меньшая проверяется всё равно.
 * Ответ: `{ chosen, refused: [{ id, code }], files, bytes, cost, budget, fits }`.
 */
export function selectVegetationSpecies({ groups = [], budget } = {}) {
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Бюджет растительности не назван.");
  const ordered = checkedGroups(groups).sort((a, b) => VEGETATION_SPECIES_PRIORITY.indexOf(a.id) - VEGETATION_SPECIES_PRIORITY.indexOf(b.id));
  const files = new Map();
  const chosen = [];
  const refused = [];
  for (const group of ordered) {
    const union = new Map(files);
    for (const file of group.files) union.set(file.name, file.size);
    const bytes = [...union.values()].reduce((sum, size) => sum + size, 0);
    if (roadsCostBytes(union.size, bytes) <= budget && heaviestContainerCost(union) <= ROADS_CONTAINER_MAX_BYTES) {
      chosen.push(group.id);
      for (const [name, size] of union) files.set(name, size);
    } else refused.push({ id: group.id, code: "over-budget" });
  }
  const bytes = [...files.values()].reduce((sum, size) => sum + size, 0);
  return { chosen, refused, files, bytes, cost: roadsCostBytes(files.size, bytes), budget, fits: chosen.length > 0 };
}

const PACK_TARGET = /^update\/x64\/dlcpacks\/astral_vegetation(?:_[a-z0-9]+)?\/dlc\.rpf$/i;
const PACK_NAMES = ["astral_vegetation", "astral_vegetation_b", "astral_vegetation_c"];

/** Стоят ли пакеты растительности: по записям установленных работ и по регистрации пакета. Режим при стоящих пакетах отказывает: автопереноса нет. */
export function vegetationPacksStanding({ installed = [], registrations = {} } = {}) {
  if (PACK_NAMES.some((name) => registrations && Object.hasOwn(registrations, name))) return true;
  return (installed || []).some((item) =>
    (item?.archiveEntries || []).some((entry) => PACK_TARGET.test(String(entry?.target || "")) || /^astral_vegetation(?:_[a-z0-9]+)?\.rpf\//i.test(String(entry?.entry || ""))),
  );
}

const names = (list) => (Array.isArray(list) && list.length ? list.join(", ") : "—");
const LINES = {
  "over-budget": ({ groups, needMiB, budgetMiB }) =>
    `породы ${names(groups)} не влезают в update.rpf (нужно ${needMiB ?? "?"} МиБ, свободно ${budgetMiB ?? "?"} МиБ) и остаются как в игре`,
  "nothing-fits": ({ groups, budgetMiB }) =>
    `ни одна из выбранных пород (${names(groups)}) не влезает в update.rpf (свободно ${budgetMiB ?? "?"} МиБ), в игру ничего не пишется`,
  "part-unavailable": ({ parts }) =>
    `части ${names(parts)} (улучшенные деревья, трава, цветы, посадка, «в разнобой») в этом режиме не помещаются в update.rpf и остаются как в игре`,
  "global-trees": () =>
    "общий цвет или густота листвы касаются всех пород сразу и в update.rpf не помещаются: оставьте цвет только отдельным породам или ставьте растительность пакетами",
  "packs-standing": () => "пакеты растительности astral_vegetation уже стоят: снимите растительность («Откатить») и поставьте её через update.rpf заново",
};

/** Строка журнала об отказе: с кодом, числами и без внутренностей кода. */
export function vegetationRefusalLine(code, params = {}) {
  const build = LINES[code];
  if (!build) throw new Error(`Неизвестный код отказа растительности: ${code}`);
  return `Растительность через update.rpf, отказ ${code}: ${build(params)}.`;
}
