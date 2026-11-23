/*
 * Astral.fx на процессоре (ТЗ 17.10, задача 8): та же математика, что в
 * шейдере `ASTRAL_FX` из `reshade.js`, по пикселям изображения. Нужна двум
 * местам: превью пресета в окне (настоящий кадр игры без эффектов,
 * пропущенный через эти же формулы) и тесту, который проверяет правило
 * Majestic «пресет не просветляет ночь».
 *
 * Порядок проходов — как у ReShade: техники пресета идут по очереди
 * (`reshadePresetTechniques`), каждая берёт результат предыдущей. Выборки
 * за краем кадра — по границе (адресация CLAMP, как у ReShade), свечение —
 * четвертинное разрешение с двойным размытием по осям.
 *
 * Что сверяется с шейдером: цвет, резкость и виньетка — тест гоняет сам текст
 * шейдера через маленький разборщик HLSL и сравнивает с этим портом попиксельно;
 * свечение (несколько проходов через текстуры) сверяется по числам из текста
 * шейдера (`FX_LITERALS`) и по приближению к кадру ReShade, а не строкой
 * в строку, поэтому превью подписано «приблизительно».
 *
 * Комикс на весь экран (`AstralComic.fx`, задача 35 (г)) — тоже здесь: его
 * один проход считает `comicPass`, тест гонит по нему сам текст шейдера
 * (`COMIC_FX_LITERALS` — числа порта дословно в тексте).
 *
 * Остальные стили мира на весь экран (`reshade-style-shaders.js`, задача 38) — так же: `paintedPass`, `cartoonPass`,
 * `watercolorPass`, `retroPass`; каждый один проход, тест гонит по ним текст своего шейдера (`STYLE_FX_LITERALS`).
 */

import { reshadePresetLook, reshadePresetTechniques } from "./reshade.js";

/* Числа шейдера, которые порт повторяет: тест ищет каждое в тексте `ASTRAL_FX`. */
export const FX_LITERALS = Object.freeze([
  "0.2126, 0.7152, 0.0722",
  "exp2(Exposure)",
  "1.0 + Temperature * 0.10 + Tint * 0.05, 1.0 - Tint * 0.08, 1.0 - Temperature * 0.10 + Tint * 0.05",
  "Shadows * (1.0 - smoothstep(0.0, 0.5, l)) * 0.25",
  "Highlights * smoothstep(0.5, 1.0, l) * 0.25",
  "(c - 0.5) * (1.0 + Contrast) + 0.5",
  "lerp(grey, c, 1.0 + Saturation)",
  "1.0 + Vibrance * (1.0 - saturate(spread))",
  "-1.0 / lerp(8.0, 5.0, SharpenStrength)",
  "(c + (n + s + w + e) * wgt) / (1.0 + 4.0 * wgt)",
  "BUFFER_WIDTH / 4",
  "0.227027",
  "0.1945946",
  "0.1216216",
  "0.054054",
  "0.016216",
  "BUFFER_RCP_WIDTH * 8.0",
  "c + tex2D(AstralBloomA, uv).rgb * BloomStrength * (1.0 - c)",
  "smoothstep(0.45, 1.1, length(d) * 1.2)",
]);

/* Числа порта комикса, которые тест ищет в тексте `ASTRAL_COMIC_FX`. */
export const COMIC_FX_LITERALS = Object.freeze([
  "0.2126, 0.7152, 0.0722",
  "(tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)",
  "(bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)",
  "smoothstep(0.18, 0.5, length(float2(gx, gy)))",
  "floor(sqrt(l) * ComicBands + 0.5 * smoothstep(0.45, 0.75, l)) / ComicBands",
  "c *= q * q / max(l, 0.0001)",
  "c *= 1.0 - ComicEdge * outline",
]);

