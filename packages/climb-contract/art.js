/*
 * Рисунки видов меток залаза.
 *
 * Здесь не пиксели, а описание: какие фигуры, надписи и картинка лежат в
 * рамке метки и в каком слое. Растрирует описание окно редактора
 * (`climb-editor/climb-render.js`) — у него есть холст и шрифты, — и оно же
 * отдаёт готовую текстуру установке. Описание отдельно от холста затем,
 * чтобы проверять его без браузера: всё ли укладывается в рамку, у всех ли
 * видов есть рисунок.
 *
 * Координаты — доли рамки: x ∈ [−A, A], y ∈ [−1, 1], y смотрит вверх;
 * A — пропорция метки (1 у большинства, 2 у «Прыжка», 4 у «Клавиши Q»).
 * Контуры строятся только отрезками и кривыми Безье: дуги в холсте
 * зеркалятся вместе с осью y, а точки — нет.
 *
 * Слои. `fill` — сама метка цветом заливки; `ink` — надписи и знаки поверх
 * неё цветом обводки (тёмный текст на светлой табличке). Обводку и ореол
 * рисовальщик строит вокруг обоих слоёв сам. `mode: "cut"` вырезает из слоя
 * уже нарисованное — окна машины, ступица колеса.
 *
 * Правило того же толка, что у меток мода: части одной метки обязаны
 * перекрываться, а не касаться, — стык запекается в текстуру таким, какой он
 * есть, и на стене читается полоской.
 */

import { CLIMB_VARIANTS, climbFontKey, climbModelFrame, findClimbSlot } from "./index.js";
import {
  CLIMB_ORIGINAL_ART,
  CLIMB_ORIGINAL_ART_SCALE,
} from "./original-art.js";

/* ------------------------------------------------------------------ *
 * Контуры
 * ------------------------------------------------------------------ */

const KAPPA = 0.5522847498;

