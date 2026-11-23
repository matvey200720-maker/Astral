/*
 * Небо: чистая база из игры и установка вида острова.
 *
 * Редактор в окне ничего не знает про архивы. Он присылает проект неба — вид
 * и прежние точечные правки, — а этот модуль достаёт из игры настоящие файлы
 * (все семнадцать погод, weather.xml, cloudkeyframes.xml, clouds.xml и
 * наборы бликов объектива `lensflare*.xml`),
 * собирает из них патч и отдаёт его тому же нативному установщику, который
 * ставит прицел и мини-карту.
 *
 * ЧИСТАЯ БАЗА
 *
 * Вид — это преобразования чисел игрока: «небо ярче в полтора раза». Если
 * взять за основу файл, который уже поставил сам Astral, второе «Применить»
 * сделает небо ярче ещё в полтора раза, третье — ещё. Поэтому основа
 * запоминается: что Astral записал в игру, известно по хешу, и если в игре
 * лежит ровно это, берётся снимок того, что было до него. Если в игре лежит
 * что-то другое — поставили редукс, игра обновилась, установку откатили, —
 * это и есть новая чистая база, и снимок переписывается. Но если у движка есть
 * копия игры до Astral (`update-update.rpf.original.rpf`), снятая после
 * последнего обновления игры, основа — она: «Как в игре» значит небо Rockstar,
 * а не то, что стоит сейчас (01.11.2026: живой файл не совпал с памятью, снимком
 * стало чёрное небо владельца, и «Сбросить всё» возвращало к нему). Чужой живой
 * файл помечается: новая установка заменит его вместе с нашими, а плитка
 * «Взять из своей игры» читает его как есть.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  LENS_FLARE_FILES,
  LOOK_WEATHERS,
  PREVIEW_WEATHER,
  appliedMoonBody,
  normalizeLook,
  parseKeyframeXml,
  parseProject,
  projectIsEmpty,
  rainbowSkyStops,
} from "@modovik/timecycle";
import {
  SKY_ARCHIVE_PATHS,
  compileSkyLookVariants,
  skyPatchManifest,
} from "@modovik/timecycle/compile-look.js";
import { PROTECTED_UPDATE_COPY } from "@modovik/install-engine/direct-base-cleanup.js";
import { ensureStoredFile, storedFileStamp, storedFileTimes } from "@modovik/install-engine/chunk-store.js";
import { readStateShared } from "@modovik/install-engine/engine-state.js";
import {
  archiveKeysDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { gameSourceMissing } from "./game-source-missing.js";
import { setSkyRainbow } from "./sky-rainbow.js";
import { setSkyDome } from "./sky-moon-body.js";
import { listSkySources, takeSkySource } from "./sky-sources.js";

/*
 * Нативный движок и поставщик ArchiveFix приходят параметрами, а не намертво
 * из импорта. В бою это те же самые функции; в тестах это единственный способ
 * проверить сборку патча, не открывая настоящий `update.rpf` и не требуя
 * Windows с установленной игрой.
 */
const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  rainbow: setSkyRainbow,
  skyDome: setSkyDome,
  stockCopy: protectedUpdateCopy,
});

