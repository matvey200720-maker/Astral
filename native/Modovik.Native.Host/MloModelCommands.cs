using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Свои модели мест внутри помещения игры (ТЗ 11.10.2026, вечер, задача 1).
///
/// Помещение (MLO) игра рисует своими комнатами: сущность обычной карты,
/// что стоит внутри него, видна только снаружи, а изнутри её прячут
/// порталы. Поэтому модель в зале ставится сущностью самого помещения:
/// её архетип дописывается в файл типов помещения (`.ytyp` — с ним он и
/// грузится), сущность — в список сущностей MLO и в комнату, в рамке
/// которой стоит (иначе — в ближайшую комнату; «limbo» — нулевая — не
/// берётся). Место сущности — в осях помещения, без поворота: поворот уже
/// в сетке модели (`recolor-place-models.js`).
///
/// Основа — файл помещения из игры игрока (или уже правленный набором: кресла
/// и звезда арены); прежние модели Astral с теми же именами заменяются.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class MloModelCommands
{
    private const string RequestFormat = "astral.compile-mlo-models";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 1024 * 1024;
    private const int MaxBaseBytes = 32 * 1024 * 1024;
    private const int MaxModels = 64;
    private const float MaxLocal = 2000f;

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> CompileAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("MLO models request must be between 1 byte and 1 MiB.");
        var request = JsonSerializer.Deserialize<MloRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("MLO models request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("MLO models request has an unknown format.");
        var models = request.Models ?? [];
        if (models.Length is 0 or > MaxModels) throw new InvalidDataException($"MLO models request needs 1…{MaxModels} models.");

        var basePath = Path.GetFullPath(request.Base ?? "");
        var info = new FileInfo(basePath);
        if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is 0 or > MaxBaseBytes ||
            !basePath.EndsWith(".ytyp", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("MLO base must be an existing .ytyp file up to 32 MiB.");
        var target = Path.GetFullPath(output);
        if (!target.EndsWith(".ytyp", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("MLO output must be a .ytyp file.");

        var ytyp = new YtypFile { Name = Path.GetFileName(basePath) };
        ytyp.Load(await File.ReadAllBytesAsync(basePath));
        if (!ytyp.Loaded) throw new InvalidDataException("CodeWalker could not load the interior .ytyp.");
        var mlos = (ytyp.AllArchetypes ?? []).OfType<MloArchetype>().ToArray();
        var mlo = request.Mlo is uint wanted ? mlos.FirstOrDefault(item => item._BaseArchetypeDef.name.Hash == wanted) : mlos.FirstOrDefault();
        if (mlo is null) throw new InvalidDataException("The interior .ytyp has no such MLO archetype.");
        var rooms = mlo.rooms ?? [];
        if (rooms.Length < 2) throw new InvalidDataException("The interior MLO has no rooms besides limbo.");
        /* Сохранение CodeWalker'а глотает ошибки записи частей MLO: что было — сверяется после. */
        var shapeBefore = ShapeOf(mlo);
        var archetypesBefore = ytyp.AllArchetypes?.Length ?? 0;

        /* Прежние модели Astral с теми же именами — прочь (повторная установка). */
        var names = new HashSet<uint>(models.Select(model => JenkHash.GenHash(ValidName(model.Name, "model"))));
        foreach (var old in (ytyp.AllArchetypes ?? []).Where(item => item is not MloArchetype && names.Contains(item._BaseArchetypeDef.name.Hash)).ToArray())
            ytyp.RemoveArchetype(old);
        for (var index = Array.FindIndex(mlo.entities ?? [], item => names.Contains(item._Data.archetypeName.Hash)); index >= 0;
             index = Array.FindIndex(mlo.entities ?? [], item => names.Contains(item._Data.archetypeName.Hash)))
        {
            var stale = new YmapEntityDef(null, index, ref mlo.entities![index]._Data) { Index = index };
            if (!mlo.RemoveEntity(stale)) throw new InvalidDataException("A previous Astral model could not be removed from the MLO.");
        }

        var removed = archetypesBefore - (ytyp.AllArchetypes?.Length ?? 0);
        var entitiesBase = mlo.entities?.Length ?? 0;
        var placed = new List<object>();
        foreach (var model in models)
        {
            var name = ValidName(model.Name, "model");
            var min = Vector(model.BbMin, $"{name} bbMin");
            var max = Vector(model.BbMax, $"{name} bbMax");
            if (min.X > max.X || min.Y > max.Y || min.Z > max.Z) throw new InvalidDataException($"Model {name} has an inverted box.");
            if (!float.IsFinite(model.LodDist) || model.LodDist is < 1f or > 5000f) throw new InvalidDataException($"{name}: lodDist must be 1…5000.");
            var centre = (min + max) * 0.5f;
            var asset = new MetaHash(JenkHash.GenHash(name));
            var definition = new CBaseArchetypeDef
            {
                lodDist = model.LodDist,
                flags = model.Flags,
                bbMin = min,
                bbMax = max,
                bsCentre = centre,
                bsRadius = Vector3.Distance(centre, max),
                hdTextureDist = Math.Min(model.LodDist, 100f),
                name = asset,
                textureDictionary = asset,
                clipDictionary = new MetaHash(model.ClipDictionary is null ? 0 : JenkHash.GenHash(ValidName(model.ClipDictionary, "clip dictionary"))),
                assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
                assetName = asset,
            };
            var archetype = new Archetype();
            archetype.Init(ytyp, ref definition);
            ytyp.AddArchetype(archetype);

            var position = Vector(model.Position, $"{name} position");
            var room = RoomOf(rooms, position);
            var entity = new CEntityDef
            {
                archetypeName = asset,
                flags = model.EntityFlags,
                guid = JenkHash.GenHash(ytyp.Name + "/" + name),
                position = position,
                rotation = new Vector4(0, 0, 0, 1),
                scaleXY = 1f,
                scaleZ = 1f,
                parentIndex = -1,
                lodDist = model.LodDist,
                childLodDist = 0f,
                lodLevel = rage__eLodType.LODTYPES_DEPTH_ORPHANHD,
                numChildren = 0,
                priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
                ambientOcclusionMultiplier = 255,
                artificialAmbientOcclusion = 255,
                tintValue = 0,
            };
            var instance = new YmapEntityDef(null, 0, ref entity);
            if (!mlo.AddEntity(instance, room)) throw new InvalidDataException($"{name}: the MLO did not accept the entity.");
            placed.Add(new { name, room, roomName = rooms[room].RoomName, position = new[] { position.X, position.Y, position.Z } });
        }

        var bytes = ytyp.Save();
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        await File.WriteAllBytesAsync(target, bytes);

        /* Сверка повторным открытием: архетипы, сущности MLO и комнаты. */
        var reopened = new YtypFile { Name = ytyp.Name };
        reopened.Load(bytes);
        var again = (reopened.AllArchetypes ?? []).OfType<MloArchetype>().FirstOrDefault(item => item._BaseArchetypeDef.name.Hash == mlo._BaseArchetypeDef.name.Hash);
        if (!reopened.Loaded || again is null) throw new InvalidDataException("Compiled interior .ytyp failed semantic reopen.");
        if (ShapeOf(again) != shapeBefore || (again.entities?.Length ?? 0) != entitiesBase + models.Length ||
            (reopened.AllArchetypes?.Length ?? 0) != archetypesBefore - removed + models.Length)
            throw new InvalidDataException("Compiled interior .ytyp lost rooms, portals, entity sets or modifiers of the MLO.");
        foreach (var model in models)
        {
            var hash = JenkHash.GenHash(model.Name!);
            if ((reopened.AllArchetypes ?? []).Count(item => item is not MloArchetype && item._BaseArchetypeDef.name.Hash == hash) != 1)
                throw new InvalidDataException($"Compiled interior .ytyp lost the archetype of {model.Name}.");
            var index = Array.FindIndex(again.entities ?? [], item => item._Data.archetypeName.Hash == hash);
            if (index < 0 || !(again.rooms ?? []).Any(room => (room.AttachedObjects ?? []).Contains((uint)index)))
                throw new InvalidDataException($"Compiled interior .ytyp lost the entity of {model.Name}.");
        }
        return new
        {
            format = "astral.mlo-models",
            version = 1,
            file = Path.GetFileName(target),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            mlo = $"0x{mlo._BaseArchetypeDef.name.Hash:x8}",
            entities = again.entities?.Length ?? 0,
            placed,
        };
    }

    private static string ShapeOf(MloArchetype mlo) =>
        $"{mlo.rooms?.Length ?? 0}/{mlo.portals?.Length ?? 0}/{mlo.entitySets?.Length ?? 0}/{mlo.timeCycleModifiers?.Length ?? 0}/" +
        string.Join(",", (mlo.portals ?? []).Select(portal => $"{portal._Data.roomFrom}-{portal._Data.roomTo}"));

    /* Комната, в рамке которой точка; нет такой — ближайшая. Нулевая (limbo) не берётся. */
    private static int RoomOf(MCMloRoomDef[] rooms, Vector3 point)
    {
        var best = 1;
        var bestDistance = float.MaxValue;
        for (var index = 1; index < rooms.Length; index++)
        {
            var min = rooms[index].BBMin;
            var max = rooms[index].BBMax;
            var clamped = Vector3.Clamp(point, Vector3.Min(min, max), Vector3.Max(min, max));
            var distance = Vector3.Distance(clamped, point);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                best = index;
            }
        }
        return best;
    }

    private static Vector3 Vector(float[]? value, string label)
    {
        if (value is not { Length: 3 } || value.Any(item => !float.IsFinite(item) || Math.Abs(item) > MaxLocal))
            throw new InvalidDataException($"{label} must be three finite numbers.");
        return new Vector3(value[0], value[1], value[2]);
    }

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name)) throw new InvalidDataException($"MLO {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    private sealed record ModelRequest(
        string? Name = null,
        float LodDist = 100f,
        float[]? BbMin = null,
        float[]? BbMax = null,
        uint Flags = 0,
        string? ClipDictionary = null,
        float[]? Position = null,
        uint EntityFlags = 32);

    private sealed record MloRequest(string Format, int Version, string? Base = null, uint? Mlo = null, ModelRequest[]? Models = null);
}
