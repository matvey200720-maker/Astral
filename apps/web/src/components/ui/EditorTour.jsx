import { tr, useTr } from "../../locales/ui.js";
import { disableHints, hintsEnabled } from "./hints-preference.js";
import { arrowOffset, placeCard } from "./editor-tour-place.js";
import { buildToolTip, selectorFor } from "./editor-tour-steps.js";
import Kbd from "./Kbd.jsx";
import Button from "./Button.jsx";
import { isTextEntry } from "../../utils/hotkeys.js";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* ───────────── таблицы ───────────── */

const LIMITS = {
  autoTries: [650, 1500, 2800],
  remeasure: [80, 240, 600],
  guardEvery: 400,
  guardMisses: 2,
  toolQuiet: 1500,
  spotPad: 6,
  cardGuess: { width: 304, height: 176 },
};

const QUERY = {
  hosts: ["[data-desktop-overlay-host]", ".desktop-app"],
  help: ".ui-editor-help",
  calm: "(prefers-reduced-motion: reduce)",
  ownRoles: '[role="slider"], [role="listbox"], [role="combobox"]',
};

const LEDGER_KEY = "astral.editor.guide.v1";
const AXES = [
  ["left", "width"],
  ["top", "height"],
];
const QUIET_FOCUS = { preventScroll: true, focusVisible: false };

const FLIGHT = {
  card: { duration: 900, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)", fill: "forwards" },
  spot: { duration: 420, easing: "ease-out", fill: "forwards" },
};

// остановки полёта: [offset, куда сдвинуть, поза, скругление, прозрачность]
const inPlace = () => "translate(0, 0)";
const CRUMPLE_STOPS = [
  [0, inPlace, "scale(1) rotate(0deg)", "16px"],
  [0.16, inPlace, "scale(0.86, 0.76) rotate(-6deg)", "30px"],
  [0.32, inPlace, "scale(0.52, 0.47) rotate(10deg)", "42%"],
  [0.46, inPlace, "scale(0.3) rotate(-14deg)", "50%"],
  [
    0.74,
    (dx, dy, lift) => `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px)`,
    "scale(0.16) rotate(170deg)",
    "50%",
  ],
  [1, (dx, dy) => `translate(${dx}px, ${dy}px)`, "scale(0.04) rotate(320deg)", "50%", 0.35],
];

// состояние прохода одним объектом: сам проход и рамка вокруг цели
const IDLE = { run: null, rect: null };
const UNREADABLE = Symbol("unreadable");

/* ───────────── общие помощники ───────────── */

// выполнить работу; если она бросила — вернуть запасное значение
function attempt(work, fallback = null) {
  try {
    return work();
  } catch {
    return fallback;
  }
}

// истина, если сработало хотя бы одно условие (проверяются по порядку)
const blockedBy = (...gates) => gates.some((gate) => gate());

// подписка и её снятие с одним и тем же набором аргументов
function listen(target, type, handler, ...capture) {
  target.addEventListener(type, handler, ...capture);
  return () => target.removeEventListener(type, handler, ...capture);
}

// несколько таймеров на одну работу; возвращает отмену
function schedule(work, delays) {
  const ids = delays.map((ms) => setTimeout(work, ms));
  return () => ids.forEach((id) => clearTimeout(id));
}

const autoAllowed = () => import.meta.env.MODE !== "test" || Boolean(globalThis.__astralTourAuto);

/* ───────────── память «показано» ───────────── */

