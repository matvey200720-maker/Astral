import path from "node:path";
import * as childProcess from "node:child_process";
import { appLog } from "./app-log.js";
import os from "node:os";
import { listenOnSafePort } from "./loopback-port.js";
import * as nodeCrypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

export const BROWSER_OPEN_GRACE_MS = 10000;
export const READY_FLAG = "--astral-ready-file=";
export const ELEVATED_FLAG = "--astral-elevated";

// Запуск без окна (установка ветки): повышать такой процесс не нужно.
const HEADLESS_FLAG = "--install-channel";
const BLOCKING_FLAGS = [ELEVATED_FLAG, HEADLESS_FLAG];
const EXPLORER_OPTIONS = { detached: true, stdio: "ignore", windowsHide: true };
const RELAY_ORIGIN = "http://127.0.0.1";
const WEB_ADDRESS = /^https?:\/\//i;

// Сроки ожиданий, мс: готовность окна, шаг опроса, согласие на повышение, жизнь одноразового адреса.
const WAIT = { ready: 120000, poll: 200, consent: 600000, relay: 120000 };

const POWERSHELL_FIXED_ARGS = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand".split(" ");

// Ответ в UTF-8: иначе кириллица в причине портится.
const SCRIPT_OPEN = ["$ErrorActionPreference = 'Stop'", "try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch {}", "try {"];
const SCRIPT_CLOSE = [
  "} catch {",
  "  $e = $_.Exception; $code = 0",
  "  while ($e) { if ($e.NativeErrorCode) { $code = $e.NativeErrorCode }; $e = $e.InnerException }",
  "  if ($code -eq 1223) { Write-Output 'declined' } else { Write-Output ('error=' + $_.Exception.Message) }",
  "}",
];

// Записи журнала: уровень задаётся один раз, источник всегда один.
const recordAs = (level) => (message, detail = "") =>
  appLog.record({ level, source: "elevation", message, detail });
const journal = { warn: recordAs("warn"), info: recordAs("info") };

const reasonOf = (failure) => String([failure?.code, failure?.message].find(Boolean) ?? failure);

// Выполняет действие; true, если оно не бросило.
function attempt(action) {
  let finished = true;
  try {
    action();
  } catch {
    finished = false;
  }
  return finished;
}

const psQuote = (value) => ["'", String(value).replaceAll("'", "''"), "'"].join("");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Процесс с правами из обычного не открыть, но он существует.
function processAlive(pid) {
  let failed = false;
  let failure;
  try {
    process.kill(pid, 0);
  } catch (caught) {
    failed = true;
    failure = caught;
  }
  return !failed || failure?.code === "EPERM";
}

export function shouldElevate({ platform = process.platform, ...rest } = {}) {
  const { isPackaged = false } = rest;
  const { env = process.env, argv = process.argv } = rest;
  if (!(platform === "win32" && Boolean(isPackaged))) return false;
  if (env.ASTRAL_NO_ELEVATE === "1") return false;
  return BLOCKING_FLAGS.every((flag) => !argv.includes(flag));
}

export const isElevated = ({ run = childProcess.execFileSync } = {}) => {
  const probe = { stdio: "ignore", windowsHide: true, timeout: 5000 };
  return attempt(() => run("fltmc", [], probe));
};

// Черты перед кавычкой удваиваются и получают ещё одну; черты в самом конце — только удваиваются.
export function quoteWindowsArgument(value) {
  const text = String(value);
  const needsQuotes = text === "" || /[\s\x22]/.test(text);
  if (!needsQuotes) return text;
  const doubled = text.replace(/(\\*)\x22/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  return `"${doubled}"`;
}

export function runAsScript({ exe, ...rest }) {
  const { args, cwd, wait = false } = rest;
  const argLine = args.map(quoteWindowsArgument).join(" ");
  const startWords = [
    "Start-Process",
    `-FilePath ${psQuote(exe)}`,
    ...(argLine ? [`-ArgumentList ${psQuote(argLine)}`] : []),
    `-WorkingDirectory ${psQuote(cwd)}`,
    "-Verb RunAs",
    "-PassThru",
    ...(wait ? ["-Wait"] : []),
  ];
  const [label, answer] = wait ? ["exit=", "$p.ExitCode"] : ["pid=", "$p.Id"];
  const lines = [].concat(
    SCRIPT_OPEN,
    `  $p = ${startWords.join(" ")}`,
    `  Write-Output ('${label}' + ${answer})`,
    SCRIPT_CLOSE,
  );
  return lines.join("\n");
}

const firstFilledLine = (raw) =>
  raw
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => row !== "") ?? "";

