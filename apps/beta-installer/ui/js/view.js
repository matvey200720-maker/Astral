import { neededWindowHeight } from "./window-fit.js";
import { mountExisting, mountWelcome } from "./screens/welcome.js";
import { mountWelcomeOpen } from "./screens/welcome-open.js";
import { mountUninstall } from "./screens/uninstall.js";
import { mountSide } from "./screens/side.js";
import { mountDone, mountError, mountUninstallDone } from "./screens/result.js";
import { mountDownload, mountInstall, mountUninstallProgress, mountUpdate } from "./screens/progress.js";
import { renderDialog } from "./screens/dialogs.js";
import { mountConfirm, mountReady } from "./screens/confirm.js";
import { mountBranch } from "./screens/branch.js";
import { heroModel } from "./hero.js";
import { createOrbit } from "./orbit.js";
import { clear, h, icon, svgNode } from "./dom.js";
import { LANGUAGES, createTranslator, localeOf } from "./i18n/index.js";

// Холст рассчитан на 960×600; окно меньше уменьшается целиком (хост на маленьком мониторе
// сжимает окно, BRIDGE.md §6), больше — растягивается, но не выше четырёх раз.
export const [DESIGN_WIDTH, DESIGN_HEIGHT] = [960, 600];

export const fitScale = (width, height) => {
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return scale > 0 && scale < Infinity ? Math.min(scale, 4) : 1;
};

// Обычный объект (из пар), не Map: имена из прототипа («constructor») считаются найденными монтировщиками
// (старое поведение, из боевых состояний не достижимо).
const SCREEN_MOUNTERS = Object.fromEntries([
  ["branch", mountBranch],
  ["confirm", mountConfirm],
  ["done", mountDone],
  ["download", mountDownload],
  ["error", mountError],
  ["existing", mountExisting],
  ["install", mountInstall],
  ["ready", mountReady],
  ["side", mountSide],
  ["uninstall", mountUninstall],
  ["uninstall-done", mountUninstallDone],
  ["uninstall-progress", mountUninstallProgress],
  ["update", mountUpdate],
  // Открытый режим (init().open): вместо ввода кода — «Продолжить» (screens/welcome-open.js).
  ["welcome", (ctx) => (ctx.state.init?.open === true || ctx.state.init?.access === "unreachable" ? mountWelcomeOpen(ctx) : mountWelcome(ctx))],
]);

// Открытый режим: слова `open.<ключ>` важнее одноимённых обычных — в них нет ввода кода и «беты».
// Нет слова `open.<ключ>` — обычное; ключ без слов остаётся ключом, как в createTranslator.
export const withOpenWords = (t, open) => {
  if (!open) return t;
  return (key, params) => {
    const asked = `open.${key}`;
    const found = t(asked, params);
    return found === asked ? t(key, params) : found;
  };
};

const SLOTS = "#top #hero-title #hero-sub #hero-foot #orbit-slot #panel #dialogs #lang-button #lang-code #lang-menu-slot #hero-note #brand-chip #cap-badge #cap-name".split(" ");

// Чип ветки в шапке (макет обновления 16.11.2026: «Alpha»): ветка, которую обновляют или ставят; пока неизвестна — Beta.
const CHANNELS = new Set(["alpha", "beta", "release"]);
const channelOf = (state) => {
  const pick = [state.update?.channel, state.side?.channel, state.selected, state.confirmed?.channel, state.init?.channel, state.init?.hintChannel]
    .map((value) => String(value ?? "").toLowerCase())
    .find((value) => CHANNELS.has(value));
  // Открытый режим: человеку без ветки (она «release», обычная) чип не нужен; команде с alpha он виден.
  if (state.init?.open === true && (!pick || pick === "release")) return "";
  return pick ? pick.charAt(0).toUpperCase() + pick.slice(1) : "Beta";
};

// Глифы заголовка Windows 11 из системного шрифта (504694f65) и те же линии SVG 10×10 —
// они остаются, пока шрифт не загрузился или его нет. Знаки собираются из кодов:
// в исходнике знаки частной области Unicode не пишем.
const CAPTION = [
  ["minimize", "windowMinimize", "window.minimize", 0xe921, "M0 5.5H10", "crispEdges"],
  ["close", "windowClose", "window.close", 0xe8bb, "M0.5 0.5 9.5 9.5M9.5 0.5 0.5 9.5", "geometricPrecision"],
];

