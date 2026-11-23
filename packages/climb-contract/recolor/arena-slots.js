/*
 * Места картинок на листах арены: экраны, таблички, логотипы и плакаты.
 *
 * Один лист Rockstar часто несёт несколько картинок сразу: у полосы
 * экранов зала (`xj_v_tvs`) — четыре экрана по четвертям листа, у
 * табличек (`xj_v_sectionssings`) — две таблички одна над другой. Если
 * своей картинкой залить лист целиком, каждый экран покажет только кусок
 * — поэтому картинка кладётся в каждый «остров» развёртки отдельно.
 *
 * Остров — прямоугольник листа (доли u, v), который рисует одна связная
 * часть модели, и как он стоит в мире: какая ось листа идёт вправо и вниз,
 * если смотреть на поверхность спереди (`swap`, `flipU`, `flipV`), и его
 * пропорции в метрах (`aspect` — ширина к высоте). Тогда картинка в
 * экране стоит прямо и не растянута, даже если Rockstar развернул лист.
 *
 * Острова считает подготовка набора по моделям игры
 * (`scripts/lib/arena-stock.mjs`), кладёт в опись; картинку в лист кладёт
 * одна функция (`placeImageInIslands`) — и в кадре окна, и в установщике.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* ------------------------------------------------------------------ *
 * Острова развёртки
 * ------------------------------------------------------------------ */

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => {
  const size = length(a) || 1;
  return [a[0] / size, a[1] / size, a[2] / size];
};

/*
 * Как ось листа идёт по миру у треугольника: производные точки по u и v
 * (`dPdu`, `dPdv`) — из трёх вершин. `null` — вырожденная развёртка.
 */
function surfaceAxes(points, uvs) {
  const e1 = sub(points[1], points[0]);
  const e2 = sub(points[2], points[0]);
  const du1 = uvs[1][0] - uvs[0][0];
  const dv1 = uvs[1][1] - uvs[0][1];
  const du2 = uvs[2][0] - uvs[0][0];
  const dv2 = uvs[2][1] - uvs[0][1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-12) return null;
  return {
    dPdu: [0, 1, 2].map((axis) => (e1[axis] * dv2 - e2[axis] * dv1) / det),
    dPdv: [0, 1, 2].map((axis) => (e2[axis] * du1 - e1[axis] * du2) / det),
  };
}

/* Площадь треугольника в развёртке (доли листа²). */
const uvArea = (uvs) => Math.abs((uvs[1][0] - uvs[0][0]) * (uvs[2][1] - uvs[0][1]) - (uvs[2][0] - uvs[0][0]) * (uvs[1][1] - uvs[0][1])) / 2;

/*
 * Поза острова: какая ось листа — вправо, какая — вниз, если смотреть на
 * поверхность со стороны нормали. У стены «вверх» — Z мира; у пола и
 * потолка — север (+Y), так картинка на полу стоит так же, как карта.
 * Оси берутся у треугольника, что занимает больше всего листа (лицо
 * экрана), а не у самого большого в метрах: длинная кромка рамки берёт
 * из листа одну полоску и дала бы ложные пропорции.
 */
