/*
 * Цвет ствола по шейдеру материала (06.11.2026, 68 карточек «3D ≠ обложка»): лист отражения и сила свечения — то, что обложка берёт из шейдера, а GLB брал не так.
 *
 * Лист отражения (Medya New GP — 33 карточки, goodnessGUNPAKC — 6).
 *
 * У шейдеров `reflect` и `*_reflect` диффуз — ровный чёрный лист, а цвет автор кладёт в `EnvironmentSampler` (у Medya `32145321`, ткань на 2716×1812): игра прибавляет лист к цвету по направлению
 * отражения, умножив на `reflectivePower`. Кадр обложки делает это по взгляду (`reflectLayerShader`, `workshop/gun/lighting.js`); у GLB отражения нет, там цвет детали — одна краска. Правило общее:
 * материал с чёрным диффузом и названным листом отражения красится цветом этого листа. Цвет листа — среднее по его пикселям с весом светлоты (ткань: свет несёт цвет, тень почти чёрная), в линейном
 * свете, умноженное на силу отражения × усиление кадра (не выше единицы: сила выше выжгла бы лист в белое, и цвета автора не осталось бы).
 */
import { ENVIRONMENT_SAMPLER } from "@modovik/rage-drawable";
import { isBlackSheet } from "./crude-model.js";

/** Усиление слоя отражения: подобрано на глаз под кадр (у игры своя экспозиция, при голых 0,45 лист гаснет до чёрного). */
export const REFLECT_GAIN = 2.6;

/**
 * Сила свечения шейдеров `emissive*` в кадре и в GLB: 0,4 цвета диффуза. Кадр обложки (`gunpack-scene.js`) светит так: «сильнее — и цветной ствол выгорает в пастель, а кадр должен показывать цвет
 * автора, а не пересвет»; GLB писал свечение на 1,0, и в «3D» неоновая зелёная линия выходила бледно-лаймовой, красная — оранжевой.
 */
export const EMISSIVE_STRENGTH = 0.4;

/* Имена-заглушки вместо текстуры (те же, что отсеивает `rage-drawable/glb.js`): слоя за ними нет, и терять нечего. */
const NO_TEXTURE_NAME = /^(none|givemechecker|checker|null)$/i;

/* Лист отражения идёт в кадр и в GLB только под чёрным диффузом: у цветного цвет автора и так есть, а отражения вроде `reflectivePower` 40 у Sakura (`spec_reflect`) без формулы игры выжгли бы его в белое. */

/** Имя листа отражения материала (`EnvironmentSampler`) или пустая строка. */
export function environmentName(material) {
  const name = (material?.samplers || []).find((item) => item.sampler >>> 0 === ENVIRONMENT_SAMPLER && item.texture)?.texture;
  return name && !NO_TEXTURE_NAME.test(name) ? name : "";
}

/** Сила слоя в кадре: `reflectivePower` по величине (у goodnessGUNPAKC −0,7), не выше единицы, не записана — единица; затем усиление. */
export function reflectStrength(power) {
  const own = Number.isFinite(power) ? Math.min(1, Math.abs(power)) : 1;
  return own * REFLECT_GAIN;
}

const toLinear = (value) => {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

/**
 * Цвет листа отражения: линейный [r, g, b] 0–1 — среднее по пикселям с весом светлоты, умноженное на `strength` (не выше единицы), или `null`, если лист чёрный или не читается.
 * Выборка — около 4096 точек, как у `isBlackSheet`.
 */
export function reflectSheetColour(image, strength = 1) {
  if (!image?.rgba || !(image.width > 0 && image.height > 0)) return null;
  const step = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 4096)));
  const sum = [0, 0, 0];
  let weight = 0;
  for (let y = 0; y < image.height; y += step)
    for (let x = 0; x < image.width; x += step) {
      const at = (y * image.width + x) * 4;
      if (image.rgba[at + 3] < 128) continue;
      const linear = [toLinear(image.rgba[at]), toLinear(image.rgba[at + 1]), toLinear(image.rgba[at + 2])];
      const light = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      for (let channel = 0; channel < 3; channel += 1) sum[channel] += linear[channel] * light;
      weight += light;
    }
  if (!(weight > 0)) return null;
  const scale = Math.min(1, Math.max(0, strength));
  return sum.map((value) => Math.min(1, (value / weight) * scale));
}

/**
 * Модель со цветом из листа отражения: меши с чёрным диффузом и названным листом отражения получают материал `{ …материал, colour: [r, g, b, 1], reflectSheet }` (цвет — для `baseColorFactor` GLB,
 * `reflectSheet` — имя листа). `texture(name)` — картинка по имени (то же, что `weaponModel(...).texture`). Остальные меши и материалы — как были, тот же объект.
 */
export function withReflectColours(drawable, texture) {
  const painted = new Map();
  const meshes = (drawable?.meshes || []).map((mesh) => {
    const material = mesh?.material;
    if (!material || mesh.invertedHull) return mesh;
    if (painted.has(material)) return painted.get(material) ? { ...mesh, material: painted.get(material) } : mesh;
    const sheet = environmentName(material);
    const diffuse = material.textures?.diffuse;
    let result = null;
    if (sheet && diffuse && isBlackSheet(texture(diffuse))) {
      const colour = reflectSheetColour(texture(sheet), reflectStrength(material.reflectivePower));
      if (colour) result = { ...material, colour: [...colour, 1], reflectSheet: sheet };
    }
    painted.set(material, result);
    return result ? { ...mesh, material: result } : mesh;
  });
  return { ...drawable, meshes };
}
