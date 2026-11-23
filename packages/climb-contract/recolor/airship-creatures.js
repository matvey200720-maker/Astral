/*
 * Живые модели неба «Дирижаблей»: дракон, феникс, кит, медуза, восточный
 * дракон и грифон (ТЗ
 * 11.10.2026, ночь, задача 3: «реалистичные модели для вкладки дирижабля
 * (драконы, фениксы и т. д.)»). Их рисует Astral кодом — моделей Rockstar
 * в поставке нет.
 *
 *   • Дракон — голова с мордой, приоткрытой челюстью, зубами, рогами,
 *     надбровьями и гребнями за щеками; шея, туловище с грудью и бёдрами,
 *     шипы по хребту, хвост с наконечником, лапы с пальцами и когтями.
 *     Крыло — кости (плечо, предплечье, четыре пальца и коготь большого)
 *     и перепонка между пальцами лоскутами; кромка между концами пальцев
 *     — фестоном к запястью, перепонка чуть выгнута подъёмной силой.
 *   • Феникс — птица: тело, клюв крючком, глаза, хохолок; крыло — кроющие
 *     одним телом (на нём лого), ряд больших кроющих, вторичные и первичные
 *     маховые (разведённые «пальцы» на конце), длинные хвостовые перья.
 *     Концы перьев горят — своей частью (`flame`).
 *   • Кит — горбач: складки горла, бугорки на морде, длинные грудные
 *     плавники с бугристой кромкой, горб и спинной плавник, хвостовой
 *     плавник лопастями с зубчатой кромкой и вырезом.
 *   • Медуза — купол с краевыми лопастями и каналами, светящаяся изнанка,
 *     четыре оборчатые ротовые лопасти и тонкие щупальца.
 *   • Восточный дракон (виды ночи того же дня) — змеиное тело без крыльев,
 *     грива, усы, ветвистые рога, четыре лапы; летит волной тела.
 *   • Грифон — тело льва, голова, грудь и крылья орла; крылья машут.
 *
 * Листы: каждая поверхность развёрнута на свой кусок листа модели
 * (`airship-paint.js`): чешуя, перья, перепонка, кожа кита, купол. Те же
 * рисунки ложатся в лист картинки, когда у модели лого или своя текстура
 * (`materials` вида, `ctx.skinUv`): спина и крылья тогда идут частью
 * `skin`, развёртка — та же.
 *
 * Доля «местного» движения (`flexAll`) — от места вершины: корни крыльев
 * стоят, концы ходят; лапы и голова стоят.
 */

import { add, clamp01, coons, cross, curve, curveFrames, dot, ellipsoid, flexAll, length, lerp, mirrorX, mix, polyline, scale, smooth, sub, surface, sweepAlong, tubeCurve, unit } from "./airship-mesh.js";
import { bellyPlates, eyeIris, featherVane, flameTip, fur, gradient, griffinCoat, hairStrands, hornGradient, jellyArm, jellyBell, reptileScales, softFeathers, tone, whaleFin, whaleSkin, whaleThroat, wingMembrane, rgb } from "./airship-paint.js";

const DEG = Math.PI / 180;
const hexOf = ([r, g, b]) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
const darker = (hex, k) => hexOf(tone(rgb(hex), k));

/* Сторона: правая — как есть, левая — отражением по X. */
const SIDES = Object.freeze([
  Object.freeze({ id: "right", p: (point) => point }),
  Object.freeze({ id: "left", p: mirrorX }),
]);

/*
 * Двусторонний лист (перепонка, перо, плавник-лента): лицевая сторона —
 * та, чья нормаль в середине смотрит вверх (+Z), или к `toward`. Ответ —
 * `{ up, down }` развёрток для `uvUp`/`uvDown` (у сторон бывают свои куски
 * листа картинки: верх и низ крыла).
 */
function twoSided({ up, down = up }, rows, cols, at, { uvUp, uvDown = uvUp, toward = [0, 0, 1] } = {}) {
  const middle = [Math.round(rows / 2), Math.round(cols / 2)];
  const step = (i, j) => at(Math.min(rows, i), Math.min(cols, j));
  const di = sub(step(middle[0] + 1, middle[1]), at(Math.max(0, middle[0] - 1), middle[1]));
  const dj = sub(step(middle[0], middle[1] + 1), at(middle[0], Math.max(0, middle[1] - 1)));
  const facing = dot(cross(di, dj), toward) >= 0;
  /* Поверхность без `flip` смотрит по cross(∂i, ∂j): та сторона — «вверх», если она к `toward`. */
  surface(facing ? up : down, rows, cols, at, { uv: facing ? uvUp : uvDown });
  surface(facing ? down : up, rows, cols, at, { uv: facing ? uvDown : uvUp, flip: true });
}

/* Куда идёт поверхность: в лист картинки (у модели лого или текстура) или в кусок листа модели. */
const placeOn = (meshes, own, ctx, skinRegion, atlasMap) =>
  meshes.skin && skinRegion ? { mesh: meshes.skin, uv: (u, v) => ctx.skinUv(skinRegion, u, v) } : { mesh: own, uv: atlasMap };

/*
 * Конический шип или зуб по кривой: от `base` в сторону `direction` на
 * `size`, с изгибом `bend` (вектор, м у конца), радиус у основания `radius`.
 */
function spike(mesh, base, direction, size, radius, bend, uv, { rings = 5, segments = 6, flat = 1, side = null } = {}) {
  const middle = add(base, add(scale(direction, size * 0.55), scale(bend, 0.3)));
  const tip = add(base, add(scale(direction, size), bend));
  tubeCurve(mesh, [[...base, radius], [...middle, radius * 0.55], [...tip, 0]], { rings, segments, uv, flat, side });
}

/*
 * Лапа звеньями: точки `[x, y, z, r]` — суставы; звено — плавная труба
 * (мышца толще посередине), сустав — шар. Одной трубой острый сгиб локтя
 * выворачивал бы внутреннюю сторону.
 */
function limbChain(mesh, joints, uv, { segments = 12 } = {}) {
  for (let index = 0; index + 1 < joints.length; index += 1) {
    const [a, b] = [joints[index], joints[index + 1]];
    const middle = [...mix(a, b, 0.45), Math.max(a[3], b[3]) * 1.04];
    tubeCurve(mesh, [a, middle, b], { rings: 8, segments, uv: (t, angle) => uv(lerp(index, index + 1, t) / (joints.length - 1), angle) });
    if (index > 0) ellipsoid(mesh, null, a.slice(0, 3), [a[3] * 1.02, a[3] * 1.02, a[3] * 1.02], uv(index / (joints.length - 1), 0.5), { segments, rings: 8 });
  }
}

/* Развёртка глаза: передняя полусфера (местный +X) кругом, остальное — к кайме. */
const eyeUv = (map) => ([sx, sy, sz]) => {
  if (sx > 0) return map(0.5 + 0.47 * sy, 0.5 - 0.47 * sz);
  const k = 0.49 / Math.max(1e-6, Math.hypot(sy, sz));
  return map(0.5 + sy * k, 0.5 - sz * k);
};

/* Оси глаза: местный X — взгляд `facing`, Y — вдоль головы, Z — вверх (правая тройка). */
function eyeAxes(facing) {
  const f = unit(facing);
  const a = unit(cross([0, 0, 1], f));
  return [f, a, unit(cross(f, a))];
}

/* ------------------------------------------------------------------ *
 * Дракон
 * ------------------------------------------------------------------ */

/*
 * Хребет дракона от кончика хвоста до затылка: `[x, y, z, rx, rz, киль]`
 * (киль — насколько низ груди глубже верха). Длина ~27 м с наконечником
 * хвоста, размах крыльев ~29 м.
 */
const DRAGON_SPINE_POINTS = Object.freeze([
  [0, -15.3, -0.95, 0.03, 0.03, 0],
  [0, -14.0, -0.84, 0.15, 0.17, 0],
  [0, -12.0, -0.64, 0.35, 0.39, 0],
  [0, -9.6, -0.42, 0.55, 0.6, 0.02],
  [0, -7.2, -0.22, 0.7, 0.76, 0.04],
  [0, -5.0, -0.06, 0.96, 1.0, 0.06],
  [0, -3.2, 0.06, 1.2, 1.16, 0.06],
  [0, -1.3, 0.12, 1.34, 1.34, 0.12],
  [0, 0.6, 0.2, 1.48, 1.52, 0.2],
  [0, 2.2, 0.4, 1.36, 1.42, 0.16],
  [0, 3.6, 0.92, 1.04, 1.08, 0.08],
  [0, 4.8, 1.55, 0.8, 0.84, 0.04],
  [0, 6.0, 2.06, 0.67, 0.7, 0.02],
  [0, 7.1, 2.4, 0.6, 0.62, 0],
  [0, 7.8, 2.52, 0.38, 0.38, 0],
]);
const DRAGON_SPINE = curve(DRAGON_SPINE_POINTS);
export const DRAGON_BACK = Object.freeze([-25, 205]);
const DRAGON_FRAMES = curveFrames(DRAGON_SPINE, 150);
/** Длина хребта дракона, м (развёртка спины). */
export const DRAGON_LENGTH = DRAGON_SPINE.length;

/* Голова (череп с верхней челюстью) и нижняя челюсть: `[x, y, z, rx, rz]`. */
const DRAGON_HEAD = curve([
  [0, 7.05, 2.56, 0.52, 0.52],
  [0, 7.55, 2.68, 0.7, 0.66],
  [0, 8.15, 2.66, 0.68, 0.6],
  [0, 8.8, 2.52, 0.55, 0.47],
  [0, 9.5, 2.36, 0.46, 0.38],
  [0, 10.2, 2.22, 0.38, 0.31],
  [0, 10.68, 2.12, 0.25, 0.21],
  [0, 10.95, 2.05, 0.02, 0.02],
]);
const DRAGON_JAW = curve([
  [0, 7.55, 2.2, 0.56, 0.3],
  [0, 8.3, 2.0, 0.52, 0.28],
  [0, 9.1, 1.84, 0.43, 0.23],
  [0, 9.9, 1.72, 0.34, 0.18],
  [0, 10.42, 1.65, 0.2, 0.11],
  [0, 10.62, 1.64, 0.02, 0.02],
]);

/* Крыло (правое): плечо, локоть, запястье, концы четырёх пальцев, коготь большого, корень кромки у бока. */
const DRAGON_WING_BONES = Object.freeze({
  shoulder: Object.freeze([1.05, 1.7, 1.05]),
  elbow: Object.freeze([4.9, 0.6, 2.05]),
  wrist: Object.freeze([8.9, 2.0, 2.75]),
  tips: Object.freeze([
    Object.freeze([14.4, -0.6, 2.35]),
    Object.freeze([13.1, -4.3, 1.85]),
    Object.freeze([10.6, -6.6, 1.4]),
    Object.freeze([7.0, -6.9, 1.05]),
  ]),
  thumb: Object.freeze([9.3, 2.75, 2.95]),
  root: Object.freeze([1.25, -3.6, 0.55]),
});
/** Крыло дракона в плане: |x| и y, м — рамка развёртки перепонки. */
export const DRAGON_WING = Object.freeze({ a0: 1.0, a1: 14.6, b0: -7.2, b1: 3.0 });

/* Палец крыла: кривая от запястья к концу, чуть прогнута назад и вверх. */
function fingerCurve(tip) {
  const { wrist } = DRAGON_WING_BONES;
  const knuckle = add(mix(wrist, tip, 0.45), [0, -0.22, 0.12]);
  return curve([[...wrist], knuckle, [...tip]]);
}

