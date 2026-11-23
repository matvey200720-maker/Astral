using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Новая текстура и развёртка модели — для цветовых эффектов по поверхности.
///
/// Оболочки зон (запретных и зелёных) красит одна зашитая клетка 4×4, а все
/// вершины смотрят в одну её точку: ровный цвет пишется на месте, а градиенту,
/// радуге и полосам нужны и сам рисунок, и развёртка, которая по нему идёт.
/// Здесь:
///   • зашитая текстура `texture.name` заменяется картинкой из DDS (любой
///     размер и формат, что читает CodeWalker), имя остаётся — шейдеры её
///     находят как прежде;
///   • у всех вершин высокой детализации первая развёртка (TexCoord0)
///     переписывается проекцией: u = (точка · axis − offset) × scale,
///     v = 0,5 — полоса рисунка ложится вдоль оси модели (градиент на всю
///     длину или полосы, повторяющиеся каждые столько-то метров);
///   • `emissive` — множитель свечения всех шейдеров, где он есть;
///   • `textureOnly` — развёртка и свечение меняются только у сеток и
///     шейдеров, что берут эту текстуру: у оболочек бизвара, ВЗХ и порта
///     (ТЗ 17.10.2026, задача 12) в одной модели две линии со своими листами
///     (`1` и `2`), и у каждой — свой эффект и своя проекция; без флага — у
///     всех, как прежде.
///
/// Версия 1 — одна модель, один лист. Версия 2 — много моделей одним
/// запуском (`items`, у каждой — свои шаги `steps`, лист на шаг, итог —
/// файл `output` в папке вывода): у зелёных зон полторы сотни моделей, и
/// запуск хоста на каждую тянул «Применить» на минуту.
/// Сборка — через XML CodeWalker, как у пересадки ламп: буферы и словарь
/// раскладывает он сам.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class RestyleDrawableCommands
{
    private const string RequestFormat = "astral.restyle-drawable";
    private const int MaxRequestBytes = 64 * 1024;
    private const int MaxBatchRequestBytes = 2 * 1024 * 1024;
    private const int MaxItems = 600;
    private const int MaxSteps = 8;
    private const int MaxModelBytes = 64 * 1024 * 1024;
    private const int MaxDdsBytes = 8 * 1024 * 1024;

    private static readonly Regex TextureName = new("^[a-z0-9_.+-]{1,160}$", RegexOptions.CultureInvariant);
    private static readonly Regex OutputName = new("^[a-z0-9][a-z0-9_.+-]{0,160}\\.ydr$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 10,
    };

    /* Шаг правки: лист, проекция, свечение и чьи сетки он трогает. */
    private sealed record Step(string TextureName, byte[] Dds, Vector3 Axis, float Offset, float Scale, float? Emissive, bool TextureOnly);

    public static async Task<object> RestyleAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxBatchRequestBytes)
            throw new InvalidDataException("Restyle request must be between 1 byte and 2 MiB.");
        var request = JsonSerializer.Deserialize<RestyleRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Restyle request is empty.");
        if (request.Format != RequestFormat || request.Version is not (1 or 2))
            throw new InvalidDataException("Restyle request has an unknown format.");

        if (request.Version == 1)
        {
            if (requestBytes.Length > MaxRequestBytes) throw new InvalidDataException("Restyle request must be between 1 byte and 64 KiB.");
            if (request.Items is not null) throw new InvalidDataException("Restyle request version 1 has no items.");
            var step = await ReadStepAsync(request.Texture, request.Uv, request.Emissive, request.TextureOnly);
            var outputPath = Path.GetFullPath(output);
            if (!outputPath.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Restyle output must be a .ydr file.");
            return await RestyleOneAsync(request.Target, [step], outputPath);
        }

        if (request.Target is not null || request.Texture is not null || request.Uv is not null || request.Emissive is not null || request.TextureOnly is not null)
            throw new InvalidDataException("Restyle request version 2 lists its models in items.");
        var items = request.Items ?? [];
        if (items.Length is 0 or > MaxItems) throw new InvalidDataException($"Restyle request needs 1…{MaxItems} items.");
        var directory = Path.GetFullPath(output);
        if (File.Exists(directory)) throw new InvalidDataException("Restyle output must be a directory.");
        Directory.CreateDirectory(directory);
        if (new DirectoryInfo(directory).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Restyle output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(directory).Any())
            throw new InvalidDataException("Restyle output directory must be empty.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        var results = new List<object>();
        foreach (var item in items)
        {
            if (item is null) throw new InvalidDataException("A restyle item is empty.");
            var name = (item.Output ?? "").Trim();
            if (!OutputName.IsMatch(name)) throw new InvalidDataException("Restyle item output must be a lowercase .ydr file name.");
            if (!names.Add(name)) throw new InvalidDataException($"Restyle item {name} is listed twice.");
            var steps = item.Steps ?? [];
            if (steps.Length is 0 or > MaxSteps) throw new InvalidDataException($"Restyle item {name} needs 1…{MaxSteps} steps.");
            var parsed = new List<Step>();
            foreach (var step in steps)
            {
                if (step is null) throw new InvalidDataException($"Restyle item {name} has an empty step.");
                parsed.Add(await ReadStepAsync(step.Texture, step.Uv, step.Emissive, step.TextureOnly));
            }
            /* Несколько листов в одной модели — у каждого свои сетки, иначе
               последний шаг переписал бы развёртку чужих. */
            if (parsed.Count > 1 && (parsed.Any(step => !step.TextureOnly) || parsed.Select(step => step.TextureName).Distinct().Count() != parsed.Count))
                throw new InvalidDataException($"Restyle item {name}: several steps must each name their own texture with textureOnly.");
            results.Add(await RestyleOneAsync(item.Target, parsed, Path.Combine(directory, name)));
        }
        return new { format = "astral.restyle-drawable", version = 2, files = results };
    }

    private static async Task<Step> ReadStepAsync(RestyleTexture? texture, RestyleProjection? uv, float? emissive, bool? textureOnly)
    {
        if (texture is null) throw new InvalidDataException("Restyle request needs a texture.");
        var textureName = (texture.Name ?? "").Trim().ToLowerInvariant();
        if (!TextureName.IsMatch(textureName)) throw new InvalidDataException("Restyle texture name is not valid.");
        var ddsPath = Path.GetFullPath(texture.Dds ?? "");
        if (!ddsPath.EndsWith(".dds", StringComparison.OrdinalIgnoreCase) || !File.Exists(ddsPath))
            throw new InvalidDataException("Restyle texture must be an existing .dds file.");
        var dds = await File.ReadAllBytesAsync(ddsPath);
        if (dds.Length is 0 or > MaxDdsBytes) throw new InvalidDataException("Restyle texture is empty or too large.");
        if (uv is null) throw new InvalidDataException("Restyle request needs a projection.");
        if (uv.Axis is not { Length: 3 } || uv.Axis.Any(value => !float.IsFinite(value)) ||
            !float.IsFinite(uv.Offset) || !float.IsFinite(uv.Scale) || Math.Abs(uv.Scale) > 1e4)
            throw new InvalidDataException("Restyle projection must be finite.");
        var axis = new Vector3(uv.Axis[0], uv.Axis[1], uv.Axis[2]);
        if (axis.Length() < 1e-6f) throw new InvalidDataException("Restyle projection axis is zero.");
        if (emissive is { } value && (!float.IsFinite(value) || value < 0 || value > 64))
            throw new InvalidDataException("Restyle emissive multiplier must be between 0 and 64.");
        return new Step(textureName, dds, axis, uv.Offset, uv.Scale, emissive, textureOnly == true);
    }

    private static async Task<object> RestyleOneAsync(string? target, IReadOnlyList<Step> steps, string outputPath)
    {
        var targetPath = Path.GetFullPath(target ?? "");
        if (!targetPath.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase) || !File.Exists(targetPath))
            throw new InvalidDataException("Restyle target must be an existing .ydr file.");
        var modelBytes = await File.ReadAllBytesAsync(targetPath);
        if (modelBytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException("Restyle target is empty or too large.");
        var ydr = new YdrFile { Name = Path.GetFileName(targetPath) };
        ydr.Load(modelBytes);
        if (!ydr.Loaded || ydr.Drawable is null) throw new InvalidDataException("Restyle target does not open.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var vertices = 0;
        foreach (var step in steps)
            vertices += Reproject(ydr.Drawable, step.Axis, step.Offset, step.Scale, step.TextureOnly ? step.TextureName : null);

        var work = Path.Combine(Path.GetTempPath(), "astral-restyle-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(YdrXml.GetXml(ydr, work));
            foreach (var step in steps)
            {
                var item = doc.DocumentElement!.SelectNodes("ShaderGroup/TextureDictionary/Item")!
                    .Cast<XmlElement>()
                    .FirstOrDefault(element => string.Equals(element.SelectSingleNode("Name")?.InnerText.Trim(), step.TextureName, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidDataException($"Restyle target has no embedded texture {step.TextureName}.");
                var file = item.SelectSingleNode("FileName")?.InnerText.Trim() ?? "";
                if (file.Length == 0 || Path.GetFileName(file) != file) throw new InvalidDataException("Restyle texture file name is not valid.");
                await File.WriteAllBytesAsync(Path.Combine(work, file), step.Dds);
                if (step.Emissive is not { } value) continue;
                foreach (var shader in doc.DocumentElement!.SelectNodes("ShaderGroup/Shaders/Item")!.Cast<XmlElement>())
                {
                    if (step.TextureOnly && !ShaderNamesTexture(shader, step.TextureName)) continue;
                    foreach (var parameter in shader.SelectNodes("Parameters/Item")!.Cast<XmlElement>())
                        if (string.Equals(parameter.GetAttribute("name"), "emissiveMultiplier", StringComparison.OrdinalIgnoreCase) &&
                            parameter.GetAttribute("type") == "Vector")
                            parameter.SetAttribute("x", value.ToString("R", CultureInfo.InvariantCulture));
                }
            }
            var rebuilt = XmlYdr.GetYdr(doc, work);
            if (rebuilt.Drawable is null) throw new InvalidDataException("Restyled model has no drawable.");
            var bytes = rebuilt.Save();
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, steps.Select(step => step.TextureName).ToArray(), vertices);
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

    /* Шейдер сетки берёт текстуру с этим именем (параметр-текстура). */
    private static bool SamplesTexture(ShaderFX? shader, string name) =>
        shader?.ParametersList?.Parameters?.Any(parameter =>
            parameter.Data is TextureBase texture && string.Equals(texture.Name, name, StringComparison.OrdinalIgnoreCase)) == true;

    /* То же в XML: у шейдера есть параметр-текстура с этим именем. */
    private static bool ShaderNamesTexture(XmlElement shader, string name) =>
        shader.SelectNodes("Parameters/Item")!.Cast<XmlElement>().Any(parameter =>
            parameter.GetAttribute("type") == "Texture" &&
            string.Equals(parameter.SelectSingleNode("Name")?.InnerText.Trim(), name, StringComparison.OrdinalIgnoreCase));

    /* Развёртка проекцией: u по оси, v — середина полосы. `only` — только сетки с этой текстурой. */
    private static int Reproject(Drawable drawable, Vector3 axis, float offset, float scale, string? only)
    {
        var count = 0;
        foreach (var model in drawable.DrawableModels?.High ?? [])
            foreach (var geometry in model.Geometries ?? [])
            {
                if (only is not null && !SamplesTexture(geometry.Shader, only)) continue;
                var data = geometry.VertexData;
                var info = data?.Info;
                if (data?.VertexBytes is null || info is null) continue;
                const int position = (int)VertexSemantics.Position;
                const int texcoord = (int)VertexSemantics.TexCoord0;
                if (((info.Flags >> position) & 1) == 0 || ((info.Flags >> texcoord) & 1) == 0) continue;
                if (info.GetComponentType(position) != VertexComponentType.Float3)
                    throw new InvalidDataException("Restyle needs float positions.");
                var uvType = info.GetComponentType(texcoord);
                if (uvType != VertexComponentType.Float2 && uvType != VertexComponentType.Half2)
                    throw new InvalidDataException("Restyle needs float or half texture coordinates.");
                var positionAt = info.GetComponentOffset(position);
                var uvAt = info.GetComponentOffset(texcoord);
                var stride = info.Stride;
                var bytes = data.VertexBytes;
                for (var vertex = 0; vertex < data.VertexCount; vertex += 1)
                {
                    var at = vertex * stride;
                    var point = new Vector3(
                        BitConverter.ToSingle(bytes, at + positionAt),
                        BitConverter.ToSingle(bytes, at + positionAt + 4),
                        BitConverter.ToSingle(bytes, at + positionAt + 8));
                    var u = (Vector3.Dot(point, axis) - offset) * scale;
                    const float v = 0.5f;
                    if (uvType == VertexComponentType.Float2)
                    {
                        BitConverter.TryWriteBytes(new Span<byte>(bytes, at + uvAt, 4), u);
                        BitConverter.TryWriteBytes(new Span<byte>(bytes, at + uvAt + 4, 4), v);
                    }
                    else
                    {
                        BitConverter.TryWriteBytes(new Span<byte>(bytes, at + uvAt, 2), (System.Half)u);
                        BitConverter.TryWriteBytes(new Span<byte>(bytes, at + uvAt + 2, 2), (System.Half)v);
                    }
                    count += 1;
                }
            }
        if (count == 0) throw new InvalidDataException("Restyle target has no vertices with texture coordinates.");
        return count;
    }

    private static object Reopen(string path, byte[] bytes, string[] textureNames, int vertices)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var items = ydr.Drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items ?? [];
        var textures = textureNames
            .Select(name => items.FirstOrDefault(item => string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException("Restyled model failed semantic reopen."))
            .ToArray();
        if (!ydr.Loaded) throw new InvalidDataException("Restyled model failed semantic reopen.");
        var described = textures.Select(texture => new { name = texture.Name, width = texture.Width, height = texture.Height, levels = texture.Levels, format = texture.Format.ToString() }).ToArray();
        return new
        {
            file = Path.GetFileName(path),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = textures.Length == 1
                ? (object)new { semanticReopen = true, vertices, texture = described[0] }
                : new { semanticReopen = true, vertices, textures = described },
        };
    }

    private sealed record RestyleTexture(string? Name = null, string? Dds = null);

    private sealed record RestyleProjection(float[]? Axis = null, float Offset = 0, float Scale = 1);

    private sealed record RestyleStep(
        RestyleTexture? Texture = null,
        RestyleProjection? Uv = null,
        float? Emissive = null,
        bool? TextureOnly = null);

    private sealed record RestyleItem(string? Target = null, string? Output = null, RestyleStep[]? Steps = null);

    private sealed record RestyleRequest(
        string Format,
        int Version,
        string? Target = null,
        RestyleTexture? Texture = null,
        RestyleProjection? Uv = null,
        float? Emissive = null,
        bool? TextureOnly = null,
        RestyleItem[]? Items = null);
}
