/*
 * Зоны: облик оболочек пяти модов — зелёных зон, запретных для капта,
 * бизвара, ВЗХ и порта.
 *
 * Мод запретных зон (`gucci`) кладёт поверх двора, парковки, эстакады или
 * крыши полупрозрачную красную оболочку их формы; мод зелёных зон (`zz`,
 * ТЗ 17.10.2026) — зелёные контуры у 164 мест сервера по всей карте;
 * бизвар, ВЗХ и порт — обвод одной зоны двумя линиями (внешняя синяя,
 * внутренняя красная). Переключатель над кадром — пять видов; у каждого свой
 * облик (цвет с эффектом общего поля мастерской) и прозрачность от
 * невидимых до сплошных, а у любой зоны (у обводов — линии) может быть свой
 * цвет («Как у всех | Свой цвет» в «Зонах»). Формы и места остаются модовыми; у набора свой контейнер слоя
 * Astral, и «Применить» здесь остальные моды не трогает.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): облик
 * вида, свой цвет зоны, список зон и готовые виды — инструменты слева,
 * справа — настройки взятого; вид зон и зона в кадре — над кадром. Общее с
 * «Заводом», «Ангаром» и «Маппингом» (работа, черновик, «Мои работы»,
 * «Применить», камера) — в `useRecolorEditor`.
 */

import { useCallback, useDeferredValue } from "react";
import { ArrowsOut, ListBullets, Palette, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  ZONE_KINDS,
  applyZonesPreset,
  zoneEffect,
  zonesProjectIsHidden,
} from "@modovik/climb-contract/recolor/zones";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import ZonesInspector from "./ZonesInspector.jsx";
import ZonesStage from "./ZonesStage.jsx";
import { fill, findZoneItem, kindLabel, percentText, transparencyOf } from "./zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const ZONES_STORAGE_KEY = "astral.zones.project.v1";

/*
 * Инструменты зон. Цифры — горячие клавиши: буквы в 3D-кадре заняты
 * полётом (W A S D, Q и E).
 */
const ZONES_TOOLS = Object.freeze([
  {
    id: "look",
    label: "Облик",
    icon: <Palette />,
    shortcut: "1",
    group: "paint",
    hint: "Цвет и прозрачность ложатся на все зоны вида сразу; вид зон — переключателем над кадром",
  },
  {
    id: "shape",
    label: "Форма",
    icon: <ArrowsOut />,
    shortcut: "2",
    group: "paint",
    hint: "Ширина линии, высота стенки и неон ложатся на все зоны вида; в кадре — зона вида, что выбрана над ним",
  },
  /* Выбор зоны и её облик — одной панелью (правило 12 `design-qa.md`, 30.10.2026): прежние «Своя зона» и «Зоны». */
  {
    id: "zone",
    label: "Зоны",
    icon: <ListBullets />,
    shortcut: "3",
    group: "paint",
    hint: "Нажмите зону — кадр покажет её; «Облёт» над кадром обойдёт её кругом",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "4",
    group: "ready",
    hint: "Готовый вид меняет все виды зон разом: зелёные, запретные, бизвар, ВЗХ и порт",
  },
]);

/* Итог установки одной строкой. */
function zonesDoneText(result) {
  if (result?.status === "unchanged")
    return tr("Зоны в игре уже такие — ставить было нечего");
  if (result?.hidden) return tr("Зоны стали невидимыми. Перезапустите игру.");
  return tr("Зоны установлены — все пять видов. Перезапустите игру.");
}

export default function ZonesStudio({ onExit, onNotice }) {
  useTr();
  const [remembered, setTool] = useRememberedState("zones:tool", "look");
  /* Прежний инструмент «Зоны» (список) — теперь часть «Зон» с обликом. */
  const tool = remembered === "zones" ? "zone" : remembered;
  const [kind, setKind] = useRememberedState("zones:kind", ZONE_KINDS[0]);
  const zoneKind = ZONE_KINDS.includes(kind) ? kind : ZONE_KINDS[0];
  const [zoneId, setZoneId] = useRememberedState("zones:zone", "");
  const editor = useRecolorEditor({
    set: "zones",
    contract: RECOLOR_PROJECTS.zones,
    storageKey: ZONES_STORAGE_KEY,
    title: tr("Зоны"),
    coverSlotId: "forbidden-zones",
    onNotice,
    resetNotice: tr("Зоны как в моде: зелёные зелёные, запретные красные, у обводов — синяя и красная линии"),
    savedText: tr("Ставим зоны в игру"),
    doneText: zonesDoneText,
    rolledBackText: tr("Зоны сняты из игры — остальные моды на месте"),
  });
  const { project, commit, replace } = editor;
  const selected = findZoneItem(zoneId, zoneKind).id;

  /* Щелчок по зоне в кадре (18.10.2026): её «Своя зона» — цвет этой зоны. */
  const onAim = useCallback(
    (zone) => {
      if (!zone) return;
      setZoneId(zone.id);
      setTool("zone");
    },
    [setZoneId, setTool],
  );

  /* Облик вида зон: эффект, прозрачность. */
  const patchGroup = useCallback(
    (group, values, label) =>
      commit((current) => {
        const next = { ...current[group], ...values };
        /* Включили «свой у каждой» — у зон пока облик вида. */
        if (values.perZone && !current[group].perZone) next.zones = {};
        return { ...current, [group]: next };
      }, label),
    [commit],
  );
  /* Свой цвет у зоны в кадре: начинается с `look` (образец строки «Цвет зоны») или с того, что зона показывает сейчас; «как у всех» убирает только её. */
  const patchZoneOwn = useCallback(
    (group, zone, own, look = null) =>
      commit((current) => {
        const item = current[group];
        const zones = { ...(item.perZone ? item.zones || {} : {}) };
        if (own) zones[zone.id] = look || zoneEffect(current, zone);
        else delete zones[zone.id];
        return { ...current, [group]: { ...item, perZone: Object.keys(zones).length > 0, zones } };
      }, own ? tr("Свой цвет") : tr("Как у всех зон")),
    [commit],
  );
  const patchZoneLook = useCallback(
    (group, id, look, label) =>
      commit((current) => ({ ...current, [group]: { ...current[group], zones: { ...current[group].zones, [id]: look } } }), label),
    [commit],
  );

  const onPreset = useCallback(
    (preset) =>
      replace(
        (current) => applyZonesPreset(current, preset.id),
        `Готовые зоны: ${preset.label}`,
      ),
    [replace],
  );

  /* Кадр догоняет ползунок в свободное время; плитки — когда рука
     остановилась. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);

  const status = zonesProjectIsHidden(project, zoneKind)
    ? fill("{0} · {1} невидимые", project.name || tr("Зоны"), kindLabel(zoneKind))
    : fill("{0} · {1}: {2} прозрачности", editor.status, kindLabel(zoneKind), percentText(transparencyOf(project, zoneKind)));

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor zones-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская зон")}
      status={status}
      tools={ZONES_TOOLS}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править зону под курсором") })}
      guideKey="zones"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <ZonesInspector
          tool={tool}
          project={project}
          presetProject={settled}
          kind={zoneKind}
          zoneId={selected}
          onSelect={setZoneId}
          onGroup={patchGroup}
          onZoneOwn={patchZoneOwn}
          onZoneLook={patchZoneLook}
          onPreset={onPreset}
        />
      }
    >
      <ZonesStage
        project={deferred}
        kind={zoneKind}
        onKind={setKind}
        zoneId={selected}
        onZone={setZoneId}
        onCamera={editor.onCamera}
        onAim={onAim}
        aimed={tool === "zone"}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
