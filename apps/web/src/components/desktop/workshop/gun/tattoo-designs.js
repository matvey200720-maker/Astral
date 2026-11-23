/*
 * Тату игры на теле в мастерской одежды (задача 3 ТЗ 06.10.2026, вечер; голос владельца 01.11.2026): выбранное тату ложится слоем-картинкой на свою зону — на место этого тату в игре (рамка коллекции: центр,
 * размер, поворот, зеркало) — и правится, как любой слой. Слой помнит ключ тату (`tattoo`): по нему «Применить» спрашивает про каждое тату отдельно. Игра тянет картинку тату на рамку, поэтому и здесь она заранее
 * растянута под рамку; рамка через шов U — второй слой по ту сторону шва.
 */

import { useCallback } from "react";
import { TATTOO_ZONES, zoneIndex } from "@modovik/clothing/tattoo-zones";
import { addLayer, createImageLayer, removeLayer } from "@modovik/gun-studio";
import { tattooDesignLayout } from "../../../../features/clothing/tattoo-parts.js";
import { storeGunRaster } from "./gun-images.js";
import { tr } from "../../../../locales/ui.js";

export { tattooDesignLayout };

/*
 * Сторона, с которой камера смотрит на тату, когда места на теле найти не удалось (сцена ищет его по нормали у рамки): по слову в названии и по зоне. Спина — «сзади»; рука и нога — снаружи; бок торса или головы —
 * «слева» и «справа» (у персонажа, не у зрителя); иначе спереди.
 */
export const sideOf = (tattoo) => {
  const facing = tattoo?.facing || "";
  if (/сзади/.test(facing)) return "back";
  if (/arm|leg/.test(tattoo?.zone || "")) return "outside";
  if (/слева/.test(facing)) return "left";
  if (/справа/.test(facing)) return "right";
  return "front";
};

/** Картинка, растянутая под пропорции рамки тату. */
async function stretched(bytes, layout) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  try {
    let width = Math.max(1, bitmap.width);
    let height = Math.max(1, Math.round((width * layout.frameHeight) / Math.max(layout.frameWidth, 1)));
    const over = Math.max(width, height) / 2048;
    if (over > 1) {
      width = Math.max(1, Math.round(width / over));
      height = Math.max(1, Math.round(height / over));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    /* Рамка с отрицательным размером: игра рисует картинку зеркально (`tattooPlacement`). */
    context.translate(layout.flipX ? width : 0, layout.flipY ? height : 0);
    context.scale(layout.flipX ? -1 : 1, layout.flipY ? -1 : 1);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

/*
 * Поверхности зон тела строятся следом за сценой: смена раздела или наряда пересобирает персонажа, и плитку нажимают, пока зона ещё не встала (03.11.2026, плитка «Шея» говорила «этой части тела нет на модели»). Зона, которой в этом теле
 * правда нет, не появится никогда, поэтому ждём недолго — и только потом говорим об ошибке.
 */
export const SURFACE_WAIT_MS = 3000;
const SURFACE_STEP_MS = 100;

/** Поверхность зоны `material`: готовая или та, что встанет в ближайшие `SURFACE_WAIT_MS`; `null` — зоны у тела нет. */
export async function waitForSurface(surfaceOf, material, { limit = SURFACE_WAIT_MS, step = SURFACE_STEP_MS } = {}) {
  let surface = material ? surfaceOf(material) : null;
  for (let waited = 0; material && !surface && waited < limit; waited += step) {
    await new Promise((resolve) => setTimeout(resolve, step));
    surface = surfaceOf(material);
  }
  return surface;
}

/** Слои тату игры на теле (с двойником за швом): `[{ material, id }]`. */
export function tattooLayersOf(project, key) {
  const out = [];
  for (const material of project?.materials || []) for (const layer of material.layers || []) if (layer.tattoo === key) out.push({ material: material.name, id: layer.id });
  return out;
}

/** Снять тату игры с тела: все его слои. */
export function dropTattooLayers(next, key) {
  for (const { material, id } of tattooLayersOf(next, key)) removeLayer(next, material, id);
}

/**
 * Поставить тату игры на тело: `(tattoo, bytes, title) → Promise<bool>` — PNG картинки
 * тату ложится слоем на свою зону, на место этого тату.
 */
export function useTakeTattooDesign({
  edit,
  surfaceOf,
  scene,
  setActiveMaterial,
  setActiveLayerId,
  onNotice,
}) {
  return useCallback(
    async (tattoo, bytes, title) => {
      const material = TATTOO_ZONES[zoneIndex(tattoo?.zone)]?.material || "";
      const surface = await waitForSurface(surfaceOf, material);
      if (!surface) {
        onNotice?.(tr("Этой части тела нет на модели — открой тело персонажа в «Моделях»"), "error");
        return false;
      }
      const layout = tattooDesignLayout(tattoo, surface);
      const source = await storeGunRaster(await stretched(bytes, layout));
      /* Пока картинка готовилась, мастерская могла уйти на другую вещь:
         слой — только в тело, на котором его взяли. */
      if (surfaceOf(material) !== surface) return false;
      let first = "";
      edit(`tattoo-design:${tattoo.key}`, (next) => {
        for (const x of [layout.x, ...layout.twins]) {
          const layer = createImageLayer({
            name: x === layout.x ? title : `${title} ${tr("· за швом")}`,
            source,
            x,
            y: layout.y,
            scale: layout.scale,
            rotation: layout.rotation,
            tattoo: tattoo.key,
          });
          addLayer(next, material, layer);
          if (!first) first = layer.id;
        }
      });
      setActiveMaterial(material);
      if (first) setActiveLayerId(first);
      /* Камера плавно летит к самому тату: место рамки в зоне — центр слоя (проценты зоны), размер — её доля в зоне. */
      scene.current?.focusPart?.({
        materials: [material],
        side: sideOf(tattoo),
        at: { u: layout.x / 100, v: layout.y / 100 },
        fraction: Math.max(layout.frameWidth / Math.max(surface.width, 1), layout.frameHeight / Math.max(surface.height, 1)),
      });
      return true;
    },
    [edit, surfaceOf, scene, setActiveMaterial, setActiveLayerId, onNotice],
  );
}
