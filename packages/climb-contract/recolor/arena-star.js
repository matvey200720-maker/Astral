/*
 * Звезда арены GTA5RP: своя картинка объёмной фигурой на подставке.
 *
 * Одна арифметика на окно и установщик. Картинка → маска клеток (по
 * длинной стороне не больше `ARENA_STAR_CELLS`) → сетка: лицо и спинка —
 * прямоугольники клеток (жадным слиянием), бока — по контуру маски, толщина
 * — `depth` сантиметров; цвет — сама картинка (развёртка лица — её доли,
 * бока берут цвет крайней клетки). Под фигурой — подставка. Окно рисует эту
 * сетку three.js, установщик отдаёт её нативному хосту
 * (`compile-star-model`), и в игре стоит та же фигура.
 *
 * Движение — тоже одно: прыжки, оборот на 360° и левитация со скоростью и
 * высотой работы (`arenaStarMotion`). Окно двигает фигуру им же каждый
 * кадр, установщик снимает с него кадры клипа анимации.
 *
 * Оси — как у игры: метры, Z вверх, лицо фигуры смотрит в −Y, низ
 * подставки — на нуле, ось фигуры — по Z через начало координат.
 */

export const ARENA_STAR_CELLS = 96;
/* Клетка заполнена, если картинка в ней непрозрачна хотя бы наполовину. */
export const ARENA_STAR_COVER = 0.5;
/* Подставка — тёмный графит: она одна на любую картинку. */
export const ARENA_STAR_STAND_COLOUR = "#2b2f36";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Маска картинки: `{ cols, rows, filled, crop }`. Пустые поля картинки
 * обрезаются — размер звезды меряется по самой фигуре; `crop` — доли
 * картинки `{ u0, v0, u1, v1 }`, которые легли в маску (v — сверху вниз,
 * как строки картинки). Пустая картинка — `null`.
 */
