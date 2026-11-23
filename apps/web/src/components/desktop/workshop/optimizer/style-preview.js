/*
 * Кадр вкладки «Стиль мира» (ТЗ 17.10.2026, задача 10): настоящий кадр из
 * игры, который приложение красит в выбранный стиль тем же правилом, что хост
 * — текстуры (`styleRgba`, `@modovik/optimizer/texture-styles.js`), и, если
 * включён ЧБ-мир, ещё и в серый (`grayscaleRgba`: стиль стоит перед ЧБ, как
 * в конвейере текстур).
 *
 * Кадра со стилем из самой игры у Astral нет, а правило стиля считается по
 * ступени текстуры (контуры — по ней же), поэтому подпись вкладки говорит
 * прямо: стиль на кадре рисует приложение, на всём кадре целиком; в игре
 * свет и небо останутся как есть, а контуры лягут по каждой текстуре.
 *
 * Крашеные кадры и миниатюры помнятся на весь сеанс окна (18.10.2026,
 * жалоба: «вошёл во вкладку — карточки пустые, поменял кадр или ЧБ — снова»):
 * ключ — кадр (адрес файла поставки), стиль, серый и версия краски
 * (`TEXTURE_STAGES_VERSION`). Миниатюры лежат в памяти модуля, а не в
 * состоянии вкладки, поэтому второй вход во вкладку, смена кадра туда и
 * обратно и переключение ЧБ показывают картинки сразу. Пока для нового ключа
 * рисуется, на карточках остаются прежние картинки — не пустота. Правило
 * стилей (около десяти килобайт)
 * подгружается при первом стиле: вкладка без выбранного стиля его не тянет.
 * Краска идёт в своём потоке (`style-paint-worker.js`, шаг 4 кэша превью,
 * 18.10.2026): кадр качается и красится на `OffscreenCanvas`, окну приходит
 * готовый `ImageBitmap` или JPEG-`Blob`, и главный поток не стоит ни на
 * миниатюрах, ни на большом кадре. Миниатюры ложатся и в постоянное хранилище плиток
 * (`tile-store.js`): второй запуск приложения берёт их из него. Не вышло (потока нет, поток упал) —
 * кадр красится здесь, как раньше. Где нет 2D-контекста (тесты, старый
 * браузер), вкладка показывает кадр картинкой.
 *
 * Смена кадра (19.10.2026, жалоба: «переключаешь локации — картинка
 * пропадает»): уже загруженный кадр приходил в той же очереди событий, и два
 * обновления состояния («не готов» → «готов») сливались в одно — отрисовка не
 * запускалась, а холст, очищенный сменой размера, оставался чёрным. Теперь
 * готовность помнит адрес кадра, размер холста меняется только если другой, а
 * пока стиль считается, на холсте — сам кадр, а не пустота.
 */

import { useEffect, useRef, useState } from "react";
import { TEXTURE_STAGES_VERSION, grayscaleRgba } from "@modovik/optimizer/texture-stages.js";
import { TEXTURE_STYLES } from "@modovik/optimizer/texture-style-ids.js";
import { stylePaint } from "./style-paint.js";
import { readTile, tileStoreKey, writeTile } from "../../../../features/workshop/covers/tile-store.js";

let painter = null;
const loadPainter = () => (painter ||= import("@modovik/optimizer/texture-styles.js").then((module) => module.styleRgba));

function context2d(canvas) {
  try {
    return canvas.getContext("2d") || null;
  } catch {
    return null;
  }
}

/* Ключ крашеной картинки: кадр, стиль, серый и версия краски — поднимут версию, и старое не годится. */
const paintKey = (url, style, gray, extra = "") => `${url}|${style || ""}|${gray ? 1 : 0}|v${TEXTURE_STAGES_VERSION}${extra}`;

/* Большие крашеные кадры (1280×720, ~3,7 МБ каждый): последние, а не все — 4 кадра × 6 стилей × 2 серости не нужны разом. */
const PAINTED_LIMIT = 12;
const painted = new Map();
function paintedGet(key) {
  const hit = painted.get(key);
  if (!hit) return null;
  painted.delete(key);
  painted.set(key, hit);
  return hit;
}
function paintedSet(key, canvas) {
  painted.set(key, canvas);
  while (painted.size > PAINTED_LIMIT) {
    const oldest = painted.keys().next().value;
    /* `ImageBitmap` из потока держит память видеочипа и процессора до `close()`. */
    painted.get(oldest)?.close?.();
    painted.delete(oldest);
  }
}


