/*
 * Клон правила эффекта — тот же, что собирает установщик.
 *
 * Установка кладёт в ядро игрока не правило донора, а его клон: слои из
 * нескольких доноров, оставленные части, подменённые листы, перекраска,
 * множители густоты и размера, прицел, дальность. Это делает помощник RPF
 * (`tools/rpf-helper/YptEffectClones.cs`). Окно обязано показывать ровно то,
 * что окажется в игре, поэтому здесь — перенос той же сборки один в один,
 * только над выгрузкой правил (`ypt-rule-export`), а не над двоичным ядром:
 * те же проверки заказа, тот же порядок шагов, те же имена правил клона.
 *
 * Сверка с помощником — `node scripts/probe-effect-clones.mjs`: один и тот
 * же заказ собирается здесь и в C# на ядре игрока, и числа сравниваются.
 */

const CLONE_NAME = /^astral_[a-z0-9_]{1,48}$/;
const DONOR_NAME = /^[A-Za-z0-9_]{1,64}$/;
const SCALE_PROP = /^ptx(EmitterRule|CreationDomain|TargetDomain|AttractorDomain):m_[A-Za-z]{1,48}$/;
const PROP_NAME = /^ptx[A-Za-z_]{1,40}:m_[A-Za-z]{1,48}$/;
const MAX_LAYERS = 8;
/* Событий у правила игра играет не больше семи: восьмое роняло её на
   попадании (см. `YptEffectClones.MaxEventEmitters`). */
const MAX_EVENT_EMITTERS = 7;
const MAX_KEYFRAMES = 16;
const RAINBOW_STEPS = 8;
const COLOUR_MODES = Object.freeze(["recolour", "duo", "rainbow"]);
const LOD_EVOLUTION = "LOD";
const IMPORTED_TEXTURE_PREFIX = "astral_impact_tex_";

const SPAWN_RATE = "ptxemitterrule:m_spawnrateovertimekfp";
const SIZE_SCALAR = "ptxemitterrule:m_sizescalarkfp";
const ZOOM_SCALAR = "ptxeffectrule:m_zoomscalarkfp";
const COLOUR_MIN = "ptxu_colour:m_rgbaminkfp";
const COLOUR_MAX = "ptxu_colour:m_rgbamaxkfp";
const EMISSIVE = "ptxu_colour:m_emissiveintensitykfp";
const DIFFUSE = "diffusetex2";
/* Свойства эмиттера в процентах по осям X, Y, Z (W — сотня). */
const PERCENT_SCALARS = Object.freeze([
  "ptxemitterrule:m_accnscalarkfp",
  "ptxemitterrule:m_dampeningscalarkfp",
  "ptxemitterrule:m_sizescalarkfp",
  "ptxemitterrule:m_matrixweightscalarkfp",
]);

const list = (value) => (Array.isArray(value) ? value : []);
const same = (left, right) => String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const copy = (value) => (value == null ? value : structuredClone(value));

function bounded(value, min, max, label, effect) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`YPT clone ${label} is out of range for ${effect}: ${value}`);
  return number;
}

/** Имя, под которым текстура чужого словаря живёт в ядре (как у помощника). */
export function importedTextureName(original) {
  let name = String(original || "").trim().toLowerCase();
  if (name.startsWith("ptfx_")) name = name.slice(5);
  const imported = IMPORTED_TEXTURE_PREFIX + name.replace(/[^a-z0-9_]/g, "_");
  if (!CLONE_NAME.test(imported))
    throw new Error(`YPT donor texture name cannot be imported: ${original}`);
  return imported;
}

/* Свойство (KFP) — объект выгрузки с именем и кадрами. */
const isProperty = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) && "Keyframes" in value && "Name" in value;

/** Все свойства поведения частицы. */
function behaviourProperties(behaviour) {
  return Object.values(behaviour || {}).filter(isProperty);
}

/** Свои свойства эмиттера и по четыре у каждой его области. */
function emitterProperties(emitter) {
  const owned = [...list(emitter?.KeyframeProps)];
  for (const key of ["CreationDomainObj", "TargetDomainObj", "AttractorDomainObj"]) {
    const domain = emitter?.[key];
    if (!domain) continue;
    for (const part of ["PositionKFP", "RotationKFP", "SizeOuterKFP", "SizeInnerKFP"])
      if (domain[part]) owned.push(domain[part]);
  }
  return owned.filter(isProperty);
}

/** Кадры эволюций события по имени свойства. */
function* evolvedFrames(event, name) {
  for (const evolved of list(event?.EvolutionList?.EvolvedKeyframeProps)) {
    if (!evolved || (name && !same(evolved.Name, name))) continue;
    for (const item of list(evolved.Items)) if (item?.Keyframes) yield { evolved, item };
  }
}

function scaleXY(frames, factor) {
  let count = 0;
  for (const frame of list(frames)) {
    frame[1] *= factor;
    frame[2] *= factor;
    count += 1;
  }
  return count;
}

function scaleAxes(frames, factor, axes) {
  if (axes === 2) return scaleXY(frames, factor);
  let count = 0;
  for (const frame of list(frames)) {
    frame[1] *= factor;
    frame[2] *= factor;
    frame[3] *= factor;
    count += 1;
  }
  return count;
}

/*
 * Перекраска кадра: тон — от заказанного цвета, яркость — старший канал
 * кадра; прозрачность — множителем.
 */
