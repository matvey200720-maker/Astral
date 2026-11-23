// Стрельбище студии звука: ствол боком на матовом фоне, вспышка, дым и гильзы из базы эффектов игрока.
// Кадры рисуются по требованию цикла сцены; модуль не заводит ни requestAnimationFrame, ни таймеров.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import { MATTE_FLOOR_FRAGMENT, matteFloorUniforms } from "../ptfx/matte-floor.js";
import { createPtfxRenderer } from "../ptfx/ptfx-renderer.js";
import { sceneLighting } from "../ptfx/ptfx-lighting.js";
import { createTextureBank } from "../ptfx/ptfx-textures.js";
import { STAGE_LIGHTING, createStudioEnvironment } from "../gun/lighting.js";
import { createSceneWarmup } from "../../../../features/workshop/model-stage/shader-warmup.js";
import { releaseGpu } from "../../../../features/workshop/engine/window-renderer.js";
import {
  profilePixelRatio,
  qualityProfile,
} from "../../../../features/workshop/model-stage/quality-profile.js";
import { createRangeTone } from "./range-tone.js";
import { orientation } from "./weapon-range/orient.js";
import { unitMeshes, withOneCasing } from "./weapon-range/export-fit.js";
import { dressModel } from "./weapon-range/finish.js";
import { createEffectDeck } from "./weapon-range/effects.js";

export { orientation, unitMeshes, withOneCasing };

const TUNING = Object.freeze({
  fov: 28,
  bloomCap: 0.3,
  gunSpan: [0.15, 2.5],
  fallbackSpan: 0.85,
  lampReach: 10,
  stepRange: [0.001, 0.05],
  restBelow: 0.002,
});
// Направления огней в осях камеры: вправо, вверх, к зрителю.
const LAMP_AIMS = Object.freeze([
  [0.6, 0.8, 0.7],
  [-0.9, 0.1, 0.5],
  [-0.35, 0.6, -0.9],
]);

export const RANGE_RULES = Object.freeze(
  Object.fromEntries(
    Object.entries({
      pistols: ["muz_pistol", "eject_pistol"],
      smg: ["muz_smg", "eject_auto"],
      rifles: ["muz_assault_rifle", "eject_auto"],
      shotguns: ["muz_shotgun", "eject_shotgun"],
      snipers: ["muz_assault_rifle", "eject_sniper"],
      mg: ["muz_assault_rifle", "eject_auto"],
      heavy: ["muz_minigun", null],
    }).map(([group, [flash, shell]]) => [group, Object.freeze({ flash, shell })]),
  ),
);

const clampStep = (seconds) => Math.min(TUNING.stepRange[1], Math.max(TUNING.stepRange[0], seconds));

const namedGroup = (name) => Object.assign(new THREE.Group(), { name });

function lamp(color, [paint, power]) {
  const light = new THREE.DirectionalLight(color, 1);
  light.color.set(paint);
  light.intensity = power;
  return light;
}

class RangeScene {
  #canvas;
  #ptfx;
  #camera;
  #environment;
  #tone;
  #loader;
  #textures;
  #deck = createEffectDeck();
  #warm;
  #world = new THREE.Scene();
  #stage = namedGroup("range-stage");
  #gun = namedGroup("range-gun");
  #mount = namedGroup("range-mount");
  #muzzle = new THREE.Object3D();
  #ejection = new THREE.Object3D();
  #lamps;
  #disposed = false;
  #dirty = true;
  #model = null;
  #gunLength = TUNING.fallbackSpan;
  #queue = [];
  #lastFrameAt = null;
  #casings = true;
  #rules = RANGE_RULES.rifles;
  #loadCount = 0;
  #size = { width: 1, height: 1 };
  #view = { centre: new THREE.Vector3(), distance: 3 };
  #recoil = { offset: 0, velocity: 0, angle: 0, spin: 0, lastShot: -Infinity };

