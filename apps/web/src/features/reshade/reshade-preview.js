/*
 * Превью пресетов ReShade (ТЗ 17.10, задача 8): настоящий кадр GTA V без
 * эффектов, пропущенный через формулы шейдера Astral.fx на процессоре
 * (`@modovik/optimizer/reshade-emulation.js`). Это не кадр игры с пресетом —
 * под превью об этом написано прямо (`previewCaption`).
 *
 * Кадр-основа — `dlss5-before`: скриншот самого ReShade (PrintScreen) без
 * DLSS 5, снятый стендом «В игре» (`assets/reshade-shots/README.md`). Других
 * кадров без эффектов в поставке нет, поэтому превью одно и то же для всех
 * пресетов.
 *
 * Считается в фоновом потоке, по одному пресету за раз и один раз за запуск
 * окна: результат лежит готовым холстом. Потока нет (тесты) или он не
 * поднялся — то же самое в окне, уступая ему между пресетами.
 */

import { applyPresetToFrame } from "@modovik/optimizer/reshade-emulation.js";

import { reshadeShotUrl } from "./ReshadeShots.jsx";

export const PREVIEW_FRAME = "dlss5-before";

/** Адрес кадра-основы или `null`, если его нет в поставке. */
export const previewFrameUrl = () => reshadeShotUrl(PREVIEW_FRAME);

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

let basePromise = null;

/* Кадр-основа: пиксели RGBA. `null` — кадра нет или холст недоступен (тесты). */
function loadBase() {
  if (basePromise) return basePromise;
  basePromise = new Promise((resolve) => {
    const url = previewFrameUrl();
    if (!url || typeof Image !== "function" || typeof document === "undefined") {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context || !canvas.width || !canvas.height) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ width: canvas.width, height: canvas.height, data });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  return basePromise;
}

/* ---------------------------------------------------------------- поток */

let worker = null;
let workerTried = false;
let baseSent = null;
let sequence = 0;
const pending = new Map();

function startWorker() {
  if (workerTried) return worker;
  workerTried = true;
  if (typeof Worker !== "function") return null;
  try {
    worker = new Worker(new URL("./reshade-preview-worker.js", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (event) => {
    const { id, result, error } = event.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(result);
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    abandonWorker();
  };
  return worker;
}

/* Поток не поднялся — ждущие задания доделываются в окне, дальше работа идёт там же. */
function abandonWorker() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  baseSent = null;
  workerBase = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const entry of waiting) entry.retry();
}

function post(message, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = (sequence += 1);
    pending.set(id, { resolve, reject, retry: () => reject(new Error("worker-lost")) });
    worker.postMessage({ ...message, id }, transfer);
  });
}

async function computeInWorker(base, presetId) {
  if (baseSent !== base) {
    /* Копия: исходный массив нужен окну, поток получает свой. */
    const copy = base.data.slice();
    await post({ type: "base", width: base.width, height: base.height, data: copy.buffer }, [copy.buffer]);
    baseSent = base;
  }
  const buffer = await post({ type: "preset", presetId });
  return new Uint8ClampedArray(buffer);
}

/* Кадр-основа в потоке: `{ width, height }`, если поток скачал и декодировал его
   сам; `null` — потока нет или он не смог, тогда кадр декодирует окно. */
let workerBase = null;
function loadBaseInWorker() {
  if (workerBase) return workerBase;
  const url = previewFrameUrl();
  workerBase =
    url && typeof window !== "undefined" && startWorker()
      ? post({ type: "base-url", url: new URL(url, window.location.href).href }).catch(() => null)
      : Promise.resolve(null);
  return workerBase;
}

async function compute(base, presetId) {
  if (startWorker()) {
    try {
      return await computeInWorker(base, presetId);
    } catch {
      abandonWorker();
    }
  }
  await breathe();
  return applyPresetToFrame(base.data, base.width, base.height, presetId);
}

/* ---------------------------------------------------------------- кэш */

const results = new Map();
let queue = Promise.resolve();

/**
 * Холст с кадром, обработанным пресетом (1280×720 с кадра-основы), или `null`,
 * если превью посчитать нечем. Каждый пресет считается один раз за запуск.
 */
export function presetPreview(presetId) {
  if (!results.has(presetId)) {
    const job = queue.then(async () => {
      let size = await loadBaseInWorker();
      let pixels = null;
      if (size) {
        try {
          pixels = new Uint8ClampedArray(await post({ type: "preset", presetId }));
        } catch {
          size = null;
        }
      }
      if (!size) {
        const base = await loadBase();
        if (!base) return null;
        pixels = await compute(base, presetId);
        size = base;
      }
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.putImageData(new ImageData(pixels, size.width, size.height), 0, 0);
      return canvas;
    });
    const settled = job.catch(() => null);
    queue = settled;
    results.set(presetId, settled);
  }
  return results.get(presetId);
}
