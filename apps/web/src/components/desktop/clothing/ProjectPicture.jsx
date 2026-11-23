/*
 * Картинка вещи проекта в «На что поставить?» (задача 2 ТЗ 06.10.2026).
 *
 * Окно чужих картинок не грузит (img-src 'self'): картинку с CDN проекта
 * приносит Desktop (`readProjectPicture`), окно показывает её адресом blob:,
 * который живёт, пока открыто окно. Свой адрес (снимок каталога) — как есть.
 * Нет картинки или её не достать — значок вещи.
 */

import { useEffect, useState } from "react";
import { TShirt } from "../../ui/icons.jsx";
import { readProjectPicture } from "../../../api.js";

const REMOTE = /^https:\/\//i;
const pictures = new Map();

/*
 * Очередь к Desktop (25.10.2026, сетка «На что поставить?»): одна картинка — один обмен с главным процессом, а плиток в сетке тысячи. Без очереди
 * прокрутка выдавала бы их разом и забила канал: одновременно идут не больше восьми, остальные ждут.
 *
 * 28.10.2026, владелец: «при прокрутке фото догружаются невероятно долго». Очередь была FIFO и брала всё, что плитка хоть раз просила: быстрая прокрутка
 * набирала сотни просьб, и плитки на экране ждали за теми, что остались позади. Теперь: (1) первой идёт последняя пачка просьб — то, к чему доехали
 * сейчас; внутри пачки — сверху вниз; (2) просьба плитки, что ушла (сетку пересобрали, окно закрыли), пока стояла в очереди, не берётся вовсе;
 * (3) картинка, что уже есть, второй раз не просится.
 *
 * 14.11.2026, владелец: «чтобы фотки быстро прогружались, а не очень долго в непрогрузе» (замер `scripts/perf/baseline/clothing-photos.mjs`, закрытая сборка ×4,
 * настоящий Desktop и сеть; разбор — `docs/speed/CLOTHING-PHOTOS.md`): (4) просьба «наперёд» (`ahead`) и заготовка (`prefetchProjectPictures`) — картинки, что понадобятся
 * следом (плитки за краем экрана, расцветки вещи под курсором), едут в простое очереди и не отнимают места у плиток на экране; плитка, что их попросит потом, получает готовую
 * картинку без обмена; (5) память готовых картинок с потолком `LIMIT`: то, что никто не показывает, отпускается с давних. Отказ («у источника фото нет») окно не запоминает:
 * его помнит Desktop (`project-clothing.js`), второй вопрос по тому же адресу отвечает отказом без сети; отказ по сети (обрыв, сайт отдыхает) окно не запоминает тем более — он
 * проходит. Обменов разом — не больше восьми: у CDN при 12–24 одновременных обменах обмен занимал 1–9 с, при восьми и меньше — доли секунды (замер стороны Desktop,
 * `clothing-photos-net.mjs`).
 */
const PARALLEL = 8;
/* Заготовка и просьбы наперёд занимают не больше этого числа обменов разом и только когда никто на экране не ждёт: свободные места остаются плиткам. */
const PREFETCH_PARALLEL = 3;
/* Сколько просьб наперёд может ждать в простое: сильно прокрученный список не копит сотни картинок, мимо которых уже проехали. */
const IDLE_LIMIT = 120;
/* Просьбы в одну пачку, если пришли с промежутком не больше этого: плитки одного кадра идут сверху вниз, а не вверх ногами. */
const BURST_MS = 60;
/*
 * Тихая пауза перед просьбами наперёд: они начинаются не раньше, чем через столько после последней срочной просьбы или её ответа. Замер ×4 (стенд `clothing-photos.mjs`, настоящая сеть): без
 * паузы просьбы наперёд стартовали на первых же освободившихся местах и шли вровень с плитками на экране — на 22 ответа вместо 10 главный поток окна успевал раскодировать и отрисовать
 * лишние картинки как раз тогда, когда ждали первые, и первая картинка приходила на 0,4–0,6 с позже. Теперь наперёд едет, когда экран уже собран.
 */
const IDLE_QUIET_MS = 500;
/* Сколько готовых картинок держит окно; лишние, что никто не показывает, отпускаются с давних. */
export const LIMIT = 1200;
let running = 0;
let clock = 0;
let idleQuiet = IDLE_QUIET_MS;
let lastUrgent = -Infinity;
let idleTimer = null;
const bursts = [];
const idle = [];

/** Тихая пауза перед просьбами наперёд, мс (тесты ставят свою). */
export function setIdleQuiet(ms) {
  idleQuiet = ms;
}

function start(entry) {
  entry.started = true;
  running += 1;
  readProjectPicture({ url: entry.src })
    .then(({ bytes, type }) => {
      entry.url = URL.createObjectURL(new Blob([bytes], { type: type || "image/png" }));
      entry.resolve(entry.url);
      trim();
    })
    .catch(() => {
      pictures.delete(entry.src);
      entry.resolve("");
    })
    .finally(() => {
      running -= 1;
      if (!entry.fromIdle) lastUrgent = performance.now();
      pump();
    });
}

