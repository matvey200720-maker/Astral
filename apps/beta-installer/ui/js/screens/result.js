// Итоговые экраны установщика: «Astral удалён», страница ошибки и «Astral установлен».
import { h } from "../dom.js";
import { doneWarningKeys, formatBytes, productName, shortenPath } from "../format.js";
import { errorKeys } from "../errors.js";
import { button, callout, kv, nextSteps, screen, stepper } from "../parts.js";

const DASH = "—";
// Подпись кнопки «Показать детали» / «Скрыть детали» по состоянию (закрыто, открыто).
const FACES = ["common.showDetails", "common.hideDetails"];
// Кнопки по имени действия окна: [ключ подписи, значок слева]. «Открыть сайт» и
// «Выбрать папку» берут подписи из чужих групп словаря (welcome.*, error.FOLDER_BUSY.*).
const LOOKS = {
  quit: ["common.close", null],
  openLogs: ["common.openLogs", "log"],
  enterCode: ["side.enterCode", "refresh"],
  pickFolder: ["error.FOLDER_BUSY.action", "folder"],
  openSite: ["welcome.openSite", "external"],
  restart: ["error.restart", "refresh"],
  retry: ["common.retry", "refresh"],
  launch: ["done.launch", "play"],
};
// presented.primary → действие окна, которое делает главная кнопка страницы ошибки.
const MAIN_OF = { retry: "retry", restart: "restart", openSite: "openSite", pickFolder: "pickFolder", close: "quit" };

// Узел по описанию [«тег.класс#id», свойства?, ...дети]; дети — узлы, строки или такие же описания.
const node = (spec) => {
  if (!Array.isArray(spec)) return spec;
  const [selector, ...kids] = spec;
  const [tag, ...marks] = selector.split(/(?=[.#])/);
  const props = kids[0]?.constructor === Object ? kids.shift() : {};
  const named = (sign) => marks.filter((m) => m[0] === sign).map((m) => m.slice(1));
  const [cls, [id]] = [named(".").join(" "), named("#")];
  return h(tag, { ...(cls && { class: cls }), ...(id && { id }), ...props }, ...kids.map(node));
};

// Кнопка действия `name`: главная (primary, на всю ширину) или второстепенная (ghost).
const press = (ctx, name, variant, args = []) => {
  const [key, iconName] = LOOKS[name];
  return button({ label: ctx.t(key), variant, iconName, block: variant === "primary", onClick: () => ctx.actions[name](...args) });
};

export function mountUninstallDone(ctx) {
  const {
    t,
    state: { uninstall },
  } = ctx;
  const verdict = uninstall.removedUserData ? "uninstall.doneData" : "uninstall.doneKept";
  return {
    el: screen("uninstall-done", {
      foot: [press(ctx, "quit", "primary")],
      text: [t("uninstall.doneText"), t(verdict)].join(" "),
      title: t("uninstall.doneTitle", { name: productName(uninstall.channel) }),
    }),
  };
}

export function mountError(ctx) {
  const { locale, state, t } = ctx;
  const { httpStatus, presented, rawCode } = state.error;
  const { text: textKey, title: titleKey } = errorKeys({ code: presented.code, field: false });

  const sizeOf = (field) => {
    const known = state.confirmed?.[field] ?? state.init?.[field];
    return Number.isFinite(known) ? formatBytes(known, { t, locale }) : DASH;
  };
  const subs = {
    free: sizeOf("freeBytes"),
    name: productName(state.selected || state.confirmed?.channel),
    need: sizeOf("requiredBytes"),
    path: state.init?.installDir ?? "",
    seconds: presented.retryAfterSec ?? "",
  };

  // Код для поддержки стоит на виду карточкой; детали (HTTP и сообщение хоста) открыты сразу, пока есть что показать:
  // место под ними не пустует (16.11.2026), а на снимке ошибки видно всё, что нужно поддержке.
  const detailLines = [httpStatus ? `HTTP ${httpStatus}` : "", presented.detail].filter(Boolean);
  const installDir = state.init?.installDir;
  const supportCard = kv([
    { label: t("error.supportCode"), value: node(["b.error-code-value", rawCode || presented.code]) },
    state.init?.version ? { label: t("error.factInstaller"), value: state.init.version } : null,
    installDir ? { label: t("ready.folder"), value: node(["span.path.selectable", { title: installDir }, shortenPath(installDir)]) } : null,
  ]);
  const supportNote = node(["p.error-support", t("error.support")]);
  const pre = node(["pre.details", { hidden: detailLines.length === 0 }, detailLines.join("\n")]);
  const toggle = h("button", { type: "button", class: "link", "aria-expanded": "true", hidden: detailLines.length === 0 }, t(FACES[1]));
  let expanded = true;
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    pre.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = t(FACES[expanded ? 1 : 0]);
  });

  const viaLauncher = presented.stage === "side" && Boolean(state.side?.viaLauncher);
  const mainButton = viaLauncher
    ? press(ctx, "enterCode", "primary")
    : press(ctx, MAIN_OF[presented.primary], "primary");
  const wantsQuit = viaLauncher || presented.primary !== "close";
  const sideButtons = [
    presented.logs && press(ctx, "openLogs", "ghost"),
    wantsQuit && press(ctx, "quit", "ghost"),
  ].filter(Boolean);

  return {
    el: screen("error", {
      body: [node(["div.body-center", supportCard, supportNote, node(["div", toggle]), pre])],
      extra: { "data-code": presented.code },
      foot: [mainButton, sideButtons.length > 0 ? node(["div.screen-foot-row", ...sideButtons]) : null],
      text: t(textKey, subs),
      title: t(titleKey, subs),
    }),
  };
}

export function mountDone(ctx) {
  const {
    t,
    state: { done, confirmed },
  } = ctx;
  const serial = confirmed?.serial ? node(["div.serial", ["span", t("done.serial")], ["b", confirmed.serial]]) : null;
  const notes = doneWarningKeys(done?.warnings).map((key) => callout({ tone: "warning", text: t(key) }));
  const closing = node(["div.screen-foot-row", ["span"], press(ctx, "quit", "ghost")]);
  return {
    el: screen("done", {
      // Сторож лесенки «Готово»: tests/installer-ui-motion.test.js ищет эту строку в исходнике (14.10.2026).
      extra: { "data-arrive": "true" },
      foot: [press(ctx, "launch", "primary", [done?.channel]), closing],
      body: [serial, ...notes, nextSteps(t, "next.doneTitle")],
      text: t("done.text", { version: done?.version ?? confirmed?.version ?? "" }),
      title: t("done.title"),
      lead: stepper(t, 4),
    }),
  };
}
