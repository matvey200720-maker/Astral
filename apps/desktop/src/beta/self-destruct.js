// Исполнитель самоудаления бета-лаунчера: план, сценарий для cmd.exe, запуск и снятие процессов.
import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { win32 } from "node:path";
import { BRANCHES, branchOfRoot, shortcutName } from "./branches.js";

export const UNINSTALL_ROOT = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
export const OWN_CHILD_DIRECTORIES = Object.freeze([
  "app",
  "app.new",
  "app.old",
  "beta",
  "beta.new",
  "beta.old",
  "update",
  ".setup",
]);
export const SETUP_EXE_NAME = "AstralBetaSetup.exe";
export const HIDDEN_LAUNCH_WAIT_MS = 8000;

const DATA_FOLDERS = ["Astral Beta", "Astral Alpha"];
const SHARED_DATA_FOLDER = "Astral";
const FALLBACK_SYSTEM_ROOT = "C:\\Windows";
const CMD_SPECIAL_CHARS = ["%", "^", '"', "\n", "\r", "\0"];

const WHY = {
  noLayout: "exe is not <root>\\app\\Astral*.exe: the install folder is not touched",
  notBranch: "not a folder of one of the three branches: left in place",
  relative: "path is not absolute",
  special: "path contains characters cmd.exe reads specially",
  link: "link or junction is not followed",
  sharedData: "userData is shared by all branches (<AppData>\\Astral): left in place",
  foreignData: "userData is not <AppData>\\Astral Beta or <AppData>\\Astral Alpha: left in place",
};

const POWERSHELL_COMMAND =
  "$q = [char]34; Start-Process -WindowStyle Hidden -FilePath $env:ASTRAL_RM_CMD -ArgumentList " +
  "('/d /s /c ' + $q + $q + $env:ASTRAL_RM_SCRIPT + $q + $q)";

// Каркас сценария: между строкой `:gone` с ping и строкой `(goto)` встают вызовы по плану.
const SCRIPT_HEAD = [
  "@echo off",
  "setlocal DisableDelayedExpansion",
  'set "SYS=%SystemRoot%\\System32"',
  "set /a WAITED=0",
  ":waitexe",
  "if not defined ASTRAL_RM_WAIT goto gone",
  'if not exist "%ASTRAL_RM_WAIT%" goto gone',
  'del /f /q "%ASTRAL_RM_WAIT%" >nul 2>&1',
  'if not exist "%ASTRAL_RM_WAIT%" goto gone',
  "set /a WAITED+=1",
  "if %WAITED% GEQ 120 goto gone",
  '"%SYS%\\ping.exe" -n 2 127.0.0.1 >nul',
  "goto waitexe",
  ":gone",
  '"%SYS%\\ping.exe" -n 3 127.0.0.1 >nul',
];

const retryLoop = (name, removeCommand) => [
  `:${name}`,
  "set /a TRIES=0",
  `:${name}_try`,
  'if not exist "%~1" goto :eof',
  removeCommand,
  'if not exist "%~1" goto :eof',
  "set /a TRIES+=1",
  "if %TRIES% GEQ 60 goto :eof",
  '"%SYS%\\ping.exe" -n 2 127.0.0.1 >nul',
  `goto ${name}_try`,
];

const SCRIPT_TAIL = [
  '(goto) 2>nul & del "%~f0"',
  ...retryLoop("rmdir", 'rd /s /q "%~1" >nul 2>&1'),
  ...retryLoop("rmfile", 'del /f /q "%~1" >nul 2>&1'),
];

// Группы плана: поле, префикс переменной среды и строка вызова.
const SCRIPT_GROUPS = [
  { field: "directories", prefix: "ASTRAL_RM_DIR", call: (name) => `call :rmdir "%${name}%"` },
  { field: "files", prefix: "ASTRAL_RM_FILE", call: (name) => `call :rmfile "%${name}%"` },
  { field: "rootsIfEmpty", prefix: "ASTRAL_RM_ROOT", call: (name) => `rd "%${name}%" >nul 2>&1` },
  {
    field: "registryKeys",
    prefix: "ASTRAL_RM_REGKEY",
    call: (name) => `"%SYS%\\reg.exe" delete "%${name}%" /f >nul 2>&1`,
  },
];

