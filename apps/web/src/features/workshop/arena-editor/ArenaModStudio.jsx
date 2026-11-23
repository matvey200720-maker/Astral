/*
 * Арена мода: «Редактировать» у арены каталога открывает готовый зал самого мода (Хелпер 7, 25.10.2026).
 *
 * Работа несёт `project.mod` (`arena-mod.js`): какой мод открыт и что человек сделал с его листами. Кадр — зал мода из его файлов
 * поверх зала игры (`arena-mod-hall.js`: собирает Astral Desktop), колонка — листы мода (`ArenaModInspector.jsx`). «Применить»
 * ставит правку поверх поставленного мода (`recolor-arena-mod.js`), как остальные правки арены. Студия живёт внутри `ArenaStudio`:
 * та же работа, то же хранилище, те же кнопки; пока открыт мод, штатные разделы арены не нужны — они про арену сервера.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { arenaModIsStock } from "@modovik/climb-contract/recolor/arena-mod";
import { Cube, Swatches } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useRailGroups } from "../../../components/ui/useRailGroups.jsx";
import ArenaModInspector from "./ArenaModInspector.jsx";
import ArenaModStage from "./ArenaModStage.jsx";
import { sheetAreas, useArenaModHall } from "./arena-mod-hall.js";
import { useArenaModTextures } from "./arena-mod-textures.js";
import { tr, useTr } from "../../../locales/ui.js";

const TOOLS = Object.freeze([
  {
    id: "sheets",
    label: "Листы мода",
    icon: <Swatches />,
    group: "main",
    scenes: ["inside"],
    hint: "Выберите лист в списке справа или нажмите колесом по залу — и перекрасьте его, замените картинкой или уберите",
  },
  {
    id: "standard",
    label: "Штатная арена",
    icon: <Cube />,
    group: "ready",
    note: "GTA 5 RP и Majestic",
    hint: "Закрыть арену мода и открыть штатные арены GTA 5 RP и Majestic",
  },
]);
const GROUPS = Object.freeze([
  { id: "mod-sheets", ids: ["sheets"], label: "Листы мода", icon: <Swatches />, group: "main", demo: "paint" },
  { id: "mod-standard", ids: ["standard"], label: "Штатная арена", icon: <Cube />, group: "ready" },
]);

/** Заглушка кадра, пока зал собирается или не собрался: слова, а не пустота. */
function StageNote({ state, onStandard }) {
  useTr();
  const text =
    state.status === "unsupported"
      ? tr("Зал мода доступен в Astral Desktop.")
      : state.status === "failed"
        ? tr("Не удалось открыть зал мода: {0}").replace("{0}", state.error || tr("причина неизвестна"))
        : tr("Собираю зал мода из его файлов и вашей игры — в первый раз это занимает несколько минут.");
  return (
    <div className="fx-stage recolor-stage is-studio">
      <p className="model-stage-note" role={state.status === "failed" ? "alert" : "status"}>
        {text}
      </p>
      {state.status === "failed" ? (
        <Button variant="primary" onClick={onStandard}>
          {tr("Открыть штатную арену")}
        </Button>
      ) : null}
    </div>
  );
}

export default function ArenaModStudio({ editor, onExit, onStandard, onNotice = null, hallDeps = {} }) {
  useTr();
  const { project, commit } = editor;
  const mod = project.mod;
  const state = useArenaModHall(mod, project.server, hallDeps);
  /* Мод сняли с каталога, а своих правок в нём нет: ждать нечего и терять нечего — сразу штатная арена. */
  const gone = state.status === "failed" && state.gone && arenaModIsStock(mod);
  useEffect(() => {
    if (!gone) return;
    onNotice?.(tr("Этой арены больше нет в каталоге — открыта штатная арена"));
    onStandard();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз, когда мод оказался снят
  }, [gone]);
  const [sheet, setSheet] = useState("");
  const [asset, setAsset] = useState(null);
  const areas = useMemo(() => sheetAreas(asset), [asset]);
  const shownMod = editor.shown(project).mod || mod;
  /* Свои картинки листов — текстуры кадра (как уедут в игру: лист целиком). */
  const textures = useArenaModTextures(shownMod);
  /* `commit(обновление, подпись)`: обновление получает текущую работу — правка не затирает то, что успели поменять рядом. */
  const onChange = useCallback((next, label) => commit((current) => ({ ...current, mod: next }), label), [commit]);
  const tools = useMemo(() => TOOLS, []);
  const onTool = useCallback((id) => {
    if (id === "standard") onStandard();
  }, [onStandard]);
  const rail = useRailGroups({ groups: GROUPS, tools, tool: "sheets", onTool, renumber: true });
  const ready = state.status === "ready";
  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor arena-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская арены")}
      status={[editor.status, tr("Арена мода"), mod.name].filter(Boolean).join(" · ")}
      tools={rail.tools}
      tool={rail.tool}
      onTool={rail.onTool}
      guide={editor.guide(false, { aim: tr("взять лист под курсором") })}
      guideKey="arena-mod"
      actions={
        <EditorActions {...editor.actionProps({ compare: true })} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={ready ? <ArenaModInspector mod={mod} hall={state.hall} areas={areas} selected={sheet} onSelect={setSheet} onChange={onChange} onNotice={onNotice} /> : null}
    >
      {ready ? <ArenaModStage mod={shownMod} hall={state.hall} sheet={sheet} textures={textures} onSelect={setSheet} onAsset={setAsset} onCamera={editor.onCamera} /> : <StageNote state={state} onStandard={onStandard} />}
      {editor.works.dialogs}
    </EditorShell>
  );
}
