/*
 * Дозапись в update.rpf для модов каталога (19.11.2026, «диск в сотку при установке мода каталога»).
 *
 * Прежний путь ставит мод в `update.rpf` так: движок собирает архив 1,9 ГиБ в `_rpf-composites` (запись раз), потом он
 * копируется в папку игры (запись два). Мод на 12 МБ пишет около 4 ГБ. Здесь вместо этого движок дописывает тела мода в конец
 * живого файла и переписывает оглавление (`compose-rpf` с `install.write: "append"`, `INSTALL-RUST-STAGE2-APPEND.md`): пишутся
 * мегабайты. Состояние установки остаётся тем же (записи и слои мода в `archives[…].entries`) — по нему архив всегда можно
 * собрать заново прежним путём; меняется только то, КАК живой файл приводится к нужному состоянию.
 *
 * Выключатель: `ASTRAL_ENGINE_CATALOG_APPEND=catalog` (слово модуля, как у `ASTRAL_ENGINE_EXPRESS_DLC`), по умолчанию выключен.
 * Пока выключатель пуст, `appendInstall` не передаётся и ни одна строка здесь не выполняется: байты и ответы прежние.
 *
 * Когда дозапись берёт установку (`planCatalogAppend`) — всё условия вместе, иначе прежний путь:
 *   - единственный изменяемый архив — `update/update.rpf`, основа без «унаследованных» записей и перекрытий;
 *   - живой файл — ровно то, что состояние помнит (отпечаток сошёлся): иначе пересборка его чинит;
 *   - цепочка не исчерпала пороги уплотнения (`compactionReason`: записей 64, мусор 256 МБ или 1/8 архива, длина файла 2,3 ГБ);
 *   - у живого файла одна ссылка: якорь кладовой снимается (`appendInstall.releaseAnchor`), чужая ссылка — отказ;
 *   - движок согласен (`appendInstall.accepts`: найден, вложенные архивы есть в основе).
 *
 * Что с записями (вторая сдача, 19.11.2026): изменившиеся и новые пишутся из слоёв; записи, что возвращаются к штатным (мод ушёл не с вершины
 * цепочки, замена мода другим или его новой версией), получают штатное тело из основы (`stock`: приложение извлекает его
 * `extract-archive-entries` и кладёт в ту же запись; чего в основе нет — удаление). Старое оглавление дозапись по-прежнему не помнит, поэтому тело
 * не «возвращается», а пишется заново — мегабайты, а не два гигабайта.
 *
 * Снятие мода откатом: если нужное состояние равно составу ДО одной из записей стопки (и записи от неё до вершины идут подряд), все они снимаются
 * откатом точки самой нижней (`restore-rpf-point`: прежние байты головы и усечение, файл байт в байт как был), байты не пишутся. Иначе — дозапись
 * со штатными телами, а если она не берёт — прежний путь.
 *
 * Отпечаток дозаписанного файла — цепочка `a1:` от движка (SHA-256 всего файла после каждой записи не считается: это чтение
 * двух гигабайт). Он стоит там, где раньше стоял SHA-256: в слое ресурса и в `lastBuilt.sha256`, и помнится вместе с записью
 * файла (`file-fingerprint.js`), поэтому проверка файлов и перебазирование основы сверяют его равенством строк.
 *
 * Любая ошибка дозаписи — не отказ установки: запись откатывается, архив собирается и ставится прежним путём
 * (`AppendFallbackError`, `transactions.js`). Отмена откатывает запись и остаётся отменой.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fingerprintSha256, flushFingerprintStore, rememberSha256 } from "./file-fingerprint.js";
import { newEngineSwapNames } from "./engine-swap.js";
import { recipeFolder } from "./ops-build.js";
import { activeBaseline } from "./storage-state.js";

export const CATALOG_APPEND_ENV = "ASTRAL_ENGINE_CATALOG_APPEND";
export const CATALOG_APPEND_MODULE = "catalog";
export const UPDATE_RPF = "update/update.rpf";
/** Файлы движка рядом с дозаписанным архивом: полный путь убирает их вместе с прежним файлом. */
export const APPEND_SIDECARS = Object.freeze([".astral-journal", ".astral-layers"]);

const A1 = /^a1:[a-f0-9]{64}$/;
const HEX = /^[a-f0-9]{64}$/;

const MIB = 1048576;