const codeOrText = (error) => error?.code ?? String(error);
const reasonOf = (error) => error?.code ?? error?.message ?? String(error);

const systemRootOf = (env) => env.SystemRoot || env.SYSTEMROOT || FALLBACK_SYSTEM_ROOT;

const comparable = (value) => win32.normalize(String(value)).replace(/\\+$/, "").toLowerCase();

export function sameWindowsPath(left, right) {
  return comparable(left) === comparable(right);
}

export function withinWindowsPath(child, parent) {
  const inner = comparable(child);
  const outer = comparable(parent);
  return inner === outer || inner.startsWith(`${outer}\\`);
}

export function unsafeForCmd(value) {
  const text = String(value);
  return CMD_SPECIAL_CHARS.some((char) => text.includes(char));
}

const isDriveOrShareRoot = (folder) => win32.dirname(folder) === folder;

function layoutOf(exe, appDir, root) {
  const beta = win32.join(root, "beta");
  return {
    exe,
    appDir,
    root,
    beta,
    licenseFile: win32.join(beta, "license"),
    bindFile: win32.join(beta, "bind"),
    pakFile: win32.join(beta, "astral-web.pak"),
    manifestFile: win32.join(beta, "manifest.json"),
    setupExe: win32.join(root, SETUP_EXE_NAME),
  };
}

export function resolveLayout(exePath) {
  if (typeof exePath !== "string") return null;
  const exe = win32.normalize(exePath);
  if (!win32.isAbsolute(exe)) return null;
  if (!/^astral.*.exe$/i.test(win32.basename(exe))) return null;
  const appDir = win32.dirname(exe);
  if (win32.basename(appDir).toLowerCase() !== "app") return null;
  const root = win32.dirname(appDir);
  if (isDriveOrShareRoot(root)) return null;
  return layoutOf(exe, appDir, root);
}

export function resolveSiblingLayout(rootPath) {
  if (typeof rootPath !== "string") return null;
  const root = win32.normalize(rootPath).replace(/\\+$/, "");
  if (!win32.isAbsolute(root) || isDriveOrShareRoot(root)) return null;
  if (branchOfRoot(root) === null) return null;
  return layoutOf(null, win32.join(root, "app"), root);
}

// Осмотр одного пути: найден, нет такого, ссылка или отказ с причиной.
async function examine(fsImpl, target, want) {
  if (typeof target !== "string" || !win32.isAbsolute(target)) return { state: "refused", why: WHY.relative };
  if (unsafeForCmd(target)) return { state: "refused", why: WHY.special };
  try {
    const info = await fsImpl.lstat(target);
    if (info.isSymbolicLink()) return { state: "link", why: WHY.link };
    if (want === "file") {
      return info.isFile() ? { state: "found", isDir: false } : { state: "refused", why: "expected a file" };
    }
    const isDir = info.isDirectory();
    if (want === "dir" && !isDir) return { state: "refused", why: "expected a dir" };
    return { state: "found", isDir };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { state: "missing" };
    return { state: "refused", why: `cannot inspect: ${codeOrText(error)}` };
  }
}

// Метка беты: хватает любого из четырёх путей, все lstat стартуют сразу.
async function hasBetaMark(fsImpl, layout) {
  const marks = [layout.licenseFile, layout.manifestFile, layout.pakFile, layout.setupExe];
  const results = await Promise.allSettled(marks.map(async (mark) => fsImpl.lstat(mark)));
  return results.some((result) => result.status === "fulfilled");
}

function userDataNote(userDataPath, appDataPath) {
  if (appDataPath) {
    if (DATA_FOLDERS.some((name) => sameWindowsPath(userDataPath, win32.join(appDataPath, name)))) return null;
    if (sameWindowsPath(userDataPath, win32.join(appDataPath, SHARED_DATA_FOLDER))) return WHY.sharedData;
  }
  return WHY.foreignData;
}

