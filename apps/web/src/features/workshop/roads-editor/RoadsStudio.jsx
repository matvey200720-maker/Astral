/*
 * Редактор «Дороги» — дороги и тротуары по всей карте сразу (задача 6 ТЗ
 * 07.10.2026).
 *
 * Три части — асфальт, грунтовки (грязь, песок, гравий) и тротуары — и
 * разметка. У части: «Стандарт», свой цвет общим полем цветовых эффектов,
 * «Без текстуры», узор, своя текстура, градиент (общая отделка) и яркость;
 * у разметки — жёлтые и белые линии своим цветом, яркость и «Скрыть».
 * Шаблоны — у каждой части цветовые и текстурные, у разметки свои.
 *
 * Участок кадра — «Город» или «Грунтовка» — переключатель в шапке, и только он
 * меняет кадр (ТЗ владельца 22.10.2026): раньше «Тротуары» на грунтовке сами
 * возвращали город. В городе колонка — асфальт, тротуары, разметка; на
 * грунтовке — грунтовки; шаблоны — везде.
 *
 * Своих файлов у дорог нет: установщик правит словари карты игрока
 * (`apps/desktop/src/recolor-roads.js`) в двух своих пакетах дополнения.
 * Раскладка — мастерская «как в Photoshop»: инструменты слева, справа —
 * настройки взятого, вид кадра («Вблизи» / «Вдали») — над кадром. Общее с
 * остальными наборами (работа, черновик, «Мои работы», «Применить», «Снять
 * из игры») — `useRecolorEditor`; исходный облик — «как в игре», и
 * «Применить» его снимает установку дорог.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Gauge, Mountains, PaintBrushBroad, SquaresFour, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { applyRoadMarkingPreset, applyRoadPartPreset, applyRoadsStandard } from "@modovik/climb-contract/recolor/roads";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { toolsOfScene, useSceneToolMemory } from "../../../components/ui/editor-scene.js";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import RoadsInspector from "./RoadsInspector.jsx";
import RoadsStage from "./RoadsStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { roadSurfaceSpec } from "./roads-aim.js";
import { roadsImages } from "./roads-images.js";
import { ROAD_SCENE_OPTIONS, groupLabel, partLabel, roadsPlanText } from "./roads-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Цифры — горячие клавиши по порядку колонки своего участка: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze(
  [
    {
      id: "asphalt",
      label: "Асфальт",
      icon: <Gauge />,
      group: "parts",
      scenes: ["city"],
      hint: "Цвет, текстура и яркость асфальта по всей карте — вблизи и вдали. Линии в асфальте остаются линиями",
    },
    {
      id: "dirt",
      label: "Грунтовки",
      icon: <Mountains />,
      group: "parts",
      scenes: ["dirt"],
      hint: "Цвет, текстура и яркость грунтовых дорог — и там, где колея вписана в землю",
    },
    {
      id: "sidewalk",
      label: "Тротуары",
      icon: <SquaresFour />,
      group: "parts",
      scenes: ["city"],
      hint: "Цвет, текстура и яркость тротуаров и бордюров. Краска бордюров остаётся своей",
    },
    {
      id: "markings",
      label: "Разметка",
      icon: <PaintBrushBroad />,
      group: "parts",
      scenes: ["city"],
      hint: "Каждая разметка отдельно: цвет, яркость, неон или «Скрыть» — везде, где она есть",
    },
    {
      id: "templates",
      label: "Шаблоны",
      icon: <Swatches />,
      group: "ready",
      hint: "Готовые виды каждой части и разметки — дальше любое можно поправить",
    },
  ].map((tool) => Object.freeze(tool)),
);
/* Колонка участка с цифрами по порядку: у города и у грунтовки своя «1». */
const SCENE_TOOLS = Object.freeze(
  Object.fromEntries(
    ROAD_SCENE_OPTIONS.map(({ value }) => [value, Object.freeze(toolsOfScene(TOOLS, value).map((tool, index) => Object.freeze({ ...tool, shortcut: String(index + 1) })))]),
  ),
);
const SCENE_DEFAULT_TOOL = Object.freeze({ city: "asphalt", dirt: "dirt" });

function doneText(result) {
  if (result?.status === "unchanged") return tr("Дороги в игре уже такие — ставить было нечего");
  return tr("Дороги установлены по всей карте. Перезапустите игру.");
}

