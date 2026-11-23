import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  estimateGraphicsVram,
  graphicsTemplate,
  graphicsValuesFrom,
  normalizeGraphicsValues,
} from "@modovik/optimizer/graphics.js";
import { readGameScreen } from "./game-screen.js";

const astralSafeGraphicsValues = Object.freeze({
  Tessellation: 0,
  LodScale: 0,
  PedLodBias: 0,
  VehicleLodBias: 0,
  ShadowQuality: 0,
  ReflectionQuality: 0,
  ReflectionMSAA: 0,
  SSAO: 0,
  AnisotropicFiltering: 8,
  MSAA: 0,
  MSAAFragments: 0,
  MSAAQuality: 0,
  SamplingMode: 0,
  TextureQuality: 0,
  ParticleQuality: 0,
  WaterQuality: 0,
  GrassQuality: 0,
  ShaderQuality: 0,
  UltraShadows_Enabled: false,
  Shadow_ParticleShadows: false,
  Shadow_Distance: 0,
  Shadow_LongShadows: false,
  Reflection_MipBlur: false,
  FXAA_Enabled: true,
  TXAA_Enabled: false,
  Lighting_FogVolumes: false,
  Shader_SSA: false,
  PostFX: 0,
  DoF: false,
  HdStreamingInFlight: false,
  MaxLodScale: 0,
  MotionBlurStrength: 0,
  VSync: 0,
});

const astralWorldLiteValues = Object.freeze({
  CityDensity: 0.25,
  PedVarietyMultiplier: 0.35,
  VehicleVarietyMultiplier: 0.35,
});

const astralCompetitiveGraphicsValues = Object.freeze({
  Tessellation: 0,
  LodScale: 0.2,
  PedLodBias: 0,
  VehicleLodBias: 0,
  TextureQuality: 1,
  ShaderQuality: 1,
  ShadowQuality: 0,
  ReflectionQuality: 0,
  ReflectionMSAA: 0,
  GrassQuality: 0,
  WaterQuality: 1,
  ParticleQuality: 1,
  PostFX: 1,
  SSAO: 0,
  MSAA: 0,
  MSAAFragments: 0,
  MSAAQuality: 0,
  FXAA_Enabled: true,
  TXAA_Enabled: false,
  UltraShadows_Enabled: false,
  Shadow_ParticleShadows: false,
  Shadow_LongShadows: false,
  DoF: false,
  MotionBlurStrength: 0,
  VSync: 0,
});

/*
 * Наборы оптимизации (`optimization.js`): безопасные значения, которые
 * карточки ставят поверх того, что есть. Шаблоны страницы «Настройки
 * графики» живут в `@modovik/optimizer/graphics.js` — одно место для окна и
 * главного процесса; по имени шаблона они находятся там же.
 */
const optimizationPresetValues = {
  "astral-performance-safe": {
    ...astralSafeGraphicsValues,
    ...astralWorldLiteValues,
  },
  "astral-graphics-performance-safe": astralSafeGraphicsValues,
  "astral-competitive-safe": astralCompetitiveGraphicsValues,
  "astral-competitive-world-safe": {
    ...astralCompetitiveGraphicsValues,
    ...astralWorldLiteValues,
  },
  "astral-world-lite-safe": astralWorldLiteValues,
};

function presetValuesById(id) {
  return optimizationPresetValues[id] || graphicsTemplate(id)?.values || null;
}

function parseGtaSettings(xml) {
  const values = {};
  for (const match of xml.matchAll(/<([A-Za-z0-9_]+)\s+value="([^"]*)"/g)) {
    const [, key, raw] = match;
    if (/^(true|false)$/i.test(raw)) values[key] = raw.toLowerCase() === "true";
    else if (raw.trim() !== "" && Number.isFinite(Number(raw)))
      values[key] = Number(raw);
    else values[key] = raw;
  }
  return values;
}

