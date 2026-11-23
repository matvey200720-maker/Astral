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
/// Метки залазов — модели мода, собранные заново.
///
/// В моде метки («STAY HERE», «JUMP SPACE», «1 POV CLICK», стрелка вверх…)
/// выдавлены геометрией, а зашитые текстуры дают им только цвет. Поменять
/// облик метки можно лишь новой моделью: здесь каждая собирается как
/// двусторонняя плашка на месте лица и спины метки, с текстурой, в которой
/// нарисована вся метка. Расстановка мода и его манифест не трогаются:
/// модели сохраняют имена архетипов, и ymap подхватывает их как прежние.
///
/// Метка тонкая вдоль одной оси модели: плоские надписи — вдоль Z, стоячие
/// (стрелка, «STAY HERE», «JUMP SPACE») — вдоль Y. Окно присылает плашку в
/// координатах лица — u вправо, v вверх, как их видит человек перед меткой
/// (`axis`, `facing`), — а здесь она ложится на оси модели.
///
/// Всё, что уходит в игру, повторяет ванильные образцы из архивов самой игры:
///   • светящаяся метка — `emissive_alpha.sps` (шейдер `emissive`, корзина 1,
///     параметры DiffuseSampler, matMaterialColorScale, HardAlphaBlend,
///     useTessellation, emissiveMultiplier, globalAnimUV1/0 — как у
///     `dt1_03_refprox_1.ydr`);
///   • крашеная — `alpha.sps` (шейдер `default`, корзина 1 — как логотипы
///     `dt1_03_build1x.ydr`);
///   • встроенная текстура — Usage DIFFUSE, Unk32 128, флаги размеров, как у
///     встроенных текстур ванильных пропов;
///   • вершины Position/Normal/Colour0/TexCoord0, шаг 36 байт — как у самих
///     моделей мода;
///   • маска корзин модели (`FlagsHigh`) — ровно корзина шейдера.
///
/// Двусторонняя плашка — потому что надпись мода выдавлена и видна с обеих
/// сторон. Спина (`back: "readable"`) несёт ту же картинку, развёрнутую
/// так, что и сзади надпись читается, а не зеркалится: автор мода ставил
/// «JUMP SPACE» лицом к стене почти в половине мест, и сзади его надпись
/// была зеркальной.
///
/// Места, где метки мода стоят друг на друге спина к спине (на парапете,
/// перилах, козырьке: «1 POV CLICK» с улицы, «JUMP SPACE» с крыши), окно
/// присылает списком (`placements.rename`): им нужна плашка только лицом
/// (`back: "none"`) — отдельный архетип-копия метки (`archetype` — чей), иначе
/// спина одной вылезает зеркальной надписью поверх лица другой. Пустые в
/// моде метки, что закрыли бы чужую надпись, и повторы одной метки в одной
/// точке убираются из расстановки (`placements.remove`). Без правок
/// расстановка едет байт в байт.
///
/// В типах правятся только границы архетипов собранных меток — чтобы
/// укрупнённая метка не пропадала у края экрана раньше времени — и
/// добавляются копии для мест «только лицом». Остальные архетипы типов
/// остаются как у автора мода.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class ClimbMarkerCommands
{
    private const string RequestFormat = "astral.compile-climb-markers";
    /* 2 — набор climbs (10.10.2026): имена меток из типов, плашка на любой
       оси. 3 — спина плашки читается, копии меток «только лицом» и правки
       расстановки (12.10.2026). */
    private const int RequestVersion = 3;
    private const int MaxRequestBytes = 256 * 1024;
    private const int MaxMarkers = 32;
    private const int MaxDdsBytes = 8 * 1024 * 1024;
    private const int MaxTypesBytes = 256 * 1024;
    private const int MaxMapBytes = 8 * 1024 * 1024;
    private const int MaxPlacementEdits = 4096;
    private const string BackReadable = "readable";
    private const string BackNone = "none";
    /* Блок карты, пересобранной с правками: без времени сборки — команда
       детерминирована. */
    private const string MapExportedBy = "Astral Climbs 3";
    private const string MapExportTime = "01 January 1970 00:00";
    private const float LodDistance = 9998f;
    private const float MaxExtent = 4f;
    private const float MaxDepth = 0.25f;
    private const float MaxEmissive = 16f;
    private const int RenderBucket = 1;
    private const int BucketMask = 1 << RenderBucket;

    private static readonly Regex AssetName = new("^[a-z0-9_]{1,40}$", RegexOptions.CultureInvariant);

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
            throw new InvalidDataException("Climb markers request must be between 1 byte and 64 KiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Climb markers request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Climb markers request has an unknown format.");
        if (!AssetName.IsMatch(request.TypesName ?? ""))
            throw new InvalidDataException("Climb types name must be a lowercase asset name.");
        var markers = ValidateMarkers(request);
        var typesPath = ValidateTypes(request.Types);
        var sourceTypes = await File.ReadAllBytesAsync(typesPath);
        var typeNames = ArchetypeNames(sourceTypes, request.TypesName!);
        foreach (var marker in markers)
        {
            var known = typeNames.Contains(JenkHash.GenHash(marker.Model));
            /* Метка мода — архетип из типов; копия «только лицом» — новое имя,
               которого в типах нет. */
            if (marker.Archetype is null && !known)
                throw new InvalidDataException($"Climb types have no archetype for {marker.Model}.");
            if (marker.Archetype is not null && known)
                throw new InvalidDataException($"Climb marker copy {marker.Model} collides with an archetype of the types.");
        }
        var map = ValidateMap(request.Map);
        var mapSource = await File.ReadAllBytesAsync(map.Path);

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Climb markers output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Climb markers output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Climb markers output directory must be empty.");

        var assets = Path.Combine(output, ".texture-assets");
        Directory.CreateDirectory(assets);
        var described = new List<object>();
        try
        {
            foreach (var marker in markers)
            {
                var texture = await ReadTextureAsync(marker);
                await File.WriteAllBytesAsync(Path.Combine(assets, TextureName(marker.Model) + ".dds"), texture.Bytes);
                var ydr = XmlYdr.GetYdr(BuildYdrXml(marker, texture), assets);
                if (ydr.Drawable is null)
                    throw new InvalidDataException($"Generated climb marker {marker.Model} has no drawable.");
                var bytes = ydr.Save();
                var path = Path.Combine(output, marker.Model + ".ydr");
                await File.WriteAllBytesAsync(path, bytes);
                described.Add(ReopenDrawable(path, bytes, marker, texture));
            }
        }
        finally
        {
            Directory.Delete(assets, true);
        }

        var typesOutput = Path.Combine(output, request.TypesName + ".ytyp");
        described.Add(await WriteTypesAsync(sourceTypes, request.TypesName!, typesOutput, markers));
        described.Add(await WriteMapAsync(mapSource, map.Name, Path.Combine(output, map.Name + ".ymap"), markers, request.Placements));

        return new
        {
            format = "astral.climb-marker-artifacts",
            version = RequestVersion,
            files = described,
        };
    }

    /* ------------------------------------------------------------------ */

    private static IReadOnlyList<Marker> ValidateMarkers(CompileRequest request)
    {
        var list = request.Markers ?? throw new InvalidDataException("Climb markers request must list markers.");
        if (list.Length is 0 or > MaxMarkers)
            throw new InvalidDataException("Climb markers request must list 1–32 markers.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in list)
        {
            if (item is null || !AssetName.IsMatch(item.Model ?? ""))
                throw new InvalidDataException("Climb marker model must be a lowercase asset name.");
            if (!seen.Add(item.Model))
                throw new InvalidDataException($"Climb marker {item.Model} is listed twice.");
            if (item.Back is not (BackReadable or BackNone))
                throw new InvalidDataException($"Climb marker {item.Model} has an unknown back face.");
            /* Копия метки — только лицом и от метки мода из этого же запроса. */
            if (item.Archetype is not null)
            {
                var source = list.FirstOrDefault(other => other?.Model == item.Archetype);
                if (source is null || source.Archetype is not null || item.Back != BackNone)
                    throw new InvalidDataException($"Climb marker copy {item.Model} must be a front-only copy of a listed marker.");
            }
            var quad = item.Quad ?? throw new InvalidDataException($"Climb marker {item.Model} has no quad.");
            float[] values = [quad.MinX, quad.MinY, quad.MaxX, quad.MaxY];
            if (values.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent) ||
                quad.MinX >= quad.MaxX || quad.MinY >= quad.MaxY)
                throw new InvalidDataException($"Climb marker {item.Model} has an invalid quad.");
            if (quad.Axis is not ("z" or "y") || quad.Facing is not (1 or -1))
                throw new InvalidDataException($"Climb marker {item.Model} has an unknown axis or facing.");
            if (!float.IsFinite(quad.Front) || !float.IsFinite(quad.Back) ||
                Math.Abs(quad.Front) > MaxDepth || Math.Abs(quad.Back) > MaxDepth ||
                (quad.Front - quad.Back) * quad.Facing <= 0)
                throw new InvalidDataException($"Climb marker {item.Model} has an invalid depth.");
            if (!float.IsFinite(item.Emissive) || item.Emissive < 0 || item.Emissive > MaxEmissive)
                throw new InvalidDataException($"Climb marker {item.Model} emissive multiplier is out of range.");
            if (!item.Lit && item.Emissive <= 0)
                throw new InvalidDataException($"Climb marker {item.Model} glows with a zero multiplier.");
            if (item.Visible)
            {
                if (!IsPowerOfTwo(item.Width) || !IsPowerOfTwo(item.Height) ||
                    item.Width is < 4 or > 2048 || item.Height is < 4 or > 2048)
                    throw new InvalidDataException($"Climb marker {item.Model} texture size must be a power of two 4…2048.");
                if (!Regex.IsMatch(item.TextureSha256 ?? "", "^sha256:[a-f0-9]{64}$"))
                    throw new InvalidDataException($"Climb marker {item.Model} has an invalid texture SHA-256.");
            }
        }
        return list;
    }

    private static string ValidateTypes(string? types)
    {
        var path = Path.GetFullPath(types ?? "");
        if (!File.Exists(path) || !path.EndsWith(".ytyp", StringComparison.OrdinalIgnoreCase))
            throw new FileNotFoundException("Climb types (.ytyp) were not found.", path);
        var info = new FileInfo(path);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 16 or > MaxTypesBytes)
            throw new InvalidDataException("Climb types file has an unsafe type or size.");
        return path;
    }

    private sealed record MapSource(string Path, string Name);

    private static MapSource ValidateMap(MapRequest? map)
    {
        if (map is null || !AssetName.IsMatch(map.Name ?? ""))
            throw new InvalidDataException("Climb map must be named with a lowercase asset name.");
        var path = Path.GetFullPath(map.Input ?? "");
        if (!File.Exists(path) || !path.EndsWith(".ymap", StringComparison.OrdinalIgnoreCase))
            throw new FileNotFoundException("Climb map (.ymap) was not found.", path);
        var info = new FileInfo(path);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 16 or > MaxMapBytes)
            throw new InvalidDataException("Climb map file has an unsafe type or size.");
        return new MapSource(path, map.Name!);
    }

    private static HashSet<uint> ArchetypeNames(byte[] bytes, string name)
    {
        var ytyp = new YtypFile { Name = name + ".ytyp" };
        ytyp.Load(bytes);
        if (!ytyp.Loaded || ytyp.AllArchetypes is not { Length: > 0 })
            throw new InvalidDataException("Climb types could not be read.");
        return ytyp.AllArchetypes.Select(item => item._BaseArchetypeDef.name.Hash).ToHashSet();
    }

    private static bool IsPowerOfTwo(int value) => value > 0 && (value & (value - 1)) == 0;

    private static int FullMipLevels(int width, int height) => (int)Math.Log2(Math.Max(width, height)) + 1;

    private static string TextureName(string model) => model + "_astral";

    /* ------------------------------------------------------------------ */

    /*
     * Координаты лица → оси модели. u — вправо, v — вверх, как их видит
     * человек перед лицом: для лица в +Z (сверху) и в −Y вправо — это +X,
     * для лица в −Z и в +Y — −X; v — это Y у плоской метки и Z у стоячей,
     * глубина — вдоль оси метки.
     */
    private static Vector3 ToModel(Quad quad, float u, float v, float depth)
    {
        var mirror = (quad.Axis == "z" && quad.Facing < 0) || (quad.Axis == "y" && quad.Facing > 0);
        var x = mirror ? -u : u;
        return quad.Axis == "z" ? new Vector3(x, v, depth) : new Vector3(x, depth, v);
    }

    private static Vector3 Normal(Quad quad, float sign) =>
        quad.Axis == "z" ? new Vector3(0, 0, sign * quad.Facing) : new Vector3(0, sign * quad.Facing, 0);

    private static (Vector3 Min, Vector3 Max) PlateBounds(Quad quad)
    {
        var min = new Vector3(float.MaxValue);
        var max = new Vector3(float.MinValue);
        foreach (var u in new[] { quad.MinX, quad.MaxX })
            foreach (var v in new[] { quad.MinY, quad.MaxY })
                foreach (var depth in new[] { quad.Front, quad.Back })
                {
                    var point = ToModel(quad, u, v, depth);
                    min = Vector3.Min(min, point);
                    max = Vector3.Max(max, point);
                }
        return (min, max);
    }

    private sealed record Texture(byte[] Bytes, int Width, int Height, int Levels, string Sha256);

    private static async Task<Texture> ReadTextureAsync(Marker marker)
    {
        if (!marker.Visible) return EmptyTexture();
        var file = Path.GetFullPath(marker.Texture ?? "");
        if (!File.Exists(file)) throw new FileNotFoundException($"Texture for {marker.Model} was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"Texture for {marker.Model} has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        var levels = BitConverter.ToInt32(bytes, 28);
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " ||
            BitConverter.ToInt32(bytes, 12) != marker.Height ||
            BitConverter.ToInt32(bytes, 16) != marker.Width ||
            levels != FullMipLevels(marker.Width, marker.Height) ||
            Encoding.ASCII.GetString(bytes, 84, 4) != "DXT5")
            throw new InvalidDataException(
                $"Texture for {marker.Model} is not {marker.Width}x{marker.Height} DXT5 with a full mip chain.");
        if (bytes.Length != 128 + Dxt5Bytes(marker.Width, marker.Height, levels))
            throw new InvalidDataException($"Texture for {marker.Model} is truncated or padded.");
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (marker.TextureSha256 != "sha256:" + digest)
            throw new InvalidDataException($"Texture SHA-256 mismatch for {marker.Model}.");
        return new Texture(bytes, marker.Width, marker.Height, levels, digest);
    }

    private static int Dxt5Bytes(int width, int height, int levels)
    {
        var total = 0;
        for (var level = 0; level < levels; level++)
        {
            var w = Math.Max(1, width >> level);
            var h = Math.Max(1, height >> level);
            total += Math.Max(1, (w + 3) / 4) * Math.Max(1, (h + 3) / 4) * 16;
        }
        return total;
    }

    /*
     * Скрытая метка — плашка с прозрачной текстурой 4×4. Модель остаётся на
     * месте (её ждёт расстановка), но не рисует ничего: блок DXT5 из нулей —
     * это ноль альфы во всех шестнадцати пикселях.
     */
    private static Texture EmptyTexture()
    {
        const int levels = 3;
        var payload = new byte[levels * 16];
        var bytes = WriteDxt5Header(4, 4, levels).Concat(payload).ToArray();
        return new Texture(bytes, 4, 4, levels, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
    }

    private static byte[] WriteDxt5Header(int width, int height, int levels)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);
        writer.Write(Encoding.ASCII.GetBytes("DDS "));
        writer.Write(124u);
        writer.Write(0x1u | 0x2u | 0x4u | 0x1000u | 0x20000u | 0x80000u);
        writer.Write((uint)height);
        writer.Write((uint)width);
        writer.Write((uint)Math.Max(16, ((width + 3) / 4) * ((height + 3) / 4) * 16));
        writer.Write(0u);
        writer.Write((uint)levels);
        for (var index = 0; index < 11; index++) writer.Write(0u);
        writer.Write(32u);
        writer.Write(0x4u);
        writer.Write(Encoding.ASCII.GetBytes("DXT5"));
        for (var index = 0; index < 5; index++) writer.Write(0u);
        writer.Write(0x1000u | 0x400000u | 0x8u);
        for (var index = 0; index < 4; index++) writer.Write(0u);
        writer.Flush();
        return stream.ToArray();
    }

    /* Флаги размеров встроенной текстуры — как у ванильных пропов: ступени
       до стороны текстуры, без HD_SPLIT (текстура живёт в самой модели) и с
       NOT_HALF (метку не мутят половинным уровнем на низких настройках). */
    private static string UsageFlags(int width, int height)
    {
        var side = Math.Max(width, height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        flags.Add("UNK24");
        return string.Join(", ", flags);
    }

    private static string BuildYdrXml(Marker marker, Texture texture)
    {
        var q = marker.Quad!;
        var (min, max) = PlateBounds(q);
        var centre = (min + max) * 0.5f;
        var radius = Vector3.Distance(centre, max);
        var name = TextureName(marker.Model);
        var lod = F(LodDistance);
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Drawable>\n")
            .Append(" <Name>").Append(marker.Model).Append("</Name>\n")
            .Append(Vector3Element(" ", "BoundingSphereCenter", centre))
            .Append(" <BoundingSphereRadius value=\"").Append(F(radius)).Append("\" />\n")
            .Append(Vector3Element(" ", "BoundingBoxMin", min))
            .Append(Vector3Element(" ", "BoundingBoxMax", max))
            .Append(" <LodDistHigh value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistMed value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistLow value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistVlow value=\"").Append(lod).Append("\" />\n")
            .Append(" <FlagsHigh value=\"").Append(BucketMask).Append("\" />\n")
            .Append(" <FlagsMed value=\"0\" />\n <FlagsLow value=\"0\" />\n <FlagsVlow value=\"0\" />\n")
            .Append(" <ShaderGroup>\n  <TextureDictionary>\n   <Item>\n")
            .Append("    <Name>").Append(name).Append("</Name>\n")
            .Append("    <Unk32 value=\"128\" />\n")
            .Append("    <Usage>DIFFUSE</Usage>\n")
            .Append("    <UsageFlags>").Append(UsageFlags(texture.Width, texture.Height)).Append("</UsageFlags>\n")
            .Append("    <ExtraFlags value=\"0\" />\n")
            .Append("    <Width value=\"").Append(texture.Width).Append("\" />\n")
            .Append("    <Height value=\"").Append(texture.Height).Append("\" />\n")
            .Append("    <MipLevels value=\"").Append(texture.Levels).Append("\" />\n")
            .Append("    <Format>D3DFMT_DXT5</Format>\n")
            .Append("    <FileName>").Append(name).Append(".dds</FileName>\n")
            .Append("   </Item>\n  </TextureDictionary>\n  <Shaders>\n   <Item>\n");
        if (marker.Lit)
            xml.Append("    <Name>default</Name>\n    <FileName>alpha.sps</FileName>\n");
        else
            xml.Append("    <Name>emissive</Name>\n    <FileName>emissive_alpha.sps</FileName>\n");
        xml.Append("    <RenderBucket value=\"").Append(RenderBucket).Append("\" />\n")
            .Append("    <Parameters>\n")
            .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(name).Append("</Name></Item>\n")
            .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
            .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n");
        if (marker.Lit)
            xml.Append("     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n");
        else
            xml.Append("     <Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"").Append(F(marker.Emissive)).Append("\" y=\"0\" z=\"0\" w=\"0\" />\n");
        xml.Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("    </Parameters>\n   </Item>\n  </Shaders>\n </ShaderGroup>\n")
            .Append(" <DrawableModelsHigh>\n  <Item>\n")
            .Append("   <RenderMask value=\"255\" />\n   <Flags value=\"0\" />\n   <HasSkin value=\"0\" />\n")
            .Append("   <BoneIndex value=\"0\" />\n   <Unknown1 value=\"0\" />\n   <Geometries>\n")
            .Append("    <Item>\n     <ShaderIndex value=\"0\" />\n")
            .Append(Vector4Element("     ", "BoundingBoxMin", min))
            .Append(Vector4Element("     ", "BoundingBoxMax", max))
            .Append("     <VertexBuffer>\n      <Flags value=\"0\" />\n")
            .Append("      <Layout type=\"GTAV1\"><Position /><Normal /><Colour0 /><TexCoord0 /></Layout>\n      <Data>\n");
        /*
         * Лицо смотрит на зрителя и обходится против часовой, как он его
         * видит (u вправо, v вверх); спина — назад, обход обратный. v
         * текстуры растёт вниз, как в картинке. У спины развёртка по
         * горизонтали обратная: человек за меткой видит ту же надпись, а не её
         * зеркало. Плашка «только лицом» спины не имеет вовсе.
         */
        var corners = new (float U, float V, float S, float T)[]
        {
            (q.MinX, q.MinY, 0f, 1f),
            (q.MaxX, q.MinY, 1f, 1f),
            (q.MaxX, q.MaxY, 1f, 0f),
            (q.MinX, q.MaxY, 0f, 0f),
        };
        var faces = marker.Back == BackNone
            ? new[] { (q.Front, 1f) }
            : new[] { (q.Front, 1f), (q.Back, -1f) };
        foreach (var (depth, sign) in faces)
        {
            var normal = Normal(q, sign);
            foreach (var corner in corners)
            {
                var position = ToModel(q, corner.U, corner.V, depth);
                var s = sign > 0 ? corner.S : 1f - corner.S;
                xml.Append("       ").Append(F(position.X)).Append(' ').Append(F(position.Y)).Append(' ').Append(F(position.Z))
                    .Append("   ").Append(F(normal.X)).Append(' ').Append(F(normal.Y)).Append(' ').Append(F(normal.Z))
                    .Append("   255 255 255 255   ").Append(F(s)).Append(' ').Append(F(corner.T)).Append('\n');
            }
        }
        var indices = marker.Back == BackNone ? "0 1 2 0 2 3" : "0 1 2 0 2 3 4 6 5 4 7 6";
        xml.Append("      </Data>\n     </VertexBuffer>\n     <IndexBuffer><Data>").Append(indices).Append("</Data></IndexBuffer>\n    </Item>\n")
            .Append("   </Geometries>\n  </Item>\n </DrawableModelsHigh>\n</Drawable>\n");
        return xml.ToString();
    }

    private static object ReopenDrawable(string path, byte[] bytes, Marker marker, Texture texture)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var drawable = ydr.Drawable;
        var shaders = drawable?.ShaderGroup?.Shaders?.data_items;
        var textures = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items;
        var geometries = drawable?.DrawableModels?.High?.SelectMany(model => model.Geometries ?? []).ToArray() ?? [];
        var expectedShader = marker.Lit ? "default" : "emissive";
        var expectedFile = marker.Lit ? "alpha.sps" : "emissive_alpha.sps";
        var twoSided = marker.Back != BackNone;
        if (!ydr.Loaded || drawable is null || shaders is not { Length: 1 } ||
            shaders[0].Name.Hash != JenkHash.GenHash(expectedShader) ||
            shaders[0].FileName.Hash != JenkHash.GenHash(expectedFile) ||
            shaders[0].RenderBucket != RenderBucket ||
            drawable.FlagsHigh != BucketMask ||
            textures is not { Length: 1 } ||
            textures[0].Width != texture.Width || textures[0].Height != texture.Height ||
            textures[0].Levels != texture.Levels ||
            geometries.Length != 1 ||
            geometries[0].VerticesCount != (twoSided ? 8 : 4) || geometries[0].IndicesCount != (twoSided ? 12 : 6) ||
            geometries[0].VertexBuffer?.Info?.Flags != 89 || geometries[0].VertexStride != 36)
            throw new InvalidDataException($"Compiled climb marker {marker.Model} failed semantic reopen.");
        /* Спина читается: у каждой её вершины развёртка по горизонтали —
           зеркало вершины лица (компонент 6 — TexCoord0). */
        if (twoSided)
        {
            var data = geometries[0].VertexData;
            for (var vertex = 0; vertex < 4; vertex++)
            {
                var face = data.GetVector2(vertex, 6);
                var back = data.GetVector2(vertex + 4, 6);
                if (Math.Abs(face.X + back.X - 1f) > 1e-4f || Math.Abs(face.Y - back.Y) > 1e-4f)
                    throw new InvalidDataException($"Compiled climb marker {marker.Model} has a mirrored back face.");
            }
        }
        return Describe(path, bytes, new
        {
            semanticReopen = true,
            model = marker.Model,
            archetypeOf = marker.Archetype,
            visible = marker.Visible,
            back = marker.Back,
            shader = expectedFile,
            bucketMask = (int)drawable.FlagsHigh,
            texture = new { width = texture.Width, height = texture.Height, mipLevels = texture.Levels, sha256 = texture.Sha256 },
        });
    }

    /*
     * Типы мода с границами по новым плашкам. Остальное в архетипах — имена,
     * дальности, флаги, словари, — и архетипы без собранной метки остаются
     * тем, что написал автор мода.
     */
    private static async Task<object> WriteTypesAsync(byte[] sourceBytes, string name, string target, IReadOnlyList<Marker> markers)
    {
        var ytyp = new YtypFile { Name = name + ".ytyp" };
        ytyp.Load(sourceBytes);
        var archetypes = ytyp.AllArchetypes ?? [];
        var before = archetypes.Select(item => item._BaseArchetypeDef.name.Hash).ToList();
        var mods = markers.Where(item => item.Archetype is null).ToArray();
        var copies = markers.Where(item => item.Archetype is not null).ToArray();
        var adjusted = 0;
        var byName = new Dictionary<uint, CBaseArchetypeDef>();
        foreach (var archetype in archetypes)
        {
            var marker = mods.SingleOrDefault(item => JenkHash.GenHash(item.Model) == archetype._BaseArchetypeDef.name.Hash);
            if (marker is null) continue;
            var definition = WithPlate(archetype._BaseArchetypeDef, marker.Quad!);
            archetype._BaseArchetypeDef = definition;
            byName[definition.name.Hash] = definition;
            adjusted++;
        }
        if (adjusted != mods.Length)
            throw new InvalidDataException("Every climb marker needs its own archetype in the types.");
        /*
         * Копия «только лицом» — тот же архетип метки мода (дальности, флаги)
         * под своим именем: модель — своя, текстуры зашиты в неё же.
         */
        foreach (var copy in copies)
        {
            var source = byName[JenkHash.GenHash(copy.Archetype!)];
            var hash = new MetaHash(JenkHash.GenHash(copy.Model));
            var definition = WithPlate(source, copy.Quad!);
            definition.name = hash;
            definition.assetName = hash;
            if (source.textureDictionary.Hash == source.name.Hash) definition.textureDictionary = hash;
            definition.extensions = new Array_StructurePointer();
            var archetype = new Archetype();
            archetype.Init(ytyp, ref definition);
            ytyp.AddArchetype(archetype);
            before.Add(hash.Hash);
        }
        var bytes = ytyp.Save();
        await File.WriteAllBytesAsync(target, bytes);

        var reopened = new YtypFile { Name = name + ".ytyp" };
        reopened.Load(bytes);
        var names = reopened.AllArchetypes?.Select(item => item._BaseArchetypeDef.name.Hash).ToArray() ?? [];
        if (!reopened.Loaded || !names.SequenceEqual(before))
            throw new InvalidDataException($"Compiled {name}.ytyp failed semantic reopen.");
        return Describe(target, bytes, new { semanticReopen = true, archetypes = names.Length, adjusted, added = copies.Length });
    }

    private static CBaseArchetypeDef WithPlate(CBaseArchetypeDef definition, Quad quad)
    {
        var (plateMin, plateMax) = PlateBounds(quad);
        var min = Vector3.Min(definition.bbMin, plateMin);
        var max = Vector3.Max(definition.bbMax, plateMax);
        definition.bbMin = min;
        definition.bbMax = max;
        definition.bsCentre = (min + max) * 0.5f;
        definition.bsRadius = Vector3.Distance(definition.bsCentre, max);
        return definition;
    }

    /*
     * Расстановка мода с правками окна. Без правок — байт в байт как у мода.
     * С правками — та же карта, пересобранная CodeWalker: имя карты (на нём
     * держится связь «карта → типы» в манифесте), флаги и рамки — прежние;
     * места меняют только архетип (на копию «только лицом» своей же метки)
     * или уходят из расстановки.
     */
    private static async Task<object> WriteMapAsync(
        byte[] source, string name, string target, IReadOnlyList<Marker> markers, PlacementEdits? edits)
    {
        var rename = edits?.Rename ?? [];
        var remove = edits?.Remove ?? [];
        if (rename.Length > MaxPlacementEdits || remove.Length > MaxPlacementEdits)
            throw new InvalidDataException("Climb placement edits list too many places.");
        var ymap = new YmapFile { Name = name + ".ymap" };
        ymap.Load(source);
        /* Load без записи архива обнуляет имя файла, а Save берёт имя карты
           из него. */
        ymap.Name = name + ".ymap";
        var entities = ymap.AllEntities ?? [];
        if (!ymap.Loaded || entities.Length == 0 || ymap.CMapData.name.Hash != JenkHash.GenHash(name))
            throw new InvalidDataException($"Climb map {name}.ymap could not be read or has another name.");
        if (rename.Length == 0 && remove.Length == 0)
        {
            await File.WriteAllBytesAsync(target, source);
            return Describe(target, source, new { semanticReopen = true, edited = false, entities = entities.Length, renamed = 0, removed = 0 });
        }

        var mods = markers.Where(item => item.Archetype is null).Select(item => JenkHash.GenHash(item.Model)).ToHashSet();
        var touched = new HashSet<int>();
        YmapEntityDef Place(int index)
        {
            if (index < 0 || index >= entities.Length || !touched.Add(index))
                throw new InvalidDataException($"Climb placement {index} is out of range or edited twice.");
            var entity = entities[index];
            if (entity.IsMlo || !mods.Contains(entity.CEntityDef.archetypeName.Hash))
                throw new InvalidDataException($"Climb placement {index} is not a marker of this request.");
            return entity;
        }
        var expected = entities.Select(entity => entity.CEntityDef.archetypeName.Hash).ToArray();
        foreach (var item in rename)
        {
            var entity = Place(item.Index);
            var copy = markers.FirstOrDefault(marker => marker.Archetype is not null && marker.Model == item.Archetype)
                ?? throw new InvalidDataException($"Climb placement {item.Index} is renamed to an unknown copy.");
            if (JenkHash.GenHash(copy.Archetype!) != entity.CEntityDef.archetypeName.Hash)
                throw new InvalidDataException($"Climb placement {item.Index} is renamed to a copy of another marker.");
            var definition = entity.CEntityDef;
            definition.archetypeName = new MetaHash(JenkHash.GenHash(copy.Model));
            entity.CEntityDef = definition;
            expected[item.Index] = definition.archetypeName.Hash;
        }
        var gone = remove.Select(Place).ToArray();
        foreach (var entity in gone) ymap.RemoveEntity(entity);
        var kept = expected.Where((_, index) => !remove.Contains(index)).ToArray();
        var positions = entities.Where((_, index) => !remove.Contains(index)).Select(entity => entity.CEntityDef.position).ToArray();
        ymap.BlockExportedBy = MapExportedBy;
        ymap.BlockTime = MapExportTime;
        var bytes = ymap.Save();
        await File.WriteAllBytesAsync(target, bytes);

        var reopened = new YmapFile { Name = name + ".ymap" };
        reopened.Load(bytes);
        var after = reopened.AllEntities ?? [];
        if (!reopened.Loaded || reopened.CMapData.name.Hash != JenkHash.GenHash(name) || after.Length != kept.Length)
            throw new InvalidDataException($"Compiled {name}.ymap failed semantic reopen.");
        for (var index = 0; index < after.Length; index++)
            if (after[index].CEntityDef.archetypeName.Hash != kept[index] ||
                Vector3.Distance(after[index].CEntityDef.position, positions[index]) > 1e-4f)
                throw new InvalidDataException($"Compiled {name}.ymap moved or renamed a place it should not.");
        return Describe(target, bytes, new
        {
            semanticReopen = true,
            edited = true,
            entities = after.Length,
            renamed = rename.Length,
            removed = remove.Length,
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
        string? Types = null,
        string? TypesName = null,
        MapRequest? Map = null,
        Marker[]? Markers = null,
        PlacementEdits? Placements = null);

    private sealed record MapRequest(string? Input = null, string? Name = null);

    private sealed record PlacementEdits(PlacementRename[]? Rename = null, int[]? Remove = null);

    private sealed record PlacementRename(int Index, string? Archetype = null);

    private sealed record Marker(
        string Model,
        bool Visible,
        string? Texture,
        string? TextureSha256,
        int Width,
        int Height,
        Quad? Quad,
        bool Lit,
        float Emissive,
        string? Back = null,
        string? Archetype = null);

    private sealed record Quad(float MinX, float MinY, float MaxX, float MaxY, float Front, float Back, string Axis, int Facing);
}
