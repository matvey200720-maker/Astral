import { tr, useTr } from "../../../locales/ui.js";
import { rowTitle, rowsText } from "./schedule-text.js";
import {
  sheetLayout,
  scheduleTextPlaces,
  prepareScheduleSheet,
  paintScheduleSheet,
  loadServerSheet,
  BOARD_ASPECT,
} from "./schedule-sheet.js";
import {
  scheduleSignature,
  normalizeScheduleProject,
  SCHEDULE_NEW_ROW,
  SCHEDULE_MAX_ROWS,
  SCHEDULE_LIMITS,
} from "@modovik/climb-contract/recolor/schedule";
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* ---------- таблицы и константы ---------- */

const [PAD_TOP, PAD_BOTTOM, PAD_SIDE] = [60, 64, 24];
const DRAG_START_PX = 6;
const NON_SCALING = "non-scaling-stroke";
const DASHES = "6 5";
const FAINT_DASH_STROKE = "rgba(255, 255, 255, 0.4)";
const AUDIT_TEXT_FIELD = "type-min type-scale caps hit-target";
const ACTIVATE_KEYS = new Set(["Enter", " "]);
const ARROW_STEPS = new Map([
  ["ArrowUp", -1],
  ["ArrowDown", 1],
]);
const EMPTY_BOX = { width: 0, height: 0 };
const IDLE_GESTURE = { drag: null, pressing: false };
const ORIGIN = [0, 0];
const noop = () => {};

// Стили собраны из пар: порядок ключей важен для порядка свойств в разметке
const lookOf = (pairs) => Object.freeze(Object.fromEntries(pairs));

const FIELD_LOOK = lookOf([
  ["position", "absolute"],
  ["zIndex", 4],
  ["boxSizing", "content-box"],
  ["margin", 0],
  ["padding", 0],
  ["border", 0],
  ["borderRadius", 0],
  ["color", "transparent"],
  ["background", "transparent"],
  ["outline", "1px dashed rgba(255, 255, 255, 0.92)"],
  ["outlineOffset", 3],
  ["boxShadow", "0 0 0 4px rgba(0, 0, 0, 0.001)"],
  ["whiteSpace", "pre"],
  ["overflow", "hidden"],
]);

const HINT_LOOK = lookOf([
  ["position", "absolute"],
  ["left", 0],
  ["right", 0],
  ["bottom", 18],
  ["margin", 0],
  ["color", "var(--astral-ink-faint)"],
  ["fontSize", "var(--astral-text-small)"],
  ["textAlign", "center"],
  ["pointerEvents", "none"],
]);

// left и top здесь только держат место в порядке ключей, значения подставляются при показе
const DRAG_TAG_LOOK = lookOf([
  ["position", "absolute"],
  ["zIndex", 5],
  ["left", 0],
  ["top", 0],
  ["padding", "8px 12px"],
  ["border", "1px solid var(--astral-accent)"],
  ["borderRadius", "var(--astral-radius)"],
  ["color", "var(--astral-ink)"],
  ["background", "var(--astral-surface-strong)"],
  ["boxShadow", "var(--astral-shadow-soft)"],
  ["fontSize", "var(--astral-text-small)"],
  ["fontWeight", 600],
  ["whiteSpace", "nowrap"],
  ["pointerEvents", "none"],
]);

const SPOT_LOOKS = new Map([
  [
    "on",
    lookOf([
      ["stroke", "var(--astral-accent)"],
      ["strokeWidth", 2.5],
      ["fill", "color-mix(in srgb, var(--astral-accent) 10%, transparent)"],
    ]),
  ],
  [
    "hover",
    lookOf([
      ["stroke", "rgba(255, 255, 255, 0.55)"],
      ["strokeWidth", 1.5],
      ["fill", "rgba(255, 255, 255, 0.04)"],
    ]),
  ],
]);
const SPOT_IDLE = lookOf([
  ["stroke", "none"],
  ["strokeWidth", 0],
  ["fill", "transparent"],
]);

