using System.Globalization;
using System.Security.Cryptography;
using System.Xml.Linq;
using CodeWalker.GameFiles;
using CodeWalker.Utils;

namespace Modovik.RpfHelper;

/*
 * Редактор фонарей мастерской: свет моделей, огни вдали и частицы у ламп.
 *
 * Прежние режимы `lamp-*` правили одну проверенную модель по заранее
 * подписанному плану. Редактору нужно другое: все фонари выбранных групп
 * разом, по правилу («цвет такой-то, сила ×1.5»), на файлах самого игрока.
 *
 * ГЛАВНОЕ ПРАВИЛО — МЕНЯЮТСЯ ТОЛЬКО БАЙТЫ СВЕТА. Модель не пересобирается
 * CodeWalker'ом: в распакованном ресурсе переписываются поля записей
 * `LightAttributes` на их местах (168 байт на лампу, смещения — по порядку
 * чтения CodeWalker), ресурс сжимается обратно с теми же флагами страниц.
 * После записи файл перечитывается, и каждый байт вне правленых полей
 * сверяется с исходным — у фонаря не меняется ни геометрия, ни физика, ни
 * шейдеры. Так же — и огни вдали: цвет, сила, радиус и ореол переписываются
 * в массивах SOA на месте.
 *
 * Описание пропов (`.ytyp`) правится иначе — в него дописываются новые
 * структуры, и файл собирает CodeWalker. Сверка там по смыслу: XML описания
 * без частиц Astral обязан совпасть с исходным XML без частиц Astral.
 */

internal sealed record LampStudioModel(string File, string Model, string? Entry = null);

internal sealed record LampStudioMutation(
    string List,
    int Index,
    LampRgb? Color = null,
    float? Intensity = null,
    float? Falloff = null,
    float? FalloffExponent = null,
    float? CoronaIntensity = null,
    float? CoronaSize = null,
    float? VolumeIntensity = null,
    float? VolumeSizeScale = null,
    LampRgb? VolumeOuterColor = null,
    uint? FlagsSet = null);

internal sealed record LampStudioModelPatch(
    string Input,
    string Output,
    string Model,
    IReadOnlyList<LampStudioMutation>? Mutations = null,
    IReadOnlyList<LampStudioTexture>? Textures = null);

/// <summary>Встроенная текстура модели и DDS той же раскладки, которым её заменить.</summary>
internal sealed record LampStudioTexture(string Name, string Source);

/// <summary>Модель, у которой выгрузить текстуры светящегося стекла в папку.</summary>
internal sealed record LampStudioGlassModel(string File, string Model, string Output);

/// <summary>Цвет огня вдали по «подписи» его лампы (радуга).</summary>
internal sealed record LampStudioLodPaletteEntry(float Falloff, float Exponent, LampRgb Color);

internal sealed record LampStudioLodPair(
    string LodInput,
    string DistantInput,
    string LodOutput,
    string DistantOutput);

/// <summary>
/// Подпись лампы (радиус и показатель), чьи огни вдали правятся, как
/// уличные, хотя бита улицы у них нет: лампы на мачтах светофоров.
/// </summary>
internal sealed record LampStudioLodSignature(float Falloff, float Exponent);

/// <summary>
/// Огни вдали ламп под мостами и в тоннелях: узнаются по месту (точки x, y, z
/// подряд), у них меняется только цвет.
/// </summary>
internal sealed record LampStudioLodExtra(LampRgb? Color = null, IReadOnlyList<float>? Points = null, float? Radius = null);

internal sealed record LampStudioLodRule(
    bool? StreetOnly = true,
    LampRgb? Color = null,
    float? IntensityScale = null,
    float? FalloffScale = null,
    float? ExponentScale = null,
    float? CoronaScale = null,
    IReadOnlyList<LampStudioLodPaletteEntry>? Palette = null,
    IReadOnlyList<LampStudioLodSignature>? Signatures = null,
    LampStudioLodExtra? Extra = null);

/// <summary>Точка частиц: смещение в пространстве кости и тег кости лампы.</summary>
internal sealed record LampStudioPoint(float X, float Y, float Z, int Bone = 0);

internal sealed record LampStudioExtension(
    string Archetype,
    IReadOnlyList<LampStudioPoint> Points,
    string FxName,
    int Probability);

internal static class LampStudioCommands
{
    private const int MaxModels = 512;
    private const int MaxMutationsPerModel = 64;
    private const int MaxLodPairs = 1024;
    private const int MaxExtensions = 512;
    private const long SystemBase = 0x50000000L;
    private const long GraphicsBase = 0x60000000L;
    private const int MaxTexturesPerModel = 8;
    private const int LightStride = 168;

    /* Смещения полей записи LightAttributes (CodeWalker Drawable.cs, Read). */
    private const int ColorOffset = 0x18;
    private const int IntensityOffset = 0x1C;
    private const int FlagsOffset = 0x20;
    private const int FalloffOffset = 0x2C;
    private const int FalloffExponentOffset = 0x30;
    private const int VolumeIntensityOffset = 0x4C;
    private const int VolumeSizeScaleOffset = 0x50;
    private const int VolumeOuterColorOffset = 0x54;
    private const int CoronaSizeOffset = 0x5C;
    private const int CoronaIntensityOffset = 0x6C;

    /* Бит уличного фонаря во флагах состояния LOD-огня (бит 24): им игра
       считает `numStreetLights` парного файла. */
    private const uint StreetLightBit = 1u << 24;

    /* ---------- опись ---------- */

    public static object Inspect(IReadOnlyList<LampStudioModel>? models)
    {
        if (models is null || models.Count is < 1 or > MaxModels)
            throw new InvalidDataException($"lamp-studio-inspect needs 1-{MaxModels} models.");
        RpfManager.IsGen9 = false;
        var result = new List<object>();
        foreach (var model in models)
        {
            var file = RequireFile(model.File);
            var bytes = File.ReadAllBytes(file);
            var resource = OpenResource(bytes, Path.GetFileName(file));
            var lights = new List<object>();
            foreach (var (listId, list) in LightLists(resource))
            {
                var items = list.data_items ?? [];
                for (var index = 0; index < items.Length; index++)
                    lights.Add(Describe(listId, index, items[index]));
            }
            result.Add(new
            {
                model = model.Model,
                entry = model.Entry,
                sha256 = Sha256(bytes),
                bytes = bytes.Length,
                lights,
            });
        }
        return new { status = "ready", mode = "lamp-studio-inspect", models = result };
    }

