// «Экспресс-установка своего dlc»: растительность, дороги и другие наборы, которые кладут в игру свои
// `update/x64/dlcpacks/<имя>/dlc.rpf`, одной оркестровкой команд движка (`layout-rpf-plan`, `build-rpf-dlc`,
// `verify-rpf-dlc`, `release-rpf-dlc`, `cancel-rpf-dlc`, `compose-rpf` с дозаписью и слоем, `switch-rpf-layers`,
// `settle-rpf-journals`). Записка — `docs/INSTALL-RUST-EXPRESS.md`.
//
// Что отличает от старого пути (сборка в стейдже, копия в игру, пересборка update.rpf):
//   1. dlc.rpf пишется сразу на место (`<цель>.astral-part` -> печать -> имя), а не собирается и потом копируется;
//   2. dlc-архивы набора пишутся одновременно (число задаётся); вложенные внутри набора — тоже (`nestedMode: "staged"`) или строятся
//      прямо внутри корня (`nestedMode: "inplace"`): тогда промежуточных файлов нет и каждый байт ложится на диск один раз;
//   3. пишет движок потоком, SHA-256 считается по ходу записи (второго прохода нет, кроме названной сверки);
//   4. update.rpf получает строки подключения дозаписью со слоем (килобайты), а не пересборкой.
//
// Порядок безопасен для игры: update.rpf правится последним и только когда ВСЕ dlc целы на месте и
// прошли сверку (движок: `verify-rpf-dlc`; приложение: крючок `verify` со строгим читателем). Любой сбой или
// отмена до этого — готовые части убраны, update.rpf не открывался. Сбой самой дозаписи — движок доводит
// оборванную запись (`settle-rpf-journals`); если она всё же довелась до конца, dlc остаются.
//
// Модуль чистый: движок приходит функцией `engine(command, request, { signal, args, onProgress })`, которая
// возвращает `result` ответа (и бросает ошибку с `code` на `ok: false`). Нигде не зовётся, пока его не включит
// вызывающий: выключатель `ASTRAL_ENGINE_EXPRESS_DLC=<модули>` (`expressDlcEnabled`), по умолчанию выключен.
// Видимых пользователю строк нет: у ошибок только `code` и служебное сообщение.
import fs from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { rpfTailEnabled } from "./rpf-tail-switch.js";

export const EXPRESS_DLC_ENV = "ASTRAL_ENGINE_EXPRESS_DLC";

// Потолок длины одного архива: чуть ниже предела формата (блок 0x7fffff на 512 байт). Штатный потолок движка
// (3,3 ГБ) меньше наборов растительности, поэтому ключ `maxBytes` называем всегда.
export const EXPRESS_MAX_BYTES = 4_000_000_000;
const MIB = 1024 * 1024;
const PACK_NAME = /^[A-Za-z0-9_]{1,64}$/;
const BUILD_VERIFY = new Set(["table", "sample", "full"]);
const CONFIRM = new Set(["intact", "stat", "none"]);
// Как строятся вложенные архивы dlc:
//   "staged"  — каждый вложенный отдельным файлом в `scratchDir`, потом корень берёт их готовыми (каждый байт вложенных
//               ложится на диск дважды); работает на любом движке с `build-rpf-dlc`;
//   "inplace" — вложенные строятся прямо внутри корня одной командой (`build-rpf-dlc` с `nested: "inplace"`): промежуточных
//               файлов нет, каждый байт пишется один раз. Нужен движок, который знает ключ `nested` (проверяется по ответу).
export const EXPRESS_NESTED_MODES = ["inplace", "staged"];
export const EXPRESS_NESTED_DEFAULT = "inplace";
const NESTED_MODE = new Set(EXPRESS_NESTED_MODES);

