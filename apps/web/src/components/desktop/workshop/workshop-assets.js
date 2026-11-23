import { tr } from "../../../locales/ui.js";
import { isLiveFinish, liveFinishBlob } from "../../../features/workshop/finish/live-finish.js";
import { projectMessage } from "./workshop-project/project-lang.js";
const DB_NAME = "astral-workshop-assets";
const STORE_NAME = "assets";
const memoryAssets = new Map();

export const SAFE_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "dds",
  "svg",
  "wav",
  "ogg",
  "mp3",
  "json",
  "xml",
  "ytd",
  "ydr",
  "ydd",
  "ymap",
  "ytyp",
  /* Свои шрифты надписей большой карты (владелец, 03.10.2026). Шрифт —
     данные для FontFace, а не программа: подпись файла сверяется ниже. */
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

/** Расширения шрифтов — по ним редактор узнаёт шрифт среди файлов проекта. */
export const FONT_ASSET_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);

/*
 * Звук, который принимает студия звука, — на один формат шире общего набора.
 *
 * FLAC — формат, в котором звуковые паки и библиотеки раздают звук без
 * потерь, и отказ «Этот тип файла не поддерживается» на нём был самым частым
 * тупиком. Окно его читает: в FFmpeg внутри Electron есть и разбор FLAC, и
 * декодер (`ff_flac_demuxer`, `ff_flac_decoder` в `libffmpeg.dylib` сборки
 * 43.1), и `decodeAudioData` отдаёт PCM так же, как для wav. В общий набор
 * мастерской FLAC не входит: другие редакторы кладут файлы в проект, и там
 * его никто не ждёт.
 */
export const SOUND_ASSET_EXTENSIONS = new Set(["wav", "ogg", "mp3", "flac"]);

const expectedMime = {
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  svg: ["image/svg+xml", "text/plain"],
  wav: ["audio/wav", "audio/x-wav"],
  ogg: ["audio/ogg", "application/ogg"],
  mp3: ["audio/mpeg", "audio/mp3"],
  flac: ["audio/flac", "audio/x-flac"],
  json: ["application/json", "text/json", "text/plain"],
  xml: ["application/xml", "text/xml", "text/plain"],
  /* У шрифтов браузеры называют тип кто как: от `font/ttf` до общего
     `application/octet-stream`. Решает подпись файла, а не имя типа. */
  ttf: [
    "font/ttf",
    "font/sfnt",
    "application/x-font-ttf",
    "application/font-sfnt",
    "application/octet-stream",
  ],
  otf: [
    "font/otf",
    "font/sfnt",
    "application/x-font-otf",
    "application/vnd.ms-opentype",
    "application/octet-stream",
  ],
  woff: ["font/woff", "application/font-woff", "application/octet-stream"],
  woff2: ["font/woff2", "application/octet-stream"],
};

function safeAssetName(value) {
  const name = String(value || "").replaceAll("\\", "/");
  return (
    Boolean(name) &&
    !name.startsWith("/") &&
    !/^[a-z]:/i.test(name) &&
    !name.split("/").some((part) => !part || part === "." || part === "..")
  );
}

/**
 * `extensions` — какие типы принимает место вызова; по умолчанию общий набор
 * мастерской. Исполняемое и небезопасное имя отсекаются при любом наборе.
 */
export function validateWorkshopAsset(
  file,
  { extensions = SAFE_ASSET_EXTENSIONS } = {},
) {
  const name = String(file?.name || "");
  const extension = name.includes(".")
    ? name.split(".").pop().toLowerCase()
    : "";
  if (!safeAssetName(name))
    return { valid: false, error: tr("Недопустимое имя файла") };
  if (!extensions.has(extension))
    return { valid: false, error: tr("Этот тип файла не поддерживается") };
  if (Number(file?.size || 0) > 64 * 1024 * 1024)
    return { valid: false, error: tr("Файл больше 64 МБ") };
  if (/\.(exe|dll|bat|cmd|ps1|js|msi|scr)$/i.test(name))
    return { valid: false, error: tr("Исполняемые файлы запрещены") };
  const allowedMime = expectedMime[extension];
  if (
    file?.type &&
    allowedMime &&
    !allowedMime.includes(String(file.type).toLowerCase())
  )
    return {
      valid: false,
      error: tr("MIME-тип не соответствует расширению файла"),
    };
  return { valid: true, extension };
}

