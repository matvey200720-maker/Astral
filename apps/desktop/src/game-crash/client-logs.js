/*
 * Журналы клиентов игры: Majestic, RAGE MP (GTA5RP), одиночная GTA V (ТЗ владельца 11.11.2026). Только чтение,
 * только хвост файла, без запуска клиентов.
 *
 *   Majestic    %APPDATA%\majestic-launcher\Multiplayer\logs\client_ГГГГ-ММ-ДД_чч-мм-сс.log — по файлу на запуск игры.
 *               Строки `[чч:мм:сс.ммм][Уровень][раздел] текст`; перед падением — `[Error][hooks] Invalid asset X.ydr`
 *               (сколько раз подряд) и `[Critical] abort() called — draining log queue` (проверено 11.11.2026 по
 *               падениям 01.11 и 07.11 на этом ПК: время последней строки совпадает с событием 1000 до секунды).
 *   RAGE MP     не установлен на машине разработки: папка и имена журналов — по умолчанию C:\RAGEMP (и любой диск), файлы
 *               *.log и *.txt в корне, logs\ и clientdata\; признак падения — слова crash/fatal/exception в хвосте.
 *               НЕ ПРОВЕРЕНО на живом клиенте — см. REPORT-crashlog-1111.md.
 *   GTA V       ScriptHookV.log, ScriptHookVDotNet.log, asiloader.log, dinput8.log, RagePluginHook.log в папке игры и
 *               список .asi — чужие модули, которые могли уронить игру.
 */
import fs from "node:fs";
import path from "node:path";
import { scrubLine } from "./scrub.js";

export const TAIL_BYTES = 96 * 1024;
const MAX_LOG_FILES = 12;
const EVIDENCE_LINES = 12;
const ASSET_NAMES_LIMIT = 8;

export const MAJESTIC_CLIENT_LOG = /^client_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.log$/;
const LOG_LINE = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]((?:\[[^\]]*\])*)\s?(.*)$/;
const LEVELS = new Set(["trace", "debug", "info", "log", "notice", "warning", "warn", "error", "critical", "fatal"]);
/* Аварийный выход без строки Critical: клиент пытается записать дамп (11.11.2026: падение c000001d 31.10 на этом ПК). */
const HARD_CRASH = /MINIDUMP|MiniDumpWriteDump/i;
const INVALID_ASSET = /Invalid asset\s+([^\s"'<>|\\/]+\.[A-Za-z0-9]{2,5})/i;
const OUT_OF_MEMORY = /out of memory|bad_alloc|not enough (?:memory|quota)|insufficient memory|VirtualAlloc failed|memory allocation failed/i;
const FATAL_LEVELS = new Set(["critical", "fatal"]);

/** Хвост файла строкой (последние `bytes` байт); нет файла — пусто. */
export async function tailText(file, { bytes = TAIL_BYTES, fsImpl = fs.promises } = {}) {
  let handle;
  try {
    handle = await fsImpl.open(file, "r");
    const { size } = await handle.stat();
    const count = Math.min(bytes, size);
    const target = Buffer.alloc(count);
    if (count > 0) await handle.read(target, 0, count, size - count);
    return target.toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return "";
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

const localDate = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();

/** Время строки без даты: ближайший к `mtimeMs` момент с такими часами, не позже mtime (+2 мин на расхождение часов). */
export function lineTime(parts, mtimeMs) {
  const [h, mi, s, ms] = parts;
  const anchor = new Date(mtimeMs);
  let candidate = localDate(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate(), h, mi, s, ms);
  if (candidate > mtimeMs + 120 * 1000) candidate -= 24 * 3600 * 1000;
  return candidate;
}

/** Строки хвоста → записи `{ time, level, area, text }`; строки без метки (продолжение) приклеиваются к предыдущей. */
export function parseClientLines(text) {
  const rows = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw) continue;
    const match = LOG_LINE.exec(raw);
    if (match) {
      /* После времени идут скобки: `[Уровень][раздел]`, `[раздел]` или `[Уровень]`; уровень — слово из известного набора. */
      const brackets = [...match[5].matchAll(/\[([^\]]*)\]/g)].map((item) => item[1]);
      const level = brackets.length && LEVELS.has(brackets[0].toLowerCase()) ? brackets.shift() : "";
      rows.push({ clock: [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])], level, area: brackets[0] || "", text: match[6] });
    } else if (rows.length) rows.at(-1).text += ` ${raw.trim()}`;
  }
  return rows;
}

