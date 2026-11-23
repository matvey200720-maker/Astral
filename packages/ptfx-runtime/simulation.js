/*
 * Движок частиц: проигрывание правила эффекта RMPTFX по данным игры.
 *
 * Экземпляр эффекта живёт так же, как в игре:
 *  • у правила — длительность и скорость проигрывания (случайные в своих
 *    пределах), масштаб (`zoomScalar`, проценты) и оттенок;
 *  • события таймлайна включают эмиттеры на доле эффекта [start, end), у
 *    каждого — своя скорость, масштаб и оттенок;
 *  • эмиттер рождает частицы: разово (`IsOneShot`) или потоком — по
 *    `spawnRateOverTime` в секунду, а третье число той же дорожки — предел
 *    живых частиц; точка рождения — домен creation, скорость — направление
 *    на точку домена target (у RAGE он и назывался VelocityDomain), умноженное
 *    на `speedScalar` и на масштаб эффекта;
 *  • частица живёт `particleLife` секунд своего времени, которое идёт с
 *    множителем `playbackRateScalar` эмиттера (у струи крови — 7.5: жизнь в
 *    шесть секунд пробегает за 0.8); поведения считаются по доле её жизни.
 *
 * Случайные величины — по номерам свойств и связям смещений (`random.js`);
 * эволюции (LOD, угол) — по значениям, которые дал вызывающий.
 *
 * Здесь нет отрисовки: частица отдаёт положение, размер, цвет, кадр листа —
 * а спрайт из них собирает `draw.js` под конкретную камеру.
 */

import { sampleProperty } from "./keyframes.js";
import { sampleDomain } from "./domains.js";
import { directionToWorld, toWorld } from "./math.js";
import { seedOf, sequence, unitHash } from "./random.js";

/* Величины, которые сверяются с игрой, — в одном месте. */
export const SEMANTICS = Object.freeze({
  gravity: 9.81,
  /* Шаг интегрирования не крупнее этого, секунд: окно может отдать и 0.1. */
  maxStep: 1 / 60,
  /* Предел частиц на эмиттер — как защита окна от «потока» в тысячи. */
  maxParticlesPerEmitter: 2000,
});

const ZERO4 = Object.freeze([0, 0, 0, 0]);
const ONE4 = Object.freeze([1, 1, 1, 1]);
const HUNDRED4 = Object.freeze([100, 100, 100, 100]);

/* Значения пустых свойств эмиттера. */
const EMITTER_DEFAULTS = Object.freeze({
  spawnRateOverTime: ZERO4,
  spawnRateOverDist: ZERO4,
  particleLife: ONE4,
  playbackRateScalar: ONE4,
  speedScalar: ONE4,
  sizeScalar: HUNDRED4,
  accnScalar: HUNDRED4,
  dampeningScalar: HUNDRED4,
  matrixWeightScalar: HUNDRED4,
  inheritVelocity: ZERO4,
});

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/*
 * Случайная величина частицы для свойства: номер свойства или его связи
 * смещений; `channel` — для покомпонентных диапазонов.
 */
function randomOf(particle, property, channel = 0) {
  if (!property) return 0.5;
  let index = property.random;
  let invert = false;
  for (const link of particle.rule.biasLinks) {
    if (link.members.has(property.hash)) {
      index = link.random;
      invert = property.invert;
      break;
    }
  }
  const value = unitHash(particle.seed, index * 4 + channel);
  return invert ? 1 - value : value;
}

/**
 * Экземпляр эффекта.
 *
 * `options`:
 *  • `frame` — матрица эффекта (`math.effectFrame`), мир;
 *  • `seed` — зерно: одно зерно — один и тот же выброс;
 *  • `scale` — масштаб эффекта от вызывающего (как `scale` у натива игры);
 *  • `evolutions` — значения эволюций по имени (`{ LOD: 0.2, angle: 0 }`);
 *  • `tint` — оттенок от вызывающего (RGBA 0…1);
 *  • `loop` — экземпляр зациклен, как у игры зарегистрированные эффекты
 *    (окружающие эффекты пропов, `StartParticleFxLooped*`): правило с
 *    `NumLoops` −1 играет без конца, с N > 0 — ещё N раз. Разовый выброс
 *    (попадание) играет правило один раз, как `StartParticleFxNonLooped*`.
 */
