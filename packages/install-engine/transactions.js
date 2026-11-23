import path from "node:path";
import fs from "node:fs/promises";
import { pauseBeforeSwap, transactWithJournal, recoverTransactions } from "./transaction.js";
import { engineSwapItem, newEngineSwapNames } from "./engine-swap.js";
import { expressDlcItem, expressRouteIsOpen } from "./express-item.js";
import { AppendFallbackError, appendJournalItem, planCatalogAppend, removeAppendSidecars, UPDATE_RPF as APPEND_UPDATE_RPF } from "./append-item.js";
import {
  HOLD_KEYS,
  deferredBuildFor,
  isDeferredBuild,
  materializeDeferredBuild,
  opsAllowedFor,
  opsNotice,
  pinOperations,
  pruneRecipes,
  rebaseRecipe,
  recipeFolder,
  recordBuiltFingerprint,
  takeDeferredBuild,
} from "./ops-build.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { composeAstralContentRegistry } from "./registry-composers.js";
import { ensureArchiveResource, composeArchiveResource } from "./resource-composition.js";
import { refreshAstralLayerIdentity } from "./astral-layer.js";
import { recordEngineStep, dropLiveBefore } from "./engine-steps.js";
import { referencedCopies, pruneEngineCache, keepCopies } from "./cache-housekeeping.js";
import { insideGameDiskComposites } from "./composite-home.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { throwIfAborted, assertRuntimeSafe } from "./runtime-guard.js";
import { ensureStoredFile } from "./chunk-store.js";
import { resolveInside } from "./manifest.js";
import { writeState, atomicJson, snapshotTargetJson, readState, serializeMutation, assertAbsoluteInside } from "./engine-state.js";
import { ownRecordValue, setRecordValue, checkedRecordKey } from "./state-record.js";
import { statePaths, targetKeyFor, exists, assertGameRoot, activeBaseline, DEFAULT_DIR } from "./storage-state.js";

const UPDATE_RPF = "update/update.rpf";
const OWN_DLC_HEAD = "update/x64/dlcpacks/astral_";
const OWN_DLC_TAIL = "/dlc.rpf";

const ONLY_UPDATE_RPF = "Подмена движком только для update.rpf: работа трогает и другие архивы — установите её прежним путём.";
const SWAP_NEEDS = "Подмена движком: нужны функция установки и запись переигрывания.";
const GROUP_NEEDS = "Многоархивная подмена: нужны функция установки, запись переигрывания, папка игры и корень точек.";
const GROUP_NEEDS_FILES = "Многоархивная подмена: у каждого архива должен быть готовый файл.";

const isObjectLike = (value) => typeof value === "object" && value !== null;

// Что транзакция берёт у вызывающего «как есть», кроме записи состояния.
const journalWiring = { statePaths, snapshotTarget: snapshotTargetJson, atomicJson, throwIfAborted };

