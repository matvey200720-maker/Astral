/*
 * Кадр редактора маппинга.
 *
 * Выбранное место в 3D на общей матовой плашке редакторов перекраски
 * (`ModelStage`), под студийным светом с тенью; модель медленно вращается.
 * Облик места решает, что в кадре (ТЗ 10.10.2026, задача 16): «как в игре» —
 * штатные модели вашей GTA V на своих местах, листы — из вашей игры
 * (`prepare-mapping-stock.mjs`: в поставке только геометрия и адреса листов);
 * «как в моде» и свой цвет — модели мода с листами автора, цвет — шейдером
 * той же формулой, что у установщика. Места, которого в обычной игре нет
 * (парковку ставит сервер), «как в игре» в кадре нет — вместо него честная
 * подпись. Камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ —
 * вращение, щелчок ПКМ — полёт над местом (W A S D), колесо — приближение.
 * Хлам вокруг (диваны, автобусы) стоит в сцене места как соседство.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { MAPPING_EMBLEM_SIZE, findMappingLocation, mappingEmblemDecals, mappingModePaints, normalizeMappingProject } from "@modovik/climb-contract/recolor/mapping";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import { EmblemPlacingBar, useEmblemPlacement } from "../emblem/emblem-placement.jsx";
import { emblemDecalLooks, useEmblemTextures } from "../emblem/emblem-items.js";
import { useFinishTexture } from "../finish/finish-textures.js";
import useWallOverlay from "../model-stage/useWallOverlay.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { placeBounds, ringDisc, ringEdgeFade } from "../model-stage/ring-fade.js";
import { useSelectionOffstage } from "../model-stage/use-selection-offstage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { useItemShotsFeed, useItemsAim, useWarmEntityBounds } from "../items-panel/use-scene-items.js";
import { useItemLookObjects, useItemSwapDrag } from "../items-panel/item-look-objects.js";
import { MAPPING_FRAME_OF, MAPPING_PLACE_OF, mappingEntityOf, mappingLookGroups, mappingLookHidden } from "./mapping-item-look.js";
import { useItemElementObjects } from "../items-panel/item-elements.js";
import { mappingAimSpec, mappingAimTarget } from "./mapping-aim.js";
import { sceneFingerprint } from "../model-stage/selection-markup-load.js";
import { useSelectionMarkup } from "../model-stage/use-selection-markup.js";
import { MAPPING_VIEW_YAW, mappingSceneRecord } from "./mapping-items.js";
import { mappingFrameLook, mappingSceneOf } from "./mapping-text.js";
import { labelled } from "../model-stage/hover-label.js";
import { steadyScope } from "../model-stage/selection-highlight.js";
import { tr, useTr } from "../../../locales/ui.js";

export default function MappingStage({
  project,
  /* Окно «Студии»: выбранная там поверхность (`{ where }` — какие материалы) подсвечена в кадре поверх выбранного в редакторе. */
  focus = null,
  /* Стена, по которой щёлкнули в кадре (`wall-pick.js`): заливка и контур поверх неё. */
  wall = null,
  locationId,
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
  /* Щелчок по кадру: `onAim(hit, target)` — своя модель (`usePlaceModels().onAim`) или место (`mappingAimTarget`). */
  onAim = null,
  /* Взятый инструмент: «Цвет» и «Места» подсвечивают штрихами место в кадре. */
  tool = "",
  overlay = null,
  /* «Предметы» (ТЗ 26.10.2026, п. A): `{ active, objects, entities, onSelect, found, shots }` — выбор вещи по её номеру в сцене; `onAsset` — сцена
     кадра для панели (рамки вещей, «Найти», снимки). */
  items = null,
  onAsset = null,
}) {
  useTr();
  const wallObjects = useWallOverlay(wall);
  const ownStageRef = useRef(null);
  const placeId = findMappingLocation(locationId)?.id;
  /* Вещи со своим обликом (ТЗ 27.10.2026): на месте записи встаёт своя модель, цвет или картинка, прежней вещи в кадре нет. */
  const lookGroups = useMemo(() => mappingLookGroups(project.items, placeId), [project.items, placeId]);
  /* Копии замен — с номером сцены (`entityOf`): по нему кадр выбирает и обводит вещь, как у её сеток. */
  const lookObjects = useItemLookObjects({ groups: lookGroups, frameOf: MAPPING_FRAME_OF, placeOf: MAPPING_PLACE_OF, entityOf: mappingEntityOf });
  const [asset, setAsset] = useState(null);
  /* Своя картинка на элементах вещей — слоем поверх их листов, сами вещи на месте; ключ работы → номер сетки в сцене места. */
  const elementObjects = useItemElementObjects({ groups: lookGroups, scene: asset, entityOf: mappingEntityOf, placeOf: MAPPING_PLACE_OF });
  const lookHidden = useMemo(() => mappingLookHidden(lookGroups), [lookGroups]);
  const stageObjects = useMemo(() => {
    const list = [...wallObjects, ...lookObjects, ...elementObjects];
    return list.length ? list : wallObjects;
  }, [wallObjects, lookObjects, elementObjects]);
  const stageRef = modelsStageRef || ownStageRef;
  const location = findMappingLocation(locationId);
  const emblemTextures = useEmblemTextures(project.emblems);
  const settings = normalizeMappingProject(project).locations[location?.id];
  const mode = settings?.mode || "stock";
  const scene = mappingSceneOf(location, project);
  /* Свой цвет и отделка парковки — на штатной модели игры (ТЗ 17.10.2026). */
  const stockPainted = mappingModePaints(mode) && Boolean(location?.stockEdit);
  /* Плитка отделки парковки — той же функцией, что пишет лист установщик. */
  const finishTexture = useFinishTexture(location?.stockEdit ? settings : null);
  const textures = useMemo(() => (location && finishTexture ? { [location.id]: finishTexture } : {}), [location, finishTexture]);

  /* Эмблема — наклейкой по миру своего места (та же рамка, что у плашки). */
  const decals = useMemo(() => {
    const looks = emblemDecalLooks(mappingEmblemDecals(project), emblemTextures, (decal) => decal.location === location?.id);
    return looks.length ? looks : null;
  }, [project, emblemTextures, location]);

  const look = useCallback((index, info) => mappingFrameLook(project, info, { decals, textures }), [project, decals, textures]);

  /* Редактор эмблемы — общий у всех редакторов мест; ставит на текущее место. */
  const placement = useEmblemPlacement({
    active: placing,
    onPlace: (place) => onPlace?.({ ...place, location: location?.id }),
    onAdjust,
    sizeRange: MAPPING_EMBLEM_SIZE,
    onDone: onPlaced,
  });

  /* «Найти» вещь: кадр летит к ней, пока взяты «Предметы» и сцена та же; другой инструмент — вид по умолчанию. */
  const flight = items?.active && items.found && items.found.asset === asset ? items.found : null;
  const frame = useCallback(
    (asset) =>
      flight
        ? flight.frame
        : {
            bounds: placeBounds(asset),
            ground: !ringDisc(asset),
            person: true,
            view: { yaw: MAPPING_VIEW_YAW, pitch: 0.46, zoom: 0.66 },
          },
    [flight],
  );
  /* Разметка выделения сцены места (ТЗ 26.10.2026, раздел D): запись сцены набора → файл `.selmap` → кадр. Нет файла — прежний путь. */
  const sceneRecord = useMemo(() => mappingSceneRecord(scene), [scene]);
  const fingerprint = useMemo(() => sceneFingerprint(asset, sceneRecord?.sha256), [asset, sceneRecord]);
  const { markup } = useSelectionMarkup(sceneRecord?.selection, { scene: fingerprint });
  const warmBounds = useWarmEntityBounds();
  const itemsActive = Boolean(items?.active);
  /* Замену выбранной вещи (своя картинка или модель вместо неё) тянут мышью, пока взяты «Предметы» (`useItemSwapDrag`): номер — сцены места. */
  const objectDrag = useItemSwapDrag({ groups: lookGroups, key: itemsActive ? items.selection?.key : null, objects: lookObjects, onMove: items?.onMove, entityOf: mappingEntityOf });
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
   * Что будет править щелчок и наведение. Пока в руке эмблема, левая кнопка ставит
   * её, а у выбранной модели свои ручки — место тогда не выбирается и не светится.
   */
  const handPlacing = placing && location?.placed > 0;
  const aimOff = Boolean(handPlacing) || Boolean(modelSelection?.canEdit);
  /*
   * Выделение (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026): подсвечено то, что правится — место целиком. Щелчок по вещи
   * (не оболочке места) в любом инструменте берёт эту вещь — «Предметы» на ней (`target.item`), под курсором — она одна, с именем.
   */
  const thingsOn = Boolean(items) && !itemsActive && !aimOff;
  const { aimTarget: thingAimTarget } = useItemsAim({ active: thingsOn, things: true, objects: items?.objects, entities: null, asset, onSelect: items?.onSelect, partsOf: items?.partsOf, elementsOf: items?.elementsOf, nameOf: items?.nameOf });
  const aimTarget = useCallback(
    (hit) => {
      if (itemsActive) return itemsAimTarget(hit);
      const target = aimOff ? null : mappingAimTarget(hit, location?.id);
      if (!target) return null;
      /* Подпись у курсора — вещь или место. */
      return thingAimTarget(hit) || labelled(mappingAimSpec(asset, target.location, location?.id), tr(findMappingLocation(target.location)?.title || ""));
    },
    [itemsActive, itemsAimTarget, aimOff, asset, location?.id, thingAimTarget],
  );
  const onAimed = useCallback(
    (hit) => {
      /* С «Предметами» щелчок только выбирает вещь (Shift — ещё одну): инструмент и место не меняются. */
      if (itemsActive) {
        itemsPick(hit);
        return;
      }
      const target = aimOff ? null : mappingAimTarget(hit, location?.id);
      /* Вещь — своего места: опись другого места сменит выбор, туда щелчок ведёт к месту, как прежде. */
      onAim?.(hit, target && target.location === location?.id && thingAimTarget(hit) ? { ...target, item: hit.entity } : target);
    },
    [itemsActive, itemsPick, aimOff, location?.id, thingAimTarget, onAim],
  );
  const selected = useMemo(
    () => (aimOff || !location || tool !== "look" ? null : steadyScope(mappingAimSpec(asset, location.id, location.id))),
    [aimOff, asset, location, tool],
  );

  /* Где место на карте — в строке состояния кадра. */
  const stock = mode === "stock";
  let tail = tr("Издалека место того же цвета: дальние модели и атласы района красятся вместе с ним.");
  if (stock) tail = tr("Издалека — тоже штатное: дальние модели игры не трогаются.");
  else if (stockPainted) tail = tr("Издалека парковка красится вместе с ней: дальние модели района — копией, соседние дома не меняются.");
  else if (location && !location.placed)
    tail = tr("В одиночной игре этих моделей на карте нет — их ставит сервер или они стоят по всей карте, поэтому в кадре они рядом друг с другом.");

  return (
    <div className="fx-stage recolor-stage is-studio">
      {location && scene ? (
        <ModelStage loadKit="terrain" softLoad
          ref={stageRef}
          scene={scene}
          look={look}
          frame={frame}
          edgeFade={ringEdgeFade(asset)}
          frameKey={`${location.id}:${scene}${flight ? `:find${flight.at}` : ""}`}
          onScene={(loaded) => {
            setAsset(loaded);
            warmBounds(loaded);
            onAsset?.(loaded);
            onSceneBounds?.(placeBounds(loaded));
          }}
          onCamera={onCamera}
          onCameraRest={offstage.onCameraRest}
          placing={Boolean(handPlacing)}
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
          markup={markup}
          hiddenEntities={lookHidden}
          /* Наведение на строку «Предметов» светит её вещи; смена инструмента снимает выбор щелчком и наведение (ТЗ 26.10.2026, п. E). */
          hoverSpec={itemsActive ? items?.hoverSpec || null : null}
          resetKey={tool}
          objects={stageObjects}
          objectDrag={objectDrag}
          highlight={focus || (itemsActive ? itemsSelected : selected)}
          label={`${tr(location.title)} ${stock ? tr("как в игре") : tr("в облике работы")}. ${tr("Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт")}.`}
        >
          {placing && <EmblemPlacingBar label={placingLabel} onDone={onPlaced} />}
          {overlay}
        </ModelStage>
      ) : location ? (
        /* Пустой кадр — одна строка (п. 14 `design-qa.md`), почему и что выбрать — в подсказке. */
        <p className="model-stage-note" title={`${tr("В одиночной игре этого места нет — его ставит сервер своей моделью, Astral её не трогает.")} ${tr("Выберите модели мода или свой цвет.")}`}>
          {tr("Этого места нет в одиночной игре")}
        </p>
      ) : null}
      {/* Выбора места на кадре нет: место выбирают списком «Места мода» в колонке (п. 6 `design-qa.md`, повтор). */}
      <StageNote>{tail}</StageNote>
      <StageSheetsNote />
      {offstage.plate}
    </div>
  );
}
