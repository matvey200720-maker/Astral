using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// «Интерьеры» снаружи — свои листы в модели места (второй заход задачи 3
/// ТЗ 10.10.2026, `shop-embed-textures`).
///
/// Заправка или фасад магазина — свои модели квартала (навес, киоск, вывеска),
/// но листы у них частью из общего словаря квартала (`sc1_05_build.ytd`) или
/// его родителя по gtxd: правка такого листа легла бы на весь квартал. Игра
/// ищет лист модели сперва в её собственном словаре и только потом — в словаре
/// архетипа и его родителях. Поэтому перекрашенная копия общего листа зашивается
/// в свою модель места под тем же именем: модель места берёт копию, остальные
/// модели квартала — лист словаря как был. Типы, карты и словари игры не
/// трогаются.
///
/// Модель пересобирается через XML CodeWalker, как у «Остановок»
/// (`restyle-model`): в словарь модели добавляется лист из DDS, имя и флаги
/// использования берутся у штатного листа (`source` — словарь игры, `from` —
/// имя в нём, по умолчанию `name`), параметры шейдеров с этим именем CodeWalker
/// связывает с зашитым листом. Лист, что уже зашит в модель, заменяется.
///
/// Запрос: `{ format: "astral.shop-embed-textures", version: 1, target,
/// textures: [{ name, dds, source, from? }] }`. Команда детерминирована:
/// одинаковый запрос даёт те же байты.
/// </summary>
internal static class ShopCommands
{
    private const string EmbedFormat = "astral.shop-embed-textures";
    private const int EmbedVersion = 1;
    private const int MaxRequestBytes = 128 * 1024;
    private const int MaxModelBytes = 96 * 1024 * 1024;
    private const int MaxDdsBytes = 32 * 1024 * 1024;
    private const long MaxSourceBytes = 96L * 1024 * 1024;
    private const int MaxTextures = 96;

    private static readonly Regex TextureName = new("^[a-z0-9_.+-]{1,160}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> EmbedTexturesAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Shop-embed-textures request must be between 1 byte and 128 KiB.");
        var request = JsonSerializer.Deserialize<EmbedRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Shop-embed-textures request is empty.");
        if (request.Format != EmbedFormat || request.Version != EmbedVersion)
            throw new InvalidDataException("Shop-embed-textures request has an unknown format.");
        var textures = request.Textures ?? [];
        if (textures.Length is 0 or > MaxTextures) throw new InvalidDataException($"Shop-embed-textures takes 1 to {MaxTextures} textures.");

