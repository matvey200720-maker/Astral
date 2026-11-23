/*
 * Украшения столба фонаря — сетки, которые уезжают в модель игры.
 *
 * Владелец (ТЗ 10.10.2026, вечер): «добавить какие-то украшения, чтобы
 * вокруг столба крутились завитушечки». Украшение — новая геометрия в самой
 * модели фонаря (как цветы и брелоки на стволах оружия): одна правленая
 * модель — и каждый такой фонарь на острове украшен. Сетки строятся здесь, в
 * осях модели (Z вверх, метры), вокруг столба, найденного по самой модели
 * (`pole-shape.js`): кадр редактора рисует ту же сетку, что уедет в игру.
 *
 * Виды — от спирали и гирлянды до кованых завитков и звёзд. У каждого две
 * роли частей: «тело» (провод, стебель, листья) — шейдер `default`, и
 * «огоньки» (лампочки, звёзды, неон) — шейдер `emissive`, когда свечение
 * включено. Цвет частей — клетка листа 32×32 (4×4 клетки по 8×8 точек): лист
 * общий на все части, и даже уменьшенный до 4×4 он не смешивает цвета.
 *
 * ДВИЖЕНИЯ НЕТ. Украшение — часть модели столба и в игре стоит на месте.
 * Вращение в GTA V делает клип анимации кости со словарём клипов у
 * архетипа; у фонарей это фрагменты с физикой (их сбивают машины), и клип на
 * каждом из 16 000 столбов без проверки в самой игре — риск вылета. Поэтому
 * «крутятся» здесь — форма (спираль, завитки, кольца), а движение у ламп
 * дают частицы.
 *
 * Уровни детализации: у фонаря модель вблизи (`high`), на средней
 * дистанции (`medium`) и вдали (`low`) — у каждой своя сетка украшения, чем
 * дальше — тем меньше граней, но та же форма, чтобы украшение не пропадало,
 * отъехав на двадцать метров.
 */

import { poleRadiusAt } from "./pole-shape.js";

const TAU = Math.PI * 2;

export const DECOR_KINDS = Object.freeze([
  kind("spiral", "Спираль", "Витая трубка вокруг столба", "Витков"),
  kind("garland", "Гирлянда", "Лампочки на проводе по спирали", "Витков"),
  kind("ribbon", "Лента", "Две полосы, как у леденца", "Витков"),
  kind("vine", "Лоза", "Стебель с листьями и бутонами", "Витков"),
  kind("curls", "Завитки", "Кованые завитушки по бокам", "Завитков"),
  kind("stars", "Звёзды", "Звёздочки по спирали", "Звёзд"),
  kind("rings", "Кольца", "Неоновые обручи на столбе", "Колец"),
]);

function kind(id, label, description, countLabel) {
  return Object.freeze({ id, label, description, countLabel });
}

export const DECOR_KIND_IDS = Object.freeze(DECOR_KINDS.map((item) => item.id));
export const DEFAULT_DECOR_KIND = "spiral";

export function decorKind(id) {
  return DECOR_KINDS.find((item) => item.id === id) || DECOR_KINDS[0];
}

/* Пределы украшения: проценты и штуки. */
export const DECOR_LIMITS = Object.freeze({
  size: Object.freeze([50, 200]),
  glow: Object.freeze([0, 400]),
  turns: Object.freeze([2, 14]),
  height: Object.freeze([25, 100]),
});

/* Виды, у которых огоньки умеют «радугу» — по кругу семь цветов спектра. */
export const DECOR_RAINBOW_KINDS = Object.freeze(["garland", "stars", "rings", "vine"]);

/*
 * Свечение огоньков в игре: множитель `emissive` шейдера. 100 % — 4 (как у
 * подсветки вывесок), 400 % — 16 (как стекло лампы фонаря).
 */
export const DECOR_EMISSIVE_PER_PERCENT = 0.04;

export function decorEmissive(glow) {
  return Math.round(Math.max(0, Number(glow) || 0) * DECOR_EMISSIVE_PER_PERCENT * 100) / 100;
}

/* ---------------------------- лист цветов ---------------------------- */

export const DECOR_ATLAS = Object.freeze({ size: 32, cell: 8, columns: 4 });
export const DECOR_TEXTURE = "astral_pole_decor";

