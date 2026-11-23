import { createElement as h } from "react";
import {
  ArrowCounterClockwise,
  Pause,
  Play,
  Trash,
  UploadSimple,
  WarningCircle,
} from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import WaveformPlayer from "./WaveformPlayer.jsx";
import { SOUND_FORMATS, dropCaption } from "./sound-drop.js";
import { STATE_HINTS, STATE_LABELS } from "./WeaponBankPanel.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundChannels, soundClock, soundReason, soundTitle } from "./sound-copy.js";

const DOT = " · ";

/* Корень: классы-флаги и метки для общего приёмника файлов. */
function rootProps({ target, assigned, armed, dropKey }) {
  const onTarget = dropKey === target.key;
  const flags = [
    ["is-assigned", assigned],
    ["is-drop-ready", Boolean(armed && target.replaceable)],
    ["is-drop-target", onTarget],
  ];
  const props = {
    className: flags.reduce((cls, [name, on]) => (on ? `${cls} ${name}` : cls), "snd-bankcard"),
    "data-drop-key": target.replaceable ? target.key : "",
  };
  if (onTarget) props["data-drop-caption"] = dropCaption(soundTitle(target.title));
  return props;
}

function leadOf(bank) {
  if (bank.pending) return tr("Читаем песню из игры…");
  return [soundClock(bank.seconds), soundChannels(bank.channels), `${bank.sampleRate} ${tr("Гц")}`].join(DOT);
}

function stateBadge(state) {
  const key = state && state.state;
  const caption = STATE_LABELS[key];
  if (!caption) return null;
  return h(
    "em",
    { className: `snd-state is-${key}`, title: tr(STATE_HINTS[key]) },
    tr(caption),
  );
}

function removeButton(v) {
  const work = v.state && v.state.work;
  if (!work) return null;
  return h(
    Button,
    {
      variant: "ghost",
      size: "sm",
      icon: h(Trash),
      disabled: v.busy,
      onClick: () => v.onRemoveFromGame(work),
    },
    tr("Убрать из игры"),
  );
}

function headNode(v) {
  // Подсказка банка — отдельный текстовый узел после основной части.
  const subtitle = h("small", null, leadOf(v.bank), v.info.hint ? DOT + tr(v.info.hint) : null);
  const titleBlock = h("div", null, h("h3", null, tr(v.info.title)), subtitle);
  return h("header", { className: "snd-bankcard-head" }, titleBlock, stateBadge(v.state), removeButton(v));
}

/* Кнопка ▶/⏸: одна и та же для «Оригинал» и «Ваш». */
function playToggle({ running, labels, caption, disabled, onClick }) {
  const [whenOn, whenOff] = labels;
  return h(
    Button,
    {
      size: "sm",
      variant: "secondary",
      icon: h(running ? Pause : Play),
      disabled,
      "aria-label": running ? whenOn : whenOff,
      "aria-pressed": running,
      onClick,
    },
    caption,
  );
}

function replaceControl(v) {
  if (v.bank.readOnly) {
    return h("small", { className: "snd-layer-reason" }, soundReason(v.bank.reason));
  }
  const [variant, caption] = v.assigned
    ? ["secondary", tr("Заменить файл")]
    : ["primary", tr("Заменить своей музыкой")];
  return h(
    Button,
    {
      size: "sm",
      variant,
      icon: h(UploadSimple),
      disabled: v.bank.pending,
      onClick: () => v.onPick(v.target),
    },
    caption,
  );
}

function resetButton(v) {
  if (!v.assigned) return null;
  return h(
    Button,
    {
      variant: "ghost",
      size: "sm",
      icon: h(ArrowCounterClockwise),
      onClick: () => v.onReset([v.target]),
    },
    tr("Вернуть оригинал"),
  );
}

function bodyNode(v) {
  const original = playToggle({
    running: v.playing === `orig|${v.target.id}`,
    labels: [tr("Остановить оригинал"), tr("Прослушать оригинал")],
    caption: tr("Оригинал"),
    disabled: v.bank.pending,
    onClick: () => v.onPlayOriginal(v.target),
  });
  const mine = v.assigned
    ? playToggle({
        running: v.playing === `mine|${v.target.key}`,
        labels: [tr("Остановить свою музыку"), tr("Прослушать свою музыку")],
        caption: tr("Ваш"),
        onClick: () => v.onPlayMine(v.target),
      })
    : null;
  return h("div", { className: "snd-bankcard-body" }, original, mine, replaceControl(v), resetButton(v));
}

/* Строка под кнопками: отказ либо подсказка (заметки и прочие тона не показываются). */
function noticeNode(v) {
  const fb = v.feedback;
  if (fb && fb.tone === "error" && fb.text) {
    return h("p", { className: "snd-layer-error", role: "alert" }, h(WarningCircle), h("span", null, fb.text));
  }
  const line = v.assigned
    ? tr("Ваша музыка: {name}").replace("{name}", v.assignment.assetName)
    : tr("или перетащите файл сюда") + DOT + SOUND_FORMATS;
  return h("small", { className: "snd-hint" }, line);
}

function fixedLengthNode(bank) {
  if (!bank.fixedLength || bank.pending) return null;
  const text = tr("Длина фиксирована: {length} — длиннее подрежем, короче дополним тишиной или повтором.");
  return h("small", { className: "snd-hint" }, text.replace("{length}", soundClock(bank.seconds)));
}

function originalNode(v) {
  if (v.original) {
    return h(WaveformPlayer, { buffer: v.original, label: tr("Оригинал из игры") });
  }
  if (!v.originalFailed) return null;
  return h(
    "span",
    { className: "snd-retry" },
    h("small", { className: "snd-hint snd-conflict" }, tr("Не удалось прочитать звук из игры.")),
    h(Button, { variant: "link", size: "sm", onClick: v.onRetryOriginal }, tr("Повторить")),
  );
}

export default function BankCard(props) {
  useTr();
  const { target, assignment } = props;
  const view = {
    ...props,
    bank: target.bank,
    assigned: Boolean(assignment && assignment.assetHash),
  };
  // Пустые места остаются на своих позициях: плеер волны не должен пересоздаваться.
  const rows = [
    headNode(view),
    bodyNode(view),
    noticeNode(view),
    fixedLengthNode(view.bank),
    originalNode(view),
  ];
  return h("section", rootProps(view), ...rows);
}
