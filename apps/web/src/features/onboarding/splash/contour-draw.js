/*
 * Заставка «Контур»: кадр (`framePlan` из `contour-model.js`) → холст 2D. Рисует в единицах знака (рамка 288 × 263), как макет
 * рисовал в SVG; пиксели окна — только облако света и малый знак при уходе на вход.
 */

import { STAR_BOX, STAR_D, STAR_SW, slice, starPaths } from "./star-shape.js";

const TAU = Math.PI * 2;
const WHITE = (a) => `rgba(255,255,255,${a})`;

let shapes = null;
function shapesOf() {
  if (!shapes)
    shapes = { body: new Path2D(STAR_D), swoosh: new Path2D(STAR_SW) };
  return shapes;
}

function polyline(ctx, points) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    if (i === 0) ctx.moveTo(points[0], points[1]);
    else ctx.lineTo(points[i], points[i + 1]);
  }
}

function radial(ctx, x, y, r, stops) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

const GLOW = [
  [22, 0.035],
  [15, 0.06],
  [10, 0.1],
  [6.5, 0.14],
];
const HEAD_GLOW = [
  [0, WHITE(0.9)],
  [1, WHITE(0)],
];

function strokeTrace(ctx, plan, paths) {
  if (plan.length < 0.5) return;
  polyline(ctx, slice(paths.body, 0, plan.length));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // свечение вокруг света: полосы убывающей ширины вместо размытия (в макете — размытая полоса шириной 7)
  for (const [width, alpha] of GLOW) {
    ctx.lineWidth = width;
    ctx.strokeStyle = WHITE(alpha * plan.dim);
    ctx.stroke();
  }
  ctx.lineWidth = 2.3;
  ctx.strokeStyle = WHITE(plan.dim);
  ctx.stroke();
  if (plan.drawing && plan.tail > 0.5) {
    polyline(ctx, slice(paths.body, plan.length - plan.tail, plan.length));
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

function drawNodes(ctx, plan) {
  for (const node of plan.nodes) {
    const { x, y, f } = node;
    const alpha = node.alpha * plan.starAlpha;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, 2.6 + 1.4 * f, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha * f;
    const glow = 1 + 2.2 * f;
    ctx.fillStyle = radial(ctx, 0, 0, 12 * glow, HEAD_GLOW);
    ctx.beginPath();
    ctx.arc(0, 0, 12 * glow, 0, TAU);
    ctx.fill();
    const cross = 16 * (0.7 + 1.3 * f);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-cross, 0);
    ctx.lineTo(cross, 0);
    ctx.moveTo(0, -cross);
    ctx.lineTo(0, cross);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHead(ctx, head) {
  ctx.save();
  ctx.globalAlpha = head.glowAlpha;
  ctx.fillStyle = radial(ctx, head.x, head.y, head.glow, HEAD_GLOW);
  ctx.beginPath();
  ctx.arc(head.x, head.y, head.glow, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = head.alpha;
  ctx.beginPath();
  ctx.arc(head.x, head.y, head.r, 0, TAU);
  if (head.ringed) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  } else {
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
  ctx.restore();
}

function drawFlood(ctx, plan) {
  const { body, swoosh } = shapesOf();
  const fill = radial(ctx, STAR_BOX.cx, STAR_BOX.cy, plan.flood, [
    [0, "#fff"],
    [0.6, "#f2f2f4"],
    [1, "#bdbdc4"],
  ]);
  for (const shape of [body, swoosh]) {
    ctx.save();
    ctx.clip(shape);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(STAR_BOX.cx, STAR_BOX.cy, plan.flood, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/** Слои знака в его единицах: ореол, пунктир-подсказка, заливка, свет, росчерк, узлы, голова, кольцо. */
function drawStar(ctx, plan, paths) {
  const { body, swoosh } = shapesOf();
  const alpha = plan.starAlpha;
  const { cx, cy } = STAR_BOX;
  if (plan.haloAlpha > 0.004) {
    ctx.globalAlpha = Math.min(1, plan.haloAlpha) * alpha;
    ctx.fillStyle = radial(ctx, cx, cy, 300, [
      [0, WHITE(0.5)],
      [0.45, WHITE(0.12)],
      [1, WHITE(0)],
    ]);
    ctx.beginPath();
    ctx.arc(cx, cy, 300, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([2, 5]);
  ctx.fillStyle = WHITE(0.035);
  ctx.strokeStyle = WHITE(0.2);
  for (const shape of [body, swoosh]) {
    ctx.fill(shape);
    ctx.stroke(shape);
  }
  ctx.setLineDash([]);
  if (plan.flood > 0.5) drawFlood(ctx, plan);
  strokeTrace(ctx, plan, paths);
  if (plan.sweep.on && plan.sweep.share > 0) {
    polyline(
      ctx,
      slice(paths.swoosh, 0, paths.swoosh.total * plan.sweep.share),
    );
    ctx.lineWidth = 2.3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
  drawNodes(ctx, plan);
  if (plan.head) drawHead(ctx, plan.head);
  if (plan.ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, plan.ring.r, 0, TAU);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = WHITE(plan.ring.alpha);
    ctx.stroke();
  }
}

/** Облако света при уходе на вход: круг от центра знака, пиксели окна. */
function drawBloom(ctx, plan, geometry) {
  const r = geometry.size * 1.3 * plan.bloom.scale;
  ctx.save();
  ctx.globalAlpha = Math.max(0, plan.bloom.alpha);
  ctx.fillStyle = radial(ctx, geometry.cx, geometry.cy, r, [
    [0, WHITE(0.42)],
    [0.52, WHITE(0.11)],
    [1, WHITE(0)],
  ]);
  ctx.beginPath();
  ctx.arc(geometry.cx, geometry.cy, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Малый знак на месте знака в заголовке: проступает, пока большой тает. */
function drawSmall(ctx, small) {
  const { body, swoosh } = shapesOf();
  const scale = (small.w / STAR_BOX.w) * small.scale;
  ctx.save();
  ctx.globalAlpha = Math.max(0, small.alpha);
  ctx.translate(small.x, small.y);
  ctx.scale(scale, scale);
  ctx.translate(-STAR_BOX.cx, -STAR_BOX.cy);
  ctx.fillStyle = "#f4f4f5";
  ctx.fill(body);
  ctx.fill(swoosh);
  ctx.restore();
}

/** Знак, уехавший на место в заголовке, в его последнем виде: им держится кадр, пока настоящий знак не вернётся. */
function drawLanded(ctx, plan, geometry) {
  const { cx, cy } = geometry;
  const fly = plan.fly;
  const scale = geometry.scale * fly.s;
  ctx.save();
  ctx.translate(cx + fly.x, cy + fly.y);
  ctx.scale(scale, scale);
  ctx.translate(-STAR_BOX.cx, -STAR_BOX.cy);
  drawStar(ctx, plan, starPaths());
  ctx.restore();
}

/** Один кадр на холст `ctx` (в пикселях окна). */
export function drawFrame(ctx, plan, geometry) {
  ctx.clearRect(0, 0, geometry.width, geometry.height);
  if (plan.bloom) drawBloom(ctx, plan, geometry);
  if (plan.fly) {
    drawLanded(ctx, plan, geometry);
  } else if (plan.starAlpha > 0.003) {
    const scale = geometry.scale * plan.scale;
    ctx.save();
    ctx.translate(geometry.cx, geometry.cy);
    ctx.scale(scale, scale);
    ctx.translate(-STAR_BOX.cx, -STAR_BOX.cy);
    drawStar(ctx, plan, starPaths());
    ctx.restore();
  }
  if (plan.small) drawSmall(ctx, plan.small);
}
