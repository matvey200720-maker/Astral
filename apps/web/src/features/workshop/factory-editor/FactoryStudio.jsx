/*
 * Завод: облик корпусов (целиком и по частям), земли, контейнеров и
 * реквизита мода «серого» завода в пустыне Гранд-Сенора и своя эмблема в
 * любом месте.
 *
 * Мод заменяет текстуры завода и реквизита вокруг плашками 4×4 одного
 * серого цвета. Редактор красит их по группам: корпуса (и их части —
 * стены, крыши, бетон, металл, конвейеры, детали), земля, контейнеры
 * (одним цветом, разноцветные или радугой, с наклейками или без) и
 * реквизит; у всех — общая отделка и «Стандарт GTA». Кадр — весь завод в
 * 3D на матовом фоне; облик в кадре меняется сразу.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): группы,
 * эмблема и готовые виды — инструменты слева, справа — настройки взятого.
 * Эмблема — отдельный инструмент: пока он в руке, левая кнопка ставит её
 * на стену, и строка управления говорит об этом сама.
 *
 * Общее с остальными редакторами мест (работа, черновик, «Мои работы»,
 * «Применить», камера) — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Buildings, CursorClick, Cube, Mountains, Package, Sticker, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { FACTORY_GROUPS, FACTORY_PARTS, applyFactoryPreset, factoryItemModel } from "@modovik/climb-contract/recolor/factory";
import { setPlaceItemLook } from "@modovik/climb-contract/recolor/place-item-looks";
import { applyItemLook } from "../items-panel/item-set-looks.js";
import { itemMoveLook } from "../items-panel/item-look-objects.js";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import { withoutNote } from "../../../components/ui/editor-rail-groups.js";
import { emblemKindOf, emblemPlacingLabel, emblemToolActive, emblemTools } from "../emblem/emblem-tools.jsx";
import { useEmblemEditor } from "../emblem/useEmblemEditor.js";
import { modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import FactoryInspector from "./FactoryInspector.jsx";
import { FACTORY_STORAGE_KEY, carryFactoryDraft } from "./factory-draft.js";
import { factoryImages } from "./factory-images.js";
import { FACTORY_ITEMS_COPY, FACTORY_VIEW_YAW, factoryItemsAdapter, factoryRemovable, factorySceneObjects, factorySelectionKind } from "./factory-items.js";
import { groupKeys, viewHome } from "../items-panel/items-frame.js";
import { factoryAimSpec } from "./factory-aim.js";
import { createItemShots } from "../items-panel/item-shots.js";
import { sceneInventory } from "../items-panel/items-inventory.js";
import SceneItemsSection from "../items-panel/SceneItemsSection.jsx";
import PlaceItemLook from "../items-panel/PlaceItemLook.jsx";
import { MultiLook } from "../arena-editor/arena-item-look.jsx";
import { THING_WORDS, countedIn } from "../counted-words.js";
import { placeItemLookAdapter, placeItemPlaceOf } from "../items-panel/place-item-look.js";
import { createElementsOf } from "../items-panel/scene-elements.js";
import { useSceneItems } from "../items-panel/use-scene-items.js";
import FactoryStage from "./FactoryStage.jsx";
import { usePatternStamp, patternTool } from "../finish/PatternStamp.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { wallFromHit } from "../texture-studio/wall-pick.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Кадр завода для «Студии»: тот же кадр с работой, где на месте поверхности стоит холст студии. */
const renderFactoryLive = (project, hint) => <FactoryStage project={project} focus={hint?.focus} wall={hint?.wall} />;

const readEmblems = (project) => project.emblems;
const writeEmblems = (project, emblems) => ({ ...project, emblems });

/*
 * Инструменты завода. Цифры — горячие клавиши: буквы в 3D-кадре заняты
 * полётом (W A S D, Q и E).
 */
