/*
 * Кадр «Расписания» (задача 11 ТЗ 10.10.2026, вечер; правка прямо по
 * табло — задача 4 ТЗ 11.10.2026, утро).
 *
 * Два вида кадра. «Табло» — лист табло плоско во весь кадр
 * (`ScheduleBoard.jsx`): нажал строку или заголовок — пишешь прямо там,
 * «+» на пустом месте — своя строка. «На месте» — плашка табло в размер
 * щита выбранного места с тем же листом, площадка и человек в 1,8 м — для
 * масштаба — и стена из игры (серый бетон) за ней, как табло висит в игре (задача 14 ТЗ 18.10.2026); над кадром — у какого из двадцати табло сервера стоять.
 * «Сравнить» — облик сервера вместо своего. Пока работа «как на сервере»,
 * на листе — облик сервера: его табло, отрисованное по сеткам его файла.
 *
 * Камера «На месте» — общая на мастерскую (`stage-camera.js`): ЛКМ —
 * вращение, щелчок ПКМ — полёт, колесо — приближение. Сам кадр не вертится:
 * у табло есть только лицо, как и в игре.
 *
 * Щелчок по плашке табло «На месте» выбирает то, что под курсором (18.10.2026,
 * `schedule-aim.js`): строку, её значок или заголовок — открывает «Строки» или
 * «Заголовок и шрифт» и обводит взятое рамкой. Фон щита и зазоры не выбираются.
 */

import { useCallback, useMemo, useRef } from "react";
import { Plus } from "../../../components/ui/icons.jsx";
import { SCHEDULE_INVENTORY, SCHEDULE_MAX_ROWS, normalizeScheduleProject, scheduleIsStock } from "@modovik/climb-contract/recolor/schedule";
import Button from "../../../components/ui/Button.jsx";
import Select from "../../../components/ui/Select.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import ScheduleBoard from "./ScheduleBoard.jsx";
import { scheduleAimTarget } from "./schedule-aim.js";
import { scheduleFrame, useScheduleObjects, useScheduleSelection } from "./schedule-art.js";
import { useScheduleVisitor } from "./schedule-ped.js";
import { findPlace, inGameText, metresText, placeOptions, placeWidth, rowTitle } from "./schedule-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";

/* Облик сцены: стена несёт лист бетона из игры игрока (его читает кадр по таблице листов сцены), пока листа нет — средний цвет; площадка — тёмная. */
const WALL_LOOK = Object.freeze({ colour: "#8b8c88", roughness: 0.95, metalness: 0 });
const GROUND_LOOK = Object.freeze({ colour: "#2a2c30" });
const sceneLook = (index, info) => (info?.group === "wall" ? WALL_LOOK : GROUND_LOOK);
const MAJESTIC =
  "На Majestic табло сервера остаётся на месте (его пак главнее файлов игры): своё встаёт в 3–4 см перед ним и закрывает его там, где лист непрозрачный. В одиночной игре табло сервера нет — там только своё.";

/*
 * Вид «На месте»: плашка табло в размер места, площадка и человек из игры (`schedule-ped.js`). `onAim(target)` —
 * щелчок по строке, значку или заголовку (`scheduleAimTarget`); `tool` и `selected` —
 * взятое в редакторе: строка из «Строк» или заголовок обводятся штрихами, как всё выбранное.
 */
function PlaceView({ project, place, compare, onCamera, stageRef, onAim = null, tool = "", selected = -1 }) {
  useTr();
  const normal = normalizeScheduleProject(project);
  const stock = scheduleIsStock(normal);
  const board = useScheduleObjects({ project: normal, place, compare });
  const outline = useScheduleSelection({ project: normal, place, tool, index: selected });
  /* Человек из игры рядом с табло — для масштаба; нет игры — кадр без него. */
  const visitor = useScheduleVisitor(placeWidth(place));
  const objects = useMemo(() => [...board, ...(visitor ? [visitor] : [])], [board, visitor]);
  const frame = useCallback(() => scheduleFrame(place), [place]);
  const showingServer = stock || compare;
  /* Что под курсором: «Сравнить» показывает табло сервера, его места — не строки работы, там править нечего. */
  const aimable = Boolean(onAim) && !compare;
  /* Подпись у курсора: заголовок табло или строка — её название и время. */
  const aimTarget = useCallback(
    (hit) => {
      const target = aimable ? scheduleAimTarget(normal, hit) : null;
      if (!target) return null;
      const row = target.kind === "title" ? null : normal.rows[target.index];
      return labelled({ none: true }, target.kind === "title" ? tr("Заголовок табло") : (row && rowTitle(row)) || tr("Строка {0}").replace("{0}", String(target.index + 1)));
    },
    [aimable, normal],
  );
  const onHit = useCallback(
    (hit) => {
      const target = aimable ? scheduleAimTarget(normal, hit) : null;
      if (target) onAim(target);
    },
    [aimable, normal, onAim],
  );
  return (
    <ModelStage loadKit="props"
      ref={stageRef}
      scene={SCHEDULE_INVENTORY.scene.url}
      look={sceneLook}
      frame={frame}
      frameKey={place.id}
      onCamera={onCamera}
      objects={objects}
      onAim={onAim ? onHit : null}
      aimTarget={aimTarget}
      highlight={outline}
      autoRotate={false}
      label={`Табло расписания: ${place.district}, ${metresText(placeWidth(place))} в ширину — ${showingServer ? tr("облик сервера") : tr("своё")}. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`}
    />
  );
}

