/*
 * Программы тени — в прогрев, а не в первую отрисовку (16.11.2026, «Astral быстрее», А1 разбора входа в редактор).
 *
 * Прогрев (`shader-warmup.js`) отдаёт параллельному компилятору программы МАТЕРИАЛОВ сцены. Тень three рисует другим материалом: у `WebGLShadowMap` один общий `MeshDepthMaterial`
 * (`depthPacking: RGBADepthPacking`), который на каждый объект-тень меняет сторону (`shadowSide[material.side]`) и берёт программу у `renderBufferDirect` в первой же отрисовке
 * с тенью — `renderer.compile` до него не доходит. Стенд без видеокарты (`stage-harness.js`, «Завод»-подобная сцена): прогрев собирает все 7 программ материалов, первая отрисовка — ещё одну,
 * программу глубины. В настоящем Electron (профиль V8 входа, замер 16.11.2026) под `Fy.render` (проход тени) первый `getProgramParameter` стоит 10–28 мс на заводе, ангаре и мегамолле.
 *
 * Ключ программы глубины зависит от двух вещей: что у объекта (`InstancedMesh`, цвет копий, морфы — `WebGLPrograms.getParameters`) и от стороны общего материала В МОМЕНТ ПЕРВОГО использования: `side` не входит
 * в проверку «пересобрать программу» (`setProgram`), так что у первого объекта этого вида сторона застывает в программе, а остальные берут ту же. Поэтому образцы собираются так же:
 * первый по обходу сцены объект-тень каждого вида даёт сторону образца (обход — как `renderObject` у `WebGLShadowMap`: в глубину, по порядку детей, только видимые). Остальное в ключе —
 * цель отрисовки: проход тени идёт в цель (`toneMapping` без тона, `outputColorSpace` линейный), поэтому образцы собираются при подставленной цели.
 *
 * Чистый модуль: сам ничего не рисует и не пишет в GL. Звать из `orbit-stage.js: compileObjects` (то же окно ожидания, что у материалов).
 */

import * as THREE from "three";
import { compileScene } from "./shader-warmup.js";