export class EffectInstance {
  constructor(model, name, options = {}) {
    const rule = model.effects.get(name);
    if (!rule) throw new Error(`Правило эффекта ${name} не найдено в модели.`);
    this.model = model;
    this.rule = rule;
    this.frame = options.frame;
    this.seed = options.seed >>> 0 || seedOf(name);
    this.scale = options.scale ?? 1;
    this.tint = options.tint || ONE4;
    this.evolutions = { ...(options.evolutions || {}) };
    /* Земля (высота мира) и ветер (м/с) вызывающего: у кадра фонаря — асфальт
       и тихий ветер, у кадров без них — как прежде. */
    this.ground = Number.isFinite(options.ground) ? options.ground : null;
    this.wind = Array.isArray(options.wind) ? options.wind : [0, 0, 0];
    /*
     * Пропорция текстуры (высота / ширина) по имени — для размера в
     * пропорциональном режиме. У трассеров игры (`bullet_tracer` и клоны) и
     * вспышек `ptxu_Size` стоит в нём: высота спрайта берётся из ширины и
     * пропорции текстуры, а прямое значение высоты («500») не используется
     * (помощник сверил это в живой игре: `ReadTracerShape`). Без функции
     * размер читается как прежде — сцены, где текстур с непривычной
     * пропорцией нет, не меняются.
     */
    this.aspectOf = typeof options.aspectOf === "function" ? options.aspectOf : null;
    const next = sequence(this.seed ^ 0x2545f491);
    this.duration = lerp(rule.duration[0], rule.duration[1], next());
    this.playback = lerp(rule.playback[0], rule.playback[1], next()) || 1;
    this.zoomRandom = next();
    this.time = 0;
    this.finished = false;
    this.loop = 0;
    this.looping = options.loop === true && rule.loops !== 0 && this.duration > 0;
    this.events = rule.events
      .map((event) => this.createEvent(event, next))
      .filter(Boolean);
    this.scratch = new Float32Array(4);
  }

  createEvent(event, next) {
    const emitter = this.model.emitters.get(event.emitter);
    const particle = this.model.particles.get(event.particle);
    if (!emitter || !particle) return null;
    const tintRandom = next();
    const tint = event.tint[0].map((value, index) => lerp(value, event.tint[1][index], tintRandom));
    return {
      event,
      emitter,
      rule: particle,
      playback: lerp(event.playback[0], event.playback[1], next()) || 1,
      zoom: lerp(event.zoom[0], event.zoom[1], next()),
      tint,
      seed: seedOf(this.seed, event.index),
      spawned: 0,
      pending: 0,
      fired: false,
      particles: [],
    };
  }

  /* Доля эффекта 0…1 (зацикливание правил эффектов попадания не нужно). */
  get ratio() {
    return this.duration > 0 ? Math.min(this.time / this.duration, 1) : 1;
  }

  /** Масштаб эффекта: `zoomScalar` правила (проценты), случайный в пределах. */
  effectZoom() {
    const property = this.rule.props.zoomScalar;
    const evolved = property ? this.rule.evolutions.evolved.get(property.name) : null;
    const value = sampleProperty(property?.track, HUNDRED4, evolved, this.evolutions, this.ratio, this.scratch);
    return (lerp(value[0], value[1], this.zoomRandom) / 100) * this.scale;
  }

  /** Значение свойства эмиттера для события в момент эмиттера. */
  emitterValue(slot, name, ratio, out) {
    const property = slot.emitter.props[name];
    const evolved = property ? slot.event.evolutions.evolved.get(property.name) : null;
    return sampleProperty(property?.track, EMITTER_DEFAULTS[name] || ZERO4, evolved, this.evolutions, ratio, out);
  }

  /**
   * Куда тянет домен притяжения эмиттера события (мир): центр домена в
   * пространстве эффекта; домена нет — начало эффекта.
   */
  attractorPoint(slot) {
    const domain = slot.emitter.attractor;
    const local = domain ? this.domainValues(slot, domain, this.ratio || 0).position : [0, 0, 0];
    const zoom = slot.zoom || 1;
    const point = [local[0] * zoom, local[1] * zoom, local[2] * zoom];
    return domain?.worldSpace && !this.frame ? point : toWorld([0, 0, 0], this.frame, point);
  }

