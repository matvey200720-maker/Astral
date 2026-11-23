import { coverFor, hasOwnCover } from "./catalogMedia.js";
import { HEAD_COVER_PX, coverThumbUrl, pageThumbUrl, STRIP_THUMB_PX } from "./cover-thumb.js";
import { nativeThumbTier, stageCssWidthFor, stageThumbWidth } from "./stage-photo.js";

/*
 * Фото заранее (14.11.2026, «Astral быстрее», «захожу на мод — фотки долго не прогружаются»).
 *
 * Фото мода едут так: окно → локальный API → CDN (`apps/api/src/cloud-media.js`). Холодное фото — 150–400 мс на одну картинку (оригинал 260–460 КБ с CDN, потом уменьшение), и до
 * щелчка по карточке ни один кадр галереи не просили: лента мода стояла серыми плитами, пока API ходил за ними. Человек наводит на карточку 0,3–1 с до щелчка — этого хватает,
 * чтобы API забрал картинки в свой кэш на диске, а окно — в кэш браузера (ответы API `immutable`).
 *
 * Просим ровно те адреса, что страница мода запросит сама (`pageThumbUrl` — тот же ряд ширин, что у плиток ленты и обложки шапки), и тихо: `priority: "low"`, не больше пяти сразу (из шести соединений Chromium к API одно остаётся странице), пока
 * сетка не в рывке и окно видно. Последняя карточка, на которую навели, идёт в очереди первой. Ничего не видно человеку: ни строки, ни рисунка.
 */

const DWELL_MS = 140;
const PARALLEL = 5;
const FRAMES_AHEAD = 6;
const QUEUE_CAP = 48;
const REMEMBER = 1200;

const CLOUD_PHOTO = /^\/api\/media\/cloud\/[0-9a-f]{64}(?:\?w=[0-9]+)?$/;
const asked = new Set();
const queue = [];
let running = 0;
let dwell = 0;

const remember = (url) => {
  asked.add(url);
  if (asked.size > REMEMBER) asked.delete(asked.values().next().value);
};

function pump() {
  while (running < PARALLEL && queue.length) {
    const url = queue.pop();
    running += 1;
    Promise.resolve()
      .then(() => fetch(url, { priority: "low" }))
      .then((reply) => (reply.ok ? reply.arrayBuffer() : null))
      /* Сеть не ответила — в следующий раз просим снова; ответ «нет такого» не повторяется. */
      .catch(() => asked.delete(url))
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/* Окно скрыто или сетка в рывке — картинки сейчас никому не нужны, а очередь соединений нужна тем, что на экране. */
const quiet = () =>
  typeof document === "undefined" || typeof fetch !== "function" || document.hidden || Boolean(document.querySelector("[data-virtual-fling]"));

/** Попросить адреса у API заранее; первым в очереди идёт первый из списка. Уже просили или не облачная картинка — пропускается. */
function enqueue(urls) {
  if (quiet()) return;
  const fresh = urls.filter((url, at) => CLOUD_PHOTO.test(String(url || "")) && !asked.has(url) && urls.indexOf(url) === at);
  if (!fresh.length) return;
  fresh.forEach(remember);
  queue.push(...fresh.reverse());
  if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
  pump();
}

// Картинки кадров мода в том порядке, в каком их собирает страница мода: свои кадры, обложка, галерея; ролики пропускаются.
function frameSources(mod) {
  const found = [];
  const take = (item) => {
    const src = typeof item === "string" ? item : item?.url || item?.src;
    const type = typeof item === "string" ? "image" : item?.type || "image";
    if (src && type !== "video") found.push({ src, width: typeof item === "string" ? 0 : Number(item?.width) || 0 });
  };
  (mod?.media || []).forEach(take);
  if (hasOwnCover(mod)) found.push({ src: coverFor(mod), width: Number(mod.coverWidth) || 0 });
  (mod?.gallery || []).forEach(take);
  const seen = new Set();
  return found.filter(({ src }) => !seen.has(src) && seen.add(src));
}

/* Кадр сцены — тем ярусом, каким его попросит страница мода (`stage-photo.js`: по рамке с запасом и не выше родного яруса картинки; рамка здесь — по окну, замер её ещё не сделан). */
const stageUrl = ({ src, width }) => {
  const frame = typeof window === "undefined" ? 0 : stageCssWidthFor(window.innerWidth || 0);
  return coverThumbUrl(src, Math.min(stageThumbWidth(frame), nativeThumbTier(width)));
};

/**
 * Адреса, которые страница мода запросит: сцена — оригинал первого кадра, лента — превью кадров, шапка — превью обложки. Первыми идут холодные — превью остальных кадров ленты (картинки галереи
 * у API ещё нет, поход в CDN ≈ 250 мс и больше), последними — первый кадр и шапка: это обложка, её карточка уже показывала, и она лежит на диске API.
 */
export function modPhotoUrls(mod) {
  if (!mod) return [];
  const frames = frameSources(mod).slice(0, FRAMES_AHEAD);
  const urls = frames.slice(1).map(({ src }) => pageThumbUrl(src, STRIP_THUMB_PX));
  if (frames.length) urls.push(stageUrl(frames[0]));
  if (hasOwnCover(mod)) urls.push(pageThumbUrl(coverFor(mod), HEAD_COVER_PX));
  if (frames.length) urls.push(pageThumbUrl(frames[0].src, STRIP_THUMB_PX));
  return urls.filter((url) => CLOUD_PHOTO.test(String(url || "")));
}

/** Фото мода у API заранее — на наведении на карточку или щелчке. */
export const warmModPhotos = (mod) => enqueue(modPhotoUrls(mod));

/** Свойства карточки: наведение дольше 140 мс или нажатие греет фото мода. */
export const modPhotosAhead = (mod) => ({
  onPointerEnter: () => {
    window.clearTimeout(dwell);
    dwell = window.setTimeout(() => warmModPhotos(mod), DWELL_MS);
  },
  onPointerLeave: () => window.clearTimeout(dwell),
  onPointerDown: () => {
    window.clearTimeout(dwell);
    warmModPhotos(mod);
  },
});

/** Только для тестов: забыть всё, что уже просили. */
export function resetPhotoAhead() {
  asked.clear();
  queue.length = 0;
  running = 0;
  window.clearTimeout(dwell);
}
