/*
 * Отказ «игра запущена» из главного процесса. Начала этих сообщений — внешний контракт (как в `shell-notices.js`):
 * `game-running-refusal.js`, `legacy-runtime-guard.js` и редакторы мест. «update.rpf занят другим процессом. Закройте
 * GTA V, лаунчер проекта и OpenIV…» сюда не входит: там файл держит не обязательно игра, и ждать её закрытия не помогло бы.
 */
const GAME_RUNNING_REFUSAL =
  /Найден процесс:|Закройте GTA V(?: перед |: Astral| — пока игра| и лаунчер проекта)|Игры уже нет, но осталось окно BattlEye Launcher/;

export const isGameRunningRefusal = (error) =>
  GAME_RUNNING_REFUSAL.test(String(error?.message ?? error ?? ""));
