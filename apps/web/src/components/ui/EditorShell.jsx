// Каркас комнаты редактора: шапка, сцена, колонки, панель инструмента, строки кадра, проход.
// Разметка собрана вызовами node(тег, свойства, ...дети); порядок свойств — часть контракта.
import useHolds from "./useHolds.js";
import useEditorRoom from "./useEditorRoom.js";
import useEditorFitHost from "./useEditorFitHost.js";
import useScrollEdges from "./useScrollEdges.js";
import * as roomGate from "./screen-ready.js";
import * as frameGate from "./stage-busy.js";
import { tr, useTr } from "../../locales/ui.js";
import { default as Button } from "./Button.jsx";
import { CaretLeft, Question } from "./icons.jsx";
import { default as EditorToolRail } from "./EditorToolRail.jsx";
import { default as ScrollRail } from "./ScrollRail.jsx";
import { default as SegmentedControl } from "./SegmentedControl.jsx";
import { default as EditorTour } from "./EditorTour.jsx";
import { EditorVeil } from "./EditorSkeleton.jsx";
import { toolsOfScene } from "./editor-scene.js";
import { buildTourSteps } from "./editor-tour-steps.js";
import { EDITOR_TOURS } from "./editor-tours.js";
import { editorRoomStanding } from "./editor-arrival.js";
import { setToolNamesHidden, useNarrowWindow, useToolNamesHidden } from "./editor-tool-names.js";
import { EditionNoticeContext } from "./edition-notice.js";
import { EditorBackContext } from "./editor-back-context.js";
import { EditorNotesContext } from "./editor-notes.js";
import { PanelHelpContext } from "./panel-help.js";
import { PanelPageContext } from "./panel-page-context.js";
import {
  Suspense,
  createElement,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Карточка инструмента едет отдельным куском: лист tool-demo не должен попасть в стартовый бандл.
const ToolCard = lazy(() => import("./tool-demo/ToolCard.jsx"));

/* ------------------------------ таблицы ------------------------------ */

// Умолчания применяются только к «не задано»: null и пустая строка остаются как пришли.
const PROP_DEFAULTS = {
  className: "",
  headerClassName: "",
  copyClassName: "",
  actionsClassName: "",
  bodyClassName: "",
  canvasClassName: "",
  inspectorClassName: "",
  onBack: null,
  backLabel: "Назад",
  kicker: null,
  status: null,
  tabs: null,
  actions: null,
  rail: null,
  inspector: null,
  fit: "page",
  tools: null,
  tool: null,
  onTool: null,
  toolShortcuts: true,
  toolNames: true,
  scene: null,
  toolCards: true,
  toolCardShape: null,
  guide: null,
  guideKey: "",
  tour: null,
  board: false,
  bar: null,
  dock: null,
  panelHead: null,
  hint: null,
};

const HINT_MS = 3200;
const PLATE_RANGE = [3, 12];

const NO_IDS = [];
const NO_TOOLS = [];
const NO_HELP = new Map();
const FRESH_STRIP = { node: null, open: false, quiet: false };
const FRESH_GUIDE = { replays: 0, closedAt: 0, skipped: false };

const HOSTS = {
  app: [".desktop-app"],
  content: [".desktop-content"],
  sheet: [".workshop-studio"],
  parent: [":parent"],
};

const QUIET_NOTE = ".ui-editor-note:not(.is-warning)";
const NOTE_WATCH = { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] };

const CONTROLS = "a, button, input, select, textarea";
const CLIP_CELL = ".fx-switch small";
const HINT_TAILS = ["-hint", "-note"];
const ECHO_ATTR = "data-page-echo";
const ECHO_TAGS = ["h3", "h4"];
const ECHO_SKIP = ".fx-section-head, header";

const bareTitles = new Set();
const renamedTitles = new Set();

const HELP_OPS = {
  register: (map, id, lines) => new Map(map).set(id, lines),
  unregister: (map, id) => {
    if (!map.has(id)) return map;
    const rest = new Map(map);
    rest.delete(id);
    return rest;
  },
};

/* ------------------------------ мелкие помощники ------------------------------ */

const cls = (...parts) => parts.filter(Boolean).join(" ");

