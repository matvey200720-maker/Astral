/*
 * Из чего состоит прицел — фигуры по слоям.
 *
 * Обычный прицел — заливка и обводка под ней. Снайперский — сетка, центр
 * (точка, кольцо, шеврон своим цветом, если человек его задал) и обводка.
 * Слой — список фигур в точках сцены с уже применёнными масштабом и
 * поворотом, поставленных на сетку SWF. Эти же фигуры рисует превью (SVG,
 * `nonzero`) и пишет в `hud_reticle.gfx` компилятор (объединением через
 * `regionContours`), поэтому расхождения между ними быть не может.
 */

import {
  annulus,
  arcBand,
  chevronStroke,
  disc,
  inflatedRectangle,
  polygon,
  shapesBounds,
  snapShape,
  transformShape,
} from "./geometry.js";
import { normalizeOrdinaryReticle, normalizeSniperReticle } from "./config.js";
import { RETICLE_REACH } from "./stage.js";

const ARMS = Object.freeze([
  ["armTop", 0, -1],
  ["armRight", 1, 0],
  ["armBottom", 0, 1],
  ["armLeft", -1, 0],
]);

/* Линия вдоль оси от `from` до `to` толщиной `thickness`, раздутая на `grow`. */
function axisBar(dx, dy, from, to, thickness, grow) {
  const half = thickness / 2;
  return dx !== 0
    ? inflatedRectangle(dx * from, -half, dx * to, half, grow)
    : inflatedRectangle(-half, dy * from, half, dy * to, grow);
}

/*
 * Кольцо: целиком или частями. Части стоят равномерно, первая — по углу
 * `rotation` (0 — вправо, 90 — вниз); промежуток — в градусах между частями.
 * Обводка части длиннее на свою толщину с каждого конца, чтобы закрыть торец.
 */
function ringShapes(diameter, thickness, segments, gap, rotation, grow) {
  const radius = diameter / 2;
  const inner = radius - thickness / 2 - grow;
  const outer = radius + thickness / 2 + grow;
  if (outer <= 0) return [];
  const count = Math.max(1, Math.round(segments));
  if (count === 1) return [annulus(0, 0, Math.max(0, inner), outer)];
  const pitch = 360 / count;
  const span = Math.max(1, pitch - gap);
  const extra = radius > 0 ? (grow / radius) * (180 / Math.PI) : 0;
  return Array.from({ length: count }, (_, index) => {
    const centre = rotation + index * pitch;
    return arcBand(
      0,
      0,
      Math.max(0, inner),
      outer,
      centre - span / 2 - extra,
      centre + span / 2 + extra,
    );
  }).filter((shape) => shape.length);
}

function dotShape(size, shape, grow) {
  const half = size / 2;
  if (half <= 0) return [];
  if (shape === "square")
    return inflatedRectangle(-half, -half, half, half, grow);
  if (shape === "diamond") {
    /* Ромб той же площади, что квадрат; раздувается по нормали граней. */
    const tip = half * Math.SQRT2 + grow * Math.SQRT2;
    return polygon([
      [0, -tip],
      [tip, 0],
      [0, tip],
      [-tip, 0],
    ]);
  }
  return disc(0, 0, half + grow);
}

/*
 * Уголки рамки: в каждом углу квадрата со стороной 2·size — «Г» из двух
 * планок длиной `length`. Длина от половины стороны и больше смыкает уголки
 * в сплошную рамку.
 */
function bracketShapes(size, length, thickness, grow) {
  const reach = Math.min(length, size * 2);
  const shapes = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const cornerX = sx * size;
    const cornerY = sy * size;
    shapes.push(
      inflatedRectangle(
        cornerX,
        cornerY,
        cornerX - sx * reach,
        cornerY - sy * thickness,
        grow,
      ),
      inflatedRectangle(
        cornerX,
        cornerY,
        cornerX - sx * thickness,
        cornerY - sy * reach,
        grow,
      ),
    );
  }
  return shapes;
}

/* Галочка «^»: вершина на `offset` под центром, руки вниз в стороны. */
function chevronShape(width, height, thickness, offset, grow) {
  const apex = [0, offset];
  return chevronStroke(
    apex,
    [-width, offset + height],
    [width, offset + height],
    thickness / 2 + grow,
    grow,
  );
}

function place(shapes, scale, rotation) {
  return shapes
    .filter((shape) => shape.length)
    .map((shape) => snapShape(transformShape(shape, { scale, rotation })));
}

/*
 * Фигуры обычного прицела. `grow` — раздувание для обводки; оно не
 * масштабируется: толщина обводки задана в точках экрана, как в игре.
 */
function ordinaryShapes(config, grow) {
  const scale = config.scale / 100;
  const shapes = [];
  const lineGrow = grow / scale;
  if (config.linesEnabled && config.length > 0 && config.thickness > 0)
    for (const [key, dx, dy] of ARMS)
      if (config[key])
        shapes.push(
          axisBar(
            dx,
            dy,
            config.gap,
            config.gap + config.length,
            config.thickness,
            lineGrow,
          ),
        );
  if (config.showCenterDot && config.dotSize > 0)
    shapes.push(dotShape(config.dotSize, config.dotShape, lineGrow));
  if (config.ring && config.circleSize > 0 && config.ringThickness > 0)
    shapes.push(
      ...ringShapes(
        config.circleSize,
        config.ringThickness,
        config.ringSegments,
        config.ringGap,
        config.ringRotation,
        lineGrow,
      ),
    );
  if (config.bracketsEnabled)
    shapes.push(
      ...bracketShapes(
        config.bracketSize,
        config.bracketLength,
        config.bracketThickness,
        lineGrow,
      ),
    );
  if (config.chevronEnabled)
    shapes.push(
      ...chevronShape(
        config.chevronWidth,
        config.chevronHeight,
        config.chevronThickness,
        config.chevronOffset,
        lineGrow,
      ),
    );
  return place(shapes, scale, config.rotation);
}

