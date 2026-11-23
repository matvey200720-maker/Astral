using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Части одной модели — в другую: геометрия донора с её шейдерами и
/// встроенными текстурами пересаживается в модель-приёмник.
///
/// Нужна там, где мод выбросил из модели то, что игроку надо вернуть. У
/// ангара аэропорта (`hei_ap1_01_c_sthbld3_int`) мод заменил штатные фермы
/// своей сеткой без потолочных ламп, а огни ламп оставил: свет есть,
/// светильников нет. Лампы берутся из штатной модели игры самого игрока
/// (в поставку Astral модели Rockstar не попадают), поднимаются к потолку
/// мода и садятся в его модель:
///   • что брать — геометрии, у шейдера которых лист цвета
///     (`DiffuseSampler`) из списка, без учёта регистра;
///   • `offset` — сдвиг в осях модели: вершины и рамки геометрий;
///   • шейдеры донора — копией в конец списка приёмника, индексы шейдеров
///     у геометрий переписываются; встроенные текстуры этих шейдеров — в
///     словарь приёмника (одноимённые у приёмника остаются его);
///   • `emissive` — множитель свечения пересаженных шейдеров (0 — лампы не
///     горят: «выключить свет»);
///   • рамка модели и маски корзин (`RenderMask` модели, `FlagsHigh`) —
///     заново: маска — биты корзин шейдеров (ванильное правило, см.
///     `SkyRainbowCommands`).
/// Сборка — через XML CodeWalker, как у плашек эмблемы: буферы, параметры и
/// рамки геометрий раскладывает он сам. Огни приёмника не трогаются — их
/// правит установщик на месте.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class GraftDrawableCommands
{
    private const string RequestFormat = "astral.graft-drawable";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 64 * 1024;
    private const int MaxModelBytes = 64 * 1024 * 1024;
    private const int MaxNames = 32;
    private const float MaxOffset = 1000f;

    private static readonly Regex TextureName = new("^[a-z0-9_.+-]{1,160}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> GraftAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Graft request must be between 1 byte and 64 KiB.");
        var request = JsonSerializer.Deserialize<GraftRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Graft request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Graft request has an unknown format.");
        var wanted = ValidNames(request.Diffuse);
        var offset = ValidOffset(request.Offset);
        if (request.Emissive is { } emissive && (!float.IsFinite(emissive) || emissive < 0 || emissive > 64))
            throw new InvalidDataException("Graft emissive multiplier must be between 0 and 64.");

        var target = await ReadModelAsync(request.Target, "target");
        var donor = await ReadModelAsync(request.Donor, "donor");
        var outputPath = Path.GetFullPath(output);
        if (!outputPath.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Graft output must be a .ydr file.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var work = Path.Combine(Path.GetTempPath(), "astral-graft-" + Guid.NewGuid().ToString("N"));
        var targetFolder = Path.Combine(work, "target");
        var donorFolder = Path.Combine(work, "donor");
        Directory.CreateDirectory(targetFolder);
        Directory.CreateDirectory(donorFolder);
        try
        {
            var targetDoc = new XmlDocument();
            targetDoc.LoadXml(YdrXml.GetXml(target, targetFolder));
            var donorDoc = new XmlDocument();
            donorDoc.LoadXml(YdrXml.GetXml(donor, donorFolder));
            var before = Count(target);
            var merged = Merge(targetDoc, donorDoc, wanted, offset, request.Emissive, targetFolder, donorFolder);
            var ydr = XmlYdr.GetYdr(targetDoc, targetFolder);
            if (ydr.Drawable is null) throw new InvalidDataException("Grafted model has no drawable.");
            var bytes = ydr.Save();
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, before, merged);
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

    private static async Task<YdrFile> ReadModelAsync(string? file, string label)
    {
        if (string.IsNullOrWhiteSpace(file)) throw new InvalidDataException($"Graft {label} model is missing.");
        var full = Path.GetFullPath(file);
        if (!full.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            throw new InvalidDataException($"Graft {label} model must be an existing .ydr file.");
        var bytes = await File.ReadAllBytesAsync(full);
        if (bytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException($"Graft {label} model is empty or too large.");
        var ydr = new YdrFile { Name = Path.GetFileName(full) };
        ydr.Load(bytes);
        if (!ydr.Loaded || ydr.Drawable is null) throw new InvalidDataException($"Graft {label} model does not open.");
        return ydr;
    }

    private static HashSet<string> ValidNames(string[]? names)
    {
        if (names is null || names.Length is 0 or > MaxNames)
            throw new InvalidDataException("Graft needs 1–32 diffuse texture names.");
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in names)
        {
            var name = (raw ?? "").Trim().ToLowerInvariant();
            if (!TextureName.IsMatch(name)) throw new InvalidDataException($"Graft texture name {raw} is not valid.");
            set.Add(name);
        }
        return set;
    }

    private static float[] ValidOffset(float[]? offset)
    {
        var value = offset ?? [0f, 0f, 0f];
        if (value.Length != 3 || value.Any(component => !float.IsFinite(component) || Math.Abs(component) > MaxOffset))
            throw new InvalidDataException("Graft offset must be three finite numbers within 1000 m.");
        return value;
    }

    private sealed record Merged(int Geometries, int Shaders, string[] Textures, int Mask, float[] Min, float[] Max);

    private static Merged Merge(
        XmlDocument targetDoc,
        XmlDocument donorDoc,
        HashSet<string> wanted,
        float[] offset,
        float? emissive,
        string targetFolder,
        string donorFolder)
    {
        var target = targetDoc.DocumentElement ?? throw new InvalidDataException("Target model XML is empty.");
        var donor = donorDoc.DocumentElement ?? throw new InvalidDataException("Donor model XML is empty.");
        var targetGroup = target.SelectSingleNode("ShaderGroup") as XmlElement
            ?? throw new InvalidDataException("Target model has no shader group.");
        var targetShaders = targetGroup.SelectSingleNode("Shaders") as XmlElement
            ?? throw new InvalidDataException("Target model has no shaders.");
        var donorShaders = donor.SelectNodes("ShaderGroup/Shaders/Item")!.Cast<XmlElement>().ToList();
        var targetShaderCount = targetShaders.SelectNodes("Item")!.Count;
        var targetModel = target.SelectSingleNode("DrawableModelsHigh/Item") as XmlElement
            ?? throw new InvalidDataException("Target model has no high detail model.");
        if (UIntValue(targetModel, "HasSkin") != 0) throw new InvalidDataException("Target model is skinned.");
        var targetGeometries = targetModel.SelectSingleNode("Geometries") as XmlElement
            ?? throw new InvalidDataException("Target model has no geometries.");

        var shaderMap = new Dictionary<int, int>();
        var textures = new SortedSet<string>(StringComparer.Ordinal);
        var bucketMask = 0;
        var grafted = 0;
        foreach (var donorModel in donor.SelectNodes("DrawableModelsHigh/Item")!.Cast<XmlElement>())
        {
            if (UIntValue(donorModel, "HasSkin") != 0) continue;
            foreach (var geometry in donorModel.SelectNodes("Geometries/Item")!.Cast<XmlElement>())
            {
                var shaderIndex = (int)UIntValue(geometry, "ShaderIndex");
                if (shaderIndex < 0 || shaderIndex >= donorShaders.Count) continue;
                var shader = donorShaders[shaderIndex];
                var diffuse = ParameterTexture(shader, "DiffuseSampler");
                if (diffuse is null || !wanted.Contains(diffuse)) continue;
                if (!shaderMap.TryGetValue(shaderIndex, out var mapped))
                {
                    var copy = (XmlElement)targetDoc.ImportNode(shader, true);
                    if (emissive is { } value) SetVectorX(copy, "emissiveMultiplier", value);
                    targetShaders.AppendChild(copy);
                    mapped = targetShaderCount + shaderMap.Count;
                    shaderMap[shaderIndex] = mapped;
                    foreach (var name in copy.SelectNodes("Parameters/Item[@type='Texture']/Name")!.Cast<XmlElement>())
                    {
                        var texture = name.InnerText.Trim();
                        if (texture.Length > 0) textures.Add(texture);
                    }
                    bucketMask |= 1 << (int)Math.Min(7u, UIntValue(copy, "RenderBucket"));
                }
                var graft = (XmlElement)targetDoc.ImportNode(geometry, true);
                SetValue(graft, "ShaderIndex", mapped.ToString(CultureInfo.InvariantCulture));
                Shift(graft, offset);
                targetGeometries.AppendChild(graft);
                grafted += 1;
            }
        }
        if (grafted == 0) throw new InvalidDataException("Donor model has no geometry with the requested textures.");

        /* Встроенные текстуры пересаженных шейдеров — в словарь приёмника. */
        var dictionary = targetGroup.SelectSingleNode("TextureDictionary") as XmlElement;
        if (dictionary is null)
        {
            dictionary = targetDoc.CreateElement("TextureDictionary");
            targetGroup.InsertBefore(dictionary, targetShaders);
        }
        var present = new HashSet<string>(
            dictionary.SelectNodes("Item/Name")!.Cast<XmlElement>().Select(item => item.InnerText.Trim().ToLowerInvariant()),
            StringComparer.Ordinal);
        var embedded = new List<string>();
        foreach (var item in donor.SelectNodes("ShaderGroup/TextureDictionary/Item")!.Cast<XmlElement>())
        {
            var name = item.SelectSingleNode("Name")?.InnerText.Trim() ?? "";
            if (!textures.Contains(name) || present.Contains(name.ToLowerInvariant())) continue;
            var file = item.SelectSingleNode("FileName")?.InnerText.Trim() ?? "";
            var source = Path.Combine(donorFolder, file);
            if (file.Length == 0 || Path.GetFileName(file) != file || !File.Exists(source))
                throw new InvalidDataException($"Donor texture {name} was not exported.");
            File.Copy(source, Path.Combine(targetFolder, file), overwrite: true);
            dictionary.AppendChild(targetDoc.ImportNode(item, true));
            present.Add(name.ToLowerInvariant());
            embedded.Add(name);
        }

        /* Маски корзин: модель и `FlagsHigh` — биты корзин её шейдеров. */
        var modelMask = (int)UIntValue(targetModel, "RenderMask") | bucketMask;
        SetValue(targetModel, "RenderMask", modelMask.ToString(CultureInfo.InvariantCulture));
        var flags = (int)UIntValue(target, "FlagsHigh") | bucketMask;
        SetValue(target, "FlagsHigh", flags.ToString(CultureInfo.InvariantCulture));

        /* Рамка модели — по рамкам всех геометрий высокой детализации. */
        var min = new[] { float.MaxValue, float.MaxValue, float.MaxValue };
        var max = new[] { float.MinValue, float.MinValue, float.MinValue };
        foreach (var geometry in target.SelectNodes("DrawableModelsHigh/Item/Geometries/Item")!.Cast<XmlElement>())
        {
            var low = Vector(geometry, "BoundingBoxMin");
            var high = Vector(geometry, "BoundingBoxMax");
            for (var axis = 0; axis < 3; axis += 1)
            {
                min[axis] = Math.Min(min[axis], low[axis]);
                max[axis] = Math.Max(max[axis], high[axis]);
            }
        }
        SetVector(target, "BoundingBoxMin", min);
        SetVector(target, "BoundingBoxMax", max);
        var centre = new[] { (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2 };
        SetVector(target, "BoundingSphereCenter", centre);
        var radius = MathF.Sqrt(
            (max[0] - min[0]) * (max[0] - min[0]) + (max[1] - min[1]) * (max[1] - min[1]) + (max[2] - min[2]) * (max[2] - min[2])) / 2;
        SetValue(target, "BoundingSphereRadius", F(radius));
        return new Merged(grafted, shaderMap.Count, embedded.ToArray(), flags, min, max);
    }

    /* Сдвиг вершин и рамки геометрии: положение — первая составляющая
       вершины, три числа с плавающей точкой (как у всех статичных моделей). */
    private static void Shift(XmlElement geometry, float[] offset)
    {
        var low = Vector(geometry, "BoundingBoxMin");
        var high = Vector(geometry, "BoundingBoxMax");
        SetVector(geometry, "BoundingBoxMin", [low[0] + offset[0], low[1] + offset[1], low[2] + offset[2]]);
        SetVector(geometry, "BoundingBoxMax", [high[0] + offset[0], high[1] + offset[1], high[2] + offset[2]]);
        if (offset.All(component => component == 0)) return;
        var layout = geometry.SelectSingleNode("VertexBuffer/Layout") as XmlElement
            ?? throw new InvalidDataException("Donor geometry has no vertex layout.");
        var first = layout.ChildNodes.OfType<XmlElement>().FirstOrDefault();
        if (first?.Name != "Position") throw new InvalidDataException("Donor geometry vertices do not start with a position.");
        foreach (var name in new[] { "VertexBuffer/Data", "VertexBuffer/Data2" })
        {
            if (geometry.SelectSingleNode(name) is not XmlElement data) continue;
            var rows = data.InnerText.Split('\n');
            var shifted = new List<string>(rows.Length);
            foreach (var row in rows)
            {
                var trimmed = row.Trim();
                if (trimmed.Length == 0) continue;
                var parts = trimmed.Split(' ', 4, StringSplitOptions.None);
                if (parts.Length < 3) throw new InvalidDataException("Donor vertex row is too short.");
                var x = Parse(parts[0]) + offset[0];
                var y = Parse(parts[1]) + offset[1];
                var z = Parse(parts[2]) + offset[2];
                shifted.Add($"{F(x)} {F(y)} {F(z)}{(parts.Length > 3 ? " " + parts[3] : "")}");
            }
            data.InnerText = "\n" + string.Join("\n", shifted) + "\n";
        }
    }

    private static string? ParameterTexture(XmlElement shader, string parameter)
    {
        foreach (var item in shader.SelectNodes("Parameters/Item")!.Cast<XmlElement>())
        {
            if (!string.Equals(item.GetAttribute("name"), parameter, StringComparison.OrdinalIgnoreCase)) continue;
            return item.SelectSingleNode("Name")?.InnerText.Trim().ToLowerInvariant();
        }
        return null;
    }

    private static void SetVectorX(XmlElement shader, string parameter, float value)
    {
        foreach (var item in shader.SelectNodes("Parameters/Item")!.Cast<XmlElement>())
        {
            if (!string.Equals(item.GetAttribute("name"), parameter, StringComparison.OrdinalIgnoreCase)) continue;
            if (item.GetAttribute("type") != "Vector") continue;
            item.SetAttribute("x", F(value));
        }
    }

    private static uint UIntValue(XmlElement node, string child)
    {
        var element = node.SelectSingleNode(child) as XmlElement;
        return element is not null && uint.TryParse(element.GetAttribute("value"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : 0;
    }

    private static void SetValue(XmlElement node, string child, string value)
    {
        var element = node.SelectSingleNode(child) as XmlElement
            ?? throw new InvalidDataException($"Model XML has no {child}.");
        element.SetAttribute("value", value);
    }

    private static float[] Vector(XmlElement node, string child)
    {
        var element = node.SelectSingleNode(child) as XmlElement
            ?? throw new InvalidDataException($"Model XML has no {child}.");
        return [Parse(element.GetAttribute("x")), Parse(element.GetAttribute("y")), Parse(element.GetAttribute("z"))];
    }

    private static void SetVector(XmlElement node, string child, float[] value)
    {
        var element = node.SelectSingleNode(child) as XmlElement
            ?? throw new InvalidDataException($"Model XML has no {child}.");
        element.SetAttribute("x", F(value[0]));
        element.SetAttribute("y", F(value[1]));
        element.SetAttribute("z", F(value[2]));
    }

    private static int Count(YdrFile ydr) =>
        ydr.Drawable?.DrawableModels?.High?.Sum(model => model.Geometries?.Length ?? 0) ?? 0;

    private static object Reopen(string path, byte[] bytes, int before, Merged merged)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var drawable = ydr.Drawable;
        var textures = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items ?? [];
        var names = new HashSet<string>(textures.Select(texture => (texture.Name ?? "").ToLowerInvariant()), StringComparer.Ordinal);
        if (!ydr.Loaded || drawable is null || Count(ydr) != before + merged.Geometries ||
            merged.Textures.Any(name => !names.Contains(name.ToLowerInvariant())) ||
            (drawable.FlagsHigh & merged.Mask) != merged.Mask)
            throw new InvalidDataException("Grafted model failed semantic reopen.");
        /* Свечение шейдеров модели — чтобы «выключить» было видно в ответе. */
        var emissiveHash = JenkHash.GenHash("emissivemultiplier");
        var emissive = new List<float>();
        foreach (var shader in drawable.ShaderGroup?.Shaders?.data_items ?? [])
        {
            var list = shader?.ParametersList;
            if (list?.Hashes is null || list.Parameters is null) continue;
            for (var index = 0; index < list.Hashes.Length && index < list.Parameters.Length; index += 1)
                if ((uint)list.Hashes[index] == emissiveHash && list.Parameters[index].Data is SharpDX.Vector4 value)
                    emissive.Add(value.X);
        }
        return new
        {
            file = Path.GetFileName(path),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new
            {
                semanticReopen = true,
                geometries = merged.Geometries,
                shaders = merged.Shaders,
                textures = merged.Textures,
                lights = drawable.LightAttributes?.data_items?.Length ?? 0,
                emissive,
                flagsHigh = drawable.FlagsHigh,
                bounds = new { min = merged.Min, max = merged.Max },
            },
        };
    }

    private static float Parse(string value) => float.Parse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture);
    private static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);

    private sealed record GraftRequest(
        string Format,
        int Version,
        string? Target = null,
        string? Donor = null,
        string[]? Diffuse = null,
        float[]? Offset = null,
        float? Emissive = null);
}
