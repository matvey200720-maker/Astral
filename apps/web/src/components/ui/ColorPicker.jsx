import { tr, useTr } from "../../locales/ui.js";
import { useFrameCoalescedChange } from "./color-coalesce.js";
import { createPortal } from "react-dom";
import { useState, useRef, useLayoutEffect, useEffect, useCallback } from "react";
import { ArrowCounterClockwise, Eyedropper } from "./icons.jsx";

// ───────────────────────── числа ─────────────────────────

const clampBetween = (lo, hi) => (n) => Math.min(hi, Math.max(lo, n));
const unit = clampBetween(0, 1);
const byteRange = clampBetween(0, 255);
const hundredths = (n) => Math.round(n * 100) / 100;
const hexPair = (n) => Math.round(n).toString(16).padStart(2, "0");
// доля пути указателя вдоль органа: пустой орган считается шириной в единицу
const along = (pos, from, extent) => unit((pos - from) / Math.max(1, extent));
const readAlpha = (raw) => unit(Number(raw ?? 1));

const HUE_CEILING = 0.9999;
const hueRange = clampBetween(0, HUE_CEILING);

// Свойства компонентов разбираются таблицей «имя → значение по умолчанию».
// Подставляется только вместо undefined; имён вне таблицы компонент не видит.
const fillProps = (props, defaults) =>
  Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => [
      name,
      props[name] === undefined ? fallback : props[name],
    ]),
  );
const NONE = Object.freeze([]);

// ───────────────────── цветовая математика ─────────────────────

const LONG_FORM = /^#?([0-9a-f]{6})$/i;
const SHORT_FORM = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const BYTE_PAIR = /[0-9a-f]{2}/g;

export function normalizeHex(value) {
  const text = String(value ?? "").trim();
  if (LONG_FORM.test(text)) return `#${text.replace("#", "").toLowerCase()}`;
  return SHORT_FORM.test(text) ? text.replace(SHORT_FORM, "#$1$1$2$2$3$3").toLowerCase() : "";
}

export function hexToRgb(color) {
  const code = normalizeHex(color) || "#000000";
  return code.match(BYTE_PAIR).map((pair) => parseInt(pair, 16));
}

export function rgbToHex(channels) {
  return channels.reduce((code, c) => code + hexPair(byteRange(Number(c) || 0)), "#");
}

export function hexToHsv(color) {
  const levels = hexToRgb(color).map((n) => n / 255);
  const top = Math.max(...levels);
  const span = top - Math.min(...levels);
  const lead = levels.indexOf(top);
  // соседи по кругу: (следующий − предыдущий) / размах, сдвиг на два сектора за канал
  const sextant =
    span === 0
      ? 0
      : ((levels[(lead + 1) % 3] - levels[(lead + 2) % 3]) / span + lead * 2) % 6;
  const turn = sextant / 6;
  return { h: turn < 0 ? turn + 1 : turn, s: top === 0 ? 0 : span / top, v: top };
}

// какие из [v, p, q, t] идут в красный, зелёный и синий в каждом из шести секторов
const SECTOR_TAPS = [
  [0, 3, 1],
  [2, 0, 1],
  [1, 0, 3],
  [1, 2, 0],
  [3, 1, 0],
  [0, 1, 2],
];

export function hsvToHex({
  h,
  s,
  v,
}) {
  const scaled = h * 6;
  const whole = Math.floor(scaled);
  const f = scaled - whole;
  const levels = [v, v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)];
  return `#${SECTOR_TAPS[whole % 6].map((i) => hexPair(unit(levels[i]) * 255)).join("")}`;
}