/** Подряд идущие одинаковые строки сворачиваются в одну с числом повторов. */
function collapse(rows) {
  const out = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last && last.level === row.level && last.area === row.area && last.text === row.text) last.count += 1;
    else out.push({ ...row, count: 1 });
  }
  return out;
}

const render = (row) => `[${[row.level, row.area].filter(Boolean).join("/")}] ${row.text}${row.count > 1 ? ` ×${row.count}` : ""}`;

/** Строки, которые клиент пишет уже после самого падения: сброс очереди журнала и попытка дампа. */
const AFTER_CRASH = /draining log queue|MINIDUMP|MiniDumpWriteDump/i;
/** Последняя запись файла и строка падения не дальше этого друг от друга: падение — конец сессии, а не событие посреди неё. */
export const FINAL_WRITE_MS = 120 * 1000;

const isFatal = (row) => FATAL_LEVELS.has(row.level.toLowerCase()) || HARD_CRASH.test(row.text);

/**
 * Разбор хвоста журнала клиента Majestic. `crashed` — строка уровня Critical/Fatal (или попытка дампа) стоит В КОНЦЕ
 * сессии: после неё нет обычных строк, а её время совпадает с последней записью файла (не дальше двух минут от
 * изменения файла). Critical посреди работающей сессии или перед штатным «Disconnected / Shutting down» падением не
 * считается (замечание приёмки 11.11.2026: фантомные падения при штатном выходе). Возвращает время падения, названия
 * сломанных ассетов (с числом повторов), признак нехватки памяти и последние строки (свёрнутые, вычищенные).
 */
export function parseMajesticTail(text, { mtimeMs = Date.now() } = {}) {
  const rows = parseClientLines(text);
  const collapsed = collapse(rows);
  const last = rows.findLastIndex(isFatal);
  const fatal = last >= 0 ? rows[last] : null;
  const closes = fatal ? rows.slice(last + 1).every((row) => isFatal(row) || AFTER_CRASH.test(row.text)) : false;
  const at = fatal ? lineTime(fatal.clock, mtimeMs) : mtimeMs;
  const final = Boolean(fatal) && closes && mtimeMs - at <= FINAL_WRITE_MS;
  const assets = new Map();
  let outOfMemory = false;
  for (const row of rows) {
    const asset = INVALID_ASSET.exec(row.text);
    if (asset) assets.set(asset[1], (assets.get(asset[1]) || 0) + 1);
    if (OUT_OF_MEMORY.test(row.text)) outOfMemory = true;
  }
  const lastLines = collapsed.slice(-EVIDENCE_LINES).map((row) => scrubLine(render(row)));
  return {
    crashed: final,
    t: final ? at : mtimeMs,
    fatalText: final ? scrubLine(fatal.text) : "",
    assets: [...assets].slice(0, ASSET_NAMES_LIMIT).map(([name, count]) => ({ name, count })),
    outOfMemory,
    lastLines,
  };
}

/** Папка журналов клиента Majestic. */
export function majesticLogDir(env = process.env) {
  const base = env.APPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, "AppData", "Roaming") : "");
  return base ? path.join(base, "majestic-launcher", "Multiplayer", "logs") : "";
}

