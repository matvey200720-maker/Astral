import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const NAME_SYMBOLS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-";
const TASKLIST = "tasklist.exe";

export function safeProcessName(value) {
  const leaf = path.win32.basename(value ? String(value) : "");
  const looksLikeExe = leaf.length >= 5 && leaf.slice(-4).toLowerCase() === ".exe";
  return looksLikeExe && Array.from(leaf).every((symbol) => NAME_SYMBOLS.includes(symbol)) ? leaf : null;
}

// Строка вывода tasklist: `"Имя","PID",...`; всё, что не начинается с непустого имени в кавычках, пропускается.
const RECORD_LINE = /^"([^"]+)"(?:,"(\d+)")?/;

function tasklistRecords(stdout) {
  const text = stdout ? String(stdout) : "";
  return text.split(/\r?\n/).flatMap((line) => {
    const hit = RECORD_LINE.exec(line);
    return hit ? [{ name: hit[1], pid: hit[2] === undefined ? null : Number(hit[2]) }] : [];
  });
}

export function parseTasklist(stdout) {
  return new Set(tasklistRecords(stdout).map((record) => record.name.toLowerCase()));
}

export function parseTasklistRows(stdout) {
  return tasklistRecords(stdout);
}

export function describeProcess({ name, pid }) {
  return pid ? `${name} (PID ${pid})` : name;
}

const execFileAsync = promisify(execFile);

const askArguments = () => ["/FO", "CSV", "/NH"];
const askOptions = () => ({ windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

// Запасной путь к tasklist; вычисляется лишь после отказа обычного имени.
function fallbackCommand() {
  const systemRoot = process.env.SystemRoot || process.env.windir;
  return systemRoot ? path.win32.join(systemRoot, "System32", TASKLIST) : null;
}

// Сначала обычное имя, затем запасной путь; если отказали оба — остаётся отказ первого.
async function askTasklist(run) {
  const request = [askArguments(), askOptions()];
  const attempt = async (command) => {
    try {
      return { answer: await run(command, ...request) };
    } catch (error) {
      return { error };
    }
  };
  const first = await attempt(TASKLIST);
  if (!("error" in first)) return first.answer;
  const backup = fallbackCommand();
  if (backup === null) throw first.error;
  const second = await attempt(backup);
  if ("error" in second) throw first.error;
  return second.answer;
}

async function tasklistRows(run) {
  const { stdout = "" } = await askTasklist(run);
  return parseTasklistRows(stdout);
}

/*
 * Быстрый список процессов (14.11.2026, работа «Astral быстрее»). `tasklist.exe` — отдельный процесс и 0,7–1 с на
 * каждый вопрос (замер на тестовом ПК), а «не запущена ли игра» спрашивают до семи раз за установку и раз в две
 * секунды, пока она идёт. Резидентный движок отвечает снимком процессов Windows за миллисекунды
 * (`running-processes`); его сюда ставит `native-engine.js`. Нет движка, старая сборка без команды, отказ — тот же
 * вопрос уходит в tasklist, как раньше. Подставной запуск (`options.run` у тестов и стендов) быстрый путь не трогает.
 */
let fastLister = null;

export function setFastProcessLister(lister) {
  fastLister = typeof lister === "function" ? lister : null;
}

/* Одинаковые вопросы к tasklist, заданные разом, получают один ответ: второй процесс рядом ничего не узнает. */
let tasklistInFlight = null;

function sharedTasklistRows() {
  tasklistInFlight ||= tasklistRows(execFileAsync).finally(() => {
    tasklistInFlight = null;
  });
  return tasklistInFlight;
}

const usableRow = (row) => typeof row?.name === "string" && row.name !== "";

/** Строки `{ name, pid }`: по именам (`names`) или все (`null`). */
async function processRows(options, names = null) {
  if (options.run !== undefined) return tasklistRows(options.run);
  if (fastLister) {
    try {
      const rows = await fastLister(names);
      if (Array.isArray(rows) && rows.every(usableRow))
        return rows.map((row) => ({ name: row.name, pid: Number.isInteger(row.pid) ? row.pid : null }));
    } catch {
      /* запасной путь ниже */
    }
  }
  return sharedTasklistRows();
}

export async function runningProcesses(names, options = {}) {
  const wanted = [...new Set(names.map(safeProcessName))].filter((name) => name !== null);
  if (wanted.length === 0) return [];
  const pidByName = new Map();
  for (const row of await processRows(options, wanted)) {
    const key = row.name.toLowerCase();
    if (!pidByName.has(key)) pidByName.set(key, row.pid);
  }
  return wanted.flatMap((name) => {
    const key = name.toLowerCase();
    return pidByName.has(key) ? [{ name, pid: pidByName.get(key) }] : [];
  });
}

export async function runningProcessesMatching(pattern, options = {}) {
  const rows = await processRows(options);
  return rows.filter((row) => pattern.test(row.name));
}

export async function runningProcessNames(names, options) {
  return (await runningProcesses(names, options)).map((entry) => entry.name);
}
