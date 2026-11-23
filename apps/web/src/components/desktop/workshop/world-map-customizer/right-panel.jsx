// Панель справа: какая панель стоит при каком инструменте и какая у неё шапка.
// Обе функции читают одну сводку состояния окна и ничего не хранят.
import { createElement as h, Fragment } from "react";
import { tr } from "../../../../locales/ui.js";
import { CaretRight } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import WorldMapInspector from "../WorldMapInspector.jsx";
import WorldMapLayers from "../WorldMapLayers.jsx";
import MapPanel, { mapIsVector, mapPanelHead } from "../world-map/MapPanel.jsx";
import MapTemplatesPanel from "../world-map/MapTemplatesPanel.jsx";
import MapSetsTool from "../world-map/MapSetsTool.jsx";
import MapMajestic from "../world-map/MapMajestic.jsx";
import MapMeshLabel from "../world-map/MapMeshLabel.jsx";
import MapScheduleTool from "../world-map/MapScheduleTool.jsx";
import { MapIconsInspector } from "../world-map/icons/MapIconsTool.jsx";
import { GamePage } from "../world-map/MapPanelPages.jsx";
import { setsToolHead } from "../world-map/MapSetsHead.jsx";
import { BRUSH_TOOLS } from "./panel-data.js";
import { layerRowTitle, selectionHead } from "./map-helpers.js";


// Свойства соседу из сводки k. Запись: "имя" — то же поле сводки; ["имя", "поле"] — другое поле;
// ["имя", (k) => значение] — вычисляемое. Порядок записей — порядок свойств.
const pull = (k, spec) =>
  Object.fromEntries(
    spec.map((entry) => {
      if (typeof entry === "string") return [entry, k[entry]];
      const [name, source] = entry;
      return [name, typeof source === "function" ? source(k) : k[source]];
    }),
  );

const INSPECTOR_SPEC = [
  "memoryId", ["panel", (k) => k.panel], "config", "atlas", "selection", "selected", ["onConfig", "apply"],
  "zoneNames", "markerCategory", ["onMarkerCategory", "setMarkerCategory"], "markerLabel",
  ["onMarkerLabel", "setMarkerLabel"], "eraserSize", ["onEraserSize", "setEraserSize"], "onBrush",
  "brushMode", ["onArrowBoth", "setArrowBoth"], ["onPhoto", (k) => (file) => k.addPicture(file)],
  "onSection", "onObject", "onSelect", "onFocus", "onRemove", ["onDuplicate", "duplicateSelected"],
  ["onAddMarker", (k) => () => k.chooseTool("markers")], "onEmblemImage", "onScheduleImage",
  ["onScheduleHide", "hideBoard"], "onFitZone", "shapeTool", "onShapeTool", "onReshape", "onZoneBox",
  "textStyle", "onTextStyle", "fonts", ["onFontFile", "addFont"], ["onOpenSet", "openSet"],
];

const SCHEDULE_SPEC = [
  "config", ["focus", "boardFocus"], ["onConfig", "apply"], ["onShow", "showBoard"], ["onFocus", "focusBoard"],
  ["onImage", "onScheduleImage"], ["onRow", "onBoardRow"],
];

const ICONS_SPEC = [
  ["model", (k) => k.icons.model], ["work", (k) => k.config.blipIcons], ["pick", (k) => k.icons.pick],
  ["onPick", (k) => k.icons.setPick], ["onWork", (k) => k.icons.onWork], ["onPicture", (k) => k.icons.onPicture],
  "assetUrls",
];

const TEMPLATES_SPEC = [
  "config", ["scene", "gameScene"], "atlas", ["backdrop", (k) => k.config.base.backdropColor],
  ["names", "zoneNames"], "thumbs", ["onConfig", "apply"], ["onOpenLook", (k) => () => k.openMapPage("look")],
  ["onNotice", "notify"], "memoryId",
];

const GAME_SPEC = [
  "config", ["tileSide", (k) => k.tiles[0]?.width || 0],
  ["previewImage", (k) => k.baseRaster?.href || k.template?.image || null], "atlas", ["weightScene", "gameScene"],
  ["live", "liveMap"], "onSection", ["focus", "gameFocus"],
];

const LAYERS_SPEC = [
  "memoryId", "config", ["vector", (k) => Boolean(k.baseGeometry) && k.scene.source === "game"], "selection",
  "picked", "frame", "onPick", "onPickGroup", "onReorder", "onRenameGroup", ["onConfig", "apply"], "onRename",
  "renameRequest", "findRequest", ["panel", () => true], ["onMenu", "onLayersMenu"],
];

const MAJESTIC_SPEC = ["config", ["onConfig", "apply"], ["pick", "majesticPick"], ["onPick", "setMajesticPick"]];

const MESH_SPEC = [
  "config", ["pick", "meshPick"], ["onConfig", "apply"], "onSelect", ["onClose", (k) => () => k.setMeshPick(null)],
];