/**
 * Когда цепочку пора пересобрать начисто (вторая сдача, 19.11.2026). Первые три числа — пороги движка (`rage-rpf`: `ASTRAL_ENGINE_APPEND_MAX_RECORDS`,
 * `…_DEAD_MB`, `…_DEAD_SHARE`); движок отказывает `CompactionDue` сам, но уже после вызова. Здесь те же числа сверяются по ответу
 * последней записи, поэтому следующая установка идёт на полный путь сразу и пишет в журнал, почему. `fileBytes` — длина файла, после
 * которой новые тела встали бы у потолка старта тел движка (2,5 ГБ; у настоящего `update.rpf` 2,0 ГБ): запас под несколько модов остаётся.
 */
export const COMPACTION_LIMITS = Object.freeze({ records: 256, deadBytes: 256 * MIB, deadShare: 8, fileBytes: 2_300_000_000 });

/** Предел штатных тел по умолчанию: чтение + запись тел вдвое меньше пересборки архива (два гигабайта плюс копия). */
export const STOCK_LIMIT_BYTES = 768 * MIB;

/* Причины, по которым движок просит уплотнить цепочку: пишем в журнал словами уплотнения, а не «не вышла». */
const COMPACTION_CODES = new Set(["CompactionDue", "BodyStartTooHigh"]);

/**
 * Пустая строка — цепочку можно дописывать; иначе — причина уплотнения. `stats` — числа последней записи (`journalRecords`, `garbageBytes`, `deadBytes`,
 * `bytes` из ответа движка, `lastBuilt.append.stats`); чего нет или не число — не повод. Мёртвые байты — `garbageBytes` (без запаса вложенных архивов и
 * спящих слоёв, как считает порог движка); у движка, который его не называет, — `deadBytes`: на настоящем `update.rpf` запас вложенных даёт больше сотни МБ,
 * и счёт по `deadBytes` уплотнял бы цепочку впятеро раньше срока (замер 19.11: пять записей, `deadBytes` 159 МБ при пороге 256).
 */
export function compactionReason(stats, limits = COMPACTION_LIMITS) {
  const number = (value) => (Number.isFinite(value) ? Number(value) : null);
  const records = number(stats?.journalRecords);
  const dead = number(stats?.garbageBytes) ?? number(stats?.deadBytes);
  const bytes = number(stats?.bytes);
  if (records !== null && records >= limits.records) return `записей: ${records} из ${limits.records}`;
  if (dead !== null && dead > limits.deadBytes) return `мёртвых байт: ${Math.round(dead / MIB)} МБ при пороге ${Math.round(limits.deadBytes / MIB)} МБ`;
  if (dead !== null && bytes !== null && bytes > 0 && dead * limits.deadShare > bytes) return `мёртвых байт больше 1/${limits.deadShare} архива (${Math.round(dead / MIB)} из ${Math.round(bytes / MIB)} МБ)`;
  if (bytes !== null && bytes >= limits.fileBytes) return `длина файла ${Math.round(bytes / MIB)} МБ: до потолка тел движка рукой подать`;
  return "";
}

/** Включена ли дозапись каталога: слово `catalog` в списке выключателя. */
export function catalogAppendEnabled(env = process.env) {
  for (const item of String(env?.[CATALOG_APPEND_ENV] || "").split(",")) if (item.trim().toLowerCase() === CATALOG_APPEND_MODULE) return true;
  return false;
}

/** Слово выключателя «контейнер слоя дозаписью» (20.11.2026): рядом со словом `catalog`, одно оно ничего не включает. */
export const CONTAINER_APPEND_MODULE = "container";

/** Берёт ли дозапись и запросы, что создают вложенный контейнер слоя (`x64/astral/<имя>.rpf`): слова `catalog` и `container` вместе. По умолчанию выключено. */
export function containerAppendEnabled(env = process.env) {
  if (!catalogAppendEnabled(env)) return false;
  for (const item of String(env?.[CATALOG_APPEND_ENV] || "").split(",")) if (item.trim().toLowerCase() === CONTAINER_APPEND_MODULE) return true;
  return false;
}

/**
 * Ошибка дозаписи, после которой установка идёт прежним путём (запись уже откатана). `cause` — что сказал движок. Отмена
 * и отказы не по вине дозаписи сюда не попадают.
 */
