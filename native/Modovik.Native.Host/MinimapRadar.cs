using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using RageLib.Archives;
using RageLib.GTA5.ArchiveWrappers;

namespace Modovik.Native.Host;

/// <summary>
/// Мини-карта в углу экрана (радар) в цветах большой карты.
///
/// Радар GTA V рисует не картинку, а векторные плитки
/// `levels/gta5/minimap.rpf/minimap_X_Y.ydd`: суша, вода, застройка и дороги
/// треугольниками с цветом в каждой вершине. Картинку большой карты он
/// подкладывает только при отдалении, поэтому перекрашенная карта в углу
/// экрана оставалась штатной.
///
/// ПОЧЕМУ НЕ «УБРАТЬ ВЕКТОРЫ»
///
/// Первая попытка (22.09) отдавала игре те же плитки с вычищенными моделями:
/// словарь на месте, а список моделей у рисовалки пуст. Игра такую рисовалку
/// не переживает — у неё остаются габариты, она проходит отсечение, и движок
/// идёт по нулевому списку моделей. Игра падала при входе в мир. Пустая
/// рисовалка — форма, которой нет ни в одном файле Rockstar, и проверить её
/// можно было только самой игрой.
///
/// Здесь плитки не выпотрошены, а ПЕРЕКРАШЕНЫ: каждая вершина получает цвет
/// из палитры большой карты. Меняются ровно четыре байта цвета на вершину —
/// число моделей, геометрий, вершин, индексов, шейдеры и габариты остаются
/// байт в байт теми же. Так же поступают сборки карт сообщества, которые
/// «работают и в радаре», и так устроен мод, который приносил владелец.
///
/// Цвет решает не этот файл: он отдаёт наружу список найденных цветов, окно
/// проводит их через тот же конвейер перекраски, что и растровые плитки
/// (`@modovik/vector-map/raster.js`), и возвращает пары «было → стало». Одна
/// палитра на карту паузы и на радар — иначе они разошлись бы по цвету.
/// </summary>
internal static partial class MinimapRadar
{
    private const int MaxDepth = 6;

    /// <summary>Векторная плитка — единицы килобайт; мегабайты означают «не тот файл».</summary>
    private const long MaxTileBytes = 16 * 1024 * 1024;

    /// <summary>Штатных плиток 65; больше сотни — чужой или сломанный набор.</summary>
    private const int MaxTiles = 256;

    /// <summary>Цветов в векторных плитках два десятка; сотня — уже не палитра.</summary>
    private const int MaxColours = 512;

    private static readonly Regex TilePath = new(
        @"(^|/)levels/gta5/minimap\.rpf/minimap_\d+_\d+\.ydd$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    internal sealed record FoundFile(string Archive, string Entry, string FileName, byte[] Bytes);

    private static void Walk(
        IArchiveDirectory directory,
        string prefix,
        int depth,
        Action<IArchiveFile, string> onFile)
    {
        if (directory is null || depth > MaxDepth) return;
        foreach (var file in directory.GetFiles())
        {
            var path = prefix + file.Name;
            if (file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase) &&
                file is IArchiveBinaryFile binary)
            {
                RageArchiveWrapper7? nested = null;
                try
                {
                    nested = RageArchiveWrapper7.Open(binary.GetStream(), file.Name);
                    Walk(nested.Root, path + "/", depth + 1, onFile);
                }
                catch (Exception)
                {
                    // Чужой или повреждённый вложенный архив не обрывает обход.
                }
                finally
                {
                    nested?.Dispose();
                }
                continue;
            }
            onFile(file, path);
        }
        foreach (var child in directory.GetDirectories())
            Walk(child, prefix + child.Name + "/", depth + 1, onFile);
    }

    private static byte[] Read(IArchiveFile file)
    {
        using var buffer = new MemoryStream();
        file.Export(buffer);
        return buffer.ToArray();
    }

    /// <summary>Плитки радара из первого архива, где они нашлись.</summary>
    private static List<FoundFile> FindTiles(string gameRoot, IEnumerable<string> archives)
    {
        var found = new List<FoundFile>();
        foreach (var relative in archives)
        {
            var full = Path.Combine(gameRoot, relative);
            if (!File.Exists(full)) continue;
            try
            {
                using var archive = RageArchiveWrapper7.OpenRead(full);
                Walk(archive.Root, "", 0, (file, path) =>
                {
                    if (found.Count >= MaxTiles || !TilePath.IsMatch(path)) return;
                    var bytes = Read(file);
                    if (bytes.Length == 0 || bytes.Length > MaxTileBytes) return;
                    found.Add(new FoundFile(
                        relative.Replace(Path.DirectorySeparatorChar, '/'),
                        path,
                        file.Name,
                        bytes));
                });
            }
            catch (Exception)
            {
                // Занятый или чужой архив не отменяет поиска в остальных.
            }
            if (found.Count > 0) break;
        }
        return found;
    }

