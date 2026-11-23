import { tr, useTr } from "../../../../locales/ui.js";
import { createElement as h } from "react";

export default function GunInspector({ children, counts = {}, items = [], onSection, section }) {
  useTr();
  const board = { counts, items, onSection, section };
  return h("div", { className: "gun-inspector" }, tabStrip(board), tabPanel(section, children));
}

function tabStrip(board) {
  const label = tr("Разделы мастерской");
  return h("nav", { className: "gun-sections", role: "tablist", "aria-label": label }, board.items.map(tabMaker(board)));
}

function tabPanel(section, content) {
  return h(
    "div",
    {
      id: PANEL_ID,
      role: "tabpanel",
      "aria-labelledby": TAB_PREFIX + section,
      className: "gun-section-panel",
    },
    content
  );
}

/** Одна вкладка раздела: значок, подпись и, если есть что считать, счётчик. */
const tabMaker =
  ({ counts, items, onSection, section }) =>
  ({ id, label, icon }) => {
    const chosen = id === section;
    const total = counts[id];
    const onKeyDown = (event) => {
      const step = ARROW_STEP.get(event.key);
      if (step === undefined) return;
      event.preventDefault();
      hopFrom(items, id, step, onSection);
    };

    return h(
      "button",
      {
        key: id,
        type: "button",
        role: "tab",
        id: `${TAB_PREFIX}${id}`,
        "aria-selected": chosen ? "true" : "false",
        "aria-controls": PANEL_ID,
        tabIndex: chosen ? 0 : -1,
        className: chosen ? "is-active" : "",
        onClick: () => onSection(id),
        onKeyDown,
      },
      h(icon, { weight: chosen ? "fill" : "regular" }),
      h("span", null, tr(label)),
      total > 0 ? h("em", { "aria-label": total }, total) : null
    );
  };

/** Переход по кругу от вкладки `fromId`: выбор уходит наружу, фокус — сразу следом. */
function hopFrom(items, fromId, step, onSection) {
  const count = items.length;
  const origin = items.findIndex((entry) => entry.id === fromId);
  const { id: nextId } = items[(origin + step + count) % count];
  onSection(nextId);
  document.getElementById(TAB_PREFIX + nextId)?.focus();
}

const TAB_PREFIX = "gun-section-";
const PANEL_ID = "gun-section-panel";
const ARROW_STEP = new Map([
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
]);
