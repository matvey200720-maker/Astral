/*
 * Дороги через носитель `update/update2.rpf` (GTA 5 RP, 20.11.2026; сервер подтвердил: контейнер в `update2.rpf` клиент видит, пилот №4).
 * Выключатель `ASTRAL_ROADS_VIA_UPDATE=carrier`: ВСЯ разметка дорог (шесть групп) целиком кладётся в четыре контейнера слоя
 * `x64/astral/astral_rp_road(_b|_c|_d).rpf` носителя, регистрации — в `update.rpf` (порядок записи — `carrier-order.js`). Значение `container`
 * (контейнеры в самом `update.rpf`, `roads-update-route.js`) работает как раньше, без выключателя — как раньше.
 *
 * В носителе места много (у чистого файла ≈ 3615 МиБ до предела RPF7 в 4 ГиБ), поэтому группы не выбираются по бюджету: либо все, либо отказ
 * словами до любой записи («часть дорог» в этом режиме не бывает). Модуль чистый: ввода-вывода нет, размеры и длину носителя подают числами.
 */
import { CARRIERS, CARRIERS_ENV, CARRIER_TARGETS, carrierEntryRoot, carriersEnabled } from "./carrier-targets.js";
import { ROADS_CONTAINER_MAX_BYTES, ROADS_GROUP_PRIORITY, ROADS_UPDATE_LIMIT_BYTES, ROADS_VIA_UPDATE_ENV, fnv1a, roadsCostBytes } from "./roads-update-route.js";

export const ROADS_CARRIER_VALUE = "carrier";
/** Носитель — из единого списка (`carrier-targets.js`). */
export const ROADS_CARRIER_TARGET = CARRIER_TARGETS[0];
/** Четыре контейнера слоя в носителе (21.11.2026: четвёртый вернул тротуары готовых видов): имя файла → один из них по FNV-1a mod 4 (каждый не больше 1 ГиБ). */
export const ROADS_CARRIER_CONTAINERS = Object.freeze(["astral_rp_road.rpf", "astral_rp_road_b.rpf", "astral_rp_road_c.rpf", "astral_rp_road_d.rpf"]);
/** Запас под оглавление и выравнивание сверх оценки цены: в носитель больше ничего не пишется, поэтому ноль (оценка и так с запасом на перекраску). */
export const ROADS_CARRIER_MARGIN_BYTES = 0;
export const ROADS_CARRIER_REFUSAL_CODES = Object.freeze(["carrier-over-budget", "carrier-container-full", "carrier-packs-standing", "carrier-switch-off", "carrier-part-left"]);
const CONTAINER_ROOT = "x64/astral";
const MiB = 1024 * 1024;
const miB = (bytes) => Math.ceil(bytes / MiB);

/** Только явное слово `carrier` (любой регистр, пробелы по краям); автоматический режим RP носитель не включает. */
export const roadsCarrierRouteEnabled = (env = {}) => String(env?.[ROADS_VIA_UPDATE_ENV] ?? "").trim().toLowerCase() === ROADS_CARRIER_VALUE;

/**
 * Решение (20.11.2026): выключатель дорог `carrier` ТРЕБУЕТ и `ASTRAL_CARRIERS=update2`; сам он второй выключатель не включает (меняло бы окружение процесса).
 * Без второго манифест с целью `update2.rpf` отказал бы позже и глуше, поэтому отказ — сразу, до сборки (`carrier-switch-off`).
 */
export const roadsCarrierSwitchesAligned = (env = {}) => carriersEnabled(env);

export const roadsCarrierContainerOf = (name) => ROADS_CARRIER_CONTAINERS[fnv1a(String(name).toLowerCase()) % ROADS_CARRIER_CONTAINERS.length];
export const roadsCarrierEntry = (name) => `${CONTAINER_ROOT}/${roadsCarrierContainerOf(name)}/${String(name).toLowerCase()}`;

