/*
 * Своя эмблема метки над животным (06.11.2026): картинка человека (PNG, JPG или WebP) вместо готового значка.
 *
 * Файл человека готовится в окне: вписывается целиком в квадрат 128×128 с прозрачными полями (прозрачность PNG и WebP
 * сохраняется, цвета картинки остаются как есть), сохраняется PNG-ом в хранилище мастерской под отпечатком SHA-256 и по
 * отпечатку находится в черновике, в работе и у установщика. Установщик (`apps/desktop/src/animals/animals-build.js`) входу не
 * верит: сверяет байты с отпечатком, разбирает картинку заново и кладёт её в левую половину листа метки 256×128.
 *
 * GIF не принимается: у листа метки в модели кадров нет, а первый кадр без слов читался бы как ошибка. Файл больше 16 МБ,
 * не картинка или слишком мелкая (меньше 16 пикселей по короткой стороне — на листе остался бы цветной квадрат) — отказ словами.
 */

import { useEffect, useState } from "react";
import { animalEmblemHashes } from "@modovik/climb-contract/animals";
import { READBACK, context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import { getWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";

const ASSET_PREFIX = "animal-emblem:";
export const EMBLEM_MAX_FILE_BYTES = 16 * 1024 * 1024;
/* Сторона готовой картинки: половина листа метки 256×128 — квадрат 128×128. */
export const EMBLEM_EDGE = 128;
export const EMBLEM_MIN_EDGE = 16;
export const ANIMAL_EMBLEM_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

/** Что за файл по первым байтам: `png`, `jpeg`, `webp` или `null` (имя и тип, что назвал браузер, не решают). */
export function emblemKind(head) {
  if (!head || head.length < 12) return null;
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (String.fromCharCode(head[0], head[1], head[2], head[3]) === "RIFF" && String.fromCharCode(head[8], head[9], head[10], head[11]) === "WEBP") return "webp";
  return null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(tr("Картинку не прочитать — выберите PNG, JPG или WebP")));
    image.src = src;
  });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canvasPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error(tr("Эмблема не собралась — попробуйте другую картинку")));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function base64Of(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * Файл человека → `{ asset, name, width, height, transparent }`; готовая PNG-эмблема — в хранилище мастерской.
 * `width`/`height` — размер исходной картинки, `transparent` — есть ли у неё прозрачные места (после подготовки).
 */
export async function importAnimalEmblem(file) {
  if (!file) throw new Error(tr("Выберите картинку"));
  if (file.size > EMBLEM_MAX_FILE_BYTES) throw new Error(tr("Файл больше 16 МБ — возьмите поменьше"));
  const kind = emblemKind(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!kind || (file.type && !ANIMAL_EMBLEM_TYPES.includes(String(file.type).toLowerCase()))) throw new Error(tr("Нужна картинка: PNG, JPG или WebP"));
  const url = URL.createObjectURL(file);
  try {
    const source = await loadImage(url);
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (Math.min(width, height) < EMBLEM_MIN_EDGE) throw new Error(tr("Картинка слишком мелкая — нужно хотя бы 16 пикселей по короткой стороне"));
    const canvas = document.createElement("canvas");
    canvas.width = EMBLEM_EDGE;
    canvas.height = EMBLEM_EDGE;
    const context = context2d(canvas, READBACK);
    if (!context) throw new Error(tr("Картинку негде подготовить: нет холста"));
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, EMBLEM_EDGE, EMBLEM_EDGE);
    /* Вписать целиком, по центру: метка квадратная, длинная картинка не обрезается. */
    const scale = Math.min(EMBLEM_EDGE / width, EMBLEM_EDGE / height);
    const drawWidth = Math.max(1, Math.round(width * scale));
    const drawHeight = Math.max(1, Math.round(height * scale));
    context.drawImage(source, Math.round((EMBLEM_EDGE - drawWidth) / 2), Math.round((EMBLEM_EDGE - drawHeight) / 2), drawWidth, drawHeight);
    const { data } = context.getImageData(0, 0, EMBLEM_EDGE, EMBLEM_EDGE);
    let transparent = false;
    for (let at = 3; at < data.length; at += 4)
      if (data[at] < 250) {
        transparent = true;
        break;
      }
    const bytes = await canvasPngBytes(canvas);
    const asset = await sha256Hex(bytes);
    await putWorkshopAsset(`${ASSET_PREFIX}${asset}`, new Blob([bytes], { type: "image/png" }));
    return { asset, name: String(file.name || tr("картинка")).slice(0, 80), width, height, transparent };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PNG эмблемы в хранилище мастерской или `null`, если её нет на этом компьютере. */
export async function animalEmblemBlob(asset) {
  if (!asset) return null;
  return (await getWorkshopAsset(`${ASSET_PREFIX}${asset}`).catch(() => null)) || null;
}

/**
 * Адрес эмблемы для кадра и подписи: `{ url, status }`; `status` — `none` (эмблемы нет в работе), `loading`, `ready` или
 * `missing` (отпечаток есть, а картинки на этом компьютере нет — работа пришла с другого). Адрес освобождается сам.
 */
export function useAnimalEmblem(asset) {
  const [state, setState] = useState({ asset: "", url: "", status: "none" });
  useEffect(() => {
    if (!asset) {
      setState({ asset: "", url: "", status: "none" });
      return undefined;
    }
    let cancelled = false;
    let url = "";
    setState({ asset, url: "", status: "loading" });
    animalEmblemBlob(asset).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setState({ asset, url: "", status: "missing" });
        return;
      }
      url = URL.createObjectURL(blob);
      setState({ asset, url, status: "ready" });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset]);
  /* Пока состояние догоняет смену отпечатка, чужой адрес не отдаётся. */
  return state.asset === (asset || "") ? state : { asset: asset || "", url: "", status: asset ? "loading" : "none" };
}

/**
 * Свои эмблемы работы для установщика: отпечаток → PNG base64; `missing` — каких нет на этом компьютере.
 * Установщик сверяет каждую с отпечатком и разбирает заново.
 */
export async function animalEmblemsFor(project) {
  const pictures = {};
  const missing = [];
  for (const asset of animalEmblemHashes(project)) {
    const blob = await animalEmblemBlob(asset);
    if (blob) pictures[asset] = base64Of(new Uint8Array(await blob.arrayBuffer()));
    else missing.push(asset);
  }
  return { pictures, missing };
}
