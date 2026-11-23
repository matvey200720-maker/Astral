// Окно «Что стоит в игре»: единый список работ мастерской и модов каталога, план и снятие нескольких вещей.
// Менеджер ничего не пересобирает сам: он читает стопку точек и состояние движка, а снимает через library-removal.
import fs from "node:fs/promises";
import path from "node:path";
import { inOperation } from "@modovik/install-engine/operation-scope.js";
import * as libraryStatus from "./library-status.js";
import * as chainApi from "./native-restore-chain.js";
import * as libraryRemoval from "./library-removal.js";

const META_FILE = "astral-meta.json";
const DEFAULT_TITLE = "Работа мастерской";
const UNKNOWN_ITEM_MESSAGE = "Такой вещи уже нет в списке.";
const GAME_RUNNING_MESSAGE = "Закройте GTA V: Astral меняет файлы, которые игра держит открытыми.";
const BLOCK_OPTIONS = ["with-covering", "restore-vanilla"];
const ROLLBACK_CODES = ["ASTRAL_LIBRARY_REPLAY_FAILED", "ASTRAL_LIBRARY_RECOMPOSE_FAILED"];
const PLAN_REMOVABLE = new Set(["remove", "forget", "missing"]);
const PLAN_MOD_REMOVABLE = new Set(["remove", "missing"]);

// Подсказки окна запоминаются в точке в таком порядке ключей и с такими пределами.
const HINT_LIMITS = [
  ["title", 200],
  ["source", 20],
  ["buildId", 96],
  ["buildName", 200]
];

// Названия работ по семействам папок патчей. Таблица — обычный объект: имя из прототипа даёт не строку.
const FAMILY_NAMES = {
  "Мини-карта": ["minimap-patches", "astral-minimap-patches"],
  "Прицел": ["reticle-patches", "astral-reticle-patches"],
  "Небо": ["timecycle-patches"],
  "Килл-эффект": ["kill-effect-patches"],
  "Эффекты попадания на экране": ["screen-hit-patches"],
  "Полоска HP": ["target-hp-patches"],
  "Групповые метки": ["group-marker-patches"],
  "Настройка автомобиля": ["wheel-smoke-patches"],
  "Фонари": ["lamp-studio-patches"],
  "Эффекты": ["ptfx-patches"],
  "Вода": ["water-patches"],
  "Растительность": ["vegetation-patches"],
  "Оптимизация": ["optimizer-patches"]
};
const FAMILY_TITLES = Object.fromEntries(
  Object.entries(FAMILY_NAMES).flatMap(([title, families]) => families.map((family) => [family, title]))
);

// ------------------------------------------------------------ малые помощники

// Строка по краям обрезается и ограничивается; всё, что не строка, — пусто.
function clip(value, limit = 200) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function lowered(value) {
  return String(value || "").toLowerCase();
}

function hintsOf(ctx) {
  const hints = ctx?.hints;
  return hints && typeof hints === "object" ? hints : {};
}

// Объект из названных полей источника, в порядке списка (поля без значения тоже входят).
const pickFields = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));

// Объект из пар «ключ → значение», где значение есть (не пусто), в порядке пар.
const presentFields = (pairs) => Object.fromEntries(pairs.filter(([, value]) => value));

// Результат работы либо пустой объект, если она отказала.
async function orEmpty(work) {
  try {
    return await work();
  } catch {
    return {};
  }
}

// Файл памяти точки; нет папки, файла или он не разобрался — пусто.
function readMeta(directory) {
  return orEmpty(async () => JSON.parse(await fs.readFile(path.join(directory, META_FILE), "utf8")) || {});
}

async function storeMeta(directory, merged) {
  const file = path.join(directory, META_FILE);
  const staged = `${file}.${process.pid}.stage`;
  await fs.writeFile(staged, JSON.stringify(merged, null, 2));
  await fs.rename(staged, file);
}