/**
 * Что можно положить в носитель: предел минус длина НАСТОЯЩЕГО файла носителя; `reclaimBytes` — наши контейнеры, что уже стоят и уйдут при замене
 * (замена идёт двумя записями: сначала снятие, потом установка). Меньше нуля — ноль.
 */
export function roadsCarrierBudgetBytes({ carrierLength, reclaimBytes = 0 } = {}) {
  if (!Number.isFinite(carrierLength) || carrierLength < 0) throw new Error("Длина update2.rpf не названа: бюджет дорог посчитать нечем.");
  const own = Number.isFinite(reclaimBytes) && reclaimBytes > 0 ? reclaimBytes : 0;
  return Math.max(0, ROADS_UPDATE_LIMIT_BYTES - Math.max(0, carrierLength - own) - ROADS_CARRIER_MARGIN_BYTES);
}

/**
 * Носитель раскладки по файлам по id: `update2` и штатные пакеты — контейнеры слоя (`ROADS_CARRIER_CONTAINERS`, запись `roadsCarrierEntry`); `update` — второй носитель, сам `update.rpf`
 * (контейнеры `ROADS_UPDATE_CONTAINERS`, запись `roadsUpdateEntry`; бюджет — `roadsBudgetBytes`: предел минус живая длина, резерв 512 МиБ под оружие и моды каталога, запас 64 МиБ).
 */
export const ROADS_SPILL_CARRIER = "update";
/**
 * Имена контейнеров УНИКАЛЬНЫ по носителям (ревью Н-11, 21.11.2026): update2 — прежние четыре (`astral_rp_road(_b|_c|_d).rpf`, стоят у людей), второй носитель раскладки (сам update.rpf) — `astral_rp_road_u(_b).rpf`
 * (режим `container` без раскладки в update.rpf остаётся на прежних `astral_rp_road(_b).rpf`: он и раскладка с `update2` вместе не бывают), штатный пакет — `astral_rp_road_<id пакета>(_b|_c|_d).rpf`.
 */
export const ROADS_SPILL_CONTAINERS = Object.freeze(["astral_rp_road_u.rpf", "astral_rp_road_u_b.rpf"]);
const LANE_SUFFIXES = Object.freeze(["", "_b", "_c", "_d"]);
const roadsPackContainers = (id) => LANE_SUFFIXES.map((suffix) => `astral_rp_road_${id}${suffix}.rpf`);
export const roadsLaneContainers = (id) => (id === ROADS_SPILL_CARRIER ? ROADS_SPILL_CONTAINERS : id === "update2" ? ROADS_CARRIER_CONTAINERS : roadsPackContainers(id));
export const roadsLaneContainerOf = (id) => {
  const list = roadsLaneContainers(id);
  return (name) => list[fnv1a(String(name).toLowerCase()) % list.length];
};
export const roadsLaneEntryOf = (id) => {
  /* update.rpf (раскладка) — `x64/astral/…`, update2 — `x64/astral/…`, штатный пакет — `x64/levels/gta5/…` (форма М, `carrier-targets.js`). */
  const root = id === ROADS_SPILL_CARRIER ? "x64/astral" : carrierEntryRoot(CARRIERS.find((item) => item.id === id));
  const containerOf = roadsLaneContainerOf(id);
  return (name) => `${root}/${containerOf(name)}/${String(name).toLowerCase()}`;
};

/** Разбивка файлов `[{ name, size }]` по трём контейнерам. */
export function roadsCarrierSides(files) {
  const sides = new Map(ROADS_CARRIER_CONTAINERS.map((container) => [container, { count: 0, bytes: 0 }]));
  for (const { name, size } of files) {
    const side = sides.get(roadsCarrierContainerOf(name));
    side.count += 1;
    side.bytes += size;
  }
  return sides;
}

/**
 * Все группы целиком или отказ. `groups` — `[{ id, files: [{ name, size }] }]` (как у `selectRoadsGroups`), общий файл считается один раз.
 * Ответ: `{ fits, chosen, files, bytes, cost, budget, heaviest, refusal }`; `refusal` — `null` или `{ code, params }` (коды `ROADS_CARRIER_REFUSAL_CODES`).
 */
