/*
 * Редактор здания из игры — общий у «Мегамолла» (Davis Mega Mall) и «Ашана /
 * Икеи» (You Tool): место выбирает плитка полки (`place`).
 *
 * Основа — штатное здание игры игрока, всё по умолчанию «Стандарт».
 * Инструменты слева (мастерская «как в Photoshop»), справа — настройки
 * взятого: здание и части, стороны (цвет или свой баннер с рекомендуемым
 * размером), надпись, таблички, логотипы, шаблоны и «Стандарт». Кадр — само
 * здание в 3D на матовой плашке; облик в кадре меняется сразу.
 *
 * Общее с остальными редакторами мест (работа, черновик, «Мои работы»,
 * «Применить», камера) — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Buildings, CursorClick, ImageSquare, Square, Sticker, Storefront, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  BUILDING_SIDE_IDS,
  applyBuildingPreset,
  applyBuildingStandard,
  buildingBillboards,
  buildingInventory,
  buildingPlaceParts,
  buildingSigns,
  buildingEmblemPlace,
  buildingItemModel,
  buildingItemsKnown,
  buildingRemovable,
  normalizeBuildingWalls,
} from "@modovik/climb-contract/recolor/buildings";
import { setPlaceItemLook } from "@modovik/climb-contract/recolor/place-item-looks";
import { applyItemLook } from "../items-panel/item-set-looks.js";
import { itemMoveLook } from "../items-panel/item-look-objects.js";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import { withoutNote } from "../../../components/ui/editor-rail-groups.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import { emblemKindOf, emblemPlacingLabel, emblemToolActive, emblemTools } from "../emblem/emblem-tools.jsx";
import { useEmblemEditor } from "../emblem/useEmblemEditor.js";
import { modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import { buildingImages } from "./building-art.js";
import BuildingInspector, { SIDES_ALL } from "./BuildingInspector.jsx";
import BuildingStage from "./BuildingStage.jsx";
import { buildingAimSpec, buildingAimTarget } from "./building-aim.js";
import { BUILDING_ITEMS_COPY, buildingItemsAdapter, buildingSceneObjects, buildingSelectionKind, buildingViewYaw } from "./building-items.js";
import { groupKeys, viewHome } from "../items-panel/items-frame.js";
import { THING_WORDS, countedIn } from "../counted-words.js";
import { createItemShots } from "../items-panel/item-shots.js";
import { sceneInventory } from "../items-panel/items-inventory.js";
import SceneItemsSection from "../items-panel/SceneItemsSection.jsx";
import PlaceItemLook from "../items-panel/PlaceItemLook.jsx";
import { MultiLook } from "../arena-editor/arena-item-look.jsx";
import { createElementsOf } from "../items-panel/scene-elements.js";
import { placeItemLookAdapter, placeItemPlaceOf } from "../items-panel/place-item-look.js";
import { useSceneItems } from "../items-panel/use-scene-items.js";
import { partLabel } from "./building-text.js";
import { DEFAULT_STAMP, PatternStampSection, patternTool, stampFinish } from "../finish/PatternStamp.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { wallFromHit } from "../texture-studio/wall-pick.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Подписи мест — в мастерской и в итоге установки. */
const PLACE_WORDS = Object.freeze({
  megamall: { title: "Мегамолл", studio: "Мастерская Мегамолла", genitive: "Мегамолла", accusative: "Мегамолл" },
  youtool: { title: "Ашан / Икея", studio: "Мастерская Ашана / Икеи", genitive: "Ашана / Икеи", accusative: "Ашан / Икею" },
});
const wordsOf = (place) => PLACE_WORDS[place] || { title: place, studio: `Мастерская: ${place}`, genitive: place, accusative: place };
/* Эмблемы и надписи работы — общим списком (`emblems.js`). */
const readEmblems = (project) => project.emblems;
const writeEmblems = (project, emblems) => ({ ...project, emblems });

/* Плитка полки каждого места (обложка «Моих работ»). */
const COVER_SLOTS = Object.freeze({ megamall: "mega-mall", youtool: "ashan" });

/*
 * Инструменты здания. Цифры — горячие клавиши по порядку панели: буквы в
 * 3D-кадре заняты полётом (W A S D, Q и E).
 */
