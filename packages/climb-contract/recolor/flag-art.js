/*
 * Флаги стран для редактора «Флаги» (задача 7 ТЗ 10.10.2026, вечер) —
 * векторно, кодом: полосы, кресты, круги, звёзды и контуры гербов по их
 * геометрии. Чужих картинок нет, и одна и та же арифметика рисует плитку
 * шаблона и кадр окна и лист, что уходит в игру (`flags.js` → установщик).
 *
 * Рисунок — в «единицах флага»: высота полотнища — 1, длина — `aspect`
 * (у ткани игры ≈ 1,9). Полосы и поля тянутся по длине, а круги, звёзды и
 * гербы держат свои пропорции и место от древка в долях высоты — так флаги
 * и вешают на полотнища другой пропорции. Растеризатор — построчный, с
 * пятью подстроками на пиксель и точным покрытием по горизонтали:
 * сглаженные края без холста и без браузера (тот же код в главном процессе).
 *
 * Гербы Беларуси, Казахстана, Мексики и надпись на флаге Бразилии — упрощённые
 * (узор, орёл, лента без букв): лист флага — 256 × 128, мелочь до игры не
 * доезжает. Испания — гражданский флаг, без герба.
 */

import { hexBytes } from "./colour.js";

const SUB = 5;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ *
 * Растеризатор
 * ------------------------------------------------------------------ */

/** Пустая картинка `width × height` (RGBA, непрозрачная, цвет `fill`). */
export function createPicture(width, height, fill = "#ffffff") {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = hexBytes(fill);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  }
  return { rgba, width, height };
}

/*
 * Покрытие пикселей контурами (`rings` — точки в пикселях): строка за
 * строкой, `SUB` подстрок на пиксель, отрезки внутри — точно по x.
 * `rule` — `nonzero` или `evenodd`. Ответ — `{ x0, y0, w, h, cover }`.
 */
function coverage(rings, width, height, rule) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const edges = [];
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const [x1, y1] = ring[index];
      const [x2, y2] = ring[(index + 1) % ring.length];
      minX = Math.min(minX, x1);
      maxX = Math.max(maxX, x1);
      minY = Math.min(minY, y1);
      maxY = Math.max(maxY, y1);
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(width, Math.ceil(maxX) + 1);
  const y1 = Math.min(height, Math.ceil(maxY) + 1);
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const cover = new Float32Array(w * h);
  if (!w || !h) return { x0, y0, w, h, cover };
  const crossings = [];
  for (let row = 0; row < h; row += 1) {
    for (let sub = 0; sub < SUB; sub += 1) {
      const sy = y0 + row + (sub + 0.5) / SUB;
      crossings.length = 0;
      for (const [ax, ay, bx, by] of edges) {
        const low = Math.min(ay, by);
        const high = Math.max(ay, by);
        if (sy < low || sy >= high) continue;
        crossings.push([ax + ((sy - ay) * (bx - ax)) / (by - ay), by > ay ? 1 : -1]);
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let index = 0; index < crossings.length - 1; index += 1) {
        winding += crossings[index][1];
        const inside = rule === "evenodd" ? Math.abs(winding) % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const a = Math.max(x0, crossings[index][0]);
        const b = Math.min(x1, crossings[index + 1][0]);
        if (b <= a) continue;
        const line = row * w;
        for (let px = Math.floor(a); px < b && px < x1; px += 1) {
          const overlap = Math.min(b, px + 1) - Math.max(a, px);
          if (overlap > 0) cover[line + px - x0] += overlap / SUB;
        }
      }
    }
  }
  return { x0, y0, w, h, cover };
}

function blend(picture, area, colour, mask = null) {
  const [r, g, b] = typeof colour === "string" ? hexBytes(colour) : colour;
  const { rgba, width } = picture;
  for (let row = 0; row < area.h; row += 1)
    for (let column = 0; column < area.w; column += 1) {
      let alpha = Math.min(1, area.cover[row * area.w + column]);
      if (mask) alpha *= mask(area.x0 + column, area.y0 + row);
      if (alpha <= 0) continue;
      const at = ((area.y0 + row) * width + area.x0 + column) * 4;
      rgba[at] += (r - rgba[at]) * alpha;
      rgba[at + 1] += (g - rgba[at + 1]) * alpha;
      rgba[at + 2] += (b - rgba[at + 2]) * alpha;
    }
}

