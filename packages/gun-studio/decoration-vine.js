/*
 * Лоза вокруг ствола (задача 6 ТЗ 11.10.2026, утро).
 *
 * Владелец: «лоза должна обвивать ган». Лоза — стебель-трубка по спирали
 * вокруг самой модели ствола на отступе от поверхности, с объёмными
 * листьями, усиками и цветами (бутонами роз, ягодами остролиста).
 *
 * ФОРМА СТВОЛА. Чисел «ствол тут, толщина столько» в модели нет, поэтому она
 * меряется так же, как столб фонаря (`street-light-contract/lamps/
 * pole-shape.js`): модель режется плоскостями поперёк длинной оси, и на
 * каждом срезе берутся точки, где плоскость пересекает треугольники. По
 * срезу — середина и «радиус» по 16 направлениям вокруг неё (самая дальняя
 * точка в каждом секторе): лоза идёт снаружи от всего, что есть в этом
 * секторе, и на угловатом затворе не уходит внутрь. Одиночные выступы
 * (мушка, прицельная планка в один срез) сглаживаются медианой по длине.
 *
 * ГДЕ ЛОЗА. «Ствол» — от дула назад, пока срез остаётся тонким (у пистолета
 * — затвор до спусковой скобы, у винтовки — сам ствол до цевья), не меньше
 * четверти и не больше трёх четвертей длины; «Корпус» — от тыла до ствола;
 * «Вся модель» — от края до края. Дуло — тонкий конец (как `gun-zones.js`).
 *
 * Мерка (`decorationWrap`) делается по модели в кадре окна и хранится в
 * украшении (`wrap`): сетка лозы — арифметика по ней, одна и та же в кадре,
 * у Astral Desktop и в тестах. Оси — модели кадра (glTF), метры.
 *
 * КОСТИ. Лоза длиннее детали: у пистолета она и на затворе, и на раме.
 * Поэтому сетка — частями по полвитка (`part`), у каждой своя точка
 * крепления на поверхности под ней, и хост вешает каждую часть на свою
 * несущую кость: на затворе лоза ходит с затвором.
 */

import { vineBloom } from "./decoration-flowers.js";
import { MAIN, SHAPES, TAU, add, builder, cross, dot, jitter, pipe, pipeFrames, scale, sheet, sub, unit } from "./decoration-shapes.js";

export const VINE_BINS = 16;
export const VINE_ZONES = Object.freeze(["barrel", "body", "whole"]);
const SLICES = 40;
const MAX_WRAP_SLICES = 48;

export const VINE_QUALITY = Object.freeze({
  high: Object.freeze({ perTurn: 22, sides: 6, leafRows: 4, leafCols: 2, maxLeaves: 48, maxBlooms: 12, tendrils: 8 }),
  low: Object.freeze({ perTurn: 10, sides: 4, leafRows: 2, leafCols: 1, maxLeaves: 22, maxBlooms: 6, tendrils: 0 }),
});

const round4 = (value) => Math.round(value * 1e4) / 1e4;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/* ----------------------------- мерка ----------------------------- */

/* Позиции и треугольники сеток `[{ positions, indices? }]`. */
function* trianglesOf(meshes) {
  for (const mesh of meshes || []) {
    const positions = mesh?.positions;
    if (!positions?.length) continue;
    const count = Math.floor(positions.length / 3);
    const indices = mesh.indices?.length ? mesh.indices : null;
    const total = indices ? indices.length : count;
    const at = (index) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
    for (let index = 0; index + 2 < total; index += 3)
      yield indices ? [at(indices[index]), at(indices[index + 1]), at(indices[index + 2])] : [at(index), at(index + 1), at(index + 2)];
  }
}

/**
 * Мерка ствола для лозы: `{ zone, axis, slices: [{ a, c: [b, c], r: [16] }] }`
 * — срезы по длинной оси `axis` (0 — x) от меньшей координаты к большей:
 * где срез (`a`), середина в двух других осях (по порядку `axis+1`,
 * `axis+2`) и радиус по 16 секторам (сектор `j` — углы от `j/16` до
 * `(j+1)/16` оборота от оси `axis+1` к `axis+2`). `null` — модели нет.
 */
