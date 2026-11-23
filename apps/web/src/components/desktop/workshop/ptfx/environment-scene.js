/*
 * Объёмное превью «Огня и взрывов» (задача 7 ТЗ 05.10.2026): не лист, а сам
 * эффект игры — пожар, пламя, взрыв, дым — в 3D.
 *
 * Эффект — правило ядра игрока, которое рисует листы выбранного семейства
 * (`pickEnvironmentEffect`, выгрузка помощника в главном процессе), и
 * проигрывает его тот же движок RMPTFX окна, что у попаданий и фонарей
 * (`ptfx-renderer.js`). Листы — штатные листы ядра; правка семейства ложится
 * на них ТОЙ ЖЕ функцией, что у установщика (`applyFamilyTint`): ползунок
 * перекрашивает пламя в кадре сразу, без пересборки эффекта и без мигания.
 *
 * Фон — матовый, как у остальных кадров мастерской, с тонкой белой сеткой на
 * земле, как у воды: их рисует шейдер сцены (холст движка непрозрачный), в
 * отображаемых цветах через обратную плёночную кривую — экспозиция кадра их
 * не трогает. Камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ —
 * вокруг, щелчок ПКМ — полёт, колесо — ближе и дальше.
 *
 * Эффекты с конечным циклом встают заново, как в игре зарегистрированный
 * эффект; короткие (взрыв, вспышка) — с паузой, чтобы было видно начало.
 */

import {
  EffectInstance,
  effectFrame,
  loadModel,
  modelBatches,
  shaderValue,
  spriteBatches,
  trailBatches,
} from "@modovik/ptfx-runtime";
import { ENVIRONMENT_FAMILIES, familyChanged } from "@modovik/ptfx-studio";
import { tr } from "../../../../locales/ui.js";
import { setPngSource } from "../../../../utils/png-source.js";
import { createStageCamera } from "../../../../features/workshop/model-stage/stage-camera.js";
import { READBACK, context2d } from "../effects-preview.js";
import { MATTE_FLOOR_FRAGMENT as SCENE_FRAGMENT, matteFloorUniforms } from "./matte-floor.js";
import { sceneLighting } from "./ptfx-lighting.js";
import { createPtfxRenderer } from "./ptfx-renderer.js";
import { createSheetTinter } from "./environment-tint.js";
import { createTextureBank } from "./ptfx-textures.js";
import { WEAPON_MESH, loadWeaponMesh } from "./ptfx-weapon.js";

const MAX_STEP = 0.05;
/* Сколько прогнать зацикленный эффект перед показом: пожар не должен
   разгораться у человека на глазах при каждой смене семейства. */
const WARMUP_SECONDS = 3;
/* Взрыв — заново через паузу: иначе он мелькал бы без перерыва и начала
   было бы не разглядеть. */
const REPLAY_PAUSE = 1.2;

/*
 * Как показывать семейство (задача 3 ТЗ 06.10.2026). Короткий эффект с
 * паузой между повторами мелькал раз в секунду и терялся: вспышка выстрела —
 * очередью из ствола Astral («зажатый спуск»): вспышка живёт около 0,07 с,
 * новый выстрел — каждые 0,04 с, и огонь у дула не гаснет между выстрелами,
 * короткие искры и вспышки — частыми повторами внахлёст, редкий
 * зацикленный (треск проводки) — несколькими копиями вразнобой.
 *   `burst` — через сколько секунд новый выстрел, даже если прежний не догорел;
 *   `copies` — сколько копий зацикленного эффекта идёт разом;
 *   `weapon` — ствол дулом в точке эффекта, `height` — её высота, м.
 */
