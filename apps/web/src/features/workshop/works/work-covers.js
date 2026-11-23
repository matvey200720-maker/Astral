/*
 * Обложка работы человека — снимок кадра самого редактора в момент «Сохранить» и «Применить» (Хелпер 11, 25.10.2026; «Применить» — 31.10.2026).
 *
 * Прежде обложку «Моих работ» и библиотеки рисовала печь (`covers/cover-oven.jsx`): отдельная перерисовка работы в
 * скрытом месте, лишние кадры и сцены, которых человек не видел. Теперь у работы лежит картинка из её редактора: кадр в полной загрузке
 * (`frame-ready.js`), с той же позиции и в тот же момент, что у стандартного предпросмотра (`cover-shots.js`, `frame-shot.js`), → WebP
 * 640×400 в IndexedDB. Ничего не перерисовывается в фоне.
 *
 * Снять кадр можно двумя путями. Кадр, что умеет сам (`frame-shot.js`, `shoot`: 3D, небо, выстрел), за одну задачу браузера ставит вид, рисует
 * и отдаёт холст: человек этого не видит. Кадр из нескольких слоёв снимает окно целиком (`capturePublisherRegion`: главный процесс), органы
 * кадра на это время гаснут. Обрезка, уменьшение и WebP — в потоке кодирования: снимок не стоит в главном потоке окна.
 *
 * Снимок берётся ДО окна «Сохранить в мои работы»: окно ложится на кадр и попало бы в картинку. Поэтому он стартует
 * от пункта меню, а привязывается к работе после записи (`attachSavedCover`): редакторы пишут работу каждый по-своему,
 * а ключ работы (`work:<id>`, `project:<id>`) известен только после записи — берётся новейшая работа этого вида.
 *
 * «Применить» снимает так же, но ложится снимок, когда работа встала в игру (`install-queue/apply.js`): не встала — в игре прежняя, и картинка
 * прежняя. Ключ — проект студии или место работы (`slot:<плитка>`): поставленное без сохранения в «Мои работы» своего номера не имеет. Туда же
 * ложится обложка работы из каталога: новая установка не из редактора заменяет картинку прежней.
 *
 * Постановочный кадр редактора (`data-frame-staged`: «Вода» без игры показывает блок воды на сетке) не снимается: честного кадра
 * нет, а плита на сетке в библиотеке не нужна (ТЗ 27.10.2026).
 *
 * Хранилище — удобство, а не память: нет IndexedDB или окно без главного процесса — обложки нет, работа показывается
 * запасным видом (`WorkCover`).
 */

import { coverShotOf } from "./cover-shots.js";
import { frameShotEntry } from "../frame-shot.js";
import { editorFrameState, whenEditorFrameReady } from "../frame-ready.js";
import { encodeBitmapWebp } from "../model-stage/snapshot-encode.js";

export const WORK_COVER_SIZE = Object.freeze({ width: 640, height: 400 });
const DB_NAME = "astral-work-covers";
const STORE = "covers";
const QUALITY = 0.86;
/* Сколько ждать кадр, прежде чем открыть окно «Сохранить»: человек не должен стоять перед пустым экраном. */
const READY_WAIT_MS = 2500;
/* Человек уже смотрит на кадр: две проверки подряд — он стоит; шесть (полсекунды перед окном «Сохранить») ничего не добавляли. */
const READY_CHECKS = 2;

let opening = null;

function openStore() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

