// Эффекты стрельбища: правила игры из базы игрока, рождение вспышки, дыма и гильзы, пачки для кадра.
import {
  EffectInstance,
  effectFrame,
  loadModel,
  modelBatches,
  spriteBatches,
  trailBatches,
} from "@modovik/ptfx-runtime";
import * as THREE from "three";
import { withOneCasing } from "./export-fit.js";

const LIMITS = Object.freeze({ live: 48, seedStep: 48271, seedWrap: 2147483647 });
const PROBE = Object.freeze({ steps: 6, dt: 0.02, epsilon: 1e-5 });
const SMOKE = "muz_smoking_barrel";
const SKIPPED_EVOLUTIONS = new Set(["LOD", "angle"]);

const evolutionNames = (holder) => holder?.evolutions?.names ?? [];

// LOD = 0, затем имена эволюций правила и его событий по порядку — все равны единице.
function evolutionTable(rule) {
  const names = [...evolutionNames(rule), ...(rule.events ?? []).flatMap(evolutionNames)];
  return names.reduce(
    (table, name) => (SKIPPED_EVOLUTIONS.has(name) ? table : { ...table, [name]: 1 }),
    { LOD: 0 },
  );
}

// Слот отдаёт набор частиц; без набора сам слот считается одной частицей.
function* particlesIn(slot) {
  const crowd = slot?.particles;
  if (crowd && typeof crowd[Symbol.iterator] === "function") yield* crowd;
  else yield slot;
}

function coordinatesOf(particle) {
  const spot = particle?.position ?? particle?.pos;
  if (!spot) return null;
  return ["x", "y", "z"].map((name, index) => spot[index] ?? spot[name]);
}

export class EffectDeck {
  #rules = null;
  #sheets = {};
  #seed = 1;
  #axes = new Map();
  #live = [];

  get armed() {
    return this.#rules !== null;
  }

  get live() {
    return this.#live;
  }

  get alive() {
    return this.#live.length > 0;
  }

  // Размеры листов нужны движку, чтобы вписывать спрайты по пропорции.
  adopt(sheetMap) {
    this.#sheets = sheetMap;
  }

  // Новая база: прежние эффекты и найденные оси сбрасываются, правила собираются заново.
  reset(exported) {
    this.#axes = new Map();
    this.#live = [];
    try {
      this.#rules = exported ? loadModel(withOneCasing(exported)) : null;
    } catch {
      this.#rules = null;
    }
  }

  clearLive() {
    this.#live = [];
  }

  #nextSeed() {
    this.#seed = (this.#seed * LIMITS.seedStep) % LIMITS.seedWrap;
    return this.#seed;
  }

  #aspect = (name) => {
    const sheet = this.#sheets?.[name];
    return sheet && sheet.width > 0 && sheet.height > 0 ? sheet.height / sheet.width : null;
  };

  #spawn(name, frame) {
    return new EffectInstance(this.#rules, name, {
      frame: effectFrame(frame),
      seed: this.#nextSeed(),
      evolutions: evolutionTable(this.#rules.effects.get(name)),
      aspectOf: this.#aspect,
    });
  }

  // Ось вспышки в собственном пространстве правила: куда летят частицы первых 0,12 с.
  #axisOf(name) {
    if (this.#axes.has(name)) return this.#axes.get(name);
    const probe = this.#spawn(name, { origin: [0, 0, 0], z: [0, 0, 1], up: [0, 1, 0] });
    const total = new THREE.Vector3();
    for (let tick = 0; tick < PROBE.steps; tick++) {
      probe.step(PROBE.dt);
      for (const slot of probe.slots()) {
        for (const particle of particlesIn(slot)) {
          const xyz = coordinatesOf(particle);
          if (xyz) total.add(new THREE.Vector3().fromArray(xyz));
        }
      }
    }
    const axis = total.length() > PROBE.epsilon ? total.normalize() : null;
    this.#axes.set(name, axis);
    return axis;
  }

  #flashFrame(name, origin, forward) {
    const turn = new THREE.Quaternion().setFromUnitVectors(
      this.#axisOf(name) ?? new THREE.Vector3(0, 0, 1),
      forward,
    );
    const turned = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(turn).toArray();
    return { origin: origin.toArray(), z: turned(0, 0, 1), up: turned(0, 1, 0) };
  }

  fire({ rules, shells, muzzle, ejection, forward, down }) {
    const plan = [
      [rules.flash, () => this.#flashFrame(rules.flash, muzzle, forward)],
      [SMOKE, () => ({ origin: muzzle.toArray(), z: forward.toArray(), up: [0, 0, 1] })],
      [
        shells ? rules.shell : null,
        () => ({ origin: ejection.toArray(), z: forward.toArray(), up: down.toArray() }),
      ],
    ];
    for (const [name, describe] of plan) {
      if (name && this.#rules.effects.has(name)) this.#live.push(this.#spawn(name, describe()));
    }
    const surplus = this.#live.length - LIMITS.live;
    if (surplus > 0) this.#live.splice(0, surplus);
  }

  step(dt) {
    this.#live.forEach((instance) => instance.step(dt));
    this.#live = this.#live.filter((instance) => !instance.finished);
  }

  batches(basis, lookup) {
    const packs = { sprites: [], models: [], trails: [] };
    for (const [at, instance] of this.#live.entries()) {
      const label = `s${at}`;
      packs.sprites.push(...spriteBatches(instance, basis, lookup, label));
      packs.models.push(...modelBatches(instance, label));
      packs.trails.push(...trailBatches(instance, basis, lookup, label));
    }
    return packs;
  }
}

export const createEffectDeck = () => new EffectDeck();
