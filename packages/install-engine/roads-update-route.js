/*
 * Дороги через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026, проект `rp-roads-container-design.md`): те же файлы, что сегодня едут в пакеты
 * `astral_roads` и `astral_roads_b`, кладутся в контейнеры `x64/astral/astral_rp_road(_b).rpf` самого `update.rpf` — архив, который клиент GTA 5 RP открывает
 * (пакеты `astral_*` на RP не монтируются). Контейнер Astral перекрывает базовый словарь по имени файла (проба E8 и X1b, сюжет, 19–20.11.2026); на сервере
 * RP не проверено, поэтому режим за выключателем и по умолчанию выключен.
 *
 * Предел — длина `update.rpf` (RPF7: 4 ГиБ, у владельца чистый файл ≈ 1,9 ГиБ), поэтому «дороги целиком» не влезают: выбор идёт по группам разметки,
 * группа — целиком или никак (половина группы — дыры), а отказ — до первой записи в игру. Модуль чистый: ввода-вывода нет, размеры подают числами.
 */

/** Окружение: `container` (и `1`, `true`) включают режим; пусто — выключен, и поведение прежнее. */
export const ROADS_VIA_UPDATE_ENV = "ASTRAL_ROADS_VIA_UPDATE";
export const ROADS_UPDATE_TARGET = "update/update.rpf";

const MiB = 1024 * 1024;
/** Предел RPF7: смещения 32-битные, архив меньше 4 ГиБ. */
export const ROADS_UPDATE_LIMIT_BYTES = 4 * 1024 * MiB;
/** Резерв под остальное, что пишут в тот же файл: оружие (`ASTRAL_WEAPONS_VIA_UPDATE`), моды каталога, ключ оглавления. НА СОГЛАСОВАНИЕ с лидом 1. */
export const ROADS_BUDGET_RESERVE_BYTES = 512 * MiB;
/** Запас на выравнивание и оглавление. НА СОГЛАСОВАНИЕ с лидом 1. */
export const ROADS_BUDGET_MARGIN_BYTES = 64 * MiB;
/** На каждый файл: выравнивание под 512 Б и запись оглавления (оценка). */
export const ROADS_BUDGET_ALIGN_BYTES = 2048;
/** Запас на перекраску: файл после правки чуть крупнее штатного (оценка). */
export const ROADS_BUDGET_SLACK = 0.03;
/** Вложенный архив больше 2 ГиБ RageLib читал счётчиком `int` (05.10.2026); держим контейнер заметно ниже. */
export const ROADS_CONTAINER_MAX_BYTES = 1024 * MiB;

/** Два контейнера слоя: имя файла → один из них по FNV-1a. */
export const ROADS_UPDATE_CONTAINERS = Object.freeze(["astral_rp_road.rpf", "astral_rp_road_b.rpf"]);
const CONTAINER_ROOT = "x64/astral";

/** Порядок предложения групп разметки (по цене кадра на МиБ, оценка): переходы, цветная, парковка, стоп-линии, осевая, края. */
export const ROADS_GROUP_PRIORITY = Object.freeze(["crossing", "coloured", "parking", "stops", "center", "edge"]);

export const ROADS_REFUSAL_CODES = Object.freeze(["over-budget", "nothing-fits", "parts-unavailable", "global-markings", "packs-standing"]);

export function roadsUpdateRouteEnabled(env = {}) {
  return ["container", "1", "true"].includes(String(env?.[ROADS_VIA_UPDATE_ENV] ?? "").trim().toLowerCase());
}

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Контейнер для файла: FNV-1a имени строчными, чётное — первый, нечётное — второй. */
export const roadsContainerOf = (name) => ROADS_UPDATE_CONTAINERS[fnv1a(String(name).toLowerCase()) % ROADS_UPDATE_CONTAINERS.length];

/** Запись файла в `update.rpf`: строчными, в корне контейнера слоя. */
export const roadsUpdateEntry = (name) => `${CONTAINER_ROOT}/${roadsContainerOf(name)}/${String(name).toLowerCase()}`;

/**
 * Что можно положить в `update.rpf` под дороги: предел минус длина файла (с дорогами или без — `reclaimBytes` возвращает стоящие дороги, которые уйдут при замене),
 * резерв и запас. Меньше нуля — ноль.
 */
export function roadsBudgetBytes({ updateLength, reclaimBytes = 0 } = {}) {
  if (!Number.isFinite(updateLength) || updateLength < 0) throw new Error("Длина update.rpf не названа: бюджет дорог посчитать нечем.");
  const own = Number.isFinite(reclaimBytes) && reclaimBytes > 0 ? reclaimBytes : 0;
  return Math.max(0, ROADS_UPDATE_LIMIT_BYTES - Math.max(0, updateLength - own) - ROADS_BUDGET_RESERVE_BYTES - ROADS_BUDGET_MARGIN_BYTES);
}