/** Строитель контура: M/L/C/Z в координатах рамки. */
function shape() {
  const commands = [];
  const api = {
    commands,
    move(x, y) {
      commands.push(["M", x, y]);
      return api;
    },
    line(x, y) {
      commands.push(["L", x, y]);
      return api;
    },
    curve(x1, y1, x2, y2, x, y) {
      commands.push(["C", x1, y1, x2, y2, x, y]);
      return api;
    },
    close() {
      commands.push(["Z"]);
      return api;
    },
    /* Эллипс четырьмя кривыми; `reverse` — обход по часовой, для дыры. */
    ellipse(cx, cy, rx, ry, reverse = false) {
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      api.move(cx + rx, cy);
      if (!reverse) {
        api.curve(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
        api.curve(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
        api.curve(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
        api.curve(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
      } else {
        api.curve(cx + rx, cy - ky, cx + kx, cy - ry, cx, cy - ry);
        api.curve(cx - kx, cy - ry, cx - rx, cy - ky, cx - rx, cy);
        api.curve(cx - rx, cy + ky, cx - kx, cy + ry, cx, cy + ry);
        api.curve(cx + kx, cy + ry, cx + rx, cy + ky, cx + rx, cy);
      }
      return api.close();
    },
    circle(cx, cy, r, reverse = false) {
      return api.ellipse(cx, cy, r, r, reverse);
    },
    /* Многоугольник всегда против часовой (или по часовой для дыры): иначе
       при сложении частей по ненулевому правилу он вычитался бы. */
    polygon(points, reverse = false) {
      const ordered = signedArea(points) >= 0 ? points : [...points].reverse();
      const list = reverse ? [...ordered].reverse() : ordered;
      list.forEach(([x, y], index) =>
        index ? api.line(x, y) : api.move(x, y),
      );
      return api.close();
    },
    rect(x0, y0, x1, y1, reverse = false) {
      return api.polygon(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
        reverse,
      );
    },
    roundRect(x0, y0, x1, y1, radius, reverse = false) {
      const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
      const k = r * (1 - KAPPA);
      const points = [
        ["M", x0 + r, y0],
        ["L", x1 - r, y0],
        ["C", x1 - k, y0, x1, y0 + k, x1, y0 + r],
        ["L", x1, y1 - r],
        ["C", x1, y1 - k, x1 - k, y1, x1 - r, y1],
        ["L", x0 + r, y1],
        ["C", x0 + k, y1, x0, y1 - k, x0, y1 - r],
        ["L", x0, y0 + r],
        ["C", x0, y0 + k, x0 + k, y0, x0 + r, y0],
      ];
      if (!reverse) {
        commands.push(...points, ["Z"]);
        return api;
      }
      /* Тот же контур задом наперёд: кривые разворачиваются вместе с
         опорными точками. */
      commands.push(...reversePath(points), ["Z"]);
      return api;
    },
  };
  return api;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    area += ax * by - bx * ay;
  }
  return area / 2;
}

function reversePath(commands) {
  const ends = commands.map((command) => command.slice(-2));
  const out = [["M", ...ends.at(-1)]];
  for (let index = commands.length - 1; index > 0; index -= 1) {
    const command = commands[index];
    const [x, y] = ends[index - 1];
    if (command[0] === "C")
      out.push(["C", command[3], command[4], command[1], command[2], x, y]);
    else out.push(["L", x, y]);
  }
  return out;
}

const rotate = (points, degrees, cx = 0, cy = 0) => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map(([x, y]) => [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ]);
};

/* ------------------------------------------------------------------ *
 * Операции рисунка
 * ------------------------------------------------------------------ */

const fill = (path, { layer = "fill", mode = "add", round = 0 } = {}) => ({
  type: "fill",
  layer,
  mode,
  path: path.commands,
  /* Скругление углов многоугольника: тот же контур обводится круглым
     стыком этой толщины поверх заливки. */
  round,
});

const stroke = (
  path,
  width,
  { layer = "fill", mode = "add", cap = "round", join = "round" } = {},
) => ({ type: "stroke", layer, mode, path: path.commands, width, cap, join });

const label = (value, font, box, { layer = "fill", mode = "add" } = {}) => ({
  type: "text",
  layer,
  mode,
  text: value,
  font,
  box,
});

/*
 * Несколько строк одним кеглем: у мода «JUMP» и «SPACE» одной высоты, хотя
 * слова разной длины. Каждая строка вписывается в свою коробку, а кегль у
 * всех — меньший из подошедших. `box` — общая коробка всех строк.
 */
const lines = (values, font, boxes, { layer = "fill", mode = "add" } = {}) => ({
  type: "lines",
  layer,
  mode,
  lines: values,
  font,
  boxes,
  box: [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ],
});

/*
 * Поворот рисунка на четверть оборота против часовой с масштабом: стрелки
 * «вправо» прежнего мода становятся стрелками «вверх». Толщины и скругления
 * меняются вместе с размером.
 */
function upward(ops, scale) {
  const point = (x, y) => [-y * scale, x * scale];
  return ops.map((op) => ({
    ...op,
    path: op.path?.map((command) => {
      if (command[0] === "Z") return command;
      const out = [command[0]];
      for (let index = 1; index + 1 < command.length; index += 2)
        out.push(...point(command[index], command[index + 1]));
      return out;
    }),
    ...(op.width ? { width: op.width * scale } : {}),
    ...(op.round ? { round: op.round * scale } : {}),
  }));
}

/* ------------------------------------------------------------------ *
 * Метки мода
 * ------------------------------------------------------------------ */

function unpackOriginal(model) {
  const numbers = CLIMB_ORIGINAL_ART[model].split(",").map(Number);
  const loops = [];
  let at = 1;
  for (let loop = 0; loop < numbers[0]; loop += 1) {
    const count = numbers[at];
    at += 1;
    const points = [];
    for (let point = 0; point < count; point += 1) {
      points.push([numbers[at], numbers[at + 1]]);
      at += 2;
    }
    loops.push(points);
  }
  return loops;
}

const originalCache = new Map();

/**
 * Лицевая грань метки мода в координатах рамки. Контуры идут как есть —
 * вместе с их обходом: дыры в букве «О» и в «Р» — это обход по часовой. У
 * метки, чья текстура в моде прозрачная, контуров нет: «Как в моде» — пусто.
 */
export function climbOriginalPath(slotId) {
  const slot = findClimbSlot(slotId);
  if (!slot) throw new Error(`Неизвестная метка залаза: ${slotId}.`);
  if (originalCache.has(slotId)) return originalCache.get(slotId);
  const frame = climbModelFrame(slot.model, slot.aspect);
  const half = frame.height / 2;
  const path = shape();
  for (const loop of unpackOriginal(slot.model)) {
    loop.forEach(([x, y], index) => {
      const fx = (x / CLIMB_ORIGINAL_ART_SCALE - frame.centreX) / half;
      const fy = (y / CLIMB_ORIGINAL_ART_SCALE - frame.centreY) / half;
      if (index) path.line(fx, fy);
      else path.move(fx, fy);
    });
    path.close();
  }
  originalCache.set(slotId, path);
  return path;
}

/* ------------------------------------------------------------------ *
 * Знаки «встань сюда»
 * ------------------------------------------------------------------ */

const ring = (path, cx, cy, outer, inner) =>
  path.circle(cx, cy, outer).circle(cx, cy, inner, true);

function footPath(mirror, dx, dy, tilt, scale) {
  /* Правая стопа носком вверх: пятка, подушка, свод между ними и пять
     пальцев. Левая — зеркало. Части налезают друг на друга, а не касаются. */
  const place = (points) =>
    rotate(
      points.map(([x, y]) => [(mirror ? -x : x) * scale, y * scale]),
      tilt,
    ).map(([x, y]) => [x + dx, y + dy]);
  const path = shape();
  const blob = (cx, cy, rx, ry) => {
    const [[x, y]] = place([[cx, cy]]);
    path.ellipse(x, y, rx * scale, ry * scale);
  };
  blob(0, -0.44, 0.19, 0.25);
  blob(0.04, 0.16, 0.24, 0.31);
  path.polygon(
    place([
      [0.16, -0.46],
      [0.26, 0.12],
      [-0.12, 0.1],
      [-0.15, -0.42],
    ]),
  );
  blob(-0.12, 0.6, 0.095, 0.1);
  blob(0.0, 0.64, 0.075, 0.08);
  blob(0.1, 0.61, 0.065, 0.07);
  blob(0.18, 0.54, 0.056, 0.06);
  blob(0.24, 0.45, 0.05, 0.054);
  return path;
}

const STAR = (() => {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 ? 0.42 : 1;
    const angle = Math.PI / 2 + (index * Math.PI) / 5;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius - 0.095]);
  }
  return points.map(([x, y]) => [x * 0.96, y * 0.96]);
})();

