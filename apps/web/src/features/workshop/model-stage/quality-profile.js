// Профиль качества 3D-сцен мастерской: плотность пикселей, тени, сглаживание,
// отражения и блеск игры. Три уровня; «high» — точная картинка студии оружия.

import { startGpuNameProbe } from "./gpu-probe.js";
import { stageExperiments } from "./stage-exp.js";

export const QUALITY_LEVELS = Object.freeze(["low", "medium", "high"]);

const PROFILE_FIELDS = ["pixelRatio", "shadows", "shadowMap", "antialias", "reflector", "gloss"];
const PROFILE_ROWS = {
  low: [1, false, 0, false, 0, false],
  medium: [1.25, true, 1024, true, 512, false],
  high: [1.75, true, 2048, true, 1024, true],
};

export const QUALITY_PROFILES = Object.freeze(
  Object.fromEntries(
    QUALITY_LEVELS.map((level) => [
      level,
      Object.freeze(Object.fromEntries(PROFILE_FIELDS.map((field, at) => [field, PROFILE_ROWS[level][at]]))),
    ]),
  ),
);

const STORAGE_KEY = "astral.quality.auto.v1";
// Уровень по видеочипу, запомненный с прошлого запуска: пишется и читается только с опытом `gpu-probe` (`stage-exp.js`).
const GPU_STORAGE_KEY = "astral.quality.gpu.v1";

// picked: undefined — хранилище ещё не читали (null — читали, пусто);
// gpu: undefined — видеочип ещё не определяли; synced: уровень в этом окне найден по названию с контекста главного потока;
// warmed: поток названия видеочипа уже запускали (или опыта нет).
const memory = { picked: undefined, gpu: undefined, synced: false, warmed: false };

// localStorage может отсутствовать или бросать при доступе (закрытый режим).
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberedQuality() {
  if (memory.picked === undefined) {
    let stored = null;
    try {
      stored = browserStorage()?.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    memory.picked = QUALITY_LEVELS.includes(stored) ? stored : null;
  }
  return memory.picked;
}

export function rememberQuality(level) {
  if (!QUALITY_LEVELS.includes(level)) return;
  memory.picked = level;
  try {
    browserStorage()?.setItem(STORAGE_KEY, level);
  } catch {
    // итог остаётся только в памяти
  }
}

export function resetQualityMemory() {
  memory.picked = undefined;
  memory.gpu = undefined;
  memory.synced = false;
  memory.warmed = false;
}

// ---------------------------------------------------------------------------
// Уровень по названию видеочипа
// ---------------------------------------------------------------------------

const isWordChar = (ch) => /^\w$/.test(ch);
const isDigit = (ch) => /^\d$/.test(ch);
const isSpace = (ch) => /^\s$/.test(ch);

// Название в нижнем регистре и три вида поиска: подстрока, слово, число.
function probeOf(name) {
  const text = (name ? String(name) : "").toLowerCase();
  const wordAt = (at) => at >= 0 && at < text.length && isWordChar(text[at]);
  const skipSpaces = (from) => {
    let at = from;
    while (isSpace(text.charAt(at))) at += 1;
    return at;
  };
  const probe = {
    text,
    has: (part) => text.includes(part),
    // фраза целиком, а не кусок другого слова
    word(phrase) {
      for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
        if (!wordAt(at - 1) && !wordAt(at + phrase.length)) return true;
      }
      return false;
    },
    // «Apple», пробелы, затем M с цифрой или GPU
    appleChip() {
      for (let at = text.indexOf("apple"); at >= 0; at = text.indexOf("apple", at + 1)) {
        if (wordAt(at - 1)) continue;
        const next = skipSpaces(at + 5);
        if (next === at + 5) continue;
        if ((text[next] === "m" && isDigit(text.charAt(next + 1))) || text.startsWith("gpu", next)) return true;
      }
      return false;
    },
    // номер модели после «HD Graphics» или «UHD Graphics»: три-четыре цифры, можно с буквой P
    graphicsNumber() {
      for (let at = text.indexOf("hd"); at >= 0; at = text.indexOf("hd", at + 1)) {
        const afterHd = skipSpaces(at + 2);
        if (afterHd === at + 2 || !text.startsWith("graphics", afterHd)) continue;
        let from = skipSpaces(afterHd + 8);
        if (text[from] === "p") from += 1;
        let to = from;
        while (isDigit(text.charAt(to))) to += 1;
        const digits = to - from;
        if ((digits === 3 || digits === 4) && !wordAt(to)) return Number(text.slice(from, to));
      }
      return null;
    },
  };
  return probe;
}

