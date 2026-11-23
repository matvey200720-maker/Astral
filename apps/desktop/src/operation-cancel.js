/*
 * Отмена операции и как о ней говорит журнал (17.11.2026, бета.107).
 *
 * Две части сборки при установке из каталога оборвались с `AbortError: This operation was aborted`, и журнал записал это как `[error] install-remote-package` со стеком, а строка установки — как
 * «ошибка». Окно при этом честно показало «Отменено»: отмена шла по запросу окна (`CANCEL_OPERATION` → `controller.abort()`, единственный путь, которым очередь загрузок прерывает операцию).
 * Отмена — не сбой: журнал называет её отменой, а сам запрос окна оставляет строкой ДО прерывания, чтобы причина стояла рядом со следствием.
 */

/**
 * Отказ операции — отмена, а не сбой. Отмену несёт `AbortError`: причина по умолчанию у `controller.abort()` и отказ «Установка отменена пользователем.» хоста и сборщика. Остановка дозором запуска игры
 * (`controller.abort(error)`) приходит с настоящей причиной и отменой не считается; срок — `TimeoutError`.
 */
export const isCancellation = (error) => error?.name === "AbortError";

const clip = (id) => String(id ?? "").slice(0, 120);

/**
 * Запрос окна остановить операцию `operationId`. Строка в журнал — до `abort()`; сбой записи отмену не останавливает.
 * @returns {{ cancelled: boolean, reason?: string }}
 */
export function cancelActiveOperation({ activeOperations, operationId, record }) {
  const id = clip(operationId);
  const controller = activeOperations.get(id);
  try {
    record({
      level: "info",
      source: "install",
      message: controller ? `отмена: окно запросило остановить «${id}»` : `отмена: окно просило остановить «${id}», но такой операции уже нет`,
    });
  } catch {
    // журнал не должен мешать отмене
  }
  if (!controller) return { cancelled: false, reason: "not-active" };
  controller.abort();
  return { cancelled: true };
}
