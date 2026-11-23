// Размеры арены в метрах и перевод долей поверхности в точки мира и обратно.

const TAU = Math.PI * 2;

const GEOMETRY = {
  PIT_SEGMENTS: 32,
  BACK_WALL_SEGMENTS: 48,
  PIT_RADIUS: 13,
  PIT_WALL_HEIGHT: 2.4,
  PIT_WALL_PANELS: 16,
  STAND_ROWS: 4,
  STAND_ROW_DEPTH: 1.5,
  STAND_ROW_RISE: 0.82,
  STAND_SECTORS: 8,
  SEAT_PITCH: 0.62,
  SECTOR_GAP: 0.16,
  BACK_WALL_HEIGHT: 9,
  BACK_WALL_PANELS: 8,
  STAR_RADIUS: 4.6,
};

export const {
  PIT_SEGMENTS,
  BACK_WALL_SEGMENTS,
  PIT_RADIUS,
  PIT_WALL_HEIGHT,
  PIT_WALL_PANELS,
  STAND_ROWS,
  STAND_ROW_DEPTH,
  STAND_ROW_RISE,
  STAND_SECTORS,
  SEAT_PITCH,
  SECTOR_GAP,
  BACK_WALL_HEIGHT,
  BACK_WALL_PANELS,
  STAR_RADIUS,
} = GEOMETRY;

export const STAND_OUTER_RADIUS = PIT_RADIUS + STAND_ROWS * STAND_ROW_DEPTH + 0.6;
export const BACK_WALL_RADIUS = STAND_OUTER_RADIUS + 0.4;
export const STAND_TOP_HEIGHT = PIT_WALL_HEIGHT + STAND_ROWS * STAND_ROW_RISE;

export const DEFAULT_SURFACE_ID = "pit-wall";

// Поля поверхности по видам, в порядке значений строки таблицы.
const FIELDS_BY_KIND = {
  disc: ["radius", "width", "height", "panels"],
  ring: ["radius", "height", "width", "panels", "segments", "inward", "base"],
};

// Строка: id, вид, подписи ru и en, затем значения полей своего вида.
const SURFACE_ROWS = [
  ["floor", "disc", "Пол арены", "Arena floor", PIT_RADIUS, PIT_RADIUS * 2, PIT_RADIUS * 2, 0],
  [
    "pit-wall",
    "ring",
    "Борт пита",
    "Pit wall",
    PIT_RADIUS,
    PIT_WALL_HEIGHT,
    TAU * PIT_RADIUS,
    PIT_WALL_PANELS,
    PIT_SEGMENTS,
    true,
  ],
  [
    "back-wall",
    "ring",
    "Стена за трибунами",
    "Back wall",
    BACK_WALL_RADIUS,
    BACK_WALL_HEIGHT,
    TAU * BACK_WALL_RADIUS,
    BACK_WALL_PANELS,
    BACK_WALL_SEGMENTS,
    true,
    STAND_TOP_HEIGHT,
  ],
];

const surfaceFrom = ([id, kind, ru, en, ...values]) =>
  Object.freeze({
    id,
    kind,
    labels: { ru, en },
    ...Object.fromEntries(FIELDS_BY_KIND[kind].slice(0, values.length).map((key, at) => [key, values[at]])),
  });

export const ARENA_SURFACES = Object.freeze(SURFACE_ROWS.map((row) => surfaceFrom(row)));

const BY_ID = new Map(ARENA_SURFACES.map((item) => [item.id, item]));

// Строка ищется среди встроенных, всё остальное считается готовой спецификацией.
const resolve = (spec) => (typeof spec === "string" ? BY_ID.get(spec) ?? null : spec || null);

const finiteOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Доля в отрезке [0, 1]: не конечное даёт 0, знак нуля сохраняется.
const unit = (value) => {
  const sane = finiteOr(value, 0);
  return sane < 0 ? 0 : sane > 1 ? 1 : sane;
};

export function arenaSurface(id) {
  const found = BY_ID.get(String(id));
  return found === undefined ? null : found;
}

const axisVector = (axis) => [0, 1, 2].map((at) => (at === axis ? 1 : 0));
const around = (angle) => [Math.sin(angle), Math.cos(angle)];
const sideways = ([first, second], k) => [first * k, 0, second * k];
const fromCentre = (fraction, other, size) => (fraction - other) * size;

