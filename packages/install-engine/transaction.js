import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  checkedRecordKey,
  ownRecordValue,
  setRecordValue,
} from "./state-record.js";
import { fingerprintSha256, rememberSha256 } from "./file-fingerprint.js";
import { copyFileOffThread } from "./copy-off-thread.js";
import { copyWriteLimitBytes } from "./write-pacing.js";
import { redoRollbackJournalItem, undoAppendJournalItem } from "./append-item.js";

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

/* Сообщений о копировании хватает двадцати в секунду: чанк потока — 64 КБ, и
   на резервной копии update.rpf их вышло бы больше тридцати тысяч. Столько
   событий не нужно ни одному окну, а перерисовку они съедают всерьёз. */
const COPY_REPORT_INTERVAL_MS = 50;

/* Отказ сверки по дороге; у возврата к копии — свои слова (`item.mismatch`,
   сброс 12.10): там не собранный архив, а копия «до Astral» из кэша. */
const COPY_MISMATCH = "Собранный архив не совпал со своим отпечатком при копировании — установка отменена.";

/*
 * Сколько контрольных точек движка помнит состояние (05.10.2026). Каждая —
 * снимок всего профиля: у владельца тридцать точек весили 65 МБ из 114 МБ
 * файла состояния, а его читает и пишет каждая установка, по несколько раз.
 * Окно эти точки не показывает, а к старым всё равно не вернуться: сборки и
 * хранилища, на которые они ссылаются, уборка снимает.
 */
const ENGINE_RESTORE_POINTS = 8;

/*
 * Транзакции, которые этот процесс ведёт прямо сейчас (06.10.2026, вечер).
 * Восстановление зовут и чтения состояния (`getProfile`, `auditTarget`,
 * `listRestorePoints`), а они идут мимо очереди мутаций — посреди чужой
 * установки. Журнал транзакции появляется только после копий: в этот момент
 * восстановление видело каталог без `journal.json` и стирало его вместе со
 * снимками отката, а в фазе подмены — возвращало игре старые файлы, пока
 * установка их подменяла. Своя идущая транзакция — не оборванная: её не
 * трогают. Оборванные (процесс упал посреди записи) восстанавливаются, как
 * раньше.
 */
const activeTransactions = new Set();

/** Идёт ли в этом процессе транзакция с этим id (для тестов и уборки). */
export const transactionActive = (id) => activeTransactions.has(String(id));

/*
 * Копия — во временный файл рядом и переименованием на место (задача 5 ТЗ
 * 10.10.2026). Раньше копия писалась прямо в место назначения: файл, который
 * там был, переписывался на месте. Это делало жёсткие ссылки в кэше опасными —
 * перезапись одной ссылки меняла и все другие, — а оборванная копия оставляла
 * вместо прежнего файла полфайла. Теперь прежний файл остаётся целым до
 * последнего мгновения, а ссылки на него — его прежними байтами.
 */