    private static string Sha256(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    /*
     * Где в вершине лежит цвет.
     *
     * Раскладка вершины описана самим файлом: `Flags` говорит, какие поля
     * есть, `Types` — какого они рода, по четыре бита на поле. Цвет — поле с
     * номером 4 (`Colour0`), и его смещение считается суммой размеров полей
     * до него. Зашивать 12 байт числом нельзя: у чужих плиток раскладка
     * бывает другой, и патч лёг бы в координаты.
     */
    private static int ColourOffset(VertexDeclaration declaration)
    {
        var offset = 0;
        for (var index = 0; index < 16; index++)
        {
            if (((declaration.Flags >> index) & 1) == 0) continue;
            if (index == 4) return offset;
            var type = (VertexComponentType)(int)((((ulong)declaration.Types) >> (4 * index)) & 0xF);
            offset += VertexComponentTypes.GetSizeInBytes(type);
        }
        return -1;
    }

    /// <summary>Байты вершин геометрии и смещение цвета в них; null — красить нечего.</summary>
    private static (byte[] Data, int Stride, int Offset, int Count)? VertexColours(DrawableGeometry geometry)
    {
        var buffer = geometry?.VertexBuffer;
        var data = buffer?.Data1 ?? buffer?.Data2;
        var bytes = data?.VertexBytes;
        var declaration = buffer?.Info;
        if (bytes is null || declaration is null) return null;
        var offset = ColourOffset(declaration);
        int stride = declaration.Stride;
        if (offset < 0 || stride <= 0) return null;
        var count = (int)Math.Min(buffer!.VertexCount, bytes.Length / (uint)stride);
        return (bytes, stride, offset, count);
    }

    private static IEnumerable<DrawableGeometry> Geometries(YddFile ydd)
    {
        foreach (var drawable in ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>())
        foreach (var model in drawable?.AllModels ?? Array.Empty<DrawableModel>())
        foreach (var geometry in model?.Geometries ?? Array.Empty<DrawableGeometry>())
            if (geometry is not null)
                yield return geometry;
    }

    /// <summary>Цвет вершины как «RRGGBBAA» — в том же порядке, в каком лежит в буфере.</summary>
    private static string Hex(byte[] data, int at) =>
        $"{data[at]:X2}{data[at + 1]:X2}{data[at + 2]:X2}{data[at + 3]:X2}";

    /// <summary>
    /// Палитра векторных плиток игрока: какие цвета в них есть и сколько
    /// вершин каждого. Окно красит эти цвета тем же конвейером, что и
    /// растровую карту, и возвращает пары для `PaintTiles`.
    /// </summary>
    internal static object TileColours(string gameRoot, IEnumerable<string> archives)
    {
        var tiles = FindTiles(gameRoot, archives);
        if (tiles.Count == 0)
            throw new FileNotFoundException(
                "Векторные плитки радара (levels/gta5/minimap.rpf) не найдены в архивах игры.");

        var counts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var vertices = 0L;
        foreach (var tile in tiles)
        {
            var ydd = new YddFile();
            ydd.Load(tile.Bytes);
            foreach (var geometry in Geometries(ydd))
            {
                var found = VertexColours(geometry);
                if (found is not { } colours) continue;
                for (var index = 0; index < colours.Count; index++)
                {
                    var at = index * colours.Stride + colours.Offset;
                    if (at + 4 > colours.Data.Length) break;
                    var key = Hex(colours.Data, at);
                    counts.TryGetValue(key, out var seen);
                    counts[key] = seen + 1;
                    vertices += 1;
                }
            }
        }
        if (counts.Count == 0)
            throw new InvalidDataException("В векторных плитках радара нет цвета в вершинах.");
        if (counts.Count > MaxColours)
            throw new InvalidDataException(
                $"В векторных плитках радара {counts.Count} цветов — это не карта Rockstar.");
        return new
        {
            tiles = tiles.Count,
            vertices,
            source = new
            {
                archive = tiles[0].Archive,
                entry = Path.GetDirectoryName(tiles[0].Entry)?.Replace('\\', '/'),
            },
            colours = counts
                .OrderByDescending(pair => pair.Value)
                .Select(pair => new { rgba = pair.Key, vertices = pair.Value })
                .ToArray(),
        };
    }

    /// <summary>
    /// Перекрашивает векторные плитки радара, дописывает в них слои большой
    /// карты и выкладывает результат файлами.
    ///
    /// Перекраска меняет только байты цвета: всё остальное — счётчики,
    /// указатели, шейдеры, габариты — остаётся тем, что написал Rockstar.
    /// Слои дописываются ПОСЛЕ перекраски и отдельной моделью
    /// (`MinimapRadar.Overlay.cs`), поэтому пары цветов их не задевают.
    /// Плитка, в которой ничего не изменилось, не выкладывается вовсе:
    /// отдавать игре копию её же файла незачем.
    /// </summary>
    internal static object PaintTiles(
        string gameRoot,
        IEnumerable<string> archives,
        IReadOnlyDictionary<string, string> colours,
        string output,
        IReadOnlyList<string>? overlayFiles = null)
    {
        var overlayPaths = overlayFiles ?? Array.Empty<string>();
        if (colours.Count == 0 && overlayPaths.Count == 0)
            throw new ArgumentException("Не передано ни одной пары цветов и ни одного слоя.");
        if (colours.Count > MaxColours)
            throw new ArgumentException("Слишком много цветов в одном запросе.");
        Directory.CreateDirectory(output);
        var tiles = FindTiles(gameRoot, archives);
        if (tiles.Count == 0)
            throw new FileNotFoundException(
                "Векторные плитки радара (levels/gta5/minimap.rpf) не найдены в архивах игры.");

        var replacements = colours.ToDictionary(
            pair => pair.Key,
            pair => Convert.FromHexString(pair.Value),
            StringComparer.OrdinalIgnoreCase);

        var ordered = tiles.OrderBy(item => item.FileName, StringComparer.OrdinalIgnoreCase).ToList();
        var overlay = overlayPaths.Count == 0 ? null : MergeOverlays(overlayPaths.Select(ReadOverlay).ToList());
        var loaded = ordered.Select(tile =>
        {
            var ydd = new YddFile();
            ydd.Load(tile.Bytes);
            return ydd;
        }).ToList();
        (List<int>[] PerTile, int Outside)? routing = null;
        if (overlay is not null)
            routing = Route(overlay, loaded.Select(item => (TileBox?)TileBounds(item)).ToList());

        var written = new List<object>();
        var skipped = 0;
        long painted = 0;
        long overlayTriangles = 0, overlayVertices = 0, overlayGeometries = 0, noLand = 0;
        var overlayTiles = 0;
        for (var at = 0; at < ordered.Count; at++)
        {
            var tile = ordered[at];
            var ydd = loaded[at];
            var touched = 0L;
            var vertices = 0L;
            /*
             * Рисовалка суши ищется ДО перекраски: воду отличает цвет не серый, а после
             * перекраски не серая вся суша. Иначе на цветной карте у плиток не находилось
             * суши, и зоны в них не ложились: на мини-карте они выглядели обрезанными,
             * а то и пропадали совсем (01.11.2026, 163 тыс. треугольников из 171 тыс.).
             */
            var land = overlay is null ? null : LandTarget(ydd);
            foreach (var geometry in Geometries(ydd))
            {
                var found = VertexColours(geometry);
                if (found is not { } buffer) continue;
                for (var index = 0; index < buffer.Count; index++)
                {
                    var offset = index * buffer.Stride + buffer.Offset;
                    if (offset + 4 > buffer.Data.Length) break;
                    vertices += 1;
                    if (!replacements.TryGetValue(Hex(buffer.Data, offset), out var colour)) continue;
                    if (colour.Length != 4)
                        throw new InvalidDataException("Цвет задаётся четырьмя байтами: RRGGBBAA.");
                    if (buffer.Data[offset] == colour[0] && buffer.Data[offset + 1] == colour[1] &&
                        buffer.Data[offset + 2] == colour[2] && buffer.Data[offset + 3] == colour[3]) continue;
                    Array.Copy(colour, 0, buffer.Data, offset, 4);
                    touched += 1;
                }
            }
            /* Форма ДО дописывания: по ней сверяется перечитанный файл. */
            var shapeBefore = ShapeCounts(ydd);
            var appended = new AppendReport(0, 0, 0);
            var built = new List<BuiltGeometry>();
            Drawable? target = null;
            if (overlay is not null && routing is { } route && route.PerTile[at].Count > 0)
            {
                (appended, built, target) = AppendOverlay(ydd, land, overlay, route.PerTile[at]);
                if (appended.Skipped is not null) noLand += route.PerTile[at].Count;
            }
            if (touched == 0 && appended.Triangles == 0)
            {
                skipped += 1;
                continue;
            }
            var bytes = ydd.Save();
            if (bytes is null || bytes.Length == 0)
                throw new InvalidDataException($"Не удалось собрать плитку {tile.FileName}.");

            /*
             * Перечитывание до записи — не ритуал: игру этим файлом можно
             * уронить, а единственная дешёвая проверка — сошлась ли форма.
             * Сверяется всё, что мы НЕ трогали: число рисовалок, моделей,
             * геометрий, вершин и индексов; к ним прибавляется ровно то,
             * что дописано.
             */
            var check = new YddFile();
            check.Load(bytes);
            var wanted = appended.Triangles > 0
                ? new ShapeNumbers(
                    shapeBefore.Drawables,
                    shapeBefore.Models + 1,
                    shapeBefore.Geometries + appended.Geometries,
                    shapeBefore.Vertices + appended.Vertices,
                    shapeBefore.Indices + appended.Triangles * 3L)
                : shapeBefore;
            var after = ShapeCounts(check);
            if (wanted != after)
                throw new InvalidDataException(
                    $"Плитка {tile.FileName} изменила форму: ждали {wanted.Text}, получили {after.Text}.");
            /*
             * Инвариант, который нарушали пустые плитки. Байт флага уровня
             * детализации говорит «здесь есть модели», и игра верит ему, а не
             * указателю: с флагом 1 и нулевым списком она разыменовывает
             * пустоту при первом же кадре радара. CodeWalker при записи
             * пересчитывает указатели, но флаги оставляет как были — поэтому
             * сверка здесь, по перечитанному файлу, а не в доверии к нему.
             */
            var mismatch = LodMismatch(check);
            if (mismatch is not null)
                throw new InvalidDataException(
                    $"Плитка {tile.FileName} расходится с игрой: {mismatch}.");
            if (appended.Triangles > 0 && target is not null)
            {
                var original = new YddFile();
                original.Load(tile.Bytes);
                VerifyAppended(tile.FileName, original, DrawableIndex(ydd, target), check, built, bytes.Length);
            }

            File.WriteAllBytes(Path.Combine(output, tile.FileName), bytes);
            painted += touched;
            if (appended.Triangles > 0)
            {
                overlayTiles += 1;
                overlayTriangles += appended.Triangles;
                overlayVertices += appended.Vertices;
                overlayGeometries += appended.Geometries;
            }
            written.Add(new
            {
                file = tile.FileName,
                archive = tile.Archive,
                entry = tile.Entry,
                vertices,
                repainted = touched,
                overlay = appended.Triangles > 0
                    ? new { triangles = appended.Triangles, vertices = appended.Vertices, geometries = appended.Geometries }
                    : null,
                bytes = bytes.Length,
                sha256 = Sha256(bytes),
            });
        }
        return new
        {
            output,
            count = written.Count,
            skipped,
            repainted = painted,
            source = new
            {
                archive = tiles[0].Archive,
                entry = Path.GetDirectoryName(tiles[0].Entry)?.Replace('\\', '/'),
            },
            overlay = overlay is null || routing is not { } routed
                ? null
                : new
                {
                    triangles = (long)overlay.Triangles,
                    routed = routed.PerTile.Sum(list => (long)list.Count) - noLand,
                    tiles = overlayTiles,
                    vertices = overlayVertices,
                    geometries = overlayGeometries,
                    written = overlayTriangles,
                    dropped = new { outside = routed.Outside, noLand },
                },
            tiles = written.ToArray(),
        };
    }

    // `PositionOffset` — в MinimapRadar.Inspect.cs (то же правило: позиция — Float3 в поле 0).

    private sealed class ColourStats
    {
        public long Vertices;
        public float ZMin = float.MaxValue;
        public float ZMax = float.MinValue;
        public readonly SortedDictionary<float, long> Heights = new();
    }

    /// <summary>
    /// ТОЛЬКО ЧТЕНИЕ. Какие у плиток радара высоты по цветам, есть ли
    /// негоризонтальные («стенки») треугольники, какие шейдеры и раскладки
    /// вершин, какие габариты рисовалок. Нужно, чтобы не гадать, как устроена
    /// штатная геометрия, прежде чем её поднимать или выдавливать
    /// (исследование 21.11.2026, `docs/handoff/MAP-3D-STUDY-2111.md`).
    /// </summary>
    internal static object InspectTiles(string gameRoot, IEnumerable<string> archives)
    {
        var tiles = FindTiles(gameRoot, archives);
        if (tiles.Count == 0)
            throw new FileNotFoundException(
                "Векторные плитки радара (levels/gta5/minimap.rpf) не найдены в архивах игры.");

        var colours = new Dictionary<string, ColourStats>(StringComparer.OrdinalIgnoreCase);
        var layouts = new Dictionary<string, long>();
        var shaders = new Dictionary<string, long>();
        var samples = new List<object>();
        long drawables = 0, geometries = 0, vertices = 0, triangles = 0, notFlat = 0, mixedColour = 0;
        long vertexBytes = 0, tileBytes = 0;
        var boxMinZ = float.MaxValue;
        var boxMaxZ = float.MinValue;
        foreach (var tile in tiles.OrderBy(item => item.FileName, StringComparer.OrdinalIgnoreCase))
        {
            tileBytes += tile.Bytes.Length;
            var ydd = new YddFile();
            ydd.Load(tile.Bytes);
            foreach (var drawable in ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>())
            {
                if (drawable is null) continue;
                drawables += 1;
                boxMinZ = Math.Min(boxMinZ, drawable.BoundingBoxMin.Z);
                boxMaxZ = Math.Max(boxMaxZ, drawable.BoundingBoxMax.Z);
                if (samples.Count < 4)
                    samples.Add(new
                    {
                        tile = tile.FileName,
                        boxMin = new[] { drawable.BoundingBoxMin.X, drawable.BoundingBoxMin.Y, drawable.BoundingBoxMin.Z },
                        boxMax = new[] { drawable.BoundingBoxMax.X, drawable.BoundingBoxMax.Y, drawable.BoundingBoxMax.Z },
                        radius = drawable.BoundingSphereRadius,
                        models = drawable.AllModels?.Length ?? 0,
                    });
            }
            foreach (var geometry in Geometries(ydd))
            {
                geometries += 1;
                var shader = geometry.Shader?.FileName.ToString() ?? "?";
                shaders[shader] = shaders.GetValueOrDefault(shader) + 1;
                var buffer = geometry.VertexBuffer;
                var data = buffer?.Data1 ?? buffer?.Data2;
                var bytes = data?.VertexBytes;
                var declaration = buffer?.Info;
                if (bytes is null || declaration is null) continue;
                var layout = string.Create(
                    CultureInfo.InvariantCulture,
                    $"flags=0x{declaration.Flags:X} types=0x{(ulong)declaration.Types:X} stride={declaration.Stride}");
                layouts[layout] = layouts.GetValueOrDefault(layout) + 1;
                int stride = declaration.Stride;
                var colourAt = ColourOffset(declaration);
                var positionAt = PositionOffset(declaration);
                if (stride <= 0 || colourAt < 0 || positionAt < 0) continue;
                var count = (int)Math.Min(buffer!.VertexCount, bytes.Length / (uint)stride);
                vertexBytes += bytes.Length;
                for (var index = 0; index < count; index++)
                {
                    var z = BitConverter.ToSingle(bytes, index * stride + positionAt + 8);
                    var key = Hex(bytes, index * stride + colourAt);
                    if (!colours.TryGetValue(key, out var stats)) colours[key] = stats = new ColourStats();
                    stats.Vertices += 1;
                    stats.ZMin = Math.Min(stats.ZMin, z);
                    stats.ZMax = Math.Max(stats.ZMax, z);
                    var bucket = MathF.Round(z * 2f) / 2f;
                    stats.Heights[bucket] = stats.Heights.GetValueOrDefault(bucket) + 1;
                    vertices += 1;
                }
                var indices = geometry.IndexBuffer?.Indices;
                if (indices is null) continue;
                for (var at = 0; at + 2 < indices.Length; at += 3)
                {
                    int a = indices[at], b = indices[at + 1], c = indices[at + 2];
                    if (a >= count || b >= count || c >= count) continue;
                    triangles += 1;
                    var za = BitConverter.ToSingle(bytes, a * stride + positionAt + 8);
                    var zb = BitConverter.ToSingle(bytes, b * stride + positionAt + 8);
                    var zc = BitConverter.ToSingle(bytes, c * stride + positionAt + 8);
                    if (Math.Max(za, Math.Max(zb, zc)) - Math.Min(za, Math.Min(zb, zc)) > 0.01f) notFlat += 1;
                    if (Hex(bytes, a * stride + colourAt) != Hex(bytes, b * stride + colourAt) ||
                        Hex(bytes, a * stride + colourAt) != Hex(bytes, c * stride + colourAt)) mixedColour += 1;
                }
            }
        }
        return new
        {
            tiles = tiles.Count,
            tileBytes,
            drawables,
            geometries,
            vertices,
            vertexBytes,
            triangles,
            notFlatTriangles = notFlat,
            mixedColourTriangles = mixedColour,
            drawableBoxZ = new[] { boxMinZ, boxMaxZ },
            layouts = layouts.Select(pair => new { layout = pair.Key, geometries = pair.Value }).ToArray(),
            shaders = shaders.Select(pair => new { shader = pair.Key, geometries = pair.Value }).ToArray(),
            samples = samples.ToArray(),
            colours = colours
                .OrderByDescending(pair => pair.Value.Vertices)
                .Select(pair => new
                {
                    rgba = pair.Key,
                    vertices = pair.Value.Vertices,
                    zMin = pair.Value.ZMin,
                    zMax = pair.Value.ZMax,
                    heights = pair.Value.Heights
                        .OrderByDescending(item => item.Value)
                        .Take(8)
                        .Select(item => new { z = item.Key, vertices = item.Value })
                        .ToArray(),
                })
                .ToArray(),
        };
    }

    /// <summary>
    /// ПРОБА «приподнятые кварталы» (исследование 21.11.2026). Поднимает на
    /// `dz` высоту вершин нужного цвета (и, если задана, высотного окна
    /// `zFrom…zTo`), при желании перекрашивает именно поднятые (`tints`).
    /// Число вершин, индексов, геометрий и рисовалок НЕ меняется — тот же
    /// безопасный класс правки, что у <see cref="PaintTiles"/> (меняются байты
    /// самих вершин), поэтому сверка формы и флагов уровней детализации после
    /// записи та же. Габариты поднятого (`BoundsData` моделей, рамка и шар
    /// рисовалки) расширяются вверх: иначе отсечение могло бы спрятать
    /// поднятое. Это проба, а не готовая возможность: в приложение команда не
    /// подключена.
    /// </summary>
    internal static object LiftTiles(
        string gameRoot,
        IEnumerable<string> archives,
        IReadOnlyDictionary<string, float> lifts,
        IReadOnlyDictionary<string, string> tints,
        float? zFrom,
        float? zTo,
        string output)
    {
        if (lifts.Count == 0)
            throw new ArgumentException("Не передано ни одного цвета для подъёма.");
        if (lifts.Count > MaxColours)
            throw new ArgumentException("Слишком много цветов в одном запросе.");
        Directory.CreateDirectory(output);
        var tiles = FindTiles(gameRoot, archives);
        if (tiles.Count == 0)
            throw new FileNotFoundException(
                "Векторные плитки радара (levels/gta5/minimap.rpf) не найдены в архивах игры.");

        var tintBytes = tints.ToDictionary(
            pair => pair.Key,
            pair => Convert.FromHexString(pair.Value),
            StringComparer.OrdinalIgnoreCase);
        var delta = lifts.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);

        var written = new List<object>();
        var skipped = 0;
        long liftedTotal = 0;
        foreach (var tile in tiles.OrderBy(item => item.FileName, StringComparer.OrdinalIgnoreCase))
        {
            var ydd = new YddFile();
            ydd.Load(tile.Bytes);
            var lifted = 0L;
            var vertices = 0L;
            var topZ = float.MinValue;
            var biggest = 0f;
            foreach (var drawable in ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>())
            {
                if (drawable is null) continue;
                var drawableTop = float.MinValue;
                foreach (var model in drawable.AllModels ?? Array.Empty<DrawableModel>())
                {
                    if (model is null) continue;
                    var modelTop = float.MinValue;
                    foreach (var geometry in model.Geometries ?? Array.Empty<DrawableGeometry>())
                    {
                        if (geometry is null) continue;
                        var buffer = geometry.VertexBuffer;
                        var data = buffer?.Data1 ?? buffer?.Data2;
                        var bytes = data?.VertexBytes;
                        var declaration = buffer?.Info;
                        if (bytes is null || declaration is null) continue;
                        int stride = declaration.Stride;
                        var colourAt = ColourOffset(declaration);
                        var positionAt = PositionOffset(declaration);
                        if (stride <= 0 || colourAt < 0 || positionAt < 0) continue;
                        var count = (int)Math.Min(buffer!.VertexCount, bytes.Length / (uint)stride);
                        var geometryTop = float.MinValue;
                        for (var index = 0; index < count; index++)
                        {
                            vertices += 1;
                            var colour = index * stride + colourAt;
                            if (colour + 4 > bytes.Length) break;
                            var key = Hex(bytes, colour);
                            if (!delta.TryGetValue(key, out var rise)) continue;
                            var heightAt = index * stride + positionAt + 8;
                            var z = BitConverter.ToSingle(bytes, heightAt);
                            if (zFrom is { } lowest && z < lowest) continue;
                            if (zTo is { } highest && z > highest) continue;
                            var next = z + rise;
                            BitConverter.GetBytes(next).CopyTo(bytes, heightAt);
                            if (tintBytes.TryGetValue(key, out var tint))
                            {
                                if (tint.Length != 4)
                                    throw new InvalidDataException("Цвет задаётся четырьмя байтами: RRGGBBAA.");
                                Array.Copy(tint, 0, bytes, colour, 4);
                            }
                            lifted += 1;
                            geometryTop = Math.Max(geometryTop, next);
                            biggest = Math.Max(biggest, Math.Abs(rise));
                        }
                        if (geometryTop == float.MinValue) continue;
                        modelTop = Math.Max(modelTop, geometryTop);
                        var box = geometry.AABB;
                        geometry.AABB = new AABB_s
                        {
                            Min = box.Min,
                            Max = new SharpDX.Vector4(box.Max.X, box.Max.Y, Math.Max(box.Max.Z, geometryTop), box.Max.W),
                        };
                    }
                    if (modelTop == float.MinValue) continue;
                    drawableTop = Math.Max(drawableTop, modelTop);
                    if (model.BoundsData is { } boxes)
                        for (var at = 0; at < boxes.Length; at++)
                            boxes[at] = new AABB_s
                            {
                                Min = boxes[at].Min,
                                Max = new SharpDX.Vector4(
                                    boxes[at].Max.X, boxes[at].Max.Y,
                                    Math.Max(boxes[at].Max.Z, modelTop), boxes[at].Max.W),
                            };
                }
                if (drawableTop == float.MinValue) continue;
                topZ = Math.Max(topZ, drawableTop);
                var max = drawable.BoundingBoxMax;
                drawable.BoundingBoxMax = new SharpDX.Vector3(max.X, max.Y, Math.Max(max.Z, drawableTop));
                drawable.BoundingSphereRadius += biggest;
            }
            if (lifted == 0)
            {
                skipped += 1;
                continue;
            }
            var saved = ydd.Save();
            if (saved is null || saved.Length == 0)
                throw new InvalidDataException($"Не удалось собрать плитку {tile.FileName}.");
            var check = new YddFile();
            check.Load(saved);
            var before = Shape(ydd);
            var after = Shape(check);
            if (before != after)
                throw new InvalidDataException(
                    $"Плитка {tile.FileName} с поднятыми вершинами изменила форму: {before} → {after}.");
            var mismatch = LodMismatch(check);
            if (mismatch is not null)
                throw new InvalidDataException(
                    $"Плитка {tile.FileName} с поднятыми вершинами расходится с игрой: {mismatch}.");

            File.WriteAllBytes(Path.Combine(output, tile.FileName), saved);
            liftedTotal += lifted;
            written.Add(new
            {
                file = tile.FileName,
                archive = tile.Archive,
                entry = tile.Entry,
                vertices,
                lifted,
                topZ,
                bytes = saved.Length,
                sha256 = Sha256(saved),
            });
        }
        return new
        {
            output,
            count = written.Count,
            skipped,
            lifted = liftedTotal,
            source = new
            {
                archive = tiles[0].Archive,
                entry = Path.GetDirectoryName(tiles[0].Entry)?.Replace('\\', '/'),
            },
            tiles = written.ToArray(),
        };
    }

