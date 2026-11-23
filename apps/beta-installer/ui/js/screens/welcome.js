// Ввод кода беты и экран «Уже установлена».
import { h, icon } from "../dom.js";
import {
  CODE_BODY_LENGTH,
  CODE_PREFIX,
  caretAfter,
  formatCodeBody,
  isCodeComplete,
  normalizeCodeInput,
  validBefore,
} from "../code.js";
import { formatBytes, productName, shortenPath } from "../format.js";
import { button, callout, kv, screen, setButton, stepper } from "../parts.js";

const TICK_MS = 500;
// Вставку забираем себе, если в буфере уже почти целый код или явная приставка «BETA» с разделителем.
const GRAB_MIN_CHARS = 8;
const BETA_LEAD = /^\s*BETA[\s\-_]/i;
// Мягкие ошибки поля (жёлтые). Всё остальное, и неизвестное, красное: «код не тот».
const SOFT_CODES = new Set(["BETA_NOT_REGISTERED", "RATE_LIMITED", "BETA_UNAVAILABLE", "SERVER_UNAVAILABLE", "NETWORK_UNAVAILABLE"]);
const FOLDER_TEXT = { FOLDER_NOT_ALLOWED: "ready.folderProtected", FOLDER_NOT_WRITABLE: "ready.folderReadOnly" };
const INPUT_ATTRS = "type=text inputmode=text autocapitalize=characters autocomplete=off autocorrect=off spellcheck=false";
// Кнопки экранов: [ключ подписи, вид, значок слева, значок справа, на всю ширину, действие].
const BUTTONS = {
  site: ["welcome.openSite", "secondary", "external", null, true, "openSite"],
  submit: ["welcome.submit", "primary", null, "arrow", true, "submitCode"],
  change: ["ready.change", "ghost", "folder", null, false, "chooseInstallDir"],
  launch: ["existing.launch", "primary", "play", null, true, "launch"],
  reinstall: ["existing.reinstall", "secondary", "refresh", null, true, "reinstall"],
};

function makeButton(t, actions, name, extra) {
  const [key, variant, iconName, trailingIcon, block, act] = BUTTONS[name];
  return button({ label: t(key), variant, iconName, trailingIcon, block, onClick: () => actions[act](), ...extra });
}

