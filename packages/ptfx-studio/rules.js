/*
 * Выписки правил эффектов: числа, по которым сцена мастерской проигрывает
 * попадание, а компилятор считает эмиттеры.
 *
 * Правило эффекта в GTA — набор чисел: сколько частиц родится, как долго
 * живут, куда и с какой скоростью летят, как растут, какого цвета в каждый
 * миг жизни, каким листом нарисованы. Помощник RPF выписывает их из ядра
 * игрока (`ypt-rule-digest`), а на случай окна без игры (браузер, тесты)
 * здесь лежит выписка штатного ядра Legacy и клоунского словаря —
 * `impact-rules.js`, собранная `scripts/bake-impact-rules.mjs` из самой игры.
 * Живая выписка, если она есть, всегда важнее запечённой: правило редукса
 * могло стать другим.
 *
 * Здесь же — настройка выписки заказом слоя (`tuneImpactRule`): то же, что
 * делает с правилом помощник RPF (`YptEffectClones.ApplyTune`), только над
 * числами, а не над ресурсом. Сцена рисует настроенную выписку, и человек
 * видит те же кадры цвета, размера и скорости, что клон унесёт в игру.
 */

import { IMPACT_RULES } from "./impact-rules.js";

/** Имена правил, которые несёт запечённая выписка. */
export const IMPACT_RULE_NAMES = Object.freeze(Object.keys(IMPACT_RULES));

/** Выписка правила: живая (из ядра игрока), иначе запечённая, иначе `null`. */
export const impactRuleDigest = (name, live = null) =>
  live?.[name] ?? IMPACT_RULES[name] ?? null;

/** Сколько событий (эмиттеров) у правила; у неизвестного — ноль. */
export const ruleEventCount = (name, live = null) =>
  impactRuleDigest(name, live)?.events?.length ?? 0;

/** Частицы правила, рисующие названный лист, — по одному имени на частицу. */
export function ruleParticlesDrawing(name, texture, live = null) {
  const wanted = String(texture || "").toLowerCase();
  const names = new Set();
  for (const event of impactRuleDigest(name, live)?.events || []) {
    if (String(event.particleRule?.texture || "").toLowerCase() !== wanted)
      continue;
    names.add(event.particle);
  }
  return [...names];
}

/**
 * Частица каждого события правила — с повторами. Эмиттеры игра считает по
 * событиям, а не по именам: у клоунской дымки три события рисуют одну и ту же
 * частицу, и в правиле это три эмиттера, а не один.
 */
export function ruleEventParticles(name, live = null) {
  return (impactRuleDigest(name, live)?.events || []).map(
    (event) => event.particle,
  );
}

/** Листы, которые рисует правило, — без повторов. */
export function ruleTextures(name, live = null) {
  const textures = new Set();
  for (const event of impactRuleDigest(name, live)?.events || [])
    if (event.particleRule?.texture) textures.add(event.particleRule.texture);
  return [...textures];
}

/** Частицы правила по порядку событий — по одному имени на частицу. */
export function ruleParticles(name, live = null) {
  const names = [];
  for (const event of impactRuleDigest(name, live)?.events || [])
    if (event.particle && !names.includes(event.particle))
      names.push(event.particle);
  return names;
}

/** Лист, которым нарисована частица правила, или `null`. */
export function ruleParticleTexture(name, particle, live = null) {
  const event = (impactRuleDigest(name, live)?.events || []).find(
    (item) => item.particle === particle,
  );
  return event?.particleRule?.texture || null;
}

/* ── Настройка выписки заказом слоя ─────────────────────────────────────── */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* Имя свойства заказа → где оно лежит в выписке. */
const DOMAIN_OF = Object.freeze({
  ptxCreationDomain: "creation",
  ptxTargetDomain: "target",
  ptxAttractorDomain: "attractor",
});

/** `ptxEmitterRule:m_spawnRateOverTimeKFP` → `{ owner, name }`. */
function locate(prop) {
  const [owner, raw = ""] = String(prop).split(":");
  let name = raw;
  if (name.startsWith("m_")) name = name.slice(2);
  if (name.endsWith("KFP")) name = name.slice(0, -3);
  return { owner, name };
}

const cloneFrames = (frames) => (frames || []).map((frame) => [...frame]);

/** Глубокая копия выписки: настройка не трогает запечённое. */
function cloneDigest(digest) {
  return JSON.parse(JSON.stringify(digest));
}

/* Кадры свойства эмиттера или его области по имени заказа. */
function emitterFrames(emitter, prop) {
  const { owner, name } = locate(prop);
  if (owner === "ptxEmitterRule") return emitter.props?.[name] || null;
  const domain = emitter[DOMAIN_OF[owner]];
  return domain?.[name] || null;
}

function setEmitterFrames(emitter, prop, frames) {
  const { owner, name } = locate(prop);
  if (owner === "ptxEmitterRule") {
    emitter.props ||= {};
    emitter.props[name] = frames;
    return;
  }
  const key = DOMAIN_OF[owner];
  if (!key) return;
  emitter[key] ||= {};
  emitter[key][name] = frames;
}

