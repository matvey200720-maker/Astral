import sharp from "sharp";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

const joinParts = (...parts) => parts.join("");

// Значки в квадрате 64 × 64 (штрих рисует группа-обёртка). Порядок ключей — порядок показа.
// Обычный объект: имена из прототипа тоже «находят» значок — так и задумано.
const ICONS = {
  flight: joinParts(
    '<path d="M8 52 C16 20 40 12 54 16"/>',
    '<path d="M46 10 L56 16 L48 24"/>',
    '<circle cx="8" cy="52" r="3"/>',
  ),
  clock: joinParts('<circle cx="32" cy="32" r="24"/>', '<path d="M32 16 V32 L42 40"/>'),
  jumps: joinParts(
    '<path d="M4 50 Q12 22 20 50 Q28 22 36 50 Q44 22 52 50"/>',
    '<path d="M52 50 H60"/>',
  ),
  grass: joinParts(
    '<path d="M8 56 H56"/>',
    '<path d="M16 56 C16 40 12 30 8 24 M24 56 C24 36 26 24 30 12 ',
    'M34 56 C34 40 40 30 46 24 M44 56 C46 44 50 38 56 34"/>',
  ),
  textures: joinParts(
    '<rect x="10" y="10" width="44" height="44" rx="3"/>',
    '<path d="M10 32 H54 M32 10 V54"/>',
    '<rect x="10" y="10" width="22" height="22"/>',
    '<rect x="32" y="32" width="22" height="22"/>',
  ),
  litter: '<path d="M14 18 H50 M26 18 V12 H38 V18 M18 18 L22 56 H42 L46 18 M28 26 V48 M36 26 V48"/>',
  shelves: joinParts(
    '<path d="M10 8 V56 M54 8 V56 M10 22 H54 M10 38 H54 M10 54 H54"/>',
    '<rect x="16" y="12" width="8" height="10"/>',
    '<rect x="30" y="28" width="10" height="10"/>',
    '<rect x="42" y="44" width="8" height="10"/>',
  ),
  car: joinParts(
    '<path d="M8 42 V34 L16 22 H46 L56 34 V42 Z M8 42 H56"/>',
    '<circle cx="20" cy="46" r="5"/>',
    '<circle cx="44" cy="46" r="5"/>',
  ),
  pills: joinParts(
    '<rect x="8" y="22" width="48" height="20" rx="10" transform="rotate(-35 32 32)"/>',
    '<path d="M26 22 L38 42"/>',
  ),
  tracers: joinParts(
    '<path d="M8 50 L44 14"/>',
    '<path d="M14 56 L50 20" stroke-dasharray="4 6"/>',
    '<path d="M44 14 L56 8 L50 20 Z"/>',
  ),
  blood: joinParts(
    '<path d="M28 14 C34 24 40 30 40 38 C40 46 34 50 28 50 C22 50 16 46 16 38 C16 30 22 24 28 14 Z"/>',
    '<circle cx="46" cy="18" r="3"/>',
    '<circle cx="50" cy="44" r="4"/>',
    '<circle cx="12" cy="56" r="2.5"/>',
  ),
  flashes: '<path d="M32 6 L37 24 L56 20 L42 32 L56 44 L37 40 L32 58 L27 40 L8 44 L22 32 L8 20 L27 24 Z"/>',
  impacts: joinParts(
    '<circle cx="32" cy="32" r="7"/>',
    '<path d="M32 6 V18 M32 46 V58 M6 32 H18 M46 32 H58 M14 14 L22 22 M42 42 L50 50 M50 14 L42 22 M22 42 L14 50"/>',
  ),
  smoke: joinParts(
    '<path d="M14 46 C6 46 6 34 15 34 C14 24 28 22 30 30 C34 20 50 22 48 34 C58 34 58 46 48 46 Z"/>',
    '<path d="M22 54 H44"/>',
  ),
  fire: joinParts(
    '<path d="M32 6 C40 18 48 24 48 38 C48 50 40 58 32 58 C24 58 16 50 16 38 ',
    'C16 28 24 24 26 14 C30 22 32 24 32 28 C36 22 34 14 32 6 Z"/>',
  ),
  water: '<path d="M32 6 C40 20 48 30 48 40 C48 50 40 58 32 58 C24 58 16 50 16 40 C16 30 24 20 32 6 Z"/>',
  other: joinParts(
    '<circle cx="18" cy="20" r="5"/>',
    '<circle cx="44" cy="16" r="4"/>',
    '<circle cx="32" cy="36" r="6"/>',
    '<circle cx="14" cy="48" r="4"/>',
    '<circle cx="50" cy="44" r="5"/>',
  ),
  ypt: joinParts(
    '<rect x="12" y="8" width="40" height="48" rx="4"/>',
    '<path d="M20 20 H44 M20 30 H44 M20 40 H36"/>',
  ),
  models: '<path d="M32 6 L56 18 V46 L32 58 L8 46 V18 Z M8 18 L32 30 L56 18 M32 30 V58"/>',
  lights: joinParts(
    '<path d="M24 58 H40 M28 50 H36 M32 50 V40"/>',
    '<path d="M20 24 C20 12 44 12 44 24 C44 32 38 36 36 40 H28 C26 36 20 32 20 24 Z"/>',
  ),
  bag: joinParts(
    '<rect x="14" y="20" width="36" height="36" rx="6"/>',
    '<path d="M24 20 V14 C24 8 40 8 40 14 V20"/>',
    '<path d="M14 34 H50 M28 34 V40 H36 V34"/>',
  ),
  vest: joinParts(
    '<path d="M22 8 L14 14 V54 C14 56 16 58 18 58 H46 C48 58 50 56 50 54 V14 L42 8 C40 16 24 16 22 8 Z"/>',
    '<path d="M14 30 H50 M14 42 H50"/>',
  ),
  mask: joinParts(
    '<path d="M10 22 C10 14 54 14 54 22 C54 42 44 56 32 56 C20 56 10 42 10 22 Z"/>',
    '<path d="M18 28 C22 24 28 26 28 30 C24 32 20 32 18 28 Z M46 28 C42 24 36 26 36 30 C40 32 44 32 46 28 Z ',
    'M26 44 C30 46 34 46 38 44"/>',
  ),
  shirt: '<path d="M24 8 L10 16 L4 30 L14 34 L16 28 V58 H48 V28 L50 34 L60 30 L54 16 L40 8 C38 14 26 14 24 8 Z"/>',
};

