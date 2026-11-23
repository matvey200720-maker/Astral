/*
 * Установка update.rpf из операций, а не из готовой сборки (14.11.2026, работа «установка на Rust», этап 1,
 * «одна запись вместо двух»).
 *
 * Прежний путь пишет архив дважды: сборка ложится в `_rpf-composites` (на диск игры, если кэш на другом томе),
 * потом копируется в игру. Здесь сборка откладывается: `composeArchiveResource` с `deferBuild` ничего не пишет, а
 * запоминает запрос на сборку (основа, операции с источниками) под путём будущей сборки. Дальше решает
 * `transact` (`transactions.js`):
 *   — движок собирает архив из этих операций сразу рядом с живым файлом и сам подменяет его
 *     (`install` в `compose-rpf`: одна запись, «до» — ссылка, рецепт сборки лежит рядом);
 *   — иначе (выключатель не включён, движок не берёт запрос, несколько архивов в одной точке) сборка
 *     делается прежним способом по тому же запросу — `materializeDeferredBuild`. Отложенная сборка поэтому
 *     никогда не остаётся ни собранной, ни разобранной: либо движок, либо прежний путь.
 *
 * Выключатель: `ASTRAL_ENGINE_INSTALL_OPS=<модули>` (слова модулей те же, что у `ASTRAL_ENGINE_INSTALL`).
 * По умолчанию выключен.
 *
 * Рецепт. Копии сборки больше нет, а «Починить» после того, как лаунчер Rockstar откатил update.rpf, брал её из
 * `_rpf-composites`. Теперь рядом с хранилищем лежит рецепт (запрос на сборку целиком и отпечаток результата,
 * его пишет движок до подмены): `repairFromRecipe` повторяет сборку той же командой и сверяет отпечаток. Правило
 * проекта прежнее: живой архив жёсткой ссылкой на файл кэша не становится никогда (игру могут править на месте).
 *
 * Источники операций. Файлы модов лежат в `payloads/<мод>` и живут, пока мод стоит. Результаты сборщиков записей
 * (`payloads/_tracer-composites`, `_timecycle-composites`, `_awc-composites`… — «памяти сборщиков»,
 * `cache-housekeeping.js: sweepEntryMemories`) уборка кэша оставляет по одному свежему файлу на папку, прочие
 * через полчаса убирает: рецепт на них пережил бы лишь первую уборку. Поэтому такие источники перед вызовом
 * закрепляются в папке рецепта жёсткой ссылкой (или копией, если том другой) под именем из их отпечатка.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fingerprintSha256 } from "./file-fingerprint.js";

export const OPS_ENV = "ASTRAL_ENGINE_INSTALL_OPS";
export const RECIPES_FOLDER = "recipes";

const SHA256 = /^[a-f0-9]{64}$/i;

function* commaItems(text) {
  for (const item of String(text || "").split(",")) yield item.trim().toLowerCase();
}

/** Слово «все модули»: установка из операций у любой установки и снятия, которым своя подмена не дана. */
export const OPS_ALL = "all";

/** Включена ли установка из операций для модуля (слово модуля — как у `ASTRAL_ENGINE_INSTALL`; `all` — для всех). */
export function engineInstallOpsEnabled(moduleName, env = process.env) {
  const wanted = String(moduleName ?? "").toLowerCase();
  if (!wanted) return false;
  for (const item of commaItems(env[OPS_ENV])) if (item === wanted || item === OPS_ALL) return true;
  return false;
}

/*
 * Подмена по умолчанию (19.11.2026). Установку `update.rpf` ведут десятки мест приложения (каталог, наборы мастерской,
 * снятие из библиотеки), и почти ни одно своей подмены движком не даёт. Приложение один раз называет, как её собрать
 * (`setDefaultOpsEngine`, `apps/desktop/src/ops-install.js`), и установщик берёт её там, где вызывающий подмены не дал.
 * Поставщик отдаёт `null`, пока слово `all` не стоит в выключателе, — тогда всё идёт прежним путём.
 */