        var targetPath = Path.GetFullPath(request.Target ?? "");
        var kind = Path.GetExtension(targetPath).ToLowerInvariant();
        if (kind is not (".ydr" or ".yft") || !File.Exists(targetPath))
            throw new InvalidDataException("Shop-embed-textures target must be an existing .ydr or .yft file.");
        var modelBytes = await File.ReadAllBytesAsync(targetPath);
        if (modelBytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException("Shop-embed-textures target is empty or too large.");
        var outputPath = Path.GetFullPath(output);
        if (!string.Equals(Path.GetExtension(outputPath), kind, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Shop-embed-textures output must have the target's extension.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var work = Path.Combine(Path.GetTempPath(), "astral-shop-embed-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var name = Path.GetFileName(targetPath);
            var doc = new XmlDocument();
            doc.LoadXml(kind == ".yft" ? YftXml.GetXml(LoadYft(name, modelBytes), work) : YdrXml.GetXml(LoadYdr(name, modelBytes), work));
            var root = doc.DocumentElement!;
            var groups = root.SelectNodes(".//ShaderGroup")!.Cast<XmlElement>().ToList();
            if (groups.Count == 0) throw new InvalidDataException("Shop-embed-textures target has no shader group.");

            var sources = new Dictionary<string, YtdFile>(StringComparer.OrdinalIgnoreCase);
            var embedded = new List<string>();
            var serial = 0;
            foreach (var texture in textures)
            {
                var textureName = (texture.Name ?? "").Trim().ToLowerInvariant();
                if (!TextureName.IsMatch(textureName)) throw new InvalidDataException("Shop-embed-textures texture name is not valid.");
                var from = string.IsNullOrWhiteSpace(texture.From) ? textureName : texture.From.Trim().ToLowerInvariant();
                if (!TextureName.IsMatch(from)) throw new InvalidDataException("Shop-embed-textures source texture name is not valid.");
                var ddsPath = Path.GetFullPath(texture.Dds ?? "");
                if (!ddsPath.EndsWith(".dds", StringComparison.OrdinalIgnoreCase) || !File.Exists(ddsPath))
                    throw new InvalidDataException("Shop-embed-textures texture must be an existing .dds file.");
                var dds = await File.ReadAllBytesAsync(ddsPath);
                if (dds.Length is 0 or > MaxDdsBytes) throw new InvalidDataException("Shop-embed-textures texture is empty or too large.");
                var template = await SourceTexture(sources, texture.Source, from);
                var file = $"astral_embed_{serial++:D3}.dds";
                await File.WriteAllBytesAsync(Path.Combine(work, file), dds);

                /* Лист — в словарь каждой группы шейдеров, чьи параметры зовут его по имени. */
                var hash = JenkHash.GenHash(textureName);
                var targets = groups.Where(group => Mentions(group, textureName, hash)).ToList();
                if (targets.Count == 0) throw new InvalidDataException($"Shop-embed-textures target does not use texture {textureName}.");
                foreach (var group in targets)
                {
                    var dictionary = group.SelectSingleNode("TextureDictionary") as XmlElement;
                    if (dictionary is null)
                    {
                        dictionary = doc.CreateElement("TextureDictionary");
                        var shaders = group.SelectSingleNode("Shaders");
                        if (shaders is not null) group.InsertBefore(dictionary, shaders);
                        else group.AppendChild(dictionary);
                    }
                    var existing = dictionary.SelectNodes("Item")!.Cast<XmlElement>()
                        .FirstOrDefault(item => string.Equals(item.SelectSingleNode("Name")?.InnerText.Trim(), textureName, StringComparison.OrdinalIgnoreCase));
                    if (existing is not null)
                    {
                        SetText(doc, existing, "FileName", file);
                        continue;
                    }
                    dictionary.AppendChild(TextureItem(doc, template, textureName, file));
                }
                embedded.Add(textureName);
            }

            byte[] bytes = kind == ".yft" ? XmlYft.GetYft(doc, work).Save() : XmlYdr.GetYdr(doc, work).Save();
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, kind, embedded);
        }
        finally
        {
            try
            {
                Directory.Delete(work, true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    /* Штатный лист-образец: имя, флаги использования — у словаря игры. */
    internal static async Task<Texture> SourceTexture(Dictionary<string, YtdFile> cache, string? source, string from)
    {
        var path = Path.GetFullPath(source ?? "");
        if (!path.EndsWith(".ytd", StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            throw new InvalidDataException("Shop-embed-textures source must be an existing .ytd file.");
        if (!cache.TryGetValue(path, out var ytd))
        {
            var info = new FileInfo(path);
            if (info.Length is 0 or > MaxSourceBytes) throw new InvalidDataException("Shop-embed-textures source is empty or too large.");
            ytd = new YtdFile { Name = Path.GetFileName(path) };
            ytd.Load(await File.ReadAllBytesAsync(path));
            if (!ytd.Loaded || ytd.TextureDict is null) throw new InvalidDataException("Shop-embed-textures source dictionary does not open.");
            cache[path] = ytd;
        }
        return ytd.TextureDict.Lookup(JenkHash.GenHash(from))
            ?? throw new InvalidDataException($"Shop-embed-textures source has no texture {from}.");
    }

    /* Параметр шейдера группы зовёт лист по имени (словом или `hash_XXXXXXXX`). */
    private static bool Mentions(XmlElement group, string name, uint hash)
    {
        foreach (var item in group.SelectNodes("Shaders/Item/Parameters/Item[@type='Texture']")!.Cast<XmlElement>())
        {
            var written = (item.SelectSingleNode("Name")?.InnerText ?? "").Trim();
            if (string.Equals(written, name, StringComparison.OrdinalIgnoreCase) || string.Equals(written, $"hash_{hash:X8}", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /* Лист в XML словаря CodeWalker: флаги — у образца, картинка и её формат — из DDS. */
    internal static XmlElement TextureItem(XmlDocument doc, Texture template, string name, string file)
    {
        var item = doc.CreateElement("Item");
        void Text(string tag, string value)
        {
            var node = doc.CreateElement(tag);
            node.InnerText = value;
            item.AppendChild(node);
        }
        void Value(string tag, string value)
        {
            var node = doc.CreateElement(tag);
            node.SetAttribute("value", value);
            item.AppendChild(node);
        }
        var invariant = System.Globalization.CultureInfo.InvariantCulture;
        Text("Name", name);
        Value("Unk32", template.Unknown_32h.ToString(invariant));
        Text("Usage", template.Usage.ToString());
        Text("UsageFlags", template.UsageFlags.ToString());
        Value("ExtraFlags", template.ExtraFlags.ToString(invariant));
        Value("Width", template.Width.ToString(invariant));
        Value("Height", template.Height.ToString(invariant));
        Value("MipLevels", template.Levels.ToString(invariant));
        Text("Format", template.Format.ToString());
        Text("FileName", file);
        return item;
    }

    private static void SetText(XmlDocument doc, XmlElement parent, string tag, string value)
    {
        if (parent.SelectSingleNode(tag) is not XmlElement node)
        {
            node = doc.CreateElement(tag);
            parent.AppendChild(node);
        }
        node.InnerText = value;
    }

    private static YftFile LoadYft(string name, byte[] bytes)
    {
        var file = new YftFile { Name = name };
        file.Load(bytes);
        if (!file.Loaded || file.Fragment is null) throw new InvalidDataException("Shop-embed-textures fragment does not open.");
        return file;
    }

    private static YdrFile LoadYdr(string name, byte[] bytes)
    {
        var file = new YdrFile { Name = name };
        file.Load(bytes);
        if (!file.Loaded || file.Drawable is null) throw new InvalidDataException("Shop-embed-textures drawable does not open.");
        return file;
    }

    /* Повторное открытие: каждый лист — в словаре модели, и параметры шейдеров смотрят на него. */
    private static object Reopen(string path, byte[] bytes, string kind, List<string> embedded)
    {
        var name = Path.GetFileName(path);
        var drawable = kind == ".yft" ? (DrawableBase?)LoadYft(name, bytes).Fragment?.Drawable : LoadYdr(name, bytes).Drawable;
        var group = drawable?.ShaderGroup ?? throw new InvalidDataException($"Embedded {name} lost its shader group.");
        var items = group.TextureDictionary?.Textures?.data_items ?? [];
        var linked = 0;
        foreach (var textureName in embedded)
        {
            var texture = items.FirstOrDefault(item => string.Equals(item.Name, textureName, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException($"Embedded {name} lost texture {textureName}.");
            foreach (var shader in group.Shaders?.data_items ?? [])
                foreach (var parameter in shader?.ParametersList?.Parameters ?? [])
                    if (ReferenceEquals(parameter.Data, texture)) linked += 1;
        }
        if (linked == 0) throw new InvalidDataException($"Embedded {name}: no shader takes the new textures.");
        return new
        {
            file = name,
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new { semanticReopen = true, textures = embedded.Count, linked },
        };
    }

    private sealed record EmbedTexture(string? Name = null, string? Dds = null, string? Source = null, string? From = null);

    private sealed record EmbedRequest(string Format, int Version, string? Target = null, EmbedTexture[]? Textures = null);
}
