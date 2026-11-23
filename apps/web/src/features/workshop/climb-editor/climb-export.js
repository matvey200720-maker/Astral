/*
 * Выгрузка текстур залазов.
 *
 * Установка в игру живёт отдельно: она собирает модели меток заново. Эта
 * выгрузка — для тех, кто правит модели сам или ставит метки на своём
 * сервере: текстуры DDS (DXT5 со всеми mip-уровнями) и те же PNG, плюс
 * записка, какая текстура к какой модели. Пиксели — те, что человек видел в
 * кадре: их рисует тот же `renderClimbMarker`.
 */

import { bleedTransparent, encodeDds, fullMipLevels } from "@modovik/dds";
import {
  CLIMB_SLOTS,
  CLIMB_TEXTURE_FORMAT,
  climbMarkerEmission,
  normalizeClimbDesign,
} from "@modovik/climb-contract";
import {
  createStoredZip,
  downloadBlob,
} from "../../../components/desktop/workshop/workshop-export.js";
import { rgbaToCanvas } from "../../../components/desktop/workshop/canvas-surface.js";
import { renderClimbMarker } from "./climb-render.js";
import { prepareOwnFonts } from "../emblem/own-font.js";
import { tr, useTr } from "../../../locales/ui.js";

const README = (design, rendered) => {
  useTr();
  const emission = climbMarkerEmission(design);
  return [
    tr("Текстуры залазов — Astral"),
    "",
    `Набор: ${design.name}`,
    `Формат: ${CLIMB_TEXTURE_FORMAT}, все mip-уровни; рядом те же картинки в PNG.`,
    "",
    tr("Какая текстура к какой модели мода (climbs.ytyp):"),
    ...rendered.map(
      ({ slot, file, width, height }) =>
        `  ${slot.model}.ydr — ${slot.label.padEnd(14)} ${file}.dds  ${width}x${height}`,
    ),
    "",
    tr("В моделях мода надписи выдавлены геометрией, а зашитые белые текстуры"),
    tr("дают только цвет, поэтому картинку в них подменить нельзя. Кнопка"),
    tr("«Применить» в редакторе собирает модели заново: плашка на месте метки с"),
    `этой текстурой, шейдер ${emission.lit ? tr("alpha (без свечения)") : `emissive_alpha, emissiveMultiplier ${emission.multiplier}`}.`,
    tr("Для своей сборки: квад по лицевой грани метки, UV 0..1, альфа-смешение;"),
    tr("стрелка, «STAY HERE» и «JUMP SPACE» стоят в плоскости XZ, остальные — XY."),
  ].join("\n");
};

const safe = (value) => value.replace(/[\\/:*?"<>|]+/g, "-");

async function pngBytes(rgba, width, height) {
  const canvas = rgbaToCanvas(rgba, width, height);
  if (!canvas?.toBlob) return null;
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/**
 * Файлы выгрузки: по DDS и PNG на каждую видимую метку и записка.
 * `pictures` — готовые свои картинки меток (`prepareClimbPicture`).
 */
export async function climbTextureFiles(designInput, { pictures = {} } = {}) {
  const design = normalizeClimbDesign(designInput);
  await prepareOwnFonts(design.style.fontAsset);
  const files = {};
  const rendered = [];
  for (const slot of CLIMB_SLOTS) {
    if (!design.markers[slot.id].enabled) continue;
    const result = renderClimbMarker(design, slot.id, {
      picture: pictures[slot.id] || null,
    });
    if (!result) throw new Error("Текстуры нечем нарисовать: нет холста.");
    const file = `${slot.model}_${slot.id}`;
    const png = await pngBytes(result.rgba, result.width, result.height);
    if (png) files[`${file}.png`] = png;
    files[`${file}.dds`] = encodeDds({
      width: result.width,
      height: result.height,
      format: CLIMB_TEXTURE_FORMAT,
      mipLevels: fullMipLevels(result.width, result.height),
      rgba: bleedTransparent(
        new Uint8ClampedArray(result.rgba),
        result.width,
        result.height,
      ),
    });
    rendered.push({ slot, file, width: result.width, height: result.height });
  }
  files["README.txt"] = README(design, rendered);
  return files;
}

/** Архив с текстурами в загрузки. */
export async function downloadClimbTextures(designInput, options = {}) {
  const design = normalizeClimbDesign(designInput);
  downloadBlob(
    createStoredZip(await climbTextureFiles(design, options)),
    `${safe(design.name) || "climbs"} — текстуры залазов.zip`,
  );
}