// Слоты kicker, status, guideKey и inspector отдают ложное значение как есть: 0 рисуется нулём.
const gate = (value, make) => value && make(value);
const maybe = (value, make) => (value ? make(value) : null);

const clampPlates = (count) => Math.max(PLATE_RANGE[0], Math.min(PLATE_RANGE[1], count));
const standingMark = () => (editorRoomStanding() ? "warm" : undefined);

function withDefaults(given) {
  const merged = { title: given.title, children: given.children };
  for (const [name, fallback] of Object.entries(PROP_DEFAULTS)) {
    merged[name] = given[name] === undefined ? fallback : given[name];
  }
  return merged;
}

const layoutOf = (tools, board) =>
  Array.isArray(tools) && tools.length > 0 ? "studio" : board ? "board" : "page";

const isTemplates = (item) => item.id === "templates";
const laneOf = (item) => {
  if (isTemplates(item)) return "templates";
  return item.pinned === "end" ? "pinned" : "plain";
};
const regroup = (item) => ({ ...item, group: "templates-last" });

// «Шаблоны» уходят после обычных и перед прижатыми к низу, в свою группу.
function templatesLast(list) {
  if (!list.some(isTemplates)) return list;
  const lanes = { plain: [], templates: [], pinned: [] };
  list.forEach((item) => lanes[laneOf(item)].push(item));
  return [...lanes.plain, ...lanes.templates.map(regroup), ...lanes.pinned];
}

// Шапку панели называют по очереди: panelHead, открытая страница, взятый инструмент.
function panelHeadFor(...sources) {
  const source = sources.find(Boolean);
  if (!source) return null;
  const { label, note, back, actions } = source;
  return { label, note, back, actions };
}

function ownStepsFor(source, railTools, guide) {
  const usable = new Set(railTools.filter((item) => !item.disabled).map((item) => item.id));
  return source.flatMap((step) => {
    if (step.tool && !usable.has(step.tool)) return [];
    const needsKeys = step.target === "canvas" && !step.keys;
    return [needsKeys ? { ...step, keys: guide || [] } : step];
  });
}

function tourStepsFor(view) {
  const own = Array.isArray(view.tour) ? view.tour : EDITOR_TOURS[view.guideKey];
  if (own) return ownStepsFor(own, view.railTools, view.guide);
  const { layout } = view;
  return buildTourSteps(
    Object.fromEntries([
      ["tabs", Boolean(view.tabs)],
      ["tools", layout === "studio"],
      ["rail", layout === "page" && Boolean(view.rail)],
      ["inspector", layout !== "board" && (layout === "studio" || Boolean(view.inspector))],
      ["actions", Boolean(view.actions)],
      ["guide", view.guide || []],
      ["tool", view.activeTool],
      ["hint", layout === "board" ? view.hint : null],
    ]),
  );
}

const rootAttributes = (view) =>
  Object.fromEntries([
    ["className", cls("ui-editor-shell", view.className)],
    ["data-stage-busy", view.busy ? "true" : undefined],
    ["data-fit", view.fitValue],
    ["data-layout", view.layout === "page" ? undefined : view.layout],
    ["data-bar", view.bar || undefined],
    ["data-tools", view.toolsMode],
    ["data-arrival", view.arrival],
    ["data-screen-room", ""],
  ]);

const isHintClass = (name) =>
  name === "fx-hint" || HINT_TAILS.some((tail) => name.endsWith(tail) || name.includes(`${tail} `));

const controlInside = (target, para) => {
  const control = target.closest(CONTROLS);
  return Boolean(control) && para.contains(control);
};

// Щелчок по пояснению в панели студии раскрывает его; ссылки и поля внутри не трогают.
function revealHint(event) {
  const { target } = event;
  const para = target.closest ? target.closest("p") : null;
  const opens = para && isHintClass(para.className) && !controlInside(target, para);
  if (opens) para.classList.toggle("is-open");
}

// Подпись выключателя появляется, только когда строка не поместилась.
function titleWhenClipped(event) {
  const cell = event.target;
  if (!cell.matches?.(CLIP_CELL)) return;
  const clipped = cell.scrollWidth > cell.clientWidth;
  cell.title = clipped ? cell.textContent : "";
}

