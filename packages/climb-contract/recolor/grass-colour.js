/*
 * Цвет травы с её рисунком — «Трава по миру» (задача 4 ТЗ 06.10.2026).
 *
 * Прежняя перекраска травы ставила средней траве листа ровно светлоту
 * выбранного цвета (HSL), а остальным — пропорционально яркости. У тёмной
 * травы мода (средняя яркость ≈ 0,15) оранжевый поднимал всё в три-четыре
 * раза: блики уходили в белое, тени — в чёрное, и в игре земля становилась
 * ровным ярким «полом» без травинок (кадры `runs/tz0610/grass-before`).
 *
 * Здесь цвет травы — сдвиг, а не заливка. Пиксель раскладывается на яркость
 * и цветоразность (YCbCr BT.601): яркость остаётся своей (× общий
 * множитель), цветоразность поворачивается к тону выбранного цвета и
 * растягивается до его насыщенности, а отличие пикселя от средней травы
 * листа — светлее, темнее, желтее, синее — сохраняется. Поворот
 * цветоразности не трогает яркость, поэтому рисунок травинок, рельеф,
 * тени и камни среди травы остаются как были, а трава становится нужного
 * цвета.
 *
 * Множитель яркости — во сколько раз выбранный цвет светлее или темнее
 * зелени мода (`#4f9a2c` на образце — так трава мода выглядит в игре днём):
 * «зелень мода» не меняет яркости, белый — светлее вдвое, чёрный — почти
 * чёрная трава. Он общий у листов вблизи, атласов вдали, травинок и снимка в
 * окне — на всех дистанциях трава одного цвета и одной яркости.
 *
 * Песок вдали (атласы дальних планов пустыни, где мод вблизи положил траву)
 * становится травой той же формулой, но яркость его приводится к яркости
 * травы (`albedo`): светлый песок иначе дал бы вдали траву светлее, чем она
 * есть вблизи.
 */

import { hexBytes, rgbToHsl } from "./colour.js";

/** Образец «зелени мода»: так трава мода выглядит в игре днём. */
export const GRASS_DISPLAY_GREEN = "#4f9a2c";

const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const DISPLAY_GREEN_LUMA = lumaOf(...hexBytes(GRASS_DISPLAY_GREEN).map((value) => value / 255));

/* Пределы: множитель яркости, насыщенность цели и растяжка пикселя. */
const GAIN_RANGE = [0.12, 2.2];
const MAX_SATURATION = 1.6;
const MAX_RELATIVE = 2.5;
const DARK = 0.04;
/* Отличие тона пикселя от средней травы: доля, что остаётся, и предел.
   Поворот целиком переносил жёлтые проплешины в розовое. */
const HUE_KEEP = 0.35;
const MAX_TURN = 0.45;

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const wrapAngle = (angle) => {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
};

/** sRGB 0…1 → [Y, Cb, Cr] (BT.601). */
export function toYcc(r, g, b) {
  const y = lumaOf(r, g, b);
  return [y, (b - y) * 0.564, (r - y) * 0.713];
}

/* Яркость `y` и цветоразность `(cb, cr)` → sRGB 0…1 в пределах: если цвет
   выходит за край, цветоразность ужимается (тон и яркость остаются). */
function fromYcc(y, cb, cr) {
  if (y >= 1) return [1, 1, 1];
  if (y <= 0) return [0, 0, 0];
  const delta = [1.402 * cr, -0.344136 * cb - 0.714136 * cr, 1.772 * cb];
  let scale = 1;
  for (const d of delta) {
    if (d > 1e-9) scale = Math.min(scale, (1 - y) / d);
    else if (d < -1e-9) scale = Math.min(scale, y / -d);
  }
  return [y + delta[0] * scale, y + delta[1] * scale, y + delta[2] * scale];
}

/**
 * Цель цвета травы: `colour` — `#rrggbb` или `[r, g, b]` байтами.
 * `gain` — множитель яркости (по умолчанию — от светлоты цвета к зелени мода;
 * у «как в моде» — 1: трава мода как есть).
 */
export function grassTarget(colour, { gain = null } = {}) {
  const [r, g, b] = (Array.isArray(colour) ? colour : hexBytes(colour)).map((value) => value / 255);
  const [y, cb, cr] = toYcc(r, g, b);
  const chroma = Math.hypot(cb, cr);
  return {
    y,
    angle: Math.atan2(cr, cb),
    saturation: Math.min(MAX_SATURATION, chroma / Math.max(y, DARK)),
    gain: gain ?? clamp(y / DISPLAY_GREEN_LUMA, GAIN_RANGE[0], GAIN_RANGE[1]),
  };
}

