/*
 * Новые украшения у точки (задача 6 ТЗ 17.10.2026): банты, ленты, шипы,
 * снежинка и ёлочные брелоки — колокольчик и шар.
 *
 * Владелец 17.10: «пополнить список разными украшениями, чтобы люди могли
 * редактировать у них цвет в том числе, новогодние ленты и т.д.». У каждого
 * — основной цвет и второй (`accent`): у банта — узелок, у ленты — кайма, у
 * шипов — ремешок, у снежинки — середина, у брелоков — колпачок, колечко и
 * цепочка.
 *
 * Оси — как у остальных украшений у точки (`decorationFrame`): начало — точка
 * на поверхности, z — нормаль наружу, y — «вверх» модели в плоскости
 * поверхности; единица — размер украшения. Всё лежит в шаре радиуса 1 вокруг
 * точки: украшение не уходит дальше своего размера.
 */

import { ACCENT, MAIN, TAU, WHITE, add, cross, facet, pipe, prism, scale, sphere, sub, unit } from "./decoration-shapes.js";

const oriented4 = (mesh, a, b, c, d) => {
  const at = (index) => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
  const n = cross(sub(at(b), at(a)), sub(at(c), at(a)));
  const facing = n[0] * mesh.normals[a * 3] + n[1] * mesh.normals[a * 3 + 1] + n[2] * mesh.normals[a * 3 + 2];
  if (facing < 0) {
    mesh.triangle(a, c, b);
    mesh.triangle(a, d, c);
  } else {
    mesh.triangle(a, b, c);
    mesh.triangle(a, c, d);
  }
};

/*
 * Лента по пути: в каждой точке — поперечник `across(i)` шириной `width(i)`,
 * нормаль `normal(i)`; лицо и изнанка — своими вершинами. Поперёк — четыре
 * столбца: края (`edge`) и середина (`middle`) — у ленты кайма вторым цветом.
 */
function ribbonAlong(mesh, path, { across, normal, width, middle, edge, closed = false }) {
  const columns = [-1, -0.62, 0.62, 1];
  for (const facing of [1, -1]) {
    const ids = path.map((point, index) => {
      const half = width(index) / 2;
      const n = scale(normal(index), facing);
      return columns.map((s) => mesh.vertex(add(point, scale(across(index), s * half)), n, Math.abs(s) > 0.9 ? edge(index) : middle(index)));
    });
    const rows = closed ? path.length : path.length - 1;
    for (let row = 0; row < rows; row += 1) {
      const next = (row + 1) % path.length;
      for (let col = 0; col < columns.length - 1; col += 1) oriented4(mesh, ids[row][col], ids[next][col], ids[next][col + 1], ids[row][col + 1]);
    }
  }
}