/** Рисунки дракона по кускам листа: те же для листа модели и листа картинки. */
export function dragonMaterials(item) {
  const { wrist, elbow, shoulder, tips, root } = DRAGON_WING_BONES;
  const plan = (a, b) => [a[0], a[1], b[0], b[1]];
  return {
    back: reptileScales({ colour: item.colour, belly: item.belly, rows: 150, around: 28, seed: 11 }),
    belly: bellyPlates({ belly: item.belly, colour: item.colour, rows: 96 }),
    head: reptileScales({ colour: item.colour, belly: item.belly, rows: 34, around: 30, seed: 12, ridge: 0.25, blotch: 0.3, flankBelly: 0.2 }),
    jaw: bellyPlates({ belly: item.belly, colour: item.colour, rows: 22, sideColour: 0.6 }),
    limb: reptileScales({ colour: darker(item.colour, 0.9), belly: item.belly, rows: 36, around: 16, seed: 13, ridge: 0.25, blotch: 0.2, flankBelly: 0.25 }),
    wing: wingMembrane({
      colour: item.wings,
      box: DRAGON_WING,
      centre: wrist,
      bones: [plan(shoulder, elbow), plan(elbow, wrist), ...tips.map((tip) => plan(wrist, tip)), plan(shoulder, root)],
    }),
    horn: hornGradient({ base: darker(item.belly, 0.55), tip: darker(item.belly, 1.12) }),
    spike: hornGradient({ base: item.wings, tip: darker(item.wings, 1.25), rings: 6 }),
    claw: hornGradient({ base: "#3a3128", tip: "#e9dfc7", rings: 4 }),
    eye: eyeIris({ iris: item.eyes, slit: 0.26 }),
  };
}

/*
 * Дракон. Части: тело (`body`), глаза (`glow`), огонь в пасти и ноздрях
 * (`flame`); спина и перепонки — в `skin`, если у модели лого или текстура.
 */
export function buildDragon(item, meshes, atlas, ctx) {
  const { body, glow, flame } = meshes;
  const paint = dragonMaterials(item);
  const map = {
    back: atlas.region("back", [0, 0, 1024, 256], paint.back, 6),
    belly: atlas.region("belly", [0, 256, 1024, 128], paint.belly),
    jaw: atlas.region("jaw", [0, 384, 256, 128], paint.jaw),
    limb: atlas.region("limb", [256, 384, 256, 128], paint.limb),
    horn: atlas.region("horn", [512, 384, 256, 64], paint.horn, 3),
    spike: atlas.region("spike", [512, 448, 256, 64], paint.spike, 3),
    eye: atlas.region("eye", [768, 384, 128, 128], paint.eye),
    claw: atlas.region("claw", [896, 384, 128, 64], paint.claw, 3),
    wing: atlas.region("wing", [0, 512, 512, 512], paint.wing, 6),
    head: atlas.region("head", [512, 512, 512, 256], paint.head),
  };
  const teeth = atlas.uv("#efe6cf");
  const gums = atlas.uv(darker(item.wings, 0.6));
  const { shoulder, elbow, wrist, tips, thumb, root } = DRAGON_WING_BONES;
  /* Крылья машут от плеча (лапы и голова стоят), кончик хвоста чуть ходит. */
  const span = tips[0][0];
  flexAll(meshes, ([x, y, z]) => Math.max(Math.pow(clamp01((Math.abs(x) - 1.2) / (span - 1.2)), 1.35) * smooth(-0.6, 0.4, z), 0.3 * smooth(-6, -16.8, y)));

  /* Туловище: спина и бока (чешуя) и брюхо (щитки) — одним сечением. */
  const section = (frame, angle) => {
    const [rx, rz, keel] = frame.extra;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const px = Math.sign(c) * Math.pow(Math.abs(c), 0.86);
    const pz = Math.sign(s) * Math.pow(Math.abs(s), 0.86);
    const ridge = 0.07 * rz * Math.exp(-(((angle - Math.PI / 2) / 0.24) ** 2));
    return [rx * px, rz * pz * (s < 0 ? 1 + keel * -s : 1) + ridge];
  };
  const [low, high] = DRAGON_BACK.map((value) => value * DEG);
  const back = placeOn(meshes, body, ctx, "body", map.back);
  sweepAlong(back.mesh, DRAGON_FRAMES, section, { segments: 30, from: low, to: high, uv: (i, j, p, frame, angle) => back.uv(1 - frame.t, (angle - low) / (high - low)) });
  sweepAlong(body, DRAGON_FRAMES, section, { segments: 14, from: high, to: low + Math.PI * 2, uv: (i, j, p, frame, angle) => map.belly(1 - frame.t, (angle - high) / (low + Math.PI * 2 - high)) });

  /* Голова: череп с верхней челюстью — плоский снизу (нёбо), надбровья, скулы. */
  const headFrames = curveFrames(DRAGON_HEAD, 64);
  sweepAlong(
    body,
    headFrames,
    (frame, angle) => {
      const [rx, rz] = frame.extra;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const t = frame.t;
      const cheek = 1 + 0.14 * Math.exp(-(((t - 0.16) / 0.13) ** 2)) * Math.abs(c);
      const browBump = Math.exp(-(((t - 0.36) / 0.11) ** 2));
      const brow = 0.1 * browBump * (Math.exp(-(((angle - 52 * DEG) / (16 * DEG)) ** 2)) + Math.exp(-(((angle - 128 * DEG) / (16 * DEG)) ** 2)));
      const x = rx * cheek * Math.sign(c) * Math.pow(Math.abs(c), 0.9);
      return [x, s >= 0 ? rz * s * 0.96 + brow : rz * s * 0.58];
    },
    { segments: 32, uv: (i, j, p, frame, angle) => map.head(frame.t, angle / (Math.PI * 2)) },
  );
  /* Нижняя челюсть — приоткрыта: в пасти огонь. */
  const jawFrames = curveFrames(DRAGON_JAW, 40);
  sweepAlong(
    body,
    jawFrames,
    (frame, angle) => {
      const [rx, rz] = frame.extra;
      const s = Math.sin(angle);
      return [rx * Math.cos(angle), s > 0 ? rz * s * 0.42 : rz * s];
    },
    { segments: 24, uv: (i, j, p, frame, angle) => map.jaw(frame.t, angle / (Math.PI * 2)) },
  );
  ellipsoid(flame, null, [0, 9.15, 2.06], [0.27, 0.95, 0.1], atlas.uv(item.eyes), { segments: 12, rings: 8 });
  /* Дёсны и зубы: сверху — вниз, снизу — вверх; клыки впереди крупнее. */
  for (const { p } of SIDES) {
    for (let y = 8.55; y <= 10.45; y += 0.2) {
      const head = DRAGON_HEAD.at((y - 7.05) / (10.95 - 7.05));
      const jaw = DRAGON_JAW.at((y - 7.55) / (10.62 - 7.55));
      const fang = y > 10.05 && y < 10.35 ? 1.8 : 1;
      const upper = [head[3] * 0.84, y, head[2] - head[4] * 0.5];
      spike(body, p(upper), [0, 0.15, -1], 0.11 * fang, 0.035 * fang, [0, 0.02, 0], teeth, { rings: 3, segments: 5 });
      if (y < 10.3) {
        const lower = [jaw[3] * 0.82, y, jaw[2] + jaw[4] * 0.35];
        spike(body, p(lower), [0, 0.1, 1], 0.09 * fang, 0.03 * fang, [0, 0.02, 0], teeth, { rings: 3, segments: 5 });
      }
    }
    tubeCurve(
      body,
      [8.4, 9.2, 10.0, 10.5].map((y) => {
        const head = DRAGON_HEAD.at((y - 7.05) / (10.95 - 7.05));
        return [...p([head[3] * 0.86, y, head[2] - head[4] * 0.52]), 0.04];
      }),
      { rings: 10, segments: 5, uv: gums },
    );
  }

  for (const { id, p } of SIDES) {
    /* Глаз светится: радужка со щелью зрачка. */
    ellipsoid(glow, null, p([0.6, 8.2, 2.82]), [0.14, 0.22, 0.13], eyeUv(map.eye), { segments: 14, rings: 10, axes: eyeAxes(p([1, 0.42, 0.32])) });
    /* Надбровье, рога назад и вверх, малые рога у скул, ноздри. */
    tubeCurve(body, [[...p([0.42, 7.75, 3.18]), 0.11], [...p([0.62, 8.25, 3.1]), 0.1], [...p([0.55, 8.78, 2.92]), 0.05]], { rings: 10, segments: 7, uv: (t, a) => map.head(0.3 + t * 0.15, a) });
    tubeCurve(
      body,
      [
        [...p([0.34, 7.55, 3.18]), 0.2],
        [...p([0.5, 6.9, 3.62]), 0.155],
        [...p([0.62, 6.05, 3.88]), 0.11],
        [...p([0.68, 5.25, 3.9]), 0.06],
        [...p([0.66, 4.65, 3.72]), 0],
      ],
      { rings: 20, segments: 9, uv: map.horn },
    );
    tubeCurve(
      body,
      [
        [...p([0.66, 7.45, 2.62]), 0.11],
        [...p([0.98, 6.95, 2.7]), 0.075],
        [...p([1.2, 6.5, 2.92]), 0],
      ],
      { rings: 10, segments: 7, uv: map.horn },
    );
    ellipsoid(flame, null, p([0.15, 10.62, 2.3]), [0.055, 0.085, 0.045], atlas.uv(item.eyes), { segments: 7, rings: 5 });
    /* Гребень за щекой — три луча с перепонкой. */
    const frillBase = p([0.58, 7.25, 2.42]);
    const frillTips = [p([1.3, 6.45, 3.05]), p([1.48, 6.42, 2.45]), p([1.28, 6.55, 1.88])];
    twoSided(
      { up: body },
      6,
      8,
      (a, b) => {
        const edge = polyline(frillTips)(b / 8);
        const scallop = 0.2 * Math.sin(((b / 8) * 2 * Math.PI) % Math.PI) * (a / 6) ** 2;
        return mix(frillBase, mix(edge, frillBase, scallop), a / 6);
      },
      { uvUp: (i, j) => map.spike(i / 6, j / 8), toward: p([1, 0, 0]) },
    );
    for (const tip of frillTips) spike(body, frillBase, unit(sub(tip, frillBase)), length(sub(tip, frillBase)) * 1.05, 0.05, [0, 0, 0], map.spike, { rings: 4, segments: 5 });

    /* Лапы поджаты: передние — под грудь, задние — назад; пальцы с когтями. */
    const front = [
      [...p([0.8, 2.0, -0.3]), 0.42],
      [...p([1.18, 1.75, -0.95]), 0.33],
      [...p([1.3, 1.55, -1.45]), 0.25],
      [...p([1.22, 2.15, -1.85]), 0.19],
      [...p([1.14, 2.75, -2.02]), 0.16],
    ];
    const hind = [
      [...p([0.95, -3.1, -0.3]), 0.62],
      [...p([1.32, -2.6, -0.95]), 0.52],
      [...p([1.45, -2.2, -1.45]), 0.32],
      [...p([1.36, -3.0, -1.95]), 0.22],
      [...p([1.3, -3.7, -2.18]), 0.18],
      [...p([1.22, -4.55, -2.42]), 0.14],
    ];
    limbChain(body, front, map.limb);
    limbChain(body, hind, map.limb);
    for (const [paw, forward, curl] of [
      [front.at(-1).slice(0, 3), [0, 1, -0.35], [0, 0.05, -0.12]],
      [hind.at(-1).slice(0, 3), [0, -1, -0.15], [0, -0.04, -0.12]],
    ])
      for (const spread of [-0.5, -0.17, 0.17, 0.5]) {
        const direction = unit(add(forward, [spread * (id === "left" ? -1 : 1), 0, 0]));
        const knuckle = add(paw, scale(direction, 0.2));
        const end = add(add(paw, scale(direction, 0.36)), curl);
        tubeCurve(body, [[...paw, 0.075], [...knuckle, 0.06], [...end, 0.05]], { rings: 6, segments: 6, uv: map.limb });
        spike(body, end, unit(add(direction, [0, 0, -0.9])), 0.17, 0.05, scale(direction, -0.04), map.claw, { rings: 4, segments: 6 });
      }

    /* Крыло: кости. */
    const bone = (points, rings = 18) => tubeCurve(body, points.map(([point, r]) => [...p(point), r]), { rings, segments: 9, uv: map.limb });
    bone([
      [shoulder, 0.3],
      [add(mix(shoulder, elbow, 0.5), [0, 0, 0.08]), 0.24],
      [elbow, 0.25],
    ]);
    bone([
      [elbow, 0.24],
      [add(mix(elbow, wrist, 0.5), [0, 0.1, 0.06]), 0.19],
      [wrist, 0.19],
    ]);
    ellipsoid(body, null, p(elbow), [0.27, 0.27, 0.25], map.limb(0.5, 0.5), { segments: 10, rings: 7 });
    ellipsoid(body, null, p(wrist), [0.21, 0.21, 0.2], map.limb(0.5, 0.5), { segments: 10, rings: 7 });
    const fingers = tips.map(fingerCurve);
    for (const finger of fingers) {
      tubeCurve(
        body,
        [0, 0.25, 0.5, 0.75, 1].map((t) => [...p(finger.at(t).slice(0, 3)), lerp(0.14, 0.035, t)]),
        { rings: 16, segments: 7, uv: map.limb },
      );
    }
    bone([
      [wrist, 0.11],
      [thumb, 0.07],
    ], 6);
    spike(body, p(thumb), unit(p([0.2, 0.7, 0.3])), 0.3, 0.07, p([0, 0.0, -0.06]), map.claw, { rings: 4, segments: 6 });

    /* Перепонка: между пальцами, от последнего пальца к боку, перед рукой. Кромка — фестоном к запястью. */
    const membraneTarget = meshes.skin ? { up: meshes.skin, down: meshes.skin } : { up: body, down: body };
    const plan = (point) => [(Math.abs(point[0]) - DRAGON_WING.a0) / (DRAGON_WING.a1 - DRAGON_WING.a0), (DRAGON_WING.b1 - point[1]) / (DRAGON_WING.b1 - DRAGON_WING.b0)];
    const wingUv = (side) => (i, j, point) => {
      const [u, v] = plan(point);
      return meshes.skin ? ctx.skinUv(`wing-${id}-${side}`, u, v) : map.wing(u, v);
    };
    const panel = (at, rows, cols) => twoSided(membraneTarget, rows, cols, (i, j) => p(at(i / rows, j / cols)), { uvUp: wingUv("top"), uvDown: wingUv("bottom") });
    const billow = (point, a, b, size) => add(point, [0, 0, size * Math.sin(Math.PI * a) * Math.sin(Math.PI * b)]);
    const scallop = (from, to, depth) => (b) => {
      const straight = mix(from, to, b);
      return mix(straight, wrist, depth * Math.sin(Math.PI * b));
    };
    for (let index = 0; index + 1 < fingers.length; index += 1) {
      const [a0, a1] = [fingers[index], fingers[index + 1]];
      const edge = scallop(tips[index], tips[index + 1], 0.16);
      const at = coons(
        () => [...wrist],
        edge,
        (a) => a0.at(a).slice(0, 3),
        (a) => a1.at(a).slice(0, 3),
      );
      panel((a, b) => billow(at(a, b), a, b, 0.22), 14, 10);
    }
    /* Внутренний лоскут: от четвёртого пальца по руке к плечу и по боку к корню. */
    const arm = polyline([wrist, elbow, shoulder]);
    const inner = coons(
      (b) => arm(b),
      scallop(tips[3], root, 0.12),
      (a) => fingers[3].at(a).slice(0, 3),
      (a) => mix(shoulder, root, a),
    );
    panel((a, b) => billow(inner(a, b), a, b, 0.3), 14, 16);
    /* Перед рукой: от плеча к запястью, кромка выгнута вперёд. */
    const lead = coons(
      (b) => arm(1 - b),
      (b) => add(mix(shoulder, wrist, b), [0, 0.55 * Math.sin(Math.PI * b), 0.12 * Math.sin(Math.PI * b)]),
      () => [...shoulder],
      () => [...wrist],
    );
    panel((a, b) => lead(a, b), 4, 16);
  }

  /* Шипы по хребту: от затылка до хвоста, крупнее над плечами. */
  for (let t = 0.06; t <= 0.93; t += 0.028) {
    const frame = DRAGON_FRAMES[Math.round(t * (DRAGON_FRAMES.length - 1))];
    const [, rz] = frame.extra;
    const base = add(frame.centre, scale(frame.up, rz * 0.98));
    const size = (0.3 + 0.75 * Math.exp(-(((t - 0.7) / 0.2) ** 2)) + 0.25 * rz) * (t > 0.9 ? 0.8 : 1);
    const direction = unit(add(frame.up, scale(frame.forward, -0.75)));
    spike(body, base, direction, size, 0.16 + 0.2 * rz, scale(frame.forward, -0.15 * size), map.spike, { rings: 5, segments: 8, flat: 0.32, side: [1, 0, 0] });
  }
  /* Наконечник хвоста — двусторонний «наконечник копья». */
  const tailBase = [0, -14.75, -0.9];
  const tailTip = [0, -16.9, -1.02];
  twoSided(
    { up: body },
    10,
    8,
    (i, j) => {
      const a = i / 10;
      const b = j / 4 - 1;
      const width = a < 0.32 ? 1.0 * Math.sin((a / 0.32) * (Math.PI / 2)) : Math.pow(1 - (a - 0.32) / 0.68, 1.4);
      const point = mix(tailBase, tailTip, a);
      return [b * width, point[1] - 0.18 * width * Math.abs(b) ** 1.6, point[2] + 0.04 * (1 - b * b) * width];
    },
    { uvUp: (i, j) => map.spike(i / 10, j / 8) },
  );
}

