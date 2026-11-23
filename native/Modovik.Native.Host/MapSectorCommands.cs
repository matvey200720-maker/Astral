using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Секция карты из файлов игры: пакетный разбор метаданных и сборка бандла.
///
/// Здание торгового центра — это не один drawable, а секция карты: десятки
/// деталей, расставленных ymap-ами, описанных архетипами ytyp, с LOD-деталями
/// в словарях .ydd и текстурами, часть которых лежит в общих словарях
/// (`gtxd`). Поштучные команды (`inspect-interior-ymap`, `convert-model`) для
/// этого не годятся: двести запусков процесса на одну секцию и по копии
/// атласа в каждой детали. Здесь всё то же самое, но одним запуском.
/// </summary>
internal static class MapSectorCommands
{
    private static readonly JsonSerializerOptions RequestJson = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    private const int MaxInputs = 4096;
    private const long MaxInputBytes = 64L * 1024 * 1024;

    /* ---------- inspect-map-files ---------- */

    /* Список файлов приезжает и аргументами, и файлом-списком (JSON-массив
       путей): у секции карты их сотни, а командная строка Windows кончается
       на 32 КБ. */
    public static IReadOnlyList<string> ReadInputList(IEnumerable<string> arguments, string? listFile)
    {
        var inputs = new List<string>(arguments);
        if (!string.IsNullOrWhiteSpace(listFile))
        {
            var file = Path.GetFullPath(listFile);
            if (!File.Exists(file)) throw new FileNotFoundException($"Input list was not found: {listFile}");
            var listed = JsonSerializer.Deserialize<string[]>(File.ReadAllText(file), RequestJson)
                ?? throw new InvalidDataException("Input list must be a JSON array of paths.");
            foreach (var entry in listed)
            {
                var path = Path.GetFullPath(entry);
                if (!File.Exists(path)) throw new FileNotFoundException($"File was not found: {entry}");
                inputs.Add(path);
            }
        }
        return inputs;
    }

    public static async Task<object> InspectFilesAsync(IReadOnlyList<string> inputs, string? output)
    {
        if (inputs.Count == 0) throw new ArgumentException("At least one --input file is required.");
        if (inputs.Count > MaxInputs) throw new ArgumentException("Too many input files for one inspection.");
        var files = new List<object>(inputs.Count);
        foreach (var input in inputs)
        {
            var extension = Path.GetExtension(input).ToLowerInvariant();
            var name = Path.GetFileName(input).ToLowerInvariant();
            try
            {
                object described = extension switch
                {
                    ".ymap" => await InspectYmapAsync(input),
                    ".ytyp" => await InspectYtypAsync(input),
                    ".ydd" => await InspectYddAsync(input),
                    ".ymt" or ".meta" when name.Contains("gtxd") => await InspectGtxdAsync(input),
                    _ => throw new ArgumentException($"Unsupported map file: {name}"),
                };
                files.Add(described);
            }
            catch (Exception error)
            {
                files.Add(new
                {
                    input,
                    kind = "error",
                    error = new { code = error.GetType().Name, message = error.Message },
                });
            }
        }
        var result = new { format = "astral.map-files", version = 1, count = files.Count, files };
        if (string.IsNullOrWhiteSpace(output)) return result;
        var target = Path.GetFullPath(output);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        await File.WriteAllTextAsync(target, JsonSerializer.Serialize(result, Program.JsonOptions));
        return new { format = "astral.map-files", version = 1, count = files.Count, output = target };
    }

    private static async Task<byte[]> ReadBoundedAsync(string input, long limit)
    {
        var info = new FileInfo(input);
        if (info.Length is 0 || info.Length > limit)
            throw new InvalidDataException($"{info.Name}: size {info.Length} is outside the allowed range.");
        return await File.ReadAllBytesAsync(input);
    }

    private static object Vector(SharpDX.Vector3 value) => new { x = value.X, y = value.Y, z = value.Z };
    private static string Hash(MetaHash value) => $"0x{(uint)value:x8}";
    private static string? KnownName(MetaHash value)
    {
        var text = JenkIndex.TryGetString(value);
        return string.IsNullOrEmpty(text) ? null : text;
    }

