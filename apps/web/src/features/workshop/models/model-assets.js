/*
 * Свои модели мест — файлы человека в хранилище окна (ТЗ 11.10.2026, вечер,
 * задача 1).
 *
 * Картинка (PNG, JPEG, WebP…) ложится туда же, где эмблемы и надписи
 * (`saveHangarEmblem`, ключ `hangar-emblem:<sha256>`): одна и та же картинка не
 * копится дважды, а установщик читает её тем же путём.
 *
 * Своя модель (GLB, glTF с вложенными данными, OBJ) переводится здесь, в
 * окне, в одну сетку и один лист — то, что умеет собрать нативный хост
 * (`compile-star-model`: одна геометрия, один лист DXT5, до 60 000 вершин):
 *   • оси — как у игры: из «Y вверх» файла в «Z вверх» игры (лицо модели
 *     смотрит в −Y, как у плашек);
 *   • все части модели — одной сеткой с местами частей;
 *   • листы частей — одним листом: у одного листа — он сам, у нескольких —
 *     клетками, у части без листа — клетка её цвета;
 *   • размер — единичный: длинная сторона 1 м, середина в нуле
 *     (`unitPlaceModelMesh` договора); размер в метрах задаёт человек.
 * Сетка лежит двоичным файлом `place-model:<sha256>` (`AMSH`, версия 1:
 * число вершин и индексов, места, нормали, развёртка, индексы), лист —
 * картинкой эмблем.
 */

import { gifSurfaceProfile } from "@modovik/climb-contract/recolor/gif-surface";
import {
  PLACE_MODEL_MAX_TRIANGLES,
  PLACE_MODEL_MAX_VERTICES,
  normalizePlaceModelAnimation,
  placeModelAssets,
  unitPlaceModelMesh,
} from "@modovik/climb-contract/recolor/place-models";
import { currentUiLanguage } from "../../../locales/ui.js";
import { gifNoticeCopy } from "./gif-notices-copy.js";
import { decodeGif, isGif, planAtlas } from "./gif-frames.js";
import {
  getWorkshopAsset,
  putWorkshopAsset,
  workshopBlobBytes,
} from "../../../components/desktop/workshop/workshop-assets.js";
import {
  HANGAR_EMBLEM_EXTENSIONS,
  saveHangarEmblem,
} from "../hangar-editor/hangar-emblem.js";

export const MODEL_FILE_EXTENSIONS = new Set(["glb", "gltf", "obj"]);
/* Что принимает «Добавить модель»: картинки (и живые — GIF, APNG, WebP с кадрами) и модели. */
export const PLACE_MODEL_ACCEPT =
  "image/png,image/apng,image/jpeg,image/webp,image/bmp,image/gif,image/avif,.png,.apng,.jpg,.jpeg,.webp,.bmp,.gif,.avif,.glb,.gltf,.obj";
/* Где бывают кадры: GIF, APNG (.png/.apng), WebP. */
const ANIMATED_TYPES = Object.freeze({
  gif: "image/gif",
  png: "image/png",
  apng: "image/apng",
  webp: "image/webp",
});
const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const ATLAS = 1024;
const INSET = 2;

const extensionOf = (file) =>
  String(file?.name || "")
    .split(".")
    .pop()
    .toLowerCase();

/** Картинка или модель — по расширению файла (`image`, `model` или `null`). */
export function placeModelFileKind(file) {
  const extension = extensionOf(file);
  if (HANGAR_EMBLEM_EXTENSIONS.has(extension) || extension === "apng")
    return "image";
  if (MODEL_FILE_EXTENSIONS.has(extension)) return "model";
  return null;
}

/* ------------------------------------------------------------------ *
 * Двоичная сетка
 * ------------------------------------------------------------------ */

const MAGIC = 0x48534d41; /* «AMSH» */

/** Сетка → байты `AMSH` v1. */
export function encodePlaceMesh({ positions, normals, uvs, indices }) {
  const vertices = positions.length / 3;
  const header = 16;
  const bytes = new ArrayBuffer(header + vertices * 8 * 4 + indices.length * 4);
  const view = new DataView(bytes);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, vertices, true);
  view.setUint32(12, indices.length, true);
  let at = header;
  for (const list of [positions, normals, uvs])
    for (let index = 0; index < list.length; index += 1, at += 4)
      view.setFloat32(at, list[index], true);
  for (let index = 0; index < indices.length; index += 1, at += 4)
    view.setUint32(at, indices[index], true);
  return new Uint8Array(bytes);
}

