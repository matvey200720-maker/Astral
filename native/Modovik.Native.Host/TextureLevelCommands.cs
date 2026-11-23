using System.Security.Cryptography;
using System.Text.Json;
using CodeWalker.GameFiles;
using RageLib.Archives;
using RageLib.GTA5.ArchiveWrappers;

namespace Modovik.Native.Host;

/// <summary>
/// Ступени «Ухудшения текстур» (задача 9, 05.10.2026).
///
/// Мод <c>retexture.rpf</c> заменяет две тысячи словарей .ytd игры теми же
/// словарями, где каждая текстура — 8×8 и одна ступень mip: игра берёт их
/// вместо своих по имени. Ползунок делает то же постепенно и из файлов самой
/// игры игрока: у каждой текстуры словаря срезаются верхние ступени mip, пока
/// её большая сторона не станет не больше предела (128, 64, 32 … px). Срезать
/// mip — не пересжимать: оставшиеся ступени лежат в данных текстуры как
/// были, меняются только размер, шаг строки и число ступеней. Формат, имя и
/// остальные поля текстуры — те же.
///
/// Запрос — файл JSON: папка игры, ключи, пределы и записи словарей
/// (<c>x64e.rpf:models/…/имя.ytd</c>, <c>update:…</c>). Каждый словарь
/// читается один раз, пределы идут от большего к меньшему на том же словаре.
/// Словарь, в котором под предел ничего не попало, не пишется: игре он не
/// нужен. Ход — строками в stderr (шаг <c>prepare</c>, байты записей).
///
/// Модели карты (<c>.ydr</c>, <c>.ydd</c>, <c>.yft</c>) — так же: у многих
/// зданий и предметов текстуры зашиты в саму модель, мимо словарей (задача 1
/// ТЗ 05.10.2026). Геометрия, шейдеры и физика модели остаются как были:
/// модель не пересохраняется, в её файле меняются только описания и байты
/// текстур (<see cref="PatchInPlace"/>), копию хост открывает снова и
/// сверяет текстуры.
///
/// После среза — стадии запроса (<c>Stages</c>, ТЗ 17.10.2026): ЧБ-мир, позже
/// стили мира (<see cref="TextureStages"/>). Вариант «предел + стадии» пишется
/// в свою папку (<c>128+grayscale</c>), рядом с чистым срезом.
/// </summary>
internal static class TextureLevelCommands
{
    /// <summary>
    /// <c>Stages</c> — стадии после среза (ЧБ, позже стили; ТЗ 17.10.2026):
    /// <see cref="TextureStages"/>. Без стадий — чистый срез, как прежде.
    /// </summary>
    private sealed record Request(
        string GameRoot,
        string? Keys,
        string OutputDirectory,
        int[] Caps,
        RequestItem[] Items,
        string[]? Stages = null);

    /// <summary>Словарь: место в игре, имя и размер записи (по нему идёт ход).</summary>
    private sealed record RequestItem(string At, string Name, long Size = 0);

    /// <summary>
    /// Ступень: предел, сколько текстур изменилось, вес и отпечаток файла,
    /// <c>Variant</c> — ключ варианта и папка вывода (<c>128</c>,
    /// <c>128+grayscale</c>), <c>Staged</c> — сколько текстур изменили стадии.
    /// </summary>
    private sealed record LevelResult(int Cap, int Changed, long Bytes, string Sha256, string Variant, int Staged = 0, int Resampled = 0);