// Стиль места: обычное нажатие и «взять» (grab)
const SPOT_STYLES = [
  { cursor: "pointer", outline: "none", touchAction: undefined },
  { cursor: "grab", outline: "none", touchAction: "none" },
];
const SPOT_DEFAULTS = {
  radius: 0,
  state: "off",
  covered: false,
  onEdit: null,
  onPointerDown: null,
  onKeyDown: null,
  dashed: false,
  grab: false,
  children: null,
};

// След от поднятой строки и место, куда она встанет
const LIFTED_LOOK = lookOf([
  ["fill", "rgba(0, 0, 0, 0.45)"],
  ["stroke", "rgba(255, 255, 255, 0.5)"],
  ["strokeWidth", 1.5],
  ["pointerEvents", "none"],
]);
const LANDING_LOOK = lookOf([
  ["fill", "color-mix(in srgb, var(--astral-accent) 16%, transparent)"],
  ["stroke", "var(--astral-accent)"],
  ["strokeWidth", 2.5],
  ["pointerEvents", "none"],
]);

// Поля правки строки: место на листе (оно же ключ строки и предела), подпись поля, пометка для журнала
const ROW_COLUMNS = [
  ["name", "text", "Название строки", "название"],
  ["time", "time", "Время строки", "время"],
];
const TYPEFACE_KEYS = [
  ["fontFamily", "family"],
  ["fontWeight", "weight"],
];

/* ---------- чистые вычисления ---------- */

// Умолчание подставляется только вместо undefined
function withDefaults(props, defaults) {
  const merged = { ...props };
  for (const key of Object.keys(defaults)) {
    if (merged[key] === undefined) merged[key] = defaults[key];
  }
  return merged;
}

function spotStroke(state) {
  return SPOT_LOOKS.get(state) ?? SPOT_IDLE;
}

function fitBoard({ width, height }) {
  const [roomW, roomH] = [width - PAD_SIDE * 2, height - PAD_TOP - PAD_BOTTOM].map((n) => Math.max(0, n));
  const sheet = { width: Math.min(roomW, roomH * BOARD_ASPECT) };
  sheet.height = sheet.width / BOARD_ASPECT;
  return Object.assign(sheet, {
    left: (width - sheet.width) * 0.5,
    top: PAD_TOP + (roomH - sheet.height) * 0.5,
  });
}

function alignPlan(align) {
  switch (align) {
    case "right":
      return { origin: "right center", start: (from, to, k, width) => -(width - to * k) };
    case "center":
      return { origin: "center center", start: (from, to, k, width) => (from + to) * 0.5 * k - width * 0.5 };
    default:
      return { origin: "left center", start: (from, to, k) => from * k };
  }
}

function typefaceOf(font) {
  const face = Object.fromEntries(TYPEFACE_KEYS.map(([css, prop]) => [css, font[prop]]));
  face.fontStyle = font.style || "normal";
  return face;
}

function letterField(place, font, baseline, cap, fit, k) {
  const { area, scale: rawScale } = place;
  const scale = rawScale || 1;
  const [start, end] = area;
  const span = end - start;
  const width = (span * k) / scale;
  const lineHeight = k * (cap * 1.9);
  const plan = alignPlan(place.align);
  const rise = baseline - cap * 1.45;
  return Object.assign(
    {},
    FIELD_LOOK,
    { left: fit.left + plan.start(start, end, k, width), top: fit.top + rise * k, width, height: lineHeight },
    { transform: `scaleX(${scale})`, transformOrigin: plan.origin },
    typefaceOf(font),
    { fontSize: place.size * k, lineHeight: `${lineHeight}px`, textAlign: place.align },
    { textTransform: ["none", "uppercase"][Number(Boolean(font.upper))], caretColor: place.colour },
  );
}

// Расстояние от точки до отрезка [low, high] по одной оси
const gapTo = (low, high, v) => (v < low ? low - v : v > high ? v - high : 0);

// Ближайшее к точке место на листе (по прямоугольнику плашки вместе со значком)
function dropTarget(slots, x, y) {
  let winner = -1;
  let nearest = Infinity;
  for (const { index, box, plate } of slots) {
    const squares = [gapTo(box[0], plate[2], x), gapTo(plate[1], plate[3], y)].reduce(
      (sum, gap) => sum + gap * gap,
      0,
    );
    if (squares < nearest) {
      nearest = squares;
      winner = index;
    }
  }
  return winner;
}

