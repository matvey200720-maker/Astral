import { radarRectView } from "./radar-rect.js";
import { createRadarRenderer } from "./radar-renderer.js";

const hasGroups = (mesh) => Boolean(mesh?.groups?.length);
const isPositive = (size) => size > 0;
const transparentBackground = () => [0, 0, 0, 0];

// Рисовальщик отдаётся вызывающему вместе с холстом; освобождает его только он сам.
function handOver(renderer, canvas) {
  return { canvas, dispose: () => renderer.dispose() };
}

export function drawRadarRect({ mesh, rect, width, height, makeCanvas }) {
  const drawable = hasGroups(mesh) && [width, height].every(isPositive);
  if (!drawable) return null;

  const canvas = makeCanvas(...[width, height].map((size) => Math.round(size)));
  const renderer = createRadarRenderer(canvas);
  if (!renderer) return null;

  renderer.setMesh(mesh);
  const painted = renderer.draw(radarRectView(rect), transparentBackground());
  if (painted) return handOver(renderer, canvas);

  renderer.dispose();
  return null;
}
