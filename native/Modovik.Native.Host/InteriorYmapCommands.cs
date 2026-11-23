using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

internal static class InteriorYmapCommands
{
    private sealed record LocationSpec(
        string Id,
        Vector3 Position,
        Quaternion Orientation,
        Vector3 RoomMin,
        Vector3 RoomMax,
        (float MinX, float MaxX, float MinY, float MaxY) Entrance);

    private sealed record PropSpec(
        string Id,
        string Archetype,
        Vector3 BbMin,
        Vector3 BbMax,
        Vector3 BsCenter,
        float BsRadius,
        float LodDist,
        // How much floor the prop actually takes, measured on the converted
        // model. Zero means "the archetype box is honest" - true for four of
        // the five props. Rockstar's box is what goes into the ymap either way;
        // this is only about fitting the prop into the verified room, and the
        // numbers are the same ones the editor uses
        // (packages/interior-contract/registries.js).
        float FootWidth = 0,
        float FootDepth = 0);

    private static readonly IReadOnlyDictionary<string, LocationSpec> Locations =
        new Dictionary<string, LocationSpec>(StringComparer.Ordinal)
        {
            ["shop-247-sc1-03"] = new(
                "shop-247-sc1-03",
                new Vector3(27.248524f, -1343.679f, 28.49696f),
                Quaternion.Identity,
                new Vector3(-2.4835482f, -5.576018f, -0.002836f),
                new Vector3(9.024524f, 1.9359231f, 3.556323f),
                (0.15f, 3.65f, -5.75f, -4.65f)),
            ["shop-247-cs2-11"] = new(
                "shop-247-cs2-11",
                new Vector3(1731.9592f, 6417.2437f, 34.03717f),
                new Quaternion(0, 0, -0.22800407f, 0.9736602f),
                new Vector3(-2.4835482f, -5.576018f, -0.002836f),
                new Vector3(9.024524f, 1.9359231f, 3.556323f),
                (0.15f, 3.65f, -5.75f, -4.65f)),
            ["gasstation-sc1-21"] = new(
                "gasstation-sc1-21",
                new Vector3(-50.868835f, -1751.0383f, 28.420937f),
                new Quaternion(0, 0, -0.34213108f, 0.9396522f),
                new Vector3(-3.8673806f, -5.625234f, -0.01788f),
                new Vector3(10.603222f, 2.768371f, 3.556324f),
                (0.15f, 3.75f, -5.75f, -4.60f)),
            ["gasstation-id2-21-b"] = new(
                "gasstation-id2-21-b",
                new Vector3(1156.7665f, -321.44058f, 68.20503f),
                new Quaternion(0, 0, 0.08715597f, 0.9961947f),
                new Vector3(-3.8673806f, -5.625234f, -0.01788f),
                new Vector3(10.603222f, 2.768371f, 3.556324f),
                (0.15f, 3.75f, -5.75f, -4.60f)),
        };

    private static readonly IReadOnlyDictionary<string, PropSpec> Props =
        new Dictionary<string, PropSpec>(StringComparer.Ordinal)
        {
            ["vending-drink"] = new(
                "vending-drink", "prop_vend_soda_01",
                new Vector3(-0.503182f, -0.473903f, -0.952678f),
                new Vector3(0.501645f, 0.460195f, 0.952574f),
                new Vector3(-0.0007685f, -0.006854f, -0.000052f), 1.173904f, 60),
            ["vending-drink-blue"] = new(
                "vending-drink-blue", "prop_vend_soda_02",
                new Vector3(-0.502413f, -0.473212f, -0.952626f),
                new Vector3(0.502414f, 0.473211f, 0.952626f),
                Vector3.Zero, 1.176369f, 60),
            ["trash-bin"] = new(
                "trash-bin", "prop_bin_05a",
                new Vector3(-0.389632f, -0.389632f, -0.037213f),
                new Vector3(0.389632f, 0.389632f, 1.018021f),
                new Vector3(0, 0, 0.490404f), 0.7628931f, 50),
            ["plant-pot"] = new(
                "plant-pot", "prop_plant_int_01a",
                new Vector3(-1.8f, -1.8f, 0),
                new Vector3(1.8f, 1.8f, 1.955277f),
                new Vector3(0, 0, 0.9776385f), 2.726862f, 45,
                0.961914f, 0.998535f),
            ["cooler-single"] = new(
                "cooler-single", "prop_bar_fridge_01",
                new Vector3(-0.418179f, -0.299095f, -0.01045f),
                new Vector3(0.41818f, 0.299095f, 2.161334f),
                new Vector3(0.0000005f, 0, 1.075442f), 1.201455f, 40),
        };

