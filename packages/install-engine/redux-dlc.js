// «Установка редукса в свой dlc»: данные редукса ложатся на диск один раз в `astral_redux_<id>/dlc.rpf`, а включение и выключение —
// смена оглавления `update.rpf` (`switch-rpf-layers`). Оркестровка команд движка по образцу `express-dlc.js`; проект —
// `docs/INSTALL-RUST-REDUX.md` (разделы 3.1–3.8), краткая записка — `docs/INSTALL-RUST-REDUX-R6.md`.
//
// Ход установки:
//   0. аргументы и маршрут: записи манифеста делятся на классы (`redux-routes.js`): D — контейнеры в dlc, U-switch — запись корня
//      малым слоем, U-linked — прежним путём (вызывающему возвращается список);
//   1. план: у каждого dlc длина и место на томе до первого байта (`layout-rpf-plan`, «на месте») или порядок тел (`follow`);
//   2. сборка dlc: движок пишет файл сразу на место, из готовых файлов или по журналу, пока файлы ещё качаются;
//   3. проверка: `verify-rpf-dlc` и строгий читатель приложения (крючок `verify`);
//   4. малый слой в `update.rpf`: `compose-rpf` с дозаписью слоя, сводные записи (`dlclist.xml`, тела с merge) — списком `registry`
//      (R2), созданные dlc — списком `creates` в точке отката (R1). Только теперь, когда все dlc целы и сверены;
//   5. состояние: крючок `commit`; не записалось — слой снят и dlc освобождены.
// Любой сбой или отмена на шаге 0–3 — готовые dlc убраны, `update.rpf` не открывался. Сбой шага 4 — журнал доводит запись
// (`settle-rpf-journals`): откатилась — dlc убраны, довелась — установка состоялась, неясно — dlc остаются (их называет dlclist).
//
// Включить и выключить — `switch-rpf-layers` (запись головы, килобайты); dlc не трогается. Снять и освободить место — слой убирается
// раньше, чем освобождается файл.
//
// Модуль чистый: движок приходит функцией `engine(command, request, { signal, args, onProgress })`, которая возвращает `result` ответа
// (и бросает ошибку с `code` на `ok: false`), как у `express-dlc.js`. Нигде не зовётся, пока его не включит вызывающий: выключатель
// `ASTRAL_ENGINE_REDUX_DLC=<модули>` (`reduxDlcEnabled`), по умолчанию выключен. Видимых пользователю строк нет: у ошибок только `code`
// и служебное сообщение.
import fs from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { rpfTailEnabled } from "./rpf-tail-switch.js";
import { EXPRESS_MAX_BYTES, describeFile, dlcPackPath } from "./express-dlc.js";
import {
  REDUX_ORDER_MAX,
  REDUX_ORDER_MIN,
  nextReduxOrder,
  reduxArchiveOf,
  reduxIdentity,
  stageReduxHost,
} from "./redux-dlc-host.js";
import { REDUX_CLASSES, estimateReduxArchiveBytes, routeReduxFiles, splitReduxPacks } from "./redux-routes.js";

export const REDUX_DLC_ENV = "ASTRAL_ENGINE_REDUX_DLC";
export const REDUX_MAX_BYTES = EXPRESS_MAX_BYTES;
/** Сколько тел одного dlc считается разумным по умолчанию: игра открыла 3,36 и 3,56 ГБ (замер 14.11), штатный потолок движка 3,3 ГБ. */
export const REDUX_PACK_BUDGET = 3_300_000_000;
const MIB = 1024 * 1024;
const UPDATE_ARCHIVE = "update/update.rpf";
const DLCLIST_ENTRY = "common/data/dlclist.xml";
const BUILD_VERIFY = new Set(["table", "sample", "full"]);
const CONFIRM = new Set(["intact", "stat", "none"]);
const VERIFY_MODES = new Set(["stat", "intact"]);
const LINKED_POLICY = new Set(["report", "refuse"]);
const SWITCH_MODES = new Set(["enable", "disable", "remove"]);
const SHA256 = /^[0-9a-f]{64}$/;

export function reduxDlcEnabled(moduleName, env = process.env) {
  const wanted = String(moduleName ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return String(env[REDUX_DLC_ENV] ?? "")
    .split(",")
    .some((item) => item.trim().toLowerCase() === wanted);
}

export class ReduxDlcError extends Error {
  constructor(code, message, { cause = null, phase = "", cleanup = null, retry = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReduxDlcError";
    this.code = code;
    this.phase = phase;
    this.cleanup = cleanup;
    /** `"full-path"` — отказ ключа длины: повторить полным путём или «Починить»; `null` — подсказки нет. */
    this.retry = retry;
  }
}

const argumentError = (message) => new ReduxDlcError("ARGUMENTS", `Redux dlc: ${message}`, { phase: "arguments" });

// ---------------------------------------------------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------------------------------------------------

const abortError = (signal) => {
  const error = new Error("Redux dlc: cancelled.");
  error.name = "AbortError";
  error.code = "CANCELLED";
  if (signal?.reason !== undefined) error.reason = signal.reason;
  return error;
};
const isCancel = (error) => error?.name === "AbortError" || error?.code === "CANCELLED";
const isPause = (reason) => reason === "pause" || reason?.pause === true;
const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const exists = (file) => fs.stat(file).then(() => true, () => false);
const relativeDlc = (name) => `update/x64/dlcpacks/${name}/dlc.rpf`;
const lowerPath = (value) => String(value ?? "").replaceAll("\\", "/").toLowerCase();

// Не больше `max` задач одновременно; очередь по порядку прихода.
function limiter(max) {
  const limit = max === Infinity ? Infinity : Math.max(1, Math.floor(Number(max)) || 1);
  let active = 0;
  const waiting = [];
  const pump = () => {
    while (active < limit && waiting.length > 0) {
      active += 1;
      waiting.shift()();
    }
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push(() => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            pump();
          });
      });
      pump();
    });
}

/** Сводные записи от крючка: список `{ entry, source }` (массив готовый или функция от изменения). */
async function registryBodies(registry, change) {
  if (registry === null || registry === undefined) return [];
  let list;
  try {
    list = typeof registry === "function" ? await registry(change) : registry;
  } catch (error) {
    throw new ReduxDlcError("REGISTRY_FAILED", `Redux dlc: the registry composer failed: ${error?.message ?? error}`, { cause: error, phase: change.action });
  }
  if (!Array.isArray(list) || list.some((item) => !item || typeof item.entry !== "string" || typeof item.source !== "string")) {
    throw new ReduxDlcError("REGISTRY_FAILED", "Redux dlc: the registry composer returns a list of { entry, source }.", { phase: change.action });
  }
  return list;
}