    private static object Describe(string list, int index, LightAttributes light) => new
    {
        list,
        index,
        type = light.Type.ToString().ToLowerInvariant(),
        flags = light.Flags,
        timeFlags = light.TimeFlags,
        /* Лампа фрагмента стоит в пространстве своей кости (плафон столба):
           позиция — от кости, и частицы у лампы цепляются к той же кости. */
        bone = light.BoneId,
        color = new { r = light.ColorR, g = light.ColorG, b = light.ColorB },
        intensity = Finite(light.Intensity),
        falloff = Finite(light.Falloff),
        falloffExponent = Finite(light.FalloffExponent),
        corona = new { intensity = Finite(light.CoronaIntensity), size = Finite(light.CoronaSize) },
        volume = new
        {
            intensity = Finite(light.VolumeIntensity),
            sizeScale = Finite(light.VolumeSizeScale),
            outerColor = new { r = light.VolumeOuterColorR, g = light.VolumeOuterColorG, b = light.VolumeOuterColorB },
        },
        position = new { x = Finite(light.Position.X), y = Finite(light.Position.Y), z = Finite(light.Position.Z) },
        direction = new { x = Finite(light.Direction.X), y = Finite(light.Direction.Y), z = Finite(light.Direction.Z) },
        coneOuterAngle = Finite(light.ConeOuterAngle),
    };

    /* ---------- свет моделей ---------- */

    public static async Task<object> PatchModelsAsync(IReadOnlyList<LampStudioModelPatch>? patches)
    {
        if (patches is null || patches.Count is < 1 or > MaxModels)
            throw new InvalidDataException($"lamp-studio-patch needs 1-{MaxModels} models.");
        RpfManager.IsGen9 = false;
        var reports = new List<object>();
        foreach (var patch in patches)
        {
            var input = RequireFile(patch.Input);
            var output = RequireOutput(patch.Output, input);
            var mutations = patch.Mutations ?? [];
            var textureRequests = patch.Textures ?? [];
            if (mutations.Count > MaxMutationsPerModel || textureRequests.Count > MaxTexturesPerModel ||
                mutations.Count + textureRequests.Count == 0)
                throw new InvalidDataException(
                    $"{patch.Model}: up to {MaxMutationsPerModel} light mutations and {MaxTexturesPerModel} textures, at least one of them.");
            var bytes = await File.ReadAllBytesAsync(input);
            var resource = OpenResource(bytes, Path.GetFileName(input));
            var lists = LightLists(resource).ToDictionary(item => item.Id, item => item.List, StringComparer.Ordinal);
            var patched = (byte[])resource.Data.Clone();
            var touched = new List<(long Start, int Length)>();
            var seen = new HashSet<(string, int)>();
            foreach (var mutation in mutations)
            {
                if (!seen.Add((mutation.List ?? string.Empty, mutation.Index)))
                    throw new InvalidDataException($"{patch.Model}: light {mutation.List}#{mutation.Index} is mutated twice.");
                if (!lists.TryGetValue(mutation.List ?? string.Empty, out var list))
                    throw new InvalidDataException($"{patch.Model}: no light list {mutation.List}.");
                var items = list.data_items ?? [];
                if (mutation.Index < 0 || mutation.Index >= items.Length)
                    throw new InvalidDataException($"{patch.Model}: light {mutation.Index} is out of range.");
                var offset = LightOffset(list, mutation.Index, resource);
                var light = items[mutation.Index];
                /* Сверка места: по этому смещению лежит именно та лампа, что
                   прочитал CodeWalker. Иначе правка ушла бы в чужие байты. */
                if (patched[offset + ColorOffset] != light.ColorR ||
                    patched[offset + ColorOffset + 1] != light.ColorG ||
                    patched[offset + ColorOffset + 2] != light.ColorB ||
                    BitConverter.ToUInt32(patched, (int)offset + FlagsOffset) != light.Flags ||
                    BitConverter.ToSingle(patched, (int)offset + IntensityOffset) != light.Intensity)
                    throw new InvalidDataException($"{patch.Model}: light {mutation.Index} is not where the resource says.");
                WriteMutation(patched, offset, light, mutation, touched);
            }
            /*
             * Стекло: встроенная текстура светящегося шейдера заменяется байтами
             * той же длины на своём месте — формат, размер и число уровней
             * обязаны совпасть, иначе замена не встанет в раскладку ресурса.
             */
            var written = new List<(string Name, byte[] Data)>();
            if (textureRequests.Count > 0)
            {
                var drawable = LoadDrawable(resource);
                foreach (var request in textureRequests)
                {
                    var texture = FindEmbedded(drawable, request.Name)
                        ?? throw new InvalidDataException($"{patch.Model}: no embedded texture {request.Name}.");
                    var original = texture.Data?.FullData
                        ?? throw new InvalidDataException($"{patch.Model}: texture {request.Name} has no data.");
                    var replacement = DDSIO.GetTexture(await File.ReadAllBytesAsync(RequireFile(request.Source)));
                    if (replacement.Format != texture.Format || replacement.Width != texture.Width ||
                        replacement.Height != texture.Height || replacement.Levels != texture.Levels)
                        throw new InvalidDataException(
                            $"{patch.Model}: texture {request.Name} must stay {texture.Format} {texture.Width}x{texture.Height}, {texture.Levels} levels.");
                    var data = replacement.Data?.FullData ?? [];
                    if (data.Length < original.Length)
                        throw new InvalidDataException($"{patch.Model}: texture {request.Name} replacement is shorter than the original.");
                    var glassBytes = data.AsSpan(0, original.Length).ToArray();
                    var offset = TextureOffset(texture, resource);
                    Buffer.BlockCopy(glassBytes, 0, patched, (int)offset, glassBytes.Length);
                    touched.Add((offset, glassBytes.Length));
                    written.Add((texture.Name, glassBytes));
                }
            }
            var outputBytes = ResourceBuilder.AddResourceHeader(resource.Entry, ResourceBuilder.Compress(patched));
            VerifyPatchedModel(patch, resource, outputBytes, touched, written);
            var staged = $"{output}.lamp-{Guid.NewGuid():N}";
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            try
            {
                await File.WriteAllBytesAsync(staged, outputBytes);
                File.Move(staged, output, overwrite: true);
            }
            catch
            {
                if (File.Exists(staged)) File.Delete(staged);
                throw;
            }
            reports.Add(new
            {
                model = patch.Model,
                output,
                inputSha256 = Sha256(bytes),
                outputSha256 = Sha256(outputBytes),
                outputBytes = outputBytes.Length,
                lights = mutations.Count,
                textures = written.Count,
                changedBytes = touched.Sum(item => item.Length),
            });
        }
        return new
        {
            status = "ready",
            mode = "lamp-studio-patch",
            models = reports,
            validation = new { reopened = true, onlyLightAndGlassBytesChanged = true, exactValues = true },
        };
    }

