import { trFill } from "../../../locales/tr-fill.js";
import TextField from "../../../components/ui/TextField.jsx";
import { usePanelHelp } from "../../../components/ui/panel-help.js";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import { arenaModelTitleParts, numberedTitles } from "./arena-item-categories.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { Check } from "../../../components/ui/icons.jsx";
import { useHelp } from "./arena-panel-parts.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import {
  arenaObjectsRemovable,
  ARENA_OBJECT_KINDS,
  arenaObjects,
} from "@modovik/climb-contract/recolor/arena-objects";
import { tr, useTr } from "../../../locales/ui.js";
import { createElement as h, useMemo, useState } from "react";

// Русские ключи словаря: переводятся там, где подпись выводится на экран.
const KIND_LABELS = new Map([
  ["screen", "Мониторы и экраны"],
  ["tech", "Техника"],
  ["seat", "Кресла и диваны"],
  ["table", "Столы и подставки"],
  ["plant", "Растения"],
  ["light", "Светильники"],
  ["door", "Двери"],
  ["food", "Еда и посуда"],
  ["trophy", "Кубки и награды"],
  ["structure", "Оболочка и потолок"],
  ["decor", "Декор и прочее"],
]);

// Событие наведения -> выделять ли модель (иначе снять выделение).
const HOVER_EVENTS = [
  ["onMouseEnter", true],
  ["onFocus", true],
  ["onMouseLeave", false],
  ["onBlur", false],
];

const byText = (pick) => (a, b) => {
  const left = pick(a);
  const right = pick(b);
  return left < right ? -1 : Number(left > right);
};

// Сортировка устойчивая, поэтому проходы идут от менее важного ключа к главному.
const SORT_PASSES = [
  byText((model) => model.name),
  (a, b) => b.count - a.count,
  (a, b) => ARENA_OBJECT_KINDS.indexOf(a.kind) - ARENA_OBJECT_KINDS.indexOf(b.kind),
];

function fill(text, ...values) {
  let out = tr(text);
  values.forEach((value, at) => {
    out = out.replace(`{${at}}`, () => String(value));
  });
  return out;
}

function arenaLayersAvailable(server) {
  return server === "gta5rp" && arenaObjectsRemovable(server);
}

function layerState(model, removedSet) {
  const { keys } = model;
  const gone = keys.reduce((count, key) => count + (removedSet.has(key) ? 1 : 0), 0);
  return { gone, total: keys.length, on: gone === 0, off: gone === keys.length };
}

const kindLabel = (kind) => tr(KIND_LABELS.get(kind) || "");

const inSortedOrder = (models) => SORT_PASSES.reduce((list, pass) => list.sort(pass), [...models]);

const entryOf = (model) => ({ model, title: trFill(...arenaModelTitleParts(model)) });

const hasText = (entry, find) =>
  [entry.title, entry.model.name, kindLabel(entry.model.kind)].some(
    (text) => text.toLowerCase().indexOf(find) >= 0,
  );

// Список строк по запросу и число моделей-оболочек (их убрать нельзя).
const collectRows = (objects, find) => {
  if (!objects) return { rows: [], shellCount: 0 };
  const [shells, regular] = objects.models.reduce(
    (parts, model) => {
      parts[model.shell ? 0 : 1].push(model);
      return parts;
    },
    [[], []],
  );
  const titled = numberedTitles(inSortedOrder(regular).map(entryOf));
  return {
    rows: titled.filter((entry) => find === "" || hasText(entry, find)),
    shellCount: shells.length,
  };
};

const captionOf = (model, gone) => {
  const count = model.count > 1 ? fill("{0} шт.", model.count) : tr("один");
  return gone > 0 ? `${count} · ${fill("убрано {0}", gone)}` : count;
};

const hoverProps = (onHover, live) =>
  onHover
    ? Object.fromEntries(
        HOVER_EVENTS.map(([event, entering]) => [event, () => onHover(entering ? live : null)]),
      )
    : null;

const turnOff = (onRemove, live, title) => onRemove?.(live, fill("Слой выключен: {0}", title));

const turnOn = (onRestore, model, removedSet, title) =>
  onRestore?.(
    model.keys.filter((key) => removedSet.has(key)),
    fill("Слой включён: {0}", title),
  );

const layerRow = ({ model, title }, removedSet, handlers) => {
  const { onRemove, onRestore, onHover } = handlers;
  const state = layerState(model, removedSet);
  const live = model.keys.filter((key) => !removedSet.has(key));

  const rowProps = {
    key: model.index,
    "data-layer": model.name,
    title,
    caption: captionOf(model, state.gone),
    tooltip: model.name,
    "aria-pressed": state.on,
    trailing: state.on ? h(Check, { "aria-hidden": "true" }) : null,
    onOpen: () =>
      state.on ? turnOff(onRemove, live, title) : turnOn(onRestore, model, removedSet, title),
  };
  return h(NavRow, Object.assign(rowProps, hoverProps(onHover, live)));
};

const restoreRow = (removedSet, onRestore) => {
  const count = removedSet.size;
  if (count === 0) return false;
  return {
    id: "restore",
    label: fill("Вернуть убранное ({0})", count),
    onClick: () => onRestore?.(Array.from(removedSet), tr("Все детали возвращены")),
  };
};

const sectionHead = (help) =>
  help.button
    ? h("header", { className: "fx-section-head arena-heading" }, h("span"), help.button)
    : null;

const emptyHint = (rows) =>
  rows.length ? null : h("p", { className: "fx-hint" }, tr("Ничего не нашлось."));

const useRemovedSet = (removed) => useMemo(() => new Set(removed || []), [removed]);

// Подсказка раздела: колонка может забрать её себе, иначе показываем в самом разделе.
const useLayersHelp = (shellCount) => {
  const notes = [
    tr("Галочка у каждой модели зала. Сняли — вся модель пропала из зала и из игры, поставили — вернулась."),
    fill(
      "Пол, стены и потолок ({0} моделей оболочки) без галочки: они красятся в своих инструментах, убрать их нельзя.",
      shellCount,
    ),
  ];
  const inPanel = usePanelHelp(notes);
  return useHelp(inPanel ? "" : notes.join(" "));
};

const LayersSection = (props) => {
  const { onHover = null, removed = null, onRemove, onRestore, server } = props;
  useTr();
  const objects = arenaObjects(server);
  const [query, setQuery] = useState("");
  const removedSet = useRemovedSet(removed);

  const { rows, shellCount } = collectRows(objects, query.trim().toLowerCase());
  const help = useLayersHelp(shellCount);
  if (!objects || !arenaLayersAvailable(server)) return null;

  const handlers = { onRemove, onRestore, onHover };
  const searchProps = {
    label: "",
    "aria-label": tr("Модели зала"),
    value: query,
    placeholder: tr("Поиск по названию или роду"),
    onChange: setQuery,
  };
  const sectionProps = {
    className: "ui-panel fx-section recolor-section",
    "aria-label": tr("Слои"),
    "data-arena-section": "layers",
  };

  const body = [
    sectionHead(help),
    help.note,
    h(TextField, searchProps),
    h(
      ListGroup,
      { label: tr("Модели зала") },
      rows.map((entry) => layerRow(entry, removedSet, handlers)),
    ),
    emptyHint(rows),
    h(ActionRows, { label: tr("Слои"), actions: [restoreRow(removedSet, onRestore)] }),
  ];
  return h("section", sectionProps, ...body);
};

export { arenaLayersAvailable, layerState };
export default LayersSection;
