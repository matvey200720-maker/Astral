/*
 * Проверка «упала ли игра» (ТЗ владельца 11.11.2026): собирает улики из журнала Windows и журналов клиентов, склеивает
 * по времени в падения, определяет место и причину, ищет виновный мод Astral и возвращает готовые записи.
 *
 * Читает только чужие журналы и файл состояния движка; ничего не запускает и не пишет в папку игры. Каждый источник
 * независим: сбой одного (нет `wevtutil`, нет папки Majestic) не отменяет остальные, причина уходит в `problems`.
 */
import { buildReason, classifyWhere, isRageLauncherAbort, rageMpRootOf } from "./classify.js";
import { rageMpRoots, readGameCrashLogs, readMajesticCrashes, readQuickGameExits, readRageMpCrashes, readSinglePlayerHints } from "./client-logs.js";
import { scrubLine } from "./scrub.js";
import { readInstallIndex, resolveSuspects, wantedFiles } from "./suspects.js";
import { readWerCrashes } from "./wer.js";

/** Журнал клиента и событие Windows об одном падении различаются по времени на секунды; берём с запасом. */
export const ATTACH_MS = 2 * 60 * 1000;
const HINT_ATTACH_MS = 5 * 60 * 1000;
const EVIDENCE_LOG_LINES = 12;

/** Файл CrashLogs игры считается «рядом» с падением, если лёг не раньше чем за 10 минут до него и не позже чем через 3 после (дамп пишется в миг падения). */
export const CRASH_LOGS_BEFORE_MS = 10 * 60 * 1000;
export const CRASH_LOGS_AFTER_MS = 3 * 60 * 1000;
/** Процесс, проработавший дольше месяца без перезапуска, — не «время до падения», а ошибка поля: строки о времени работы нет. */
const UPTIME_LIMIT_MS = 30 * 24 * 3600 * 1000;
const CRASH_LOGS_LISTED = 6;

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const clock = (ms) => `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}Z`;
export const sizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const logsBetween = (files, from, to) => files.filter((file) => file.mtimeMs >= from && file.mtimeMs <= to);

/** Сколько секунд процесс прожил до события Windows, или `null`: время запуска не прочитано, позже падения или неправдоподобно давнее. */
const uptimeOf = (wer) => {
  if (!wer || !Number.isFinite(wer.startedAt) || wer.startedAt > wer.t || wer.t - wer.startedAt > UPTIME_LIMIT_MS) return null;
  return Math.round((wer.t - wer.startedAt) / 1000);
};
const nearest = (list, t, within) => {
  let best = null;
  for (const item of list) {
    const gap = Math.abs(item.mtimeMs - t);
    if (gap <= within && (!best || gap < best.gap)) best = { item, gap };
  }
  return best?.item || null;
};

/**
 * Склейка источников → падения. Без побочных действий и без чтения диска (всё прочитано заранее): так её проверяют
 * тесты на фикстурах.
 */
export function assemble({ wer = [], majestic = [], rage = [], hints = { logs: [], plugins: [] }, companions = [], rageMpPresent = false }) {
  const usedMajestic = new Set();
  const usedRage = new Set();
  const items = [];

  const take = (list, used, t, within, accept = () => true) => {
    const found = nearest(list.filter((item) => !used.has(item) && accept(item)), t, within);
    if (found) used.add(found);
    return found;
  };

  /* Падения с событием Windows — основные. Журнал Majestic берём «упавший» первым, иначе просто ближайший по времени. */
  for (const crash of wer.filter((item) => !isRageLauncherAbort(item))) {
    const maj = take(majestic, usedMajestic, crash.t, ATTACH_MS, (item) => item.crashed) || take(majestic, usedMajestic, crash.t, 20 * 1000);
    /* Журнал RAGE MP — улика, только если строка о падении с ВРЕМЕНЕМ легла в пределах двух минут от события Windows. */
    const rageLog = rage
      .filter((item) => !usedRage.has(item))
      .map((item) => ({ item, gap: Math.min(...(item.hits || []).map((hit) => Math.abs(hit.t - crash.t))) }))
      .filter(({ gap }) => gap <= ATTACH_MS)
      .sort((a, b) => a.gap - b.gap)[0]?.item || null;
    if (rageLog) usedRage.add(rageLog);
    items.push({ t: crash.t, wer: crash, majestic: maj, rage: rageLog });
  }
  /* Упавший журнал Majestic без события Windows (WER отключён, событие вытеснено) — падение само по себе: клиент пишет конец сессии надёжно.
     Журналы RAGE MP без события Windows падением не считаются: формат не проверен, слова «fatal»/«crash» встречаются и в обычной работе. */
  for (const log of majestic) if (!usedMajestic.has(log) && log.crashed) items.push({ t: log.t, wer: null, majestic: log, rage: null });

  return items
    .sort((a, b) => b.t - a.t)
    .map((item) => {
      const where = classifyWhere({ wer: item.wer, majestic: item.majestic, rage: item.rage, companions, rageMpPresent });
      const reason = buildReason({ wer: item.wer, majestic: item.majestic, rage: item.rage, where });
      const plugins = where === "sp" || where === "unknown" ? hints.logs.filter((log) => Math.abs(log.mtimeMs - item.t) <= HINT_ATTACH_MS) : [];
      return { ...item, where, reason, pluginLogs: plugins, plugins: where === "sp" ? hints.plugins : [] };
    });
}

