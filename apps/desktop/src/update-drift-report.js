/*
 * Авто-отчёт наблюдателя update.rpf (22.11.2026): мост между `direct-base-tools.js` (наблюдатель движка) и отчётами об ошибках (`desktop-auth.js`). Без импортов — стартовый граф не тяжелеет.
 * Один отчёт на запуск приложения; без подключённого отправителя (до входа в окно, в тестах) — тишина, остаётся только журнал «Логи».
 * В отчёт идёт одна строка: имя архива и огрызки отпечатков по 12 знаков — ни путей, ни имён, ни содержимого. Журнал к такому отчёту не прикладывается (`NO_LOG_KINDS`, `app-errors.js`).
 */
export const UPDATE_DRIFT_KIND = "UpdateBaseDrift";

let send = null;
let sent = false;

/** `send(info)` — отправитель отчёта (главный процесс); `null` — отключить. Новый отправитель начинает «запуск» заново. */
export function setUpdateDriftReporter(next) {
  send = typeof next === "function" ? next : null;
  sent = false;
}

export function reportUpdateDrift({ archive, live, known }) {
  if (!send || sent) return false;
  sent = true;
  try {
    send({ message: `${UPDATE_DRIFT_KIND}: ${archive} live=${live} known=${(known || []).join(",") || "none"}` });
  } catch {
    /* Отправка не мешает сборке. */
  }
  return true;
}
