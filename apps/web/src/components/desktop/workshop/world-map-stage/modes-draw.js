// Рисование: мазок кисти от руки и прямой, след ластика, растяжка фигуры, вершины зоны.
// Живые мазки пишутся прямо в узлы (`env.nodes`), без перерисовки редактора на каждое движение.
import { strokeDash, strokeArrowParts, boxFromCorners } from "@modovik/vector-map";
import { catchUpFrames, strokeFitPixels, snapStraightEnd, createPointerSmoother, createLivePath } from "../world-map-brush.js";
import { DRAW_MODE_STROKES, SHAPE_MIN_SIDE, closesDraft, duplicatesLastDraftPoint, zonePress } from "../world-map-editing.js";
import { CLICK_SLOP, POINTS } from "./numbers.js";

const FRAME_STEP_MS = 16.7;
const ARROW_HEADS = { none: 0, end: 1, both: 2 };

// Все положения указателя за кадр; метод живёт на родном событии (у события React его нет)
function samplesOf(event) {
  const source = typeof event.getCoalescedEvents === "function" ? event : event.nativeEvent;
  const batch = typeof source?.getCoalescedEvents === "function" ? source.getCoalescedEvents() : [];
  return batch.length ? batch : [event];
}

const clientOf = ({ clientX, clientY }) => ({ x: clientX, y: clientY });
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// узлы живого мазка в порядке разметки (отмонтированные в списке остаются пустыми)
const liveNodes = (env) => env.nodes.current.wet.filter(Boolean);
const polyline = (points) => `M${points.map((one) => `${one.x} ${one.y}`).join("L")}`;
const takeMode = (env, mode) => {
  env.dragRef.current = mode;
};

// Вид живого мазка в единицах сцены
export function wetLook(brush, projector) {
  const thickness = projector.length(brush.size);
  const dash = strokeDash(brush.line, thickness);
  return {
    color: brush.color,
    thickness,
    dash: dash && dash.join(" "),
    opacity: brush.opacity / 100,
    blur: brush.softness > 0 ? (thickness * brush.softness) / 260 : null,
  };
}

// Сглаженная точка принимается, если ушла от прошлой принятой на шаг
const farEnough = (client, last, step, inclusive = false) =>
  inclusive ? gap(client, last) > step : !(gap(client, last) < step);

// ——— режимы ———
function strokeMove(mode, env, event) {
  for (const sample of samplesOf(event)) {
    const client = mode.smooth(clientOf(sample), sample.timeStamp);
    if (!farEnough(client, mode.last, POINTS.brushStep)) continue;
    mode.last = client;
    const world = env.worldAt(client.x, client.y);
    mode.points.push(world);
    mode.path = mode.live.add(env.projector.point(world));
  }
  liveNodes(env)[0]?.setAttribute("d", mode.path);
}

function strokeUp(mode, env, event, cancelled) {
  env.setWet(null);
  const smoothing = env.brush?.smoothing;
  if (!cancelled) {
    const end = clientOf(event);
    // тяжёлая кисть догоняет курсор: ещё несколько шагов фильтра на время отпускания
    const catchUp = smoothing > 50 ? catchUpFrames(smoothing) : 0;
    for (let frame = 1; frame <= catchUp; frame += 1) {
      const client = mode.smooth(end, event.timeStamp + frame * FRAME_STEP_MS);
      if (!farEnough(client, mode.last, POINTS.brushStep)) continue;
      mode.last = client;
      mode.points.push(env.worldAt(client.x, client.y));
    }
    if (gap(end, mode.last) > POINTS.brushStep) mode.points.push(env.worldAt(end.x, end.y));
  }
  const tolerance = strokeFitPixels(smoothing) * env.metersPerDot;
  env.onStroke?.(mode.points, { tolerance });
}

function straightEnd(mode, env, event) {
  const raw = env.worldAt(event.clientX, event.clientY);
  return event.shiftKey ? snapStraightEnd(mode.start, raw) : raw;
}

function straightMove(mode, env, event) {
  mode.end = straightEnd(mode, env, event);
  const ends = [mode.start, mode.end].map((world) => env.projector.point(world));
  const arrow = DRAW_MODE_STROKES[mode.mode].arrow;
  const parts = strokeArrowParts(ends, mode.look.thickness, arrow);
  const [line, ...heads] = liveNodes(env).reverse();
  heads.reverse().forEach((node, at) => {
    const head = parts.heads[at]?.[1];
    node.setAttribute("d", head ? `${polyline(head.points)}Z` : "");
  });
  line?.setAttribute("d", polyline(parts.line));
}

function straightUp(mode, env, event, cancelled) {
  env.setWet(null);
  const end = cancelled ? mode.end : straightEnd(mode, env, event);
  if (gap(end, mode.start) < POINTS.strokeMin * env.metersPerDot) return;
  env.onStroke?.([mode.start, end], { tolerance: 0 }, mode.mode);
}

