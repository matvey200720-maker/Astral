// Колонка инструментов: переведённый список, группа «Карта», выезжающие
// меню «Кисти» и «Фигур», строка управления.
import { createElement, useMemo } from "react";
import { zoneStyleOf } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { useRailGroups } from "../../../ui/useRailGroups.jsx";
import { BrushMenu, ShapesMenu } from "../world-map/MapDrawMenu.jsx";
import { MOD, mapShortcutGroups } from "../world-map-shortcuts.js";
import { mapText } from "../world-map/map-copy.js";
import {
  GUIDE_BY_TOOL,
  GUIDE_COMMON,
  MAP_GROUP,
  PINNED_TOOLS,
  TOOL_ROWS,
} from "./panel-data.js";

// Элемент разметки без атрибутов и с ними
function glyphOf(Icon) {
  return createElement(Icon);
}

function menuOf(Menu, props) {
  return createElement(Menu, props);
}

// Строка списка колонки на языке окна
function toolEntry(row) {
  const entry = { id: row.id };
  entry.label = tr(row.label);
  entry.icon = glyphOf(row.icon);
  entry.shortcut = row.letter;
  entry.group = row.group;
  entry.note = tr(row.note);
  entry.hint = mapText(row.hint, { mod: MOD });
  return entry;
}

// Выезжающие меню рисования: id инструмента -> фабрика функции, которую колонка зовёт с { close }
const FLYOUT_MAKERS = new Map();

FLYOUT_MAKERS.set("brush", (input) => function brushPanel() {
  return menuOf(BrushMenu, { brush: input.brush, onBrush: input.onBrushLatest });
});

FLYOUT_MAKERS.set("zones", (input) => function shapesPanel({ close }) {
  const { shapeTool, onShapeTool } = input;
  return menuOf(ShapesMenu, {
    shape: shapeTool.shape,
    style: zoneStyleOf(shapeTool),
    onShape(shape) {
      onShapeTool({ shape });
      close();
    },
    onStyle: ({ line, fill }) => onShapeTool({ line, fill }),
  });
});

// Добавки к строке: закреплённый инструмент и выезжающее меню
function extrasOf(id, input) {
  const extras = {};
  if (PINNED_TOOLS[id]) extras.pinned = PINNED_TOOLS[id];
  const make = FLYOUT_MAKERS.get(id);
  if (make) {
    extras.menu = true;
    extras.flyout = make(input);
  }
  return extras;
}

function guideLine(row) {
  const [keys, text] = row;
  let shown;
  if (typeof keys === "string") shown = tr(keys);
  else shown = keys.map((key) => tr(key));
  return { keys: shown, text: tr(text) };
}

export function useToolRail(input) {
  const { language, tool, chooseTool, brush, shapeTool } = input;

  // Список пересобирается по языку, кисти и виду фигуры
  function buildTools() {
    const list = [];
    for (const row of TOOL_ROWS) list.push(Object.assign(toolEntry(row), extrasOf(row.id, input)));
    return list;
  }
  // язык меняет подписи; кисть и вид фигуры — содержимое меню
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tools = useMemo(buildTools, [language, brush, shapeTool]);

  function buildGroups() {
    return [{ ...MAP_GROUP, label: tr(MAP_GROUP.label), icon: glyphOf(MAP_GROUP.icon) }];
  }
  // подпись группы зависит от языка
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(buildGroups, [language]);

  const rail = useRailGroups(
    Object.assign({ groups, tools }, { tool, onTool: chooseTool, letters: true }),
  );

  // Строка управления: сначала правила инструмента, потом общие
  function buildGuide() {
    const lines = [];
    for (const row of (GUIDE_BY_TOOL[tool] || []).concat(GUIDE_COMMON)) lines.push(guideLine(row));
    return lines;
  }
  // язык и инструмент
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const guide = useMemo(buildGuide, [tool, language]);

  return { tools, rail, guide, shortcutGroups: mapShortcutGroups(tools) };
}