    /* ---------- стекло ---------- */

    /// <summary>
    /// Текстуры светящегося стекла моделей — DDS в папку: окно перекрашивает
    /// их в цвет света и отдаёт обратно в <c>lamp-studio-patch</c>. Стекло —
    /// встроенная текстура <c>diffusesampler</c> шейдера с
    /// <c>emissivemultiplier</c>; <c>shared</c> — её же берёт несветящийся
    /// шейдер (тогда перекраска задела бы корпус, и окно её не трогает).
    /// </summary>
    public static object ExportGlass(IReadOnlyList<LampStudioGlassModel>? models)
    {
        if (models is null || models.Count is < 1 or > MaxModels)
            throw new InvalidDataException($"lamp-studio-glass needs 1-{MaxModels} models.");
        RpfManager.IsGen9 = false;
        var result = new List<object>();
        foreach (var model in models)
        {
            var file = RequireFile(model.File);
            var output = (model.Output ?? string.Empty).Trim();
            if (!Path.IsPathFullyQualified(output))
                throw new InvalidDataException($"Glass output folder must be absolute: {model.Output}");
            Directory.CreateDirectory(output);
            var resource = OpenResource(File.ReadAllBytes(file), Path.GetFileName(file));
            var drawable = LoadDrawable(resource);
            var textures = new List<object>();
            foreach (var (texture, shared) in GlassTextures(drawable))
            {
                var name = $"{SafeName(model.Model)}__{SafeName(texture.Name)}.dds";
                var path = Path.Combine(output, name);
                File.WriteAllBytes(path, DDSIO.GetDDSFile(texture));
                textures.Add(new
                {
                    name = texture.Name,
                    format = texture.Format.ToString(),
                    width = (int)texture.Width,
                    height = (int)texture.Height,
                    levels = (int)texture.Levels,
                    bytes = texture.Data?.FullData?.Length ?? 0,
                    file = path,
                    shared,
                });
            }
            result.Add(new { model = model.Model, textures });
        }
        return new { status = "ready", mode = "lamp-studio-glass", models = result };
    }

    private static readonly uint EmissiveMultiplierHash = JenkHash.GenHash("emissivemultiplier");
    private static readonly uint DiffuseSamplerHash = JenkHash.GenHash("diffusesampler");

    private static IEnumerable<(Texture Texture, bool Shared)> GlassTextures(DrawableBase? drawable)
    {
        var dictionary = drawable?.ShaderGroup?.TextureDictionary;
        var shaders = drawable?.ShaderGroup?.Shaders?.data_items ?? [];
        if (dictionary?.Textures?.data_items is null) yield break;
        var glass = new List<uint>();
        var other = new HashSet<uint>();
        foreach (var shader in shaders)
        {
            var list = shader?.ParametersList;
            if (list?.Hashes is null || list.Parameters is null) continue;
            var emissive = list.Hashes.Any(hash => (uint)hash == EmissiveMultiplierHash);
            for (var index = 0; index < Math.Min(list.Hashes.Length, list.Parameters.Length); index++)
            {
                if (list.Parameters[index].Data is not TextureBase texture) continue;
                if (emissive && (uint)list.Hashes[index] == DiffuseSamplerHash)
                {
                    if (!glass.Contains(texture.NameHash)) glass.Add(texture.NameHash);
                }
                else other.Add(texture.NameHash);
            }
        }
        foreach (var hash in glass)
        {
            var texture = dictionary.Lookup(hash);
            if (texture?.Data?.FullData is null) continue;
            yield return (texture, other.Contains(hash));
        }
    }

    private static DrawableBase? LoadDrawable(LampResource resource)
    {
        var name = resource.Name.ToLowerInvariant();
        if (name.EndsWith(".yft", StringComparison.Ordinal))
        {
            var yft = new YftFile();
            yft.Load(resource.Data, resource.Entry);
            return yft.Fragment?.Drawable;
        }
        if (name.EndsWith(".ydr", StringComparison.Ordinal))
        {
            var ydr = new YdrFile();
            ydr.Load(resource.Data, resource.Entry);
            return ydr.Drawable;
        }
        throw new InvalidDataException($"{resource.Name}: glass lives in .yft and .ydr only.");
    }

    private static Texture? FindEmbedded(DrawableBase? drawable, string name)
    {
        var items = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items ?? [];
        return items.FirstOrDefault(texture => string.Equals(texture?.Name, name, StringComparison.OrdinalIgnoreCase));
    }

    private static long TextureOffset(Texture texture, LampResource resource)
    {
        var pointer = (long)texture.DataPointer;
        if ((pointer & 0xF0000000L) != GraphicsBase)
            throw new InvalidDataException($"{resource.Name}: texture {texture.Name} does not live in graphics memory.");
        var offset = resource.Entry.SystemSize + (pointer - GraphicsBase);
        var length = texture.Data?.FullData?.Length ?? 0;
        if (offset < resource.Entry.SystemSize || offset + length > resource.Data.Length)
            throw new InvalidDataException($"{resource.Name}: texture {texture.Name} lies outside the resource.");
        return offset;
    }

    private static string SafeName(string? value) =>
        System.Text.RegularExpressions.Regex.Replace(value ?? "texture", "[^A-Za-z0-9_.-]+", "_");

