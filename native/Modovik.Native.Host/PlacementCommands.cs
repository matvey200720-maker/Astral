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
/// Расстановка своих моделей в мире: архетипы (`.ytyp`), сущности (`.ymap`)
/// и манифест контейнера — для моделей, которые собрала другая команда
/// (`compile-sign-models`). Нужна, когда у мода много моделей и у каждой своя
/// точка и дальность: МСЛ-зоны (ТЗ 08.10.2026, задача 3) режут линии района
/// на плитки, и дальность у игры считается от центра плитки.
///
/// Архетип: рамка — из запроса (окно знает сетку), дальность, словарь
/// текстур — сама модель (текстуры зашиты). Сущность: ORPHANHD, без
/// родителя, `PRI_REQUIRED`, своя дальность; рамки карты (`streamingExtents`)
/// — рамки сущностей с их дальностью (`CalcExtents`), иначе карта не
/// подгружается раньше, чем человек подойдёт на дальность.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class PlacementCommands
{
    private const string RequestFormat = "astral.compile-placements";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 1024 * 1024;
    private const int MaxArchetypes = 2000;
    private const int MaxEntities = 4000;
    private const float MinLodDistance = 1f;
    private const float MaxLodDistance = 20000f;
    private const float MaxWorld = 20000f;
    private const string ExportedBy = "Astral Placements 1";
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
            throw new InvalidDataException("Placements request must be between 1 byte and 1 MiB.");
        var request = JsonSerializer.Deserialize<PlacementRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Placements request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Placements request has an unknown format.");
        var typesName = ValidName(request.Types, "types");
        var mapName = ValidName(request.Map, "map");
        var archetypes = request.Archetypes ?? [];
        var entities = request.Entities ?? [];
        if (archetypes.Length is 0 or > MaxArchetypes) throw new InvalidDataException($"Placements need 1…{MaxArchetypes} archetypes.");
        if (entities.Length is 0 or > MaxEntities) throw new InvalidDataException($"Placements need 1…{MaxEntities} entities.");

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Placements output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Placements output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Placements output directory must be empty.");

        var ytyp = new YtypFile
        {
            Name = typesName + ".ytyp",
            NameHash = JenkHash.GenHash(typesName),
            CMapTypes = new CMapTypes(),
        };
        var byName = new Dictionary<string, Archetype>(StringComparer.Ordinal);
        var list = new List<Archetype>();
        foreach (var item in archetypes)
        {
            if (item is null) throw new InvalidDataException("A placement archetype is empty.");
            var name = ValidName(item.Name, "archetype");
            if (byName.ContainsKey(name)) throw new InvalidDataException($"Archetype {name} is listed twice.");
            var min = Vector(item.BbMin, $"{name} bbMin", MaxWorld);
            var max = Vector(item.BbMax, $"{name} bbMax", MaxWorld);
            if (min.X > max.X || min.Y > max.Y || min.Z > max.Z) throw new InvalidDataException($"Archetype {name} has an inverted box.");
            var lod = Lod(item.LodDist, name);
            var centre = (min + max) * 0.5f;
            var asset = new MetaHash(JenkHash.GenHash(name));
            var definition = new CBaseArchetypeDef
            {
                lodDist = lod,
                flags = item.Flags,
                specialAttribute = 0,
                bbMin = min,
                bbMax = max,
                bsCentre = centre,
                bsRadius = Vector3.Distance(centre, max),
                hdTextureDist = Math.Min(lod, 100f),
                name = asset,
                textureDictionary = asset,
                /* Анимированная модель (летающее лого): словарь клипов и флаги
                   анимированного архетипа 0x80200 — как у штатных. */
                clipDictionary = new MetaHash(item.ClipDictionary is null ? 0 : JenkHash.GenHash(ValidName(item.ClipDictionary, "clip dictionary"))),
                assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
                assetName = asset,
            };
            var archetype = new Archetype();
            archetype.Init(ytyp, ref definition);
            list.Add(archetype);
            byName[name] = archetype;
        }
        ytyp.AllArchetypes = list.ToArray();
        var typesPath = Path.Combine(output, typesName + ".ytyp");
        var typesBytes = ytyp.Save();
        await File.WriteAllBytesAsync(typesPath, typesBytes);

        var placed = new List<YmapEntityDef>();
        foreach (var item in entities)
        {
            if (item is null) throw new InvalidDataException("A placement entity is empty.");
            var name = ValidName(item.Archetype, "entity archetype");
            if (!byName.TryGetValue(name, out var archetype)) throw new InvalidDataException($"Entity uses unknown archetype {name}.");
            var position = Vector(item.Position, $"{name} position", MaxWorld);
            var rotation = item.Rotation is { Length: 4 } r && r.All(float.IsFinite)
                ? new Vector4(r[0], r[1], r[2], r[3])
                : item.Rotation is null ? new Vector4(0, 0, 0, 1) : throw new InvalidDataException($"{name}: rotation must be a quaternion.");
            var definition = new CEntityDef
            {
                archetypeName = new MetaHash(JenkHash.GenHash(name)),
                flags = item.Flags,
                guid = JenkHash.GenHash(mapName + "/" + name + "/" + placed.Count.ToString(System.Globalization.CultureInfo.InvariantCulture)),
                position = position,
                rotation = rotation,
                scaleXY = 1f,
                scaleZ = 1f,
                parentIndex = -1,
                lodDist = Lod(item.LodDist, name),
                childLodDist = 0f,
                lodLevel = rage__eLodType.LODTYPES_DEPTH_ORPHANHD,
                numChildren = 0,
                priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
                ambientOcclusionMultiplier = 255,
                artificialAmbientOcclusion = 255,
                tintValue = 0,
            };
            var entity = new YmapEntityDef(null, placed.Count, ref definition);
            entity.SetArchetype(archetype);
            placed.Add(entity);
        }
        var ymap = new YmapFile
        {
            Name = mapName + ".ymap",
            CMapData = new CMapData
            {
                name = new MetaHash(JenkHash.GenHash(mapName)),
                parent = new MetaHash(0),
            },
            AllEntities = placed.ToArray(),
            BlockExportedBy = ExportedBy,
            BlockTime = ExportTime,
        };
        ymap.CalcFlags();
        ymap.CalcExtents();
        var mapPath = Path.Combine(output, mapName + ".ymap");
        var mapBytes = ymap.Save();
        await File.WriteAllBytesAsync(mapPath, mapBytes);

        var described = new List<object>
        {
            ReopenTypes(typesPath, typesBytes, archetypes.Length),
            ReopenMap(mapPath, mapBytes, entities),
        };
        if (request.Manifest)
        {
            var manifestPath = Path.Combine(output, "_manifest.ymf");
            var manifestBytes = BuildManifest(typesName, mapName);
            await File.WriteAllBytesAsync(manifestPath, manifestBytes);
            var manifest = new YmfFile();
            manifest.Load(manifestBytes, new RpfBinaryFileEntry());
            var dependency = manifest.imapDependencies2?.FirstOrDefault();
            if (manifest.Pso is null || dependency?.Dep.imapName.Hash != JenkHash.GenHash(mapName) || dependency.itypDepArray?[0].Hash != JenkHash.GenHash(typesName))
                throw new InvalidDataException("Compiled placements _manifest.ymf failed semantic reopen.");
            described.Add(Describe(manifestPath, manifestBytes, new { semanticReopen = true, imapDependencies = 1 }));
        }
        return new { format = "astral.placements", version = 1, exportedBy = ExportedBy, files = described };
    }

    private static object ReopenTypes(string path, byte[] bytes, int count)
    {
        var reopened = new YtypFile();
        reopened.Load(bytes);
        if ((reopened.AllArchetypes?.Length ?? 0) != count)
            throw new InvalidDataException("Compiled placements .ytyp failed semantic reopen.");
        return Describe(path, bytes, new { semanticReopen = true, archetypes = count });
    }

    private static object ReopenMap(string path, byte[] bytes, EntityRequest[] entities)
    {
        var reopened = new YmapFile();
        reopened.Load(bytes);
        var all = reopened.AllEntities ?? [];
        if (all.Length != entities.Length) throw new InvalidDataException("Compiled placements .ymap failed semantic reopen.");
        for (var index = 0; index < all.Length; index++)
        {
            var expected = entities[index];
            var got = all[index].CEntityDef;
            if (got.archetypeName.Hash != JenkHash.GenHash(expected.Archetype!) || Math.Abs(got.lodDist - expected.LodDist) > 0.01f ||
                Math.Abs(got.position.X - expected.Position![0]) > 0.01f || Math.Abs(got.position.Y - expected.Position[1]) > 0.01f)
                throw new InvalidDataException("Compiled placements .ymap moved an entity.");
        }
        return Describe(path, bytes, new { semanticReopen = true, entities = all.Length });
    }

    private static byte[] BuildManifest(string typesName, string mapName)
    {
        var xml = new XmlDocument();
        xml.LoadXml(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CPackFileMetaData>\n <MapDataGroups />\n <HDTxdBindingArray />\n <imapDependencies />\n" +
            " <imapDependencies_2>\n  <Item>\n   <imapName>" + mapName + "</imapName>\n   <manifestFlags />\n   <itypDepArray>\n    <Item>" + typesName +
            "</Item>\n   </itypDepArray>\n  </Item>\n </imapDependencies_2>\n <itypDependencies_2 />\n <Interiors />\n</CPackFileMetaData>\n");
        var pso = XmlPso.GetPso(xml) ?? throw new InvalidDataException("Placements manifest PSO was not built.");
        return pso.Save();
    }

    private static float Lod(float value, string name)
    {
        if (!float.IsFinite(value) || value < MinLodDistance || value > MaxLodDistance)
            throw new InvalidDataException($"{name}: lodDist must be {MinLodDistance}…{MaxLodDistance}.");
        return value;
    }

    private static Vector3 Vector(float[]? value, string label, float limit)
    {
        if (value is not { Length: 3 } || value.Any(item => !float.IsFinite(item) || Math.Abs(item) > limit))
            throw new InvalidDataException($"{label} must be three finite numbers.");
        return new Vector3(value[0], value[1], value[2]);
    }

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name)) throw new InvalidDataException($"Placements {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private sealed record PlacementRequest(
        string Format,
        int Version,
        string? Types = null,
        string? Map = null,
        bool Manifest = true,
        ArchetypeRequest[]? Archetypes = null,
        EntityRequest[]? Entities = null);

    private sealed record ArchetypeRequest(string? Name = null, float LodDist = 100f, float[]? BbMin = null, float[]? BbMax = null, uint Flags = 0, string? ClipDictionary = null);

    private sealed record EntityRequest(string? Archetype = null, float[]? Position = null, float[]? Rotation = null, float LodDist = 100f, uint Flags = 32);
}