/* ------------------------------------------------------------------ *
 * Перья
 * ------------------------------------------------------------------ */

/*
 * Перо: от основания `base` в сторону `direction` (единичный) на `size`;
 * ширина половины опахала `width(t)` (t — доля длины), переднее опахало
 * уже (`lead`), заднее шире (`trail`); стержень приподнят (`vdepth`), конец
 * загнут вверх (`curl`, м) и вбок (`bend`, вектор, м). Ответ — точка
 * `(t, s)`, s = −1…1 поперёк (−1 — заднее опахало).
 */
function featherAt(base, direction, size, width, { lead = 0.7, trail = 1, vdepth = 0.18, curl = 0, bend = [0, 0, 0], up = [0, 0, 1] } = {}) {
  const side = unit(cross(up, direction));
  const lift = unit(cross(direction, side));
  return (t, s) => {
    const axis = add(add(base, scale(direction, size * t)), add(scale(lift, curl * t * t), scale(bend, t * t)));
    const w = width(t) * (s > 0 ? lead : trail);
    return add(add(axis, scale(side, s * w)), scale(lift, -Math.abs(s) * vdepth * width(t)));
  };
}

/*
 * Перо двумя частями: основание (`base` — `{ mesh, uv }`) до доли `split`
 * и горящий конец (`tip`) после неё; у каждой стороны — своя развёртка
 * (u — вдоль своей части, v — поперёк). Без `tip` — всё основанием.
 */
function feather(at, { base, tip = null, split = 1, rows = 10, cols = 4 }) {
  const baseRows = tip ? Math.max(2, Math.round(rows * split)) : rows;
  const end = tip ? split : 1;
  const uvBase = (i, j) => base.uv(i / baseRows, j / cols);
  twoSided({ up: base.mesh }, baseRows, cols, (i, j) => at((i / baseRows) * end, (j / cols) * 2 - 1), { uvUp: uvBase });
  if (!tip) return;
  const tipRows = Math.max(2, rows - baseRows);
  twoSided({ up: tip.mesh }, tipRows, cols, (i, j) => at(split + (i / tipRows) * (1 - split), (j / cols) * 2 - 1), { uvUp: (i, j) => tip.uv(i / tipRows, j / cols) });
}

/* Направление в плане: угол от +X к −Y (0 — наружу по крылу, 90° — назад) и наклон вниз. */
const planDirection = (degrees, drop = 0) => unit([Math.cos(degrees * DEG), -Math.sin(degrees * DEG), -drop]);

/* ------------------------------------------------------------------ *
 * Феникс
 * ------------------------------------------------------------------ */

/* Хребет феникса от основания хвоста до клюва: `[x, y, z, rx, rz, киль]`. */
const PHOENIX_SPINE_POINTS = Object.freeze([
  [0, -3.55, 0.3, 0.05, 0.05, 0],
  [0, -3.0, 0.18, 0.27, 0.22, 0],
  [0, -2.2, 0.08, 0.5, 0.44, 0.04],
  [0, -1.1, 0.02, 0.68, 0.66, 0.1],
  [0, 0.2, 0.06, 0.8, 0.8, 0.22],
  [0, 1.3, 0.26, 0.74, 0.78, 0.26],
  [0, 2.1, 0.62, 0.52, 0.56, 0.1],
  [0, 2.75, 1.05, 0.37, 0.39, 0],
  [0, 3.3, 1.38, 0.34, 0.35, 0],
  [0, 3.85, 1.54, 0.39, 0.38, 0],
  [0, 4.3, 1.52, 0.31, 0.3, 0],
  [0, 4.55, 1.45, 0.17, 0.16, 0],
  [0, 4.62, 1.43, 0.02, 0.02, 0],
]);
const PHOENIX_SPINE = curve(PHOENIX_SPINE_POINTS);
const PHOENIX_FRAMES = curveFrames(PHOENIX_SPINE, 110);
export const PHOENIX_BACK = Object.freeze([-25, 205]);
/** Длина тела феникса от хвоста до клюва, м (развёртка спины). */
export const PHOENIX_LENGTH = PHOENIX_SPINE.length;

/* Крыло феникса (правое): передняя кромка и линия, откуда выходят маховые; кисть. */
const PHOENIX_LEADING = curve([
  [0.35, 1.2, 0.62],
  [3.2, 0.95, 0.92],
  [6.1, 1.25, 1.17],
  [8.5, 0.7, 1.25],
]);
const PHOENIX_TRAILING = curve([
  [0.4, -1.75, 0.5],
  [3.3, -1.65, 0.78],
  [6.1, -1.2, 1.02],
  [8.5, 0.3, 1.2],
]);
/** Крыло феникса в плане: |x| и y, м — рамка развёртки кроющих (на них лого). */
export const PHOENIX_WING = Object.freeze({ a0: 0.3, a1: 8.7, b0: -1.9, b1: 1.5 });
const PHOENIX_HAND = Object.freeze({ tip: Object.freeze([8.4, 0.45, 1.18]), wrist: Object.freeze([6.2, 0.1, 1.08]) });

/** Рисунки феникса по кускам листа. */
export function phoenixMaterials(item) {
  return {
    back: softFeathers({ from: item.flame, to: item.colour, rows: 64, around: 26, seed: 21, mixAt: [0.1, 0.36] }),
    belly: softFeathers({ from: item.flame, to: item.wings, rows: 50, around: 12, seed: 22, mixAt: [0.05, 0.4], lightEdge: 0.1 }),
    covert: softFeathers({ from: item.colour, to: item.wings, rows: 14, around: 26, seed: 23, mixAt: [0.2, 1.1] }),
    feather: featherVane({ base: item.colour, tip: item.wings, barbs: 40, seed: 24 }),
    tail: featherVane({ base: item.colour, tip: item.wings, barbs: 120, seed: 25, edgeDark: 0.12 }),
    flame: flameTip({ base: item.wings, flame: item.flame, seed: 26 }),
    beak: hornGradient({ base: item.flame, tip: darker(item.flame, 0.45), rings: 3 }),
    leg: hornGradient({ base: darker(item.flame, 0.8), tip: darker(item.flame, 0.6), rings: 14 }),
    eye: eyeIris({ iris: item.flame, slit: 1.6 }),
  };
}

/*
 * Феникс: огненная птица ~9 м, размах ~25 м, хвост перьями ещё на 9 м.
 * Части: тело и перья (`body`), грудь и глаза светятся (`glow`), концы
 * перьев горят (`flame`); спина и кроющие крыльев — в `skin` с лого.
 */
