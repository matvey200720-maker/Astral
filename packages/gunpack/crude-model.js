/*
 * Грубая модель ствола не ствол (круг 7, 31.10.2026, слово ведущей: «такую обложку выкладывать нельзя, это хуже пустой»).
 *
 * У заявки «Ганпак · matik74 · 22.02 17:10» модели автора по 5–6 КБ: у `w_mg_combatmgmk2` два меша по 28 треугольников, у `w_sr_heavysnipermk2` 100 в сумме, ступень
 * одна (`high`, у остальных уровней модели нет). Кадр верный по файлам, но это гранёный ком, а не ствол: «всё один к одному» тут значит не ставить кадр.
 *
 * Порог выбран по живому каталогу: 8676 моделей ствола в 2345 пакетах, самая маленькая — 12,7 КБ, у 136 самых малых (пистолеты, молотов, граната) 561…3191 треугольник;
 * у грубых заявок 56…100; у намеренно блочного «minecradt gp» (стиль Minecraft) 480 — это ствол, он проходит. Порог 300 держит запас с обеих сторон.
 */

export const MIN_WEAPON_TRIANGLES = 300;

/** Начало сообщения об отказе: по нему вызывающие отличают «грубая модель» от сбоя рисования. */
export const CRUDE_MODEL_PREFIX = "Ствол слишком грубый";

/** Треугольников в мешах разбора (`parseWeaponModel`: `meshes[].indices`). */
export function meshTriangles(meshes) {
  let total = 0;
  for (const mesh of meshes || []) total += Math.floor((mesh?.indices?.length || 0) / 3);
  return total;
}

/** Причина отказа или пустая строка, если модель годится. */
export function crudeModelReason(triangles) {
  const count = Number(triangles) || 0;
  if (count >= MIN_WEAPON_TRIANGLES) return "";
  return `${CRUDE_MODEL_PREFIX}: ${count} граней при минимуме ${MIN_WEAPON_TRIANGLES} (у настоящего ствола их тысячи), кадр не снят.`;
}

/** Ошибка съёмщика — отказ по грубой модели? */
export const isCrudeModelError = (error) => String(error?.message || error || "").startsWith(CRUDE_MODEL_PREFIX);

/*
 * Ствол без цвета (02.11.2026, кусок r7c-6, 8 паков «Medya New GP» с одной и той же серой обложкой): кадр без цвета автора хуже пустого, он выглядит как настоящий.
 * Меш теряет цвет, когда кадру нечем его покрасить: диффуза нет (в сцене серая заглушка) либо диффуз — ровный чёрный лист, а цвет шейдер берёт из текстуры отражения, которой
 * в файлах нет. Если на таких мешах больше половины граней, кадр не снимается; мелкая деталь без текстуры (стекло, мушка) ствол не отменяет.
 */
export const COLOURLESS_PREFIX = "Цвет ствола потерян";
const COLOURLESS_SHARE = 0.5;
const BLACK_LEVEL = 8;

/** Лист чёрный целиком (по выборке, шаг как у `albedoLuminance`): такой диффуз цвета не несёт. */
export function isBlackSheet(image) {
  if (!image?.rgba) return false;
  const step = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 4096)));
  for (let y = 0; y < image.height; y += step)
    for (let x = 0; x < image.width; x += step) {
      const at = (y * image.width + x) * 4;
      if (image.rgba[at] > BLACK_LEVEL || image.rgba[at + 1] > BLACK_LEVEL || image.rgba[at + 2] > BLACK_LEVEL) return false;
    }
  return true;
}

/** Причина отказа по разбору `parseWeaponModel` или пустая строка. Меш без описания материала не судится; контур-оболочка цвета не несёт. */
export function colourlessReason(parsed) {
  let total = 0;
  let lost = 0;
  for (const mesh of parsed?.meshes || []) {
    const material = mesh?.material;
    if (!material?.textures || mesh.invertedHull) continue;
    const triangles = Math.floor((mesh.indices?.length || 0) / 3);
    total += triangles;
    const { diffuse, environment } = material.textures;
    if (environment) continue;
    if (!diffuse || material.environmentLost) lost += triangles;
  }
  if (!total || lost / total <= COLOURLESS_SHARE) return "";
  return `${COLOURLESS_PREFIX}: на ${lost} из ${total} граней нет цвета автора (текстуры нет в файлах пака), кадр не снят.`;
}

/** Ошибка съёмщика — отказ по потерянному цвету? */
export const isColourlessError = (error) => String(error?.message || error || "").startsWith(COLOURLESS_PREFIX);
