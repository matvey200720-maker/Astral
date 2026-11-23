// Выбор инструмента и всё, что открывает инструмент или страницу из других мест.
import { useRef, useMemo } from "react";
import { toolForObject } from "./map-helpers.js";

// Витрины: карта смотрится, выбранного нет
const SHOWCASE_TOOLS = ["templates", "game", "majestic"];

// Инструмент набора -> вид объекта, с которым он работает; чужой выбор снимается
const OWN_KIND = new Map([
  ["labels", "marker"],
  ["areas", "zone"],
]);

const clearsPicked = (tool, selection) => {
  if (SHOWCASE_TOOLS.includes(tool)) return true;
  const own = OWN_KIND.get(tool);
  return Boolean(own && selection && selection.kind !== own);
};

// Команды собираются на каждой отрисовке и читают свежее состояние
function makeCommands(d) {
  const chooseTool = (next) => {
    d.finishPrint();
    d.setTool(next);
    d.setMeshPick(null);
    d.setMajesticPick(null);
    if (next === "schedule") d.showBoard();
    d.setDraft([]);
    d.setGameFocus(null);
    if (clearsPicked(next, d.selection)) d.setPicked([]);
  };

  // Открыть страницу колонки «Карта» из «Шаблонов» и других мест
  const openMapPage = (page) => {
    chooseTool("select");
    d.setPicked([]);
    d.setMapPage(page);
  };

  // «Открыть набор» из свойств подписи или зоны
  const openSet = (section, setId) => {
    const zones = section === "zones";
    d.setPicked([]);
    chooseTool(zones ? "areas" : "labels");
    (zones ? d.setZonesPage : d.setLabelsPage)(`set:${setId}`);
  };

  return {
    chooseTool,
    openMapPage,
    openSet,
    // Взять инструмент, который правит объект
    openForEdit: (target) => chooseTool(toolForObject(d.config, target)),
  };
}

const COMMAND_NAMES = ["chooseTool", "openMapPage", "openSet", "openForEdit"];

export function useToolFlow(deps) {
  const latest = useRef(null);
  latest.current = makeCommands(deps);
  return useMemo(
    () =>
      Object.fromEntries(
        COMMAND_NAMES.map((name) => [name, (...args) => latest.current[name](...args)]),
      ),
    [],
  );
}
