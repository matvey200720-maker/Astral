// Табло «Расписания»: все обращения к соседям (геометрия табло, правка строк) в одном месте.
// Формы сверены с worldmap4-WorldMapStage-neighbors-real.md, разделы 1 и 2.
import { scheduleBoardOf } from "@modovik/vector-map";
import {
  boardFieldGeometry,
  boardFrame,
  boardItemId,
  boardPartAt,
  boardToScene,
} from "../world-map/schedule-board-hit.js";
import { patchBoard, patchBoardRow } from "../world-map/schedule-board-editing.js";

// Табло показывается и правится, только если оно есть и не выключено
export function currentBoard(config) {
  const board = scheduleBoardOf(config.emblems);
  return board && board.enabled !== false ? board : null;
}

export const framesOf = (board, projector) => boardFrame(board, projector);

// Часть табло под точкой сцены: { kind: "add" | "title" | "heading" | "icon" | "name" | "time" | "row",
// column?, row? } или null; `row` — сам элемент frame.places.rows[i] (у него `index` в списке строк)
export const partUnder = (frame, point) => boardPartAt(frame, point);

export const rowOfPart = (hit) => (Number.isInteger(hit?.row?.index) ? hit.row.index : null);

// Части, которые правятся двойным щелчком
export const EDITABLE_PARTS = new Set(["name", "time", "title", "heading"]);

// Часть табло в виде цели правки: { part, index?, column? }
export function targetOfPart(hit) {
  const target = { part: hit.kind };
  if (hit.row) target.index = hit.row.index;
  if (hit.kind === "heading") target.column = hit.column;
  return target;
}

// Текущий текст части: заголовок, заголовок колонки, название или время строки
export function partDraft(board, target) {
  const { schedule } = board;
  switch (target.part) {
    case "title":
      return String(schedule.title ?? "");
    case "heading":
      return String(schedule.headings?.[target.column] ?? "");
    case "name":
      return String(schedule.rows?.[target.index]?.text ?? "");
    default:
      return String(schedule.rows?.[target.index]?.time ?? "");
  }
}

// Правка в проект для части табло: { schedule, width, aspect }
export function partPatch(board, edit, text) {
  switch (edit.part) {
    case "title":
      return patchBoard(board, { title: text });
    case "heading": {
      const headings = [...(board.schedule.headings ?? [])];
      headings[edit.column] = text;
      return patchBoard(board, { headings });
    }
    case "name":
      return patchBoardRow(board, edit.index, { text });
    default:
      return patchBoardRow(board, edit.index, { time: text });
  }
}

// Последний сегмент ключа истории: индекс строки, колонка или 0
export const editSlot = (edit) => edit.index ?? edit.column ?? 0;

// Ключ фокуса поля: <часть>:<индекс или колонка или 0>
export const fieldFocusKey = (edit) => `${edit.part}:${editSlot(edit)}`;

// Следующее поле по порядку чтения среди показанных: заголовок, подписи колонок,
// затем название и время каждой строки; после последнего — null
export function nextPart(frame, edit) {
  const { title, headings, rows } = frame.places;
  const order = [];
  if (title) order.push({ part: "title" });
  headings.forEach((one) => order.push({ part: "heading", column: one.column }));
  rows.forEach((one) => {
    order.push({ part: "name", index: one.index });
    order.push({ part: "time", index: one.index });
  });
  const here = order.findIndex(
    (slot) => slot.part === edit.part && slot.index === edit.index && slot.column === edit.column,
  );
  return here >= 0 ? (order[here + 1] ?? null) : null;
}

// Примитивы табло, которые не рисуются, пока открыто поле правки
export function hiddenBoardIds(frame, edit) {
  const ids = [boardItemId(frame, edit)];
  if (edit.part === "name") ids.push(boardItemId(frame, edit, true));
  return ids;
}

// Положение и вид поля правки на буквах части; `items` — примитивы слоя «emblems»
export const fieldGeometry = (frame, items, edit, scale, origin) =>
  boardFieldGeometry(frame, items, edit, { scale, origin });

// Контур прямоугольника табло { x, y, w, h } (в «строках»), раздутый на `grow` строк → 4 точки сцены
export function outlineOf(frame, rect, grow = 0) {
  const left = rect.x - grow;
  const top = rect.y - grow;
  const right = rect.x + rect.w + grow;
  const bottom = rect.y + rect.h + grow;
  return [
    boardToScene(frame, left, top),
    boardToScene(frame, right, top),
    boardToScene(frame, right, bottom),
    boardToScene(frame, left, bottom),
  ];
}

// Точка табло (в «строках») → сцена
export const sceneOf = (frame, u, v) => boardToScene(frame, u, v);
