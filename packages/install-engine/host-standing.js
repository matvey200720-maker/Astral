import { canonicalArchiveEntry } from "./astral-paths.js";

const UPDATE_TARGET = "update/update.rpf";

/*
 * «Новое заменяет старое» при режиме RP (22.11.2026, слово владельца: «заменить. Всё что новое заменяет старое»; разбор — `docs/TEAM-ZONES.md`, строки 22.11 лида 4 и слабого ПК).
 *
 * Пакет, который при режиме уходит в контейнер `x64/astral/astral_rp_*.rpf` внутри `update.rpf`, не ложится слоем поверх прежней работы в хосте (`astral_weapons`, `astral_clothing`):
 * хост и контейнер — разные файлы, и прежняя осталась бы второй копией. Прежним путём каталожная работа на тех же записях ложилась слоем в один файл поверх работы мастерской (`stack`,
 * `plan-install.js`), поэтому окно такой конфликт в `replaceModIds` не называет (`catalogConflicts.js`), и замену должен сделать движок. Два случая:
 *  (I) НОВОЕ ЦЕЛИКОМ ПЕРЕКРЫВАЕТ СТАРОЕ: каждая запись стоящей работы (в любом архиве, не только в хосте) есть среди записей нового пакета до перевода в контейнер — прежняя работа снимается той же
 *      установкой (`supersedeInstalled`), а снятая проверкой файлов («снятые») не возвращается: `parked` чистится от неё;
 *  (II) ПЕРЕКРЫВАЕТ ЧАСТИЧНО (скин мастерской на модели ганпака каталога из многих моделей: общая запись одна, ганпак скину нужен): прежнюю работу НЕ снимаем, поведение прежнее (новая в контейнер, старая
 *      в хосте); пакеты записываются в отчёт `hostStanding`, и приложение отдаёт его окну полем итога установки.
 * Идея «отчёт по памяти, который приложение забирает по id пакета» — из ветки слабого ПК `weakpc/rp-host-standing-word` (`host-standing.js`, `takeHostStandingReport`), ветка отозвана, код переписан.
 */

const MAX_REMEMBERED = 200;
const reports = new Map();

const keyOf = (target, entry) => `${String(target ?? "").toLowerCase()}|${canonicalArchiveEntry(entry)}`;

const looseKey = (path) => `loose:${String(path ?? "").toLowerCase().replaceAll("\\", "/")}`;
const dlcKey = (name) => `dlc:${String(name ?? "").toLowerCase()}`;

/** Все записи работы или пакета в форме ключей: записи архивов (любых, включая `update.rpf`) `цель|запись`, файлы без записи (loose) `loose:путь`. */
function allKeys(items) {
  const keys = new Set();
  for (const item of items || []) if (item?.target) keys.add(item.entry ? keyOf(item.target, item.entry) : looseKey(item.target));
  return keys;
}

/**
 * Всё, что в состоянии числится за установленной работой, кроме записей архивов: файлы вне архивов (`record.resources` — цели слоёв), свой DLC (`dlcName`, регистрации в `dlcRegistrations` /
 * `directDlcRegistrations` с этим владельцем). Для «снятых» — те же поля записи и `resources` / `dlcs` самого элемента.
 */
function extraKeysOf(target, modId, record, parked = null) {
  const keys = new Set();
  /* Файлы вне архивов — только `resources` записи установки (слои целых файлов); `resources` элемента «снятых» — составные архивы, где лежали записи работы, это не её файлы. */
  for (const item of record?.resources || []) {
    const path = typeof item === "string" ? item : item?.relativePath ?? item?.target;
    if (path) keys.add(looseKey(path));
  }
  if (record?.dlcName) keys.add(dlcKey(record.dlcName));
  /* Регистрация DLC считается, только если её владелец — САМА работа. Служебные владельцы (`@astral-fast-weapon-host` и подобные: общий хост оружия и одежды, он нужен любой стоящей работе и новой тоже)
     в счёт не идут: это явное правило, а не догадка (в «снятых» хост оружия лежит снимком `dlcs` с этим владельцем). */
  const owned = (registration) => registration?.modId === modId || registration?.owner === modId;
  for (const [name, registration] of Object.entries(target?.dlcRegistrations || {})) if (owned(registration)) keys.add(dlcKey(name));
  for (const [name, registration] of Object.entries(target?.directDlcRegistrations || {})) if (owned(registration)) keys.add(dlcKey(name));
  for (const [name, registration] of Object.entries(parked?.dlcs || {})) if (owned(registration)) keys.add(dlcKey(name));
  return keys;
}