/* Клетки листа. */
const CELL = Object.freeze({ colour: 0, accent: 1, wire: 2, leaf: 3, white: 4, rainbow: 8 });
export const DECOR_RAINBOW = Object.freeze(["#FF3B3B", "#FF9A1F", "#FFE01F", "#3BFF6B", "#2EE6FF", "#4C7DFF", "#C25CFF"]);
const WIRE = "#1E2124";

const hexRgb = (hex) => {
  const value = String(hex || "#FFFFFF").replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) || 0);
};

/** Цвет клетки листа по украшению: `#RRGGBB`. */
export function decorCellColour(decor, cell) {
  if (cell === CELL.colour) return decor.colour;
  if (cell === CELL.accent) return decor.accent;
  if (cell === CELL.wire) return WIRE;
  if (cell === CELL.leaf) return decor.colour;
  if (cell === CELL.white) return "#FFFFFF";
  if (cell >= CELL.rainbow && cell < CELL.rainbow + DECOR_RAINBOW.length) return DECOR_RAINBOW[cell - CELL.rainbow];
  return "#FFFFFF";
}

/** Центр клетки в развёртке (u, v): начало — левый верхний угол. */
export function decorCellUv(cell) {
  const { size, cell: edge, columns } = DECOR_ATLAS;
  const column = cell % columns;
  const row = Math.floor(cell / columns);
  return [(column * edge + edge / 2) / size, (row * edge + edge / 2) / size];
}

/** Лист цветов украшения: `{ width, height, rgba }`, все клетки залиты ровно. */
export function decorAtlas(decor) {
  const { size, cell: edge, columns } = DECOR_ATLAS;
  const rgba = new Uint8Array(size * size * 4);
  for (let cell = 0; cell < columns * columns; cell += 1) {
    const [r, g, b] = hexRgb(decorCellColour(decor, cell));
    const x0 = (cell % columns) * edge;
    const y0 = Math.floor(cell / columns) * edge;
    for (let y = y0; y < y0 + edge; y += 1)
      for (let x = x0; x < x0 + edge; x += 1) {
        const at = (y * size + x) * 4;
        rgba[at] = r;
        rgba[at + 1] = g;
        rgba[at + 2] = b;
        rgba[at + 3] = 255;
      }
  }
  return { width: size, height: size, rgba };
}

/* ------------------------------ сетки ------------------------------ */

/* Сколько граней на уровне детализации. */
export const DECOR_LODS = Object.freeze(["high", "medium", "low"]);
const QUALITY = Object.freeze({
  high: Object.freeze({ perTurn: 28, sides: 6, sphere: [5, 8], torus: 22, leaf: 6 }),
  medium: Object.freeze({ perTurn: 14, sides: 4, sphere: [3, 6], torus: 12, leaf: 4 }),
  low: Object.freeze({ perTurn: 8, sides: 3, sphere: [2, 4], torus: 8, leaf: 3 }),
});
/* Предел вершин части украшения на уровне — с запасом под 16-битные индексы
   и хост (`LampPoleCommands.cs`). */
export const DECOR_MAX_VERTICES = Object.freeze({ high: 9000, medium: 4000, low: 1600 });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

function builder() {
  const positions = [];
  const normals = [];
  const cells = [];
  const indices = [];
  return {
    positions,
    normals,
    cells,
    indices,
    vertex(p, n, cell) {
      positions.push(p[0], p[1], p[2]);
      const u = unit(n);
      normals.push(u[0], u[1], u[2]);
      cells.push(cell);
      return cells.length - 1;
    },
    /* Треугольник лицом туда, куда смотрят нормали его вершин (как у
       украшений оружия, проверенных в игре): обход против часовой стрелки
       со стороны лица. */
    face(a, b, c) {
      const at = (index) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
      const n = cross(sub(at(b), at(a)), sub(at(c), at(a)));
      let facing = 0;
      for (const index of [a, b, c])
        facing += n[0] * normals[index * 3] + n[1] * normals[index * 3 + 1] + n[2] * normals[index * 3 + 2];
      if (facing < 0) indices.push(a, c, b);
      else indices.push(a, b, c);
    },
  };
}

