/*
 * Шрифты надписей меток — как их называет холст.
 *
 * Контракт знает только выбор (`CLIMB_FONTS`), а как шрифт зовётся в CSS и
 * каким начертанием его брать — здесь, рядом с холстом, который им пишет.
 * Все шрифты — системные шрифты Windows с кириллицей: GTA V идёт только на
 * Windows, и текстура рисуется на той же машине, где стоит игра. Запасные
 * имена в конце списка — для песочницы в браузере на другой системе, чтобы
 * надпись там была похожей, а не пустой.
 */

import { ownFontStack } from "../emblem/own-font.js";

export const CLIMB_FONT_FACES = Object.freeze({
  impact: Object.freeze({
    family: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
    weight: "400",
  }),
  bahnschrift: Object.freeze({
    family: 'Bahnschrift, "DIN Alternate", "Arial Narrow", sans-serif',
    weight: "700",
    stretch: "condensed",
  }),
  "arial-black": Object.freeze({
    family: '"Arial Black", "Arial Bold", Gadget, sans-serif',
    weight: "900",
  }),
  "segoe-black": Object.freeze({
    family: '"Segoe UI Black", "Segoe UI", system-ui, sans-serif',
    weight: "900",
  }),
  franklin: Object.freeze({
    family:
      '"Franklin Gothic Medium", "Franklin Gothic", "Arial Narrow", sans-serif',
    weight: "400",
  }),
  consolas: Object.freeze({
    family: 'Consolas, "Courier New", ui-monospace, monospace',
    weight: "700",
  }),
  georgia: Object.freeze({
    family: 'Georgia, "Times New Roman", serif',
    weight: "700",
  }),
  comic: Object.freeze({
    family: '"Comic Sans MS", "Comic Neue", cursive',
    weight: "700",
  }),
  ink: Object.freeze({
    family: '"Ink Free", "Segoe Print", cursive',
    weight: "400",
  }),
  script: Object.freeze({
    family: '"Segoe Script", "Brush Script MT", cursive',
    weight: "700",
  }),
});

/*
 * Свой шрифт человека приходит ключом `custom:<файл в хранилище окна>` (`climbFontKey` контракта): имя семейства
 * даёт общий орган своих шрифтов, а запасным — Impact, чтобы надпись без файла осталась читаемой.
 */
const CUSTOM_PREFIX = "custom:";
const customFace = (asset) =>
  Object.freeze({ family: ownFontStack(asset, CLIMB_FONT_FACES.impact.family), weight: "400" });

export const climbFontFace = (id) =>
  String(id).startsWith(CUSTOM_PREFIX) ? customFace(String(id).slice(CUSTOM_PREFIX.length)) : CLIMB_FONT_FACES[id] || CLIMB_FONT_FACES.impact;

/** Шрифт в записи `CanvasRenderingContext2D.font`. */
export const climbCanvasFont = (id, pixels) => {
  const face = climbFontFace(id);
  return `${face.weight} ${Math.max(1, pixels).toFixed(2)}px ${face.family}`;
};

/**
 * Поставить шрифт холсту целиком — с шириной начертания.
 *
 * Ширину (`condensed` у Bahnschrift) сокращённая запись `font` в холсте
 * принимает не везде, а свойство `fontStretch` — там, где есть. Где его нет,
 * надпись просто шире, а не пустая.
 */
export function applyClimbFont(context, id, pixels) {
  const face = climbFontFace(id);
  context.font = climbCanvasFont(id, pixels);
  if ("fontStretch" in context) context.fontStretch = face.stretch || "normal";
}

/** Шрифт для CSS — плитка выбора шрифта пишет своё имя им же. */
export const climbCssFont = (id) => {
  const face = climbFontFace(id);
  return {
    fontFamily: face.family,
    fontWeight: face.weight,
    fontStretch: face.stretch || "normal",
  };
};
