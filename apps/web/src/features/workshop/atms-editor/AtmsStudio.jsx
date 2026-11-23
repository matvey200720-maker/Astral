/*
 * Редактор «Банкоматы» — банкоматы всей карты (задача 4 ТЗ 17.10.2026:
 * «добавь редактор банкоматов как отдельный инструмент и добавь
 * возможность чтобы их можно было редактировать по всему миру»).
 *
 * Основа — штатные банкоматы игры игрока, всё по умолчанию «Стандарт».
 * Сверху — что правится: «Все» (облик всех банкоматов сразу) или одна из
 * моделей (тумба, настенный синий, настенный красный, Fleeca). Инструменты
 * слева (мастерская «как в Photoshop»), справа — настройки взятого: цвет
 * корпуса, рамки и панели; экран, вывеска и полоса логотипов (свой цвет,
 * ровный цвет, своя картинка) и свечение; где банкоматы стоят на карте;
 * шаблоны и «Стандарт». Кадр — сами банкоматы в 3D на матовой плашке;
 * облик в кадре меняется сразу.
 *
 * Общее с остальными редакторами мест (работа, черновик, «Мои работы»,
 * «Применить», камера) — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Monitor, PaintBucket, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { ATM_GLOW, ATM_TYPES, applyAtmsPreset, applyAtmsStandard } from "@modovik/climb-contract/recolor/atms";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import AtmsInspector from "./AtmsInspector.jsx";
import AtmsStage from "./AtmsStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { ATM_PART_TOOLS, atmPartSpec } from "./atms-aim.js";
import { atmsImages } from "./atms-images.js";
import { useAtmTextImages } from "./atms-text-draw.js";
import { TARGET_IDS, targetLabel, targetOptions } from "./atms-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Цифры — горячие клавиши по порядку панели: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze(
  [
    {
      id: "paint",
      label: "Корпус и панель",
      icon: <PaintBucket />,
      group: "paint",
      hint: "Выберите сверху, какие банкоматы правите, — все сразу или одну модель. Корпус, рамку и металл можно покрасить, панель — покрасить, заменить узором или картинкой, клавиатуру и стекло — перекрасить",
    },
    {
      id: "screen",
      label: "Экран и вывеска",
      icon: <Monitor />,
      group: "paint",
      hint: "Своя картинка или свой текст на экран, вывеску или полосу логотипов — или свой цвет. Ползунок свечения — насколько ярко они светятся",
    },
    {
      id: "templates",
      label: "Шаблоны",
      icon: <Swatches />,
      group: "ready",
      hint: "Готовый вид оформляет все банкоматы разом — дальше любую часть и любую модель можно поправить",
    },
  ].map((tool, index) => Object.freeze({ ...tool, shortcut: String(index + 1) })),
);
const TOOL_IDS = TOOLS.map((tool) => tool.id);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Банкоматы в игре уже такие — ставить было нечего");
  return tr("Банкоматы установлены. Перезапустите игру.");
}

/* Облик модели, который правят на её вкладке: свой или — первой правкой — копия общего. */
function ownLook(current, target) {
  const type = current.types[target];
  return type.own ? type : { ...type, own: true, parts: current.all.parts, glow: current.all.glow };
}