/** Байты `AMSH` v1 → сетка или ошибка понятными словами. */
export function decodePlaceMesh(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 16 ||
    view.getUint32(0, true) !== MAGIC ||
    view.getUint32(4, true) !== 1
  )
    throw new Error("Сетка модели повреждена — загрузите модель ещё раз.");
  const vertices = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  if (bytes.byteLength !== 16 + vertices * 32 + count * 4)
    throw new Error("Сетка модели повреждена — загрузите модель ещё раз.");
  let at = 16;
  const take = (length) => {
    const out = new Float32Array(length);
    for (let index = 0; index < length; index += 1, at += 4)
      out[index] = view.getFloat32(at, true);
    return out;
  };
  const positions = take(vertices * 3);
  const normals = take(vertices * 3);
  const uvs = take(vertices * 2);
  const indices = new Uint32Array(count);
  for (let index = 0; index < count; index += 1, at += 4)
    indices[index] = view.getUint32(at, true);
  return { positions, normals, uvs, indices };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* Кэш прочитанных сеток: кадр и панель просят одну и ту же много раз. */
const meshCache = new Map();

/** Сетка своей модели из хранилища окна (`null` — нет такой). */
export async function loadPlaceMesh(asset) {
  if (!asset) return null;
  if (meshCache.has(asset)) return meshCache.get(asset);
  const pending = getWorkshopAsset(asset).then(async (blob) =>
    blob ? decodePlaceMesh(await workshopBlobBytes(blob)) : null,
  );
  meshCache.set(asset, pending);
  pending.catch(() => meshCache.delete(asset));
  return pending;
}

/* ------------------------------------------------------------------ *
 * Модель из файла
 * ------------------------------------------------------------------ */

/* Части сцены three.js → одна сетка «Z вверх» с листом-клетками. */
export function mergeModelParts(parts, materials) {
  let vertices = 0;
  let triangles = 0;
  for (const part of parts) {
    vertices += part.positions.length / 3;
    triangles += part.indices.length / 3;
  }
  if (!vertices || !triangles) throw new Error("В модели нет ни одной грани.");
  if (vertices > PLACE_MODEL_MAX_VERTICES)
    throw new Error(
      `В модели ${vertices.toLocaleString("ru-RU")} вершин, а в игру встаёт до ${PLACE_MODEL_MAX_VERTICES.toLocaleString("ru-RU")} — упростите её (в Blender: модификатор Decimate) и загрузите снова.`,
    );
  if (triangles > PLACE_MODEL_MAX_TRIANGLES)
    throw new Error(
      `В модели ${triangles.toLocaleString("ru-RU")} граней, а в игру встаёт до ${PLACE_MODEL_MAX_TRIANGLES.toLocaleString("ru-RU")} — упростите её и загрузите снова.`,
    );
  const grid =
    materials.length <= 1
      ? 1
      : 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(materials.length))));
  const cell = ATLAS / grid;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const indices = new Uint32Array(triangles * 3);
  const wrap = (value) =>
    value >= 0 && value <= 1 ? value : value - Math.floor(value);
  let base = 0;
  let index = 0;
  for (const part of parts) {
    const count = part.positions.length / 3;
    const slot = Math.max(0, part.material);
    const cx = (slot % grid) * cell;
    const cy = Math.floor(slot / grid) * cell;
    for (let at = 0; at < count; at += 1) {
      /* «Y вверх» файла → «Z вверх» игры: (x, y, z) → (x, −z, y). */
      const [x, y, z] = [
        part.positions[at * 3],
        part.positions[at * 3 + 1],
        part.positions[at * 3 + 2],
      ];
      const [nx, ny, nz] = [
        part.normals[at * 3],
        part.normals[at * 3 + 1],
        part.normals[at * 3 + 2],
      ];
      const o = (base + at) * 3;
      positions[o] = x;
      positions[o + 1] = -z;
      positions[o + 2] = y;
      normals[o] = nx;
      normals[o + 1] = -nz;
      normals[o + 2] = ny;
      const u = part.uvs ? wrap(part.uvs[at * 2]) : 0.5;
      /* У листов игры v растёт вниз, как у glTF; у OBJ — вверх. */
      const raw = part.uvs ? wrap(part.uvs[at * 2 + 1]) : 0.5;
      const v = part.flipV ? 1 - raw : raw;
      uvs[(base + at) * 2] = (cx + INSET + u * (cell - INSET * 2)) / ATLAS;
      uvs[(base + at) * 2 + 1] = (cy + INSET + v * (cell - INSET * 2)) / ATLAS;
    }
    for (let at = 0; at < part.indices.length; at += 1)
      indices[index++] = base + part.indices[at];
    base += count;
  }
  return {
    mesh: unitPlaceModelMesh({ positions, normals, uvs, indices }),
    grid,
    cell,
  };
}