/* Нужна ли ещё просьба: плитка ждёт её, или это заготовка окна (`keep`) / срочная заготовка (`eager`). */
const wanted = (entry) => entry.interest > 0 || entry.eager || entry.keep;

function pump() {
  while (running < PARALLEL && bursts.length) {
    const burst = bursts[bursts.length - 1];
    const entry = burst.items.shift();
    if (!burst.items.length) bursts.pop();
    if (!entry) continue;
    entry.queued = false;
    if (!wanted(entry) || entry.started || entry.url) continue;
    start(entry);
  }
  /* Наперёд — только в простое: на экране никто не ждёт, а обменов идёт меньше `PREFETCH_PARALLEL`, и после последней срочной просьбы прошла тихая пауза. */
  while (!bursts.length && running < PREFETCH_PARALLEL && idle.length) {
    const quiet = idleQuiet - (performance.now() - lastUrgent);
    if (quiet > 0) {
      if (idleTimer === null)
        idleTimer = setTimeout(() => {
          idleTimer = null;
          pump();
        }, quiet + 5);
      break;
    }
    const entry = idle.shift();
    if (!entry) continue;
    entry.prefetched = false;
    if (!wanted(entry) || entry.started || entry.url) continue;
    entry.fromIdle = true;
    start(entry);
  }
}

/* Лишние готовые картинки отпускаются: давние (по `touched`), которые сейчас никто не показывает. */
function trim() {
  if (pictures.size <= LIMIT) return;
  const spare = [...pictures.values()].filter((entry) => entry.url && entry.interest <= 0).sort((a, b) => a.touched - b.touched);
  for (const entry of spare) {
    if (pictures.size <= LIMIT) break;
    URL.revokeObjectURL(entry.url);
    pictures.delete(entry.src);
  }
}

function entryOf(src) {
  let entry = pictures.get(src);
  if (!entry) {
    entry = { src, url: "", interest: 0, queued: false, prefetched: false, eager: false, keep: false, started: false, resolve: null, pending: null, touched: 0 };
    entry.pending = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    pictures.set(src, entry);
  }
  entry.touched = clock += 1;
  return entry;
}

/** Положить адрес в простой очереди; лишнее сверх `IDLE_LIMIT` (самое давнее) отбрасывается. */
function putIdle(entry) {
  entry.prefetched = true;
  idle.push(entry);
  while (idle.length > IDLE_LIMIT) {
    const dropped = idle.shift();
    if (dropped) dropped.prefetched = false;
  }
}

/**
 * Просьба о картинке: плитка в очереди, пока кому-то нужна. Возвращает запись (`pending` — адрес blob: или пусто). `ahead` — плитка ещё за краем экрана: адрес едет в простое
 * (до `PREFETCH_PARALLEL` обменов), а как только плитка выйдет на экран, просьба повторяется без `ahead` и перебивает остальное.
 */
function acquire(src, ahead = false) {
  const entry = entryOf(src);
  entry.interest += 1;
  if (!ahead) lastUrgent = performance.now();
  if (!entry.url && !entry.started) {
    if (ahead) {
      if (!entry.queued && !entry.prefetched) putIdle(entry);
    } else if (!entry.queued || entry.eager || entry.prefetched) {
      /* Адрес из заготовки или простоя, которого ещё не взяли, плитка на экране переставляет в свою пачку: она идёт первой, а не там, где лежала заготовка. */
      entry.eager = false;
      entry.queued = true;
      const now = performance.now();
      const last = bursts[bursts.length - 1];
      if (last && now - last.at <= BURST_MS) {
        last.items.push(entry);
        last.at = now;
      } else bursts.push({ at: now, items: [entry] });
    }
    pump();
  }
  return entry;
}

const release = (entry) => {
  entry.interest = Math.max(0, entry.interest - 1);
};

/**
 * Заготовка картинок: картинки приезжают в память окна раньше, чем плитка их попросит, и плитка получает готовое. Первые `eager` адресов идут сразу, пачкой на общих основаниях
 * (картинки, что нужны вот-вот: первый экран сетки, расцветки вещи под курсором), остальные — в простое очереди (следующие экраны). Плитка на экране, что попросит адрес из заготовки,
 * забирает его себе без обмена, если он уже едет, или обгоняет остальное в очереди. Известное и уже едущее — пропускается. Нужна одна лишь связь с Desktop;
 * нет её — заготовка тихо молчит.
 */