// Подсказка окна должна пережить чистку кэша: что новое, дописывается в файл памяти точки.
async function rememberHint(directory, hint) {
  const fresh = presentFields(HINT_LIMITS.map(([key, limit]) => [key, clip(hint?.[key], limit)]));
  const keys = Object.keys(fresh);
  if (keys.length === 0) return;
  try {
    const known = await readMeta(directory);
    if (keys.every((key) => known[key] === fresh[key])) return;
    await storeMeta(directory, { ...known, ...fresh });
  } catch {
    // запись памяти необязательна: окно всё равно получит подсказку в ответе
  }
}

const isReachable = (target) => fs.access(target).then(() => true, () => false);
const sizeOrZero = (file) => fs.stat(file).then((info) => info.size, () => 0);

// Сколько весят файлы внутри папки: сначала её файлы по порядку, затем подпапки — последняя первой.
async function sizeInside(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const folders = [];
  let own = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) folders.push(full);
    else if (entry.isFile()) own += await sizeOrZero(full);
  }
  let nested = 0;
  for (const folder of folders.reverse()) nested += await sizeInside(folder);
  return own + nested;
}

// Размер папки патча: null — папки нет.
async function folderSize(root) {
  return (await isReachable(root)) ? sizeInside(root) : null;
}

// Слои мода по всем записям всех архивов цели, в порядке обхода.
function layersOfMod(target, modId) {
  return Object.values(target?.archives || {})
    .flatMap((archive) => Object.values(archive?.entries || {}))
    .flatMap((entry) => entry?.layers || [])
    .filter((layer) => layer?.modId === modId);
}

const regularFileSize = (file) => fs.stat(file).then((info) => (info.isFile() ? info.size : 0), () => 0);

async function cacheSize(target, modId) {
  const paths = new Set(layersOfMod(target, modId).map((layer) => layer.cachePath).filter(Boolean));
  if (paths.size === 0) return null;
  const sizes = [];
  for (const file of paths) sizes.push(await regularFileSize(file));
  return sizes.reduce((sum, size) => sum + size, 0);
}

// Записи update.rpf, которые мод держит сверху и должен был оставить в архиве целыми.
function expectedEntriesOf(target, modId) {
  const archive = target?.archives?.[chainApi.UPDATE_ARCHIVE];
  return Object.entries(archive?.entries || {}).flatMap(([name, entry]) => {
    const top = (entry?.layers || []).at(-1);
    const sha256 = lowered(top?.sha256);
    return top?.modId === modId && !top.merge && sha256 ? [{ name, sha256 }] : [];
  });
}

// ------------------------------------------------------------- работы мастерской

const goneByGame = () => ({ state: "removed-by-game", reason: "archive-reverted" });

// Состояние работы: первое подошедшее правило решает, иначе — архив изменился.
const WORK_STATES = [
  [(point) => point.dropped === "game-update", () => ({ state: "needs-repair", reason: "game-updated" })],
  [(point, place) => place === "applied" || place === "buried", () => ({ state: "ok" })],
  [(point, place, archiveStatus) => place === "detached" || archiveStatus === "reverted", goneByGame]
];

function workState(point, place, archiveStatus) {
  const rule = WORK_STATES.find(([applies]) => applies(point, place, archiveStatus));
  return rule ? rule[1]() : { state: "needs-repair", reason: "archive-changed" };
}

// Причины, по которым работу нельзя снять отдельно; первая сработавшая и называет причину.
const NOT_REMOVABLE = [
  ["foreign-archive", (point) => point.otherArchives?.length],
  ["game-updated", (point) => point.dropped === "game-update"],
  ["buried", (point, place) => place === "buried"],
  ["unknown", (point, place) => place === "unknown"]
];

function workRemovable(point, place) {
  const blocking = NOT_REMOVABLE.find(([, applies]) => applies(point, place));
  return blocking ? { ok: false, reason: blocking[0] } : { ok: true };
}

const resolvePatchFolder = (point, run) => libraryRemoval.resolvePatchDirectory(point.patch, run.tools.stateDir);

