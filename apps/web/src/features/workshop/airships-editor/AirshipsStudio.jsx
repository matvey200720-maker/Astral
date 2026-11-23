/*
 * «Дирижабли» (ТЗ 11.10.2026: «добавь в редактор мастерской чтобы люди
 * могли редактировать этот дирижабль и чтобы он отображался на РП
 * проектах, сделай готовые модельки дракона, воздушных шаров и т. д. и
 * сделай чтобы люди могли выбирать количество их в небе»).
 *
 * Раскладка — мастерская «как в Photoshop»: вид выбирается в одном
 * инструменте, настраивается в других (ТЗ 11.10.2026, вечер, задача 3):
 * «Виды», «Цвет», «Лого», «Размер и полёт», «Дирижабль», «Шаблоны» —
 * инструменты слева, справа — настройки взятого; кадр — дирижабль игры с
 * листом работы или выбранный вид своей моделью (крылья машут, огонь
 * мерцает — как в игре).
 *
 * Что в кадре — переключатель видов в шапке (ТЗ владельца 22.10.2026), и
 * инструмент его не меняет: раньше щелчок по «Дирижаблю» слева сбрасывал
 * выбранного Феникса на жёлто-синий дирижабль. «Дирижабль» правит только
 * дирижабль игры — при другом виде в кадре он гаснет и в подсказке говорит
 * почему.
 * Общее с остальными местами (работа, черновик, «Мои работы», «Применить»,
 * камера) — в `useRecolorEditor`; «Стандарт» — дирижабль как в игре и
 * пустое небо, «Применить» тогда снимает установку.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ArrowsOut, Palette, Star, Sticker, Swatches, TextT } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import { AIRSHIP_DEFAULT_TEXT, AIRSHIP_KINDS, airshipCount, airshipKind, applyAirshipsPreset, applyAirshipsStandard, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import AirshipsInspector from "./AirshipsInspector.jsx";
import AirshipsStage from "./AirshipsStage.jsx";
import { AirshipKindThumb } from "./AirshipsArt.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { airshipsImages } from "./airships-images.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const STORAGE_KEY = "astral.airships.project.v1";

const TOOLS = Object.freeze([
  { id: "sky", label: "Виды", icon: <Star />, shortcut: "1", group: "paint", hint: "Щёлкните по виду — он встанет в кадр, его правят «Цвет», «Лого» и «Размер»" },
  { id: "look", label: "Цвет", icon: <Palette />, shortcut: "2", group: "paint", hint: "Цвета выбранного вида и своя картинка на теле — своя или нарисованная" },
  { id: "logo", label: "Лого", icon: <Sticker />, shortcut: "3", group: "paint", hint: "Надпись своим шрифтом или картинка — на крыльях, боках, куполе или полотнище" },
  { id: "flight", label: "Размер и полёт", icon: <ArrowsOut />, shortcut: "4", group: "paint", hint: "Размер — у каждого вида свой; высота — над самыми высокими крышами, деревьями и горами под кругом" },
  { id: "blimp", label: "Дирижабль", icon: <TextT />, shortcut: "5", group: "paint", hint: "Штатный дирижабль игры: что на борту, цвета и летает ли он в вашем облике" },
  { id: "templates", label: "Шаблоны", icon: <Swatches />, shortcut: "6", group: "ready", hint: "Готовый вид меняет состав неба и высоту — надпись, лого и цвета остаются вашими" },
]);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Дирижабли в игре уже такие — ставить было нечего");
  return tr("Дирижабли поставлены в игру. Перезапустите игру.");
}

/* «Дирижабль» — лист дирижабля игры: у Феникса, Кита и других его нет. */
const BLIMP_ONLY = "Доступно только для стандартного дирижабля";

