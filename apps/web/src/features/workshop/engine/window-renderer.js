import { skipShaderChecks } from "../model-stage/shader-warmup.js";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const IDLE_MS = 60000;
const PIN_LIMIT = 96;
const ENV_SIGMA = 0.04;
const CONTEXT_LOST_EVENT = "webglcontextlost";
const STRIPPED_ATTRIBUTES = ["style", "aria-label", "aria-hidden", "role", "tabindex"];
const AXES = ["width", "height"];

// stencil нужен для силуэта большого выбора
const RENDERER_FLAGS = { alpha: true, stencil: true, powerPreference: "low-power", preserveDrawingBuffer: false };

// Распаковка текстур как у нового контекста; имена параметров берутся у самого контекста:
// у настоящего WebGL это 37440, 37441, 37443 -> 37444 и 3317, у заглушек в тестах — свои числа.
const unpackDefaults = (gl) => [
  [gl.UNPACK_FLIP_Y_WEBGL, false],
  [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false],
  [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL],
  [gl.UNPACK_ALIGNMENT, 4],
];

const NOBODY = Symbol("window-renderer: no owner");

const contextGone = (renderer) => Boolean(renderer.getContext?.()?.isContextLost?.());

// ---- вид рендерера для нового хозяина ----

const lookDefaults = () => ({
  outputColorSpace: THREE.SRGBColorSpace,
  toneMapping: THREE.NoToneMapping,
  toneMappingExposure: 1,
  autoClear: true,
  autoClearColor: true,
  autoClearDepth: true,
  autoClearStencil: true,
  sortObjects: true,
  localClippingEnabled: false,
  clippingPlanes: [],
});

const shadowDefaults = () => ({ enabled: false, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false });

function applyFreshLook(renderer) {
  const { shadowMap } = renderer;
  Object.assign(renderer, lookDefaults());
  if (shadowMap) Object.assign(shadowMap, shadowDefaults());
  renderer.setRenderTarget?.(null);
  renderer.setClearColor?.(0x000000, 0);
}

function roomTexture(renderer) {
  const generator = new THREE.PMREMGenerator(renderer);
  const { texture } = generator.fromScene(new RoomEnvironment(), ENV_SIGMA);
  generator.dispose();
  return texture;
}

const canRender = (factory) =>
  Boolean(factory.renderer) || (typeof document !== "undefined" && typeof WebGL2RenderingContext !== "undefined");

// ---- таймер простоя ----

class IdleTimer {
  #handle = null;
  #delay;
  #onExpire;

  constructor(delay, onExpire) {
    this.#delay = delay;
    this.#onExpire = onExpire;
  }

  disarm() {
    if (this.#handle === null) return;
    clearTimeout(this.#handle);
    this.#handle = null;
  }

  arm() {
    this.disarm();
    this.#handle = setTimeout(() => {
      this.#handle = null;
      this.#onExpire();
    }, this.#delay);
  }
}

// ---- закрепление собранных программ ----

// Что делать с очередной программой списка рендерера в зависимости от того, закреплена ли она.
const PIN_ACTIONS = {
  fresh(order, program) {
    program.usedTimes += 1;
    order.add(program);
  },
  busy(order, program) {
    order.delete(program);
    order.add(program);
  },
  idle: () => undefined,
};

// Отпускает вытесненную программу: если кадр её больше не держит, она уничтожается.
function retire(program, list) {
  const remaining = program.usedTimes - 1;
  program.usedTimes = remaining;
  if (remaining > 0) return;
  const at = list.indexOf(program);
  if (at >= 0) {
    const last = list.pop();
    if (at < list.length) list[at] = last;
  }
  program.destroy();
}

class ProgramPins {
  #order = new Set();

  clear() {
    this.#order.clear();
  }

  keep(list) {
    for (const program of list) PIN_ACTIONS[this.#stateOf(program)](this.#order, program);
    for (const evicted of this.#overflow()) retire(evicted, list);
  }

  #stateOf(program) {
    if (!this.#order.has(program)) return "fresh";
    return program.usedTimes > 1 ? "busy" : "idle";
  }

  *#overflow() {
    while (this.#order.size > PIN_LIMIT) {
      const [oldest] = this.#order;
      this.#order.delete(oldest);
      yield oldest;
    }
  }
}

// ---- общие программы сырого GL: одна на ключ на окно ----

class SharedPrograms {
  #entries = new Map();
  #ready = new Set();
  #epoch = 0;

