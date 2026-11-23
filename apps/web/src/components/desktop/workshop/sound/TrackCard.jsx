import { createElement as h } from "react";
import { UploadSimple, Waveform } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import WaveformPlayer from "./WaveformPlayer.jsx";
import { tagShorts } from "./StreamRow.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundDecimal, soundSeconds } from "./sound-copy.js";

const DOT = " · ";

/* Так React показал бы значение в тексте: пусто для null, undefined и булевых. */
const shown = (value) => (value == null || typeof value === "boolean" ? "" : String(value));

const fill = (template, name, value) => template.replace(`{${name}}`, value);

/* Мета-строка отдельными текстовыми узлами: длина, разделитель, банк, детали, замена. */
function metaNodes({ target, bankTitle, showTech, assignment }) {
  const first = target.streams[0];
  const tech = showTech ? `${DOT}${shown(first.hash)}${DOT}${shown(first.sampleRate)} ${tr("Гц")}` : null;
  const replaced =
    assignment && assignment.assetHash ? fill(tr(" · заменена: {name}"), "name", assignment.assetName) : null;
  return [soundSeconds(first.seconds), DOT, shown(bankTitle) || null, tech, replaced];
}

function pitchText(hz) {
  if (!hz) return "";
  const value =
    hz >= 1000 ? `${soundDecimal((hz / 1000).toFixed(1))} ${tr("кГц")}` : `${hz} ${tr("Гц")}`;
  return fill(tr("высота ≈{value}"), "value", value);
}

function loudnessText(rms) {
  return Number.isFinite(rms) ? fill(tr("громкость {value} дБ"), "value", Math.round(rms)) : "";
}

/* Признаки читаются только у профиля без ошибки; теги — через общий разбор подписей. */
const usable = (features) => Boolean(features) && !features.error;

function featuresText(features) {
  if (!usable(features)) return "";
  return [tagShorts(features).join(", "), pitchText(features.centroidHz), loudnessText(features.rms)]
    .filter((part) => part !== "")
    .join(DOT);
}

function originalBlock({ original, originalFailed, onRetryOriginal }) {
  if (original) {
    return h(WaveformPlayer, { buffer: original, label: tr("Оригинал из игры") });
  }
  if (originalFailed) {
    return h(
      "span",
      { className: "snd-retry" },
      h("small", { className: "snd-hint snd-conflict" }, tr("Не удалось прочитать звук из игры.")),
      h(Button, { variant: "link", size: "sm", onClick: onRetryOriginal }, tr("Повторить")),
    );
  }
  return h("small", { className: "snd-hint" }, tr("Читаем оригинал из игры…"));
}

/* Описание кнопок блока действий: показываются те, у которых выполнено условие. */
function actionSpecs(props) {
  const { target, features, reference, onSimilar, onReplaceWithReference } = props;
  return [
    {
      when: usable(features),
      icon: Waveform,
      title: tr("Выстроить дорожки банка по похожести на эту"),
      caption: () => tr("Похожие"),
      run: () => onSimilar(target.title, features),
    },
    {
      when: Boolean(reference && reference.file && target.replaceable),
      icon: UploadSimple,
      caption: () => fill(tr("Заменить файлом «{title}»"), "title", reference.title),
      run: () => onReplaceWithReference(target),
    },
  ];
}

/* Кнопки стоят на своих местах: скрытая оставляет пустую позицию, соседняя не пересоздаётся. */
function actionsBlock(props) {
  const buttons = actionSpecs(props).map((spec) =>
    spec.when
      ? h(
          Button,
          { size: "sm", variant: "secondary", icon: h(spec.icon), title: spec.title, onClick: spec.run },
          spec.caption(),
        )
      : null,
  );
  return buttons.some(Boolean) ? h("div", { className: "snd-current-actions" }, ...buttons) : null;
}

export default function TrackCard(props) {
  useTr();
  const features = featuresText(props.features);
  const rows = [
    h("small", { className: "snd-current-meta" }, ...metaNodes(props)),
    features ? h("small", { className: "snd-current-features" }, features) : null,
    originalBlock(props),
    actionsBlock(props),
  ];
  return h("div", { className: "snd-current" }, ...rows);
}
