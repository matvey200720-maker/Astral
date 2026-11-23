/*
 * Модель правил эффектов для движка частиц.
 *
 * Вход — выгрузка помощника RPF (`ypt-rule-export`): правила эффектов, их
 * эмиттеры и частицы в том виде, как их пишет CodeWalker, переведённые в
 * JSON один в один. Здесь выгрузка раскладывается в структуры, по которым
 * удобно считать: дорожки кадров — `Float32Array`, свойства — по коротким
 * именам, эволюции события — картой «полное имя свойства → дорожки».
 *
 * Модель не решает, как свойства влияют на частицы, — это делает движок
 * (`simulation.js`). Она только ничего не теряет из того, что лежит в игре.
 */

import { compileTrack, EVOLUTION_BLEND } from "./keyframes.js";
import { joaat } from "./random.js";

/** Свойство правила: дорожка, номер случайной величины, связь. */
export function compileProperty(raw) {
  if (!raw || typeof raw !== "object" || !("Keyframes" in raw)) return null;
  const name = String(raw.Name || "");
  return Object.freeze({
    name,
    hash: joaat(name),
    random: Number(raw.RandomIndex) || 0,
    invert: Number(raw.InvertBiasLink) === 1,
    track: compileTrack(raw.Keyframes),
  });
}

/** Короткое имя свойства: `ptxEmitterRule:m_spawnRateOverTimeKFP` → `spawnRateOverTime`. */
export function shortPropertyName(name) {
  const tail = String(name || "").split(":").pop() || "";
  return tail.replace(/^m_/, "").replace(/KFP$/, "");
}

/* Цвет события (`ColourTintMin/Max`) лежит одним числом ARGB. */
function unpackArgb(value) {
  const packed = Number(value) >>> 0;
  return Object.freeze([
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
    ((packed >>> 24) & 0xff) / 255,
  ]);
}

const pair = (min, max) => Object.freeze([Number(min) || 0, Number(max) || 0]);
const flag = (value) => Number(value) === 1;
const list = (value) => (Array.isArray(value) ? value : []);

/*
 * Эволюции события или правила: имена и «эволюционировавшие» дорожки,
 * сгруппированные по полному имени свойства, к которому они относятся.
 */
function compileEvolutions(raw) {
  const names = list(raw?.Evolutions).map((item) => String(item));
  const evolved = new Map();
  for (const entry of list(raw?.EvolvedKeyframeProps)) {
    const target = String(entry?.Name || "");
    const mode =
      Number(entry?.BlendMode) === EVOLUTION_BLEND.add
        ? EVOLUTION_BLEND.add
        : EVOLUTION_BLEND.blend;
    const items = [];
    for (const item of list(entry?.Items)) {
      const track = compileTrack(item?.Keyframes);
      if (!track) continue;
      const index = Number(item?.EvolutionID) || 0;
      items.push(
        Object.freeze({
          evolution: names[index] ?? String(index),
          lod: flag(item?.IsLodEvolution),
          mode,
          track,
        }),
      );
    }
    if (items.length) evolved.set(target, Object.freeze(items));
  }
  return Object.freeze({ names: Object.freeze(names), evolved });
}

function compileDomain(raw) {
  if (!raw || typeof raw !== "object" || !raw.DomainType) return null;
  return Object.freeze({
    type: String(raw.DomainType),
    worldSpace: flag(raw.IsWorldSpace),
    pointRelative: flag(raw.IsPointRelative),
    creationRelative: flag(raw.IsCreationRelative),
    targetRelative: flag(raw.IsTargetRelatve ?? raw.IsTargetRelative),
    position: compileProperty(raw.PositionKFP),
    rotation: compileProperty(raw.RotationKFP),
    sizeOuter: compileProperty(raw.SizeOuterKFP),
    sizeInner: compileProperty(raw.SizeInnerKFP),
  });
}

