import { ROADS_CONTAINER_MAX_BYTES, roadsCostBytes } from "./roads-update-route.js";

/*
 * Общий раскладчик ПО ФАЙЛАМ по очереди носителей (21.11.2026; дороги и растительность считают через него, раскладчика в двух местах нет).
 * Носители идут по очереди (сначала `update2.rpf`, потом сам `update.rpf`: контейнеры `x64/astral/…`). Стадия (единица работы: разметка, асфальт, трава города…) «едет», если ВСЯ
 * влезла (по файлам, хоть через несколько носителей); иначе откатывается целиком (ни один её файл не назначен) и остаётся «как в игре», а следующая стадия проверяется всё равно.
 * Файл лежит ровно в одном носителе (общий файл двух стадий — один раз, там, где лёг первым); карты и словари одной единицы не обязаны лежать вместе.
 * Бюджет носителя — цена всех его файлов (`roadsCostBytes`: выравнивание и запас на перекраску) не выше `budget`; контейнер носителя (`containerOf(имя)`) — не выше 1 ГиБ.
 * Модуль чистый: ввода-вывода нет, размеры и бюджеты подают числами; без выбора по времени и случайности: повтор даёт ту же раскладку.
 */

const MiB = 1024 * 1024;
const miB = (bytes) => Math.ceil(bytes / MiB);

/**
 * @param stages   `[{ id, files: [{ name, size }] }]` по порядку важности (первая — первой).
 * @param carriers `[{ id, budget, containerOf(name), limit? }]` по очереди; `budget` — байты цены, `limit` — предел контейнера (по умолчанию 1 ГиБ).
 * @returns `{ stages: [{ id, fits, files, refusal }], assignment: Map имя → id носителя, perCarrier: { id: { count, bytes, cost, budget } } }`;
 *          `refusal` — `null` или `{ code: "carrier-over-budget" | "carrier-container-full", params }`.
 */
