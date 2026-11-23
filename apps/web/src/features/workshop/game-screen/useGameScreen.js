import { useMemo, useSyncExternalStore } from "react";
import { describeGameScreen } from "@modovik/minimap-contract";
import { readGameSettings } from "../../../api.js";

/*
 * Экран игры игрока — ОДИН запрос на окно (ТЗ H1, 14.11.2026).
 *
 * Мини-карта, значки, прицел, патроны и урон показывают HUD под экран игрока, и раньше каждый редактор звал
 * `readGameSettings` сам. Теперь первый, кто спросил, запускает запрос, остальные берут тот же ответ;
 * `refreshGameScreen()` спрашивает заново (человек сменил настройки игры). Читает экран главный процесс
 * (`apps/desktop/src/game-screen.js`); нет приложения, файла или ответа — `raw` равен `null`.
 */

let pending = null;
let generation = 0;
let snapshot = Object.freeze({ loaded: false, raw: null });
let loadedAt = 0;
const listeners = new Set();

/* Ответ старше этого, а редактор открыли заново — спросить ещё раз: человек мог сменить формат в игре и вернуться в открытый лаунчер. */
const STALE_MS = 30_000;
/* Окно снова в фокусе (вернулись из игры): не чаще раза в несколько секунд. */
const FOCUS_REFRESH_MS = 5_000;

function publish(next) {
  snapshot = Object.freeze(next);
  if (next.loaded) loadedAt = Date.now();
  for (const listener of [...listeners]) listener();
}

/** Запрос экрана игры: один на окно, пока его не сбросили (`refreshGameScreen`). */
export function loadGameScreen() {
  if (pending) return pending;
  const mine = ++generation;
  pending = Promise.resolve()
    .then(() => readGameSettings())
    .then(
      (settings) => settings?.gameScreen ?? null,
      () => null,
    )
    .then((raw) => {
      /* Ответ на устаревший запрос не затирает свежий. */
      if (mine === generation) publish({ loaded: true, raw });
      return raw;
    });
  return pending;
}

/** Спросить заново: все редакторы получат новый ответ. */
export function refreshGameScreen() {
  pending = null;
  return loadGameScreen();
}

/** Забыть ответ — для тестов и для выхода из аккаунта. */
export function resetGameScreen() {
  pending = null;
  generation += 1;
  loadedAt = 0;
  publish({ loaded: false, raw: null });
}

function subscribe(listener) {
  listeners.add(listener);
  if (snapshot.loaded && Date.now() - loadedAt > STALE_MS) refreshGameScreen();
  else loadGameScreen();
  const onFocus = () => {
    if (snapshot.loaded && Date.now() - loadedAt > FOCUS_REFRESH_MS)
      refreshGameScreen();
  };
  globalThis.addEventListener?.("focus", onFocus);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("focus", onFocus);
  };
}
const getSnapshot = () => snapshot;

/**
 * Экран игры как его вернул главный процесс: объект с `aspect > 0` или `null` (нет данных, не прочитался, Enhanced).
 * Поддерживает прежний и новый вид ответа.
 */
export function useGameScreen() {
  const { raw } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return raw && raw.known !== false && Number(raw.aspect) > 0 ? raw : null;
}

/**
 * `{ loaded, info, raw }`: `info` — экран в одном виде (`describeGameScreen`), `raw` — ответ как есть. `loaded: false`,
 * пока ответ не пришёл: строка экрана в это время молчит, а предпросмотр стоит на 16:9.
 */
export function useGameScreenInfo() {
  const { loaded, raw } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const info = useMemo(() => describeGameScreen(raw), [raw]);
  return { loaded, info, raw };
}

/** «4:3», «16:9» … — как форму экрана называет меню игры. */
export { aspectLabel as gameAspectLabel } from "@modovik/minimap-contract";