/* Тело вращения вокруг оси `axis` через `base`: профиль `[радиус, высота]` снизу вверх. */
function lathe(mesh, { base, axis, profile, segments = 12, uv }) {
  const z = unit(axis);
  const x = unit(cross(z, Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const y = cross(z, x);
  const rings = profile.map(([radius, height], index) => {
    const prev = profile[Math.max(0, index - 1)];
    const next = profile[Math.min(profile.length - 1, index + 1)];
    /* Нормаль профиля: перпендикуляр к его касательной, наружу. */
    const dr = next[0] - prev[0];
    const dh = next[1] - prev[1];
    const length = Math.hypot(dr, dh) || 1;
    const nr = dh / length;
    const nh = -dr / length;
    const ring = [];
    for (let k = 0; k < segments; k += 1) {
      const angle = (k / segments) * TAU;
      const radial = add(scale(x, Math.cos(angle)), scale(y, Math.sin(angle)));
      const point = add(add(base, scale(z, height)), scale(radial, radius));
      ring.push(mesh.vertex(point, add(scale(radial, nr), scale(z, nh)), typeof uv === "function" ? uv(index / Math.max(1, profile.length - 1)) : uv));
    }
    return ring;
  });
  for (let index = 0; index < rings.length - 1; index += 1)
    for (let k = 0; k < segments; k += 1) {
      const next = (k + 1) % segments;
      oriented4(mesh, rings[index][k], rings[index + 1][k], rings[index + 1][next], rings[index][next]);
    }
}

/* Коробка по углам: шесть граней с плоскими нормалями. */
function box(mesh, min, max, uv) {
  const p = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
  const quads = [
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)],
    [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
  ];
  for (const [a, b, c, d] of quads) {
    facet(mesh, a, b, c, uv);
    facet(mesh, a, c, d, uv);
  }
}

/* --------------------------------- бант --------------------------------- */

/*
 * Бант: две петли (лента шириной вдоль нормали — видно её ребро и просвет
 * петли), узелок посередине и два хвоста с вырезом «ласточкой».
 */
export function bowMesh(mesh, lod = "high") {
  const steps = lod === "low" ? 14 : 28;
  const lift = 0.12;
  const width = 0.17;
  for (const side of [-1, 1]) {
    /* Петля-капля: эллипс, стянутый к середине банта. */
    const path = [];
    const normals = [];
    for (let k = 0; k < steps; k += 1) {
      const t = (k / steps) * TAU;
      const ex = side * (0.25 + 0.23 * Math.cos(t));
      const ey = 0.03 + 0.17 * Math.sin(t);
      const pull = Math.max(0, -Math.cos(t)) ** 3 * 0.72;
      const point = [ex * (1 - pull), ey * (1 - pull) + 0.04 * pull, lift];
      path.push(point);
      normals.push(unit([Math.cos(t) * side * 0.17, Math.sin(t) * 0.23, 0], [side, 0, 0]));
    }
    ribbonAlong(mesh, path, {
      across: () => [0, 0, 1],
      normal: (index) => normals[index],
      width: () => width,
      middle: (index) => MAIN(0.45 + 0.5 * (normals[index][1] * 0.5 + 0.5)),
      edge: (index) => MAIN(0.3 + 0.5 * (normals[index][1] * 0.5 + 0.5)),
      closed: true,
    });
    /* Хвост: вниз и в сторону, с волной; конец — ласточкой. */
    const tail = [];
    const rows = lod === "low" ? 4 : 8;
    for (let k = 0; k <= rows; k += 1) {
      const t = k / rows;
      tail.push([side * (0.04 + 0.26 * t), -0.04 - 0.62 * t, lift - 0.02 + 0.03 * Math.sin(t * Math.PI * 1.5)]);
    }
    const direction = unit(sub(tail.at(-1), tail[0]));
    const across = unit(cross([0, 0, 1], direction));
    ribbonAlong(mesh, tail, {
      across: () => across,
      normal: () => [0, 0, 1],
      width: (index) => 0.15 + 0.03 * (index / rows),
      middle: (index) => MAIN(0.55 + 0.35 * (1 - index / rows)),
      edge: () => MAIN(0.4),
    });
    /* Вырез: тёмный треугольник поверх конца ленты. */
    const end = tail.at(-1);
    facet(mesh, add(end, add(scale(across, -0.08), [0, 0, 0.002])), add(end, add(scale(direction, -0.09), [0, 0, 0.002])), add(end, add(scale(across, 0.08), [0, 0, 0.002])), MAIN(0.15), { double: true });
  }
  sphere(mesh, [0, 0.03, lift], 0.085, { rings: lod === "low" ? 2 : 4, segments: lod === "low" ? 6 : 10, uv: ACCENT, stretch: 0.8, axis: [0, 0, 1] });
}

/* --------------------------------- лента -------------------------------- */

/* Серпантин: лента спиралью вниз от точки, лицом наружу от оси спирали. */
function curlMesh(mesh, lod) {
  const steps = lod === "low" ? 28 : 64;
  const turns = 3.2;
  const path = [];
  const outward = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const angle = t * turns * TAU;
    const radius = 0.13 * (1 - 0.35 * t);
    const radial = [Math.cos(angle), 0, Math.sin(angle)];
    path.push([radial[0] * radius, -0.05 - 0.78 * t, 0.2 + radial[2] * radius]);
    outward.push(radial);
  }
  ribbonAlong(mesh, path, {
    across: () => [0, 1, 0],
    normal: (index) => outward[index],
    width: () => 0.09,
    middle: (index) => MAIN(0.5 + 0.45 * (outward[index][2] * 0.5 + 0.5)),
    edge: () => ACCENT,
  });
  /* Узелок, которым лента держится. */
  sphere(mesh, [0, -0.02, 0.09], 0.06, { rings: 2, segments: 6, uv: ACCENT });
}

/* Лента-волна: лежит по поверхности вдоль оси x, концы — ласточкой. */
function waveMesh(mesh, lod) {
  const steps = lod === "low" ? 12 : 30;
  const path = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    path.push([-0.82 + 1.64 * t, 0.12 * Math.sin(t * TAU * 1.25), 0.03 + 0.025 * Math.sin(t * TAU * 2.5)]);
  }
  ribbonAlong(mesh, path, {
    across: (index) => {
      const next = path[Math.min(steps, index + 1)];
      const prev = path[Math.max(0, index - 1)];
      return unit(cross([0, 0, 1], sub(next, prev)));
    },
    normal: () => [0, 0, 1],
    width: () => 0.22,
    middle: (index) => MAIN(0.55 + 0.35 * Math.sin((index / steps) * TAU * 2.5)),
    edge: () => ACCENT,
  });
}

export function ribbonMesh(mesh, variant, lod = "high") {
  if (variant === "wave") waveMesh(mesh, lod);
  else curlMesh(mesh, lod);
}

/* --------------------------------- шипы --------------------------------- */

