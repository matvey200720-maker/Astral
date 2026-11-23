/*
 * Знак на килле: своя картинка вместо крестика игры.
 *
 * В момент убийства игра делает две вещи — включает вспышку
 * (`hud_def_desat_cold_kill`, см. `game-contract.js`) и показывает над
 * прицелом крестик. Крестик — это клип `hitmarker` в `hud_reticle.gfx`:
 * код прицела (`HUD_RETICLE.SHOW_HITMARKER`) на килле зовёт
 * `hitmarker.gotoAndPlay("playHitmarkerKill")` или `"playHitmarkerShot"`.
 * Других данных, которые игра зажигает именно на убийство, в Legacy нет, и
 * своя картинка встаёт ровно туда: у клипа меняется содержимое, а код игры
 * зовёт его так же, как звал крестик.
 *
 * Здесь — модель знака и его движение во времени. Одни и те же функции
 * рисуют предпросмотр в окне и раскладывают кадры для игры
 * (`bakeKillMarkerTimeline`): таймлайн Scaleform идёт на 30 кадрах в
 * секунду, и в игру уходит ровно то, что человек видел, только выбранное
 * кадрами.
 *
 * Единицы — точки сцены прицела (1280×720, `reticle-contract/stage.js`):
 * центр — прицел, ось Y вниз. На экране 1920×1080 точка — полтора пикселя.
 */

import { normalizeHex } from "./color.js";

/** Сцена `hud_reticle.gfx` и частота её таймлайна (заголовок SWF: 30.0). */
export const KILL_MARKER_STAGE = Object.freeze({ width: 1280, height: 720 });
export const KILL_MARKER_FPS = 30;

/** Сторона кадра картинки, которую окно готовит для установщика. */
export const KILL_MARKER_EDGE = 256;

/*
 * Кадров своей картинки не больше тридцати двух: каждый — текстура в
 * `hud_reticle.ytd`, а словарь прицела грузится вместе с HUD и живёт в
 * памяти всю игру. Длинная гифка прореживается по времени, а не обрезается.
 */
export const KILL_MARKER_MAX_FRAMES = 32;

export const KILL_MARKER_LIMITS = Object.freeze({
  size: Object.freeze({ min: 8, max: 240, step: 2, default: 72 }),
  offsetX: Object.freeze({ min: -320, max: 320, step: 2, default: 0 }),
  offsetY: Object.freeze({ min: -180, max: 180, step: 2, default: 0 }),
  duration: Object.freeze({ min: 300, max: 3000, step: 50, default: 800 }),
  opacity: Object.freeze({ min: 10, max: 100, step: 5, default: 100 }),
  /* Сотые доли оборота в секунду: 150 — полтора оборота. */
  spinTurns: Object.freeze({ min: 25, max: 400, step: 5, default: 150 }),
  motionAmount: Object.freeze({ min: 5, max: 100, step: 5, default: 50 }),
  motionSpeed: Object.freeze({ min: 25, max: 400, step: 5, default: 100 }),
  playback: Object.freeze({ min: 25, max: 400, step: 5, default: 100 }),
});

const option = (id, label, hint) => Object.freeze({ id, label, hint });

export const KILL_MARKER_ENTERS = Object.freeze([
  option("pop", "Хлопок", "Вырастает из точки с лёгким перелётом"),
  option("fade", "Проявление", "Плавно проступает на месте"),
  option("zoom", "Наезд", "Летит из крупного плана в свой размер"),
  option("drop", "Падение", "Падает сверху и подпрыгивает"),
  option("slam", "Удар", "Врезается в прицел и вздрагивает"),
  option("none", "Сразу", "Появляется без перехода"),
]);

export const KILL_MARKER_MOTIONS = Object.freeze([
  option("still", "Стоит", "Держится на месте"),
  option("spin", "Вращение", "Крутится вокруг центра"),
  option("swing", "Качание", "Качается маятником"),
  option("pulse", "Пульс", "Бьётся, как сердце"),
  option("float", "Всплытие", "Медленно уходит вверх"),
  option("shake", "Дрожь", "Мелко трясётся"),
  option("flip", "Монета", "Переворачивается, как брошенная монета"),
]);

