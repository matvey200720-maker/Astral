/*
 * Анимированная заливка полос HP и брони (задача 8 ТЗ 05.10.2026).
 *
 * Как это живёт в игре. Длину полосы игра задаёт масштабом `_xscale` фигуры
 * `healthBar` (`armourBar`), а цвет — преобразованием цвета той же фигуры.
 * Компилятор делает эту фигуру МАСКОЙ (ClipDepth) для своей анимации на
 * свободной глубине над ней: игра по-прежнему тянет маску, и анимация
 * открывается ровно на долю здоровья, не сжимаясь.
 *
 * Анимация — картинка-плитка и кадры её движения. Бегущие виды («scroll»)
 * сдвигают плитку на период за круг, пульсы («pulse») меняют её яркость,
 * градиент («static») стоит. Плитка серая (яркость), цвет — два цвета через
 * преобразование цвета: смена цвета не перерисовывает картинок, а одна и
 * та же анимация служит и обычной полосе, и покрасневшей при малом HP.
 * Радуга и сияние несут цвет в самой плитке.
 *
 * Одна арифметика у кадра редактора (`fillPreviewFrame`) и у компилятора
 * (`fillTile`, `fillTimeline`, `fillOuterTransform`, `minimapFillGeometry`):
 * что видно в окне, то и уходит в игру.
 */

/** Частота кадров таймлайна мини-карты (minimap.gfx — 30 кадров в секунду). */
export const MINIMAP_FILL_FPS = 30;
/** Высота плитки — поперёк полосы, пиксели. */
export const MINIMAP_FILL_TILE_HEIGHT = 16;
/** Самый долгий круг анимации, секунды: дальше кадров слишком много. */
export const MINIMAP_FILL_MAX_CYCLE = 8;
/** Своё видео: пределы кадров, частоты и размера одного кадра. */
export const MINIMAP_FILL_VIDEO = Object.freeze({
  maxFrames: 90,
  fps: Object.freeze([8, 30]),
  width: Object.freeze([32, 256]),
  height: Object.freeze([4, 32]),
  /* Размер листа кадров: столько точек уходит в текстуру игры. */
  maxPixels: 220_000,
});
export const MINIMAP_FILL_SPEED = Object.freeze([0.25, 3]);
export const MINIMAP_FILL_MODES = Object.freeze(["solid", "preset", "video"]);

/*
 * Готовые виды.
 *
 * `kind`: `scroll` — узор бежит вдоль полосы к её концу, `pulse` — полоса
 * дышит яркостью, `static` — стоит. `period` — длина узора в толщинах
 * полосы, `span` — он же в длинах полосы (блик проходит всю полосу и
 * ждёт). `cycle` — секунды круга при скорости 1. `colourful` — цвет в
 * самой плитке, свои два цвета не нужны.
 */
const preset = (id, label, kind, extra) =>
  Object.freeze({ id, label, kind, period: 4, cycle: 1.6, ...extra });