export function placeStagesAcrossCarriers({ stages = [], carriers = [] } = {}) {
  const ids = new Set();
  const lanes = carriers.map((carrier) => {
    if (!carrier?.id || ids.has(carrier.id)) throw new Error(`Носитель ${carrier?.id ?? "?"} назван дважды или без имени.`);
    ids.add(carrier.id);
    if (!Number.isFinite(carrier.budget) || carrier.budget < 0) throw new Error(`Бюджет носителя ${carrier.id} не назван.`);
    if (typeof carrier.containerOf !== "function") throw new Error(`У носителя ${carrier.id} нет раскладки по контейнерам.`);
    return { id: carrier.id, budget: carrier.budget, limit: carrier.limit ?? ROADS_CONTAINER_MAX_BYTES, containerOf: carrier.containerOf, planBudget: Number.isFinite(carrier.planBudget) ? carrier.planBudget : carrier.budget, allows: typeof carrier.allows === "function" ? carrier.allows : null, count: 0, bytes: 0, sides: new Map() };
  });
  /* Полосы-паки по числу запретных файлов (21.11.2026, слово лида 1; находка А ревью): чем позже пак в порядке подключения, тем меньше имён он проигрывает; сначала добивается пак с меньшим числом запретных
     (уже тронутый хозяин), равенство — прежний порядок. Полосы без запретов (update2, update.rpf) держат своё место, паки переставляются между своими слотами. Раскладчик общий — порядок один у дорог и растительности. */
  const slots = lanes.map((lane, index) => (lane.allows ? index : -1)).filter((index) => index >= 0);
  if (slots.length > 1) {
    const names = [...new Set(stages.flatMap((stage) => (stage?.files || []).map((file) => String(file?.name ?? "").toLowerCase())))];
    const blocked = new Map(slots.map((index) => [lanes[index], names.filter((name) => !lanes[index].allows(name)).length]));
    const ordered = slots.map((index) => lanes[index]).sort((a, b) => blocked.get(a) - blocked.get(b));
    slots.forEach((index, position) => {
      lanes[index] = ordered[position];
    });
  }
  const stageIds = new Set();
  const assignment = new Map();
  const results = [];
  /* Предзагрузка носителя (`carrier.preload: [{ name, size }]`, 21.11.2026, ревью М-5): файлы, что УЖЕ лежат в нём или решены до раскладки (деревья растительности в контейнерах update.rpf), занимают бюджет и
     предел контейнера, но стадиям не назначаются и в `assignment` не попадают. */
  const preloadCarrier = (lane, files) => {
    for (const file of files || []) {
      const container = lane.containerOf(file.name);
      const side = lane.sides.get(container) || { count: 0, bytes: 0 };
      lane.count += 1;
      lane.bytes += file.size;
      side.count += 1;
      side.bytes += file.size;
      lane.sides.set(container, side);
    }
  };
  for (const [index, carrier] of carriers.entries()) preloadCarrier(lanes[index], carrier.preload);
  const costOf = (lane) => roadsCostBytes(lane.count, lane.bytes);
  const sideCost = (lane, container) => {
    const side = lane.sides.get(container) || { count: 0, bytes: 0 };
    return roadsCostBytes(side.count, side.bytes);
  };
  const add = (lane, name, size) => {
    const container = lane.containerOf(name);
    const side = lane.sides.get(container) || { count: 0, bytes: 0 };
    lane.count += 1;
    lane.bytes += size;
    side.count += 1;
    side.bytes += size;
    lane.sides.set(container, side);
    return container;
  };
  const remove = (lane, name, size) => {
    const container = lane.containerOf(name);
    const side = lane.sides.get(container);
    lane.count -= 1;
    lane.bytes -= size;
    side.count -= 1;
    side.bytes -= size;
  };
  /* Влезает ли файл в носитель: сверка пробной вставкой и откатом. */
  const tryPlace = (lane, name, size) => {
    const container = add(lane, name, size);
    /* Раскладка идёт по `planBudget` (бюджет за вычетом запаса на рост собранного, `carrier-budget.js`); отчёт и проверка собранного — по полному `budget`. */
    const fits = costOf(lane) <= lane.planBudget && sideCost(lane, container) <= lane.limit;
    const reason = costOf(lane) > lane.planBudget ? "carrier-over-budget" : "carrier-container-full";
    if (!fits) remove(lane, name, size);
    return { fits, reason };
  };
  /* Запретные файлы первыми по ВСЕМ стадиям (сухой план srv, 21.11.2026): файл с запретом старшинства годится только части носителей (update2, update.rpf); если свободные файлы ранних стадий заберут их место,
     поздняя стадия упадёт целиком при пустых паках. Поэтому запретные файлы всех стадий занимают допустимые полосы заранее, в порядке стадий (важность) и крупные первыми; стадия, что не легла, отдаёт
     свои запретные файлы обратно (если их не держит другая стадия). */
  const pre = new Map();
  for (const stage of stages) {
    const own = new Map();
    for (const file of stage?.files || []) if (typeof file?.name === "string" && file.name && Number.isFinite(file.size) && file.size >= 0) own.set(file.name.toLowerCase(), file.size);
    const restrictedNames = [...own].filter(([name]) => lanes.some((lane) => lane.allows && !lane.allows(name))).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [name, size] of restrictedNames) {
      if (pre.has(name)) {
        pre.get(name).owners.add(stage.id);
        continue;
      }
      const lane = lanes.find((candidate) => (!candidate.allows || candidate.allows(name)) && tryPlace(candidate, name, size).fits);
      if (lane) pre.set(name, { lane, size, owners: new Set([stage.id]) });
    }
  }
  for (const [name, item] of pre) assignment.set(name, item.lane.id);
  for (const stage of stages) {
    if (!stage?.id || stageIds.has(stage.id)) throw new Error(`Стадия ${stage?.id ?? "?"} названа дважды или без имени.`);
    stageIds.add(stage.id);
    const wanted = new Map();
    for (const file of stage.files || []) {
      if (typeof file?.name !== "string" || !file.name) throw new Error(`Имя файла стадии ${stage.id} не названо.`);
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error(`У файла ${file.name} неверный размер.`);
      wanted.set(file.name.toLowerCase(), file.size);
    }
    /* Первыми — файлы с ограниченным выбором носителя (старшинство паков: им годится только часть носителей, иначе свободные файлы займут их место раньше), потом крупные (плотнее упаковка),
       при равенстве — по имени: раскладка не зависит от порядка входа. */
    const restricted = (name) => lanes.some((lane) => lane.allows && !lane.allows(name));
    const list = [...wanted].filter(([name]) => !assignment.has(name)).sort((a, b) => Number(restricted(b[0])) - Number(restricted(a[0])) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const placed = [];
    let failure = null;
    for (const [name, size] of list) {
      let done = null;
      let reason = "carrier-over-budget";
      for (const lane of lanes) {
        /* Старшинство паков (`carrier-seniority.js`): носитель, где файл перекрыт штатным, не пробуется (update2 и update.rpf допустимы всегда). */
        if (lane.allows && !lane.allows(name)) continue;
        const attempt = tryPlace(lane, name, size);
        if (attempt.fits) {
          done = lane;
          break;
        }
        if (attempt.reason === "carrier-container-full") reason = attempt.reason;
      }
      if (!done) {
        failure = { name, size, reason };
        break;
      }
      placed.push({ name, size, lane: done });
      assignment.set(name, done.id);
    }
    if (failure) {
      for (const { name, size, lane } of placed) {
        remove(lane, name, size);
        assignment.delete(name);
      }
      /* Свои запретные файлы стадия отдаёт, если их не держит другая ещё не решённая или легшая стадия. */
      for (const name of wanted.keys()) {
        const held = pre.get(name);
        if (!held) continue;
        held.owners.delete(stage.id);
        if (!held.owners.size) {
          remove(held.lane, name, held.size);
          assignment.delete(name);
          pre.delete(name);
        }
      }
      /* Доступное ЭТОЙ стадии: свободное место полос, куда падающему файлу можно (запрет старшинства), а не сумма всех носителей. */
      const free = lanes.filter((lane) => !lane.allows || lane.allows(failure.name)).reduce((sum, lane) => sum + Math.max(0, lane.budget - costOf(lane)), 0);
      const need = roadsCostBytes(list.length, list.reduce((sum, [, size]) => sum + size, 0));
      results.push({
        id: stage.id,
        fits: false,
        files: [],
        refusal: { code: failure.reason, params: { needMiB: miB(need), budgetMiB: miB(failure.reason === "carrier-container-full" ? ROADS_CONTAINER_MAX_BYTES : free) } },
      });
    } else results.push({ id: stage.id, fits: true, files: [...wanted.keys()], refusal: null });
  }
  return {
    stages: results,
    assignment,
    perCarrier: Object.fromEntries(
      lanes.map((lane) => [lane.id, { count: lane.count, bytes: lane.bytes, cost: costOf(lane), budget: lane.budget, heaviest: Math.max(0, ...[...lane.sides.keys()].map((container) => sideCost(lane, container))) }]),
    ),
  };
}

/** Остаток бюджета каждого носителя ПОСЛЕ раскладки (для второй работы: трава считает от того, что оставили дороги). */
export function spillLengthsAfter(carriers, answer) {
  return Object.fromEntries(carriers.map((carrier) => [carrier.id, carrier.budget - (answer.perCarrier[carrier.id]?.cost ?? 0)]));
}
