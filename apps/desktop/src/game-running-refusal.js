import { describeProcess } from "./game-processes.js";
import { isLauncherStub } from "./rockstar-mode/process-watch.js";

/*
 * Слова отказа «игра запущена» (T-0002, журнал человека, релиз 1.0.4). С BattlEye лаунчер запускает сначала заглушку
 * `GTA5_BE.exe`, и уже она — игру. Игра зависла и закрылась, окно заглушки осталось висеть, а Astral три раза за минуту
 * отвечал «Закройте GTA V…»: человек искал игру, которой уже нет. Отказ остаётся отказом (пока заглушка жива, BattlEye
 * может держать файлы игры, и писать в них нельзя), но когда найдены только заглушки, слова называют окно BattlEye
 * Launcher и говорят, что сделать. Строка про лаунчеры RP в этом случае не нужна: Astral их не проверяет, а действие одно.
 *
 * Модуль грузится по вызову, в момент отказа (`install-safety.js` в графе старта главного процесса, потолок исходников —
 * `tests/main-startup-imports.test.js`). Окно узнаёт случай по именам в списке «Найден процесс:»: код ошибки через IPC не
 * идёт, и тот же текст разбирают `utils/installFailure.js` (семейство `game-stub`) и `shell-notices.js` (док подготовки).
 * Список `install-safety.js` — только `GTA5*.exe` и заглушки `*_BE.exe`, поэтому «заглушка» здесь — это BattlEye.
 */

/** Текст отказа по найденным процессам игры `[{ name, pid }]` (список не пуст). */
export function runningRefusal(running) {
  const found = running.map(describeProcess).join(", ");
  if (!running.every(({ name }) => isLauncherStub(name))) {
    return `Закройте GTA V перед установкой. Найден процесс: ${found}. Также завершите GTA 5 RP Launcher и Majestic Launcher.`;
  }
  return `Игры уже нет, но осталось окно BattlEye Launcher. Закройте его, а если окна не видно, снимите ${running.map(({ name }) => name).join(", ")} в диспетчере задач, и повторите. Найден процесс: ${found}.`;
}
