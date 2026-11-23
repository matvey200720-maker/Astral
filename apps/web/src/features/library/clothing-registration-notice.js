import { clothingNotice } from "./clothing-registration-copy.js";

/*
 * Страж регистрации DLC одежды (13.11.2026, `apps/desktop/src/clothing-registration-heal.js`): Astral вернул регистрацию, которую стёрли снаружи (лаунчер Rockstar,
 * Steam, ручная подмена update.rpf), или не смог — окно говорит об этом коротко, один раз. Итог приходит событием и ещё лежит в главном процессе до первого вопроса:
 * страж может закончить раньше, чем окно подпишется.
 *
 * Модуль и слова (шесть языков) грузятся лениво из `startup-recovery.js` (`useStartupRecovery`): в стартовом куске оболочки остаётся только обвязка,
 * бюджет куска держит `verify-web-architecture`.
 *
 * `host` — мост приложения; `latest()` отдаёт свежие `{ notify, language }` в момент показа, а не подписки. Возвращает отписку.
 */
export function watchClothingRegistration(host, latest) {
  if (typeof host?.takeClothingRegistration !== "function") return () => {};
  let alive = true;
  const take = async () => {
    try {
      const taken = await host.takeClothingRegistration();
      if (!alive || !taken) return;
      /* Итогов бывает несколько подряд (регистрация и паки): главный процесс отдаёт массив, окно показывает каждый. */
      for (const result of [].concat(taken)) {
        const { notify, language } = latest();
        const notice = clothingNotice(result, language);
        if (notice) notify?.(notice.text, notice.tone);
      }
    } catch {
      // уведомление необязательно: итог записан в журнал приложения
    }
  };
  void take();
  const unsubscribe = host.onClothingRegistration?.(() => void take());
  return () => {
    alive = false;
    unsubscribe?.();
  };
}
