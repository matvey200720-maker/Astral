/*
 * Что за процесс игры мешает установке (26.11.2026, журнал игрока 1.0.10). Установку держит имя процесса (`install-safety.js`):
 * по пути искать нельзя — на RAGE MP игра запускается из `…\RageMP\GTA5.exe`, а держит файлы обычной папки игры. Здесь —
 * сведения о найденном: путь, есть ли окно, отвечает ли оно и давно ли запущен. По ним строка в журнал и одна кнопка
 * «Закрыть зависшую GTA V»: сам Astral игру не закрывает никогда.
 *
 * Модуль грузится по вызову: `install-safety.js` стоит в графе старта главного процесса (`tests/main-startup-imports.test.js`).
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { appLog } from "./app-log.js";
import { runningProcessesMatching } from "./game-processes.js";

/* Закрыть можно только саму игру. Заглушку BattlEye (`GTA5_BE.exe`) Astral не трогает: пока она жива, античит может держать файлы. */
const CLOSABLE = /^gta5(?:_enhanced)?\.exe$/i;
/* Игра только что запущенная может минуту-другую не иметь окна и не отвечать на загрузке: такую зависшей не называем. */
export const HUNG_MIN_AGE_MS = 3 * 60_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_PIDS = 16;
const MAX_REMEMBERED = 200;

const execFileAsync = promisify(execFile);