    private static void WriteMutation(
        byte[] data,
        long offset,
        LightAttributes light,
        LampStudioMutation mutation,
        List<(long Start, int Length)> touched)
    {
        void Bytes(int field, params byte[] values)
        {
            Buffer.BlockCopy(values, 0, data, (int)(offset + field), values.Length);
            touched.Add((offset + field, values.Length));
        }
        void Float(int field, float value, float min, float max, string name)
        {
            if (!float.IsFinite(value) || value < min || value > max)
                throw new InvalidDataException($"Light {name} {value} is outside {min}…{max}.");
            Bytes(field, BitConverter.GetBytes(value));
        }
        if (mutation.Color is { } color) Bytes(ColorOffset, color.R, color.G, color.B);
        if (mutation.Intensity is float intensity) Float(IntensityOffset, intensity, 0f, 1000f, "intensity");
        if (mutation.Falloff is float falloff) Float(FalloffOffset, falloff, 0.05f, 500f, "falloff");
        if (mutation.FalloffExponent is float exponent) Float(FalloffExponentOffset, exponent, 0.01f, 256f, "falloffExponent");
        if (mutation.CoronaIntensity is float corona) Float(CoronaIntensityOffset, corona, 0f, 1000f, "coronaIntensity");
        if (mutation.CoronaSize is float coronaSize) Float(CoronaSizeOffset, coronaSize, 0f, 1000f, "coronaSize");
        if (mutation.VolumeIntensity is float volume) Float(VolumeIntensityOffset, volume, 0f, 100f, "volumeIntensity");
        if (mutation.VolumeSizeScale is float size) Float(VolumeSizeScaleOffset, size, 0f, 100f, "volumeSizeScale");
        if (mutation.VolumeOuterColor is { } outer) Bytes(VolumeOuterColorOffset, outer.R, outer.G, outer.B);
        if (mutation.FlagsSet is uint set)
        {
            /* Ставить разрешено только флаги луча: DRAW_VOLUME и собственный
               цвет объёма. Остальные флаги лампы — её устройство, не стиль. */
            const uint allowed = 0x1000u | 0x80000u;
            if ((set & ~allowed) != 0)
                throw new InvalidDataException($"Light flags 0x{set:X} are not allowed to be set.");
            Bytes(FlagsOffset, BitConverter.GetBytes(light.Flags | set));
        }
    }

    private static void VerifyPatchedModel(
        LampStudioModelPatch patch,
        LampResource original,
        byte[] outputBytes,
        List<(long Start, int Length)> touched,
        List<(string Name, byte[] Data)> textures)
    {
        var reopened = OpenResource(outputBytes, Path.GetFileName(patch.Output));
        if (reopened.Entry.SystemFlags != original.Entry.SystemFlags ||
            reopened.Entry.GraphicsFlags != original.Entry.GraphicsFlags ||
            reopened.Data.Length != original.Data.Length)
            throw new InvalidDataException($"{patch.Model}: patched resource changed its page layout.");
        var allowed = new bool[original.Data.Length];
        foreach (var (start, length) in touched)
            for (var index = 0; index < length; index++) allowed[start + index] = true;
        for (var index = 0; index < original.Data.Length; index++)
            if (!allowed[index] && reopened.Data[index] != original.Data[index])
                throw new InvalidDataException($"{patch.Model}: byte 0x{index:X} outside the light fields changed.");
        var before = LightLists(original).ToDictionary(item => item.Id, item => item.List.data_items ?? [], StringComparer.Ordinal);
        var after = LightLists(reopened).ToDictionary(item => item.Id, item => item.List.data_items ?? [], StringComparer.Ordinal);
        if (before.Count != after.Count || before.Any(pair => !after.TryGetValue(pair.Key, out var list) || list.Length != pair.Value.Length))
            throw new InvalidDataException($"{patch.Model}: patched resource changed its light lists.");
        if (textures.Count > 0)
        {
            var drawable = LoadDrawable(reopened);
            foreach (var (name, data) in textures)
            {
                var texture = FindEmbedded(drawable, name);
                if (texture?.Data?.FullData is not { } full || !full.AsSpan().SequenceEqual(data))
                    throw new InvalidDataException($"{patch.Model}: texture {name} did not land.");
            }
        }
        foreach (var mutation in patch.Mutations ?? [])
        {
            var light = after[mutation.List][mutation.Index];
            var source = before[mutation.List][mutation.Index];
            void Same(float? expected, float actual, string field)
            {
                if (expected is float value && BitConverter.SingleToInt32Bits(value) != BitConverter.SingleToInt32Bits(actual))
                    throw new InvalidDataException($"{patch.Model}: light {mutation.Index} {field} did not land.");
            }
            if (mutation.Color is { } color && (light.ColorR, light.ColorG, light.ColorB) != (color.R, color.G, color.B))
                throw new InvalidDataException($"{patch.Model}: light {mutation.Index} colour did not land.");
            Same(mutation.Intensity, light.Intensity, "intensity");
            Same(mutation.Falloff, light.Falloff, "falloff");
            Same(mutation.FalloffExponent, light.FalloffExponent, "falloffExponent");
            Same(mutation.CoronaIntensity, light.CoronaIntensity, "coronaIntensity");
            Same(mutation.CoronaSize, light.CoronaSize, "coronaSize");
            Same(mutation.VolumeIntensity, light.VolumeIntensity, "volumeIntensity");
            Same(mutation.VolumeSizeScale, light.VolumeSizeScale, "volumeSizeScale");
            if (mutation.FlagsSet is uint set && light.Flags != (source.Flags | set))
                throw new InvalidDataException($"{patch.Model}: light {mutation.Index} flags did not land.");
            if (light.Type != source.Type || light.Position != source.Position || light.Direction != source.Direction)
                throw new InvalidDataException($"{patch.Model}: light {mutation.Index} moved.");
        }
    }

    /* ---------- огни вдали ---------- */

