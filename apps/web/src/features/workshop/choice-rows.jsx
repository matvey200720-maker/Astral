import { Check } from "../../components/ui/icons.jsx";
import NavRow from "../../components/ui/NavRow.jsx";
import ListGroup, { ListRow } from "../../components/ui/ListGroup.jsx";
import { createElement as h } from "react";

const tick = h(Check, { "aria-hidden": "true" });

// Правила по порядку, срабатывает первое: выбранный вариант со своим
// значением получает строку с «×», все остальные — обычную.
const ROW_RULES = [
  {
    applies: (option, on) => Boolean(on && option.onClear),
    Row: ListRow,
    own: (option) => ({
      className: "is-selected",
      "aria-pressed": true,
      trailing: tick,
      onClear: option.onClear,
      clearLabel: option.clearLabel || "",
    }),
  },
  {
    applies: () => true,
    Row: NavRow,
    own: (_option, on) => ({
      className: on ? "is-selected" : "",
      "aria-pressed": on,
      trailing: on ? tick : null,
    }),
  },
];

// Порядок ключей задаёт порядок атрибутов в DOM: aria-pressed идёт раньше data-choice.
const shared = (option, open) => ({
  title: option.label,
  tooltip: option.tooltip,
  icon: option.icon || null,
  "data-choice": option.value,
  onOpen: open,
});

function rowFor(option, current, choose) {
  const on = option.value === current;
  const { Row, own } = ROW_RULES.find((rule) => rule.applies(option, on));
  return h(Row, {
    key: option.value,
    ...own(option, on),
    ...shared(option, () => choose(option.value)),
  });
}

const ChoiceRows = (props) => {
  const { options, value, onChange } = props;
  const { label, title = "", help = null, className = "" } = props;

  return h(
    ListGroup,
    { title, label, help, className },
    options.map((option) => rowFor(option, value, onChange)),
  );
};

export default ChoiceRows;
