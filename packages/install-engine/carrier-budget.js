/*
 * Бюджет по очереди носителей (21.11.2026): когда в `update2.rpf` не хватает места, группа файлов кладётся в ПЕРВЫЙ из включённых носителей (очередь — `carrier-targets.js: CARRIER_QUEUE`), куда она влезает целиком;
 * не влезла никуда — называется в ответе (`unplaced`), а не кладётся «частью» (половина группы — дыры). Модуль чистый: длины настоящих файлов подают числами, диск не читается.
 */
import { CARRIERS, CARRIER_QUEUE } from "./carrier-targets.js";
import { ROADS_SPILL_CARRIER, roadsLaneContainerOf } from "./roads-carrier-route.js";
import { placeStagesAcrossCarriers } from "./carrier-spill.js";
import { carrierSubjectToSeniority, seniorityAllows } from "./carrier-seniority.js";
import { roadsBudgetBytes } from "./roads-update-route.js";
import { takeReserve } from "./forbidden-reserve.js";

/**
 * Постоянный запас в update2.rpf под карты травы `.ymap` растительности (решение первого лида 21.11.2026): карты подтверждены в сюжете и на сервере только в update2.rpf, а словари и модели
 * могут лечь в update.rpf и штатные пакеты. Дороги (разметка, тротуары, асфальт, грунтовки) этот запас не занимают никогда; растительность распоряжается им сама (`vegetation-update-install.js`).
 * Константа стоит рядом с резервом update.rpf (`ROADS_BUDGET_RESERVE_BYTES`).
 */
export const CARRIER_MAPS_RESERVE_BYTES = 256 * 1024 * 1024;

/**
 * Запас под карты травы и цветы в update2.rpf, когда включены полосы-подпакеты (стенд srv на девяти полосах, 21.11.2026): карты обеих зон 392 МиБ и цветы 704 МиБ живут ТОЛЬКО в update2.rpf, а дороги забирали его почти целиком
 * (после дорог 472 МиБ, цветам «нужно 704, свободно 473»). Дорогам есть куда уйти (полосы), поэтому по умолчанию они оставляют 1,1 ГиБ; настоящую потребность называет растительность (`spill.mapsReserveBytes`).
 * Без полос запас прежний (`CARRIER_MAPS_RESERVE_BYTES`, ступень 1).
 */
export const CARRIER_MAPS_RESERVE_LANES_BYTES = 1126 * 1024 * 1024;

/** Запас под карты: без полос — прежний; с полосами — число от растительности (0 — растительность уже стоит), иначе умолчание. */
export const mapsReserveOf = (spill, lanesOn) =>
  !lanesOn ? CARRIER_MAPS_RESERVE_BYTES : Number.isFinite(spill?.mapsReserveBytes) && spill.mapsReserveBytes >= 0 ? spill.mapsReserveBytes : CARRIER_MAPS_RESERVE_LANES_BYTES;

/**
 * Запас в update.rpf под ДЕРЕВЬЯ растительности (находка прогона общего набора 21.11.2026: дороги заняли update.rpf до 171 МиБ свободных, общий цвет листвы вида — ≈ 560 МиБ — не влез, и вид
 * ушёл прежним путём): деревья вида живут только в контейнерах update.rpf, поэтому дороги, ложась вторым носителем в сам update.rpf, оставляют там 768 МиБ сверх резерва update.rpf (512 МиБ).
 */
export const CARRIER_TREES_RESERVE_BYTES = 768 * 1024 * 1024;

/**
 * Запас под деревья в update.rpf: настоящая потребность проекта (подсчёт растительности, `countPlan`: деревья вида идут только в update.rpf) приходит в `spill.treesReserveBytes` и заменяет умолчание 768 МиБ;
 * решение лида 1 21.11.2026: деревья в update.rpf старше частей дорог и травы, дороги разливаются туда ровно настолько, насколько не могут иначе. Не названо или не число — умолчание.
 */
export const treesReserveOf = (spill) => (Number.isFinite(spill?.treesReserveBytes) && spill.treesReserveBytes >= 0 ? spill.treesReserveBytes : CARRIER_TREES_RESERVE_BYTES);

