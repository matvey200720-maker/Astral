// Правка листа семейства огня и взрывов: яркость, потом оттенок, потом плотность.
// Файл самодостаточный (без импортов): его целиком везёт поток перекраски окна.

// Пиксели без оттенка: каждый канал умножается на яркость, альфа — на плотность.
// Идёт с последнего пикселя к первому (пиксели друг от друга не зависят).
function paintPlain(src, dst, from, to, gain, alphaGain) {
  let left = Math.ceil((to - from) / 4);
  while (left-- > 0) {
    const at = from + left * 4;
    dst[at + 3] = src[at + 3] * alphaGain;
    dst[at + 2] = src[at + 2] * gain;
    dst[at + 1] = src[at + 1] * gain;
    dst[at] = src[at] * gain;
  }
}

// Пиксели с оттенком: после яркости каждый канал сдвигается к «яркость пикселя × цвет оттенка».
// Яркость пикселя считается один раз, до сдвига, по уже умноженным каналам.
function paintTinted(src, dst, from, to, gain, alphaGain, tint, strength) {
  const [tintR, tintG, tintB] = tint;
  let left = Math.ceil((to - from) / 4);
  while (left-- > 0) {
    const at = from + left * 4;
    const r = src[at] * gain;
    const g = src[at + 1] * gain;
    const b = src[at + 2] * gain;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    dst[at + 3] = src[at + 3] * alphaGain;
    dst[at + 2] = b + (luma * tintB - b) * strength;
    dst[at + 1] = g + (luma * tintG - g) * strength;
    dst[at] = r + (luma * tintR - r) * strength;
  }
}

// rgba — пиксели листа по четыре значения; rgb — цвет оттенка [r, g, b];
// settings — { remove, brightness, opacity, tintStrength }; четвёртый необязательный
// параметр — формат листа (по умолчанию "DXT5"). Листу без альфы (DXT1) плотность
// уходит в яркость, у остальных — в альфу.
export function tintFamilyPixels(rgba, rgb, settings, ...more) {
  const size = rgba.length;
  const result = new Uint8ClampedArray(size);
  if (settings.remove === true) return result;

  const [tintR, tintG, tintB] = rgb;
  const [format = "DXT5"] = more;
  const strength = settings.tintStrength;
  const opaque = format === "DXT1";
  const gain = opaque ? settings.brightness * settings.opacity : settings.brightness;
  const alphaGain = opaque ? 1 : settings.opacity;

  // Целые пиксели идут быстрым путём, неполный хвост (если лист обрезан) — тем же путём
  // отдельно: недостающие значения читаются как undefined и дают NaN, запись за краем пуста.
  const whole = size - (size % 4);
  for (const [from, to] of [[0, whole], [whole, size]]) {
    if (strength > 0) paintTinted(rgba, result, from, to, gain, alphaGain, [tintR, tintG, tintB], strength);
    else paintPlain(rgba, result, from, to, gain, alphaGain);
  }
  return result;
}
