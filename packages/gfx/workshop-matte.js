// Матовое поле плиток мастерской: тёмный край и мягкое световое пятно — та же картина, что в CSS окна:
// radial-gradient(120% 90% at 50% 38%, rgba(255,255,255,.07), transparent 64%), #0c0c0c.

export const WORKSHOP_MATTE = Object.freeze({
  base: 12,
  glow: 0.07,
  x: 0.5,
  y: 0.38,
  radiusX: 1.2,
  radiusY: 0.9,
  stop: 0.64,
});

// Светлое поле под тёмные стволы (#222).
export const WORKSHOP_MATTE_LIFTED_BASE = 34;

// Светлая студия под прозрачные объёмы автора и тёмные цвета, что на тёмном поле сливаются с ним (прострелы ALLIANCE V3 RP, 13.11.2026): серый края 222.
export const WORKSHOP_MATTE_LIGHT_BASE = 222;

// Пятно в долях кадра: смещения от центра в радиусах эллипса и яркость по ним.
class Spotlight {
  constructor({ base, glow, x, y, radiusX, radiusY, stop }) {
    this.edge = base / 255;
    this.glow = glow;
    this.centerX = x;
    this.centerY = y;
    this.radiusX = radiusX;
    this.radiusY = radiusY;
    this.stop = stop;
  }

  acrossX(fx) {
    return (fx - this.centerX) / this.radiusX;
  }

  acrossY(fy) {
    return (fy - this.centerY) / this.radiusY;
  }

  // Math.hypot: бесконечное смещение по одной оси даёт край даже при NaN по другой.
  // Math.max не глушит NaN — он доходит до ответа.
  level(dx, dy) {
    const light = this.glow * Math.max(0, 1 - Math.hypot(dx, dy) / this.stop);
    return this.edge + light * (1 - this.edge);
  }
}

const SPOT = new Spotlight(WORKSHOP_MATTE);

export function workshopMatteLevel(x, y, width, height) {
  return SPOT.level(SPOT.acrossX(x / width), SPOT.acrossY(y / height));
}

export function workshopMatteRgba(width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Смещение по x одно на столбец — считается один раз на весь растр.
  const columns = [];
  for (let x = 0; x < width; x++) columns.push(SPOT.acrossX((x + 0.5) / width));

  for (let y = 0; y < height; y++) {
    const dy = SPOT.acrossY((y + 0.5) / height);
    const rowAt = y * width;
    for (let x = 0; x < columns.length; x++) {
      const grey = Math.round(SPOT.level(columns[x], dy) * 255);
      // При дробной ширине место бывает дробным или за концом — такая запись молча не делается.
      // Поэтому индексами, а не fill(): тот округлил бы дробное место.
      const at = (rowAt + x) * 4;
      rgba[at] = grey;
      rgba[at + 1] = grey;
      rgba[at + 2] = grey;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

// Рисование на холсте 2D — шаги по порядку; `scene` несёт размер, серый края и градиент между шагами.
const PAINT_STEPS = [
  (ctx) => ctx.save(),
  (ctx, scene) => {
    ctx.fillStyle = `rgb(${scene.base}, ${scene.base}, ${scene.base})`;
  },
  (ctx, scene) => ctx.fillRect(0, 0, scene.width, scene.height),
  // Эллипс пятна становится кругом радиуса 1 с центром в начале координат.
  (ctx, { width, height }) =>
    ctx.setTransform(
      WORKSHOP_MATTE.radiusX * width,
      0,
      0,
      WORKSHOP_MATTE.radiusY * height,
      WORKSHOP_MATTE.x * width,
      WORKSHOP_MATTE.y * height,
    ),
  (ctx, scene) => {
    scene.gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  },
  (ctx, { gradient }) => gradient.addColorStop(0, `rgba(255, 255, 255, ${WORKSHOP_MATTE.glow})`),
  (ctx, { gradient }) => gradient.addColorStop(WORKSHOP_MATTE.stop, "rgba(255, 255, 255, 0)"),
  (ctx, { gradient }) => gradient.addColorStop(1, "rgba(255, 255, 255, 0)"),
  (ctx, { gradient }) => {
    ctx.fillStyle = gradient;
  },
  (ctx) => ctx.fillRect(-2, -2, 4, 4),
  (ctx) => ctx.restore(),
];

export function paintWorkshopMatte(context, width, height, { base = WORKSHOP_MATTE.base } = {}) {
  const scene = { width, height, base, gradient: null };
  for (const step of PAINT_STEPS) step(context, scene);
}
