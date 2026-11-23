/*
 * Загрузка FX-сцен для окна (`docs/fx-scenes.md`, §7): манифест набора и файлы сцены — через локальный API (`apps/api/src/fx-scenes.js`):
 * окно ходит только на свой origin, а API качает с CDN и сверяет размер и sha256 по манифесту. Адрес файла несёт его хэш, поэтому
 * браузер держит его вечно.
 *
 * Кадр и глубина читаются без перевода цвета (`colorSpaceConversion: "none"`): глубина — не цвет, а закодированные метры, и любое
 * «исправление» браузера сдвинуло бы её.
 */
import { decodeDepth } from "@modovik/fx-scenes/depth.js";
import { parseManifest, parseScene, pickScenes } from "@modovik/fx-scenes/format.js";

export const FX_SCENES_API = "/api/fx-scenes";
/* Как долго окно считает манифест свежим: новые сцены подхватываются при следующем входе в редактор. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;
/* Сколько ждём ответ: пока он не пришёл, редактор показывает экран загрузки, и зависший запрос не должен держать его вечно. Манифест не ответил за
   15 с — сцен нет (прежняя сцена редактора), файл сцены не пришёл за минуту — отказ с названием файла. */
const MANIFEST_TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 60_000;

/** Ждёт `promise` не дольше `ms`; позже — отказ `Error(what)`. Таймер убирается, как только ответ пришёл. */
function within(promise, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Адрес файла сцены на локальном API; `name` — ключ `entry.files` (`clean.png`, `frames/01-depth.png`), он идёт одним сегментом. */
export function sceneFileUrl(entry, name, base = FX_SCENES_API) {
  return `${base}/file/${entry.mode}/${entry.weaponClass}/${entry.id}/${encodeURIComponent(name)}?sha=${entry.files[name].sha256}`;
}

/** Картинка из байт → холст с её пикселями без перевода цвета. */
export async function decodePng(blob) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(blob: Blob) => Promise<HTMLCanvasElement>} [options.decode] — PNG → холст (в тестах подставляется)
 * @param {() => number} [options.now]
 * @param {{ manifest?: number, file?: number }} [options.timeouts] — сколько ждать манифест и один файл сцены, мс (в тестах — короче)
 */
export function createFrameSource({ fetchImpl = (...args) => fetch(...args), decode = decodePng, now = () => Date.now(), base = FX_SCENES_API, timeouts = {} } = {}) {
  const manifestTimeout = timeouts.manifest ?? MANIFEST_TIMEOUT_MS;
  const fileTimeout = timeouts.file ?? FILE_TIMEOUT_MS;
  let manifest = null;
  let manifestAt = 0;
  let pending = null;

  /** Манифест набора или `null`: сцен нет (нет медиа-хоста, набор не выложен, CDN недоступен). Сбой не бросает — окно остаётся со своим кадром. */
  async function readManifest() {
    if (manifest && now() - manifestAt < MANIFEST_TTL_MS) return manifest;
    pending ??= (async () => {
      try {
        const response = await within(fetchImpl(`${base}/manifest`, { cache: "no-store" }), manifestTimeout, "манифест не ответил");
        if (!response.ok) return null;
        manifest = parseManifest(await within(response.text(), manifestTimeout, "манифест не дочитан"));
        manifestAt = now();
      } catch {
        /* прежний манифест, если был */
      }
      return manifest;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** Сцены режима из набора: записи манифеста в порядке показа. */
  async function list(query) {
    const current = await readManifest();
    return current ? pickScenes(current, query) : [];
  }

  async function bytes(entry, name) {
    const response = await within(fetchImpl(sceneFileUrl(entry, name, base)), fileTimeout, `${entry.id}/${name}: нет ответа`);
    if (!response.ok) throw new Error(`${entry.id}/${name}: ${response.status}`);
    return response;
  }

  /* Пара кадр + глубина одного момента: размеры сверяются со `scene.json`, глубина — в метры. `tick` — файл скачан (экран загрузки считает файлы). */
  async function loadPair(entry, scene, cleanName, depthName, tick) {
    const [clean, depthImage] = await Promise.all([
      bytes(entry, cleanName).then((response) => response.blob()).then((blob) => (tick(), decode(blob))),
      bytes(entry, depthName).then((response) => response.blob()).then((blob) => (tick(), decode(blob))),
    ]);
    const { width, height } = scene.resolution;
    if (clean.width !== width || clean.height !== height) throw new Error(`${entry.id}/${cleanName}: ${clean.width}×${clean.height}, в scene.json ${width}×${height}`);
    if (depthImage.width !== width || depthImage.height !== height) throw new Error(`${entry.id}/${depthName}: ${depthImage.width}×${depthImage.height}, в scene.json ${width}×${height}`);
    const rgba = depthImage.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    return { image: clean, depth: { width, height, data: decodeDepth(rgba, width, height, scene.depth.far) } };
  }

  /**
   * Файлы сцены: `{ scene, image, depth, frames }` — готово к `frame-stage.setFrame`. У килла `frames` — серия `[{ index, offsetMs, bones, image, depth }]`
   * (`image` и `depth` сцены — её первый кадр), у остальных `frames` — `null`. Бросает с названием файла, если что-то не так.
   */
  async function load(entry, { onProgress = null } = {}) {
    /* Скачано файлов из скольких назвал манифест (`stencil.png`, если он есть, окно не берёт — его в счёте нет). */
    const total = Object.keys(entry.files).filter((name) => name !== "stencil.png").length;
    let done = 0;
    const tick = () => {
      done += 1;
      onProgress?.(Math.min(done, total), total);
    };
    const scene = parseScene(await (await bytes(entry, "scene.json")).text());
    tick();
    if (scene.id !== entry.id || scene.mode !== entry.mode || scene.weapon.class !== entry.weaponClass) throw new Error(`${entry.id}/scene.json: сцена не та, что в манифесте`);
    if (scene.mode === "kill") {
      const frames = await Promise.all(scene.frames.map(async (frame) => ({ index: frame.index, offsetMs: frame.offsetMs, bones: frame.bones, ...(await loadPair(entry, scene, frame.clean, frame.depth, tick)) })));
      return { scene, image: frames[0].image, depth: frames[0].depth, frames };
    }
    return { scene, ...(await loadPair(entry, scene, "clean.png", "depth.png", tick)), frames: null };
  }

  return { list, load, readManifest };
}

/** Общий источник окна: манифест читается один раз на несколько редакторов. */
let shared = null;
export const frameSource = () => (shared ??= createFrameSource());