/**
 * Средняя трава листа: копилка `add(r, g, b, вес)` → `result()` —
 * `{ y, angle, saturation }` или `null`, если травы нет.
 */
export function grassReference() {
  let weight = 0;
  let sumY = 0;
  let sumCb = 0;
  let sumCr = 0;
  return {
    add(r, g, b, w = 1) {
      if (w <= 0) return;
      const [y, cb, cr] = toYcc(r, g, b);
      weight += w;
      sumY += y * w;
      sumCb += cb * w;
      sumCr += cr * w;
    },
    get weight() {
      return weight;
    },
    result() {
      if (weight <= 0) return null;
      const y = sumY / weight;
      const cb = sumCb / weight;
      const cr = sumCr / weight;
      return { y, angle: Math.atan2(cr, cb), saturation: Math.max(0.02, Math.hypot(cb, cr) / Math.max(y, DARK)) };
    },
  };
}

/**
 * Пиксель травы в цвете цели — `[r, g, b]` 0…1. `reference` — средняя трава
 * листа (`grassReference`), `lumaScale` — дополнительный множитель яркости
 * (песок вдали → яркость травы), `hueKeep` — какая доля отличия тона
 * пикселя от средней травы остаётся.
 */
export function shiftGrass(r, g, b, target, reference, { lumaScale = 1, hueKeep = HUE_KEEP } = {}) {
  const [y, cb, cr] = toYcc(r, g, b);
  const nextY = y * target.gain * lumaScale;
  const chroma = Math.hypot(cb, cr);
  const relative = clamp(chroma / Math.max(y, DARK) / reference.saturation, 0, MAX_RELATIVE);
  const turn = chroma > 1e-4 ? clamp(wrapAngle(Math.atan2(cr, cb) - reference.angle) * hueKeep, -MAX_TURN, MAX_TURN) : 0;
  const angle = target.angle + turn;
  const nextChroma = target.saturation * relative * nextY;
  return fromYcc(nextY, nextChroma * Math.cos(angle), nextChroma * Math.sin(angle));
}

/*
 * Насколько пиксель — трава (0…1): тон зелени 75…165° уверенно, края полосы
 * (55…75 — жёлтые проплешины, 165…185) — частью; серое (насыщенность ниже
 * 0,03) — не трава, до 0,10 — частью. Мягкие края — чтобы мох на камне,
 * блёклая трава и трава в тени перекрашивались вместе с травой, а не
 * оставались серо-зелёными пятнами среди нового цвета (так было у листов
 * «трава на скалах» в DXT1: блоки 4×4 на краю порога).
 */
export function grassWeight(h, s) {
  if (s < 0.03 || h < 55 || h > 185) return 0;
  const hue = h < 75 ? (h - 55) / 20 : h > 165 ? (185 - h) / 20 : 1;
  const sat = s < 0.1 ? (s - 0.03) / 0.07 : 1;
  return hue * sat;
}

/*
 * Насколько пиксель — песок или сухая трава (0…1): тон 14…66° (жёлто-бурые),
 * насыщенность от 0,1, светлота 0,14…0,9 — с мягкими краями. Серое (дороги,
 * камень, бетон), вода, зелень, глубокая тень и белое — не песок.
 */
export function sandWeight(h, s, l) {
  if (s < 0.1 || l < 0.14 || l > 0.9 || h < 14 || h > 66) return 0;
  const hue = h < 22 ? (h - 14) / 8 : h > 58 ? (66 - h) / 8 : 1;
  const sat = s < 0.17 ? (s - 0.1) / 0.07 : 1;
  const light = l < 0.2 ? (l - 0.14) / 0.06 : l > 0.84 ? (0.9 - l) / 0.06 : 1;
  return hue * sat * light;
}

/* Кэш целей по цвету: у радуги — сотни цветов на лист, у сплошного — один. */
function targetCache(options = {}) {
  const cache = new Map();
  return (colour) => {
    const key = Array.isArray(colour) ? (colour[0] << 16) | (colour[1] << 8) | colour[2] : colour;
    let target = cache.get(key);
    if (!target) cache.set(key, (target = grassTarget(colour, options)));
    return target;
  };
}

/**
 * Зелень травы в свой цвет: трава листа берёт тон и насыщенность цвета,
 * яркость и рисунок — свои (средняя трава листа становится цветом, яркость —
 * по множителю цели). Та же функция у установщика (листы мода и штатная трава
 * зоны) и у снимка в окне. `colour` — `#rrggbb`; без цвета — пиксели как были.
 */
