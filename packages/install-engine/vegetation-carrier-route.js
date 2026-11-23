import { CARRIERS, CARRIER_TARGETS, carrierEntryRoot, carriersEnabled, enabledCarrierIds } from "./carrier-targets.js";
import { roadsCarrierBudgetBytes } from "./roads-carrier-route.js";
import { seniorityAllows } from "./carrier-seniority.js";
import { takeReserve } from "./forbidden-reserve.js";
import { PLAN_HEADROOM } from "./carrier-budget.js";
import { ROADS_CONTAINER_MAX_BYTES, roadsCostBytes } from "./roads-update-route.js";
import { VEGETATION_UPDATE_CONTAINERS, VEGETATION_UPDATE_TARGET, VEGETATION_VIA_UPDATE_ENV, vegetationBudgetBytes, vegetationContainerOf, vegetationUpdateEntry } from "./vegetation-update-route.js";

/*
 * Трава и живые изгороди растительности через носитель `update/update2.rpf` (GTA 5 RP, 21.11.2026; образец — дороги, `roads-carrier-route.js`). В `update.rpf` свободно ≈ 1586 МиБ: деревья
 * (534–561 МиБ) там помещаются, а трава (1557–6164 МиБ) и живые изгороди (+1005 МиБ) нет. Выключатель `ASTRAL_VEGETATION_VIA_UPDATE=carrier` (требует `ASTRAL_CARRIERS=update2`):
 * деревья остаются в контейнерах `update.rpf` как были, трава и изгороди — в три контейнера слоя `x64/astral/astral_rp_vegetation_u2(_b|_c).rpf` носителя. Бюджет носителя общий с дорогами:
 * считается по ЖИВОЙ длине `update2.rpf` (в ней уже лежат стоящие дороги), свои стоящие контейнеры растительности при повторе возвращаются в бюджет. Что не влезло, остаётся «как в игре» со строкой.
 * Модуль чистый: ввода-вывода нет, размеры и длину носителя подают числами.
 */
export const VEGETATION_CARRIER_VALUE = "carrier";
export const VEGETATION_CARRIER_TARGET = CARRIER_TARGETS[0];
/** Три контейнера слоя в носителе: имя файла → один из них по FNV-1a mod 3 (каждый не больше 1 ГиБ). Имена отличаются от дорог и от контейнеров `update.rpf`. */
export const VEGETATION_CARRIER_CONTAINERS = Object.freeze(["astral_rp_vegetation_u2.rpf", "astral_rp_vegetation_u2_b.rpf", "astral_rp_vegetation_u2_c.rpf"]);
/** Порядок единиц, что идут в носитель: трава (одна или по зонам), потом кусты своего цвета (21.11, «кусты меняли свои цвета»), потом живые изгороди (решение первого лида 21.11; в режиме своего цвета
 *  сборка красит их вместе с кустами, поэтому они идут только после кустов), потом цветы (карты травы районов, 21.11: игра берёт `.ymap` из контейнера — кадр сюжета). */
/* Порядок единиц по решению лида 1 (21.11.2026): кусты своим цветом → трава города → изгороди → трава за городом → цветы (общая «grass» — прежняя единица всей травы). */
export const VEGETATION_CARRIER_GROUPS = Object.freeze(["grass", "bushes", "grass-city", "hedges", "grass-country", "flowers"]);
export const VEGETATION_CARRIER_REFUSAL_CODES = Object.freeze(["carrier-over-budget", "carrier-container-full", "carrier-switch-off"]);
const CONTAINER_ROOT = "x64/astral";
const MiB = 1024 * 1024;
const miB = (bytes) => Math.ceil(bytes / MiB);

/** Только слово `carrier` (любой регистр, пробелы по краям). */
export const vegetationCarrierRouteEnabled = (env = {}) => String(env?.[VEGETATION_VIA_UPDATE_ENV] ?? "").trim().toLowerCase() === VEGETATION_CARRIER_VALUE;

/**
 * Цветы через носитель — отдельный выключатель, по умолчанию ВЫКЛЮЧЕН (решение первого лида 21.11, кадр сюжета цветов «не доказан»: на четырёх точках кадры с набором и без него одинаковые).
 * Без него вид с цветами (season-summer) ведёт себя как раньше: цветы «как в игре» (`part-unavailable` без деревьев), человеку «видно» про цветы не говорится.
 */