export async function planRemoval(options) {
  const {
    exePath,
    userDataPath,
    appDataPath,
    localAppDataPath,
    startMenuDir,
    desktopDir,
    siblingRoots = [],
    fsImpl = fs,
    readShortcut = () => null,
    readRegistry = async () => null,
  } = options;

  const directories = [];
  const files = [];
  const rootsIfEmpty = [];
  const registryKeys = [];
  const skipped = [];
  const roots = [];

  const look = async (target, want) => {
    const seen = await examine(fsImpl, target, want);
    if (seen.why) skipped.push({ target, why: seen.why });
    return seen;
  };

  const takeRoot = async (layout) => {
    const { root } = layout;
    roots.push(root);
    const seen = await look(root);
    if (seen.state === "link") return;
    const whole =
      seen.state === "found" && seen.isDir && branchOfRoot(root) !== null && (await hasBetaMark(fsImpl, layout));
    if (whole) {
      directories.push(root);
      return;
    }
    for (const child of OWN_CHILD_DIRECTORIES) {
      const folder = win32.join(root, child);
      if ((await look(folder, "dir")).state === "found") directories.push(folder);
    }
    if ((await look(layout.setupExe, "file")).state === "found") files.push(layout.setupExe);
    if (unsafeForCmd(root)) skipped.push({ target: root, why: WHY.special });
    else rootsIfEmpty.push(root);
  };

  const own = resolveLayout(exePath);
  if (own === null) {
    skipped.push({ target: String(exePath), why: WHY.noLayout });
  } else {
    await takeRoot(own);
    for (const candidate of siblingRoots) {
      const layout = resolveSiblingLayout(candidate);
      if (layout === null) skipped.push({ target: String(candidate), why: WHY.notBranch });
      else if (!roots.some((known) => sameWindowsPath(known, layout.root))) await takeRoot(layout);
    }
  }

  if (userDataPath) {
    const why = userDataNote(userDataPath, appDataPath);
    if (why !== null) skipped.push({ target: userDataPath, why });
  }

  for (const base of [appDataPath, localAppDataPath]) {
    if (!base) continue;
    for (const name of DATA_FOLDERS) {
      const folder = win32.join(base, name);
      if ((await look(folder, "dir")).state === "found") directories.push(folder);
    }
  }

  if (own !== null) {
    for (const folder of [startMenuDir, desktopDir]) {
      if (!folder) continue;
      for (const branch of BRANCHES) {
        const shortcut = win32.join(folder, shortcutName(branch));
        if ((await look(shortcut, "file")).state !== "found") continue;
        let info;
        try {
          info = readShortcut(shortcut);
        } catch {
          info = undefined;
        }
        const target = info?.target;
        const known = typeof target === "string" && target !== "";
        if (known && roots.some((root) => withinWindowsPath(target, root))) {
          files.push(shortcut);
        } else {
          skipped.push({
            target: shortcut,
            why: `shortcut points to ${known ? target : "an unknown target"}, not to ours`,
          });
        }
      }
    }

    for (const branch of BRANCHES) {
      const key = `${UNINSTALL_ROOT}\\${branch.uninstallKey}`;
      const pending = readRegistry(key, "InstallLocation");
      let location;
      try {
        location = await pending;
      } catch {
        location = null;
      }
      if (typeof location !== "string" || location === "") continue;
      if (roots.some((root) => sameWindowsPath(location, root))) registryKeys.push(key);
      else skipped.push({ target: key, why: `InstallLocation is ${location}, not ours` });
    }
  }

  return {
    root: own === null ? null : own.root,
    waitFile: own !== null && !unsafeForCmd(own.exe) ? own.exe : null,
    directories,
    files,
    rootsIfEmpty,
    registryKeys,
    skipped,
  };
}

