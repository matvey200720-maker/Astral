using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Стадии конвейера текстур мира (ТЗ 17.10.2026, задача 10: ЧБ-мир).
///
/// Проход <c>downscale-textures</c> у каждой текстуры словаря или модели карты
/// делает по порядку: срез верхних ступеней mip до предела стороны
/// (<see cref="TextureLevelCommands"/>), затем стадии из запроса в порядке
/// <see cref="Order"/>: стиль мира (<see cref="TextureStyles"/>: рисованный,
/// комикс, мультяшный, акварель, ретро — один из них или ни одного) и ЧБ.
/// Стиль стоит ДО ЧБ: включённый ЧБ-мир красит в серый уже стилизованные
/// текстуры. Порядок и имена — копия <c>@modovik/optimizer/texture-stages.js</c>.
///
/// Как добавить стадию: имя — в <see cref="Order"/> на своё место, ветка — в
/// <see cref="Apply"/>. Стадии, которой нужны пиксели целиком (стиль мира),
/// — <see cref="TransformLevels"/>: каждая ступень mip разжимается в RGBA,
/// уходит функции стадии и сжимается обратно в тот же формат того же веса
/// (BC7 — в DXT5 того же веса), поэтому память видеокарты и вес пакета не
/// растут и игра не тормозит.
///
/// ЧБ (<see cref="Grayscale"/>) красит только цвет: нормали и блеск — данные
/// освещения (по имени и, у нормалей, по содержимому), одноканальные форматы
/// (ATI1/ATI2/L8/A8) цвета не несут. Блочное сжатие DXT красится без
/// пересжатия: цвет блока — смесь двух его концов, и яркость смеси — смесь
/// яркостей, поэтому серыми становятся концы, а индексы точек остаются
/// (порядок концов держится: от него зависит режим блока DXT1 с
/// прозрачностью). Палитры тинта (<c>_pal</c>) красятся точка в точку — это
/// цвета заборов и контейнеров, им ЧБ нужен.
/// </summary>
internal static class TextureStages
{
    public const string Grayscale = "grayscale";

    /// <summary>Стадии в порядке прохода: стиль мира, потом ЧБ.</summary>
    public static readonly string[] Order = [.. TextureStyles.All, Grayscale];

    /// <summary>Стадии запроса по порядку прохода; незнакомая — отказ, стилей больше одного — тоже.</summary>
    public static string[] Normalize(IEnumerable<string>? stages)
    {
        var list = (stages ?? []).Select(stage => (stage ?? string.Empty).Trim().ToLowerInvariant()).Distinct().ToArray();
        foreach (var stage in list)
            if (!Order.Contains(stage)) throw new ArgumentException($"Unknown texture stage: {stage}");
        if (list.Count(TextureStyles.IsStyle) > 1) throw new ArgumentException("Only one world style can be applied at a time.");
        return Order.Where(list.Contains).ToArray();
    }

    /// <summary>Папка и ключ варианта: <c>128</c> у чистого среза, <c>128+grayscale</c> со стадиями.</summary>
    public static string VariantKey(int cap, string[] stages) =>
        stages.Length == 0 ? cap.ToString() : $"{cap}+{string.Join("+", stages)}";

    /// <summary>Стадия на текстуре; <c>true</c> — данные изменились.</summary>
    public static bool Apply(Texture texture, string stage) => stage switch
    {
        Grayscale => ToGray(texture),
        _ when TextureStyles.IsStyle(stage) => TextureStyles.ToStyle(texture, stage),
        _ => throw new ArgumentException($"Unknown texture stage: {stage}"),
    };

    /* ── Что красится ──────────────────────────────────────────────────── */