const PLAYBACK = Object.freeze({
  muzzle: Object.freeze({ burst: 0.04, weapon: true, height: 1.1 }),
  "impact-flash": Object.freeze({ burst: 0.22 }),
  glow: Object.freeze({ burst: 0.3, copies: 3 }),
  sparks: Object.freeze({ burst: 0.35, copies: 2 }),
  candle: Object.freeze({ burst: 0.35 }),
  flare: Object.freeze({ burst: 0.5 }),
});
const playbackOf = (family) => PLAYBACK[family] || {};
/* Копий эффекта в кадре разом: у очереди с дымом их набирается с десяток. */
const MAX_INSTANCES = 14;
/* Кадр по эффекту: свечу в три сантиметра не видно с полутора метров. */
const MIN_SPAN = 0.06;
const MIN_DISTANCE = 0.14;
/*
 * Частицы игры гаснут у камеры (`camerashrink`: размер и альфа × расстояние ×
 * множитель): у горелки множитель 0,1 — в полную силу она видна только с
 * 10 м, а с метра от неё остаётся десятая часть. Мелкий эффект поэтому
 * показывается крупнее (как `scale` у натива игры) и с того расстояния, где
 * ужатия нет, — не больше чем в `MAX_SCALE` раз.
 */
const MAX_SCALE = 12;
/* Ствол в ночной сцене светлее своего листа — иначе его видно лишь во вспышке. */
const WEAPON_LIFT = 3.2;

/* Поворот, ведущий направление `from` в +X (Родриг), — к вектору `vector`. */
function rotateTo(from, vector) {
  const axis = [0, from[2], -from[1]];
  const sin = Math.hypot(...axis);
  const cos = from[0];
  if (sin < 1e-6) return cos > 0 ? [...vector] : [-vector[0], -vector[1], vector[2]];
  const k = axis.map((value) => value / sin);
  const angle = Math.atan2(sin, cos);
  const cross = [
    k[1] * vector[2] - k[2] * vector[1],
    k[2] * vector[0] - k[0] * vector[2],
    k[0] * vector[1] - k[1] * vector[0],
  ];
  const dot = k[0] * vector[0] + k[1] * vector[1] + k[2] * vector[2];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vector.map((value, index) => value * c + cross[index] * s + k[index] * dot * (1 - c));
}
/* Час таймцикла для света частиц и фиксированная экспозиция кадра: днём
   пламя тускнеет (EV −2,9), ночью — выгорает (EV +2,6). */
const HOUR = 21;
const EXPOSURE_EV = 0.6;
/* Эволюции, что не про дальность и угол, — на полную: «сила» и «топливо»
   пожара, «тяга» форсажа. По нулю пожар был бы тлеющей искрой. */
const DISTANCE_EVOLUTIONS = new Set(["LOD", "angle"]);

/* Матовый фон с сеткой на земле — общий с кадром дыма из-под колёс (`matte-floor.js`). */
const sceneUniforms = (lighting) => matteFloorUniforms(lighting);

/* Лист текстуры → его семейство окружения. */
const FAMILY_OF = new Map(
  ENVIRONMENT_FAMILIES.flatMap((family) => family.textures.map((name) => [name.toLowerCase(), family.id])),
);

function lightingFor(light) {
  const base = sceneLighting({ light, hour: HOUR });
  return {
    ...base,
    particleExposure: 1,
    post: { ...base.post, ev: EXPOSURE_EV, exposure: 2 ** EXPOSURE_EV, bloomIntensity: 0.3 },
  };
}

/* Пиксели штатного листа (PNG из главного процесса) — один раз на лист. */
function decodeSheet(sheet) {
  if (!sheet?.png || typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = context2d(canvas, READBACK);
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ rgba: data.data, width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    setPngSource(image, sheet.png);
  });
}

const signatureOf = (settings) =>
  settings && familyChanged(settings)
    ? `${settings.tint}|${settings.tintStrength}|${settings.brightness}|${settings.opacity}|${settings.remove === true ? "remove" : ""}`
    : "";