function toolsOf(place) {
  /* Объёмные буквы названия (DAVIS MEGA MALL) — в названии здания («Текст»), не в «Табличках». */
  const signs = buildingSigns(place).filter((sign) => sign.tool !== "title");
  return [
    {
      id: "building",
      label: tr("Здание"),
      icon: <Buildings />,
      group: "paint",
      hint: tr("Выберите облик здания справа — кадр покажет его сразу. Каждую часть здания можно покрасить отдельно"),
    },
    {
      id: "sides",
      label: tr("Стороны"),
      icon: <Square />,
      group: "paint",
      hint: tr("Каждую сторону фасада можно покрасить или закрыть своим баннером — рекомендуемый размер картинки написан справа"),
    },
    /* Узор щелчком по части здания (19.10.2026) — как у всех 3D-мастерских мест. */
    patternTool(),
    /* Щиты на крыше — свои фото (задача 5): только у мест со щитами. */
    ...(buildingBillboards(place).length
      ? [
          {
            id: "billboards",
            label: tr("Щиты"),
            icon: <ImageSquare />,
            group: "paint",
            hint: tr("Выберите сторону щита справа и загрузите фото — кадр покажет щит крупно, фото встанет на щит в игре вблизи и издалека"),
          },
        ]
      : []),
    /* Название здания (DAVIS MEGA MALL и др.) — строкой в «Тексте», а не вторым «T» в колонке (19.10.2026,
       владелец: «два разных текста, хуй пойми, что каждый делает»). */
    ...(signs.length
      ? [
          {
            id: "signs",
            label: tr("Таблички"),
            icon: <Storefront />,
            group: "text",
            hint: tr("Выберите табличку справа и впишите свой текст — у каждой свой цвет букв и плашки"),
          },
        ]
      : []),
    /* Эмблемы и надписи — общая система мест (задача 1): картинки и текст. */
    ...emblemTools({ where: tr("в любом месте здания") }),
    /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
    modelsTool({ where: tr("у здания и на крыше") }),
    {
      id: "templates",
      label: tr("Шаблоны"),
      icon: <Swatches />,
      group: "ready",
      hint: tr("Готовый вид оформляет здание разом — дальше любую часть можно поправить"),
    },
    /* Всё, что стоит у здания, по одной вещи (ТЗ владельца 26.10.2026, п. A); последним — цифры прежних инструментов не сдвигаются. */
    {
      id: "items",
      label: tr("Предметы"),
      icon: <CursorClick />,
      group: "models",
      hint: tr(BUILDING_ITEMS_COPY.hint),
    },
  ].map((tool, index) => ({ ...withoutNote(tool), shortcut: String(index + 1) }));
}

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B): у Мегамолла девять значков, у «Ашан / Икеи» восемь — стало четыре. «Здание»
 * (здание, стороны, щиты крыши, таблички; с 30.10.2026 — «Облик», как у завода и маппинга: имя панели не повторяет первый пункт
 * «Здание»), «Рисунки» (узоры, эмблемы, текст), «Модели», «Шаблоны». Прежние инструменты
 * остаются: панели, цифры (каждая открывает свой пункт), запись `<место>:tool`.
 */
const BUILDING_RAIL = Object.freeze([
  { id: "house", ids: ["building", "sides", "billboards", "signs"], label: "Облик", icon: <Buildings />, group: "paint", demo: "paint", tabs: true },
  { id: "decals", ids: ["emblem", "patterns", "text"], label: "Рисунки", icon: <Sticker />, group: "emblem", demo: "emblem", tabs: true },
]);

/* Итог установки одной строкой. */
function doneTextOf(place) {
  const words = wordsOf(place);
  return (result) => {
    if (result?.status === "unchanged") return `${words.title} в игре уже такой — ставить было нечего`;
    /* Общие файлы дальних планов района уже везёт другой раздел — они
       остались ему (два набора одни файлы не делят). */
    const yielded = result?.yielded?.owners?.length ? ` Часть дальних планов района занята разделом «${result.yielded.owners.join("», «")}» — издалека там облик того раздела.` : "";
    return `${words.title} установлен.${yielded} Перезапустите игру.`;
  };
}

