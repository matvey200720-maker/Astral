/*
 * Предпросмотр эффекта попадания — по правилам самой игры.
 *
 * В игре вид эффекта задаёт правило частиц: сколько их родится, как долго
 * живут, куда и с какой скоростью летят, как растут, какого они цвета в
 * каждый миг жизни и каким листом нарисованы. Прежде сцена рисовала «примерно
 * кровь» по числам, подобранным на глаз, — и владелец сказал прямо: выглядит
 * плохо, сделай как на видео. Теперь сцена считает выброс по ВЫПИСКЕ правила
 * (`@modovik/ptfx-studio/rules.js`): в приложении её выписывает помощник из
 * ядра игрока, в браузере лежит выписка штатной игры. Заказ слоя — цвет,
 * сила, поведение, лист — накладывается на выписку той же функцией, что и на
 * клон в ядре (`tuneImpactRule`), так что сцена показывает те же кадры цвета,
 * размера и скорости, что клон унесёт в игру.
 *
 * Частицы рисуются листами из игры игрока, когда они есть (`gameSheet`):
 * кровяная пыль, струи, дым, звёзды и цветы — теми же кадрами, умноженными на
 * цвет частицы, как это делает шейдер. Без базы (браузер) частица рисуется
 * схемой по семейству листа. Это по-прежнему схема, а не кадр из игры: нет ни
 * освещения, ни глубины, ни декалей движка. Подписи об этом на кадре нет —
 * владелец убрал оговорки с кадров 25.10.2026 (`CLAUDE.md`), откуда кадр, видно
 * только в подсказке.
 *
 * Одна функция рисует всё: сцену с человеком, плитки выбора и обложку работы.
 * Частицы детерминированы (зерно из вида и зоны) — кадр с одним и тем же
 * временем всегда одинаков, поэтому обложка не «дышит» между открытиями.
 *
 * Зона — стопка слоёв, и сцена рисует её так же, как игра: слои идут один
 * поверх другого из одной точки. Дальность зоны тоже видна — «вблизи» меняет
 * размер выброса на сцене, потому что сцена и есть взгляд в упор.
 */

import {
  ASTRAL_BLOOD_SPRAY_TEXTURE,
  BLOOD_SPRAY_TEXTURE,
  IMPACT_PICTURE_OUTLINE,
  customPictureSize,
  findBloodSheet,
  findImpactPictureShape,
  findImpactTemplate,
  impactLayerRecipe,
  impactPictureFrame,
  impactRuleDigest,
  layerDonor,
  layerPictureKey,
  parseColour,
  placementLayers,
  sampleFrames,
  tuneImpactRule,
} from "@modovik/ptfx-studio";
import { READBACK, context2d } from "./effects-preview.js";
import { bloodSheet, bloodSheetFrame, gameSheet } from "./effects-sheets.js";
import { createLruCache } from "./lru-cache.js";

/*
 * Кадр движка частиц для плиток выбора. Его подключает мастерская
 * (`provideThumbnailEngine`), а не этот модуль: схемой пользуются и обложки
 * библиотеки, и тянуть к ним WebGL-движок незачем.
 */
let thumbnailEngine = null;

export function provideThumbnailEngine(render) {
  thumbnailEngine = typeof render === "function" ? render : null;
  thumbnailCache.clear();
}

/* Живая выписка правил ядра игрока: важнее запечённой. */
let liveRules = null;

/** База сцены: выписки правил из игры игрока (или `null` — штатные). */
export function provideImpactRules(rules) {
  liveRules = rules && typeof rules === "object" ? rules : null;
  preparedCache.clear();
}

export const hasLiveImpactRules = () => liveRules !== null;

/* Имена текстур в рецепте слоя: сцена узнаёт по ним, чем рисовать. */
const SHEET_TEXTURE = "astral_impact_sheet_scene";
const PICTURE_TEXTURE = "astral_impact_pic_scene";

/* Частиц на событие — не больше: у снайперского хедшота в правиле стоит
   тысяча брызг в секунду, и это про пул движка, а не про число на экране. */
const MAX_PARTICLES = 48;
/* Пауза между кадрами следа ленты: точки пути для отрисовки хвоста. */
const RIBBON_STEPS = 7;

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const mean = (pair) =>
  Array.isArray(pair) && pair.length >= 2
    ? (Number(pair[0]) + Number(pair[1])) / 2
    : Number(pair?.[0]) || 0;
