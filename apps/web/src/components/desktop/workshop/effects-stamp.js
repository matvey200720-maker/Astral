/*
 * Картинки человека для вида «Картинка» — по одной на зону.
 *
 * Одна и та же картинка нужна в двух видах и в двух местах: холстом — окну,
 * чтобы показать, как она всплывёт у раны, и байтами — приложению, чтобы
 * собрать из них текстуру клона. Обе формы берутся из одного кадра: разъедься
 * они — человек увидел бы в окне одно, а в игре другое.
 *
 * Картинка приводится к кадру текстуры (256×256, вписана целиком, поля
 * прозрачные) прямо здесь, и в приложение уходит уже этот кадр, а не исходный
 * файл. Причина — мост между процессами: запрос установки ограничен мегабайтом
 * JSON, и четырёхмегабайтный снимок с телефона в него просто не проходил. Кадр
 * 256×256 весит десятки килобайт, и приложению остаётся только закодировать его
 * в DDS — второй раз картинка не пережимается.
 */

import {
  CUSTOM_TEXTURE_LAYOUT,
  IMPACT_LAYER_LIMIT,
  IMPACT_ZONE_IDS,
  layerPictureKey,
} from "@modovik/ptfx-studio";
import { READBACK, context2d } from "./effects-preview.js";
import { tr } from "../../../locales/ui.js";

export const PICTURE_EDGE = CUSTOM_TEXTURE_LAYOUT.width;
export const PICTURES_STORAGE_KEY = "astral.effects-studio.pictures.v2";
/* Картинки до слоёв: ключом была зона («head»), а до двух зон — одна на все.
   Читаются, чтобы не потерять картинку человека. */
const ZONE_STORAGE_KEY = "astral.effects-studio.pictures.v1";
const LEGACY_STORAGE_KEY = "astral.effects-studio.stamp.v1";

/* Ключи картинок: по одной на слой каждой зоны. */
const PICTURE_KEYS = IMPACT_ZONE_IDS.flatMap((zone) =>
  Array.from({ length: IMPACT_LAYER_LIMIT }, (_, index) =>
    layerPictureKey(zone, index),
  ),
);
const MAX_FILE_BYTES = 12 * 1024 * 1024;
/* Кадр крупнее — уходит в WebP: две зоны обязаны поместиться в один запрос. */
const MAX_PNG_BASE64 = 380_000;

/** Читает файл в data-URL. Отдельно, потому что это единственное место, где
    браузер решает, картинка это вообще или нет. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(tr("Файл не читается")));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function loadImage(source, failure) {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(failure));
    element.src = source;
  });
}

function frameCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = PICTURE_EDGE;
  canvas.height = PICTURE_EDGE;
  /* Кадр сжимается в PNG (`encodeFrame`) — то есть из него читают. Холст в
     видеопамяти отдал бы его синхронной выгрузкой с видеокарты, по сотне
     миллисекунд на каждую зону при каждом открытии редактора. */
  const context = context2d(canvas, READBACK);
  if (!context) throw new Error(tr("Браузер не дал холст для картинки"));
  /* Вписать целиком, а не заполнить: обрезать чужой рисунок по краям — значит
     показать человеку не то, что он принёс. */
  const scale = Math.min(
    PICTURE_EDGE / image.width,
    PICTURE_EDGE / image.height,
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  context.drawImage(
    image,
    Math.round((PICTURE_EDGE - width) / 2),
    Math.round((PICTURE_EDGE - height) / 2),
    width,
    height,
  );
  return canvas;
}

