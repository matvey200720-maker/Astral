/*
 * Кадр редактора завода.
 *
 * Весь завод в 3D — корпуса, земля двора, контейнеры и реквизит на тех
 * местах, где их ставит игра, — на общей матовой плашке редакторов
 * перекраски (`ModelStage`). Одна сцена без переключателей: модель медленно
 * вращается; камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ —
 * вращение, щелчок ПКМ — полёт по заводу (W A S D, Q и E, Shift), колесо —
 * приближение, двойной щелчок — снова вид на весь завод.
 *
 * Цвет каждой поверхности — тот, что уедет в игру: у текстур мода плашки
 * 4×4 ровного цвета, так что кадр показывает ровно их, с тинтом, как
 * считает игра (цвет × палитра). Эмблему ставят общим редактором эмблемы
 * (`emblem-placement.jsx`): левая кнопка ставит и ведёт её по любой
 * поверхности, правая — камера, колесо — размер, Q и E — поворот; в игре
 * она встанет плашкой на то же место.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { FACTORY_EMBLEM_SIZE, FACTORY_GROUPS, FACTORY_INVENTORY, FACTORY_PARTS, FACTORY_PLACE, factoryEmblemDecals, factoryItemModel } from "@modovik/climb-contract/recolor/factory";
import { emblemDecalLooks, useEmblemTextures } from "../emblem/emblem-items.js";
import { EmblemPlacingBar, useEmblemPlacement } from "../emblem/emblem-placement.jsx";
import { useFinishTexture } from "../finish/finish-textures.js";
import useWallOverlay from "../model-stage/useWallOverlay.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { placeBounds, ringEdgeFade } from "../model-stage/ring-fade.js";
import { useSelectionOffstage } from "../model-stage/use-selection-offstage.jsx";
import { useItemShotsFeed, useItemsAim, useWarmEntityBounds } from "../items-panel/use-scene-items.js";
import { itemLookKeys, useItemLookObjects, useItemSwapDrag } from "../items-panel/item-look-objects.js";
import { useItemElementObjects } from "../items-panel/item-elements.js";
import { placeItemFrameOf, placeItemPlaceOf } from "../items-panel/place-item-look.js";
import { sceneFingerprint } from "../model-stage/selection-markup-load.js";
import { useSelectionMarkup } from "../model-stage/use-selection-markup.js";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { factoryAimSpec, factoryAimTarget } from "./factory-aim.js";
import { factoryFrameLook, factoryGroupFrame, factoryStageFrame } from "./factory-text.js";
import { labelled } from "../model-stage/hover-label.js";
import { steadyScope } from "../model-stage/selection-highlight.js";
import { tr } from "../../../locales/ui.js";

/* Рамки и места вещей завода для облика вещей в кадре: устойчивые между отрисовками. */
const FACTORY_FRAME_OF = placeItemFrameOf("factory", factoryItemModel);
const FACTORY_PLACE_OF = placeItemPlaceOf("factory");

