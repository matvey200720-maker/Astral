/*
 * Развёртка модели как картинка: какой тексель какой поверхности
 * принадлежит.
 *
 * У ангара одна и та же текстура одевает стену снаружи и изнутри: остров
 * внешней стороны и остров внутренней лежат в одном листе. Чтобы красить
 * их разными цветами, установщик рисует треугольники модели прямо в
 * развёртке — метка треугольника («снаружи», «внутри») ложится в тексели,
 * которые он покрывает. Тексели между островами (поля развёртки) получают
 * метку ближайшего острова: иначе на стыке мип-уровни смешали бы цвета.
 *
 * Здесь же — поиск места под эмблему: самый большой прямоугольник листа,
 * целиком лежащий на одной поверхности (своей метке) и не задевающий чужих
 * островов.
 */

/**
 * Метки текселей: `Uint8Array(width × height)`, 0 — не покрыт. `triangles`
 * — `[{ uv: [[u, v] ×3], label }]` (развёртка DirectX: v вниз, повтор
 * листа сворачивается в [0, 1)).
 */
export function rasterizeUvLabels(triangles, width, height) {
  const labels = new Uint8Array(width * height);
  for (const triangle of triangles) {
    const points = triangle.uv.map(([u, v]) => [u * width, v * height]);
    /* Повтор листа: треугольник целиком сдвигается в первую клетку. */
    const shiftU = Math.floor(Math.min(...points.map((p) => p[0])) / width) * width;
    const shiftV = Math.floor(Math.min(...points.map((p) => p[1])) / height) * height;
    const [a, b, c] = points.map(([x, y]) => [x - shiftU, y - shiftV]);
    fillTriangle(labels, width, height, a, b, c, triangle.label);
  }
  return labels;
}

/* Тексель покрыт, если его центр внутри треугольника (правило верхнего
   левого края не нужно: метки одинаковы по обе стороны общего ребра). */
function fillTriangle(labels, width, height, a, b, c, label) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) labels[y * width + x] = label;
    }
  }
}

/**
 * Поля развёртки — меткой ближайшего острова: `passes` шагов расширения
 * (столько текселей поля нужно мип-уровням, чтобы у кромки острова не
 * смешивались цвета). Остальное непокрытое — `fallback`; по умолчанию 0 —
 * без метки: такие тексели ни одна грань не показывает, и они остаются как
 * у мода.
 */
export function dilateUvLabels(labels, width, height, { passes = 8, fallback = 0 } = {}) {
  let current = labels;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8Array(current);
    let changed = false;
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        if (current[at]) continue;
        const near =
          (x > 0 && current[at - 1]) ||
          (x < width - 1 && current[at + 1]) ||
          (y > 0 && current[at - width]) ||
          (y < height - 1 && current[at + width]) ||
          0;
        if (near) {
          next[at] = near;
          changed = true;
        }
      }
    current = next;
    if (!changed) break;
  }
  if (fallback) for (let at = 0; at < current.length; at += 1) if (!current[at]) current[at] = fallback;
  return current;
}

/**
 * Самый большой прямоугольник, где каждый тексель — `own` (1) или пуст
 * (0), и хотя бы половина — свои. `mask` — `Int8Array`: 1 свой, −1 чужой,
 * 0 пусто. Ответ — `[x0, y0, x1, y1]` в текселях (x1, y1 — после
 * последнего) или `null`.
 */
export function largestCleanRect(mask, width, height, { minFill = 0.5 } = {}) {
  const heights = new Int32Array(width);
  let best = null;
  let bestArea = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) heights[x] = mask[y * width + x] >= 0 ? heights[x] + 1 : 0;
    /* Самый большой прямоугольник под гистограммой строки. */
    const stack = [];
    for (let x = 0; x <= width; x += 1) {
      const h = x < width ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] >= h) {
        const [left, top] = stack.pop();
        const area = top * (x - left);
        if (area > bestArea && top > 0) {
          const rect = [left, y - top + 1, x, y + 1];
          if (ownShare(mask, width, rect) >= minFill) {
            bestArea = area;
            best = rect;
          }
        }
        start = left;
      }
      stack.push([start, h]);
    }
  }
  return best;
}

function ownShare(mask, width, [x0, y0, x1, y1]) {
  let own = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (mask[y * width + x] === 1) own += 1;
  return own / Math.max(1, (x1 - x0) * (y1 - y0));
}

/*
 * Поворот и отражение картинки в прямоугольнике развёртки, чтобы на стене
 * она стояла прямо: `right` и `down` — куда по развёртке идут «вправо» и
 * «вниз» стены, как их видит человек снаружи (`[du, dv]`). Перебираются все
 * восемь положений `emblemLocal` (`pixels.js`), берётся совпадающее.
 */
