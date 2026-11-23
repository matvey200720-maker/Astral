using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Осмотр плиток радара: из чего они сделаны, ничего не меняя.
///
/// Нужен двум делам. Перед тем как дописывать слои в плитки игрока, надо
/// видеть, как их строит сама игра: сколько в плитке рисовалок, в какой из
/// них что лежит, какие у моделей маски корзин и какие высоты у слоёв. После
/// записи тем же осмотром читается то, что легло в архив, — независимо от
/// кода, который писал, и до того, как игре придётся это открыть.
/// </summary>
internal static partial class MinimapRadar
{
    /// <summary>Осмотр файлов плиток: по каждому — рисовалки, модели, геометрии, высоты.</summary>
    internal static object InspectTiles(IReadOnlyList<string> files)
    {
        if (files.Count == 0)
            throw new ArgumentException("Не передано ни одной плитки.");
        if (files.Count > MaxTiles)
            throw new ArgumentException("Слишком много плиток для осмотра.");
        var tiles = new List<object>();
        foreach (var file in files)
        {
            var bytes = File.ReadAllBytes(file);
            var ydd = new YddFile();
            ydd.Load(bytes);
            tiles.Add(InspectTile(Path.GetFileName(file), bytes.Length, ydd));
        }
        return new { count = tiles.Count, tiles = tiles.ToArray() };
    }

    private static object InspectTile(string name, int size, YddFile ydd)
    {
        var drawables = ydd.DrawableDict?.Drawables?.data_items ?? Array.Empty<Drawable>();
        var hashes = ydd.DrawableDict?.Hashes ?? Array.Empty<uint>();
        var box = TileBounds(ydd);
        var list = new List<object>();
        for (var index = 0; index < drawables.Length; index++)
        {
            var drawable = drawables[index];
            if (drawable is null) continue;
            var blocks = drawable.DrawableModels;
            var levels = new (string Name, DrawableModel[]? Models)[]
            {
                ("high", blocks?.High),
                ("med", blocks?.Med),
                ("low", blocks?.Low),
                ("vlow", blocks?.VLow),
                ("extra", blocks?.Extra),
            };
            var shaders = (drawable.ShaderGroup?.Shaders?.data_items ?? Array.Empty<ShaderFX>())
                .Select(shader => new
                {
                    name = shader?.Name.ToString(),
                    file = shader?.FileName.ToString(),
                    bucket = (int?)shader?.RenderBucket,
                    bucketMask = shader?.RenderBucketMask,
                })
                .ToArray();
            var models = new List<object>();
            foreach (var level in levels)
            {
                var all = level.Models ?? Array.Empty<DrawableModel>();
                for (var m = 0; m < all.Length; m++)
                {
                    var model = all[m];
                    if (model is null) continue;
                    var geometries = new List<object>();
                    foreach (var geometry in model.Geometries ?? Array.Empty<DrawableGeometry>())
                    {
                        if (geometry is null) continue;
                        geometries.Add(InspectGeometry(geometry));
                    }
                    models.Add(new
                    {
                        level = level.Name,
                        at = m,
                        renderMaskFlags = model.RenderMaskFlags,
                        renderMask = model.RenderMask,
                        flags = model.Flags,
                        skeletonBinding = model.SkeletonBinding,
                        shaderMapping = model.ShaderMapping,
                        boundsData = (model.BoundsData?.Length) ?? 0,
                        geometries = geometries.ToArray(),
                    });
                }
            }
            list.Add(new
            {
                index,
                hash = index < hashes.Length ? hashes[index].ToString("X8", CultureInfo.InvariantCulture) : null,
                name = drawable.Name,
                water = DrawableHasWater(drawable),
                flags = new
                {
                    high = drawable.FlagsHigh,
                    med = drawable.FlagsMed,
                    low = drawable.FlagsLow,
                    vlow = drawable.FlagsVlow,
                },
                renderMask = new
                {
                    high = drawable.RenderMaskHigh,
                    med = drawable.RenderMaskMed,
                    low = drawable.RenderMaskLow,
                    vlow = drawable.RenderMaskVlow,
                },
                lodDist = new[] { drawable.LodDistHigh, drawable.LodDistMed, drawable.LodDistLow, drawable.LodDistVlow },
                bounds = new
                {
                    min = new[] { drawable.BoundingBoxMin.X, drawable.BoundingBoxMin.Y, drawable.BoundingBoxMin.Z },
                    max = new[] { drawable.BoundingBoxMax.X, drawable.BoundingBoxMax.Y, drawable.BoundingBoxMax.Z },
                    center = new[] { drawable.BoundingCenter.X, drawable.BoundingCenter.Y, drawable.BoundingCenter.Z },
                    radius = drawable.BoundingSphereRadius,
                },
                shaders,
                models = models.ToArray(),
            });
        }
        return new
        {
            file = name,
            bytes = size,
            box = box is { } b ? new[] { b.MinX, b.MinY, b.MaxX, b.MaxY } : null,
            shape = Shape(ydd),
            lodMismatch = LodMismatch(ydd),
            drawables = list.ToArray(),
        };
    }

