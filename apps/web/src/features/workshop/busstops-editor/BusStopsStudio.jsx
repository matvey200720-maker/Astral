/*
 * Редактор «Остановки» — автобусные остановки всей карты (задача 5 ТЗ
 * 06.10.2026).
 *
 * Основа — штатные остановки игры игрока, всё по умолчанию «Стандарт».
 * Сверху — что правится: «Все» (облик всех остановок сразу) или один из
 * видов (навес со скамьёй, навес с подсветкой, городской навес, знак).
 * Инструменты слева (мастерская «как в Photoshop»), справа — настройки
 * взятого: цвет и текстура частей (общая отделка и поле цветовых
 * эффектов, «Без текстуры»), прозрачность, шаблоны и «Как в игре». Кадр —
 * сами остановки в 3D на матовой плашке; облик в кадре меняется сразу.
 *
 * Будки (задача 11 ТЗ 18.10.2026): рядом с остановками — второй объект
 * «Будки», парковочные будки «24 HRS. PARK»: свой кадр с двумя будками игры,
 * вкладки «Обе / Будка 1 / Будка 2», цвет и текстура частей (корпус, козырёк,
 * рамы, крыша, надписи, листки, стекло, пол), шаблоны. Работа одна — будки
 * лежат в ней рядом с остановками и ставятся тем же «Применить».
 *
 * Общее с остальными редакторами мест (работа, черновик, «Мои работы»,
 * «Применить», камера) — `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { PaintBucket, Swatches } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { BUSSTOP_OPACITY, BUSSTOP_TYPES, applyBusStopsBoothsPreset, applyBusStopsBoothsStandard, applyBusStopsPreset, applyBusStopsStandard } from "@modovik/climb-contract/recolor/busstops";
import { normalizeBooths } from "@modovik/climb-contract/recolor/busstop-booths";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import BoothsInspector from "./BoothsInspector.jsx";
import BoothsStage from "./BoothsStage.jsx";
import BusStopsInspector from "./BusStopsInspector.jsx";
import BusStopsStage from "./BusStopsStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { wallFromHit } from "../texture-studio/wall-pick.js";
import { BOOTH_PART_TOOL, boothPartSpec } from "./booths-aim.js";
import { BOOTH_TARGET_IDS, boothTargetLabel, boothTargetOptions } from "./booths-text.js";
import { BUSSTOP_PART_TOOL, busStopPartSpec } from "./busstops-aim.js";
import { busStopsImages } from "./busstops-images.js";
import { TARGET_OPTIONS, targetLabel } from "./busstops-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Цифры — горячие клавиши по порядку панели: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze(
  [
    {
      id: "paint",
      label: "Цвет и текстура",
      icon: <PaintBucket />,
      group: "paint",
      hint: "Выберите сверху, какие остановки правите, — все сразу или один вид. Каждую часть можно покрасить, заменить узором или картинкой, или убрать текстуру; под частями — прозрачность",
    },
    {
      id: "templates",
      label: "Шаблоны",
      icon: <Swatches />,
      group: "ready",
      hint: "Готовый вид оформляет все остановки разом — дальше любую часть и любой вид можно поправить",
    },
  ].map((tool, index) => Object.freeze({ ...tool, shortcut: String(index + 1) })),
);
const TOOL_IDS = TOOLS.map((tool) => tool.id);
const TARGET_IDS = TARGET_OPTIONS.map((option) => option.value);

/* У будок прозрачности нет (шейдеры стёкол и палитры её не несут). */
const BOOTH_TOOLS = Object.freeze(
  [
    {
      id: "paint",
      label: "Цвет и текстура",
      icon: <PaintBucket />,
      group: "paint",
      hint: "Выберите сверху, какие будки правите, — обе сразу или одну. Каждую часть можно покрасить, а на надписи и листки — поставить свою картинку",
    },
    {
      id: "templates",
      label: "Шаблоны",
      icon: <Swatches />,
      group: "ready",
      hint: "Готовый вид оформляет обе будки разом — дальше любую часть и любую будку можно поправить",
    },
  ].map((tool, index) => Object.freeze({ ...tool, shortcut: String(index + 1) })),
);
const BOOTH_TOOL_IDS = BOOTH_TOOLS.map((tool) => tool.id);

/* Объекты редактора: остановки и будки. */
const OBJECT_IDS = Object.freeze(["stops", "booths"]);
const objectOptions = () => [
  { value: "stops", label: tr("Остановки") },
  { value: "booths", label: tr("Будки") },
];

