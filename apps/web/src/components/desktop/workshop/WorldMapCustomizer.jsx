// Мастерская большой карты: оболочка редактора, колонка инструментов слева, панель справа
// и кадр сцены посередине. Состояние и логика лежат в хуках папки ./world-map-customizer/.
// Здесь они вызываются четырьмя слоями, порядок вызова общий и неизменный (он задаёт порядок
// эффектов), а что берёт каждый хук, записано в wiring.js.
import { Fragment, useMemo } from "react";
import ContextMenu from "../../ui/ContextMenu.jsx";
import EditorActions from "../../ui/EditorActions.jsx";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import EditorShell from "../../ui/EditorShell.jsx";
import ShortcutsDialog from "../../ui/ShortcutsDialog.jsx";
import {
  framingOf,
  givenProps,
  inputOf,
  sharedOf,
} from "./world-map-customizer/wiring.js";
import StageLoadOverlay from "../../../features/workshop/stage-loader/StageLoadOverlay.jsx";
import MapSceneStage from "./WorldMapStage.jsx";
import { MapFontsContext } from "./world-map/MapFontsContext.jsx";
import {
  actionProps,
  busyInput,
  chromeOf,
  dialogProps,
  menuProps,
  overlayInput,
  sheetOf,
  stageInput,
} from "./world-map-customizer/outputs.js";
import {
  useApplyFlow,
  useAssetUrls,
  useBaseRaster,
  useBaseSource,
  useBoard,
  useClipboard,
  useCoreState,
  useEditPipeline,
  useIconsTool,
  useKeyboard,
  useMapFonts,
  useMapScene,
  useNotice,
  useObjectMenu,
  usePictures,
  usePlacing,
  useSelection,
  useTextPrint,
  useToolFlow,
  useToolRail,
  useViewState,
} from "./world-map-customizer/parts.js";
import { busyLabel, stagePropsOf } from "./world-map-customizer/stage-props.js";
import {
  inspectorBody,
  panelHeadFor,
} from "./world-map-customizer/right-panel.jsx";
import {
  pictureInput,
  stageOverlay,
} from "./world-map-customizer/stage-parts.jsx";
// Стилевые листы идут после всех модулей и именно в этом порядке:
// каждый следующий перекрывает предыдущие
import "./world-map-customizer.css";
import "./world-map/world-map-redesign.css";
import "./world-map/world-map-labels-1810.css";
import "./world-map/world-map-majestic-1810.css";
import "./world-map/world-map-schedule-1810.css";
import "./world-map/world-map-picker-1810.css";

export { nextLabel } from "./world-map-customizer/map-helpers.js";
export { GAME_PREVIEW_KEY } from "./world-map-customizer/panel-data.js";

// Контекст шрифтов: места выбора шрифта подписи по всему окну берут отсюда список
// и (если родитель принимает файлы) способ добавить свой шрифт.
function useFontsContext({ fonts, props, pictures }) {
  // Свой шрифт можно добавить, только если родитель принимает файлы
  const addFont = props.onAsset ? pictures.addFont : null;

  // В выбор уходят только id и подпись, сам ассет шрифта окнам не нужен
  const choices = useMemo(() => {
    const list = [];
    for (const { id, name } of fonts) list.push({ id, name });
    return list;
  }, [fonts]);

  return useMemo(() => ({ fonts: choices, addFont }), [choices, addFont]);
}

// Заголовок и пояснение заставки зависят от того, что именно сейчас грузится
function curtainTexts(source) {
  if (!source.packLoading)
    return { title: tr("Читаю карту из игры…"), detail: "" };
  const title = tr("Загружаю карту мода");
  const wait = tr("Качаю и разбираю файлы карты — это займёт несколько секунд");
  return { title, detail: source.packOrigin?.title || wait };
}

// Заставка поверх кадра, пока читается карта из игры или грузится карта мода.
// Провал загрузки мода показывает не она, а плашка поверх кадра.
function loadCurtain(source) {
  const shown = (source.reading || source.packLoading) && !source.packFailed;
  return (
    <StageLoadOverlay active={shown} kit="map" {...curtainTexts(source)} />
  );
}

// Слои хуков. Слой копирует уже собранную сводку и дописывает в копию ответы своих хуков,
// поэтому хуку внутри слоя видны ответы всех предыдущих хуков и слоёв.

// Слой 1: язык, уведомления, состояние проекта и единственный выход правок
function useFoundation(rawProps) {
  const layer = { props: givenProps(rawProps) };
  useTr();
  layer.language = useUiLanguage();
  Object.assign(layer, useNotice());
  layer.core = useCoreState(inputOf(layer, "core"));
  layer.config = layer.core.config;
  Object.assign(layer, useEditPipeline(inputOf(layer, "pipeline")));
  return layer;
}

