// Общее состояние панели: нормализованный проект, память редактора по проекту,
// выбор и мелкие состояния окна, которыми делятся остальные части.
import { useEffect, useMemo, useReducer, useRef } from "react";
import { createStarterWorldMap, normalizeWorldMap } from "@modovik/vector-map";
import { takeEditorFocus } from "../../../../features/workshop/editor-links.js";
import { findObject } from "../world-map-editing.js";
import { useMapMemory } from "../world-map-memory.js";
import { categoryRule, memoryRules, pickedRule } from "./map-helpers.js";
import { ERASER_START, LAYER_BY_TOOL, SHAPE_DEFAULT, TEXT_STYLE_DEFAULT } from "./panel-data.js";

const NO_TARGETS = [];

// Состояния окна, которые не помнятся между открытиями: [имя, начальное значение]
const WINDOW_START = [
  ["meshPick", null],
  ["majesticPick", null],
  ["draft", []],
  ["gameFocus", null],
  ["boardFocus", Object.assign({ row: -1 }, { icon: false, stamp: 0 })],
  ["zoomCommand", null],
  ["focus", null],
];

// meshPick -> setMeshPick
function setterOf(name) {
  return "set" + name.charAt(0).toUpperCase() + name.slice(1);
}

// Действие — пара [имя, значение]; то же значение окно не перерисовывает
function reduceWindow(state, [name, value]) {
  if (Object.is(state[name], value)) return state;
  return { ...state, [name]: value };
}

function useWindowValues() {
  const [values, put] = useReducer(reduceWindow, Object.fromEntries(WINDOW_START));
  const setters = useMemo(() => {
    const made = {};
    for (const [name] of WINDOW_START) made[setterOf(name)] = (value) => put([name, value]);
    return made;
  }, []);
  return Object.assign({}, values, setters);
}

// Проект приходит снаружи как есть; без базы берём стартовую карту
function configFrom(raw) {
  if (!raw?.base) return createStarterWorldMap();
  return normalizeWorldMap(raw);
}

export function useCoreState({ rawConfig, project }) {
  const config = useMemo(() => configFrom(rawConfig), [rawConfig]);
  const memoryId = project?.id || "";

  // Всё, что помнится по номеру проекта: ячейка со значением и сеттером
  const useKeptCell = (key, fallback, rule) => {
    const [value, set] = useMapMemory(memoryId, key, fallback, rule);
    return { value, set };
  };
  const cells = [
    ["tool", useKeptCell("tool", "select", memoryRules.tool)],
    ["mapPage", useKeptCell("mapPage", "home", memoryRules.mapPage)],
    ["labelsPage", useKeptCell("labelsPage", "home", memoryRules.setPage)],
    ["zonesPage", useKeptCell("zonesPage", "home", memoryRules.setPage)],
    ["picked", useKeptCell("picked", NO_TARGETS, pickedRule(config))],
    ["eraserSize", useKeptCell("eraserSize", ERASER_START, memoryRules.eraser)],
    ["arrowBoth", useKeptCell("arrowBoth", false, memoryRules.flag)],
    ["shapeTool", useKeptCell("shapeTool", SHAPE_DEFAULT, memoryRules.shape)],
    ["textStyle", useKeptCell("textStyle", TEXT_STYLE_DEFAULT, memoryRules.text)],
    ["markerCategory", useKeptCell("markerCategory", "fuel", categoryRule(config))],
    ["markerLabel", useKeptCell("markerLabel", "", memoryRules.label)],
  ];
  const kept = {};
  for (const [name, cell] of cells) {
    kept[name] = cell.value;
    kept[setterOf(name)] = cell.set;
  }
  const local = useWindowValues();

  // Главный выбранный — последний в списке
  const { picked, tool } = kept;
  const selection = useMemo(() => picked[picked.length - 1] ?? null, [picked]);
  const selected = useMemo(() => findObject(config, selection), [config, selection]);

  // «Выбор» ищет сначала в слое, с которым работали последним
  const layerRef = useRef(null);
  if (LAYER_BY_TOOL[tool]) layerRef.current = LAYER_BY_TOOL[tool];

  // Возврат из мини-карты: открываем «Карту в игре» один раз
  useEffect(() => {
    if (takeEditorFocus("large-map") === "radar") {
      kept.setTool("game");
      local.setGameFocus({ target: "radar", stamp: Date.now() });
    }
    // только при открытии окна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preferLayer = layerRef.current;
  return { config, memoryId, ...kept, ...local, selection, selected, preferLayer };
}