function windowsEvidence(wer) {
  if (!wer) return null;
  return {
    source: "windows",
    event: wer.eventId === 1002 ? "Application Hang" : wer.eventId === 1001 ? "Windows Error Reporting" : "Application Error",
    bucket: wer.bucket || "",
    process: wer.name,
    version: wer.version,
    module: wer.module || "",
    moduleVersion: wer.moduleVersion || "",
    exception: wer.exception || "",
    offset: wer.offset || "",
    path: scrubLine(wer.appPath || ""),
    modulePath: scrubLine(wer.modulePath || ""),
  };
}

/** Запись о падении для журнала и окна. Всё, что пришло из чужих журналов, уже вычищено. */
export function toRecord(item, { suspects, index, via, detectedAt }) {
  const { wer, majestic, rage } = item;
  const evidence = [
    windowsEvidence(wer),
    majestic && { source: "majestic-client", file: majestic.file, lines: majestic.lastLines.slice(-EVIDENCE_LOG_LINES) },
    rage && { source: "ragemp-log", file: rage.file, lines: (rage.hitLines?.length ? rage.hitLines : rage.lastLines).slice(-EVIDENCE_LOG_LINES) },
    ...item.pluginLogs.map((log) => ({ source: "gta-plugin-log", file: log.file, lines: log.lastLines })),
    item.crashLogs?.length && {
      source: "gta-crashlogs",
      file: "CrashLogs",
      /* Только имена, размеры и время: дамп не читается, а поддержка по этим строкам знает, что просить у человека. */
      lines: item.crashLogs.slice(0, CRASH_LOGS_LISTED).map((file) => scrubLine(`${file.name} · ${sizeLabel(file.size)} · ${clock(file.mtimeMs)}`)),
    },
  ].filter(Boolean);
  const t = item.t;
  const uptime = uptimeOf(wer);
  return {
    id: `gc-${stamp(t)}-${item.where}`,
    kind: "game-crash",
    t,
    iso: new Date(t).toISOString(),
    where: item.where,
    event: wer?.kind === "hang" ? "hang" : "crash",
    process: wer ? { name: wer.name, version: wer.version, pid: wer.pid, ...(uptime === null ? {} : { startedAt: wer.startedAt }) } : null,
    ...(uptime === null ? {} : { uptimeSec: uptime }),
    module: wer?.module ? { name: wer.module, version: wer.moduleVersion || "", system: Boolean(wer.moduleIsSystem) } : null,
    exception: wer?.exception || "",
    offset: wer?.offset || "",
    reason: item.reason,
    evidence,
    wanted: suspects.wanted,
    suspects: suspects.suspects,
    foreign: suspects.foreign,
    mods: suspects.installed,
    modsTotal: suspects.installedTotal,
    index: index?.tooBig ? "too-big" : index?.missing ? "missing" : index?.unreadable ? "unreadable" : "ok",
    plugins: item.plugins,
    via,
    detectedAt,
  };
}

/**
 * Полная проверка за последние `sinceMs`. `deps` подменяются в тестах. Возвращает `{ records, problems }`;
 * записи — по убыванию времени, не больше `limit`. `windowsFailed` — журнал Windows не прочитан: проверку нельзя считать выполненной.
 */
