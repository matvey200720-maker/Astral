import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

/*
 * Выбор части из каталога вместо родной (владелец, 12.11.2026: «Взять из другого редукса» открывает каталог на нужной полке, щелчок по карточке ставит её и возвращает на страницу).
 *
 * Состояние живёт вне дерева React: страница мода при уходе в каталог размонтируется, и выбор должен пережить её. Запись одна и живёт 30 минут (как `editor-return.js`):
 *  • запрос (`startComponentPick`) — что и для какой сборки выбираем; пока он есть, каталог стоит в режиме выбора (полоса сверху, щелчок выбирает);
 *  • исход (`finishComponentPick` / `cancelComponentPick`) — что выбрали; его один раз забирает страница мода, когда монтируется заново (`use-pick-return.js`).
 * Любой другой уход из каталога (раздел рейки, боковая кнопка мыши, поиск) запрос просто снимает (`dropComponentPick`): ничего не меняется.
 *
 * Модуль крохотный и без тяжёлых импортов — его читают `PublicCatalog` и кнопки карточки в стартовом куске. Разбор «какая карточка годится» и «что подставить» — `component-pick-logic.js`,
 * он грузится по нужде, когда запрос появился.
 */

const TTL_MS = 30 * 60_000;

let request = null;
let outcome = null;
let counter = 0;
let timer = 0;
const listeners = new Set();

const fresh = (entry) => entry !== null && Date.now() - entry.at < TTL_MS;

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notify = () => {
  for (const listener of [...listeners]) listener();
};

function clearTimer() {
  clearTimeout(timer);
  timer = 0;
}

/**
 * Начать выбор. `fields`: `group` (карточка), `slot` (ключ компонента), `bundleId`, `bundleName`, `nativeId` (первый родной пакет слота), `slots` (слоты, что он занимает),
 * `exclude` (id частей самой карточки — их выбирать нельзя), `top` (где была прокручена страница).
 */
export function startComponentPick(fields) {
  counter += 1;
  const mine = counter;
  request = Object.freeze({ ...fields, id: mine, at: Date.now() });
  outcome = null;
  clearTimer();
  timer = setTimeout(() => {
    if (request?.id === mine) dropComponentPick();
  }, TTL_MS);
  notify();
  return request;
}

/** Идущий выбор либо `null` (его срок вышел). */
export const currentComponentPick = () => (fresh(request) ? request : null);

/** Снять запрос молча: человек ушёл из каталога не через выбор. Исход, если он уже есть, остаётся. */
export function dropComponentPick() {
  if (request === null) return;
  request = null;
  clearTimer();
  notify();
}

/** «Отмена» в полосе: запрос снят, страница мода вернёт прокрутку и больше ничего не делает. */
export function cancelComponentPick() {
  if (!fresh(request)) {
    dropComponentPick();
    return;
  }
  outcome = Object.freeze({ ...request, partId: "", cancelled: true, at: Date.now() });
  request = null;
  clearTimer();
  notify();
}

/** Часть выбрана: запрос закрыт, исход ждёт страницу мода. `null` — запроса уже нет (или он уже другой: `id` — тот, по которому щёлкнули). */
export function finishComponentPick(partId, id = request?.id) {
  if (!fresh(request) || !partId || request.id !== id) return null;
  outcome = Object.freeze({ ...request, partId: String(partId), cancelled: false, at: Date.now() });
  request = null;
  clearTimer();
  notify();
  return outcome;
}

/** Страница мода забирает исход своей карточки: один раз, и только свежий. */
export function takeComponentPickOutcome(group) {
  if (!group || !fresh(outcome) || outcome.group !== group) return null;
  const found = outcome;
  outcome = null;
  return found;
}

/** Только для тестов: забыть запрос и исход. */
export function resetComponentPick() {
  request = null;
  outcome = null;
  clearTimer();
  notify();
}

let logicLoad = null;
/** Разбор карточек (ленивый модуль): грузится один раз, когда появился запрос. */
export const loadComponentPickLogic = () => (logicLoad ??= import("./component-pick-logic.js"));

// Сколько каталогов сейчас на экране: ушёл последний — запрос снимается (после тика, чтобы двойной монтаж StrictMode и перестройка страницы его не задели).
let shown = 0;

const glued = (preview, mods) => [...new Map([...(preview || []), ...(mods || [])].map((mod) => [mod.id, mod])).values()];

/**
 * Режим выбора для каталога. `null` — обычный каталог; иначе `{ request, verdict, choose, cancel }`:
 *  • `verdict(mod)` — `"on"` (годится), `"off"` (не годится: часть самой сборки или другой вид), `"wait"` (разбор ещё едет);
 *  • `choose(mod)` — выбрать карточку; обещание `true`, если выбор принят и пора возвращаться на страницу мода;
 *  • `cancel()` — «Отмена».
 * `mods` — каталог данных окна, `preview` — образцы витрины: владелец части ищется по полному каталогу, а не по тому, что показала выдача (там остаются лишь первые версии карточек).
 */
export function useComponentPick(mods, preview) {
  const active = useSyncExternalStore(subscribe, currentComponentPick, () => null);
  const wanted = active !== null;
  const [logic, setLogic] = useState(null);

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    loadComponentPickLogic()
      .then((loaded) => {
        if (live) setLogic(loaded);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted]);

  useEffect(() => {
    shown += 1;
    return () => {
      shown -= 1;
      setTimeout(() => {
        if (shown === 0) dropComponentPick();
      }, 0);
    };
  }, []);

  const catalog = useMemo(() => (wanted ? glued(preview, mods) : null), [wanted, preview, mods]);
  return useMemo(() => {
    if (!active) return null;
    return {
      request: active,
      verdict: (mod) => (logic ? (logic.candidateOf(active, mod, catalog) ? "on" : "off") : "wait"),
      choose: (mod) =>
        loadComponentPickLogic()
          .then((loaded) => loaded.choosePicked(active, mod, catalog))
          .catch(() => false),
      cancel: cancelComponentPick,
    };
  }, [active, logic, catalog]);
}