/* ------------------------------------------------------------------ *
 * Кисть в единицах флага
 * ------------------------------------------------------------------ */

/** Многоугольник окружности. */
export function circleRing(cx, cy, r, segments = 72) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * TAU;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
}

/*
 * Звезда: `points` лучей, внешний радиус `outer`, внутренний `inner`,
 * `angle` — куда смотрит первый луч (радианы, 0 — вправо, −π/2 — вверх).
 */
export function starRing(cx, cy, outer, inner, points = 5, angle = -Math.PI / 2) {
  const out = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 ? inner : outer;
    const a = angle + (index * Math.PI) / points;
    out.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return out;
}

/* Правильная пятиконечная звезда: внутренний радиус по внешнему. */
const PENTAGRAM = Math.sin(Math.PI / 10) / Math.sin((3 * Math.PI) / 10);

/** Повёрнутый прямоугольник: середина, длина, толщина, угол. */
export function barRing(cx, cy, length, thickness, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const hl = length / 2;
  const ht = thickness / 2;
  return [
    [cx - dx * hl + dy * ht, cy - dy * hl - dx * ht],
    [cx + dx * hl + dy * ht, cy + dy * hl - dx * ht],
    [cx + dx * hl - dy * ht, cy + dy * hl + dx * ht],
    [cx - dx * hl - dy * ht, cy - dy * hl + dx * ht],
  ];
}

/*
 * Кисть флага в прямоугольнике картинки `rect` (`[x0, y0, x1, y1]`, пиксели):
 * единицы флага → пиксели, фигуры → сглаженная заливка.
 */
function brush(picture, rect, aspect) {
  const [rx0, ry0, rx1, ry1] = rect;
  const sx = (rx1 - rx0) / aspect;
  const sy = ry1 - ry0;
  const toPixels = (ring) => ring.map(([x, y]) => [rx0 + x * sx, ry0 + y * sy]);
  const fill = (rings, colour, { rule = "nonzero", mask = null } = {}) => {
    const list = Array.isArray(rings[0][0]) ? rings : [rings];
    blend(picture, coverage(list.map(toPixels), picture.width, picture.height, rule), colour, mask);
  };
  return {
    w: aspect,
    /* Прямоугольник по осям (единицы флага). */
    rect: (x, y, w, h, colour) =>
      fill(
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
        colour,
      ),
    fill,
    circle: (cx, cy, r, colour, options) => fill(circleRing(cx, cy, r), colour, options),
    star: (cx, cy, outer, colour, { inner = outer * PENTAGRAM, points = 5, angle = -Math.PI / 2 } = {}) => fill(starRing(cx, cy, outer, inner, points, angle), colour),
    /* Маска «внутри окружности» — для того, что не выходит за круг (лента глобуса). */
    circleMask(cx, cy, r) {
      const area = coverage([toPixels(circleRing(cx, cy, r, 96))], picture.width, picture.height, "nonzero");
      return (px, py) => {
        const column = px - area.x0;
        const row = py - area.y0;
        if (column < 0 || row < 0 || column >= area.w || row >= area.h) return 0;
        return Math.min(1, area.cover[row * area.w + column]);
      };
    },
  };
}

const horizontal = (p, colours) => colours.forEach((colour, index) => p.rect(0, index / colours.length, p.w, 1 / colours.length, colour));
const vertical = (p, colours) => colours.forEach((colour, index) => p.rect((index * p.w) / colours.length, 0, p.w / colours.length, 1, colour));

/* Полоса дуги: кольцо от `r0` до `r1` между углами `a0`…`a1`. */
function arcBand(cx, cy, r0, r1, a0, a1, segments = 48) {
  const outer = [];
  const inner = [];
  for (let index = 0; index <= segments; index += 1) {
    const a = a0 + ((a1 - a0) * index) / segments;
    outer.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
    inner.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]);
  }
  return [...outer, ...inner.reverse()];
}

/* ------------------------------------------------------------------ *
 * Сложные части
 * ------------------------------------------------------------------ */

