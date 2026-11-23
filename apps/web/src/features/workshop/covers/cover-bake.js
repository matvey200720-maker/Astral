import { hasDesktopBridge } from "../../../api.js";
import { currentUiLanguage } from "../../../locales/ui.js";
import { coverCodeStamp } from "./cover-loaders.js";
import { readCoverFrameEntry } from "./cover-frames.js";

/*
 * Готовые картинки обложек (оптимизация 13.10.2026: «в мастерской жёстко
 * лагает: картинки, и ты просто скроллишь»).
 *
 * Каждая обложка полки — вещь, нарисованная кодом редактора: небо шейдером
 * города, фонарь трассировкой лучей, 3D-снимки заводов и арен, большая карта
 * сценой в тысячи узлов. Полка рисовала их живьём при каждом заходе — и вход в
 * мастерскую стоял от десятков миллисекунд до секунды (сборка шейдера неба),
 * ровно тогда, когда человек начинает листать.
 *
 * Теперь обложку рисует печь (`cover-oven.jsx`) один раз — в скрытом месте и
 * в тихую минуту окна, — а полка показывает готовую картинку. Картинка лежит в
 * хранилище обложек (`cover-frames.js`, WebP в IndexedDB) между запусками под
 * ключом, который называет всё, от чего зависит рисунок: вид, работу человека,
 * код рисователя (`coverCodeStamp`), язык, наличие Astral Desktop и размер.
 *
 * Этот файл лёгкий: полка спрашивает у него только ключ и готовую картинку;
 * сама печь приезжает отдельным куском, когда картинки нет.
 */

/* Версия печи: поменялся способ снимать кадр — старые картинки не находятся.
   2 (13.10.2026): печь первой версии запекала и кадры, снятые без листов игры,
   на трое суток; такие картинки больше не находятся.
   3 (18.10.2026): снимки сцен садятся по коробке и держат пропорцию плитки, у
   зон МСЛ рисунок вписан целиком — прежние обрезанные обложки перепекаются.
   4 (18.10.2026): фон обложек и пола кадров частиц — чёрный, без серого
   подъёма; прежние серые картинки перепекаются. */
const BAKE_VERSION = 4;
/* Картинка старше этого переснимается в тихую минуту: от игры и общих
   картинок окна, которых нет в ключе, обложка тоже зависит. */
export const BAKED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/* Размер плитки — ступенями: окно чуть другой ширины берёт ту же картинку. */
const SIZE_STEP = 16;
const ASPECT_STEP = 50;
const MEMORY_LIMIT = 240;
const BOX_KEY = "astral-cover-box";

/* Виды, которые печь не снимает: их рисунок — разметка (полосы мини-карты,
   SVG полоски HP, значок звука), а не холст или картинка. Они дешёвые и
   остаются живыми. */
const LIVE_KINDS = new Set(["minimap", "reticle", "target-hp", "sound"]);

const memory = new Map();
/* Ключи, которые печь снять не смогла в этом окне: такие обложки живые. */
const refused = new Set();
const devSession = Date.now().toString(36);

let support = null;
/** Печь работает там, где есть холст 2D и IndexedDB (не jsdom тестов). */
export function bakeSupported() {
  if (support !== null) return support;
  try {
    support =
      typeof document !== "undefined" &&
      typeof indexedDB !== "undefined" &&
      typeof IntersectionObserver === "function" &&
      Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    support = false;
  }
  return support;
}

export const bakeableKind = (kind) => Boolean(kind) && !LIVE_KINDS.has(kind);

/* FNV-1a: ключ называет работу отпечатком, а не самой работой. */
function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

/* Проекты студии — одним списком в хранилище окна; разбор — раз на строку. */
const PROJECTS_KEY = "astral-workshop-projects-v1";
let projectsRaw = null;
let projectsById = new Map();
function storedProject(projectId) {
  if (!projectId) return "";
  let raw = "";
  try {
    raw = globalThis.localStorage?.getItem(PROJECTS_KEY) || "";
  } catch {
    raw = "";
  }
  if (raw !== projectsRaw) {
    projectsRaw = raw;
    projectsById = new Map();
    try {
      const list = JSON.parse(raw || "[]");
      if (Array.isArray(list))
        for (const project of list)
          if (project?.id) projectsById.set(project.id, JSON.stringify(project));
    } catch {
      projectsById = new Map();
    }
  }
  return projectsById.get(projectId) || "";
}

/**
 * Размер плитки ступенью и плотность пикселей окна. Ступень — у ширины и у
 * пропорции (в сотых): высота выходит из них. Прежде высота округлялась вверх
 * сама по себе (132 → 144), картинка выходила выше плитки, и `object-fit: cover`
 * срезал по трети поля сверху и снизу — края обложек обрезались.
 */
export function bakeSize(width, height) {
  const ratio = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const wide = Math.max(SIZE_STEP, Math.ceil(width / SIZE_STEP) * SIZE_STEP);
  const aspect = Math.round((width / Math.max(1, height)) * ASPECT_STEP) / ASPECT_STEP;
  return {
    width: wide,
    height: Math.max(SIZE_STEP, Math.round(wide / (aspect || 1))),
    ratio: Math.round(ratio * 100) / 100,
  };
}