const FACTORY_TOOLS = Object.freeze([
  {
    id: "buildings",
    label: "Корпуса",
    icon: <Buildings />,
    shortcut: "1",
    group: "paint",
    hint: "Выберите отделку корпусов справа — кадр покажет её сразу. Части корпуса красятся отдельно",
  },
  {
    id: "ground",
    label: "Земля",
    icon: <Mountains />,
    shortcut: "2",
    group: "paint",
    hint: "Земля двора — своя отделка, независимо от корпусов",
  },
  {
    id: "containers",
    label: "Контейнеры",
    icon: <Package />,
    shortcut: "3",
    group: "paint",
    hint: "Контейнеры завода: новый облик — только у завода, по карте — штатные",
  },
  {
    id: "props",
    label: "Реквизит",
    icon: <Cube />,
    shortcut: "4",
    group: "paint",
    hint: "Реквизит завода: новый облик — только у завода, по карте — штатный",
  },
  /* Узор щелчком по части корпуса, земле, контейнеру или реквизиту (19.10.2026). */
  patternTool({ shortcut: "9" }),
  /* Эмблемы и надписи — два инструмента общей системы (задача 1). */
  ...emblemTools({ where: "в любом месте завода", shortcuts: ["5", "6"] }),
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
  modelsTool({ where: "на заводе и вокруг", shortcut: "7" }),
  /* Всё, что стоит на заводе, по одной вещи (ТЗ владельца 26.10.2026, п. A). */
  {
    id: "items",
    label: "Предметы",
    icon: <CursorClick />,
    group: "models",
    hint: FACTORY_ITEMS_COPY.hint,
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "8",
    group: "ready",
    hint: "Готовый вид красит все группы разом — дальше любую можно поправить",
  },
].map(withoutNote));

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B): девять значков — четыре. «Облик» (корпуса, земля, контейнеры, реквизит),
 * «Рисунки» (узоры, эмблемы, текст), «Модели», «Шаблоны». Прежние инструменты остаются: панели, цифры 1–9 (каждая
 * открывает свой пункт), запись factory:tool.
 */
const FACTORY_RAIL = Object.freeze([
  { id: "look", ids: ["buildings", "ground", "containers", "props"], label: "Облик", icon: <Buildings />, group: "paint", demo: "paint", tabs: true },
  { id: "decals", ids: ["emblem", "patterns", "text"], label: "Рисунки", icon: <Sticker />, group: "emblem", demo: "emblem", tabs: true },
]);

/* Итог установки одной строкой. */
function factoryDoneText(result) {
  if (result?.status === "unchanged") return tr("Завод в игре уже такой — ставить было нечего");
  return result?.emblem ? tr("Завод установлен вместе с эмблемой. Перезапустите игру.") : tr("Завод установлен. Перезапустите игру.");
}

/* Место вещи завода в сцене кадра (части вещи — по правилу установки). */
const FACTORY_ITEM_PLACE_OF = placeItemPlaceOf("factory");