/* Трубка по ломаной: кольца граней с переносом рамки вдоль пути. */
function tube(mesh, path, radius, sides, cell) {
  if (path.length < 2) return;
  const rings = [];
  let normal = null;
  for (let index = 0; index < path.length; index += 1) {
    const prev = path[Math.max(0, index - 1)];
    const next = path[Math.min(path.length - 1, index + 1)];
    const tangent = unit(sub(next, prev));
    if (!normal) {
      const helper = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      normal = unit(cross(tangent, helper));
    } else normal = unit(sub(normal, scale(tangent, dot(normal, tangent))));
    const binormal = cross(tangent, normal);
    const ring = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * TAU;
      const n = add(scale(normal, Math.cos(angle)), scale(binormal, Math.sin(angle)));
      ring.push(mesh.vertex(add(path[index], scale(n, radius)), n, cell));
    }
    rings.push(ring);
  }
  for (let index = 0; index < rings.length - 1; index += 1)
    for (let side = 0; side < sides; side += 1) {
      const a = rings[index][side];
      const b = rings[index + 1][side];
      const c = rings[index + 1][(side + 1) % sides];
      const d = rings[index][(side + 1) % sides];
      mesh.face(a, b, c);
      mesh.face(a, c, d);
    }
}

/* Шар (лампочка, ягода): кольца по широте, полюса — вершинами. */
function sphere(mesh, centre, radius, [rings, segments], cell, stretch = 1) {
  const top = mesh.vertex(add(centre, [0, 0, radius * stretch]), [0, 0, 1], cell);
  const bottom = mesh.vertex(add(centre, [0, 0, -radius * stretch]), [0, 0, -1], cell);
  const grid = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const phi = (ring / (rings + 1)) * Math.PI;
    const row = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (segment / segments) * TAU;
      const n = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
      row.push(mesh.vertex(add(centre, [n[0] * radius, n[1] * radius, n[2] * radius * stretch]), n, cell));
    }
    grid.push(row);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    mesh.face(top, grid[0][segment], grid[0][next]);
    mesh.face(bottom, grid[rings - 1][next], grid[rings - 1][segment]);
  }
  for (let ring = 0; ring < rings - 1; ring += 1)
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      mesh.face(grid[ring][segment], grid[ring + 1][segment], grid[ring + 1][next]);
      mesh.face(grid[ring][segment], grid[ring + 1][next], grid[ring][next]);
    }
}

/* Тор вокруг вертикальной оси: обруч на столбе. */
function torus(mesh, centre, major, minor, segments, sides, cell) {
  const grid = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * TAU;
    const radial = [Math.cos(a), Math.sin(a), 0];
    const ring = [];
    for (let j = 0; j < sides; j += 1) {
      const b = (j / sides) * TAU;
      const n = [radial[0] * Math.cos(b), radial[1] * Math.cos(b), Math.sin(b)];
      ring.push(mesh.vertex(add(centre, add(scale(radial, major), scale(n, minor))), n, cell));
    }
    grid.push(ring);
  }
  for (let i = 0; i < segments; i += 1)
    for (let j = 0; j < sides; j += 1) {
      const a = grid[i][j];
      const b = grid[(i + 1) % segments][j];
      const c = grid[(i + 1) % segments][(j + 1) % sides];
      const d = grid[i][(j + 1) % sides];
      mesh.face(a, b, c);
      mesh.face(a, c, d);
    }
}

/*
 * Выдавленная звезда: лицо к `outward`, вверх — `up`. Пять лучей, лицо и
 * изнанка плоские, бока — по контуру.
 */
function star(mesh, centre, outward, up, outer, inner, thickness, cell, walls = true) {
  const side = unit(cross(up, outward));
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = Math.PI / 2 + (index / 10) * TAU;
    const radius = index % 2 === 0 ? outer : inner;
    points.push(add(scale(side, Math.cos(angle) * radius), scale(up, Math.sin(angle) * radius)));
  }
  const half = thickness / 2;
  const front = add(centre, scale(outward, half));
  const back = add(centre, scale(outward, -half));
  const frontCentre = mesh.vertex(front, outward, cell);
  const backCentre = mesh.vertex(back, scale(outward, -1), cell);
  const frontRing = points.map((point) => mesh.vertex(add(front, point), outward, cell));
  const backRing = points.map((point) => mesh.vertex(add(back, point), scale(outward, -1), cell));
  for (let index = 0; index < 10; index += 1) {
    const next = (index + 1) % 10;
    mesh.face(frontCentre, frontRing[index], frontRing[next]);
    mesh.face(backCentre, backRing[next], backRing[index]);
    if (!walls) continue;
    /* Бок смотрит от центра звезды наружу. */
    let edge = unit(cross(sub(points[next], points[index]), outward));
    if (dot(edge, add(points[index], points[next])) < 0) edge = scale(edge, -1);
    const a = mesh.vertex(add(front, points[index]), edge, cell);
    const b = mesh.vertex(add(front, points[next]), edge, cell);
    const c = mesh.vertex(add(back, points[next]), edge, cell);
    const d = mesh.vertex(add(back, points[index]), edge, cell);
    mesh.face(a, d, c);
    mesh.face(a, c, b);
  }
}

