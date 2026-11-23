// Подписи сцены: что GPU рисует строго как SVG и во что это превращается.

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_FILL = "#ffffff";
const DEFAULT_HALO_WIDTH = 0.5;
const MIDDLE_LINE_SHIFT = 0.35;
const NO_SHIFT = Object.freeze({ x: 0, y: 0 });

const ALIGN_OF_ANCHOR = new Map([
  ["middle", "center"],
  ["end", "end"],
]);

const rule = (reason, test) => ({ reason, test });
const isSet = (field) => (item) => item[field];

// Причины отказа в порядке проверки: побеждает первая сработавшая.
const REASON_RULES = [
  rule("не текст", (item) => item?.kind !== "text"),
  rule("пустая строка", (item) => !(typeof item.value === "string" && item.value !== "")),
  rule("поворот", isSet("rotation")),
  rule("перенос", isSet("lines")),
  rule("подгонка разрядки", isSet("fitSpacing")),
  rule("разрядка", isSet("letterSpacing")),
  rule("обводка не hex", (item) => !(!item.stroke || HEX6.test(item.stroke))),
  rule("отражение", isSet("flip")),
  rule("полоска читаемости", isSet("floor")),
  rule("подгонка ширины", isSet("fitWidth")),
  rule("кегль", (item) => !(typeof item.size === "number" && item.size > 0)),
  rule("цвет не hex", (item) => !(item.fill === undefined || HEX6.test(item.fill))),
];

export function labelUnsupportedReason(item) {
  for (let n = 0; n < REASON_RULES.length; n += 1) {
    if (REASON_RULES[n].test(item)) return REASON_RULES[n].reason;
  }
  return null;
}

export const gpuLabelSupported = (item) => labelUnsupportedReason(item) === null;

export const fontKeyOf = (item) => `${item.weight ?? 400} ${item.family || "sans-serif"}`;

// "#rrggbb" -> [r, g, b, alpha] в долях единицы.
function channelsOf(hex, alpha) {
  const packed = parseInt(hex.slice(1), 16);
  return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255, alpha];
}

function opacityOf(item) {
  const given = item.opacity;
  return typeof given === "number" && given >= 0 && given <= 1 ? given : 1;
}

const haloWidthOf = (strokeWidth) => (strokeWidth ? Number(strokeWidth) : DEFAULT_HALO_WIDTH);

// Ореол есть только у подписи с обводкой и положительной шириной; ширина уходит в масштаб.
function haloOf(item, scale, alpha) {
  const { stroke, strokeWidth } = item;
  const sceneWidth = stroke ? haloWidthOf(strokeWidth) : NaN;
  if (!(sceneWidth > 0)) return undefined;
  return { colour: channelsOf(stroke, alpha), width: sceneWidth * scale };
}

// Положение базовой точки: масштаб, сдвиг и поправка средней линии на 0.35 кегля.
function placeOf(item, scale, origin, size) {
  const x = item.x * scale + origin.x;
  const y = item.y * scale + origin.y;
  return [x, item.baseline === "middle" ? y + MIDDLE_LINE_SHIFT * size : y];
}

// Цвет заливки и ореол делят одну непрозрачность.
function paintOf(item, scale) {
  const alpha = opacityOf(item);
  const fill = item.fill === undefined ? DEFAULT_FILL : item.fill;
  return [channelsOf(fill, alpha), haloOf(item, scale, alpha)];
}

function runFromItem(item, scale, origin) {
  const size = scale * item.size;
  const [x, y] = placeOf(item, scale, origin, size);
  const [colour, halo] = paintOf(item, scale);
  const align = ALIGN_OF_ANCHOR.get(item.anchor) ?? "start";
  const head = { text: item.value, x, y, size };
  return Object.assign(head, { align, colour, font: fontKeyOf(item), halo });
}

export const labelRunOf = (item, scale, origin = NO_SHIFT) =>
  labelUnsupportedReason(item) === null ? runFromItem(item, scale, origin) : null;

const groupFor = (byFont, font) => {
  if (!byFont.has(font)) byFont.set(font, []);
  return byFont.get(font);
};

export function groupRunsByFont(runs) {
  const byFont = new Map();
  for (const run of runs) groupFor(byFont, run.font).push(run);
  return byFont;
}

function route(lanes, item, run) {
  if (run === null) {
    lanes.svg.push(item);
    return;
  }
  lanes.gpu.push(item);
  lanes.runs.push(run);
}

export function splitLabels(items, scale, origin) {
  const lanes = { gpu: [], svg: [], runs: [] };
  for (const item of items) route(lanes, item, labelRunOf(item, scale, origin));
  return lanes;
}