export const MINIMAP_FILL_PRESETS = Object.freeze([
  preset("gradient", "Градиент", "static", { span: 1, cycle: 1 }),
  preset("shimmer", "Перелив", "scroll", { span: 1.6, cycle: 2.4 }),
  preset("glint", "Блик", "scroll", { span: 2, cycle: 2.6 }),
  preset("flow", "Поток", "scroll", { period: 5, cycle: 1.8 }),
  preset("wave", "Волна", "scroll", { period: 6, cycle: 2 }),
  preset("stripes", "Полосы", "scroll", { period: 3, cycle: 1.2 }),
  preset("chevron", "Шеврон", "scroll", { period: 3, cycle: 1.2 }),
  preset("charge", "Заряд", "scroll", { period: 6, cycle: 1.2 }),
  preset("plasma", "Плазма", "scroll", { period: 8, cycle: 3 }),
  preset("lava", "Лава", "scroll", { period: 8, cycle: 4 }),
  preset("fire", "Огонь", "scroll", { period: 4, cycle: 1 }),
  preset("electric", "Ток", "scroll", { period: 6, cycle: 0.6 }),
  preset("matrix", "Матрица", "scroll", { period: 8, cycle: 2.4 }),
  preset("glitter", "Блёстки", "scroll", { period: 8, cycle: 2.4 }),
  preset("hologram", "Голограмма", "scroll", { period: 4, cycle: 1.6 }),
  preset("rainbow", "Радуга", "scroll", { span: 1, cycle: 3, colourful: true }),
  preset("aurora", "Сияние", "scroll", { span: 1.5, cycle: 5, colourful: true }),
  preset("pulse", "Пульс", "pulse", { cycle: 1.2 }),
  preset("breath", "Дыхание", "pulse", { cycle: 2.6 }),
  preset("heartbeat", "Сердцебиение", "pulse", { cycle: 1.1 }),
  preset("neon", "Неон", "pulse", { cycle: 2 }),
]);
const PRESETS = new Map(MINIMAP_FILL_PRESETS.map((item) => [item.id, item]));
export const minimapFillPreset = (id) => PRESETS.get(id) || null;

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/* Два цвета готовых видов по умолчанию — тёмный и светлый тон полосы игры. */
export const MINIMAP_FILL_DEFAULT_COLORS = Object.freeze({
  health: Object.freeze(["#1b5e2f", "#8dffad"]),
  armor: Object.freeze(["#163f73", "#9fd8ff"]),
});

/** Заливка полосы по умолчанию — ровный цвет игры (`mode: "solid"`). */
export const DEFAULT_MINIMAP_FILL = Object.freeze({
  mode: "solid",
  preset: "shimmer",
  colors: MINIMAP_FILL_DEFAULT_COLORS.health,
  speed: 1,
  video: null,
});

/**
 * Заливка в порядке: режим, вид, два цвета, скорость, своё видео.
 * `video` — лист кадров в хранилище мастерской (`assetId`) и его размер.
 */
export function normalizeMinimapFill(input, fallbackColors = MINIMAP_FILL_DEFAULT_COLORS.health) {
  const source = input && typeof input === "object" ? input : {};
  const mode = MINIMAP_FILL_MODES.includes(source.mode) ? source.mode : "solid";
  const colors = Array.isArray(source.colors) ? source.colors : [];
  const video = source.video && typeof source.video === "object" ? source.video : null;
  const normalizedVideo = video?.assetId
    ? {
        assetId: String(video.assetId).slice(0, 160),
        frames: Math.round(clamp(video.frames, 1, MINIMAP_FILL_VIDEO.maxFrames, 1)),
        fps: Math.round(clamp(video.fps, MINIMAP_FILL_VIDEO.fps[0], MINIMAP_FILL_VIDEO.fps[1], 15)),
        width: Math.round(clamp(video.width, MINIMAP_FILL_VIDEO.width[0], MINIMAP_FILL_VIDEO.width[1], 128)),
        height: Math.round(clamp(video.height, MINIMAP_FILL_VIDEO.height[0], MINIMAP_FILL_VIDEO.height[1], 12)),
        name: String(video.name || "").slice(0, 80),
      }
    : null;
  return {
    mode: mode === "video" && !normalizedVideo ? "solid" : mode,
    preset: PRESETS.has(source.preset) ? source.preset : DEFAULT_MINIMAP_FILL.preset,
    colors: [hex(colors[0], fallbackColors[0]), hex(colors[1], fallbackColors[1])],
    speed: Math.round(clamp(source.speed, MINIMAP_FILL_SPEED[0], MINIMAP_FILL_SPEED[1], 1) * 100) / 100,
    video: normalizedVideo,
  };
}

/** Заливка не ровным цветом: готовый вид или своё видео. */
export const minimapFillActive = (fill) => Boolean(fill && fill.mode !== "solid");

/* ---------------------------- плитка ---------------------------- */