    private static async Task<object> InspectYmapAsync(string input)
    {
        var bytes = await ReadBoundedAsync(input, 8L * 1024 * 1024);
        var ymap = new YmapFile { Name = Path.GetFileName(input) };
        ymap.Load(bytes);
        if (!ymap.Loaded) throw new InvalidDataException("CodeWalker could not load the YMAP.");
        var entities = (ymap.AllEntities ?? []).Select(entity => new
        {
            index = entity.Index,
            archetypeHash = Hash(entity.CEntityDef.archetypeName),
            archetypeName = KnownName(entity.CEntityDef.archetypeName),
            isMlo = entity.IsMlo,
            position = Vector(entity.Position),
            rotation = new
            {
                x = entity.Orientation.X,
                y = entity.Orientation.Y,
                z = entity.Orientation.Z,
                w = entity.Orientation.W,
            },
            scale = new { xy = entity.CEntityDef.scaleXY, z = entity.CEntityDef.scaleZ },
            flags = entity.CEntityDef.flags,
            guid = entity.CEntityDef.guid,
            parentIndex = entity.CEntityDef.parentIndex,
            lodDist = entity.CEntityDef.lodDist,
            childLodDist = entity.CEntityDef.childLodDist,
            numChildren = entity.CEntityDef.numChildren,
            lodLevel = entity.CEntityDef.lodLevel.ToString().Replace("LODTYPES_DEPTH_", ""),
            priorityLevel = entity.CEntityDef.priorityLevel.ToString().Replace("PRI_", ""),
            tintValue = entity.CEntityDef.tintValue,
        }).ToArray();
        return new
        {
            input,
            kind = "ymap",
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            nameHash = Hash(ymap.CMapData.name),
            name = KnownName(ymap.CMapData.name),
            parentHash = Hash(ymap.CMapData.parent),
            parent = KnownName(ymap.CMapData.parent),
            flags = ymap.CMapData.flags,
            contentFlags = ymap.CMapData.contentFlags,
            streamingExtentsMin = Vector(ymap.CMapData.streamingExtentsMin),
            streamingExtentsMax = Vector(ymap.CMapData.streamingExtentsMax),
            entitiesExtentsMin = Vector(ymap.CMapData.entitiesExtentsMin),
            entitiesExtentsMax = Vector(ymap.CMapData.entitiesExtentsMax),
            entityCount = entities.Length,
            entities,
        };
    }

    private static async Task<object> InspectYtypAsync(string input)
    {
        var bytes = await ReadBoundedAsync(input, 16L * 1024 * 1024);
        var ytyp = new YtypFile { Name = Path.GetFileName(input) };
        ytyp.Load(bytes);
        if (!ytyp.Loaded) throw new InvalidDataException("CodeWalker could not load the YTYP.");
        var archetypes = (ytyp.AllArchetypes ?? []).Select(archetype =>
        {
            var def = archetype._BaseArchetypeDef;
            var mlo = archetype as MloArchetype;
            var time = archetype as TimeArchetype;
            return new
            {
                type = archetype.Type.ToString(),
                nameHash = Hash(def.name),
                name = KnownName(def.name),
                assetHash = Hash(def.assetName),
                assetName = KnownName(def.assetName),
                assetType = def.assetType.ToString().Replace("ASSET_TYPE_", "").ToLowerInvariant(),
                textureDictionaryHash = Hash(def.textureDictionary),
                textureDictionary = KnownName(def.textureDictionary),
                drawableDictionaryHash = Hash(def.drawableDictionary),
                drawableDictionary = KnownName(def.drawableDictionary),
                physicsDictionaryHash = Hash(def.physicsDictionary),
                clipDictionaryHash = Hash(def.clipDictionary),
                lodDist = def.lodDist,
                hdTextureDist = def.hdTextureDist,
                flags = def.flags,
                specialAttribute = def.specialAttribute,
                timeFlags = time?.TimeFlags,
                bbMin = Vector(archetype.BBMin),
                bbMax = Vector(archetype.BBMax),
                bsCenter = Vector(archetype.BSCenter),
                bsRadius = archetype.BSRadius,
                mlo = mlo is null ? null : new
                {
                    rooms = (mlo.rooms ?? []).Select(room => new
                    {
                        room.Index,
                        name = room.RoomName,
                        bbMin = Vector(room.BBMin),
                        bbMax = Vector(room.BBMax),
                        flags = room.Data.flags,
                    }).ToArray(),
                    entities = (mlo.entities ?? []).Select(entity => new
                    {
                        entity.Index,
                        archetypeHash = Hash(entity.Data.archetypeName),
                        archetypeName = KnownName(entity.Data.archetypeName),
                        position = Vector(entity.Data.position),
                        rotation = new
                        {
                            x = entity.Data.rotation.X,
                            y = entity.Data.rotation.Y,
                            z = entity.Data.rotation.Z,
                            w = entity.Data.rotation.W,
                        },
                        flags = entity.Data.flags,
                        lodDist = entity.Data.lodDist,
                        parentIndex = entity.Data.parentIndex,
                    }).ToArray(),
                    entitySets = (mlo.entitySets ?? []).Select(set => new
                    {
                        set.Index,
                        set.Name,
                        entityCount = set.Entities?.Length ?? 0,
                    }).ToArray(),
                },
            };
        }).ToArray();
        return new
        {
            input,
            kind = "ytyp",
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            nameHash = Hash(ytyp.NameHash),
            archetypeCount = archetypes.Length,
            archetypes,
        };
    }

