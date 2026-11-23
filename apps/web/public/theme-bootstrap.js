/*
 * Тема, движение и стекло — до первого кадра.
 *
 * Решения обязаны стоять на <html> раньше, чем браузер что-то нарисует:
 * иначе приложение успевает дёрнуть пульсацию загрузочной метки у человека,
 * который анимации выключил. Скрипт обычный, не модуль, поэтому логика
 * выбора здесь повторена, а не взята из src/motion-preference.js — импортов у
 * него нет.
 *
 * Тема и стекло больше не выбираются (владелец, 24.09.2026): приложение
 * всегда тёмное и всегда в ликвид-стекле (`src/glass-switch.css`). Прежний
 * выбор стирается здесь же, до загрузки страницы: главный процесс красит
 * кнопки окна по `modovik-theme`, и оставшееся там «light» дало бы тёмные
 * значки на тёмной шапке.
 */
(() => {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
  try {
    localStorage.removeItem("modovik-theme");
    localStorage.removeItem("modovik-glass");
  } catch {
    /* Заблокированное хранилище не повод не рисовать. */
  }

  try {
    const storedMotion = localStorage.getItem("modovik-motion");
    const choice = ["system", "on", "off"].includes(storedMotion)
      ? storedMotion
      : "system";
    /* Выключает только сам человек; Windows не решает (14.10.2026). */
    document.documentElement.dataset.motion = choice === "off" ? "off" : "full";
  } catch {
    document.documentElement.dataset.motion = "full";
  }

  /*
   * Первый кадр заставки запуска (`#boot-splash` в index.html, сам слой — `src/features/onboarding/splash/`): виден до всяких
   * скриптов. Включается здесь, в продуктовой сборке всегда; в разработке (`data-app-mode` не production) и в песочнице
   * (те же ключи, что в `startup-flow.js`) его нет, пока в адресе нет `?qa-splash`. После сна окна (`?hibernation=1`) знак
   * уже горит — это экран пробуждения.
   */
  try {
    const query = location.search;
    const asked = /[?&]qa-splash/.test(query);
    const quiet =
      document.documentElement.dataset.appMode !== "production" ||
      /[?&](preview|qa|demo|developer|qa-auth)(=|&|$)/.test(query);
    const woke = /[?&](hibernation=1|qa-splash-wake)/.test(query);
    /* Скрытые окна-съёмщики (одежда, ганпаки, части: мост их preload) заставку не монтируют — первого кадра у них нет. */
    const shooter =
      window.astralClothingShooter ||
      window.astralGunpackShooter ||
      window.astralPartShooter;
    document.documentElement.dataset.boot =
      !shooter && (asked || !quiet) ? (woke ? "wake" : "start") : "off";
  } catch {
    document.documentElement.dataset.boot = "off";
  }
})();
