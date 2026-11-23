import { paintMapScene } from "@modovik/vector-map";
import { createElement as el, useEffect, useReducer, useRef } from "react";

// Режим «test» выбирается один раз при загрузке модуля: в jsdom образцы не рисуются.
const LIVE = import.meta.env.MODE !== "test";

const LIMITS = Object.freeze({
  density: 2, // верхняя граница плотности пикселей
  step: 128, // общий шаг ширины расшифровки
  side: 2048, // предел стороны расшифрованной подложки
  kept: 8, // сколько расшифровок держит кэш
  margin: "200px", // запас показа у IntersectionObserver
  probe: "16px", // размер шрифта в запросе document.fonts.load
  text: 400, // предел склейки текста на один ключ шрифта
});

const noop = () => {};
const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

// Выполнить задачу и проглотить ошибку: образец — украшение, не нарисовался — остаётся фон.
async function swallow(job) {
  try {
    return await job();
  } catch {
    return null;
  }
}

// ---------- расшифрованные подложки: один кэш на все карточки ----------

const pool = new Map();

async function fetchBitmap(href, side) {
  const options = { resizeWidth: side, resizeQuality: "medium" };
  try {
    const reply = await fetch(href);
    return reply.ok ? await createImageBitmap(await reply.blob(), options) : null;
  } catch {
    return null;
  }
}

function remember(key, pending) {
  pool.set(key, pending);
  for (const [stale, old] of pool) {
    if (pool.size <= LIMITS.kept) break;
    pool.delete(stale);
    old.then((bitmap) => bitmap?.close?.());
  }
  return pending;
}

function decode(href, pixels) {
  const side = clamp(Math.ceil(pixels / LIMITS.step) * LIMITS.step, LIMITS.step, LIMITS.side);
  const key = `${href}|${side}`;
  return pool.get(key) ?? remember(key, fetchBitmap(href, side));
}

// ---------- очередь: задачи по одной, каждая своим таймером ----------

const lane = { jobs: [], busy: false };

function nextJob() {
  const job = lane.busy ? undefined : lane.jobs.shift();
  if (!job) return;
  lane.busy = true;
  setTimeout(async () => {
    await swallow(job);
    lane.busy = false;
    nextJob();
  }, 0);
}

function enqueue(task) {
  lane.jobs.push(task);
  nextJob();
}

// ---------- шрифты и картинки сцены ----------

const itemsOf = (layers) => layers.flatMap((layer) => layer.items);
const phrase = (item) => (item.lines?.length ? item.lines.join(" ") : String(item.value ?? ""));

function fontWishes(layers) {
  const wishes = new Map();
  for (const item of itemsOf(layers)) {
    if (item.kind !== "text" || !item.family) continue;
    const key = [item.weight || 400, LIMITS.probe, item.family].join(" ");
    wishes.set(key, `${wishes.get(key) ?? ""}${phrase(item)}`.slice(0, LIMITS.text));
  }
  return wishes;
}

function requestFonts(layers) {
  const faces = globalThis.document?.fonts;
  if (typeof faces?.load !== "function") return [];
  return Array.from(fontWishes(layers), ([key, text]) =>
    Promise.resolve(faces.load(key, text)).catch(noop),
  );
}

function pictureJobs(layers, pxPerUnit) {
  const firstSeen = new Map();
  for (const item of itemsOf(layers)) {
    if (item.kind === "image" && item.href && !firstSeen.has(item.href)) {
      firstSeen.set(item.href, item.width);
    }
  }
  const pictures = new Map(Array.from(firstSeen.keys(), (href) => [href, null]));
  const waits = Array.from(firstSeen, ([href, width]) =>
    decode(href, width * pxPerUnit).then((bitmap) => pictures.set(href, bitmap)),
  );
  return { pictures, waits };
}

// ---------- вписывание кадра в холст ----------

const midpoint = (from, extent, span) => from + extent / 2 - span / 2;
const pixelSize = (extent, ratio) => Math.max(1, Math.round(extent * ratio));
const wholeScene = (scene) => ({ x: 0, y: 0, width: scene.width, height: scene.height });

