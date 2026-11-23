import { h, icon } from "./dom.js";

// Классы, data-* и aria-* здесь — договор со стилями app.css и со снимками экранов:
// порядок атрибутов и детей менять нельзя. Шаги установки — тонкие полосы без кружков с цифрами
// (решение владельца 17.10.2026, 0ad564fc7); номер шага остаётся читалке экрана (aria-current).

// Узел с классом и детьми: простые детали ниже собираются так.
const tagged = (tag, cls, ...kids) => h(tag, { class: cls }, ...kids);

export const spinner = () => h("span", { class: "spinner", ["aria-hidden"]: "true" });

const glyph = (name) => (name ? icon(name) : null);

export const button = ({
  attrs = {},
  block = false,
  busy = false,
  disabled = false,
  iconName = null,
  label,
  onClick,
  trailingIcon = null,
  variant = "secondary",
}) => {
  const classNames = `btn btn-${variant}${block ? " btn-block" : ""}`;
  const node = h(
    "button",
    {
      onClick: (event) => {
        if (onClick && !node.disabled) onClick(event);
      },
      type: "button",
      class: classNames,
      disabled,
      ...attrs,
    },
    busy ? spinner() : glyph(iconName),
    tagged("span", "btn-label", label),
    glyph(trailingIcon),
  );
  return node;
};

// Горячие экраны (ввод кода, скачивание — пять раз в секунду) правят уже собранные узлы, не пересобирая их
// (js/screens/progress.js); для полосы то же делает bar().set.
export const setButton = (node, patch) => {
  const { label, disabled, busy } = patch;
  const edits = [
    [
      label,
      (text) => {
        node.querySelector(".btn-label").textContent = text;
      },
    ],
    [
      disabled,
      (flag) => {
        node.disabled = flag;
      },
    ],
    [
      busy,
      (on) => {
        if (on && !node.querySelector(".spinner")) node.prepend(spinner());
        if (!on) node.querySelector(".spinner")?.remove();
      },
    ],
  ];
  for (const [value, apply] of edits) if (value !== undefined) apply(value);
};

export const bar = (options = {}) => {
  const { label = "", tone: startTone = "" } = options;
  const el = h(
    "div",
    {
      class: "bar",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": label || null,
      "data-tone": startTone || null,
    },
    tagged("span", "bar-fill"),
  );
  const set = (share) => {
    const clamped = Number.isFinite(share) ? Math.min(100, Math.max(0, share)) : 0;
    el.style.setProperty("--p", String(clamped));
    el.setAttribute("aria-valuenow", String(Math.round(clamped)));
  };
  const setTone = (name) => {
    if (name) return el.setAttribute("data-tone", String(name));
    return el.removeAttribute("data-tone");
  };
  return { el, set, tone: setTone };
};

const CALLOUT_ICONS = new Map([
  ["danger", "alert"],
  ["warning", "warning"],
]);

export const callout = ({ text, iconName = null, tone = "info" }) =>
  h(
    "div",
    // Цветное пояснение читается сразу (role=alert); info — обычный текст.
    { class: "callout", ["data-tone"]: tone, role: tone !== "info" ? "alert" : null },
    icon(iconName ?? CALLOUT_ICONS.get(tone) ?? "info"),
    h("span", {}, text),
  );

export const check = ({ label, onChange, id, hint = "", checked = false, disabled = false }) => {
  const input = h("input", { type: "checkbox", id, onChange: () => onChange?.(input.checked), checked, disabled });
  // Поле достаётся экраном через label.control, чтобы ставить галочку из состояния без пересборки.
  return tagged("label", "check", input, tagged("span", "check-box", icon("check", { strokeWidth: 2 + 1 })), tagged("span", "check-copy", h("span", {}, label), hint ? [h("small", {}, hint)] : []));
};

const kvCell = (tag, kid, tone) => h(tag, { "data-tone": tone ?? null }, kid);

export const kv = (rows) =>
  tagged("dl", "kv", rows.filter(Boolean).map((row) => h("div", {}, kvCell("dt", row.label), kvCell("dd", row.value, row.tone))));

export const head = ({ title, text }) =>
  tagged("div", "screen-head", tagged("h2", "screen-title", title), text ? tagged("p", "screen-text", text) : null);

export const stepper = (t, current) => {
  const labelKeys = ["steps.code", "steps.confirm", "steps.install"];
  const stateOf = (n) => {
    if (n < current) return "done";
    return n === current ? "active" : "pending";
  };
  const items = labelKeys.map((labelKey, index) => {
    const state = stateOf(index + 1);
    return h(
      "li",
      { class: "step", "data-state": state, "aria-current": state === "active" ? "step" : null },
      h("span", { class: "step-bar", "aria-hidden": "true" }),
      tagged("span", "step-label", t(labelKey)),
    );
  });
  return h("ol", { class: "steps", "aria-label": t("steps.label") }, items);
};

// Три шага после установки: один блок на скачивании, установке и «Готово» (16.11.2026, правило «пустое пространство не оставляем»).
// Слова — словарь `next.*`: заголовок по `titleKey`, шаги `next.1.title` / `next.1.text` и так далее.
const NEXT_STEPS = [1, 2, 3];

// `compact` — только названия шагов, без пояснений: на скачивании под полосами остаётся меньше места, чем на «Готово».
export const nextSteps = (t, titleKey, { compact = false } = {}) =>
  h(
    "section",
    { class: compact ? "next is-compact" : "next", "aria-label": t(titleKey) },
    tagged("h3", "next-title", t(titleKey)),
    h(
      "ol",
      { class: "next-list" },
      NEXT_STEPS.map((n) =>
        h(
          "li",
          { class: "next-item" },
          tagged("span", "next-num", String(n)),
          tagged("span", "next-copy", h("b", {}, t(`next.${n}.title`)), h("span", {}, t(`next.${n}.text`))),
        ),
      ),
    ),
  );

// Подвал есть, если у foot ненулевая длина — даже когда там одни null.
export const screen = (id, parts) => {
  const { body = [], extra = {}, foot = [], lead = null, text, title } = parts;
  const footer = foot.length ? tagged("div", "screen-foot", ...foot) : null;
  return h(
    "div",
    { class: "screen", "data-screen": id, ...extra },
    lead,
    head({ title, text }),
    tagged("div", "screen-body", body),
    footer,
  );
};