const SPOT_ART = {
  target: () => [
    fill(
      ring(ring(shape(), 0, 0, 0.96, 0.76), 0, 0, 0.54, 0.36).circle(
        0,
        0,
        0.16,
      ),
    ),
  ],
  crosshair: () => {
    const path = ring(shape(), 0, 0, 0.95, 0.77).circle(0, 0, 0.1);
    for (const angle of [0, 90, 180, 270])
      path.polygon(
        rotate(
          [
            [0.3, -0.07],
            [0.81, -0.07],
            [0.81, 0.07],
            [0.3, 0.07],
          ],
          angle,
        ),
      );
    return [fill(path)];
  },
  footprints: () => [
    fill(footPath(true, -0.35, -0.08, 8, 1.02)),
    fill(footPath(false, 0.35, 0.1, -8, 1.02)),
  ],
  dot: () => [fill(ring(shape(), 0, 0, 0.96, 0.82).circle(0, 0, 0.56))],
  diamond: () => {
    const diamond = (size) => [
      [0, size],
      [-size, 0],
      [0, -size],
      [size, 0],
    ];
    return [
      fill(shape().polygon(diamond(0.97)).polygon(diamond(0.72), true), {
        round: 0.05,
      }),
      fill(shape().polygon(diamond(0.36)), { round: 0.04 }),
    ];
  },
  star: () => [fill(shape().polygon(STAR), { round: 0.06 })],
  cross: () => [
    stroke(
      shape().move(-0.7, -0.7).line(0.7, 0.7).move(-0.7, 0.7).line(0.7, -0.7),
      0.36,
    ),
  ],
  ring: () => [fill(ring(shape(), 0, 0, 0.96, 0.62))],
};

