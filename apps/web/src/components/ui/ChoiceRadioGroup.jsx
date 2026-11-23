import { createElement as h } from "react";
import ChoiceTile from "./ChoiceTile.jsx";
import useLoneTail from "./useLoneTail.js";
import useTabListKeys from "./useTabListKeys.js";

const GRID = "ui-choice-grid ui-choice-radios";

// Плитка варианта; подсказка — своя или, если её нет совсем (null, undefined), пояснение.
function tileOf(option, at, group) {
  const { value, media, title, description, meta, tooltip, className } = option;
  const choose = () => {
    if (value !== group.value) group.onChange?.(value);
  };
  return h(ChoiceTile, {
    key: value,
    radio: true,
    selected: value === group.value,
    tabIndex: at === group.stop ? 0 : -1,
    "data-choice": value,
    disabled: group.disabled || option.disabled,
    media,
    title,
    description,
    meta,
    tooltip: tooltip ?? description,
    className,
    onClick: choose,
  });
}

// Стрелки и раскладка одинокой последней плитки: оба хука берут одну и ту же ссылку на группу.
function useGroupWiring(props, values) {
  const { options = [], value, onChange, disabled = false } = props;
  const keys = useTabListKeys({ itemSelector: '[role="radio"]', orientation: "both", enabled: !disabled, onChange, value, options });
  useLoneTail(keys.listRef, values.join("|"));
  return keys;
}

export default function ChoiceRadioGroup(props) {
  const { label, value, options = [], disabled = false, className = "" } = props;
  const values = options.map((option) => option.value);
  const { listRef, onKeyDown } = useGroupWiring(props, values);
  // Одна остановка таба: первый из выбранных, а если выбранного нет — первая плитка.
  const group = { value, onChange: props.onChange, disabled, stop: Math.max(0, values.indexOf(value)) };
  const shell = { ref: listRef, onKeyDown, role: "radiogroup", "aria-label": label, "aria-disabled": disabled ? "true" : undefined, className: [GRID, className].filter(Boolean).join(" ") };
  return h("div", shell, options.map((option, at) => tileOf(option, at, group)));
}
