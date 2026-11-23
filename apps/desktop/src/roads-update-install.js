import fs from "node:fs/promises";
import { subpackLaneUsable } from "./subpack-lane-check.js";
import { forbiddenReserveBytes } from "@modovik/install-engine/forbidden-reserve.js";
import roadsInventory from "@modovik/climb-contract/recolor/inventory/roads";
import { placeStagesOnCarriers } from "@modovik/install-engine/carrier-budget.js";
import { CARRIERS, enabledCarrierIds } from "@modovik/install-engine/carrier-targets.js";
import { ownReclaimBytes } from "./carrier-reclaim.js";
import { carrierLengthBytes, foreignSubpackNote } from "./carrier-length.js";
import { isRpModeAuto } from "./rp-mode-channel.js";
import {
  ROAD_GROUP_BITS,
  ROAD_GROUP_IDS,
  ROAD_MARKING_BRIGHTNESS,
  ROAD_MARKING_WEAR,
  ROAD_PART_IDS,
  applyRoadsStandard,
  normalizeRoadsProject,
  roadsChangedMarkingGroups,
  roadsChangedParts,
  roadsDictionaryWanted,
} from "@modovik/climb-contract/recolor/roads";
import {
  ROADS_UPDATE_CONTAINERS,
  roadsBudgetBytes,
  roadsContainerOf,
  roadsCostBytes,
  roadsPacksStanding,
  roadsRefusalLine,
  roadsUpdateRouteEnabled,
  selectRoadsGroups,
} from "@modovik/install-engine/roads-update-route.js";
import { placeStagesAcrossCarriers } from "@modovik/install-engine/carrier-spill.js";
import { carrierSubjectToSeniority, seniorityAllows } from "@modovik/install-engine/carrier-seniority.js";
import {
  ROADS_CARRIER_TARGET,
  roadsCarrierRefusalLine,
  roadsLaneContainerOf,
  roadsCarrierRouteEnabled,
  roadsCarrierSwitchesAligned,
  selectRoadsCarrier,
} from "@modovik/install-engine/roads-carrier-route.js";

/*
 * Дороги через контейнер в `update.rpf` со стороны приложения (GTA 5 RP, 20.11.2026, проект `rp-roads-container-design.md`): выключатель
 * `ASTRAL_ROADS_VIA_UPDATE=container`, план групп до сборки и проверка собранного до первой записи в игру.
 *
 * Выключатель пуст — `roadsContainerRequest` отдаёт `null`, сборка идёт прежним путём (пакеты `astral_roads*`), поведение прежнее байт в байт.
 * Видимых человеку строк нет: что не влезло, уходит строкой в журнал приложения (`note`); отказ — ошибкой `RoadsContainerRefusal` с кодом и строкой.
 * Окно «часть дорог» (слова, плашка «не в игре») — отдельным шагом, шесть языков.
 */

const MiB = 1024 * 1024;
const miB = (bytes) => Math.ceil(bytes / MiB);

/** Отказ режима: код (`ROADS_REFUSAL_CODES`) и строка журнала в сообщении. */
export class RoadsContainerRefusal extends Error {
  constructor(code, params = {}) {
    super(String(code).startsWith("carrier-") ? roadsCarrierRefusalLine(code, params) : roadsRefusalLine(code, params));
    this.name = "RoadsContainerRefusal";
    this.code = code;
    this.params = params;
  }
}