  domainValues(slot, domain, ratio) {
    const read = (property, fallback) => {
      const evolved = property ? slot.event.evolutions.evolved.get(property.name) : null;
      return [...sampleProperty(property?.track, fallback, evolved, this.evolutions, ratio, new Float32Array(4))];
    };
    return {
      position: read(domain.position, ZERO4),
      rotation: read(domain.rotation, ZERO4),
      outer: read(domain.sizeOuter, ZERO4),
      inner: read(domain.sizeInner, ZERO4),
    };
  }

  /** Родить одну частицу события в момент эмиттера `ratio`. */
  spawn(slot, ratio, cap = 0) {
    if (slot.particles.length >= SEMANTICS.maxParticlesPerEmitter) return;
    if (cap > 0 && slot.particles.length >= cap) return;
    const index = slot.spawned;
    slot.spawned += 1;
    const seed = seedOf(slot.seed, index);
    const next = sequence(seed ^ 0x9e3779b9);
    const particle = {
      id: index,
      seed,
      rule: slot.rule,
      slot,
      age: 0,
      life: 1,
      playback: 1,
      zoom: 1,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      sizeScalar: [1, 1, 1],
      accnScalar: [1, 1, 1],
      dampScalar: [1, 1, 1],
      angle: [0, 0, 0],
      frame0: 0,
      flipU: false,
      flipV: false,
      alive: true,
      /* выходы для отрисовки */
      size: [0, 0, 0],
      tblr: [1, 1, 1, 1],
      tblrVel: [0, 0, 0, 0],
      colour: [1, 1, 1, 1],
      emissive: 0,
      frame: 0,
      frameBlend: 0,
    };
    const out = this.scratch;
    const emitterRandom = (name, channel = 0) =>
      randomOf(particle, slot.emitter.props[name], channel);

    const life = this.emitterValue(slot, "particleLife", ratio, out);
    particle.life = Math.max(0.01, lerp(life[0], life[1], emitterRandom("particleLife")));
    particle.playback = Math.max(0.001, this.emitterValue(slot, "playbackRateScalar", ratio, out)[0]);
    const speed = this.emitterValue(slot, "speedScalar", ratio, out);
    const speedScalar = lerp(speed[0], speed[1], emitterRandom("speedScalar"));
    const size = this.emitterValue(slot, "sizeScalar", ratio, out);
    particle.sizeScalar = [size[0] / 100, size[1] / 100, size[2] / 100];
    const accn = this.emitterValue(slot, "accnScalar", ratio, out);
    particle.accnScalar = [accn[0] / 100, accn[1] / 100, accn[2] / 100];
    const damp = this.emitterValue(slot, "dampeningScalar", ratio, out);
    particle.dampScalar = [damp[0] / 100, damp[1] / 100, damp[2] / 100];

    const zoom = this.effectZoom() * slot.zoom;
    particle.zoom = zoom;

    /*
     * Точка рождения и скорость — в пространстве эффекта, затем в мир.
     * Скорость — единичное направление на точку цели, умноженное на
     * speedScalar (м/с) и масштаб: у расстояния до цели и скорости в данных
     * игры нет связи, а ненормированный вектор давал бы брызгам 50 м/с.
     */
    const creation = slot.emitter.creation;
    const local = creation
      ? sampleDomain(creation, this.domainValues(slot, creation, ratio), zoom, next)
      : [0, 0, 0];
    const target = slot.emitter.target;
    const velocityLocal = [0, 0, 0];
    if (target) {
      const aim = sampleDomain(target, this.domainValues(slot, target, ratio), zoom, next);
      const direction = target.pointRelative
        ? aim
        : [aim[0] - local[0], aim[1] - local[1], aim[2] - local[2]];
      const length = Math.hypot(direction[0], direction[1], direction[2]);
      if (length > 1e-6) {
        const scale = (speedScalar * zoom) / length;
        velocityLocal[0] = direction[0] * scale;
        velocityLocal[1] = direction[1] * scale;
        velocityLocal[2] = direction[2] * scale;
      }
    }
    if (creation?.worldSpace) {
      particle.position = [
        this.frame.origin[0] + local[0],
        this.frame.origin[1] + local[1],
        this.frame.origin[2] + local[2],
      ];
    } else {
      toWorld(particle.position, this.frame, local);
    }
    if (target?.worldSpace) particle.velocity = velocityLocal;
    else directionToWorld(particle.velocity, this.frame, velocityLocal);

    /* Кадр листа: случайный в [TexFrameIDMin, TexFrameIDMax]. */
    const [frameMin, frameMax] = slot.rule.frames;
    particle.frame0 = Math.min(frameMax, Math.floor(lerp(frameMin, frameMax + 1, next())));
    const sprite = slot.rule.behaviours.find((item) => item.type === "Sprite");
    if (sprite) {
      particle.flipU = next() < (Number(sprite.FlipChanceU) || 0);
      particle.flipV = next() < (Number(sprite.FlipChanceV) || 0);
    }
    const rotation = slot.rule.behaviours.find((item) => item.type === "Rotation");
    if (rotation) {
      const min = this.particleValue(particle, rotation.InitialAngleMinKFP, 0, new Float32Array(4));
      const max = this.particleValue(particle, rotation.InitialAngleMaxKFP, 0, new Float32Array(4));
      for (let axis = 0; axis < 3; axis += 1)
        particle.angle[axis] = lerp(min[axis], max[axis], randomOf(particle, rotation.InitialAngleMinKFP, axis));
      particle.initialAngle = [...particle.angle];
    }
    slot.particles.push(particle);
    this.updateParticle(particle, 0);
  }