export function selectRoadsCarrier({ groups = [], budget } = {}) {
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Бюджет дорог не назван.");
  const seen = new Set();
  const files = new Map();
  for (const group of groups) {
    if (!ROADS_GROUP_PRIORITY.includes(group?.id)) throw new Error(`Неизвестная группа разметки: ${group?.id}`);
    if (seen.has(group.id)) throw new Error(`Группа разметки ${group.id} названа дважды.`);
    seen.add(group.id);
    for (const file of group.files || []) {
      if (typeof file?.name !== "string" || !file.name) throw new Error(`Имя файла группы ${group.id} не названо.`);
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`У файла ${file.name} неверный размер.`);
      files.set(file.name.toLowerCase(), file.size);
    }
  }
    return { ...fitRoadsCarrierFiles([...files].map(([name, size]) => ({ name, size })), budget), chosen: groups.map((group) => group.id), files };
}

/**
 * Помещается ли набор файлов `[{ name, size }]` в бюджет носителя и в три контейнера по 1 ГиБ. Ответ: `{ fits, bytes, cost, budget, heaviest, refusal }`
 * (`refusal` — `null` или `{ code, params }`). Им же проверяются части (асфальт, тротуары, грунтовки) поверх уже выбранной разметки.
 */
export function fitRoadsCarrierFiles(list, budget) {
  const bytes = list.reduce((sum, file) => sum + file.size, 0);
  const cost = roadsCostBytes(list.length, bytes);
  const heaviest = Math.max(0, ...[...roadsCarrierSides(list).values()].map((side) => roadsCostBytes(side.count, side.bytes)));
  const base = { bytes, cost, budget, heaviest };
  if (cost > budget) return { ...base, fits: false, refusal: { code: "carrier-over-budget", params: { needMiB: miB(cost), budgetMiB: miB(budget) } } };
  if (heaviest > ROADS_CONTAINER_MAX_BYTES) return { ...base, fits: false, refusal: { code: "carrier-container-full", params: { needMiB: miB(heaviest), budgetMiB: miB(ROADS_CONTAINER_MAX_BYTES) } } };
  return { ...base, fits: true, refusal: null };
}

const LINES = {
  "carrier-over-budget": ({ needMiB, budgetMiB }) => `все группы разметки не влезают в update2.rpf (нужно ${needMiB ?? "?"} МиБ, свободно ${budgetMiB ?? "?"} МиБ), в игру ничего не пишется`,
  "carrier-container-full": ({ needMiB, budgetMiB }) => `один из контейнеров дорог в update2.rpf вышел бы за предел (${needMiB ?? "?"} МиБ при пределе ${budgetMiB ?? "?"} МиБ), в игру ничего не пишется`,
  "carrier-part-left": ({ part, needMiB, budgetMiB }) => `часть ${part} вместе с разметкой не влезает в update2.rpf (нужно ${needMiB ?? "?"} МиБ, доступно ${budgetMiB ?? "?"} МиБ) и остаётся как в игре`,
  "carrier-switch-off": () => `дороги через update2.rpf включены, а носитель выключен: поставьте ${CARRIERS_ENV}=update2 вместе с ${ROADS_VIA_UPDATE_ENV}=carrier`,
  "carrier-packs-standing": () => "пакеты дорог astral_roads уже стоят: снимите дороги («Откатить») и поставьте их через update2.rpf заново",
};

/** Строка журнала об отказе носителя; префикс узнаёт `isRoadsContainerRefusal`. */
export function roadsCarrierRefusalLine(code, params = {}) {
  const build = LINES[code];
  if (!build) throw new Error(`Неизвестный код отказа дорог в носителе: ${code}`);
  return `Дороги через update2.rpf, отказ ${code}: ${build(params)}.`;
}