/** Журналы клиента Majestic, менявшиеся с момента `sinceMs`, свежие первыми. */
export async function listMajesticClientLogs({ env = process.env, sinceMs = 0, fsImpl = fs.promises } = {}) {
  const dir = majesticLogDir(env);
  if (!dir) return [];
  let names = [];
  try {
    names = await fsImpl.readdir(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const match = MAJESTIC_CLIENT_LOG.exec(name);
    if (!match) continue;
    const file = path.join(dir, name);
    try {
      const info = await fsImpl.stat(file);
      if (info.mtimeMs < sinceMs) continue;
      found.push({ file, name, startedAt: localDate(...match.slice(1, 7).map(Number)), mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      // файл исчез между чтением папки и размером — пропускаем
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_LOG_FILES);
}

/** Падения по журналам Majestic: один журнал — не больше одного падения (клиент после Critical выходит). */
export async function readMajesticCrashes({ env = process.env, sinceMs = 0, fsImpl = fs.promises } = {}) {
  const found = [];
  for (const log of await listMajesticClientLogs({ env, sinceMs, fsImpl })) {
    const tail = parseMajesticTail(await tailText(log.file, { fsImpl }).catch(() => ""), { mtimeMs: log.mtimeMs });
    found.push({ source: "majestic-client", file: log.name, mtimeMs: log.mtimeMs, startedAt: log.startedAt, ...tail });
  }
  return found;
}

// ---------------------------------------------------------------- RAGE MP (GTA5RP)

const RAGE_FOLDERS = ["", "logs", "clientdata", path.join("clientdata", "logs")];
const RAGE_LOG_FILE = /\.(?:log|txt)$/i;
const RAGE_CRASH_WORDS = /\b(?:crash(?:ed|es)?|fatal|unhandled exception|access violation|assertion failed|stack overflow|abort(?:\(\))? called|out of memory)\b/i;
const DRIVE_LETTERS = "CDEFGH";
/** Проверка существования папки не дольше этого: сетевой или отключённый диск ждёт десятки секунд. */
export const STAT_TIMEOUT_MS = 2000;
/* Метка времени в начале строки: «[2026-11-09 19:29:59]», «2026-11-09T19:29:59», «[19:29:59.123]». Строка без метки в счёт не идёт. */
const RAGE_STAMP = /^\[?(?:(\d{4})-(\d{2})-(\d{2})[ T])?(\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?\]?/;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      timer.unref?.();
    }),
  ]);

/** Время строки журнала RAGE MP (по местному времени) или `NaN`, если метки нет. Без даты — дата изменения файла. */
export function rageLineTime(line, mtimeMs) {
  const match = RAGE_STAMP.exec(String(line || "").trimStart());
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s] = match;
  if (y) return localDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
  return lineTime([Number(h), Number(mi), Number(s), 0], mtimeMs);
}

/**
 * Возможные корни RAGE MP: переменная ASTRAL_RAGEMP_DIR, C:\RAGEMP…H:\RAGEMP, C:\Games\GTA5RP\RageMP…H:\Games\GTA5RP\RageMP (сюда ставит свой клиент
 * лаунчер GTA 5 RP: у тестера 17.11.2026 корень был такой, а выгрузка «Журнал RAGE MP» — пуста, потому что искалась только `C:\RAGEMP`), профиль,
 * а также корни, названные в событиях Windows. Папки проверяются параллельно и не дольше `statTimeoutMs` каждая: отключённый сетевой диск не
 * задерживает проверку.
 */
export async function rageMpRoots({ env = process.env, fsImpl = fs.promises, hints = [], statTimeoutMs = STAT_TIMEOUT_MS } = {}) {
  const guesses = [
    env.ASTRAL_RAGEMP_DIR,
    ...[...DRIVE_LETTERS].map((letter) => `${letter}:\\RAGEMP`),
    ...[...DRIVE_LETTERS].map((letter) => `${letter}:\\Games\\GTA5RP\\RageMP`),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "RAGEMP") : "",
    env.APPDATA ? path.join(env.APPDATA, "RAGEMP") : "",
    ...hints,
  ].filter(Boolean);
  const checks = [...new Set(guesses)].map(async (guess) => {
    try {
      return (await withTimeout(Promise.resolve(fsImpl.stat(guess)), statTimeoutMs)).isDirectory() ? guess : "";
    } catch {
      return "";
    }
  });
  return (await Promise.all(checks)).filter(Boolean);
}

/** Корень RAGE MP по пути из события Windows (…\RAGEMP\ragemp_v.exe → …\RAGEMP). */
export function rageMpRootFromPath(value) {
  const match = /^(.*?[\\/]ragemp)(?:[\\/]|$)/i.exec(String(value || ""));
  return match ? match[1] : "";
}

