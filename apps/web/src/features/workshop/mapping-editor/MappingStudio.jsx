/*
 * Маппинг: цвет мест карты из мода маппинга — ферма, база байкеров,
 * разбитый самолёт, парковка сервера и хлам вокруг.
 *
 * Мод перекрашивает эти места в серое своими листами. Редактор показывает
 * список мест; выбранное место стоит в кадре в 3D со своими листами, и его
 * цвет меняется мгновенно. Какие файлы к какому месту — опись набора
 * (`scripts/lib/mapping-locations.mjs`): новое место появляется в списке
 * само после перегенерации набора.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): инструменты
 * слева, справа — настройки взятого; место в кадре меняется и списком над кадром.
 *
 * ТЗ 22.10.2026 (владелец: «облегчить, не удаляя функционал — объединить»): семь инструментов — «Цвет», «Места»,
 * «Узоры», «Эмблемы», «Текст», «Модели», «Шаблоны» — стали тремя. «Облик»: готовые виды → места → цвет выбранного
 * места. «Рисунки»: узор, эмблема или надпись — выбор в панели. «Модели» — общий инструмент мастерской. Старые имена
 * инструментов в памяти открывают новые (`LEGACY_TOOLS`).
 *
 * Общее с «Запретными зонами», «Заводом» и «Ангаром» — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CursorClick, PaintBucket, Shapes, Sticker, Swatches, TextT } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  MAPPING_LOCATIONS,
  applyMappingPreset,
  copyMappingLocationToAll,
  findMappingLocation,
  mappingDefaultDecal,
  mappingItemKey,
  mappingItemModel,
} from "@modovik/climb-contract/recolor/mapping";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { withoutNote } from "../../../components/ui/editor-rail-groups.js";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { mappingImages } from "./mapping-images.js";
import { MAPPING_ITEMS_COPY, MAPPING_VIEW_YAW, mappingItemsAdapter, mappingSceneObjects, mappingSelectionKind } from "./mapping-items.js";
import { mappingSceneOf, mappingStatusText } from "./mapping-text.js";
import { emblemKindOf, emblemPlacingLabel, emblemToolActive } from "../emblem/emblem-tools.jsx";
import { useEmblemEditor } from "../emblem/useEmblemEditor.js";
import { modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import { groupKeys, viewHome } from "../items-panel/items-frame.js";
import { THING_WORDS, countedIn } from "../counted-words.js";
import { mappingAimLocation } from "./mapping-aim.js";
import { sceneInventory } from "../items-panel/items-inventory.js";
import { createItemShots } from "../items-panel/item-shots.js";
import SceneItemsSection from "../items-panel/SceneItemsSection.jsx";
import PlaceItemLook from "../items-panel/PlaceItemLook.jsx";
import { MultiLook } from "../arena-editor/arena-item-look.jsx";
import { createElementsOf } from "../items-panel/scene-elements.js";
import { MAPPING_PLACE_OF, mappingItemsPlaced, mappingLookAdapter, mappingLookItem, mappingWithLook } from "./mapping-item-look.js";
import { applyItemLook } from "../items-panel/item-set-looks.js";
import { itemMoveLook } from "../items-panel/item-look-objects.js";
import { useSceneItems } from "../items-panel/use-scene-items.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import MappingInspector from "./MappingInspector.jsx";
import MappingStage from "./MappingStage.jsx";
import { usePatternStamp } from "../finish/PatternStamp.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { wallFromHit } from "../texture-studio/wall-pick.js";
import { tr, useTr } from "../../../locales/ui.js";

const MAPPING_STORAGE_KEY = "astral.mapping.project.v1";
/* У вещей мест нет «Удалить» (ТЗ 26.10.2026): убранных нет. */
const NO_REMOVED = Object.freeze([]);

/*
 * Инструменты маппинга. Цифры — горячие клавиши: буквы в 3D-кадре заняты
 * полётом (W A S D, Q и E).
 */
