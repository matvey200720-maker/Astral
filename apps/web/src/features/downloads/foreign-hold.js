/*
 * Часть сборки упёрлась в чужую правку — «оставить своё или заменить» (разбор 17.11.2026, `docs/beta/incident-2026-11-17-build-foreign-conflict.md`).
 *
 * Движок до записи в игру отказывает `ForeignConflictError` и ждёт ответа человека. Одиночная установка показывала этот вопрос строкой «Загрузок»,
 * а часть сборки шла общим путём отказа: сборка «останавливалась» красным словом без причины, остальные части снимались с очереди, «Повторить» ставил
 * одну часть уже вне сборки. Здесь правила для сборки, чистые функции без зависимостей (в стартовый кусок оболочки не входят — её берёт `import()`):
 *
 * - вопрос — не поломка: часть ждёт ответа строкой «Не удалось» со списком её файлов (`foreign`), остальные части сборки ставятся дальше;
 * - спрашивается один раз на сборку: список файлов — общий у всех ждущих частей, отвечает первая строка (`foreignHoldOf`), «Повторить» ставит их все
 *   заново и остаются частями сборки (`requeueHeld`);
 * - «оставить своё» на всё, что кладёт часть, — не отказ: часть пропускается с пометкой, остальные встают (`settleBundleRow`).
 */

/** Семейства отказа в `utils/installFailure.js`. */
export const FOREIGN_QUESTION = "foreign-build";
export const FOREIGN_KEPT = "foreign-kept";

const lower = (value) => String(value || "").toLowerCase();
const conflictKey = (item) => `${lower(item.archive)}|${lower(item.entry)}`;
const isQuestion = (row) => row?.failed?.kind === FOREIGN_QUESTION;
const hasList = (row) => row?.failed?.foreign?.conflicts?.length > 0;

/**
 * Отказ с файлами, о которых спрашивает движок. Список он оставил рядом с состоянием сразу перед отказом (`readPendingForeignConflicts`), а файл один
 * на всё приложение: следующий отказ его перепишет. Поэтому окно читает его в тот же такт, когда строка отказала, и хранит в самой строке.
 * Мост недоступен или файла нет — отказ как был: строка спросит сама, как у работ мастерской.
 */
export async function withForeignList(failure, readConflicts) {
  if (failure?.kind !== FOREIGN_QUESTION || typeof readConflicts !== "function") return failure;
  try {
    const pending = await readConflicts();
    const conflicts = (pending?.conflicts || [])
      .filter((item) => item && typeof item.entry === "string")
      .map((item) => ({ archive: String(item.archive || "update/update.rpf"), entry: item.entry }));
    if (!conflicts.length) return failure;
    return { ...failure, foreign: { targetId: String(pending.targetId || "default"), conflicts } };
  } catch {
    return failure;
  }
}

/**
 * Очередь после отказа части сборки, если это вопрос или «оставил своё»; для остальных отказов — `null` (прежний путь: сборка останавливается).
 * Вопрос: строка остаётся неудачной и ждёт, остальное в очереди не трогается. «Оставил своё»: части нечего ставить — строка уходит без отказа.
 */
export function settleBundleRow(queue, current, failure) {
  if (!current?.bundleId || !failure) return null;
  if (failure.kind === FOREIGN_KEPT) return queue.filter((row) => row.queueId !== current.queueId);
  if (failure.kind !== FOREIGN_QUESTION) return null;
  return queue.map((row) => (row.queueId === current.queueId ? { ...row, started: false, progress: 0, failed: failure } : row));
}

/** Слово об исходе части сборки: вопрос ждёт ответа (где его дать), «оставил своё» — пометка, остальное — остановка со сказанной причиной и тем, что делать. */
export function bundleStopNotice(words, row, failure) {
  if (failure?.kind === FOREIGN_QUESTION) return { text: words.waitingForeign(row.bundleName, row.name), tone: "error" };
  if (failure?.kind === FOREIGN_KEPT) return { text: words.keptOwn(row.bundleName, row.name), tone: "info" };
  return { text: words.stopped(row.bundleName, row.name), tone: "error" };
}

/**
 * Вопрос строки в общем списке сборки: файлы всех её ждущих частей без повторов и кто отвечает. Первая ждущая часть (в порядке очереди) отвечает за всех —
 * её строка показывает кнопки, остальные только говорят, что ответ общий. Строка вне сборки или без списка файлов — `null`: она спросит сама.
 */
export function foreignHoldOf(row, failedRows = []) {
  if (!isQuestion(row) || !hasList(row)) return null;
  const mine = row.failed.foreign;
  const group = row.bundleId
    ? failedRows.filter(
        (other) => other.bundleId === row.bundleId && isQuestion(other) && hasList(other) && other.failed.foreign.targetId === mine.targetId,
      )
    : [row];
  const seen = new Set();
  const conflicts = [];
  for (const other of group)
    for (const item of other.failed.foreign.conflicts) {
      const key = conflictKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push(item);
    }
  return { targetId: mine.targetId, conflicts, lead: group[0] === row, rowIds: group.map((other) => other.queueId) };
}

/** Ждущие ответа части той же сборки, что и строка `queueId`: их ставит ответ одним разом. */
export function heldRowsOf(queue, queueId) {
  const target = queue.find((row) => row.queueId === queueId);
  if (!target?.bundleId || !isQuestion(target)) return [];
  return queue.filter((row) => row.bundleId === target.bundleId && isQuestion(row));
}

/** Что строка нажила, пока шла: после ответа она встаёт в очередь как новая. */
const RUN_STATE = ["failed", "started", "startedAt", "phase", "phaseStartedAt", "cancellable", "cancelling"];

/**
 * Ждущие части сборки снова в очередь — на своих местах, теми же строками (тот же пакет, замены и `bundleId`: они остаются частями сборки, и «Снять сборку»
 * их снимет). Ответ уже записан движком по всем файлам списка, повторный вопрос не придёт.
 */
export function requeueHeld(queue, queueId, now = Date.now()) {
  const group = heldRowsOf(queue, queueId);
  if (!group.length) return queue;
  const fresh = new Map(
    group.map((row, at) => {
      const next = { ...row, progress: 0, queuedAt: now, queueId: `install-${row.id}-${now}-${at}` };
      for (const key of RUN_STATE) delete next[key];
      return [row.queueId, next];
    }),
  );
  return queue.map((row) => fresh.get(row.queueId) ?? row);
}