/** Контейнеры дорог в носителе: три имени (`_b`, `_c`). */
const OWN_ROADS_ID = /^local-legacy-roads-[a-f0-9]{12}$/;
/* Имена файлов дорог (опись): отличают их от файлов растительности в запасе под запретные (`forbidden-reserve.js`). */
const ROAD_INVENTORY_NAMES = new Set([...roadsInventory.files, ...(roadsInventory.models || [])].map((file) => file.name.toLowerCase()));
/** Размер файла слоя в хранилище. */
const statLayerSize = async (file) => (await fs.stat(file)).size;
const CARRIER_ENTRY = /^x64\/(?:astral|levels\/gta5)\/astral_rp_road(?:_[bcd])?\.rpf\//i;
const CONTAINER_ENTRY = /^x64\/astral\/astral_rp_road(?:_b)?\.rpf\//i;
/* Контейнеры дорог в update.rpf при раскладке по носителям (имена уникальны по носителям, ревью Н-11). */
const SPILL_ENTRY = /^x64\/astral\/astral_rp_road_u(?:_b)?\.rpf\//i;

/** Строка журнала: режим включился сам, отказывать нечему — ставим прежним путём. */
const roadsAutoLine = (refusal) => `Дороги: режим RP включён сам, ${refusal} Ставим прежним путём (пакеты astral_roads).`;

/** Отказ режима дорог: по имени ошибки или по строке (через поток сборки имя может потеряться, текст остаётся). */
export const isRoadsContainerRefusal = (error) => error?.name === "RoadsContainerRefusal" || /^Дороги через update2?\.rpf, отказ /.test(String(error?.message || ""));

/**
 * Запрос режима для сборки дорог: `{ updateLength, reclaimBytes, standingPacks }` или `null` (выключатель пуст). `statUpdate` — длина живого `update.rpf`
 * (подмена для тестов), `readState` — состояние движка. Не прочиталось — ошибка: режим не гадает про бюджет.
 * `reclaimBytes` — сколько занимают уже стоящие контейнерные дороги (при замене они уйдут); записи состояния размера не хранят, пока его нет — ноль
 * (бюджет консервативный: на повторном «Применить» стоящие дороги считаются занятым местом).
 */
export async function roadsContainerRequest({ env = process.env, statUpdate, statCarrier, statSpill, readOverlap, readSubpackHost, readTreesReserve, readMapsReserve, layerSize, readState, targetId = "", stateDir = "", note = (line) => console.warn(`[astral] ${line}`) } = {}) {
  /* Носитель `update2.rpf` (`ASTRAL_ROADS_VIA_UPDATE=carrier`): режим RP включает его сам (`rp-mode-channel.js`) или человек словом; при включении самим стоящие пакеты и расхождение выключателей — прежний путь со строкой в журнале. */
  if (roadsCarrierRouteEnabled(env)) {
    const auto = isRpModeAuto("ASTRAL_ROADS_VIA_UPDATE", env);
    if (!roadsCarrierSwitchesAligned(env)) {
      const refusal = new RoadsContainerRefusal("carrier-switch-off");
      if (!auto) throw refusal;
      note(roadsAutoLine(refusal.message));
      return null;
    }
    const request = await roadsCarrierRequest({ statCarrier, statSpill, readOverlap, readSubpackHost, readTreesReserve, readMapsReserve, readState, targetId, stateDir, env, note, ...(layerSize ? { layerSize } : {}) });
    if (auto && request.standingPacks) {
      note(roadsAutoLine(new RoadsContainerRefusal("carrier-packs-standing").message));
      return null;
    }
    return auto ? { ...request, auto } : request;
  }
  if (!roadsUpdateRouteEnabled(env)) return null;
  /* Режим включился сам (`rp-mode-channel.js`), а не явным значением: на стоящих пакетах `astral_roads*` он не отказывает, а ставит прежним путём со строкой в журнале. */
  const auto = isRpModeAuto("ASTRAL_ROADS_VIA_UPDATE", env);
  let updateLength;
  try {
    updateLength = Number(await statUpdate());
  } catch (error) {
    throw new Error(`Не прочитана длина update.rpf: ${error?.message || error}. Дороги через update.rpf без неё не планируются.`);
  }
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId] || {};
  const installed = target.installed || [];
  const reclaimBytes = installed
    .flatMap((item) => item?.archiveEntries || [])
    .filter((entry) => CONTAINER_ENTRY.test(String(entry?.entry || "")) && Number.isFinite(entry?.size))
    .reduce((sum, entry) => sum + entry.size, 0);
  const standingPacks = roadsPacksStanding({ installed, registrations: target.directDlcRegistrations || {} });
  if (auto && standingPacks) {
    note(roadsAutoLine(new RoadsContainerRefusal("packs-standing").message));
    return null;
  }
  return { updateLength, reclaimBytes, standingPacks, ...(auto ? { auto } : {}) };
}