    private static readonly JsonSerializerOptions CompileJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 12,
    };

    private static object Vector(SharpDX.Vector3 value) => new
    {
        x = value.X,
        y = value.Y,
        z = value.Z,
    };

    private static object QuaternionValue(SharpDX.Quaternion value) => new
    {
        x = value.X,
        y = value.Y,
        z = value.Z,
        w = value.W,
    };

    private static string Hash(MetaHash value) => $"0x{((uint)value):x8}";

    public static async Task<object> InspectAsync(string input)
    {
        var bytes = await File.ReadAllBytesAsync(input);
        if (bytes.Length is 0 or > 1024 * 1024)
            throw new InvalidDataException("Interior YMAP must be between 1 byte and 1 MiB.");

        var ymap = new YmapFile { Name = Path.GetFileName(input) };
        ymap.Load(bytes);
        if (!ymap.Loaded) throw new InvalidDataException("CodeWalker could not load the YMAP.");

        var entities = (ymap.AllEntities ?? [])
            .Select(entity => new
            {
                entity.Index,
                archetypeHash = Hash(entity.CEntityDef.archetypeName),
                archetypeName = JenkIndex.GetString(entity.CEntityDef.archetypeName),
                entity.IsMlo,
                position = Vector(entity.Position),
                orientation = QuaternionValue(entity.Orientation),
                storedRotation = new
                {
                    x = entity.CEntityDef.rotation.X,
                    y = entity.CEntityDef.rotation.Y,
                    z = entity.CEntityDef.rotation.Z,
                    w = entity.CEntityDef.rotation.W,
                },
                scale = Vector(entity.Scale),
                entity.CEntityDef.flags,
                entity.CEntityDef.guid,
                entity.CEntityDef.parentIndex,
                entity.CEntityDef.lodDist,
                entity.CEntityDef.childLodDist,
                lodLevel = entity.CEntityDef.lodLevel.ToString(),
                priorityLevel = entity.CEntityDef.priorityLevel.ToString(),
            })
            .ToArray();

        return new
        {
            input,
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            map = new
            {
                nameHash = Hash(ymap.CMapData.name),
                name = JenkIndex.GetString(ymap.CMapData.name),
                parentHash = Hash(ymap.CMapData.parent),
                parent = JenkIndex.GetString(ymap.CMapData.parent),
                ymap.CMapData.flags,
                ymap.CMapData.contentFlags,
                streamingExtentsMin = Vector(ymap.CMapData.streamingExtentsMin),
                streamingExtentsMax = Vector(ymap.CMapData.streamingExtentsMax),
                entitiesExtentsMin = Vector(ymap.CMapData.entitiesExtentsMin),
                entitiesExtentsMax = Vector(ymap.CMapData.entitiesExtentsMax),
            },
            entityCount = entities.Length,
            entities,
            saveWarnings = ymap.SaveWarnings ?? [],
        };
    }

    public static async Task<object> InspectYtypAsync(string input)
    {
        var bytes = await File.ReadAllBytesAsync(input);
        if (bytes.Length is 0 or > 4 * 1024 * 1024)
            throw new InvalidDataException("Interior YTYP must be between 1 byte and 4 MiB.");
        var ytyp = new YtypFile { Name = Path.GetFileName(input) };
        ytyp.Load(bytes);
        if (!ytyp.Loaded) throw new InvalidDataException("CodeWalker could not load the YTYP.");

        var archetypes = (ytyp.AllArchetypes ?? []).Select(archetype =>
        {
            var mlo = archetype as MloArchetype;
            return new
            {
                type = archetype.Type.ToString(),
                name = archetype.Name,
                nameHash = Hash(archetype.BaseArchetypeDef.name),
                assetName = archetype.AssetName,
                assetHash = Hash(archetype.BaseArchetypeDef.assetName),
                bbMin = Vector(archetype.BBMin),
                bbMax = Vector(archetype.BBMax),
                bsCenter = Vector(archetype.BSCenter),
                archetype.BSRadius,
                archetype.LodDist,
                rooms = (mlo?.rooms ?? []).Select(room => new
                {
                    room.Index,
                    room.RoomName,
                    bbMin = Vector(room.BBMin),
                    bbMax = Vector(room.BBMax),
                    room.Data.flags,
                    room.Data.floorId,
                    attachedObjects = room.AttachedObjects ?? [],
                }).ToArray(),
                portals = (mlo?.portals ?? []).Select(portal => new
                {
                    portal.Index,
                    portal.Data.roomFrom,
                    portal.Data.roomTo,
                    portal.Data.flags,
                    center = Vector(portal.Center),
                    corners = (portal.Corners ?? []).Select(corner => new
                    {
                        x = corner.X,
                        y = corner.Y,
                        z = corner.Z,
                    }).ToArray(),
                    attachedObjects = portal.AttachedObjects ?? [],
                }).ToArray(),
                entities = (mlo?.entities ?? []).Select(entity => new
                {
                    entity.Index,
                    archetypeName = entity.Data.archetypeName.ToString(),
                    archetypeHash = Hash(entity.Data.archetypeName),
                    position = Vector(entity.Data.position),
                    rotation = new
                    {
                        x = entity.Data.rotation.X,
                        y = entity.Data.rotation.Y,
                        z = entity.Data.rotation.Z,
                        w = entity.Data.rotation.W,
                    },
                    entity.Data.flags,
                    entity.Data.lodDist,
                    entity.Data.parentIndex,
                }).ToArray(),
                // Наборы — не украшение: у гаража арены стены и пол зала лежат
                // в set_int_mod_shell_def, и без их сущностей интерьер из
                // сборки выходит без половины геометрии.
                entitySets = (mlo?.entitySets ?? []).Select(set => new
                {
                    set.Index,
                    set.Name,
                    entityCount = set.Entities?.Length ?? 0,
                    entities = (set.Entities ?? []).Select(entity => new
                    {
                        archetypeName = entity.Data.archetypeName.ToString(),
                        archetypeHash = Hash(entity.Data.archetypeName),
                        position = Vector(entity.Data.position),
                        rotation = new
                        {
                            x = entity.Data.rotation.X,
                            y = entity.Data.rotation.Y,
                            z = entity.Data.rotation.Z,
                            w = entity.Data.rotation.W,
                        },
                        entity.Data.flags,
                        entity.Data.lodDist,
                    }).ToArray(),
                }).ToArray(),
            };
        }).ToArray();

        return new
        {
            input,
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            ytyp.NameHash,
            archetypeCount = archetypes.Length,
            archetypes,
        };
    }

    public static async Task<object> CompileAsync(string input, string output)
    {
        var inputBytes = await File.ReadAllBytesAsync(input);
        if (inputBytes.Length is 0 or > 512 * 1024)
            throw new InvalidDataException("Compile request must be between 1 byte and 512 KiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(inputBytes, CompileJsonOptions)
            ?? throw new InvalidDataException("Compile request is empty.");
        ValidateRequest(request);
        var location = Locations[request.LocationId];
        var expected = new List<ExpectedEntity>(request.Entities.Length);
        var entities = new List<YmapEntityDef>(request.Entities.Length);
        var ids = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < request.Entities.Length; index++)
        {
            var item = request.Entities[index];
            var entityId = item.Id ?? "";
            if (!Regex.IsMatch(entityId, "^[a-z0-9][a-z0-9._:-]{0,95}$"))
                throw new InvalidDataException($"entities[{index}].id is invalid.");
            if (!ids.Add(entityId)) throw new InvalidDataException($"Duplicate entity id: {entityId}");
            if (!Props.TryGetValue(item.PropId ?? "", out var prop))
                throw new InvalidDataException($"Unknown safe propId: {item.PropId}");
            ValidateFinite(item.Position, $"entities[{index}].position", -100, 100);
            ValidateQuaternion(item.Rotation, $"entities[{index}].rotation");
            ValidatePlacement(location, prop, item, index);

            var localPosition = new Vector3(
                item.Position.X,
                item.Position.Y,
                item.Position.Z - prop.BbMin.Z);
            var worldPosition = location.Position + location.Orientation.Multiply(localPosition);
            var localOrientation = Quaternion.Normalize(new Quaternion(
                item.Rotation.X, item.Rotation.Y, item.Rotation.Z, item.Rotation.W));
            var worldOrientation = Quaternion.Normalize(
                Quaternion.Multiply(location.Orientation, localOrientation));
            var archetypeHash = new MetaHash(JenkHash.GenHash(prop.Archetype));
            var definition = new CEntityDef
            {
                archetypeName = archetypeHash,
                flags = 1572864,
                guid = JenkHash.GenHash($"{request.DesignHash}:{entityId}"),
                position = worldPosition,
                rotation = new Vector4(0, 0, 0, 1),
                scaleXY = 1,
                scaleZ = 1,
                parentIndex = -1,
                lodDist = prop.LodDist,
                childLodDist = 0,
                lodLevel = rage__eLodType.LODTYPES_DEPTH_ORPHANHD,
                priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
                ambientOcclusionMultiplier = 255,
                artificialAmbientOcclusion = 255,
            };
            var ymapEntity = new YmapEntityDef(null, index, ref definition);
            ymapEntity.SetOrientation(worldOrientation);
            var archetypeDefinition = new CBaseArchetypeDef
            {
                name = archetypeHash,
                assetName = archetypeHash,
                assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
                bbMin = prop.BbMin,
                bbMax = prop.BbMax,
                bsCentre = prop.BsCenter,
                bsRadius = prop.BsRadius,
                lodDist = prop.LodDist,
            };
            var archetype = new Archetype();
            archetype.Init(null, ref archetypeDefinition);
            ymapEntity.SetArchetype(archetype);
            entities.Add(ymapEntity);
            expected.Add(new(entityId, prop.Archetype, (uint)archetypeHash, worldPosition, worldOrientation));
        }

        var mapName = $"astral_int_{request.LocationId.Replace('-', '_')}";
        if (request.Destination.Entry != mapName + ".ymap")
            throw new InvalidDataException("Destination entry does not match the location-derived YMAP name.");
        var ymap = new YmapFile
        {
            Name = mapName + ".ymap",
            CMapData = new CMapData(),
            AllEntities = entities.ToArray(),
            BlockExportedBy = "Astral Interior Compiler 1",
            BlockTime = "01 January 1970 00:00",
        };
        ymap.CalcFlags();
        ymap.CalcExtents();
        var outputBytes = ymap.Save();
        if (outputBytes.Length is 0 or > 1024 * 1024)
            throw new InvalidDataException("Compiled YMAP exceeded the 1 MiB artifact limit.");
        await File.WriteAllBytesAsync(output, outputBytes);

        var reopened = new YmapFile { Name = Path.GetFileName(output) };
        reopened.Load(await File.ReadAllBytesAsync(output));
        var actual = reopened.AllEntities ?? [];
        if (actual.Length != expected.Count)
            throw new InvalidDataException("Semantic reopen entity count mismatch.");
        for (var index = 0; index < actual.Length; index++)
        {
            var wanted = expected[index];
            var found = actual[index];
            if ((uint)found.CEntityDef.archetypeName != wanted.ArchetypeHash ||
                Vector3.Distance(found.Position, wanted.Position) > 0.01f ||
                QuaternionAngleDegrees(found.Orientation, wanted.Orientation) > 0.1f)
                throw new InvalidDataException($"Semantic reopen mismatch at entity {wanted.Id}.");
        }
        var secondPass = ymap.Save();
        if (!outputBytes.SequenceEqual(secondPass))
            throw new InvalidDataException("Compiler output is not byte-deterministic.");
        return new
        {
            input,
            output,
            request.DesignHash,
            request.LocationId,
            mapName,
            entityCount = expected.Count,
            bytes = outputBytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(outputBytes)).ToLowerInvariant(),
            semanticReopen = true,
            deterministic = true,
            entities = expected.Select(item => new
            {
                item.Id,
                item.Archetype,
                archetypeHash = $"0x{item.ArchetypeHash:x8}",
                position = Vector(item.Position),
                orientation = QuaternionValue(item.Orientation),
            }).ToArray(),
        };
    }

    private static void ValidateRequest(CompileRequest request)
    {
        if (request.Format != "astral.compile-interior-layout" || request.Version != 1)
            throw new InvalidDataException("Unsupported interior compile contract.");
        if (request.TargetId != "gta5-legacy-story")
            throw new InvalidDataException("Only the GTA V Legacy Story target is supported.");
        if (!Regex.IsMatch(request.DesignHash ?? "", "^sha256:[a-f0-9]{64}$"))
            throw new InvalidDataException("designHash is invalid.");
        if (!Locations.ContainsKey(request.LocationId ?? ""))
            throw new InvalidDataException("Location is not in the compiled build-scoped registry.");
        if (request.CatalogRevision != "legacy-24129523-v1")
            throw new InvalidDataException("Catalog revision does not match this compiler.");
        if (request.Entities is null || request.Entities.Length is < 1 or > 128)
            throw new InvalidDataException("Compile request must contain between 1 and 128 entities.");
        if (request.Destination is null ||
            request.Destination.Container != "x64/astral/astral_maps.rpf" ||
            request.Destination.AtomicSlot != $"interior-location-{request.LocationId}")
            throw new InvalidDataException("Destination is outside the managed interior location slot.");
    }

    private static void ValidatePlacement(LocationSpec location, PropSpec prop, CompileEntity entity, int index)
    {
        var q = new Quaternion(entity.Rotation.X, entity.Rotation.Y, entity.Rotation.Z, entity.Rotation.W);
        var yaw = MathF.Atan2(2 * (q.W * q.Z + q.X * q.Y), 1 - 2 * (q.Y * q.Y + q.Z * q.Z));
        // The editor holds props inside the room by the measured footprint, so
        // the compiler has to judge them by the same number. While it judged by
        // the archetype box, a plant placed a metre from the wall passed the
        // editor without a word and failed here with an English exception - the
        // one case where "where am I allowed to put this" had two answers.
        var width = prop.FootWidth > 0 ? prop.FootWidth : prop.BbMax.X - prop.BbMin.X;
        var depth = prop.FootDepth > 0 ? prop.FootDepth : prop.BbMax.Y - prop.BbMin.Y;
        var rotatedWidth = MathF.Abs(MathF.Cos(yaw)) * width + MathF.Abs(MathF.Sin(yaw)) * depth;
        var rotatedDepth = MathF.Abs(MathF.Sin(yaw)) * width + MathF.Abs(MathF.Cos(yaw)) * depth;
        var minX = entity.Position.X - rotatedWidth / 2;
        var maxX = entity.Position.X + rotatedWidth / 2;
        var minY = entity.Position.Y - rotatedDepth / 2;
        var maxY = entity.Position.Y + rotatedDepth / 2;
        var top = entity.Position.Z + (prop.BbMax.Z - prop.BbMin.Z);
        if (minX < location.RoomMin.X || maxX > location.RoomMax.X ||
            minY < location.RoomMin.Y || maxY > location.RoomMax.Y ||
            entity.Position.Z < 0 || top > location.RoomMax.Z)
            throw new InvalidDataException($"entities[{index}] is outside the verified trading-room bounds.");
        var entrance = location.Entrance;
        if (minX < entrance.MaxX && maxX > entrance.MinX &&
            minY < entrance.MaxY && maxY > entrance.MinY)
            throw new InvalidDataException($"entities[{index}] blocks the verified entrance portal.");
    }

    private static void ValidateFinite(CompileVector value, string path, float min, float max)
    {
        if (value is null || !float.IsFinite(value.X) || !float.IsFinite(value.Y) || !float.IsFinite(value.Z) ||
            value.X < min || value.X > max || value.Y < min || value.Y > max || value.Z < -10 || value.Z > 20)
            throw new InvalidDataException($"{path} is not finite or bounded.");
    }

    private static void ValidateQuaternion(CompileQuaternion value, string path)
    {
        if (value is null || !float.IsFinite(value.X) || !float.IsFinite(value.Y) ||
            !float.IsFinite(value.Z) || !float.IsFinite(value.W))
            throw new InvalidDataException($"{path} is invalid.");
        var length = MathF.Sqrt(value.X * value.X + value.Y * value.Y + value.Z * value.Z + value.W * value.W);
        if (length < 0.999f || length > 1.001f)
            throw new InvalidDataException($"{path} must be normalized.");
    }

    private static float QuaternionAngleDegrees(Quaternion left, Quaternion right)
    {
        var dot = Math.Clamp(MathF.Abs(Quaternion.Dot(left, right)), 0, 1);
        return 2 * MathF.Acos(dot) * 180 / MathF.PI;
    }

    private sealed record ExpectedEntity(string Id, string Archetype, uint ArchetypeHash, Vector3 Position, Quaternion Orientation);

    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class CompileRequest
    {
        public string Format { get; init; } = "";
        public int Version { get; init; }
        public string TargetId { get; init; } = "";
        public string DesignHash { get; init; } = "";
        public string LocationId { get; init; } = "";
        public CompileTemplateRef TemplateRef { get; init; } = new();
        public string CatalogRevision { get; init; } = "";
        public CompileEntity[] Entities { get; init; } = [];
        public CompileDestination Destination { get; init; } = new();
        public bool Eligible { get; init; }
        public string[] Blockers { get; init; } = [];
    }

    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class CompileTemplateRef { public string Id { get; init; } = ""; public int Version { get; init; } }
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class CompileDestination { public string AtomicSlot { get; init; } = ""; public string Container { get; init; } = ""; public string Entry { get; init; } = ""; }
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class CompileEntity { public string Id { get; init; } = ""; public string PropId { get; init; } = ""; public CompileVector Position { get; init; } = new(); public CompileQuaternion Rotation { get; init; } = new(); }
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class CompileVector { public float X { get; init; } public float Y { get; init; } public float Z { get; init; } }
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class CompileQuaternion { public float X { get; init; } public float Y { get; init; } public float Z { get; init; } public float W { get; init; } }
}