/* ------------------------------------------------------------------ *
 * Слова: надписи, клавиши, таблички
 * ------------------------------------------------------------------ */

/* Клавиша: основание и лицевая грань, как у клавиши мода. */
function keycap(x0, y0, x1, y1, width) {
  const inset = (y1 - y0) * 0.24;
  return [
    stroke(shape().roundRect(x0, y0, x1, y1, (y1 - y0) * 0.2), width),
    stroke(
      shape().roundRect(
        x0 + inset * 0.55,
        y0 + inset,
        x1 - inset * 0.55,
        y1 - inset * 0.3,
        (y1 - y0) * 0.14,
      ),
      width * 0.72,
    ),
  ];
}

/* Искры по бокам клавиши: «нажми». Три штриха с каждой стороны. */
function sparks(x0, y0, x1, y1, width) {
  const height = y1 - y0;
  const path = shape();
  for (const side of [-1, 1]) {
    const edge = side < 0 ? x0 : x1;
    const out = side * height * 0.22;
    const gap = side * height * 0.1;
    path
      .move(edge + gap, y1 - height * 0.12)
      .line(edge + gap + out, y1 + height * 0.06)
      .move(edge + gap * 1.1, (y0 + y1) / 2)
      .line(edge + gap * 1.1 + out * 1.1, (y0 + y1) / 2)
      .move(edge + gap, y0 + height * 0.12)
      .line(edge + gap + out, y0 - height * 0.06);
  }
  return stroke(path, width, { cap: "round" });
}

/*
 * Вид со словами у метки любой пропорции. У квадратной и вдвое широкой
 * надпись стоит над клавишей, у вчетверо широкой («CLICK - Q») — слева от
 * неё: строка в высоту четверти рамки читалась бы точкой.
 */
function wordsArt(variantId, aspect, marker, font) {
  const text = marker.label;
  const key = marker.key;
  const a = aspect;
  if (a >= 3)
    switch (variantId) {
      case "lines":
        return [
          label(`${text} - ${key}`, font, [-0.97 * a, -0.8, 0.97 * a, 0.8]),
        ];
      case "label-key":
        return [
          label(text, font, [-0.97 * a, -0.78, 0.1 * a, 0.78]),
          ...keycap(0.3 * a, -0.82, 0.82 * a, 0.82, 0.12),
          label(key, font, [0.38 * a, -0.42, 0.74 * a, 0.58]),
          sparks(0.3 * a, -0.82, 0.82 * a, 0.82, 0.1),
        ];
      default:
        return null;
    }
  switch (variantId) {
    case "lines":
      return [
        lines([text, key], font, [
          [-0.98 * a, 0.08, 0.98 * a, 0.96],
          [-0.98 * a, -0.96, 0.98 * a, -0.08],
        ]),
      ];
    case "label-key":
      return [
        label(text, font, [-0.98 * a, 0.1, 0.98 * a, 0.98]),
        ...keycap(-0.6 * a, -0.94, 0.6 * a, -0.2, 0.065),
        label(key, font, [-0.44 * a, -0.7, 0.44 * a, -0.34]),
        sparks(-0.6 * a, -0.94, 0.6 * a, -0.2, 0.055),
      ];
    case "badge":
      return [
        fill(shape().roundRect(-0.98 * a, 0.04, 0.98 * a, 0.96, 0.18)),
        label(text, font, [-0.86 * a, 0.16, 0.86 * a, 0.84], { layer: "ink" }),
        fill(shape().roundRect(-0.58 * a, -0.94, 0.58 * a, -0.18, 0.16)),
        label(key, font, [-0.44 * a, -0.78, 0.44 * a, -0.34], {
          layer: "ink",
        }),
      ];
    case "label":
      return [label(text, font, [-0.98 * a, -0.6, 0.98 * a, 0.6])];
    case "key":
      return [
        ...keycap(-0.96 * a, -0.74, 0.96 * a, 0.74, 0.08),
        label(text, font, [-0.7 * a, -0.28, 0.7 * a, 0.5]),
      ];
    default:
      return null;
  }
}

