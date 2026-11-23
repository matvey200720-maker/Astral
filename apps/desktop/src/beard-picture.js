/*
 * Рисунок штатной бороды для окна «На что поставить?» (17.11.2026, кадр Electron): борода занимает на развёртке головы малую часть листа — у части номеров десятки пикселей из 512, — и на плитке
 * и в «Будет» рисунок тонул в тёмном поле. Отдельный модуль, чтобы поток запекания (`game-beards-bake.js`) не тянул за собой чтение архивов игры.
 */

import sharp from "sharp";

/* Плитка: сторона квадрата, поле вокруг обрезанного рисунка и порог альфы, ниже которого пиксель считается пустым. */
const TILE_SIDE = 160;
const TILE_MARGIN = 12;
const TRIM_ALPHA = 4;

/**
 * Рисунок плитки (17.11.2026, кадр Electron): борода занимает на развёртке головы малую часть листа — у части номеров десятки пикселей из 512, — и на плитке рисунок тонул в тёмном поле. Лист
 * обрезается по границам непрозрачного (альфа-канал, `trim`), вписывается в квадрат `side` с полем `margin` и остаётся RGBA. Пустой лист (нет ни одного непрозрачного пикселя) — как есть, вписанный в квадрат.
 */
export async function beardTilePicture(
  rgba,
  width,
  height,
  { side = TILE_SIDE, margin = TILE_MARGIN } = {},
) {
  const sheet = sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 },
  });
  const inner = Math.max(1, side - margin * 2);
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  let crop = null;
  try {
    const { info } = await sheet
      .clone()
      .extractChannel(3)
      .trim({ threshold: TRIM_ALPHA })
      .toBuffer({ resolveWithObject: true });
    crop = {
      left: -info.trimOffsetLeft,
      top: -info.trimOffsetTop,
      width: info.width,
      height: info.height,
    };
  } catch {
    /* Нечего обрезать (лист прозрачный целиком): рисунок остаётся целым листом. */
  }
  return (crop ? sheet.clone().extract(crop) : sheet.clone())
    .resize(inner, inner, { fit: "contain", background: clear })
    .extend({
      top: margin,
      bottom: side - inner - margin,
      left: margin,
      right: side - inner - margin,
      background: clear,
    })
    .png()
    .toBuffer();
}
