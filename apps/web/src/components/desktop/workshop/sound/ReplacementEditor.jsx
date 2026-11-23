import { createElement as h, Fragment, useEffect, useState } from "react";
import {
  ArrowCounterClockwise,
  Pause,
  Play,
  SpeakerHigh,
  UploadSimple,
  WarningCircle,
  Waveform,
} from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import TrimWaveform from "./TrimWaveform.jsx";
import { SOUND_FORMATS } from "./sound-drop.js";
import { fitVerdict, fittedSeconds } from "./sound-fit.js";
import { normalizeFx } from "./sound-fx.js";
import { SOUND_LIMITS, assignmentRenderFx } from "./sound-model.js";
import { targetMaxSeconds } from "./sound-targets.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundCounted, soundDecimal, soundReason, soundTitle } from "./sound-copy.js";

const LIMIT_SLACK = 0.001;
const GAIN_MIN = 10;
const GAIN_MAX_FREE = 300;
const FADE_STEP = 10;
const FADE_CEILING = 2000;
const PITCH_RANGE = 12;

// Состояния своего файла: читается, нет на диске или буфер в { buffer }.
const WAITING = Object.freeze({ kind: "waiting" });
const ABSENT = Object.freeze({ kind: "absent" });

const fill = (template, name, value) => template.replace(`{${name}}`, value);

/* Секунды в подсказках: два знака у коротких, один у длинных, знак языка. */
function secondsLabel(value) {
  return fill(tr("{value} с"), "value", soundDecimal(value.toFixed(value < 10 ? 2 : 1)));
}

/* Предел плавности: половина звучания, шаг 10 мс; у совсем коротких звуков — запасной потолок. */
function fadeCeiling(clip) {
  const steps = Math.floor((clip * 1000) / 2 / FADE_STEP);
  if (steps === 0) return FADE_CEILING;
  return Math.max(FADE_STEP, Math.min(FADE_CEILING, steps * FADE_STEP));
}

const signed = (value) => (value > 0 ? `+${value}` : String(value));

/* Загрузка файла назначения: один запрос на пару «хеш, функция чтения». */
function useAssetFile(hash, loadAsset) {
  const [file, setFile] = useState(WAITING);
  useEffect(() => {
    let current = true;
    setFile(hash ? WAITING : ABSENT);
    if (hash) {
      loadAsset(hash).then(
        (buffer) => {
          if (current) setFile(buffer ? { buffer } : ABSENT);
        },
        () => {
          if (current) setFile(ABSENT);
        },
      );
    }
    return () => {
      current = false;
    };
  }, [hash, loadAsset]);
  return file;
}

/* ▶/⏸ — общая заготовка кнопок прослушивания. */
function listenButton(extra, running, caption) {
  return h(
    Button,
    { size: "sm", variant: "secondary", icon: h(running ? Pause : Play), ...extra },
    caption,
  );
}

function headerNode(target) {
  const variants = target.streams.length;
  return h(
    "header",
    null,
    h("h3", null, soundTitle(target.title)),
    variants > 1
      ? h(
          "small",
          { title: tr("Игра берёт варианты по очереди — правка идёт на все сразу") },
          soundCounted(variants, "variant"),
        )
      : null,
  );
}

function errorNode(feedback) {
  if (!(feedback && feedback.tone === "error" && feedback.text)) return null;
  return h("p", { className: "snd-layer-error", role: "alert" }, h(WarningCircle), h("span", null, feedback.text));
}

function emptyBody(c) {
  const original =
    c.target.kind === "stream"
      ? null
      : listenButton(
          { "aria-pressed": c.originalOn, onClick: () => c.onPlayOriginal(c.target) },
          c.originalOn,
          tr("Оригинал"),
        );
  const pick = h(
    Button,
    { size: "sm", variant: "primary", icon: h(UploadSimple), onClick: () => c.onPick(c.target) },
    c.pickLabel,
  );
  return h(
    "div",
    { className: "snd-editor-empty" },
    h("div", { className: "snd-ab" }, original, pick),
    h("small", { className: "snd-hint" }, `${tr("или перетащите файл сюда")} · ${SOUND_FORMATS}`),
  );
}

function closedBody(c) {
  return h("small", { className: "snd-hint snd-conflict" }, soundReason(c.target.reason));
}