function repaint(frames, colour, alpha) {
  let count = 0;
  for (const frame of list(frames)) {
    if (colour) {
      const intensity = Math.max(frame[1], frame[2], frame[3]);
      frame[1] = clamp(colour[0] * intensity, 0, 1);
      frame[2] = clamp(colour[1] * intensity, 0, 1);
      frame[3] = clamp(colour[2] * intensity, 0, 1);
    }
    if (alpha != null) frame[4] = clamp(frame[4] * alpha, 0, 1);
    count += 1;
  }
  return count;
}

/** Значение кадров во время `time` — по прямой между соседями. */
function sample(frames, time) {
  const ordered = [...frames].sort((left, right) => left[0] - right[0]);
  if (time <= ordered[0][0]) return ordered[0].slice(1);
  for (let index = 1; index < ordered.length; index += 1) {
    const next = ordered[index];
    if (time > next[0]) continue;
    const previous = ordered[index - 1];
    const span = next[0] - previous[0];
    const amount = span > 1e-6 ? (time - previous[0]) / span : 1;
    return [1, 2, 3, 4].map((c) => previous[c] + (next[c] - previous[c]) * amount);
  }
  return ordered[ordered.length - 1].slice(1);
}

/** Чистый тон радуги с заданной яркостью — как `Hue` помощника. */
function hue(value, brightness) {
  const sector = value * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const rising = brightness * fraction;
  const falling = brightness * (1 - fraction);
  return [
    [brightness, rising, 0],
    [falling, brightness, 0],
    [0, brightness, rising],
    [0, falling, brightness],
    [rising, 0, brightness],
    [brightness, 0, falling],
  ][index];
}

/* Радуга: восемь ступеней тона за жизнь, яркость и прозрачность — донора. */
function rainbow(holder, offset, alpha) {
  const source = list(holder?.Keyframes).filter(Boolean);
  if (!source.length) return 0;
  const frames = [];
  for (let step = 0; step < RAINBOW_STEPS; step += 1) {
    const time = step / (RAINBOW_STEPS - 1);
    const sampled = sample(source, time);
    const intensity = Math.max(sampled[0], sampled[1], sampled[2]);
    const opacity = alpha != null ? clamp(sampled[3] * alpha, 0, 1) : sampled[3];
    frames.push([time, ...hue((time + offset) % 1, intensity), opacity]);
  }
  holder.Keyframes = frames;
  return frames.length;
}

/* Прицел: отклонить точку цели от её оси и провернуть вокруг неё. */
function aimDomain(frames, yaw, pitch) {
  let count = 0;
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  for (const frame of list(frames)) {
    let axis = [frame[1], frame[2], frame[3]];
    const length = Math.hypot(...axis);
    if (length < 1e-5) continue;
    axis = axis.map((value) => value / length);
    const seed = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    let right = cross(axis, seed);
    const size = Math.hypot(...right);
    right = right.map((value) => value / size);
    const up = cross(axis, right);
    const tilt = Math.sin(pitchRad);
    const forward = Math.cos(pitchRad);
    const side = Math.cos(yawRad) * tilt;
    const lift = Math.sin(yawRad) * tilt;
    for (let c = 0; c < 3; c += 1)
      frame[c + 1] = (axis[c] * forward + right[c] * side + up[c] * lift) * length;
    count += 1;
  }
  return count;
}

/* Кадры свойства из заказа: [время, x, y, z, w], время растёт от нуля. */
function setKeyframes(target, values, effect) {
  const frames = [];
  let previous = -1;
  values.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== 5)
      throw new Error(`YPT clone keyframe must be [time, x, y, z, w]: ${effect}`);
    const time = Number(row[0]);
    if (time < 0 || time > 1 || time <= previous)
      throw new Error(`YPT clone keyframe times must rise within 0…1: ${effect}`);
    if (index === 0 && time !== 0)
      throw new Error(`YPT clone keyframes must start at zero: ${effect}`);
    for (const number of row)
      if (!(Number(number) >= -100000 && Number(number) <= 100000))
        throw new Error(`YPT clone keyframe value is out of range: ${effect}`);
    frames.push(row.map(Number));
    previous = time;
  });
  target.Keyframes = frames;
}

/** Масштаб уровня правила: первый кадр zoomScalar, проценты. */
function effectZoomOf(rule) {
  const property = list(rule?.KeyframeProps).find((item) => same(item?.Name, ZOOM_SCALAR));
  const zoom = property?.Keyframes?.[0]?.[1];
  return Number(zoom) > 0 ? Number(zoom) : 100;
}

/** Слои заказа: названные или единственный из полей самого заказа. */
function layersOf(clone) {
  if (Array.isArray(clone.layers) && clone.layers.length) {
    if (clone.donorEffect != null || clone.keepParticles != null || clone.textures != null)
      throw new Error(`YPT clone ${clone.effect} names both layers and a single donor.`);
    return clone.layers;
  }
  if (!clone.donorEffect) throw new Error(`YPT clone ${clone.effect} names no donor effect rule.`);
  return [
    {
      donorEffect: clone.donorEffect,
      keepParticles: clone.keepParticles,
      textures: clone.textures,
      tune: clone.tune,
    },
  ];
}

function findSwap(swaps, donorParticle, donorTexture) {
  for (const swap of list(swaps)) {
    if (!swap) continue;
    const byParticle = list(swap.particles).includes(donorParticle || "");
    const byTexture = Boolean(swap.donorTexture) && same(swap.donorTexture, donorTexture);
    if (byParticle || byTexture) return swap;
  }
  return null;
}

