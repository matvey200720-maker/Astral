import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { bleedTransparent, fullMipLevels } from "@modovik/dds";
import { DECORATION_TEXTURE_PREFIX } from "@modovik/rage-drawable";
import {
  ATTACHED_CELL_SIZE,
  ATTACHED_MODEL_LIMITS,
  DECORATION_LOGO_SIZE,
  HOLOGRAM_PNG_SIZE,
  MAX_DECORATIONS,
  attachedModelAtlas,
  attachedModelLayout,
  attachedModelPlan,
  decorationMesh,
  decorationTexture,
  normalizeDecorations,
  toRageAxes,
} from "@modovik/gun-studio";
import { callNativeEngine } from "./native-engine.js";
import { heavyWork } from "./heavy-work.js";
import { encodeDdsPooled } from "./dds-pool.js";
import { decodeBase64Payload } from "./base64-payload.js";
import { paintPieceEntries } from "./weapon-paint-pieces.js";

/*
 * Украшения ствола (задача 13 ТЗ 10.10.2026) — в модели игры. Объём —
 * лоза, объёмные цветы и своя голограмма (задача 6 ТЗ 11.10.2026, утро).
 *
 * Окно присылает украшения проекта (`@modovik/gun-studio/decorations.js`) и
 * для логотипов и голограмм — PNG их картинок (голограмма-надпись — тоже
 * картинкой: окно рисует её шрифтом). Здесь из тех же данных собираются те
 * же сетки, что видел кадр, переводятся в оси модели игры (RAGE: x, −z, y),
 * листы цветов и картинки — в DXT5 со всеми мипами, и хост
 * (`decorate-drawable`) ставит их геометриями в модель ствола. Модель —
 * из игры игрока, как у остального скина.
 *
 * Детализация: в `_hi` (ствол в руках) — полные сетки, в обычную `.ydr`
 * (ствол вдали, у других игроков) — облегчённые (`lod: "low"`). Лоза едет
 * частями со своими точками крепления — хост вешает каждую на свою кость.
 */

const MAX_LOGO_BYTES = 4 * 1024 * 1024;
const PNG = /^data:image\/png;base64,/;
const GLB = /^data:(?:model\/gltf-binary|application\/octet-stream);base64,/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
/* У чего своя картинка (или файл): логотип, голограмма, своя модель на стволе. */
const PICTURED = new Set(["logo", "hologram", "model"]);

/**
 * Картинки логотипов и голограмм окна (`data:image/png;base64,…`) и файлы
 * своих моделей на стволе (`data:model/gltf-binary;base64,…`, до 4 МБ —
 * задача 6 ТЗ 17.10.2026): `{ [id украшения]: байты }`.
 */
export function normalizeDecorationImages(input, decorations) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const decoration of decorations) {
    if (!PICTURED.has(decoration.kind)) continue;
    const value = String(input[decoration.id] || "");
    const model = decoration.kind === "model";
    const pattern = model ? GLB : PNG;
    if (!pattern.test(value)) continue;
    /* Длина и запись base64 — до декодирования (`base64-payload.js`); негодная картинка просто не едет. */
    const { bytes } = decodeBase64Payload(value.replace(pattern, ""), model ? ATTACHED_MODEL_LIMITS.fileBytes : MAX_LOGO_BYTES);
    if (bytes) result[decoration.id] = bytes;
  }
  return result;
}

/*
 * Своя модель на стволе: разбор .glb (пределы украшения), лист 256×256 —
 * картинки модели в клетках 128×128 и клетка цветов, с оттенком украшения.
 */
/*
 * Разбор чужого .glb — в потоке-работнике (`heavy-work-jobs.js`, «glb-read»):
 * главный процесс Electron — ещё и окно, и разбор модели не должен его держать
 * (проверка границ доверия, ТЗ 17.10.2026). Копия байтов уходит без общего
 * буфера: вид `Buffer` бывает куском чужого пула.
 */
