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
/// Модели надписи на холме («Hollywood») — буквы, леса и дальние планы,
/// собранные из сеток окна.
///
/// Сетку строит окно и установщик (`@modovik/climb-contract/recolor/vinewood`):
/// буквы шрифтом человека, леса за ними, упрощённые дальние планы и ночное
/// свечение. Здесь она становится файлами игры под штатными именами:
///   • `ydr` — новая модель: свои шейдеры (`default` / `default.sps` или
///     `alpha.sps`, как у плашек эмблем), встроенные DDS со всеми мипами или
///     ссылка на лист словаря архетипа (`embedded: false`, лист лесов в
///     `ch2_03_sign.ytd`), сетки — вершины Position/Normal/Colour0/TexCoord0;
///   • `ydr` c `source` и `keepShaders` — штатная модель с новыми сетками:
///     группа шейдеров и раскладка вершин остаются её (ночное свечение
///     `decal_emissive_only`), меняются геометрия и рамки;
///   • `ydd` c `source` — словарь моделей игры, в котором заменяются только
///     названные модели (`hash`), остальные остаются байт в байт по смыслу:
///     словарь собирается через XML CodeWalker, как у пересадки ламп.
/// Сетка одной геометрии — до 65 535 вершин (индексы 16 бит, как у игры):
/// окно делит большие сетки само. Маска корзин модели (`FlagsHigh`) — биты
/// корзин её шейдеров. Модели открываются повторно и сверяются по смыслу.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class SignModelCommands
{
    private const string RequestFormat = "astral.compile-sign-models";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 256 * 1024;
    private const int MaxModels = 80;
    private const int MaxGeometries = 64;
    private const int MaxVertices = 65535;
    private const int MaxIndices = 600_000;
    private const long MaxDataBytes = 64L * 1024 * 1024;
    private const long MaxDdsBytes = 24L * 1024 * 1024;
    private const long MaxSourceBytes = 64L * 1024 * 1024;
    private const float MaxCoordinate = 4000f;
    private const float MinLodDistance = 1f;
    private const float MaxLodDistance = 20000f;
    private const string ExportedBy = "Astral Sign Models 1";

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_+]{0,62}$", RegexOptions.CultureInvariant);
    private static readonly HashSet<string> ShaderFiles = new(StringComparer.Ordinal) { "default.sps", "alpha.sps" };
    /* Светящиеся линии (МСЛ-зоны, ТЗ 08.10): `emissive` — непрозрачный
       `emissive.sps` (корзина 0, как у мода) или `emissive_alpha.sps`
       (корзина 1) — для прозрачности. Параметры — как у меток залазов. */
    private static readonly HashSet<string> EmissiveFiles = new(StringComparer.Ordinal) { "emissive.sps", "emissive_alpha.sps" };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 10,
    };

    public static async Task<object> CompileAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Sign models request must be between 1 byte and 256 KiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Sign models request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Sign models request has an unknown format.");
        if (request.Models is null || request.Models.Length is 0 or > MaxModels)
            throw new InvalidDataException($"Sign models request must list 1…{MaxModels} models.");

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Sign models output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Sign models output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Sign models output directory must be empty.");

        var names = new HashSet<string>(StringComparer.Ordinal);
        var described = new List<object>();
        var work = Path.Combine(output, ".sign-work");
        Directory.CreateDirectory(work);
        try
        {
            foreach (var model in request.Models)
            {
                if (model is null) throw new InvalidDataException("Sign model is empty.");
                var name = ValidName(model.Name, "model");
                if (!names.Add(name + "." + model.Kind)) throw new InvalidDataException($"Sign model {name} is listed twice.");
                var folder = Path.Combine(work, name + "_" + model.Kind);
                Directory.CreateDirectory(folder);
                byte[] bytes;
                object semantic;
                switch (model.Kind)
                {
                    case "ydr":
                        (bytes, semantic) = await CompileYdrAsync(model, name, folder);
                        break;
                    case "ydd":
                        (bytes, semantic) = await CompileYddAsync(model, name, folder);
                        break;
                    default:
                        throw new InvalidDataException($"Sign model {name} has an unknown kind.");
                }
                var path = Path.Combine(output, name + "." + model.Kind);
                await File.WriteAllBytesAsync(path, bytes);
                described.Add(Describe(path, bytes, semantic));
            }
        }
        finally
        {
            Directory.Delete(work, true);
        }
        return new { format = "astral.sign-models", version = 1, exportedBy = ExportedBy, files = described };
    }

    /* ------------------------------------------------------------------ */

    private static async Task<(byte[], object)> CompileYdrAsync(ModelRequest model, string name, string folder)
    {
        if (model.Drawables is not { Length: 1 } || model.Drawables[0].Hash is not null)
            throw new InvalidDataException($"Sign model {name}.ydr must have exactly one drawable without a hash.");
        var drawable = model.Drawables[0];
        string xml;
        if (model.Source is not null)
        {
            var source = await ReadSourceAsync(model.Source, name);
            var original = new YdrFile { Name = name + ".ydr" };
            original.Load(source);
            if (!original.Loaded || original.Drawable is null) throw new InvalidDataException($"Source of {name}.ydr does not load.");
            var doc = new XmlDocument();
            doc.LoadXml(YdrXml.GetXml(original, folder));
            var root = doc.DocumentElement ?? throw new InvalidDataException($"Source of {name}.ydr has no drawable.");
            await ReplaceDrawableNodeAsync(doc, root, drawable, name, folder);
            xml = doc.OuterXml;
        }
        else
        {
            if (drawable.KeepShaders) throw new InvalidDataException($"Sign model {name}.ydr keeps shaders but has no source.");
            xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + await BuildDrawableXmlAsync(drawable, name, folder, "Drawable");
        }
        var ydr = XmlYdr.GetYdr(xml, folder);
        if (ydr.Drawable is null) throw new InvalidDataException($"Generated sign model {name}.ydr has no drawable.");
        ydr.Name = name + ".ydr";
        var bytes = ydr.Save();
        var reopened = new YdrFile { Name = name + ".ydr" };
        reopened.Load(bytes);
        var geometries = reopened.Drawable?.DrawableModels?.High?.SelectMany(item => item.Geometries ?? []).ToArray() ?? [];
        if (!reopened.Loaded || reopened.Drawable is null || geometries.Length != drawable.Geometries!.Length)
            throw new InvalidDataException($"Compiled sign model {name}.ydr failed semantic reopen.");
        return (bytes, new { semanticReopen = true, geometries = geometries.Length, vertices = geometries.Sum(item => item.VerticesCount) });
    }

    private static async Task<(byte[], object)> CompileYddAsync(ModelRequest model, string name, string folder)
    {
        if (model.Source is null) throw new InvalidDataException($"Sign model {name}.ydd needs its source dictionary.");
        if (model.Drawables is null || model.Drawables.Length is 0 or > 16)
            throw new InvalidDataException($"Sign model {name}.ydd must replace 1…16 drawables.");
        var source = await ReadSourceAsync(model.Source, name);
        var original = new YddFile { Name = name + ".ydd" };
        original.Load(source);
        if (!original.Loaded || original.DrawableDict is null) throw new InvalidDataException($"Source of {name}.ydd does not load.");
        var doc = new XmlDocument();
        doc.LoadXml(YddXml.GetXml(original, folder));
        var items = doc.DocumentElement?.SelectNodes("Item")?.Cast<XmlElement>().ToArray() ?? [];
        var replaced = new HashSet<uint>();
        foreach (var drawable in model.Drawables)
        {
            if (drawable?.Hash is not { } hash) throw new InvalidDataException($"Sign model {name}.ydd lists a drawable without a hash.");
            if (!replaced.Add(hash)) throw new InvalidDataException($"Sign model {name}.ydd replaces drawable {hash} twice.");
            var item = items.FirstOrDefault(node => XmlMeta.GetHash(node.SelectSingleNode("Name")?.InnerText ?? "") == hash)
                ?? throw new InvalidDataException($"Source of {name}.ydd has no drawable {hash}.");
            await ReplaceDrawableNodeAsync(doc, item, drawable, name, folder);
        }
        var ydd = XmlYdd.GetYdd(doc, folder);
        if (ydd.DrawableDict is null) throw new InvalidDataException($"Generated sign model {name}.ydd has no dictionary.");
        ydd.Name = name + ".ydd";
        var bytes = ydd.Save();
        var reopened = new YddFile { Name = name + ".ydd" };
        reopened.Load(bytes);
        var count = reopened.DrawableDict?.Drawables?.data_items?.Length ?? 0;
        if (!reopened.Loaded || count != items.Length)
            throw new InvalidDataException($"Compiled sign model {name}.ydd failed semantic reopen.");
        foreach (var hash in replaced)
            if (reopened.Dict is null || !reopened.Dict.ContainsKey(hash))
                throw new InvalidDataException($"Compiled sign model {name}.ydd lost drawable {hash}.");
        return (bytes, new { semanticReopen = true, drawables = count, replaced = replaced.Count });
    }

    /*
     * Модель словаря или штатная модель с новыми сетками: рамки и модели
     * высокой детализации — новые, средняя и низкая детализация убираются
     * (дальние планы у игры — свои сущности), дальности — как были.
     * `keepShaders` — группа шейдеров и раскладка вершин остаются штатными.
     */
    private static async Task ReplaceDrawableNodeAsync(XmlDocument doc, XmlElement node, DrawableRequest drawable, string name, string folder)
    {
        var geometries = ValidateGeometries(drawable, name);
        string shaderGroupXml;
        IReadOnlyList<int> buckets;
        var layouts = new Dictionary<int, XmlNode>();
        if (drawable.KeepShaders)
        {
            var group = node.SelectSingleNode("ShaderGroup") ?? throw new InvalidDataException($"{name}: the source drawable has no shaders.");
            shaderGroupXml = group.OuterXml;
            var shaderNodes = group.SelectNodes("Shaders/Item")?.Cast<XmlNode>().ToArray() ?? [];
            buckets = shaderNodes.Select(item => int.Parse(item.SelectSingleNode("RenderBucket")?.Attributes?["value"]?.Value ?? "0", CultureInfo.InvariantCulture)).ToArray();
            foreach (XmlNode geometry in node.SelectNodes("DrawableModelsHigh/Item/Geometries/Item")!)
            {
                var index = int.Parse(geometry.SelectSingleNode("ShaderIndex")?.Attributes?["value"]?.Value ?? "0", CultureInfo.InvariantCulture);
                var layout = geometry.SelectSingleNode("VertexBuffer/Layout");
                if (layout is not null && !layouts.ContainsKey(index)) layouts[index] = layout;
            }
            foreach (var geometry in geometries)
            {
                if (geometry.Shader < 0 || geometry.Shader >= buckets.Count)
                    throw new InvalidDataException($"{name}: geometry uses a shader the source does not have.");
                if (!layouts.ContainsKey(geometry.Shader))
                    throw new InvalidDataException($"{name}: the source has no vertex layout for shader {geometry.Shader}.");
            }
        }
        else
        {
            (shaderGroupXml, buckets) = await BuildShaderGroupXmlAsync(drawable, name, folder);
        }
        var (min, max, models) = await BuildModelsXmlAsync(geometries, layouts, name);
        var centre = (min + max) * 0.5f;
        var radius = Vector3.Distance(centre, max);
        var fragment = new StringBuilder()
            .Append(Vector3Element("BoundingSphereCenter", centre))
            .Append("<BoundingSphereRadius value=\"").Append(F(radius)).Append("\" />")
            .Append(Vector3Element("BoundingBoxMin", min))
            .Append(Vector3Element("BoundingBoxMax", max));
        var mask = buckets.Distinct().Aggregate(0, (sum, bucket) => sum | (1 << bucket));
        foreach (var tag in new[] { "BoundingSphereCenter", "BoundingSphereRadius", "BoundingBoxMin", "BoundingBoxMax", "ShaderGroup", "DrawableModelsHigh", "DrawableModelsMedium", "DrawableModelsLow", "DrawableModelsVeryLow", "Bounds" })
            foreach (var old in node.SelectNodes(tag)!.Cast<XmlNode>().ToArray()) node.RemoveChild(old);
        SetValue(doc, node, "FlagsHigh", mask);
        SetValue(doc, node, "FlagsMed", 0);
        SetValue(doc, node, "FlagsLow", 0);
        SetValue(doc, node, "FlagsVlow", 0);
        if (drawable.LodDist is { } lod)
            foreach (var tag in new[] { "LodDistHigh", "LodDistMed", "LodDistLow", "LodDistVlow" }) SetValue(doc, node, tag, lod);
        var holder = doc.CreateDocumentFragment();
        holder.InnerXml = fragment.ToString() + shaderGroupXml + models;
        var anchor = node.SelectSingleNode("Name");
        if (anchor is not null) node.InsertAfter(holder, anchor);
        else node.PrependChild(holder);
    }

    private static void SetValue(XmlDocument doc, XmlElement node, string tag, float value)
    {
        var element = node.SelectSingleNode(tag) as XmlElement;
        if (element is null)
        {
            element = doc.CreateElement(tag);
            node.AppendChild(element);
        }
        element.SetAttribute("value", F(value));
    }

    private static async Task<string> BuildDrawableXmlAsync(DrawableRequest drawable, string name, string folder, string tag)
    {
        var geometries = ValidateGeometries(drawable, name);
        var (shaderGroupXml, buckets) = await BuildShaderGroupXmlAsync(drawable, name, folder);
        var (min, max, models) = await BuildModelsXmlAsync(geometries, new Dictionary<int, XmlNode>(), name);
        var centre = (min + max) * 0.5f;
        var radius = Vector3.Distance(centre, max);
        var lod = F(drawable.LodDist ?? 100f);
        var mask = buckets.Distinct().Aggregate(0, (sum, bucket) => sum | (1 << bucket));
        return new StringBuilder("<").Append(tag).Append(">\n")
            .Append(" <Name>").Append(name).Append("</Name>\n")
            .Append(' ').Append(Vector3Element("BoundingSphereCenter", centre)).Append('\n')
            .Append(" <BoundingSphereRadius value=\"").Append(F(radius)).Append("\" />\n")
            .Append(' ').Append(Vector3Element("BoundingBoxMin", min)).Append('\n')
            .Append(' ').Append(Vector3Element("BoundingBoxMax", max)).Append('\n')
            .Append(" <LodDistHigh value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistMed value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistLow value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistVlow value=\"").Append(lod).Append("\" />\n")
            .Append(" <FlagsHigh value=\"").Append(mask).Append("\" />\n")
            .Append(" <FlagsMed value=\"0\" />\n <FlagsLow value=\"0\" />\n <FlagsVlow value=\"0\" />\n")
            .Append(shaderGroupXml)
            .Append(models)
            .Append("</").Append(tag).Append(">\n")
            .ToString();
    }

    /* Шейдеры `default` (непрозрачный `default.sps` или `alpha.sps`) — как у плашек эмблем. */
    private static async Task<(string, IReadOnlyList<int>)> BuildShaderGroupXmlAsync(DrawableRequest drawable, string name, string folder)
    {
        if (drawable.Shaders is null || drawable.Shaders.Length is 0 or > 8)
            throw new InvalidDataException($"{name}: a drawable needs 1…8 shaders.");
        var textures = new Dictionary<string, TextureRequest>(StringComparer.Ordinal);
        foreach (var texture in drawable.Textures ?? [])
        {
            var textureName = ValidName(texture?.Name, "texture");
            if (!textures.TryAdd(textureName, texture!)) throw new InvalidDataException($"{name}: texture {textureName} is listed twice.");
        }
        /* Без встроенных листов словаря нет вовсе: лист берётся из словаря архетипа. */
        var xml = new StringBuilder(" <ShaderGroup>\n");
        if (textures.Count > 0) xml.Append("  <TextureDictionary>\n");
        foreach (var (textureName, texture) in textures)
        {
            var (width, height, levels, format) = await CopyDdsAsync(texture, textureName, name, folder);
            xml.Append("   <Item>\n")
                .Append("    <Name>").Append(textureName).Append("</Name>\n")
                .Append("    <Unk32 value=\"128\" />\n")
                .Append("    <Usage>DIFFUSE</Usage>\n")
                .Append("    <UsageFlags>").Append(UsageFlags(width, height)).Append("</UsageFlags>\n")
                .Append("    <ExtraFlags value=\"0\" />\n")
                .Append("    <Width value=\"").Append(width).Append("\" />\n")
                .Append("    <Height value=\"").Append(height).Append("\" />\n")
                .Append("    <MipLevels value=\"").Append(levels).Append("\" />\n")
                .Append("    <Format>D3DFMT_").Append(format).Append("</Format>\n")
                .Append("    <FileName>").Append(textureName).Append(".dds</FileName>\n")
                .Append("   </Item>\n");
        }
        if (textures.Count > 0) xml.Append("  </TextureDictionary>\n");
        xml.Append("  <Shaders>\n");
        var buckets = new List<int>();
        foreach (var shader in drawable.Shaders)
        {
            if (shader is null) throw new InvalidDataException($"{name}: a shader is empty.");
            var emissive = shader.Name == "emissive";
            if (emissive ? !EmissiveFiles.Contains(shader.File ?? "") : shader.Name != "default" || !ShaderFiles.Contains(shader.File ?? ""))
                throw new InvalidDataException($"{name}: only default (default.sps, alpha.sps) and emissive (emissive.sps, emissive_alpha.sps) shaders can be built.");
            var bucket = shader.File is "alpha.sps" or "emissive_alpha.sps" ? 1 : 0;
            var texture = ValidName(shader.Texture, "shader texture");
            buckets.Add(bucket);
            if (emissive)
            {
                var glow = shader.Emissive ?? 1f;
                if (!float.IsFinite(glow) || glow < 0f || glow > 64f) throw new InvalidDataException($"{name}: emissive must be 0…64.");
                xml.Append("   <Item>\n    <Name>emissive</Name>\n    <FileName>").Append(shader.File).Append("</FileName>\n")
                    .Append("    <RenderBucket value=\"").Append(bucket).Append("\" />\n")
                    .Append("    <Parameters>\n")
                    .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(texture).Append("</Name></Item>\n")
                    .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
                    .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                    .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n")
                    .Append("     <Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"").Append(F(glow)).Append("\" y=\"0\" z=\"0\" w=\"0\" />\n")
                    .Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
                    .Append("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                    .Append("    </Parameters>\n   </Item>\n");
                continue;
            }
            xml.Append("   <Item>\n    <Name>default</Name>\n    <FileName>").Append(shader.File).Append("</FileName>\n")
                .Append("    <RenderBucket value=\"").Append(bucket).Append("\" />\n")
                .Append("    <Parameters>\n")
                .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(texture).Append("</Name></Item>\n")
                .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
                .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"").Append(bucket).Append("\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("    </Parameters>\n   </Item>\n");
        }
        xml.Append("  </Shaders>\n </ShaderGroup>\n");
        return (xml.ToString(), buckets);
    }

    /* DDS из окна → в папку XML: DXT1 или DXT5 со всеми мипами, сумма сходится. */
    private static async Task<(int, int, int, string)> CopyDdsAsync(TextureRequest texture, string textureName, string name, string folder)
    {
        var file = Path.GetFullPath(texture.Dds ?? "");
        if (!File.Exists(file)) throw new FileNotFoundException($"{name}: texture {textureName} was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"{name}: texture {textureName} has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS ") throw new InvalidDataException($"{name}: texture {textureName} is not DDS.");
        var height = BitConverter.ToInt32(bytes, 12);
        var width = BitConverter.ToInt32(bytes, 16);
        var levels = Math.Max(1, BitConverter.ToInt32(bytes, 28));
        var format = Encoding.ASCII.GetString(bytes, 84, 4);
        if (format is not ("DXT1" or "DXT5")) throw new InvalidDataException($"{name}: texture {textureName} must be DXT1 or DXT5.");
        if (!IsPowerOfTwo(width) || !IsPowerOfTwo(height) || width > 8192 || height > 8192 || width < 4 || height < 4)
            throw new InvalidDataException($"{name}: texture {textureName} must be a power of two, 4…8192 px.");
        if (levels != (int)Math.Log2(Math.Max(width, height)) + 1)
            throw new InvalidDataException($"{name}: texture {textureName} needs a full mip chain.");
        var blockBytes = format == "DXT1" ? 8 : 16;
        long expected = 128;
        for (var level = 0; level < levels; level++)
            expected += (long)Math.Max(1, (Math.Max(1, width >> level) + 3) / 4) * Math.Max(1, (Math.Max(1, height >> level) + 3) / 4) * blockBytes;
        if (bytes.Length != expected) throw new InvalidDataException($"{name}: texture {textureName} is truncated or padded.");
        if (texture.Sha256 is not null && texture.Sha256 != "sha256:" + Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant())
            throw new InvalidDataException($"{name}: texture {textureName} SHA-256 mismatch.");
        await File.WriteAllBytesAsync(Path.Combine(folder, textureName + ".dds"), bytes);
        return (width, height, levels, format);
    }

    private sealed record Geometry(int Shader, float[] Vertices, int[] Indices);

    private static Geometry[] ValidateGeometries(DrawableRequest drawable, string name)
    {
        if (drawable.Geometries is null || drawable.Geometries.Length is 0 or > MaxGeometries)
            throw new InvalidDataException($"{name}: a drawable needs 1…{MaxGeometries} geometries.");
        return drawable.Geometries.Select(geometry =>
        {
            if (geometry is null) throw new InvalidDataException($"{name}: a geometry is empty.");
            if (geometry.VertexCount is < 3 or > MaxVertices || geometry.IndexCount < 3 || geometry.IndexCount > MaxIndices || geometry.IndexCount % 3 != 0)
                throw new InvalidDataException($"{name}: geometry needs 3…{MaxVertices} vertices and whole triangles.");
            var file = Path.GetFullPath(geometry.Data ?? "");
            if (!File.Exists(file)) throw new FileNotFoundException($"{name}: geometry data was not found.", file);
            var info = new FileInfo(file);
            var expected = (long)geometry.VertexCount * 8 * 4 + (long)geometry.IndexCount * 4;
            if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length != expected || info.Length > MaxDataBytes)
                throw new InvalidDataException($"{name}: geometry data has the wrong size.");
            var bytes = File.ReadAllBytes(file);
            var vertices = new float[geometry.VertexCount * 8];
            Buffer.BlockCopy(bytes, 0, vertices, 0, vertices.Length * 4);
            var indices = new int[geometry.IndexCount];
            Buffer.BlockCopy(bytes, vertices.Length * 4, indices, 0, indices.Length * 4);
            for (var at = 0; at < vertices.Length; at++)
                if (!float.IsFinite(vertices[at]) || Math.Abs(vertices[at]) > MaxCoordinate)
                    throw new InvalidDataException($"{name}: geometry has a vertex out of range.");
            foreach (var index in indices)
                if (index < 0 || index >= geometry.VertexCount) throw new InvalidDataException($"{name}: geometry has an index out of range.");
            return new Geometry(geometry.Shader, vertices, indices);
        }).ToArray();
    }

    /*
     * Модели высокой детализации: по геометрии на сетку. Раскладка — своя
     * (Position/Normal/Colour0/TexCoord0) или штатная раскладка шейдера;
     * у штатной недостающее заполняется: цвет — белый, вторая развёртка —
     * как первая, касательная — вдоль X.
     */
    private static Task<(Vector3, Vector3, string)> BuildModelsXmlAsync(Geometry[] geometries, IReadOnlyDictionary<int, XmlNode> layouts, string name)
    {
        var min = new Vector3(float.MaxValue);
        var max = new Vector3(float.MinValue);
        var xml = new StringBuilder("<DrawableModelsHigh>\n <Item>\n  <RenderMask value=\"255\" />\n  <Flags value=\"0\" />\n  <HasSkin value=\"0\" />\n  <BoneIndex value=\"0\" />\n  <Unknown1 value=\"0\" />\n  <Geometries>\n");
        foreach (var geometry in geometries)
        {
            var gMin = new Vector3(float.MaxValue);
            var gMax = new Vector3(float.MinValue);
            for (var at = 0; at < geometry.Vertices.Length; at += 8)
            {
                var point = new Vector3(geometry.Vertices[at], geometry.Vertices[at + 1], geometry.Vertices[at + 2]);
                gMin = Vector3.Min(gMin, point);
                gMax = Vector3.Max(gMax, point);
            }
            min = Vector3.Min(min, gMin);
            max = Vector3.Max(max, gMax);
            string[] components;
            string layoutXml;
            if (layouts.TryGetValue(geometry.Shader, out var layout))
            {
                components = layout.ChildNodes.Cast<XmlNode>().Where(item => item.NodeType == XmlNodeType.Element).Select(item => item.Name).ToArray();
                layoutXml = layout.OuterXml;
            }
            else
            {
                components = ["Position", "Normal", "Colour0", "TexCoord0"];
                layoutXml = "<Layout type=\"GTAV1\"><Position /><Normal /><Colour0 /><TexCoord0 /></Layout>";
            }
            xml.Append("   <Item>\n    <ShaderIndex value=\"").Append(geometry.Shader).Append("\" />\n")
                .Append("    ").Append(Vector4Element("BoundingBoxMin", gMin)).Append('\n')
                .Append("    ").Append(Vector4Element("BoundingBoxMax", gMax)).Append('\n')
                .Append("    <VertexBuffer>\n     <Flags value=\"0\" />\n     ").Append(layoutXml).Append("\n     <Data>\n");
            for (var at = 0; at < geometry.Vertices.Length; at += 8)
            {
                var v = geometry.Vertices;
                xml.Append("      ");
                var first = true;
                foreach (var component in components)
                {
                    if (!first) xml.Append("   ");
                    first = false;
                    switch (component)
                    {
                        case "Position": xml.Append(F(v[at])).Append(' ').Append(F(v[at + 1])).Append(' ').Append(F(v[at + 2])); break;
                        case "Normal": xml.Append(F(v[at + 3])).Append(' ').Append(F(v[at + 4])).Append(' ').Append(F(v[at + 5])); break;
                        case "Colour0":
                        case "Colour1": xml.Append("255 255 255 255"); break;
                        case "Tangent": xml.Append("1 0 0 1"); break;
                        default:
                            if (component.StartsWith("TexCoord", StringComparison.Ordinal))
                            {
                                xml.Append(F(v[at + 6])).Append(' ').Append(F(v[at + 7]));
                                break;
                            }
                            throw new InvalidDataException($"{name}: vertex layout component {component} is not supported.");
                    }
                }
                xml.Append('\n');
            }
            xml.Append("     </Data>\n    </VertexBuffer>\n    <IndexBuffer>\n     <Data>");
            for (var at = 0; at < geometry.Indices.Length; at++)
            {
                if (at % 24 == 0) xml.Append("\n      ");
                else xml.Append(' ');
                xml.Append(geometry.Indices[at].ToString(CultureInfo.InvariantCulture));
            }
            xml.Append("\n     </Data>\n    </IndexBuffer>\n   </Item>\n");
        }
        xml.Append("  </Geometries>\n </Item>\n</DrawableModelsHigh>\n");
        return Task.FromResult((min, max, xml.ToString()));
    }

    private static async Task<byte[]> ReadSourceAsync(string sourcePath, string name)
    {
        var file = Path.GetFullPath(sourcePath);
        if (!File.Exists(file)) throw new FileNotFoundException($"Source for {name} was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 16 or > MaxSourceBytes)
            throw new InvalidDataException($"Source for {name} has an unsafe file type or size.");
        return await File.ReadAllBytesAsync(file);
    }

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name))
            throw new InvalidDataException($"Sign {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    private static bool IsPowerOfTwo(int value) => value > 0 && (value & (value - 1)) == 0;

    private static string UsageFlags(int width, int height)
    {
        var side = Math.Max(width, height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        if (side >= 2048) flags.Add("X2048");
        flags.Add("UNK24");
        return string.Join(", ", flags);
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private static string F(float value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static string Vector3Element(string name, Vector3 value) =>
        $"<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" />";
    private static string Vector4Element(string name, Vector3 value) =>
        $"<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" w=\"0\" />";

    private sealed record CompileRequest(string Format, int Version, ModelRequest[]? Models = null);

    private sealed record ModelRequest(string Name, string Kind, string? Source = null, DrawableRequest[]? Drawables = null);

    private sealed record DrawableRequest(
        uint? Hash = null,
        float? LodDist = null,
        bool KeepShaders = false,
        ShaderRequest[]? Shaders = null,
        TextureRequest[]? Textures = null,
        GeometryRequest[]? Geometries = null);

    private sealed record ShaderRequest(string Name, string? File, string? Texture, float? Emissive = null);

    private sealed record TextureRequest(string Name, string? Dds, string? Sha256 = null);

    private sealed record GeometryRequest(int Shader, string? Data, int VertexCount, int IndexCount);
}