/** Запрос режима носителя: `{ carrier: true, updateLength, reclaimBytes, standingPacks }`; `updateLength` — длина НАСТОЯЩЕГО `update2.rpf`. */
async function roadsCarrierRequest({ statCarrier, statSpill, readOverlap, readSubpackHost, readTreesReserve, readMapsReserve, readState, targetId, stateDir, layerSize = statLayerSize, env = process.env, note = () => {} }) {
  if (typeof statCarrier !== "function") throw new Error("Длина update2.rpf не читается: дороги через носитель без неё не планируются.");
  let updateLength;
  try {
    updateLength = Number(await statCarrier());
  } catch (error) {
    throw new Error(`Не прочитана длина update2.rpf: ${error?.message || error}. Дороги через update2.rpf без неё не планируются.`);
  }
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId] || {};
  const installed = target.installed || [];
  /*
   * Свои стоящие контейнеры дорог в носителе уйдут при повторном применении (первая запись — снятие), поэтому их место возвращается в бюджет. Размер записи — из состояния:
   * свой размер записи, если есть, иначе файл верхнего слоя этой же работы в хранилище (`layerSize`); не нашёлся — ноль (бюджет консервативный). ЧУЖИЕ слои носителя
   * (другие работы, в том числе с теми же именами контейнеров) — занятое место, как раньше: возвращаются только записи работ дорог (`local-legacy-roads-…`).
   */
  const carrierArchive = target.archives?.[ROADS_CARRIER_TARGET];
  let reclaimBytes = 0;
  for (const item of installed) {
    if (!OWN_ROADS_ID.test(String(item?.modId || ""))) continue;
    for (const entry of item?.archiveEntries || []) {
      if (String(entry?.target || "").toLowerCase() !== ROADS_CARRIER_TARGET || !CARRIER_ENTRY.test(String(entry?.entry || ""))) continue;
      if (Number.isFinite(entry?.size)) {
        reclaimBytes += entry.size;
        continue;
      }
      const layer = (carrierArchive?.entries?.[entry.entry]?.layers || []).findLast?.((candidate) => candidate?.modId === item.modId && candidate?.cachePath);
      const size = layer ? Number(await layerSize(layer.cachePath).catch(() => 0)) : 0;
      if (Number.isFinite(size) && size > 0) reclaimBytes += size;
    }
  }
  const request = { carrier: true, updateLength, reclaimBytes, standingPacks: roadsPacksStanding({ installed, registrations: target.directDlcRegistrations || {} }) };
  /* Штатные пакеты-носители (`ASTRAL_CARRIERS` называет их, `carrier-targets.js`): очередь `update2` → пакеты по таблице; настоящая длина каждого файла и место своих стоящих контейнеров. Пакет, длину которого
     не прочесть (нет файла), из очереди выходит молча: без него дороги ляжут в оставшиеся носители. Без пакетов запрос прежний (только update2). */
  const packs = enabledCarrierIds(env).filter((id) => id !== "update2");
  /* Второй носитель раскладки по файлам — сам `update.rpf` (`statSpill` — длина его настоящего файла); свои стоящие контейнеры дорог в нём при замене уходят, их место возвращается в бюджет. */
  let spill = null;
  if (typeof statSpill === "function") {
    let spillLength;
    try {
      spillLength = Number(await statSpill());
    } catch (error) {
      throw new Error(`Не прочитана длина update.rpf: ${error?.message || error}. Дороги через два носителя без неё не планируются.`);
    }
    /* Место своих стоящих контейнеров дорог в update.rpf (раскладка, контейнеры `astral_rp_road_u(_b)`) возвращается в бюджет и тогда, когда запись размера не хранит (ревью Н-10): файл верхнего слоя в хранилище. */
    const updateReclaimBytes = await ownReclaimBytes({ installed, target, ownId: OWN_ROADS_ID, carrierTarget: "update/update.rpf", entryPattern: SPILL_ENTRY, layerSize });
    spill = { updateLength: spillLength, updateReclaimBytes };
    /* Настоящая потребность деревьев проекта в update.rpf (читалка от растительности, `countPlan`); нет — умолчание `CARRIER_TREES_RESERVE_BYTES`. */
    const treesReserve = typeof readTreesReserve === "function" ? Number(await Promise.resolve(readTreesReserve()).catch(() => NaN)) : NaN;
    if (Number.isFinite(treesReserve) && treesReserve >= 0) spill.treesReserveBytes = treesReserve;
    /* Запас под карты травы и цветы (читалка от растительности): растительность стоит — 0; иначе число не называется (умолчание, с полосами 1,1 ГиБ). */
    const mapsReserve = typeof readMapsReserve === "function" ? Number(await Promise.resolve(readMapsReserve()).catch(() => NaN)) : NaN;
    if (Number.isFinite(mapsReserve) && mapsReserve >= 0) spill.mapsReserveBytes = mapsReserve;
  }
  if (!packs.length && !spill) return request;
  const lengths = { update2: updateLength };
  const reclaim = { update2: reclaimBytes };
  const enabled = ["update2"];
  for (const id of packs) {
    const carrier = CARRIERS.find((item) => item.id === id);
    /* Подпакет штатного пакета без файла: длина 0, если файл хозяина читается (`carrier-length.js`); прочие носители — настоящая длина. */
    const packLength = await carrierLengthBytes({ carrier, statCarrier, owned: Boolean(target.resources?.[carrier.target]), onForeign: foreignSubpackNote(note) });
    if (packLength === null) continue;
    /* Подпакет, который установка потом отвергнет (чужой файл на месте цели, штатный `dlc1.rpf` у хозяина), в очередь не входит: отказ до долгой сборки (ревью подпакета). */
    if (!(await subpackLaneUsable({ carrier, target, packLength, readSubpackHost }))) continue;
    lengths[id] = packLength;
    enabled.push(id);
    reclaim[id] = await ownReclaimBytes({ installed, target, ownId: OWN_ROADS_ID, carrierTarget: carrier.target, entryPattern: new RegExp(`^x64/levels/gta5/astral_rp_road_${id}(?:_[bcd])?\\.rpf/`, "i"), layerSize });
  }
  /* Старшинство паков (`carrier-seniority.js`): с включённым паком — имена, у которых есть одноимённый файл в штатных паках игры; пак не читается (нет ключей) — правило не действует. */
  const overlap = enabled.length > 1 && typeof readOverlap === "function" ? await readOverlap().catch(() => null) : null;
  /* Запас под запретные файлы РАСТИТЕЛЬНОСТИ (старшинство во всех полосах-паках → только update2/update.rpf): дороги оставляют им место, пока растительность не стоит (`forbidden-reserve.js`). */
  const vegetationStands = (installed || []).some((item) => /^local-legacy-vegetation-[a-f0-9]{12}$/.test(String(item?.modId || "")));
  const reserveOther = forbiddenReserveBytes({ overlap, laneIds: enabled.filter((id) => id !== "update2"), include: (name) => !ROAD_INVENTORY_NAMES.has(name), standing: vegetationStands });
  return enabled.length > 1 || spill ? { ...request, carrierPlan: { enabled, lengths, reclaim, ...(spill ? { spill } : {}), ...(overlap ? { overlap } : {}), ...(reserveOther > 0 ? { reserveOther } : {}) } } : request;
}