export default function FactoryStudio({ onExit, onNotice }) {
  useTr();
  /* До черновика: нетронутый серый уступает место «Стандарту GTA» (`factory-draft.js`). */
  useState(() => carryFactoryDraft());
  const [tool, setTool] = useRememberedState("factory:tool", "buildings");
  /*
   * Открытая страница части корпуса («» — весь корпус): щелчок по детали в
   * кадре открывает её, подсветка идёт за ней, без страницы светятся все корпуса.
   */
  const [part, setPart] = useState("");
  /* Счёт щелчков по детали: колонка подводит к нужному полю (`focus` — к какому). */
  const [aim, setAim] = useState({ count: 0, focus: "" });
  /* Стена, по которой щёлкнули в кадре (3Б ТЗ 18.10.2026): «Студия» её части откроется на ней. */
  const [wall, setWall] = useState(null);
  const editor = useRecolorEditor({
    set: "factory",
    contract: RECOLOR_PROJECTS.factory,
    storageKey: FACTORY_STORAGE_KEY,
    title: tr("Завод"),
    coverSlotId: "factory",
    onNotice,
    /* Исходное — «Как в игре», серый вид мода — «Серый мода» (п. 15 `design-qa.md`). */
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Серый мода"),
    resetNotice: tr("Завод как в игре"),
    savedText: tr("Ставим завод в игру"),
    doneText: factoryDoneText,
    rolledBackText: tr("Завод снят из игры — остальные моды на месте"),
    images: factoryImages,
  });
  const { project, commit, replace } = editor;

  /* «Предметы»: опись вещей сцены завода (выпекает H3, `scene.objects`), выбор вещи и кадры для плиток. */
  const [sceneAsset, setSceneAsset] = useState(null);
  const itemShots = useMemo(() => createItemShots(), []);
  const itemObjects = useMemo(() => sceneInventory(factorySceneObjects(), { selectionKindOf: factorySelectionKind }), []);
  const itemsAdapter = useMemo(() => factoryItemsAdapter(), []);
  /* Части вещи — с местом вещи (рамка части в осях модели, как вырежет установка) и именем модели для плашки «… за кадром». */
  /* «Облик предмета» (ТЗ 27.10.2026): своя модель, цвет или картинка вещам; элементы вещи — листы её модели (вариант A разбора 31.10.2026). */
  const lookAdapter = useMemo(() => placeItemLookAdapter("factory", factoryItemModel, sceneAsset), [sceneAsset]);
  const elementsOf = useMemo(() => createElementsOf(sceneAsset, { paintable: (key) => lookAdapter.paintable({ key }) }), [sceneAsset, lookAdapter]);
  const sceneItems = useSceneItems({ objects: itemObjects, asset: sceneAsset, placeOf: FACTORY_ITEM_PLACE_OF, titleOf: itemsAdapter.titleOf, elementsOf });
  const itemsHome = useMemo(() => viewHome(sceneAsset, FACTORY_VIEW_YAW), [sceneAsset]);
  const { forget: forgetFound } = sceneItems;
  useEffect(() => {
    if (tool !== "items") forgetFound();
  }, [tool, forgetFound]);
  /* «Удалить» и «Откатить» (ТЗ 26.10.2026, п. A4): номер вещи уходит в `project.removed` — кадр её прячет, установщик убирает из карт района. */
  const onItemRemove = useCallback(
    (keys, label) =>
      commit((current) => ({
        ...current,
        /* Убранной вещи облик ни к чему: она уходит из своих групп (опустевшая группа — прочь). */
        items: current.items?.length ? setPlaceItemLook(current.items, keys, null) : current.items,
        removed: [...new Set([...(current.removed || []), ...keys])].sort((a, b) => a - b),
      }), label),
    [commit],
  );
  /* Облик вещам: `null` — как в игре (у части — только она, `part`). Групп (копий моделей) не больше предела. */
  const projectNow = useRef(project);
  projectNow.current = project;
  const onItemLook = useCallback(
    (keys, look, label, part = look?.part || null) => {
      /* Набор вещей разных моделей (Shift) — по группе на модель одним шагом; групп больше предела — отказ с числами. */
      const { refusal } = applyItemLook(projectNow.current.items, keys, look, factoryItemModel, part);
      if (refusal) {
        onNotice?.(refusal, "error");
        return;
      }
      commit((current) => ({ ...current, items: applyItemLook(current.items, keys, look, factoryItemModel, part).items ?? current.items }), label);
    },
    [commit, onNotice],
  );
  /* Протяжка замены мышью (владелец 01.11.2026): сдвиг сцены — в оси модели вещи и к сдвигу облика (`itemMoveLook`), одним шагом истории. */
  const onItemMove = useCallback(
    (key, delta) => {
      const moved = itemMoveLook(projectNow.current.items, key, delta, FACTORY_ITEM_PLACE_OF);
      if (moved) onItemLook(moved.keys, moved.look, tr("перемещение"));
    },
    [onItemLook],
  );
  const onItemRestore = useCallback(
    (keys, label) => commit((current) => ({ ...current, removed: (current.removed || []).filter((key) => !keys.includes(key)) }), label),
    [commit],
  );

  /* Эмблемы и надписи — списком: у каждой своё место, картинка и настройки. */
  const emblems = useEmblemEditor({
    project,
    commit,
    amend: editor.amend,
    read: readEmblems,
    write: writeEmblems,
    active: emblemToolActive(tool),
    kind: emblemKindOf(tool),
    onNotice,
  });

  const models = usePlaceModels({ editor, scene: "factory", tool, onTool: setTool, where: "на заводе и вокруг", onNotice });

  /* Инструмент взяли из колонки, а не щелчком по детали — колонку никуда не подводим. */
  const onTool = useCallback(
    (next) => {
      setTool(next);
      setPart("");
      setWall(null);
      setAim((current) => (current.focus ? { ...current, focus: "" } : current));
    },
    [setTool],
  );

  /* Группа «Облика» щелчком над панелью (владелец 31.10.2026: «камеру меняло, когда тыкаешь»): камера к ней, повторный щелчок — туда же (`at`). */
  const [shot, setShot] = useState(null);
  const onSwitch = useCallback((next) => {
    if (FACTORY_RAIL[0].ids.includes(next)) setShot({ tool: next, at: Date.now() });
  }, []);
  const rail = useRailGroups({ groups: FACTORY_RAIL, tools: FACTORY_TOOLS, tool, onTool, letters: true, onSwitch });
  /* Групповой инструмент «Облика» (корпуса, контейнеры, реквизит) правит все вещи группы разом: в шапке — сколько их («Облик», под ним «Реквизит ·
     37 вещей»; п. 7 `docs/3D-ELEMENTS-PICTURES.md`), охват виден до правки. Счёт — тот же набор, что светит кадр (`factoryAimSpec`). Одна вещь
     (земля) — шапка, как была. */
  const lookTool = FACTORY_RAIL[0].ids.includes(tool) ? FACTORY_TOOLS.find((entry) => entry.id === tool) : null;
  const groupCount = lookTool ? groupKeys(sceneAsset, factoryAimSpec(tool)).size : 0;
  const groupHead = groupCount > 1 ? { label: tr(FACTORY_RAIL[0].label), note: `${tr(lookTool.label)} · ${countedIn(groupCount, THING_WORDS)}` } : rail.panelHead;

  /*
   * Щелчок по детали в кадре (18.10.2026): своя модель — «Модели», корпус —
   * «Корпуса» с частью нажатой детали, земля, контейнер, реквизит — их инструмент.
   * Вещь описи (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, 31.10.2026) — «Предметы» на ней: правится она одна, а не вся группа.
   */
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
      setWall(target.part ? wallFromHit(hit) : null);
      setTool(target.tool);
      /* Граффити — переключатель на странице всех корпусов, остальные детали — страница своей части. */
      setPart(target.part && target.focus !== "graffiti" ? target.part : "");
      setAim((current) => ({ count: current.count + 1, focus: target.focus || "" }));
    },
    [models, setTool, setPart, pickItem],
  );

  const patchGroup = useCallback(
    (group, values, label) => commit((current) => ({ ...current, [group]: { ...current[group], ...values } }), label),
    [commit],
  );
  const patchPart = useCallback(
    (part, values, label) =>
      commit((current) => ({ ...current, parts: { ...current.parts, [part]: { ...current.parts[part], ...values } } }), label),
    [commit],
  );

  /* «Узоры»: часть корпуса — своей частью, земля, контейнеры и реквизит — всей группой. */
  const stamp = usePatternStamp("factory", {
    onNotice,
    apply: useCallback(
      (target, finish) => {
        if (!target) return null;
        if (target.tool === "buildings" && target.part) {
          const label = FACTORY_PARTS.find((item) => item.id === target.part)?.label || target.part;
          patchPart(target.part, finish, `${label}: узор`);
          return tr(label);
        }
        const group = FACTORY_GROUPS.find((item) => item.id === target.tool);
        if (!group || !group.modes.includes("pattern")) return null;
        patchGroup(group.id, finish, `${group.label}: узор`);
        return tr(group.label);
      },
      [patchPart, patchGroup],
    ),
  });

  /* Граффити на стенах: как в игре или убраны (задача 11 ТЗ 17.10.2026). */
  const onGraffiti = useCallback(
    (on) => commit((current) => ({ ...current, graffiti: on ? "keep" : "hidden" }), tr(on ? "Граффити: как в игре" : "Граффити убраны")),
    [commit],
  );

  const onPreset = useCallback(
    (preset) => replace((current) => applyFactoryPreset(current, preset.id), `Готовый завод: ${preset.label}`),
    [replace],
  );

  /* «Как в игре» — все группы штатными листами игры одним шагом. */
  const onStandard = useCallback(() => replace((current) => applyFactoryPreset(current, "standard"), "Как в игре"), [replace]);

  /* Кадр догоняет правку в свободное время окна. */
  const deferred = useDeferredValue(project);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor factory-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская завода")}
      status={editor.status}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      toolShortcuts={rail.shellShortcuts}
      panelHead={part ? null : models.active ? rail.panelHead : groupHead}
      guide={models.active ? models.guide : editor.guide(emblems.placing, { aim: tool === "items" ? tr(FACTORY_ITEMS_COPY.aim) : tr("править деталь под курсором") })}
      guideKey="factory"
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
            note={FACTORY_ITEMS_COPY.editorNote}
            links={[{ tool: "buildings", label: FACTORY_ITEMS_COPY.link }]}
            removalReason={FACTORY_ITEMS_COPY.removal}
            removed={project.removed}
            removable={factoryRemovable}
            onRemove={onItemRemove}
            onRestore={onItemRestore}
            removeLabels={{ removed: FACTORY_ITEMS_COPY.removed }}
            renderLook={({ item, model, scope, element, part }) => (
              <PlaceItemLook adapter={lookAdapter} item={item} scope={scope} looks={project.items} removed={project.removed} name={tr(model.name)} onLook={onItemLook} onNotice={onNotice} element={element} part={part} elements={elementsOf(item.key)} />
            )}
            partsOf={sceneItems.partsOf}
            onPiece={sceneItems.onPiece}
            elementsOf={elementsOf}
            onElement={sceneItems.onElement}
            looks={project.items}
            onUp={sceneItems.onUp}
            onToggle={sceneItems.onToggle}
            renderMulti={({ keys }) => <MultiLook adapter={lookAdapter} keys={keys} looks={project.items} removed={project.removed} onLook={onItemLook} onNotice={onNotice} />}
          />
        ) : tool === "patterns" ? (
          stamp.panel
        ) : (
          <StudioLiveProvider project={project} render={renderFactoryLive} wall={wall}>
            <FactoryInspector
              tool={tool}
              project={project}
              partPage={part}
              onPartPage={setPart}
              aim={aim}
              onGroup={patchGroup}
              onPart={patchPart}
              onGraffiti={onGraffiti}
              emblems={emblems}
              onStandard={onStandard}
              onPreset={onPreset}
              onNotice={onNotice}
            />
          </StudioLiveProvider>
        )}
        </>
      }
    >
      <FactoryStage
        project={emblems.hide(deferred)}
        shot={shot}
        placing={emblems.placing}
        placingLabel={emblemPlacingLabel(tool)}
        onPlace={emblems.place}
        onAdjust={emblems.adjust}
        textStage={emblems.stage}
        onPlaced={() => emblems.setPlacing(false)}
        onCamera={editor.onCamera}
        {...models.stageProps}
        items={{ ...sceneItems, active: tool === "items" && !models.active, objects: itemObjects, shots: itemShots, onMove: onItemMove }}
        onAsset={setSceneAsset}
        /* После свойств «Моделей»: щелчок сам спрашивает их первыми. */
        onAim={tool === "patterns" ? stamp.onAim : onAim}
        wall={wall}
        tool={tool}
        part={part}
        overlay={models.bar}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
