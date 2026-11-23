/*
 * Кадр редактора арены.
 *
 * Арена выбранного сервера — стандартная: у GTA 5 RP штатные модели и листы
 * игры игрока, у Majestic — стандартная арена сервера, — на общей матовой
 * плашке редакторов перекраски (`ModelStage`). Камера — общая на всю
 * мастерскую (`stage-camera.js`). «Снаружи» — Maze Bank Arena с площадью,
 * медленно вращается, эмблему ставят прямо на фасад общим редактором
 * эмблемы. «Внутри» — главный зал без подвала: глаз стоит в зале и
 * оглядывается; щелчок ПКМ — полёт по залу (W A S D), и сквозь стены он не
 * проходит.
 *
 * Своя картинка в местах и цвет знаков выхода — составными листами
 * (`arena-composites.js`, тот же расчёт, что у установщика). Другая модель
 * кресел встаёт на места кресел зала (копиями той же модели из игры игрока,
 * низом на пол), своя звезда — сеткой из картинки на подставке и с
 * движением; пока звезду правят, взгляд плавно подходит к ней.
 *
 * Рабочий свет (ТЗ владельца 29.10.2026, п. 3.3) — в зале любого сервера всегда: фон поднят до кадра без ламп, нейтральный
 * белый свет из-за плеча камеры (`orbit-stage.js`, `setWorkLight`), цвета листов те же, читается форма. Пока держат «Как в
 * игре» в шапке (`comparing`), он гаснет — сравнение показывает зал со светом игры. Переключателя на кадре нет (владелец,
 * 29.10 вечер: «не нужна»); снаружи свет — по часу суток.
 *
 * Части предмета (ТЗ 29.10.2026, вечер: «один плакат можешь выбрать и заменить его сам»): у предмета, модель которого — набор
 * (десяток баннеров, звезда с флажками, шесть картинок), щелчок и наведение берут часть под курсором (`arena-item-parts.js`,
 * считает поток после показа сцены), двойной щелчок — предмет целиком. Пока части считаются, предмет — целиком.
 *
 * Внизу правой колонки (п. 3.1) — только предупреждение без Astral Desktop: откуда модели и листы, кадру знать не нужно.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import {
  ARENA_EMBLEM_SIZE,
  arenaChairLift,
  arenaEmblemDecals,
  arenaPlazaEnabled,
  arenaScene,
  arenaServerInventory,
  arenaSlotElements,
} from "@modovik/climb-contract/recolor/arenas";
import { arenaObjectModel, arenaObjectOf, arenaObjectScope } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaItemPlace } from "@modovik/climb-contract/recolor/arena-item-looks";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageBusy, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useStageSwitch } from "../../../components/ui/stage-switch.js";
import { EMBLEM_PLACING_HINT, EmblemPlacingBar, useEmblemPlacement } from "../emblem/emblem-placement.jsx";
import { useFinishTexture } from "../finish/finish-textures.js";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { textureAvailable } from "../model-stage/scene-textures.js";
import { focusFrame } from "../model-stage/focus-frame.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { boxProxy, disposeProxies, meshProxy, steadyScope } from "../model-stage/selection-highlight.js";
import { emblemDecalLooks, useEmblemTextures } from "../emblem/emblem-items.js";
import {
  cullArenaPanelSides,
  splitArenaCloths,
  useArenaComposites,
  useArenaCoverObjects,
  useArenaPanelObjects,
  useArenaPictures,
  useArenaSignObjects,
} from "./arena-composites.js";
import { arenaAimTarget, arenaHitIsland } from "./arena-aim.js";
import { arenaPickRoute } from "./arena-pick.js";
import { splitArenaParts, withParts } from "./arena-parts.js";
import { ARENA_DAY, ARENA_HOURS, arenaStageDaylight } from "./arena-daylight.js";
import { loadArenaSkyValues } from "./arena-sky-values.js";
import { detectLegacyGame } from "../install-queue/game-root.js";
import { useRememberedState } from "../../../section-memory.js";
import { cupBoxes, cupElementScene, cupHallKeys, cupInstanceList, cupMeshes } from "./arena-cups.js";
import { shellPaintOf, shellRoomKey } from "./arena-shell-paint.js";
import { itemSpec } from "./arena-items.js";
import { arenaElementAt, arenaItemName, arenaItemParts, arenaPartAt, arenaPartSpec, arenaWholeKeys } from "./arena-item-parts.js";
import { useSelectionOffstage } from "../model-stage/use-selection-offstage.jsx";
import { subscribeItemParts, warmItemParts } from "../items-panel/item-parts.js";
import { sceneFingerprint } from "../model-stage/selection-markup-load.js";
import { useSelectionMarkup } from "../model-stage/use-selection-markup.js";
import { ARENA_AMBIENT, arenaLamps } from "./arena-lamps.js";
import { useArenaHighlight } from "./arena-highlight.js";
import { arenaReplacedFiles, useArenaReplacementObjects } from "./arena-replace-objects.js";
import { arenaItemKeys, useArenaItemObjects } from "./arena-item-objects.js";
import { useItemSwapDrag } from "../items-panel/item-look-objects.js";
import { useItemElementObjects } from "../items-panel/item-elements.js";
import { ARENA_VIEW_OPTIONS, arenaFrameLook, arenaPortalFocus, arenaStarFocus, arenaStelaFocus, throughScreenGrain } from "./arena-text.js";
import { prepareFinishWalls } from "./arena-finish-walls.js";
import { useArenaStarObject, useStarPixels } from "./arena-star-preview.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useItemShotsFeed, useWarmEntityBounds } from "../items-panel/use-scene-items.js";

/* Камера крупно у места снаружи: вращение модели стоит, чтобы место было видно. */
const CLOSE_FOCUS = new Set(["portal", "stela"]);