    public static async Task<object> PatchLodAsync(IReadOnlyList<LampStudioLodPair>? pairs, LampStudioLodRule? rule)
    {
        if (pairs is null || pairs.Count is < 1 or > MaxLodPairs)
            throw new InvalidDataException($"lamp-studio-lod needs 1-{MaxLodPairs} pairs.");
        if (rule is null) throw new InvalidDataException("lamp-studio-lod needs a rule.");
        RpfManager.IsGen9 = false;
        var streetOnly = rule.StreetOnly ?? true;
        var signatures = rule.Signatures ?? [];
        if (signatures.Count > MaxLodSignatures)
            throw new InvalidDataException($"lamp-studio-lod accepts at most {MaxLodSignatures} signatures.");
        var extra = ExtraPoints.From(rule.Extra);
        var reports = new List<object>();
        var totalChanged = 0;
        foreach (var pair in pairs)
        {
            var lodInput = RequireFile(pair.LodInput);
            var distantInput = RequireFile(pair.DistantInput);
            var lodOutput = RequireOutput(pair.LodOutput, lodInput);
            var distantOutput = RequireOutput(pair.DistantOutput, distantInput);
            var lodBytes = await File.ReadAllBytesAsync(lodInput);
            var distantBytes = await File.ReadAllBytesAsync(distantInput);
            var lod = OpenYmap(lodBytes, Path.GetFileName(lodInput));
            var distant = OpenYmap(distantBytes, Path.GetFileName(distantInput));
            /* Пара, которую нельзя править уверенно (пустая, чужой формы,
               с несходящимися массивами), не роняет остальные двести: она
               остаётся как лежит, а отчёт называет её и причину. */
            void Skip(string reason) => reports.Add(new
            {
                lod = Path.GetFileName(lodInput),
                distant = Path.GetFileName(distantInput),
                skipped = reason,
                changed = 0,
            });
            var lodLights = lod.Ymap.LODLights;
            var distantLights = distant.Ymap.DistantLODLights;
            if (lodLights is null || distantLights is null)
            {
                Skip("no-lod-lights");
                continue;
            }
            var soa = lodLights.CLODLight;
            var dsoa = distantLights.CDistantLODLight;
            var falloffs = lodLights.falloff ?? [];
            var count = falloffs.Length;
            if (count == 0)
            {
                Skip("no-lod-lights");
                continue;
            }
            if (lodLights.falloffExponent?.Length != count ||
                lodLights.timeAndStateFlags?.Length != count ||
                lodLights.coronaIntensity?.Length != count ||
                distantLights.colours?.Length != count)
            {
                Skip("arrays-not-aligned");
                continue;
            }

            var lodPatched = (byte[])lod.Data.Clone();
            var distantPatched = (byte[])distant.Data.Clone();
            var lodTouched = new List<(long, int)>();
            var distantTouched = new List<(long, int)>();
            var falloffAt = ArrayOffset(lod.Ymap.Meta, soa.falloff.Pointer, 4, count, lod);
            var exponentAt = ArrayOffset(lod.Ymap.Meta, soa.falloffExponent.Pointer, 4, count, lod);
            var coronaAt = ArrayOffset(lod.Ymap.Meta, soa.coronaIntensity.Pointer, 1, count, lod);
            var colourAt = ArrayOffset(distant.Ymap.Meta, dsoa.RGBI.Pointer, 4, count, distant);
            var streets = 0;
            var changed = 0;
            var positions = distantLights.positions;
            if (extra is not null && positions?.Length != count)
            {
                Skip("arrays-not-aligned");
                continue;
            }
            for (var index = 0; index < count; index++)
            {
                var street = (lodLights.timeAndStateFlags[index] & StreetLightBit) != 0;
                if (street) streets++;
                /* Лампы на мачтах светофоров: бита улицы у них нет, а подпись —
                   их (см. CROSSING_LOD_SIGNATURES контракта). */
                var crossing = !street && MatchesSignature(signatures, falloffs[index], lodLights.falloffExponent[index]);
                if (streetOnly && !street && !crossing)
                {
                    /* Лампы под мостами и в тоннелях — по месту, только цвет. */
                    if (extra is not null && extra.Near(positions![index]))
                    {
                        var packedExtra = distantLights.colours[index];
                        var nextExtra = (packedExtra & 0xFF000000u) | ((uint)extra.Color.R << 16) |
                            ((uint)extra.Color.G << 8) | extra.Color.B;
                        if (nextExtra != packedExtra)
                        {
                            WriteAt(distantPatched, colourAt + index * 4L, BitConverter.GetBytes(nextExtra), distantTouched);
                            changed++;
                        }
                    }
                    continue;
                }
                var any = false;
                var packed = distantLights.colours[index];
                var intensity = (byte)(packed >> 24);
                var r = (byte)(packed >> 16);
                var g = (byte)(packed >> 8);
                var b = (byte)packed;
                if (NearestPaletteColour(rule.Palette, falloffs[index], lodLights.falloffExponent[index]) is { } paletteColour)
                    (r, g, b) = (paletteColour.R, paletteColour.G, paletteColour.B);
                else if (rule.Color is { } colour) (r, g, b) = (colour.R, colour.G, colour.B);
                if (rule.IntensityScale is float scale)
                    intensity = (byte)Math.Min(255, Math.Floor(intensity * Bounded(scale, 0f, 8f, "intensityScale")));
                var nextPacked = ((uint)intensity << 24) | ((uint)r << 16) | ((uint)g << 8) | b;
                if (nextPacked != packed)
                {
                    WriteAt(distantPatched, colourAt + index * 4L, BitConverter.GetBytes(nextPacked), distantTouched);
                    any = true;
                }
                if (rule.FalloffScale is float falloffScale)
                {
                    var next = Math.Clamp(falloffs[index] * Bounded(falloffScale, 0.05f, 8f, "falloffScale"), 0.1f, 250f);
                    WriteAt(lodPatched, falloffAt + index * 4L, BitConverter.GetBytes(next), lodTouched);
                    any = true;
                }
                if (rule.ExponentScale is float exponentScale)
                {
                    var next = Math.Clamp(lodLights.falloffExponent[index] * Bounded(exponentScale, 0.05f, 8f, "exponentScale"), 1f, 128f);
                    WriteAt(lodPatched, exponentAt + index * 4L, BitConverter.GetBytes(next), lodTouched);
                    any = true;
                }
                if (rule.CoronaScale is float coronaScale)
                {
                    var next = (byte)Math.Clamp(Math.Round(lodLights.coronaIntensity[index] * Bounded(coronaScale, 0f, 8f, "coronaScale")), 0, 255);
                    if (next != lodLights.coronaIntensity[index])
                    {
                        WriteAt(lodPatched, coronaAt + index, [next], lodTouched);
                        any = true;
                    }
                }
                if (any) changed++;
            }
            if (dsoa.numStreetLights != streets)
            {
                /* Флаги улиц не сходятся со счётчиком пары — значит, бит
                   значит в этом файле не то, что в штатных, и красить по нему
                   «улицы» нельзя. */
                Skip("street-count-mismatch");
                continue;
            }
            if (changed == 0)
            {
                /* Править нечего: файл не пересобирается и не пишется, иначе
                   пересжатие дало бы «другой» файл с теми же данными. */
                reports.Add(new
                {
                    lod = Path.GetFileName(lodInput),
                    distant = Path.GetFileName(distantInput),
                    lights = count,
                    streetLights = streets,
                    changed = 0,
                });
                continue;
            }

            var lodOut = ResourceBuilder.AddResourceHeader(lod.Entry, ResourceBuilder.Compress(lodPatched));
            var distantOut = ResourceBuilder.AddResourceHeader(distant.Entry, ResourceBuilder.Compress(distantPatched));
            VerifyBytes(Path.GetFileName(lodInput), lod, lodOut, lodTouched);
            VerifyBytes(Path.GetFileName(distantInput), distant, distantOut, distantTouched);
            await WriteAtomic(lodOutput, lodOut);
            await WriteAtomic(distantOutput, distantOut);
            totalChanged += changed;
            reports.Add(new
            {
                lod = Path.GetFileName(lodInput),
                distant = Path.GetFileName(distantInput),
                lights = count,
                streetLights = streets,
                changed,
                lodSha256 = Sha256(lodOut),
                distantSha256 = Sha256(distantOut),
            });
        }
        return new
        {
            status = "ready",
            mode = "lamp-studio-lod",
            pairs = reports,
            changed = totalChanged,
            validation = new { reopened = true, onlyLightBytesChanged = true, streetCountsMatch = true },
        };
    }