export const OPTIMIZATION_COVER_GROUPS = Object.freeze(Object.keys(ICONS));

const FONT_STACK = "'Segoe UI', system-ui, -apple-system, sans-serif";
const XML_ESCAPES = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" };

const escapeXml = (text) => text.replace(/[<>&"]/g, (char) => XML_ESCAPES[char]);

// ---------- разметка как данные: узел = [тег, [[атрибут, значение], …], содержимое] ----------
// Содержимое: строка (готовый текст), список узлов или null (самозакрывающийся тег).

const ICON_PAINT = [
  ["fill", "none"],
  ["stroke", "#e9e9e9"],
  ["stroke-width", "3.2"],
  ["stroke-linejoin", "round"],
  ["stroke-linecap", "round"],
];

function serialize([tag, attrs, content]) {
  const open = attrs.map(([name, value]) => ` ${name}="${value}"`).join("");
  if (content === null) return `<${tag}${open}/>`;
  const inner = typeof content === "string" ? content : content.map(serialize).join("");
  return `<${tag}${open}>${inner}</${tag}>`;
}

const iconNode = (icon, x, y, scale) => [
  "g",
  [["transform", `translate(${x} ${y}) scale(${scale})`], ...ICON_PAINT],
  String(icon),
];

function labelNode(entry, x, y, size, gap) {
  const textAttrs = [
    ["x", x],
    ["y", y],
    ["text-anchor", "middle"],
    ["font-family", FONT_STACK],
    ["font-size", size],
    ["font-weight", "700"],
    ["font-variant-numeric", "tabular-nums"],
  ];
  return [
    "text",
    textAttrs,
    [
      ["tspan", [["fill", "#8d8d8d"]], escapeXml(entry.before)],
      ["tspan", [["fill", "#8d8d8d"], ["dx", gap]], "→"],
      ["tspan", [["fill", "#f4f4f4"], ["dx", gap]], escapeXml(entry.after)],
    ],
  ];
}

// Вместо чисел — галочка: три отрезка от базовой линии.
function checkNode(center, baseline, k) {
  const steps = [
    `M${(center - k * 0.4).toFixed(1)} ${(baseline - k * 0.35).toFixed(1)}`,
    `l${(k * 0.28).toFixed(1)} ${(k * 0.28).toFixed(1)}`,
    `l${(k * 0.52).toFixed(1)} ${(-k * 0.56).toFixed(1)}`,
  ];
  return [
    "path",
    [
      ["d", steps.join(" ")],
      ["fill", "none"],
      ["stroke", "#f4f4f4"],
      ["stroke-width", (k * 0.12).toFixed(1)],
      ["stroke-linecap", "round"],
      ["stroke-linejoin", "round"],
    ],
    null,
  ];
}

// ---------- отбор групп ----------

// Группа попадает на обложку, если для неё есть значок и либо слой Astral, либо числа различаются.
function isShown(group) {
  if (!ICONS[group?.id]) return false;
  if (group.on === true) return true;
  return Number.isFinite(group.before) && Number.isFinite(group.after) && group.before !== group.after;
}

function toEntry(group) {
  const icon = ICONS[group.id];
  if (group.on === true) return { icon, check: true, chars: 1 };
  const before = String(group.before);
  const after = String(group.after);
  return { icon, check: false, before, after, chars: before.length + after.length + 3 };
}

// ---------- сетка ----------

// До трёх групп — по колонке на группу, дальше 2, 3, 3 и (с семи) 4.
const columnsFor = (count) => (count <= 3 ? count : [2, 3, 3, 4][Math.min(count, 7) - 4]);

// Левый верхний угол клеток ряд за рядом; неполный последний ряд стоит по центру.
function* gridSlots({ count, columns, rows, cellW, cellH, width, height }) {
  for (let row = 0; row < rows; row += 1) {
    const inRow = Math.min(columns, count - row * columns);
    const top = (height - rows * cellH) / 2 + row * cellH;
    for (let col = 0; col < inRow; col += 1) {
      yield { left: (width - inRow * cellW) / 2 + col * cellW, top };
    }
  }
}

function gridMetrics(entries, width, height) {
  const count = entries.length;
  const columns = columnsFor(count);
  const rows = Math.ceil(count / columns);
  const cellW = (width * 0.9) / columns;
  const cellH = (height * 0.86) / rows;
  const side = Math.min(cellW, cellH) * 0.42;
  const longest = entries.reduce((most, entry) => Math.max(most, entry.chars), 0);
  const fontSize = Math.min(cellH * 0.2, (cellW * 0.86) / (longest * 0.62));
  return { count, columns, rows, cellW, cellH, side, fontSize, width, height };
}

// Узлы одной клетки: значок и подпись (или галочка).
function cellNodes(entry, slot, { cellW, cellH, side, fontSize }) {
  const center = slot.left + cellW / 2;
  const iconTop = slot.top + (cellH - side - fontSize * 1.5) / 2;
  const baseline = iconTop + side + fontSize * 1.25;
  const icon = iconNode(entry.icon, (center - side / 2).toFixed(1), iconTop.toFixed(1), (side / 64).toFixed(4));
  const caption = entry.check
    ? checkNode(center, baseline, fontSize)
    : labelNode(entry, center.toFixed(1), baseline.toFixed(1), fontSize.toFixed(1), (fontSize * 0.25).toFixed(1));
  return [icon, caption];
}

export function optimizationCoverSvg(groups, { width = 1200, height = 800 } = {}) {
  const entries = (groups || []).filter(isShown).map(toEntry);
  if (!entries.length) return null;

  const metrics = gridMetrics(entries, width, height);
  const slots = [...gridSlots(metrics)];
  const root = [
    "svg",
    [
      ["xmlns", "http://www.w3.org/2000/svg"],
      ["width", width],
      ["height", height],
      ["viewBox", `0 0 ${width} ${height}`],
    ],
    entries.flatMap((entry, index) => cellNodes(entry, slots[index], metrics)),
  ];
  return serialize(root);
}

export async function optimizationCoverPng(groups, { width = 1200, height = 800 } = {}) {
  const svg = optimizationCoverSvg(groups, { width, height });
  if (svg === null) return null;

  const field = workshopMatteRgba(width, height);
  const png = await sharp(Buffer.from(field.buffer), { raw: { width, height, channels: 4 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}