/* Части сцены «снаружи», что видны из зала через стёкла: земля площади и окрестности (фасад — у самого зала). */
const WORLD_PARTS = Object.freeze(["plaza", "outside"]);

export default function ArenaStage({
  project,
  view: askedView,
  onView,
  focus = null,
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
  overlay = null,
  /* Нажатие колеса и щелчок (ТЗ 11.10.2026, ночь): `onAim(hit, route)` — что под курсором
     (`arenaPickRoute`: предмет зала, инструмент вещи или ничего), `highlight` — `{ section, key }` взятого элемента: рамка
     вокруг его полотна в кадре. */
  onAim = null,
  highlight = null,
  /* Взятый инструмент раздела: его сетки в кадре подсвечиваются штрихами. */
  tool = "",
  /*
   * «Предметы зала» (задача 10, 18.10.2026): `items` — `{ active, key, scope, piece, entities, focus, hidden }`: пока инструмент
   * взят, щелчок и наведение выбирают предмет по номеру сущности (охват — один, все такие, всё сразу), выбранные
   * сущности обведены, `focus` — куда лететь камере. `piece` — номер части выбранного предмета (`arena-item-parts.js`) или
   * `null` — предмет целиком; у щелчка по предмету из частей номер части под курсором — поле `hit.piece` (скрытое) в `onAim`.
   * `onShow()` — подлететь к выбранному (плашка «… за кадром · Показать», клавиша F). `onAsset` — сцена кадра (рамки сущностей).
   */
  items = null,
  onAsset = null,
  /* Кадры предметов для панели «Предметы»: сцена отдаёт им снимок (`items-panel/item-shots.js`). */
  shots = null,
  /* Держат «Как в игре» (`useRecolorEditor().comparing`): рабочий свет гаснет, зал — со светом игры. */
  comparing = false,
  /* Камера снаружи, подведённая к выбранному из меню (`arena-camera.js`): `{ centre, yaw, pitch, distance, at }`; изнутри такой перелёт идёт как «Найти в зале» (`items.focus`). */
  closeUp = null,
  /* «Вернуть камеру» изнутри: число выросло — глаз домой (`ModelStage.insideHome`); снятый фокус камеру не уводит. */
  cameraHome = 0,
}) {
  useTr();
  const ownStageRef = useRef(null);
  const warmBounds = useWarmEntityBounds();
  const stageRef = modelsStageRef || ownStageRef;
  const [chairs, setChairs] = useState(null);
  /* Кубки и шлемы (`{ server, asset }`): сцена повторов сервера, своя для каждого сервера. */
  const [cupAsset, setCupAsset] = useState(null);
  /* Мир за стёклами зала (GTA5RP): площадь и окрестности арены — сцена «снаружи», что стоит копией на своём месте. */
  const [world, setWorld] = useState(null);
  const server = project.server;
  const settings = project[server];
  /* Части предметов считает поток, пока человек смотрит на зал (`warmItemParts`), с местом предмета — по правилу установки; оболочка зала на части не делится. */
  const partsCancel = useRef(() => {});
  useEffect(() => () => partsCancel.current(), []);
  const warmParts = useCallback(
    (loaded) => {
      partsCancel.current();
      partsCancel.current = warmItemParts(loaded, { skip: arenaWholeKeys(server), placeOf: (key) => arenaItemPlace(server, key) });
    },
    [server],
  );
  const inventory = arenaServerInventory(server);
  /* «Внутри / Снаружи» — другая сцена, её сетки и предметы: сперва «Обновляю…», потом пересборка (19.10.2026). */
  const viewSwitch = useStageSwitch(askedView, (next) => Boolean(arenaScene(server, next)?.url && stageRef.current?.hasScene?.(arenaScene(server, next).url)));
  const view = viewSwitch.value;
  const inside = view === "inside";
  /* Снаружи — свет по часу суток игры (`arena-daylight.js`); внутри зал светят лампы игры, час туда не идёт. */
  const [hour, setHour] = useRememberedState("arenas:hour", ARENA_DAY);
  const [skyValues, setSkyValues] = useState(null);
  useEffect(() => {
    if (inside) return undefined;
    let live = true;
    detectLegacyGame()
      .catch(() => "")
      .then((root) => loadArenaSkyValues(root))
      .then((values) => {
        if (live && values) setSkyValues(values);
      });
    return () => {
      live = false;
    };
  }, [inside]);
  const daylight = useMemo(
    () => (inside ? null : arenaStageDaylight((ARENA_HOURS.find((item) => item.id === hour) || ARENA_HOURS[1]).hour, skyValues)),
    [inside, hour, skyValues],
  );
  const hourOptions = ARENA_HOURS.map((item) => ({ value: item.id, label: tr(item.label) }));
  const scene = arenaScene(server, view);
  const [asset, setAsset] = useState(null);
  /* Разметка выделения сцены (раздел D ТЗ 26.10.2026): запись `selection` у сцены арены; у сцены без неё и без файла — прежний путь. */
  const fingerprint = useMemo(() => (scene?.sha256 ? sceneFingerprint(asset, scene.sha256) : null), [asset, scene?.sha256]);
  const { markup } = useSelectionMarkup(scene?.selection, { scene: fingerprint });
  /* Свет зала — лампы моделей игры из сцены (у сцен без ламп — пусто). */
  const lamps = useMemo(() => (inside ? arenaLamps(asset) : null), [inside, asset]);

  /* Отделка поверхностей, свои картинки в местах и знаки выхода. */
  const facade = useFinishTexture(settings.facade);
  const floor = useFinishTexture(settings.floor);
  const walls = useFinishTexture(settings.walls);
  const ceiling = useFinishTexture(settings.ceiling);
  const finishes = useMemo(() => ({ facade, floor, walls, ceiling }), [facade, floor, walls, ceiling]);
  /* Снаружи у GTA5RP свои составные листы — надпись, логотип и баннеры фасада. */
  const images = useArenaPictures(project);
  /* Снаружи GTA5RP — полотна у арок своими материалами (задача 10). */
  /* Внутри — ткань с двух сторон без мерцания (односторонний материал лица и изнанки); у Majestic — стены, пол и потолок под свою картинку
     по разметке стен сцены (`arena-finish-walls.js`): сцена встаёт уже с ней. */
  const prepare = useMemo(
    () =>
      inside
        ? async (loaded) => splitArenaParts(cullArenaPanelSides(await prepareFinishWalls(throughScreenGrain(loaded), server), server), server)
        : server === "gta5rp"
          ? (loaded) => splitArenaCloths(loaded, server, scene?.origin)
          : null,
    [server, inside, scene?.origin],
  );
  const composites = useArenaComposites({ asset, project, server, images });
  /* Своё на месте объёмных букв, щита и знака над главным входом — плашками. */
  const covers = useArenaCoverObjects({ project, server, images });
  /* Полотна со своим видом — плашками поверх листа (в зале). */
  const panels = useArenaPanelObjects({ project, server, images, active: inside });
  const frameOf = useArenaHighlight({ server, highlight: inside ? highlight : null, asset });
  /* Что будет править щелчок и наведение: лист (или один остров листа), а плашка — сама (обводится штрихами, как всё выбранное). */
  const itemsActive = Boolean(items?.active);
  const itemsScope = items?.scope || "one";
  /* Кубки матрицами, когда их сцена на месте (см. ниже, `hiddenEntities`). */
  const cupPlaces = inventory?.cups?.places;
  const cupsLive = Boolean(inside && cupPlaces?.length && cupAsset?.server === server);
  /* Кубки в мире — подсветка выбранного и наведения (`proxies` спецификации) их подробной сеткой из сцены повторов: контур и штрихи по форме кубка,
     а не коробкой (владелец 01.11.2026: «контур обновить»); сетки нет — коробка. Гасятся при смене сцены. */
  const cupProxies = useMemo(() => {
    if (!cupsLive) return new Map();
    return new Map([...cupBoxes(cupPlaces, cupAsset.asset.parts)].map(([key, box]) => [key, meshProxy(cupMeshes(cupAsset.asset, cupPlaces, key)) || boxProxy(box)]));
  }, [cupsLive, cupPlaces, cupAsset]);
  useEffect(() => () => disposeProxies([...cupProxies.values()]), [cupProxies]);
  /* Подсветка вещей зала: логические сетки, что в кадре, и коробки копий матрицами (кубки). */
  const itemHighlight = useCallback(
    (entities, scope, material = null, part = null) => {
      const base = itemSpec(entities, asset, scope, material, part);
      const proxies = entities ? [...entities].map((key) => cupProxies.get(key)).filter(Boolean) : [];
      if (!proxies.length) return base;
      if (base.none) return { proxies };
      return { ...base, proxies: [...(base.proxies || []), ...proxies] };
    },
    [asset, cupProxies],
  );
  /*
   * Что обводит наведение и щелчок — то, что щелчок откроет (`arena-pick.js`): предмет зала — он один («Только этот», а не охват, что остался от прошлого
   * выбора); вещь со своим инструментом — её лист или кусок листа; своя плашка кадра — она сама. Оболочка в «Предметах зала» — по материалу, как была.
   */
  /* Описание цели наведения с подписью у курсора; пустое имя — без подписи. */
  const named = (spec, label) => (spec && label ? { ...spec, label } : spec);
  const aimTarget = useCallback(
    (hit) => {
      if (!asset && !hit?.pick) return null;
      const route = arenaPickRoute(server, asset, hit, { tool });
      if (!route) return null;
      /* Плашка — своя вещь кадра: обводится сама (контур), не лист под ней. */
      if (hit.pick) return { objects: true, where: (_info, mesh) => mesh.userData.pick === hit.pick };
      if (route.kind === "item") {
        /* Стена (оболочка): наведение берёт её материал, а не всю оболочку. */
        const structure = arenaObjectModel(server, route.entity)?.kind === "structure";
        const scope = structure && itemsActive ? itemsScope : "one";
        /* Вариант A разбора 31.10.2026: у вещи, что уже выбрана, под курсором — то, что возьмёт второй щелчок: элемент (лист модели) или часть
           (баннер из десятка); у остальных и в наборе (Shift) — вещь целиком, её берёт щелчок. Имя — подписью у курсора (`label`, `StageHoverTip`). */
        if (scope === "one" && !route.material && itemsActive && items?.key === route.entity && !(items?.keys?.length > 1)) {
          const texture = arenaElementAt(asset, server, hit);
          if (texture) return named(itemHighlight(new Set([route.entity]), "one", texture), arenaItemName(server, route.entity, null, asset, texture));
          const piece = arenaPartAt(asset, server, hit);
          if (piece !== null) return named(arenaPartSpec(asset, route.entity, arenaItemParts(asset, server, route.entity)[piece]), arenaItemName(server, route.entity, piece, asset));
        }
        /* У монитора наведение показывает то, на что наведено: экран или корпус (`itemPartOf`). */
        return named(itemHighlight(arenaObjectScope(server, route.entity, scope), scope, route.material, route.part), arenaItemName(server, route.entity, null, asset));
      }
      const island = arenaHitIsland(server, asset, hit);
      /* Подсвечено то, что правится (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026: «я выделил одно это, а у меня покрасилось всё»):
         лист (или его остров) везде, где он лежит, а не один предмет под курсором; подпись — элемент раздела (табло, экран). */
      const key = route.target?.key;
      const element = key ? arenaSlotElements(server, route.tool).find((item) => item.key === key) : null;
      return named({ materials: [hit.material], ...(island ? { uvRects: [island] } : {}) }, element?.label || "");
    },
    [server, asset, tool, itemsActive, itemsScope, itemHighlight, items?.key, items?.keys],
  );
  /* Выбранное: у элемента — его обводка (`frameOf`), иначе все листы взятого инструмента. */
  const itemEntities = items?.entities || null;
  /* Выбрана часть предмета (`items.piece`): её части могли ещё считаться (другая сцена того же зала) — кадр ждёт их и обводит часть, когда
     поток их принёс; пока нет — предмет целиком. Подписка будит кадр только на «части этого предмета готовы», а не на каждую порцию. */
  const pieceKey = itemsActive && itemsScope === "one" && Number.isInteger(items?.piece) && Number.isInteger(items?.key) ? items.key : null;
  const pieceReady = useSyncExternalStore(subscribeItemParts, () => pieceKey === null || !asset || arenaItemParts(asset, server, pieceKey) !== null);
  const selected = useMemo(() => {
    if (!asset || modelSelection?.canEdit) return null;
    if (itemsActive) {
      if (!itemEntities?.size) return null;
      const part = pieceKey !== null ? arenaItemParts(asset, server, pieceKey)?.[items.piece] : null;
      if (part) return arenaPartSpec(asset, pieceKey, part);
      return itemHighlight(itemEntities, itemsScope, items?.material || null, items?.part || null);
    }
    if (frameOf) return frameOf;
    if (!tool) return null;
    /* Все листы инструмента — и после щелчка: правка ложится на них все (п. 7). */
    return steadyScope({ where: (_info, mesh) => arenaAimTarget(server, asset, { material: mesh.userData.material })?.tool === tool });
    /* `pieceReady` — не значение, а повод: части выбранного предмета пришли из потока, выбор пересобирается. */
  }, [asset, server, tool, frameOf, modelSelection?.canEdit, itemsActive, itemEntities, itemsScope, itemHighlight, items?.material, items?.part, items?.piece, pieceKey, pieceReady]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * Выбранное за кадром (ТЗ 29.10.2026, вечер): «Найти в зале» отдельной кнопкой нет — камера подлетает сама, когда вещь выбрали справа; F и
   * плашка «… за кадром · Показать» — общие у кадров с «Предметами» (`model-stage/use-selection-offstage.jsx`).
   */
  const watchKey = itemsActive && inside && Number.isInteger(items?.key) ? items.key : null;
  const watchPiece = watchKey !== null && itemsScope === "one" && Number.isInteger(items?.piece) ? items.piece : null;
  const watchPart = watchPiece !== null ? arenaItemParts(asset, server, watchKey)?.[watchPiece] || null : null;
  const offstage = useSelectionOffstage({
    stageRef,
    asset,
    target: watchKey !== null ? { key: watchKey, part: watchPart } : null,
    name: watchKey !== null ? arenaItemName(server, watchKey, watchPiece, asset, items?.material || null) : "",
    onShow: items?.onShow || null,
  });
  /* Модели сервера своими (Majestic): прежние спрятаны, свои — на их местах. */
  const replaced = useMemo(() => (inside ? arenaReplacedFiles(server, settings) : null), [inside, server, settings]);
  const replacements = useArenaReplacementObjects({ server, settings, active: inside });
  /* Предметы зала со своей моделью, цветом или картинкой — на своих местах; прежних в кадре нет. */
  const itemLooks = useArenaItemObjects({ server, settings, active: inside });
  /*
   * Замену выбранной вещи (своя картинка или модель вместо неё) тянут мышью (владелец 01.11.2026): пока тянут, копия едет в кадре вживую, отпустили —
   * сдвиг уходит в облик (`items.onMove`), и копия пересобирается на новом месте. Общее с местами (`useItemSwapDrag`).
   */
  const objectDrag = useItemSwapDrag({ groups: settings.items, key: inside ? items?.key : null, objects: itemLooks, onMove: items?.onMove });
  /* Как стоит вещь зала: лицо обёртки картинки на её элементе — то же, что у установщика (`itemElementFront`). */
  const arenaPlaceOf = useCallback((key) => arenaItemPlace(server, key), [server]);
  /* Своя картинка на элементах предметов — слоем поверх их листов; сами предметы на месте (`item-elements.js`). */
  /* Кубки с картинкой на элементах — слой по их подробной сетке из сцены повторов, той, что видна в кадре (`cupElementScene`). */
  const elementCupKeys = useMemo(() => {
    if (!cupsLive) return "";
    const cups = new Set(cupHallKeys(cupPlaces));
    const keys = (settings.items || []).filter((group) => group.kind === "elements").flatMap((group) => group.keys);
    return [...new Set(keys.filter((key) => cups.has(key)))].sort((a, b) => a - b).join(",");
  }, [cupsLive, cupPlaces, settings.items]);
  const elementScene = useMemo(
    () => (inside && asset ? cupElementScene(asset, cupsLive ? cupAsset.asset : null, cupPlaces, new Set(elementCupKeys ? elementCupKeys.split(",").map(Number) : [])) : null),
    [inside, asset, cupsLive, cupAsset, cupPlaces, elementCupKeys],
  );
  const elementLooks = useItemElementObjects({ groups: settings.items, scene: elementScene, active: inside, placeOf: arenaPlaceOf });
  /* Своя надпись на домике (Majestic) — плашками на месте букв сервера. */
  const signs = useArenaSignObjects({ project, server, images, active: inside });
  const emblemTextures = useEmblemTextures(settings.emblems);
  const decals = useMemo(() => {
    if (inside) return null;
    const looks = emblemDecalLooks(arenaEmblemDecals(project), emblemTextures);
    return looks.length ? looks : null;
  }, [project, emblemTextures, inside]);

  /* Облик стены в комнате (`room`) — с её покраской (раздел `shellPaint`); общие материалы без комнаты — как были. */
  const shellPaint = project?.[server]?.shellPaint || null;
  const look = useCallback(
    (index, info, room) => {
      const base = arenaFrameLook(project, server, info, { finishes, composites, decals, replaced });
      const paint = room ? shellPaintOf(shellPaint, room, info.name) : null;
      return paint ? { ...base, paint } : base;
    },
    [project, server, finishes, composites, decals, replaced, shellPaint],
  );
  /* Комната стены сетки — только у стен зала (оболочки): вещи и остальное в одной пачке, как прежде. */
  const meshRooms = useCallback(
    (mesh) => {
      if (!Number.isInteger(mesh.entity) || arenaObjectModel(server, mesh.entity)?.kind !== "structure") return null;
      return shellRoomKey(arenaObjectOf(server, mesh.entity)?.room);
    },
    [server],
  );

  /* Кресла другой модели — копии на местах кресел зала (GTA5RP). */
  const chairModel = server === "gta5rp" && settings.seats?.mode !== "hidden" ? settings.seats?.model || "stadium" : "stadium";
  useEffect(() => {
    if (chairModel === "stadium" || chairs) return undefined;
    let cancelled = false;
    loadSceneAsset(arenaScene("gta5rp", "chairs").url)
      .then((loaded) => !cancelled && setChairs(loaded))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chairModel, chairs]);
  /* Кадры предметов: сетки вещи своим рендером по её рамке (`snapshotItemPixels`, без второго контекста); кодирует поток. Снимают, когда листы пришли. */
  useItemShotsFeed(shots, stageRef, asset);
  /* Мир снаружи грузится, когда зал уже на экране: заставка не ждёт его, а через стёкла он виден сразу после. */
  const worldWanted = inside && server === "gta5rp" && Boolean(asset);
  useEffect(() => {
    if (!worldWanted || world) return undefined;
    let cancelled = false;
    /* Та же сцена — потом вид «Снаружи» с мягким краем: поле контура поток считает сразу (`edge-field.js`). */
    loadSceneAsset(arenaScene("gta5rp", "outside").url, { footprint: true })
      .then((loaded) => !cancelled && setWorld(loaded))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [worldWanted, world]);
  /* Кубки и шлемы — сцена повторов сервера (опись `cups`): грузится, когда зал на экране. Нет сцены — кубки остаются в зале. */
  const cupsWanted = Boolean(inside && inventory?.cups?.places?.length);
  const cupsServer = cupAsset?.server;
  useEffect(() => {
    const scene = arenaScene(server, "cups");
    if (!cupsWanted || !scene || cupsServer === server) return undefined;
    let cancelled = false;
    loadSceneAsset(scene.url)
      .then((loaded) => !cancelled && setCupAsset({ server, asset: loaded }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cupsWanted, server, cupsServer]);
  const sceneInstances = useMemo(() => {
    const out = [];
    if (inside && chairModel !== "stadium" && chairs) {
      const places = inventory?.interior?.chairPlaces || [];
      const lift = arenaChairLift(chairModel);
      const matrices = new Float32Array(places.length * 16);
      const matrix = new THREE.Matrix4();
      places.forEach(([x, y, z, qx, qy, qz, qw], index) => {
        matrix.compose(new THREE.Vector3(x, y, z + lift), new THREE.Quaternion(qx, qy, qz, qw), new THREE.Vector3(1, 1, 1));
        matrix.toArray(matrices, index * 16);
      });
      out.push({ asset: chairs, part: chairModel, matrices });
    }
    if (worldWanted && world) {
      /* Обе сцены сняты от своей точки мира: сцена «снаружи» встаёт в зал сдвигом на разницу точек. */
      const shift = arenaScene("gta5rp", "outside").origin.map((value, axis) => value - arenaScene("gta5rp", "inside").origin[axis]);
      const matrices = new THREE.Matrix4().makeTranslation(shift[0], shift[1], shift[2]).toArray();
      for (const part of WORLD_PARTS) out.push({ asset: world, part, matrices: Float32Array.from(matrices) });
    }
    return out.length ? out : null;
  }, [inside, chairModel, chairs, inventory, worldWanted, world]);
  const parts = useMemo(() => {
    if (!asset || !inside || chairModel === "stadium") return null;
    return asset.parts.map((part, index) => ((part.id ?? part) === "seats" ? -1 : index)).filter((index) => index >= 0);
  }, [asset, inside, chairModel]);

  /* Звезда GTA5RP: своя картинка — сеткой с движением. */
  const starSettings = server === "gta5rp" ? settings.star : null;
  const starUrl = useHangarEmblemUrl(starSettings?.mode === "image" ? starSettings.image.asset : "");
  const starPixels = useStarPixels(starUrl);
  const star = useArenaStarObject({
    pixels: inside ? starPixels : null,
    place: inventory?.star?.point || null,
    yaw: inventory?.star?.yaw || 0,
    settings: starSettings,
  });
  const objects = useMemo(() => {
    const list = [...(star ? [star] : []), ...(inside ? [...panels, ...replacements, ...itemLooks, ...elementLooks, ...signs] : covers)];
    return list.length ? list : null;
  }, [star, covers, panels, replacements, itemLooks, elementLooks, signs, inside]);
  const itemFocus = items?.focus || null;
  /* Вещи зала, которых в кадре нет: убранные из игры (работа) и спрятанные на посмотреть (`items.hidden`). */
  const hiddenItems = items?.hidden || null;
  /* Убранные галочкой группы (автоматы, банкоматы, паркоматы, кола, кресла «Убрать») уходят вещами целиком — теми же записями
     интерьера, что и в установке, а не скрытием листа: ни белых пятен, ни обводки, ни тени там, где они стояли (ТЗ 44А). */
  const groupObjects = settings.objects;
  const goneByGroup = useMemo(() => {
    const interior = inventory?.interior;
    if (!inside || server !== "gta5rp" || !interior) return [];
    return [
      ...(groupObjects?.vending === "hide" ? interior.vending?.entities || [] : []),
      ...(groupObjects?.atms === "hide" ? interior.atms?.entities || [] : []),
      ...(groupObjects?.parking === "hide" ? interior.parking?.entities || [] : []),
      ...(settings.sprites?.cola === "hide" ? interior.cola?.entities || [] : []),
      ...(settings.seats?.mode === "hidden" ? interior.chairs?.entities || [] : []),
    ];
  }, [inside, server, inventory, groupObjects, settings.sprites, settings.seats]);
  /* Кубки и шлемы матрицами — когда их сцена на месте (`cupsLive`). Скрытые вещи выпадают поштучно (`userHidden`), а копии в зале
     прячутся целиком: иначе кубок стоял бы дважды. Пока сцены нет, кубки остаются в зале, как прежде. */
  const hallCupKeys = useMemo(() => (cupsLive ? cupHallKeys(cupPlaces) : []), [cupsLive, cupPlaces]);
  const cupInstances = useMemo(() => {
    if (!cupsLive) return null;
    const userHidden = new Set([...(settings.removed || []), ...arenaItemKeys(settings, server), ...(hiddenItems || [])]);
    return cupInstanceList(cupPlaces, cupAsset.asset, userHidden);
  }, [cupsLive, cupPlaces, cupAsset, settings, server, hiddenItems]);
  const instances = useMemo(() => {
    const list = [...(sceneInstances || []), ...(cupInstances || [])];
    return list.length ? list : null;
  }, [sceneInstances, cupInstances]);
  const hiddenEntities = useMemo(() => {
    if (!inside) return null;
    /* Убранная вещь и вещь со своим обликом уходят из кадра вместе со своими частями: в игре её сущность пропала или смотрит на копию без ковриков (`recolor-arenas.js`). */
    const list = withParts(server, new Set([...(settings.removed || []), ...arenaItemKeys(settings, server), ...(hiddenItems || []), ...goneByGroup, ...hallCupKeys]));
    return list.length ? list : null;
  }, [inside, server, settings, hiddenItems, goneByGroup, hallCupKeys]);
  const insideFocus = useMemo(() => {
    if (inside && itemFocus) return itemFocus;
    if (!inside || focus !== "star" || !inventory?.star || !starSettings) return null;
    return arenaStarFocus(inventory.view?.inside, inventory.star, starSettings, star?.standHeight || 0);
  }, [inside, focus, inventory, starSettings, star, itemFocus]);

  const frame = useCallback(
    (loaded) => {
      if (inside)
        return {
          bounds: loaded.bounds,
          ground: false,
          inside: { ...(inventory?.view?.inside || { eye: [0, 0, 1.7], yaw: 0, pitch: 0 }), fov: 72 },
          lighting: "interior",
          /* Зал с лампами игры светит ими: фон тише, чтобы пятна света читались. */
          ambient: loaded.lamps?.length ? ARENA_AMBIENT : 1,
        };
      /* Снаружи камера стоит со стороны эмблемы по умолчанию, чуть сбоку;
         у надписи и логотипа стел — у ближней стелы крупно. */
      const shell = loaded.parts.find((item) => item.id === "facade");
      const normal = inventory?.decal?.normal || [0, -1, 0];
      const yaw = Math.atan2(normal[0], -normal[1]) + 0.35;
      const bounds = shell?.bounds || loaded.bounds;
      /* Выбрано из меню (полотно у арки, место): камера летит к нему, лицом к лицу, и человек крутит дальше сам. Метры в приближение орбиты и
         линию взгляда (не закрыто ли полотно) считает общий фокус кадра (`model-stage/focus-frame.js`). */
      if (closeUp) {
        const focused = focusFrame({ point: closeUp.centre, yaw: closeUp.yaw, pitch: closeUp.pitch, distance: closeUp.distance }, bounds);
        if (focused) return { bounds, ground: true, zoomRange: [0.015, 2.8], ...focused };
      }
      const stela = focus === "stela" ? arenaStelaFocus(loaded, inventory, yaw) : null;
      if (stela) return { bounds, ground: true, centre: stela.centre, zoomRange: [0.03, 2.8], view: { yaw: stela.yaw + 0.3, pitch: 0.1, zoom: 0.075 } };
      const portal = focus === "portal" ? arenaPortalFocus(server) : null;
      if (portal) return { bounds, ground: true, centre: portal.centre, zoomRange: [0.03, 2.8], view: { yaw: portal.yaw + 0.25, pitch: 0.12, zoom: 0.14 } };
      return { bounds, ground: true, view: { yaw, pitch: 0.36, zoom: 0.62 } };
    },
    [inside, inventory, focus, server, closeUp],
  );

  /* Эмблема ставится на фасад и на площадь (Majestic, 21.11.2026: «эмблему наклеить на пол») — общим редактором эмблемы. */
  const onFacade = useCallback((hit) => (arenaPlazaEnabled() ? ["facade", "plaza"] : ["facade"]).includes(asset?.parts[hit?.part]?.id), [asset]);
  const placement = useEmblemPlacement({
    active: Boolean(placing) && !inside,
    onPlace: (place) => onPlace?.(place),
    onAdjust: (update, label) => onAdjust?.(update, label),
    sizeRange: ARENA_EMBLEM_SIZE,
    accept: onFacade,
    onDone: onPlaced,
  });

  const label = inside
    ? tr("Зал арены изнутри в облике работы: мышь или стрелки — оглядеться, правая кнопка — полёт по залу, нажатие колеса — править то, что под курсором.")
    : tr("Арена снаружи в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт, нажатие колеса — править то, что под курсором.");

  return (
    <div className="fx-stage recolor-stage is-studio" data-backdrop={inside ? "daylight" : undefined}>
      {scene ? (
        <ModelStage loadKit="hall"
          ref={stageRef}
          loadTitle={tr("Открываю арену {0}").replace("{0}", server === "majestic" ? "Majestic" : "GTA 5 RP")}
          scene={scene.url}
          markup={markup}
          look={look}
          meshRooms={meshRooms}
          parts={parts}
          hiddenEntities={hiddenEntities}
          frame={frame}
          frameKey={`${server}:${view}${CLOSE_FOCUS.has(focus) && !inside ? `:${focus}` : ""}${closeUp && !inside ? `:close${closeUp.at}` : ""}`}
          edgeFade={!inside}
          daylight={daylight}
          workLight={inside && !comparing}
          objectDrag={objectDrag}
          onScene={(loaded) => {
            setAsset(loaded);
            warmBounds(loaded);
            warmParts(loaded);
            onAsset?.(loaded);
            onSceneBounds?.(loaded.bounds);
          }}
          prepare={prepare}
          onCamera={onCamera}
          onCameraRest={offstage.onCameraRest}
          instances={instances}
          objects={objects}
          insideFocus={insideFocus}
          insideHome={cameraHome}
          placing={Boolean(placing) && !inside}
          onPlace={placement.onPlace}
          onAim={
            onAim
              ? (hit) => {
                  /* Щелчок по предмету из частей — номер части под курсором едет с попаданием (скрытым полем, как сетка и треугольник). */
                  const piece = arenaPartAt(asset, server, hit);
                  if (piece !== null && Object.isExtensible(hit)) Object.defineProperty(hit, "piece", { value: piece });
                  onAim(hit, arenaPickRoute(server, asset, hit, { tool }));
                }
              : null
          }
          /* Щелчок по пустому снимает выбор «Предметов зала» и своей модели; Shift+щелчок — ещё предмет (подпись у курсора скажет один раз). */
          onMiss={itemsActive ? items?.onClear || null : modelSelection?.canEdit ? modelHandlers?.onDeselect || null : null}
          multi={itemsActive && Boolean(items?.onToggle)}
          aimTarget={aimTarget}
          highlight={selected}
          lamps={lamps}
          onAdjust={placement.onAdjust}
          {...textStage}
          models={models}
          modelSelection={modelSelection}
          modelHandlers={modelHandlers}
          label={label}
        >
          {placing && !inside && <EmblemPlacingBar text={EMBLEM_PLACING_HINT} label={placingLabel} onDone={onPlaced} />}
          {overlay}
        </ModelStage>
      ) : (
        <p className="model-stage-note">{tr("Сцены этой арены нет в этой версии Astral.")}</p>
      )}
      <StageBar>
        {/* Сцену редактор переключает в шапке (ТЗ 22.10.2026); свой переключатель кадр ставит, только если его просят. */}
        {onView && <SegmentedControl label={tr("Откуда смотреть")} size="sm" options={ARENA_VIEW_OPTIONS} value={askedView} onChange={onView} />}
        {!inside && <SegmentedControl label={tr("Время суток")} size="sm" options={hourOptions} value={hour} onChange={setHour} />}
      </StageBar>
      <StageBusy busy={viewSwitch.busy} />
      {offstage.plate}
      {/* Без Astral Desktop листы игры не прочитать — одной строкой; откуда модели, колонке говорить незачем (п. 3.1). */}
      {!textureAvailable({ set: "hangar" }) && <StageNote tone="warning">{tr("Без Astral Desktop листы игры не прочитать — цвета средние")}</StageNote>}
    </div>
  );
}