/**
 * Журналы RAGE MP со строками о падении, у которых ЕСТЬ время (формат НЕ проверен на живом клиенте). `hits` — строки с
 * временем, `crashed` — есть хоть одна. Без метки времени строка и файл о падении ничего не говорят (замечание приёмки
 * 11.11.2026: слово «fatal» в любом журнале за неделю не должно делать из одиночной GTA V «падение GTA 5 RP»).
 */
export async function readRageMpCrashes({ roots, sinceMs = 0, fsImpl = fs.promises, env = process.env } = {}) {
  const list = roots || (await rageMpRoots({ env, fsImpl }));
  const found = [];
  for (const root of list) {
    for (const sub of RAGE_FOLDERS) {
      const dir = path.join(root, sub);
      let names = [];
      try {
        names = await fsImpl.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names.filter((item) => RAGE_LOG_FILE.test(item)).slice(0, 60)) {
        const file = path.join(dir, name);
        try {
          const info = await fsImpl.stat(file);
          if (!info.isFile() || info.mtimeMs < sinceMs) continue;
          const text = await tailText(file, { bytes: 48 * 1024, fsImpl });
          const lines = String(text).split(/\r?\n/).filter(Boolean);
          const rows = collapse(lines.map((raw) => ({ level: "", area: "", text: raw })));
          const hits = lines
            .filter((line) => RAGE_CRASH_WORDS.test(line))
            .map((line) => ({ t: rageLineTime(line, info.mtimeMs), line }))
            .filter((hit) => Number.isFinite(hit.t));
          found.push({
            source: "ragemp-log",
            file: path.join(sub, name),
            mtimeMs: info.mtimeMs,
            crashed: hits.length > 0,
            hits: hits.slice(-6).map((hit) => ({ t: hit.t, line: scrubLine(hit.line) })),
            hitLines: hits.slice(-4).map((hit) => scrubLine(hit.line)),
            lastLines: rows.slice(-EVIDENCE_LINES).map((row) => scrubLine(row.text)),
          });
        } catch {
          // файл занят или исчез
        }
      }
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_LOG_FILES);
}

// ---------------------------------------------------------------- одиночная игра

export const SINGLE_PLAYER_LOGS = Object.freeze(["ScriptHookV.log", "ScriptHookVDotNet.log", "asiloader.log", "dinput8.log", "RagePluginHook.log"]);
const PLUGIN_FILE = /\.asi$/i;

/** Журналы модулей в папке игры и список .asi (имена, без путей). `gameRoots` — папки GTA V. */
export async function readSinglePlayerHints({ gameRoots = [], fsImpl = fs.promises } = {}) {
  const logs = [];
  const plugins = new Set();
  for (const root of gameRoots.filter(Boolean)) {
    for (const name of SINGLE_PLAYER_LOGS) {
      const file = path.join(root, name);
      try {
        const info = await fsImpl.stat(file);
        const text = await tailText(file, { bytes: 24 * 1024, fsImpl });
        const rows = collapse(String(text).split(/\r?\n/).filter(Boolean).map((raw) => ({ level: "", area: "", text: raw })));
        logs.push({ source: "gta-plugin-log", file: name, mtimeMs: info.mtimeMs, lastLines: rows.slice(-8).map((row) => scrubLine(row.text)) });
      } catch {
        // журнала нет — модуль не установлен
      }
    }
    try {
      for (const name of await fsImpl.readdir(root)) if (PLUGIN_FILE.test(name)) plugins.add(name);
    } catch {
      // папка недоступна
    }
  }
  return { logs, plugins: [...plugins].sort().slice(0, 40) };
}

// ---------------------------------------------------------------- для выгрузки журнала (app-log-sources.js)

/** Самый свежий журнал клиента Majestic — хвост уходит в выгрузку для тикета. */
export async function newestMajesticClientLog({ env = process.env, fsImpl = fs.promises } = {}) {
  const [newest] = await listMajesticClientLogs({ env, fsImpl });
  return newest ? newest.file : "";
}

/** Самый свежий журнал RAGE MP из известных папок (формат не проверен на живом клиенте). */
export async function newestRageMpLog({ env = process.env, fsImpl = fs.promises } = {}) {
  const found = await readRageMpCrashes({ env, fsImpl });
  const [newest] = found;
  if (!newest) return "";
  const roots = await rageMpRoots({ env, fsImpl });
  for (const root of roots) {
    const candidate = path.join(root, newest.file);
    try {
      await fsImpl.stat(candidate);
      return candidate;
    } catch {
      // файл в другой папке
    }
  }
  return "";
}

// ---------------------------------------------------------------- быстрый выход одиночной игры (14.11.2026)

const STUB_STAMP = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\]/;
const stubTime = (line) => {
  const found = STUB_STAMP.exec(line);
  return found ? new Date(+found[1], +found[2] - 1, +found[3], +found[4], +found[5], +found[6]).getTime() : null;
};