let defaultOpsEngine = null;
export const setDefaultOpsEngine = (provider) => {
  defaultOpsEngine = typeof provider === "function" ? provider : null;
};
export function defaultOpsEngineFor(context) {
  try {
    return defaultOpsEngine?.(context) || null;
  } catch {
    return null;
  }
}

/** Разрешена ли установка из операций этой подмене движком: явный знак вызывающего или выключатель по слову модуля. */
export function opsAllowedFor(engine, env = process.env) {
  if (!engine || engine.multi === true) return false;
  if (engine.ops === true) return true;
  return engineInstallOpsEnabled(engine.replay?.module, env);
}

// ---------- Отложенные сборки ----------

const deferred = new Map();
const keyOf = (file) => path.resolve(String(file)).toLowerCase();

/** Запомнить отложенную сборку под путём будущей сборки (`output`). */
export function registerDeferredBuild(output, build) {
  deferred.set(keyOf(output), { ...build, output });
}

/** Отложенная сборка по пути будущей сборки; `null`, если её нет. Не забирает. */
export function deferredBuildFor(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath) return null;
  return deferred.get(keyOf(sourcePath)) ?? null;
}

export const isDeferredBuild = (sourcePath) => deferredBuildFor(sourcePath) !== null;

/** Забрать отложенную сборку: дальше её исполнитель отвечает за неё сам. */
export function takeDeferredBuild(sourcePath) {
  const build = deferredBuildFor(sourcePath);
  if (build) deferred.delete(keyOf(sourcePath));
  return build;
}

/** Сделать сборку прежним способом (файл в месте сборки). `false`, если отложенной сборки нет. */
export async function materializeDeferredBuild(sourcePath) {
  const build = takeDeferredBuild(sourcePath);
  if (!build) return false;
  await build.materialize();
  return true;
}

/*
 * Строка журнала раздела install (19.11.2026): установка из операций вернулась на прежний путь — почему. Движок установки
 * сам журнала не ведёт, приложение подключает его при старте (`setOpsNotice`, как `setOwnDlcHealNotice`).
 */
let opsNoticeSink = () => {};
export const setOpsNotice = (notice) => {
  opsNoticeSink = typeof notice === "function" ? notice : () => {};
};
export function opsNotice(entry) {
  try {
    opsNoticeSink(entry);
  } catch {
    /* журнал не должен ронять установку */
  }
}

/** Ключи блока `install`, без которых установка в два шага невозможна (`INSTALL-RUST-HOLD.md`, раздел 1). */
export const HOLD_KEYS = Object.freeze(["hold", "commit", "discard"]);

/** Для тестов: забыть всё отложенное. */
export function forgetDeferredBuilds() {
  deferred.clear();
}

// ---------- Рецепты ----------

/** Папка рецептов цели: рядом с хранилищем, уборка кэша её не знает и не трогает. */
export const recipeFolder = (paths, targetKey) => path.join(paths.root, RECIPES_FOLDER, String(targetKey));

/** Файл рецепта сборки с этим отпечатком операций. */
export function recipeFile(paths, targetKey, fingerprint) {
  return path.join(recipeFolder(paths, targetKey), `${String(fingerprint).slice(0, 32)}.recipe.json`);
}

const STABLE_STORE_BREAK = /^[_@.]/;