/* Числа портов стилей мира (задача 38), которые тест ищет в тексте шейдера каждого стиля дословно. */
const STYLE_COMMON_LITERALS = ["0.2126, 0.7152, 0.0722", "(tl + 2.0 * tc + tr + 2.0 * ml + 4.0 * c + 2.0 * mr + bl + 2.0 * bc + br) / 16.0", "smoothstep(0.45, 0.75, l)"];
export const STYLE_FX_LITERALS = Object.freeze({
  painted: Object.freeze([...STYLE_COMMON_LITERALS, "sqrt(l) * PaintedBands", "(p - fl - 0.5) * 3.0 + 0.5", "smoothstep(0.1, 0.4, length(float2(gx, gy)))", "float3(0.18, 0.125, 0.1)", "PaintedPaper * 0.08", "float2(12.9898, 78.233)", "43758.5453"]),
  cartoon: Object.freeze([...STYLE_COMMON_LITERALS, "sqrt(l) * CartoonBands", "(p - fl - 0.5) * 2.0 + 0.5", "smoothstep(0.1, 0.4, length(float2(gx, gy)))", "q * q + keep * q * q * (1.0 - q * q) * 0.125", "1.0 - CartoonEdge * outline"]),
  watercolor: Object.freeze([...STYLE_COMMON_LITERALS, "px * 2.0", "sqrt(l) * WatercolorBands", "(p - fl - 0.5) * 2.0 + 0.5", "smoothstep(0.45, 0.8, l)", "(1.0 - wash) * WatercolorWash * light", "smoothstep(0.05, 0.25, length(float2(gx, gy)))", "WatercolorPaper * 0.06", "float2(12.9898, 78.233)", "43758.5453", "/ 2.0"]),
  retro: Object.freeze(["0.2126, 0.7152, 0.0722", "max(2.0, 2.0 * floor(BUFFER_HEIGHT / 540.0 + 0.5))", "block * 0.5", "(a + b + d + e) * 0.25", "smoothstep(0.45, 0.75, l)", "floor(sqrt(l) * RetroSteps + 0.5 * keep) / RetroSteps", "floor((c - l) / RetroChroma + 0.5) * RetroChroma", "q * q + snapped - AstralRetroLuma(snapped)"]),
});

