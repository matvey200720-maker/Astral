using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Свои маленькие словари текстур — `pack-textures` (задача 10 ТЗ 10.10.2026).
///
/// Полотна у арок GTA 5 RP — 18 своих моделей с одним листом общего словаря
/// стадиона. Чтобы у каждого полотна была своя картинка, полотну даётся свой
/// словарь из этого одного листа (`astral_arenas_bNN.ytd`), а его архетип в
/// типах района смотрит на новый словарь. Копировать ради этого весь словарь
/// стадиона (2,4 МБ на полотно) незачем: здесь словарь собирается из нужных
/// листов — каждый из своего DDS, а имя, хеш имени и флаги использования
/// берутся у штатного листа (`source` + `from`), чтобы игра нашла и прочла
/// лист так же, как штатный.
///
/// Запрос: `{ format: "astral.pack-textures", version: 1, dictionaries: [{
/// name, textures: [{ name, dds, source?, from? }] }] }`; ответ — словари в
/// папке `output` (`&lt;name&gt;.ytd`) с размером и SHA-256. Каждый словарь
/// после записи открывается заново и сверяется по именам листов.
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class TextureDictionaryCommands
{
    private const string RequestFormat = "astral.pack-textures";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 256 * 1024;
    private const int MaxDictionaries = 64;
    private const int MaxTextures = 64;
    private const long MaxDdsBytes = 32L * 1024 * 1024;
    private const long MaxSourceBytes = 96L * 1024 * 1024;

    private static readonly Regex DictionaryName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);
    private static readonly Regex TextureName = new("^[a-z0-9_.+-]{1,160}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> PackAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Pack-textures request must be between 1 byte and 256 KiB.");
        var request = JsonSerializer.Deserialize<PackRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Pack-textures request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Pack-textures request has an unknown format.");
        var dictionaries = request.Dictionaries ?? [];
        if (dictionaries.Length is 0 or > MaxDictionaries)
            throw new InvalidDataException($"Pack-textures takes 1 to {MaxDictionaries} dictionaries.");

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Pack-textures output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Pack-textures output cannot be a reparse point.");

        var sources = new Dictionary<string, YtdFile>(StringComparer.OrdinalIgnoreCase);
        var written = new List<object>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var dictionary in dictionaries)
        {
            var name = dictionary.Name ?? "";
            if (!DictionaryName.IsMatch(name)) throw new InvalidDataException("Dictionary name must be lowercase letters, digits and underscores.");
            if (!names.Add(name)) throw new InvalidDataException($"Dictionary {name} is listed twice.");
            var textures = dictionary.Textures ?? [];
            if (textures.Length is 0 or > MaxTextures) throw new InvalidDataException($"Dictionary {name} takes 1 to {MaxTextures} textures.");

            var list = new List<Texture>();
            var textureNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in textures)
            {
                var textureName = (entry.Name ?? "").ToLowerInvariant();
                if (!TextureName.IsMatch(textureName)) throw new InvalidDataException($"Texture name in {name} is not valid.");
                if (!textureNames.Add(textureName)) throw new InvalidDataException($"Texture {textureName} is listed twice in {name}.");
                var ddsPath = Path.GetFullPath(entry.Dds ?? "");
                var info = new FileInfo(ddsPath);
                if (!info.Exists || info.Length is 0 or > MaxDdsBytes) throw new InvalidDataException($"DDS for {textureName} is missing or too large.");
                var texture = CodeWalker.Utils.DDSIO.GetTexture(await File.ReadAllBytesAsync(ddsPath))
                    ?? throw new InvalidDataException($"DDS for {textureName} does not read.");
                texture.Name = textureName;
                texture.NameHash = JenkHash.GenHash(textureName);
                /* Флаги использования — у штатного листа: игра читает лист так же. */
                if (!string.IsNullOrEmpty(entry.Source))
                {
                    var original = FindTexture(LoadSource(sources, entry.Source), (entry.From ?? textureName).ToLowerInvariant())
                        ?? throw new InvalidDataException($"Texture {entry.From ?? textureName} is not in {Path.GetFileName(entry.Source)}.");
                    texture.UsageData = original.UsageData;
                    texture.ExtraFlags = original.ExtraFlags;
                    texture.Unknown_32h = original.Unknown_32h;
                }
                list.Add(texture);
            }

            var ytd = new YtdFile { Name = name + ".ytd", TextureDict = new TextureDictionary() };
            ytd.TextureDict.BuildFromTextureList(list);
            var bytes = ytd.Save();
            if (bytes is null || bytes.Length == 0) throw new InvalidDataException($"Dictionary {name} did not build.");

            /* Открыть заново: те же листы под теми же именами. */
            var reopened = new YtdFile { Name = name + ".ytd" };
            reopened.Load(bytes);
            var items = reopened.TextureDict?.Textures?.data_items ?? [];
            if (!reopened.Loaded || items.Length != list.Count || !items.All(item => item is not null && textureNames.Contains(item.Name.ToLowerInvariant())))
                throw new InvalidDataException($"Dictionary {name} failed semantic reopen.");

            var target = Path.Combine(output, name + ".ytd");
            await File.WriteAllBytesAsync(target, bytes);
            written.Add(new
            {
                name,
                file = target,
                size = bytes.Length,
                sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                textures = items.Select(item => new { name = item.Name.ToLowerInvariant(), width = (int)item.Width, height = (int)item.Height, levels = (int)item.Levels, format = item.Format.ToString() }).ToArray(),
            });
        }
        return new { format = RequestFormat, version = RequestVersion, output, dictionaries = written.ToArray() };
    }

    private static YtdFile LoadSource(Dictionary<string, YtdFile> cache, string path)
    {
        var full = Path.GetFullPath(path);
        if (cache.TryGetValue(full, out var known)) return known;
        var info = new FileInfo(full);
        if (!info.Exists || info.Length is 0 or > MaxSourceBytes) throw new InvalidDataException($"Source dictionary {Path.GetFileName(full)} is missing or too large.");
        var ytd = new YtdFile { Name = Path.GetFileName(full) };
        ytd.Load(File.ReadAllBytes(full));
        if (!ytd.Loaded || ytd.TextureDict is null) throw new InvalidDataException($"Source dictionary {Path.GetFileName(full)} does not open.");
        cache[full] = ytd;
        return ytd;
    }

    private static Texture? FindTexture(YtdFile ytd, string name) =>
        (ytd.TextureDict?.Textures?.data_items ?? []).FirstOrDefault(item => item is not null && string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase));

    private sealed record PackRequest(string? Format, int Version, PackDictionary[]? Dictionaries);

    private sealed record PackDictionary(string? Name, PackTexture[]? Textures);

    private sealed record PackTexture(string? Name, string? Dds, string? Source, string? From);
}
