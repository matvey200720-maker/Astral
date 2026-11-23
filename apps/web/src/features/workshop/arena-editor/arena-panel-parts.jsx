import { ownUiText, tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import Button from "../../../components/ui/Button.jsx";
import { usePanelHelp } from "../../../components/ui/panel-help.js";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import { Question } from "../../../components/ui/icons.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import { createElement as h, Fragment, useId, useState } from "react";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";

/* ---------- подсказка панели ---------- */

// абзацы уходят к «?» в шапке панели, сам компонент ничего не рисует
export const PanelHint = ({ paragraphs }) => {
  usePanelHelp(paragraphs);
  return null;
};

/* ---------- строка списка ---------- */

// событие -> что передать в onHover
const HOVER_EVENTS = [
  ["onMouseEnter", true],
  ["onMouseLeave", false],
  ["onFocus", true],
  ["onBlur", false],
];

const hoverHandlers = (onHover) =>
  onHover
    ? Object.fromEntries(HOVER_EVENTS.map(([name, on]) => [name, () => onHover(on)]))
    : {};

const rowClass = (selected, extra) =>
  ["arena-row", selected && "is-selected", extra].filter(Boolean).join(" ");

// свои пропсы строки; всё остальное уходит в NavRow как есть
const ROW_KEYS = ["media", "title", "caption", "trailing", "selected", "onOpen", "onHover", "className"];
const ROW_DEFAULTS = { media: null, caption: null, onHover: null, className: "" };

// умолчание подставляется только вместо undefined
const ownRowProps = (props) =>
  Object.fromEntries(
    ROW_KEYS.map((key) => [key, props[key] === undefined ? ROW_DEFAULTS[key] : props[key]]),
  );

const restRowProps = (props) =>
  Object.fromEntries(Object.entries(props).filter(([key]) => !ROW_KEYS.includes(key)));

export const ArenaRow = (props) => {
  const row = ownRowProps(props);
  return h(NavRow, {
    className: rowClass(row.selected, row.className),
    icon: row.media,
    title: row.title,
    caption: row.caption,
    onOpen: row.onOpen,
    "aria-pressed": row.selected === undefined ? undefined : Boolean(row.selected),
    // null тоже «передан»: он убирает стрелку справа
    ...(row.trailing === undefined ? null : { trailing: row.trailing }),
    ...hoverHandlers(row.onHover),
    ...restRowProps(props),
  });
};

/* ---------- подсказка «?» ---------- */

const HELP_CLASS = { closed: "arena-help", open: "arena-help is-open" };
const HELP_NOTE_CLASS = "fx-hint arena-help-text is-open";

// остановить всплытие и только потом сделать дело
const swallow = (event, action) => {
  event.stopPropagation();
  action();
};

const useDisclosure = () => {
  const [open, setOpen] = useState(false);
  return {
    open,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
  };
};

const helpButtonProps = ({ open, id, toggle, close }) => {
  const label = tr("Подсказка");
  return {
    size: "sm",
    variant: "ghost",
    className: HELP_CLASS[open ? "open" : "closed"],
    icon: h(Question, { "aria-hidden": "true" }),
    ariaLabel: label,
    title: label,
    "aria-expanded": open,
    "aria-controls": id,
    onClick: (event) => swallow(event, toggle),
    onKeyDown: (event) => {
      if (open && event.key === "Escape") swallow(event, close);
    },
  };
};

export const useHelp = (text) => {
  useTr(); // подписка на смену языка; сами подписи берём из tr
  const id = useId();
  const disclosure = useDisclosure();
  const shown = Boolean(text);

  return {
    button: shown ? h(Button, helpButtonProps({ ...disclosure, id })) : null,
    note:
      shown && disclosure.open
        ? h("p", { id, className: HELP_NOTE_CLASS, role: "note" }, text)
        : null,
  };
};

export const HelpTip = ({ text }) => {
  const help = useHelp(text);
  return help.button ? h(Fragment, null, help.button, help.note) : null;
};

/* ---------- короткие подписи пунктов ---------- */

const LANGUAGE_ORDER = ["ru", "uk", "en", "de", "pl", "fr"];

const frozenTable = (lines) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(lines).map(([id, line]) => [id, Object.freeze(line.split("|"))]),
    ),
  );

// у Majestic «Плакаты» — картины гоночной зоны, фото гонщиков и баннеры команд
const MAJESTIC_LABELS = frozenTable({
  posters: "Картины|Картини|Pictures|Bilder|Obrazy|Tableaux",
});
const SERVER_LABELS = Object.freeze({ majestic: MAJESTIC_LABELS });

