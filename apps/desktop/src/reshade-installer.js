/*
 * DLSS 5 и пресеты ReShade: пакет, места установки и сама установка (задача 4
 * ТЗ 04.10.2026; с ТЗ 05.10, задача 15, — только DLSS 5; с ТЗ 17.10,
 * задача 8, — снова ещё и пресеты на своём шейдере Astral.fx, отдельно от
 * DLSS 5). Что куда ставится и почему — `@modovik/optimizer/reshade.js`.
 *
 * ПАКЕТ. ReShade с аддонами и DLSS 5 Astral не скачивает: это сборка, которую
 * игроки передают друг другу (`dlss5` — `dxgi.dll` ReShade 6.7.3, аддон
 * RenoDX DLSS и нейросеть NVIDIA `nvngx_dlssnr.dll` на 166 МБ). Пакет
 * находится сам (Рабочий стол, Загрузки, Документы, папка `dlss5`) или
 * выбирается папкой и один раз копируется в хранилище Astral — дальше папку
 * можно удалить. Каждый файл узнаётся по себе: ReShade — по строке
 * «ReShade» в DLL, аддон — по «RenoDX», нейросеть — по размеру и PE.
 *
 * УСТАНОВКА. В выбранные места (`majestic` — папка графических модов
 * лаунчера Majestic, `game` — корень GTA V) кладётся ReShade — у Majestic
 * `dxgi.dll` (клиент Majestic грузит его сам), в корне игры `ReShade.asi`:
 * GTA V Legacy сейчас берёт `dxgi.dll` и `d3d11.dll` только из System32
 * полным путём (проверено в процессе игры 05.10.2026 — `dxgi.dll` из корня
 * не загрузился), а `.asi` грузит загрузчик ASI игры (dinput8.dll и т. п.);
 * без загрузчика в корне ставить некуда — так и сказано. Дальше —
 * `ReShade.ini`, пустой шаблон ReShade, аддон DLSS 5 и нейросеть. Чужой файл
 * с тем же именем (свой ReShade игрока, его `ReShade.ini`) сначала уезжает в
 * копию и возвращается при снятии. Запись установки помнит каждый файл с
 * отпечатком: снимается ровно своё, файл, который после нас поменял кто-то
 * другой, не трогается. Шейдер и шаблоны прежних установок (до ТЗ 05.10)
 * уходят при первой же переустановке — их нет в новом наборе файлов.
 *
 * Пока игра запущена, ничего не пишется: `dxgi.dll` занят, а наполовину
 * переставленный ReShade — это вылет при следующем запуске.
 *
 * MAJESTIC. Папку графических модов клиент грузит, только если в лаунчере
 * включена «Поддержка графических модификаций» — Astral включает её сам и
 * при снятии возвращает как было.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
/* Отпечаток — кусками по 4 МБ в один и тот же буфер (`sha256File`), а не
   потоком по 64 КБ: на двухгигабайтном update.rpf это 32 тыс. буферов, и
   в Electron главный поток вставал на их выделении (ОЗУ 15.10, бета.15). */
import { sha256File } from "@modovik/install-engine/manifest.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ASTRAL_FX,
  RESHADE_EMPTY_PRESET,
  RESHADE_PACK_FILES,
  RESHADE_PRESET_FILE,
  RESHADE_PRESET_IDS,
  RESHADE_SHADER_FILE,
  RESHADE_TARGETS,
  RESHADE_TARGET_IDS,
  describeReshade,
  normalizeReshadeProject,
  reshadeIni,
  reshadeIniWithOverlayKey,
  reshadePresetFile,
  reshadePresetIni,
  reshadeProjectIsEmpty,
  reshadeStyleShader,
  reshadeStyleShaderFile,
} from "@modovik/optimizer/reshade.js";
import { ASI_LOADERS } from "@modovik/install-engine";
import { openAssetPack, readAssetPackParts } from "./asset-pack.js";
import { parseTasklist, runningProcessNames } from "./game-processes.js";

const execFileAsync = promisify(execFile);
const STORE = "reshade";
/* Под каким именем ReShade лежит в месте установки. */
export const RESHADE_FILE_BY_TARGET = Object.freeze({ majestic: "dxgi.dll", game: "ReShade.asi" });
/* Что ReShade пишет сам рядом с собой: при снятии уходит, если до нас его не было. */
const RUNTIME_FILES = Object.freeze(["ReShade.log", "ReShade.log.old"]);
const RECORD_FILE = "installs.json";
/* Пределы файлов пакета: ReShade и аддон — мегабайты, нейросеть — сотни. */
const LIMITS = Object.freeze({
  reshade: [512 * 1024, 64 * 1024 * 1024],
  addon: [64 * 1024, 64 * 1024 * 1024],
  neural: [16 * 1024 * 1024, 1024 * 1024 * 1024],
});
const MARKERS = Object.freeze({ reshade: ["ReShade", "crosire"], addon: ["RenoDX"], neural: [] });

const storeRoot = (stateDir) => path.join(path.resolve(stateDir || os.tmpdir()), STORE);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const exists = (file) => fs.stat(file).then(() => true, () => false);