export function expressDlcEnabled(moduleName, env = process.env) {
  const wanted = String(moduleName ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return String(env[EXPRESS_DLC_ENV] ?? "")
    .split(",")
    .some((item) => item.trim().toLowerCase() === wanted);
}

export class ExpressDlcError extends Error {
  constructor(code, message, { cause = null, phase = "", cleanup = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ExpressDlcError";
    this.code = code;
    this.phase = phase;
    this.cleanup = cleanup;
  }
}

export const dlcPackPath = (gameRoot, name) => join(String(gameRoot), "update", "x64", "dlcpacks", String(name), "dlc.rpf");

/**
 * Запись списка для `build-rpf-dlc` по файлу на диске: ресурс (RSC7, слова из заголовка) или двоичный.
 * Нужна стендам и тестам; в приложении вид и слова берутся из подписанного манифеста пакета.
 */
export async function describeFile(file, entryPath, extra = {}) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    const resource = bytesRead === 16 && head.toString("latin1", 0, 4) === "RSC7";
    return {
      path: entryPath,
      kind: resource ? "resource" : "binary",
      size,
      ...(resource ? { words: [head.readUInt32LE(8), head.readUInt32LE(12)] } : {}),
      source: file,
      ...extra,
    };
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------------------------------------------------

const abortError = (signal) => {
  const error = new Error("Express dlc: cancelled.");
  error.name = "AbortError";
  error.code = "CANCELLED";
  if (signal?.reason !== undefined) error.reason = signal.reason;
  return error;
};

const isCancel = (error) => error?.name === "AbortError" || error?.code === "CANCELLED";

// Не больше `max` задач одновременно (Infinity — без предела); очередь по порядку прихода.
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

const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);

function checkEntries(entries, where, { inplace = false } = {}) {
  if (!Array.isArray(entries)) throw new ExpressDlcError("ARGUMENTS", `Express dlc: ${where}: entries is a list.`, { phase: "arguments" });
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string" || !Number.isFinite(entry.size) || (entry.size > 0 && !entry.source)) {
      throw new ExpressDlcError("ARGUMENTS", `Express dlc: ${where}: an entry needs path, size and source.`, { phase: "arguments" });
    }
    // «на месте»: у запроса одна запись на файл, вид и источник движок требует у каждой (пустому файлу источник тоже нужен)
    if (inplace && ((entry.kind !== "resource" && entry.kind !== "binary") || !entry.source)) {
      throw new ExpressDlcError("ARGUMENTS", `Express dlc: ${where}: an in-place entry needs kind (resource or binary) and source.`, { phase: "arguments" });
    }
  }
}

