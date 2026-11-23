/*
 * Гирлянды вокруг ствола (задача 6 ТЗ 17.10.2026).
 *
 * Владелец 17.10: «Сделать так что бы вокруг всего гана можно было сделать
 * или цепи или цветки которые только на ствол лепятся (ну типо улучшение
 * функции которая есть уже)». Лоза (`decoration-vine.js`) обвивала ствол —
 * гирлянда идёт тем же путём, по той же мерке модели (`wrap`: срезы поперёк
 * длинной оси и радиус по 16 секторам), но по умолчанию — вокруг ВСЕЙ
 * модели, от тыла до дула, и вместо стебля с листьями — нить с тем, что на
 * ней висит:
 *
 *   • цепь — звенья по пути, через одно — плашмя и стоймя, сцеплены;
 *   • цветы — тонкий стебель и цветочки лицом наружу, между ними листики;
 *   • мишура — нить и пушистые полоски наружу, два цвета вперемешку;
 *   • огоньки — тёмный провод и лампочки, светятся сами (шейдер `emissive`
 *     игры, как светящаяся голограмма), цвета через одну;
 *   • бусы — нить и шарики, через один — второй цвет.
 *
 * Точка щелчка, витки и «сдвиг витков» значат то же, что у лозы
 * (`wrapPath`): гирлянда проходит через точку, где её поставили. Сетка —
 * частями по полвитка со своими точками крепления, как у лозы: хост вешает
 * каждую часть на кость ближайшей детали (на затворе пистолета гирлянда
 * ходит с затвором).
 *
 * Вершин у одной гирлянды не больше `GARLAND_VERTEX_BUDGET` (под пределом
 * украшения `MAX_DECORATION_VERTICES`): у длинной цепи вокруг винтовки
 * звенья крупнее, а не обрываются; бусин, цветов и огоньков — реже.
 */

import { ACCENT, DARK, LEAF, MAIN, SHAPES, TAU, add, builder, cross, framed, jitter, pipe, scale, sheet, sphere, sub, unit } from "./decoration-shapes.js";
import { VINE_QUALITY, wrapPath } from "./decoration-vine.js";

export const GARLAND_VARIANTS = Object.freeze(["chain", "flowers", "tinsel", "lights", "beads"]);
/* Сколько вершин может быть у одной гирлянды (предел украшения — 6000). */
export const GARLAND_VERTEX_BUDGET = 5600;

export const GARLAND_QUALITY = Object.freeze({
  high: Object.freeze({ perTurn: VINE_QUALITY.high.perTurn, linkSegments: 12, linkSides: 6, wireSides: 5, sphere: Object.freeze({ rings: 4, segments: 8 }), strands: 1, petalRows: 3, petalCols: 2 }),
  low: Object.freeze({ perTurn: VINE_QUALITY.low.perTurn, linkSegments: 8, linkSides: 4, wireSides: 3, sphere: Object.freeze({ rings: 2, segments: 5 }), strands: 0.45, petalRows: 2, petalCols: 1 }),
});

/* Через одно — второй цвет, если он отличается от основного; иначе — основной со своей тенью. */
const twoTone = (decoration) => String(decoration.accent) !== String(decoration.colour);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* Четырёхугольник по вершинам с нормалями: двумя треугольниками лицом наружу. */
function oriented4(mesh, a, b, c, d) {
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
}

/* Звено цепи: тор-овал вокруг `centre` в плоскости осей `a` (вдоль пути) и `b`. */
function link(mesh, { centre, a, b, length, width, wire, segments, sides, uv }) {
  const A = Math.max(wire * 1.2, length / 2 - wire);
  const B = Math.max(wire * 1.2, width / 2 - wire);
  const binormal = unit(cross(a, b));
  const grid = [];
  for (let i = 0; i < segments; i += 1) {
    const u = (i / segments) * TAU;
    const middle = add(centre, add(scale(a, A * Math.cos(u)), scale(b, B * Math.sin(u))));
    const radial = unit(add(scale(a, B * Math.cos(u)), scale(b, A * Math.sin(u))));
    const ring = [];
    for (let j = 0; j < sides; j += 1) {
      const v = (j / sides) * TAU;
      const n = add(scale(radial, Math.cos(v)), scale(binormal, Math.sin(v)));
      ring.push(mesh.vertex(add(middle, scale(n, wire)), n, typeof uv === "function" ? uv(v) : uv));
    }
    grid.push(ring);
  }
  for (let i = 0; i < segments; i += 1)
    for (let j = 0; j < sides; j += 1)
      oriented4(mesh, grid[i][j], grid[(i + 1) % segments][j], grid[(i + 1) % segments][(j + 1) % sides], grid[i][(j + 1) % sides]);
}

