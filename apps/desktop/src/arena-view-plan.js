/*
 * Ракурсы на звезду и витрину автора в зале Majestic (12.11.2026, ALLIANCE V3: «превью изнутри, со звездой и всем визуалом»).
 *
 * Общие ракурсы Majestic (`arena-majestic-frames.js`) вращаются вокруг круга третьей арены, а своё автор ставит в других комнатах: статуя в стеклянном цилиндре — в
 * четвёртой, статуи участников и трон — на сцене третьей, стена стволов — по всей четвёртой. Слепые позы по границам модели попадали бы в стену или за колонну,
 * поэтому позы выбираются по самому залу: главный процесс держит сетки зала (`hallScene({ keepSolids })`), рисует по ним мелкий кадр программным z-буфером (96×64)
 * из каждой позы кольца вокруг цели, проецирует на него точки цели и берёт позы, где цель в кадре целиком, ничем не закрыта и камера не упирается в стену.
 *
 * Это геометрия, а не свет: цвет, текстуры и яркость кадра остаются делом окна. Что поза видит цель, проверено по сеткам зала, а не по тому, что нарисует окно.
 */

import { boundsCentre, boundsExtent, boundsSize } from "./arena-bounds.js";

const NEAR = 0.1;
/* Ближе этого (м) — «вплотную к стене»: кадр с такой долей пикселей негоден. */
const WALL = 0.8;
const MAX_DISTANCE = 30;
/* Цель меньше этого (м) целиком — «компактная»: статуя, трон; больше — группа (сцена, стена стволов, флаг). */
const COMPACT = 10;
/* Расстояния до центра цели в её размерах: компактную берём вплотную, группу — так, чтобы она умещалась. */
const DISTANCES = Object.freeze({ compact: [1.3, 1.9, 2.8], wide: [2.6, 3.4, 4.4], group: [0.7, 1.1, 1.6] });
/* Потолок «крупности»: наибольшая сторона рамки видимых точек цели в доле кадра — крупнее не лучше. */
const COVERAGE_CAP = Object.freeze({ compact: 0.55, wide: 0.3, group: 0.6 });
const SIDES = 16;
const SHOT = Object.freeze({ width: 96, height: 64 });
/* Точек цели на проверку видимости. */
const POINTS = 500;

/**
 * Сетки зала → один набор вершин и треугольников для `rasterize`.
 * `solids` — `[{ stem, positions: Float32Array (x, y, z мира), indices, doubleSided }]`.
 */
export function buildRaster(solids) {
  let vertexCount = 0;
  let triangleCount = 0;
  for (const solid of solids) {
    vertexCount += solid.positions.length / 3;
    triangleCount += solid.indices.length / 3;
  }
  const vertices = new Float32Array(vertexCount * 3);
  const triangles = new Uint32Array(triangleCount * 3);
  const owner = new Uint16Array(triangleCount);
  const meta = [];
  let vertexAt = 0;
  let triangleAt = 0;
  solids.forEach((solid, index) => {
    vertices.set(solid.positions, vertexAt * 3);
    for (let at = 0; at < solid.indices.length; at += 1) triangles[triangleAt * 3 + at] = solid.indices[at] + vertexAt;
    owner.fill(index, triangleAt, triangleAt + solid.indices.length / 3);
    meta.push({ stem: String(solid.stem), double: Boolean(solid.doubleSided) });
    vertexAt += solid.positions.length / 3;
    triangleAt += solid.indices.length / 3;
  });
  return { vertices, triangles, owner, meta, cam: new Float32Array(vertices.length) };
}

/* Оси камеры позы: `look = (sin yaw·cos pitch, cos yaw·cos pitch, sin pitch)`, вправо — по курсу, вверх — их векторное произведение. */
function cameraOf(pose) {
  const pitch = pose.pitch || 0;
  const forward = [Math.sin(pose.yaw) * Math.cos(pitch), Math.cos(pose.yaw) * Math.cos(pitch), Math.sin(pitch)];
  const right = [Math.cos(pose.yaw), -Math.sin(pose.yaw), 0];
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  return { eye: pose.eye, forward, right, up, focal: 1 / Math.tan(((pose.fov || 72) * Math.PI) / 360) };
}

