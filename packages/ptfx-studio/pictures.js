/*
 * Готовые значки для вида «Картинка».
 *
 * Значок описан один раз — контурами в поле 24×24 — и рисуется из этого
 * описания дважды: окно мастерской кладёт его на холст (`Path2D`), установщик
 * собирает из него SVG и растрирует в текстуру клона. Двух рисунков одного
 * сердца нет, поэтому в игре оказывается ровно то, что человек видел в окне.
 *
 * Значок белый, с тёмной каймой. Белый — потому что цвет ему даёт правило
 * клона (оттенок умножается на пиксели, и из белого выходит ровно выбранный
 * цвет); кайма — чтобы белый крестик не пропадал на белой стене.
 *
 * Контуры нарисованы здесь, а не взяты из набора иконок: набор приложения —
 * это компоненты окна, а установщику нужны сами кривые.
 */

const VIEW = 24;
/* Поле вокруг значка: кайма не должна упираться в край текстуры. */
const MARGIN = 2.4;

const circle = (cx, cy, r) =>
  `M${cx + r} ${cy}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0z`;

/* Лепестки по кругу: цветок — пять кругов и сердцевина. */
const petals = (count, distance, radius) =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const round = (value) => Math.round(value * 100) / 100;
    return circle(
      round(12 + Math.cos(angle) * distance),
      round(12 + Math.sin(angle) * distance),
      radius,
    );
  });

/*
 * `fill` — залитые контуры, `stroke` — линии (знак доллара), `detail` —
 * тёмные детали поверх заливки (сердцевина цветка): цвет каймы, а не значка.
 */
const glyph = (id, shape) =>
  Object.freeze({
    id,
    fill: [],
    stroke: [],
    detail: [],
    strokeWidth: 2.4,
    ...shape,
  });

export const IMPACT_PICTURE_SHAPES = Object.freeze({
  heart: glyph("heart", {
    fill: [
      "M12 21s-7.5-4.6-10-9.3C.4 8.2 2.2 4 6.2 4c2.2 0 3.9 1.2 5.8 3.3C13.9 5.2 15.6 4 17.8 4c4 0 5.8 4.2 4.2 7.7C19.5 16.4 12 21 12 21z",
    ],
  }),
  cross: glyph("cross", {
    fill: [
      "M5.6 3.5 12 9.9l6.4-6.4 2.1 2.1L14.1 12l6.4 6.4-2.1 2.1L12 14.1l-6.4 6.4-2.1-2.1L9.9 12 3.5 5.6z",
    ],
  }),
  star: glyph("star", {
    fill: [
      "M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8z",
    ],
  }),
  bolt: glyph("bolt", {
    fill: ["M13.5 2 5 13.2h5.6L9.4 22 19 9.8h-5.9z"],
  }),
  skull: glyph("skull", {
    fillRule: "evenodd",
    fill: [
      "M12 2.5c-4.7 0-8.5 3.5-8.5 8 0 2.7 1.3 5 3.5 6.4V20c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5v-3.1c2.2-1.4 3.5-3.7 3.5-6.4 0-4.5-3.8-8-8.5-8zM8.6 9.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm6.8 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zM12 13.8l1.2 2.4h-2.4z",
    ],
  }),
  flower: glyph("flower", {
    fill: [...petals(5, 5.4, 3.7), circle(12, 12, 3)],
    detail: [circle(12, 12, 2.1)],
  }),
  butterfly: glyph("butterfly", {
    fill: [
      "M12 11.4C10.2 5.4 4.2 3.4 2.6 6.4 1.3 9 4.6 12.6 12 12.4z",
      "M12 11.4c1.8-6 7.8-8 9.4-5 1.3 2.6-2 6.2-9.4 6z",
      "M12 12.8c-5 .2-8 2.6-6.8 5.6 1.1 2.8 5.2 1.7 6.8-3.4z",
      "M12 12.8c5 .2 8 2.6 6.8 5.6-1.1 2.8-5.2 1.7-6.8-3.4z",
      "M11.2 7.2h1.6v10.6h-1.6z",
    ],
  }),
  smile: glyph("smile", {
    fillRule: "evenodd",
    fill: [
      "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM8.5 8.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM7.2 13.6h9.6c-.6 2.6-2.5 4.2-4.8 4.2s-4.2-1.6-4.8-4.2z",
    ],
  }),
  dollar: glyph("dollar", {
    stroke: [
      "M16.6 7.6c-.6-1.7-2.3-2.6-4.6-2.6-2.6 0-4.5 1.3-4.5 3.4 0 4.6 9.3 2.2 9.3 7 0 2.2-2 3.6-4.8 3.6-2.5 0-4.4-1.1-5-3",
      "M12 2.6v18.8",
    ],
  }),
  hitmarker: glyph("hitmarker", {
    fill: [
      "M3 4.4 4.4 3l5.3 5.3-1.4 1.4z",
      "M21 4.4 19.6 3l-5.3 5.3 1.4 1.4z",
      "M3 19.6 4.4 21l5.3-5.3-1.4-1.4z",
      "M21 19.6 19.6 21l-5.3-5.3 1.4-1.4z",
    ],
  }),
});