export function decorationWrap(meshes, { zone = "barrel" } = {}) {
  const triangles = [...trianglesOf(meshes)];
  if (!triangles.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles)
    for (const point of triangle)
      for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis] < min[axis]) min[axis] = point[axis];
        if (point[axis] > max[axis]) max[axis] = point[axis];
      }
  const size = max.map((value, axis) => value - min[axis]);
  const axis = size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2;
  if (!(size[axis] > 1e-4)) return null;
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  /* «Высота» среза — по вертикали модели (y), если ось не она. */
  const vertical = axis === 1 ? 1 : b === 1 ? 0 : 1;
  const step = size[axis] / SLICES;
  const slices = Array.from({ length: SLICES }, (_, k) => ({ a: min[axis] + step * (k + 0.5), points: [] }));
  for (const triangle of triangles) {
    const lowest = Math.min(triangle[0][axis], triangle[1][axis], triangle[2][axis]);
    const highest = Math.max(triangle[0][axis], triangle[1][axis], triangle[2][axis]);
    const low = Math.max(0, Math.ceil((lowest - min[axis]) / step - 0.5));
    const high = Math.min(SLICES - 1, Math.floor((highest - min[axis]) / step - 0.5));
    for (let k = low; k <= high; k += 1) {
      const plane = slices[k].a;
      for (let edge = 0; edge < 3; edge += 1) {
        const p = triangle[edge];
        const q = triangle[(edge + 1) % 3];
        const dp = p[axis] - plane;
        const dq = q[axis] - plane;
        if ((dp < 0 && dq < 0) || (dp > 0 && dq > 0) || dp === dq) continue;
        const t = dp / (dp - dq);
        slices[k].points.push([p[b] + (q[b] - p[b]) * t, p[c] + (q[c] - p[c]) * t]);
      }
    }
  }
  const heights = slices.map((slice) => {
    if (slice.points.length < 3) return null;
    let low = Infinity;
    let high = -Infinity;
    for (const point of slice.points) {
      if (point[vertical] < low) low = point[vertical];
      if (point[vertical] > high) high = point[vertical];
    }
    return high - low;
  });
  /* Дуло — тонкий конец: средняя высота крайних 15 % срезов. */
  const edge = Math.max(1, Math.round(SLICES * 0.15));
  const meanOf = (list) => {
    const known = list.filter((value) => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : Infinity;
  };
  const muzzleAtMax = meanOf(heights.slice(-edge)) <= meanOf(heights.slice(0, edge));
  /* Порядок срезов — от тыла к дулу. */
  const order = Array.from({ length: SLICES }, (_, k) => (muzzleAtMax ? k : SLICES - 1 - k));
  const smooth = order.map((k, at) => {
    const window = order.slice(Math.max(0, at - 2), at + 3).map((index) => heights[index]).filter((value) => value !== null);
    return window.length ? median(window) : null;
  });
  const known = order.map((k, at) => at).filter((at) => smooth[at] !== null);
  if (known.length < 2) return null;
  const muzzleHeight = median(known.slice(-4).map((at) => smooth[at]));
  const limit = Math.max(muzzleHeight * 1.7, muzzleHeight + 0.012);
  let run = 0;
  for (let at = known.length - 1; at >= 0 && smooth[known[at]] <= limit; at -= 1) run += 1;
  run = Math.min(Math.floor(known.length * 0.75), Math.max(Math.ceil(known.length * 0.25), run));
  const chosen = zone === "whole" ? known : zone === "body" ? known.slice(0, Math.min(known.length, known.length - run + 2)) : known.slice(known.length - run);
  const picked = (chosen.length >= 2 ? chosen : known).map((at) => slices[order[at]]);

  /* Середина среза — середина его габарита; сглаживается вдоль длины. */
  const centres = picked.map((slice) => {
    const low = [Infinity, Infinity];
    const high = [-Infinity, -Infinity];
    for (const point of slice.points)
      for (let k = 0; k < 2; k += 1) {
        if (point[k] < low[k]) low[k] = point[k];
        if (point[k] > high[k]) high[k] = point[k];
      }
    return [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2];
  });
  const smoothCentres = centres.map((_, at) => {
    const window = centres.slice(Math.max(0, at - 2), at + 3);
    return [0, 1].map((k) => window.reduce((sum, value) => sum + value[k], 0) / window.length);
  });
  const radii = picked.map((slice, at) => {
    const [cb, cc] = smoothCentres[at];
    const bins = new Array(VINE_BINS).fill(-1);
    for (const [pb, pc] of slice.points) {
      const angle = (Math.atan2(pc - cc, pb - cb) + TAU) % TAU;
      const bin = Math.min(VINE_BINS - 1, Math.floor((angle / TAU) * VINE_BINS));
      const distance = Math.hypot(pb - cb, pc - cc);
      if (distance > bins[bin]) bins[bin] = distance;
    }
    /* Пустой сектор — по соседям по кругу. */
    const filled = bins.map((value, j) => {
      if (value >= 0) return value;
      let left = 1;
      while (left < VINE_BINS && bins[(j - left + VINE_BINS) % VINE_BINS] < 0) left += 1;
      let right = 1;
      while (right < VINE_BINS && bins[(j + right) % VINE_BINS] < 0) right += 1;
      if (left >= VINE_BINS) return 0.01;
      const a = bins[(j - left + VINE_BINS) % VINE_BINS];
      const z = bins[(j + right) % VINE_BINS];
      return a + ((z - a) * left) / (left + right);
    });
    return filled;
  });
  /* Выступ в один срез (мушка, планка) — медианой по трём соседним. */
  const evened = radii.map((row, at) =>
    row.map((_, j) => median([radii[Math.max(0, at - 1)][j], row[j], radii[Math.min(radii.length - 1, at + 1)][j]])),
  );
  const result = picked
    .map((slice, at) => ({ a: round4(slice.a), c: smoothCentres[at].map(round4), r: evened[at].map((value) => round4(Math.max(0.001, value))) }))
    .sort((left, right) => left.a - right.a);
  return normalizeWrap({ zone: VINE_ZONES.includes(zone) ? zone : "barrel", axis, slices: result });
}