/**
 * Кадр из позы `{ eye, yaw, pitch, fov }` (`fov` — по вертикали, как у окна): `{ depth, hit, behind, camera }` — расстояние до ближайшей поверхности, номер сетки
 * (`-1` — пусто) и отметка «это задняя грань одностороннего материала» для каждого пикселя.
 */
export function rasterize(raster, pose, { width = SHOT.width, height = SHOT.height } = {}) {
  const { vertices, triangles, owner, meta, cam } = raster;
  const camera = cameraOf(pose);
  const { right, up, forward } = camera;
  const [ex, ey, ez] = camera.eye;
  const count = vertices.length / 3;
  for (let at = 0; at < count; at += 1) {
    const dx = vertices[at * 3] - ex;
    const dy = vertices[at * 3 + 1] - ey;
    const dz = vertices[at * 3 + 2] - ez;
    cam[at * 3] = dx * right[0] + dy * right[1];
    cam[at * 3 + 1] = dx * up[0] + dy * up[1] + dz * up[2];
    cam[at * 3 + 2] = dx * forward[0] + dy * forward[1] + dz * forward[2];
  }
  const depth = new Float32Array(width * height).fill(Infinity);
  const hit = new Int32Array(width * height).fill(-1);
  const behind = new Uint8Array(width * height);
  const focal = (height / 2) * camera.focal;
  const middleX = width / 2;
  const middleY = height / 2;

  const draw = (ax, ay, az, bx, by, bz, cx, cy, cz, solid, double) => {
    const pax = middleX + (ax / az) * focal;
    const pay = middleY - (ay / az) * focal;
    const pbx = middleX + (bx / bz) * focal;
    const pby = middleY - (by / bz) * focal;
    const pcx = middleX + (cx / cz) * focal;
    const pcy = middleY - (cy / cz) * focal;
    /* Лицевая грань против часовой стрелки у глаза — в координатах экрана (Y вниз) её площадь отрицательна. Задняя грань одностороннего материала в окне не
       видна, но здесь она рисуется и помечается: поза, из которой смотрят на зал снаружи (сквозь стену) или на тонкую цель сзади, негодна. */
    const area = (pbx - pax) * (pcy - pay) - (pcx - pax) * (pby - pay);
    if (Math.abs(area) < 1e-9) return;
    const back = area > 0 && !double ? 1 : 0;
    const from = Math.max(0, Math.floor(Math.min(pax, pbx, pcx)));
    const to = Math.min(width - 1, Math.ceil(Math.max(pax, pbx, pcx)));
    const top = Math.max(0, Math.floor(Math.min(pay, pby, pcy)));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(pay, pby, pcy)));
    if (from > to || top > bottom) return;
    const invArea = 1 / area;
    const iaz = 1 / az;
    const ibz = 1 / bz;
    const icz = 1 / cz;
    for (let y = top; y <= bottom; y += 1) {
      const py = y + 0.5;
      for (let x = from; x <= to; x += 1) {
        const px = x + 0.5;
        const wa = ((pbx - px) * (pcy - py) - (pcx - px) * (pby - py)) * invArea;
        const wb = ((pcx - px) * (pay - py) - (pax - px) * (pcy - py)) * invArea;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const z = 1 / (wa * iaz + wb * ibz + wc * icz);
        const at = y * width + x;
        /* Две грани в одной плоскости (тонкая стенка из двух полигонов): при равной глубине побеждает лицевая, а не та, что рисуется позже. */
        if (z < depth[at] - 1e-4 || (!back && behind[at] === 1 && z < depth[at] + 1e-4)) {
          depth[at] = z;
          hit[at] = solid;
          behind[at] = back;
        }
      }
    }
  };

  const total = triangles.length / 3;
  for (let tri = 0; tri < total; tri += 1) {
    const a = triangles[tri * 3] * 3;
    const b = triangles[tri * 3 + 1] * 3;
    const c = triangles[tri * 3 + 2] * 3;
    const za = cam[a + 2];
    const zb = cam[b + 2];
    const zc = cam[c + 2];
    if (za < NEAR && zb < NEAR && zc < NEAR) continue;
    const solid = owner[tri];
    const double = meta[solid].double;
    if (za >= NEAR && zb >= NEAR && zc >= NEAR) {
      draw(cam[a], cam[a + 1], za, cam[b], cam[b + 1], zb, cam[c], cam[c + 1], zc, solid, double);
      continue;
    }
    /* Через ближнюю плоскость: многоугольник обрезается по z = NEAR и делится веером. */
    const corners = [a, b, c].map((at) => [cam[at], cam[at + 1], cam[at + 2]]);
    const polygon = [];
    for (let at = 0; at < 3; at += 1) {
      const p = corners[at];
      const q = corners[(at + 1) % 3];
      if (p[2] >= NEAR) polygon.push(p);
      if (p[2] >= NEAR !== q[2] >= NEAR) {
        const k = (NEAR - p[2]) / (q[2] - p[2]);
        polygon.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, NEAR]);
      }
    }
    for (let at = 1; at + 1 < polygon.length; at += 1) {
      const [p, q, r] = [polygon[0], polygon[at], polygon[at + 1]];
      draw(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], solid, double);
    }
  }
  return { depth, hit, behind, width, height, camera };
}

