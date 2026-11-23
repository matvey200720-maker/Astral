/*
 * «Расписание» (ТЗ 10.10.2026, вечер, задача 11: «Добавить расписание в
 * отдельную вкладочку… менять картинку, текст, время у этого готового
 * расписания… цвет, прозрачность, непрозрачность»).
 *
 * Табло расписания сервера Majestic — двадцать штук по штату. Здесь —
 * своё табло на их местах: заголовок, строки (время, название, значок
 * сервера, значок Astral или своя картинка, выделение, скрытие, порядок),
 * шрифт, цвета, прозрачность частей и свечение; лист табло рисует окно
 * (`schedule-sheet.js`), в игру он едет своей моделью на каждом месте
 * табло сервера (`recolor-schedule.js` главного процесса). «Как на
 * сервере» — своего табло нет, «Применить» снимает установку.
 *
 * Полная правка (ТЗ владельца 11.10.2026, утро, задача 4: «создавать свои
 * новые тайники… назвать новый, создать и подписать время… эту таблицу
 * дополнять и расписывать… прямо можно было менять текст»): кадр по
 * умолчанию — лист табло плоско, строка и заголовок правятся прямо на нём;
 * свои строки добавляются (до 48), удаляются и меняются местами; табло
 * раскладывает их в колонки и честно говорит, какими выйдут буквы в игре.
 *
 * Щелчок по табло «На месте» (18.10.2026): строка — «Строки» с её названием,
 * значок — «Строки» на значках, заголовок — «Заголовок и шрифт»; взятое обведено
 * рамкой на плашке (`schedule-aim.js`).
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): строки,
 * заголовок и шрифт, цвета, прозрачность, шаблоны и места — инструменты
 * слева, справа — настройки взятого; вид кадра — над кадром. Общее с
 * остальными местами (работа, черновик, «Мои работы», «Применить», камера)
 * — в `useRecolorEditor`.
 */

import { useCallback, useDeferredValue, useState } from "react";
import { CircleHalf, ListBullets, Palette, Swatches, TextAa } from "../../../components/ui/icons.jsx";
import { RECOLOR_PROJECTS } from "@modovik/climb-contract/recolor/projects";
import {
  SCHEDULE_MAX_ROWS,
  SCHEDULE_NEW_ROW,
  addScheduleRow,
  applySchedulePreset,
  createScheduleProject,
  duplicateScheduleRow,
  moveScheduleRow,
  normalizeScheduleProject,
  patchScheduleRow,
  removeScheduleRow,
  scheduleIsStock,
  scheduleStockRow,
} from "@modovik/climb-contract/recolor/schedule";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { useRecolorEditor } from "../model-stage/useRecolorEditor.jsx";
import ScheduleInspector from "./ScheduleInspector.jsx";
import ScheduleStage from "./ScheduleStage.jsx";
import { StudioLiveProvider } from "../texture-studio/StudioLive.jsx";
import { scheduleImages } from "./schedule-sheet.js";
import { findPlace, layoutText, rowTitle } from "./schedule-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const STORAGE_KEY = "astral.schedule.project.v1";

/* Инструменты. Цифры — горячие клавиши: буквы в 3D-кадре заняты полётом. */
const TOOLS = Object.freeze([
  {
    id: "rows",
    label: "Строки",
    icon: <ListBullets />,
    shortcut: "1",
    group: "paint",
    hint: "Нажмите строку на табло в кадре или в списке — и пишите. «Добавить строку» — свой тайник или любое событие; места табло — под строками",
  },
  { id: "title", label: "Заголовок и шрифт", icon: <TextAa />, shortcut: "2", group: "paint", hint: "Шрифт — для всего табло: заголовка, названий и времени" },
  { id: "colours", label: "Цвета", icon: <Palette />, shortcut: "3", group: "paint", hint: "Свечение — табло светится само и читается ночью" },
  { id: "opacity", label: "Прозрачность", icon: <CircleHalf />, shortcut: "4", group: "paint", hint: "100 % — сплошной цвет, 0 % — насквозь прозрачно" },
  { id: "templates", label: "Шаблоны", icon: <Swatches />, shortcut: "5", group: "ready", hint: "Готовый вид меняет цвета, прозрачность и свечение — строки остаются вашими" },
]);

function doneText(result) {
  if (result?.status === "unchanged") return tr("Расписание в игре уже такое — ставить было нечего");
  return tr("Своё расписание установлено на всех двадцати табло. Перезапустите игру.");
}