/**
 * Поиск листов с выбором одного: частица с другим листом пропадает — `spriteBatches` пропускает правило, у
 * которого листа нет; ствол вспышки выстрела — не лист семейства и остаётся. `only` — имя текстуры строчными,
 * пусто — все листы.
 *
 * Лист, которого выбранный эффект не рисует (`drawn` — листы его правил, строчными; «Искры» рисуют один из трёх),
 * не остаётся пустым кадром (ТЗ 23.10.2026, п. D: «Лист 1 / 3» были серыми): его рисуют частицы эффекта — каждое
 * правило со спрайтом берёт этот лист вместо своего, с его сеткой кадров.
 */
export function sheetLookup(only, lookup, drawn = null) {
  if (!only) return lookup;
  const substitute = Array.isArray(drawn) && drawn.length > 0 && !drawn.includes(only);
  return (name) => {
    if (!name) return lookup(name);
    const lower = String(name).toLowerCase();
    if (lower === only || lower.startsWith(WEAPON_MESH)) return lookup(name);
    return substitute ? lookup(only) : null;
  };
}

/**
 * Сцена на холсте. `onStatus({ effect, failures, scale })` — какой эффект в
 * кадре, что не собралось и во сколько раз он крупнее, чем в игре;
 * `onCamera(mode, info)` — режим общей камеры; `zoom` — приближение рамки
 * (у обложки карточки пламя — во всю плитку).
 */
