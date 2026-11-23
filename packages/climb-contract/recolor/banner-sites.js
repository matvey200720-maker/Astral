/*
 * «Баннеры на зданиях» (задача 7 ТЗ 18.10.2026) — большие полотна на высотках
 * по месту: здание целиком в кадре, а полотно правится по одному.
 *
 * Место — здание и квартал вокруг него сценой кадра (`inventory/banner-sites.js`,
 * `scripts/prepare-banner-sites.mjs`). Полотна места — **щиты описи билбордов**
 * (`inventory/billboards.js`): тот же лист игры, то же место на нём, тот же облик
 * в работе. Поэтому у баннеров нет своей работы и своей установки: это второй вид
 * работы «Билборды» (`billboards`). Правка в одном редакторе видна в другом, а
 * установка одна — друг друга они затереть не могут.
 *
 * Состав (слово владельца 30.10.2026: «большие билборды на зданиях оставить, маленькие
 * баннеры, билбордики и арену Maze Bank убрать»): в меню только большие полотна
 * (`banner-rule.js`: высота от 15 м и площадь от 200 м²), и только на зданиях, у которых
 * есть настоящая сцена. Остальные полотна описи — малые баннеры, вертикальные ленты,
 * арена Maze Bank — из меню убраны (`BANNER_REMOVED_IDS`), но остались в описи и в
 * установке: работа, сохранённая раньше, ставит их так же, как ставила, а окно говорит,
 * сколько правок лежит на убранных полотнах (`bannerRemovedChanged`).
 *
 * Чистые данные, без React и three: их берут кадр (ракурсы, подсветка),
 * студия (что править) и тест.
 */

import BANNER_SITES_INVENTORY from "./inventory/banner-sites.js";
import { BILLBOARD_CANVAS_IDS, billboard, changedBillboards, linkedBillboards } from "./billboards.js";
import { bannerArea } from "./banner-rule.js";

export { BANNER_SITES_INVENTORY };
export { BANNER_MIN_AREA, BANNER_MIN_HEIGHT, bannerArea, bannerIsLarge, bannerSize } from "./banner-rule.js";

/* Места с полотнами описи; id, которого в описи билбордов нет, молча отбрасывается — опись и места пересобирают порознь. */
const SCENE_SITES = BANNER_SITES_INVENTORY.sites.map((site) =>
  Object.freeze({
    ...site,
    /* Большие — первыми: с них место и показывается. */
    boards: Object.freeze(
      site.boards
        .filter((id) => billboard(id))
        .map((id, order) => ({ id, order }))
        .sort((a, b) => bannerArea(billboard(b.id)) - bannerArea(billboard(a.id)) || a.order - b.order)
        .map((item) => item.id),
    ),
  }),
);

/** Места со сценой здания (из игры игрока): у каждого есть кадр, ракурсы и место полотна в сцене. */
export const BANNER_SITES = Object.freeze(SCENE_SITES);
export const BANNER_SITE_IDS = Object.freeze(BANNER_SITES.map((site) => site.id));
/** Всё, что правят в «Баннерах на зданиях»: те же места со сценой (полотен района без здания больше нет). */
export const BANNER_PLACES = BANNER_SITES;
export const BANNER_PLACE_IDS = BANNER_SITE_IDS;

const siteById = new Map(BANNER_PLACES.map((site) => [site.id, site]));
const siteByBoard = new Map(BANNER_PLACES.flatMap((site) => site.boards.map((id) => [id, site])));

/** Место по id или `null`. */
export const bannerSite = (id) => siteById.get(id) || null;
/** Место, где стоит полотно (`null` — полотно не из баннеров на зданиях: обычный щит или убранное малое полотно). */
export const bannerSiteOfBoard = (boardId) => siteByBoard.get(boardId) || null;
/** Сколько полотен стоит в сценах зданий. */
export const BANNER_TOTAL = siteByBoard.size;

/*
 * Убранные из меню полотна: баннеры, вертикальные и «во всю стену» полотна описи, которых нет ни в одном месте (малые, арена Maze
 * Bank, ленты на оградах). Опись и установка у них прежние, правит их только то, что уже лежит в работе.
 */
export const BANNER_REMOVED_IDS = Object.freeze(BILLBOARD_CANVAS_IDS.filter((id) => !siteByBoard.has(id)));
const removed = new Set(BANNER_REMOVED_IDS);

/** Убранное из меню полотно (его правки в работе остаются в игре). */
export const bannerIsRemoved = (boardId) => removed.has(boardId);

/** Убранные полотна, на которых в работе есть правка и которые уйдут в игру: `[id, …]` по описи. */
export const bannerRemovedChanged = (project) => changedBillboards(project).filter((id) => removed.has(id));

/**
 * Где полотно в сцене места и куда смотрит: `{ point: [x, y, z], normal: [nx, ny], size: [ширина, высота] }`
 * (метры в осях сцены; `normal` — горизонтальная, единичная, наружу от стены).
 */
export function bannerPlace(boardId) {
  const site = siteByBoard.get(boardId);
  const view = site?.views?.[boardId];
  if (!site || !view) return null;
  return { point: view.p, normal: view.n, size: view.size };
}

/**
 * Полотна, что берёт «Применить ко всем полотнам этого здания»: все полотна
 * места и связанные с ними (одно место листа — одна картинка), без повторов.
 */
export function bannerSiteGroup(siteId) {
  const ids = new Set();
  for (const id of siteById.get(siteId)?.boards || []) for (const member of linkedBillboards(id)) ids.add(member);
  return [...ids];
}

/** Полотна места, что делят с `boardId` место на листе (правка ляжет и на них): `[id, …]` без самого `boardId`. */
export const bannerLinked = (boardId) => linkedBillboards(boardId).filter((id) => id !== boardId);

/** Вид полотна для подписей: `giant` — «во всю стену», `banner` — баннер, остальное — вывеска. */
export function bannerKindOf(boardId) {
  const kind = billboard(boardId)?.kind;
  if (kind === "giant" || kind === "vertical") return "giant";
  if (kind === "banner") return "banner";
  return "sign";
}
