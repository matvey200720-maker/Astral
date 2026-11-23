/*
 * Обложка части маппинга, где модель автора пуста (ANTEIKU V2 · delete_backpack, 14.11.2026): `mj_test_anim_bag.ydr` — 164 байта, один «drawable» без единой сетки, рядом пустая
 * анимация. Так автор убирает предмет сервера: подменяет его модель пустой. Снимать тут нечего, а оригинала предмета (его модель — файл сервера) в поставке нет, поэтому обложка —
 * значок «предмета нет»: контур предмета, перечёркнутый наискось, без рамок и надписей на картинке. Это не кадр игры, и подпись под обложкой говорит об этом прямо
 * (`EMPTY_MODEL_CAPTION`, словарь `ui-text/zone-empty-model-1411.js`). Рюкзак рисуется, если в имени файла `bag`/`backpack`, любой другой предмет — коробкой.
 * Сборка без окна (`sharp`), как у остальных рисовальщиков частей.
 */
import sharp from "sharp";
import { readDrawable } from "@modovik/rage-drawable";
import { inflateRawSync } from "node:zlib";

export const EMPTY_MODEL_COVER = Object.freeze({ width: 1200, height: 675 });

/** Подпись обложки (ключ словаря окна). */
export const EMPTY_MODEL_CAPTION =
  "Значок, а не кадр игры: модель в файле автора пуста, предмет в игре не рисуется";

const CANVAS = "#0e0e11";
const INK = "rgba(235,235,242,0.62)";
const BAG_NAME = /bag|backpack|rucksack/i;
const STROKE = 12;

const MODEL_FILE = /\.ydr$/i;

/** `true`: файл читается и в нём ни одной сетки; нечитаемый файл пустым не считается. */
export function isEmptyModel(bytes) {
  try {
    const { drawables } = readDrawable(new Uint8Array(bytes), {
      inflateRaw: (data) => inflateRawSync(data),
    });
    return (
      Array.isArray(drawables) &&
      drawables.length > 0 &&
      drawables.every((drawable) => !drawable.meshes?.length)
    );
  } catch {
    return false;
  }
}

/**
 * Имена пустых моделей части; `[]`, если моделей нет или хоть одна не пуста (тогда её снимают как модель).
 * @param {{ name: string, bytes: Uint8Array }[]} files файлы части
 */
export function emptyModelNames(files) {
  const models = files.filter(
    (file) => MODEL_FILE.test(String(file.name)) && file.bytes?.length,
  );
  if (!models.length || !models.every((file) => isEmptyModel(file.bytes)))
    return [];
  return models.map((file) => String(file.name));
}

const BACKPACK = `
  <path d="M545 210 C545 150 655 150 655 210" fill="none"/>
  <rect x="480" y="205" width="240" height="320" rx="80" fill="none"/>
  <path d="M480 330 Q600 372 720 330" fill="none"/>
  <rect x="520" y="400" width="160" height="104" rx="30" fill="none"/>
  <path d="M480 285 Q430 330 442 440" fill="none"/>
  <path d="M720 285 Q770 330 758 440" fill="none"/>`;

const BOX = `
  <path d="M600 160 L765 250 L765 430 L600 520 L435 430 L435 250 Z" fill="none"/>
  <path d="M435 250 L600 340 L765 250 M600 340 L600 520" fill="none"/>`;

/** Картинка обложки: контур предмета и косая черта. `bag` — рюкзак, иначе коробка. */
export async function emptyModelPng({ bag }) {
  const { width, height } = EMPTY_MODEL_COVER;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${CANVAS}"/>
  <g stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${bag ? BACKPACK : BOX}</g>
  <line x1="420" y1="140" x2="780" y2="545" stroke="${CANVAS}" stroke-width="${STROKE * 3}" stroke-linecap="round"/>
  <line x1="420" y1="140" x2="780" y2="545" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Обложка пустой модели: `{ png, caption, names }` или `null` (моделей нет либо не все пусты).
 * @param {{ name: string, bytes: Uint8Array }[]} files файлы части
 */
export async function emptyModelCover(files) {
  const names = emptyModelNames(files);
  if (!names.length) return null;
  return {
    png: await emptyModelPng({
      bag: names.some((name) => BAG_NAME.test(name)),
    }),
    caption: EMPTY_MODEL_CAPTION,
    names,
  };
}
