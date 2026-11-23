/*
 * Рой у лампы без рисования: клон правила ядра игрока по работе, экземпляр
 * эффекта в точке лампы и его дальность. Один код на оба кадра — нарисованный
 * фонарь (`lamp-scene.js`) и улицу из игры (`lamp-swarm.js`): рой везде собран
 * тем же заказом, что уедет в игру (`compileLampParticles` → `buildEffectClone`).
 */

import { EffectInstance, buildEffectClone, effectFrame, loadModel } from "@modovik/ptfx-runtime";
import { compileLampParticles } from "@modovik/street-light-contract/lamps";

/* Сколько секунд прогнать рой перед показом: лампа не должна стоять пустой, пока первая бабочка долетит. */
export const WARMUP_SECONDS = 6;
/* Тихий ветер, м/с: лепестки и снег ложатся на землю, а не уходят под неё, листья сносит, как на улице игры. */
export const PREVIEW_WIND = Object.freeze([0.8, 0.3, 0]);

/** Что решает рой: заказ клона и своя картинка. Доля фонарей с роем в кадре одной лампы не видна. */
export function particlesKey(project, picture = null) {
  const particles = project ? compileLampParticles(project) : null;
  return particles ? `${JSON.stringify(particles.clone)}|${picture?.key || ""}` : "";
}

/** Заказ клона работы строкой: «» — частиц в работе нет. Пока он тот же, модель не пересобирается. */
export function recipeOf(project) {
  const particles = project ? compileLampParticles(project) : null;
  return particles ? JSON.stringify(particles.clone) : "";
}

/**
 * Модель эффекта по работе: `{ model, effectName, key }` или `null`, если частиц в работе нет или
 * ядра игры нет. Ошибка сборки клона летит наверх — кадр называет её в подписи.
 */
export function buildSwarmModel(exported, project) {
  const particles = project ? compileLampParticles(project) : null;
  if (!particles || !exported) return null;
  const clone = buildEffectClone({ core: exported }, particles.clone, {
    coreTextures: [...(exported.textures || []), ...particles.textures.map((item) => item.texture)],
  });
  return { model: loadModel(exported, clone), effectName: particles.clone.effect, key: recipeOf(project) };
}

/** Зерно экземпляра: одно на пересборку, новый выброс — только у закончившегося. */
export function seedOf(id, generation) {
  let hash = 0x811c9dc5 ^ generation;
  for (const char of id) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Дальность роя (эволюция LOD правила) — от камеры до лампы, как в игре: у доноров вдали меньше и реже
 * частицы, а светлячки гаснут совсем. `distance` — метры.
 */
export function swarmLod(model, effectName, distance) {
  const { min, max } = model?.effects?.get(effectName)?.lod || {};
  if (!(max > min)) return 0;
  return Math.min(Math.max((distance - min) / (max - min), 0), 1);
}

/**
 * Экземпляр роя в точке `origin` (оси игры, Z вверх): окружающий эффект пропа в игре зарегистрирован и
 * зациклен. `ground` — высота земли, `lod` — `swarmLod`.
 */
export function swarmInstance({ model, effectName, origin, seed, lod = 0, ground = 0 }) {
  return new EffectInstance(model, effectName, {
    frame: effectFrame({ origin, z: [0, 0, 1], up: [0, 1, 0] }),
    seed,
    evolutions: { LOD: lod },
    ground,
    wind: PREVIEW_WIND,
    loop: true,
  });
}

/** Прогрев: лампа не стоит пустой, пока первая бабочка долетит. */
export function warmSwarm(instance) {
  for (let time = 0; time < WARMUP_SECONDS; time += 1 / 30) instance.step(1 / 30);
  return instance;
}