export default function AirshipsStudio({ onExit, onNotice }) {
  useTr();
  const language = useUiLanguage();
  const [tool, setTool] = useRememberedState("airships:tool", "sky");
  const [kind, setKind] = useRememberedState("airships:kind", "blimp");
  const editor = useRecolorEditor({
    set: "airships",
    contract: RECOLOR_PROJECTS.airships,
    storageKey: STORAGE_KEY,
    title: "Дирижабли",
    coverSlotId: "airships",
    onNotice,
    images: airshipsImages,
    resetLabel: tr("Исходный вид"),
    stockLabel: tr("Как в игре"),
    stockMeansRemoval: true,
    removalTitle: tr("Снять дирижабли Astral — дирижабль станет как в игре, небо пустым"),
    resetNotice: trFill("Исходный вид: дирижабль «{0}», в небе один дирижабль", AIRSHIP_DEFAULT_TEXT),
    savedText: tr("Ставим дирижабли в игру"),
    doneText,
    rolledBackText: tr("Дирижабли сняты из игры — остальные моды на месте"),
  });
  const { project, commit, replace } = editor;
  const onPatch = useCallback((values, label) => commit((current) => ({ ...current, ...values }), label), [commit]);
  const onPreset = useCallback((preset) => replace((current) => applyAirshipsPreset(current, preset.id), trFill("Готовое небо: {0}", tr(preset.label))), [replace]);
  const onStandard = useCallback(() => replace((current) => applyAirshipsStandard(current), "Как в игре"), [replace]);
  const shown = airshipKind(kind) ? kind : "blimp";
  /* Инструмент вид в кадре не меняет. «Дирижабль» при другом виде погашен — взятый раньше уступает «Цвету». */
  /* «Цвет», «Лого» и «Размер» правят вид в кадре: его имя — подписью под именем панели (строки «Вид» на каждой вкладке нет, критик 31.10.2026). */
  const tools = useMemo(
    () =>
      TOOLS.map((item) =>
        item.id === "blimp" && shown !== "blimp"
          ? { ...item, disabled: true, disabledReason: BLIMP_ONLY }
          : ["look", "logo", "flight"].includes(item.id)
            ? { ...item, note: tr(airshipKind(shown).label) }
            : item,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- язык меняет подпись
    [shown, language],
  );
  const activeTool = tool === "blimp" && shown !== "blimp" ? "look" : tool;
  const onTool = useCallback((next) => setTool(next), [setTool]);
  /* Вид в кадре — переключатель в шапке и щелчок по виду в «Видах». */
  const onKind = useCallback(
    (next) => {
      setKind(next);
      if (next !== "blimp" && tool === "blimp") setTool("look");
    },
    [setKind, setTool, tool],
  );
  /* Щелчок по вещи в кадре (18.10.2026): инструмент, которым её правят; у своей модели
     запоминаем часть — «Цвет» подсвечивает её, пока открыт. */
  const [aimed, setAimed] = useState(null);
  const onAim = useCallback(
    (target) => {
      onTool(target.tool === "blimp" && shown !== "blimp" ? "look" : target.tool);
      if (target.kind !== "blimp") setAimed({ kind: target.kind, role: target.role || "" });
    },
    [onTool, shown],
  );
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  /* Кадр дирижаблей для «Студии»: тот же кадр, вид — тот, чьё место правится, без полосы видов. */
  const renderLive = useCallback((live, hint) => <AirshipsStage project={live} thumbs={live} kind={hint?.kind || shown} bare />, [shown]);
  const normal = normalizeAirshipsProject(project);
  /* Виды снимками моделей в облике работы (`settled` — работа, переставшая меняться: снимки не снимаются на каждый шаг ползунка). */
  const kindOptions = useMemo(
    () => AIRSHIP_KINDS.map((info) => ({ value: info.id, label: tr(info.label), title: tr(info.label), iconOnly: true, icon: <AirshipKindThumb kindId={info.id} project={settled} className="airships-stage-thumb" /> })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- язык меняет подписи
    [settled, language],
  );
  /* Слов на борту в шапке нет: их видно в кадре, а длинная строка обрезала и шапку, и имя мастерской (критик 31.10.2026). */
  const status = (
    <>
      {editor.status} · {trFill("в небе {0}", airshipCount(normal))}
    </>
  );

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor airships-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская дирижаблей")}
      status={status}
      scene={{ label: tr("Что в кадре"), className: "airships-stage-kinds", options: kindOptions, value: shown, onChange: onKind }}
      tools={tools}
      tool={activeTool}
      onTool={onTool}
      guide={editor.guide(false, { aim: tr("править то, что под курсором") })}
      guideKey="airships"
      actions={
        <EditorActions {...editor.actionProps({ compare: true })} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={normal} render={renderLive}>
          <AirshipsInspector tool={activeTool} project={normal} presetProject={settled} kind={shown} onKind={onKind} onTool={onTool} onPatch={onPatch} onPreset={onPreset} onStandard={onStandard} onNotice={onNotice} />
        </StudioLiveProvider>
      }
    >
      <AirshipsStage project={editor.shown(deferred)} thumbs={settled} kind={shown} onCamera={editor.onCamera} onAim={onAim} tool={activeTool} aimed={aimed} />
      {editor.works.dialogs}
    </EditorShell>
  );
}