async function describeWork(point, next, run) {
  const hint = run.hints[`native:${point.id}`] || {};
  await rememberHint(point.directory, hint);
  const meta = await readMeta(point.directory);
  const folder = await resolvePatchFolder(point, run);
  const family = lowered(path.basename(path.dirname(String(point.patch || ""))));

  const buildId = hint.buildId || meta.buildId;
  const buildName = hint.buildName || meta.buildName;
  const source = { type: hint.source || meta.source || "workshop", ...presentFields([["buildId", buildId], ["buildName", buildName]]) };

  const place = run.chain.state.get(point.id);
  const { state, reason } = workState(point, place, run.status.status);
  const sizeBytes = folder ? await folderSize(folder) : null;
  return Object.fromEntries([
    ["id", `native:${point.id}`],
    ["kind", "work"],
    ["title", clip(hint.title) || meta.title || FAMILY_TITLES[family] || DEFAULT_TITLE],
    ["source", source],
    ["installedAt", point.createdAt || null],
    ["sizeBytes", sizeBytes],
    ["state", state],
    ...(reason ? [["reason", reason]] : []),
    ["coveredBy", place === "applied" && next ? `native:${next.id}` : null],
    ["removable", workRemovable(point, place)],
    ["restorePointId", point.id]
  ]);
}

// ----------------------------------------------------------------------- моды

// Запись мода берётся, если у неё есть modId и она не чужой цели (при заданных обеих).
function ownedHere(record, ctx) {
  return Boolean(record?.modId) && !(record.targetId && ctx.targetId && record.targetId !== ctx.targetId);
}

// Отвечает по каждой записи архива: «ok», «different» или «missing».
function judgeEntry(verified, name, sha256) {
  const answer = verified.get(name);
  if (answer?.sha256 === undefined) return "missing";
  return lowered(answer.sha256) === sha256 ? "ok" : "different";
}

function modState(expected, verified, run) {
  if (!expected.length || !verified) return { state: "ok" };
  const verdicts = expected.map(({ name, sha256 }) => judgeEntry(verified, name, sha256));
  if (verdicts.every((verdict) => verdict === "ok")) return { state: "ok" };
  if (verdicts.includes("missing") && run.status.status === "reverted") return goneByGame();
  const adopted = run.target.resources?.[chainApi.UPDATE_ARCHIVE]?.adoptedUpdate;
  return { state: "needs-repair", reason: adopted ? "game-updated" : "archive-changed" };
}

function modSource(origin, hint) {
  const merged = {
    ...origin,
    ...(hint.source ? { source: hint.source } : null),
    ...(hint.buildId ? { buildId: hint.buildId, buildName: hint.buildName } : null)
  };
  const type = merged.source || (merged.bundleId ? "catalog" : "unknown");
  return { type, ...presentFields(["bundleId", "buildId", "buildName"].map((key) => [key, merged[key]])) };
}

async function describeMod(record, expected, verified, run) {
  const hint = run.hints[`mod:${record.modId}`] || {};
  const origin = record.origin || {};
  const { state, reason } = modState(expected, verified, run);
  const guard = run.target.vanillaGuard;

  return Object.fromEntries([
    ["id", `mod:${record.modId}`],
    ["kind", origin.source === "workshop" || hint.kind === "work" ? "work" : "mod"],
    ["title", clip(hint.title) || origin.title || record.modId],
    ["source", modSource(origin, hint)],
    ["installedAt", record.installedAt || null],
    ["sizeBytes", await cacheSize(run.target, record.modId)],
    ["state", state],
    ...(reason ? [["reason", reason]] : []),
    ["coveredBy", run.coverOf.get(record.modId) || null],
    ["removable", guard && guard.phase !== "restored" ? { ok: false, reason: "vanilla-guard" } : { ok: true }],
    ["modId", record.modId],
    ["version", record.version || null]
  ]);
}

// ------------------------------------------------------------------ список