async function withStore(mode, work, fallback = null) {
  const db = await openStore();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      let result = fallback;
      work(transaction.objectStore(STORE), (value) => {
        result = value;
      });
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => resolve(fallback);
      transaction.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

const listeners = new Set();

/** Подписка на новые обложки: плитка работы перечитывает картинку, когда её только что сняли. */
export function onWorkCoverChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* Что можно положить обложкой: снимок (`data:`) или адрес обложки из каталога. */
const isCoverUrl = (url) => typeof url === "string" && /^(data:image\/|https?:\/\/|\/(?!\/))/.test(url);

/** Ключ места работы, поставленной без сохранения в «Мои работы». */
export const slotCoverKey = (slotId) => (slotId ? `slot:${slotId}` : "");

/** Обложка работы под ключом (`work:<id>`, `project:<id>`, `slot:<плитка>`): адрес картинки или `null`. */
export function readWorkCover(key) {
  return withStore("readonly", (store, done) => {
    const request = store.get(String(key));
    request.onsuccess = () => {
      const url = request.result?.url;
      done(isCoverUrl(url) ? url : null);
    };
  });
}

export async function writeWorkCover(key, url) {
  if (!key || !isCoverUrl(url)) return false;
  const stored = await withStore("readwrite", (store, done) => {
    store.put({ url, at: Date.now() }, String(key));
    done(true);
  }, false);
  if (stored) for (const listener of listeners) listener(String(key));
  return stored;
}

/** Работу убрали — её обложка уходит вместе с ней. */
export async function deleteWorkCover(key) {
  const deleted = await withStore("readwrite", (store, done) => {
    store.delete(String(key));
    done(true);
  }, false);
  if (deleted) for (const listener of listeners) listener(String(key));
  return deleted;
}

/** Оставить обложки только у живых работ: ключи работ, что есть сейчас. */
export function pruneWorkCovers(liveKeys) {
  const live = new Set(liveKeys);
  return withStore("readwrite", (store, done) => {
    const request = store.getAllKeys();
    request.onsuccess = () => {
      for (const key of request.result || []) if (!live.has(key)) store.delete(key);
      done(true);
    };
  }, false);
}

/* Кусок картинки `[x, y, w, h]` в пропорции обложки: `crop` кадра (доли), потом по центру — как `object-fit: cover` плитки. */
export function coverBox(sourceWidth, sourceHeight, crop = null, { width, height } = WORK_COVER_SIZE) {
  const left = (crop?.left || 0) * sourceWidth;
  const top = (crop?.top || 0) * sourceHeight;
  const areaW = (crop?.width ?? 1) * sourceWidth;
  const areaH = (crop?.height ?? 1) * sourceHeight;
  const scale = Math.min(areaW / width, areaH / height);
  const w = width * scale;
  const h = height * scale;
  return [Math.round(left + (areaW - w) / 2), Math.round(top + (areaH - h) / 2), Math.round(w), Math.round(h)];
}

/* Где кадр целиком ложится на обложку (`inset`, доля её высоты): по центру, поля — цветом самого кадра. */
export function coverPlace(sourceWidth, sourceHeight, inset, { width, height } = WORK_COVER_SIZE) {
  const scale = Math.min((height * inset) / sourceHeight, (width * inset) / sourceWidth);
  const w = Math.round(sourceWidth * scale);
  const h = Math.round(sourceHeight * scale);
  return [Math.round((width - w) / 2), Math.round((height - h) / 2), w, h];
}

/* Снимок → WebP 640×400: обрезка, уменьшение и кодирование — в потоке (`snapshot-encode.js`). */
function coverFromBitmap(bitmap, shot) {
  const { width, height } = WORK_COVER_SIZE;
  const size = [width, height];
  if (shot?.inset) return encodeBitmapWebp(bitmap, { quality: QUALITY, size, place: coverPlace(bitmap.width, bitmap.height, shot.inset) });
  return encodeBitmapWebp(bitmap, { quality: QUALITY, box: coverBox(bitmap.width, bitmap.height, shot?.crop), size });
}

/* Ответ главного процесса (`data:`-адрес) → битмап: картинку разбирает поток браузера, а не окно. */
function bitmapOfDataUrl(url) {
  const comma = url.indexOf(",");
  const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (char) => char.charCodeAt(0));
  const type = /^data:([^;,]+)/.exec(url)?.[1] || "image/png";
  return createImageBitmap(new Blob([bytes], { type }));
}

/* Всё, что лежит поверх кадра, на время снимка окна гасится: органы кадра, инструкция, меню и окна. */
const CAPTURE_ATTRIBUTE = "data-capturing-frame";

const nextPaint = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") return setTimeout(resolve, 32);
    return requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

/* Где снимать окно: сам кадр вида (`target`), а нет его — вся область предпросмотра. */
function shotRect(shot, rect) {
  const target = shot?.target ? document.querySelector(`.ui-editor-canvas ${shot.target}`) : null;
  if (!target) return rect;
  const box = target.getBoundingClientRect();
  return box.width > 8 && box.height > 8 ? [box.x, box.y, box.width, box.height] : rect;
}

/* Снять окно по области кадра: кадр уже в позе. */
async function captureWindow(shot, rect) {
  const root = document.documentElement;
  root.setAttribute(CAPTURE_ATTRIBUTE, "");
  try {
    await nextPaint();
    const [x, y, width, height] = shotRect(shot, rect);
    /* `api.js` — большой модуль: он нужен только в миг снимка, а этот файл зовут из списка «Моих работ». */
    const { capturePublisherRegion } = await import("../../../api.js");
    /* `cover` — главному процессу: картинка лёгкая, не PNG во весь кадр через канал окна. */
    const result = await capturePublisherRegion({
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: Math.round(width),
      height: Math.round(height),
      cover: true,
    });
    return result?.image || null;
  } finally {
    root.removeAttribute(CAPTURE_ATTRIBUTE);
  }
}