const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
const luma = (r, g, b) => r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
const saturate = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (low, high, value) => {
  const t = saturate((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

/** Один пиксель через `PS_AstralColor`: числа 0…1 → числа 0…1. */
export function astralColorPixel(r, g, b, look) {
  const gain = 2 ** look.Exposure;
  r *= gain;
  g *= gain;
  b *= gain;
  r *= 1 + look.Temperature * 0.1 + look.Tint * 0.05;
  g *= 1 - look.Tint * 0.08;
  b *= 1 - look.Temperature * 0.1 + look.Tint * 0.05;
  let l = luma(r, g, b);
  /* Тени и света — по яркости до сдвига, обе прибавки к одной и той же `l`, как два `+=` в шейдере. */
  const shift = look.Shadows * (1 - smoothstep(0, 0.5, l)) * 0.25 + look.Highlights * smoothstep(0.5, 1, l) * 0.25;
  r += shift;
  g += shift;
  b += shift;
  const k = 1 + look.Contrast;
  r = (r - 0.5) * k + 0.5;
  g = (g - 0.5) * k + 0.5;
  b = (b - 0.5) * k + 0.5;
  l = luma(r, g, b);
  const sat = 1 + look.Saturation;
  r = l + (r - l) * sat;
  g = l + (g - l) * sat;
  b = l + (b - l) * sat;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const vib = 1 + look.Vibrance * (1 - saturate(spread));
  r = l + (r - l) * vib;
  g = l + (g - l) * vib;
  b = l + (b - l) * vib;
  return [saturate(r), saturate(g), saturate(b)];
}

/* ------------------------------------------------------------ кадр целиком */

/* Выборка по границе кадра (CLAMP). */
const at = (width, height, x, y) => (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3;

/* Билинейная выборка по координате в пикселях (центр пикселя — x + 0,5). */
function bilinear(data, width, height, x, y, out) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = at(width, height, x0, y0);
  const b = at(width, height, x0 + 1, y0);
  const c = at(width, height, x0, y0 + 1);
  const d = at(width, height, x0 + 1, y0 + 1);
  for (let channel = 0; channel < 3; channel += 1) {
    const top = data[a + channel] * (1 - tx) + data[b + channel] * tx;
    const bottom = data[c + channel] * (1 - tx) + data[d + channel] * tx;
    out[channel] = top * (1 - ty) + bottom * ty;
  }
}

function colorPass(data, look) {
  for (let index = 0; index < data.length; index += 3) {
    const [r, g, b] = astralColorPixel(data[index], data[index + 1], data[index + 2], look);
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }
}

/** Резкость, `PS_AstralSharpen`: адаптивная, слабее там, где контраст и так велик. */
export function sharpenPass(data, width, height, strength) {
  const source = Float32Array.from(data);
  const base = -1 / (8 + (5 - 8) * strength);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = at(width, height, x, y);
      const n = at(width, height, x, y - 1);
      const s = at(width, height, x, y + 1);
      const w = at(width, height, x - 1, y);
      const e = at(width, height, x + 1, y);
      for (let channel = 0; channel < 3; channel += 1) {
        const centre = source[c + channel];
        const up = source[n + channel];
        const down = source[s + channel];
        const left = source[w + channel];
        const right = source[e + channel];
        const lo = Math.min(centre, up, down, left, right);
        const hi = Math.max(centre, up, down, left, right);
        const amp = Math.sqrt(saturate(Math.min(lo, 1 - hi) / Math.max(hi, 0.0001)));
        const weight = amp * base;
        data[c + channel] = saturate((centre + (up + down + left + right) * weight) / (1 + 4 * weight));
      }
    }
  }
}

/**
 * Комикс, `PS_AstralComic`: контур — оператор Собеля по яркости восьми соседей, ступени — по корню яркости, `bands`
 * штук: тёмное вниз до нижнего края ступени, светлое вверх (оттенок и насыщенность те же), линия только темнит.
 */
export function comicPass(data, width, height, bands, edge) {
  const source = Float32Array.from(data);
  const lumaAt = (x, y) => {
    const index = at(width, height, x, y);
    return luma(source[index], source[index + 1], source[index + 2]);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const l = luma(source[index], source[index + 1], source[index + 2]);
      const tl = lumaAt(x - 1, y - 1);
      const tc = lumaAt(x, y - 1);
      const tr = lumaAt(x + 1, y - 1);
      const ml = lumaAt(x - 1, y);
      const mr = lumaAt(x + 1, y);
      const bl = lumaAt(x - 1, y + 1);
      const bc = lumaAt(x, y + 1);
      const br = lumaAt(x + 1, y + 1);
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const outline = smoothstep(0.18, 0.5, Math.hypot(gx, gy));
      const q = Math.floor(Math.sqrt(l) * bands + 0.5 * smoothstep(0.45, 0.75, l)) / bands;
      const gain = ((q * q) / Math.max(l, 0.0001)) * (1 - edge * outline);
      for (let channel = 0; channel < 3; channel += 1) data[index + channel] = saturate(source[index + channel] * gain);
    }
  }
}

/* ------------------------------------------- стили мира на весь экран (задача 38) */

/*
 * Общая основа четырёх стилей из `reshade-style-shaders.js` (рисованный, мультяшный, акварель; ретро считает блоки
 * само): сглаживание [1 2 1]² по девяти выборкам вокруг точки с шагом `step` пикселей и градиент Собеля по яркости
 * тех же выборок. Выборка за краем кадра — по границе. Яркость кадра считается один раз на весь кадр.
 */
const SMOOTH_KERNEL = Object.freeze([1, 2, 1, 2, 4, 2, 1, 2, 1]);
const SOBEL_X = Object.freeze([-1, 0, 1, -2, 0, 2, -1, 0, 1]);
const SOBEL_Y = Object.freeze([-1, -2, -1, 0, 0, 0, 1, 2, 1]);
const clampIndex = (value, last) => Math.min(last, Math.max(0, value));

function lumaPlane(data, width, height) {
  const plane = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) plane[pixel] = luma(data[pixel * 3], data[pixel * 3 + 1], data[pixel * 3 + 2]);
  return plane;
}

