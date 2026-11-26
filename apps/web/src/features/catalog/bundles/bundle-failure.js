import { describeInstallFailure } from "../../../utils/installFailure.js";
import { readForeignConflicts } from "./bundle-api.js";
import { bundleCopy, bundlePartsLabel } from "./bundle-copy.js";
import { dropBundleRest } from "./bundle-state.js";
import { failureNotice } from "../../downloads/downloads-copy.js";
import { bundleStopNotice, heldRowsOf, requeueHeld, settleBundleRow, withForeignList } from "../../downloads/foreign-hold.js";
import { isQuietRefusal } from "../../library/waiting-mods.js";
import { deferRefusedRow } from "../../downloads/deferred-installs.js";

/*
 * Исход отказа части сборки в очереди «Загрузок» (разбор 17.11.2026, `docs/beta/incident-2026-11-17-build-foreign-conflict.md`). Правила — `features/downloads/foreign-hold.js`;
 * здесь они сведены с прежним путём (`dropBundleRest`, Т-81d) и словами сборки. Модуль ленивый: оболочка берёт его по `import()` при первом отказе установки,
 * в стартовый кусок он не входит (потолок `main-*.js` и строк оболочки).
 */

/**
 * Отказ установки в очереди «Загрузок»: разбор ошибки, слово человеку и список файлов вопроса. Ход оболочки (`catch` строки очереди) зовёт это одним вызовом.
 * Слово: отмена — «отменено»; тихая попытка ждущего компонента — молчание (отказанный релиз движок запомнил, «Библиотека» скажет строкой); часть сборки —
 * `stopNotice`; одиночная установка — «Не удалось установить…» с отсылкой в «Загрузки». Одиночная установка, отказанная из-за запущенной GTA V, не «Не удалось»:
 * она уходит в отложенные (`deferred-installs.js`) и встаёт сама, когда игру закроют, — строка снимается тихо.
 * @param {object} shell `error`, `current` (строка очереди), `language`, `notify(text, tone)`, `cancelled` (слово об отмене), `readConflicts` (мост к списку спорных файлов; по умолчанию настоящий)
 * @returns {Promise<{ failure: object | null, quiet: boolean }>} `failure` — `null` для отмены; `quiet` — без строки «Не удалось»
 */
export async function settleInstallFailure({ error, current, language, notify, cancelled, readConflicts = readForeignConflicts }) {
  const described = describeInstallFailure(error, language);
  if (deferRefusedRow({ error, row: current, notify })) return { failure: described, quiet: true };
  const quiet = isQuietRefusal(current, described);
  if (quiet) return { failure: described, quiet };
  const failure = await withForeignList(described, readConflicts);
  if (!failure) notify(cancelled);
  else if (current.bundleId) {
    const said = stopNotice(language, current, failure);
    notify(said.text, said.tone);
  } else notify(failureNotice(current, failure, language), "error");
  return { failure, quiet };
}

/** Слово оболочки об отказе части сборки на языке окна: вопрос ждёт ответа, «оставил своё» — пометка, остальное — остановка с причиной и тем, что делать. */
export const stopNotice = (language, row, failure) => bundleStopNotice(bundleCopy(language), row, failure);

/**
 * Строки снятия, что ждут успеха этой строки (`after`: служебное «прочее» ганпака ждёт снятия его стволов, `removePackExtras`): строка не удалась или её отменили — они не нужны, иначе ствол остался бы в игре без своих
 * обвесов. Ждущие строки, что уже идут или упали сами, остаются.
 */
export const withoutDependents = (queue, current) =>
  queue.filter((row) => !(row.operation === "remove" && Array.isArray(row.after) && row.after.includes(current?.id) && !row.started && !row.failed));

/**
 * Очередь после отказа строки. Вопрос о чужих файлах и «оставил своё» сборку не останавливают (`settleBundleRow`); любой другой отказ части — по-прежнему:
 * остальные ждущие части сборки снимаются с очереди, а строка остаётся «Не удалось» с причиной и «Повторить».
 */
export function afterFailure(queue, current, failure) {
  const settled = settleBundleRow(queue, current, failure);
  if (settled) return settled;
  return dropBundleRest(withoutDependents(queue, current), current).map((row) => (row.queueId === current.queueId ? { ...row, started: false, progress: 0, failed: failure } : row));
}

/**
 * «Повторить» у части, ждущей ответа: все ждущие части той же сборки встают заново теми же строками, человеку сказано, сколько частей в очереди.
 * `shell` — состояние оболочки: `queue` (что видит окно), `setQueue`, `notify`, `language`.
 */
export function retryHeld({ queue, item, setQueue, notify, language }) {
  const parts = heldRowsOf(queue, item.queueId).length;
  setQueue((previous) => requeueHeld(previous, item.queueId));
  notify(bundleCopy(language).queued(item.bundleName, bundlePartsLabel(parts, language)));
}