function applyFrames(particle, swap, effect) {
  if (Number.isInteger(swap.frameMin)) particle.TexFrameIDMin = Math.max(0, swap.frameMin);
  if (Number.isInteger(swap.frameMax)) particle.TexFrameIDMax = Math.max(0, swap.frameMax);
  if (Number(particle.TexFrameIDMax) < Number(particle.TexFrameIDMin))
    throw new Error(`YPT clone frames are out of order: ${effect}`);
  const touches =
    swap.lastFrame != null || swap.loopMode != null || swap.scaledOverLife != null || swap.randomised != null;
  if (!touches) return;
  for (const behaviour of list(particle.AllBehaviours)) {
    if (behaviour?.Type !== "AnimateTexture") continue;
    if (Number.isInteger(swap.lastFrame)) behaviour.LastFrameID = swap.lastFrame;
    if (Number.isInteger(swap.loopMode)) behaviour.LoopMode = swap.loopMode;
    if (typeof swap.scaledOverLife === "boolean") behaviour.IsScaledOverParticleLife = swap.scaledOverLife ? 1 : 0;
    if (typeof swap.randomised === "boolean") behaviour.IsRandomised = swap.randomised ? 1 : 0;
  }
}

/**
 * Слой клона: копия донора под именами клона, оставленные события, свои
 * эмиттеры и частицы, подмены листов и настройка слоя.
 */
function buildLayer(sources, effect, layerIndex, layer, coreTextures) {
  const foreign = Boolean(layer.donorFile);
  const source = foreign ? sources[layer.donorFile] : sources.core;
  if (!source) throw new Error(`YPT clone donor file is not loaded: ${layer.donorFile || "core"}`);
  const donor = source.effects?.[layer.donorEffect];
  if (!donor) throw new Error(`YPT donor effect rule does not exist: ${layer.donorEffect}`);
  const rule = copy(donor);
  const donorEvents = list(donor.EventEmitters);

  const keepNames = Array.isArray(layer.keepParticles) && layer.keepParticles.length ? new Set(layer.keepParticles) : null;
  const keptIndices = [];
  donorEvents.forEach((item, index) => {
    if (!item?.ParticleRule || !item?.EmitterRule) return;
    if (!source.particles?.[item.ParticleRule] || !source.emitters?.[item.EmitterRule]) return;
    if (!keepNames || keepNames.has(item.ParticleRule)) keptIndices.push(index);
  });
  if (!keptIndices.length)
    throw new Error(`YPT donor effect ${layer.donorEffect} emits none of the requested particle rules.`);
  if (keepNames) {
    const found = new Set(keptIndices.map((index) => donorEvents[index].ParticleRule));
    const missing = [...keepNames].filter((name) => !found.has(name));
    if (missing.length)
      throw new Error(`YPT donor effect ${layer.donorEffect} does not emit particle rule ${missing.join(", ")}.`);
  }
  const kept = keptIndices.map((index) => rule.EventEmitters[index]);
  rule.EventEmitters = kept;

  /* Свои эмиттеры и частицы: по одной копии на имя донора. */
  const emitterOrder = [];
  const particleOrder = [];
  for (const item of kept) {
    if (!emitterOrder.includes(item.EmitterRule)) emitterOrder.push(item.EmitterRule);
    if (!particleOrder.includes(item.ParticleRule)) particleOrder.push(item.ParticleRule);
  }
  const prefix = layerIndex === 0 ? effect : `${effect}_l${layerIndex}`;
  if (layerIndex === 0) rule.Name = effect;
  const emitters = new Map();
  const particles = new Map();
  const donorOfParticle = new Map();
  emitterOrder.forEach((name, index) => {
    const clone = copy(source.emitters[name]);
    clone.Name = `${prefix}_e${index}`;
    emitters.set(name, clone);
  });
  particleOrder.forEach((name, index) => {
    const clone = copy(source.particles[name]);
    clone.Name = `${prefix}_p${index}`;
    particles.set(name, clone);
    donorOfParticle.set(clone, name);
  });
  const donorParticleOfEvent = new Map();
  for (const item of kept) {
    donorParticleOfEvent.set(item, item.ParticleRule);
    item.EmitterRule = emitters.get(item.EmitterRule).Name;
    item.ParticleRule = particles.get(item.ParticleRule).Name;
  }

  /* Листы: подмены заказа; у чужого донора — общий лист ядра или перенос. */
  const textureNames = [];
  const imported = [];
  for (const [donorName, particle] of particles) {
    const original = source.particles[donorName];
    const spawned = original.EffectSpawnerAtRatio?.EffectRule || original.EffectSpawnerOnCollision?.EffectRule;
    if (foreign && spawned)
      throw new Error(
        `YPT donor ${layer.donorEffect} spawns effect ${spawned} from another file; only self-contained donors can be borrowed.`,
      );
    if (foreign && list(original.Drawables).length)
      throw new Error(
        `YPT donor ${layer.donorEffect} draws models from another file; only sprite donors can be borrowed.`,
      );
    for (const variable of list(particle.ShaderVars)) {
      if (variable?.Type !== "Texture") continue;
      const textureName = variable.TextureName || "";
      const present = Boolean(textureName) && !same(textureName, "None");
      const swap = same(variable.Name, DIFFUSE) && present ? findSwap(layer.textures, donorName, textureName) : null;
      if (swap) {
        if (!CLONE_NAME.test(swap.texture || ""))
          throw new Error(`YPT clone texture must live in the astral_ namespace: ${swap.texture}`);
        variable.TextureName = swap.texture;
        if (!textureNames.some((name) => same(name, swap.texture))) textureNames.push(swap.texture);
        applyFrames(particle, swap, effect);
        continue;
      }
      if (!foreign || !present) continue;
      if (coreTextures.has(textureName.toLowerCase())) continue;
      const name = importedTextureName(textureName);
      variable.TextureName = name;
      if (!textureNames.some((item) => same(item, name))) textureNames.push(name);
      if (!imported.some((item) => same(item.texture, name))) imported.push({ texture: name, source: textureName });
    }
  }
  for (const swap of list(layer.textures))
    if (!textureNames.some((name) => same(name, swap?.texture)))
      throw new Error(`YPT clone ${effect} has no particle drawing the texture to replace with ${swap?.texture}.`);

  const context = {
    rule,
    kept,
    emitters: [...emitters.values()],
    particles: [...particles.values()],
    donorOfParticle,
    donorParticleOfEvent,
    label: effect,
  };
  const report = applyTune(context, layer.tune);
  return { rule, kept, emitters: context.emitters, particles: context.particles, textureNames, imported, report, donor: layer.donorEffect };
}

