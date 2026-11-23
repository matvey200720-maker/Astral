using System.Diagnostics;
using System.Reflection;
using System.Text;

namespace Modovik.Native.Host.Checks;

/// <summary>
/// Свой маленький прогон: каждый метод с [Check("имя")] запускается отдельно, в отчёт идут строки
/// «ok имя» и «FAIL имя» с пояснением. Код выхода 1, если хоть одна проверка не прошла.
/// Ключи: <c>--filter текст</c> — только проверки, в имени которых есть текст; <c>--list</c> — только имена.
/// </summary>
internal static class Program
{
    private sealed record Entry(string Name, MethodInfo Method);

    private static int Main(string[] args)
    {
        var report = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        var checks = Discover();

        var duplicate = checks.GroupBy(c => c.Name).FirstOrDefault(g => g.Count() > 1);
        if (duplicate is not null)
        {
            report.WriteLine($"Два метода с одним именем проверки: {duplicate.Key}");
            return 2;
        }

        string? filter = ArgumentAfter(args, "--filter");
        if (filter is not null)
            checks = checks.Where(c => c.Name.Contains(filter, StringComparison.OrdinalIgnoreCase)).ToList();

        if (args.Contains("--list"))
        {
            foreach (var entry in checks)
                report.WriteLine(entry.Name);
            return 0;
        }

        if (checks.Count == 0)
        {
            report.WriteLine("Не нашлось ни одной проверки.");
            return 2;
        }

        int failed = 0;
        var console = Console.Out;
        try
        {
            foreach (var entry in checks)
            {
                if (!RunOne(entry, report))
                    failed++;
            }
        }
        finally
        {
            Console.SetOut(console);
            Sandbox.Clean();
        }

        report.WriteLine($"Проверок: {checks.Count}, прошло: {checks.Count - failed}, не прошло: {failed}");
        return failed == 0 ? 0 : 1;
    }

    private static bool RunOne(Entry entry, TextWriter report)
    {
        var watch = Stopwatch.StartNew();
        // Соседи печатают в stdout свою трассу ([Export TRACE]): отчёту она не нужна.
        Console.SetOut(new StringWriter());
        try
        {
            entry.Method.Invoke(null, null);
            report.WriteLine($"ok    {entry.Name} ({watch.ElapsedMilliseconds} мс)");
            return true;
        }
        catch (TargetInvocationException wrapper) when (wrapper.InnerException is not null)
        {
            report.WriteLine($"FAIL  {entry.Name}");
            report.WriteLine("    " + Explain(wrapper.InnerException).Replace("\n", "\n    "));
            return false;
        }
    }

    // Не прошедшая проверка говорит своим текстом; любое другое исключение показывается со стеком.
    private static string Explain(Exception error) =>
        error is CheckFailure ? error.Message : $"Проверка упала с исключением: {error}";

    private static List<Entry> Discover() =>
        Assembly.GetExecutingAssembly()
            .GetTypes()
            .SelectMany(type => type.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
            .Select(method => (method, attribute: method.GetCustomAttribute<CheckAttribute>()))
            .Where(pair => pair.attribute is not null)
            .Select(pair => new Entry(pair.attribute!.Name, pair.method))
            .OrderBy(entry => entry.Name, StringComparer.Ordinal)
            .ToList();

    private static string? ArgumentAfter(string[] args, string key)
    {
        int at = Array.IndexOf(args, key);
        return at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
    }
}