const hasEcho = (head) => head.hasAttribute(ECHO_ATTR);
const dropEcho = (head) => head.removeAttribute(ECHO_ATTR);
const putEcho = (head) => head.setAttribute(ECHO_ATTR, "");
const repeatsTitle = (head, title) =>
  !head.parentElement?.matches(ECHO_SKIP) && head.textContent.trim() === title;

// Заголовки панели, повторяющие название открытой страницы, получают метку; ответ — «метили ли».
function paintEcho(root, pageTitle) {
  const content = root.querySelector(".ui-editor-panel-content");
  if (!content) return false;
  const heads = [];
  for (const tag of ECHO_TAGS) heads.push(...content.querySelectorAll(tag));
  heads.filter(hasEcho).forEach(dropEcho);
  const hits = pageTitle ? heads.filter((head) => repeatsTitle(head, pageTitle)) : [];
  hits.forEach(putEcho);
  return hits.length > 0;
}

const afterDelay = (ms, job) => {
  const timer = setTimeout(job, ms);
  return () => clearTimeout(timer);
};

// Кадр откладывается один раз: пока ждёт, повторные просьбы сводятся в него; без rAF — сразу.
function deferOnce(slot, job) {
  if (slot.current !== null) return;
  if (typeof requestAnimationFrame !== "function") {
    job();
    return;
  }
  slot.current = requestAnimationFrame(() => {
    slot.current = null;
    job();
  });
}

const claimRoom = (root, room) => {
  roomGate.adoptRoom(root, room);
  return () => roomGate.releaseRoom(root);
};

const hasQuiet = (listNode) => listNode.querySelector(QUIET_NOTE) !== null;

function watchQuiet(listNode, report) {
  report(hasQuiet(listNode));
  const watcher = new MutationObserver(() => report(hasQuiet(listNode)));
  watcher.observe(listNode, NOTE_WATCH);
  return watcher.disconnect.bind(watcher);
}

const announce = (seen, key, text) => {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(text);
};

const bareMessage = (name) =>
  [
    `EditorShell: «${name}» открывается без kicker.`,
    "Раздел над названием отвечает на «где я»,",
    "когда редактор занял весь экран:",
    'kicker="Мастерская".',
  ].join(" ");

const renamedMessage = (first, next) =>
  [
    `EditorShell: заголовок «${first}» сменился на «${next}».`,
    "В title лежит постоянное название редактора, а не имя проекта:",
    "имя проекта — это status или поле в инспекторе.",
  ].join(" ");

/* ------------------------------ хуки каркаса ------------------------------ */

// Какие кадры ещё грузятся: список id и производное «грузится».
function useStageLoad() {
  const [ids, setIds] = useState(NO_IDS);
  const report = useCallback((id, busy) => {
    const wanted = busy !== false;
    setIds((current) => {
      if (wanted === current.includes(id)) return current;
      return wanted ? current.concat([id]) : current.filter((one) => one !== id);
    });
  }, []);
  return [ids.length > 0, report];
}

// Метки на странице вокруг комнаты и на <html>; порядок вызовов задаёт порядок записей.
function useRoomMarks(rootRef, { layout, fitValue, className, arrival }) {
  const room = useState(roomGate.createRoomHolds)[0];
  useEditorFitHost(rootRef, fitValue);
  const flush = layout === "studio";
  useEditorRoom();
  useHolds(rootRef, "editor-layout", HOSTS.app, layout !== "page", ".desktop-content");
  useHolds(rootRef, "editor-flush", HOSTS.content, flush);
  useHolds(rootRef, className, HOSTS.sheet);
  useHolds(rootRef, arrival ? "warm-editor" : "", HOSTS.parent);
  useLayoutEffect(() => claimRoom(rootRef.current, room), [rootRef, room]);
  return room;
}

// Слова разделов панели: id раздела -> абзацы; место раздела — по первой записи.
function usePanelWords() {
  const [byId, setById] = useState(NO_HELP);
  const api = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(HELP_OPS).map(([name, op]) => [
          name,
          (id, lines) => setById((map) => op(map, id, lines)),
        ]),
      ),
    [],
  );
  const words = useMemo(() => [...byId.values()].flat(), [byId]);
  return { api, words };
}