async function analyzeGameSettingsPreset(input, file) {
  const id = String(input?.id || "");
  const target = presetValuesById(id);
  if (!target) throw new Error("Неизвестный профиль графики.");
  if (!file) throw new Error("Путь к settings.xml не задан.");
  const xml = await fs.readFile(file, "utf8");
  const current = parseGtaSettings(xml);
  const currentMb = estimateGraphicsVram(current);
  const targetMb = estimateGraphicsVram({ ...current, ...target });
  const estimatedSavingMb = Math.round((currentMb - targetMb) / 50) * 50;
  /* Разбор считает по тем же ключам, что и запись: обещать изменение
     разрешения, а потом его не тронуть — хуже, чем не обещать. */
  const changedKeys = Object.entries(presetValuesWithoutScreen(target))
    .filter(([key, value]) => key in current && current[key] !== value)
    .map(([key]) => key);
  return {
    id,
    estimatedSavingMb,
    currentEstimatedMb: currentMb,
    targetEstimatedMb: targetMb,
    changedKeys,
    changedCount: changedKeys.length,
    method: "settings-xml-heuristic-v1",
    confidence: "medium",
  };
}

/* Набор оптимизации по имени (`optimization.js`): у неё свой откат по копии файла. */
async function applyGameSettingsPreset(input, file, stateDir) {
  const id = String(input?.id || "");
  if (!file) throw new Error("Путь к settings.xml не задан.");
  if (!stateDir) throw new Error("Astral backup directory is required.");
  const values = presetValuesById(id);
  if (!values) throw new Error("Неизвестный профиль графики.");
  /* До 08.10 страховочная копия ложилась под именем старой копии «как
     было» (`graphics-presets/settings.xml`) и перезаписывалась при каждом
     применении — «как было» становилось «как после прошлого раза».
     Теперь исходник снимается один раз, а копия перед записью — своя. */
  await rememberOriginal(file, stateDir);
  const written = await writeGameSettingsValues(
    presetValuesWithoutScreen(values),
    file,
    path.join(graphicsFolder(stateDir), SAFETY_BACKUP),
  );
  return { applied: true, id, ...written };
}

/*
 * Страница «Настройки графики» (ТЗ 05.10, задача 15): готовый шаблон по
 * имени или свой набор значений — шаблон, который человек подстроил или
 * сохранил. Значения проверяются здесь же (`normalizeGraphicsValues`): в
 * файл игры уходят только известные ключи с допустимыми числами.
 *
 * «Как было» запоминается один раз — перед первой записью Astral: значения
 * всех ключей графики, что стояли в игре (`original.json`). Возврат пишет
 * их обратно по одному ключу, а не подкладывает старый файл: разрешение,
 * звук и управление, которые человек поменял в игре после, остаются его.
 */
const ORIGINAL_FILE = "original.json";
const ORIGINAL_COPY = "settings.original.xml";
const graphicsFolder = (stateDir) =>
  path.join(path.resolve(stateDir), "graphics-presets");

async function readSettingsFile(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    throw new Error(
      "settings.xml не найден. Сначала запустите GTA V хотя бы один раз.",
    );
  }
}

async function readOriginal(stateDir) {
  try {
    const saved = JSON.parse(
      await fs.readFile(
        path.join(graphicsFolder(stateDir), ORIGINAL_FILE),
        "utf8",
      ),
    );
    return saved?.values && typeof saved.values === "object" ? saved : null;
  } catch {
    return null;
  }
}

/*
 * До задачи 15 «как было» хранилось копией всего файла, снятой перед
 * последней записью (`graphics-presets/settings.xml`). Новая версия файлом
 * «как было» не пишет: при первой записи эта копия становится исходником
 * (`original.json`) и уходит, а страховочная копия перед каждой записью
 * лежит под своим именем (`settings.last.xml`) и в возврат не идёт.
 */
const LEGACY_BACKUP = "settings.xml";
const SAFETY_BACKUP = "settings.last.xml";

async function legacyValues(stateDir) {
  try {
    const values = graphicsValuesFrom(
      parseGtaSettings(
        await fs.readFile(
          path.join(graphicsFolder(stateDir), LEGACY_BACKUP),
          "utf8",
        ),
      ),
    );
    return Object.keys(values).length ? values : null;
  } catch {
    return null;
  }
}

/*
 * Самая ранняя копия файла, снятая другим разделом Astral до своей первой
 * записи: пакеты настроек каталога кладут исходник целиком в
 * `bases/<sha пути>.xml` (`settings-package.js`). Если он есть, «до
 * Astral» — это он, а не то, что лежит в игре сейчас поверх пакета.
 */
async function packageBaselineValues(file, stateDir) {
  const name = `${createHash("sha256").update(path.resolve(file).toLowerCase()).digest("hex")}.xml`;
  try {
    const values = graphicsValuesFrom(
      parseGtaSettings(
        await fs.readFile(
          path.join(path.resolve(stateDir), "bases", name),
          "utf8",
        ),
      ),
    );
    return Object.keys(values).length ? values : null;
  } catch {
    return null;
  }
}

