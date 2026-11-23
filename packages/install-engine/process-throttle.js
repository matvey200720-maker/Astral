/*
 * Ограничитель занятости для дочернего процесса, который сам потолков не слышит (20.11.2026, регулятор диска, `disk-governor.js`).
 *
 * Помощник .NET (`rpf-composer.js`: сборки слоя с новым контейнером — мод каталога в слое, «Эффекты», «Вода», арена) пишет архив на 1,9 ГБ без потолка и без отдыха, и в замере 20.11 ровно он
 * держал диск в сотку там, где движок под регулятором уже шёл на 40 %. Править его код ради темпа записи — менять сборку, которую проверяли в игре; поэтому темп задаётся снаружи, так, как это
 * делают программы «ограничить процесс»: процесс по кругу в 200 мс работает долю `scale` и стоит остальное (`NtSuspendProcess` / `NtResumeProcess`). Пока он стоит, он не просит у диска ничего:
 * доля занятости диска от процесса падает в ту же долю, а байты и порядок записи те же.
 *
 * Устройство: один постоянный процесс PowerShell с небольшим кодом на C# (`Add-Type`) ведёт круг и слушает команды в stdin: `add <pid>`, `remove <pid>`, `scale <0,05…1>`, `quit`. Процесс
 * не может остаться стоять:
 *   — конец stdin (приложение вышло или упало) и исчезновение родителя — процесс возобновляет всех и выходит;
 *   — выход самого ограничителя не по команде — `emergencyResume` из JS возобновляет известные номера процессов отдельным вызовом;
 *   — снятие цели (`remove`, выход цели) возобновляет её; доля 1 — тоже.
 * Нет PowerShell, сбой компиляции, нет прав на процесс — ограничителя просто нет, процесс идёт как шёл (`onFailure`).
 */

import { spawn as nodeSpawn } from "node:child_process";

/** Доля работы за круг не ниже этой: процесс не встаёт совсем. */
export const MIN_DUTY = 0.05;
/** Длина круга, мс. */
export const PERIOD_MS = 200;

const SOURCE = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

