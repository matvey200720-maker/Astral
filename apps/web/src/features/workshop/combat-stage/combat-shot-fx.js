/*
 * Эффекты выстрела 3D-сцены боя (задача 4А, 18.10.2026): вспышка дула, след
 * пули и попадание в стену — правила ядра игры игрока, собранные так же, как
 * соберёт установка. Общий набор для режимов, где кто-то стреляет:
 * «Трейсеры», «Следы урона на экране» и «Килл-эффект».
 *
 * Игра ставит след не одним спрайтом, а по экземпляру на каждый свой кадр
 * вдоль пути пули (`combat-tracer-plan.js`). Вспышка — штатная `muz_*` ствола,
 * повёрнутая по оси ствола, попадание — `bul_concrete`. LOD каждого штриха —
 * по расстоянию от камеры до его начала, как его считает игра для следа.
 *
 * След по умолчанию — штатное правило `bullet_tracer`; режим трейсеров
 * подставляет свой слот из редактора (`setSlot`).
 */

import * as THREE from "three";
import { EffectInstance, effectFrame, loadModel, modelBatches, spriteBatches, trailBatches } from "@modovik/ptfx-runtime";
import { buildTracerSlot } from "@modovik/ptfx-studio/tracer-slot.js";
import { shotLod } from "./combat-schedule.js";
import { tracerSegments, tracerStrokes } from "./combat-tracer-plan.js";

/* Ориентир скорости пули, м/с: у пуль в weapons.meta она порядка двух тысяч, у
   части стволов ниже. От неё зависит только расстояние между штрихами. */
export const BULLET_SPEED = 1000;
const MUZZLE_RULE = "muz_assault_rifle";
const IMPACT_RULE = "bul_concrete";
const TRACER_RULE = "bullet_tracer";
const TRACER_TEXTURE = "ptfx_bullet_tracer";
/* Пропорция текстуры слота 128×256. */
const SLOT_ASPECT = 2;
const MAX_LIVE = 80;

const rotateTo = (from, to, vector) => {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...from), new THREE.Vector3(...to));
  return new THREE.Vector3(...vector).applyQuaternion(quaternion).toArray();
};

/* Эволюции, что не про дальность и угол, — на полную, как у вспышек в «Огне и взрывах». */
export const evolutionsFor = (rule, lod) => {
  const out = { LOD: lod };
  const names = new Set([
    ...(rule?.evolutions?.names || []),
    ...(rule?.events || []).flatMap((event) => event.evolutions?.names || []),
  ]);
  for (const name of names) if (name !== "LOD" && name !== "angle") out[name] = 1;
  return out;
};

/**
 * @param {object} ctx — `ctx` режиссёра сцены (`combat-scene.js`)
 */