/* Миниатюры карточек — на весь сеанс окна: их немного (6 × 4 кадра × 2 серости), каждая ~10 КБ. */
const thumbCache = new Map();
const THUMB_IDS = ["", ...TEXTURE_STYLES];
const thumbKey = (url, gray, id) => paintKey(url, id, gray, `|w${STYLE_THUMB_WIDTH}`);
function cachedThumbs(url, gray) {
  const found = {};
  if (!url) return found;
  for (const id of THUMB_IDS) {
    const hit = thumbCache.get(thumbKey(url, gray, id));
    if (hit) found[id] = hit;
  }
  return found;
}

/** Для проверок: забыть всё, что помнит модуль. */
export function resetStylePreviewMemory() {
  for (const bitmap of painted.values()) bitmap?.close?.();
  painted.clear();
  thumbCache.clear();
  frames.clear();
}

/* Кадр по адресу: декодируется один раз и служит и кадру, и миниатюрам. */
const frames = new Map();
function loadFrame(url) {
  if (!frames.has(url))
    frames.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve({ image, width: image.naturalWidth || 1280, height: image.naturalHeight || 720 });
        image.onerror = () => {
          frames.delete(url);
          reject(new Error("frame"));
        };
        image.src = url;
      }),
    );
  return frames.get(url);
}

/**
 * Холст `width × height` с кадром в стиле `style` (`null` — без) и серым
 * (`gray`); `null`, если холст не даёт пикселей.
 */
async function paintedCanvas(image, width, height, style, gray) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas);
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  if (!style && !gray) return canvas;
  try {
    const pixels = ctx.getImageData(0, 0, width, height);
    if (style) (await loadPainter())(pixels.data, width, height, style);
    if (gray) grayscaleRgba(pixels.data);
    ctx.putImageData(pixels, 0, 0);
  } catch {
    /* Холст «испачкан» чужим источником — кадр как есть, подпись честная. */
    return null;
  }
  return canvas;
}

/**
 * Рисует кадр `url` в `canvasRef`: в стиле `style` (`null` — без стиля), серым,
 * если `gray`, и как есть, пока зажат «оригинал». `{ ready, supported, busy }`:
 * `supported: false` — 2D-контекста нет; `busy` — стиль ещё считается.
 */
