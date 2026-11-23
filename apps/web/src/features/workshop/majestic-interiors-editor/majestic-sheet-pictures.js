/*
 * «Интерьеры Majestic RP» — свои картинки листов из студии текстур (ТЗ 29.10.2026-e).
 *
 * Картинка из студии лежит в хранилище окна под отпечатком (`hangar-emblem:<sha256>`, как картинки арены и эмблемы); в работе — только ключ, имя и размер
 * (`majestic-sheets.js`, режим `picture`). Здесь три вещи окна:
 *   • `sheetStudioSurface` — холст студии для листа: размер самого листа (до 2048 px), основа — лист из файлов игрока, слои студии продолжаются при повторном
 *     открытии (документ хранится под ключом поверхности);
 *   • `majesticImages` — байты картинок для «Применить» (base64, как у арены): главному процессу уходят только те, что берёт работа;
 *   • `sheetPictureTextures` — текстуры для кадра: лист с картинкой в кадре рисуется ею, как её запишет установщик.
 */

import * as THREE from "three";
import { sheetPicturesOf } from "@modovik/climb-contract/recolor/majestic-sheets";
import { normalizeMajesticInteriors } from "@modovik/climb-contract/recolor/majestic-interiors-project";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { projectSheetBitmap } from "../project-interiors-editor/project-interiors-data.js";
import { tr } from "../../../locales/ui.js";

/* Холст листа без картинки в игре (плашка): квадрат небольшого размера, цвет — цвет листа. */
const PLATE_CANVAS = 256;

/**
 * Поверхность студии для листа `sheet` (`{ name, colour, entry }` из `sheetsOfAsset`) интерьера `unitId`: `project` — проект каталога (`majestic`),
 * `unitLabel` и `sheetLabel` — слова заголовка окна. Основу студия берёт у `base()`: лист из файлов игрока (нет листа или игры — ровный цвет листа).
 */
export async function sheetStudioSurface({ project, unitId, unitLabel, sheet, sheetLabel }) {
  const bitmap = await projectSheetBitmap(project, unitId, sheet.entry);
  const width = bitmap?.width || PLATE_CANVAS;
  const height = bitmap?.height || PLATE_CANVAS;
  const slug = `majestic-${unitId}-${sheet.name}`.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 96);
  /* Окно студии может закрыть основу после чтения: на каждое открытие — новый снимок. */
  let used = false;
  return {
    id: `majestic:${unitId}:${sheet.name}`,
    slug,
    title: `${unitLabel} · ${sheetLabel}`,
    width,
    height,
    baseColour: sheet.colour,
    ...(bitmap
      ? {
          base: async () => {
            if (used) return projectSheetBitmap(project, unitId, sheet.entry);
            used = true;
            return bitmap;
          },
        }
      : {}),
    placeLabel: tr("Поставить на лист"),
    view3d: null,
  };
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/**
 * Картинки работы для главного процесса: `{ pictures: { <ключ>: { data: base64 } } }` или `null`, если у работы своих картинок листов нет. Картинка, пропавшая из
 * хранилища окна, — понятная ошибка до установки.
 */
export async function majesticImages(project) {
  const assets = sheetPicturesOf(normalizeMajesticInteriors(project).sheets);
  if (!assets.length) return null;
  const pictures = {};
  for (const asset of assets) {
    const blob = await getWorkshopAsset(asset);
    if (!blob) throw new Error(tr("Картинка листа пропала из хранилища окна — откройте лист в студии текстур и поставьте картинку ещё раз."));
    pictures[asset] = { data: await blobBase64(blob) };
  }
  return { pictures };
}

/** Текстура кадра по картинке хранилища: пиксели как есть, без переворота — так их пишет в лист установщик (как у листов сцены и эмблем). */
export async function loadSheetPictureTexture(asset) {
  const blob = await getWorkshopAsset(asset);
  if (!blob || typeof createImageBitmap !== "function") return null;
  const image = await createImageBitmap(blob);
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  /* Текстуру отпустили — освобождается и растр картинки: иначе он висит в памяти окна до сборки мусора. */
  texture.addEventListener("dispose", () => image.close?.());
  return texture;
}
