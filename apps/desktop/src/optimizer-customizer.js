import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  compileOptimizerPlan,
  optimizerPatchManifest,
  OPTIMIZER_TARGETS,
  requiredBases,
  revertOptimizerBases,
} from "@modovik/optimizer/compile.js";
import { normalizeOptimizerProfile, OPTIMIZER_TWEAK_MAP } from "@modovik/optimizer";
import { inspectProfile } from "@modovik/install-engine";
import { PROTECTED_UPDATE_COPY } from "@modovik/install-engine/direct-base-cleanup.js";
import { ensureStoredFile } from "@modovik/install-engine/chunk-store.js";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { writeGameSettingsValues } from "./game-settings.js";
import { appLog } from "./app-log.js";

const BASES_DIR = "optimizer-bases";
const PATCHES_DIR = "optimizer-patches";
const PAYLOAD_DIR = "payload";
const PROFILE_BYTES_MAX = 65536;
const PATCH_TITLE = "Astral optimizer";
const ARCHIVE_NAME = "update/update.rpf";
const ANSWER_FIELDS = { platform: "Majestic / GTA5RP", edition: "Legacy" };
const NOTHING_TO_ROLL_BACK = "Возвращать нечего: оптимизация не установлена.";
// «not … found» в одной строке либо русское «не найден» — хост говорит, что записи нет
const MISSING_ENTRY = /not.*found|не найден/i;

const noValue = () => null;
const swallow = () => {};
const isMissingEntry = (error) => MISSING_ENTRY.test(String(error?.message || ""));
const decodeText = (bytes) => new TextDecoder().decode(bytes);
const backupPathOf = (stateDir) => path.join(path.resolve(stateDir || os.tmpdir()), "optimizer", "settings.xml");
const fileNameOf = (file) => file.file;
const linesOf = (file) => file.lines;

function withDefaults(tools) {
  const defaults = {
    native: callNativeEngine,
    archiveSupport: provisionArchiveSupport,
    settingsWriter: writeGameSettingsValues,
    stock: readStockBases,
    log: appLog,
  };
  return Object.assign(defaults, tools);
}

function resolveGameRoot(input) {
  const entered = input?.gameRoot || "";
  const typed = String(entered).trim();
  const usable = typed !== "" && path.isAbsolute(typed);
  if (usable) return path.resolve(typed);
  throw new Error("Выберите папку GTA V Legacy.");
}

function readProfile(value) {
  const isPlainObject = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isPlainObject) throw new TypeError("Профиль оптимизации обязателен.");
  const json = JSON.stringify(value);
  const jsonBytes = Buffer.byteLength(json, "utf8");
  if (jsonBytes > PROFILE_BYTES_MAX) throw new RangeError("Профиль оптимизации превышает 64 КБ.");
  return normalizeOptimizerProfile(JSON.parse(json));
}

/** Результат записи настроек; сбой записи не отменяет остальное, а кладётся в ответ. */
async function guardedSettings(write) {
  try {
    return await write();
  } catch (error) {
    const reason = error?.message || error;
    return { failed: String(reason) };
  }
}

function allNothingToChange(skipped) {
  if (skipped.length === 0) return false;
  for (const entry of skipped) {
    if (entry.reason !== "nothing-to-change") return false;
  }
  return true;
}

// --- штатные тексты из копии update.rpf «до Astral» ---
/*
 * Бета 09.11.2026: выключение карточек оптимизации падало «Штатного … для
 * возврата нет: Astral не нашёл копии игры до своих правок», хотя копия
 * лежала на месте и читалась. Прежде каждый шаг поиска молча отдавал «нет»,
 * и по журналу нельзя было сказать, какой. Теперь:
 *   • копия ищется по записи установки в состоянии движка, а если запись не
 *     нашлась — по папкам установок в хранилище (`bases/<установка>/`), кроме
 *     тех, что состояние отдаёт другой игре;
 *   • сбой каждого шага (состояние, сборка копии, ключи, открытие, чтение
 *     записи) остаётся в следе, и пустой итог пишется в журнал приложения.
 */

const sameFolder = (left, right) => path.resolve(String(left || "")).toLowerCase() === path.resolve(String(right || "")).toLowerCase();
const describeError = (error) => String(error?.message || error || "без текста");
const copyIn = (stateDir, id) => path.join(stateDir, "bases", id, PROTECTED_UPDATE_COPY);
const hasStoredCopy = async (file) =>
  (await fs.stat(file).catch(noValue))?.isFile() === true ||
  (await fs.stat(`${file}.chunks.json`).catch(noValue))?.isFile() === true;