    /* Словарь drawable: какие модели в нём лежат. Имена внутри словаря —
       только хэши; сущность ymap ссылается на них тем же хэшем. */
    private static async Task<object> InspectYddAsync(string input)
    {
        var bytes = await ReadBoundedAsync(input, MaxInputBytes);
        var ydd = new YddFile { Name = Path.GetFileName(input) };
        ydd.Load(bytes);
        var drawables = (ydd.Dict ?? new Dictionary<uint, Drawable>())
            .OrderBy(kv => kv.Key)
            .Select(kv => new
            {
                hash = $"0x{kv.Key:x8}",
                name = KnownName(kv.Key),
                bbMin = Vector(kv.Value.BoundingBoxMin),
                bbMax = Vector(kv.Value.BoundingBoxMax),
                bsCenter = Vector(kv.Value.BoundingCenter),
                bsRadius = kv.Value.BoundingSphereRadius,
                lodDist = new
                {
                    high = kv.Value.LodDistHigh,
                    med = kv.Value.LodDistMed,
                    low = kv.Value.LodDistLow,
                    vlow = kv.Value.LodDistVlow,
                },
                models = new
                {
                    high = kv.Value.DrawableModels?.High?.Length ?? 0,
                    med = kv.Value.DrawableModels?.Med?.Length ?? 0,
                    low = kv.Value.DrawableModels?.Low?.Length ?? 0,
                    vlow = kv.Value.DrawableModels?.VLow?.Length ?? 0,
                },
                lights = kv.Value.LightAttributes?.data_items?.Length ?? 0,
            })
            .ToArray();
        return new
        {
            input,
            kind = "ydd",
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            drawableCount = drawables.Length,
            drawables,
        };
    }

    /* Родство словарей текстур (`gtxd.ymt`): у детали карты половина текстур
       лежит не в её словаре, а у родителя — и у родителя родителя. */
    private static async Task<object> InspectGtxdAsync(string input)
    {
        var bytes = await ReadBoundedAsync(input, 16L * 1024 * 1024);
        var name = Path.GetFileName(input);
        var entry = new RpfBinaryFileEntry { Name = name, NameLower = name.ToLowerInvariant() };
        var gtxd = new GtxdFile();
        gtxd.Load(bytes, entry);
        var relationships = gtxd.TxdRelationships ?? new Dictionary<string, string>();
        var parents = relationships
            .OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
            .Select(kv => new
            {
                child = kv.Key,
                childHash = $"0x{JenkHash.GenHash(kv.Key.ToLowerInvariant()):x8}",
                parent = kv.Value,
                parentHash = $"0x{JenkHash.GenHash(kv.Value.ToLowerInvariant()):x8}",
            })
            .ToArray();
        return new
        {
            input,
            kind = "gtxd",
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            loaded = gtxd.Loaded,
            count = parents.Length,
            parents,
        };
    }
}