function applyTune(context, tune) {
  const { rule, kept, emitters, particles, donorOfParticle, donorParticleOfEvent, label } = context;
  const report = { recoloured: 0, spawn: 0, replaced: 0, scaled: 0 };
  if (!tune) return report;

  if (tune.maxDuration != null) {
    const limit = bounded(tune.maxDuration, 0.05, 30, "maxDuration", label);
    rule.DurationMin = Math.min(Number(rule.DurationMin), limit);
    rule.DurationMax = Math.min(Number(rule.DurationMax), limit);
  }
  if (tune.cullDist != null)
    rule.DistanceCullingCullDist = Math.max(
      Number(rule.DistanceCullingCullDist),
      bounded(tune.cullDist, 5, 1000, "cullDist", label),
    );
  if (tune.cullFade != null)
    rule.DistanceCullingFadeDist = Math.min(
      Number(rule.DistanceCullingCullDist),
      Math.max(Number(rule.DistanceCullingFadeDist), bounded(tune.cullFade, 5, 1000, "cullFade", label)),
    );

  if (tune.effectZoom != null) {
    const value = bounded(tune.effectZoom, 1, 1000, "effectZoom", label);
    const property = list(rule.KeyframeProps).find((item) => same(item?.Name, ZOOM_SCALAR));
    if (!list(property?.Keyframes).length)
      throw new Error(`YPT clone ${label} has no rule zoom keyframes to set.`);
    for (const frame of property.Keyframes) {
      frame[1] = value;
      frame[2] = value;
    }
  }

  if (tune.zoomScale != null) {
    const factor = bounded(tune.zoomScale, 0.05, 8, "zoomScale", label);
    for (const item of kept) {
      item.ZoomScalarMin = Number(item.ZoomScalarMin) * factor;
      item.ZoomScalarMax = Number(item.ZoomScalarMax) * factor;
    }
  }

  if (typeof tune.oneShot === "boolean") for (const emitter of emitters) emitter.IsOneShot = tune.oneShot ? 1 : 0;

  /* Подводный донор на суше: гасить под водой, а не над ней (YptEffectClones, OpenAir).
     Движок окна ZCull не считает, но выгрузка клона обязана совпасть с установщиком. */
  if (tune.openAir === true)
    for (const particle of particles)
      for (const behaviour of list(particle.AllBehaviours))
        if (behaviour?.Type === "ZCull" && behaviour.CullMode === 1 && behaviour.ReferenceSpace === 3)
          behaviour.CullMode = 0;

  if (tune.spawnScale != null) {
    const factor = bounded(tune.spawnScale, 0.1, 8, "spawnScale", label);
    for (const emitter of emitters)
      for (const property of list(emitter.KeyframeProps))
        if (same(property?.Name, SPAWN_RATE)) report.spawn += scaleXY(property.Keyframes, factor);
    for (const item of kept)
      for (const { item: frames } of evolvedFrames(item, SPAWN_RATE)) report.spawn += scaleXY(frames.Keyframes, factor);
  }

  const colourOf = (value, name) =>
    Array.isArray(value) && value.length === 3 ? value.map((channel) => bounded(channel, 0, 4, name, label)) : null;
  const colour = colourOf(tune.colour, "colour");
  if (tune.colour != null && !colour) throw new Error(`YPT clone colour must have three channels: ${label}`);
  const mode = tune.colourMode || "recolour";
  if (!COLOUR_MODES.includes(mode)) throw new Error(`YPT clone colour mode is not supported: ${tune.colourMode}`);
  const colour2 = colourOf(tune.colour2, "colour2");
  if (tune.colour2 != null && !colour2) throw new Error(`YPT clone second colour must have three channels: ${label}`);
  if (mode === "duo" && (!colour || !colour2)) throw new Error(`YPT clone colour mode duo needs two colours: ${label}`);
  if (mode === "rainbow" && !colour) throw new Error(`YPT clone colour mode rainbow needs a colour: ${label}`);
  const alpha = tune.alphaScale != null ? bounded(tune.alphaScale, 0.05, 4, "alphaScale", label) : null;
  if (colour || alpha != null) {
    const upper = mode === "duo" ? colour2 : colour;
    const lightColour = mode === "rainbow" ? [1, 1, 1] : colour;
    for (const particle of particles)
      for (const behaviour of list(particle.AllBehaviours)) {
        if (behaviour?.Type === "Colour") {
          report.recoloured +=
            mode === "rainbow"
              ? rainbow(behaviour.RGBAMinKFP, 0, alpha) + rainbow(behaviour.RGBAMaxKFP, 0.5, alpha)
              : repaint(behaviour.RGBAMinKFP?.Keyframes, colour, alpha) +
                repaint(behaviour.RGBAMaxKFP?.Keyframes, upper, alpha);
        } else if (behaviour?.Type === "Light" && lightColour) {
          for (const key of ["RGBMinKFP", "RGBMaxKFP", "CoronaRGBMinKFP", "CoronaRGBMaxKFP"])
            report.recoloured += repaint(behaviour[key]?.Keyframes, lightColour, null);
        }
      }
    for (const item of kept)
      for (const { evolved, item: frames } of evolvedFrames(item, null)) {
        if (!same(evolved.Name, COLOUR_MIN) && !same(evolved.Name, COLOUR_MAX)) continue;
        const isUpper = same(evolved.Name, COLOUR_MAX);
        report.recoloured +=
          mode === "rainbow"
            ? rainbow(frames, isUpper ? 0.5 : 0, alpha)
            : repaint(frames.Keyframes, isUpper ? upper : colour, alpha);
      }
  }

  for (const part of list(tune.partColours)) {
    if (!part || !DONOR_NAME.test(part.particle || ""))
      throw new Error(`YPT clone part colour names no particle: ${label}`);
    if (!Array.isArray(part.colour) || part.colour.length !== 3)
      throw new Error(`YPT clone part colour must have three channels: ${part.particle}`);
    const tint = part.colour.map((value) => bounded(value, 0, 4, "part colour", label));
    let found = false;
    for (const particle of particles) {
      if (donorOfParticle.get(particle) !== part.particle) continue;
      found = true;
      for (const behaviour of list(particle.AllBehaviours)) {
        if (behaviour?.Type === "Colour") {
          report.recoloured += repaint(behaviour.RGBAMinKFP?.Keyframes, tint, null);
          report.recoloured += repaint(behaviour.RGBAMaxKFP?.Keyframes, tint, null);
        } else if (behaviour?.Type === "Light") {
          for (const key of ["RGBMinKFP", "RGBMaxKFP", "CoronaRGBMinKFP", "CoronaRGBMaxKFP"])
            report.recoloured += repaint(behaviour[key]?.Keyframes, tint, null);
        }
      }
    }
    if (!found) throw new Error(`YPT clone ${label} has no part ${part.particle} to colour.`);
    for (const item of kept) {
      if (donorParticleOfEvent.get(item) !== part.particle) continue;
      for (const { evolved, item: frames } of evolvedFrames(item, null))
        if (same(evolved.Name, COLOUR_MIN) || same(evolved.Name, COLOUR_MAX))
          report.recoloured += repaint(frames.Keyframes, tint, null);
    }
  }

  for (const patch of list(tune.keyframes)) {
    if (!patch || !PROP_NAME.test(patch.prop || ""))
      throw new Error(`YPT clone keyframe property is invalid: ${patch?.prop}`);
    if (!Array.isArray(patch.values) || patch.values.length < 1 || patch.values.length > MAX_KEYFRAMES)
      throw new Error(`YPT clone keyframe count is out of range: ${patch.prop}`);
    const targets = new Set();
    if (patch.scope === "emitter") {
      for (const item of kept) {
        if (patch.particle != null && donorParticleOfEvent.get(item) !== patch.particle) continue;
        const emitter = emitters.find((candidate) => candidate.Name === item.EmitterRule);
        for (const property of emitterProperties(emitter)) if (same(property.Name, patch.prop)) targets.add(property);
      }
    } else if (patch.scope === "particle") {
      for (const particle of particles) {
        if (patch.particle != null && donorOfParticle.get(particle) !== patch.particle) continue;
        for (const behaviour of list(particle.AllBehaviours))
          for (const property of behaviourProperties(behaviour))
            if (same(property.Name, patch.prop)) targets.add(property);
      }
    } else throw new Error(`YPT clone keyframe scope is invalid: ${patch.scope}`);
    if (!targets.size)
      throw new Error(`YPT clone ${label} has no keyframe property ${patch.prop} in scope ${patch.scope}.`);
    for (const target of targets) {
      setKeyframes(target, patch.values, label);
      report.replaced += 1;
    }
  }

  /* Свечение (ptxu_Colour:m_emissiveIntensityKFP): кадры частиц и их эволюций.
     У воздушного пакета машины оно целиком живёт в эволюции (YptEffectClones.cs). */
  if (tune.emissiveScale != null) {
    const factor = bounded(tune.emissiveScale, 0.05, 8, "emissiveScale", label);
    for (const particle of particles)
      for (const behaviour of list(particle.AllBehaviours))
        if (behaviour?.Type === "Colour") report.scaled += scaleXY(behaviour.EmissiveIntensityKFP?.Keyframes, factor);
    for (const item of kept)
      for (const { item: frames } of evolvedFrames(item, EMISSIVE)) report.scaled += scaleXY(frames.Keyframes, factor);
  }

  for (const scale of list(tune.scales)) {
    if (!scale || !SCALE_PROP.test(scale.prop || ""))
      throw new Error(`YPT clone scale property is invalid: ${scale?.prop}`);
    const factor = bounded(scale.factor, 0, 8, "scale", label);
    /* Проценты по осям — три оси (гравитация — ось Z ускорения); у скорости,
       жизни и густоты x и y — «от» и «до». */
    const percent = PERCENT_SCALARS.includes(scale.prop.toLowerCase());
    const axes = percent || scale.prop.includes("Domain:") ? 3 : 2;
    for (const emitter of emitters) {
      const owned = new Set(emitterProperties(emitter).filter((property) => same(property.Name, scale.prop)));
      for (const property of owned) {
        /* Пустое процентное свойство игра читает как 100 %: множитель — одним кадром. */
        if (percent && !list(property.Keyframes).length) {
          const value = 100 * factor;
          setKeyframes(property, [[0, value, value, value, 100]], label);
          report.scaled += 1;
          continue;
        }
        report.scaled += scaleAxes(property.Keyframes, factor, axes);
      }
    }
    for (const item of kept)
      for (const { item: frames } of evolvedFrames(item, scale.prop))
        report.scaled += scaleAxes(frames.Keyframes, factor, axes);
  }

  if (tune.aim) {
    const yaw = bounded(tune.aim.yaw, -180, 180, "aim yaw", label);
    const pitch = bounded(tune.aim.pitch, -90, 90, "aim pitch", label);
    for (const emitter of emitters)
      report.scaled += aimDomain(emitter.TargetDomainObj?.PositionKFP?.Keyframes, yaw, pitch);
  }
  return report;
}