    /*
     * Радуга: огонь вдали узнаёт вид своей лампы по радиусу и показателю —
     * они у него те же, что у модели, от которой он построен. Ближайшая по
     * логарифму подпись палитры даёт цвет; окно считает ту же меру
     * (`lodColourFor` в compile.js).
     */
    private const int MaxLodSignatures = 16;
    private const int MaxExtraPoints = 4096;

    private static bool MatchesSignature(IReadOnlyList<LampStudioLodSignature> signatures, float falloff, float exponent)
    {
        foreach (var signature in signatures)
            if (Math.Abs(falloff - signature.Falloff) <= 0.05f && Math.Abs(exponent - signature.Exponent) <= 0.5f)
                return true;
        return false;
    }

    /// <summary>Точки огней вдали под мостами: сетка по 2 м для поиска соседей.</summary>
    private sealed class ExtraPoints
    {
        private const float Cell = 2f;
        private readonly Dictionary<(int, int, int), List<(float X, float Y, float Z)>> grid = new();
        private float radius;

        public LampRgb Color { get; private init; } = new(0, 0, 0);

        public static ExtraPoints? From(LampStudioLodExtra? extra)
        {
            if (extra?.Color is not { } colour || extra.Points is not { Count: > 0 } points) return null;
            if (points.Count % 3 != 0 || points.Count / 3 > MaxExtraPoints)
                throw new InvalidDataException($"lamp-studio-lod extra points must be x,y,z triples, at most {MaxExtraPoints}.");
            var result = new ExtraPoints { Color = colour };
            result.radius = Bounded(extra.Radius ?? 0.6f, 0.05f, 2f, "extra.radius");
            for (var at = 0; at < points.Count; at += 3)
            {
                var point = (points[at], points[at + 1], points[at + 2]);
                if (!float.IsFinite(point.Item1) || !float.IsFinite(point.Item2) || !float.IsFinite(point.Item3))
                    throw new InvalidDataException("lamp-studio-lod extra point is not finite.");
                var key = Key(point.Item1, point.Item2, point.Item3);
                if (!result.grid.TryGetValue(key, out var list)) result.grid[key] = list = [];
                list.Add(point);
            }
            return result;
        }

        private static (int, int, int) Key(float x, float y, float z) =>
            ((int)MathF.Floor(x / Cell), (int)MathF.Floor(y / Cell), (int)MathF.Floor(z / Cell));

        public bool Near(MetaVECTOR3 position)
        {
            var (cx, cy, cz) = Key(position.x, position.y, position.z);
            for (var dx = -1; dx <= 1; dx++)
                for (var dy = -1; dy <= 1; dy++)
                    for (var dz = -1; dz <= 1; dz++)
                    {
                        if (!grid.TryGetValue((cx + dx, cy + dy, cz + dz), out var list)) continue;
                        foreach (var (x, y, z) in list)
                        {
                            var ddx = x - position.x;
                            var ddy = y - position.y;
                            var ddz = z - position.z;
                            if (ddx * ddx + ddy * ddy + ddz * ddz <= radius * radius) return true;
                        }
                    }
            return false;
        }
    }

    private static LampRgb? NearestPaletteColour(IReadOnlyList<LampStudioLodPaletteEntry>? palette, float falloff, float exponent)
    {
        if (palette is null || palette.Count == 0) return null;
        LampRgb? best = null;
        var bestScore = double.MaxValue;
        foreach (var entry in palette)
        {
            var score = Math.Abs(Math.Log(Math.Max(falloff, 0.01f) / Math.Max(entry.Falloff, 0.01f))) +
                Math.Abs(Math.Log(Math.Max(exponent, 0.01f) / Math.Max(entry.Exponent, 0.01f)));
            if (score < bestScore)
            {
                bestScore = score;
                best = entry.Color;
            }
        }
        return best;
    }

    /* ---------- частицы у ламп: описание пропов ---------- */

    public static async Task<object> PatchYtypAsync(
        string? inputFile,
        string? outputFile,
        IReadOnlyList<LampStudioExtension>? extensions,
        string? prefix)
    {
        var input = RequireFile(inputFile);
        var output = RequireOutput(outputFile, input);
        var tag = (prefix ?? string.Empty).Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(tag, "^[A-Za-z][A-Za-z0-9_]{3,40}$"))
            throw new InvalidDataException("lamp-studio-ytyp needs a particle tag prefix.");
        var wanted = extensions ?? [];
        if (wanted.Count > MaxExtensions)
            throw new InvalidDataException($"lamp-studio-ytyp accepts at most {MaxExtensions} archetypes.");
        RpfManager.IsGen9 = false;
        var bytes = await File.ReadAllBytesAsync(input);
        var ytyp = OpenYtyp(bytes, Path.GetFileName(input));
        var originalXml = StripOurs(MetaXml.GetXml(ytyp, out _), tag);
        bool Ours(MetaWrapper wrapper) =>
            wrapper is MCExtensionDefParticleEffect particle &&
            (particle.fxName ?? string.Empty).StartsWith(tag, StringComparison.OrdinalIgnoreCase);

