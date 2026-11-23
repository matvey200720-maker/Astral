/*
 * Вердикт сторожа подпакетов (GTA 5 RP, 21.11.2026, задание «сторож и сверка для носителя-подпакета»).
 *
 * Подпакет — файл `dlc<N>.rpf` рядом с `dlc.rpf` штатного пакета-хозяина: игра сама монтирует столько подпакетов, сколько назван в `setup2.xml` хозяина (`subPackCount`), а наши
 * контейнеры регистрируются в `content.xml` хозяина. Регистрация, число и контейнер лежат в РАЗНЫХ файлах, поэтому появляется случай, которого у пакета-носителя без подпакета не бывает:
 * число или регистрация есть, а файла с контейнером нет. Набор «регистрация без файла» у носителей ронял игру на входе («Corrupt game data», `docs/RP-CARRIERS-TESTPC-2011.md`, раздел 5), по
 * аналогии это считается опасным и здесь (замер подпакета «число поднято, файла нет» не делался, `.local/team/lead/rp/05-pack-carrier-map.md`, §2.5).
 *
 * Здесь только чистое: ничего не читает и не пишет, чтение — в `apps/desktop/src/carriers-start-guard.js`, починка — там же. Модуль без импортов (его читает главный процесс).
 * Три исхода:
 *  • ОПАСНО (`status: "danger"`) — число подпакетов больше штатного, а файла какого-то из «наших» номеров нет; ИЛИ в `content.xml` хозяина зарегистрирован контейнер, которого нет ни в
 *    хозяине, ни в смонтированном подпакете. Лечится пересборкой хозяина с регистрацией «по факту» ДО запуска игры.
 *  • МУСОР (`status: "garbage"`) — файл подпакета лежит, числа на него нет, в нём ТОЛЬКО наши контейнеры. Если состояние Astral ещё числит за ним работы — сначала их паркуют (`park`);
 *    если их уже запарковали (проверка файлов Steam вернула хозяина штатным) — файл ждёт «Починить» и остаётся (`kept`: в нём наше, «Починить» вернёт число и регистрацию); иначе файл можно убрать (`remove`). Чужое содержимое (или файл, что прочитать не удалось, или пустой) не трогается никогда (`foreign`).
 *  • сходится (`status: "ok"`).
 * Номера штатных подпакетов (`index <= stockCount`) — не наши: их отсутствие или содержимое не считаются нашей бедой и не убираются.
 */

const lower = (value) => String(value ?? "").toLowerCase();
const nameSet = (values) => new Set([...(values || [])].map(lower));
const sorted = (values) => [...values].sort((a, b) => (typeof a === "number" ? a - b : String(a).localeCompare(String(b))));
const count = (value) => Number.isInteger(value) && value >= 0;

/**
 * @param {object} input
 * @param {number} input.stockCount штатное число подпакетов хозяина (основа, не наша правка)
 * @param {number|null} input.liveCount число в живом `setup2.xml`; `null` — не прочитано
 * @param {string[]|null} input.registered наши контейнеры, зарегистрированные в живом `content.xml` хозяина; `null` — не прочитано
 * @param {string[]|null} input.hostContainers наши контейнеры в оглавлении самого хозяина; `null` — не прочитано
 * @param {Array<{ index: number, exists: boolean, ours?: string[]|null, foreign?: boolean }>} input.subpacks по одному на каждый номер, какой смотрели; не названный номер — файла нет.
 *   `ours` — наши контейнеры в файле (`null` — файл есть, а оглавление не прочиталось); `foreign` — в файле есть что-то НЕ наше
 * @param {string[]} [input.stateOwned] имена контейнеров, которые состояние Astral числит за подпакетами этого хозяина
 * @param {string[]} [input.parkedOwned] имена контейнеров подпакетов хозяина, чьи работы запаркованы («снятые», `target.parked`): файл с ними не мусор
 */
export function subpackGuardVerdict({ stockCount, liveCount, registered, hostContainers, subpacks = [], stateOwned = [], parkedOwned = [] } = {}) {
  const unreadable = { readable: false, status: "unreadable", danger: { missingFiles: [], orphans: [] }, garbage: { remove: [], park: [], kept: [] }, foreign: [], stockMissing: [], unregistered: [] };
  if (!count(stockCount) || !count(liveCount) || !Array.isArray(registered) || !Array.isArray(hostContainers)) return unreadable;
  const files = new Map((subpacks || []).map((item) => [item.index, item]));
  const exists = (index) => files.get(index)?.exists === true;
  const owned = nameSet(stateOwned);
  const parkedNames = nameSet(parkedOwned);

  /* Смонтированные номера — 1..liveCount; файл, что есть, а оглавление не прочиталось, лишает вердикта: что в нём зарегистрировано, неизвестно. */
  const reachable = nameSet(hostContainers);
  const missing = [];
  for (let index = 1; index <= liveCount; index += 1) {
    if (!exists(index)) {
      missing.push(index);
      continue;
    }
    const ours = files.get(index).ours;
    if (!Array.isArray(ours)) return unreadable;
    for (const name of ours) reachable.add(lower(name));
  }

  const missingFiles = sorted(missing.filter((index) => index > stockCount));
  const stockMissing = sorted(missing.filter((index) => index <= stockCount));
  const registeredNames = nameSet(registered);
  const orphans = sorted([...registeredNames].filter((name) => !reachable.has(name)));
  const unregistered = sorted([...reachable].filter((name) => !registeredNames.has(name)));

  /* Файлы за числом: наши и только наши — мусор (или работы ещё числятся); остальное не трогается. */
  const remove = [];
  const park = [];
  const kept = [];
  const foreign = [];
  const beyond = [...files.values()].filter((entry) => entry.exists === true && entry.index > liveCount && entry.index > stockCount);
  for (const entry of beyond.sort((a, b) => a.index - b.index)) {
    const ours = Array.isArray(entry.ours) ? entry.ours : null;
    if (!ours || !ours.length || entry.foreign === true) {
      foreign.push(entry.index);
      continue;
    }
    (ours.some((name) => owned.has(lower(name))) ? park : ours.some((name) => parkedNames.has(lower(name))) ? kept : remove).push(entry.index);
  }

  const danger = missingFiles.length > 0 || orphans.length > 0;
  const garbage = remove.length > 0 || park.length > 0;
  return {
    readable: true,
    status: danger ? "danger" : garbage ? "garbage" : "ok",
    danger: { missingFiles, orphans },
    garbage: { remove, park, kept },
    foreign,
    stockMissing,
    unregistered,
  };
}