/*
 * События всех слоёв — в одно правило первого слоя: темп и масштаб
 * остальных пересчитаны так, чтобы каждый слой выглядел как у своего донора.
 */
function merge(builds, effect) {
  const composite = builds[0].rule;
  const total = builds.reduce((sum, build) => sum + build.kept.length, 0);
  if (total > MAX_EVENT_EMITTERS)
    throw new Error(`YPT clone ${effect} would carry ${total} emitters; GTA plays at most ${MAX_EVENT_EMITTERS} per effect rule.`);
  if (builds.length > 1) {
    const durationMax = Math.max(...builds.map((build) => Number(build.rule.DurationMax)));
    const durationMin = Math.max(...builds.map((build) => Number(build.rule.DurationMin)));
    const zoom = effectZoomOf(composite);
    for (const build of builds) {
      const own = build.rule;
      const ratio = durationMax > 0 && own.DurationMax > 0 ? own.DurationMax / durationMax : 1;
      let playMin = composite.PlaybackRateScalarMin > 0 ? own.PlaybackRateScalarMin / composite.PlaybackRateScalarMin : 1;
      let playMax = composite.PlaybackRateScalarMax > 0 ? own.PlaybackRateScalarMax / composite.PlaybackRateScalarMax : 1;
      let scale = effectZoomOf(own) / zoom;
      if (own === composite) {
        playMin = 1;
        playMax = 1;
        scale = 1;
      }
      for (const item of build.kept) {
        item.StartRatio = clamp(Number(item.StartRatio) * ratio, 0, 1);
        item.EndRatio = clamp(Number(item.EndRatio) * ratio, 0, 1);
        item.PlaybackRateScalarMin = Number(item.PlaybackRateScalarMin) * playMin;
        item.PlaybackRateScalarMax = Number(item.PlaybackRateScalarMax) * playMax;
        item.ZoomScalarMin = Number(item.ZoomScalarMin) * scale;
        item.ZoomScalarMax = Number(item.ZoomScalarMax) * scale;
      }
    }
    composite.DurationMin = durationMin;
    composite.DurationMax = durationMax;
    composite.DistanceCullingCullDist = Math.max(...builds.map((build) => Number(build.rule.DistanceCullingCullDist)));
    composite.DistanceCullingFadeDist = Math.min(
      composite.DistanceCullingCullDist,
      Math.max(...builds.map((build) => Number(build.rule.DistanceCullingFadeDist))),
    );
    composite.ViewportCullingSphereRadius = Math.max(
      ...builds.map((build) => Number(build.rule.ViewportCullingSphereRadius)),
    );
    /* Дальность LOD — у первого слоя, а нет её у него (дымка blood_nose:
       0…0) — самая широкая из слоёв, у которых она есть. */
    if (Number(composite.LodEvoDistanceMax) <= Number(composite.LodEvoDistanceMin)) {
      const ranged = builds
        .map((build) => build.rule)
        .filter((rule) => Number(rule.LodEvoDistanceMax) > Number(rule.LodEvoDistanceMin));
      if (ranged.length) {
        composite.LodEvoDistanceMin = Math.min(...ranged.map((rule) => Number(rule.LodEvoDistanceMin)));
        composite.LodEvoDistanceMax = Math.max(...ranged.map((rule) => Number(rule.LodEvoDistanceMax)));
      }
    }
  }
  const kept = builds.flatMap((build) => build.kept);
  composite.EventEmitters = kept;
  return kept;
}