/** Копии «до Astral» для этой игры, по порядку доверия; `trace` — что не сошлось. */
export async function stockCopyCandidates(stateDir, gameRoot, trace = []) {
  const state = await inspectProfile({ stateDir }).catch((error) => {
    trace.push(`состояние движка не прочиталось: ${describeError(error)}`);
    return null;
  });
  const targets = Object.entries(state?.targets ?? {});
  const ours = targets.filter(([, entry]) => sameFolder(entry?.gameRoot, gameRoot)).map(([id]) => id);
  const foreign = new Set(targets.filter(([, entry]) => !sameFolder(entry?.gameRoot, gameRoot)).map(([id]) => id.toLowerCase()));
  if (ours.length === 0) trace.push(`в состоянии движка нет установки для ${gameRoot} (установок: ${targets.length})`);

  const candidates = ours.map((id) => copyIn(stateDir, id));
  const folders = await fs.readdir(path.join(stateDir, "bases"), { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    /* Папка установки может быть ссылкой (перенос кэша, junction на другой диск). */
    if (!(folder.isDirectory() || folder.isSymbolicLink()) || foreign.has(folder.name.toLowerCase())) continue;
    const file = copyIn(stateDir, folder.name);
    if (candidates.some((known) => sameFolder(known, file))) continue;
    if (await hasStoredCopy(file)) candidates.push(file);
  }
  if (candidates.length === 0) trace.push("в хранилище нет копии update.rpf до Astral");
  return candidates;
}

async function stockTextOf(archive, item, trace) {
  const inside = item.target.replace(/^update:\//, "");
  try {
    return decodeText(await archive.read(inside));
  } catch (error) {
    trace.push(`${inside}: ${describeError(error)}`);
    return null;
  }
}

/* Тексты из одной копии; `null` — копия не годится (не собралась, не открылась). */
async function readStockCopy(copy, targets, archiveKeys, trace) {
  const ready = await ensureStoredFile(copy).catch((error) => {
    trace.push(`${copy}: копия не собралась (${describeError(error)})`);
    return null;
  });
  if (ready !== true) {
    if (ready === false) trace.push(`${copy}: файла нет`);
    return null;
  }
  let archive;
  try {
    archive = await openRpfFile(copy, { keys: archiveKeys, nested: false });
  } catch (error) {
    trace.push(`${copy}: не открылась (${describeError(error)})`);
    return null;
  }
  const texts = {};
  try {
    for (const item of targets) texts[item.id] = await stockTextOf(archive, item, trace);
  } finally {
    await archive.close?.();
  }
  return texts;
}

async function readStockBases(targets, { gameRoot, keys, stateDir, log = appLog }) {
  const trace = [];
  let texts = {};
  if (!stateDir) trace.push("нет папки хранилища");
  else {
    const candidates = await stockCopyCandidates(stateDir, gameRoot, trace);
    let archiveKeys = null;
    if (candidates.length > 0)
      archiveKeys = await keysFromDirectory(keys).catch((error) => {
        trace.push(`ключи архивов из ${keys || "(нет папки)"} не прочитались: ${describeError(error)}`);
        return null;
      });
    for (const copy of archiveKeys ? candidates : []) {
      const found = await readStockCopy(copy, targets, archiveKeys, trace);
      if (found && Object.values(found).some(Boolean)) {
        texts = found;
        break;
      }
    }
  }
  const missing = targets.filter((item) => !texts[item.id]).map((item) => item.file);
  if (missing.length > 0)
    log.record({
      level: "warn",
      source: "install",
      message: `оптимизация: нет штатного ${missing.join(", ")} из копии игры до Astral`,
      detail: trace.join("\n"),
    });
  return texts;
}

// --- основа россыпи: на чём стояли наши правки ---
/*
 * 16.11.2026, журнал beta.106: у человека `update.rpf` подменён чужим редуксом
 * со своим procedural.meta. Первая карточка «Улиц» легла поверх файла редукса,
 * а следующая смена карточек отказывала «россыпь менял кто-то ещё»: возврат
 * умел сверять живой файл только со ШТАТНЫМ из копии игры, а живой — это файл
 * редукса плюс наши правки, со штатным он не сойдётся никогда.
 *
 * Теперь после каждой записи россыпи рядом с копией `settings.xml`
 * (`<хранилище>/optimizer/`) лежит запись «в этой папке игры наши правки ставились
 * на такой текст». Возврат (`revertOptimizerBases`, поле `before`) сверяет живой
 * файл и с ней: сошёлся — возвращает к этой основе, чужие правки остаются. Запись
 * устарела (файл с тех пор менял кто-то ещё) — проверка просто не сойдётся, и
 * отказ прежний. Когда правок россыпи в игре больше нет, запись убирается.
 */

const SCATTER_MEMORY_VERSION = 1;

function scatterMemoryPathOf(stateDir, gameRoot) {
  const key = createHash("sha256").update(path.resolve(gameRoot).toLowerCase()).digest("hex").slice(0, 16);
  return path.join(path.dirname(backupPathOf(stateDir)), `scatter-base-${key}.json`);
}

/** Основа россыпи для этой папки игры: `{ procedural }` или пусто. Нет записи, она битая или чужая — как будто её нет. */
async function readScatterMemory(stateDir, gameRoot) {
  if (!stateDir) return {};
  try {
    const record = JSON.parse(await fs.readFile(scatterMemoryPathOf(stateDir, gameRoot), "utf8"));
    const usable =
      record?.version === SCATTER_MEMORY_VERSION &&
      sameFolder(record.gameRoot, gameRoot) &&
      typeof record.procedural === "string" &&
      record.procedural !== "";
    return usable ? { procedural: record.procedural } : {};
  } catch {
    return {};
  }
}

async function saveScatterMemory(stateDir, gameRoot, text) {
  const file = scatterMemoryPathOf(stateDir, gameRoot);
  const staged = `${file}.${randomUUID()}.tmp`;
  await ensureFolder(path.dirname(file));
  try {
    const record = { version: SCATTER_MEMORY_VERSION, gameRoot: path.resolve(gameRoot), procedural: text };
    await fs.writeFile(staged, JSON.stringify(record), "utf8");
    await fs.rename(staged, file);
  } catch (error) {
    await fs.rm(staged, { force: true }).catch(swallow);
    throw error;
  }
}

/**
 * После записи патча: основа россыпи, на которую легли правки, — в хранилище; легла
 * сама основа (правок россыпи больше нет) — запись убирается. Патч без россыпи запись
 * не трогает: россыпь в игре осталась как была. Сбой записи установку не роняет.
 */
async function rememberScatterBase(run) {
  const written = run.write.find((file) => file.id === OPTIMIZER_TARGETS.procedural.id);
  if (!written || !run.stateDir) return;
  const base = run.returned?.bases?.procedural;
  try {
    if (typeof base === "string" && base !== "" && base !== written.text)
      await saveScatterMemory(run.stateDir, run.gameRoot, base);
    else await fs.rm(scatterMemoryPathOf(run.stateDir, run.gameRoot), { force: true });
  } catch (error) {
    run.kit.log.record({
      level: "warn",
      source: "install",
      message: `оптимизация: не удалось запомнить основу россыпи (${describeError(error)}); установка идёт дальше`,
    });
  }
}

// --- подготовка патча: шаги над общим состоянием `run` ---

function parseRequest(run) {
  const { input } = run;
  run.gameRoot = resolveGameRoot(input);
  const requested = input.profile ?? { enabled: [] };
  run.profile = readProfile(requested);
  run.revert = null;
  if (input?.revert) run.revert = readProfile(input.revert);
  run.revertRequired = input.revertRequired !== false;
  run.forceScatter = input.forceScatter === true;
  run.locale = input.locale === "en" ? "en" : "ru";
  const profileEmpty = !run.profile.enabled.length;
  const revertEmpty = !run.revert?.enabled.length;
  if (profileEmpty && revertEmpty) throw new Error("В профиле оптимизации ничего не выбрано.");
}

async function askKeys(run) {
  const request = { keys: run.input?.keys, stateDir: run.stateDir, provision: run.kit.archiveSupport };
  run.keys = await archiveKeysDirectory(request);
}

function archiveNeeded(run) {
  if (requiredBases(run.profile).length > 0) return true;
  return Boolean(run.revert) && requiredBases(run.revert).length > 0;
}

async function fetchEntryText(run, item, folder) {
  const { native } = run.kit;
  const output = path.join(folder, item.file);
  const request = { gameRoot: run.gameRoot, entry: item.target, output, keys: run.keys };
  try {
    await native("read-archive-file", request, run.context);
    const text = await fs.readFile(output, "utf8");
    return text;
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
}

function ensureFolder(dir) {
  return fs.mkdir(dir, { recursive: true });
}

function dropFolder(folder) {
  return fs.rm(folder, { recursive: true, force: true }).catch(swallow);
}

async function readBaseText(run, item) {
  const root = run.stateDir || os.tmpdir();
  const folder = path.join(root, BASES_DIR, randomUUID());
  await ensureFolder(folder);
  try {
    return await fetchEntryText(run, item, folder);
  } finally {
    await dropFolder(folder);
  }
}

async function gatherBases(run) {
  run.targets = [];
  if (archiveNeeded(run)) run.targets = Object.values(OPTIMIZER_TARGETS);
  for (const item of run.targets) run.live[item.id] = await readBaseText(run, item);
  if (run.targets.length === 0) return;
  const stockReader = run.kit.stock;
  run.stock = await stockReader(run.targets, { gameRoot: run.gameRoot, keys: run.keys, stateDir: run.stateDir });
  run.before = await readScatterMemory(run.stateDir, run.gameRoot);
}

const isScatterTweak = (id) => OPTIMIZER_TWEAK_MAP[id]?.recipe?.kind === "procedural";
const scatterKey = (profile) => [...new Set((profile?.enabled ?? []).filter(isScatterTweak))].sort().join("|");
const withoutScatter = (profile) => profile && { ...profile, enabled: profile.enabled.filter((id) => !isScatterTweak(id)) };

/*
 * Россыпь, которая не меняется (бета 09.11.2026). Смена профиля снимает
 * прежний целиком и ставит новый — и «Тени» или «Погода», которые россыпи
 * не касаются, требовали штатный procedural.meta: без копии игры до Astral
 * переключение падало. Если копии россыпи нет, а правки россыпи в старом и
 * новом профиле одни и те же, россыпь в игре уже такая, как надо: её не
 * снимаем и не ставим заново (повторное наложение множителей без штатной
 * основы удвоило бы их). Копия есть — путь прежний: возврат к штатной и
 * наложение заново, это заодно лечит «дрейф» прежних версий.
 */
function scatterStays(run) {
  if (!run.revert || run.stock?.procedural) return false;
  const key = scatterKey(run.revert);
  return key !== "" && key === scatterKey(run.profile);
}

function revertAndCompile(run) {
  const { locale } = run;
  const keepScatter = scatterStays(run);
  const revert = keepScatter ? withoutScatter(run.revert) : run.revert;
  const profile = keepScatter ? withoutScatter(run.profile) : run.profile;
  const strict = Boolean(revert?.enabled.length) && run.revertRequired;
  run.returned = revertOptimizerBases({
    profile: revert,
    bases: run.live,
    stock: run.stock,
    /* Россыпь, которая остаётся как стоит, ничем не возвращается: основа тоже не нужна. */
    before: keepScatter ? {} : run.before,
    locale,
    strict,
    forceScatter: run.forceScatter,
  });
  run.compiled = profile;
  run.plan = compileOptimizerPlan({ profile, bases: run.returned.bases, locale });
}

/** Что лягет в патч и что скажем про «уже стоит». */
function selectFiles(run) {
  const { plan, returned, live } = run;
  /* Профиль, который собирался: без россыпи, если она остаётся как стоит. */
  const profile = run.compiled ?? run.profile;
  const standing = allNothingToChange(plan.skipped);
  const nothingFits = Boolean(profile.enabled.length) && plan.empty && !standing;
  if (nothingFits) throw new Error("Ни одна выбранная правка не подошла к файлам этой сборки игры.");
  const queue = [];
  const planned = new Set();
  for (const file of plan.files) {
    queue.push(file);
    planned.add(file.id);
  }
  for (const file of returned.files) {
    if (!planned.has(file.id)) queue.push(file);
  }
  run.write = [];
  for (const file of queue) {
    if (file.text !== live[file.id]) run.write.push(file);
  }
  const hadPlanFiles = plan.files.length > 0;
  run.alreadyInGame = run.write.length === 0 && (hadPlanFiles || standing);
}

function writeNew(file, text) {
  return fs.writeFile(file, text, { flag: "wx" });
}

async function writePatchFolder(run) {
  if (run.write.length === 0) return "";
  const base = path.resolve(run.stateDir || os.tmpdir());
  const folder = path.join(base, PATCHES_DIR, randomUUID());
  const payloadDir = path.join(folder, PAYLOAD_DIR);
  await ensureFolder(payloadDir);
  for (const file of run.write) await writeNew(path.join(payloadDir, file.file), file.text);
  const manifest = optimizerPatchManifest({ name: PATCH_TITLE, files: run.write });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeNew(path.join(folder, "manifest.json"), manifestText);
  return folder;
}

const FILE_FIELDS = ["id", "file", "target", "size", "sha256", "changed", "lines", "missing"];

function fileRow(file) {
  return Object.fromEntries(FILE_FIELDS.map((field) => [field, file[field]]));
}

function summarize(run, patch) {
  const { plan } = run;
  const fromPlan = { game: plan.game, skipped: plan.skipped, changes: plan.changes };
  const { gameRoot, profile, alreadyInGame } = run;
  const files = run.write.map(fileRow);
  let totalBytes = 0;
  for (const file of run.write) totalBytes += file.size;
  const revertedFiles = run.returned.files;
  const reverted = {
    files: revertedFiles.map(fileNameOf),
    lines: revertedFiles.flatMap(linesOf),
    kept: run.returned.kept,
  };
  return { patch, gameRoot, profile, files, ...fromPlan, totalBytes, alreadyInGame, reverted };
}

function beginRun(input, context, stateDir, tools) {
  return { input, context, stateDir, kit: withDefaults(tools), live: {}, stock: {}, before: {} };
}

async function completeRun(run) {
  const steps = [parseRequest, askKeys, gatherBases, revertAndCompile, selectFiles];
  for (const step of steps) await step(run);
  const patch = await writePatchFolder(run);
  return summarize(run, patch);
}

// --- действия ---

async function installPatch(kit, prepared, stateDir, context) {
  const { native, archiveSupport } = kit;
  const support = await archiveSupport({ stateDir });
  const request = { patch: prepared.patch, gameRoot: prepared.gameRoot };
  request.archiveFix = path.join(support.directory, "ArchiveFix.exe");
  request.keys = support.directory;
  return native("install-rpf-patch", request, context);
}

async function storeGameValues(kit, prepared, settingsPath, stateDir) {
  const { values } = prepared.game;
  if (Object.keys(values).length === 0 || !settingsPath) return null;
  const { settingsWriter } = kit;
  return guardedSettings(() => settingsWriter(values, settingsPath, backupPathOf(stateDir)));
}

async function validatePatch(kit, prepared, context) {
  const { native } = kit;
  if (!prepared.patch) return null;
  return await native("validate-rpf-patch", { patch: prepared.patch }, context);
}

export async function planOptimizerProfile(input, context, stateDir, tools = {}) {
  const run = beginRun(input, context, stateDir, tools);
  const prepared = await completeRun(run);
  const answer = { ...prepared, validation: await validatePatch(run.kit, prepared, context) };
  Object.assign(answer, ANSWER_FIELDS);
  answer.archive = ARCHIVE_NAME;
  return answer;
}

export async function applyOptimizerProfile(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, settingsPath, ...tools } = {},
) {
  if (input?.checkOnly) {
    await assertRuntimeSafety?.(resolveGameRoot(input));
    return { ready: true };
  }
  const run = beginRun(input, context, stateDir, tools);
  const prepared = await completeRun(run);
  await assertRuntimeSafety?.(prepared.gameRoot);
  const installed = prepared.patch ? await installPatch(run.kit, prepared, stateDir, context) : undefined;
  if (prepared.patch) await rememberScatterBase(run);
  const settings = await storeGameValues(run.kit, prepared, settingsPath, stateDir);
  const firstId = installed?.restorePointId || installed?.id;
  const restorePointId = String(firstId || "");
  return { ...installed, ...prepared, restorePointId, settings, ...ANSWER_FIELDS };
}

function previousValues(given) {
  if (given && typeof given === "object") return given;
  return {};
}

export async function rollbackOptimizerProfile(input, context, stateDir, { settingsPath, ...tools } = {}) {
  const { native, settingsWriter } = withDefaults(tools);
  const typedPoint = input?.restorePointId || "";
  const pointId = String(typedPoint).trim();
  const previous = previousValues(input?.previous);
  const outcome = { restored: null, settings: null };
  if (pointId) outcome.restored = await native("restore-rpf-point", { restorePointId: pointId }, context);
  const hasPrevious = Object.keys(previous).length > 0;
  if (hasPrevious && settingsPath) {
    outcome.settings = await guardedSettings(() => settingsWriter(previous, settingsPath, ""));
  }
  if (!outcome.restored && !outcome.settings) throw new Error(NOTHING_TO_ROLL_BACK);
  return { restored: outcome.restored, settings: outcome.settings, targets: Object.keys(OPTIMIZER_TARGETS) };
}