// ---------------------------------------------------------------------------------------------------------------------
// Запросы движку
// ---------------------------------------------------------------------------------------------------------------------

const toRegistry = (list) => (list ?? []).map(({ entry, source }) => ({ entry, source }));

/**
 * Запрос дозаписи слоя: те же ключи, что у `compose-rpf` с `install.write: "append"` и слоем, плюс два ключа проекта:
 * `install.layer.registry` — список общих записей корня с телами (R2) и `install.creates` — файлы, которые создала установка и которые
 * убирает откат точки (R1). Необязательное — только когда названо.
 */
export function reduxLayerRequest({ gameRoot, moduleName, layerId, operations = [], registry = [], creates = [], update = {}, keepKey = false }) {
  const archive = update.archive ?? UPDATE_ARCHIVE;
  const install = {
    gameRoot: String(gameRoot),
    archive,
    replay: { module: moduleName, ...(update.workId ? { workId: update.workId } : {}) },
    write: "append",
    /* Общие записи корня — внутри `layer` (`install.layer.registry`, R2): движок читает их только там и добавляет к операциям слоя сам. */
    layer: { id: layerId, ...(update.requires?.length ? { requires: update.requires } : {}), ...(registry?.length ? { registry: toRegistry(registry) } : {}) },
  };
  if (creates?.length) install.creates = creates.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  if (update.recipe) install.saveRecipe = update.recipe;
  if (update.pointId) install.pointId = update.pointId;
  if (update.baseSha256) install.baseSha256 = update.baseSha256;
  // длина файла держит ключ головы (R4): без ключа в окне записи игра может увидеть «файл вырос, голова прежняя»
  if (keepKey === true) install.keepKey = true;
  /* Хвост после последней записи (`rpf-tail-switch.js`): маленькое тело последним роняло сюжет. */
  if (keepKey === true && rpfTailEnabled()) install.tailPad = true;
  return { mode: "compose", archiveTarget: archive, allowDeletes: false, operations, install };
}

/** Запрос `switch-rpf-layers` для одного слоя: слово `enable`, `disable` или `remove`, общие записи списком (R2). */
export function reduxSwitchRequest({ gameRoot, moduleName, mode, layerId, registry = [], archive = UPDATE_ARCHIVE, baseSha256, expectState, keepKey = false }) {
  if (!SWITCH_MODES.has(mode)) throw argumentError("the switch word is enable, disable or remove.");
  return {
    gameRoot: String(gameRoot),
    archive,
    [mode]: [layerId],
    replay: { module: moduleName },
    module: moduleName,
    ...(keepKey === true ? { keepKey: true } : {}),
    ...(keepKey === true && rpfTailEnabled() ? { tailPad: true } : {}),
    ...(registry?.length ? { registry: toRegistry(registry) } : {}),
    ...(expectState ? { expectState } : {}),
    ...(baseSha256 ? { baseSha256 } : {}),
  };
}

/**
 * Отказы ключа длины (R4): оба приходят до первой записи, файл и журнал не тронуты. `KeyShifted` — архив уже сдвинут чужой правкой
 * (прежняя голова открылась не ключом по длине), `KeyPadTooLong` — добавка до потолка не нашлась. Дозапись с ключом тут невозможна:
 * вызывающий идёт полным путём или «Починить», молча без ключа не пишем (окно «файл вырос, голова прежняя» вернулось бы).
 */
const KEY_REFUSALS = Object.freeze({ KeyShifted: "KEY_SHIFTED", KeyPadTooLong: "KEY_PAD_TOO_LONG" });

/** Код `ReduxDlcError` и подсказка вызывающему по отказу движка; не отказ ключа — `fallback` без подсказки. */
function refusalOf(error, fallback) {
  const code = KEY_REFUSALS[error?.code];
  return code ? { code, retry: "full-path" } : { code: fallback, retry: null };
}