/*
 * Дальность: размер вблизи — базовые кадры размера эмиттера, вдали — кадры
 * его эволюции LOD (нет её — достраивается из базовых), предел видимости —
 * отсечение правила. «Вдали» считается по событиям от исходных кадров,
 * «вблизи» — по одному разу на эмиттер.
 */
function applyLod(rule, kept, emitters, lod, label) {
  const near = lod.near != null ? bounded(lod.near, 0.1, 8, "lod near", label) : 1;
  const far = lod.far != null ? bounded(lod.far, 0.1, 8, "lod far", label) : 1;
  if (lod.distanceMin != null) rule.LodEvoDistanceMin = bounded(lod.distanceMin, 0, 1000, "lod distanceMin", label);
  if (lod.distanceMax != null) rule.LodEvoDistanceMax = bounded(lod.distanceMax, 1, 1000, "lod distanceMax", label);
  /* Правило без дальности (дымка: 0…0) берёт её у крови игры — 5…40 м. */
  if (
    lod.distanceMin == null &&
    lod.distanceMax == null &&
    Number(rule.LodEvoDistanceMin) === 0 &&
    Number(rule.LodEvoDistanceMax) === 0
  ) {
    rule.LodEvoDistanceMin = 5;
    rule.LodEvoDistanceMax = 40;
  }
  if (Number(rule.LodEvoDistanceMax) <= Number(rule.LodEvoDistanceMin))
    throw new Error(`YPT clone ${label} lod distances are out of order.`);
  if (lod.reach != null) {
    const reach = bounded(lod.reach, 5, 2000, "lod reach", label);
    rule.DistanceCullingCullDist = reach;
    rule.DistanceCullingFadeDist = Math.max(1, reach * 0.87);
  }
  let touched = 0;
  const sizeOf = (item) => {
    const emitter = emitters.get(item.EmitterRule);
    const property = list(emitter?.KeyframeProps).find((candidate) => same(candidate?.Name, SIZE_SCALAR));
    return list(property?.Keyframes).length ? { emitter, property } : null;
  };
  if (far !== 1)
    for (const item of kept) {
      const size = sizeOf(item);
      if (!size) continue;
      let evolved = null;
      for (const { item: frames } of evolvedFrames(item, SIZE_SCALAR))
        if (Number(frames.IsLodEvolution) !== 0) {
          evolved = frames;
          break;
        }
      touched += evolved ? scaleXY(evolved.Keyframes, far) : createLodKeyframes(item, size.property, far);
    }
  if (near !== 1) {
    const done = new Set();
    for (const item of kept) {
      const size = sizeOf(item);
      if (!size || done.has(size.emitter)) continue;
      done.add(size.emitter);
      touched += scaleXY(size.property.Keyframes, near);
    }
  }
  return touched;
}

