/*
 * Разобранные GLB «Выборочных»: штатная модель ствола и модели скинов держатся между кадрами и скинами.
 *
 * «Сравнить со штатным» раньше при каждом включении и при каждой смене скина заново качал и разбирал обе модели (штатную — тоже),
 * хотя штатная одна на ствол. Теперь разбор живёт здесь: первая загрузка модели — сеть и разбор GLB (`GLTFLoader` + meshopt),
 * остальные — клон готовой сцены (геометрия и материалы общие, клон — только дерево узлов и его положение). Кэш хранит
 * несколько последних моделей и освобождает видеопамять, когда модель вытесняется и ею никто не пользуется.
 *
 * Модуль тяжёлый (three), поэтому грузится лениво: при открытии ствола — в простое (`warmModels`), иначе — при включении сравнения.
 */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/* Штатная + скин, который смотрят, + пара соседей: больше не нужно, GLB стволов — сотни килобайт каждый. */
export const CACHE_LIMIT = 6;

const entries = new Map();
let loader = null;

const loaderOf = () => {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
};

function free(root) {
  root?.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material))
        if (value?.isTexture) value.dispose();
      material.dispose?.();
    }
  });
}

/* Вытесняет самые давние модели, которыми никто не пользуется; занятые остаются до освобождения. */
function trim() {
  for (const [url, entry] of entries) {
    if (entries.size <= CACHE_LIMIT) return;
    if (entry.uses > 0) continue;
    entries.delete(url);
    free(entry.scene);
  }
}

function entryOf(url) {
  let entry = entries.get(url);
  if (entry) {
    /* Свежая — в конец порядка вставки: вытесняется последней. */
    entries.delete(url);
    entries.set(url, entry);
    return entry;
  }
  entry = { uses: 0, scene: null, promise: null };
  entry.promise = loaderOf()
    .loadAsync(url)
    .then((gltf) => {
      entry.scene = gltf.scene;
      return entry;
    })
    .catch((error) => {
      if (entries.get(url) === entry) entries.delete(url);
      throw error;
    });
  entries.set(url, entry);
  trim();
  return entry;
}

/**
 * Модель по адресу: клон разобранной сцены и `release` — отдать её обратно. Первый вызов качает и разбирает, следующие
 * отдают клон сразу. Ошибка загрузки пробрасывается и в кэше не остаётся.
 * @returns {Promise<{ scene: import("three").Object3D, release: () => void }>}
 */
export async function loadModel(url) {
  const entry = entryOf(url);
  entry.uses += 1;
  let given = false;
  const release = () => {
    if (given) return;
    given = true;
    entry.uses -= 1;
    if (entry.uses === 0 && entries.get(url) !== entry) free(entry.scene);
    else trim();
  };
  try {
    await entry.promise;
  } catch (error) {
    release();
    throw error;
  }
  return { scene: entry.scene.clone(true), release };
}

/** Разобрать модели заранее (штатная и выбранный скин): ошибки молча — настоящая загрузка при включении скажет сама. */
export function warmModels(urls) {
  for (const url of urls) if (url) entryOf(url).promise.catch(() => {});
}

/** Соседние скины — только в кэш браузера, без разбора: следующий щелчок не ждёт сети, а память не растёт. */
export function prefetchModels(urls) {
  for (const url of urls) {
    if (!url || entries.has(url) || typeof fetch !== "function") continue;
    fetch(url, { priority: "low" })
      .then((response) => response.arrayBuffer())
      .catch(() => {});
  }
}

/** Для проверок: сколько моделей сейчас в кэше. */
export const cachedModelCount = () => entries.size;

/** Для проверок: пустой кэш. */
export function clearModelCache() {
  for (const entry of entries.values()) free(entry.scene);
  entries.clear();
}