        var byHash = new Dictionary<uint, Archetype>();
        foreach (var archetype in ytyp.AllArchetypes ?? [])
        {
            var kept = (archetype.Extensions ?? []).Where(item => !Ours(item)).ToArray();
            SetExtensions(archetype, kept);
            byHash[archetype.Hash.Hash] = archetype;
        }
        var added = 0;
        var missing = new List<string>();
        foreach (var request in wanted)
        {
            var name = (request.Archetype ?? string.Empty).Trim().ToLowerInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9_]{1,64}$"))
                throw new InvalidDataException($"Archetype name is invalid: {request.Archetype}");
            var fx = (request.FxName ?? string.Empty).Trim().ToLowerInvariant();
            if (!fx.StartsWith(tag, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Particle tag must start with {tag}: {request.FxName}");
            if (request.Points is null || request.Points.Count is < 1 or > 4)
                throw new InvalidDataException($"{name}: 1-4 particle points are required.");
            if (request.Probability is < 1 or > 100)
                throw new InvalidDataException($"{name}: probability must be 1-100.");
            if (!byHash.TryGetValue(JenkHash.GenHash(name), out var archetype))
            {
                missing.Add(name);
                continue;
            }
            var list = (archetype.Extensions ?? []).ToList();
            foreach (var point in request.Points)
            {
                if (!float.IsFinite(point.X) || !float.IsFinite(point.Y) || !float.IsFinite(point.Z) ||
                    Math.Abs(point.X) > 64 || Math.Abs(point.Y) > 64 || Math.Abs(point.Z) > 64)
                    throw new InvalidDataException($"{name}: particle point is outside the model.");
                list.Add(new MCExtensionDefParticleEffect
                {
                    fxName = fx,
                    _Data = new CExtensionDefParticleEffect
                    {
                        name = archetype.Hash,
                        offsetPosition = new SharpDX.Vector3(point.X, point.Y, point.Z),
                        offsetRotation = new SharpDX.Vector4(0, 0, 0, 1),
                        fxType = 0,
                        boneTag = point.Bone is >= 0 and <= 65535
                            ? point.Bone
                            : throw new InvalidDataException($"{name}: bone tag {point.Bone} is invalid."),
                        scale = 1f,
                        probability = request.Probability,
                        flags = 0,
                        color = 0xFFFFFFFF,
                    },
                });
                added++;
            }
            SetExtensions(archetype, list.ToArray());
        }

        var outputBytes = ytyp.Save();
        var reopened = OpenYtyp(outputBytes, Path.GetFileName(output));
        var reopenedXml = MetaXml.GetXml(reopened, out _);
        if (StripOurs(reopenedXml, tag) != originalXml)
            throw new InvalidDataException("Archetype file changed outside the Astral particle extensions.");
        var landed = (reopened.AllArchetypes ?? [])
            .SelectMany(item => item.Extensions ?? [])
            .Count(Ours);
        if (landed != added)
            throw new InvalidDataException($"Archetype file carries {landed} Astral particles, expected {added}.");
        await WriteAtomic(output, outputBytes);
        return new
        {
            status = "ready",
            mode = "lamp-studio-ytyp",
            output,
            inputSha256 = Sha256(bytes),
            outputSha256 = Sha256(outputBytes),
            archetypes = reopened.AllArchetypes?.Length ?? 0,
            added,
            missing,
            validation = new { reopened = true, onlyAstralParticlesChanged = true },
        };
    }

    /* Расширения архетипа: CodeWalker пишет их, только если у записи
       архетипа ненулевой счётчик, — поэтому счётчик выставляется здесь же,
       и у архетипа по часам — в обеих копиях записи. */
    private static void SetExtensions(Archetype archetype, MetaWrapper[] extensions)
    {
        archetype.Extensions = extensions.Length > 0 ? extensions : null;
        var pointer = new Array_StructurePointer
        {
            Count1 = (ushort)extensions.Length,
            Count2 = (ushort)extensions.Length,
        };
        var definition = archetype._BaseArchetypeDef;
        definition.extensions = pointer;
        archetype._BaseArchetypeDef = definition;
        if (archetype is TimeArchetype timed)
        {
            var time = timed._TimeArchetypeDef;
            var inner = time._BaseArchetypeDef;
            inner.extensions = pointer;
            time._BaseArchetypeDef = inner;
            timed._TimeArchetypeDef = time;
        }
    }

    private static string StripOurs(string xml, string tag)
    {
        var document = XDocument.Parse(xml, LoadOptions.None);
        var ours = document
            .Descendants("Item")
            .Where(item =>
                (string?)item.Attribute("type") == "CExtensionDefParticleEffect" &&
                ((string?)item.Element("fxName") ?? string.Empty).StartsWith(tag, StringComparison.OrdinalIgnoreCase))
            .ToList();
        foreach (var item in ours) item.Remove();
        return document.ToString(SaveOptions.DisableFormatting);
    }

    /* ---------- общее ---------- */

    private sealed record LampResource(RpfResourceFileEntry Entry, byte[] Data, string Name);

    private sealed record LampYmap(RpfResourceFileEntry Entry, byte[] Data, YmapFile Ymap);

    private static LampResource OpenResource(byte[] fileBytes, string name)
    {
        var raw = (byte[])fileBytes.Clone();
        if (raw.Length < 16 || BitConverter.ToUInt32(raw, 0) != 0x37435352)
            throw new InvalidDataException($"{name} is not an RSC7 resource.");
        var entry = RpfFile.CreateResourceFileEntry(ref raw, 0)
            ?? throw new InvalidDataException($"{name} has no resource header.");
        entry.Name = name;
        entry.NameLower = name.ToLowerInvariant();
        /* Не дальше заявленного в заголовке (бета 15.10.2026, OutOfMemory на ypt редукса). */
        var data = ResourceBuilder.DecompressResource(raw, entry, name);
        if (data is not { Length: > 0 })
            throw new InvalidDataException($"{name} could not be decompressed.");
        return new LampResource(entry, data, name);
    }