  share(key, build) {
    if (!this.#entries.has(key)) this.#entries.set(key, this.#launch(key, build));
    return this.#entries.get(key);
  }

  isReady(key) {
    return this.#ready.has(key);
  }

  clear() {
    this.#entries.clear();
    this.#ready.clear();
    this.#epoch += 1;
  }

  // Запись принадлежит эпохе, в которой начата сборка; после clear() она уже ничего не меняет.
  async #launch(key, build) {
    const epoch = this.#epoch;
    await undefined;
    try {
      const value = typeof build === "function" ? await build() : undefined;
      if (epoch === this.#epoch) this.#ready.add(key);
      return value;
    } catch (error) {
      if (epoch === this.#epoch) this.#entries.delete(key);
      throw error;
    }
  }
}

// ---- холст окна: логический размер, а настоящий буфер только растёт ----

const TARGET_CONTEXTS = new WeakMap();

function contextFor(target, opaque) {
  if (!TARGET_CONTEXTS.has(target)) {
    const ctx = target.getContext("2d", { alpha: !opaque });
    if (!ctx) return null;
    TARGET_CONTEXTS.set(target, ctx);
  }
  return TARGET_CONTEXTS.get(target);
}

class Surface {
  constructor(el) {
    this.el = el;
    this.logical = { width: el.width, height: el.height };
    this.real = { ...this.logical };
    this.#shim();
  }

  // Подмена width/height у экземпляра холста, если среда — окно с настоящим HTMLCanvasElement.
  #shim() {
    const proto = typeof HTMLCanvasElement === "undefined" ? null : HTMLCanvasElement.prototype;
    const setters = {};
    for (const axis of AXES) {
      const accessor = proto && Object.getOwnPropertyDescriptor(proto, axis);
      if (!accessor?.get || !accessor?.set) return;
      setters[axis] = accessor.set;
    }
    const accessors = AXES.map((axis) => [
      axis,
      {
        configurable: true,
        get: () => this.logical[axis],
        set: (value) => this.#write(axis, setters[axis], value),
      },
    ]);
    Object.defineProperties(this.el, Object.fromEntries(accessors));
  }

  #write(axis, writeReal, value) {
    const floored = Math.floor(value);
    const next = floored < 0 ? 0 : floored;
    this.logical[axis] = next;
    if (next > this.real[axis]) {
      this.real[axis] = next;
      writeReal.call(this.el, next);
    }
  }

  resizeTo(width, height) {
    if (!width || !height) return;
    if (width === this.logical.width && height === this.logical.height) return;
    this.el.width = width;
    this.el.height = height;
  }

  // Кадр лежит в нижнем левом углу буфера (у GL начало внизу), поэтому источник сдвинут по Y.
  copyInto(ctx, x, y) {
    const { width, height } = this.logical;
    const saved = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "copy";
    try {
      ctx.drawImage(this.el, 0, this.real.height - height, width, height, x, y, width, height);
    } finally {
      ctx.globalCompositeOperation = saved;
    }
    return true;
  }

  paintOnto(target, opaque) {
    if (!this.logical.width || !this.logical.height) return false;
    for (const axis of AXES) {
      if (target[axis] !== this.logical[axis]) target[axis] = this.logical[axis];
    }
    const ctx = contextFor(target, opaque);
    return ctx ? this.copyInto(ctx, 0, 0) : false;
  }

  strip() {
    this.el.remove();
    for (const name of STRIPPED_ATTRIBUTES) this.el.removeAttribute(name);
    this.el.className = "";
  }
}

// ---- рендерер окна ----

class WindowGpu {
  // Одни и те же функции у всех хозяев и жильцов.
  roomEnvironment = () => this.#environment();
  keepPrograms = () => this.#keep();
  present = (target, { opaque = false } = {}) => this.#paint(target, opaque);
  copyTo = (ctx, x = 0, y = 0) => this.#copy(ctx, x, y);