export function emblemPose(right, down) {
  const axis = ([du, dv]) => (Math.abs(du) >= Math.abs(dv) ? [Math.sign(du), 0] : [0, Math.sign(dv)]);
  const wantRight = axis(right);
  const wantDown = axis(down);
  /* Куда по (s, t) растёт x и y картинки при каждом положении. */
  const poses = [
    { turn: 0, mirror: false, right: [1, 0], down: [0, 1] },
    { turn: 1, mirror: false, right: [0, 1], down: [-1, 0] },
    { turn: 2, mirror: false, right: [-1, 0], down: [0, -1] },
    { turn: 3, mirror: false, right: [0, -1], down: [1, 0] },
    { turn: 0, mirror: true, right: [-1, 0], down: [0, 1] },
    { turn: 1, mirror: true, right: [0, 1], down: [1, 0] },
    { turn: 2, mirror: true, right: [1, 0], down: [0, -1] },
    { turn: 3, mirror: true, right: [0, -1], down: [-1, 0] },
  ];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const pose = poses.find((item) => same(item.right, wantRight) && same(item.down, wantDown));
  return pose ? { turn: pose.turn, mirror: pose.mirror } : { turn: 0, mirror: false };
}

/*
 * Развёртка как карта стен: у каждого текселя — метка, точка стены и её
 * нормаль. По ним отделка ложится по миру (`finish.js` → `boxProjection`):
 * узор течёт по стене сквозь швы развёртки, картинка растягивается на всю
 * стену. `triangles` — `[{ uv: [[u, v] ×3], positions: [[x, y, z] ×3],
 * normals: [[x, y, z] ×3], label }]`.
 */
export function rasterizeUvSurface(triangles, width, height) {
  const labels = new Uint8Array(width * height);
  const positions = new Float32Array(width * height * 3);
  const normals = new Float32Array(width * height * 3);
  for (const triangle of triangles) {
    const points = triangle.uv.map(([u, v]) => [u * width, v * height]);
    const shiftU = Math.floor(Math.min(...points.map((p) => p[0])) / width) * width;
    const shiftV = Math.floor(Math.min(...points.map((p) => p[1])) / height) * height;
    const [a, b, c] = points.map(([x, y]) => [x - shiftU, y - shiftV]);
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const [pa, pb, pc] = triangle.positions;
    const [na, nb, nc] = triangle.normals;
    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const at = y * width + x;
        labels[at] = triangle.label;
        let length = 0;
        for (let axis = 0; axis < 3; axis += 1) {
          positions[at * 3 + axis] = pa[axis] * w0 + pb[axis] * w1 + pc[axis] * w2;
          const n = na[axis] * w0 + nb[axis] * w1 + nc[axis] * w2;
          normals[at * 3 + axis] = n;
          length += n * n;
        }
        length = Math.sqrt(length) || 1;
        for (let axis = 0; axis < 3; axis += 1) normals[at * 3 + axis] /= length;
      }
    }
  }
  return { labels, positions, normals };
}

/**
 * Поля развёртки — меткой, точкой и нормалью ближайшего острова (как
 * `dilateUvLabels`): мип-уровни у кромки острова не смешивают отделку с
 * серым модом. Правит `surface` и возвращает его.
 */
export function dilateUvSurface(surface, width, height, { passes = 8 } = {}) {
  let { labels, positions, normals } = surface;
  for (let pass = 0; pass < passes; pass += 1) {
    const nextLabels = new Uint8Array(labels);
    const nextPositions = new Float32Array(positions);
    const nextNormals = new Float32Array(normals);
    let changed = false;
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        if (labels[at]) continue;
        const from =
          x > 0 && labels[at - 1]
            ? at - 1
            : x < width - 1 && labels[at + 1]
              ? at + 1
              : y > 0 && labels[at - width]
                ? at - width
                : y < height - 1 && labels[at + width]
                  ? at + width
                  : -1;
        if (from < 0) continue;
        nextLabels[at] = labels[from];
        for (let axis = 0; axis < 3; axis += 1) {
          nextPositions[at * 3 + axis] = positions[from * 3 + axis];
          nextNormals[at * 3 + axis] = normals[from * 3 + axis];
        }
        changed = true;
      }
    labels = nextLabels;
    positions = nextPositions;
    normals = nextNormals;
    if (!changed) break;
  }
  surface.labels = labels;
  surface.positions = positions;
  surface.normals = normals;
  return surface;
}
