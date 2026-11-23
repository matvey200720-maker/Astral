/*
 * Объёмные цветы на стволе (задача 6 ТЗ 11.10.2026, утро).
 *
 * Владелец: «цветочки должны быть трёхмерными». Цветок стоит на коротком
 * стебле над поверхностью ствола, у основания — два листа; чашечка из
 * изогнутых лепестков (`sheet`): у розы — четыре круга, от раскрытых
 * наружных с загнутыми кончиками до сомкнутого бутона в середине; у
 * тюльпана — бокал из шести; у лилии — шесть длинных, загнутых назад, с
 * тычинками; у ромашки — лучи вокруг жёлтого купола; у сакуры — пять
 * лепестков с вырезом и тычинки.
 *
 * Оси цветка: середина основания — в начале осей, лицо — к +z (нормаль
 * поверхности ствола), единица — размер цветка (его поперечник). Второй
 * цвет — где у вида середина (ромашка, сакура, лилия), а где листья и
 * стебель (роза, тюльпан — как у розы с 10.10); у остальных листья — своя
 * зелень листа (`LEAF`).
 *
 * Качество: `high` — для `_hi` модели (в руках, кадр мастерской), `low` —
 * для обычной `.ydr` (ствол вдали, у других игроков): та же форма, меньше
 * граней.
 */

import { ACCENT, GOLD, LEAF, MAIN, SHAPES, TAU, add, dome, framed, pipe, scale, sheet, sphere } from "./decoration-shapes.js";

export const FLOWER_QUALITY = Object.freeze({
  high: Object.freeze({ rows: 6, cols: 4, sides: 6, sphere: Object.freeze({ rings: 4, segments: 8 }), domeRings: 3, domeSegments: 12, stamens: true }),
  low: Object.freeze({ rows: 3, cols: 2, sides: 4, sphere: Object.freeze({ rings: 2, segments: 5 }), domeRings: 2, domeSegments: 8, stamens: false }),
});

const quality = (name) => FLOWER_QUALITY[name] || FLOWER_QUALITY.high;
const HEAD = 0.14;

/* Круг лепестков: `count` штук вокруг оси, основание — на радиусе `r0`. */
function whorl(mesh, q, { count, offset = 0, r0 = 0.04, z = 0, uv, ...petal }) {
  for (let k = 0; k < count; k += 1) {
    const angle = offset + (k / count) * TAU;
    const radial = [Math.cos(angle), Math.sin(angle), 0];
    sheet(mesh, { base: [radial[0] * r0, radial[1] * r0, HEAD + z], forward: radial, up: [0, 0, 1], rows: q.rows, cols: q.cols, uv, ...petal });
  }
}

/* Стебель над поверхностью и два листа у основания. */
function stemAndLeaves(mesh, q, { leafUv = (t) => LEAF(0.3 + 0.6 * t), stemUv = LEAF(0.35), height = HEAD, leaf = 0.42, angle = 0.5 } = {}) {
  pipe(mesh, [[0, 0, -0.02], [0, 0, height * 0.5], [0, 0, height]], { radius: 0.032, sides: q.sides, uv: stemUv });
  for (const turn of [angle, angle + Math.PI]) {
    const forward = [Math.cos(turn), Math.sin(turn), 0];
    sheet(mesh, { base: add(scale(forward, 0.02), [0, 0, 0.012]), forward, up: [0, 0, 1], length: leaf, width: leaf * 0.42, rise: 0.16, bend: -0.3, fold: 0.32, cup: 0.1, shape: SHAPES.pointed, rows: q.rows, cols: q.cols, uv: leafUv });
  }
}

const shaded = (from, to) => (t) => MAIN(from + (to - from) * t);

