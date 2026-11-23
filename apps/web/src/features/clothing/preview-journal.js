import { writeWindowLog } from "../app-errors/report.js";

/*
 * Журнал предпросмотра вещи (22.11.2026, пустой предпросмотр одежды в Astral 1.0.0). Окно глотало отказы чтения вещи (снимок вещи игры, персонаж из игры,
 * запасной адрес просмотрщика): человек видел значок или пустую сцену, а в журнале приложения было пусто — причину с его машины нельзя было назвать.
 * Теперь на причину ложится запись окна: ступень, код отказа (если он дошёл — по мосту приходит один текст), первая строка слов и имя вещи.
 * Одна и та же причина на одной ступени за запуск пишется один раз (плитки сетки снимаются десятками — журнал не засоряется). Имён пользователя и путей здесь нет.
 * Своё `writeWindowLog` журнал окна ещё и чистит; сбой записи окно не роняет.
 */

const noted = new Set();
const NOTED_LIMIT = 60;
const LINE_LIMIT = 200;

/** Первая строка слов отказа (стек и хвосты не нужны). */
export const firstLine = (error) =>
  String(error?.message ?? error ?? "")
    .split("\n")[0]
    .trim()
    .slice(0, LINE_LIMIT);

/**
 * `source` — «clothing-photo» (снимок вещи игры) или «clothing-preview» (персонаж, цвет, просмотрщик); `stage` — слова ступени; `subject` — имя вещи;
 * `error` — отказ или строка. Возвращает, записано ли.
 */
export function notePreviewFailure({ source = "clothing-preview", stage, subject = "", error = null, level = "warn" }) {
  try {
    const text = firstLine(error) || "без слов";
    const code = String(error?.code || "").slice(0, 60);
    const key = `${source}|${stage}|${code}|${text}`;
    if (noted.has(key)) return false;
    if (noted.size >= NOTED_LIMIT) noted.clear();
    noted.add(key);
    writeWindowLog({
      level,
      source,
      message: `${stage}${code ? ` [${code}]` : ""}: ${text}`,
      detail: subject ? `вещь: ${String(subject).slice(0, 160)}` : "",
    });
    return true;
  } catch {
    return false;
  }
}

/** Забыть записанное (тесты). */
export const forgetPreviewNotes = () => noted.clear();
