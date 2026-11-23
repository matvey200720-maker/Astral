/*
 * МСЛ-зоны на земле (ТЗ 08.10.2026, задача 3): светящиеся линии границ
 * районов из мода `mcl.rpf` — цвет у каждого цвета мода свой, ширина и
 * высота объёмом, дальность прорисовки, прозрачность.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): цвет,
 * ширина и высота, дальность, шаблоны — инструменты слева, справа —
 * настройки взятого; район в кадре — над кадром. Общее с «Зонами»
 * (работа, черновик, «Мои работы», «Применить», камера) — в
 * `useRecolorEditor`. «Как в моде» — сброс; линии ставятся и тогда:
 * своего мода у человека может не быть.
 *
 * 10.10.2026 (задача 1): у каждого из девяти цветов мода — свой облик,
 * стенка встаёт по оси ленты (а не наискосок), дальность — от 25 м:
 * линия появляется, когда к ней подъезжаешь.
 */

import { useCallback, useDeferredValue } from "react";
import { Cube, Eye, Palette, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { MSL_PALETTE, applyMslZonesPreset, createMslZonesProject, mslChangedColours, normalizeMslZonesProject } from "@modovik/climb-contract/recolor/msl-zones";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import MslZonesInspector from "./MslZonesInspector.jsx";
import MslZonesStage from "./MslZonesStage.jsx";
import { MSL_AIM_TOOL } from "./msl-zones-aim.js";
import { useMslScene, useMslTilePlan } from "./msl-zones-art.js";
import { distanceText, metresText } from "./msl-zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const STORAGE_KEY = "astral.mslzones.project.v1";

/* Инструменты. Цифры — горячие клавиши: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze([
  { id: "look", label: "Цвет", icon: <Palette />, shortcut: "1", group: "paint", hint: "Нажмите цвет мода справа и выберите, во что его перекрасить; «Один на все линии» — один облик на все линии" },
  { id: "shape", label: "Ширина и высота", icon: <Cube />, shortcut: "2", group: "paint", hint: "Высота делает линию объёмной — сплошной стенкой по оси ленты" },
  { id: "distance", label: "Дальность прорисовки", icon: <Eye />, shortcut: "3", group: "paint", hint: "От 25 м: линия появляется, когда к ней подъезжаешь" },
  { id: "templates", label: "Шаблоны", icon: <Swatches />, shortcut: "4", group: "ready", hint: "Готовый вид меняет все настройки разом" },
]);

function doneText(result) {
  if (result?.status === "unchanged") return tr("МСЛ-зоны в игре уже такие — ставить было нечего");
  return tr("МСЛ-зоны установлены во всех десяти районах. Перезапустите игру.");
}

export default function MslZonesStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("mslzones:tool", "look");
  const [districtId, setDistrictId] = useRememberedState("mslzones:district", "city");
  const [colourId, setColourId] = useRememberedState("mslzones:colour", MSL_PALETTE[0].id);
  const editor = useRecolorEditor({
    set: "mslzones",
    contract: RECOLOR_PROJECTS.mslzones,
    storageKey: STORAGE_KEY,
    title: tr("МСЛ-зоны"),
    coverSlotId: "msl-zones",
    onNotice,
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    resetNotice: tr("МСЛ-зоны как в моде: палитра, лента 0,4 м, видно с 1,5 км"),
    savedText: tr("Ставим МСЛ-зоны в игру"),
    doneText,
    rolledBackText: tr("МСЛ-зоны сняты из игры — остальные моды на месте"),
  });
  const { project, commit, replace } = editor;
  /* Щелчок по линии в кадре (18.10.2026): её цвет мода — в «Цвете», где правится его облик. */
  const onAim = useCallback(
    (id) => {
      setColourId(id);
      setTool(MSL_AIM_TOOL);
    },
    [setColourId, setTool],
  );
  const onPatch = useCallback((values, label) => commit((current) => ({ ...current, ...values }), label), [commit]);
  const onPreset = useCallback((preset) => replace((current) => applyMslZonesPreset(current, preset.id), `Готовые линии: ${preset.label}`), [replace]);
  const onStandard = useCallback(
    () => replace((current) => ({ ...createMslZonesProject(), name: current.name }), tr("Как в игре")),
    [replace],
  );
  /* Кадр догоняет ползунок в свободное время; плитки — когда рука остановилась. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const normal = normalizeMslZonesProject(project);
  /* В кадре подсвечены линии цвета, что открыт в «Цвете»: при «одном цвете на все линии» цвет мода ни при чём, а невидимые линии подсвечивать нечем. */
  const selectedColour = tool === "look" && !normal.ownColour && normal.opacity > 0 ? colourId : null;
  /* Сколько кусков и когда линия появится — по лентам сцены, когда рука
     остановилась на дальности. */
  const asset = useMslScene();
  const tilePlan = useMslTilePlan(asset, normalizeMslZonesProject(settled).drawDistance);
  const colours = mslChangedColours(normal);
  const status = `${editor.status}${colours ? trFill(" · своих цветов: {0} из {1}", colours, MSL_PALETTE.length) : ""}${trFill(" · лента {0}", metresText(normal.width))}${normal.height > 0 ? trFill(", стенка {0}", metresText(normal.height)) : ""}${trFill(" · видно с {0}", distanceText(normal.drawDistance))}`;

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor msl-zones-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская МСЛ-зон")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: tr("править цвет линий под курсором") })}
      guideKey="mslzones"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <MslZonesInspector
          tool={tool}
          project={normal}
          presetProject={settled}
          colourId={colourId}
          tilePlan={tilePlan}
          onColour={setColourId}
          onPatch={onPatch}
          onPreset={onPreset}
          onStandard={onStandard}
        />
      }
    >
      <MslZonesStage project={deferred} districtId={districtId} onDistrict={setDistrictId} onCamera={editor.onCamera} onAim={onAim} selected={selectedColour} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
