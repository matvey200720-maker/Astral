/*
 * Редактор «Интерьеры» — магазины и заведения изнутри и снаружи (задача 3
 * ТЗ 10.10.2026; задача 5 вечернего ТЗ 17.10.2026): 24/7, одежда,
 * Ammu-Nation, барбершопы, LS Customs, банки, клубы, тату-салоны и заправки.
 *
 * Над кадром — что правится (меню по разделам): помещение изнутри или вид
 * мест снаружи (заправки, фасады вида магазинов). Магазин одного вида в игре
 * — одно помещение, расставленное по карте, поэтому облик помещения ложится
 * на все его места сразу: все 24/7, все Fleeca. Снаружи у каждого места свои
 * модели квартала: облик — один на все места вида или свой у места.
 *
 * Изнутри (решение владельца 12.10.2026 — действует): «Помещение», «Цвет и
 * блеск» (зал: стены, пол, потолок; вещи: прилавок, полки, мебель, банкоматы
 * с автоматами и холодильниками — свой цвет и блеск: чистая, глянец,
 * зеркало), «Модели», «Шаблоны». Узоров, картинок, «Без текстуры», «Предметов»
 * и замен вещей изнутри нет. Снаружи (вернули 17.10.2026, владелец просит
 * красить фасады и вывески): «Место» (карта и список, свой облик места),
 * «Стены, навес, вывески» (отделка — цвет, узор, картинка, градиент),
 * «Колонки» (у заправок, один облик на все станции), «Эмблемы» и «Текст»
 * (общая система мест: плашка на стене), «Модели», «Шаблоны». Кадр —
 * помещение изнутри или место снаружи из игры игрока; облик меняется сразу.
 *
 * «Модели» (ТЗ 11.10.2026, вечер, задача 1) — и изнутри, и снаружи: свои
 * модели одним списком работы. Изнутри модель встаёт в само помещение
 * (сущностью его MLO) — во все магазины вида на карте; снаружи — у места.
 *
 * Общее с остальными местами (работа, черновик, «Мои работы», «Применить»,
 * камера) — `useRecolorEditor`. «Как в игре» всего — ставить нечего:
 * «Применить» снимает установку.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Drop, Lamp, MapPin, PaintBucket, Storefront, Swatches, TextAa } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  SHOP_INTERIOR_LIST_IDS,
  applyShopsPreset,
  applyShopsStandard,
  changedShopInteriors,
  copyShopLook,
  normalizeShopLook,
  shopInterior,
  shopInteriorsOf,
  shopLookIsStock,
  shopModelScene,
  stockShopLook,
} from "@modovik/climb-contract/recolor/shops";
import {
  OUTSIDE_KINDS,
  changedOutsidePlaces,
  normalizeOutsideLook,
  normalizePumpLook,
  outsideDefaultDecal,
  outsideLookIsStock,
  outsidePlacesOf,
  outsidePresetLook,
  pumpPresetLook,
  shopOutsidePlace,
  stockOutside,
} from "@modovik/climb-contract/recolor/shops-outside";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { emblemKindOf, emblemPlacingLabel, emblemToolActive, emblemTools } from "../emblem/emblem-tools.jsx";
import { useEmblemEditor } from "../emblem/useEmblemEditor.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import { MODELS_TOOL_ID, modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import ShopsInspector from "./ShopsInspector.jsx";
import ShopsNameInspector from "./ShopsNameInspector.jsx";
import ShopsOutsideInspector from "./ShopsOutsideInspector.jsx";
import ShopsOutsideStage from "./ShopsOutsideStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { wallFromHit } from "../texture-studio/wall-pick.js";
import ShopsStage from "./ShopsStage.jsx";
import { shopsImages } from "./shops-images.js";
import { signFaces } from "./sign-faces.js";
import { clearNames, defaultNameStyle, dropName, namesOf, nameOnFace, putName, restyleNames, useSignNames } from "./sign-names.js";
import { isOutsideTarget, outsideKindOf, outsidePartLabel, outsideTargetLabel, placeLabel, pumpPartLabel } from "./shops-outside-text.js";
import { categoryLabel, fill, interiorMenuOptions, interiorTitle, surfaceLabel } from "./shops-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const DRAFT_KEY = "astral.shops.project.v1";
const OUTSIDE_MODELS_WHERE = "у этого места";

/* Цифры — горячие клавиши по порядку панели: буквы в 3D-кадре заняты полётом. */
const numbered = (tools) => tools.map((tool, index) => ({ ...tool, shortcut: String(index + 1) }));

