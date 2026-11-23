import { useSyncExternalStore } from "react";
import { watchShownPhotos } from "./shown-photos.js";

/*
 * Обложка карточки — уменьшенная копия по ширине окна (30.10.2026, «чтобы быстро грузились фотки»).
 *
 * Облачная обложка — оригинал 1200 × 800 (медиана 263 КБ), а карточка сетки показывает её шириной 200–550 px. Локальный API отдаёт по `?w=<ширина>` уменьшенный webp
 * (`apps/api/src/media-thumb.js`, ряд ширин тот же и сверяется тестом `cloud-media-thumb`); окно просит наименьшую ширину из ряда, которой хватает карточке с запасом на
 * плотность экрана. Ширину карточки даёт окно, а не замер плитки: замер раскладки на каждой карточке дороже самой картинки. Четыре колонки (две до 900 px), рейка и поля
 * ~240 px; запас, а не недобор — недобор дал бы мягкую картинку, запас стоит только лишних килобайт.
 *
 * Ширина запоминается и пересчитывается по `resize`; хук будит карточки, только когда ширина из ряда сменилась.
 */

/* 1280 и 1600 — кадр открытой карточки (18.11.2026): рамка кадра 750–1100 css px, на экранах 125–150 % ей нужно 1200–1600 пикселей. Выше ряда (оригинал шире 1600) — оригинал. */
export const COVER_THUMB_WIDTHS = Object.freeze([360, 540, 720, 960, 1280, 1600]);
const CLOUD_COVER = /^\/api\/media\/cloud\/[0-9a-f]{64}$/;
const DESKTOP_COLUMNS = 4;
const NARROW_COLUMNS = 2;
const NARROW_WINDOW = 900;
const FRAME_AND_GUTTERS = 240;
/** Рейка и поля окна, css px: от ширины окна до ширины страницы (плитки «Библиотеки» и сборок считаются от неё же, `tile-thumb.js`). */
export const WINDOW_FRAME = FRAME_AND_GUTTERS;
const SAFETY = 1.08;

/** Ширина из ряда для карточки в окне шириной `viewport` css px на экране плотности `ratio`; 0 — картинка шире ряда, нужен оригинал. */
export function coverThumbWidthFor(viewport, ratio = 1) {
  const columns = viewport > NARROW_WINDOW ? DESKTOP_COLUMNS : NARROW_COLUMNS;
  const card = Math.max(160, (viewport - FRAME_AND_GUTTERS) / columns) * SAFETY;
  const need = Math.ceil(card * Math.min(2, Math.max(1, ratio || 1)));
  return COVER_THUMB_WIDTHS.find((width) => width >= need) || 0;
}

const listeners = new Set();
let current = null;
let attached = false;

const measure = () =>
  typeof window === "undefined" ? 0 : coverThumbWidthFor(window.innerWidth || 0, window.devicePixelRatio || 1);

function refresh() {
  const next = measure();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Ширина превью для карточки в этом окне (0 — оригинал). */
export const coverThumbWidth = () => (attached ? (current ??= measure()) : measure());

function subscribe(listener) {
  listeners.add(listener);
  if (!attached && typeof window !== "undefined") {
    attached = true;
    current = measure();
    window.addEventListener("resize", refresh);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && attached) {
      attached = false;
      window.removeEventListener("resize", refresh);
      current = null;
    }
  };
}

/** Подписка карточки на смену ширины: она перерисуется, когда окно переехало в другую ширину из ряда. */
export const useCoverThumbWidth = () => useSyncExternalStore(subscribe, coverThumbWidth, () => 0);

/** Ширина из ряда для картинки шириной `cssWidth` css px (лента главной, миниатюры баннера) на этом экране; 0 — нужен оригинал. */
export function coverThumbWidthAt(cssWidth) {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const need = Math.ceil(cssWidth * SAFETY * Math.min(2, Math.max(1, ratio)));
  return COVER_THUMB_WIDTHS.find((width) => width >= need) || 0;
}

/** Адрес превью облачной обложки; всё прочее (кадры поставки, чужие адреса, уже с запросом) — как есть. */
export function coverThumbUrl(url, width = coverThumbWidth()) {
  if (!width || !CLOUD_COVER.test(String(url || ""))) return url;
  /* Первая же облачная обложка включает учёт показанных картинок — раньше, чем она загрузится (`shown-photos.js`). */
  watchShownPhotos();
  return `${url}?w=${width}`;
}

/*
 * Страница мода (14.11.2026, «Astral быстрее», «захожу на мод — фотки долго не прогружаются»): плитка ленты кадров — 84–161 css px, обложка шапки — 359, а грузился оригинал
 * 1200 × 800 (до 460 КБ на плитку и 3,8 МБ разжатых пикселей на каждую). Сама сцена (857 css px) остаётся оригиналом: она растягивается на высоту правой панели и читается
 * замером рамки (`frame-crop.js`) по своему адресу.
 */
export const STRIP_THUMB_PX = 170;
export const HEAD_COVER_PX = 360;
/*
 * Остальные картинки внутри открытой карточки (18.11.2026, «карточки предпросмотра в килобайтах уменьшить, когда заходишь именно внутрь»): строка компонента 62×35 (до трёх частей — 124×70), плитка «Компонентов» 56,
 * кружок раскраски 30, ствол в «что изменится» 46×32, лента полноэкранного кадра 84×47, «Стоит в игре» — полплитки 160. Кадр сцены просит ширину по рамке (`stage-photo.js`), а не по этим числам.
 */
export const ROW_ART_PX = 124;
export const ENTRY_ART_PX = 56;
export const PANEL_ART_PX = 560;
export const SWATCH_PX = 40;
export const FLOW_ART_PX = 96;
export const VIEWER_STRIP_PX = 120;
export const PLACED_ART_PX = 160;

/** Адрес превью для картинки страницы мода шириной `cssWidth` css px; не облачная картинка или ряд кончился — как есть. */
export const pageThumbUrl = (url, cssWidth) => coverThumbUrl(url, coverThumbWidthAt(cssWidth));