/** Файл лежит в хранилище мода (`payloads/<мод>`), а не в «памяти сборщика» (`payloads/_…`): он живёт, пока мод стоит. */
export function isStableSource(payloadsRoot, file) {
  const relative = path.relative(path.resolve(payloadsRoot), path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return !STABLE_STORE_BREAK.test(relative.split(path.sep)[0]);
}

async function pinOne(source, folder, expectedSha256) {
  const sha256 = SHA256.test(String(expectedSha256 || "")) ? String(expectedSha256).toLowerCase() : await fingerprintSha256(source);
  const pinned = path.join(folder, `${sha256}${path.extname(source).toLowerCase()}`);
  try {
    await fs.access(pinned);
    return pinned;
  } catch {
    /* закрепляем ниже */
  }
  await fs.mkdir(folder, { recursive: true });
  const stage = `${pinned}.${process.pid}.${createHash("sha256").update(`${Date.now()}${Math.random()}`).digest("hex").slice(0, 12)}.stage`;
  try {
    await fs.link(source, stage);
  } catch {
    await fs.copyFile(source, stage);
  }
  try {
    await fs.rename(stage, pinned);
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
  return pinned;
}

/**
 * Операции для движка: источники вне хранилищ модов закрепляются в папке рецепта, прочие остаются как есть.
 * Возвращает новый список операций (без `modId`: движок его не читает).
 */
export async function pinOperations(operations, { payloadsRoot, folder }) {
  const pinned = [];
  for (const operation of operations) {
    const { modId: _modId, source, ...rest } = operation;
    if (!source || isStableSource(payloadsRoot, source)) {
      pinned.push({ ...rest, ...(source ? { source } : {}) });
      continue;
    }
    pinned.push({ ...rest, source: await pinOne(source, folder, operation.sha256) });
  }
  return pinned;
}

/** Оставить в папке цели только `keep` свежих рецептов и закреплённые источники, на которые они ссылаются. */
export async function pruneRecipes(folder, { keep = 2, keepFile = "" } = {}) {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const recipes = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".recipe.json")) continue;
    const stat = await fs.stat(path.join(folder, entry.name)).catch(() => null);
    if (stat) recipes.push({ name: entry.name, at: stat.mtimeMs });
  }
  recipes.sort((a, b) => b.at - a.at);
  const kept = new Set(recipes.slice(0, Math.max(1, keep)).map((item) => item.name));
  if (keepFile) kept.add(path.basename(keepFile));
  for (const { name } of recipes) if (!kept.has(name)) await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
  /* Закреплённые источники: остаются те, что называет кто-то из оставшихся рецептов. */
  const wanted = new Set();
  for (const name of kept) {
    try {
      const recipe = JSON.parse(await fs.readFile(path.join(folder, name), "utf8"));
      for (const operation of recipe.operations || []) if (operation.source) wanted.add(path.resolve(operation.source).toLowerCase());
    } catch {
      /* рецепт не читается — его источники не держим */
    }
  }
  const sources = path.join(folder, "sources");
  for (const entry of await fs.readdir(sources, { withFileTypes: true }).catch(() => [])) {
    const place = path.join(sources, entry.name);
    if (entry.isFile() && !wanted.has(place.toLowerCase())) await fs.rm(place, { force: true }).catch(() => {});
  }
}

/** Рецепт, у которого пути хранилища переписаны с прежнего корня на нынешний (кэш переехал). Пишет его рядом, `null` — менять нечего. */
export async function rebaseRecipe(recipeFilePath, { fromRoot = "", toRoot = "" } = {}) {
  if (!fromRoot || !toRoot || path.resolve(fromRoot).toLowerCase() === path.resolve(toRoot).toLowerCase()) return null;
  const recipe = JSON.parse(await fs.readFile(recipeFilePath, "utf8"));
  const from = path.resolve(fromRoot);
  const moved = (file) => {
    if (typeof file !== "string" || !file) return file;
    const relative = path.relative(from, path.resolve(file));
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? path.join(toRoot, relative) : file;
  };
  const rebased = {
    ...recipe,
    baseArchive: moved(recipe.baseArchive),
    operations: (recipe.operations || []).map((operation) => ({ ...operation, ...(operation.source ? { source: moved(operation.source) } : {}) })),
  };
  const file = `${recipeFilePath}.${process.pid}.rebased`;
  await fs.writeFile(file, JSON.stringify(rebased, null, 2));
  return file;
}

/** Отпечаток итога в состоянии: слой сборки и последняя сборка получают то, что назвал движок. */
export function recordBuiltFingerprint(next, { targetKey, archiveTarget, sha256, recipe = null }) {
  const target = next?.targets?.[targetKey];
  const resource = target?.resources?.[archiveTarget];
  const layer = Array.isArray(resource?.layers) ? resource.layers.at(-1) : null;
  if (layer) layer.sha256 = sha256;
  const built = target?.archives?.[archiveTarget]?.lastBuilt;
  if (built) {
    built.sha256 = sha256;
    if (recipe) built.recipe = recipe;
  }
}
