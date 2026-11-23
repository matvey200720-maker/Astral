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
/// Эмблема человека в мире — плашка с картинкой на любом месте карты.
///
/// Листы штатных моделей повторяются по развёртке (у завода — плитка на
/// весь корпус), поэтому картинку «в одно место» в них не запечь: она
/// повторилась бы на каждом повторе листа. Здесь картинка едет своей
/// моделью — плоской плашкой, которую игра ставит своей картой:
///   • модели `&lt;имя&gt;.ydr` — двусторонняя плашка в плоскости XZ (ширина по X,
///     высота по Z), лицевая грань смотрит в −Y, развёртка — u по +X, v вниз;
///     шейдер `default` / `alpha.sps` в корзине прозрачности (корзина 1),
///     встроенная DXT5 с полной цепочкой мип-уровней — ровно как крашеные
///     плашки залазов (`ClimbMarkerCommands`, сверено с ванильными
///     логотипами `dt1_03_build1x.ydr`);
///   • типы `&lt;types&gt;.ytyp` — по архетипу на плашку: DRAWABLE, флаги 32 и
///     словарь текстур — сама модель, как у своих архетипов прострелов;
///   • расстановка `&lt;map&gt;.ymap` — по месту на плашку: точка, разворот
///     (кватернион пишется как есть — его считает окно в договоре игры),
///     сироты HD (`LODTYPES_DEPTH_ORPHANHD`), флаги 32;
///   • `_manifest.ymf` связывает расстановку с типами.
/// Коллизии у плашки нет: она лежит на стене и не мешает ходить.
///
/// Дальняя плашка (`far`, фикс 1 ТЗ 06.10.2026). Вдали игра рисует здание
/// дальними моделями (LOD, SLOD), и плашка с дальностью здания пропадала
/// вместе с его HD-моделью: баннер Мегамолла и логотип «Ашана» вдали
/// становились штатной стеной. Картинку «в одно место» в листы дальних
/// моделей не запечь (их развёртка повторяется), поэтому у плашки есть
/// вторая расстановка — как у Rockstar: карта `&lt;map&gt;_lod.ymap` с той же
/// плашкой уровнем LOD (чуть впереди дальних моделей: их стены выступают
/// дальше HD), а сущность HD — её ребёнок (`parentIndex`, флаг 8 «родитель
/// в карте-родителе», `CMapData.parent`). Вблизи игра показывает ребёнка,
/// дальше `childLodDist` — родителя до его `lodDist`.
///
/// Своя картинка дальней (`far.texture`, задача 7 ТЗ 10.10.2026): дальняя
/// плашка — своя модель и свой архетип `<имя>_far`, а не та же плашка.
/// Так вдали встаёт то, чего вблизи нет: надпись на холме (Вайнвуд) вблизи
/// — объёмные буквы моделей игры, с конца SLOD1 (внахлёст) — плашка слова, и её
/// HD-ребёнок — прозрачная плашка, которая только держит дальнюю.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class EmblemPlateCommands
{
    private const string RequestFormat = "astral.compile-emblem-plates";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 256 * 1024;
    private const int MaxDdsBytes = 8 * 1024 * 1024;
    /* Стороны, логотипы, надписи и места табличек здания (05.10.2026: до 64 мест). */
    private const int MaxPlates = 96;
    private const float MinSize = 0.2f;
    private const float MaxSize = 160f;
    private const float MaxCoordinate = 20000f;
    private const float MinLodDistance = 10f;
    private const float MaxLodDistance = 2000f;
    /* Дальняя плашка: дальность до 5 км (своей картинкой — до 15 км, как SLOD3
       штатной надписи на холме Вайнвуд: через весь город) и не дальше 5 м от
       своей HD. Потолок для плашек без своей картинки остаётся 5 км. */
    private const float MaxFarLodDistance = 5000f;
    private const float MaxOwnFarLodDistance = 15000f;
    private const string FarSuffix = "_far";
    private const float MaxFarOffset = 5f;
    /* Флаг сущности «родитель LOD — в карте-родителе» (`LodInParentYmap`). */
    private const uint LodInParentFlag = 8;
    private const string LodMapSuffix = "_lod";
    private const int RenderBucket = 1;
    private const int BucketMask = 1 << RenderBucket;
    private const uint ArchetypeFlags = 32;
    private const uint EntityFlags = 32;
    private const float PlateThickness = 0.01f;
    private const string ExportedBy = "Astral Emblem Plates 1";
    private const string ExportTime = "01 January 1970 00:00";

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
            throw new InvalidDataException("Emblem plates request must be between 1 byte and 256 KiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Emblem plates request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Emblem plates request has an unknown format.");
        var typesName = ValidName(request.TypesName, "types");
        var mapName = ValidName(request.MapName, "map");
        if (typesName == mapName) throw new InvalidDataException("Emblem plate types and map need different names.");
        var lodMapName = ValidName(mapName + LodMapSuffix, "far map");
        var plates = ValidatePlates(request.Plates, typesName, mapName, lodMapName);
        var farPlates = plates.Where(plate => plate.Far is not null).ToArray();
        /* Дальние плашки со своей картинкой — свои модели и архетипы. */
        var ownFar = farPlates.Where(plate => plate.Far!.Texture is not null).Select(FarModel).ToArray();

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Emblem plates output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Emblem plates output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Emblem plates output directory must be empty.");

        var described = new List<object>();
        var assets = Path.Combine(output, ".texture-assets");
        Directory.CreateDirectory(assets);
        try
        {
            foreach (var plate in plates.Concat(ownFar))
            {
                var texture = await ReadTextureAsync(plate);
                await File.WriteAllBytesAsync(Path.Combine(assets, TextureName(plate.Name) + ".dds"), texture.Bytes);
                var ydr = XmlYdr.GetYdr(BuildYdrXml(plate, texture), assets);
                if (ydr.Drawable is null)
                    throw new InvalidDataException($"Generated emblem plate {plate.Name} has no drawable.");
                var bytes = ydr.Save();
                var path = Path.Combine(output, plate.Name + ".ydr");
                await File.WriteAllBytesAsync(path, bytes);
                described.Add(ReopenDrawable(path, bytes, plate, texture));
            }
        }
        finally
        {
            Directory.Delete(assets, true);
        }

        /* Типы: по архетипу на плашку. */
        var ytyp = new YtypFile
        {
            Name = typesName + ".ytyp",
            NameHash = JenkHash.GenHash(typesName),
            CMapTypes = new CMapTypes(),
        };
        var archetypes = new List<Archetype>();
        var byName = new Dictionary<string, Archetype>(StringComparer.Ordinal);
        foreach (var plate in plates.Concat(ownFar))
        {
            var (min, max) = PlateBounds(plate);
            var centre = (min + max) * 0.5f;
            var asset = new MetaHash(JenkHash.GenHash(plate.Name));
            var definition = new CBaseArchetypeDef
            {
                lodDist = DrawDistance(plate),
                flags = ArchetypeFlags,
                specialAttribute = 0,
                bbMin = min,
                bbMax = max,
                bsCentre = centre,
                bsRadius = Vector3.Distance(centre, max),
                hdTextureDist = Math.Min(plate.LodDist, 100f),
                name = asset,
                textureDictionary = asset,
                assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
                assetName = asset,
            };
            var archetype = new Archetype();
            archetype.Init(ytyp, ref definition);
            archetypes.Add(archetype);
            byName[plate.Name] = archetype;
        }
        ytyp.AllArchetypes = archetypes.ToArray();
        var typesPath = Path.Combine(output, typesName + ".ytyp");
        var typesBytes = ytyp.Save();
        await File.WriteAllBytesAsync(typesPath, typesBytes);

        /* Расстановка: по месту на плашку. У плашки с дальней — ребёнок
           дальней из карты-родителя (номер дальней — по порядку дальних). */
        var entities = new List<YmapEntityDef>();
        foreach (var plate in plates)
        {
            var parent = Array.IndexOf(farPlates, plate);
            var definition = new CEntityDef
            {
                archetypeName = new MetaHash(JenkHash.GenHash(plate.Name)),
                flags = parent >= 0 ? EntityFlags | LodInParentFlag : EntityFlags,
                guid = JenkHash.GenHash(mapName + "/" + plate.Name),
                position = new Vector3(plate.Position![0], plate.Position[1], plate.Position[2]),
                rotation = new Vector4(plate.Rotation![0], plate.Rotation[1], plate.Rotation[2], plate.Rotation[3]),
                scaleXY = 1f,
                scaleZ = 1f,
                parentIndex = parent,
                lodDist = plate.LodDist,
                childLodDist = 0f,
                lodLevel = parent >= 0 ? rage__eLodType.LODTYPES_DEPTH_HD : rage__eLodType.LODTYPES_DEPTH_ORPHANHD,
                numChildren = 0,
                priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
                ambientOcclusionMultiplier = 255,
                artificialAmbientOcclusion = 255,
                tintValue = 0,
            };
            var entity = new YmapEntityDef(null, entities.Count, ref definition);
            entity.SetArchetype(byName[plate.Name]);
            entities.Add(entity);
        }
        var ymap = new YmapFile
        {
            Name = mapName + ".ymap",
            CMapData = new CMapData
            {
                name = new MetaHash(JenkHash.GenHash(mapName)),
                parent = new MetaHash(farPlates.Length > 0 ? JenkHash.GenHash(lodMapName) : 0),
            },
            AllEntities = entities.ToArray(),
            BlockExportedBy = ExportedBy,
            BlockTime = ExportTime,
        };
        ymap.CalcFlags();
        ymap.CalcExtents();
        var mapPath = Path.Combine(output, mapName + ".ymap");
        var mapBytes = ymap.Save();
        await File.WriteAllBytesAsync(mapPath, mapBytes);

        /* Дальние плашки: карта-родитель уровнем LOD. */
        var maps = new List<string> { mapName };
        string? lodMapPath = null;
        byte[]? lodMapBytes = null;
        if (farPlates.Length > 0)
        {
            var farEntities = new List<YmapEntityDef>();
            foreach (var plate in farPlates)
            {
                var far = plate.Far!;
                var definition = new CEntityDef
                {
                    archetypeName = new MetaHash(JenkHash.GenHash(FarArchetypeOf(plate))),
                    flags = EntityFlags,
                    guid = JenkHash.GenHash(lodMapName + "/" + plate.Name),
                    position = new Vector3(far.Position![0], far.Position[1], far.Position[2]),
                    rotation = new Vector4(plate.Rotation![0], plate.Rotation[1], plate.Rotation[2], plate.Rotation[3]),
                    scaleXY = 1f,
                    scaleZ = 1f,
                    parentIndex = -1,
                    lodDist = far.LodDist,
                    childLodDist = plate.LodDist,
                    lodLevel = rage__eLodType.LODTYPES_DEPTH_LOD,
                    numChildren = 1,
                    priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
                    ambientOcclusionMultiplier = 255,
                    artificialAmbientOcclusion = 255,
                    tintValue = 0,
                };
                var entity = new YmapEntityDef(null, farEntities.Count, ref definition);
                entity.SetArchetype(byName[FarArchetypeOf(plate)]);
                farEntities.Add(entity);
            }
            var lodMap = new YmapFile
            {
                Name = lodMapName + ".ymap",
                CMapData = new CMapData
                {
                    name = new MetaHash(JenkHash.GenHash(lodMapName)),
                    parent = new MetaHash(0),
                },
                AllEntities = farEntities.ToArray(),
                BlockExportedBy = ExportedBy,
                BlockTime = ExportTime,
            };
            lodMap.CalcFlags();
            lodMap.CalcExtents();
            lodMapPath = Path.Combine(output, lodMapName + ".ymap");
            lodMapBytes = lodMap.Save();
            await File.WriteAllBytesAsync(lodMapPath, lodMapBytes);
            maps.Add(lodMapName);
        }

        var manifestPath = Path.Combine(output, "_manifest.ymf");
        var manifestBytes = BuildManifest(typesName, maps);
        await File.WriteAllBytesAsync(manifestPath, manifestBytes);

        described.Add(ReopenTypes(typesPath, typesBytes, plates.Concat(ownFar).ToArray()));
        described.Add(ReopenMap(mapPath, mapBytes, plates, farPlates, lodMapName));
        if (lodMapPath is not null) described.Add(ReopenLodMap(lodMapPath, lodMapBytes!, farPlates));
        described.Add(ReopenManifest(manifestPath, manifestBytes, typesName, maps));
        return new
        {
            format = "astral.emblem-plates",
            version = 1,
            files = described,
        };
    }

    /* ------------------------------------------------------------------ */

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name))
            throw new InvalidDataException($"Emblem plate {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    private static bool Finite(float value) => float.IsFinite(value);

    private static IReadOnlyList<Plate> ValidatePlates(Plate[]? list, string typesName, string mapName, string lodMapName)
    {
        if (list is null || list.Length is 0 or > MaxPlates)
            throw new InvalidDataException($"Emblem plates request must list 1…{MaxPlates} plates.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var plate in list)
        {
            if (plate is null) throw new InvalidDataException("Emblem plate is empty.");
            var name = ValidName(plate.Name, "plate");
            if (name == typesName || name == mapName || name == lodMapName)
                throw new InvalidDataException($"Emblem plate {name} collides with the types or map name.");
            if (!names.Add(name)) throw new InvalidDataException($"Emblem plate {name} is listed twice.");
            if (plate.Size is not { Length: 2 } || !plate.Size.All(Finite) || plate.Size.Any(value => value < MinSize || value > MaxSize))
                throw new InvalidDataException($"Emblem plate {name} size must be {MinSize}…{MaxSize} m.");
            if (plate.Position is not { Length: 3 } || !plate.Position.All(Finite) || plate.Position.Any(value => Math.Abs(value) > MaxCoordinate))
                throw new InvalidDataException($"Emblem plate {name} position is out of the map.");
            if (plate.Rotation is not { Length: 4 } || !plate.Rotation.All(Finite))
                throw new InvalidDataException($"Emblem plate {name} rotation must be a quaternion.");
            var length = Math.Sqrt(plate.Rotation.Sum(value => (double)value * value));
            if (Math.Abs(length - 1) > 1e-3)
                throw new InvalidDataException($"Emblem plate {name} rotation must be a unit quaternion.");
            if (!Finite(plate.LodDist) || plate.LodDist < MinLodDistance || plate.LodDist > MaxLodDistance)
                throw new InvalidDataException($"Emblem plate {name} draw distance is out of range.");
            if (!IsPowerOfTwo(plate.Width) || !IsPowerOfTwo(plate.Height) || plate.Width > 2048 || plate.Height > 2048 ||
                plate.Width < 4 || plate.Height < 4)
                throw new InvalidDataException($"Emblem plate {name} texture must be a power of two, 4…2048 px.");
            if (plate.Far is { } far)
            {
                if (far.Position is not { Length: 3 } || !far.Position.All(Finite) || far.Position.Any(value => Math.Abs(value) > MaxCoordinate))
                    throw new InvalidDataException($"Emblem plate {name} far position is out of the map.");
                var offset = Math.Sqrt(far.Position.Select((value, axis) => (double)(value - plate.Position[axis]) * (value - plate.Position[axis])).Sum());
                if (offset > MaxFarOffset)
                    throw new InvalidDataException($"Emblem plate {name} far copy is more than {MaxFarOffset} m away.");
                var farLimit = far.Texture is null ? MaxFarLodDistance : MaxOwnFarLodDistance;
                if (!Finite(far.LodDist) || far.LodDist <= plate.LodDist || far.LodDist > farLimit)
                    throw new InvalidDataException($"Emblem plate {name} far draw distance is out of range.");
                if (far.Texture is not null)
                {
                    var farName = ValidName(name + FarSuffix, "far plate");
                    if (farName == typesName || farName == mapName || farName == lodMapName)
                        throw new InvalidDataException($"Emblem plate {farName} collides with the types or map name.");
                    if (!names.Add(farName)) throw new InvalidDataException($"Emblem plate {farName} is listed twice.");
                    if (!IsPowerOfTwo(far.Width) || !IsPowerOfTwo(far.Height) || far.Width > 2048 || far.Height > 2048 ||
                        far.Width < 4 || far.Height < 4)
                        throw new InvalidDataException($"Emblem plate {name} far texture must be a power of two, 4…2048 px.");
                }
            }
        }
        return list;
    }

    private static bool IsPowerOfTwo(int value) => value > 0 && (value & (value - 1)) == 0;

    /* Модель и архетип плашки видны, пока видна хоть одна её сущность; у
       дальней со своей картинкой своя модель, и HD нужна только её дальность. */
    private static float DrawDistance(Plate plate) =>
        plate.Far is { Texture: null } far ? Math.Max(plate.LodDist, far.LodDist) : plate.LodDist;

    /* Архетип дальней сущности: своя модель `<имя>_far` или та же плашка. */
    private static string FarArchetypeOf(Plate plate) => plate.Far?.Texture is not null ? plate.Name + FarSuffix : plate.Name;

    /* Дальняя со своей картинкой — та же плашка (размер, разворот) своей моделью. */
    private static Plate FarModel(Plate plate)
    {
        var far = plate.Far!;
        return plate with
        {
            Name = plate.Name + FarSuffix,
            Texture = far.Texture,
            TextureSha256 = far.TextureSha256,
            Width = far.Width,
            Height = far.Height,
            LodDist = far.LodDist,
            Far = null,
        };
    }

    private static int FullMipLevels(int width, int height) => (int)Math.Log2(Math.Max(width, height)) + 1;

    private static string TextureName(string plate) => plate + "_img";

    private sealed record Texture(byte[] Bytes, int Width, int Height, int Levels, string Sha256);

    private static async Task<Texture> ReadTextureAsync(Plate plate)
    {
        var file = Path.GetFullPath(plate.Texture ?? "");
        if (!File.Exists(file)) throw new FileNotFoundException($"Texture for {plate.Name} was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"Texture for {plate.Name} has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        var levels = BitConverter.ToInt32(bytes, 28);
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " ||
            BitConverter.ToInt32(bytes, 12) != plate.Height ||
            BitConverter.ToInt32(bytes, 16) != plate.Width ||
            levels != FullMipLevels(plate.Width, plate.Height) ||
            Encoding.ASCII.GetString(bytes, 84, 4) != "DXT5")
            throw new InvalidDataException($"Texture for {plate.Name} is not {plate.Width}x{plate.Height} DXT5 with a full mip chain.");
        if (bytes.Length != 128 + Dxt5Bytes(plate.Width, plate.Height, levels))
            throw new InvalidDataException($"Texture for {plate.Name} is truncated or padded.");
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (plate.TextureSha256 != "sha256:" + digest)
            throw new InvalidDataException($"Texture SHA-256 mismatch for {plate.Name}.");
        return new Texture(bytes, plate.Width, plate.Height, levels, digest);
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

    /* Флаги размеров встроенной текстуры — как у крашеных плашек залазов. */
    private static string UsageFlags(int width, int height)
    {
        var side = Math.Max(width, height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        flags.Add("UNK24");
        return string.Join(", ", flags);
    }

    private static (Vector3 Min, Vector3 Max) PlateBounds(Plate plate)
    {
        var halfWidth = plate.Size![0] / 2f;
        var halfHeight = plate.Size[1] / 2f;
        return (new Vector3(-halfWidth, -PlateThickness, -halfHeight), new Vector3(halfWidth, PlateThickness, halfHeight));
    }

    private static string BuildYdrXml(Plate plate, Texture texture)
    {
        var (min, max) = PlateBounds(plate);
        var centre = (min + max) * 0.5f;
        var radius = Vector3.Distance(centre, max);
        var name = TextureName(plate.Name);
        var lod = F(DrawDistance(plate));
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Drawable>\n")
            .Append(" <Name>").Append(plate.Name).Append("</Name>\n")
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
            .Append("   </Item>\n  </TextureDictionary>\n  <Shaders>\n   <Item>\n")
            .Append("    <Name>default</Name>\n    <FileName>alpha.sps</FileName>\n")
            .Append("    <RenderBucket value=\"").Append(RenderBucket).Append("\" />\n")
            .Append("    <Parameters>\n")
            .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(name).Append("</Name></Item>\n")
            .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
            .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
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
         * Лицевая грань смотрит в −Y (зритель стоит перед стеной), обход —
         * против часовой, если смотреть на неё; задняя — в +Y, обход обратный.
         * u растёт по +X (вправо для зрителя), v — вниз, как строки картинки.
         */
        var halfWidth = plate.Size![0] / 2f;
        var halfHeight = plate.Size[1] / 2f;
        var corners = new (float X, float Z, float U, float V)[]
        {
            (-halfWidth, -halfHeight, 0f, 1f),
            (halfWidth, -halfHeight, 1f, 1f),
            (halfWidth, halfHeight, 1f, 0f),
            (-halfWidth, halfHeight, 0f, 0f),
        };
        foreach (var normal in new[] { -1f, 1f })
            foreach (var corner in corners)
                xml.Append("       ").Append(F(corner.X)).Append(" 0 ").Append(F(corner.Z))
                    .Append("   0 ").Append(F(normal)).Append(" 0")
                    .Append("   255 255 255 255   ").Append(F(corner.U)).Append(' ').Append(F(corner.V)).Append('\n');
        xml.Append("      </Data>\n     </VertexBuffer>\n     <IndexBuffer><Data>0 1 2 0 2 3 4 6 5 4 7 6</Data></IndexBuffer>\n    </Item>\n")
            .Append("   </Geometries>\n  </Item>\n </DrawableModelsHigh>\n</Drawable>\n");
        return xml.ToString();
    }

    private static object ReopenDrawable(string path, byte[] bytes, Plate plate, Texture texture)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var drawable = ydr.Drawable;
        var shaders = drawable?.ShaderGroup?.Shaders?.data_items;
        var textures = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items;
        var geometries = drawable?.DrawableModels?.High?.SelectMany(model => model.Geometries ?? []).ToArray() ?? [];
        if (!ydr.Loaded || drawable is null || shaders is not { Length: 1 } ||
            shaders[0].Name.Hash != JenkHash.GenHash("default") ||
            shaders[0].FileName.Hash != JenkHash.GenHash("alpha.sps") ||
            shaders[0].RenderBucket != RenderBucket ||
            drawable.FlagsHigh != BucketMask ||
            textures is not { Length: 1 } ||
            textures[0].Width != texture.Width || textures[0].Height != texture.Height ||
            textures[0].Levels != texture.Levels ||
            geometries.Length != 1 ||
            geometries[0].VerticesCount != 8 || geometries[0].IndicesCount != 12 ||
            geometries[0].VertexBuffer?.Info?.Flags != 89 || geometries[0].VertexStride != 36)
            throw new InvalidDataException($"Compiled emblem plate {plate.Name} failed semantic reopen.");
        return Describe(path, bytes, new
        {
            semanticReopen = true,
            plate = plate.Name,
            size = plate.Size,
            texture = new { width = texture.Width, height = texture.Height, mipLevels = texture.Levels, sha256 = texture.Sha256 },
        });
    }

    private static object ReopenTypes(string path, byte[] bytes, IReadOnlyList<Plate> plates)
    {
        var reopened = new YtypFile { Name = Path.GetFileName(path) };
        reopened.Load(bytes);
        var archetypes = reopened.AllArchetypes ?? [];
        if (!reopened.Loaded || archetypes.Length != plates.Count)
            throw new InvalidDataException("Compiled emblem plate types failed semantic reopen.");
        foreach (var plate in plates)
        {
            var hash = JenkHash.GenHash(plate.Name);
            var matches = archetypes.Where(archetype => archetype._BaseArchetypeDef.name.Hash == hash).ToArray();
            if (matches.Length != 1 ||
                matches[0]._BaseArchetypeDef.assetName.Hash != hash ||
                matches[0]._BaseArchetypeDef.assetType != rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE)
                throw new InvalidDataException($"Compiled emblem plate archetype {plate.Name} failed semantic reopen.");
        }
        return Describe(path, bytes, new { semanticReopen = true, archetypes = archetypes.Length });
    }

    private static object ReopenMap(string path, byte[] bytes, IReadOnlyList<Plate> plates, IReadOnlyList<Plate> farPlates, string lodMapName)
    {
        var reopened = new YmapFile { Name = Path.GetFileName(path) };
        reopened.Load(bytes);
        var entities = reopened.AllEntities ?? [];
        if (!reopened.Loaded || entities.Length != plates.Count)
            throw new InvalidDataException("Compiled emblem plate map failed semantic reopen.");
        var parentHash = farPlates.Count > 0 ? JenkHash.GenHash(lodMapName) : 0u;
        if (reopened.CMapData.parent.Hash != parentHash)
            throw new InvalidDataException("Compiled emblem plate map has a wrong parent map.");
        foreach (var entity in entities)
        {
            var index = farPlates.ToList().FindIndex(plate => JenkHash.GenHash(plate.Name) == entity._CEntityDef.archetypeName.Hash);
            var expectedLevel = index >= 0 ? rage__eLodType.LODTYPES_DEPTH_HD : rage__eLodType.LODTYPES_DEPTH_ORPHANHD;
            if (entity._CEntityDef.parentIndex != index || entity._CEntityDef.lodLevel != expectedLevel ||
                ((entity._CEntityDef.flags & LodInParentFlag) != 0) != (index >= 0))
                throw new InvalidDataException("Compiled emblem plate map has a wrong far parent.");
        }
        foreach (var plate in plates)
        {
            var hash = JenkHash.GenHash(plate.Name);
            var entity = entities.SingleOrDefault(item => item._CEntityDef.archetypeName.Hash == hash)
                ?? throw new InvalidDataException($"Compiled emblem plate map does not place {plate.Name}.");
            var position = entity._CEntityDef.position;
            var rotation = entity._CEntityDef.rotation;
            if (Vector3.Distance(position, new Vector3(plate.Position![0], plate.Position[1], plate.Position[2])) > 1e-3f ||
                Math.Abs(rotation.W - plate.Rotation![3]) > 1e-4f || Math.Abs(rotation.Z - plate.Rotation[2]) > 1e-4f)
                throw new InvalidDataException($"Compiled emblem plate map moved {plate.Name}.");
        }
        return Describe(path, bytes, new { semanticReopen = true, entities = entities.Length });
    }

    private static byte[] BuildManifest(string typesName, IReadOnlyList<string> mapNames)
    {
        var items = new StringBuilder();
        foreach (var mapName in mapNames)
            items.Append("  <Item>\n")
                .Append("   <imapName>").Append(mapName).Append("</imapName>\n")
                .Append("   <manifestFlags />\n")
                .Append("   <itypDepArray>\n")
                .Append("    <Item>").Append(typesName).Append("</Item>\n")
                .Append("   </itypDepArray>\n")
                .Append("  </Item>\n");
        var xml = new XmlDocument();
        xml.LoadXml(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<CPackFileMetaData>\n" +
            " <MapDataGroups />\n" +
            " <HDTxdBindingArray />\n" +
            " <imapDependencies />\n" +
            " <imapDependencies_2>\n" +
            items +
            " </imapDependencies_2>\n" +
            " <itypDependencies_2 />\n" +
            " <Interiors />\n" +
            "</CPackFileMetaData>\n");
        var pso = XmlPso.GetPso(xml) ?? throw new InvalidDataException("Emblem plate manifest PSO was not built.");
        return pso.Save();
    }

    private static object ReopenManifest(string path, byte[] bytes, string typesName, IReadOnlyList<string> mapNames)
    {
        var manifest = new YmfFile();
        manifest.Load(bytes, new RpfBinaryFileEntry());
        var dependencies = manifest.imapDependencies2 ?? [];
        if (manifest.Pso is null || dependencies.Length != mapNames.Count)
            throw new InvalidDataException("Compiled emblem plate _manifest.ymf failed semantic reopen.");
        for (var index = 0; index < mapNames.Count; index++)
        {
            var dependency = dependencies[index];
            if (dependency?.Dep.imapName.Hash != JenkHash.GenHash(mapNames[index]) ||
                dependency.itypDepArray?.Length != 1 ||
                dependency.itypDepArray[0].Hash != JenkHash.GenHash(typesName))
                throw new InvalidDataException("Compiled emblem plate _manifest.ymf failed semantic reopen.");
        }
        return Describe(path, bytes, new { semanticReopen = true, imapDependencies = mapNames.Count });
    }

    /* Карта дальних плашек: уровень LOD, по ребёнку у каждой, место — своё. */
    private static object ReopenLodMap(string path, byte[] bytes, IReadOnlyList<Plate> farPlates)
    {
        var reopened = new YmapFile { Name = Path.GetFileName(path) };
        reopened.Load(bytes);
        var entities = reopened.AllEntities ?? [];
        if (!reopened.Loaded || entities.Length != farPlates.Count)
            throw new InvalidDataException("Compiled emblem plate far map failed semantic reopen.");
        for (var index = 0; index < farPlates.Count; index++)
        {
            var plate = farPlates[index];
            var entity = entities[index]._CEntityDef;
            var far = plate.Far!;
            if (entity.archetypeName.Hash != JenkHash.GenHash(FarArchetypeOf(plate)) ||
                entity.lodLevel != rage__eLodType.LODTYPES_DEPTH_LOD || entity.numChildren != 1 ||
                Math.Abs(entity.childLodDist - plate.LodDist) > 1e-3f || Math.Abs(entity.lodDist - far.LodDist) > 1e-3f ||
                Vector3.Distance(entity.position, new Vector3(far.Position![0], far.Position[1], far.Position[2])) > 1e-3f)
                throw new InvalidDataException($"Compiled emblem plate far map moved {plate.Name}.");
        }
        return Describe(path, bytes, new { semanticReopen = true, entities = entities.Length, far = true });
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
        string? TypesName = null,
        string? MapName = null,
        Plate[]? Plates = null);

    private sealed record Plate(
        string Name,
        string? Texture,
        string? TextureSha256,
        int Width,
        int Height,
        float[]? Size,
        float[]? Position,
        float[]? Rotation,
        float LodDist,
        FarPlate? Far = null);

    /* Дальняя плашка: своё место (чуть впереди дальних моделей) и дальность;
       `texture` — своя картинка дальней (тогда и своя модель `<имя>_far`). */
    private sealed record FarPlate(
        float[]? Position,
        float LodDist,
        string? Texture = null,
        string? TextureSha256 = null,
        int Width = 0,
        int Height = 0);
}
