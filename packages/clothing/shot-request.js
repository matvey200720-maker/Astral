/*
 * Запрос снимка вещи без ссылок на ресурс.
 *
 * Работник одежды просит снимок у `ctx.render({ drawable, texture, category,
 * side })`, а снимает окно: в Astral Desktop — скрытое окно-съёмщик, в
 * команде `clothing:intake` — такое же окно её Electron. Ресурс модели в окно
 * не передать, поэтому запрос сводится к тому, что переживает IPC: меши
 * (типизированные массивы), картинка расцветки и карта нормалей. Карта
 * нормалей педа лежит в самой модели (`jbib_normal_000`) — без неё складки
 * ткани плоские, поэтому она декодируется здесь, рядом с ресурсом.
 */

import { decodeTextureRef } from "@modovik/rage-drawable";

/* Тон кожи под рисунком тату (`tattooShowcase`, снимок категории «Татуировки»). */
export const TATTOO_SKIN = Object.freeze([0xa8, 0x76, 0x5a]);

/*
 * Свой ракурс снимка (`{ yaw, pitch }`, градусы) — у карточек категорий:
 * там вещь смотрит лицом в камеру, а не в три четверти, как в каталоге.
 */
function viewOf(view) {
  const yaw = Number(view?.yaw);
  const pitch = Number(view?.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return {
    yaw: Math.max(-360, Math.min(360, yaw)),
    pitch: Math.max(-89, Math.min(89, pitch)),
  };
}

/* Карта нормалей модели разбирается один раз: части тела персонажа живут в памяти Desktop, и тот же буфер даёт тот же кэш PNG при сборке GLB (круг 4, 28.10.2026). */
const normalPictures = new WeakMap();

/** Карта нормалей вещи из словаря, зашитого в модель, или `null`. */
export function normalPictureOf(drawable) {
  const keyed = drawable && typeof drawable === "object";
  if (keyed && normalPictures.has(drawable)) return normalPictures.get(drawable);
  const name = drawable?.meshes?.find((mesh) => mesh.material?.textures?.normal)
    ?.material.textures.normal;
  const ref = name
    ? drawable.embeddedTextures?.find(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      )
    : null;
  /*
   * И по самой текстуре словаря (02.11.2026, стенд `wear-dress-sweep.mjs`): персонаж собирает вещи комплекта новыми объектами (`{ ...drawable, meshes }`, тело без закрытой кожи),
   * и кэш по объекту модели промахивался на каждом щелчке — карта нормалей каждой надетой вещи раскодировалась и кодировалась в PNG заново (≈ 30 мс при ×1 на щелчок).
   * Ссылка на текстуру у таких копий та же: тот же буфер картинки — тот же кэш PNG (`encodePngOnce`).
   */
  let picture = ref && normalPictures.has(ref) ? normalPictures.get(ref) : null;
  if (ref?.format && !normalPictures.has(ref)) {
    try {
      picture = decodeTextureRef(ref, { maxSize: 1024 });
    } catch {
      picture = null;
    }
    if (typeof ref === "object") normalPictures.set(ref, picture);
  }
  if (keyed) normalPictures.set(drawable, picture);
  return picture;
}

/** Номер снимков вещей игры для плиток выбора: новый — снимки снимаются заново (формат запроса, ракурсы, съёмщик). Ключ кэша окна. */
export const ITEM_SHOT_VERSION = 2;

export function shotRequestOf(
  drawable,
  { texture = null, category = null, side = "front", view = null } = {},
) {
  const meshes = drawable.meshes.map((mesh) => ({
    positions: mesh.positions,
    normals: mesh.normals,
    uvs: mesh.uvs,
    indices: mesh.indices,
    alphaMode: mesh.material?.alphaMode || "opaque",
    /* Слой рисунка поверх тела (тату по зонам, `zoneBody`): его картинка прозрачная, альфа — сам рисунок. */
    ...(mesh.material?.extras?.astralDrawing ? { overlay: true } : {}),
    /* Несколько вещей в одном кадре (`combinedDrawable`): у каждой своя
       расцветка и карта нормалей. */
    ...(mesh.material?.astralPart
      ? {
          texture: mesh.material.astralPart.picture || null,
          normal: mesh.material.astralPart.normal || null,
        }
      : {}),
  }));
  return {
    meshes,
    texture,
    normal: normalPictureOf(drawable),
    category,
    side: side === "back" ? "back" : "front",
    view: viewOf(view),
  };
}
