// Перевод точек экрана: клиентские координаты → кадр холста (с запасом) → мир.
import { useMemo } from "react";
import { mapToWorld } from "@modovik/vector-map";

// Доля пути по оси внутри прямоугольника холста, пересчитанная в сцену
const alongAxis = (start, offset, extent, span) => {
  const share = offset / extent;
  return start + share * span;
};

// Оси холста: [ось точки, край узла, размер узла, размер холста]
const AXES = [
  ["x", "left", "width", "width"],
  ["y", "top", "height", "height"],
];

// Собирает три функции для текущего холста
export function makeLens({ canvas, scene, atlas, svgRef }) {
  const sceneAt = (...pointer) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const [x, y] = AXES.map(([axis, edge, extent, span], at) =>
      alongAxis(canvas[axis], pointer[at] - box[edge], box[extent], canvas[span]),
    );
    return { x, y };
  };

  const toWorld = (spot) => {
    const uv = { u: spot.x / scene.width, v: spot.y / scene.height };
    return mapToWorld(uv, atlas);
  };

  const worldAt = (...pointer) => toWorld(sceneAt(...pointer));

  return { sceneAt, toWorld, worldAt };
}

// Перевод пересобирается только со сменой холста, сцены, атласа или узла
export function useLens(inputs) {
  const { canvas, scene, atlas, svgRef } = inputs;
  return useMemo(() => makeLens({ canvas, scene, atlas, svgRef }), [canvas, scene, atlas, svgRef]);
}