/* Лист модели: клетка на материал — его лист с его цветом или ровный цвет. */
async function paintAtlas(materials, grid, cell) {
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(ATLAS, ATLAS)
      : Object.assign(document.createElement("canvas"), {
          width: ATLAS,
          height: ATLAS,
        });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Лист модели не нарисовать в этом окне.");
  context.fillStyle = "#808080";
  context.fillRect(0, 0, ATLAS, ATLAS);
  materials.forEach((material, slot) => {
    const x = (slot % grid) * cell;
    const y = Math.floor(slot / grid) * cell;
    if (material.image) {
      context.drawImage(material.image, x, y, cell, cell);
      if (material.colour && material.colour !== "#ffffff") {
        context.globalCompositeOperation = "multiply";
        context.fillStyle = material.colour;
        context.fillRect(x, y, cell, cell);
        context.globalCompositeOperation = "source-over";
      }
    } else {
      context.fillStyle = material.colour || "#b8b8b8";
      context.fillRect(x, y, cell, cell);
    }
  });
  const blob =
    typeof canvas.convertToBlob === "function"
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Лист модели не сохранился.");
  return blob;
}

/* Части three.js-сцены: сетки с мировыми местами и материалами. */
function collectParts(root, { flipV = false } = {}) {
  const parts = [];
  const materials = [];
  const slotOf = new Map();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];
    let geometry = object.geometry.clone();
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.applyMatrix4(object.matrixWorld);
    const groups = geometry.groups?.length
      ? geometry.groups
      : [
          {
            start: 0,
            count: geometry.index
              ? geometry.index.count
              : geometry.attributes.position.count,
            materialIndex: 0,
          },
        ];
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv || null;
    const index = geometry.index;
    for (const group of groups) {
      const material = list[group.materialIndex || 0] || list[0];
      let slot = slotOf.get(material);
      if (slot === undefined) {
        slot = materials.length;
        slotOf.set(material, slot);
        const colour = material?.color
          ? `#${material.color.getHexString()}`
          : "#b8b8b8";
        materials.push({ image: material?.map?.image || null, colour });
      }
      /* Вершины группы — своими, индексы — по ним. */
      const remap = new Map();
      const positions = [];
      const normals = [];
      const uvs = uv ? [] : null;
      const indices = [];
      for (let at = group.start; at < group.start + group.count; at += 1) {
        const source = index ? index.getX(at) : at;
        let target = remap.get(source);
        if (target === undefined) {
          target = positions.length / 3;
          remap.set(source, target);
          positions.push(
            position.getX(source),
            position.getY(source),
            position.getZ(source),
          );
          normals.push(
            normal.getX(source),
            normal.getY(source),
            normal.getZ(source),
          );
          if (uvs) uvs.push(uv.getX(source), uv.getY(source));
        }
        indices.push(target);
      }
      parts.push({ positions, normals, uvs, indices, material: slot, flipV });
    }
    geometry.dispose();
    geometry = null;
  });
  return { parts, materials };
}

async function parseModel(file, extension) {
  const bytes = await workshopBlobBytes(file);
  if (extension === "obj") {
    const { OBJLoader } =
      await import("three/examples/jsm/loaders/OBJLoader.js");
    const text = new TextDecoder().decode(bytes);
    return new OBJLoader().parse(text);
  }
  const { GLTFLoader } =
    await import("three/examples/jsm/loaders/GLTFLoader.js");
  const data =
    extension === "gltf"
      ? new TextDecoder().decode(bytes)
      : bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(data, "", resolve, reject),
  ).catch((error) => {
    const text = String(error?.message || error);
    if (/draco|meshopt|KHR_draco|EXT_meshopt/i.test(text))
      throw new Error(
        "Модель сжата (Draco или Meshopt) — сохраните её без сжатия и загрузите снова.",
      );
    if (/uri|fetch|external|buffer/i.test(text) && extension === "gltf")
      throw new Error(
        "glTF ссылается на соседние файлы — сохраните модель одним файлом .glb.",
      );
    throw new Error("Модель не читается — нужен GLB, glTF или OBJ.");
  });
  return gltf.scene;
}

