/*
 * Каналы настроек графики и оптимизации Windows: шаблоны settings.xml
 * (чтение, запись, возврат «как было») и полный цикл оптимизации
 * анализ → план → применение → откат → история.
 *
 * Отдельный модуль по той же причине, что у установщика и хранилища:
 * `main.js` отвечает за жизненный цикл окна, а не за то, из чего состоит
 * сервис оптимизации. Сервис создаётся здесь же и лениво — как раньше в
 * `main.js`, — а всё, что привязано к окну и путям профиля, приходит
 * параметрами, поэтому регистрация проверяется тестом без Electron.
 */

import path from "node:path";
import {
  analyzeGameSettingsPreset,
  applyGraphicsEverywhere,
  configureGraphicsOriginalStore,
  readGraphicsEverywhere,
  restoreGraphicsEverywhere,
} from "./game-settings.js";
import {
  applyMouseSettings,
  readMouseSettings,
  restoreMouseSettings,
} from "./mouse-settings.js";
import { createOptimizationService } from "./optimization.js";

export function registerGameSettingsIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  gtaSettingsPath,
  gtaSettingsStateDir,
  findGame,
  gameProcessRunning,
  emitOptimizationProgress,
}) {
  /* Исходник «до Astral» снимается перед любой записью в settings.xml —
     кем бы она ни была (ТЗ 08.10, задача 1). */
  configureGraphicsOriginalStore(gtaSettingsStateDir);
  let optimizationService = null;
  function getOptimizationService() {
    optimizationService ||= createOptimizationService({
      stateDir: async () => {
        const { stateDir } = await installOptions();
        return path.join(stateDir, "optimization");
      },
      settingsFile: gtaSettingsPath,
      resolveGame: findGame,
      gameProcessRunning,
      emitProgress: emitOptimizationProgress,
    });
    return optimizationService;
  }

  /*
   * Настройки графики (ТЗ 05.10, задача 15). Пока игра запущена, файл не
   * пишется: при выходе GTA V перепишет `settings.xml` своими значениями, и
   * «применено» оказалось бы неправдой.
   */
  async function ensureGameClosed() {
    if (await gameProcessRunning({ executable: "GTA5.exe" }))
      throw new Error(
        "Закройте GTA V: при выходе игра перепишет settings.xml своими настройками.",
      );
  }

  handleIpc(IPC.READ_GAME_SETTINGS, (event) =>
    trusted(event, async () =>
      readGraphicsEverywhere(gtaSettingsPath(), await gtaSettingsStateDir()),
    ),
  );

  handleIpc(IPC.APPLY_GAME_SETTINGS, (event, input) =>
    trusted(event, async () => {
      await ensureGameClosed();
      /* Legacy и Enhanced — в оба файла, какие есть (ТЗ 08.10, задача 5). */
      return applyGraphicsEverywhere(
        safeInput(input),
        gtaSettingsPath(),
        await gtaSettingsStateDir(),
      );
    }),
  );

  handleIpc(IPC.RESTORE_GAME_SETTINGS, (event) =>
    trusted(event, async () => {
      await ensureGameClosed();
      return restoreGraphicsEverywhere(
        gtaSettingsPath(),
        await gtaSettingsStateDir(),
      );
    }),
  );

  /*
   * Чувствительность мыши (круг 6, 29.10.2026): числа в профиле игры
   * (`Profiles/<id>/pc_settings.bin`), а не в settings.xml; запись — только при
   * закрытой игре, по той же причине: при выходе GTA V перепишет профиль.
   */
  async function ensureProfileClosed() {
    if (await gameProcessRunning({ executable: "GTA5.exe" }))
      throw new Error(
        "Закройте GTA V: при выходе игра перепишет профиль со своими настройками мыши.",
      );
  }

  handleIpc(IPC.READ_MOUSE_SETTINGS, (event) =>
    trusted(event, async () =>
      readMouseSettings(gtaSettingsPath(), await gtaSettingsStateDir()),
    ),
  );

  handleIpc(IPC.APPLY_MOUSE_SETTINGS, (event, input) =>
    trusted(event, async () => {
      await ensureProfileClosed();
      return applyMouseSettings(
        safeInput(input),
        gtaSettingsPath(),
        await gtaSettingsStateDir(),
      );
    }),
  );

  handleIpc(IPC.RESTORE_MOUSE_SETTINGS, (event) =>
    trusted(event, async () => {
      await ensureProfileClosed();
      return restoreMouseSettings(gtaSettingsPath(), await gtaSettingsStateDir());
    }),
  );

  handleIpc(IPC.ANALYZE_GAME_SETTINGS, (event, input) =>
    trusted(event, () =>
      analyzeGameSettingsPreset(safeInput(input), gtaSettingsPath()),
    ),
  );

  /* Железо для рекомендации пресета на странице «Графика»: видеокарты, ОЗУ,
     потоки. Без разбора оптимизации — раздел «Оптимизация» скрыт, и полный
     разбор ради трёх чисел был бы тяжёлым. */
  handleIpc(IPC.READ_HARDWARE, (event) =>
    trusted(event, () => getOptimizationService().hardware()),
  );

  handleIpc(IPC.ANALYZE_OPTIMIZATION, (event, input) =>
    trusted(event, () => getOptimizationService().analyze(safeInput(input))),
  );

  handleIpc(IPC.PLAN_OPTIMIZATION, (event, input) =>
    trusted(event, () => getOptimizationService().plan(safeInput(input))),
  );

  handleIpc(IPC.APPLY_OPTIMIZATION, (event, input) =>
    trusted(event, () => getOptimizationService().apply(safeInput(input))),
  );

  handleIpc(IPC.ROLLBACK_OPTIMIZATION, (event, input) =>
    trusted(event, () => getOptimizationService().rollback(safeInput(input))),
  );

  handleIpc(IPC.OPTIMIZATION_HISTORY, (event) =>
    trusted(event, () => getOptimizationService().history()),
  );
}
