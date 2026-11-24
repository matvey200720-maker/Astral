/*
 * Ангар: штатный ангар ограблений из игры игрока — облик стен снаружи и
 * внутри, пол, переключатели нутра (фермы под крышей, кран, лампы), эмблемы
 * и надписи на стенах, свои модели.
 *
 * Ангар стандартный (ТЗ 12.10.2026, ночь; владелец: «чтобы изначально ангар
 * визуально был стандартным… и чтобы человек мог эти сверху железные палки
 * отключать… и лампу включить и выключить»). Новая работа — штатный ангар
 * как в игре: «Применить» в таком виде снимает установку, ставить нечего.
 * Цвет и отделка ложатся на штатные листы ангара (кадр = установщик), фермы
 * и кран уходят из модели нутра, лампы гаснут. Эмблема и надпись — по
 * умолчанию изнутри над воротами, двигаются по стенам прямо в кадре; в игре
 * они встают плашками перед стеной.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): стены,
 * наклейки, нутро и готовые виды — инструменты слева, справа — настройки
 * взятого. Откуда смотреть — пункт «Снаружи / Внутри / Конструкции» над панелью
 * «Отделка» (владелец 31.10.2026: переключателя в шапке больше нет). Это одна
 * сцена с двумя точками камеры, поэтому колонка одна на обе: значок колонки,
 * клавиша и щелчок по видимой детали открывают инструмент, не трогая вид.
 * Эмблема и надпись в руке — пока взят их инструмент; «Ставить» по-прежнему
 * ведёт в зал — там наклейки.
 *
 * Общее с «Заводом», «Маппингом» и «Зданиями» — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Door, House, Lamp, Sticker, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  HANGAR_SIDES,
  applyHangarPreset,
  applyHangarStandard,
} from "@modovik/climb-contract/recolor/hangar";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import { withoutNote } from "../../../components/ui/editor-rail-groups.js";
import {
  emblemKindOf,
  emblemPlacingLabel,
  emblemToolActive,
  emblemTools,
} from "../emblem/emblem-tools.jsx";
import { useEmblemEditor } from "../emblem/useEmblemEditor.js";
import { modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import HangarInspector from "./HangarInspector.jsx";
import HangarStage from "./HangarStage.jsx";
import { usePatternStamp, patternTool } from "../finish/PatternStamp.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { hangarImages } from "./hangar-images.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Инструменты ангара. Цифры — горячие клавиши: буквы в 3D-кадре заняты
 * полётом (W A S D, Q и E).
 */
const HANGAR_TOOLS = Object.freeze([
  {
    id: "outside",
    label: "Стены снаружи",
    icon: <House />,
    group: "paint",
    pick: "Снаружи",
    hint: "Выберите отделку стен справа — ангар в кадре перекрасится сразу",
  },
  {
    id: "inside",
    label: "Стены внутри",
    icon: <Door />,
    group: "paint",
    pick: "Внутри",
    /* Ангар стандартный (ТЗ 13.10.2026): железяки — в «Конструкциях и свете». */
    hint: "Цвет стен и пола в зале. Убрать фермы, галерею, связи, трубы, погасить или убрать лампы — инструмент «Конструкции и свет» (5)",
  },
  /* Узор щелчком по стене или полу (19.10.2026) — как у всех 3D-мастерских мест. */
  patternTool(),
  /* Эмблемы и надписи — два инструмента общей системы (задача 1). */
  ...emblemTools({ where: "на стенах ангара" }),
  /* Ангар стандартный (ТЗ 12.10.2026, ночь): переключатели нутра вместо
     «Света» и «Техники»; ТЗ 13.10.2026 — все железяки нутра. */
  {
    id: "structure",
    label: "Конструкции и свет",
    icon: <Lamp />,
    group: "scene",
    pick: "Конструкции",
    hint: "Переключатели железяк нутра и ламп — кадр в зале покажет сразу",
  },
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
  modelsTool({ where: "в ангаре и вокруг него" }),
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    group: "ready",
    hint: "Готовый вид красит стены и пол разом; фермы, кран, лампы, эмблемы и надписи не трогает",
  },
].map((item, index) => Object.freeze({ ...withoutNote(item), shortcut: String(index + 1) })));

/*
 * Колонка по группам (ТЗ 22.10.2026, п. B): восемь значков — четыре. «Отделка» (стены снаружи, стены внутри, конструкции
 * и свет), «Рисунки» (узоры, эмблемы, текст), «Модели», «Шаблоны». Прежние инструменты остаются: панели, цифры, запись
 * hangar:tool.
 */