/**
 * Запас под траву города в штатных паках (находка прогона общего набора 21.11.2026: трава города 1465 МиБ не встала, потому что дороги заняли паки; изгороди после неё встали): пока штатные паки
 * включены, дороги оставляют в них 1536 МиБ (1,5 ГиБ: 1465 МиБ с запасом около 5 %), отнимая с последнего пака очереди назад. Без паков (по умолчанию) запаса нет: у двух носителей по умолчанию
 * места траве города всё равно не остаётся.
 */
export const CARRIER_GRASS_CITY_RESERVE_BYTES = 1536 * 1024 * 1024;
const packLanesExist = (lanes) => lanes.some((lane) => carrierSubjectToSeniority(lane.id));

/** Свободно в носителе: предел минус настоящая длина файла (не меньше нуля). */
export const carrierFreeBytes = (carrier, length) => Math.max(0, carrier.limitBytes - Math.max(0, Number(length) || 0));

/**
 * `items` — `[{ id, bytes }]` (цена группы в носителе, байт; порядок — порядок предложения), `lengths` — настоящие длины файлов носителей `{ <id носителя>: байт }`,
 * `enabled` — включённые носители (`enabledCarrierIds`). Ответ: `{ placed: [{ id, carrier, bytes }], unplaced: [{ id, bytes }], free: { <id>: байт } }`.
 * Носитель без названной длины берёт длину чистого файла из таблицы.
 */
export function allocateToCarriers({ items = [], lengths = {}, enabled = [] } = {}) {
  const on = new Set(enabled);
  const queue = CARRIERS.filter((carrier) => on.has(carrier.id)).sort((a, b) => CARRIER_QUEUE.indexOf(a.id) - CARRIER_QUEUE.indexOf(b.id));
  const free = Object.fromEntries(queue.map((carrier) => [carrier.id, carrierFreeBytes(carrier, lengths[carrier.id] ?? carrier.baseBytes)]));
  const placed = [];
  const unplaced = [];
  for (const item of items) {
    const bytes = Math.max(0, Number(item?.bytes) || 0);
    const carrier = queue.find((candidate) => free[candidate.id] >= bytes);
    if (!carrier) {
      unplaced.push({ id: item.id, bytes });
      continue;
    }
    free[carrier.id] -= bytes;
    placed.push({ id: item.id, carrier: carrier.id, bytes });
  }
  return { placed, unplaced, free };
}

/**
 * Раскладка СТАДИЙ файлов по очереди носителей (дороги: разметка, потом асфальт, тротуары, грунтовки; растительность — после дорог, тем же расчётом). `stages` — `[{ id, files: [{ name, size }] }]` в порядке
 * предложения. Стадия едет, если ВСЯ влезла по файлам по очереди носителей (бюджет и предел контейнера в 1 ГиБ, `carrier-spill.js`: файлы идут в первый носитель, куда влезают, остаток — в следующий); файл, что уже лёг в
 * какой-то носитель, остаётся там и второй раз не считается (имя файла живёт ровно в одном носителе). Не влезла никуда — стадия названа с причиной первого носителя очереди.
 * `lengths` — настоящие длины файлов носителей, `reclaim` — место своих стоящих контейнеров по носителям (уйдут при замене), `enabled` — включённые носители.
 * Ответ: `{ stages: [{ id, carrier|null, fresh, refusal? }], files: Map имя → id носителя, perCarrier: { id: { count, bytes, cost, budget, heaviest } } }`.
 */
/**
 * Запас на рост собранного (блокер релиза 86602e275, 21.11.2026): раскладка по стоковым размерам заполняла update2.rpf ровно до бюджета (3360 из 3360 МиБ), а перекрашенные файлы выходят чуть больше
 * стоковых (≈ 1 %) — проверка собранного отказывала «нужно 3393, свободно 3360», и работа уходила на пакеты при свободной второй полосе. Теперь носитель заполняется до `1 − PLAN_HEADROOM` бюджета,
 * остальное уходит в следующий носитель; не легла первая стадия — запас снимается (лучше впритык, чем отказ).
 */
