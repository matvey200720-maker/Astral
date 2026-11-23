using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Звезда арены — своя картинка объёмной фигурой на подставке, с движением.
///
/// Сетку (лицо, спинка и бока по контуру картинки, подставка) строит окно
/// (`@modovik/climb-contract/recolor/arena-star`) — здесь она становится
/// моделью игры под именем штатной модели, которую заменяет:
///   • без движения — простая модель без скелета: шейдер `default`,
///     встроенная DXT5 с полной цепочкой мип-уровней, корзина 0;
///   • с движением — модель со скелетом и клип анимации. Скелет и клип
///     повторяют штатную крутящуюся модель игры
///     `bkr_prop_prtmachine_dryer_spin` (сушилка типографии байкеров): те
///     же кости с метками и степенями свободы, те же подписи скелета и
///     анимации, тот же порядок дорожек. Фигура привязана к кости барабана
///     (метка 40657 — она у игры и крутится, и двигается), подставка — к
///     корню. Геометрия — со шкурой (веса и номера костей у вершин), шейдер
///     `default`: у сушилки ровно так же устроена её часть с `default`.
///     Клип зовётся именем модели и лежит в своём словаре клипов — архетип
///     модели должен ссылаться на него (`clipDictionary`) и нести флаги
///     анимированной модели; это правит установщик в файле интерьера.
///
/// Ось фигуры — вертикаль через кость барабана: окно присылает сетку вокруг
/// начала координат, здесь она сдвигается на место кости (`pivot` в ответе
/// — установщику, чтобы поставить сущность туда, где стояла статуя).
///
/// Летающее лого над центром города (ТЗ 08.10.2026, задача 4) — та же
/// модель и тот же клип, но со свечением: `shader` — `emissive`
/// (`emissive.sps`, корзина 0) или `emissive_alpha` (`emissive_alpha.sps`,
/// корзина 1, прозрачность — альфой листа), `emissive` — множитель свечения
/// (у лого мода 3,33). Дальность — до 5 км: лого видно через весь город.
///
/// Живая картинка (ТЗ 11.10.2026, ночь, задача 2: гифка у своих моделей и
/// баннеров) — `uvAnimation`: клип развёртки `<модель>_uv_0` в том же словаре
/// клипов, по образцу штатного экрана подлодки
/// `h4_int_sub_sub_command_monitor00` (`h4_dlc_int_01_h4.ycd`, пропа без
/// скелета с листом-атласом кадров): ключ клипа — joaat(модель) + 1 (номер
/// шейдера + 1), имя — `pack:/<модель>_uv_0.clip`, анимация 30 кадров/с,
/// `Unknown1C` 0x6B002400, треки 17 (UV0) и 18 (UV1) на кости 0; у дорожки —
/// строка матрицы развёртки (x, y — постоянные 1, 0 / 0, 1, z — сдвиг), сдвиг
/// ступеньками — `IndirectQuantizeFloat` (палитра сдвигов и номер на кадр).
/// Сетка смотрит в первый кадр атласа: без клипа виден он. Архетипу нужен
/// флаг 0x400 (у всех 653 архетипов игры с UV-клипами он есть, без них — ни
/// у одного) и словарь клипов — это ставит установщик.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class StarModelCommands
{
    private const string RequestFormat = "astral.compile-star-model";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 16 * 1024 * 1024;
    private const int MaxDdsBytes = 8 * 1024 * 1024;
    private const int MaxVertices = 60000;
    private const int MaxIndices = 360000;
    private const int MaxFrames = 512;
    /* Живая картинка: до 40 с при 30 кадрах/с. */
    private const int MaxUvFrames = 1201;
    private const float UvFps = 30f;
    internal const string UvAnimationSignature = "hash_6B002400";
    /* Дальше от оси модели — не сетка, а порча: проверка на здравость, не предел формата (позиция вершины — полный float3). Вещи арен Majestic — до 92 м (опись рамок), 06.11.2026 подняли с 40 м. Тот же предел — `REACH` в `star_model.rs`. */
    private const float MaxExtent = 256f;
    private const float MinLodDistance = 10f;
    private const float MaxLodDistance = 5000f;
    private const string ExportedBy = "Astral Star Model 1";

    /* Скелет штатной сушилки: имя, метка, родитель, сосед, степени свободы, место. */
    internal sealed record TemplateBone(string Name, ushort Tag, short Parent, short Sibling, string Flags, Vector3 Translation);

    internal static readonly TemplateBone[] Bones =
    [
        new("Root_Prop_PrtMachine_Dryer_Spin", 0, -1, -1, "RotX, RotY, RotZ, TransX, TransY, TransZ, Unk0", Vector3.Zero),
        new("Main_Prop_PrtMachine_Dryer_Spin", 4501, 0, -1, "RotX, RotY, RotZ, Unk0", Vector3.Zero),
        new("Drum", 40657, 1, 3, "RotX, RotY, RotZ, TransX, TransY, TransZ, ScaleX, ScaleY, ScaleZ", new Vector3(0.0006432533f, -0.31497478f, 1.1202866f)),
        new("Innards", 64297, 1, -1, "RotX, RotY, RotZ, TransX, TransY, TransZ, ScaleX, ScaleY, ScaleZ", new Vector3(0.0006432533f, -0.31497478f, 0.9070908f)),
    ];
    internal const int MovingBone = 2;
    internal const uint SkeletonUnknown1C = 16777216;
    internal const uint SkeletonSignature50 = 3144142573;
    internal const uint SkeletonSignature54 = 542624104;
    internal const uint SkeletonSignature58 = 4272629676;
    internal const string AnimationSignature = "hash_F3A95F25";

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> CompileAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Star model request must be between 1 byte and 16 MiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Star model request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Star model request has an unknown format.");
        var name = ValidName(request.Name, "model");
        var clipName = request.Motion is null && request.UvAnimation is null ? null : ValidName(request.ClipDictionary, "clip dictionary");
        if (clipName == name) throw new InvalidDataException("Star model and clip dictionary need different names.");
        if (!float.IsFinite(request.LodDist) || request.LodDist < MinLodDistance || request.LodDist > MaxLodDistance)
            throw new InvalidDataException("Star model draw distance is out of range.");
        var mesh = ValidateMesh(request.Mesh);
        var motion = request.Motion is null ? null : ValidateMotion(request.Motion);
        var uv = request.UvAnimation is null ? null : ValidateUv(request.UvAnimation);
        var shader = ValidateShader(request.Shader, request.Emissive);

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Star model output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Star model output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Star model output directory must be empty.");

        /* Ось фигуры — вертикаль кости барабана (у модели без движения — тоже:
           установщику одно место на оба случая). */
        var pivot = new Vector3(Bones[MovingBone].Translation.X, Bones[MovingBone].Translation.Y, 0f);
        var positions = new Vector3[mesh.VertexCount];
        for (var index = 0; index < mesh.VertexCount; index++)
            positions[index] = new Vector3(mesh.Positions[index * 3], mesh.Positions[index * 3 + 1], mesh.Positions[index * 3 + 2]) + pivot;
        var (min, max) = Reach(positions, mesh.Parts, motion, pivot);

        var described = new List<object>();
        var assets = Path.Combine(output, ".texture-assets");
        Directory.CreateDirectory(assets);
        try
        {
            var texture = await ReadTextureAsync(request);
            var textureName = name + "_star";
            await File.WriteAllBytesAsync(Path.Combine(assets, textureName + ".dds"), texture.Bytes);
            var xml = BuildYdrXml(name, textureName, texture, mesh, positions, min, max, request.LodDist, animated: motion is not null, shader);
            var ydr = XmlYdr.GetYdr(xml, assets);
            if (ydr.Drawable is null) throw new InvalidDataException("Generated star model has no drawable.");
            var bytes = ydr.Save();
            var path = Path.Combine(output, name + ".ydr");
            await File.WriteAllBytesAsync(path, bytes);
            described.Add(ReopenDrawable(path, bytes, mesh, texture, animated: motion is not null, shader));
        }
        finally
        {
            Directory.Delete(assets, true);
        }

        if ((motion is not null || uv is not null) && clipName is not null)
        {
            var ycd = XmlYcd.GetYcd(BuildYcdXml(name, motion, uv));
            var bytes = ycd.Save();
            var path = Path.Combine(output, clipName + ".ycd");
            await File.WriteAllBytesAsync(path, bytes);
            described.Add(ReopenClip(path, bytes, name, motion, uv));
        }

        return new
        {
            format = "astral.star-model",
            version = 1,
            pivot = new[] { pivot.X, pivot.Y, pivot.Z },
            bounds = new { min = new[] { min.X, min.Y, min.Z }, max = new[] { max.X, max.Y, max.Z } },
            animated = motion is not null,
            /* Живая картинка: клип развёртки и сколько у него кадров. */
            uvClip = uv is null ? null : name + "_uv_0",
            uvFrames = uv?.Frames ?? 0,
            files = described,
        };
    }

    /* ------------------------------------------------------------------ */

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name))
            throw new InvalidDataException($"Star {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    /* Шейдер модели: `default` у звезды арены, свечение — у летающего лого. */
    private sealed record Shader(string Name, string File, int Bucket, float Emissive)
    {
        public int Mask => 1 << Bucket;
        public bool Glows => Name == "emissive";
    }

    private static Shader ValidateShader(string? name, float? emissive)
    {
        var glow = emissive ?? 1f;
        if (!float.IsFinite(glow) || glow < 0f || glow > 64f) throw new InvalidDataException("Star emissive must be 0…64.");
        return (name ?? "default") switch
        {
            "default" => new Shader("default", "default.sps", 0, 0f),
            "emissive" => new Shader("emissive", "emissive.sps", 0, glow),
            "emissive_alpha" => new Shader("emissive", "emissive_alpha.sps", 1, glow),
            /* Свои модели мест (ТЗ 11.10.2026, вечер): прозрачность картинки и
               своя непрозрачность без свечения — `default` с альфой, как у
               плашек эмблем (`alpha.sps`, корзина 1). */
            "alpha" => new Shader("default", "alpha.sps", 1, 0f),
            _ => throw new InvalidDataException("Star shader must be default, alpha, emissive or emissive_alpha."),
        };
    }

    private sealed record Mesh(int VertexCount, float[] Positions, float[] Normals, float[] Uvs, byte[] Parts, int[] Indices);

    private static Mesh ValidateMesh(MeshRequest? source)
    {
        if (source?.Positions is null || source.Normals is null || source.Uvs is null || source.Parts is null || source.Indices is null)
            throw new InvalidDataException("Star mesh is incomplete.");
        var count = source.Positions.Length / 3;
        if (count < 3 || count > MaxVertices || source.Positions.Length != count * 3 || source.Normals.Length != count * 3 ||
            source.Uvs.Length != count * 2 || source.Parts.Length != count)
            throw new InvalidDataException($"Star mesh must have 3…{MaxVertices} vertices with matching normals, uvs and parts.");
        if (source.Indices.Length is 0 or > MaxIndices || source.Indices.Length % 3 != 0)
            throw new InvalidDataException("Star mesh indices must be whole triangles.");
        if (!source.Positions.All(value => float.IsFinite(value) && Math.Abs(value) <= MaxExtent))
            throw new InvalidDataException($"Star mesh must fit within {MaxExtent} m.");
        if (!source.Normals.All(float.IsFinite) || !source.Uvs.All(value => float.IsFinite(value) && value is >= -0.01f and <= 1.01f))
            throw new InvalidDataException("Star mesh normals or uvs are out of range.");
        if (source.Parts.Any(part => part is not 0 and not 1))
            throw new InvalidDataException("Star mesh parts must be 0 (stand) or 1 (figure).");
        if (source.Indices.Any(index => index < 0 || index >= count))
            throw new InvalidDataException("Star mesh index points outside the mesh.");
        return new Mesh(count, source.Positions, source.Normals, source.Uvs, source.Parts.Select(part => (byte)part).ToArray(), source.Indices);
    }

    private sealed record Motion(float Duration, float[] Lift, float[] Angle);

    private static Motion ValidateMotion(MotionRequest source)
    {
        if (source.Lift is null || source.Angle is null || source.Lift.Length != source.Angle.Length ||
            source.Lift.Length is < 2 or > MaxFrames)
            throw new InvalidDataException($"Star motion must list 2…{MaxFrames} frames of lift and angle.");
        if (!float.IsFinite(source.Duration) || source.Duration is < 0.1f or > 120f)
            throw new InvalidDataException("Star motion duration must be 0.1…120 s.");
        if (!source.Lift.All(value => float.IsFinite(value) && value is >= 0f and <= 10f) ||
            !source.Angle.All(value => float.IsFinite(value) && Math.Abs(value) <= 7f))
            throw new InvalidDataException("Star motion values are out of range.");
        return new Motion(source.Duration, source.Lift, source.Angle);
    }

    /* Клип развёртки: сдвиги (u, v) на каждый кадр 30 кадров/с, последний — снова первый. */
    private sealed record UvAnimation(float Duration, float[] U, float[] V)
    {
        public int Frames => U.Length;
    }

    private static UvAnimation ValidateUv(UvAnimationRequest source)
    {
        var shifts = source.Shifts ?? [];
        var frames = shifts.Length / 2;
        if (shifts.Length % 2 != 0 || frames is < 2 or > MaxUvFrames)
            throw new InvalidDataException($"Star uv animation must list 2…{MaxUvFrames} frames of (u, v) shifts.");
        if (!float.IsFinite(source.Duration) || source.Duration is < 0.05f or > 40f)
            throw new InvalidDataException("Star uv animation duration must be 0.05…40 s.");
        /* Клипы развёртки игры — 30 кадров/с: (кадров − 1) / длительность. */
        if (Math.Abs((frames - 1) / source.Duration - UvFps) > 0.5f)
            throw new InvalidDataException("Star uv animation must run at 30 frames per second.");
        if (!shifts.All(value => float.IsFinite(value) && Math.Abs(value) <= 4f))
            throw new InvalidDataException("Star uv animation shifts are out of range.");
        var u = new float[frames];
        var v = new float[frames];
        for (var index = 0; index < frames; index++)
        {
            u[index] = shifts[index * 2];
            v[index] = shifts[index * 2 + 1];
        }
        return new UvAnimation(source.Duration, u, v);
    }

    /* Рамка с движением: фигура поднимается и обходит круг вокруг оси. */
    private static (Vector3 Min, Vector3 Max) Reach(Vector3[] positions, byte[] parts, Motion? motion, Vector3 pivot)
    {
        var min = new Vector3(float.MaxValue);
        var max = new Vector3(float.MinValue);
        var spins = motion is not null && motion.Angle.Any(value => Math.Abs(value) > 1e-4f);
        var lift = motion is null ? 0f : motion.Lift.Max();
        var radius = 0f;
        for (var index = 0; index < positions.Length; index++)
        {
            var point = positions[index];
            min = Vector3.Min(min, point);
            max = Vector3.Max(max, point);
            if (parts[index] == 1)
            {
                radius = Math.Max(radius, new Vector2(point.X - pivot.X, point.Y - pivot.Y).Length());
                max.Z = Math.Max(max.Z, point.Z + lift);
            }
        }
        if (spins)
        {
            min = Vector3.Min(min, new Vector3(pivot.X - radius, pivot.Y - radius, min.Z));
            max = Vector3.Max(max, new Vector3(pivot.X + radius, pivot.Y + radius, max.Z));
        }
        return (min, max);
    }

    private sealed record Texture(byte[] Bytes, int Width, int Height, int Levels, string Sha256);

    private static bool IsPowerOfTwo(int value) => value > 0 && (value & (value - 1)) == 0;

    private static async Task<Texture> ReadTextureAsync(CompileRequest request)
    {
        if (!IsPowerOfTwo(request.Width) || !IsPowerOfTwo(request.Height) || request.Width is < 4 or > 2048 || request.Height is < 4 or > 2048)
            throw new InvalidDataException("Star texture must be a power of two, 4…2048 px.");
        var file = Path.GetFullPath(request.Texture ?? "");
        if (!File.Exists(file)) throw new FileNotFoundException("Star texture was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException("Star texture has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        var levels = BitConverter.ToInt32(bytes, 28);
        var full = (int)Math.Log2(Math.Max(request.Width, request.Height)) + 1;
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " ||
            BitConverter.ToInt32(bytes, 12) != request.Height ||
            BitConverter.ToInt32(bytes, 16) != request.Width ||
            levels != full ||
            Encoding.ASCII.GetString(bytes, 84, 4) != "DXT5")
            throw new InvalidDataException($"Star texture is not {request.Width}x{request.Height} DXT5 with a full mip chain.");
        var expected = 128;
        for (var level = 0; level < levels; level++)
        {
            var w = Math.Max(1, request.Width >> level);
            var h = Math.Max(1, request.Height >> level);
            expected += Math.Max(1, (w + 3) / 4) * Math.Max(1, (h + 3) / 4) * 16;
        }
        if (bytes.Length != expected) throw new InvalidDataException("Star texture is truncated or padded.");
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (request.TextureSha256 != "sha256:" + digest)
            throw new InvalidDataException("Star texture SHA-256 mismatch.");
        return new Texture(bytes, request.Width, request.Height, levels, digest);
    }

    internal static string UsageFlags(int width, int height)
    {
        var side = Math.Max(width, height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        flags.Add("UNK24");
        return string.Join(", ", flags);
    }

    private static string BuildYdrXml(string name, string textureName, Texture texture, Mesh mesh, Vector3[] positions, Vector3 min, Vector3 max,
        float lodDist, bool animated, Shader shader)
    {
        var centre = (min + max) * 0.5f;
        var radius = Vector3.Distance(centre, max);
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Drawable>\n")
            .Append(" <Name>").Append(name).Append("</Name>\n")
            .Append(Vector3Element(" ", "BoundingSphereCenter", centre))
            .Append(" <BoundingSphereRadius value=\"").Append(F(radius)).Append("\" />\n")
            .Append(Vector3Element(" ", "BoundingBoxMin", min))
            .Append(Vector3Element(" ", "BoundingBoxMax", max))
            .Append(" <LodDistHigh value=\"9998\" />\n <LodDistMed value=\"9998\" />\n")
            .Append(" <LodDistLow value=\"9998\" />\n <LodDistVlow value=\"9998\" />\n")
            .Append(" <FlagsHigh value=\"").Append(shader.Mask).Append("\" />\n")
            .Append(" <FlagsMed value=\"0\" />\n <FlagsLow value=\"0\" />\n <FlagsVlow value=\"0\" />\n")
            .Append(" <ShaderGroup>\n  <TextureDictionary>\n   <Item>\n")
            .Append("    <Name>").Append(textureName).Append("</Name>\n")
            .Append("    <Unk32 value=\"128\" />\n    <Usage>DIFFUSE</Usage>\n")
            .Append("    <UsageFlags>").Append(UsageFlags(texture.Width, texture.Height)).Append("</UsageFlags>\n")
            .Append("    <ExtraFlags value=\"0\" />\n")
            .Append("    <Width value=\"").Append(texture.Width).Append("\" />\n")
            .Append("    <Height value=\"").Append(texture.Height).Append("\" />\n")
            .Append("    <MipLevels value=\"").Append(texture.Levels).Append("\" />\n")
            .Append("    <Format>D3DFMT_DXT5</Format>\n")
            .Append("    <FileName>").Append(textureName).Append(".dds</FileName>\n")
            .Append("   </Item>\n  </TextureDictionary>\n  <Shaders>\n   <Item>\n")
            .Append("    <Name>").Append(shader.Name).Append("</Name>\n    <FileName>").Append(shader.File).Append("</FileName>\n")
            .Append("    <RenderBucket value=\"").Append(shader.Bucket).Append("\" />\n")
            .Append("    <Parameters>\n")
            .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(textureName).Append("</Name></Item>\n")
            .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
            .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append(shader.Glows
                ? "     <Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"" + F(shader.Emissive) + "\" y=\"0\" z=\"0\" w=\"0\" />\n"
                : "     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("    </Parameters>\n   </Item>\n  </Shaders>\n </ShaderGroup>\n");
        if (animated)
        {
            xml.Append(" <Skeleton>\n")
                .Append("  <Unknown1C value=\"").Append(SkeletonUnknown1C).Append("\" />\n")
                .Append("  <Unknown50 value=\"").Append(SkeletonSignature50).Append("\" />\n")
                .Append("  <Unknown54 value=\"").Append(SkeletonSignature54).Append("\" />\n")
                .Append("  <Unknown58 value=\"").Append(SkeletonSignature58).Append("\" />\n")
                .Append("  <Bones>\n");
            for (var index = 0; index < Bones.Length; index++)
            {
                var bone = Bones[index];
                xml.Append("   <Item>\n")
                    .Append("    <Name>").Append(bone.Name).Append("</Name>\n")
                    .Append("    <Tag value=\"").Append(bone.Tag).Append("\" />\n")
                    .Append("    <Index value=\"").Append(index).Append("\" />\n")
                    .Append("    <ParentIndex value=\"").Append(bone.Parent).Append("\" />\n")
                    .Append("    <SiblingIndex value=\"").Append(bone.Sibling).Append("\" />\n")
                    .Append("    <Flags>").Append(bone.Flags).Append("</Flags>\n")
                    .Append(Vector3Element("    ", "Translation", bone.Translation))
                    .Append("    <Rotation x=\"0\" y=\"0\" z=\"0\" w=\"1\" />\n")
                    .Append("    <Scale x=\"1\" y=\"1\" z=\"1\" />\n")
                    .Append("    <TransformUnk x=\"0\" y=\"4\" z=\"-3\" w=\"0\" />\n")
                    .Append("   </Item>\n");
            }
            xml.Append("  </Bones>\n </Skeleton>\n");
        }
        xml.Append(" <DrawableModelsHigh>\n  <Item>\n")
            .Append("   <RenderMask value=\"255\" />\n")
            .Append("   <Flags value=\"").Append(animated ? 1 : 0).Append("\" />\n")
            .Append("   <HasSkin value=\"").Append(animated ? 1 : 0).Append("\" />\n")
            .Append("   <BoneIndex value=\"0\" />\n")
            .Append("   <Unknown1 value=\"").Append(animated ? Bones.Length : 0).Append("\" />\n")
            .Append("   <Geometries>\n    <Item>\n     <ShaderIndex value=\"0\" />\n")
            .Append(Vector4Element("     ", "BoundingBoxMin", min))
            .Append(Vector4Element("     ", "BoundingBoxMax", max));
        if (animated) xml.Append("     <BoneIDs>").Append(string.Join(", ", Enumerable.Range(0, Bones.Length))).Append("</BoneIDs>\n");
        xml.Append("     <VertexBuffer>\n      <Flags value=\"0\" />\n")
            .Append(animated
                ? "      <Layout type=\"GTAV1\"><Position /><BlendWeights /><BlendIndices /><Normal /><Colour0 /><TexCoord0 /></Layout>\n"
                : "      <Layout type=\"GTAV1\"><Position /><Normal /><Colour0 /><TexCoord0 /></Layout>\n")
            .Append("      <Data>\n");
        for (var index = 0; index < mesh.VertexCount; index++)
        {
            var point = positions[index];
            xml.Append("       ").Append(F(point.X)).Append(' ').Append(F(point.Y)).Append(' ').Append(F(point.Z));
            /* Вес целиком на одной кости: фигура — барабан, подставка — корень
               (так у сушилки: третий из четырёх весов и номеров). */
            if (animated) xml.Append("   0 0 255 0   0 0 ").Append(mesh.Parts[index] == 1 ? MovingBone : 0).Append(" 0");
            xml.Append("   ").Append(F(mesh.Normals[index * 3])).Append(' ').Append(F(mesh.Normals[index * 3 + 1])).Append(' ').Append(F(mesh.Normals[index * 3 + 2]))
                .Append("   255 255 0 255   ").Append(F(mesh.Uvs[index * 2])).Append(' ').Append(F(mesh.Uvs[index * 2 + 1])).Append('\n');
        }
        xml.Append("      </Data>\n     </VertexBuffer>\n     <IndexBuffer><Data>");
        for (var index = 0; index < mesh.Indices.Length; index++)
        {
            if (index > 0) xml.Append(index % 24 == 0 ? '\n' : ' ');
            xml.Append(mesh.Indices[index]);
        }
        xml.Append("</Data></IndexBuffer>\n    </Item>\n   </Geometries>\n  </Item>\n </DrawableModelsHigh>\n</Drawable>\n");
        return xml.ToString();
    }

    /*
     * Клип — как у сушилки: восемь дорожек (место и поворот четырёх костей)
     * в её порядке и с её подписью; движется только барабан. Подъём — Z
     * барабана, оборот — поворот вокруг Z: x и y нули, z и w по кадрам, и
     * пометка кэшированного кватерниона, как у штатных клипов.
     */
    /* Запись клипа: ключ, имя файла клипа, анимация и длительность — как у штатных. */
    private static string ClipXml(string key, string clip, string animation, float duration) =>
        new StringBuilder("  <Item>\n")
            .Append("   <Hash>").Append(key).Append("</Hash>\n")
            .Append("   <Name>pack:/").Append(clip).Append(".clip</Name>\n")
            .Append("   <Type value=\"Animation\" />\n   <Unknown30 value=\"1\" />\n   <Tags />\n")
            .Append("   <Properties>\n    <Item>\n     <NameHash>hash_BF6A5D60</NameHash>\n     <UnkHash>hash_996C3B27</UnkHash>\n")
            .Append("     <Attributes>\n      <Item>\n       <NameHash>hash_BF6A5D60</NameHash>\n       <Type value=\"Int\" />\n       <Value value=\"32\" />\n")
            .Append("      </Item>\n     </Attributes>\n    </Item>\n   </Properties>\n")
            .Append("   <AnimationHash>").Append(animation).Append("</AnimationHash>\n")
            .Append("   <StartTime value=\"0\" />\n")
            .Append("   <EndTime value=\"").Append(F(duration)).Append("\" />\n")
            .Append("   <Rate value=\"1\" />\n  </Item>\n")
            .ToString();

    /* Ключ UV-клипа шейдера `shader`: joaat(модель) + номер шейдера + 1 (так у всех 977 UV-клипов игры). */
    internal static uint UvClipKey(string name, int shader = 0) => unchecked(JenkHash.GenHash(name) + (uint)shader + 1u);

    private static string BuildYcdXml(string name, Motion? motion, UvAnimation? uv)
    {
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ClipDictionary>\n <Clips>\n");
        if (motion is not null) xml.Append(ClipXml(name, name, name, motion.Duration));
        if (uv is not null) xml.Append(ClipXml("hash_" + UvClipKey(name).ToString("X8"), name + "_uv_0", name + "_uv_0", uv.Duration));
        xml.Append(" </Clips>\n <Animations>\n");
        if (motion is not null) xml.Append(MotionAnimationXml(name, motion));
        if (uv is not null) xml.Append(UvAnimationXml(name + "_uv_0", uv));
        return xml.Append(" </Animations>\n</ClipDictionary>\n").ToString();
    }

    /*
     * Анимация развёртки — как у экрана подлодки: две дорожки (17 — UV0, 18 —
     * UV1) на кости 0, у каждой три числа строки матрицы: постоянные x и y и
     * сдвиг z по кадрам (палитрой сдвигов, если он меняется).
     */
    private static string UvAnimationXml(string name, UvAnimation uv)
    {
        var frames = uv.Frames;
        var xml = new StringBuilder("  <Item>\n")
            .Append("   <Hash>").Append(name).Append("</Hash>\n")
            .Append("   <Unknown10 value=\"1\" />\n")
            .Append("   <FrameCount value=\"").Append(frames).Append("\" />\n")
            .Append("   <SequenceFrameLimit value=\"").Append(frames + 2).Append("\" />\n")
            .Append("   <Duration value=\"").Append(F(uv.Duration)).Append("\" />\n")
            .Append("   <Unknown1C>").Append(UvAnimationSignature).Append("</Unknown1C>\n")
            .Append("   <BoneIds>\n");
        foreach (var track in new[] { 17, 18 })
            xml.Append("    <Item>\n     <BoneId value=\"0\" />\n")
                .Append("     <Track value=\"").Append(track).Append("\" />\n")
                .Append("     <Unk0 value=\"0\" />\n    </Item>\n");
        xml.Append("   </BoneIds>\n   <Sequences>\n    <Item>\n     <Hash />\n")
            .Append("     <FrameCount value=\"").Append(frames).Append("\" />\n     <SequenceData>\n");
        foreach (var (constant, shifts) in new[] { ((1f, 0f), uv.U), ((0f, 1f), uv.V) })
            xml.Append("      <Item>\n       <Channels>\n")
                .Append(StaticFloat(constant.Item1)).Append(StaticFloat(constant.Item2))
                .Append(Stepped(shifts))
                .Append("       </Channels>\n      </Item>\n");
        return xml.Append("     </SequenceData>\n    </Item>\n   </Sequences>\n  </Item>\n").ToString();
    }

    /* Сдвиг ступеньками: палитра значений и номер значения на каждый кадр; без смен — постоянный. */
    private static string Stepped(float[] values)
    {
        var palette = values.Distinct().OrderByDescending(value => value == values[0]).ToList();
        if (palette.Count == 1) return StaticFloat(values[0]);
        var low = palette.Min();
        var high = palette.Max();
        var quantum = Math.Max((high - low) / 65535f, 1e-7f);
        var sb = new StringBuilder("        <Item>\n         <Type value=\"IndirectQuantizeFloat\" />\n")
            .Append("         <Quantum value=\"").Append(F(quantum)).Append("\" />\n")
            .Append("         <Offset value=\"").Append(F(low)).Append("\" />\n")
            .Append("         <Values>").Append(string.Join(' ', palette.Select(F))).Append("</Values>\n")
            .Append("         <Frames>\n");
        var indices = values.Select(value => palette.IndexOf(value)).ToArray();
        for (var index = 0; index < indices.Length; index += 10)
            sb.Append("          ").Append(string.Join(' ', indices.Skip(index).Take(10))).Append('\n');
        return sb.Append("         </Frames>\n        </Item>\n").ToString();
    }

    private static string MotionAnimationXml(string name, Motion motion)
    {
        var frames = motion.Lift.Length;
        var drum = Bones[MovingBone].Translation;
        var xml = new StringBuilder("  <Item>\n")
            .Append("   <Hash>").Append(name).Append("</Hash>\n")
            .Append("   <Unknown10 value=\"1\" />\n")
            .Append("   <FrameCount value=\"").Append(frames).Append("\" />\n")
            .Append("   <SequenceFrameLimit value=\"").Append(frames + 2).Append("\" />\n")
            .Append("   <Duration value=\"").Append(F(motion.Duration)).Append("\" />\n")
            .Append("   <Unknown1C>").Append(AnimationSignature).Append("</Unknown1C>\n")
            .Append("   <BoneIds>\n");
        foreach (var track in new[] { 0, 1 })
            for (var index = 0; index < Bones.Length; index++)
                xml.Append("    <Item>\n     <BoneId value=\"").Append(Bones[index].Tag).Append("\" />\n")
                    .Append("     <Track value=\"").Append(track).Append("\" />\n")
                    .Append("     <Unk0 value=\"").Append(track).Append("\" />\n    </Item>\n");
        xml.Append("   </BoneIds>\n   <Sequences>\n    <Item>\n     <Hash />\n")
            .Append("     <FrameCount value=\"").Append(frames).Append("\" />\n     <SequenceData>\n");
        /* Места костей: у барабана подъём — по кадрам. */
        for (var index = 0; index < Bones.Length; index++)
        {
            var place = Bones[index].Translation;
            xml.Append("      <Item>\n       <Channels>\n");
            if (index == MovingBone && motion.Lift.Any(value => Math.Abs(value) > 1e-5f))
                xml.Append(StaticFloat(drum.X)).Append(StaticFloat(drum.Y))
                    .Append(Quantized(motion.Lift.Select(value => drum.Z + value).ToArray()));
            else
                xml.Append("        <Item>\n         <Type value=\"StaticVector3\" />\n")
                    .Append(Vector3Element("         ", "Value", place))
                    .Append("        </Item>\n");
            xml.Append("       </Channels>\n      </Item>\n");
        }
        /* Повороты: у барабана — оборот вокруг Z по кадрам. */
        for (var index = 0; index < Bones.Length; index++)
        {
            xml.Append("      <Item>\n       <Channels>\n");
            if (index == MovingBone && motion.Angle.Any(value => Math.Abs(value) > 1e-5f))
                xml.Append(StaticFloat(0)).Append(StaticFloat(0))
                    .Append(Quantized(motion.Angle.Select(value => (float)Math.Sin(value / 2)).ToArray()))
                    .Append(Quantized(motion.Angle.Select(value => (float)Math.Cos(value / 2)).ToArray()))
                    .Append("        <Item>\n         <Type value=\"CachedQuaternion2\" />\n         <QuatIndex value=\"0\" />\n        </Item>\n");
            else
                xml.Append("        <Item>\n         <Type value=\"StaticQuaternion\" />\n         <Value x=\"0\" y=\"0\" z=\"0\" w=\"1\" />\n        </Item>\n");
            xml.Append("       </Channels>\n      </Item>\n");
        }
        xml.Append("     </SequenceData>\n    </Item>\n   </Sequences>\n  </Item>\n");
        return xml.ToString();
    }

    private static string StaticFloat(float value) =>
        "        <Item>\n         <Type value=\"StaticFloat\" />\n         <Value value=\"" + F(value) + "\" />\n        </Item>\n";

    /* Квантованный ряд: шаг — размах на 12 бит, начало — наименьшее. */
    private static string Quantized(float[] values)
    {
        var low = values.Min();
        var high = values.Max();
        var quantum = Math.Max((high - low) / 4095f, 1e-6f);
        var sb = new StringBuilder("        <Item>\n         <Type value=\"QuantizeFloat\" />\n")
            .Append("         <Quantum value=\"").Append(F(quantum)).Append("\" />\n")
            .Append("         <Offset value=\"").Append(F(low)).Append("\" />\n")
            .Append("         <Values>\n");
        for (var index = 0; index < values.Length; index += 10)
            sb.Append("          ").Append(string.Join(' ', values.Skip(index).Take(10).Select(F))).Append('\n');
        return sb.Append("         </Values>\n        </Item>\n").ToString();
    }

    private static object ReopenDrawable(string path, byte[] bytes, Mesh mesh, Texture texture, bool animated, Shader shader)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var drawable = ydr.Drawable;
        var shaders = drawable?.ShaderGroup?.Shaders?.data_items;
        var textures = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items;
        var models = drawable?.DrawableModels?.High ?? [];
        var geometries = models.SelectMany(model => model.Geometries ?? []).ToArray();
        var bones = drawable?.Skeleton?.Bones?.Items;
        if (!ydr.Loaded || drawable is null || shaders is not { Length: 1 } ||
            shaders[0].Name.Hash != JenkHash.GenHash(shader.Name) ||
            shaders[0].FileName.Hash != JenkHash.GenHash(shader.File) ||
            drawable.FlagsHigh != shader.Mask ||
            textures is not { Length: 1 } || textures[0].Width != texture.Width || textures[0].Height != texture.Height ||
            textures[0].Levels != texture.Levels ||
            models.Length != 1 || geometries.Length != 1 ||
            geometries[0].VerticesCount != mesh.VertexCount || geometries[0].IndicesCount != mesh.Indices.Length)
            throw new InvalidDataException("Compiled star model failed semantic reopen.");
        if (animated && (bones is not { Length: 4 } || models[0].HasSkin != 1 ||
                         !bones.Select(bone => bone.Tag).SequenceEqual(Bones.Select(bone => bone.Tag)) ||
                         drawable.Skeleton!.Unknown_50h.Hash != SkeletonSignature50))
            throw new InvalidDataException("Compiled star model skeleton failed semantic reopen.");
        if (!animated && (drawable.Skeleton is not null || models[0].HasSkin != 0))
            throw new InvalidDataException("Compiled static star model must not carry a skeleton.");
        return Describe(path, bytes, new
        {
            semanticReopen = true,
            vertices = mesh.VertexCount,
            triangles = mesh.Indices.Length / 3,
            skeleton = animated ? Bones.Length : 0,
            texture = new { width = texture.Width, height = texture.Height, mipLevels = texture.Levels, sha256 = texture.Sha256 },
        });
    }

    private static object ReopenClip(string path, byte[] bytes, string name, Motion? motion, UvAnimation? uv)
    {
        var ycd = new YcdFile { Name = Path.GetFileName(path) };
        RpfFile.LoadResourceFile(ycd, bytes, 46);
        var clips = ycd.ClipMapEntries ?? [];
        var animations = (ycd.AnimMapEntries ?? []).Select(entry => entry?.Animation).Where(item => item is not null).ToArray();
        var expected = (motion is null ? 0 : 1) + (uv is null ? 0 : 1);
        if (clips.Length != expected || animations.Length != expected || clips.Any(clip => clip.Clip is null))
            throw new InvalidDataException("Compiled star clip failed semantic reopen.");
        (int Frames, float Duration)? moving = null;
        object? living = null;
        if (motion is not null)
        {
            var hash = JenkHash.GenHash(name);
            var clip = clips.FirstOrDefault(item => item.Hash.Hash == hash);
            var animation = animations.FirstOrDefault(item => item!.Hash.Hash == hash);
            if (clip is null || animation is null || animation.Frames != motion.Lift.Length ||
                Math.Abs(animation.Duration - motion.Duration) > 1e-3f || animation.BoneIds?.data_items?.Length != Bones.Length * 2)
                throw new InvalidDataException("Compiled star clip failed semantic reopen.");
            moving = ((int)animation.Frames, animation.Duration);
        }
        if (uv is not null)
        {
            var key = UvClipKey(name);
            var hash = JenkHash.GenHash(name + "_uv_0");
            var clip = clips.FirstOrDefault(item => item.Hash.Hash == key);
            var animation = animations.FirstOrDefault(item => item!.Hash.Hash == hash);
            var tracks = animation?.BoneIds?.data_items?.Select(item => (item.BoneId, item.Track)).ToArray() ?? [];
            if (clip?.Clip is not ClipAnimation linked || linked.Animation?.Hash.Hash != hash || animation is null ||
                animation.Frames != uv.Frames || Math.Abs(animation.Duration - uv.Duration) > 1e-3f ||
                !tracks.SequenceEqual(new[] { ((ushort)0, (byte)17), ((ushort)0, (byte)18) }))
                throw new InvalidDataException("Compiled star uv clip failed semantic reopen.");
            /* Сдвиги после упаковки — те же, что просили (палитра 16 бит). */
            var channels = animation.Sequences?.data_items?.FirstOrDefault()?.Sequences;
            for (var frame = 0; channels is { Length: 2 } && frame < uv.Frames; frame++)
                if (Math.Abs(channels[0].EvaluateVector(frame).Z - uv.U[frame]) > 1e-3f || Math.Abs(channels[1].EvaluateVector(frame).Z - uv.V[frame]) > 1e-3f)
                    throw new InvalidDataException("Compiled star uv clip shifts do not round-trip.");
            living = new { clip = name + "_uv_0", key = key.ToString("X8"), frames = (int)animation.Frames, duration = animation.Duration };
        }
        /* Без живой картинки — ответ прежний (звезда арены, летающее лого). */
        if (living is null && moving is { } only)
            return Describe(path, bytes, new { semanticReopen = true, frames = only.Frames, duration = only.Duration });
        return Describe(path, bytes, new
        {
            semanticReopen = true,
            frames = moving?.Frames ?? 0,
            duration = moving?.Duration ?? 0f,
            uv = living,
        });
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private static string F(float value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static string Vector3Element(string indent, string name, Vector3 value) =>
        $"{indent}<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" />\n";
    private static string Vector4Element(string indent, string name, Vector3 value) =>
        $"{indent}<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" w=\"0\" />\n";

    private sealed record CompileRequest(
        string Format,
        int Version,
        string? Name = null,
        string? ClipDictionary = null,
        string? Texture = null,
        string? TextureSha256 = null,
        int Width = 0,
        int Height = 0,
        float LodDist = 0,
        MeshRequest? Mesh = null,
        MotionRequest? Motion = null,
        string? Shader = null,
        float? Emissive = null,
        UvAnimationRequest? UvAnimation = null);

    private sealed record MeshRequest(float[]? Positions, float[]? Normals, float[]? Uvs, int[]? Parts, int[]? Indices);

    private sealed record MotionRequest(float Duration, float[]? Lift, float[]? Angle);

    /* Сдвиги развёртки: `[u0, v0, u1, v1, …]` на кадры клипа 30 кадров/с. */
    private sealed record UvAnimationRequest(float Duration, float[]? Shifts);
}