const HANGAR_RAIL = Object.freeze([
  { id: "finish", ids: ["outside", "inside", "structure"], label: "Отделка", icon: <House />, group: "paint", demo: "paint", tabs: true },
  { id: "decals", ids: ["emblem", "patterns", "text"], label: "Рисунки", icon: <Sticker />, group: "emblem", demo: "emblem", tabs: true },
]);

const HANGAR_STORAGE_KEY = "astral.hangar.project.v1";

function hangarDoneText(result) {
  if (result?.status === "unchanged")
    return tr("Ангар в игре уже такой — ставить было нечего");
  /* Главный процесс говорит, есть ли эмблема (или её место строкой). */
  const emblem =
    result?.emblem && typeof result.emblem === "object"
      ? result.emblem.asset
      : result?.emblem;
  return emblem
    ? tr("Ангар установлен вместе с эмблемой. Перезапустите игру.")
    : tr("Ангар установлен. Перезапустите игру.");
}

const readEmblems = (project) => project.emblems;
const writeEmblems = (project, emblems) => ({ ...project, emblems });

export default function HangarStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("hangar:tool", "outside");
  const [view, setView] = useRememberedState("hangar:view", "outside");
  /* Деталь, на которую щёлкнули в кадре: переключатель или поле, к которому колонка подводит (`count` растёт с каждым щелчком). */
  const [element, setElement] = useState({ tool: "", key: "", count: 0 });
  /* Открытая подвкладка «Внутри» (сообщает панель): на «Доме» кадр светит домик, а не всё нутро. */
  const [insideTab, setInsideTab] = useState("");
  const editor = useRecolorEditor({
    set: "hangar",
    contract: RECOLOR_PROJECTS.hangar,
    storageKey: HANGAR_STORAGE_KEY,
    title: tr("Ангар"),
    coverSlotId: "hangar",
    onNotice,
    resetNotice: tr("Ангар как в игре: штатный, без эмблем и надписей"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять ангар Astral — в игре станет штатный ангар"),
    savedText: tr("Ставим ангар в игру"),
    doneText: hangarDoneText,
    rolledBackText: tr("Ангар снят из игры — остальные моды на месте"),
    images: hangarImages,
  });
  const { project, commit, replace } = editor;

  /* Эмблемы и надписи — списком; наклейка в руке — пока взят инструмент и у
     выбранной есть картинка: левая кнопка ведёт её по стене. */
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
  const placing = emblems.placing;
  const models = usePlaceModels({
    editor,
    scene: "hangar",
    tool,
    onTool: setTool,
    where: "в ангаре и вокруг него",
    onNotice,
  });

  const onTool = useCallback(
    (next) => {
      /* Сцену значок и клавиша не трогают: её меняет только пункт над панелью (`onSwitch`). */
      setTool(next);
      /* Инструмент взяли из колонки, а не щелчком по детали — выбранного переключателя нет. */
      setElement((current) => (current.key ? { ...current, key: "" } : current));
    },
    [setTool],
  );
  /*
   * Пункт «Отделки» щелчком над панелью (владелец 31.10.2026: «камеру меняло, когда тыкаешь»): «Снаружи» — ангар снаружи, «Внутри» — зал
   * от задней стены на ворота, «Конструкции» — зал, взгляд вверх на фермы и кран. Повторный щелчок возвращает камеру туда же (`at`).
   */
  const [shot, setShot] = useState(null);
  /* Метка «камеру в этот раздел уже водили» (`onFocusView` ниже); пункт над панелью её сбрасывает. */
  const focused = useRef("");
  const onSwitch = useCallback(
    (next) => {
      if (next !== "outside" && next !== "inside" && next !== "structure") return;
      /* Явный щелчок по пункту (в том числе повторный по активному, инструмент тот же) возвращает камеру к виду: следующее касание раздела снова считается входом. */
      focused.current = "";
      setView(next === "outside" ? "outside" : "inside");
      setShot({ tool: next, at: Date.now() });
    },
    [setView],
  );
  /*
   * «Цвет труб» и подвкладки «Потолок», «Дом» у «Внутри» (мастерская ангара — цвета): человек тронул их орган или вкладку — камера летит к трубам, вверх на потолок или на домик (`hangar-views.js`),
   * чтобы результат правки был виден. Перелёт — один на вход: правка цвета и повторные щелчки там же камеру не трогают, а улетевшего в полёте человека к виду насильно не возвращают; смена раздела
   * (инструмента) даёт новый вход.
   */
  useEffect(() => {
    focused.current = "";
  }, [tool]);
  const onFocusView = useCallback(
    (key) => {
      if (focused.current === key) return;
      focused.current = key;
      setView("inside");
      setShot({ tool: key, at: Date.now() });
    },
    [setView],
  );
  const rail = useRailGroups({ groups: HANGAR_RAIL, tools: HANGAR_TOOLS, tool, onTool, letters: true, onSwitch });
  /*
   * Щелчок по детали в кадре (18.10.2026): своя модель — «Модели», стена, пол,
   * разметка — «Снаружи» или «Внутри», железяка нутра и лампа — «Конструкции и
   * свет» с её переключателем. Вид не меняется: человек смотрит на то, что нажал.
   */
  const onAim = useCallback(
    (hit, target) => {
      if (models.onAim?.(hit)) return;
      if (!target) return;
      setTool(target.tool);
      setElement((current) => ({ tool: target.tool, key: target.element || "", count: current.count + 1 }));
    },
    [models, setTool],
  );

  const onSide = useCallback(
    (side, values, label) =>
      commit(
        (current) => ({ ...current, [side]: { ...current[side], ...values } }),
        label,
      ),
    [commit],
  );
  const onFloor = useCallback(
    (values, label) =>
      commit(
        (current) => ({ ...current, floor: { ...current.floor, ...values } }),
        label,
      ),
    [commit],
  );
  /* «Узоры»: щелчок по стене снаружи или внутри, по полу — узор в руке ложится туда. */
  const stamp = usePatternStamp("hangar", {
    onNotice,
    miss: tr("Сюда узор не ляжет — щёлкните по стене или полу."),
    apply: useCallback(
      (target, finish) => {
        if (target?.tool !== "outside" && target?.tool !== "inside") return null;
        if (target.element === "markings" || target.element === "house") return null;
        if (target.element === "ceiling") {
          onSide("ceiling", finish, "Потолок: узор");
          return tr("Потолок");
        }
        if (target.element === "floor") {
          onFloor(finish, "Пол: узор");
          return tr("Пол");
        }
        const side = HANGAR_SIDES.find((item) => item.id === target.tool);
        onSide(target.tool, finish, `${side?.label || target.tool}: узор`);
        return tr(side?.label || target.tool);
      },
      [onFloor, onSide],
    ),
  });
  const onStructure = useCallback(
    (values, label) => commit((current) => ({ ...current, ...values }), label),
    [commit],
  );
  const onStandard = useCallback(
    () =>
      replace(
        (current) => applyHangarStandard(current),
        tr("Ангар как в игре: стены, нутро, железяки и лампы"),
      ),
    [replace],
  );

  /* «Ставить» — явное действие, а не взятый инструмент: наклейки по умолчанию в зале, туда и ведёт. */
  const onPlacing = useCallback(
    (on) => {
      emblems.setPlacing(Boolean(on));
      if (on && view !== "inside") setView("inside");
    },
    [emblems, view, setView],
  );

  const onPreset = useCallback(
    (preset) =>
      replace(
        (current) => applyHangarPreset(current, preset.id),
        `${tr("Готовый ангар")}: ${tr(preset.label)}`,
      ),
    [replace],
  );

  const deferred = useDeferredValue(project);
  /* Кадр ангара для «Студии»: тот же кадр (тот же вид) с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback((live) => <HangarStage project={live} view={view} />, [view]);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor hangar-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская ангара")}
      status={editor.status}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      toolShortcuts={rail.shellShortcuts}
      panelHead={rail.panelHead}
      guide={models.active ? models.guide : editor.guide(placing, { aim: tr("править то, что под курсором") })}
      guideKey="hangar"
      actions={
        <EditorActions {...editor.actionProps({ compare: true })} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <>
          {rail.switcher}
          {models.active ? (
          models.panel
        ) : tool === "patterns" ? (
          stamp.panel
        ) : (
          <StudioLiveProvider project={project} render={renderLive}>
            <HangarInspector
              tool={tool}
              project={project}
              onSide={onSide}
              emblems={emblems}
              onStructure={onStructure}
              onFloor={onFloor}
              onStandard={onStandard}
              onPreset={onPreset}
              onNotice={onNotice}
              onPlacing={onPlacing}
              onView={onFocusView}
              aim={element}
              onTab={setInsideTab}
            />
          </StudioLiveProvider>
        )}
        </>
      }
    >
      <HangarStage
        project={editor.shown(emblems.hide(deferred))}
        view={view}
        shot={shot}
        placing={placing}
        placingLabel={emblemPlacingLabel(tool)}
        onPlace={emblems.place}
        onAdjust={emblems.adjust}
        textStage={emblems.stage}
        onPlaced={() => emblems.setPlacing(false)}
        onCamera={editor.onCamera}
        {...models.stageProps}
        /* После свойств «Моделей»: щелчок сам спрашивает их первыми. */
        onAim={tool === "patterns" ? stamp.onAim : onAim}
        tool={tool}
        element={tool === "inside" && insideTab === "house" ? "house" : element.tool === tool ? element.key : ""}
        overlay={models.bar}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