export function recolourGrass(rgba, colour) {
  if (!colour) return rgba;
  if (kernels) {
    const fast = grassByKernel(rgba, colour);
    if (fast !== undefined) return fast;
  }
  const target = grassTarget(colour);
  const weights = new Float32Array(rgba.length / 4);
  const reference = grassReference();
  for (let index = 0, at = 0; at < rgba.length; index += 1, at += 4) {
    const r = rgba[at] / 255;
    const g = rgba[at + 1] / 255;
    const b = rgba[at + 2] / 255;
    const [h, s] = rgbToHsl(r, g, b);
    const weight = grassWeight(h, s);
    weights[index] = weight;
    reference.add(r, g, b, weight);
  }
  const ref = reference.result();
  if (!ref) return rgba;
  const out = new Uint8ClampedArray(rgba);
  for (let index = 0, at = 0; at < rgba.length; index += 1, at += 4) {
    const weight = weights[index];
    if (weight <= 0) continue;
    const r = rgba[at] / 255;
    const g = rgba[at + 1] / 255;
    const b = rgba[at + 2] / 255;
    const [nr, ng, nb] = shiftGrass(r, g, b, target, ref);
    out[at] = Math.round((r + (nr - r) * weight) * 255);
    out[at + 1] = Math.round((g + (ng - g) * weight) * 255);
    out[at + 2] = Math.round((b + (nb - b) * weight) * 255);
  }
  return out;
}

/*
 * Атлас дальнего плана: веса песка и травы у каждого пикселя (или опорного
 * цвета блока) и две средние — травы и песка. `greens` — красить и штатную
 * зелень (свой цвет травы), `sand` — превращать песок в траву (загородная
 * зона: вблизи мод положил траву на место песка).
 */