export default function RoadsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("roads:tool", "asphalt");
  const [savedView, setView] = useRememberedState("roads:view", "near");
  /* Участок кадра (задача 13): «Город» или «Грунтовка» — помнится сам по себе, инструмент его не меняет. */
  const [savedScene, setScene] = useRememberedState("roads:scene", "city");
  const scene = savedScene === "dirt" ? "dirt" : "city";
  const sceneTools = SCENE_TOOLS[scene];
  const tool = sceneTools.some((item) => item.id === savedTool) ? savedTool : SCENE_DEFAULT_TOOL[scene];
  const view = savedView === "far" ? "far" : "near";
  const toolFor = useSceneToolMemory(TOOLS, scene, tool);
  /* Другой участок — взят инструмент, которым там правили последним (в первый раз — асфальт или грунтовки). */
  const onScene = useCallback(
    (next) => {
      setScene(next);
      setTool(toolFor(next, SCENE_DEFAULT_TOOL[next]));
    },
    [setScene, setTool, toolFor],
  );
  const editor = useRecolorEditor({
    set: "roads",
    contract: RECOLOR_PROJECTS.roads,
    storageKey: "astral.roads.project.v1",
    title: tr("Дороги"),
    coverSlotId: "roads",
    onNotice,
    resetNotice: tr("Дороги как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять дороги Astral — в игре станут как были"),
    savedText: tr("Ставим дороги в игру"),
    doneText,
    rolledBackText: tr("Дороги сняты из игры — остальные моды на месте"),
    images: roadsImages,
  });
  const { project, commit, replace } = editor;

  /* Щелчок по краске участка (18.10.2026): её инструмент и раздел в колонке правок (у разметки — группа). */
  const [picked, setPicked] = useState(null);
  const onAim = useCallback(
    (aim) => {
      setTool(aim.tool);
      setPicked({ ...aim, at: Date.now() });
    },
    [setTool],
  );
  /* Выбранная краска подсвечена, пока взят её инструмент (не по последнему щелчку кадра). У «Асфальта» и «Тротуаров» без щелчка
     подсвечено всё покрытие инструмента: страницы у них одного устройства, и кадр показывает, что правит каждая (четвёртый круг
     критика 31.10.2026: «Асфальт» и «Тротуары» отличались только заголовком). */
  const selected = useMemo(
    () => (picked && picked.tool === tool ? roadSurfaceSpec(picked) : tool === "asphalt" || tool === "sidewalk" ? roadSurfaceSpec({ tool }) : null),
    [picked, tool],
  );

  const onSurface = useCallback(
    (part, patch, label) => commit((current) => ({ ...current, parts: { ...current.parts, [part]: { ...current.parts[part], ...patch } } }), label),
    [commit],
  );
  const onMarkings = useCallback((patch, label) => commit((current) => ({ ...current, markings: { ...current.markings, ...patch } }), label), [commit]);
  const onGroup = useCallback(
    (group, patch, label) =>
      commit((current) => ({ ...current, markings: { ...current.markings, [group]: { ...current.markings[group], ...patch } } }), label || groupLabel(group)),
    [commit],
  );
  const onPartStandard = useCallback(
    (part) => replace((current) => applyRoadsStandard(current, part), `Стандарт: ${partLabel(part).toLowerCase()}`),
    [replace],
  );
  const onStandard = useCallback(() => replace((current) => applyRoadsStandard(current), "Стандарт"), [replace]);
  const onPartPreset = useCallback(
    (part, preset) => replace((current) => applyRoadPartPreset(current, part, preset.id), `${partLabel(part)}: ${preset.label}`),
    [replace],
  );
  const onMarkingPreset = useCallback((preset) => replace((current) => applyRoadMarkingPreset(current, preset.id), `Разметка: ${preset.label}`), [replace]);

  /* Кадр догоняет ползунок в свободное время; листы — когда рука остановилась. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(deferred);
  const status = [editor.status, roadsPlanText(project)].filter(Boolean).join(" · ");
  /* Кадр дорог для «Студии»: тот же кадр (тот же вид) с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback((live) => <RoadsStage project={live} scene={scene} view={view} />, [scene, view]);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor roads-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Дороги")}
      status={status}
      scene={{ label: tr("Участок"), options: ROAD_SCENE_OPTIONS.map((option) => ({ ...option, label: tr(option.label) })), value: scene, onChange: onScene }}
      tools={sceneTools}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править покрытие или разметку под курсором") })}
      guideKey="roads"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps({ compare: true })} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={project} render={renderLive}>
          <RoadsInspector
            tool={tool}
            project={project}
            onSurface={onSurface}
            onMarkings={onMarkings}
            onGroup={onGroup}
            onPartStandard={onPartStandard}
            onStandard={onStandard}
            onPartPreset={onPartPreset}
            onMarkingPreset={onMarkingPreset}
            onNotice={onNotice}
            focus={picked}
          />
        </StudioLiveProvider>
      }
    >
      <RoadsStage project={editor.shown(settled)} scene={scene} view={view} onView={setView} onCamera={editor.onCamera} onAim={onAim} highlight={selected} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