export const PLAN_HEADROOM = 0.03;

export function placeStagesOnCarriers(options = {}) {
  /* Запасы под растительность, которой в работе может и не быть (21.11.2026, слово лида 1): деревья (768 МиБ в update.rpf) и карты травы (256 МиБ в update2). Сначала раскладка с обоими запасами — растительность
     после дорог найдёт место; не влезла ПЕРВАЯ стадия (разметка: она обязана лечь, как на main) — запас деревьев отпускается, потом и запас карт. Части (асфальт, тротуары, грунтовки) запасов не отнимают: не влезли — «как в игре». */
  const levels = [{ trees: true, maps: true, name: "full" }, { trees: false, maps: true, name: "no-trees" }, { trees: false, maps: false, name: "none" }];
  let best = null;
  for (const [headroom, level] of [...levels.map((item) => [PLAN_HEADROOM, item]), ...levels.map((item) => [0, item])]) {
    const answer = placeOnce(options, level, headroom);
    const fitted = answer.stages.filter((stage) => stage.carrier).length;
    if (!best || fitted > best.fitted) best = { answer, fitted, level, headroom };
    if (!answer.stages.length || answer.stages[0].carrier) {
      best = { answer, fitted, level, headroom };
      break;
    }
  }
  return { ...best.answer, reserves: best.level.name, headroom: best.headroom };
}