function checkPacks(packs, { inplace = false } = {}) {
  if (!Array.isArray(packs) || packs.length === 0) throw new ExpressDlcError("ARGUMENTS", "Express dlc: packs is a non-empty list.", { phase: "arguments" });
  const seen = new Set();
  for (const pack of packs) {
    if (!pack || !PACK_NAME.test(String(pack.name ?? ""))) throw new ExpressDlcError("ARGUMENTS", "Express dlc: a pack name is letters, digits and underscores.", { phase: "arguments" });
    const key = pack.name.toLowerCase();
    if (seen.has(key)) throw new ExpressDlcError("ARGUMENTS", "Express dlc: a pack name repeats.", { phase: "arguments" });
    seen.add(key);
    checkEntries(pack.entries ?? [], `${pack.name} root`, { inplace });
    const nestedNames = new Set();
    for (const nested of pack.nested ?? []) {
      if (!nested || !/\.rpf$/i.test(String(nested.name ?? "")) || String(nested.name).includes("/")) {
        throw new ExpressDlcError("ARGUMENTS", "Express dlc: a nested archive name is a file name ending with .rpf.", { phase: "arguments" });
      }
      const nestedKey = nested.name.toLowerCase();
      if (nestedNames.has(nestedKey) || (pack.entries ?? []).some((entry) => entry.path.toLowerCase() === nestedKey)) {
        throw new ExpressDlcError("ARGUMENTS", "Express dlc: a nested archive name repeats.", { phase: "arguments" });
      }
      nestedNames.add(nestedKey);
      checkEntries(nested.entries, `${pack.name}/${nested.name}`, { inplace });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {Function} options.engine        `(command, request, { signal, args, onProgress }) => result`
 * @param {string}   options.gameRoot      корень игры (на нём живут `update/update.rpf` и `update/x64/dlcpacks`)
 * @param {Array}    options.packs         `[{ name, entries, nested: [{ name, entries }] }]`: имя папки в `dlcpacks`,
 *                                         записи корня dlc.rpf (кроме вложенных архивов) и вложенные архивы со своими записями.
 *                                         Запись: `{ path, kind, size, source, words?, unpacked?, sha256? }` (как у `build-rpf-dlc`)
 * @param {string}   [options.scratchDir]  где лежат вложенные архивы до встраивания (тот же том, что игра: иначе лишняя копия); нужен
 *                                         только при `nestedMode: "staged"`, «на месте» временных файлов нет
 * @param {string}   options.moduleName    слово модуля для выключателей движка (`ASTRAL_ENGINE_NEWDLC` и др.)
 * @param {object}   [options.update]      дозапись update.rpf: `{ operations, layerId, workId?, pointId?, baseSha256?, archive?, command?, args? }`
 * @param {number}   [options.packsAtOnce=2]   сколько наборов собираются одновременно
 * @param {number}   [options.nestedAtOnce=2]  сколько вложенных архивов одного набора собираются одновременно (Infinity — все);
 *                                         при `nestedMode: "inplace"` не используется (вложенные идут внутри одной команды корня)
 * @param {string}   [options.nestedMode=EXPRESS_NESTED_DEFAULT]  `"inplace"`: вложенные архивы строятся внутри корня одной командой
 *                                         (`build-rpf-dlc` с `nested: "inplace"`), каждый байт пишется на диск один раз; `"staged"`:
 *                                         вложенные отдельными файлами в `scratchDir`, потом корень берёт их готовыми (байты вложенных
 *                                         ложатся на диск дважды)
 * @param {string}   [options.buildVerify="table"]  сверка при печати у движка: `table` | `sample` | `full`
 * @param {object}   [options.checkpoint]   `{ files, bytes }`: как часто движок сбрасывает файл на диск и пишет кадр в маркер (по умолчанию у «staged»
 *                                         256 файлов или 32 МиБ, у «inplace» 4096 файлов или 256 МиБ); реже — быстрее запись, но после
 *                                         обрыва дольше пересчитывать
 * @param {string}   [options.confirm="intact"]     сверка готового корня до включения: `intact` (длина и SHA-256 с диска) | `stat` (только длина) | `none`
 * @param {Function} [options.verify]      крючок строгого читателя приложения: `async ({ packs: [{ name, path, bytes, sha256 }] })`; бросил — всё убрано
 * @param {AbortSignal} [options.signal]
 */
export async function installExpressDlc(options) {
  const {
    engine,
    gameRoot,
    packs,
    scratchDir,
    moduleName,
    update = null,
    packsAtOnce = 2,
    nestedAtOnce = 2,
    nestedMode = EXPRESS_NESTED_DEFAULT,
    buildVerify = "table",
    confirm = "intact",
    verify = null,
    signal = null,
    maxBytes = EXPRESS_MAX_BYTES,
    checkpoint = null,
    reserveBytes = 512 * MIB,
    spaceCheck = true,
    onPhase = null,
    onProgress = null,
    now = () => performance.now(),
  } = options ?? {};
  if (typeof engine !== "function") throw new ExpressDlcError("ARGUMENTS", "Express dlc: no engine function.", { phase: "arguments" });
  if (!NESTED_MODE.has(nestedMode)) throw new ExpressDlcError("ARGUMENTS", "Express dlc: unknown nested mode.", { phase: "arguments" });
  const inplace = nestedMode === "inplace";
  // временная папка нужна только вложенным, что строятся отдельными файлами; «на месте» её нет вовсе
  if (!gameRoot || (!inplace && !scratchDir) || !moduleName) throw new ExpressDlcError("ARGUMENTS", "Express dlc: gameRoot, scratchDir (staged) and moduleName are required.", { phase: "arguments" });
  if (!BUILD_VERIFY.has(buildVerify) || !CONFIRM.has(confirm)) throw new ExpressDlcError("ARGUMENTS", "Express dlc: unknown verify mode.", { phase: "arguments" });
  checkPacks(packs, { inplace });
  if (update) {
    if (!Array.isArray(update.operations) || update.operations.length === 0 || !update.layerId) {
      throw new ExpressDlcError("ARGUMENTS", "Express dlc: update needs operations and layerId.", { phase: "arguments" });
    }
  }

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

  // Всё, что может остаться на диске после сбоя.
  const parts = [];
  const track = (part) => {
    parts.push(part);
    return part;
  };
  const model = packs.map((pack) => ({
    pack,
    name: pack.name,
    output: dlcPackPath(gameRoot, pack.name),
    scratch: inplace ? null : join(String(scratchDir), pack.name),
    nested: (pack.nested ?? []).map((nested) => ({ nested, name: nested.name, output: inplace ? null : join(String(scratchDir), pack.name, nested.name) })),
  }));

  // Ждём ВСЕ задачи фазы, а не первую упавшую: сборки, которых гасит первый сбой, должны успеть остановиться
  // (процесс движка убит, ответа нет), и только потом идёт уборка, иначе она наступит им на ноги.
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
  const FAILED = { plan: "PLAN_FAILED", build: "BUILD_FAILED", confirm: "VERIFY_FAILED", update: "UPDATE_FAILED" };
  const fail = async (error) => {
    control.abort(error);
    const report = await removeParts(parts, { engine, moduleName, now });
    if (error instanceof ExpressDlcError) {
      error.cleanup ??= report;
      throw error;
    }
    const cancelled = isCancel(error);
    throw new ExpressDlcError(cancelled ? "CANCELLED" : FAILED[current] ?? "BUILD_FAILED", cancelled ? "Express dlc: cancelled." : `Express dlc: ${current}: ${error?.message ?? error}`, {
      cause: error,
      phase: current,
      cleanup: report,
    });
  };

  const results = [];
  try {
    // ---- 1. план: места тел до первого байта, место на томе ----
    current = "plan";
    phase("plan");
    const planStarted = now();
    if (inplace) {
      // Одна раскладка на набор: длина корня и каждого вложенного известна до первого байта. Движок, который не знает ключ
      // `nested`, ответит обычной раскладкой без него: останавливаемся до первого байта, а не строим не тот архив.
      await settle(
        model.map(async (item) => {
          item.flat = [...(item.pack.entries ?? []), ...item.nested.flatMap((slot) => slot.nested.entries.map((entry) => ({ ...entry, path: `${slot.name}/${entry.path}` })))];
          item.plan = await call("layout-rpf-plan", { entries: item.flat, archiveName: "dlc.rpf", output: item.output, maxBytes, nested: "inplace" });
          if (item.plan?.nested !== "inplace") {
            throw new ExpressDlcError("ENGINE_UNSUPPORTED", "Express dlc: the engine does not know nested inplace; use nestedMode staged.", { phase: "plan" });
          }
        }),
      );
    } else {
      await settle(
        model.map(async (item) => {
          item.plan = {};
          await settle(
            item.nested.map(async (slot) => {
              const answer = await call("layout-rpf-plan", { entries: slot.nested.entries, archiveName: slot.name, output: slot.output, maxBytes });
              slot.plan = answer;
            }),
          );
          const rootEntries = [...(item.pack.entries ?? []), ...item.nested.map((slot) => ({ path: slot.name, kind: "binary", size: slot.plan.bytes, source: slot.output }))];
          item.rootEntries = rootEntries;
          item.plan = await call("layout-rpf-plan", { entries: rootEntries, archiveName: "dlc.rpf", output: item.output, maxBytes });
        }),
      );
    }
    for (const item of model) {
      if (item.plan.outputExists && !item.plan.building) {
        throw new ExpressDlcError("OUTPUT_EXISTS", `Express dlc: ${item.name}/dlc.rpf already exists.`, { phase: "plan" });
      }
    }
    if (spaceCheck) {
      const slots = inplace ? [] : model.flatMap((item) => item.nested);
      const needed = sum(model, (item) => item.plan.space?.needed) + sum(slots, (slot) => slot.plan.space?.needed);
      const frees = [...model.map((item) => item.plan.space?.free), ...slots.map((slot) => slot.plan.space?.free)].filter(Number.isFinite);
      if (frees.length > 0 && needed + reserveBytes > Math.min(...frees)) {
        throw new ExpressDlcError("NO_SPACE", "Express dlc: the volume cannot hold the archives.", { phase: "plan" });
      }
    }
    if (!inplace) {
      // Остатки прежнего прогона: недостроенное продолжится само (`mode: auto`), готовый вложенный в нашей папке — лишний.
      for (const item of model) {
        for (const slot of item.nested) {
          if (slot.plan.outputExists && !slot.plan.building) await fs.rm(slot.output, { force: true });
        }
      }
    }
    lap("plan", planStarted);

    // ---- 2. сборка: вложенные внутри набора и наборы между собой одновременно ----
    current = "build";
    phase("build");
    const buildStarted = now();
    const perPack = limiter(packsAtOnce);
    if (inplace) {
      // Один вызов на набор: вложенные строятся внутри корня, промежуточных файлов нет, каждый байт пишется один раз.
      await settle(
        model.map((item) =>
          perPack(async () => {
            // очередь после сбоя или отмены доходит до этой задачи, когда движок уже не нужен: ничего не начато, убирать нечего
            if (guard.aborted) throw abortError(guard);
            const packStarted = now();
            const root = track({ kind: "root", pack: item.name, output: item.output, state: "started", bytes: item.plan.bytes, sha256: null });
            const answer = await call("build-rpf-dlc", {
              output: item.output,
              archiveName: "dlc.rpf",
              entries: item.flat,
              nested: "inplace",
              verify: buildVerify,
              maxBytes,
              mode: "auto",
              onCancel: "remove",
              ...(checkpoint ? { checkpoint } : {}),
            });
            if (!answer?.sealed || answer.nested !== "inplace" || answer.bytes !== item.plan.bytes || !answer.sha256) {
              throw new ExpressDlcError("BUILD_FAILED", `Express dlc: ${item.name}/dlc.rpf was not sealed as planned.`, { phase: "build" });
            }
            root.state = "sealed";
            root.sha256 = answer.sha256;
            item.answer = answer;
            item.rootMs = Math.round(now() - packStarted);
            item.packMs = item.rootMs;
          }),
        ),
      );
    } else {
      await settle(
        model.map((item) =>
          perPack(async () => {
            const perNested = limiter(nestedAtOnce);
            const packStarted = now();
            await fs.mkdir(item.scratch, { recursive: true });
            const sealed = await settle(
              item.nested.map((slot) =>
                perNested(async () => {
                  // очередь после сбоя или отмены доходит до этой задачи, когда движок уже не нужен: ничего не начато, убирать нечего
                  if (guard.aborted) throw abortError(guard);
                  const part = track({ kind: "nested", pack: item.name, output: slot.output, state: "started" });
                  const at = now();
                  const answer = await call("build-rpf-dlc", {
                    output: slot.output,
                    archiveName: slot.name,
                    entries: slot.nested.entries,
                    verify: buildVerify,
                    maxBytes,
                    mode: "auto",
                    onCancel: "remove",
                    ...(checkpoint ? { checkpoint } : {}),
                  });
                  if (!answer?.sealed || answer.bytes !== slot.plan.bytes || !answer.sha256) {
                    throw new ExpressDlcError("BUILD_FAILED", `Express dlc: ${item.name}/${slot.name} was not sealed as planned.`, { phase: "build" });
                  }
                  part.state = "sealed";
                  slot.answer = answer;
                  slot.ms = Math.round(now() - at);
                  return { path: slot.name, kind: "binary", size: answer.bytes, source: slot.output, sha256: answer.sha256 };
                }),
              ),
            );
            const entries = [...(item.pack.entries ?? []), ...sealed];
            const root = track({ kind: "root", pack: item.name, output: item.output, state: "started", bytes: item.plan.bytes, sha256: null });
            const at = now();
            const answer = await call("build-rpf-dlc", {
              output: item.output,
              archiveName: "dlc.rpf",
              entries,
              verify: buildVerify,
              maxBytes,
              mode: "auto",
              onCancel: "remove",
              ...(checkpoint ? { checkpoint } : {}),
            });
            if (!answer?.sealed || answer.bytes !== item.plan.bytes || !answer.sha256) {
              throw new ExpressDlcError("BUILD_FAILED", `Express dlc: ${item.name}/dlc.rpf was not sealed as planned.`, { phase: "build" });
            }
            root.state = "sealed";
            root.sha256 = answer.sha256;
            item.answer = answer;
            item.rootMs = Math.round(now() - at);
            // вложенные нужны только корню; убрать, как только он запечатан (ниже пик места)
            for (const slot of item.nested) {
              await fs.rm(slot.output, { force: true });
              const part = parts.find((candidate) => candidate.output === slot.output);
              if (part) part.state = "gone";
            }
            await fs.rmdir(item.scratch).catch(() => {});
            item.packMs = Math.round(now() - packStarted);
          }),
        ),
      );
    }
    lap("build", buildStarted);

    // ---- 3. проверка до включения: корень цел на диске, строгий читатель приложения доволен ----
    current = "confirm";
    phase("confirm");
    const confirmStarted = now();
    if (confirm !== "none") {
      await settle(
        model.map(async (item) => {
          if (confirm === "stat") {
            const stat = await fs.stat(item.output).catch(() => null);
            if (!stat?.isFile() || stat.size !== item.answer.bytes) {
              throw new ExpressDlcError("VERIFY_FAILED", `Express dlc: ${item.name}/dlc.rpf has a wrong length.`, { phase: "confirm" });
            }
            item.confirmed = { verdict: "stat", bytes: stat.size };
            return;
          }
          const verdict = await call("verify-rpf-dlc", { path: item.output, bytes: item.answer.bytes, sha256: item.answer.sha256 });
          if (verdict?.verdict !== "intact") {
            throw new ExpressDlcError("VERIFY_FAILED", `Express dlc: ${item.name}/dlc.rpf is ${verdict?.verdict ?? "unknown"} (${verdict?.reason ?? ""}).`, { phase: "confirm" });
          }
          item.confirmed = verdict;
        }),
      );
    }
    if (typeof verify === "function") {
      await verify({ packs: model.map((item) => ({ name: item.name, path: item.output, bytes: item.answer.bytes, sha256: item.answer.sha256 })) });
    }
    lap("confirm", confirmStarted);

    // ---- 4. update.rpf: дозапись со слоем, только теперь ----
    let updateAnswer = null;
    let recovered = null;
    if (update) {
      current = "update";
      phase("update");
      const updateStarted = now();
      if (guard.aborted) throw abortError(guard);
      try {
        // Дозапись крошечная и сама крашустойчива (журнал): отмену во время неё не передаём.
        updateAnswer = await engine(update.command ?? "compose-rpf", updateRequest({ gameRoot, moduleName, update }), { onProgress, args: update.args });
      } catch (error) {
        recovered = await settleAfterFailure({ engine, gameRoot, update });
        if (recovered?.finished) {
          updateAnswer = { recoveredByRestart: true, settle: recovered.answer };
        } else {
          throw new ExpressDlcError("UPDATE_FAILED", `Express dlc: update.rpf: ${error?.message ?? error}`, { cause: error, phase: "update" });
        }
      }
      lap("update", updateStarted);
    }
    timings.total = Math.round(now() - started);
    phase("done");

    for (const item of model) {
      results.push({
        name: item.name,
        path: item.output,
        bytes: item.answer.bytes,
        sha256: item.answer.sha256,
        hashStreamed: item.answer.hashStreamed === true,
        verified: item.answer.verified ?? null,
        resumed: { files: item.answer.resumedFiles ?? 0, bytes: item.answer.resumedBytes ?? 0 },
        confirmed: item.confirmed ?? null,
        timings: { plan: item.plan.timings?.plan ?? null, root: item.rootMs, pack: item.packMs, engine: item.answer.timings ?? null },
        nested: item.nested.map((slot) =>
          inplace
            ? {
                // вложенный строился внутри корня: отдельного файла, ответа и отпечатка у него нет, длина — из раскладки
                name: slot.name,
                bytes: item.plan.archives?.find((row) => row.path === slot.name)?.bytes ?? null,
                sha256: null,
                bytesWritten: null,
                resumed: { files: 0, bytes: 0 },
                hashStreamed: false,
                inplace: true,
                ms: null,
                timings: null,
              }
            : {
                name: slot.name,
                bytes: slot.answer.bytes,
                sha256: slot.answer.sha256,
                bytesWritten: slot.answer.bytesWritten ?? null,
                resumed: { files: slot.answer.resumedFiles ?? 0, bytes: slot.answer.resumedBytes ?? 0 },
                hashStreamed: slot.answer.hashStreamed === true,
                inplace: false,
                ms: slot.ms,
                timings: slot.answer.timings ?? null,
              },
        ),
        bytesWritten: item.answer.bytesWritten ?? null,
      });
    }
    return {
      status: "installed",
      packs: results,
      update: updateAnswer,
      recovered: recovered?.finished ? "finished" : null,
      bytes: expressBytes({ model, updateAnswer, confirm, inplace }),
      settings: { packsAtOnce, nestedAtOnce, nestedMode, buildVerify, confirm, checkpoint },
      timings,
    };
  } catch (error) {
    return await fail(error);
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

// Какие байты ушли в диск и пришли с него по спискам и ответам движка (замер диска делает стенд). «Читалось»:
// источники, вложенные архивы при встраивании (они тоже источники корня; «на месте» их нет: вложенные читаются из пакета
// один раз), проход по готовому файлу при печати («на месте», `verified: full`: файл читается из кэша системы) и сверка
// `intact` целиком; сверка при печати у вложенных отдельными файлами (`table` — голова, `sample` — вложенные и каждое
// десятое тело, `full` — файл) называется режимом, не числом.
function expressBytes({ model, updateAnswer, confirm, inplace = false }) {
  const nested = model.flatMap((item) => item.nested);
  const nestedWritten = inplace ? 0 : sum(nested, (slot) => slot.answer.bytesWritten);
  const rootWritten = sum(model, (item) => item.answer.bytesWritten);
  const nestedSourceBytes = sum(nested, (slot) => sum(slot.nested.entries, (entry) => entry.size));
  // отдельными файлами: записи корня включают готовые вложенные архивы; на месте: только свои записи основы
  const rootSourceBytes = inplace ? sum(model, (item) => sum(item.pack.entries ?? [], (entry) => entry.size)) : sum(model, (item) => sum(item.rootEntries, (entry) => entry.size));
  const intactBytes = confirm === "intact" ? sum(model, (item) => item.answer.bytes) : 0;
  const sealPassBytes = inplace ? sum(model, (item) => item.answer.bytes) : 0;
  const updateWritten = Number(updateAnswer?.bytesWritten) || 0;
  return {
    written: nestedWritten + rootWritten + updateWritten,
    writtenNested: nestedWritten,
    writtenRoot: rootWritten,
    writtenUpdate: updateWritten,
    readSources: nestedSourceBytes + rootSourceBytes,
    readNestedSources: nestedSourceBytes,
    readRootSources: rootSourceBytes,
    readSeal: sealPassBytes,
    readConfirm: intactBytes,
    archiveBytes: sum(model, (item) => item.answer.bytes),
  };
}

// Запрос дозаписи: те же ключи, что у `compose-rpf` с `install.write: "append"` и слоем.
export function updateRequest({ gameRoot, moduleName, update }) {
  const archive = update.archive ?? "update/update.rpf";
  const install = {
    gameRoot: String(gameRoot),
    archive,
    replay: { module: moduleName, ...(update.workId ? { workId: update.workId } : {}) },
    write: "append",
    layer: { id: update.layerId },
    /* Длина файла держит ключ прежней головы (R4, `INSTALL-RUST-REDUX-R4.md`): игра выбирает ключ оглавления по длине
       `update.rpf` на диске (проверено в GTA V 17.11.2026 — файл с одним лишним байтом она не открывает), поэтому между
       ростом файла и записью новой головы длина обязана давать прежний ключ. Движок без этого ключа запроса его не
       знает и молча пропускает; принявший отвечает полем `keyPadBytes`. */
    keepKey: true,
    /* Хвост после последней записи (`rpf-tail-switch.js`): маленькое тело последним роняло сюжет. */
    ...(rpfTailEnabled() ? { tailPad: true } : {}),
  };
  if (update.pointId) install.pointId = update.pointId;
  if (update.baseSha256) install.baseSha256 = update.baseSha256;
  return { mode: "compose", archiveTarget: archive, allowDeletes: false, operations: update.operations, install };
}

async function settleAfterFailure({ engine, gameRoot, update }) {
  try {
    const answer = await engine("settle-rpf-journals", { gameRoot: String(gameRoot), archives: [update.archive ?? "update/update.rpf"] }, {});
    return { finished: Number(answer?.counts?.finished) > 0, answer };
  } catch (error) {
    return { finished: false, answer: null, error };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Уборка недоделанного и готового (до включения)
// ---------------------------------------------------------------------------------------------------------------------

async function removeParts(parts, { engine, moduleName }) {
  const report = { released: [], cancelled: [], removed: [], leftovers: [] };
  for (const part of [...parts].reverse()) {
    if (part.state === "gone") continue;
    try {
      if (part.state === "sealed" && part.kind === "root") {
        const answer = await engine("release-rpf-dlc", { module: moduleName, path: part.output, bytes: part.bytes, sha256: part.sha256 }, {});
        if (answer?.released === false && answer?.verdict !== "missing") report.leftovers.push({ path: part.output, reason: answer?.verdict ?? "kept" });
        else report.released.push(part.output);
        continue;
      }
      if (part.state === "sealed" && part.kind === "nested") {
        // свой временный файл в своей папке, его длина и хэш только что сошлись с ответом движка: читать ещё раз незачем
        await fs.rm(part.output, { force: true });
        report.removed.push(part.output);
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
    }
  }
  for (const part of parts) {
    if (part.kind === "nested") await fs.rmdir(join(part.output, "..")).catch(() => {});
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// Снятие и повторное включение
// ---------------------------------------------------------------------------------------------------------------------

function layerSwitchRequest({ gameRoot, moduleName, mode, layerId, archive = "update/update.rpf", baseSha256 }) {
  return {
    gameRoot: String(gameRoot),
    archive,
    [mode]: [layerId],
    replay: { module: moduleName },
    module: moduleName,
    ...(baseSha256 ? { baseSha256 } : {}),
  };
}

/**
 * Снять: слой выключается сменой оглавления (update.rpf как до установки, килобайты), потом свои dlc «освобождаются»
 * (`release-rpf-dlc`: файл убирается, только если он доказанно наш). Слой выключен — игра dlc уже не видит, поэтому
 * отказ уборки файлов (занят, чужой) не страшен: слой остаётся выключенным, файлы перечислены в ответе.
 * `release: false` — только выключить (dlc остаются на диске и включаются мгновенно).
 */
export async function removeExpressDlc({ engine, gameRoot, packs, layerId, moduleName, archive, baseSha256, release = true, signal = null, args, now = () => performance.now() }) {
  if (typeof engine !== "function" || !layerId || !moduleName || !gameRoot) throw new ExpressDlcError("ARGUMENTS", "Express dlc: engine, gameRoot, layerId and moduleName are required.", { phase: "arguments" });
  const started = now();
  const timings = {};
  const at = now();
  const switched = await engine("switch-rpf-layers", layerSwitchRequest({ gameRoot, moduleName, mode: "disable", layerId, archive, baseSha256 }), { signal, args });
  timings.switch = Math.round(now() - at);
  const released = [];
  if (release) {
    const releaseStarted = now();
    for (const pack of packs ?? []) {
      try {
        const answer = await engine("release-rpf-dlc", { module: moduleName, path: dlcPackPath(gameRoot, pack.name), bytes: pack.bytes, sha256: pack.sha256 }, { signal });
        released.push({ name: pack.name, released: answer?.released === true, verdict: answer?.verdict ?? null, freedBytes: answer?.freedBytes ?? 0, otherNames: answer?.otherNames === true });
      } catch (error) {
        released.push({ name: pack.name, released: false, error: error?.code ?? "error" });
      }
    }
    timings.release = Math.round(now() - releaseStarted);
  }
  timings.total = Math.round(now() - started);
  return { status: "removed", switched, released, timings };
}

/**
 * Включить снова: dlc уже лежат — каждый сверяется (`verify-rpf-dlc`), потом слой включается сменой оглавления.
 * Не цел или нет файла — отказ `NOT_INTACT` до того, как оглавление тронуто: пакет собирается заново (`installExpressDlc`).
 */
export async function enableExpressDlc({ engine, gameRoot, packs, layerId, moduleName, archive, baseSha256, signal = null, args, now = () => performance.now() }) {
  if (typeof engine !== "function" || !layerId || !moduleName || !gameRoot) throw new ExpressDlcError("ARGUMENTS", "Express dlc: engine, gameRoot, layerId and moduleName are required.", { phase: "arguments" });
  const started = now();
  const timings = {};
  const verifyStarted = now();
  const verdicts = await Promise.all(
    (packs ?? []).map(async (pack) => {
      const answer = await engine("verify-rpf-dlc", { module: moduleName, path: dlcPackPath(gameRoot, pack.name), bytes: pack.bytes, sha256: pack.sha256 }, { signal });
      return { name: pack.name, verdict: answer?.verdict ?? "unknown", reason: answer?.reason ?? null };
    }),
  );
  timings.verify = Math.round(now() - verifyStarted);
  const bad = verdicts.filter((item) => item.verdict !== "intact");
  if (bad.length > 0) throw new ExpressDlcError("NOT_INTACT", "Express dlc: a dlc archive is not intact; build it again.", { phase: "enable", cleanup: { bad } });
  const at = now();
  const switched = await engine("switch-rpf-layers", layerSwitchRequest({ gameRoot, moduleName, mode: "enable", layerId, archive, baseSha256 }), { signal, args });
  timings.switch = Math.round(now() - at);
  timings.total = Math.round(now() - started);
  return { status: "enabled", verdicts, switched, timings };
}