  constructor(canvas, options) {
    this.#canvas = canvas;
    const makeRenderer = options.makeRenderer === undefined ? createPtfxRenderer : options.makeRenderer;
    const notify = options.onChange === undefined ? () => {} : options.onChange;

    const daylight = sceneLighting({ light: null, hour: 13 });
    const lighting = { ...daylight };
    lighting.post = {
      ...daylight.post,
      bloomIntensity: Math.min(daylight.post.bloomIntensity, TUNING.bloomCap),
    };
    this.#tone = createRangeTone({ studioExposure: STAGE_LIGHTING.studio.exposure, post: lighting.post });

    this.#ptfx = makeRenderer({ canvas, lighting });
    this.#camera = this.#ptfx.camera;
    const hasThree = Boolean(this.#ptfx.renderer);
    this.#environment = hasThree ? createStudioEnvironment(this.#ptfx.renderer) : null;
    this.#buildWorld();

    this.#ptfx.setWorld?.({ scene: this.#world, shadows: false, softDepth: true });
    this.#ptfx.setLighting?.(lighting);
    this.#ptfx.setSceneShader?.({
      fragmentShader: MATTE_FLOOR_FRAGMENT,
      uniforms: matteFloorUniforms(lighting, { grid: [0.5, 2.5, 0, 6] }),
    });

    this.#loader = new GLTFLoader();
    this.#loader.setMeshoptDecoder(MeshoptDecoder);