  /** Свойство поведения частицы в момент её жизни `t` (с эволюциями события). */
  particleValue(particle, property, t, out, fallback = ZERO4) {
    const evolved = property ? particle.slot.event.evolutions.evolved.get(property.name) : null;
    return sampleProperty(property?.track, fallback, evolved, this.evolutions, t, out);
  }

  /*
   * Диапазон мин…макс поведения: общая случайная величина (если
   * `proportional`) или своя на каждый компонент.
   */
  particleRange(particle, minProp, maxProp, t, proportional, out, fallback = ZERO4) {
    const low = this.particleValue(particle, minProp, t, new Float32Array(4), fallback);
    const high = maxProp ? this.particleValue(particle, maxProp, t, new Float32Array(4), fallback) : low;
    for (let c = 0; c < 4; c += 1) {
      const r = randomOf(particle, minProp || maxProp, proportional ? 0 : c);
      out[c] = lerp(low[c], high[c], r);
    }
    return out;
  }

  /** Шаг жизни частицы на `dt` секунд её собственного времени. */
  updateParticle(particle, dt) {
    const rule = particle.rule;
    particle.age += dt;
    const t = clamp01(particle.age / particle.life);
    if (particle.age >= particle.life) {
      particle.alive = false;
      return;
    }
    const tmp = new Float32Array(4);
    let integrates = false;
    for (const behaviour of rule.behaviours) {
      switch (behaviour.type) {
        case "Acceleration": {
          const accel = this.particleRange(particle, behaviour.XYZMinKFP, behaviour.XYZMaxKFP, t, false, tmp);
          let ax = accel[0];
          let ay = accel[1];
          let az = accel[2];
          if (Number(behaviour.IsAffectedByZoom) === 1) {
            ax *= particle.zoom;
            ay *= particle.zoom;
            az *= particle.zoom;
          }
          let world = [ax, ay, az];
          if (Number(behaviour.ReferenceSpace) === 1) world = directionToWorld([0, 0, 0], this.frame, world);
          if (Number(behaviour.EnableGravity) === 1) world[2] -= SEMANTICS.gravity;
          particle.velocity[0] += world[0] * particle.accnScalar[0] * dt;
          particle.velocity[1] += world[1] * particle.accnScalar[1] * dt;
          particle.velocity[2] += world[2] * particle.accnScalar[2] * dt;
          break;
        }
        case "Dampening": {
          const damp = this.particleRange(particle, behaviour.XYZMinKFP, behaviour.XYZMaxKFP, t, false, tmp);
          for (let axis = 0; axis < 3; axis += 1) {
            const k = Math.max(0, damp[axis] * particle.dampScalar[axis]);
            particle.velocity[axis] *= Math.exp(-k * dt);
          }
          break;
        }
        case "Velocity":
          integrates = true;
          break;
        case "Rotation": {
          /* AccumulateAngle: дорожка — скорость (°/с); иначе — угол поверх начального. */
          const value = this.particleRange(particle, behaviour.AngleMinKFP, behaviour.AngleMaxKFP, t, false, tmp);
          const accumulate = Number(behaviour.AccumulateAngle ?? 1) === 1;
          for (let axis = 0; axis < 3; axis += 1)
            particle.angle[axis] = accumulate
              ? particle.angle[axis] + value[axis] * dt
              : (particle.initialAngle?.[axis] || 0) + value[axis];
          break;
        }
        case "Size": {
          const whd = this.particleRange(particle, behaviour.WhdMinKFP, behaviour.WhdMaxKFP, t, Number(behaviour.IsProportional) === 1, tmp);
          particle.size[0] = whd[0] * particle.sizeScalar[0] * particle.zoom;
          particle.size[1] = whd[1] * particle.sizeScalar[1] * particle.zoom;
          particle.size[2] = whd[2] * particle.sizeScalar[2] * particle.zoom;
          if (this.aspectOf && Number(behaviour.IsProportional) === 1) {
            const aspect = this.aspectOf(String(rule.textures?.diffuse || "").toLowerCase());
            if (Number.isFinite(aspect) && aspect > 0)
              particle.size[1] = whd[0] * particle.sizeScalar[1] * particle.zoom * aspect;
          }
          const tblr = this.particleValue(particle, behaviour.TblrScalarKFP, t, new Float32Array(4), ONE4);
          particle.tblr = [tblr[0], tblr[1], tblr[2], tblr[3]];
          const vel = this.particleValue(particle, behaviour.TblrVelScalarKFP, t, new Float32Array(4), ZERO4);
          particle.tblrVel = [vel[0], vel[1], vel[2], vel[3]];
          break;
        }
        case "Colour": {
          const proportional = Number(behaviour.RGBAProportional) === 1;
          const maxEnabled = Number(behaviour.RGBAMaxEnable) === 1;
          const colour = this.particleRange(
            particle,
            behaviour.RGBAMinKFP,
            maxEnabled ? behaviour.RGBAMaxKFP : null,
            t,
            proportional,
            tmp,
            ONE4,
          );
          /* Оттенок правила, события и вызывающего красит только частицы
             с RGBCanTint (у RAGE — bAllowColorOverride). */
          if (Number(behaviour.RGBCanTint) === 1) {
            const tint = particle.slot.tint;
            const effectTint = this.effectTint();
            for (let c = 0; c < 4; c += 1) colour[c] *= tint[c] * effectTint[c] * this.tint[c];
          }
          particle.colour = [colour[0], colour[1], colour[2], colour[3]];
          /* Свечение — диапазон мин…макс в одной дорожке (x, y). */
          const glow = behaviour.EmissiveIntensityKFP;
          if (glow?.track) {
            const range = this.particleValue(particle, glow, t, tmp);
            particle.emissive = lerp(range[0], range[1], randomOf(particle, glow));
          } else {
            particle.emissive = 0;
          }
          break;
        }
        case "AnimateTexture":
          this.animate(particle, behaviour, t);
          break;
        /*
         * Поведения роя (задача 5 ТЗ 05.10.2026): без них бабочки и
         * мотыльки уплывали по прямой, лепестки и снег падали по линейке и
         * проваливались в асфальт. Числа — дорожки правила игры; что
         * оценено, а не сверено с игрой, — сказано рядом.
         */
        case "Noise": {
          /* Дрожь (ptxu_Noise): каждый шаг — свой толчок положения и
             скорости в пределах дорожек; шаг — от зерна частицы. */
          const step = (particle.noiseStep = (particle.noiseStep || 0) + 1);
          const jitter = (axis, salt) => unitHash(particle.seed, 0x6000 + step * 8 + salt + axis) * 2 - 1;
          const shove = this.particleRange(particle, behaviour.PosNoiseMinKFP, behaviour.PosNoiseMaxKFP, t, false, tmp);
          /* Толчок положения — на кадр 30 к/с: окно может шагать чаще. */
          const share = Math.min(1, dt * 30);
          for (let axis = 0; axis < 3; axis += 1) particle.position[axis] += jitter(axis, 0) * shove[axis] * share;
          const sway = this.particleRange(particle, behaviour.VelNoiseMinKFP, behaviour.VelNoiseMaxKFP, t, false, new Float32Array(4));
          for (let axis = 0; axis < 3; axis += 1) particle.position[axis] += jitter(axis, 4) * sway[axis] * dt;
          break;
        }
        case "Attractor": {
          /* Притяжение к домену притяжения эмиттера (ptxu_Attractor);
             домен у доноров вращается — к притяжению добавлено кружение
             вокруг вертикали (доля 0,5 — оценка по кадрам игры). */
          const strength = this.particleRange(particle, behaviour.StrengthKFP, null, t, false, tmp)[0];
          if (!strength) break;
          const target = this.attractorPoint(particle.slot);
          const dx = target[0] - particle.position[0];
          const dy = target[1] - particle.position[1];
          const dz = target[2] - particle.position[2];
          particle.velocity[0] += (dx - dy * 0.5) * strength * dt;
          particle.velocity[1] += (dy + dx * 0.5) * strength * dt;
          particle.velocity[2] += dz * strength * dt;
          break;
        }
        case "Wind": {
          /* Ветер (ptxu_Wind): у игры — погода, у кадра — тихий ветер
             вызывающего (`wind`, м/с); без него — штиль. */
          const influence = this.particleRange(particle, behaviour.InfluenceKFP, null, t, false, tmp)[0];
          for (let axis = 0; axis < 3; axis += 1) particle.position[axis] += this.wind[axis] * influence * dt;
          break;
        }
        default:
          break;
      }
    }
    if (integrates && dt > 0) {
      particle.position[0] += particle.velocity[0] * dt;
      particle.position[1] += particle.velocity[1] * dt;
      particle.position[2] += particle.velocity[2] * dt;
    }
    /* Земля вызывающего (`ground`, высота мира): с поведением Collision
       частица отскакивает (упругость и «покой» — дорожки правила), без
       него — гаснет у земли, а не уходит под асфальт. */
    if (this.ground !== null && particle.position[2] < this.ground) {
      const collision = rule.behaviours.find((item) => item.type === "Collision");
      if (!collision || unitHash(particle.seed, 0x7000 + (particle.noiseStep || 0)) * 100 < Number(collision.KillChance || 0)) {
        particle.alive = false;
        return;
      }
      const bounce = this.particleRange(particle, collision.BouncinessKFP, null, t, false, tmp)[0];
      particle.position[2] = this.ground;
      particle.velocity[2] = Math.abs(particle.velocity[2]) * Math.max(0, Math.min(1, bounce));
      particle.velocity[0] *= 0.7;
      particle.velocity[1] *= 0.7;
      if (Math.hypot(...particle.velocity) < Number(collision.RestSpeed || 0)) particle.velocity.fill(0);
    }
    if (!rule.behaviours.some((item) => item.type === "AnimateTexture")) {
      particle.frame = particle.frame0;
      particle.frameBlend = 0;
    }
  }