// Строки кадра: узел списка, открыта ли полоса, есть ли тихие строки — одним состоянием.
function useNoteStrip() {
  const [strip, setStrip] = useState(FRESH_STRIP);
  const edit = useCallback((field, compute) => {
    setStrip((cur) => {
      const next = compute(cur[field]);
      return next === cur[field] ? cur : { ...cur, [field]: next };
    });
  }, []);
  const attach = useCallback((listNode) => edit("node", () => listNode), [edit]);
  const flip = useCallback(() => edit("open", (was) => !was), [edit]);
  const listNode = strip.node;

  useEffect(
    () => (listNode ? watchQuiet(listNode, (flag) => edit("quiet", () => flag)) : undefined),
    [listNode, edit],
  );

  return { node: listNode, attach, flip, open: strip.open, quiet: strip.quiet };
}

// Повтор прохода, подпись у «?» после закрытия и инструмент «в руке» на время шага.
function useGuideState(tool, onTool) {
  const [state, setState] = useState(FRESH_GUIDE);
  const loan = useRef(null);
  const { closedAt } = state;

  const clearStamp = useCallback(() => setState((s) => ({ ...s, closedAt: 0 })), []);
  useEffect(() => (closedAt ? afterDelay(HINT_MS, clearStamp) : undefined), [closedAt, clearStamp]);

  const onReplay = useCallback(() => setState((s) => ({ ...s, replays: s.replays + 1 })), []);
  const onDismissed = useCallback((reason) => {
    const skipped = reason === "skip";
    const stamp = Date.now();
    setState((s) => {
      const same = s.closedAt === stamp && s.skipped === skipped;
      return same ? s : { ...s, closedAt: stamp, skipped };
    });
  }, []);

  const lend = {
    take(step) {
      if (!step.tool) return;
      loan.current ??= tool;
      onTool(step.tool);
    },
    giveBack() {
      const prior = loan.current;
      if (prior === null) return;
      loan.current = null;
      onTool(prior);
    },
  };
  const onStep = (step) => {
    if (!onTool) return;
    const action = step ? lend.take : lend.giveBack;
    action(step);
  };

  return { ...state, onReplay, onDismissed, onStep };
}

function useFrameSlot() {
  const slot = useRef(null);
  useEffect(
    () => () => {
      if (slot.current !== null) cancelAnimationFrame(slot.current);
    },
    [],
  );
  return slot;
}

function useInertWhile(ref, flag) {
  useEffect(() => {
    const target = ref.current;
    const release = () => {
      if (target) target.inert = false;
    };
    if (target) target.inert = flag;
    return release;
  }, [ref, flag]);
}

// Всё, что каркас делает с панелью после отрисовки: сброс прокрутки, inert, повтор названия.
function usePaneUpkeep({ shellRef, paneRef, studio, tool, pageTitle, stageBusy }) {
  const slot = useFrameSlot();
  const baseline = useRef({ tool, page: pageTitle });
  const painted = useRef(false);

  const rewind = useCallback(() => {
    deferOnce(slot, () => {
      if (paneRef.current) paneRef.current.scrollTop = 0;
    });
  }, [slot, paneRef]);

  useEffect(() => {
    const was = baseline.current;
    const toolMoved = studio && was.tool !== tool;
    const pageMoved = was.page !== pageTitle;
    Object.assign(was, toolMoved ? { tool } : null, pageMoved ? { page: pageTitle } : null);
    if (toolMoved || pageMoved) rewind();
  }, [studio, tool, pageTitle, rewind]);

  useInertWhile(paneRef, stageBusy);

  useEffect(() => {
    if (pageTitle || painted.current) painted.current = paintEcho(shellRef.current, pageTitle);
  });
}

// Подсказки разработчику: по одной на название за жизнь модуля.
function useDevNotes({ title, kicker, layout, bar }) {
  const firstTitle = useState(title)[0];
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (layout === "page" && !kicker && !bar) announce(bareTitles, `${title}`, bareMessage(title));
    if (title !== firstTitle) {
      announce(renamedTitles, `${firstTitle}`, renamedMessage(firstTitle, title));
    }
  }, [title, firstTitle, kicker, layout, bar]);
}