const discPoint = (spec, u, v) => ({
  position: [fromCentre(unit(u), 0.5, spec.width), 0, fromCentre(0.5, unit(v), spec.height)],
  normal: axisVector(1),
  tangent: axisVector(0),
});

const ringPoint = (spec, u, v) => {
  const dir = spec.inward ? -1 : 1;
  const [sin, cos] = around(finiteOr(u, 0) * TAU * dir);
  const height = (spec.base || 0) + unit(v) * spec.height;
  return {
    position: sideways([sin, cos], spec.radius).with(1, height),
    normal: sideways([sin, cos], dir),
    tangent: sideways([cos, -sin], dir),
  };
};

export function surfacePoint(target, u, v) {
  const spec = resolve(target);
  return spec ? (spec.kind === "disc" ? discPoint : ringPoint)(spec, u, v) : null;
}

const across = (coord, size, sign) => 0.5 + sign * (coord / size);

const discCoordinates = (spec, x, z) => ({
  u: unit(across(x, spec.width, 1)),
  v: unit(across(z, spec.height, -1)),
});

const wrapTurn = (turn) => (turn < 0 ? turn + TAU : turn);

// Доля обхода кольца не зажимается: остаток от деления на 1 может дать NaN и минус ноль.
const ringCoordinates = (spec, x, y, z) => {
  const turn = Math.atan2(x, z) * (spec.inward ? -1 : 1);
  return {
    u: (wrapTurn(turn) / TAU) % 1,
    v: unit((y - (spec.base || 0)) / spec.height),
  };
};

export function surfaceCoordinates(target, point) {
  const spec = resolve(target);
  if (!spec || !point) return null;
  const [x, y, z] = point;
  return spec.kind === "disc" ? discCoordinates(spec, x, z) : ringCoordinates(spec, x, y, z);
}

const LIFT_MARGIN = 0.02;

export function surfaceLift(target) {
  const spec = resolve(target);
  const segments = spec?.segments;
  return segments ? spec.radius * (1 - Math.cos(Math.PI / segments)) + LIFT_MARGIN : LIFT_MARGIN;
}

// Размер поверхности в метрах как есть, без приведения; для неизвестной — 1.
const sizeOf = (key) => (target) => {
  const spec = resolve(target);
  return spec ? spec[key] : 1;
};

export const surfaceMetresPerU = sizeOf("width");
export const surfaceMetresPerV = sizeOf("height");

const AXIS_MARKS = [0.25, 0.5, 0.75];
const AXIS_REACH = 0.06;

// Ближайшая метка (при равенстве — более ранняя), если она ближе 0.06; иначе значение в отрезке.
const snapAxis = (value) => {
  const gaps = AXIS_MARKS.map((mark) => Math.abs(mark - value));
  const near = Math.max(0, gaps.indexOf(Math.min(...gaps)));
  return gaps[near] < AXIS_REACH ? AXIS_MARKS[near] : unit(value);
};

const panelCentre = (count, u) => {
  const index = Math.floor(unit(u) * count);
  return (Math.min(index, count - 1) + 0.5) / count;
};

export function snapToPanel(target, u, v) {
  const spec = resolve(target);
  if (!spec) return { u, v };
  return spec.panels ? { u: panelCentre(spec.panels, u), v: 0.5 } : { u: snapAxis(u), v: snapAxis(v) };
}

function* upTo(limit) {
  for (let at = 0; at < limit; at += 1) yield at;
}

const rowGeometry = (row) => ({
  radius: PIT_RADIUS + 0.75 + row * STAND_ROW_DEPTH,
  height: PIT_WALL_HEIGHT + row * STAND_ROW_RISE,
});

const seatsInRow = (row, sectors) => {
  const { radius, height } = rowGeometry(row);
  const span = TAU / sectors;
  const perSector = Math.max(1, Math.floor((span * radius - SECTOR_GAP * 2 * radius) / SEAT_PITCH));
  const step = SEAT_PITCH / radius;
  return [...upTo(sectors)].flatMap((sector) => {
    const centre = sector * span + span / 2;
    return [...upTo(perSector)].map((index) => {
      const angle = centre + (index - (perSector - 1) / 2) * step;
      return {
        sector,
        row,
        index,
        angle,
        position: sideways(around(angle), radius).with(1, height),
        rotation: angle + Math.PI,
      };
    });
  });
};

export function standSeats({ sectors = STAND_SECTORS, rows = STAND_ROWS } = {}) {
  return [...upTo(rows)].flatMap((row) => seatsInRow(row, sectors));
}