const MAPPING_TOOLS = Object.freeze([
  {
    id: "look",
    label: "Облик",
    icon: <PaintBucket />,
    shortcut: "1",
    group: "paint",
    hint: "Изначально у всех мест штатные здания игры: выберите готовый вид или место и цвет — место в кадре сменится сразу",
  },
  {
    id: "decals",
    label: "Рисунки",
    icon: <Sticker />,
    shortcut: "2",
    group: "emblem",
    hint: "Выберите справа, что ставим — узор, эмблему или надпись, — и щёлкните по месту в кадре",
  },
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер); пояснения под именем панели нет (п. 9 `design-qa.md`). */
  withoutNote(modelsTool({ where: "на ферме, базе или у самолёта", shortcut: "3" })),
  /* Всё, что стоит на месте, по одной вещи (ТЗ владельца 26.10.2026, п. A). */
  {
    id: "items",
    label: "Предметы",
    icon: <CursorClick />,
    shortcut: "4",
    group: "models",
    hint: MAPPING_ITEMS_COPY.hint,
  },
  /* Готовые виды — своей вкладкой, как у остальных редакторов мест (п. 20 `design-qa.md`), а не свёрнутой строкой на «Облике». */
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "5",
    group: "ready",
    hint: "Готовый вид красит все места разом — дальше любое можно поправить",
  },
]);

/* Что ставит «Рисунки»: узор щелчком по месту со штатными моделями (19.10.2026), эмблема-картинка, надпись. */
const DECAL_MODES = Object.freeze(["patterns", "emblem", "text"]);
/* Прежние имена инструментов (до 22.10.2026) → инструмент, в который переехала их панель, и вид «Рисунков». */
const LEGACY_TOOLS = Object.freeze({
  colour: "look",
  places: "look",
  patterns: "decals",
  emblem: "decals",
  text: "decals",
});
const LEGACY_DECALS = Object.freeze({ patterns: "patterns", emblem: "emblem", text: "text" });

function mappingDoneText(result) {
  if (result?.status === "unchanged")
    return tr("Маппинг в игре уже такой — ставить было нечего");
  return result?.emblem ? tr("Маппинг установлен вместе с эмблемой. Перезапустите игру.") : tr("Маппинг установлен. Перезапустите игру.");
}

const readEmblems = (project) => project.emblems;
const writeEmblems = (project, emblems) => ({ ...project, emblems });

/* Подпись места модели в списке. */
const mappingPlaceLabel = (id) => findMappingLocation(id)?.title || "";