/* Ряд шипов (или заклёпок) на ремешке вдоль оси x. */
export function spikeMesh(mesh, variant, lod = "high") {
  const count = 5;
  box(mesh, [-0.5, -0.1, 0], [0.5, 0.1, 0.05], ACCENT);
  const sides = lod === "low" ? 6 : 12;
  for (let k = 0; k < count; k += 1) {
    const x = -0.4 + (0.8 * k) / (count - 1);
    if (variant === "studs") {
      /* Заклёпка-пирамидка: четыре грани с острой вершиной. */
      const h = 0.1;
      const s = 0.075;
      const top = [x, 0, 0.05 + h];
      const base = [
        [x - s, -s, 0.05],
        [x + s, -s, 0.05],
        [x + s, s, 0.05],
        [x - s, s, 0.05],
      ];
      for (let edge = 0; edge < 4; edge += 1) facet(mesh, base[edge], base[(edge + 1) % 4], top, [MAIN(0.35), MAIN(0.7), MAIN(1)]);
    } else {
      lathe(mesh, {
        base: [x, 0, 0.05],
        axis: [0, 0, 1],
        profile: [
          [0.075, 0],
          [0.06, 0.08],
          [0.03, 0.2],
          [0.002, 0.3],
        ],
        segments: sides,
        uv: (t) => MAIN(0.45 + 0.5 * t),
      });
    }
  }
}

/* ------------------------------- снежинка ------------------------------- */

/* Плоская снежинка: шесть лучей с веточками, середина — вторым цветом. */
export function snowflakeMesh(mesh, { centre = [0, 0, 0.02], radius = 0.5, depth = 0.045, lod = "high" } = {}) {
  const bar = (from, to, width) => {
    const direction = unit(sub(to, from));
    const side = [-direction[1] * width, direction[0] * width];
    const outline = [
      [from[0] - side[0], from[1] - side[1]],
      [to[0] - side[0], to[1] - side[1]],
      [to[0] + side[0], to[1] + side[1]],
      [from[0] + side[0], from[1] + side[1]],
    ];
    prism(mesh, { outline: outline.map(([x, y]) => [x, y]), centre: [centre[0], centre[1], centre[2]], depth, uv: MAIN(0.85), sideUv: MAIN(0.55) });
  };
  for (let arm = 0; arm < 6; arm += 1) {
    const angle = Math.PI / 2 + (arm / 6) * TAU;
    const along = [Math.cos(angle), Math.sin(angle), 0];
    bar([0, 0, 0], scale(along, radius), radius * 0.07);
    if (lod === "low") continue;
    for (const [at, length] of [
      [0.42, 0.3],
      [0.68, 0.22],
    ])
      for (const turn of [-1, 1]) {
        const branch = angle + turn * (Math.PI / 4);
        const start = scale(along, radius * at);
        bar(start, add(start, scale([Math.cos(branch), Math.sin(branch), 0], radius * length)), radius * 0.05);
      }
  }
  /* Середина — шестигранник вторым цветом. */
  const hex = Array.from({ length: 6 }, (_, k) => [Math.cos((k / 6) * TAU) * radius * 0.2, Math.sin((k / 6) * TAU) * radius * 0.2]);
  prism(mesh, { outline: hex, centre: [centre[0], centre[1], centre[2] + depth * 0.4], depth: depth * 1.2, uv: ACCENT, sideUv: ACCENT });
}

/* ------------------------------- брелоки ------------------------------- */

/* Колокольчик: купол вращением вниз от колечка и язычок. */
export function bellMesh(mesh, centre, lod = "high") {
  const segments = lod === "low" ? 8 : 16;
  lathe(mesh, {
    base: add(centre, [0, 0.16, 0]),
    axis: [0, -1, 0],
    profile: [
      [0.002, -0.02],
      [0.06, 0],
      [0.1, 0.05],
      [0.12, 0.14],
      [0.15, 0.24],
      [0.22, 0.32],
      [0.23, 0.34],
    ],
    segments,
    uv: (t) => MAIN(0.95 - 0.5 * t),
  });
  /* Изнанка купола — темнее: колокол виден снизу пустым. */
  lathe(mesh, {
    base: add(centre, [0, 0.16, 0]),
    axis: [0, -1, 0],
    profile: [
      [0.2, 0.34],
      [0.13, 0.25],
      [0.09, 0.14],
      [0.05, 0.06],
      [0.002, 0.04],
    ],
    segments,
    uv: MAIN(0.15),
  });
  sphere(mesh, add(centre, [0, -0.16, 0]), 0.05, { rings: lod === "low" ? 2 : 3, segments: lod === "low" ? 5 : 8, uv: ACCENT });
}

/* Ёлочный шар: шар, колпачок вторым цветом и блик. */
export function ballMesh(mesh, centre, lod = "high") {
  sphere(mesh, centre, 0.21, { rings: lod === "low" ? 4 : 8, segments: lod === "low" ? 8 : 16, uv: MAIN(0.78) });
  pipe(mesh, [add(centre, [0, 0.18, 0]), add(centre, [0, 0.26, 0])], { radius: 0.055, sides: lod === "low" ? 5 : 8, uv: ACCENT, caps: [true, true] });
  /* Блик: светлое пятно на боку к наблюдателю. */
  sphere(mesh, add(centre, [-0.08, 0.07, 0.17]), 0.045, { rings: 2, segments: 6, uv: WHITE, stretch: 0.4, axis: unit([-0.08, 0.07, 0.17]) });
}