function islandPose(triangles) {
  let best = null;
  let bestArea = 0;
  const normal = [0, 0, 0];
  for (const triangle of triangles) {
    const area = length(cross(sub(triangle.points[1], triangle.points[0]), sub(triangle.points[2], triangle.points[0]))) / 2;
    for (const n of triangle.normals || []) {
      normal[0] += n[0] * area;
      normal[1] += n[1] * area;
      normal[2] += n[2] * area;
    }
    const share = uvArea(triangle.uvs);
    if (share > bestArea) {
      const axes = surfaceAxes(triangle.points, triangle.uvs);
      if (axes) {
        best = axes;
        bestArea = share;
      }
    }
  }
  if (!best) return { swap: false, flipU: false, flipV: false, aspect: 1 };
  let facing = normalize(normal);
  if (!length(normal)) facing = normalize(cross(best.dPdu, best.dPdv));
  const flat = Math.abs(facing[2]) > 0.8;
  const up = flat ? [0, 1, 0] : [0, 0, 1];
  const right = normalize(cross(up, facing));
  /* Вниз — правая рука × взгляд на поверхность: у стены это −Z мира. */
  const down = normalize(cross(right, facing));
  const a = dot(best.dPdu, right);
  const b = dot(best.dPdu, down);
  const c = dot(best.dPdv, right);
  const d = dot(best.dPdv, down);
  const swap = Math.abs(a) + Math.abs(d) < Math.abs(b) + Math.abs(c);
  return swap
    ? { swap: true, flipU: !(b > 0), flipV: !(c > 0), lengths: [length(best.dPdu), length(best.dPdv)] }
    : { swap: false, flipU: !(a > 0), flipV: !(d > 0), lengths: [length(best.dPdu), length(best.dPdv)] };
}

/*
 * Связные части сеток по общим вершинам (каждая — свой экран, своя
 * табличка): номера треугольников по частям. С `weld` общими считаются и
 * вершины, что стоят в одной точке (до 5 мм) с той же точкой развёртки (до
 * 0,002 листа): длинный экран F Majestic — плоская полоса 10 м из пяти
 * кусков со своими вершинами и швами в полмиллиметра развёртки; левый
 * кусок в 1,6 м отсеивался мелкой частью, и своя картинка ложилась мимо
 * него — там оставалась картинка игры (31.10.2026).
 */
const WELD_POSITION = 0.005;
const WELD_UV = 0.002;

function weldVertices(mesh, triangleOf, join) {
  const count = Math.floor(mesh.positions.length / 3);
  const cells = new Map();
  const cellOf = (x, y, z) => `${Math.floor(x / WELD_POSITION)},${Math.floor(y / WELD_POSITION)},${Math.floor(z / WELD_POSITION)}`;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (triangleOf[vertex] < 0) continue;
    const [x, y, z] = [mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]];
    const [u, v] = [mesh.uvs[vertex * 2], mesh.uvs[vertex * 2 + 1]];
    const [cx, cy, cz] = [Math.floor(x / WELD_POSITION), Math.floor(y / WELD_POSITION), Math.floor(z / WELD_POSITION)];
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1)
          for (const other of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
            const near =
              Math.abs(mesh.positions[other * 3] - x) <= WELD_POSITION &&
              Math.abs(mesh.positions[other * 3 + 1] - y) <= WELD_POSITION &&
              Math.abs(mesh.positions[other * 3 + 2] - z) <= WELD_POSITION &&
              Math.abs(mesh.uvs[other * 2] - u) <= WELD_UV &&
              Math.abs(mesh.uvs[other * 2 + 1] - v) <= WELD_UV;
            if (near) join(triangleOf[vertex], triangleOf[other]);
          }
    const key = cellOf(x, y, z);
    const list = cells.get(key) || [];
    list.push(vertex);
    cells.set(key, list);
  }
}

function connectedParts(mesh, { weld = false } = {}) {
  const count = Math.floor(mesh.indices.length / 3);
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (a, b) => {
    parent[find(a)] = find(b);
  };
  const owner = new Map();
  for (let triangle = 0; triangle < count; triangle += 1)
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[triangle * 3 + corner];
      if (!owner.has(vertex)) owner.set(vertex, triangle);
      else join(triangle, owner.get(vertex));
    }
  if (weld && mesh.positions && mesh.uvs) {
    const triangleOf = new Int32Array(Math.floor(mesh.positions.length / 3)).fill(-1);
    for (const [vertex, triangle] of owner) triangleOf[vertex] = triangle;
    weldVertices(mesh, triangleOf, join);
  }
  const parts = new Map();
  for (let triangle = 0; triangle < count; triangle += 1) {
    const root = find(triangle);
    const list = parts.get(root) || [];
    list.push(triangle);
    parts.set(root, list);
  }
  return [...parts.values()];
}

