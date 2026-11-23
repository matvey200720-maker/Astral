// Квады подписей для видеокарты: одна запись на глиф, все рисуются одним instanced-вызовом.

// Запись глифа: 4 угла квада, 4 UV, цвет RGBA, цвет ореола RGBA, порог ореола.
export const LABEL_STRIDE = 17;

export function labelInstances(labels, atlas) {
  const list = Array.isArray(labels) ? labels : [...labels];
  const total = list.length;
  const scales = new Float64Array(total);
  const shifts = new Float64Array(total);
  const texts = new Array(total);

  // Первый проход: масштаб, текст, число квадов и (для center/end) ширина подписи.
  let quads = 0;
  for (let index = 0; index < total; index++) {
    const label = list[index];
    const scale = label.size / atlas.fontSize;
    const text = String(label.text || "");
    const align = label.align;
    const measure = align === "center" || align === "end";
    const glyphs = atlas.glyphs;
    let advanceSum = 0;
    for (const char of text) {
      const glyph = glyphs.get(char);
      if (!glyph) continue;
      if (!glyph.empty) quads++;
      if (measure) advanceSum += glyph.advance ?? 0;
    }
    scales[index] = scale;
    texts[index] = text;
    shifts[index] =
      align === "center" ? (advanceSum * scale) / 2 : align === "end" ? advanceSum * scale : 0;
  }

  const data = new Float32Array(quads * LABEL_STRIDE);
  let at = 0;
  for (let index = 0; index < total; index++) {
    const text = texts[index];
    if (text === "") continue;
    const label = list[index];
    const scale = scales[index];
    const glyphs = atlas.glyphs;
    const radius = atlas.radius;
    const side = atlas.cell * scale;
    const baseY = label.y;

    let red = 1;
    let green = 1;
    let blue = 1;
    let alpha = 1;
    const colour = label.colour;
    if (colour != null) {
      red = colour[0] ?? 1;
      green = colour[1] ?? 1;
      blue = colour[2] ?? 1;
      alpha = colour[3] ?? 1;
    }

    let haloRed = 0;
    let haloGreen = 0;
    let haloBlue = 0;
    let haloAlpha = 0;
    let threshold = 0;
    const halo = label.halo;
    if (halo) {
      haloAlpha = 1;
      const haloColour = halo.colour;
      if (haloColour != null) {
        haloRed = haloColour[0] ?? 0;
        haloGreen = haloColour[1] ?? 0;
        haloBlue = haloColour[2] ?? 0;
        haloAlpha = haloColour[3] ?? 1;
      }
      // Порог стоит там, где в поле расстояний заканчивается обводка шириной halo.width.
      threshold = Math.max(0, 0.5 - halo.width / scale / (2 * radius));
    }

    let pen = label.x - shifts[index];
    for (const char of text) {
      const glyph = glyphs.get(char);
      if (!glyph) continue;
      if (!glyph.empty) {
        const left = pen + (glyph.bearingX - radius) * scale;
        const top = baseY - (glyph.bearingY + radius) * scale;
        data[at] = left;
        data[at + 1] = top;
        data[at + 2] = left + side;
        data[at + 3] = top + side;
        data[at + 4] = glyph.u0;
        data[at + 5] = glyph.v0;
        data[at + 6] = glyph.u1;
        data[at + 7] = glyph.v1;
        data[at + 8] = red;
        data[at + 9] = green;
        data[at + 10] = blue;
        data[at + 11] = alpha;
        data[at + 12] = haloRed;
        data[at + 13] = haloGreen;
        data[at + 14] = haloBlue;
        data[at + 15] = haloAlpha;
        data[at + 16] = threshold;
        at += LABEL_STRIDE;
      }
      pen += (glyph.advance ?? 0) * scale;
    }
  }

  return { data, count: quads };
}