export async function copyFileCancellable(
  source,
  destination,
  signal = null,
  onCopyProgress = null,
  expectedSha256 = "",
  options = {},
) {
  /* `.stage` — недописанное уборка узнаёт и убирает (`cache-housekeeping.js`). */
  const temporary = `${destination}.${randomUUID()}.stage`;
  try {
    const sha256 = await copyInto(source, temporary, signal, onCopyProgress, expectedSha256, options);
    await fs.rename(temporary, destination);
    /* Отпечаток посчитан по тем же байтам, что легли в копию (02.11.2026): копия основы update.rpf
       и следующий вопрос о ней (`fingerprintSha256`) больше не читают два гигабайта второй раз. */
    if (sha256) await rememberSha256(destination, sha256).catch(() => {});
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function copyInto(
  source,
  destination,
  signal = null,
  onCopyProgress = null,
  expectedSha256 = "",
  { durable = false, mismatch = "" } = {},
) {
  /*
   * Быстрый путь — только когда байты никому не нужны. `fs.copyFile` отдаёт
   * файл одним вызовом операционной системы и рассказать по дороге ничего не
   * может: раньше он отвечал `(1, 1)` — «единица из единицы», — и окно честно
   * показывало «0 B из 0 B». А это самое место, где полосе есть что показать:
   * резервная копия update.rpf идёт около десяти секунд.
   */
  /* С потолком записи (`write-pacing.js`) быстрый путь не годится: он пишет мимо потолка. */
  if (!expectedSha256 && !signal && typeof onCopyProgress !== "function" && !copyWriteLimitBytes()) {
    await fs.copyFile(source, destination);
    if (durable) {
      const handle = await fs.open(destination, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    return;
  }
  /* Ожидаемый SHA-256 (задача 8): байты сверяются по дороге, тем же
     чтением, — подменённый архив не нужно перечитывать ради отпечатка.
     Копия — одним буфером (`buffered-copy.js`, ОЗУ 15.10), и в потоке
     (`copy-off-thread.js`, 20.10): кусок и хэш в главном потоке держали его
     по 10–14 с на «Применить» дорог. */
  try {
    const { sha256 } = await copyFileOffThread(source, destination, {
      signal,
      durable,
      onProgress: onCopyProgress,
      reportIntervalMs: COPY_REPORT_INTERVAL_MS,
    });
    if (expectedSha256 && sha256 !== expectedSha256) throw new Error(mismatch || COPY_MISMATCH);
    return sha256;
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}

/*
 * Только для стенда обрыва (`scripts/probe-install-kill.mjs`): пауза в миг, когда собранные файлы уже лежат рядом с живыми,
 * а подмена не началась. Без переменной `ASTRAL_INSTALL_PAUSE_BEFORE_SWAP_MS` ничего не делает; дольше минуты не ждёт.
 */
export async function pauseBeforeSwap(env = process.env) {
  const ms = Number(env.ASTRAL_INSTALL_PAUSE_BEFORE_SWAP_MS) || 0;
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 60_000)));
}

/*
 * Только для стенда обрыва дозаписи (`scripts/probe-catalog-append.mjs --scenario kill`): пауза в миг, когда движок уже дописал
 * (или откатил) запись в живом архиве, а состояние ещё не записано. Без переменной `ASTRAL_INSTALL_PAUSE_AFTER_APPEND_MS` ничего
 * не делает; дольше минуты не ждёт. `ASTRAL_INSTALL_PAUSE_MARK` — файл-метка «пауза началась» для стенда.
 */
export async function pauseAfterAppend(env = process.env) {
  const ms = Number(env.ASTRAL_INSTALL_PAUSE_AFTER_APPEND_MS) || 0;
  if (!(ms > 0)) return;
  if (env.ASTRAL_INSTALL_PAUSE_MARK) await fs.writeFile(env.ASTRAL_INSTALL_PAUSE_MARK, "").catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 60_000)));
}

async function copyAtomic(
  source,
  destination,
  suffix,
  signal,
  onCopyProgress = null,
  expectedSha256 = "",
  { link = false, move = false, mismatch = "" } = {},
) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const stage = `${destination}.astral-stage-${suffix}`;
  if (link && (await linkStage(source, stage, expectedSha256, onCopyProgress, mismatch))) return stage;
  if (move && (await moveStage(source, stage, expectedSha256, onCopyProgress, mismatch))) return stage;
  /* Файл игры — на диск до подмены: после переименования система могла бы
     ещё держать его байты в памяти, и сбой питания оставил бы игре архив
     с дырами. */
  await copyFileCancellable(source, stage, signal, onCopyProgress, expectedSha256, { durable: true, mismatch });
  return stage;
}