/** Режим RP включился сам, а запрос пуст — пакеты дорог стоят, и работа идёт прежним путём (отказ `packs-standing`, окну об этом говорят). */
export const roadsFellBackToPacks = (container, env = process.env) => !container && (roadsUpdateRouteEnabled(env) || roadsCarrierRouteEnabled(env)) && isRpModeAuto("ASTRAL_ROADS_VIA_UPDATE", env);

const isGroupStock = (markings, id) => markings[id].mode === "standard" && markings[id].brightness === ROAD_MARKING_BRIGHTNESS.standard;

/** Порядок частей поверх разметки (по цене и заметности): асфальт, тротуары, грунтовки. */
const CARRIER_PART_ORDER = ["asphalt", "sidewalk", "dirt"];

/**
 * План для носителя: сначала ВСЯ разметка (все группы, что работа меняет, в том числе общие яркость, износ и «скрыть» — они касаются всех шести), потом части по порядку;
 * часть, что не влезла в бюджет сверху уже взятого, остаётся «как в игре» со строкой о МиБ (частичный случай), не влезла сама разметка — отказ целиком до записи.
 */
function planRoadsCarrier({ normal, files, sizeOf, updateLength, reclaimBytes, carrierPlan = null }) {
  const known = (file) => Number.isFinite(sizeOf?.(file.name));
  const wantedFor = (changed) => files.filter((file) => known(file) && roadsDictionaryWanted(file.textures, changed));
  const sized = (list) => list.map((file) => ({ name: file.name.toLowerCase(), size: sizeOf(file.name) }));
  const mask = roadsChangedMarkingGroups(normal);
  const groups = ROAD_GROUP_IDS.filter((id) => mask & ROAD_GROUP_BITS[id]);
  const changed = roadsChangedParts(normal);
  const parts = CARRIER_PART_ORDER.filter((id) => changed.parts.has(id));
  if (!groups.length && !parts.length) throw new RoadsContainerRefusal("parts-unavailable", { parts: [] });
  /* Очередь носителей (`carrier-budget.js`): без плана — один update2 с длиной и возвратом места из запроса, как раньше. */
  const enabled = carrierPlan?.enabled?.length ? carrierPlan.enabled : ["update2"];
  const lengths = { ...(carrierPlan?.lengths || {}), update2: carrierPlan?.lengths?.update2 ?? updateLength };
  const reclaim = { ...(carrierPlan?.reclaim || {}), update2: carrierPlan?.reclaim?.update2 ?? reclaimBytes };
  const stages = [];
  if (groups.length) stages.push({ id: "markings", files: sized(wantedFor({ parts: new Set(), lines: true, groups: mask })) });
  for (const part of parts) stages.push({ id: part, files: sized(wantedFor({ parts: new Set([part]), lines: false, groups: 0 })) });
  const placed = placeStagesOnCarriers({ stages, lengths, reclaim, enabled, ...(carrierPlan?.spill ? { spill: carrierPlan.spill } : {}), ...(carrierPlan?.overlap ? { overlap: carrierPlan.overlap } : {}), ...(carrierPlan?.reserveOther ? { reserveOther: carrierPlan.reserveOther } : {}) });
  const stageOf = new Map(placed.stages.map((stage) => [stage.id, stage]));
  /* Разметка — целиком в какой-то носитель или отказ до записи; части — по порядку, не влезшая названа и остаётся «как в игре». */
  const markings = stageOf.get("markings");
  if (markings && !markings.carrier) throw new RoadsContainerRefusal(markings.refusal.code, markings.refusal.params);
  const dropped = parts.filter((part) => !stageOf.get(part).carrier);
  const lines = dropped.map((part) => roadsCarrierRefusalLine("carrier-part-left", { part, ...stageOf.get(part).refusal.params }));
  let adjusted = normal;
  for (const part of dropped) adjusted = applyRoadsStandard(adjusted, part);
  const wanted = wantedFor(roadsChangedParts(adjusted));
  if (!wanted.length) throw new RoadsContainerRefusal("carrier-over-budget", { needMiB: 0, budgetMiB: 0 });
  const perCarrier = placed.perCarrier;
  const total = (key) => Object.values(perCarrier).reduce((sum, item) => sum + item[key], 0);
  return {
    project: adjusted,
    wanted,
    chosen: groups,
    refused: [],
    droppedParts: dropped,
    keptParts: parts.filter((part) => !dropped.includes(part)),
    bytes: total("bytes"),
    cost: total("cost"),
    budget: perCarrier.update2?.budget ?? 0,
    fits: true,
    lines,
    carrier: true,
    /* Раскладка по носителям: `[[имя файла строчными, id носителя]]`, стадии и итоги по носителям (`carrier-budget.js`). */
    placement: wanted.map((file) => [file.name.toLowerCase(), placed.files.get(file.name.toLowerCase())]),
    stages: placed.stages,
    perCarrier,
    /* Для перекладки по настоящим размерам собранного (`replaceRoadsBuilt`): какие файлы у какой стадии и что знало старшинство паков. */
    stageFiles: Object.fromEntries(stages.map((stage) => [stage.id, stage.files.map((file) => file.name)])),
    ...(carrierPlan?.overlap ? { overlap: carrierPlan.overlap } : {}),
  };
}