export function arenaStarMask(rgba, width, height, { cells = ARENA_STAR_CELLS, cover = ARENA_STAR_COVER } = {}) {
  if (!rgba || !width || !height) return null;
  const limit = cover * 255;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (rgba[(y * width + x) * 4 + 3] >= limit) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const scale = cells / Math.max(boxWidth, boxHeight);
  const cols = Math.max(1, Math.round(boxWidth * scale));
  const rows = Math.max(1, Math.round(boxHeight * scale));
  const filled = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const y0 = top + Math.floor((row * boxHeight) / rows);
    const y1 = Math.max(y0 + 1, top + Math.floor(((row + 1) * boxHeight) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = left + Math.floor((col * boxWidth) / cols);
      const x1 = Math.max(x0 + 1, left + Math.floor(((col + 1) * boxWidth) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += rgba[(y * width + x) * 4 + 3];
      if (sum / ((y1 - y0) * (x1 - x0)) >= limit) filled[row * cols + col] = 1;
    }
  }
  return {
    cols,
    rows,
    filled,
    crop: { u0: left / width, v0: top / height, u1: (right + 1) / width, v1: (bottom + 1) / height },
  };
}

/* ------------------------------------------------------------------ *
 * Сетка
 * ------------------------------------------------------------------ */

function meshWriter() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const parts = [];
  const star = [];
  const stand = [];
  /* Четырёхугольник a, b, c, d против часовой, если смотреть на лицо. */
  const quad = (corners, normal, cornerUvs, part) => {
    const base = positions.length / 3;
    corners.forEach((point, index) => {
      positions.push(point[0], point[1], point[2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(cornerUvs[index][0], cornerUvs[index][1]);
      parts.push(part);
    });
    (part ? star : stand).push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  /* Треугольник подставки (крышки призм). */
  const tri = (corners, normal) => {
    const base = positions.length / 3;
    for (const point of corners) {
      positions.push(point[0], point[1], point[2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(0, 0);
      parts.push(0);
    }
    stand.push(base, base + 1, base + 2);
  };
  return {
    quad,
    tri,
    finish() {
      const indices = new Uint32Array(star.length + stand.length);
      indices.set(star, 0);
      indices.set(stand, star.length);
      return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        parts: new Uint8Array(parts),
        indices,
        groups: { star: [0, star.length], stand: [star.length, stand.length] },
      };
    },
  };
}

/* Прямоугольники заполненных клеток: жадное слияние строк и столбцов. */
function rectangles(mask) {
  const { cols, rows, filled } = mask;
  const used = new Uint8Array(cols * rows);
  const out = [];
  for (let row = 0; row < rows; row += 1)
    for (let col = 0; col < cols; col += 1) {
      const at = row * cols + col;
      if (!filled[at] || used[at]) continue;
      let end = col + 1;
      while (end < cols && filled[row * cols + end] && !used[row * cols + end]) end += 1;
      let last = row + 1;
      grow: while (last < rows) {
        for (let c = col; c < end; c += 1) if (!filled[last * cols + c] || used[last * cols + c]) break grow;
        last += 1;
      }
      for (let r = row; r < last; r += 1) for (let c = col; c < end; c += 1) used[r * cols + c] = 1;
      out.push({ c0: col, r0: row, c1: end, r1: last });
    }
  return out;
}

/* Подставка: размеры от фигуры, в метрах. */
function standShape(stand, width, size, thickness) {
  const base = Math.max(width, thickness);
  if (stand === "pedestal") {
    const radius = clamp(base * 0.42, 0.35, 3);
    const height = clamp(size * 0.16, 0.3, 1.4);
    return { kind: stand, radius, height };
  }
  if (stand === "cube") {
    const side = clamp(Math.max(width * 0.4, thickness * 2), 0.5, 2.5);
    return { kind: stand, side, height: side };
  }
  if (stand === "steps") {
    const wide = clamp(width * 0.95, 0.9, 9);
    const deep = clamp(Math.max(thickness * 4, wide * 0.55), 0.6, 5);
    const step = clamp(size * 0.06, 0.14, 0.45);
    return { kind: stand, wide, deep, step, height: step * 3 };
  }
  if (stand === "ring") {
    const radius = clamp(base * 0.62, 0.5, 6);
    return { kind: stand, radius, height: 0.16 };
  }
  return { kind: "none", height: 0 };
}

/* Призма: многоугольник с `sides` сторонами (у коробки — 4, повёрнутые на 45°). */
function prism(write, { sides, rx, ry, z0, z1, turn = 0 }) {
  const ring = Array.from({ length: sides }, (_, index) => {
    const angle = turn + (index / sides) * Math.PI * 2;
    return [Math.cos(angle) * rx, Math.sin(angle) * ry];
  });
  for (let index = 0; index < sides; index += 1) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % sides];
    const length = Math.hypot(by - ay, ax - bx) || 1;
    const normal = [(by - ay) / length, (ax - bx) / length, 0];
    write.quad(
      [
        [ax, ay, z0],
        [bx, by, z0],
        [bx, by, z1],
        [ax, ay, z1],
      ],
      normal,
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      0,
    );
  }
  /* Крышка и дно — веером треугольников через середину. */
  for (let index = 0; index < sides; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % sides];
    write.tri(
      [
        [0, 0, z1],
        [a[0], a[1], z1],
        [b[0], b[1], z1],
      ],
      [0, 0, 1],
    );
    write.tri(
      [
        [0, 0, z0],
        [b[0], b[1], z0],
        [a[0], a[1], z0],
      ],
      [0, 0, -1],
    );
  }
}

/* Кольцо вокруг основания: тор, лежащий на подиуме. */
function torus(write, { radius, tube, z, segments = 32, sides = 8 }) {
  const point = (u, v) => {
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const cv = Math.cos(v);
    const sv = Math.sin(v);
    return {
      position: [(radius + tube * cv) * cu, (radius + tube * cv) * su, z + tube * sv],
      normal: [cv * cu, cv * su, sv],
    };
  };
  for (let i = 0; i < segments; i += 1)
    for (let j = 0; j < sides; j += 1) {
      const u0 = (i / segments) * Math.PI * 2;
      const u1 = ((i + 1) / segments) * Math.PI * 2;
      const v0 = (j / sides) * Math.PI * 2;
      const v1 = ((j + 1) / sides) * Math.PI * 2;
      const a = point(u0, v0);
      const b = point(u1, v0);
      const c = point(u1, v1);
      const d = point(u0, v1);
      const n = [0, 1, 2].map((axis) => (a.normal[axis] + b.normal[axis] + c.normal[axis] + d.normal[axis]) / 4);
      write.quad([a.position, b.position, c.position, d.position], n, [[0, 0], [0, 0], [0, 0], [0, 0]], 0);
    }
}

function writeStand(write, shape) {
  if (shape.kind === "pedestal") {
    const { radius, height } = shape;
    prism(write, { sides: 8, rx: radius * 1.18, ry: radius * 1.18, z0: 0, z1: height * 0.16, turn: Math.PI / 8 });
    prism(write, { sides: 8, rx: radius, ry: radius, z0: height * 0.16, z1: height * 0.86, turn: Math.PI / 8 });
    prism(write, { sides: 8, rx: radius * 1.1, ry: radius * 1.1, z0: height * 0.86, z1: height, turn: Math.PI / 8 });
  } else if (shape.kind === "cube") {
    const half = (shape.side / 2) * Math.SQRT2;
    prism(write, { sides: 4, rx: half, ry: half, z0: 0, z1: shape.height, turn: Math.PI / 4 });
  } else if (shape.kind === "steps") {
    [1, 0.78, 0.56].forEach((share, index) => {
      const rx = ((shape.wide * share) / 2) * Math.SQRT2;
      const ry = ((shape.deep * share) / 2) * Math.SQRT2;
      prism(write, { sides: 4, rx, ry, z0: shape.step * index, z1: shape.step * (index + 1), turn: Math.PI / 4 });
    });
  } else if (shape.kind === "ring") {
    prism(write, { sides: 32, rx: shape.radius, ry: shape.radius, z0: 0, z1: shape.height * 0.6 });
    torus(write, { radius: shape.radius, tube: shape.height * 0.4, z: shape.height * 0.6 });
  }
}

/**
 * Сетка звезды по маске: `size` — высота фигуры, м; `depth` — толщина,
 * см; `stand` — подставка. Ответ — массивы для three.js и для хоста:
 * `positions`, `normals`, `uvs` (доли картинки, v — сверху вниз; у
 * подставки — нули), `parts` (1 — фигура, 0 — подставка), `indices`
 * (сначала фигура, потом подставка — `groups`), `standHeight`, `width`,
 * `height`, `bounds`.
 */
export function arenaStarMesh(mask, { size = 4, depth = 12, stand = "pedestal" } = {}) {
  const write = meshWriter();
  const thickness = clamp(Number(depth) || 12, 1, 200) / 100;
  const cell = size / mask.rows;
  const width = cell * mask.cols;
  const shape = standShape(stand, width, size, thickness);
  const lift = shape.height;
  const { u0, v0, u1, v1 } = mask.crop;
  const x = (col) => (col - mask.cols / 2) * cell;
  const z = (row) => lift + (mask.rows - row) * cell;
  const u = (col) => u0 + (col / mask.cols) * (u1 - u0);
  const v = (row) => v0 + (row / mask.rows) * (v1 - v0);
  const front = -thickness / 2;
  const back = thickness / 2;

  /* Лицо и спинка. */
  for (const rect of rectangles(mask)) {
    const xa = x(rect.c0);
    const xb = x(rect.c1);
    const zb = z(rect.r1);
    const zt = z(rect.r0);
    const ua = u(rect.c0);
    const ub = u(rect.c1);
    const vb = v(rect.r1);
    const vt = v(rect.r0);
    write.quad(
      [
        [xa, front, zb],
        [xb, front, zb],
        [xb, front, zt],
        [xa, front, zt],
      ],
      [0, -1, 0],
      [
        [ua, vb],
        [ub, vb],
        [ub, vt],
        [ua, vt],
      ],
      1,
    );
    /* Спинка — зеркалом: смотрит в +Y, картинка видна с обратной стороны. */
    write.quad(
      [
        [xb, back, zb],
        [xa, back, zb],
        [xa, back, zt],
        [xb, back, zt],
      ],
      [0, 1, 0],
      [
        [ub, vb],
        [ua, vb],
        [ua, vt],
        [ub, vt],
      ],
      1,
    );
  }

  /* Бока по контуру: соседняя клетка пуста — грань наружу, отрезками. */
  const { cols, rows, filled } = mask;
  const at = (col, row) => (col >= 0 && row >= 0 && col < cols && row < rows ? filled[row * cols + col] : 0);
  const centreU = (col) => u(col + 0.5);
  const centreV = (row) => v(row + 0.5);
  for (let row = 0; row < rows; row += 1)
    for (const [dr, normal] of [
      [-1, [0, 0, 1]],
      [1, [0, 0, -1]],
    ]) {
      let col = 0;
      while (col < cols) {
        if (!at(col, row) || at(col, row + dr)) {
          col += 1;
          continue;
        }
        let end = col + 1;
        while (end < cols && at(end, row) && !at(end, row + dr)) end += 1;
        const zz = dr < 0 ? z(row) : z(row + 1);
        const xa = x(col);
        const xb = x(end);
        const uvA = [centreU(col), centreV(row)];
        const uvB = [centreU(end - 1), centreV(row)];
        if (dr < 0)
          write.quad(
            [
              [xa, front, zz],
              [xb, front, zz],
              [xb, back, zz],
              [xa, back, zz],
            ],
            normal,
            [uvA, uvB, uvB, uvA],
            1,
          );
        else
          write.quad(
            [
              [xa, back, zz],
              [xb, back, zz],
              [xb, front, zz],
              [xa, front, zz],
            ],
            normal,
            [uvA, uvB, uvB, uvA],
            1,
          );
        col = end;
      }
    }
  for (let col = 0; col < cols; col += 1)
    for (const [dc, normal] of [
      [-1, [-1, 0, 0]],
      [1, [1, 0, 0]],
    ]) {
      let row = 0;
      while (row < rows) {
        if (!at(col, row) || at(col + dc, row)) {
          row += 1;
          continue;
        }
        let end = row + 1;
        while (end < rows && at(col, end) && !at(col + dc, end)) end += 1;
        const xx = dc < 0 ? x(col) : x(col + 1);
        const zt = z(row);
        const zb = z(end);
        const uvT = [centreU(col), centreV(row)];
        const uvB = [centreU(col), centreV(end - 1)];
        if (dc < 0)
          write.quad(
            [
              [xx, back, zb],
              [xx, front, zb],
              [xx, front, zt],
              [xx, back, zt],
            ],
            normal,
            [uvB, uvB, uvT, uvT],
            1,
          );
        else
          write.quad(
            [
              [xx, front, zb],
              [xx, back, zb],
              [xx, back, zt],
              [xx, front, zt],
            ],
            normal,
            [uvB, uvB, uvT, uvT],
            1,
          );
        row = end;
      }
    }

  writeStand(write, shape);
  const mesh = write.finish();
  return { ...mesh, standHeight: lift, width, height: size, thickness, bounds: boundsOf(mesh.positions) };
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 1) {
    const axis = index % 3;
    if (positions[index] < min[axis]) min[axis] = positions[index];
    if (positions[index] > max[axis]) max[axis] = positions[index];
  }
  return { min, max };
}

/** Повернуть сетку вокруг Z на `angle` радиан (новый объект). */
export function turnArenaStarMesh(mesh, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (source) => {
    const out = new Float32Array(source.length);
    for (let index = 0; index < source.length; index += 3) {
      out[index] = source[index] * cos - source[index + 1] * sin;
      out[index + 1] = source[index] * sin + source[index + 1] * cos;
      out[index + 2] = source[index + 2];
    }
    return out;
  };
  const positions = turn(mesh.positions);
  return { ...mesh, positions, normals: turn(mesh.normals), bounds: boundsOf(positions) };
}

/* Предел вершин одной геометрии игры — 16-битные индексы. */
export const ARENA_STAR_MAX_VERTICES = 60000;

/**
 * Звезда из картинки целиком: маска и сетка. Слишком рваная картинка
 * (шум в прозрачности) даёт много граней — тогда маска грубее, пока сетка
 * не влезет в одну геометрию игры. `null` — картинка пустая.
 */
export function arenaStarModel(rgba, width, height, options = {}) {
  for (const cells of [ARENA_STAR_CELLS, 72, 56, 40, 28]) {
    const mask = arenaStarMask(rgba, width, height, { cells });
    if (!mask) return null;
    const mesh = arenaStarMesh(mask, options);
    if (mesh.positions.length / 3 <= ARENA_STAR_MAX_VERTICES) return { mask, mesh };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Движение
 * ------------------------------------------------------------------ */

/* Секунд на цикл при скорости 1. */
const PERIOD = Object.freeze({ bounce: 1.2, spin: 6, levitate: 4 });
const FPS = 30;
const MAX_FRAMES = 360;

/**
 * Движение звезды: `{ kind, period, frames, at(t) → { lift, angle } }`.
 * `lift` — подъём над подставкой, м; `angle` — поворот вокруг Z, рад.
 * У «Стоит» — `period: 0`, `at` всегда ноль.
 */
export function arenaStarMotion({ animation = "none", speed = 1, height = 0.6 } = {}) {
  const kind = PERIOD[animation] ? animation : "none";
  if (kind === "none") return { kind, period: 0, frames: 0, at: () => ({ lift: 0, angle: 0 }) };
  const period = PERIOD[kind] / clamp(Number(speed) || 1, 0.05, 10);
  const rise = clamp(Number(height) || 0, 0, 10);
  const frames = Math.min(MAX_FRAMES, Math.max(2, Math.round(period * FPS))) + 1;
  const at = (time) => {
    const share = (((time / period) % 1) + 1) % 1;
    if (kind === "spin") return { lift: 0, angle: share * Math.PI * 2 };
    if (kind === "bounce") return { lift: rise * Math.sin(share * Math.PI), angle: 0 };
    return { lift: rise * (0.55 + 0.45 * Math.sin(share * Math.PI * 2)), angle: 0 };
  };
  return { kind, period, frames, at };
}

/** Кадры клипа: подъём и поворот на каждом из `frames` кадров цикла. */
export function arenaStarFrames(motion) {
  if (!motion.period) return null;
  const lift = [];
  const angle = [];
  for (let frame = 0; frame < motion.frames; frame += 1) {
    const sample = motion.at((frame / (motion.frames - 1)) * motion.period);
    lift.push(Math.round(sample.lift * 10000) / 10000);
    angle.push(Math.round(sample.angle * 100000) / 100000);
  }
  /* Последний кадр — снова начало цикла: клип играется по кругу без стыка. */
  if (motion.kind === "spin") angle[angle.length - 1] = Math.round(Math.PI * 2 * 100000) / 100000;
  else lift[lift.length - 1] = lift[0];
  return { duration: Math.round(motion.period * 10000) / 10000, lift, angle };
}

/**
 * Рамка звезды с движением: подъём — сверху, оборот — круг по самой
 * дальней точке. Двигается только фигура, но рамка одна на всю модель.
 */
export function arenaStarReach(mesh, motion) {
  let rise = 0;
  if (motion.period) for (let step = 0; step <= 64; step += 1) rise = Math.max(rise, motion.at((step / 64) * motion.period).lift);
  let radius = 0;
  for (let index = 0; index < mesh.positions.length; index += 3) radius = Math.max(radius, Math.hypot(mesh.positions[index], mesh.positions[index + 1]));
  const min = [...mesh.bounds.min];
  const max = [...mesh.bounds.max];
  if (motion.kind === "spin") {
    min[0] = Math.min(min[0], -radius);
    min[1] = Math.min(min[1], -radius);
    max[0] = Math.max(max[0], radius);
    max[1] = Math.max(max[1], radius);
  }
  max[2] += rise;
  return { min, max };
}
