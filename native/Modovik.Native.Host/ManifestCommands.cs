using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// `_manifest.ymf` контейнера — карты и их типы одним файлом.
///
/// Один контейнер слоя Astral — один манифест. Когда набор собирает файлы
/// двух модов (запретные зоны и зелёные зоны — у каждого свой манифест),
/// их зависимости «карта → типы» сводятся сюда: PSO `CPackFileMetaData` со
/// списком `imapDependencies_2`, как у манифестов игры и плашек эмблемы.
///
/// Свои модели мест (ТЗ 11.10.2026, вечер, задача 1): у контейнера места
/// уже бывает манифест — плашек эмблем или самого мода (ангар). Тогда
/// запрос несёт `base` — путь к нему: всё, что в нём было, остаётся как
/// есть (через XML CodeWalker'а), а связи запроса дописываются в
/// `imapDependencies_2` (связь той же карты заменяется).
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class ManifestCommands
{
    private const string RequestFormat = "astral.compile-manifest";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 64 * 1024;
    private const int MaxDependencies = 64;
    private const int MaxBaseBytes = 4 * 1024 * 1024;

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> CompileAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Manifest request must be between 1 byte and 64 KiB.");
        var request = JsonSerializer.Deserialize<ManifestRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Manifest request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Manifest request has an unknown format.");
        var dependencies = request.Dependencies ?? [];
        if (dependencies.Length is 0 or > MaxDependencies)
            throw new InvalidDataException("Manifest needs 1–64 map dependencies.");
        var maps = new HashSet<string>(StringComparer.Ordinal);
        foreach (var dependency in dependencies)
        {
            if (!AssetName.IsMatch(dependency.Map ?? "") || !maps.Add(dependency.Map!))
                throw new InvalidDataException($"Manifest map {dependency.Map} is not valid or repeats.");
            if (dependency.Types is not { Length: > 0 and <= 16 } || dependency.Types.Any(type => !AssetName.IsMatch(type ?? "")))
                throw new InvalidDataException($"Manifest map {dependency.Map} needs 1–16 valid types.");
        }

        var merged = request.Base is null ? null : await MergedDocumentAsync(request.Base, dependencies);
        var document = merged?.Document ?? FreshDocument(dependencies);
        var pso = XmlPso.GetPso(document) ?? throw new InvalidDataException("Manifest PSO was not built.");
        var bytes = pso.Save();

        var path = Path.GetFullPath(output);
        if (!path.EndsWith(".ymf", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Manifest output must be a .ymf file.");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, bytes);

        var manifest = new YmfFile();
        manifest.Load(bytes, new RpfBinaryFileEntry());
        var reopened = manifest.imapDependencies2 ?? [];
        var expectedCount = merged is null ? dependencies.Length : merged.Counts.ImapDependencies2 - merged.Replaced + dependencies.Length;
        if (manifest.Pso is null || reopened.Length != expectedCount)
            throw new InvalidDataException("Compiled _manifest.ymf failed semantic reopen.");
        /* Всё прочее из основы — на месте: группы карт, связи первой версии, типов, привязки словарей, интерьеры. */
        if (merged is not null && CountsOf(manifest) with { ImapDependencies2 = 0 } != merged.Counts with { ImapDependencies2 = 0 })
            throw new InvalidDataException("Compiled _manifest.ymf lost entries of its base.");
        for (var index = 0; index < dependencies.Length; index += 1)
        {
            var expected = dependencies[index];
            var got = reopened.FirstOrDefault(item => item.Dep.imapName.Hash == JenkHash.GenHash(expected.Map!));
            if (got is null) throw new InvalidDataException($"Compiled _manifest.ymf lost the dependency of {expected.Map}.");
            if (got.Dep.imapName.Hash != JenkHash.GenHash(expected.Map!) ||
                got.itypDepArray?.Length != expected.Types!.Length ||
                expected.Types.Where((type, at) => got.itypDepArray[at].Hash != JenkHash.GenHash(type)).Any())
                throw new InvalidDataException($"Compiled _manifest.ymf lost the dependency of {expected.Map}.");
        }
        return new
        {
            file = Path.GetFileName(path),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new { semanticReopen = true, imapDependencies = reopened.Length, kept = merged?.Counts, replaced = merged?.Replaced ?? 0 },
        };
    }

    private static XmlDocument FreshDocument(ManifestDependency[] dependencies)
    {
        var xml = new StringBuilder();
        xml.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CPackFileMetaData>\n <MapDataGroups />\n <HDTxdBindingArray />\n <imapDependencies />\n <imapDependencies_2>\n");
        foreach (var dependency in dependencies)
        {
            xml.Append("  <Item>\n   <imapName>").Append(dependency.Map).Append("</imapName>\n   <manifestFlags />\n   <itypDepArray>\n");
            foreach (var type in dependency.Types!) xml.Append("    <Item>").Append(type).Append("</Item>\n");
            xml.Append("   </itypDepArray>\n  </Item>\n");
        }
        xml.Append(" </imapDependencies_2>\n <itypDependencies_2 />\n <Interiors />\n</CPackFileMetaData>\n");
        var document = new XmlDocument();
        document.LoadXml(xml.ToString());
        return document;
    }

    private sealed record ManifestCounts(int MapDataGroups, int ImapDependencies, int ImapDependencies2, int ItypDependencies2, int HdTxdBindings, int Interiors);

    private static ManifestCounts CountsOf(YmfFile file) => new(
        file.MapDataGroups?.Length ?? 0,
        file.imapDependencies?.Length ?? 0,
        file.imapDependencies2?.Length ?? 0,
        file.itypDependencies2?.Length ?? 0,
        file.HDTxdAssetBindings?.Length ?? 0,
        file.Interiors?.Length ?? 0);

    private sealed record MergedManifest(XmlDocument Document, ManifestCounts Counts, int Replaced);

    /* Имя карты в XML CodeWalker'а: само имя или `hash_XXXXXXXX`. */
    private static uint NameHash(string? text)
    {
        var value = (text ?? "").Trim();
        if (value.StartsWith("hash_", StringComparison.OrdinalIgnoreCase) &&
            uint.TryParse(value.AsSpan(5), System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var hash))
            return hash;
        return JenkHash.GenHash(value.ToLowerInvariant());
    }

    /* Манифест контейнера, что уже есть, — XML CodeWalker'а плюс связи запроса. */
    private static async Task<MergedManifest> MergedDocumentAsync(string basePath, ManifestDependency[] dependencies)
    {
        var path = Path.GetFullPath(basePath);
        var info = new FileInfo(path);
        if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is 0 or > MaxBaseBytes ||
            !path.EndsWith(".ymf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Manifest base must be an existing .ymf file up to 4 MiB.");
        var baseBytes = await File.ReadAllBytesAsync(path);
        var existing = new YmfFile();
        existing.Load(baseBytes, new RpfBinaryFileEntry());
        if (existing.Pso is null) throw new InvalidDataException("Manifest base is not a PSO _manifest.ymf.");
        /* Свои имена — в словарь хешей: в XML они встанут словами. */
        foreach (var dependency in dependencies)
        {
            JenkIndex.Ensure(dependency.Map!);
            foreach (var type in dependency.Types!) JenkIndex.Ensure(type);
        }
        var document = new XmlDocument();
        document.LoadXml(PsoXml.GetXml(existing.Pso));
        var root = document.DocumentElement ?? throw new InvalidDataException("Manifest base has no root.");
        var list = root.SelectSingleNode("imapDependencies_2") as XmlElement;
        if (list is null)
        {
            list = document.CreateElement("imapDependencies_2");
            root.AppendChild(list);
        }
        var replaced = 0;
        foreach (var dependency in dependencies)
        {
            /* Связь той же карты (прошлая установка) — заменяется. */
            var hash = JenkHash.GenHash(dependency.Map!);
            foreach (var old in list.ChildNodes.OfType<XmlElement>().Where(item => NameHash(item.SelectSingleNode("imapName")?.InnerText) == hash).ToArray())
            {
                list.RemoveChild(old);
                replaced += 1;
            }
            var item = document.CreateElement("Item");
            var name = document.CreateElement("imapName");
            name.InnerText = dependency.Map!;
            item.AppendChild(name);
            item.AppendChild(document.CreateElement("manifestFlags"));
            var types = document.CreateElement("itypDepArray");
            foreach (var type in dependency.Types!)
            {
                var entry = document.CreateElement("Item");
                entry.InnerText = type;
                types.AppendChild(entry);
            }
            item.AppendChild(types);
            list.AppendChild(item);
        }
        return new MergedManifest(document, CountsOf(existing), replaced);
    }

    private sealed record ManifestDependency(string? Map = null, string[]? Types = null);

    private sealed record ManifestRequest(string Format, int Version, ManifestDependency[]? Dependencies = null, string? Base = null);
}
