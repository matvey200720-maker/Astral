import { useSyncExternalStore } from "react";
import { coverThumbUrl, coverThumbWidthAt, WINDOW_FRAME } from "./cover-thumb.js";

/*
 * Превью по ширине плитки в «Библиотеке» и сборках (15.11.2026, «Astral быстрее»).
 *
 * Облачная картинка плитки шла оригиналом 1200 × 800 (медиана 263 КБ), а плитка на экране — 56–330 css px. Здесь у каждого вида плитки своя раскладка: функция «ширина окна → ширина плитки в
 * css px», посчитанная по правилам сетки (комментарии у каждой). Ширина превью — наименьшая из ряда `COVER_THUMB_WIDTHS`, что не меньше плитки × плотность экрана × 1,08 (`coverThumbWidthAt`):
 * мягкой картинки не бывает, лишнее — только килобайты. Плитка шире ряда — оригинал, как был.
 *
 * Окно меняет ширину — хук будит плитку, только когда ширина превью из ряда сменилась (снимок — число, `useSyncExternalStore` сравнивает его и молчит, пока оно то же).
 */

const COLUMN_GAP = 16;

/** Полка «Библиотеки» (`.redux-visual-grid` в `.lib-grid`): четыре колонки, до 1120 px — три, до 760 — две (`appearance-settings.css`), промежуток 16 px (`shelf-card.css`). */
export const shelfTile = (viewport) => {
  const columns = viewport > 1120 ? 4 : viewport > 760 ? 3 : 2;
  return (Math.max(0, viewport - WINDOW_FRAME) - (columns - 1) * COLUMN_GAP) / columns;
};

/** Карточка сборки (`.builds-grid`: колонки от 260 px, промежуток 16): ширина кадра обложки. */
export const buildCardTile = (viewport) => {
  const content = Math.max(260, viewport - WINDOW_FRAME);
  const columns = Math.max(1, Math.floor((content + COLUMN_GAP) / (260 + COLUMN_GAP)));
  return (content - (columns - 1) * COLUMN_GAP) / columns;
};

/**
 * Плитка-постер выбора модов в окне сборки (`PickTile look="poster"`, «Новая сборка» и открытая сборка): замер стенда `photo-library.mjs` — 243 css px в окне от 1280 px и 279 в окне 1000 px, у узких окон
 * плитка шире. Берётся верхняя оценка по окну, не замер: запас — килобайты, недобор — мягкая картинка.
 */
export const pickTile = (viewport) => (viewport >= 1200 ? 250 : viewport >= 1000 ? 300 : 360);

/** Доля ширины кадра обложки сборки у плитки мозаики (`.builds-cover.is-mosaic`, промежуток 4 px): одна — весь кадр, две — по половине, три — 1,55 : 1 : 1. */
export const collageShare = (count, index) => (count <= 1 ? 1 : count === 2 ? 0.5 : index === 0 ? 1.55 / 2.55 : 1 / 2.55);

/** Плитка раскладки `layout` в окне шириной `viewport`, в css px. */
const tileWidth = (layout, viewport) => (typeof layout === "function" ? layout(viewport) : Number(layout) || 0);

/** Ширина превью из ряда для плитки такой раскладки в этом окне; 0 — нужен оригинал. */
export function tileThumbWidth(layout) {
  const viewport = typeof window === "undefined" ? 0 : window.innerWidth || 0;
  const css = tileWidth(layout, viewport);
  return css > 0 ? coverThumbWidthAt(css) : 0;
}

const idle = () => () => {};
const listeners = new Set();
let attached = false;

const onResize = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener) {
  listeners.add(listener);
  if (!attached && typeof window !== "undefined") {
    attached = true;
    window.addEventListener("resize", onResize);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && attached) {
      attached = false;
      window.removeEventListener("resize", onResize);
    }
  };
}

/** Адрес картинки плитки: превью по её раскладке, а не оригинал. `layout` — функция «ширина окна → css px» или готовая ширина; не облачная картинка — как есть. */
export function useTileThumb(url, layout) {
  /* Без раскладки превью не нужно и окно не слушается: картинка уходит как есть. */
  const width = useSyncExternalStore(layout ? subscribe : idle, () => (layout ? tileThumbWidth(layout) : 0), () => 0);
  return layout ? coverThumbUrl(url, width) : url;
}