export const findImpactPictureShape = (id) =>
  IMPACT_PICTURE_SHAPES[String(id || "")] || null;

/* Цвет, с которым значок встаёт в зону, когда человек выбрал его впервые:
   сердце — розовое, доллар — зелёный. Дальше цвет его собственный. */
export const IMPACT_PICTURE_COLOURS = Object.freeze({
  heart: "#fb7185",
  cross: "#f8fafc",
  star: "#fde047",
  bolt: "#facc15",
  skull: "#f1f5f9",
  flower: "#f9a8d4",
  butterfly: "#7dd3fc",
  smile: "#fde047",
  dollar: "#4ade80",
  hitmarker: "#f8fafc",
});

/** Геометрия рисования значка в квадрате со стороной `size`. */
export function impactPictureFrame(size) {
  const scale = size / (VIEW + MARGIN * 2);
  return { scale, offset: MARGIN * scale };
}

/** Кайма: толщина линии вокруг значка, в единицах поля 24×24. */
export const IMPACT_PICTURE_OUTLINE = Object.freeze({
  width: 1.5,
  colour: "#000000",
  opacity: 0.55,
});

/**
 * Разметка значка в квадрате со стороной `size` — группа `<g>` без самого
 * `<svg>`: из неё собирают и текстуру одного значка, и лист 4×4, где значок
 * повторён в каждом кадре со своим поворотом.
 * `colour` — заливка (белая по умолчанию: цвет даёт правило клона).
 */
export function impactPictureMarkup(id, size = 256, colour = "#ffffff") {
  const shape = findImpactPictureShape(id);
  if (!shape) throw new Error(`Неизвестная картинка эффекта: ${id}`);
  const { scale, offset } = impactPictureFrame(size);
  const paths = (list, attributes) =>
    list.map((d) => `<path d="${d}" ${attributes}/>`).join("");
  const rule = shape.fillRule ? ` fill-rule="${shape.fillRule}"` : "";
  const outline = IMPACT_PICTURE_OUTLINE;
  const rim =
    `stroke="${outline.colour}" stroke-opacity="${outline.opacity}" ` +
    `stroke-linejoin="round" stroke-linecap="round"`;
  return [
    `<g transform="translate(${offset} ${offset}) scale(${scale})">`,
    /* Кайма под значком: у заливок — обводка, у линий — линия потолще. */
    paths(shape.fill, `fill="none" ${rim} stroke-width="${outline.width * 2}"`),
    paths(
      shape.stroke,
      `fill="none" ${rim} stroke-width="${shape.strokeWidth + outline.width * 2}"`,
    ),
    paths(shape.fill, `fill="${colour}"${rule}`),
    paths(
      shape.stroke,
      `fill="none" stroke="${colour}" stroke-width="${shape.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"`,
    ),
    paths(
      shape.detail,
      `fill="${outline.colour}" fill-opacity="${outline.opacity}"`,
    ),
    "</g>",
  ].join("");
}

/**
 * SVG значка — для установщика: из него sharp делает текстуру клона.
 * `colour` — заливка (белая по умолчанию: цвет даёт правило клона).
 */
export function impactPictureSvg(id, size = 256, colour = "#ffffff") {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    impactPictureMarkup(id, size, colour) +
    "</svg>"
  );
}