async function settleAfterFailure({ engine, gameRoot, archive }) {
  try {
    const answer = await engine("settle-rpf-journals", { gameRoot: String(gameRoot), archives: [archive] }, {});
    return { finished: Number(answer?.counts?.finished) > 0, failed: false, answer };
  } catch (error) {
    return { finished: false, failed: true, answer: null, error };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Уборка недоделанного и готового (до включения слоя)
// ---------------------------------------------------------------------------------------------------------------------

const emptyReport = () => ({ released: [], cancelled: [], removed: [], leftovers: [], kept: [] });

async function removeParts(parts, { engine, moduleName }) {
  const report = emptyReport();
  for (const part of [...parts].reverse()) {
    try {
      if (part.state === "adopted") {
        report.kept.push({ name: part.pack, path: part.output, bytes: part.bytes, sha256: part.sha256, state: "adopted" });
        continue;
      }
      if (part.state === "sealed") {
        const answer = await engine("release-rpf-dlc", { module: moduleName, path: part.output, bytes: part.bytes, sha256: part.sha256 }, {});
        if (answer?.released === false && answer?.verdict !== "missing") report.leftovers.push({ path: part.output, reason: answer?.verdict ?? "kept" });
        else report.released.push(part.output);
        continue;
      }
      // «Начато»: возможно, лежит недостроенный файл с маркером; ответ мог потеряться, и тогда файл уже запечатан
      const answer = await engine("cancel-rpf-dlc", { module: moduleName, output: part.output }, {}).catch((error) => ({ error }));
      if (answer?.error) report.leftovers.push({ path: part.output, reason: answer.error.code ?? "cancel" });
      else report.cancelled.push(part.output);
      const stat = await fs.stat(part.output).catch(() => null);
      if (stat?.isFile()) {
        // до нас файла не было (план это проверил): запечатанный, но не засчитанный наш — убираем
        await fs.rm(part.output, { force: true });
        report.removed.push(part.output);
      }
    } catch (error) {
      report.leftovers.push({ path: part.output, reason: error?.code ?? "error" });
    } finally {
      // папка пакета, если в ней больше ничего нет
      await fs.rmdir(join(part.output, "..")).catch(() => {});
    }
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Установить редукс: dlc для контейнеров, малый слой для записей корня.
 *
 * @param {object} options
 * @param {Function} options.engine         `(command, request, { signal, args, onProgress }) => result`
 * @param {string}   options.gameRoot       корень игры
 * @param {string}   options.moduleName     слово модуля для выключателей движка (`ASTRAL_ENGINE_NEWDLC`, `…_APPEND`, `…_LAYERS`)
 * @param {string}   options.cardId         id карточки редукса: от него имена слоя и dlc
 * @param {object[]} options.files          записи манифеста всех частей: `{ target, entry, action, merge?, size, sha256?, source }`;
 *                                          `source` — готовый файл на диске (при `follow` у записей контейнеров его ещё нет)
 * @param {string}   options.stageDir       своя временная папка: основа dlc (`content.xml`, `setup2.xml`) и журналы; после установки пуста
 * @param {number}   [options.order]        `order` в `setup2.xml` (58–104); без него — первый свободный из `usedOrders`
 * @param {number[]} [options.usedOrders]
 * @param {Function} [options.baseHasArchive]  `(путь) => bool`: есть ли вложенный архив в основе игры (классы U-linked)
 * @param {boolean}  [options.manifestInDlc=false]  контейнеры с `_manifest.ymf` тоже в dlc (только после проверки в игре)
 * @param {string}   [options.mapData="split"]      данные карты своим архивом `_metadata` (`split`) или контейнер целым (`whole`)
 * @param {string}   [options.linked="report"]      `refuse` — отказ до записи, если есть части U-linked
 * @param {object}   [options.update]       `{ archive?, command?, args?, workId?, pointId?, baseSha256?, recipe? (абсолютный путь сводного рецепта), requires? }`
 * @param {Array|Function} [options.registry]  сводные записи корня: массив `{ entry, source }` или `async (change) => массив`; `change`:
 *                                          `{ action: "install", layerId, dlcs, shared }`; `dlclist.xml` обязателен, если есть dlc
 * @param {object[]} [options.adopt]        уже лежащие dlc `{ name, bytes, sha256 }`: сверяются и берутся, а не собираются
 * @param {object}   [options.follow]       `{ download({ order, feeder, signal, packs }) }`: сборка идёт «следом» за загрузкой (S0)
 * @param {number}   [options.followIdleMs] сколько движок ждёт новой строки журнала
 * @param {Function} [options.verify]       крючок строгого читателя приложения: `async ({ packs: [{ name, path, bytes, sha256 }] })`
 * @param {Function} [options.commit]       крючок состояния: `async ({ layerId, cardId, dlcs, state, fingerprint, linked })`
 * @param {AbortSignal} [options.signal]    отмена; причина `"pause"` при `follow` оставляет недостроенное для резюме (`PAUSED`)
 */
export async function installReduxDlc(options) {
  const {
    engine,
    gameRoot,
    moduleName,
    cardId,
    files,
    stageDir,
    order = null,
    usedOrders = null,
    baseHasArchive,
    manifestInDlc = false,
    mapData = "split",
    linked = "report",
    update = {},
    registry = null,
    adopt = [],
    follow = null,
    followIdleMs,
    packBudget = REDUX_PACK_BUDGET,
    maxBytes = REDUX_MAX_BYTES,
    packsAtOnce = 1,
    buildVerify = "table",
    checkpoint = null,
    confirm = "intact",
    verify = null,
    commit = null,
    keepKey = true,
    maxSwitchBodyBytes = 64 * MIB,
    maxLayerBytes = 256 * MIB,
    reserveBytes = 512 * MIB,
    spaceCheck = true,
    describe = describeFile,
    signal = null,
    onPhase = null,
    onProgress = null,
    now = () => performance.now(),
  } = options ?? {};

  // ---- 0. аргументы и маршрут: до первого вызова движка и до первого байта на диске ----
  if (typeof engine !== "function") throw argumentError("no engine function.");
  if (!gameRoot || !moduleName || !stageDir) throw argumentError("gameRoot, moduleName and stageDir are required.");
  if (!BUILD_VERIFY.has(buildVerify) || !CONFIRM.has(confirm)) throw argumentError("unknown verify mode.");
  if (!LINKED_POLICY.has(linked)) throw argumentError("linked is report or refuse.");
  if (!Number.isFinite(packBudget) || packBudget <= 0 || !Number.isFinite(maxBytes) || maxBytes <= 0) throw argumentError("packBudget and maxBytes are positive numbers.");
  if (!Number.isInteger(packsAtOnce) || packsAtOnce < 1) throw argumentError("packsAtOnce is a positive number.");
  if (!Array.isArray(files) || files.length === 0) throw argumentError("files is a non-empty list.");
  if (!Array.isArray(adopt) || adopt.some((item) => !item || !item.name || !Number.isFinite(item.bytes) || !SHA256.test(String(item.sha256 ?? "")))) throw argumentError("adopt is a list of { name, bytes, sha256 }.");
  if (follow !== null && typeof follow?.download !== "function") throw argumentError("follow needs a download function.");
  if (update === null || typeof update !== "object") throw argumentError("update is an object.");
  if (registry !== null && typeof registry !== "function" && !Array.isArray(registry)) throw argumentError("registry is a list or a function.");
  for (const hook of [verify, commit]) if (hook !== null && typeof hook !== "function") throw argumentError("a hook is a function.");
  if (typeof mapData !== "string" || !["split", "whole"].includes(mapData)) throw argumentError("mapData is split or whole.");
  let identity;
  try {
    identity = reduxIdentity(cardId);
  } catch (error) {
    throw argumentError(error.message);
  }

  const routed = routeReduxFiles(files, { baseHasArchive, manifestInDlc });
  const classes = [...routed.classes];
  const reasons = routed.perFile.map((item) => item.reason);
  // Тяжёлая запись корня малому слою не по росту: прежним путём. Запас update.rpf под дозапись — сотни МБ, слой живёт в нём.
  for (const item of routed.switch) {
    const size = Number(item.file.size);
    if (!Number.isFinite(size) || size < 0 || typeof item.file.source !== "string" || !isAbsolute(item.file.source)) throw argumentError(`${item.file.entry}: a root record needs a size and an absolute source file.`);
    if (size > maxSwitchBodyBytes) {
      classes[item.index] = REDUX_CLASSES.LINKED;
      reasons[item.index] = "body-too-large";
    }
  }
  const switchItems = routed.switch.filter((item) => classes[item.index] === REDUX_CLASSES.SWITCH);
  if (sum(switchItems, (item) => item.file.size) > maxLayerBytes) {
    throw new ReduxDlcError("LAYER_TOO_LARGE", "Redux dlc: the small layer would not stay small.", { phase: "arguments" });
  }
  const linkedItems = files.map((file, index) => ({ file, index })).filter(({ index }) => classes[index] === REDUX_CLASSES.LINKED);
  const reasonCounts = {};
  for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  const routes = {
    counts: {
      [REDUX_CLASSES.D]: classes.filter((word) => word === REDUX_CLASSES.D).length,
      [REDUX_CLASSES.SWITCH]: switchItems.length,
      [REDUX_CLASSES.LINKED]: linkedItems.length,
    },
    reasons: reasonCounts,
    switchable: linkedItems.length === 0,
    linked: linkedItems.map(({ file, index }) => ({ entry: file.entry, reason: reasons[index] })),
    containers: routed.containers,
  };
  if (linked === "refuse" && linkedItems.length > 0) {
    throw new ReduxDlcError("LINKED_PARTS", "Redux dlc: the redux has parts that a switch of the table of contents does not cover.", { phase: "arguments", cleanup: { linked: linkedItems.length } });
  }
  if (routes.counts.D === 0 && switchItems.length === 0) throw argumentError("nothing to install: no records for a dlc or for the small layer.");

  // dlc: контейнеры по пакетам, записи по архивам, порядок и имена
  const dGroups = routed.d.filter((group) => group.files.every((item) => classes[item.index] === REDUX_CLASSES.D));
  let dlcOrder = null;
  if (dGroups.length > 0) {
    if (order !== null && order !== undefined) {
      if (!Number.isInteger(order) || order < REDUX_ORDER_MIN || order > REDUX_ORDER_MAX) throw argumentError(`order is a number from ${REDUX_ORDER_MIN} to ${REDUX_ORDER_MAX}.`);
      dlcOrder = order;
    } else if (Array.isArray(usedOrders)) {
      dlcOrder = nextReduxOrder(usedOrders);
      if (dlcOrder === null) throw new ReduxDlcError("NO_ORDER", "Redux dlc: every order of a redux is taken.", { phase: "arguments" });
    } else throw argumentError("order or usedOrders is required.");
  }
  const seenPaths = new Set();
  const containers = dGroups.map((group) => {
    const rows = group.files.map((item) => {
      const size = Number(item.file.size);
      if (!Number.isFinite(size) || size < 0) throw argumentError(`${item.file.entry}: a dlc record needs a size.`);
      if (!follow && (typeof item.file.source !== "string" || !isAbsolute(item.file.source))) throw argumentError(`${item.file.entry}: a dlc record needs an absolute source file (or a follow download).`);
      // разобранный манифест называет отсутствующий отпечаток пустой строкой
      const digest = item.file.sha256 ? String(item.file.sha256).toLowerCase() : null;
      if (digest && !SHA256.test(digest)) throw argumentError(`${item.file.entry}: sha256 is 64 hexadecimal digits.`);
      const archive = reduxArchiveOf(group.name, item.inner, { mapData });
      const path = `${archive}/${item.inner}`;
      if (seenPaths.has(path)) throw argumentError(`${path}: two records name one record of the dlc.`);
      seenPaths.add(path);
      return { file: item.file, entry: item.file.entry, inner: item.inner, archive, path, size, sha256: digest, source: item.file.source || null };
    });
    return { name: group.name, rows, entries: rows.map((row) => ({ size: row.size })) };
  });
  let packGroups;
  try {
    packGroups = splitReduxPacks(containers, { budgetBytes: packBudget });
  } catch (error) {
    throw new ReduxDlcError(error.code ?? "ARGUMENTS", error.message, { phase: "arguments", cause: error });
  }
  const adoptedByName = new Map(adopt.map((item) => [item.name, item]));
  const model = packGroups.map((group, index) => {
    const name = identity.packName(index);
    const archives = group.map((container) => {
      const metadata = container.rows.find((row) => row.archive !== container.name)?.archive;
      return { ...(container.rows.some((row) => row.archive === container.name) ? { stream: container.name } : {}), ...(metadata ? { metadata } : {}) };
    });
    return {
      index,
      name,
      device: identity.device(index),
      output: dlcPackPath(gameRoot, name),
      relative: relativeDlc(name),
      rows: group.flatMap((container) => container.rows),
      archives,
      minorOrder: index,
      adopted: adoptedByName.get(name) ?? null,
    };
  });
  for (const item of adopt) if (!model.some((pack) => pack.name === item.name)) throw argumentError(`adopt names ${item.name}, which this install does not plan.`);

  const started = now();
  const phase = (name, info = {}) => onPhase?.(name, { at: Math.round(now() - started), ...info });
  const timings = {};
  const lap = (key, from) => {
    timings[key] = Math.round(now() - from);
  };

  // Отмена: наша и внешняя сливаются; первый же сбой гасит остальные сборки.
  const control = new AbortController();
  const onOuterAbort = () => control.abort(signal.reason);
  if (signal) {
    if (signal.aborted) control.abort(signal.reason);
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const guard = control.signal;
  const call = (command, request, extra = {}) => {
    if (guard.aborted) throw abortError(guard);
    return engine(command, { module: moduleName, ...request }, { signal: guard, onProgress, ...extra });
  };

  const parts = [];
  const track = (part) => {
    parts.push(part);
    return part;
  };
  const staged = [];
  const dlcsOf = () =>
    model.map((pack) => ({
      name: pack.name,
      bytes: pack.bytes,
      sha256: pack.sha256,
      order: pack.adopted?.order ?? dlcOrder,
      minorOrder: pack.adopted?.minorOrder ?? pack.minorOrder,
      ...(pack.fileId ? { fileId: pack.fileId } : {}),
    }));

  // Ждём ВСЕ задачи фазы, а не первую упавшую: сборки, которых гасит первый сбой, должны успеть остановиться, и только потом
  // идёт уборка, иначе она наступит им на ноги.
  let firstError = null;
  const settle = async (promises) => {
    const wrapped = promises.map((promise) =>
      Promise.resolve(promise).catch((error) => {
        if (!firstError) {
          firstError = error;
          control.abort(error);
        }
        throw error;
      }),
    );
    const settled = await Promise.allSettled(wrapped);
    if (firstError) throw firstError;
    return settled.map((item) => item.value);
  };

  let current = "plan";
  const FAILED = { plan: "PLAN_FAILED", build: "BUILD_FAILED", confirm: "VERIFY_FAILED", layer: "UPDATE_FAILED", state: "STATE_FAILED" };
  const fail = async (error) => {
    const paused = follow !== null && isCancel(error) && signal?.aborted === true && isPause(signal.reason);
    control.abort(error);
    if (error instanceof ReduxDlcError && error.cleanup) throw error;
    let report;
    if (paused) {
      // пауза: недостроенное и готовое остаётся, резюме достроит; убирать нечего
      report = emptyReport();
      report.kept = parts
        .filter((part) => part.state !== "adopted")
        .map((part) => ({ name: part.pack, path: part.output, state: part.state === "sealed" ? "sealed" : "partial", ...(part.state === "sealed" ? { bytes: part.bytes, sha256: part.sha256 } : {}) }));
    } else report = await removeParts(parts, { engine, moduleName });
    if (error instanceof ReduxDlcError) {
      error.cleanup = report;
      throw error;
    }
    const cancelled = isCancel(error);
    const code = paused ? "PAUSED" : cancelled ? "CANCELLED" : (FAILED[current] ?? "BUILD_FAILED");
    throw new ReduxDlcError(code, cancelled ? `Redux dlc: ${paused ? "paused" : "cancelled"}.` : `Redux dlc: ${current}: ${error?.message ?? error}`, { cause: error, phase: current, cleanup: report });
  };

  const hasDlc = model.length > 0;
  const fresh = model.filter((pack) => !pack.adopted);
  let followOrder = [];

  try {
    // ---- 1. план: длина и место до первого байта (или порядок тел при `follow`) ----
    current = "plan";
    phase("plan");
    const planStarted = now();
    // уже лежащие dlc: сверка до всего остального, чтобы не качать зря (решение 3: dlc сверяется по хэшу, а не качается заново)
    if (confirm !== "none") {
      const bad = [];
      for (const pack of model.filter((item) => item.adopted)) {
        const verdict = await call("verify-rpf-dlc", { path: pack.output, bytes: pack.adopted.bytes, sha256: pack.adopted.sha256, ...(confirm === "stat" ? { mode: "stat", ...(pack.adopted.fileId ? { fileId: pack.adopted.fileId } : {}) } : {}) });
        if (verdict?.verdict !== "intact") bad.push({ name: pack.name, verdict: verdict?.verdict ?? "unknown", reason: verdict?.reason ?? null });
      }
      if (bad.length > 0) throw new ReduxDlcError("NOT_INTACT", "Redux dlc: a dlc archive is not intact; build it again.", { phase: "plan", cleanup: { ...emptyReport(), bad } });
    }
    for (const pack of model.filter((item) => item.adopted)) {
      pack.bytes = pack.adopted.bytes;
      pack.sha256 = pack.adopted.sha256;
      if (pack.adopted.fileId) pack.fileId = pack.adopted.fileId;
      track({ kind: "root", pack: pack.name, output: pack.output, state: "adopted", bytes: pack.bytes, sha256: pack.sha256 });
    }
    // записи корня для малого слоя: файл лежит и той длины, что в манифесте (при `follow` — ещё не обязан, проверяется перед слоем)
    const checkSwitchSources = async (where) => {
      for (const item of switchItems) {
        const stat = await fs.stat(item.file.source).catch(() => null);
        if (!stat?.isFile() || stat.size !== Number(item.file.size)) throw new ReduxDlcError("SIZE_MISMATCH", `Redux dlc: ${item.file.entry} is missing or has another size.`, { phase: where });
      }
    };
    if (!follow) await checkSwitchSources("plan");

    for (const pack of fresh) {
      const host = await stageReduxHost({ stageDir, packName: pack.name, device: pack.device, archives: pack.archives, order: dlcOrder, minorOrder: pack.minorOrder });
      staged.push(host);
      pack.host = host;
      pack.journal = join(host.dir, "follow.jsonl");
    }
    if (!follow) {
      // кто есть кто: вид и слова по первым байтам каждого файла, длина с диска против манифеста
      const run = limiter(16);
      await settle(
        fresh.map(async (pack) => {
          const described = await Promise.all(
            pack.rows.map((row) =>
              run(async () => {
                const entry = await describe(row.source, row.path, row.sha256 ? { sha256: row.sha256 } : {});
                if (entry.size !== row.size) throw new ReduxDlcError("SIZE_MISMATCH", `Redux dlc: ${row.entry} has another size than the manifest names.`, { phase: "plan" });
                return entry;
              }),
            ),
          );
          pack.flat = [...pack.host.entries, ...described];
          pack.plan = await call("layout-rpf-plan", { entries: pack.flat, archiveName: "dlc.rpf", output: pack.output, maxBytes, nested: "inplace" });
          if (pack.plan?.nested !== "inplace") throw new ReduxDlcError("ENGINE_UNSUPPORTED", "Redux dlc: the engine does not know nested inplace.", { phase: "plan" });
          if (Number(pack.plan.bytes) > maxBytes) throw new ReduxDlcError("ARCHIVE_TOO_LARGE", `Redux dlc: ${pack.name}/dlc.rpf would be longer than the limit.`, { phase: "plan" });
          pack.resumed = Boolean(pack.plan.building);
        }),
      );
      for (const pack of fresh) {
        if (pack.plan.outputExists && !pack.plan.building) throw new ReduxDlcError("OUTPUT_EXISTS", `Redux dlc: ${pack.name}/dlc.rpf already exists.`, { phase: "plan" });
      }
      if (spaceCheck && fresh.length > 0) {
        const needed = sum(fresh, (pack) => pack.plan.space?.needed);
        const frees = fresh.map((pack) => pack.plan.space?.free).filter(Number.isFinite);
        if (frees.length > 0 && needed + reserveBytes > Math.min(...frees)) throw new ReduxDlcError("NO_SPACE", "Redux dlc: the volume cannot hold the archives.", { phase: "plan" });
      }
    } else {
      // «следом»: тела придут по журналу, вид движок определит сам; названы только имена, длины и SHA-256 из манифеста
      for (const pack of fresh) {
        // остаток прежней попытки (маркер) продолжится сам (`mode: auto`), готовый файл без маркера — чужой
        const building = await exists(`${pack.output}.astral-building`);
        if ((await exists(pack.output)) && !building) throw new ReduxDlcError("OUTPUT_EXISTS", `Redux dlc: ${pack.name}/dlc.rpf already exists.`, { phase: "plan" });
        pack.resumed = building;
        pack.flat = [
          ...pack.host.entries.map(({ path, size, sha256, source }) => ({ path, size, sha256, source })),
          ...pack.rows.map((row) => ({ path: row.path, size: row.size, ...(row.sha256 ? { sha256: row.sha256 } : {}) })),
        ];
        pack.expectBytes = estimateReduxArchiveBytes(pack.flat);
      }
      await settle(
        fresh.map(async (pack) => {
          pack.plan = await call("layout-rpf-plan", { entries: pack.flat, archiveName: "dlc.rpf", output: pack.output, follow: true });
          const wanted = new Map(pack.rows.map((row) => [row.path, row]));
          pack.order = (pack.plan?.order ?? []).map((item) => wanted.get(item.path)?.entry).filter(Boolean);
          if (pack.order.length !== pack.rows.length) throw new ReduxDlcError("ENGINE_UNSUPPORTED", "Redux dlc: the engine named no order for the bodies.", { phase: "plan" });
        }),
      );
      followOrder = fresh.flatMap((pack) => pack.order);
    }
    lap("plan", planStarted);

    // ---- 2. сборка: dlc на месте; при `follow` — вместе с загрузкой ----
    current = "build";
    phase("build");
    const buildStarted = now();
    const perPack = limiter(packsAtOnce);
    const buildOne = (pack) =>
      perPack(async () => {
        // очередь после сбоя или отмены доходит до этой задачи, когда движок уже не нужен: ничего не начато, убирать нечего
        if (guard.aborted) throw abortError(guard);
        const packStarted = now();
        const root = track({ kind: "root", pack: pack.name, output: pack.output, state: "started", bytes: pack.plan?.bytes ?? null, sha256: null });
        const request = follow
          ? {
              output: pack.output,
              archiveName: "dlc.rpf",
              entries: pack.flat,
              follow: pack.journal,
              ...(followIdleMs ? { followIdleMs } : {}),
              expectBytes: pack.expectBytes,
              verify: buildVerify,
              maxBytes,
              mode: "auto",
              onCancel: "keep",
              ...(checkpoint ? { checkpoint } : {}),
            }
          : {
              output: pack.output,
              archiveName: "dlc.rpf",
              entries: pack.flat,
              nested: "inplace",
              verify: buildVerify,
              maxBytes,
              mode: "auto",
              onCancel: "remove",
              ...(checkpoint ? { checkpoint } : {}),
            };
        const answer = await call("build-rpf-dlc", request);
        // «на месте» длина известна из раскладки и обязана сойтись; «следом» она приходит с телами
        const planned = follow ? answer?.bytes : pack.plan.bytes;
        if (!answer?.sealed || !(answer.bytes > 0) || answer.bytes !== planned || !answer.sha256) {
          throw new ReduxDlcError("BUILD_FAILED", `Redux dlc: ${pack.name}/dlc.rpf was not sealed as planned.`, { phase: "build" });
        }
        root.state = "sealed";
        root.bytes = answer.bytes;
        root.sha256 = answer.sha256;
        pack.answer = answer;
        pack.bytes = answer.bytes;
        pack.sha256 = answer.sha256;
        // номер файла с печати (R3): по нему быстрая сверка узнаёт подмену файлом той же длины; ответ без него — ключа нет
        if (answer.fileId) pack.fileId = answer.fileId;
        pack.ms = Math.round(now() - packStarted);
      });
    if (!follow) {
      await settle(fresh.map(buildOne));
    } else {
      const feeder = createFeeder(fresh);
      for (const pack of fresh) await fs.writeFile(pack.journal, "");
      const downloading = (async () => {
        try {
          await follow.download({ order: followOrder, feeder, signal: guard, packs: fresh.map((pack) => ({ name: pack.name, path: pack.output, order: dlcOrder })) });
          await feeder.end();
        } catch (error) {
          // отмену, паузу и чужой сбой гасит движок сам (слово `cancel`, сигнал): строка `abort` в журнале убрала бы недостроенное и при паузе
          if (guard.aborted) throw abortError(guard);
          await feeder.abort(error?.message ?? String(error)).catch(() => {});
          if (error instanceof ReduxDlcError) throw error;
          throw new ReduxDlcError("DOWNLOAD_FAILED", `Redux dlc: download: ${error?.message ?? error}`, { cause: error, phase: "build" });
        }
      })();
      await settle([...fresh.map(buildOne), downloading]);
    }
    lap("build", buildStarted);

    // ---- 3. проверка до включения: dlc цел на диске, строгий читатель приложения доволен ----
    current = "confirm";
    phase("confirm");
    const confirmStarted = now();
    if (confirm !== "none") {
      await settle(
        fresh.map(async (pack) => {
          const verdict = await call("verify-rpf-dlc", { path: pack.output, bytes: pack.bytes, sha256: pack.sha256, ...(confirm === "stat" ? { mode: "stat", ...(pack.fileId ? { fileId: pack.fileId } : {}) } : {}) });
          if (verdict?.verdict !== "intact") {
            throw new ReduxDlcError("VERIFY_FAILED", `Redux dlc: ${pack.name}/dlc.rpf is ${verdict?.verdict ?? "unknown"} (${verdict?.reason ?? ""}).`, { phase: "confirm" });
          }
          pack.confirmed = verdict;
        }),
      );
    }
    if (typeof verify === "function" && hasDlc) {
      await verify({ packs: model.map((pack) => ({ name: pack.name, path: pack.output, bytes: pack.bytes, sha256: pack.sha256 })) });
    }
    lap("confirm", confirmStarted);

    // ---- 4. малый слой в update.rpf: только теперь ----
    current = "layer";
    phase("layer");
    const layerStarted = now();
    if (guard.aborted) throw abortError(guard);
    if (follow) await checkSwitchSources("layer");
    const dlcs = dlcsOf();
    const sharedFiles = switchItems.filter((item) => item.shared).map((item) => ({ entry: item.file.entry, source: item.file.source, sha256: item.file.sha256 ? String(item.file.sha256).toLowerCase() : null }));
    const bodies = await registryBodies(registry, { action: "install", layerId: identity.layerId, dlcs, shared: sharedFiles });
    const have = new Set(bodies.map((item) => lowerPath(item.entry)));
    if (hasDlc && !have.has(DLCLIST_ENTRY)) throw new ReduxDlcError("REGISTRY_MISSING", `Redux dlc: no registry body for ${DLCLIST_ENTRY}: nothing names the dlc.`, { phase: "layer" });
    for (const item of sharedFiles) {
      if (!have.has(lowerPath(item.entry))) throw new ReduxDlcError("REGISTRY_MISSING", `Redux dlc: no registry body for ${item.entry}.`, { phase: "layer" });
    }
    const sharedSet = new Set(sharedFiles.map((item) => lowerPath(item.entry)));
    const operations = switchItems
      .filter((item) => !sharedSet.has(lowerPath(item.file.entry)))
      .map((item) => ({ entry: item.file.entry, action: String(item.file.action ?? "replace").toLowerCase(), source: item.file.source, ...(item.file.sha256 ? { sha256: String(item.file.sha256).toLowerCase() } : {}) }));
    const creates = fresh.map((pack) => ({ path: pack.relative, bytes: pack.bytes, sha256: pack.sha256 }));
    const request = reduxLayerRequest({ gameRoot, moduleName, layerId: identity.layerId, operations, registry: bodies, creates, update, keepKey });
    let layerAnswer;
    let recovered = null;
    try {
      // Дозапись маленькая и сама крашустойчива (журнал): отмену во время неё не передаём.
      layerAnswer = await engine(update.command ?? "compose-rpf", request, { onProgress, args: update.args });
    } catch (error) {
      const settled = await settleAfterFailure({ engine, gameRoot, archive: update.archive ?? UPDATE_ARCHIVE });
      if (settled.finished) {
        layerAnswer = { recoveredByRestart: true, settle: settled.answer };
        recovered = "finished";
      } else if (settled.failed) {
        // что с журналом — неизвестно: слой мог лечь, и тогда dlclist называет файл; файл остаётся
        const report = emptyReport();
        report.unsure = true;
        report.kept = model.map((pack) => ({ name: pack.name, path: pack.output, bytes: pack.bytes, sha256: pack.sha256, state: "sealed" }));
        throw new ReduxDlcError("UPDATE_FAILED", `Redux dlc: update.rpf: ${error?.message ?? error}`, { cause: error, phase: "layer", cleanup: report });
      } else {
        const refusal = refusalOf(error, "UPDATE_FAILED");
        throw new ReduxDlcError(refusal.code, `Redux dlc: update.rpf: ${error?.message ?? error}`, { cause: error, phase: "layer", retry: refusal.retry });
      }
    }
    lap("layer", layerStarted);

    // ---- 5. состояние ----
    current = "state";
    phase("state");
    const state = { layerId: identity.layerId, state: "enabled", dlcs, fingerprint: layerAnswer?.fingerprint ?? null };
    if (typeof commit === "function") {
      try {
        await commit({ ...state, cardId, linked: routes.linked });
      } catch (error) {
        // слой стоит, а записать это некуда: слой снимается, потом освобождаются файлы (dlclist не должен называть пропавший файл)
        const report = emptyReport();
        let removed = false;
        try {
          const undo = await registryBodies(registry, { action: "remove", layerId: identity.layerId, dlcs });
          await engine("switch-rpf-layers", reduxSwitchRequest({ gameRoot, moduleName, mode: "remove", layerId: identity.layerId, registry: undo, archive: update.archive ?? UPDATE_ARCHIVE, keepKey }), {});
          removed = true;
        } catch (undoError) {
          report.leftovers.push({ layer: identity.layerId, reason: undoError?.code ?? "error" });
        }
        if (removed) Object.assign(report, await removeParts(parts, { engine, moduleName }));
        else report.kept = model.map((pack) => ({ name: pack.name, path: pack.output, bytes: pack.bytes, sha256: pack.sha256, state: "sealed" }));
        report.layerRemoved = removed;
        throw new ReduxDlcError("STATE_FAILED", `Redux dlc: state: ${error?.message ?? error}`, { cause: error, phase: "state", cleanup: report });
      }
    }
    timings.total = Math.round(now() - started);
    phase("done");

    return {
      status: "installed",
      layerId: identity.layerId,
      cardId,
      packs: model.map((pack) => ({
        name: pack.name,
        path: pack.output,
        bytes: pack.bytes,
        sha256: pack.sha256,
        order: pack.adopted?.order ?? dlcOrder,
        minorOrder: pack.adopted?.minorOrder ?? pack.minorOrder,
        reused: Boolean(pack.adopted),
        resumed: Boolean(pack.resumed),
        files: pack.rows.length,
        confirmed: pack.confirmed ?? null,
        timings: { plan: pack.plan?.timings?.plan ?? null, pack: pack.ms ?? null, engine: pack.answer?.timings ?? null },
        bytesWritten: pack.answer?.bytesWritten ?? null,
        ...(pack.fileId ? { fileId: pack.fileId } : {}),
      })),
      order: followOrder,
      state,
      layer: layerAnswer,
      fingerprint: state.fingerprint,
      // старый движок ключ `keepKey` молча игнорирует: что он принят, видно по `keyPadBytes` в ответе (число, только у принявшего)
      keyHeld: keepKey === true && Number.isFinite(layerAnswer?.keyPadBytes),
      recovered,
      routes,
      bytes: reduxBytes({ model: fresh, layerAnswer, confirm }),
      settings: { packsAtOnce, packBudget, buildVerify, confirm, checkpoint, mapData, mode: follow ? "follow" : "files" },
      timings,
    };
  } catch (error) {
    return await fail(error);
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
    for (const host of staged) await host.cleanup().catch(() => {});
  }
}

// Какие байты ушли в диск и пришли с него по спискам и ответам движка (замер диска делает стенд).
function reduxBytes({ model, layerAnswer, confirm }) {
  const writtenRoot = sum(model, (pack) => pack.answer?.bytesWritten);
  const writtenUpdate = Number(layerAnswer?.bytesWritten) || 0;
  return {
    written: writtenRoot + writtenUpdate,
    writtenRoot,
    writtenUpdate,
    readSources: sum(model, (pack) => sum(pack.rows, (row) => row.size) + sum(pack.host?.entries ?? [], (entry) => entry.size)),
    readConfirm: confirm === "intact" ? sum(model, (pack) => pack.bytes) : 0,
    archiveBytes: sum(model, (pack) => pack.bytes),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// «Следом»: журнал готовности для загрузчика
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Загрузчик называет файл, когда он закрыт и больше не изменится: `feeder.done({ entry, file, size, sha256? })`, где `entry` — запись
 * манифеста. Здесь она превращается в строку журнала нужного dlc с путём внутри него. Строки только дописываются, по порядку.
 */
function createFeeder(packs) {
  const known = new Map();
  for (const pack of packs) for (const row of pack.rows) known.set(row.entry, { pack, row, fed: false });
  let chain = Promise.resolve();
  let ended = false;
  const append = (pack, line) => {
    const next = chain.then(() => fs.appendFile(pack.journal, `${JSON.stringify(line)}\n`));
    chain = next.catch(() => {});
    return next;
  };
  return {
    async done({ entry, file, size, sha256 } = {}) {
      const item = known.get(String(entry));
      if (!item) throw argumentError(`${entry}: the entry is not a record of a dlc that is being built.`);
      if (item.fed) throw argumentError(`${entry}: the file is named twice.`);
      if (typeof file !== "string" || !isAbsolute(file)) throw argumentError(`${entry}: the file path is absolute.`);
      if (size !== item.row.size) throw argumentError(`${entry}: the line names another size than the manifest.`);
      const digest = sha256 ?? item.row.sha256;
      if (sha256 && item.row.sha256 && sha256 !== item.row.sha256) throw argumentError(`${entry}: the line names another sha256 than the manifest.`);
      item.fed = true;
      await append(item.pack, { path: item.row.path, file, size, ...(digest ? { sha256: digest } : {}) });
    },
    async end() {
      if (ended) return;
      ended = true;
      for (const pack of packs) await append(pack, { end: true });
    },
    async abort(reason) {
      if (ended) return;
      ended = true;
      for (const pack of packs) await append(pack, { abort: String(reason).slice(0, 200) });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Выключить, включить, снять, освободить место
// ---------------------------------------------------------------------------------------------------------------------

function switchArguments({ engine, gameRoot, moduleName, layerId }) {
  if (typeof engine !== "function" || !layerId || !moduleName || !gameRoot) throw argumentError("engine, gameRoot, layerId and moduleName are required.");
}

async function switchOne(options, mode, { phase }) {
  const { engine, gameRoot, moduleName, layerId, dlcs = [], registry = null, archive = UPDATE_ARCHIVE, baseSha256, expectState, keepKey = true, signal = null, args } = options;
  const bodies = await registryBodies(registry, { action: mode, layerId, dlcs });
  try {
    return await engine("switch-rpf-layers", reduxSwitchRequest({ gameRoot, moduleName, mode, layerId, registry: bodies, archive, baseSha256, expectState, keepKey }), { signal, args });
  } catch (error) {
    const refusal = refusalOf(error, `${mode.toUpperCase()}_FAILED`);
    throw new ReduxDlcError(refusal.code, `Redux dlc: ${phase}: ${error?.message ?? error}`, { cause: error, phase, retry: refusal.retry });
  }
}

/**
 * Выключить редукс: слой выключается сменой оглавления (`update.rpf` как до установки, килобайты); файлы dlc лежат как лежали и
 * включаются мгновенно. `dlcs` нужны сборщику сводных записей.
 */
export async function disableReduxDlc(options) {
  switchArguments(options ?? {});
  const now = options.now ?? (() => performance.now());
  const at = now();
  const switched = await switchOne(options, "disable", { phase: "disable" });
  return { status: "disabled", switched, fingerprint: switched?.fingerprint ?? null, timings: { switch: Math.round(now() - at), total: Math.round(now() - at) } };
}

/**
 * Включить редукс: каждый dlc сверяется (`verify-rpf-dlc`; по умолчанию быстро, `mode: "stat"` — R3), потом слой включается сменой
 * оглавления. Не цел или нет файла — отказ `NOT_INTACT` до того, как оглавление тронуто: dlc качается заново.
 */
export async function enableReduxDlc(options) {
  switchArguments(options ?? {});
  const { engine, gameRoot, moduleName, dlcs = [], verifyMode = "stat", signal = null } = options;
  if (!VERIFY_MODES.has(verifyMode)) throw argumentError("verifyMode is stat or intact.");
  const now = options.now ?? (() => performance.now());
  const started = now();
  const verifyStarted = now();
  const verdicts = await Promise.all(
    dlcs.map(async (dlc) => {
      const answer = await engine("verify-rpf-dlc", { module: moduleName, path: dlcPackPath(gameRoot, dlc.name), bytes: dlc.bytes, sha256: dlc.sha256, ...(verifyMode === "stat" ? { mode: "stat", ...(dlc.fileId ? { fileId: dlc.fileId } : {}) } : {}) }, { signal });
      return { name: dlc.name, verdict: answer?.verdict ?? "unknown", reason: answer?.reason ?? null };
    }),
  );
  const verifyMs = Math.round(now() - verifyStarted);
  const bad = verdicts.filter((item) => item.verdict !== "intact");
  if (bad.length > 0) throw new ReduxDlcError("NOT_INTACT", "Redux dlc: a dlc archive is not intact; download it again.", { phase: "enable", cleanup: { ...emptyReport(), bad } });
  const at = now();
  const switched = await switchOne(options, "enable", { phase: "enable" });
  return { status: "enabled", verdicts, switched, fingerprint: switched?.fingerprint ?? null, timings: { verify: verifyMs, switch: Math.round(now() - at), total: Math.round(now() - started) } };
}

/**
 * Снять редукс: слой убирается (`remove`: его тела в `update.rpf` становятся мусором), потом свои dlc освобождаются
 * (`release-rpf-dlc`: файл убирается, только если он доказанно наш). Слой снят — игра dlc уже не видит, поэтому отказ уборки файла
 * (чужой, занят) не страшен: он перечислен в ответе. Отказ самого снятия слоя — ничего не освобождается: dlclist ещё называет файл.
 * `release: false` — слой снят, dlc остаются (повторная установка слоя без загрузки: `adopt`). `layerGone: "ignore"` — слоя в движке
 * уже нет (архив пересоздан), файлы всё равно освобождаются.
 */
export async function removeReduxDlc(options) {
  switchArguments(options ?? {});
  const { engine, gameRoot, moduleName, dlcs = [], release = true, layerGone = "fail", signal = null } = options;
  if (!["fail", "ignore"].includes(layerGone)) throw argumentError("layerGone is fail or ignore.");
  const now = options.now ?? (() => performance.now());
  const started = now();
  const timings = {};
  let switched = null;
  const at = now();
  try {
    switched = await switchOne(options, "remove", { phase: "remove" });
  } catch (error) {
    if (!(layerGone === "ignore" && error?.cause?.code === "LayerUnknown")) throw error;
  }
  timings.switch = Math.round(now() - at);
  const released = [];
  if (release) {
    const releaseStarted = now();
    for (const dlc of dlcs) {
      try {
        const answer = await engine("release-rpf-dlc", { module: moduleName, path: dlcPackPath(gameRoot, dlc.name), bytes: dlc.bytes, sha256: dlc.sha256 }, { signal });
        released.push({ name: dlc.name, released: answer?.released === true, verdict: answer?.verdict ?? null, freedBytes: answer?.freedBytes ?? 0, otherNames: answer?.otherNames === true });
      } catch (error) {
        released.push({ name: dlc.name, released: false, error: error?.code ?? "error" });
      }
      await fs.rmdir(join(dlcPackPath(gameRoot, dlc.name), "..")).catch(() => {});
    }
    timings.release = Math.round(now() - releaseStarted);
  }
  timings.total = Math.round(now() - started);
  return { status: "removed", switched, fingerprint: switched?.fingerprint ?? null, released, timings };
}

/** Освободить место выключенного редукса: слой снят, файлы освобождены. Включить после этого — только загрузкой. */
export const freeReduxDlc = (options) => removeReduxDlc({ ...options, release: true });