/**
 * Сетка `{ positions, normals, uvs, indices }` → хранилище окна: ключ `place-model:<sha256>`. Та же сетка — тот же ключ (ничего не
 * пишется второй раз). Её берёт и файл модели, и «Цвет» предмета арены (сетка самого предмета из сцены).
 */
export async function savePlaceMesh(mesh) {
  const encoded = encodePlaceMesh(mesh);
  const asset = `place-model:${await sha256Hex(encoded)}`;
  await putWorkshopAsset(
    asset,
    new Blob([encoded], { type: "application/octet-stream" }),
  );
  meshCache.set(asset, Promise.resolve(mesh));
  return asset;
}

/**
 * Файл модели → своя модель в хранилище: `{ asset, texture, name,
 * vertices }`. Бросает понятной ошибкой: нечитаемый файл, сжатая модель,
 * слишком подробная модель.
 */
export async function savePlaceModelFile(file) {
  const extension = extensionOf(file);
  if (!MODEL_FILE_EXTENSIONS.has(extension))
    throw new Error("Нужна модель: GLB, glTF или OBJ.");
  if (Number(file?.size || 0) > MAX_MODEL_BYTES)
    throw new Error("Модель больше 64 МБ — возьмите поменьше.");
  const root = await parseModel(file, extension);
  const { parts, materials } = collectParts(root, {
    flipV: extension === "obj",
  });
  const { mesh, grid, cell } = mergeModelParts(parts, materials);
  const asset = await savePlaceMesh(mesh);
  /* Лист — только если у модели есть листы или разные цвета; иначе ровный серый. */
  const atlas = await paintAtlas(materials, grid, cell);
  const name = String(file.name || "модель");
  const saved = await saveHangarEmblem(
    typeof File === "function"
      ? new File([atlas], `${name.replace(/\.[^.]+$/, "")}-лист.png`, {
          type: "image/png",
        })
      : Object.assign(atlas, { name: "лист.png" }),
  );
  return {
    asset,
    texture: saved.asset,
    name,
    vertices: mesh.positions.length / 3,
  };
}

/* ------------------------------------------------------------------ *
 * Живая картинка (ТЗ 11.10.2026, ночь, задача 2)
 * ------------------------------------------------------------------ */

function newCanvas(width, height) {
  if (typeof OffscreenCanvas === "function")
    return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement("canvas"), { width, height });
}

async function canvasBlob(canvas, type = "image/png") {
  const blob =
    typeof canvas.convertToBlob === "function"
      ? await canvas.convertToBlob({ type })
      : await new Promise((resolve) => canvas.toBlob(resolve, type));
  if (!blob) throw new Error("Лист кадров не сохранился.");
  return blob;
}

/*
 * Кадры файла: `{ width, height, count, delays, draw(index, context, x, y,
 * w, h) }` или `null` (кадр один — обычная картинка). Сначала `ImageDecoder`
 * окна (GIF, APNG, анимированный WebP — кадры уже сложены, как их покажет
 * браузер), без него — свой декодер GIF.
 */
