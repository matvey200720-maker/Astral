/*
 * Запуск стража регистрации DLC одежды из главного процесса одной строкой (`main.js` держит бюджет строк; образец — `game-crash/boot.js`).
 * Страж — `clothing-registration-heal.js`: сверяет, что игра монтирует DLC одежды Astral, и сам возвращает регистрацию, если её стёрли снаружи.
 *
 * Когда смотрит: через `startDelayMs` после старта (окно и без того поднимается), потом раз в `retryMs`, пока идёт другая запись в игру (до `attempts` раз),
 * и каждый раз, когда окно возвращает фокус (не чаще раза в 30 с). Игра запущена — ждёт выхода из неё. Запуск игры из окна спрашивает стража сам (`healBeforeLaunch`).
 * Итог «вернули» и «не вышло» уходит окну (`broadcastClothingRegistration`) и ждёт его в `take`, если окно подпишется позже; в журнал раздела install пишется каждый старт.
 */
import {
  createClothingRegistrationKeeper,
  setClothingRegistrationKeeper,
} from "./clothing-registration-heal.js";

export function bootClothingRegistrationKeeper({
  app,
  appLog,
  discoverGames,
  installOptions,
  busy,
  gameRunning,
  remember = () => {},
  /* Рассылка окнам тянет electron: подгружается при первом итоге, чтобы модуль грузился и в тестах без него. */
  broadcast = (result) =>
    import("./broadcast.js").then((module) =>
      module.broadcastClothingRegistration(result),
    ),
  startDelayMs = 20_000,
  retryMs = 60_000,
  attempts = 10,
  /* Игра или лаунчер сервера открыты (могут висеть весь день): проверка повторяется реже и без счёта попыток, пока они не закроются (ревью, №9). */
  waitMs = 300_000,
  setTimer = setTimeout,
}) {
  try {
    /* Список игр на фокусе не спрашивается каждый раз: минуту держится прежним. */
    let games = { at: -Infinity, list: [] };
    const cachedGames = async () => {
      if (Date.now() - games.at < 60_000) return games.list;
      games = { at: Date.now(), list: await discoverGames() };
      return games.list;
    };
    const keeper = createClothingRegistrationKeeper({
      discoverGames: cachedGames,
      stateDir: async () => (await installOptions()).stateDir,
      busy,
      gameRunning,
      record: (entry) => appLog.record(entry),
      report: (result) => {
        remember(result);
        void Promise.resolve(broadcast(result)).catch(() => {});
      },
    });
    setClothingRegistrationKeeper(keeper);
    let tries = 0;
    const attempt = async () => {
      tries += 1;
      const { deferred } = await keeper.check(tries === 1 ? "start" : "retry");
      if (deferred === "busy" && tries < attempts)
        setTimer(attempt, retryMs)?.unref?.();
      else if (deferred === "game-running")
        setTimer(attempt, waitMs)?.unref?.();
    };
    setTimer(attempt, startDelayMs)?.unref?.();
    app.on("browser-window-focus", () => void keeper.check("focus"));
    return keeper;
  } catch (error) {
    appLog.record({
      level: "warn",
      source: "install",
      message: `Одежда: страж регистрации не запущен (${error?.message || error})`,
    });
    return null;
  }
}
