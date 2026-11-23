using System.Diagnostics.CodeAnalysis;

namespace Modovik.Native.Host.Checks;

/// <summary>Метод-проверка: статический, без аргументов; имя — то, что увидит читающий отчёт.</summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class CheckAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

/// <summary>Проверка не прошла; текст исключения идёт в отчёт как есть.</summary>
internal sealed class CheckFailure(string message) : Exception(message);

internal static class Expect
{
    public static void True([DoesNotReturnIf(false)] bool condition, string what)
    {
        if (!condition)
            throw new CheckFailure(what);
    }

    public static void Equal<T>(T expected, T actual, string what)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new CheckFailure($"{what}\n    ожидалось: {Show(expected)}\n    получено:  {Show(actual)}");
    }

    /// <summary>Исключение, как его видит вызывающий: тип и текст в одну строку.</summary>
    public static string Describe(Exception? error) =>
        error is null ? "(исключения нет)" : $"{error.GetType().Name}: {error.Message}";

    /// <summary>Вызывает действие и возвращает исключение, которое оно бросило, или null.</summary>
    public static Exception? Failure(Action action)
    {
        try
        {
            action();
            return null;
        }
        catch (Exception error)
        {
            return error;
        }
    }

    private static string Show<T>(T value)
    {
        string text = value?.ToString() ?? "null";
        return text.Length <= 600 ? text : text[..600] + "…";
    }
}

/// <summary>Временные папки проверок: одна общая корневая, удаляется по окончании прогона.</summary>
internal static class Sandbox
{
    private static readonly string Root =
        Path.Combine(Path.GetTempPath(), "astral-host-checks-" + Guid.NewGuid().ToString("N")[..8]);

    private static int _count;

    public static string Fresh(string label = "w")
    {
        string path = Path.Combine(Root, $"{label}{Interlocked.Increment(ref _count)}");
        Directory.CreateDirectory(path);
        return path;
    }

    public static void Clean()
    {
        try
        {
            if (!Directory.Exists(Root))
                return;
            foreach (string file in Directory.EnumerateFiles(Root, "*", SearchOption.AllDirectories))
                File.SetAttributes(file, FileAttributes.Normal);
            Directory.Delete(Root, true);
        }
        catch (Exception)
        {
            // Временная папка: остаток подберёт чистка системы.
        }
    }
}