function summarize(items) {
  const count = (kind) => items.filter((item) => item.kind === kind).length;
  const builds = new Set(items.map((item) => item.source.buildId || item.source.bundleId).filter(Boolean));
  const sizeBytes = items.reduce((sum, item) => (item.sizeBytes === null ? sum : sum + item.sizeBytes), 0);
  const unknownSizes = items.filter((item) => item.sizeBytes === null).length;
  return { mods: count("mod"), works: count("work"), builds: builds.size, sizeBytes, sizeApprox: unknownSizes > 0 };
}

// Работы мастерской по точкам: служебные точки пропускаются; «следующая» — ближайшая обычная после.
async function describeWorks(points, run) {
  const plain = points.filter((point) => !point.engine && !point.repair);
  const items = [];
  for (let at = 0; at < plain.length; at += 1) items.push(await describeWork(plain[at], plain[at + 1], run));
  return items;
}

async function scanInstalled(ctx, tools) {
  const hints = hintsOf(ctx);
  const gameRoot = clip(ctx?.gameRoot, 1024);
  const target = (await tools.readEngineState?.()) || null;
  const points = await chainApi.readRestorePoints(tools.restorePointsRoot, gameRoot);
  const status = await libraryStatus.libraryInstallStatus({ gameRoot, target, restorePointsRoot: tools.restorePointsRoot }, tools);
  const liveSha = status.archive?.sha256 || "";
  const base = libraryStatus.engineUpdateBase(target);
  const expected = libraryStatus.engineUpdateExpected(target);
  const stepped = chainApi.withEngineStep(points, { base, expected });
  const chain = chainApi.locateRestoreChain(stepped, liveSha);
  const run = { ctx, tools, hints, gameRoot, target, status, chain, coverOf: new Map() };

  const items = await describeWorks(points, run);

  (status.covered || []).forEach((cover) => run.coverOf.set(cover.modId, `mod:${cover.by}`));

  // Моды: сначала записи и ожидаемые записи архива, затем одна проверка на всех.
  const records = (target?.installed || [])
    .filter((record) => ownedHere(record, ctx))
    .map((record) => ({ record, expected: expectedEntriesOf(target, record.modId) }));
  let verified = null;
  if (status.status !== "intact" && tools.verifyEntries) {
    const names = new Set(records.flatMap((entry) => entry.expected.map((expectedEntry) => expectedEntry.name)));
    verified = await tools.verifyEntries({
      archivePath: chainApi.liveArchivePath(gameRoot),
      entries: Array.from(names)
    });
  }
  for (const { record, expected: list } of records) {
    items.push(await describeMod(record, list, verified, run));
  }

  const archive = Object.fromEntries([
    ["status", status.status],
    ["reason", status.reason || null],
    ["checkedAt", status.checkedAt || null]
  ]);
  return { items, summary: summarize(items), archive, game: (await tools.guard?.()) || { ok: true } };
}

export const listInstalled = (ctx, tools) => inOperation(() => scanInstalled(ctx, tools));

// -------------------------------------------------------------------- план

// Вещи списка по идентификатору и работы по restorePointId; при повторе ключа остаётся последняя.
function indexItems(list) {
  const byId = new Map(list.items.map((item) => [item.id, item]));
  const works = new Map(
    list.items.filter((item) => item.id.startsWith("native:")).map((item) => [item.restorePointId, item])
  );
  return { byId, works };
}

// Запросы в библиотеку по найденным вещам (пары «идентификатор — вещь»): работы с пустым путём патча и идентификаторы модов.
function libraryRequests(found) {
  const isWork = ([id]) => id.startsWith("native:");
  return {
    natives: found.filter(isWork).map(([, item]) => ({ restorePointId: item.restorePointId, patch: "" })),
    mods: found.filter((pair) => !isWork(pair)).map(([, item]) => item.modId)
  };
}