    private static object InspectGeometry(DrawableGeometry geometry)
    {
        var buffer = geometry.VertexBuffer;
        var data = buffer?.Data1 ?? buffer?.Data2;
        var declaration = buffer?.Info;
        var count = (int)(buffer?.VertexCount ?? 0);
        var stride = (int)(buffer?.VertexStride ?? 0);
        double zMin = double.NaN, zMax = double.NaN;
        double xMin = double.NaN, xMax = double.NaN, yMin = double.NaN, yMax = double.NaN;
        var colours = new Dictionary<string, (int Count, float Min, float Max)>();
        var position = PositionOffset(declaration);
        var colour = declaration is null ? -1 : ColourOffset(declaration);
        if (data?.VertexBytes is { } bytes && position >= 0 && stride > 0)
        {
            for (var v = 0; v < count && (v + 1) * stride <= bytes.Length; v++)
            {
                var at = v * stride;
                var x = BitConverter.ToSingle(bytes, at + position);
                var y = BitConverter.ToSingle(bytes, at + position + 4);
                var z = BitConverter.ToSingle(bytes, at + position + 8);
                xMin = double.IsNaN(xMin) ? x : Math.Min(xMin, x);
                xMax = double.IsNaN(xMax) ? x : Math.Max(xMax, x);
                yMin = double.IsNaN(yMin) ? y : Math.Min(yMin, y);
                yMax = double.IsNaN(yMax) ? y : Math.Max(yMax, y);
                zMin = double.IsNaN(zMin) ? z : Math.Min(zMin, z);
                zMax = double.IsNaN(zMax) ? z : Math.Max(zMax, z);
                if (colour < 0) continue;
                var key = Hex(bytes, at + colour);
                colours.TryGetValue(key, out var seen);
                colours[key] = (seen.Count + 1,
                    seen.Count == 0 ? z : Math.Min(seen.Min, z),
                    seen.Count == 0 ? z : Math.Max(seen.Max, z));
            }
        }
        return new
        {
            shaderId = geometry.ShaderID,
            vertices = count,
            indices = geometry.IndexBuffer?.IndicesCount ?? 0,
            stride,
            vft = new { geometry = geometry.VFT, vertexBuffer = buffer?.VFT, indexBuffer = geometry.IndexBuffer?.VFT },
            bufferFlags = buffer?.Flags,
            declaration = declaration is null
                ? null
                : new
                {
                    flags = declaration.Flags,
                    types = ((ulong)declaration.Types).ToString("X16", CultureInfo.InvariantCulture),
                    stride = declaration.Stride,
                    count = declaration.Count,
                },
            twoBuffers = buffer?.Data1 is not null && buffer.Data2 is not null,
            aabb = new
            {
                min = new[] { geometry.AABB.Min.X, geometry.AABB.Min.Y, geometry.AABB.Min.Z, geometry.AABB.Min.W },
                max = new[] { geometry.AABB.Max.X, geometry.AABB.Max.Y, geometry.AABB.Max.Z, geometry.AABB.Max.W },
            },
            xy = double.IsNaN(xMin) ? null : new[] { xMin, yMin, xMax, yMax },
            z = double.IsNaN(zMin) ? null : new[] { zMin, zMax },
            colours = colours
                .OrderByDescending(pair => pair.Value.Count)
                .Take(24)
                .Select(pair => new { rgba = pair.Key, vertices = pair.Value.Count, zMin = pair.Value.Min, zMax = pair.Value.Max })
                .ToArray(),
        };
    }

