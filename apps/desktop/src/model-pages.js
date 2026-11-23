/*
 * Размер страниц модели по заголовку RSC7 (разбор краша арены Majestic, 10.11.2026).
 *
 * Оболочку зала, собранную до 10.11.2026, раскладка страниц раздувала нулевым хвостом: 43 МБ графики и страница
 * 16 МБ при 24 МБ данных, тогда как у штатных моделей игры не больше 24 МБ и страницы по 8 МБ. Поставленная
 * работа сама не лечится — нужна новая сборка из работы («Применить»), поэтому подготовка игры находит такие
 * оболочки по заголовку файла в хранилище движка: читать нужно только первые 16 байт.
 */

import fs from "node:fs/promises";

/* Поля флагов страниц: [сдвиг, маска, во сколько базовых страниц одна страница вида]. */
const PAGE_FIELDS = [
  [27, 1, 1],
  [26, 1, 2],
  [25, 1, 4],
  [24, 1, 8],
  [17, 127, 16],
  [11, 63, 32],
  [7, 15, 64],
  [5, 3, 128],
  [4, 1, 256],
];

const RSC7_MAGIC = 0x37435352;
const HEADER_BYTES = 16;

/* Пределы «как у штатных моделей игры» (оглавления x64*.rpf и update.rpf, 12 787 .ydr: 24 МБ, страница 8 МБ), с запасом на плашки. */
export const HEAVY_SHELL = Object.freeze({ graphicsBytes: 32 * 1048576, pageBytes: 8 * 1048576 });

/** Страницы области по флагам заголовка: общий размер, число и самая большая страница. */
export function pagesOfFlags(flags) {
  const value = flags >>> 0;
  const base = 0x200 << (value & 0xf);
  return PAGE_FIELDS.reduce(
    (sum, [shift, mask, weight]) => {
      const count = (value >>> shift) & mask;
      const size = base * weight;
      return { total: sum.total + count * size, pages: sum.pages + count, biggest: count ? Math.max(sum.biggest, size) : sum.biggest };
    },
    { total: 0, pages: 0, biggest: 0 },
  );
}

/** Размеры областей модели по первым 16 байтам файла; `null`, если это не ресурс RSC7. */
export function modelPagesFromHead(head) {
  if (!head || head.length < HEADER_BYTES) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== RSC7_MAGIC) return null;
  return { system: pagesOfFlags(view.getUint32(8, true)), graphics: pagesOfFlags(view.getUint32(12, true)) };
}

/** Тяжелее ли оболочка, чем нужно: графика или одна страница больше, чем у штатных моделей с запасом. */
export function isHeavyShell(pages) {
  return Boolean(pages) && (pages.graphics.total > HEAVY_SHELL.graphicsBytes || pages.graphics.biggest > HEAVY_SHELL.pageBytes);
}

/** Первые 16 байт файла; нет файла или он короче — `null`. */
export async function readFileHead(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const head = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(head, 0, HEADER_BYTES, 0);
    return bytesRead === HEADER_BYTES ? new Uint8Array(head) : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
