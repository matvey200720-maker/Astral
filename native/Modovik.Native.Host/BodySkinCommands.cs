using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Вещь педа без привязки к костям получает веса тела — в самом файле игры.
///
/// Разбор 02.11.2026 («заменёнки поломаны», видео владельца, Majestic): мод
/// каталога «Скелеты на руки» несёт сетки `uppr` без весов — автор выгрузил их
/// без привязки. Игра рисует такую модель в позе привязки (руки врозь под 45°,
/// торс неподвижен): кожа торса стоит сквозь любую куртку, руки не идут за
/// персонажем. Окно с 01.11 давало ей веса ближайших вершин тела только в своём
/// кадре (`packages/clothing/body-fit.js`, `withBodySkin`), а установка клала
/// байты пакета как есть — в кадре вещь сидела, в игре нет.
///
/// Здесь то же правило, что у кадра, но в `.ydd`:
///   • какие геометрии: у модели нет флага кожи (`HasSkin`) или в вершине нет
///     весов и костей (`BlendWeights`, `BlendIndices`) — так их не видит и
///     читатель окна (`mesh.skin`);
///   • откуда веса: ближайшая вершина частей тела игры в позе привязки
///     (`references`: торс, ноги, обувь, голова того же пола) — её четыре
///     байта весов и четыре байта костей как есть (кость — номер в скелете
///     педа, через `BoneIds` части, если он у неё есть);
///   • вершина получает раскладку с весами и костями, остальные семантики —
///     те же байты; `BoneIds` геометрии снимаются (номер кости — сразу номер в
///     скелете, как у одежды игры), модель помечается скинованной.
/// Остальное — шейдеры, индексы, рамки, другие уровни детализации — то, что
/// было; собирает ресурс CodeWalker. Что ничего не нужно — файл без изменений.
/// После сборки модель открывается заново: каждая геометрия обязана нести веса.
///
/// Детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class BodySkinCommands
{
    private const string RequestFormat = "astral.skin-from-body";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 16 * 1024;
    private const int MaxModelBytes = 64 * 1024 * 1024;
    private const int MaxReferences = 8;
    /* Клетка поиска ближайшей вершины — как у кадра (`body-fit.js`, CELL). */
    private const float Cell = 0.08f;
    private const int MaxRing = 12;
    private const uint SkinSemantics = (1u << 1) | (1u << 2);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> SkinAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Skin request must be between 1 byte and 16 KiB.");
        var request = JsonSerializer.Deserialize<SkinRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Skin request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Skin request has an unknown format.");
        if (request.References is null || request.References.Length is 0 or > MaxReferences)
            throw new InvalidDataException("Skin request needs 1–8 reference body parts.");
        var outputPath = Path.GetFullPath(output);
        if (!outputPath.EndsWith(".ydd", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Skin output must be a .ydd file.");

        var (modelBytes, model) = await ReadYddAsync(request.Model, "model");
        var body = new BodyVertices();
        foreach (var reference in request.References)
            body.Add((await ReadYddAsync(reference, "reference")).Ydd);
        if (body.Count == 0) throw new InvalidDataException("Reference body parts carry no skinned vertices.");

        var report = new Report();
        foreach (var drawable in model.Drawables ?? [])
            foreach (var drawableModel in drawable?.AllModels ?? [])
                SkinModel(drawableModel, body, report);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        if (report.Geometries == 0)
        {
            await File.WriteAllBytesAsync(outputPath, modelBytes);
            return Answer(outputPath, modelBytes, report, changed: false);
        }
        var bytes = model.Save();
        Reopen(bytes, report);
        await File.WriteAllBytesAsync(outputPath, bytes);
        return Answer(outputPath, bytes, report, changed: true);
    }

    private static async Task<(byte[] Bytes, YddFile Ydd)> ReadYddAsync(string? file, string label)
    {
        if (string.IsNullOrWhiteSpace(file)) throw new InvalidDataException($"Skin {label} is missing.");
        var full = Path.GetFullPath(file);
        if (!full.EndsWith(".ydd", StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            throw new InvalidDataException($"Skin {label} must be an existing .ydd file.");
        var bytes = await File.ReadAllBytesAsync(full);
        if (bytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException($"Skin {label} is empty or too large.");
        var ydd = new YddFile { Name = Path.GetFileName(full) };
        ydd.Load(bytes);
        if (!ydd.Loaded || ydd.Drawables is null || ydd.Drawables.Length == 0)
            throw new InvalidDataException($"Skin {label} does not open.");
        return (bytes, ydd);
    }

    private static bool CarriesSkin(DrawableGeometry geometry) =>
        geometry.VertexBuffer?.Info is { } info && (info.Flags & SkinSemantics) == SkinSemantics;

    /*
     * Жёсткая деталь на кости (`HasSkin` 0, `BoneIndex` не корень) — так устроены пряжки и подвески игры: она идёт за своей костью, это не брак.
     * Без кожи на корне — стоит в позе привязки: её и чиним, как и геометрии скинованной модели, где весов нет.
     */
    internal static bool RigidOnBone(DrawableModel model) => model.HasSkin == 0 && model.BoneIndex != 0;

    /// <summary>Модель без кожи на корне — все её геометрии получают веса тела; скинованная — только геометрии без весов.</summary>
    private static void SkinModel(DrawableModel? model, BodyVertices body, Report report)
    {
        if (model?.Geometries is null || model.Geometries.Length == 0 || RigidOnBone(model)) return;
        var unskinned = model.HasSkin == 0;
        var needs = unskinned || model.Geometries.Any(geometry => geometry is not null && !CarriesSkin(geometry));
        if (!needs) return;
        foreach (var geometry in model.Geometries)
        {
            if (geometry?.VertexBuffer?.Info is null || geometry.VertexBuffer.Data1?.VertexBytes is null) continue;
            if (!unskinned && CarriesSkin(geometry)) continue;
            SkinGeometry(geometry, body, report);
        }
        model.HasSkin = 1;
        model.BoneIndex = 0;
        report.Models += 1;
    }

    private static void SkinGeometry(DrawableGeometry geometry, BodyVertices body, Report report)
    {
        var buffer = geometry.VertexBuffer;
        var oldInfo = buffer.Info;
        var oldData = buffer.Data1;
        if (oldInfo.GetComponentType(0) != VertexComponentType.Float3)
            throw new InvalidDataException("Skin model vertices have no float positions.");
        var types = (ulong)oldInfo.Types;
        types &= ~(0xFFul << 4);
        types |= ((ulong)body.WeightsType << 4) | ((ulong)body.IndicesType << 8);
        var info = new VertexDeclaration
        {
            Flags = oldInfo.Flags | SkinSemantics,
            Types = (VertexDeclarationTypes)types,
            Unknown_6h = oldInfo.Unknown_6h,
        };
        info.UpdateCountAndStride();
        var count = oldData.VertexCount;
        var oldStride = oldData.VertexStride > 0 ? oldData.VertexStride : oldInfo.Stride;
        var stride = info.Stride;
        var source = oldData.VertexBytes;
        var target = new byte[count * stride];
        var weightsAt = info.GetComponentOffset(1);
        var indicesAt = info.GetComponentOffset(2);
        var positionAt = oldInfo.GetComponentOffset(0);
        for (var vertex = 0; vertex < count; vertex += 1)
        {
            /* Семантики, что были, — теми же байтами на новых местах; веса и кости пишутся ниже. */
            for (var semantic = 0; semantic < 16; semantic += 1)
            {
                if (((oldInfo.Flags >> semantic) & 1) == 0 || semantic is 1 or 2) continue;
                var size = VertexComponentTypes.GetSizeInBytes(oldInfo.GetComponentType(semantic));
                Buffer.BlockCopy(source, vertex * oldStride + oldInfo.GetComponentOffset(semantic), target, vertex * stride + info.GetComponentOffset(semantic), size);
            }
            var at = vertex * oldStride + positionAt;
            var position = new Vector3(BitConverter.ToSingle(source, at), BitConverter.ToSingle(source, at + 4), BitConverter.ToSingle(source, at + 8));
            var near = body.Nearest(position, out var far);
            if (far) report.Far += 1;
            Buffer.BlockCopy(body.Weights, near * 4, target, vertex * stride + weightsAt, 4);
            Buffer.BlockCopy(body.Indices, near * 4, target, vertex * stride + indicesAt, 4);
        }
        var data = new VertexData
        {
            VertexStride = stride,
            VertexCount = count,
            Info = info,
            VertexType = (VertexType)info.Flags,
            VertexBytes = target,
        };
        buffer.Info = info;
        buffer.VertexStride = (ushort)stride;
        buffer.Data1 = data;
        buffer.Data2 = data;
        geometry.VertexData = data;
        /* Номер кости в вершине — сразу номер в скелете педа, как у одежды игры. */
        geometry.BoneIds = null;
        report.Geometries += 1;
        report.Vertices += count;
    }

    private static void Reopen(byte[] bytes, Report report)
    {
        var ydd = new YddFile();
        ydd.Load(bytes);
        if (!ydd.Loaded || ydd.Drawables is null)
            throw new InvalidDataException("Skinned model failed to reopen.");
        var geometries = 0;
        foreach (var drawable in ydd.Drawables)
            foreach (var model in drawable?.AllModels ?? [])
                foreach (var geometry in model?.Geometries ?? [])
                {
                    if (geometry is null || RigidOnBone(model!)) continue;
                    if (model!.HasSkin != 1 || !CarriesSkin(geometry))
                        throw new InvalidDataException("Skinned model still has geometry without bone weights.");
                    geometries += 1;
                }
        if (geometries < report.Geometries)
            throw new InvalidDataException("Skinned model lost geometries on reopen.");
    }

    private static object Answer(string path, byte[] bytes, Report report, bool changed) => new
    {
        file = Path.GetFileName(path),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        changed,
        models = report.Models,
        geometries = report.Geometries,
        vertices = report.Vertices,
        /* Вершин дальше кольца поиска от тела: им веса — от ближайшей вершины перебором. */
        far = report.Far,
    };

    private sealed class Report
    {
        public int Models;
        public int Geometries;
        public int Vertices;
        public int Far;
    }

    /// <summary>Вершины тела с весами: позиции, по четыре байта весов и костей (кость — номер в скелете), клетки поиска.</summary>
    private sealed class BodyVertices
    {
        private readonly List<Vector3> positions = [];
        private readonly List<byte> weights = [];
        private readonly List<byte> indices = [];
        private readonly Dictionary<(int, int, int), List<int>> cells = [];
        public VertexComponentType WeightsType { get; private set; } = VertexComponentType.Nothing;
        public VertexComponentType IndicesType { get; private set; } = VertexComponentType.Nothing;
        public int Count => positions.Count;
        public byte[] Weights => weightsArray ??= [.. weights];
        public byte[] Indices => indicesArray ??= [.. indices];
        private byte[]? weightsArray;
        private byte[]? indicesArray;

        public void Add(YddFile ydd)
        {
            foreach (var drawable in ydd.Drawables ?? [])
                foreach (var model in drawable?.DrawableModels?.High ?? [])
                {
                    if (model?.HasSkin != 1) continue;
                    foreach (var geometry in model.Geometries ?? [])
                    {
                        var info = geometry?.VertexBuffer?.Info;
                        var data = geometry?.VertexBuffer?.Data1;
                        if (info is null || data?.VertexBytes is null || (info.Flags & SkinSemantics) != SkinSemantics) continue;
                        if (info.GetComponentType(0) != VertexComponentType.Float3) continue;
                        var weightsType = info.GetComponentType(1);
                        var indicesType = info.GetComponentType(2);
                        if (VertexComponentTypes.GetSizeInBytes(weightsType) != 4 || VertexComponentTypes.GetSizeInBytes(indicesType) != 4) continue;
                        if (WeightsType == VertexComponentType.Nothing)
                        {
                            WeightsType = weightsType;
                            IndicesType = indicesType;
                        }
                        else if (WeightsType != weightsType || IndicesType != indicesType) continue;
                        var stride = data.VertexStride > 0 ? data.VertexStride : info.Stride;
                        var positionAt = info.GetComponentOffset(0);
                        var weightsAt = info.GetComponentOffset(1);
                        var indicesAt = info.GetComponentOffset(2);
                        var boneIds = geometry!.BoneIds;
                        var bytes = data.VertexBytes;
                        for (var vertex = 0; vertex < data.VertexCount; vertex += 1)
                        {
                            var at = vertex * stride;
                            var position = new Vector3(BitConverter.ToSingle(bytes, at + positionAt), BitConverter.ToSingle(bytes, at + positionAt + 4), BitConverter.ToSingle(bytes, at + positionAt + 8));
                            var mapped = new byte[4];
                            var usable = true;
                            for (var slot = 0; slot < 4; slot += 1)
                            {
                                int raw = bytes[at + indicesAt + slot];
                                var bone = boneIds is { Length: > 0 } ? (raw < boneIds.Length ? boneIds[raw] : -1) : raw;
                                if (bone is < 0 or > 255) usable = false;
                                else mapped[slot] = (byte)bone;
                            }
                            if (!usable) continue;
                            var index = positions.Count;
                            positions.Add(position);
                            for (var slot = 0; slot < 4; slot += 1) weights.Add(bytes[at + weightsAt + slot]);
                            indices.AddRange(mapped);
                            var key = CellOf(position);
                            if (!cells.TryGetValue(key, out var list)) cells[key] = list = [];
                            list.Add(index);
                        }
                    }
                }
            weightsArray = null;
            indicesArray = null;
        }

        private static (int, int, int) CellOf(Vector3 position) =>
            ((int)MathF.Floor(position.X / Cell), (int)MathF.Floor(position.Y / Cell), (int)MathF.Floor(position.Z / Cell));

        /// <summary>Ближайшая вершина тела: кольцами клеток, как у кадра; дальше кольца — перебором.</summary>
        public int Nearest(Vector3 point, out bool far)
        {
            far = false;
            var (cx, cy, cz) = CellOf(point);
            var best = -1;
            var bestDistance = float.PositiveInfinity;
            for (var ring = 0; ring <= MaxRing; ring += 1)
            {
                for (var dx = -ring; dx <= ring; dx += 1)
                    for (var dy = -ring; dy <= ring; dy += 1)
                        for (var dz = -ring; dz <= ring; dz += 1)
                        {
                            if (Math.Max(Math.Abs(dx), Math.Max(Math.Abs(dy), Math.Abs(dz))) != ring) continue;
                            if (!cells.TryGetValue((cx + dx, cy + dy, cz + dz), out var list)) continue;
                            foreach (var index in list)
                            {
                                var distance = Vector3.DistanceSquared(positions[index], point);
                                if (distance < bestDistance)
                                {
                                    bestDistance = distance;
                                    best = index;
                                }
                            }
                        }
                if (best >= 0 && bestDistance <= (ring * Cell) * (ring * Cell)) return best;
            }
            if (best >= 0) return best;
            far = true;
            for (var index = 0; index < positions.Count; index += 1)
            {
                var distance = Vector3.DistanceSquared(positions[index], point);
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    best = index;
                }
            }
            return best;
        }
    }

    private sealed class SkinRequest
    {
        public string? Format { get; set; }
        public int Version { get; set; }
        public string? Model { get; set; }
        public string[]? References { get; set; }
    }
}
