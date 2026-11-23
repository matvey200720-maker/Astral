import { tr, useTr } from "../../locales/ui.js";
import { createElement as h, Fragment } from "react";
import ChoiceRows from "./choice-rows.jsx";
import ColourEffectField from "./colour-effects/ColourEffectField.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import {
  COLOUR_EFFECT_LABELS,
  COLOUR_EFFECT_MODES,
  normalizeColourEffect,
} from "@modovik/climb-contract/recolor/colour-effects";

// Чем выбирать режим: [от скольких режимов, компонент, добавка к пропсам].
// Первая подходящая строка побеждает; одного режима выбирать не из чего.
const SELECTORS = [
  [5, ChoiceRows, null],
  [2, SegmentedControl, { size: "sm" }],
];

function switchMode(effect, who, onChange, mode) {
  if (mode === effect.mode) return;
  const next = normalizeColourEffect({ ...effect, mode });
  // В журнал идёт русская подпись режима, не переведённая.
  onChange(next, `${who}: ${COLOUR_EFFECT_LABELS[mode]}`);
}

function selectorFor(shared) {
  const rule = SELECTORS.find(([least]) => shared.options.length >= least);
  if (!rule) return null;
  const [, Selector, extra] = rule;
  return h(Selector, { ...shared, ...extra });
}

const EffectSegmentField = (props) => {
  useTr();
  const { onChange, modes = COLOUR_EFFECT_MODES, label = "Цвет", value, subject = "", ...rest } = props;
  const effect = normalizeColourEffect(value);
  const who = subject || label;

  const selector = selectorFor({
    label: `${label}: ${tr("эффект")}`,
    options: modes.map((mode) => ({ value: mode, label: tr(COLOUR_EFFECT_LABELS[mode]) })),
    value: effect.mode,
    onChange: (mode) => switchMode(effect, who, onChange, mode),
  });
  // Полю цвета отдаём один текущий режим, а onChange — как пришёл.
  const fieldProps = { label, subject, value: effect, modes: [effect.mode], onChange, ...rest };

  return h(Fragment, null, selector, h(ColourEffectField, fieldProps));
};

export default EffectSegmentField;