/** Мерка из проекта: в границах, иначе `null`. */
export function normalizeWrap(input) {
  if (!input || typeof input !== "object") return null;
  const axis = Number(input.axis);
  if (![0, 1, 2].includes(axis) || !Array.isArray(input.slices)) return null;
  const finite = (value, limit) => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
  const slices = [];
  for (const slice of input.slices.slice(0, MAX_WRAP_SLICES)) {
    if (!slice || !finite(slice.a, 3) || !Array.isArray(slice.c) || slice.c.length !== 2 || !slice.c.every((value) => finite(value, 3))) return null;
    if (!Array.isArray(slice.r) || slice.r.length !== VINE_BINS || !slice.r.every((value) => finite(value, 1) && Number(value) > 0)) return null;
    slices.push({ a: round4(Number(slice.a)), c: slice.c.map((value) => round4(Number(value))), r: slice.r.map((value) => round4(Number(value))) });
  }
  slices.sort((left, right) => left.a - right.a);
  const distinct = slices.filter((slice, at) => at === 0 || slice.a > slices[at - 1].a);
  if (distinct.length < 2) return null;
  return { zone: VINE_ZONES.includes(input.zone) ? input.zone : "barrel", axis, slices: distinct };
}

/* ---------------------------- по мерке ---------------------------- */

/* Точка на поверхности у доли длины `s` и угла `theta`: с направлением наружу. */
function sampler(wrap) {
  const { axis, slices } = wrap;
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const a0 = slices[0].a;
  const a1 = slices.at(-1).a;
  const basis = (index) => {
    const vector = [0, 0, 0];
    vector[index] = 1;
    return vector;
  };
  const eb = basis(b);
  const ec = basis(c);
  const ea = basis(axis);
  const sliceAt = (a) => {
    if (a <= a0) return [0, 0, 0];
    for (let k = 1; k < slices.length; k += 1) if (a <= slices[k].a) return [k - 1, k, (a - slices[k - 1].a) / (slices[k].a - slices[k - 1].a)];
    return [slices.length - 1, slices.length - 1, 0];
  };
  const radiusOf = (slice, theta) => {
    /* Середины секторов — на (j + ½)/16 оборота. */
    const f = ((((theta / TAU) % 1) + 1) % 1) * VINE_BINS - 0.5;
    const j0 = ((Math.floor(f) % VINE_BINS) + VINE_BINS) % VINE_BINS;
    const j1 = (j0 + 1) % VINE_BINS;
    const v = f - Math.floor(f);
    return slice.r[j0] + (slice.r[j1] - slice.r[j0]) * v;
  };
  const at = (s, theta) => {
    const a = a0 + (a1 - a0) * Math.min(1, Math.max(0, s));
    const [k0, k1, u] = sliceAt(a);
    const centre = [0, 1].map((k) => slices[k0].c[k] + (slices[k1].c[k] - slices[k0].c[k]) * u);
    const radius = radiusOf(slices[k0], theta) + (radiusOf(slices[k1], theta) - radiusOf(slices[k0], theta)) * u;
    const outward = add(scale(eb, Math.cos(theta)), scale(ec, Math.sin(theta)));
    const middle = add(add(scale(ea, a), scale(eb, centre[0])), scale(ec, centre[1]));
    return { surface: add(middle, scale(outward, radius)), outward, middle, radius };
  };
  /* Доля длины и угол точки модели (для места щелчка). */
  const locate = (point) => {
    const s = (point[axis] - a0) / (a1 - a0 || 1);
    const [k0, k1, u] = sliceAt(point[axis]);
    const centre = [0, 1].map((k) => slices[k0].c[k] + (slices[k1].c[k] - slices[k0].c[k]) * u);
    return { s: Math.min(1, Math.max(0, s)), theta: Math.atan2(point[c] - centre[1], point[b] - centre[0]) };
  };
  return { at, locate, length: a1 - a0 };
}