    /* Карты освещения по имени: нормали и блеск (копия `isLightingDataTexture`). */
    private static readonly Regex LightingData = new("_(?:n|nm|nrm|norm|normal|dn|bump|s|sp|spec|specular)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    internal static bool IsLightingDataName(string? name) => LightingData.IsMatch(name ?? string.Empty);

    /*
     * Упакованные данные по имени (задача 35, а): карты высот `…_h` (у терраина
     * и дорог `nxg_*_h` — каналы RGB несут высоту и вспомогательные карты, а не
     * цвет: оранжево-зелёные и пурпурные «картинки»), прожекторные маски
     * `…_gobo`, маски и таблицы (`_mask`, `_msk`, `_ao`, `_lightmap`, `_ramp`).
     * Стиль красил их постеризацией и контурами, а ЧБ сводил каналы в яркость —
     * шейдер получал не те высоты и маски. Копия `isPackedDataTexture`.
     */
    private static readonly Regex PackedData = new("_(?:h|gobo|mask|msk|ao|lightmap|ramp)\\d*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    internal static bool IsPackedDataName(string? name) => PackedData.IsMatch(name ?? string.Empty);

    /// <summary>
    /// Несёт ли текстура цвет: формат с цветом, имя — не нормаль, не блеск и не
    /// упакованные данные, а содержимое — не голубая карта нормалей около
    /// (128, 128, 255) (у Rockstar есть нормали без суффикса:
    /// <c>env_noise_concrete</c>, детали <c>_l1</c>).
    /// </summary>
    internal static bool IsColourTexture(Texture texture)
    {
        if (texture.Depth > 1 || IsLightingDataName(texture.Name) || IsPackedDataName(texture.Name)) return false;
        var data = texture.Data?.FullData;
        if (data is null || data.Length == 0) return false;
        return texture.Format switch
        {
            TextureFormat.D3DFMT_DXT1 => !LooksLikeNormals(data, 8, 0),
            TextureFormat.D3DFMT_DXT3 or TextureFormat.D3DFMT_DXT5 => !LooksLikeNormals(data, 16, 8),
            TextureFormat.D3DFMT_BC7 => true,
            TextureFormat.D3DFMT_A8R8G8B8 or TextureFormat.D3DFMT_X8R8G8B8 or TextureFormat.D3DFMT_A8B8G8R8 => true,
            _ => false,
        };
    }

    /* Концы блоков верхней ступени: больше половины — «голубые нормали». */
    private static bool LooksLikeNormals(byte[] data, int blockBytes, int colourAt)
    {
        var blocks = data.Length / blockBytes;
        if (blocks == 0) return false;
        var step = Math.Max(1, blocks / 1024);
        int seen = 0, normal = 0;
        for (var block = 0; block < blocks; block += step)
            for (var end = 0; end < 2; end++)
            {
                var colour = BitConverter.ToUInt16(data, block * blockBytes + colourAt + end * 2);
                var (r, g, b) = Expand565(colour);
                seen++;
                if (b > 200 && Math.Abs(r - 128) < 50 && Math.Abs(g - 128) < 50) normal++;
            }
        return normal * 2 > seen;
    }

    /* ── ЧБ ────────────────────────────────────────────────────────────── */

    /// <summary>Яркость по Rec. 709 (как <c>grayLuma</c> окна), 0…255.</summary>
    internal static int Luma(int r, int g, int b) =>
        Math.Clamp((int)Math.Round(0.2126 * r + 0.7152 * g + 0.0722 * b, MidpointRounding.AwayFromZero), 0, 255);

    internal static (int R, int G, int B) Expand565(ushort colour)
    {
        int r = (colour >> 11) & 31, g = (colour >> 5) & 63, b = colour & 31;
        return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2));
    }

    /// <summary>Серый цвет RGB565 яркости <paramref name="luma"/>.</summary>
    internal static ushort Gray565(int luma)
    {
        var r = (luma * 31 + 127) / 255;
        var g = (luma * 63 + 127) / 255;
        return (ushort)((r << 11) | (g << 5) | r);
    }

    internal static ushort GrayOf565(ushort colour)
    {
        var (r, g, b) = Expand565(colour);
        return Gray565(Luma(r, g, b));
    }

    /// <summary>Текстура — в серый; <c>false</c> — она не про цвет или её данные не того вида.</summary>
    internal static bool ToGray(Texture texture)
    {
        if (!IsColourTexture(texture)) return false;
        var data = texture.Data!.FullData!;
        switch (texture.Format)
        {
            case TextureFormat.D3DFMT_DXT1:
                return GrayBlocks(data, 8, 0, punchThrough: true);
            case TextureFormat.D3DFMT_DXT3:
            case TextureFormat.D3DFMT_DXT5:
                return GrayBlocks(data, 16, 8, punchThrough: false);
            case TextureFormat.D3DFMT_A8R8G8B8:
            case TextureFormat.D3DFMT_X8R8G8B8:
                return GrayPixels(data, red: 2, green: 1, blue: 0);
            case TextureFormat.D3DFMT_A8B8G8R8:
                return GrayPixels(data, red: 0, green: 1, blue: 2);
            case TextureFormat.D3DFMT_BC7:
                /* BC7 без пересжатия не покрасить: разжать, покрасить и сжать
                   в DXT5 того же веса (16 байт на блок) — как срез ступеней. */
                return TransformLevels(texture, (pixels, _, _) =>
                {
                    for (var at = 0; at + 3 < pixels.Length; at += 4)
                    {
                        var y = (byte)Luma(pixels[at], pixels[at + 1], pixels[at + 2]);
                        pixels[at] = pixels[at + 1] = pixels[at + 2] = y;
                    }
                    return pixels;
                });
            default:
                return false;
        }
    }