export class AppendFallbackError extends Error {
  constructor(cause) {
    super(`Дозапись в update.rpf не вышла: ${cause?.message || cause}`);
    this.name = "AppendFallbackError";
    this.code = "APPEND_FALLBACK";
    this.cause = cause;
  }
}

const isAbort = (error, signal) => signal?.aborted === true || error?.name === "AbortError" || error?.code === "CANCELLED";

// ---------------------------------------------------------------------------------------------------------------------
// Состав слоёв: что должно стоять в архиве
// ---------------------------------------------------------------------------------------------------------------------

const layerMark = (layer) => [
  layer?.modId ?? "",
  layer?.version ?? "",
  layer?.action ?? "",
  layer?.sha256 ?? "",
  layer?.cachePath ?? "",
  layer?.merge?.strategy ?? "",
  layer?.allowDelete === true,
  layer?.allowMissing === true,
];

/** Запись архива → отметка всех её слоёв. Запись без слоёв в состав не входит. Порядок слоёв важен. */
export function entrySignatures(target, archiveTarget) {
  const found = new Map();
  for (const [entry, state] of Object.entries(target?.archives?.[archiveTarget]?.entries || {})) {
    const layers = Array.isArray(state?.layers) ? state.layers : [];
    if (layers.length) found.set(entry, createHash("sha1").update(JSON.stringify(layers.map(layerMark))).digest("hex"));
  }
  return found;
}

/**
 * Сколько записей архива несут слой МОДА. Служебные слои (хозяин вида `@astral-layer`, `@astral-direct-dlc-registry`, `@rpf-composite`…) — не моды: они
 * остаются в архиве и без модов (метка слоя Astral, регистрация).
 */
export function modLayerEntries(target, archiveTarget) {
  let count = 0;
  for (const state of Object.values(target?.archives?.[archiveTarget]?.entries || {})) {
    const layers = Array.isArray(state?.layers) ? state.layers : [];
    if (layers.some((layer) => !String(layer?.modId ?? "").startsWith("@"))) count += 1;
  }
  return count;
}