const first = (frames) =>
  Array.isArray(frames) && frames.length ? frames[0].slice(1) : null;

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed) {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const rgb = (hex) => parseColour(hex);
const paint = (colour, alpha) =>
  `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${clamp(alpha, 0, 1)})`;

/*
 * Куда летит выброс: доля сдвига метки на кадре.
 *
 * В игре это поворот точки прицела эмиттера (`tune.aim`), и посчитан он там в
 * углах. Кадр плоский, поворачивать в нём нечего — зато видно ровно то же:
 * скорость каждой частицы доворачивается к метке тем сильнее, чем дальше её
 * оттащили. Ноль оставляет веер таким, каким его сделала Rockstar.
 */
function aimOf(settings) {
  const x = Number(settings?.direction?.x) || 0;
  const y = Number(settings?.direction?.y) || 0;
  const reach = Math.min(1, Math.hypot(x, y));
  if (reach < 0.001) return null;
  return { x: x / reach, y: y / reach, reach };
}

/* ── Выписка слоя: настроенное правило и его частицы ────────────────────── */

/* Запасы кадров и правил — с вытеснением самого давнего: слои, которые на
   экране всё время работы, не уходят оттуда вместе с цветом, пройденным
   палитрой. */
const preparedCache = createLruCache(200);

/*
 * Сцена плоская, а правило объёмное. Ось Z эмиттера — от раны наружу (к
 * стрелку), Y — вверх по телу, X — вбок. На кадре наружу — это вверх и чуть
 * на зрителя, поэтому Z ложится вверх, Y — тоже вверх, но слабее, X — вбок.
 * Ускорения частиц заданы в мире: там Z — вверх, и тяжесть тянет по -Z.
 */
const project = ([x, y, z]) => ({ x: x + y * 0.15, y: -(z * 0.9 + y * 0.45) });
const projectWorld = ([x, y, z]) => ({ x: x + y * 0.1, y: -z });

/* Точка области эмиттера: положение плюс случайный сдвиг в её размере. */
function domainPoint(domain, next) {
  const position = first(domain?.position) || [0, 0, 0];
  const size = first(domain?.sizeOuter) || [0, 0, 0];
  return [
    position[0] + (next() - 0.5) * (size[0] || 0),
    position[1] + (next() - 0.5) * (size[1] || 0),
    position[2] + (next() - 0.5) * (size[2] || 0),
  ];
}

/* Кадры пары «мин — макс» в момент жизни, смешанные долей частицы. */
function pairAt(behaviour, minName, maxName, phase, share, fallback) {
  const props = behaviour?.props || {};
  const min = sampleFrames(props[minName], phase);
  const max = sampleFrames(props[maxName], phase) || min;
  if (!min && !max) return fallback;
  const low = min || max;
  return low.map((value, axis) => lerp(value, max[axis], share));
}

/**
 * Слой → настроенное правило и рождённые частицы. Считается один раз на
 * зерно и заказ: дальше кадр — формула от времени, поэтому стоп-кадр,
 * плитка и обложка — тот же код.
 */
function preparedLayer(zoneId, layer, seed) {
  const key = `${zoneId}|${seed}|${liveRules ? "live" : "baked"}|${JSON.stringify(layer)}`;
  const known = preparedCache.get(key);
  if (known !== undefined) return known;
  const prepared = buildLayer(zoneId, layer, seed);
  preparedCache.set(key, prepared);
  return prepared;
}

function buildLayer(zoneId, layer, seed) {
  const donor = layerDonor(zoneId, layer);
  const digest = impactRuleDigest(donor.effect, liveRules);
  if (!digest) return null;
  const recipe = impactLayerRecipe(zoneId, layer, {
    texture: layer.kind === "custom" ? PICTURE_TEXTURE : SHEET_TEXTURE,
    rules: liveRules,
  });
  if (!recipe) return null;
  /* Прицел сцена считает сама, на плоскости — по метке. */
  const { aim: _aim, ...tune } = recipe.tune || {};
  const rule = tuneImpactRule(digest, { ...recipe, tune });
  if (!rule?.events?.length) return null;
  const next = random(hashSeed(seed));
  const duration = mean(rule.duration) / Math.max(0.05, mean(rule.playback));
  const ruleZoom = (rule.zoom?.[0]?.[1] || 100) / 100;
  const particles = [];
  let longest = 0;
  rule.events.forEach((event, eventIndex) => {
    const emitter = event.emitterRule || {};
    const props = emitter.props || {};
    const t0 = event.start * duration;
    const t1 = Math.max(event.start, event.end) * duration;
    const particle = event.particleRule || {};
    const spawn = first(props.spawnRateOverTime) || [0, 0];
    /* У ленты (Trail) жизни в эмиттере нет: она тянется почти всё правило. */
    const lifeRange =
      first(props.particleLife) ||
      (particle.behaviours?.Trail
        ? [duration * 0.6, duration * 0.9]
        : [0.5, 0.5]);
    /* Свечение с жизнью в сотые доли секунды и тысячами рождений в секунду —
       это один спрайт, который горит, пока эмиттер жив. */
    const continuous = lifeRange[1] < 0.06 && spawn[0] >= 50;
    let count = continuous
      ? 1
      : emitter.oneShot
        ? lerp(spawn[0], spawn[1], next())
        : lerp(spawn[0], spawn[1], next()) * Math.max(0.05, t1 - t0);
    count = clamp(Math.round(count), 0, MAX_PARTICLES);
    /* Нет кадров скорости — движок берёт единицу, а не ноль: клоунские
       ленты летят к цели только этим умолчанием. */
    const speedRange = first(props.speedScalar) || [1, 1];
    const sizeRange = first(props.sizeScalar) || [100, 100];
    const accnRange = first(props.accnScalar) || [100, 100];
    const rotation = particle.behaviours?.Rotation;
    const animation = particle.behaviours?.AnimateTexture;
    const frames = particle.frames || [0, 0];
    for (let index = 0; index < count; index += 1) {
      const share = next();
      const born = continuous
        ? t0
        : emitter.oneShot
          ? t0 + next() * 0.03
          : lerp(t0, t1, next());
      const life = continuous
        ? Math.max(t1 - t0, 0.05)
        : lerp(lifeRange[0], lifeRange[1], next());
      const from = domainPoint(emitter.creation, next);
      const to = emitter.target
        ? domainPoint(emitter.target, next)
        : [from[0], from[1], from[2] + 1];
      const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const length = Math.hypot(...delta) || 1;
      const heading = project(delta.map((value) => value / length));
      const magnitude = Math.hypot(heading.x, heading.y) || 1;
      const initial = pairAt(rotation, "initialAngleMin", "initialAngleMax", 0, share, [0]);
      const spin = pairAt(rotation, "angleMin", "angleMax", 0.5, share, [0]);
      const lastFrame = animation?.lastFrame ?? frames[1] ?? 0;
      const frame0 =
        animation?.randomised || frames[1] > frames[0]
          ? Math.floor(lerp(frames[0], Math.max(frames[0], animation?.randomised ? lastFrame : frames[1]) + 0.999, next()))
          : frames[0];
      particles.push({
        eventIndex,
        born,
        life,
        continuous,
        speed: lerp(speedRange[0], speedRange[1], next()),
        sizeScalar: lerp(sizeRange[0], sizeRange[1], next()) / 100,
        accn: lerp(accnRange[0], accnRange[1], next()) / 100,
        zoom: lerp(event.zoom?.[0] ?? 1, event.zoom?.[1] ?? 1, next()) * ruleZoom,
        direction: { x: heading.x / magnitude, y: heading.y / magnitude },
        drift: magnitude,
        start: project(from),
        angle: ((initial[0] || 0) * Math.PI) / 180,
        spin: ((spin[0] || 0) * Math.PI) / 180,
        frame0,
        share,
        jitter: next(),
      });
      longest = Math.max(longest, born + life);
    }
  });
  /* Размах выброса в метрах — по самой крупной частице правила: плитка
     подбирает по нему масштаб, чтобы облако дымки не залило её целиком. */
  let extent = 0;
  for (const event of rule.events) {
    const props = event.emitterRule?.props || {};
    const sizeRange = first(props.sizeScalar) || [100, 100];
    const whd = event.particleRule?.behaviours?.Size?.props?.whdMax;
    /* Ширина или высота — что больше: у лент и струй ширина нулевая. */
    const widest = Math.max(
      ...(whd || [[0, 0.05]]).map((frame) => Math.max(frame[1] || 0, frame[2] || 0)),
    );
    const zoom = Math.max(event.zoom?.[0] ?? 1, event.zoom?.[1] ?? 1) * ruleZoom;
    extent = Math.max(extent, (widest * Math.max(sizeRange[0], sizeRange[1])) / 100 * zoom);
  }
  return {
    rule,
    particles,
    duration,
    extent,
    /* Сколько сцена ждёт выброс: правило и почти вся жизнь его частиц, но
       не дольше трёх с половиной секунд — брызги висят в игре до шести. */
    seconds: clamp(Math.max(duration, longest * 0.85), 1.15, 3.5),
  };
}

/** Размах выброса слоя в метрах — самая крупная его частица. */
export function impactLayerExtent(settings, zoneId = "body") {
  return preparedLayer(zoneId, settings, "time")?.extent ?? 0;
}

/* ── Время выброса ──────────────────────────────────────────────────────── */

/** Сколько секунд длится один выброс в окне, если правило неизвестно. */
export const BURST_SECONDS = 1.15;

/** Карточка-модель на сцене не мельче четырёх сантиметров. */
const CARD_MIN_METRES = 0.04;

/** Длина выброса слоя — по его правилу и жизни его частиц. */
export function impactBurstSeconds(settings, zoneId = "body") {
  return preparedLayer(zoneId, settings, "time")?.seconds ?? BURST_SECONDS;
}

/** Длина выброса зоны: по самому долгому её слою. */
export const impactZoneSeconds = (zone, zoneId = "body") =>
  Math.max(
    BURST_SECONDS,
    ...(zone?.layers || []).map((layer) => impactBurstSeconds(layer, zoneId)),
  );

/* ── Рисование ──────────────────────────────────────────────────────────── */

/**
 * Рисует выброс ЗОНЫ: слои один поверх другого из одной точки, как в игре.
 *
 * `zone` — настройки зоны со стопкой слоёв; `sprites` — картинки слоёв по их
 * номеру (значок, своя картинка, лист брызг). Дальность «вблизи» меняет
 * размер: сцена и есть взгляд в упор. `placement` — рисовать только одну
 * сторону (спереди или сзади); без него — обе, сзади первыми.
 */
export function drawImpactBurst(
  context,
  {
    x,
    y,
    unit,
    time,
    zone,
    zoneId = "body",
    sprites = {},
    seed = "zone",
    placement = null,
  },
) {
  const layers = zone?.layers || [];
  if (!context || !layers.length) return;
  const near = Number(zone?.distance?.near ?? 1) || 1;
  const order = [
    ...placementLayers(zone, "back"),
    ...placementLayers(zone, "front"),
  ].filter((item) => !placement || (item.layer.placement || "front") === placement);
  const seconds = clamp(time, 0, 1) * impactZoneSeconds(zone, zoneId);
  for (const { layer, index } of order) {
    drawLayerBurst(context, {
      x,
      y,
      unit: unit * near,
      time,
      seconds,
      zoneId,
      settings: layer,
      sprite: sprites[index] || null,
      sheet: sprites[`sheet:${index}`] || null,
      /* Зерно несёт номер слоя: два одинаковых слоя не должны лечь друг в
         друга пятно в пятно. */
      seed: `${seed}:${index}`,
    });
  }
}

/**
 * Рисует выброс одного слоя в точке (`x`, `y`) на момент `time` (0…1 от
 * выброса слоя) или `seconds` (абсолютно). `unit` — пикселей в метре;
 * `sprite` — картинка вида «Картинка»; `sheet` — холст листа брызг (4×4
 * кадра) для слоя крови со своим листом.
 */
export function drawLayerBurst(
  context,
  {
    x,
    y,
    unit,
    time = 0,
    seconds = null,
    zoneId = "body",
    settings,
    sprite = null,
    sheet = null,
    seed = "zone",
  },
) {
  if (!context || !settings) return;
  const prepared = preparedLayer(zoneId, settings, seed);
  if (!prepared) return;
  const now = seconds ?? clamp(time, 0, 1) * prepared.seconds;
  const aim = aimOf(settings);
  context.save();
  if (settings.kind === "blood") drawStain(context, { x, y, unit, now, settings, seed });
  for (const particle of prepared.particles) {
    const age = now - particle.born;
    if (age < 0 || age > particle.life) continue;
    const event = prepared.rule.events[particle.eventIndex];
    const rule = event.particleRule || {};
    const phase = age / particle.life;
    const state = particleState(particle, rule, age, phase, aim, unit, x, y);
    /* Хвост выброса: частица, живущая дольше окна, гаснет на его краю. */
    const tail = clamp((prepared.seconds - now) / 0.25, 0, 1);
    state.alpha *= tail;
    const shape = particleShape(rule, settings);
    /* Толщина ленты лежит в высоте кадра размера: ширина у трейлов нулевая. */
    if (shape === "ribbon") state.width = state.thick;
    if (shape === "card") {
      /* Размер сетки модели в выписке не виден (монета — сантиметры, купюра
         — доли метра относительно своей сетки): карточка не мельче четырёх
         сантиметров, иначе монеты пропадают. Схема, не кадр из игры. */
      const floor = CARD_MIN_METRES * unit;
      if (state.width < floor) {
        state.height *= floor / Math.max(state.width, 1e-6);
        state.width = floor;
      }
    }
    if (state.alpha <= 0.003 || state.width <= 0.2) continue;
    if (shape === "ribbon") {
      drawRibbon(context, particle, rule, age, aim, unit, x, y, state);
      continue;
    }
    if (shape === "card") {
      drawCard(context, state, cardTint(settings));
      continue;
    }
    const canvas = frameFor(rule, settings, particle, phase, state, {
      sprite,
      sheet,
    });
    if (canvas) drawSprite(context, canvas, state);
    else drawFallback(context, rule, particle, state, phase);
  }
  context.restore();
}

/* Положение, размер и цвет частицы в момент её жизни. */
function particleState(particle, rule, age, phase, aim, unit, x, y) {
  const behaviours = rule.behaviours || {};
  /* Куда летит: доворот к метке; длина остаётся — «туда» не значит «быстрее». */
  let { x: dx, y: dy } = particle.direction;
  if (aim) {
    const mixX = dx + (aim.x - dx) * aim.reach;
    const mixY = dy + (aim.y - dy) * aim.reach;
    const mixed = Math.hypot(mixX, mixY) || 1;
    dx = mixX / mixed;
    dy = mixY / mixed;
  }
  const damping = pairAt(behaviours.Dampening, "xyzMin", "xyzMax", phase, particle.share, null);
  const drag = damping ? Math.max(0, (damping[0] + damping[1] + damping[2]) / 3) : 0;
  const travel = drag > 1e-3 ? (1 - Math.exp(-drag * age)) / drag : age;
  const accel = pairAt(behaviours.Acceleration, "xyzMin", "xyzMax", phase * 0.5, particle.share, [0, 0, 0]);
  const gravity = behaviours.Acceleration?.gravity ? -9.81 : 0;
  const push = projectWorld([accel[0], accel[1], accel[2] + gravity]);
  const speed = particle.speed * particle.drift;
  const positionX =
    particle.start.x + dx * speed * travel + 0.5 * push.x * particle.accn * age * age;
  const positionY =
    particle.start.y + dy * speed * travel + 0.5 * push.y * particle.accn * age * age;
  /* Размер: кадры частицы в метрах × множитель эмиттера × масштаб события. */
  const whd = pairAt(behaviours.Size, "whdMin", "whdMax", phase, particle.share, [0.05, 0.05]);
  const scale = particle.sizeScalar * particle.zoom * unit;
  const width = Math.max(0, whd[0] * scale);
  const tall = Math.max(0, (whd[1] || whd[0]) * scale);
  const height = behaviours.Size?.proportional ? width : tall;
  /* Толщина ленты: у трейлов ширина нулевая, а высота — и есть их ширина,
     даже когда размер «пропорциональный». */
  const thick = Math.max(width, tall);
  const colour = pairAt(behaviours.Colour, "rgbaMin", "rgbaMax", phase, particle.share, [1, 1, 1, 1]);
  const emissive = first(behaviours.Colour?.props?.emissiveIntensity)?.[0] > 0;
  return {
    x: x + positionX * unit,
    y: y + positionY * unit,
    vx: dx * speed * Math.exp(-drag * age) + push.x * particle.accn * age,
    vy: dy * speed * Math.exp(-drag * age) + push.y * particle.accn * age,
    width,
    height,
    thick,
    angle: particle.angle + particle.spin * age,
    colour: [
      Math.round(clamp(colour[0], 0, 1) * 255),
      Math.round(clamp(colour[1], 0, 1) * 255),
      Math.round(clamp(colour[2], 0, 1) * 255),
    ],
    alpha: clamp(colour[3] ?? 1, 0, 1),
    blend: rule.blendSet === 1 || emissive ? "lighter" : "source-over",
    emissive,
  };
}

/* Номер кадра листа: рождённый, листаемый со скоростью правила или за жизнь. */
function frameIndex(rule, particle, phase, age) {
  const animation = rule.behaviours?.AnimateTexture;
  if (!animation) return particle.frame0;
  const last = Math.max(0, animation.lastFrame ?? particle.frame0);
  if (animation.scaledOverLife) return Math.min(last, Math.floor(phase * (last + 1)));
  const rate = sampleFrames(animation.props?.animRate, phase);
  const speed = rate ? lerp(rate[0], rate[1], particle.share) : 0;
  const advanced = particle.frame0 + speed * age;
  if (animation.loopMode === 1) return Math.floor(advanced) % (last + 1);
  return Math.min(last, Math.floor(advanced));
}

/*
 * Кадр, которым рисуется частица: своя картинка, свой лист брызг, лист игры
 * (нейтральная копия — для кровяной пыли, как в клоне) или ничего, когда
 * листов игры нет.
 */
function frameFor(rule, settings, particle, phase, state, { sprite, sheet }) {
  const texture = String(rule.texture || "");
  const tint = state.colour;
  if (texture === PICTURE_TEXTURE) return sprite || null;
  const age = phase * particle.life;
  if (texture === SHEET_TEXTURE) {
    if (!sheet) return null;
    const style = findBloodSheet(settings.sheet);
    const frames = sheet.columns * sheet.rows;
    const index = style?.animated
      ? Math.min(frames - 1, Math.floor(phase * frames))
      : Math.floor(particle.jitter * frames) % frames;
    return bloodSheetFrame(sheet, index, tint);
  }
  if (!texture) return null;
  const neutral = texture.toLowerCase() === ASTRAL_BLOOD_SPRAY_TEXTURE;
  const game = gameSheet(neutral ? BLOOD_SPRAY_TEXTURE : texture, { neutral });
  if (!game) return null;
  return bloodSheetFrame(game, frameIndex(rule, particle, phase, age), tint);
}

function drawSprite(context, canvas, state) {
  const { width, height, x, y, angle, alpha, blend } = state;
  if (width < 0.5 && height < 0.5) return;
  context.globalCompositeOperation = blend;
  context.globalAlpha = clamp(state.emissive ? alpha * 1.25 : alpha, 0, 1);
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  /* Кадр листа — квадрат, а размер частицы — ширина и высота в метрах. */
  const aspect = canvas.height / (canvas.width || 1);
  const drawWidth = Math.max(1, width);
  const drawHeight = Math.max(1, height || width * aspect);
  context.drawImage(canvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
}

/*
 * Чем рисуется частица: спрайтом (кадр листа), лентой (трейл или
 * отрезок-модель снайперской крови) или карточкой (плоская модель — купюра,
 * монета, перо, лист, обрывок бумаги). У модели в выписке нет имени, только
 * число, и отрезок от карточки отличает вид слоя: модель в правилах крови —
 * всегда отрезок ленты, в эффектах игры — плоский предмет.
 */
function particleShape(rule, settings) {
  if (rule.drawType === 2) return "ribbon";
  if (rule.drawType === 1) return settings.kind === "blood" ? "ribbon" : "card";
  return "sprite";
}

/* Цвет карточки-модели: свой цвет слоя, иначе цвет эффекта из каталога. */
function cardTint(settings) {
  if (settings.tinted && settings.colour) return rgb(settings.colour);
  if (settings.kind !== "template") return null;
  const item = findImpactTemplate(settings.template);
  return item?.colour ? rgb(item.colour) : null;
}

/*
 * Плоская модель схемой: карточка размером с частицу, вертится по правилу.
 * Ребро чуть темнее — без него белый прямоугольник читается как пятно.
 */
function drawCard(context, state, tint) {
  const { x, y, width, height, angle, alpha } = state;
  const colour = tint || state.colour;
  const cardWidth = Math.max(1, width);
  const cardHeight = Math.max(1, height || width * 0.6);
  context.save();
  context.globalCompositeOperation = "source-over";
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = paint(colour, alpha);
  context.fillRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
  context.strokeStyle = paint(colour.map((value) => Math.round(value * 0.55)), alpha);
  context.lineWidth = Math.max(0.6, cardWidth * 0.06);
  context.strokeRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
  context.restore();
}

/*
 * Лента и отрезок: клоунские ленты (трейл) и лента-клякса снайперского
 * хедшота (модель-отрезок) — след по пути частицы, широкий у головы и
 * сходящий на нет к хвосту.
 */
function drawRibbon(context, particle, rule, age, aim, unit, x, y, state) {
  const points = [];
  for (let step = 0; step <= RIBBON_STEPS; step += 1) {
    const past = age - (age * step) / RIBBON_STEPS;
    const at = particleState(particle, rule, past, past / particle.life, aim, unit, x, y);
    points.push([at.x, at.y]);
  }
  const width = Math.max(2, state.width * 0.6);
  context.globalCompositeOperation = state.blend;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let index = 1; index < points.length; index += 1) {
    const taper = 1 - (index - 1) / points.length;
    context.strokeStyle = paint(state.colour, state.alpha * (0.35 + 0.65 * taper));
    context.lineWidth = Math.max(1, width * (0.4 + 0.6 * taper));
    context.beginPath();
    context.moveTo(points[index - 1][0], points[index - 1][1]);
    context.lineTo(points[index][0], points[index][1]);
    context.stroke();
  }
  context.globalCompositeOperation = "source-over";
}

/*
 * Мокрое пятно у раны. Не гаснет вместе с частицами: в игре декаль остаётся
 * на теле, и именно она отличает попадание от вспышки. Форма неровная — три
 * наложенных эллипса; ровный круг читается как метка интерфейса.
 */
function drawStain(context, { x, y, unit, now, settings, seed }) {
  const next = random(hashSeed(`${seed}:stain`));
  const colour = rgb(settings.colour);
  const size = unit * lerp(0.035, 0.075, next()) * (0.7 + settings.amount * 0.6);
  const delay = 0.02 + next() * 0.1;
  const fade = clamp((now - delay) * 7, 0, 1) * 0.55 * settings.opacity;
  if (fade <= 0) return;
  const turn = next() * TAU;
  context.globalCompositeOperation = "source-over";
  context.fillStyle = paint(colour, fade);
  for (let blob = 0; blob < 3; blob += 1) {
    const away = size * 0.32 * blob;
    const swing = turn + blob * 2.1;
    context.beginPath();
    context.ellipse(
      x + Math.cos(swing) * away,
      y + Math.sin(swing) * away * 0.5,
      size * (1 - blob * 0.18),
      size * (0.62 - blob * 0.1),
      swing,
      0,
      TAU,
    );
    context.fill();
  }
}

/* ── Схема вместо листа ─────────────────────────────────────────────────── */

/*
 * Без листов игры (браузер, тесты) частица рисуется схемой по семейству
 * листа: брызги — комком, дым — клубом, свечение — вспышкой, звёзды —
 * звёздочкой. Семейство узнаётся по имени текстуры правила.
 */
const FAMILIES = Object.freeze([
  [/ribbon/i, "streak"],
  [/blood_spray|blood_spurt|blood_squib|water_jets|water_splash|gloop|glass_dots|debris|rubble|mist|steam|cig_smoke/i, "clump"],
  [/glow|flare|muzzle|star_rgb|fireball|explosion/i, "flash"],
  [/smoke|billow|wispy/i, "puff"],
  [/fire|flame|ember/i, "flame"],
  [/sparks_arcing/i, "bolt"],
  [/clown_symbols|clown_flower|starburst/i, "starburst"],
]);

function familyOf(texture) {
  const name = String(texture || "");
  if (!name) return "chip";
  for (const [pattern, family] of FAMILIES) if (pattern.test(name)) return family;
  return "dot";
}

function drawFallback(context, rule, particle, state, phase) {
  const { x, y, width, colour, alpha, angle } = state;
  const size = Math.max(1, width);
  context.globalCompositeOperation = state.blend;
  switch (familyOf(rule.texture)) {
    case "clump": {
      const radius = size / 2;
      const seed = random(Math.round(particle.jitter * 1e6) >>> 0);
      context.fillStyle = paint(colour, alpha);
      for (let blob = 0; blob < 9; blob += 1) {
        const away = Math.sqrt(seed()) * radius;
        const turn = seed() * TAU;
        const speck = radius * (0.08 + seed() * 0.16) * (1 - away / radius / 2);
        context.beginPath();
        context.arc(
          x + Math.cos(turn) * away,
          y + Math.sin(turn) * away,
          Math.max(0.6, speck),
          0,
          TAU,
        );
        context.fill();
      }
      return;
    }
    case "puff":
    case "flash":
    case "flame": {
      const radius = size / 2;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, paint(colour, alpha));
      gradient.addColorStop(0.5, paint(colour, alpha * 0.45));
      gradient.addColorStop(1, paint(colour, 0));
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
      return;
    }
    case "bolt": {
      const next = random(hashSeed(`${particle.jitter}:${Math.floor(phase * 12)}`));
      context.strokeStyle = paint(colour, alpha);
      context.lineWidth = Math.max(1, size * 0.08);
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(x, y);
      for (let step = 1; step <= 6; step += 1) {
        const along = (size * step) / 6;
        const aside = (next() - 0.5) * size * 0.3;
        context.lineTo(
          x + Math.cos(angle) * along - Math.sin(angle) * aside,
          y + Math.sin(angle) * along + Math.cos(angle) * aside,
        );
      }
      context.stroke();
      return;
    }
    case "starburst": {
      context.fillStyle = paint(colour, alpha);
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      for (let ray = 0; ray < 5; ray += 1) {
        context.rotate(TAU / 5);
        context.beginPath();
        context.moveTo(0, -size * 0.06);
        context.lineTo(size / 2, 0);
        context.lineTo(0, size * 0.06);
        context.closePath();
        context.fill();
      }
      context.restore();
      return;
    }
    case "streak": {
      const tail = clamp(Math.hypot(state.vx, state.vy) * 0.05, 0.01, 0.2);
      const length = Math.hypot(state.vx, state.vy) || 1;
      context.strokeStyle = paint(colour, alpha);
      context.lineWidth = Math.max(1, size * 0.5);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - (state.vx / length) * tail * size * 4, y - (state.vy / length) * tail * size * 4);
      context.stroke();
      return;
    }
    case "chip": {
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.fillStyle = paint(colour, alpha);
      context.fillRect(-size / 2, -size / 4, size, size / 2);
      context.restore();
      return;
    }
    default: {
      context.fillStyle = paint(colour, alpha);
      context.beginPath();
      context.arc(x, y, Math.max(0.8, size / 2), 0, TAU);
      context.fill();
    }
  }
  context.globalCompositeOperation = "source-over";
}