  #renderer = null;
  #surface = null;
  #antialias = null;
  #lost = false;
  #env = null;
  #owner = NOBODY;
  #yielder = null;
  #residents = new Set();
  #current = null;
  #touchedGl = false;
  #factory = { renderer: null, environment: null };
  #pins = new ProgramPins();
  #programs = new SharedPrograms();
  #idle = new IdleTimer(IDLE_MS, () => this.#destroy());

  claim(who, antialias, strict, onYield) {
    const admitted =
      this.#ownerCedes(who) && this.#residents.size === 0 && this.#secure(antialias, false, strict);
    if (!admitted) return null;
    this.#owner = who;
    this.#yielder = onYield;
    this.#idle.disarm();
    const mine = this.#renderer;
    applyFreshLook(mine);
    return {
      renderer: mine,
      canvas: this.#surface.el,
      roomEnvironment: this.roomEnvironment,
      keepPrograms: this.keepPrograms,
      present: this.present,
      copyTo: this.copyTo,
      held: () => this.#holds(who, mine),
    };
  }

  join(who, antialias) {
    const admitted = this.#ownerCedes(NOBODY) && this.#secure(antialias, true, true);
    if (!admitted) return null;
    this.#idle.disarm();
    this.#residents.add(who);
    return {
      gl: this.#renderer.getContext(),
      use: (width, height) => this.#use(who, width, height),
      present: this.present,
      sharedProgram: (key, build) => this.#programs.share(key, build),
      leave: () => this.#leave(who),
    };
  }

  release(who) {
    if (this.#owner !== who) return;
    this.#owner = NOBODY;
    this.#yielder = null;
    this.#renderer?.setRenderTarget?.(null);
    this.#renderer?.setAnimationLoop?.(null);
    this.#surface?.strip();
    this.#idle.arm();
  }

  warm(key, build) {
    const renderer = this.#renderer;
    if (!renderer || this.#isLost()) return null;
    const gl = renderer.getContext();
    return this.#programs.share(key, typeof build === "function" ? () => build(gl) : build);
  }

  programReady(key) {
    return this.#programs.isReady(key);
  }

  state() {
    return { alive: this.#renderer !== null, owned: this.#owner !== NOBODY };
  }

  setFactory(renderer, environment) {
    this.#destroy();
    this.#owner = NOBODY;
    this.#yielder = null;
    this.#residents.clear();
    this.#factory = { renderer, environment };
  }

  // -- хозяин --

  // Другой хозяин должен сам освободить рендерер в своём onYield.
  #ownerCedes(claimant) {
    if (this.#owner === NOBODY || this.#owner === claimant) return true;
    const give = this.#yielder;
    const agreed = typeof give === "function" && Boolean(give());
    return agreed && this.#owner === NOBODY;
  }

  #holds(who, mine) {
    return this.#owner === who && this.#renderer === mine && !this.#lost && !contextGone(mine);
  }

  // -- жильцы --

  #use(who, width = 0, height = 0) {
    if (!this.#residents.has(who) || !this.#renderer) return null;
    const renderer = this.#renderer;
    const gl = renderer.getContext();
    if (this.#current !== who) this.#takeOver(renderer, gl, who);
    this.#touchedGl = true;
    this.#surface.resizeTo(width, height);
    return gl;
  }

  #takeOver(renderer, gl, who) {
    renderer.resetState?.();
    unpackDefaults(gl).forEach(([name, value]) => gl.pixelStorei(name, value));
    this.#current = who;
  }

  #leave(who) {
    if (!this.#residents.delete(who)) return;
    if (this.#current === who) this.#current = null;
    const stillBusy = this.#residents.size > 0 || this.#owner !== NOBODY || !this.#renderer;
    if (stillBusy) return;
    if (this.#touchedGl) {
      this.#renderer.resetState?.();
      this.#touchedGl = false;
    }
    this.#idle.arm();
  }

  // -- окружение, программы, кадр --

  #environment() {
    const renderer = this.#renderer;
    if (!renderer) return null;
    if (this.#env === null) {
      const custom = this.#factory.environment;
      this.#env = custom ? custom(renderer) : roomTexture(renderer);
    }
    return this.#env;
  }

  #keep() {
    const list = this.#renderer?.info?.programs;
    if (Array.isArray(list)) this.#pins.keep(list);
  }

  #paint(target, opaque) {
    return Boolean(target) && this.#surface !== null && this.#surface.paintOnto(target, opaque);
  }