const WORD_VARIANTS = Object.freeze([
  "lines",
  "label-key",
  "badge",
  "label",
  "key",
]);

/* ------------------------------------------------------------------ *
 * Значки
 * ------------------------------------------------------------------ */

function eyeIcon() {
  const eye = shape()
    .move(-0.92, 0.45)
    .curve(-0.5, 0.97, 0.5, 0.97, 0.92, 0.45)
    .curve(0.5, -0.07, -0.5, -0.07, -0.92, 0.45)
    .close();
  return [
    fill(eye),
    fill(shape().circle(0, 0.45, 0.3), { mode: "cut" }),
    fill(shape().circle(0, 0.45, 0.17)),
  ];
}

function cameraIcon() {
  return [
    fill(
      shape()
        .roundRect(-0.8, 0.1, 0.3, 0.7, 0.1)
        .polygon([
          [0.24, 0.4],
          [0.86, 0.72],
          [0.86, 0.08],
        ]),
      { round: 0.05 },
    ),
    fill(shape().circle(-0.24, 0.4, 0.17), { mode: "cut" }),
    fill(shape().circle(-0.24, 0.4, 0.08)),
  ];
}

/* Значок над клавишей: взгляд у первого лица, камера у третьего. */
const iconOverKey = (icon) => (marker, font) => [
  ...icon(),
  ...keycap(-0.56, -0.96, 0.56, -0.26, 0.06),
  label(marker.key, font, [-0.4, -0.74, 0.4, -0.4]),
  sparks(-0.56, -0.96, 0.56, -0.26, 0.05),
];

/*
 * Мышь с нажатой правой кнопкой: корпус контуром, кнопки разделены, правая
 * залита. Заливка заходит под контур корпуса и под черту между кнопками —
 * стык не встаёт полоской. Колеса нет: в залитой кнопке оно сливалось бы
 * с ней в выщербину.
 */
function mouseIcon() {
  return [
    stroke(shape().roundRect(-0.6, -0.94, 0.6, 0.94, 0.56), 0.11),
    stroke(
      shape().move(-0.6, 0.12).line(0.6, 0.12).move(0, 0.12).line(0, 0.94),
      0.09,
      {
        cap: "butt",
      },
    ),
    fill(
      shape()
        .move(0, 0.1)
        .line(0.62, 0.1)
        .line(0.62, 0.42)
        .curve(0.62, 0.74, 0.34, 0.96, 0, 0.96)
        .close(),
    ),
  ];
}

/* Двое: «вдвоём залезем» — два человека плечом к плечу. Голова от плеч
   отделена шеей, а не касается их: стык точкой читался бы пятном. */
function duoIcon() {
  const person = (cx) =>
    shape()
      .circle(cx, 0.66, 0.24)
      .roundRect(cx - 0.32, -0.94, cx + 0.32, 0.32, 0.26);
  return [fill(person(-0.44)), fill(person(0.44))];
}