function createLodKeyframes(item, baseProperty, far) {
  const evolution = (item.EvolutionList ??= { Evolutions: [], EvolvedKeyframeProps: [] });
  evolution.Evolutions = list(evolution.Evolutions);
  evolution.EvolvedKeyframeProps = list(evolution.EvolvedKeyframeProps);
  let index = evolution.Evolutions.findIndex((name) => same(name, LOD_EVOLUTION));
  if (index < 0) {
    evolution.Evolutions.push(LOD_EVOLUTION);
    index = evolution.Evolutions.length - 1;
  }
  let property = evolution.EvolvedKeyframeProps.find((candidate) => same(candidate?.Name, baseProperty.Name));
  if (!property) {
    property = { Name: baseProperty.Name, BlendMode: 1, Items: [] };
    evolution.EvolvedKeyframeProps.push(property);
  }
  property.Items = list(property.Items);
  const frames = list(baseProperty.Keyframes).map((frame) => [frame[0], frame[1] * far, frame[2] * far, frame[3], frame[4]]);
  property.Items.push({ EvolutionID: index, IsLodEvolution: 1, Keyframes: frames });
  return frames.length;
}

/*
 * Один список эволюций на правило — как у Rockstar: у события он пуст или
 * слово в слово тот же, что у правила. Составной клон с разными списками у
 * слоёв ронял игру на попадании (номер эволюции события уходил за конец
 * значений экземпляра). Список правила — объединение списков событий в
 * порядке появления, кадры перенумерованы по имени; больше пяти не бывает,
 * лишние снимаются с конца среди тех, что попаданию никто не задаёт.
 * Подробности — у помощника (`YptEffectClones.UnifyEvolutions`).
 */
const MAX_EVOLUTIONS = 5;
const DRIVEN_EVOLUTIONS = Object.freeze([LOD_EVOLUTION, "angle", "size"]);

const evolutionNames = (evolution) => list(evolution?.Evolutions).map((name) => String(name ?? ""));

function unifyEvolutions(rule, kept, label) {
  const union = [];
  const add = (names) => {
    for (const name of names) if (name && !union.some((known) => same(known, name))) union.push(name);
  };
  add(evolutionNames(rule.EvolutionList));
  for (const item of kept) add(evolutionNames(item?.EvolutionList));
  while (union.length > MAX_EVOLUTIONS) {
    const spare = union.findLastIndex((name) => !DRIVEN_EVOLUTIONS.some((driven) => same(driven, name)));
    if (spare < 0) throw new Error(`YPT clone ${label} needs more than ${MAX_EVOLUTIONS} evolutions.`);
    union.splice(spare, 1);
  }
  if (!union.length) return;
  rule.EvolutionList = renumberEvolutions(rule.EvolutionList, union, false);
  for (const item of kept) if (item) item.EvolutionList = renumberEvolutions(item.EvolutionList, union, true);
}

