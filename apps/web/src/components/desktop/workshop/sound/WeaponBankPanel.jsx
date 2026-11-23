import { createElement as h } from "react";
import { ArrowCounterClockwise, Trash } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import LayerCard from "./LayerCard.jsx";
import { assignedVariants, targetAssignment } from "./sound-targets.js";
import { tr, useTr } from "../../../../locales/ui.js";

export const STATE_LABELS = Object.freeze(
  Object.fromEntries([
    ["pending", "свой звук"],
    ["installed", "в игре"],
    ["leftover", "в игре"],
  ]),
);

export const STATE_HINTS = Object.freeze(
  Object.fromEntries([
    ["pending", "Свой звук назначен, но ещё не в игре — нажмите «Применить»"],
    ["installed", "Свой звук стоит в игре и с тех пор не менялся"],
    ["leftover", "В игре стоит ваша прежняя замена этого звука"],
  ]),
);

function stateBadge(state) {
  const key = state ? state.state : undefined;
  const label = STATE_LABELS[key];
  if (!label) return null;
  return h("em", { className: `snd-state is-${key}`, title: tr(STATE_HINTS[key]) }, tr(label));
}

/* Правая часть шапки: контейнер есть всегда, кнопки — по обстоятельствам. */
function toolsNode({ state, targets, replacedCount, busy, onReset, onRemoveFromGame }) {
  const resetAll =
    replacedCount > 1
      ? h(
          Button,
          { variant: "ghost", size: "sm", icon: h(ArrowCounterClockwise), onClick: () => onReset(targets) },
          tr("Вернуть оригиналы"),
        )
      : null;
  const removeWork =
    state && state.work
      ? h(
          Button,
          {
            variant: "ghost",
            size: "sm",
            icon: h(Trash),
            disabled: busy,
            title: tr("Снять свой звук этого ствола из игры — вернётся звук игры"),
            onClick: () => onRemoveFromGame(state.work),
          },
          tr("Убрать из игры"),
        )
      : null;
  return h("span", { className: "snd-weapon-tools" }, resetAll, removeWork);
}

export default function WeaponBankPanel(props) {
  useTr();
  const { title, detail, state, targets, assignmentOf } = props;
  const { selectedKey, playing, armed, dropKey, feedback } = props;
  if (targets.length === 0) return null;

  // Назначения считаем один раз на цель: и для счёта замен, и для карточки.
  const entries = targets.map((target) => ({
    target,
    assignment: targetAssignment(target, assignmentOf),
    variants: assignedVariants(target, assignmentOf),
  }));
  const replacedCount = entries.filter((entry) => entry.assignment).length;
  const bankState = (state && state.state) || "";

  const cards = entries.map(({ target, assignment, variants }) =>
    h(LayerCard, {
      key: target.key,
      target,
      assignment,
      assignedVariants: variants,
      bankState,
      selected: target.key === selectedKey,
      playingOriginal: playing === `orig|${target.streams[0].hash}`,
      playingMine: playing === `mine|${target.key}`,
      dropReady: armed,
      dropTarget: dropKey === target.key,
      feedback: feedback[target.key],
      onSelect: props.onSelect,
      onPlayOriginal: props.onPlayOriginal,
      onPlayMine: props.onPlayMine,
      onPick: props.onPick,
      onReset: props.onReset,
    }),
  );

  const head = h(
    "header",
    { className: "snd-weapon-head" },
    h("h3", { title: detail }, title),
    stateBadge(state),
    toolsNode({ ...props, replacedCount }),
  );
  const layers = h("div", { className: "snd-weapon-layers" }, ...cards);
  return h("section", { className: "snd-weapon", "aria-label": title }, head, layers);
}
