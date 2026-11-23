// Цвет подписей на карте выбирается по фону под ними: карта без подписей
// рисуется в маленький холст, читается обратно, а пакет карты по яркости под
// рамкой каждой подписи выбирает цвет, обводку и ореол. Замер идёт в потоке,
// а если потока нет или он упал — в окне.
import { measureTextAdvance } from "./world-map-text-measure.js";
import { paintMapScene, labelTonesFromPixels } from "@modovik/vector-map";
import { useState, useRef, useEffect } from "react";
import { perfTimedAsync } from "../../../perf-count.js";

// Слои под подписями (порядок задаёт перечень, а не сцена).
const UNDER_LABELS = "sea base tint paint grid zone-fills zone-glows zones markers".split(" ");
const LABEL_LAYERS = ["zone-labels", "marker-labels"];
const SCALE = 1; // точек холста на единицу сцены

const TIMING = Object.freeze({
  settleMs: 140, // пауза после правки: подряд идущие правки склеиваются
  patienceMs: 480, // но замер ждёт не дольше этого от первой правки
  bitmapLimit: 8,
  bitmapForgetMs: 90000,
});

// ---- подписи сцены ----

function* droppedItems(scene) {
  yield* scene?.droppedLabels || [];
}

const labelsToMeasure = (scene) => {
  const inLayers = Array.from(scene?.layers || [])
    .filter((layer) => LABEL_LAYERS.includes(layer.id))
    .flatMap((layer) => [...layer.items])
    .filter((item) => item.tone);
  const dropped = [...droppedItems(scene)].filter((item) => item?.tone);
  return inLayers.concat(dropped);
};

// Ширина подписи шрифтом окна: самая широкая строка; нет замера у строки — null.
const labelWidth = (label) => {
  const rows = Array.isArray(label.lines) && label.lines.length > 0 ? label.lines : [label.value];
  const gap = Number(label.letterSpacing) || 0;
  const advances = rows.map((row) =>
    measureTextAdvance({ value: row, family: label.family, weight: label.weight }),
  );
  if (!advances.every(Boolean)) return null;
  const widths = rows.map(
    (row, index) => advances[index] * label.size + Math.max(0, String(row).length - 1) * gap,
  );
  return Math.max(...widths);
};

// ---- картинки подложки (в окне): кэш из восьми, забывание через 90 с ----

const decodeBitmap = (href, width, height) =>
  new Promise((resolve) => resolve(fetch(href)))
    .then((response) => (response.ok ? response.blob() : null))
    .then(
      (blob) =>
        blob &&
        createImageBitmap(blob, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "medium",
        }),
    )
    .catch(() => null);

const makeBitmapCache = () => {
  const entries = new Map();
  let forgetTimer = null;

  const closeLater = (pending) => {
    pending.then((bitmap) => bitmap?.close?.());
  };

  const rearm = () => {
    if (forgetTimer !== null) clearTimeout(forgetTimer);
    forgetTimer = setTimeout(() => {
      forgetTimer = null;
      entries.forEach(closeLater);
      entries.clear();
    }, TIMING.bitmapForgetMs);
  };

  // Лишние записи (самые старые) вытесняются и закрываются.
  const trim = () => {
    if (entries.size <= TIMING.bitmapLimit) return;
    const [oldest, pending] = entries.entries().next().value;
    entries.delete(oldest);
    closeLater(pending);
    trim();
  };

  const request = (href, rawWidth, rawHeight) => {
    rearm();
    const [width, height] = [rawWidth, rawHeight].map((side) => Math.max(1, Math.round(side)));
    const key = `${href}|${width}x${height}`;
    if (!entries.has(key)) {
      entries.set(key, decodeBitmap(href, width, height));
      trim();
    }
    return entries.get(key);
  };

  return { request };
};

const bitmapCache = makeBitmapCache();

const underImages = async (scene) => {
  const wanted = Array.from(scene.layers || [])
    .filter((layer) => UNDER_LABELS.includes(layer.id))
    .flatMap((layer) => [...layer.items])
    .filter((item) => item.kind === "image" && item.href);
  const images = new Map();
  await Promise.all(
    wanted.map((item) =>
      bitmapCache
        .request(item.href, item.width, item.height)
        .then((bitmap) => images.set(item.href, bitmap)),
    ),
  );
  return images;
};

// ---- замер в окне (запасной путь) ----

const surface = (width, height) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  return typeof document === "undefined"
    ? null
    : Object.assign(document.createElement("canvas"), { width, height });
};

const tonesInWindow = async (scene, labels) => {
  const [width, height] = [scene.width, scene.height].map((side) => Math.max(1, Math.round(side)));
  const context = surface(width, height)?.getContext("2d", { willReadFrequently: true });
  if (!context?.getImageData) return null;

  const images = await underImages(scene);
  paintMapScene(context, scene, { width, height, images, layers: UNDER_LABELS });
  const pixels = context.getImageData(0, 0, width, height);
  return labelTonesFromPixels(labels, pixels, { scale: SCALE, measure: labelWidth });
};

