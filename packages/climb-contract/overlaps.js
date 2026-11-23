/*
 * Метки мода друг на друге.
 *
 * Расстановка мода ставит метки и вплотную, и одну на другую. Выдавленные
 * белые надписи мода это кое-как прощали, плашки Astral — нет: проверка на
 * мире игры (12.10.2026, кадр владельца с Majestic RP) показала три вида
 * наложений, и все три видны по одной только расстановке:
 *
 *   • Спина к спине. На парапете, перилах, козырьке с улицы стоит «1 POV
 *     CLICK», а с крыши — «JUMP SPACE», лицом в другую сторону (так у мода
 *     в двух десятках мест). Плашка шире надписи мода и выходит за край
 *     парапета, и с улицы над «1 POV» висит спина «JUMP» — зеркальная каша.
 *     Где она вылезет, по расстановке не узнать (край парапета — в мире
 *     игры), поэтому пара узнаётся по тому, что надписи стоят одна за другой:
 *     рамки видимого перекрываются. Такой паре нужна плашка только лицом —
 *     каждую метку видно только с её стороны, как задумал автор.
 *   • Пустой щит поверх надписи. `teamneed` в моде прозрачен; если человек
 *     дал ему надпись или картинку, там, где щит висит перед другой меткой,
 *     он её закроет. Такое место щит уступает: в моде там его и так не видно.
 *   • Повтор. Одна и та же метка дважды в одной точке — у мода незаметно,
 *     у плашки с ореолом — двоится. Остаётся первая.
 *
 * Наложение лицом в одну сторону меряется по тому, что действительно будет
 * видно: по альфе текстур этих самых меток, на их плашках, в их местах.
 * Метки, что лишь касаются ореолом, не в счёт. Наложения лицом в одну сторону, которые
 * автор мода поставил сам (обе метки с надписью), остаются как в моде —
 * убрать одну значило бы отнять у залаза подсказку.
 */

import { CLIMB_MODELS } from "./inventory.js";

export const CLIMB_OVERLAP = Object.freeze({
  /* Видимый пиксель — с альфой от четверти: слабый ореол не в счёт. */
  alpha: 64,
  /* Наложение от 10 см²: меньше — касание краями. */
  minArea: 0.001,
  /* Дальше 30 см вдоль нормали метки — уже не «друг на друге». */
  maxDepth: 0.3,
  /* Повтор: та же метка, глубже 2 см не разошлась и легла на половину. */
  duplicateDepth: 0.02,
  duplicateShare: 0.5,
  /* Почти перпендикулярные метки друг на друга не ложатся. */
  minCos: 0.5,
  grid: 48,
});

/** Имя копии метки «только лицом» — свой архетип и своя модель. */
export const climbFrontOnlyModel = (model) => `${model}_astral_front`;

/* ------------------------------------------------------------------ *
 * Геометрия
 * ------------------------------------------------------------------ */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = (a) => Math.sqrt(dot(a, a));

/* Поворот вектора кватернионом (x, y, z, w): q·v·q⁻¹. */
function rotate([x, y, z, w], [vx, vy, vz]) {
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w - iw * x - iy * z + iz * y,
    iy * w - iw * y - iz * x + ix * z,
    iz * w - iw * z - ix * y + iy * x,
  ];
}

/*
 * Координаты лица → оси модели — как у хоста: u вправо, v вверх перед
 * лицом; для лица в +Z и в −Y вправо — это +X, для лица в +Y и в −Z — −X.
 */
function toModel({ axis, facing }, u, v, depth) {
  const mirror = (axis === "z" && facing < 0) || (axis === "y" && facing > 0);
  const x = mirror ? -u : u;
  return axis === "z" ? [x, v, depth] : [x, depth, v];
}