/* Британский флаг: андреевский и патриков кресты по диагоналям, георгиевский — поверх. */
function unionJack(p) {
  const W = p.w;
  p.rect(0, 0, W, 1, "#012169");
  const diagonal = Math.hypot(W, 1);
  const centre = [W / 2, 0.5];
  /* Белые диагонали — во всю длину, 1/5 высоты. */
  for (const angle of [Math.atan2(1, W), Math.atan2(-1, W)]) p.fill(barRing(centre[0], centre[1], diagonal * 1.2, 0.2, angle), "#ffffff");
  /*
   * Красные — 1/15 высоты, со сдвигом «вертушкой»: у древка сверху широкая
   * белая кайма над красной (красная — ниже диагонали), напротив — выше;
   * сдвиг каждого луча — его направление, повёрнутое против часовой стрелки.
   */
  for (const [dx, dy] of [
    [-W / 2, -0.5],
    [W / 2, -0.5],
    [W / 2, 0.5],
    [-W / 2, 0.5],
  ]) {
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const nx = uy;
    const ny = -ux;
    const offset = 1 / 30;
    const far = length * 1.3;
    const red = 1 / 15;
    const mx = centre[0] + nx * offset;
    const my = centre[1] + ny * offset;
    p.fill(
      [
        [mx - nx * (red / 2), my - ny * (red / 2)],
        [mx - nx * (red / 2) + ux * far, my - ny * (red / 2) + uy * far],
        [mx + nx * (red / 2) + ux * far, my + ny * (red / 2) + uy * far],
        [mx + nx * (red / 2), my + ny * (red / 2)],
      ],
      "#c8102e",
    );
  }
  /* Георгиевский крест: белый 1/3 высоты, красный 1/5. */
  p.rect(0, 1 / 3, W, 1 / 3, "#ffffff");
  p.rect(W / 2 - 1 / 6, 0, 1 / 3, 1, "#ffffff");
  p.rect(0, 0.4, W, 0.2, "#c8102e");
  p.rect(W / 2 - 0.1, 0, 0.2, 1, "#c8102e");
}

/* США: тринадцать полос, крыж 7/13 высоты и 0,76 длины высоты, пятьдесят звёзд. */
function unitedStates(p) {
  const W = p.w;
  for (let index = 0; index < 13; index += 1) p.rect(0, index / 13, W, 1 / 13, index % 2 ? "#ffffff" : "#b22234");
  p.rect(0, 0, 0.76, 7 / 13, "#3c3b6e");
  const radius = 0.0616 / 2;
  for (let row = 0; row < 9; row += 1) {
    const count = row % 2 ? 5 : 6;
    for (let column = 0; column < count; column += 1) {
      const x = 0.063 * (row % 2 ? 2 + column * 2 : 1 + column * 2);
      p.star(x, 0.054 * (row + 1), radius, "#ffffff");
    }
  }
}

/* Беларусь: красное и зелёное, у древка — белая полоса с красным узором. */
function belarus(p) {
  const W = p.w;
  p.rect(0, 0, W, 2 / 3, "#c8313e");
  p.rect(0, 2 / 3, W, 1 / 3, "#4aa657");
  const band = W / 9;
  p.rect(0, 0, band, 1, "#ffffff");
  const cx = band / 2;
  const red = "#c8313e";
  const units = 4;
  for (let unit = 0; unit < units; unit += 1) {
    const cy = (unit + 0.5) / units;
    const diamond = (hw, hh, colour) =>
      p.fill(
        [
          [cx, cy - hh],
          [cx + hw, cy],
          [cx, cy + hh],
          [cx - hw, cy],
        ],
        colour,
      );
    diamond(band * 0.4, 0.105, red);
    diamond(band * 0.26, 0.068, "#ffffff");
    diamond(band * 0.13, 0.034, red);
    /* Ромбики на стыках и зубцы у краёв полосы. */
    const top = unit / units;
    p.fill(
      [
        [cx, top - 0.028],
        [cx + band * 0.2, top],
        [cx, top + 0.028],
        [cx - band * 0.2, top],
      ],
      red,
    );
    for (const edge of [0, band])
      p.fill(
        [
          [edge, cy - 0.045],
          [edge + (edge ? -1 : 1) * band * 0.16, cy],
          [edge, cy + 0.045],
        ],
        red,
      );
  }
}