  /*
   * Листание кадров. `IsScaledOverParticleLife` — от кадра рождения до
   * `LastFrameID` за всю жизнь частицы, скорость не участвует (у многих таких
   * правил игры дорожка скорости пуста); иначе — `animRate` кадров в секунду
   * времени частицы. После последнего кадра — держать его
   * (`IsHeldOnLastFrame`) или, при `LoopMode` 0, идти по кругу от первого
   * кадра правила. `IsRandomised` — на каждом шаге случайный кадр диапазона.
   */
  animate(particle, behaviour, t) {
    const rate = this.particleValue(particle, behaviour.AnimRateKFP, t, new Float32Array(4), ZERO4);
    const fps = lerp(rate[0], rate[1], randomOf(particle, behaviour.AnimRateKFP));
    const first = particle.frame0;
    const base = Math.min(particle.rule.frames[0], first);
    const last = Math.max(first, Number(behaviour.LastFrameID) >= 0 ? Number(behaviour.LastFrameID) : first);
    const blending = Number(behaviour.DoFrameBlending) === 1;
    if (Number(behaviour.IsRandomised) === 1) {
      const step = Math.floor(fps * particle.age);
      const span = last - base + 1;
      particle.frame = base + Math.floor(unitHash(particle.seed, 0x4000 + step) * span);
      particle.frameBlend = 0;
      return;
    }
    let frame =
      Number(behaviour.IsScaledOverParticleLife) === 1
        ? first + t * (last - first + 1)
        : first + fps * particle.age;
    const held = Number(behaviour.IsHeldOnLastFrame) === 1;
    const loops = !held && Number(behaviour.LoopMode) === 0;
    if (frame >= last + 1 || (held && frame > last)) {
      if (loops) {
        const span = last - base + 1;
        frame = base + ((frame - base) % span);
      } else {
        frame = last;
      }
    }
    const whole = Math.min(Math.floor(frame), last);
    particle.frame = whole;
    particle.frameBlend = blending && whole < last ? frame - whole : 0;
  }

