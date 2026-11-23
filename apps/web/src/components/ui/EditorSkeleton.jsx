import { createElement as h, memo, useEffect, useLayoutEffect as beforePaint, useRef, useState } from "react";
import { editorRoomStanding, holdEditorRoom } from "./editor-arrival.js";
import useEditorFitHost from "./useEditorFitHost.js";
import useEditorRoom from "./useEditorRoom.js";
import { useNarrowWindow, useToolNamesHidden } from "./editor-tool-names.js";
import { tr, useTr } from "../../locales/ui.js";
import useHolds from "./useHolds.js";
import { Skeleton, skeletonDelay } from "./Skeleton.jsx";

const TOOL_PLATES = 7;
const FIELD_ROWS = 5;
const WAIT_LABEL = "Загружаю редактор…";
const STEP = 60;

/*
 * Сколько каркас держит окно «как редактор» (рейка страниц убрана, `editor-layout`). Дальше рейка возвращается: загрузка, что не кончается
 * (кусок не доехал, диск занят), не должна запирать окно — у каркаса нет своей кнопки «назад», и раньше из него выходил только перезапуск
 * (15.11.2026, «Библиотека» показывала «Загружаю редактор…» и не открывалась). Приехал редактор — его оболочка забирает рейку сама.
 */
export const ROOM_PATIENCE_MS = 6000;

// Плиты по месту: общая часть каркаса и занавеса — только класс семьи плит отличается.
const plateMaker = (family) => (kind, delay = 0, own = {}) => h(Skeleton, { ...own, className: `${family}-plate is-${kind}`, delay });
const shiftBy = (base, at) => base + skeletonDelay(at, STEP);

// Ключ есть только у плит колонки инструментов (их порядковый номер) и у строк полей (тоже номер).
const toolPlates = (plate, count) => Array.from({ length: count }, (_, at) => plate("tool", shiftBy(140, at), { key: at }));
const headPlates = (plate) => [plate("heading", 280), plate("note", 340)];
const actionPlates = (plate) => [plate("icon", 90), plate("icon", 120), plate("action", 150)];
const fieldRows = (plate, tag, className) =>
  Array.from({ length: FIELD_ROWS }, (_, at) => h(tag, { key: at, className }, plate("caption", shiftBy(380, at)), plate("control", shiftBy(420, at))));

// ---------- каркас ----------

const skeletonPlate = plateMaker("ui-editor-skeleton");

function topBar(title) {
  return h(
    "header",
    { className: "ui-editor-topbar", "aria-hidden": "true" },
    skeletonPlate("back"),
    h("div", { className: "ui-editor-title" }, title ? h("h1", null, title) : skeletonPlate("title", 60)),
    h("div", { className: "ui-editor-actions" }, ...actionPlates(skeletonPlate)),
  );
}

function body(label, namesShown) {
  const tools = h("div", { className: "ui-editor-tools", "data-names": namesShown ? "" : undefined, "aria-hidden": "true" }, toolPlates(skeletonPlate, TOOL_PLATES));
  const canvas = h("div", { className: "ui-editor-canvas" }, h("p", { className: "ui-editor-skeleton-label", role: "status" }, tr(label)));
  const inspector = h(
    "aside",
    { className: "ui-editor-inspector", "aria-hidden": "true" },
    h("header", { className: "ui-editor-panel-head" }, h("span", { className: "ui-editor-panel-copy" }, ...headPlates(skeletonPlate))),
    h("div", { className: "ui-editor-panel" }, fieldRows(skeletonPlate, "span", "ui-editor-skeleton-field")),
  );
  return h("div", { className: "ui-editor-body" }, tools, canvas, inspector);
}

export default function EditorSkeleton({ label = WAIT_LABEL, title = "" }) {
  const shellRef = useRef(null);
  const [warmArrival] = useState(editorRoomStanding);
  const [outwaited, setOutwaited] = useState(false);
  beforePaint(holdEditorRoom, []);
  useEffect(() => {
    const timer = setTimeout(() => setOutwaited(true), ROOM_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);
  const namesHidden = useToolNamesHidden();
  useEditorFitHost(shellRef, "window");
  const narrow = useNarrowWindow();
  useEditorRoom();
  useTr();
  useHolds(shellRef, "editor-layout", [".desktop-app"], !outwaited, ".desktop-content");
  useHolds(shellRef, "editor-flush", [".desktop-content"], true);
  useHolds(shellRef, warmArrival ? "warm-editor" : "", [":parent"]);

  const showNames = !narrow && !namesHidden;
  const toolsMode = showNames ? "names" : "icons";
  const heading = title || tr("Редактор");
  return h(
    "section",
    {
      ref: shellRef,
      className: "ui-editor-shell ui-editor-skeleton",
      "data-fit": "window",
      "data-layout": "studio",
      "data-tools": toolsMode,
      "data-arrival": warmArrival ? "warm" : undefined,
      "aria-busy": "true",
      "aria-label": heading,
    },
    topBar(title),
    body(label, showNames),
  );
}

// ---------- занавес ----------

const veilPlate = plateMaker("ui-veil");

function VeilView(props) {
  const { title = "", tools = TOOL_PLATES } = props;
  useTr();
  const top = h(
    "div",
    { className: "ui-veil-top" },
    veilPlate("back"),
    title ? h("b", { className: "ui-veil-title" }, title) : veilPlate("title", 60),
    h("span", { className: "ui-veil-actions" }, ...actionPlates(veilPlate)),
  );
  const canvas = h("div", { className: "ui-veil-canvas" }, h("p", { className: "ui-veil-label", "data-label": tr(WAIT_LABEL) }));
  const panel = h("div", { className: "ui-veil-panel" }, h("div", { className: "ui-veil-head" }, ...headPlates(veilPlate)), fieldRows(veilPlate, "span", "ui-veil-field"));
  const bodyNode = h("div", { className: "ui-veil-body" }, h("div", { className: "ui-veil-tools" }, toolPlates(veilPlate, tools)), canvas, panel);
  return h("div", { className: "ui-veil", "aria-hidden": "true" }, top, bodyNode);
}

export const EditorVeil = memo(VeilView);