const SOFTWARE_MARKS = ["swiftshader", "llvmpipe", "softpipe", "microsoft basic", "software rasteri"];
const DISCRETE_MARKS = ["nvidia", "geforce", "quadro", "rtx", "gtx", "radeon", "amd"];
// встроенная Radeon похожа на эти записи...
const RADEON_INTEGRATED = [/radeon\(tm\) (?:\d{3}m )?graphics/, /radeon graphics\b/, /vega \d{1,2}\b/];
// ...пока в названии нет признаков дискретной
const RADEON_DISCRETE = [/rx/, /pro ?\d/, /vega 64/, /vega 56/, /fury/];

function intelLevel(probe) {
  const number = probe.graphicsNumber();
  if (number !== null) return number >= 1000 || number < 700 ? "low" : "medium";
  return probe.word("hd graphics") && !probe.word("uhd") ? "low" : "medium";
}

// Правила по порядку: первое, что вернуло уровень, решает.
const GPU_VERDICTS = [
  (p) => (SOFTWARE_MARKS.some(p.has) || p.word("software") ? "low" : null),
  (p) => (p.appleChip() ? "high" : null),
  (p) => {
    const intel = p.has("intel") || p.word("uhd") || p.word("hd graphics") || p.word("iris");
    if (!intel) return null;
    return p.word("arc") || p.word("iris") ? "medium" : intelLevel(p);
  },
  (p) => {
    const integrated = RADEON_INTEGRATED.some((pattern) => pattern.test(p.text));
    return integrated && !RADEON_DISCRETE.some((pattern) => pattern.test(p.text)) ? "medium" : null;
  },
  (p) => (DISCRETE_MARKS.some(p.has) || p.word("ati") ? "high" : null),
];

export function gpuLevelOf(name) {
  const probe = probeOf(name);
  for (const verdict of GPU_VERDICTS) {
    const level = verdict(probe);
    if (level) return level;
  }
  return "medium";
}

// Опыт `gpu-probe` (`stage-exp.js`, по умолчанию выключен): уровень по видеочипу с прошлого запуска и поток с названием вместо синхронного контекста.
const gpuProbeOn = () => stageExperiments().has("gpu-probe");

function storedGpuLevel() {
  try {
    const stored = browserStorage()?.getItem(GPU_STORAGE_KEY);
    return QUALITY_LEVELS.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeGpuLevel(level) {
  try {
    browserStorage()?.setItem(GPU_STORAGE_KEY, level);
  } catch {
    // итог остаётся только в памяти
  }
}

// Одноразовый контекст WebGL только ради названия видеочипа; итог запоминается. С опытом `gpu-probe` и запомненным
// с прошлого запуска уровнем контекст не создаётся вовсе (`warmGpuLevel` проверяет название в потоке); без запомненного
// (первый запуск) путь прежний, а итог, найденный по названию, ложится в хранилище.
export function detectGpuLevel() {
  if (memory.gpu) return memory.gpu;
  const early = gpuProbeOn() ? storedGpuLevel() : null;
  if (early) {
    memory.gpu = early;
    return early;
  }
  memory.gpu = "medium";
  if (typeof WebGLRenderingContext === "undefined") return memory.gpu;
  let named = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"));
    if (!gl) return memory.gpu;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    memory.gpu = gpuLevelOf(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    named = true;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    memory.gpu = "medium";
    named = false;
  }
  memory.synced = named;
  if (named && gpuProbeOn()) storeGpuLevel(memory.gpu);
  return memory.gpu;
}

// Опыт `gpu-probe`: поток проверяет название видеочипа, пока главный поток занят первым показом кадра (`ModelStage.jsx`).
// Запомненного уровня нет (первый запуск) — ничего: синхронный путь сам определит и запомнит. Другой уровень — запоминается
// и берётся следующими сценами. Без опыта — один раз и ничего.
export function warmGpuLevel() {
  if (memory.warmed) return;
  memory.warmed = true;
  if (!gpuProbeOn()) return;
  const stored = storedGpuLevel();
  if (!stored || memory.synced) return;
  startGpuNameProbe((name) => {
    const level = gpuLevelOf(name);
    if (level === (memory.gpu || stored)) return;
    memory.gpu = level;
    storeGpuLevel(level);
  });
}

// ---------------------------------------------------------------------------
// Выбор уровня и профиля
// ---------------------------------------------------------------------------

export function currentQuality(requested = "auto") {
  if (QUALITY_LEVELS.includes(requested)) return requested;
  return rememberedQuality() ?? detectGpuLevel();
}

export function qualityProfile(requested = "auto") {
  return QUALITY_PROFILES[currentQuality(requested)];
}

export function profilePixelRatio(profile, density = globalThis.devicePixelRatio) {
  return Math.min(density || 1, profile.pixelRatio);
}