const planBlocked = (item, native) => Object.fromEntries([
  ["id", item.id],
  ["title", item.title],
  ["reason", native.reason || "unknown"],
  ["message", native.message || ""],
  ["options", BLOCK_OPTIONS],
  ["coveredBy", item.coveredBy]
]);

const briefOf = (item) => pickFields(item, ["id", "title", "kind", "sizeBytes"]);

function planRemoval(index, plan) {
  const nativeRows = plan.natives
    .map((native) => ({ native, item: index.works.get(native.resolvedId || native.restorePointId) }))
    .filter(({ item }) => item);
  const removable = ({ native }) => PLAN_REMOVABLE.has(native.action);
  const modRows = plan.mods.map((mod) => ({ mod, item: index.byId.get(`mod:${mod.modId}`) }));
  const remove = [
    ...nativeRows.filter(removable).map(({ item }) => briefOf(item)),
    ...modRows.filter(({ mod, item }) => item && PLAN_MOD_REMOVABLE.has(mod.action)).map(({ item }) => briefOf(item))
  ];
  const blocked = nativeRows.filter((row) => !removable(row)).map(({ item, native }) => planBlocked(item, native));

  const rebuild = plan.replays
    .map((replay) => index.works.get(replay.restorePointId))
    .filter(Boolean)
    .map((item) => ({ id: item.id, title: item.title, why: "над снимаемым — снимется и встанет заново" }));
  if (plan.engineReplay) {
    rebuild.push({ id: "engine", title: "Моды каталога", why: "лежат поверх снимаемой работы — пересоберутся" });
  }
  return { remove, blocked, rebuild };
}

function countActions(rows, action) {
  return rows.filter((row) => row.action === action).length;
}

function planEstimate(plan, tools) {
  const returns = plan.replays.length;
  const archivePasses = [plan.rewind ? 1 : 0, countActions(plan.mods, "remove"), plan.engineRecomposes || 0, returns]
    .reduce((sum, part) => sum + part, 0);
  return {
    estimate: { seconds: archivePasses * (tools.passSeconds || 40), archivePasses },
    copies: { added: returns, removed: countActions(plan.natives, "remove") + returns }
  };
}

function planStatus(problems, remove, blocked) {
  if (problems.length) return "blocked";
  if (!remove.length) return blocked.length ? "blocked" : "empty";
  return "ready";
}

async function buildPlan(ctx, ids, tools) {
  const list = await listInstalled(ctx, tools);
  const index = indexItems(list);
  const asked = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  const lookups = asked.map((id) => [id, index.byId.get(id)]);
  const unknown = lookups
    .filter(([, item]) => !item)
    .map(([id]) => ({ code: "unknown-item", id, message: UNKNOWN_ITEM_MESSAGE }));
  const { natives, mods } = libraryRequests(lookups.filter(([, item]) => item));

  const plan = await libraryRemoval.planLibraryRemoval({ gameRoot: ctx.gameRoot, targetId: ctx.targetId, natives, mods }, tools);
  const { remove, blocked, rebuild } = planRemoval(index, plan);
  const { estimate, copies } = planEstimate(plan, tools);

  const gameProblem = list.game.ok === false
    ? [{ code: "game-running", message: list.game.message || GAME_RUNNING_MESSAGE }]
    : [];
  const problems = [...plan.problems, ...gameProblem, ...unknown];

  return Object.fromEntries([
    ["status", planStatus(problems, remove, blocked)],
    ["remove", remove],
    ["rebuild", rebuild],
    ["blocked", blocked],
    ["estimate", estimate],
    ["copies", copies],
    ["freesBytes", remove.reduce((sum, item) => sum + (item.sizeBytes || 0), 0)],
    ["space", plan.space],
    ["warnings", []],
    ["problems", problems],
    ["library", plan]
  ]);
}

export const planUninstall = (ctx, ids, tools) => inOperation(() => buildPlan(ctx, ids, tools));

// ------------------------------------------------------------------ снятие

