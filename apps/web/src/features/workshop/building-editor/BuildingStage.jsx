/*
 * Кадр редактора зданий («Мегамолл», «Ашан / Икея»).
 *
 * Здание — штатные модели и листы игры игрока на своих местах (сцена
 * описи), на общей матовой плашке редакторов (`ModelStage`), камера — общая
 * на всю мастерскую (`stage-camera.js`): ЛКМ — вращение, щелчок ПКМ — полёт
 * вокруг здания, колесо — приближение.
 *
 * Облик частей — тем же расчётом, что у установщика; надпись и таблички —
 * составными листами (`building-art.js`); стороны, логотипы и надпись-
 * плашка — плашками перед стеной, как они встанут в игре. Логотип и
 * надпись-плашку ставят общим редактором эмблемы: левая кнопка — поставить
 * и вести по стене, правая — камера, колесо — размер, Q и E — поворот.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  BUILDING_LOGO_SIZE,
  BUILDING_TITLE_SIZE,
  buildingBillboard,
  buildingInventory,
  buildingItemModel,
  buildingSignHiddenItems,
  buildingPlanText,
  buildingSide,
  buildingTextTargets,
} from "@modovik/climb-contract/recolor/buildings";
import { EMBLEM_PLACING_HINT, EmblemPlacingBar, useEmblemPlacement } from "../emblem/emblem-placement.jsx";
import { useFinishTexture } from "../finish/finish-textures.js";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { placeBounds, ringDisc, ringEdgeFade } from "../model-stage/ring-fade.js";
import { useSelectionOffstage } from "../model-stage/use-selection-offstage.jsx";
import { focusFrame } from "../model-stage/focus-frame.js";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { useItemShotsFeed, useItemsAim, useWarmEntityBounds } from "../items-panel/use-scene-items.js";
import { itemLookKeys, useItemLookObjects, useItemSwapDrag } from "../items-panel/item-look-objects.js";
import { useItemElementObjects } from "../items-panel/item-elements.js";
import { placeItemFrameOf, placeItemPlaceOf } from "../items-panel/place-item-look.js";
import { sceneFingerprint } from "../model-stage/selection-markup-load.js";
import { useSelectionMarkup } from "../model-stage/use-selection-markup.js";
import { buildingAimSpec, buildingAimTarget, buildingTargetSelection } from "./building-aim.js";
import { useBuildingComposites, useBuildingPlates, useSideFrames } from "./building-art.js";
import useWallOverlay from "../model-stage/useWallOverlay.js";
import { buildingEntryZoom, buildingFrameLook, partLabel } from "./building-text.js";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";

/* Подпись у курсора по цели щелчка: часть здания, сторона, щит, надпись или эмблема. */
function buildingTargetName(target) {
  if (target.tool === "building") return tr(partLabel(target.part));
  if (target.tool === "sides") return tr("Сторона здания");
  if (target.tool === "billboards") return tr("Щит");
  if (target.tool === "emblem") return tr("Эмблема");
  return tr("Надпись");
}
import { labelled } from "../model-stage/hover-label.js";
import { steadyScope } from "../model-stage/selection-highlight.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Слова строки «что уедет в игру» на языке окна: пакет языков не знает (`buildingPlanText`). */
const PLAN_WORDS = Object.freeze({
  say: trFill,
  name: (text) => tr(text),
  lower: (text, first = false) => {
    const language = currentUiLanguage();
    if (language === "de") return text;
    return first ? text.charAt(0).toLocaleLowerCase(language) + text.slice(1) : text.toLocaleLowerCase(language);
  },
});