export const KILL_MARKER_EXITS = Object.freeze([
  option("fade", "Растворение", "Гаснет на месте"),
  option("shrink", "Сжатие", "Сжимается в точку"),
  option("rise", "Улёт", "Уходит вверх и гаснет"),
  option("burst", "Вспышка", "Раздувается и исчезает"),
  option("none", "Сразу", "Пропадает без перехода"),
]);

const ids = (list) => new Set(list.map((item) => item.id));
const ENTER_IDS = ids(KILL_MARKER_ENTERS);
const MOTION_IDS = ids(KILL_MARKER_MOTIONS);
const EXIT_IDS = ids(KILL_MARKER_EXITS);

/*
 * Значки — контуры приложения, а не картинки из набора иконок: их рисуют и
 * окно, и установщик, и чужого рисунка в игру не уезжает. Эмодзи рисует
 * системный шрифт того компьютера, где их выбрали, — в поставке Astral их
 * нет.
 */
export const KILL_MARKER_ICONS = Object.freeze([
  option("skull", "Череп"),
  option("hitmarker", "Крестик"),
  option("crosshair", "Прицел"),
  option("crown", "Корона"),
  option("flame", "Огонь"),
  option("bolt", "Молния"),
  option("star", "Звезда"),
  option("heart", "Сердце"),
  option("smile", "Смайл"),
  option("dollar", "Доллар"),
]);
const ICON_IDS = ids(KILL_MARKER_ICONS);

/* Эмодзи, которые чаще всего ставят на килл. Под рядом — поле для своего:
   любое, которое набрано или вставлено. */
const emoji = (value, label) => Object.freeze({ emoji: value, label });
export const KILL_MARKER_EMOJI = Object.freeze([
  emoji("💀", "Череп"),
  emoji("☠️", "Кости"),
  emoji("🤡", "Клоун"),
  emoji("😂", "Смех"),
  emoji("🔥", "Огонь"),
  emoji("💯", "Сотка"),
  emoji("👑", "Корона"),
  emoji("🎯", "Мишень"),
  emoji("😈", "Демон"),
  emoji("💥", "Взрыв"),
  emoji("⚡", "Молния"),
  emoji("🩸", "Кровь"),
]);

const SOURCE_KINDS = new Set(["icon", "emoji", "text", "image"]);
const MAX_TEXT = 12;
const MAX_EMOJI = 16;
const MAX_ASSET_NAME = 80;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function limited(key, input) {
  const limit = KILL_MARKER_LIMITS[key];
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return limit.default;
  return clamp(
    Math.round(numeric / limit.step) * limit.step,
    limit.min,
    limit.max,
  );
}

const pick = (value, allowed, fallback) =>
  allowed.has(String(value)) ? String(value) : fallback;

function firstGrapheme(text) {
  if (typeof Intl?.Segmenter !== "function") return [...text][0];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(text)) return segment;
  return "";
}

/* Одна графема-эмодзи, а не строка: из поля ввода приходит всё подряд. */
function normalizeEmoji(input) {
  const text = String(input ?? "").trim();
  if (!text) return KILL_MARKER_EMOJI[0].emoji;
  return String(firstGrapheme(text) || text).slice(0, MAX_EMOJI);
}

function normalizeText(input) {
  const text = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return [...(text || "-1")].slice(0, MAX_TEXT).join("");
}

