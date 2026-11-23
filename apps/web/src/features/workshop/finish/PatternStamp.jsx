import { trFill } from "../../../locales/tr-fill.js";
import { tr, useTr } from "../../../locales/ui.js";
import SectionHeading from "../section-help.jsx";
import { PatternControls } from "./FinishField.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { Shapes } from "../../../components/ui/icons.jsx";
import { FINISH_PATTERNS, normalizeFinishPattern } from "@modovik/climb-contract/recolor/finish";
import { createElement as h, useCallback, useState } from "react";

const makeDefaultStamp = () => {
  const [first] = FINISH_PATTERNS;
  return Object.freeze({ ...normalizeFinishPattern({ id: first?.id }) });
};

const DEFAULT_STAMP = makeDefaultStamp();

function stampFinish(stamp) {
  const pattern = normalizeFinishPattern(stamp);
  return { mode: "pattern", pattern };
}

// Колонка сама переводит эти строки при отрисовке, поэтому здесь без tr.
const toolEntries = () => [
  ["id", "patterns"],
  ["label", "Узоры"],
  ["icon", h(Shapes)],
  ["group", "paint"],
  ["note", "Узор щелчком по части модели"],
  ["hint", "Выберите узор и цвета справа и щёлкните по части модели — узор ляжет на неё"],
];

const patternTool = (extra = {}) => Object.assign(Object.fromEntries(toolEntries()), extra);

const missText = (miss) => miss || tr("Сюда узор не ляжет — щёлкните по стене, полу или крыше.");

const pickFrom = (onStamp) => (patch) => {
  if (patch.pattern) onStamp(normalizeFinishPattern(patch.pattern));
};

const lastNote = (last) =>
  last
    ? h(
        "p",
        { className: "fx-hint", role: "status", title: tr("«Отменить» вернёт как было.") },
        trFill("Последний узор — на «{0}»", last),
      )
    : null;

const PatternStampSection = (props) => {
  const { swatches = [], last = "", onStamp, stamp } = props;
  useTr();
  const pattern = normalizeFinishPattern(stamp);

  const headingProps = { title: "", help: tr("Щёлкните по части модели — узор ляжет на неё.") };
  const controlsProps = { pattern, swatches, onChange: pickFrom(onStamp) };
  const sectionProps = {
    className: "ui-panel fx-section recolor-section",
    "aria-label": tr("Узоры"),
  };

  const children = [
    h(SectionHeading, headingProps),
    h(PatternControls, controlsProps),
    lastNote(last),
  ];
  return h("section", sectionProps, ...children);
};

// Что делать после щелчка: узор лёг — запомнить подпись, не лёг — сказать об этом.
const aimAt = (settings, hit, target) => {
  const { apply, stamp, setLast, onNotice, miss } = settings;
  const label = apply(target, stampFinish(stamp), hit);
  if (label) return setLast(label);
  return onNotice?.(missText(miss), "info");
};

const usePatternStamp = (key, options) => {
  const { miss = "", onNotice = null, apply } = options;
  const [stamp, setStamp] = useRememberedState(`${key}:stamp`, DEFAULT_STAMP);
  const [last, setLast] = useState("");

  const onAim = useCallback(
    (hit, target) => aimAt({ apply, stamp, setLast, onNotice, miss }, hit, target),
    [apply, stamp, onNotice, miss],
  );

  const panel = h(PatternStampSection, { stamp, onStamp: setStamp, last });
  return { stamp, onAim, panel };
};

export { usePatternStamp, PatternStampSection, patternTool, stampFinish, DEFAULT_STAMP };