export const VEGETATION_FLOWERS_ENV = "ASTRAL_VEGETATION_FLOWERS";
/* Цветы через носители (ступень 2, 21.11.2026): своим выключателем `carrier` или САМИ, когда включён штатный пак в `ASTRAL_CARRIERS` (место под цветочные карты есть у паков; не влезли — единица названа словами и остаётся как в игре). */
export const vegetationFlowersCarrierEnabled = (env = {}) =>
  String(env?.[VEGETATION_FLOWERS_ENV] ?? "").trim().toLowerCase() === VEGETATION_CARRIER_VALUE || enabledCarrierIds(env).some((id) => id !== "update2");

/** Как у дорог: `carrier` требует и `ASTRAL_CARRIERS=update2`; без него — отказ сразу, до сборки. */
export const vegetationCarrierSwitchesAligned = (env = {}) => carriersEnabled(env);

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export const vegetationCarrierContainerOf = (name) => VEGETATION_CARRIER_CONTAINERS[fnv1a(String(name).toLowerCase()) % VEGETATION_CARRIER_CONTAINERS.length];
export const vegetationCarrierEntry = (name) => `${CONTAINER_ROOT}/${vegetationCarrierContainerOf(name)}/${String(name).toLowerCase()}`;

/**
 * Носители раскладки по id (`carrier-spill.js`): `update2` и штатные пакеты — контейнеры слоя `VEGETATION_CARRIER_CONTAINERS` (запись `x64/astral/…` у update2, `x64/levels/gta5/…` у штатного пакета,
 * форма М, `carrierEntryRoot`); `update` — сам `update.rpf`: контейнеры растительности `VEGETATION_UPDATE_CONTAINERS` (запись `vegetationUpdateEntry`).
 */
export const VEGETATION_SPILL_LANE = "update";
/** Имена контейнеров уникальны по носителям (ревью Н-11): update.rpf — `astral_rp_vegetation(_b)`, update2 — `…_u2(_b|_c)`, штатный пакет — `astral_rp_vegetation_<id пакета>(_b|_c)`. */
const packContainers = (id) => ["", "_b", "_c"].map((suffix) => `astral_rp_vegetation_${id}${suffix}.rpf`);
export const vegetationLaneContainers = (id) => (id === VEGETATION_SPILL_LANE ? VEGETATION_UPDATE_CONTAINERS : id === "update2" ? VEGETATION_CARRIER_CONTAINERS : packContainers(id));
export const vegetationLaneContainerOf = (id) => {
  if (id === VEGETATION_SPILL_LANE) return vegetationContainerOf;
  const list = vegetationLaneContainers(id);
  return (name) => list[fnv1a(String(name).toLowerCase()) % list.length];
};
export const vegetationLaneEntryOf = (id) => {
  if (id === VEGETATION_SPILL_LANE) return vegetationUpdateEntry;
  const carrier = CARRIERS.find((item) => item.id === id);
  if (!carrier) throw new Error(`Неизвестный носитель растительности: ${id}`);
  const root = carrierEntryRoot(carrier);
  const containerOf = vegetationLaneContainerOf(id);
  return (name) => `${root}/${containerOf(name)}/${String(name).toLowerCase()}`;
};
/** Цель носителя раскладки по id (`update` — сам update.rpf). */
export const vegetationLaneTarget = (id) => (id === VEGETATION_SPILL_LANE ? VEGETATION_UPDATE_TARGET : CARRIERS.find((item) => item.id === id)?.target ?? null);

/** Что можно положить в носитель: предел минус живая длина `update2.rpf`; `reclaimBytes` — свои стоящие контейнеры растительности (уйдут при замене). Как у дорог. */
export const vegetationCarrierBudgetBytes = (options) => roadsCarrierBudgetBytes(options);

/**
 * Носители раскладки по файлам (`carrier-spill.js`, общий раскладчик с дорогами) по очереди: `update2.rpf` (общий бюджет с дорогами, `vegetationCarrierBudgetBytes`), потом сам `update.rpf`
 * (бюджет — `vegetationBudgetBytes`: резерв под оружие и моды каталога внутри; из него вычтена цена деревьев вида, они уже решены в `update.rpf`). `spill` — `{ updateLength, updateReclaimBytes }`
 * (живая длина `update.rpf` и свои стоящие в нём контейнеры растительности, что уйдут при повторе) или `null` — второго носителя нет (только `update2.rpf`).
 */