/* Поведение частицы по имени заказа: `ptxu_Size` → `Size`. */
function behaviourOf(particle, prop) {
  const { owner, name } = locate(prop);
  if (!owner.startsWith("ptxu_")) return null;
  const behaviour = particle.behaviours?.[owner.slice(5)];
  return behaviour ? { behaviour, name } : null;
}

function scaleFrames(frames, factor, axes) {
  return (frames || []).map(([time, x, y, z, w]) =>
    axes === 3
      ? [time, x * factor, y * factor, z * factor, w]
      : [time, x * factor, y * factor, z, w],
  );
}

/* Перекраска кадра: тон от заказа, яркость — старший канал кадра. */
function repaint(frames, colour, alpha) {
  return (frames || []).map(([time, r, g, b, a]) => {
    let red = r;
    let green = g;
    let blue = b;
    if (colour) {
      const intensity = Math.max(r, g, b);
      red = clamp(colour[0] * intensity, 0, 1);
      green = clamp(colour[1] * intensity, 0, 1);
      blue = clamp(colour[2] * intensity, 0, 1);
    }
    return [time, red, green, blue, alpha == null ? a : clamp(a * alpha, 0, 1)];
  });
}

/** Значение кадров в момент `time` — линейно между соседями. */
export function sampleFrames(frames, time) {
  if (!frames?.length) return null;
  const ordered = [...frames].sort((left, right) => left[0] - right[0]);
  if (time <= ordered[0][0]) return ordered[0].slice(1);
  for (let index = 1; index < ordered.length; index += 1) {
    const next = ordered[index];
    if (time > next[0]) continue;
    const previous = ordered[index - 1];
    const span = next[0] - previous[0];
    const amount = span > 1e-6 ? (time - previous[0]) / span : 1;
    return previous
      .slice(1)
      .map((value, axis) => value + (next[axis + 1] - value) * amount);
  }
  return ordered[ordered.length - 1].slice(1);
}

/** Чистый тон радуги с яркостью `value` — как `Hue` в помощнике. */
export function hueColour(hue, value = 1) {
  const sector = ((hue % 1) + 1) % 1 * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const rising = value * fraction;
  const falling = value * (1 - fraction);
  return [
    [value, rising, 0],
    [falling, value, 0],
    [0, value, rising],
    [0, falling, value],
    [rising, 0, value],
    [value, 0, falling],
  ][index];
}

/* Радуга: восемь ступеней тона за жизнь, яркость и прозрачность донора. */
function rainbow(frames, offset, alpha) {
  if (!frames?.length) return frames;
  const steps = 8;
  return Array.from({ length: steps }, (_, step) => {
    const time = step / (steps - 1);
    const [r, g, b, a] = sampleFrames(frames, time);
    const intensity = Math.max(r, g, b);
    const opacity = alpha == null ? a : clamp(a * alpha, 0, 1);
    return [time, ...hueColour(time + offset, intensity), opacity];
  });
}

/**
 * Настраивает выписку правила заказом слоя (`impactLayerRecipe`): оставляет
 * заказанные частицы, подменяет листы, красит кадры цвета, множит густоту,
 * размер и поведение, ставит заказанные кадры и прицел. Возвращает новую
 * выписку; `digest` не меняется.
 */
