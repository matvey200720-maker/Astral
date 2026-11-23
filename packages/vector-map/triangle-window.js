/*
 * Видимая часть геометрии из треугольников (13.10.2026, «карта лагает при
 * движении»: резкий кусок основы на приближении).
 *
 * Векторная подложка — 145 тысяч треугольников всего штата (у паков — полмиллиона).
 * Кусок на приближении ×6 видит из них один из тридцати, но `fill` и `stroke`
 * получали один путь из всех треугольников роли: Skia обрабатывала весь путь
 * на каждый кусок, GPU-поток держал занятым полсекунды, и композитор в это
 * время не выдавал кадры — карта «замирала» после каждого сдвига и зума.
 * Замер (окно ×6,7, 3200 × 2222 точек): 465 мс на кусок.
 *
 * Здесь путь собирается только из треугольников, чья рамка пересекает окно с
 * запасом на размытие, свечение и обводку (`view`). Картинка внутри окна та
 * же: пиксель определяют только треугольники, которые его покрывают, а они
 * все остаются.
 *
 * Когда видно почти всё (общий план, экспорт плитки в полный размер), общий
 * путь группы лучше: он собирается один раз и живёт дальше, а путь «из
 * видимого» собирался бы заново на каждый кусок (`FULL_SHARE`).
 */

/* Рамки треугольников группы — по четыре числа подряд, раз на группу. */
const BOXES = new WeakMap();

function boxesOf(group) {
  let boxes = BOXES.get(group);
  if (boxes) return boxes;
  const points = group.positions;
  const count = Math.floor(points.length / 6);
  boxes = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const at = index * 6;
    const x0 = points[at];
    const y0 = points[at + 1];
    const x1 = points[at + 2];
    const y1 = points[at + 3];
    const x2 = points[at + 4];
    const y2 = points[at + 5];
    const slot = index * 4;
    boxes[slot] = Math.min(x0, x1, x2);
    boxes[slot + 1] = Math.min(y0, y1, y2);
    boxes[slot + 2] = Math.max(x0, x1, x2);
    boxes[slot + 3] = Math.max(y0, y1, y2);
  }
  BOXES.set(group, boxes);
  return boxes;
}

/** Доля видимых треугольников, начиная с которой лучше общий путь группы. */
export const FULL_SHARE = 0.7;

/**
 * Окно отсечения: мировой прямоугольник кадра (`world`, у него `y0` — верх),
 * расширенный на `margin` мировых единиц.
 */
export function viewWindow(world, margin = 0) {
  return {
    x0: Math.min(world.x0, world.x1) - margin,
    x1: Math.max(world.x0, world.x1) + margin,
    y0: Math.min(world.y0, world.y1) - margin,
    y1: Math.max(world.y0, world.y1) + margin,
  };
}

const lineOf = (points, at) =>
  `M${points[at]} ${points[at + 1]}L${points[at + 2]} ${points[at + 3]}L${points[at + 4]} ${points[at + 5]}Z`;

/**
 * Путь из видимых треугольников групп — или `null`, когда видно почти всё и
 * нужен общий путь. `createPath` — своя фабрика (тесты): она собирается
 * вызовами; без неё `Path2D` окна собирается одной строкой SVG — полмиллиона
 * `moveTo`/`lineTo` в один `Path2D` Chromium собирает десятки секунд, а та же
 * фигура строкой — доли секунды (замер 13.10: 145 тысяч треугольников, 5,4 с
 * вызовами).
 *
 * @param {{positions: Float32Array}[]} groups
 * @param {{x0: number, y0: number, x1: number, y1: number}} view `viewWindow`
 * @param {(() => object) | null} createPath
 * @returns {{ path: object, kept: number, total: number } | null}
 */
export function visiblePath(groups, view, createPath = null) {
  let total = 0;
  let kept = 0;
  const masks = [];
  for (const group of groups) {
    const boxes = boxesOf(group);
    const count = boxes.length / 4;
    const mask = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const slot = index * 4;
      if (
        boxes[slot + 2] >= view.x0 &&
        boxes[slot] <= view.x1 &&
        boxes[slot + 3] >= view.y0 &&
        boxes[slot + 1] <= view.y1
      ) {
        mask[index] = 1;
        kept += 1;
      }
    }
    total += count;
    masks.push(mask);
  }
  if (!total || kept >= total * FULL_SHARE) return null;
  if (createPath) {
    const path = createPath();
    groups.forEach((group, which) => {
      const points = group.positions;
      const mask = masks[which];
      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) continue;
        const at = index * 6;
        path.moveTo(points[at], points[at + 1]);
        path.lineTo(points[at + 2], points[at + 3]);
        path.lineTo(points[at + 4], points[at + 5]);
        path.closePath();
      }
    });
    return { path, kept, total };
  }
  const parts = [];
  groups.forEach((group, which) => {
    const points = group.positions;
    const mask = masks[which];
    for (let index = 0; index < mask.length; index += 1)
      if (mask[index]) parts.push(lineOf(points, index * 6));
  });
  return { path: new Path2D(parts.join("")), kept, total };
}

/** Путь всех треугольников группы — строкой SVG, без `createPath`. */
export function fullPath(group, createPath = null) {
  const points = group.positions;
  if (createPath) {
    const path = createPath();
    for (let at = 0; at + 5 < points.length; at += 6) {
      path.moveTo(points[at], points[at + 1]);
      path.lineTo(points[at + 2], points[at + 3]);
      path.lineTo(points[at + 4], points[at + 5]);
      path.closePath();
    }
    return path;
  }
  const parts = [];
  for (let at = 0; at + 5 < points.length; at += 6)
    parts.push(lineOf(points, at));
  return new Path2D(parts.join(""));
}
