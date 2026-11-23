/*
 * Зоны каптов (ТЗ 10.10.2026, вечер, задача 8: «Добавить зоны для каптов,
 * возможность редактировать цвет, прозрачность»).
 *
 * Мод `heix.rpf` ставит над районами каптов полупрозрачные шайбы —
 * тринадцать каптов и одну над ангаром арены в аэропорту. Здесь их облик:
 * цвет (общий словарь эффектов мастерской) и прозрачность — у всех зон сразу
 * и у каждой своя, свечение, высота стенки и крыша, дальность. В игру зоны
 * едут своими моделями формы мода и своей расстановкой
 * (`recolor-capt-zones.js` главного процесса): «Как в моде» ставится тоже —
 * своего мода у человека может не быть; «Как в игре» — зон нет, «Применить»
 * снимает установку.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): цвет,
 * прозрачность, свечение, стенка, дальность и шаблоны — инструменты слева,
 * справа — настройки взятого; какую зону править («Все зоны» или одну) — над
 * кадром. Общее с остальными местами (работа, черновик, «Мои работы»,
 * «Применить», камера) — в `useRecolorEditor`.
 */

import { useCallback, useDeferredValue } from "react";
import { CircleHalf, Palette, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  CAPT_ZONES,
  applyCaptZonesPreset,
  applyCaptZonesStandard,
  captZoneLook,
  captZonesIsMod,
  captZonesIsStock,
  findCaptZone,
  normalizeCaptZonesProject,
} from "@modovik/climb-contract/recolor/capt-zones";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import CaptZonesInspector from "./CaptZonesInspector.jsx";
import CaptZonesStage from "./CaptZonesStage.jsx";
import { captZoneAimTool } from "./capt-zones-aim.js";
import { ALL_ZONES, glowText, percentText, transparencyOf, zonesCountText } from "./capt-zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const STORAGE_KEY = "astral.captzones.project.v1";

/* Инструменты. Цифры — горячие клавиши: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze([
  { id: "colour", label: "Цвет", icon: <Palette />, shortcut: "1", group: "paint", hint: "Над кадром — какую зону править: «Все зоны» красит все сразу, зона — только её" },
  /* Прозрачность, свечение, стенка и дальность — одной вкладкой «Вид»
     (18.10.2026, владелец: панели «перегружены»): прежде это были четыре
     вкладки по одному ползунку с одинаковыми кнопками внизу каждой. */
  { id: "look", label: "Вид", icon: <CircleHalf />, shortcut: "2", group: "paint", hint: "100 % прозрачности — зоны не видно: в игру она не поедет" },
  { id: "templates", label: "Шаблоны", icon: <Swatches />, shortcut: "3", group: "ready", hint: "Готовый вид меняет цвет, прозрачность и свечение всех зон разом" },
]);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Зоны каптов в игре уже такие — ставить было нечего");
  return tr("Зоны каптов установлены. Перезапустите игру.");
}

/* «Все зоны»: облик и прозрачность ложатся на все — свои у зон уходят. */
function withoutOwn(zones, keys) {
  const out = {};
  for (const [id, own] of Object.entries(zones || {})) {
    const rest = { ...own };
    for (const key of keys) delete rest[key];
    if (Object.keys(rest).length) out[id] = rest;
  }
  return out;
}