    /// <summary>Смещение позиции (поле 0) в вершине; −1, когда это не Float3.</summary>
    private static int PositionOffset(VertexDeclaration? declaration)
    {
        if (declaration is null) return -1;
        if (((declaration.Flags >> 0) & 1) == 0) return -1;
        return declaration.GetComponentType(0) == VertexComponentType.Float3 ? 0 : -1;
    }

    /// <summary>Есть ли в рисовалке вода: вершина ниже нуля радара или с цветным (не серым) оттенком.</summary>
    private static bool DrawableHasWater(Drawable drawable)
    {
        foreach (var model in drawable.DrawableModels?.High ?? Array.Empty<DrawableModel>())
        foreach (var geometry in model?.Geometries ?? Array.Empty<DrawableGeometry>())
        {
            var buffer = geometry?.VertexBuffer;
            var data = buffer?.Data1 ?? buffer?.Data2;
            var declaration = buffer?.Info;
            var bytes = data?.VertexBytes;
            if (bytes is null || declaration is null) continue;
            var position = PositionOffset(declaration);
            var colour = ColourOffset(declaration);
            var stride = (int)buffer!.VertexStride;
            if (position < 0 || colour < 0 || stride <= 0) continue;
            for (var v = 0; v < buffer.VertexCount && (v + 1) * stride <= bytes.Length; v++)
            {
                var at = v * stride;
                var z = BitConverter.ToSingle(bytes, at + position + 8);
                var spread = Math.Max(bytes[at + colour], Math.Max(bytes[at + colour + 1], bytes[at + colour + 2])) -
                             Math.Min(bytes[at + colour], Math.Min(bytes[at + colour + 1], bytes[at + colour + 2]));
                if (z < -1f || spread > 4) return true;
            }
        }
        return false;
    }

    /// <summary>Рамка плитки по её вершинам: мировые X и Y, все уровни детализации.</summary>
    internal readonly record struct TileBox(float MinX, float MinY, float MaxX, float MaxY)
    {
        internal float Area => (MaxX - MinX) * (MaxY - MinY);
        internal bool Contains(float x, float y) => x >= MinX && x <= MaxX && y >= MinY && y <= MaxY;
        internal float Distance(float x, float y)
        {
            var dx = Math.Max(Math.Max(MinX - x, 0f), x - MaxX);
            var dy = Math.Max(Math.Max(MinY - y, 0f), y - MaxY);
            return MathF.Sqrt(dx * dx + dy * dy);
        }
    }

    private static TileBox? TileBounds(YddFile ydd)
    {
        var any = false;
        float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
        foreach (var geometry in Geometries(ydd))
        {
            var buffer = geometry.VertexBuffer;
            var data = buffer?.Data1 ?? buffer?.Data2;
            var bytes = data?.VertexBytes;
            var position = PositionOffset(buffer?.Info);
            var stride = (int)(buffer?.VertexStride ?? 0);
            if (bytes is null || position < 0 || stride <= 0) continue;
            for (var v = 0; v < buffer!.VertexCount && (v + 1) * stride <= bytes.Length; v++)
            {
                var x = BitConverter.ToSingle(bytes, v * stride + position);
                var y = BitConverter.ToSingle(bytes, v * stride + position + 4);
                if (!float.IsFinite(x) || !float.IsFinite(y)) continue;
                any = true;
                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }
        return any ? new TileBox(minX, minY, maxX, maxY) : null;
    }
}