/* Есть ли в файле строка — в ASCII или UTF-16 (ресурсы версии у PE). */
async function contains(file, words, limit = 32 * 1024 * 1024) {
  if (!words.length) return true;
  const handle = await fs.open(file, "r");
  try {
    const size = Math.min((await handle.stat()).size, limit);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return words.some((word) => buffer.includes(Buffer.from(word, "latin1")) || buffer.includes(Buffer.from(word, "utf16le")));
  } finally {
    await handle.close();
  }
}

async function isPe(file) {
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    return head.toString("latin1") === "MZ";
  } finally {
    await handle.close();
  }
}

/* Файл пакета годится: PE, разумный размер, своя строка внутри. */
async function packFile(folder, role) {
  const file = path.join(folder, RESHADE_PACK_FILES[role]);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  const [min, max] = LIMITS[role];
  if (stat.size < min || stat.size > max) return null;
  if (!(await isPe(file).catch(() => false))) return null;
  if (!(await contains(file, MARKERS[role]).catch(() => false))) return null;
  return { file, size: stat.size };
}

/* Папка пакета: в ней ReShade; аддон и нейросеть — если есть, рядом. */
async function packIn(folder) {
  const reshade = await packFile(folder, "reshade");
  if (!reshade) return null;
  const addon = await packFile(folder, "addon");
  const neural = await packFile(folder, "neural");
  return { folder, reshade, addon, neural, dlss: Boolean(addon && neural) };
}

/* ------------------------------------------------------------ пакет в поставке */

/*
 * Пакет DLSS 5 едет в составе Astral (ТЗ 08.10.2026, задача 2): три файла
 * сборки игроков складом ASP1 в `resources/dlss5` (zstd, ≈115 МБ вместо
 * 174; собирает `scripts/pack-dlss5.mjs`). Распаковывается при включении —
 * в хранилище Astral `<state>/reshade/pack`, с проверкой SHA-256 каждого
 * файла по описи `dlss5.json`. Искать папку на рабочем столе и выбирать
 * её больше не нужно.
 */
const BUNDLE_NAME = "dlss5";

/* Пакет в хранилище Astral: `pack.json` с отпечатками, файлы рядом. */
async function storedPack(stateDir) {
  const folder = path.join(storeRoot(stateDir), "pack");
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(folder, "pack.json"), "utf8"));
    const found = await packIn(folder);
    return found ? { ...found, stored: true, imported: manifest } : null;
  } catch {
    return null;
  }
}
const dirname = path.dirname(fileURLToPath(import.meta.url));

export async function bundledPackRoot(env = process.env) {
  const candidates = [
    env.ASTRAL_DLSS5_RESOURCES,
    process.resourcesPath && path.join(process.resourcesPath, BUNDLE_NAME),
    path.resolve(dirname, "../../../resources", BUNDLE_NAME),
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(path.join(candidate, `${BUNDLE_NAME}.json`))) return candidate;
  return "";
}

async function bundledManifest(env) {
  const root = await bundledPackRoot(env);
  if (!root) return null;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, `${BUNDLE_NAME}.json`), "utf8"));
    return Array.isArray(manifest?.files) ? { root, manifest } : null;
  } catch {
    return null;
  }
}

/* Роли файлов пакета: ReShade нужен всегда, аддон и нейросеть — только DLSS 5. */
const PACK_ROLES = Object.freeze(["reshade", "addon", "neural"]);
const REQUIRED_ROLES = Object.freeze({ presets: ["reshade"], dlss: PACK_ROLES });

/*
 * Распакованный пакет совпадает с поставкой: те же имена, размеры и суммы в
 * `pack.json`, файлы на месте. `roles` — какие файлы нужны (пресетам хватает
 * ReShade, DLSS 5 нужны все три).
 */
function storedMatches(stored, manifest, roles = PACK_ROLES) {
  if (!manifest) return Boolean(stored?.dlss);
  if (!stored) return false;
  const files = stored.imported?.files || {};
  return roles.every((role) => {
    const name = RESHADE_PACK_FILES[role];
    const expected = manifest.files.find((file) => file.name === name);
    return Boolean(stored[role] && expected && Object.values(files).some((item) => item?.name === name && item.sha256 === expected.sha256 && item.size === expected.size));
  });
}

/**
 * Пакет DLSS 5: распакованный в хранилище Astral или в поставке.
 * `{ found, stored, bundled, dlss, sizes }` — окну.
 */
export async function locateReshadePack(stateDir, { env = process.env } = {}) {
  const bundle = await bundledManifest(env);
  const stored = await storedPack(stateDir);
  if (stored && storedMatches(stored, bundle?.manifest)) return { ...stored, bundled: Boolean(bundle) };
  if (!bundle) return stored;
  const size = (name) => bundle.manifest.files.find((file) => file.name === name)?.size || 0;
  return {
    folder: "",
    stored: false,
    bundled: true,
    dlss: true,
    reshade: { size: size(RESHADE_PACK_FILES.reshade) },
    addon: { size: size(RESHADE_PACK_FILES.addon) },
    neural: { size: size(RESHADE_PACK_FILES.neural) },
  };
}

