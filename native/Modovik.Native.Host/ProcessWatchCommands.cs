using System.Diagnostics;
using System.Text.Json;

namespace Modovik.Native.Host;

/// <summary>
/// Дозор процессов игры — для способа «Моды при запуске игры» у копии из
/// Rockstar Games Launcher (задача 7, 05.10.2026).
///
/// Лаунчер Rockstar при каждом запуске сверяет файлы игры и возвращает свой
/// <c>update.rpf</c>. Поэтому, пока игра закрыта, в папке лежит оригинал, а
/// архив с модами Astral подставляет в тот миг, когда появился процесс
/// <c>GTA5.exe</c> (проверка лаунчера уже прошла), и убирает после выхода.
/// Окно между стартом процесса и чтением архива узкое: <c>tasklist</c> из
/// Electron тратит 200 мс на снимок, здесь снимок стоит доли миллисекунды,
/// и опрос идёт каждые <c>--interval</c> мс (по умолчанию 50).
///
/// Команда долгая: события уходят строками <c>{"process":{...}}</c> в stderr
/// (как ход установки), stdout остаётся за итогом. Дозор живёт, пока открыт
/// stdin: Electron закрыл канал или умер — хост выходит сам.
/// </summary>
internal static class ProcessWatchCommands
{
    public static async Task<object> WatchAsync(IReadOnlyList<string> names, string? interval)
    {
        if (names.Count == 0) throw new ArgumentException("At least one --name is required.");
        var wanted = names
            .Select(name => Path.GetFileNameWithoutExtension(name.Trim()))
            .Where(name => name.Length > 0 && name.All(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-' or '.'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (wanted.Length == 0) throw new ArgumentException("No valid process names.");
        var period = Math.Clamp(int.TryParse(interval, out var parsed) ? parsed : 50, 10, 2000);
        var known = new Dictionary<int, (string Name, string? Path)>();
        /* Пока игра идёт (02.11.2026): её выход ждётся по дескриптору процесса, а не опросом.
           Моды уже стоят, поэтому новые процессы игры (BattlEye → GTA5.exe) снимок ищет раз в
           секунду, а не раз в 50 мс; выход любого — сразу круг снимка (передача от одного
           процесса игры другому видна до «exit», как и раньше). Дескриптор не открылся
           (защищённый процесс) — опрос 50 мс, как было. */
        var exits = new Dictionary<int, (Process Handle, Task Exited)>();
        var stdinClosed = Task.Run(async () =>
        {
            using var input = Console.OpenStandardInput();
            var buffer = new byte[256];
            while (await input.ReadAsync(buffer) > 0) { }
        });
        Emit(new { @event = "ready", names = wanted, interval = period });
        var events = 0;
        while (!stdinClosed.IsCompleted)
        {
            var seen = new HashSet<int>();
            /* Один снимок системы на круг (02.11.2026): `GetProcessesByName` снимает все процессы
               заново для каждого имени, и четыре имени раз в 50 мс стоили ~30 % ядра в простое,
               пока открыт Astral (`scripts/perf/baseline/process-watch-cost.mjs`; с одним снимком — ~11 %).
               Снимок Toolhelp вышел дороже (~17 %): время уходит в ядро, а не в объекты .NET. */
            Process[] all;
            try
            {
                all = Process.GetProcesses();
            }
            catch (InvalidOperationException)
            {
                all = [];
            }
            foreach (var process in all)
            {
                using (process)
                {
                    string? name;
                    try
                    {
                        var own = process.ProcessName;
                        name = Array.Find(wanted, item => string.Equals(item, own, StringComparison.OrdinalIgnoreCase));
                    }
                    catch (InvalidOperationException)
                    {
                        continue;
                    }
                    if (name is null) continue;
                    /* Вышедший процесс, который ещё держит наш дескриптор, снимок может видеть — он ушёл. */
                    if (exits.TryGetValue(process.Id, out var held) && held.Exited.IsCompleted) continue;
                    seen.Add(process.Id);
                    if (known.ContainsKey(process.Id)) continue;
                    var image = FreshImagePath(process);
                    known[process.Id] = (name, image);
                    events += 1;
                    Emit(new { @event = "start", name = $"{name}.exe", pid = process.Id, path = image });
                    var waiter = ExitWaiter(process.Id);
                    if (waiter is not null) exits[process.Id] = waiter.Value;
                }
            }
            foreach (var gone in known.Keys.Where(pid => !seen.Contains(pid)).ToArray())
            {
                var (name, image) = known[gone];
                known.Remove(gone);
                if (exits.Remove(gone, out var waiter)) waiter.Handle.Dispose();
                events += 1;
                Emit(new { @event = "exit", name = $"{name}.exe", pid = gone, path = image });
            }
            /* Все идущие процессы игры ждутся дескриптором — круг раз в секунду; иначе обычный опрос. */
            var waited = known.Count > 0 && known.Keys.All(exits.ContainsKey);
            var wake = new List<Task> { stdinClosed, Task.Delay(waited ? Math.Max(period, RunningPeriodMs) : period) };
            if (waited) wake.AddRange(exits.Values.Select(item => item.Exited));
            await Task.WhenAny(wake);
        }
        foreach (var waiter in exits.Values) waiter.Handle.Dispose();
        return new { stopped = true, events };
    }

    /* Круг снимка, пока игра идёт и её выход ждётся дескриптором. */
    private const int RunningPeriodMs = 1000;

    /* Дескриптор процесса и задача его выхода; `null` — не открыть (нет прав, уже вышел). */
    private static (Process Handle, Task Exited)? ExitWaiter(int pid)
    {
        Process? handle = null;
        try
        {
            handle = Process.GetProcessById(pid);
            var exited = handle.WaitForExitAsync();
            if (exited.IsCompleted && !handle.HasExited) throw new InvalidOperationException();
            return (handle, exited);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
        {
            handle?.Dispose();
            return null;
        }
    }

    /* Путь образа своего процесса — с запасом: объект из общего снимка путь отдаёт не всегда. */
    private static string? FreshImagePath(Process process)
    {
        var image = ImagePath(process);
        if (image is not null) return image;
        try
        {
            using var fresh = Process.GetProcessById(process.Id);
            return ImagePath(fresh);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /* Путь образа: у процесса другого пользователя или с повышенными правами его не прочесть. */
    private static string? ImagePath(Process process)
    {
        try
        {
            return process.MainModule?.FileName;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or NotSupportedException)
        {
            return null;
        }
    }

    private static void Emit(object value)
    {
        try
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new { process = value }, Program.JsonOptions));
            Console.Error.Flush();
        }
        catch (IOException)
        {
            // Канал закрыт — Electron больше не слушает, дозор выйдет по stdin.
        }
    }
}