// null — хранилище недоступно; иначе объект (массив тоже годится)
function peekLedger() {
  const raw = attempt(() => globalThis.localStorage.getItem(LEDGER_KEY), UNREADABLE);
  if (raw === UNREADABLE) return null;
  const parsed = attempt(() => JSON.parse(raw));
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function guideSeen(key) {
  const book = peekLedger();
  return book ? Boolean(book[key]) : false;
}

function stamp(key) {
  const book = peekLedger() ?? {};
  book[key] = book[key] || Date.now();
  attempt(() => globalThis.localStorage.setItem(LEDGER_KEY, JSON.stringify(book)));
}

/* ───────────── цели и геометрия ───────────── */

const boxOf = (node) => {
  if (!node) return null;
  const { left, top, right, bottom, width, height } = node.getBoundingClientRect();
  return { left, top, right, bottom, width, height };
};

const targetOf = (root, step) =>
  root && step ? attempt(() => root.querySelector(selectorFor(step.target))) : null;

// прямоугольник цели, если она на экране (не тоньше пикселя), иначе null
const litBox = (root, step) => {
  const box = boxOf(targetOf(root, step));
  return box && box.width >= 1 && box.height >= 1 ? box : null;
};

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function centerPoint({ width, height }) {
  const x = width / 2;
  const y = height / 2;
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

// сторона, координаты и смещение стрелки для карточки шага
function settle(step, rect, size) {
  const view = viewport();
  const aim = rect ?? centerPoint(view);
  const where = placeCard(aim, size, view, step.placement);
  return { ...where, arrow: arrowOffset(where.side, aim, size, where) };
}

function overlayHost() {
  if (typeof document === "undefined") return null;
  for (const selector of QUERY.hosts) {
    const found = document.querySelector(selector);
    if (found) return found;
  }
  return document.body;
}

// кому нужны свои стрелки: списку, выбору, ползунку
const ARROW_OWNERS = [
  (el) => el.tagName === "SELECT",
  (el) => el.tagName === "INPUT" && el.type === "range",
  (el) => el.closest(QUERY.ownRoles) !== null,
];

function ownsArrows(target) {
  if (isTextEntry(target)) return true;
  return typeof target?.closest === "function" && ARROW_OWNERS.some((owns) => owns(target));
}

const sizeOf = (node) => {
  const width = node?.offsetWidth;
  const height = node?.offsetHeight;
  return width && height ? { width, height } : null;
};

/* ───────────── полёт карточки к «?» ───────────── */

// середина прямоугольника по одной оси
const middle = (box, [pos, span]) => box[pos] + box[span] / 2;

function crumpleFrames(dx, dy) {
  const lift = Math.min(140, 40 + 0.15 * Math.abs(dx));
  return CRUMPLE_STOPS.map(([offset, move, pose, round, opacity]) => ({
    transform: `${move(dx, dy, lift)} ${pose}`,
    borderRadius: round,
    ...(opacity === undefined ? {} : { opacity }),
    offset,
  }));
}

// карточка, кнопка «?» и можно ли лететь; null — закрывать сразу
function flightKit(card, root) {
  const help = root ? root.querySelector(QUERY.help) : null;
  const calm = Boolean(window.matchMedia?.(QUERY.calm)?.matches);
  const grounded = [!card, !help, calm, typeof card?.animate !== "function"];
  return grounded.includes(true) ? null : { card, help };
}

function crumpleInto({ card, help }, spot) {
  const [from, to] = [card, help].map((node) => node.getBoundingClientRect());
  const [dx, dy] = AXES.map((axis) => middle(to, axis) - middle(from, axis));
  card.classList.add("is-crumpling");
  card.style.setProperty("transform-origin", "50% 50%");
  const flight = card.animate(crumpleFrames(dx, dy), { ...FLIGHT.card });
  if (typeof spot?.animate === "function") {
    spot.animate([{ opacity: 1 }, { opacity: 0 }], { ...FLIGHT.spot });
  }
  return flight;
}

function restoreFocus(gear) {
  const back = gear.parked;
  gear.parked = null;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}

/* ───────────── переходы прохода ───────────── */

const clampIndex = (i, count) => Math.max(0, Math.min(count - 1, i));
const startRun = (kind, steps) => ({ kind, steps, index: 0 });
const currentStep = (run) => (run ? run.steps[run.index] : null);
const atEnd = (run) => Boolean(run) && run.index === run.steps.length - 1;

function moveRun(run, by) {
  const index = clampIndex(run.index + by, run.steps.length);
  return index === run.index ? run : { ...run, index };
}

// проход без выпавшего шага; null, если шагов не осталось
function dropStep(run, step) {
  const steps = run.steps.filter((one) => one !== step);
  return steps.length ? { ...run, steps, index: clampIndex(run.index, steps.length) } : null;
}

/* ───────────── собственные хуки ───────────── */

// последнее значение без перезапуска подписок
function useLatest(value) {
  const box = useRef(value);
  useLayoutEffect(() => {
    box.current = value;
  });
  return box;
}

// проход целиком: состояние, начало, шаги, закрытие и полёт
function useRunCore(live) {
  const [stage, setStage] = useState(IDLE);
  const cardRef = useRef(null);
  const gear = useRef({ parked: null, flying: false, held: false, toolAt: 0 });
  const spotRef = useRef(null);
  const runNow = useLatest(stage.run);
  const mainRef = useRef(null);

  const begin = useCallback(
    (kind, list) => {
      const root = live.current.rootRef?.current;
      const shown = list.filter((one) => one.tool || litBox(root, one));
      if (!shown.length) return false;
      gear.current.parked = document.activeElement;
      setStage((was) => ({ ...was, run: startRun(kind, shown) }));
      return true;
    },
    [live],
  );

  const shut = useCallback(() => {
    setStage(IDLE);
    restoreFocus(gear.current);
  }, []);

  const finish = useCallback(
    (word) => {
      shut();
      live.current.onDismissed?.(word);
    },
    [shut, live],
  );

  const leave = useCallback(
    (word) => {
      if (gear.current.flying) return;
      const kit = flightKit(cardRef.current, live.current.rootRef?.current);
      if (!kit) {
        finish(word);
        return;
      }
      const flight = crumpleInto(kit, spotRef.current);
      gear.current.flying = true;
      const land = () => {
        gear.current.flying = false;
        finish(word);
      };
      Object.assign(flight, { onfinish: land, oncancel: land });
    },
    [live, finish],
  );

  const go = useCallback(
    (by) =>
      setStage((was) => {
        const next = was.run && moveRun(was.run, by);
        return !next || next === was.run ? was : { ...was, run: next };
      }),
    [],
  );

  // шаг выпал: цель так и не вернулась
  const lapse = useCallback(
    (step) => {
      const cur = runNow.current;
      if (!cur) return;
      const next = dropStep(cur, step);
      if (next) setStage((was) => ({ ...was, run: next }));
      else shut();
    },
    [runNow, shut],
  );

  // каждый перемер ставит новый объект рамки (null после null не в счёт), чтобы карточка
  // пересчитала место по текущему размеру окна
  const fitRect = useCallback(
    (box) => setStage((was) => (was.rect === box ? was : { ...was, rect: box })),
    [],
  );

  return {
    run: stage.run,
    rect: stage.rect,
    fitRect,
    runNow,
    gear,
    cardRef,
    spotRef,
    mainRef,
    begin,
    go,
    leave,
    lapse,
  };
}

// рамка и место: замер цели при смене шага, на resize, scroll и ResizeObserver
function useTargetTracking(step, live, fitRect) {
  useLayoutEffect(() => {
    if (!step) return undefined;

    const measureNow = () => fitRect(litBox(live.current.rootRef?.current, step));
    measureNow();

    let pendingFrame = null;
    const measureOnFrame = () => {
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        measureNow();
      });
    };

    const unlisten = [
      listen(window, "resize", measureOnFrame),
      listen(window, "scroll", measureOnFrame, true),
    ];

    let sizeWatcher = null;
    if (typeof ResizeObserver !== "undefined") {
      const aimed = targetOf(live.current.rootRef?.current, step);
      if (aimed) {
        sizeWatcher = new ResizeObserver(measureOnFrame);
        sizeWatcher.observe(aimed);
      }
    }

    const cancelTimers = step.tool ? schedule(measureNow, LIMITS.remeasure) : null;

    return () => {
      unlisten.forEach((off) => off());
      sizeWatcher?.disconnect();
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      cancelTimers?.();
    };
  }, [step, live, fitRect]);
}