/**
 * Слои обычного прицела.
 *
 * `outline` — фигуры обводки. Под непрозрачной заливкой обводка лежит
 * целиком (на стыке заливки и обводки нет просвета), под полупрозрачной
 * — только вокруг неё: иначе заливка темнела бы от обводки снизу. Какой
 * из двух случаев, говорит `outlineUnder`.
 */
export function ordinaryReticleLayers(input) {
  const config = normalizeOrdinaryReticle(input);
  const fill = ordinaryShapes(config, 0);
  const outlineOn =
    config.outlineEnabled && config.outlineWidth > 0 && fill.length > 0;
  return {
    config,
    fill,
    outline: outlineOn ? ordinaryShapes(config, config.outlineWidth) : [],
    outlineUnder: config.opacity >= 100,
  };
}

/*
 * Длина линии снайперки в процентах — от центра до края экрана по своей оси:
 * 640 точек по горизонтали, 360 по вертикали. Линза шире высоты экрана и уже
 * его ширины, поэтому горизонталь за 85 % уходит под чёрный край линзы.
 */
function sniperShapes(config, grow) {
  const lines = [];
  const centre = [];
  const horizontal = (RETICLE_REACH.horizontal * config.horizontalLength) / 100;
  const vertical = (RETICLE_REACH.vertical * config.verticalLength) / 100;
  const reachOf = (dx) => (dx !== 0 ? horizontal : vertical);
  const half = config.thickness / 2;
  if (config.linesEnabled) {
    for (const [key, dx, dy] of ARMS) {
      if (!config[key]) continue;
      const reach = reachOf(dx);
      if (reach > config.centerGap)
        lines.push(
          axisBar(dx, dy, config.centerGap, reach, config.thickness, grow),
        );
      if (config.postsEnabled) {
        const start = (reach * config.postStart) / 100;
        if (reach > start)
          lines.push(axisBar(dx, dy, start, reach, config.postThickness, grow));
      }
      /* Деления — между центром и толстым краем (или концом линии). */
      const count = Math.round(config.divisions);
      if (count > 0) {
        const end = config.postsEnabled
          ? (reach * config.postStart) / 100
          : reach;
        const tick = config.tickSize / 2;
        for (let index = 1; index <= count; index += 1) {
          const at = (end * index) / (count + 1);
          if (config.tickStyle === "dot") {
            const dot = disc(dx * at, dy * at, tick + grow);
            if (dot.length) lines.push(dot);
          } else
            /* Риска — поперёк линии, толщиной самой линии. */
            lines.push(
              dx !== 0
                ? inflatedRectangle(
                    dx * at - half,
                    -tick,
                    dx * at + half,
                    tick,
                    grow,
                  )
                : inflatedRectangle(
                    -tick,
                    dy * at - half,
                    tick,
                    dy * at + half,
                    grow,
                  ),
            );
        }
      }
    }
  }
  if (config.dotSize > 0) centre.push(disc(0, 0, config.dotSize / 2 + grow));
  if (config.showCircle && config.circleSize > 0)
    centre.push(
      ...ringShapes(
        config.circleSize,
        config.ringThickness,
        config.ringSegments,
        config.ringGap,
        config.ringRotation,
        grow,
      ),
    );
  if (config.chevronEnabled)
    centre.push(
      ...chevronShape(
        config.chevronWidth,
        config.chevronHeight,
        config.chevronThickness,
        0,
        grow,
      ),
    );
  if (config.holdoverEnabled) {
    const count = Math.round(config.holdoverCount);
    const firstY = config.chevronEnabled
      ? config.chevronHeight + config.holdoverSpacing
      : config.holdoverSpacing;
    for (let index = 0; index < count; index += 1) {
      const y = firstY + index * config.holdoverSpacing;
      const width = Math.max(
        1,
        config.holdoverWidth + index * config.holdoverGrowth,
      );
      if (config.holdoverShape === "chevron")
        centre.push(
          ...chevronShape(width, width * 0.7, config.thickness, y, grow),
        );
      else
        lines.push(inflatedRectangle(-width, y - half, width, y + half, grow));
    }
  }
  return { lines, centre };
}

/**
 * Слои снайперского прицела: `lines` — цветом сетки, `centre` — цветом
 * центра (если он свой; иначе центр уходит в сетку), `glow` — обводка под
 * всем.
 */
export function sniperReticleLayers(input) {
  const config = normalizeSniperReticle(input);
  const plain = sniperShapes(config, 0);
  const own = config.centerColorEnabled;
  const lines = place(
    own ? plain.lines : [...plain.lines, ...plain.centre],
    1,
    config.rotation,
  );
  const centre = own ? place(plain.centre, 1, config.rotation) : [];
  const grown =
    config.glowWidth > 0 && lines.length + centre.length > 0
      ? sniperShapes(config, config.glowWidth)
      : null;
  return {
    config,
    lines,
    centre,
    glow: grown
      ? place([...grown.lines, ...grown.centre], 1, config.rotation)
      : [],
    glowUnder: config.opacity >= 100,
  };
}

/** Рамка прицела по всем слоям (с обводкой) — для «Крупно» и подписей. */
export function reticleLayersBounds(layers) {
  return shapesBounds([
    ...(layers.fill || []),
    ...(layers.outline || []),
    ...(layers.lines || []),
    ...(layers.centre || []),
    ...(layers.glow || []),
  ]);
}
