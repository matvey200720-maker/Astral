/*
 * Дозапись в update.rpf для модов каталога со стороны приложения (19.11.2026, «диск в сотку при установке мода каталога»;
 * проект — `packages/install-engine/append-item.js`, записка — `docs/speed-helpers/CATALOG-APPEND-1911.md`).
 *
 * Движок установки (`installPackageBatch({ appendInstall })`, `uninstallPackage({ appendInstall })`) спрашивает у приложения:
 *   - `accepts(запрос)` — берёт ли движок эту правку: найден ли он и пишет ли запрос сам (вложенные архивы, в которые мод
 *     кладёт файлы, есть в основе; новый вложенный архив пишет помощник, у него дозаписи нет);
 *   - `append(запрос)` — дописать операции мода в живой `update.rpf` (`compose-rpf` с `install.write: "append"`): тела в конец
 *     файла, оглавление заново, журнал рядом, точка отката — запись журнала. Длина файла держит ключ прежней головы
 *     (`keepKey`: игра выбирает ключ оглавления по длине файла на диске, `ACCEPTANCE-1711.md`, вопрос R4);
 *   - `rollback({ pointId })` — снять запись (`restore-rpf-point`): прежние байты головы и усечение, файл как был.
 *
 * Выключатель — `ASTRAL_ENGINE_CATALOG_APPEND=catalog` (слово модуля, как у экспресс-установки). Пуст — `catalogAppendFor` отдаёт
 * `null`, и в настройки установки не попадает ничего: путь прежний. Видимых человеку строк здесь нет: итог идёт в журнал приложения.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CATALOG_APPEND_ENV, CATALOG_APPEND_MODULE, STOCK_LIMIT_BYTES, catalogAppendEnabled, containerAppendEnabled, registerAppendRecovery } from "@modovik/install-engine/append-item.js";
import { runEngineCommand } from "./engine-run.js";
import { createExpressEngine } from "./express-engine.js";
import { rpfTailEnabled } from "./rpf-tail.js";

export { CATALOG_APPEND_ENV, CATALOG_APPEND_MODULE };

const A1 = /^a1:[a-f0-9]{64}$/;

/** Включена ли дозапись каталога (слово `catalog` в выключателе). */
export const catalogAppendSwitchedOn = (env = process.env) => catalogAppendEnabled(env);

const codeError = (code, message) => Object.assign(new Error(message), { code });

/* Имя точки отката, которое выдаёт `engine-swap.js`: по нему, и только по нему, приложение убирает папки точек. */
const POINT_ID = /^rpf-[A-Za-z0-9_-]{1,70}$/;
const entryKey = (value) => String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();

/**
 * Штатные тела записей, которые возвращаются к штатным (мод ушёл, замена мода другим): `extract-archive-entries` над основой кладёт их в
 * папку `dir`. Что в основе есть — операция `upsert` с этим файлом (запись могла быть удалена модом: тогда она добавляется, иначе заменяется); чего нет (мод добавил запись) — удаление. Каждая названная запись обязана
 * быть либо извлечена, либо названа отсутствующей: гадать нельзя (`BAD_ANSWER`). Тела тяжелее `limitBytes` — `STOCK_TOO_LARGE`: пересборка дешевле.
 */
async function stockOperations({ run, executable, keysDirectory, gameRoot, dir, stock, limitBytes, signal }) {
  const argv = ["extract-archive-entries", "--input", String(stock.baseArchive), "--output-dir", dir];
  for (const entry of stock.entries) argv.push("--entry", String(entry));
  if (gameRoot) argv.push("--game-root", String(gameRoot));
  if (keysDirectory) argv.push("--keys", String(keysDirectory));
  const answer = await run(executable, argv, { signal });
  const files = Array.isArray(answer?.files) ? answer.files : [];
  const missing = new Set((Array.isArray(answer?.missing) ? answer.missing : []).map(entryKey));
  const byKey = new Map(files.map((row) => [entryKey(row?.entry), row]));
  const operations = [];
  let bytes = 0;
  for (const entry of stock.entries) {
    const key = entryKey(entry);
    const row = byKey.get(key);
    if (row) {
      if (typeof row.file !== "string" || !row.file || row.file.includes("/") || row.file.includes("\\") || row.file.includes(".."))
        throw codeError("BAD_ANSWER", `Штатные тела: движок назвал странное имя файла для записи ${entry}.`);
      bytes += Number.isFinite(row.size) ? Number(row.size) : 0;
      operations.push({ entry, action: "upsert", source: path.join(dir, row.file), ...(typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256) ? { sha256: row.sha256 } : {}) });
    } else if (missing.has(key)) operations.push({ entry, action: "delete", allowDelete: true, allowMissing: true });
    else throw codeError("BAD_ANSWER", `Штатные тела: запись ${entry} ни извлечена, ни названа отсутствующей.`);
  }
  if (files.some((row) => !stock.entries.some((entry) => entryKey(entry) === entryKey(row?.entry)))) throw codeError("BAD_ANSWER", "Штатные тела: движок извлёк запись, которую не просили.");
  if (bytes > limitBytes) throw codeError("STOCK_TOO_LARGE", `Штатные тела: ${Math.round(bytes / 1048576)} МБ, предел ${Math.round(limitBytes / 1048576)} МБ; пересборка дешевле.`);
  return { operations, deletes: operations.some((operation) => operation.action === "delete") };
}