function viewFor(canvasW, canvasH, area, fit) {
  const choose = fit === "meet" ? Math.min : Math.max;
  const scale = choose(canvasW / area.width, canvasH / area.height);
  const width = canvasW / scale;
  const height = canvasH / scale;
  return {
    x: midpoint(area.x, area.width, width),
    y: midpoint(area.y, area.height, height),
    width,
    height,
  };
}

function withBackdrop(layers, view, backdrop) {
  if (!backdrop) return layers;
  const [base] = layers.filter((layer) => layer.id === "base");
  const { x, y, width, height } = view;
  const field = { kind: "rect", x, y, width, height, fill: backdrop };
  return [{ id: "backdrop", filter: base?.filter, items: [field] }, ...layers];
}

function fitCanvas(canvas, width, height) {
  for (const [side, wanted] of [["width", width], ["height", height]]) {
    if (canvas[side] !== wanted) canvas[side] = wanted;
  }
}

async function paintCard(job, ticket) {
  const { size, scene } = job;
  const width = pixelSize(size.width, size.ratio);
  const height = pixelSize(size.height, size.ratio);
  const view = viewFor(width, height, job.area ?? wholeScene(scene), job.fit);

  const { pictures, waits } = pictureJobs(scene.layers, width / view.width);
  await Promise.all([...waits, ...requestFonts(scene.layers)]);

  const surface = ticket.alive ? job.canvas.getContext("2d") : null;
  if (!surface) return;

  const layers = withBackdrop(scene.layers, view, job.backdrop);
  fitCanvas(job.canvas, width, height);
  paintMapScene(surface, { ...scene, layers }, { view, width, height, images: pictures });
}

// ---------- состояние наблюдателей: размер холста и «карточка показана» ----------

const WATCH_START = { size: null, shown: false };

function watchReducer(state, note) {
  if (note.kind === "visible") return state.shown ? state : { ...state, shown: true };
  const { size } = state;
  if (size && size.width === note.width && size.height === note.height) return state;
  return { ...state, size: { width: note.width, height: note.height, ratio: note.ratio } };
}

// ---------- компонент ----------

export default function MapScenePicture({ scene, frame = null, backdrop = "", fit = "slice" }) {
  const canvasRef = useRef(null);
  const [{ size, shown }, notify] = useReducer(watchReducer, WATCH_START);
  const [fx, fy, fw, fh] = frame ? [frame.x, frame.y, frame.width, frame.height] : [];

  // наблюдатели за размером и за показом; плотность пикселей берётся один раз
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!LIVE || !canvas) return undefined;

    const ratio = Math.min(LIMITS.density, window.devicePixelRatio || 1);
    const watchers = [];

    if (typeof ResizeObserver === "function") {
      const sizing = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) notify({ kind: "size", width, height, ratio });
      });
      sizing.observe(canvas);
      watchers.push(sizing);
    }

    if (typeof IntersectionObserver === "function") {
      const seeing = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          notify({ kind: "visible" });
          seeing.disconnect();
        },
        { rootMargin: LIMITS.margin },
      );
      seeing.observe(canvas);
      watchers.push(seeing);
    } else {
      notify({ kind: "visible" });
    }

    return () => watchers.forEach((watcher) => watcher.disconnect());
  }, []);

  // рисование: задача в общей очереди, при смене входа прежняя помечается мёртвой
  useEffect(() => {
    const canvas = canvasRef.current;
    const idle = !LIVE || !canvas || !size || !shown || !scene;
    if (idle) return undefined;

    const ticket = { alive: true };
    const framed = [fx, fy, fw, fh].some((n) => n !== undefined);
    const area = framed ? { x: fx, y: fy, width: fw, height: fh } : null;
    const job = { canvas, size, scene, area, backdrop, fit };
    enqueue(() => (ticket.alive ? paintCard(job, ticket) : null));
    return () => {
      ticket.alive = false;
    };
  }, [scene, fx, fy, fw, fh, backdrop, fit, size, shown]);

  return el("canvas", { ref: canvasRef, className: "wmc-scene-picture", "aria-hidden": "true" });
}
