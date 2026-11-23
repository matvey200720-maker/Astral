/*
 * Отказы редукса словами (волна `speed/redux-usable`, шаг 3). Из главного процесса в окно доходит только текст ошибки, поэтому отказ
 * называется короткой русской фразой, которая начинается с «Редукс: »: по ней окно находит семейство отказа
 * (`apps/web/src/utils/installFailure.js`, семейства `redux-*`) и показывает слова на языке окна. Коды движка и подробности человеку
 * не показываются (они остаются в журнале главного процесса).
 *
 *   key      KeyShifted, KeyPadTooLong, ForeignChange: `update.rpf` изменился вне Astral или ключ длины не удержать — «Вернуть как было»;
 *   damaged  NOT_INTACT: файл dlc пропал или не тот — «Вернуть как было» уберёт повреждённое, поставить можно заново;
 *   covered  LayerRequires, LayerCovered: сверху лежит другой слой — сначала его;
 *   failed   всё остальное: игра не тронута.
 */

export const REDUX_REFUSAL_TEXT = Object.freeze({
  key: "Редукс: файл игры изменился вне Astral, и слой нельзя переключить.",
  damaged: "Редукс: файлы редукса пропали или повреждены.",
  covered: "Редукс: поверх этого слоя лежит другой, и сначала нужен он.",
  failed: "Редукс: Astral не смог переключить слой.",
});

const KEY_CODES = new Set(["KEY_SHIFTED", "KEY_PAD_TOO_LONG", "KeyShifted", "KeyPadTooLong", "ForeignChange"]);
const COVERED_CODES = new Set(["LayerRequires", "LayerCovered"]);

function codesOf(error) {
  const out = [];
  for (let at = error, depth = 0; at && depth < 4; at = at.cause, depth += 1) if (at.code) out.push(String(at.code));
  return out;
}

/** `{ kind, text, repair }`: семейство отказа, фраза для окна и нужна ли «Вернуть как было». */
export function reduxRefusal(error) {
  const codes = codesOf(error);
  const kind = codes.some((code) => KEY_CODES.has(code)) ? "key" : codes.includes("NOT_INTACT") ? "damaged" : codes.some((code) => COVERED_CODES.has(code)) ? "covered" : "failed";
  return { kind, text: REDUX_REFUSAL_TEXT[kind], repair: kind !== "covered" };
}