/* Короткий отпечаток байтов — ключ кэша спрайтов и плиток. */
function fingerprint(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

function encodeFrame(canvas) {
  let url = canvas.toDataURL("image/png");
  if (url.length > MAX_PNG_BASE64) url = canvas.toDataURL("image/webp", 0.92);
  const comma = url.indexOf(",");
  return {
    mime: url.slice(5, url.indexOf(";")),
    base64: url.slice(comma + 1),
  };
}

const picture = (name, canvas, encoded) => ({
  name,
  mime: encoded.mime,
  base64: encoded.base64,
  canvas,
  key: fingerprint(encoded.base64),
  /* Тот же кадр ссылкой: лист брызг собирается из SVG, а внешних файлов в
     SVG быть не может — картинка ложится в него data-URL. */
  dataUrl: `data:${encoded.mime};base64,${encoded.base64}`,
});

/**
 * Файл → `{ name, mime, base64, canvas, key }`.
 * `canvas` рисует окно, `base64` — тот же кадр — уезжает в приложение.
 */
export async function readPictureFile(file) {
  if (!file) throw new Error(tr("Выберите картинку"));
  if (file.size > MAX_FILE_BYTES)
    throw new Error(tr("Картинка больше 12 МБ — возьмите поменьше"));
  const image = await loadImage(await readAsDataUrl(file), tr("Это не картинка"));
  const canvas = frameCanvas(image);
  return picture(
    String(file.name || tr("картинка")).slice(0, 80),
    canvas,
    encodeFrame(canvas),
  );
}

async function revive(record) {
  if (!record?.base64) return null;
  const image = await loadImage(
    `data:${record.mime || "image/png"};base64,${record.base64}`,
    tr("Снимок картинки повреждён"),
  );
  const canvas = frameCanvas(image);
  /* Снимок прежней мастерской — исходный файл любого размера: он приводится к
     кадру, иначе запрос установки с ним не прошёл бы. */
  const framed =
    image.width === PICTURE_EDGE && image.height === PICTURE_EDGE
      ? { mime: record.mime || "image/png", base64: record.base64 }
      : encodeFrame(canvas);
  return picture(String(record.name || tr("картинка")), canvas, framed);
}

/** Восстанавливает картинки слоёв из хранилища браузера: без них «Своя
    картинка» после закрытия редактора осталась бы видом без вида. */
export async function restorePictures() {
  let stored = null;
  let byZone = null;
  let legacy = null;
  try {
    stored = window.localStorage.getItem(PICTURES_STORAGE_KEY);
    byZone = window.localStorage.getItem(ZONE_STORAGE_KEY);
    legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return {};
  }
  const pictures = {};
  try {
    const records = stored ? JSON.parse(stored) : null;
    /* Картинка прежних версий принадлежала зоне целиком; у зоны теперь стопка
       слоёв, и такая картинка достаётся её первому слою. */
    const zones = !records && byZone ? JSON.parse(byZone) : null;
    const single = !records && !zones && legacy ? JSON.parse(legacy) : null;
    for (const key of PICTURE_KEYS) {
      const [zone, index] = key.split(":");
      const record =
        records?.[key] ||
        (index === "0" ? zones?.[zone] || single : null) ||
        null;
      const restored = await revive(record).catch(() => null);
      if (restored) pictures[key] = restored;
    }
  } catch {
    return {};
  }
  return pictures;
}

/**
 * Картинки слоёв как они лежат в хранилище — без холстов: `{ ключ: { name,
 * mime, base64, key } }`. Для тех, кому нужны байты, а не рисунок: сборка
 * кладёт их рядом с попаданиями со своими картинками. Ключ — отпечаток
 * байтов, тот же, что у картинки в окне: по нему видно, та ли картинка стоит
 * в игре (`installedPictures`).
 */
export function storedPictureRecords(storage = globalThis.localStorage) {
  try {
    const records = JSON.parse(storage?.getItem(PICTURES_STORAGE_KEY) || "null");
    if (!records || typeof records !== "object") return {};
    const result = {};
    for (const key of PICTURE_KEYS) {
      const item = records[key];
      if (typeof item?.base64 !== "string" || !item.base64) continue;
      result[key] = {
        name: String(item.name || tr("картинка")).slice(0, 80),
        mime: String(item.mime || "image/png"),
        base64: item.base64,
        key: fingerprint(item.base64),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function rememberPictures(pictures) {
  try {
    const records = {};
    for (const key of PICTURE_KEYS) {
      const item = pictures?.[key];
      if (item?.base64)
        records[key] = {
          name: item.name,
          mime: item.mime,
          base64: item.base64,
        };
    }
    if (Object.keys(records).length)
      window.localStorage.setItem(
        PICTURES_STORAGE_KEY,
        JSON.stringify(records),
      );
    else window.localStorage.removeItem(PICTURES_STORAGE_KEY);
    window.localStorage.removeItem(ZONE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* приватный режим не мешает работе — теряется только память о картинке */
  }
}