/** Один отпечаток всего состава: равные составы дают равные строки. */
export function compositionDigest(signatures) {
  const hash = createHash("sha1");
  for (const entry of [...signatures.keys()].sort()) hash.update(`${entry}\u0000${signatures.get(entry)}\u0001`);
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------------------------------------------------
// Решение: дозапись, откат записи или прежний путь
// ---------------------------------------------------------------------------------------------------------------------

const declined = (reason) => ({ declined: reason });

/* Отпечаток, который состояние ждёт от живого файла: верхний слой сборки, а без слоёв — активная основа (как у проверки файлов). */
function expectedLive(target, archiveTarget) {
  const resource = target?.resources?.[archiveTarget];
  if (!resource) return "";
  const top = resource.layers?.at(-1);
  if (top?.sha256) return String(top.sha256);
  return String(activeBaseline(target, resource)?.sha256 || "");
}

const baseMark = (resource) => {
  const base = resource?.compositionBase || resource?.base;
  return JSON.stringify([base?.path ?? "", base?.sha256 ?? "", base?.carried ?? null, base?.overlays ?? null, base?.workOver ?? null]);
};

/* Сколько байт потянет возврат штатных тел: размер файлов слоёв, что уходят (оценка до извлечения); неизвестный размер — 0. */
async function estimateStockBytes(currentTarget, archiveTarget, entries) {
  let total = 0;
  for (const entry of entries) {
    const layers = currentTarget?.archives?.[archiveTarget]?.entries?.[entry]?.layers;
    const cachePath = Array.isArray(layers) ? layers.at(-1)?.cachePath : null;
    if (typeof cachePath !== "string" || !cachePath) continue;
    const stat = await fs.stat(cachePath).catch(() => null);
    if (stat?.isFile()) total += stat.size;
  }
  return total;
}

/*
 * Вторая ссылка на живой файл (якорь кладовой, снимок, «до» точки): запись «на месте» тронула бы и ту копию — движок отказал бы `Linked`.
 * Якорь кладовой приложение умеет снять (`releaseAnchor`: нужные копиям куски ложатся в кладовую, ссылка уходит); чужую ссылку не трогает никто.
 * Пустая строка — ссылка одна, писать можно; иначе причина отказа.
 */
async function singleLinkProblem(appendInstall, livePath, signal) {
  const stat = await fs.stat(livePath).catch(() => null);
  if (!stat?.isFile()) return "живого архива нет";
  if (stat.nlink <= 1) return "";
  let freed = false;
  try {
    freed = typeof appendInstall.releaseAnchor === "function" ? (await appendInstall.releaseAnchor({ livePath, signal })) === true : false;
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    freed = false;
  }
  if (freed) {
    const again = await fs.stat(livePath).catch(() => null);
    if (again?.isFile() && again.nlink <= 1) return "";
  }
  return "у живого архива есть вторая ссылка";
}

/**
 * Откат по цепочке: если нужный состав равен составу до одной из записей стопки, а записи от неё до вершины идут подряд (каждая
 * начинается там, где кончилась прежняя), все они снимаются откатом точки самой нижней из них — движок снимает записи над точкой вместе
 * с ней, байт в байт. Из подходящих берётся самая нижняя: цепочка короче, мёртвых байт меньше. `null` — такой записи нет.
 */
function rollbackTarget(chain, liveFingerprint, digestBefore, digestAfter) {
  const stack = Array.isArray(chain?.stack) ? chain.stack : [];
  const top = stack.at(-1);
  if (!top || top.stateAfter !== liveFingerprint || top.digestAfter !== digestBefore) return null;
  let low = stack.length - 1;
  while (low > 0 && stack[low - 1].digestAfter === stack[low].digestBefore && stack[low - 1].stateAfter === stack[low].stateBefore) low -= 1;
  for (let at = low; at < stack.length; at += 1) {
    if (stack[at].digestBefore !== digestAfter) continue;
    if (!stack.slice(at).every((record) => typeof record.pointId === "string" && record.pointId)) continue;
    return at;
  }
  return null;
}

/**
 * Что делать с `update.rpf` этой установки. Ответ: `{ kind: "append", … }`, `{ kind: "rollback", … }` или `{ declined: причина }`
 * (идёт прежний путь); `null` — дозаписи у вызывающего нет вовсе.
 *
 * `item` — `{ relativePath, livePath, sourcePath }`; `build` — отложенная сборка (`registerDeferredBuild`) или `null`;
 * `current`/`next` — состояние до и после (`next` — с уже собранными слоями ресурса); `affectedCount` — сколько архивов
 * в этой транзакции (дозапись берёт только единственный).
 *
 * Три исхода (вторая сдача, 19.11.2026):
 *   1. нужный состав равен составу до одной из записей стопки — они снимаются откатом (без записи байт);
 *   2. иначе записи, чей слой изменился или лёг, дописываются из слоёв; записи, которые возвращаются к штатным (мод ушёл, замена мода другим),
 *      получают штатное тело из основы (`stock`: тела из основы, а чего в основе нет — удаление) — приложение извлекает их и пишет в той же записи;
 *   3. иначе (цепочка исчерпала пороги, тела дороже пересборки, движок не берёт) — прежний путь.
 */
export async function planCatalogAppend({ appendInstall, item, build = null, current, next, targetKey, affectedCount = 1, signal = null }) {
  if (!appendInstall || typeof appendInstall.append !== "function") return null;
  if (typeof appendInstall.enabled === "function" && appendInstall.enabled() !== true) return null;
  const archiveTarget = String(item?.relativePath || "");
  if (archiveTarget.toLowerCase() !== UPDATE_RPF) return null;
  if (affectedCount !== 1) return declined("в транзакции не один архив");
  const nextTarget = next?.targets?.[targetKey];
  const currentTarget = current?.targets?.[targetKey];
  const resource = nextTarget?.resources?.[archiveTarget];
  if (!resource || !nextTarget?.archives?.[archiveTarget]) return declined("нет записи об архиве");
  const base = resource.compositionBase || resource.base;
  if ((base?.carried?.length || 0) > 0 || (base?.overlays?.length || 0) > 0 || base?.workOver) return declined("основа несёт записи движка");

  const currentArchive = currentTarget?.archives?.[archiveTarget];
  const currentResource = currentTarget?.resources?.[archiveTarget];
  if (currentResource && baseMark(currentResource) !== baseMark(resource)) return declined("основа архива сменилась");
  const chain = currentArchive?.lastBuilt?.append || null;
  const wanted = currentResource ? expectedLive(currentTarget, archiveTarget) : String(base?.sha256 || "");
  if (!wanted) return declined("у состояния нет отпечатка живого файла");
  const liveFingerprint = await fingerprintSha256(item.livePath).catch(() => "");
  if (liveFingerprint !== wanted) return declined("живой архив не тот, что в состоянии");
  const exists = await fs.stat(item.livePath).catch(() => null);
  if (!exists?.isFile()) return declined("живого архива нет");

  const currentSignatures = entrySignatures(currentTarget, archiveTarget);
  const nextSignatures = entrySignatures(next?.targets?.[targetKey], archiveTarget);
  const digestBefore = compositionDigest(currentSignatures);
  const digestAfter = compositionDigest(nextSignatures);

  /* Снятие: нужное состояние — то, что было до одной из записей цепочки, и файл ровно тот, что стопка оставила. */
  const at = rollbackTarget(chain, liveFingerprint, digestBefore, digestAfter);
  if (at !== null) {
    const stack = chain.stack;
    const linkProblem = await singleLinkProblem(appendInstall, item.livePath, signal);
    if (linkProblem) return declined(linkProblem);
    return {
      kind: "rollback",
      archiveTarget,
      pointId: stack[at].pointId,
      /* Точки записей выше — сверху вниз: движок снимает их записи вместе с нижней, а папки точек убирает приложение. */
      newerPoints: stack.slice(at + 1).map((record) => record.pointId).reverse(),
      stateBefore: String(stack[at].stateBefore),
      chain,
      stack: stack.slice(0, at),
      digestBefore,
      digestAfter,
      build,
    };
  }

  /* Снятие последнего мода без отката (П10, ночь 21.11.2026): штатные тела, дописанные в конец, оставили бы прежние тела мёртвым местом, а дыры самой сборки
     (мод стоял собранным архивом) не вернулись бы никогда: после «сборка редукса целиком → снять» файл на 230 754 304 Б длиннее исходного при той же описи.
     Без модов архив собирается начисто из основы — файл возвращается к виду до установки, цепочка не начинается. */
  if (modLayerEntries(currentTarget, archiveTarget) > 0 && modLayerEntries(nextTarget, archiveTarget) === 0)
    return declined("в архиве не остаётся модов: он собирается начисто из основы, файл возвращается к виду до установки, мёртвого места не остаётся");
  if (!build) return declined("архив уже собран: копировать не меньше, чем дописывать");
  if (!Array.isArray(build.operations)) return declined("нет списка операций");
  /* Цепочка исчерпала пороги: дописывать дальше — получить отказ движка; пересборка начисто даёт архив без мёртвых байт и цепочку заново. */
  const due = compactionReason(chain?.stats);
  if (due) return declined(`уплотнение цепочки (${due}): архив пересобирается начисто`);
  const operationOf = new Map(build.operations.map((operation) => [operation.entry, operation]));
  const changed = [];
  for (const [entry, signature] of nextSignatures) if (currentSignatures.get(entry) !== signature) changed.push(entry);
  const returning = [];
  for (const entry of currentSignatures.keys()) if (!nextSignatures.has(entry)) returning.push(entry);
  returning.sort();
  if (returning.length && appendInstall.restoresStock !== true) return declined("запись возвращается к штатной");
  if (returning.length && typeof build.baseArchive !== "string") return declined("штатные тела брать неоткуда: основа не названа");
  if (!changed.length && !returning.length) return declined("состав не изменился");
  const operations = [];
  for (const entry of changed.sort()) {
    const operation = operationOf.get(entry);
    if (!operation) return declined(`нет операции для записи ${entry}`);
    const { modId: _modId, ...rest } = operation;
    operations.push(rest);
  }
  if (returning.length) {
    const limit = Number.isFinite(appendInstall.stockLimitBytes) ? appendInstall.stockLimitBytes : STOCK_LIMIT_BYTES;
    const estimate = await estimateStockBytes(currentTarget, archiveTarget, returning);
    if (estimate > limit) return declined(`штатные тела дороже пересборки (около ${Math.round(estimate / MIB)} МБ при пределе ${Math.round(limit / MIB)} МБ)`);
  }
  const request = {
    archiveTarget,
    baseArchive: build.baseArchive,
    /* Движку для «кто пишет» нужны и записи, которые вернутся к штатным: их вложенные архивы должны быть в основе. */
    operations: [...operations, ...returning.map((entry) => ({ entry, action: "replace" }))],
  };
  let accepted = false;
  try {
    accepted = (await appendInstall.accepts?.(request, { signal })) === true;
  } catch {
    accepted = false;
  }
  if (!accepted) return declined("движок дозапись не берёт");
  const linkProblem = await singleLinkProblem(appendInstall, item.livePath, signal);
  if (linkProblem) return declined(linkProblem);
  return {
    kind: "append",
    archiveTarget,
    operations,
    /* Штатные тела: приложение извлекает их из основы и добавляет к операциям той же записи. `null` — возвращать нечего. */
    stock: returning.length ? { baseArchive: build.baseArchive, entries: returning } : null,
    allowDeletes: operations.some((operation) => operation.action === "delete"),
    chain,
    liveFingerprint,
    /* Первая запись цепочки несёт SHA-256 живого файла: движок его не читает; дальше цепочку ведёт его журнал. */
    baseSha256: !chain && HEX.test(liveFingerprint) ? liveFingerprint : undefined,
    pointId: newEngineSwapNames().pointId,
    recipeFile: path.join(recipeFolder(build.paths, targetKey), "append.json"),
    digestBefore,
    digestAfter,
    build,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Запись журнала транзакции
// ---------------------------------------------------------------------------------------------------------------------

let recoverer = null;

/**
 * Хук доводки для оборванных транзакций (`recoverTransactions`): приложение регистрирует функцию, которая откатывает запись дозаписи
 * по точке. Без неё запись остаётся в архиве: проверка файлов назовёт его изменённым, а «Починить» соберёт заново.
 */
export function registerAppendRecovery(fn = null) {
  if (fn !== null && typeof fn !== "function") throw new TypeError("Хук доводки дозаписи должен быть функцией.");
  recoverer = fn;
}

/** Убрать запись дозаписи, о которой знает только журнал транзакции (`item.append`). Возвращает `true`, если откат состоялся. */
export async function undoAppendJournalItem(info, { log = null } = {}) {
  if (!info || info.kind !== "append" || !info.pointId) return false;
  if (!recoverer) {
    log?.(`Дозапись ${info.pointId}: хука доводки нет, запись остаётся в архиве (проверка файлов назовёт его изменённым).`);
    return false;
  }
  try {
    const answer = await recoverer(info);
    /* Запись снята: файл снова тот, что был до неё, а отпечаток `a1:` чтением файла не восстановить — он записан в журнале транзакции
       (`stateBefore`). Без этого проверка файлов назвала бы свой архив изменённым, и «Починить» пересобрала бы его целиком (стенд обрывов
       19.11.2026). Точки не нашлось (`null`: движок записи не делал или снял её сам) — отпечаток не трогаем, проверка решит чтением. */
    if (answer && info.livePath && typeof info.stateBefore === "string" && info.stateBefore) {
      await rememberSha256(info.livePath, info.stateBefore).catch(() => {});
      await flushFingerprintStore().catch(() => {});
    }
    return true;
  } catch (error) {
    log?.(`Дозапись ${info.pointId}: откат не вышел (${error?.message || error}).`);
    return false;
  }
}

/**
 * Довести откат записи, о котором знает журнал транзакции (`item.append` вида `rollback`): процесс умер после отката движком и до записи
 * состояния (стенд обрывов 20.11.2026: файл уже без мода, состояние «мод стоит», проверка файлов — «изменён», «Починить» пересобирала
 * архив с модом). Откат повторяется хуком: он идемпотентен — точки уже нет, значит, он состоялся. Возвращает `true`, если файл теперь в
 * состоянии «после отката»; `false` — хука нет или откат отказан (чужой файл): состояние не трогается, решит проверка файлов.
 */
export async function redoRollbackJournalItem(info, { log = null } = {}) {
  if (!info || info.kind !== "rollback" || !info.pointId || !recoverer) return false;
  try {
    await recoverer(info);
  } catch (error) {
    log?.(`Откат дозаписи ${info.pointId} не довёлся (${error?.message || error}).`);
    return false;
  }
  if (info.livePath && typeof info.stateAfter === "string" && info.stateAfter) {
    await rememberSha256(info.livePath, info.stateAfter).catch(() => {});
    await flushFingerprintStore().catch(() => {});
  }
  return true;
}

/** Стоит ли у архива цепочка дозаписи (журнал движка рядом): живой якорь кладовой на такой файл не ставится — вторая ссылка запретила бы дозапись. */
export async function appendChainStands(livePath) {
  return fs.access(`${livePath}${APPEND_SIDECARS[0]}`).then(() => true, () => false);
}

/** Убрать файлы движка рядом с архивом, который заменил полный путь: их цепочка чужая новому файлу. */
export async function removeAppendSidecars(livePath) {
  const removed = [];
  for (const suffix of APPEND_SIDECARS) {
    const file = `${livePath}${suffix}`;
    if (await fs.rm(file, { force: true }).then(() => true, () => false)) removed.push(file);
  }
  return removed;
}

const sayOf = (appendInstall) => (message) => {
  try {
    appendInstall?.note?.(message);
  } catch {
    /* журнал не должен ронять установку */
  }
};

/**
 * Запись журнала транзакции для плана `planCatalogAppend`.
 *
 * `run` исполняет план (дозапись или откат записи), проверяет ответ и при любой ошибке откатывает запись; отказ — `AppendFallbackError`
 * (установка идёт прежним путём), отмена — как есть. `onDone` вписывает итог в состояние `next`. `toClassic` возвращает обычную запись
 * журнала: нужный архив собирается прежним способом.
 */
export function appendJournalItem({ plan, item, appendInstall, next, targetKey, gameRoot, signal = null, verifyBuilt = null, onProgress = null }) {
  const say = sayOf(appendInstall);
  const archiveTarget = plan.archiveTarget;
  const livePath = item.livePath;
  let undone = false;

  async function rollbackQuietly(reason) {
    if (undone) return;
    undone = true;
    try {
      await appendInstall.rollback({ gameRoot, archiveTarget, livePath, pointId: plan.pointId, lenient: true });
    } catch (error) {
      say(`Дозапись ${plan.pointId}: запись не удалось откатить (${error?.message || error}); ${reason}`);
      return;
    }
    /* Байты те же, что были; отпечаток прежнего файла — тот, что сверили при решении. */
    await rememberSha256(livePath, plan.liveFingerprint).catch(() => {});
  }

  async function run() {
    if (plan.kind === "rollback") {
      try {
        await appendInstall.rollback({ gameRoot, archiveTarget, livePath, pointId: plan.pointId, ...(plan.newerPoints?.length ? { alsoPoints: plan.newerPoints } : {}) });
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        say(`Откат дозаписи ${plan.pointId} не вышел (${error?.code || ""} ${error?.message || error}); архив собирается прежним путём.`);
        throw new AppendFallbackError(error);
      }
      if (plan.newerPoints?.length) say(`Снятие мода откатом ${plan.newerPoints.length + 1} записей цепочки: байты не пишутся.`);
      return { status: "rolled-back", fingerprint: plan.stateBefore };
    }
    let outcome;
    try {
      outcome = await appendInstall.append({
        gameRoot,
        archiveTarget,
        livePath,
        operations: plan.operations,
        ...(plan.stock ? { stock: plan.stock } : {}),
        allowDeletes: plan.allowDeletes,
        pointId: plan.pointId,
        baseSha256: plan.baseSha256,
        recipeFile: plan.recipeFile,
        signal,
        onProgress,
      });
      if (outcome?.status !== "ready" || typeof outcome.fingerprint !== "string" || !A1.test(outcome.fingerprint))
        throw Object.assign(new Error("Движок не назвал отпечаток дозаписи."), { code: "BAD_ANSWER" });
      await verifyBuilt?.();
    } catch (error) {
      await rollbackQuietly("архив остаётся прежним");
      if (isAbort(error, signal)) throw error;
      if (COMPACTION_CODES.has(error?.code))
        say(`Уплотнение: цепочка дозаписи исчерпала пороги движка (${error?.code} ${error?.message || error}); архив пересобирается начисто, цепочка начнётся заново.`);
      else say(`Дозапись в update.rpf не вышла (${error?.code || ""} ${error?.message || error}); ставлю прежним путём.`);
      throw new AppendFallbackError(error);
    }
    return outcome;
  }

  /* Что откат записи меняет в состоянии `state`. От ответа движка это не зависит — поэтому то же правило дописывает состояние, когда
     процесс умер после отката и до записи состояния (`forwardState`, доводка «вперёд» в `transaction.js`). */
  function applyRollbackState(state) {
    const stateTarget = state.targets[targetKey];
    const archive = stateTarget.archives[archiveTarget];
    const resource = stateTarget.resources[archiveTarget];
    const layer = Array.isArray(resource?.layers) ? resource.layers.at(-1) : null;
    const fingerprint = plan.stateBefore;
    if (layer) layer.sha256 = fingerprint;
    if (archive.lastBuilt && layer) {
      archive.lastBuilt.sha256 = fingerprint;
      delete archive.lastBuilt.deferred;
      /* Числа движка (`stats`) относились к вершине цепочки: после снятия они устарели, следующая запись принесёт свежие. */
      if (plan.stack.length) {
        const { stats: _stale, ...kept } = plan.chain;
        archive.lastBuilt.append = { ...kept, state: fingerprint, stack: plan.stack };
      } else delete archive.lastBuilt.append;
    } else delete archive.lastBuilt;
  }

  async function onDone(outcome) {
    if (plan.kind === "rollback") {
      applyRollbackState(next);
      await rememberSha256(livePath, plan.stateBefore).catch(() => {});
      await flushFingerprintStore().catch(() => {});
      return;
    }
    const nextTarget = next.targets[targetKey];
    const archive = nextTarget.archives[archiveTarget];
    const resource = nextTarget.resources[archiveTarget];
    const layer = Array.isArray(resource?.layers) ? resource.layers.at(-1) : null;
    const built = archive.lastBuilt;
    const fingerprint = String(outcome.fingerprint);
    if (layer) layer.sha256 = fingerprint;
    built.sha256 = fingerprint;
    delete built.deferred;
    const chain = plan.chain;
    /* Числа ответа движка, по которым решается уплотнение (`compactionReason`): записей в стопке, мёртвых байт, длина файла. */
    const stats = {};
    for (const key of ["journalRecords", "garbageBytes", "deadBytes", "bytes"]) if (Number.isFinite(outcome[key])) stats[key] = Number(outcome[key]);
    built.append = {
      module: CATALOG_APPEND_MODULE,
      state: fingerprint,
      recipe: plan.recipeFile,
      chainBase: chain?.chainBase || String(outcome.fingerprintBefore || plan.liveFingerprint || ""),
      ...(Object.keys(stats).length ? { stats } : {}),
      stack: [
        ...(chain?.stack || []),
        {
          record: outcome.record ?? null,
          pointId: plan.pointId,
          stateBefore: plan.liveFingerprint,
          stateAfter: fingerprint,
          digestBefore: plan.digestBefore,
          digestAfter: plan.digestAfter,
          bytesWritten: Number.isFinite(outcome.bytesWritten) ? outcome.bytesWritten : null,
          ...(plan.stock ? { stock: plan.stock.entries.length } : {}),
        },
      ],
    };
    await rememberSha256(livePath, fingerprint).catch(() => {});
    /* Отпечаток — на диск сразу: упал процесс до записи хранилища — следующий запуск читал бы два гигабайта и назвал бы свой архив изменённым. */
    await flushFingerprintStore().catch(() => {});
  }

  async function undo() {
    if (plan.kind === "append") await rollbackQuietly("запись остаётся в архиве");
  }

  async function toClassic() {
    if (plan.build) await plan.build.materialize();
    return { relativePath: item.relativePath, livePath, sourcePath: item.sourcePath };
  }

  return {
    relativePath: item.relativePath,
    livePath,
    /* `stateBefore` — отпечаток файла до записи: идёт в журнал транзакции, по нему доводка после обрыва возвращает отпечаток вместе с байтами.
       У отката записи в журнал идут отпечаток файла «после отката» (`stateAfter`) и точки записей выше; `forwardState` — состояние, каким оно
       станет после отката (копия `next` с правкой отката): транзакция кладёт его рядом с журналом до вызова движка. */
    appendBuild: {
      kind: plan.kind,
      pointId: plan.pointId,
      gameRoot,
      archive: archiveTarget,
      ...(plan.kind === "append" && plan.liveFingerprint ? { stateBefore: String(plan.liveFingerprint) } : {}),
      ...(plan.kind === "rollback"
        ? {
            ...(plan.stateBefore ? { stateAfter: String(plan.stateBefore) } : {}),
            ...(plan.newerPoints?.length ? { alsoPoints: [...plan.newerPoints] } : {}),
            forwardState: () => {
              const copy = JSON.parse(JSON.stringify(next));
              applyRollbackState(copy);
              return copy;
            },
          }
        : {}),
      run,
      onDone,
      undo,
      toClassic,
    },
  };
}