export function vegetationSpillCarriers({ carrierLength, reclaimBytes = 0, spill = null, treesCost = 0, carrierPlan = null, headroom = PLAN_HEADROOM } = {}) {
  /* Старшинство паков (`carrier-seniority.js`): файл с одноимённым в штатном паке в паки-носители не кладётся (список — `carrierPlan.overlap`). */
  const allowed = seniorityAllows(carrierPlan?.overlap);
  const packAllows = (id) => (name) => allowed(id, name);
  const list = [{ id: "update2", budget: vegetationCarrierBudgetBytes({ carrierLength, reclaimBytes }), containerOf: vegetationCarrierContainerOf }];
  if (spill) {
    const budget = Math.max(0, vegetationBudgetBytes({ updateLength: spill.updateLength, reclaimBytes: spill.updateReclaimBytes ?? 0 }) - Math.max(0, treesCost));
    list.push({ id: VEGETATION_SPILL_LANE, budget, containerOf: vegetationContainerOf });
  }
  /* Штатные пакеты (`ASTRAL_CARRIERS` называет их; по умолчанию выкл) — после update.rpf, по порядку таблицы; бюджет — предел минус живая длина файла пакета (свои стоящие контейнеры возвращаются). */
  for (const id of carrierPlan?.enabled || []) {
    if (id === "update2") continue;
    const carrier = CARRIERS.find((item) => item.id === id);
    if (!carrier) continue;
    const length = Math.max(0, Number(carrierPlan.lengths?.[id] ?? carrier.baseBytes) || 0);
    const own = Math.max(0, Number(carrierPlan.reclaim?.[id]) || 0);
    list.push({ id, budget: Math.max(0, carrier.limitBytes - Math.max(0, length - own)), containerOf: vegetationLaneContainerOf(id), allows: packAllows(id) });
  }
  /* Запас под запретные файлы ДРУГОЙ работы (дороги; `forbidden-reserve.js`): запрещённые старшинством во всех полосах-паках файлы обязаны лечь в update2.rpf/update.rpf — растительность, что ставится первой,
     оставляет им место (с update2.rpf, потом с update.rpf); дороги уже стоят — запас 0. */
  const reserveOther = Math.max(0, Number(carrierPlan?.reserveOther) || 0);
  if (reserveOther > 0) {
    const first = list.find((lane) => lane.id === "update2");
    const second = list.find((lane) => lane.id === VEGETATION_SPILL_LANE);
    const left = takeReserve({ update2: first?.budget ?? 0, update: second?.budget ?? 0 }, reserveOther);
    if (first) first.budget = left.update2;
    if (second) second.budget = left.update;
  }
  /* Запас на рост собранного (21.11.2026, находка Б независимого чтения): раскладка по штатным размерам идёт по `planBudget` (бюджет за вычетом `headroom`, по умолчанию `PLAN_HEADROOM` 3 %, как у дорог);
     по размерам СОБРАННОГО раскладчик зовут с `headroom: 0` — там цифры настоящие. */
  return list.map((lane) => ({ ...lane, planBudget: Math.floor(lane.budget * (1 - headroom)) }));
}

function heaviestContainerCost(files) {
  const sides = new Map(VEGETATION_CARRIER_CONTAINERS.map((container) => [container, { count: 0, bytes: 0 }]));
  for (const [name, size] of files) {
    const side = sides.get(vegetationCarrierContainerOf(name));
    side.count += 1;
    side.bytes += size;
  }
  return Math.max(0, ...[...sides.values()].map((side) => roadsCostBytes(side.count, side.bytes)));
}

/**
 * Выбор единиц для носителя в порядке `VEGETATION_CARRIER_GROUPS` (трава, потом изгороди): единица берётся целиком или никак (половина травы даёт дыры), общий файл считается один раз.
 * `groups` — `[{ id, files: [{ name, size }] }]`; `budget` — из `vegetationCarrierBudgetBytes`. Не влезло — следующая единица проверяется всё равно (изгороди могут влезть, когда трава нет).
 * `needs` — `{ единица: нужная единица }` (изгороди своего цвета красятся сборкой вместе с кустами: `{ hedges: "bushes" }`): единица без принятой нужной не едет и отказана тем же кодом и числами.
 * Ответ: `{ chosen, refused: [{ id, code, needMiB, budgetMiB }], files, bytes, cost, budget }`.
 */
