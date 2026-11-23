using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Свой лист у части модели, что делит лист с соседями (задача 11 ТЗ
/// 17.10.2026, владелец: «наложение текстур выходит за пределы… арена — та же
/// проблема», `split-sheet-surfaces`).
///
/// Один и тот же лист у Rockstar и у серверов лежит сразу на стенах, потолке
/// и деталях: у оболочки зала Majestic стены, потолок и пол — одна геометрия
/// с одним шейдером, а штукатурка стен — ещё и на стойках и боксах. Отделка,
/// записанная в общий лист, ложилась на всё сразу: узор стен — на потолок и
/// стойки, в кадре же — только на стены. Здесь у выбранной части модели
/// появляется свой лист, остальные пользователи общего — как были:
///   • `triangles` — номера треугольников в буфере индексов геометрии
///     (`model`, `geometry` — по порядку в моделях высокой детализации): они
///     уходят в новую геометрию с тем же буфером вершин; без `triangles` —
///     геометрия целиком;
///   • шейдер новой геометрии — копия прежнего в конце списка, у копии
///     параметр-лист с именем `from` зовёт лист `to`;
///   • лист `to` — DDS (`dds`) во встроенный словарь модели; флаги — у
///     листа `from`: встроенного в модель или из словаря `source`.
/// Длина буферов вершин, развёртка и рамки геометрий не меняются. Сборка —
/// через XML CodeWalker, как у `shop-embed-textures`; модель открывается
/// заново и сверяется. Команда детерминирована.
///
/// Запрос: `{ format: "astral.split-sheet-surfaces", version: 1, target,
/// splits: [{ model, geometry, triangles?, from, to, dds, source? }] }`.
/// </summary>
internal static class SheetSplitCommands
{
    private const string RequestFormat = "astral.split-sheet-surfaces";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 16 * 1024 * 1024;
    private const int MaxModelBytes = 96 * 1024 * 1024;
    private const int MaxDdsBytes = 32 * 1024 * 1024;
    private const int MaxSplits = 128;

    private static readonly Regex TextureName = new("^[a-z0-9_.+-]{1,160}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> SplitAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Split-sheet-surfaces request must be between 1 byte and 16 MiB.");
        var request = JsonSerializer.Deserialize<SplitRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Split-sheet-surfaces request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Split-sheet-surfaces request has an unknown format.");
        var splits = request.Splits ?? [];
        if (splits.Length is 0 or > MaxSplits) throw new InvalidDataException($"Split-sheet-surfaces takes 1 to {MaxSplits} splits.");

        var targetPath = Path.GetFullPath(request.Target ?? "");
        if (!targetPath.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase) || !File.Exists(targetPath))
            throw new InvalidDataException("Split-sheet-surfaces target must be an existing .ydr file.");
        var modelBytes = await File.ReadAllBytesAsync(targetPath);
        if (modelBytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException("Split-sheet-surfaces target is empty or too large.");
        var outputPath = Path.GetFullPath(output);
        if (!outputPath.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Split-sheet-surfaces output must be a .ydr file.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var name = Path.GetFileName(targetPath);
        var ydr = new YdrFile { Name = name };
        ydr.Load(modelBytes);
        if (!ydr.Loaded || ydr.Drawable is null) throw new InvalidDataException("Split-sheet-surfaces drawable does not open.");
        var embedded = ydr.Drawable.ShaderGroup?.TextureDictionary;

        var work = Path.Combine(Path.GetTempPath(), "astral-split-sheets-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(YdrXml.GetXml(ydr, work));
            var root = doc.DocumentElement!;
            var group = root.SelectSingleNode("ShaderGroup") as XmlElement
                ?? throw new InvalidDataException("Split-sheet-surfaces target has no shader group.");
            var shaders = group.SelectSingleNode("Shaders") as XmlElement
                ?? throw new InvalidDataException("Split-sheet-surfaces target has no shaders.");
            var dictionary = group.SelectSingleNode("TextureDictionary") as XmlElement;
            if (dictionary is null)
            {
                dictionary = doc.CreateElement("TextureDictionary");
                group.InsertBefore(dictionary, shaders);
            }
            var models = root.SelectNodes("DrawableModelsHigh/Item")!.Cast<XmlElement>().ToList();
            if (models.Count == 0) throw new InvalidDataException("Split-sheet-surfaces target has no high detail models.");

            var sources = new Dictionary<string, YtdFile>(StringComparer.OrdinalIgnoreCase);
            var shaderCopies = new Dictionary<string, int>(StringComparer.Ordinal);
            var embeddedNames = new List<string>();
            var serial = 0;
            var moved = 0;
            var created = 0;
            var geometryCountBefore = models.Sum(model => model.SelectNodes("Geometries/Item")!.Count);

            /* Разделы одной геометрии — вместе: номера треугольников — в её исходном буфере. */
            var byGeometry = new SortedDictionary<(int Model, int Geometry), List<SheetSplit>>();
            foreach (var split in splits)
            {
                if (split.Model < 0 || split.Model >= models.Count) throw new InvalidDataException("Split-sheet-surfaces model index is out of range.");
                var key = (split.Model, split.Geometry);
                if (!byGeometry.TryGetValue(key, out var list)) byGeometry[key] = list = [];
                list.Add(split);
            }

            /* Сначала — листы: имя и флаги у образца, картинка — из DDS. */
            var sheetFiles = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var split in splits)
            {
                var to = ValidName(split.To, "target");
                var from = ValidName(split.From, "source");
                if (string.Equals(to, from, StringComparison.Ordinal)) throw new InvalidDataException("Split-sheet-surfaces new texture must have its own name.");
                if (sheetFiles.ContainsKey(to)) continue;
                var ddsPath = Path.GetFullPath(split.Dds ?? "");
                if (!ddsPath.EndsWith(".dds", StringComparison.OrdinalIgnoreCase) || !File.Exists(ddsPath))
                    throw new InvalidDataException("Split-sheet-surfaces texture must be an existing .dds file.");
                var dds = await File.ReadAllBytesAsync(ddsPath);
                if (dds.Length is 0 or > MaxDdsBytes) throw new InvalidDataException("Split-sheet-surfaces texture is empty or too large.");
                var template = embedded?.Lookup(JenkHash.GenHash(from))
                    ?? (string.IsNullOrWhiteSpace(split.Source)
                        ? throw new InvalidDataException($"Split-sheet-surfaces: texture {from} is not embedded and has no source dictionary.")
                        : await ShopCommands.SourceTexture(sources, split.Source, from));
                var file = $"astral_split_{serial++:D3}.dds";
                await File.WriteAllBytesAsync(Path.Combine(work, file), dds);
                var existing = dictionary.SelectNodes("Item")!.Cast<XmlElement>()
                    .FirstOrDefault(item => string.Equals(item.SelectSingleNode("Name")?.InnerText.Trim(), to, StringComparison.OrdinalIgnoreCase));
                if (existing is not null) dictionary.RemoveChild(existing);
                dictionary.AppendChild(ShopCommands.TextureItem(doc, template, to, file));
                sheetFiles[to] = file;
                embeddedNames.Add(to);
            }

            /* Номера геометрий — исходные: список модели снимается до первой новой геометрии. */
            var originals = new Dictionary<int, List<XmlElement>>();
            foreach (var ((modelIndex, geometryIndex), list) in byGeometry)
            {
                var geometriesNode = models[modelIndex].SelectSingleNode("Geometries") as XmlElement
                    ?? throw new InvalidDataException("Split-sheet-surfaces model has no geometries.");
                if (!originals.TryGetValue(modelIndex, out var geometries))
                    originals[modelIndex] = geometries = geometriesNode.SelectNodes("Item")!.Cast<XmlElement>().ToList();
                if (geometryIndex < 0 || geometryIndex >= geometries.Count) throw new InvalidDataException("Split-sheet-surfaces geometry index is out of range.");
                var geometry = geometries[geometryIndex];
                var shaderIndex = (int)Value(geometry, "ShaderIndex");
                var indices = Indices(geometry);
                var triangleCount = indices.Length / 3;

                /* Чей каждый треугольник: −1 — остаётся у прежней геометрии. */
                var owner = new int[triangleCount];
                Array.Fill(owner, -1);
                var whole = -1;
                for (var index = 0; index < list.Count; index += 1)
                {
                    var triangles = list[index].Triangles;
                    if (triangles is null)
                    {
                        if (list.Count != 1) throw new InvalidDataException("Split-sheet-surfaces: a whole geometry cannot share its split.");
                        whole = index;
                        continue;
                    }
                    foreach (var triangle in triangles)
                    {
                        if (triangle < 0 || triangle >= triangleCount) throw new InvalidDataException("Split-sheet-surfaces triangle index is out of range.");
                        if (owner[triangle] >= 0) throw new InvalidDataException("Split-sheet-surfaces: a triangle belongs to two splits.");
                        owner[triangle] = index;
                    }
                }
                if (whole >= 0)
                {
                    SetValue(geometry, "ShaderIndex", ShaderCopy(doc, shaders, shaderCopies, shaderIndex, list[whole].From!, list[whole].To!));
                    moved += triangleCount;
                    continue;
                }

                var remaining = new List<ushort>();
                var parts = list.Select(_ => new List<ushort>()).ToList();
                for (var triangle = 0; triangle < triangleCount; triangle += 1)
                {
                    var target = owner[triangle] >= 0 ? parts[owner[triangle]] : remaining;
                    target.Add(indices[triangle * 3]);
                    target.Add(indices[triangle * 3 + 1]);
                    target.Add(indices[triangle * 3 + 2]);
                }
                var anchor = geometry;
                for (var index = 0; index < list.Count; index += 1)
                {
                    if (parts[index].Count == 0) continue;
                    var copyIndex = ShaderCopy(doc, shaders, shaderCopies, shaderIndex, list[index].From!, list[index].To!);
                    moved += parts[index].Count / 3;
                    /* Прежней геометрии не осталось треугольников — она и становится
                       последним разделом (копии прежних разделов сняты с неё раньше). */
                    if (remaining.Count == 0 && index == LastNonEmpty(parts))
                    {
                        SetIndices(geometry, parts[index]);
                        SetValue(geometry, "ShaderIndex", copyIndex);
                        continue;
                    }
                    var clone = (XmlElement)geometry.CloneNode(true);
                    SetIndices(clone, parts[index]);
                    SetValue(clone, "ShaderIndex", copyIndex);
                    geometriesNode.InsertAfter(clone, anchor);
                    anchor = clone;
                    created += 1;
                }
                if (remaining.Count > 0) SetIndices(geometry, remaining);
            }

            var rebuilt = XmlYdr.GetYdr(doc, work);
            if (rebuilt.Drawable is null) throw new InvalidDataException("Split model has no drawable.");
            var bytes = rebuilt.Save();
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, embeddedNames, geometryCountBefore + created, moved);
        }
        finally
        {
            try
            {
                Directory.Delete(work, true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    private static int LastNonEmpty(List<List<ushort>> parts)
    {
        for (var index = parts.Count - 1; index >= 0; index -= 1)
            if (parts[index].Count > 0) return index;
        return -1;
    }

    private static string ValidName(string? raw, string label)
    {
        var name = (raw ?? "").Trim().ToLowerInvariant();
        if (!TextureName.IsMatch(name)) throw new InvalidDataException($"Split-sheet-surfaces {label} texture name is not valid.");
        return name;
    }

    /* Копия шейдера в конце списка: параметр-лист `from` зовёт `to`. Одна копия на пару. */
    private static int ShaderCopy(XmlDocument doc, XmlElement shaders, Dictionary<string, int> copies, int shaderIndex, string from, string to)
    {
        from = from.Trim().ToLowerInvariant();
        to = to.Trim().ToLowerInvariant();
        var key = $"{shaderIndex}|{to}";
        if (copies.TryGetValue(key, out var known)) return known;
        var items = shaders.SelectNodes("Item")!.Cast<XmlElement>().ToList();
        if (shaderIndex < 0 || shaderIndex >= items.Count) throw new InvalidDataException("Split-sheet-surfaces geometry points to a missing shader.");
        var copy = (XmlElement)items[shaderIndex].CloneNode(true);
        var hash = JenkHash.GenHash(from);
        var renamed = 0;
        foreach (var parameter in copy.SelectNodes("Parameters/Item[@type='Texture']")!.Cast<XmlElement>())
        {
            if (parameter.SelectSingleNode("Name") is not XmlElement node) continue;
            var written = node.InnerText.Trim();
            if (!string.Equals(written, from, StringComparison.OrdinalIgnoreCase) && !string.Equals(written, $"hash_{hash:X8}", StringComparison.OrdinalIgnoreCase)) continue;
            node.InnerText = to;
            renamed += 1;
        }
        if (renamed == 0) throw new InvalidDataException($"Split-sheet-surfaces: the shader does not use texture {from}.");
        shaders.AppendChild(copy);
        var index = items.Count;
        copies[key] = index;
        return index;
    }

    private static uint Value(XmlElement parent, string tag)
    {
        var node = parent.SelectSingleNode(tag) as XmlElement ?? throw new InvalidDataException($"Split-sheet-surfaces geometry has no {tag}.");
        return uint.Parse(node.GetAttribute("value"), CultureInfo.InvariantCulture);
    }

    private static void SetValue(XmlElement parent, string tag, int value)
    {
        var node = parent.SelectSingleNode(tag) as XmlElement ?? throw new InvalidDataException($"Split-sheet-surfaces geometry has no {tag}.");
        node.SetAttribute("value", value.ToString(CultureInfo.InvariantCulture));
    }

    private static ushort[] Indices(XmlElement geometry)
    {
        var node = geometry.SelectSingleNode("IndexBuffer/Data") as XmlElement
            ?? throw new InvalidDataException("Split-sheet-surfaces geometry has no index buffer.");
        var values = node.InnerText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var indices = new ushort[values.Length];
        for (var index = 0; index < values.Length; index += 1) indices[index] = ushort.Parse(values[index], CultureInfo.InvariantCulture);
        if (indices.Length % 3 != 0) throw new InvalidDataException("Split-sheet-surfaces geometry is not a triangle list.");
        return indices;
    }

    /*
     * Треугольники геометрии и только их вершины: строки буфера вершин, на
     * которые никто не ссылается, уходят (иначе каждая новая геометрия везла
     * бы весь буфер прежней), номера в буфере индексов — по новым строкам.
     */
    private static void SetIndices(XmlElement geometry, List<ushort> triangles)
    {
        var node = geometry.SelectSingleNode("IndexBuffer/Data") as XmlElement
            ?? throw new InvalidDataException("Split-sheet-surfaces geometry has no index buffer.");
        var data = geometry.SelectSingleNode("VertexBuffer/Data") as XmlElement
            ?? throw new InvalidDataException("Split-sheet-surfaces geometry has no vertex buffer.");
        var second = geometry.SelectSingleNode("VertexBuffer/Data2") as XmlElement;
        string[] Rows(XmlElement element) => element.InnerText.Split('\n').Select(row => row.Trim()).Where(row => row.Length > 0).ToArray();
        var rows = Rows(data);
        var rows2 = second is null ? null : Rows(second);
        var remap = new Dictionary<ushort, ushort>();
        var kept = new List<ushort>();
        var indices = new List<ushort>(triangles.Count);
        foreach (var index in triangles)
        {
            if (index >= rows.Length) throw new InvalidDataException("Split-sheet-surfaces index points past the vertex buffer.");
            if (!remap.TryGetValue(index, out var mapped))
            {
                mapped = (ushort)kept.Count;
                remap[index] = mapped;
                kept.Add(index);
            }
            indices.Add(mapped);
        }
        string Join(string[] source) => "\n" + string.Join("\n", kept.Select(index => source[index])) + "\n";
        data.InnerText = Join(rows);
        if (second is not null && rows2 is not null) second.InnerText = Join(rows2);
        var text = new StringBuilder();
        for (var index = 0; index < indices.Count; index += 1)
        {
            text.Append(index % 24 == 0 ? "\n" : " ");
            text.Append(indices[index].ToString(CultureInfo.InvariantCulture));
        }
        text.Append('\n');
        node.InnerText = text.ToString();
    }

    /* Повторное открытие: геометрий столько, сколько задумано, новые листы — в словаре модели и у шейдеров. */
    private static object Reopen(string path, byte[] bytes, List<string> embedded, int geometries, int moved)
    {
        var name = Path.GetFileName(path);
        var ydr = new YdrFile { Name = name };
        ydr.Load(bytes);
        if (!ydr.Loaded || ydr.Drawable is null) throw new InvalidDataException($"Split {name} does not reopen.");
        var high = ydr.Drawable.DrawableModels?.High ?? [];
        var count = high.Sum(model => model?.Geometries?.Length ?? 0);
        if (count != geometries) throw new InvalidDataException($"Split {name}: {count} geometries instead of {geometries}.");
        var group = ydr.Drawable.ShaderGroup ?? throw new InvalidDataException($"Split {name} lost its shader group.");
        var items = group.TextureDictionary?.Textures?.data_items ?? [];
        var linked = 0;
        foreach (var textureName in embedded)
        {
            var texture = items.FirstOrDefault(item => string.Equals(item.Name, textureName, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException($"Split {name} lost texture {textureName}.");
            foreach (var shader in group.Shaders?.data_items ?? [])
                foreach (var parameter in shader?.ParametersList?.Parameters ?? [])
                    if (ReferenceEquals(parameter.Data, texture)) linked += 1;
        }
        if (linked < embedded.Count) throw new InvalidDataException($"Split {name}: a new texture has no shader.");
        return new
        {
            file = name,
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new { semanticReopen = true, geometries = count, textures = embedded.Count, linked, moved },
        };
    }

    private sealed record SheetSplit(int Model = 0, int Geometry = 0, int[]? Triangles = null, string? From = null, string? To = null, string? Dds = null, string? Source = null);

    private sealed record SplitRequest(string Format, int Version, string? Target = null, SheetSplit[]? Splits = null);
}
