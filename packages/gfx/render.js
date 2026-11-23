// Рисовальщик одного кадра фильма Scaleform (.gfx) в плавающую RGBA-поверхность: без canvas и без внешних библиотек.
import { TAG, TWIPS } from "./file.js";
import { readBitmap } from "./bitmap.js";
import { isMorphTag, isShapeTag, readShape } from "./shape.js";
import { displayList, readSprite } from "./timeline.js";
import { blendSupported, composite, createSurface, fillCoverage, strokeCoverage } from "./raster.js";

export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

const FLAT_CXFORM = Object.freeze({ mult: Object.freeze([1, 1, 1, 1]), add: Object.freeze([0, 0, 0, 0]) });

const LIMITS = Object.freeze({
  spriteDepth: 24,
  curveTolerance: 1.6, // 8 · допуск 0,2 пикселя
  curveSteps: 64,
  gradientField: 16384,
  rampSize: 256,
});

/** Сначала применяется `inner`, потом `outer`. */
export function multiply(outer, inner) {
  const [oa, ob, oc, od, otx, oty] = [outer.a, outer.b, outer.c, outer.d, outer.tx, outer.ty];
  const [ia, ib, ic, id, itx, ity] = [inner.a, inner.b, inner.c, inner.d, inner.tx, inner.ty];
  return {
    a: oa * ia + oc * ib,
    b: ob * ia + od * ib,
    c: oa * ic + oc * id,
    d: ob * ic + od * id,
    tx: oa * itx + oc * ity + otx,
    ty: ob * itx + od * ity + oty,
  };
}

function clip01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

const lerp = (from, to, t) => from + (to - from) * t;
const mix = (first, second, t) => first * (1 - t) + second * t;

/** Канал цвета 0…255 через цветовое преобразование -> 0…1. */
function colourChannel(value, cxform, index) {
  return clip01((value * cxform.mult[index] + cxform.add[index]) / 255);
}

function combineColour(own, outer) {
  if (!own) return outer;
  const mult = [];
  const add = [];
  for (let i = 0; i < 4; i += 1) {
    mult.push(own.mult[i] * outer.mult[i]);
    add.push(own.add[i] * outer.mult[i] + outer.add[i]);
  }
  return { mult, add };
}

/** Преобразование точки поверхности в систему стиля; `null`, если матрица вырождена. */
function inverseMapper(matrix) {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (det === 0 || Number.isNaN(det)) return null;
  return (x, y, into) => {
    const dx = x - matrix.tx;
    const dy = y - matrix.ty;
    into[0] = (matrix.d * dx - matrix.c * dy) / det;
    into[1] = (matrix.a * dy - matrix.b * dx) / det;
  };
}

const mapPoint = (matrix, x, y) => [matrix.a * x + matrix.c * y + matrix.tx, matrix.b * x + matrix.d * y + matrix.ty];

const quadratic = (t, start, control, end) => {
  const s = 1 - t;
  return s * s * start + 2 * s * t * control + t * t * end;
};

/** Ломаная ребра в пикселях: прямое — две точки, кривая Безье — вдоль кривой; плоский список координат. */
function edgePoints(edge, matrix) {
  const [x0, y0] = mapPoint(matrix, edge.x0, edge.y0);
  const [x1, y1] = mapPoint(matrix, edge.x1, edge.y1);
  if (edge.cx === undefined) return [x0, y0, x1, y1];
  const [cx, cy] = mapPoint(matrix, edge.cx, edge.cy);
  const bend = Math.hypot(x0 - 2 * cx + x1, y0 - 2 * cy + y1);
  const steps = Math.min(Math.max(Math.ceil(Math.sqrt(bend / LIMITS.curveTolerance)), 1), LIMITS.curveSteps);
  const points = [x0, y0];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push(quadratic(t, x0, cx, x1), quadratic(t, y0, cy, y1));
  }
  return points;
}

const WHITE = (x, y, out) => {
  for (let i = 0; i < 4; i += 1) out[i] = 1;
};