/* ── Картинки зоны ──────────────────────────────────────────────────────── */

const spriteCache = createLruCache(64);

/* `options` — те же, что у `context2d`: холст, из которого будут читать,
   заводится с `READBACK` при первом же контексте. */
function blankCanvas(size, options) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return context2d(canvas, options) ? canvas : null;
}

/** Готовый значок на холсте — теми же контурами, что соберёт установщик. */
function glyphCanvas(id, colour, size) {
  const shape = findImpactPictureShape(id);
  const canvas = blankCanvas(size);
  if (!shape || !canvas || typeof Path2D === "undefined") return null;
  const context = context2d(canvas);
  const { scale, offset } = impactPictureFrame(size);
  const outline = IMPACT_PICTURE_OUTLINE;
  context.translate(offset, offset);
  context.scale(scale, scale);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = `rgba(0, 0, 0, ${outline.opacity})`;
  for (const d of shape.fill) {
    context.lineWidth = outline.width * 2;
    context.stroke(new Path2D(d));
  }
  for (const d of shape.stroke) {
    context.lineWidth = shape.strokeWidth + outline.width * 2;
    context.stroke(new Path2D(d));
  }
  context.fillStyle = colour;
  for (const d of shape.fill)
    context.fill(new Path2D(d), shape.fillRule || "nonzero");
  context.strokeStyle = colour;
  context.lineWidth = shape.strokeWidth;
  for (const d of shape.stroke) context.stroke(new Path2D(d));
  context.fillStyle = `rgba(0, 0, 0, ${outline.opacity})`;
  for (const d of shape.detail) context.fill(new Path2D(d));
  return canvas;
}