/* Изнутри: помещение, цвет и блеск, модели, шаблоны. Подписи — переводом при сборке списка. */
function insideTools() {
  return numbered([
    {
      id: "place",
      label: tr("Помещение"),
      icon: <Storefront />,
      group: "place",
      hint: tr("Помещение выбирают в меню над кадром. Магазин одного вида в игре — одно помещение: правка ложится на все его места на карте"),
    },
    {
      id: "surfaces",
      label: tr("Цвет и блеск"),
      icon: <PaintBucket />,
      group: "paint",
      hint: tr("У каждой поверхности — свой цвет и блеск: чистая, глянец или зеркало. Щелчок по стене, полу или вещи в кадре открывает её здесь"),
    },
    {
      id: "light",
      label: tr("Свет"),
      icon: <Lamp />,
      group: "paint",
      hint: tr("Лампы, что стоят в одном этом помещении, — свой цвет и сила. Общие модели игры остаются штатными"),
    },
    /* Свои модели — в само помещение: во все магазины вида сразу. */
    { ...modelsTool(), label: tr("Модели"), note: undefined, hint: tr(modelsTool().hint) },
    {
      id: "templates",
      label: tr("Шаблоны"),
      icon: <Swatches />,
      group: "ready",
      hint: tr("Готовый облик оформляет помещение разом — дальше любую поверхность можно поправить"),
    },
  ]);
}
const INSIDE_TOOL_IDS = ["place", "surfaces", "light", MODELS_TOOL_ID, "templates"];

/* Снаружи: место, части, колонки (у заправок), эмблемы и текст, модели, шаблоны. */
function outsideTools(kind) {
  const where = tr("на фасаде и вывесках");
  const list = [
    {
      id: "where",
      label: tr("Место"),
      icon: <MapPin />,
      group: "place",
      hint: tr("Место выбирают на карте или списком. Облик — один на все места вида; включите «Свой облик у этого места», чтобы красить только его"),
    },
    {
      id: "parts",
      label: tr("Стены, навес, вывески"),
      icon: <PaintBucket />,
      group: "paint",
      hint: tr("Стены, навес и крыша, площадка, вывески и подсветка — цветом, узором, своей картинкой. Щелчок по стене в кадре — сюда"),
    },
    ...(kind === "gas"
      ? [
          {
            id: "pumps",
            label: tr("Колонки АЗС"),
            icon: <Drop />,
            group: "paint",
            hint: tr("Колонки — один облик на все станции. Щелчок по колонке в кадре — сюда"),
          },
          {
            id: "name",
            label: tr("Название"),
            icon: <TextAa />,
            group: "paint",
            hint: tr("Впишите название — оно встанет плашкой перед вывесками станции и закроет старую надпись целиком: фон в цвет вывески, размер с грань"),
          },
        ]
      : []),
    /* Эмблемы и надписи на фасаде — общая система мест (плашка на стене в игре). */
    ...emblemTools({ where }).map((tool) => ({
      ...tool,
      note: undefined,
    })),
    /* Свои модели у места. */
    { ...modelsTool(), label: tr("Модели"), note: undefined, hint: tr(modelsTool().hint) },
    {
      id: "templates",
      label: tr("Шаблоны"),
      icon: <Swatches />,
      group: "ready",
      hint: tr("Готовый облик оформляет место разом: стены, навес, вывески и колонки"),
    },
  ];
  return numbered(list);
}

/* Подпись сцены своей модели в списке: помещение изнутри или место снаружи. */
function modelSceneLabel(scene) {
  const where = shopModelScene(scene);
  if (where?.inside) return fill(tr("{0} — внутри"), tr(where.inside.label));
  return where?.outside ? fill(tr("{0} — снаружи"), placeLabel(where.outside)) : "";
}