/**
 * Пакет из поставки — в хранилище Astral: части склада склеиваются, сумма
 * склада и каждого файла сверяется; битый склад в игру не едет. Уже
 * распакованный и совпадающий — ничего не делается. `roles` — какие файлы
 * нужны: пресетам ReShade хватает самого ReShade (5 МБ), нейросеть на 166 МБ
 * распаковывается, только когда включают DLSS 5.
 */
export async function unpackBundledPack(stateDir, { env = process.env, roles = PACK_ROLES } = {}) {
  const bundle = await bundledManifest(env);
  if (!bundle) throw new Error("Пакета DLSS 5 нет рядом с приложением — переустановите Astral.");
  const stored = await storedPack(stateDir);
  if (stored && storedMatches(stored, bundle.manifest, roles)) return stored;
  const bytes = await readAssetPackParts(path.join(bundle.root, BUNDLE_NAME));
  if (!bytes || sha256(bytes) !== bundle.manifest.sha256) throw new Error("Пакет DLSS 5 в поставке повреждён — переустановите Astral.");
  const pack = openAssetPack(bytes);
  const folder = path.join(storeRoot(stateDir), "pack");
  await fs.mkdir(folder, { recursive: true });
  const files = {};
  for (const role of PACK_ROLES.filter((item) => roles.includes(item))) {
    const name = RESHADE_PACK_FILES[role];
    const expected = bundle.manifest.files.find((file) => file.name === name);
    const data = pack.read(name);
    if (!expected || !data || sha256(data) !== expected.sha256) throw new Error(`Пакет DLSS 5 в поставке повреждён (${name}) — переустановите Astral.`);
    const staged = path.join(folder, `${name}.${process.pid}.tmp`);
    await fs.writeFile(staged, data);
    await fs.rename(staged, path.join(folder, name));
    files[role] = { name, size: data.length, sha256: expected.sha256 };
  }
  await fs.writeFile(path.join(folder, "pack.json"), `${JSON.stringify({ source: "astral", version: bundle.manifest.version, files, importedAt: new Date().toISOString() }, null, 2)}
`);
  return storedPack(stateDir);
}

/* ------------------------------------------------------------ места */

/** Папки мест установки: Majestic — по APPDATA, игра — корень GTA V. */
export function reshadeTargetFolders({ gameRoot = "", env = process.env } = {}) {
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return {
    majestic: { base: path.join(appData, "majestic-launcher", "Multiplayer"), folder: path.join(appData, "majestic-launcher", "Multiplayer", "mods", "graphics") },
    game: { base: gameRoot ? path.resolve(gameRoot) : "", folder: gameRoot ? path.resolve(gameRoot) : "" },
  };
}

async function targetAvailable(id, folders) {
  const { base } = folders[id];
  if (!base) return false;
  if (id === "game") return exists(path.join(base, "GTA5.exe"));
  return exists(base);
}

/* Загрузчик ASI в корне игры: без него `ReShade.asi` не загрузится. */
async function asiLoaderIn(folder) {
  for (const name of ASI_LOADERS) if (folder && (await exists(path.join(folder, name)))) return name;
  return "";
}

/* ------------------------------------------------------------ Majestic */

/*
 * «Поддержка графических модификаций» лаунчера Majestic —
 * `settings.enableModSupport` в `%APPDATA%\majestic-launcher\prefs.latest.json`
 * (по умолчанию выключена). Лаунчер читает её при каждом запуске игры и
 * передаёт клиенту — без неё папка `mods\graphics` не грузится (так в коде
 * лаунчера). Открытый лаунчер держит настройки в памяти и перепишет файл
 * своими, поэтому Astral меняет её только при закрытом лаунчере.
 */
const MAJESTIC_LAUNCHER = "majestic launcher.exe";
/* Ядро графического мода в папке Majestic — так его узнаёт сам лаунчер. */
const MAJESTIC_CORES = Object.freeze(["dxgi.dll", "d3d11.dll"]);

export function majesticPrefsFile(env = process.env) {
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "majestic-launcher", "prefs.latest.json");
}

async function readMajesticPrefs(env) {
  const file = majesticPrefsFile(env);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { file, text: "", data: {} };
    throw error;
  }
  const data = JSON.parse(text);
  return { file, text, data: data && typeof data === "object" && !Array.isArray(data) ? data : {} };
}

/** Поддержка графических модов Majestic: `true`, `false` или `null` (ключа нет — выключена). */
export async function majesticModSupport(env = process.env) {
  const prefs = await readMajesticPrefs(env).catch(() => null);
  const value = prefs?.data?.settings?.enableModSupport;
  return typeof value === "boolean" ? value : null;
}

