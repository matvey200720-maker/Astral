/*
 * Отложенная установка доходит сама (26.11.2026). Пока список не пуст, раз в несколько секунд спрашиваем главный процесс,
 * можно ли менять игру. Игра закрыта, а подготовка стоит отказом — зовём её сразу, не дожидаясь повтора по таймеру (до двух
 * минут). Подготовка готова — отдаём по одной отложенной установке обычному «Установить»: свежий грант, план и очередь.
 * Игру успели открыть снова — установка вернётся в отложенные сама (`deferred-installs.js`).
 */
import { tr } from "../../locales/ui.js";
import { writeWindowLog } from "../app-errors/report.js";
import {
  deferredInstalls,
  pruneDeferred,
  removeDeferred,
} from "./deferred-installs.js";
import { inspectGameWritable } from "./game-bridge.js";

export const DEFERRED_POLL_MS = 5_000;

const STOPPED_BY_PREPARATION = new Set(["error", "needs-action"]);

const forGame = (entry, gameId) => !entry.gameId || entry.gameId === gameId;

/*
 * Человек нажал «Установить» сам, и мод уже в обычной очереди — второй раз не ставим; поставил «сброс модов» — ждать
 * нечего. По списку установленных не снимаем: у ганпака по стволам он «стоит» и с одним стволом, а нажатие — доставить.
 */
function dropOvertaken({ game, queue = [] }) {
  const live = queue.filter((row) => !row.failed);
  const reset = live.some((row) => row.operation === "reset");
  const queued = new Set(
    live.filter((row) => row.operation === "install").map((row) => row.id),
  );
  for (const entry of deferredInstalls())
    if (forGame(entry, game?.id) && (reset || queued.has(entry.id)))
      removeDeferred(entry.id);
}

/**
 * `latest` — ref со свежим состоянием оболочки: `{ account, game, preparation, prepareGame, mods, queue, install,
 * notify }`. Возвращает остановку.
 */
export function startDeferredResume(
  latest,
  { guard = inspectGameWritable, pollMs = DEFERRED_POLL_MS } = {},
) {
  let busy = false;
  let stopped = false;
  /* Подготовку по «игра закрыта» зовём один раз на закрытие: отказ по другой причине не должен гонять её каждые пять секунд. */
  let asked = false;

  async function tick() {
    if (busy || stopped) return;
    pruneDeferred();
    dropOvertaken(latest.current || {});
    const gameId = latest.current?.game?.id || "";
    if (!deferredInstalls().some((entry) => forGame(entry, gameId))) {
      asked = false;
      return;
    }
    if (!latest.current.account || !gameId) return;
    busy = true;
    try {
      const writable = await guard(gameId);
      if (stopped) return;
      if (!writable?.ok) {
        asked = false;
        return;
      }
      /* Пока спрашивали, окно могло перерисоваться — берём свежее. */
      const { game, preparation, prepareGame, mods, install, notify } =
        latest.current;
      if (game?.id !== gameId) return;
      if (preparation.status !== "ready") {
        if (STOPPED_BY_PREPARATION.has(preparation.status) && !asked) {
          asked = true;
          void prepareGame(game, { force: true });
        }
        return;
      }
      const catalog = new Map((mods || []).map((mod) => [mod.id, mod]));
      /* Первые минуты каталог приезжает страницами: мода ещё нет — ждём, а не снимаем запись. */
      const entry = deferredInstalls().find(
        (item) => forGame(item, gameId) && catalog.has(item.id),
      );
      if (!entry) return;
      removeDeferred(entry.id);
      notify?.(tr("GTA V закрыта — ставим «{0}»").replace("{0}", entry.name));
      await install(
        { ...catalog.get(entry.id), ...entry.choice },
        entry.options,
      );
    } catch (error) {
      writeWindowLog({
        level: "warn",
        source: "preparation",
        message: `Отложенная установка не пошла: ${String(
          error?.message ?? error,
        )
          .split(/\r?\n/)[0]
          .slice(0, 300)}`,
      });
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