export function buildPhoenix(item, meshes, atlas, ctx) {
  const { body, glow, flame } = meshes;
  const paint = phoenixMaterials(item);
  const map = {
    back: atlas.region("back", [0, 0, 1024, 256], paint.back, 6),
    belly: atlas.region("belly", [0, 256, 1024, 128], paint.belly),
    feather: atlas.region("feather", [0, 384, 512, 128], paint.feather),
    flame: atlas.region("flame", [512, 384, 512, 128], paint.flame),
    covert: atlas.region("covert", [0, 512, 512, 512], paint.covert, 6),
    tail: atlas.region("tail", [512, 512, 512, 128], paint.tail),
    beak: atlas.region("beak", [512, 640, 256, 64], paint.beak, 3),
    leg: atlas.region("leg", [512, 704, 256, 64], paint.leg, 3),
    eye: atlas.region("eye", [768, 640, 128, 128], paint.eye),
  };
  flexAll(meshes, ([x, y, z]) => Math.max(Math.pow(clamp01((Math.abs(x) - 0.6) / 12), 1.25) * smooth(-0.4, 0.3, z), 0.35 * smooth(-3.5, -12.6, y)));
  const featherPart = { mesh: body, uv: map.feather };
  const flamePart = { mesh: flame, uv: map.flame };

  /* Тело: спина мелкими перьями (золото головы к красной спине), грудь светится. */
  const section = (frame, angle) => {
    const [rx, rz, keel] = frame.extra;
    const s = Math.sin(angle);
    return [rx * Math.cos(angle), rz * s * (s < 0 ? 1 + keel * -s : 1)];
  };
  const [low, high] = PHOENIX_BACK.map((value) => value * DEG);
  const back = placeOn(meshes, body, ctx, "body", map.back);
  sweepAlong(back.mesh, PHOENIX_FRAMES, section, { segments: 28, from: low, to: high, uv: (i, j, p, frame, angle) => back.uv(1 - frame.t, (angle - low) / (high - low)) });
  sweepAlong(glow, PHOENIX_FRAMES, section, { segments: 12, from: high, to: low + Math.PI * 2, uv: (i, j, p, frame, angle) => map.belly(1 - frame.t, (angle - high) / (low + Math.PI * 2 - high)) });

  /* Клюв крючком: надклювье и подклювье. */
  const beak = (points, rings) =>
    sweepAlong(body, curveFrames(curve(points), rings), (frame, angle) => [frame.extra[0] * Math.cos(angle), frame.extra[1] * Math.sin(angle)], {
      segments: 10,
      uv: (i, j, p, frame, angle) => map.beak(frame.t, angle / (Math.PI * 2)),
    });
  beak(
    [
      [0, 4.38, 1.52, 0.17, 0.2],
      [0, 4.75, 1.47, 0.13, 0.17],
      [0, 5.05, 1.36, 0.085, 0.12],
      [0, 5.25, 1.2, 0.045, 0.065],
      [0, 5.3, 1.03, 0.0, 0.0],
    ],
    18,
  );
  beak(
    [
      [0, 4.38, 1.33, 0.14, 0.09],
      [0, 4.75, 1.27, 0.095, 0.065],
      [0, 5.0, 1.22, 0.0, 0.0],
    ],
    10,
  );

  /* Хохолок: семь длинных перьев назад и вверх, концы горят. */
  for (let index = 0; index < 7; index += 1) {
    const k = index / 6;
    const base = [(k - 0.5) * 0.18, 3.9 - k * 0.25, 1.86];
    const direction = unit([(k - 0.5) * 0.35, -0.35 - 0.9 * k, 1.1 - 0.55 * k]);
    const size = 1.15 + 0.85 * Math.sin(k * Math.PI);
    feather(featherAt(base, direction, size, (t) => 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.02, { curl: -0.25, lead: 1, trail: 1, up: [1, 0, 0] }), { base: featherPart, tip: flamePart, split: 0.5, rows: 8, cols: 4 });
  }

  for (const { id, p } of SIDES) {
    /* Перо строится справа и отражается целиком: переднее опахало остаётся впереди. */
    const onSide = (at) => (t, s) => p(at(t, s));
    /* Глаз — золотом, светится. */
    ellipsoid(glow, null, p([0.28, 4.0, 1.64]), [0.09, 0.12, 0.1], eyeUv(map.eye), { segments: 12, rings: 8, axes: eyeAxes(p([1, 0.45, 0.15])) });

    /* Кроющие — одним телом крыла с выгнутым верхом: на них лого. */
    const covers = (a, b) => {
      const lead = PHOENIX_LEADING.at(b);
      const trail = PHOENIX_TRAILING.at(b);
      return add(mix(lead, trail, a), [0, 0, 0.14 * Math.sin(Math.PI * Math.min(1, a * 1.3)) * (1 - 0.6 * b)]);
    };
    const plan = (point) => [(Math.abs(point[0]) - PHOENIX_WING.a0) / (PHOENIX_WING.a1 - PHOENIX_WING.a0), (PHOENIX_WING.b1 - point[1]) / (PHOENIX_WING.b1 - PHOENIX_WING.b0)];
    const coverUv = (side) => (i, j, point) => {
      const [u, v] = plan(point);
      return meshes.skin ? ctx.skinUv(`wing-${id}-${side}`, u, v) : map.covert(u, v);
    };
    const coverMesh = meshes.skin || body;
    twoSided({ up: coverMesh }, 8, 28, (i, j) => p(covers(i / 8, j / 28)), { uvUp: coverUv("top"), uvDown: coverUv("bottom") });
    /* Передняя кромка — округлая: рука под перьями. */
    tubeCurve(
      body,
      [0, 0.25, 0.5, 0.75, 1].map((t) => [...p(PHOENIX_LEADING.at(t).map((value, axis) => value + [0, -0.06, -0.02][axis])), lerp(0.15, 0.06, t)]),
      { rings: 24, segments: 8, uv: (t, angle) => map.covert(lerp(0.05, 0.95, t), 0.08 + 0.04 * angle) },
    );

    /* Первичные маховые — веером с кисти; у внешних конец узкий («пальцы»). */
    const lengths = [4.0, 4.4, 4.6, 4.6, 4.45, 4.25, 4.0, 3.75, 3.5, 3.3];
    lengths.forEach((size, index) => {
      const k = index / (lengths.length - 1);
      const base = add(mix(PHOENIX_HAND.tip, PHOENIX_HAND.wrist, k * 0.9), [0, -0.05, -0.04 - 0.006 * index]);
      const slotted = index < 5;
      const width = (t) => {
        const full = 0.3 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.92)) + 0.04;
        return slotted ? full * (1 - 0.3 * smooth(0.55, 0.75, t)) : full;
      };
      feather(onSide(featherAt(base, planDirection(lerp(-6, 58, k), 0.02), size, width, { lead: 0.45, curl: 0.35 })), { base: featherPart, tip: flamePart, split: 0.64, rows: 11, cols: 4 });
    });
    /* Вторичные маховые и третьестепенные — с края кроющих назад. */
    const secondaries = 19;
    for (let index = 0; index < secondaries; index += 1) {
      const k = index / (secondaries - 1);
      const b = lerp(0.7, 0.03, k);
      const base = add(PHOENIX_TRAILING.at(b), [0, 0.5, -0.06 - 0.003 * index]);
      const size = index > secondaries - 4 ? 2.7 : 3.05;
      feather(onSide(featherAt(base, planDirection(lerp(64, 100, k), 0.03), size, (t) => 0.36 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92)) + 0.05, { lead: 0.6, curl: 0.12 })), {
        base: featherPart,
        tip: flamePart,
        split: 0.66,
        rows: 10,
        cols: 4,
      });
    }
    /* Большие кроющие — поверх оснований маховых. */
    for (let index = 0; index < 21; index += 1) {
      const k = index / 20;
      const b = lerp(0.97, 0.03, k);
      const base = add(PHOENIX_TRAILING.at(b), [0, 0.3, 0.03]);
      feather(onSide(featherAt(base, planDirection(lerp(40, 98, k), 0.02), 1.2, (t) => 0.3 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9)) + 0.04, { lead: 0.8, curl: 0.04 })), {
        base: featherPart,
        rows: 5,
        cols: 4,
      });
    }

    /* Лапы поджаты: цевка и пальцы с когтями — золотом. */
    tubeCurve(body, [[...p([0.32, -0.55, -0.5]), 0.1], [...p([0.36, -1.25, -0.68]), 0.075], [...p([0.36, -1.72, -0.76]), 0.06]], { rings: 10, segments: 8, uv: map.leg });
    for (const spread of [-0.35, 0, 0.35]) {
      const foot = p([0.36, -1.72, -0.76]);
      const direction = unit(p([spread, -1, -0.5]));
      spike(body, foot, direction, 0.35, 0.04, scale(p([0, 0.05, -0.08]), 1), map.leg, { rings: 4, segments: 6 });
    }
  }

  /* Хвост: семь длинных перьев волной, на конце — широкое опахало с огнём; веер коротких кроющих. */
  for (let index = -3; index <= 3; index += 1) {
    const reach = Math.abs(index);
    const path = curve([
      [index * 0.07, -3.3, 0.22],
      [index * 0.36, -6.4, -0.05 + 0.04 * reach],
      [index * 0.78, -9.5, -0.38 + 0.08 * reach],
      [index * 1.08, -12.7 + 0.4 * reach, -0.5 + 0.08 * reach],
    ]);
    const width = (t) => (t < 0.5 ? 0.05 : 0.05 + 0.4 * Math.sin(Math.PI * Math.min(1, (t - 0.5) / 0.52)) * (t > 0.96 ? (1 - t) / 0.04 : 1));
    const at = (t, s) => {
      const axis = path.at(t);
      const side = unit(cross([0, 0, 1], path.tangent(t)));
      return add(add(axis, scale(side, s * width(t))), [0, 0, -Math.abs(s) * 0.05 * width(t)]);
    };
    feather(at, { base: { mesh: body, uv: map.tail }, tip: flamePart, split: 0.66, rows: 22, cols: 4 });
  }
  for (let index = -4; index <= 4; index += 1) {
    const base = [index * 0.05, -2.95, 0.32];
    feather(featherAt(base, unit([Math.sin(index * 10 * DEG), -Math.cos(index * 10 * DEG), 0.05]), 1.9, (t) => 0.22 * Math.sin(Math.PI * Math.min(1, 0.1 + t)) + 0.03, { lead: 1, curl: 0.1, up: [0, 0, 1] }), {
      base: featherPart,
      rows: 7,
      cols: 4,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Кит
 * ------------------------------------------------------------------ */

/*
 * Хребет горбача от хвостового стебля до морды: `[x, y, z, rx, верх,
 * низ]` — низ головы глубже верха (горло), стебель сжат с боков.
 */
const WHALE_SPINE_POINTS = Object.freeze([
  [0, -15.9, 0.55, 0.14, 0.24, 0.24],
  [0, -14.8, 0.45, 0.32, 0.62, 0.55],
  [0, -12.6, 0.28, 0.8, 1.28, 1.12],
  [0, -9.6, 0.12, 1.58, 1.98, 1.82],
  [0, -5.8, 0.02, 2.48, 2.58, 2.58],
  [0, -1.6, 0.0, 3.08, 2.98, 3.08],
  [0, 2.6, 0.0, 3.38, 3.06, 3.32],
  [0, 6.6, 0.05, 3.32, 2.86, 3.42],
  [0, 10.2, 0.25, 2.96, 2.3, 3.22],
  [0, 12.8, 0.45, 2.36, 1.6, 2.66],
  [0, 14.7, 0.6, 1.62, 0.95, 1.86],
  [0, 15.8, 0.68, 0.86, 0.5, 1.0],
  [0, 16.25, 0.7, 0.1, 0.08, 0.12],
]);
const WHALE_SPINE = curve(WHALE_SPINE_POINTS);
const WHALE_FRAMES = curveFrames(WHALE_SPINE, 130);
export const WHALE_BACK = Object.freeze([-20, 200]);
/** Длина кита по хребту, м (развёртка спины). */
export const WHALE_LENGTH = WHALE_SPINE.length;
/* Складки горла: сколько их поперёк брюха и докуда они тянутся. */
const WHALE_GROOVES = 20;

/* Доля хребта (от хвоста) у места `y`. */
function whaleShare(y) {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (WHALE_SPINE.at(middle)[1] < y) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
/** Бока кита для лого: u развёртки спины (от головы) у y = 9 и y = −7. */
export const WHALE_FLANK_U = Object.freeze([1 - whaleShare(9), 1 - whaleShare(-7)]);

/* Сечение кита: верх и низ разной глубины, горб у спинного плавника, складки горла (угол — радианы). */
function whaleSection(frame, angle) {
  const [rx, top, bottom] = frame.extra;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const y = frame.centre[1];
  const hump = 0.16 * Math.exp(-(((y + 6.2) / 1.6) ** 2)) * Math.max(0, s) ** 6;
  let x = rx * Math.sign(c) * Math.pow(Math.abs(c), 0.92);
  let z = s >= 0 ? top * s + hump : bottom * s;
  /* Складки — только на брюхе (полоса 200°…340°), от подбородка до пупка. */
  const across = ((((angle / DEG - 200) % 360) + 360) % 360) / 140;
  if (across <= 1 && s < 0) {
    const fade = smooth(-2.5, 0.5, y) * smooth(15.9, 14.8, y) * smooth(0, 0.12, across) * smooth(1, 0.88, across);
    const groove = Math.exp(-(((((across * WHALE_GROOVES) % 1) - 0.5) / 0.16) ** 2));
    const k = 1 - 0.028 * groove * fade;
    x *= k;
    z *= k;
  }
  return [x, z];
}

/* Точка на коже кита: у места `y` под углом `angle` (рад), чуть наружу (`lift`, доля радиуса). */
function whaleSurface(y, angle, lift = 0) {
  const t = whaleShare(y);
  const frame = WHALE_FRAMES[Math.round(t * (WHALE_FRAMES.length - 1))];
  const [x, z] = whaleSection(frame, angle);
  return add(add(frame.centre, scale(frame.side, x * (1 + lift))), scale(frame.up, z * (1 + lift)));
}

/** Рисунки кита по кускам листа. */
export function whaleMaterials(item) {
  return {
    back: whaleSkin({ colour: item.colour, belly: item.belly, seed: 31 }),
    belly: whaleThroat({ belly: item.belly, colour: item.colour, grooves: WHALE_GROOVES, until: 0.58, seed: 32 }),
    fin: whaleFin({ colour: item.colour, belly: item.belly, seed: 33, pale: 0.45 }),
    fluke: whaleFin({ colour: item.colour, belly: item.belly, seed: 34, pale: 0.2 }),
    dorsal: whaleFin({ colour: item.colour, belly: item.colour, seed: 35, pale: 0.1 }),
  };
}

/*
 * Плавник по кривой размаха (середина хорды): полухорда `chord(t)`,
 * толщина — доля хорды, передняя кромка — в сторону `lead` (вектор),
 * бугорки кромки `bumps(t)` (множитель передней полухорды), зубцы задней
 * — `teeth(t)`. Развёртка: u — по размаху, v — по сечению так, что верх
 * плавника — v 0…0,5 (как ждёт рисунок плавника).
 */
function finSweep(mesh, points, { chord, thickness = 0.18, lead, bumps = () => 1, teeth = () => 1, rings = 24, segments = 14, uv }) {
  const path = curve(points);
  const frames = curveFrames(path, rings, lead);
  const flip = frames[Math.round(rings / 2)].up[2] < 0;
  sweepAlong(
    mesh,
    frames,
    (frame, angle) => {
      const c = Math.cos(angle);
      const half = chord(frame.t) * (c >= 0 ? bumps(frame.t) : teeth(frame.t));
      const thick = chord(frame.t) * thickness * (c >= 0 ? 1 : 0.55) * (1 - 0.35 * Math.abs(c) ** 4);
      return [half * c, thick * Math.sin(angle)];
    },
    { segments, uv: (i, j, p, frame, angle) => uv(frame.t, flip ? 1 - angle / (Math.PI * 2) : angle / (Math.PI * 2)) },
  );
}

/*
 * Небесный кит — горбач ~32 м: складки горла, бугорки на морде и нижней
 * челюсти, длинные грудные плавники с бугристой передней кромкой, горб со
 * спинным плавником, лопасти хвоста с зубчатой кромкой и вырезом. Светятся
 * точки вдоль боков (`glow`). Хвост бьёт вверх-вниз, плавники — вполсилы.
 */
export function buildWhale(item, meshes, atlas, ctx) {
  const { body, glow } = meshes;
  const paint = whaleMaterials(item);
  const map = {
    back: atlas.region("back", [0, 0, 1024, 512], paint.back, 6),
    belly: atlas.region("belly", [0, 512, 1024, 256], paint.belly, 6),
    fin: atlas.region("fin", [0, 768, 512, 128], paint.fin),
    fluke: atlas.region("fluke", [0, 896, 512, 128], paint.fluke),
    dorsal: atlas.region("dorsal", [512, 768, 256, 128], paint.dorsal),
  };
  flexAll(meshes, ([x, y]) => Math.max(smooth(-7, -19.5, y), 0.45 * smooth(3.4, 11.9, Math.abs(x))));

  const [low, high] = WHALE_BACK.map((value) => value * DEG);
  const back = placeOn(meshes, body, ctx, "body", map.back);
  sweepAlong(back.mesh, WHALE_FRAMES, whaleSection, { segments: 44, from: low, to: high, uv: (i, j, p, frame, angle) => back.uv(1 - frame.t, (angle - low) / (high - low)) });
  sweepAlong(body, WHALE_FRAMES, whaleSection, {
    segments: WHALE_GROOVES * 4,
    from: high,
    to: low + Math.PI * 2,
    uv: (i, j, p, frame, angle) => map.belly(1 - frame.t, (angle - high) / (low + Math.PI * 2 - high)),
  });

  const knob = atlas.uv(darker(item.colour, 1.1));
  const barnacle = atlas.uv("#d9d4c4");
  const dark = atlas.uv("#101216");
  for (const { p } of SIDES) {
    /* Линия пасти — от кончика морды назад и вниз, к глазу. */
    tubeCurve(
      body,
      [16.05, 15.2, 14.0, 12.6, 11.3, 10.5].map((y, index) => [...p(whaleSurface(y, (-12 - index * 4.5) * DEG, 0.004)), 0.05]),
      { rings: 24, segments: 5, uv: dark },
    );
    /* Глаз за углом пасти. */
    ellipsoid(body, null, p(whaleSurface(10.05, -26 * DEG, -0.01)), [0.16, 0.24, 0.18], dark, { segments: 10, rings: 7 });
    /* Бугорки на нижней челюсти. */
    for (let y = 11.2; y <= 15.6; y += 0.55) {
      const size = 0.12 + 0.05 * Math.sin(y * 3.1);
      ellipsoid(body, null, p(whaleSurface(y, (-30 + (y - 11) * 2.6) * DEG, -0.01)), [size, size * 1.1, size * 0.75], y > 14 ? barnacle : knob, { segments: 8, rings: 5 });
    }
    /* Грудной плавник: длинный, с бугорками по передней кромке, низ светлый. */
    const fin = [
      [2.65, 6.7, -1.5],
      [5.0, 5.45, -2.45],
      [8.0, 3.65, -3.4],
      [10.4, 2.05, -4.05],
      [11.95, 1.0, -4.38],
    ].map(p);
    finSweep(body, fin, {
      chord: (t) => lerp(1.2, 0.08, Math.pow(t, 1.4)),
      thickness: 0.2,
      lead: p([0.15, 1, 0]),
      bumps: (t) => 1 + 0.13 * Math.max(0, Math.sin(t * Math.PI * 10)) * smooth(0.12, 0.3, t),
      rings: 36,
      segments: 14,
      uv: map.fin,
    });
    /* Лопасть хвоста: стреловидная, задняя кромка в зубцах, у середины — вырез. */
    const fluke = [
      [0.02, -15.75, 0.52],
      [2.2, -16.5, 0.47],
      [4.3, -17.5, 0.38],
      [5.9, -18.55, 0.32],
    ].map(p);
    finSweep(body, fluke, {
      chord: (t) => lerp(1.0, 0.06, Math.pow(t, 1.6)),
      thickness: 0.17,
      lead: [0, 1, 0],
      teeth: (t) => (1 + 0.1 * Math.abs(Math.sin(t * Math.PI * 7))) * (0.55 + 0.45 * smooth(0, 0.16, t)),
      rings: 28,
      segments: 14,
      uv: map.fluke,
    });
    /* Светящиеся точки вдоль боков — двумя рядами. */
    for (let y = -10.5; y <= 9.6; y += 1.45) {
      for (const [angle, k] of [
        [34, 1],
        [6, 0.8],
      ]) {
        const size = (0.17 + 0.07 * Math.sin(y * 2.3 + angle)) * k;
        ellipsoid(glow, null, p(whaleSurface(y, angle * DEG, -0.004)), [size, size * 1.3, size], atlas.uv(item.spots), { segments: 8, rings: 5 });
      }
    }
  }
  /* Бугорки на морде — тремя рядами. */
  for (let y = 12.6; y <= 15.9; y += 0.62)
    for (const angle of [72, 90, 108]) {
      const size = 0.15 + 0.04 * Math.sin(y * 4 + angle);
      ellipsoid(body, null, whaleSurface(y + (angle === 90 ? 0.3 : 0), angle * DEG, -0.015), [size, size * 1.15, size * 0.7], knob, { segments: 8, rings: 5 });
    }
  /* Горб и спинной плавник. */
  finSweep(
    body,
    [
      [0, -5.6, 2.55],
      [0, -6.45, 2.98],
      [0, -7.35, 3.22],
    ],
    { chord: (t) => lerp(0.95, 0.04, Math.pow(t, 1.2)), thickness: 0.28, lead: [0, 1, 0], rings: 12, segments: 12, uv: map.dorsal },
  );
}

/* ------------------------------------------------------------------ *
 * Медуза
 * ------------------------------------------------------------------ */

/* Купол поднят на `JELLY_LIFT`: начало модели — её середина по высоте. */
export const JELLY_LIFT = 4.6;
/* Профиль купола от макушки к кромке `[r, z, 0]` (доля длины дуги — v развёртки). */
const JELLY_PROFILE = curve(
  [
    [0, 4.98],
    [1.1, 4.88],
    [2.3, 4.6],
    [3.6, 4.05],
    [4.7, 3.25],
    [5.5, 2.3],
    [6.0, 1.3],
    [6.15, 0.45],
    [6.0, 0.0],
  ].map(([r, z]) => [r, z + JELLY_LIFT, 0]),
);
/* Краевые лопасти: столько по кругу; щупальца — из выемок между ними. */
const JELLY_LOBES = 16;
const JELLY_ROWS = 26;
const JELLY_COLUMNS = JELLY_LOBES * 6;

/* Точка купола: v — от макушки (0) к кромке (1), u — по кругу от шва на +Y. Лопасти свисают, между ними — выемки. */
function jellyPoint(u, v, inset = 0) {
  const [r0, z0] = JELLY_PROFILE.at(v);
  const angle = Math.PI / 2 + Math.PI * 2 * u;
  const rim = smooth(0.74, 1, v);
  const lobe = 0.5 + 0.5 * Math.cos(JELLY_LOBES * Math.PI * 2 * u);
  const rib = 1 + 0.014 * Math.cos(JELLY_LOBES * Math.PI * 2 * u + Math.PI) * smooth(0.12, 0.4, v) * (1 - rim);
  const r = (r0 * (1 - 0.06 * rim * (1 - lobe)) * rib - inset) * (1 + 0.04 * rim * lobe);
  const z = z0 - 0.42 * rim * lobe - inset * 0.6;
  return [r * Math.cos(angle), r * Math.sin(angle), z];
}

/** Рисунки медузы по кускам листа. */
export function jellyMaterials(item) {
  return {
    bell: jellyBell({ colour: item.colour, rim: item.glow, gonad: item.tentacles, lobes: JELLY_LOBES, seed: 41 }),
    inner: jellyBell({ colour: item.glow, rim: item.colour, gonad: item.tentacles, lobes: JELLY_LOBES, seed: 42 }),
    arm: jellyArm({ colour: item.tentacles, edge: item.glow, seed: 43 }),
    tentacle: gradient({ from: item.tentacles, to: item.glow, bands: [0.2, 1], seed: 44 }),
  };
}

/*
 * Медуза: купол ~12 м с шестнадцатью краевыми лопастями и каналами
 * светится (`glow`), изнанка — своим цветом; по кромке огоньки (`flame`);
 * под куполом — четыре оборчатые ротовые лопасти до 10 м и 24 тонких
 * щупальца до 14 м. Купол дышит (кромка ходит), щупальца колышутся.
 */
export function buildJellyfish(item, meshes, atlas, ctx) {
  const { body, glow, flame } = meshes;
  const paint = jellyMaterials(item);
  const map = {
    bell: atlas.region("bell", [0, 0, 1024, 512], paint.bell, 6),
    inner: atlas.region("inner", [0, 512, 512, 256], paint.inner),
    arm: atlas.region("arm", [512, 512, 512, 256], paint.arm),
    tentacle: atlas.region("tentacle", [0, 768, 512, 64], paint.tentacle, 3),
  };
  flexAll(meshes, ([, , z]) => {
    const zr = z - JELLY_LIFT;
    return zr >= 0 ? 0.3 * (1 - zr / 4.98) : 0.3 + 0.7 * smooth(0, -13.5, zr);
  });
  /* Купол снаружи: с лого — в лист картинки по той же развёртке. */
  const bell = placeOn(meshes, glow, ctx, "bell", map.bell);
  surface(bell.mesh, JELLY_ROWS, JELLY_COLUMNS, (i, j) => jellyPoint(j / JELLY_COLUMNS, i / JELLY_ROWS), {
    wrap: true,
    uv: (i, j) => bell.uv(j / JELLY_COLUMNS, i / JELLY_ROWS),
  });
  /* Изнанка — своим цветом, лицом внутрь (видна снизу), и кромка между ними. */
  surface(glow, JELLY_ROWS, JELLY_COLUMNS, (i, j) => jellyPoint(j / JELLY_COLUMNS, i / JELLY_ROWS, 0.3), {
    wrap: true,
    flip: true,
    uv: (i, j) => map.inner(j / JELLY_COLUMNS, i / JELLY_ROWS),
  });
  surface(glow, 1, JELLY_COLUMNS, (i, j) => jellyPoint(j / JELLY_COLUMNS, 1, i * 0.3), { wrap: true, uv: (i, j) => map.bell(j / JELLY_COLUMNS, 0.99) });
  /* Огоньки — на концах лопастей. */
  for (let index = 0; index < JELLY_LOBES; index += 1) {
    const point = jellyPoint(index / JELLY_LOBES, 1);
    ellipsoid(flame, null, add(point, [0, 0, -0.08]), [0.17, 0.17, 0.14], atlas.uv(item.glow), { segments: 8, rings: 5 });
  }
  /* Ротовые лопасти: лента с оборками по краям, чуть закручена. */
  for (let arm = 0; arm < 4; arm += 1) {
    const start = Math.PI / 4 + (arm * Math.PI) / 2;
    const rows = 44;
    const cols = 10;
    const at = (i, j) => {
      const t = i / rows;
      const s = (j / cols) * 2 - 1;
      const turn = start + 0.7 * t;
      const out = [Math.cos(turn), Math.sin(turn), 0];
      const around = [-Math.sin(turn), Math.cos(turn), 0];
      const reach = 0.35 + 0.95 * Math.sin(Math.PI * t * 0.85);
      const centre = add(scale(out, reach), [0, 0, JELLY_LIFT + 0.3 - 10 * t]);
      const width = 0.95 * (1 - 0.55 * t) * Math.min(1, t * 8 + 0.3);
      const ruffle = 0.32 * Math.sin(t * 46 + s * 2.4 + arm) * s * s * (0.4 + 0.6 * t);
      return add(add(centre, scale(out, s * width)), scale(around, ruffle));
    };
    twoSided({ up: body }, rows, cols, at, { uvUp: (i, j) => map.arm(i / rows, j / cols), toward: [Math.cos(start + Math.PI / 2), Math.sin(start + Math.PI / 2), 0] });
  }
  /* Щупальца — тонкие, из выемок между лопастями и чуть глубже; светятся. */
  for (let index = 0; index < 24; index += 1) {
    const inner = index >= JELLY_LOBES;
    const u = inner ? (index - JELLY_LOBES + 0.25) / 8 : (index + 0.5) / JELLY_LOBES;
    const root = jellyPoint(u, inner ? 0.9 : 0.97, 0.15);
    const angle = Math.PI / 2 + Math.PI * 2 * u;
    const radial = [Math.cos(angle), Math.sin(angle), 0];
    const reach = 9.5 + 4.5 * (((index * 7) % 5) / 4);
    const points = [];
    for (let step = 0; step <= 5; step += 1) {
      const t = step / 5;
      const sway = 0.5 * Math.sin(3.2 * t + index * 1.7);
      const pull = -1.2 * t + sway;
      points.push([...add(add(root, scale(radial, pull)), [0, 0, -reach * t]), lerp(0.08, 0.016, t)]);
    }
    tubeCurve(glow, points, { rings: 20, segments: 5, uv: map.tentacle });
  }
}

/* ------------------------------------------------------------------ *
 * Пряди, общее у восточного дракона и грифона
 * ------------------------------------------------------------------ */

/* Прядь (грива, борода, кисточка): лента по плавной кривой `points`, ширина `width(t)`, поперёк — к `up`. */
function strand(target, points, width, { rows = 8, cols = 2, up = [0, 0, 1] } = {}) {
  const path = curve(points);
  const at = (t, s) => {
    const side = cross(up, path.tangent(t));
    const across = length(side) > 1e-6 ? unit(side) : [1, 0, 0];
    return add(path.at(t), scale(across, s * width(t)));
  };
  feather(at, { base: target, rows, cols });
}

/* Доля хребта (от хвоста) у места `y` — для хребта, идущего по y монотонно. */
function shareAt(path, y) {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (path.at(middle)[1] < y) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/* Точка на коже протяжки: рамка `frame`, угол `angle` (рад), радиус — `k` долей сечения. */
const onSurface = (frame, angle, k = 1) => {
  const [rx, rz = rx] = frame.extra;
  return add(add(frame.centre, scale(frame.side, rx * k * Math.cos(angle))), scale(frame.up, rz * k * Math.sin(angle)));
};

/* Сечение тела рептилии: чуть квадратное, с килем снизу и гребнем сверху (`[rx, rz, киль]` в рамке). */
function reptileSection(frame, angle) {
  const [rx, rz, keel = 0] = frame.extra;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ridge = 0.06 * rz * Math.exp(-(((angle - Math.PI / 2) / 0.24) ** 2));
  return [rx * Math.sign(c) * Math.pow(Math.abs(c), 0.88), rz * Math.sign(s) * Math.pow(Math.abs(s), 0.88) * (s < 0 ? 1 + keel * -s : 1) + ridge];
}

/* ------------------------------------------------------------------ *
 * Восточный дракон
 * ------------------------------------------------------------------ */

/*
 * Хребет восточного дракона от кончика хвоста к затылку: змеем ~30 м,
 * изгибами вбок и вверх-вниз; `[x, y, z, rx, rz, киль]`.
 */
const EASTERN_SPINE_POINTS = Object.freeze([
  ...Array.from({ length: 17 }, (_, index) => {
    const s = index / 16;
    const y = 13.6 - 29 * s;
    const x = 3.0 * Math.sin(2.4 * Math.PI * s) * (0.25 + 0.75 * s);
    const z = 0.6 + 1.9 * Math.sin(2 * Math.PI * s) * (0.25 + 0.75 * s);
    const r = s < 0.15 ? lerp(0.74, 0.92, s / 0.15) : s < 0.5 ? 0.92 : lerp(0.92, 0.1, Math.pow((s - 0.5) / 0.5, 1.2));
    return Object.freeze([x, y, z, r, r * 1.04, s > 0.1 && s < 0.6 ? 0.06 : 0]);
  }).reverse(),
  /* Конец шеи сужается внутри головы — без среза. */
  Object.freeze([0, 14.3, 0.72, 0.4, 0.4, 0]),
]);
const EASTERN_SPINE = curve(EASTERN_SPINE_POINTS);
const EASTERN_FRAMES = curveFrames(EASTERN_SPINE, 160);
export const EASTERN_BACK = Object.freeze([-25, 205]);
/** Длина восточного дракона по хребту, м (развёртка спины). */
export const EASTERN_LENGTH = EASTERN_SPINE.length;
/** Бока для лого: u развёртки спины (от головы) — средняя треть тела. */
export const EASTERN_FLANK_U = Object.freeze([0.28, 0.52]);

const EASTERN_HEAD = curve([
  [0, 13.25, 0.64, 0.6, 0.6],
  [0, 13.95, 0.8, 0.78, 0.72],
  [0, 14.75, 0.84, 0.72, 0.62],
  [0, 15.55, 0.74, 0.56, 0.5],
  [0, 16.35, 0.68, 0.52, 0.46],
  [0, 16.85, 0.7, 0.44, 0.44],
  [0, 17.15, 0.66, 0.02, 0.02],
]);
const EASTERN_JAW = curve([
  [0, 13.9, 0.3, 0.56, 0.3],
  [0, 15.0, 0.06, 0.46, 0.25],
  [0, 16.0, -0.1, 0.37, 0.19],
  [0, 16.7, -0.15, 0.21, 0.11],
  [0, 16.92, -0.16, 0.02, 0.02],
]);

/** Рисунки восточного дракона по кускам листа. */
export function easternMaterials(item) {
  return {
    back: reptileScales({ colour: item.colour, belly: item.belly, rows: 84, around: 16, seed: 61, blotch: 0.25, flankBelly: 0.3 }),
    belly: bellyPlates({ belly: item.belly, colour: item.colour, rows: 110 }),
    head: reptileScales({ colour: item.colour, belly: item.belly, rows: 26, around: 22, seed: 62, ridge: 0.25, blotch: 0.2, flankBelly: 0.2 }),
    jaw: bellyPlates({ belly: item.belly, colour: item.colour, rows: 18, sideColour: 0.55 }),
    limb: reptileScales({ colour: item.colour, belly: item.belly, rows: 30, around: 14, seed: 63, ridge: 0.25, blotch: 0.15, flankBelly: 0.3 }),
    horn: hornGradient({ base: darker(item.belly, 0.7), tip: darker(item.belly, 1.15), rings: 10 }),
    spike: hornGradient({ base: item.mane, tip: darker(item.mane, 1.3), rings: 4 }),
    claw: hornGradient({ base: "#3a3128", tip: "#efe4c8", rings: 4 }),
    whisker: gradient({ from: item.belly, to: darker(item.belly, 1.25), seed: 64 }),
    mane: hairStrands({ from: darker(item.mane, 0.8), to: darker(item.mane, 1.3), seed: 65 }),
    eye: eyeIris({ iris: item.eyes, slit: 1.1 }),
  };
}

/*
 * Восточный дракон: змеиное тело ~30 м без крыльев, крупная чешуя и щитки
 * брюха, гребень по хребту, голова с широкой мордой, раскрытой пастью,
 * клыками и языком, ветвистые рога, длинные усы, борода, грива, брови;
 * четыре короткие лапы с когтями и кисточками у локтей, кисточка хвоста.
 * Летит волной тела: голова стоит, доля движения растёт к хвосту, а сдвиг
 * и поворот второй кости идут вполоборота — гребень волны бежит от головы
 * к хвосту. Глаза светятся.
 */
export function buildEasternDragon(item, meshes, atlas, ctx) {
  const { body, glow } = meshes;
  const paint = easternMaterials(item);
  const map = {
    back: atlas.region("back", [0, 0, 1024, 256], paint.back, 6),
    belly: atlas.region("belly", [0, 256, 1024, 128], paint.belly),
    jaw: atlas.region("jaw", [0, 384, 256, 128], paint.jaw),
    limb: atlas.region("limb", [256, 384, 256, 128], paint.limb),
    horn: atlas.region("horn", [512, 384, 256, 64], paint.horn, 3),
    spike: atlas.region("spike", [512, 448, 256, 64], paint.spike, 3),
    eye: atlas.region("eye", [768, 384, 128, 128], paint.eye),
    claw: atlas.region("claw", [896, 384, 128, 64], paint.claw, 3),
    whisker: atlas.region("whisker", [896, 448, 128, 64], paint.whisker, 3),
    head: atlas.region("head", [0, 512, 512, 256], paint.head),
    mane: atlas.region("mane", [512, 512, 512, 256], paint.mane),
  };
  const maneMesh = { mesh: body, uv: map.mane };
  const teeth = atlas.uv("#f3ead2");
  /* Голова стоит, доля растёт к хвосту: волна тела. */
  flexAll(meshes, ([, y]) => smooth(13.4, 4.5, y));

  const [low, high] = EASTERN_BACK.map((value) => value * DEG);
  const back = placeOn(meshes, body, ctx, "body", map.back);
  sweepAlong(back.mesh, EASTERN_FRAMES, reptileSection, { segments: 28, from: low, to: high, uv: (i, j, p, frame, angle) => back.uv(1 - frame.t, (angle - low) / (high - low)) });
  sweepAlong(body, EASTERN_FRAMES, reptileSection, { segments: 14, from: high, to: low + Math.PI * 2, uv: (i, j, p, frame, angle) => map.belly(1 - frame.t, (angle - high) / (low + Math.PI * 2 - high)) });

  /* Голова: широкая морда с шишкой носа, надбровья; нижняя челюсть раскрыта, в пасти язык. */
  sweepAlong(
    body,
    curveFrames(EASTERN_HEAD, 56),
    (frame, angle) => {
      const [rx, rz] = frame.extra;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const t = frame.t;
      const brow = 0.12 * Math.exp(-(((t - 0.42) / 0.1) ** 2)) * (Math.exp(-(((angle - 55 * DEG) / (18 * DEG)) ** 2)) + Math.exp(-(((angle - 125 * DEG) / (18 * DEG)) ** 2)));
      const nose = 0.1 * Math.exp(-(((t - 0.86) / 0.07) ** 2)) * Math.max(0, s) ** 2;
      return [rx * Math.sign(c) * Math.pow(Math.abs(c), 0.85), s >= 0 ? rz * s + brow + nose : rz * s * 0.55];
    },
    { segments: 32, uv: (i, j, p, frame, angle) => map.head(frame.t, angle / (Math.PI * 2)) },
  );
  sweepAlong(
    body,
    curveFrames(EASTERN_JAW, 36),
    (frame, angle) => {
      const [rx, rz] = frame.extra;
      const s = Math.sin(angle);
      return [rx * Math.cos(angle), s > 0 ? rz * s * 0.4 : rz * s];
    },
    { segments: 24, uv: (i, j, p, frame, angle) => map.jaw(frame.t, angle / (Math.PI * 2)) },
  );
  tubeCurve(
    body,
    [
      [0, 14.4, 0.42, 0.16],
      [0, 15.4, 0.28, 0.13],
      [0, 16.3, 0.3, 0.08],
      [0, 16.85, 0.5, 0.0],
    ],
    { rings: 14, segments: 8, uv: atlas.uv("#c2364a") },
  );

  for (const { id, p } of SIDES) {
    const sign = id === "left" ? -1 : 1;
    /* Зубы и клыки. */
    for (let y = 14.9; y <= 16.6; y += 0.22) {
      const head = EASTERN_HEAD.at((y - 13.25) / (17.15 - 13.25));
      const jaw = EASTERN_JAW.at((y - 13.9) / (16.92 - 13.9));
      const fang = y > 16.2 && y < 16.5 ? 2.2 : 1;
      spike(body, p([head[3] * 0.82, y, head[2] - head[4] * 0.5]), [0, 0.12, -1], 0.12 * fang, 0.04 * fang, [0, 0.02, 0], teeth, { rings: 3, segments: 5 });
      if (y < 16.45) spike(body, p([jaw[3] * 0.8, y, jaw[2] + jaw[4] * 0.32]), [0, 0.1, 1], 0.1 * fang, 0.035 * fang, [0, 0.02, 0], teeth, { rings: 3, segments: 5 });
    }
    /* Большие глаза светятся. */
    ellipsoid(glow, null, p([0.56, 14.8, 1.12]), [0.15, 0.22, 0.15], eyeUv(map.eye), { segments: 14, rings: 10, axes: eyeAxes(p([1, 0.5, 0.32])) });
    /* Рога-ветви: основной стержень и два отростка. */
    const beam = [
      [0.3, 14.2, 1.32, 0.13],
      [0.55, 13.4, 2.1, 0.1],
      [0.76, 12.5, 2.6, 0.065],
      [0.82, 11.8, 2.82, 0],
    ];
    tubeCurve(body, beam.map(([x, y, z, r]) => [...p([x, y, z]), r]), { rings: 18, segments: 8, uv: map.horn });
    tubeCurve(body, [[...p([0.5, 13.6, 1.95]), 0.065], [...p([0.58, 13.85, 2.3]), 0.04], [...p([0.6, 14.05, 2.6]), 0]], { rings: 8, segments: 6, uv: map.horn });
    tubeCurve(body, [[...p([0.7, 12.8, 2.48]), 0.05], [...p([0.85, 12.85, 2.8]), 0.03], [...p([0.98, 13.0, 3.05]), 0]], { rings: 8, segments: 6, uv: map.horn });
    /* Усы — длинные, волной назад и вниз. */
    tubeCurve(
      body,
      [
        [...p([0.36, 16.65, 0.62]), 0.065],
        [...p([1.3, 16.5, 0.35]), 0.05],
        [...p([2.4, 15.3, -0.35]), 0.035],
        [...p([3.0, 13.5, -0.15]), 0.022],
        [...p([3.35, 11.8, -0.6]), 0],
      ],
      { rings: 30, segments: 6, uv: map.whisker },
    );
    /* Брови — пряди назад и вверх. */
    for (const [dy, dz] of [
      [-0.9, 0.55],
      [-1.2, 0.35],
      [-1.0, 0.8],
    ]) {
      const root = p([0.5, 14.95, 1.38]);
      strand(maneMesh, [root, add(root, p([0.25, dy * 0.5, dz * 0.6])), add(root, p([0.4, dy, dz]))], (t) => 0.1 * (1 - t) + 0.01, { rows: 6, up: [1, 0, 0] });
    }
    /* Борода под подбородком. */
    for (let index = 0; index < 3; index += 1) {
      const root = p([0.12 + index * 0.1, 16.1 - index * 0.25, -0.32]);
      strand(maneMesh, [root, add(root, [0, -0.5, -0.6]), add(root, [0, -1.2, -1.0 - 0.2 * index])], (t) => 0.14 * (1 - t) + 0.01, { rows: 7, up: [1, 0, 0] });
    }
    /* Грива — от затылка вдоль шеи: пряди назад, наружу и вверх, волной. */
    for (let index = 0; index < 14; index += 1) {
      const y = 14.0 - index * 0.36;
      const frame = EASTERN_FRAMES[Math.round(shareAt(EASTERN_SPINE, Math.min(y, 13.5)) * (EASTERN_FRAMES.length - 1))];
      const angle = (id === "left" ? 118 : 62) * DEG;
      const root = y > 13.5 ? p([0.32, y, 1.35]) : onSurface(frame, angle, 0.92);
      const out = id === "left" ? scale(frame.side, -1) : frame.side;
      const size = 1.8 + 1.4 * Math.sin(Math.PI * Math.min(1, (index + 1) / 9));
      const tip = add(add(root, scale(frame.forward, -size)), add(scale(out, 0.7 + 0.15 * (index % 3)), scale(frame.up, 0.45 + 0.2 * Math.sin(index))));
      const middle = add(mix(root, tip, 0.5), add(scale(frame.up, 0.3 * Math.sin(index * 1.7)), scale(out, 0.2)));
      strand(maneMesh, [root, middle, tip], (t) => 0.34 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.85)) + 0.02, { rows: 8, up: frame.side });
    }
    /* Лапы: передние у шеи, задние — на середине тела; когти и кисточки у локтей. */
    for (const share of [0.82, 0.45]) {
      const frame = EASTERN_FRAMES[Math.round(share * (EASTERN_FRAMES.length - 1))];
      const out = scale(frame.side, sign);
      const [r] = frame.extra;
      const root = add(onSurface(frame, (id === "left" ? 200 : -20) * DEG, 0.7), [0, 0, 0]);
      const elbow = add(add(root, scale(out, 1.0)), add(scale(frame.up, -0.65), scale(frame.forward, -0.45)));
      const wrist = add(add(elbow, scale(frame.forward, 0.65)), add(scale(frame.up, -0.7), scale(out, 0.08)));
      const foot = add(add(wrist, scale(frame.forward, 0.3)), scale(frame.up, -0.16));
      limbChain(body, [[...root, r * 0.42], [...elbow, 0.3], [...wrist, 0.21], [...foot, 0.17]], map.limb, { segments: 10 });
      for (const spread of [-0.5, -0.17, 0.17, 0.5]) {
        const direction = unit(add(add(frame.forward, scale(out, spread)), scale(frame.up, -0.25)));
        const knuckle = add(foot, scale(direction, 0.26));
        const end = add(foot, scale(direction, 0.46));
        tubeCurve(body, [[...foot, 0.09], [...knuckle, 0.07], [...end, 0.055]], { rings: 5, segments: 6, uv: map.limb });
        spike(body, end, unit(add(direction, scale(frame.up, -0.9))), 0.26, 0.055, scale(direction, -0.06), map.claw, { rings: 4, segments: 6 });
      }
      for (let index = 0; index < 3; index += 1) {
        const tip = add(add(elbow, scale(frame.forward, -0.9 - 0.15 * index)), add(scale(out, 0.15 + 0.1 * index), scale(frame.up, -0.1 + 0.15 * index)));
        strand(maneMesh, [elbow, mix(elbow, tip, 0.5), tip], (t) => 0.12 * (1 - t) + 0.01, { rows: 5, up: frame.up });
      }
    }
  }

  /* Гребень по хребту — от затылка до хвоста. */
  for (let t = 0.05; t <= 0.965; t += 0.0185) {
    const frame = EASTERN_FRAMES[Math.round(t * (EASTERN_FRAMES.length - 1))];
    const [, rz] = frame.extra;
    const base = add(frame.centre, scale(frame.up, rz * 0.98));
    const size = 0.22 + 0.32 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.1 * rz;
    spike(body, base, unit(add(frame.up, scale(frame.forward, -0.8))), size, 0.1 + 0.1 * rz, scale(frame.forward, -0.12 * size), map.spike, { rings: 4, segments: 6, flat: 0.3, side: frame.side });
  }
  /* Кисточка хвоста — пряди веером. */
  const tailFrame = EASTERN_FRAMES[4];
  for (let index = -3; index <= 3; index += 1) {
    const root = tailFrame.centre;
    const tip = add(add(root, scale(tailFrame.forward, -2.2 + Math.abs(index) * 0.2)), add(scale(tailFrame.side, index * 0.32), scale(tailFrame.up, 0.25 * Math.cos(index))));
    strand(maneMesh, [root, add(mix(root, tip, 0.5), scale(tailFrame.up, 0.2 * Math.sin(index * 2))), tip], (t) => 0.2 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.9)) + 0.02, { rows: 7, up: tailFrame.up });
  }
}

/* ------------------------------------------------------------------ *
 * Грифон
 * ------------------------------------------------------------------ */

/* Хребет грифона от крупа до клюва: тело льва, грудь и шея орла. */
const GRIFFIN_SPINE = curve([
  [0, -3.9, 0.32, 0.12, 0.12, 0],
  [0, -3.45, 0.27, 0.56, 0.62, 0],
  [0, -2.2, 0.2, 0.7, 0.74, 0.05],
  [0, -0.8, 0.15, 0.64, 0.72, 0.1],
  [0, 0.6, 0.22, 0.74, 0.86, 0.2],
  [0, 1.7, 0.45, 0.68, 0.8, 0.2],
  [0, 2.6, 0.95, 0.48, 0.52, 0.05],
  [0, 3.3, 1.45, 0.36, 0.38, 0],
  [0, 3.9, 1.74, 0.37, 0.37, 0],
  [0, 4.4, 1.78, 0.33, 0.33, 0],
  [0, 4.75, 1.72, 0.2, 0.2, 0],
  [0, 4.85, 1.7, 0.02, 0.02, 0],
]);
const GRIFFIN_FRAMES = curveFrames(GRIFFIN_SPINE, 100);
export const GRIFFIN_BACK = Object.freeze([-25, 205]);
/** Длина тела грифона от крупа до клюва, м (развёртка спины). */
export const GRIFFIN_LENGTH = GRIFFIN_SPINE.length;

/* Крыло грифона (орла, правое): передняя кромка и линия, откуда выходят маховые; кисть. */
const GRIFFIN_LEADING = curve([
  [0.3, 1.65, 0.86],
  [2.6, 1.35, 1.26],
  [4.7, 1.6, 1.46],
  [6.6, 1.05, 1.52],
]);
const GRIFFIN_TRAILING = curve([
  [0.35, -0.95, 0.72],
  [2.6, -0.9, 1.06],
  [4.7, -0.55, 1.32],
  [6.6, 0.65, 1.49],
]);
/** Крыло грифона в плане: |x| и y, м — рамка развёртки кроющих (на них лого). */
export const GRIFFIN_WING = Object.freeze({ a0: 0.2, a1: 6.9, b0: -1.3, b1: 1.9 });
const GRIFFIN_HAND = Object.freeze({ tip: Object.freeze([6.5, 0.8, 1.5]), wrist: Object.freeze([4.8, 0.45, 1.38]) });

/** Рисунки грифона по кускам листа. */
export function griffinMaterials(item) {
  return {
    back: griffinCoat({ head: item.head, wings: item.wings, colour: item.colour, seed: 71 }),
    belly: griffinCoat({ head: item.head, wings: darker(item.head, 0.9), colour: darker(item.colour, 1.15), seed: 72, headTo: 0.3 }),
    covert: softFeathers({ from: item.wings, to: darker(item.wings, 0.85), rows: 14, around: 26, seed: 73, mixAt: [0.3, 1.1] }),
    feather: featherVane({ base: item.wings, tip: darker(item.wings, 0.6), shaft: darker(item.head, 0.9), barbs: 36, seed: 74 }),
    limb: fur({ colour: item.colour, seed: 75, strands: 90, around: 16 }),
    beak: hornGradient({ base: item.beak, tip: darker(item.beak, 0.4), rings: 3 }),
    claw: hornGradient({ base: "#2f2924", tip: "#cfc4ae", rings: 4 }),
    tuft: hairStrands({ from: darker(item.colour, 0.6), to: darker(item.colour, 0.35), seed: 76 }),
    eye: eyeIris({ iris: item.beak, slit: 1.6 }),
  };
}

/*
 * Грифон ~12 м, размах ~19 м: тело льва (шерсть, задние лапы с подушками,
 * хвост с кисточкой), голова, шея и грудь орла (белая голова, клюв крючком,
 * хмурые надбровья, перья-«уши»), передние лапы орла с когтями; крылья орла
 * — кроющие одним телом (на нём лого), большие кроющие, вторичные и
 * первичные маховые с разведёнными «пальцами». Крылья машут, хвост чуть
 * ходит; глаза светятся (`glow`).
 */
export function buildGriffin(item, meshes, atlas, ctx) {
  const { body, glow } = meshes;
  const paint = griffinMaterials(item);
  const map = {
    back: atlas.region("back", [0, 0, 1024, 256], paint.back, 6),
    belly: atlas.region("belly", [0, 256, 1024, 128], paint.belly),
    feather: atlas.region("feather", [0, 384, 512, 128], paint.feather),
    limb: atlas.region("limb", [512, 384, 256, 128], paint.limb),
    beak: atlas.region("beak", [768, 384, 256, 64], paint.beak, 3),
    claw: atlas.region("claw", [768, 448, 128, 64], paint.claw, 3),
    covert: atlas.region("covert", [0, 512, 512, 512], paint.covert, 6),
    tuft: atlas.region("tuft", [512, 512, 256, 128], paint.tuft),
    eye: atlas.region("eye", [768, 512, 128, 128], paint.eye),
  };
  const featherPart = { mesh: body, uv: map.feather };
  const span = GRIFFIN_HAND.tip[0] + 3.3;
  flexAll(meshes, ([x, y, z]) => Math.max(Math.pow(clamp01((Math.abs(x) - 0.5) / (span - 0.5)), 1.25) * smooth(0, 0.6, z), 0.3 * smooth(-4, -8, y)));

  const [low, high] = GRIFFIN_BACK.map((value) => value * DEG);
  const back = placeOn(meshes, body, ctx, "body", map.back);
  sweepAlong(back.mesh, GRIFFIN_FRAMES, reptileSection, { segments: 28, from: low, to: high, uv: (i, j, p, frame, angle) => back.uv(1 - frame.t, (angle - low) / (high - low)) });
  sweepAlong(body, GRIFFIN_FRAMES, reptileSection, { segments: 14, from: high, to: low + Math.PI * 2, uv: (i, j, p, frame, angle) => map.belly(1 - frame.t, (angle - high) / (low + Math.PI * 2 - high)) });

  /* Клюв орла: надклювье крючком и подклювье. */
  const beak = (points, rings) =>
    sweepAlong(body, curveFrames(curve(points), rings), (frame, angle) => [frame.extra[0] * Math.cos(angle), frame.extra[1] * Math.sin(angle)], {
      segments: 10,
      uv: (i, j, p, frame, angle) => map.beak(frame.t, angle / (Math.PI * 2)),
    });
  beak(
    [
      [0, 4.5, 1.86, 0.2, 0.24],
      [0, 4.92, 1.8, 0.16, 0.21],
      [0, 5.28, 1.66, 0.1, 0.15],
      [0, 5.5, 1.45, 0.05, 0.08],
      [0, 5.54, 1.26, 0, 0],
    ],
    18,
  );
  beak(
    [
      [0, 4.5, 1.62, 0.17, 0.1],
      [0, 4.92, 1.56, 0.11, 0.07],
      [0, 5.18, 1.5, 0, 0],
    ],
    10,
  );

  for (const { id, p } of SIDES) {
    const onSide = (at) => (t, s) => p(at(t, s));
    /* Глаз — янтарный, светится; хмурое надбровье; перья-«уши». */
    ellipsoid(glow, null, p([0.25, 4.38, 1.9]), [0.08, 0.11, 0.09], eyeUv(map.eye), { segments: 12, rings: 8, axes: eyeAxes(p([1, 0.75, 0.15])) });
    tubeCurve(body, [[...p([0.2, 4.12, 2.04]), 0.075], [...p([0.3, 4.42, 2.02]), 0.065], [...p([0.25, 4.7, 1.94]), 0.03]], { rings: 10, segments: 7, uv: map.back(0.04, 0.3) });
    for (const [dy, dz] of [
      [-0.7, 0.45],
      [-0.85, 0.25],
    ])
      feather(onSide(featherAt([0.22, 3.95, 2.02], unit([0.25, dy, dz]), 0.75, (t) => 0.1 * Math.sin(Math.PI * Math.min(1, 0.15 + t)) + 0.01, { lead: 1, curl: 0.05, up: [1, 0, 0] })), { base: featherPart, rows: 5 });

    /* Крыло орла: кроющие одним телом (лого), кромка, маховые и большие кроющие. */
    const covers = (a, b) => add(mix(GRIFFIN_LEADING.at(b), GRIFFIN_TRAILING.at(b), a), [0, 0, 0.12 * Math.sin(Math.PI * Math.min(1, a * 1.3)) * (1 - 0.6 * b)]);
    const plan = (point) => [(Math.abs(point[0]) - GRIFFIN_WING.a0) / (GRIFFIN_WING.a1 - GRIFFIN_WING.a0), (GRIFFIN_WING.b1 - point[1]) / (GRIFFIN_WING.b1 - GRIFFIN_WING.b0)];
    const coverUv = (side) => (i, j, point) => {
      const [u, v] = plan(point);
      return meshes.skin ? ctx.skinUv(`wing-${id}-${side}`, u, v) : map.covert(u, v);
    };
    twoSided({ up: meshes.skin || body }, 8, 26, (i, j) => p(covers(i / 8, j / 26)), { uvUp: coverUv("top"), uvDown: coverUv("bottom") });
    tubeCurve(
      body,
      [0, 0.25, 0.5, 0.75, 1].map((t) => [...p(GRIFFIN_LEADING.at(t).map((value, axis) => value + [0, -0.05, -0.02][axis])), lerp(0.14, 0.05, t)]),
      { rings: 22, segments: 8, uv: (t, angle) => map.covert(lerp(0.05, 0.95, t), 0.06 + 0.04 * angle) },
    );
    const lengths = [2.9, 3.2, 3.35, 3.35, 3.2, 3.05, 2.85, 2.65, 2.5, 2.35];
    lengths.forEach((size, index) => {
      const k = index / (lengths.length - 1);
      const base = add(mix(GRIFFIN_HAND.tip, GRIFFIN_HAND.wrist, k * 0.9), [0, -0.04, -0.03 - 0.005 * index]);
      const width = (t) => {
        const full = 0.23 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.92)) + 0.03;
        return index < 5 ? full * (1 - 0.35 * smooth(0.55, 0.75, t)) : full;
      };
      feather(onSide(featherAt(base, planDirection(lerp(-4, 60, k), 0.02), size, width, { lead: 0.45, curl: 0.25 })), { base: featherPart, rows: 9 });
    });
    for (let index = 0; index < 16; index += 1) {
      const k = index / 15;
      const base = add(GRIFFIN_TRAILING.at(lerp(0.7, 0.03, k)), [0, 0.4, -0.05 - 0.003 * index]);
      const size = index > 12 ? 1.9 : 2.15;
      feather(onSide(featherAt(base, planDirection(lerp(64, 100, k), 0.03), size, (t) => 0.27 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92)) + 0.04, { lead: 0.6, curl: 0.1 })), { base: featherPart, rows: 8 });
    }
    for (let index = 0; index < 18; index += 1) {
      const k = index / 17;
      const base = add(GRIFFIN_TRAILING.at(lerp(0.97, 0.03, k)), [0, 0.24, 0.03]);
      feather(onSide(featherAt(base, planDirection(lerp(40, 98, k), 0.02), 0.9, (t) => 0.23 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9)) + 0.03, { lead: 0.8, curl: 0.03 })), { base: featherPart, rows: 5 });
    }

    /* Передние лапы — орла: цевка в чешуе цвета клюва, когти. */
    const front = [p([0.45, 1.45, -0.35]), p([0.62, 1.85, -0.95]), p([0.57, 2.3, -1.35])];
    limbChain(body, [[...front[0], 0.26], [...front[1], 0.16], [...front[2], 0.12]], map.beak, { segments: 10 });
    for (const [spread, forward] of [
      [-0.45, 1],
      [0, 1],
      [0.45, 1],
      [0, -1],
    ]) {
      const direction = unit(add(p([spread, 0.6 * forward, -0.6]), [0, 0, 0]));
      const end = add(front[2], scale(direction, 0.3));
      tubeCurve(body, [[...front[2], 0.06], [...end, 0.045]], { rings: 4, segments: 6, uv: map.beak });
      spike(body, end, unit(add(direction, [0, 0, -0.8])), 0.24, 0.045, scale(direction, -0.06), map.claw, { rings: 4, segments: 6 });
    }
    /* Задние лапы — льва: бедро, голень, плюсна, лапа с подушками. */
    const hind = [
      [...p([0.55, -2.75, -0.05]), 0.5],
      [...p([0.72, -2.2, -0.8]), 0.32],
      [...p([0.66, -3.1, -1.22]), 0.2],
      [...p([0.6, -3.85, -1.42]), 0.17],
    ];
    limbChain(body, hind, map.limb, { segments: 12 });
    ellipsoid(body, null, add(hind[3].slice(0, 3), [0, -0.18, -0.03]), [0.2, 0.26, 0.12], map.limb(0.95, 0.5), { segments: 10, rings: 7 });
    for (const spread of [-0.12, -0.04, 0.04, 0.12]) ellipsoid(body, null, add(hind[3].slice(0, 3), [spread * (id === "left" ? -1 : 1), -0.4, -0.06]), [0.06, 0.07, 0.055], map.limb(0.98, 0.5), { segments: 7, rings: 5 });
  }

  /* Хвост льва с кисточкой. */
  const tail = [
    [0, -3.65, 0.36, 0.16],
    [0, -4.9, 0.05, 0.13],
    [0, -6.2, -0.45, 0.1],
    [0, -7.3, -0.35, 0.07],
  ];
  tubeCurve(body, tail, { rings: 24, segments: 8, uv: map.limb });
  ellipsoid(body, null, [0, -7.55, -0.38], [0.2, 0.42, 0.2], map.tuft(0.3, 0.5), { segments: 10, rings: 7 });
  for (let index = -2; index <= 2; index += 1) {
    const root = [0, -7.45, -0.36];
    const tip = [index * 0.12, -8.35 + Math.abs(index) * 0.08, -0.4 + 0.08 * Math.cos(index)];
    strand({ mesh: body, uv: map.tuft }, [root, mix(root, tip, 0.5), tip], (t) => 0.12 * Math.sin(Math.PI * Math.min(1, 0.2 + t)) + 0.01, { rows: 5 });
  }
}