const SWAPPING = "is-swapping";
const ARRIVING = "is-arriving";

// Запоминает последний ключ; true, когда пришёл другой (первое значение — «начальное»).
const watchKey = (last) => (key) => {
  const fresh = key !== last;
  last = key;
  return fresh;
};

// Подпись заменяется только при смене текста; анимацию перезапускает принудительный пересчёт раскладки.
const retitle = (node, text, mode) => {
  if (node.textContent === text) return;
  node.textContent = text;
  node.classList.remove(SWAPPING, ARRIVING);
  node.getBoundingClientRect();
  if (mode) node.classList.add(mode);
};

const captionMark = (code, d, rendering) => {
  const mark = svgNode("svg", { ["viewBox"]: "0 0 10 10", ["aria-hidden"]: "true" });
  mark.append(svgNode("path", { d, fill: "none", stroke: "currentColor", "stroke-width": 1, "shape-rendering": rendering }));
  return [h("span", { class: "win-glyph", ["aria-hidden"]: "true" }, String.fromCodePoint(code)), mark];
};

function languageMenu(state, t, actions) {
  const item = (lang) => {
    const chosen = lang.code === state.lang;
    const labels = [lang.short, lang.name].map((text, at) => h(at ? "span" : "small", {}, text));
    const props = { onClick: () => actions.setLanguage(lang.code), type: "button", class: "lang-item", ["role"]: "option", ["aria-selected"]: String(chosen) };
    return h("button", props, labels, chosen ? icon("check") : h("span"));
  };
  return h("div", { class: "lang-menu", ["role"]: "listbox", ["aria-label"]: t("lang.label") }, LANGUAGES.map(item));
}