async function readFrames(file, bytes) {
  const type = ANIMATED_TYPES[extensionOf(file)] || file.type || "";
  if (!Object.values(ANIMATED_TYPES).includes(type)) return null;
  if (typeof ImageDecoder === "function") {
    let decoder = null;
    try {
      if (await ImageDecoder.isTypeSupported(type)) {
        decoder = new ImageDecoder({ data: bytes, type });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        const count = track?.frameCount || 1;
        if (!track?.animated || count < 2) {
          decoder.close();
          return null;
        }
        const first = (await decoder.decode({ frameIndex: 0 })).image;
        const width = first.displayWidth;
        const height = first.displayHeight;
        const delays = [Math.round((first.duration || 0) / 1000)];
        first.close();
        for (let index = 1; index < count; index += 1) {
          const { image } = await decoder.decode({ frameIndex: index });
          delays.push(Math.round((image.duration || 0) / 1000));
          image.close();
        }
        const open = decoder;
        return {
          width,
          height,
          count,
          delays: delays.map((value) => (value > 10 ? value : 100)),
          async draw(index, context, x, y, w, h) {
            const { image } = await open.decode({ frameIndex: index });
            context.drawImage(image, x, y, w, h);
            image.close();
          },
          close: () => open.close(),
        };
      }
    } catch {
      decoder?.close?.();
      /* ниже — свой декодер GIF */
    }
  }
  if (!isGif(bytes)) return null;
  const gif = decodeGif(bytes);
  if (gif.frames.length < 2) return null;
  return {
    width: gif.width,
    height: gif.height,
    count: gif.frames.length,
    delays: gif.frames.map((frame) => frame.delay),
    async draw(index, context, x, y, w, h) {
      const frame = newCanvas(gif.width, gif.height);
      frame
        .getContext("2d")
        .putImageData(
          new ImageData(gif.frames[index].rgba, gif.width, gif.height),
          0,
          0,
        );
      context.drawImage(frame, x, y, w, h);
    },
    close: () => {},
  };
}

/**
 * Живая картинка → лист-атлас кадров в хранилище: `{ asset, name, width,
 * height, animation, notice }` (`width`/`height` — размер кадра) или `null`
 * — в файле один кадр. Кадров больше 64 — берутся равномерно (`notice`).
 * `options.side` — наибольшая сторона листа (по умолчанию 2048; щиты и
 * остановки держат листы до 1024, `saveGifSurfacePicture`); `options.withSheet` —
 * записать в живую картинку размер листа (`animation.sheet`, «Модели» мест); `options.save` —
 * куда класть лист (по умолчанию — к эмблемам, у отделки — к картинкам отделки).
 */
export async function saveAnimatedPicture(file, { side = 0, save = saveHangarEmblem, withSheet = false } = {}) {
  const bytes = await workshopBlobBytes(file);
  const frames = await readFrames(file, bytes);
  if (!frames) return null;
  try {
    const plan = planAtlas(frames.width, frames.height, frames.delays, side ? { side } : undefined);
    const canvas = newCanvas(plan.sheet[0], plan.sheet[1]);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Лист кадров не нарисовать в этом окне.");
    context.imageSmoothingQuality = "high";
    for (const [slot, index] of plan.keep.entries())
      await frames.draw(
        index,
        context,
        (slot % plan.columns) * plan.cell[0],
        Math.floor(slot / plan.columns) * plan.cell[1],
        plan.cell[0],
        plan.cell[1],
      );
    const blob = await canvasBlob(canvas);
    const base = String(file.name || "гифка").replace(/\.[^.]+$/, "");
    const sheet =
      typeof File === "function"
        ? new File([blob], `${base}-кадры.png`, { type: "image/png" })
        : Object.assign(blob, { name: `${base}-кадры.png` });
    const saved = await save(sheet);
    const animation = normalizePlaceModelAnimation({
      columns: plan.columns,
      rows: plan.rows,
      frames: plan.keep.length,
      delays: plan.delays,
      /* «Модели» мест: лист кадров, как собран, — по нему счётчик нагрузки знает вес (щиты и остановки поле не хранят). */
      ...(withSheet ? { sheet: plan.sheet } : {}),
    });
    if (!animation) return null;
    /* Число кадров в заметке склоняется по языку окна («53 кадра», «5 кадров», «21 кадр»): `gif-notices-copy.js`. */
    const copy = gifNoticeCopy(currentUiLanguage());
    const notices = [];
    if (plan.dropped) notices.push(copy.reduced(frames.count, plan.keep.length));
    if (animation.frames < plan.keep.length) notices.push(copy.cut(animation.frames));
    return {
      asset: saved.asset,
      name: String(file.name || saved.name),
      width: frames.width,
      height: frames.height,
      animation,
      notice: notices.join(" "),
    };
  } finally {
    frames.close();
  }
}

/**
 * Картинка для поверхности с гифкой — щит, постер остановки, полотно арены
 * (задача 6 ТЗ 17.10.2026): живая — листом кадров под сторону места
 * (`GIF_SURFACE_PROFILES[profileId].atlasSide`), иначе — обычной картинкой.
 * Ответ — `{ asset, name, width, height, animation?, notice?, converted? }`
 * (`width`/`height` у гифки — размер кадра). `options.save` — куда класть
 * (`saveHangarEmblem` по умолчанию, `saveFinishImage` у отделки).
 */
