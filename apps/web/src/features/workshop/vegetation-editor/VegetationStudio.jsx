/*
 * Растительность: цвет и густота листвы, улучшенные модели, «Трава по
 * миру» (прежде «Зелёный Сэнди Шорс»).
 *
 * Установщик правит файлы игры игрока (листы крон деревьев, кустов и
 * растений рядом и их карточки вдали, трава земли, травинки) и берёт из
 * складов поставки модели «Реалистичных деревьев» и зелёные листы мода
 * «зеленый сенди шортс» (по файлам модов владельца). Устройство и пределы —
 * `@modovik/climb-contract/recolor/vegetation`.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): листва,
 * большие кусты, цветы, виды деревьев, «Трава по миру», улучшенные модели и
 * шаблоны с временами года — инструменты слева (кусты, цветы, деревья и
 * сезоны — задача 2 ТЗ 10.10.2026, вечер; «В разнобой» — задача 7 ТЗ
 * 17.10.2026: деревья одного вида разными цветами палитры), справа —
 * настройки взятого. Колонка — пять значков вместо восьми (ТЗ 22.10.2026,
 * «облегчить»): «Листва» держит и «В разнобой», «Деревья» — смесь видов и
 * улучшенные модели, «Трава и цветы» — цветы и траву по миру; выбор внутри —
 * переключатель над панелью (`EditorSubTools`);
 * инструмент сам ставит кадр — дуб, куст, луг, карту районов или снимок
 * травы той зоны, что красится. Общее с остальными наборами — в
 * `useRecolorEditor`; исходный облик — «как в игре», и «Применить» его
 * снимает установку растительности.
 */

import { useCallback, useDeferredValue, useEffect, useMemo } from "react";
import { Leaf, Mountains, Palette, Seal, Shuffle, Sparkle, Swatches, Tree } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { applyVegetationPreset, varietyDroppedColours } from "@modovik/climb-contract/recolor/vegetation";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import VegetationInspector from "./VegetationInspector.jsx";
import VegetationStage from "./VegetationStage.jsx";
import { speciesChoices } from "./VegetationWorldFields.jsx";
import { compileVegetationLooks, percentText } from "./vegetation-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const VEGETATION_STORAGE_KEY = "astral.vegetation.project.v1";

/* Сохранённая палитра старше предела в три цвета: лишние сняты при открытии (`varietyDroppedColours`). */
function storedPaletteTrimmed() {
  try {
    const stored = window.localStorage.getItem(VEGETATION_STORAGE_KEY);
    return stored ? varietyDroppedColours(JSON.parse(stored)) > 0 : false;
  } catch {
    return false;
  }
}

/*
 * Инструменты растительности. Цифры — горячие клавиши: буквы в 3D-кадре
 * заняты полётом (W A S D, Q и E). `stage` — что показывает кадр, пока
 * инструмент в руке.
 */
const VEGETATION_TOOLS = Object.freeze([
  {
    id: "foliage",
    label: "Листва",
    icon: <Leaf />,
    shortcut: "1",
    group: "trees",
    stage: "trees",
    hint: "Свой цвет и густота листвы — поляна в кадре покажет их сразу",
  },
  {
    id: "bushes",
    label: "Кусты",
    icon: <Seal />,
    shortcut: "2",
    group: "trees",
    stage: "bushes",
    hint: "Кусты вдоль дорог и изгороди у особняков — своим цветом; над кадром — куст или изгородь",
  },
  {
    id: "forest",
    label: "Деревья",
    pick: "Смесь",
    icon: <Shuffle />,
    shortcut: "3",
    group: "trees",
    stage: "forest",
    hint: "Выберите виды в смесь и районы или сделайте леса гуще — карта покажет, где деревья поменяются",
  },
  {
    id: "flowers",
    label: "Цветы",
    icon: <Sparkle />,
    shortcut: "4",
    group: "sandy",
    stage: "flowers",
    hint: "Отметьте виды цветов и сколько травы станет ими — луг в кадре из листов вашей игры",
  },
  {
    id: "sandy",
    label: "Трава по миру",
    pick: "Трава",
    icon: <Mountains />,
    shortcut: "5",
    group: "sandy",
    stage: "sandy",
    hint: "Выберите зону — в городе или за городом; кадр — снимок этой зоны из игры, свой цвет травы пересчитывается на нём",
  },
  {
    id: "improved",
    label: "Модели",
    demo: "model",
    icon: <Tree />,
    shortcut: "6",
    group: "trees",
    stage: "trees",
    hint: "Подробные модели деревьев вместо моделей игры — файл мода не нужен",
  },
  {
    id: "variety",
    label: "В разнобой",
    icon: <Palette />,
    shortcut: "7",
    group: "trees",
    stage: "variety",
    hint: "Соберите палитру — жёлтое, розовое, белое — и доли: деревья по миру возьмут цвета вразнобой; «Перемешать» — другая расстановка",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "8",
    group: "ready",
    /* Шаблоны красят прежде всего кроны — в кадре дерево первого инструмента,
       а не то, что было перед ними (владелец, 19.10.2026). */
    stage: "trees",
    hint: "Весна, лето, осень, зима — каждый сезон красит листву, кусты, траву и цветы разом; дальше любое можно поправить",
  },
]);

