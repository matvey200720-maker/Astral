/*
 * Чернила части работы с тела для окна «Куда поставить татуировки»: картинка только её слоёв — чтобы показать кадр строки и честно сказать, что лежит за рамкой выбранного тату. Считается холстом мастерской без сцены
 * (`bakeOutfitDraft`), поэтому работает и из другой категории — там, где тела в кадре нет. Наклейки печатает только сцена: часть с наклейками собирает открытая витрина (`live`).
 */

import { bakeOutfitDraft } from "./outfit-paint.js";

const SIDE = 256;
/* Запас вокруг чернил в кадре строки — в долях картинки. */
const MARGIN = 0.02;

/* Кадр строки: чернила части без пустоты вокруг. U замкнута: рисунок через шов (половина у правого края, половина у левого) в кадре стоит целым. */
function thumbOf(canvas, data, width, height) {
  const used = new Uint8Array(width);
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      used[x] = 1;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  if (bottom < 0) return "";
  /* Самая длинная пустота по кругу — там и разрезаем. */
  let gap = 0;
  let gapEnd = 0;
  let run = 0;
  for (let step = 0; step < 2 * width; step += 1) {
    run = used[step % width] ? 0 : Math.min(run + 1, width);
    if (run > gap) {
      gap = run;
      gapEnd = step;
    }
  }
  const pad = Math.ceil(Math.max(width, height) * MARGIN);
  const fromX = (((gapEnd + 1 - pad) % width) + width) % width;
  const fromY = Math.max(0, top - pad);
  const crop = document.createElement("canvas");
  crop.width = Math.min(width, width - gap + 2 * pad);
  crop.height = Math.min(height, bottom + pad + 1) - fromY;
  const context = crop.getContext("2d");
  context?.drawImage(canvas, fromX, fromY, Math.min(crop.width, width - fromX), crop.height, 0, 0, Math.min(crop.width, width - fromX), crop.height);
  if (fromX + crop.width > width) context?.drawImage(canvas, 0, fromY, fromX + crop.width - width, crop.height, width - fromX, 0, fromX + crop.width - width, crop.height);
  return crop.toDataURL("image/png");
}

function shrink(source) {
  const ratio = SIDE / Math.max(source.width, source.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

async function draftInk(project, part, cache) {
  const material = (project?.materials || []).find((item) => item.name === part.material);
  if (!material) return null;
  const layers = material.layers.filter((layer) => part.layers.includes(layer.id));
  const blank = document.createElement("canvas");
  const canvases = await bakeOutfitDraft(
    { materials: [{ ...material, layers }] },
    new Map([[material.name, { image: blank, width: material.width || 1024, height: material.height || 1024 }]]),
    cache,
    { drawing: true },
  );
  const canvas = canvases.get(material.name);
  return canvas ? shrink(canvas) : null;
}

/** Чернила частей: `Map<id части, { width, height, data, thumb }>`; `live(part)` — часть с наклейками с открытой витрины. */
export async function readPartInks(parts, { project, cache = null, live = null }) {
  const out = new Map();
  for (const part of parts) {
    if (!part.zone) continue;
    let image = null;
    try {
      if (part.stickers && live) {
        const shot = live(part);
        if (shot) {
          const canvas = document.createElement("canvas");
          canvas.width = shot.width;
          canvas.height = shot.height;
          canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(shot.data), shot.width, shot.height), 0, 0);
          image = { canvas, width: shot.width, height: shot.height, data: shot.data };
        }
      } else image = await draftInk(project, part, cache);
    } catch {
      image = null;
    }
    if (image) out.set(part.id, { width: image.width, height: image.height, data: image.data, thumb: thumbOf(image.canvas, image.data, image.width, image.height) });
  }
  return out;
}