/* Казахстан: солнце с 32 лучами, степной орёл, узор у древка. */
function kazakhstan(p) {
  const W = p.w;
  const gold = "#fec50c";
  p.rect(0, 0, W, 1, "#00afca");
  const cx = W / 2 + 0.03;
  const cy = 0.4;
  p.circle(cx, cy, 0.13, gold);
  for (let index = 0; index < 32; index += 1) {
    const a = (index / 32) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const side = 0.045;
    p.fill(
      [
        [cx + c * 0.152, cy + s * 0.152],
        [cx + Math.cos(a + side) * 0.19, cy + Math.sin(a + side) * 0.19],
        [cx + c * 0.228, cy + s * 0.228],
        [cx + Math.cos(a - side) * 0.19, cy + Math.sin(a - side) * 0.19],
      ],
      gold,
    );
  }
  /* Орёл: крылья с перьями, тело, голова клювом к древку, хвост. */
  const ey = 0.71;
  for (const dir of [-1, 1]) {
    const lead = [];
    const trail = [];
    for (let step = 0; step <= 14; step += 1) {
      const t = step / 14;
      const x = cx + dir * (0.03 + 0.31 * t);
      const y = ey - 0.025 - 0.07 * Math.sin((t * Math.PI) / 2) + 0.045 * t * t;
      lead.push([x, y]);
      /* Перья по заднему краю — зубцами, к концу крыла мельче. */
      const thick = 0.095 * (1 - t) + 0.02;
      const tooth = step % 2 ? 0.022 * (1 - 0.5 * t) : 0;
      trail.push([x, y + thick + tooth]);
    }
    p.fill([...lead, ...trail.reverse()], gold);
  }
  p.fill(circleRing(cx, ey + 0.005, 0.042, 32).map(([x, y]) => [cx + (x - cx) * 0.8, y]), gold);
  p.circle(cx - 0.035, ey - 0.055, 0.024, gold);
  p.fill(
    [
      [cx - 0.052, ey - 0.066],
      [cx - 0.082, ey - 0.052],
      [cx - 0.05, ey - 0.042],
    ],
    gold,
  );
  p.fill(
    [
      [cx - 0.022, ey + 0.035],
      [cx + 0.022, ey + 0.035],
      [cx + 0.04, ey + 0.1],
      [cx - 0.04, ey + 0.1],
    ],
    gold,
  );
  /* Узор у древка: полые ромбы с завитками-зубцами. */
  const ox = 0.11;
  for (let unit = 0; unit < 5; unit += 1) {
    const oy = 0.1 + unit * 0.2;
    p.fill(
      [
        [
          [ox, oy - 0.075],
          [ox + 0.05, oy],
          [ox, oy + 0.075],
          [ox - 0.05, oy],
        ],
        [
          [ox, oy - 0.045],
          [ox + 0.028, oy],
          [ox, oy + 0.045],
          [ox - 0.028, oy],
        ],
      ],
      gold,
      { rule: "evenodd" },
    );
    for (const dir of [-1, 1])
      p.fill(
        [
          [ox + dir * 0.03, oy + 0.06],
          [ox + dir * 0.065, oy + 0.085],
          [ox + dir * 0.045, oy + 0.11],
          [ox + dir * 0.02, oy + 0.085],
        ],
        gold,
      );
  }
}

/* Турция: полумесяц и звезда от древка, как в законе о флаге (в долях высоты). */
function turkey(p) {
  p.rect(0, 0, p.w, 1, "#e30a17");
  p.circle(0.5, 0.5, 0.25, "#ffffff");
  p.circle(0.5625, 0.5, 0.2, "#e30a17");
  p.star(0.8208, 0.5, 0.125, "#ffffff", { angle: Math.PI });
}

/* Китай: большая звезда и четыре малых, каждая лучом к большой. */
function china(p) {
  p.rect(0, 0, p.w, 1, "#ee1c25");
  p.star(0.25, 0.25, 0.15, "#ffff00");
  for (const [x, y] of [
    [0.5, 0.1],
    [0.6, 0.2],
    [0.6, 0.35],
    [0.5, 0.45],
  ])
    p.star(x, y, 0.05, "#ffff00", { angle: Math.atan2(0.25 - y, 0.25 - x) });
}