export const COLOR_PICKER_PALETTE = Object.freeze(
  (
    "000000 262626 4d4d4d 737373 999999 b3b3b3 cccccc e6e6e6 ffffff " +
    "ff3b30 ff6a00 ff9500 ffcc00 a4de02 34c759 00c7be 00a8ff 0a5cff " +
    "5e5ce6 af52de ff2d92 ff8fb1 ffd6a5 fdffb6 caffbf 9bf6ff bdb2ff " +
    "8b1a12 8a3a00 8a6f00 557a01 1c6b30 006b66 06318a 33317a 5e2b78"
  )
    .split(" ")
    .map((digits) => `#${digits}`),
);

const rgbaOf = (hex, alpha) => `rgba(${hexToRgb(hex).join(", ")}, ${alpha})`;

// подписка с возвратом снятия; лишние аргументы уходят как есть (число аргументов — часть договора)
const listen = (target, type, handler, ...extra) => {
  target.addEventListener(type, handler, ...extra);
  return () => target.removeEventListener(type, handler, ...extra);
};

// ───────────────────────── «Недавние» ─────────────────────────

const RECENT_KEY = "astral.colors.recent";
const RECENT_EVENT = "astral:recent-colors";
const RECENT_LIMIT = 18;

const loadStored = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY));
  } catch {
    return null;
  }
};

// каждая запись — через normalizeHex как есть, пустые отбрасываются, повторы остаются
const readRecent = () => {
  const stored = loadStored();
  return Array.isArray(stored)
    ? stored.map(normalizeHex).filter(Boolean).slice(0, RECENT_LIMIT)
    : [];
};

const nextRecent = (previous, hex) =>
  [hex, ...previous.filter((known) => known !== hex)].slice(0, RECENT_LIMIT);

const saveRecent = (list) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // память закрыта: список не сохранится
  }
};

const announceRecent = () => {
  try {
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    // окну без событий оповещать нечем
  }
};

export function rememberColor(color) {
  const hex = normalizeHex(color);
  if (!hex) return;
  saveRecent(nextRecent(readRecent(), hex));
  announceRecent();
}

export function useRecentColors() {
  const [list, setList] = useState(() => readRecent());
  useEffect(() => listen(window, RECENT_EVENT, () => setList(readRecent())), []);
  return list;
}

// ───────────────────────── слова ─────────────────────────

function lexicon() {
  return {
    square: tr("Насыщенность и яркость"),
    hue: tr("Оттенок"),
    opacity: tr("Непрозрачность"),
    reset: tr("Вернуть исходный цвет"),
    code: tr("Код цвета"),
    pipette: tr("Взять цвет с экрана"),
    channels: tr("Цвет по каналам"),
    red: tr("Красный, 0–255"),
    green: tr("Зелёный, 0–255"),
    blue: tr("Синий, 0–255"),
    percent: tr("Непрозрачность, %"),
    fit: tr("Подходящие"),
    fitGroup: tr("Подходящие цвета"),
    recent: tr("Недавние"),
    recentEmpty: tr("Недавние — здесь появятся цвета, которые вы выбирали"),
    recentGroup: tr("Недавние цвета"),
    recentOne: tr("Недавний цвет"),
    ready: tr("Готовые"),
    readyGroup: tr("Готовые цвета"),
    colour: tr("Цвет"),
  };
}

// ───────────────── общие хуки: последнее значение, доска, жест ─────────────────

function useLatest(thing) {
  const holder = useRef(thing);
  useLayoutEffect(() => {
    holder.current = thing;
  });
  return holder;
}

// Состояние окна одним объектом; правила записаны таблицей, а «живая» копия
// в ссылке нужна обработчикам, которые срабатывают раньше следующей отрисовки.
const BOARD_RULES = {
  hsv: (board, hsv) => ({ ...board, hsv }),
  alpha: (board, alpha) => (Object.is(board.alpha, alpha) ? board : { ...board, alpha }),
  hexDraft: (board, hexDraft) => (board.hexDraft === hexDraft ? board : { ...board, hexDraft }),
  typed: (board, [key, text]) => {
    if (board.typed[key] === (text ?? undefined)) return board;
    const rest = Object.entries(board.typed).filter(([name]) => name !== key);
    return { ...board, typed: Object.fromEntries(text === null ? rest : [...rest, [key, text]]) };
  },
};