/**
 * Дозапись каталога для движка установки: `{ module, enabled, accepts, append, rollback, note }`.
 *
 * `locate()` — где движок: `{ executable, keysDirectory, pointsRoot }` (спрашивается один раз, когда путь впервые понадобился).
 * Остальное — для проверок: `makeEngine` (запуск команды с запросом из файла), `run` (запуск команды с аргументами),
 * `writerFor` (кто пишет запрос: `"engine"` или `"helper"`), `note` (строка в журнал).
 */
export function createCatalogAppend({
  locate,
  env = process.env,
  fastInstall = false,
  writeLimitMbps = null,
  scratchRoot = os.tmpdir(),
  makeEngine = createExpressEngine,
  run = runEngineCommand,
  writerFor = null,
  releaseAnchor = null,
  stockLimitBytes = STOCK_LIMIT_BYTES,
  note = (message) => console.warn(`[astral] ${message}`),
} = {}) {
  if (typeof locate !== "function") throw new Error("Дозапись каталога: не сказано, где движок.");
  let located = null;
  const place = () => (located ||= Promise.resolve().then(locate));
  const chooseWriter = async (request) => {
    if (typeof writerFor === "function") return writerFor(request);
    const { chooseComposeWriter } = await import("./rpf-composer.js");
    return chooseComposeWriter(request);
  };

  return {
    module: CATALOG_APPEND_MODULE,
    enabled: () => catalogAppendEnabled(env),
    note,
    /* Вторая сдача: приложение возвращает записям штатные тела из основы (`stock`) и снимает якорь кладовой перед записью (`releaseAnchor`). */
    restoresStock: true,
    stockLimitBytes,
    ...(typeof releaseAnchor === "function" ? { releaseAnchor: (args) => releaseAnchor(args) } : {}),

    async accepts({ archiveTarget, baseArchive = null, operations }) {
      try {
        const { executable } = (await place()) || {};
        if (!executable) return false;
        /* Слово `container` (рядом с `catalog`): запрос, что создаёт вложенный контейнер слоя, тоже пишет движок дозаписью, а не помощник полной пересборкой. */
        const request = { mode: "compose", archiveTarget, baseArchive, operations, ...(containerAppendEnabled(env) ? { appendCreates: true } : {}) };
        return (await chooseWriter(request)) === "engine";
      } catch {
        return false;
      }
    },

    async append({ gameRoot, archiveTarget, operations, allowDeletes = false, pointId, baseSha256 = undefined, recipeFile, stock = null, signal = null, onProgress = null }) {
      const { executable, keysDirectory = null, pointsRoot = null } = await place();
      const requestDir = await fs.mkdtemp(path.join(scratchRoot, "astral-catalog-"));
      try {
        /* Штатные тела — до запроса движку записи: не сошлось или тяжелее предела — запись не начата, установка идёт прежним путём. */
        let sent = operations;
        let deletes = allowDeletes === true;
        if (stock?.entries?.length) {
          const restored = await stockOperations({ run, executable, keysDirectory, gameRoot, dir: path.join(requestDir, "stock"), stock, limitBytes: stockLimitBytes, signal });
          sent = [...operations, ...restored.operations];
          deletes ||= restored.deletes;
        }
        const engine = makeEngine({ executable, moduleName: CATALOG_APPEND_MODULE, gameRoot, keysDirectory, pointsRoot, requestDir, fastInstall, writeLimitMbps, env });
        const install = {
          gameRoot: String(gameRoot),
          archive: archiveTarget,
          replay: { module: CATALOG_APPEND_MODULE },
          write: "append",
          /* Длина файла между ростом и записью новой головы даёт прежний ключ (R4). Старый движок ключ молча пропускает: принявший отвечает `keyPadBytes`. */
          keepKey: true,
          /* Хвост после последней записи (`rpf-tail.js`): маленькое тело последним роняло сюжет. Выключатель ASTRAL_RPF_TAIL=off. */
          ...(rpfTailEnabled(env) ? { tailPad: true } : {}),
          pointId,
          ...(baseSha256 ? { baseSha256 } : {}),
          saveRecipe: recipeFile,
        };
        const answer = await engine("compose-rpf", { mode: "compose", archiveTarget, allowDeletes: deletes, operations: sent, install }, { signal, onProgress });
        if (answer?.status !== "ready" || answer?.mode !== "append-install" || typeof answer.fingerprint !== "string" || !A1.test(answer.fingerprint))
          throw codeError("BAD_ANSWER", "Дозапись: движок не назвал отпечаток дозаписанного архива.");
        /* Без `keyPadBytes` движок не знает `keepKey`: файл вырос, голова прежняя, ключ не тот — игра такой архив не откроет. Запись снимает вызывающий. */
        if (!Number.isFinite(answer.keyPadBytes)) throw codeError("KEY_NOT_HELD", "Дозапись: движок не держит ключ оглавления (старая сборка движка).");
        return answer;
      } finally {
        await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {});
      }
    },

    /**
     * Снять запись по точке. `lenient` — точки уже нет (запись не успела начаться или откат уже был): это не ошибка; чужой файл
     * (`ForeignChange`) остаётся отказом и в мягком режиме.
     */
    async rollback({ pointId, alsoPoints = [], lenient = false, signal = null }) {
      const { executable, keysDirectory = null, pointsRoot = null } = await place();
      const argv = ["restore-rpf-point", "--restore-point", String(pointId)];
      if (pointsRoot) argv.push("--restore-points-root", pointsRoot);
      if (keysDirectory) argv.push("--keys", keysDirectory);
      let answer;
      try {
        answer = await run(executable, argv, { signal });
      } catch (error) {
        if (lenient && (error?.code === "FileNotFoundException" || /manifest was not found/i.test(String(error?.message || "")))) return null;
        throw error;
      }
      /* Откат нижней точки снял и записи выше неё (так делает `restore-rpf-point`): их точки больше ничего не откатят, папки лишние.
         Убираются только после удачного отката и только те, чьё имя выдаёт `engine-swap.js` и чей путь прямо под корнем точек. */
      if (pointsRoot) {
        for (const id of alsoPoints) {
          if (!POINT_ID.test(String(id))) continue;
          const folder = path.join(pointsRoot, String(id));
          if (path.dirname(path.resolve(folder)) !== path.resolve(pointsRoot)) continue;
          await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
        }
      }
      return answer;
    },
  };
}

