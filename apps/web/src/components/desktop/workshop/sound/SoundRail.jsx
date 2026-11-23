import { createElement as h, memo } from "react";
import { ArrowLeft, ArrowsClockwise, MagnifyingGlass } from "../../../ui/icons.jsx";
import { RADIO_STATIONS, describeBank } from "@modovik/sound-studio";
import Button from "../../../ui/Button.jsx";
import Switch from "../../../ui/Switch.jsx";
import { Skeleton } from "../../../ui/Skeleton.jsx";
import { STATE_HINTS, STATE_LABELS } from "./WeaponBankPanel.jsx";
import { dropCaption } from "./sound-drop.js";
import { soundBankKey } from "./sound-model.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundClock, soundCounted, soundReason, soundTitle } from "./sound-copy.js";

const SEARCH_THRESHOLD = 6;
const SKELETON_STEP_MS = 90;
const SKELETON_COUNT = 4;

const fill = (template, name, value) => template.replace(`{${name}}`, value);

/* Подпись поиска: песни на радио, оружие в простом списке, иначе банки вообще. */
function searchPrompt(sectionId, advanced) {
  if (sectionId === "radio") return tr("Найти песню");
  return sectionId === "weapons" && !advanced ? tr("Найти оружие") : tr("Найти банк");
}

/* Подробность строки банка: время песни либо число дорожек. */
function bankDetail(item) {
  if (item.kind !== "bank") return soundCounted(item.streams.length, "track");
  return item.pending ? tr("песня") : soundClock(item.seconds);
}

function modeToggle({ advanced, onAdvanced }) {
  return h(
    "label",
    { className: "snd-mode" },
    h("span", null, tr("Все звуки игры")),
    h(Switch, { label: tr("Все звуки игры"), checked: advanced, onChange: (next) => onAdvanced(next) }),
  );
}

function filterButton({ advanced, replacedCount, onlyReplaced, onOnlyReplaced }) {
  if (!(advanced && replacedCount > 0)) return null;
  const caption = onlyReplaced ? tr("Показать все") : `${tr("Заменено")} · ${replacedCount}`;
  return h(
    Button,
    {
      className: "snd-replaced-filter",
      size: "sm",
      variant: onlyReplaced ? "secondary" : "ghost",
      active: onlyReplaced,
      "aria-pressed": onlyReplaced,
      onClick: () => onOnlyReplaced(!onlyReplaced),
    },
    caption,
  );
}

function refreshButton(props, mode) {
  if (mode.homeRadio) return null;
  return h(
    "button",
    {
      type: "button",
      className: "snd-refresh",
      title: tr("Перечитать из игры"),
      "aria-label": tr("Обновить банки"),
      disabled: mode.loading,
      onClick: props.onRefresh,
    },
    h(ArrowsClockwise),
  );
}

/* Число в шапке: на главной радио считаются станции, в остальных местах — банки. */
const railCount = (props, mode) => (mode.homeRadio ? RADIO_STATIONS.length : props.banks.length);

function headNode(props, mode) {
  const caption = mode.loading ? tr("Читаем из игры…") : `${props.railTitle} · ${railCount(props, mode)}`;
  return h(
    "div",
    { className: "snd-banks-head" },
    h("small", null, caption),
    filterButton(props),
    refreshButton(props, mode),
  );
}

function backButton({ onChooseStation }, mode) {
  if (!mode.stationOpen) return null;
  return h(
    Button,
    {
      className: "snd-back",
      variant: "ghost",
      size: "sm",
      icon: h(ArrowLeft),
      onClick: () => onChooseStation(""),
    },
    tr("Все станции"),
  );
}

function searchNode(props, mode) {
  if (!(mode.ready && props.banks.length > SEARCH_THRESHOLD)) return null;
  const prompt = searchPrompt(props.sectionId, props.advanced);
  return h(
    "label",
    { className: "snd-search" },
    h(MagnifyingGlass),
    h("input", {
      placeholder: prompt,
      "aria-label": prompt,
      type: "search",
      value: props.bankQuery,
      onChange: (event) => props.onBankQuery(event.target.value),
    }),
  );
}

function staleNote(props) {
  if (!props.staleShown) return null;
  return h(
    "small",
    { className: "snd-stale" },
    tr("Файлы игры изменились — обновите список, если нужны актуальные оригиналы"),
  );
}

function problemsNote({ problems }) {
  if (!problems.length) return null;
  const lines = problems.map((entry) => `${entry.bank}: ${entry.error}`);
  return h(
    "small",
    { className: "snd-stale", title: lines.join("\n") },
    fill(tr("Не удалось прочитать банков: {count}"), "count", problems.length),
  );
}

