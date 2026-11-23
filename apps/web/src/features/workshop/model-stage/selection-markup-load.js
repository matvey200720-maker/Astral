/*
 * Загрузка разметки выделения сцены (ТЗ 26.10.2026, раздел D): запись манифеста сцены → адрес → кэш на диске → поток разбора →
 * `SelectionMap` для кадра (`ModelStage markup`).
 *
 * Запись — `{ url, bytes, sha256, version }` (`selectionEntry` у компилятора разметки). Файл берётся один раз на версию сцены:
 * память окна (на этом же `sha256`), затем кэш на диске (Cache Storage, ключ — адрес и `sha256`: другая версия — другой файл,
 * прежние снимаются), затем сеть. Размер и `sha256` сверяются до разбора: чужой файл разметкой не становится. Сегодня файл едет с
 * ассетами сцены (`/assets/workshop/…`), с выкладкой на CDN меняется только `url` записи — клиент прежний. Главный процесс отдаёт
 * файл сам (`read(entry)` → байты): у него brotli и кэш приложения (`apps/desktop/src/selection-markup/`).
 *
 * Разметка не подошла сборке сцены (`fits`) или файла нет — `null`, и кадр живёт запасным путём: сущность и лист, остров сетки.
 */

import { unzlibSync } from "fflate";
import { SelectionMap, decodeSelmapParts, unpackSelmapFile } from "@modovik/climb-contract/selection/selmap";

const CACHE_NAME = "astral-selection-markup-v1";
const REMOTE = /^https?:\/\//i;
/* Разобранные разметки: по одной на версию сцены, помнятся последние несколько. */
const KEEP = 6;
const known = new Map();

let worker = null;
let taskId = 0;
const tasks = new Map();

function workerOf() {
  if (worker !== null) return worker;
  worker = false;
  if (typeof Worker !== "function") return worker;
  try {
    const made = new Worker(new URL("./selection-markup-worker.js", import.meta.url), { type: "module" });
    made.onmessage = (event) => {
      const { id, parts, error } = event.data || {};
      const task = tasks.get(id);
      if (!task) return;
      tasks.delete(id);
      if (error) task.reject(new Error(error));
      else task.resolve(parts);
    };
    made.onerror = () => {
      /* Поток не поднялся: ждущие разбираются здесь, дальше — без потока. */
      worker = false;
      for (const task of tasks.values()) {
        try {
          task.resolve(partsOf(task.copy));
        } catch (failure) {
          task.reject(failure);
        }
      }
      tasks.clear();
    };
    worker = made;
  } catch {
    worker = false;
  }
  return worker;
}

const partsOf = (buffer) => decodeSelmapParts(unpackSelmapFile(new Uint8Array(buffer), { deflate: unzlibSync }));

function partsOffThread(buffer) {
  const thread = workerOf();
  if (!thread) return Promise.resolve().then(() => partsOf(buffer));
  return new Promise((resolve, reject) => {
    const id = ++taskId;
    /* Копия на случай, если поток не поднимется: свой буфер уходит в него. */
    tasks.set(id, { resolve, reject, copy: buffer.slice(0) });
    thread.postMessage({ id, buffer }, [buffer]);
  });
}

async function sha256Hex(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  const digest = new Uint8Array(await subtle.digest("SHA-256", buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* Адрес на CDN: файл отдаёт главный процесс (хост из списка Astral, размер и sha256, кэш на диске `<хранилище>/selection-markup/`, сжатие снимает Node);
   без Desktop (песочница, браузер) — `null`, и файл берёт сеть ниже. */
async function desktopRead(entry) {
  const { loadSelectionMarkupBody } = await import("../../../api.js");
  return (await loadSelectionMarkupBody(entry))?.body || null;
}

/** Файл разметки из кэша на диске или сети: байты, сверенные с записью. Чужой размер или `sha256` — ошибка. */
async function readBytes(entry, { fetchImpl, read }) {
  const reader = read || (REMOTE.test(entry.url) ? desktopRead : null);
  if (reader) {
    const bytes = await reader(entry);
    if (bytes) return bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (read) throw new Error("Разметка выделения не отдана.");
  }
  const versioned = Boolean(entry.sha256);
  const disk = versioned && typeof caches !== "undefined" ? await caches.open(CACHE_NAME).catch(() => null) : null;
  const slot = disk ? `/__selmap/${encodeURIComponent(entry.url)}/${entry.sha256}` : "";
  if (disk) {
    const hit = await disk.match(slot).catch(() => null);
    if (hit) return hit.arrayBuffer();
  }
  const response = await fetchImpl(entry.url);
  if (!response.ok) throw new Error(`Разметка выделения не загрузилась (${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (Number.isInteger(entry.bytes) && buffer.byteLength !== entry.bytes) throw new Error("Разметка выделения: размер не сошёлся с записью сцены.");
  if (versioned) {
    const got = await sha256Hex(buffer);
    if (got && got !== String(entry.sha256).toLowerCase()) throw new Error("Разметка выделения: sha256 не сошёлся с записью сцены.");
    if (disk) {
      /* Прежние версии этого адреса снимаются: в кэше одна — нынешняя. */
      const prefix = `/__selmap/${encodeURIComponent(entry.url)}/`;
      for (const request of await disk.keys().catch(() => [])) {
        const path = new URL(request.url).pathname;
        if (path.startsWith(prefix) && path !== slot) await disk.delete(request).catch(() => {});
      }
      await disk.put(slot, new Response(buffer.slice(0))).catch(() => {});
    }
  }
  return buffer;
}

/**
 * Разметка сцены: `Promise<SelectionMap>`; `entry` — запись манифеста сцены (`{ url, bytes?, sha256?, version? }`), `scene` — отпечаток
 * загруженной сцены `{ sha256?, meshes?, triangles? }` (`sceneFingerprint`), `read` — чем взять байты вместо сети (главный процесс).
 * Бросает, если файла нет, он не сошёлся с записью или не читается; разметка, что не подходит сборке сцены, — `null`.
 */
export function loadSelectionMarkup(entry, { scene = null, read = null, fetchImpl = globalThis.fetch } = {}) {
  if (!entry?.url) return Promise.resolve(null);
  const key = `${entry.url}|${entry.sha256 || ""}`;
  if (!known.has(key)) {
    known.set(
      key,
      readBytes(entry, { fetchImpl, read })
        .then(partsOffThread)
        .then((parts) => SelectionMap.fromParts(parts))
        .catch((error) => {
          /* Неудача не остаётся в памяти: следующая попытка — заново. */
          known.delete(key);
          throw error;
        }),
    );
    while (known.size > KEEP) known.delete(known.keys().next().value);
  } else {
    const same = known.get(key);
    known.delete(key);
    known.set(key, same);
  }
  return known.get(key).then((markup) => (scene && !markup.fits(scene) ? null : markup));
}

/** Забыть разобранное (тест, смена версии сцены). */
export function forgetSelectionMarkup() {
  known.clear();
}

/** Отпечаток загруженной сцены для `fits`: `sha256` — из описи, сетки и треугольники — из разобранной сцены. */
export function sceneFingerprint(asset, sha256 = "") {
  if (!asset?.meshes) return sha256 ? { sha256 } : null;
  let triangles = 0;
  for (const mesh of asset.meshes) triangles += mesh.indices.length / 3;
  return { ...(sha256 ? { sha256 } : {}), meshes: asset.meshes.length, triangles };
}