/* Номера — переменной окружения; ответ — по строке JSON на процесс. Нет доступа (игра от администратора) — поле пустое. */
const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
foreach ($id in ($env:ASTRAL_GAME_PIDS -split ',')) {
  $p = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  $path = $null; try { $path = $p.Path } catch {}
  $started = $null; try { $started = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() } catch {}
  $window = $null; try { $window = [bool]($p.MainWindowHandle -ne [IntPtr]::Zero) } catch {}
  $responding = $null; try { $responding = [bool]$p.Responding } catch {}
  ConvertTo-Json -Compress -InputObject ([ordered]@{ pid = $p.Id; name = ($p.ProcessName + '.exe'); path = $path; window = $window; responding = $responding; startedAt = $started })
}
# Номер, которого уже нет, не ошибка: без этого powershell выходит с кодом 1 и пропадают сведения обо всех (проверено на этом ПК).
exit 0
`;

const flag = (value) => (typeof value === "boolean" ? value : null);

export function parseProcessFacts(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .flatMap((line) => {
      let row = null;
      try {
        row = JSON.parse(line.trim());
      } catch {
        return [];
      }
      if (!Number.isInteger(row?.pid) || typeof row.name !== "string")
        return [];
      return [
        {
          pid: row.pid,
          name: row.name,
          path: typeof row.path === "string" && row.path ? row.path : null,
          window: flag(row.window),
          responding: flag(row.responding),
          startedAt: Number.isFinite(row.startedAt) ? row.startedAt : null,
        },
      ];
    });
}

const wholePids = (pids) =>
  [...new Set((pids || []).map(Number))]
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .slice(0, MAX_PIDS);

export async function readProcessFacts(
  pids,
  { run = execFileAsync, platform = process.platform, env = process.env } = {},
) {
  const wanted = wholePids(pids);
  if (platform !== "win32" || !wanted.length) return [];
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
    {
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      encoding: "utf8",
      env: { ...env, ASTRAL_GAME_PIDS: wanted.join(",") },
    },
  );
  return parseProcessFacts(stdout);
}

/*
 * Зависшая — только когда всё сказано точно: это сама игра, путь читается (значит окна и ответ видны честно, а не закрыты
 * правами администратора), запущена не только что, и у неё нет окна или окно не отвечает. Неизвестное — не «зависла».
 */
export function looksHung(fact, now = Date.now()) {
  if (!fact || !CLOSABLE.test(String(fact.name)) || !fact.path) return false;
  if (
    !Number.isFinite(fact.startedAt) ||
    now - fact.startedAt < HUNG_MIN_AGE_MS
  )
    return false;
  if (fact.window === false) return true;
  return fact.window === true && fact.responding === false;
}

function ageWords(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return minutes < 60
    ? `${minutes} мин`
    : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/** Строка журнала о процессе. `fact` нет — Windows сведений не отдала, строка это и говорит. */
export function describeFact(row, fact, now = Date.now()) {
  const head = `${row.name} (PID ${row.pid})`;
  if (!fact) return `${head}: путь и состояние окна Windows не отдала`;
  const place = fact.path
    ? `путь ${fact.path}`
    : "путь не читается (вероятно, запущен от администратора)";
  const parts = [place];
  if (fact.window === false) parts.push("окна нет");
  else if (fact.window === true)
    parts.push(
      fact.responding === false ? "окно не отвечает" : "окно есть и отвечает",
    );
  if (Number.isFinite(fact.startedAt))
    parts.push(`запущен ${ageWords(now - fact.startedAt)} назад`);
  if (looksHung(fact, now)) parts.push("похоже, завис");
  return `${head}: ${parts.join("; ")}`;
}

const remembered = new Set();

/** Один раз на процесс: путь и состояние найденной игры — в журнал. Отказ установки уже сказан, здесь ничего не бросается наружу. */
export async function noteBlockingProcesses(
  running,
  {
    read = readProcessFacts,
    record = (entry) => appLog.record(entry),
    now = Date.now,
    seen = remembered,
  } = {},
) {
  const fresh = (running || []).filter(
    (row) => Number.isInteger(row?.pid) && !seen.has(`${row.name}:${row.pid}`),
  );
  if (!fresh.length) return;
  if (seen.size > MAX_REMEMBERED) seen.clear();
  for (const row of fresh) seen.add(`${row.name}:${row.pid}`);
  let facts = [];
  try {
    facts = await read(fresh.map((row) => row.pid));
  } catch {
    /* PowerShell закрыт политикой или антивирусом — строка выйдет без сведений. */
  }
  for (const row of fresh) {
    const fact = facts.find((item) => item.pid === row.pid);
    record({
      level: "warn",
      source: "install",
      message: `Игра мешает менять файлы: ${describeFact(row, fact, now())}`,
    });
  }
}

const listGames = () => runningProcessesMatching(CLOSABLE);

/** Зависшие игры сейчас: `[{ pid, name, path }]`. Не смогли спросить — пусто: кнопки просто нет. */
export async function listHungGames({
  list = listGames,
  read = readProcessFacts,
  now = Date.now,
} = {}) {
  try {
    const pids = (await list()).map((row) => row.pid).filter(Number.isInteger);
    if (!pids.length) return [];
    const at = now();
    return (await read(pids))
      .filter((fact) => looksHung(fact, at))
      .map(({ pid, name, path: file }) => ({ pid, name, path: file }));
  } catch {
    return [];
  }
}

const taskkill = () => {
  const root = process.env.SystemRoot || process.env.windir;
  return root
    ? path.win32.join(root, "System32", "taskkill.exe")
    : "taskkill.exe";
};
const forceClose = (pid) =>
  execFileAsync(taskkill(), ["/F", "/PID", String(pid)], { windowsHide: true });

/**
 * Закрыть зависшую игру — только по нажатию человека с подтверждением (окно). Перед закрытием всё проверяется заново: номер
 * мог достаться другому процессу, а игра — ожить. Ответ `{ closed }` или `{ closed: false, reason: "gone" | "responding" | "denied" }`.
 */
export async function closeHungGame(
  pid,
  {
    read = readProcessFacts,
    kill = forceClose,
    record = (entry) => appLog.record(entry),
    now = Date.now,
  } = {},
) {
  const [wanted] = wholePids([pid]);
  if (!wanted) return { closed: false, reason: "gone" };
  let fact = null;
  try {
    [fact = null] = await read([wanted]);
  } catch {
    return { closed: false, reason: "denied" };
  }
  if (!fact || fact.pid !== wanted || !CLOSABLE.test(fact.name))
    return { closed: false, reason: "gone" };
  const at = now();
  const words = describeFact(fact, fact, at);
  if (!looksHung(fact, at)) {
    record({
      level: "info",
      source: "install",
      message: `Закрытие игры отменено, она не похожа на зависшую: ${words}`,
    });
    return { closed: false, reason: "responding" };
  }
  try {
    await kill(wanted);
  } catch (error) {
    record({
      level: "warn",
      source: "install",
      message: `Закрыть зависшую игру не вышло (${String(
        error?.message || error,
      )
        .split(/\r?\n/)[0]
        .slice(0, 160)}): ${words}`,
    });
    return { closed: false, reason: "denied" };
  }
  record({
    level: "warn",
    source: "install",
    message: `Зависшая игра закрыта по нажатию человека: ${words}`,
  });
  return { closed: true };
}
