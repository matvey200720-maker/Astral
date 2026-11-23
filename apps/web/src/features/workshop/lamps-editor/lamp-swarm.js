/*
 * Рой частиц у настоящего столба кадра «У лампы» (ТЗ 22.10.2026, п. 3): те же частицы, что в нарисованном
 * крупном плане (`lamp-scene.js`), но в кадре улицы из игры — у той самой лампы, которую видно, а не у нарисованной
 * рядом.
 *
 * Рой — клон правила ядра игрока по работе (`lamp-swarm-model.js`), проигранный движком RMPTFX окна. Спрайты
 * рисует шейдер `ptfx_sprite` прямо в сцене квартала (`block-scene.js`): они идут в ту же HDR-цель, что дома и
 * столбы, прячутся за ними по глубине, а экспозицию, свечение и туман кадра берут у кадра, а не у сцены частиц.
 * Частицы считаются в осях игры (Z вверх) относительно якоря секции, шейдер переводит точку в ось сцены Y вверх.
 *
 * Свет частиц — свет самого кадра: солнце (ночью луна) и небо таймцикла на выбранный час (`blockLighting`), а
 * лампа светит на них тем огнём, что и на землю под собой (`lampLight`: сила в канделах, радиус и спад three).
 * Лампа в кадре не одна на весь рой — ближайшая к `LIVE_POLE`, у столба, к которому подлетает «У лампы».
 *
 * Рой живёт, пока кадр рисуется: хук кадра (`scene.setFrameHook`) двигает частицы на шаг кадра. Окно в фоне —
 * кадр стоит, и рой стоит вместе с ним.
 */

import * as THREE from "three";
import { spriteBatches } from "@modovik/ptfx-runtime";
import { SpriteBatch, createSharedUniforms, writeParticleLighting } from "../../../components/desktop/workshop/ptfx/ptfx-renderer.js";
import { sceneLighting } from "../../../components/desktop/workshop/ptfx/ptfx-lighting.js";
import { writeLocalLights } from "../../../components/desktop/workshop/ptfx/ptfx-lights.js";
import { blockLighting, fromSceneAxes } from "../timecycle-block/block-light.js";
import { lampLight } from "./lamp-street.js";
import { LIVE_POLE, STREET_VIEWS } from "./lamp-street-views.js";
import { createLampSheets } from "./lamp-sheets.js";
import { buildSwarmModel, particlesKey, recipeOf, seedOf, swarmInstance, swarmLod, warmSwarm } from "./lamp-swarm-model.js";

/* Шаг роя не больше этого, как в нарисованном кадре: вкладка проснулась — частицы не прыгают. */
const MAX_STEP = 0.05;
/* Ползунок частиц шлёт правку на каждый шаг: рой собирается заново не чаще этого. */
const REBUILD_MS = 140;
/* Роль пачек в очереди прозрачных: после всего, что кадр рисует сам. */
const RENDER_ORDER = 1000;
/* Столб кадра ищется в круге такого радиуса вокруг `LIVE_POLE.at`, метры. */
const POLE_REACH = 6;

/** Точка сцены (Y вверх) → оси игры (Z вверх): `[x, −z, y]`. */
export const toGame = (point) => [point.x ?? point[0], -(point.z ?? point[2]), point.y ?? point[1]];

/**
 * Лампа, у которой кружит рой: ближайшая к `at` (метры от якоря в осях игры) среди ламп столбов — лампы моста
 * в счёт не идут. `heads` — `lampHeads` (позиции в осях сцены). Дальше `within` метров ламп нет — `null`.
 */
export function swarmHead(heads, at = LIVE_POLE.at, within = POLE_REACH) {
  let best = null;
  let nearest = within;
  for (const head of heads || []) {
    if (head.kind === "bridge") continue;
    /* Сцена (x, y, z) — игра (x, −z). */
    const distance = Math.hypot(head.position.x - at[0], -head.position.z - at[1]);
    if (distance < nearest) {
      nearest = distance;
      best = head;
    }
  }
  return best;
}