function waveNode(c) {
  const { file, assignment, target } = c;
  if (file.kind === "waiting") return h("div", { className: "snd-trim is-pending", "aria-hidden": "true" });
  if (file.kind === "absent") {
    const text = tr("Файла «{name}» больше нет на этом компьютере — перетащите его заново.");
    return h("small", { className: "snd-hint snd-conflict" }, fill(text, "name", assignment.assetName));
  }
  return h(TrimWaveform, {
    buffer: file.buffer,
    start: assignment.trimStart,
    end: assignment.trimEnd,
    guideSeconds: target.kind === "bank" ? 0 : target.seconds,
    accent: "var(--astral-positive)",
    onChange: c.onPatch,
  });
}

/* Строка про предел: «В игру уйдёт не больше …», когда звучание вылезает за потолок. */
function limitNote(c) {
  if (!(c.clip - c.limit > LIMIT_SLACK)) return null;
  const head = fill(
    fill(tr("В игру уйдёт не больше {limit} — сейчас {clip}."), "limit", secondsLabel(c.limit)),
    "clip",
    secondsLabel(c.clip),
  );
  const cutting = c.need && c.need.over === "cut";
  const tail = tr(cutting ? " Лишнее обрежется — или подгоните звук." : " Подвиньте правую ручку.");
  return h("small", { className: "snd-hint snd-conflict" }, head, tail);
}

/* Длина против места и кнопка подгонки; обе позиции заняты вместе или пусты вместе. */
function fitNotes(c) {
  const { need, clip } = c;
  if (!(c.file.buffer && need)) return [null, null];
  const verdict = fitVerdict(clip, need);
  const warn = verdict !== "fits" && !(c.assignment.fx && c.assignment.fx.fit);
  const clipText = secondsLabel(clip);
  // Предложения подсказки идут отдельными текстовыми узлами.
  const sentences = [
    need.seconds > 0
      ? fill(fill(tr("Ваш звук — {clip}, в игре — {need}."), "clip", clipText), "need", secondsLabel(need.seconds))
      : fill(tr("Ваш звук — {clip}."), "clip", clipText),
    need.loops ? tr(" Игра крутит его по кругу.") : null,
    warn ? tr(need.over === "exact" ? " Длиннее песни — конец обрежется." : " Его можно обрезать по-своему, ускорить или зациклить.") : null,
  ];
  return [
    h("small", { className: warn ? "snd-hint snd-conflict" : "snd-hint" }, ...sentences),
    h(
      Button,
      {
        size: "sm",
        variant: warn ? "secondary" : "ghost",
        icon: h(Waveform),
        className: "snd-match",
        onClick: () => c.onFit && c.onFit(c.target),
      },
      tr("Подогнать длину и звучание…"),
    ),
  ];
}

function compareRow(c) {
  const mine = listenButton(
    {
      "aria-label": tr(c.mineOn ? "Остановить ваш звук" : "Прослушать ваш звук"),
      "aria-pressed": c.mineOn,
      title: tr("Так будет звучать в игре"),
      onClick: () => c.onPlayMine(c.target),
    },
    c.mineOn,
    tr("Ваш"),
  );
  const original = listenButton(
    {
      "aria-label": tr(c.originalOn ? "Остановить оригинал" : "Прослушать оригинал"),
      "aria-pressed": c.originalOn,
      title: tr("Звук из игры"),
      onClick: () => c.onPlayOriginal(c.target),
    },
    c.originalOn,
    tr("Оригинал"),
  );
  return h("div", { className: "snd-ab" }, mine, original);
}

function toggleRow(caption, checked, onChange) {
  return h(
    "label",
    { className: "ui-field snd-toggle" },
    h("span", null, caption),
    h(Switch, { label: caption, checked, onChange }),
  );
}

function volumeSlider(c) {
  const { assignment } = c;
  return h(Slider, {
    label: tr("Громкость"),
    value: assignment.gain,
    min: GAIN_MIN,
    max: assignment.normalize ? SOUND_LIMITS.normalizedGain : GAIN_MAX_FREE,
    unit: "%",
    editable: true,
    onChange: (gain) => c.onPatch({ gain }),
  });
}

function matchButton(c) {
  return h(
    Button,
    {
      size: "sm",
      variant: "secondary",
      icon: h(SpeakerHigh),
      className: "snd-match",
      disabled: c.matching,
      title: tr("Подогнать громкость своего звука под звук игры"),
      onClick: () => c.onMatch(c.target),
    },
    c.matching ? tr("Слушаем оригинал…") : tr("Как у оригинала"),
  );
}