/** Последний размер плитки полки — для прогрева до захода в мастерскую. */
export function rememberBox(size) {
  try {
    globalThis.localStorage?.setItem(BOX_KEY, JSON.stringify(size));
  } catch {
    /* Хранилище недоступно — прогрев возьмёт размер по умолчанию. */
  }
}

export function rememberedBox() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(BOX_KEY) || "null");
    if (stored && stored.width > 0 && stored.height > 0) return bakeSize(stored.width, stored.height);
  } catch {
    /* Ниже — размер плитки окна по умолчанию (1440 точек). */
  }
  return bakeSize(310, 132);
}

/**
 * Ключ готовой картинки или `null`, если её не бывает (вид живой, печи нет).
 * `spec` — `{ kind, projectId, state }`, `size` — `bakeSize(...)`.
 */
export function bakeKey({ kind, projectId = "", state = null }, size) {
  if (!size || !bakeableKind(kind) || !bakeSupported()) return null;
  const code = coverCodeStamp(kind) || `dev-${devSession}`;
  const desktop = hasDesktopBridge() ? "desk" : "web";
  const work = fingerprint(`${storedProject(projectId)}\u0000${typeof state === "string" ? state : ""}`);
  return `bake:${BAKE_VERSION}|${kind}|${code}|${currentUiLanguage()}|${desktop}|${size.width}x${size.height}@${size.ratio}|${work}`;
}

const persistent = (key) => !key.includes("|dev-");

/**
 * Готовая картинка из памяти окна — синхронно, для первой отрисовки полки:
 * `{ url, title }` или `null`.
 */
export function bakedInMemory(key) {
  return key ? memory.get(key) || null : null;
}

export function rememberBaked(key, picture) {
  memory.delete(key);
  memory.set(key, picture);
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value);
}

/**
 * Готовая картинка из хранилища: `{ url, stale }` или `null`. `stale` —
 * картинка давняя: показать её и переснять в тихую минуту.
 */
export async function bakedStored(key) {
  if (!key || !persistent(key)) return null;
  const entry = await readCoverFrameEntry(key);
  if (!entry) return null;
  rememberBaked(key, { url: entry.url, title: entry.title || "" });
  return { url: entry.url, stale: Date.now() - entry.made > BAKED_MAX_AGE_MS };
}

export const bakePersistent = persistent;

/** Печь не смогла снять обложку: до перезагрузки окна она живая. */
export function refuseBake(key) {
  if (key) refused.add(key);
}

export const bakeRefused = (key) => Boolean(key) && refused.has(key);

/*
 * Обложки, которые вышли временным кадром (21.10.2026).
 *
 * Временный кадр — 3D-снимок без листов игры, что «ещё могут приехать» (`scene-snapshot.js`); в хранилище он не
 * ложится (владелец 13.10: «не надо урезанную»). Но где листы не доезжают вообще — нет игры, игра не найдена,
 * часть листов не отвечает, — такая обложка оставалась живой навсегда, и прогрев после каждого запуска снимал её
 * заново: на Windows ~15 сцен по ~13 с, GPU-процесс 22–37 % ядра первую минуту каждого запуска (стенд 21.10).
 * Здесь запоминается лишь то, что ключ вышел временным, — не картинка: фоновый прогрев сутки такой ключ не
 * трогает. Живая полка мастерской рисует и печёт его как раньше — подъедут листы, запечётся там.
 */
const PROVISIONAL_KEY = "astral-cover-provisional";
export const PROVISIONAL_SKIP_MS = 24 * 60 * 60 * 1000;
const PROVISIONAL_LIMIT = 96;

function readProvisional() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(PROVISIONAL_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeProvisional(map) {
  try {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, PROVISIONAL_LIMIT);
    globalThis.localStorage?.setItem(PROVISIONAL_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Хранилище закрыто — прогрев просто попробует снова. */
  }
}

/** Ключ вышел временным кадром: фоновый прогрев сутки его не снимает. */
export function rememberProvisionalBake(key, now = Date.now()) {
  if (!key) return;
  writeProvisional({ ...readProvisional(), [key]: now });
}

/** Ключ запёкся по-настоящему — отметка о временном кадре больше не нужна. */
export function forgetProvisionalBake(key) {
  if (!key) return;
  const map = readProvisional();
  if (!(key in map)) return;
  delete map[key];
  writeProvisional(map);
}

/** Выходил ли ключ временным кадром за последние сутки. */
export function recentlyProvisional(key, now = Date.now()) {
  const at = Number(readProvisional()[key]);
  return Number.isFinite(at) && now - at >= 0 && now - at < PROVISIONAL_SKIP_MS;
}

/** Для тестов: забыть картинки и отказы окна. */
export function forgetBakedCovers() {
  memory.clear();
  refused.clear();
  support = null;
  projectsRaw = null;
  projectsById = new Map();
}