/* `true`/`false` — записать; `null` — убрать ключ, как было до Astral. Остальное — как у лаунчера. */
async function writeMajesticModSupport(env, value) {
  const { file, text, data } = await readMajesticPrefs(env);
  const settings = data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? { ...data.settings } : {};
  if (value === null) delete settings.enableModSupport;
  else settings.enableModSupport = value;
  const indent = !text || /^\{\r?\n\t/.test(text) ? "\t" : 2;
  const staged = `${file}.astral-${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(staged, `${JSON.stringify({ ...data, settings }, null, indent)}${text.endsWith("\n") ? "\n" : ""}`);
  await fs.rename(staged, file);
}

async function majesticLauncherRunning(tools) {
  if (tools.majesticLauncherRunning) return tools.majesticLauncherRunning();
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return parseTasklist(stdout).has(MAJESTIC_LAUNCHER);
  } catch {
    return false;
  }
}

/*
 * Снятие из Majestic: поддержку модов — как была до Astral, если в папке не
 * осталось ничьего ReShade/ENB (ему она нужна) и лаунчер закрыт (открытый
 * перепишет файл; включённая поддержка без модов ничему не мешает).
 */
async function restoreMajesticModSupport(entry, folder, env, tools) {
  if (!entry?.modSupport || entry.modSupport.before === true) return "kept";
  for (const name of MAJESTIC_CORES) if (folder && (await exists(path.join(folder, name)))) return "kept";
  if ((await majesticModSupport(env)) !== true) return "kept";
  if (await majesticLauncherRunning(tools)) return "launcher-open";
  await writeMajesticModSupport(env, entry.modSupport.before ?? null);
  return "restored";
}

async function readRecord(stateDir) {
  try {
    const record = JSON.parse(await fs.readFile(path.join(storeRoot(stateDir), RECORD_FILE), "utf8"));
    return record && typeof record === "object" && record.targets ? record : { targets: {} };
  } catch {
    return { targets: {} };
  }
}

async function writeRecord(stateDir, record) {
  await fs.mkdir(storeRoot(stateDir), { recursive: true });
  const file = path.join(storeRoot(stateDir), RECORD_FILE);
  const staged = `${file}.${process.pid}.tmp`;
  await fs.writeFile(staged, `${JSON.stringify(record, null, 2)}\n`);
  await fs.rename(staged, file);
}

/* Что лежит в месте установки сейчас: наши файлы целы, чужой ReShade, снято ли. */
async function targetStatus(id, folders, entry) {
  const folder = folders[id].folder;
  const loader = id === "game" ? { asiLoader: await asiLoaderIn(folder) } : {};
  if (!entry) {
    let foreignReshade = false;
    for (const name of new Set([RESHADE_FILE_BY_TARGET[id], "dxgi.dll"])) {
      const file = folder ? path.join(folder, name) : "";
      if (file && (await exists(file)) && (await contains(file, MARKERS.reshade).catch(() => false))) foreignReshade = true;
    }
    return { installed: false, foreignReshade, ...loader };
  }
  let missing = 0;
  let changed = 0;
  for (const file of entry.files || []) {
    const full = path.join(folder, file.path);
    if (!(await exists(full))) missing += 1;
    else if (file.size !== (await fs.stat(full)).size) changed += 1;
  }
  return { installed: true, missing, changed, project: entry.project, summary: describeReshade(entry.project), installedAt: entry.installedAt, ...loader };
}

/*
 * Видеокарта и драйвер (ТЗ 08.10, задача 2): DLSS 5 — нейросеть NVIDIA, ей
 * нужна видеокарта RTX и драйвер с NGX. Версию драйвера Windows отдаёт как
 * `32.0.16.1074`: последние пять цифр — версия NVIDIA (610.74). Сборка
 * проверена автором на 610.74 (журнал ReShade пакета).
 */
export const DLSS5_TESTED_DRIVER = 610.74;

/** Версия драйвера NVIDIA из версии Windows (`32.0.16.1074` → 610.74) или `null`. */
export function nvidiaDriverVersion(windowsVersion) {
  const parts = String(windowsVersion || "").split(".");
  if (parts.length < 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return Number(`${parts[2].slice(-1)}${parts[3].padStart(4, "0")}`) / 100;
}

let gpuCache = null;
export async function detectGpus({ run = execFileAsync } = {}) {
  if (gpuCache) return gpuCache;
  try {
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + [char]9 + $_.DriverVersion }"],
      { windowsHide: true, timeout: 15000 },
    );
    const adapters = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, driver = ""] = line.split("\t");
        return { name: name.trim(), driver: /NVIDIA/i.test(name) ? nvidiaDriverVersion(driver.trim()) : null };
      });
    const rtx = adapters.find((item) => /NVIDIA/i.test(item.name) && /RTX/i.test(item.name)) || null;
    gpuCache = { names: adapters.map((item) => item.name), rtx: Boolean(rtx), driver: rtx?.driver ?? null };
  } catch {
    gpuCache = { names: [], rtx: null, driver: null };
  }
  return gpuCache;
}

/**
 * Может ли DLSS 5 работать на этом компьютере: `{ ok, block, message }`.
 * Нет NVIDIA RTX — ставить нельзя (нейросеть не запустится, игра просто
 * будет без неё). Драйвер старше проверенного — предупреждение: со старым
 * драйвером нейросеть может не включиться.
 */
export function dlss5Compatibility(gpu) {
  if (gpu?.rtx === false)
    return {
      ok: false,
      block: true,
      message: `DLSS 5 работает только на видеокартах NVIDIA RTX (серии 20, 30, 40, 50). На этом компьютере — ${gpu.names?.join(", ") || "видеокарта не определена"}: нейросеть не запустится, поэтому Astral её не ставит.`,
    };
  if (gpu?.rtx === true && gpu.driver && gpu.driver < DLSS5_TESTED_DRIVER)
    return {
      ok: true,
      block: false,
      message: `Драйвер NVIDIA ${gpu.driver.toFixed(2)} старше проверенного ${DLSS5_TESTED_DRIVER} — если DLSS 5 в игре не включится, обновите драйвер (GeForce Experience или nvidia.com).`,
    };
  if (gpu?.rtx === true) return { ok: true, block: false, message: "" };
  return { ok: true, block: false, message: "Видеокарту определить не удалось: DLSS 5 нужна NVIDIA RTX и свежий драйвер." };
}

/*
 * Как DLSS 5 отработал в прошлый запуск — по журналу ReShade в месте
 * установки: «CreateFeature … succeeded» — нейросеть работала; строка
 * DLSS-NR с «failed»/«error» — не включилась, и человек видит причину
 * словами, а не молчаливую игру без DLSS.
 */
export function readDlssLog(text) {
  const lines = String(text || "").split(/\r?\n/);
  const gpuLine = lines.find((line) => /Running on .* Driver /.test(line));
  const failed = lines.filter(
    (line) => /DLSS-NR|nvngx|NGX/i.test(line) && /\b(failed|error)\b/i.test(line) && !/\|\s*WARN\s*\|/.test(line),
  );
  const worked = lines.some((line) => /DLSS-NR direct: (CreateFeature\(.*\) succeeded|EvaluateFeature succeeded)/.test(line));
  if (!gpuLine && !failed.length && !worked) return null;
  return {
    worked: worked && !failed.length,
    failure: failed.length ? failed[failed.length - 1].replace(/^.*?\|\s*(INFO|ERROR)\s*\|\s*/, "").slice(0, 240) : "",
    gpu: gpuLine ? gpuLine.replace(/^.*Running on\s*/, "").replace(/\.$/, "") : "",
  };
}

async function lastRunOf(folder) {
  if (!folder) return null;
  try {
    return readDlssLog(await fs.readFile(path.join(folder, "ReShade.log"), "utf8"));
  } catch {
    return null;
  }
}

/*
 * Места DLSS 5 — все проекты сразу: Majestic и «Россия Онлайн» (папка модов
 * лаунчера Majestic), GTA 5 RP (корень игры, `ReShade.asi` и загрузчик
 * ASI). Готово место или нет — и почему, словами.
 */
async function reshadePlaces(folders) {
  const places = [];
  for (const id of RESHADE_TARGET_IDS) {
    const available = await targetAvailable(id, folders);
    let reason = "";
    if (!available)
      reason =
        id === "majestic"
          ? "Лаунчер Majestic на этом компьютере не найден — Majestic и «Россия Онлайн» пропущены."
          : "GTA V для GTA 5 RP не найдена — корень игры пропущен.";
    else if (id === "game" && !(await asiLoaderIn(folders.game.folder)))
      reason = `В корне игры нет загрузчика ASI (${ASI_LOADERS.join(", ")}) — GTA 5 RP пропущен: ReShade в корне игры грузится как .asi, а его грузит загрузчик ASI (ставят OpenIV и ScriptHookV).`;
    places.push({ id, ready: available && !reason, reason });
  }
  return places;
}

/** Что есть: пакет, видеокарта, места установки и что в них стоит. */
export async function readReshadeState(input, stateDir, tools = {}) {
  const env = tools.env || process.env;
  const folders = reshadeTargetFolders({ gameRoot: input?.gameRoot || "", env });
  const record = await readRecord(stateDir);
  const pack = await locateReshadePack(stateDir, { env });
  const targets = [];
  for (const id of RESHADE_TARGET_IDS) {
    targets.push({
      id,
      label: RESHADE_TARGETS[id].label,
      folder: folders[id].folder,
      available: await targetAvailable(id, folders),
      ...(await targetStatus(id, folders, record.targets[id])),
      ...(id === "majestic" ? { modSupport: await majesticModSupport(env) } : {}),
      lastRun: record.targets[id] ? await lastRunOf(record.targets[id].folder || folders[id].folder) : null,
    });
  }
  const gpu = await (tools.detectGpus || detectGpus)();
  return {
    pack: pack
      ? { found: true, stored: Boolean(pack.stored), bundled: Boolean(pack.bundled), dlss: pack.dlss, sizes: { reshade: pack.reshade?.size || 0, addon: pack.addon?.size || 0, neural: pack.neural?.size || 0 } }
      : { found: false },
    gpu,
    compatibility: dlss5Compatibility(gpu),
    places: await reshadePlaces(folders),
    targets,
  };
}

/* ------------------------------------------------------------ установка */

/* Что кладётся в место установки: путь → { source | text }. */
/* Куда ReShade кладёт скриншоты (PrintScreen): «Изображения\GTA V ReShade». */
export function reshadeScreenshotFolder(env = process.env) {
  return path.join(env.USERPROFILE || os.homedir(), "Pictures", "GTA V ReShade");
}

/*
 * Набор файлов зависит от проекта (ТЗ 17.10, задача 8): ReShade, его ini и
 * пустой пресет — всегда; шейдер Astral.fx и все пресеты — пока выбран
 * пресет или ReShade стоит сам по себе (ТЗ 23.10, п. G: меню в игре не пустое;
 * PageDown/PageUp листают пресеты, когда один выбран; пока выбран стиль мира на весь
 * экран — ещё шейдер этого стиля, `AstralComic.fx` / `AstralPainted.fx` /
 * `AstralCartoon.fx` / `AstralWatercolor.fx` / `AstralRetro.fx`, и его
 * `Astral-<стиль>.ini`: шейдеры остальных стилей не ставятся); аддон и нейросеть — только при
 * DLSS 5. Файл, которого в новом наборе нет, при переустановке уходит
 * (`installTarget`), поэтому «Без пресета» убирает пресеты, а выключенный
 * DLSS 5 — нейросеть, не трогая второе.
 */
function plannedFiles(id, project, pack, cachePath, screenshotPath) {
  if (project.dlss.enabled && !pack.dlss) throw new Error("В пакете нет DLSS 5 (renodx-dlss.addon64 и nvngx_dlssnr.dll) — выберите полный пакет.");
  return [
    { path: RESHADE_FILE_BY_TARGET[id], source: pack.reshade.file },
    { path: "ReShade.ini", text: reshadeIni(project, { cachePath, screenshotPath }) },
    { path: RESHADE_PRESET_FILE, text: RESHADE_EMPTY_PRESET },
    ...(project.preset || project.reshade
      ? [
          { path: RESHADE_SHADER_FILE, text: ASTRAL_FX },
          ...RESHADE_PRESET_IDS.map((presetId) => ({ path: reshadePresetFile(presetId), text: reshadePresetIni(presetId) })),
          /* Стиль мира на весь экран (задача 35 (г), 38): свой шейдер и свой пресет — только пока он выбран, остальные не тронуты. */
          ...(reshadeStyleShader(project.preset)
            ? [
                { path: reshadeStyleShaderFile(project.preset), text: reshadeStyleShader(project.preset).source },
                { path: reshadePresetFile(project.preset), text: reshadePresetIni(project.preset) },
              ]
            : []),
        ]
      : []),
    ...(project.dlss.enabled
      ? [
          { path: RESHADE_PACK_FILES.addon, source: pack.addon.file },
          { path: RESHADE_PACK_FILES.neural, source: pack.neural.file },
        ]
      : []),
  ];
}

async function ensureGameClosed(tools) {
  const running = await (tools.runningProcesses || ((names) => runningProcessNames(names)))(["GTA5.exe", "PlayGTAV.exe"]).catch(() => []);
  if (running.length) throw new Error("Закройте GTA V (и лаунчер проекта) — пока игра запущена, ReShade занят и не ставится.");
}

/* Чужой файл на нашем месте — в копию, один раз за установку. */
async function backupForeign(stateDir, id, folder, relative, entry) {
  const full = path.join(folder, relative);
  if (!(await exists(full))) return null;
  const ours = (entry?.files || []).find((file) => file.path === relative);
  /* Свой ini, переписанный самим ReShade, — всё равно свой, не чужой. */
  if (ours && (OWN_BY_PLACE.test(relative) || ours.sha256 === (await sha256File(full)))) return null;
  const known = (entry?.backups || []).find((backup) => backup.path === relative);
  if (known) return known;
  const backup = path.join(storeRoot(stateDir), "backups", id, `${Date.now()}`, relative);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.copyFile(full, backup);
  return { path: relative, backup };
}

async function installTarget(id, folder, project, pack, stateDir, entry) {
  /* Папки (у Majestic — `mods\graphics`) до нас не было — при снятии пустая уйдёт. */
  const createdFolder = entry ? Boolean(entry.createdFolder) : !(await exists(folder));
  await fs.mkdir(folder, { recursive: true });
  /* Журнал ReShade, который был до нас (свой ReShade игрока), не наш. */
  const preexisting = entry?.preexisting || [];
  if (!entry) for (const name of RUNTIME_FILES) if (await exists(path.join(folder, name))) preexisting.push(name);
  const cachePath = path.join(os.tmpdir(), "ReShade");
  const files = plannedFiles(id, project, pack, cachePath, reshadeScreenshotFolder());
  const backups = [...(entry?.backups || [])];
  const written = [];
  for (const file of files) {
    const saved = await backupForeign(stateDir, id, folder, file.path, entry);
    if (saved && !backups.some((backup) => backup.path === saved.path)) backups.push(saved);
    const full = path.join(folder, file.path);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (file.source) {
      const hash = await sha256File(file.source);
      if (!(await exists(full)) || (await sha256File(full)) !== hash) await fs.copyFile(file.source, full);
      written.push({ path: file.path, size: (await fs.stat(full)).size, sha256: hash });
    } else {
      const bytes = Buffer.from(file.text, "utf8");
      await fs.writeFile(full, bytes);
      written.push({ path: file.path, size: bytes.length, sha256: sha256(bytes) });
    }
  }
  /* Прежние свои файлы, которых в наборе больше нет (шейдер и шаблоны
     ReShade установок до ТЗ 05.10), уходят — с опустевшими папками. */
  for (const old of entry?.files || []) {
    if (written.some((file) => file.path === old.path)) continue;
    await removeOwnFile(folder, old);
    await restoreBackup(folder, backups, old.path);
  }
  await pruneDirectories(folder);
  return {
    folder,
    files: written,
    backups: backups.filter((backup) => written.some((file) => file.path === backup.path)),
    preexisting,
    createdFolder,
    project,
    installedAt: new Date().toISOString(),
  };
}

/*
 * Настройки ReShade (`ReShade.ini`, шаблон; у прежних установок — ещё
 * шаблоны и шейдер `Astral.fx`) — наши по месту: ReShade сам переписывает
 * ini при выходе из игры и шаблон при правке в меню, и по отпечатку их было
 * бы уже не узнать. Двоичные файлы — по отпечатку: ReShade, обновлённый
 * игроком вручную, не трогается.
 */
const OWN_BY_PLACE = /\.(ini|fx)$/i;

async function removeOwnFile(folder, file) {
  const full = path.join(folder, file.path);
  if (!(await exists(full))) return;
  if (!OWN_BY_PLACE.test(file.path) && (await sha256File(full)) !== file.sha256) return;
  await fs.rm(full, { force: true });
}

async function restoreBackup(folder, backups, relative) {
  const backup = backups.find((item) => item.path === relative);
  if (!backup || !(await exists(backup.backup))) return;
  const full = path.join(folder, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.copyFile(backup.backup, full);
}

/* Пустые свои папки после снятия — убрать (шейдеры и шаблоны прежних установок). */
async function pruneDirectories(folder) {
  for (const relative of [path.join("reshade-shaders", "Shaders"), "reshade-shaders", "reshade-presets"]) {
    const full = path.join(folder, relative);
    const entries = await fs.readdir(full).catch(() => null);
    if (entries && !entries.length) await fs.rmdir(full).catch(() => {});
  }
}

async function removeTarget(folder, entry) {
  for (const file of entry.files || []) await removeOwnFile(folder, file);
  for (const name of RUNTIME_FILES) if (!(entry.preexisting || []).includes(name)) await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
  for (const backup of entry.backups || []) await restoreBackup(folder, entry.backups, backup.path);
  await pruneDirectories(folder);
  if (entry.createdFolder && !(await fs.readdir(folder).catch(() => [null])).length) await fs.rmdir(folder).catch(() => {});
}

/*
 * Смена клавиши меню у УЖЕ стоящего ReShade (ТЗ 23.10.2026, п. G): правится одна строка `KeyOverlay` в `ReShade.ini`
 * каждого места, остальное в файле — настройки, которые человек поменял в меню ReShade, чужие разделы, комментарии —
 * остаётся байт в байт (файл читается и пишется как `latin1`, чтобы не тронуть и не-ASCII). Ничего другого в месте
 * установки не пишется: ни ReShade, ни пресеты, ни шейдер, ни аддон. Нет самого `ReShade.ini` (удалили руками) — он
 * пишется заново полностью, как при установке: беречь в нём нечего. Игра должна быть закрыта, как и при установке.
 */
async function changeOverlayKey(input, stateDir, tools) {
  const project = normalizeReshadeProject(input?.project);
  const env = tools.env || process.env;
  const folders = reshadeTargetFolders({ gameRoot: input?.gameRoot || "", env });
  await ensureGameClosed(tools);
  const record = await readRecord(stateDir);
  const results = [];
  for (const id of RESHADE_TARGET_IDS) {
    const entry = record.targets[id];
    if (!entry) continue;
    const folder = entry.folder || folders[id].folder;
    const file = path.join(folder, "ReShade.ini");
    const previous = await fs.readFile(file, "latin1").catch(() => null);
    const next = normalizeReshadeProject({ ...entry.project, overlayKey: project.overlayKey });
    const bytes =
      previous === null
        ? Buffer.from(reshadeIni(next, { cachePath: path.join(os.tmpdir(), "ReShade"), screenshotPath: reshadeScreenshotFolder() }), "utf8")
        : Buffer.from(reshadeIniWithOverlayKey(previous, project.overlayKey), "latin1");
    const staged = `${file}.${process.pid}.tmp`;
    await fs.writeFile(staged, bytes);
    await fs.rename(staged, file);
    record.targets[id] = {
      ...entry,
      project: next,
      files: (entry.files || []).map((item) => (item.path === "ReShade.ini" ? { ...item, size: bytes.length, sha256: sha256(bytes) } : item)),
    };
    results.push({ id, action: previous === null ? "restored" : "key", folder });
  }
  if (results.length) await writeRecord(stateDir, record);
  return { status: results.length ? "done" : "absent", project, summary: describeReshade(project), targets: results, warning: "" };
}

/**
 * Один переключатель на все проекты (ТЗ 08.10, задача 2): включённый DLSS 5
 * ставится во все найденные места — Majestic и «Россия Онлайн», GTA 5 RP;
 * места, которых на компьютере нет, пропускаются с причиной. Выключенный —
 * снимается отовсюду. Пакет — из поставки, распаковывается при включении.
 */
export async function applyReshade(input, stateDir, tools = {}) {
  /* Только клавиша меню: правится одна строка в стоящем ReShade.ini, остальное не переустанавливается. */
  if (input?.keyOnly === true) return changeOverlayKey(input, stateDir, tools);
  const project = normalizeReshadeProject(input?.project);
  const env = tools.env || process.env;
  const folders = reshadeTargetFolders({ gameRoot: input?.gameRoot || "", env });
  await ensureGameClosed(tools);
  const record = await readRecord(stateDir);
  const enabled = !reshadeProjectIsEmpty(project);
  /* ReShade `.asi` в корне игры грузит ASI-прокси: нет его — Astral ставит свою пару загрузчиков тихо, перед установкой (23.11.2026). */
  if (enabled && tools.ensureGameLoader && folders.game.folder && (await targetAvailable("game", folders)) && !(await asiLoaderIn(folders.game.folder)))
    await tools.ensureGameLoader(folders.game.folder);
  const places = enabled ? await reshadePlaces(folders) : [];
  const wanted = places.filter((place) => place.ready).map((place) => place.id);
  if (enabled && !wanted.length) throw new Error(`${project.dlss.enabled ? "DLSS 5" : "ReShade"} некуда ставить. ${places.map((place) => place.reason).join(" ")}`);
  /* Видеокарта RTX нужна только нейросети: пресетам ReShade хватает любой. */
  const compatibility = project.dlss.enabled ? dlss5Compatibility(await (tools.detectGpus || detectGpus)()) : null;
  if (compatibility?.block) throw new Error(compatibility.message);
  /* Поддержку графических модов Majestic включаем сами — при закрытом лаунчере. */
  const modSupport = wanted.includes("majestic") ? await majesticModSupport(env) : null;
  if (wanted.includes("majestic") && modSupport !== true && (await majesticLauncherRunning(tools)))
    throw new Error(
      "Закройте лаунчер Majestic: Astral включит в нём «Поддержку графических модификаций» — без неё Majestic не грузит ReShade. Или включите её сами (лаунчер → «Модификации» → «Включить поддержку графических модификаций») и включите DLSS 5 ещё раз.",
    );
  /* Пакет из поставки — в хранилище Astral, с проверкой сумм. */
  const stored = wanted.length ? await unpackBundledPack(stateDir, { env, roles: project.dlss.enabled ? REQUIRED_ROLES.dlss : REQUIRED_ROLES.presets }) : null;
  const results = [];
  for (const id of RESHADE_TARGET_IDS) {
    const entry = record.targets[id];
    if (wanted.includes(id)) {
      /* Сначала поддержка модов: не записалась — файлы не ставятся. */
      if (id === "majestic" && modSupport !== true)
        await writeMajesticModSupport(env, true).catch((error) => {
          throw new Error(`Настройки лаунчера Majestic не записались (${majesticPrefsFile(env)}): ${error.message}`);
        });
      record.targets[id] = await installTarget(id, folders[id].folder, project, stored, stateDir, entry);
      /* «Как было» — с первой установки: переустановка его не меняет. */
      if (id === "majestic") record.targets[id].modSupport = { before: entry?.modSupport ? entry.modSupport.before : modSupport };
      results.push({ id, action: "installed", files: record.targets[id].files.length, folder: folders[id].folder, ...(id === "majestic" ? { modSupport: "on" } : {}) });
    } else if (entry) {
      const folder = entry.folder || folders[id].folder;
      await removeTarget(folder, entry);
      const support = id === "majestic" ? await restoreMajesticModSupport(entry, folder, env, tools) : null;
      delete record.targets[id];
      results.push({ id, action: "removed", folder, ...(support ? { modSupport: support } : {}) });
    } else if (enabled) {
      results.push({ id, action: "skipped", reason: places.find((place) => place.id === id)?.reason || "" });
    }
    await writeRecord(stateDir, record);
  }
  return { status: "done", project, summary: describeReshade(project), targets: results, warning: compatibility?.message || "" };
}

/** Снять ReShade Astral из мест `targets` (все — без списка). */
export async function removeReshade(input, stateDir, tools = {}) {
  await ensureGameClosed(tools);
  const record = await readRecord(stateDir);
  const ids = Array.isArray(input?.targets) && input.targets.length ? input.targets : Object.keys(record.targets);
  const env = tools.env || process.env;
  const folders = reshadeTargetFolders({ gameRoot: input?.gameRoot || "", env });
  const removed = [];
  let modSupport = null;
  for (const id of ids) {
    const entry = record.targets[id];
    if (!entry) continue;
    const folder = entry.folder || folders[id]?.folder;
    await removeTarget(folder, entry);
    if (id === "majestic") modSupport = await restoreMajesticModSupport(entry, folder, env, tools);
    delete record.targets[id];
    removed.push(id);
    await writeRecord(stateDir, record);
  }
  return { status: removed.length ? "removed" : "absent", removed, ...(modSupport ? { modSupport } : {}) };
}
