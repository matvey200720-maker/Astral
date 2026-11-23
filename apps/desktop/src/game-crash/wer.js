/*
 * Журнал Windows «Приложение»: падения и зависания процессов игры (ТЗ владельца 11.11.2026).
 *
 *   • 1000 — Application Error: процесс, версия, сбойный модуль, код исключения, смещение, пути;
 *   • 1002 — Application Hang: процесс перестал отвечать;
 *   • 1001 — Windows Error Reporting: то же с именем корзины (APPCRASH, BEX64, AppHangB1) и папкой отчёта.
 *
 * Читается `wevtutil qe Application` без прав администратора: только чтение, без новых зависимостей. Вывод идёт
 * в UTF-16 (`/uni:true`): иначе русские буквы приходят кодовой страницей консоли и портятся. Время событий — UTC.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describeException, normalizeException } from "./exceptions.js";

const execFileAsync = promisify(execFile);

/** Процессы, падение которых журнал считает игровым. */
export const GAME_PROCESS_NAMES = Object.freeze([
  "GTA5.exe",
  "GTA5_Enhanced.exe",
  "GTA5_BE.exe",
  "PlayGTAV.exe",
  "ragemp_v.exe",
  "ragemp_game_ui.exe",
]);

export const GAME_PROCESS_PATTERN = /^(?:gta5(?:_enhanced|_be)?|playgtav|ragemp_v|ragemp_game_ui)\.exe$/i;

const WER_TIMEOUT_MS = 10000;
const WER_MAX_BUFFER = 24 * 1024 * 1024;
const WER_EVENTS_LIMIT = 200;
const PAIR_WINDOW_MS = 60 * 1000;
const HANG_REPORT_LEAD_MS = 15 * 1000;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unescapeXml = (text) => text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]);

/** Строки `Data` события: именованные идут в `named`, по порядку — в `list`. */
function dataOf(eventXml) {
  const named = {};
  const list = [];
  for (const match of eventXml.matchAll(/<Data(?:\s+Name=['"]([^'"]*)['"])?\s*(?:\/>|>([\s\S]*?)<\/Data>)/g)) {
    const value = unescapeXml((match[2] ?? "").trim());
    list.push(value);
    if (match[1]) named[match[1]] = value;
  }
  return { named, list };
}

