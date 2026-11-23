/*
 * «Бороды игры», запекание (Ц3в, Б2, 16.11.2026): борода-вещь → лист штатной бороды 512×512 (плоский рисунок на развёртке головы) и «Будет» для окна. Только чтение игры и каталога.
 * Сетки головы и бороды читает `readBeardBakeInputs` (`clothing-character.js`), луч от кожи вдоль нормали — `bakeBeardSheet` (`@modovik/clothing/beard-bake`). В DXT5 лист сжимает установка (Б3).
 */

import { bakeBeardSheet } from "@modovik/clothing/beard-bake";
import { gameBeardKey } from "@modovik/clothing/game-beards";
import sharp from "sharp";
import { readBeardBakeInputs } from "./clothing-character.js";
import { beardTilePicture } from "./beard-picture.js";

/* Борода, у которой больше этой доли не встала на голову, — предупреждение окну: «часть бороды ниже подбородка в рисунок не войдёт». */
export const BEARD_OUTSIDE_WARN = 0.15;

/* Вид «Будет» в окне: сторона квадрата и поле вокруг рисунка. */
const VIEW_SIDE = 420;
const VIEW_MARGIN = 20;

const arrayBufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/**
 * Запекает бороду-вещь в лист выбранного номера. `input` — вещь, как у `readClothingCharacter` (каталог: `{ gameRoot, manifest, baseUrl, colour? }`), плюс `key` бороды игры. Ответ:
 * `{ key, sheet, view, width, height, coverage, outside, warn }`: `sheet` — PNG с прозрачным фоном (то, что пойдёт в игру до сжатия), `view` — он же, обрезанный по рисунку, для окна, `coverage` — доля листа с рисунком (у штатных 2–12 %),
 * `outside` — доля бороды, не поместившаяся на голову (0…1), `warn` — `outside` больше порога окна.
 */
export async function bakeGameBeard(input, context, deps) {
  const key = gameBeardKey(String(input?.key || "").replace(/^facial_overlays:/i, ""));
  const { head, beard } = await readBeardBakeInputs(input, context, deps);
  const baked = bakeBeardSheet({ head, beard });
  const png = await sharp(Buffer.from(baked.rgba.buffer, baked.rgba.byteOffset, baked.rgba.byteLength), {
    raw: { width: baked.width, height: baked.height, channels: 4 },
  })
    .png()
    .toBuffer();
  /* Вид для окна: лист обрезан по рисунку и вписан в квадрат — рисунок бороды занимает малую часть развёртки головы и на целом листе не читается (кадр Electron 17.11.2026). В игру идёт `sheet`. */
  const view = await beardTilePicture(baked.rgba, baked.width, baked.height, { side: VIEW_SIDE, margin: VIEW_MARGIN });
  return {
    key,
    sheet: arrayBufferOf(png),
    view: arrayBufferOf(view),
    /* Тот же PNG для «Применить» (`applyGameBeard`): картинки по каналу едут в base64. */
    sheetBase64: png.toString("base64"),
    width: baked.width,
    height: baked.height,
    coverage: baked.coverage,
    outside: baked.outside,
    warn: baked.outside > BEARD_OUTSIDE_WARN,
  };
}
