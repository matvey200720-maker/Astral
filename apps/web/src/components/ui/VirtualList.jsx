import { createElement as h, useCallback, useImperativeHandle, useLayoutEffect as afterCommit, useRef, useState } from "react";

const DEFAULTS = { overscan: 8, apiRef: null, className: "", tabIndex: -1 };
const KNOWN = new Set([...Object.keys(DEFAULTS), "items", "rowHeight", "renderRow", "style"]);
const FIRST_SCREEN = 48;
const SWING_MS = 120;
const SCROLLING = new Set(["auto", "scroll", "overlay"]);

const covers = (view, index) => index >= view.first && index < view.last;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const sameWindow = (a, b) => a === b || (a !== null && b !== null && a.first === b.first && a.last === b.last);
const clockNow = () => (typeof performance === "object" && performance !== null ? performance.now() : Date.now());

// Свойства: известные получают умолчания вместо undefined, остальные уходят на корень как есть.
function splitProps(props) {
  const own = { ...DEFAULTS };
  const rest = {};
  for (const [name, value] of Object.entries(props)) {
    if (!KNOWN.has(name)) rest[name] = value;
    else if (value !== undefined || !(name in DEFAULTS)) own[name] = value;
  }
  return [own, rest];
}

function* ancestorsOf(node) {
  for (let up = node.parentElement; up; up = up.parentElement) yield up;
}

// Колонка — ближайший предок, который прокручивается по вертикали.
function findColumn(root) {
  for (const node of ancestorsOf(root)) {
    const scrolls = SCROLLING.has(getComputedStyle(node).overflowY);
    if (scrolls) return node;
  }
  return null;
}

// Окно строк по тому, на сколько список ушёл выше колонки, и высоте колонки.
function windowAround(gone, viewport, { count, rowHeight, overscan }) {
  const [top, bottom] = [gone / rowHeight, (gone + viewport) / rowHeight];
  const first = clamp(Math.floor(top) - overscan, 0, count);
  return { first, last: clamp(Math.ceil(bottom) + overscan, first, count) };
}

// Нет колонки, её высоты или шага строки — окна нет, рисуются все строки.
function readWindow(root, column, params) {
  if (!root || !column || !params.rowHeight || !(column.clientHeight > 0)) return null;
  const columnTop = column.getBoundingClientRect().top;
  return windowAround(columnTop - root.getBoundingClientRect().top, column.clientHeight, params);
}

// Возврат к прежнему виду раньше порога — качание раскладки, а не прокрутка.
const isSwing = (next, swing, stamp) => swing !== null && sameWindow(next, swing.view) && stamp - swing.at < SWING_MS;

// Запись о последней смене окна: прежний вид и момент.
const noteSwitch = (view, at) => ({ view, at });

// Фокус в строке, которая выпадет из нового окна, уходит на корень, пока строка ещё в документе.
function keepFocus(root, shown, next) {
  if (!root || next === null) return;
  const active = root.ownerDocument.activeElement;
  const rows = Array.from(root.firstElementChild?.children ?? []);
  const at = active && active !== root ? rows.findIndex((row) => row.contains(active)) : -1;
  if (at < 0) return;
  const index = (shown ? shown.first : 0) + at;
  if (!covers(next, index)) root.focus({ preventScroll: true });
}

// Не чаще одного замера на кадр: первое событие ставит кадр, остальные до него молчат.
function framePump(run) {
  let ticket = 0;
  const onFrame = () => {
    ticket = 0;
    run();
  };
  return {
    poke() {
      if (ticket === 0) ticket = requestAnimationFrame(onFrame);
    },
    drop() {
      if (ticket !== 0) cancelAnimationFrame(ticket);
    },
  };
}

function watchColumn(column, measure) {
  const pump = framePump(measure);
  column.addEventListener("scroll", pump.poke, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(pump.poke) : null;
  if (observer) observer.observe(column);
  return () => {
    column.removeEventListener("scroll", pump.poke);
    if (observer) observer.disconnect();
    pump.drop();
  };
}

// Куда прокрутить колонку, чтобы строка стала видна; null — двигать не нужно.
function scrollTarget({ rootTop, columnTop, scrollTop, viewport, index, rowHeight }) {
  const top = rootTop - columnTop + scrollTop + index * rowHeight;
  const bottom = top + rowHeight;
  const rules = [
    [top < scrollTop, top],
    [bottom > scrollTop + viewport, bottom - viewport],
  ];
  const hit = rules.find(([applies]) => applies);
  return hit ? hit[1] : null;
}

// Окно строк: состояние, замер по колонке с защитой от качания и подписки на колонку.
function useWindow(count, rowHeight, overscan) {
  const rootRef = useRef(null);
  const columnRef = useRef(null);
  const [win, setWin] = useState(() => ({ first: 0, last: Math.min(count, FIRST_SCREEN) }));
  const shownRef = useRef(win);
  shownRef.current = win;
  const lastSwitchRef = useRef(null);

  const measure = useCallback(() => {
    const upcoming = readWindow(rootRef.current, columnRef.current, { count, rowHeight, overscan });
    const shown = shownRef.current;
    if (sameWindow(upcoming, shown)) return;
    const moment = clockNow();
    if (isSwing(upcoming, lastSwitchRef.current, moment)) return;
    keepFocus(rootRef.current, shown, upcoming);
    lastSwitchRef.current = noteSwitch(shown, moment);
    setWin(upcoming);
  }, [count, rowHeight, overscan]);

  afterCommit(() => {
    const root = rootRef.current;
    const column = root ? findColumn(root) : null;
    columnRef.current = column;
    return column ? watchColumn(column, measure) : undefined;
  }, [measure]);

  afterCommit(() => {
    measure();
  });

  return { columnRef, rootRef, win };
}

// Ссылка для вызывающего: довести строку до видимой, сдвинув прокрутку колонки.
function scrollApi(rootRef, columnRef, rowHeight) {
  return {
    scrollToIndex(index) {
      const [root, column] = [rootRef.current, columnRef.current];
      if (!(root && column && column.clientHeight)) return;
      const geometry = { rootTop: root.getBoundingClientRect().top, columnTop: column.getBoundingClientRect().top, scrollTop: column.scrollTop, viewport: column.clientHeight, index, rowHeight };
      const target = scrollTarget(geometry);
      if (target !== null) column.scrollTop = target;
    },
  };
}

export default function VirtualList(props) {
  const [own, rest] = splitProps(props);
  const { items, rowHeight, overscan, renderRow, apiRef } = own;
  const count = items.length;
  const { rootRef, columnRef, win } = useWindow(count, rowHeight, overscan);

  useImperativeHandle(apiRef, () => scrollApi(rootRef, columnRef, rowHeight), [rowHeight, rootRef, columnRef]);

  const from = win ? win.first : 0;
  const rows = items.slice(from, win ? win.last : count).map((item, at) => renderRow(item, from + at));
  const rootStyle = { ...own.style, "--ui-virtual-row": `${rowHeight}px`, position: "relative", flexShrink: 0, height: win ? count * rowHeight : undefined };
  const blockStyle = win ? { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${from * rowHeight}px)` } : undefined;
  return h("div", { className: own.className, tabIndex: own.tabIndex, style: rootStyle, ref: rootRef, ...rest }, h("div", { style: blockStyle }, rows));
}
