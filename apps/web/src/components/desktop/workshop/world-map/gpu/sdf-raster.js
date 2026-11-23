// Заготовки глифов для SDF-атласа: знак рисуется шрифтом окна на общем холсте,
// а продвижение и границы берутся из measureText того же шрифта.

// Порядок полей важен: первым читается левая граница.
const BOUND_FIELDS = [
  "actualBoundingBoxLeft",
  "actualBoundingBoxRight",
  "actualBoundingBoxAscent",
  "actualBoundingBoxDescent",
];

const documentCanvas = (width, height) =>
  Object.assign(document.createElement("canvas"), { width, height });

const openContext = (canvas) => canvas?.getContext?.("2d", { willReadFrequently: true });

// Знак без чернил (пробел и подобное): только продвижение пера.
function blankGlyph(advance) {
  const bearings = Object.assign({ advance }, { bearingX: 0 }, { bearingY: 0 });
  return Object.assign(bearings, { width: 0 }, { height: 0 }, { alpha: new Uint8Array(0) });
}

// Настройки текста в порядке применения; смена размера холста их сбрасывает.
const textStateOf = (font) => [
  ["font", font],
  ["textBaseline", "alphabetic"],
  ["fillStyle", "#000"],
];

function applyTextState(context, state) {
  for (const [property, value] of state) context[property] = value;
}

// Границы чернил вверх до целого; отсутствующие и нечисловые считаются нулём.
function inkBox(measure) {
  const ceilOf = (field) => Math.ceil(measure[field] || 0);
  const [left, right, ascent, descent] = BOUND_FIELDS.map(ceilOf);
  return { left, ascent, width: left + right, height: ascent + descent };
}

// Четвёртый байт каждого пикселя — маска покрытия.
function coverageOf(rgba, pixelCount) {
  const alpha = new Uint8Array(pixelCount);
  let pixel = pixelCount;
  while (pixel > 0) {
    pixel -= 1;
    alpha[pixel] = rgba[pixel * 4 + 3];
  }
  return alpha;
}

const drawGlyph = (context, char, { left, ascent }) => context.fillText(char, left, ascent);
const readPixels = (context, { width, height }) => context.getImageData(0, 0, width, height).data;

function rasterize(surface, char) {
  const measure = surface.context.measureText(char);
  const ink = inkBox(measure);
  if (!(ink.width > 0 && ink.height > 0)) return blankGlyph(measure.width);

  Object.assign(surface.canvas, { width: ink.width, height: ink.height });
  applyTextState(surface.context, surface.state);
  drawGlyph(surface.context, char, ink);
  const pixels = readPixels(surface.context, ink);

  const pen = { advance: measure.width, bearingX: ink.left ? -ink.left : 0, bearingY: ink.ascent };
  const mask = coverageOf(pixels, ink.width * ink.height);
  return Object.assign(pen, { width: ink.width, height: ink.height }, { alpha: mask });
}

export function canvasGlyphRasterizer({ font, createCanvas = documentCanvas }) {
  const surface = { canvas: createCanvas(1, 1), context: null, state: textStateOf(font) };
  surface.context = openContext(surface.canvas);
  if (!surface.context) return null;

  applyTextState(surface.context, surface.state);
  return (char) => rasterize(surface, char);
}
