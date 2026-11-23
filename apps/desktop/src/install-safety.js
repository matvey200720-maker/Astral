import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describeProcess, runningProcesses } from "./game-processes.js";

const INSTALL_HEADROOM_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_HEADROOM_BYTES = 64 * 1024 * 1024;
const KNOWN_GAME_PROCESSES = Object.freeze([
  "GTA5.exe",
  "GTA5_BE.exe",
  "GTA5_Enhanced.exe",
]);

function installBlocked(message, code = "ASTRAL_GAME_RUNNING") {
  const error = new Error(message);
  error.name = "InstallBlockedError";
  error.code = code;
  return error;
}

/* Первая строка причины сбоя, без путей-простыней: уходит в текст отказа. */
const causeOf = (error) =>
  String(error?.message || error || "неизвестная ошибка").split(/\r?\n/)[0].slice(0, 160);

/**
 * Какие процессы игры сейчас запущены: `[{ name, pid }]`. Не смогли спросить у
 * Windows — отдельная ошибка с причиной: «не удалось проверить» и «игра
 * запущена» человеку говорят разное.
 */
export async function findBlockingGameProcessDetails(
  game,
  { platform = process.platform, run } = {},
) {
  if (platform !== "win32") return [];
  try {
    /* Без подставного запуска — быстрый список процессов из движка (`game-processes.js`), tasklist — запасной путь. */
    return await runningProcesses(
      [game?.executable, ...KNOWN_GAME_PROCESSES],
      run === undefined ? {} : { run },
    );
  } catch (cause) {
    const error = installBlocked(
      `Не удалось проверить запущенные процессы GTA V (${causeOf(cause)}). Установка остановлена безопасно.`,
      "ASTRAL_PROCESS_CHECK_FAILED",
    );
    error.cause = cause;
    throw error;
  }
}

export async function findBlockingGameProcesses(game, options = {}) {
  return (await findBlockingGameProcessDetails(game, options)).map(({ name }) => name);
}

/**
 * То же, что `assertInstallRuntimeSafe`, но ответом, а не исключением: окно
 * спрашивает, можно ли сейчас менять игру, и показывает «Закройте GTA V»
 * (Т-170). Одни и те же условия — иначе кнопка активна, а установка отказывает.
 */
export async function inspectInstallRuntime(game, options = {}) {
  try {
    await assertInstallRuntimeSafe(game, options);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === "ASTRAL_GAME_UPDATE_RUNNING" ? "launcher-busy" : "game-running",
      message: String(error?.message || error),
    };
  }
}

export async function assertInstallRuntimeSafe(game, options = {}) {
  if (game?.launcherState?.busy) {
    throw installBlocked(
      "Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.",
      "ASTRAL_GAME_UPDATE_RUNNING",
    );
  }
  const running = await findBlockingGameProcessDetails(game, options);
  if (running.length) {
    throw installBlocked(
      `Закройте GTA V перед установкой. Найден процесс: ${running.map(describeProcess).join(", ")}. ` +
        "Также завершите GTA 5 RP Launcher и Majestic Launcher.",
    );
  }
  return { safe: true, running: [] };
}

export function watchInstallRuntime({
  game,
  controller,
  /* Раз в 2 с, а не 750 мс (02.11.2026): снимок `tasklist` стоит ~0,4 с ЦП и до 2 с под нагрузкой,
     и опрос шёл почти без перерыва рядом с записью установки. Игре от запуска до чтения архивов
     нужно больше, а перед подменой файлов установка ещё раз спрашивает сама (`assertRuntimeSafe`). */
  intervalMs = 2000,
  check = assertInstallRuntimeSafe,
}) {
  let stopped = false;
  let timer = null;
  const poll = async () => {
    if (stopped || controller.signal.aborted) return;
    try {
      await check(game);
    } catch (error) {
      controller.abort(error);
      return;
    }
    if (!stopped) timer = setTimeout(poll, intervalMs);
  };
  timer = setTimeout(poll, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function volumeKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? path.parse(resolved).root.toLowerCase()
    : path.parse(resolved).root;
}

function payloadBytes(manifest) {
  let total = 0;
  let unknownFiles = 0;
  for (const file of manifest?.files || []) {
    if (String(file.action || "replace").toLowerCase() === "delete") continue;
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) unknownFiles += 1;
    else total += size;
  }
  return { total, unknownFiles };
}