export function normalizeKillMarkerSource(input) {
  const source = input && typeof input === "object" ? input : {};
  const kind = SOURCE_KINDS.has(source.kind) ? source.kind : "icon";
  if (kind === "emoji") return { kind, emoji: normalizeEmoji(source.emoji) };
  if (kind === "text")
    return {
      kind,
      text: normalizeText(source.text),
      colour: normalizeHex(source.colour, "#ffffff"),
      outline: normalizeHex(source.outline, "#000000"),
    };
  if (kind === "image") {
    const asset = String(source.asset || "").toLowerCase();
    /* Картинка без отпечатка — выбор файла ещё впереди: вид остаётся «свой
       файл», а установка без картинки отказывает словами. */
    if (!/^[a-f0-9]{64}$/.test(asset))
      return { kind, asset: "", name: "", frames: 1, animated: false };
    const frames = Number(source.frames);
    return {
      kind,
      asset,
      name: String(source.name || "картинка").slice(0, MAX_ASSET_NAME),
      frames: Number.isInteger(frames)
        ? clamp(frames, 1, KILL_MARKER_MAX_FRAMES)
        : 1,
      animated: Boolean(source.animated) && frames > 1,
    };
  }
  return {
    kind: "icon",
    icon: pick(source.icon, ICON_IDS, "skull"),
    colour: normalizeHex(source.colour, "#ffffff"),
  };
}

/**
 * Готовые движения — то, с чего начинают: «хлопнул и исчез», «крутится»,
 * «бьётся». Ручки ниже лишь подправляют выбранное.
 */
const preset = (id, label, description, marker) =>
  Object.freeze({ id, label, description, marker: Object.freeze(marker) });

export const KILL_MARKER_PRESETS = Object.freeze([
  preset("pop", "Хлопок", "Выскочил и растаял", {
    enter: "pop",
    motion: "still",
    exit: "fade",
    duration: 800,
  }),
  preset("spinner", "Вертушка", "Выскакивает и крутится", {
    enter: "pop",
    motion: "spin",
    exit: "shrink",
    duration: 1000,
    spinTurns: 150,
  }),
  preset("heartbeat", "Пульс", "Бьётся, как сердце", {
    enter: "fade",
    motion: "pulse",
    exit: "fade",
    duration: 1100,
    motionAmount: 45,
  }),
  preset("float", "Всплытие", "Уходит вверх, как урон", {
    enter: "fade",
    motion: "float",
    exit: "rise",
    duration: 1200,
  }),
  preset("swing", "Маятник", "Качается на месте", {
    enter: "pop",
    motion: "swing",
    exit: "fade",
    duration: 1100,
    motionAmount: 50,
  }),
  preset("coin", "Монета", "Переворачивается", {
    enter: "zoom",
    motion: "flip",
    exit: "fade",
    duration: 1200,
  }),
  preset("slam", "Удар", "Врезается и дрожит", {
    enter: "slam",
    motion: "shake",
    exit: "fade",
    duration: 900,
    motionAmount: 35,
  }),
  preset("drop", "Падение", "Падает с отскоком", {
    enter: "drop",
    motion: "still",
    exit: "burst",
    duration: 1000,
  }),
]);

export const KILL_MARKER_PRESET_MAP = Object.freeze(
  Object.fromEntries(KILL_MARKER_PRESETS.map((item) => [item.id, item])),
);

const PRESET_KEYS = Object.freeze([
  "enter",
  "motion",
  "exit",
  "duration",
  "spinTurns",
  "spinDirection",
  "motionAmount",
  "motionSpeed",
]);

/** Знак по умолчанию: выключен, а включённый — белый череп «хлопком». */
export function defaultKillMarker() {
  return createKillMarker({});
}

/** Нормализованный знак: всё недостающее и всё непонятное — по умолчанию. */
export function createKillMarker(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const base = KILL_MARKER_PRESET_MAP.pop.marker;
  const value = (key) => (source[key] === undefined ? base[key] : source[key]);
  return {
    enabled: Boolean(source.enabled),
    source: normalizeKillMarkerSource(source.source),
    preset:
      source.preset === null
        ? null
        : pick(source.preset, new Set(Object.keys(KILL_MARKER_PRESET_MAP)), "pop"),
    size: limited("size", source.size),
    offsetX: limited("offsetX", source.offsetX),
    offsetY: limited("offsetY", source.offsetY),
    duration: limited("duration", value("duration")),
    opacity: limited("opacity", source.opacity),
    enter: pick(value("enter"), ENTER_IDS, "pop"),
    motion: pick(value("motion"), MOTION_IDS, "still"),
    exit: pick(value("exit"), EXIT_IDS, "fade"),
    spinTurns: limited("spinTurns", source.spinTurns),
    spinDirection: source.spinDirection === "ccw" ? "ccw" : "cw",
    motionAmount: limited("motionAmount", source.motionAmount),
    motionSpeed: limited("motionSpeed", source.motionSpeed),
    playback: limited("playback", source.playback),
    loop: source.loop !== false,
    keepCross: Boolean(source.keepCross),
  };
}