async function liveFileExists(file) {
  try {
    await fs.lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  return true;
}

// ---------- Подготовка списка файлов к транзакции ----------

function keyOrNull(targetId) {
  try {
    return checkedRecordKey(targetId, "Target ID");
  } catch {
    return null;
  }
}

function strictlyInside(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  if (relative === "" || path.isAbsolute(relative)) return false;
  return !relative.startsWith("..");
}

function isLowerAlnum(char) {
  return (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "_";
}

// Собственный DLC Astral: update/x64/dlcpacks/astral_<имя>/dlc.rpf, имя из строчных букв, цифр и «_».
function isOwnDlcPath(relativePath) {
  const lowered = String(relativePath ?? "").toLowerCase();
  const body = lowered.length - OWN_DLC_HEAD.length - OWN_DLC_TAIL.length;
  if (body < 1 || !lowered.startsWith(OWN_DLC_HEAD) || !lowered.endsWith(OWN_DLC_TAIL)) return false;
  return Array.from(lowered.slice(OWN_DLC_HEAD.length, OWN_DLC_HEAD.length + body)).every(isLowerAlnum);
}

// Т-3: такие файлы из папки сборок кладутся жёсткой ссылкой, а не копией.
function shouldLink(item, compositesRoot) {
  if (item.link === true || typeof item.sourcePath !== "string") return false;
  if (!isOwnDlcPath(item.relativePath)) return false;
  return strictlyInside(compositesRoot, item.sourcePath) || insideGameDiskComposites(item.sourcePath);
}

/*
 * «Одна запись вместо двух» переносом (19.11.2026, `docs/INSTALL-ONE-WRITE-1911.md`). Сборка `update.rpf` из папки сборок
 * в игру переносится (`transaction.js: moveStage`), а не копируется: вторая запись двух гигабайт исчезает, байты архива
 * те же по построению, кто бы его ни собрал — движок или помощник. Только сборка (`_rpf-composites`): основа и «игра
 * до Astral» лежат в других папках и не переносятся никогда.
 *
 * Цена — копии сборки в кэше после установки нет (как у установки из операций): «Починить» и возврат к прежнему
 * состоянию собирают архив заново. Выключатель `ASTRAL_INSTALL_MOVE_BUILD`: `1` — включено, по умолчанию выключено.
 */
export const MOVE_BUILD_ENV = "ASTRAL_INSTALL_MOVE_BUILD";
export const moveBuildEnabled = (env = process.env) => ["1", "on", "true"].includes(String(env[MOVE_BUILD_ENV] || "").trim().toLowerCase());

function shouldMove(item, compositesRoot) {
  if (!moveBuildEnabled() || item.link === true || typeof item.sourcePath !== "string") return false;
  if (String(item.relativePath ?? "").toLowerCase() !== UPDATE_RPF) return false;
  return strictlyInside(compositesRoot, item.sourcePath) || insideGameDiskComposites(item.sourcePath);
}

// Т-4: если у элемента нет отпечатка, его может дать верхний слой ресурса в итоговом состоянии.
function fingerprintFromLayer(item, next, targetKey) {
  if (item.sha256 || !item.sourcePath || targetKey === null) return null;
  if (!isObjectLike(next?.targets)) return null;
  const target = ownRecordValue(next.targets, targetKey);
  if (!isObjectLike(target?.resources)) return null;
  const layers = ownRecordValue(target.resources, item.relativePath)?.layers;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const top = layers[layers.length - 1];
  const matches = top && top.cachePath === item.sourcePath;
  return matches && top.sha256 ? top.sha256 : null;
}

function copyItems(affected, context) {
  const copies = [];
  for (const item of affected) {
    const copy = { ...item };
    if (shouldLink(item, context.compositesRoot)) copy.link = true;
    else if (shouldMove(item, context.compositesRoot)) copy.move = true;
    const fromLayer = fingerprintFromLayer(copy, context.next, context.targetKey);
    if (fromLayer) copy.sha256 = fromLayer;
    copies.push(copy);
  }
  return copies;
}

async function assembleStoredSources(affected, signal) {
  for (const item of affected) {
    if (!item.sourcePath) continue;
    await ensureStoredFile(item.sourcePath, { signal });
  }
}

// ---------- Подмена движком ----------

// Запрос к нативному движку: общая оправа для одного архива и для группы.
function engineRequest(engine, signal, first, install) {
  return {
    gameRoot: engine.gameRoot,
    outputArchive: first.livePath,
    archiveTarget: first.relativePath,
    edition: engine.edition,
    operations: [],
    allowDeletes: false,
    signal,
    install,
  };
}

export function engineSwapFor(item, engine, signal = null) {
  const passThrough = item.relativePath !== UPDATE_RPF || !item.sourcePath || item.link === true;
  if (passThrough) return item;
  const ready = typeof engine.install === "function" && isObjectLike(engine.replay);
  if (!ready) throw new Error(SWAP_NEEDS);

  const swapped = engineSwapItem({
    relativePath: item.relativePath,
    livePath: item.livePath,
    pointsRoot: engine.pointsRoot,
    onDone: null,
    run: launch,
  });
  async function launch() {
    const { pointId, stageName } = swapped.engineSwap;
    const sha256 = item.sha256 || (await fingerprintSha256(item.sourcePath));
    const install = {
      gameRoot: engine.gameRoot,
      archive: item.relativePath,
      replay: engine.replay,
      prebuilt: item.sourcePath,
      sha256,
      pointId,
      stageName,
    };
    return engine.install(engineRequest(engine, signal, item, install));
  }
  return swapped;
}

function groupEngineIsReady(engine) {
  if (typeof engine.install !== "function") return false;
  if (!isObjectLike(engine.replay) || typeof engine.gameRoot !== "string") return false;
  return Boolean(engine.pointsRoot);
}

async function groupTarget(item, stageName) {
  const create = !(await liveFileExists(item.livePath));
  const sha256 = item.sha256 || (await fingerprintSha256(item.sourcePath));
  return { archive: item.relativePath, prebuilt: item.sourcePath, sha256, create, stageName };
}

export async function engineGroupFor(affected, engine, signal = null) {
  if (!groupEngineIsReady(engine)) throw new Error(GROUP_NEEDS);
  if (affected.length === 0 || affected.some((item) => !item.sourcePath)) throw new Error(GROUP_NEEDS_FILES);

  const { pointId } = newEngineSwapNames();
  const targets = [];
  const members = [];
  for (const item of affected) {
    const { stageName } = newEngineSwapNames();
    targets.push(await groupTarget(item, stageName));
    members.push(
      engineSwapItem({
        relativePath: item.relativePath,
        livePath: item.livePath,
        pointsRoot: engine.pointsRoot,
        names: { pointId, stageName },
        onDone: null,
        run: () => runOnce(),
      }),
    );
  }

  // Один вызов движка на всю группу: все элементы получают одно и то же обещание.
  let shared = null;
  function runOnce() {
    if (shared === null) {
      const install = { gameRoot: engine.gameRoot, pointId, replay: engine.replay, targets };
      shared = (async () => engine.install(engineRequest(engine, signal, affected[0], install)))();
    }
    return shared;
  }
  return members;
}

// ---------- Установка из операций (одна запись вместо двух, `ops-build.js`) ----------

function opsEngineIsReady(engine) {
  if (typeof engine.install !== "function" || !isObjectLike(engine.replay)) return false;
  return typeof engine.gameRoot === "string" && Boolean(engine.pointsRoot);
}

// Запрос движку: операции вместо готового файла; `writer: "engine"` — помощник блока `install` не знает.
function opsEngineRequest(item, build, engine, signal, operations, install) {
  return {
    mode: "compose",
    gameRoot: engine.gameRoot,
    outputArchive: item.livePath,
    archiveTarget: build.archiveTarget,
    edition: build.edition,
    baseArchive: build.baseArchive,
    operations,
    allowDeletes: build.allowDeletes,
    writer: "engine",
    signal,
    install,
  };
}

// Отпечаток итога и путь рецепта — в состояние до записи (журнал вызывает `onDone` раньше `writeState`).
function recordOpsOutcome(outcome, build, state) {
  if (outcome?.status !== "ready" || !/^[a-f0-9]{64}$/i.test(String(outcome.sha256 || "")))
    throw new Error("Подмена движком: движок не назвал отпечаток собранного архива.");
  recordBuiltFingerprint(state, {
    targetKey: build.targetKey,
    archiveTarget: build.archiveTarget,
    sha256: String(outcome.sha256).toLowerCase(),
    recipe: { path: build.recipeFile, root: build.paths.root },
  });
  const built = state?.targets?.[build.targetKey]?.archives?.[build.archiveTarget]?.lastBuilt;
  if (built) delete built.deferred;
}

/*
 * Установка в два шага (19.11.2026, `INSTALL-RUST-HOLD.md`): `hold` собирает архив в стейдж рядом с живым файлом и не
 * подменяет; приложение перечитывает стейдж теми же проверками, что у прежнего пути (`item.verifyHeld`:
 * `verifyOwnDlcPacks`, `verifyAstralLayers`); чисто — `commit` подменяет, нет — `discard`. Проверка не пропускается.
 *
 * Любой отказ движка, чужой ответ или непрошедшая проверка — не отказ человеку: шаг бросает `opsFallback`, журнал
 * транзакции возвращает игру как была (его снимок живого файла; точка и стейдж движка уходят), а `transact` ставит ту же
 * работу прежним путём и пишет строку в журнал. Отмена человеком — не отказ движка: она уходит наверх как есть.
 */
const HOLD_BUSY_WAITS = [500, 1000, 2000, 3000];
const HOLD_UNFINISHED_TRIES = 3;
const SHA256_TEXT = /^[a-f0-9]{64}$/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAbort = (error, signal) => error?.name === "AbortError" || signal?.aborted === true;
const abortOf = (signal) => (signal?.reason instanceof Error ? signal.reason : new DOMException("Установка отменена пользователем.", "AbortError"));

function opsFallback(reason, cause = null) {
  const detail = cause ? String(cause?.message || cause) : "";
  const error = new Error(`Установка из операций: ${reason}${detail ? ` — ${detail}` : ""}`);
  error.opsFallback = true;
  error.reason = reason;
  if (cause) error.cause = cause;
  if (cause?.engineCode) error.engineCode = cause.engineCode;
  return error;
}

async function installInTwoSteps({ item, engine, signal, requestWith, pointId }) {
  const step = (word) => ({ gameRoot: engine.gameRoot, archive: item.relativePath, [word]: pointId });
  const discard = () => engine.install(requestWith(step("discard"), { bare: true }));

  let held;
  try {
    held = await engine.install(requestWith({ hold: true }));
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    throw opsFallback("движок отказал на первом шаге", error);
  }
  /* Прежний движок ключа `hold` не знает и подменил бы архив сразу: всё, кроме «удержан», — чужой ответ. */
  if (held?.status !== "held" || typeof held.stage !== "string" || !held.stage || !SHA256_TEXT.test(String(held.stageSha256 || "")))
    throw opsFallback(`движок ответил «${String(held?.status)}» вместо «held»`);

  try {
    await item.verifyHeld(held.stage);
    if (signal?.aborted) throw abortOf(signal);
  } catch (error) {
    await discard().catch(() => {});
    if (isAbort(error, signal)) throw error;
    throw opsFallback("проверка собранного архива не прошла", error);
  }

  /* Стенд обрыва: пауза между проверкой и подтверждением (`transaction.js: pauseBeforeSwap`); без переменной — ничего. */
  await pauseBeforeSwap();
  let unfinished = 0;
  for (let busy = 0; ; ) {
    try {
      const outcome = await engine.install(requestWith({ ...step("commit"), stageCheck: "quick" }, { bare: true }));
      if (outcome?.status !== "ready") throw opsFallback(`движок ответил «${String(outcome?.status)}» на подтверждение`);
      /* Подтверждение называет тот же отпечаток, что первый шаг; не назвало — верим стейджу, который проверяли. */
      const sha256 = SHA256_TEXT.test(String(outcome.sha256 || "")) ? outcome.sha256 : held.stageSha256;
      return { ...outcome, sha256: String(sha256).toLowerCase(), held: true };
    } catch (error) {
      if (error?.opsFallback || isAbort(error, signal)) throw error;
      const code = String(error?.engineCode || "");
      if (code === "HoldBusy" && busy < HOLD_BUSY_WAITS.length) {
        /* Над удержанием идёт другой шаг (уборка, читатель): подождать и повторить тот же вызов, установку сорванной не считать. */
        await wait(HOLD_BUSY_WAITS[busy++]);
        continue;
      }
      if (code === "HoldUnfinished") {
        /* Подмена прошла, не лёг конец шага (рецепт): повторный `commit` доводит. Не довёл — архив всё равно новый. */
        if (++unfinished < HOLD_UNFINISHED_TRIES) continue;
        opsNotice({
          level: "warn",
          message: "установка из операций: архив подменён, но рецепт сборки не записан — «Починить» пересоберёт архив заново",
          detail: String(error?.message || error),
        });
        return { status: "ready", sha256: String(held.stageSha256).toLowerCase(), held: true, recipeMissing: true };
      }
      throw opsFallback("движок отказал на подтверждении", error);
    }
  }
}

function engineOpsItem(item, build, engine, signal, state) {
  const swapped = engineSwapItem({
    relativePath: item.relativePath,
    livePath: item.livePath,
    pointsRoot: engine.pointsRoot,
    onDone: (outcome) => recordOpsOutcome(outcome, build, state),
    run: launch,
  });
  async function launch() {
    const { pointId, stageName } = swapped.engineSwap;
    const folder = recipeFolder(build.paths, build.targetKey);
    const operations = await pinOperations(build.operations, { payloadsRoot: build.paths.payloads, folder: path.join(folder, "sources") });
    /* Основа может лежать кусками (`chunk-store.js`): движку нужен файл. */
    await ensureStoredFile(build.baseArchive, { signal });
    const install = {
      gameRoot: engine.gameRoot,
      archive: item.relativePath,
      replay: engine.replay,
      pointId,
      stageName,
      before: "aside",
      saveRecipe: build.recipeFile,
    };
    /* Второй шаг (`commit`, `discard`) берёт операции и запись переигрывания из точки: его запросу они не нужны. */
    const requestWith = (extra, { bare = false } = {}) =>
      bare ? opsEngineRequest(item, build, engine, signal, [], extra) : opsEngineRequest(item, build, engine, signal, operations, { ...install, ...extra });
    const outcome =
      typeof item.verifyHeld === "function"
        ? await installInTwoSteps({ item, engine, signal, requestWith, pointId })
        : await engine.install(requestWith({}));
    await pruneRecipes(folder, { keepFile: build.recipeFile }).catch(() => {});
    return outcome;
  }
  return swapped;
}

/*
 * «Починить» без копии сборки: элемент `{ relativePath, livePath, recipe: { path, root } }` вместо `sourcePath`.
 * Движок повторяет сборку по рецепту (`install.useRecipe`) рядом с живым файлом и сверяет отпечаток результата с
 * тем, что записан в рецепте: другие байты — отказ до подмены, игра не тронута. `root` — корень хранилища, при
 * котором рецепт писался: кэш переехал — пути рецепта переписываются на нынешний корень.
 */
async function sourcesAreThere(recipe, signal, paths) {
  /* Рецепт читает движок и пишет его байты в игру: основа и источники — только из хранилища (как пути слоёв состояния). */
  assertAbsoluteInside(paths.root, recipe.baseArchive);
  await ensureStoredFile(recipe.baseArchive, { signal });
  for (const operation of recipe.operations || []) {
    if (!operation.source) continue;
    assertAbsoluteInside(paths.root, operation.source);
    await ensureStoredFile(operation.source, { signal });
  }
}

function engineRecipeItem(item, engine, signal, paths) {
  const swapped = engineSwapItem({
    relativePath: item.relativePath,
    livePath: item.livePath,
    pointsRoot: engine.pointsRoot,
    onDone: null,
    run: launch,
  });
  async function launch() {
    const { pointId, stageName } = swapped.engineSwap;
    const rebased = await rebaseRecipe(item.recipe.path, { fromRoot: item.recipe.root, toRoot: paths.root });
    const file = rebased || item.recipe.path;
    try {
      const recipe = JSON.parse(await fs.readFile(file, "utf8"));
      await sourcesAreThere(recipe, signal, paths);
      const install = {
        gameRoot: engine.gameRoot,
        archive: item.relativePath,
        replay: engine.replay,
        pointId,
        stageName,
        before: "aside",
        useRecipe: file,
      };
      const request = {
        gameRoot: engine.gameRoot,
        outputArchive: item.livePath,
        archiveTarget: recipe.archiveTarget || item.relativePath,
        edition: recipe.edition ?? engine.edition,
        operations: [],
        allowDeletes: false,
        writer: "engine",
        signal,
        install,
      };
      if (typeof engine.writerFor === "function") {
        const { writer: _forced, ...probe } = request;
        if ((await engine.writerFor({ ...probe, mode: "compose", baseArchive: recipe.baseArchive, operations: recipe.operations })) !== "engine")
          throw new Error("Рецепт сборки нельзя повторить движком: запрос идёт помощнику.");
      }
      return await engine.install(request);
    } finally {
      if (rebased) await fs.rm(rebased, { force: true }).catch(() => {});
    }
  }
  return swapped;
}

/*
 * Отложенные сборки (`composeArchiveResource` с `deferBuild`): движок собирает архив из операций рядом с живым
 * файлом, если выключатель включён для модуля, движок берёт запрос сам (`engine.writerFor` ответил `"engine"`:
 * запрос, которому придётся создать вложенный архив, идёт помощнику, а у него блока `install` нет) и в точке один
 * архив. Иначе сборка делается прежним способом по тому же запросу, и дальше всё как раньше.
 */
async function resolveDeferredBuilds(items, engineInstall, signal, state, paths, expressInstall = null, append = null, opsBuilds = null) {
  const resolved = [];
  for (const item of items) {
    /* Дозапись в живой update.rpf мода каталога (`append-item.js`): решение принято заранее (план установки) или принимается здесь. */
    if (append && !item.recipe && item.relativePath === APPEND_UPDATE_RPF) {
      const build = deferredBuildFor(item.sourcePath);
      /* Решение принято заранее (план установки или начало транзакции), в том числе отказ: второй раз его не считаем и не пишем в журнал. */
      const plan = append.plans.has(item.relativePath)
        ? append.plans.get(item.relativePath)
        : await planCatalogAppend({ appendInstall: append.install, item, build, current: append.current, next: state, targetKey: append.targetKey, affectedCount: append.count, signal });
      if (plan?.kind) {
        if (build) takeDeferredBuild(item.sourcePath);
        resolved.push(
          appendJournalItem({
            plan,
            item,
            appendInstall: append.install,
            next: state,
            targetKey: append.targetKey,
            gameRoot: append.gameRoot,
            signal,
            verifyBuilt: append.verify?.get(item.relativePath) ?? null,
            onProgress: append.onProgress,
          }),
        );
        continue;
      }
      if (plan?.declined && !append.told.has(item.relativePath)) append.install.note?.(`Дозапись в update.rpf не берёт установку (${plan.declined}): прежний путь.`);
    }
    if (item.recipe) {
      if (!engineInstall || !opsEngineIsReady(engineInstall)) throw new Error("Подмена по рецепту: нужны функция установки движка, запись переигрывания, папка игры и корень точек.");
      resolved.push(engineRecipeItem(item, engineInstall, signal, paths));
      continue;
    }
    const build = deferredBuildFor(item.sourcePath);
    if (!build) {
      resolved.push(item);
      continue;
    }
    /* Свой dlc: движок строит архив сразу под живым именем (`express-item.js`), если вызывающий дал экспресс-путь и тот берёт состав. */
    if (await expressRouteIsOpen(item, build, expressInstall)) {
      takeDeferredBuild(item.sourcePath);
      resolved.push(expressDlcItem(item, build, expressInstall, signal, state));
      continue;
    }
    if (opsBuilds && (await opsRouteIsOpen(item, build, engineInstall, signal))) {
      takeDeferredBuild(item.sourcePath);
      opsBuilds.set(item, build);
      resolved.push(engineOpsItem(item, build, engineInstall, signal, state));
      continue;
    }
    await materializeDeferredBuild(item.sourcePath);
    /* Проверка собранного, которую план отложил до стейджа (`verifyHeld`), на прежнем пути идёт по файлу сборки. */
    if (typeof item.verifyHeld === "function") await item.verifyHeld(item.sourcePath);
    resolved.push(item);
  }
  return resolved;
}

/*
 * Открыта ли установка из операций этому архиву. С проверкой между сборкой и подменой (`item.verifyHeld`) путь открыт,
 * только если движок понимает два шага (`engine.installKeys` называет `hold`, `commit`, `discard`): иначе он подменил бы
 * архив, не дав его проверить. Экспорт — для плана установки: он решает, откладывать ли проверку до стейджа.
 */
export async function opsRouteIsOpen(item, build, engine, signal = null) {
  if (!engine || item.relativePath !== UPDATE_RPF || !opsAllowedFor(engine) || !opsEngineIsReady(engine)) return false;
  if (typeof engine.writerFor !== "function") return false;
  if (typeof item.verifyHeld === "function" && !(await opsHoldIsKnown(engine))) return false;
  /* Вопрос «кто напишет» без `writer`: с ним `chooseComposeWriter` отвечает «движок» не глядя на вложенные архивы. */
  const { writer: _forced, ...probe } = opsEngineRequest(item, build, engine, signal, build.operations, null);
  return (await engine.writerFor(probe)) === "engine";
}

/** Движок этой подмены понимает установку в два шага. Не у кого спросить или не ответил — не понимает. */
export async function opsHoldIsKnown(engine) {
  if (typeof engine?.installKeys !== "function") return false;
  try {
    const keys = await engine.installKeys();
    return Array.isArray(keys) && HOLD_KEYS.every((key) => keys.includes(key));
  } catch {
    return false;
  }
}

async function routeThroughEngine(items, engineInstall, signal) {
  /* `opsOnly` — подмену готового файла движок не ведёт (мод каталога): ему отдаётся только установка из операций. */
  if (!engineInstall || engineInstall.opsOnly === true) return items;
  /* Свой dlc, который движок строит на месте, подмене движком не отдаётся: у него своя запись журнала. */
  const own = (item) => item.expressBuild || item.appendBuild;
  const rest = items.filter((item) => !own(item));
  if (rest.length !== items.length) {
    const routed = rest.length ? await routeThroughEngine(rest, engineInstall, signal) : [];
    let next = 0;
    return items.map((item) => (own(item) ? item : routed[next++]));
  }
  if (engineInstall.multi === true) return engineGroupFor(items, engineInstall, signal);
  for (const item of items) {
    if (item.relativePath !== UPDATE_RPF) throw new Error(ONLY_UPDATE_RPF);
  }
  return items.map((item) => engineSwapFor(item, engineInstall, signal));
}

/*
 * Установка из операций без своей точки (`engine.opsOnly`, 19.11.2026). Движок на каждую подмену заводит точку отката: «до»
 * (ссылка в точке или второе имя прежнего архива рядом с живым) и запись переигрывания. У мода каталога и у работы без
 * `ASTRAL_ENGINE_INSTALL` такой точки раньше не было: историю и откат ведёт звено установщика (`recordUpdateHistory`), а
 * вторая точка на тот же переход хоронит под собой всю цепочку (`native-restore-chain.js: locateRestoreChain`). Поэтому
 * после записи состояния точка движка уходит: в папке игры не остаётся ничего, чего не оставлял прежний путь.
 * Не ушла папка точки (её держит сканер) — «до» остаётся при ней: это целая точка, её уберёт библиотека.
 */
const POINT_RETRY = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };

async function forgetOpsPoints(items, engine) {
  if (engine?.opsOnly !== true) return;
  for (const item of items) {
    const swap = item.engineSwap;
    if (!swap?.pointRoot || !swap.beforeBeside) continue;
    await fs.rm(swap.pointRoot, POINT_RETRY).catch(() => {});
    if (await liveFileExists(swap.pointRoot).catch(() => true)) continue;
    await fs.rm(swap.beforeBeside, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

// ---------- После записи состояния ----------

function modIdsOf(target) {
  return Array.isArray(target?.installed) ? target.installed.map((mod) => mod.modId) : [];
}

// Моды, появившиеся и исчезнувшие между двумя списками (порядок — как в состоянии).
function modIdDelta(oldIds, newIds) {
  const had = new Set(oldIds);
  const has = new Set(newIds);
  return {
    installed: newIds.filter((id) => !had.has(id)),
    removed: oldIds.filter((id) => !has.has(id)),
  };
}

// Отпечаток итогового update.rpf: верхний слой, а без слоёв — активная основа.
function finalUpdateHash(target, resource) {
  const layers = Array.isArray(resource?.layers) ? resource.layers : [];
  if (layers.length > 0) return layers[layers.length - 1]?.sha256;
  if (!resource) return undefined;
  const baseline = activeBaseline(target, resource);
  return baseline?.exists ? baseline.sha256 : undefined;
}

// Метку «до операции» забирает recordEngineStep, он же решает, нужно ли звено.
async function recordUpdateHistory(job) {
  const { current, next, affected, targetId, targetKey, paths } = job;
  if (targetKey === null) return;
  const touched = affected.some((item) => item.relativePath === UPDATE_RPF);
  if (!touched) {
    dropLiveBefore({ bases: paths.bases, targetKey });
    return;
  }
  const target = ownRecordValue(next.targets, targetKey);
  const resource = isObjectLike(target?.resources) ? ownRecordValue(target.resources, UPDATE_RPF) : undefined;
  const earlier = isObjectLike(current?.targets) ? ownRecordValue(current.targets, targetKey) : undefined;
  const { installed, removed } = modIdDelta(modIdsOf(earlier), modIdsOf(target));
  try {
    await recordEngineStep({
      bases: paths.bases,
      targetKey,
      gameRoot: target?.gameRoot,
      targetId,
      after: finalUpdateHash(target, resource),
      installed,
      removed,
    });
  } catch {
    // приёмник звеньев не должен ронять установку
  }
}

// Места кэша, на которые прежнее состояние ссылалось, а итоговое — больше нет.
function supersededPlaces(previous, retained) {
  const composites = [];
  const others = [];
  for (const place of previous) {
    if (retained.has(place)) continue;
    (place.includes("_rpf-composites") ? composites : others).push(place);
  }
  return { composites, others };
}

async function pruneSupersededCache({ current, next, stateDir, paths }) {
  try {
    const referenced = referencedCopies(next, { root: paths.root });
    const { composites, others } = supersededPlaces(referencedCopies(current, { root: paths.root }), referenced);
    const evicted = keepCopies(composites);
    await pruneEngineCache({ stateDir, superseded: others.concat(evicted), referenced });
  } catch {
    // уборка кэша необязательна
  }
}

// ---------- Публичный интерфейс ----------

export async function transact({ ...options }) {
  const { current, next, targetId, action, signal, onStaging, onPrepared, onCommitted, engineInstall, expressInstall = null } = options;
  /* Дозапись в update.rpf мода каталога (`append-item.js`): `appendInstall` — движок дозаписи от приложения; `appendPlans` — решения,
     которые установка приняла раньше (по пути архива), `appendVerify` — проверки записанного, `appendProgress` — ход. Без `appendInstall` ничего нет. */
  const { appendInstall = null, appendPlans = null, appendVerify = null, appendProgress = null } = options;
  const { stateDir = DEFAULT_DIR, affected = [] } = options;
  const paths = statePaths(stateDir);
  const targetKey = keyOrNull(targetId);
  /* Дозапись в update.rpf (`append-item.js`): решение — до всего остального. Откат записи не пишет архив, и основу, лежащую кусками,
     собирать из кусков (два гигабайта) для него незачем. Отказ тоже запоминается: второй раз он не считается. */
  const plans = new Map(appendPlans || []);
  /* Отказ, о котором план установки уже сказал, второй раз не печатается. */
  const told = new Set([...(appendPlans || [])].filter(([, plan]) => plan?.declined).map(([relativePath]) => relativePath));
  if (appendInstall && targetKey !== null)
    for (const item of affected) {
      if (item.relativePath !== APPEND_UPDATE_RPF || plans.has(item.relativePath)) continue;
      const plan = await planCatalogAppend({ appendInstall, item, build: deferredBuildFor(item.sourcePath), current, next, targetKey, affectedCount: affected.length, signal });
      plans.set(item.relativePath, plan);
      if (plan?.declined) {
        appendInstall.note?.(`Дозапись в update.rpf не берёт установку (${plan.declined}): прежний путь.`);
        told.add(item.relativePath);
      }
    }
  /* Отложенной сборки ещё нет ни файлом, ни кусками: поднимать из кусков нечего; у дозаписи — тоже. */
  await assembleStoredSources(
    affected.filter((item) => !isDeferredBuild(item.sourcePath) && !plans.get(item.relativePath)?.kind),
    signal,
  );

  const compositesRoot = path.resolve(paths.payloads, "_rpf-composites");
  const prepared = copyItems(affected, { next, targetKey, compositesRoot });
  const append = appendInstall
    ? {
        install: appendInstall,
        plans,
        told,
        current,
        targetKey,
        count: affected.length,
        gameRoot: next?.targets?.[targetKey]?.gameRoot ?? "",
        verify: appendVerify,
        onProgress: appendProgress,
      }
    : null;
  /* Какие архивы взяла установка из операций: при её отказе те же сборки идут прежним путём (второй заход ниже). */
  const opsBuilds = new Map();
  const settled = await resolveDeferredBuilds(prepared, engineInstall, signal, next, paths, expressInstall, append, opsBuilds);
  const routed = await routeThroughEngine(settled, engineInstall, signal);
  const journalOptions = { stateDir, current, next, targetId, action, signal, onStaging, onPrepared, writeState, ...journalWiring };

  /* Следы дозаписи в состоянии нужны, только пока архив — результат дозаписи: полный путь убирает их вместе с файлами журнала. Это и когда
     дозапись у вызывающего выключена, но цепочка от прежней установки стоит («Починить», установка другого мода, выключатель сняли). */
  const chainBefore = targetKey !== null && Boolean(current.targets?.[targetKey]?.archives?.[APPEND_UPDATE_RPF]?.lastBuilt?.append);
  const watching = Boolean(append) || chainBefore;
  const clearChain = (items) => {
    if (!watching || targetKey === null) return;
    for (const item of items)
      if (!item.appendBuild && item.relativePath === APPEND_UPDATE_RPF) delete next.targets?.[targetKey]?.archives?.[item.relativePath]?.lastBuilt?.append;
  };

  try {
    clearChain(routed);
    const savedPoints = structuredClone(next.restorePoints ?? null);
    try {
      await transactWithJournal({ ...journalOptions, affected: routed });
      await forgetOpsPoints(routed, engineInstall);
    } catch (error) {
      /* Дозапись не вышла, запись откатана: тот же итог собирается и ставится прежним путём. Отмена и чужие ошибки идут наружу. */
      /* Установка из операций не прошла (`opsFallback`, `installInTwoSteps`) — то же: журнал уже вернул игру как была. Свой dlc,
         построенный движком на месте, вторым заходом не повторить (его сборка уже забрана): тогда отказ как есть. */
      const opsFell = error?.opsFallback === true && opsBuilds.size > 0 && !settled.some((item) => item.expressBuild);
      if (!(error instanceof AppendFallbackError) && !opsFell) throw error;
      if (savedPoints === null) delete next.restorePoints;
      else next.restorePoints = savedPoints;
      let base = routed;
      if (opsFell) {
        opsNotice({
          level: "warn",
          message: `установка из операций не прошла, ставлю прежним путём: ${error.reason || error.message}`,
          detail: String(error?.cause?.message || error?.message || ""),
        });
        /* Сборка файлом и проверка по файлу; отпечаток собранного теперь в слое состояния — элементы собираются заново. */
        for (const [item, build] of opsBuilds) {
          await build.materialize();
          if (typeof item.verifyHeld === "function") await item.verifyHeld(item.sourcePath);
        }
        base = copyItems(affected, { next, targetKey, compositesRoot });
      }
      const classic = [];
      for (const item of base) classic.push(item.appendBuild ? await item.appendBuild.toClassic() : item);
      const again = await resolveDeferredBuilds(copyItems(classic, { next, targetKey, compositesRoot }), engineInstall, signal, next, paths, expressInstall, null);
      clearChain(again);
      await transactWithJournal({ ...journalOptions, affected: await routeThroughEngine(again, engineInstall, signal) });
    }
    /* Архив заменён целиком (прежний путь): файлы журнала движка относились к прежнему файлу. */
    if (watching)
      for (const item of routed)
        if (item.relativePath === APPEND_UPDATE_RPF && !next.targets?.[targetKey]?.archives?.[item.relativePath]?.lastBuilt?.append) await removeAppendSidecars(item.livePath);
  } catch (error) {
    if (targetKey !== null) dropLiveBefore({ bases: paths.bases, targetKey });
    throw error;
  }

  await onCommitted?.();
  await recordUpdateHistory({ current, next, affected, targetId, targetKey, paths });
  await refreshAstralLayerIdentity({ state: next, targetId, affected, stateDir, resolveInside, writeState, ownRecordValue });
  await pruneSupersededCache({ current, next, stateDir, paths });
  return next;
}

export async function recoverPendingTransactions({ stateDir = DEFAULT_DIR } = {}) {
  const wiring = { statePaths, readState, writeState };
  return recoverTransactions({ stateDir, ...wiring });
}

export function recoverInterruptedTransactions({ stateDir } = {}) {
  const job = () => recoverPendingTransactions({ stateDir });
  return serializeMutation(job);
}

async function readPointState(stateFile) {
  const empty = { targets: {} };
  let text;
  try {
    text = await fs.readFile(stateFile, "utf8");
  } catch {
    return empty;
  }
  const parsed = JSON.parse(text);
  if (!isObjectLike(parsed)) return empty;
  return isObjectLike(parsed.targets) ? parsed : empty;
}

export async function enginePoint({ stateDir, stateFile, targetId, affected, engine, action, signal = null }) {
  await assembleStoredSources(affected, signal);
  const members = await engineGroupFor(affected, engine, signal);
  const { pointId, pointRoot } = members[0].engineSwap;

  const current = await readPointState(stateFile);
  const next = structuredClone(current);
  const saveToPointFile = (state) => atomicJson(stateFile, state);
  await transactWithJournal({
    stateDir,
    current,
    next,
    targetId,
    affected: members,
    action,
    signal,
    writeState: saveToPointFile,
    ...journalWiring,
  });
  return { pointId, pointRoot, state: next };
}

// Набор функций для слоя Astral: порядок ключей важен.
export function astralLayerDependencies() {
  const sha256File = (file) => fingerprintSha256(file);
  return Object.fromEntries([
    ["assertGameRoot", assertGameRoot],
    ["assertRuntimeSafe", assertRuntimeSafe],
    ["checkedRecordKey", checkedRecordKey],
    ["composeArchiveResource", composeArchiveResource],
    ["exists", exists],
    ["composeAstralContentRegistry", composeAstralContentRegistry],
    ["ensureArchiveResource", ensureArchiveResource],
    ["ownRecordValue", ownRecordValue],
    ["readState", readState],
    ["rebaseDirectUpdateIfNeeded", rebaseDirectUpdateIfNeeded],
    ["recoverPendingTransactions", recoverPendingTransactions],
    ["resolveInside", resolveInside],
    ["serializeMutation", serializeMutation],
    ["setRecordValue", setRecordValue],
    ["sha256File", sha256File],
    ["statePaths", statePaths],
    ["targetKeyFor", targetKeyFor],
    ["transact", transact],
    ["writeState", writeState],
  ]);
}
