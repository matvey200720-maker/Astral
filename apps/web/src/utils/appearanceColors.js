export function normalizeHexColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || "")) return value.toUpperCase();
  return (
    {
      ice: "#70C5FF",
      violet: "#AF7EFF",
      jade: "#48E0B2",
      ember: "#FF805B",
    }[value] || "#70C5FF"
  );
}
export function hexToRgbChannels(value) {
  const hex = normalizeHexColor(value).slice(1);
  return `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}`;
}

export function colorLuminance(value) {
  const hex = normalizeHexColor(value).slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function geometryEdgeChannels(startColor, endColor) {
  const average = (colorLuminance(startColor) + colorLuminance(endColor)) / 2;
  return average < 0.42 ? "244, 248, 255" : "18, 25, 37";
}

export const gradientPresetColors = {
  cosmic: "#5B7EFF",
  aurora: "#22D3AA",
  sunset: "#FF7073",
  neutral: "#C7CFDB",
};

export const gradientPresetEndColors = {
  cosmic: "#9453FF",
  aurora: "#438BFF",
  sunset: "#BD5BFF",
  neutral: "#697589",
};

export function gradientPaletteFromHex(value) {
  const hex = normalizeHexColor(value).slice(1);
  const red = parseInt(hex.slice(0, 2), 16) / 255;
  const green = parseInt(hex.slice(2, 4), 16) / 255;
  const blue = parseInt(hex.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (maximum + minimum) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;

  const channels = (nextHue, nextSaturation, nextLightness) => {
    const chroma = (1 - Math.abs(2 * nextLightness - 1)) * nextSaturation;
    const section = (((nextHue % 360) + 360) % 360) / 60;
    const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
    let nextRed = 0;
    let nextGreen = 0;
    let nextBlue = 0;
    if (section < 1) [nextRed, nextGreen] = [chroma, intermediate];
    else if (section < 2) [nextRed, nextGreen] = [intermediate, chroma];
    else if (section < 3) [nextGreen, nextBlue] = [chroma, intermediate];
    else if (section < 4) [nextGreen, nextBlue] = [intermediate, chroma];
    else if (section < 5) [nextRed, nextBlue] = [intermediate, chroma];
    else [nextRed, nextBlue] = [chroma, intermediate];
    const match = nextLightness - chroma / 2;
    return `${Math.round((nextRed + match) * 255)}, ${Math.round((nextGreen + match) * 255)}, ${Math.round((nextBlue + match) * 255)}`;
  };

  const safeSaturation = Math.max(0.58, saturation);
  return {
    a: channels(hue, safeSaturation, Math.max(0.54, lightness)),
    b: channels(hue + 48, Math.max(0.62, safeSaturation), 0.58),
    c: channels(hue - 34, Math.max(0.56, safeSaturation), 0.62),
  };
}