/* Плашка места в мире: лицо, оси u и v, нормаль лица, сдвиг к спине. */
function placeFrame(placement, look) {
  const { quad } = look;
  const [scaleXY, scaleZ] = placement.scale;
  const world = (u, v, depth) => {
    const local = toModel(quad, u, v, depth);
    return add(
      placement.position,
      rotate(placement.rotation, [
        local[0] * scaleXY,
        local[1] * scaleXY,
        local[2] * scaleZ,
      ]),
    );
  };
  const origin = world(0, 0, quad.front);
  const u = sub(world(1, 0, quad.front), origin);
  const v = sub(world(0, 1, quad.front), origin);
  const back = sub(world(0, 0, quad.back), origin);
  const axis = quad.axis === "z" ? [0, 0, quad.facing] : [0, quad.facing, 0];
  const normal = rotate(placement.rotation, axis);
  const corner = (a, b) => add(add(origin, scaled(u, a)), scaled(v, b));
  const low = corner(quad.minX, quad.minY);
  const high = corner(quad.maxX, quad.maxY);
  return {
    placement,
    look,
    origin,
    u,
    v,
    uu: dot(u, u),
    vv: dot(v, v),
    back,
    normal: scaled(normal, 1 / length(normal)),
    centre: scaled(add(low, high), 0.5),
    radius: length(sub(high, low)) / 2,
  };
}

/* Альфа плашки в точке лица (u, v); `mirrored` — спина, что читается. */
function alphaAt(look, u, v, mirrored) {
  const { quad, width, height, rgba } = look;
  let s = (u - quad.minX) / (quad.maxX - quad.minX);
  const t = (quad.maxY - v) / (quad.maxY - quad.minY);
  if (s < 0 || s >= 1 || t < 0 || t >= 1) return 0;
  if (mirrored) s = 1 - s;
  const x = Math.min(width - 1, Math.floor(s * width));
  const y = Math.min(height - 1, Math.floor(t * height));
  return rgba[(y * width + x) * 4 + 3];
}

