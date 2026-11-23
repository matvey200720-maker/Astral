using System.Security.Cryptography;

namespace Modovik.Native.Host.Checks;

/// <summary>HostProgress.CopyWithHashAsync: что остаётся на диске при сбое и что не меняется при успехе.</summary>
internal static class CopyChecks
{
    private const int Chunk = 4 * 1024 * 1024;

    private static byte[] Noise(int count, uint seed)
    {
        var bytes = new byte[count];
        uint x = seed;
        for (int i = 0; i < count; i++)
        {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            bytes[i] = (byte)x;
        }

        return bytes;
    }

    private static string WriteSource(string dir, int size, uint seed = 0xC0FFEE01, string name = "src.bin")
    {
        string path = Path.Combine(dir, name);
        File.WriteAllBytes(path, Noise(size, seed));
        return path;
    }

    private static (string? Hash, Exception? Error) Attempt(string source, string destination, Action<long>? copied)
    {
        try
        {
            return (HostProgress.CopyWithHashAsync(source, destination, copied!).GetAwaiter().GetResult(), null);
        }
        catch (Exception error)
        {
            return (null, error);
        }
    }

    private static string Note(string path) =>
        File.Exists(path) ? $"файл есть, {new FileInfo(path).Length} байт" : "файла нет";

    private static string LeftoverText(string path) =>
        $"после сбоя в назначении остался файл ({Note(path)}): длина уже выставлена, нули в конце выглядят как целая копия";

    [Check("CopyWithHashAsync: сбой колбэка на первом куске не оставляет файл назначения")]
    public static void CallbackFailsOnFirstChunk()
    {
        string dir = Sandbox.Fresh();
        string source = WriteSource(dir, 6 * 1024 * 1024 + 5);
        string destination = Path.Combine(dir, "dst.bin");
        int calls = 0;

        var (_, error) = Attempt(source, destination, _ =>
        {
            calls++;
            throw new InvalidOperationException("stop");
        });

        Expect.Equal("InvalidOperationException: stop", Expect.Describe(error), "исключение колбэка выходит наружу тем же типом и текстом");
        Expect.Equal(1, calls, "колбэк вызван один раз");
        Expect.True(!File.Exists(destination), LeftoverText(destination));
    }

    [Check("CopyWithHashAsync: сбой колбэка на втором куске не оставляет файл назначения")]
    public static void CallbackFailsOnSecondChunk()
    {
        string dir = Sandbox.Fresh();
        string source = WriteSource(dir, 10 * 1024 * 1024);
        string destination = Path.Combine(dir, "dst.bin");
        int calls = 0;

        var (_, error) = Attempt(source, destination, _ =>
        {
            if (++calls == 2)
                throw new InvalidOperationException("stop2");
        });

        Expect.Equal("InvalidOperationException: stop2", Expect.Describe(error), "исключение колбэка выходит наружу тем же типом и текстом");
        Expect.Equal(2, calls, "колбэк вызван дважды");
        Expect.True(!File.Exists(destination), LeftoverText(destination));
    }

    [Check("CopyWithHashAsync: сбой убирает и прежний файл назначения, который уже перезаписан")]
    public static void FailureRemovesOverwrittenDestination()
    {
        string dir = Sandbox.Fresh();
        string source = WriteSource(dir, 5 * 1024 * 1024);
        string destination = Path.Combine(dir, "dst.bin");
        File.WriteAllBytes(destination, Noise(1000, 7));

        var (_, error) = Attempt(source, destination, _ => throw new IOException("диск отказал"));

        Expect.Equal("IOException: диск отказал", Expect.Describe(error), "исключение выходит наружу тем же типом и текстом");
        Expect.True(!File.Exists(destination), LeftoverText(destination));
    }