/**
 * Что видит поза: `points` — точки цели (`Float32Array` x, y, z мира).
 *   • `inFrame` — доля точек, что попали в кадр (цель не обрезана краем);
 *   • `seen` — доля попавших в кадр точек, которые ничем не закрыты (глубина кадра в их пикселе не меньше их расстояния);
 *   • `coverage` — наибольшая сторона рамки видимых точек в доле кадра (насколько крупно цель в кадре);
 *   • `near` — доля пикселей вплотную к камере (камера у стены, в колонне); `hole` — доля пустых пикселей; `back` — доля пикселей, где ближайшее — задняя грань.
 */
export function viewMetrics(raster, pose, points, isTarget = null, shot = SHOT) {
  const { depth, hit, behind, width, height, camera } = rasterize(raster, pose, shot);
  const pixels = width * height;
  let near = 0;
  let hole = 0;
  let back = 0;
  for (let at = 0; at < pixels; at += 1) {
    if (hit[at] < 0) hole += 1;
    else if (depth[at] < WALL) near += 1;
    if (behind[at]) back += 1;
  }
  const { right, up, forward } = camera;
  const [ex, ey, ez] = camera.eye;
  const focal = (height / 2) * camera.focal;
  const count = points.length / 3;
  let inside = 0;
  let seen = 0;
  let left = Infinity;
  let rightEdge = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let at = 0; at < count; at += 1) {
    const dx = points[at * 3] - ex;
    const dy = points[at * 3 + 1] - ey;
    const dz = points[at * 3 + 2] - ez;
    const z = dx * forward[0] + dy * forward[1] + dz * forward[2];
    if (z < NEAR) continue;
    const px = width / 2 + ((dx * right[0] + dy * right[1]) / z) * focal;
    const py = height / 2 - ((dx * up[0] + dy * up[1] + dz * up[2]) / z) * focal;
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    inside += 1;
    /* Точка открыта, если в её пикселе видна сама цель или ничего ближе неё (допуск — на грубый кадр: пиксель усредняет поверхность с соседними). */
    const pixel = Math.floor(py) * width + Math.floor(px);
    if (!behind[pixel] && ((isTarget && hit[pixel] >= 0 && isTarget[hit[pixel]] === 1) || depth[pixel] >= z - (0.12 + 0.01 * z))) {
      seen += 1;
      if (px < left) left = px;
      if (px > rightEdge) rightEdge = px;
      if (py < top) top = py;
      if (py > bottom) bottom = py;
    }
  }
  return {
    inFrame: count ? inside / count : 0,
    seen: inside ? seen / inside : 0,
    coverage: seen ? Math.max((rightEdge - left) / width, (bottom - top) / height) : 0,
    near: near / pixels,
    hole: hole / pixels,
    back: back / pixels,
  };
}

const pose = (eye, aim, fov) => {
  const dx = aim[0] - eye[0];
  const dy = aim[1] - eye[1];
  const flat = Math.hypot(dx, dy);
  return { eye, yaw: Math.atan2(dx, dy), pitch: Math.max(-0.7, Math.min(0.7, Math.atan2(aim[2] - eye[2], flat))), fov };
};