export default function ScheduleStudio({ onExit, onNotice }) {
  useTr();
  const [remembered, setTool] = useRememberedState("schedule:tool", "rows");
  /* Прежний инструмент «Где стоят» — теперь часть «Строк» (правило 12 `design-qa.md`, 30.10.2026). */
  const tool = remembered === "places" ? "rows" : remembered;
  const [row, setRow] = useRememberedState("schedule:row", 0);
  const [placeId, setPlace] = useRememberedState("schedule:place", "p01");
  const [view, setView] = useRememberedState("schedule:view", "board");
  const [compare, setCompare] = useState(false);
  /* Правка прямо на табло (`{ kind: "row", index }` / `{ kind: "title" }`) и просьба панели о фокусе. */
  const [editing, setEditing] = useState(null);
  const [focus, setFocus] = useState(null);
  const editor = useRecolorEditor({
    set: "schedule",
    contract: RECOLOR_PROJECTS.schedule,
    storageKey: STORAGE_KEY,
    title: tr("Расписание"),
    coverSlotId: "schedule",
    onNotice,
    images: scheduleImages,
    resetLabel: tr("Как на сервере"),
    stockLabel: tr("Как на сервере"),
    stockMeansRemoval: true,
    removalTitle: tr("Убрать своё расписание из игры"),
    resetNotice: tr("Расписание как на сервере: своего табло нет"),
    savedText: tr("Ставим своё расписание в игру"),
    doneText,
    rolledBackText: tr("Своё расписание снято из игры — остальные моды на месте"),
  });
  const { project, commit, replace } = editor;
  const normal = normalizeScheduleProject(project);
  const count = normal.rows.length;

  const ask = (target, index = -1) => setFocus({ target, index, at: Date.now() });
  const onPatch = useCallback((values, label) => commit((current) => ({ ...current, ...values }), label), [commit]);
  const onRow = useCallback((index, values, label) => commit((current) => patchScheduleRow(current, index, values), label), [commit]);
  const onRowReset = useCallback(
    (index) => {
      const stock = scheduleStockRow(index);
      if (stock) commit((current) => patchScheduleRow(current, index, { ...stock, hidden: false, accent: false }), `Строка ${index + 1} как на сервере`);
    },
    [commit],
  );
  /* Своя строка: в конец, сразу взята — название выделено, пиши поверх. */
  const onAdd = (at = undefined) => {
    if (count >= SCHEDULE_MAX_ROWS) return;
    const index = at === undefined ? count : at;
    /* Слова новой строки — на языке окна. */
    commit((current) => addScheduleRow(current, { ...SCHEDULE_NEW_ROW, text: tr(SCHEDULE_NEW_ROW.text) }, at), "Новая строка");
    setRow(index);
    setTool("rows");
    if (view === "board") setEditing({ kind: "row", index });
    else ask("name", index);
  };
  const onDuplicate = (index) => {
    commit((current) => duplicateScheduleRow(current, index), `Копия строки ${index + 1}`);
    setRow(index + 1);
    ask("name", index + 1);
  };
  const onRemove = (index) => {
    const title = rowTitle(normal.rows[index] || {});
    commit((current) => removeScheduleRow(current, index), `Удалена строка: ${title}`);
    setEditing(null);
    setRow(Math.max(0, Math.min(index, count - 2)));
  };
  /* Порядок строк — чтением щита: колонка сверху вниз, потом следующая. */
  const onMove = (index, step) => {
    const target = index + step;
    if (target < 0 || target >= count) return;
    commit((current) => moveScheduleRow(current, index, step), null);
    setRow(target);
    if (editing?.kind === "row") setEditing({ kind: "row", index: target });
  };
  /* Перенос строки на табло: строка встаёт на место другой, остальные
     сдвигаются по порядку чтения щита. */
  const onReorder = (from, to) => {
    if (from === to || to < 0 || to >= count) return;
    commit((current) => {
      const step = to > from ? 1 : -1;
      let next = current;
      for (let at = from; at !== to; at += step) next = moveScheduleRow(next, at, step);
      return next;
    }, tr("Строка переставлена"));
    setEditing(null);
    setRow(to);
    setTool("rows");
  };
  /* Нажали строку на табло — она взята (в панели — она же); заголовок — `-1`. */
  const onPick = (index) => {
    setEditing(null);
    if (index < 0) setTool("title");
    else {
      setRow(index);
      setTool("rows");
    }
  };
  const onRowsReset = () => {
    const stock = createScheduleProject();
    commit((current) => ({ ...current, rows: stock.rows, columns: stock.columns }), "Строки как на сервере");
    setEditing(null);
    setRow(0);
  };
  const onColumns = (columns) => commit((current) => ({ ...current, columns }), columns === "auto" ? tr("Колонки: авто") : `Колонки: ${columns}`);
  const onColour = useCallback((key, colour) => commit((current) => ({ ...current, colours: { ...current.colours, [key]: colour } }), `Цвет: ${key}`), [commit]);
  const onOpacity = useCallback((key, value) => commit((current) => ({ ...current, opacity: { ...current.opacity, [key]: value } }), `Прозрачность: ${key}`), [commit]);
  const onPreset = useCallback((preset) => replace((current) => applySchedulePreset(current, preset.id), `Готовый вид: ${preset.label}`), [replace]);
  /* Правка на табло: строка берётся и в панели, заголовок — в «Заголовке и шрифте». */
  const onEdit = (next) => {
    setEditing(next);
    if (next?.kind === "row") {
      setRow(next.index);
      setTool("rows");
    } else if (next?.kind === "title") setTool("title");
  };
  const onIcon = (index) => {
    setRow(index);
    setTool("rows");
    ask("icon", index);
  };
  const onPlaceChoice = (id) => {
    setPlace(id);
    setView("place");
  };
  /* Щелчок по плашке в кадре «На месте»: то же, что нажать строку, значок или заголовок на плоском табло. */
  const onPlaceAim = (target) => {
    if (target.tool === "rows") {
      setRow(target.index);
      setTool("rows");
      ask(target.focus, target.index);
    } else {
      setTool("title");
      ask("title");
    }
  };
  const onViewChoice = (next) => {
    setEditing(null);
    setView(next);
  };

  /* Кадр догоняет правку в свободное время; плитки — когда рука остановилась. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const stock = scheduleIsStock(normal);
  /* Свечения в строке нет: ползунка у табло больше нет (владелец 30.10.2026), а значение шаблона снимает строка в «Цветах». */
  const status = stock ? `${editor.status} · своего табло нет` : `${editor.status} · ${layoutText(normal)}`;
  const selected = count ? Math.min(count - 1, Math.max(0, row)) : -1;
  /* Кадр расписания для «Студии»: табло на месте с работой, где у строки стоит значок из студии. */
  const renderLive = useCallback((live) => <ScheduleStage project={live} live={live} view="place" placeId={placeId} />, [placeId]);

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor recolor-editor schedule-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская расписания")}
      status={status}
      tools={TOOLS}
      tool={tool}
      onTool={setTool}
      guide={view === "place" ? editor.guide(false, { aim: tr("править строку или заголовок табло под курсором") }) : editor.guide()}
      guideKey="schedule"
      actions={
        <EditorActions {...editor.actionProps()} apply={editor.apply}>
          {editor.gameButtons}
        </EditorActions>
      }
      inspector={
        <StudioLiveProvider project={normal} render={renderLive}>
          <ScheduleInspector
            tool={tool}
            project={normal}
            presetProject={settled}
            row={selected}
            focus={focus}
            onRowSelect={(index) => {
              setRow(index);
              if (editing?.kind === "row") setEditing({ kind: "row", index });
            }}
            onRow={onRow}
            onAdd={onAdd}
            onRemove={onRemove}
            onDuplicate={onDuplicate}
            onMove={onMove}
            onRowReset={onRowReset}
            onRowsReset={onRowsReset}
            onColumns={onColumns}
            onPatch={onPatch}
            onColour={onColour}
            onOpacity={onOpacity}
            onPreset={onPreset}
            onReset={editor.resetToMod}
            isStock={stock}
            placeId={findPlace(placeId).id}
            onPlace={onPlaceChoice}
            onNotice={onNotice}
          />
        </StudioLiveProvider>
      }
    >
      <ScheduleStage
        project={deferred}
        live={normal}
        view={view === "place" ? "place" : "board"}
        onView={onViewChoice}
        placeId={placeId}
        onPlace={setPlace}
        compare={compare && !stock}
        onCompare={setCompare}
        onCamera={editor.onCamera}
        selected={tool === "rows" ? selected : -1}
        tool={tool}
        onAim={onPlaceAim}
        editing={editing}
        onEdit={onEdit}
        onPick={onPick}
        onReorder={onReorder}
        onRow={onRow}
        onTitle={(title) => onPatch({ title }, "Заголовок")}
        onIcon={onIcon}
        onAdd={() => onAdd()}
      />
      {editor.works.dialogs}
    </EditorShell>
  );
}