const MAP_SPEC = [
  "config", ["page", "mapPage"], ["onPage", "setMapPage"], "thumbs", ["geometry", (k) => Boolean(k.baseGeometry)],
  "atlas", ["onConfig", "apply"], "onSection", ["source", (k) => k.scene.source], "mapColors",
  ["onChooseLook", "chooseLook"], "onTexture", "memoryId", ["onNotice", "notify"], ["onFocusObject", "onFocus"],
  ["onSplitPack", (k) => (k.packLayers.canSplit ? k.packLayers.resplit : null)],
  ["tileSide", (k) => k.tiles[0]?.width || 0], ["weightScene", "gameScene"], ["live", "liveMap"],
];

// Выбранный объект показывается своей панелью, а не панелью набора
const OWN_KIND_OF_TOOL = new Map([
  ["labels", "marker"],
  ["areas", "zone"],
]);

export function ownsSelection(k) {
  if (!k.selected) return false;
  if (k.tool === "select" || k.tool === "layers") return true;
  return OWN_KIND_OF_TOOL.get(k.tool) === k.selection.kind;
}

const objectInspector = (k, panel) => h(WorldMapInspector, pull({ ...k, panel }, INSPECTOR_SPEC));

// «Слои»: сверху строка «Изменить выбранное», если что-то выбрано
function layersPanel(k) {
  const editRow = k.selected
    ? h(
        Button,
        {
          className: "wmc-nav-row wmc-layers-edit",
          variant: "ghost",
          block: true,
          caption: tr("Изменить выбранное"),
          trailing: h(CaretRight, { "aria-hidden": "true" }),
          onClick: () => k.openForEdit(k.selection),
        },
        layerRowTitle(k.selected),
      )
    : null;
  return h(Fragment, null, editRow, h(WorldMapLayers, pull(k, LAYERS_SPEC)));
}

function setsPanel(k) {
  const zones = k.tool === "areas";
  const catalog = { scene: k.gameScene, atlas: k.atlas, backdrop: k.config.base.backdropColor, names: k.zoneNames };
  return h(MapSetsTool, {
    kind: zones ? "zones" : "labels",
    config: k.config,
    page: zones ? k.zonesPage : k.labelsPage,
    onPage: zones ? k.setZonesPage : k.setLabelsPage,
    catalog,
    ...pull(k, ["memoryId", ["onConfig", "apply"], "onSection", "onSelect", ["onNotice", "notify"], ["onFocusSet", "focusSet"]]),
  });
}

// Панели с собственным содержимым по инструменту; остальное решают правила ниже
const PANEL_BY_TOOL = new Map([
  ["schedule", (k) => h(MapScheduleTool, pull(k, SCHEDULE_SPEC))],
  ["icons", (k) => h(MapIconsInspector, pull(k, ICONS_SPEC))],
  ["templates", (k) => h(MapTemplatesPanel, pull(k, TEMPLATES_SPEC))],
  ["game", (k) => h("div", { className: "wmc-map-panel" }, h(GamePage, pull(k, GAME_SPEC)))],
  ["layers", layersPanel],
  ["majestic", (k) => h(MapMajestic, pull(k, MAJESTIC_SPEC))],
]);

export function inspectorBody(k) {
  const direct = PANEL_BY_TOOL.get(k.tool);
  if (direct) return direct(k);
  const own = ownsSelection(k);
  const forSets = k.tool === "labels" || k.tool === "areas";
  if (k.tool === "labels" && k.meshPick && !own) return h(MapMeshLabel, pull(k, MESH_SPEC));
  if (forSets) return own ? objectInspector(k, "select") : setsPanel(k);
  if (k.tool === "select" && !k.selected) return h(MapPanel, pull(k, MAP_SPEC));
  return objectInspector(k, BRUSH_TOOLS.has(k.tool) ? "brush" : k.tool);
}

// Шапка панели справа; null — оболочка соберёт её из подписи инструмента
export function panelHeadFor(k) {
  const own = ownsSelection(k);
  const clearAll = k.clearPicked;
  if (k.tool === "select") {
    if (k.selected) return selectionHead(k.selection, k.selected, clearAll);
    const vector = mapIsVector(k.config, {
      geometry: Boolean(k.baseGeometry),
      detected: k.mapColors.length > 0,
    });
    return mapPanelHead(k.mapPage, {
      config: k.config,
      onBack: () => k.setMapPage("home"),
      onSection: k.onSection,
      vector,
    });
  }
  const forSets = k.tool === "labels" || k.tool === "areas";
  if (forSets && own) return selectionHead(k.selection, k.selected, clearAll);
  if (k.tool === "labels" && k.meshPick) {
    return {
      label: tr("Подпись автора"),
      note: tr("Правка выбранной — Esc или щелчок мимо снимают выбор"),
      back: { label: tr("Снять выбор"), onClick: () => k.setMeshPick(null) },
    };
  }
  if (forSets) {
    const zones = k.tool === "areas";
    return setsToolHead(zones ? "zones" : "labels", {
      config: k.config,
      onConfig: (next, label, property) => k.apply(next, label, property),
      onSection: k.onSection,
      onFocusSet: k.focusSet,
      names: k.zoneNames,
      page: zones ? k.zonesPage : k.labelsPage,
      onPage: zones ? k.setZonesPage : k.setLabelsPage,
    });
  }
  if (k.railTool === k.tool) return null;
  const { label, note } = k.tools.find((item) => item.id === k.tool);
  return { label, note };
}
