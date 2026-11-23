/*
 * Перекраска крыльев бабочек из листа самого игрока.
 *
 * Лист `ptfx_insects_rgb` ядра — сетка 4×4: мотыльки, монархи, тараканы,
 * окурки, муха, пчела. Монархи — вторая строка, оранжевые крылья с чёрными
 * жилками и белыми точками. Голубые морфо мода `jokerci` — это те же
 * монархи с повёрнутым тоном; здесь поворот делается на машине игрока, из
 * его же листа, и одна функция служит и окну (предпросмотр), и установщику.
 *
 * Трогается только цвет крыла — пиксели с заметной насыщенностью в оранжево-
 * жёлтом тоне. Чёрные жилки, белые точки, тело и усики остаются как были:
 * поэтому перекрашенная бабочка остаётся бабочкой, а не цветным силуэтом.
 * Граница выбора мягкая (smoothstep по насыщенности и тону), иначе на краю
 * крыла вылезала бы оранжевая кайма.
 *
 * «Нейтральный» лист — крылья светло-серые с той же светотенью: их цвет
 * задают кадры правила (`Repaint` помощника умножает цвет на максимальный
 * канал кадра), и тогда бабочку можно сделать любого цвета.
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hueToRgb(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (((h % 360) + 360) % 360) / 360;
  return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3)];
}

/** Насколько пиксель — оранжевое крыло: 0…1. */
function wingWeight(h, s, l) {
  if (l < 0.08 || l > 0.97) return 0;
  const hueDistance = Math.min(Math.abs(h - 32), 360 - Math.abs(h - 32));
  return smoothstep(0.18, 0.34, s) * (1 - smoothstep(24, 40, hueDistance));
}

/**
 * Одна строка кадров листа отдельным листом: 4×4 → 4×1.
 * `rgba` — Uint8Array/Uint8ClampedArray ширины `width` и высоты `height`.
 */
export function cropSheetRow(rgba, width, height, { rows, row }) {
  if (!Number.isInteger(rows) || rows < 1 || height % rows !== 0)
    throw new RangeError("Лист не делится на строки кадров.");
  if (!Number.isInteger(row) || row < 0 || row >= rows)
    throw new RangeError("Нет такой строки кадров.");
  const rowHeight = height / rows;
  const start = row * rowHeight * width * 4;
  return {
    rgba: new Uint8Array(rgba.slice(start, start + rowHeight * width * 4)),
    width,
    height: rowHeight,
  };
}

/**
 * Перекрашивает крылья. `variant` — `{ hue, saturation, lightness }` или
 * `{ neutral: true }`. Возвращает новый массив, исходный не трогает.
 */
export function recolourWings(rgba, variant) {
  const out = new Uint8Array(rgba.length);
  const neutral = variant?.neutral === true;
  const hue = Number(variant?.hue) || 0;
  const saturation = Number.isFinite(Number(variant?.saturation)) ? Number(variant.saturation) : 1;
  const lightness = Number.isFinite(Number(variant?.lightness)) ? Number(variant.lightness) : 1;
  for (let index = 0; index < rgba.length; index += 4) {
    const r = rgba[index] / 255;
    const g = rgba[index + 1] / 255;
    const b = rgba[index + 2] / 255;
    out[index + 3] = rgba[index + 3];
    const [h, s, l] = rgbToHsl(r, g, b);
    const weight = rgba[index + 3] ? wingWeight(h, s, l) : 0;
    if (weight <= 0) {
      out[index] = rgba[index];
      out[index + 1] = rgba[index + 1];
      out[index + 2] = rgba[index + 2];
      continue;
    }
    let target;
    if (neutral) {
      /* Серый по максимальному каналу — той же мерой, какой кадры правила
         потом красят его цветом: светотень крыла сохраняется один в один. */
      const value = Math.max(r, g, b);
      const grey = clamp01(0.12 + value * 0.9);
      target = [grey, grey, grey];
    } else {
      target = hslToRgb(hue, clamp01(s * saturation), clamp01(l * lightness));
    }
    out[index] = Math.round((r + (target[0] - r) * weight) * 255);
    out[index + 1] = Math.round((g + (target[1] - g) * weight) * 255);
    out[index + 2] = Math.round((b + (target[2] - b) * weight) * 255);
  }
  return out;
}

/**
 * Лист одного варианта бабочек из листа ядра: строка монархов, перекрашенная
 * под вариант. `sheet` — описание листа (`BUTTERFLY_SHEET`).
 */
export function butterflySheet(rgba, width, height, sheet, variant) {
  const row = cropSheetRow(rgba, width, height, sheet);
  return { ...row, rgba: variant && !variant.identity ? recolourWings(row.rgba, variant) : row.rgba };
}

/**
 * Лист вида для чужого движения (`PARTICLE_LOOK_SHEETS`): лист ядра как есть
 * или одна его строка (`row` из `rows`). Те же пиксели и в окне, и у
 * установщика.
 */
export function lookSheet(rgba, width, height, copy) {
  if (Number.isInteger(copy?.row)) return cropSheetRow(rgba, width, height, { rows: copy.rows, row: copy.row });
  return { rgba: new Uint8Array(rgba), width, height };
}

/*
 * СТЕКЛО ЛАМПЫ
 *
 * Стекло фонаря светится своим шейдером (`emissivemultiplier` 16 у
 * `prop_streetlight_01`), а цвет берёт из встроенной текстуры — у штатных
 * фонарей это оранжево-жёлтое пятно атласа. Сменив цвет света, игра так и
 * оставляла натриевое стекло: зелёный фонарь светил из оранжевой лампы
 * (снято 28.09.2026). Здесь стекло красится в цвет света: рисунок яркости
 * текстуры (блики, рифление плафона) остаётся, меняется только цвет —
 * каждый пиксель берёт цвет света при своей яркости (по максимальному
 * каналу, как кадры правил частиц красят нейтральный лист).
 */
export function tintGlass(rgba, hex) {
  const value = String(hex || "").replace("#", "");
  const target = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  if (target.some((channel) => !Number.isFinite(channel))) throw new TypeError(`Цвет «${hex}» — не #RRGGBB.`);
  const peak = Math.max(...target, 1e-6);
  const unit = target.map((channel) => channel / peak);
  const out = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    const brightness = Math.max(rgba[index], rgba[index + 1], rgba[index + 2]);
    out[index] = Math.round(unit[0] * brightness);
    out[index + 1] = Math.round(unit[1] * brightness);
    out[index + 2] = Math.round(unit[2] * brightness);
    out[index + 3] = rgba[index + 3];
  }
  return out;
}
