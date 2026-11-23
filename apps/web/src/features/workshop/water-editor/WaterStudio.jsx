/*
 * Вода: цвет и прозрачность моря, озёр и рек.
 *
 * Своих файлов у воды нет — установщик правит файлы игры игрока: туман
 * воды (цвет толщи) в плитках update.rpf, альфу квадов `water.xml`
 * (прозрачность) и туман рек в их моделях — с копиями для дальней
 * прорисовки. Дождь, лужи, бассейны и фонтаны — другие файлы, их вода не
 * трогает. Устройство и пределы — `@modovik/climb-contract/recolor/water`.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): вода и
 * готовые виды — инструменты слева, справа — настройки взятого; вид кадра
 * («Вблизи», «Под водой») — над кадром. Море, озёра и реки — одна
 * настройка (задача 2), под водой — как сверху или своя. Общее с остальными
 * наборами (работа, черновик, «Мои работы», «Применить», «Снять из игры») —
 * в `useRecolorEditor`; исходный облик здесь — «как в игре», и «Применить»
 * его снимает установку воды.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Swatches, WaveSine } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { applyWaterPreset, waterUnderLook } from "@modovik/climb-contract/recolor/water";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import WaterInspector from "./WaterInspector.jsx";
import WaterStage from "./WaterStage.jsx";
import { compileWaterLooks, percentText, visibilityText } from "./water-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const WATER_STORAGE_KEY = "astral.water.project.v1";

/* Час кадра по умолчанию — день: цвет воды такой, как в работе, а свет ещё мягкий. */
const DEFAULT_HOUR = 15;

/*
 * Инструменты воды. Цифры — горячие клавиши: буквы в 3D-кадре заняты
 * полётом (W A S D, Q и E).
 */
const WATER_TOOLS = Object.freeze([
  {
    id: "water",
    label: "Вода",
    icon: <WaveSine />,
    shortcut: "1",
    group: "water",
    hint: "Цвет и прозрачность всей воды сверху и вид под водой — кадр покажет их сразу; «Под водой» — над кадром",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "2",
    group: "ready",
    hint: "Готовый вид меняет море, озёра и реки разом — дальше любое можно поправить",
  },
]);

/* Итог установки одной строкой. */
function waterDoneText(result) {
  if (result?.status === "unchanged") return tr("Вода в игре уже такая — ставить было нечего");
  return tr("Вода установлена — море, озёра и реки. Перезапустите игру.");
}

export default function WaterStudio({ onExit, onNotice }) {
  useTr();
  const [rememberedTool, setTool] = useRememberedState("water:tool", "water");
  /* Прежние «Море» и «Озёра и реки» — теперь один инструмент «Вода». */
  const tool = rememberedTool === "templates" ? "templates" : "water";
  const [view, setView] = useRememberedState("water:view", "close");
  /* Час суток кадра из игры: днём цвет воды такой, как в работе, а к ночи темнеет. */
  const [hour, setHour] = useState(DEFAULT_HOUR);
  const editor = useRecolorEditor({
    set: "water",
    contract: RECOLOR_PROJECTS.water,
    storageKey: WATER_STORAGE_KEY,
    title: tr("Вода"),
    coverSlotId: "water",
    onNotice,
    resetNotice: tr("Вода как в игре: цвет и прозрачность Rockstar"),
    savedText: tr("Ставим воду в игру"),
    doneText: waterDoneText,
    rolledBackText: tr("Вода снята из игры — цвет и прозрачность Rockstar"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
  });
  const { project, commit, replace } = editor;

  /* Облик воды сверху: свой цвет, эффект, прозрачность — у всей воды. */
  const patchGroup = useCallback(
    (key, values, label) => commit((current) => ({ ...current, [key]: { ...current[key], ...values } }), label),
    [commit],
  );
  /* Под водой: как сверху, своя или как в игре. */
  const patchUnder = useCallback((values, label) => commit((current) => ({ ...current, under: { ...current.under, ...values } }), label), [commit]);

  const onPreset = useCallback(
    (preset) => replace((current) => applyWaterPreset(current, preset.id), `Готовая вода: ${preset.label}`),
    [replace],
  );

  /* Кадр догоняет ползунок в свободное время; плитки — когда рука
     остановилась. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const looks = useMemo(() => compileWaterLooks(deferred), [deferred]);
  const under = useMemo(() => waterUnderLook(deferred), [deferred]);
  const current = compileWaterLooks(project).sea;

  const status = `${editor.status} · Вся вода: ${percentText(current.transparency)} прозрачности, дно до ${visibilityText(current.transparency)}`;
  /* Над кадром два вида; любое другое запомненное значение — «Вблизи». */
  const stageView = view === "under" ? "under" : "close";

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor water-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская воды")}
      status={status}
      tools={WATER_TOOLS}
      tool={tool}
      onTool={setTool}
      guide={stageView === "close" ? editor.guide() : null}
      guideKey="water"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <WaterInspector
          tool={tool}
          project={project}
          presetProject={settled}
          onGroup={patchGroup}
          onUnder={patchUnder}
          onPreset={onPreset}
          onStock={editor.resetToMod}
        />
      }
    >
      <WaterStage
        project={deferred}
        looks={looks}
        under={under}
        view={stageView}
        onView={setView}
        hour={hour}
        onHourChange={setHour}
        onCamera={editor.onCamera}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