/* Список под общий: кадры по имени, кадры снятых эволюций убраны; пустой список события остаётся пустым. */
function renumberEvolutions(evolution, union, keepEmpty) {
  const names = evolutionNames(evolution);
  const props = list(evolution?.EvolvedKeyframeProps).filter(Boolean);
  if (keepEmpty && !names.length && !props.length) return evolution;
  for (const prop of props)
    prop.Items = list(prop.Items).filter((entry) => {
      const id = Number(entry?.EvolutionID);
      if (!entry || !Number.isInteger(id) || id < 0 || id >= names.length) return false;
      const index = union.findIndex((name) => same(name, names[id]));
      if (index < 0) return false;
      entry.EvolutionID = index;
      return true;
    });
  const evolved = props.filter((prop) => prop.Items.length > 0);
  return {
    ...(evolution || {}),
    Evolutions: [...union],
    // Пустой список выгрузка пишет пустой строкой (`<EvolvedKeyframeProps />`) — клон держит тот же вид.
    EvolvedKeyframeProps: evolved.length ? evolved : "",
  };
}

/** Нарушения правила «один список эволюций» у готового клона (пусто — всё как у Rockstar). */
export function evolutionProblems(rule) {
  const problems = [];
  const events = list(rule?.EventEmitters).length;
  if (events > MAX_EVENT_EMITTERS) problems.push(`rule carries ${events} emitters`);
  const own = evolutionNames(rule?.EvolutionList);
  if (own.length > MAX_EVOLUTIONS) problems.push(`rule carries ${own.length} evolutions`);
  const frames = (evolution, count, where) => {
    for (const prop of list(evolution?.EvolvedKeyframeProps))
      for (const entry of list(prop?.Items)) {
        const id = Number(entry?.EvolutionID);
        if (!Number.isInteger(id) || id < 0 || id >= count)
          problems.push(`${where}: ${prop?.Name} evolution id ${entry?.EvolutionID} outside ${count}`);
      }
  };
  frames(rule?.EvolutionList, own.length, "rule");
  list(rule?.EventEmitters).forEach((item, index) => {
    const names = evolutionNames(item?.EvolutionList);
    if (names.length && (names.length !== own.length || names.some((name, at) => !same(name, own[at]))))
      problems.push(`event ${index} (${item?.ParticleRule}): [${names}] differs from rule [${own}]`);
    frames(item?.EvolutionList, names.length, `event ${index}`);
  });
  return problems;
}

/**
 * Клон по заказу установщика. `sources` — выгрузки правил: `core` (ядро
 * игрока) и чужие словари по имени файла слоя; `coreTextures` — имена листов
 * ядра (для доноров из чужих словарей). Возвращает выгрузку с правилом
 * клона, его эмиттерами и частицами — её можно отдать `loadModel` вместе с
 * выгрузками доноров.
 */
export function buildEffectClone(sources, request, { coreTextures = [] } = {}) {
  const effect = request?.effect;
  if (!CLONE_NAME.test(effect || "")) throw new Error(`YPT clone names must live in the astral_ namespace: ${effect}`);
  const layers = layersOf(request);
  if (layers.length > MAX_LAYERS) throw new Error(`YPT clone ${effect} has more than ${MAX_LAYERS} layers.`);
  for (const layer of layers) {
    if (!layer || !DONOR_NAME.test(layer.donorEffect || "")) throw new Error(`YPT clone donor name is invalid: ${effect}`);
    if (layer.donorFile && !sources[layer.donorFile])
      throw new Error(`YPT clone donor file is not loaded: ${layer.donorFile}`);
  }
  const textures = new Set([...coreTextures].map((name) => String(name).toLowerCase()));
  const builds = layers.map((layer, index) => buildLayer(sources, effect, index, layer, textures));
  const composite = builds[0].rule;
  const kept = merge(builds, effect);
  const emitterByName = new Map(builds.flatMap((build) => build.emitters.map((rule) => [rule.Name, rule])));
  const lodKeyframes = request.lod ? applyLod(composite, kept, emitterByName, request.lod, effect) : 0;
  // Последним: эволюции слоёв и достроенный LOD сводятся в один список правила.
  unifyEvolutions(composite, kept, effect);

  const exported = { effects: { [effect]: composite }, emitters: {}, particles: {} };
  for (const build of builds) {
    for (const rule of build.emitters) exported.emitters[rule.Name] = rule;
    for (const rule of build.particles) exported.particles[rule.Name] = rule;
  }
  const importedTextures = [];
  for (const item of builds.flatMap((build) => build.imported))
    if (!importedTextures.some((known) => same(known.texture, item.texture))) importedTextures.push(item);
  return {
    ...exported,
    importedTextures,
    report: {
      effect,
      donors: builds.map((build) => build.donor),
      emitters: kept.length,
      textures: [...new Set(builds.flatMap((build) => build.textureNames))],
      recoloured: builds.reduce((sum, build) => sum + build.report.recoloured, 0),
      spawn: builds.reduce((sum, build) => sum + build.report.spawn, 0),
      replaced: builds.reduce((sum, build) => sum + build.report.replaced, 0),
      scaled: builds.reduce((sum, build) => sum + build.report.scaled, 0),
      lodKeyframes,
    },
  };
}
