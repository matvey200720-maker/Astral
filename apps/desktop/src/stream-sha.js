/*
 * Отпечаток по ходу записи (19.11.2026, пункт 2 задания ведущей; `launcher_app/docs/INSTALL-STREAM-SHA-1911.md`).
 *
 * Движок, собрав `update.rpf`, читал готовый файл ещё раз ради SHA-256 — 1,9 ГиБ чтения на сборку. С выключателем
 * `ASTRAL_ENGINE_STREAM_SHA=1` отпечаток считает читатель, идущий за писателем: отдельного прохода нет, байты архива и
 * сам отпечаток те же. Выключатель читает движок из своего окружения; приложение только ставит его при старте.
 *
 * Умолчание по каналам: в альфе включён, в бете и релизе не трогается. Слово в окружении (`0`, `off`, `1`) сильнее
 * умолчания канала.
 *
 * Страховка. 14.11 такие сборки на холодном кэше системы изредка отказывала проверка результата движка («damaged nested
 * archives»); после двух правок движка отказов не было ни разу, но если такой отказ придёт — отпечаток по ходу записи
 * выключается до перезапуска приложения, сборка тут же повторяется прежним порядком, в журнале остаётся строка. Человек
 * без установки не остаётся. Видимых человеку строк здесь нет.
 */

/** Выключатель движка: `1` — отпечаток по ходу записи. */
export const STREAM_SHA_ENV = "ASTRAL_ENGINE_STREAM_SHA";

/** Канал, где отпечаток по ходу записи включён по умолчанию. */
export const STREAM_SHA_CHANNEL = "alpha";

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyStreamShaDefault({ channel, env = process.env } = {}) {
  if (channel !== STREAM_SHA_CHANNEL) return null;
  if (String(env[STREAM_SHA_ENV] ?? "").trim() !== "") return null;
  env[STREAM_SHA_ENV] = "1";
  return "1";
}

/** Движок получит включённый выключатель (он понимает только `1`). */
export const streamShaOn = (env = process.env) => String(env[STREAM_SHA_ENV] ?? "").trim() === "1";

/* Отказы проверки готового архива в движке (`compose.rs: check_result`): только они повторяются прежним порядком. */
const RESULT_CHECK_REFUSALS = /RPF compose damaged nested archives|The rebuilt archive does not open|RPF staged validation failed/i;

/** Сборку отказала проверка результата, а не запрос, диск или отмена. */
export function refusedByResultCheck(error) {
  return RESULT_CHECK_REFUSALS.test(String(error?.message || error || ""));
}

/**
 * Сборка архива движком с возвратом на прежний порядок. `run` — один вызов сборки; его отказ проверкой результата при
 * включённом выключателе выключает отпечаток по ходу записи (до перезапуска приложения) и повторяет вызов один раз.
 * Отмена и прочие отказы уходят как есть.
 *
 * @param {() => Promise<object>} run
 * @param {{env?: Record<string, string | undefined>, beforeRetry?: () => Promise<void>, note?: (error: unknown) => void}} [options]
 */
export async function composeWithStreamShaFallback(run, { env = process.env, beforeRetry = async () => {}, note = () => {} } = {}) {
  try {
    return await run();
  } catch (error) {
    if (error?.name === "AbortError" || !streamShaOn(env) || !refusedByResultCheck(error)) throw error;
    env[STREAM_SHA_ENV] = "0";
    try {
      note(error);
    } catch {
      /* Строка журнала — побочное дело. */
    }
    await beforeRetry();
    return run();
  }
}