/* Полоска мишуры: тонкий четырёхугольник с лицом и изнанкой. */
function strip(mesh, { from, to, side, width, uv }) {
  const half = scale(side, width / 2);
  const corners = [sub(from, half), add(from, half), add(to, half), sub(to, half)];
  const normal = unit(cross(sub(to, from), side));
  const front = corners.map((point, index) => mesh.vertex(point, normal, uv(index)));
  oriented4(mesh, front[0], front[1], front[2], front[3]);
  const back = corners.map((point, index) => mesh.vertex(point, scale(normal, -1), uv(index)));
  oriented4(mesh, back[0], back[3], back[2], back[1]);
}

/*
 * Цветочек гирлянды: пять лепестков основным цветом и середина вторым.
 * Как цвет на лозе (`vineBloom`), но цвета на своих местах: у лозы лепестки
 * — второй цвет (основной там — листья), у гирлянды — основной.
 */
function garlandBloom(mesh, frame, q) {
  const at = framed(mesh, frame);
  for (let k = 0; k < 5; k += 1) {
    const angle = (k / 5) * TAU;
    const radial = [Math.cos(angle), Math.sin(angle), 0];
    sheet(at, { base: [radial[0] * 0.05, radial[1] * 0.05, 0.02], forward: radial, up: [0, 0, 1], length: 0.42, width: 0.36, rise: 0.4, bend: -0.3, cup: 0.4, shape: SHAPES.rounded, rows: q.petalRows, cols: q.petalCols, uv: (t) => MAIN(0.55 + 0.4 * t) });
  }
  sphere(at, [0, 0, 0.05], 0.1, { rings: Math.max(2, q.sphere.rings - 1), segments: q.sphere.segments, uv: ACCENT, stretch: 0.7 });
}

/** Отступ нити от поверхности: элемент не уходит в модель. */
function liftOf(decoration) {
  const size = decoration.size / 100;
  const wire = decoration.thickness / 2000;
  const gap = decoration.gap / 1000 + 0.0006;
  if (decoration.variant === "chain") return size * 0.32 + gap;
  if (decoration.variant === "beads") return size / 2 + gap;
  if (decoration.variant === "tinsel") return wire + size * 0.15 + gap;
  return wire + gap;
}

/* Шаг между элементами вида по густоте (метры). */
function spacingOf(variant, size, density, wire) {
  if (variant === "chain") return Math.max(size * 0.5, size - 2 * wire);
  if (variant === "flowers") return size * (2.4 - 1.5 * density);
  if (variant === "lights") return size * (3.4 - 2.4 * density);
  if (variant === "beads") return size * (1 + 1.6 * (1 - density));
  return 0;
}

/**
 * Сетка гирлянды в осях модели кадра: `builder` с частями. `decoration` —
 * нормализованная гирлянда (`createDecoration`), `lod` — `high` / `low`.
 */