export function selectVegetationCarrier({ groups = [], budget, needs = {} } = {}) {
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Бюджет носителя для растительности не назван.");
  const seen = new Set();
  const ordered = (groups || []).map((group) => {
    if (!VEGETATION_CARRIER_GROUPS.includes(group?.id)) throw new Error(`Неизвестная единица растительности в носителе: ${group?.id}`);
    if (seen.has(group.id)) throw new Error(`Единица ${group.id} названа дважды.`);
    seen.add(group.id);
    const files = (group.files || []).map((file) => {
      if (typeof file?.name !== "string" || !file.name) throw new Error(`Имя файла единицы ${group.id} не названо.`);
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`У файла ${file.name} неверный размер.`);
      return { name: file.name.toLowerCase(), size: file.size };
    });
    return { id: group.id, files };
  });
  ordered.sort((a, b) => VEGETATION_CARRIER_GROUPS.indexOf(a.id) - VEGETATION_CARRIER_GROUPS.indexOf(b.id));
  const files = new Map();
  const chosen = [];
  const refused = [];
  for (const group of ordered) {
    const needed = needs[group.id];
    if (needed && ordered.some((other) => other.id === needed) && !chosen.includes(needed)) {
      const why = refused.find((item) => item.id === needed);
      refused.push({ id: group.id, code: why?.code ?? "carrier-over-budget", needMiB: why?.needMiB, budgetMiB: why?.budgetMiB });
      continue;
    }
    const union = new Map(files);
    for (const file of group.files) union.set(file.name, file.size);
    const bytes = [...union.values()].reduce((sum, size) => sum + size, 0);
    const cost = roadsCostBytes(union.size, bytes);
    const heaviest = heaviestContainerCost(union);
    if (cost <= budget && heaviest <= ROADS_CONTAINER_MAX_BYTES) {
      chosen.push(group.id);
      for (const [name, size] of union) files.set(name, size);
    } else {
      const code = cost > budget ? "carrier-over-budget" : "carrier-container-full";
      refused.push({ id: group.id, code, needMiB: miB(cost > budget ? cost : heaviest), budgetMiB: miB(cost > budget ? budget : ROADS_CONTAINER_MAX_BYTES) });
    }
  }
  const bytes = [...files.values()].reduce((sum, size) => sum + size, 0);
  return { chosen, refused, files, bytes, cost: roadsCostBytes(files.size, bytes), budget };
}

const GROUP_WORDS = { grass: "трава", "grass-country": "трава за городом", "grass-city": "трава города", bushes: "кусты своим цветом", hedges: "живые изгороди", flowers: "цветы" };
/** Слово единицы: порода дерева — «дерево <порода>» (единицы `tree-<порода>`, ступень 2), прочие — по таблице. */
const groupWord = (group) => (String(group).startsWith("tree-") ? `дерево ${String(group).slice(5)}` : (GROUP_WORDS[group] ?? group));
const LINES = {
  "carrier-over-budget": ({ group, needMiB, budgetMiB }) => `${groupWord(group)} не влезает в update2.rpf (нужно ${needMiB ?? "?"} МиБ, свободно ${budgetMiB ?? "?"} МиБ) и остаётся как в игре`,
  "carrier-container-full": ({ group, needMiB, budgetMiB }) => `${groupWord(group)}: один из контейнеров в update2.rpf вышел бы за предел (${needMiB ?? "?"} МиБ при пределе ${budgetMiB ?? "?"} МиБ), остаётся как в игре`,
  "carrier-switch-off": () => "растительность через update2.rpf включена, а носитель выключен: поставьте ASTRAL_CARRIERS=update2 вместе с ASTRAL_VEGETATION_VIA_UPDATE=carrier",
};

/** Строка журнала о единице, что не влезла в носитель (или об отказе выключателей); префикс узнаёт `isVegetationContainerRefusal`. */
export function vegetationCarrierLine(code, params = {}) {
  const build = LINES[code];
  if (!build) throw new Error(`Неизвестный код носителя растительности: ${code}`);
  return `Растительность через update2.rpf, отказ ${code}: ${build(params)}.`;
}
