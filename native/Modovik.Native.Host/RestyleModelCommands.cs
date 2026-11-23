using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Листы и прозрачность модели игры — для «Остановок» (задача 5 ТЗ 06.10.2026).
///
/// Прозрачность реквизита в GTA V — не число в файле, а шейдер и альфа листа:
/// у прозрачной детали пресет шейдера с суффиксом `_alpha`
/// (`normal_spec_alpha.sps`, `emissivenight_alpha.sps`, `emissive_alpha.sps` —
/// так сделаны прозрачные пропы игры), корзина отрисовки 1 (прозрачные) и альфа
/// в листе цвета. Листы остановок сжаты DXT1, где альфа — один бит, поэтому
/// лист заменяется DDS другого формата (DXT5) — на месте такое не записать,
/// модель пересобирается через XML CodeWalker, как у пересадки ламп:
///   • `textures` — зашитые листы по имени заменяются картинками DDS (любой
///     формат, что читает CodeWalker), имя остаётся;
///   • `alpha` — шейдеры с этими именами переходят на свой прозрачный пресет и
///     в корзину 1, у моделей и уровней детализации в маске корзин — бит
///     прозрачных.
/// Цель — фрагмент (`.yft`), модель (`.ydr`) или словарь (`.ytd`, только листы).
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class RestyleModelCommands
{
    private const string RequestFormat = "astral.restyle-model";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 64 * 1024;
    private const int MaxModelBytes = 96 * 1024 * 1024;
    private const int MaxDdsBytes = 32 * 1024 * 1024;
    private const int MaxTextures = 64;

    private static readonly Regex TextureName = new("^[a-z0-9_.+-]{1,160}$", RegexOptions.CultureInvariant);

    /* Шейдер → его прозрачный пресет (пары взяты из пропов игры). */
    private static readonly Dictionary<string, string> AlphaPresets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["normal_spec"] = "normal_spec_alpha.sps",
        ["normal"] = "normal_alpha.sps",
        ["spec"] = "spec_alpha.sps",
        ["emissivenight"] = "emissivenight_alpha.sps",
        ["emissive"] = "emissive_alpha.sps",
        ["emissivestrong"] = "emissivestrong_alpha.sps",
        ["normal_spec_reflect"] = "normal_spec_reflect_alpha.sps",
        ["normal_reflect"] = "normal_reflect_alpha.sps",
        ["spec_reflect"] = "spec_reflect_alpha.sps",
    };

    /*
     * Шейдер без своего прозрачного пресета → штатный шейдер, у которого он
     * есть, со своей раскладкой параметров. Рекламный щит остановок
     * (`emissive_speclum`) становится `emissive` с `emissive_alpha.sps` —
     * как светильник того же навеса: порядок параметров — как в файлах игры
     * (он позиционный), значения берутся у прежнего шейдера, недостающие —
     * штатные. Блика у щита после этого нет, свечение — то же.
     */
    private sealed record AlphaSwap(string Shader, string File, (string Name, string Type, float[] Default)[] Layout);

    private static readonly Dictionary<string, AlphaSwap> AlphaSwaps = new(StringComparer.OrdinalIgnoreCase)
    {
        ["emissive_speclum"] = new AlphaSwap("emissive", "emissive_alpha.sps",
        [
            ("DiffuseSampler", "Texture", []),
            ("matMaterialColorScale", "Vector", [1, 0, 0, 1]),
            ("HardAlphaBlend", "Vector", [1, 0, 0, 0]),
            ("useTessellation", "Vector", [0, 0, 0, 0]),
            ("emissiveMultiplier", "Vector", [1, 0, 0, 0]),
            ("globalAnimUV1", "Vector", [0, 1, 0, 0]),
            ("globalAnimUV0", "Vector", [1, 0, 0, 0]),
        ]),
    };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> RestyleAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Restyle-model request must be between 1 byte and 64 KiB.");
        var request = JsonSerializer.Deserialize<RestyleModelRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Restyle-model request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Restyle-model request has an unknown format.");
        var textures = request.Textures ?? [];
        var alpha = (request.Alpha ?? []).Select(name => (name ?? "").Trim().ToLowerInvariant()).Where(name => name.Length > 0).ToHashSet();
        if (textures.Length > MaxTextures) throw new InvalidDataException("Restyle-model request has too many textures.");
        if (textures.Length == 0 && alpha.Count == 0) throw new InvalidDataException("Restyle-model request changes nothing.");
        foreach (var name in alpha)
            if (!AlphaPresets.ContainsKey(name) && !AlphaSwaps.ContainsKey(name))
                throw new InvalidDataException($"Shader {name} has no transparent preset.");

        var targetPath = Path.GetFullPath(request.Target ?? "");
        var kind = Path.GetExtension(targetPath).ToLowerInvariant();
        if (kind is not (".yft" or ".ydr" or ".ytd") || !File.Exists(targetPath))
            throw new InvalidDataException("Restyle-model target must be an existing .yft, .ydr or .ytd file.");
        if (kind == ".ytd" && alpha.Count > 0) throw new InvalidDataException("A texture dictionary has no shaders.");
        var modelBytes = await File.ReadAllBytesAsync(targetPath);
        if (modelBytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException("Restyle-model target is empty or too large.");
        var outputPath = Path.GetFullPath(output);
        if (!string.Equals(Path.GetExtension(outputPath), kind, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Restyle-model output must have the target's extension.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var work = Path.Combine(Path.GetTempPath(), "astral-restyle-model-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var name = Path.GetFileName(targetPath);
            var doc = new XmlDocument();
            doc.LoadXml(kind switch
            {
                ".yft" => YftXml.GetXml(LoadYft(name, modelBytes), work),
                ".ydr" => YdrXml.GetXml(LoadYdr(name, modelBytes), work),
                _ => YtdXml.GetXml(LoadYtd(name, modelBytes), work),
            });
            var root = doc.DocumentElement!;
            var replaced = new List<string>();
            foreach (var texture in textures)
            {
                var textureName = (texture.Name ?? "").Trim().ToLowerInvariant();
                if (!TextureName.IsMatch(textureName)) throw new InvalidDataException("Restyle-model texture name is not valid.");
                var ddsPath = Path.GetFullPath(texture.Dds ?? "");
                if (!ddsPath.EndsWith(".dds", StringComparison.OrdinalIgnoreCase) || !File.Exists(ddsPath))
                    throw new InvalidDataException("Restyle-model texture must be an existing .dds file.");
                var dds = await File.ReadAllBytesAsync(ddsPath);
                if (dds.Length is 0 or > MaxDdsBytes) throw new InvalidDataException("Restyle-model texture is empty or too large.");
                var item = root.SelectNodes(".//TextureDictionary/Item | self::TextureDictionary/Item")!
                    .Cast<XmlElement>()
                    .FirstOrDefault(element => string.Equals(element.SelectSingleNode("Name")?.InnerText.Trim(), textureName, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidDataException($"Restyle-model target has no texture {textureName}.");
                var file = item.SelectSingleNode("FileName")?.InnerText.Trim() ?? "";
                if (file.Length == 0 || Path.GetFileName(file) != file) throw new InvalidDataException("Restyle-model texture file name is not valid.");
                await File.WriteAllBytesAsync(Path.Combine(work, file), dds);
                replaced.Add(textureName);
            }
            var transparent = 0;
            if (alpha.Count > 0)
            {
                /* Имя шейдера в XML — словом или `hash_XXXXXXXX`, если словаря имён у хоста нет. */
                var byHash = alpha.ToDictionary(name => $"hash_{JenkHash.GenHash(name):X8}".ToLowerInvariant(), name => name);
                foreach (var shader in root.SelectNodes(".//ShaderGroup/Shaders/Item")!.Cast<XmlElement>())
                {
                    var written = (shader.SelectSingleNode("Name")?.InnerText ?? "").Trim().ToLowerInvariant();
                    var shaderName = alpha.Contains(written) ? written : byHash.GetValueOrDefault(written);
                    if (shaderName is null) continue;
                    if (AlphaSwaps.TryGetValue(shaderName, out var swap)) SwapShader(doc, shader, swap);
                    else SetText(shader, "FileName", AlphaPresets[shaderName]);
                    SetValue(shader, "RenderBucket", 1);
                    transparent += 1;
                }
                if (transparent == 0) throw new InvalidDataException("Restyle-model target has none of the shaders to make transparent.");
                /* Маска корзин: у моделей и уровней детализации — бит прозрачных. */
                foreach (var model in root.SelectNodes(".//DrawableModelsHigh/Item | .//DrawableModelsMedium/Item | .//DrawableModelsLow/Item | .//DrawableModelsVeryLow/Item | .//DrawableModelsX/Item")!.Cast<XmlElement>())
                    OrValue(model, "RenderMask", 2);
                foreach (var tag in new[] { "FlagsHigh", "FlagsMed", "FlagsLow", "FlagsVlow" })
                    foreach (var drawable in root.SelectNodes($".//*[{tag}]")!.Cast<XmlElement>())
                        if (ReadValue(drawable, tag) != 0) OrValue(drawable, tag, 2);
            }
            byte[] bytes = kind switch
            {
                ".yft" => XmlYft.GetYft(doc, work).Save(),
                ".ydr" => XmlYdr.GetYdr(doc, work).Save(),
                _ => XmlYtd.GetYtd(doc, work).Save(),
            };
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, kind, replaced, transparent);
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

    private static YftFile LoadYft(string name, byte[] bytes)
    {
        var file = new YftFile { Name = name };
        file.Load(bytes);
        if (!file.Loaded || file.Fragment is null) throw new InvalidDataException("Restyle-model fragment does not open.");
        return file;
    }

    private static YdrFile LoadYdr(string name, byte[] bytes)
    {
        var file = new YdrFile { Name = name };
        file.Load(bytes);
        if (!file.Loaded || file.Drawable is null) throw new InvalidDataException("Restyle-model drawable does not open.");
        return file;
    }

    private static YtdFile LoadYtd(string name, byte[] bytes)
    {
        var file = new YtdFile { Name = name };
        file.Load(bytes);
        if (!file.Loaded || file.TextureDict is null) throw new InvalidDataException("Restyle-model dictionary does not open.");
        return file;
    }

    /* Шейдер — на штатный с прозрачным пресетом: имя, пресет и параметры в его порядке. */
    private static void SwapShader(XmlDocument doc, XmlElement shader, AlphaSwap swap)
    {
        SetText(shader, "Name", swap.Shader);
        SetText(shader, "FileName", swap.File);
        var parameters = shader.SelectSingleNode("Parameters") as XmlElement ?? throw new InvalidDataException("Shader has no Parameters.");
        var before = parameters.SelectNodes("Item")!.Cast<XmlElement>().ToList();
        XmlElement? Find(string name)
        {
            var lower = name.ToLowerInvariant();
            var hash = JenkHash.GenHash(lower);
            return before.FirstOrDefault(item =>
            {
                var written = item.GetAttribute("name").Trim();
                return string.Equals(written, name, StringComparison.OrdinalIgnoreCase)
                    || written == hash.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    || string.Equals(written, $"hash_{hash:X8}", StringComparison.OrdinalIgnoreCase);
            });
        }
        var next = new List<XmlElement>();
        foreach (var (name, type, fallback) in swap.Layout)
        {
            var found = Find(name);
            if (type == "Texture")
            {
                if (found is null || found.GetAttribute("type") != "Texture")
                    throw new InvalidDataException($"Shader has no {name} to keep.");
                next.Add(found);
                continue;
            }
            var item = doc.CreateElement("Item");
            item.SetAttribute("name", name);
            item.SetAttribute("type", "Vector");
            var axes = new[] { "x", "y", "z", "w" };
            for (var axis = 0; axis < 4; axis += 1)
            {
                var value = found is not null && found.GetAttribute("type") == "Vector" && found.HasAttribute(axes[axis])
                    ? found.GetAttribute(axes[axis])
                    : fallback[axis].ToString(System.Globalization.CultureInfo.InvariantCulture);
                item.SetAttribute(axes[axis], value);
            }
            next.Add(item);
        }
        foreach (var item in before) parameters.RemoveChild(item);
        foreach (var item in next) parameters.AppendChild(item);
    }

    private static void SetText(XmlElement parent, string tag, string value)
    {
        var node = parent.SelectSingleNode(tag) as XmlElement ?? throw new InvalidDataException($"Shader has no {tag}.");
        node.InnerText = value;
    }

    private static uint ReadValue(XmlElement parent, string tag) =>
        parent.SelectSingleNode(tag) is XmlElement node && uint.TryParse(node.GetAttribute("value"), out var value) ? value : 0;

    private static void SetValue(XmlElement parent, string tag, uint value)
    {
        var node = parent.SelectSingleNode(tag) as XmlElement ?? throw new InvalidDataException($"Element has no {tag}.");
        node.SetAttribute("value", value.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private static void OrValue(XmlElement parent, string tag, uint bits)
    {
        if (parent.SelectSingleNode(tag) is not XmlElement) return;
        SetValue(parent, tag, ReadValue(parent, tag) | bits);
    }

    private static object Reopen(string path, byte[] bytes, string kind, List<string> replaced, int transparent)
    {
        var name = Path.GetFileName(path);
        TextureDictionary? dictionary = kind switch
        {
            ".yft" => LoadYft(name, bytes).Fragment?.Drawable?.ShaderGroup?.TextureDictionary,
            ".ydr" => LoadYdr(name, bytes).Drawable?.ShaderGroup?.TextureDictionary,
            _ => LoadYtd(name, bytes).TextureDict,
        };
        var items = dictionary?.Textures?.data_items ?? [];
        var textures = replaced
            .Select(textureName => items.FirstOrDefault(item => string.Equals(item.Name, textureName, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException($"Restyled {name} lost texture {textureName}."))
            .Select(texture => new { name = texture.Name, width = texture.Width, height = texture.Height, levels = texture.Levels, format = texture.Format.ToString() })
            .ToArray();
        return new
        {
            file = name,
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new { semanticReopen = true, textures, transparent },
        };
    }

    private sealed record RestyleModelTexture(string? Name = null, string? Dds = null);

    private sealed record RestyleModelRequest(
        string Format,
        int Version,
        string? Target = null,
        RestyleModelTexture[]? Textures = null,
        string[]? Alpha = null);
}