function skeletons(mode) {
  if (!mode.loading) return null;
  return Array.from({ length: SKELETON_COUNT }, (_, step) =>
    h(Skeleton, { key: step, as: "div", className: "snd-skeleton", delay: step * SKELETON_STEP_MS }),
  );
}

function errorBlock(props, mode) {
  if (!mode.failed) return null;
  return h(
    "div",
    { className: "snd-error" },
    h("p", null, props.errorText || tr("Не удалось прочитать звуковые банки.")),
    h(Button, { size: "sm", onClick: props.onRefresh }, tr("Повторить")),
  );
}

function stationsBlock({ onChooseStation }, mode) {
  if (!(mode.homeRadio && mode.ready)) return null;
  const rows = RADIO_STATIONS.map((station) =>
    h(
      "button",
      {
        key: station.archive,
        type: "button",
        className: "snd-bank-row",
        "aria-label": fill(tr("Станция {title}"), "title", station.title),
        onClick: () => onChooseStation(station.archive),
      },
      h("b", null, station.title),
    ),
  );
  return h("div", { className: "snd-bank-group" }, h("h4", null, tr("Музыкальные станции")), rows);
}

function stateBadge(stateKey, text) {
  return h("em", { className: `snd-state is-${stateKey}`, title: tr(STATE_HINTS[stateKey]) }, text);
}

function bankRow(props, item) {
  const key = `${item.archive}:${item.bank}`;
  const info = describeBank(item.bank, item.archive);
  const name = tr(info.title);
  const detail = bankDetail(item);
  const stateKey = props.states.get(soundBankKey(item.archive, item.bank));
  const badgeText = STATE_LABELS[stateKey] ? tr(STATE_LABELS[stateKey]) : "";
  const shelfTarget = props.shelfTargets.get(key);
  const active = key === props.activeKey;
  const dropHit = Boolean(shelfTarget) && props.dropKey === `shelf:${key}`;

  let label = `${name}, ${detail}, ${info.codename}`;
  if (item.readOnly) label += tr(", только чтение");
  if (badgeText) label += `, ${badgeText}`;

  const attrs = {
    type: "button",
    className: "snd-bank-row" + (active ? " is-active" : "") + (dropHit ? " is-drop-target" : ""),
    "data-drop-key": shelfTarget ? `shelf:${key}` : "",
    ...(dropHit ? { "data-drop-caption": dropCaption(`${name}: ${soundTitle(shelfTarget.title)}`) } : null),
    ...(active ? { "aria-current": "true" } : null),
    disabled: item.readOnly,
    "aria-label": label,
    title: item.reason
      ? soundReason(item.reason)
      : `${tr(info.hint || info.title)} · ${info.codename} · ${detail}`,
    onClick: () => props.onSelectBank(item),
  };
  // В полном режиме подробность и пометка «только чтение» — отдельные текстовые узлы.
  const more = props.advanced ? h("small", null, detail, item.readOnly ? tr(" · только чтение") : null) : null;
  return h(
    "button",
    { key, ...attrs },
    h("b", null, name),
    badgeText ? stateBadge(stateKey, badgeText) : null,
    more,
  );
}

function groupNode(props, group) {
  return h(
    "div",
    { key: group.id, className: "snd-bank-group" },
    h("h4", null, tr(group.title)),
    group.banks.map((item) => bankRow(props, item)),
  );
}

function SoundRail(props) {
  useTr();
  const { banksState, sectionId, station } = props;
  const mode = {
    loading: banksState === "loading",
    ready: banksState === "ready",
    failed: banksState === "error",
    homeRadio: sectionId === "radio" && !station,
    stationOpen: sectionId === "radio" && Boolean(station),
  };
  const noMatches = mode.ready && props.groups.length === 0 && props.bankQuery;
  // Каждый блок держит свою позицию в списке детей, даже когда его нет.
  return h(
    "nav",
    { className: "snd-banks", "aria-label": props.railTitle },
    modeToggle(props),
    headNode(props, mode),
    backButton(props, mode),
    searchNode(props, mode),
    staleNote(props),
    problemsNote(props),
    skeletons(mode),
    errorBlock(props, mode),
    stationsBlock(props, mode),
    props.groups.map((group) => groupNode(props, group)),
    noMatches ? h("small", { className: "snd-hint" }, tr("Ничего не нашлось")) : null,
  );
}

export default memo(SoundRail);