function compileEffect(name, raw) {
  const props = {};
  for (const item of list(raw.KeyframeProps)) {
    const property = compileProperty(item);
    if (property) props[shortPropertyName(property.name)] = property;
  }
  const events = list(raw.EventEmitters).map((event, index) =>
    Object.freeze({
      index,
      type: Number(event.EventType) || 0,
      emitter: String(event.EmitterRule || ""),
      particle: String(event.ParticleRule || ""),
      start: Number(event.StartRatio) || 0,
      end: Number(event.EndRatio) || 0,
      playback: pair(event.PlaybackRateScalarMin ?? 1, event.PlaybackRateScalarMax ?? 1),
      zoom: pair(event.ZoomScalarMin ?? 1, event.ZoomScalarMax ?? 1),
      tint: Object.freeze([unpackArgb(event.ColourTintMin), unpackArgb(event.ColourTintMax)]),
      evolutions: compileEvolutions(event.EvolutionList),
    }),
  );
  return Object.freeze({
    name,
    duration: pair(raw.DurationMin, raw.DurationMax),
    playback: pair(raw.PlaybackRateScalarMin ?? 1, raw.PlaybackRateScalarMax ?? 1),
    loops: Number(raw.NumLoops) | 0,
    preUpdate: Number(raw.PreUpdateTime) || 0,
    randomOffset: Object.freeze(list(raw.VRandomOffsetPos).map(Number)),
    lod: Object.freeze({
      min: Number(raw.LodEvoDistanceMin) || 0,
      max: Number(raw.LodEvoDistanceMax) || 0,
    }),
    cull: Object.freeze({
      fade: Number(raw.DistanceCullingFadeDist) || 0,
      distance: Number(raw.DistanceCullingCullDist) || 0,
    }),
    zoomLevel: Number(raw.ZoomLevel ?? 100),
    colourTintMaxEnable: flag(raw.ColourTintMaxEnable),
    props: Object.freeze(props),
    evolutions: compileEvolutions(raw.EvolutionList),
    events: Object.freeze(events),
  });
}

function compileEmitter(name, raw) {
  const props = {};
  for (const item of list(raw.KeyframeProps)) {
    const property = compileProperty(item);
    if (property) props[shortPropertyName(property.name)] = property;
  }
  return Object.freeze({
    name,
    oneShot: flag(raw.IsOneShot),
    creation: compileDomain(raw.CreationDomainObj),
    target: compileDomain(raw.TargetDomainObj),
    attractor: compileDomain(raw.AttractorDomainObj),
    props: Object.freeze(props),
  });
}

/*
 * Поведение частицы: поля как в выгрузке, свойства — скомпилированные.
 * Имена полей не переводятся: тип поведения и имена его полей — словарь
 * RMPTFX, и движок читает их ровно так, как они названы в игре.
 */
function compileBehaviour(raw) {
  const behaviour = { type: String(raw?.Type || "") };
  for (const [key, value] of Object.entries(raw || {})) {
    if (key === "Type") continue;
    const property = compileProperty(value);
    behaviour[key] = property ?? value;
  }
  return Object.freeze(behaviour);
}

function compileShaderVars(raw) {
  const vars = new Map();
  for (const item of list(raw)) {
    const name = String(item?.Name || "").toLowerCase();
    if (!name) continue;
    const type = String(item?.Type || "");
    if (type === "Texture") {
      vars.set(name, Object.freeze({ type, texture: String(item.TextureName || "") }));
    } else if (type === "Keyframe") {
      /* Ключевой параметр шейдера — строки { Unknown0 (время), Unknown10 (значение) }. */
      const keys = list(item.Items)
        .map((key) => [Number(key?.Unknown0) || 0, Number(key?.Unknown10) || 0])
        .sort((left, right) => left[0] - right[0]);
      vars.set(name, Object.freeze({ type, keys: Object.freeze(keys) }));
    } else {
      vars.set(
        name,
        Object.freeze({
          type,
          value: Object.freeze([
            Number(item?.VectorX) || 0,
            Number(item?.VectorY) || 0,
            Number(item?.VectorZ) || 0,
            Number(item?.VectorW) || 0,
          ]),
        }),
      );
    }
  }
  return vars;
}