export function prefetchProjectPictures(urls, { eager = 0 } = {}) {
  let at = 0;
  const now = [];
  for (const src of urls || []) {
    if (!REMOTE.test(String(src || ""))) continue;
    const known = pictures.get(src);
    if (known && (known.url || known.started || known.queued || known.prefetched)) continue;
    const entry = entryOf(src);
    entry.keep = true;
    if (at < eager) {
      entry.eager = true;
      entry.queued = true;
      now.push(entry);
    } else putIdle(entry);
    at += 1;
  }
  if (now.length) bursts.push({ at: performance.now(), items: now });
  pump();
}

/** Заготовка окна больше не нужна (список сменился, окно закрыли): то, что ещё не поехало и никому не нужно, из очереди выбывает. Просьбы плиток остаются. */
export function cancelPrefetch() {
  for (const entry of pictures.values()) {
    if (entry.url || entry.started) continue;
    entry.keep = false;
    entry.eager = false;
  }
  for (let at = idle.length - 1; at >= 0; at -= 1) {
    if (wanted(idle[at])) continue;
    idle[at].prefetched = false;
    idle.splice(at, 1);
  }
  for (const burst of bursts) {
    for (let at = burst.items.length - 1; at >= 0; at -= 1) {
      if (wanted(burst.items[at])) continue;
      burst.items[at].queued = false;
      burst.items.splice(at, 1);
    }
  }
  for (let at = bursts.length - 1; at >= 0; at -= 1) if (!bursts[at].items.length) bursts.splice(at, 1);
}

/** Забыть очередь и картинки в памяти (тесты). */
export function resetProjectPictures() {
  for (const entry of pictures.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  pictures.clear();
  bursts.length = 0;
  idle.length = 0;
  clearTimeout(idleTimer);
  idleTimer = null;
  lastUrgent = -Infinity;
  idleQuiet = IDLE_QUIET_MS;
  running = 0;
  clock = 0;
}

/** Готовая картинка из памяти окна (адрес blob:) или пустая строка: чтобы плитка, у которой картинка уже есть, не мигала серым местом. */
export const readyProjectPicture = (src) => pictures.get(String(src || ""))?.url || "";

/**
 * Просьба наперёд от плитки, что в запасе прокрутки, но ещё не на экране (15.11.2026): адрес едет в простое очереди, плитка при этом ничего не монтирует. Как только она выйдет на
 * экран, её `ProjectPicture` просит срочно и забирает адрес из простоя. Плитка на экране сюда не попадает ни на кадр: `ProjectPicture` монтируется только у неё, `on` выключается раньше.
 */
export function useAheadPicture(src, on) {
  const value = String(src || "");
  const remote = REMOTE.test(value);
  useEffect(() => {
    if (!on || !remote || pictures.get(value)?.url) return undefined;
    const entry = acquire(value, true);
    return () => release(entry);
  }, [value, remote, on]);
}

/**
 * Адрес картинки для `<img>` и ответ Desktop по ней: `url` — свой сразу, с сайта проекта — когда принесут; `settled` — Desktop уже ответил (картинки нет — `url` пуст),
 * до ответа картинка ещё едет.
 */
export function useProjectPictureState(src) {
  const value = String(src || "");
  const remote = REMOTE.test(value);
  const [state, setState] = useState(() => ({
    url: remote ? pictures.get(value)?.url || "" : value,
    settled: !remote || Boolean(pictures.get(value)?.url),
  }));
  useEffect(() => {
    if (!remote) {
      setState({ url: value, settled: true });
      return undefined;
    }
    const known = pictures.get(value)?.url;
    if (known) {
      pictures.get(value).touched = clock += 1;
      setState({ url: known, settled: true });
      return undefined;
    }
    let alive = true;
    setState({ url: "", settled: false });
    const entry = acquire(value);
    void entry.pending.then((next) => {
      if (alive) setState({ url: next, settled: true });
    });
    return () => {
      alive = false;
      release(entry);
    };
  }, [value, remote]);
  return state;
}

/** Адрес картинки для `<img>`: свой — сразу, с сайта проекта — когда принесут. */
export const useProjectPicture = (src) => useProjectPictureState(src).url;

/**
 * `fallback` — картинки нет (не достать); `pendingFallback` — пока она едет (по умолчанию то же самое). Пара «вещь → заменёнка» ставит на `fallback` снимок вещи из игры,
 * а пока картинка едет, держит значок: снимок просится только тогда, когда картинки с CDN действительно нет. Плитка сетки ставит на `pendingFallback` серое место.
 */
export default function ProjectPicture({ src, fallback = <TShirt />, pendingFallback = undefined, alt = "", onLost = null }) {
  const { url, settled } = useProjectPictureState(src);
  /* Картинку не достать (`onLost`): сетке выбора такая плитка не нужна. */
  const lost = settled && !url;
  useEffect(() => {
    onLost?.(lost);
  }, [lost, onLost]);
  if (url) return <img src={url} alt={alt} loading="lazy" decoding="async" />;
  return settled || pendingFallback === undefined ? fallback : pendingFallback;
}