    private sealed record ItemResult(
        string At,
        string Name,
        bool Missing = false,
        string? Error = null,
        long Original = 0,
        int Textures = 0,
        List<LevelResult>? Levels = null,
        int Unmipped = 0,
        string? Kept = null,
        string[]? CodecFailures = null);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static async Task<object> BuildAsync(string inputPath, string outputPath)
    {
        var request = JsonSerializer.Deserialize<Request>(
            await File.ReadAllTextAsync(inputPath), JsonOptions)
            ?? throw new InvalidDataException("Texture level request is empty.");
        var gameRoot = Path.GetFullPath(request.GameRoot ?? string.Empty);
        if (!Directory.Exists(gameRoot)) throw new DirectoryNotFoundException("GTA V folder was not found.");
        var caps = (request.Caps ?? [])
            .Distinct()
            .OrderByDescending(cap => cap)
            .ToArray();
        if (caps.Length == 0 || caps.Any(cap => cap < 4 || cap > 4096 || (cap & (cap - 1)) != 0))
            throw new ArgumentException("Texture caps must be powers of two between 4 and 4096.");
        var items = request.Items ?? [];
        /* Вся карта — около двадцати тысяч словарей и девяноста тысяч моделей
           (задача 1 ТЗ 05.10.2026). */
        if (items.Length == 0 || items.Length > 120000)
            throw new ArgumentException("Texture level request must name 1–120000 resources.");
        var stages = TextureStages.Normalize(request.Stages);
        var outputDirectory = Path.GetFullPath(request.OutputDirectory ?? string.Empty);
        foreach (var cap in caps) Directory.CreateDirectory(Path.Combine(outputDirectory, TextureStages.VariantKey(cap, stages)));
        KeyLoader.EnsureLoaded(gameRoot, request.Keys);

        var progress = new HostProgress();
        var results = new List<ItemResult>(items.Length);
        /* Ход — байтами записей: словари разные, от килобайта до двадцати мегабайт. */
        var total = items.Sum(item => Math.Max(1L, item.Size));
        long done = 0;
        foreach (var group in items.GroupBy(item => ArchiveLabel(item.At), StringComparer.OrdinalIgnoreCase))
        {
            var archivePath = ArchivePath(gameRoot, group.Key);
            using var archive = RageArchiveWrapper7.OpenRead(archivePath);
            var nested = new Dictionary<string, RageArchiveWrapper7>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (var item in group)
                {
                    results.Add(BuildItem(archive, nested, item, caps, stages, outputDirectory));
                    done += Math.Max(1L, item.Size);
                    progress.Report("prepare", done, total);
                }
            }
            finally
            {
                foreach (var inner in nested.Values) inner.Dispose();
            }
        }