/* Запасная мерка без модели: цилиндр 1,5 см вокруг оси x через точку. */
export function fallbackWrap(anchor) {
  const centre = [anchor.y, anchor.z];
  const ring = new Array(VINE_BINS).fill(0.015);
  return { zone: "barrel", axis: 0, slices: [-0.05, 0, 0.05].map((dx) => ({ a: round4(anchor.x + dx), c: centre.map(round4), r: ring })) };
}

/**
 * Сетка лозы в осях модели кадра: `builder` с частями. `decoration` —
 * нормализованная лоза (`createDecoration`), `lod` — `high` / `low`.
 */
/**
 * Путь спирали вокруг модели по мерке украшения: точки на отступе `lift`
 * (метры) от поверхности, направления наружу, точки поверхности под ними,
 * рамки трубки, длина и `pointAt(доля длины)`. Общий у лозы и гирлянд
 * (`decoration-garland.js`): витки, сдвиг витков и точка щелчка у них
 * значат одно и то же.
 */
export function wrapPath(decoration, { perTurn = VINE_QUALITY.high.perTurn, lift = 0 } = {}) {
  const wrap = normalizeWrap(decoration.wrap) || fallbackWrap(decoration.anchor);
  const sample = sampler(wrap);
  const turns = decoration.turns;
  const anchor = [decoration.anchor.x, decoration.anchor.y, decoration.anchor.z];
  const place = sample.locate(anchor);
  const phase = place.theta - TAU * turns * place.s + (decoration.rotation * Math.PI) / 180;
  const steps = Math.max(16, Math.ceil(turns * perTurn));
  const points = [];
  const outward = [];
  const surface = [];
  for (let index = 0; index <= steps; index += 1) {
    const s = index / steps;
    const spot = sample.at(s, phase + TAU * turns * s);
    points.push(add(spot.surface, scale(spot.outward, lift)));
    outward.push(spot.outward);
    surface.push(spot.surface);
  }
  const frames = pipeFrames(points);
  /* Длина пути — по точкам; доля длины у каждой точки. */
  const along = [0];
  for (let index = 1; index < points.length; index += 1) along.push(along[index - 1] + Math.hypot(...sub(points[index], points[index - 1])));
  const total = along.at(-1) || 1;
  const pointAt = (share) => {
    const target = share * total;
    let index = 1;
    while (index < points.length - 1 && along[index] < target) index += 1;
    const span = along[index] - along[index - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - along[index - 1]) / span));
    return {
      index: t < 0.5 ? index - 1 : index,
      point: add(points[index - 1], scale(sub(points[index], points[index - 1]), t)),
      tangent: frames[index].tangent,
      outward: unit(add(scale(outward[index - 1], 1 - t), scale(outward[index], t))),
    };
  };
  return { steps, points, outward, surface, frames, along, total, pointAt };
}