async function rememberOriginal(file, stateDir) {
  if (await readOriginal(stateDir)) return;
  const current = await readSettingsFile(file);
  const values =
    (await legacyValues(stateDir)) ||
    (await packageBaselineValues(file, stateDir)) ||
    graphicsValuesFrom(parseGtaSettings(current));
  await fs.mkdir(graphicsFolder(stateDir), { recursive: true });
  /* Исходный файл целиком — рядом, один раз (ТЗ 08.10, задача 1: «перед
     изменением сохраняй исходные файлы»). Возврат идёт по значениям, а
     копия — дорога назад руками, если что-то пойдёт совсем не так. */
  const copy = path.join(graphicsFolder(stateDir), ORIGINAL_COPY);
  try {
    await fs.access(copy);
  } catch {
    await fs.writeFile(copy, current, "utf8");
  }
  await fs.writeFile(
    path.join(graphicsFolder(stateDir), ORIGINAL_FILE),
    `${JSON.stringify({ values, savedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  await fs.rm(path.join(graphicsFolder(stateDir), LEGACY_BACKUP), {
    force: true,
  });
}

function templateValues(input) {
  if (input?.values) return normalizeGraphicsValues(input.values);
  const template = graphicsTemplate(String(input?.id || ""));
  if (!template) throw new Error("Неизвестный шаблон графики.");
  return template.values;
}

async function applyGraphicsTemplate(input, file, stateDir) {
  if (!file) throw new Error("Путь к settings.xml не задан.");
  if (!stateDir) throw new Error("Astral backup directory is required.");
  const values = presetValuesWithoutScreen(templateValues(input));
  await rememberOriginal(file, stateDir);
  const written = await writeGameSettingsValues(
    values,
    file,
    path.join(graphicsFolder(stateDir), SAFETY_BACKUP),
  );
  return { applied: true, id: String(input?.id || ""), ...written };
}

/**
 * Что сейчас в `settings.xml`: ключи графики, экран и есть ли куда вернуть.
 * `edition` — издание файла ("Legacy" / "Enhanced"): у Enhanced экран игры не
 * читается (`gameScreen.reason === "enhanced"`).
 */
async function readGraphicsSettings(file, stateDir, edition = null) {
  let xml;
  try {
    xml = await fs.readFile(file, "utf8");
  } catch {
    return {
      found: false,
      file: file || "",
      values: {},
      screen: null,
      /* Экран игры отдаётся всегда, с причиной: окно и журнал сверки знают, почему он неизвестен. */
      gameScreen: await readGameScreen(file, { edition }).catch(() => null),
      canRestore: false,
    };
  }
  const parsed = parseGtaSettings(xml);
  const legacy = stateDir ? Boolean(await legacyValues(stateDir)) : false;
  return {
    found: true,
    file,
    values: graphicsValuesFrom(parsed),
    screen: {
      width: Number(parsed.ScreenWidth) || null,
      height: Number(parsed.ScreenHeight) || null,
    },
    /* Форма экрана, под которую игра раскладывает HUD, и безопасная зона
       профиля — мини-карта ставит кадр по ним (ТЗ 11.10.2026, день). */
    gameScreen: await readGameScreen(file, { edition }).catch(() => null),
    canRestore: Boolean(stateDir && ((await readOriginal(stateDir)) || legacy)),
    /* Значения «до Astral» — для «Стандарт» в комнате шаблона: черновик
       встаёт на них, не трогая игру, пока не нажали «Применить». */
    original: stateDir
      ? (await readOriginal(stateDir))?.values ||
        (await legacyValues(stateDir)) ||
        null
      : null,
  };
}

/*
 * Вернуть графику, какой она была до Astral: по `original.json`, а если
 * человек с прошлой версии ещё ничего не записывал новой — по старой копии
 * файла. Обновление не отнимает у него дорогу назад.
 */
async function restoreGraphicsSettings(file, stateDir) {
  if (!file) throw new Error("Путь к settings.xml не задан.");
  if (!stateDir) throw new Error("Astral backup directory is required.");
  const values =
    (await readOriginal(stateDir))?.values || (await legacyValues(stateDir));
  if (!values || !Object.keys(values).length)
    throw new Error(
      "Astral ещё не менял настройки графики — возвращать нечего.",
    );
  const written = await writeGameSettingsValues(values, file, null, {
    remember: false,
  });
  for (const name of [ORIGINAL_FILE, LEGACY_BACKUP, ORIGINAL_COPY])
    await fs.rm(path.join(graphicsFolder(stateDir), name), { force: true });
  return { restored: true, ...written };
}

/*
 * Чужой пресет не приносит с собой чужой экран.
 *
 * Готовый набор описывает вид игры: тени, текстуры, траву, отражения. Но в
 * `settings.xml` рядом с ними лежат разрешение, частота обновления и режим
 * окна, и в записанных пресетах они тоже есть — те, что стояли у автора.
 * Один собирал набор на 2560×1440 при 164 Гц, другой на 1440×1080 при 144.
 *
 * Перенести их значит подменить человеку экран: на панели 60 Гц игра получит
 * 164, которых та не умеет, а на 2560×1440 — чужие 1920×1080 вместо родного
 * разрешения. Ни то, ни другое к «качеству графики» отношения не имеет, и
 * человек, берущий набор ради теней, этого не просил.
 *
 * Поэтому экранные ключи из набора выбрасываются, и текущие значения остаются
 * как были. Это не потеря: качество, ради которого набор и берут, приезжает
 * целиком.
 */
const SCREEN_KEYS = Object.freeze([
  "ScreenWidth",
  "ScreenHeight",
  "RefreshRate",
  "Windowed",
  "AspectRatio",
]);

/** Значения набора без тех, что принадлежат экрану, а не виду игры. */
export function presetValuesWithoutScreen(values = {}) {
  const kept = {};
  for (const [key, value] of Object.entries(values)) {
    if (SCREEN_KEYS.includes(key)) continue;
    kept[key] = value;
  }
  return kept;
}

const SETTINGS_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/* Где лежит исходник «до Astral» (`graphics-presets` в папке настроек):
   задаёт главный процесс при запуске. */
let originalStore = null;

function configureGraphicsOriginalStore(resolver) {
  originalStore = typeof resolver === "function" ? resolver : null;
}

/*
 * Запись произвольных ключей в `settings.xml`.
 *
 * Выделено из применения профиля графики, потому что писать в этот файл нужно
 * не только профилям: раздел оптимизации меняет два-три ключа и обязан уметь
 * вернуть ровно их. Поэтому функция возвращает `previous` — значения, которые
 * стояли до записи.
 *
 * Возврат по `previous`, а не по копии файла: между установкой и откатом
 * человек мог поменять разрешение или громкость, и подсовывать ему старый файл
 * целиком значило бы отменять заодно и это.
 */
async function writeGameSettingsValues(
  values,
  file,
  backup,
  { remember = true } = {},
) {
  if (!file) throw new Error("Путь к settings.xml не задан.");
  /* Любой раздел, пишущий в settings.xml (оптимизатор мастерской, наборы
     оптимизации), сначала даёт снять исходник «до Astral»: иначе первым
     писал оптимизатор, а «Стандарт» графики потом возвращал уже его числа. */
  if (remember && originalStore) {
    const stateDir = await originalStore();
    if (stateDir) await rememberOriginal(file, stateDir);
  }
  let xml;
  try {
    xml = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(
      "settings.xml не найден. Сначала запустите GTA V хотя бы один раз.",
    );
  }
  if (backup) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(file, backup);
  }
  let changed = 0;
  const previous = {};
  const missing = [];
  for (const [key, value] of Object.entries(values || {})) {
    if (!SETTINGS_KEY.test(key)) throw new Error(`Недопустимый ключ: ${key}`);
    const pattern = new RegExp(`(<${key}\\s+value=")([^"]*)("\\s*/?>)`, "i");
    const match = pattern.exec(xml);
    if (!match) {
      missing.push(key);
      continue;
    }
    previous[key] = match[2];
    /* Дробь — в записи самой игры (`1.000000`): иначе возврат «как было»
       давал тот же смысл другими буквами, и файл после «Стандарт» не
       совпадал с исходным байт в байт. */
    const written =
      typeof value === "number" && /^-?\d+\.\d{6}$/.test(match[2])
        ? value.toFixed(6)
        : value;
    xml = xml.replace(pattern, `$1${written}$3`);
    changed += 1;
  }
  if (!changed)
    throw new Error(
      "Формат settings.xml не поддерживается этой версией Astral.",
    );
  await fs.writeFile(file, xml, "utf8");
  return { file, backup: backup || "", changed, previous, missing };
}