/* Сглаженный цвет в `soft` и длина градиента Собеля как результат. */
function styleNeighbourhood(source, lumas, width, height, x, y, step, soft) {
  let r = 0;
  let g = 0;
  let b = 0;
  let gx = 0;
  let gy = 0;
  for (let row = 0; row < 3; row += 1) {
    const yy = clampIndex(y + (row - 1) * step, height - 1);
    for (let column = 0; column < 3; column += 1) {
      const xx = clampIndex(x + (column - 1) * step, width - 1);
      const tap = row * 3 + column;
      const index = (yy * width + xx) * 3;
      const weight = SMOOTH_KERNEL[tap];
      r += source[index] * weight;
      g += source[index + 1] * weight;
      b += source[index + 2] * weight;
      const l = lumas[yy * width + xx];
      gx += l * SOBEL_X[tap];
      gy += l * SOBEL_Y[tap];
    }
  }
  soft[0] = r / 16;
  soft[1] = g / 16;
  soft[2] = b / 16;
  return Math.hypot(gx, gy);
}

/* Зерно бумаги, `frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453)`. */
const grainAt = (px, py) => {
  const value = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Ступень яркости по корню: `fl` — целая часть, `t` — доля внутри ступени после крутизны `slope`, `keepLight` —
 * насколько светлое подтягивается к ступени (тёмное — не выше своего положения внутри ступени).
 */
function bandLevel(l, bands, slope) {
  const p = Math.sqrt(l) * bands;
  const fl = Math.floor(p);
  const t = saturate((p - fl - 0.5) * slope + 0.5);
  const sb = t * t * (3 - 2 * t);
  const low = Math.min(sb, p - fl);
  const k = smoothstep(0.45, 0.75, l);
  return ((fl + low + (sb - low) * k) / bands);
}

/**
 * «Рисованный», `PS_AstralPainted`: мягкие мазки (ступени яркости с плавным переходом), тёплый контур — цвет
 * не светлее самого пикселя, зерно бумаги только темнит.
 */
export function paintedPass(data, width, height, bands, edge, paper) {
  const source = Float32Array.from(data);
  const lumas = lumaPlane(source, width, height);
  const soft = [0, 0, 0];
  const ink = [0.18, 0.125, 0.1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = styleNeighbourhood(source, lumas, width, height, x, y, 1, soft);
      const l = luma(soft[0], soft[1], soft[2]);
      const q = bandLevel(l, bands, 3);
      const gain = (q * q) / Math.max(l, 0.0001);
      const outline = smoothstep(0.1, 0.4, gradient);
      const grain = 1 - paper * 0.08 * grainAt(x + 0.5, y + 0.5);
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const body = soft[channel] * gain;
        const inked = body + (Math.min(body, ink[channel]) - body) * edge * outline;
        data[index + channel] = saturate(inked * grain);
      }
    }
  }
}

/**
 * «Мультяшный», `PS_AstralCartoon`: плоские яркие цвета (ступени), середина чуть выше у светлого, мягкий контур
 * темнее собственного цвета.
 */
export function cartoonPass(data, width, height, bands, edge) {
  const source = Float32Array.from(data);
  const lumas = lumaPlane(source, width, height);
  const soft = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = styleNeighbourhood(source, lumas, width, height, x, y, 1, soft);
      const l = luma(soft[0], soft[1], soft[2]);
      const q = bandLevel(l, bands, 2);
      const keep = smoothstep(0.45, 0.75, l);
      const shade = q * q + keep * q * q * (1 - q * q) * 0.125;
      const gain = (shade / Math.max(l, 0.0001)) * (1 - edge * smoothstep(0.1, 0.4, gradient));
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) data[index + channel] = saturate(soft[channel] * gain);
    }
  }
}

/**
 * «Акварель», `PS_AstralWatercolor`: разрежённое сглаживание (шаг два пикселя), мягкие ступени, бумага светлит
 * светлое к белому, влажный край пигмента, зерно бумаги в клетках 2×2.
 */