function compileParticle(name, raw) {
  const behaviours = list(raw.AllBehaviours).map(compileBehaviour);
  const biasLinks = list(raw.BiasLinks).map((link) => {
    const ids = Array.isArray(link?.KeyframePropIDs) ? link.KeyframePropIDs : [];
    const members = new Set(
      ids
        .map((id) => String(id))
        .map((id) => (id.startsWith("hash_") ? parseInt(id.slice(5), 16) : joaat(id)))
        .filter((hash) => Number.isFinite(hash))
        .map((hash) => hash >>> 0),
    );
    return Object.freeze({ random: Number(link?.RandomIndex) || 0, members });
  });
  const shaderVars = compileShaderVars(raw.ShaderVars);
  const texture = (key) => shaderVars.get(key)?.texture || "";
  return Object.freeze({
    name,
    shader: Object.freeze({
      file: String(raw.ShaderFile || ""),
      technique: String(raw.ShaderTechnique || ""),
      lit: flag(raw.IsLit),
      soft: flag(raw.IsSoft),
      screen: flag(raw.IsScreenSpace),
      refract: flag(raw.IsRefract),
      normalSpec: flag(raw.IsNormalSpec),
      diffuseMode: Number(raw.DiffuseMode) || 0,
      projectionMode: Number(raw.ProjectionMode) || 0,
    }),
    render: Object.freeze({
      cull: Number(raw.CullMode) || 0,
      blendSet: Number(raw.BlendSet) || 0,
      lighting: Number(raw.LightingMode) || 0,
      depthWrite: flag(raw.DepthWrite),
      depthTest: flag(raw.DepthTest),
      alphaBlend: flag(raw.AlphaBlend),
    }),
    frames: pair(raw.TexFrameIDMin, raw.TexFrameIDMax),
    sortType: Number(raw.SortType) || 0,
    drawType: Number(raw.DrawType) || 0,
    flags: Number(raw.Flags) || 0,
    behaviours: Object.freeze(behaviours),
    biasLinks: Object.freeze(biasLinks),
    shaderVars,
    textures: Object.freeze({
      diffuse: texture("diffusetex") || texture("diffusetex2"),
      diffuse2: texture("diffusetex2"),
      normalSpec: texture("normalspecmap"),
      refraction: texture("refractionmap"),
    }),
    drawables: Object.freeze(
      list(raw.Drawables).map((item) =>
        Object.freeze({
          name: String(item?.Name || ""),
          bounds: Object.freeze([
            Number(item?.BoundBoxWidth) || 0,
            Number(item?.BoundBoxHeight) || 0,
            Number(item?.BoundBoxDepth) || 0,
          ]),
          radius: Number(item?.BoundingSphereRadius) || 0,
        }),
      ),
    ),
    spawners: Object.freeze({
      atRatio: raw.EffectSpawnerAtRatio || null,
      onCollision: raw.EffectSpawnerOnCollision || null,
    }),
  });
}

/**
 * Модель из выгрузки (или нескольких: ядро и чужие словари). Правило с тем
 * же именем в следующей выгрузке заменяет прежнее — так клон в ядре игрока
 * перекрывает донора из словаря.
 */
export function loadModel(...exports) {
  const effects = new Map();
  const emitters = new Map();
  const particles = new Map();
  for (const exported of exports) {
    if (!exported) continue;
    for (const [name, raw] of Object.entries(exported.effects || {}))
      if (raw) effects.set(name, compileEffect(name, raw));
    for (const [name, raw] of Object.entries(exported.emitters || {}))
      if (raw) emitters.set(name, compileEmitter(name, raw));
    for (const [name, raw] of Object.entries(exported.particles || {}))
      if (raw) particles.set(name, compileParticle(name, raw));
  }
  return Object.freeze({ effects, emitters, particles });
}

/** Поведение частицы по типу (`Size`, `Colour`, …) или `null`. */
export const behaviourOf = (particle, type) =>
  particle?.behaviours?.find((item) => item.type === type) || null;