function distantWeights(colours, { greens, sand }) {
  const count = colours.length / 3;
  const grass = new Float32Array(count);
  const sandy = new Float32Array(count);
  const grassRef = grassReference();
  const sandRef = grassReference();
  for (let index = 0; index < count; index += 1) {
    const r = colours[index * 3];
    const g = colours[index * 3 + 1];
    const b = colours[index * 3 + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const green = greens ? grassWeight(h, s) : 0;
    const dry = sand ? sandWeight(h, s, l) : 0;
    if (green >= dry && green > 0) {
      grass[index] = green;
      grassRef.add(r, g, b, green);
    } else if (dry > 0) {
      sandy[index] = dry;
      sandRef.add(r, g, b, dry);
    }
  }
  return { grass, sandy, grassRef: grassRef.result(), sandRef: sandRef.result() };
}

/* Цвет пикселя атласа по весам: трава — своим рисунком, песок — к яркости травы. */
function distantShift(r, g, b, index, weights, target, albedo) {
  const green = weights.grass[index];
  const dry = weights.sandy[index];
  if (green > 0) {
    const [nr, ng, nb] = shiftGrass(r, g, b, target, weights.grassRef);
    return [r + (nr - r) * green, g + (ng - g) * green, b + (nb - b) * green];
  }
  if (dry > 0) {
    const lumaScale = clamp(albedo / Math.max(weights.sandRef.y, DARK), 0.25, 1.6);
    const [nr, ng, nb] = shiftGrass(r, g, b, target, weights.sandRef, { lumaScale });
    return [r + (nr - r) * dry, g + (ng - g) * dry, b + (nb - b) * dry];
  }
  return null;
}

/**
 * Дальний план в траву: пиксели атласа LOD/SLOD в цвет травы своей зоны.
 * `colourAt(px, py)` — байты `[r, g, b]` цвета травы для пикселя (у радуги и
 * градиента — по месту на карте) или `null` (зона без травы — пиксель как
 * был). Параметры:
 *   greens — красить и штатную зелень (свой цвет травы);
 *   sand   — песок и сухую траву — в траву (загородная зона);
 *   albedo — яркость травы вблизи (песок приводится к ней);
 *   gain   — множитель яркости (у «как в моде» — 1).
 * Возвращает новые пиксели или тот же массив, если менять нечего.
 */
export function recolourDistantSand(rgba, width, height, colourAt, { greens = false, sand = true, albedo = 0.2, gain = null } = {}) {
  if (kernels) {
    const fast = distantSandByKernel(rgba, width, height, colourAt, { greens, sand, albedo, gain });
    if (fast !== undefined) return fast;
  }
  const colours = new Float32Array((rgba.length / 4) * 3);
  for (let index = 0, at = 0; at < rgba.length; index += 1, at += 4) {
    colours[index * 3] = rgba[at] / 255;
    colours[index * 3 + 1] = rgba[at + 1] / 255;
    colours[index * 3 + 2] = rgba[at + 2] / 255;
  }
  const weights = distantWeights(colours, { greens, sand });
  if (!weights.grassRef && !weights.sandRef) return rgba;
  const targetOf = targetCache({ gain });
  const out = new Uint8ClampedArray(rgba);
  let changed = false;
  for (let py = 0; py < height; py += 1)
    for (let px = 0; px < width; px += 1) {
      const index = py * width + px;
      if (weights.grass[index] <= 0 && weights.sandy[index] <= 0) continue;
      const colour = colourAt(px, py);
      if (!colour) continue;
      const at = index * 4;
      const next = distantShift(colours[index * 3], colours[index * 3 + 1], colours[index * 3 + 2], index, weights, targetOf(colour), albedo);
      if (!next) continue;
      out[at] = Math.round(next[0] * 255);
      out[at + 1] = Math.round(next[1] * 255);
      out[at + 2] = Math.round(next[2] * 255);
      changed = true;
    }
  return changed ? out : rgba;
}

const unpack565 = (value) => {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  return [((r << 3) | (r >> 2)) / 255, ((g << 2) | (g >> 4)) / 255, ((b << 3) | (b >> 2)) / 255];
};
const pack565 = (r, g, b) =>
  (Math.round(clamp(r, 0, 1) * 31) << 11) | (Math.round(clamp(g, 0, 1) * 63) << 5) | Math.round(clamp(b, 0, 1) * 31);

/**
 * То же прямо в сжатом листе DXT1/DXT3/DXT5 — один уровень mip. У блока 4×4
 * два опорных цвета, остальные — их смеси: опорные сдвигаются той же
 * формулой (`shiftGrass`), смеси следуют сами, индексы пикселей не
 * трогаются. Атлас перекрашивается так в десятки раз быстрее, чем
 * раскодированием и новым сжатием, и без новых потерь сжатия.
 * `colourAt(px, py)` — цвет травы в середине блока или `null`. Возвращает
 * новые байты уровня или `null`, если менять нечего.
 */
export function recolourDistantBlocks(bytes, format, width, height, colourAt, { greens = false, sand = true, albedo = 0.2, gain = null } = {}) {
  if (format !== "DXT1" && format !== "DXT3" && format !== "DXT5") return null;
  if (kernels) {
    const fast = distantBlocksByKernel(bytes, format, width, height, colourAt, { greens, sand, albedo, gain });
    if (fast !== undefined) return fast;
  }
  const blockBytes = format === "DXT1" ? 8 : 16;
  const colourOffset = format === "DXT1" ? 0 : 8;
  const columns = Math.max(1, Math.ceil(width / 4));
  const rows = Math.max(1, Math.ceil(height / 4));
  const count = columns * rows;
  if (bytes.length < count * blockBytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * blockBytes);
  const colours = new Float32Array(count * 2 * 3);
  for (let block = 0; block < count; block += 1)
    for (let end = 0; end < 2; end += 1) colours.set(unpack565(view.getUint16(block * blockBytes + colourOffset + end * 2, true)), (block * 2 + end) * 3);
  const weights = distantWeights(colours, { greens, sand });
  if (!weights.grassRef && !weights.sandRef) return null;
  const targetOf = targetCache({ gain });
  const out = new Uint8Array(bytes.subarray(0, count * blockBytes));
  const write = new DataView(out.buffer);
  let changed = false;
  for (let by = 0; by < rows; by += 1)
    for (let bx = 0; bx < columns; bx += 1) {
      const block = by * columns + bx;
      const touched = [0, 1].some((end) => weights.grass[block * 2 + end] > 0 || weights.sandy[block * 2 + end] > 0);
      if (!touched) continue;
      const colour = colourAt(Math.min(width - 1, bx * 4 + 2), Math.min(height - 1, by * 4 + 2));
      if (!colour) continue;
      const target = targetOf(colour);
      const at = block * blockBytes + colourOffset;
      const c0 = view.getUint16(at, true);
      const c1 = view.getUint16(at + 2, true);
      const next = (value, end) => {
        const index = block * 2 + end;
        const shifted = distantShift(colours[index * 3], colours[index * 3 + 1], colours[index * 3 + 2], index, weights, target, albedo);
        return shifted ? pack565(...shifted) : value;
      };
      let n0 = next(c0, 0);
      let n1 = next(c1, 1);
      let indices = view.getUint32(at + 4, true);
      if (format === "DXT1") {
        /* Режим блока DXT1 задаёт порядок опорных: c0 > c1 — четыре цвета,
           иначе три и прозрачный. Порядок сменился — опорные меняются местами
           вместе с индексами, режим остаётся прежним. */
        if (c0 > c1) {
          if (n0 === n1 && n0 < 0xffff) n0 += 1;
          else if (n0 === n1) n1 -= 1;
          if (n0 < n1) {
            [n0, n1] = [n1, n0];
            indices ^= 0x55555555;
          }
        } else if (n0 > n1) {
          [n0, n1] = [n1, n0];
          /* Три цвета: 0 ↔ 1, смесь (2) и прозрачный (3) — на месте. */
          let swapped = 0;
          for (let pixel = 0; pixel < 16; pixel += 1) {
            const index = (indices >>> (pixel * 2)) & 3;
            swapped |= (index < 2 ? index ^ 1 : index) << (pixel * 2);
          }
          indices = swapped >>> 0;
        }
      }
      if (n0 === c0 && n1 === c1) continue;
      write.setUint16(at, n0, true);
      write.setUint16(at + 2, n1, true);
      write.setUint32(at + 4, indices >>> 0, true);
      changed = true;
    }
  return changed ? out : null;
}

/**
 * Цвет травинки (экземпляра карты травы) в цвете цели — байты `[r, g, b]`.
 * Травинка в игре — лист модели травы × цвет экземпляра, а лист зелёный:
 * цвет экземпляра подбирается так, чтобы травинка целиком (лист × цвет)
 * сдвинулась той же формулой, что трава земли: `sheet` — средний цвет листа
 * модели травы (0…1), `reference` — средняя травинка этой модели по миру
 * (`grassReference` от листа × цвет экземпляра), `instance` — байты штатного
 * цвета экземпляра. Канал, которому не хватает, упирается в 255.
 */
export function grassInstanceColour(instance, target, sheet, reference) {
  const base = instance.map((value) => value / 255);
  const blade = [base[0] * sheet[0], base[1] * sheet[1], base[2] * sheet[2]];
  const shifted = shiftGrass(blade[0], blade[1], blade[2], target, reference);
  return shifted.map((value, channel) => Math.round(clamp(value / Math.max(sheet[channel], 0.02), 0, 1) * 255));
}

/* ------------------------------------------------------------------ *
 * Нативные ядра (15.11.2026)
 * ------------------------------------------------------------------ */

/*
 * Циклы по пикселям и блокам — на Rust (`native/astral-engine/crates/astral-recolor/src/grass.rs`, мост
 * `@modovik/native-rs`, `grassKernels`), байт в байт с кодом выше: он эталон и запасной путь. Подставляет их
 * сторона Node при старте сборки — `setNativeGrassKernels(grassKernels)`; окно с предпросмотром модуль Rust
 * не грузит и считает на JS. Выключатель — `ASTRAL_RECOLOR_KERNELS=0` (читает `@modovik/native-rs`).
 *
 * Что считает приложение, остаётся здесь: цель цвета (`grassTarget`: арктангенс и гипотенуза одного числа на
 * цвет) и `colourAt` — цвет травы в точке мира. Дальний план идёт двумя вызовами ядра: веса и список тронутых
 * блоков → здесь `colourAt` у каждого тронутого → таблица целей и номер цели у блока → сдвиг.
 *
 * Ядро отказало (вход не тот, старый бинарник, ошибка вызова) — этот вызов тихо считает JS.
 */
let kernels = null;
let kernelFallbacks = 0;
let kernelLastError = null;

/** Ядра Rust (`grassKernels` из `@modovik/native-rs`) вместо JS; `null` — снова весь счёт на JS. */
export function setNativeGrassKernels(next) {
  kernels = next ?? null;
  kernelFallbacks = 0;
  kernelLastError = null;
}

/** Работают ли ядра, сколько вызовов ушло на JS из-за отказа ядра и последняя причина. */
export const nativeGrassKernelState = () => ({ active: kernels !== null, fallbacks: kernelFallbacks, lastError: kernelLastError });

function kernelFailed(error) {
  kernelFallbacks += 1;
  kernelLastError = String(error?.message ?? error);
  return undefined;
}

/* Таблица целей для ядра и номер цели по цвету (ключ — как у `targetCache`; цвет подряд тот же — без поиска). */
function targetTable(gain) {
  const rows = [];
  const slots = new Map();
  let lastKey = null;
  let lastSlot = -1;
  return {
    slotOf(colour) {
      const key = Array.isArray(colour) ? (colour[0] << 16) | (colour[1] << 8) | colour[2] : colour;
      if (key === lastKey) return lastSlot;
      let slot = slots.get(key);
      if (slot === undefined) {
        const target = grassTarget(colour, { gain });
        slot = rows.length / 3;
        rows.push(target.gain, target.angle, target.saturation);
        slots.set(key, slot);
      }
      lastKey = key;
      lastSlot = slot;
      return slot;
    },
    table: () => Float64Array.from(rows),
  };
}

/* Ядро может отказаться (`undefined`: шум вместо листа, таблицы дороже счёта) — тогда считает JS, и это не сбой. */
function grassByKernel(rgba, colour) {
  try {
    const out = kernels.recolourGrass(rgba, grassTarget(colour));
    return out === undefined ? undefined : (out ?? rgba);
  } catch (error) {
    return kernelFailed(error);
  }
}

function distantBlocksByKernel(bytes, format, width, height, colourAt, { greens, sand, albedo, gain }) {
  try {
    const weights = kernels.distantBlocksWeights(bytes, format, width, height, greens, sand);
    if (!weights) return null;
    const columns = Math.max(1, Math.ceil(width / 4));
    const slots = new Int32Array(columns * Math.max(1, Math.ceil(height / 4))).fill(-1);
    const targets = targetTable(gain);
    const { touched } = weights;
    for (let at = 0; at < touched.length; at += 1) {
      const block = touched[at];
      const colour = colourAt(Math.min(width - 1, (block % columns) * 4 + 2), Math.min(height - 1, Math.floor(block / columns) * 4 + 2));
      if (colour) slots[block] = targets.slotOf(colour);
    }
    return kernels.distantBlocksShift(bytes, format, width, height, weights, targets.table(), slots, albedo);
  } catch (error) {
    return kernelFailed(error);
  }
}

function distantSandByKernel(rgba, width, height, colourAt, { greens, sand, albedo, gain }) {
  if (rgba.length !== width * height * 4) return undefined;
  try {
    const weights = kernels.distantRgbaWeights(rgba, greens, sand);
    if (weights === undefined) return undefined;
    if (!weights) return rgba;
    const slots = new Int32Array(width * height).fill(-1);
    const targets = targetTable(gain);
    const { touched } = weights;
    for (let at = 0; at < touched.length; at += 1) {
      const index = touched[at];
      const colour = colourAt(index % width, Math.floor(index / width));
      if (colour) slots[index] = targets.slotOf(colour);
    }
    const out = kernels.distantRgbaShift(rgba, weights, targets.table(), slots, albedo);
    return out === undefined ? undefined : (out ?? rgba);
  } catch (error) {
    return kernelFailed(error);
  }
}

/**
 * `grassInstanceColour` на каждый из экземпляров пачкой: `instances` — байты `r, g, b` подряд, `targets` —
 * цель цвета у каждого экземпляра (или `null`: цвет остаётся как был), `sheet` и `reference` — как у
 * `grassInstanceColour`. Возвращает новые `r, g, b` подряд. По одному экземпляру ядро не выигрывает у JS:
 * вызов в Rust дороже самого счёта, поэтому ядро — пачкой.
 */
export function grassInstanceColours(instances, targets, sheet, reference) {
  if (kernels) {
    try {
      const rows = [];
      const slotOf = new Map();
      const slots = new Int32Array(targets.length);
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        if (!target) {
          slots[index] = -1;
          continue;
        }
        let slot = slotOf.get(target);
        if (slot === undefined) {
          slot = rows.length / 3;
          rows.push(target.gain, target.angle, target.saturation);
          slotOf.set(target, slot);
        }
        slots[index] = slot;
      }
      const out = kernels.instanceColours(instances, slots, Float64Array.from(rows), sheet, [reference.y, reference.angle, reference.saturation]);
      if (out !== undefined) return out;
    } catch (error) {
      kernelFailed(error);
    }
  }
  const out = Uint8Array.from(instances);
  for (let index = 0; index < targets.length; index += 1) {
    if (targets[index]) out.set(grassInstanceColour([out[index * 3], out[index * 3 + 1], out[index * 3 + 2]], targets[index], sheet, reference), index * 3);
  }
  return out;
}