    /*
     * Данные текстуры CodeWalker читает по шагу строки: каждая следующая
     * ступень — вчетверо меньше прежней, и у полной цепочки mip хвост (2×2
     * и 1×1 — неполный блок) обрезан: 128×128 DXT1 — 10 922 байта вместо
     * 10 936. Поэтому красятся целые блоки, а неполный хвост остаётся как
     * есть — это точки в одну-две, видные только с километра.
     *
     * Блоки DXT на месте, все ступени mip подряд. Концы — серые той же
     * яркости. Порядок концов держится: у DXT1 «первый больше второго» —
     * четыре цвета, иначе три и прозрачная точка; поменялся порядок — концы
     * меняются местами, индексы — следом. Сравнялись концы — все точки блока
     * одного серого: индексы в ноль (прозрачности в блоке не было, раз он
     * был четырёхцветным). У DXT3/DXT5 цвет всегда четырёхцветный, но порядок
     * держится так же — так блок читают одинаково любые декодеры.
     */
    private static bool GrayBlocks(byte[] data, int blockBytes, int colourAt, bool punchThrough)
    {
        var changed = false;
        for (var at = colourAt; at - colourAt + blockBytes <= data.Length; at += blockBytes)
        {
            var c0 = BitConverter.ToUInt16(data, at);
            var c1 = BitConverter.ToUInt16(data, at + 2);
            var indices = BitConverter.ToUInt32(data, at + 4);
            var g0 = GrayOf565(c0);
            var g1 = GrayOf565(c1);
            var fourColour = !punchThrough || c0 > c1;
            if (fourColour)
            {
                if (g0 < g1)
                {
                    (g0, g1) = (g1, g0);
                    indices ^= 0x55555555u; // 0↔1, 2↔3
                }
                else if (g0 == g1) indices = 0;
            }
            else if (g0 > g1)
            {
                /* Три цвета и прозрачная: концы местами, 0↔1, середина и
                   прозрачная остаются. */
                (g0, g1) = (g1, g0);
                uint next = 0;
                for (var pixel = 0; pixel < 16; pixel++)
                {
                    var index = (indices >> (pixel * 2)) & 3u;
                    if (index < 2) index ^= 1u;
                    next |= index << (pixel * 2);
                }
                indices = next;
            }
            if (g0 == c0 && g1 == c1 && indices == BitConverter.ToUInt32(data, at + 4)) continue;
            BitConverter.TryWriteBytes(data.AsSpan(at, 2), g0);
            BitConverter.TryWriteBytes(data.AsSpan(at + 2, 2), g1);
            BitConverter.TryWriteBytes(data.AsSpan(at + 4, 4), indices);
            changed = true;
        }
        return changed;
    }

    private static bool GrayPixels(byte[] data, int red, int green, int blue)
    {
        var changed = false;
        for (var at = 0; at + 4 <= data.Length; at += 4)
        {
            var y = (byte)Luma(data[at + red], data[at + green], data[at + blue]);
            if (data[at] == y && data[at + 1] == y && data[at + 2] == y) continue;
            data[at + red] = data[at + green] = data[at + blue] = y;
            changed = true;
        }
        return changed;
    }

    /* ── Пиксели ступеней (для стилей) ─────────────────────────────────── */