export function garlandMesh(decoration, lod = "high") {
  const q = GARLAND_QUALITY[lod] || GARLAND_QUALITY.high;
  const { steps, points, surface, frames, total, pointAt } = wrapPath(decoration, { perTurn: q.perTurn, lift: liftOf(decoration) });
  const variant = decoration.variant;
  const size = decoration.size / 100;
  const wire = Math.max(0.0004, decoration.thickness / 2000);
  const density = decoration.density / 100;
  const second = twoTone(decoration);

  /* Нить (у цепи её нет): провод огоньков и нить бус — тёмные, стебель цветов — зелёный. */
  const hasWire = variant !== "chain";
  const wireRadius = variant === "lights" || variant === "flowers" ? wire : wire * 0.6;
  const wireUv = variant === "lights" || variant === "beads" ? DARK : variant === "flowers" ? LEAF(0.35) : MAIN(0.45);

  let linkLength = size;
  /* Один элемент гирлянды у точки пути `element` (`{ share, k }`). */
  const draw = (target, element, quality = q) => {
    const spot = pointAt(element.share);
    const tangent = spot.tangent;
    const out = unit(sub(spot.outward, scale(tangent, dot(tangent, spot.outward))));
    const side = unit(cross(out, tangent));
    const tone = second && element.k % 2 ? ACCENT : null;
    if (variant === "chain") {
      /* Через одно — стоймя (от поверхности) и плашмя (вдоль неё). */
      link(target, {
        centre: spot.point,
        a: tangent,
        b: element.k % 2 ? side : out,
        length: linkLength,
        width: linkLength * 0.62,
        wire,
        segments: quality.linkSegments,
        sides: quality.linkSides,
        uv: tone || ((v) => MAIN(0.5 + 0.45 * Math.sin(v))),
      });
    } else if (variant === "beads") {
      sphere(target, spot.point, size / 2, { ...quality.sphere, uv: tone || MAIN(0.82), axis: out });
    } else if (variant === "lights") {
      /* Лампочка на патроне; наклон через одну — в разные стороны. */
      const lean = (element.k % 2 ? 1 : -1) * 0.45;
      const axis = unit(add(scale(out, Math.cos(lean)), scale(side, Math.sin(lean))));
      const socket = add(spot.point, scale(axis, wire));
      const bulb = size * 0.24;
      pipe(target, [socket, add(socket, scale(axis, size * 0.22))], { radius: bulb * 0.62, sides: quality.wireSides, uv: DARK, caps: [false, true] });
      sphere(target, add(socket, scale(axis, size * 0.22 + bulb * 1.25)), bulb, { ...quality.sphere, uv: tone || MAIN(0.92), stretch: 1.45, axis });
    } else if (variant === "flowers") {
      /* Цветочек лицом наружу; рядом — листик. */
      const turn = jitter(element.k + 31) * TAU;
      const x = unit(add(scale(tangent, Math.cos(turn)), scale(side, Math.sin(turn))));
      garlandBloom(target, { origin: add(spot.point, scale(out, wire * 0.6)), x, y: cross(out, x), z: out, scale: size }, quality);
      const flip = element.k % 2 ? 1 : -1;
      sheet(target, {
        base: add(spot.point, add(scale(side, flip * wire), scale(tangent, size * 0.45))),
        forward: unit(add(scale(side, flip * 0.8), scale(tangent, 0.6))),
        up: out,
        length: size * 0.55,
        width: size * 0.26,
        rise: 0.3,
        bend: -0.35,
        fold: 0.25,
        shape: SHAPES.pointed,
        rows: quality.petalRows,
        cols: 1,
        uv: (t) => LEAF(0.35 + 0.55 * t),
      });
    } else {
      /* Мишура: полоска наружу под своим углом, блёстки разной яркости. */
      const angle = (jitter(element.k + 11) - 0.5) * Math.PI * 0.95;
      const tilt = (jitter(element.k + 23) - 0.5) * 0.9;
      const direction = unit(add(add(scale(out, Math.cos(angle)), scale(side, Math.sin(angle))), scale(tangent, tilt)));
      const length = size * (0.7 + 0.5 * jitter(element.k + 41));
      const shade = 0.35 + 0.65 * jitter(element.k + 53);
      const uv = second && element.k % 3 === 1 ? () => ACCENT : (corner) => MAIN(corner < 2 ? shade * 0.7 : shade);
      strip(target, {
        from: add(spot.point, scale(direction, wire * 0.5)),
        to: add(spot.point, scale(direction, length)),
        side: unit(cross(direction, tangent)),
        width: Math.max(0.0008, size * 0.09),
        uv,
      });
    }
  };

  /* Сколько элементов: по шагу густоты, но в бюджете вершин полной
     детализации — цена элемента меряется по нему самому. Облегчённая
     модель берёт то же число (у мишуры — меньше полосок): звенья цепи и
     бусины вдали те же, только грубее. */
  const high = GARLAND_QUALITY.high;
  const highSteps = Math.max(16, Math.ceil(decoration.turns * high.perTurn));
  const wireCost = hasWire ? (highSteps + 1) * high.wireSides + 2 * (high.wireSides + 1) : 0;
  const probe = builder();
  draw(probe, { share: 0.5, k: 0 }, high);
  const perElement = Math.max(1, probe.positions.length / 3);
  const cap = Math.max(2, Math.floor((GARLAND_VERTEX_BUDGET - wireCost) / perElement));
  let count;
  if (variant === "tinsel") count = Math.max(8, Math.round(Math.min(cap, Math.round(total * (380 + 900 * density))) * q.strands));
  else {
    count = Math.max(2, Math.round(total / Math.max(spacingOf(variant, size, density, wire), size * 0.5)));
    if (count > cap) {
      count = cap;
      /* Длинная цепь не обрывается — звенья крупнее. */
      if (variant === "chain") linkLength = total / count + 2 * wire;
    }
  }
  const elements = Array.from({ length: count }, (_, k) => ({ share: variant === "tinsel" ? (k + jitter(k + 7)) / count : (k + 0.5) / count, k }));

  const mesh = builder();
  const partCount = Math.min(16, Math.max(1, Math.ceil(decoration.turns * 2)));
  for (let part = 0; part < partCount; part += 1) {
    const from = Math.round((part * steps) / partCount);
    const to = Math.round(((part + 1) * steps) / partCount);
    mesh.part(surface[Math.round((from + to) / 2)]);
    if (hasWire) pipe(mesh, points, { radius: wireRadius, sides: q.wireSides, uv: wireUv, frames, from, to, caps: [part === 0, part === partCount - 1] });
    const last = part === partCount - 1;
    for (const element of elements)
      if (element.share >= from / steps && (element.share < to / steps || (last && element.share <= 1))) draw(mesh, element);
  }
  return mesh;
}