  /**
   * Оттенок правила эффекта (`colourTintMin/Max`) в текущий миг; пусто —
   * белый. С эволюциями правила, как у `zoomScalar`: у дыма из-под колёс
   * (`wheel_burnout`) прозрачность оттенка — ноль, видимым дым делает только
   * эволюция `speed`, и без неё дым игры в кадре не появлялся вовсе.
   */
  effectTint() {
    const rule = this.rule;
    if (!rule.props.colourTintMin?.track) return ONE4;
    const evolvedOf = (property) => rule.evolutions.evolved.get(property.name) || null;
    const min = rule.props.colourTintMin;
    const low = sampleProperty(min.track, ONE4, evolvedOf(min), this.evolutions, this.ratio, new Float32Array(4));
    if (!rule.colourTintMaxEnable || !rule.props.colourTintMax?.track) return low;
    const max = rule.props.colourTintMax;
    const high = sampleProperty(max.track, ONE4, evolvedOf(max), this.evolutions, this.ratio, new Float32Array(4));
    const r = this.zoomRandom;
    return [lerp(low[0], high[0], r), lerp(low[1], high[1], r), lerp(low[2], high[2], r), lerp(low[3], high[3], r)];
  }

  /**
   * Шаг эффекта на `dt` секунд окна. Время эффекта идёт с его скоростью,
   * время частиц — ещё и со скоростью события и эмиттера.
   */
  step(dt) {
    let remaining = Math.max(0, dt);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, SEMANTICS.maxStep);
      remaining -= step;
      this.advance(step);
    }
  }

  advance(dt) {
    let effectDt = dt * this.playback;
    /*
     * Зацикленный экземпляр: дойдя до конца правила, время начинается
     * заново, разовые эмиттеры взводятся снова, а живые частицы доживают
     * своё — рой не гаснет и не рождается с нуля на каждом круге.
     */
    while (this.looping && this.time + effectDt >= this.duration && this.moreLoops()) {
      const room = Math.max(0, this.duration - this.time);
      this.run(room);
      effectDt -= room;
      this.time = 0;
      this.loop += 1;
      for (const slot of this.events) slot.fired = false;
      if (effectDt <= 1e-9) break;
    }
    this.run(effectDt);
    this.finished =
      !this.moreLoops() &&
      this.time >= this.duration &&
      this.events.every((slot) => !slot.particles.length);
  }

  /* Остались ли круги у зацикленного экземпляра (−1 — без конца). */
  moreLoops() {
    if (!this.looping) return false;
    return this.rule.loops < 0 || this.loop < this.rule.loops;
  }

  /* Шаг времени эффекта внутри одного круга. */
  run(effectDt) {
    const before = this.ratio;
    this.time += effectDt;
    const after = this.ratio;
    for (const slot of this.events) {
      const { start, end } = slot.event;
      const span = Math.max(end - start, 1e-6);
      const eventDt = effectDt * slot.playback;
      if (slot.emitter.oneShot) {
        /* Разовый эмиттер: всё число частиц — в момент включения. */
        if (!slot.fired && after >= start && before <= Math.max(start, end)) {
          slot.fired = true;
          const rate = this.emitterValue(slot, "spawnRateOverTime", 0, this.scratch);
          const count = Math.round(lerp(rate[0], rate[1], unitHash(slot.seed, 0x51)));
          const cap = Math.max(0, Math.round(rate[2]));
          for (let i = 0; i < count; i += 1) this.spawn(slot, 0, cap);
        }
      } else if (after > start && before < end) {
        const ratio = clamp01((after - start) / span);
        const rate = this.emitterValue(slot, "spawnRateOverTime", ratio, this.scratch);
        const perSecond = lerp(rate[0], rate[1], unitHash(slot.seed, Math.floor(this.time * 30)));
        const cap = Math.max(0, Math.round(rate[2]));
        slot.pending += perSecond * eventDt;
        while (slot.pending >= 1) {
          slot.pending -= 1;
          this.spawn(slot, ratio, cap);
        }
      }
      for (const particle of slot.particles)
        this.updateParticle(particle, eventDt * particle.playback);
      if (slot.particles.some((particle) => !particle.alive))
        slot.particles = slot.particles.filter((particle) => particle.alive);
    }
  }

  /** Живые частицы по событиям — в порядке таймлайна. */
  *slots() {
    for (const slot of this.events) if (slot.particles.length) yield slot;
  }
}
