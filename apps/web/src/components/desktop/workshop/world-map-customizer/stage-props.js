// Свойства кадра сцены: что панель отдаёт кадру. Данные идут первыми, за ними обратные вызовы.
import { BRUSH_TOOLS } from "./panel-data.js";

// Метка «занято» на кадре: первое непустое из хода работ
export function busyLabel({ source, raster, settling, sceneKit, words }) {
  const stages = [
    source.reading && words.reading,
    source.packBusy && source.packWord,
    raster.rasterPending,
    settling,
    sceneKit.labelsWaiting && words.labels,
  ];
  return stages.find(Boolean) || false;
}

export function stagePropsOf(a) {
  const { core, config, source, sceneKit, view, text, placing, picks, pictures, board, menu, flow } = a;
  const { tool, shapeTool } = core;
  const pickWhen = (name, value) => (tool === name ? value : null);

  const data = {
    memoryId: core.memoryId,
    scene: sceneKit.stageScene,
    backdrop: config.base.backdropColor,
    busy: a.busy,
    gamePreview: view.gamePreview,
    crowding: sceneKit.crowding,
    config,
    atlas: source.atlas,
    tool: BRUSH_TOOLS.has(tool) ? "brush" : tool,
    shape: shapeTool.shape,
    shapeLook: { ...shapeTool, color: shapeTool.color || "#ffffff" },
    preferLayer: core.preferLayer,
    selection: core.selection,
    picked: core.picked,
    draft: core.draft,
    eraserSize: core.eraserSize,
    brush: config.paint.brush,
    brushMode: placing.brushMode,
    zoomCommand: core.zoomCommand,
    textEdit: text.stageEdit,
    focus: core.focus,
    meshPick: pickWhen("labels", core.meshPick),
    majesticPick: pickWhen("majestic", core.majesticPick),
    onMajesticPick: tool === "majestic" && sceneKit.majesticReady ? core.setMajesticPick : null,
    boardRow: core.boardFocus.row,
    overlay: a.overlay,
  };

  const onFixCrowding = () => {
    core.setPicked([]);
    core.setLabelsPage("home");
    flow.chooseTool("labels");
  };

  const handlers = [
    ["onViewChange", view.onViewChange],
    ["onObjectMenu", menu.onObjectMenu],
    ["onGamePreview", view.onGamePreview],
    ["onFixCrowding", onFixCrowding],
    ["onSelect", picks.onSelect],
    ["onSelectMany", picks.onSelectMany],
    ["onDraftPoint", placing.onDraftPoint],
    ["onPlace", placing.onPlace],
    ["onShape", placing.onShape],
    ["onConfigChange", a.apply],
    ["onErase", placing.onErase],
    ["onStroke", placing.onStroke],
    ["onZoomChange", view.onZoomChange],
    ["onDropFiles", pictures.onDropFiles],
    ["onEditText", text.editEmblem],
    ["onMeshPick", picks.onMeshPick],
    ["onBoardRow", board.onBoardRow],
    ["onBoardIcon", board.onBoardIcon],
    ["onBoardAdd", board.onBoardAdd],
  ];

  return { ...data, ...Object.fromEntries(handlers) };
}