/* Стрелки прежнего «Направления» — остриём вправо, в рамке 2 : 1. */
const ROUTE_ART = {
  "chevrons-2": () => [chevron(-0.28, 0.78, 0.36), chevron(0.92, 0.78, 0.36)],
  chevron: () => [chevron(0.34, 0.8, 0.46)],
  arrow: () => [
    fill(
      shape()
        .rect(-1.84, -0.17, 0.5, 0.17)
        .polygon([
          [0.2, 0.8],
          [1.88, 0],
          [0.2, -0.8],
        ]),
      { round: 0.05 },
    ),
  ],
  block: () => [
    fill(
      shape().polygon([
        [-1.84, -0.4],
        [0.3, -0.4],
        [0.3, -0.92],
        [1.88, 0],
        [0.3, 0.92],
        [0.3, 0.4],
        [-1.84, 0.4],
      ]),
      { round: 0.08 },
    ),
  ],
  triangles: () => [
    fill(
      [-1.14, 0.02, 1.18].reduce(
        (path, x) =>
          path.polygon([
            [x - 0.52, 0.74],
            [x + 0.56, 0],
            [x - 0.52, -0.74],
          ]),
        shape(),
      ),
      { round: 0.08 },
    ),
  ],
  dashed: () => [
    stroke(
      shape()
        .move(-1.74, 0)
        .line(-1.36, 0)
        .move(-1.02, 0)
        .line(-0.64, 0)
        .move(-0.3, 0)
        .line(0.24, 0),
      0.3,
      { cap: "round" },
    ),
    fill(
      shape().polygon([
        [0.14, 0.76],
        [1.88, 0],
        [0.14, -0.76],
      ]),
      { round: 0.06 },
    ),
  ],
};

function chevron(x, height, width) {
  return stroke(
    shape()
      .move(x - height * 0.96, height)
      .line(x, 0)
      .line(x - height * 0.96, -height),
    width,
    { cap: "butt", join: "miter" },
  );
}

/* Стрелка мода смотрит вверх: те же стрелки, повёрнутые остриём вверх и
   ужатые в квадратную рамку. */
const ARROW_ART = Object.fromEntries(
  Object.entries(ROUTE_ART).map(([id, art]) => [id, () => upward(art(), 0.5)]),
);

const VEHICLE_ART = {
  car: () => [
    fill(
      shape().polygon([
        [-0.96, -0.3],
        [0.96, -0.3],
        [0.98, -0.06],
        [0.88, 0.03],
        [0.52, 0.07],
        [0.26, 0.42],
        [-0.34, 0.44],
        [-0.64, 0.1],
        [-0.94, 0.05],
      ]),
      { round: 0.1 },
    ),
    fill(
      shape()
        .polygon([
          [-0.54, 0.12],
          [-0.1, 0.12],
          [-0.1, 0.35],
          [-0.3, 0.35],
        ])
        .polygon([
          [0.01, 0.12],
          [0.42, 0.12],
          [0.22, 0.35],
          [0.01, 0.35],
        ]),
      { mode: "cut", round: 0.03 },
    ),
    fill(shape().circle(-0.56, -0.3, 0.31).circle(0.56, -0.3, 0.31), {
      mode: "cut",
    }),
    fill(shape().circle(-0.56, -0.3, 0.24).circle(0.56, -0.3, 0.24)),
    fill(shape().circle(-0.56, -0.3, 0.09).circle(0.56, -0.3, 0.09), {
      mode: "cut",
    }),
  ],
  "car-front": () => [
    fill(
      shape()
        .roundRect(-0.92, -0.44, 0.92, 0.28, 0.2)
        .polygon([
          [-0.64, 0.22],
          [0.64, 0.22],
          [0.5, 0.76],
          [-0.5, 0.76],
        ])
        .roundRect(-0.84, -0.76, -0.5, -0.34, 0.08)
        .roundRect(0.5, -0.76, 0.84, -0.34, 0.08)
        .roundRect(-0.98, 0.16, -0.72, 0.32, 0.05)
        .roundRect(0.72, 0.16, 0.98, 0.32, 0.05),
      { round: 0.04 },
    ),
    fill(
      shape()
        .polygon([
          [-0.52, 0.32],
          [0.52, 0.32],
          [0.42, 0.67],
          [-0.42, 0.67],
        ])
        .circle(-0.6, -0.04, 0.14)
        .circle(0.6, -0.04, 0.14)
        .roundRect(-0.3, -0.22, 0.3, -0.04, 0.05),
      { mode: "cut", round: 0.03 },
    ),
  ],
  tire: () => {
    const spokes = shape().circle(0, 0, 0.17);
    for (let index = 0; index < 5; index += 1)
      spokes.polygon(
        rotate(
          [
            [-0.065, 0.1],
            [0.065, 0.1],
            [0.065, 0.58],
            [-0.065, 0.58],
          ],
          index * 72,
        ),
      );
    const treads = shape();
    for (let index = 0; index < 18; index += 1)
      treads.polygon(
        rotate(
          [
            [-0.035, 0.86],
            [0.035, 0.86],
            [0.035, 1.02],
            [-0.035, 1.02],
          ],
          index * 20,
        ),
      );
    return [
      fill(ring(shape(), 0, 0, 0.96, 0.66)),
      fill(treads, { mode: "cut" }),
      fill(ring(spokes, 0, 0, 0.56, 0.47)),
    ];
  },
  wheel: () => [
    fill(ring(shape(), 0, 0, 0.95, 0.76).circle(0, 0, 0.23)),
    stroke(
      shape().move(-0.82, 0.02).line(0.82, 0.02).move(0, 0).line(0, -0.82),
      0.17,
      { cap: "butt" },
    ),
  ],
};

