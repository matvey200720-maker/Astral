/*
 * Мир 3D-предпросмотров эффектов (задача 4А, 18.10.2026): свет игры, земля,
 * стрелок и жертва — всё, что стоит в кадре непрозрачным под частицами.
 *
 * Свет — те же числа таймцикла, что у частиц (`sceneLighting`): солнце
 * `light_dir_col × light_dir_mult` и естественное окружение — градиент по
 * вертикали нормали, снизу `light_natural_amb_down`, сверху
 * `light_natural_amb_up`. В three.js это направленный свет с тенью и
 * полусферный, в тех же единицах: у three диффузный Ламберт уже поделён на π,
 * и игра нормирует так же — это сверено по кадрам игры: белая майка на
 * прямом солнце даёт ~0,85 после кривой Хейбла, а с множителем π она
 * выгорала бы в чистый белый с ореолом. Экспозиция кадра (HDR → кривая) одна
 * на всё.
 *
 * Земля — невидимая плоскость, что принимает тень и пишет глубину: сетка и
 * матовый фон нарисованы шейдером сцены под ней (`matte-floor.js`).
 */

import * as THREE from "three";

/* Тень ложится на землю затемнением до этой доли света (в игре — окружение). */
const SHADOW_STRENGTH = 0.55;
const FLOOR_RADIUS = 140;
const SHADOW_MAP = 2048;

export function createCombatWorld() {
  const scene = new THREE.Scene();

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(sun.target);

  /* HemisphereLight берёт «верх» из своей позиции: у нас верх — +Z. */
  const sky = new THREE.HemisphereLight(0xffffff, 0x808080, 1);
  sky.position.set(0, 0, 1);
  scene.add(sky);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(FLOOR_RADIUS, 48),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: SHADOW_STRENGTH, transparent: true }),
  );
  floor.receiveShadow = true;
  floor.renderOrder = -1;
  scene.add(floor);

  let sunDirection = new THREE.Vector3(0.3, 0.5, -0.8).normalize();
  let shadowCentre = new THREE.Vector3(0, -3, 1);
  let shadowReach = 6;
  const actors = new Set();

  function placeSun() {
    sun.target.position.copy(shadowCentre);
    sun.target.updateMatrixWorld(true);
    /* Свет приходит против `direction`: позиция — с той стороны, откуда светит. */
    sun.position.copy(shadowCentre).addScaledVector(sunDirection, -60);
    const half = shadowReach;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    sun.shadow.camera.updateProjectionMatrix();
    sun.updateMatrixWorld(true);
  }
  placeSun();

  return {
    scene,
    floor,
    sun,
    sky,
    /** Свет кадра — результат `sceneLighting`. */
    setLighting(lighting) {
      const { sun: sunLight, ambient } = lighting;
      sunDirection = new THREE.Vector3(...sunLight.direction).normalize();
      /* Солнца нет (ночь, под горизонтом) — свет луны в этом числе, но тень от неё слабая и не нужна. */
      const above = -sunDirection.z > 0.02;
      sun.color.setRGB(...sunLight.colour, THREE.LinearSRGBColorSpace);
      sun.intensity = 1;
      sun.visible = true;
      sun.castShadow = above;
      const down = ambient.base;
      const up = [ambient.base[0] + ambient.gradient[0], ambient.base[1] + ambient.gradient[1], ambient.base[2] + ambient.gradient[2]];
      sky.color.setRGB(...up, THREE.LinearSRGBColorSpace);
      sky.groundColor.setRGB(down[0], down[1], down[2], THREE.LinearSRGBColorSpace);
      sky.intensity = 1;
      placeSun();
    },
    /** Область, на которую падает тень: центр и половина стороны, м. */
    setShadowBox(centre, reach) {
      shadowCentre = new THREE.Vector3(...centre);
      shadowReach = reach;
      placeSun();
    },
    setFloorVisible(on) {
      floor.visible = Boolean(on);
    },
    add(actor) {
      actors.add(actor);
      scene.add(actor.placement);
    },
    remove(actor) {
      actors.delete(actor);
      actor.placement.removeFromParent();
    },
    dispose() {
      for (const actor of [...actors]) actor.dispose?.();
      actors.clear();
      floor.geometry.dispose();
      floor.material.dispose();
      sun.shadow.map?.dispose();
    },
  };
}