// Прямоугольники мест: [x, y, ширина, высота]
const rectFrom = (left, top, right, bottom) => [left, top, right - left, bottom - top];
const plateRect = ({ box, plate }) => rectFrom(box[2], plate[1], plate[2], plate[3]);
const badgeRect = ({ box }) => rectFrom(box[0], box[1], box[2], box[3]);
const wholeRect = ({ box, plate }) => rectFrom(box[0], plate[1], plate[2], plate[3]);

function headingRectOf({ x, y, width, cap }) {
  const top = y - cap * 1.1;
  return [x - width / 2, top > 0 ? top : 0, width, cap * 2.2];
}

function rowLabel(slot, row) {
  const hiddenNote = row.hidden ? tr(" (скрыта)") : "";
  return `Строка ${slot.index + 1}: ${rowTitle(row)}${hiddenNote} — изменить`;
}

function keysToMove(index, count, onReorder) {
  return function onKey(event) {
    if (!event.altKey) return;
    const step = ARROW_STEPS.get(event.key);
    if (step === undefined) return;
    event.preventDefault();
    const target = index + step;
    if (target < 0 || target >= count) return;
    onReorder(index, target);
  };
}

function dragFacts(drag, rows, slots) {
  if (!drag) return { dragged: null, fromSlot: null, dropSlot: null };
  const sameSpot = drag.target === drag.index;
  return {
    dragged: rows[drag.index],
    fromSlot: slots[drag.index],
    dropSlot: sameSpot ? null : slots[drag.target],
  };
}

/* ---------- работа с DOM ---------- */

function caretToEnd(input) {
  if (input) {
    const end = input.value.length;
    input.focus({ preventScroll: true });
    input.setSelectionRange?.call(input, end, end);
  }
}

