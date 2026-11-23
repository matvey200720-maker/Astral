/*
 * Летающее лого в центре города (ТЗ 08.10.2026, задача 4): своя картинка
 * или надпись вместо букв мода над кварталом к северу от площади Легиона.
 *
 * Раскладка — мастерская «как в Photoshop»: «Лого», «Движение», «Вид»,
 * «Шаблоны» — инструменты слева, справа — настройки взятого; кадр — та же
 * фигура и то же движение, что уедут в игру. Общее с остальными местами
 * (работа, черновик, «Мои работы», «Применить», камера) — в
 * `useRecolorEditor`; «Стандарт» — лого нет, «Применить» тогда снимает
 * установку.
 */

import { useCallback, useDeferredValue, useState } from "react";
import { ArrowsClockwise, Image, Sparkle, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { FLOAT_LOGO_MOTION_LABELS, applyFloatLogoPreset, applyFloatLogoStandard, normalizeFloatLogoProject } from "@modovik/climb-contract/recolor/float-logo";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import FloatLogoInspector from "./FloatLogoInspector.jsx";
import FloatLogoStage from "./FloatLogoStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { FLOAT_LOGO_TOOLS, floatLogoToolFor } from "./float-logo-aim.js";
import { floatLogoImages, useFloatLogoPixels } from "./float-logo-art.js";
import { metresText } from "./float-logo-text.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

const STORAGE_KEY = "astral.floatlogo.project.v1";

const TOOLS = Object.freeze([
  { id: "content", label: "Лого", icon: <Image />, shortcut: "1", group: "paint", hint: "Картинка с прозрачным фоном или надпись своим шрифтом — по контуру встанет объёмная фигура" },
  { id: "motion", label: "Движение", icon: <ArrowsClockwise />, shortcut: "2", group: "paint", hint: "Движение в игре — клип модели: так крутятся вещи Rockstar" },
  { id: "look", label: "Вид", icon: <Sparkle />, shortcut: "3", group: "paint", hint: "Размер — длинная сторона лого; дальность — с какого расстояния его видно" },
  { id: "templates", label: "Шаблоны", icon: <Swatches />, shortcut: "4", group: "ready", hint: "Готовый вид меняет движение, цвет и размер — картинка остаётся вашей" },
]);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Лого в игре уже такое — ставить было нечего");
  return tr("Летающее лого установлено над центром города. Перезапустите игру.");
}

/* Кадр лого для «Студии»: тот же кадр с работой, где картинка лого — холст студии (фигура собирается по её контуру). */
function FloatLogoLive({ project }) {
  const pixels = useFloatLogoPixels(project);
  return <FloatLogoStage project={project} pixels={pixels} />;
}
const renderFloatLogoLive = (project) => <FloatLogoLive project={project} />;

/* Слово движения в строке состояния: из словаря, с маленькой буквы (у немецкого существительное остаётся с заглавной). */
function motionWord(motion, language) {
  const word = tr(FLOAT_LOGO_MOTION_LABELS[motion]);
  return language === "de" ? word : word.toLowerCase();
}

export default function FloatLogoStudio({ onExit, onNotice }) {
  useTr();
  const language = useUiLanguage();
  const [tool, setTool] = useRememberedState("floatlogo:tool", "content");
  const editor = useRecolorEditor({
    set: "floatlogo",
    contract: RECOLOR_PROJECTS.floatlogo,
    storageKey: STORAGE_KEY,
    title: tr("Летающее лого"),
    coverSlotId: "float-logo",
    onNotice,
    images: floatLogoImages,
    resetLabel: tr("Без лого"),
    stockLabel: tr("Без лого"),
    stockMeansRemoval: true,
    removalTitle: tr("Убрать лого из игры"),
    resetNotice: tr("Лого нет — над городом пусто"),
    savedText: tr("Ставим летающее лого в игру"),
    doneText,
    rolledBackText: tr("Летающее лого снято из игры — остальные моды на месте"),
  });
  const { project, commit, replace } = editor;
  /* Щелчок по лого в кадре (18.10.2026): рамка вокруг него и инструмент, которым оно правится. */
  const [picked, setPicked] = useState(false);
  const onAim = useCallback(() => {
    setTool(floatLogoToolFor);
    setPicked(true);
  }, [setTool]);
  const onPatch = useCallback((values, label) => commit((current) => ({ ...current, ...values }), label), [commit]);
  const onPreset = useCallback((preset) => replace((current) => applyFloatLogoPreset(current, preset.id), `Готовое лого: ${preset.label}`), [replace]);
  const onStandard = useCallback(() => replace((current) => applyFloatLogoStandard(current), "Стандарт: без лого"), [replace]);
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const normal = normalizeFloatLogoProject(project);
  const pixels = useFloatLogoPixels(deferred);
  const status =
    normal.mode === "none"
      ? `${normal.name || tr("Летающее лого")} · без лого`
      : `${editor.status} · ${normal.mode === "text" ? `«${normal.text.value}»` : tr("картинка")} · ${metresText(normal.size)} · ${motionWord(normal.motion, language)}`;

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor float-logo-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская летающего лого")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править лого под курсором") })}
      guideKey="floatlogo"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={project} render={renderFloatLogoLive}>
          <FloatLogoInspector tool={tool} project={normal} presetProject={settled} onPatch={onPatch} onPreset={onPreset} onStandard={onStandard} onNotice={onNotice} />
        </StudioLiveProvider>
      }
    >
      <FloatLogoStage project={deferred} pixels={pixels} onCamera={editor.onCamera} onAim={onAim} selected={picked && FLOAT_LOGO_TOOLS.includes(tool)} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
