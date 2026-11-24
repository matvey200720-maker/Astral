import { useLoaderPace } from "./use-loader-pace.js";
import { LOADER_STAGES, loaderKit } from "./loader-kits.js";
import { tr, useTr } from "../../../locales/ui.js";
import { createElement as h, useEffect, useRef, useState } from "react";

const SLOW_MS = 12000;
const STAR =
  "M80 56 C82 70 90 78 104 80 C90 82 82 90 80 104 C78 90 70 82 56 80 C70 78 78 70 80 56 Z";

const PROP_DEFAULTS = Object.freeze({
  progress: null,
  phase: "in",
  kit: "hall",
  stage: "",
  title: "",
  detail: "",
  passThrough: false,
  error: "",
  onRetry: null,
  onOpenWithoutTextures: null,
  onBack: null,
  outMs: null,
});

const LOADER_VARIANTS = Object.freeze("star frame scan orbit".split(" "));

// Счётчик по кругу: первый вариант случайный, дальше строго по очереди.
let turn = Math.floor(LOADER_VARIANTS.length * Math.random());

function nextLoaderVariant() {
  const variant = LOADER_VARIANTS[turn % LOADER_VARIANTS.length];
  turn += 1;
  return variant;
}

const StageStrip = ({ phase = "in" }) =>
  h(
    "div",
    { className: "stage-strip", "data-phase": phase, "aria-hidden": "true" },
    h("i"),
  );

// Недостающее свойство (undefined) заменяется умолчанием; null и "" остаются как есть.
function withDefaults(props, defaults) {
  return Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => [
      name,
      props[name] === undefined ? fallback : props[name],
    ]),
  );
}

const fill = (text, values) =>
  tr(text)
    .split(/\{(\d+)\}/)
    .map((part, at) => (at % 2 ? String(values[part] ?? "") : part))
    .join("");

/* ---------- расчёты доли и шагов ---------- */

function stageIndex(stage) {
  const found = LOADER_STAGES.indexOf(stage);
  return found < 0 ? 0 : found;
}

function sheetsOf(progress) {
  const known = progress && progress.total > 0;
  return known
    ? { known, done: progress.done, total: progress.total }
    : { known, done: 0, total: 0 };
}

/** Что карточка знает настоящего для хода (`use-loader-pace.js`): сколько шагов готово подряд и доля идущего шага. */
function paceInputOf(sheets, phase, stage) {
  const leaving = phase === "out";
  const states = stage
    ? statesByStage(stage, leaving)
    : statesBySheets(sheets, leaving);
  let closed = 0;
  while (closed < states.length && states[closed] === "done") closed += 1;
  const counting = !stage && states[2] === "run" && sheets.total > 0;
  return {
    closed,
    partial: counting ? Math.min(sheets.done / sheets.total, 1) : 0,
    done: leaving,
  };
}

// знак разности «шаг − текущий» выбирает слово: раньше — готово, тот же — идёт, позже — ждёт
const BY_SIGN = ["done", "run", "wait"];

function statesByStage(stage, leaving) {
  const at = leaving ? LOADER_STAGES.length : stageIndex(stage);
  return Array.from(
    { length: 4 },
    (_, index) => BY_SIGN[Math.sign(index - at) + 1],
  );
}

// по одному правилу на шаг, когда этапы не заданы и считаем листы текстур
const SHEET_RULES = [
  ({ known }) => (known ? "done" : "run"),
  ({ known }) => (known ? "done" : "wait"),
  ({ known, sheetsDone }) => (!known ? "wait" : sheetsDone ? "done" : "run"),
  ({ leaving, sheetsDone }) => (leaving ? "done" : sheetsDone ? "run" : "wait"),
];

function statesBySheets({ known, done, total }, leaving) {
  const sheetsDone = known && done >= total;
  return SHEET_RULES.map((rule) => rule({ known, sheetsDone, leaving }));
}

const CAPTION = {
  done: () => tr("готово"),
  wait: () => tr("ждёт"),
  run: () => "",
};

function stepsOf(sheets, phase, kit, stage) {
  const leaving = phase === "out";
  const states = stage
    ? statesByStage(stage, leaving)
    : statesBySheets(sheets, leaving);
  const texts = [
    kit.read,
    kit.build,
    kit.third || "Накладываю текстуры",
    kit.fourth || "Настраиваю свет",
  ];
  const counting = !stage && states[2] === "run";
  return states.map((state, index) => ({
    label: tr(texts[index]),
    state,
    value:
      counting && index === 2
        ? fill("{0} из {1}", [sheets.done, sheets.total])
        : CAPTION[state](),
  }));
}

// Состояние карточки: первое сработавшее условие, иначе «идёт».
function stateOf(error, phase, slow) {
  const hit = [
    [error, "error"],
    [phase === "out", "done"],
    [slow, "slow"],
  ].find(([on]) => on);
  return hit ? hit[1] : "run";
}

function captionsOf({ title, detail, known, kit }) {
  return {
    heading: title || tr("Загружаем модели…"),
    sub: detail || (known ? tr(kit.about) : tr("Открываю сцену…")),
  };
}

/* ---------- хуки ---------- */