export default function BuildingStage({
  place,
  project,
  placing = null,
  placingLabel = "Эмблема в руке",
  onPlace = null,
  onAdjust = null,
  onPlaced = null,
  /* Слова надписей прямо в кадре: `useEmblemEditor().stage` — двойной щелчок и поле ввода. */
  textStage = null,
  onCamera = null,
  focusSide = null,
  /* Стороны, у которых рисуется рамка по синей стене (`building-art.js`, `useSideFrames`): выбранная или все четыре. */
  frameSides = null,
  focusBillboard = null,
  /* Табличка, взятая в «Табличках» (`buildingSigns`, id): камера на неё крупно, как на щит (31.10.2026). */
  focusSign = null,
  /* Пункт «Облика», взятый щелчком над панелью: `{ tool, at }` — та же рамка заново, и камера летит к ней при каждом щелчке. */
  shot = null,
  /* Окно «Студии»: выбранная там поверхность (`{ where }` — какие материалы) подсвечена в кадре поверх выбранного в редакторе. */
  focus = null,
  /* Стена, по которой щёлкнули в кадре (`wall-pick.js`): заливка и контур поверх неё. */
  wall = null,
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер): `usePlaceModels().stageProps` и плашка ручек. */
  stageRef: modelsStageRef = null,
  models = null,
  modelSelection = null,
  modelHandlers = null,
  onSceneBounds = null,
  /* Щелчок по кадру: `onAim(hit, target)` — своя модель (`usePlaceModels().onAim`) или деталь здания (`buildingAimTarget`). */
  onAim = null,
  /* Взятый инструмент, раздел колонки (часть, надпись) и табличка: подсвечиваются штрихами, пока взяты. */
  tool = "",
  aimKey = "",
  sign = "",
  overlay = null,
  /* «Предметы» (ТЗ 26.10.2026, п. A): `{ active, objects, entities, onSelect, found, shots }` — выбор вещи по её номеру в сцене; `onAsset` — сцена
     кадра для панели (рамки вещей, «Найти», снимки). */
  items = null,
  onAsset = null,
}) {
  useTr();
  const ownStageRef = useRef(null);
  const stageRef = modelsStageRef || ownStageRef;
  const [asset, setAsset] = useState(null);
  const inventory = buildingInventory(place);
  const scene = inventory?.scenes?.[0] || null;

  /* Отделка здания и частей (кадр = установщик). */
  const building = useFinishTexture(project.building);
  const walls = useFinishTexture(project.parts.walls);
  const roof = useFinishTexture(project.parts.roof);
  const trim = useFinishTexture(project.parts.trim);
  const awnings = useFinishTexture(project.parts.awnings);
  const ground = useFinishTexture(project.parts.ground);
  const finishes = useMemo(() => ({ building, walls, roof, trim, awnings, ground }), [building, walls, roof, trim, awnings, ground]);
  const composites = useBuildingComposites({ asset, project, place });
  const plates = useBuildingPlates({ asset, project, place });
  const wallObjects = useWallOverlay(wall);
  const frameObjects = useSideFrames({ place, sides: frameSides });
  /* Вещи со своим обликом и убранные (ТЗ 27.10.2026): на месте записи встаёт своя модель, цвет или картинка, прежней вещи и убранных в кадре нет. */
  const itemFrameOf = useMemo(() => placeItemFrameOf(place, (entity) => buildingItemModel(place, entity)), [place]);
  const itemPlaceOf = useMemo(() => placeItemPlaceOf(place), [place]);
  const lookObjects = useItemLookObjects({ groups: project.items, frameOf: itemFrameOf, placeOf: itemPlaceOf });
  /* Своя картинка на элементах вещей — слоем поверх их листов, сами вещи на месте (`item-elements.js`). */
  const elementObjects = useItemElementObjects({ groups: project.items, scene: asset, placeOf: itemPlaceOf });
  const hiddenEntities = useMemo(() => {
    const list = [...(project.removed || []), ...buildingSignHiddenItems(place, project), ...itemLookKeys(project.items)];
    return list.length ? list : null;
  }, [project, place]);
  const objects = useMemo(
    () =>
      wallObjects.length || frameObjects.length || lookObjects.length || elementObjects.length
        ? [...(plates || []), ...wallObjects, ...frameObjects, ...lookObjects, ...elementObjects]
        : plates,
    [plates, wallObjects, frameObjects, lookObjects, elementObjects],
  );

  const look = useCallback((index, info) => buildingFrameLook(project, place, info, { finishes, composites }), [project, place, finishes, composites]);

  /* Камера — со стороны главного фасада (или выбранной стороны), чуть сбоку;
     у щита на крыше — на сам щит крупно (пол — по всему зданию). */
  const side = buildingSide(place, focusSide || "front");
  const board = focusBillboard ? buildingBillboard(place, focusBillboard) : null;
  /* Табличка: первое её место на здании (точка и нормаль, как у щита). */
  const signSpot = useMemo(() => (focusSign ? buildingTextTargets(place).find((target) => target.source === `sign:${focusSign}`)?.places[0] || null : null), [place, focusSign]);
  /* «Найти» вещь: кадр летит к ней, пока взяты «Предметы» и сцена та же; другой инструмент — вид по умолчанию. */
  const flight = items?.active && items.found && items.found.asset === asset ? items.found : null;
  const frame = useCallback(
    (loaded) => {
      if (flight) return flight.frame;
      const shell = loaded.parts.find((item) => item.id === "walls");
      const bounds = shell?.bounds || loaded.bounds;
      /* Щит на крыше и вывеска — общим фокусом кадра (`model-stage/focus-frame.js`): лицом к лицу, метров четыре или целиком, не за стеной. */
      const spot = board || signSpot;
      const focused = spot ? focusFrame({ point: spot.point, normal: spot.normal, size: [spot.width || 2, spot.height || 1] }, bounds) : null;
      if (focused) return { bounds, ground: !ringDisc(loaded), ...focused };
      const normal = side?.normal || [0, -1, 0];
      return { bounds, ground: !ringDisc(loaded), view: { yaw: Math.atan2(normal[0], -normal[1]) + 0.4, pitch: 0.34, zoom: focusSide ? 0.7 : buildingEntryZoom(place) } };
    },
    [side, board, signSpot, place, focusSide, flight],
  );

  /* Логотип или надпись-плашка — ставятся на стены здания. */
  /* Грязь и наклейки лежат и поверх стен: отвесная грязь — это стена (19.10.2026: надпись не вставала на
     закопчённый фасад), а грязь на асфальте — нет, надпись там не нарисуется. */
  const onBuilding = useCallback(
    (hit) => {
      const id = String(asset?.parts[hit?.part]?.id || "");
      if (id === "grime" || id === "decals") return Math.abs(hit?.normal?.[2] ?? 1) < 0.6;
      return ["walls", "trim", "roof", "awnings", "title"].includes(id) || id.startsWith("sign:");
    },
    [asset],
  );
  const placement = useEmblemPlacement({
    active: Boolean(placing),
    onPlace: (place) => onPlace?.(place),
    onAdjust: (update, label) => onAdjust?.(update, label),
    sizeRange: placing === "title" ? BUILDING_TITLE_SIZE : BUILDING_LOGO_SIZE,
    accept: onBuilding,
    rotatable: placing !== "title",
    onDone: onPlaced,
  });

  /*
   * Что будет править щелчок и наведение. Пока в руке эмблема или надпись, левая
   * кнопка ставит её, а у выбранной модели свои ручки — деталь тогда не
   * выбирается и не светится.
   */
  const aimOff = Boolean(placing) || Boolean(modelSelection?.canEdit);
  /* Разметка выделения сцены здания (ТЗ 26.10.2026, раздел D): запись сцены набора → файл `.selmap` → кадр. Нет файла — прежний путь. */
  const fingerprint = useMemo(() => sceneFingerprint(asset, scene?.sha256), [asset, scene]);
  const { markup } = useSelectionMarkup(scene?.selection, { scene: fingerprint });
  const warmBounds = useWarmEntityBounds();
  const itemsActive = Boolean(items?.active);
  /* Замену выбранной вещи (своя картинка или модель вместо неё) тянут мышью, пока взяты «Предметы» (`useItemSwapDrag`). */
  const objectDrag = useItemSwapDrag({ groups: project.items, key: itemsActive ? items.selection?.key : null, objects: lookObjects, onMove: items?.onMove });
  const { aimTarget: itemsAimTarget, selected: itemsSelected, pick: itemsPick } = useItemsAim({ active: itemsActive, objects: items?.objects, entities: items?.entities, scope: items?.selection?.scope, asset, onSelect: items?.onSelect, onPick: items?.onPick, onToggle: items?.onToggle, selection: items?.selection, partsOf: items?.partsOf, elementsOf: items?.elementsOf, nameOf: items?.nameOf });
  /* Выбранное за кадром (ТЗ 29.10.2026, вечер): F и плашка «… за кадром · Показать» — общие у кадров с «Предметами» (`use-selection-offstage.jsx`). */
  const itemsTarget = itemsActive && Number.isInteger(items?.selection?.key) ? items.selection : null;
  const offstage = useSelectionOffstage({
    stageRef,
    asset,
    target: itemsTarget ? { key: itemsTarget.key, part: (itemsTarget.scope ?? "one") === "one" && Number.isInteger(itemsTarget.piece) ? items.partsOf?.(itemsTarget.key)?.[itemsTarget.piece] || null : null } : null,
    name: itemsTarget ? items.nameOf?.(itemsTarget.key, itemsTarget.piece) || "" : "",
    onShow: items?.onShow || null,
  });
  useItemShotsFeed(items?.shots, stageRef, asset);
  /*
   * Выделение (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026): подсвечено то, что правится. Щелчок по вещи (не корпусу) в любом
   * инструменте берёт эту вещь — «Предметы» на ней (`target.item`), под курсором — она одна, с именем; групповая отделка — в панели.
   */
  const thingsOn = Boolean(items) && !itemsActive && !aimOff && tool !== "patterns";
  const { aimTarget: thingAimTarget } = useItemsAim({ active: thingsOn, things: true, objects: items?.objects, entities: null, asset, onSelect: items?.onSelect, partsOf: items?.partsOf, elementsOf: items?.elementsOf, nameOf: items?.nameOf });
  const aimTarget = useCallback(
    (hit) => {
      if (itemsActive) return itemsAimTarget(hit);
      const target = aimOff ? null : buildingAimTarget(place, hit);
      /* С «Узорами» светятся только части здания — куда узор ляжет. */
      if (tool === "patterns" && target?.tool !== "building") return null;
      if (!target) return null;
      return thingAimTarget(hit) || labelled(buildingAimSpec(place, buildingTargetSelection(target)) || { none: true }, buildingTargetName(target));
    },
    [itemsActive, itemsAimTarget, aimOff, place, tool, thingAimTarget],
  );
  /* Охват инструмента держится видимым, пока он взят (п. 7): подсвечено то, что правится. */
  const selected = useMemo(() => (aimOff ? null : steadyScope(buildingAimSpec(place, { tool, key: aimKey, sign }))), [aimOff, place, tool, aimKey, sign]);

  const label = `${inventory?.title || tr("Здание")} в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`;

  return (
    <div className="fx-stage recolor-stage is-studio">
      {scene ? (
        <ModelStage loadKit="building"
          ref={stageRef}
          scene={scene.url}
          look={look}
          frame={frame}
          frameKey={`${place}:${board ? `board:${board.id}` : signSpot ? `sign:${focusSign}` : focusSide || "front"}${flight ? `:find${flight.at}` : shot ? `:${shot.at}` : ""}`}
          edgeFade={ringEdgeFade(asset, place === "megamall")}
          onScene={(loaded) => {
            setAsset(loaded);
            warmBounds(loaded);
            onAsset?.(loaded);
            onSceneBounds?.(placeBounds(loaded));
          }}
          onCamera={onCamera}
          onCameraRest={offstage.onCameraRest}
          objects={objects}
          objectDrag={objectDrag}
          placing={Boolean(placing)}
          onPlace={placement.onPlace}
          onAdjust={placement.onAdjust}
          {...textStage}
          models={models}
          modelSelection={modelSelection}
          modelHandlers={modelHandlers}
          onAim={
            onAim
              ? (hit) => {
                  /* С «Предметами» щелчок только выбирает вещь (Shift — ещё одну): инструмент и деталь не меняются. */
                  if (itemsActive) itemsPick(hit);
                  else {
                    const target = aimOff ? null : buildingAimTarget(place, hit);
                    onAim(hit, target && thingAimTarget(hit) ? { ...target, item: hit.entity } : target);
                  }
                }
              : null
          }
          /* Щелчок по пустому снимает выбор «Предметов»; Shift+щелчок — ещё вещь (подпись у курсора скажет один раз). */
          onMiss={itemsActive ? items?.onClear || null : null}
          multi={itemsActive && Boolean(items?.onToggle)}
          aimTarget={aimTarget}
          markup={markup}
          hiddenEntities={hiddenEntities}
          /* Наведение на строку «Предметов» светит её вещи; смена инструмента снимает выбор щелчком и наведение (ТЗ 26.10.2026, п. E). */
          hoverSpec={itemsActive ? items?.hoverSpec || null : null}
          resetKey={tool}
          highlight={focus || (itemsActive ? itemsSelected : selected)}
          label={label}
        >
          {placing && <EmblemPlacingBar text={EMBLEM_PLACING_HINT} label={placingLabel} onDone={onPlaced} />}
          {overlay}
        </ModelStage>
      ) : (
        <p className="model-stage-note">{tr("Сцены этого здания нет в этой версии Astral.")}</p>
      )}
      {/* Под колонкой — только что уедет в игру; общих слов о моделях и листах нет (ТЗ 29.10.2026, вечер). */}
      <StageNote>{buildingPlanText(project, place, PLAN_WORDS)}</StageNote>
      <StageSheetsNote />
      {offstage.plate}
    </div>
  );
}