/* ------------------------------ шапка ------------------------------ */

const backButton = (handler, text) =>
  createElement(Button, {
    size: "sm",
    variant: "ghost",
    onClick: handler,
    icon: createElement(CaretLeft),
    className: "ui-editor-back",
    "data-editor-back": "",
    "aria-label": text,
    title: text,
  });

const titleBlock = (className, { kicker, title, status }) =>
  createElement(
    "div",
    { className: cls("ui-editor-title", className) },
    gate(kicker, (text) => createElement("span", null, text)),
    createElement("h1", null, title),
    gate(status, (text) => createElement("small", null, text)),
  );

const editionMark = (edition) =>
  createElement(
    "span",
    {
      className: `ui-editor-edition is-${edition.tone || "info"}`,
      title: edition.detail,
      role: "note",
      "aria-label": `${edition.label}. ${edition.detail}`,
    },
    edition.label,
  );

function helpWrap({ closedAt, skipped, onReplay }) {
  const trigger = createElement(Button, {
    icon: createElement(Question),
    onClick: onReplay,
    variant: "ghost",
    size: "sm",
    className: closedAt ? "ui-editor-help is-hinting" : "ui-editor-help",
    "aria-label": tr("Показать подсказки"),
    title: tr("Подсказки: шаг за шагом"),
  });
  const caption = tr(
    skipped ? "Подсказки выключены везде · вернуть — в настройках" : "Подсказки — здесь",
  );
  const hint = closedAt
    ? createElement("span", { className: "ui-editor-help-hint", role: "status", key: closedAt }, caption)
    : null;
  return createElement("span", { className: "ui-editor-help-wrap" }, trigger, hint);
}

function viewsRail(tabs, scene) {
  const switcher = maybe(scene, (one) =>
    createElement(SegmentedControl, {
      options: one.options,
      value: one.value,
      onChange: one.onChange,
      label: one.label || tr("Сцена"),
      indicator: true,
      size: "sm",
      className: cls("ui-editor-scene", one.className),
    }),
  );
  return createElement(
    ScrollRail,
    {
      label: tr("Виды редактора"),
      gutters: true,
      className: "ui-editor-tabs",
      nextLabel: tr("Показать виды справа"),
      previousLabel: tr("Показать виды слева"),
    },
    tabs,
    switcher,
  );
}

function topBar(v) {
  const slots = [
    maybe(v.onBack, (handler) => backButton(handler, v.backText)),
    titleBlock(v.copyClassName, v),
    maybe(v.edition, editionMark),
    gate(v.guideKey, () => helpWrap(v.guideState)),
    v.tabs || v.scene ? viewsRail(v.tabs, v.scene) : null,
    maybe(v.actions, (content) =>
      createElement("div", { className: cls("ui-editor-actions", v.actionsClassName) }, content),
    ),
  ];
  return createElement("header", { className: cls("ui-editor-topbar", v.headerClassName) }, ...slots);
}

/* ------------------------------ панель, заметки ------------------------------ */

function NotesToggle({ className, open, words, onToggle }) {
  useTr();
  const label = tr("Подсказка");
  return createElement(Button, {
    className,
    onClick: onToggle,
    variant: "ghost",
    size: "sm",
    icon: createElement(Question, { "aria-hidden": "true" }),
    ariaLabel: label,
    title: words.length ? words.join(" ") : label,
    "aria-expanded": open,
  });
}

const notesStrip = (notes, words, hasToggle) =>
  createElement(
    "div",
    { className: cls("ui-editor-notes", notes.open && "is-open", hasToggle && "has-toggle") },
    createElement("div", { className: "ui-editor-notes-list", ref: notes.attach }),
    hasToggle
      ? createElement(NotesToggle, {
          className: "ui-editor-notes-more",
          open: notes.open,
          words,
          onToggle: notes.flip,
        })
      : null,
  );