export function createShotFx(ctx) {
  let tracerScene = null;
  let fxModel = null;
  let slotModel = null;
  /* Слоты другой длины (штрих, подогнанный под путь пули — `tracerStrokes`): длина с точностью до 2,5 см → модель. */
  let slotModels = new Map();
  let slotRequest = { width: 0.05, length: 0.7, nearHide: null };
  /* Режим заказал свой слот (трейсеры): след собирается по его размерам, а не штатным. */
  let slotWanted = false;
  let canvas = null;
  let canvasVersion = 0;
  let sheets = {};
  let live = [];
  let pending = [];
  let time = 0;
  let failure = "";
  let flashAxis = null;

  const aspectOf = (name) => {
    if (name === TRACER_TEXTURE && canvas) return SLOT_ASPECT;
    const sheet = sheets[name];
    return sheet?.width && sheet?.height ? sheet.height / sheet.width : null;
  };

  /* Лист по имени: слот редактора вместо штатной текстуры следа. */
  function lookup(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    if (lower === TRACER_TEXTURE && canvas) return ctx.bank.canvas(`astral-tracer:${canvasVersion}`, canvas, { columns: 1, rows: 1 });
    return ctx.bank.game(lower);
  }

  /* Модели: след со слотом по заказу и остальные правила как в игре. */
  function rebuild() {
    failure = "";
    slotModel = null;
    slotModels = new Map();
    fxModel = null;
    live = [];
    pending = [];
    const exported = tracerScene?.exports?.[0];
    if (!exported) return;
    try {
      fxModel = loadModel(exported);
      if (slotWanted && exported.effects?.[TRACER_RULE])
        slotModel = loadModel(buildTracerSlot(exported, { ...slotRequest, neutralColour: Boolean(canvas), aspect: SLOT_ASPECT }));
    } catch (error) {
      failure = String(error?.message || error);
      fxModel = null;
      slotModel = null;
    }
  }

  function newInstance(model, name, { origin, z, up = [0, 0, 1], seed, lod = 0, lag = 0 }) {
    const rule = model.effects.get(name);
    if (!rule) return null;
    const instance = new EffectInstance(model, name, {
      frame: effectFrame({ origin, z, up }),
      seed,
      evolutions: evolutionsFor(rule, lod),
      aspectOf,
    });
    if (lag > 0) instance.step(lag);
    return instance;
  }

  const lodAt = (rule, point) => {
    const camera = ctx.cameraPosition();
    return shotLod({ distance: Math.hypot(camera.x - point[0], camera.y - point[1], camera.z - point[2]), lod: rule.lod });
  };

  /* Ось вспышки в её собственном пространстве — по частицам первых долей секунды. */
  function axisOf(model, name) {
    if (flashAxis?.model === model) return flashAxis.axis;
    const instance = newInstance(model, name, { origin: [0, 0, 0], z: [0, 0, 1], up: [0, 1, 0], seed: 1 });
    let axis = null;
    if (instance) {
      const mean = [0, 0, 0];
      let count = 0;
      for (let step = 0; step < 6; step += 1) {
        instance.step(0.02);
        for (const slot of instance.slots())
          for (const particle of slot.particles) {
            for (let k = 0; k < 3; k += 1) mean[k] += particle.position[k];
            count += 1;
          }
      }
      const reach = Math.hypot(...mean);
      if (count && reach > 1e-5) axis = mean.map((value) => value / reach);
    }
    flashAxis = { model, axis };
    return axis;
  }

  const trackerModel = () => slotModel || fxModel;

  /* Слот, чей штрих на кадре длиной `length` метров: тот же, что у автора, с другой длиной; почти та же длина — слот автора как есть. */
  function slotModelFor(length) {
    if (!slotModel || !(length > 0) || Math.abs(length - slotRequest.length) <= slotRequest.length * 0.02) return slotModel;
    const key = Math.round(length * 40) / 40;
    if (!slotModels.has(key)) {
      if (slotModels.size >= 48) slotModels.clear();
      let model = slotModel;
      try {
        model = loadModel(buildTracerSlot(tracerScene.exports[0], { ...slotRequest, length: key, neutralColour: Boolean(canvas), aspect: SLOT_ASPECT }));
      } catch {
        /* не собралось — штрих слота автора */
      }
      slotModels.set(key, model);
    }
    return slotModels.get(key);
  }

  return {
    lookup,
    get failure() {
      return failure;
    },
    /** Правила ядра прочитаны и собраны. */
    get ready() {
      return Boolean(fxModel);
    },
    get hasFlash() {
      return Boolean(fxModel?.effects.has(MUZZLE_RULE));
    },
    get hasTracer() {
      return Boolean(trackerModel()?.effects.has(TRACER_RULE));
    },
    get hasImpact() {
      return Boolean(fxModel?.effects.has(IMPACT_RULE));
    },
    get liveCount() {
      return live.length;
    },
    get busy() {
      return live.length > 0 || pending.length > 0;
    },
    get time() {
      return time;
    },
    /** База эффектов из игры игрока (`readPtfxBase`) или `null`. */
    setBase(base) {
      tracerScene = base?.tracerScene || null;
      sheets = tracerScene?.sheets || {};
      ctx.bank.provideSheets(sheets);
      ctx.renderer.setMeshes(tracerScene?.exports?.[0]?.meshes || {});
      flashAxis = null;
      rebuild();
    },
    /**
     * Свой слот следа: `{ canvas, width, length, nearHide }`; `canvas` — текстура
     * 128×256. Возвращает `true`, если модели пересобраны.
     */
    setSlot(next = {}) {
      const nextHide = next.nearHide || null;
      const same =
        slotWanted &&
        (next.canvas || null) === canvas &&
        next.width === slotRequest.width &&
        next.length === slotRequest.length &&
        JSON.stringify(nextHide) === JSON.stringify(slotRequest.nearHide);
      if ((next.canvas || null) !== canvas) canvasVersion += 1;
      slotWanted = true;
      canvas = next.canvas || null;
      slotRequest = {
        width: Number.isFinite(next.width) ? next.width : 0.05,
        length: Number.isFinite(next.length) ? next.length : 0.7,
        nearHide: nextHide,
      };
      if (same) return false;
      rebuild();
      return true;
    },
    reset() {
      live = [];
      pending = [];
    },
    /** Сбросить только отложенное (смена темпа кадров игры) — живые штрихи доигрывают. */
    clearPending() {
      pending = [];
    },
    /** Вспышка дула: ось эффекта — по стволу. */
    flash({ origin, direction, seed, lag = 0, key = "m" }) {
      const rule = fxModel?.effects.get(MUZZLE_RULE);
      if (!rule) return;
      const axis = axisOf(fxModel, MUZZLE_RULE) || [0, 0, 1];
      const instance = newInstance(fxModel, MUZZLE_RULE, {
        origin,
        z: rotateTo(axis, direction, [0, 0, 1]),
        up: rotateTo(axis, direction, [0, 1, 0]),
        seed,
        lod: lodAt(rule, origin),
        lag,
      });
      if (instance) live.push({ key: `${key}${seed}`, instance, model: fxModel });
    },
    /**
     * Штрихи следа — по кадру игры вдоль пути пули. `cover` — предпросмотр на кадре игры: у слота автора штрихи встык от дула до цели
     * (`tracerStrokes`), а не один штрих со слот длиной и центром у дула (путь короче шага пули за кадр).
     */
    tracer({ from, direction, reach, fps, seed, lag = 0, speed = BULLET_SPEED, cover = false }) {
      if (!this.hasTracer) return;
      if (cover && slotModel) {
        tracerStrokes({ from, direction, reach, length: slotRequest.length, speed, fps }).forEach((stroke, index) =>
          pending.push({ at: time - lag + stroke.at, kind: "tracer", origin: stroke.origin, direction: stroke.direction, seed: seed + index + 1, model: slotModelFor(stroke.length) }),
        );
      } else {
        tracerSegments({ from, direction, reach, speed, fps }).forEach((segment, index) =>
          pending.push({ at: time - lag + segment.at, kind: "tracer", origin: segment.origin, direction: segment.direction, seed: seed + index + 1 }),
        );
      }
      pending.sort((left, right) => left.at - right.at);
    },
    /** Попадание в стену — через `delay` секунд (пуля долетела). */
    impact({ origin, direction = [0, -1, 0], seed, delay = 0, lag = 0 }) {
      if (!this.hasImpact) return;
      pending.push({ at: time - lag + delay, kind: "impact", origin, direction, seed });
      pending.sort((left, right) => left.at - right.at);
    },
    /** Шаг времени; `true`, если картинка изменилась. */
    step(dt) {
      time += dt;
      for (const entry of live) entry.instance.step(dt);
      const before = live.length;
      live = live.filter((entry) => !entry.instance.finished);
      let changed = live.length !== before;
      while (pending.length && pending[0].at <= time) {
        const item = pending.shift();
        const lag = time - item.at;
        const model = item.model || (item.kind === "tracer" ? trackerModel() : fxModel);
        const name = item.kind === "tracer" ? TRACER_RULE : IMPACT_RULE;
        const rule = model?.effects.get(name);
        if (!rule) continue;
        const instance = newInstance(model, name, { origin: item.origin, z: item.direction, seed: item.seed, lod: lodAt(rule, item.origin), lag });
        if (instance) {
          live.push({ key: `${item.kind}${item.seed}`, instance, model });
          changed = true;
        }
      }
      while (live.length > MAX_LIVE) live.shift();
      return changed;
    },
    collect(camera) {
      const batches = [];
      const models = [];
      const trails = [];
      for (const { key, instance } of live) {
        batches.push(...spriteBatches(instance, camera, lookup, key));
        models.push(...modelBatches(instance, key));
        trails.push(...trailBatches(instance, camera, lookup, key));
      }
      return { batches, models, trails };
    },
  };
}