export default function CaptZonesStudio({ onExit, onNotice }) {
  useTr();
  const [rememberedTool, setTool] = useRememberedState("captzones:tool", "colour");
  /* Прежние вкладки «Прозрачность», «Свечение», «Стенка», «Дальность» — теперь «Вид». */
  const tool = ["opacity", "glow", "shape", "distance"].includes(rememberedTool) ? "look" : rememberedTool;
  const [savedTarget, setTarget] = useRememberedState("captzones:target", ALL_ZONES);
  const target = savedTarget === ALL_ZONES || findCaptZone(savedTarget) ? savedTarget : ALL_ZONES;
  const editor = useRecolorEditor({
    set: "captzones",
    contract: RECOLOR_PROJECTS.captzones,
    storageKey: STORAGE_KEY,
    title: tr("Зоны каптов"),
    /* Облик автора мода — «Облик мода» (п. 15 `design-qa.md`: «Как в моде» не употребляется; «Как в игре» здесь — без зон). */
    resetLabel: tr("Облик мода"),
    stockLabel: tr("Облик мода"),
    coverSlotId: "capt-zones",
    onNotice,
    stockMeansRemoval: true,
    removalTitle: tr("Убрать зоны каптов Astral из игры"),
    resetNotice: tr("Зоны каптов как в моде: оранжевая дымка, у Муравейника гуще"),
    savedText: tr("Ставим зоны каптов в игру"),
    doneText,
    rolledBackText: tr("Зоны каптов сняты из игры — остальные моды на месте"),
  });
  const { project, commit, replace } = editor;

  /* Щелчок по шайбе в кадре (18.10.2026): её зона и тот из её инструментов, что у зоны свой. */
  const onAim = useCallback(
    (zoneId) => {
      if (!findCaptZone(zoneId)) return;
      setTarget(zoneId);
      setTool(captZoneAimTool(tool));
    },
    [setTarget, setTool, tool],
  );

  const onAll = useCallback(
    (values, label) =>
      commit((current) => {
        const keys = ["look", "opacity"].filter((key) => key in values);
        return { ...current, ...values, enabled: true, ...(keys.length ? { zones: withoutOwn(current.zones, keys) } : {}) };
      }, label),
    [commit],
  );
  const onZone = useCallback(
    (id, values, label) => commit((current) => ({ ...current, enabled: true, zones: { ...current.zones, [id]: { ...current.zones?.[id], ...values } } }), label),
    [commit],
  );
  const onZoneReset = useCallback(
    (id, key) =>
      commit(
        (current) => {
          const own = { ...current.zones?.[id] };
          delete own[key];
          const zones = { ...current.zones };
          if (Object.keys(own).length) zones[id] = own;
          else delete zones[id];
          return { ...current, zones };
        },
        key === "look" ? tr("Цвет как у всех зон") : tr("Прозрачность как у всех зон"),
      ),
    [commit],
  );
  const onPreset = useCallback((preset) => replace((current) => applyCaptZonesPreset(current, preset.id), `Готовые зоны: ${preset.label}`), [replace]);
  const onStandard = useCallback(() => replace((current) => applyCaptZonesStandard(current), tr("Как в игре: зон каптов Astral нет")), [replace]);
  const onEnable = useCallback(() => commit((current) => ({ ...current, enabled: true }), "Зоны каптов вернулись"), [commit]);

  /* Кадр догоняет ползунок в свободное время; плитки — когда рука остановилась. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const normal = normalizeCaptZonesProject(project);
  const visible = CAPT_ZONES.filter((zone) => !captZoneLook(normal, zone).hidden).length;
  const status = captZonesIsStock(normal)
    ? `${editor.status} · зон нет`
    : `${editor.status} · ${zonesCountText(visible)} · прозрачность ${percentText(transparencyOf(normal.opacity))} · свечение ${glowText(normal.glow)}`;

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor capt-zones-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская зон каптов")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править зону под курсором") })}
      guideKey="captzones"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <CaptZonesInspector
          tool={tool}
          project={normal}
          presetProject={settled}
          target={target}
          onTarget={setTarget}
          onAll={onAll}
          onZone={onZone}
          onZoneReset={onZoneReset}
          onPreset={onPreset}
          onStandard={onStandard}
          onEnable={onEnable}
          onReset={editor.resetToMod}
          isMod={captZonesIsMod(normal)}
        />
      }
    >
      <CaptZonesStage project={deferred} target={target} onTarget={setTarget} onCamera={editor.onCamera} onAim={onAim} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
