/*
 * Знак на килле поверх кадра предпросмотра.
 *
 * Кадр предпросмотра — экран игры: сцена прицела 1280×720 растянута на
 * холст, и знак стоит там же, где встанет в игре, — в точке прицела со
 * своим сдвигом. Положение, поворот, масштаб и кадр гифки — из той же
 * модели, что раскладывается кадрами в hud_reticle.gfx
 * (`killMarkerPose`, `killMarkerFrameIndex`): в игре знак идёт на 30 кадрах
 * в секунду, здесь — плавно, но по тем же кривым.
 *
 * Точка прицела рисуется всегда, пока знак включён: сдвиг «выше прицела»
 * без самого прицела на экране ничего не говорит.
 */

import {
  KILL_MARKER_STAGE,
  killMarkerFrameIndex,
  killMarkerPose,
} from "@modovik/kill-effects";

/* Штатный крестик игры: 15 кадров на 30 к/с. */
const CROSS_MS = 500;

/** Точки сцены прицела → пиксели холста. Сцена вписана, как в игре. */
export function killMarkerScale(width, height) {
  return Math.min(width / KILL_MARKER_STAGE.width, height / KILL_MARKER_STAGE.height);
}

function drawReticleDot(context, x, y, scale) {
  const radius = Math.max(1.5, 2.2 * scale);
  context.save();
  context.beginPath();
  context.arc(x, y, radius + 1, 0, Math.PI * 2);
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.fill();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fill();
  context.restore();
}

/* Крестик игры: четыре косые чёрточки (`RETICLE_STOCK.hitX`: от 3.5 до 6.1
   точки от центра, толщина 1.6). */
function drawStockCross(context, x, y, scale) {
  const from = 3.46 * scale;
  const to = 6.13 * scale;
  context.save();
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1, 1.63 * scale);
  context.lineCap = "round";
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    context.beginPath();
    context.moveTo(x + dx * from, y + dy * from);
    context.lineTo(x + dx * to, y + dy * to);
    context.stroke();
  }
  context.restore();
}

/**
 * Состояние знака в момент `elapsed` — для ключа «тот же кадр второй раз не
 * рисуется»: сцена сравнивает строку, а не перерисовывает стену впустую.
 */
export function killMarkerPaintKey(marker, sequence, elapsed) {
  if (!marker?.enabled) return "";
  const pose = killMarkerPose(marker, elapsed);
  const index = sequence
    ? killMarkerFrameIndex(marker, sequence.delays, elapsed)
    : -1;
  const cross = marker.keepCross && elapsed >= 0 && elapsed < CROSS_MS;
  return `${sequence?.key || "-"}:${index}:${cross ? 1 : 0}:${
    pose.visible
      ? [pose.x, pose.y, pose.scaleX, pose.scaleY, pose.rotation, pose.alpha]
          .map((value) => value.toFixed(3))
          .join(",")
      : "hidden"
  }`;
}

export function paintKillMarker({
  context,
  width,
  height,
  marker,
  sequence,
  elapsed = 0,
}) {
  if (!marker?.enabled) return;
  const scale = killMarkerScale(width, height);
  const x = width / 2;
  const y = height / 2;
  drawReticleDot(context, x, y, scale);
  if (marker.keepCross && elapsed >= 0 && elapsed < CROSS_MS)
    drawStockCross(context, x, y, scale);
  const pose = killMarkerPose(marker, elapsed);
  if (!pose.visible || !sequence?.canvases?.length) return;
  const image =
    sequence.canvases[killMarkerFrameIndex(marker, sequence.delays, elapsed)] ||
    sequence.canvases[0];
  const size = marker.size * scale;
  context.save();
  context.globalAlpha = pose.alpha;
  context.translate(x + pose.x * scale, y + pose.y * scale);
  context.rotate((pose.rotation * Math.PI) / 180);
  context.scale(pose.scaleX, pose.scaleY);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, -size / 2, -size / 2, size, size);
  context.restore();
}
