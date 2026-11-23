// Правила левого нажатия по карте, по порядку: первое взявшееся (вернувшее true) останавливает
// остальные. Контекст нажатия: { event, point (сцена), world, shift, alt }.
import { hitByTool } from "./select-rules.js";
import { startMarquee, startPan } from "./modes-view.js";
import { pressObject, pressFrameHandle, pressZoneVertex } from "./modes-edit.js";
import { pressStretch, pressDraft, pressBrush, pressEraser } from "./modes-draw.js";
import { framesOf, currentBoard, rowOfPart, partUnder } from "./board-bridge.js";

// Правило, которое работает только у перечисленных инструментов
const forTools = (tools, act) => (env, ctx) => tools.includes(env.tool) && act(env, ctx);

// Часть табло под точкой нажатия: только у «Расписания» и только если табло есть
function boardPartAt(env, ctx) {
  if (env.tool !== "schedule") return null;
  const board = currentBoard(env.config);
  return board ? partUnder(framesOf(board, env.projector), ctx.point) : null;
}

const addBoardRow = (env) => {
  env.onBoardAdd();
  return true;
};

// «Расписание»: строка, значок, «добавить»; дальше нажатие идёт как у любой картинки
function pressBoard(env, ctx) {
  const part = boardPartAt(env, ctx);
  if (!part) return false;
  if (part.kind === "add" && env.onBoardAdd) return addBoardRow(env);
  const row = rowOfPart(part);
  const reactions = [];
  if (row !== null) reactions.push("onBoardRow");
  if (part.kind === "icon") reactions.push("onBoardIcon");
  reactions.forEach((name) => env[name]?.(row));
  return false;
}

// метка ставится где угодно, в том числе поверх объектов
const pressMarker = forTools(["markers"], (env, ctx) => {
  env.onPlace("markers", ctx.world);
  return true;
});

// Shift у «Выбора» начинает рамку выделения, даже на зоне
const pressMarquee = forTools(["select"], (env, ctx) => {
  if (!ctx.shift || !env.onSelectMany) return false;
  startMarquee(env, ctx.event, ctx.world, hitByTool(env, ctx.world, ctx.point));
  return true;
});

function pressHit(env, ctx) {
  const hit = hitByTool(env, ctx.world, ctx.point);
  if (!hit) return false;
  pressObject(env, hit, ctx.world);
  return true;
}

// пустое место у «Текста» и «Картинок» ставит новую надпись
const pressPlace = forTools(["text", "images"], (env, ctx) => {
  env.onPlace(env.tool, ctx.world);
  return true;
});

// остальное: снять выбор и двигать карту (у «Подписей» и «Majestic» - ещё и выбор метки)
function pressEmpty(env, ctx) {
  env.onSelect(null);
  startPan(env, ctx.event, null);
  return true;
}

// Порядок важен: первое правило, вернувшее true, забирает нажатие
const PRESS_CHAIN = [
  pressBoard,
  pressEraser,
  pressBrush,
  pressDraft,
  pressMarker,
  pressZoneVertex,
  pressFrameHandle,
  pressMarquee,
  pressHit,
  pressStretch,
  pressPlace,
  pressEmpty,
];

export function pressOnMap(env, ctx) {
  for (const rule of PRESS_CHAIN) {
    if (rule(env, ctx)) return true;
  }
  return false;
}