/* Лампа та же, пока не сдвинулась: список ламп кадра пересобирается раз в секунду, а рой от этого не перезапускается. */
const sameSpot = (a, b) => Boolean(a) && a.distanceToSquared(b) < 1e-4;

/** Камера сцены в осях игры для сборки спрайтов: глаз, вправо и вверх от неё. */
export function gameCamera(camera) {
  camera.updateMatrixWorld(true);
  const e = camera.matrixWorld.elements;
  return {
    position: toGame(camera.position),
    right: toGame([e[0], e[1], e[2]]),
    up: toGame([e[4], e[5], e[6]]),
  };
}

/**
 * Свет частиц из света кадра улицы: `state` — небо на час (`resolveSkyState`). Те же числа, что освещают дома:
 * солнце (ночью луна) цветом и силой кадра, небо и земля — окружением. `emissive` — свечение частиц таймцикла
 * на этот час (`particle_emissive_intensity_mult`). Оси — игры: шейдер частиц считает нормали в них.
 */
export function swarmLighting(state, emissive = 1) {
  const light = blockLighting(state);
  const toLight = fromSceneAxes(light.sun.direction);
  const { sky, ground } = light.hemisphere;
  return {
    /* Частица берёт `−направление` как «к свету». */
    sun: { direction: [-toLight.x, -toLight.y, -toLight.z], colour: light.sun.radiance },
    ambient: {
      gradient: [sky[0] - ground[0], sky[1] - ground[1], sky[2] - ground[2], 1],
      base: [ground[0], ground[1], ground[2], 0.5],
      directional: [0, 0, 0],
      directionalAxis: [0, 0, 1],
    },
    particleExposure: 1,
    particleEmissive: emissive,
  };
}

/**
 * Огонь лампы для частиц: тот же свет, что у лампы в кадре (`lampLight`), в осях игры. Три делит яркость на π
 * в диффузной модели, частица — нет, поэтому цвет с силой делится здесь.
 */
export function swarmLamp(head, values, night) {
  if (!(night > 0.001) || !(values?.intensity > 0)) return null;
  const light = lampLight(head, values, night);
  return {
    position: toGame(light.position),
    range: light.distance,
    colour: light.colour.map((value) => (value * light.intensity) / Math.PI),
    decay: light.decay,
  };
}

/**
 * Рой в кадре улицы. `scene` — кадр квартала (`createBlockScene`), `heads()` — лампы на местах (`lampHeads`),
 * `style()` — функция «лампа игры → её числа по работе».
 */