/**
 * Перекладка раскладки по настоящим размерам СОБРАННОГО (ступень 1.1, 21.11.2026): план считал по стоковым размерам, перекрашенные файлы вышли больше, и проверка собранного (`assertRoadsBuilt`) отказала бы
 * всей работе. Вместо этого стадии плана (разметка, потом части по порядку) раскладываются заново по размерам собранных файлов и бюджетам носителей (без запаса: размеры настоящие): лишнее уходит в следующий
 * носитель очереди; часть, что не влезла нигде, остаётся «как в игре» со словом `carrier-part-left` (с конца: грунтовки, тротуары, асфальт), разметка — последней под отказ (`RoadsContainerRefusal`).
 * Файлы, что целиком принадлежали отброшенной части, из выдачи уходят; общий словарь остаётся там, где лежит другая стадия. `plan` — ответ `planRoadsContainer`, `files` — `[{ name, size, … }]`.
 * Ответ: `{ files, placement, droppedParts, lines, stages, perCarrier }`.
 */
export function replaceRoadsBuilt({ files, plan }) {
  if (!plan?.stageFiles || !plan.perCarrier) throw new Error("Перекладка по собранному: у плана нет стадий.");
  const sizeOf = new Map(files.map((file) => [String(file.name).toLowerCase(), file.size]));
  const ids = Object.keys(plan.perCarrier);
  const allows = seniorityAllows(plan.overlap);
  const carriers = ids.map((id) => ({ id, budget: plan.perCarrier[id].budget, containerOf: roadsLaneContainerOf(id), allows: carrierSubjectToSeniority(id) ? (name) => allows(id, name) : null }));
  const planned = new Set(Object.values(plan.stageFiles).flat().map((name) => String(name).toLowerCase()));
  /* Части, снятые ещё планом, не собирались: в перекладке их нет. */
  const stages = plan.stages.filter((stage) => stage.carrier).map((stage) => ({ id: stage.id, files: (plan.stageFiles[stage.id] || []).map((name) => String(name).toLowerCase()).filter((name) => sizeOf.has(name)).map((name) => ({ name, size: sizeOf.get(name) })) }));
  /* Собранное, чего план не знал (в стадиях нет), едет последним: не влезло — отказ, молча в update2 его больше не кладём. */
  const extra = [...sizeOf].filter(([name]) => !planned.has(name)).map(([name, size]) => ({ name, size }));
  if (extra.length) stages.push({ id: "extra", files: extra });
  const placed = placeStagesAcrossCarriers({ stages, carriers });
  const byId = new Map(placed.stages.map((stage) => [stage.id, stage]));
  for (const id of ["markings", "extra"]) if (byId.get(id) && !byId.get(id).fits) throw new RoadsContainerRefusal(byId.get(id).refusal.code, byId.get(id).refusal.params);
  const dropped = [...plan.droppedParts];
  const lines = [...(plan.lines || [])];
  for (const stage of placed.stages) {
    if (stage.fits || stage.id === "markings" || stage.id === "extra") continue;
    dropped.push(stage.id);
    lines.push(roadsCarrierRefusalLine("carrier-part-left", { part: stage.id, ...stage.refusal.params }));
  }
  const kept = files.filter((file) => placed.assignment.has(String(file.name).toLowerCase()));
  return {
    files: kept,
    placement: kept.map((file) => [String(file.name).toLowerCase(), placed.assignment.get(String(file.name).toLowerCase())]),
    droppedParts: dropped,
    lines,
    stages: placed.stages.map((stage) => ({ id: stage.id, carrier: stage.fits ? (placed.assignment.get(String(stage.files[0] ?? "")) ?? null) : null, ...(stage.fits ? {} : { refusal: stage.refusal }) })),
    perCarrier: placed.perCarrier,
  };
}