public static class AstralThrottle {
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr handle);
  [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);

  class Target { public int Pid; public IntPtr Handle; public bool Suspended; }

  static readonly object Gate = new object();
  static readonly Dictionary<int, Target> Targets = new Dictionary<int, Target>();
  static double scale = 1.0;
  static volatile bool stop = false;
  const int PeriodMs = ${PERIOD_MS};
  const uint SuspendResume = 0x0800;

  static void Say(string text) { Console.Out.WriteLine(text); Console.Out.Flush(); }

  static DateTime parentStart = DateTime.MinValue;

  /* Родитель жив, если процесс с этим номером тот же, что был при запуске: номера Windows переиспользует быстро, и «какой-то процесс с тем же номером» родителем не считается. */
  static bool ParentAlive(int parentPid) {
    try { using (Process parent = Process.GetProcessById(parentPid)) { return !parent.HasExited && parent.StartTime == parentStart; } }
    catch (Exception) { return false; }
  }

  static void ResumeOne(Target target) {
    if (!target.Suspended) return;
    NtResumeProcess(target.Handle);
    target.Suspended = false;
  }

  static void ResumeAll() {
    lock (Gate) { foreach (Target target in Targets.Values) ResumeOne(target); }
  }

  static void SuspendAll() {
    List<int> gone = new List<int>();
    lock (Gate) {
      foreach (Target target in Targets.Values) {
        if (target.Suspended) continue;
        if (NtSuspendProcess(target.Handle) == 0) target.Suspended = true; else gone.Add(target.Pid);
      }
      foreach (int pid in gone) { CloseHandle(Targets[pid].Handle); Targets.Remove(pid); }
    }
  }

  static void Drop(int pid) {
    lock (Gate) {
      Target target;
      if (!Targets.TryGetValue(pid, out target)) return;
      ResumeOne(target);
      CloseHandle(target.Handle);
      Targets.Remove(pid);
    }
  }

  static void Commands() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string[] words = line.Trim().Split(' ');
      if (words.Length == 0) continue;
      if (words[0] == "add" && words.Length > 1) {
        int pid; if (!int.TryParse(words[1], out pid)) continue;
        IntPtr handle = OpenProcess(SuspendResume, false, pid);
        if (handle == IntPtr.Zero) { Say("refused " + pid); continue; }
        lock (Gate) { if (!Targets.ContainsKey(pid)) { Target t = new Target(); t.Pid = pid; t.Handle = handle; Targets[pid] = t; } else CloseHandle(handle); }
      } else if (words[0] == "remove" && words.Length > 1) {
        int pid; if (int.TryParse(words[1], out pid)) Drop(pid);
      } else if (words[0] == "scale" && words.Length > 1) {
        double value;
        if (double.TryParse(words[1], NumberStyles.Float, CultureInfo.InvariantCulture, out value)) lock (Gate) { scale = Math.Max(${MIN_DUTY}, Math.Min(1.0, value)); }
      } else if (words[0] == "quit") { break; }
    }
    stop = true;
  }

  public static void Run(int parentPid) {
    timeBeginPeriod(1);
    try { using (Process parent = Process.GetProcessById(parentPid)) { parentStart = parent.StartTime; } }
    catch (Exception) { return; }
    Thread reader = new Thread(Commands);
    reader.IsBackground = true;
    reader.Start();
    Say("ready");
    try {
      while (!stop) {
        if (!ParentAlive(parentPid)) break;
        double share; int count;
        lock (Gate) { share = scale; count = Targets.Count; }
        if (share >= 0.98 || count == 0) { ResumeAll(); Thread.Sleep(50); continue; }
        int run = (int)Math.Round(PeriodMs * share);
        ResumeAll();
        Thread.Sleep(Math.Max(1, run));
        SuspendAll();
        Thread.Sleep(Math.Max(1, PeriodMs - run));
      }
    } finally {
      ResumeAll();
    }
  }

  public static void ResumeProcesses(string pids) {
    foreach (string word in pids.Split(',')) {
      int pid; if (!int.TryParse(word, out pid)) continue;
      IntPtr handle = OpenProcess(SuspendResume, false, pid);
      if (handle == IntPtr.Zero) continue;
      for (int i = 0; i < 4; i += 1) NtResumeProcess(handle);
      CloseHandle(handle);
    }
  }
}
`;

const wrap = (call) => `Add-Type -TypeDefinition @'\n${SOURCE}\n'@\n${call}`;

/** Скрипт ограничителя: C# компилируется `Add-Type`, дальше `Run` ведёт круг до конца stdin. */
export const throttleScript = (parentPid) =>
  wrap(`[AstralThrottle]::Run(${parentPid})`);
/** Скрипт аварийного возврата: возобновляет процессы из списка (несколько раз: счётчик остановок вложенный). */
export const resumeScript = (pids) =>
  wrap(
    `[AstralThrottle]::ResumeProcesses('${pids.filter((pid) => Number.isInteger(pid) && pid > 0).join(",")}')`,
  );

/**
 * Ограничитель процессов. `govern(child)` берёт процесс под круг и отдаёт «отпустить»; `setScale(доля)` — доля работы за круг (1 — без ограничения); `close()` — отпустить всех и выйти.
 * `spawn` и таймеры подставляются в тестах.
 */
export function createProcessThrottle({
  spawn = nodeSpawn,
  platform = process.platform,
  parentPid = process.pid,
  onFailure = null,
  idleMs = 30000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const targets = new Set();
  let proc = null;
  let ready = false;
  let queue = [];
  let scale = 1;
  let sentScale = 1;
  let idleTimer = null;
  let closing = false;

  const send = (line) => {
    if (!proc) return;
    if (!ready) {
      queue.push(line);
      return;
    }
    try {
      proc.stdin.write(`${line}\n`);
    } catch {
      /* труба закрыта: ограничитель уходит сам, возврат — по его выходу */
    }
  };

  function resumeAfterDeath(pids) {
    if (!pids.length) return;
    try {
      const rescue = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          resumeScript(pids),
        ],
        { stdio: "ignore", windowsHide: true },
      );
      rescue?.on?.("error", () => {});
    } catch {
      /* нечем возобновить: ограничитель мёртв, а процесс, если он стоял, добьёт сам приложение при выходе */
    }
  }

  function launch() {
    if (proc || platform !== "win32" || closing) return;
    let child;
    try {
      child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          throttleScript(parentPid),
        ],
        { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
      );
    } catch {
      onFailure?.("PowerShell не запустился");
      return;
    }
    proc = child;
    ready = false;
    child.stdout?.on?.("data", (chunk) => {
      if (ready || !/ready/.test(String(chunk))) return;
      ready = true;
      for (const line of queue) {
        try {
          child.stdin.write(`${line}\n`);
        } catch {
          /* см. send */
        }
      }
      queue = [];
    });
    child.stdin?.on?.("error", () => {});
    child.once("error", () => onFailure?.("ограничитель процессов отказал"));
    child.once("exit", () => {
      if (proc !== child) return;
      proc = null;
      ready = false;
      queue = [];
      sentScale = 1;
      if (!closing && targets.size > 0) {
        resumeAfterDeath([...targets]);
        onFailure?.(
          "ограничитель процессов вышел при живых целях: процессы возобновлены",
        );
      }
    });
  }

  const armIdle = () => {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = null;
    if (targets.size > 0 || !proc) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (targets.size === 0) stopProcess();
    }, idleMs);
    idleTimer?.unref?.();
  };

  function stopProcess() {
    const child = proc;
    proc = null;
    ready = false;
    queue = [];
    sentScale = 1;
    try {
      child?.stdin?.write?.("quit\n");
      child?.stdin?.end?.();
    } catch {
      /* уже закрыт */
    }
  }

  return {
    /** Взять процесс под круг. Ответ — «отпустить» (сам вызывается и по выходу процесса). */
    govern(child) {
      const pid = child?.pid;
      if (platform !== "win32" || !Number.isInteger(pid) || pid <= 0 || closing)
        return () => {};
      launch();
      if (!proc) return () => {};
      targets.add(pid);
      if (idleTimer) {
        clearTimer(idleTimer);
        idleTimer = null;
      }
      send(`add ${pid}`);
      if (scale !== sentScale) {
        send(`scale ${scale}`);
        sentScale = scale;
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (targets.delete(pid)) send(`remove ${pid}`);
        armIdle();
      };
      child.once?.("exit", release);
      return release;
    },
    /** Доля работы за круг: 1 — не ограничивать; не ниже `MIN_DUTY`. Шлётся, только если сменилась заметно. */
    setScale(value) {
      const number = Number(value);
      scale = Number.isFinite(number)
        ? Math.max(MIN_DUTY, Math.min(1, number))
        : 1;
      if (!proc) return;
      if (
        Math.abs(scale - sentScale) < 0.02 &&
        !(scale === 1 && sentScale !== 1)
      )
        return;
      sentScale = scale;
      send(`scale ${scale}`);
    },
    running: () => proc !== null,
    /** Номер процесса-ограничителя (стендам и тестам). */
    pid: () => proc?.pid ?? null,
    targets: () => [...targets],
    /** Отпустить всех и выйти (выход приложения). */
    close() {
      closing = true;
      if (idleTimer) clearTimer(idleTimer);
      idleTimer = null;
      targets.clear();
      stopProcess();
    },
  };
}