function panelHeading(head, notes, words) {
  const asks = notes.quiet || words.length > 0;
  const back = maybe(head.back, (arrow) =>
    createElement(Button, {
      onClick: arrow.onClick,
      ariaLabel: arrow.label,
      icon: createElement(CaretLeft),
      size: "sm",
      variant: "ghost",
      className: "ui-editor-panel-back",
    }),
  );
  const copy = createElement(
    "span",
    { className: "ui-editor-panel-copy" },
    createElement("h2", null, head.label),
    maybe(head.note, (note) => createElement("small", null, note)),
  );
  const tools =
    head.actions || asks
      ? createElement(
          "span",
          { className: "ui-editor-panel-actions" },
          head.actions,
          asks
            ? createElement(NotesToggle, {
                className: "ui-editor-panel-notes",
                open: notes.open,
                words,
                onToggle: notes.flip,
              })
            : null,
        )
      : null;
  return createElement("header", { className: "ui-editor-panel-head" }, back, copy, tools);
}

const helpBlock = (words) =>
  createElement(
    "div",
    { className: "fx-hint section-help-text ui-editor-panel-help", role: "note" },
    words.map((word) => createElement("p", { key: word }, word)),
  );

function panelContent(v) {
  const card = v.showCard
    ? createElement(
        Suspense,
        { fallback: null },
        createElement(ToolCard, {
          tool: v.activeTool,
          editorKey: v.guideKey,
          scene: v.sceneValue || "",
          shape: v.toolCardShape,
        }),
      )
    : null;
  const slotted = createElement(
    PanelPageContext.Provider,
    { value: v.setPageHead },
    createElement(PanelHelpContext.Provider, { value: v.head ? v.helpApi : null }, v.inspector),
  );
  const frame = { className: "ui-editor-panel-content", key: v.tool || "panel" };
  return createElement("div", frame, card, slotted);
}

/* ------------------------------ тела трёх раскладок ------------------------------ */

const bodyBox = (v, extra, ...kids) =>
  createElement("div", { className: cls("ui-editor-body", v.bodyClassName), ...extra }, ...kids);
const canvasBox = (v, ...kids) =>
  createElement("main", { className: cls("ui-editor-canvas", v.canvasClassName) }, ...kids);
const inspectorClass = (v) => cls("ui-editor-inspector", v.inspectorClassName);

function studioBody(v) {
  const named = v.head !== null;
  const rail = createElement(EditorToolRail, {
    value: v.tool,
    tools: v.railTools,
    names: v.showNames,
    onNamesHidden: v.onNamesHidden,
    shortcuts: v.toolShortcuts,
    onChange: v.onTool,
  });
  const panel = createElement(
    "div",
    {
      "data-scroll": v.paneEdges,
      className: "ui-editor-panel",
      ref: v.paneRef,
      onClick: revealHint,
      onPointerOver: titleWhenClipped,
    },
    panelContent(v),
  );
  return bodyBox(
    v,
    null,
    rail,
    canvasBox(v, v.children),
    createElement(
      "aside",
      { className: inspectorClass(v) },
      named ? panelHeading(v.head, v.notes, v.words) : null,
      named && v.notes.open && v.words.length > 0 ? helpBlock(v.words) : null,
      panel,
      notesStrip(v.notes, v.words, !named),
      maybe(v.dock, (dock) => createElement("div", { className: "ui-editor-dock" }, dock)),
    ),
  );
}

const boardBody = (v) =>
  bodyBox(
    v,
    null,
    canvasBox(
      v,
      createElement("div", { className: "ui-editor-board" }, v.children),
      notesStrip(v.notes, v.words, true),
    ),
  );

function pageBody(v) {
  const railColumn = maybe(v.rail, (content) => {
    const attrs = { className: "ui-editor-rail", "data-scroll": v.railEdges, ref: v.railRef };
    return createElement("aside", attrs, content);
  });
  const sideColumn = gate(v.inspector, (content) =>
    createElement(
      "aside",
      { "data-scroll": v.paneEdges, className: inspectorClass(v), ref: v.paneRef },
      content,
      notesStrip(v.notes, v.words, true),
    ),
  );
  const marks = { "data-rail": v.rail ? "" : undefined };
  return bodyBox(v, marks, railColumn, canvasBox(v, v.children), sideColumn);
}

const BODIES = { studio: studioBody, board: boardBody, page: pageBody };

/* ------------------------------ каркас ------------------------------ */