// размер карточки после каждой отрисовки
function useCardSize(cardRef) {
  const [size, setSize] = useState(LIMITS.cardGuess);
  useLayoutEffect(() => {
    const next = sizeOf(cardRef.current);
    if (next && (next.width !== size.width || next.height !== size.height)) setSize(next);
  });
  return size;
}

// самопоказ при первом входе: три попытки и смена видимости окна
function useAutoShow(tourKey, stepsKey, core, live) {
  const { begin, runNow } = core;
  useEffect(() => {
    const mark = `${tourKey}:tour`;
    const noAuto = blockedBy(
      () => !tourKey,
      () => !stepsKey,
      () => !hintsEnabled(),
      () => !autoAllowed(),
      () => guideSeen(mark),
    );
    if (noAuto) return undefined;
    const attempt = () => {
      const busy = blockedBy(
        () => runNow.current,
        () => guideSeen(mark),
        () => !hintsEnabled(),
        () => document.visibilityState === "hidden",
      );
      if (!busy && begin("tour", live.current.steps)) stamp(mark);
    };
    const cancel = schedule(attempt, LIMITS.autoTries);
    const unwatch = listen(document, "visibilitychange", attempt);
    return () => {
      cancel();
      unwatch();
    };
  }, [tourKey, stepsKey, begin, runNow, live]);
}