export function estimateInstallCapacity({ manifest, plan }) {
  const payload = payloadBytes(manifest);
  if (payload.unknownFiles) {
    throw installBlocked(
      "Пакет не содержит точный размер каждого файла. Публикацию нужно исправить перед установкой.",
      "ASTRAL_PACKAGE_SIZE_UNKNOWN",
    );
  }
  const backupBytes = Math.max(
    0,
    Number(plan?.summary?.transactionBackupBytes || 0),
  );
  return {
    packageBytes: payload.total,
    backupBytes,
    downloadsBytes: payload.total + DOWNLOAD_HEADROOM_BYTES,
    stateBytes: payload.total + backupBytes * 2 + INSTALL_HEADROOM_BYTES,
    gameBytes: payload.total + backupBytes + INSTALL_HEADROOM_BYTES,
  };
}

/**
 * Один вход для `estimateInstallCapacity` и `assertInstallCapacity` от нескольких пакетов одной транзакции (`installRemotePackages`):
 * файлы всех манифестов вместе; копия живого архива, который трогают несколько пакетов, считается один раз, потому что
 * архив собирается и подменяется разом на всех (`installPackageBatch`).
 */
export function combineInstallInputs(manifests, plans) {
  const archives = new Map();
  for (const plan of plans)
    for (const file of plan?.files || [])
      if (!archives.has(file.target)) archives.set(file.target, Math.max(0, Number(file.currentSize) || 0));
  return {
    manifest: { files: manifests.flatMap((manifest) => manifest?.files || []) },
    plan: { summary: { transactionBackupBytes: [...archives.values()].reduce((sum, bytes) => sum + bytes, 0) } },
  };
}

export async function assertInstallCapacity({
  manifest,
  plan,
  gameRoot,
  stateDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Astral", "cache", "backups")
    : path.join(os.homedir(), ".astral", "backups"),
  downloadsDir = path.join(stateDir, "downloads"),
  statfs = fs.statfs,
}) {
  const estimate = estimateInstallCapacity({ manifest, plan });
  const locations = [
    { kind: "game", root: path.resolve(gameRoot), bytes: estimate.gameBytes },
    { kind: "state", root: path.resolve(stateDir), bytes: estimate.stateBytes },
    {
      kind: "downloads",
      root: path.resolve(downloadsDir),
      bytes: estimate.downloadsBytes,
    },
  ];
  const volumes = new Map();
  for (const location of locations) {
    await fs.mkdir(location.root, { recursive: true });
    const key = volumeKey(location.root);
    const current = volumes.get(key) || {
      key,
      root: location.root,
      requiredBytes: 0,
      kinds: [],
    };
    current.requiredBytes += location.bytes;
    current.kinds.push(location.kind);
    volumes.set(key, current);
  }
  const report = [];
  for (const volume of volumes.values()) {
    const disk = await statfs(volume.root);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    const item = { ...volume, freeBytes };
    report.push(item);
    if (!Number.isFinite(freeBytes) || freeBytes < volume.requiredBytes) {
      const error = installBlocked(
        `Недостаточно места для безопасной установки: требуется ${volume.requiredBytes} байт, доступно ${Number.isFinite(freeBytes) ? freeBytes : 0} байт.`,
        "ASTRAL_INSUFFICIENT_SPACE",
      );
      error.capacity = item;
      throw error;
    }
  }
  return { ...estimate, volumes: report };
}