export default function ScheduleStage({
  project,
  live = project,
  view = "board",
  onView,
  placeId,
  onPlace,
  compare = false,
  onCompare,
  onCamera = null,
  selected = -1,
  tool = "",
  onAim = null,
  editing = null,
  onEdit,
  onPick,
  onReorder,
  onRow,
  onTitle,
  onIcon,
  onAdd,
}) {
  useTr();
  const stageRef = useRef(null);
  const normal = normalizeScheduleProject(project);
  const stock = scheduleIsStock(normal);
  const place = findPlace(placeId);
  const board = view === "board";
  const full = normalizeScheduleProject(live).rows.length >= SCHEDULE_MAX_ROWS;
  return (
    <div className="fx-stage recolor-stage is-studio">
      {board ? (
        <ScheduleBoard
          project={live}
          picture={project}
          showServer={stock || compare}
          selected={selected}
          editing={editing}
          onEdit={onEdit}
          onPick={onPick}
          onReorder={onReorder}
          onRow={onRow}
          onTitle={onTitle}
          onIcon={onIcon}
          onAdd={onAdd}
        />
      ) : (
        <PlaceView project={project} place={place} compare={compare && !stock} onCamera={onCamera} stageRef={stageRef} onAim={onAim} tool={tool} selected={selected} />
      )}
      {/* Тихая строка — к «?» у имени панели, не поверх табло (п. 6 и 14 `design-qa.md`, четвёртый круг критика 31.10.2026). */}
      <StageNote>
        {stock && !editing ? (board ? tr("Как на сервере — дважды нажмите строку и пишите: любая правка нарисует своё") : tr("Как на сервере — своего табло нет; любая правка нарисует своё")) : ""}
      </StageNote>
      <StageBar>
        {/* Вид кадра — переключателем: по умолчанию лист табло, нажатый — табло на месте. */}
        <Button
          size="sm"
          variant={!board ? "secondary" : "ghost"}
          aria-pressed={!board}
          title={board ? tr("Табло на месте: в размер щита на карте, рядом человек 1,8 м") : tr("Назад к листу табло — правка прямо по нему")}
          onClick={() => onView(board ? "place" : "board")}
        >
          {tr("На месте")}
        </Button>
        {!board && <Select className="recolor-stage-select" ariaLabel={tr("У какого табло стоять")} value={place.id} options={placeOptions()} onChange={onPlace} />}
        {board && (
          <Button size="sm" variant="ghost" icon={<Plus />} disabled={full} title={full ? tr("Табло больше не вместит") : tr("Своя строка в конец табло")} onClick={() => onAdd()}>
            {tr("Строка")}
          </Button>
        )}
        {!stock && (
          <Button size="sm" variant={compare ? "secondary" : "ghost"} aria-pressed={compare} title={tr("Облик табло сервера вместо своего")} onClick={() => onCompare(!compare)}>
            {tr("Сравнить")}
          </Button>
        )}
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      {board ? (
        <StageNote>
          {compare && !stock ? tr("Сейчас — облик сервера для сравнения. ") : ""}
          {tr(MAJESTIC)} {inGameText(normal)}
        </StageNote>
      ) : (
        <StageNote>
          {compare && !stock ? tr("Сейчас — облик сервера для сравнения. ") : ""}
          {tr(MAJESTIC)} {inGameText(normal)}
        </StageNote>
      )}
    </div>
  );
}