function repeatToggle(c) {
  if (!c.target.bank.fixedLength) return null;
  return toggleRow(tr("Если трек короче — повторять"), c.assignment.fill === "loop", (on) =>
    c.onPatch({ fill: on ? "loop" : "silence" }),
  );
}

function moreToggle(c) {
  return h(
    Button,
    {
      variant: "link",
      size: "sm",
      className: "snd-more",
      "aria-expanded": c.moreOpen,
      "aria-label": tr(c.moreOpen ? "Скрыть настройки" : "Ещё настройки"),
      onClick: c.toggleMore,
    },
    tr(c.moreOpen ? "Скрыть" : "Ещё"),
  );
}

function moreSection(c) {
  if (!c.moreOpen) return null;
  const { assignment, onPatch } = c;
  const ceiling = fadeCeiling(c.clip);
  const fade = (key, caption) =>
    h(Slider, {
      label: tr(caption),
      value: Math.min(assignment[key], ceiling),
      min: 0,
      max: ceiling,
      step: FADE_STEP,
      unit: tr(" мс"),
      onChange: (value) => onPatch({ [key]: value }),
    });
  return h(
    "div",
    { className: "snd-editor-more" },
    fade("fadeIn", "Плавное начало"),
    fade("fadeOut", "Плавный конец"),
    h(Slider, {
      label: tr("Тон"),
      hint: tr("В полутонах; вместе с тоном меняется и темп"),
      value: assignment.pitch,
      min: -PITCH_RANGE,
      max: PITCH_RANGE,
      step: 1,
      format: signed,
      onChange: (pitch) => onPatch({ pitch }),
    }),
    toggleRow(tr("Задом наперёд"), assignment.reverse, (reverse) => onPatch({ reverse })),
    toggleRow(tr("Нормализация"), assignment.normalize, (normalize) => onPatch({ normalize })),
  );
}

function assignedBody(c) {
  const fileRow = h(
    "div",
    { className: "snd-editor-file" },
    h("b", { title: c.assignment.assetName }, c.assignment.assetName),
    h(
      Button,
      {
        variant: "link",
        size: "sm",
        "aria-label": `${c.pickLabel}: ${soundTitle(c.target.title)}`,
        onClick: () => c.onPick(c.target),
      },
      c.pickLabel,
    ),
  );
  const [placeNote, fitButton] = fitNotes(c);
  const reset = h(
    Button,
    { variant: "ghost", size: "sm", icon: h(ArrowCounterClockwise), onClick: () => c.onReset([c.target]) },
    tr("Вернуть оригинал"),
  );
  // Каждый орган держит свою позицию, чтобы волна и ползунки не пересоздавались.
  return h(
    Fragment,
    null,
    fileRow,
    waveNode(c),
    limitNote(c),
    placeNote,
    fitButton,
    compareRow(c),
    volumeSlider(c),
    matchButton(c),
    repeatToggle(c),
    moreToggle(c),
    moreSection(c),
    reset,
  );
}

export default function ReplacementEditor(props) {
  useTr();
  const { target, assignment, loadAsset, playing, need = null, children = null } = props;
  const hash = (assignment && assignment.assetHash) || "";
  const file = useAssetFile(hash, loadAsset);
  const [moreOpen, setMoreOpen] = useState(false);

  const firstHash = target.streams[0].hash;
  const ctx = {
    ...props,
    need,
    file,
    moreOpen,
    toggleMore: () => setMoreOpen((open) => !open),
    originalOn: playing === `orig|${firstHash}`,
    mineOn: playing === `mine|${target.key}`,
  };
  let body;
  if (target.replaceable === false) {
    body = closedBody(ctx);
  } else if (hash) {
    const length = file.buffer ? file.buffer.duration || 0 : 0;
    ctx.clip = fittedSeconds(length, normalizeFx(assignmentRenderFx(assignment)));
    ctx.limit = need && need.limit > 0 ? need.limit : targetMaxSeconds(target);
    body = assignedBody(ctx);
  } else {
    body = emptyBody(ctx);
  }

  return h(
    "section",
    {
      className: "ui-panel snd-section snd-editor" + (props.dropTarget ? " is-drop-target" : ""),
      "data-drop-key": target.replaceable ? target.key : "",
    },
    headerNode(target),
    children,
    errorNode(props.feedback),
    body,
  );
}