/* Рамка видимого: где у текстуры альфа не меньше порога (доли 0…1). */
function visibleBox(look, threshold) {
  const { width, height, rgba } = look;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (rgba[(y * width + x) * 4 + 3] >= threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  return right < 0
    ? null
    : {
        s0: left / width,
        s1: (right + 1) / width,
        t0: top / height,
        t1: (bottom + 1) / height,
      };
}

/* Точка лица (u, v) внутри рамки видимого; спина развёрнута. */
function insideBox(look, box, u, v, mirrored) {
  const { quad } = look;
  let s = (u - quad.minX) / (quad.maxX - quad.minX);
  const t = (quad.maxY - v) / (quad.maxY - quad.minY);
  if (mirrored) s = 1 - s;
  return s >= box.s0 && s < box.s1 && t >= box.t0 && t < box.t1;
}

/*
 * Видимое A поверх видимого B — глазами того, кто стоит перед лицом A.
 * B виден лицом, если смотрит туда же, иначе — спиной (она читается, то есть
 * развёрнута). Возвращает площадь наложения (м²), видимую площадь A и
 * среднюю глубину B относительно лица A вдоль его нормали.
 */
function overlapSeenFrom(a, b, options, boxes = false) {
  const { quad } = a.look;
  const facing = dot(b.normal, a.normal);
  const plane = facing > 0 ? b.origin : add(b.origin, b.back);
  const grid = options.grid;
  const du = (quad.maxX - quad.minX) / grid;
  const dv = (quad.maxY - quad.minY) / grid;
  const cell = du * dv * Math.sqrt(a.uu * a.vv);
  let visible = 0;
  let both = 0;
  let depth = 0;
  for (let row = 0; row < grid; row += 1)
    for (let column = 0; column < grid; column += 1) {
      const u = quad.minX + (column + 0.5) * du;
      const v = quad.minY + (row + 0.5) * dv;
      if (
        boxes
          ? !insideBox(a.look, a.box, u, v, false)
          : alphaAt(a.look, u, v, false) < options.alpha
      )
        continue;
      visible += 1;
      const point = add(add(a.origin, scaled(a.u, u)), scaled(a.v, v));
      const along = dot(b.normal, sub(plane, point)) / facing;
      if (Math.abs(along) > options.maxDepth) continue;
      const hit = sub(add(point, scaled(a.normal, along)), b.origin);
      const bu = dot(hit, b.u) / b.uu;
      const bv = dot(hit, b.v) / b.vv;
      if (
        boxes
          ? !insideBox(b.look, b.box, bu, bv, facing < 0)
          : alphaAt(b.look, bu, bv, facing < 0) < options.alpha
      )
        continue;
      both += 1;
      depth += along;
    }
  return {
    area: both * cell,
    visible: visible * cell,
    depth: both ? depth / both : 0,
  };
}

/**
 * Какие места развести.
 *
 * `placements` — места меток (`./placements.js`); `looks` — облик каждой
 * модели: `quad` из `climbMarkerLayout`, размер текстуры и её RGBA (`null` —
 * метка скрыта, её не видно). Возвращает номера мест, которым нужна плашка
 * только лицом (`frontOnly`), которые уходят из расстановки (`removed`, с
 * причиной), и сами найденные наложения (`pairs`) — всё по возрастанию
 * номеров, одинаково для одинакового входа.
 */
export function resolveClimbOverlaps({
  placements,
  looks,
  options: overrides = {},
}) {
  const options = { ...CLIMB_OVERLAP, ...overrides };
  const boxes = new Map();
  for (const [model, look] of Object.entries(looks))
    if (look?.rgba) boxes.set(model, visibleBox(look, options.alpha));
  const frames = placements
    .filter((placement) => boxes.get(placement.model))
    .map((placement) => ({
      ...placeFrame(placement, looks[placement.model]),
      box: boxes.get(placement.model),
    }));
  const pairs = [];
  for (let first = 0; first < frames.length; first += 1)
    for (let second = first + 1; second < frames.length; second += 1) {
      const a = frames[first];
      const b = frames[second];
      const reach = a.radius + b.radius + options.maxDepth;
      if (length(sub(a.centre, b.centre)) > reach) continue;
      const cos = dot(a.normal, b.normal);
      if (Math.abs(cos) < options.minCos) continue;
      /* Спина к спине — по рамкам видимого, лицом в одну сторону — по
         пикселям. */
      const fromA = overlapSeenFrom(a, b, options, cos < 0);
      const fromB = overlapSeenFrom(b, a, options, cos < 0);
      const area = Math.max(fromA.area, fromB.area);
      if (area < options.minArea) continue;
      pairs.push({
        a: a.placement.index,
        b: b.placement.index,
        models: [a.placement.model, b.placement.model],
        facing: cos > 0 ? "same" : "opposite",
        area,
        /* Где B относительно лица A вдоль его нормали: меньше нуля — дальше
           от зрителя. */
        depth: fromA.area >= fromB.area ? fromA.depth : -fromB.depth,
        share: area / Math.max(1e-9, Math.min(fromA.visible, fromB.visible)),
      });
    }

  const frontOnly = new Set();
  const removed = new Map();
  for (const pair of pairs) {
    const [modelA, modelB] = pair.models;
    if (pair.facing === "opposite") {
      frontOnly.add(pair.a);
      frontOnly.add(pair.b);
      continue;
    }
    const blankA = CLIMB_MODELS[modelA].blank;
    const blankB = CLIMB_MODELS[modelB].blank;
    if (blankA !== blankB) {
      removed.set(blankA ? pair.a : pair.b, "blank-over-marker");
      continue;
    }
    if (
      modelA === modelB &&
      Math.abs(pair.depth) <= options.duplicateDepth &&
      pair.share >= options.duplicateShare
    )
      removed.set(pair.b, "duplicate");
  }
  for (const index of removed.keys()) frontOnly.delete(index);
  const byIndex = (a, b) => a - b;
  const models = new Map(placements.map((item) => [item.index, item.model]));
  return {
    frontOnly: [...frontOnly]
      .sort(byIndex)
      .map((index) => ({ index, model: models.get(index) })),
    removed: [...removed.keys()].sort(byIndex).map((index) => ({
      index,
      model: models.get(index),
      reason: removed.get(index),
    })),
    pairs,
  };
}