/* Южная Корея: тхэгык по диагонали полотнища и четыре триграммы. */
function southKorea(p) {
  const W = p.w;
  p.rect(0, 0, W, 1, "#ffffff");
  const cx = W / 2;
  const cy = 0.5;
  const R = 0.25;
  const axis = Math.atan2(1, W);
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  const at = (u, v) => [cx + ux * u - uy * v, cy + uy * u + ux * v];
  /* Верх — красный, низ — синий, разделены по оси; головы — малыми кругами. */
  const half = (sign) => {
    const ring = [];
    for (let index = 0; index <= 48; index += 1) {
      const a = (index / 48) * Math.PI;
      ring.push(at(Math.cos(a) * R, sign * Math.sin(a) * R));
    }
    return ring;
  };
  p.fill(half(-1), "#cd2e3a");
  p.fill(half(1), "#0047a0");
  p.fill(circleRing(0, 0, R / 2, 48).map(([u, v]) => at(u - R / 2, v)), "#cd2e3a");
  p.fill(circleRing(0, 0, R / 2, 48).map(([u, v]) => at(u + R / 2, v)), "#0047a0");
  /* Триграммы: ☰ у древка сверху, ☷ напротив, ☵ и ☲ на другой диагонали. */
  const bar = 0.25;
  const width = 1 / 24;
  const gap = 1 / 48;
  const distance = R + 1 / 8 + (3 * width + 2 * gap) / 2;
  const trigram = (dirX, dirY, lines) => {
    const length = Math.hypot(dirX, dirY);
    const rx = dirX / length;
    const ry = dirY / length;
    lines.forEach((solid, index) => {
      const offset = distance - (3 * width + 2 * gap) / 2 + width / 2 + index * (width + gap);
      const mx = cx + rx * offset;
      const my = cy + ry * offset;
      const along = Math.atan2(rx, -ry);
      if (solid) p.fill(barRing(mx, my, bar, width, along), "#000000");
      else
        for (const sign of [-1, 1]) {
          const part = (bar - gap) / 2;
          const shift = (gap + part) / 2;
          p.fill(barRing(mx + Math.cos(along) * shift * sign, my + Math.sin(along) * shift * sign, part, width, along), "#000000");
        }
    });
  };
  trigram(-W / 2, -0.5, [true, true, true]);
  trigram(W / 2, 0.5, [false, false, false]);
  trigram(W / 2, -0.5, [false, true, false]);
  trigram(-W / 2, 0.5, [true, false, true]);
}

/* Бразилия: ромб, глобус, белая лента дугой (без надписи) и звёзды южного неба. */
function brazil(p) {
  const W = p.w;
  p.rect(0, 0, W, 1, "#009c3b");
  const inset = 1.7 / 14;
  p.fill(
    [
      [inset, 0.5],
      [W / 2, inset],
      [W - inset, 0.5],
      [W / 2, 1 - inset],
    ],
    "#ffdf00",
  );
  const cx = W / 2;
  const cy = 0.5;
  p.circle(cx, cy, 0.25, "#002776");
  const inside = p.circleMask(cx, cy, 0.25);
  const ax = cx + 2 / 14;
  const ay = cy + 9 / 14;
  p.fill(arcBand(ax, ay, 9 / 14, 9.6 / 14, Math.PI * 1.05, Math.PI * 1.95, 64), "#ffffff", { mask: inside });
  for (const [x, y, r] of [
    [0.13, -0.08, 0.016],
    [-0.12, 0.05, 0.014],
    [-0.06, 0.1, 0.012],
    [0.0, 0.13, 0.016],
    [0.07, 0.11, 0.012],
    [0.13, 0.06, 0.014],
    [-0.15, 0.12, 0.01],
    [0.03, 0.18, 0.012],
    [-0.04, 0.2, 0.01],
    [0.11, 0.16, 0.01],
    [-0.1, 0.16, 0.01],
    [0.18, 0.1, 0.01],
    [0.04, 0.06, 0.01],
  ])
    p.star(cx + x, cy + y, r, "#ffffff");
}

/* Канада: красные края по четверти длины и кленовый лист — по точкам официального контура. */
const MAPLE_STEPS = [
  [45, -863], [-111, -98], [-859, 151], [116, -320], [-20, -73], [-941, -762], [212, -99], [34, -79], [-186, -572], [542, 115],
  [73, -38], [105, -247], [423, 454], [111, -57], [-204, -1052], [327, 189], [91, -27], [332, -652], [332, 652], [91, 27],
  [327, -189], [-204, 1052], [111, 57], [423, -454], [105, 247], [73, 38], [542, -115], [-186, 572], [34, 79], [212, 99],
  [-941, 762], [-20, 73], [116, 320], [-859, -151], [-111, 98], [45, 863],
];
function mapleLeaf(cx, top, height) {
  let x = -90;
  let y = 0;
  const points = [[x, y]];
  for (const [dx, dy] of MAPLE_STEPS) {
    x += dx;
    y += dy;
    points.push([x, y]);
  }
  /* Контур: от низа черенка (0) до верхнего зубца (−4030). */
  const scale = height / 4030;
  return points.map(([px, py]) => [cx + px * scale, top + (py + 4030) * scale]);
}
function canada(p) {
  const W = p.w;
  p.rect(0, 0, W, 1, "#ffffff");
  p.rect(0, 0, W / 4, 1, "#d52b1e");
  p.rect((3 * W) / 4, 0, W / 4, 1, "#d52b1e");
  p.fill(mapleLeaf(W / 2, 0.12, 0.76), "#d52b1e");
}