    /// <summary>Сетка высот зданий по миру: клетка → метры (`scripts/build-block-heights.mjs`).</summary>
    internal sealed class HeightGrid
    {
        public double X0, Y0, Cell;
        public int Cols, Rows;
        public int[] Values = Array.Empty<int>();
        public int Fallback = 12;

        public int Sample(double x, double y)
        {
            var column = (int)Math.Floor((x - X0) / Cell);
            var row = (int)Math.Floor((Y0 - y) / Cell);
            if (column < 0 || row < 0 || column >= Cols || row >= Rows) return Fallback;
            var value = Values[row * Cols + column];
            return value > 0 ? value : Fallback;
        }
    }

    private static double Hash01(double x, double y)
    {
        var h = Math.Sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return h - Math.Floor(h);
    }

    /// <summary>Высота квартала: район (сетка) × множитель площади × стабильный разброс ±22 %.</summary>
    internal static double BlockHeight(HeightGrid? grid, double centreX, double centreY, double area, double scale = 1.0)
    {
        double basis = grid?.Sample(centreX, centreY) ?? 24;
        var byArea = area < 120 ? 0.45 : area < 500 ? 0.75 : area < 4000 ? 1.0 : area < 15000 ? 0.8 : area < 40000 ? 0.55 : 0.4;
        var jitter = 0.78 + 0.44 * Hash01(centreX * 0.173, centreY * 0.097);
        return Math.Clamp(basis * byArea * jitter * scale, 4.0, 140.0);
    }