const OUTPUT_SHAPES = [
  { pattern: /^pid=(\d+)$/, make: ([, digits]) => ({ outcome: "started", pid: Number(digits) }) },
  { pattern: /^exit=(-?\d+)$/, make: ([, digits]) => ({ outcome: "exited", code: Number(digits) }) },
  { pattern: /^declined$/, make: () => ({ outcome: "declined" }) },
];

export function parseRunAsOutput(text) {
  const line = firstFilledLine(text ? String(text) : "");
  for (const { pattern, make } of OUTPUT_SHAPES) {
    const found = pattern.exec(line);
    if (found) return make(found);
  }
  const reason = line.replace(/^error=/, "");
  return Object.assign({ outcome: "failed" }, { error: reason || "no output" });
}

export function startElevated({ exe, ...rest } = {}) {
  const { args = [], cwd = process.cwd(), wait = false } = rest;
  const { runFile = childProcess.execFile } = rest;
  // Сценарий и его кодировка готовы до обещания: плохие аргументы бросают сразу.
  const encoded = Buffer.from(runAsScript({ exe, args, cwd, wait }), "utf16le").toString("base64");

  const answerTo = (deliver) => (error, stdout) => {
    const failedOutright = error && !stdout;
    deliver(failedOutright ? { outcome: "failed", error: String(error.message || error) } : parseRunAsOutput(stdout));
  };
  return new Promise((deliver) => {
    runFile("powershell.exe", POWERSHELL_FIXED_ARGS.concat(encoded), { windowsHide: true, timeout: WAIT.consent }, answerTo(deliver));
  });
}

export function waitForReady({ readyFile, ...rest } = {}) {
  const { pid, timeoutMs = WAIT.ready, pollMs = WAIT.poll } = rest;
  const { exists = fs.existsSync, alive = processAlive } = rest;
  const { now = Date.now, sleep = pause } = rest;
  const deadline = now() + timeoutMs;

  // Один круг опроса: итог либо null (ждать дальше).
  const verdictNow = () => {
    if (exists(readyFile)) return "ready";
    if (!pid || alive(pid)) return now() >= deadline ? "timeout" : null;
    return exists(readyFile) ? "ready" : "exited";
  };

  return (async () => {
    for (;;) {
      const verdict = verdictNow();
      if (verdict !== null) return verdict;
      await sleep(pollMs);
    }
  })();
}

const readyFileIn = (dir) => path.join(dir, `astral-elevated-${nodeCrypto.randomBytes(6).toString("hex")}.ready`);
const dropFile = (file) => fs.rmSync(file, { force: true });

// Просит запустить копию с правами и ждёт, пока она покажет окно; true — окно открыто, этот процесс можно закрывать.
async function handOver({ start, wait, remove, execPath, argv, tmpdir }) {
  const readyFile = readyFileIn(tmpdir);
  const launched = await start({
    exe: execPath,
    args: [...argv.slice(1), ELEVATED_FLAG, READY_FLAG + readyFile],
    cwd: process.cwd(),
  });
  if (launched.outcome !== "started") {
    journal.warn(
      `Запуск от имени администратора не вышел (${launched.outcome}), Astral работает без прав`,
      launched.error || "",
    );
    return false;
  }

  const verdict = await wait({ readyFile, pid: launched.pid });
  remove(readyFile);
  if (verdict === "exited") journal.warn("Повышенный запуск вышел до окна, Astral продолжает без прав");
  return verdict !== "exited";
}

export const takeOverElevated = async (app, deps = {}) => {
  const { platform = process.platform, env = process.env } = deps;
  const { argv = process.argv, execPath = process.execPath } = deps;
  const { checkElevated = isElevated, start = startElevated, wait = waitForReady } = deps;
  const { tmpdir = os.tmpdir(), remove = dropFile } = deps;

  const allowed = shouldElevate({ platform, isPackaged: Boolean(app?.isPackaged), env, argv });
  if (!allowed || checkElevated()) return false;

  const handedOver = await handOver({ start, wait, remove, execPath, argv, tmpdir });
  if (handedOver) app.exit(0);
  return handedOver;
};

const isReadyMarker = (item) => item.startsWith(READY_FLAG);

