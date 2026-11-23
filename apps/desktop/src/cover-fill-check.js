/*
 * Проверка обложки «как её покажет окно» (13.11.2026, владелец: «миникарта и большая карта … обрезал … зоны тоже … показываются не полностью»).
 *
 * Страница мода увеличивает кадр до «рамки рисунка», а рисунком считает только точки, заметно отличающиеся от поля (`@modovik/gfx/frame-fill`). У тёмных карт и панелей такая рамка меньше самого содержимого,
 * и окно режет остальное. Окно уже у игроков, поэтому печь меряет обложку тем же расчётом и не принимает кадр, у которого окно показа отрезает настоящее содержимое: границы содержимого берутся с низким
 * порогом (отличие от матового поля больше 6), допуск — одна сотая кадра. Причина — словами, с числами, чтобы по журналу было видно, что и с какой стороны уйдёт.
 *
 * Читает PNG через `sharp`; расчёт — чистый (`frame-fill.js`), его совпадение с кодом окна держит `tests/cover-frame-fill.test.js`.
 */

import sharp from "sharp";
import {
  contentBox,
  hiddenContent,
  measureCrop,
  sampleSize,
  windowCuts,
} from "@modovik/gfx/frame-fill";
import {
  workshopMatteLevel,
  workshopMatteRgba,
} from "@modovik/gfx/workshop-matte";

/** Сцена страницы мода (ширина : высота), на которой окно увеличивает кадр: 1,35 : 1. */
export const WINDOW_RATIO = 1.35;
/** Виды, чьи обложки — тёмная фигура на матовом поле (карты, панель, зоны): их окно может обрезать. */
export const WINDOW_FIT_KINDS = new Set([
  "minimap",
  "large-map",
  "large-map-vector",
  "zones",
]);
/** Порог границ содержимого (отличие от поля по каналу) и допуск обрезки (доля кадра). */
export const CONTENT_DELTA = 6;
export const CUT_TOLERANCE = 0.01;
/** Сторона копии, по которой берутся границы содержимого (мельче — тонкие линии теряются). */
const CONTENT_SIDE = 400;

const SIDES = Object.freeze({
  top: "сверху",
  right: "справа",
  bottom: "снизу",
  left: "слева",
});
const percent = (value) => `${Math.round(value * 1000) / 10} %`;

async function rgbaOf(buffer, width, height) {
  const { data } = await sharp(buffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * Кадр без поля (прозрачный край) — на матовом поле обложек, для ворот печи: они судят «пусто / темно / плоско» по картинке на поле,
 * как судили её до того, как поле у карт, мини-карты и зон стало прозрачным. Непрозрачный кадр возвращается как есть. Сам файл обложки
 * не меняется — это только копия для проверки.
 * @param {Uint8Array|Buffer} bytes PNG обложки
 * @returns {Promise<Uint8Array|Buffer>}
 */
export async function overMatte(bytes) {
  try {
    const buffer = Buffer.from(bytes);
    const meta = await sharp(buffer).metadata();
    if (!meta.hasAlpha || !meta.width || !meta.height) return bytes;
    const field = workshopMatteRgba(meta.width, meta.height);
    return await sharp(
      Buffer.from(field.buffer, field.byteOffset, field.byteLength),
      { raw: { width: meta.width, height: meta.height, channels: 4 } },
    )
      .composite([{ input: buffer }])
      .png()
      .toBuffer();
  } catch {
    return bytes;
  }
}

/**
 * Что покажет окно на сцене `ratio` и режет ли оно содержимое.
 * @param {Uint8Array|Buffer} bytes PNG обложки
 * @returns {Promise<{ ok: boolean, reason: string, cut: object, cuts: object|null, mode: string, inset: object|null }>}
 */
export async function windowFit(
  bytes,
  {
    ratio = WINDOW_RATIO,
    tolerance = CUT_TOLERANCE,
    delta = CONTENT_DELTA,
  } = {},
) {
  try {
    const buffer = Buffer.from(bytes);
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height)
      return {
        ok: true,
        reason: "",
        cut: {},
        cuts: null,
        mode: "",
        inset: null,
      };
    const small = sampleSize(meta.width, meta.height);
    const crop = measureCrop(
      await rgbaOf(buffer, small.width, small.height),
      small.width,
      small.height,
      small.aspect,
    );
    const cuts = windowCuts(crop, ratio);
    /* Кадр без поля (прозрачный край): окно меряет его по непрозрачным точкам и показывает их все — резать нечего. */
    if (crop.transparent)
      return {
        ok: true,
        reason: "",
        cut: {},
        cuts,
        mode: cuts?.mode || "",
        inset: crop.inset,
      };
    const scale = CONTENT_SIDE / Math.max(meta.width, meta.height);
    const [width, height] = [
      Math.max(8, Math.round(meta.width * scale)),
      Math.max(8, Math.round(meta.height * scale)),
    ];
    /* Поле — матовое поле обложек (пятно света посередине): обложки карт и панелей рисуются на нём. Иное поле (медианный цвет периметра) — как у окна. */
    const onMatte =
      crop.field &&
      Math.abs(crop.field[0] - workshopMatteLevel(0, 0, 1, 1) * 255) <= 6;
    /* Картинка во весь кадр без поля (небо, сцена): окно показывает её «как есть» по сцене (`cover`), как каждую обложку галереи, — это не та беда, которую ловит проверка. */
    if (cuts?.mode !== "fill" && !onMatte)
      return {
        ok: true,
        reason: "",
        cut: {},
        cuts,
        mode: cuts?.mode || "",
        inset: crop.inset,
      };
    const box = contentBox(await rgbaOf(buffer, width, height), width, height, {
      delta,
      field: onMatte ? (x, y) => workshopMatteLevel(x, y, 1, 1) * 255 : null,
    });
    const { ok, cut } = hiddenContent(cuts, box, { tolerance });
    const lost = Object.entries(cut).filter(([, value]) => value > tolerance);
    const reason = ok
      ? ""
      : `окно страницы мода увеличит кадр и отрежет содержимое: ${lost.map(([side, value]) => `${SIDES[side]} ${percent(value)}`).join(", ")} кадра ` +
        `(рамка рисунка у окна — ${
          crop.inset
            ? Object.entries(crop.inset)
                .map(([side, value]) => `${SIDES[side]} ${percent(value)}`)
                .join(", ")
            : "нет"
        }; тёмное содержимое окно рисунком не считает)`;
    return { ok, reason, cut, cuts, mode: cuts?.mode || "", inset: crop.inset };
  } catch {
    /* Замер не вышел — кадр не отклоняется из-за него: это проверка сверх ворот, а не их замена. */
    return { ok: true, reason: "", cut: {}, cuts: null, mode: "", inset: null };
  }
}