/**
 * Позы-кандидаты вокруг цели `{ min, max }`: три расстояния (от размера цели), три высоты глаза, шестнадцать сторон; каждая смотрит на цель.
 * Глаз вне `eyeBox` (`{ min, max }`, граница комнаты) не берётся.
 */
export function candidateViews(box, { fov = 72, eyeBox = null, wide = false } = {}) {
  const [dx, dy, dz] = boundsExtent(box);
  const size = boundsSize(box);
  const radius = Math.hypot(dx, dy) / 2;
  const middle = boundsCentre(box);
  const kind = size <= COMPACT ? "compact" : "group";
  const aim = [middle[0], middle[1], kind === "compact" ? box.min[2] + 0.6 * dz : middle[2]];
  const distances = [...new Set(DISTANCES[wide && kind === "compact" ? "wide" : kind].map((k) => Math.round(Math.min(MAX_DISTANCE, Math.max(radius + 1.5, k * size)) * 10) / 10))];
  const heights = [box.min[2] + 1.6, box.min[2] + 3, middle[2]].filter((value, at, all) => all.findIndex((other) => Math.abs(other - value) < 0.4) === at);
  const views = [];
  for (const distance of distances)
    for (const height of heights)
      for (let side = 0; side < SIDES; side += 1) {
        const angle = (side * 2 * Math.PI) / SIDES;
        const eye = [middle[0] + Math.sin(angle) * distance, middle[1] + Math.cos(angle) * distance, height];
        if (eyeBox && eye.some((value, axis) => value < eyeBox.min[axis] || value > eyeBox.max[axis])) continue;
        views.push(pose(eye, aim, fov));
      }
  return views;
}

/* Все вершины моделей цели (x, y, z мира подряд). */
function targetVertices(solids, names) {
  let total = 0;
  for (const solid of solids) if (names.has(String(solid.stem).toLowerCase())) total += solid.positions.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const solid of solids) {
    if (!names.has(String(solid.stem).toLowerCase())) continue;
    out.set(solid.positions, at);
    at += solid.positions.length;
  }
  return out;
}

const boxOfPoints = (points) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < points.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      if (points[at + axis] < min[axis]) min[axis] = points[at + axis];
      if (points[at + axis] > max[axis]) max[axis] = points[at + axis];
    }
  return { min, max };
};

/* Не больше `POINTS` вершин, равномерно по списку: по ним проверяется, что цель в кадре и не закрыта. */
function sampled(points) {
  const count = points.length / 3;
  const step = Math.max(1, Math.floor(count / POINTS));
  const out = [];
  for (let at = 0; at < count; at += step) out.push(points[at * 3], points[at * 3 + 1], points[at * 3 + 2]);
  return Float32Array.from(out);
}

/**
 * Связные куски вершин: ячейки 2 м, соседние (по 26 направлениям) — один кусок. Стена стволов у ALLIANCE — не одна вещь, а стойка 6×10 м и узкая панель в
 * другом конце комнаты, статуи на сцене — четыре отдельные группы: кадр на «всё сразу» вышел бы мелким и пустым, кадр на кусок — крупным.
 * @returns {{ count: number, points: Float32Array }[]} крупные куски первыми; `points` — вершины куска
 */
export function clusterPoints(points, cell = 2) {
  const key = (x, y, z) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
  const cellOf = (at) => [Math.floor(points[at] / cell), Math.floor(points[at + 1] / cell), Math.floor(points[at + 2] / cell)];
  const cells = new Map();
  for (let at = 0; at < points.length; at += 3) cells.set(key(...cellOf(at)), -1);
  const unions = [];
  let found = 0;
  for (const start of cells.keys()) {
    if (cells.get(start) !== -1) continue;
    const id = found;
    found += 1;
    const stack = [start];
    cells.set(start, id);
    while (stack.length) {
      const current = stack.pop();
      const z = (current % 2048) - 1024;
      const y = (Math.floor(current / 2048) % 2048) - 1024;
      const x = Math.floor(current / 4194304) - 1024;
      for (let dx = -1; dx <= 1; dx += 1)
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dz = -1; dz <= 1; dz += 1) {
            const next = key(x + dx, y + dy, z + dz);
            if (cells.get(next) === -1) {
              cells.set(next, id);
              stack.push(next);
            }
          }
    }
    unions.push([]);
  }
  for (let at = 0; at < points.length; at += 3) unions[cells.get(key(...cellOf(at)))].push(points[at], points[at + 1], points[at + 2]);
  return unions
    .map((list) => ({ count: list.length / 3, points: Float32Array.from(list) }))
    .sort((left, right) => right.count - left.count);
}