/*
 * Колонка по группам: восемь прежних инструментов — пять значков. Прежние имена остаются в памяти (`vegetation:tool`),
 * в обучении и у кадра: каждый открывает свою панель; `pick` — короткая подпись в переключателе.
 */
const VEGETATION_GROUPS = Object.freeze([
  { id: "leaves", ids: ["foliage", "variety"] },
  { id: "bushes", ids: ["bushes"] },
  { id: "trees", ids: ["forest", "improved"] },
  { id: "grass", ids: ["flowers", "sandy"], label: "Трава и цветы" },
  { id: "templates", ids: ["templates"] },
]);

const TOOL_STAGES = Object.freeze(Object.fromEntries(VEGETATION_TOOLS.filter((item) => item.stage).map((item) => [item.id, item.stage])));
const STAGE_TABS = Object.freeze([...new Set(Object.values(TOOL_STAGES))]);

function vegetationDoneText(result) {
  if (result?.status === "unchanged") return tr("Растительность в игре уже такая — ставить было нечего");
  return tr("Растительность установлена. Перезапустите игру.");
}

export default function VegetationStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("vegetation:tool", "foliage");
  /* Что в кадре: дуб, куст, луг, карта районов или трава. Инструмент ставит
     своё, «Шаблоны» — дерево, как у «Листвы». */
  const [tab, setTab] = useRememberedState("vegetation:tab", "trees");
  /* Какую траву красить: за городом, в городе или обе сразу — от неё и снимок в кадре. */
  const [grassZone, setGrassZone] = useRememberedState("vegetation:grass-zone", "country");
  const vegetationTab = STAGE_TABS.includes(tab) ? tab : "trees";
  /* Какой вид красят своим цветом: от него дерево в кадре «Листвы» и плитка в «Видах деревьев». */
  const [species, setSpecies] = useRememberedState("vegetation:species", "oak");
  const editor = useRecolorEditor({
    set: "vegetation",
    contract: RECOLOR_PROJECTS.vegetation,
    storageKey: VEGETATION_STORAGE_KEY,
    title: tr("Растительность"),
    coverSlotId: "vegetation",
    onNotice,
    resetNotice: tr("Растительность как в игре"),
    savedText: tr("Ставим растительность в игру"),
    doneText: vegetationDoneText,
    rolledBackText: tr("Растительность снята из игры — листва и трава Rockstar"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
  });
  const { project, commit, replace } = editor;

  /* Открытие редактора с сохранённой палитрой старше предела — одна строка, без кнопок. */
  useEffect(() => {
    if (storedPaletteTrimmed()) onNotice?.(tr("Палитра теперь до трёх цветов: лишние цвета сняты"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, []);

  const onTool = useCallback(
    (next) => {
      setTool(next);
      if (TOOL_STAGES[next]) setTab(TOOL_STAGES[next]);
    },
    [setTool, setTab],
  );

  /* Колонка по группам: значок — группа, внутри неё прежний инструмент выбирает переключатель над панелью. */
  const rail = useRailGroups({ groups: VEGETATION_GROUPS, tools: VEGETATION_TOOLS, tool, onTool, renumber: true });

  const patch = useCallback(
    (part, values, label) => commit((current) => ({ ...current, [part]: { ...current[part], ...values } }), label),
    [commit],
  );

  const onPreset = useCallback(
    (preset) => replace((current) => applyVegetationPreset(current, preset.id), `Готовая растительность: ${preset.label}`),
    [replace],
  );

  /* Вид, что убрали из списка (у оливы и клёна нет дерева в сцене рощ), в памяти ещё может стоять: берём первый показанный. */
  const choices = speciesChoices(project.trees.species);
  const shownSpecies = choices.includes(species) ? species : choices[0] || "oak";
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const looks = useMemo(() => compileVegetationLooks(deferred), [deferred]);

  const status = `${editor.status} · Листва: ${percentText(project.trees.foliage)}${project.variety.enabled ? tr(" · В разнобой") : ""}${project.bushes.mode === "colour" ? tr(" · Кусты своим цветом") : ""}${
    project.forest.enabled ? tr(" · Деревья перемешкой") : ""
  }${project.density.value ? ` · Засаженность +${project.density.value} %` : ""}${project.flowers.mode === "add" ? tr(" · Цветы") : project.flowers.mode === "none" ? tr(" · Без цветов") : ""}${project.improved.enabled ? tr(" · Реалистичные деревья") : ""}${
    project.sandy.enabled ? tr(" · Трава по миру") : ""
  }`;
  /* Подсказки камеры — у 3D-кадров: дуб и куст; у травы, луга и карты своей камеры нет. */
  const spatial = vegetationTab === "trees" || vegetationTab === "bushes";

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor vegetation-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская растительности")}
      status={status}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      guide={spatial ? editor.guide() : null}
      guideKey="vegetation"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <>
          {rail.switcher}
          <VegetationInspector
            tool={tool}
            project={project}
            presetProject={settled}
            zone={grassZone}
            onZone={setGrassZone}
            species={shownSpecies}
            onSpecies={setSpecies}
            onPatch={patch}
            onPreset={onPreset}
          />
        </>
      }
    >
      <VegetationStage
        project={deferred}
        looks={looks}
        tab={vegetationTab}
        species={tool === "foliage" ? shownSpecies : null}
        zone={grassZone === "city" ? "city" : "country"}
        choice={grassZone}
        onCamera={editor.onCamera}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