// «Долго» через SLOW_MS и перерисовка раз в секунду ради счётчика секунд.
function useSlowFlag() {
  const [, setNow] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timers = [
      [setTimeout(() => setSlow(true), SLOW_MS), clearTimeout],
      [setInterval(() => setNow(Date.now()), 1000), clearInterval],
    ];
    return () => timers.forEach(([id, cancel]) => cancel(id));
  }, []);
  return slow;
}

function useElapsedSeconds() {
  const since = useRef(null);
  since.current ??= Date.now();
  const elapsed = Date.now() - since.current;
  return elapsed > 0 ? Math.round(elapsed / 1000) : 0;
}

/* ---------- разметка ---------- */

function markSvg() {
  const attrs = {
    viewBox: "0 0 160 160",
    className: "stage-loader-mark-svg",
    "aria-hidden": "true",
  };
  return h(
    "svg",
    attrs,
    h("path", { d: STAR, className: "stage-loader-mark" }),
  );
}

function headOf(heading, sub, pace, measured) {
  const titles = h(
    "div",
    { className: "stage-loader-titles" },
    h("b", null, heading),
    h("span", null, sub),
  );
  return h(
    "div",
    { className: "stage-loader-head" },
    markSvg(),
    titles,
    // число пишет ход напрямую (`use-loader-pace.js`): React видит одну и ту же строку и узел не трогает
    h(
      "strong",
      {
        className: "stage-loader-percent",
        ref: measured ? pace.textRef : undefined,
      },
      measured ? pace.initial : "",
    ),
  );
}

function barOf(heading, measured, pace) {
  const attrs = {
    className: measured ? "stage-loader-bar" : "stage-loader-bar is-unknown",
    role: "progressbar",
    "aria-label": heading,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": measured ? Number.parseInt(pace.initial, 10) : undefined,
  };
  return h("div", attrs, h("i", { ref: measured ? pace.barRef : undefined }));
}

function lineOf(state, error) {
  const failed = state === "error";
  const text = failed
    ? error
    : tr(
        "Идёт дольше обычного — возможно, занят диск. Подождите или вернитесь в мастерскую.",
      );
  return h(
    "p",
    {
      className: `stage-loader-line is-${state}`,
      role: failed ? "alert" : undefined,
    },
    text,
  );
}

function actionsOf(state, handlers) {
  const rules = [
    ["Повторить", handlers.onRetry],
    [
      "Открыть без текстур",
      state === "error" && handlers.onOpenWithoutTextures,
    ],
    ["Назад в мастерскую", handlers.onBack],
  ];
  const buttons = [];
  for (const [text, onClick] of rules) {
    if (onClick)
      buttons.push(
        h("button", { key: text, type: "button", onClick }, tr(text)),
      );
  }
  return h("div", { className: "stage-loader-actions" }, buttons);
}

function stepsListOf(steps) {
  const items = steps.map(({ label, state, value }) =>
    h(
      "li",
      { key: label, "data-state": state },
      h("span", { className: "stage-loader-step-mark", "aria-hidden": "true" }),
      h("span", { className: "stage-loader-step-label" }, label),
      h("em", null, value),
    ),
  );
  return h("ol", { className: "stage-loader-steps" }, items);
}

function footOf(kit, seconds) {
  const hint = tr(
    kit.foot ||
      "Инструменты откроются, когда всё загрузится. В следующий раз будет быстрее: текстуры останутся в кэше.",
  );
  return h(
    "div",
    { className: "stage-loader-foot" },
    h("span", null, hint),
    h("small", null, fill("{0} с", [seconds])),
  );
}

/* ---------- компонент ---------- */

const StageLoader = (props) => {
  useTr();
  const slow = useSlowFlag();
  const view = withDefaults(props, PROP_DEFAULTS);
  const { phase, stage, error, passThrough } = view;
  const kit = loaderKit(view.kit);
  const sheets = sheetsOf(view.progress);
  const seconds = useElapsedSeconds();
  const measured = Boolean(sheets.known || stage);
  const state = stateOf(error, phase, slow);
  const pace = useLoaderPace({
    kit: view.kit,
    ...paceInputOf(sheets, phase, stage),
    enabled: measured,
    frozen: state === "error",
  });
  const { heading, sub } = captionsOf({
    title: view.title,
    detail: view.detail,
    known: sheets.known,
    kit,
  });
  const trouble =
    state === "error" || state === "slow"
      ? [lineOf(state, error), actionsOf(state, view)]
      : [null, null];

  const rootProps = {
    className: passThrough ? "stage-loader is-through" : "stage-loader",
    "data-phase": phase,
    role: "status",
    "aria-live": "polite",
    /* Короткое растворение (`StageLoadOverlay`, `outMs`): анимация кончается чуть раньше, чем карточка уходит из дерева. */
    style: view.outMs ? { "--stage-loader-out": `${Math.max(view.outMs - 20, 60)}ms` } : undefined,
  };
  return h(
    "div",
    rootProps,
    h(
      "div",
      { className: "stage-loader-card", "data-state": state },
      headOf(heading, sub, pace, measured),
      barOf(heading, measured, pace),
      ...trouble,
      stepsListOf(stepsOf(sheets, phase, kit, stage)),
      footOf(kit, seconds),
    ),
  );
};

export {
  LOADER_VARIANTS,
  StageStrip,
  nextLoaderVariant,
  StageLoader as default,
};