// ---- замер в потоке ----

const makeToneBridge = () => {
  const available = typeof Worker !== "undefined";
  const waiting = new Map(); // id -> resolve(таблица | null)
  let worker = null;
  let retired = false; // создать не вышло или упал: больше не пробуем
  let requests = 0;

  const settleAll = (value) => {
    const resolvers = [...waiting.values()];
    waiting.clear();
    resolvers.forEach((resolve) => resolve(value));
  };

  const onAnswer = (event) => {
    const answer = event.data;
    const resolve = answer && waiting.get(answer.id);
    if (!resolve) return;
    waiting.delete(answer.id);
    resolve(answer.failed ? null : answer.tones);
  };

  const onCrash = (born) => {
    born.terminate();
    worker = null;
    retired = true;
    settleAll(null);
  };

  const open = () => {
    if (!available || retired) return null;
    if (worker) return worker;
    try {
      // Адрес и тип потока — часть контракта сборки: менять запись нельзя.
      const born = new Worker(new URL("./world-map-label-tones-worker.js", import.meta.url), { type: "module" });
      born.onmessage = onAnswer;
      born.onerror = () => onCrash(born);
      worker = born;
    } catch {
      retired = true;
    }
    return worker;
  };

  const request = (scene, labels) => {
    const target = open();
    if (!target) return Promise.resolve(null);
    const widths = {};
    labels.forEach((label) => {
      widths[label.id] = labelWidth(label);
    });
    return new Promise((resolve) => {
      requests += 1;
      const id = requests;
      waiting.set(id, resolve);
      try {
        target.postMessage({
          id,
          scene: {
            width: scene.width,
            height: scene.height,
            layers: (scene.layers || []).filter((layer) => UNDER_LABELS.includes(layer.id)),
          },
          labels,
          widths,
          scale: SCALE,
          layers: UNDER_LABELS,
        });
      } catch {
        waiting.delete(id);
        resolve(null);
      }
    });
  };

  return { request };
};

const toneBridge = makeToneBridge();

// ---- публичное ----

const computeLabelTones = async (scene, { worker = true } = {}) => {
  const labels = labelsToMeasure(scene);
  if (labels.length === 0) return {};
  const fromWorker = worker ? await toneBridge.request(scene, labels) : null;
  return fromWorker || tonesInWindow(scene, labels);
};

const NOT_MEASURED = { tones: null, scene: null };

// Таблицы равны, если совпадают ключи и fill/stroke/halo каждой записи.
const TONE_FIELDS = ["fill", "stroke", "halo"];

const sameEntry = (old, fresh) =>
  Boolean(old) && TONE_FIELDS.every((field) => old[field] === fresh[field]);

const sameTones = (before, after) => {
  if (before === after) return true;
  if (!before || !after) return false;
  const names = Object.keys(after);
  return (
    Object.keys(before).length === names.length &&
    names.every((name) => sameEntry(before[name], after[name]))
  );
};

// Замер сцены с подстановкой; любая ошибка — как «замера нет».
const measureScene = async (scene, book) => {
  try {
    const make = book.prepare;
    const input = make ? make(scene) : scene;
    return await perfTimedAsync("map.tones", () => computeLabelTones(input));
  } catch {
    return null;
  }
};

const acceptedState = (before, tones, scene) => ({
  tones: tones && !sameTones(before.tones, tones) ? tones : before.tones,
  scene,
});

const useLabelTonesState = (scene, prepare = null) => {
  const [state, setState] = useState(NOT_MEASURED);
  const track = useRef({ prepare, run: 0, since: null });

  useEffect(() => {
    track.current.prepare = prepare;
  });

  useEffect(() => {
    if (!scene) return undefined;
    const book = track.current;
    book.run += 1;
    const run = book.run;
    const now = Date.now();
    book.since ??= now;
    const delay = now - book.since >= TIMING.patienceMs ? 0 : TIMING.settleMs;

    const timer = setTimeout(async () => {
      book.since = null;
      const tones = await measureScene(scene, book);
      if (run === book.run) setState((before) => acceptedState(before, tones, scene));
    }, delay);
    return () => clearTimeout(timer);
  }, [scene]);

  return state;
};

const useLabelTones = (scene) => useLabelTonesState(scene).tones;

const NOBODY_WAITS = new Set();

// Какие подписи пока рисовать нельзя: с цветом по фону, но без замера.
const pendingLabelIds = (scene, state) => {
  if (!scene || state.scene === scene || import.meta.env.MODE === "test") return NOBODY_WAITS;
  const known = state.tones || {};
  const ids = [...scene.layers]
    .filter((layer) => LABEL_LAYERS.includes(layer.id))
    .flatMap((layer) => [...layer.items])
    .filter((item) => item.tone && !known[item.id])
    .map((item) => item.id);
  return ids.length > 0 ? new Set(ids) : NOBODY_WAITS;
};

export { computeLabelTones, pendingLabelIds, useLabelTones, useLabelTonesState };