const toolById = (tools, id) => {
  for (const entry of tools) {
    if (entry.id === id) return entry;
  }
  return null;
};

const pageTitleOf = (head) => {
  const label = head?.label;
  return typeof label === "string" ? label.trim() : "";
};

const railToolsOf = (layout, tools, sceneValue) =>
  layout === "studio" ? templatesLast(toolsOfScene(tools, sceneValue)) : NO_TOOLS;

// Всё состояние и побочные действия каркаса: наружу — готовая «модель» для сборки разметки.
function useShellModel(p) {
  const shellRef = useRef(null);
  const ambient = {
    edition: useContext(EditionNoticeContext),
    backTo: useContext(EditorBackContext),
  };

  const layout = layoutOf(p.tools, p.board);
  const studio = layout === "studio";
  const sceneValue = p.scene?.value;
  const fitValue = layout === "page" ? p.fit : "window";

  const arrival = useState(standingMark)[0];
  const [pageHead, setPageHead] = useState(null);
  const [busy, reportBusy] = useStageLoad();
  const notes = useNoteStrip();
  const help = usePanelWords();
  const guideState = useGuideState(p.tool, p.onTool);
  const names = { chosenIcons: useToolNamesHidden(), narrow: useNarrowWindow() };

  const railTools = useMemo(
    () => railToolsOf(layout, p.tools, sceneValue),
    [layout, p.tools, sceneValue],
  );

  const room = useRoomMarks(shellRef, { layout, fitValue, className: p.className, arrival });
  const [[railRef, railEdges], [paneRef, paneEdges]] = [useScrollEdges(), useScrollEdges()];

  const activeTool = studio ? toolById(p.tools, p.tool) : null;
  const pageTitle = pageTitleOf(pageHead);
  usePaneUpkeep({ shellRef, paneRef, studio, tool: p.tool, pageTitle, stageBusy: busy });
  useDevNotes({ title: p.title, kicker: p.kicker, layout, bar: p.bar });

  const showNames = Boolean(p.toolNames) && !names.chosenIcons && !names.narrow;
  const view = {
    ...p,
    layout,
    fitValue,
    arrival,
    busy,
    notes,
    railTools,
    showNames,
    sceneValue,
    activeTool,
    railRef,
    railEdges,
    paneRef,
    paneEdges,
    setPageHead,
    guideState,
    edition: ambient.edition,
    head: studio ? panelHeadFor(p.panelHead, pageHead, activeTool) : null,
    words: help.words,
    helpApi: help.api,
    backText: ambient.backTo || tr(p.backLabel),
    toolsMode: studio && p.toolNames ? (showNames ? "names" : "icons") : undefined,
    onNamesHidden: p.toolNames && !names.narrow ? setToolNamesHidden : null,
    showCard: Boolean(p.toolCards && activeTool && !pageHead && !p.panelHead?.back),
  };
  return { view, room, shellRef, reportBusy };
}

function tourLayer(view, shellRef) {
  const { guideState } = view;
  return gate(view.guideKey, () =>
    createElement(EditorTour, {
      onStep: guideState.onStep,
      onDismissed: guideState.onDismissed,
      replayToken: guideState.replays,
      paused: view.busy,
      tool: view.activeTool,
      tourKey: view.guideKey,
      rootRef: shellRef,
      steps: tourStepsFor(view),
    }),
  );
}

const veilOf = (view) =>
  createElement(EditorVeil, {
    title: typeof view.title === "string" ? view.title : "",
    tools: view.layout === "studio" ? clampPlates(view.railTools.length) : undefined,
  });

export default function EditorShell(given) {
  useTr();
  const { view, room, shellRef, reportBusy } = useShellModel(withDefaults(given));
  const section = createElement(
    "section",
    { ref: shellRef, ...rootAttributes(view) },
    topBar(view),
    BODIES[view.layout](view),
    tourLayer(view, shellRef),
    veilOf(view),
  );
  const providers = [
    [frameGate.FrameHoldContext, room.hold],
    [frameGate.StageBusyContext, reportBusy],
    [EditorNotesContext, view.notes.node],
  ];
  return providers.reduceRight(
    (inner, [context, value]) => createElement(context.Provider, { value }, inner),
    section,
  );
}