export function createLampSwarm({ scene, heads, style, hour = 23, onFailure = null }) {
  const sheets = createLampSheets({ onReady: () => scene.invalidate() });
  const shared = createSharedUniforms();
  const group = new THREE.Group();
  group.name = "lamp-swarm";
  const meshes = new Map();

  let base = null;
  let project = null;
  let picture = null;
  let model = null;
  let effectName = "";
  let recipeKey = "";
  let placedKey = "";
  let instance = null;
  let placedAt = null;
  let generation = 0;
  let rebuildTimer = 0;
  let lighted = null;
  let emissive = null;
  let pick = { list: null, head: null };
  let failures = [];
  let disposed = false;

  const ground = STREET_VIEWS.close.ground;

  function fail(error) {
    failures.push(String(error?.message || error));
    onFailure?.(failures);
  }

  function rebuild() {
    rebuildTimer = 0;
    if (disposed) return;
    failures = [];
    placedKey = particlesKey(project, picture);
    const exported = base?.model;
    const key = exported ? recipeOf(project) : "";
    if (!key) {
      model = null;
      recipeKey = "";
    } else if (key !== recipeKey || !model) {
      try {
        const built = buildSwarmModel(exported, project);
        model = built.model;
        effectName = built.effectName;
        recipeKey = built.key;
      } catch (error) {
        fail(error);
        model = null;
        recipeKey = "";
      }
    }
    /* Новая модель — новый рой; зерно прежнее до выброса, правка цвета и размера рой не перетасовывает. */
    instance = null;
    scene.invalidate();
  }

  function scheduleRebuild() {
    if (rebuildTimer || disposed) return;
    rebuildTimer = window.setTimeout(rebuild, REBUILD_MS);
  }

  function place(point, camera) {
    const origin = toGame(point);
    placedAt = point.clone();
    instance = warmSwarm(
      swarmInstance({
        model,
        effectName,
        origin,
        seed: seedOf("lamp", generation),
        lod: swarmLod(model, effectName, camera.position.distanceTo(point)),
        ground,
      }),
    );
  }

  /* Пачки спрайтов — в сцену квартала, лишние уходят. */
  function show(batches) {
    const used = new Set();
    batches.forEach((batch, index) => {
      if (!batch?.count) return;
      let sprite = meshes.get(batch.key);
      if (!sprite) {
        sprite = { batch: new SpriteBatch(batch.key, { sceneUp: "y" }), mesh: null };
        meshes.set(batch.key, sprite);
      }
      const mesh = sprite.batch.update(batch, shared);
      mesh.renderOrder = RENDER_ORDER + index;
      if (mesh.parent !== group) group.add(mesh);
      sprite.mesh = mesh;
      used.add(batch.key);
    });
    for (const [key, sprite] of meshes) {
      if (used.has(key)) continue;
      if (sprite.mesh) group.remove(sprite.mesh);
      sprite.batch.dispose();
      meshes.delete(key);
    }
  }

  function frame(camera, state, step) {
    if (disposed || !model || !state) {
      show([]);
      return;
    }
    const list = heads();
    if (pick.list !== list) pick = { list, head: swarmHead(list) };
    const head = pick.head;
    if (!head) {
      show([]);
      return;
    }
    if (!instance || !sameSpot(placedAt, head.position)) place(head.position, camera);

    /* Свет кадра и лампа: солнце и небо часа, огонь лампы — тот же, что у земли под ней. */
    if (emissive === null) emissive = sceneLighting({ hour }).particleEmissive;
    if (lighted !== state) {
      writeParticleLighting(shared, swarmLighting(state, emissive));
      lighted = state;
    }
    const night = blockLighting(state).night;
    const lamp = swarmLamp(head, style()(head.light, head), night);
    writeLocalLights(shared, lamp ? [lamp] : []);

    instance.evolutions.LOD = swarmLod(model, effectName, camera.position.distanceTo(head.position));
    instance.step(Math.min(step, MAX_STEP));
    if (instance.finished) {
      generation += 1;
      place(head.position, camera);
    }
    show(spriteBatches(instance, gameCamera(camera), sheets.lookup, "swarm"));
  }

  scene.addObject(group);
  scene.setFrameHook(frame);

  return {
    /** База частиц из игры игрока: `{ model, sheets }` или `null`. */
    setBase(next) {
      if ((next || null) === base) return;
      base = next || null;
      sheets.setBase(base);
      model = null;
      recipeKey = "";
      rebuild();
    },
    /** Своя картинка частиц: `{ key, canvas }` (лист 128×128) или `null`. */
    setPicture(next) {
      const wanted = next?.canvas ? next : null;
      if (wanted === picture) return;
      picture = wanted;
      sheets.setPicture(picture);
      if (particlesKey(project, picture) !== placedKey) scheduleRebuild();
      scene.invalidate();
    },
    /** Работа: рой собирается заново, когда изменился его заказ. */
    setProject(next) {
      project = next || null;
      if (particlesKey(project, picture) !== placedKey) scheduleRebuild();
    },
    /** Час суток: от него свечение частиц таймцикла. */
    setHour(next) {
      if (next === hour) return;
      hour = next;
      emissive = null;
      lighted = null;
    },
    get failures() {
      return failures;
    },
    dispose() {
      disposed = true;
      if (rebuildTimer) window.clearTimeout(rebuildTimer);
      scene.setFrameHook(null);
      scene.removeObject(group);
      show([]);
      sheets.dispose();
    },
  };
}
