using System.Buffers;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Modovik.Native.Host;

/// <summary>
/// Ход долгой команды отдельным каналом: строки JSON в stderr (stdout остаётся за итогом).
/// Строки одного шага идут не чаще раза в 200 мс, но смена шага и конец шага не теряются.
/// </summary>
internal sealed class HostProgress
{
    private const long WindowMs = 200;
    private const int CopyBufferSize = 4 * 1024 * 1024;

    /// <summary>Последняя записанная строка хода: её шаг и момент по часам объекта.</summary>
    private readonly record struct LastLine(string? Phase, long AtMs);

    private readonly Func<long> _elapsedMs;
    private readonly object _gate = new();

    // До первого вызова окно уже открыто: «последняя строка» была 200 мс назад.
    private LastLine _last = new(null, -WindowMs);

    public HostProgress()
        : this(StartClock())
    {
    }

    /// <summary>Свои часы нужны только проверкам: так границы окна не зависят от настоящего времени.</summary>
    internal HostProgress(Func<long> elapsedMs)
    {
        _elapsedMs = elapsedMs;
    }

    public void Report(string phase) => Report(phase, done: 0, total: 0);

    public void Report(string phase, long done, long total)
    {
        bool phaseFinished = total > 0 && done >= total;

        // Под замком и решение, и запись: строки уходят в том же порядке, в каком менялось состояние.
        lock (_gate)
        {
            long now = _elapsedMs();
            if (!IsDue(_last, phase, phaseFinished, now))
                return;

            // Состояние обновляется до записи: потерянная строка не повторяется.
            _last = new LastLine(phase, now);
            Emit(FormatLine(phase, done, total));
        }
    }

    /// <summary>
    /// Копирует файл и за тот же проход чтения считает SHA-256 источника (64 прописные цифры).
    /// При сбое файл назначения не остаётся: у недописанной копии уже полная длина, и по размеру
    /// её не отличить от целой.
    /// </summary>
    public static async Task<string> CopyWithHashAsync(string source, string destination, Action<long> copied)
    {
        bool destinationIsOurs = false;
        try
        {
            string digest;

            // Оба файла закрываются на выходе из блока, до выставления времени и до удаления недокопии.
            await using (var reader = OpenForCopy(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            await using (var writer = OpenForCopy(destination, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                // Назначение открыто, прежнее содержимое усечено: с этой минуты файл наш.
                destinationIsOurs = true;
                writer.SetLength(reader.Length);
                digest = await Pump(reader, writer, copied);
            }

            // Архив, положенный обратно после отката, должен выглядеть тем же файлом.
            File.SetLastWriteTimeUtc(destination, File.GetLastWriteTimeUtc(source));
            return digest;
        }
        catch
        {
            // Чужой файл, который не удалось открыть на запись, не трогается: убирается только своя недокопия.
            if (destinationIsOurs)
                DiscardPartial(destination);
            throw;
        }
    }

    // Решение «писать ли строку»: чистая функция от прошлой строки и текущего вызова.
    private static bool IsDue(LastLine last, string? phase, bool phaseFinished, long now) =>
        (string.Equals(phase, last.Phase, StringComparison.Ordinal), phaseFinished, now - last.AtMs) switch
        {
            (false, _, _) => true,
            (_, true, _) => true,
            (_, _, >= WindowMs) => true,
            _ => false,
        };

    private static void Emit(string line)
    {
        try
        {
            Console.Error.WriteLine(line);
        }
        catch (Exception e) when (e is IOException)
        {
            // Канал закрыт: ход не важнее самой команды.
        }
    }

    private static Func<long> StartClock()
    {
        var watch = Stopwatch.StartNew();
        return () => watch.ElapsedMilliseconds;
    }

    private static string FormatLine(string? phase, long done, long total)
    {
        var buffer = new ArrayBufferWriter<byte>(128);
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            json.WriteStartObject("progress");
            json.WriteString("phase", phase);
            json.WriteNumber("copiedBytes", done);
            json.WriteNumber("totalBytes", total);
            json.WriteEndObject();
            json.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    // ---- копирование ----

    private static FileStream OpenForCopy(string path, FileMode mode, FileAccess access, FileShare share) =>
        new(path, mode, access, share, CopyBufferSize, useAsync: true);

    // Один проход по источнику: каждый кусок идёт и в хеш, и в приёмник, а число записанных байт — в колбэк.
    private static async Task<string> Pump(Stream from, Stream to, Action<long> copied)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long written = 0;
        await foreach (var piece in ReadPieces(from))
        {
            hash.AppendData(piece.Span);
            await to.WriteAsync(piece);
            written += piece.Length;
            copied(written);
        }

        return Convert.ToHexString(hash.GetHashAndReset());
    }

    // Удаление не должно скрыть ту ошибку, из-за которой оно понадобилось: не вышло — файл остаётся.
    private static void DiscardPartial(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception)
        {
            // Исходное исключение важнее: наружу выйдет оно, а не ошибка удаления.
        }
    }

    // Куски до CopyBufferSize байт; один и тот же буфер, поэтому кусок нужно использовать до следующего шага.
    private static async IAsyncEnumerable<ReadOnlyMemory<byte>> ReadPieces(Stream stream)
    {
        var buffer = new byte[CopyBufferSize];
        for (int count = await stream.ReadAsync(buffer); count > 0; count = await stream.ReadAsync(buffer))
            yield return buffer.AsMemory(0, count);
    }
}
