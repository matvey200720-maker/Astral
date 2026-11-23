using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Прострелы — основа своего набора из архива мода.
///
/// Мод подсветки простреливаемых укрытий приходит одним архивом вместе с
/// залазами: пять моделей `panika1z … panika5z`, шестнадцать оболочек
/// `progmat_1 … progmat_16`, общие типы `panikamods.ytyp`, общая расстановка
/// `panikamodszalaz.ymap` (620 мест, из них 48 — укрытия) и один
/// `_manifest.ymf`. Поставить такой архив целиком — значит поставить и
/// залазы, которые у Astral настраиваются своим редактором и едут своим
/// пакетом в `astral_maps.rpf`.
///
/// Поэтому здесь из архива выделяются только укрытия, под своими именами и в
/// своём наборе:
///   • типы `astral_wallbang.ytyp` — по архетипу на оболочку, с границами,
///     снятыми с самой модели: у `progmat_1` в типах мода рамка на 11 м уже
///     модели, и край подсветки пропадал бы у края экрана раньше времени; у
///     `progmat_6` и `progmat_7` в типах мода по два архетипа, первый — с
///     нулевой рамкой;
///   • расстановка `astral_wallbang_map.ymap` — места укрытий из расстановки
///     мода байт в байт (положение, разворот, масштаб, флаги, дальность), с
///     новыми именами архетипов;
///   • `_manifest.ymf`, который связывает расстановку с типами.
/// Модели команда не собирает: они едут файлами мода под новыми именами, а
/// цвет и прозрачность подсветки правятся в них на месте (JS, `@modovik/ypt`).
///
/// Своё пространство имён (`astral_wallbang_*`) — чтобы набор Astral не делил
/// архетипы с исходным модом, если тот стоит у человека в редуксе: одноимённые
/// архетипы двух источников игра разрешает по порядку загрузки, и цвет из
/// редактора мог бы просто не доехать.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class WallbangCommands
{
    private const string RequestFormat = "astral.build-wallbang-base";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 64 * 1024;
    private const int MaxMetaBytes = 4 * 1024 * 1024;
    private const int MaxModelBytes = 16 * 1024 * 1024;
    private const int MaxObjects = 64;
    private const float MinLodDistance = 10f;
    private const float MaxLodDistance = 2000f;
    private const string ExportedBy = "Astral Wallbang Base 1";
    private const string ExportTime = "01 January 1970 00:00";

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> BuildBaseAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Wallbang base request must be between 1 byte and 64 KiB.");
        var request = JsonSerializer.Deserialize<BuildRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Wallbang base request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Wallbang base request has an unknown format.");
        var typesName = ValidName(request.TypesName, "types");
        var mapName = ValidName(request.MapName, "map");
        if (typesName == mapName)
            throw new InvalidDataException("Wallbang types and map need different names.");
        if (!float.IsFinite(request.LodDistance) ||
            request.LodDistance < MinLodDistance || request.LodDistance > MaxLodDistance)
            throw new InvalidDataException("Wallbang archetype draw distance is out of range.");
        var objects = ValidateObjects(request.Objects, typesName, mapName);

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Wallbang base output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Wallbang base output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Wallbang base output directory must be empty.");

        var sourceTypes = new YtypFile { Name = "source.ytyp" };
        sourceTypes.Load(await ReadBoundedAsync(request.Types, ".ytyp", MaxMetaBytes, "types"));
        var sourceMap = new YmapFile { Name = "source.ymap" };
        sourceMap.Load(await ReadBoundedAsync(request.Map, ".ymap", MaxMetaBytes, "map"));
        if (!sourceTypes.Loaded || !sourceMap.Loaded)
            throw new InvalidDataException("Wallbang source types or map did not load.");

        /* Модели — ради границ: рамка архетипа обязана накрывать модель
           целиком, иначе игра отсечёт её раньше, чем край уйдёт с экрана. */
        var bounds = new Dictionary<string, Bounds>(StringComparer.Ordinal);
        foreach (var item in objects)
            bounds[item.Asset] = await ModelBoundsAsync(item);

        var ytyp = new YtypFile
        {
            Name = typesName + ".ytyp",
            NameHash = JenkHash.GenHash(typesName),
            CMapTypes = new CMapTypes(),
        };
        var archetypes = new List<Archetype>();
        var bySource = new Dictionary<uint, (SourceObject Item, Archetype Archetype)>();
        foreach (var item in objects)
        {
            var original = SourceArchetype(sourceTypes, item.Source);
            var box = bounds[item.Asset];
            var asset = new MetaHash(JenkHash.GenHash(item.Asset));
            var definition = new CBaseArchetypeDef
            {
                lodDist = request.LodDistance,
                flags = original.flags,
                specialAttribute = original.specialAttribute,
                bbMin = box.Min,
                bbMax = box.Max,
                bsCentre = box.Centre,
                bsRadius = box.Radius,
                hdTextureDist = original.hdTextureDist,
                name = asset,
                /* Своего словаря текстур у оболочки нет — текстура зашита в
                   модель. Имя словаря — как у мода: имя самой модели. */
                textureDictionary = asset,
                assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
                assetName = asset,
            };
            var archetype = new Archetype();
            archetype.Init(ytyp, ref definition);
            archetypes.Add(archetype);
            bySource[JenkHash.GenHash(item.Source)] = (item, archetype);
        }
        ytyp.AllArchetypes = archetypes.ToArray();

        /* Места укрытий — из расстановки мода, как они там записаны. Разворот
           не пересчитывается: `_CEntityDef` едет тем же вектором, иначе
           CodeWalker записал бы его через свою обратную величину. */
        var entities = new List<YmapEntityDef>();
        var placements = new List<object>();
        var counts = objects.ToDictionary(item => item.Asset, _ => 0, StringComparer.Ordinal);
        foreach (var entity in sourceMap.AllEntities ?? [])
        {
            var definition = entity._CEntityDef;
            if (!bySource.TryGetValue(definition.archetypeName.Hash, out var target)) continue;
            definition.archetypeName = new MetaHash(JenkHash.GenHash(target.Item.Asset));
            var copy = new YmapEntityDef(null, entities.Count, ref definition);
            copy.SetArchetype(target.Archetype);
            entities.Add(copy);
            counts[target.Item.Asset] += 1;
            placements.Add(new
            {
                asset = target.Item.Asset,
                source = target.Item.Source,
                position = new[] { definition.position.X, definition.position.Y, definition.position.Z },
                rotation = new[] { definition.rotation.X, definition.rotation.Y, definition.rotation.Z, definition.rotation.W },
                scaleXY = definition.scaleXY,
                scaleZ = definition.scaleZ,
                lodDist = definition.lodDist,
                flags = definition.flags,
            });
        }
        var empty = counts.Where(pair => pair.Value == 0).Select(pair => pair.Key).ToArray();
        if (empty.Length > 0)
            throw new InvalidDataException($"Wallbang map places none of: {string.Join(", ", empty)}.");

        var typesPath = Path.Combine(output, typesName + ".ytyp");
        var typesBytes = ytyp.Save();
        await File.WriteAllBytesAsync(typesPath, typesBytes);

        var ymap = new YmapFile
        {
            Name = mapName + ".ymap",
            CMapData = new CMapData
            {
                name = new MetaHash(JenkHash.GenHash(mapName)),
                parent = new MetaHash(0),
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

        var manifestPath = Path.Combine(output, "_manifest.ymf");
        var manifestBytes = BuildManifest(typesName, mapName);
        await File.WriteAllBytesAsync(manifestPath, manifestBytes);

        var files = new[]
        {
            ReopenTypes(typesPath, typesBytes, objects, bounds),
            ReopenMap(mapPath, mapBytes, objects, counts),
            ReopenManifest(manifestPath, manifestBytes, typesName, mapName),
        };
        return new
        {
            format = "astral.wallbang-base",
            version = 1,
            files,
            objects = objects.Select(item => new
            {
                asset = item.Asset,
                source = item.Source,
                places = counts[item.Asset],
                bounds = new
                {
                    min = new[] { bounds[item.Asset].Min.X, bounds[item.Asset].Min.Y, bounds[item.Asset].Min.Z },
                    max = new[] { bounds[item.Asset].Max.X, bounds[item.Asset].Max.Y, bounds[item.Asset].Max.Z },
                },
            }).ToArray(),
            placements,
        };
    }

    /* ------------------------------------------------------------------ */

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name))
            throw new InvalidDataException($"Wallbang {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    private static IReadOnlyList<SourceObject> ValidateObjects(SourceObject[]? list, string typesName, string mapName)
    {
        if (list is null || list.Length is 0 or > MaxObjects)
            throw new InvalidDataException($"Wallbang base request must list 1…{MaxObjects} objects.");
        var assets = new HashSet<string>(StringComparer.Ordinal);
        var sources = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in list)
        {
            if (item is null) throw new InvalidDataException("Wallbang object is empty.");
            var asset = ValidName(item.Asset, "asset");
            ValidName(item.Source, "source");
            if (asset == typesName || asset == mapName)
                throw new InvalidDataException($"Wallbang asset {asset} collides with the types or map name.");
            if (!assets.Add(asset)) throw new InvalidDataException($"Wallbang asset {asset} is listed twice.");
            if (!sources.Add(item.Source)) throw new InvalidDataException($"Wallbang source {item.Source} is listed twice.");
        }
        return list;
    }

    private static async Task<byte[]> ReadBoundedAsync(string? file, string extension, int limit, string label)
    {
        var path = Path.GetFullPath(file ?? "");
        if (!File.Exists(path) || !path.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            throw new FileNotFoundException($"Wallbang {label} file was not found.", path);
        var info = new FileInfo(path);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 16 || info.Length > limit)
            throw new InvalidDataException($"Wallbang {label} file has an unsafe type or size.");
        return await File.ReadAllBytesAsync(path);
    }

    private sealed record Bounds(Vector3 Min, Vector3 Max, Vector3 Centre, float Radius);

    private static async Task<Bounds> ModelBoundsAsync(SourceObject item)
    {
        var bytes = await ReadBoundedAsync(item.Model, ".ydr", MaxModelBytes, $"model {item.Source}");
        var ydr = new YdrFile { Name = item.Source + ".ydr" };
        ydr.Load(bytes);
        var drawable = ydr.Drawable ?? throw new InvalidDataException($"Wallbang model {item.Source} has no drawable.");
        var min = drawable.BoundingBoxMin;
        var max = drawable.BoundingBoxMax;
        if (!Finite(min) || !Finite(max) || min.X > max.X || min.Y > max.Y || min.Z > max.Z)
            throw new InvalidDataException($"Wallbang model {item.Source} has an invalid bounding box.");
        /* Сфера — по рамке, а не по сфере модели: у части оболочек мода сфера
           посчитана экспортом неточно, а рамка всегда охватывает вершины. */
        var centre = (min + max) * 0.5f;
        return new Bounds(min, max, centre, Vector3.Distance(centre, max));
    }

    private static bool Finite(Vector3 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) && float.IsFinite(value.Z);

    /*
     * Архетип оболочки в типах мода. У части имён их два (`progmat_6`,
     * `progmat_7`): первый — с нулевой рамкой, второй — настоящий. Берётся
     * настоящий; флаги и дальность текстур у обоих одинаковые.
     */
    private static CBaseArchetypeDef SourceArchetype(YtypFile types, string source)
    {
        var hash = JenkHash.GenHash(source);
        var matches = (types.AllArchetypes ?? [])
            .Where(item => item._BaseArchetypeDef.name.Hash == hash)
            .Select(item => item._BaseArchetypeDef)
            .ToArray();
        if (matches.Length == 0)
            throw new InvalidDataException($"Wallbang source types hold no archetype {source}.");
        var real = matches.Where(item => item.bsRadius > 0).ToArray();
        return (real.Length > 0 ? real : matches)[^1];
    }

    private static byte[] BuildManifest(string typesName, string mapName)
    {
        var xml = new XmlDocument();
        xml.LoadXml(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<CPackFileMetaData>\n" +
            " <MapDataGroups />\n" +
            " <HDTxdBindingArray />\n" +
            " <imapDependencies />\n" +
            " <imapDependencies_2>\n" +
            "  <Item>\n" +
            "   <imapName>" + mapName + "</imapName>\n" +
            "   <manifestFlags />\n" +
            "   <itypDepArray>\n" +
            "    <Item>" + typesName + "</Item>\n" +
            "   </itypDepArray>\n" +
            "  </Item>\n" +
            " </imapDependencies_2>\n" +
            " <itypDependencies_2 />\n" +
            " <Interiors />\n" +
            "</CPackFileMetaData>\n");
        var pso = XmlPso.GetPso(xml) ?? throw new InvalidDataException("Wallbang manifest PSO was not built.");
        return pso.Save();
    }

    /* ------------------------------------------------------------------ */

    private static object ReopenTypes(string path, byte[] bytes, IReadOnlyList<SourceObject> objects, IReadOnlyDictionary<string, Bounds> bounds)
    {
        var reopened = new YtypFile { Name = Path.GetFileName(path) };
        reopened.Load(bytes);
        var archetypes = reopened.AllArchetypes ?? [];
        if (!reopened.Loaded || archetypes.Length != objects.Count)
            throw new InvalidDataException("Compiled wallbang types failed semantic reopen.");
        foreach (var item in objects)
        {
            var hash = JenkHash.GenHash(item.Asset);
            var matches = archetypes.Where(archetype => archetype._BaseArchetypeDef.name.Hash == hash).ToArray();
            if (matches.Length != 1)
                throw new InvalidDataException($"Compiled wallbang types hold {matches.Length} archetypes {item.Asset}.");
            var definition = matches[0]._BaseArchetypeDef;
            var box = bounds[item.Asset];
            if (definition.assetName.Hash != hash ||
                definition.assetType != rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE ||
                Vector3.Distance(definition.bbMin, box.Min) > 1e-3f ||
                Vector3.Distance(definition.bbMax, box.Max) > 1e-3f)
                throw new InvalidDataException($"Compiled wallbang archetype {item.Asset} failed semantic reopen.");
        }
        return Describe(path, bytes, new { semanticReopen = true, archetypes = archetypes.Length });
    }

    private static object ReopenMap(string path, byte[] bytes, IReadOnlyList<SourceObject> objects, IReadOnlyDictionary<string, int> counts)
    {
        var reopened = new YmapFile { Name = Path.GetFileName(path) };
        reopened.Load(bytes);
        var entities = reopened.AllEntities ?? [];
        if (!reopened.Loaded || entities.Length != counts.Values.Sum())
            throw new InvalidDataException("Compiled wallbang map failed semantic reopen.");
        foreach (var item in objects)
        {
            var hash = JenkHash.GenHash(item.Asset);
            var placed = entities.Count(entity => entity._CEntityDef.archetypeName.Hash == hash);
            if (placed != counts[item.Asset])
                throw new InvalidDataException($"Compiled wallbang map places {placed} of {counts[item.Asset]} {item.Asset}.");
        }
        return Describe(path, bytes, new { semanticReopen = true, entities = entities.Length });
    }

    private static object ReopenManifest(string path, byte[] bytes, string typesName, string mapName)
    {
        var manifest = new YmfFile();
        manifest.Load(bytes, new RpfBinaryFileEntry());
        var dependency = manifest.imapDependencies2?.FirstOrDefault();
        if (manifest.Pso is null || manifest.imapDependencies2?.Length != 1 ||
            dependency?.Dep.imapName.Hash != JenkHash.GenHash(mapName) ||
            dependency.itypDepArray?.Length != 1 ||
            dependency.itypDepArray[0].Hash != JenkHash.GenHash(typesName))
            throw new InvalidDataException("Compiled wallbang _manifest.ymf failed semantic reopen.");
        return Describe(path, bytes, new { semanticReopen = true, imapDependencies = 1 });
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private sealed record BuildRequest(
        string Format,
        int Version,
        string? Types = null,
        string? Map = null,
        string? TypesName = null,
        string? MapName = null,
        float LodDistance = 0,
        SourceObject[]? Objects = null);

    private sealed record SourceObject(string Asset, string Source, string? Model);
}
