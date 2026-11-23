/*
 * Цвет обычного прицела — так, как его красит игра.
 *
 * Обычный прицел GTA красит одной краской: `Colour.Colourise(reticle, r, g,
 * b, a)` ставит клипу сдвиг цвета (r − 255, g − 255, b − 255) при множителе
 * 1. Поэтому заливка прицела в файле белая (становится ровно выбранным
 * цветом), а обводка лежит там заранее сдвинутой: (обводка − цвет + 255).
 * Сдвиг только темнит, и в файле канал не бывает больше 255, поэтому обводка
 * в игре не светлее прицела ни в одном канале: белая обводка у чёрного
 * прицела выйдет чёрной. Превью обязано показать ровно это, а не желаемое.
 *
 * Снайперку игра не перекрашивает: её цвета лежат в файле как есть.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

export function normalizeHex(value, fallback = "#ffffff") {
  const text = String(value || "").trim();
  if (HEX.test(text)) return text.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return fallback;
}

export function hexToRgb(value, fallback = "#ffffff") {
  const hex = normalizeHex(value, fallback);
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
}

export const rgbToHex = (channels) =>
  `#${channels.map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`;

/** Канал обводки, как он лежит в файле: (обводка − цвет + 255), в границах байта. */
export function storedOutline(outline, colour) {
  const target = hexToRgb(outline, "#000000");
  const base = hexToRgb(colour);
  return target.map((channel, index) =>
    clampChannel(channel - base[index] + 255),
  );
}

/** Что сделает с каналами файла `Colourise` выбранным цветом. */
export function colourise(stored, colour) {
  const base = hexToRgb(colour);
  return rgbToHex(stored.map((channel, index) => channel + base[index] - 255));
}

/**
 * Цвета обычного прицела в игре.
 *
 * `state`: "plain" — обычный, "target" — на цели (игра красит прицел цветом
 * цели, если он включён). Возвращает заливку, обводку и то, совпала ли
 * обводка с выбранной: не совпала — значит, выбранный цвет светлее прицела,
 * и игра его так не покажет.
 */
export function ordinaryGameColours(config, state = "plain") {
  const colour = normalizeHex(config.color, "#f4fff4");
  const outline = normalizeHex(config.outlineColor, "#101419");
  const onTarget = state === "target" && config.targetColorEnabled !== false;
  const paint = onTarget ? normalizeHex(config.targetColor, "#ff6b7d") : colour;
  const stored = storedOutline(outline, colour);
  const plainOutline = colourise(stored, colour);
  return {
    fill: paint,
    outline: colourise(stored, paint),
    outlineExact: plainOutline === outline,
    plainOutline,
  };
}