export function buildRemovalScript(plan) {
  const waitFile = plan.waitFile;
  const env = {};
  if (waitFile) env.ASTRAL_RM_WAIT = waitFile;

  const calls = [];
  for (const { field, prefix, call } of SCRIPT_GROUPS) {
    const items = plan[field] || [];
    items.forEach((item, index) => {
      const name = `${prefix}_${index + 1}`;
      env[name] = item;
      calls.push(call(name));
    });
  }

  const lines = [...SCRIPT_HEAD, ...calls, ...SCRIPT_TAIL];
  return { script: `${lines.join("\r\n")}\r\n`, env };
}

export async function removeAccessFiles(files, { fsImpl = fs } = {}) {
  const removed = [];
  const failed = [];
  for (const file of files) {
    try {
      await fsImpl.rm(file, { force: true });
      removed.push(file);
    } catch (error) {
      failed.push({ file, error: codeOrText(error) });
    }
  }
  return { removed, failed };
}

export async function hiddenConsoleLaunch(request, { spawn = nodeSpawn, waitMs = HIDDEN_LAUNCH_WAIT_MS } = {}) {
  const { cmd, script, systemRoot, env } = request;
  const powershell = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(POWERSHELL_COMMAND, "utf16le").toString("base64"),
  ];

  let child;
  try {
    child = spawn(powershell, args, {
      env: { ...env, ASTRAL_RM_CMD: cmd, ASTRAL_RM_SCRIPT: script },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    return { ok: false, reason: `spawn-failed: ${reasonOf(error)}` };
  }

  if (typeof child?.once !== "function") {
    child?.unref?.();
    return { ok: true };
  }

  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), waitMs);
    timer.unref?.();
    child.once("exit", (code) => resolve(code === 0 ? { ok: true } : { ok: false, reason: `exit ${code}` }));
    child.once("error", (error) => resolve({ ok: false, reason: `error: ${reasonOf(error)}` }));
  });
  child.unref?.();
  return outcome;
}

export async function scheduleRemoval(plan, options = {}) {
  const {
    platform = process.platform,
    spawn = nodeSpawn,
    fsImpl = fs,
    env = process.env,
    tmpdir = osTmpdir(),
    hiddenLaunchWaitMs = HIDDEN_LAUNCH_WAIT_MS,
  } = options;

  if (platform !== "win32") return { scheduled: false, reason: "not-windows" };

  const counts = [plan.directories.length, plan.files.length, plan.registryKeys.length];
  if (counts.every((count) => !count)) return { scheduled: false, reason: "nothing-to-remove" };

  const { script, env: scriptEnv } = buildRemovalScript(plan);
  const scriptPath = win32.join(tmpdir, `astral-beta-remove-${randomBytes(6).toString("hex")}.cmd`);
  if (unsafeForCmd(scriptPath)) return { scheduled: false, reason: "temp-path-unsafe" };

  const systemRoot = systemRootOf(env);
  const launchEnv = { ...env, ...scriptEnv };

  try {
    await fsImpl.writeFile(scriptPath, script, { encoding: "ascii", mode: 0o600 });
    const cmd = win32.join(systemRoot, "System32", "cmd.exe");
    const hidden = await hiddenConsoleLaunch(
      { cmd, script: scriptPath, systemRoot, env: launchEnv },
      { spawn, waitMs: hiddenLaunchWaitMs },
    );
    if (hidden.ok) return { scheduled: true, script: scriptPath, via: "powershell" };

    const child = spawn(cmd, ["/d", "/s", "/c", `"${scriptPath}"`], {
      env: launchEnv,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    child?.unref?.();
    return { scheduled: true, script: scriptPath, via: "cmd", hiddenFailed: hidden.reason };
  } catch (error) {
    try {
      await fsImpl.rm(scriptPath, { force: true });
    } catch {
      // сценарий остаться мог, но причина отказа важнее
    }
    return { scheduled: false, reason: `spawn-failed: ${reasonOf(error)}` };
  }
}

export function killProcessTree({
  pid = process.pid,
  platform = process.platform,
  spawn = nodeSpawn,
  env = process.env,
} = {}) {
  if (platform !== "win32") return false;
  try {
    const taskkill = win32.join(systemRootOf(env), "System32", "taskkill.exe");
    const child = spawn(taskkill, ["/F", "/T", "/PID", String(pid)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