const TAU = Math.PI * 2;
const frac = (value) => value - Math.floor(value);
const smooth = (edge0, edge1, value) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
/* Псевдослучайное число клетки: та же плитка в окне и в игре. */
const hash = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const hsl = (h, s, l) => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    const x = frac(t);
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 0.5) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
};
/* Расстояние по кругу периода: узор бесшовен на стыке плиток. */
const ring = (u, centre) => {
  const d = Math.abs(frac(u) - centre);
  return Math.min(d, 1 - d);
};

/*
 * Узор в точке плитки: `u` — доля периода вдоль полосы, `v` — доля толщины
 * (0 — верх). Ответ — яркость 0…1 или `[r, g, b]` у цветных.
 */
function sample(id, u, v) {
  switch (id) {
    case "gradient":
      return u;
    case "shimmer":
      return 0.42 + 0.58 * Math.exp(-((ring(u - 0.18 * v, 0.5) / 0.16) ** 2));
    case "glint":
      return 0.5 + 0.5 * Math.exp(-((ring(u - 0.1 * (v - 0.5), 0.5) / 0.035) ** 2));
    case "flow":
      return 0.5 + 0.5 * Math.sin(TAU * (u + 0.25 * v));
    case "wave":
      return 0.3 + 0.7 * smooth(0.16, 0.02, Math.abs(v - (0.5 + 0.3 * Math.sin(TAU * u))));
    case "stripes":
      return frac(u * 2 + v * 0.5) < 0.5 ? 1 : 0.35;
    case "chevron": {
      const bend = Math.abs(v - 0.5) * 0.6;
      return frac(u * 2 + bend) < 0.5 ? 1 : 0.35;
    }
    case "charge":
      return 0.25 + 0.75 * (1 - frac(u)) ** 2.2;
    case "plasma":
      return 0.5 + (Math.sin(TAU * u) + Math.sin(TAU * (u * 2 + v * 0.7)) + Math.sin(TAU * (u * 3 - v * 0.4) + 1.3)) / 6;
    case "lava":
      return 0.5 + 0.5 * Math.sin(TAU * u + 1.8 * Math.sin(TAU * (u * 2 + v * 0.5)));
    case "fire": {
      const tongue = 0.5 + 0.25 * Math.sin(TAU * u * 2) + 0.15 * Math.sin(TAU * (u * 3 + 0.3));
      return 0.25 + 0.75 * smooth(tongue - 0.25, tongue + 0.15, 1 - v) ** 0.8;
    }
    case "electric": {
      const zigzag = 0.5 + 0.34 * (Math.abs(frac(u * 3) - 0.5) * 4 - 1) * (0.55 + 0.45 * Math.sin(TAU * u));
      return 0.2 + 0.8 * smooth(0.16, 0.02, Math.abs(v - zigzag));
    }
    case "matrix": {
      const x = Math.floor(u * 16);
      const y = Math.floor(v * 4);
      return hash(x, y) > 0.55 ? 0.55 + 0.45 * hash(y + 7, x) : 0.22;
    }
    case "glitter": {
      const x = Math.floor(u * 32);
      const y = Math.floor(v * 8);
      return hash(x, y) > 0.84 ? 1 : 0.36;
    }
    case "hologram":
      return (frac(u * 8) < 0.5 ? 1 : 0.55) * (0.78 + 0.22 * Math.sin(TAU * v * 3));
    case "rainbow":
      return hsl(u, 0.95, 0.55);
    case "aurora":
      return hsl(0.36 + 0.2 * Math.sin(TAU * u) + 0.05 * Math.sin(TAU * (u * 2 + v)), 0.85, 0.4 + 0.2 * (1 - v));
    /* Пульсы: мягкая выпуклость поперёк полосы, дышит яркость. */
    default:
      return 0.72 + 0.28 * Math.sin(Math.PI * v);
  }
}

