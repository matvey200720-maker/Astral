// Карты игры → вид, который ждёт three.js: двухканальная нормаль → XYZ в RGB,
// серый блеск → шероховатость в зелёном канале.

// Откуда брать X нормали: у DXT5 — из альфы, у ATI2 (BC5) и всех прочих — из красного.
const X_CHANNEL = new Map([["DXT5", 3]]);

const ROUGHNESS_FROM_GLOSS = 0.7; // подобрано сравнением с кадром игры

const toUnit = (value) => (value / 255) * 2 - 1;
const fromUnit = (value) => Math.round((value + 1) * 127.5);

// Выход — Uint8ClampedArray: обрезка в 0…255 при записи, NaN → 0, запись за концом молча теряется.
export function normalMapRgba(rgba, format = "") {
  const length = rgba.length;
  const out = new Uint8ClampedArray(length);
  const xAt = X_CHANNEL.get(format) ?? 0;
  for (let i = 0; i < length; i += 4) {
    const x = toUnit(rgba[i + xAt]);
    const y = toUnit(rgba[i + 1]);
    const zz = 1 - x * x - y * y;
    out[i] = fromUnit(x);
    out[i + 1] = fromUnit(y);
    out[i + 2] = fromUnit(zz < 0 ? 0 : Math.sqrt(zz));
    out[i + 3] = 255;
  }
  return out;
}

export function specularRoughnessRgba(rgba) {
  const length = rgba.length;
  const out = new Uint8ClampedArray(length);
  for (let i = 0; i < length; i += 4) {
    const roughness = Math.min(1, Math.max(0, 1 - ROUGHNESS_FROM_GLOSS * (rgba[i] / 255)));
    out[i] = 0;
    out[i + 1] = Math.round(roughness * 255);
    out[i + 2] = 0;
    out[i + 3] = 255;
  }
  return out;
}
