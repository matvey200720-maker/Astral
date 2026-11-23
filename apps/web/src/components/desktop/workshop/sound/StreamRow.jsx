import { createElement as h, memo } from "react";
import {
  ArrowCounterClockwise,
  Crosshair,
  Pause,
  Play,
  UploadSimple,
} from "../../../ui/icons.jsx";
import { TRACK_TAGS } from "@modovik/sound-studio";
import { trackTitle } from "./sound-targets.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundLower, soundReason, soundSeconds, soundTitle } from "./sound-copy.js";

/* id тега → короткая подпись (Map, чтобы «toString» и «__proto__» не находились). */
const SHORT_BY_TAG = new Map(TRACK_TAGS.map((tag) => [tag.id, tag.short]));

export function tagShorts(features) {
  return (features?.tags || [])
    .filter((id) => id !== "long")
    .map((id) => SHORT_BY_TAG.get(id))
    .filter((short) => short !== undefined)
    .map((short) => tr(short));
}

/* Кромка мини-волны: sign = -1 вверх от оси, +1 вниз. */
const edgePoint = (sign) => (peak, column) => `L${column},${(5 + sign * peak * 4.6).toFixed(2)}`;

const sparkCache = new WeakMap();

export function sparkPath(peaks) {
  if (!peaks || !peaks.length) return "";
  const known = sparkCache.get(peaks);
  if (known !== undefined) return known;
  const upper = peaks.map(edgePoint(-1)).join(" ");
  const lower = Array.from(peaks, edgePoint(1)).reverse().join(" ");
  const path = `M0,5 ${upper} ${lower} Z`;
  sparkCache.set(peaks, path);
  return path;
}

const plain = (value) => (value == null || typeof value === "boolean" ? "" : String(value));
const fill = (template, name, value) => template.replace(`{${name}}`, value);
const button = (props, ...kids) => h("button", { type: "button", ...props }, ...kids);

function sparkNode(features) {
  const peaks = features && features.peaks;
  if (!peaks) return h("span", { className: "snd-spark snd-spark-empty", "aria-hidden": "true" });
  return h(
    "svg",
    { className: "snd-spark", viewBox: "0 0 31 10", preserveAspectRatio: "none", "aria-hidden": "true" },
    h("path", { d: sparkPath(peaks) }),
  );
}

function rowFacts(props) {
  const { stream, index, assignment, features } = props;
  const locked = stream.replaceable === false;
  const assigned = Boolean(assignment && assignment.assetHash);
  const title = soundTitle(trackTitle(index));
  return {
    locked,
    assigned,
    title,
    lower: soundLower(title),
    length: soundSeconds(stream.seconds),
    tags: tagShorts(features),
    fileName: assigned ? assignment.assetName : undefined,
  };
}

function rootClass(props, facts) {
  const flags = [
    ["is-active", props.selected],
    ["is-assigned", facts.assigned],
    ["is-locked", facts.locked],
    ["is-playing", props.playing],
    ["is-drop-target", props.dropTarget],
  ];
  return flags.reduce((cls, [name, on]) => (on ? `${cls} ${name}` : cls), "snd-stream");
}

function playButton({ stream, playing, actions }, facts) {
  return button({
    className: "snd-stream-play",
    "aria-label": `${tr(playing ? "Остановить" : "Прослушать")} ${facts.lower}`,
    title: tr(playing ? "Остановить" : "Прослушать оригинал"),
    onClick: () => actions.play(stream.hash),
  }, h(playing ? Pause : Play));
}

function rowLabel(stream, facts) {
  let label = `${facts.title}, ${facts.length}`;
  if (facts.tags.length) label += `, ${facts.tags.join(", ")}`;
  if (facts.locked) label += tr(", только чтение");
  if (facts.assigned) label += fill(tr(", заменена: {name}"), "name", facts.fileName);
  return label;
}

function detailsNode(props, facts) {
  const { stream, showTech } = props;
  // Части хвоста: технические детали, «только чтение», «заменена»; пустых нет.
  const parts = [];
  if (showTech) parts.push(` · ${plain(stream.hash)} · ${plain(stream.sampleRate)} ${tr("Гц")}`);
  if (facts.locked) parts.push(tr(" · только чтение"));
  if (facts.assigned) parts.push(fill(tr(" · заменена: {name}"), "name", facts.fileName));
  if (!facts.tags.length) return h("small", null, facts.length, ...parts);
  const chips = facts.tags.map((label) => h("span", { className: "snd-tag", key: label }, label));
  return h("small", null, facts.length, chips, parts.join("") || null);
}

function selectButton(props, facts) {
  const { stream, actions } = props;
  const reason = facts.locked ? soundReason(stream.reason) || undefined : undefined;
  return button(
    {
      className: "snd-stream-row",
      "aria-label": rowLabel(stream, facts),
      title: facts.locked ? reason : stream.hash,
      onClick: () => actions.select(stream.hash),
    },
    sparkNode(props.features),
    h("b", null, facts.title),
    detailsNode(props, facts),
  );
}

function pinChip({ stream, eventTitle, pinned, actions }, facts) {
  if (!eventTitle) return null;
  const event = tr(eventTitle);
  return button(
    {
      className: pinned ? "snd-pin-chip is-active" : "snd-pin-chip",
      "aria-pressed": pinned,
      title: fill(tr("Отметить как «{event}»"), "event", event),
      "aria-label": fill(fill(tr("Отметить {title} как «{event}»"), "title", facts.lower), "event", event),
      onClick: () => actions.pin(stream.hash),
    },
    h(Crosshair),
    pinned ? tr("Это оно") : tr("Это оно?"),
  );
}

function sideButton({ stream, actions }, facts) {
  if (facts.assigned) {
    return button({
      className: "snd-stream-reset",
      title: tr("Вернуть оригинал"),
      "aria-label": fill(tr("Вернуть оригинал: {title}"), "title", facts.lower),
      onClick: () => actions.reset(stream.hash),
    }, h(ArrowCounterClockwise));
  }
  if (facts.locked) return null;
  return button({
    className: "snd-stream-assign",
    title: tr("Заменить своим файлом"),
    "aria-label": fill(tr("Заменить {title}"), "title", facts.lower),
    onClick: () => actions.pick(stream.hash),
  }, h(UploadSimple));
}

function StreamRow(props) {
  useTr();
  const facts = rowFacts(props);
  const { hash } = props.stream;
  const parts = [
    playButton(props, facts),
    selectButton(props, facts),
    pinChip(props, facts),
    sideButton(props, facts),
  ];
  return h(
    "div",
    {
      "data-hash": hash,
      "data-drop-key": facts.locked ? "" : `stream:${hash}`,
      className: rootClass(props, facts),
    },
    ...parts,
  );
}

export default memo(StreamRow);