export async function saveGifSurfacePicture(file, profileId, { save = saveHangarEmblem } = {}) {
  const side = gifSurfaceProfile(profileId)?.atlasSide || 0;
  const kind = `${file?.name || ""} ${file?.type || ""}`.toLowerCase();
  const maybeLive = ["gif", "png", "webp"].some((format) => kind.includes(format));
  /* Один кадр (обычная картинка) — `null`, и она идёт картинкой. */
  const live = maybeLive ? await saveAnimatedPicture(file, { side, save }).catch(() => null) : null;
  return live || save(file);
}

const looksAnimated = (file) => {
  const kind = `${file?.name || ""} ${file?.type || ""}`.toLowerCase();
  return ["gif", "png", "webp"].some((format) => kind.includes(format));
};

/**
 * Первый кадр гифки (задача 6 ТЗ 17.10.2026): где гифке не играть — стены,
 * общие листы, звезда, — она встаёт первым кадром. `{ file, frames }`: `file` —
 * первый кадр файлом PNG, `frames` — сколько кадров было; `null` — в файле
 * один кадр (обычная картинка) или его кадры не прочитать.
 */
export async function firstFramePicture(file) {
  if (!looksAnimated(file)) return null;
  const frames = await readFrames(file, await workshopBlobBytes(file)).catch(() => null);
  if (!frames) return null;
  try {
    const canvas = newCanvas(frames.width, frames.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    await frames.draw(0, context, 0, 0, frames.width, frames.height);
    const blob = await canvasBlob(canvas);
    const name = `${String(file.name || "гифка").replace(/\.[^.]+$/, "")}.png`;
    return {
      file: typeof File === "function" ? new File([blob], name, { type: "image/png" }) : Object.assign(blob, { name }),
      frames: frames.count,
    };
  } finally {
    frames.close();
  }
}

/**
 * Файл человека → поля новой модели: картинка — `{ asset, name, width,
 * height, converted }`, живая картинка — `{ asset, name, width, height,
 * animation, notice }`, модель — `{ asset, texture, name, vertices,
 * shape: "mesh" }`.
 */
export async function savePlaceModelSource(file) {
  const kind = placeModelFileKind(file);
  if (kind === "image") {
    /* Кадры APNG и WebP разбирает только `ImageDecoder` окна; GIF — и свой декодер. */
    const extension = extensionOf(file);
    const readable =
      extension === "gif" ||
      /gif/.test(String(file?.type || "")) ||
      typeof ImageDecoder === "function";
    if (
      readable &&
      (ANIMATED_TYPES[extension] ||
        /gif|apng|webp/.test(String(file?.type || "")))
    ) {
      const live = await saveAnimatedPicture(file, { withSheet: true });
      if (live) return live;
    }
    return saveHangarEmblem(file);
  }
  if (kind === "model")
    return { ...(await savePlaceModelFile(file)), shape: "mesh" };
  throw new Error(
    "Нужна картинка (PNG, JPEG, WebP) или модель (GLB, glTF, OBJ).",
  );
}

/* ------------------------------------------------------------------ *
 * Для «Применить»
 * ------------------------------------------------------------------ */

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk)
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/**
 * Картинки и сетки своих моделей главному процессу: `{ modelImages: {
 * <asset>: { data } }, modelMeshes: { <asset>: { data } } }` (base64) или
 * `null` — моделей нет.
 */
export async function placeModelImages(models) {
  const { images, meshes } = placeModelAssets(models || []);
  if (!images.length && !meshes.length) return null;
  const out = { modelImages: {}, modelMeshes: {} };
  for (const asset of images) {
    const blob = await getWorkshopAsset(asset);
    if (!blob)
      throw new Error(
        "Картинка своей модели пропала из хранилища окна — загрузите её ещё раз.",
      );
    out.modelImages[asset] = { data: await blobBase64(blob) };
  }
  for (const asset of meshes) {
    const blob = await getWorkshopAsset(asset);
    if (!blob)
      throw new Error(
        "Своя модель пропала из хранилища окна — загрузите её ещё раз.",
      );
    out.modelMeshes[asset] = { data: await blobBase64(blob) };
  }
  return out;
}