const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_BASE_FILE_BYTES = 4 * 1024 * 1024;

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Проект неба обязателен.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES)
    throw new RangeError("Проект неба превышает 2 МБ.");
  return parseProject(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/*
 * Каталог ключей для чтения архива: явно переданный побеждает, иначе берётся
 * у той же поставки ArchiveFix, что и запись. Без ключей зашифрованная запись
 * на свежих сборках не читается вовсе.
 */
async function archiveKeys(input, stateDir, tools) {
  const { archiveSupport } = { ...defaultTools(), ...tools };
  return archiveKeysDirectory({
    keys: input?.keys,
    stateDir,
    provision: archiveSupport,
  });
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/*
 * Что читается и откуда.
 *
 * Ключ — «имя» файла для снимка и отчёта; `update` — путь внутри
 * `update.rpf`, `common` — внутри `common.rpf`. Копия в `update.rpf`
 * перекрывает базовую, поэтому сначала читается она.
 */
const SKY_FILES = Object.freeze([
  ...LOOK_WEATHERS.map((item) => ({
    key: `timecycle/${item.file}`,
    weather: item.id,
    update: `common/data/timecycle/${item.file}`,
    common: `data/timecycle/${item.file}`,
  })),
  {
    key: "weather.xml",
    update: "common/data/levels/gta5/weather.xml",
    common: "data/levels/gta5/weather.xml",
  },
  {
    key: "cloudkeyframes.xml",
    update: "common/data/cloudkeyframes.xml",
    common: "data/cloudkeyframes.xml",
  },
  {
    key: "clouds.xml",
    update: "common/data/clouds.xml",
    common: "data/clouds.xml",
  },
  /* Наборы бликов объектива: в `update.rpf` их нет, игра читает их из
     `common.rpf`, и погашенная копия ложится поверх (`Import`). */
  ...LENS_FLARE_FILES.map((file) => ({
    key: `lensflare/${file}`,
    lensFlare: file,
    update: `common/data/${file}`,
    common: `data/${file}`,
  })),
]);

/** Куда уезжает файл снимка: ключ → архивный путь установки. */
const TARGET_OF = (key) => {
  if (key === "weather.xml") return SKY_ARCHIVE_PATHS.weather;
  if (key === "cloudkeyframes.xml") return SKY_ARCHIVE_PATHS.cloudKeyframes;
  if (key === "clouds.xml") return SKY_ARCHIVE_PATHS.clouds;
  if (key.startsWith("timecycle/"))
    return SKY_ARCHIVE_PATHS.timecycle(key.slice("timecycle/".length));
  if (key.startsWith("lensflare/"))
    return SKY_ARCHIVE_PATHS.lensFlare(key.slice("lensflare/".length));
  return null;
};

/**
 * Живые файлы игры одним-двумя вызовами хоста: сперва `update.rpf`, затем
 * `common.rpf` — за теми, которых в `update.rpf` нет. Двадцать отдельных
 * вызовов стоили бы двадцать открытий двухгигабайтного архива. `only` —
 * ключи, если нужны не все файлы неба.
 */
async function readLiveFiles({ gameRoot, keys, context, native, only = null, update = null, strict = false }) {
  const scratch = path.join(os.tmpdir(), `astral-sky-${randomUUID()}`);
  const live = new Map();
  const files = only
    ? SKY_FILES.filter((item) => only.includes(item.key))
    : SKY_FILES;
  try {
    for (const archive of ["update", "common"]) {
      const wanted = files.filter((item) => !live.has(item.key));
      if (!wanted.length) break;
      const input =
        archive === "update" && update
          ? update
          : path.join(
              gameRoot,
              archive === "update" ? path.join("update", "update.rpf") : "common.rpf",
            );
      const exists = await fs.stat(input).then(
        (stat) => stat.isFile(),
        () => false,
      );
      if (!exists) {
        /* Печь обложек (`strict`): архива нет — отказ с его именем, а не небо из того, что нашлось в другом архиве. Приложение и установка читают как прежде. */
        if (strict) throw gameSourceMissing([archive === "update" ? "update/update.rpf" : "common.rpf"], "неба");
        continue;
      }
      const directory = path.join(scratch, archive);
      const result = await native(
        "extract-archive-entries",
        {
          input,
          outputDirectory: directory,
          entries: wanted.map((item) => item[archive]),
          gameRoot,
          keys,
        },
        context,
      );
      const written = new Map(
        (result?.files || []).map((file) => [
          String(file.entry).replace(/\\/g, "/").toLowerCase(),
          file.file,
        ]),
      );
      for (const item of wanted) {
        const name = written.get(item[archive].toLowerCase());
        if (!name) continue;
        const file = path.join(directory, name);
        const stat = await fs.stat(file);
        if (stat.size > MAX_BASE_FILE_BYTES)
          throw new RangeError(`${item.key} в архиве неправдоподобно велик.`);
        const bytes = await fs.readFile(file);
        live.set(item.key, {
          xml: bytes.toString("utf8"),
          sha256: sha256(bytes),
          inUpdate: archive === "update",
        });
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
  return live;
}

/* --- Копия игры до Astral --- */

/**
 * Копия update.rpf с первой подготовки движка — если она снята после последнего
 * обновления игры: копия прежней версии отдала бы устаревшие файлы.
 */
async function protectedUpdateCopy(stateDir, gameRoot) {
  if (!stateDir) return null;
  const state = await readStateShared(stateDir).catch(() => null);
  const found = Object.entries(state?.targets || {}).find(
    ([, target]) =>
      path.resolve(String(target?.gameRoot || "")).toLowerCase() ===
      path.resolve(gameRoot).toLowerCase(),
  );
  if (!found) return null;
  const file = path.join(stateDir, "bases", found[0], PROTECTED_UPDATE_COPY);
  const times = await storedFileTimes(file).catch(() => null);
  if (!times) return null;
  const executable = await fs.stat(path.join(gameRoot, "GTA5.exe")).catch(() => null);
  if (executable && executable.mtimeMs > (times.birthtimeMs || times.mtimeMs)) return null;
  return (await ensureStoredFile(file).catch(() => false)) ? file : null;
}

/**
 * Файлы неба из копии до Astral (и common.rpf — за теми, которых в копии нет).
 * Читаются один раз на копию: двухгигабайтный архив не открывается при каждом
 * открытии редактора. Копии нет или она не читается — `null`, основа как раньше.
 */
async function readStockFiles({ gameRoot, keys, context, native, stockCopy, stateDir, directory }) {
  try {
    const copy = await stockCopy(stateDir, gameRoot);
    if (!copy) return null;
    const folder = path.join(directory, "stock");
    const stamp = JSON.stringify((await storedFileStamp(copy).catch(() => null)) || copy);
    const memo = await fs
      .readFile(path.join(folder, "stock.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    const stock = new Map();
    if (memo?.stamp === stamp) {
      for (const [key, file] of Object.entries(memo.files || {})) {
        const xml = await fs.readFile(path.join(folder, file.file), "utf8");
        stock.set(key, { xml, sha256: file.sha256, inUpdate: file.inUpdate });
      }
      return stock;
    }
    const read = await readLiveFiles({ gameRoot, keys, context, native, update: copy });
    await fs.mkdir(folder, { recursive: true });
    const files = {};
    for (const [key, file] of read) {
      const name = snapshotName(key);
      await fs.writeFile(path.join(folder, name), file.xml, "utf8");
      files[key] = { file: name, sha256: file.sha256, inUpdate: file.inUpdate };
    }
    await fs.writeFile(path.join(folder, "stock.json"), JSON.stringify({ stamp, files }));
    return read;
  } catch {
    return null;
  }
}

/* --- Снимок чистой базы --- */

/**
 * Ключ снимка — папка игры. Хеш, а не путь: путь содержит имя пользователя
 * Windows, а имена файлов в кэше видны в логах и отчётах о сбоях.
 */
const storeKey = (gameRoot) =>
  sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16);

const storeDirectory = (stateDir, gameRoot) =>
  path.join(stateDir || os.tmpdir(), "sky-bases", storeKey(gameRoot));

const snapshotName = (key) => `${key.replace(/[^a-z0-9.-]+/gi, "_")}`;

async function readStore(directory) {
  try {
    const meta = JSON.parse(
      await fs.readFile(path.join(directory, "base.json"), "utf8"),
    );
    if (meta?.version !== 1) throw new Error("old");
    return {
      version: 1,
      files: meta.files && typeof meta.files === "object" ? meta.files : {},
      installed:
        meta.installed && typeof meta.installed === "object"
          ? meta.installed
          : {},
      foreign: meta.foreign && typeof meta.foreign === "object" ? meta.foreign : {},
    };
  } catch {
    return { version: 1, files: {}, installed: {}, foreign: {} };
  }
}

async function writeStore(directory, meta) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, "base.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(
    temporary,
    `${JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  await fs.rename(temporary, target);
}

/**
 * Чистая база по живым файлам и снимку.
 *
 * Живой файл, совпадающий байт в байт с тем, что поставил Astral, — это
 * наша установка, и основой служит снимок до неё. Любой другой живой файл —
 * новая чистая база: снимок переписывается, а память о нашей установке этого
 * файла стирается (её откатили или поверх поставили своё).
 */
async function resolveCleanBases({ live, directory, stock = null }) {
  const meta = await readStore(directory);
  const bases = new Map();
  let astral = false;
  for (const item of SKY_FILES) {
    const current = live.get(item.key);
    const stored = meta.files[item.key];
    const ours = meta.installed[item.key];
    const clean = current ? stock?.get(item.key) : null;
    if (clean) {
      const file = snapshotName(item.key);
      if (stored?.sha256 !== clean.sha256) {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, file), clean.xml, "utf8");
      }
      meta.files[item.key] = { file, sha256: clean.sha256, inUpdate: clean.inUpdate };
      const same = current.sha256 === clean.sha256;
      const mine = !same && ours === current.sha256 && meta.foreign[item.key] !== current.sha256;
      if (mine) astral = true;
      if (same) {
        delete meta.installed[item.key];
        delete meta.foreign[item.key];
      } else {
        /* Как и прежняя установка Astral: новая заменит этот файл, а не оставит его. */
        meta.installed[item.key] = current.sha256;
        if (!mine) meta.foreign[item.key] = current.sha256;
      }
      bases.set(item.key, {
        ...clean,
        live: current,
        foreign: meta.foreign[item.key] === current.sha256,
      });
      continue;
    }
    if (current && ours && current.sha256 === ours && stored) {
      const xml = await fs
        .readFile(path.join(directory, stored.file), "utf8")
        .catch(() => null);
      if (xml !== null && sha256(Buffer.from(xml, "utf8")) === stored.sha256) {
        bases.set(item.key, {
          xml,
          sha256: stored.sha256,
          inUpdate: stored.inUpdate,
          live: current,
        });
        astral = true;
        continue;
      }
    }
    if (!current) continue;
    const file = snapshotName(item.key);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, file), current.xml, "utf8");
    meta.files[item.key] = {
      file,
      sha256: current.sha256,
      inUpdate: current.inUpdate,
    };
    delete meta.installed[item.key];
    delete meta.foreign[item.key];
    bases.set(item.key, { ...current, live: current });
  }
  await writeStore(directory, meta);
  return { bases, astral, meta };
}

/** Чистая база в той форме, которую ждёт сборщик вида. */
function compileInput(bases) {
  const timecycles = {};
  for (const item of SKY_FILES) {
    if (!item.weather) continue;
    const base = bases.get(item.key);
    if (base) timecycles[item.weather] = { xml: base.xml, inUpdate: base.inUpdate };
  }
  const single = (key) => {
    const base = bases.get(key);
    return base ? { xml: base.xml, inUpdate: base.inUpdate } : null;
  };
  const lensFlares = {};
  for (const item of SKY_FILES) {
    if (!item.lensFlare) continue;
    const base = single(item.key);
    if (base) lensFlares[item.lensFlare] = base;
  }
  return {
    timecycles,
    weather: single("weather.xml"),
    cloudKeyframes: single("cloudkeyframes.xml"),
    clouds: single("clouds.xml"),
    lensFlares,
  };
}

/**
 * База неба для окна: все файлы разом, уже очищенные от прежней установки
 * Astral. Предпросмотр рисует от того же, от чего соберётся установка.
 * Наборы бликов окну не нужны — кадр бликов не рисует, — и через мост не
 * едут (четверть мегабайта на каждое открытие редактора).
 */
export async function readSkyBases(input, context, stateDir, tools = {}) {
  const { bases, astral } = await loadCleanBases(input, context, stateDir, tools);
  const { lensFlares: _lensFlares, ...forWindow } = compileInput(bases);
  /* В игре сейчас не то, что в основе: «Применить» у пустого неба вернёт основу. */
  const liveDiffers = [...bases.values()].some((base) => base.live && base.live.sha256 !== base.sha256);
  return { ...forWindow, astral, liveDiffers };
}

/** Живые файлы и чистая база одной игры. */
async function loadCleanBases(input, context, stateDir, tools) {
  const { native, stockCopy } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const keys = await archiveKeys(input, stateDir, tools);
  const live = await readLiveFiles({ gameRoot, keys, context, native, strict: input?.strictSources === true });
  if (!live.size) throw new Error("В архивах игры не нашлось файлов неба.");
  const directory = storeDirectory(stateDir, gameRoot);
  const stock = await readStockFiles({ gameRoot, keys, context, native, stockCopy, stateDir, directory });
  return { gameRoot, directory, ...(await resolveCleanBases({ live, directory, stock })) };
}

/**
 * Небо, которое уже стоит в игре: найденное в `update.rpf`, слое OpenIV и
 * дополнениях — только список (`sky-sources.js`). Только чтение.
 */
export async function readSkySources(input, context, stateDir, tools = {}) {
  const gameRoot = requireGameRoot(input);
  const keys = await archiveKeys(input, stateDir, tools);
  return listSkySources({ gameRoot, keys, open: tools.open });
}

/**
 * Берёт небо выбранного источника проектом редактора. «Живое» небо
 * `update.rpf` — из чистой базы (без прежней установки Astral): то, что
 * поставил сам Astral, чужим пакетом не считается.
 */
export async function takeSkySourceFromGame(input, context, stateDir, tools = {}) {
  const gameRoot = requireGameRoot(input);
  const id = String(input?.id || "");
  if (!id) throw new Error("Не выбрано небо, которое взять.");
  const keys = await archiveKeys(input, stateDir, tools);
  let liveFiles = null;
  if (id === "live") {
    const { bases } = await loadCleanBases(input, context, stateDir, tools);
    /* Чужое небо — как оно лежит в игре; своя прежняя установка — без неё, снимком. */
    const textOf = (key) => {
      const base = bases.get(key);
      return base?.foreign ? base.live.xml : base?.xml;
    };
    liveFiles = [
      ...LOOK_WEATHERS.map((item) => ({ name: item.file, text: textOf(`timecycle/${item.file}`) })),
      ...["weather.xml", "clouds.xml", "cloudkeyframes.xml"].map((name) => ({ name, text: textOf(name) })),
    ].filter((file) => file.text);
  }
  return takeSkySource({ gameRoot, keys, id, open: tools.open, liveFiles });
}

/*
 * Файлы, которые Astral уже ставил, но которые новый вид не меняет.
 *
 * Их надо вернуть к чистой базе явно: иначе в игре остался бы прежний
 * вариант (включил дождь обратно — а w_rain.xml всё ещё ясный), и новая
 * установка не закрывала бы прежнюю целиком — библиотеке пришлось бы
 * снимать прежнюю отдельным проходом по архиву. Файл, которого в
 * `update.rpf` не было (снег лежит в `common.rpf`), не пишется заново, а
 * удаляется оттуда: база снова читается из `common.rpf`.
 */
function restoreFiles({ bases, meta, compiled }) {
  const written = new Set(compiled.files.map((file) => file.target));
  const restores = [];
  for (const item of SKY_FILES) {
    if (!meta.installed[item.key]) continue;
    const target = TARGET_OF(item.key);
    if (!target || written.has(target)) continue;
    const base = bases.get(item.key);
    if (!base) continue;
    if (!base.inUpdate) {
      restores.push({
        kind: "restore",
        id: item.key,
        file: path.posix.basename(item.key),
        target,
        action: "Delete",
        size: 0,
        sha256: "",
      });
      continue;
    }
    const bytes = Buffer.from(base.xml, "utf8");
    restores.push({
      kind: "restore",
      id: item.key,
      file: path.posix.basename(item.key),
      target,
      action: "Replace",
      xml: base.xml,
      size: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return restores;
}

/* --- Небо для радуги --- */

/* Ясный день: по нему кадр показывает небо, по нему же радуга берёт свет. */
const CLEAR_SKY_KEY = `timecycle/${
  LOOK_WEATHERS.find((item) => item.id === PREVIEW_WEATHER)?.file
}`;

/**
 * Яркость неба по часам для радуги (`rainbowSkyStops`) из текста ясного дня.
 * Нечитаемый файл — не отказ радуги: без профиля она ставится по эталону
 * ванили (`sky-rainbow.js`).
 */
function skyStopsFromXml(xml) {
  if (!xml) return null;
  try {
    return rainbowSkyStops({ document: parseKeyframeXml(xml) });
  } catch {
    return null;
  }
}

async function materialize(input, context, stateDir, tools) {
  const project = boundedProject(input.project);
  const { gameRoot, directory, bases, meta } = await loadCleanBases(input, context, stateDir, tools);
  /* `input.variants` — виды для отдельных типов погоды (только наборы для стенда): `{ ТИП: вид }`; у людей их нет. */
  const compiled = compileSkyLookVariants({ project, variants: input.variants || {}, bases: compileInput(bases) });
  const files = [...compiled.files, ...restoreFiles({ bases, meta, compiled })];
  /* Пустое небо ставит только возврат: в игре не основа — она и вернётся. */
  if (projectIsEmpty(project) && !files.length)
    throw new Error("В проекте неба нет изменений — устанавливать нечего.");
  /* Ясный день таким, каким он будет в игре после установки: собранный, а
     если вид его не меняет — чистая база. По нему светит радуга. */
  const skyStops = skyStopsFromXml(
    compiled.files.find(
      (file) => file.kind === "timecycle" && file.weather === PREVIEW_WEATHER,
    )?.xml ?? bases.get(CLEAR_SKY_KEY)?.xml,
  );
  /* Вид, который меняет только радугу, файлов неба не трогает: патча нет, а
     радуга ставится своим пакетом (`applyTimecycleCustomization`). */
  if (!files.length)
    return {
      patch: null,
      gameRoot,
      directory,
      files: [],
      missing: compiled.missing,
      skipped: compiled.skipped,
      applied: compiled.applied,
      totalBytes: 0,
      skyStops,
    };

  const patchDirectory = path.join(
    path.resolve(stateDir || os.tmpdir()),
    "timecycle-patches",
    randomUUID(),
  );
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  for (const file of files) {
    if (file.action === "Delete") continue;
    await fs.writeFile(path.join(payloadDirectory, file.file), file.xml, {
      flag: "wx",
    });
  }
  const manifest = skyPatchManifest({
    name: `Astral sky — ${project.name}`,
    files,
  });
  await fs.writeFile(
    path.join(patchDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );

  return {
    patch: patchDirectory,
    gameRoot,
    directory,
    files: files.map((file) => ({
      kind: file.kind,
      id: file.id,
      file: file.file,
      target: file.target,
      action: file.action,
      size: file.size,
      sha256: file.sha256,
      applied: file.applied ?? 0,
      mode: file.mode,
      from: file.from,
    })),
    missing: compiled.missing,
    skipped: compiled.skipped,
    applied: compiled.applied,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    skyStops,
  };
}

/**
 * Память о том, что Astral записал: после установки живой файл равен этому
 * хешу, и следующее чтение возьмёт основой снимок, а не нашу же работу.
 */
async function rememberInstalled(directory, files) {
  const meta = await readStore(directory);
  const key = (target) =>
    SKY_FILES.find((item) => TARGET_OF(item.key) === target)?.key || null;
  for (const file of files) {
    const name = key(file.target);
    if (!name) continue;
    delete meta.foreign[name];
    if (file.action === "Delete") delete meta.installed[name];
    else meta.installed[name] = file.sha256;
  }
  await writeStore(directory, meta);
}

export async function planTimecycleCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const { native } = { ...defaultTools(), ...tools };
  const { skyStops: _skyStops, ...generated } = await materialize(
    input,
    context,
    stateDir,
    tools,
  );
  /* Без файлов неба (вид меняет только радугу) проверять нечего. */
  const validation = generated.patch
    ? await native("validate-rpf-patch", { patch: generated.patch }, context)
    : null;
  return {
    ...generated,
    validation,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
  };
}

export async function applyTimecycleCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, archiveSupport, rainbow, skyDome } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  const look = normalizeLook(boundedProject(input.project).look);
  const wantsRainbow = look.weather.rainbow === true;
  /* Планета вместо луны в этой альфе скрыта (space-templates.js): в игру кладётся только тело-Луна и лист звёзд, штатная Луна остаётся. */
  const moonBody = appliedMoonBody(look.moonBody);
  const wantsDome = moonBody !== null || look.starSheet !== null;
  if (!generated.patch && !wantsRainbow && !wantsDome)
    throw new Error("Небо совпадает с игрой — ставить нечего.");
  await assertRuntimeSafety?.(generated.gameRoot);
  let installed = {};
  if (generated.patch) {
    const support = await archiveSupport({ stateDir });
    installed = await native(
      "install-rpf-patch",
      {
        patch: generated.patch,
        gameRoot: generated.gameRoot,
        archiveFix: path.join(support.directory, "ArchiveFix.exe"),
        keys: support.directory,
      },
      context,
    );
    await rememberInstalled(generated.directory, generated.files);
  }
  /*
   * Радуга — отдельный файл (пакет слоя Astral), и её судьбу решает
   * выключатель: включена — ставится, выключена — снимается, если стояла.
   * Её отказ не отменяет уже поставленное небо, а приходит отдельной строкой:
   * небо — в игре, радуга — нет, и человек видит почему.
   */
  let rainbowResult;
  try {
    rainbowResult = await rainbow(
      {
        gameRoot: generated.gameRoot,
        enabled: wantsRainbow,
        /* Когда видна и насколько ярко — часть вида, как и всё небо. */
        rainbow: look.rainbow,
        /* Свет по часам — от неба, которое только что встало. */
        skyStops: generated.skyStops,
      },
      context,
      stateDir,
      { assertRuntimeSafety },
    );
  } catch (error) {
    rainbowResult = {
      status: "failed",
      enabled: wantsRainbow,
      error: String(error?.message || error),
    };
  }
  /*
   * Луна-тело и свой лист звёзд — тоже отдельный файл (`skydome.ytd`), и его судьбу решает вид: есть — кладётся, нет, а раньше мы его
   * ставили — убирается. Отказ не отменяет поставленное небо и приходит отдельной строкой.
   */
  let skyDomeResult;
  try {
    skyDomeResult = await skyDome(
      { gameRoot: generated.gameRoot, moonBody, starSheet: look.starSheet },
      context,
      stateDir,
      { archiveSupport, native },
    );
  } catch (error) {
    skyDomeResult = { status: "failed", enabled: wantsDome, error: String(error?.message || error) };
  }
  return {
    ...installed,
    rainbow: rainbowResult,
    skyDome: skyDomeResult,
    patch: generated.patch,
    gameRoot: generated.gameRoot,
    files: generated.files,
    missing: generated.missing,
    skipped: generated.skipped,
    applied: generated.applied,
    totalBytes: generated.totalBytes,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
  };
}

/**
 * Радуга сама по себе — без установки неба: снять её («Откатить», небо как
 * в игре) или переставить поставленную прежней версией Astral тем же
 * замыслом. Свет по часам — от неба, которое стоит в игре сейчас: его
 * радуга и окажется на фоне. Небо не прочиталось — радуга ставится по
 * эталону ванили, а не отказывает.
 */
export async function putSkyRainbow(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, rainbow } = { ...defaultTools(), ...tools };
  if (input?.enabled !== true)
    return rainbow(
      { gameRoot: input?.gameRoot, enabled: false },
      context,
      stateDir,
      { assertRuntimeSafety },
    );
  const gameRoot = requireGameRoot(input);
  let skyStops = null;
  try {
    const keys = await archiveKeys(input, stateDir, tools);
    const live = await readLiveFiles({
      gameRoot,
      keys,
      context,
      native,
      only: [CLEAR_SKY_KEY],
    });
    skyStops = skyStopsFromXml(live.get(CLEAR_SKY_KEY)?.xml);
  } catch {
    skyStops = null;
  }
  return rainbow(
    { gameRoot, enabled: true, rainbow: input?.rainbow ?? null, skyStops },
    context,
    stateDir,
    { assertRuntimeSafety },
  );
}