function rose(mesh, q) {
  stemAndLeaves(mesh, q, { leafUv: () => ACCENT, stemUv: ACCENT });
  const rings = [
    { count: 5, length: 0.4, width: 0.44, rise: 0.32, bend: -0.6, cup: 0.45, r0: 0.05, z: 0, offset: 0, uv: shaded(0.4, 1) },
    { count: 5, length: 0.32, width: 0.4, rise: 0.85, bend: 0.05, cup: 0.55, r0: 0.04, z: 0.02, offset: 0.63, uv: shaded(0.35, 0.92) },
    { count: 4, length: 0.25, width: 0.36, rise: 1.18, bend: 0.4, cup: 0.65, r0: 0.03, z: 0.045, offset: 0.2, uv: shaded(0.28, 0.82) },
    { count: 3, length: 0.18, width: 0.3, rise: 1.38, bend: 0.65, cup: 0.8, r0: 0.014, z: 0.07, offset: 1.1, uv: shaded(0.2, 0.7) },
  ];
  for (const ring of rings) whorl(mesh, q, { ...ring, shape: SHAPES.rounded });
  /* Чашелистики под розой — второй цвет, как листья. */
  whorl(mesh, { ...q, rows: Math.max(2, q.rows - 2), cols: Math.max(1, q.cols - 2) }, { count: 5, offset: 0.3, length: 0.2, width: 0.08, rise: -0.15, bend: -0.2, cup: 0.2, r0: 0.03, z: -0.01, uv: () => ACCENT, shape: SHAPES.pointed });
}

function daisy(mesh, q) {
  stemAndLeaves(mesh, q, { leaf: 0.38 });
  whorl(mesh, q, { count: 16, length: 0.4, width: 0.11, rise: 0.12, bend: -0.22, cup: 0.3, r0: 0.1, z: 0.004, offset: 0, uv: shaded(0.55, 1), shape: SHAPES.rounded });
  whorl(mesh, { ...q, cols: Math.max(1, q.cols - 2) }, { count: 12, length: 0.36, width: 0.1, rise: 0.24, bend: -0.12, cup: 0.25, r0: 0.09, z: 0.012, offset: TAU / 24, uv: shaded(0.5, 0.95), shape: SHAPES.rounded });
  dome(mesh, { radius: 0.13, height: 0.085, centre: [0, 0, HEAD + 0.012], uv: ACCENT, rings: q.domeRings, segments: q.domeSegments });
}

function tulip(mesh, q) {
  stemAndLeaves(mesh, q, { leafUv: () => ACCENT, stemUv: ACCENT, leaf: 0.5, angle: 0.9 });
  whorl(mesh, q, { count: 3, offset: 0, length: 0.5, width: 0.5, rise: 1.12, bend: 0.38, cup: 0.75, r0: 0.03, z: 0, uv: shaded(0.3, 1), shape: SHAPES.rounded });
  whorl(mesh, q, { count: 3, offset: Math.PI / 3, length: 0.48, width: 0.46, rise: 1.2, bend: 0.32, cup: 0.78, r0: 0.018, z: 0.012, uv: shaded(0.25, 0.9), shape: SHAPES.rounded });
}

function lily(mesh, q) {
  stemAndLeaves(mesh, q, { leaf: 0.4, angle: 0.2 });
  for (const [offset, width, z] of [
    [0, 0.2, 0],
    [Math.PI / 3, 0.23, 0.01],
  ])
    whorl(mesh, q, { count: 3, offset, length: 0.5, width, rise: 0.78, bend: -1.9, cup: 0.32, fold: 0.12, r0: 0.03, z, uv: shaded(0.4, 1), shape: SHAPES.pointed });
  /* Тычинки: тонкие нити наружу и вверх, пыльники — вторым цветом. */
  const count = q.stamens ? 6 : 3;
  for (let k = 0; k < count; k += 1) {
    const angle = (k / count) * TAU + 0.25;
    const out = [Math.cos(angle), Math.sin(angle), 0];
    const tip = add(scale(out, 0.15), [0, 0, HEAD + 0.34]);
    pipe(mesh, [[0, 0, HEAD + 0.02], add(scale(out, 0.06), [0, 0, HEAD + 0.18]), tip], { radius: 0.007, sides: q.sides > 4 ? 4 : 3, uv: LEAF(0.85) });
    sphere(mesh, tip, 0.024, { ...q.sphere, uv: ACCENT, stretch: 1.6, axis: out });
  }
  pipe(mesh, [[0, 0, HEAD + 0.02], [0, 0, HEAD + 0.36]], { radius: 0.01, sides: q.sides > 4 ? 4 : 3, uv: LEAF(0.9) });
  sphere(mesh, [0, 0, HEAD + 0.37], 0.018, { ...q.sphere, uv: GOLD });
}

