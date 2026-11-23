// Вид окна: «Как в игре», зум и масштаб подписей, последний кадр и границы
// кадра для «Слоёв».
import { useReducer, useRef, useCallback, startTransition, useEffect } from "react";
import { attempt } from "./dom-guards.js";
import { quantizeZoom, quantizeScale, frameBounds } from "./frame-math.js";
import { GAME_PREVIEW_KEY, FRAME_DELAY_MS } from "./panel-data.js";

// Выключено только явным «0»; недоступная память — включено
const rememberedPreview = () => attempt(() => localStorage.getItem(GAME_PREVIEW_KEY), null) !== "0";

// Изменения вида: имя действия -> (состояние, довесок) => новое состояние.
// Совпавшие значения возвращают прежнее состояние, чтобы окно не перерисовывалось зря.
const CHANGES = {
  preview: (state, value) => (state.gamePreview === value ? state : { ...state, gamePreview: value }),
  zoom: (state, [zoom, pixelsPerUnit]) => {
    const sceneZoom = quantizeZoom(zoom);
    const windowScale = pixelsPerUnit > 0 ? quantizeScale(pixelsPerUnit) : state.windowScale;
    const same = sceneZoom === state.sceneZoom && windowScale === state.windowScale;
    return same ? state : { ...state, sceneZoom, windowScale };
  },
  frame: (state, frame) => ({ ...state, frame }),
};

const reduceView = (state, [name, payload]) => CHANGES[name](state, payload);

// Отложенный вызов: новый запрос снимает прежний
const makeDelayed = (delay, job) => {
  let id = 0;
  return {
    arm: (...args) => {
      clearTimeout(id);
      id = setTimeout(job, delay, ...args);
    },
    cancel: () => clearTimeout(id),
  };
};

export function useViewState({ atlas, sceneSize, onFrame }) {
  const [view, change] = useReducer(reduceView, null, () => ({
    gamePreview: rememberedPreview(),
    sceneZoom: 1,
    windowScale: 0,
    frame: null,
  }));
  const viewRef = useRef(null);
  const space = useRef();
  space.current = { atlas, sceneSize };

  const delayed = useRef(null);
  if (!delayed.current) {
    delayed.current = makeDelayed(FRAME_DELAY_MS, (shown) => {
      const bounds = frameBounds(shown, space.current.sceneSize, space.current.atlas);
      if (bounds) change(["frame", bounds]);
    });
  }

  const onGamePreview = useCallback((value) => {
    change(["preview", value]);
    attempt(() => localStorage.setItem(GAME_PREVIEW_KEY, value ? "1" : "0"));
  }, []);

  // Приближение: кадр встаёт сразу, подписи перекладываются вторым проходом
  const onZoomChange = useCallback(
    (zoom, pixelsPerUnit) => startTransition(() => change(["zoom", [zoom, pixelsPerUnit]])),
    [],
  );

  const onViewChange = useCallback(
    (next) => {
      viewRef.current = next;
      onFrame?.(next);
      delayed.current.arm(next);
    },
    [onFrame],
  );

  useEffect(() => () => delayed.current.cancel(), []);

  return { ...view, onGamePreview, onZoomChange, viewRef, onViewChange };
}
