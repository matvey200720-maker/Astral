using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RageLib.Archives;
using RageLib.GTA5.ArchiveWrappers;
using RageLib.GTA5.Cryptography;

namespace Modovik.Native.Host;

/// <summary>
/// Файлы из чужого архива в папку: выкладка выбранных записей и декодирование
/// их содержимого (NG-шифрование и deflate снимаются). Отпечаток архива целиком
/// и разбор content.xml делает Rust-движок (`index-archive`).
/// </summary>
internal static class ArchiveIndexCommands
{
    /// Глубина вложенных архивов. В `update.rpf` ресурсы лежат на два-три
    /// уровня (`x64/data/cdimages/scaleform_generic.rpf/hud.gfx`); шесть —
    /// с запасом на авторские контейнеры внутри авторских.
    private const int MaxDepth = 6;

    /// <summary>
    /// Достаёт названные записи из произвольного архива в папку.
    ///
    /// Разбор нашёл находку — чтобы собрать из неё пакет, её файлы надо вынуть.
    /// Вынимается то же декодированное содержимое, по которому считался
    /// отпечаток, и его SHA-256 возвращается рядом: вызывающий сверяет его с
    /// тем, что видел в разборе, и не положит в пакет подменённый файл.
    /// </summary>
    public static object Extract(string archivePath, string outputDirectory, IReadOnlyList<string> wanted)
    {
        if (wanted.Count == 0)
            throw new ArgumentException("At least one --entry is required.");
        if (wanted.Count > 5000)
            throw new ArgumentException("Too many entries in one extraction.");

        var pending = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in wanted)
        {
            var normalized = item.Replace(BackSlash, ForwardSlash).Trim().TrimStart(ForwardSlash);
            if (normalized.Length == 0) continue;
            pending[normalized] = item;
        }

        Directory.CreateDirectory(outputDirectory);
        var written = new List<object>();

        using (var archive = RageArchiveWrapper7.OpenRead(archivePath))
        {
            Collect(archive.Root, "", 0, pending, outputDirectory, written);
        }

        return new
        {
            archive = archivePath,
            outputDirectory,
            requested = wanted.Count,
            extracted = written.Count,
            missing = pending.Values.ToArray(),
            files = written,
        };
    }

    private const char BackSlash = (char)92;
    private const char ForwardSlash = (char)47;

    private static void Collect(
        IArchiveDirectory directory,
        string prefix,
        int depth,
        Dictionary<string, string> pending,
        string outputDirectory,
        List<object> written)
    {
        if (pending.Count == 0) return;

        foreach (var file in directory.GetFiles())
        {
            if (pending.Count == 0) return;
            var path = prefix + file.Name;

            // Контейнер целиком просят тогда, когда он и есть мод: `minimap.rpf`
            // большой карты ставится в игру одним файлом, а не по записям. Такой
            // контейнер отдаётся байтами, как лежит, и внутрь не разбирается.
            var wholeContainer = file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase) &&
                pending.ContainsKey(path);

            if (!wholeContainer &&
                file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase) &&
                depth < MaxDepth &&
                file is IArchiveBinaryFile container)
            {
                try
                {
                    using var stream = container.GetStream();
                    using var inner = RageArchiveWrapper7.Open(stream, file.Name, leaveOpen: true);
                    Collect(inner.Root, path + "/", depth + 1, pending, outputDirectory, written);
                    continue;
                }
                catch
                {
                    // Нечитаемый контейнер остаётся обычной записью.
                }
            }

            if (!pending.Remove(path)) continue;

            var bytes = DecodedBytes(file);
            // Имя на диске — плоское и производное от пути: две записи с
            // одинаковым именем из разных папок не должны перетереть друг друга.
            var safe = new string(path
                .Select(ch => char.IsLetterOrDigit(ch) || ch == '.' || ch == '-' || ch == '_' || ch == '+' ? ch : '_')
                .ToArray());
            if (safe.Length > 120) safe = safe.Substring(safe.Length - 120);
            var destination = Path.Combine(outputDirectory, safe);
            File.WriteAllBytes(destination, bytes);
            written.Add(new
            {
                entry = path,
                file = Path.GetFileName(destination),
                size = bytes.LongLength,
                sha256 = Hash(bytes),
            });
        }

        foreach (var child in directory.GetDirectories())
            Collect(child, prefix + child.Name + "/", depth, pending, outputDirectory, written);
    }

    /// <summary>
    /// Содержимое записи как его видит игра: снятые NG-шифрование и deflate.
    /// Та же последовательность, что в `RpfDiffEngine`, — иначе отпечатки
    /// разбора и отпечатки индекса не сошлись бы между собой.
    /// </summary>
    internal static byte[] DecodedBytes(IArchiveFile file)
    {
        using var buffer = new MemoryStream();
        file.Export(buffer);
        var raw = buffer.ToArray();

        if (file is not IArchiveBinaryFile binary)
        {
            NormalizeResourceMagic(raw);
            return raw;
        }

        if (binary.IsEncrypted)
        {
            var hash = GTA5Hash.CalculateHash(binary.Name);
            var index = (hash + (uint)binary.UncompressedSize + (101 - 40)) % 0x65;
            var key = GTA5Constants.PC_NG_KEYS is { Length: > 0 } keys && keys.Length > index
                ? keys[index]
                : null;
            if (key is not { Length: > 0 })
                throw new InvalidDataException($"No NG key for {binary.Name}.");
            raw = GTA5Crypto.Decrypt(raw, key);
        }

        if (binary.IsCompressed)
        {
            using var deflate = new DeflateStream(new MemoryStream(raw), CompressionMode.Decompress);
            using var expanded = new MemoryStream();
            deflate.CopyTo(expanded);
            return expanded.ToArray();
        }

        return raw;
    }

    /// <summary>
    /// Ресурсные записи (`RSC7`) экспортируются с маркером версии в четвёртом
    /// байте. У одного и того же ресурса он отличается между сборками архива,
    /// поэтому приводится к общему виду — как в `RpfDiffEngine`.
    /// </summary>
    private static void NormalizeResourceMagic(byte[] data)
    {
        if (data.Length < 4) return;
        if (data[0] == 0x52 && data[1] == 0x53 && data[2] == 0x43 && data[3] == 0x07)
            data[3] = 0x37;
    }

    private static string Hash(byte[] data) =>
        Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

}