/**
 * Готовое движение поверх знака: картинка, размер и место остаются, движение
 * и время — от пресета. Ручки, которых пресет не называет, берут умолчания,
 * а не остаются от прежнего: иначе «Хлопок» после «Вертушки» крутился бы.
 */
export function applyKillMarkerPreset(marker, presetId) {
  const found = KILL_MARKER_PRESET_MAP[presetId];
  if (!found) return createKillMarker(marker);
  const next = { ...marker, preset: found.id };
  for (const key of PRESET_KEYS) {
    next[key] =
      found.marker[key] ??
      (key === "spinDirection" ? "cw" : KILL_MARKER_LIMITS[key]?.default);
  }
  return createKillMarker(next);
}

/* --------------------------------------------------------------- время */

/** Доли длительности на появление и уход — как у готовых HUD-анимаций игры. */
export function killMarkerTiming(marker) {
  const duration = marker.duration;
  const enterMs =
    marker.enter === "none" ? 0 : clamp(Math.round(duration * 0.22), 90, 280);
  const exitMs =
    marker.exit === "none" ? 0 : clamp(Math.round(duration * 0.3), 120, 400);
  return { duration, enterMs, exitMs };
}

const easeOutCubic = (k) => 1 - (1 - k) ** 3;
const easeInCubic = (k) => k ** 3;
const easeInQuad = (k) => k * k;
/* Перелёт «хлопка»: 1.70158 — классическая константа easeOutBack. */
const easeOutBack = (k) => {
  const s = 1.70158;
  return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;
};
const easeInBack = (k) => {
  const s = 1.70158;
  return (s + 1) * k ** 3 - s * k * k;
};
function bounceOut(k) {
  const n = 7.5625;
  const d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k - 1.5 / d) ** 2 + 0.75;
  if (k < 2.5 / d) return n * (k - 2.25 / d) ** 2 + 0.9375;
  return n * (k - 2.625 / d) ** 2 + 0.984375;
}

const TAU = Math.PI * 2;
const HIDDEN = Object.freeze({
  visible: false,
  x: 0,
  y: 0,
  scaleX: 0,
  scaleY: 0,
  rotation: 0,
  alpha: 0,
});

/**
 * Положение знака через `elapsed` мс после килла: центр в точках сцены
 * прицела (0,0 — прицел), масштаб к своему размеру, поворот в градусах по
 * часовой стрелке (ось Y вниз, как `_rotation` во Flash), непрозрачность.
 */