/**
 * Снять кадр открытого редактора в обложку: `data:`-адрес WebP или `null` (нет редактора, кадр не готов, снимать нечем). Ждёт «кадр готов» не
 * дольше `wait` — иначе снимка нет, и работа остаётся с запасным видом. `kind` — вид обложки (`editor-covers.js`): где и в какой момент снимать.
 * `onFramed` — кадр снят и свободен: окно «Сохранить» уже можно класть на него, разбор и кодирование идут дальше сами.
 */
export async function captureEditorFrameCover({ wait = READY_WAIT_MS, kind = "", onFramed = null } = {}) {
  if (typeof document === "undefined") return null;
  if (!editorFrameState().rect) return null;
  /* Постановочный кадр (редактор без игры: блок воды на сетке) обложкой работы не становится — у неё запасной вид. */
  if (document.querySelector(".ui-editor-canvas [data-frame-staged]")) return null;
  if (!(await whenEditorFrameReady({ timeout: wait, settle: READY_CHECKS }))) return null;
  const { rect } = editorFrameState();
  if (!rect) return null;
  const shot = coverShotOf(kind);
  const entry = frameShotEntry();
  let restore = null;
  try {
    const own = await entry?.shoot?.(kind);
    if (own) {
      onFramed?.();
      return await coverFromBitmap(own, shot);
    }
    restore = (await entry?.pose?.(kind)) || null;
    const image = await captureWindow(shot, rect);
    /* Кадр возвращается сразу: окно уже снято, а разбор идёт дольше. */
    restore?.();
    restore = null;
    onFramed?.();
    return image ? await coverFromBitmap(await bitmapOfDataUrl(image), shot) : null;
  } catch {
    return null;
  } finally {
    restore?.();
  }
}

/* Снимок, начатый от пункта «Сохранить»: окно сохранения берёт его, когда работа записана. */
let pending = null;

/** Есть ли чем снять окно: главный процесс приложения (в браузере и в тестах его нет); `__qaCaptureRegion` — стенд песочницы. */
export const canCaptureFrame = () =>
  typeof window !== "undefined" &&
  (typeof window.modovik?.capturePublisherRegion === "function" || typeof window.__qaCaptureRegion === "function");

/* Снять можно: окно умеет или кадр снимает себя сам. */
const canShoot = () => canCaptureFrame() || Boolean(frameShotEntry()?.shoot);

/**
 * Снять кадр сейчас, если редактор открыт: обещание снимка или `null`, когда снимать нечего (нет редактора, нечем снять).
 * `kind` — вид обложки; `capture`, `available` — съёмщик и проверка «есть ли чем снять» (в тестах подставляются свои).
 */
export function shootEditorFrame({ capture = captureEditorFrameCover, available = canShoot, ...options } = {}) {
  if (!available() || !editorFrameState().rect) return null;
  return Promise.resolve()
    .then(() => capture(options))
    .catch(() => null);
}

/**
 * Начать снимок кадра (от пункта меню «Сохранить в мои работы», до окна). Возвращает обещание, что кадр снят и окно можно открывать (картинка
 * дожимается в потоке и ложится к работе после записи), или `null`, если снимать нечего: окно открывается сразу.
 */
export function beginWorkCover(options = {}) {
  let framed = null;
  const free = new Promise((resolve) => {
    framed = resolve;
  });
  pending = shootEditorFrame({ ...options, onFramed: framed });
  if (!pending) return null;
  void pending.finally(framed);
  return free;
}

/**
 * Работа записана: привязать начатый снимок к новейшей работе вида `kind`. Ключ работы узнаётся по списку
 * «Моих работ» (`listWorkshopWorks`), поэтому редакторы свои записи не меняют.
 */
export async function attachSavedCover(kind, listWorks) {
  const cover = pending;
  pending = null;
  if (!cover) return null;
  const url = await cover;
  if (!url) return null;
  const work = listWorks().find((item) => item.workKind === kind);
  if (!work?.key) return null;
  await writeWorkCover(work.key, url);
  return work.key;
}

/** Окно «Сохранить» закрыли, не сохранив: начатый снимок не нужен. */
export function dropPendingCover() {
  pending = null;
}