export function createEnvironmentScene({ canvas, onStatus = null, onCamera = null, zoom = 1, share = true }) {
  let lighting = lightingFor(null);
  /* `share: false` — свой контекст (обложка полки: рендерер окна она не держит). */
  const renderer = createPtfxRenderer({ canvas, lighting, share });
  const bank = createTextureBank({
    onReady: () => {
      dirty = true;
      wake();
    },
  });
  let size = { width: 0, height: 0 };
  let base = null;
  let model = null;
  let family = "";
  let effectName = "";
  let environment = {};
  /* Копии эффекта в кадре: `{ effect, slot }`; по номеру копии держатся
     пачки рисовальщика. */
  let instances = [];
  let pause = 0;
  let shotClock = 0;
  let generation = 0;
  let failures = [];
  let running = false;
  let frame = 0;
  let last = 0;
  let dirty = true;
  let stillFrame = 0;
  /* Поворот эффекта: ось вспышки — вдоль ствола (+X); `null` — как в ядре. */
  let flashTurn = null;
  /* Ствол у «Вспышек выстрелов»: `{ mesh, sheets, length }`. */
  let weapon = null;
  let weaponLoading = null;
  let baseMeshes = {};
  /* Во сколько раз эффект в кадре крупнее, чем в игре (см. `MAX_SCALE`). */
  let effectScale = 1;
  /* Лист семейства, показанный один (имя текстуры, строчными); пусто — все листы эффекта. */
  let onlySheet = "";
  /* Листы, которые выбранный эффект действительно рисует: по ним переключатель листов знает пустые. */
  let drawnSheets = [];
  /* Перекрашенные листы: имя → { signature, canvas, grid }; разбор — один раз. */
  const pixels = new Map();
  const tinted = new Map();
  /* Листы, что красятся сейчас, и номер базы: перекраска прежней базы не ложится на новую. */
  const painting = new Set();
  let paintRun = 0;
  const tinter = createSheetTinter();

  const eye = createStageCamera({
    camera: renderer.camera,
    canvas,
    up: "z",
    /* Вид камеры переживает спячку окна (`features/hibernation/stage-views.js`). */
    memoryKey: "workshop:ptfx-environment",
    onChange: () => {
      dirty = true;
      wake();
    },
    onKick: () => wake(),
    onMode: (mode, info) => onCamera?.(mode, info),
  });

  const report = () => onStatus?.({ effect: effectName, failures: [...failures], scale: effectScale, textures: [...drawnSheets] });

  /* Листы, что рисует выбранный эффект: текстуры правил частиц его событий (по данным, а не по тому, что успело родиться), строчными. */
  function sheetsOfEffect() {
    const names = new Set();
    for (const event of model?.effects?.get(effectName)?.events || []) {
      const name = model.particles?.get(event.particle)?.textures?.diffuse;
      if (name) names.add(String(name).toLowerCase());
    }
    return [...names];
  }

  function applyLighting() {
    renderer.setLighting(lighting);
    renderer.setSceneShader({ fragmentShader: SCENE_FRAGMENT, uniforms: sceneUniforms(lighting) });
    dirty = true;
  }
  applyLighting();

  function resize(width, height, ratio = 1) {
    const next = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
    if (next.width === size.width && next.height === size.height) return;
    size = next;
    renderer.resize(size.width, size.height, ratio);
    applyLighting();
    wake();
  }

  /* Эффект для показа — в начале координат, «вверх» эффекта — вверх мира. */
  function evolutionsFor(rule, lod) {
    const out = { LOD: lod };
    const names = new Set([
      ...(rule?.evolutions?.names || []),
      ...(rule?.events || []).flatMap((event) => event.evolutions?.names || []),
    ]);
    for (const name of names) if (!DISTANCE_EVOLUTIONS.has(name)) out[name] = 1;
    return out;
  }

  const originOf = () => [0, 0, playbackOf(family).height || 0];

  function lodOf() {
    const rule = model?.effects?.get(effectName);
    const { min, max } = rule?.lod || {};
    if (!(max > min)) return 0;
    const camera = renderer.camera.position;
    const origin = originOf();
    /* Крупный эффект смотрят издалека — дальность для ступени как в игре. */
    const distance =
      Math.hypot(camera.x - origin[0], camera.y - origin[1], camera.z - origin[2] - 1) / effectScale;
    return Math.min(Math.max((distance - min) / (max - min), 0), 1);
  }

  function newInstance(turn = flashTurn) {
    const rule = model.effects.get(effectName);
    generation += 1;
    const axes = turn || { z: [0, 0, 1], up: [0, 1, 0] };
    return new EffectInstance(model, effectName, {
      frame: effectFrame({ origin: originOf(), z: axes.z, up: axes.up }),
      scale: effectScale,
      seed: (0x9e3779b9 ^ generation) >>> 0,
      evolutions: evolutionsFor(rule, lodOf()),
      ground: 0,
      wind: [0.4, 0.15, 0],
      loop: true,
    });
  }

  /* Новая копия эффекта на свободном номере; `null` — копий уже полно. */
  function spawn() {
    const used = new Set(instances.map((entry) => entry.slot));
    let slot = 0;
    while (used.has(slot)) slot += 1;
    if (slot >= MAX_INSTANCES) return null;
    const entry = { effect: newInstance(), slot };
    instances.push(entry);
    return entry;
  }

  const looping = () => {
    const rule = model?.effects?.get(effectName);
    return Boolean(rule && rule.loops < 0);
  };

  /*
   * Частицы копии за первые `seconds` секунд: точки с размером; `own` —
   * частица рисует лист этого семейства (у фальшфейера — ореол, а не дым).
   */
  function sampleParticles(effect, seconds, limit = 6000) {
    const points = [];
    for (let time = 0, step = 0; time < seconds; time += 1 / 30, step += 1) {
      effect.step(1 / 30);
      if (step % 2) continue;
      for (const slot of effect.slots()) {
        const own = FAMILY_OF.get(String(slot.rule.textures?.diffuse || "").toLowerCase()) === family;
        for (const particle of slot.particles) {
          if (points.length >= limit) return points;
          points.push({ position: [...particle.position], size: Number(particle.size?.[0]) || 0, own });
        }
      }
    }
    return points;
  }

  /*
   * Вспышка выстрела летит вдоль своей оси, а ствол в кадре лежит по +X:
   * ось находится по частицам первой десятой доли секунды, и эффект
   * поворачивается так, чтобы она смотрела из дула.
   */
  function turnTowardsBarrel() {
    flashTurn = null;
    if (!playbackOf(family).weapon) return;
    const origin = originOf();
    const points = sampleParticles(newInstance(null), 0.12);
    const mean = [0, 0, 0];
    for (const { position } of points) for (let axis = 0; axis < 3; axis += 1) mean[axis] += position[axis] - origin[axis];
    const reach = Math.hypot(...mean);
    if (!points.length || reach < 1e-5) return;
    const from = mean.map((value) => value / reach);
    flashTurn = { z: rotateTo(from, [0, 0, 1]), up: rotateTo(from, [0, 1, 0]) };
  }

  /*
   * Рамка камеры по самому эффекту: где были частицы за первые секунды (без
   * крайних 5 % по каждой оси) — так и свеча в три сантиметра встаёт во весь
   * кадр, и пожар. У вспышки выстрела в кадре и передняя половина ствола.
   */
  /* Ужатие у камеры эффекта: наименьший ненулевой множитель его частиц. */
  function shrinkOf() {
    let least = 0;
    for (const event of model?.effects?.get(effectName)?.events || []) {
      const rule = model.particles.get(event.particle);
      if (!rule) continue;
      let most = 0;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) most = Math.max(most, shaderValue(rule, "camerashrink", t, 0));
      if (most > 0) least = least ? Math.min(least, most) : most;
    }
    return least;
  }

  function frameEffect(points) {
    eye.setFrame(framing(points));
  }

  /* Рамка камеры: цель, расстояние, вид — по частицам самого семейства. */
  function framing(all) {
    const own = all.filter((point) => point.own);
    const points = own.length >= 4 ? own : all;
    const play = playbackOf(family);
    const origin = originOf();
    const low = [...origin];
    const high = [...origin];
    if (points.length >= 4) {
      for (let axis = 0; axis < 3; axis += 1) {
        const values = points
          .flatMap(({ position, size: grow }) => [position[axis] - grow / 2, position[axis] + grow / 2])
          .sort((left, right) => left - right);
        const at = (share) => values[Math.min(values.length - 1, Math.floor(values.length * share))];
        low[axis] = Math.min(low[axis], at(0.05));
        high[axis] = Math.max(high[axis], at(0.95));
      }
    } else {
      low[2] = origin[2];
      high[2] = origin[2] + 2;
      low[0] = low[1] = -0.5;
      high[0] = high[1] = 0.5;
    }
    if (play.weapon && weapon) {
      /* Передняя треть ствола и вспышка: она — главное в кадре. */
      const length = weapon.length * effectScale;
      low[0] = Math.min(low[0], origin[0] - length * 0.34);
      low[2] = Math.min(low[2], origin[2] - length * 0.12);
      high[2] = Math.max(high[2], origin[2] + length * 0.06);
    }
    const target = low.map((value, axis) => (value + high[axis]) / 2);
    const span = Math.max(MIN_SPAN, high[0] - low[0], high[1] - low[1], high[2] - low[2]);
    const fov = 40;
    const distance = Math.max(MIN_DISTANCE, ((span / 0.65) * 0.5) / Math.tan((fov * Math.PI) / 360));
    return {
      target: [target[0], target[1], Math.max(target[2], Math.min(0.4, span * 0.45))],
      radius: distance,
      view: { yaw: play.weapon ? 0.42 : 0.55, pitch: play.weapon ? 0.12 : 0.18, zoom },
      zoomRange: [0.3, 3],
      pitchRange: [-0.05, 1.3],
      distance: (zoom) => distance * zoom,
      fov,
      bounds: { min: [-40, -40, 0.01], max: [40, 40, 30] },
      floor: Math.min(0.05, span * 0.2),
    };
  }

  function place() {
    failures = [];
    instances = [];
    pause = 0;
    shotClock = 0;
    drawnSheets = [];
    if (!model || !effectName || !model.effects.has(effectName)) {
      if (family && base && !effectName) failures.push(tr("для этого семейства в ядре игры нет эффекта"));
      report();
      dirty = true;
      wake();
      return;
    }
    let points = [];
    try {
      turnTowardsBarrel();
      /* Масштаб — по рамке в натуральную величину и ужатию частиц. */
      effectScale = 1;
      const natural = sampleParticles(newInstance(), looping() ? 2.5 : 1);
      const shrink = shrinkOf();
      if (shrink > 0)
        effectScale = Math.min(MAX_SCALE, Math.max(1, 1 / (framing(natural).radius * shrink)));
      const play = playbackOf(family);
      const copies = looping() ? Math.max(1, play.copies || 1) : 1;
      for (let copy = 0; copy < copies; copy += 1) {
        const entry = spawn();
        if (!entry) break;
        /* Копии — вразнобой: у каждой свой отрезок цикла. */
        const warm = looping() ? WARMUP_SECONDS + copy * 0.37 : 0.05;
        for (let time = 0; time < warm; time += 1 / 30) entry.effect.step(1 / 30);
      }
      points = effectScale === 1 ? natural : sampleParticles(newInstance(), looping() ? 2.5 : 1);
    } catch (error) {
      failures.push(String(error?.message || error));
      instances = [];
    }
    drawnSheets = sheetsOfEffect();
    frameEffect(points);
    report();
    dirty = true;
    wake();
  }

  /* Сетки рисовальщика: модели эффектов и ствол, если он нужен. */
  function syncMeshes() {
    renderer.setMeshes({ ...baseMeshes, ...(weapon ? { [WEAPON_MESH]: weapon.mesh } : {}) });
  }

  /* Ствол — один раз на сцену, когда впервые нужен. */
  function ensureWeapon() {
    if (weapon || weaponLoading || !playbackOf(family).weapon) return;
    weaponLoading = loadWeaponMesh()
      .then((loaded) => {
        weapon = loaded;
        syncMeshes();
        if (playbackOf(family).weapon) place();
      })
      .catch((error) => {
        failures.push(tr("ствол не загрузился: {error}").replace("{error}", String(error?.message || error)));
        report();
      });
  }

  /** База из игры: `{ exports, picks, sheets }` (`environmentScene`) и свет сцены. */
  function setBase(next, light = null) {
    base = next || null;
    lighting = lightingFor(light);
    applyLighting();
    bank.provideSheets(base?.sheets || null);
    pixels.clear();
    tinted.clear();
    painting.clear();
    paintRun += 1;
    try {
      model = base?.exports?.length ? loadModel(...base.exports) : null;
      baseMeshes = Object.assign({}, ...(base?.exports || []).map((item) => item?.meshes || {}));
      syncMeshes();
    } catch (error) {
      model = null;
      failures = [String(error?.message || error)];
    }
    effectName = (family && base?.picks?.[family]) || "";
    retint();
    ensureWeapon();
    place();
  }

  /** Семейство в кадре: его эффект из `picks`. */
  function setFamily(next) {
    if (next === family) return;
    family = next || "";
    onlySheet = "";
    effectName = (family && base?.picks?.[family]) || "";
    ensureWeapon();
    place();
  }

  /*
   * Правка семейств — на листы тем же `applyFamilyTint`, что у установщика:
   * у каждого листа — правка СВОЕГО семейства (в пожаре бывают и листы дыма).
   */
  function retint() {
    for (const [name, sheet] of Object.entries(base?.sheets || {})) {
      const lower = name.toLowerCase();
      const owner = FAMILY_OF.get(lower);
      const settings = owner ? environment?.[owner] : null;
      const signature = signatureOf(settings);
      const known = tinted.get(lower);
      if (!signature) {
        if (known) {
          tinted.delete(lower);
          dirty = true;
        }
        continue;
      }
      if (known?.signature === signature) continue;
      if (!pixels.has(lower)) pixels.set(lower, decodeSheet(sheet));
      tinted.set(lower, { signature, canvas: known?.canvas || null, grid: { columns: sheet.columns, rows: sheet.rows } });
      paintSheet(lower, sheet.format);
    }
  }

  /*
   * Перекраска одного листа — в потоке (`environment-tint.js`) и по одной за раз
   * (19.10.2026, лаг правки): пока лист красится, шаги ползунка только переставляют
   * его `signature`, а по концу перекраски он красится заново под последний шаг.
   * Кадр тем временем рисует прежний лист, и ползунок руку не ждёт.
   */
  function paintSheet(lower, format) {
    if (painting.has(lower)) return;
    const entry = tinted.get(lower);
    const settings = environment?.[FAMILY_OF.get(lower)];
    if (!entry || !settings) return;
    const { signature } = entry;
    const run = paintRun;
    painting.add(lower);
    pixels
      .get(lower)
      .then((source) =>
        source
          ? tinter
              .tint(`${run}:${lower}`, source, { tint: settings.tint, tintStrength: settings.tintStrength, brightness: settings.brightness, opacity: settings.opacity, remove: settings.remove === true }, format)
              .then((rgba) => ({ source, rgba }))
          : null,
      )
      .catch(() => null)
      .then((done) => {
        if (run !== paintRun) return;
        painting.delete(lower);
        const current = tinted.get(lower);
        if (!current) return;
        if (current.signature !== signature) {
          paintSheet(lower, format);
          return;
        }
        if (!done?.rgba) return;
        const out = document.createElement("canvas");
        out.width = done.source.width;
        out.height = done.source.height;
        const context = out.getContext("2d");
        if (!context) return;
        const image = context.createImageData(done.source.width, done.source.height);
        image.data.set(done.rgba);
        context.putImageData(image, 0, 0);
        current.canvas = out;
        dirty = true;
        wake();
      });
  }

  /** Показать один лист семейства (имя текстуры) или все листы эффекта (пусто). */
  function setSheet(next) {
    const wanted = String(next || "").toLowerCase();
    if (wanted === onlySheet) return;
    onlySheet = wanted;
    dirty = true;
    wake();
  }

  /** Правка всех семейств проекта (`project.environment`). */
  function setEnvironment(next) {
    environment = next || {};
    retint();
    wake();
  }

  function lookup(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    if (lower.startsWith(WEAPON_MESH)) {
      const sheet = weapon?.sheets.get(lower);
      return sheet ? bank.canvas(lower, sheet) : null;
    }
    const own = tinted.get(lower);
    if (own?.canvas) return bank.canvas(lower, own.canvas, own.grid);
    return bank.game(lower);
  }

  function cameraBasis() {
    const camera = renderer.camera;
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      right: [e[0], e[1], e[2]],
      up: [e[4], e[5], e[6]],
    };
  }

  /* Ствол дулом в точке эффекта: одна модель без поворота, светлее листа
     (сцена ночная — иначе его видно только во вспышке). */
  function weaponBatch() {
    if (!weapon || !playbackOf(family).weapon) return null;
    const origin = originOf();
    const matrices = new Float32Array(16);
    matrices[0] = matrices[5] = matrices[10] = effectScale;
    matrices[15] = 1;
    matrices[12] = origin[0];
    matrices[13] = origin[1];
    matrices[14] = origin[2];
    return {
      key: "astral-weapon",
      drawable: WEAPON_MESH,
      count: 1,
      matrices,
      colours: new Float32Array([WEAPON_LIFT, WEAPON_LIFT, WEAPON_LIFT, 1]),
    };
  }

  function draw() {
    eye.apply();
    const camera = cameraBasis();
    const sprites = [];
    const models = [];
    const trails = [];
    const held = weaponBatch();
    if (held) models.push(held);
    /* Листы в кадре: все или один выбранный (`setSheet`). */
    const visible = sheetLookup(onlySheet, lookup, drawnSheets);
    for (const { effect, slot } of instances) {
      const key = `environment#${slot}`;
      sprites.push(...spriteBatches(effect, camera, visible, key));
      models.push(...modelBatches(effect, key));
      trails.push(...trailBatches(effect, camera, visible, key));
    }
    renderer.render(sprites, models, visible, trails);
    dirty = false;
  }

  const playing = () => instances.length > 0 || pause > 0;

  function tick(now) {
    frame = 0;
    const dt = Math.min((now - (last || now)) / 1000, MAX_STEP);
    last = now;
    if (eye.moving()) eye.step(dt);
    if (playing()) {
      const play = playbackOf(family);
      const lod = lodOf();
      for (const { effect } of instances) {
        effect.evolutions.LOD = lod;
        effect.step(dt);
      }
      instances = instances.filter(({ effect }) => !effect.finished);
      if (looping()) {
        /* Зацикленный встаёт заново, как зарегистрированный эффект игры. */
        if (!instances.length) spawn();
      } else if (play.burst) {
        /* Очередь: новый выстрел через `burst`, прежние догорают внахлёст. */
        shotClock += dt;
        if (shotClock >= play.burst || !instances.length) {
          shotClock = 0;
          spawn();
        }
      } else if (!instances.length) {
        /* Взрыв — заново через паузу, чтобы было видно начало. */
        if (pause <= 0) pause = REPLAY_PAUSE;
        pause -= dt;
        if (pause <= 0) {
          pause = 0;
          spawn();
        }
      }
      draw();
    } else if (dirty || eye.moving()) draw();
    if (!playing() && !eye.moving()) last = 0;
    schedule();
  }

  function schedule() {
    if (running && !frame && (playing() || dirty || eye.moving())) frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (running) {
      schedule();
      return;
    }
    if (stillFrame) return;
    stillFrame = window.setTimeout(() => {
      stillFrame = 0;
      if (!running && dirty) draw();
    }, 0);
  }

  function start() {
    running = true;
    schedule();
  }

  function stop() {
    running = false;
    eye.releaseKeys();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function dispose() {
    stop();
    eye.dispose();
    if (stillFrame) window.clearTimeout(stillFrame);
    bank.dispose();
    tinter.dispose();
    renderer.dispose();
  }

  /*
   * Прогнать эффект на `seconds` вперёд без показа (кадр для обложки
   * карточки: пожар — разгоревшимся, вспышки — в разгаре).
   */
  function advance(seconds) {
    for (let time = 0; time < seconds; time += 1 / 30)
      for (const { effect } of instances) effect.step(1 / 30);
    instances = instances.filter(({ effect }) => !effect.finished);
    dirty = true;
  }

  return {
    resize,
    setBase,
    setFamily,
    setSheet,
    setEnvironment,
    start,
    stop,
    dispose,
    advance,
    /* Всё ли для кадра на месте: листы игры загружены, правка легла. */
    ready: () => bank.pending() === 0 && [...tinted.values()].every((entry) => entry.canvas),
    resetView: () => eye.reset(),
    toggleFly: () => eye.toggleFly(),
    renderNow: () => draw(),
    stats: () => ({
      running,
      family,
      effect: effectName,
      sheet: onlySheet,
      sheets: [...drawnSheets],
      instances: instances.length,
      scale: effectScale,
      weapon: Boolean(weapon && playbackOf(family).weapon),
      flashTurn,
      particles: instances.reduce(
        (sum, { effect }) => sum + [...effect.slots()].reduce((count, slot) => count + slot.particles.length, 0),
        0,
      ),
      tinted: [...tinted.entries()].filter(([, value]) => value.canvas).map(([name]) => name),
      failures: [...failures],
    }),
  };
}
