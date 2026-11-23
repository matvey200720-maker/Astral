import { hasModPhoto } from "./mod-faces.js";

/*
 * Плитки обложки сборки (ТЗ 06.10): на карточке сборки — столько плиток, сколько
 * в ней вещей: 1 мод — 1 плитка, 2 — 2, 3 и больше — 3 и «+N» на последней.
 *
 *   1. моды со своим фото — это и есть лицо сборки (`hasModPhoto`);
 *   2. заготовки модов, которых каталог ещё не довёз (`pending`), — пустыми
 *      плитками на своих местах, чтобы плитки не прыгали, когда он догрузится;
 *   3. работы мастерской — по одной каждого вида раньше повторов, чтобы были
 *      видны килл-эффект, огонь и карта, а не три одинаковых. Это и работы
 *      из кода сборки, и установки мастерской из `modIds` старых сборок,
 *      сведённые к своим работам (`buildContents`);
 *   4. моды без своего фото — на них снимок слота мастерской (`modPhoto`),
 *      последними.
 *
 * Результат: `tiles` — что рисовать (не больше `limit`, у каждой `kind` —
 * `mod`, `work`, `item` или `pending`), `more` — сколько осталось за ними.
 */
export function coverTiles(
  works = [],
  mods = [],
  limit = 3,
  pending = 0,
  items = [],
) {
  const shown = mods.filter(
    (mod) => mod && ((!mod.pending && !mod.missing) || hasModPhoto(mod)),
  );
  const kinds = new Set();
  const firstOfKind = [];
  const repeats = [];
  for (const entry of [
    ...works.map((work) => ({ kind: "work", work, workKind: work.workKind })),
    ...items.map((item) => ({ kind: "item", item, workKind: item.workKind })),
  ]) {
    if (kinds.has(entry.workKind)) repeats.push(entry);
    else {
      kinds.add(entry.workKind);
      firstOfKind.push(entry);
    }
  }
  const ordered = [
    ...shown.filter(hasModPhoto).map((mod) => ({ kind: "mod", mod })),
    ...Array.from({ length: Math.max(0, pending) }, () => ({
      kind: "pending",
    })),
    ...firstOfKind,
    ...repeats,
    ...shown
      .filter((mod) => !hasModPhoto(mod))
      .map((mod) => ({ kind: "mod", mod })),
  ];
  const tiles = ordered.slice(0, limit);
  return { tiles, more: ordered.length - tiles.length };
}

/** Сколько заготовок ставить в обложку: ненайденные моды без фото. */
export const pendingWithoutPhoto = (mods = []) =>
  mods.filter((mod) => mod?.pending && !hasModPhoto(mod)).length;
