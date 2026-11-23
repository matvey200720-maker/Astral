import { catalogLikeCount } from "../../../../catalog-utils.js";
import { catalogSectionOfMod, publicCatalogCategories } from "../../../../components/desktop/catalog/catalogSections.js";
import { catalogMediaPresentation, coverFor, hasOwnCover, usesContainedMedia, usesSoundMedia } from "../../../../utils/catalogMedia.js";
import { modOnShelf } from "../../catalog-shelves.js";
import { newestFirst } from "../../post-order.js";

/*
 * Витрина (вид А вкладки «Каталог», ТЗ 29.10.2026-б): из того, что уже отобрал каталог (`visibleMods`), собираются «Новое», «Популярное» и полки —
 * подразделы раздела (во «Всех» — сами разделы). Здесь только выбор и порядок; рисует их `CatalogVariantA.jsx`.
 */

/** Сколько модов на полке, пока её не открыли целиком. */
export const RAIL_SIZE = 12;
/** Меньше модов, чем это, — полок нет, сетка: на пяти карточках «Новое» и «Популярное» были бы одним и тем же рядом. */
export const RAILS_FROM = 6;

/** Есть ли у мода настоящие цифры: в облачном каталоге v2 загрузок нет вовсе, и «Популярное» без них было бы выдумкой. */
export const hasPopularity = (mod) => Number(mod?.downloads ?? mod?.downloadCount ?? 0) > 0 || catalogLikeCount(mod) > 0;

const byPopularity = (left, right) =>
  catalogLikeCount(right) - catalogLikeCount(left) || Number(right.downloads || 0) - Number(left.downloads || 0);

/** Рендер ствола или вещи (прозрачный кадр на матовом поле) — в баннере он стоит справа целиком, а не растянут. */
export const isRenderCover = (mod) => /is-(weapon|clothing)-media/.test(catalogMediaPresentation(mod, "").className);

/* Обложки этих видов — кадр игры (у сборки редукса, таймцикла, эффекта, мира); у прицела, карты и звука обложка — схема или волна на тёмном, во весь баннер она пустая. */
const FRAME_SLOTS = new Set(["redux-pack", "timecycle", "kill-effects", "blood-routing", "hit-effects", "tracers", "mapping", "vegetation", "roads", "interior", "water"]);
const isFrameMod = (mod) => FRAME_SLOTS.has(String(mod?.catalogSlot || "").toLowerCase());

const isPlainCover = (mod) => !isRenderCover(mod) && !usesContainedMedia(mod);

/**
 * Мод, чей кадр встаёт в баннер раздела: самый новый со своей обложкой (не «Без кадра», не волна звука). Кадр игры (`FRAME_SLOTS`) — раньше всего, потом любая
 * обложка не карта и не рендер, потом рендер, карта и остальное. Ничего подходящего — баннер без картинки: рисовать вместо кадра нельзя.
 */
export function bannerMod(mods) {
  const own = newestFirst(mods).filter((mod) => hasOwnCover(mod) && coverFor(mod) && !usesSoundMedia(mod));
  return own.find((mod) => isFrameMod(mod) && isPlainCover(mod)) || own.find(isPlainCover) || own[0] || null;
}

/** Как кадр встаёт в баннер: кадр игры — во всю ширину (`cover`); рендер, карта, прицел — целиком справа (`contain`), растянутые на баннер они пустые или обрезаны. */
export const bannerFit = (mod) => (isFrameMod(mod) && isPlainCover(mod) ? "cover" : "contain");

/**
 * Что показать полками: «Новое», «Популярное» (только при настоящих цифрах) и группы — подразделы выбранного раздела или разделы «Всех».
 * Пустой ответ — витрине нечего собирать, вид показывает сетку.
 */
export function showcaseOf({ mods, category, shelves }) {
  if (mods.length < RAILS_FROM) return null;
  const fresh = newestFirst(mods).slice(0, RAIL_SIZE);
  const liked = mods.filter(hasPopularity);
  const popular = liked.length >= 3 ? [...liked].sort(byPopularity).slice(0, RAIL_SIZE) : [];
  const groups = [];
  if (category === "all") {
    const bySection = new Map();
    for (const mod of mods) {
      const id = catalogSectionOfMod(mod);
      if (!id) continue;
      if (!bySection.has(id)) bySection.set(id, []);
      bySection.get(id).push(mod);
    }
    for (const item of publicCatalogCategories) {
      const found = bySection.get(item.id);
      if (found?.length) groups.push({ kind: "section", id: item.id, label: item.label, mods: found });
    }
  } else {
    for (const shelf of shelves) {
      const found = mods.filter((mod) => modOnShelf(mod, shelf));
      if (found.length) groups.push({ kind: "shelf", id: shelf.id, label: shelf.label, mods: found, redux: Boolean(shelf.redux) });
    }
  }
  return { fresh, popular, groups };
}