// кнопка «?»: любая смена числа показывает проход заново
function useReplay(replayToken, core, live) {
  const { begin } = core;
  const lastToken = useRef(replayToken);
  useEffect(() => {
    if (lastToken.current === replayToken) return;
    lastToken.current = replayToken;
    begin("tour", live.current.steps);
  }, [replayToken, begin, live]);
}

// подсказка инструмента, взятого в руку впервые
function useToolTip(tourKey, tool, core, live) {
  const { begin, runNow, gear } = core;
  const toolId = tool?.id;
  const toolHint = tool?.hint;
  const atMount = useRef(toolId);
  useEffect(() => {
    const badge = `${tourKey}:tool:${toolId}`;
    const held = blockedBy(
      () => !tourKey || !toolId || !toolHint,
      () => !hintsEnabled(),
      () => toolId === atMount.current,
      () => Date.now() - gear.current.toolAt < LIMITS.toolQuiet,
      () => runNow.current,
      () => !guideSeen(`${tourKey}:tour`),
      () => guideSeen(badge),
    );
    if (held) return;
    const tip = buildToolTip({ id: toolId, label: live.current.tool?.label, hint: toolHint });
    if (begin("tip", tip)) stamp(badge);
  }, [begin, gear, live, runNow, toolHint, toolId, tourKey]);
}

// onStep: показан шаг, а после шага с инструментом — закрытие
function useStepAnnounce(step, live, gear) {
  useEffect(() => {
    const mine = gear.current;
    const say = (arg) => live.current.onStep?.(arg);
    if (step?.tool) {
      mine.held = true;
      mine.toolAt = Date.now();
    }
    if (step) {
      say(step);
      return;
    }
    if (!mine.held) return;
    mine.held = false;
    mine.toolAt = Date.now();
    say(null);
  }, [step, live, gear]);
}

// сторож: шаг без инструмента выпадает, когда его цель пропала на два обхода
function useTargetGuard(step, core, live) {
  const { runNow, lapse } = core;
  useEffect(() => {
    if (!step || step.tool) return undefined;
    let misses = 0;
    const stale = () => runNow.current?.steps[runNow.current.index] !== step;
    const sees = () => Boolean(litBox(live.current.rootRef?.current, step));
    const timer = setInterval(() => {
      if (stale()) return;
      misses = sees() ? 0 : misses + 1;
      if (misses >= LIMITS.guardMisses) lapse(step);
    }, LIMITS.guardEvery);
    return () => clearInterval(timer);
  }, [step, runNow, lapse, live]);
}