function useBoard(makeInitial) {
  const [board, setBoard] = useState(makeInitial);
  const live = useRef(board);
  const apply = useCallback((kind, payload) => {
    live.current = BOARD_RULES[kind](live.current, payload);
    setBoard(live.current);
  }, []);
  return [board, apply, live];
}

// Жест указателя: слушатели встают на сам орган и снимаются разом, когда жест кончился.
function useDragSurface(sample) {
  const latest = useLatest(sample);
  return useCallback(
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const surface = event.currentTarget;
      surface.focus({ preventScroll: true });
      surface.setPointerCapture?.(event.pointerId);
      const readAt = (moment, last) => {
        const box = surface.getBoundingClientRect();
        const x = along(moment.clientX, box.left, box.width);
        const y = along(moment.clientY, box.top, box.height);
        latest.current(x, y, last);
      };
      const offs = [];
      const release = () => offs.splice(0).forEach((off) => off());
      const track = (name, last, ends) =>
        offs.push(
          listen(surface, name, (moment) => {
            if (ends) release();
            readAt(moment, last);
          }),
        );
      track("pointermove", false, false);
      track("pointerup", true, true);
      track("pointercancel", false, true);
      readAt(event, false);
    },
    [latest],
  );
}

// ───────────────────── клавиши и разбор набранного ─────────────────────

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

// стрелка → сдвиг по осям с шагом (Shift — крупный); остальные клавиши не трогаем
function arrowShift(event) {
  const pair = ARROWS[event.key];
  if (!pair) return null;
  event.preventDefault();
  const step = event.shiftKey ? 0.1 : 0.02;
  return [(pair[0] ?? 0) * step, (pair[1] ?? 0) * step];
}

const DIGITS = /^\s*(\d{1,3})\s*$/;

function readDigits(text, ceiling) {
  const found = DIGITS.exec(text);
  if (!found) return null;
  const n = Number(found[1]);
  return n <= ceiling ? n : null;
}

const LANE_SIGNS = { ArrowUp: 1, ArrowDown: -1 };

// «Enter» у текстовых полей снимает фокус, а уход из поля уже принимает набранное
const blurOnEnter = (event) => {
  if (event.key === "Enter") event.currentTarget.blur();
};

// Новый цвет сверху: у серых, белого и чёрного оттенок остаётся прежним.
const followHsv = (prevHue, color) => {
  const fresh = hexToHsv(color);
  return fresh.s === 0 || fresh.v === 0 ? { ...fresh, h: prevHue } : fresh;
};

// ───────────────────── ядро окна: что делает каждое действие ─────────────────────