function contextOf(canvas) {
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

// Рисунок листа: работа через общую кисть либо облик сервера
function stampWork(context, normal, assets, size) {
  paintScheduleSheet(context, normal, assets, size);
}

function stampServer(context, normal, assets, size) {
  context.clearRect(...ORIGIN, size.width, size.height);
  if (assets.server) context.drawImage(assets.server, ...ORIGIN, size.width, size.height);
}

// Точка указателя в окне кадра и на самом листе
function pointOf(frameEl, geometry, event) {
  const bounds = frameEl?.getBoundingClientRect();
  const point = { x: event.clientX - (bounds?.left || 0), y: event.clientY - (bounds?.top || 0) };
  const unit = geometry.k || 1;
  return Object.assign(point, {
    sheetX: (point.x - geometry.fit.left) / unit,
    sheetY: (point.y - geometry.fit.top) / unit,
  });
}

// Своё ли это нажатие: то, что держим, и тот же указатель
function ownHold(holdRef, event) {
  const hold = holdRef.current;
  return hold && hold.pointerId === event.pointerId ? hold : null;
}

// Подписывает все обработчики на окно в порядке таблицы; возвращает отписку
function listenOnWindow(wiring) {
  const types = Object.keys(wiring);
  types.forEach((type) => window.addEventListener(type, wiring[type]));
  return () => types.forEach((type) => window.removeEventListener(type, wiring[type]));
}

function pulledFar(hold, event) {
  const dx = event.clientX - hold.startX;
  const dy = event.clientY - hold.startY;
  return Math.hypot(dx, dy) >= DRAG_START_PX;
}

/* ---------- хуки ---------- */

// Следим за размером узла; возвращает отписку
function trackBox(node, setSize) {
  const settle = (old) => {
    const { clientWidth: width, clientHeight: height } = node;
    return width === old.width && height === old.height ? old : { width, height };
  };
  const measure = () => setSize(settle);
  measure();
  const Watcher = globalThis.ResizeObserver;
  const observer = typeof Watcher === "function" ? Reflect.construct(Watcher, [measure]) : null;
  if (!observer) return noop;
  observer.observe(node);
  return () => observer.disconnect();
}

function useBoxSize(ref) {
  const [size, setSize] = useState(EMPTY_BOX);
  useLayoutEffect(() => {
    const { current: node } = ref;
    return node ? trackBox(node, setSize) : undefined;
  }, [ref]);
  return size;
}

// Размер кадра, вписанный в поля
function useBoardFit(frameRef) {
  const frameSize = useBoxSize(frameRef);
  return fitBoard(frameSize);
}

function useBoardPicture(canvasRef, project, fit, showServer) {
  const key = scheduleSignature(project);
  const redraw = () => {
    const canvas = canvasRef.current;
    const roomy = [fit.width, fit.height].every((side) => !(side < 1));
    if (!canvas || !roomy) return undefined;
    const density = globalThis.devicePixelRatio || 1;
    const ratio = density > 2 ? 2 : density;
    const [pxWidth, pxHeight] = [fit.width, fit.height].map((side) => Math.round(side * ratio));
    const size = { width: pxWidth, height: pxHeight };
    const normal = normalizeScheduleProject(project);
    const run = { cancelled: false };
    const settle = async () => {
      let assets;
      if (showServer) assets = { server: await loadServerSheet() };
      else assets = await prepareScheduleSheet(normal);
      if (run.cancelled) return;
      for (const side of ["width", "height"]) {
        if (canvas[side] !== size[side]) canvas[side] = size[side];
      }
      const context = contextOf(canvas);
      if (context) (showServer ? stampServer : stampWork)(context, normal, assets, size);
    };
    settle().catch(function () {});
    return function stop() {
      run.cancelled = true;
    };
  };
  // Лист перерисовывается по смыслу работы (`key`) и размеру кадра
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(redraw, [key, fit.width, fit.height, showServer]);
}

// Пустое место под новую строку: есть, пока строк меньше предела и раскладка не перестроилась
function useGhostSlot(normal, layout, count) {
  return useMemo(
    () => {
      if (count < SCHEDULE_MAX_ROWS) {
        const grown = Object.assign({}, normal, { rows: normal.rows.concat([SCHEDULE_NEW_ROW]) });
        const next = sheetLayout(normalizeScheduleProject(grown));
        if (["columns", "lines"].every((prop) => next[prop] === layout[prop])) return next.rows[count];
      }
      return null;
    },
    // Место зависит только от числа строк и колонок
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, normal.columns, layout],
  );
}

// Перенос строки мышью: нажатие, порог в несколько пикселей, затем слушатели окна
function useRowDrag({ frameRef, geometry, editing, onReorder }) {
  const [gesture, setGesture] = useState(IDLE_GESTURE);
  const holdRef = useRef(null),
    swallowRef = useRef(false),
    geoRef = useRef(geometry);
  geoRef.current = geometry;

  // Слушатели окна: двигаем, отпускаем или отменяем своё нажатие
  const connect = () => {
    const sample = (event) => pointOf(frameRef.current, geoRef.current, event);
    const slotUnder = ({ sheetX, sheetY }) => dropTarget(geoRef.current.slots, sheetX, sheetY);
    const wiring = {
      pointermove(event) {
        const hold = ownHold(holdRef, event);
        const point = hold ? sample(event) : null;
        if (!point || !(hold.dragging || pulledFar(hold, event))) return;
        hold.dragging = true;
        const { x, y } = point;
        const drag = { target: slotUnder(point), index: hold.index, x, y };
        setGesture({ drag, pressing: true });
      },
      pointerup(event) {
        const hold = ownHold(holdRef, event);
        if (!hold) return;
        holdRef.current = null;
        if (hold.dragging) {
          swallowRef.current = true;
          const target = slotUnder(sample(event));
          if (target !== hold.index && target >= 0) onReorder(hold.index, target);
        }
        setGesture(IDLE_GESTURE);
      },
    };
    wiring.pointercancel = wiring.pointerup;
    return listenOnWindow(wiring);
  };
  // Слушатели держат ссылки на свежую раскладку
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => (gesture.pressing ? connect() : undefined), [gesture.pressing]);

  const pressRow = (index, event) => {
    const usable = event.button === 0 && !editing;
    if (!usable) return;
    const { pointerId, clientX: startX, clientY: startY } = event;
    holdRef.current = { dragging: false, index, pointerId, startX, startY };
    setGesture((old) => (old.pressing ? old : { ...old, pressing: true }));
  };

  // Щелчок, которым закончился перенос, строку не «берёт»
  const swallowClick = () => {
    if (!swallowRef.current) return false;
    swallowRef.current = false;
    return true;
  };

  return { drag: gesture.drag, pressRow, swallowClick };
}