export {
  configureGraphicsOriginalStore,
  analyzeGameSettingsPreset,
  applyGameSettingsPreset,
  applyGraphicsTemplate,
  parseGtaSettings,
  readGraphicsSettings,
  restoreGraphicsSettings,
  writeGameSettingsValues,
};

/*
 * GTA V Enhanced (ТЗ 08.10.2026, задача 5) пишет графику в свой файл —
 * `Документы\Rockstar Games\GTAV Enhanced\settings.xml`. Ключи там общие с
 * Legacy (тени, текстуры, вода, частицы, трава, дальность, плотность), но
 * есть и свои: трассировка лучей, `AAType` вместо MSAA и FXAA, свой
 * масштаб кадра (`ResScalingType`). Шаблон уходит в оба файла, какие есть:
 * человеку не нужно выбирать издание. Запись по-прежнему меняет только теги,
 * которые в файле есть, — чужих ключей в файл не добавляется. Масштаб кадра
 * (`SamplingMode`) в Enhanced значит другое (строки меню там свои), поэтому
 * в его файл не пишется. У каждого файла свой исходник «до Astral».
 */
export const ENHANCED_SETTINGS_FOLDER = "GTAV Enhanced";
const LEGACY_ONLY_KEYS = Object.freeze(["SamplingMode"]);