function usePaletteBrain(link) {
  const { color, alphaProp, hasAlpha } = link;
  const colorOut = useFrameCoalescedChange(link.onChange);
  const alphaOut = useFrameCoalescedChange(link.onAlphaChange || undefined);
  const [board, apply, live] = useBoard(() => ({
    hsv: hexToHsv(color),
    alpha: readAlpha(alphaProp),
    hexDraft: null,
    typed: {},
  }));
  // цвет, которому сейчас соответствует состояние: свой выбор или то, что пришло сверху
  const synced = useRef(color);

  useEffect(() => {
    if (synced.current !== color) {
      synced.current = color;
      apply("hsv", followHsv(live.current.hsv.h, color));
    }
  }, [color, apply, live]);

  useEffect(() => {
    apply("alpha", readAlpha(alphaProp));
  }, [alphaProp, hasAlpha, apply]);

  // движение — только наружу через склейку; фиксация — сразу, потом «Недавние», потом onCommit
  const emitMove = (hex) => colorOut.input(hex);
  const emitFinal = (hex) => {
    colorOut.commit(hex);
    rememberColor(hex);
    link.onCommit?.(hex);
  };
  const adoptColor = (hsv, hex, final) => {
    synced.current = hex;
    apply("hsv", hsv);
    (final ? emitFinal : emitMove)(hex);
  };
  const adoptHsv = (hsv, final) => adoptColor(hsv, hsvToHex(hsv), final);
  const adoptHex = (raw, final = true) => {
    const hex = normalizeHex(raw);
    if (hex) adoptColor(hexToHsv(hex), hex, final);
  };
  const adoptAlpha = (value, final) => {
    apply("alpha", value);
    if (final) alphaOut.commit(value);
    else alphaOut.input(value);
  };

  const sampleSquare = (x, y, last) =>
    adoptHsv({ ...live.current.hsv, s: x, v: 1 - y }, last);
  const sampleHue = (x, _y, last) =>
    adoptHsv({ ...live.current.hsv, h: Math.min(HUE_CEILING, x) }, last);
  const sampleOpacity = (x, _y, last) => adoptAlpha(hundredths(x), last);

  const onArrows = (move) => (event) => {
    const shift = arrowShift(event);
    if (shift) move(shift, live.current);
  };
  const keySquare = onArrows(([dx, dy], { hsv: { h, s, v } }) =>
    adoptHsv({ h, s: unit(s + dx), v: unit(v + dy) }, true),
  );
  const keyHue = onArrows(([dx, dy], { hsv: { h, s, v } }) =>
    adoptHsv({ h: hueRange(h + dx + dy), s, v }, true),
  );
  const keyOpacity = onArrows(([dx, dy], { alpha }) =>
    adoptAlpha(hundredths(unit(alpha + dx + dy)), true),
  );

  const typeHex = (text) => {
    apply("hexDraft", text);
    if (normalizeHex(text) && text.replace("#", "").length === 6) adoptHex(text);
  };
  const leaveHex = () => {
    const text = live.current.hexDraft;
    apply("hexDraft", null);
    adoptHex(text ?? "");
  };

  const typeLane = (lane, text) => {
    apply("typed", [lane.key, text]);
    const n = readDigits(text, lane.max);
    if (n !== null) lane.put(n, false);
  };
  const leaveLane = (lane) => {
    const text = live.current.typed[lane.key];
    apply("typed", [lane.key, null]);
    const n = text === undefined ? null : readDigits(text, lane.max);
    if (n !== null) lane.put(n, true);
  };
  const keyLane = (lane, event) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    const sign = LANE_SIGNS[event.key];
    if (typeof sign !== "number") return;
    event.preventDefault();
    apply("typed", [lane.key, null]);
    const next = clampBetween(0, lane.max)(lane.shown + sign * (event.shiftKey ? 10 : 1));
    lane.put(next, true);
  };

  const pipette = async () => {
    let found;
    try {
      found = await new window.EyeDropper().open();
    } catch {
      return;
    }
    adoptHex(found?.sRGBHex);
  };

  return {
    board,
    adoptHex,
    adoptAlpha,
    sampleSquare,
    sampleHue,
    sampleOpacity,
    keySquare,
    keyHue,
    keyOpacity,
    typeHex,
    leaveHex,
    typeLane,
    leaveLane,
    keyLane,
    pipette,
  };
}

// ───────────────────── кирпичики разметки ─────────────────────

// Наборы атрибутов записаны объектами: порядок ключей совпадает с порядком атрибутов в DOM.
const SLIDER = { role: "slider", tabIndex: 0 };
const HEX_FIELD = { className: "ui-color-picker-hex", spellCheck: false, maxLength: 7 };
const CHANNEL_FIELD = {
  inputMode: "numeric",
  maxLength: 3,
  spellCheck: false,
  autoComplete: "off",
};
const SHELF_GROUP = { className: "ui-color-picker-swatches", role: "group" };
const TOOL_BUTTON = { type: "button", className: "ui-color-picker-tool" };

