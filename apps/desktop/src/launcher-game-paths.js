/*
 * Путь к GTA V в лаунчерах серверов (задача 2 ТЗ 07.10.2026).
 *
 * Игру из Rockstar Games Launcher Astral ставит во вторую папку
 * (`rockstar-delivery.js`): лаунчер Rockstar при каждом запуске возвращает
 * свой update.rpf, и моды в папке самой игры пропадали. Но играют через
 * лаунчер сервера — и он должен запускать игру из второй папки. Прежде путь
 * человек менял руками (подсказка «вставьте путь в лаунчер сервера»); теперь
 * Astral меняет его сам и помнит прежний — удаление второй папки его
 * возвращает:
 *
 *   — Majestic: `%APPDATA%\majestic-launcher\prefs.latest.json`,
 *     `gameInstall.persisted = { source, path }` (так хранит его сам лаунчер;
 *     «Сменить GTA» в нём пишет `source: "custom"`). Перед игрой лаунчер
 *     сверяет папку: GTA5.exe, x64j.rpf и без GTA5_Enhanced.exe — у второй
 *     папки всё это есть (жёсткие ссылки). Открытый лаунчер держит настройки
 *     в памяти и перепишет файл своими — тогда путь не меняется, а человек
 *     узнаёт, что лаунчер надо закрыть;
 *   — RAGE Multiplayer (GTA5RP и другие серверы на RAGE):
 *     `HKCU\Software\RAGE-MP`, значение `game_v_path`.
 *
 * Steam и Epic сюда не попадают: второй папки у них нет.
 *
 * Заслон (13.11.2026). Настоящий реестр RAGE-MP и настоящие prefs Majestic —
 * чужие данные человека: 18.10 тестовая сессия без `ASTRAL_QA_LAUNCHERS` записала
 * на ПК владельца в `game_v_path` путь своей песочницы (`…\Temp\claude\…\sandbox-game (Astral)`),
 * и RAGE MP перестал находить игру. Теперь в настоящие хранилища не пишется
 * папка, которая лежит во временной папке, в песочнице или без GTA5.exe
 * (`launcherPathBlock`). Подменённые хранилища — `tools.writeRage`, `ASTRAL_QA_LAUNCHERS`,
 * другой `APPDATA` в тестах — заслон не трогает: они ничьих данных не держат.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseTasklist } from "./game-processes.js";

const execFileAsync = promisify(execFile);
const RECORD_FILE = "launcher-paths.json";
const MAJESTIC_LAUNCHER = "majestic launcher.exe";
const RAGE_KEY = "HKCU\\Software\\RAGE-MP";
const RAGE_VALUE = "game_v_path";

const samePath = (left, right) =>
  Boolean(left && right) && path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();
const recordKey = (folder) => path.resolve(String(folder || "")).toLowerCase();

/* ------------------------------------------------------------ Majestic */

/*
 * Стенд проверок: `ASTRAL_QA_LAUNCHERS=<папка песочницы>` — конфиг Majestic и
 * «реестр» RAGE (файл `rage-mp.json`) живут в ней, настоящие лаунчеры
 * человека не трогаются. Принимается, только если в пути есть `sandbox`.
 */
function qaLaunchers(env = process.env) {
  const folder = String(env.ASTRAL_QA_LAUNCHERS || "").trim();
  return folder && /sandbox/i.test(folder) ? folder : null;
}

export function majesticFolder(env = process.env) {
  const qa = qaLaunchers(env);
  if (qa) return path.join(qa, "majestic-launcher");
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "majestic-launcher");
}

const majesticPrefs = (env) => path.join(majesticFolder(env), "prefs.latest.json");

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ заслон */

const SANDBOX_PATH = /sandbox|astral-sbx/i;
const TEMP_SEGMENT = /(?:^|[\\/])(?:temp|tmp)(?:[\\/]|$)/i;

const inside = (folder, root) => {
  const base = path.resolve(String(root)).toLowerCase();
  const target = path.resolve(String(folder)).toLowerCase();
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);
};

/**
 * Почему этот путь нельзя записывать в настоящий лаунчер, или `null`.
 * `"empty"` — пути нет; `"temp"` — временная папка (`os.tmpdir()`, `TEMP`, `TMP`, сегмент `Temp`/`tmp`);
 * `"sandbox"` — песочница (`sandbox` или `astral-sbx` в пути); `"no-game"` — в папке нет GTA5.exe.
 * `requireGame: false` — для возврата прежнего пути: прежняя папка могла уйти, GTA5.exe там уже не спросишь.
 */
export async function launcherPathBlock(folder, { requireGame = true, env = process.env, check = exists } = {}) {
  const text = String(folder ?? "").trim();
  if (!text) return "empty";
  const temps = [os.tmpdir(), env.TEMP, env.TMP].filter(Boolean);
  if (TEMP_SEGMENT.test(text) || temps.some((root) => inside(text, root))) return "temp";
  if (SANDBOX_PATH.test(text)) return "sandbox";
  if (requireGame && !(await check(path.join(text, "GTA5.exe")))) return "no-game";
  return null;
}