export function readModelOffThread(bytes, { run = heavyWork.run } = {}) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return run("glb-read", { bytes: copy, maxTriangles: ATTACHED_MODEL_LIMITS.inputTriangles }, { transfer: [copy.buffer] });
}

async function attachedModel(bytes, decoration, readModel) {
  let model;
  try {
    model = await readModel(bytes);
  } catch (error) {
    throw Object.assign(new Error(`Свою модель на стволе не прочитать: ${error?.message || error}`), { code: "DECORATION_MODEL" });
  }
  const plan = attachedModelPlan(model);
  if (!plan.ok)
    throw Object.assign(
      new Error(`Своя модель на стволе не встанет: у неё ${plan.reasons.map((reason) => (reason.code === "images" ? `больше ${reason.limit} картинок` : `больше ${reason.limit} треугольников`)).join(" и ")}.`),
      { code: "DECORATION_MODEL" },
    );
  const layout = attachedModelLayout(model);
  const pictures = [];
  for (const entry of layout.images) {
    const image = model.images[entry.image];
    try {
      const { data } = await sharp(Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength), { failOn: "error" })
        .ensureAlpha()
        .resize(ATTACHED_CELL_SIZE, ATTACHED_CELL_SIZE, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      pictures.push({ width: ATTACHED_CELL_SIZE, height: ATTACHED_CELL_SIZE, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
    } catch {
      pictures.push(null);
    }
  }
  return { model, atlas: attachedModelAtlas(layout, pictures, decoration.colour), alpha: layout.alpha };
}

/** Украшения запроса окна: видимые, в границах договора, логотипы и голограммы — с картинкой. */
export function requestDecorations(input, images = {}) {
  return normalizeDecorations(Array.isArray(input) ? input.slice(0, MAX_DECORATIONS) : [])
    .filter((decoration) => decoration.visible !== false)
    .filter((decoration) => !PICTURED.has(decoration.kind) || images[decoration.id]);
}

async function logoTexture(bytes) {
  const size = DECORATION_LOGO_SIZE;
  const { data } = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: size, height: size, rgba: new Uint8Array(data) };
}

/*
 * Пиксели картинки голограммы — PNG окна как есть (256×256): маска фигуры
 * и лист считаются по ним, как в кадре. Чужой размер вписывается в квадрат.
 */
export async function hologramPixels(bytes) {
  const size = HOLOGRAM_PNG_SIZE;
  const image = sharp(bytes, { failOn: "error" }).ensureAlpha();
  const meta = await sharp(bytes, { failOn: "error" }).metadata();
  const fitted = meta.width === size && meta.height === size ? image : image.resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const { data, info } = await fitted.raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Запрос хоста: сетки в осях модели игры и листы DXT5 на диске (`staging`).
 * `lod` — `high` для `_hi`, `low` для обычной модели. `body` — своя модель
 * ствола (`weapon-own-model.js`): с ней запрос версии 3 и `replace` —
 * прежние геометрии ствола уходят, скелет остаётся.
 */
export async function buildDecorationRequest({ model, decorations, images = {}, staging, lod = "high", body = null, attachments = null, pieces = [], readModel = readModelOffThread }) {
  await fs.mkdir(staging, { recursive: true });
  const list = [];
  for (const [index, decoration] of decorations.entries()) {
    const name = `${DECORATION_TEXTURE_PREFIX}${String(index + 1).padStart(2, "0")}`;
    const pixels = decoration.kind === "hologram" ? await hologramPixels(images[decoration.id]) : null;
    const attached = decoration.kind === "model" ? await attachedModel(images[decoration.id], decoration, readModel) : null;
    let mesh;
    try {
      mesh = decorationMesh(decoration, { lod, pixels, model: attached?.model || null });
    } catch (error) {
      if (!attached) throw error;
      throw Object.assign(new Error(`Своя модель на стволе не встанет: ${error?.message || error}`), { code: "DECORATION_MODEL" });
    }
    /* Голограмма без фигуры (картинка вся прозрачная) — в игру не едет. */
    if (!mesh.vertices) continue;
    const texture =
      decoration.kind === "logo"
        ? await logoTexture(images[decoration.id])
        : decorationTexture(decoration, { pixels, atlas: attached?.atlas || null });
    const bleed = decoration.kind === "logo" || Boolean(attached?.alpha);
    const dds = await encodeDdsPooled({
      width: texture.width,
      height: texture.height,
      format: "DXT5",
      mipLevels: fullMipLevels(texture.width, texture.height),
      rgba: bleed ? bleedTransparent(texture.rgba, texture.width, texture.height) : texture.rgba,
    });
    const file = path.join(staging, `${name}.dds`);
    await fs.writeFile(file, dds);
    const anchor = toRageAxes(Float32Array.from([decoration.anchor.x, decoration.anchor.y, decoration.anchor.z]));
    list.push({
      name,
      anchor: Array.from(anchor),
      positions: Array.from(toRageAxes(mesh.positions)),
      normals: Array.from(toRageAxes(mesh.normals)),
      uvs: Array.from(mesh.uvs),
      indices: Array.from(mesh.indices),
      texture: file,
      textureSha256: `sha256:${sha256(dds)}`,
      width: texture.width,
      height: texture.height,
      alpha: mesh.alpha,
      ...(mesh.emissive > 0 ? { emissive: mesh.emissive } : {}),
      ...(mesh.parts?.length
        ? {
            parts: mesh.parts.map((part) => ({
              anchor: Array.from(toRageAxes(Float32Array.from(part.anchor))),
              vertex: part.vertex,
              vertices: part.vertices,
              index: part.index,
              indices: part.indices,
            })),
          }
        : {}),
    });
  }
  /* Отделённые куски развёртки — одним украшением поверх ствола
     (`weapon-paint-pieces.js`); окно держит для него место среди
     украшений, а запрос хоста больше двенадцати не берёт. */
  if (list.length < MAX_DECORATIONS) list.push(...(await paintPieceEntries(pieces, path.join(staging, "pieces"))));
  /* Имена листов — по порядку поставленных: пропуск не оставляет дыр. */
  for (const [index, entry] of list.entries()) {
    const name = `${DECORATION_TEXTURE_PREFIX}${String(index + 1).padStart(2, "0")}`;
    if (entry.name === name) continue;
    const file = path.join(staging, `${name}.dds`);
    await fs.rename(entry.texture, file);
    entry.name = name;
    entry.texture = file;
  }
  /* Обвесы на костях ствола (задача 6 ТЗ 17.10.2026) — запрос версии 4. */
  const parts = attachments?.pieces?.length ? attachments : null;
  const request = {
    format: "astral.decorate-drawable",
    version: parts ? 4 : body ? 3 : 2,
    model,
    ...(body ? { replace: true, body } : {}),
    decorations: list,
    ...(parts ? { attachments: parts } : {}),
  };
  const requestFile = path.join(staging, "decorate.json");
  await fs.writeFile(requestFile, `${JSON.stringify(request)}\n`);
  return { requestFile, count: list.length + (body ? body.pieces.length : 0) + (parts ? parts.pieces.length : 0) };
}

/**
 * Модель ствола с украшениями: `{ bytes, report }`. `native` — вызов хоста
 * (в тестах — подмена).
 */
export async function decorateWeaponModel({ input, output, decorations, images = {}, staging, lod = "high", body = null, attachments = null, pieces = [] }, context = null, native = callNativeEngine) {
  const { requestFile, count } = await buildDecorationRequest({ model: input, decorations, images, staging, lod, body, attachments, pieces });
  if (!count) return null;
  const report = await native("decorate-drawable", { input: requestFile, output }, context);
  const bytes = await fs.readFile(output);
  return { bytes, report };
}