/** Ширина плитки одного периода, пиксели: у вида во всю полосу — шире. */
export const minimapFillTileWidth = (presetId) => (minimapFillPreset(presetId)?.span ? 128 : 64);

/**
 * Плитка вида: RGBA `periods` периодов подряд высотой
 * `MINIMAP_FILL_TILE_HEIGHT`. Серые — в яркости (цвет даёт преобразование
 * цвета), цветные — своим цветом.
 */
export function fillTile(presetId, periods = 1) {
  const id = PRESETS.has(presetId) ? presetId : DEFAULT_MINIMAP_FILL.preset;
  const period = minimapFillTileWidth(id);
  const height = MINIMAP_FILL_TILE_HEIGHT;
  const width = period * Math.max(1, Math.round(periods));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < period; x += 1) {
      const value = sample(id, (x + 0.5) / period, (y + 0.5) / height);
      const [r, g, b] = Array.isArray(value) ? value : [value, value, value];
      const channels = [r, g, b].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255));
      for (let copy = x; copy < width; copy += period) {
        const at = (y * width + copy) * 4;
        rgba[at] = channels[0];
        rgba[at + 1] = channels[1];
        rgba[at + 2] = channels[2];
        rgba[at + 3] = 255;
      }
    }
  return { width, height, period, rgba };
}

/**
 * Длина периода узора вдоль полосы и сколько периодов нужно плитке, чтобы
 * сдвиг на период не открыл пустого места. Единицы — любые, общие у
 * `length` и `thickness` (твипы у компилятора, пиксели у окна).
 */
export function minimapFillGeometry(presetId, { length, thickness }) {
  const item = minimapFillPreset(presetId) || minimapFillPreset(DEFAULT_MINIMAP_FILL.preset);
  const safeLength = Math.max(1, Number(length) || 1);
  if (item.span) {
    const period = safeLength * item.span;
    return { period, periods: item.kind === "static" ? 1 : Math.ceil(safeLength / period) + 1 };
  }
  let period = item.period * Math.max(1, Number(thickness) || 1);
  let periods = Math.ceil(safeLength / period) + 1;
  /* Очень длинная тонкая полоса: плитка не длиннее 48 периодов, узор шире. */
  if (periods > 48) {
    period = safeLength / 47;
    periods = 48;
  }
  return { period, periods };
}

/* ---------------------------- время ---------------------------- */

/* Яркость пульса в доле круга `t`. */
function pulse(id, t) {
  switch (id) {
    case "breath":
      return 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(TAU * t));
    case "heartbeat": {
      const beat = (centre) => Math.exp(-(((t - centre) / 0.05) ** 2));
      return 0.4 + 0.6 * Math.min(1, beat(0.15) + 0.7 * beat(0.36));
    }
    case "neon":
      return hash(Math.floor(t * 20), 7) > 0.8 ? 0.25 : 1;
    default:
      return 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(TAU * t));
  }
}

/**
 * Кадры круга: `{ frames, kind, steps: [{ offset, brightness }] }`.
 * `offset` — доля периода, на которую узор сдвинут к концу полосы в этом
 * кадре; `brightness` — множитель яркости плитки (пульсы).
 */
export function fillTimeline(fill, fps = MINIMAP_FILL_FPS) {
  const normalized = normalizeMinimapFill(fill);
  const item = minimapFillPreset(normalized.preset);
  if (item.kind === "static") return { frames: 1, kind: "static", steps: [{ offset: 0, brightness: 1 }] };
  const seconds = Math.min(MINIMAP_FILL_MAX_CYCLE, item.cycle / normalized.speed);
  const frames = Math.max(4, Math.round(seconds * fps));
  const steps = [];
  for (let index = 0; index < frames; index += 1) {
    const t = index / frames;
    steps.push(item.kind === "pulse" ? { offset: 0, brightness: pulse(item.id, t) } : { offset: t, brightness: 1 });
  }
  return { frames, kind: item.kind, steps };
}