    [Check("CopyWithHashAsync: колбэк null на непустом файле — NullReferenceException и нет файла назначения")]
    public static void NullCallbackOnNonEmptyFile()
    {
        string dir = Sandbox.Fresh();
        string source = WriteSource(dir, 100);
        string destination = Path.Combine(dir, "dst.bin");

        var (_, error) = Attempt(source, destination, null);

        Expect.True(error is NullReferenceException, $"ожидалось NullReferenceException, получено {Expect.Describe(error)}");
        Expect.True(!File.Exists(destination), LeftoverText(destination));
    }

    [Check("CopyWithHashAsync: сбой удаления не прячет исходное исключение")]
    public static void CleanupFailureDoesNotMaskTheOriginalError()
    {
        string dir = Sandbox.Fresh();
        string source = WriteSource(dir, 5 * 1024 * 1024);
        string destination = Path.Combine(dir, "dst.bin");

        // Файл «только для чтения» не удаляется: удаление упадёт с UnauthorizedAccessException.
        var (_, error) = Attempt(source, destination, _ =>
        {
            File.SetAttributes(destination, FileAttributes.ReadOnly);
            throw new InvalidOperationException("stop");
        });

        Expect.Equal("InvalidOperationException: stop", Expect.Describe(error), "наружу должно выйти исходное исключение, а не ошибка удаления");
    }

    [Check("CopyWithHashAsync: успешная копия — хеш, содержимое, время изменения, вызовы колбэка")]
    public static void SuccessfulCopyIsUnchanged()
    {
        string dir = Sandbox.Fresh();
        int size = Chunk + 123;
        string source = WriteSource(dir, size);
        var stamp = new DateTime(2020, 1, 2, 3, 4, 5, 678, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(source, stamp);
        string destination = Path.Combine(dir, "dst.bin");
        var calls = new List<long>();
        var lengths = new List<long>();

        var (hash, error) = Attempt(source, destination, copied =>
        {
            calls.Add(copied);
            lengths.Add(new FileInfo(destination).Length);
        });

        Expect.Equal("(исключения нет)", Expect.Describe(error), "успешная копия не бросает");
        byte[] content = File.ReadAllBytes(source);
        Expect.Equal(Convert.ToHexString(SHA256.HashData(content)), hash!, "хеш источника, 64 прописные цифры");
        Expect.True(File.ReadAllBytes(destination).AsSpan().SequenceEqual(content), "копия равна источнику побайтно");
        Expect.Equal(stamp, File.GetLastWriteTimeUtc(destination), "время изменения копии равно времени источника");
        Expect.Equal($"{Chunk},{size}", string.Join(",", calls), "вызовы колбэка с накопленными байтами");
        Expect.True(lengths.All(length => length == size), "длина назначения выставлена заранее и равна размеру источника");
    }

    [Check("CopyWithHashAsync: назначение, которое не удалось открыть, остаётся нетронутым")]
    public static void UnopenableDestinationIsLeftAlone()
    {
        string dir = Sandbox.Fresh();
        string source = WriteSource(dir, 100);
        string readOnly = Path.Combine(dir, "ro.bin");
        File.WriteAllBytes(readOnly, new byte[3]);
        File.SetAttributes(readOnly, FileAttributes.ReadOnly);

        var (_, denied) = Attempt(source, readOnly, _ => { });
        Expect.True(denied is UnauthorizedAccessException, $"ожидалось UnauthorizedAccessException, получено {Expect.Describe(denied)}");
        Expect.True(File.Exists(readOnly) && new FileInfo(readOnly).Length == 3, $"чужой файл «только чтение» не трогаем: {Note(readOnly)}");

        // Источника нет: назначение не открывается вовсе, прежний файл цел.
        string existing = Path.Combine(dir, "existing.bin");
        File.WriteAllBytes(existing, new byte[5]);
        var (_, missing) = Attempt(Path.Combine(dir, "nope.bin"), existing, _ => { });
        Expect.True(missing is FileNotFoundException, $"ожидалось FileNotFoundException, получено {Expect.Describe(missing)}");
        Expect.True(File.Exists(existing) && new FileInfo(existing).Length == 5, $"файл назначения не тронут, если источник не открылся: {Note(existing)}");
    }
}