// обработчик клавиш: Escape закрывает, стрелки листают, полям ввода стрелки не отдаём
function keyHandler(onNext, onBack, leave) {
  const moves = new Map([
    ["Escape", () => leave("done")],
    ["ArrowRight", onNext],
    ["ArrowLeft", onBack],
  ]);
  return (event) => {
    const move = moves.get(event.key);
    if (!move || (event.key !== "Escape" && ownsArrows(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
    move();
  };
}

// слушатель переставляется вместе с проходом
function useArrowKeys(run, onNext, onBack, leave) {
  useEffect(
    () => (run ? listen(document, "keydown", keyHandler(onNext, onBack, leave), true) : undefined),
    [run, onNext, onBack, leave],
  );
}

// фокус на главную кнопку при каждой смене шага
function useStepFocus(step, mainRef) {
  useEffect(() => {
    if (step && !isTextEntry(document.activeElement)) mainRef.current?.focus({ ...QUIET_FOCUS });
  }, [step, mainRef]);
}

/* ───────────── разметка: описания узлов и один обходчик ───────────── */

// узел описания: лист несёт готовое содержимое, ветка — список таких же узлов
const leaf = (tag, key, props, node) => ({ tag, key, props, node });
const branch = (tag, key, props, kids) => ({ tag, key, props, kids });

function paint(part) {
  const { tag: Tag, key, props } = part;
  const body = part.kids ? part.kids.filter(Boolean).map(paint) : part.node;
  return (
    <Tag key={key} {...props}>
      {body}
    </Tag>
  );
}

const dotState = (i, at) => (i === at ? "current" : i < at ? "done" : undefined);

function spotPart(step, box, pin) {
  const pad = LIMITS.spotPad;
  return leaf("div", `spot-${step.id}`, {
    ref: pin,
    className: "ui-tour-spot",
    "aria-hidden": "true",
    style: {
      left: `${box.left - pad}px`,
      top: `${box.top - pad}px`,
      width: `${box.width + pad * 2}px`,
      height: `${box.height + pad * 2}px`,
    },
  });
}

function controlsPart(plates) {
  const props = { className: "ui-tour-controls", "aria-label": tr("Управление кадром") };
  return branch(
    "ul",
    "controls",
    props,
    plates.map((plate) => {
      const caps = [].concat(plate.keys);
      return branch("li", `${caps.join("+")}:${plate.text}`, {}, [
        branch(
          "span",
          "keys",
          { className: "ui-tour-keys" },
          caps.map((cap, i) => leaf(Kbd, i, {}, cap)),
        ),
        leaf("span", "label", {}, plate.text),
      ]);
    }),
  );
}

function dotsPart(list, at) {
  const props = { className: "ui-tour-dots", "aria-label": `Шаг ${at + 1} из ${list.length}` };
  return branch(
    "ol",
    "dots",
    props,
    list.map((one, i) => leaf("li", one.id, { "data-state": dotState(i, at) })),
  );
}

function buttonRows(kind, isFirst, isLast, mainRef, acts) {
  const skipTitle = tr("Подсказки выключатся во всём приложении. Вернуть — «Настройки → Общее → Подсказки»");
  const mainLabel = isLast ? (kind === "tip" ? tr("Понятно") : tr("Готово")) : tr("Далее");
  const skip = { variant: "ghost", size: "sm", title: skipTitle, onClick: acts.skip };
  const back = { variant: "ghost", size: "sm", onClick: acts.back };
  const main = { ref: mainRef, variant: "primary", size: "sm", onClick: acts.next };
  return [
    isLast ? null : leaf(Button, "skip", skip, tr("Пропустить")),
    isFirst ? null : leaf(Button, "back", back, tr("Назад")),
    leaf(Button, "next", main, mainLabel),
  ];
}

function footerPart(kind, list, at, mainRef, acts) {
  const rows = buttonRows(kind, at === 0, at === list.length - 1, mainRef, acts);
  return branch("footer", "foot", { className: "ui-tour-foot" }, [
    list.length > 1 ? dotsPart(list, at) : null,
    branch("span", "buttons", { className: "ui-tour-buttons" }, rows),
  ]);
}

// диалог без модальности: имя и описание берутся из заголовка и текста шага
function cardAttrs(holder, side, stem, arrow) {
  return {
    ref: holder,
    className: "ui-tour-card",
    "data-side": side,
    role: "dialog",
    "data-ui-tour": "",
    "aria-modal": "false",
    "aria-labelledby": `${stem}-title`,
    "aria-describedby": `${stem}-text`,
    style: { "--ui-tour-arrow": `${arrow}px` },
  };
}

function cardPart({ kind, list, at, side, arrow, refs, acts }) {
  const step = list[at];
  const stem = `ui-tour-${step.id}`;
  const plates = step.keys;
  return branch("section", `card-${step.id}`, cardAttrs(refs.card, side, stem, arrow), [
    leaf("span", "arrow", { className: "ui-tour-arrow", "aria-hidden": "true" }),
    leaf("b", "title", { id: `${stem}-title`, className: "ui-tour-title" }, step.title),
    leaf("p", "text", { id: `${stem}-text`, className: "ui-tour-text" }, step.text),
    plates?.length ? controlsPart(plates) : null,
    footerPart(kind, list, at, refs.main, acts),
  ]);
}

function Layer({ run, rect, size, refs, acts }) {
  const { kind, steps: list, index: at } = run;
  const step = list[at];
  const { side, x, y, arrow } = settle(step, rect, size);
  const anchorStyle = { transform: `translate(${x}px, ${y}px)` };
  const card = cardPart({ kind, list, at, side, arrow, refs, acts });
  return paint(
    branch("div", "layer", { className: "ui-tour", "data-kind": kind }, [
      rect ? spotPart(step, rect, refs.spot) : null,
      branch("div", "anchor", { className: "ui-tour-anchor", style: anchorStyle }, [card]),
    ]),
  );
}

/* ───────────── компонент ───────────── */

export default function EditorTour(props) {
  const { onStep = null, onDismissed = null, paused = false } = props;
  const { tourKey, rootRef, tool = null, steps = [], replayToken = 0 } = props;
  useTr();
  const live = useLatest({ rootRef, steps, tool, onStep, onDismissed });
  const core = useRunCore(live);
  const { run, rect, fitRect, cardRef, spotRef, mainRef, gear, go, leave } = core;
  const step = currentStep(run);
  const isLast = atEnd(run);

  const onNext = useCallback(() => (isLast ? leave("done") : go(1)), [isLast, leave, go]);
  const onBack = useCallback(() => go(-1), [go]);
  const onSkip = useCallback(() => {
    disableHints();
    leave("skip");
  }, [leave]);

  useTargetTracking(step, live, fitRect);
  const size = useCardSize(cardRef);
  useAutoShow(tourKey, steps.map((one) => one.id).join("|"), core, live);
  useReplay(replayToken, core, live);
  useToolTip(tourKey, tool, core, live);
  useStepAnnounce(step, live, gear);
  useTargetGuard(step, core, live);
  useArrowKeys(run, onNext, onBack, leave);
  useStepFocus(step, mainRef);

  if (!run || !step || paused) return null;
  const host = overlayHost();
  if (!host) return null;
  const refs = { card: cardRef, spot: spotRef, main: mainRef };
  const acts = { next: onNext, back: onBack, skip: onSkip };
  return createPortal(<Layer run={run} rect={rect} size={size} refs={refs} acts={acts} />, host);
}