// Слой 2: подложка и сцены. В конце дописывается, где стоит кадр: это нужно хукам дальше
function useBackdrop(prev) {
  const layer = { ...prev };
  layer.assetUrls = useAssetUrls(inputOf(layer, "assetUrls"));
  Object.assign(layer, useMapFonts(inputOf(layer, "fonts")));
  layer.source = useBaseSource(inputOf(layer, "source"));
  layer.raster = useBaseRaster(inputOf(layer, "raster"));
  layer.view = useViewState(inputOf(layer, "view"));
  layer.sceneKit = useMapScene(inputOf(layer, "sceneKit"));
  layer.framing = framingOf(layer);
  return layer;
}

// Слой 3: печать, табло, выбор инструмента, выделение, картинки и размещение.
// Общее для всех хуков ниже (состояние окна, правка, уведомление) считается один раз здесь.
function useEditing(prev) {
  const layer = { ...prev, shared: sharedOf(prev) };
  layer.text = useTextPrint(inputOf(layer, "text"));
  layer.board = useBoard(inputOf(layer, "board"));
  layer.flow = useToolFlow(inputOf(layer, "flow"));
  layer.picks = useSelection(inputOf(layer, "picks"));
  layer.pictures = usePictures(inputOf(layer, "pictures"));
  layer.placing = usePlacing(inputOf(layer, "placing"));
  return layer;
}

// Слой 4: буфер обмена, меню объекта, клавиши, выход наружу, «Иконки», колонка инструментов
function useControls(prev) {
  const layer = { ...prev };
  layer.clipboard = useClipboard(inputOf(layer, "clipboard"));
  layer.menu = useObjectMenu(inputOf(layer, "menu"));
  layer.keys = useKeyboard(inputOf(layer, "keys"));
  layer.outbound = useApplyFlow(inputOf(layer, "outbound"));
  layer.icons = useIconsTool(inputOf(layer, "icons"));
  layer.rail = useToolRail(inputOf(layer, "rail"));
  return layer;
}

// Что кадр рисует поверх сцены. Накладке нужна заставка, поэтому ей отдаётся копия сводки
// с уже готовой заставкой; в саму сводку все три слоя попадают при слиянии в компоненте.
function stageLayersOf(gathered) {
  const loader = loadCurtain(gathered.source);
  const overlay = stageOverlay(overlayInput({ ...gathered, loader }));
  const busy = busyLabel(busyInput(gathered));
  return { loader, overlay, busy };
}

// Меню объекта: есть, только пока для него собрана модель
function objectMenuOf(menu) {
  return menu.menuModel ? <ContextMenu {...menuProps(menu)} /> : null;
}

// Кнопки шапки: отмена и возврат, меню «Ещё»; «Применить» ставит сама оболочка
function headerActionsOf(win) {
  return (
    <EditorActions {...actionProps(win)} apply={win.outbound.applyButton} />
  );
}

// Колонка справа: переключатель инструментов над панелью выбранного инструмента
function inspectorOf(win, sheet) {
  return (
    <Fragment>
      {win.rail.rail.switcher}
      {inspectorBody(sheet)}
    </Fragment>
  );
}

// Свойства оболочки: шапка, колонка инструментов, кнопки и панель справа.
// Сводка для панели справа нужна только им, поэтому считается здесь.
function shellPropsOf(win) {
  const sheet = sheetOf(win);
  const actions = headerActionsOf(win);
  const inspector = inspectorOf(win, sheet);
  return {
    ...chromeOf(win, panelHeadFor(sheet)),
    guideKey: "world-map",
    actions,
    inspector,
  };
}

export default function WorldMapCustomizer(rawProps) {
  const foundation = useFoundation(rawProps);
  const backdrop = useBackdrop(foundation);
  const editing = useEditing(backdrop);
  const controls = useControls(editing);
  const fontsContext = useFontsContext(controls);

  const win = { ...controls, ...stageLayersOf(controls) };
  const objectMenu = objectMenuOf(win.menu);
  const shellProps = shellPropsOf(win);

  const stage = <MapSceneStage {...stagePropsOf(stageInput(win))} />;
  const shortcuts = <ShortcutsDialog {...dialogProps(win.keys, win.rail)} />;
  const filePicker = pictureInput(
    win.pictures.inputRef,
    win.pictures.onPickedFile,
  );

  const shell = (
    <EditorShell {...shellProps}>
      {stage}
      {shortcuts}
      {objectMenu}
      {filePicker}
      {win.outbound.workDialogs}
    </EditorShell>
  );

  return (
    <MapFontsContext.Provider value={fontsContext}>
      {shell}
    </MapFontsContext.Provider>
  );
}