    const wake = () => {
      this.#dirty = true;
      notify();
    };
    this.#textures = createTextureBank({ onReady: wake });
    this.#warm = hasThree
      ? createSceneWarmup({
          renderer: this.#ptfx.renderer,
          scene: this.#world,
          camera: this.#camera,
          alive: () => !this.#disposed,
          onReady: wake,
        })
      : null;
    this.#warm?.warm();
  }

  #buildWorld() {
    const world = this.#world;
    world.environment = this.#environment;
    world.environmentRotation.set(Math.PI / 2, 0, 0);
    world.environmentIntensity = STAGE_LIGHTING.studio.environment;
    this.#stage.rotation.x = Math.PI / 2;
    this.#gun.add(this.#mount, this.#muzzle, this.#ejection);
    this.#stage.add(this.#gun);
    world.add(this.#stage);

    const { key, fill, rim, ambient: level } = STAGE_LIGHTING.studio;
    const paints = [0xffffff, 0xc8d6ff, 0xffffff];
    this.#lamps = [key, fill, rim].map((spec, index) => [lamp(paints[index], spec), LAMP_AIMS[index]]);
    this.#lamps.forEach(([light]) => world.add(light));
    const soft = new THREE.AmbientLight(0xffffff, 1);
    soft.color.set(0xffffff);
    soft.intensity = level;
    world.add(soft);
  }

  // ---------- камера и свет ----------

  #placeLamps() {
    const columns = [0, 1, 2].map((index) =>
      new THREE.Vector3().setFromMatrixColumn(this.#camera.matrixWorld, index),
    );
    for (const [light, aim] of this.#lamps) {
      const sum = (axis) => aim.map((weight, index) => columns[index][axis] * weight).reduce((a, b) => a + b);
      light.position.set(sum("x"), sum("y"), sum("z")).normalize().multiplyScalar(TUNING.lampReach);
    }
  }

  #placeCamera() {
    const { centre, distance } = this.#view;
    const length = this.#gunLength;
    Object.assign(this.#camera, {
      fov: TUNING.fov,
      aspect: this.#size.width / this.#size.height,
      near: Math.max(0.01, distance / 50),
      far: distance * 40,
    });
    this.#camera.up.set(0, 0, 1);
    this.#camera.position.set(centre.x + length * 0.06, centre.y - distance, centre.z + length * 0.12);
    this.#camera.lookAt(centre.x + length * 0.08, centre.y, centre.z);
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld();
    this.#placeLamps();
  }

  #frameGun() {
    this.#stage.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.#mount);
    const span = bounds.getSize(new THREE.Vector3());
    this.#view.centre.copy(bounds.getCenter(new THREE.Vector3()));
    const aspect = this.#size.width / this.#size.height || 1;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(TUNING.fov) / 2);
    this.#view.distance = Math.max(
      (span.x * 1.55) / (2 * halfTan * aspect),
      (span.z * 2.4) / (2 * halfTan),
    );
    this.#placeCamera();
    this.#dirty = true;
  }

  // ---------- состояние для вызывающего ----------

  get lastShot() {
    return this.#recoil.lastShot;
  }

  get gameEffects() {
    return this.#deck.armed;
  }

  get dirty() {
    return this.#dirty;
  }

  debug() {
    return {
      camera: this.#camera,
      gun: this.#gun,
      mount: this.#mount,
      stage: this.#stage,
      world: this.#world,
      view: this.#view,
      live: this.#deck.live,
      muzzle: this.#muzzle,
      ejection: this.#ejection,
    };
  }

  // ---------- загрузка модели ----------

  #chooseRules(group) {
    this.#rules = RANGE_RULES[group] || RANGE_RULES.rifles;
  }

  setGroup(group) {
    this.#chooseRules(group);
  }

  #release(root) {
    releaseGpu(root, this.#environment);
  }

  // Масштаб 1 для длины в допустимых границах, иначе ствол приводится к 0,85 м.
  #fitScale() {
    this.#stage.updateMatrixWorld(true);
    const dims = new THREE.Box3().setFromObject(this.#mount).getSize(new THREE.Vector3());
    const largest = Math.max(dims.x, dims.y, dims.z, 1e-6);
    const [shortest, longest] = TUNING.gunSpan;
    this.#mount.scale.setScalar(largest >= shortest && largest <= longest ? 1 : TUNING.fallbackSpan / largest);
  }

  // Центрирует ствол по коробке в осях gun и ставит дуло и окно выброса.
  #centreAndMark() {
    this.#stage.updateMatrixWorld(true);
    const toGun = new THREE.Matrix4().copy(this.#gun.matrixWorld).invert();
    const box = new THREE.Box3().setFromObject(this.#mount).applyMatrix4(toGun);
    const centre = box.getCenter(new THREE.Vector3());
    this.#mount.position.sub(centre);
    box.min.sub(centre);
    box.max.sub(centre);

    const length = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    this.#gunLength = length;
    this.#muzzle.position.set(box.max.x + length * 0.01, box.max.y - height * 0.18, 0);
    this.#ejection.position.set(box.max.x - length * 0.55, box.max.y - height * 0.12, 0);
  }

  async load(url, { shells = true, group = null } = {}) {
    this.#casings = Boolean(shells);
    if (group) this.#chooseRules(group);
    const ticket = ++this.#loadCount;

    const loaded = await this.#loader.loadAsync(url);
    if (this.#disposed) return undefined;
    if (ticket !== this.#loadCount) {
      this.#release(loaded.scene);
      return undefined;
    }

    if (this.#model) {
      this.#mount.remove(this.#model);
      this.#release(this.#model);
      this.#model = null;
    }
    const incoming = loaded.scene;
    dressModel(incoming, this.#tone);
    const turn = orientation(incoming);

    this.#mount.position.set(0, 0, 0);
    this.#mount.quaternion.identity();
    this.#mount.scale.set(1, 1, 1);
    this.#mount.add(incoming);
    this.#model = incoming;
    this.#gun.position.set(0, 0, 0);
    this.#gun.rotation.set(0, 0, 0);
    this.#mount.quaternion.copy(turn);

    this.#fitScale();
    this.#centreAndMark();
    this.#deck.clearLive();
    this.#frameGun();
    this.#dirty = true;
    this.#warm?.warm();
    return undefined;
  }

  resize() {
    const rect = this.#canvas.getBoundingClientRect();
    const whole = (extent) => Math.max(1, Math.round(extent));
    this.#size = { width: whole(rect.width), height: whole(rect.height) };
    this.#ptfx.resize?.(this.#size.width, this.#size.height, profilePixelRatio(qualityProfile()));
    if (!this.#model) this.#placeCamera();
    else this.#frameGun();
    this.#dirty = true;
  }

  // ---------- база эффектов, очередь выстрелов ----------

  setBase(base) {
    const section = base?.rangeScene;
    const exported = section?.exports?.[0];
    const sheets = section?.sheets ?? {};
    this.#deck.adopt(sheets);
    this.#textures.provideSheets(sheets);
    this.#ptfx.setMeshes?.(exported ? unitMeshes(exported) : {});
    this.#deck.reset(exported);
    this.#dirty = true;
  }

  schedule(times) {
    this.#queue = [...this.#queue, ...times].sort((left, right) => left - right);
  }

  clear() {
    this.#queue = [];
  }

  // ---------- кадр ----------

  #shoot(scheduledAt) {
    const recoil = this.#recoil;
    Object.assign(recoil, { lastShot: scheduledAt, velocity: recoil.velocity - 1.6, spin: recoil.spin + 3.2 });
    if (!this.#deck.armed) return;
    this.#stage.updateMatrixWorld(true);
    const along = (x, y) => new THREE.Vector3(x, y, 0).transformDirection(this.#gun.matrixWorld);
    this.#deck.fire({
      rules: this.#rules,
      shells: this.#casings,
      muzzle: this.#muzzle.getWorldPosition(new THREE.Vector3()),
      ejection: this.#ejection.getWorldPosition(new THREE.Vector3()),
      forward: along(1, 0),
      down: along(0, -1),
    });
  }

  #spring(dt) {
    const recoil = this.#recoil;
    recoil.velocity += (-120 * recoil.offset - 16 * recoil.velocity) * dt;
    recoil.offset += recoil.velocity * dt;
    recoil.spin += (-150 * recoil.angle - 18 * recoil.spin) * dt;
    recoil.angle += recoil.spin * dt;
    this.#gun.position.x = recoil.offset * this.#gunLength * 0.05;
    this.#gun.rotation.z = recoil.angle * 0.05;
  }

  #lookup = (name) => (name ? this.#textures.game(String(name).toLowerCase()) : null);

  #cameraBasis() {
    const matrix = this.#camera.matrixWorld;
    const [right, up] = [0, 1].map((column) => new THREE.Vector3().setFromMatrixColumn(matrix, column));
    return { position: this.#camera.position.toArray(), right: right.toArray(), up: up.toArray() };
  }

  #nextWake(now) {
    const recoil = this.#recoil;
    const moving =
      this.#deck.alive ||
      Math.abs(recoil.offset) > TUNING.restBelow ||
      Math.abs(recoil.angle) > TUNING.restBelow;
    if (moving) return 0;
    return this.#queue.length ? Math.max(0, this.#queue[0] - now) : Infinity;
  }

  frame(now) {
    if (this.#warm && !this.#warm.ready) return Infinity;

    const dt = clampStep((now - (this.#lastFrameAt ?? now)) / 1000);
    this.#lastFrameAt = now;
    while (this.#queue.length && this.#queue[0] <= now) this.#shoot(this.#queue.shift());
    this.#spring(dt);
    this.#deck.step(dt);
    this.#placeCamera();

    const { sprites, models, trails } = this.#deck.batches(this.#cameraBasis(), this.#lookup);
    this.#ptfx.render(sprites, models, this.#lookup, trails);
    this.#dirty = false;
    return this.#nextWake(now);
  }

  dispose() {
    this.#disposed = true;
    this.#warm?.stop();
    releaseGpu(this.#world, this.#environment);
    this.#environment?.dispose();
    this.#textures.dispose();
    this.#ptfx.dispose?.();
  }
}

export function createWeaponRange(canvas, options = {}) {
  const scene = new RangeScene(canvas, options);
  return {
    load: (url, extras = {}) => scene.load(url, extras),
    resize: () => scene.resize(),
    setBase: (base) => scene.setBase(base),
    setGroup: (group) => scene.setGroup(group),
    schedule: (times) => scene.schedule(times),
    clear: () => scene.clear(),
    frame: (now) => scene.frame(now),
    dispose: () => scene.dispose(),
    get lastShot() {
      return scene.lastShot;
    },
    get gameEffects() {
      return scene.gameEffects;
    },
    debug: () => scene.debug(),
    get dirty() {
      return scene.dirty;
    },
  };
}