export function vineMesh(decoration, lod = "high") {
  const q = VINE_QUALITY[lod] || VINE_QUALITY.high;
  const turns = decoration.turns;
  const stem = decoration.thickness / 2000;
  const gap = stem + decoration.gap / 1000 + 0.0006;
  const leafLength = decoration.size / 100;
  const { steps, points, surface, frames, total, pointAt } = wrapPath(decoration, { perTurn: q.perTurn, lift: gap });
  /* Стебель тоньше к концам. */
  const radius = (index) => {
    const s = index / steps;
    const ease = (x) => Math.min(1, Math.max(0, x)) ** 0.5;
    return stem * (0.4 + 0.6 * Math.min(ease(s / 0.06), ease((1 - s) / 0.06)));
  };

  /* Что растёт на лозе: листья по густоте, между ними цветы и усики. */
  const spacing = leafLength * (2.4 - 1.5 * (decoration.density / 100));
  const leafCount = decoration.density > 0 ? Math.min(q.maxLeaves, Math.max(2, Math.round(total / spacing))) : 0;
  const leaves = Array.from({ length: leafCount }, (_, k) => ({ share: (k + 0.5 + (jitter(k + 1) - 0.5) * 0.5) / leafCount, k }));
  const bloomsWanted = decoration.variant === "ivy" ? 0 : Math.round(leafCount * (decoration.blooms / 100) * 0.4);
  const bloomCount = Math.min(q.maxBlooms, bloomsWanted);
  const blooms = Array.from({ length: bloomCount }, (_, k) => ({ share: Math.min(0.97, (k + 0.5) / bloomCount + 0.5 / Math.max(1, leafCount)), k }));
  const tendrilCount = decoration.variant === "ivy" || decoration.variant === "bloom" ? Math.min(q.tendrils, Math.floor(leafCount / 5)) : 0;
  const tendrils = Array.from({ length: tendrilCount }, (_, k) => ({ share: (k + 0.75) / tendrilCount, k }));

  const mesh = builder();
  const partCount = Math.min(16, Math.max(1, Math.ceil(turns * 2)));
  const leafShape = decoration.variant === "holly" ? SHAPES.holly : decoration.variant === "ivy" ? SHAPES.ivy : SHAPES.pointed;
  const stemUv = MAIN(0.18);
  for (let part = 0; part < partCount; part += 1) {
    const from = Math.round((part * steps) / partCount);
    const to = Math.round(((part + 1) * steps) / partCount);
    const middle = Math.round((from + to) / 2);
    mesh.part(surface[middle]);
    pipe(mesh, points, { radius, sides: q.sides, uv: stemUv, frames, from, to, caps: [part === 0, part === partCount - 1] });
    const inside = (share) => share >= from / steps && (share < to / steps || (part === partCount - 1 && share <= 1));
    for (const leaf of leaves.filter((item) => inside(item.share))) {
      const spot = pointAt(leaf.share);
      const side = unit(cross(spot.outward, spot.tangent));
      const flip = leaf.k % 2 ? 1 : -1;
      const lean = 0.55 + (jitter(leaf.k + 101) - 0.5) * 0.5;
      const forward = unit(add(scale(side, flip * Math.cos(lean)), scale(spot.tangent, Math.sin(lean))));
      const length = leafLength * (0.82 + 0.36 * jitter(leaf.k + 202));
      sheet(mesh, {
        base: add(spot.point, scale(side, flip * radius(spot.index) * 0.7)),
        forward,
        up: spot.outward,
        length,
        width: length * (decoration.variant === "ivy" ? 0.78 : 0.48),
        rise: 0.32,
        bend: -0.42,
        fold: 0.28,
        cup: 0.08,
        shape: leafShape,
        rows: q.leafRows,
        cols: q.leafCols,
        uv: (t) => MAIN(0.4 + 0.6 * t),
      });
    }
    for (const bloom of blooms.filter((item) => inside(item.share))) {
      const spot = pointAt(Math.min(1, bloom.share));
      const z = spot.outward;
      const x = unit(sub(spot.tangent, scale(z, dot(spot.tangent, z))));
      const y = cross(z, x);
      vineBloom(mesh, decoration.variant, { origin: add(spot.point, scale(z, radius(spot.index) * 0.6)), x, y, z, scale: leafLength * 0.85 }, lod);
    }
    for (const tendril of tendrils.filter((item) => inside(item.share))) {
      const spot = pointAt(tendril.share);
      const side = unit(cross(spot.outward, spot.tangent));
      const flip = tendril.k % 2 ? -1 : 1;
      const size = leafLength * 0.55;
      const centre = add(add(spot.point, scale(side, flip * size * 0.45)), scale(spot.outward, size * 0.2));
      const curl = [];
      for (let k = 0; k <= 14; k += 1) {
        const u = k / 14;
        const angle = Math.PI * 2.3 * u;
        const rho = size * 0.45 * (1 - 0.72 * u);
        curl.push(add(add(add(centre, scale(side, -flip * Math.cos(angle) * rho)), scale(spot.outward, Math.sin(angle) * rho)), scale(spot.tangent, size * 0.25 * u)));
      }
      pipe(mesh, curl, { radius: (index) => stem * 0.38 * (1 - (0.6 * index) / 14), sides: 4, uv: stemUv, caps: [false, true] });
    }
  }
  return mesh;
}