export async function scanGameCrashes({
  sinceMs,
  via = "startup",
  limit = 10,
  now = Date.now,
  env = process.env,
  stateDir = "",
  gameRoots = [],
  companions = [],
  deps = {},
} = {}) {
  const problems = [];
  const guard = async (label, work, fallback) => {
    try {
      return await work();
    } catch (error) {
      problems.push(`${label}: ${String(error?.message || error).split(/\r?\n/)[0].slice(0, 160)}`);
      return fallback;
    }
  };
  const readWer = deps.readWer || readWerCrashes;
  const readMajestic = deps.readMajestic || readMajesticCrashes;
  const readRage = deps.readRage || readRageMpCrashes;
  const readHints = deps.readHints || readSinglePlayerHints;
  const readIndex = deps.readIndex || readInstallIndex;
  const readQuick = deps.readQuickExits || readQuickGameExits;
  const readCrashLogs = deps.readCrashLogs || readGameCrashLogs;
  const roots = deps.rageMpRoots || rageMpRoots;

  const since = Math.max(60 * 1000, sinceMs);
  const floor = now() - since - ATTACH_MS;

  /* Источник Windows отказал (нет wevtutil, запрет журнала, таймаут) — проверка «не была»: метку проверки двигать нельзя (`windowsFailed`). */
  let windowsFailed = false;
  const werReply = await guard("журнал Windows", async () => readWer({ sinceMs: since, now }), null).then((reply) => {
    if (reply === null) windowsFailed = true;
    return reply || { crashes: [], error: "" };
  });
  if (werReply.error) {
    windowsFailed = true;
    problems.push(`журнал Windows: ${werReply.error}`);
  }
  const wer = (werReply.crashes || []).filter((crash) => crash.t >= now() - since);

  const majestic = await guard("журналы Majestic", () => readMajestic({ env, sinceMs: floor }), []);
  const rageRootsFound = await guard("папка RAGE MP", () => roots({ env, hints: [...new Set(wer.map(rageMpRootOf).filter(Boolean))] }), []);
  const rage = rageRootsFound.length ? await guard("журналы RAGE MP", () => readRage({ roots: rageRootsFound, sinceMs: floor }), []) : [];
  const gtaHints = await guard("журналы модулей GTA V", () => readHints({ gameRoots }), { logs: [], plugins: [] });

  /* Собственные отчёты игры о фатальной ошибке: только список файлов, свежие первыми (содержимое дампа здесь не читается). */
  const crashLogs = await guard("папка CrashLogs игры", () => readCrashLogs({ env, sinceMs: floor }), []);
  const found = assemble({ wer, majestic, rage, hints: gtaHints, companions, rageMpPresent: rageRootsFound.length > 0 })
    .filter((item) => item.t >= now() - since)
    .map((item) => ({ ...item, crashLogs: logsBetween(crashLogs, item.t - CRASH_LOGS_BEFORE_MS, item.t + CRASH_LOGS_AFTER_MS) }));

  /* Один проход по файлу состояния движка на все падения сразу. */
  const wantedByItem = found.map((item) => wantedFiles({ majestic: item.majestic, rage: item.rage, wer: item.wer }));
  const allWanted = [...new Set(wantedByItem.flat())];
  /* Файл состояния — десятки мегабайт: читается один раз и только если упало хоть что-то (проверка без падений его не трогает). */
  const index = !found.length ? { mods: [], total: 0, skipped: true } : stateDir ? await guard("записи установки", () => readIndex(stateDir, allWanted), { mods: [], total: 0, unreadable: true }) : { mods: [], total: 0, missing: true };

  const detectedAt = now();
  const records = found.slice(0, limit).map((item, at) => {
    const wanted = wantedByItem[at];
    const suspects = { ...resolveSuspects(index, { wanted, t: item.t }), wanted };
    return toRecord(item, { suspects, index, via, detectedAt });
  });
  /* Быстрые выходы без аварии (код 0) — не падения и записей не дают, но следующий журнал должен их показывать (`index.js` пишет строку журнала). */
  const quickRaw = await guard("Rockstar Launcher (быстрый выход)", () => readQuick({ env, sinceMs: now() - since }), []);
  /* Дамп игры ложится в минуту выхода: файлы от минуты до запуска и до двух минут после выхода принадлежат этому запуску. */
  const quickExits = quickRaw.map((quick) => ({ ...quick, crashLogs: logsBetween(crashLogs, (quick.startedAt ?? quick.t) - 60 * 1000, quick.t + 2 * 60 * 1000) }));
  return { records, problems, windowsFailed, quickExits };
}