/* Список эмблем и надписей снаружи — в части работы «снаружи». */
const readOutsideEmblems = (project) => project.outside.emblems;
const writeOutsideEmblems = (project, emblems) => ({ ...project, outside: { ...project.outside, emblems } });

function doneText(result) {
  if (result?.status === "unchanged") return tr("Интерьеры в игре уже такие — ставить было нечего");
  const count = result?.interiors?.length || 0;
  return count ? fill(tr("Интерьеры установлены: помещений — {0}. Перезапустите игру."), count) : tr("Интерьеры установлены. Перезапустите игру.");
}

/* Стандарт частей: все поверхности «как в игре», цвета и узоры панель помнит. */
const stockParts = (look) => ({ ...look, parts: Object.fromEntries(Object.entries(look.parts).map(([id, surface]) => [id, { ...surface, mode: "standard" }])) });

export default function ShopsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("shops:tool", "surfaces");
  const [savedOutsideTool, setOutsideTool] = useRememberedState("shops:outsideTool", "parts");
  const [savedTarget, setTarget] = useRememberedState("shops:interior", "shop247");
  const [savedInside, setInside] = useRememberedState("shops:inside", "shop247");
  const [savedPlaces, setSavedPlaces] = useRememberedState("shops:places", {});

  /* Что правится: помещение изнутри или вид мест снаружи. */
  const outsideMode = isOutsideTarget(savedTarget) && OUTSIDE_KINDS.includes(outsideKindOf(savedTarget));
  const kind = outsideMode ? outsideKindOf(savedTarget) : null;
  const interiorId = SHOP_INTERIOR_LIST_IDS.includes(savedTarget) ? savedTarget : SHOP_INTERIOR_LIST_IDS.includes(savedInside) ? savedInside : SHOP_INTERIOR_LIST_IDS[0];
  const interior = shopInterior(interiorId);
  const insideToolList = insideTools();
  const outsideToolList = outsideTools(kind);
  const tool = INSIDE_TOOL_IDS.includes(savedTool) ? savedTool : "surfaces";
  const outsideTool = outsideToolList.some((item) => item.id === savedOutsideTool) ? savedOutsideTool : "parts";
  const places = useMemo(() => (kind ? outsidePlacesOf(kind) : []), [kind]);
  const placeId = kind ? (places.some((place) => place.id === savedPlaces[kind]) ? savedPlaces[kind] : places[0]?.id) : null;
  const place = placeId ? shopOutsidePlace(placeId) : null;
  /* Поверхность, выбранная щелчком в кадре: панель раскрывает её первой, кадр подсвечивает. */
  const [focus, setFocus] = useState({ surface: null, interior: "", at: 0 });
  /* То же снаружи: часть места или колонки (`{ tool, part, at }`). */
  const [outsideFocus, setOutsideFocus] = useState(null);
  /* Стена, по которой щёлкнули в кадре снаружи (3Б ТЗ 18.10.2026): «Студия» её части откроется на ней. */
  const [outsideWall, setOutsideWall] = useState(null);

  const editor = useRecolorEditor({
    set: "shops",
    contract: RECOLOR_PROJECTS.shops,
    storageKey: DRAFT_KEY,
    title: tr("Интерьеры"),
    coverSlotId: "shops",
    onNotice,
    resetNotice: tr("Все помещения и места снаружи как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять интерьеры Astral — в игре помещения и места снаружи станут как были"),
    savedText: tr("Ставим интерьеры в игру"),
    doneText,
    rolledBackText: tr("Интерьеры сняты из игры — остальные моды на месте"),
    images: shopsImages,
  });
  const { project, commit, replace } = editor;
  const label = interior?.label || tr("Помещение");

  /*
   * Свои модели (ТЗ 11.10.2026, вечер, задача 1): сцена — помещение в кадре
   * (оси помещения) или место снаружи. Модель другой сцены в списке — кадр
   * идёт к ней, и инструмент «Модели» остаётся в руке.
   */
  const modelScene = outsideMode ? placeId || "" : interiorId;
  const onModelScene = useCallback(
    (scene) => {
      const where = shopModelScene(scene);
      if (where?.inside) {
        setTool(MODELS_TOOL_ID);
        setTarget(where.inside.id);
        setInside(where.inside.id);
      } else if (where?.outside) {
        setOutsideTool(MODELS_TOOL_ID);
        setSavedPlaces({ ...savedPlaces, [where.outside.kind]: where.outside.id });
        setTarget(`out:${where.outside.kind}`);
      }
    },
    [savedPlaces, setInside, setOutsideTool, setSavedPlaces, setTarget, setTool],
  );
  const models = usePlaceModels({
    editor,
    scene: modelScene,
    tool: outsideMode ? outsideTool : tool,
    onTool: outsideMode ? setOutsideTool : setTool,
    where: outsideMode ? tr(OUTSIDE_MODELS_WHERE) : fill(tr("в помещении «{0}» и сразу во всех таких на карте"), tr(label)),
    sceneLabel: modelSceneLabel,
    onSceneChange: onModelScene,
    blocked: shopModelScene(modelScene) ? "" : outsideMode ? tr("Сцены этого места нет в этой версии Astral — свои модели сюда не поставить.") : tr("Сцены этого помещения нет в этой версии Astral — свои модели сюда не поставить."),
    onNotice,
  });

  const onTarget = useCallback(
    (value) => {
      setTarget(value);
      if (SHOP_INTERIOR_LIST_IDS.includes(value)) setInside(value);
    },
    [setTarget, setInside],
  );

  /* Песочница (только dev): работа и выбор помещения — снимкам кадра проверок, как `__astralModelStage`. */
  useEffect(() => {
    if (!import.meta.env?.DEV) return undefined;
    const hook = { project, replace, setTarget: onTarget };
    window.__astralShopsEditor = hook;
    return () => {
      if (window.__astralShopsEditor === hook) delete window.__astralShopsEditor;
    };
  }, [project, replace, onTarget]);

  /* ---------------------------------------------------------------- *
   * Изнутри
   * ---------------------------------------------------------------- */

  /* Правка облика взятого помещения. */
  const editLook = useCallback(
    (update, text) =>
      commit((current) => ({ ...current, interiors: { ...current.interiors, [interiorId]: normalizeShopLook(interiorId, update(current.interiors[interiorId])) } }), text),
    [commit, interiorId],
  );
  const onSurface = useCallback(
    (surface, patch, text) => editLook((look) => ({ ...look, surfaces: { ...look.surfaces, [surface]: { ...look.surfaces[surface], ...patch } } }), text || `${label}: ${surfaceLabel(surface).toLowerCase()}`),
    [editLook, label],
  );
  /* Свет ламп помещения: режим, цвет, сила. */
  const onLight = useCallback((patch, text) => editLook((look) => ({ ...look, light: { ...look.light, ...patch } }), text), [editLook]);
  const onSurfacesStandard = useCallback(
    () => editLook((look) => ({ ...look, surfaces: stockShopLook(look).surfaces }), `${label}: как в игре — все поверхности`),
    [editLook, label],
  );
  const onPreset = useCallback((preset) => replace((current) => applyShopsPreset(current, interiorId, preset.id), `${tr(label)}: ${tr(preset.label)}`), [replace, interiorId, label]);
  const onInteriorStandard = useCallback(() => editLook((look) => stockShopLook(look), `${label}: как в игре`), [editLook, label]);
  const onStandard = useCallback(() => replace((current) => applyShopsStandard(current), tr("Все помещения и места снаружи как в игре")), [replace]);
  const onCopy = useCallback(
    (scope) => {
      const targets = scope === "all" ? SHOP_INTERIOR_LIST_IDS : shopInteriorsOf(interior?.category).map((item) => item.id);
      const where = scope === "all" ? tr("всем помещениям") : fill(tr("разделу «{0}»"), tr(categoryLabel(interior?.category)));
      replace((current) => copyShopLook(current, interiorId, targets), fill(tr("Облик «{0}» — {1}"), tr(label), where));
    },
    [replace, interior, interiorId, label],
  );

  /*
   * Щелчок в кадре (18.10.2026): своя модель — «Модели»; стена, пол, потолок или вещь
   * (полка, прилавок, банкомат) — её поверхность в «Цвете и блеске»: панель
   * подъезжает к ней, кадр подсвечивает её штрихами.
   */
  const onAim = useCallback(
    (target, hit) => {
      if (models.onAim?.(hit)) return;
      /* С «Моделями» в руке щелчок мимо модели — не выбор вещи или стены. */
      if (models.active || !target) return;
      if (tool !== "surfaces") setTool("surfaces");
      setFocus({ surface: target.surface, interior: interiorId, at: Date.now() });
    },
    [models, interiorId, setTool, tool],
  );
  const selectedSurface = tool === "surfaces" && focus.interior === interiorId ? focus.surface : null;

  /* ---------------------------------------------------------------- *
   * Снаружи
   * ---------------------------------------------------------------- */

  const outside = project.outside;
  const ownPlace = Boolean(placeId && outside.places[placeId]?.own);
  const editing = useMemo(
    () => ({
      own: ownPlace,
      look: ownPlace ? outside.places[placeId].look : outside.kinds[kind] || normalizeOutsideLook({}),
      pumps: outside.pumps.all,
    }),
    [outside, placeId, kind, ownPlace],
  );
  const where = place ? placeLabel(place) : tr("Место");
  const scope = ownPlace ? where : kind === "gas" ? tr("все заправки") : outsideTargetLabel(kind || "");
  const editOutside = useCallback((update, text) => commit((current) => ({ ...current, outside: update(current.outside) }), text), [commit]);
  /* Облик частей, что правится: свой у места или облик вида. */
  const editPlaceLook = useCallback(
    (update, text) =>
      editOutside((current) => {
        if (current.places[placeId]?.own)
          return { ...current, places: { ...current.places, [placeId]: { own: true, look: normalizeOutsideLook(update(current.places[placeId].look)) } } };
        return { ...current, kinds: { ...current.kinds, [kind]: normalizeOutsideLook(update(current.kinds[kind])) } };
      }, text),
    [editOutside, placeId, kind],
  );
  /* Колонки — один облик на все станции. */
  const editPumpLook = useCallback((update, text) => editOutside((current) => ({ ...current, pumps: { ...current.pumps, all: normalizePumpLook(update(current.pumps.all)) } }), text), [editOutside]);
  const outsideHandlers = useMemo(
    () => ({
      onPlace: (id) => setSavedPlaces({ ...savedPlaces, [kind]: id }),
      /* Свой облик места начинается с облика вида — с того, что видно в кадре. */
      onOwn: (on) =>
        editOutside((current) => {
          const saved = current.places[placeId];
          const look = saved && !outsideLookIsStock(saved.look) ? saved.look : current.kinds[kind];
          return { ...current, places: { ...current.places, [placeId]: { own: on, look } } };
        }, `${where}: ${on ? tr("свой облик") : tr("общий облик")}`),
      onShare: () =>
        editOutside((current) => {
          const look = current.places[placeId]?.look;
          if (!look) return current;
          return { ...current, kinds: { ...current.kinds, [kind]: look }, places: { ...current.places, [placeId]: { own: false, look } } };
        }, fill(tr("Облик «{0}» — всем местам вида"), where)),
      onPart: (part, patch, text) => editPlaceLook((look) => ({ ...look, parts: { ...look.parts, [part]: { ...look.parts[part], ...patch } } }), text || `${scope}: ${tr(outsidePartLabel(part)).toLowerCase()}`),
      onPartsStandard: () => editPlaceLook(stockParts, `${scope}: ${tr("как в игре")}`),
      onPump: (part, patch, text) =>
        editPumpLook((look) => ({ ...look, parts: { ...look.parts, [part]: { ...look.parts[part], ...patch } } }), text || `${tr("Колонки АЗС")}: ${tr(pumpPartLabel(part)).toLowerCase()}`),
      onPumpsStandard: () => editPumpLook(stockParts, `${tr("Колонки АЗС")}: ${tr("как в игре")}`),
      onPreset: (preset) =>
        replace((current) => {
          const next = { ...current.outside };
          const own = next.places[placeId]?.own;
          if (own) next.places = { ...next.places, [placeId]: { own: true, look: outsidePresetLook(preset.id, next.places[placeId].look) } };
          else next.kinds = { ...next.kinds, [kind]: outsidePresetLook(preset.id, next.kinds[kind]) };
          if (kind === "gas") next.pumps = { ...next.pumps, all: pumpPresetLook(preset.id, next.pumps.all) };
          return { ...current, outside: next };
        }, `${scope}: ${tr(preset.label)}`),
      onPlaceStandard: () =>
        editOutside((current) => ({ ...current, places: { ...current.places, [placeId]: { ...(current.places[placeId] || { look: normalizeOutsideLook({}) }), own: false } } }), `${where}: ${tr("как у всех мест вида")}`),
      onKindStandard: () =>
        editOutside(
          (current) => ({ ...current, kinds: { ...current.kinds, [kind]: stockParts(current.kinds[kind]) }, pumps: kind === "gas" ? { ...current.pumps, all: stockParts(current.pumps.all) } : current.pumps }),
          `${kind === "gas" ? tr("Все заправки") : outsideTargetLabel(kind)}: ${tr("как в игре")}`,
        ),
      onAllStandard: () => editOutside((current) => stockOutside(current), tr("Всё снаружи как в игре")),
    }),
    [editOutside, editPlaceLook, editPumpLook, replace, savedPlaces, setSavedPlaces, kind, placeId, where, scope],
  );
  /* Эмблемы и надписи — списком; новая встаёт на место в кадре. */
  const newEmblemPlace = useCallback(() => (placeId ? { location: placeId, ...outsideDefaultDecal() } : {}), [placeId]);
  const emblems = useEmblemEditor({
    project,
    commit,
    amend: editor.amend,
    read: readOutsideEmblems,
    write: writeOutsideEmblems,
    active: outsideMode && emblemToolActive(outsideTool),
    kind: emblemKindOf(outsideTool),
    defaults: newEmblemPlace,
    onNotice,
  });
  /* Эмблема в руке — кадр показывает её место (и вид мест этого места). */
  const placing = outsideMode && emblems.placing;
  const emblemPlace = emblems.selected?.location;
  useEffect(() => {
    if (!placing || !emblemPlace || emblemPlace === placeId) return;
    const found = shopOutsidePlace(emblemPlace);
    if (!found) return;
    setSavedPlaces({ ...savedPlaces, [found.kind]: emblemPlace });
    if (found.kind !== kind) setTarget(`out:${found.kind}`);
  }, [placing, emblemPlace, placeId, kind, savedPlaces, setSavedPlaces, setTarget]);

  /* Названия заправок: плашки на гранях вывесок (`sign-faces.js`, `sign-names.js`). */
  const signNames = useSignNames({ project, commit, amend: editor.amend, onNotice });
  const nameTool = outsideMode && outsideTool === "name";
  const [facesOf, setFacesOf] = useState({});
  const [nameDrafts, setNameDrafts] = useState({});
  const [brandBusy, setBrandBusy] = useState(false);
  useEffect(() => {
    if (!nameTool || !place?.scene?.url || facesOf[place.id]) return undefined;
    let alive = true;
    loadSceneAsset(place.scene.url)
      .then((asset) => alive && setFacesOf((current) => ({ ...current, [place.id]: signFaces(asset, place.brand) })))
      .catch(() => alive && setFacesOf((current) => ({ ...current, [place.id]: [] })));
    return () => {
      alive = false;
    };
  }, [nameTool, place, facesOf]);
  const faces = useMemo(() => (place && facesOf[place.id]) || [], [place, facesOf]);
  const placeNames = useMemo(() => (place ? namesOf(signNames.names, place.id) : []), [place, signNames.names]);
  /* Вид названия: правленый в окне, иначе — у плашек станции, иначе — по умолчанию (фон — средний цвет листа первой вывески). */
  const nameStyle = useMemo(() => {
    if (!place) return defaultNameStyle();
    if (nameDrafts[place.id]) return nameDrafts[place.id];
    if (placeNames[0]) {
      const { ratio: _ratio, ...text } = placeNames[0].text;
      return text;
    }
    const sheet = place.sheets.find((item) => item.name === faces[0]?.sheet);
    return defaultNameStyle(sheet?.colour);
  }, [place, nameDrafts, placeNames, faces]);
  const onNameStyle = useCallback(
    (values) => {
      if (!place) return;
      const next = { ...nameStyle, ...values };
      setNameDrafts((current) => ({ ...current, [place.id]: next }));
      if (placeNames.length) signNames.update((list) => restyleNames(list, place.id, next), tr("Название: вид"));
    },
    [place, nameStyle, placeNames.length, signNames],
  );
  const onNameToggle = useCallback(
    (face) => {
      if (!place) return;
      signNames.update((list) => (nameOnFace(list, place.id, face) ? dropName(list, place.id, face) : putName(list, place.id, face, nameStyle)), tr("Название: вывеска"));
    },
    [place, nameStyle, signNames],
  );
  const onNameAll = useCallback(() => {
    if (!place) return;
    signNames.update((list) => faces.reduce((next, face) => putName(next, place.id, face, nameStyle), list), tr("Название: все вывески станции"));
  }, [place, faces, nameStyle, signNames]);
  const onNameClear = useCallback(() => {
    if (place) signNames.update((list) => clearNames(list, place.id), tr("Название: убрано"));
  }, [place, signNames]);
  /* Остальным станциям бренда — две самые большие вывески каждой; сцены читаются по очереди. */
  const brandMates = useMemo(() => (place?.brand ? places.filter((item) => item.id !== place.id && item.brand === place.brand && item.scene?.url) : []), [place, places]);
  const onNameBrand = useCallback(async () => {
    if (!place || brandBusy) return;
    setBrandBusy(true);
    try {
      let list = signNames.names;
      let placed = 0;
      for (const mate of brandMates) {
        const found = await loadSceneAsset(mate.scene.url).then((asset) => signFaces(asset, mate.brand)).catch(() => []);
        setFacesOf((current) => ({ ...current, [mate.id]: found }));
        for (const face of found.slice(0, 2)) {
          const before = list.length;
          list = putName(list, mate.id, face, nameStyle);
          if (list.length > before) placed += 1;
        }
      }
      signNames.update(() => list, tr("Название: всем станциям бренда"));
      onNotice?.(fill(tr("Название стоит на вывесках других станций бренда: плашек — {0}."), placed), "info");
    } finally {
      setBrandBusy(false);
    }
  }, [place, brandBusy, brandMates, nameStyle, signNames, onNotice]);

  /* Щелчок по месту снаружи (18.10.2026): своя модель — «Модели»; часть места — «Стены, навес, вывески», колонка — «Колонки АЗС», с подсветкой. */
  const onOutsideAim = useCallback(
    (target, hit) => {
      if (models.onAim?.(hit)) return;
      if (models.active || placing || !target) return;
      setOutsideWall(target.part ? wallFromHit(hit) : null);
      setOutsideTool(target.tool);
      setOutsideFocus({ tool: target.tool, part: target.part, at: Date.now() });
    },
    [models, placing, setOutsideTool],
  );
  const selectedOutside = outsideFocus && outsideFocus.tool === outsideTool ? outsideFocus : null;

  const options = useMemo(() => interiorMenuOptions(project), [project]);
  const targetLabel = outsideMode ? `${tr(categoryLabel(kind === "gas" ? "gas" : shopInterior(kind)?.category))} · ${outsideTargetLabel(kind)}` : interiorTitle(interior);
  const tabs = <MenuButton className="shops-interior-menu" label={targetLabel} ariaLabel={tr("Что правится")} options={options} value={outsideMode ? savedTarget : interiorId} onSelect={onTarget} />;

  const changed = changedShopInteriors(project).length;
  const deferred = useDeferredValue(project);
  /* Кадр «снаружи» для «Студии»: то же место с работой, где на месте поверхности стоит холст студии. */
  const renderOutsideLive = useCallback((live, hint) => <ShopsOutsideStage outside={live.outside} placeId={placeId} kind={kind} focus={hint?.focus} wall={hint?.wall} />, [placeId, kind]);
  const insideStatus = `${project.name || tr("Интерьеры")} · ${tr(label)}: ${shopLookIsStock(project.interiors[interiorId]) ? tr("как в игре") : tr("есть изменения")}${changed ? fill(tr(" · в игру — помещений: {0}"), changed) : ""}`;
  const outsideCount = changedOutsidePlaces(outside).length;
  const outsideStatus = `${project.name || tr("Интерьеры")} · ${where}: ${ownPlace ? tr("свой облик") : fill(tr("облик «{0}»"), kind === "gas" ? tr("все заправки") : outsideTargetLabel(kind || ""))}${outsideCount ? fill(tr(" · снаружи в игру — мест: {0}"), outsideCount) : ""}`;

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor shops-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская интерьеров")}
      status={outsideMode ? outsideStatus : insideStatus}
      tabs={tabs}
      tools={outsideMode ? outsideToolList : insideToolList}
      tool={outsideMode ? outsideTool : tool}
      onTool={outsideMode ? setOutsideTool : setTool}
      guide={models.active ? models.guide : editor.guide(placing, { aim: outsideMode ? tr("править часть места под курсором") : tr("править поверхность под курсором") })}
      guideKey={outsideMode ? "shops-outside" : "shops"}
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        models.active ? (
          models.panel
        ) : outsideMode && outsideTool === "name" ? (
          <ShopsNameInspector
            place={place}
            faces={faces}
            loading={Boolean(place?.scene?.url) && !facesOf[place?.id]}
            names={signNames.names}
            style={nameStyle}
            onStyle={onNameStyle}
            onToggle={onNameToggle}
            onAll={onNameAll}
            onClear={onNameClear}
            brandCount={brandMates.length}
            onBrand={onNameBrand}
            busy={brandBusy}
            onNotice={onNotice}
          />
        ) : outsideMode ? (
          <StudioLiveProvider project={project} render={renderOutsideLive} wall={outsideWall}>
            <ShopsOutsideInspector tool={outsideTool} outside={outside} kind={kind} placeId={placeId} editing={editing} handlers={outsideHandlers} emblems={emblems} focus={outsideFocus} onNotice={onNotice} />
          </StudioLiveProvider>
        ) : (
          <ShopsInspector
            tool={tool}
            project={project}
            interiorId={interiorId}
            focus={focus}
            onInterior={onTarget}
            onCopy={onCopy}
            onSurface={onSurface}
            onSurfacesStandard={onSurfacesStandard}
            onPreset={onPreset}
            onInteriorStandard={onInteriorStandard}
            onStandard={onStandard}
            onLight={onLight}
          />
        )
      }
    >
      {outsideMode ? (
        <ShopsOutsideStage
          outside={emblems.hide(deferred).outside}
          placeId={placeId}
          kind={kind}
          onCamera={editor.onCamera}
          placing={placing}
          placingLabel={emblemPlacingLabel(outsideTool)}
          onPlace={emblems.place}
          onAdjust={emblems.adjust}
          textStage={emblems.stage}
          onPlaced={() => emblems.setPlacing(false)}
          {...models.stageProps}
          /* После свойств «Моделей»: щелчок сам спрашивает их первыми. */
          onAim={onOutsideAim}
          wall={outsideWall}
          selected={selectedOutside}
          canAim={!models.active}
          overlay={models.bar}
        />
      ) : (
        <ShopsStage
          project={deferred}
          interiorId={interiorId}
          onCamera={editor.onCamera}
          {...models.stageProps}
          onAim={onAim}
          selected={selectedSurface}
          canAim={!models.active}
          overlay={models.bar}
        />
      )}
      {editor.works.dialogs}
    </EditorShell>
  );
}