const begins = (bytes, signature) =>
  signature.every((value, index) => bytes[index] === value);

function validateSignature(extension, bytes) {
  if (extension === "png") return begins(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (["jpg", "jpeg"].includes(extension))
    return begins(bytes, [0xff, 0xd8, 0xff]);
  if (extension === "webp")
    return (
      begins(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  if (extension === "dds") return begins(bytes, [0x44, 0x44, 0x53, 0x20]);
  if (extension === "glb") return begins(bytes, [0x67, 0x6c, 0x54, 0x46]);
  if (extension === "wav")
    return (
      begins(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WAVE"
    );
  if (extension === "ogg") return begins(bytes, [0x4f, 0x67, 0x67, 0x53]);
  if (extension === "mp3")
    /* ID3-тег или сразу MPEG frame sync: 11 единиц в старших битах. */
    return (
      begins(bytes, [0x49, 0x44, 0x33]) ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    );
  if (extension === "flac") return flacSignature(bytes);
  /* TrueType — версия 1.0 или «true» (старые шрифты Apple), OpenType —
     «OTTO», WOFF — «wOFF» и «wOF2». */
  if (extension === "ttf")
    return (
      begins(bytes, [0x00, 0x01, 0x00, 0x00]) ||
      begins(bytes, [0x74, 0x72, 0x75, 0x65])
    );
  if (extension === "otf") return begins(bytes, [0x4f, 0x54, 0x54, 0x4f]);
  if (extension === "woff") return begins(bytes, [0x77, 0x4f, 0x46, 0x46]);
  if (extension === "woff2") return begins(bytes, [0x77, 0x4f, 0x46, 0x32]);
  return true;
}

const FLAC_MARKER = [0x66, 0x4c, 0x61, 0x43]; // fLaC

/*
 * FLAC начинается с `fLaC` — или с тега ID3v2, который перед ним дописывают
 * некоторые программы. Размер тега записан «безопасными» байтами (по семь бит)
 * и не включает десять байт заголовка; флаг подвала добавляет ещё десять.
 */
function flacSignature(bytes) {
  if (begins(bytes, FLAC_MARKER)) return true;
  if (!begins(bytes, [0x49, 0x44, 0x33]) || bytes.length < 10) return false;
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  const offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  return FLAC_MARKER.every((value, index) => bytes[offset + index] === value);
}

function validateTextAsset(extension, bytes) {
  if (!["svg", "json", "xml"].includes(extension)) return;
  const text = new TextDecoder().decode(bytes);
  if (extension === "json") JSON.parse(text);
  if (extension === "svg") {
    if (!/<svg[\s>]/i.test(text))
      throw new Error(tr("Файл не содержит корректный SVG"));
    if (
      /<script|<style|<foreignObject|<!doctype|<!entity|\son\w+\s*=|javascript:|data:text\/html|\b(?:href|xlink:href|src)\s*=|@import|url\s*\(/i.test(
        text,
      )
    ) {
      throw new Error(tr("SVG содержит потенциально опасный активный контент"));
    }
  }
  if (extension === "xml" && !/^\s*<\?xml|^\s*<[a-z_]/i.test(text))
    throw new Error(tr("Некорректный XML"));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareWorkshopAsset(file, options = {}) {
  const validation = validateWorkshopAsset(file, options);
  if (!validation.valid) throw new Error(validation.error);
  const bytes = await workshopBlobBytes(file);
  if (!validateSignature(validation.extension, bytes))
    throw new Error(tr("Сигнатура файла не соответствует расширению"));
  validateTextAsset(validation.extension, bytes);
  return {
    blob: new Blob([bytes], { type: file.type || "application/octet-stream" }),
    metadata: {
      name: file.name,
      size: bytes.length,
      type: file.type || "application/octet-stream",
      extension: validation.extension,
      hash: await sha256Hex(bytes),
    },
  };
}

export async function workshopBlobBytes(blob) {
  if (typeof blob.arrayBuffer === "function")
    return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(blob);
  });
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const workshopAssetKey = (projectId, assetId) =>
  `${projectId}:${assetId}`;

export async function putWorkshopAsset(key, blob) {
  memoryAssets.set(key, blob);
  const database = await openDatabase();
  if (!database) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(blob, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function deleteWorkshopAsset(key) {
  memoryAssets.delete(key);
  const database = await openDatabase();
  if (!database) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function getWorkshopAsset(key) {
  /* Картинка из открытой студии (`live-finish.js`): снимок её холста, а не запись хранилища. */
  if (isLiveFinish(key)) return liveFinishBlob(key);
  if (memoryAssets.has(key)) return memoryAssets.get(key);
  const database = await openDatabase();
  if (!database) return null;
  const result = await new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME)
      .objectStore(STORE_NAME)
      .get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

/**
 * Несколько картинок разом: одно открытие базы и одна транзакция на все ключи (прежде — открытие на каждую, а у списка вещей игры их сотни). `Map` ключ → картинка; чего нет в хранилище, в нём тоже нет.
 */
export async function getWorkshopAssets(keys) {
  const found = new Map();
  const rest = [];
  for (const key of new Set(keys)) {
    if (isLiveFinish(key)) {
      const blob = await liveFinishBlob(key);
      if (blob) found.set(key, blob);
    } else if (memoryAssets.has(key)) found.set(key, memoryAssets.get(key));
    else rest.push(key);
  }
  if (!rest.length) return found;
  const database = await openDatabase();
  if (!database) return found;
  try {
    const store = database.transaction(STORE_NAME).objectStore(STORE_NAME);
    await Promise.all(
      rest.map(
        (key) =>
          new Promise((resolve) => {
            const request = store.get(key);
            request.onsuccess = () => {
              if (request.result) found.set(key, request.result);
              resolve();
            };
            request.onerror = () => resolve();
          }),
      ),
    );
  } finally {
    database.close();
  }
  return found;
}

/** Ключи хранилища с приставкой — для уборки картинок, на которые никто не ссылается. */
export async function listWorkshopAssetKeys(prefix = "") {
  const database = await openDatabase();
  if (!database)
    return [...memoryAssets.keys()].filter((key) => key.startsWith(prefix));
  const keys = await new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME)
      .objectStore(STORE_NAME)
      .getAllKeys(
        prefix ? IDBKeyRange.bound(prefix, `${prefix}\uffff`) : undefined,
      );
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return keys.map(String);
}

const assetStorageKeys = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : [values])
      .flatMap((value) => (Array.isArray(value?.assets) ? value.assets : value))
      .map((value) => (typeof value === "string" ? value : value?.storageKey))
      .filter(Boolean),
  ),
];

export async function deleteUnreferencedWorkshopAssets(
  assets,
  retainedProjects = [],
) {
  const retained = new Set(assetStorageKeys(retainedProjects));
  const keys = assetStorageKeys(assets).filter((key) => !retained.has(key));
  const failures = [];
  for (const key of keys) {
    try {
      await deleteWorkshopAsset(key);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      tr("Не удалось полностью очистить локальные файлы проекта"),
    );
  return keys;
}

/*
 * Файлы копии проекта — свои байты в хранилище, но под прежними номерами.
 *
 * Модули ссылаются на картинку номером (`playerMarkerAssetId`, видео
 * заливки, слои карты), и копия переносит модули как есть. Новый номер у
 * файла оставлял ссылку копии висеть на файле исходного проекта: «Применить»
 * у копии мини-карты падало с «Файл отсутствует в проекте». Независимость
 * даёт ключ хранилища — он под номером проекта-копии.
 */
export async function copyWorkshopAssets(assets, targetProjectId) {
  const copies = [];
  const storedKeys = [];
  try {
    for (const [index, asset] of (assets || []).entries()) {
      if (!asset?.storageKey)
        throw new Error(projectMessage("noStorageKey", asset?.name || "asset"));
      const blob = await getWorkshopAsset(asset.storageKey);
      if (!blob)
        throw new Error(projectMessage("localMissing", asset.name || "asset"));
      const assetId =
        asset.id ||
        `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}-${asset.name}`;
      const storageKey = workshopAssetKey(targetProjectId, assetId);
      await putWorkshopAsset(storageKey, blob);
      storedKeys.push(storageKey);
      copies.push({
        ...asset,
        id: assetId,
        storageKey,
        archivePath: undefined,
        importedAt: new Date().toISOString(),
      });
    }
    return copies;
  } catch (error) {
    await deleteUnreferencedWorkshopAssets(storedKeys).catch(() => {});
    throw error;
  }
}