/* ---------- разметка ---------- */

// Обработчики места: нажатие, правка по двойному щелчку, клавиши и подсветка
function spotHandlers({ onEdit, onKeyDown, onPointerDown, onPress }, setHover) {
  const hoverOn = () => setHover(true);
  const hoverOff = () => setHover(false);
  return {
    onBlur: hoverOff,
    onClick(event) {
      event.stopPropagation();
      return onPress();
    },
    onDoubleClick(event) {
      if (!onEdit) return;
      event.stopPropagation();
      onEdit();
    },
    onFocus: hoverOn,
    onKeyDown(event) {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (!ACTIVATE_KEYS.has(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter" && onEdit) onEdit();
      else onPress();
    },
    onPointerDown: onPointerDown || undefined,
    onPointerEnter: hoverOn,
    onPointerLeave: hoverOff,
  };
}

// цвета — стилем: var() в атрибутах SVG не читается
function paintFor(look, dashed, lit) {
  const { fill, stroke, strokeWidth } = look;
  if (!dashed) return { fill, stroke, strokeWidth };
  return { fill, stroke: lit ? stroke : FAINT_DASH_STROKE, strokeWidth: strokeWidth || 1.5 };
}

const Spot = (rawProps) => {
  const props = withDefaults(rawProps, SPOT_DEFAULTS);
  const { rect, radius, label, state } = props;
  const { covered, dashed, grab, children } = props;
  const hoverState = useState(false);
  const [hover, setHover] = hoverState;
  const [x, y, width, height] = rect;
  const look = spotStroke(hover && state !== "on" ? "hover" : state);

  return h(
    "g",
    {
      role: "button",
      tabIndex: 0,
      "aria-label": label,
      "aria-pressed": state === "on" || undefined,
      "data-audit-ignore": [undefined, "covered"][Number(Boolean(covered))],
      style: SPOT_STYLES[Number(Boolean(grab))],
      ...spotHandlers(props, setHover),
    },
    h("rect", {
      x,
      y,
      width,
      height,
      rx: radius,
      style: paintFor(look, dashed, hover || state === "on"),
      strokeDasharray: dashed ? DASHES : undefined,
      vectorEffect: NON_SCALING,
    }),
    children,
  );
};

// Рамка поверх листа без событий: след поднятой строки или место посадки
function outlineOf(slot, extra, look) {
  const [x, y, width, height] = wholeRect(slot);
  return h("rect", { x, y, width, height, rx: slot.radius, ...extra, style: look });
}

function headingSpot({ normal, heading, editing, onPick, onEdit }) {
  return h(Spot, {
    key: "~heading",
    rect: headingRectOf(heading),
    label: `Заголовок «${normal.title || tr("без заголовка")}»: изменить`,
    state: "off",
    covered: Boolean(editing),
    onPress: () => onPick(-1),
    onEdit: () => onEdit({ kind: "title" }),
  });
}

function rowGroup(view, slot) {
  const { normal, editing, selected, onEdit, onIcon } = view;
  const { index } = slot;
  const common = { radius: slot.radius, covered: Boolean(editing) };
  const plate = {
    ...common,
    rect: plateRect(slot),
    label: rowLabel(slot, normal.rows[index]),
    state: !editing && index === selected ? "on" : "off",
    grab: !editing,
    onPress: () => view.pickRow(index),
    onEdit: () => onEdit({ kind: "row", index }),
    onPointerDown: (event) => view.pressRow(index, event),
    onKeyDown: view.rowKeys(index),
  };
  const badge = {
    ...common,
    rect: badgeRect(slot),
    label: `Значок строки ${index + 1}: изменить`,
    onPress: () => onIcon(index),
  };
  return h("g", { key: slot.id }, h(Spot, plate), h(Spot, badge));
}

// «+» посередине пустого места
function plusPath(ghost) {
  const middle = (ghost.box[0] + ghost.plate[2]) / 2;
  const { centreY, cap } = ghost;
  return h("path", {
    d: `M${middle} ${centreY - cap * 0.7}v${cap * 1.4}M${middle - cap * 0.7} ${centreY}h${cap * 1.4}`,
    stroke: "rgba(255, 255, 255, 0.6)",
    strokeWidth: 2,
    vectorEffect: NON_SCALING,
    fill: "none",
  });
}

function ghostSpot({ editing, onAdd }, ghost) {
  const props = {
    key: "~ghost",
    rect: wholeRect(ghost),
    radius: ghost.radius,
    label: tr("Добавить строку сюда"),
    dashed: true,
    covered: Boolean(editing),
    onPress: () => onAdd(),
  };
  return h(Spot, props, plusPath(ghost));
}

function dragTag(drag, row) {
  const style = Object.assign({}, DRAG_TAG_LOOK, { left: drag.x + 12, top: drag.y - 18 });
  return h("div", { "aria-hidden": "true", style }, rowTitle(row));
}

function letterInput(spec) {
  const { ref, label, value, max } = spec;
  return h("input", {
    ref,
    type: "text",
    className: "schedule-letters",
    "aria-label": label,
    "data-audit-ignore": AUDIT_TEXT_FIELD,
    value,
    maxLength: max,
    spellCheck: false,
    autoComplete: "off",
    style: spec.style,
    onChange: spec.onChange,
    onKeyDown: spec.onKeyDown,
  });
}

const InlineEdit = (props) => {
  const { editing, project, fit, k } = props;
  const { onRow, onTitle, onClose } = props;
  const tr = useTr();
  const groupRef = useRef(null),
    nameRef = useRef(null),
    timeRef = useRef(null);

  useEffect(() => void caretToEnd(nameRef.current), []);

  const places = scheduleTextPlaces(project, editing);
  const { family: fontFamily } = places?.font ?? {};

  // общее правило `input { font-family: … !important }` перебивает style, и каретка вставала бы до конца слова
  useLayoutEffect(() => {
    if (fontFamily) {
      [nameRef, timeRef].forEach(({ current }) => {
        current?.style.setProperty("font-family", fontFamily, "important");
      });
    }
  }, [fontFamily, editing.kind, editing.index]);

  const closeOnEnter = (event) => event.key === "Enter" && onClose();
  const toTime = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const next = timeRef.current;
      caretToEnd(next);
    }
  };

  // Что правим: подпись группы и описания полей
  const titleShape = (plan) => ({
    heading: tr("Правка заголовка на табло"),
    fields: [
      {
        ref: nameRef,
        label: tr("Заголовок табло"),
        place: plan.title,
        onChange: (event) => onTitle(event.target.value),
        onKeyDown: closeOnEnter,
        value: project.title,
        max: SCHEDULE_LIMITS.title,
      },
    ],
  });
  const rowShape = (plan) => {
    const { index } = editing;
    const row = project.rows.at(index);
    const refs = { name: nameRef, time: timeRef };
    return {
      heading: `Правка строки ${index + 1} на табло`,
      fields: ROW_COLUMNS.map(([spot, prop, ask, note], order) => ({
        ref: refs[spot],
        label: `${ask} ${index + 1}`,
        place: plan[spot],
        onKeyDown: order ? closeOnEnter : toTime,
        onChange: (event) => onRow(index, { [prop]: event.target.value }, `Строка ${index + 1}: ${note}`),
        value: row[prop],
        max: SCHEDULE_LIMITS[prop],
      })),
    };
  };

  const compose = (plan) => {
    const { heading, fields } = editing.kind === "title" ? titleShape(plan) : rowShape(plan);
    const { font, baseline, cap } = plan;
    return h(
      "div",
      {
        ref: groupRef,
        role: "group",
        "aria-label": heading,
        onKeyDown(event) {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        },
        onBlur(event) {
          const group = groupRef.current;
          if (!(group && group.contains(event.relatedTarget))) onClose();
        },
      },
      ...fields.map(({ place, ...field }) =>
        letterInput({ ...field, style: letterField(place, font, baseline, cap, fit, k) }),
      ),
    );
  };

  return places ? compose(places) : null;
};