const ORGANS = {
  square: ({ name, pure, sat, bright }) => ({
    className: "ui-color-picker-square",
    style: { backgroundColor: pure },
    ...SLIDER,
    "aria-label": name,
    "aria-valuetext": `насыщенность ${sat}%, яркость ${bright}%`,
    "aria-valuenow": bright,
  }),
  hue: ({ name, degrees }) => ({
    className: "ui-color-picker-hue",
    ...SLIDER,
    "aria-label": name,
    "aria-valuemin": 0,
    "aria-valuemax": 360,
    "aria-valuenow": degrees,
  }),
  alpha: ({ name, color, percent }) => ({
    className: "ui-color-picker-alpha",
    style: { "--ui-color-picker-colour": color },
    ...SLIDER,
    "aria-label": name,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": percent,
    "aria-valuetext": `${percent} %`,
  }),
};

function Thumb({ left, top, paint }) {
  const at = top === undefined ? { left, background: paint } : { left, top, background: paint };
  return <i className="ui-color-picker-thumb" style={at} />;
}

// один обходчик на все три органа: набор атрибутов берётся из таблицы ORGANS
function Organ({ kind, data, thumb, onGrab, onKey }) {
  return (
    <div {...ORGANS[kind](data)} onPointerDown={onGrab} onKeyDown={onKey}>
      <Thumb {...thumb} />
    </div>
  );
}

function ToolButton({ name, onPress, children }) {
  return (
    <button {...TOOL_BUTTON} aria-label={name} title={name} onClick={onPress}>
      {children}
    </button>
  );
}

function ChannelField({ lane, shown, onType, onLeave, onKey }) {
  return (
    <label className="ui-color-picker-channel">
      <span aria-hidden="true">{lane.key}</span>
      <input
        {...CHANNEL_FIELD}
        aria-label={lane.name}
        value={shown}
        onChange={(event) => onType(lane, event.target.value)}
        onBlur={() => onLeave(lane)}
        onKeyDown={(event) => onKey(lane, event)}
      />
    </label>
  );
}

function SwatchButton({ paint, name, active, onPress }) {
  const className = active ? "ui-color-picker-swatch is-active" : "ui-color-picker-swatch";
  return (
    <button
      type="button"
      className={className}
      style={{ background: paint }}
      aria-label={name}
      aria-pressed={active}
      onClick={onPress}
    />
  );
}

// подпись и (если есть что показать) ряд образцов под ней
function Shelf({ caption, group, children }) {
  return (
    <>
      <span className="ui-color-picker-caption">{caption}</span>
      {group ? (
        <div {...SHELF_GROUP} aria-label={group}>
          {children}
        </div>
      ) : null}
    </>
  );
}

// ───────────────────────── окно палитры ─────────────────────────

const POPOVER_PROPS = {
  value: undefined,
  onChange: undefined,
  onCommit: undefined,
  style: undefined,
  defaultValue: "",
  label: "Цвет",
  className: "",
  popoverRef: null,
  role: "dialog",
  swatches: NONE,
  swatchLabel: "",
  alpha: 1,
  onAlphaChange: null,
};