/**
 * План дорог под `update.rpf` до сборки. `files` — опись дорог (`inventory.files` и `models`: `{ name, textures }`), `sizeOf(имя)` — штатный размер файла
 * из переписи игры (нет — файла в игре нет, в расчёт не входит). Ответ: `{ project, wanted, chosen, refused, droppedParts, bytes, cost, budget, fits, lines }`.
 * `project` — работа без того, что не влезло (группа — целиком «как в игре», части асфальта, грунтовок и тротуаров — тоже), `wanted` — файлы описи
 * выбранных групп, `lines` — строки журнала о снятом. Отказ — `RoadsContainerRefusal` до любой сборки и записи.
 */
export function planRoadsContainer({ project, files, sizeOf, updateLength, reclaimBytes = 0, standingPacks = false, carrier = false, carrierPlan = null, spill = null } = {}) {
  if (standingPacks) throw new RoadsContainerRefusal(carrier ? "carrier-packs-standing" : "packs-standing");
  const normal = normalizeRoadsProject(project);
  const { markings } = normal;
  /* Общие «Скрыть», яркость и износ касаются всех групп: в update.rpf они не помещаются, а в носителе все шесть групп лежат (`planRoadsCarrier`). */
  if (!carrier && (markings.hidden || markings.brightness !== ROAD_MARKING_BRIGHTNESS.standard || markings.wear !== ROAD_MARKING_WEAR.standard))
    throw new RoadsContainerRefusal("global-markings");
  if (carrier) return planRoadsCarrier({ normal, files, sizeOf, updateLength, reclaimBytes, carrierPlan: spill ? { ...(carrierPlan || {}), spill } : carrierPlan });
  const changed = roadsChangedParts(normal);
  const droppedParts = ROAD_PART_IDS.filter((id) => changed.parts.has(id));
  const requested = ROAD_GROUP_IDS.filter((id) => !isGroupStock(markings, id));
  if (!requested.length) throw new RoadsContainerRefusal("parts-unavailable", { parts: droppedParts });

  const known = (file) => Number.isFinite(sizeOf?.(file.name));
  const forGroup = (id) =>
    files.filter((file) => known(file) && roadsDictionaryWanted(file.textures, { parts: new Set(), lines: true, groups: ROAD_GROUP_BITS[id] }));
  const budget = roadsBudgetBytes({ updateLength, reclaimBytes });
  const answer = selectRoadsGroups({
    groups: requested.map((id) => ({ id, files: forGroup(id).map((file) => ({ name: file.name, size: sizeOf(file.name) })) })),
    budget,
  });
  if (!answer.chosen.length) throw new RoadsContainerRefusal("nothing-fits", { groups: requested, budgetMiB: miB(budget) });

  let adjusted = normal;
  for (const id of droppedParts) adjusted = applyRoadsStandard(adjusted, id);
  if (answer.refused.length) {
    adjusted = {
      ...adjusted,
      markings: {
        ...adjusted.markings,
        ...Object.fromEntries(answer.refused.map(({ id }) => [id, { ...adjusted.markings[id], mode: "standard", brightness: ROAD_MARKING_BRIGHTNESS.standard }])),
      },
    };
  }
  const left = roadsChangedParts(adjusted);
  const wanted = files.filter((file) => known(file) && roadsDictionaryWanted(file.textures, left));

  const lines = [];
  for (const { id, code } of answer.refused) {
    const union = new Map(answer.files);
    for (const file of forGroup(id)) union.set(file.name.toLowerCase(), sizeOf(file.name));
    const need = roadsCostBytes(union.size, [...union.values()].reduce((sum, size) => sum + size, 0));
    lines.push(roadsRefusalLine(code, { groups: [id], needMiB: miB(need), budgetMiB: miB(budget) }));
  }
  if (droppedParts.length) lines.push(roadsRefusalLine("parts-unavailable", { parts: droppedParts }));
  return { project: adjusted, wanted, chosen: answer.chosen, refused: answer.refused, droppedParts, bytes: answer.bytes, cost: answer.cost, budget, fits: true, lines };
}