/**
 * Кадры своего видео на таймлайне игры: номер кадра видео на каждый кадр
 * мини-карты (30 в секунду). Видео в 15 кадров держит каждый кадр два.
 */
export function fillVideoTimeline(video, fps = MINIMAP_FILL_FPS) {
  const frames = Math.max(1, Math.round(video?.frames || 1));
  const rate = Math.max(1, Math.round(video?.fps || 15));
  const total = Math.max(1, Math.round((frames * fps) / rate));
  return Array.from({ length: total }, (_, index) => Math.min(frames - 1, Math.floor((index * rate) / fps)));
}

const rgbOf = (value) => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
const alphaTerm = (alpha) => Math.round(256 * Math.min(1, Math.max(0, alpha)));

/**
 * Преобразование цвета внутри анимации (как у SWF: множитель — 1/256):
 * яркость плитки в кадре пульса.
 */
export function fillInnerTransform(brightness = 1) {
  const term = Math.round(256 * Math.min(1, Math.max(0, brightness)));
  return { mult: [term, term, term, 256], add: [0, 0, 0, 0] };
}

/**
 * Преобразование цвета всей анимации: серая плитка → от первого цвета
 * (тёмное) ко второму (светлое). Цветные виды и видео — как есть. `low` —
 * цвет малого HP: анимация умножается на него, как игра красит полосу.
 * `alpha` — непрозрачность заливки 0…1.
 */
export function fillOuterTransform(fill, { alpha = 1, low = "" } = {}) {
  const normalized = normalizeMinimapFill(fill);
  const alphaMult = alphaTerm(alpha);
  if (HEX.test(String(low || ""))) {
    const colour = rgbOf(String(low).toLowerCase());
    return { mult: colour.map((channel) => Math.round((channel * 256) / 255)).concat(alphaMult), add: [0, 0, 0, 0] };
  }
  const colourful = normalized.mode === "video" || Boolean(minimapFillPreset(normalized.preset)?.colourful);
  if (colourful) return { mult: [256, 256, 256, alphaMult], add: [0, 0, 0, 0] };
  const [from, to] = normalized.colors.map(rgbOf);
  return {
    mult: [0, 1, 2].map((channel) => Math.round(((to[channel] - from[channel]) * 256) / 255)).concat(alphaMult),
    add: [0, 1, 2].map((channel) => from[channel]).concat(0),
  };
}

const applyTerm = (value, mult, add) => Math.min(255, Math.max(0, (value * mult) / 256 + add));

/**
 * Кадр заливки для окна: RGBA полосы `width`×`height` в момент `seconds` —
 * тем же узором, сдвигом и цветом, что уйдут в игру. `low` — цвет малого
 * HP, когда полоса сейчас красная; `tile` — готовая плитка (`fillTile`),
 * чтобы не строить её на каждый кадр.
 */
export function fillPreviewFrame(fill, seconds, { width, height, alpha = 1, low = "", tile = null }) {
  const normalized = normalizeMinimapFill(fill);
  const out = new Uint8ClampedArray(width * height * 4);
  const timeline = fillTimeline(normalized);
  const step = timeline.steps[Math.floor(Math.max(0, seconds) * MINIMAP_FILL_FPS) % timeline.frames];
  const source = tile || fillTile(normalized.preset, 1);
  const inner = fillInnerTransform(step.brightness);
  const outer = fillOuterTransform(normalized, { alpha, low });
  const { period } = minimapFillGeometry(normalized.preset, { length: width, thickness: height });
  const shift = step.offset * period;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(((y + 0.5) / height) * source.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.period - 1, Math.floor(frac((x + 0.5 - shift) / period) * source.period));
      const from = (sy * source.width + sx) * 4;
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1)
        out[at + channel] = applyTerm(
          applyTerm(source.rgba[from + channel], inner.mult[channel], 0),
          outer.mult[channel],
          outer.add[channel],
        );
      out[at + 3] = Math.min(255, (255 * outer.mult[3]) / 256);
    }
  }
  return out;
}