export function ColorPopover(props) {
  useTr();
  const cfg = fillProps(props, POPOVER_PROPS);
  const { label, swatches, swatchLabel } = cfg;
  const words = lexicon();
  const color = normalizeHex(cfg.value) || "#000000";
  const hasAlpha = typeof cfg.onAlphaChange === "function";
  const recents = useRecentColors();
  const brain = usePaletteBrain({
    color,
    alphaProp: cfg.alpha,
    hasAlpha,
    onChange: cfg.onChange,
    onCommit: cfg.onCommit,
    onAlphaChange: cfg.onAlphaChange,
  });
  const squareGrab = useDragSurface(brain.sampleSquare);
  const hueGrab = useDragSurface(brain.sampleHue);
  const opacityGrab = useDragSurface(brain.sampleOpacity);

  const { board } = brain;
  const { h, s, v } = board.hsv;
  const rgb = hexToRgb(color);
  const pure = hsvToHex({ h, s: 1, v: 1 });
  const defaultHex = normalizeHex(cfg.defaultValue);
  const swapChannel = (at, n) => rgb.map((c, i) => (i === at ? n : c));

  const lanes = [
    [words.red, 0],
    [words.green, 1],
    [words.blue, 2],
  ]
    .map(([name, at]) => ({
      key: "RGB"[at],
      name,
      max: 255,
      shown: rgb[at],
      put: (n, final) => brain.adoptHex(rgbToHex(swapChannel(at, n)), final),
    }))
    .concat(
      hasAlpha
        ? {
            key: "%",
            name: words.percent,
            max: 100,
            shown: Math.round(board.alpha * 100),
            put: (n, final) => brain.adoptAlpha(n / 100, final),
          }
        : [],
    );

  const organs = [
    {
      kind: "square",
      data: { name: words.square, pure, sat: Math.round(s * 100), bright: Math.round(v * 100) },
      thumb: { left: `${s * 100}%`, top: `${(1 - v) * 100}%`, paint: color },
      grab: squareGrab,
      key: brain.keySquare,
    },
    {
      kind: "hue",
      data: { name: words.hue, degrees: Math.round(h * 360) },
      thumb: { left: `${h * 100}%`, paint: pure },
      grab: hueGrab,
      key: brain.keyHue,
    },
  ];
  if (hasAlpha) {
    organs.push({
      kind: "alpha",
      // строкой, чтобы NaN доехал до разметки словом, а не предупреждением React
      data: { name: words.opacity, color, percent: String(Math.round(board.alpha * 100)) },
      thumb: { left: `${board.alpha * 100}%`, paint: rgbaOf(color, board.alpha) },
      grab: opacityGrab,
      key: brain.keyOpacity,
    });
  }

  const fits = swatches.map((item) => {
    const hex = normalizeHex(item);
    const shown = hex || item;
    return (
      <SwatchButton
        key={`fit-${shown}`}
        paint={shown}
        name={`${swatchLabel || label} ${shown}`}
        active={hex === color}
        onPress={() => brain.adoptHex(hex)}
      />
    );
  });
  const picks = (list, prefix) =>
    list.map((hex) => (
      <SwatchButton
        key={hex}
        paint={hex}
        name={`${prefix} ${hex.toUpperCase()}`}
        active={hex === color}
        onPress={() => brain.adoptHex(hex)}
      />
    ));

  const rowKids = [
    defaultHex ? (
      <ToolButton key="undo" name={words.reset} onPress={() => brain.adoptHex(defaultHex)}>
        <ArrowCounterClockwise />
      </ToolButton>
    ) : null,
    <span
      key="preview"
      className="ui-color-picker-preview"
      style={{ "--ui-color-picker-colour": hasAlpha ? rgbaOf(color, board.alpha) : color }}
      aria-hidden="true"
    />,
    <input
      key="code"
      {...HEX_FIELD}
      aria-label={words.code}
      value={board.hexDraft ?? color.toUpperCase()}
      onChange={(event) => brain.typeHex(event.target.value)}
      onBlur={brain.leaveHex}
      onKeyDown={blurOnEnter}
    />,
    typeof window.EyeDropper === "function" ? (
      <ToolButton key="drop" name={words.pipette} onPress={brain.pipette}>
        <Eyedropper />
      </ToolButton>
    ) : null,
  ];

  const shelves = [
    fits.length ? (
      <Shelf key="fit" caption={words.fit} group={words.fitGroup}>
        {fits}
      </Shelf>
    ) : null,
    recents.length ? (
      <Shelf key="recent" caption={words.recent} group={words.recentGroup}>
        {picks(recents, words.recentOne)}
      </Shelf>
    ) : (
      <Shelf key="recent" caption={words.recentEmpty} group={null} />
    ),
    <Shelf key="ready" caption={words.ready} group={words.readyGroup}>
      {picks(COLOR_PICKER_PALETTE, words.colour)}
    </Shelf>,
  ];

  const organNodes = organs.map((organ) => (
    <Organ
      key={organ.kind}
      data={organ.data}
      kind={organ.kind}
      onGrab={organ.grab}
      onKey={organ.key}
      thumb={organ.thumb}
    />
  ));
  const toolRow = (
    <div
      key="row"
      className="ui-color-picker-row"
    >
      {rowKids}
    </div>
  );
  const channelNodes = lanes.map((lane) => {
    const draft = board.typed[lane.key];
    return (
      <ChannelField
        key={lane.key}
        lane={lane}
        onKey={brain.keyLane}
        onLeave={brain.leaveLane}
        onType={brain.typeLane}
        shown={draft ?? String(lane.shown)}
      />
    );
  });
  const channelGroup = (
    <div
      key="rgb"
      aria-label={words.channels}
      className="ui-color-picker-rgb"
      role="group"
    >
      {channelNodes}
    </div>
  );
  const slots = [...organNodes, toolRow, channelGroup, ...shelves];

  return (
    <div
      className={cfg.className ? `ui-color-picker ${cfg.className}` : "ui-color-picker"}
      role={cfg.role}
      aria-label={label}
      style={cfg.style}
      ref={cfg.popoverRef}
    >
      {slots}
    </div>
  );
}