/* Кисть, что рисует всё крупнее в `k` раз вокруг точки (герб — одной мерой). */
function zoomAround(p, cx, cy, k) {
  const move = (ring) => ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  return {
    fill: (rings, colour, options) => p.fill(Array.isArray(rings[0][0]) ? rings.map(move) : move(rings), colour, options),
    rect: (x, y, w, h, colour) =>
      p.fill(
        move([
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]),
        colour,
      ),
    circle: (x, y, r, colour) => p.fill(move(circleRing(x, y, r)), colour),
  };
}

/* Мексика: упрощённый герб — венок, кактус на камне, орёл со змеёй. */
function mexico(base) {
  const W = base.w;
  vertical(base, ["#006847", "#ffffff", "#ce1126"]);
  const cx = W / 2;
  const cy = 0.5;
  const p = zoomAround(base, cx, cy, 1.25);
  p.fill(arcBand(cx, cy - 0.01, 0.16, 0.2, Math.PI * 0.08, Math.PI * 0.92), "#3d7a2a");
  p.rect(cx - 0.03, cy + 0.17, 0.02, 0.025, "#006847");
  p.rect(cx - 0.01, cy + 0.17, 0.02, 0.025, "#ffffff");
  p.rect(cx + 0.01, cy + 0.17, 0.02, 0.025, "#ce1126");
  p.fill(arcBand(cx, cy + 0.19, 0.05, 0.075, Math.PI * 1.15, Math.PI * 1.85), "#4a86b5");
  for (const [x, y, rx, ry] of [
    [0, 0.08, 0.03, 0.045],
    [-0.04, 0.06, 0.022, 0.032],
    [0.04, 0.055, 0.022, 0.032],
  ])
    p.fill(circleRing(0, 0, 1, 32).map(([u, v]) => [cx + x + u * rx, cy + y + v * ry]), "#5a8f29");
  const brown = "#7a4a1e";
  p.fill(circleRing(0, 0, 1, 40).map(([u, v]) => [cx + 0.01 + u * 0.055, cy - 0.02 + v * 0.065]), brown);
  p.fill(
    [
      [cx - 0.03, cy - 0.06],
      [cx - 0.13, cy - 0.17],
      [cx - 0.1, cy - 0.12],
      [cx - 0.15, cy - 0.11],
      [cx - 0.1, cy - 0.06],
      [cx - 0.13, cy - 0.03],
      [cx - 0.04, cy - 0.01],
    ],
    brown,
  );
  p.fill(
    [
      [cx + 0.04, cy - 0.05],
      [cx + 0.12, cy - 0.16],
      [cx + 0.1, cy - 0.08],
      [cx + 0.06, cy - 0.02],
    ],
    brown,
  );
  p.circle(cx + 0.045, cy - 0.095, 0.024, brown);
  p.fill(
    [
      [cx + 0.062, cy - 0.105],
      [cx + 0.09, cy - 0.095],
      [cx + 0.064, cy - 0.085],
    ],
    "#d9a400",
  );
  const snake = [];
  for (let step = 0; step <= 12; step += 1) {
    const t = step / 12;
    snake.push([cx + 0.085 - 0.06 * t + 0.02 * Math.sin(t * TAU), cy - 0.09 + 0.12 * t]);
  }
  const thick = 0.009;
  p.fill([...snake.map(([x, y]) => [x - thick, y]), ...snake.reverse().map(([x, y]) => [x + thick, y])], "#3f7f2a");
}