/** Дозапись каталога этой установки или `null`, если выключатель пуст: тогда ни один модуль ниже не подключается. */
export function catalogAppendFor({ env = process.env, ...options } = {}) {
  return catalogAppendSwitchedOn(env) ? createCatalogAppend({ env, ...options }) : null;
}

/** Поиск движка, ключей и папки точек — как у остальных установок (`redux-install.js`). */
function appLocator({ stateDir }) {
  let bridge = null;
  return {
    locate: async () => {
      const [native, rust, provisioner, chain] = await Promise.all([
        import("./native-engine.js"),
        import("./native-engine-rust.js"),
        import("./loader-provisioner.js"),
        import("./native-restore-chain.js"),
      ]);
      bridge = native;
      return {
        executable: rust.resolveRustExecutable({ ...native.engineLocationDefaults(), ...(native.nativeContextDefaultsOf() || {}) }),
        keysDirectory: (await provisioner.archiveKeysDirectory({ stateDir })) || null,
        pointsRoot: chain.nativeRestorePointsRoot(),
      };
    },
    fastInstall: () => bridge?.nativeFastInstall() === true,
    /* Короткая запись идёт по потолку режима, а не по доле регулятора диска (мод на 9 МБ не ждёт чужой записи). */
    writeLimitMbps: () => bridge?.nativeModeWriteLimit?.() ?? bridge?.nativeWriteLimit() ?? null,
  };
}

/**
 * Хук доводки оборванных транзакций: запись дозаписи, о которой знает только журнал транзакции, снимается по точке при следующем
 * запуске (`registerAppendRecovery`). Ставится при каждом запуске и от выключателя не зависит: выключили после обрыва — запись всё равно снимается.
 */
export function registerCatalogAppendRecovery({ stateDir, env = process.env } = {}) {
  const catalog = createCatalogAppend({ env, ...appLocator({ stateDir }) });
  registerAppendRecovery(({ pointId, alsoPoints = [] }) => catalog.rollback({ pointId, alsoPoints, lenient: true }));
  return catalog;
}

/** Дозапись каталога из приложения. Выключатель пуст — `null`. */
export function appCatalogAppend({ stateDir, env = process.env, note = undefined } = {}) {
  if (!catalogAppendSwitchedOn(env)) return null;
  const locator = appLocator({ stateDir });
  /* Живой якорь кладовой (`live-anchor-release.js`) снимается перед дозаписью: иначе первая же установка после перерыва получала бы `Linked`. */
  const releaseAnchor = async ({ livePath, signal = null }) => {
    const [{ releaseLiveAnchor }, { pointsRoot }] = await Promise.all([import("@modovik/install-engine/live-anchor-release.js"), locator.locate()]);
    const answer = await releaseLiveAnchor({ stateDir, livePath, pointsRoot, signal });
    if (answer.released) catalog.note(`Якорь кладовой снят с ${path.basename(livePath)}: дозапись пишет в файл на месте.`);
    return answer.released;
  };
  const catalog = createCatalogAppend({ env, ...(note ? { note } : {}), ...locator, releaseAnchor });
  registerAppendRecovery(({ pointId, alsoPoints = [] }) => catalog.rollback({ pointId, alsoPoints, lenient: true }));
  return catalog;
}
