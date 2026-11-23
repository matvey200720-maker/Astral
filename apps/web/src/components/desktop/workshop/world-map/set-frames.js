import { MAP_TEMPLATE_CARD_RECT } from "@modovik/vector-map";

const rect = (u, v, width, height) => Object.freeze({ u, v, width, height });
const frameOf = (x, y, width, height) => ({ x, y, width, height });

export const STATE_RECT = rect(0.03, 0.06, 0.94, 0.6);

// Окно с центром в точке: сначала не за правый край сцены, потом не левее нуля.
const seat = (centre, span, limit) => Math.max(0, Math.min(limit - span, centre - span / 2));

const isMeshLayer = (layer) => layer.id === "label-mesh";

// Точка набора. У путей без своего x берётся середина рамки, вес — длина пути.
function dotOf(item) {
  const box = item.bounds;
  if (box && !Number.isFinite(item.x)) {
    const weight = (item.d && item.d.length) || 1;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, weight, size: 0 };
  }
  return { x: item.x, y: item.y, weight: item.density || 1, size: item.size };
}

const isPlaced = (dot) => [dot.x, dot.y].every(Number.isFinite);

const dotsOf = (layer) => (layer.items || []).map(dotOf).filter(isPlaced);

// Кегль окна: середина ненулевых кеглей по возрастанию; без них null.
function medianSize(dots) {
  const sorted = dots
    .map((dot) => Number(dot.size))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

// Номер точки, вокруг которой в окне больше всего веса; при равенстве первая.
function densestAt(xs, ys, weights, reachX, reachY) {
  const count = xs.length;
  const totals = Float64Array.from(xs, (cx, i) => {
    const cy = ys[i];
    let sum = 0;
    for (let j = 0; j < count; j++) {
      const dx = xs[j] - cx;
      const dy = ys[j] - cy;
      if (dx < reachX && dx > -reachX && dy < reachY && dy > -reachY) sum += weights[j];
    }
    return sum;
  });
  return totals.reduce((best, total, at) => (total > totals[best] ? at : best), 0);
}

export const denseFrame = (layers, scene) => {
  const meshed = layers.some(isMeshLayer);
  const dots = layers.flatMap(dotsOf);
  if (dots.length === 0) return null;

  const cap = medianSize(dots);
  const width = meshed && cap === null ? 110 : Math.min(600, Math.max(64, (cap ?? 4) * 18));
  const height = width / 1.6;

  const xs = Float64Array.from(dots, (dot) => dot.x);
  const ys = Float64Array.from(dots, (dot) => dot.y);
  const weights = Float64Array.from(dots, (dot) => dot.weight);
  const at = densestAt(xs, ys, weights, width / 2, height / 2);

  const x = seat(xs[at], width, scene.width);
  return frameOf(x, seat(ys[at], height, scene.height), width, height);
};

// Охватывающая рамка: бегущие границы, NaN в любой из них заражает все.
class Hull {
  left = Infinity;
  right = -Infinity;
  top = Infinity;
  bottom = -Infinity;

  add(x0, x1, y0, y1) {
    this.left = Math.min(this.left, x0, x1);
    this.right = Math.max(this.right, x0, x1);
    this.top = Math.min(this.top, y0, y1);
    this.bottom = Math.max(this.bottom, y0, y1);
  }

  get finite() {
    return [this.left, this.right, this.top, this.bottom].every(Number.isFinite);
  }
}

// Углы рамки или сама точка для каждого элемента слоёв.
function* corners(layers) {
  for (const layer of layers) {
    for (const item of layer.items || []) {
      const box = item.bounds;
      if (box) yield [box.x, box.x + box.width, box.y, box.y + box.height];
      else if ([item.x, item.y].every(Number.isFinite)) yield [item.x, item.x, item.y, item.y];
    }
  }
}

export const fitFrame = (layers, scene, least = 70) => {
  const hull = new Hull();
  for (const edge of corners(layers)) hull.add(...edge);
  if (!hull.finite) return null;

  const spanX = hull.right - hull.left;
  const spanY = hull.bottom - hull.top;
  const room = (span) => span + 2 * (0.12 * Math.max(spanX, spanY) + 6);
  const width = Math.max(1.6 * least, room(spanX));
  const height = Math.max(least, room(spanY), width / 2.2);

  return frameOf(
    seat((hull.left + hull.right) / 2, width, scene.width),
    seat((hull.top + hull.bottom) / 2, height, scene.height),
    width,
    height,
  );
};

export const VIEWS = Object.freeze({ city: MAP_TEMPLATE_CARD_RECT, state: STATE_RECT });