/** Настоящая папка Majestic этого человека — та, что лаунчер читает сам (а не из подменённого `APPDATA` тестов). */
function realMajesticFolder() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "majestic-launcher");
}

/** Пишется ли в настоящий prefs Majestic, а не в песочницу стенда или временную копию тестов. */
const majesticIsReal = (env) => !qaLaunchers(env) && samePath(majesticFolder(env), realMajesticFolder());
/** Пишется ли в настоящий реестр RAGE-MP: ни стенда, ни подмены записи. */
const rageIsReal = (tools) => !tools.writeRage && !qaLaunchers();

function blockedError(folder, reason) {
  const error = new Error(`Путь лаунчера не записан: ${folder} (${reason})`);
  error.code = "LAUNCHER_PATH_BLOCKED";
  error.reason = reason;
  return error;
}

async function readPrefs(env) {
  const file = majesticPrefs(env);
  const text = await fs.readFile(file, "utf8");
  const data = JSON.parse(text);
  return { file, text, data: data && typeof data === "object" && !Array.isArray(data) ? data : {} };
}

/** Путь к игре в Majestic: `{ installed, persisted }` (`persisted` — `{ source, path }` или `null`). */
export async function majesticGamePath(env = process.env) {
  if (!(await exists(majesticFolder(env)))) return { installed: false, persisted: null };
  try {
    const { data } = await readPrefs(env);
    const persisted = data.gameInstall?.persisted;
    return {
      installed: true,
      persisted: persisted && typeof persisted === "object" && persisted.path ? { ...persisted } : null,
    };
  } catch {
    return { installed: true, persisted: null };
  }
}