function placeOnce({ stages = [], lengths = {}, reclaim = {}, enabled = [], spill = null, overlap = null, reserveOther = 0 } = {}, level = { trees: true, maps: true }, headroom = 0) {
  const on = new Set(enabled);
  const allowed = seniorityAllows(overlap);
  const queue = CARRIERS.filter((carrier) => on.has(carrier.id)).sort((a, b) => CARRIER_QUEUE.indexOf(a.id) - CARRIER_QUEUE.indexOf(b.id));
  const lanes = [];
  const spillLane = spill
    ? { id: ROADS_SPILL_CARRIER, budget: Math.max(0, roadsBudgetBytes({ updateLength: spill.updateLength, reclaimBytes: spill.updateReclaimBytes ?? 0 }) - (level.trees ? treesReserveOf(spill) : 0)), containerOf: roadsLaneContainerOf(ROADS_SPILL_CARRIER) }
    : null;
  for (const carrier of queue) {
    const length = Math.max(0, Number(lengths[carrier.id] ?? carrier.baseBytes) || 0);
    const own = Math.max(0, Number(reclaim[carrier.id]) || 0);
    /* У update2.rpf — постоянный запас под карты травы (`CARRIER_MAPS_RESERVE_BYTES`): дороги его не занимают никогда. */
    /* Запас нужен, когда у словарей и моделей растительности есть другие носители (update.rpf или пакет); у одного update2 без второго носителя растительности через него всё равно не поставить, запас не держится. */
    const reserve = level.maps && carrier.id === "update2" && (spillLane || queue.length > 1) ? mapsReserveOf(spill, queue.some((item) => item.registration === "pack-sub")) : 0;
    lanes.push({ id: carrier.id, budget: Math.max(0, carrier.limitBytes - Math.max(0, length - own) - reserve), containerOf: roadsLaneContainerOf(carrier.id), allows: carrierSubjectToSeniority(carrier.id) ? (name) => allowed(carrier.id, name) : null });
    /* Второй носитель — сам update.rpf — сразу после update2: очередь update2, update, штатные пакеты. */
    if (carrier.id === "update2" && spillLane) lanes.push(spillLane);
  }
  if (spillLane && !lanes.includes(spillLane)) lanes.unshift(spillLane);
  /* Хозяева по порядку подключения (сухой план srv 21.11.2026): чем позже пак, тем меньше имён он проигрывает; пак с меньшим числом запретных файлов (старшинство, `allows`) идёт в очереди раньше. Остальные
     полосы (update2, update.rpf) держат своё место, паки — в своих слотах (запас травы города ниже берётся уже с последнего в этом порядке); равенство — прежний порядок таблицы. */
  const stageNames = [...new Set(stages.flatMap((stage) => (stage.files || []).map((file) => String(file.name).toLowerCase())))];
  const slots = lanes.map((lane, index) => (lane.allows ? index : -1)).filter((index) => index >= 0);
  if (slots.length > 1) {
    const blocked = new Map(slots.map((index) => [lanes[index], stageNames.filter((name) => !lanes[index].allows(name)).length]));
    const packs = slots.map((index) => lanes[index]).sort((a, b) => blocked.get(a) - blocked.get(b));
    slots.forEach((index, order) => {
      lanes[index] = packs[order];
    });
  }
  /* Запас под запретные файлы ДРУГОЙ работы (растительность; `forbidden-reserve.js`): работа, что ставится первой, оставляет в update2.rpf (потом update.rpf) место под файлы, запрещённые старшинством во всех
     полосах-паках; снимается вместе с запасом деревьев, если разметке иначе не лечь (она обязана лечь). */
  if (level.trees && reserveOther > 0) {
    const first = lanes.find((lane) => lane.id === "update2");
    const second = lanes.find((lane) => lane.id === ROADS_SPILL_CARRIER);
    const left = takeReserve({ update2: first?.budget ?? 0, update: second?.budget ?? 0 }, reserveOther);
    if (first) first.budget = left.update2;
    if (second) second.budget = left.update;
  }
  /* Запас травы города в штатных паках (прогон общего набора 21.11.2026: дороги заняли место, трава города отказана, а изгороди встали): пока паки включены, дороги оставляют в них
     `CARRIER_GRASS_CITY_RESERVE_BYTES` — с последнего пака назад; трава города (1465 МиБ по прогону) берёт его после дорог. */
  let reserveLeft = packLanesExist(lanes) ? CARRIER_GRASS_CITY_RESERVE_BYTES : 0;
  for (const lane of [...lanes].reverse()) {
    if (!reserveLeft || !carrierSubjectToSeniority(lane.id)) continue;
    const take = Math.min(lane.budget, reserveLeft);
    lane.budget -= take;
    reserveLeft -= take;
  }
  for (const lane of lanes) lane.planBudget = Math.floor(lane.budget * (1 - headroom));
  const placed = placeStagesAcrossCarriers({ stages, carriers: lanes });
  /* Стадия едет, если влезла вся — хоть частями в разные носители (раскладка по файлам, `carrier-spill.js`); `carrier` — носитель её первого файла, `carriers` — все, где лежат её файлы, `fresh` — файлы, которых до неё ещё не было. */
  const seen = new Set();
  const result = placed.stages.map((stage) => {
    const fresh = stage.files.filter((name) => !seen.has(name)).length;
    for (const name of stage.files) seen.add(name);
    return stage.fits
      ? { id: stage.id, carrier: placed.assignment.get(String(stage.files[0] ?? "")) ?? null, fresh, carriers: [...new Set(stage.files.map((name) => placed.assignment.get(name)).filter(Boolean))] }
      : { id: stage.id, carrier: null, fresh: 0, refusal: stage.refusal };
  });
  return { stages: result, files: placed.assignment, perCarrier: placed.perCarrier };
}

/**
 * Длины носителей ПОСЛЕ раскладки: следующая работа (растительность после дорог) считает свой бюджет от них, а не от живых файлов, — один общий расчёт по очереди носителей, а не два разных.
 * `before` — `{ lengths, reclaim }` как у `placeStagesOnCarriers`, `perCarrier` — её ответ. Длина носителя = (прежняя длина минус возвращённое место) плюс цена уложенного (с запасом на перекраску); возврат обнуляется.
 */
export function lengthsAfterPlacement({ lengths = {}, reclaim = {} } = {}, perCarrier = {}) {
  const next = {};
  for (const carrier of CARRIERS) {
    const used = perCarrier[carrier.id]?.cost ?? 0;
    if (!(carrier.id in lengths) && !used) continue;
    const length = Math.max(0, Number(lengths[carrier.id] ?? carrier.baseBytes) || 0);
    next[carrier.id] = Math.max(0, length - Math.max(0, Number(reclaim[carrier.id]) || 0)) + used;
  }
  return { lengths: next, reclaim: {} };
}