export function watercolorPass(data, width, height, bands, wash, edge, paper) {
  const source = Float32Array.from(data);
  const lumas = lumaPlane(source, width, height);
  const soft = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = styleNeighbourhood(source, lumas, width, height, x, y, 2, soft);
      const l = luma(soft[0], soft[1], soft[2]);
      const q = bandLevel(l, bands, 2);
      const gain = (q * q) / Math.max(l, 0.0001);
      const light = smoothstep(0.45, 0.8, l);
      const rim = 1 - edge * smoothstep(0.05, 0.25, gradient);
      const grain = 1 - paper * 0.06 * grainAt(Math.floor((x + 0.5) / 2), Math.floor((y + 0.5) / 2));
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        let value = soft[channel] * gain;
        value += (1 - value) * wash * light;
        data[index + channel] = saturate(value * rim * grain);
      }
    }
  }
}

/** Размер блока «Ретро»: два пикселя на каждые 540 строк кадра, не меньше двух. */
export const retroBlock = (height) => Math.max(2, 2 * Math.floor(height / 540 + 0.5));

/**
 * «Ретро», `PS_AstralRetro`: блок — среднее четырёх центральных пикселей, яркость по ступеням корня, цвет — отклонение
 * от яркости крупными шагами `chroma` с поправкой, чтобы яркость блока осталась на ступени.
 */
export function retroPass(data, width, height, steps, chroma) {
  const source = Float32Array.from(data);
  const block = retroBlock(height);
  const half = block / 2;
  const snapped = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    const top = clampIndex(Math.floor(y / block) * block + half - 1, height - 1);
    const bottom = clampIndex(top + 1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const left = clampIndex(Math.floor(x / block) * block + half - 1, width - 1);
      const right = clampIndex(left + 1, width - 1);
      const corners = [(top * width + left) * 3, (top * width + right) * 3, (bottom * width + left) * 3, (bottom * width + right) * 3];
      const c = [0, 0, 0];
      for (let channel = 0; channel < 3; channel += 1) c[channel] = (source[corners[0] + channel] + source[corners[1] + channel] + source[corners[2] + channel] + source[corners[3] + channel]) * 0.25;
      const l = luma(c[0], c[1], c[2]);
      const keep = smoothstep(0.45, 0.75, l);
      const q = Math.floor(Math.sqrt(l) * steps + 0.5 * keep) / steps;
      for (let channel = 0; channel < 3; channel += 1) snapped[channel] = Math.floor((c[channel] - l) / chroma + 0.5) * chroma;
      const drift = luma(snapped[0], snapped[1], snapped[2]);
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) data[index + channel] = saturate(q * q + snapped[channel] - drift);
    }
  }
}

/** Виньетка, `PS_AstralVignette`. */
export function vignettePass(data, width, height, strength) {
  const aspect = width / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = ((x + 0.5) / width - 0.5) * aspect;
      const dy = (y + 0.5) / height - 0.5;
      const shade = 1 - strength * smoothstep(0.45, 1.1, Math.hypot(dx, dy) * 1.2);
      const index = (y * width + x) * 3;
      data[index] *= shade;
      data[index + 1] *= shade;
      data[index + 2] *= shade;
    }
  }
}

const BLUR = Object.freeze([0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216]);

/* Одно размытие вдоль оси: девять отсчётов с шагом `step` (в пикселях текстуры свечения). */
function blur(from, to, width, height, horizontal, step) {
  const sample = [0, 0, 0];
  const plus = [0, 0, 0];
  const minus = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 3;
      bilinear(from, width, height, x + 0.5, y + 0.5, sample);
      let r = sample[0] * BLUR[0];
      let g = sample[1] * BLUR[0];
      let b = sample[2] * BLUR[0];
      for (let tap = 1; tap < BLUR.length; tap += 1) {
        const shift = step * tap;
        bilinear(from, width, height, x + 0.5 + (horizontal ? shift : 0), y + 0.5 + (horizontal ? 0 : shift), plus);
        bilinear(from, width, height, x + 0.5 - (horizontal ? shift : 0), y + 0.5 - (horizontal ? 0 : shift), minus);
        r += (plus[0] + minus[0]) * BLUR[tap];
        g += (plus[1] + minus[1]) * BLUR[tap];
        b += (plus[2] + minus[2]) * BLUR[tap];
      }
      to[out] = r;
      to[out + 1] = g;
      to[out + 2] = b;
    }
  }
}