function eraseMove(mode, env, event) {
  for (const sample of samplesOf(event)) {
    const client = clientOf(sample);
    if (!farEnough(client, mode.last, mode.step, true)) continue;
    mode.last = client;
    const world = env.worldAt(client.x, client.y);
    mode.points.push(world);
    const { x, y } = env.projector.point(world);
    mode.path += `L${x} ${y}`;
  }
  env.nodes.current.trail?.setAttribute("d", mode.path);
}

function eraseUp(mode, env, event, cancelled) {
  env.setTrail(null);
  if (!cancelled) mode.points.push(env.worldAt(event.clientX, event.clientY));
  env.onErase?.(mode.points);
}

function shapeMove(mode, env, event) {
  Object.assign(mode, {
    end: env.worldAt(event.clientX, event.clientY),
    square: event.shiftKey,
    last: clientOf(event),
  });
  env.setStretch({ start: mode.start, end: mode.end, square: mode.square });
}

function shapeUp(mode, env, event, cancelled) {
  env.setStretch(null);
  const at = cancelled ? mode.last : clientOf(event);
  if (gap(at, mode.from) <= CLICK_SLOP) {
    if (mode.under) return env.onSelect(mode.under);
    const side = Math.max(SHAPE_MIN_SIDE, Math.round(POINTS.shapeClick * env.metersPerDot));
    const corner = { x: Math.round(mode.start.x), y: Math.round(mode.start.y) };
    return env.onShape?.({ ...corner, w: side, h: side, rotation: 0 });
  }
  // Shift при отпускании берётся от самого события отпускания, а не от последнего движения
  const box = boxFromCorners(mode.start, mode.end, cancelled ? mode.square : event.shiftKey);
  const least = Math.max(SHAPE_MIN_SIDE, Math.round(POINTS.shapePull * env.metersPerDot));
  return env.onShape?.({ ...box, w: Math.max(box.w, least), h: Math.max(box.h, least) });
}

export const DRAW_MODES = {
  stroke: { move: strokeMove, up: strokeUp },
  straight: { move: straightMove, up: straightUp },
  erase: { move: eraseMove, up: eraseUp },
  shape: { move: shapeMove, up: shapeUp },
};

// ——— начало ———
export function pressEraser(env, ctx) {
  if (env.tool !== "eraser") return false;
  const first = env.projector.point(ctx.world);
  const path = `M${first.x} ${first.y}`;
  takeMode(env, {
    kind: "erase",
    points: [ctx.world],
    path,
    step: Math.max(1, env.eraserSize / 4 / env.metersPerDot),
    last: clientOf(ctx.event),
  });
  env.setTrail({ d: path, width: Math.max(env.projector.length(env.eraserSize), env.unit) });
  return true;
}

function beginFreeStroke(env, { event }, look) {
  const smooth = createPointerSmoother(env.brush.smoothing);
  const client = smooth(clientOf(event), event.timeStamp);
  const world = env.worldAt(client.x, client.y);
  const live = createLivePath();
  const path = live.add(env.projector.point(world));
  takeMode(env, { kind: "stroke", smooth, live, points: [world], last: client, path });
  env.setWet({ look, heads: 0, d: path });
}

// Запасной вид у неизвестного режима - линия (на движении запасного нет)
function beginStraight(env, ctx, look) {
  const spec = DRAW_MODE_STROKES[env.brushMode] ?? DRAW_MODE_STROKES.line;
  takeMode(env, { kind: "straight", mode: env.brushMode, start: ctx.world, end: ctx.world, look });
  env.setWet({ look, heads: ARROW_HEADS[spec.arrow] ?? 0, d: "" });
}

export function pressBrush(env, ctx) {
  if (env.tool !== "brush" || !env.brush) return false;
  const look = wetLook(env.brush, env.projector);
  (env.brushMode === "free" ? beginFreeStroke : beginStraight)(env, ctx, look);
  return true;
}

// Зоны по вершинам: замкнуть у первой, иначе новая вершина (повтор последней - отсев)
export function pressDraft(env, ctx) {
  if (env.tool !== "zones" || env.shape !== "free") return false;
  const { draft, closeTolerance, tolerance } = env;
  const closing = closesDraft(draft, ctx.world, closeTolerance);
  if (closing) {
    env.setAim(null);
    env.onDraftPoint(null);
  } else if (!duplicatesLastDraftPoint(draft, ctx.world, tolerance)) {
    env.onDraftPoint(ctx.world);
  }
  return true;
}

// Фигура «Зон»: пустое место - растяжка, готовая зона за линию - обычный выбор (см. правила)
export function pressStretch(env, ctx) {
  if (env.tool !== "zones") return false;
  const { under } = zonePress(env.config, ctx.world, env.tolerance, env.preferLayer);
  const here = clientOf(ctx.event);
  const square = ctx.event.shiftKey;
  takeMode(env, { kind: "shape", start: ctx.world, end: ctx.world, square, under, from: here, last: here });
  env.setStretch({ start: ctx.world, end: ctx.world, square });
  return true;
}