/* Насколько развёртка лица может быть шире листа, не став плиткой. */
const EDGE = 0.02;
const rectArea = (rect) => Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]);

/**
 * Острова листа по сеткам, что его рисуют: `meshes` — `[{ positions (мир,
 * Z вверх), normals, uvs, indices }]`. Ответ — `[{ rect: [u0, v0, u1, v1],
 * swap, flipU, flipV, aspect }]`, крупные первыми. Части, что лежат одна в
 * другой (лицо и обратная сторона экрана), сливаются; развёртка шире листа
 * (повтор) — остров на весь лист.
 */
export function uvIslands(meshes, { minShare = 0.002, relative = 0.2, weld = false } = {}) {
  const found = [];
  for (const mesh of meshes) {
    if (!mesh?.uvs || !mesh.indices?.length) continue;
    const point = (index) => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
    const normalOf = (index) => (mesh.normals ? [mesh.normals[index * 3], mesh.normals[index * 3 + 1], mesh.normals[index * 3 + 2]] : null);
    for (const part of connectedParts(mesh, { weld })) {
      const rect = [Infinity, Infinity, -Infinity, -Infinity];
      const triangles = [];
      let coverage = 0;
      for (const triangle of part) {
        const ids = [0, 1, 2].map((corner) => mesh.indices[triangle * 3 + corner]);
        const uvs = ids.map((index) => [mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]]);
        for (const [u, v] of uvs) {
          rect[0] = Math.min(rect[0], u);
          rect[1] = Math.min(rect[1], v);
          rect[2] = Math.max(rect[2], u);
          rect[3] = Math.max(rect[3], v);
        }
        coverage += uvArea(uvs);
        triangles.push({ points: ids.map(point), uvs, normals: ids.map(normalOf).filter(Boolean) });
      }
      if (!Number.isFinite(rect[0])) continue;
      /*
       * Плитка — развёртка шире листа (повтор). Полоска в основном за краем
       * листа (кромка корпуса берёт цвет со смещением) — не место вовсе.
       * Лицо, что чуть вышло за край (запас художника под фильтрацию: у
       * табло Majestic до 1.004), остаётся лицом в пределах листа.
       */
      const inside = rect.map((value) => clamp(value, 0, 1));
      const tiled = rect[2] - rect[0] > 1 + EDGE || rect[3] - rect[1] > 1 + EDGE;
      if (!tiled && rectArea(inside) < rectArea(rect) * 0.6) continue;
      const pose = islandPose(triangles);
      const span = tiled ? [1, 1] : [inside[2] - inside[0], inside[3] - inside[1]];
      const [lu, lv] = pose.lengths || [1, 1];
      const width = pose.swap ? lv * span[1] : lu * span[0];
      const height = pose.swap ? lu * span[0] : lv * span[1];
      found.push({
        rect: tiled ? [0, 0, 1, 1] : inside,
        tiled,
        coverage: tiled ? 0 : coverage,
        swap: pose.swap,
        flipU: pose.flipU,
        flipV: pose.flipV,
        aspect: height > 1e-6 ? width / height : 1,
      });
    }
  }
  /*
   * Рамки и стойки, что берут из листа только цвет (развёртка плиткой за
   * края листа или крошечный уголок), — не места картинки: остаются части,
   * что занимают хотя бы `relative` от самого большого лица. Плиточная
   * часть — место, только если других лиц нет (пол, стена): крошечные
   * уголки (кнопки, блики) лицами не считаются.
   */
  const faces = found.filter((island) => !island.tiled && rectArea(island.rect) >= minShare);
  const largest = Math.max(0, ...faces.map((island) => island.coverage));
  const kept = faces.length ? faces.filter((island) => island.coverage >= largest * relative) : found.filter((island) => island.tiled);
  /* Остров внутри другого (обратная сторона, рамка того же экрана) — один. */
  kept.sort((a, b) => rectArea(b.rect) - rectArea(a.rect));
  const islands = [];
  for (const island of kept) {
    if (rectArea(island.rect) < minShare) continue;
    const covered = islands.some((kept) => {
      const overlap = [Math.max(kept.rect[0], island.rect[0]), Math.max(kept.rect[1], island.rect[1]), Math.min(kept.rect[2], island.rect[2]), Math.min(kept.rect[3], island.rect[3])];
      return rectArea(overlap) > rectArea(island.rect) * 0.6;
    });
    if (!covered) islands.push(island);
  }
  return islands.map((island) => ({
    rect: island.rect.map((value) => Math.round(value * 10000) / 10000),
    swap: island.swap,
    flipU: island.flipU,
    flipV: island.flipV,
    aspect: Math.round(island.aspect * 1000) / 1000,
  }));
}