/* Грузия: крест святого Георгия и четыре болнисских креста. */
function georgia(p) {
  const W = p.w;
  const red = "#ff0000";
  p.rect(0, 0, W, 1, "#ffffff");
  p.rect(0, 0.4, W, 0.2, red);
  p.rect(W / 2 - 0.1, 0, 0.2, 1, red);
  const q = (W / 2 - 0.1) / 2;
  const L = 0.09;
  const a = 0.018;
  const b = 0.042;
  for (const [x, y] of [
    [q, 0.2],
    [W - q, 0.2],
    [q, 0.8],
    [W - q, 0.8],
  ])
    p.fill(
      [
        [-b, -L],
        [b, -L],
        [a, -a],
        [L, -b],
        [L, b],
        [a, a],
        [b, L],
        [-b, L],
        [-a, a],
        [-L, b],
        [-L, -b],
        [-a, -a],
      ].map(([u, v]) => [x + u, y + v]),
      red,
    );
}

/* Азербайджан: полумесяц и восьмиконечная звезда по середине. */
function azerbaijan(p) {
  horizontal(p, ["#00b5e2", "#ef3340", "#509e2f"]);
  const cx = p.w / 2;
  p.circle(cx - 0.02, 0.5, 0.15, "#ffffff");
  p.circle(cx + 0.015, 0.5, 0.125, "#ef3340");
  p.star(cx + 0.11, 0.5, 0.075, "#ffffff", { inner: 0.036, points: 8 });
}

/* Узбекистан: полосы с красной каймой, полумесяц и двенадцать звёзд у древка. */
function uzbekistan(p) {
  const W = p.w;
  p.rect(0, 0, W, 1 / 3, "#0099b5");
  p.rect(0, 1 / 3, W, 1 / 3, "#ffffff");
  p.rect(0, 2 / 3, W, 1 / 3, "#1eb53a");
  p.rect(0, 1 / 3, W, 1 / 60, "#ce1126");
  p.rect(0, 2 / 3 - 1 / 60, W, 1 / 60, "#ce1126");
  p.circle(0.2, 0.165, 0.11, "#ffffff");
  p.circle(0.235, 0.165, 0.092, "#0099b5");
  const rows = [
    [0.075, 3],
    [0.165, 4],
    [0.255, 5],
  ];
  for (const [y, count] of rows)
    for (let index = 0; index < count; index += 1) p.star(0.62 - index * 0.07, y, 0.026, "#ffffff");
}

/* Израиль: две голубые полосы и звезда Давида — двумя контурами треугольников. */
function israel(p) {
  const W = p.w;
  const blue = "#0038b8";
  p.rect(0, 0, W, 1, "#ffffff");
  p.rect(0, 0.1, W, 0.15, blue);
  p.rect(0, 0.75, W, 0.15, blue);
  const R = 0.22;
  const inner = R - 2 * 0.022;
  const triangle = (radius, start) =>
    Array.from({ length: 3 }, (_, index) => {
      const a = start + (index * TAU) / 3;
      return [W / 2 + Math.cos(a) * radius, 0.5 + Math.sin(a) * radius];
    });
  for (const start of [-Math.PI / 2, Math.PI / 2]) p.fill([triangle(R, start), triangle(inner, start)], blue, { rule: "evenodd" });
}

/* Швеция: жёлтый скандинавский крест (5 : 2 : 9 по длине, 4 : 2 : 4 по высоте). */
function sweden(p) {
  p.rect(0, 0, p.w, 1, "#006aa7");
  p.rect(0, 0.4, p.w, 0.2, "#fecc00");
  p.rect(0.5, 0, 0.2, 1, "#fecc00");
}

/* ------------------------------------------------------------------ *
 * Шаблоны стран
 * ------------------------------------------------------------------ */

/*
 * Двадцать пять стран — самые частые у игроков (порядок — как в окне):
 * СНГ и соседи первыми, дальше Европа, Азия и Америка. `colours` — главные
 * цвета флага (подпись плитки и средний цвет, пока картинка не готова).
 */
