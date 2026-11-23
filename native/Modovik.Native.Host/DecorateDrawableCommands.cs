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
/// Украшения на модели оружия (задача 13 ТЗ 10.10.2026): цветы, веточки,
/// звёздочки, брелоки и логотип — новыми геометриями в самой модели ствола
/// игры игрока (`w_pi_pistol.ydr`, `w_pi_pistol_hi.ydr`).
///
/// Сетки собирает окно (`@modovik/gun-studio/decorations.js`), здесь они
/// встают в модель так, как стоят детали Rockstar:
///   • в каждую модель уровня детализации — по геометрии на украшение;
///   • модель оружия «с кожей» (`HasSkin` 1): вершины в осях модели, весь вес
///     — на кость ближайшей вершины ствола к месту украшения (на затворе —
///     затвор, на стволе — главная кость), палитра костей (`BoneIDs`) — той
///     геометрии, где эта вершина; без кожи — просто вершины модели;
///   • шейдер `default` (`default.sps`, корзина 0) с листом цветов
///     украшения или `default/alpha.sps` (корзина 1) у логотипа с
///     прозрачностью — те же шейдер и параметры, что у звезды арены и
///     плашек эмблем, которые уже стоят в игре; `default.fxc` рисует «кожу»
///     (`drawskinned`);
///   • листы — DXT5 со всеми мипами во встроенный словарь модели: отдельный
///     словарь пакет скина не пропустит;
///   • маски корзин (модель и `Flags…` уровня) и рамки — заново.
/// Сборка — через XML CodeWalker, как у пересадки деталей
/// (`GraftDrawableCommands`); результат открывается заново и сверяется.
///
/// Объём (задача 6 ТЗ 11.10.2026, утро), запрос версии 2:
///   • `parts` — лоза длиннее детали ствола: сетка частями со своими точками
///     крепления, каждая часть — на кость ближайшей к своей точке вершины;
///     части с одной костью и палитрой — одной геометрией (на затворе
///     пистолета лоза ходит с затвором, на раме — стоит);
///   • `emissive` — светящаяся голограмма: шейдер `emissive`
///     (`emissive_alpha.sps`, корзина 1; без прозрачности —
///     `emissive.sps`, корзина 0) с `emissiveMultiplier` — те же параметры,
///     что у светящихся меток залазов и неоновых стволов паков.
/// Версия 1 (без частей и свечения) читается как прежде.
///
/// Своя модель ствола (задача 6 ТЗ 17.10.2026), запрос версии 3:
///   • `replace` — прежние геометрии модели (все уровни детализации) и их
///     шейдеры убираются; скелет, кости и их места остаются — рука держит
///     ствол за ту же кость, выстрел вылетает из той же `gun_muzzle`,
///     обвесы встают на те же кости;
///   • `body` — сетки своей модели (листы `astral_body_NN`): куски не больше
///     65 535 вершин (индексы геометрии — 16 бит, больше игра читает
///     мусором), листы DXT5 со всеми мипами до 1024², все куски — на
///     несущую кость ствола с наибольшим числом вершин (на затворе своя
///     модель не ездит); украшения при `replace` — тоже на неё;
///   • собранная модель открывается заново: геометрий — сколько поставлено,
///     кости скелета — те же имена по порядку, листы — на месте.
///
/// Обвесы на стволе (задача 6 ТЗ 17.10.2026, вторая половина), запрос
/// версии 4:
///   • `attachments` — сетки обвесов игры (глушитель, прицел, фонарь,
///     камуфляж MK2…), уже поставленные окном на кость ствола в осях модели;
///     листы `astral_part_NN` (DXT5 со всеми мипами, до 1024²), куски — в
///     тех же пределах, что у своей модели (16-битные индексы, вершин и
///     треугольников на модель);
///   • каждый кусок держится за СВОЮ кость по имени (`WAPSupp`, `WAPScop_2`,
///     `gun_root`…) — ту, на которую игра вешает этот обвес: глушитель
///     пистолета стоит на раме, камуфляж затвора ездит с затвором. Кости в
///     скелете нет — кусок держится за несущую кость ствола;
///   • с `replace` и украшениями совместимы: обвесы встают и на свою модель.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class DecorateDrawableCommands
{
    private const string RequestFormat = "astral.decorate-drawable";
    private const int MaxRequestVersion = 4;
    private const int MaxRequestBytes = 48 * 1024 * 1024;
    private const int MaxModelBytes = 64 * 1024 * 1024;
    private const int MaxDdsBytes = 2 * 1024 * 1024;
    private const int MaxDecorations = 12;
    private const int MaxVertices = 6000;
    private const int MaxTotalVertices = 80000;
    private const int MaxParts = 32;
    private const float MaxEmissive = 16f;
    private const float MaxExtent = 3f;
    /* Своя модель ствола: пределы хоста — последняя стена за пределами окна
       (`@modovik/gun-studio/own-model.js`, там же — почему они такие). */
    private const int MaxBodyPieces = 64;
    private const int MaxBodyTextures = 10;
    private const int MaxPieceVertices = 65535;
    private const int MaxBodyVertices = 70000;
    private const int MaxBodyTriangles = 45000;
    private const float MaxBodyUv = 64f;
    private const long MaxBodyTextureBytes = 12L * 1024 * 1024;

    private static readonly Regex Name = new("^astral_deco_[0-9]{2}$", RegexOptions.CultureInvariant);
    private static readonly Regex BodyName = new("^astral_body_[0-9]{2}$", RegexOptions.CultureInvariant);
    private static readonly Regex PartName = new("^astral_part_[0-9]{2}$", RegexOptions.CultureInvariant);
    private static readonly Regex BoneName = new("^[A-Za-z0-9_]{1,48}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    private static readonly (string List, string Flags)[] Lods =
    [
        ("DrawableModelsHigh", "FlagsHigh"),
        ("DrawableModelsMedium", "FlagsMed"),
        ("DrawableModelsLow", "FlagsLow"),
        ("DrawableModelsVeryLow", "FlagsVlow"),
    ];

    public static async Task<object> DecorateAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException($"Decorate request must be between 1 byte and {MaxRequestBytes / (1024 * 1024)} MiB.");
        var request = JsonSerializer.Deserialize<DecorateRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Decorate request is empty.");
        if (request.Format != RequestFormat || request.Version < 1 || request.Version > MaxRequestVersion)
            throw new InvalidDataException("Decorate request has an unknown format.");
        if (request.Version < 3 && (request.Replace || request.Body is not null))
            throw new InvalidDataException("Decorate request below version 3 cannot replace the model.");
        if (request.Replace && request.Body is null)
            throw new InvalidDataException("Replacing the model needs a body.");
        if (request.Version < 4 && request.Attachments is not null)
            throw new InvalidDataException("Decorate request below version 4 cannot carry attachments.");
        var body = request.Body is null ? null : ValidBody(request.Body);
        var attachments = request.Attachments is null ? null : ValidAttachments(request.Attachments);
        var decorations = ValidDecorations(request.Decorations, allowEmpty: body is not null || attachments is not null);
        var textures = new List<Texture>();
        foreach (var decoration in decorations)
            textures.Add(await ReadTextureAsync(decoration.Name!, decoration.Texture, decoration.TextureSha256, decoration.Width, decoration.Height));
        var bodyTextures = new List<Texture>();
        if (body is not null)
        {
            foreach (var texture in body.Textures!)
                bodyTextures.Add(await ReadTextureAsync(texture.Name!, texture.Texture, texture.TextureSha256, texture.Width, texture.Height));
            if (bodyTextures.Sum(texture => (long)texture.Bytes.Length) > MaxBodyTextureBytes)
                throw new InvalidDataException("Body textures are larger than the model budget.");
        }
        if (attachments is not null)
        {
            var partTextures = new List<Texture>();
            foreach (var texture in attachments.Textures!)
                partTextures.Add(await ReadTextureAsync(texture.Name!, texture.Texture, texture.TextureSha256, texture.Width, texture.Height));
            if (partTextures.Sum(texture => (long)texture.Bytes.Length) > MaxBodyTextureBytes)
                throw new InvalidDataException("Attachment textures are larger than the model budget.");
            bodyTextures.AddRange(partTextures);
        }

        var model = await ReadModelAsync(request.Model);
        var outputPath = Path.GetFullPath(output);
        if (!outputPath.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Decorate output must be a .ydr file.");
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);

        var work = Path.Combine(Path.GetTempPath(), "astral-decorate-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(YdrXml.GetXml(model, work));
            var before = CountGeometries(model);
            var skeleton = BoneNames(model);
            var merged = Merge(doc, decorations, textures, work, request.Replace, body, bodyTextures, attachments);
            var ydr = XmlYdr.GetYdr(doc, work);
            if (ydr.Drawable is null) throw new InvalidDataException("Decorated model has no drawable.");
            var bytes = ydr.Save();
            await File.WriteAllBytesAsync(outputPath, bytes);
            return Reopen(outputPath, bytes, before, merged, skeleton);
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

    private sealed record Texture(string Name, string File, byte[] Bytes, int Width, int Height, int Levels);

    private sealed record Merged(int Geometries, int Removed, int Lods, string[] Textures, string[] Bones, int Vertices, object[] Placed, int BodyGeometries, int BodyVertices, int PartGeometries, string[] PartBones);

    /*
     * Своя модель: листы с именами astral_body_NN, каждый кусок — в пределах
     * 16-битных индексов, все вместе — в пределах модели; числа конечны, в
     * габарите хоста, развёртка — в разумной сетке повторов.
     */
    private static Body ValidBody(Body body)
    {
        var textures = body.Textures ?? [];
        var pieces = body.Pieces ?? [];
        if (textures.Length is 0 or > MaxBodyTextures)
            throw new InvalidDataException($"Body needs 1–{MaxBodyTextures} textures.");
        if (pieces.Length is 0 or > MaxBodyPieces)
            throw new InvalidDataException($"Body needs 1–{MaxBodyPieces} pieces.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var texture in textures)
            if (!BodyName.IsMatch(texture.Name ?? "") || !names.Add(texture.Name!))
                throw new InvalidDataException("Body texture names must be unique astral_body_NN.");
        var vertices = 0;
        var triangles = 0;
        foreach (var piece in pieces)
        {
            if (!names.Contains(piece.Texture ?? ""))
                throw new InvalidDataException("Body piece refers to an unknown texture.");
            var positions = piece.Positions ?? [];
            var normals = piece.Normals ?? [];
            var uvs = piece.Uvs ?? [];
            var indices = piece.Indices ?? [];
            var count = positions.Length / 3;
            if (count < 3 || count > MaxPieceVertices || positions.Length != count * 3 || normals.Length != count * 3 || uvs.Length != count * 2)
                throw new InvalidDataException($"Body piece has broken vertex arrays or more than {MaxPieceVertices} vertices.");
            if (indices.Length < 3 || indices.Length % 3 != 0 || indices.Any(index => index < 0 || index >= count))
                throw new InvalidDataException("Body piece has broken indices.");
            if (positions.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent) ||
                normals.Any(value => !float.IsFinite(value) || Math.Abs(value) > 1.01f) ||
                uvs.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxBodyUv))
                throw new InvalidDataException("Body piece has values out of range.");
            vertices += count;
            triangles += indices.Length / 3;
        }
        if (vertices > MaxBodyVertices) throw new InvalidDataException($"Body has more than {MaxBodyVertices} vertices.");
        if (triangles > MaxBodyTriangles) throw new InvalidDataException($"Body has more than {MaxBodyTriangles} triangles.");
        return body;
    }

    /*
     * Обвесы: листы astral_part_NN, куски — как у своей модели (16-битные
     * индексы, пределы модели), у каждого куска — имя кости ствола.
     */
    private static Attachments ValidAttachments(Attachments attachments)
    {
        var textures = attachments.Textures ?? [];
        var pieces = attachments.Pieces ?? [];
        if (textures.Length is 0 or > MaxBodyTextures)
            throw new InvalidDataException($"Attachments need 1–{MaxBodyTextures} textures.");
        if (pieces.Length is 0 or > MaxBodyPieces)
            throw new InvalidDataException($"Attachments need 1–{MaxBodyPieces} pieces.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var texture in textures)
            if (!PartName.IsMatch(texture.Name ?? "") || !names.Add(texture.Name!))
                throw new InvalidDataException("Attachment texture names must be unique astral_part_NN.");
        var vertices = 0;
        var triangles = 0;
        foreach (var piece in pieces)
        {
            if (!names.Contains(piece.Texture ?? ""))
                throw new InvalidDataException("Attachment piece refers to an unknown texture.");
            if (!BoneName.IsMatch(piece.Bone ?? ""))
                throw new InvalidDataException("Attachment piece needs a bone name.");
            var positions = piece.Positions ?? [];
            var normals = piece.Normals ?? [];
            var uvs = piece.Uvs ?? [];
            var indices = piece.Indices ?? [];
            var count = positions.Length / 3;
            if (count < 3 || count > MaxPieceVertices || positions.Length != count * 3 || normals.Length != count * 3 || uvs.Length != count * 2)
                throw new InvalidDataException($"Attachment piece has broken vertex arrays or more than {MaxPieceVertices} vertices.");
            if (indices.Length < 3 || indices.Length % 3 != 0 || indices.Any(index => index < 0 || index >= count))
                throw new InvalidDataException("Attachment piece has broken indices.");
            if (positions.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent) ||
                normals.Any(value => !float.IsFinite(value) || Math.Abs(value) > 1.01f) ||
                uvs.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxBodyUv))
                throw new InvalidDataException("Attachment piece has values out of range.");
            vertices += count;
            triangles += indices.Length / 3;
        }
        if (vertices > MaxBodyVertices) throw new InvalidDataException($"Attachments have more than {MaxBodyVertices} vertices.");
        if (triangles > MaxBodyTriangles) throw new InvalidDataException($"Attachments have more than {MaxBodyTriangles} triangles.");
        return attachments;
    }

    private static List<Decoration> ValidDecorations(Decoration[]? list, bool allowEmpty = false)
    {
        if (allowEmpty && (list is null || list.Length == 0)) return [];
        if (list is null || list.Length is 0 or > MaxDecorations)
            throw new InvalidDataException($"Decorate needs 1–{MaxDecorations} decorations.");
        var total = 0;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var decoration in list)
        {
            if (!Name.IsMatch(decoration.Name ?? "") || !names.Add(decoration.Name!))
                throw new InvalidDataException("Decoration names must be unique astral_deco_NN.");
            var positions = decoration.Positions ?? [];
            var normals = decoration.Normals ?? [];
            var uvs = decoration.Uvs ?? [];
            var indices = decoration.Indices ?? [];
            var count = positions.Length / 3;
            if (count < 3 || count > MaxVertices || positions.Length != count * 3 || normals.Length != count * 3 || uvs.Length != count * 2)
                throw new InvalidDataException($"Decoration {decoration.Name} has broken vertex arrays.");
            if (indices.Length < 3 || indices.Length % 3 != 0 || indices.Any(index => index < 0 || index >= count))
                throw new InvalidDataException($"Decoration {decoration.Name} has broken indices.");
            if (positions.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent) ||
                normals.Any(value => !float.IsFinite(value) || Math.Abs(value) > 1.01f) ||
                uvs.Any(value => !float.IsFinite(value) || value < -1f || value > 2f))
                throw new InvalidDataException($"Decoration {decoration.Name} has values out of range.");
            if (decoration.Anchor is not { Length: 3 } anchor || anchor.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent))
                throw new InvalidDataException($"Decoration {decoration.Name} has no anchor.");
            if (!float.IsFinite(decoration.Emissive) || decoration.Emissive < 0 || decoration.Emissive > MaxEmissive)
                throw new InvalidDataException($"Decoration {decoration.Name} emissive multiplier is out of range.");
            ValidParts(decoration, count, indices);
            total += count;
        }
        if (total > MaxTotalVertices) throw new InvalidDataException($"Decorations have more than {MaxTotalVertices} vertices.");
        return list.ToList();
    }

    /*
     * Части сетки (лоза): подряд и без зазоров покрывают вершины и индексы,
     * треугольники части смотрят только в её вершины — часть можно отдать
     * своей геометрии без пересчёта соседей.
     */
    private static void ValidParts(Decoration decoration, int vertices, int[] indices)
    {
        if (decoration.Parts is null) return;
        if (decoration.Parts.Length is 0 or > MaxParts)
            throw new InvalidDataException($"Decoration {decoration.Name} needs 1–{MaxParts} parts.");
        var vertex = 0;
        var index = 0;
        foreach (var part in decoration.Parts)
        {
            if (part.Anchor is not { Length: 3 } anchor || anchor.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent))
                throw new InvalidDataException($"Decoration {decoration.Name} has a part without anchor.");
            if (part.Vertex != vertex || part.Index != index || part.Vertices < 3 || part.Indices < 3 || part.Indices % 3 != 0)
                throw new InvalidDataException($"Decoration {decoration.Name} has parts that do not follow each other.");
            for (var at = part.Index; at < part.Index + part.Indices; at += 1)
                if (at >= indices.Length || indices[at] < part.Vertex || indices[at] >= part.Vertex + part.Vertices)
                    throw new InvalidDataException($"Decoration {decoration.Name} has a part that looks into another part.");
            vertex += part.Vertices;
            index += part.Indices;
        }
        if (vertex != vertices || index != indices.Length)
            throw new InvalidDataException($"Decoration {decoration.Name} parts do not cover the mesh.");
    }

    private static async Task<Texture> ReadTextureAsync(string name, string? path, string? sha256, int width, int height)
    {
        var file = Path.GetFullPath(path ?? "");
        if (!File.Exists(file)) throw new FileNotFoundException($"Texture for {name} was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"Texture for {name} has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        if (width is < 4 or > 1024 || height is < 4 or > 1024 || (width & (width - 1)) != 0 || (height & (height - 1)) != 0)
            throw new InvalidDataException($"Texture for {name} must be a power of two 4–1024.");
        var levels = BitConverter.ToInt32(bytes, 28);
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " ||
            BitConverter.ToInt32(bytes, 12) != height ||
            BitConverter.ToInt32(bytes, 16) != width ||
            levels != FullMipLevels(width, height) ||
            Encoding.ASCII.GetString(bytes, 84, 4) != "DXT5")
            throw new InvalidDataException($"Texture for {name} is not {width}x{height} DXT5 with a full mip chain.");
        if (bytes.Length != 128 + Dxt5Bytes(width, height, levels))
            throw new InvalidDataException($"Texture for {name} is truncated or padded.");
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (sha256 != "sha256:" + digest)
            throw new InvalidDataException($"Texture SHA-256 mismatch for {name}.");
        return new Texture(name, name + ".dds", bytes, width, height, levels);
    }

    private static int FullMipLevels(int width, int height) => (int)Math.Log2(Math.Max(width, height)) + 1;

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

    private static async Task<YdrFile> ReadModelAsync(string? file)
    {
        if (string.IsNullOrWhiteSpace(file)) throw new InvalidDataException("Decorate model is missing.");
        var full = Path.GetFullPath(file);
        if (!full.EndsWith(".ydr", StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            throw new InvalidDataException("Decorate model must be an existing .ydr file.");
        var bytes = await File.ReadAllBytesAsync(full);
        if (bytes.Length is 0 or > MaxModelBytes) throw new InvalidDataException("Decorate model is empty or too large.");
        var ydr = new YdrFile { Name = Path.GetFileName(full) };
        ydr.Load(bytes);
        if (!ydr.Loaded || ydr.Drawable is null) throw new InvalidDataException("Decorate model does not open.");
        return ydr;
    }

    /* Что известно о вершине ствола: где, палитра костей её геометрии, кость и цвет. */
    private sealed record Nearest(float Distance, string BoneIds, int Slot, int Bone);

    private static Merged Merge(XmlDocument doc, List<Decoration> decorations, List<Texture> textures, string folder, bool replace, Body? body, List<Texture> bodyTextures, Attachments? attachments)
    {
        var root = doc.DocumentElement ?? throw new InvalidDataException("Model XML is empty.");
        var group = root.SelectSingleNode("ShaderGroup") as XmlElement
            ?? throw new InvalidDataException("Model has no shader group.");
        var shaders = group.SelectSingleNode("Shaders") as XmlElement
            ?? throw new InvalidDataException("Model has no shaders.");
        var boneNames = root.SelectNodes("Skeleton/Bones/Item/Name")!.Cast<XmlElement>().Select(item => item.InnerText.Trim()).ToList();

        /*
         * Своя модель (replace): вершины ствола с весами разбираются ДО того,
         * как его геометрии уходят, — по ним выбирается несущая кость; потом
         * геометрии и шейдеры ствола прочь, скелет остаётся.
         */
        var originals = new Dictionary<string, List<(float X, float Y, float Z, string BoneIds, int Slot, int Bone)>>(StringComparer.Ordinal);
        var removed = 0;
        if (replace)
        {
            foreach (var (listName, _) in Lods)
            {
                var model = root.SelectSingleNode($"{listName}/Item") as XmlElement;
                if (model?.SelectSingleNode("Geometries") is not XmlElement list) continue;
                var existing = list.SelectNodes("Item")!.Cast<XmlElement>().ToList();
                if (existing.Count == 0) continue;
                originals[listName] = UIntValue(model, "HasSkin") != 0 ? WeightedVertices(existing).ToList() : [];
                foreach (var item in existing)
                {
                    list.RemoveChild(item);
                    removed += 1;
                }
            }
            foreach (var item in shaders.SelectNodes("Item")!.Cast<XmlElement>().ToList()) shaders.RemoveChild(item);
        }

        /* Шейдер и лист на украшение. */
        var firstShader = shaders.SelectNodes("Item")!.Count;
        var bucketMask = 0;
        foreach (var (decoration, index) in decorations.Select((item, at) => (item, at)))
        {
            var alpha = decoration.Alpha;
            shaders.AppendChild(ShaderElement(doc, textures[index].Name, alpha, decoration.Emissive));
            bucketMask |= 1 << (alpha ? 1 : 0);
        }
        /* Шейдеры своей модели: по одному на пару «лист, прозрачность». */
        var bodyShaders = new Dictionary<(string, bool), int>();
        foreach (var piece in body?.Pieces ?? [])
        {
            var key = (piece.Texture!, piece.Alpha);
            if (bodyShaders.ContainsKey(key)) continue;
            bodyShaders[key] = shaders.SelectNodes("Item")!.Count;
            shaders.AppendChild(ShaderElement(doc, piece.Texture!, piece.Alpha, 0));
            bucketMask |= 1 << (piece.Alpha ? 1 : 0);
        }
        /* Шейдеры обвесов — так же, по паре «лист, прозрачность». */
        var partShaders = new Dictionary<(string, bool), int>();
        foreach (var piece in attachments?.Pieces ?? [])
        {
            var key = (piece.Texture!, piece.Alpha);
            if (partShaders.ContainsKey(key)) continue;
            partShaders[key] = shaders.SelectNodes("Item")!.Count;
            shaders.AppendChild(ShaderElement(doc, piece.Texture!, piece.Alpha, 0));
            bucketMask |= 1 << (piece.Alpha ? 1 : 0);
        }
        var dictionary = group.SelectSingleNode("TextureDictionary") as XmlElement;
        if (dictionary is null)
        {
            dictionary = doc.CreateElement("TextureDictionary");
            group.InsertBefore(dictionary, shaders);
        }
        var present = new HashSet<string>(
            dictionary.SelectNodes("Item/Name")!.Cast<XmlElement>().Select(item => item.InnerText.Trim().ToLowerInvariant()),
            StringComparer.Ordinal);
        foreach (var texture in textures.Concat(bodyTextures))
        {
            if (present.Contains(texture.Name)) throw new InvalidDataException($"Model already has a texture {texture.Name}.");
            File.WriteAllBytes(Path.Combine(folder, texture.File), texture.Bytes);
            dictionary.AppendChild(TextureElement(doc, texture));
        }

        var geometries = 0;
        var bodyGeometries = 0;
        var bodyVertices = 0;
        var partGeometries = 0;
        var partBones = new SortedSet<string>(StringComparer.Ordinal);
        var lods = 0;
        var vertices = 0;
        var bones = new SortedSet<string>(StringComparer.Ordinal);
        var placed = new List<object>();
        var min = replace ? new[] { float.MaxValue, float.MaxValue, float.MaxValue } : Vector(root, "BoundingBoxMin");
        var max = replace ? new[] { float.MinValue, float.MinValue, float.MinValue } : Vector(root, "BoundingBoxMax");
        void Extend(float[] positions)
        {
            for (var at = 0; at < positions.Length; at += 3)
                for (var axis = 0; axis < 3; axis += 1)
                {
                    min[axis] = Math.Min(min[axis], positions[at + axis]);
                    max[axis] = Math.Max(max[axis], positions[at + axis]);
                }
        }
        foreach (var (listName, flagsName) in Lods)
        {
            var model = root.SelectSingleNode($"{listName}/Item") as XmlElement;
            if (model?.SelectSingleNode("Geometries") is not XmlElement list) continue;
            var skinned = UIntValue(model, "HasSkin") != 0;
            List<(float X, float Y, float Z, string BoneIds, int Slot, int Bone)> weighted;
            if (replace)
            {
                if (!originals.TryGetValue(listName, out var captured)) continue;
                weighted = captured;
            }
            else
            {
                var existing = list.SelectNodes("Item")!.Cast<XmlElement>().ToList();
                if (existing.Count == 0) continue;
                weighted = skinned ? WeightedVertices(existing).ToList() : [];
            }
            lods += 1;
            /* Вершины ствола с весами — разбираются один раз на уровень. Своя
               модель держится за одну кость — несущую с наибольшим числом
               вершин; украшения на ней — тоже. */
            var carriers = skinned ? CarrierBones(weighted) : [];
            if (replace && skinned)
            {
                var main = MainCarrier(weighted);
                if (main is null) throw new InvalidDataException("Skinned weapon model has no weighted vertices to carry the body.");
                carriers = [main.Value];
            }
            var bodyNearest = skinned && body is not null ? NearestVertex(weighted, [0f, 0f, 0f], carriers) : null;
            if (skinned && body is not null && bodyNearest is null)
                throw new InvalidDataException("Skinned weapon model has no weighted vertex to carry the body.");
            foreach (var piece in body?.Pieces ?? [])
            {
                var chunk = new Chunk(piece.Positions!, piece.Normals!, piece.Uvs!, piece.Indices!);
                list.AppendChild(GeometryElement(doc, chunk, bodyShaders[(piece.Texture!, piece.Alpha)], bodyNearest));
                geometries += 1;
                if (lods == 1)
                {
                    bodyGeometries += 1;
                    bodyVertices += piece.Positions!.Length / 3;
                }
                Extend(piece.Positions!);
            }
            if (bodyNearest is not null && bodyNearest.Bone >= 0 && bodyNearest.Bone < boneNames.Count) bones.Add(boneNames[bodyNearest.Bone]);
            /* Обвесы: каждый кусок — на свою кость по имени, вес 255 на неё одну
               (палитра куска — одна эта кость). Кости нет — несущая кость ствола. */
            foreach (var piece in attachments?.Pieces ?? [])
            {
                Nearest? hold = null;
                if (skinned)
                {
                    var index = boneNames.FindIndex(name => string.Equals(name, piece.Bone, StringComparison.OrdinalIgnoreCase));
                    if (index < 0) index = MainCarrier(weighted) ?? -1;
                    if (index < 0) throw new InvalidDataException("Skinned weapon model has no bone to carry the attachment.");
                    hold = new Nearest(0, index.ToString(CultureInfo.InvariantCulture), 0, index);
                }
                var chunk = new Chunk(piece.Positions!, piece.Normals!, piece.Uvs!, piece.Indices!);
                list.AppendChild(GeometryElement(doc, chunk, partShaders[(piece.Texture!, piece.Alpha)], hold));
                geometries += 1;
                if (hold is not null && hold.Bone >= 0 && hold.Bone < boneNames.Count)
                {
                    bones.Add(boneNames[hold.Bone]);
                    if (lods == 1) partBones.Add(boneNames[hold.Bone]);
                }
                if (lods == 1) partGeometries += 1;
                Extend(piece.Positions!);
            }
            foreach (var (decoration, index) in decorations.Select((item, at) => (item, at)))
            {
                var parts = decoration.Parts ?? [new Part(decoration.Anchor, 0, decoration.Positions!.Length / 3, 0, decoration.Indices!.Length)];
                /* Части с одной костью и палитрой — одной геометрией, по порядку. */
                var groups = new List<(Nearest? Nearest, List<Part> Parts)>();
                foreach (var part in parts)
                {
                    var nearest = skinned ? NearestVertex(weighted, part.Anchor!, carriers) : null;
                    if (skinned && nearest is null)
                        throw new InvalidDataException("Skinned weapon model has no weighted vertex near the decoration.");
                    var found = groups.FindIndex(item => SameCarrier(item.Nearest, nearest));
                    if (found < 0) groups.Add((nearest, new List<Part> { part }));
                    else groups[found].Parts.Add(part);
                }
                var decorationBones = new List<string>();
                foreach (var (nearest, members) in groups)
                {
                    list.AppendChild(GeometryElement(doc, Piece(decoration, members), firstShader + index, nearest));
                    geometries += 1;
                    var bone = nearest is not null && nearest.Bone >= 0 && nearest.Bone < boneNames.Count ? boneNames[nearest.Bone] : null;
                    if (bone is null) continue;
                    bones.Add(bone);
                    if (!decorationBones.Contains(bone)) decorationBones.Add(bone);
                }
                vertices += decoration.Positions!.Length / 3;
                if (lods == 1)
                    placed.Add(new { name = decoration.Name, bone = decorationBones.FirstOrDefault(), bones = decorationBones.ToArray(), geometries = groups.Count });
                Extend(decoration.Positions!);
            }
            /* Маски корзин: модель и уровень — биты корзин его шейдеров. Своя
               модель — только корзины её шейдеров: прежних больше нет. */
            var modelMask = replace ? bucketMask : (int)UIntValue(model, "RenderMask") | bucketMask;
            SetValue(model, "RenderMask", modelMask.ToString(CultureInfo.InvariantCulture));
            var flags = root.SelectSingleNode(flagsName) as XmlElement;
            if (flags is not null)
                flags.SetAttribute("value", (replace ? bucketMask : (int)UIntValue(root, flagsName) | bucketMask).ToString(CultureInfo.InvariantCulture));
        }
        if (lods == 0) throw new InvalidDataException("Model has no detail level with geometry to decorate.");

        SetVector(root, "BoundingBoxMin", min);
        SetVector(root, "BoundingBoxMax", max);
        var centre = new[] { (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2 };
        SetVector(root, "BoundingSphereCenter", centre);
        var radius = MathF.Sqrt(
            (max[0] - min[0]) * (max[0] - min[0]) + (max[1] - min[1]) * (max[1] - min[1]) + (max[2] - min[2]) * (max[2] - min[2])) / 2;
        SetValue(root, "BoundingSphereRadius", F(radius));
        return new Merged(geometries, removed, lods, textures.Concat(bodyTextures).Select(texture => texture.Name).ToArray(), bones.ToArray(), vertices, placed.ToArray(), bodyGeometries, bodyVertices, partGeometries, partBones.ToArray());
    }

    /* Несущая кость своей модели: та, за которую держится больше всего вершин ствола. */
    private static int? MainCarrier(List<(float X, float Y, float Z, string BoneIds, int Slot, int Bone)> weighted)
    {
        if (weighted.Count == 0) return null;
        return weighted.GroupBy(vertex => vertex.Bone).OrderByDescending(group => group.Count()).ThenBy(group => group.Key).First().Key;
    }

    /* Имена костей скелета по порядку: после сборки они обязаны совпасть. */
    private static string[] BoneNames(YdrFile ydr) =>
        ydr.Drawable?.Skeleton?.Bones?.Items?.Select(bone => bone?.Name ?? "").ToArray() ?? [];

    /* Доля вершин модели, с которой кость — несущая деталь (рама, затвор). */
    private const double CarrierShare = 0.15;

    /*
     * Вершины модели с весами: позиция, палитра костей геометрии, номер в
     * палитре и кость с наибольшим весом. Раскладка — по `Layout` геометрии:
     * позиция первая, веса и номера — в своих колонках; колонки разделены
     * тремя пробелами, числа — одним.
     */
    private static IEnumerable<(float X, float Y, float Z, string BoneIds, int Slot, int Bone)> WeightedVertices(List<XmlElement> geometries)
    {
        foreach (var geometry in geometries)
        {
            var layout = (geometry.SelectSingleNode("VertexBuffer/Layout") as XmlElement)?.ChildNodes.OfType<XmlElement>().Select(item => item.Name).ToList();
            if (layout is null || layout.Count == 0 || layout[0] != "Position") continue;
            var weightsAt = layout.IndexOf("BlendWeights");
            var indicesAt = layout.IndexOf("BlendIndices");
            if (weightsAt < 0 || indicesAt < 0) continue;
            var boneIds = (geometry.SelectSingleNode("BoneIDs") as XmlElement)?.InnerText.Trim() ?? "";
            var palette = boneIds.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
            if (palette.Length == 0) continue;
            if (geometry.SelectSingleNode("VertexBuffer/Data") is not XmlElement data) continue;
            foreach (var row in data.InnerText.Split('\n'))
            {
                var trimmed = row.Trim();
                if (trimmed.Length == 0) continue;
                var columns = trimmed.Split("   ", StringSplitOptions.None);
                if (columns.Length <= Math.Max(weightsAt, indicesAt)) continue;
                var position = columns[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (position.Length < 3) continue;
                var weights = columns[weightsAt].Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
                var indices = columns[indicesAt].Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
                if (weights.Length != 4 || indices.Length != 4) continue;
                var heaviest = 0;
                for (var k = 1; k < 4; k += 1)
                    if (weights[k] > weights[heaviest]) heaviest = k;
                var slot = indices[heaviest];
                if (slot < 0 || slot >= palette.Length) continue;
                yield return (Parse(position[0]), Parse(position[1]), Parse(position[2]), boneIds, slot, palette[slot]);
            }
        }
    }

    /*
     * Несущие кости: за ними держится заметная доля вершин — рама ствола,
     * затвор пистолета. Мелкие подвижные детали (спуск, курок,
     * предохранитель) украшение не несут: на них оно качалось бы с каждым
     * выстрелом. Нет ни одной такой — несущая та, у которой вершин больше всех.
     */
    private static HashSet<int> CarrierBones(List<(float X, float Y, float Z, string BoneIds, int Slot, int Bone)> weighted)
    {
        var counts = new Dictionary<int, int>();
        var total = 0;
        foreach (var vertex in weighted)
        {
            counts[vertex.Bone] = counts.GetValueOrDefault(vertex.Bone) + 1;
            total += 1;
        }
        var threshold = Math.Max(1, (int)Math.Ceiling(total * CarrierShare));
        var carriers = counts.Where(pair => pair.Value >= threshold).Select(pair => pair.Key).ToHashSet();
        if (carriers.Count == 0 && counts.Count > 0) carriers.Add(counts.MaxBy(pair => pair.Value).Key);
        return carriers;
    }

    /*
     * Ближайшая к месту украшения вершина модели на несущей кости: её кость
     * и палитра костей её геометрии — у украшения те же.
     */
    private static Nearest? NearestVertex(List<(float X, float Y, float Z, string BoneIds, int Slot, int Bone)> weighted, float[] anchor, HashSet<int> carriers)
    {
        Nearest? best = null;
        foreach (var vertex in weighted)
        {
            if (carriers.Count > 0 && !carriers.Contains(vertex.Bone)) continue;
            var dx = vertex.X - anchor[0];
            var dy = vertex.Y - anchor[1];
            var dz = vertex.Z - anchor[2];
            var distance = dx * dx + dy * dy + dz * dz;
            if (best is not null && distance >= best.Distance) continue;
            best = new Nearest(distance, vertex.BoneIds, vertex.Slot, vertex.Bone);
        }
        return best;
    }

    /* Две части держатся одинаково: та же палитра и тот же номер кости в ней. */
    private static bool SameCarrier(Nearest? left, Nearest? right) =>
        left is null || right is null
            ? left is null && right is null
            : left.Slot == right.Slot && left.BoneIds == right.BoneIds;

    /* Вершины и треугольники частей — подряд, индексы — от начала куска. */
    private sealed record Chunk(float[] Positions, float[] Normals, float[] Uvs, int[] Indices);

    private static Chunk Piece(Decoration decoration, List<Part> parts)
    {
        if (parts.Count == 1 && parts[0].Vertex == 0 && parts[0].Vertices == decoration.Positions!.Length / 3)
            return new Chunk(decoration.Positions!, decoration.Normals!, decoration.Uvs!, decoration.Indices!);
        var positions = new List<float>();
        var normals = new List<float>();
        var uvs = new List<float>();
        var indices = new List<int>();
        foreach (var part in parts)
        {
            var offset = positions.Count / 3 - part.Vertex;
            positions.AddRange(decoration.Positions!.Skip(part.Vertex * 3).Take(part.Vertices * 3));
            normals.AddRange(decoration.Normals!.Skip(part.Vertex * 3).Take(part.Vertices * 3));
            uvs.AddRange(decoration.Uvs!.Skip(part.Vertex * 2).Take(part.Vertices * 2));
            indices.AddRange(decoration.Indices!.Skip(part.Index).Take(part.Indices).Select(index => index + offset));
        }
        return new Chunk(positions.ToArray(), normals.ToArray(), uvs.ToArray(), indices.ToArray());
    }

    /*
     * Шейдер украшения: `default` (`default.sps`, у прозрачного логотипа —
     * `alpha.sps`) или у светящейся голограммы `emissive` (`emissive_alpha.sps`
     * / `emissive.sps`) с множителем свечения — параметры и порядок как у
     * светящихся меток залазов (`ClimbMarkerCommands`).
     */
    private static XmlElement ShaderElement(XmlDocument doc, string texture, bool alpha, float emissive)
    {
        var glow = emissive > 0;
        var file = glow ? (alpha ? "emissive_alpha.sps" : "emissive.sps") : alpha ? "alpha.sps" : "default.sps";
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<Name>").Append(glow ? "emissive" : "default").Append("</Name>")
            .Append("<FileName>").Append(file).Append("</FileName>")
            .Append("<RenderBucket value=\"").Append(alpha ? 1 : 0).Append("\" />")
            .Append("<Parameters>")
            .Append("<Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(texture).Append("</Name></Item>")
            .Append("<Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />")
            .Append("<Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append(glow
                ? "<Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"" + F(emissive) + "\" y=\"0\" z=\"0\" w=\"0\" />"
                : "<Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("</Parameters></Item>");
        return Fragment(doc, xml.ToString());
    }

    private static XmlElement TextureElement(XmlDocument doc, Texture texture)
    {
        var side = Math.Max(texture.Width, texture.Height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        flags.Add("UNK24");
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<Name>").Append(texture.Name).Append("</Name>")
            .Append("<Unk32 value=\"128\" />")
            .Append("<Usage>DIFFUSE</Usage>")
            .Append("<UsageFlags>").Append(string.Join(", ", flags)).Append("</UsageFlags>")
            .Append("<ExtraFlags value=\"0\" />")
            .Append("<Width value=\"").Append(texture.Width).Append("\" />")
            .Append("<Height value=\"").Append(texture.Height).Append("\" />")
            .Append("<MipLevels value=\"").Append(texture.Levels).Append("\" />")
            .Append("<Format>D3DFMT_DXT5</Format>")
            .Append("<FileName>").Append(texture.File).Append("</FileName>")
            .Append("</Item>");
        return Fragment(doc, xml.ToString());
    }

    /*
     * Геометрия украшения. С кожей — как вершины ствола: вес 255 и номер
     * кости в третьей колонке (так их пишет XML CodeWalker у самих стволов
     * Rockstar), палитра — геометрии ближайшей вершины.
     */
    private static XmlElement GeometryElement(XmlDocument doc, Chunk decoration, int shaderIndex, Nearest? nearest)
    {
        var positions = decoration.Positions;
        var normals = decoration.Normals;
        var uvs = decoration.Uvs;
        var low = new[] { float.MaxValue, float.MaxValue, float.MaxValue };
        var high = new[] { float.MinValue, float.MinValue, float.MinValue };
        for (var at = 0; at < positions.Length; at += 3)
            for (var axis = 0; axis < 3; axis += 1)
            {
                low[axis] = Math.Min(low[axis], positions[at + axis]);
                high[axis] = Math.Max(high[axis], positions[at + axis]);
            }
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<ShaderIndex value=\"").Append(shaderIndex).Append("\" />")
            .Append("<BoundingBoxMin x=\"").Append(F(low[0])).Append("\" y=\"").Append(F(low[1])).Append("\" z=\"").Append(F(low[2])).Append("\" w=\"").Append(F(low[0])).Append("\" />")
            .Append("<BoundingBoxMax x=\"").Append(F(high[0])).Append("\" y=\"").Append(F(high[1])).Append("\" z=\"").Append(F(high[2])).Append("\" w=\"").Append(F(high[0])).Append("\" />");
        if (nearest is not null) xml.Append("<BoneIDs>").Append(nearest.BoneIds).Append("</BoneIDs>");
        xml.Append("<VertexBuffer><Flags value=\"0\" /><Layout type=\"GTAV1\">")
            .Append(nearest is not null ? "<Position /><BlendWeights /><BlendIndices /><Normal /><Colour0 /><TexCoord0 />" : "<Position /><Normal /><Colour0 /><TexCoord0 />")
            .Append("</Layout><Data>\n");
        var skin = nearest is not null ? $"   0 0 255 0   0 0 {nearest.Slot.ToString(CultureInfo.InvariantCulture)} 0" : "";
        for (var vertex = 0; vertex < positions.Length / 3; vertex += 1)
        {
            xml.Append(F(positions[vertex * 3])).Append(' ').Append(F(positions[vertex * 3 + 1])).Append(' ').Append(F(positions[vertex * 3 + 2]))
                .Append(skin)
                .Append("   ").Append(F(normals[vertex * 3])).Append(' ').Append(F(normals[vertex * 3 + 1])).Append(' ').Append(F(normals[vertex * 3 + 2]))
                .Append("   255 255 255 255")
                .Append("   ").Append(F(uvs[vertex * 2])).Append(' ').Append(F(uvs[vertex * 2 + 1]))
                .Append('\n');
        }
        xml.Append("</Data></VertexBuffer><IndexBuffer><Data>")
            .Append(string.Join(" ", decoration.Indices.Select(index => index.ToString(CultureInfo.InvariantCulture))))
            .Append("</Data></IndexBuffer></Item>");
        return Fragment(doc, xml.ToString());
    }

    private static XmlElement Fragment(XmlDocument doc, string xml)
    {
        var holder = new XmlDocument();
        holder.LoadXml(xml);
        return (XmlElement)doc.ImportNode(holder.DocumentElement!, true);
    }

    private static int CountGeometries(YdrFile ydr)
    {
        var models = ydr.Drawable?.DrawableModels;
        if (models is null) return 0;
        var total = 0;
        foreach (var list in new[] { models.High, models.Med, models.Low, models.VLow })
            total += list?.Sum(model => model.Geometries?.Length ?? 0) ?? 0;
        return total;
    }

    private static object Reopen(string path, byte[] bytes, int before, Merged merged, string[] skeleton)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var drawable = ydr.Drawable;
        var textures = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items ?? [];
        var names = new HashSet<string>(textures.Select(texture => (texture.Name ?? "").ToLowerInvariant()), StringComparer.Ordinal);
        if (!ydr.Loaded || drawable is null || CountGeometries(ydr) != before - merged.Removed + merged.Geometries ||
            merged.Textures.Any(name => !names.Contains(name.ToLowerInvariant())))
            throw new InvalidDataException("Decorated model failed semantic reopen.");
        /* Скелет — тот же: рука, выстрел и обвесы держатся за прежние кости. */
        var after = BoneNames(ydr);
        if (!after.SequenceEqual(skeleton, StringComparer.Ordinal))
            throw new InvalidDataException("Decorated model lost its skeleton bones.");
        return new
        {
            file = Path.GetFileName(path),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new
            {
                semanticReopen = true,
                geometries = merged.Geometries,
                lods = merged.Lods,
                vertices = merged.Vertices,
                textures = merged.Textures,
                bones = merged.Bones,
                /* За какую кость держится каждое украшение (у первого уровня детализации). */
                decorations = merged.Placed,
                flagsHigh = drawable.FlagsHigh,
                /* Своя модель ствола: сколько прежних геометрий убрано, сколько своих встало. */
                replaced = merged.Removed,
                body = new { geometries = merged.BodyGeometries, vertices = merged.BodyVertices },
                /* Обвесы: сколько геометрий встало (первый уровень) и на какие кости. */
                attachments = new { geometries = merged.PartGeometries, bones = merged.PartBones },
                skeleton = new
                {
                    bones = after.Length,
                    kept = after.Where(name => KeyBones.Contains(name.ToLowerInvariant())).ToArray(),
                },
            },
        };
    }

    /* Кости, за которые держится оружие в игре: рукоять, выстрел, обвесы. */
    private static readonly HashSet<string> KeyBones = new(StringComparer.Ordinal)
    {
        "gun_root", "gun_main_bone", "gun_gripr", "gun_muzzle", "wapclip", "wapclip_2", "wapsupp", "wapsupp_2", "wapscop", "wapscop_2", "wapflsh", "wapflsh_2", "wapgrip", "wapgrip_2", "wapbarrel", "gun_magazine",
    };

    private static uint UIntValue(XmlElement node, string child)
    {
        var element = node.SelectSingleNode(child) as XmlElement;
        return element is not null && uint.TryParse(element.GetAttribute("value"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : 0;
    }

    private static void SetValue(XmlElement node, string child, string value)
    {
        var element = node.SelectSingleNode(child) as XmlElement
            ?? throw new InvalidDataException($"Model XML has no {child}.");
        element.SetAttribute("value", value);
    }

    private static float[] Vector(XmlElement node, string child)
    {
        var element = node.SelectSingleNode(child) as XmlElement
            ?? throw new InvalidDataException($"Model XML has no {child}.");
        return [Parse(element.GetAttribute("x")), Parse(element.GetAttribute("y")), Parse(element.GetAttribute("z"))];
    }

    private static void SetVector(XmlElement node, string child, float[] value)
    {
        var element = node.SelectSingleNode(child) as XmlElement
            ?? throw new InvalidDataException($"Model XML has no {child}.");
        element.SetAttribute("x", F(value[0]));
        element.SetAttribute("y", F(value[1]));
        element.SetAttribute("z", F(value[2]));
    }

    private static float Parse(string value) => float.Parse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture);
    private static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);

    private sealed record Decoration(
        string? Name = null,
        float[]? Anchor = null,
        float[]? Positions = null,
        float[]? Normals = null,
        float[]? Uvs = null,
        int[]? Indices = null,
        string? Texture = null,
        string? TextureSha256 = null,
        int Width = 0,
        int Height = 0,
        bool Alpha = false,
        float Emissive = 0,
        Part[]? Parts = null);

    /* Кусок сетки украшения со своей точкой крепления (лоза). */
    private sealed record Part(
        float[]? Anchor = null,
        int Vertex = 0,
        int Vertices = 0,
        int Index = 0,
        int Indices = 0);

    /* Своя модель ствола (версия 3): листы и куски. */
    private sealed record BodyTexture(
        string? Name = null,
        string? Texture = null,
        string? TextureSha256 = null,
        int Width = 0,
        int Height = 0);

    private sealed record BodyPiece(
        string? Texture = null,
        bool Alpha = false,
        float[]? Positions = null,
        float[]? Normals = null,
        float[]? Uvs = null,
        int[]? Indices = null);

    private sealed record Body(BodyTexture[]? Textures = null, BodyPiece[]? Pieces = null);

    /* Обвесы на стволе (версия 4): листы и куски, у куска — кость ствола. */
    private sealed record AttachmentPiece(
        string? Texture = null,
        bool Alpha = false,
        string? Bone = null,
        float[]? Positions = null,
        float[]? Normals = null,
        float[]? Uvs = null,
        int[]? Indices = null);

    private sealed record Attachments(BodyTexture[]? Textures = null, AttachmentPiece[]? Pieces = null);

    private sealed record DecorateRequest(
        string Format,
        int Version,
        string? Model = null,
        Decoration[]? Decorations = null,
        bool Replace = false,
        Body? Body = null,
        Attachments? Attachments = null);
}