/* ------------------------------------------------------------------ *
 * Картинка в острова
 * ------------------------------------------------------------------ */

export const SLOT_FITS = Object.freeze(["contain", "cover", "stretch"]);
export const SLOT_BACKGROUNDS = Object.freeze(["keep", "colour", "clear"]);
export const SLOT_LIMITS = Object.freeze({ scale: [0.1, 3], rotate: [-180, 180], offset: [-1, 1] });

/** Как картинка стоит в экране: вписать, масштаб, поворот, сдвиг, фон. */
export function normalizeSlotTransform(input = {}, defaults = {}) {
  const source = input && typeof input === "object" ? input : {};
  const base = { fit: "contain", scale: 1, rotate: 0, offsetX: 0, offsetY: 0, background: "colour", backgroundColour: "#000000", ...defaults };
  const number = (value, [low, high], fallback, digits = 3) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const factor = 10 ** digits;
    return Math.round(clamp(parsed, low, high) * factor) / factor;
  };
  const colour = /^#[0-9a-f]{6}$/i.test(String(source.backgroundColour || "")) ? String(source.backgroundColour).toLowerCase() : base.backgroundColour;
  return {
    fit: SLOT_FITS.includes(source.fit) ? source.fit : base.fit,
    scale: number(source.scale, SLOT_LIMITS.scale, base.scale),
    rotate: number(source.rotate, SLOT_LIMITS.rotate, base.rotate, 1),
    offsetX: number(source.offsetX, SLOT_LIMITS.offset, base.offsetX),
    offsetY: number(source.offsetY, SLOT_LIMITS.offset, base.offsetY),
    background: SLOT_BACKGROUNDS.includes(source.background) ? source.background : base.background,
    backgroundColour: colour,
  };
}

