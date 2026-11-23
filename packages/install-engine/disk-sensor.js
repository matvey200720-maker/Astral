/*
 * Датчик занятости диска для регулятора (20.11.2026, `disk-governor.js`).
 *
 * Занятость физического диска («Активное время» в Диспетчере задач) приложение само нигде не мерило: ни PDH, ни WMI, ни `IOCTL_DISK_PERFORMANCE` в нём не было. Два датчика с одним
 * видом отсчётов `{ t, disks: { "0 C:": { busy, queue, latMs } } }`:
 *
 *   — родной: функция модуля Rust (`diskPerformance`, `IOCTL_DISK_PERFORMANCE` по тому) — микросекунды на отсчёт, ни одного процесса; появится после пересборки модуля;
 *   — запасной: один постоянный процесс PowerShell, раз в ~0,7 с читает сырые накопительные счётчики `Win32_PerfRawData_PerfDisk_PhysicalDisk` — те же, что у PDH. Классы
 *     WMI одни на всех языках Windows (имена счётчиков PDH на русской Windows другие), а накопительные счётчики дают точное среднее за любой отрезок. Работает без модуля.
 *     Процесс живёт, только пока идёт работа с диском (`start`/`stop` от регулятора), и сам выходит, если приложение исчезло.
 *
 * Цифры занятости сверены с PDH на одном окне (4,7 % против 4,8 %, очередь 0,06 и 0,06, отклик 0,22 и 0,22 мс): `docs/DISK-GOVERNOR-2011.md`.
 * Нет датчика (не Windows, нет PowerShell, WMI отказал) — регулятор ничего не меняет, установка идёт как шла.
 */

import { spawn as nodeSpawn } from "node:child_process";

/** Период отсчётов запасного датчика, мс (с запросом WMI выходит около секунды). */
export const SENSOR_INTERVAL_MS = 700;
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 1500;

/* Скрипт запасного датчика. Накопительные счётчики — `double`: на секундных окнах точности хватает (часы Windows 1,3e17 с шагом 16 единиц по 100 нс). */
const SENSOR_SCRIPT = (parentPid, intervalMs) => `
$ErrorActionPreference = 'SilentlyContinue'
$prev = @{}
while ($true) {
  if (-not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { break }
  $rows = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -ne '_Total' }
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $out = [ordered]@{}
  foreach ($d in $rows) {
    $n = $d.Name
    $c = @{ idle = [double]$d.PercentIdleTime; base = [double]$d.PercentIdleTime_Base; ql = [double]$d.AvgDiskQueueLength; clock = [double]$d.Timestamp_Sys100NS; lat = [double]$d.AvgDiskSecPerTransfer; latb = [double]$d.AvgDiskSecPerTransfer_Base; f = [double]$d.Frequency_PerfTime; rb = [double]$d.DiskReadBytesPersec; wb = [double]$d.DiskWriteBytesPersec }
    $p = $prev[$n]
    if ($p) {
      $db = $c.base - $p.base
      $dc = $c.clock - $p.clock
      $dl = $c.latb - $p.latb
      if ($db -gt 0 -and $dc -gt 0) {
        $busy = [math]::Round([math]::Max(0, [math]::Min(100, 100 - 100 * ($c.idle - $p.idle) / $db)), 1)
        $queue = [math]::Round(($c.ql - $p.ql) / $dc, 2)
        $lat = if ($dl -gt 0) { [math]::Round((($c.lat - $p.lat) / $c.f / $dl) * 1000, 2) } else { 0 }
        $rb = [math]::Round(($c.rb - $p.rb) / ($dc / 1e7) / 1MB, 1)
        $wb = [math]::Round(($c.wb - $p.wb) / ($dc / 1e7) / 1MB, 1)
        $out[$n] = @($busy, $queue, $lat, $rb, $wb)
      }
    }
    $prev[$n] = $c
  }
  if ($out.Count -gt 0) { [Console]::Out.WriteLine((@{ t = $t; d = $out } | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds ${intervalMs}
}
`;

/** Строка запасного датчика → отсчёт `{ t, disks }` или `null`, если строка не та. */
export function parseSensorLine(line) {
  try {
    const row = JSON.parse(String(line).trim());
    if (!row || typeof row !== "object" || !row.d) return null;
    const disks = {};
    for (const [name, value] of Object.entries(row.d)) {
      const [busy, queue, latMs, readMBps, writeMBps] = Array.isArray(value)
        ? value
        : [];
      if (Number.isFinite(busy))
        disks[name] = {
          busy,
          queue: Number(queue) || 0,
          latMs: Number(latMs) || 0,
          readMBps: Number(readMBps) || 0,
          writeMBps: Number(writeMBps) || 0,
        };
    }
    return Object.keys(disks).length
      ? { t: Number(row.t) || Date.now(), disks }
      : null;
  } catch {
    return null;
  }
}

function emitter() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(sample) {
      for (const listener of listeners) {
        try {
          listener(sample);
        } catch {
          /* слушатель не должен ронять датчик */
        }
      }
    },
  };
}

/**
 * Запасной датчик: постоянный PowerShell. `spawn` подставляется в тестах. `onFailure` — датчик не поднялся или упал сверх меры (регулятор считает его недоступным).
 */
