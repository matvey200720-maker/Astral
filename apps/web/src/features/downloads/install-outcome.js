/*
 * Чем кончилась операция очереди каталога — словами игрока.
 *
 * Раньше отказ мелькал всплывашкой на три секунды сырым текстом движка,
 * строка очереди исчезала, и повторить было нечем. Теперь отказ остаётся
 * строкой в «Загрузках»: что случилось, что сделать, и «Повторить». Что
 * значит отказ — решает utils/installFailure.js, общий с очередью
 * «Применить» мастерской; слова всплывашек на языке окна — в
 * downloads-copy.js.
 */
export {
  describeInstallFailure,
  failureWords,
  humanFailure,
  isCancellation,
} from "../../utils/installFailure.js";
export { failureNotice, successNotice } from "./downloads-copy.js";

/* Сколько строк очереди ещё впереди: неудачные ждут «Повторить» и не в счёт. */
export function pending(queue) {
  return queue.filter((item) => !item.failed).length;
}
