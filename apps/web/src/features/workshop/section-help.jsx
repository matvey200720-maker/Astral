import { usePanelHelp } from "../../components/ui/panel-help.js";
import { tr, useTr } from "../../locales/ui.js";
import { Question } from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";
import { createElement as h, Fragment, useId, useState } from "react";

const NO_LINES = Object.freeze([]);

// Подсказка бывает строкой или списком строк: пустые отбрасываем, остальные переводим.
const paragraphsOf = (help) => [].concat(help).flatMap((text) => (text ? [tr(text)] : []));

function stopThen(event, action) {
  event.stopPropagation();
  action();
}

// Раскрытие подсказки: id для aria-controls и два обработчика кнопки.
function useHelpOpen() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const toggle = (event) => stopThen(event, () => setOpen((was) => !was));
  const dismiss = (event) => {
    if (open && event.key === "Escape") stopThen(event, () => setOpen(false));
  };
  return { id, open, toggle, dismiss };
}

// Порядок ключей задаёт порядок атрибутов кнопки: aria-expanded раньше aria-controls.
const helpButtonProps = ({ id, open, toggle, dismiss }, lines) => ({
  size: "sm",
  variant: "ghost",
  className: open ? "section-help is-open" : "section-help",
  icon: h(Question, { "aria-hidden": "true" }),
  ariaLabel: tr("Подсказка"),
  title: lines.join(" "),
  "aria-expanded": open,
  "aria-controls": id,
  onClick: toggle,
  onKeyDown: dismiss,
});

const helpText = (id, lines) =>
  h(
    "div",
    { id, className: "fx-hint section-help-text", role: "note" },
    lines.map((line) => h("p", { key: line }, line)),
  );

const SectionHeading = (props) => {
  useTr();
  const { title, actions = null, note = "", help = null } = props;
  const disclosure = useHelpOpen();

  const paragraphs = paragraphsOf(help);
  // Колонке редактора подсказку отдаём только у раздела без заголовка.
  const inPanel = usePanelHelp(title ? NO_LINES : paragraphs);
  if (inPanel && !(actions || note)) return null;

  const lines = inPanel ? NO_LINES : paragraphs;
  const hasLines = lines.length > 0;
  const headline = title ? h("h3", null, title) : h("span");
  const helpButton = hasLines ? h(Button, helpButtonProps(disclosure, lines)) : null;

  return h(
    Fragment,
    null,
    h("header", { className: "fx-section-head section-help-head" }, headline, helpButton, actions),
    note ? h("p", { className: "section-help-note" }, note) : null,
    disclosure.open && hasLines ? helpText(disclosure.id, lines) : null,
  );
};

export default SectionHeading;