const hexRgb = (hex) => {
  const value = parseInt(String(hex || "#000000").slice(1), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/*
 * Билинейная выборка картинки (RGBA, края — прозрачные).
 *
 * Зовётся на каждую точку каждого острова листа, а окно студии зовёт сборку листов на каждое обновление 3D-вида
 * (ТЗ 44В): раньше на точку заводились пять массивов (четыре отсчёта и их список) — сборщик мусора и 363 мс из 5 с
 * мазка под замедлением ×4. Теперь отсчёты развёрнуты, порядок сложения прежний — результат тот же до бита.
 */
function sample(image, u, v, out) {
  const { width, height, rgba } = image;
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = Math.min(width - 1, Math.max(0, x0));
  const xb = Math.min(width - 1, Math.max(0, x0 + 1));
  const rowA = Math.min(height - 1, Math.max(0, y0)) * width;
  const rowB = Math.min(height - 1, Math.max(0, y0 + 1)) * width;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let at = (rowA + xa) * 4;
  let alpha = rgba[at + 3] * ((1 - fx) * (1 - fy));
  r += rgba[at] * alpha;
  g += rgba[at + 1] * alpha;
  b += rgba[at + 2] * alpha;
  a += alpha;
  at = (rowA + xb) * 4;
  alpha = rgba[at + 3] * (fx * (1 - fy));
  r += rgba[at] * alpha;
  g += rgba[at + 1] * alpha;
  b += rgba[at + 2] * alpha;
  a += alpha;
  at = (rowB + xa) * 4;
  alpha = rgba[at + 3] * ((1 - fx) * fy);
  r += rgba[at] * alpha;
  g += rgba[at + 1] * alpha;
  b += rgba[at + 2] * alpha;
  a += alpha;
  at = (rowB + xb) * 4;
  alpha = rgba[at + 3] * (fx * fy);
  r += rgba[at] * alpha;
  g += rgba[at + 1] * alpha;
  b += rgba[at + 2] * alpha;
  a += alpha;
  if (a > 0) {
    r /= a;
    g /= a;
    b /= a;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = a;
  return out;
}
/** Выборка картинки для проверок: результат обязан совпадать с прежней записью до бита. */
export { sample as sampleBilinear };

/*
 * Рамка картинки в «экране» (ширина — `aspect`, высота — 1): середина,
 * размер и поворот.
 */
function imageBox(image, aspect, transform) {
  const imageAspect = image.width / Math.max(1, image.height);
  let width;
  let height;
  if (transform.fit === "stretch") {
    width = aspect;
    height = 1;
  } else {
    const k = transform.fit === "cover" ? Math.max(aspect / imageAspect, 1) : Math.min(aspect / imageAspect, 1);
    width = imageAspect * k;
    height = k;
  }
  const angle = (transform.rotate * Math.PI) / 180;
  return {
    cx: aspect * (0.5 + transform.offsetX * 0.5),
    cy: 0.5 + transform.offsetY * 0.5,
    width: width * transform.scale,
    height: height * transform.scale,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
  };
}

/**
 * Своя картинка в острова листа: `base` — пиксели листа (RGBA, `width` ×
 * `height`, меняются на месте и возвращаются), `islands` — из описи,
 * `image` — `{ rgba, width, height }`, `transform` — `normalizeSlotTransform`.
 * Фон острова: `keep` — лист как был, `colour` — заливка цветом, `clear` —
 * прозрачный (логотипы-наклейки).
 */
export function placeImageInIslands(base, width, height, islands, image, transform) {
  const settings = normalizeSlotTransform(transform);
  const fill = hexRgb(settings.backgroundColour);
  const colour = [0, 0, 0, 0];
  for (const island of islands || []) {
    const x0 = clamp(Math.floor(island.rect[0] * width), 0, width);
    const y0 = clamp(Math.floor(island.rect[1] * height), 0, height);
    const x1 = clamp(Math.ceil(island.rect[2] * width), 0, width);
    const y1 = clamp(Math.ceil(island.rect[3] * height), 0, height);
    if (x1 <= x0 || y1 <= y0) continue;
    const aspect = island.aspect > 0 ? island.aspect : (x1 - x0) / (y1 - y0);
    const box = image ? imageBox(image, aspect, settings) : null;
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) {
        const at = (y * width + x) * 4;
        /* Доли острова → доли «экрана», каким его видят спереди. */
        const s = (x + 0.5 - x0) / (x1 - x0);
        const t = (y + 0.5 - y0) / (y1 - y0);
        const along = island.flipU ? 1 - s : s;
        const across = island.flipV ? 1 - t : t;
        const p = island.swap ? across : along;
        const q = island.swap ? along : across;
        if (settings.background === "colour") {
          base[at] = fill[0];
          base[at + 1] = fill[1];
          base[at + 2] = fill[2];
          base[at + 3] = 255;
        } else if (settings.background === "clear") base[at + 3] = 0;
        if (!box) continue;
        const dx = p * aspect - box.cx;
        const dy = q - box.cy;
        const lx = dx * box.cos + dy * box.sin;
        const ly = -dx * box.sin + dy * box.cos;
        const iu = lx / box.width + 0.5;
        const iv = ly / box.height + 0.5;
        if (iu < 0 || iu > 1 || iv < 0 || iv > 1) continue;
        sample(image, iu, iv, colour);
        const alpha = colour[3] / 255;
        if (alpha <= 0) continue;
        const under = base[at + 3] / 255;
        const outAlpha = alpha + under * (1 - alpha);
        for (let channel = 0; channel < 3; channel += 1)
          base[at + channel] = Math.round(outAlpha > 0 ? (colour[channel] * alpha + base[at + channel] * under * (1 - alpha)) / outAlpha : 0);
        base[at + 3] = Math.round(outAlpha * 255);
      }
  }
  return base;
}

/**
 * Стирает рисунок в островах куском того же листа (`from` — доли листа):
 * фактура панели рядом ложится на место прежнего логотипа, и своя картинка
 * встаёт на чистую панель. У листа без прозрачности (DXT1) «прозрачный фон»
 * дал бы дыру, а заливка цветом — пятно на шлифованном металле.
 */
export function patchIslands(base, width, height, islands, from) {
  if (!Array.isArray(from) || from.length !== 4) return base;
  const fx0 = clamp(Math.floor(from[0] * width), 0, width - 1);
  const fy0 = clamp(Math.floor(from[1] * height), 0, height - 1);
  const fx1 = clamp(Math.ceil(from[2] * width), fx0 + 1, width);
  const fy1 = clamp(Math.ceil(from[3] * height), fy0 + 1, height);
  const source = new Uint8ClampedArray(base);
  for (const island of islands || []) {
    const x0 = clamp(Math.floor(island.rect[0] * width), 0, width);
    const y0 = clamp(Math.floor(island.rect[1] * height), 0, height);
    const x1 = clamp(Math.ceil(island.rect[2] * width), 0, width);
    const y1 = clamp(Math.ceil(island.rect[3] * height), 0, height);
    if (x1 <= x0 || y1 <= y0) continue;
    for (let y = y0; y < y1; y += 1) {
      const sy = fy0 + Math.min(fy1 - fy0 - 1, Math.floor(((y - y0 + 0.5) / (y1 - y0)) * (fy1 - fy0)));
      for (let x = x0; x < x1; x += 1) {
        const sx = fx0 + Math.min(fx1 - fx0 - 1, Math.floor(((x - x0 + 0.5) / (x1 - x0)) * (fx1 - fx0)));
        const to = (y * width + x) * 4;
        const at = (sy * width + sx) * 4;
        base[to] = source[at];
        base[to + 1] = source[at + 1];
        base[to + 2] = source[at + 2];
        base[to + 3] = source[at + 3];
      }
    }
  }
  return base;
}

/* ------------------------------------------------------------------ *
 * Знаки выхода: зелёное — в свой цвет
 * ------------------------------------------------------------------ */

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/**
 * Зелёные части листа (знаки выхода, бегущий человечек) — в свой цвет:
 * тон и насыщенность — цвета, светлота — своя у пикселя (буквы и рамки
 * остаются светлыми). Ровный серый, белый и не зелёное не трогаются.
 */
export function recolourGreen(rgba, colour) {
  const [tr, tg, tb] = hexRgb(colour).map((value) => value / 255);
  const [th, ts, tl] = rgbToHsl(tr, tg, tb);
  for (let at = 0; at < rgba.length; at += 4) {
    const [h, s, l] = rgbToHsl(rgba[at] / 255, rgba[at + 1] / 255, rgba[at + 2] / 255);
    if (s < 0.22 || h < 75 || h > 170) continue;
    /* Насыщенность и светлота — от цвета, с тенью исходного пикселя. */
    const shade = clamp(l / 0.4, 0.35, 1.6);
    const [r, g, b] = hslToRgb(th, Math.min(1, ts * (0.6 + s * 0.6)), clamp(tl * shade, 0.04, 0.9));
    rgba[at] = Math.round(r * 255);
    rgba[at + 1] = Math.round(g * 255);
    rgba[at + 2] = Math.round(b * 255);
  }
  return rgba;
}