export default function MappingStudio({ onExit, onNotice }) {
  useTr();
  const [rememberedTool, setTool] = useRememberedState("mapping:tool", "look");
  const tool = MAPPING_TOOLS.some((item) => item.id === rememberedTool) ? rememberedTool : LEGACY_TOOLS[rememberedTool] || "look";
  const [rememberedDecal, setDecal] = useRememberedState("mapping:decal", LEGACY_DECALS[rememberedTool] || "emblem");
  const decal = DECAL_MODES.includes(rememberedDecal) ? rememberedDecal : "emblem";
  /* Что в руке, если смотреть по-старому: «Облик», «Модели» или один из видов «Рисунков» — им живут эмблемы, узор и кадр. */
  const mode = tool === "decals" ? decal : tool;
  /* Стена, по которой щёлкнули в кадре (3Б ТЗ 18.10.2026): «Студия» её места откроется на ней. */
  const [wall, setWall] = useState(null);
  const [locationId, setLocationId] = useRememberedState(
    "mapping:location",
    MAPPING_LOCATIONS[0]?.id || "",
  );
  /* Стена принадлежит месту, по которому щёлкнули: сменили место — её нет. */
  const shownWall = wall && wall.locationId === locationId ? wall : null;
  /* Исходный облик — сама игра (ТЗ 10.10.2026, задача 16: «изначально
     стандартные здания, а не с модом сразу. Для всех»): «Стандарт» — все
     места как в игре, ставить нечего, «Применить» снимает установку. */
  const editor = useRecolorEditor({
    set: "mapping",
    contract: RECOLOR_PROJECTS.mapping,
    storageKey: MAPPING_STORAGE_KEY,
    title: tr("Маппинг"),
    coverSlotId: "mapping",
    onNotice,
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    resetNotice: tr("Маппинг как в игре: у всех мест штатные здания"),
    savedText: tr("Ставим маппинг в игру"),
    doneText: mappingDoneText,
    rolledBackText: tr("Маппинг снят из игры — остальные моды на месте"),
    images: mappingImages,
  });
  const { project, commit, replace } = editor;
  const selected = findMappingLocation(locationId)?.id || MAPPING_LOCATIONS[0]?.id;

  /* «Предметы»: опись вещей сцены места в кадре (облик «как в игре» и «как в моде» — две сцены), выбор вещи и кадры для плиток. */
  const place = findMappingLocation(selected);
  const sceneUrl = mappingSceneOf(place, project);
  const [sceneAsset, setSceneAsset] = useState(null);
  const itemShots = useMemo(() => createItemShots(), []);
  const itemObjects = useMemo(() => sceneInventory(mappingSceneObjects(sceneUrl), { selectionKindOf: mappingSelectionKind }), [sceneUrl]);
  const itemsHome = useMemo(() => viewHome(sceneAsset, MAPPING_VIEW_YAW), [sceneAsset]);
  /* «Облик предмета» (ТЗ 27.10.2026): своя модель, цвет или картинка вещам фермы, базы и самолёта; `null` — как в игре. Групп (копий моделей) не больше предела. */
  const lookAdapter = useMemo(() => mappingLookAdapter(selected, sceneAsset), [selected, sceneAsset]);
  const projectNow = useRef(project);
  projectNow.current = project;
  const onItemLook = useCallback(
    (keys, look, label, part = look?.part || null) => {
      /* Набор вещей разных моделей (Shift) — по группе на модель одним шагом; групп больше предела — отказ с числами. */
      const { refusal } = applyItemLook(projectNow.current.items, keys, look, mappingItemModel, part);
      if (refusal) {
        onNotice?.(refusal, "error");
        return;
      }
      commit((current) => mappingWithLook(current, keys, look, part) ?? current, label);
    },
    [commit, onNotice],
  );
  /* Протяжка замены мышью (владелец 01.11.2026): сдвиг сцены — в оси модели вещи и к сдвигу облика (`itemMoveLook`), одним шагом истории; номер сцены — в ключ работы места. */
  const onItemMove = useCallback(
    (key, delta) => {
      const moved = itemMoveLook(projectNow.current.items, mappingItemKey(selected, key), delta, MAPPING_PLACE_OF);
      if (moved) onItemLook(moved.keys, moved.look, tr("перемещение"));
    },
    [onItemLook, selected],
  );
  const itemsAdapter = useMemo(
    () => mappingItemsAdapter({ stock: Boolean(sceneUrl) && sceneUrl === place?.stockScene, placeTitle: place?.title || "" }),
    [sceneUrl, place?.stockScene, place?.title],
  );
  /* Части вещи — с местом вещи (номер сцены → ключ работы места) у мест, чьи вещи ставит игра, и именем модели для плашки «… за кадром». */
  const itemPlaceOf = useMemo(() => (mappingItemsPlaced(selected) ? (entity) => MAPPING_PLACE_OF(mappingItemKey(selected, entity)) : null), [selected]);
  /* Элементы вещи — листы её модели (вариант A разбора 31.10.2026): номер панели — номер сцены, облик — в ключах работы места. */
  const elementsOf = useMemo(() => createElementsOf(sceneAsset, { paintable: (key) => lookAdapter.paintable(mappingLookItem(selected, { key })) }), [sceneAsset, lookAdapter, selected]);
  const sceneItems = useSceneItems({ objects: itemObjects, asset: sceneAsset, placeOf: itemPlaceOf, titleOf: itemsAdapter.titleOf, elementsOf });
  /* «Облик» места правит все его вещи разом — в шапке сколько их (п. 7 `docs/3D-ELEMENTS-PICTURES.md`): «Облик», под ним «Ферма · 14 вещей». Счёт — по тому
     же признаку места, что у подсветки кадра (`mappingAimLocation`), и тогда, когда в кадре одно это место и кадр его не обводит. */
  const lookCount = tool === "look" && place ? groupKeys(sceneAsset, { where: (info) => mappingAimLocation(info, place.id) === place.id }).size : 0;
  const lookHead = lookCount > 1 ? { label: tr("Облик"), note: `${tr(place.title)} · ${countedIn(lookCount, THING_WORDS)}` } : null;
  const { forget: forgetFound } = sceneItems;
  useEffect(() => {
    if (tool !== "items") forgetFound();
  }, [tool, forgetFound]);

  /* Эмблемы и надписи — списком; новая встаёт на место, на которое смотрит кадр. */
  const newEmblemPlace = useCallback(
    () => (selected ? { location: selected, ...mappingDefaultDecal(selected) } : {}),
    [selected],
  );
  const emblems = useEmblemEditor({
    project,
    commit,
    amend: editor.amend,
    read: readEmblems,
    write: writeEmblems,
    active: emblemToolActive(mode),
    kind: emblemKindOf(mode),
    defaults: newEmblemPlace,
    onNotice,
  });
  /* Эмблема в руке — кадр показывает её место. */
  const emblemPlace = emblems.selected?.location;
  const placing = emblems.placing;
  useEffect(() => {
    if (placing && emblemPlace) setLocationId(emblemPlace);
  }, [placing, emblemPlace, setLocationId]);

  /* Свои модели — у места в кадре; места, что ставит сервер, своих моделей не берут. */
  const placed = findMappingLocation(selected)?.placed > 0;
  const models = usePlaceModels({
    editor,
    scene: selected,
    tool,
    onTool: setTool,
    where: "в этом месте",
    sceneLabel: mappingPlaceLabel,
    onSceneChange: setLocationId,
    blocked: placed ? "" : `У места «${mappingPlaceLabel(selected)}» своих моделей нет — они ставятся на ферме, базе байкеров или у самолёта.`,
    onNotice,
  });

  /*
   * Щелчок по месту в кадре (18.10.2026): своя модель — «Модели», место или хлам
   * вокруг — «Цвет» этого места (кадр переходит к нему, если это другое место).
   */
  /* Вещь описи под щелчком (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, 31.10.2026) — «Предметы» на ней: правится она одна, а не всё место. */
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
      const found = wallFromHit(hit);
      setWall(found ? { ...found, locationId: target.location } : null);
      setTool(target.tool);
      setLocationId(target.location);
    },
    [models, setTool, setLocationId, pickItem],
  );

  const patchLocation = useCallback(
    (id, values, label) =>
      commit(
        (current) => ({
          ...current,
          locations: { ...current.locations, [id]: { ...current.locations[id], ...values } },
        }),
        label,
      ),
    [commit],
  );

  /* «Узоры»: место со штатными моделями игры берёт узор целиком; у остальных — свой цвет, узор не ляжет. */
  const stamp = usePatternStamp("mapping", {
    onNotice,
    miss: tr("Сюда узор не ляжет: у этого места свой цвет, он — в «Цвете»."),
    apply: useCallback(
      (target, finish) => {
        const location = findMappingLocation(target?.location);
        if (!location?.stockEdit) return null;
        patchLocation(location.id, finish, `${location.title}: узор`);
        return tr(location.title);
      },
      [patchLocation],
    ),
  });

  const copyAll = useCallback(
    (id) => {
      commit((current) => copyMappingLocationToAll(current, id), null);
      onNotice?.(`Цвет места «${findMappingLocation(id)?.title}» — у всех мест`);
    },
    [commit, onNotice],
  );

  const onPreset = useCallback(
    (preset) =>
      replace(
        (current) => applyMappingPreset(current, preset.id),
        `Готовый вид: ${preset.label}`,
      ),
    [replace],
  );

  const deferred = useDeferredValue(project);
  /* Честная строка: сколько мест как в игре, как в моде и своим цветом. */
  const status = mappingStatusText(project, project.name || tr("Маппинг"));
  /* Кадр маппинга для «Студии»: тот же кадр (то же место) с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback((live, hint) => <MappingStage project={live} locationId={selected} focus={hint?.focus} wall={hint?.wall} />, [selected]);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor mapping-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская маппинга")}
      status={status}
      /* Имя панели — имя группы на рейке («Рисунки»), а не первый пункт переключателя под ним (критик 30.10.2026, повтор). */
      tools={MAPPING_TOOLS}
      tool={tool}
      panelHead={models.active ? null : lookHead}
      onTool={setTool}
      guide={models.active ? models.guide : editor.guide(placing, { aim: tool === "items" ? tr(MAPPING_ITEMS_COPY.aim) : tr("править место под курсором") })}
      guideKey="mapping"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        models.active ? (
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
            onTool={setTool}
            home={itemsHome}
            note={MAPPING_ITEMS_COPY.editorNote}
            links={[{ tool: "look", label: MAPPING_ITEMS_COPY.link }]}
            removalReason={MAPPING_ITEMS_COPY.removal}
            renderLook={({ item, model, scope, element, part }) => (
              <PlaceItemLook
                adapter={lookAdapter}
                item={mappingLookItem(selected, item)}
                scope={scope}
                looks={project.items}
                removed={NO_REMOVED}
                name={tr(model.name)}
                onLook={onItemLook}
                onNotice={onNotice}
                element={element}
                part={part}
                elements={elementsOf(item.key)}
              />
            )}
            partsOf={sceneItems.partsOf}
            onPiece={sceneItems.onPiece}
            elementsOf={elementsOf}
            onElement={sceneItems.onElement}
            looks={project.items}
            lookKeyOf={(key) => mappingItemKey(selected, key)}
            onUp={sceneItems.onUp}
            onToggle={sceneItems.onToggle}
            renderMulti={({ keys }) => (
              <MultiLook adapter={lookAdapter} keys={keys} looks={project.items} removed={NO_REMOVED} onLook={onItemLook} onNotice={onNotice} lookKeyOf={(key) => mappingItemKey(selected, key)} />
            )}
          />
        ) : (
          <StudioLiveProvider project={project} render={renderLive} wall={shownWall}>
            {/* Что ставим — пунктами значком над словом, как пункты групп у остальных редакторов (п. 13 `design-qa.md`). */}
            {tool === "decals" && (
              <div className="editor-sub-tools is-tabs mapping-decals">
                <SegmentedControl
                  label={tr("Что ставим на место")}
                  size="sm"
                  value={decal}
                  onChange={setDecal}
                  options={[
                    { value: "emblem", label: tr("Эмблемы"), icon: <Sticker /> },
                    { value: "patterns", label: tr("Узоры"), icon: <Shapes /> },
                    { value: "text", label: tr("Текст"), icon: <TextT /> },
                  ]}
                />
              </div>
            )}
            {mode === "patterns" ? (
              stamp.panel
            ) : (
              <MappingInspector
                tool={mode}
                project={project}
                locationId={selected}
                onSelect={setLocationId}
                onLocation={patchLocation}
                onCopyAll={copyAll}
                emblems={emblems}
                onPreset={onPreset}
                onNotice={onNotice}
              />
            )}
          </StudioLiveProvider>
        )
      }
    >
      <MappingStage
        project={emblems.hide(deferred)}
        locationId={selected}
        placing={placing}
        placingLabel={emblemPlacingLabel(mode)}
        onPlace={emblems.place}
        onAdjust={emblems.adjust}
        textStage={emblems.stage}
        onPlaced={() => emblems.setPlacing(false)}
        onCamera={editor.onCamera}
        {...models.stageProps}
        items={{ ...sceneItems, active: tool === "items" && !models.active, objects: itemObjects, shots: itemShots, onMove: onItemMove }}
        onAsset={setSceneAsset}
        /* После свойств «Моделей»: щелчок сам спрашивает их первыми. */
        onAim={mode === "patterns" ? stamp.onAim : onAim}
        wall={shownWall}
        tool={mode}
        overlay={models.bar}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