function doneText(result) {
  if (result?.status === "unchanged") return tr("Остановки и будки в игре уже такие — ставить было нечего");
  return tr("Остановки и будки установлены. Перезапустите игру.");
}

/* Облик вида, который правят на его вкладке: свой или — первой правкой — копия общего. */
function ownLook(current, target) {
  const type = current.types[target];
  return type.own ? type : { ...type, own: true, parts: current.all.parts, opacity: current.all.opacity };
}

/* То же у будки: свой облик или — первой правкой — копия облика «Обе». */
function ownBoothLook(booths, target) {
  const type = booths.types[target];
  return type.own ? type : { ...type, own: true, parts: booths.all.parts };
}

export default function BusStopsStudio({ onExit, onNotice }) {
  useTr();
  const [savedTool, setTool] = useRememberedState("busstops:tool", "paint");
  const [savedTarget, setTarget] = useRememberedState("busstops:target", "all");
  const [savedObject, setObject] = useRememberedState("busstops:object", "stops");
  const [savedBoothTarget, setBoothTarget] = useRememberedState("busstops:booth-target", "all");
  const object = OBJECT_IDS.includes(savedObject) ? savedObject : "stops";
  const booths = object === "booths";
  const tool = (booths ? BOOTH_TOOL_IDS : TOOL_IDS).includes(savedTool) ? savedTool : "paint";
  const target = TARGET_IDS.includes(savedTarget) ? savedTarget : "all";
  const boothTarget = BOOTH_TARGET_IDS.includes(savedBoothTarget) ? savedBoothTarget : "all";
  const contract = RECOLOR_PROJECTS.busstops;
  const editor = useRecolorEditor({
    set: "busstops",
    contract,
    storageKey: "astral.busstops.project.v1",
    title: tr("Остановки"),
    coverSlotId: "busstops",
    onNotice,
    resetNotice: tr("Остановки и будки как в игре"),
    resetLabel: tr("Как в игре"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять остановки и будки Astral — в игре станут как были"),
    savedText: tr("Ставим остановки и будки в игру"),
    doneText,
    rolledBackText: tr("Остановки и будки сняты из игры — остальные моды на месте"),
    images: busStopsImages,
  });
  const { project, commit, replace } = editor;

  /* Щелчок по части остановки в кадре (18.10.2026): «Цвет и текстура», вкладка её вида и раздел части в колонке правок. */
  const [picked, setPicked] = useState(null);
  /* Стена, по которой щёлкнули в кадре (3Б ТЗ 18.10.2026): «Студия» её вида откроется на ней. */
  const [wall, setWall] = useState(null);
  const onAim = useCallback(
    (aim, hit) => {
      setWall(wallFromHit(hit));
      setTool(aim.tool);
      setTarget(aim.target);
      setPicked({ part: aim.part, at: Date.now() });
    },
    [setTool, setTarget],
  );
  const onBoothAim = useCallback(
    (aim) => {
      setTool(aim.tool);
      setBoothTarget(aim.target);
      setPicked({ part: aim.part, at: Date.now() });
    },
    [setTool, setBoothTarget],
  );
  /* Выбранная часть подсвечена, пока взяты «Цвет и текстура»; «Все» — у всех видов. Не выбрано — нигде (не по последнему щелчку кадра). */
  const selected = useMemo(
    () => (picked && tool === (booths ? BOOTH_PART_TOOL : BUSSTOP_PART_TOOL) ? (booths ? boothPartSpec(boothTarget, picked.part) : busStopPartSpec(target, picked.part)) : null),
    [picked, tool, target, booths, boothTarget],
  );

  /* Правка облика взятой вкладки: у вида — его свой облик. */
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
  const onOpacity = useCallback((where, opacity, label) => editLook(where, (look) => ({ ...look, opacity }), label), [editLook]);
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
          opacity: BUSSTOP_OPACITY.standard,
          parts: Object.fromEntries(Object.entries(look.parts).map(([part, surface]) => [part, { ...surface, mode: "standard" }])),
        }),
        `${targetLabel(where)}: стандарт`,
      ),
    [editLook],
  );
  const onPreset = useCallback((preset) => replace((current) => applyBusStopsPreset(current, preset.id), `Готовый вид: ${preset.label}`), [replace]);
  const onStandard = useCallback(() => replace((current) => applyBusStopsStandard(current), "Стандарт"), [replace]);

  /* Правка облика будок: «Обе» — общий облик, будка — её свой облик (первой правкой — копия общего). */
  const editBoothLook = useCallback(
    (where, update, label) =>
      commit((current) => {
        const all = normalizeBooths(current.booths);
        if (where === "all") return { ...current, booths: { ...all, all: update(all.all) } };
        return { ...current, booths: { ...all, types: { ...all.types, [where]: update(ownBoothLook(all, where)) } } };
      }, label),
    [commit],
  );
  const onBoothSurface = useCallback(
    (where, part, patch, label) => editBoothLook(where, (look) => ({ ...look, parts: { ...look.parts, [part]: { ...look.parts[part], ...patch } } }), label),
    [editBoothLook],
  );
  const onBoothOwn = useCallback(
    (where, on) =>
      commit((current) => {
        const all = normalizeBooths(current.booths);
        return { ...current, booths: { ...all, types: { ...all.types, [where]: on ? ownBoothLook(all, where) : { ...all.types[where], own: false } } } };
      }, `${boothTargetLabel(where)}: ${on ? tr("свой облик") : tr("как у обеих")}`),
    [commit],
  );
  const onBoothTargetStandard = useCallback(
    (where) =>
      editBoothLook(
        where,
        (look) => ({ ...look, parts: Object.fromEntries(Object.entries(look.parts).map(([part, surface]) => [part, { ...surface, mode: "standard" }])) }),
        `${boothTargetLabel(where)}: ${tr("стандарт")}`,
      ),
    [editBoothLook],
  );
  const onBoothPreset = useCallback((preset) => replace((current) => applyBusStopsBoothsPreset(current, preset.id), `${tr("Готовый вид")}: ${tr(preset.label)}`), [replace]);
  const onBoothStandard = useCallback(() => replace((current) => applyBusStopsBoothsStandard(current), tr("Стандарт")), [replace]);

  /* Вкладки сверху: что правим — остановки или будки, и какие именно. */
  const tabs = useMemo(
    () => (
      <div className="busstops-tabs">
        <SegmentedControl label={tr("Что правим")} size="sm" className="busstops-objects" options={objectOptions()} value={object} onChange={setObject} />
        {booths ? (
          <SegmentedControl label={tr("Какие будки")} size="sm" className="busstops-targets" options={boothTargetOptions()} value={boothTarget} onChange={setBoothTarget} />
        ) : (
          <SegmentedControl label={tr("Какие остановки")} size="sm" className="busstops-targets" options={TARGET_OPTIONS} value={target} onChange={setTarget} />
        )}
      </div>
    ),
    [object, setObject, booths, boothTarget, setBoothTarget, target, setTarget],
  );
  const deferred = useDeferredValue(project);
  /* Кадр остановок для «Студии»: тот же кадр (вкладка — та же) с работой, где на месте поверхности стоит холст студии. */
  const renderLive = useCallback(
    (live, hint) => <BusStopsStage project={live} target={target === "all" ? BUSSTOP_TYPES.find((type) => type.parts.includes(hint?.part))?.id || "all" : target} focus={hint?.focus} wall={hint?.wall} />,
    [target],
  );

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor busstops-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская остановок")}
      status={editor.status}
      tabs={tabs}
      tools={booths ? BOOTH_TOOLS : TOOLS}
      tool={tool}
      onTool={setTool}
      guide={editor.guide(false, { aim: booths ? tr("править часть будки под курсором") : tr("править часть остановки под курсором") })}
      guideKey="busstops"
      guideFlash={editor.cameraMode}
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        booths ? (
          <BoothsInspector
            tool={tool}
            project={project}
            target={boothTarget}
            onSurface={onBoothSurface}
            onOwn={onBoothOwn}
            onTargetStandard={onBoothTargetStandard}
            onStandard={onBoothStandard}
            onPreset={onBoothPreset}
            onNotice={onNotice}
            focus={picked}
          />
        ) : (
          <StudioLiveProvider project={project} render={renderLive} wall={wall}>
            <BusStopsInspector
              tool={tool}
              project={project}
              target={target}
              onSurface={onSurface}
              onOpacity={onOpacity}
              onOwn={onOwn}
              onTargetStandard={onTargetStandard}
              onStandard={onStandard}
              onPreset={onPreset}
              onNotice={onNotice}
              focus={picked}
            />
          </StudioLiveProvider>
        )
      }
    >
      {booths ? (
        <BoothsStage project={deferred} target={boothTarget} onCamera={editor.onCamera} onAim={onBoothAim} highlight={selected} />
      ) : (
        <BusStopsStage project={deferred} target={target} onCamera={editor.onCamera} onAim={onAim} highlight={selected} wall={wall} />
      )}
      {editor.works.dialogs}
    </EditorShell>
  );
}