export default function AtmsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("atms:tool", "paint");
  const [savedTarget, setTarget] = useRememberedState("atms:target", "all");
  const tool = TOOL_IDS.includes(savedTool) ? savedTool : "paint";
  const target = TARGET_IDS.includes(savedTarget) ? savedTarget : "all";
  const contract = RECOLOR_PROJECTS.atms;
  const editor = useRecolorEditor({
    set: "atms",
    contract,
    storageKey: "astral.atms.project.v1",
    title: tr("Банкоматы"),
    coverSlotId: "atms",
    onNotice,
    resetNotice: tr("Банкоматы как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять банкоматы Astral — в игре станут как были"),
    savedText: tr("Ставим банкоматы в игру"),
    doneText,
    rolledBackText: tr("Банкоматы сняты из игры — остальные моды на месте"),
    images: atmsImages,
  });
  const { project, commit, replace } = editor;
  /* Слова на экране, вывеске и полосе — картинки, их рисует окно и кладёт в работу без шага истории. */
  useAtmTextImages({ project, amend: editor.amend, onNotice });

  /* Щелчок по части банкомата в кадре (18.10.2026): её инструмент, вкладка её модели и раздел части в колонке правок. */
  const [picked, setPicked] = useState(null);
  const onAim = useCallback(
    (aim) => {
      setTool(aim.tool);
      setTarget(aim.target);
      setPicked({ part: aim.part, at: Date.now() });
    },
    [setTool, setTarget],
  );
  /* Выбранная часть подсвечена, пока взят её инструмент; «Все» — у всех моделей. Не выбрано — нигде (не по последнему щелчку кадра). */
  const selected = useMemo(() => (picked && ATM_PART_TOOLS[picked.part] === tool ? atmPartSpec(target, picked.part) : null), [picked, tool, target]);

  /* Правка облика взятой вкладки: у модели — её свой облик. */
  const editLook = useCallback(
    (where, update, label) =>
      commit((current) => {
        if (where === "all") return { ...current, all: update(current.all) };
        return { ...current, types: { ...current.types, [where]: update(ownLook(current, where)) } };
      }, label),
    [commit],
  );
  const onSurface = useCallback(
    (where, part, patch, label) => editLook(where, (look) => ({ ...look, parts: { ...look.parts, [part]: { ...look.parts[part], ...patch } } }), label),
    [editLook],
  );
  const onGlow = useCallback((where, glow, label) => editLook(where, (look) => ({ ...look, glow }), label), [editLook]);
  const onOwn = useCallback(
    (where, on) =>
      commit(
        (current) => ({ ...current, types: { ...current.types, [where]: on ? ownLook(current, where) : { ...current.types[where], own: false } } }),
        on ? `${targetLabel(where)}: свой облик` : `${targetLabel(where)}: как у всех`,
      ),
    [commit],
  );
  const onTargetStandard = useCallback(
    (where) =>
      editLook(
        where,
        (look) => ({
          ...look,
          glow: ATM_GLOW.standard,
          parts: Object.fromEntries(Object.entries(look.parts).map(([part, surface]) => [part, { ...surface, mode: "standard" }])),
        }),
        `${targetLabel(where)}: стандарт`,
      ),
    [editLook],
  );
  const onPreset = useCallback((preset) => replace((current) => applyAtmsPreset(current, preset.id), `Готовый вид: ${preset.label}`), [replace]);
  const onStandard = useCallback(() => replace((current) => applyAtmsStandard(current), "Стандарт"), [replace]);

  /* Подписи вкладок — на языке окна: собираются при каждой отрисовке (useTr выше). */
  const tabs = <SegmentedControl label={tr("Какие банкоматы")} size="sm" className="atms-targets" options={targetOptions()} value={target} onChange={setTarget} />;
  const deferred = useDeferredValue(project);
  /* Кадр банкоматов для «Студии» (лист панели): тот же кадр с работой, где на месте листа — холст студии. У «Все» — первая модель, у которой есть эта часть (у тумбы панели нет). */
  const renderLive = useCallback(
    (live, hint) => <AtmsStage project={live} target={target === "all" ? ATM_TYPES.find((type) => type.parts.includes(hint?.part))?.id || "all" : target} />,
    [target],
  );

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor atms-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Банкоматы")}
      status={editor.status}
      tabs={tabs}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править часть банкомата под курсором") })}
      guideKey="atms"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={project} render={renderLive}>
          <AtmsInspector
            tool={tool}
            project={project}
            target={target}
            onSurface={onSurface}
            onGlow={onGlow}
            onOwn={onOwn}
            onTargetStandard={onTargetStandard}
            onTarget={setTarget}
            onStandard={onStandard}
            onPreset={onPreset}
            onNotice={onNotice}
            focus={picked}
          />
        </StudioLiveProvider>
      }
    >
      <AtmsStage project={deferred} target={target} onCamera={editor.onCamera} onAim={onAim} highlight={selected} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