/**
 * Проверка собранного по настоящим файлам (после перекраски) до первой записи в игру: цена всех файлов в бюджете, и ни один контейнер не выше предела.
 * `files` — `[{ name, size }]`. Не влезло — `RoadsContainerRefusal("over-budget")`.
 */
export function assertRoadsBuilt({ files, budget, carrier = false, placement = null, budgets = null }) {
  if (carrier && placement && budgets) {
    /* Несколько носителей: настоящие размеры собранного по раскладке плана — в бюджете КАЖДОГО носителя и в пределе его контейнеров. */
    const where = new Map(placement);
    const byCarrier = new Map();
    for (const { name, size } of files) {
      const id = where.get(String(name).toLowerCase()) ?? "update2";
      if (!byCarrier.has(id)) byCarrier.set(id, []);
      byCarrier.get(id).push({ name: String(name).toLowerCase(), size });
    }
    for (const [id, list] of byCarrier) {
      /* Каждый носитель — со своими контейнерами: update2 и пакеты — слоя, update — самого update.rpf. */
      const placed = placeStagesAcrossCarriers({ stages: [{ id: "built", files: list }], carriers: [{ id, budget: budgets[id] ?? 0, containerOf: roadsLaneContainerOf(id) }] });
      if (!placed.stages[0].fits) throw new RoadsContainerRefusal(placed.stages[0].refusal.code, placed.stages[0].refusal.params);
    }
    return;
  }
  if (carrier) {
    const all = selectRoadsCarrier({ groups: [{ id: "center", files: files.map(({ name, size }) => ({ name, size })) }], budget });
    if (!all.fits) throw new RoadsContainerRefusal(all.refusal.code, all.refusal.params);
    return;
  }
  const sides = new Map(ROADS_UPDATE_CONTAINERS.map((container) => [container, { count: 0, bytes: 0 }]));
  let bytes = 0;
  for (const file of files) {
    const side = sides.get(roadsContainerOf(file.name));
    side.count += 1;
    side.bytes += file.size;
    bytes += file.size;
  }
  const cost = roadsCostBytes(files.length, bytes);
  const heaviest = Math.max(...[...sides.values()].map((side) => roadsCostBytes(side.count, side.bytes)));
  if (cost > budget || heaviest > 1024 * MiB) throw new RoadsContainerRefusal("over-budget", { groups: ["собранное"], needMiB: miB(Math.max(cost, heaviest)), budgetMiB: miB(budget) });
}