const SHADOW_SIDE = Object.freeze({ [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide });

/** Что объект кладёт в ключ программы глубины (`WebGLPrograms.getParameters`): копии, цвет копий, морфы, скелет, пачка. */
export function depthShape(object) {
  const morphs = object.geometry?.morphAttributes || {};
  return [
    object.isInstancedMesh ? (object.instanceColor ? 2 : 1) : 0,
    object.isInstancedMesh && object.morphTexture ? 1 : 0,
    object.isSkinnedMesh ? 1 : 0,
    object.isBatchedMesh ? 1 : 0,
    morphs.position ? morphs.position.length : 0,
    morphs.normal ? morphs.normal.length : 0,
    morphs.color ? morphs.color.length : 0,
  ].join(",");
}

/** Что образцы повторить умеют: сетка и копии (с цветом или без); скелет, пачки и морфы кадр соберёт сам, как прежде. */
const copiable = (object) => !object.isSkinnedMesh && !object.isBatchedMesh && !(object.isInstancedMesh && object.morphTexture) && depthShape(object).split(",").slice(4).every((count) => count === "0");

const materialsOf = (object) => (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean);

/**
 * Образцы теней: по одному объекту на вид (`depthShape`), как их увидит проход тени. Обход — в глубину, по порядку детей, невидимое не заходит; слой камеры — как у прохода.
 * Сторона — у первого материала объекта с учётом `shadowSide` (у `three` она выбирает программу один раз, для первого). Возвращает `[{ key, object, side }]`.
 */
export function depthRepresentatives(root, camera = null) {
  const found = new Map();
  const visit = (object) => {
    if (object.visible === false) return;
    const seen = !camera || !object.layers || object.layers.test(camera.layers);
    if (seen && (object.isMesh || object.isLine || object.isPoints) && object.castShadow && copiable(object)) {
      const list = materialsOf(object).filter((material) => material.visible !== false);
      const first = list[0];
      if (first) {
        const shape = depthShape(object);
        if (!found.has(shape)) {
          const side = first.shadowSide ?? SHADOW_SIDE[first.side] ?? THREE.FrontSide;
          found.set(shape, { key: `${shape}|${side}`, object, side });
        }
      }
    }
    for (const child of object.children || []) visit(child);
  };
  visit(root);
  return [...found.values()];
}

/**
 * Образцы-материалы для `renderer.compile`: сетки на геометрии настоящего объекта (копии — `InstancedMesh` на одну копию, с цветом, если у настоящего он есть),
 * материал глубины такой же, как у `three`, со стороной первого настоящего. Возвращает `{ scene, materials, dispose }`; `scene` — то, что умеет `compileScene` (`traverse`, `traverseVisible`).
 */
export function createDepthProbes(representatives) {
  const probes = [];
  const materials = [];
  for (const { object, side } of representatives) {
    const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    material.side = side;
    material.alphaTest = 0;
    let probe;
    if (object.isInstancedMesh) {
      probe = new THREE.InstancedMesh(object.geometry, material, 1);
      if (object.instanceColor) probe.setColorAt(0, new THREE.Color(1, 1, 1));
    } else {
      probe = new THREE.Mesh(object.geometry, material);
    }
    probe.frustumCulled = false;
    probes.push(probe);
    materials.push(material);
  }
  return {
    probes,
    materials,
    scene: { traverse: (visit) => probes.forEach(visit), traverseVisible: (visit) => probes.forEach(visit) },
    dispose() {
      for (const material of materials) material.dispose();
      materials.length = 0;
      probes.length = 0;
    },
  };
}

/** Какие виды ещё не заказаны: книга `ordered` хранит ключи (`depthRepresentatives`) при нынешнем окружении. */
export function freshDepth(representatives, ordered) {
  return representatives.filter((item) => !ordered.has(item.key));
}

/**
 * Заказ программ глубины для кадра. `enabled()` — нужна ли тень (тени включены и солнце их бросает); `context()` — всё, что three кладёт в ключ рядом с материалом (огни, тени, окружение, тон):
 * сменилось — прежний заказ устарел, образцы заменяются (программы старого окружения three отпустит сам). `order(alive)` собирает образцы на подставленной цели отрисовки (проход тени идёт в цель, и ключ
 * у него «без тона, линейный выход» — на экране этих программ не будет) и отдаёт их `renderer.compile`; возвращает обещание готовности (то же ожидание, что у материалов) или `null`, если заказывать нечего.
 * Образцы живут, пока их держит кадр: освобождённый материал отпускает программу (`dispose()` — вместе с кадром).
 */
export function createDepthWarmup({ renderer, scene, camera, enabled = () => true, context = () => "" }) {
  const ordered = new Set();
  const held = [];
  let stamp = null;
  let target = null;
  let closed = false;
  const release = () => {
    for (const set of held.splice(0)) set.dispose();
    ordered.clear();
  };
  return {
    order(alive = () => true) {
      if (closed || typeof renderer?.compile !== "function" || !enabled()) return null;
      const now = String(context());
      if (now !== stamp) {
        stamp = now;
        release();
      }
      const fresh = freshDepth(depthRepresentatives(scene, camera), ordered);
      if (!fresh.length) return null;
      const probes = createDepthProbes(fresh);
      let waiting = null;
      let previous = null;
      try {
        previous = renderer.getRenderTarget();
        target ||= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
        renderer.setRenderTarget(target);
        waiting = compileScene(renderer, probes.scene, camera, alive, scene);
      } catch {
        /* Заказ не вышел: кадр соберёт программу тени сам, как прежде. */
        probes.dispose();
        waiting = null;
      } finally {
        try {
          renderer.setRenderTarget(previous);
        } catch {
          /* контекст потерян — кадру всё равно */
        }
      }
      if (!waiting) return null;
      held.push(probes);
      for (const item of fresh) ordered.add(item.key);
      return waiting;
    },
    /** Сколько образцов сейчас держится (для тестов). */
    get held() {
      return held.reduce((sum, set) => sum + set.probes.length, 0);
    },
    dispose() {
      closed = true;
      release();
      target?.dispose();
      target = null;
    },
  };
}