/** Свечение, `AstralBloom`: яркое с мягким коленом, четверть кадра, два размытия по осям, наложение «экраном». */
export function bloomPass(data, width, height, strength, threshold) {
  const bw = Math.max(1, Math.floor(width / 4));
  const bh = Math.max(1, Math.floor(height / 4));
  const bright = (r, g, b) => {
    const k = saturate((luma(r, g, b) - threshold) / Math.max(1 - threshold, 0.001));
    return k * k;
  };
  let a = new Float32Array(bw * bh * 3);
  let b = new Float32Array(bw * bh * 3);
  const sample = [0, 0, 0];
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const out = (y * bw + x) * 3;
      const px = ((x + 0.5) / bw) * width;
      const py = ((y + 0.5) / bh) * height;
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        bilinear(data, width, height, px + ox, py + oy, sample);
        const k = bright(sample[0], sample[1], sample[2]);
        a[out] += sample[0] * k * 0.25;
        a[out + 1] += sample[1] * k * 0.25;
        a[out + 2] += sample[2] * k * 0.25;
      }
    }
  }
  /* Шаг размытия — 8 пикселей кадра (`BUFFER_RCP_WIDTH * 8.0`) в пикселях четвертинной текстуры. */
  const stepX = (8 * bw) / width;
  const stepY = (8 * bh) / height;
  for (let pass = 0; pass < 2; pass += 1) {
    blur(a, b, bw, bh, true, stepX);
    blur(b, a, bw, bh, false, stepY);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      bilinear(a, bw, bh, ((x + 0.5) / width) * bw, ((y + 0.5) / height) * bh, sample);
      for (let channel = 0; channel < 3; channel += 1) {
        const c = data[index + channel];
        data[index + channel] = saturate(c + sample[channel] * strength * (1 - c));
      }
    }
  }
}

/**
 * Пресет на кадре: `rgba` — Uint8 RGBA (sRGB, как отдаёт canvas), результат —
 * новый Uint8ClampedArray той же формы, альфа не меняется.
 */
export function applyPresetToFrame(rgba, width, height, presetId) {
  const look = reshadePresetLook(presetId);
  const data = new Float32Array(width * height * 3);
  for (let pixel = 0, index = 0; pixel < width * height; pixel += 1, index += 3) {
    data[index] = rgba[pixel * 4] / 255;
    data[index + 1] = rgba[pixel * 4 + 1] / 255;
    data[index + 2] = rgba[pixel * 4 + 2] / 255;
  }
  for (const technique of reshadePresetTechniques(presetId)) {
    if (technique === "AstralColor") colorPass(data, look);
    else if (technique === "AstralBloom") bloomPass(data, width, height, look.BloomStrength, look.BloomThreshold);
    else if (technique === "AstralComic") comicPass(data, width, height, look.ComicBands, look.ComicEdge);
    else if (technique === "AstralPainted") paintedPass(data, width, height, look.PaintedBands, look.PaintedEdge, look.PaintedPaper);
    else if (technique === "AstralCartoon") cartoonPass(data, width, height, look.CartoonBands, look.CartoonEdge);
    else if (technique === "AstralWatercolor") watercolorPass(data, width, height, look.WatercolorBands, look.WatercolorWash, look.WatercolorEdge, look.WatercolorPaper);
    else if (technique === "AstralRetro") retroPass(data, width, height, look.RetroSteps, look.RetroChroma);
    else if (technique === "AstralSharpen") sharpenPass(data, width, height, look.SharpenStrength);
    else vignettePass(data, width, height, look.VignetteStrength);
  }
  const out = new Uint8ClampedArray(rgba.length);
  for (let pixel = 0, index = 0; pixel < width * height; pixel += 1, index += 3) {
    out[pixel * 4] = Math.round(data[index] * 255);
    out[pixel * 4 + 1] = Math.round(data[index + 1] * 255);
    out[pixel * 4 + 2] = Math.round(data[index + 2] * 255);
    out[pixel * 4 + 3] = rgba[pixel * 4 + 3];
  }
  return out;
}
