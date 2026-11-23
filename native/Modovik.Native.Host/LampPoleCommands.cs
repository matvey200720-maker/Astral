using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Столб фонаря (задача 5 ТЗ 10.10.2026, вечер): краска корпуса, блеск,
/// прозрачность и украшения — в самой модели фонаря игры игрока (`.yft`).
///
/// Окно и главный процесс решают, что красить и какие сетки ставить
/// (`@modovik/street-light-contract/lamps`: `pole.js`, `decor.js`), здесь это
/// встаёт в модель так, как устроены фонари Rockstar:
///   • листы корпуса — копиями в цвете под именами `astral_pole_*` во
///     встроенный словарь модели; на копию переводится только сэмплер цвета
///     шейдеров корпуса — у плафона тот же лист бывает картой блика стекла;
///   • прозрачность — прозрачными пресетами игры (`*_alpha.sps`, корзина 1);
///     шейдер без своего пресета переходит на штатный с пресетом, параметры —
///     в порядке файлов игры (`default_spec` → `default`, `normal_spec_detail`
///     → `normal_spec`, `emissive_speclum` → `emissive`);
///   • блеск — множитель `specularIntensityMult` шейдеров корпуса;
///   • украшения — новые геометрии в моделях уровней детализации: вблизи — в
///     модели кости столба (сбитый машиной фонарь уносит украшение с собой),
///     на средней и дальней дистанции — в общей модели; шейдер `default` у
///     провода и листьев, `emissive` у огоньков, лист цветов один на всех.
///     Вершины приходят в осях модели и переводятся в оси кости.
/// Маски корзин уровней и моделей дополняются корзинами новых шейдеров,
/// рамки модели и фрагмента растут под украшение. Сборка — через XML
/// CodeWalker, как у остановок (`RestyleModelCommands`). Результат
/// открывается заново и сверяется: лампы (все поля), кости, физика, число
/// геометрий и листы — те же, что заказаны.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class LampPoleCommands
{
    private const string RequestFormat = "astral.lamp-pole";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 24 * 1024 * 1024;
    private const int MaxModelBytes = 16 * 1024 * 1024;
    private const int MaxDdsBytes = 4 * 1024 * 1024;
    private const int MaxTextures = 16;
    private const int MaxPartVertices = 12000;
    private const int MaxDecorationVertices = 40000;
    private const float MaxExtent = 30f;

    private static readonly Regex TextureName = new("^astral_pole_[a-z0-9_]{1,40}$", RegexOptions.CultureInvariant);

    private static readonly HashSet<string> AlphaPresets = new(StringComparer.Ordinal)
    {
        "alpha.sps",
        "spec_alpha.sps",
        "normal_alpha.sps",
        "normal_spec_alpha.sps",
        "emissive_alpha.sps",
    };

    /* Раскладка параметров штатных шейдеров (сверено по файлам игры: пропы
       x64h.rpf). Значения берутся у прежнего шейдера, недостающие — эти. */
    private static readonly Dictionary<string, (string Name, string Type, float[] Default)[]> Layouts = new(StringComparer.Ordinal)
    {
        ["default"] =
        [
            ("DiffuseSampler", "Texture", []),
            ("matMaterialColorScale", "Vector", [1, 0, 0, 1]),
            ("HardAlphaBlend", "Vector", [1, 0, 0, 0]),
            ("useTessellation", "Vector", [0, 0, 0, 0]),
            ("wetnessMultiplier", "Vector", [1, 0, 0, 0]),
            ("globalAnimUV1", "Vector", [0, 1, 0, 0]),
            ("globalAnimUV0", "Vector", [1, 0, 0, 0]),
        ],
        ["normal"] =
        [
            ("DiffuseSampler", "Texture", []),
            ("BumpSampler", "Texture", []),
            ("HardAlphaBlend", "Vector", [1, 0, 0, 0]),
            ("useTessellation", "Vector", [0, 0, 0, 0]),
            ("wetnessMultiplier", "Vector", [1, 0, 0, 0]),
            ("bumpiness", "Vector", [1, 0, 0, 0]),
            ("specularIntensityMult", "Vector", [0.125f, 0, 0, 0]),
            ("specularFalloffMult", "Vector", [100, 0, 0, 0]),
            ("specularFresnel", "Vector", [0.97f, 0, 0, 0]),
        ],
        ["normal_spec"] =
        [
            ("DiffuseSampler", "Texture", []),
            ("BumpSampler", "Texture", []),
            ("SpecSampler", "Texture", []),
            ("HardAlphaBlend", "Vector", [1, 0, 0, 0]),
            ("useTessellation", "Vector", [0, 0, 0, 0]),
            ("wetnessMultiplier", "Vector", [1, 0, 0, 0]),
            ("bumpiness", "Vector", [1, 0, 0, 0]),
            ("specMapIntMask", "Vector", [1, 0, 0, 0]),
            ("specularIntensityMult", "Vector", [1, 0, 0, 0]),
            ("specularFalloffMult", "Vector", [100, 0, 0, 0]),
            ("specularFresnel", "Vector", [0.97f, 0, 0, 0]),
        ],
        ["emissive"] =
        [
            ("DiffuseSampler", "Texture", []),
            ("matMaterialColorScale", "Vector", [1, 0, 0, 1]),
            ("HardAlphaBlend", "Vector", [1, 0, 0, 0]),
            ("useTessellation", "Vector", [0, 0, 0, 0]),
            ("emissiveMultiplier", "Vector", [1, 0, 0, 0]),
            ("globalAnimUV1", "Vector", [0, 1, 0, 0]),
            ("globalAnimUV0", "Vector", [1, 0, 0, 0]),
        ],
    };

    private static readonly (string Lod, string List, string Flags)[] Lods =
    [
        ("high", "DrawableModelsHigh", "FlagsHigh"),
        ("medium", "DrawableModelsMedium", "FlagsMed"),
        ("low", "DrawableModelsLow", "FlagsLow"),
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> BuildAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Lamp pole request must be between 1 byte and 24 MiB.");
        var request = JsonSerializer.Deserialize<PoleRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Lamp pole request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Lamp pole request has an unknown format.");

        var modelPath = Path.GetFullPath(request.Model ?? "");
        if (!modelPath.EndsWith(".yft", StringComparison.OrdinalIgnoreCase) || !File.Exists(modelPath))
            throw new InvalidDataException("Lamp pole model must be an existing .yft file.");
        var modelBytes = await File.ReadAllBytesAsync(modelPath);
        if (modelBytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException("Lamp pole model is empty or too large.");
        var outputPath = Path.GetFullPath(output);
        if (!outputPath.EndsWith(".yft", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Lamp pole output must be a .yft file.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var textures = new List<Dds>();
        foreach (var texture in request.Textures ?? [])
            textures.Add(await ReadDdsAsync(texture));
        if (textures.Count > MaxTextures) throw new InvalidDataException("Lamp pole request has too many textures.");
        if (textures.Select(texture => texture.Name).Distinct(StringComparer.Ordinal).Count() != textures.Count)
            throw new InvalidDataException("Lamp pole texture names must be unique.");
        var decor = request.Decorations;
        Dds? decorTexture = null;
        if (decor is not null)
        {
            decorTexture = await ReadDdsAsync(decor.Texture ?? throw new InvalidDataException("Decorations need a texture."));
            if (textures.Any(texture => texture.Name == decorTexture.Name))
                throw new InvalidDataException("Decoration texture name clashes with a pole texture.");
            ValidateDecorations(decor);
        }
        var shaders = request.Shaders ?? [];
        if (shaders.Length == 0 && decor is null) throw new InvalidDataException("Lamp pole request changes nothing.");

        var source = LoadYft(Path.GetFileName(modelPath), modelBytes);
        var before = Describe(source);

        var work = Path.Combine(Path.GetTempPath(), "astral-lamp-pole-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(YftXml.GetXml(source, work));
            var fragment = doc.DocumentElement ?? throw new InvalidDataException("Model XML is empty.");
            var drawable = fragment.SelectSingleNode("Drawable") as XmlElement
                ?? throw new InvalidDataException("Fragment has no drawable.");
            var group = drawable.SelectSingleNode("ShaderGroup") as XmlElement
                ?? throw new InvalidDataException("Fragment drawable has no shader group.");
            var shaderList = group.SelectSingleNode("Shaders") as XmlElement
                ?? throw new InvalidDataException("Fragment drawable has no shaders.");
            var shaderItems = shaderList.SelectNodes("Item")!.Cast<XmlElement>().ToList();

            /* 1. Листы Astral — во встроенный словарь. */
            var dictionary = group.SelectSingleNode("TextureDictionary") as XmlElement;
            if (dictionary is null)
            {
                dictionary = doc.CreateElement("TextureDictionary");
                group.InsertBefore(dictionary, shaderList);
            }
            var present = new HashSet<string>(
                dictionary.SelectNodes("Item/Name")!.Cast<XmlElement>().Select(item => item.InnerText.Trim().ToLowerInvariant()),
                StringComparer.Ordinal);
            var allTextures = new List<Dds>(textures);
            if (decorTexture is not null) allTextures.Add(decorTexture);
            foreach (var texture in allTextures)
            {
                if (present.Contains(texture.Name)) throw new InvalidDataException($"Model already has a texture {texture.Name}.");
                await File.WriteAllBytesAsync(Path.Combine(work, texture.Name + ".dds"), texture.Bytes);
                dictionary.AppendChild(TextureElement(doc, texture));
            }
            var known = new HashSet<string>(textures.Select(texture => texture.Name), StringComparer.Ordinal);

            /* 2. Шейдеры корпуса: лист в цвете, прозрачность, блеск. */
            var touched = new HashSet<int>();
            var transparent = 0;
            foreach (var change in shaders)
            {
                if (change.Index < 0 || change.Index >= shaderItems.Count || !touched.Add(change.Index))
                    throw new InvalidDataException("Lamp pole shader index is out of range or repeated.");
                var shader = shaderItems[change.Index];
                if (change.Swap is { } swap)
                {
                    if (!Layouts.TryGetValue(swap, out var layout)) throw new InvalidDataException($"Shader swap {swap} is not supported.");
                    SwapShader(doc, shader, swap, layout);
                }
                if (change.Diffuse is { } diffuse)
                {
                    if (!known.Contains(diffuse)) throw new InvalidDataException($"Shader diffuse {diffuse} is not a requested texture.");
                    var sampler = Parameter(shader, "DiffuseSampler")
                        ?? throw new InvalidDataException("Body shader has no DiffuseSampler.");
                    var name = sampler.SelectSingleNode("Name") as XmlElement ?? throw new InvalidDataException("DiffuseSampler has no name.");
                    name.InnerText = diffuse;
                }
                if (change.Preset is { } preset)
                {
                    if (!AlphaPresets.Contains(preset)) throw new InvalidDataException($"Shader preset {preset} is not allowed.");
                    SetText(shader, "FileName", preset);
                    SetValue(shader, "RenderBucket", "1");
                    transparent += 1;
                }
                if (change.Specular is { } specular)
                {
                    if (!float.IsFinite(specular) || specular is < 0 or > 4) throw new InvalidDataException("Shader specular scale must be 0…4.");
                    ScaleVector(shader, "specularIntensityMult", specular, 0f, 4f);
                    if (specular > 1f) ScaleVector(shader, "specularFalloffMult", 1f + (specular - 1f) * 0.5f, 1f, 512f);
                }
            }

            /* 3. Украшения. */
            var decorated = new Dictionary<string, int>(StringComparer.Ordinal);
            var decorMin = new Vector3(float.MaxValue);
            var decorMax = new Vector3(float.MinValue);
            if (decor is not null && decorTexture is not null)
            {
                /* Шейдер — только у той роли, чьи части есть: без свечения
                   огоньков нет, и `emissive` с нулём модели не нужен. */
                var next = shaderItems.Count;
                var bodyShader = -1;
                var glowShader = -1;
                if (decor.Parts!.Any(part => part.Role == "body"))
                {
                    bodyShader = next++;
                    shaderList.AppendChild(DecorShader(doc, decorTexture.Name, glow: false, 0f));
                }
                if (decor.Parts!.Any(part => part.Role == "glow"))
                {
                    glowShader = next++;
                    shaderList.AppendChild(DecorShader(doc, decorTexture.Name, glow: true, decor.Glow));
                }
                var bones = BoneMatrices(drawable);
                foreach (var part in decor.Parts!)
                {
                    var (_, listName, _) = Lods.First(item => item.Lod == part.Lod);
                    var models = drawable.SelectNodes($"{listName}/Item")!.Cast<XmlElement>().ToList();
                    if (models.Count == 0) continue;
                    var target = TargetModel(models, part.Lod == "high" ? decor.Bone : 0);
                    var geometries = target.SelectSingleNode("Geometries") as XmlElement
                        ?? throw new InvalidDataException("Model has no geometry list.");
                    /* Модель с кожей (у части фонарей вблизи — одна модель на все
                       кости): вершины в осях модели, весь вес — на кость столба. */
                    var skin = UIntValue(target, "HasSkin") != 0 ? SkinSlot(geometries, part.Lod == "high" ? decor.Bone : 0) : null;
                    var boneIndex = (int)UIntValue(target, "BoneIndex");
                    var inverse = skin is null && boneIndex < bones.Count ? Matrix.Invert(bones[boneIndex]) : Matrix.Identity;
                    geometries.AppendChild(GeometryElement(doc, part, part.Role == "glow" ? glowShader : bodyShader, inverse, skin));
                    decorated[part.Lod!] = decorated.GetValueOrDefault(part.Lod!) + part.Positions!.Length / 3;
                    for (var at = 0; at < part.Positions!.Length; at += 3)
                    {
                        var point = new Vector3(part.Positions[at], part.Positions[at + 1], part.Positions[at + 2]);
                        decorMin = Vector3.Min(decorMin, point);
                        decorMax = Vector3.Max(decorMax, point);
                    }
                }
                if (decorated.Count == 0) throw new InvalidDataException("Model has no detail level to decorate.");
            }

            /* 4. Маски корзин уровней и моделей. */
            var buckets = shaderList.SelectNodes("Item")!.Cast<XmlElement>()
                .Select(item => (int)UIntValue(item, "RenderBucket")).ToList();
            foreach (var (_, listName, flagsName) in Lods)
            {
                var lodMask = 0u;
                foreach (var model in drawable.SelectNodes($"{listName}/Item")!.Cast<XmlElement>())
                {
                    var modelMask = 0u;
                    foreach (var geometry in model.SelectNodes("Geometries/Item")!.Cast<XmlElement>())
                    {
                        var index = (int)UIntValue(geometry, "ShaderIndex");
                        if (index >= 0 && index < buckets.Count) modelMask |= 1u << buckets[index];
                    }
                    if (model.SelectSingleNode("RenderMask") is XmlElement)
                        SetValue(model, "RenderMask", (UIntValue(model, "RenderMask") | modelMask).ToString(CultureInfo.InvariantCulture));
                    lodMask |= modelMask;
                }
                if (lodMask != 0 && drawable.SelectSingleNode(flagsName) is XmlElement)
                    SetValue(drawable, flagsName, (UIntValue(drawable, flagsName) | lodMask).ToString(CultureInfo.InvariantCulture));
            }

            /* 5. Рамки: модель и фрагмент — с украшением. */
            if (decorated.Count > 0) GrowBounds(fragment, drawable, decorMin, decorMax);

            var rebuilt = XmlYft.GetYft(doc, work);
            if (rebuilt.Fragment?.Drawable is null) throw new InvalidDataException("Rebuilt lamp model has no drawable.");
            var bytes = rebuilt.Save();
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, before, allTextures.Select(texture => texture.Name).ToArray(), transparent, decorated);
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

    /* ------------------------------ листы ------------------------------ */

    private sealed record Dds(string Name, byte[] Bytes, int Width, int Height, int Levels, string Format);

    private static async Task<Dds> ReadDdsAsync(PoleTexture texture)
    {
        var name = (texture.Name ?? "").Trim();
        if (!TextureName.IsMatch(name)) throw new InvalidDataException("Lamp pole texture name must be astral_pole_*.");
        var file = Path.GetFullPath(texture.Dds ?? "");
        if (!file.EndsWith(".dds", StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
            throw new InvalidDataException($"Texture {name} must be an existing .dds file.");
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"Texture {name} has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (texture.Sha256 != "sha256:" + digest) throw new InvalidDataException($"Texture SHA-256 mismatch for {name}.");
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS ") throw new InvalidDataException($"Texture {name} is not a DDS file.");
        var height = BitConverter.ToInt32(bytes, 12);
        var width = BitConverter.ToInt32(bytes, 16);
        var levels = Math.Max(1, BitConverter.ToInt32(bytes, 28));
        var format = Encoding.ASCII.GetString(bytes, 84, 4);
        if (format is not ("DXT1" or "DXT5")) throw new InvalidDataException($"Texture {name} must be DXT1 or DXT5.");
        if (width is < 4 or > 2048 || height is < 4 or > 2048 || (width & (width - 1)) != 0 || (height & (height - 1)) != 0)
            throw new InvalidDataException($"Texture {name} must be a power of two 4–2048.");
        if (levels > FullMipLevels(width, height)) throw new InvalidDataException($"Texture {name} has too many mip levels.");
        var block = format == "DXT1" ? 8 : 16;
        var expected = 128;
        for (var level = 0; level < levels; level++)
            expected += Math.Max(1, ((width >> level) + 3) / 4) * Math.Max(1, ((height >> level) + 3) / 4) * block;
        if (bytes.Length != expected) throw new InvalidDataException($"Texture {name} is truncated or padded.");
        return new Dds(name, bytes, width, height, levels, format);
    }

    private static int FullMipLevels(int width, int height) => (int)Math.Log2(Math.Max(width, height)) + 1;

    private static XmlElement TextureElement(XmlDocument doc, Dds texture)
    {
        var side = Math.Max(texture.Width, texture.Height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        flags.Add("UNK24");
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<Name>").Append(texture.Name).Append("</Name>")
            .Append("<Unk32 value=\"128\" />")
            .Append("<Usage>DIFFUSE</Usage>")
            .Append("<UsageFlags>").Append(string.Join(", ", flags)).Append("</UsageFlags>")
            .Append("<ExtraFlags value=\"0\" />")
            .Append("<Width value=\"").Append(texture.Width).Append("\" />")
            .Append("<Height value=\"").Append(texture.Height).Append("\" />")
            .Append("<MipLevels value=\"").Append(texture.Levels).Append("\" />")
            .Append("<Format>D3DFMT_").Append(texture.Format).Append("</Format>")
            .Append("<FileName>").Append(texture.Name).Append(".dds</FileName>")
            .Append("</Item>");
        return Fragment(doc, xml.ToString());
    }

    /* ----------------------------- шейдеры ----------------------------- */

    private static XmlElement? Parameter(XmlElement shader, string name)
    {
        var hash = JenkHash.GenHash(name.ToLowerInvariant());
        return shader.SelectNodes("Parameters/Item")!.Cast<XmlElement>().FirstOrDefault(item =>
        {
            var written = item.GetAttribute("name").Trim();
            return string.Equals(written, name, StringComparison.OrdinalIgnoreCase)
                || written == hash.ToString(CultureInfo.InvariantCulture)
                || string.Equals(written, $"hash_{hash:X8}", StringComparison.OrdinalIgnoreCase);
        });
    }

    /* Шейдер — на штатный: имя и параметры в его порядке, значения — прежние. */
    private static void SwapShader(XmlDocument doc, XmlElement shader, string name, (string Name, string Type, float[] Default)[] layout)
    {
        SetText(shader, "Name", name);
        var parameters = shader.SelectSingleNode("Parameters") as XmlElement ?? throw new InvalidDataException("Shader has no Parameters.");
        var next = new List<XmlElement>();
        foreach (var (parameterName, type, fallback) in layout)
        {
            var found = Parameter(shader, parameterName);
            if (type == "Texture")
            {
                if (found is null || found.GetAttribute("type") != "Texture")
                    throw new InvalidDataException($"Shader has no {parameterName} to keep.");
                next.Add(found);
                continue;
            }
            var item = doc.CreateElement("Item");
            item.SetAttribute("name", parameterName);
            item.SetAttribute("type", "Vector");
            var axes = new[] { "x", "y", "z", "w" };
            for (var axis = 0; axis < 4; axis += 1)
            {
                var value = found is not null && found.GetAttribute("type") == "Vector" && found.HasAttribute(axes[axis])
                    ? found.GetAttribute(axes[axis])
                    : fallback[axis].ToString(CultureInfo.InvariantCulture);
                item.SetAttribute(axes[axis], value);
            }
            next.Add(item);
        }
        foreach (var item in parameters.SelectNodes("Item")!.Cast<XmlElement>().ToList()) parameters.RemoveChild(item);
        foreach (var item in next) parameters.AppendChild(item);
    }

    private static void ScaleVector(XmlElement shader, string name, float factor, float low, float high)
    {
        var parameter = Parameter(shader, name);
        if (parameter is null || parameter.GetAttribute("type") != "Vector") return;
        var value = Parse(parameter.GetAttribute("x"));
        parameter.SetAttribute("x", F(Math.Clamp(value * factor, low, high)));
    }

    /* Шейдер украшения: `default` (провод, листья) или `emissive` (огоньки) — те же
       параметры, что у пропов игры и у звезды арены. */
    private static XmlElement DecorShader(XmlDocument doc, string texture, bool glow, float emissive)
    {
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<Name>").Append(glow ? "emissive" : "default").Append("</Name>")
            .Append("<FileName>").Append(glow ? "emissive.sps" : "default.sps").Append("</FileName>")
            .Append("<RenderBucket value=\"0\" />")
            .Append("<Parameters>")
            .Append("<Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(texture).Append("</Name></Item>")
            .Append("<Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />")
            .Append("<Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append(glow
                ? "<Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"" + F(emissive) + "\" y=\"0\" z=\"0\" w=\"0\" />"
                : "<Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("</Parameters></Item>");
        return Fragment(doc, xml.ToString());
    }

    /* ---------------------------- украшения ---------------------------- */

    private static void ValidateDecorations(PoleDecorations decor)
    {
        if (!float.IsFinite(decor.Glow) || decor.Glow is < 0 or > 64) throw new InvalidDataException("Decoration glow must be 0…64.");
        if (decor.Bone is < 0 or > 255) throw new InvalidDataException("Decoration bone is out of range.");
        var parts = decor.Parts ?? [];
        if (parts.Length is 0 or > 6) throw new InvalidDataException("Decorations need 1–6 parts.");
        var total = 0;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            if (part.Lod is not ("high" or "medium" or "low") || part.Role is not ("body" or "glow") || !seen.Add(part.Lod + "/" + part.Role))
                throw new InvalidDataException("Decoration part needs a unique lod (high, medium, low) and role (body, glow).");
            var positions = part.Positions ?? [];
            var normals = part.Normals ?? [];
            var uvs = part.Uvs ?? [];
            var indices = part.Indices ?? [];
            var count = positions.Length / 3;
            if (count < 3 || count > MaxPartVertices || positions.Length != count * 3 || normals.Length != count * 3 || uvs.Length != count * 2)
                throw new InvalidDataException($"Decoration part {part.Lod}/{part.Role} has broken vertex arrays.");
            if (indices.Length < 3 || indices.Length % 3 != 0 || indices.Any(index => index < 0 || index >= count))
                throw new InvalidDataException($"Decoration part {part.Lod}/{part.Role} has broken indices.");
            if (positions.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent) ||
                normals.Any(value => !float.IsFinite(value) || Math.Abs(value) > 1.01f) ||
                uvs.Any(value => !float.IsFinite(value) || value < 0f || value > 1f))
                throw new InvalidDataException($"Decoration part {part.Lod}/{part.Role} has values out of range.");
            total += count;
        }
        if (total > MaxDecorationVertices) throw new InvalidDataException($"Decorations have more than {MaxDecorationVertices} vertices.");
    }

    /*
     * Модель уровня, в которую встаёт украшение: вблизи — модель кости
     * столба (без кожи), иначе — модель корня, иначе первая без кожи, а у
     * фонарей, где уровень — одна модель с кожей на все кости, — она.
     */
    private static XmlElement TargetModel(List<XmlElement> models, int bone)
    {
        bool rigid(XmlElement model) => UIntValue(model, "HasSkin") == 0;
        return models.FirstOrDefault(model => rigid(model) && UIntValue(model, "BoneIndex") == bone)
            ?? models.FirstOrDefault(model => rigid(model) && UIntValue(model, "BoneIndex") == 0)
            ?? models.FirstOrDefault(rigid)
            ?? models.FirstOrDefault()
            ?? throw new InvalidDataException("Detail level has no model to decorate.");
    }

    /* Палитра костей геометрии модели с кожей, где есть кость столба, и её место в палитре. */
    private sealed record Skin(string BoneIds, int Slot);

    private static Skin SkinSlot(XmlElement geometries, int bone)
    {
        Skin? fallback = null;
        foreach (var geometry in geometries.SelectNodes("Item")!.Cast<XmlElement>())
        {
            var text = (geometry.SelectSingleNode("BoneIDs") as XmlElement)?.InnerText.Trim() ?? "";
            var palette = text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
            if (palette.Length == 0) continue;
            var slot = Array.IndexOf(palette, bone);
            if (slot >= 0) return new Skin(text, slot);
            fallback ??= new Skin(text, Math.Max(0, Array.IndexOf(palette, 0)));
        }
        return fallback ?? throw new InvalidDataException("Skinned model has no bone palette to carry the decoration.");
    }

    /* Абсолютные матрицы костей скелета модели (строка-вектор, как у SharpDX). */
    private static List<Matrix> BoneMatrices(XmlElement drawable)
    {
        var result = new List<Matrix>();
        foreach (var bone in drawable.SelectNodes("Skeleton/Bones/Item")!.Cast<XmlElement>())
        {
            var translation = Vector(bone, "Translation");
            var rotation = bone.SelectSingleNode("Rotation") as XmlElement;
            var quaternion = rotation is null
                ? Quaternion.Identity
                : new Quaternion(Parse(rotation.GetAttribute("x")), Parse(rotation.GetAttribute("y")), Parse(rotation.GetAttribute("z")), Parse(rotation.GetAttribute("w")));
            var scaleNode = bone.SelectSingleNode("Scale") as XmlElement;
            var scale = scaleNode is null ? new Vector3(1) : Vector(bone, "Scale");
            var local = Matrix.Scaling(scale) * Matrix.RotationQuaternion(quaternion) * Matrix.Translation(translation);
            var parent = (bone.SelectSingleNode("ParentIndex") as XmlElement)?.GetAttribute("value") is { } text &&
                         int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : -1;
            result.Add(parent >= 0 && parent < result.Count ? local * result[parent] : local);
        }
        return result;
    }

    /*
     * Геометрия украшения. С кожей — как у украшений оружия, проверенных в
     * игре: вес 255 и номер места в палитре в третьей колонке.
     */
    private static XmlElement GeometryElement(XmlDocument doc, PoleDecorationPart part, int shaderIndex, Matrix inverse, Skin? skin)
    {
        var count = part.Positions!.Length / 3;
        var positions = new Vector3[count];
        var normals = new Vector3[count];
        var low = new Vector3(float.MaxValue);
        var high = new Vector3(float.MinValue);
        for (var vertex = 0; vertex < count; vertex += 1)
        {
            var p = Vector3.TransformCoordinate(new Vector3(part.Positions[vertex * 3], part.Positions[vertex * 3 + 1], part.Positions[vertex * 3 + 2]), inverse);
            var n = Vector3.TransformNormal(new Vector3(part.Normals![vertex * 3], part.Normals[vertex * 3 + 1], part.Normals[vertex * 3 + 2]), inverse);
            n.Normalize();
            positions[vertex] = p;
            normals[vertex] = n;
            low = Vector3.Min(low, p);
            high = Vector3.Max(high, p);
        }
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<ShaderIndex value=\"").Append(shaderIndex).Append("\" />")
            .Append("<BoundingBoxMin x=\"").Append(F(low.X)).Append("\" y=\"").Append(F(low.Y)).Append("\" z=\"").Append(F(low.Z)).Append("\" w=\"").Append(F(low.X)).Append("\" />")
            .Append("<BoundingBoxMax x=\"").Append(F(high.X)).Append("\" y=\"").Append(F(high.Y)).Append("\" z=\"").Append(F(high.Z)).Append("\" w=\"").Append(F(high.X)).Append("\" />");
        if (skin is not null) xml.Append("<BoneIDs>").Append(skin.BoneIds).Append("</BoneIDs>");
        xml.Append("<VertexBuffer><Flags value=\"0\" /><Layout type=\"GTAV1\">")
            .Append(skin is not null ? "<Position /><BlendWeights /><BlendIndices /><Normal /><Colour0 /><TexCoord0 />" : "<Position /><Normal /><Colour0 /><TexCoord0 />")
            .Append("</Layout><Data>\n");
        var weights = skin is not null ? $"   0 0 255 0   0 0 {skin.Slot.ToString(CultureInfo.InvariantCulture)} 0" : "";
        for (var vertex = 0; vertex < count; vertex += 1)
        {
            var p = positions[vertex];
            var n = normals[vertex];
            xml.Append(F(p.X)).Append(' ').Append(F(p.Y)).Append(' ').Append(F(p.Z))
                .Append(weights)
                .Append("   ").Append(F(n.X)).Append(' ').Append(F(n.Y)).Append(' ').Append(F(n.Z))
                .Append("   255 255 255 255")
                .Append("   ").Append(F(part.Uvs![vertex * 2])).Append(' ').Append(F(part.Uvs[vertex * 2 + 1]))
                .Append('\n');
        }
        xml.Append("</Data></VertexBuffer><IndexBuffer><Data>")
            .Append(string.Join(" ", part.Indices!.Select(index => index.ToString(CultureInfo.InvariantCulture))))
            .Append("</Data></IndexBuffer></Item>");
        return Fragment(doc, xml.ToString());
    }

    /* Рамка модели и шар фрагмента — вместе с украшением. */
    private static void GrowBounds(XmlElement fragment, XmlElement drawable, Vector3 decorMin, Vector3 decorMax)
    {
        var min = Vector3.Min(Vector(drawable, "BoundingBoxMin"), decorMin);
        var max = Vector3.Max(Vector(drawable, "BoundingBoxMax"), decorMax);
        SetVector(drawable, "BoundingBoxMin", min);
        SetVector(drawable, "BoundingBoxMax", max);
        foreach (var owner in new[] { drawable, fragment })
        {
            if (owner.SelectSingleNode("BoundingSphereCenter") is not XmlElement) continue;
            var centre = Vector(owner, "BoundingSphereCenter");
            var radius = Parse((owner.SelectSingleNode("BoundingSphereRadius") as XmlElement)?.GetAttribute("value") ?? "0");
            var reach = 0f;
            foreach (var x in new[] { min.X, max.X })
                foreach (var y in new[] { min.Y, max.Y })
                    foreach (var z in new[] { min.Z, max.Z })
                        reach = Math.Max(reach, Vector3.Distance(centre, new Vector3(x, y, z)));
            if (reach > radius) SetValue(owner, "BoundingSphereRadius", F(reach));
        }
    }

    /* ------------------------------ сверка ------------------------------ */

    private sealed record Summary(string[] Lights, int Bones, int Groups, int Children, Dictionary<string, int> Geometries);

    private static YftFile LoadYft(string name, byte[] bytes)
    {
        var file = new YftFile { Name = name };
        file.Load(bytes);
        if (!file.Loaded || file.Fragment?.Drawable is null) throw new InvalidDataException("Lamp model fragment does not open.");
        return file;
    }

    private static Summary Describe(YftFile yft)
    {
        var fragment = yft.Fragment!;
        var drawable = fragment.Drawable!;
        var lights = (fragment.LightAttributes?.data_items ?? []).Select(LightSignature).ToArray();
        var lod = fragment.PhysicsLODGroup?.PhysicsLOD1;
        var geometries = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["high"] = drawable.DrawableModels?.High?.Sum(model => model.Geometries?.Length ?? 0) ?? 0,
            ["medium"] = drawable.DrawableModels?.Med?.Sum(model => model.Geometries?.Length ?? 0) ?? 0,
            ["low"] = drawable.DrawableModels?.Low?.Sum(model => model.Geometries?.Length ?? 0) ?? 0,
        };
        return new Summary(
            lights,
            drawable.Skeleton?.Bones?.Items?.Length ?? 0,
            lod?.Groups?.data_items?.Length ?? 0,
            lod?.Children?.data_items?.Length ?? 0,
            geometries);
    }

    /* Подпись лампы — все поля, которые читает игра (числа с округлением до
       шестого знака: XML пишет их текстом). */
    private static string LightSignature(LightAttributes light)
    {
        static string R(float value) => Math.Round(value, 4).ToString("0.####", CultureInfo.InvariantCulture);
        static string V(Vector3 value) => $"{R(value.X)},{R(value.Y)},{R(value.Z)}";
        return string.Join("|",
            V(light.Position), light.ColorR, light.ColorG, light.ColorB, light.Flashiness, R(light.Intensity), light.Flags,
            light.BoneId, light.Type, light.GroupId, light.TimeFlags, R(light.Falloff), R(light.FalloffExponent),
            V(light.CullingPlaneNormal), R(light.CullingPlaneOffset), light.ShadowBlur, R(light.VolumeIntensity),
            R(light.VolumeSizeScale), light.VolumeOuterColorR, light.VolumeOuterColorG, light.VolumeOuterColorB, light.LightHash,
            R(light.VolumeOuterIntensity), R(light.CoronaSize), R(light.VolumeOuterExponent), light.LightFadeDistance,
            light.ShadowFadeDistance, light.SpecularFadeDistance, light.VolumetricFadeDistance, R(light.ShadowNearClip),
            R(light.CoronaIntensity), R(light.CoronaZBias), V(light.Direction), V(light.Tangent), R(light.ConeInnerAngle),
            R(light.ConeOuterAngle), V(light.Extent), light.ProjectedTextureHash.Hash);
    }

    private static object Reopen(string path, byte[] bytes, Summary before, string[] textures, int transparent, Dictionary<string, int> decorated)
    {
        var yft = LoadYft(Path.GetFileName(path), bytes);
        var after = Describe(yft);
        if (!after.Lights.SequenceEqual(before.Lights))
            throw new InvalidDataException("Rebuilt lamp model changed its lights.");
        if (after.Bones != before.Bones || after.Groups != before.Groups || after.Children != before.Children)
            throw new InvalidDataException("Rebuilt lamp model changed its skeleton or physics.");
        var added = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var lod in new[] { "high", "medium", "low" })
        {
            added[lod] = after.Geometries[lod] - before.Geometries[lod];
            if (added[lod] < 0 || (!decorated.ContainsKey(lod) && added[lod] != 0) || (decorated.ContainsKey(lod) && added[lod] == 0))
                throw new InvalidDataException($"Rebuilt lamp model has unexpected geometries at {lod}.");
        }
        var dictionary = yft.Fragment!.Drawable!.ShaderGroup?.TextureDictionary?.Textures?.data_items ?? [];
        var names = new HashSet<string>(dictionary.Select(texture => (texture.Name ?? "").ToLowerInvariant()), StringComparer.Ordinal);
        if (textures.Any(name => !names.Contains(name))) throw new InvalidDataException("Rebuilt lamp model lost a texture.");
        var drawable = yft.Fragment.Drawable;
        return new
        {
            file = Path.GetFileName(path),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new
            {
                semanticReopen = true,
                lights = after.Lights.Length,
                bones = after.Bones,
                physicsChildren = after.Children,
                textures,
                transparent,
                decorated = decorated.ToDictionary(item => item.Key, item => new { vertices = item.Value, geometries = added[item.Key] }),
                flags = new { high = drawable.FlagsHigh, medium = drawable.FlagsMed, low = drawable.FlagsLow },
            },
        };
    }

    /* ------------------------------ XML ------------------------------ */

    private static XmlElement Fragment(XmlDocument doc, string xml)
    {
        var holder = new XmlDocument();
        holder.LoadXml(xml);
        return (XmlElement)doc.ImportNode(holder.DocumentElement!, true);
    }

    private static uint UIntValue(XmlElement node, string child) =>
        node.SelectSingleNode(child) is XmlElement element &&
        uint.TryParse(element.GetAttribute("value"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : 0;

    private static void SetValue(XmlElement node, string child, string value)
    {
        var element = node.SelectSingleNode(child) as XmlElement ?? throw new InvalidDataException($"Model XML has no {child}.");
        element.SetAttribute("value", value);
    }

    private static void SetText(XmlElement node, string child, string value)
    {
        var element = node.SelectSingleNode(child) as XmlElement ?? throw new InvalidDataException($"Shader has no {child}.");
        element.InnerText = value;
    }

    private static Vector3 Vector(XmlElement node, string child)
    {
        var element = node.SelectSingleNode(child) as XmlElement ?? throw new InvalidDataException($"Model XML has no {child}.");
        return new Vector3(Parse(element.GetAttribute("x")), Parse(element.GetAttribute("y")), Parse(element.GetAttribute("z")));
    }

    private static void SetVector(XmlElement node, string child, Vector3 value)
    {
        var element = node.SelectSingleNode(child) as XmlElement ?? throw new InvalidDataException($"Model XML has no {child}.");
        element.SetAttribute("x", F(value.X));
        element.SetAttribute("y", F(value.Y));
        element.SetAttribute("z", F(value.Z));
    }

    private static float Parse(string value) => float.Parse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture);
    private static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);

    private sealed record PoleTexture(string? Name = null, string? Dds = null, string? Sha256 = null);

    private sealed record PoleShader(int Index, string? Diffuse = null, string? Preset = null, string? Swap = null, float? Specular = null);

    private sealed record PoleDecorationPart(
        string? Lod = null,
        string? Role = null,
        float[]? Positions = null,
        float[]? Normals = null,
        float[]? Uvs = null,
        int[]? Indices = null);

    private sealed record PoleDecorations(PoleTexture? Texture = null, float Glow = 0, int Bone = 0, PoleDecorationPart[]? Parts = null);

    private sealed record PoleRequest(
        string Format,
        int Version,
        string? Model = null,
        PoleTexture[]? Textures = null,
        PoleShader[]? Shaders = null,
        PoleDecorations? Decorations = null);
}
