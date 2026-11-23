/*
 * Обложка пака одежды из обложек всех его вещей (круг 7, 30.10.2026).
 *
 * Владелец: «в одежде тоже ты допустил некоторые пропуски… как ганпак идут». У пака «Сумка Cambridge» пять сумок, а обложкой стояла одна — первая
 * (`outfitPackOf` брал `media.cover` первой вещи). Теперь обложка пака — все его вещи на одном листе по тому же правилу, что у ганпака
 * (`@modovik/gunpack/collage-layout`): все вещи, крупно, ровные зазоры, один над другим или рядами; одна вещь — во всю карточку. Фон прозрачный.
 *
 * Обложки вещей — прозрачные PNG/WebP одной вещи на кадре (`clothing-shooter`); их рамка по непрозрачным пикселям (альфа ≥ 40, без 0,3 % случайных
 * пятен по краям) считается здесь, лист собирается `sharp` — без окна и без WebGL.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { layoutCollage, trimmedBounds } from "@modovik/gunpack/collage-layout";
import { transparentCover } from "./cover-unbake.js";

export const PACK_COVER = Object.freeze({ width: 1200, height: 675 });

/** Пиксель вещи — альфа не ниже этого (как у `collage.js` ганпака). */
const ALPHA_MIN = 40;

/** Вещь на кадре: непрозрачная рамка и её пиксели, `null`, если кадр пуст. Старые кадры лежат на матовом поле мастерской — оно вычитается (`cover-unbake.js`). */
async function garmentOf(bytes) {
  const clear = await transparentCover(bytes);
  const { data, info } = await sharp(clear, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const columns = new Array(info.width).fill(0);
  const rows = new Array(info.height).fill(0);
  for (let y = 0; y < info.height; y += 1)
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < ALPHA_MIN) continue;
      columns[x] += 1;
      rows[y] += 1;
    }
  const across = trimmedBounds(columns);
  const down = trimmedBounds(rows);
  if (!across || !down) return null;
  const crop = { left: across[0], top: down[0], width: across[1] - across[0] + 1, height: down[1] - down[0] + 1 };
  const pixels = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(crop)
    .png()
    .toBuffer();
  return { width: crop.width, height: crop.height, pixels };
}

/**
 * Обложки вещей `[Uint8Array|Buffer]` по порядку показа → PNG пака `{ bytes, shown, empty, same }`: `shown` — сколько вещей на листе, `empty` — сколько кадров были
 * пустыми, `same` — сколько совпали с уже стоящим на листе (одна вещь для обоих полов); на лист они не попали. Нет ни одной вещи — `null`.
 */
export async function composeClothingPackCover(covers, { width = PACK_COVER.width, height = PACK_COVER.height } = {}) {
  const items = [];
  const seen = new Set();
  let empty = 0;
  let same = 0;
  for (const bytes of covers) {
    const garment = bytes?.length ? await garmentOf(bytes).catch(() => null) : null;
    if (!garment) {
      empty += 1;
      continue;
    }
    /* Мужская и женская копия вещи рисуются одним кадром: повтор на листе — не вещь, а «повторка» (владелец: «за повторки трясусь»). */
    const key = createHash("sha256").update(garment.pixels).digest("hex");
    if (seen.has(key)) {
      same += 1;
      continue;
    }
    seen.add(key);
    items.push(garment);
  }
  if (!items.length) return null;
  /* Вещь одна — во всю карточку; несколько — один масштаб на все, ряды подбираются перебором, как у стволов. */
  const layout = layoutCollage(items.map((item) => ({ width: item.width, height: item.height })), { width, height });
  const layers = [];
  for (const place of layout.placed) {
    const item = items[place.index];
    layers.push({
      input: await sharp(item.pixels).resize(Math.max(1, Math.round(place.w)), Math.max(1, Math.round(place.h)), { fit: "fill", kernel: "lanczos3" }).png().toBuffer(),
      left: Math.round(place.x),
      top: Math.round(place.y),
    });
  }
  const bytes = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
  return { bytes: new Uint8Array(bytes), shown: items.length, empty, same };
}
