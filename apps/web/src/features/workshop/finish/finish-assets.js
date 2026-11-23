/*
 * Свои картинки отделки — в хранилище окна мастерской.
 *
 * Картинка человека (с Pinterest, своя фотография) живёт там же, где эмблема
 * ангара (IndexedDB, `workshop-assets.js`), под своим отпечатком:
 * `finish-image:<sha256>`. В работе — только ключ, имя и размер: работа
 * остаётся лёгкой строкой, одна картинка не копится дважды. В код для друга
 * картинка не едет — поверхность у него станет «как в моде».
 *
 * В главный процесс картинка уходит base64-строкой (`images.finishes`):
 * вход канала проходит через JSON.
 */

import { useEffect, useState } from "react";
import {
  getWorkshopAsset,
  prepareWorkshopAsset,
  putWorkshopAsset,
} from "../../../components/desktop/workshop/workshop-assets.js";

export const FINISH_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
export const FINISH_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;

async function imageSize(blob) {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
}

/**
 * Файл человека → картинка отделки: `{ asset, name, width, height }`.
 * Бросает понятной ошибкой на чужом файле.
 */
export async function saveFinishImage(file) {
  if (Number(file?.size || 0) > MAX_BYTES) throw new Error("Картинка больше 8 МБ — возьмите поменьше.");
  const { blob, metadata } = await prepareWorkshopAsset(file, { extensions: FINISH_IMAGE_EXTENSIONS });
  const { width, height } = await imageSize(blob);
  if (!width || !height) throw new Error("Картинка пустая.");
  const asset = `finish-image:${metadata.hash}`;
  await putWorkshopAsset(asset, blob);
  return { asset, name: metadata.name, width, height };
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/**
 * Картинки отделки для «Применить»: ключи → `{ [asset]: { data } }`.
 * Пропавшая из хранилища картинка — отказ словами.
 */
export async function finishImagesPayload(assets) {
  const out = {};
  for (const asset of new Set(assets)) {
    if (!asset) continue;
    const blob = await getWorkshopAsset(asset);
    if (!blob) throw new Error("Своя картинка пропала из хранилища окна — загрузите её ещё раз.");
    out[asset] = { data: await blobBase64(blob) };
  }
  return out;
}

/**
 * Картинки отделки поверхностей работы для «Применить»:
 * `{ finishes: { [ключ]: { data } } }` или `null`, если своих картинок нет.
 */
export async function finishImagesFor(surfaces) {
  const assets = surfaces.filter((item) => item?.mode === "image" && item.image?.asset).map((item) => item.image.asset);
  if (!assets.length) return null;
  return { finishes: await finishImagesPayload(assets) };
}

/** Картинка отделки (ImageBitmap) — для плиток и кадра; `null`, пока не прочитана. */
export function useFinishImage(asset) {
  /*
   * Картинка помнится вместе со своим ключом: пока новая читается, прежняя
   * (уже закрытая) не отдаётся под новым ключом — иначе кадр запоминал
   * текстуру прежней картинки под ключом новой и показывал старый пол
   * (смена шаблона арены, 12.10.2026).
   */
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!asset) {
      setLoaded(null);
      return undefined;
    }
    let cancelled = false;
    let made = null;
    getWorkshopAsset(asset)
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bitmap) => {
        if (cancelled) {
          bitmap?.close?.();
          return;
        }
        made = bitmap;
        setLoaded({ asset, bitmap });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      made?.close?.();
    };
  }, [asset]);
  return loaded?.asset === asset ? loaded.bitmap : null;
}