/* Лучшие позы на один кусок цели `{ box, points }`; `count` позы, без близнецов. */
function pickViews(raster, isTarget, { box, points }, { count, fov, eyeBox, wide }) {
  const size = boundsSize(box);
  const kind = size <= COMPACT ? "compact" : "group";
  const cap = COVERAGE_CAP[wide && kind === "compact" ? "wide" : kind];
  const scored = [];
  for (const view of candidateViews(box, { fov, eyeBox, wide })) {
    const metrics = viewMetrics(raster, view, points, isTarget);
    if (metrics.near > 0.03 || metrics.back > 0.03 || metrics.inFrame < (kind === "compact" ? 0.9 : 0.6) || metrics.seen < 0.5 || metrics.coverage < (kind === "compact" ? (wide ? 0.12 : 0.15) : 0.1)) continue;
    scored.push({ pose: view, metrics, score: metrics.seen * metrics.inFrame * Math.min(metrics.coverage, cap) - 3 * metrics.near - 0.4 * metrics.hole });
  }
  scored.sort((left, right) => right.score - left.score);
  const gap = Math.max(3, size);
  const picked = [];
  for (const item of scored) {
    if (picked.length >= count) break;
    const twin = picked.some((other) => {
      const apart = Math.hypot(other.pose.eye[0] - item.pose.eye[0], other.pose.eye[1] - item.pose.eye[1], other.pose.eye[2] - item.pose.eye[2]);
      const turned = Math.abs(Math.atan2(Math.sin(other.pose.yaw - item.pose.yaw), Math.cos(other.pose.yaw - item.pose.yaw)));
      return apart < gap && turned < 0.7;
    });
    if (!twin) picked.push(item);
  }
  return picked;
}

/* Комната, в которой стоит цель: наименьшая из `rooms` (`{ min, max }`), что её содержит, чуть сжатая — глаз не стоит в самой стене. */
export function roomAround(box, rooms = []) {
  const middle = boundsCentre(box);
  const inside = rooms.filter((room) => middle.every((value, axis) => value >= room.min[axis] && value <= room.max[axis]));
  const volume = (room) => room.max.reduce((product, value, axis) => product * (value - room.min[axis]), 1);
  const room = inside.sort((left, right) => volume(left) - volume(right))[0];
  if (!room) return null;
  const margin = [1, 1, 0.3];
  const shrunk = { min: room.min.map((value, axis) => value + margin[axis]), max: room.max.map((value, axis) => value - margin[axis]) };
  return shrunk.min.every((value, axis) => value < shrunk.max[axis]) ? shrunk : null;
}

/* Куски цели, на которые целятся кадры: вся цель, если она компактная; иначе её связные куски (не мельче `PIECE_SHARE` вершин; крупнейший — всегда). */
/* Кусок цели получает свой кадр, если в нём не меньше этой доли её вершин. 8 %, а не 12: у ALLIANCE V3 трон с фигурой рядом — 10 % вершин сцены зала,
   и при 12 % своего кадра ему не доставалось («все модели автора внутри» — владелец, 13.11.2026). */
const PIECE_SHARE = 0.08;

const piecesOf = (vertices) => {
  const whole = boxOfPoints(vertices);
  if (boundsSize(whole) <= COMPACT) return [{ box: whole, points: sampled(vertices) }];
  const parts = clusterPoints(vertices);
  const total = vertices.length / 3;
  return parts
    .filter((part, at) => at === 0 || part.count >= PIECE_SHARE * total)
    .map((part) => ({ box: boxOfPoints(part.points), points: sampled(part.points) }));
};