    private static byte Grey(double value) => (byte)Math.Clamp((int)Math.Round(value), 0, 255);

    /// <summary>Перекраска байтов цвета вершин по парам «было → стало» (как <see cref="PaintTiles"/>), на месте. Возвращает число изменённых вершин.</summary>
    private static long Recolour(byte[] bytes, int count, int stride, int colourAt, IReadOnlyDictionary<string, byte[]>? paint)
    {
        if (paint is null || paint.Count == 0) return 0;
        long touched = 0;
        for (var index = 0; index < count; index++)
        {
            var at = index * stride + colourAt;
            if (at + 4 > bytes.Length) break;
            if (!paint.TryGetValue(Hex(bytes, at), out var colour) || colour.Length != 4) continue;
            if (bytes[at] == colour[0] && bytes[at + 1] == colour[1] && bytes[at + 2] == colour[2] && bytes[at + 3] == colour[3]) continue;
            Array.Copy(colour, 0, bytes, at, 4);
            touched += 1;
        }
        return touched;
    }

    /// <summary>Яркость цвета квартала 0…1: решает, у тёмной карты стенки светлеют, у светлой — темнеют (как здания на карте из ролика: светлые крыши на тёмном).</summary>
    private static double Brightness(byte[] c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255.0;

    /// <summary>Стенка: цвет квартала, на тёмной карте светлее его (внизу чуть, вверху заметно), на светлой — темнее. Оттенок палитры карты сохраняется; крыша всегда светлее стенки.</summary>
    private static (byte R, byte G, byte B) WallColour(byte[] baseColour, double share, double tall)
    {
        if (Brightness(baseColour) < 0.5)
        {
            var lift = 0.08 + (0.22 + 0.10 * tall) * share;
            return (Grey(baseColour[0] + (255 - baseColour[0]) * lift), Grey(baseColour[1] + (255 - baseColour[1]) * lift), Grey(baseColour[2] + (255 - baseColour[2]) * lift));
        }
        var factor = 0.62 + 0.20 * share;
        return (Grey(baseColour[0] * factor), Grey(baseColour[1] * factor), Grey(baseColour[2] * factor));
    }

    /// <summary>Крыша: на тёмной карте цвет квартала, сильно осветлённый к белому (светлый верх на тёмном ground); на светлой — почти белый. Выше квартал — светлее.</summary>
    private static (byte R, byte G, byte B) RoofColour(byte[] baseColour, double tall)
    {
        var lift = Brightness(baseColour) < 0.5 ? 0.55 + 0.10 * tall : 0.45 + 0.10 * tall;
        return (Grey(baseColour[0] + (255 - baseColour[0]) * lift), Grey(baseColour[1] + (255 - baseColour[1]) * lift), Grey(baseColour[2] + (255 - baseColour[2]) * lift));
    }

    /// <summary>
    /// ПРОБА «здания со стенками» (исследование 21.11.2026). К каждому кварталу (связной группе треугольников цвета «кварталы» на высоте
    /// окна `zFrom…zTo`) добавляются копии его треугольников на высотах до крыши: нижние — цветом стенки (от тёмного к светлому вверх),
    /// верхняя — цветом крыши (светлее у высоких). Под наклоном камеры радара стопка даёт стенку, как стопка слоёв в картинке
    /// (`packages/vector-map/volume.js`). В отличие от <see cref="LiftTiles"/> здесь геометрия РАСТЁТ: число вершин и индексов больше
    /// прежнего, поэтому проверка после записи — не «форма та же», а «столько, сколько добавили», плюс сверка флагов уровней детализации.
    /// Индексы плитки — 16-битные: слоёв столько, чтобы вершин в одной геометрии не стало больше 65 000 (иначе слоёв меньше).
    /// </summary>
    internal static object StackTiles(
        string gameRoot,
        IEnumerable<string> archives,
        IReadOnlySet<string> blockColours,
        float zFrom,
        float zTo,
        HeightGrid? grid,
        double spacing,
        int maxLayers,
        string output,
        IReadOnlyDictionary<string, byte[]>? blockFinal = null,
        IReadOnlyDictionary<string, byte[]>? paint = null,
        double heightScale = 1.0)
    {
        if (blockColours.Count == 0)
            throw new ArgumentException("Не передано ни одного цвета кварталов.");
        Directory.CreateDirectory(output);
        var tiles = FindTiles(gameRoot, archives);
        if (tiles.Count == 0)
            throw new FileNotFoundException(
                "Векторные плитки радара (levels/gta5/minimap.rpf) не найдены в архивах игры.");
        const int VertexLimit = 65000;

        var written = new List<object>();
        var skipped = 0;
        long blocksTotal = 0, addedVerticesTotal = 0, addedIndicesTotal = 0, repaintedTotal = 0;
        var heightBuckets = new SortedDictionary<int, long>();
        var layerBuckets = new SortedDictionary<int, long>();
        var reducedGeometries = 0;
        var largest = 0;
        foreach (var tile in tiles.OrderBy(item => item.FileName, StringComparer.OrdinalIgnoreCase))
        {
            var ydd = new YddFile();
            ydd.Load(tile.Bytes);
            var before = Shape(ydd);
            long addedVertices = 0, addedIndices = 0, blocks = 0, repainted = 0;
            foreach (var drawable in ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>())
            {
                if (drawable is null) continue;
                var drawableTop = float.MinValue;
                var biggestHeight = 0f;
                foreach (var model in drawable.AllModels ?? Array.Empty<DrawableModel>())
                {
                    if (model is null) continue;
                    var modelTop = float.MinValue;
                    foreach (var geometry in model.Geometries ?? Array.Empty<DrawableGeometry>())
                    {
                        if (geometry is null) continue;
                        var buffer = geometry.VertexBuffer;
                        var data = buffer?.Data1 ?? buffer?.Data2;
                        var bytes = data?.VertexBytes;
                        var declaration = buffer?.Info;
                        var indices = geometry.IndexBuffer?.Indices;
                        if (bytes is null || declaration is null || indices is null) continue;
                        int stride = declaration.Stride;
                        var colourAt = ColourOffset(declaration);
                        var positionAt = PositionOffset(declaration);
                        if (stride <= 0 || colourAt < 0 || positionAt < 0) continue;
                        var count = (int)Math.Min(buffer!.VertexCount, bytes.Length / (uint)stride);

                        float X(int v) => BitConverter.ToSingle(bytes, v * stride + positionAt);
                        float Y(int v) => BitConverter.ToSingle(bytes, v * stride + positionAt + 4);
                        float Z(int v) => BitConverter.ToSingle(bytes, v * stride + positionAt + 8);
                        bool IsBlock(int v) =>
                            v < count && blockColours.Contains(Hex(bytes, v * stride + colourAt)) &&
                            Z(v) >= zFrom && Z(v) <= zTo;

                        /* Треугольники-кварталы и их связность по общим точкам. */
                        var triangles = new List<(int A, int B, int C)>();
                        for (var at = 0; at + 2 < indices.Length; at += 3)
                        {
                            int a = indices[at], b = indices[at + 1], c = indices[at + 2];
                            if (IsBlock(a) && IsBlock(b) && IsBlock(c)) triangles.Add((a, b, c));
                        }
                        if (triangles.Count == 0)
                        {
                            repainted += Recolour(bytes, count, stride, colourAt, paint);
                            continue;
                        }
                        var keys = new Dictionary<long, int>();
                        var parent = new List<int>();
                        int Id(int v)
                        {
                            var key = ((long)Math.Round(X(v) * 8.0) << 32) ^ (uint)(int)Math.Round(Y(v) * 8.0);
                            if (!keys.TryGetValue(key, out var id))
                            {
                                id = parent.Count;
                                keys[key] = id;
                                parent.Add(id);
                            }
                            return id;
                        }
                        int Find(int v)
                        {
                            while (parent[v] != v)
                            {
                                parent[v] = parent[parent[v]];
                                v = parent[v];
                            }
                            return v;
                        }
                        var ids = triangles.Select(t => (Id(t.A), Id(t.B), Id(t.C))).ToList();
                        foreach (var (a, b, c) in ids)
                        {
                            parent[Find(a)] = Find(b);
                            parent[Find(b)] = Find(c);
                        }
                        var area = new Dictionary<int, double>();
                        var sumX = new Dictionary<int, double>();
                        var sumY = new Dictionary<int, double>();
                        for (var i = 0; i < triangles.Count; i++)
                        {
                            var (A, B, C) = triangles[i];
                            var root = Find(ids[i].Item1);
                            double ax = X(A), ay = Y(A), bx = X(B), by = Y(B), cx = X(C), cy = Y(C);
                            var s = Math.Abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2.0;
                            area[root] = area.GetValueOrDefault(root) + s;
                            sumX[root] = sumX.GetValueOrDefault(root) + s * (ax + bx + cx) / 3.0;
                            sumY[root] = sumY.GetValueOrDefault(root) + s * (ay + by + cy) / 3.0;
                        }
                        var height = new Dictionary<int, double>();
                        foreach (var (root, s) in area)
                        {
                            var h = BlockHeight(grid, sumX[root] / Math.Max(s, 1e-6), sumY[root] / Math.Max(s, 1e-6), s, heightScale);
                            height[root] = h;
                            blocks += 1;
                            heightBuckets[(int)(h / 10) * 10] = heightBuckets.GetValueOrDefault((int)(h / 10) * 10) + 1;
                        }
                        /* Слоёв на квартал: шаг не крупнее `spacing`, но вершин в геометрии не больше предела. */
                        var layers = height.ToDictionary(pair => pair.Key, pair => Math.Clamp((int)Math.Round(pair.Value / spacing), Math.Min(3, maxLayers), maxLayers));
                        long extra = 0;
                        for (var i = 0; i < triangles.Count; i++) extra += 3L * layers[Find(ids[i].Item1)];
                        var scale = 1.0;
                        if (count + extra > VertexLimit)
                        {
                            scale = (VertexLimit - count) / (double)extra;
                            reducedGeometries += 1;
                            foreach (var key in layers.Keys.ToList()) layers[key] = Math.Max(Math.Min(2, maxLayers), (int)(layers[key] * scale));
                            extra = 0;
                            for (var i = 0; i < triangles.Count; i++) extra += 3L * layers[Find(ids[i].Item1)];
                            if (count + extra > VertexLimit)
                            {
                                repainted += Recolour(bytes, count, stride, colourAt, paint);
                                continue;
                            }
                        }
                        foreach (var n in layers.Values) layerBuckets[n] = layerBuckets.GetValueOrDefault(n) + 1;

                        var newBytes = new byte[(count + extra) * stride];
                        Buffer.BlockCopy(bytes, 0, newBytes, 0, count * stride);
                        repainted += Recolour(newBytes, count, stride, colourAt, paint);
                        var newIndices = new List<ushort>(indices.Length + (int)extra);
                        newIndices.AddRange(indices);
                        var next = count;
                        for (var i = 0; i < triangles.Count; i++)
                        {
                            var root = Find(ids[i].Item1);
                            var h = height[root];
                            var n = layers[root];
                            var corners = new[] { triangles[i].A, triangles[i].B, triangles[i].C };
                            var z0 = Z(corners[0]);
                            var tall = Math.Clamp(h / 110.0, 0.0, 1.0);
                            /* Цвет квартала по палитре карты (`--block от=до`): стенки и крыша — его оттенки; без пары — серые, как у проб 21.11. */
                            byte[]? final = null;
                            blockFinal?.TryGetValue(Hex(bytes, corners[0] * stride + colourAt), out final);
                            for (var layer = 1; layer <= n; layer++)
                            {
                                var share = layer / (double)n;
                                var z = (float)(z0 + h * share);
                                byte r, g, b, alpha = 0xFF;
                                if (final is not null)
                                {
                                    alpha = final[3];
                                    (r, g, b) = layer == n ? RoofColour(final, tall) : WallColour(final, share, tall);
                                }
                                else if (layer == n)
                                {
                                    var roof = 150 + 86 * tall;
                                    r = g = b = Grey(roof);
                                }
                                else
                                {
                                    var wall = (60 + 40 * tall) + (70 + 60 * tall) * share;
                                    r = g = b = Grey(wall);
                                }
                                foreach (var corner in corners)
                                {
                                    var target = next * stride;
                                    Buffer.BlockCopy(bytes, corner * stride, newBytes, target, stride);
                                    BitConverter.GetBytes(z).CopyTo(newBytes, target + positionAt + 8);
                                    newBytes[target + colourAt] = r;
                                    newBytes[target + colourAt + 1] = g;
                                    newBytes[target + colourAt + 2] = b;
                                    newBytes[target + colourAt + 3] = alpha;
                                    newIndices.Add((ushort)next);
                                    next += 1;
                                }
                            }
                            modelTop = Math.Max(modelTop, (float)(z0 + h));
                            biggestHeight = Math.Max(biggestHeight, (float)h);
                        }
                        data!.VertexBytes = newBytes;
                        data.VertexCount = next;
                        buffer.VertexCount = (uint)next;
                        if (buffer.Data2 is not null && !ReferenceEquals(buffer.Data2, data))
                        {
                            buffer.Data2.VertexBytes = newBytes;
                            buffer.Data2.VertexCount = next;
                        }
                        var finalIndices = newIndices.ToArray();
                        geometry.IndexBuffer!.Indices = finalIndices;
                        geometry.IndexBuffer.IndicesCount = (uint)finalIndices.Length;
                        geometry.VerticesCount = (ushort)next;
                        geometry.IndicesCount = (uint)finalIndices.Length;
                        geometry.TrianglesCount = (uint)(finalIndices.Length / 3);
                        addedVertices += extra;
                        addedIndices += finalIndices.Length - indices.Length;
                        largest = Math.Max(largest, next);
                        var box = geometry.AABB;
                        geometry.AABB = new AABB_s
                        {
                            Min = box.Min,
                            Max = new SharpDX.Vector4(box.Max.X, box.Max.Y, Math.Max(box.Max.Z, modelTop), box.Max.W),
                        };
                    }
                    if (modelTop == float.MinValue) continue;
                    drawableTop = Math.Max(drawableTop, modelTop);
                    if (model.BoundsData is { } boxes)
                        for (var at = 0; at < boxes.Length; at++)
                            boxes[at] = new AABB_s
                            {
                                Min = boxes[at].Min,
                                Max = new SharpDX.Vector4(
                                    boxes[at].Max.X, boxes[at].Max.Y,
                                    Math.Max(boxes[at].Max.Z, modelTop), boxes[at].Max.W),
                            };
                }
                if (drawableTop == float.MinValue) continue;
                var max = drawable.BoundingBoxMax;
                drawable.BoundingBoxMax = new SharpDX.Vector3(max.X, max.Y, Math.Max(max.Z, drawableTop));
                drawable.BoundingSphereRadius += biggestHeight;
            }
            if (addedVertices == 0 && repainted == 0)
            {
                skipped += 1;
                continue;
            }
            var saved = ydd.Save();
            if (saved is null || saved.Length == 0)
                throw new InvalidDataException($"Не удалось собрать плитку {tile.FileName}.");
            var check = new YddFile();
            check.Load(saved);
            var after = Shape(check);
            var expected = ShapeWith(ydd);
            if (after != expected)
                throw new InvalidDataException(
                    $"Плитка {tile.FileName} со стенками собралась не так, как задумано: ждали {expected}, прочли {after} (было {before}).");
            var mismatch = LodMismatch(check);
            if (mismatch is not null)
                throw new InvalidDataException(
                    $"Плитка {tile.FileName} со стенками расходится с игрой: {mismatch}.");
            File.WriteAllBytes(Path.Combine(output, tile.FileName), saved);
            blocksTotal += blocks;
            addedVerticesTotal += addedVertices;
            addedIndicesTotal += addedIndices;
            repaintedTotal += repainted;
            written.Add(new
            {
                file = tile.FileName,
                archive = tile.Archive,
                entry = tile.Entry,
                repainted,
                blocks,
                addedVertices,
                addedIndices,
                bytes = saved.Length,
                sha256 = Sha256(saved),
                shapeBefore = before,
                shapeAfter = after,
            });
        }
        return new
        {
            output,
            count = written.Count,
            skipped,
            blocks = blocksTotal,
            addedVertices = addedVerticesTotal,
            addedIndices = addedIndicesTotal,
            repainted = repaintedTotal,
            largestGeometryVertices = largest,
            reducedGeometries,
            heights = heightBuckets.Select(pair => new { fromMetres = pair.Key, blocks = pair.Value }).ToArray(),
            layers = layerBuckets.Select(pair => new { layers = pair.Key, blocks = pair.Value }).ToArray(),
            source = new
            {
                archive = tiles[0].Archive,
                entry = Path.GetDirectoryName(tiles[0].Entry)?.Replace('\\', '/'),
            },
            tiles = written.ToArray(),
        };
    }

    /// <summary>Форма словаря по ТЕКУЩИМ данным (после правки в памяти): ту же строку даст перечитанная плитка.</summary>
    private static string ShapeWith(YddFile ydd) => Shape(ydd);

    /// <summary>
    /// Первое расхождение между флагом уровня детализации и его списком
    /// моделей — или null, когда каждый уровень честен. Правило Rockstar:
    /// флаг не нулевой ровно тогда, когда список не пуст (CodeWalker держит
    /// то же утверждение в проверке чтения, помеченной «no hit»).
    /// </summary>
    private static string? LodMismatch(YddFile ydd)
    {
        var drawables = ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>();
        for (var index = 0; index < drawables.Length; index++)
        {
            var drawable = drawables[index];
            if (drawable is null) continue;
            var models = drawable.DrawableModels;
            var levels = new (string Name, byte Flag, int Count)[]
            {
                ("high", drawable.FlagsHigh, models?.High?.Length ?? 0),
                ("med", drawable.FlagsMed, models?.Med?.Length ?? 0),
                ("low", drawable.FlagsLow, models?.Low?.Length ?? 0),
                ("vlow", drawable.FlagsVlow, models?.VLow?.Length ?? 0),
            };
            foreach (var level in levels)
            {
                if ((level.Flag != 0) == (level.Count > 0)) continue;
                return string.Create(
                    CultureInfo.InvariantCulture,
                    $"рисовалка {index}, уровень {level.Name}: флаг {level.Flag}, моделей {level.Count}");
            }
        }
        return null;
    }

    /// <summary>Форма словаря одной строкой: по ней сверяют плитку до и после.</summary>
    private static string Shape(YddFile ydd)
    {
        var drawables = ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>();
        var models = 0;
        var geometries = 0;
        long vertices = 0;
        long indices = 0;
        foreach (var drawable in drawables)
        {
            models += drawable?.AllModels?.Length ?? 0;
            foreach (var model in drawable?.AllModels ?? Array.Empty<DrawableModel>())
            foreach (var geometry in model?.Geometries ?? Array.Empty<DrawableGeometry>())
            {
                geometries += 1;
                vertices += geometry?.VertexBuffer?.VertexCount ?? 0;
                indices += geometry?.IndexBuffer?.IndicesCount ?? 0;
            }
        }
        return string.Create(
            CultureInfo.InvariantCulture,
            $"d{drawables.Length}/m{models}/g{geometries}/v{vertices}/i{indices}");
    }
}