/*
 * Сборка `update.rpf` — в игру переносом, а не копией («одна запись вместо двух», `transactions.js: shouldMove`,
 * 19.11.2026). Сборка лежит на том же томе, что игра (`composite-home.js`), и прежде копировалась рядом с живым
 * архивом: вторая запись двух гигабайт на тот же диск, 60 % времени установки (замер 18.11). Перенос — одно
 * переименование: байты те же самые, что собрал помощник или движок, и те же, что проверила самопроверка перед
 * транзакцией. Жёсткой ссылки не остаётся: файла в кэше сборок после переноса нет, живой архив у него один.
 * Отпечаток сверяется до переноса (сборку по её пути помнит кладовая отпечатков), байты сбрасываются на диск до
 * подмены. Другой том, занятый файл, отказ системы — обычная копия, как раньше.
 */
async function moveStage(source, stage, expectedSha256, onCopyProgress, mismatch = "") {
  if (expectedSha256 && (await fingerprintSha256(source)) !== expectedSha256) throw new Error(mismatch || COPY_MISMATCH);
  try {
    await fs.rename(source, stage);
  } catch {
    return false;
  }
  try {
    const handle = await fs.open(stage, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const { size } = await fs.lstat(stage);
    onCopyProgress?.(size, size);
    return true;
  } catch (error) {
    /* Сбросить не вышло — сборка возвращается на место, установка отказывает как при сбое копии. */
    await fs.rename(stage, source).catch(() => fs.rm(stage, { force: true }).catch(() => {}));
    throw error;
  }
}

/*
 * Сборка своего пакета дополнения — в игру ссылкой (`transactions.js`,
 * 05.10.2026). Отпечаток сборки сверяется тем же, что сверила бы копия, и её
 * байты сбрасываются на диск до подмены. Другой диск или файловая система без
 * ссылок — обычная копия.
 */
async function linkStage(source, stage, expectedSha256, onCopyProgress, mismatch = "") {
  try {
    await fs.link(source, stage);
  } catch {
    return false;
  }
  try {
    if (expectedSha256 && (await fingerprintSha256(source)) !== expectedSha256)
      throw new Error(mismatch || COPY_MISMATCH);
    const handle = await fs.open(stage, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const { size } = await fs.lstat(stage);
    onCopyProgress?.(size, size);
    return true;
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
}

/*
 * Снимок живого файла для отката — жёсткой ссылкой (задача 8): до подмены
 * живой файл на месте не пишется — он уходит переименованием, — поэтому
 * ссылка держит его прежние байты, а два гигабайта не копируются. Хранилище
 * на другом томе или файловая система без ссылок — копия, как раньше.
 */
async function linkSnapshot(live, snapshot, linkFile = fs.link) {
  try {
    await linkFile(live, snapshot);
    return true;
  } catch {
    return false;
  }
}

/*
 * Хранилище на другом томе, чем игра (13.11.2026): ссылка в папку журнала не встаёт, и снимок был
 * копией — два гигабайта update.rpf на диск хранилища при каждой установке. У игрока с игрой не на
 * системном диске так шла каждая установка (замер на тестовом ПК: 3,9 ГБ записи на диск хранилища
 * вместо 1,9). Теперь снимок — жёсткая ссылка рядом с живым файлом, на его же томе: те же прежние
 * байты без записи. Имя — `<живой файл>.astral-snapshot-<id транзакции>`; список таких имён лежит
 * в папке журнала раньше, чем встаёт первая ссылка, и уходит вместе с журналом.
 */
const BESIDE_LIST = "beside-snapshots.json";
const BESIDE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function besideSnapshotPath(livePath, id) {
  return `${livePath}.astral-snapshot-${id}`;
}

/* Удаляются только имена, которые выдаёт `besideSnapshotPath` для этой транзакции: испорченный список
   не должен увести уборку на чужие файлы игры. */
function besideSnapshotSafe(file, id) {
  const text = String(file || "");
  return BESIDE_ID.test(String(id || "")) && path.isAbsolute(text) && text.endsWith(`.astral-snapshot-${id}`);
}

async function removeBesideSnapshots(directory) {
  let listed = [];
  try {
    listed = JSON.parse(await fs.readFile(path.join(directory, BESIDE_LIST), "utf8"));
  } catch {
    return;
  }
  const id = path.basename(directory);
  for (const file of Array.isArray(listed) ? listed : [])
    if (besideSnapshotSafe(file, id)) await fs.rm(file, { force: true }).catch(() => {});
}

/*
 * Снимок — на место живого файла жёсткой ссылкой (02.11.2026): те же байты без записи, а
 * не два гигабайта копии на каждый откат установки в update.rpf. Ссылка встаёт рядом и
 * переименованием заменяет живой файл — окна «файла нет» не бывает, а обрыв посреди
 * оставляет снимок целым: повтор отката после падения сделает то же самое. Снимок
 * уходит только с журналом (`cleanupJournal`), и ссылка остаётся единственным именем
 * прежних байт. Другой том или файловая система без ссылок — копия, как раньше.
 */
async function restoreSnapshot(snapshot, live, { linkFile = fs.link } = {}) {
  /* Имя постоянное: ссылку, оставшуюся от обрыва, следующий откат уберёт, а не оставит в папке игры. */
  const stage = `${live}.astral-restore`;
  await fs.rm(stage, { force: true }).catch(() => {});
  try {
    await linkFile(snapshot, stage);
    await fs.rename(stage, live);
    return "link";
  } catch {
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  await fs.rm(live, { force: true });
  await fs.copyFile(snapshot, live);
  return "copy";
}

/* Для тестов: как снимок встаёт на место (ссылкой или копией). */
export const restoreSnapshotForTests = restoreSnapshot;

/* Что движок оставляет рядом с недостроенным своим dlc (`build-rpf-dlc`): сам файл и маркер сборки. Имена — только от пути живого
   архива из журнала, чужих путей в них нет. */
const EXPRESS_LEFTOVERS = [".astral-part", ".astral-building"];

/*
 * Ошибка экспресс-фазы транзакции (19.11.2026, откат на старый путь, `INSTALL-RUST-EXPRESS.md` §14): сборка движком, сверка
 * построенного, имя в доме сборок. Транзакция всё откатывает снимками, а метка говорит вызывающему, что виноват новый путь и
 * то же можно поставить прежним. Отмена (сигнал, `AbortError`, `CANCELLED`) меткой не метится: её откатом на старый путь не лечат.
 */
const isCancelError = (error) => error?.name === "AbortError" || error?.code === "CANCELLED";

function markExpressFailure(error, relativePath, signal) {
  if (!error || typeof error !== "object" || signal?.aborted === true || isCancelError(error)) return error;
  try {
    Object.defineProperty(error, "expressFailure", { value: { target: String(relativePath || "") }, enumerable: false, configurable: true });
  } catch {
    /* замороженная ошибка — остаётся без метки: откат не сработает, ошибка уйдёт как была */
  }
  return error;
}

async function restoreSnapshots(journal, { appendRuns = null } = {}) {
  for (const item of [...journal.files].reverse()) {
    /* Дозапись в живой архив (`append-item.js`): снимка у неё нет, прежние байты держит журнал движка. В этом процессе запись снимает
       сама установка (`undo`), после обрыва — хук приложения по точке (`registerAppendRecovery`). */
    if (item.append) {
      const run = appendRuns?.get(journal.files.indexOf(item));
      if (run) await run.undo?.();
      else await undoAppendJournalItem({ ...item.append, livePath: item.livePath });
      continue;
    }
    await fs.mkdir(path.dirname(item.livePath), { recursive: true });
    /* Свой dlc строил движок на месте: недостроенное уходит до того, как на место вернётся прежний файл. */
    if (item.express) for (const suffix of EXPRESS_LEFTOVERS) await fs.rm(`${item.livePath}${suffix}`, { force: true }).catch(() => {});
    if (item.existed && (await exists(item.snapshot))) await restoreSnapshot(item.snapshot, item.livePath);
    else await fs.rm(item.livePath, { force: true });
    await fs.rm(item.stagePath || "", { force: true }).catch(() => {});
    /* Подмену вёл движок: его точка и стейдж уходят вместе со снимком (журнал записал их до вызова). */
    if (item.engine && engineLeftoversSafe(item.engine)) {
      await fs.rm(item.engine.pointRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(item.engine.stageDir, { recursive: true, force: true }).catch(() => {});
      /* «До» рядом с живым архивом (установка из операций): байты уже вернул снимок, вторая ссылка не нужна. */
      if (engineBesideSafe(item.engine, item.livePath)) await fs.rm(item.engine.beforeBeside, { force: true }).catch(() => {});
    }
  }
}

/* Пути из журнала удаляются только если это имена, которые выдаёт `engine-swap.js`:
   повреждённый журнал не должен увести уборку за пределы точек и папки архива. */
const ENGINE_POINT_ID = /^rpf-[A-Za-z0-9_-]{1,70}$/;
const ENGINE_STAGE_NAME = /^\.astral-stage-[A-Za-z0-9_.-]{1,64}$/;
function engineLeftoversSafe(engine) {
  return (
    path.isAbsolute(String(engine.pointRoot || "")) &&
    ENGINE_POINT_ID.test(path.basename(String(engine.pointRoot))) &&
    path.isAbsolute(String(engine.stageDir || "")) &&
    ENGINE_STAGE_NAME.test(path.basename(String(engine.stageDir)))
  );
}

/* Вторая ссылка на прежний архив удаляется, только если это ровно `<живой архив>.astral-before-<точка>` этой же точки. */
function engineBesideSafe(engine, livePath) {
  const beside = String(engine.beforeBeside || "");
  return (
    path.isAbsolute(beside) &&
    String(livePath || "") !== "" &&
    beside === `${livePath}.astral-before-${engine.pointId}` &&
    ENGINE_POINT_ID.test(String(engine.pointId || ""))
  );
}

/* В журнал пишется только то, что переживёт перезапуск: функции движка остаются в памяти. */
function journalRecord(item) {
  const { engineSwap, expressBuild, appendBuild, ...plain } = item;
  if (expressBuild) return { ...plain, express: true };
  if (appendBuild) {
    const { kind, pointId, gameRoot, archive, stateBefore = null, stateAfter = null, alsoPoints = null } = appendBuild;
    return {
      ...plain,
      append: { kind, pointId, gameRoot, archive, ...(stateBefore ? { stateBefore } : {}), ...(stateAfter ? { stateAfter } : {}), ...(alsoPoints?.length ? { alsoPoints } : {}) },
    };
  }
  if (!engineSwap) return plain;
  return {
    ...plain,
    engine: {
      pointId: engineSwap.pointId,
      stageName: engineSwap.stageName,
      pointRoot: engineSwap.pointRoot,
      stageDir: engineSwap.stageDir,
      ...(engineSwap.beforeBeside ? { beforeBeside: engineSwap.beforeBeside } : {}),
    },
  };
}

async function cleanupJournal(journal) {
  await removeBesideSnapshots(journal.directory);
  await fs
    .rm(journal.directory, { recursive: true, force: true })
    .catch(() => {});
}

/* Состояние «после отката записи» рядом с журналом транзакции (`runJournal`, запись вида `rollback`). */
const FORWARD_STATE = "forward-state.json";

/*
 * Доводка «вперёд»: транзакция из одних откатов записи дозаписи, оборванная после вызова движка. Откат повторяется хуком приложения
 * (идемпотентен), потом пишется заранее положенное состояние «после». Не вышло (хука нет, откат отказан, файла состояния нет — журнал
 * прежней сборки) — `false`: состояние остаётся прежним, как раньше.
 */
async function finishRollbacksForward({ journal, directory, stateDir, writeState }) {
  if (journal.phase !== "committing" || typeof writeState !== "function") return false;
  if (!Array.isArray(journal.files) || !journal.files.length || !journal.files.every((item) => item.append?.kind === "rollback")) return false;
  let forward;
  try {
    forward = JSON.parse(await fs.readFile(path.join(directory, FORWARD_STATE), "utf8"));
  } catch {
    return false;
  }
  if (!forward || forward.lastTransaction !== journal.id) return false;
  for (const item of journal.files) if (!(await redoRollbackJournalItem({ ...item.append, livePath: item.livePath }))) return false;
  await writeState(forward, stateDir);
  return true;
}

export async function recoverTransactions({ stateDir, statePaths, readState, writeState = null }) {
  const paths = statePaths(stateDir);
  /* Состояние разбирается, только если есть что восстанавливать: каталог
     транзакций есть всегда, а файл состояния — десятки мегабайт, и окно
     спрашивало профиль сотни раз — каждый раз два разбора вместо одного. */
  const names = (await fs.readdir(paths.transactions).catch(() => [])).filter(
    (name) => !activeTransactions.has(name),
  );
  if (!names.length) return [];
  const state = await readState(stateDir);
  const recovered = [];
  for (const name of names) {
    const directory = path.join(paths.transactions, name);
    const journalFile = path.join(directory, "journal.json");
    try {
      const journal = JSON.parse(await fs.readFile(journalFile, "utf8"));
      let action = state.lastTransaction === journal.id ? "finalized" : "rolled-back";
      if (state.lastTransaction !== journal.id && journal.phase !== "committed") {
        if (await finishRollbacksForward({ journal, directory, stateDir, writeState })) {
          action = "finalized";
          state.lastTransaction = journal.id;
        } else await restoreSnapshots({ ...journal, directory });
      }
      await cleanupJournal({ ...journal, directory });
      recovered.push({ id: journal.id, action });
    } catch {
      /* Журнала нет или он не читается: подмены не было (журнал пишется до неё), снимки рядом — лишние имена живых файлов. */
      await removeBesideSnapshots(directory);
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
  return recovered;
}

export async function transactWithJournal(options) {
  options.throwIfAborted(options.signal ?? null);
  const id = randomUUID();
  /* До каталога транзакции: восстановление, пришедшее посреди, его не тронет. */
  activeTransactions.add(id);
  try {
    return await runJournal({ ...options, id });
  } finally {
    activeTransactions.delete(id);
  }
}

async function runJournal({
  id,
  stateDir,
  current,
  next,
  targetId,
  affected,
  action,
  signal = null,
  onPrepared = null,
  onStaging = null,
  statePaths,
  snapshotTarget,
  atomicJson,
  writeState,
  throwIfAborted,
  linkFile = fs.link,
}) {
  const paths = statePaths(stateDir);
  const directory = path.join(paths.transactions, id);
  /* Снимки, вставшие ссылкой рядом с живым файлом (хранилище на другом томе). */
  const besideSnapshots = [];
  /* Функции подмены движка по индексу файла журнала: в журнал на диске они не попадают. */
  const engineRuns = new Map();
  /* То же для своего dlc, который движок строит сразу на месте (`express-item.js`). */
  const expressRuns = new Map();
  /* И дозапись в живой архив мода каталога (`append-item.js`): запись журнала без снимка. */
  const appendRuns = new Map();
  await fs.mkdir(path.join(directory, "snapshots"), { recursive: true });
  const journal = {
    id,
    targetId,
    action,
    phase: "prepared",
    createdAt: new Date().toISOString(),
    files: [],
    directory,
  };
  /*
   * Самая долгая тишина всей установки. Перед подменой каждый файл копируется
   * дважды: живой уходит в снимок для отката, собранный ложится рядом с ним.
   * На update.rpf это четыре гигабайта и двадцать секунд — треть операции, и
   * ровно та её часть, где написано «прерывать уже нельзя». Байты считаются
   * сквозными: полоса идёт от начала подготовки до конца, а не начинается
   * заново на каждом файле.
   */
  const staging = onStaging
    ? {
        copied: 0,
        total: (
          await Promise.all(
            affected.map(async (item) => {
              if (item.appendBuild) return 0;
              const live = (await exists(item.livePath))
                ? (await fs.lstat(item.livePath)).size
                : 0;
              const source = item.sourcePath
                ? (await fs.lstat(item.sourcePath)).size
                : 0;
              return live + source;
            }),
          )
        ).reduce((sum, value) => sum + value, 0),
      }
    : null;
  const stagingReporter = staging
    ? (copied) =>
        onStaging({
          copiedBytes: staging.copied + copied,
          totalBytes: staging.total,
        })
    : null;

  const beforeTarget = current.targets?.[targetId];
  const before = snapshotTarget(beforeTarget);
  const beforeIds = (beforeTarget?.installed || []).map((item) => item.modId);
  next.restorePoints ||= {};
  const restorePointKey = checkedRecordKey(targetId, "Target ID");
  setRecordValue(
    next.restorePoints,
    restorePointKey,
    [
      {
        id,
        action,
        createdAt: journal.createdAt,
        installedCount: beforeIds.length,
        installedIds: beforeIds,
        snapshot: before,
      },
      ...(Array.isArray(ownRecordValue(next.restorePoints, restorePointKey))
        ? ownRecordValue(next.restorePoints, restorePointKey)
        : []),
    ].slice(0, ENGINE_RESTORE_POINTS),
  );
  try {
    for (const [index, item] of affected.entries()) {
      throwIfAborted(signal);
      if (item.appendBuild) {
        /* Жёсткая ссылка-снимок живого файла запретила бы дозапись (`Linked`), копия — это те самые гигабайты. */
        appendRuns.set(journal.files.length, item.appendBuild);
        journal.files.push({ ...journalRecord(item), snapshot: null, existed: true, stagePath: null });
        continue;
      }
      const existed = await exists(item.livePath);
      let snapshot = path.join(directory, "snapshots", String(index));
      if (existed && !(await linkSnapshot(item.livePath, snapshot, linkFile))) {
        const beside = besideSnapshotPath(item.livePath, id);
        await atomicJson(path.join(directory, BESIDE_LIST), [...besideSnapshots, beside]);
        await fs.rm(beside, { force: true }).catch(() => {});
        if (await linkSnapshot(item.livePath, beside, linkFile)) {
          besideSnapshots.push(beside);
          snapshot = beside;
        } else
          await copyFileCancellable(
            item.livePath,
            snapshot,
            signal,
            stagingReporter,
          );
      }
      if (existed && staging) staging.copied += (await fs.lstat(snapshot)).size;
      const stagePath = item.sourcePath
        ? await copyAtomic(
            item.sourcePath,
            item.livePath,
            id,
            signal,
            stagingReporter,
            item.sha256 || "",
            { link: item.link === true, move: item.move === true, mismatch: String(item.mismatch || "") },
          )
        : null;
      if (staging && stagePath)
        staging.copied += (await fs.lstat(stagePath)).size;
      if (item.engineSwap) engineRuns.set(journal.files.length, item.engineSwap);
      if (item.expressBuild) expressRuns.set(journal.files.length, item.expressBuild);
      journal.files.push({ ...journalRecord(item), snapshot, existed, stagePath });
      throwIfAborted(signal);
    }
    await atomicJson(path.join(directory, "journal.json"), journal);
  } catch (error) {
    for (const item of journal.files)
      await fs.rm(item.stagePath || "", { force: true }).catch(() => {});
    await cleanupJournal(journal);
    throw error;
  }
  try {
    throwIfAborted(signal);
    onPrepared?.();
    await pauseBeforeSwap();
    journal.phase = "committing";
    await atomicJson(path.join(directory, "journal.json"), journal);
    const expressBuilt = [];
    for (const [index, item] of journal.files.entries()) {
      throwIfAborted(signal);
      await fs.mkdir(path.dirname(item.livePath), { recursive: true });
      if (item.append) {
        /* Дозапись (или откат записи) движком в живой архив: отказ — откат этой записи ниже, а установка уходит на прежний путь. */
        const run = appendRuns.get(index);
        /* Откат записи нельзя отменить (прежних тел уже нет), зато его можно довести: состояние «после отката» ложится рядом с журналом
           до вызова движка, и процесс, умерший после отката, при следующем запуске дописывает состояние (`finishRollbacksForward`). */
        if (item.append.kind === "rollback" && typeof run.forwardState === "function" && journal.files.every((file) => file.append?.kind === "rollback")) {
          /* Запись состояния «после» — подспорье доводке, а не условие снятия: не легла — снятие идёт как раньше. */
          try {
            const forward = run.forwardState();
            forward.lastTransaction = id;
            await atomicJson(path.join(directory, FORWARD_STATE), forward);
          } catch {
            await fs.rm(path.join(directory, FORWARD_STATE), { force: true }).catch(() => {});
          }
        }
        const outcome = await run.run();
        await run.onDone?.(outcome);
        await pauseAfterAppend();
        continue;
      }
      if (item.express) {
        /* Свой dlc движок пишет сразу под живым именем (`build-rpf-dlc`: рядом, печать, имя). Прежний файл уже держит
           снимок, поэтому имя освобождается; отказ сборки или сверки уходит в откат снимком ниже. */
        const build = expressRuns.get(index);
        await fs.rm(item.livePath, { force: true });
        try {
          const outcome = await build.run();
          await build.onDone?.(outcome);
          expressBuilt.push({ build, outcome, relativePath: item.relativePath });
        } catch (error) {
          throw markExpressFailure(error, item.relativePath, signal);
        }
        continue;
      }
      if (item.engine) {
        /* Движок собирает рядом, пишет точку отката, подменяет и проверяет сам. Его отказ
           уходит в откат снимком ниже: журнал уже знает точку и стейдж. */
        const swap = engineRuns.get(index);
        const outcome = await swap.run();
        swap.onDone?.(outcome);
        continue;
      }
      if (item.sourcePath) {
        const old = `${item.livePath}.astral-old-${id}`;
        if (await exists(item.livePath)) await fs.rename(item.livePath, old);
        try {
          await fs.rename(item.stagePath, item.livePath);
        } catch (error) {
          if (await exists(old)) await fs.rename(old, item.livePath);
          throw error;
        }
        await fs.rm(old, { force: true });
      } else await fs.rm(item.livePath, { force: true });
    }
    /* Построенные на месте свои пакеты получают имя в доме сборок (`express-item.js`, `shareExpressBuild`) — когда
       построены и сверены все: сверка стоит у последнего из них. Отказ здесь — тот же откат снимком. */
    for (const { build, outcome, relativePath } of expressBuilt) {
      try {
        await build.share?.(outcome);
      } catch (error) {
        throw markExpressFailure(error, relativePath, signal);
      }
    }
    /* Подменённые файлы со сверенным отпечатком: следующей операции не
       нужно перечитывать два гигабайта, чтобы узнать свой же архив. */
    for (const item of journal.files)
      if (item.sourcePath && item.sha256) await rememberSha256(item.livePath, item.sha256).catch(() => {});
    next.lastTransaction = id;
    await writeState(next, stateDir);
    journal.phase = "committed";
    await atomicJson(path.join(directory, "journal.json"), journal);
    await cleanupJournal(journal);
    return next;
  } catch (error) {
    await restoreSnapshots(journal, { appendRuns });
    await writeState(current, stateDir).catch(() => {});
    await cleanupJournal(journal);
    throw error;
  }
}
