// Первый экран открытого режима (19.11.2026): кода нет, человек жмёт «Продолжить». Код пришёл сам — в имени файла
// установщика (init().openCode); окно зовёт submitCode без кода, хост подставляет его и страница его не видит.
// Нет кода в имени, код просрочен или уже погашен, файл переименован: окно не просит ввести код, а предлагает
// скачать установщик заново (кнопка открывает страницу скачивания на сайте).
// Слова без «беты» и без ввода кода: словарные ключи `open.*` (окно подставляет их вместо одноимённых, см. view.js).
import { h, icon } from "../dom.js";
import { formatBytes, shortenPath } from "../format.js";
import { button, callout, screen, setButton, stepper } from "../parts.js";
import { hintFor, waitLeft } from "./welcome.js";

const FOLDER_TEXT = { FOLDER_NOT_ALLOWED: "ready.folderProtected", FOLDER_NOT_WRITABLE: "ready.folderReadOnly" };
// Отказы по коду, после которых «Продолжить» бесполезно: нужен свежий установщик с сайта.
const DOWNLOAD_AGAIN = new Set([
  "CODE_FORMAT",
  "BETA_CODE_INVALID",
  "BETA_CODE_USED",
  "BETA_CODE_EXPIRED",
  "BETA_CODE_REVOKED",
  "BETA_NOT_REGISTERED",
]);

// Отказы, после которых «Продолжить» превращается в «Повторить»: сервер занят или не отвечает.
const RETRY_CODES = new Set(["BETA_UNAVAILABLE", "SERVER_UNAVAILABLE", "NETWORK_UNAVAILABLE", "RATE_LIMITED"]);

// Блок из нумерованных шагов (классы next-*, как «Что дальше» на скачивании): слова `<prefix>.<n>.title|text`.
function stepsBlock(t, prefix, count) {
  const items = Array.from({ length: count }, (_, at) => {
    const n = at + 1;
    return h(
      "li",
      { class: "next-item" },
      h("span", { class: "next-num" }, String(n)),
      h("span", { class: "next-copy" }, h("b", {}, t(`${prefix}.${n}.title`)), h("span", {}, t(`${prefix}.${n}.text`))),
    );
  });
  return h(
    "section",
    { class: "next", "aria-label": t(`${prefix}.title`) },
    h("h3", { class: "next-title" }, t(`${prefix}.title`)),
    h("ol", { class: "next-list" }, items),
  );
}

export function mountWelcomeOpen(ctx) {
  const { t, locale, actions } = ctx;
  let state = ctx.state;
  let timer = 0;
  const hasCode = state.init?.openCode === true;
  // Кода в имени нет, а сервер не ответил: «нет связи» и «Повторить» (следующий init спросит сервер снова).
  const offline = state.init?.access === "unreachable";
  const stop = () => window.clearInterval(timer);
  // Установщик больше не подходит: кода нет с самого начала или сервер отказал по коду.
  const needsNewInstaller = (current) => !offline && (!hasCode || DOWNLOAD_AGAIN.has(current.fieldError?.code));

  const submitBtn = button({
    label: t("welcome.submit"),
    variant: "primary",
    trailingIcon: "arrow",
    block: true,
    onClick: () => actions.submitCode(),
  });
  const siteBtn = button({
    label: t("open.again.button"),
    variant: "primary",
    iconName: "external",
    block: true,
    onClick: () => actions.openSite(),
  });
  const retryBtn = button({ label: t("common.retry"), variant: "primary", iconName: "refresh", block: true, onClick: () => actions.recheck() });
  const changeBtn = state.init?.canChooseDir
    ? button({ label: t("ready.change"), variant: "ghost", iconName: "folder", onClick: () => actions.chooseInstallDir() })
    : null;
  const hint = h("div", { class: "field-hint", id: "open-hint", "aria-live": "polite", "data-tone": "" });
  const pathEl = h("span", { class: "path selectable", title: "" });
  const freeEl = h("span", { class: "meta-line" });
  const folderRow = h(
    "div",
    { class: "welcome-folder" },
    h("div", { class: "welcome-folder-text" }, h("span", { class: "welcome-folder-label" }, t("ready.folder")), pathEl),
    changeBtn,
  );
  const folderNote = h("div", { role: "status" });

  const middle = offline
    ? callout({ tone: "info", iconName: "info", text: t("open.offline.hint") })
    : hasCode
      ? stepsBlock(t, "open.how", 3)
      : stepsBlock(t, "open.redo", 2);
  const body = [h("div", { class: "body-center" }, middle), hint];
  const foot = [hasCode ? submitBtn : null, siteBtn, retryBtn, h("div", { class: "screen-foot-row" }, h("span"), freeEl), folderRow, folderNote];
  const el = screen("welcome", {
    lead: stepper(t, 1),
    title: t(offline ? "open.offline.title" : hasCode ? "open.welcome.title" : "open.again.title"),
    text: t(offline ? "open.offline.text" : hasCode ? "open.welcome.text" : "open.again.text"),
    body,
    foot,
  });

  function render() {
    stop();
    const { submitting, fieldError, choosingDir, folderError } = state;
    const { installDir = "", freeBytes: free } = state.init ?? {};
    const left = waitLeft(fieldError);
    const busy = Boolean(submitting);
    const again = needsNewInstaller(state);
    const note = again && hasCode ? { tone: "warning", text: t("open.again.hint") } : hintFor(state, t, left);
    const folderKey = Object.hasOwn(FOLDER_TEXT, folderError) ? FOLDER_TEXT[folderError] : "ready.folderFailed";

    submitBtn.hidden = offline || again;
    siteBtn.hidden = offline || !again;
    retryBtn.hidden = !offline;
    folderRow.hidden = !installDir;
    pathEl.textContent = shortenPath(installDir);
    pathEl.setAttribute("title", String(installDir));
    freeEl.textContent = Number.isFinite(free) ? t("welcome.free", { size: formatBytes(free, { t, locale }) }) : "";
    hint.setAttribute("data-tone", note?.tone ?? "");
    hint.replaceChildren(...(note ? [icon(note.tone === "error" ? "alert" : note.tone), h("span", null, note.text)] : []));
    folderNote.replaceChildren(...(folderError ? [callout({ tone: "danger", text: t(folderKey) })] : []));
    // Сервер не принимает установки или нет связи: кнопка становится «Повторить».
    const retry = RETRY_CODES.has(fieldError?.code);
    setButton(submitBtn, { label: t(busy ? "open.welcome.submitting" : retry ? "common.retry" : "welcome.submit"), disabled: left > 0 || busy, busy });
    if (changeBtn) setButton(changeBtn, { disabled: choosingDir === true || busy });
    if (left > 0) timer = window.setInterval(tick, 500);
  }

  // Отсчёт «подождите N с» после RATE_LIMITED: пока срок не вышел, перерисовываем; вышел — снимаем ошибку.
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
      (offline ? retryBtn : needsNewInstaller(state) ? siteBtn : submitBtn).focus();
    },
    update(next) {
      state = next;
      render();
    },
  };

}