// слова по порядку LANGUAGE_ORDER; длина подобрана под пять пунктов в колонке 285 px
const COMMON_LABELS = frozenTable({
  floor: "Пол|Підлога|Floor|Boden|Podłoga|Sol",
  walls: "Стены|Стіни|Walls|Wände|Ściany|Murs",
  ceiling: "Потолок|Стеля|Ceiling|Decke|Sufit|Plafond",
  lights: "Свет|Світло|Light|Licht|Światło|Lumière",
  patterns: "Узоры|Узори|Patterns|Muster|Wzory|Motifs",
  facade: "Фасад|Фасад|Facade|Fassade|Fasada|Façade",
  seats: "Кресла|Крісла|Seats|Sitze|Fotele|Sièges",
  star: "Звезда|Зірка|Star|Stern|Gwiazda|Étoile",
  objects: "Автоматы|Автомати|Vending|Automat|Automaty|Distrib.",
  // не «Предметы»: так зовётся сама группа и кнопка «назад» со страницы вещи
  items: "Вещи|Речі|Items|Objekte|Obiekty|Éléments",
  exits: "Выходы|Виходи|Exits|Ausgänge|Wyjścia|Sorties",
  screens: "Экраны|Екрани|Screens|Monitore|Ekrany|Écrans",
  signs: "Таблички|Таблички|Signs|Schilder|Tabliczki|Panneaux",
  logos: "Эмблемы|Емблеми|Emblems|Embleme|Emblematy|Emblèmes",
  posters: "Плакаты|Плакати|Posters|Plakate|Plakaty|Affiches",
  emblem: "Эмблемы|Емблеми|Emblems|Embleme|Emblematy|Emblèmes",
  text: "Текст|Текст|Text|Text|Tekst|Texte",
  outLogos: "Логотипы|Логотипи|Logos|Logos|Logo|Logos",
  outBanners: "Баннеры|Банери|Banners|Banner|Banery|Bannières",
  models: "Свои|Свої|Custom|Eigene|Własne|Perso",
  replace: "Замена|Заміна|Replace|Ersetzen|Zamiana|Remplacer",
});

const own = (table, key) => (table && Object.hasOwn(table, key) ? table[key] : undefined);

export const arenaTabLabel = (id, server = "", language = "ru") => {
  const words = own(own(SERVER_LABELS, server), id) ?? own(COMMON_LABELS, id);
  if (!words) return "";
  return words[LANGUAGE_ORDER.indexOf(language)] ?? words[0];
};

/* ---------- переключатель разделов ---------- */

const ROWS_FROM = 5;

const SHELL_CLASS = {
  rows: "editor-sub-tools arena-sub-tabs is-rows",
  segments: "editor-sub-tools arena-sub-tabs",
};

// короткое слово, если оно есть, иначе полное название
const shortOrFull = (word, full) => (word ? ownUiText(word) : full);

const tabOption = (server, language, { id, label, icon, disabled }) => {
  const title = tr(label);
  return {
    title,
    icon,
    value: id,
    disabled: Boolean(disabled),
    label: shortOrFull(arenaTabLabel(id, server, language), title),
  };
};

// взятый пункт показан полосой и подложкой, галки справа нет
const tabRow = (current, onChange) => ({ value: key, icon, label, title, disabled }) => {
  const taken = key === current;
  return h(NavRow, {
    key,
    className: taken ? "is-selected" : "",
    icon,
    title: label,
    tooltip: title,
    "aria-pressed": taken,
    disabled,
    trailing: null,
    onOpen: () => onChange(key),
  });
};

const TAB_VIEWS = {
  rows: ({ options, value, onChange }) =>
    h(ListGroup, { label: tr("Раздел") }, options.map(tabRow(value, onChange))),
  segments: ({ options, value, onChange }) =>
    h(SegmentedControl, { label: tr("Раздел"), size: "sm", value, onChange, options }),
};

export const ArenaSubTabs = ({ server = "", onChange, value, members }) => {
  const language = useUiLanguage();
  const options = (members || []).map((item) => tabOption(server, language, item));
  if (options.length < 2) return null;

  const view = options.length >= ROWS_FROM ? "rows" : "segments";
  return h("div", { className: SHELL_CLASS[view] }, TAB_VIEWS[view]({ options, value, onChange }));
};