/** Предел «быстрого» выхода: игра, закрывшаяся раньше, до меню толком не дошла. */
export const QUICK_EXIT_MS = 3 * 60 * 1000;

/**
 * Запуски игры через Rockstar Launcher (`stub.log`, строки «Launching…» и «Application exited with code N»), закрывшиеся быстро и без аварии: Windows о таких не пишет
 * (код 0 — не падение), а выглядят они как собственное окно ошибки игры (ERR_…) или закрытие человеком. Тестер beta.103 14.11 (66 с, код 0, отчёта нет) — образец.
 * @returns {Promise<{ t: number, startedAt: number, seconds: number, code: number }[]>} новые сверху (`t` — выход, `startedAt` — запуск); пусто, если файла нет
 */
export async function readQuickGameExits({ env = process.env, sinceMs = 0, fsImpl = fs.promises } = {}) {
  const file = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Rockstar Games", "Launcher", "stub.log") : "";
  if (!file) return [];
  let text = "";
  try {
    text = await tailText(file, { bytes: 64 * 1024, fsImpl });
  } catch {
    return [];
  }
  const found = [];
  let started = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/\] Launching\.\.\./.test(line)) started = stubTime(line);
    const exit = /\] Application exited with code (-?\d+)/.exec(line);
    if (!exit || started === null) continue;
    const ended = stubTime(line);
    if (ended !== null && ended - started <= QUICK_EXIT_MS && ended >= sinceMs && Number(exit[1]) === 0) found.push({ t: ended, startedAt: started, seconds: Math.round((ended - started) / 1000), code: 0 });
    started = null;
  }
  return found.sort((a, b) => b.t - a.t);
}

// ---------------------------------------------------------------- собственные отчёты GTA V о фатальной ошибке (17.11.2026)

/** Файлов в списке: за неделю их бывает много, нужны только свежие. */
export const GAME_CRASH_LOGS_LIMIT = 30;
const GAME_CRASH_LOGS_NAMES = 2000;

/** Папка, куда игра пишет дамп своей фатальной ошибки (`ERR_…`: «Игровые данные повреждены» и подобные) — `%LOCALAPPDATA%\Rockstar Games\GTAV\CrashLogs`. */
export const gameCrashLogsDir = (env = process.env) => (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Rockstar Games", "GTAV", "CrashLogs") : "");

/**
 * Файлы папки CrashLogs игры, менявшиеся с момента `sinceMs`, свежие первыми: имя, размер, время. Содержимое НЕ читается (дамп тяжёлый — сотни мегабайт, а
 * разбирать его надо в потоке, не здесь): список говорит поддержке, писала ли игра дамп к этому падению и что просить у человека. Нет папки — пусто.
 */
export async function readGameCrashLogs({ env = process.env, sinceMs = 0, fsImpl = fs.promises } = {}) {
  const dir = gameCrashLogsDir(env);
  if (!dir) return [];
  let names = [];
  try {
    names = await fsImpl.readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
  const found = [];
  for (const name of names.slice(0, GAME_CRASH_LOGS_NAMES)) {
    try {
      const info = await fsImpl.stat(path.join(dir, name));
      if (info.isFile() && info.mtimeMs >= sinceMs) found.push({ name, size: info.size, mtimeMs: info.mtimeMs });
    } catch {
      // файл исчез между чтением папки и размером — пропускаем
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, GAME_CRASH_LOGS_LIMIT);
}