export function useStylePreview(canvasRef, url, style, gray, showOriginal) {
  const scene = useRef(null);
  const [state, setState] = useState({ ready: false, supported: true, busy: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return undefined;
    if (!context2d(canvas)) {
      setState({ ready: false, supported: false, busy: false });
      return undefined;
    }
    let alive = true;
    setState({ ready: false, supported: true, busy: false, url: null });
    loadFrame(url).then(
      (frame) => {
        if (!alive) return;
        /* Новый размер очищает холст даже тем же числом — только если он другой. */
        if (canvas.width !== frame.width) canvas.width = frame.width;
        if (canvas.height !== frame.height) canvas.height = frame.height;
        /* `drawn` — на холсте уже есть этот кадр (в каком-то виде). */
        scene.current = { ...frame, url, drawn: false };
        setState({ ready: true, supported: true, busy: false, url });
      },
      () => alive && setState({ ready: false, supported: false, busy: false }),
    );
    return () => {
      alive = false;
      scene.current = null;
    };
  }, [canvasRef, url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const current = scene.current;
    if (!state.ready || !canvas || !current) return undefined;
    const ctx = context2d(canvas);
    const show = (source) => {
      ctx.clearRect(0, 0, current.width, current.height);
      ctx.drawImage(source, 0, 0, current.width, current.height);
      current.drawn = true;
    };
    const idle = () => setState((previous) => (previous.busy ? { ...previous, busy: false } : previous));
    if (showOriginal || (!style && !gray)) {
      show(current.image);
      idle();
      return undefined;
    }
    const key = paintKey(current.url, style, gray);
    const cached = paintedGet(key);
    if (cached) {
      show(cached);
      idle();
      return undefined;
    }
    let alive = true;
    /* Пока стиль считается — на новом кадре сам кадр, а не чёрный холст; на том же — прежний вид. */
    if (!current.drawn) show(current.image);
    setState((previous) => (previous.busy ? previous : { ...previous, busy: true }));
    /* Работа — после отрисовки выбора: карточка успевает обвестись. Сначала поток, не вышло — здесь. */
    const timer = setTimeout(() => {
      stylePaint({ url: current.url, width: current.width, height: current.height, style, gray, as: "bitmap" })
        .then((result) => result.bitmap || null)
        .catch(() => null)
        .then((fromWorker) => {
          if (fromWorker) return fromWorker;
          if (!alive) return null;
          return paintedCanvas(current.image, current.width, current.height, style, gray).catch(() => null);
        })
        .then((done) => {
          if (!alive) return;
          if (done) paintedSet(key, done);
          show(done || current.image);
          idle();
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [canvasRef, state.ready, state.url, style, gray, showOriginal]);

  return state;
}

/** Ширина миниатюры карточки стиля, px. */
export const STYLE_THUMB_WIDTH = 256;

/**
 * Миниатюры карточек: кадр `url` без стиля и в каждом стиле, серые, если
 * `gray`. `{ "": адрес, "style-comic": адрес, … }` — по мере готовности, по
 * одной в очередь событий: вкладка не замирает. Уже рисованное берётся из
 * памяти модуля сразу, на первой отрисовке; пока для нового кадра или серого
 * рисуется недостающее, прежние картинки остаются на карточках. Без холста —
 * пусто.
 */
export function useStyleThumbs(url, gray) {
  const [thumbs, setThumbs] = useState(() => cachedThumbs(url, gray));
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    /* Не пустота: что уже нарисовано для этого ключа — сразу, остальное — прежнее до замены. */
    const known = cachedThumbs(url, gray);
    setThumbs((previous) => (Object.keys(known).length ? { ...previous, ...known } : previous));
    (async () => {
      let frame;
      try {
        frame = await loadFrame(url);
      } catch {
        return;
      }
      const width = STYLE_THUMB_WIDTH;
      const height = Math.max(1, Math.round((width * frame.height) / frame.width));
      /* Постоянное хранилище: готовые миниатюры этого кадра — одним заходом, рисуем только недостающие. */
      const storeKeyOf = (id) => tileStoreKey("style", `v${TEXTURE_STAGES_VERSION}`, url, id || "orig", gray ? 1 : 0, `w${width}`);
      const kept = await Promise.all(THUMB_IDS.map((id) => (thumbCache.has(thumbKey(url, gray, id)) ? null : readTile(storeKeyOf(id)))));
      if (!alive) return;
      const fromStore = {};
      THUMB_IDS.forEach((id, index) => {
        if (!kept[index]) return;
        thumbCache.set(thumbKey(url, gray, id), kept[index]);
        fromStore[id] = kept[index];
      });
      if (Object.keys(fromStore).length) setThumbs((previous) => ({ ...previous, ...fromStore }));
      for (const id of THUMB_IDS) {
        const key = thumbKey(url, gray, id);
        if (thumbCache.has(key)) continue;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!alive) return;
        /* Поток отдаёт готовый JPEG; не вышло — рисуем здесь и кодируем в `data:`. */
        let data = await stylePaint({ url, width, height, style: id || null, gray, as: "url", quality: 0.86 })
          .then((result) => result.url || "")
          .catch(() => "");
        if (!alive) return;
        if (!data) {
          const canvas = await paintedCanvas(frame.image, width, height, id || null, gray).catch(() => null);
          if (!alive || !canvas) return;
          try {
            data = canvas.toDataURL("image/jpeg", 0.86);
          } catch {
            /* Холст не отдаёт пиксели — карточка без картинки. */
          }
        }
        if (data) {
          thumbCache.set(key, data);
          writeTile(storeKeyOf(id), data);
          setThumbs((previous) => ({ ...previous, [id]: data }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [url, gray]);
  return thumbs;
}