    /// <summary>
    /// Каждая ступень mip — в RGBA (сторона, кратная блоку), функции стадии и
    /// обратно в тот же формат того же веса (BC7 — в DXT5). Данные — как их
    /// держит CodeWalker: ступени подряд, хвост полной цепочки обрезан (см.
    /// <see cref="GrayBlocks"/>); ступень, что легла не целиком, собирается
    /// из прежней уменьшением и кладётся сколько влезает — формат хвоста тот
    /// же, что у остальных. Формат хост не читает или данных меньше верхней
    /// ступени — текстура остаётся как есть (<c>false</c>).
    /// </summary>
    internal static bool TransformLevels(Texture texture, Func<byte[], int, int, byte[]> pixels)
    {
        var codec = TextureLevelCommands.CodecOf(texture.Format);
        var data = texture.Data?.FullData;
        if (codec is null || data is null || texture.Depth > 1 || texture.Levels < 1) return false;
        int Side(int side) => codec.Min == 4 ? Math.Max(4, (side + 3) / 4 * 4) : Math.Max(1, side);
        var output = (byte[])data.Clone();
        var at = 0;
        byte[]? previous = null;
        int previousWidth = 0, previousHeight = 0;
        try
        {
            for (var level = 0; level < texture.Levels && at < data.Length; level++)
            {
                var width = Side(Math.Max(1, texture.Width >> level));
                var height = Side(Math.Max(1, texture.Height >> level));
                var bytes = codec.Bytes(width, height);
                var whole = at + bytes <= data.Length;
                if (!whole && previous is null) return false;
                var decoded = whole
                    ? codec.Decode(data.AsSpan(at, bytes).ToArray(), width, height)
                    : TextureLevelCommands.Shrink(previous!, previousWidth, previousHeight, width, height);
                if (decoded is null || decoded.Length != width * height * 4) return false;
                previous = (byte[])decoded.Clone();
                previousWidth = width;
                previousHeight = height;
                var changed = pixels(decoded, width, height);
                if (changed is null || changed.Length != decoded.Length) return false;
                var encoded = codec.Encode(changed, width, height);
                if (encoded.Length != bytes) return false;
                encoded.AsSpan(0, Math.Min(bytes, data.Length - at)).CopyTo(output.AsSpan(at));
                at += bytes;
            }
        }
        catch (Exception)
        {
            return false;
        }
        texture.Format = codec.Output;
        texture.Data!.FullData = output;
        return true;
    }

    /// <summary>
    /// Стиль мира на цепочке mip: красится ТОЛЬКО верхняя ступень, остальные —
    /// её уменьшением (задача 35, 19.10.2026). Прежде каждая ступень красилась
    /// сама: контур в один пиксель, штриховка и постеризация на 64, 32, 16
    /// пикселях давали каждая свою картинку, и вблизи и вдали, а ещё при
    /// каждой смене ступени на бегу, лес и стены «моргали». Теперь вдали
    /// линия не толще и не чернее, чем вблизи, а мягко сливается с цветом, как
    /// у любой текстуры с mip.
    ///
    /// Цвет ступени — из окрашенной верхней, альфа — своя, из игры: цепочки
    /// альфы Rockstar делает сама, под вырез листвы и сетки (там же, где
    /// <see cref="TransformLevels"/>: тот же формат, тот же вес, тот же хвост
    /// обрезанной цепочки).
    /// </summary>
    internal static bool TransformFromTop(Texture texture, Func<byte[], int, int, byte[]> paintTop)
    {
        var codec = TextureLevelCommands.CodecOf(texture.Format);
        var data = texture.Data?.FullData;
        if (codec is null || data is null || texture.Depth > 1 || texture.Levels < 1) return false;
        int Side(int side) => codec.Min == 4 ? Math.Max(4, (side + 3) / 4 * 4) : Math.Max(1, side);
        var output = (byte[])data.Clone();
        var at = 0;
        byte[]? previous = null;
        int previousWidth = 0, previousHeight = 0;
        byte[]? top = null;
        int topWidth = 0, topHeight = 0;
        try
        {
            for (var level = 0; level < texture.Levels && at < data.Length; level++)
            {
                var width = Side(Math.Max(1, texture.Width >> level));
                var height = Side(Math.Max(1, texture.Height >> level));
                var bytes = codec.Bytes(width, height);
                var whole = at + bytes <= data.Length;
                if (!whole && previous is null) return false;
                var original = whole
                    ? codec.Decode(data.AsSpan(at, bytes).ToArray(), width, height)
                    : TextureLevelCommands.Shrink(previous!, previousWidth, previousHeight, width, height);
                if (original is null || original.Length != width * height * 4) return false;
                previous = (byte[])original.Clone();
                previousWidth = width;
                previousHeight = height;
                byte[] coloured;
                if (top is null)
                {
                    var painted = paintTop((byte[])original.Clone(), width, height);
                    if (painted is null || painted.Length != original.Length) return false;
                    top = painted;
                    topWidth = width;
                    topHeight = height;
                    coloured = painted;
                }
                else
                {
                    coloured = TextureLevelCommands.Shrink(top, topWidth, topHeight, width, height);
                    for (var pixel = 3; pixel < coloured.Length; pixel += 4) coloured[pixel] = original[pixel];
                }
                var encoded = codec.Encode(coloured, width, height);
                if (encoded.Length != bytes) return false;
                encoded.AsSpan(0, Math.Min(bytes, data.Length - at)).CopyTo(output.AsSpan(at));
                at += bytes;
            }
        }
        catch (Exception)
        {
            return false;
        }
        texture.Format = codec.Output;
        texture.Data!.FullData = output;
        return true;
    }
}
