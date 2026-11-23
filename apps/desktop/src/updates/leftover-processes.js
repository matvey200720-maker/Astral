/*
 * Что ещё запущено из папки `app\`, когда лаунчер уходит ради обновления.
 *
 * Хелпер ждёт выхода только главного процесса, а разовая команда `astral-engine.exe` живёт своей
 * жизнью и доделывает начатое ещё минуты. Windows не даёт переименовать папку с запущенным файлом:
 * 31.10.2026 хелпер прождал 28 с и показал «Закройте Astral», хотя окна уже не было. Такой процесс
 * работает только на этот запуск лаунчера, его результат всё равно некому принять, поэтому снимаем.
 */
import { execFile } from "node:child_process";
import path from "node:path";

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = $env:ASTRAL_SWEEP_ROOT.TrimEnd('\\') + '\\'
$self = [int]$env:ASTRAL_SWEEP_SELF
$found = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $self -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
}
foreach ($item in $found) {
  $stopped = $true
  try { Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop } catch { $stopped = $false }
  Write-Output ('{0} {1} {2}' -f $item.ProcessId, $(if ($stopped) { 'stopped' } else { 'denied' }), $item.Name)
}
`;

/** Строки вида `4404 stopped astral-engine.exe` → записи. */
export function parseSweep(output) {
  const rows = [];
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const match = /^(\d+) (stopped|denied) (.+)$/.exec(line.trim());
    if (match) rows.push({ pid: Number(match[1]), stopped: match[2] === "stopped", name: match[3] });
  }
  return rows;
}

/** Снять всё, что запущено из `appDir`, кроме самого лаунчера. Сбой не мешает выходу: `[]`. */
export function stopLeftoverProcesses({
  appDir,
  selfPid = process.pid,
  platform = process.platform,
  run = execFile,
  env = process.env,
  timeoutMs = 8_000,
} = {}) {
  if (platform !== "win32" || !appDir) return Promise.resolve([]);
  return new Promise((resolve) => {
    run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT],
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: "utf8",
        /* Путь — переменной окружения: в нём кириллица и пробелы. */
        env: { ...env, ASTRAL_SWEEP_ROOT: path.resolve(appDir), ASTRAL_SWEEP_SELF: String(selfPid) },
      },
      (_error, stdout) => resolve(parseSweep(stdout)),
    );
  });
}