// ───────────────────── окно рядом с якорем ─────────────────────

const OVERLAY_HOSTS = ["[data-desktop-overlay-host]", ".desktop-app"];
const GEOMETRY = { gap: 8, margin: 8, lift: 12, width: 300, height: 420 };
const OFFSCREEN = { x: -9999, y: -9999 };

const findHost = () =>
  typeof document === "undefined"
    ? null
    : (OVERLAY_HOSTS.map((selector) => document.querySelector(selector)).find(Boolean) ??
      document.body);

// слева от окна палитры, если справа не хватает места; сверху — не выше поля и не ниже низа окна
const horizontalSpot = (rim, wide) => {
  const { gap, margin } = GEOMETRY;
  return rim.right + gap + wide + margin <= window.innerWidth
    ? rim.right + gap
    : Math.max(margin, rim.left - gap - wide);
};
const verticalSpot = (rim, tall) => {
  const { margin, lift } = GEOMETRY;
  const lowest = Math.max(margin, window.innerHeight - margin - tall);
  return Math.min(Math.max(margin, rim.top - lift), lowest);
};

function placeBeside(anchor, palette) {
  if (!anchor) return null;
  const rim = anchor.getBoundingClientRect();
  return {
    x: horizontalSpot(rim, palette?.offsetWidth || GEOMETRY.width),
    y: verticalSpot(rim, palette?.offsetHeight || GEOMETRY.height),
  };
}

// выполнить start, пока окно открыто; закрыто — ничего не подписывать
const whileOpen = (open, start) => (open ? start() : undefined);

// место окна у якоря: меряется до показа и заново на resize
function useAnchoredSpot(open, anchorRef, paletteRef) {
  const [spot, setSpot] = useState(null);
  const measure = useCallback(() => {
    const next = placeBeside(anchorRef.current, paletteRef.current);
    if (next) setSpot((was) => (was && was.x === next.x && was.y === next.y ? was : next));
  }, [anchorRef, paletteRef]);
  useLayoutEffect(
    () =>
      whileOpen(open, () => {
        measure();
        return listen(window, "resize", measure);
      }),
    [open, measure],
  );
  return spot ?? OFFSCREEN;
}

