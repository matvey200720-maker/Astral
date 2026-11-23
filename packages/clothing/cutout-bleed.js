// Лист с вырезом по альфе (волосы, мех, сетки: шейдеры `ped_hair_cutout_alpha`, `ped_hair_spiked`, `ped_fur`, `cutout`) — белая кайма по краям прядей (14.11.2026, владелец: «борода… беленькие»).
// У прозрачных точек листа цвет не нужен игре, и в файле там бывает белое или чёрное. Видеочип при сглаживании подмешивает цвет прозрачной соседки к краю пряди — получается светлая обводка.
// Лечение — «затекание цвета»: у прозрачных точек цвет берётся от ближайших непрозрачных, альфа не меняется. Только для сеток с режимом `mask`, остальные листы не трогаем.

const SOLID_ALPHA = 128;

/** Есть ли у модели сетка с вырезом по альфе листа. */
export function hasCutoutMesh(drawable) {
  return (drawable?.meshes ?? []).some(
    (mesh) => mesh.material?.alphaMode === "mask",
  );
}

/**
 * Лист с затёкшим цветом: прозрачные точки (альфа < 128) получают среднее цвета непрозрачных соседей по восьми направлениям, до `passes` шагов вглубь.
 * Альфа и цвет непрозрачных точек не меняются; исходный лист не трогаем.
 */
export function bleedCutout(picture, { passes = 6 } = {}) {
  const { width, height, rgba } = picture;
  if (!rgba || !width || !height) return picture;
  const out = new Uint8Array(rgba);
  const solid = new Uint8Array(width * height);
  let transparent = 0;
  for (let at = 0; at < solid.length; at += 1) {
    if (rgba[at * 4 + 3] >= SOLID_ALPHA) solid[at] = 1;
    else transparent += 1;
  }
  if (!transparent || transparent === solid.length) return picture;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (solid[index]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const other = ny * width + nx;
            if (!solid[other]) continue;
            r += out[other * 4];
            g += out[other * 4 + 1];
            b += out[other * 4 + 2];
            count += 1;
          }
        if (count) next.push([index, r / count, g / count, b / count]);
      }
    if (!next.length) break;
    for (const [index, r, g, b] of next) {
      out[index * 4] = Math.round(r);
      out[index * 4 + 1] = Math.round(g);
      out[index * 4 + 2] = Math.round(b);
      solid[index] = 1;
    }
  }
  // альфу возвращаем как была: `solid` — только отметка «цвет уже есть»
  for (let at = 0; at < out.length; at += 4) out[at + 3] = rgba[at + 3];
  return { ...picture, rgba: out };
}

/** Показ листов вещи с вырезом: функция «лист → лист для кадра и GLB»; `null` — вещь без выреза, листы как есть. */
export function cutoutBacking({ drawable }) {
  if (!hasCutoutMesh(drawable)) return null;
  const made = new Map();
  return (picture) => {
    if (!picture) return picture;
    if (!made.has(picture)) made.set(picture, bleedCutout(picture));
    return made.get(picture);
  };
}