/* Лист лозы: овал из веера, двусторонний, чуть выгнутый наружу. */
function leaf(mesh, base, along, outward, length, width, segments, cell) {
  const across = unit(cross(along, outward));
  const outline = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const w = Math.sin(t * Math.PI) * width * 0.5;
    const bulge = Math.sin(t * Math.PI) * length * 0.12;
    outline.push({ t, w, bulge });
  }
  for (const facing of [1, -1]) {
    const n = scale(outward, facing);
    const tip = mesh.vertex(add(base, scale(along, length)), n, cell);
    const root = mesh.vertex(base, n, cell);
    let previousLeft = root;
    let previousRight = root;
    for (let index = 1; index < segments; index += 1) {
      const { t, w, bulge } = outline[index];
      const centre = add(add(base, scale(along, length * t)), scale(outward, bulge));
      const left = mesh.vertex(add(centre, scale(across, w)), n, cell);
      const right = mesh.vertex(add(centre, scale(across, -w)), n, cell);
      mesh.face(previousLeft, left, right);
      mesh.face(previousLeft, right, previousRight);
      previousLeft = left;
      previousRight = right;
    }
    mesh.face(previousLeft, tip, previousRight);
  }
}

/* ----------------------------- форма ----------------------------- */

/*
 * Где украшение на столбе: от низа (над основанием и не ниже 35 см от
 * земли) до верха (под консолью) — доля `height` этого отрезка. `null` —
 * столб слишком короткий.
 */
export function decorSpan(profile, decor) {
  if (!profile) return null;
  const bottom = Math.max(profile.bottom, (profile.ground ?? 0) + 0.35) + 0.08;
  const top = profile.top - 0.12;
  if (!(top - bottom > 0.6)) return null;
  const share = Math.min(100, Math.max(DECOR_LIMITS.height[0], Number(decor?.height) || 100)) / 100;
  return { z0: bottom, z1: bottom + (top - bottom) * share };
}

/*
 * Радиус столба для украшения: срезы со сглаживанием (медиана по пяти) и в
 * пределах ±40 % от обычного — обвивка не скачет на хомутах и утолщениях.
 */
function smoothRadius(profile) {
  const rows = profile.profile || [];
  const base = profile.radius || 0.1;
  const smooth = rows.map(([z], index) => {
    const window = rows.slice(Math.max(0, index - 2), index + 3).map(([, r]) => r).sort((a, b) => a - b);
    const value = window[Math.floor(window.length / 2)];
    return [z, Math.min(base * 1.4, Math.max(base * 0.7, value))];
  });
  const shape = { ...profile, profile: smooth };
  return (z) => poleRadiusAt(shape, z);
}

/* Спиральный путь вокруг столба: `gap` — зазор от поверхности. */
function helix(profile, span, turns, perTurn, gap, phase = 0) {
  const radius = smoothRadius(profile);
  const [ax, ay] = profile.axis;
  const count = Math.max(4, Math.ceil(turns * perTurn));
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const z = span.z0 + (span.z1 - span.z0) * t;
    const angle = phase + TAU * turns * t;
    const r = radius(z) + gap;
    points.push([ax + Math.cos(angle) * r, ay + Math.sin(angle) * r, z]);
  }
  return points;
}

const pathLength = (points) => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(...sub(points[index], points[index - 1]));
  return length;
};