const emptyOutcome = () => Object.fromEntries([
  ["removed", []],
  ["failed", []],
  ["rebuilt", []],
  ["lost", []],
  ["remap", {}],
  ["restartRequired", false],
  ["rolledBack", false]
]);

// Итог библиотеки пересказывается по каждой вещи: снятое, отказы модов, потерянное, новые имена.
function absorbOutcome(result, done, plan, fresh, tools) {
  const refused = new Map((done.failedMods || []).map((mod) => [`mod:${mod.modId}`, mod]));
  plan.remove.forEach((item) => {
    const refusal = refused.get(item.id);
    if (refusal) {
      result.failed.push({ id: item.id, reason: "mod-failed", message: refusal.message });
      return;
    }
    result.removed.push(item.id);
    tools.report?.({ items: { [item.id]: { state: "removed" } } });
  });
  const lostIds = new Set((done.lost || []).map((entry) => entry.restorePointId));
  result.lost = fresh.items
    .filter((item) => item.restorePointId && lostIds.has(item.restorePointId))
    .map((item) => ({ id: item.id, title: item.title }));
  const renamed = Object.entries(done.remap || {}).map(([oldId, renewed]) => [`native:${oldId}`, `native:${renewed.restorePointId}`]);
  Object.assign(result.remap, Object.fromEntries(renamed));
  Object.assign(result, {
    rebuilt: Object.keys(result.remap),
    restartRequired: Boolean(done.restartRequired),
    library: done
  });
  if (done.engineRecomposeFailed) result.engineRecomposeFailed = done.engineRecomposeFailed;
}

// Работа с исходом-значением: либо { value }, либо { error }.
async function settled(work) {
  try {
    return { value: await work() };
  } catch (error) {
    return { error };
  }
}

async function carryOut(ctx, ids, tools, opts) {
  const skipBlocked = opts.skipBlocked !== false;
  const plan = await planUninstall(ctx, ids, tools);
  const result = emptyOutcome();
  const { failed } = result;

  const unknownRefusals = plan.problems
    .filter((problem) => problem.code === "unknown-item")
    .map((problem) => ({ id: problem.id, reason: "unknown-item", message: problem.message }));
  failed.push(...unknownRefusals, ...plan.blocked.map(({ id, reason, message }) => ({ id, reason, message })));

  const hard = plan.problems.find((problem) => problem.code !== "unknown-item");
  if (hard) {
    failed.push(...plan.remove.map((item) => ({ id: item.id, reason: hard.code, message: hard.message })));
    return result;
  }
  if ((!skipBlocked && plan.blocked.length) || !plan.remove.length) return result;

  const wanted = Array.from(new Set(plan.remove.map((item) => item.id)));
  const fresh = await listInstalled(ctx, tools);
  const { byId } = indexItems(fresh);
  const { natives, mods } = libraryRequests(wanted.map((id) => [id, byId.get(id)]).filter(([, found]) => found));
  wanted.forEach((id) => tools.report?.({ items: { [id]: { state: "queued" } } }));

  const withProgress = {
    ...tools,
    uninstallMod: async function uninstallMod(modId, onProgress) {
      tools.report?.({ items: { [`mod:${modId}`]: { state: "running" } } });
      return tools.uninstallMod(modId, onProgress);
    }
  };

  const request = { gameRoot: ctx.gameRoot, targetId: ctx.targetId, natives, mods };
  const outcome = await settled(() => libraryRemoval.removeLibraryItems(request, withProgress));
  if ("error" in outcome) {
    const { error } = outcome;
    failed.push(...plan.remove.map((item) => ({ id: item.id, reason: error?.code || "failed", message: String(error?.message || error) })));
    result.rolledBack = ROLLBACK_CODES.includes(error?.code);
    return result;
  }
  absorbOutcome(result, outcome.value, plan, fresh, tools);
  return result;
}

// Настройка skipBlocked читается первой же строкой внутренней функции — до плана и до других соседей.
export const uninstall = (ctx, ids, tools, opts = {}) => inOperation(() => carryOut(ctx, ids, tools, opts));