export const markElevatedReady = ({ argv = process.argv, ...rest } = {}) => {
  const { write = fs.writeFileSync } = rest;
  const marker = argv.find(isReadyMarker);
  return Boolean(marker) && attempt(() => write(marker.slice(READY_FLAG.length), String(process.pid)));
};

// Ответ проверки хранится как есть; пустая память — только null.
const checkMemory = { verdict: null };

export const runningElevated = ({ platform = process.platform, ...rest } = {}) => {
  const { argv = process.argv, check = isElevated } = rest;
  if (platform === "win32" && !argv.includes(ELEVATED_FLAG)) {
    checkMemory.verdict = checkMemory.verdict === null ? check() : checkMemory.verdict;
    return checkMemory.verdict;
  }
  return platform === "win32";
};

// Обработчик одноразового адреса: отвечает переадресацией на первый верный GET, на всё прочее — 404.
function relayHandler({ route, target, state, retire }) {
  const refuse = (response) => {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
  };
  const redirect = (response) => {
    response.writeHead(302, {
      Location: target,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    response.end();
    retire(true);
  };
  return (request, response) => {
    const { pathname } = new URL(request.url || "/", RELAY_ORIGIN);
    const matches = !state.spent && request.method === "GET" && pathname === route;
    (matches ? redirect : refuse)(response);
  };
}

export const startRelay = async (target, { lifetimeMs = WAIT.relay, createServer = http.createServer } = {}) => {
  const route = `/open/${nodeCrypto.randomBytes(24).toString("base64url")}`;
  const state = { spent: false, timer: null };
  const gate = { announce: null, server: null };
  const opened = new Promise((resolve) => {
    gate.announce = resolve;
  });

  // Гасит адрес один раз; срок жизни, close() и успешное открытие идут через неё.
  const retire = (outcome) => {
    if (state.spent) return;
    state.spent = true;
    clearTimeout(state.timer);
    gate.server.close();
    gate.announce(outcome);
  };
  const close = () => retire(false);

  gate.server = createServer(relayHandler({ route, target, state, retire }));
  const port = await listenOnSafePort(gate.server);
  state.timer = setTimeout(close, lifetimeMs);
  state.timer.unref?.();

  return { url: `${RELAY_ORIGIN}:${port}${route}`, opened, close };
};

// Запускает проводник с адресом; false, если запуск бросил сразу.
function runExplorer(launch, address) {
  let started = true;
  try {
    const child = launch("explorer.exe", [address], { ...EXPLORER_OPTIONS });
    child.on?.("error", (failure) => journal.warn("ссылка: проводник не запустился", reasonOf(failure)));
    child.unref?.();
  } catch (failure) {
    started = false;
    journal.warn("ссылка: проводник не запустился, открываю напрямую", reasonOf(failure));
  }
  return started;
}

// Ждёт, пока браузер придёт за адресом, но не дольше graceMs.
async function browserFetchedLink(link, graceMs) {
  let timer;
  const lapse = new Promise((resolve) => {
    timer = setTimeout(resolve, graceMs, false);
  });
  try {
    return await Promise.race([link.opened, lapse]);
  } finally {
    clearTimeout(timer);
  }
}

// Поднимает одноразовый адрес; null, если не вышло (причина уходит в журнал).
async function tryRelay(relay, url) {
  try {
    return await relay(url);
  } catch (failure) {
    journal.warn("ссылка: одноразовый адрес не поднялся, проводнику уходит сама ссылка", reasonOf(failure));
    return null;
  }
}

export const openUrl = async (shell, target, { elevated = runningElevated, ...rest } = {}) => {
  const { launch = childProcess.spawn, relay = startRelay } = rest;
  const { graceMs = BROWSER_OPEN_GRACE_MS } = rest;
  const url = String(target);
  const viaShell = () => shell.openExternal(url);
  if (!WEB_ADDRESS.test(url) || !elevated()) return viaShell();

  const link = await tryRelay(relay, url);
  if (!runExplorer(launch, link ? link.url : url)) {
    link?.close();
    return viaShell();
  }
  if (!link) return undefined;

  const fetched = await browserFetchedLink(link, graceMs);
  if (fetched) {
    journal.info("ссылка: браузер открыл адрес от проводника");
    return undefined;
  }
  journal.warn(`ссылка: браузер не открыл адрес от проводника за ${Math.round(graceMs / 1000)} с, открываю напрямую`);
  return viaShell();
};