const isHostKey = (key) => !key.startsWith(`${UPDATE_TARGET}|`) && !key.startsWith("loose:") && !key.startsWith("dlc:");

/**
 * Что стоит на записях хоста нового пакета. `files` — записи пакета ДО перевода в контейнер (все цели); `target` — цель состояния, которую установка уже держит (второго чтения состояния нет);
 * `skip` — свои и уже называемые к замене работы. Правило буквальное: работа попадает в рассмотрение, если делит с новым пакетом хоть одну запись ХОСТА; она `covered` (снимается), только если у неё НЕТ ни
 * одной записи, в любом архиве, включая `update.rpf`, которой нет среди записей нового пакета, иначе `partial` (остаётся, признак в итоге). Считается всё, что в состоянии числится за работой: записи архивов (`archiveEntries`),
 * файлы вне архивов (`resources`), свой DLC (`dlcName` и регистрации, где владелец — сама работа). Служебное в счёт не идёт — явное правило: регистрации пакета (`content.xml`, `dlclist.xml`, `setup2.xml`) в
 * `archiveEntries` не попадают (проверено по состоянию после установки скина и ганпака), общий хост оружия и одежды (владелец `@astral-fast-weapon-host`, `@…`) нужен любой стоящей работе и новой тоже.
 * Ответ: `{ covered: [modId установленных], coveredParked: [modId «снятых»], partial: [modId] }`.
 */
export function hostWorksOver({ files, target, skip = new Set(), dlcName = "" }) {
  /* Перекрывают только КЛАДУЩИЕ записи нового пакета: удаление записи (`delete`, маски скина) старую работу не заменяет, а при переводе в контейнер такие удаления вообще выбрасываются. */
  const wanted = allKeys((files || []).filter((file) => file?.action !== "delete"));
  if (dlcName) wanted.add(dlcKey(dlcName));
  const out = { covered: [], coveredParked: [], partial: [] };
  if (![...wanted].some(isHostKey) || !target) return out;
  /** `true` — снимать, `false` — оставить частично, `null` — не пересекаются по хосту, говорить нечего. */
  const verdictOf = (modId, keys) => {
    if (!modId || skip.has(modId) || !keys.size) return null;
    if (![...keys].some((key) => isHostKey(key) && wanted.has(key))) return null;
    return [...keys].every((key) => wanted.has(key));
  };
  for (const record of target.installed || []) {
    const verdict = verdictOf(record?.modId, new Set([...allKeys(record?.archiveEntries), ...extraKeysOf(target, record?.modId, record)]));
    if (verdict === true) out.covered.push(record.modId);
    else if (verdict === false) out.partial.push(record.modId);
  }
  for (const item of Array.isArray(target.parked) ? target.parked : []) {
    const verdict = verdictOf(item?.modId, new Set([...allKeys((item?.entries || []).map((row) => ({ target: row?.archive, entry: row?.entry }))), ...extraKeysOf(target, item?.modId, item?.record, item)]));
    if (verdict === true) out.coveredParked.push(item.modId);
  }
  return out;
}

/**
 * Работы, которых правило не касается: ВСЕ пакеты этой же установки (запись первого пакета пачки уже лежит в `target.installed`, когда на очереди второй: пачка ставится целиком, пакеты друг друга не заменяют),
 * названные к замене и прежние скины того же места.
 */
export const hostSkipSet = ({ batchIds = [], replaceModIds = [], previous = [] } = {}) => new Set([...batchIds, ...replaceModIds, ...previous]);

/** Запоминает итог правила для пакета `modId`: названо к замене и что осталось под ним частично. */
export function rememberHostStanding(modId, { replaced = [], partial = [] } = {}) {
  if (!modId) return;
  /* Пустой итог стирает прежний отчёт того же id: упавшая установка и повтор без перекрытия не должны оставить слова о замене, которой не было. */
  if (!replaced.length && !partial.length) {
    reports.delete(String(modId));
    return;
  }
  if (reports.size >= MAX_REMEMBERED) reports.delete(reports.keys().next().value);
  reports.set(String(modId), { modId: String(modId), replaced: [...new Set(replaced)].sort(), partial: [...new Set(partial)].sort() });
}

/** Забирает отчёты по этим пакетам: `[{ modId, replaced, partial }]` или `null`, если правило ничего не сделало. Забранное из памяти уходит. */
export function takeHostStandingReport(modIds = []) {
  const taken = [];
  for (const id of modIds.filter(Boolean).map(String)) {
    const item = reports.get(id);
    if (!item) continue;
    reports.delete(id);
    taken.push(item);
  }
  return taken.length ? taken : null;
}