/** Цена файлов в `update.rpf`: размеры плюс выравнивание на файл, с запасом на перекраску. */
export const roadsCostBytes = (count, bytes) => Math.ceil((bytes + count * ROADS_BUDGET_ALIGN_BYTES) * (1 + ROADS_BUDGET_SLACK));

/** Цена по контейнерам: самая тяжёлая сторона. */
function heaviestContainerCost(files) {
  const sides = new Map(ROADS_UPDATE_CONTAINERS.map((container) => [container, { count: 0, bytes: 0 }]));
  for (const [name, size] of files) {
    const side = sides.get(roadsContainerOf(name));
    side.count += 1;
    side.bytes += size;
  }
  return Math.max(...[...sides.values()].map((side) => roadsCostBytes(side.count, side.bytes)));
}

function checkedGroups(groups) {
  const seen = new Set();
  return (groups || []).map((group) => {
    if (!ROADS_GROUP_PRIORITY.includes(group?.id)) throw new Error(`Неизвестная группа разметки: ${group?.id}`);
    if (seen.has(group.id)) throw new Error(`Группа разметки ${group.id} названа дважды.`);
    seen.add(group.id);
    const files = (group.files || []).map((file) => {
      if (typeof file?.name !== "string" || !file.name) throw new Error(`Имя файла группы ${group.id} не названо.`);
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`У файла ${file.name} неверный размер.`);
      return { name: file.name.toLowerCase(), size: file.size };
    });
    return { id: group.id, files };
  });
}

/**
 * Выбор групп под бюджет. `groups` — `[{ id, files: [{ name, size }] }]` (размеры штатные, из переписи игры), `budget` — байты из `roadsBudgetBytes`.
 * Группы идут в порядке предложения; группа берётся целиком, если объединение файлов выбранных групп (общий файл — один раз) помещается в бюджет и ни один
 * контейнер не выходит за предел. Иначе группа отказана (`over-budget`), следующая меньшая всё равно проверяется. Ответ: `{ chosen, refused: [{ id, code }],
 * files: Map имя → размер, bytes, cost, budget, fits }`; `fits` — выбрана хоть одна группа.
 */
export function selectRoadsGroups({ groups = [], budget } = {}) {
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Бюджет дорог не назван.");
  const ordered = checkedGroups(groups).sort((a, b) => ROADS_GROUP_PRIORITY.indexOf(a.id) - ROADS_GROUP_PRIORITY.indexOf(b.id));
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

const PACK_TARGET = /^update\/x64\/dlcpacks\/astral_roads(?:_b)?\/dlc\.rpf$/i;
const PACK_NAMES = ["astral_roads", "astral_roads_b"];

/**
 * Стоят ли пакеты дорог (`astral_roads`, `astral_roads_b`): по записям установленных работ (`archiveEntries`) и по регистрации пакета. Режим контейнера при
 * стоящих пакетах отказывает: дорога в обоих местах сразу — двойная правка, автоматического переноса нет.
 */
export function roadsPacksStanding({ installed = [], registrations = {} } = {}) {
  if (PACK_NAMES.some((name) => registrations && Object.hasOwn(registrations, name))) return true;
  return (installed || []).some((item) =>
    (item?.archiveEntries || []).some((entry) => PACK_TARGET.test(String(entry?.target || "")) || /^astral_roads(?:_[a-z0-9]+)?\.rpf\//i.test(String(entry?.entry || ""))),
  );
}

const names = (list) => (Array.isArray(list) && list.length ? list.join(", ") : "—");
const LINES = {
  "over-budget": ({ groups, needMiB, budgetMiB }) =>
    `группы ${names(groups)} не влезают в update.rpf (нужно ${needMiB ?? "?"} МиБ, свободно ${budgetMiB ?? "?"} МиБ) и остаются как в игре`,
  "nothing-fits": ({ groups, budgetMiB }) =>
    `ни одна из выбранных групп (${names(groups)}) не влезает в update.rpf (свободно ${budgetMiB ?? "?"} МиБ), в игру ничего не пишется`,
  "parts-unavailable": ({ parts }) =>
    `части ${names(parts)} (асфальт, грунтовки, тротуары) в этом режиме не помещаются в update.rpf и остаются как в игре`,
  "global-markings": () =>
    "общие «Скрыть всё», яркость и износ разметки касаются всех групп сразу и в update.rpf не помещаются: уберите их или ставьте дороги пакетами",
  "packs-standing": () => "пакеты дорог astral_roads уже стоят: снимите дороги («Откатить») и поставьте их через update.rpf заново",
};

/** Строка журнала об отказе: с кодом, числами и без внутренностей кода. */
export function roadsRefusalLine(code, params = {}) {
  const build = LINES[code];
  if (!build) throw new Error(`Неизвестный код отказа дорог: ${code}`);
  return `Дороги через update.rpf, отказ ${code}: ${build(params)}.`;
}