/** Картинка человека на холсте — как она есть; цвет ей даёт правило. */
function uploadCanvas(upload, size) {
  const canvas = blankCanvas(size);
  if (!canvas || !upload?.canvas) return null;
  const context = context2d(canvas);
  context.drawImage(upload.canvas, 0, 0, size, size);
  return canvas;
}

/**
 * Спрайт вида «Картинка» для зоны: значок из набора или картинка человека —
 * белый, как лист в ядре: цвет (один, два, радуга) ему даёт правило, и сцена
 * умножает кадр на цвет частицы так же. `upload` — `{ canvas, key }` из
 * `effects-stamp.js`; `null`, когда рисовать нечем.
 */
export function impactPictureSprite(settings, upload = null, size = 192) {
  if (settings?.kind !== "custom") return null;
  const key =
    settings.picture === "upload"
      ? `upload:${upload?.key || ""}:${size}`
      : `glyph:${settings.picture}:${size}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const sprite =
    settings.picture === "upload"
      ? uploadCanvas(upload, size)
      : glyphCanvas(settings.picture, "#ffffff", size);
  if (sprite) spriteCache.set(key, sprite);
  return sprite;
}

/* ── Плитки выбора ──────────────────────────────────────────────────────── */

const thumbnailCache = createLruCache(160);

/*
 * Какой миг выброса стоит на плитке — доля его длины. Вспышка живёт десятую
 * долю секунды, кровь — секунды: общая доля у вспышки дала бы пустую плитку.
 */
const THUMBNAIL_TIME = Object.freeze({
  flash: 0.04,
  star: 0.05,
  electric: 0.1,
  sparks: 0.12,
  explosion: 0.13,
  fire: 0.16,
  clown: 0.12,
  /* Свечение клоунской пули ярче всего на середине жизни ореола: эмиссия
     донора — пик 11 на 0,57 его жизни (0,4–0,6 с), правило — 2,25 с. */
  glow: 0.12,
});
const DEFAULT_THUMBNAIL_TIME = 0.22;

function thumbnailTime(settings) {
  if (settings.kind !== "template") return DEFAULT_THUMBNAIL_TIME;
  const preview = findImpactTemplate(settings.template)?.preview;
  return THUMBNAIL_TIME[preview] ?? DEFAULT_THUMBNAIL_TIME;
}

/**
 * Кадр СЛОЯ для плитки выбора — data-URL или `null`, когда рисовать некуда
 * (jsdom в тестах): плитка остаётся с подписью, редактор не падает.
 */
export function impactThumbnail(
  settings,
  { size = 96, time = thumbnailTime(settings), upload = null, zoneId = "body" } = {},
) {
  const sheet =
    settings.kind === "blood" ? bloodSheet(settings.sheet, upload) : null;
  /*
   * Кадр движка частиц — тот же клон и те же листы, что у сцены и в игре.
   * Доля выброса переводится в секунды его обычной длины. Схема ниже —
   * только там, где движка нет (нет WebGL или базы игры); `null` — листы
   * ещё грузятся, плитка перерисуется по готовности.
   */
  const custom = settings.kind === "custom";
  const tile = thumbnailEngine?.(
    { ...settings, opacity: 1, ...(custom ? { count: 1 } : {}) },
    {
      zoneId,
      size,
      time: time * BURST_SECONDS,
      extent: custom
        ? customPictureSize(settings.amount) * 1.5
        : Math.min(Math.max(impactLayerExtent(settings, zoneId) * 1.25, 0.6), 4),
      art: custom ? impactPictureSprite(settings, upload, 256) : sheet,
      key: upload?.key || "",
    },
  );
  if (tile !== undefined) return tile;
  const key = JSON.stringify([
    settings,
    size,
    time,
    upload?.key || "",
    zoneId,
    liveRules ? "live" : "baked",
    /* Лист грузится позже плитки: пока его нет, кадр рисуется без него, и
       кэш обязан это различать — иначе плитка навсегда останется пустой. */
    Boolean(sheet),
  ]);
  if (thumbnailCache.has(key)) return thumbnailCache.get(key);
  /* Кадр запасной схемы сжимается в PNG — из холста читают. В видеопамяти
     это синхронная выгрузка с видеокарты, 115–140 мс на плитку. */
  const canvas = blankCanvas(size, READBACK);
  if (!canvas) return null;
  const context = context2d(canvas);
  const picture = settings.kind === "custom";
  /* Крупный эффект (облако дымки в несколько метров) плитка ужимает, чтобы
     он в неё поместился; мелкие идут одним масштабом — метр с небольшим. */
  const extent = picture ? 0 : impactLayerExtent(settings, zoneId);
  drawLayerBurst(context, {
    x: size / 2,
    /* Выброс летит вверх — точка попадания стоит ниже середины плитки. */
    y: picture ? size * 0.56 : size * 0.7,
    /* Значок занимает плитку, частицы — метр с небольшим. */
    unit: picture
      ? (size * 0.82) / customPictureSize(settings.amount)
      : Math.min(size / 1.25, (size * 0.9) / Math.max(extent, 0.3)),
    time,
    zoneId,
    settings: { ...settings, opacity: 1, ...(picture ? { count: 1 } : {}) },
    sprite: picture ? impactPictureSprite(settings, upload, size * 2) : null,
    sheet,
    seed: "tile",
  });
  let url = null;
  try {
    url = canvas.toDataURL("image/png");
  } catch {
    url = null;
  }
  thumbnailCache.set(key, url);
  return url;
}

/** Сбросить кадры плиток: листы игры приехали, и кадры обязаны обновиться. */
export function resetImpactThumbnails() {
  thumbnailCache.clear();
}

/** Цвет слоя: чем он отметится в игре. */
export function impactLayerAccent(layer) {
  if (!layer) return "#64748b";
  if (layer.kind === "blood") return layer.colour;
  if (layer.kind === "custom") return layer.tinted ? layer.colour : "#f8fafc";
  const item = findImpactTemplate(layer.template);
  return layer.tinted && item?.tint ? layer.colour : item?.colour || "#f8fafc";
}

/**
 * Цвет зоны на силуэте и в пресетах: чем она отметится в игре.
 * У стопки слоёв это цвет нижнего — того, что в бою видно первым.
 */
export function impactAccent(zone) {
  const layers = zone?.layers;
  if (!layers) return impactLayerAccent(zone);
  if (!layers.length) return "#64748b";
  return impactLayerAccent(layers[0]);
}

/**
 * Картинки слоёв зоны для сцены: значки, свои картинки и листы брызг.
 * `pictures` — снимки человека по ключу «зона:слой» (`effects-stamp.js`).
 */
export function impactZoneSprites(zoneId, zone, pictures = null) {
  const sprites = {};
  (zone?.layers || []).forEach((layer, index) => {
    const upload = pictures?.[layerPictureKey(zoneId, index)] || null;
    if (layer.kind === "custom")
      sprites[index] = impactPictureSprite(layer, upload);
    if (layer.kind === "blood") {
      const sheet = bloodSheet(layer.sheet, upload);
      if (sheet) sprites[`sheet:${index}`] = sheet;
    }
  });
  return sprites;
}