export function killMarkerPose(marker, elapsed) {
  const t = Number(elapsed) || 0;
  if (!marker?.enabled || t < 0 || t > marker.duration) return HIDDEN;
  const { duration, enterMs, exitMs } = killMarkerTiming(marker);
  const size = marker.size;
  const amount = marker.motionAmount / 100;
  const rhythm = marker.motionSpeed / 100;
  const seconds = t / 1000;
  let scale = 1;
  let flip = 1;
  let rotation = 0;
  let x = marker.offsetX;
  let y = marker.offsetY;
  let alpha = 1;

  if (enterMs > 0 && t < enterMs) {
    const k = t / enterMs;
    if (marker.enter === "pop") {
      scale *= Math.max(0, easeOutBack(k));
      alpha *= Math.min(1, k * 3);
    } else if (marker.enter === "fade") {
      alpha *= easeOutCubic(k);
    } else if (marker.enter === "zoom") {
      scale *= 1 + 1.6 * (1 - easeOutCubic(k));
      alpha *= easeOutCubic(k);
    } else if (marker.enter === "drop") {
      y -= (1 - bounceOut(k)) * size * 1.4;
      alpha *= Math.min(1, k * 2.5);
    } else if (marker.enter === "slam") {
      scale *= 1 + 2 * (1 - k) ** 2;
      alpha *= Math.min(1, k * 4);
    }
  }
  /* Отдача удара — короткая дрожь сразу после того, как знак встал. */
  if (marker.enter === "slam" && t >= enterMs && t < enterMs + 180) {
    const k = (t - enterMs) / 180;
    x += Math.sin(k * TAU * 3) * size * 0.08 * (1 - k);
    rotation += Math.sin(k * TAU * 2.5) * 6 * (1 - k);
  }

  if (marker.motion === "spin") {
    const direction = marker.spinDirection === "ccw" ? -1 : 1;
    rotation += direction * (marker.spinTurns / 100) * 360 * seconds;
  } else if (marker.motion === "swing") {
    rotation += 60 * amount * Math.sin(TAU * 1.2 * rhythm * seconds);
  } else if (marker.motion === "pulse") {
    /* Сердце: два удара в секунду, сжатие мягче удара. */
    scale *= 1 + 0.6 * amount * Math.sin(Math.PI * 2 * rhythm * seconds) ** 2;
  } else if (marker.motion === "float") {
    y -= size * 1.2 * amount * (t / duration);
  } else if (marker.motion === "shake") {
    x += size * 0.14 * amount * Math.sin(TAU * 9 * rhythm * seconds);
    y += size * 0.08 * amount * Math.sin(TAU * 7 * rhythm * seconds + 1.3);
    rotation += 14 * amount * Math.sin(TAU * 6 * rhythm * seconds + 0.6);
  } else if (marker.motion === "flip") {
    flip = Math.cos(TAU * 0.9 * rhythm * seconds);
  }

  if (exitMs > 0 && t > duration - exitMs) {
    const k = clamp((t - (duration - exitMs)) / exitMs, 0, 1);
    if (marker.exit === "fade") {
      alpha *= 1 - easeInQuad(k);
    } else if (marker.exit === "shrink") {
      scale *= Math.max(0, 1 - easeInBack(k));
      alpha *= 1 - k * k;
    } else if (marker.exit === "rise") {
      y -= size * 0.9 * easeInCubic(k);
      alpha *= 1 - k;
    } else if (marker.exit === "burst") {
      scale *= 1 + 0.8 * easeOutCubic(k);
      alpha *= 1 - k;
    }
  }

  alpha = clamp(alpha * (marker.opacity / 100), 0, 1);
  if (alpha <= 0.002 || scale <= 0.001) return HIDDEN;
  return {
    visible: true,
    x,
    y,
    scaleX: scale * flip,
    scaleY: scale,
    rotation,
    alpha,
  };
}

/**
 * Момент, в котором знак показывают стоп-кадром (обложка, карточка): середина
 * между появлением и уходом — знак уже встал и ещё не гаснет.
 */
export function killMarkerPeakMoment(marker) {
  const { duration, enterMs, exitMs } = killMarkerTiming(marker);
  return enterMs + Math.max(0, duration - enterMs - exitMs) / 2;
}

/* ------------------------------------------------------ кадры картинки */

/**
 * Кадр своей картинки в момент `elapsed`. `delays` — задержки кадров гифки,
 * мс; у неподвижной картинки кадр один. Скорость проигрывания — от знака,
 * а «один раз» держит последний кадр, а не начинает заново.
 */
export function killMarkerFrameIndex(marker, delays, elapsed) {
  const list = Array.isArray(delays) ? delays : [];
  if (list.length <= 1) return 0;
  const total = list.reduce((sum, delay) => sum + delay, 0);
  if (!(total > 0)) return 0;
  let local = Math.max(0, Number(elapsed) || 0) * (marker.playback / 100);
  if (marker.loop) local %= total;
  else if (local >= total) return list.length - 1;
  for (let index = 0; index < list.length; index += 1) {
    if (local < list[index]) return index;
    local -= list[index];
  }
  return list.length - 1;
}

