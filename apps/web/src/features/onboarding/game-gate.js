import { useEffect, useState } from "react";

/*
 * GTA V обязательна для всех (владелец, 15.11.2026). Первый запуск без подтверждённой папки не кончается (`finishOnboarding`),
 * а человек, который уже вошёл, но папки игры нет (не выбирал или она пропала), при запуске попадает на шаг «GTA V найдена /
 * не найдена» до Главной и без папки дальше не проходит (плашку «GTA V не найдена» в заголовке зона shell убрала, подсказки в окне нет).
 *
 * Условие — только «вошёл, игры нет»; сам поиск игры и выбор папки живут там же, где жили (`DesktopShell`, `GamePickerStep`).
 * `exempt` — предпросмотр, демо, разработчик и песочница входа: у них игры нет по замыслу, закрывать им окно нельзя.
 */
export function gameStepRequired({
  bootstrapped,
  onboardingComplete,
  signedIn,
  exempt,
  gameTargetId,
}) {
  return Boolean(
    bootstrapped && onboardingComplete && signedIn && !exempt && !gameTargetId,
  );
}

/**
 * Шаг игры держится, пока человек не подтвердит папку: найденная копия выбирается в оболочке сразу, а экран должен дожить до
 * нажатия «Использовать эту копию», иначе окно открылось бы Главной раньше подтверждения.
 */
export function useGameGate(state) {
  const required = gameStepRequired(state);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (required) setHeld(true);
  }, [required]);
  return {
    active: required || held,
    /** Подтверждение: сначала то, что делал первый запуск (`finishOnboarding`), потом шаг игры отпускает окно. */
    finish: (confirm) => {
      confirm();
      setHeld(false);
    },
  };
}