export const FLAG_COUNTRIES = Object.freeze(
  [
    { id: "ru", label: "Россия", colours: ["#ffffff", "#0039a6", "#d52b1e"], draw: (p) => horizontal(p, ["#ffffff", "#0039a6", "#d52b1e"]) },
    { id: "ua", label: "Украина", colours: ["#0057b7", "#ffd700"], draw: (p) => horizontal(p, ["#0057b7", "#ffd700"]) },
    { id: "by", label: "Беларусь", colours: ["#c8313e", "#4aa657", "#ffffff"], draw: belarus },
    { id: "kz", label: "Казахстан", colours: ["#00afca", "#fec50c"], draw: kazakhstan },
    { id: "us", label: "США", colours: ["#b22234", "#ffffff", "#3c3b6e"], draw: unitedStates },
    { id: "gb", label: "Великобритания", colours: ["#012169", "#ffffff", "#c8102e"], draw: unionJack },
    { id: "de", label: "Германия", colours: ["#000000", "#dd0000", "#ffce00"], draw: (p) => horizontal(p, ["#000000", "#dd0000", "#ffce00"]) },
    { id: "fr", label: "Франция", colours: ["#0055a4", "#ffffff", "#ef4135"], draw: (p) => vertical(p, ["#0055a4", "#ffffff", "#ef4135"]) },
    { id: "it", label: "Италия", colours: ["#009246", "#ffffff", "#ce2b37"], draw: (p) => vertical(p, ["#009246", "#ffffff", "#ce2b37"]) },
    {
      id: "es",
      label: "Испания",
      colours: ["#aa151b", "#f1bf00"],
      draw: (p) => {
        p.rect(0, 0, p.w, 1, "#aa151b");
        p.rect(0, 0.25, p.w, 0.5, "#f1bf00");
      },
    },
    { id: "pl", label: "Польша", colours: ["#ffffff", "#dc143c"], draw: (p) => horizontal(p, ["#ffffff", "#dc143c"]) },
    { id: "tr", label: "Турция", colours: ["#e30a17", "#ffffff"], draw: turkey },
    {
      id: "jp",
      label: "Япония",
      colours: ["#ffffff", "#bc002d"],
      draw: (p) => {
        p.rect(0, 0, p.w, 1, "#ffffff");
        p.circle(p.w / 2, 0.5, 0.3, "#bc002d");
      },
    },
    { id: "cn", label: "Китай", colours: ["#ee1c25", "#ffff00"], draw: china },
    { id: "kr", label: "Южная Корея", colours: ["#ffffff", "#cd2e3a", "#0047a0"], draw: southKorea },
    { id: "br", label: "Бразилия", colours: ["#009c3b", "#ffdf00", "#002776"], draw: brazil },
    { id: "ca", label: "Канада", colours: ["#d52b1e", "#ffffff"], draw: canada },
    { id: "mx", label: "Мексика", colours: ["#006847", "#ffffff", "#ce1126"], draw: mexico },
    { id: "am", label: "Армения", colours: ["#d90012", "#0033a0", "#f2a800"], draw: (p) => horizontal(p, ["#d90012", "#0033a0", "#f2a800"]) },
    { id: "ge", label: "Грузия", colours: ["#ffffff", "#ff0000"], draw: georgia },
    { id: "az", label: "Азербайджан", colours: ["#00b5e2", "#ef3340", "#509e2f"], draw: azerbaijan },
    { id: "uz", label: "Узбекистан", colours: ["#0099b5", "#ffffff", "#1eb53a"], draw: uzbekistan },
    { id: "se", label: "Швеция", colours: ["#006aa7", "#fecc00"], draw: sweden },
    { id: "nl", label: "Нидерланды", colours: ["#ae1c28", "#ffffff", "#21468b"], draw: (p) => horizontal(p, ["#ae1c28", "#ffffff", "#21468b"]) },
    { id: "il", label: "Израиль", colours: ["#ffffff", "#0038b8"], draw: israel },
  ].map((country) => Object.freeze(country)),
);

export const FLAG_COUNTRY_IDS = Object.freeze(FLAG_COUNTRIES.map((country) => country.id));
const countryById = new Map(FLAG_COUNTRIES.map((country) => [country.id, country]));

/** Шаблон страны или `null`. */
export const flagCountry = (id) => countryById.get(id) || null;

/**
 * Флаг страны в прямоугольник картинки: `rect` — `[x0, y0, x1, y1]` в
 * пикселях, `aspect` — длина полотнища к высоте (как его увидит игрок).
 */
export function drawCountryFlag(picture, countryId, rect = [0, 0, picture.width, picture.height], aspect = (rect[2] - rect[0]) / (rect[3] - rect[1])) {
  const country = flagCountry(countryId);
  if (!country) throw new Error(`Шаблона флага «${countryId}» нет.`);
  country.draw(brush(picture, rect, aspect));
  return picture;
}
