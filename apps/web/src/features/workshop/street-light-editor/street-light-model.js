/*
 * Настоящая модель фонаря из установленной GTA V.
 *
 * Превью пересобирает сцену на каждое движение ползунка — цвет, яркость,
 * радиус. Разбирать GLB заново на каждую пересборку нельзя, поэтому здесь
 * модель читается и парсится ОДИН раз на идентификатор, а сцена получает
 * клон. Клонирование делит геометрию и текстуры между копиями, так что
 * несколько фонарей в кадре стоят почти столько же, сколько один.
 */

import { hasDesktopBridge, loadMegaMallBuildingModel } from "../../../api.js";

export { lampAnchors } from "./street-light-lamps.js";

/** Разобранные модели: идентификатор -> промис с THREE.Group. */
const parsed = new Map();

/**
 * Прочитать модель фонаря и координаты его ламп.
 *
 * Возвращает { model, lamps } или null. null здесь — нормальный ответ, а не
 * ошибка: без приложения, без игры или без нативного хоста превью обязано
 * работать на схематичном фонаре.
 *
 * `lamps` приходят из LightAttributes самого фрагмента, то есть это авторские
 * позиции источников, а не оценка по геометрии.
 */
export async function loadStreetLightModel(THREE, GLTFLoader, lightId) {
  if (!lightId || !hasDesktopBridge()) return null;
  if (parsed.has(lightId)) return parsed.get(lightId);

  const promise = (async () => {
    const result = await loadMegaMallBuildingModel({ buildingId: lightId });
    if (result?.status !== "ready" || !result.glb) return null;
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(result.glb, "", resolve, reject);
    });
    const model = gltf.scene;
    /* Ставим фонарь основанием в ноль и по центру: у пропов игры начало
       координат где угодно, и без переноса столб уходил бы под землю. */
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(center.x, bounds.min.y, center.z);
    model.position.sub(offset);
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    /* Лампы сдвигаем ровно так же, как модель, иначе свет повиснет отдельно
       от фонаря. */
    const lamps = (result.lights || [])
      .filter((light) => light?.position)
      .map((light) => ({
        position: new THREE.Vector3(
          light.position.x,
          light.position.y,
          light.position.z,
        ).sub(offset),
        direction: new THREE.Vector3(
          light.direction?.x || 0,
          light.direction?.y || -1,
          light.direction?.z || 0,
        ),
        coneOuterAngle: light.coneOuterAngle || 0,
      }));
    return { model, lamps };
  })().catch(() => null);

  parsed.set(lightId, promise);
  return promise;
}

/** Сбросить кэш — нужен тестам и переключению установки игры. */
export function resetStreetLightModelCache() {
  parsed.clear();
}