        var report = new { caps, stages, dictionaries = items.Length, items = results };
        await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(report, JsonOptions));
        return new
        {
            output = outputPath,
            dictionaries = items.Length,
            missing = results.Count(item => item.Missing),
            failed = results.Count(item => item.Error is not null),
        };
    }

    private static ItemResult BuildItem(
        RageArchiveWrapper7 archive,
        Dictionary<string, RageArchiveWrapper7> nested,
        RequestItem item,
        int[] caps,
        string[] stages,
        string outputDirectory)
    {
        var name = Path.GetFileName(item.Name ?? string.Empty).ToLowerInvariant();
        var kind = Path.GetExtension(name);
        if (name.Length < 5 || kind is not (".ytd" or ".ydr" or ".ydd" or ".yft"))
            return new ItemResult(item.At, name, Error: "not a texture dictionary or model name");
        try
        {
            var file = FindFile(archive, nested, EntryPath(item.At));
            if (file is null) return new ItemResult(item.At, name, Missing: true);
            var bytes = ArchiveIndexCommands.DecodedBytes(file);
            /* Словарь — его текстуры; модель — текстуры, зашитые в неё самой
               (задача 1 ТЗ 05.10.2026: здания, земля и предметы карты часто
               несут свои текстуры в .ydr/.ydd/.yft, мимо словарей .ytd). */
            var (textures, save, kept) = OpenTextures(kind, name, bytes);
            if (textures is null)
                return new ItemResult(item.At, name, Error: "resource did not load");
            if (kept is not null && textures.Length > 0)
                return new ItemResult(item.At, name, Original: bytes.Length, Textures: textures.Length, Levels: [], Kept: kept);
            if (textures.Length == 0)
                return new ItemResult(item.At, name, Original: bytes.Length, Textures: 0, Levels: []);
            /* Модель — только на месте: где и какой была каждая текстура до
               среза и стадий (см. PatchInPlace). */
            var places = kind == ".ytd" ? null : textures.Select(PlaceOf).ToArray();
            var levels = new List<LevelResult>();
            var outputs = new List<(int Cap, byte[] Bytes)>();
            /* Причины сбоев кодека — в ответ команды, а не молча: иначе «не уменьшилось» не объяснить. */
            var codecFailures = new List<string>();
            foreach (var cap in caps)
            {
                var changed = 0;
                var staged = 0;
                /* Сколько текстур пересжато кодеком (без среза ступеней) — отдельно от среза. */
                var resampledCount = 0;
                /* Сначала срез ступеней mip (без пересжатия); у текстуры без
                   цепочки mip (в моделях карты их тысячи) — пересжатие. */
                foreach (var texture in textures)
                {
                    if (texture is null) continue;
                    var cut = false;
                    if (!IsLookupTexture(texture))
                    {
                        /* Ступеней mip бывает меньше, чем нужно до предела: срез
                           доводит, сколько может, остальное — пересжатие. */
                        var dropped = DropTo(texture, cap);
                        var resampled = Math.Max((int)texture.Width, texture.Height) > cap && ResampleTo(texture, cap, codecFailures);
                        cut = dropped || resampled;
                        if (resampled) resampledCount++;
                    }
                    /* Стадии — после среза, по порядку (ТЗ 17.10.2026): палитры
                       тинта срез не трогает, а ЧБ красит и их — точка в точку. */
                    var stagedHere = false;
                    foreach (var stage in stages) stagedHere |= TextureStages.Apply(texture, stage);
                    if (stagedHere) staged++;
                    if (cut || stagedHere) changed++;
                }
                if (changed == 0) continue;
                /* Модель игра читает целиком — геометрию, шейдеры, физику, и
                   пересохранённая CodeWalker модель роняла игру (19.10.2026:
                   столкновения BoundGeometry без расстановки, вылет
                   GTA5.exe+0x6186AF у дома Майкла). Поэтому у модели
                   меняются только описания и байты её текстур в исходном
                   файле; копию открываем снова и сверяем текстуры байт в байт. */
                var output = places is null ? save() : PatchInPlace(bytes, places);
                if (output is null)
                    return new ItemResult(item.At, name, Error: "model textures could not be written in place");
                if (places is not null)
                {
                    var (reopened, _, _) = OpenTextures(kind, name, output);
                    if (reopened is null || reopened.Length != textures.Length
                        || reopened.Where((texture, index) =>
                            texture.Width != textures[index].Width
                            || texture.Height != textures[index].Height
                            || texture.Stride != textures[index].Stride
                            || texture.Levels != textures[index].Levels
                            || texture.Format != textures[index].Format
                            || texture.Data?.FullData is not { } data
                            || !data.AsSpan().SequenceEqual(textures[index].Data.FullData)).Any())
                        return new ItemResult(item.At, name, Error: "model did not survive a save");
                }
                outputs.Add((cap, output));
                levels.Add(new LevelResult(
                    cap,
                    changed,
                    output.Length,
                    Convert.ToHexString(SHA256.HashData(output)).ToLowerInvariant(),
                    TextureStages.VariantKey(cap, stages),
                    staged,
                    resampledCount));
            }
            foreach (var (cap, output) in outputs)
                File.WriteAllBytes(Path.Combine(outputDirectory, TextureStages.VariantKey(cap, stages), name), output);
            /* Что так и осталось больше предела: формат, который хост не
               читает (отчёт называет их число). */
            var smallest = caps.Min();
            var unmipped = textures.Count(texture => texture is not null && !IsLookupTexture(texture) && Math.Max((int)texture.Width, texture.Height) > smallest);
            return new ItemResult(
                item.At,
                name,
                Original: bytes.Length,
                Textures: textures.Length,
                Levels: levels,
                Unmipped: unmipped,
                CodecFailures: codecFailures.Count == 0 ? null : codecFailures.Distinct().ToArray());
        }
        catch (Exception error)
        {
            return new ItemResult(item.At, name, Error: error.Message);
        }
    }

    /// <summary>
    /// Текстуры ресурса и как его сохранить: у словаря — его текстуры, у
    /// модели — встроенные словари всех её drawable (у фрагмента — основной,
    /// массив и ткань). Одна текстура, на которую ссылаются несколько
    /// drawable, — один раз. <c>null</c> — ресурс не открылся. <c>Kept</c> —
    /// почему модель остаётся как в игре: ткань (флаги, навесы) и бьющиеся
    /// стёкла фрагмента — своя физика, которую CodeWalker пишет не
    /// наверняка, а вылет в игре дороже мутной текстуры.
    /// </summary>
    private static (Texture[]? Textures, Func<byte[]> Save, string? Kept) OpenTextures(string kind, string name, byte[] bytes)
    {
        static IEnumerable<Texture> Embedded(DrawableBase? drawable) =>
            drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items?.Where(texture => texture is not null) ?? [];
        static Texture[] Distinct(IEnumerable<Texture> textures) => textures.Distinct(ReferenceEqualityComparer.Instance).Cast<Texture>().ToArray();
        switch (kind)
        {
            case ".ytd":
            {
                var ytd = new YtdFile { Name = name };
                ytd.Load(bytes);
                var textures = ytd.TextureDict?.Textures?.data_items;
                return (ytd.Loaded && textures is not null ? textures.Where(texture => texture is not null).ToArray() : null, ytd.Save, null);
            }
            case ".ydr":
            {
                var ydr = new YdrFile { Name = name };
                ydr.Load(bytes);
                return (ydr.Loaded && ydr.Drawable is not null ? Distinct(Embedded(ydr.Drawable)) : null, ydr.Save, null);
            }
            case ".ydd":
            {
                var ydd = new YddFile { Name = name };
                ydd.Load(bytes);
                return (ydd.Loaded && ydd.Drawables is not null ? Distinct(ydd.Drawables.SelectMany(Embedded)) : null, ydd.Save, null);
            }
            default:
            {
                var yft = new YftFile { Name = name };
                yft.Load(bytes);
                var fragment = yft.Fragment;
                if (!yft.Loaded || fragment is null) return (null, yft.Save, null);
                var drawables = new List<DrawableBase?> { fragment.Drawable, fragment.DrawableCloth };
                if (fragment.DrawableArray?.data_items is { } array) drawables.AddRange(array);
                var kept = fragment.GlassWindowsCount > 0 || fragment.Cloths?.data_items?.Length > 0 || fragment.DrawableCloth is not null
                    ? "cloth or glass"
                    : null;
                return (Distinct(drawables.SelectMany(Embedded)), yft.Save, kept);
            }
        }
    }

    /// <summary>
    /// Текстура модели, какой её прочли из файла: указатель на её данные,
    /// поля описания и сколько байт данных под указателем.
    /// </summary>
    internal sealed record TexturePlace(
        Texture Texture,
        ulong DataPointer,
        ushort Width,
        ushort Height,
        ushort Stride,
        byte Levels,
        TextureFormat Format,
        int DataLength);

    internal static TexturePlace PlaceOf(Texture texture) => new(
        texture,
        texture.DataPointer,
        texture.Width,
        texture.Height,
        texture.Stride,
        texture.Levels,
        texture.Format,
        texture.Data?.FullData?.Length ?? 0);

    /* Описание текстуры Legacy (rage::grcTexturePC): от его начала ширина
       0x50, высота 0x52, глубина 0x54, шаг строки 0x56, формат 0x58, число
       ступеней 0x5D, указатель данных 0x70 (CodeWalker Texture.Read). */
    private const int TextureWidthAt = 0x50;
    private const int TextureHeightAt = 0x52;
    private const int TextureStrideAt = 0x56;
    private const int TextureFormatAt = 0x58;
    private const int TextureLevelsAt = 0x5D;
    private const int TextureDataPointerAt = 0x70;

    /// <summary>
    /// Модель с новыми текстурами — тот же файл ресурса, где поменялись только
    /// описания текстур (размер, шаг строки, формат, число ступеней) и байты
    /// их данных: новые данные (срез, пересжатие, стадии — не длиннее
    /// прежних) пишутся с начала прежних, хвост обнуляется. Геометрия,
    /// шейдеры, физика и раскладка страниц остаются байт в байт как в игре.
    /// Описание ищется по указателю данных в системной части и сверяется со
    /// всеми прочитанными полями. <c>null</c> — не вышло (Enhanced-раскладка,
    /// данные длиннее, два описания на одни данные): модель остаётся штатной.
    /// </summary>
    internal static byte[]? PatchInPlace(byte[] original, IReadOnlyList<TexturePlace> places)
    {
        if (original.Length <= 16 || BitConverter.ToUInt32(original, 0) != 0x37435352) return null;
        var entry = new RpfResourceFileEntry
        {
            SystemFlags = BitConverter.ToUInt32(original, 8),
            GraphicsFlags = BitConverter.ToUInt32(original, 12),
        };
        long systemSize = entry.SystemSize;
        long graphicsSize = entry.GraphicsSize;
        var data = ResourceBuilder.DecompressResource(original.AsSpan(16).ToArray(), entry);
        if (systemSize <= 0 || data.LongLength < systemSize + graphicsSize) return null;

        long Offset(ulong pointer)
        {
            var value = (long)pointer;
            if ((value & 0x50000000) == 0x50000000)
            {
                var system = value & ~0x50000000L;
                return system < systemSize ? system : -1;
            }
            if ((value & 0x60000000) == 0x60000000)
            {
                var graphics = value & ~0x60000000L;
                return graphics < graphicsSize ? systemSize + graphics : -1;
            }
            return -1;
        }

        /* Что менять: текстуры, у которых поменялось описание или байты. */
        var pending = new List<(TexturePlace Place, long DataAt)>();
        foreach (var place in places)
        {
            var texture = place.Texture;
            var pixels = texture.Data?.FullData;
            var dataAt = Offset(place.DataPointer);
            if (pixels is null || dataAt < 0 || pixels.Length > place.DataLength || dataAt + place.DataLength > data.LongLength) return null;
            var same = texture.Width == place.Width && texture.Height == place.Height && texture.Stride == place.Stride
                && texture.Levels == place.Levels && texture.Format == place.Format && pixels.Length == place.DataLength
                && data.AsSpan((int)dataAt, place.DataLength).SequenceEqual(pixels);
            if (!same) pending.Add((place, dataAt));
        }
        if (pending.Count == 0) return null;

        /* Описание каждой из них: ровно одно в системной части, где указатель
           данных и все прочитанные поля — те же. Системная часть — один проход. */
        var headers = pending.ToDictionary(item => item.Place.DataPointer, _ => new List<long>());
        if (headers.Count != pending.Count) return null;
        for (long at = 0; at + TextureDataPointerAt + 8 <= systemSize; at += 8)
        {
            if (!headers.TryGetValue(BitConverter.ToUInt64(data, (int)(at + TextureDataPointerAt)), out var found)) continue;
            found.Add(at);
        }
        foreach (var (place, dataAt) in pending)
        {
            var matches = headers[place.DataPointer].Where(at =>
                BitConverter.ToUInt16(data, (int)(at + TextureWidthAt)) == place.Width
                && BitConverter.ToUInt16(data, (int)(at + TextureHeightAt)) == place.Height
                && BitConverter.ToUInt16(data, (int)(at + TextureStrideAt)) == place.Stride
                && BitConverter.ToUInt32(data, (int)(at + TextureFormatAt)) == (uint)place.Format
                && data[at + TextureLevelsAt] == place.Levels).ToArray();
            if (matches.Length != 1) return null;
            var header = matches[0];
            var texture = place.Texture;
            var pixels = texture.Data.FullData;
            BitConverter.TryWriteBytes(data.AsSpan((int)(header + TextureWidthAt)), texture.Width);
            BitConverter.TryWriteBytes(data.AsSpan((int)(header + TextureHeightAt)), texture.Height);
            BitConverter.TryWriteBytes(data.AsSpan((int)(header + TextureStrideAt)), texture.Stride);
            BitConverter.TryWriteBytes(data.AsSpan((int)(header + TextureFormatAt)), (uint)texture.Format);
            data[header + TextureLevelsAt] = texture.Levels;
            pixels.CopyTo(data.AsSpan((int)dataAt));
            data.AsSpan((int)dataAt + pixels.Length, place.DataLength - pixels.Length).Clear();
        }

        var compressed = ResourceBuilder.Compress(data);
        var output = new byte[16 + compressed.Length];
        Buffer.BlockCopy(original, 0, output, 0, 16);
        Buffer.BlockCopy(compressed, 0, output, 16, compressed.Length);
        return output;
    }

    /// <summary>
    /// Срезает верхние ступени mip, пока большая сторона больше предела.
    /// Данные текстуры игры лежат ступенями подряд, у каждой — шаг строки ×
    /// высота, следующая вчетверо меньше (так их читает CodeWalker); если
    /// данные этому не отвечают, текстура остаётся как есть.
    /// </summary>
    internal static bool DropTo(Texture texture, int cap)
    {
        var data = texture.Data?.FullData;
        if (data is null || texture.Levels <= 1 || texture.Depth > 1) return false;
        var blocks = IsBlockCompressed(texture.Format);
        int width = texture.Width, height = texture.Height;
        var drop = 0;
        while (Math.Max(width >> drop, height >> drop) > cap && drop + 1 < texture.Levels)
        {
            var nextWidth = width >> (drop + 1);
            var nextHeight = height >> (drop + 1);
            if (nextWidth < (blocks ? 4 : 1) || nextHeight < (blocks ? 4 : 1)) break;
            drop++;
        }
        if (drop == 0) return false;

        long LevelsBytes(long first, int count)
        {
            long total = 0;
            for (var i = 0; i < count; i++)
            {
                total += first;
                first /= 4;
            }
            return total;
        }

        var top = (long)texture.Stride * texture.Height;
        if (LevelsBytes(top, texture.Levels) != data.LongLength) return false;
        var skip = LevelsBytes(top, drop);
        var stride = texture.Stride >> drop;
        var newHeight = height >> drop;
        var newLevels = texture.Levels - drop;
        var rest = data.LongLength - skip;
        if (stride < 1 || LevelsBytes((long)stride * newHeight, newLevels) != rest) return false;

        texture.Width = (ushort)(width >> drop);
        texture.Height = (ushort)newHeight;
        texture.Stride = (ushort)stride;
        texture.Levels = (byte)newLevels;
        texture.Data.FullData = data.AsSpan((int)skip, (int)rest).ToArray();
        return true;
    }

    /// <summary>
    /// Формат, который хост умеет разжать и сжать обратно: байты верхней
    /// ступени по размеру, RGBA из байт и байты из RGBA, наименьшая сторона
    /// (у блочного сжатия — 4) и в каком формате писать. BC7 пишется в DXT5:
    /// сжатие BC7 на процессоре медленное, а на 8–128 px разницы нет.
    /// </summary>
    internal sealed record Codec(
        TextureFormat Output,
        int Min,
        Func<int, int, int> Bytes,
        Func<byte[], int, int, byte[]> Decode,
        Func<byte[], int, int, byte[]> Encode);

    private static Func<int, int, int> BlockBytes(int block) => (width, height) => ((width + 3) / 4) * ((height + 3) / 4) * block;

    private static Codec Block(TextureFormat format, int block, uint code) => new(
        format,
        4,
        BlockBytes(block),
        (pixels, width, height) => AstralCodec.Decode(code, pixels, width, height),
        (pixels, width, height) => AstralCodec.Encode(code, pixels, width, height));

    internal static Codec? CodecOf(TextureFormat format) => format switch
    {
        /* Блоки — через кодек BC (`AstralCodec`, astral_codec.dll, без DirectXTex). BC7 читаем им, пишем как BC3. */
        TextureFormat.D3DFMT_DXT1 => Block(format, 8, AstralCodec.Bc1),
        TextureFormat.D3DFMT_DXT3 => Block(format, 16, AstralCodec.Bc2),
        TextureFormat.D3DFMT_DXT5 => Block(format, 16, AstralCodec.Bc3),
        TextureFormat.D3DFMT_ATI1 => Block(format, 8, AstralCodec.Bc4),
        TextureFormat.D3DFMT_ATI2 => Block(format, 16, AstralCodec.Bc5),
        TextureFormat.D3DFMT_BC7 => new(
            TextureFormat.D3DFMT_DXT5,
            4,
            BlockBytes(16),
            (pixels, width, height) => AstralCodec.Decode(AstralCodec.Bc7, pixels, width, height),
            (pixels, width, height) => AstralCodec.Encode(AstralCodec.Bc3, pixels, width, height)),
        TextureFormat.D3DFMT_A8R8G8B8 or TextureFormat.D3DFMT_X8R8G8B8 =>
            new(format, 1, (width, height) => width * height * 4, SwapRedBlue, SwapRedBlue),
        TextureFormat.D3DFMT_A8B8G8R8 => new(format, 1, (width, height) => width * height * 4, (pixels, _, _) => pixels, (pixels, _, _) => pixels),
        TextureFormat.D3DFMT_L8 => new(format, 1, (width, height) => width * height, FromLuminance, (pixels, _, _) => Channel(pixels, 0)),
        TextureFormat.D3DFMT_A8 => new(format, 1, (width, height) => width * height, FromAlpha, (pixels, _, _) => Channel(pixels, 3)),
        _ => null,
    };

    private static byte[] SwapRedBlue(byte[] pixels, int width, int height)
    {
        var result = (byte[])pixels.Clone();
        for (var at = 0; at + 3 < result.Length; at += 4) (result[at], result[at + 2]) = (result[at + 2], result[at]);
        return result;
    }

    private static byte[] FromLuminance(byte[] pixels, int width, int height)
    {
        var result = new byte[pixels.Length * 4];
        for (var index = 0; index < pixels.Length; index++)
        {
            result[index * 4] = result[index * 4 + 1] = result[index * 4 + 2] = pixels[index];
            result[index * 4 + 3] = 255;
        }
        return result;
    }

    private static byte[] FromAlpha(byte[] pixels, int width, int height)
    {
        var result = new byte[pixels.Length * 4];
        for (var index = 0; index < pixels.Length; index++) result[index * 4 + 3] = pixels[index];
        return result;
    }

    private static byte[] Channel(byte[] rgba, int channel)
    {
        var result = new byte[rgba.Length / 4];
        for (var index = 0; index < result.Length; index++) result[index] = rgba[index * 4 + channel];
        return result;
    }

    /// <summary>Усреднение по площади: каждая точка — среднее своего окна исходника.</summary>
    /*
     * Таблица, а не картинка: палитра тинта (`…_pal`, `…_l1_pal` — 256×4,
     * столбец — цвет по `tintValue` сущности, хвост залит пурпурным) и
     * полоски-таблицы того же вида. Сжатие усредняло столбцы с пурпурной
     * заливкой: тонированные заборы и контейнеры всей карты становились
     * фиолетовыми (фикс 2 ТЗ 06.10.2026). Такие текстуры остаются как были.
     */
    internal static bool IsLookupTexture(Texture texture)
    {
        var name = (texture.Name ?? string.Empty).ToLowerInvariant();
        if (name.EndsWith("_pal") || name.Contains("_pal_") || name.EndsWith("_lut") || name.Contains("palette")) return true;
        return texture.Height <= 8 && texture.Width >= 16 * Math.Max(1, (int)texture.Height);
    }

    internal static byte[] Shrink(byte[] source, int sourceWidth, int sourceHeight, int width, int height)
    {
        var result = new byte[width * height * 4];
        for (var y = 0; y < height; y++)
        {
            var y0 = (int)((long)y * sourceHeight / height);
            var y1 = Math.Max(y0 + 1, (int)((long)(y + 1) * sourceHeight / height));
            for (var x = 0; x < width; x++)
            {
                var x0 = (int)((long)x * sourceWidth / width);
                var x1 = Math.Max(x0 + 1, (int)((long)(x + 1) * sourceWidth / width));
                long r = 0, g = 0, b = 0, a = 0;
                var count = 0;
                for (var row = y0; row < y1; row++)
                    for (var column = x0; column < x1; column++)
                    {
                        var at = (row * sourceWidth + column) * 4;
                        r += source[at];
                        g += source[at + 1];
                        b += source[at + 2];
                        a += source[at + 3];
                        count++;
                    }
                var target = (y * width + x) * 4;
                result[target] = (byte)((r + count / 2) / count);
                result[target + 1] = (byte)((g + count / 2) / count);
                result[target + 2] = (byte)((b + count / 2) / count);
                result[target + 3] = (byte)((a + count / 2) / count);
            }
        }
        return result;
    }

    /// <summary>
    /// Текстура без ступеней mip (или с данными не по раскладке) — уменьшить
    /// саму картинку: разжать верхнюю ступень, усреднить до предела стороны и
    /// собрать свою цепочку mip, каждая ступень вчетверо меньше прежней (так
    /// её читает и игра, и <see cref="DropTo"/> на следующем пределе). Формат,
    /// который хост не читает, остаётся как есть.
    /// </summary>
    internal static bool ResampleTo(Texture texture, int cap, List<string>? failures = null)
    {
        int width = texture.Width, height = texture.Height;
        if (Math.Max(width, height) <= cap || texture.Depth > 1 || width > 8192 || height > 8192) return false;
        var data = texture.Data?.FullData;
        var codec = CodecOf(texture.Format);
        if (data is null || codec is null) return false;
        var topBytes = codec.Bytes(width, height);
        /* Верхняя ступень — плотно, без хвостов строк: иначе её не прочесть. */
        if (topBytes <= 0 || data.Length < topBytes || (long)texture.Stride * height != topBytes) return false;
        byte[] pixels;
        try
        {
            pixels = codec.Decode(data.AsSpan(0, topBytes).ToArray(), width, height);
        }
        catch (Exception error)
        {
            failures?.Add($"decode {texture.Format} {width}x{height}: {error.Message}");
            return false;
        }
        if (pixels is null || pixels.Length != width * height * 4)
        {
            failures?.Add($"decode {texture.Format} {width}x{height}: got {pixels?.Length ?? 0} bytes");
            return false;
        }

        /* Сторона ступени: блочному сжатию — кратная четырём и не меньше
           четырёх, иначе вдвое меньше прежней. */
        int Fit(int side) => codec.Min == 4 ? Math.Max(4, side / 4 * 4) : Math.Max(1, side);
        var targetWidth = width;
        var targetHeight = height;
        while (Math.Max(targetWidth, targetHeight) > cap)
        {
            var nextWidth = Fit(targetWidth / 2);
            var nextHeight = Fit(targetHeight / 2);
            if (nextWidth == targetWidth && nextHeight == targetHeight) break;
            targetWidth = nextWidth;
            targetHeight = nextHeight;
        }
        if (targetWidth == width && targetHeight == height) return false;

        var level = Shrink(pixels, width, height, targetWidth, targetHeight);
        var chain = new List<byte[]>();
        int levelWidth = targetWidth, levelHeight = targetHeight;
        try
        {
            while (true)
            {
                var encoded = codec.Encode(level, levelWidth, levelHeight);
                if (encoded.Length != codec.Bytes(levelWidth, levelHeight))
                {
                    failures?.Add($"encode {codec.Output} {levelWidth}x{levelHeight}: got {encoded.Length} bytes");
                    return false;
                }
                chain.Add(encoded);
                /* Следующая ступень — ровно вдвое по обеим сторонам, иначе
                   цепочка кончается: правило «вчетверо меньше» держится. */
                var nextWidth = levelWidth / 2;
                var nextHeight = levelHeight / 2;
                var even = levelWidth % 2 == 0 && levelHeight % 2 == 0;
                var blocks = codec.Min != 4 || (nextWidth % 4 == 0 && nextHeight % 4 == 0);
                if (!even || !blocks || nextWidth < codec.Min || nextHeight < codec.Min) break;
                level = Shrink(level, levelWidth, levelHeight, nextWidth, nextHeight);
                levelWidth = nextWidth;
                levelHeight = nextHeight;
            }
        }
        catch (Exception error)
        {
            failures?.Add($"encode {codec.Output} {targetWidth}x{targetHeight}: {error.Message}");
            return false;
        }

        var top = chain[0].Length;
        if (top % targetHeight != 0 || top / targetHeight > ushort.MaxValue) return false;
        texture.Format = codec.Output;
        texture.Width = (ushort)targetWidth;
        texture.Height = (ushort)targetHeight;
        texture.Stride = (ushort)(top / targetHeight);
        texture.Levels = (byte)chain.Count;
        texture.Data.FullData = chain.SelectMany(bytes => bytes).ToArray();
        return true;
    }

    private static bool IsBlockCompressed(TextureFormat format) => format is
        TextureFormat.D3DFMT_DXT1 or TextureFormat.D3DFMT_DXT3 or TextureFormat.D3DFMT_DXT5 or
        TextureFormat.D3DFMT_ATI1 or TextureFormat.D3DFMT_ATI2 or TextureFormat.D3DFMT_BC7;

    private static string ArchiveLabel(string at)
    {
        var colon = (at ?? string.Empty).IndexOf(':');
        if (colon <= 0) throw new ArgumentException($"Dictionary place has no archive: {at}");
        return at[..colon];
    }

    private static string EntryPath(string at) => at[(at.IndexOf(':') + 1)..].Replace((char)92, '/').Trim('/');

    /// <summary>
    /// Архив игры по метке описи: <c>update</c> — update.rpf, <c>x64e.rpf</c> —
    /// базовый, <c>update/x64/dlcpacks/&lt;пакет&gt;/dlc.rpf</c> — пакет дополнения
    /// (словари карты из пакетов Rockstar, задача 1 ТЗ 05.10.2026).
    /// </summary>
    private static string ArchivePath(string gameRoot, string label)
    {
        var relative = label.Equals("update", StringComparison.OrdinalIgnoreCase)
            ? Path.Combine("update", "update.rpf")
            : System.Text.RegularExpressions.Regex.IsMatch(label, "^x64[a-z]\\.rpf$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                ? label
                : System.Text.RegularExpressions.Regex.IsMatch(label, "^update/x64/dlcpacks/[a-z0-9_]{1,40}/dlc\\.rpf$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                    ? Path.Combine(label.Split('/'))
                    : throw new ArgumentException($"Unsupported archive label: {label}");
        var full = Path.GetFullPath(Path.Combine(gameRoot, relative));
        if (!File.Exists(full)) throw new FileNotFoundException($"Archive was not found: {relative}");
        return full;
    }

    /// <summary>
    /// Запись по пути: папки — папками, вложенный <c>.rpf</c> открывается один
    /// раз и держится до конца архива (в одном вложенном лежат десятки словарей).
    /// </summary>
    private static IArchiveFile? FindFile(
        RageArchiveWrapper7 archive,
        Dictionary<string, RageArchiveWrapper7> nested,
        string entry)
    {
        var segments = entry.Split('/', StringSplitOptions.RemoveEmptyEntries);
        IArchiveDirectory directory = archive.Root;
        var path = string.Empty;
        for (var index = 0; index < segments.Length - 1; index++)
        {
            var segment = segments[index];
            path = path.Length == 0 ? segment : $"{path}/{segment}";
            if (segment.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                if (!nested.TryGetValue(path, out var inner))
                {
                    if (directory.GetFile(segment) is not IArchiveBinaryFile container) return null;
                    inner = RageArchiveWrapper7.Open(container.GetStream(), segment, leaveOpen: false);
                    nested[path] = inner;
                }
                directory = inner.Root;
                continue;
            }
            var next = directory.GetDirectory(segment);
            if (next is null) return null;
            directory = next;
        }
        return directory.GetFile(segments[^1]);
    }
}