/*
 * Задержки гифки, как их понимает браузер: кадр короче 20 мс Chrome и
 * Firefox показывают сотую долю секунды (так гифки «со скоростью ноль»
 * играют одинаково везде). То же правило здесь — иначе в игре такая гифка
 * пролетала бы за миг.
 */
export function normalizeFrameDelays(delays) {
  const list = (Array.isArray(delays) ? delays : [])
    .slice(0, KILL_MARKER_MAX_FRAMES)
    .map((delay) => {
      const numeric = Number(delay);
      return Number.isFinite(numeric) && numeric >= 20
        ? Math.min(Math.round(numeric), 5000)
        : 100;
    });
  return list.length ? list : [100];
}

/**
 * Кадры для игры: по одному на каждый кадр таймлайна (1/30 с).
 *
 * `poses` — положение знака на каждом кадре, `images` — номер кадра
 * картинки на каждом кадре вложенного клипа. Клип картинки живёт своим
 * таймлайном: он кладётся в первом кадре знака и дальше идёт сам, поэтому
 * его длина — длина гифки при выбранной скорости, а не длина знака.
 */
export function bakeKillMarkerTimeline(marker, delays) {
  const step = 1000 / KILL_MARKER_FPS;
  const count = Math.max(2, Math.ceil(marker.duration / step) + 1);
  const poses = [];
  for (let index = 0; index < count; index += 1)
    poses.push(killMarkerPose(marker, Math.min(marker.duration, index * step)));
  const list = normalizeFrameDelays(delays);
  const total = list.reduce((sum, delay) => sum + delay, 0);
  const images = [];
  if (list.length > 1) {
    const length = marker.loop
      ? Math.max(1, Math.round(((total * 100) / marker.playback) / step))
      : count;
    for (let index = 0; index < length; index += 1)
      images.push(killMarkerFrameIndex(marker, list, index * step));
  } else {
    images.push(0);
  }
  return { poses, images, loop: marker.loop && list.length > 1 };
}

/* ------------------------------------------------------------- подписи */

const labelOf = (list, id) => list.find((item) => item.id === id)?.label || id;

/** Картинка знака одной строкой — для разбора «В игру уйдёт» и карточек. */
export function describeKillMarkerSource(source) {
  if (source.kind === "emoji") return `эмодзи ${source.emoji}`;
  if (source.kind === "text") return `надпись «${source.text}»`;
  if (source.kind === "image")
    return !source.asset
      ? "своя картинка (не выбрана)"
      : source.animated
        ? `своя гифка «${source.name}», ${source.frames} кадр.`
        : `своя картинка «${source.name}»`;
  return `значок «${labelOf(KILL_MARKER_ICONS, source.icon)}»`;
}

export function describeKillMarker(marker) {
  if (!marker?.enabled) return "";
  const motion =
    marker.motion === "still" ? "" : `, ${labelOf(KILL_MARKER_MOTIONS, marker.motion).toLowerCase()}`;
  return `${describeKillMarkerSource(marker.source)}${motion}, ${marker.duration} мс`;
}

/**
 * Ключ картинки: одинаковый рисунок — один набор кадров. От него зависят
 * кэш кадров в окне и то, пересобирать ли текстуры при установке.
 */
export function killMarkerSourceKey(source) {
  if (source.kind === "emoji") return `emoji:${source.emoji}`;
  if (source.kind === "text")
    return `text:${source.text}:${source.colour}:${source.outline}`;
  if (source.kind === "image") return `image:${source.asset}`;
  return `icon:${source.icon}:${source.colour}`;
}

/* FNV-1a: отпечаток для метки в файле игры, не для защиты. */
function fnv(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Отпечаток установленного знака. Кладётся меткой внутрь `hud_reticle.gfx`
 * и читается обратно: так редактор видит, стоит ли в игре именно этот знак,
 * или файл прицела с тех пор поменял кто-то другой.
 */
export function killMarkerSignature(marker, frames = []) {
  const { preset: _preset, ...rest } = marker || {};
  return fnv(
    JSON.stringify({
      marker: rest,
      frames: (frames || []).map((frame) => [frame.sha256 || "", frame.delay]),
    }),
  );
}
