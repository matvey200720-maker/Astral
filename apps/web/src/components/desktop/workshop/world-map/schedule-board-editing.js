import {
  SCHEDULE_BOARD_DEFAULT,
  SCHEDULE_BOARD_ICON_IMAGE,
  SCHEDULE_BOARD_NEW_ROW,
  createScheduleBoard,
  normalizeScheduleBoard,
  scheduleBoardLayout,
  scheduleBoardOf,
} from "@modovik/vector-map";
import { addEmblem, patchObject } from "../world-map-editing.js";
import { tr } from "../../../../locales/ui.js";

/*
 * Правка табло «Расписания» на карте (ТЗ 18.10, задача 1.2): чистые функции над
 * проектом. Табло — картинка-эмблема с полем `schedule` (`schedule-board.js`),
 * поэтому двигается, растягивается и вращается как любая эмблема; здесь —
 * включение, выключение и правка содержания.
 */

/** Эмблема-табло проекта или `null`. */
export const scheduleEmblem = (config) => scheduleBoardOf(config.emblems);

const selectionOf = (emblem) => ({ kind: "emblem", id: emblem.id });

/**
 * Включить табло: уже стоящее возвращается на карту, нового нет — оно ложится
 * в море к юго-западу от Лос-Сантоса. `selection` — табло, чтобы редактор
 * показал его панель.
 */
export function showScheduleBoard(config) {
  const present = scheduleEmblem(config);
  if (present) return { config: patchObject(config, selectionOf(present), { enabled: true }), selection: selectionOf(present) };
  const board = createScheduleBoard();
  return addEmblem(config, SCHEDULE_BOARD_DEFAULT, {
    kind: "image",
    width: SCHEDULE_BOARD_DEFAULT.width,
    schedule: board,
    aspect: scheduleBoardLayout(board).aspect,
  });
}

/** Выключить табло: правки остаются, табло с карты уходит. */
export function hideScheduleBoard(config) {
  const present = scheduleEmblem(config);
  return present ? patchObject(config, selectionOf(present), { enabled: false }) : config;
}

/**
 * Правка табло: что бы ни менялось (число строк и колонок, картинка-вставка),
 * метры на «строку» остаются теми же — рамка растёт вместе с табло, а буквы не
 * мельчают. Возвращает правку эмблемы: `{ schedule, width, aspect }`.
 */
export function patchBoard(emblem, change) {
  const before = scheduleBoardLayout(emblem.schedule);
  const board = normalizeScheduleBoard({ ...emblem.schedule, ...change });
  const after = scheduleBoardLayout(board);
  const width = Math.round(Math.min(12000, Math.max(60, (emblem.width * after.width) / before.width)));
  return { schedule: board, width, aspect: after.aspect };
}

/*
 * Строки — обычными операциями над списком: помощники «Расписания» мастерской
 * проверяют картинки строк по своим файлам и свои значки с картинок карты сняли
 * бы; проверку делает `normalizeScheduleBoard` (лимит, значки, длина слов).
 */
const withRows = (emblem, update) => patchBoard(emblem, { rows: update([...emblem.schedule.rows]) });

/* Слова новой строки — на языке окна: человек сразу видит, что переписать (текст дальше правится руками). */
const newBoardRow = () => ({ ...SCHEDULE_BOARD_NEW_ROW, text: tr(SCHEDULE_BOARD_NEW_ROW.text) });

export const addBoardRow = (emblem, row = newBoardRow()) => withRows(emblem, (rows) => [...rows, row]);
export const removeBoardRow = (emblem, index) => withRows(emblem, (rows) => rows.filter((_, at) => at !== index));
export const duplicateBoardRow = (emblem, index) =>
  withRows(emblem, (rows) => (rows[index] ? [...rows.slice(0, index + 1), { ...rows[index] }, ...rows.slice(index + 1)] : rows));
export const moveBoardRow = (emblem, index, step) =>
  withRows(emblem, (rows) => {
    const to = index + step;
    if (!rows[index] || to < 0 || to >= rows.length) return rows;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });
export const patchBoardRow = (emblem, index, values) =>
  withRows(emblem, (rows) => rows.map((row, at) => (at === index ? { ...row, ...values } : row)));

/** Значок строки — своя картинка: `{ icon: "image", image }`. */
export const imageIcon = (asset, name, aspect = 1) => ({
  icon: SCHEDULE_BOARD_ICON_IMAGE,
  image: { asset, name, width: Math.round(aspect * 100), height: 100 },
});
