/*
 * Почему вещь каталога не встала — одной строкой в журнал приложения (23.11.2026: «На персонажа не встало» не называла причину, а `catalogPackageOf(...).catch(() => null)` и пустые `catch` Desktop
 * глотали её молча). Без токенов и адресов: id вещи каталога (публичный), статус ответа и слово причины. Одна строка на причину не чаще раза в минуту — журнал не забивается.
 * Новых слов человеку нет — плашка прежняя.
 */
import { grantStatusOf, isGrantCancelled, isGrantSkipped, isRateLimited } from "./grant-level.js";

const QUIET_MS = 60_000;
const told = new Map();

/** Слово причины из ошибки: `limit` (предел выдачи), `session`, `closed`, `unavailable` (ответ сервера не годится), `other`. */
export function grantReasonOf(error) {
  const text = String(error?.message || "");
  if (isRateLimited(error)) return "limit";
  if (/no longer valid|Sign in to download/i.test(text)) return "session";
  if (/CATALOG_CLOSED/.test(text)) return "closed";
  if (/download grant is unavailable/i.test(text)) return "unavailable";
  return "other";
}

/** Строка журнала про ссылку или `null`: фон без слота и отменённая вещь в кадре — не отказ, их не пишем. */
export function grantFailureLine(item, error) {
  if (isGrantSkipped(error) || isGrantCancelled(error)) return null;
  const status = grantStatusOf(error);
  return `wear-grant: вещь каталога не получила ссылку на пакет: id=${String(item?.id || "?").slice(0, 40)}, HTTP ${status ?? "-"}, причина ${grantReasonOf(error)}`;
}

/** Строка журнала про вещь, которую Desktop не поставил на персонажа (`answer.failed`: `{ slot, id, stage, code }`, слова без путей). */
export function characterFailureLine(failure) {
  const clean = (value, size) => String(value ?? "?").replace(/[^A-Za-z0-9_.@-]/g, "").slice(0, size) || "?";
  return `wear-character: вещь не встала на персонажа: слот=${clean(failure?.slot, 24)}, id=${clean(failure?.id, 40)}, этап ${clean(failure?.stage, 16)}, код ${clean(failure?.code, 40)}`;
}

/** Записать строку (`window.modovik.writeAppLog`); та же причина — не чаще раза в `QUIET_MS`; журнала нет (браузер, проверки) — молчим. */
export function writeWearLog(message, { host = typeof window === "undefined" ? null : window.modovik, now = Date.now(), quiet = QUIET_MS } = {}) {
  if (!message) return false;
  /* Причина — строка без id: один и тот же отказ у разных вещей не повторяется чаще раза в минуту. */
  const reason = message.replace(/id=[^,]*/, "id=*");
  if (told.has(reason) && now - told.get(reason) < quiet) return false;
  told.set(reason, now);
  if (told.size > 200) told.delete(told.keys().next().value);
  try {
    void Promise.resolve(host?.writeAppLog?.({ level: "warn", source: "wear", message })).catch(() => {});
  } catch {
    /* журнал не должен ронять примерку */
  }
  return true;
}

/** Забыть, что уже писали (тесты). */
export const forgetWearLog = () => told.clear();

export function logGrantFailure(item, error, options) {
  return writeWearLog(grantFailureLine(item, error), options);
}

/** Вещь комплекта осталась без пакета: причина — в журнал, вещь честно «не встала» (`null`). */
export function grantLost(item, error) {
  logGrantFailure(item, error);
  return null;
}