/* Точка на ломаной по доле длины и направление пути там. */
function along(points, share) {
  const total = pathLength(points);
  let target = total * share;
  for (let index = 1; index < points.length; index += 1) {
    const step = Math.hypot(...sub(points[index], points[index - 1]));
    if (target <= step || index === points.length - 1) {
      const t = step > 0 ? Math.min(1, target / step) : 0;
      return {
        point: add(points[index - 1], scale(sub(points[index], points[index - 1]), t)),
        tangent: unit(sub(points[index], points[index - 1])),
      };
    }
    target -= step;
  }
  return { point: points[0], tangent: [0, 0, 1] };
}

/* Огонёк по счёту: два цвета через один или радуга по кругу. */
const glowCell = (decor, index) =>
  decor.rainbow && DECOR_RAINBOW_KINDS.includes(decor.kind)
    ? CELL.rainbow + (index % DECOR_RAINBOW.length)
    : index % 2 === 0
      ? CELL.colour
      : CELL.accent;

/**
 * Сетки украшения на уровне детализации: `{ body, glow }` — части без
 * свечения и огоньки (`null`, если части нет). Каждая — `{ positions,
 * normals, uvs, indices, cells }` в осях модели. `profile` — столб модели
 * (`poleProfile`), `decor` — украшение работы (нормализованное).
 */