// Узел по описанию [«тег.класс#id», свойства?, ...дети]; дети — узлы, строки или такие же описания.
const node = (spec) => {
  if (!Array.isArray(spec)) return spec;
  const [selector, ...kids] = spec;
  const [tag, ...marks] = selector.split(/(?=[.#])/);
  const props = kids[0]?.constructor === Object ? kids.shift() : {};
  const named = (sign) => marks.filter((m) => m[0] === sign).map((m) => m.slice(1));
  return h(tag, { class: named(".").join(" ") || undefined, id: named("#")[0], ...props }, ...kids.map(node));
};

export function channelLabel(channel) {
  const text = channel ? String(channel) : "";
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

// Сколько секунд ещё ждать по ошибке поля: до `until`, с округлением вверх.
export function waitLeft(fieldError) {
  const ms = Number(fieldError?.until) - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

// Подсказка под полем по приоритету: ошибка поля, лишние знаки, обрезка, «время вышло».
// `rejected` читается только когда ошибки поля нет.
export function hintFor(state, t, left) {
  const { fieldError } = state;
  if (fieldError) {
    const tone = SOFT_CODES.has(fieldError.code) ? "warning" : "error";
    return { tone, field: true, text: t(`field.${fieldError.code}`, { seconds: left }) };
  }
  const plain = [
    [state.rejected.length, "warning", "welcome.rejected", { chars: state.rejected.join(", ") }],
    [state.truncated, "warning", "welcome.truncated"],
    [state.notice === "expired", "info", "welcome.notice.expired"],
  ].find(([on]) => on);
  return plain ? { tone: plain[1], text: t(plain[2], plain[3]) } : null;
}

export function mountWelcome(ctx) {
  let timer = 0;
  let state = ctx.state;
  const { t, locale, actions } = ctx;
  const stop = () => window.clearInterval(timer);

  const input = node([
    "input#code-input.field-input",
    {
      ...Object.fromEntries(INPUT_ATTRS.split(" ").map((pair) => pair.split("="))),
      placeholder: t("welcome.placeholder"),
      "aria-label": t("welcome.label"),
      "aria-describedby": "code-hint",
    },
  ]);
  const caretTo = (n) => input.setSelectionRange(n, n);
  const toEnd = () => caretTo(input.value.length);
  // Записать тело кода в поле, курсор в конец, и сообщить приложению.
  const take = (parsed) => {
    input.value = formatCodeBody(parsed.body);
    toEnd();
    actions.editCode(parsed);
  };

  const keys = { Enter: () => actions.submitCode() };
  const listeners = {
    input: () => {
      const raw = input.value;
      const parsed = normalizeCodeInput(raw);
      const caret = input.selectionStart ?? raw.length;
      const leftOfCaret = Math.min(validBefore(raw, caret), parsed.body.length);
      input.value = formatCodeBody(parsed.body);
      caretTo(caretAfter(input.value, leftOfCaret));
      const { body, rejected, truncated } = parsed;
      actions.editCode({ body, rejected, truncated });
    },
    paste: (event) => {
      const pasted = event.clipboardData ? event.clipboardData.getData("text") : "";
      const parsed = normalizeCodeInput(pasted);
      const worthGrabbing = parsed.body.length >= GRAB_MIN_CHARS || BETA_LEAD.test(pasted);
      if (!worthGrabbing) return;
      event.preventDefault();
      take(parsed);
    },
    keydown: (event) => {
      if (!Object.hasOwn(keys, event.key)) return;
      event.preventDefault();
      keys[event.key]();
    },
  };
  Object.entries(listeners).forEach(([type, fn]) => input.addEventListener(type, fn));

  const pasteFromClipboard = async () => {
    try {
      take(normalizeCodeInput(await navigator.clipboard.readText()));
    } catch {
      // нет доступа к буферу: остаётся только вернуть фокус
    }
    input.focus();
  };

  const countEl = node(["span.field-count"]);
  const box = node([
    "div.field-box",
    { "data-tone": "" },
    ["span.field-prefix", { "aria-hidden": "true" }, `${CODE_PREFIX}-`],
    input,
    ["button.field-action.field-action-icon", { type: "button", onClick: pasteFromClipboard, ...Object.fromEntries(["aria-label", "title"].map((k) => [k, t("common.paste")])) }, icon("paste")],
  ]);
  const hint = node(["div.field-hint#code-hint", { "aria-live": "polite", "data-tone": "" }]);
  const siteBtn = makeButton(t, actions, "site");
  const submitBtn = makeButton(t, actions, "submit", { disabled: true });
  // Кнопка «Изменить» появляется только если папку можно выбирать уже при монтировании.
  const changeBtn = ctx.state.init?.canChooseDir ? makeButton(t, actions, "change") : null;
  const pathEl = node(["span.path.selectable", { title: "" }]);
  const freeEl = node(["span.meta-line"]);
  const folderRow = node([
    "div.welcome-folder",
    ["div.welcome-folder-text", ["span.welcome-folder-label", t("ready.folder")], pathEl],
    changeBtn,
  ]);
  const folderNote = node(["div", { role: "status" }]);
  const helpLink = ["button.link", { onClick: () => actions.openSite(), type: "button" }, t("welcome.help")];

  const body = [
    node(["div.field", ["div.field-label-row", ["label", { for: "code-input" }, t("welcome.label")], countEl], box, hint]),
    siteBtn,
  ];
  const foot = [submitBtn, node(["div.screen-foot-row", helpLink, freeEl]), folderRow, folderNote];
  const [title, text] = [t("welcome.title"), t("welcome.text")];
  const el = screen("welcome", { lead: stepper(t, 1), title, text, body, foot });

  function render() {
    stop();
    const { code, submitting, fieldError, choosingDir, folderError } = state;
    const { installDir = "", freeBytes: free } = state.init ?? {};
    const left = waitLeft(fieldError);
    const busy = Boolean(submitting);
    // Без ошибки под полем стоит обычная подсказка про вид кода: полоса не пустует (16.11.2026).
    const note = hintFor(state, t, left) ?? { tone: "info", text: t("welcome.hintDefault") };
    const value = formatCodeBody(code);
    if (input.value !== value) {
      input.value = value;
      if (document.activeElement === input) toEnd();
    }
    const freeLine = t("welcome.free", { size: formatBytes(free, { t, locale }) });
    const folderKey = Object.hasOwn(FOLDER_TEXT, folderError) ? FOLDER_TEXT[folderError] : "ready.folderFailed";
    const props = [
      [input, "readOnly", busy],
      [folderRow, "hidden", !installDir],
      [pathEl, "textContent", shortenPath(installDir)],
      [freeEl, "textContent", Number.isFinite(free) ? freeLine : ""],
      [countEl, "textContent", t("welcome.count", { total: CODE_BODY_LENGTH, count: code.length })],
      [siteBtn, "hidden", fieldError?.code !== "BETA_NOT_REGISTERED"],
    ];
    const attrs = [
      [pathEl, "title", String(installDir)],
      [hint, "data-tone", note?.tone ?? ""],
      [box, "data-tone", note?.field ? note.tone : ""],
    ];
    const kids = [
      [hint, note ? [icon(note.tone === "error" ? "alert" : note.tone), h("span", null, note.text)] : []],
      [folderNote, folderError ? [callout({ tone: "danger", text: t(folderKey) })] : []],
    ];
    const buttons = [
      [submitBtn, { label: t(busy ? "welcome.submitting" : "welcome.submit"), disabled: left > 0 || busy || !isCodeComplete(code), busy }],
      changeBtn && [changeBtn, { disabled: choosingDir === true || busy }],
    ];
    for (const [target, prop, v] of props) target[prop] = v;
    for (const [target, name, v] of attrs) target.setAttribute(name, v);
    for (const [target, nodes] of kids) target.replaceChildren(...nodes);
    for (const pair of buttons) if (pair) setButton(...pair);
    if (left > 0) timer = window.setInterval(tick, TICK_MS);
  }

  // Отсчёт: пока срок не вышел, просто перерисовываем; вышел — снимаем ошибку поля.
  const tick = () => {
    const until = state.fieldError?.until;
    if (until && until <= Date.now()) {
      stop();
      actions.clearFieldError();
      return;
    }
    render();
  };

  render();
  return {
    destroy: stop,
    el,
    focus() {
      input.focus();
      toEnd();
    },
    update(next) {
      state = next;
      render();
    },
  };
}

export function mountExisting(ctx) {
  const { t, state, actions } = ctx;
  const { version, channel } = state.init?.existing || { version: "", channel: "" };
  const title = t("existing.title", { name: productName(channel) });
  const text = t("existing.text", { version, channel: channelLabel(channel) });
  // Под пояснением — где стоит Astral: папка из данных хоста, пустой низ панели не оставляем (16.11.2026).
  const installDir = state.init?.installDir;
  const where = installDir ? kv([{ label: t("ready.folder"), value: node(["span.path.selectable", { title: String(installDir) }, shortenPath(installDir)]) }]) : null;
  const body = [node(["div.body-center", callout({ tone: "info", text: t("existing.hint") }), where].filter(Boolean))];
  const foot = ["launch", "reinstall"].map((name) => makeButton(t, actions, name));
  return { el: screen("existing", { title, text, body, foot }) };
}