export default function BuildingStudio({ place = "megamall", onExit, onNotice }) {
  useTr();
  const words = wordsOf(place);
  const tools = useMemo(() => toolsOf(place), [place]);
  const [tool, setTool] = useRememberedState(`${place}:tool`, "building");
  const [side, setSide] = useRememberedState(`${place}:side`, "front");
  const [billboard, setBillboard] = useRememberedState(`${place}:billboard`, buildingBillboards(place)[0]?.id || "");
  const [sign, setSign] = useRememberedState(`${place}:sign`, buildingSigns(place)[0]?.id || "");
  const [placing, setPlacing] = useState(null);
  /* Открытая страница «Текста»: «» — свои надписи, `title` — название здания. */
  const [textPage, setTextPage] = useState("");
  const titlePage = tool === "text" && textPage === "title";
  /* Раздел колонки, на который щёлкнули в кадре (часть здания, надпись, табличка): подсветка и прокрутка идут за ним. */
  const [aim, setAim] = useState({ count: 0, key: "" });
  /* Стена, по которой щёлкнули в кадре (3Б ТЗ 18.10.2026): связная плоская группа внутри части; «Студия» этой части откроется на ней. */
  const [wall, setWall] = useState(null);
  /* Открытая страница части здания в «Здании» (18.10.2026): «» — общий вид. */
  const [partPage, setPartPage] = useState("");
  const contract = RECOLOR_PROJECTS[place];
  const editor = useRecolorEditor({
    set: place,
    contract,
    storageKey: `astral.${place}.project.v1`,
    title: words.title,
    coverSlotId: COVER_SLOTS[place] || place,
    onNotice,
    resetNotice: `${words.title} как в игре`,
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: `Снять ${words.accusative} Astral — в игре станет как было`,
    savedText: `Ставим ${words.accusative} в игру`,
    doneText: doneTextOf(place),
    rolledBackText: `${words.title} снят из игры — остальные моды на месте`,
    images: (project) => buildingImages(project, place),
  });
  const { project, commit, replace } = editor;

  /* «Предметы»: опись вещей сцены здания, выбор вещи и кадры для плиток. */
  const [sceneAsset, setSceneAsset] = useState(null);
  const itemShots = useMemo(() => createItemShots(), []);
  const itemObjects = useMemo(() => sceneInventory(buildingSceneObjects(place), { selectionKindOf: buildingSelectionKind }), [place]);
  const itemsHome = useMemo(() => viewHome(sceneAsset, buildingViewYaw(place)), [sceneAsset, place]);
  const itemsAdapter = useMemo(() => buildingItemsAdapter({ title: words.title }), [words.title]);
  /* «Удалить» по одной и «Облик предмета» (ТЗ 27.10.2026) — у здания с описью карт района (Мегамолл); у остальных — как прежде. */
  const itemsKnown = buildingItemsKnown(place);
  const modelOfItem = useCallback((entity) => buildingItemModel(place, entity), [place]);
  const removableItem = useCallback((entity) => buildingRemovable(place, entity), [place]);
  /* Части вещи — с местом вещи у здания с описью карт района (рамка части в осях модели, как вырежет установка) и именем модели для плашки «… за кадром». */
  const itemPlaceOf = useMemo(() => (itemsKnown ? placeItemPlaceOf(place) : null), [itemsKnown, place]);
  const lookAdapter = useMemo(() => (itemsKnown ? placeItemLookAdapter(place, modelOfItem, sceneAsset) : null), [itemsKnown, place, modelOfItem, sceneAsset]);
  /* Элементы вещи — листы её модели (вариант A разбора 31.10.2026): у здания с описью карт района. */
  const elementsOf = useMemo(() => (lookAdapter ? createElementsOf(sceneAsset, { paintable: (key) => lookAdapter.paintable({ key }) }) : null), [sceneAsset, lookAdapter]);
  const sceneItems = useSceneItems({ objects: itemObjects, asset: sceneAsset, placeOf: itemPlaceOf, titleOf: itemsAdapter.titleOf, elementsOf });
  const { forget: forgetFound } = sceneItems;
  useEffect(() => {
    if (tool !== "items") forgetFound();
  }, [tool, forgetFound]);
  const projectNow = useRef(project);
  projectNow.current = project;
  /* Убранной вещи облик ни к чему: она уходит из своих групп (опустевшая группа — прочь). */
  const onItemRemove = useCallback(
    (keys, label) =>
      commit(
        (current) => ({
          ...current,
          items: current.items?.length ? setPlaceItemLook(current.items, keys, null) : current.items,
          removed: [...new Set([...(current.removed || []), ...keys])].sort((a, b) => a - b),
        }),
        label,
      ),
    [commit],
  );
  const onItemRestore = useCallback((keys, label) => commit((current) => ({ ...current, removed: (current.removed || []).filter((key) => !keys.includes(key)) }), label), [commit]);
  const onItemLook = useCallback(
    (keys, look, label, part = look?.part || null) => {
      /* Набор вещей разных моделей (Shift) — по группе на модель одним шагом; групп больше предела — отказ с числами. */
      const { refusal } = applyItemLook(projectNow.current.items, keys, look, modelOfItem, part);
      if (refusal) {
        onNotice?.(refusal, "error");
        return;
      }
      commit((current) => ({ ...current, items: applyItemLook(current.items, keys, look, modelOfItem, part).items ?? current.items }), label);
    },
    [commit, onNotice, modelOfItem],
  );
  /* Протяжка замены мышью (владелец 01.11.2026): сдвиг сцены — в оси модели вещи и к сдвигу облика (`itemMoveLook`), одним шагом истории. */
  const onItemMove = useCallback(
    (key, delta) => {
      const moved = itemMoveLook(projectNow.current.items, key, delta, itemPlaceOf);
      if (moved) onItemLook(moved.keys, moved.look, tr("перемещение"));
    },
    [onItemLook, itemPlaceOf],
  );

  /* Эмблемы и надписи — общим списком: в руке, пока взят их инструмент. */
  const emblems = useEmblemEditor({
    project,
    commit,
    amend: editor.amend,
    read: readEmblems,
    write: writeEmblems,
    /* На странице названия здания щелчок по кадру не ставит новую надпись. */
    active: emblemToolActive(tool) && !titlePage,
    kind: emblemKindOf(tool),
    /* Надпись по умолчанию — буквы в 3 м, эмблема — 6 м. */
    defaults: () => (tool === "text" ? { size: 3 } : {}),
    onNotice,
  });
  const models = usePlaceModels({ editor, scene: place, tool, onTool: setTool, where: "у здания и на крыше", onNotice });

  /* Инструмент взяли из колонки, а не щелчком по детали — выбранного раздела нет. */
  const onTool = useCallback(
    (next) => {
      setTool(next);
      setPartPage("");
      setTextPage("");
      setWall(null);
      setAim((current) => (current.key ? { ...current, key: "" } : current));
    },
    [setTool],
  );

  /* Пункт «Облика» щелчком над панелью (владелец 31.10.2026: «камеру меняло, когда тыкаешь»): рамка пункта заново — здание, сторона, щит,
     табличка; повторный щелчок возвращает камеру туда же (`at`). */
  const [shot, setShot] = useState(null);
  const signNow = useRef(sign);
  signNow.current = sign;
  const onSwitch = useCallback((next) => {
    if (BUILDING_RAIL[0].ids.includes(next)) setShot({ tool: next, sign: signNow.current, at: Date.now() });
  }, []);
  /* Табличка, выбранная строкой справа, — камера к ней; щелчок по табличке в кадре берёт её без перелёта (слово владельца 30.10.2026). */
  const onSignPick = useCallback(
    (id) => {
      setSign(id);
      setShot({ tool: "signs", sign: id, at: Date.now() });
    },
    [setSign],
  );
  const rail = useRailGroups({ groups: BUILDING_RAIL, tools, tool, onTool, letters: true, onSwitch });
  /* Правка ложится на все вещи группы разом — в шапке сколько их (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, «Реквизит · 37 вещей» у завода): у части здания —
     «Часть здания · 8 вещей», у таблички — «Таблички · 2 вещи». Счёт — тот же набор, что светит кадр (`buildingAimSpec`); одна вещь — без числа. */
  const countOf = (spec) => (spec ? groupKeys(sceneAsset, spec).size : 0);
  const partCount = tool === "building" && partPage ? countOf(buildingAimSpec(place, { tool: "building", key: partPage })) : 0;
  const signCount = tool === "signs" && !models.active ? countOf(buildingAimSpec(place, { tool: "signs", sign })) : 0;
  const signHead = signCount > 1 ? { label: tr(BUILDING_RAIL[0].label), note: `${tools.find((entry) => entry.id === "signs")?.label || ""} · ${countedIn(signCount, THING_WORDS)}` } : null;

  /*
   * Щелчок по детали в кадре (18.10.2026): своя модель — «Модели»; часть здания —
   * «Здание» с её разделом; плашка стороны или щит — «Стороны» и «Щиты» с
   * этой стороной; надпись и табличка — их инструмент с нужным разделом;
   * эмблема — её список с выбранной эмблемой.
   */
  /* Вещь описи под щелчком (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, 31.10.2026) — «Предметы» на ней: правится она одна, а не вся группа. */
  const { onPick: pickItem } = sceneItems;
  const onAim = useCallback(
    (hit, target) => {
      if (models.onAim?.(hit)) return;
      if (!target) return;
      if (Number.isInteger(target.item)) {
        setWall(null);
        setTool("items");
        pickItem(target.item, "one");
        return;
      }
      /* Часть здания — стена под щелчком; всё остальное (надписи, щиты, эмблемы) стены не даёт. */
      setWall(target.tool === "building" && target.part ? wallFromHit(hit) : null);
      /* Буквы названия в кадре — страница названия в «Тексте». */
      setTool(target.tool === "title" ? "text" : target.tool);
      setTextPage(target.tool === "title" ? "title" : "");
      if (target.side) setSide(target.side);
      if (target.billboard) setBillboard(target.billboard);
      if (target.sign) setSign(target.sign);
      if (target.emblem) emblems.select(target.emblem);
      /* Часть здания в кадре — её страница в «Здании»; «Всё здание» — общий вид. */
      if (target.tool === "building")
        setPartPage(buildingPlaceParts(place).some((part) => part.id === target.part) ? target.part : "");
      setAim((current) => ({ count: current.count + 1, key: target.part || target.element || "" }));
    },
    [models, emblems, setTool, setSide, setBillboard, setSign, place, pickItem],
  );

  /* Надпись-плашка (у здания без своей надписи) — в руке, пока открыто название здания в «Тексте». */
  useEffect(() => {
    if (placing === "title" && !titlePage) setPlacing(null);
  }, [titlePage, placing]);
  const inHand = placing === "title" ? "title" : emblems.placing ? "emblem" : null;

  const onBuilding = useCallback((patch, label) => commit((current) => ({ ...current, building: { ...current.building, ...patch } }), label), [commit]);
  const onPart = useCallback(
    (id, patch, label) => commit((current) => ({ ...current, parts: { ...current.parts, [id]: { ...current.parts[id], ...patch } } }), label),
    [commit],
  );
  /* «Узоры»: узор в руке и куда лёг последний; щелчок по части здания кладёт его на неё. */
  const [stamp, setStamp] = useRememberedState(`${place}:stamp`, DEFAULT_STAMP);
  const [stampedOn, setStampedOn] = useState("");
  const onStampAim = useCallback(
    (hit) => {
      if (models.onAim?.(hit)) return;
      const target = buildingAimTarget(place, hit);
      if (target?.tool !== "building" || !target.part) {
        onNotice?.(tr("Сюда узор не ляжет — щёлкните по стене, крыше, козырьку или земле."), "info");
        return;
      }
      onPart(target.part, stampFinish(stamp), `${tr(partLabel(target.part))}: ${tr("узор")}`);
      setStampedOn(tr(partLabel(target.part)));
    },
    [models, place, onPart, stamp, onNotice],
  );
  /* Сторона здания; `ids` — сразу несколько («Все четыре стороны сразу»: одна картинка на каждую). */
  const onSide = useCallback(
    (ids, patch, label) =>
      commit((current) => {
        const sides = { ...current.sides };
        for (const id of [].concat(ids)) sides[id] = { ...sides[id], ...patch };
        return { ...current, sides };
      }, label),
    [commit],
  );
  /* Сторона щита на крыше; `ids` — сразу несколько (одно фото на все щиты). */
  const onBillboard = useCallback(
    (ids, patch, label) =>
      commit((current) => {
        const billboards = { ...current.billboards };
        for (const id of [].concat(ids)) billboards[id] = { ...billboards[id], ...patch };
        return { ...current, billboards };
      }, label),
    [commit],
  );
  const onTitle = useCallback((patch, label) => commit((current) => ({ ...current, title: { ...current.title, ...patch } }), label), [commit]);
  const onSign = useCallback(
    (id, patch, label) => commit((current) => ({ ...current, signs: { ...current.signs, [id]: { ...current.signs[id], ...patch } } }), label),
    [commit],
  );
  /* Своя надпись одного места таблички (задача 10): `value` — текст места или `null` — как у таблички. */
  const onSignPlace = useCallback(
    (key, value, label) =>
      commit((current) => {
        const signPlaces = { ...(current.signPlaces || {}) };
        if (value) signPlaces[key] = { ...(signPlaces[key] || {}), ...value };
        else delete signPlaces[key];
        return { ...current, signPlaces };
      }, label),
    [commit],
  );
  /* Место по умолчанию — главный фасад (место эмблемы описи). */
  const onResetEmblem = useCallback(() => {
    emblems.patch({ ...buildingEmblemPlace(place), angle: 0 }, "Эмблема: на фасад");
  }, [emblems, place]);

  /* Место из кадра: эмблема или надпись в руке, или надпись-плашка. */
  const onPlace = useCallback(
    (spot) => {
      if (placing === "title") {
        /* Надпись-плашка ведётся только точкой стены. */
        if (spot?.point) onTitle({ point: spot.point, normal: spot.normal }, "Надпись: место");
      } else if (emblems.placing) emblems.place(spot);
    },
    [placing, onTitle, emblems],
  );
  /* Размер и поворот из кадра — от того, что в работе сейчас. */
  const onAdjust = useCallback(
    (update, label) => {
      if (placing !== "title") {
        emblems.adjust(update, label);
        return;
      }
      commit((current) => {
        const values = update(current.title);
        return values ? { ...current, title: { ...current.title, ...values } } : current;
      }, label);
    },
    [commit, placing, emblems],
  );

  /* Картинка на стене (3В): запись стены из студии — в работу; та же стена заменяет свою плашку, другая — встаёт рядом. */
  const onWallPlace = useCallback(
    (record) => commit((current) => ({ ...current, walls: normalizeBuildingWalls([...(current.walls || []), record]) }), "Картинка на стене"),
    [commit],
  );
  const onWallRemove = useCallback((id) => commit((current) => ({ ...current, walls: (current.walls || []).filter((item) => item.id !== id) }), "Картинка со стены снята"), [commit]);

  const onPreset = useCallback((preset) => replace((current) => applyBuildingPreset(place, current, preset.id), `Готовый вид: ${preset.label}`), [replace, place]);
  const onStandard = useCallback(() => replace((current) => applyBuildingStandard(place, current), "Как в игре"), [replace, place]);

  const deferred = useDeferredValue(project);
  /* Кадр здания для «Студии»: тот же кадр с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback((live, hint) => <BuildingStage place={place} project={live} focus={hint?.focus} wall={hint?.wall} />, [place]);
  if (!buildingInventory(place)) return <p className="model-stage-note">{tr("Этого здания нет в этой версии Astral.")}</p>;

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor building-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={words.studio}
      status={editor.status}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      toolShortcuts={rail.shellShortcuts}
      panelHead={
        tool === "building" && partPage && !models.active
          ? {
              label: tr(partLabel(partPage)),
              note: partCount > 1 ? `${tr("Часть здания")} · ${countedIn(partCount, THING_WORDS)}` : tr("Часть здания"),
              back: { label: tr("Ко всему зданию"), onClick: () => setPartPage("") },
            }
          : titlePage && !models.active
            ? { label: tr("Название здания"), back: { label: tr("К своим надписям"), onClick: () => setTextPage("") } }
            : signHead || rail.panelHead
      }
      guide={models.active ? models.guide : editor.guide(Boolean(inHand), { aim: tool === "items" ? tr(BUILDING_ITEMS_COPY.aim) : tr("править то, что под курсором") })}
      guideKey={place}
      guideFlash={inHand ? "placing" : editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <>
          {rail.switcher}
          {models.active ? (
          models.panel
        ) : tool === "items" ? (
          <SceneItemsSection
            adapter={itemsAdapter}
            objects={itemObjects}
            asset={sceneAsset}
            shots={itemShots}
            selection={sceneItems.selection}
            onSelect={sceneItems.onSelect}
            onScope={sceneItems.onScope}
            onFind={sceneItems.onFind}
            onHover={sceneItems.onHover}
            onNotice={onNotice}
            onTool={rail.onTool}
            home={itemsHome}
            note={BUILDING_ITEMS_COPY.editorNote}
            links={[{ tool: "building", label: BUILDING_ITEMS_COPY.link }]}
            removalReason={itemsKnown ? BUILDING_ITEMS_COPY.removalShell : BUILDING_ITEMS_COPY.removal}
            {...(itemsKnown
              ? {
                  removed: project.removed,
                  removable: removableItem,
                  onRemove: onItemRemove,
                  onRestore: onItemRestore,
                  removeLabels: { removed: BUILDING_ITEMS_COPY.removed },
                  renderLook: ({ item, model, scope, element, part }) => (
                    <PlaceItemLook adapter={lookAdapter} item={item} scope={scope} looks={project.items} removed={project.removed} name={tr(model.name)} onLook={onItemLook} onNotice={onNotice} element={element} part={part} elements={elementsOf?.(item.key)} />
                  ),
                  partsOf: sceneItems.partsOf,
                  onPiece: sceneItems.onPiece,
                  elementsOf,
                  onElement: sceneItems.onElement,
                  looks: project.items,
                  onUp: sceneItems.onUp,
                  onToggle: sceneItems.onToggle,
                  renderMulti: ({ keys }) => <MultiLook adapter={lookAdapter} keys={keys} looks={project.items} removed={project.removed} onLook={onItemLook} onNotice={onNotice} />,
                }
              : {})}
          />
        ) : (
          <StudioLiveProvider project={project} render={renderLive} wall={wall}>
            <BuildingInspector
              place={place}
              tool={tool}
              project={project}
              side={side}
              onSideId={setSide}
              billboard={billboard}
              onBillboardId={setBillboard}
              onBillboard={onBillboard}
              sign={sign}
              onSignId={onSignPick}
              emblems={emblems}
              onResetEmblem={onResetEmblem}
              onBuilding={onBuilding}
              onPart={onPart}
              onSide={onSide}
              onTitle={onTitle}
              onSign={onSign}
              onSignPlace={onSignPlace}
              onStandard={onStandard}
              onPreset={onPreset}
              onNotice={onNotice}
              placing={placing}
              onPlacing={setPlacing}
              textPage={textPage}
              onTextPage={setTextPage}
              stampPanel={<PatternStampSection stamp={stamp} onStamp={setStamp} last={stampedOn} />}
              aim={aim}
              partPage={partPage}
              onPartPage={setPartPage}
              onWallPlace={onWallPlace}
              onWallRemove={onWallRemove}
            />
          </StudioLiveProvider>
        )}
        </>
      }
    >
      <BuildingStage
        place={place}
        project={emblems.hide(deferred)}
        placing={inHand}
        placingLabel={inHand === "title" ? tr("Надпись в руке") : emblemPlacingLabel(tool)}
        onPlace={onPlace}
        onAdjust={onAdjust}
        textStage={emblems.stage}
        onPlaced={() => (placing === "title" ? setPlacing(null) : emblems.setPlacing(false))}
        onCamera={editor.onCamera}
        focusSide={tool === "sides" && side !== SIDES_ALL ? side : null}
        /* Рамка по синей стене: у выбранной стороны (или у всех четырёх) — контур, докуда дойдёт картинка. */
        frameSides={tool === "sides" ? (side === SIDES_ALL ? BUILDING_SIDE_IDS : [side]) : null}
        focusBillboard={tool === "billboards" ? billboard : null}
        focusSign={tool === "signs" && shot?.tool === "signs" ? shot.sign : null}
        shot={shot}
        {...models.stageProps}
        items={{ ...sceneItems, active: tool === "items" && !models.active, objects: itemObjects, shots: itemShots, onMove: onItemMove }}
        onAsset={setSceneAsset}
        /* После свойств «Моделей»: щелчок сам спрашивает их первыми. */
        onAim={tool === "patterns" ? onStampAim : onAim}
        wall={wall}
        /* Страница названия в «Тексте» светит буквы названия, как прежняя «Надпись». */
        tool={titlePage ? "title" : tool}
        aimKey={aim.key}
        sign={sign}
        overlay={models.bar}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