    private static LampYmap OpenYmap(byte[] fileBytes, string name)
    {
        var resource = OpenResource(fileBytes, name);
        var ymap = new YmapFile();
        ymap.Load(resource.Data, resource.Entry);
        if (ymap.Meta is null) throw new InvalidDataException($"{name} is not a map meta resource.");
        return new LampYmap(resource.Entry, resource.Data, ymap);
    }

    private static YtypFile OpenYtyp(byte[] fileBytes, string name)
    {
        var resource = OpenResource(fileBytes, name);
        var ytyp = new YtypFile();
        ytyp.Load(resource.Data, resource.Entry);
        if (ytyp.AllArchetypes is null) throw new InvalidDataException($"{name} has no archetypes.");
        return ytyp;
    }

    private static IEnumerable<(string Id, ResourceSimpleList64<LightAttributes> List)> LightLists(LampResource resource)
    {
        var name = resource.Name.ToLowerInvariant();
        if (name.EndsWith(".yft", StringComparison.Ordinal))
        {
            var yft = new YftFile();
            yft.Load(resource.Data, resource.Entry);
            if (yft.Fragment?.LightAttributes is { } fragment) yield return ("fragment", fragment);
        }
        else if (name.EndsWith(".ydr", StringComparison.Ordinal))
        {
            var ydr = new YdrFile();
            ydr.Load(resource.Data, resource.Entry);
            if (ydr.Drawable?.LightAttributes is { } drawable) yield return ("drawable", drawable);
        }
        else if (name.EndsWith(".ydd", StringComparison.Ordinal))
        {
            var ydd = new YddFile();
            ydd.Load(resource.Data, resource.Entry);
            var drawables = ydd.Drawables ?? [];
            for (var index = 0; index < drawables.Length; index++)
                if (drawables[index]?.LightAttributes is { } list) yield return ($"drawable:{index}", list);
        }
        else throw new InvalidDataException($"{resource.Name}: only .yft, .ydr and .ydd carry lamps.");
    }

    private static long LightOffset(ResourceSimpleList64<LightAttributes> list, int index, LampResource resource)
    {
        var pointer = (long)list.EntriesPointer;
        if ((pointer & 0xF0000000L) != SystemBase)
            throw new InvalidDataException($"{resource.Name}: light list does not live in system memory.");
        var offset = pointer - SystemBase + (long)index * LightStride;
        if (offset < 0 || offset + LightStride > resource.Entry.SystemSize || offset + LightStride > resource.Data.Length)
            throw new InvalidDataException($"{resource.Name}: light {index} lies outside the resource.");
        return offset;
    }

    private static long ArrayOffset(Meta meta, ulong pointer, int stride, int count, LampYmap owner)
    {
        var blockIndex = (int)(pointer & 0xFFF) - 1;
        var inner = (long)((pointer >> 12) & 0xFFFFF);
        if (blockIndex < 0 || blockIndex >= meta.DataBlocks.Count)
            throw new InvalidDataException("LOD array points to a missing data block.");
        var block = meta.DataBlocks[blockIndex];
        if ((block.DataPointer & 0xF0000000L) != SystemBase)
            throw new InvalidDataException("LOD data block does not live in system memory.");
        var start = block.DataPointer - SystemBase + inner;
        if (inner + (long)stride * count > block.DataLength || start + (long)stride * count > owner.Data.Length)
            throw new InvalidDataException("LOD array lies outside its data block.");
        return start;
    }

    private static void WriteAt(byte[] data, long offset, byte[] values, List<(long, int)> touched)
    {
        Buffer.BlockCopy(values, 0, data, (int)offset, values.Length);
        touched.Add((offset, values.Length));
    }

    private static void VerifyBytes(string name, LampYmap original, byte[] outputBytes, List<(long Start, int Length)> touched)
    {
        var raw = (byte[])outputBytes.Clone();
        var entry = RpfFile.CreateResourceFileEntry(ref raw, 0);
        var data = ResourceBuilder.DecompressResource(raw, entry, name);
        if (entry.SystemFlags != original.Entry.SystemFlags || entry.GraphicsFlags != original.Entry.GraphicsFlags ||
            data.Length != original.Data.Length)
            throw new InvalidDataException($"{name}: patched map changed its page layout.");
        var allowed = new bool[data.Length];
        foreach (var (start, length) in touched)
            for (var index = 0; index < length; index++) allowed[start + index] = true;
        for (var index = 0; index < data.Length; index++)
            if (!allowed[index] && data[index] != original.Data[index])
                throw new InvalidDataException($"{name}: byte 0x{index:X} outside the light arrays changed.");
        var reopened = new YmapFile();
        reopened.Load(data, entry);
        if (reopened.Meta is null) throw new InvalidDataException($"{name}: patched map does not reopen.");
    }

    private static async Task WriteAtomic(string output, byte[] bytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var staged = $"{output}.lamp-{Guid.NewGuid():N}";
        try
        {
            await File.WriteAllBytesAsync(staged, bytes);
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }
    }

    private static float Bounded(float value, float min, float max, string name) =>
        float.IsFinite(value) && value >= min && value <= max
            ? value
            : throw new InvalidDataException($"LOD rule {name} {value} is outside {min}…{max}.");

    private static float Finite(float value) => float.IsFinite(value) ? value : 0f;

    private static string RequireFile(string? value)
    {
        var path = (value ?? string.Empty).Trim();
        if (!Path.IsPathFullyQualified(path) || !File.Exists(path))
            throw new InvalidDataException($"Input file is missing: {value}");
        return Path.GetFullPath(path);
    }

    private static string RequireOutput(string? value, string input)
    {
        var path = (value ?? string.Empty).Trim();
        if (!Path.IsPathFullyQualified(path))
            throw new InvalidDataException($"Output path must be absolute: {value}");
        var full = Path.GetFullPath(path);
        if (string.Equals(full, input, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Output must not overwrite the input.");
        return full;
    }

    private static string Sha256(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