export function decorMeshes(decor, profile, lod = "high") {
  const quality = QUALITY[lod] || QUALITY.high;
  const span = decorSpan(profile, decor);
  if (!span || !decor?.on) return { body: null, glow: null };
  const s = (Number(decor.size) || 100) / 100;
  const turns = Math.round(Number(decor.turns) || 6);
  const glows = (Number(decor.glow) || 0) > 0;
  const body = builder();
  const lights = builder();
  /* Часть «тела» светится вместе с огоньками у спирали, ленты, завитков. */
  const lit = glows ? lights : body;
  const [ax, ay] = profile.axis;
  const radius = smoothRadius(profile);

  switch (decor.kind) {
    case "garland": {
      const wire = helix(profile, span, turns, quality.perTurn, 0.035 * s);
      if (lod !== "low") tube(body, wire, 0.005 * s, Math.max(3, quality.sides - 2), CELL.wire);
      const count = Math.min(90, Math.max(6, Math.round(pathLength(wire) / (0.34 * s))));
      for (let index = 0; index < count; index += 1) {
        const { point } = along(wire, (index + 0.5) / count);
        const outward = unit([point[0] - ax, point[1] - ay, 0]);
        const centre = add(point, add(scale(outward, 0.02 * s), [0, 0, -0.03 * s]));
        sphere(glows ? lights : body, centre, 0.032 * s, quality.sphere, glowCell(decor, index), 1.3);
      }
      break;
    }
    case "ribbon": {
      /* Две полосы через полвитка: основной цвет и второй — леденец. */
      const width = 0.075 * s;
      const count = Math.max(4, Math.ceil(turns * quality.perTurn));
      for (const [stripe, cell] of [
        [0, CELL.colour],
        [Math.PI, CELL.accent],
      ]) {
        let previous = null;
        for (let index = 0; index <= count; index += 1) {
          const t = index / count;
          const z = span.z0 + (span.z1 - span.z0) * t;
          const angle = stripe + TAU * turns * t;
          const outward = [Math.cos(angle), Math.sin(angle), 0];
          const lower = z - width / 2;
          const upper = z + width / 2;
          const at = (height) => {
            const r = radius(height) + 0.006;
            return [ax + outward[0] * r, ay + outward[1] * r, height];
          };
          const pair = [lit.vertex(at(lower), outward, cell), lit.vertex(at(upper), outward, cell)];
          if (previous) {
            lit.face(previous[0], pair[0], pair[1]);
            lit.face(previous[0], pair[1], previous[1]);
          }
          previous = pair;
        }
      }
      break;
    }
    case "vine": {
      const stem = helix(profile, span, turns, quality.perTurn, 0.022 * s);
      tube(body, stem, 0.009 * s, Math.max(3, quality.sides - 1), CELL.leaf);
      const count = Math.min(70, Math.max(6, Math.round(pathLength(stem) / (0.2 * s))));
      for (let index = 0; index < count; index += 1) {
        const { point, tangent } = along(stem, (index + 0.5) / count);
        const outward = unit([point[0] - ax, point[1] - ay, 0]);
        const sideways = unit(cross(outward, tangent));
        const direction = unit(add(scale(sideways, index % 2 === 0 ? 1 : -1), scale(outward, 0.45)));
        const surface = unit(cross(direction, cross(outward, direction)));
        leaf(body, point, direction, surface, 0.11 * s, 0.06 * s, quality.leaf, CELL.leaf);
        if (index % 3 === 1 && lod !== "low")
          sphere(glows ? lights : body, add(point, scale(outward, 0.035 * s)), 0.022 * s, quality.sphere, glowCell(decor, index), 1);
      }
      break;
    }
    case "curls": {
      /* Группа — два завитка в вертикальной плоскости от столба: верхний
         закручен вверх, нижний — его зеркало, как кованая лира. */
      const count = Math.max(2, turns);
      const steps = lod === "low" ? 10 : lod === "medium" ? 16 : 28;
      for (let group = 0; group < count; group += 1) {
        const t = count === 1 ? 0.5 : group / (count - 1);
        const zc = span.z0 + 0.3 * s + (span.z1 - span.z0 - 0.6 * s) * t;
        const azimuth = group * 2.39996;
        const outward = [Math.cos(azimuth), Math.sin(azimuth), 0];
        const r = radius(zc);
        for (const flip of [1, -1]) {
          const path = [];
          const size = 0.14 * s;
          for (let step = 0; step <= steps; step += 1) {
            const u = step / steps;
            const angle = Math.PI + u * 2.4 * Math.PI;
            const rho = size * (1 - 0.78 * u);
            const x = size + Math.cos(angle) * rho;
            const y = 0.06 * s + Math.sin(angle) * rho;
            path.push([ax + outward[0] * (r + x), ay + outward[1] * (r + x), zc + flip * y]);
          }
          tube(lit, path, 0.013 * s, Math.max(3, quality.sides - 1), CELL.colour);
        }
      }
      break;
    }
    case "stars": {
      const count = Math.max(2, turns * 2);
      const path = helix(profile, span, Math.max(1, turns / 2), quality.perTurn, 0.07 * s);
      for (let index = 0; index < count; index += 1) {
        const { point } = along(path, (index + 0.5) / count);
        const outward = unit([point[0] - ax, point[1] - ay, 0]);
        star(glows ? lights : body, point, outward, [0, 0, 1], 0.08 * s, 0.034 * s, 0.018 * s, glowCell(decor, index), lod !== "low");
      }
      break;
    }
    case "rings": {
      const count = Math.max(2, turns);
      for (let index = 0; index < count; index += 1) {
        const t = count === 1 ? 0.5 : index / (count - 1);
        const z = span.z0 + (span.z1 - span.z0) * t;
        const major = radius(z) + 0.02 + 0.025 * s;
        torus(
          glows ? lights : body,
          [ax, ay, z],
          major,
          0.016 * s,
          quality.torus,
          Math.max(3, quality.sides - 1),
          glowCell(decor, index),
        );
      }
      break;
    }
    default: {
      const path = helix(profile, span, turns, quality.perTurn, 0.04 * s);
      tube(lit, path, 0.014 * s, quality.sides, CELL.colour);
    }
  }
  return { body: finish(body, lod), glow: finish(lights, lod) };
}

function finish(mesh, lod) {
  const count = mesh.cells.length;
  if (!count) return null;
  if (count > DECOR_MAX_VERTICES[lod]) throw new RangeError(`Украшение вышло на ${count} вершин — больше ${DECOR_MAX_VERTICES[lod]}.`);
  const uvs = new Float32Array(count * 2);
  mesh.cells.forEach((cell, index) => {
    const [u, v] = decorCellUv(cell);
    uvs[index * 2] = u;
    uvs[index * 2 + 1] = v;
  });
  return {
    positions: Float32Array.from(mesh.positions),
    normals: Float32Array.from(mesh.normals),
    uvs,
    indices: Uint16Array.from(mesh.indices),
    cells: Uint8Array.from(mesh.cells),
    vertices: count,
  };
}

/** Рамка всех сеток уровня: `{ min, max }` или `null`. */
export function decorBounds(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of [meshes?.body, meshes?.glow]) {
    if (!mesh) continue;
    for (let at = 0; at < mesh.positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[at + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[at + axis]);
      }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}
