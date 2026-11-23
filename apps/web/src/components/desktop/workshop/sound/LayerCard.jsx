import { createElement as h, memo } from "react";
import {
  ArrowCounterClockwise,
  Pause,
  Play,
  UploadSimple,
  WarningCircle,
} from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { SOUND_FORMATS, dropCaption } from "./sound-drop.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundDecimal, soundReason, soundTitle, soundWord } from "./sound-copy.js";

/* Подстановка {имя} → значение в уже переведённой строке. */
const fill = (template, values) =>
  Object.keys(values).reduce((text, name) => text.replace(`{${name}}`, values[name]), template);

/* Отказ и заметка живут в одном объекте обратной связи; показывается только непустой текст. */
function splitFeedback(feedback) {
  const text = feedback && feedback.text;
  const tone = text ? feedback.tone : "";
  return { error: tone === "error" ? text : "", note: tone === "note" ? text : "" };
}

function lengthText(seconds) {
  const fixed = (Number(seconds) || 0).toFixed(2);
  return fill(tr("{value} с"), { value: soundDecimal(fixed) });
}

function hintText(target) {
  const variants = target.streams.length;
  const pieces = [tr(target.hint)];
  if (variants > 1) {
    pieces.push(
      fill(tr("В игре {count} {word} этого звука — игра берёт их по очереди, и ваш файл встанет на все."), {
        count: variants,
        word: soundWord(variants, "variant"),
      }),
    );
  }
  return pieces.filter(Boolean).join(" ");
}

function rootProps(v) {
  const { target, selected, dropReady, dropTarget } = v;
  const open = target.replaceable;
  const flags = [
    ["is-assigned", v.assigned],
    ["is-selected", selected],
    ["is-locked", !open],
    ["is-error", Boolean(v.error) && !v.assigned],
    ["is-drop-ready", dropReady && open],
    ["is-drop-target", dropTarget],
  ];
  const tip = hintText(target);
  return {
    className: flags.reduce((cls, [name, on]) => (on ? `${cls} ${name}` : cls), "snd-layer"),
    ...(target.role ? { "data-role": target.role } : null),
    "data-drop-key": open ? target.key : "",
    ...(dropTarget ? { "data-drop-caption": dropCaption(v.name) } : null),
    ...(tip ? { title: tip } : null),
    onClick: v.select,
  };
}

function headNode(v) {
  const kids = [h("b", null, v.name), h("small", null, lengthText(v.target.seconds))];
  if (v.assigned) {
    kids.push(
      h(
        Button,
        {
          className: "snd-layer-reset",
          variant: "ghost",
          size: "sm",
          icon: h(ArrowCounterClockwise),
          "aria-label": fill(tr("Вернуть оригинал: {title}"), { title: v.name }),
          onClick: v.resetOne,
        },
        tr("Вернуть оригинал"),
      ),
    );
  }
  return h("header", { className: "snd-layer-head" }, ...kids);
}

/* Кнопка ▶/⏸ — общая для «Оригинал» и «Ваш». */
function playButton({ running, labels, hint, caption, onClick }) {
  return h(
    Button,
    {
      size: "sm",
      variant: "secondary",
      icon: h(running ? Pause : Play),
      "aria-label": running ? labels[0] : labels[1],
      "aria-pressed": running,
      title: hint,
      onClick,
    },
    caption,
  );
}

function pickButton(v, props, caption) {
  const base = { size: "sm", className: "snd-layer-other", onClick: v.pick };
  return h(Button, { ...base, ...props }, caption);
}

function refusalLine(text, tagProps, rootTag) {
  return h(rootTag, { ...tagProps, role: "alert", title: text }, h(WarningCircle), h("span", null, text));
}

function partialText(v) {
  const variants = v.target.streams.length;
  if (!v.assigned || !(v.assignedVariants < variants)) return "";
  return fill(tr("на {assigned} из {variants} {word}"), {
    assigned: v.assignedVariants,
    variants,
    word: soundWord(variants, "variantOf"),
  });
}

function statusNode(v) {
  if (v.error) return refusalLine(v.error, { className: "snd-layer-file-error" }, "small");
  const text =
    v.note || partialText(v) || (v.bankState === "installed" ? tr("в игре") : tr("ждёт «Применить»"));
  return h("small", v.note ? { title: v.note } : null, text);
}

const SLOT_RULES = [
  [
    (v) => !v.target.replaceable,
    (v) => {
      const reason = soundReason(v.target.reason);
      return [h("small", { className: "snd-layer-reason", title: reason }, reason)];
    },
  ],
  [
    (v) => v.assigned,
    (v) => [
      playButton({
        running: v.playingMine,
        labels: [
          fill(tr("Остановить ваш звук: {title}"), { title: v.name }),
          fill(tr("Прослушать ваш звук: {title}"), { title: v.name }),
        ],
        hint: tr("Так будет звучать в игре"),
        caption: tr("Ваш"),
        onClick: v.playMine,
      }),
      h(
        "span",
        { className: "snd-layer-file" },
        h("b", { title: v.assignment.assetName }, v.assignment.assetName),
        statusNode(v),
      ),
      pickButton(v, { variant: "link" }, tr("Другой файл")),
    ],
  ],
  [
    (v) => Boolean(v.error),
    (v) => [
      refusalLine(v.error, { className: "snd-layer-error" }, "p"),
      pickButton(v, { variant: "link" }, tr("Выбрать другой")),
    ],
  ],
  [
    () => true,
    (v) => [
      h(
        "p",
        { className: "snd-layer-invite" },
        h(UploadSimple),
        h("span", null, tr("Перетащите сюда свой звук"), h("small", null, SOUND_FORMATS)),
      ),
      pickButton(
        v,
        { variant: "ghost", "aria-label": fill(tr("Выбрать файл: {title}"), { title: v.name }) },
        tr("или выберите файл"),
      ),
    ],
  ],
];

function slotNode(v) {
  const [, build] = SLOT_RULES.find(([applies]) => applies(v));
  return h("div", { className: "snd-layer-slot" }, ...build(v));
}

function bodyNode(v) {
  const original = playButton({
    running: v.playingOriginal,
    labels: [
      fill(tr("Остановить оригинал: {title}"), { title: v.name }),
      fill(tr("Прослушать оригинал: {title}"), { title: v.name }),
    ],
    hint: tr("Звук из игры"),
    caption: tr("Оригинал"),
    onClick: v.playOriginal,
  });
  return h("div", { className: "snd-layer-body" }, original, slotNode(v));
}

function LayerCard(props) {
  useTr();
  const { target, assignment, bankState = "", feedback } = props;
  const { onSelect, onPlayOriginal, onPlayMine, onPick, onReset } = props;
  const view = {
    ...props,
    bankState,
    name: soundTitle(target.title),
    assigned: Boolean(assignment && assignment.assetHash),
    ...splitFeedback(feedback),
    // Обработчики зовут обратные вызовы по их именам из свойств.
    select: () => onSelect(target),
    playOriginal: () => onPlayOriginal(target),
    playMine: () => onPlayMine(target),
    pick: () => onPick(target),
    resetOne: (event) => {
      event.stopPropagation();
      onReset([target]);
    },
  };
  return h("article", rootProps(view), headNode(view), bodyNode(view));
}

export default memo(LayerCard);