/**
 * Лучшие позы на цель — модели `stems` в сетках зала `solids`: `count` поз, по одной на каждый крупный кусок цели по кругу (потом вторые, третьи).
 * Годится поза, где в кадре не меньше 90 % точек компактного куска (60 % крупного), из них открыты не меньше половины, кусок занимает не меньше 15 % (10 %) кадра
 * по большей стороне, а к камере вплотную не больше 3 % пикселей. Лучше — открытее и крупнее (потолок — 55 % и 60 %). Похожие позы не берутся.
 * @param {object[]} solids сетки зала (`hallScene({ keepSolids: true })`)
 * @param {{ stems: string[], count?: number, fov?: number, rooms?: object[] }} target `rooms` — границы комнат MLO: глаз стоит в комнате цели
 * @returns {{ pose: object, metrics: object, piece: number }[]} лучшие первыми
 */
export function planTargetViews(solids, { stems, count = 2, fov = 72, rooms = [], wide = false }) {
  const names = new Set(stems.map((stem) => String(stem).toLowerCase()));
  const vertices = targetVertices(solids, names);
  if (!vertices.length) return [];
  /* Прозрачное (стекло витрины) кадр не закрывает, но у цели оно — её поверхность: стена стволов у ALLIANCE целиком из прозрачных материалов. */
  const raster = buildRaster(solids.filter((solid) => !solid.blend || names.has(String(solid.stem).toLowerCase())));
  const isTarget = Uint8Array.from(raster.meta, (item) => (names.has(item.stem.toLowerCase()) ? 1 : 0));
  const pieces = piecesOf(vertices).slice(0, Math.max(1, count));
  const each = Math.ceil(count / pieces.length);
  const lists = pieces.map((piece, index) =>
    pickViews(raster, isTarget, piece, { count: each, fov, eyeBox: roomAround(piece.box, rooms), wide }).map((item) => ({ ...item, piece: index })),
  );
  const out = [];
  for (let round = 0; out.length < count && round < each; round += 1) for (const list of lists) if (list[round] && out.length < count) out.push(list[round]);
  return out;
}

/**
 * Ракурсы зала Majestic на звезду и витрину автора.
 *
 * Обложка — кадр изнутри, где главный свой реквизит автора виден вместе с залом вокруг (звезда не «портретом» вплотную, а на расстоянии, потолок — 30 % кадра);
 * если такого кадра нет (звезда закрыта, комната тесная), обложки нет и остаётся лучший общий кадр зала. Галерея: звезда крупнее (`starViews`), по одному-двум кадрам
 * на каждую группу витрины.
 *
 * @param {{ solids?: object[], star?: { model: string }, groups?: object[], rooms?: object[], fov?: number, starViews?: number, groupViews?: number }} input
 *   `solids` — сетки зала (`hallScene({ keepSolids: true })`), `star` — звезда (`arena-star-target.js`), `groups` — витрина (`arena-showcase.js`), `rooms` — границы комнат MLO
 * @returns {{ cover: object|null, frames: object[], report: object[] }|null} `cover` — поза обложки, `frames` — позы галереи по порядку (звезда, затем группы);
 *   `report` — по цели: сколько поз взято и какая видимость у лучшей. `null`, если сеток нет.
 */
export function planMajesticViews({ solids, star = null, groups = [], rooms = [], fov = 72, starViews = 2, groupViews = 3 } = {}) {
  if (!solids?.length) return null;
  const report = [];
  const note = (id, stems, picks) =>
    report.push({
      id,
      stems,
      picked: picks.length,
      ...(picks[0] ? { seen: Math.round(picks[0].metrics.seen * 100) / 100, coverage: Math.round(picks[0].metrics.coverage * 100) / 100 } : {}),
    });
  let cover = null;
  const frames = [];
  if (star?.model) {
    const wide = planTargetViews(solids, { stems: [star.model], count: 1, fov, rooms, wide: true });
    note("cover", [star.model], wide);
    cover = wide[0]?.pose || null;
    const close = planTargetViews(solids, { stems: [star.model], count: starViews, fov, rooms });
    note("star", [star.model], close);
    frames.push(...close.map((item) => item.pose));
  }
  for (const group of groups) {
    /* Группа из одной модели (флаг, табличка) — один кадр: второй был бы близнецом. */
    const picks = planTargetViews(solids, { stems: group.stems, count: group.count > 1 ? groupViews : 1, fov, rooms });
    note(group.id, group.stems, picks);
    frames.push(...picks.map((item) => item.pose));
  }
  return { cover, frames, report };
}