export function tuneImpactRule(digest, recipe, { lod = null } = {}) {
  if (!digest) return null;
  const rule = cloneDigest(digest);
  const tune = recipe?.tune || {};
  const keep = recipe?.keepParticles?.length
    ? new Set(recipe.keepParticles)
    : null;
  rule.events = (rule.events || []).filter(
    (event) => !keep || keep.has(event.particle),
  );

  /* Подмена листа: у частиц по имени или по исходному листу. */
  for (const swap of recipe?.textures || []) {
    for (const event of rule.events) {
      const particle = event.particleRule;
      const byParticle = swap.particles?.includes(event.particle);
      const byTexture =
        swap.donorTexture &&
        String(particle.texture || "").toLowerCase() ===
          String(swap.donorTexture).toLowerCase();
      if (!byParticle && !byTexture) continue;
      particle.texture = swap.texture;
      if (swap.frameMin != null || swap.frameMax != null)
        particle.frames = [
          swap.frameMin ?? particle.frames?.[0] ?? 0,
          swap.frameMax ?? particle.frames?.[1] ?? 0,
        ];
      const animation = particle.behaviours?.AnimateTexture;
      if (!animation) continue;
      if (swap.lastFrame != null) animation.lastFrame = swap.lastFrame;
      if (swap.loopMode != null) animation.loopMode = swap.loopMode;
      if (swap.scaledOverLife != null)
        animation.scaledOverLife = swap.scaledOverLife;
      if (swap.randomised != null) animation.randomised = swap.randomised;
    }
  }

  if (tune.maxDuration != null) {
    rule.duration = rule.duration.map((value) =>
      Math.min(value, tune.maxDuration),
    );
  }
  /* Масштаб правила целиком — как `EffectZoom` помощника: кадры
     ptxEffectRule:m_zoomScalarKFP получают одно значение, проценты. */
  if (tune.effectZoom != null)
    rule.zoom = [[0, tune.effectZoom, tune.effectZoom, 100, 100]];
  if (tune.zoomScale != null)
    for (const event of rule.events)
      event.zoom = event.zoom.map((value) => value * tune.zoomScale);
  if (tune.oneShot != null)
    for (const event of rule.events) event.emitterRule.oneShot = tune.oneShot;
  if (tune.spawnScale != null)
    for (const event of rule.events) {
      const props = event.emitterRule.props || {};
      if (props.spawnRateOverTime)
        props.spawnRateOverTime = scaleFrames(
          props.spawnRateOverTime,
          tune.spawnScale,
          2,
        );
    }

  /* Цвет: один, два или радуга; прозрачность — множитель альфы. */
  const mode = tune.colourMode || "recolour";
  const colour = tune.colour || null;
  const upper = mode === "duo" ? tune.colour2 || colour : colour;
  if (colour || tune.alphaScale != null) {
    for (const event of rule.events) {
      const paint = event.particleRule.behaviours?.Colour;
      if (!paint?.props) continue;
      if (mode === "rainbow") {
        paint.props.rgbaMin = rainbow(paint.props.rgbaMin, 0, tune.alphaScale);
        paint.props.rgbaMax = rainbow(
          paint.props.rgbaMax,
          0.5,
          tune.alphaScale,
        );
      } else {
        paint.props.rgbaMin = repaint(paint.props.rgbaMin, colour, tune.alphaScale);
        paint.props.rgbaMax = repaint(paint.props.rgbaMax, upper, tune.alphaScale);
      }
    }
  }

  /* Цвет по частям — поверх общего: свой тон у названных частиц. */
  for (const part of tune.partColours || []) {
    for (const event of rule.events) {
      if (event.particle !== part.particle) continue;
      const paint = event.particleRule.behaviours?.Colour;
      if (!paint?.props) continue;
      paint.props.rgbaMin = repaint(paint.props.rgbaMin, part.colour, null);
      paint.props.rgbaMax = repaint(paint.props.rgbaMax, part.colour, null);
    }
  }

  /* Заказанные кадры: у эмиттера и его областей или у поведения частицы. */
  for (const patch of tune.keyframes || []) {
    const values = cloneFrames(patch.values);
    for (const event of rule.events) {
      if (patch.particle && event.particle !== patch.particle) continue;
      if (patch.scope === "emitter") {
        setEmitterFrames(event.emitterRule, patch.prop, values);
      } else {
        const found = behaviourOf(event.particleRule, patch.prop);
        if (!found) continue;
        found.behaviour.props ||= {};
        found.behaviour.props[found.name] = values;
      }
    }
  }

  /* Множители поведения — последними, поверх заказанных кадров. */
  for (const scale of tune.scales || []) {
    const axes = String(scale.prop).includes("Domain:") ? 3 : 2;
    for (const event of rule.events) {
      const frames = emitterFrames(event.emitterRule, scale.prop);
      if (!frames) continue;
      setEmitterFrames(
        event.emitterRule,
        scale.prop,
        scaleFrames(frames, scale.factor, axes),
      );
    }
  }

  /* Прицел: точка цели эмиттера повёрнута на заказанные углы. */
  if (tune.aim) {
    const yaw = (tune.aim.yaw * Math.PI) / 180;
    const pitch = (tune.aim.pitch * Math.PI) / 180;
    for (const event of rule.events) {
      const position = event.emitterRule.target?.position;
      if (!position) continue;
      event.emitterRule.target.position = position.map(([time, x, y, z, w]) => {
        const length = Math.hypot(x, y, z);
        if (length < 1e-5) return [time, x, y, z, w];
        const axis = [x / length, y / length, z / length];
        const seed = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const right = normalize(cross(axis, seed));
        const up = cross(axis, right);
        const tilt = Math.sin(pitch);
        const forward = Math.cos(pitch);
        const side = Math.cos(yaw) * tilt;
        const lift = Math.sin(yaw) * tilt;
        return [
          time,
          (axis[0] * forward + right[0] * side + up[0] * lift) * length,
          (axis[1] * forward + right[1] * side + up[1] * lift) * length,
          (axis[2] * forward + right[2] * side + up[2] * lift) * length,
          w,
        ];
      });
    }
  }

  /* Дальность: «вблизи» множит базовые кадры размера эмиттеров. */
  if (lod?.near != null && lod.near !== 1)
    for (const event of rule.events) {
      const props = event.emitterRule.props || {};
      if (props.sizeScalar)
        props.sizeScalar = scaleFrames(props.sizeScalar, lod.near, 2);
    }
  return rule;
}

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