/** Четырёхугольник-картинка: одна растровая заливка и четыре ребра в натуральном размере. */
function pictureShape(id, width, height) {
  const w = width * TWIPS;
  const h = height * TWIPS;
  const corners = [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
  const edges = corners.slice(1).map(([x1, y1], i) => ({ x0: corners[i][0], y0: corners[i][1], x1, y1, fill0: 0, fill1: -1, line: -1, run: 1 }));
  const matrix = { a: TWIPS, b: 0, c: 0, d: TWIPS, tx: 0, ty: 0 };
  return { fills: [{ type: "bitmap", bitmapId: id, matrix, repeat: false, smooth: true }], lines: [], edges };
}

function tagKind(code) {
  if (isShapeTag(code) || isMorphTag(code)) return "shape";
  switch (code) {
    case TAG.DEFINE_SPRITE:
      return "sprite";
    case TAG.DEFINE_BITS_LOSSLESS:
    case TAG.DEFINE_BITS_LOSSLESS2:
      return "bitmap";
    case TAG.DEFINE_TEXT:
    case TAG.DEFINE_TEXT2:
    case TAG.DEFINE_EDIT_TEXT:
      return "text";
    case TAG.DEFINE_BITS:
    case TAG.DEFINE_BITS_JPEG2:
    case TAG.DEFINE_BITS_JPEG3:
      return "jpeg";
    default:
      return "other";
  }
}

// ---------- краски ----------

function solidPaint(color, cxform) {
  const rgba = [0, 1, 2, 3].map((channel) => colourChannel(color[channel], cxform, channel));
  return (x, y, out) => {
    for (let i = 0; i < 4; i += 1) out[i] = rgba[i];
  };
}

/** Таблица градиента на 256 цветов, уже пропущенная через цветовое преобразование. */
function buildRamp(stops, cxform) {
  const list = stops?.length ? stops : [{ ratio: 0, color: [0, 0, 0, 0] }];
  const ramp = new Float32Array(LIMITS.rampSize * 4);
  for (let step = 0; step < LIMITS.rampSize; step += 1) {
    const t = step / (LIMITS.rampSize - 1);
    const hit = list.findIndex((stop) => stop.ratio >= t);
    const rightAt = hit < 0 ? list.length - 1 : hit;
    const right = list[rightAt];
    const left = list[Math.max(0, rightAt - 1)];
    const span = right.ratio - left.ratio;
    const share = span > 0 ? clip01((t - left.ratio) / span) : 1;
    for (let channel = 0; channel < 4; channel += 1) {
      ramp[step * 4 + channel] = colourChannel(lerp(left.color[channel], right.color[channel], share), cxform, channel);
    }
  }
  return ramp;
}

const SPREADS = {
  repeat: (u) => u - Math.floor(u),
  reflect: (u) => {
    const q = u - 2 * Math.floor(u / 2);
    return q > 1 ? 2 - q : q;
  },
  pad: clip01,
};

function gradientPaint(style, matrix, cxform) {
  const toStyle = inverseMapper(multiply(matrix, style.matrix));
  if (!toStyle) return null;
  const ramp = buildRamp(style.stops, cxform);
  const spread = SPREADS[style.spread] ?? SPREADS.pad;
  const radial = style.type === "radial";
  const field = LIMITS.gradientField;
  const local = new Float64Array(2);
  return (x, y, out) => {
    toStyle(x, y, local);
    const u = radial ? Math.sqrt(local[0] * local[0] + local[1] * local[1]) / field : (local[0] + field) / (2 * field);
    const at = Math.round(spread(u) * (LIMITS.rampSize - 1)) * 4;
    for (let i = 0; i < 4; i += 1) out[i] = ramp[at + i];
  };
}

function bitmapPaint(bitmap, style, matrix, cxform) {
  const toStyle = inverseMapper(multiply(matrix, style.matrix));
  if (!toStyle) return null;
  const { width, height, rgba } = bitmap;
  const scaleU = bitmap.scaleU ?? 1;
  const scaleV = bitmap.scaleV ?? 1;
  const wrap = style.repeat ? (i, size) => ((i % size) + size) % size : (i, size) => Math.min(Math.max(i, 0), size - 1);
  const texel = (i, j, channel) => rgba[(wrap(j, height) * width + wrap(i, width)) * 4 + channel];
  const local = new Float64Array(2);
  const smoothed = Boolean(style.smooth);
  return (x, y, out) => {
    toStyle(x, y, local);
    const u = local[0] * scaleU;
    const v = local[1] * scaleV;
    if (!smoothed) {
      const i = Math.floor(u);
      const j = Math.floor(v);
      for (let channel = 0; channel < 4; channel += 1) out[channel] = colourChannel(texel(i, j, channel), cxform, channel);
      return;
    }
    const u0 = Math.floor(u - 0.5);
    const v0 = Math.floor(v - 0.5);
    const fu = u - 0.5 - u0;
    const fv = v - 0.5 - v0;
    for (let channel = 0; channel < 4; channel += 1) {
      const top = mix(texel(u0, v0, channel), texel(u0 + 1, v0, channel), fu);
      const bottom = mix(texel(u0, v0 + 1, channel), texel(u0 + 1, v0 + 1, channel), fu);
      out[channel] = colourChannel(mix(top, bottom, fv), cxform, channel);
    }
  };
}

/** Память «номер -> результат» (в том числе неудачный). */
function remember(cache, id, make) {
  if (!cache.has(id)) cache.set(id, make());
  return cache.get(id);
}

/** Рисовальщик одного фильма: кэши фигур и растров и накопительные замечания. */
class FilmPainter {
  #gfx;
  #images;
  #shapes = new Map();
  #bitmaps = new Map();
  diagnostics = new Set();

  constructor(gfx, images) {
    this.#gfx = gfx;
    this.#images = images;
  }

  #note(text) {
    this.diagnostics.add(text);
  }

  #shapeOf(id, tag) {
    return remember(this.#shapes, id, () => {
      try {
        return readShape(this.#gfx.bytes, tag);
      } catch (error) {
        this.#note(`фигура ${id} не читается: ${error.message}`);
        return null;
      }
    });
  }

  // Растр, составленный из ответа `images` для внешней картинки; пересчёт точек по заявленному размеру.
  #externalBitmap(id, external) {
    try {
      const answer = this.#images ? this.#images(external) : null;
      if (!answer) {
        this.#note(`картинка «${external.exportName}» из словаря текстур — в превью её нет`);
        return null;
      }
      const { width, height, rgba } = answer;
      return { width, height, rgba, scaleU: external.width ? width / external.width : 1, scaleV: external.height ? height / external.height : 1 };
    } catch (error) {
      this.#note(`картинка ${id} не читается: ${error.message}`);
      return null;
    }
  }

  #filmBitmap(id, tag) {
    try {
      const bitmap = readBitmap(this.#gfx.bytes, tag);
      if (!bitmap) this.#note("картинка JPEG — в превью её нет");
      return bitmap;
    } catch (error) {
      this.#note(`картинка ${id} не читается: ${error.message}`);
      return null;
    }
  }

  #bitmapOf(id) {
    return remember(this.#bitmaps, id, () => {
      const tag = this.#gfx.definitions.get(id);
      if (tag) return this.#filmBitmap(id, tag);
      const external = this.#gfx.externalImages.get(id);
      return external ? this.#externalBitmap(id, external) : null;
    });
  }

  #paintFor(style, matrix, cxform) {
    switch (style.type) {
      case "solid":
        return solidPaint(style.color, cxform);
      case "linear":
      case "radial":
        return gradientPaint(style, matrix, cxform);
      case "bitmap": {
        const bitmap = this.#bitmapOf(style.bitmapId);
        return bitmap ? bitmapPaint(bitmap, style, matrix, cxform) : null;
      }
      default:
        return null;
    }
  }

  #drawFills(surface, shape, view) {
    const { matrix, cxform, mask, maskMode, state } = view;
    for (const [index, style] of shape.fills.entries()) {
      const segments = [];
      for (const edge of shape.edges) {
        if (edge.fill0 === edge.fill1 || (edge.fill0 !== index && edge.fill1 !== index)) continue;
        const points = edgePoints(edge, matrix);
        for (let i = 2; i < points.length; i += 2) segments.push(points[i - 2], points[i - 1], points[i], points[i + 1]);
      }
      if (segments.length === 0) continue;
      const paint = maskMode ? WHITE : this.#paintFor(style, matrix, cxform);
      if (!paint) continue;
      const coverage = fillCoverage(segments, surface.width, surface.height);
      composite(surface, coverage, paint, mask, maskMode ? 0 : state.blend);
    }
  }

  // Обводки: цепочки рёбер одного стиля, идущих подряд в одном «забеге».
  #drawLines(surface, shape, view) {
    const { matrix, cxform, mask, state } = view;
    const scaleOfMatrix = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
    for (const [index, style] of shape.lines.entries()) {
      const chains = [];
      let tail = null;
      for (const edge of shape.edges) {
        if (edge.line !== index) {
          tail = null;
          continue;
        }
        const points = edgePoints(edge, matrix);
        const continues = tail !== null && tail.run === edge.run && tail.x1 === edge.x0 && tail.y1 === edge.y0;
        if (continues) chains.at(-1).push(...points.slice(2));
        else chains.push(points);
        tail = edge;
      }
      if (chains.length === 0) continue;
      const width = style.scaling === "none" ? (style.width / TWIPS) * state.scale : style.width * scaleOfMatrix;
      const paint = style.fill ? this.#paintFor(style.fill, matrix, cxform) : solidPaint(style.color, cxform);
      if (!paint) continue;
      composite(surface, strokeCoverage(chains, Math.max(0.5, width / 2), style, surface.width, surface.height), paint, mask, state.blend);
    }
  }

  #drawShape(surface, shape, view) {
    this.#drawFills(surface, shape, view);
    if (!view.maskMode) this.#drawLines(surface, shape, view);
  }

  #drawSymbol(surface, id, view) {
    const { state } = view;
    if (state.stack.length >= LIMITS.spriteDepth || state.stack.includes(id)) {
      this.#note("вложенность спрайтов глубже разумного");
      return;
    }
    const tag = this.#gfx.definitions.get(id);
    if (!tag) {
      const external = this.#gfx.externalImages.get(id);
      if (external) this.#drawShape(surface, pictureShape(id, external.width, external.height), view);
      return;
    }
    switch (tagKind(tag.code)) {
      case "shape": {
        const shape = this.#shapeOf(id, tag);
        if (!shape) break;
        if (isMorphTag(tag.code)) this.#note("морф нарисован в начальном виде");
        this.#drawShape(surface, shape, view);
        break;
      }
      case "sprite": {
        const frames = readSprite(this.#gfx, id)?.frameCount || 1;
        const frame = state.time == null ? 0 : ((Math.trunc(state.time) % frames) + frames) % frames;
        state.stack.push(id);
        this.#drawList(surface, displayList(this.#gfx, id, frame), view);
        state.stack.pop();
        break;
      }
      case "bitmap": {
        const bitmap = this.#bitmapOf(id);
        if (bitmap) this.#drawShape(surface, pictureShape(id, bitmap.width, bitmap.height), view);
        break;
      }
      case "text":
        this.#note("текст в превью не рисуется");
        break;
      case "jpeg":
        this.#note("картинка JPEG — в превью её нет");
        break;
      default:
        break;
    }
  }

  // Маска из символа: рисуется в отдельный слой, остаётся его альфа, умноженная на внешнюю маску.
  #maskFor(surface, entry, view) {
    const layer = createSurface(surface.width, surface.height);
    this.#drawSymbol(layer, entry.characterId, { ...view, mask: null, maskMode: true });
    const mask = new Float32Array(surface.width * surface.height);
    for (let i = 0; i < mask.length; i += 1) mask[i] = layer.data[i * 4 + 3];
    if (view.mask) for (let i = 0; i < mask.length; i += 1) mask[i] *= view.mask[i];
    return mask;
  }

  #noteEntry(entry) {
    if (entry.filters?.length) this.#note(`фильтры (${entry.filters.join(", ")}) в превью не рисуются`);
    if (!blendSupported(entry.blend)) this.#note("режим наложения в превью обычный");
  }

  #drawList(surface, placements, view) {
    const clips = []; // стек масок { until, mask }
    for (const entry of placements) {
      while (clips.length > 0 && entry.depth > clips[clips.length - 1].until) clips.pop();
      const mask = clips.length > 0 ? clips[clips.length - 1].mask : view.mask;
      const matrix = multiply(view.matrix, entry.matrix ?? IDENTITY);
      if (entry.clipDepth) {
        clips.push({ until: entry.clipDepth, mask: this.#maskFor(surface, entry, { ...view, matrix, mask }) });
        continue;
      }
      if (entry.visible === false) continue;
      this.#noteEntry(entry);
      const state = entry.blend > 2 && entry.blend !== view.state.blend ? { ...view.state, blend: entry.blend } : view.state;
      const inner = { matrix, cxform: combineColour(entry.cxform, view.cxform), mask, maskMode: view.maskMode, state };
      this.#drawSymbol(surface, entry.characterId, inner);
    }
  }

  renderFrame({ sprite, frame = 0, width, height, transform = IDENTITY, surface = null, cxform = FLAT_CXFORM, time = null }) {
    const target = surface ?? createSurface(width, height);
    if (!readSprite(this.#gfx, sprite)) throw new Error(`GFX: нет спрайта ${sprite}.`);
    const matrix = multiply(transform, { a: 1 / TWIPS, b: 0, c: 0, d: 1 / TWIPS, tx: 0, ty: 0 });
    const scale = Math.sqrt(Math.abs(transform.a * transform.d - transform.b * transform.c));
    const state = { stack: [sprite], scale, blend: 0, time };
    this.#drawList(target, displayList(this.#gfx, sprite, frame), { matrix, cxform, mask: null, maskMode: false, state });
    return target;
  }
}

export function createRenderer(gfx, options = {}) {
  const painter = new FilmPainter(gfx, options.images ?? null);
  return { renderFrame: (frameOptions) => painter.renderFrame(frameOptions), diagnostics: painter.diagnostics };
}