function sakura(mesh, q) {
  stemAndLeaves(mesh, q, { leaf: 0.36 });
  whorl(mesh, q, { count: 5, offset: Math.PI / 2, length: 0.42, width: 0.4, rise: 0.4, bend: -0.32, cup: 0.4, notch: 0.08, r0: 0.04, z: 0, uv: shaded(0.85, 0.55), shape: SHAPES.notched });
  dome(mesh, { radius: 0.07, height: 0.04, centre: [0, 0, HEAD + 0.01], uv: ACCENT, rings: q.domeRings, segments: q.domeSegments });
  if (!q.stamens) return;
  for (let k = 0; k < 8; k += 1) {
    const angle = (k / 8) * TAU;
    const out = [Math.cos(angle), Math.sin(angle), 0];
    const tip = add(scale(out, 0.11), [0, 0, HEAD + 0.13]);
    pipe(mesh, [[0, 0, HEAD + 0.02], tip], { radius: 0.005, sides: 3, uv: ACCENT });
    sphere(mesh, tip, 0.014, { rings: 2, segments: 5, uv: GOLD });
  }
}

const FLOWERS = Object.freeze({ rose, daisy, tulip, lily, sakura });

/** Цветок вида `variant` в осях построителя (можно `framed`). */
export function flowerMesh(mesh, variant, lod = "high") {
  (FLOWERS[variant] || daisy)(mesh, quality(lod));
}

/* ----------------------------- на лозе ----------------------------- */

/*
 * Цвет на лозе: маленький, без стебля и листьев (их даёт сама лоза),
 * лепестки — вторым цветом (у лозы основной цвет — листья), середина —
 * золото. `frame` — где и как стоит (`framed`).
 */
export function vineBloom(mesh, kind, frame, lod = "high") {
  const q = quality(lod);
  const at = framed(mesh, frame);
  const small = { ...q, rows: Math.max(2, q.rows - 3), cols: Math.max(1, q.cols - 2) };
  const accent = () => ACCENT;
  if (kind === "roses") {
    /* Бутон розы: два круга сомкнутых лепестков. */
    for (const [count, length, width, rise, bend, z, offset] of [
      [4, 0.34, 0.4, 0.95, 0.35, 0, 0],
      [3, 0.26, 0.36, 1.3, 0.6, 0.03, 0.8],
    ])
      for (let k = 0; k < count; k += 1) {
        const angle = offset + (k / count) * TAU;
        const radial = [Math.cos(angle), Math.sin(angle), 0];
        sheet(at, { base: [radial[0] * 0.03, radial[1] * 0.03, z], forward: radial, up: [0, 0, 1], length, width, rise, bend, cup: 0.7, shape: SHAPES.rounded, rows: small.rows, cols: small.cols, uv: accent });
      }
    return;
  }
  if (kind === "holly") {
    /* Ягоды остролиста: гроздь из трёх. */
    for (let k = 0; k < 3; k += 1) {
      const angle = (k / 3) * TAU + 0.4;
      sphere(at, [Math.cos(angle) * 0.13, Math.sin(angle) * 0.13, 0.1], 0.13, { ...q.sphere, uv: ACCENT });
    }
    return;
  }
  /* Цветочек: пять лепестков и золотая середина. */
  for (let k = 0; k < 5; k += 1) {
    const angle = (k / 5) * TAU;
    const radial = [Math.cos(angle), Math.sin(angle), 0];
    sheet(at, { base: [radial[0] * 0.05, radial[1] * 0.05, 0.02], forward: radial, up: [0, 0, 1], length: 0.42, width: 0.36, rise: 0.45, bend: -0.35, cup: 0.4, shape: SHAPES.rounded, rows: small.rows, cols: small.cols, uv: accent });
  }
  sphere(at, [0, 0, 0.05], 0.09, { rings: Math.max(2, q.sphere.rings - 1), segments: q.sphere.segments, uv: GOLD, stretch: 0.7 });
}
