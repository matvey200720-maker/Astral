/*
 * Редактор «Вайнвуд» — своя надпись вместо VINEWOOD на холме.
 *
 * Основа — штатная надпись из игры игрока, по умолчанию «Как в игре».
 * Инструменты слева (мастерская «как в Photoshop»): надпись (своё слово,
 * шрифт, размер, подсветка; «Убрать надпись»), цвет букв, свой логотип
 * вместо букв, шаблоны и «Как в игре». Кадр — склон с надписью в 3D на
 * матовой плашке; облик меняется сразу.
 *
 * Щелчок по холму (18.10.2026, `vinewood-aim.js`): буква своего слова — «Цвет» и
 * эта буква, логотип — «Логотип», штатная надпись, леса и прожекторы — «Надпись»;
 * взятое подсвечено в кадре.
 *
 * Общее с остальными редакторами мест (работа, черновик, «Мои работы»,
 * «Применить», камера) — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Image, PaintBrush, Swatches, TextT } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { applyVinewoodPreset, applyVinewoodStandard } from "@modovik/climb-contract/recolor/vinewood";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import { modelsTool } from "../models/models-tool.jsx";
import { usePlaceModels } from "../models/usePlaceModels.jsx";
import { useVinewoodLogo } from "./vinewood-art.js";
import { vinewoodImages } from "./vinewood-images.js";
import VinewoodInspector from "./VinewoodInspector.jsx";
import VinewoodStage from "./VinewoodStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/* Цифры — горячие клавиши: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze([
  {
    id: "word",
    label: "Надпись",
    icon: <TextT />,
    shortcut: "1",
    group: "text",
    hint: "Впишите слово справа — буквы встанут на холм вместо VINEWOOD, по склону, с лесами",
  },
  {
    id: "colour",
    label: "Цвет",
    icon: <PaintBrush />,
    shortcut: "2",
    group: "paint",
    hint: "Цвет, градиент или радуга вдоль надписи — по рисунку листа металла",
  },
  {
    id: "logo",
    label: "Логотип",
    icon: <Image />,
    shortcut: "3",
    group: "emblem",
    hint: "Загрузите PNG с прозрачным фоном — он встанет на холм вместо букв",
  },
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
  /* Подписи под именем панели нет (владелец 30.10.2026): у «Моделей» она была пояснением, а не именем. */
  { ...modelsTool({ where: "у надписи на холме", shortcut: "4" }), note: undefined },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "5",
    group: "ready",
    hint: "Готовый вид оформляет надпись разом — дальше любую настройку можно поправить",
  },
]);

/* Какой инструмент правит взятое щелчком. */
const AIM_TOOLS = Object.freeze({ letter: "colour", word: "colour", sign: "word", logo: "logo" });

function doneText(result) {
  if (result?.status === "unchanged") return tr("Надпись в игре уже такая — ставить было нечего");
  return tr("Надпись на холме установлена. Перезапустите игру.");
}

/* Кадр холма для «Студии»: тот же кадр с работой, где логотип — холст студии. */
function VinewoodLive({ project }) {
  const logo = useVinewoodLogo(project.logo.asset);
  return <VinewoodStage project={project} logo={logo} />;
}
const renderVinewoodLive = (project) => <VinewoodLive project={project} />;

export default function VinewoodStudio({ onExit, onNotice }) {
  useTr();
  const [remembered, setTool] = useRememberedState("vinewood:tool", "word");
  const editor = useRecolorEditor({
    set: "vinewood",
    contract: RECOLOR_PROJECTS.vinewood,
    storageKey: "astral.vinewood.project.v1",
    title: tr("Вайнвуд"),
    coverSlotId: "vinewood",
    onNotice,
    resetNotice: tr("Надпись как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять надпись Astral — в игре станет VINEWOOD, как было"),
    savedText: tr("Ставим надпись в игру"),
    doneText,
    rolledBackText: tr("Надпись снята из игры — на холме снова VINEWOOD"),
    images: vinewoodImages,
  });
  const { project, commit, replace } = editor;
  /* «Цвета» без своего слова нет (разбор критика 30.10.2026): у штатной надписи и логотипа красить нечего — вкладка не стоит. */
  const wordMode = project.mode === "text";
  const tools = useMemo(() => TOOLS.map((item) => (item.id === "colour" ? { ...item, hidden: !wordMode } : item)), [wordMode]);
  const tool = remembered === "colour" && !wordMode ? "word" : remembered;
  const onChange = useCallback((patch, label) => commit((current) => ({ ...current, ...patch }), label), [commit]);
  const onPreset = useCallback((preset) => replace((current) => applyVinewoodPreset(current, preset.id), `Готовый вид: ${preset.label}`), [replace]);
  const onStandard = useCallback(() => replace((current) => applyVinewoodStandard(current), "Как в игре"), [replace]);
  const deferred = useDeferredValue(project);
  /* Логотип из хранилища окна — один на кадр и колонку правок. */
  const logo = useVinewoodLogo(project.logo.asset);
  const models = usePlaceModels({ editor, scene: "vinewood", tool, onTool: setTool, where: "у надписи на холме", onNotice });
  const openLogo = useCallback(() => setTool("logo"), [setTool]);
  const mode = project.mode;

  /*
   * Взятое щелчком в кадре: `{ kind, mode, letter? }`. Кадр подсвечивает его, пока открыт
   * тот инструмент, что его правит (буква и слово — «Цвет», надпись — «Надпись», логотип —
   * «Логотип»), и пока на холме то же, что брали (`mode`): сменили слово на логотип — рамка
   * уходит. Букву выбирают и в панели — выбор общий.
   */
  const [aimed, setAimed] = useState(null);
  const onAim = useCallback(
    (target, hit) => {
      if (models.onAim?.(hit)) return;
      /* С «Моделями» в руке щелчок мимо модели — не выбор надписи. */
      if (models.active || !target) return;
      setTool(target.tool);
      setAimed({ kind: target.kind, mode, ...(target.kind === "letter" ? { letter: target.letter } : {}) });
    },
    [models, setTool, mode],
  );
  const selected = useMemo(() => (aimed && aimed.mode === mode && AIM_TOOLS[aimed.kind] === tool ? aimed : null), [aimed, tool, mode]);
  const letter = aimed?.kind === "letter" ? aimed.letter : null;
  const onLetter = useCallback((index) => setAimed(index === null ? null : { kind: "letter", mode, letter: index }), [mode]);
  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor vinewood-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская Вайнвуда")}
      status={editor.status}
      tools={tools}
      tool={tool}
      onTool={setTool}
      guide={models.active ? models.guide : editor.guide(false, { aim: tr("править надпись под курсором") })}
      guideKey="vinewood"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        models.active ? (
          models.panel
        ) : (
          <StudioLiveProvider project={project} render={renderVinewoodLive}>
            <VinewoodInspector
              tool={tool}
              project={project}
              logo={logo}
              letter={letter}
              onLetter={onLetter}
              onChange={onChange}
              onStandard={onStandard}
              onPreset={onPreset}
              onNotice={onNotice}
            />
          </StudioLiveProvider>
        )
      }
    >
      <VinewoodStage
        project={deferred}
        logo={logo}
        onLogo={tool === "logo" ? null : openLogo}
        onCamera={editor.onCamera}
        {...models.stageProps}
        /* После свойств «Моделей»: щелчок сам спрашивает их первыми. */
        onAim={onAim}
        selected={selected}
        canAim={!models.active}
        overlay={models.bar}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