/* Значки каждой метки: вид → рисунок (`marker`, `font` — для клавиши). */
const ICON_ART = {
  arrow: ARROW_ART,
  stay: SPOT_ART,
  firstpov: { icon: iconOverKey(eyeIcon) },
  thirdpov: { icon: iconOverKey(cameraIcon) },
  rightclick: { mouse: mouseIcon },
  car: VEHICLE_ART,
  teamneed: { duo: duoIcon },
  hit: { target: SPOT_ART.target, cross: SPOT_ART.cross },
};

/* ------------------------------------------------------------------ *
 * Вход
 * ------------------------------------------------------------------ */

/**
 * Рисунок метки.
 *
 * `design` — приведённый макет (`normalizeClimbDesign`). Возвращает пропорцию
 * рамки и список операций. Вид «своя картинка» отдаёт одну операцию
 * `image` на всю рамку: саму картинку и то, как она ложится, подставляет
 * рисовальщик. «Как в моде» у метки с прозрачной текстурой — пустой рисунок.
 */
export function climbMarkerArt(design, slotId) {
  const slot = findClimbSlot(slotId);
  if (!slot) throw new Error(`Неизвестная метка залаза: ${slotId}.`);
  const marker = design.markers[slotId];
  const variantId = marker.variant;
  const aspect = slot.aspect;
  if (variantId === "image")
    return {
      aspect,
      ops: [
        {
          type: "image",
          layer: "fill",
          mode: "add",
          box: [-aspect, -1, aspect, 1],
          image: marker.image,
        },
      ],
    };
  if (variantId === "original")
    return {
      aspect,
      ops: slot.blank ? [] : [fill(climbOriginalPath(slotId))],
    };
  const ops =
    slot.text && WORD_VARIANTS.includes(variantId)
      ? wordsArt(variantId, aspect, marker, climbFontKey(design.style))
      : ICON_ART[slotId]?.[variantId]?.(marker, climbFontKey(design.style));
  if (!ops)
    throw new Error(`Вид «${variantId}» метки «${slot.label}» без рисунка.`);
  return { aspect, ops };
}

/*
 * Разработке — вслух: вид без рисунка всплыл бы только пустой плашкой в
 * игре. Проверка стоит здесь, а не в тесте, потому что списки расходятся
 * ровно тогда, когда вид добавляют.
 */
const missing = Object.entries(CLIMB_VARIANTS).flatMap(([slotId, variants]) =>
  variants
    .filter((item) => !["original", "image"].includes(item.id))
    .filter((item) => {
      const slot = findClimbSlot(slotId);
      if (slot.text && WORD_VARIANTS.includes(item.id))
        return !wordsArt(item.id, slot.aspect, slot.text, "impact");
      return !ICON_ART[slotId]?.[item.id];
    })
    .map((item) => `${slotId}/${item.id}`),
);
if (missing.length)
  throw new Error(`Виды меток залаза без рисунка: ${missing.join(", ")}.`);