export function createPowerShellSensor({
  spawn = nodeSpawn,
  intervalMs = SENSOR_INTERVAL_MS,
  parentPid = process.pid,
  onFailure = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const { subscribe, emit } = emitter();
  let child = null;
  let wanted = false;
  let restarts = 0;
  let retry = null;

  function launch() {
    if (child || !wanted) return;
    let proc;
    try {
      proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          SENSOR_SCRIPT(parentPid, intervalMs),
        ],
        {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        },
      );
    } catch {
      onFailure?.("PowerShell не запустился");
      return;
    }
    child = proc;
    let buffer = "";
    proc.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        const sample = parseSensorLine(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (sample) {
          restarts = 0;
          emit(sample);
        }
        at = buffer.indexOf("\n");
      }
    });
    const gone = () => {
      if (child !== proc) return;
      child = null;
      if (!wanted) return;
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        onFailure?.("датчик диска вышел несколько раз подряд");
        return;
      }
      retry = setTimer(() => {
        retry = null;
        launch();
      }, RESTART_DELAY_MS);
      retry?.unref?.();
    };
    proc.once("exit", gone);
    proc.once("error", () => {
      onFailure?.("PowerShell отказал");
      gone();
    });
  }

  return {
    kind: "powershell",
    subscribe,
    start() {
      wanted = true;
      restarts = 0;
      launch();
    },
    stop() {
      wanted = false;
      if (retry) {
        clearTimer(retry);
        retry = null;
      }
      const proc = child;
      child = null;
      try {
        proc?.kill();
      } catch {
        /* уже вышел */
      }
    },
    running: () => child !== null,
  };
}

/**
 * Родной датчик: `native.diskPerformance(буква)` отдаёт накопительные счётчики тома (`{ idleTime, queryTime, queueDepth, readTime, writeTime, readCount, writeCount }`,
 * время в единицах по 100 нс — `DISK_PERFORMANCE`). Раз в `intervalMs` для каждой из `volumes()` считается разность с прошлым отсчётом.
 */
export function createNativeSensor({
  native,
  volumes,
  intervalMs = 1000,
  setTimer = setInterval,
  clearTimer = clearInterval,
  onFailure = null,
} = {}) {
  const { subscribe, emit } = emitter();
  let timer = null;
  const prev = new Map();

  function tick() {
    const disks = {};
    /* Счётчики IOCTL — у физического диска, а не у тома: два тома одного диска дают один и тот же ответ. Склеиваем по номеру устройства (`device`), иначе опоры потолка удвоятся (замечание тестового ПК 20.11). Без номера — по тому, как было. */
    const groups = new Map();
    for (const letter of volumes?.() || []) {
      let now = null;
      try {
        now = native.diskPerformance(letter);
      } catch {
        now = null;
      }
      if (!now) {
        onFailure?.(`том ${letter}: IOCTL_DISK_PERFORMANCE не ответил`);
        continue;
      }
      const device = Number(now.device);
      const id = Number.isFinite(device) ? `D${device}` : `L${letter}`;
      const group = groups.get(id);
      if (group) group.letters.push(letter);
      else
        groups.set(id, {
          now,
          letters: [letter],
          device: Number.isFinite(device) ? device : null,
        });
    }
    for (const [id, { now, letters, device }] of groups) {
      const before = prev.get(id);
      prev.set(id, now);
      if (!before) continue;
      const span = Number(now.queryTime) - Number(before.queryTime);
      if (!(span > 0)) continue;
      const idle = Number(now.idleTime) - Number(before.idleTime);
      const count =
        Number(now.readCount) +
        Number(now.writeCount) -
        Number(before.readCount) -
        Number(before.writeCount);
      const time =
        Number(now.readTime) +
        Number(now.writeTime) -
        Number(before.readTime) -
        Number(before.writeTime);
      const name =
        device === null
          ? `${letters[0]}:`
          : `${device} ${letters.map((letter) => `${letter}:`).join(" ")}`;
      disks[name] = {
        busy: Math.max(0, Math.min(100, 100 - (100 * idle) / span)),
        queue: Number(now.queueDepth) || 0,
        latMs: count > 0 ? time / count / 10000 : 0,
        readMBps:
          Math.max(
            0,
            (Number(now.bytesRead) - Number(before.bytesRead)) /
              1048576 /
              (span / 1e7),
          ) || 0,
        writeMBps:
          Math.max(
            0,
            (Number(now.bytesWritten) - Number(before.bytesWritten)) /
              1048576 /
              (span / 1e7),
          ) || 0,
      };
    }
    if (Object.keys(disks).length) emit({ t: Date.now(), disks });
  }

  return {
    kind: "native",
    subscribe,
    start() {
      if (timer) return;
      prev.clear();
      timer = setTimer(tick, intervalMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
    running: () => timer !== null,
  };
}

/** Лучший датчик из имеющихся: родной (если модуль его знает), иначе запасной; не Windows — `null`. */
export function createDiskSensor({
  native = null,
  volumes = null,
  platform = process.platform,
  spawn = nodeSpawn,
  onFailure = null,
} = {}) {
  if (platform !== "win32") return null;
  if (
    typeof native?.diskPerformance === "function" &&
    typeof volumes === "function"
  )
    return createNativeSensor({ native, volumes, onFailure });
  return createPowerShellSensor({ spawn, onFailure });
}
