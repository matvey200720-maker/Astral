/*
 * Своя модель ствола в окне (задача 6 ТЗ 17.10.2026): её файл из хранилища
 * мастерской, разобранный тем же кодом, что соберёт её в игру
 * (`@modovik/gun-studio/own-model`), — чтобы ещё до «Применить» сказать,
 * что с ней будет: сколько треугольников в руках и вдали, упростит ли её
 * Astral, сколько картинок и какая длина, или почему она не встанет.
 *
 * Разобранная модель — в кэше модуля по хешу файла, а не в состоянии React:
 * её буферы не ездят пропсами (заметка «буферы пикселей не в пропсах»).
 */

import { OWN_MODEL_LIMITS, autoFit, ownModelPlan, readGlb } from "@modovik/gun-studio/own-model";
import {
  ATTACHED_CELL_SIZE,
  ATTACHED_MODEL_LIMITS,
  attachedModelLayout,
  attachedModelPlan,
  customModelHash,
} from "@modovik/gun-studio";
import { getWorkshopAsset, prepareWorkshopAsset, putWorkshopAsset } from "../workshop-assets.js";

const assetKey = (hash) => `gunmodel:${hash}`;
const parsed = new Map();

async function blobOf(entry) {
  const hash = customModelHash(entry);
  if (!hash) throw new Error("own-model: no file");
  const blob = await getWorkshopAsset(assetKey(hash));
  if (!blob) throw Object.assign(new Error("own-model: missing"), { code: "OWN_MODEL_MISSING" });
  return blob;
}

/**
 * Разбор своей модели: `{ model, bytes }` или `{ error }` (код отказа
 * разбора — `GLB_*`, текст — по-русски из разборщика). Кэш — по хешу файла.
 */
export function ownModelData(entry) {
  const hash = customModelHash(entry);
  if (!hash) return Promise.resolve({ error: { code: "OWN_MODEL_MISSING" } });
  if (!parsed.has(hash))
    parsed.set(
      hash,
      blobOf(entry)
        .then(async (blob) => {
          if (blob.size > OWN_MODEL_LIMITS.fileBytes) return { error: { code: "OWN_MODEL_FILE", size: blob.size }, size: blob.size };
          const bytes = new Uint8Array(await blob.arrayBuffer());
          try {
            return { model: readGlb(bytes, { maxTriangles: OWN_MODEL_LIMITS.inputTriangles }), size: blob.size };
          } catch (error) {
            return { error: { code: error?.code || "GLB_FORMAT", message: String(error?.message || error) }, size: blob.size };
          }
        })
        .catch((error) => ({ error: { code: error?.code || "OWN_MODEL_MISSING" } })),
    );
  return parsed.get(hash);
}

/** Подгонка по штатному стволу (`target` — `{ min, max }` в осях кадра). */
export async function ownModelAutoFit(entry, target) {
  const data = await ownModelData(entry);
  return data.model ? autoFit(data.model, target) : null;
}

/** Что будет со своей моделью в игре при подгонке `fit` (см. `ownModelPlan`). */
export async function ownModelVerdict(entry, fit) {
  const data = await ownModelData(entry);
  if (!data.model) return { ok: false, error: data.error, size: data.size || 0 };
  return { ...ownModelPlan(data.model, fit), size: data.size };
}

const glbDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;,]*;/, "data:model/gltf-binary;"));
    reader.onerror = () => reject(reader.error || new Error("own-model: read"));
    reader.readAsDataURL(blob);
  });

/** Файл своей модели data URL'ом — так он едет в «Применить». */
export async function ownModelDataUrl(entry) {
  return glbDataUrl(await blobOf(entry));
}

/* ---------------------- своя модель на стволе ---------------------- */

/*
 * Маленький .glb у точки ствола (брелок, фигурка) — украшение «Своя
 * модель» (`decoration-model.js`). Файл — в хранилище мастерской под своим
 * ключом (`gunattach:<хеш>`): своя модель ствола и украшение не делят файл,
 * и «Убрать модель» в «Моделях» не снимает украшение.
 */
const ATTACH_PREFIX = "asset:gunattach:";
const attachKey = (source) => `gunattach:${String(source || "").slice(ATTACH_PREFIX.length)}`;
const attached = new Map();

/** Кладёт файл в хранилище: `{ source, name, plan }` или отказ словами. */
export async function storeAttachedModel(file) {
  const { blob, metadata } = await prepareWorkshopAsset(file, { extensions: new Set(["glb"]) });
  if (blob.size > ATTACHED_MODEL_LIMITS.fileBytes)
    throw Object.assign(new Error("attached: too large"), { code: "OWN_MODEL_FILE", limit: ATTACHED_MODEL_LIMITS.fileBytes });
  let model;
  try {
    model = readGlb(new Uint8Array(await blob.arrayBuffer()), { maxTriangles: ATTACHED_MODEL_LIMITS.inputTriangles });
  } catch (error) {
    /* Предел украшения, а не своей модели ствола: отказ говорит его число. */
    throw Object.assign(error, { limit: ATTACHED_MODEL_LIMITS.inputTriangles });
  }
  const plan = attachedModelPlan(model);
  const source = `${ATTACH_PREFIX}${metadata.hash}`;
  await putWorkshopAsset(attachKey(source), new Blob([blob], { type: "model/gltf-binary" }));
  return { source, name: metadata.name.replace(/\.[^.]+$/, ""), plan };
}

/* Картинка модели → RGBA клетки листа 128×128 (как вписывает Astral Desktop). */
async function cellPixels(image) {
  const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.mimeType || "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATTACHED_CELL_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, ATTACHED_CELL_SIZE, ATTACHED_CELL_SIZE);
  bitmap.close?.();
  const data = context.getImageData(0, 0, ATTACHED_CELL_SIZE, ATTACHED_CELL_SIZE);
  return { width: ATTACHED_CELL_SIZE, height: ATTACHED_CELL_SIZE, rgba: new Uint8Array(data.data.buffer) };
}

/**
 * Своя модель на стволе для кадра: `{ model, layout, pictures, plan }` —
 * разобранный .glb и клетки его картинок (кэш по источнику, не в React).
 */
export function attachedModelArtwork(source) {
  if (!String(source || "").startsWith(ATTACH_PREFIX)) return Promise.reject(new Error("attached: source"));
  if (!attached.has(source))
    attached.set(
      source,
      getWorkshopAsset(attachKey(source)).then(async (blob) => {
        if (!blob) throw Object.assign(new Error("attached: missing"), { code: "OWN_MODEL_MISSING" });
        const model = readGlb(new Uint8Array(await blob.arrayBuffer()), { maxTriangles: ATTACHED_MODEL_LIMITS.inputTriangles });
        const layout = attachedModelLayout(model);
        const pictures = [];
        for (const entry of layout.images) pictures.push(await cellPixels(model.images[entry.image]).catch(() => null));
        return { attached: true, model, layout, pictures, plan: attachedModelPlan(model) };
      }),
    );
  const pending = attached.get(source);
  pending.catch(() => attached.delete(source));
  return pending;
}

/** Файл своей модели на стволе data URL'ом — для «Применить». */
export async function attachedModelDataUrl(source) {
  const blob = await getWorkshopAsset(attachKey(source));
  if (!blob) throw Object.assign(new Error("attached: missing"), { code: "OWN_MODEL_MISSING" });
  return glbDataUrl(blob);
}
