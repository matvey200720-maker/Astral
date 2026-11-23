import { useLayoutEffect, useState } from "react";
import {
  COVER_THUMB_WIDTHS,
  STRIP_THUMB_PX,
  coverThumbUrl,
  coverThumbWidthAt,
  pageThumbUrl,
} from "./cover-thumb.js";

/*
 * Кадр сцены открытой карточки — уменьшенная копия по рамке (18.11.2026, «карточки предпросмотра в килобайтах уменьшить, когда заходишь именно внутрь»).
 *
 * Раньше кадр шёл оригиналом: у ганпака PNG 1600 × 900 на 0,46 МБ, у обложки 1200 × 675 на 0,27 МБ, а CDN отдаёт 0,4–0,5 МБ/с на соединение. Теперь окно просит у службы медиа ширину из ряда (`?w=`), которой хватает рамке с запасом на плотность
 * экрана; оригинал — только в полноэкранном «Предпросмотре» (`WideViewer`) и когда картинка шире ряда.
 *
 * Ширину даёт ЗАМЕР рамки (`ResizeObserver`, одна рамка на карточку — не плитка сетки): раскладка карточки зависит от правой колонки и окна, и формула разошлась бы с CSS. Замер идёт до первой отрисовки (`useLayoutEffect`), поэтому
 * `<img>` с адресом ставится один раз, а не дважды; пока рамка не измерена, ширина — `null` и крупной картинки нет. Без раскладки (jsdom) берётся оценка по окну.
 *
 * Пока крупный кадр едет, под ним стоит то, что окно уже скачало: у обложки — картинка плитки каталога (тот же адрес, `?w=` по окну — берётся из кэша браузера), у остальных кадров — миниатюра их ленты. Это не копия фото под кадром
 * (`catalog-photo-no-ghost.test.js`): она лежит ровно в тех же границах, тем же размером, и прячется, когда крупный кадр доехал.
 */

const SIDE_MIN = 380;
const SIDE_MAX = 452;
const SIDE_SHARE = 0.32;
const COLUMN_GAP = 22;
/* Рейка окна и поля страницы мода, css px: замер Electron 18.11.2026 — окно 1440, рамка кадра 855 px = 1440 − 112 − 452 − 22. */
const CHROME = 112;

/** Верхняя оценка ширины рамки кадра в css px для окна шириной `viewport` (правая колонка `clamp(380px, 32vw, 452px)` и промежуток карточки «Пульт»). */
export function stageCssWidthFor(viewport) {
  const side = Math.min(SIDE_MAX, Math.max(SIDE_MIN, viewport * SIDE_SHARE));
  return Math.max(320, viewport - CHROME - side - COLUMN_GAP);
}

/* Картинки каталога не шире 1600 px (кадры галерей 1200 и 1600; 14 из 47 тысяч — исключения): рамке, которой не хватает и верха ряда, оригинал ничего не прибавил бы, поэтому берётся верх ряда, а не оригинал. */
const TOP = COVER_THUMB_WIDTHS[COVER_THUMB_WIDTHS.length - 1];

/* Ширина оригинала неизвестна (запись без `width`): в наборе на CDN ярус 1280 лежит у каждой картинки шире 540 (у 1200 — родной, у 1600 — уменьшенный), а 1600 — только у картинок шире 1280; просить 1600 вслепую значило бы получить 404 у каждой обложки 1200 × 675. */
const UNKNOWN_WIDTH_TIER = 1280;

/** Родной ярус картинки шириной `width` px: наименьший из ряда, не меньше её (шире ряда — верх); без ширины — 1280. Выше него службе незачем просить: там лежит та же картинка в своём размере. */
export const nativeThumbTier = (width) =>
  width > 0
    ? (COVER_THUMB_WIDTHS.find((tier) => tier >= width) ?? TOP)
    : UNKNOWN_WIDTH_TIER;

/*
 * Запас кадра сцены (замер 18.11.2026, Electron, окно 1440): ярус впритык к рамке (960 на рамку 855) браузер ещё раз уменьшает, и кадр выходит мягче оригинала — резкость 0,73 от прежней; ярус на 40 % больше рамки — той же сетки
 * пикселей, что у оригинала 1200 × 675 (родной ярус 1280), и браузер уменьшает его так же, как уменьшал PNG. Запас стоит килобайт 15 на кадр, мягкой картинки не даёт.
 */
const STAGE_OVERSAMPLE = 1.4;

/** Ширина крупного кадра из ряда для рамки `cssWidth` css px: наименьшая, что не меньше рамки × плотность × 1,08 × запас, а у рамки больше ряда — верх ряда. */
export const stageThumbWidth = (cssWidth) =>
  coverThumbWidthAt(cssWidth * STAGE_OVERSAMPLE) || TOP;

const estimate = () =>
  typeof window === "undefined" ? 0 : stageCssWidthFor(window.innerWidth || 0);

/** Ширина из ряда для крупного кадра в рамке `ref`; `null` — рамка ещё не измерена. `mounted` — рамка уже в разметке (сцена без кадров её не рисует): замер ждёт её появления. */
export function useStageThumbWidth(ref, mounted = true) {
  const [width, setWidth] = useState(null);
  useLayoutEffect(() => {
    if (!mounted) return undefined;
    const node = ref.current;
    const apply = () => {
      const css = node?.clientWidth || estimate();
      if (css > 0) setWidth(stageThumbWidth(css));
    };
    apply();
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}

/**
 * Что стоит под крупным кадром, пока тот едет: у обложки — картинка плитки каталога, у прочих — миниатюра ленты. Пусто, если крупный кадр сам не больше этой картинки
 * или адрес не облачный (подставлять нечего).
 */
export function stagePreviewUrl(src, { cover = "", full = src } = {}) {
  const preview =
    src && src === cover
      ? coverThumbUrl(src)
      : pageThumbUrl(src, STRIP_THUMB_PX);
  return preview === src || preview === full ? "" : preview;
}