export const createView = ({ root, store, actions }) => {
  const [topBar, titleNode, subNode, footNode, orbitSlot, panel, layer, langButton, langCode, menuSlot, noteNode, chipNode, badgeNode, frameNameNode] = Array.from(
    SLOTS,
    (selector) => root.querySelector(selector),
  );
  const captions = CAPTION.map(([act, ...spec]) => [root.querySelector(`[data-act="${act}"]`), ...spec]);

  // Левая половина: подписи ждут, пока кольцо «Готово» замкнётся.
  let heroKey = "", drawn = false, held = null, ringShut = false;
  const retitleBoth = (title, sub, mode) => [title, sub].forEach((text, at) => retitle(at ? subNode : titleNode, text, mode));

  const onClosed = (shut) => {
    ringShut = shut;
    root[shut ? "setAttribute" : "removeAttribute"]("data-ring-closed", "true");
    if (shut && held) {
      retitleBoth(held.title, held.sub, ARRIVING);
      held = null;
    }
  };
  const orbit = createOrbit({ onClosed });
  orbitSlot.appendChild(orbit.el);
  captions.forEach(([node, , , code, d, rendering]) => node.append(...captionMark(code, d, rendering)));
  langButton.append(icon("chevron"));

  const { fonts } = document;
  if (typeof FontFace === "function" && fonts) {
    const face = new FontFace(
      "Astral Caption",
      'local("Segoe Fluent Icons"), local("SegoeFluentIcons"), local("Segoe MDL2 Assets"), local("SegoeMDL2Assets")',
    );
    face.load().then(
      () => {
        fonts.add(face);
        Object.assign(root.dataset, { captionFont: "system" });
      },
      () => undefined,
    );
  }

  const [menuChanged, screenChanged, dialogChanged] = [watchKey(""), watchKey(null), watchKey("")];

  // Шапка: язык, подписи кнопок окна и меню языков. Меню собирается только когда сменился «открыто + язык»:
  // ход обновления приходит много раз в секунду, и пересобранное меню каждый раз играло бы появление (15.10).
  const syncHeader = (state, t) => {
    // `result` — итог обновления («done», «rolledback»): от него зависит, какие строки показывает экран обновления (app.css).
    Object.assign(root.dataset, { frame: state.frame, mode: state.mode, result: (state.mode === "update" && state.update?.result) || "" });
    chipNode.textContent = channelOf(state);
    langCode.textContent = LANGUAGES.find(({ code }) => code === state.lang)?.short ?? "RU";
    [[langButton, "lang.label"], ...captions.map(([node, , label]) => [node, label])].forEach(([node, key]) =>
      node.setAttribute("aria-label", t(key)),
    );
    langButton.setAttribute("aria-expanded", String(state.langOpen));
    const menuKey = state.langOpen && `open|${state.lang}`;
    if (!menuChanged(menuKey || "")) return;
    clear(menuSlot);
    if (menuKey) menuSlot.append(languageMenu(state, t, actions));
  };

  const syncHero = (state, t) => {
    const { key, ring } = heroModel(state);
    const waits = ring.kind === "done" && drawn && !ringShut && (key !== heroKey || held !== null);
    footNode.textContent = state.init?.version ? t("common.installer", { version: state.init.version }) : "";
    // Подпись кадра игры за левой половиной: честное происхождение фона, как на первом входе в приложении.
    badgeNode.textContent = t("frame.badge");
    frameNameNode.textContent = t("frame.name");
    // Справа внизу в окне обновления: Astral запустится сам (при откате человек сам нажимает «Закрыть», подсказка не нужна).
    noteNode.textContent = state.mode === "update" && ["update", "updateDone"].includes(key) ? t("update.opens") : "";
    const [title, sub] = ["title", "sub"].map((part) => t(`hero.${key}.${part}`));
    held = waits ? { title, sub } : null;
    if (!waits) retitleBoth(title, sub, drawn ? SWAPPING : null);
    heroKey = key;
    drawn = true;
    orbit.update(ring);
  };

  // Панель: экран монтируется один раз на пару «экран + язык», дальше только update.
  let mounted;
  const syncPanel = (state, t, locale) => {
    // Первый экран зависит от режима: открытый, открытый без кода, «нет связи» — каждый монтируется заново.
    const key = `${state.screen}|${state.lang}|${state.init?.open ? "o" : ""}${state.init?.openCode ? "c" : ""}${state.init?.access ?? ""}`;
    if (!screenChanged(key)) {
      mounted?.update?.(state);
      return;
    }
    const mountScreen = SCREEN_MOUNTERS[state.screen];
    mounted?.destroy?.();
    clear(panel);
    mounted = mountScreen ? mountScreen({ actions, locale, state, t }) : null;
    if (!mounted) return;
    panel.append(mounted.el);
    if (!state.dialog) mounted.focus?.();
  };

  // Окна поверх. Незнакомое окно оставляет data-open как было (старое поведение).
  const syncDialog = (state, t, locale) => {
    const { dialog, lang } = state;
    if (!dialogChanged(dialog ? `${dialog}|${lang}` : "")) return;
    clear(layer);
    const card = dialog ? renderDialog(dialog, { t, locale, actions }) : null;
    if (dialog && !card) return;
    layer.dataset.open = String(Boolean(card));
    if (card) {
      const [first] = card.querySelectorAll("button");
      layer.append(card);
      first?.focus();
    }
  };

  const pipeline = [syncHeader, syncHero, syncPanel, syncDialog];
  let queued = false;

  const render = () => {
    queued = false;
    const state = store.get();
    const translate = withOpenWords(createTranslator(state.lang), state.init?.open === true);
    const locale = localeOf(state.lang);
    document.documentElement.lang = state.lang;
    for (const step of pipeline) step(state, translate, locale);
    Object.assign(root.dataset, { screen: state.screen, ready: String(state.screen !== "boot") });
    actions.fitWindow?.(neededWindowHeight(root));
  };

  const on = (target, type, handler) => target.addEventListener(type, handler);
  captions.forEach(([node, method]) => on(node, "click", () => actions[method]()));
  // Окно безрамочное: шапка — своя зона перетаскивания, двойной щелчок ничего не разворачивает (BRIDGE.md §6).
  on(topBar, "mousedown", (event) => event.button === 0 && !event.target.closest("button, .lang-menu") && actions.windowDrag());
  on(document, "click", (event) => {
    if (!store.get().langOpen) return;
    if (!event.target.closest(".lang-menu")) actions.closeLang();
  });
  // Escape снимает одно: окно поверх главнее меню языков.
  on(document, "keydown", (event) => {
    const { dialog, langOpen } = store.get();
    const undo = dialog ? "dismissDialog" : langOpen ? "closeLang" : null;
    if (event.key === "Escape" && undo) actions[undo]();
  });
  on(langButton, "click", (event) => {
    actions.toggleLang();
    event.stopPropagation();
  });

  // Правки состояния склеиваются в одну отрисовку на микрозадаче: у скрытой панели браузера кадров
  // анимации нет, а окно обязано рисоваться верно и там.
  store.subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(render);
  });

  return { render, heroKey: () => heroKey };
};