export default function FactoryStage({
  project,
  /* Окно «Студии»: выбранная там поверхность (`{ where }` — какие материалы) подсвечена в кадре поверх выбранного в редакторе. */
  focus = null,
  /* Группа «Облика», взятая щелчком над панелью: `{ tool, at }` — камера к ней (`factoryGroupFrame`, 31.10.2026). */
  shot = null,
  /* Стена, по которой щёлкнули в кадре (`wall-pick.js`): заливка и контур поверх неё. */
  wall = null,
  placing = false,
  placingLabel = "Эмблема в руке",
  onPlace = null,
  onAdjust = null,
  onPlaced = null,
  /* Слова надписей прямо в кадре: `useEmblemEditor().stage` — двойной щелчок и поле ввода. */
  textStage = null,
  onCamera = null,
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер): `usePlaceModels().stageProps` и плашка ручек. */
  stageRef: modelsStageRef = null,
  models = null,
  modelSelection = null,
  modelHandlers = null,
  onSceneBounds = null,
  /* Щелчок по кадру: `onAim(hit, target)` — своя модель (`usePlaceModels().onAim`) или деталь завода (`factoryAimTarget`). */
  onAim = null,
  /* Взятый инструмент и часть корпуса: подсвечиваются штрихами, пока взяты. */
  tool = "",
  part = "",
  overlay = null,
  /* «Предметы» (ТЗ 26.10.2026, п. A): `{ active, objects, entities, selection, onSelect, found, shots, hoverSpec }` — выбор вещи по её номеру в сцене;
     `onAsset` — сцена кадра для панели (рамки вещей, «Найти», снимки). */
  items = null,
  onAsset = null,
}) {
  const ownStageRef = useRef(null);
  const stageRef = modelsStageRef || ownStageRef;
  const emblemTextures = useEmblemTextures(project.emblems);
  /* Разметка выделения сцены (раздел D ТЗ 26.10.2026): запись `scene.selection` в описи; нет её или файла — прежний путь (вещь и остров). */
  const [asset, setAsset] = useState(null);
  /* Убранные по одной вещи (ТЗ 26.10.2026, «Удалить» в «Предметах»): в кадре их нет, как не будет в игре. */
  /* Вещи со своим обликом (ТЗ 27.10.2026): на месте записи встаёт своя модель, цвет или картинка, прежней вещи в кадре нет. */
  const lookObjects = useItemLookObjects({ groups: project.items, frameOf: FACTORY_FRAME_OF, placeOf: FACTORY_PLACE_OF });
  /* Своя картинка на элементах вещей — слоем поверх их листов, сами вещи на месте (`item-elements.js`). */
  const elementObjects = useItemElementObjects({ groups: project.items, scene: asset, placeOf: FACTORY_PLACE_OF });
  const hidden = useMemo(() => {
    const list = [...(project.removed || []), ...itemLookKeys(project.items)];
    return list.length ? list : null;
  }, [project.removed, project.items]);
  const fingerprint = useMemo(() => sceneFingerprint(asset, FACTORY_INVENTORY.scene.sha256), [asset]);
  const { markup } = useSelectionMarkup(FACTORY_INVENTORY.scene.selection, { scene: fingerprint });
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
  /* «Найти» вещь: кадр летит к ней, пока взяты «Предметы» и сцена та же; другой инструмент — вид по умолчанию. */
  const flight = items?.active && items.found && items.found.asset === asset ? items.found : null;
  const frame = useCallback((loaded) => (flight ? flight.frame : shot ? factoryGroupFrame(loaded, shot.tool) : factoryStageFrame(loaded)), [flight, shot]);

  /* Текстуры отделки групп и своих частей корпуса (кадр = установщик). */
  const buildings = useFinishTexture(project.buildings);
  const wallObjects = useWallOverlay(wall);
  const objects = useMemo(() => {
    const list = [...wallObjects, ...lookObjects, ...elementObjects];
    return list.length ? list : wallObjects;
  }, [wallObjects, lookObjects, elementObjects]);
  const ground = useFinishTexture(project.ground);
  const containers = useFinishTexture(project.containers);
  const props = useFinishTexture(project.props);
  const walls = useFinishTexture(project.parts.walls);
  const roofs = useFinishTexture(project.parts.roofs);
  const concrete = useFinishTexture(project.parts.concrete);
  const metal = useFinishTexture(project.parts.metal);
  const machinery = useFinishTexture(project.parts.machinery);
  const details = useFinishTexture(project.parts.details);
  const textures = useMemo(
    () => ({
      buildings,
      ground,
      containers,
      props,
      "part:walls": walls,
      "part:roofs": roofs,
      "part:concrete": concrete,
      "part:metal": metal,
      "part:machinery": machinery,
      "part:details": details,
    }),
    [buildings, ground, containers, props, walls, roofs, concrete, metal, machinery, details],
  );

  /* Эмблема — наклейкой по миру (та же рамка, что у плашки в игре). */
  const decals = useMemo(() => {
    const looks = emblemDecalLooks(factoryEmblemDecals(project), emblemTextures);
    return looks.length ? looks : null;
  }, [project, emblemTextures]);

  const look = useCallback((index, info) => factoryFrameLook(project, info, { textures, decals }), [project, textures, decals]);

  /* Редактор эмблемы — общий у всех редакторов мест (`emblem-placement.jsx`). */
  const placement = useEmblemPlacement({
    active: placing,
    onPlace,
    onAdjust,
    sizeRange: FACTORY_EMBLEM_SIZE,
    onDone: onPlaced,
  });

  /*
   * Что будет править щелчок и наведение. Пока в руке эмблема, левая кнопка ставит
   * её, а у выбранной модели свои ручки — деталь тогда не выбирается и не светится.
   */
  const aimOff = Boolean(placing) || Boolean(modelSelection?.canEdit);
  /*
   * Выделение (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026: «я выделил одно это, а у меня покрасилось всё»): подсвечено то, что
   * правится. Групповой инструмент («Реквизит», «Корпуса») светит всю группу; щелчок по вещи в любом инструменте берёт эту вещь — «Предметы»
   * на ней (`target.item`), под курсором — она одна, с именем. Групповую отделку меняют в панели. Корпуса и земля — оболочка, не вещь:
   * щелчок по ним берёт часть («Стены»), и светятся все стены — то, что правится.
   */
  const thingsOn = Boolean(items) && !itemsActive && !aimOff;
  const { aimTarget: thingAimTarget } = useItemsAim({ active: thingsOn, things: true, objects: items?.objects, entities: null, asset, onSelect: items?.onSelect, partsOf: items?.partsOf, elementsOf: items?.elementsOf, nameOf: items?.nameOf });
  const aimTarget = useCallback(
    (hit) => {
      if (itemsActive) return itemsAimTarget(hit);
      const target = aimOff ? null : factoryAimTarget(hit);
      if (!target) return null;
      const thing = thingAimTarget(hit);
      if (thing) return thing;
      /* Не вещь описи — подпись у курсора: часть корпуса («Стены», «Крыши») или группа («Контейнеры», «Земля»), светится вся. */
      const name = tr((target.part ? FACTORY_PARTS.find((item) => item.id === target.part) : FACTORY_GROUPS.find((item) => item.id === target.tool))?.label || "");
      return labelled(factoryAimSpec(target.tool, target.part), name);
    },
    [itemsActive, itemsAimTarget, aimOff, thingAimTarget],
  );
  const onAimed = useCallback(
    (hit) => {
      /* С «Предметами» щелчок только выбирает вещь (Shift — ещё одну): инструмент и часть корпуса не меняются. */
      if (itemsActive) {
        itemsPick(hit);
        return;
      }
      const target = aimOff ? null : factoryAimTarget(hit);
      onAim?.(hit, target && thingAimTarget(hit) ? { ...target, item: hit.entity } : target);
    },
    [itemsActive, itemsPick, aimOff, thingAimTarget, onAim],
  );
  const selected = useMemo(() => (aimOff ? null : steadyScope(factoryAimSpec(tool, part))), [aimOff, tool, part]);

  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="interiors"
        ref={stageRef}
        scene={FACTORY_INVENTORY.scene.url}
        look={look}
        frame={frame}
        frameKey={`factory${flight ? `:find${flight.at}` : shot ? `:${shot.tool}${shot.at}` : ""}`}
        edgeFade={ringEdgeFade(asset, true)}
        onScene={(loaded) => {
          setAsset(loaded);
          onAsset?.(loaded);
          warmBounds(loaded);
          onSceneBounds?.(placeBounds(loaded));
        }}
        markup={markup}
        hiddenEntities={hidden}
        onCamera={onCamera}
        onCameraRest={offstage.onCameraRest}
        placing={placing}
        onPlace={placement.onPlace}
        onAdjust={placement.onAdjust}
        {...textStage}
        models={models}
        modelSelection={modelSelection}
        modelHandlers={modelHandlers}
        onAim={onAim ? onAimed : null}
        /* Щелчок по пустому снимает выбор «Предметов»; Shift+щелчок — ещё вещь (подпись у курсора скажет один раз). */
        onMiss={itemsActive ? items?.onClear || null : null}
        multi={itemsActive && Boolean(items?.onToggle)}
        aimTarget={aimTarget}
        /* Наведение на строку «Предметов» светит её вещи; смена инструмента снимает выбор щелчком и наведение (ТЗ 26.10.2026, п. E). */
        hoverSpec={itemsActive ? items?.hoverSpec || null : null}
        resetKey={tool}
        objects={objects}
        objectDrag={objectDrag}
        highlight={focus || (itemsActive ? itemsSelected : selected)}
        label={`Завод в облике работы, ${FACTORY_PLACE.districtLabel}. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`}
      >
        {placing && <EmblemPlacingBar label={placingLabel} onDone={onPlaced} />}
        {overlay}
      </ModelStage>
      {offstage.plate}
      <StageSheetsNote />
    </div>
  );
}
