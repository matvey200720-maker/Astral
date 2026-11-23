import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const LIMITS = Object.freeze({
  min: 180,
  defaultMax: 240,
  defaultShare: 0.29,
  maxShare: 0.66,
  fallbackMax: 640,
  step: 24,
  chrome: 112,
});
const MEMORY_KEY = "astral.texture-studio.dock.v1";
const COLUMN = ".ui-editor-inspector";
const TABS = Object.freeze([
  ["layers", "Слои"],
  ["history", "История"],
]);

const bound = (value, low, high) => (value < low ? low : value > high ? high : value);

function arrowSign(key) {
  switch (key) {
    case "ArrowUp":
      return 1;
    case "ArrowDown":
      return -1;
    default:
      return 0;
  }
}

function listen(target, type, handler) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

/* ---------- память высоты ---------- */

const memory = {
  read() {
    let saved;
    try {
      saved = Number(globalThis.localStorage?.getItem(MEMORY_KEY));
    } catch {
      return null;
    }
    return saved >= LIMITS.min && saved < Infinity ? saved : null;
  },
  write(value) {
    try {
      globalThis.localStorage?.setItem(MEMORY_KEY, String(Math.round(value)));
    } catch {
      // память закрыта — высота просто не запомнится
    }
  },
};

/* ---------- мерки колонки ---------- */

// column — высота колонки инспектора (0, если её нет); usable — она же либо запас от окна
function measureColumn(node) {
  const column = node?.closest(COLUMN)?.getBoundingClientRect().height || 0;
  const fromWindow = Math.max(0, (globalThis.innerHeight || 900) - LIMITS.chrome);
  return { column, usable: column || fromWindow };
}

function preferredHeight(node) {
  const { usable } = measureColumn(node);
  return bound(Math.round(usable * LIMITS.defaultShare), LIMITS.min, LIMITS.defaultMax);
}

function ceilingHeight(node) {
  const { column } = measureColumn(node);
  return column ? Math.max(LIMITS.min, Math.round(column * LIMITS.maxShare)) : LIMITS.fallbackMax;
}

/* ---------- перетаскивание ручки ---------- */

class DragSession {
  #grab = null;

  begin(event, node, height) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const { height: measured } = node.getBoundingClientRect();
    this.#grab = { y: event.clientY, height: measured, last: height };
    node.dataset.resizing = "";
  }

  move(event, node, clamp) {
    const grab = this.#grab;
    if (!grab) return;
    grab.last = clamp(grab.height + (grab.y - event.clientY));
    node.style.height = `${grab.last}px`;
  }

  // Снимает сессию и отдаёт последнюю высоту; null, если тащить было нечего.
  release(node) {
    const grab = this.#grab;
    if (!grab) return null;
    this.#grab = null;
    delete node.dataset.resizing;
    return grab.last;
  }
}

/* ---------- хуки по ролям ---------- */

function useStoredHeight() {
  const own = useRef(undefined);
  if (own.current === undefined) own.current = memory.read();
  return {
    own,
    remember(value) {
      own.current = value;
      memory.write(value);
    },
  };
}

function useDockClamp(ref) {
  return useCallback((next) => bound(Math.round(next), LIMITS.min, ceilingHeight(ref.current)), [ref]);
}

function useDockHeight({ ref, store, clamp }) {
  const { own, remember } = store;
  const [height, setHeight] = useState(() => own.current ?? preferredHeight(null));

  useLayoutEffect(() => {
    if (own.current !== null) return;
    setHeight(preferredHeight(ref.current));
  }, [own, ref]);

  useEffect(() => {
    const fit = () =>
      setHeight((current) => {
        if (own.current === null) return preferredHeight(ref.current);
        return clamp(current);
      });
    return listen(window, "resize", fit);
  }, [clamp, own, ref]);

  const commit = (next) => {
    const clamped = clamp(next);
    setHeight(clamped);
    remember(clamped);
  };
  return { height, commit };
}

function useDragSession() {
  const session = useRef(null);
  if (session.current === null) session.current = new DragSession();
  return session.current;
}

/* ---------- разметка ---------- */

const gripEvents = ({ ref, session, height, clamp, commit }) => ({
  onPointerDown: (event) => session.begin(event, ref.current, height),
  onPointerMove: (event) => session.move(event, ref.current, clamp),
  onPointerUp() {
    const last = session.release(ref.current);
    if (last !== null) commit(last);
  },
  onPointerCancel() {
    if (session.release(ref.current) === null) return;
    ref.current.style.height = `${height}px`;
  },
  onKeyDown(event) {
    const sign = arrowSign(event.key);
    if (sign === 0) return;
    commit(height + sign * LIMITS.step);
    event.preventDefault();
  },
});

const gripProps = (height, events) => ({
  className: "txs-dock-grip",
  role: "separator",
  "aria-orientation": "horizontal",
  "aria-label": tr("Высота панели «Слои и История»"),
  "aria-valuemin": LIMITS.min,
  "aria-valuenow": height,
  tabIndex: 0,
  ...events,
});

const tabsProps = (value, onChange) => ({
  label: tr("Панель"),
  size: "sm",
  role: "tablist",
  options: TABS.map(([tab, text]) => ({ value: tab, label: tr(text) })),
  value,
  onChange,
});

const StudioDock = ({ value, onChange, children }) => {
  useTr();
  const ref = useRef(null);
  const store = useStoredHeight();
  const clamp = useDockClamp(ref);
  const { height, commit } = useDockHeight({ ref, store, clamp });
  const session = useDragSession();
  const events = gripEvents({ ref, session, height, clamp, commit });

  return h(
    "div",
    { ref, className: "txs-dock", style: { height: `${height}px` } },
    h("div", gripProps(height, events)),
    h(SegmentedControl, tabsProps(value, onChange)),
    h("div", { className: "txs-dock-body" }, children),
  );
};

export { StudioDock as default };