/* ---------- кадр ---------- */

const ScheduleBoard = (rawProps) => {
  const props = withDefaults(rawProps, {
    picture: rawProps.project,
    showServer: false,
    selected: -1,
    editing: null,
    onPick: noop,
    onReorder: noop,
    children: null,
  });
  const { project, picture, showServer } = props;
  const { editing, onEdit, onPick, onReorder, children } = props;

  const tr = useTr(),
    frameRef = useRef(null),
    canvasRef = useRef(null);
  const fit = useBoardFit(frameRef);
  useBoardPicture(canvasRef, picture, fit, showServer);

  const normal = normalizeScheduleProject(project);
  const [layout, count] = [sheetLayout(normal), normal.rows.length];
  const ghost = useGhostSlot(normal, layout, count);
  const k = fit.width / layout.width;

  const { drag, pressRow, swallowClick } = useRowDrag({
    frameRef,
    geometry: { fit, k, slots: layout.rows },
    editing,
    onReorder,
  });
  const { dragged, fromSlot, dropSlot } = dragFacts(drag, normal.rows, layout.rows);

  const view = {
    ...props,
    normal,
    heading: layout.heading,
    pressRow,
    pickRow: (index) => {
      if (!swallowClick()) onPick(index);
    },
    rowKeys: (index) => keysToMove(index, count, onReorder),
  };

  const pinned = Object.assign(
    { position: "absolute" },
    Object.fromEntries(["left", "top", "width", "height"].map((side) => [side, fit[side]])),
  );
  const outsideSheet = (target) =>
    [frameRef.current, canvasRef.current].includes(target) || target.tagName === "svg";

  // Всё, что лежит на листе, одним списком: у каждого места свой ключ
  const liftedAttrs = { key: "~lifted", strokeDasharray: DASHES, vectorEffect: NON_SCALING };
  const lifted = fromSlot && outlineOf(fromSlot, liftedAttrs, LIFTED_LOOK);
  const landing = dropSlot && outlineOf(dropSlot, { key: "~landing", vectorEffect: NON_SCALING }, LANDING_LOOK);
  const spots = [
    headingSpot(view),
    ...layout.rows.map((slot) => rowGroup(view, slot)),
    ghost && !drag && ghostSpot(view, ghost),
    lifted,
    landing,
  ].filter(Boolean);

  const sheetLabel = showServer ? tr("Лист табло: облик сервера") : `Лист табло: ${rowsText(count)} по работе`;
  const calm = !showServer && !editing && !drag;

  return h(
    "div",
    {
      ref: frameRef,
      className: "model-stage-frame",
      style: drag ? { cursor: "grabbing" } : undefined,
      onPointerDown: (event) => {
        if (editing && outsideSheet(event.target)) onEdit(null);
      },
    },
    h("canvas", { ref: canvasRef, style: pinned, role: "img", "aria-label": sheetLabel }),
    h(
      "svg",
      {
        style: pinned,
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        role: "group",
        "aria-label": tr("Табло: нажмите строку, чтобы взять; дважды — править текст; потяните — переставить"),
      },
      spots,
    ),
    dragged ? dragTag(drag, dragged) : null,
    calm ? h("p", { style: HINT_LOOK }, tr("Дважды по строке — править текст · потяните строку — переставить")) : null,
    editing
      ? h(InlineEdit, {
          key: editing.kind === "row" ? `row-${editing.index}` : "title",
          editing,
          project: normal,
          fit,
          k,
          onRow: props.onRow,
          onTitle: props.onTitle,
          onClose: () => onEdit(null),
        })
      : null,
    children,
  );
};

export default ScheduleBoard;