/** Файлы графики изданий: `[{ edition, file, stateDir }]` — Legacy первым. */
export function graphicsTargets(legacyFile, stateDir) {
  const enhancedFile = path.join(
    path.dirname(path.dirname(legacyFile)),
    ENHANCED_SETTINGS_FOLDER,
    "settings.xml",
  );
  return [
    { edition: "Legacy", file: legacyFile, stateDir },
    {
      edition: "Enhanced",
      file: enhancedFile,
      stateDir: path.join(path.resolve(stateDir), "enhanced"),
    },
  ];
}

const exists = (file) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

/** Значения шаблона для издания: Enhanced — без ключей, что там значат другое. */
export function graphicsValuesForEdition(values, edition) {
  if (edition !== "Enhanced") return values;
  const kept = {};
  for (const [key, value] of Object.entries(values))
    if (!LEGACY_ONLY_KEYS.includes(key)) kept[key] = value;
  return kept;
}

/** Шаблон — во все найденные файлы изданий; ответ — по изданию. */
export async function applyGraphicsEverywhere(input, legacyFile, stateDir) {
  const results = [];
  for (const target of graphicsTargets(legacyFile, stateDir)) {
    if (!(await exists(target.file))) continue;
    const values = graphicsValuesForEdition(
      templateValues(input),
      target.edition,
    );
    results.push({
      edition: target.edition,
      ...(await applyGraphicsTemplate(
        { id: input?.id, values },
        target.file,
        target.stateDir,
      )),
    });
  }
  if (!results.length)
    throw new Error(
      "settings.xml не найден. Сначала запустите GTA V хотя бы один раз.",
    );
  return {
    applied: true,
    id: String(input?.id || ""),
    editions: results.map((item) => item.edition),
    results,
  };
}

/** Чтение: Legacy, а если его нет — Enhanced; плюс какие издания найдены. */
export async function readGraphicsEverywhere(legacyFile, stateDir) {
  const found = [];
  for (const target of graphicsTargets(legacyFile, stateDir))
    if (await exists(target.file)) found.push(target);
  const primary = found[0] || graphicsTargets(legacyFile, stateDir)[0];
  const read = await readGraphicsSettings(
    primary.file,
    primary.stateDir,
    primary.edition,
  );
  return {
    ...read,
    edition: primary.edition,
    editions: found.map((item) => item.edition),
  };
}

/** «Стандарт» — в каждом файле, где Astral что-то менял. */
export async function restoreGraphicsEverywhere(legacyFile, stateDir) {
  const results = [];
  for (const target of graphicsTargets(legacyFile, stateDir)) {
    if (!(await exists(target.file))) continue;
    const state = await readGraphicsSettings(target.file, target.stateDir);
    if (!state.canRestore) continue;
    results.push({
      edition: target.edition,
      ...(await restoreGraphicsSettings(target.file, target.stateDir)),
    });
  }
  if (!results.length)
    throw new Error(
      "Astral ещё не менял настройки графики — возвращать нечего.",
    );
  return {
    restored: true,
    editions: results.map((item) => item.edition),
    results,
  };
}