  #copy(ctx, x, y) {
    return Boolean(ctx) && this.#surface !== null && this.#surface.copyInto(ctx, x, y);
  }

  // -- жизненный цикл рендерера --

  #isLost() {
    return this.#lost || contextGone(this.#renderer);
  }

  // Что делать с живым рендерером при запросе: оставить, отказать или заменить.
  #verdict(antialias, anyAntialias, strict) {
    if (!this.#renderer) return "build";
    const stale = this.#isLost();
    const mismatch = !anyAntialias && this.#antialias !== antialias;
    if (!stale && !mismatch) return "keep";
    if (this.#residents.size > 0) return "refuse";
    return stale || strict ? "replace" : "refuse";
  }

  #secure(antialias, anyAntialias, strict) {
    switch (this.#verdict(antialias, anyAntialias, strict)) {
      case "keep":
        return true;
      case "refuse":
        return false;
      case "replace":
        this.#destroy();
        return this.#build(antialias);
      default:
        return this.#build(antialias);
    }
  }

  #build(antialias) {
    if (!canRender(this.#factory)) return false;
    const canvas = document.createElement("canvas");
    const surface = new Surface(canvas);
    const spawned = this.#spawn(canvas, antialias);
    if (spawned === null) return false;
    canvas.addEventListener(CONTEXT_LOST_EVENT, () => {
      if (this.#surface?.el === canvas) this.#lost = true;
    });
    skipShaderChecks(spawned.renderer);
    this.#renderer = spawned.renderer;
    this.#surface = surface;
    this.#antialias = antialias;
    this.#lost = false;
    return true;
  }

  // Рендерер в обёртке или null, если создание не удалось.
  #spawn(canvas, antialias) {
    const make = this.#factory.renderer ?? ((options) => new THREE.WebGLRenderer(options));
    try {
      return { renderer: make(Object.assign({ canvas, antialias }, RENDERER_FLAGS)) };
    } catch {
      return null;
    }
  }

  #destroy() {
    this.#idle.disarm();
    this.#env?.dispose?.();
    this.#pins.clear();
    this.#programs.clear();
    this.#touchedGl = false;
    this.#current = null;
    this.#renderer?.dispose?.();
    this.#renderer?.forceContextLoss?.();
    this.#surface?.el.remove();
    this.#renderer = null;
    this.#surface = null;
    this.#antialias = null;
    this.#lost = false;
    this.#env = null;
  }
}

const gpu = new WindowGpu();

// ---- освобождение видеопамяти ----

const textureValues = (material) => {
  const { uniforms } = material;
  const slots = uniforms && typeof uniforms === "object" ? Object.values(uniforms) : [];
  return [...Object.values(material), ...slots.map((slot) => slot?.value)].filter((value) => value?.isTexture);
};

function disposeObject(object, keep) {
  object.geometry?.dispose?.();
  for (const material of [].concat(object.material || [])) {
    for (const texture of textureValues(material)) {
      if (texture !== keep) texture.dispose();
    }
    material.dispose();
  }
}

export function releaseGpu(root, keep = null) {
  if (!root || !root.traverse) return;
  const queue = [];
  root.traverse((object) => queue.push(object));
  for (const object of queue) disposeObject(object, keep);
}

// ---- публичный интерфейс ----

export function claimWindowRenderer(who, settings = {}) {
  const { antialias = true, strict = true, onYield = null } = settings;
  return gpu.claim(who, antialias, strict, onYield);
}

export function joinWindowRenderer(who, settings = {}) {
  const { antialias = true } = settings;
  return gpu.join(who, antialias);
}

export function warmWindowProgram(key, build) {
  return gpu.warm(key, build);
}

export function windowProgramReady(key) {
  return gpu.programReady(key);
}

export function releaseWindowRenderer(who) {
  gpu.release(who);
}

export function windowRendererState() {
  return gpu.state();
}

export function setWindowRendererFactory(settings = {}) {
  const { renderer = null, environment = null } = settings;
  gpu.setFactory(renderer, environment);
}