const attribute = (xml, tag, name) => {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${name}=['"]([^'"]*)['"]`).exec(xml);
  return match ? match[1] : "";
};

const pidOf = (value) => {
  const text = String(value ?? "").trim();
  const parsed = /^0x/i.test(text) ? Number.parseInt(text, 16) : Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Разбор вывода `wevtutil … /f:xml`: текст с событиями подряд → записи (старые и непонятные пропускаются). */
export function parseWerXml(xml) {
  const events = [];
  for (const match of String(xml ?? "").matchAll(/<Event\b[\s\S]*?<\/Event>/g)) {
    const text = match[0];
    const eventId = Number(/<EventID[^>]*>(\d+)<\/EventID>/.exec(text)?.[1]);
    const stamp = Date.parse(attribute(text, "TimeCreated", "SystemTime"));
    if (![1000, 1001, 1002].includes(eventId) || !Number.isFinite(stamp)) continue;
    const { named, list } = dataOf(text);
    events.push({
      eventId,
      t: stamp,
      recordId: Number(/<EventRecordID>(\d+)<\/EventRecordID>/.exec(text)?.[1]) || 0,
      list,
      named,
    });
  }
  return events;
}

const isGameName = (name) => GAME_PROCESS_PATTERN.test(String(name || ""));

const FILETIME_UNIX_EPOCH = 116444736000000000n;
const FILETIME_TICKS_PER_MS = 10000n;
const PLAUSIBLE_FROM = Date.UTC(2000, 0, 1);
const PLAUSIBLE_TO = Date.UTC(2100, 0, 1);

/**
 * FILETIME (сто наносекунд с 1601 года, шестнадцатеричная строка, с `0x` или без) → миллисекунды эпохи Unix. Событие 1000 несёт так «время создания
 * процесса», 1002 — «начало». Не число и год вне 2000…2100 — `null`: чужое поле (в 1002 после начала стоит счётчик, не время) временем не считается.
 */
export function fileTimeMs(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0x)?[0-9a-f]{1,16}$/i.test(text)) return null;
  const ms = Number((BigInt(`0x${text.replace(/^0x/i, "")}`) - FILETIME_UNIX_EPOCH) / FILETIME_TICKS_PER_MS);
  return ms >= PLAUSIBLE_FROM && ms <= PLAUSIBLE_TO ? ms : null;
}

/** 1000: имя, версия, метка, модуль, версия модуля, метка модуля, исключение, смещение, pid, старт, путь, путь модуля, отчёт. */
function fromApplicationError(event) {
  const [name, version, , module, moduleVersion, , exception, offset, pid, started, appPath, modulePath, reportId] = event.list;
  return { kind: "crash", name, version, module, moduleVersion, exception: normalizeException(exception), offset, pid: pidOf(pid), startedAt: fileTimeMs(started), appPath, modulePath, reportId };
}

/** 1002: имя, версия, pid, старт, завершение, путь, отчёт. */
function fromApplicationHang(event) {
  const [name, version, pid, started, , appPath, reportId] = event.list;
  return { kind: "hang", name, version, module: "", moduleVersion: "", exception: "", offset: "", pid: pidOf(pid), startedAt: fileTimeMs(started), appPath, modulePath: "", reportId };
}

/** 1001: корзина и параметры P1..P10; у BEX64 смещение и исключение стоят в обратном порядке. */
function fromReporting(event) {
  const n = event.named;
  const bucket = n.EventName || "";
  const hang = /hang/i.test(bucket);
  const swapped = /^BEX/i.test(bucket);
  return {
    kind: hang ? "hang" : "crash",
    name: n.P1 || "",
    version: n.P2 || "",
    module: hang ? "" : n.P4 || "",
    moduleVersion: hang ? "" : n.P5 || "",
    exception: hang ? "" : normalizeException(swapped ? n.P8 : n.P7),
    offset: hang ? "" : (swapped ? n.P7 : n.P8) || "",
    pid: null,
    appPath: "",
    modulePath: "",
    reportId: "",
    bucket,
    storePath: n.StorePath || "",
  };
}

const READERS = new Map([
  [1000, fromApplicationError],
  [1002, fromApplicationHang],
  [1001, fromReporting],
]);

/**
 * События → падения. Событие отчёта (1001) приходит через 2–5 секунд после 1000/1002 и описывает то же падение: оно
 * дополняет основное запись именем корзины и папкой отчёта и отдельным падением не считается. Если 1000/1002 уже
 * вытеснены из журнала, а 1001 остался, падение строится по нему.
 */
export function werCrashes(events) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const crashes = [];
  const reports = [];
  for (const event of sorted) {
    const read = READERS.get(event.eventId);
    if (!read) continue;
    const fields = read(event);
    if (!isGameName(fields.name)) continue;
    const entry = { ...fields, t: event.t, eventId: event.eventId, recordId: event.recordId };
    (event.eventId === 1001 ? reports : crashes).push(entry);
  }
  for (const report of reports) {
    /* Отчёт о зависании (AppHangB1) Windows пишет на несколько секунд РАНЬШЕ события 1002, о падении — позже. */
    const before = report.kind === "hang" ? HANG_REPORT_LEAD_MS : 2000;
    const match = crashes.find((crash) => crash.kind === report.kind && sameName(crash.name, report.name) && report.t - crash.t >= -before && report.t - crash.t <= PAIR_WINDOW_MS && !crash.bucket);
    if (match) {
      match.bucket = report.bucket;
      match.storePath = report.storePath;
    } else crashes.push({ ...report });
  }
  return crashes.sort((a, b) => b.t - a.t).map(withReading);
}

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Читаемое описание исключения и «чужой ли модуль» — по пути, без Windows. */
function withReading(crash) {
  const reading = crash.kind === "hang" ? { code: "hang", text: "процесс перестал отвечать и был закрыт (зависание)", hex: "" } : describeException(crash.exception);
  return { ...crash, reading, moduleIsSystem: isSystemModule(crash.modulePath || crash.module) };
}

const SYSTEM_PATH = /^(?:[a-z]:)?[\\/]+(?:windows|program files|program files \(x86\))[\\/]/i;
/** Модуль из папки Windows или Program Files: виноват не мод, а система или драйвер. */
export function isSystemModule(modulePath) {
  const value = String(modulePath || "");
  if (!value) return false;
  if (SYSTEM_PATH.test(value)) return true;
  return /^(?:ntdll|kernel32|kernelbase|ucrtbase|msvcp\d*|vcruntime\d*|d3d\d*|dxgi|nvwgf2umx|nvlddmkm|atidxx64|amdxx64|win32u|user32|gdi32)\.(?:dll|sys)$/i.test(path.win32.basename(value));
}

/** Запрос для `wevtutil`: события 1000/1001/1002 с именами процессов игры за последние `ms` миллисекунд. */
export function werQuery({ sinceMs, names = GAME_PROCESS_NAMES } = {}) {
  const horizon = Math.max(1000, Math.ceil(sinceMs));
  const named = names.map((name) => `Data='${String(name).replace(/'/g, "")}'`).join(" or ");
  return `*[System[(EventID=1000 or EventID=1001 or EventID=1002) and TimeCreated[timediff(@SystemTime) <= ${horizon}]]] and *[EventData[${named}]]`;
}

function decodeOutput(buffer) {
  if (typeof buffer === "string") return buffer;
  if (!buffer || buffer.length === 0) return "";
  /* /uni:true даёт UTF-16 LE с меткой FF FE; без метки — считаем, что UTF-8. */
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 4 && buffer[1] === 0 && buffer[3] === 0) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

/**
 * Падения процессов игры за последние `sinceMs`. Ошибка запуска `wevtutil` — пустой ответ с причиной: журнал падений не
 * должен ронять лаунчер. `run` подменяется в тестах.
 */
export async function readWerCrashes({ sinceMs, now = Date.now, run = execFileAsync, platform = process.platform, names } = {}) {
  if (platform !== "win32") return { crashes: [], error: "" };
  try {
    const { stdout } = await run("wevtutil.exe", ["qe", "Application", `/q:${werQuery({ sinceMs, names })}`, "/f:xml", "/rd:true", `/c:${WER_EVENTS_LIMIT}`, "/uni:true"], {
      windowsHide: true,
      encoding: "buffer",
      maxBuffer: WER_MAX_BUFFER,
      timeout: WER_TIMEOUT_MS,
    });
    return { crashes: werCrashes(parseWerXml(decodeOutput(stdout))), error: "", at: now() };
  } catch (error) {
    /* Код 15007 («не найдено событий») wevtutil отдаёт ошибкой: это пустой ответ, а не сбой. */
    const text = String(error?.stderr || error?.message || error);
    if (error?.code === 15007 || /15007|No events were found/i.test(text)) return { crashes: [], error: "" };
    return { crashes: [], error: text.split(/\r?\n/)[0].slice(0, 200) };
  }
}