/* Записать путь как лаунчер: остальное — как было, отступы — его же. */
async function writeMajesticPersisted(env, persisted, { requireGame = true, check } = {}) {
  if (persisted?.path && majesticIsReal(env)) {
    const reason = await launcherPathBlock(persisted.path, { requireGame, env, check });
    if (reason) throw blockedError(persisted.path, reason);
  }
  let file = majesticPrefs(env);
  let text = "";
  let data = {};
  try {
    ({ file, text, data } = await readPrefs(env));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const gameInstall = data.gameInstall && typeof data.gameInstall === "object" ? { ...data.gameInstall } : {};
  if (persisted) gameInstall.persisted = persisted;
  else delete gameInstall.persisted;
  const indent = !text || /^\{\r?\n\t/.test(text) ? "\t" : 2;
  const staged = `${file}.astral-${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(staged, `${JSON.stringify({ ...data, gameInstall }, null, indent)}${text.endsWith("\n") ? "\n" : ""}`);
  await fs.rename(staged, file);
}

async function majesticRunning(tools) {
  if (tools.majesticRunning) return tools.majesticRunning();
  if (qaLaunchers()) return false;
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseTasklist(stdout).has(MAJESTIC_LAUNCHER);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ RAGE */

/** Путь к игре в RAGE Multiplayer или `null` (лаунчера нет). */
export async function rageGamePath(tools = {}) {
  if (tools.readRage) return tools.readRage();
  const qa = qaLaunchers();
  if (qa) {
    try {
      return JSON.parse(await fs.readFile(path.join(qa, "rage-mp.json"), "utf8"))[RAGE_VALUE] ?? null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", RAGE_KEY, "/v", RAGE_VALUE], {
      windowsHide: true,
      encoding: "utf8",
    });
    const match = new RegExp(`${RAGE_VALUE}\\s+REG_[A-Z_]+\\s+(.+)`, "i").exec(stdout);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function writeRagePath(tools, value, { requireGame = true } = {}) {
  if (tools.writeRage) return tools.writeRage(value);
  if (rageIsReal(tools)) {
    const reason = await launcherPathBlock(value, { requireGame, check: tools.fileExists });
    if (reason) throw blockedError(value, reason);
  }
  const qa = qaLaunchers();
  if (qa) {
    await fs.writeFile(path.join(qa, "rage-mp.json"), JSON.stringify({ [RAGE_VALUE]: value }, null, 2));
    return true;
  }
  /* `tools.registryWrite` — только для тестов заслона: ловит попытку записи в настоящий реестр, не делая её. */
  const write =
    tools.registryWrite ||
    ((text) =>
      execFileAsync("reg.exe", ["add", RAGE_KEY, "/v", RAGE_VALUE, "/t", "REG_SZ", "/d", text, "/f"], {
        windowsHide: true,
        encoding: "utf8",
      }));
  await write(value);
  return true;
}

/* ------------------------------------------------------------ память */

async function readRecord(stateDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(stateDir, RECORD_FILE), "utf8"));
    return data && typeof data === "object" && data.copies && typeof data.copies === "object" ? data : { version: 1, copies: {} };
  } catch {
    return { version: 1, copies: {} };
  }
}

async function writeRecord(stateDir, record) {
  const file = path.join(stateDir, RECORD_FILE);
  await fs.mkdir(stateDir, { recursive: true });
  const staged = `${file}.${process.pid}.tmp`;
  await fs.writeFile(staged, JSON.stringify({ version: 1, ...record }, null, 2));
  await fs.rename(staged, file);
}

/**
 * Направить лаунчеры серверов на вторую папку. Повторный вызов ничего не
 * меняет; прежний путь каждого лаунчера помнится один раз — первый.
 *
 * @returns {Promise<{ majestic: string, rage: string }>} для каждого:
 *   `switched` | `same` | `absent` | `launcher-open` | `blocked` (заслон) | `failed`
 */
export async function pointLaunchersAt({ copyPath, stateDir, env = process.env, tools = {} }) {
  const record = await readRecord(stateDir);
  const entry = record.copies[recordKey(copyPath)] || { copyPath: path.resolve(copyPath) };
  const result = { majestic: "absent", rage: "absent" };

  const majestic = await majesticGamePath(env);
  if (majestic.installed) {
    if (samePath(majestic.persisted?.path, copyPath)) result.majestic = "same";
    else if (await majesticRunning(tools)) result.majestic = "launcher-open";
    else if (majesticIsReal(env) && (await launcherPathBlock(copyPath, { env, check: tools.fileExists }))) result.majestic = "blocked";
    else {
      const fresh = !entry.majestic;
      try {
        if (fresh) entry.majestic = { before: majestic.persisted, at: new Date().toISOString() };
        await writeMajesticPersisted(env, { source: "custom", path: path.resolve(copyPath) }, { check: tools.fileExists });
        result.majestic = "switched";
      } catch (error) {
        result.majestic = error?.code === "LAUNCHER_PATH_BLOCKED" ? "blocked" : "failed";
        if (result.majestic === "blocked" && fresh) delete entry.majestic;
      }
    }
  }

  const rage = await rageGamePath(tools);
  if (rage !== null) {
    if (samePath(rage, copyPath)) result.rage = "same";
    else if (rageIsReal(tools) && (await launcherPathBlock(copyPath, { env, check: tools.fileExists }))) result.rage = "blocked";
    else {
      const fresh = !entry.rage;
      try {
        if (fresh) entry.rage = { before: rage, at: new Date().toISOString() };
        await writeRagePath(tools, path.resolve(copyPath));
        result.rage = "switched";
      } catch (error) {
        result.rage = error?.code === "LAUNCHER_PATH_BLOCKED" ? "blocked" : "failed";
        if (result.rage === "blocked" && fresh) delete entry.rage;
      }
    }
  }

  if (entry.majestic || entry.rage) {
    record.copies[recordKey(copyPath)] = entry;
    await writeRecord(stateDir, record);
  }
  return result;
}

/**
 * Вернуть лаунчерам прежний путь, когда вторую папку удаляют. Лаунчер,
 * который человек с тех пор направил в другое место, не трогается.
 *
 * @returns {Promise<{ majestic: string, rage: string }>} для каждого:
 *   `restored` | `left` | `absent` | `launcher-open` | `blocked` (заслон) | `failed`
 */
export async function restoreLaunchers({ copyPath, stateDir, env = process.env, tools = {} }) {
  const record = await readRecord(stateDir);
  const key = recordKey(copyPath);
  const entry = record.copies[key];
  const result = { majestic: "absent", rage: "absent" };
  if (!entry) return result;

  if (entry.majestic) {
    const now = await majesticGamePath(env);
    if (!now.installed || !samePath(now.persisted?.path, copyPath)) {
      result.majestic = "left";
      delete entry.majestic;
    } else if (await majesticRunning(tools)) result.majestic = "launcher-open";
    else {
      try {
        await writeMajesticPersisted(env, entry.majestic.before || null, { requireGame: false, check: tools.fileExists });
        result.majestic = "restored";
        delete entry.majestic;
      } catch (error) {
        result.majestic = error?.code === "LAUNCHER_PATH_BLOCKED" ? "blocked" : "failed";
      }
    }
  }

  if (entry.rage) {
    const now = await rageGamePath(tools);
    if (now === null || !samePath(now, copyPath)) {
      result.rage = "left";
      delete entry.rage;
    } else {
      try {
        if (entry.rage.before) await writeRagePath(tools, entry.rage.before, { requireGame: false });
        result.rage = "restored";
        delete entry.rage;
      } catch (error) {
        result.rage = error?.code === "LAUNCHER_PATH_BLOCKED" ? "blocked" : "failed";
      }
    }
  }

  if (entry.majestic || entry.rage) record.copies[key] = entry;
  else delete record.copies[key];
  await writeRecord(stateDir, record);
  return result;
}