// «клавиша → действие» на документе, пока окно открыто
const KEY_REACTIONS = new Map([
  [
    "Escape",
    (event, { close, anchor }) => {
      event.stopPropagation();
      event.preventDefault();
      close();
      anchor?.focus();
    },
  ],
]);

function useDismissal(open, anchorRef, paletteRef, close) {
  useEffect(
    () =>
      whileOpen(open, () => {
        const outsideBoth = (event) =>
          [anchorRef.current, paletteRef.current].every((node) => !node?.contains(event.target));
        const onPress = (event) => {
          if (outsideBoth(event)) close();
        };
        const onKey = (event) =>
          KEY_REACTIONS.get(event.key)?.(event, { close, anchor: anchorRef.current });
        const offs = [
          listen(document, "pointerdown", onPress, true),
          listen(document, "keydown", onKey, true),
        ];
        return () => offs.forEach((off) => off());
      }),
    [open, anchorRef, paletteRef, close],
  );
}

const HOOK_PROPS = {
  anchorRef: undefined,
  value: undefined,
  onChange: undefined,
  onCommit: undefined,
  label: "Цвет",
  defaultValue: "",
  swatches: NONE,
  swatchLabel: "",
  alpha: 1,
  onAlphaChange: null,
};

export function useColorPopover(props) {
  const cfg = fillProps(props, HOOK_PROPS);
  const { anchorRef } = cfg;
  const [open, setOpen] = useState(false);
  const paletteRef = useRef(null);
  const spot = useAnchoredSpot(open, anchorRef, paletteRef);
  const close = useCallback(() => setOpen(false), []);
  useDismissal(open, anchorRef, paletteRef, close);

  // всё, кроме anchorRef, уходит в окно как есть; цвет — уже нормализованным
  const forwarded = {
    ...cfg,
    anchorRef: undefined,
    value: normalizeHex(cfg.value) || "#000000",
    style: { position: "fixed", left: spot.x, top: spot.y },
    popoverRef: paletteRef,
  };
  const host = open ? findHost() : null;
  const popover = host ? createPortal(<ColorPopover {...forwarded} />, host) : null;

  return {
    open,
    popover,
    setOpen,
  };
}

// ───────────────────── образец-кнопка ─────────────────────

const PICKER_PROPS = {
  value: undefined,
  onChange: undefined,
  onCommit: undefined,
  defaultValue: "",
  label: "Цвет",
  className: "",
  disabled: false,
  size: "md",
  children: null,
  alpha: 1,
  onAlphaChange: null,
};
// что образец отдаёт окну; swatches, swatchLabel, className и role окно от образца не получает
const PICKER_TO_POPOVER = [
  "onChange",
  "onCommit",
  "defaultValue",
  "label",
  "alpha",
  "onAlphaChange",
];

// порядок ключей — порядок атрибутов кнопки
const triggerAttrs = ({ label, shout, size, className, open, disabled }) => ({
  type: "button",
  className: `ui-color-swatch-button is-${size}${className ? ` ${className}` : ""}`,
  "aria-label": `${label}: ${shout}`,
  "aria-haspopup": "dialog",
  "aria-expanded": open,
  title: `${label} — ${shout}`,
  disabled,
});

export default function ColorPicker(props) {
  const cfg = fillProps(props, PICKER_PROPS);
  const anchorRef = useRef(null);
  const code = normalizeHex(cfg.value) || "#000000";
  const {
    open,
    popover,
    setOpen,
  } = useColorPopover({
    ...Object.fromEntries(PICKER_TO_POPOVER.map((name) => [name, cfg[name]])),
    anchorRef,
    value: code,
  });
  const attrs = triggerAttrs({ ...cfg, shout: code.toUpperCase(), open });
  return (
    <>
      <button ref={anchorRef} {...attrs} onClick={() => setOpen((was) => !was)}>
        <i style={{ background: code }} />
        {cfg.children}
      </button>
      {popover}
    </>
  );
}
