using System.Text.Json;

namespace Modovik.Native.Host;

/// <summary>
/// Стили мира (ТЗ 17.10.2026, задача 10): «рисованный», «комикс» (как в
/// Borderlands), «мультяшный» (как в Симпсонах), «акварель» и «ретро».
///
/// Стиль — стадия конвейера текстур (<see cref="TextureStages"/>): текстура
/// разжимается в RGBA, верхняя ступень mip получает стиль, остальные ступени —
/// её уменьшением (<see cref="TextureStages.TransformFromTop"/>, задача 35),
/// и всё сжимается обратно в тот же формат и вес. Правило — копия
/// <c>@modovik/optimizer/texture-styles.js</c> (им красится кадр предпросмотра
/// в окне) и считается ЦЕЛЫМИ числами, поэтому байты окна и хоста совпадают;
/// это держит тест (<c>texture-styles.test.js</c>). Правишь краску — правь
/// оба файла и поднимай <c>TEXTURE_STAGES_VERSION</c>.
///
/// Как красится кадр: сглаживание [1 2 1]² с оборачиванием краёв (текстуры
/// мира тайлятся), постеризация яркости, контуры — градиент Собеля (максимум
/// по каналам). Вдали, на малых текстурах, контур и штриховка гаснут
/// (<see cref="Detail"/>): на 8×8 пикселях контур в один пиксель съел бы всю
/// картинку. Альфа не меняется.
///
/// Вырезная альфа (листва, сетки, надписи; <see cref="IsCutout"/>): цвет под
/// вырезом — не картинка, а «затравка» для фильтрации, и у листвы он светлее
/// самих листьев. Контур на такой границе обвёл бы каждый лист чёрным, а
/// штриховка и постеризация считали бы вырез тенью. Поэтому цвет под вырезом
/// сперва заменяется продолжением цвета листьев (<see cref="FillHidden"/>), а
/// медиана и границы яркости комикса считаются только по видимым точкам.
/// </summary>
internal static class TextureStyles
{
    /* Стили по порядку в списках (копия TEXTURE_STYLES окна). */
    public const string Painted = "style-painted";
    public const string Comic = "style-comic";
    public const string Cartoon = "style-cartoon";
    public const string Watercolor = "style-watercolor";
    public const string Retro = "style-retro";

    public static readonly string[] All = [Painted, Comic, Cartoon, Watercolor, Retro];

    public static bool IsStyle(string stage) => Array.IndexOf(All, stage) >= 0;

    /* Маски и карты, что не цвет, по имени (копия MASKS окна). */
    private static readonly System.Text.RegularExpressions.Regex Masks = new(
        "_(?:mask|msk|ao|lightmap|ramp)\\d*$",
        System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>Красит ли стиль эту текстуру по имени и виду: маски, палитры тинта и таблицы-полоски — нет.</summary>
    internal static bool IsStyled(string? name, int width, int height)
    {
        var lower = (name ?? string.Empty).ToLowerInvariant();
        if (Masks.IsMatch(lower)) return false;
        if (lower.EndsWith("_pal") || lower.Contains("_pal_") || lower.EndsWith("_lut") || lower.Contains("palette")) return false;
        return !(height <= 8 && width >= 16 * Math.Max(1, height));
    }

    /// <summary>Стиль на текстуре; <c>false</c> — она не про цвет, таблица или её данные не того вида.</summary>
    internal static bool ToStyle(CodeWalker.GameFiles.Texture texture, string style)
    {
        if (!TextureStages.IsColourTexture(texture) || !IsStyled(texture.Name, texture.Width, texture.Height)) return false;
        return TextureStages.TransformFromTop(texture, (pixels, width, height) => Style(pixels, width, height, style));
    }

    private sealed record PixelsRequest(string Style, int Width, int Height, string PixelsIn, string PixelsOut, int? Detail = null);

    /// <summary>
    /// Команда <c>style-pixels</c>: стиль на кадре RGBA из файла — в файл.
    /// Правило хоста тем же путём, каким его красит проход
    /// <c>downscale-textures</c>; тест сверяет им правило окна байт в байт.
    /// </summary>
    public static async Task<object> PixelsAsync(string inputPath, string outputPath)
    {
        var request = JsonSerializer.Deserialize<PixelsRequest>(
            await File.ReadAllTextAsync(inputPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException("Style request is empty.");
        if (!IsStyle(request.Style)) throw new ArgumentException($"Unknown texture style: {request.Style}");
        if (request.Width is < 1 or > 4096 || request.Height is < 1 or > 4096)
            throw new ArgumentException("Frame sides must be 1–4096 pixels.");
        if (request.Detail is < 0 or > 256) throw new ArgumentException("Style detail must be 0–256.");
        var pixels = await File.ReadAllBytesAsync(Path.GetFullPath(request.PixelsIn));
        if (pixels.Length != request.Width * request.Height * 4)
            throw new InvalidDataException("Frame size does not match its sides.");
        Style(pixels, request.Width, request.Height, request.Style, request.Detail);
        await File.WriteAllBytesAsync(Path.GetFullPath(request.PixelsOut), pixels);
        await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(new { width = request.Width, height = request.Height, bytes = pixels.Length }));
        return new { output = outputPath, bytes = pixels.Length };
    }

    private sealed record TextureRequest(string Style, string Name, string Format, int Width, int Height, int Levels, string PixelsIn, string PixelsOut, string? PixelsBefore = null);

    /// <summary>
    /// Команда <c>style-texture</c> (сверка и тест, задача 35): настоящая
    /// текстура из RGBA-ступеней (<c>PixelsIn</c> — все ступени подряд, от
    /// верхней), сжатая в DXT1, DXT5 или A8R8G8B8, проходит тот же путь, что в
    /// <c>downscale-textures</c> (<see cref="ToStyle"/>: красится верхняя
    /// ступень, остальные — её уменьшением). В <c>PixelsOut</c> — ступени после
    /// стиля, в <c>PixelsBefore</c> — до него (после сжатия, так что разницу
    /// даёт только стиль, а не сжатие).
    /// </summary>
    public static async Task<object> TextureAsync(string inputPath, string outputPath)
    {
        var request = JsonSerializer.Deserialize<TextureRequest>(
            await File.ReadAllTextAsync(inputPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException("Style request is empty.");
        if (!IsStyle(request.Style)) throw new ArgumentException($"Unknown texture style: {request.Style}");
        var format = request.Format.ToUpperInvariant() switch
        {
            "DXT1" => CodeWalker.GameFiles.TextureFormat.D3DFMT_DXT1,
            "DXT5" => CodeWalker.GameFiles.TextureFormat.D3DFMT_DXT5,
            "A8R8G8B8" => CodeWalker.GameFiles.TextureFormat.D3DFMT_A8R8G8B8,
            _ => throw new ArgumentException($"Unsupported texture format: {request.Format}"),
        };
        var codec = TextureLevelCommands.CodecOf(format)!;
        if (request.Width is < 4 or > 2048 || request.Height is < 4 or > 2048 || request.Levels is < 1 or > 12)
            throw new ArgumentException("Texture sides must be 4–2048 pixels, levels 1–12.");
        int Side(int side) => codec.Min == 4 ? Math.Max(4, (side + 3) / 4 * 4) : Math.Max(1, side);
        var input = await File.ReadAllBytesAsync(Path.GetFullPath(request.PixelsIn));
        var sizes = Enumerable.Range(0, request.Levels)
            .Select(level => (Width: Side(Math.Max(1, request.Width >> level)), Height: Side(Math.Max(1, request.Height >> level))))
            .ToArray();
        if (input.Length != sizes.Sum(size => size.Width * size.Height * 4))
            throw new InvalidDataException("Levels do not fill the pixel file.");
        var encoded = new List<byte>();
        var offset = 0;
        foreach (var (width, height) in sizes)
        {
            encoded.AddRange(codec.Encode(input.AsSpan(offset, width * height * 4).ToArray(), width, height));
            offset += width * height * 4;
        }
        var texture = new CodeWalker.GameFiles.Texture
        {
            Name = request.Name,
            Width = (ushort)request.Width,
            Height = (ushort)request.Height,
            Levels = (byte)request.Levels,
            Format = format,
            Stride = (ushort)(codec.Bytes(request.Width, request.Height) / request.Height),
            Data = new CodeWalker.GameFiles.TextureData { FullData = encoded.ToArray() },
        };
        byte[] Decode(CodeWalker.GameFiles.Texture source)
        {
            var data = source.Data.FullData;
            var all = new List<byte>();
            var at = 0;
            foreach (var (width, height) in sizes)
            {
                var bytes = codec.Bytes(width, height);
                all.AddRange(codec.Decode(data.AsSpan(at, bytes).ToArray(), width, height));
                at += bytes;
            }
            return all.ToArray();
        }
        var before = Decode(texture);
        var staged = ToStyle(texture, request.Style);
        var after = Decode(texture);
        if (request.PixelsBefore is not null) await File.WriteAllBytesAsync(Path.GetFullPath(request.PixelsBefore), before);
        await File.WriteAllBytesAsync(Path.GetFullPath(request.PixelsOut), after);
        await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(new { staged, format = texture.Format.ToString(), levels = sizes.Select(size => new { width = size.Width, height = size.Height }).ToArray() }));
        return new { output = outputPath, staged };
    }

    /// <summary>Стиль на кадре RGBA (на месте, альфа прежняя); <paramref name="detail"/> — 0…256.</summary>
    internal static byte[] Style(byte[] rgba, int width, int height, string style, int? detail = null)
    {
        var amount = detail ?? Detail(width, height);
        var cutout = IsCutout(rgba);
        if (cutout) FillHidden(rgba, width, height);
        switch (style)
        {
            case Painted: PaintPainted(rgba, width, height, amount, cutout); break;
            case Comic: PaintComic(rgba, width, height, amount, cutout); break;
            case Cartoon: PaintCartoon(rgba, width, height, amount, cutout); break;
            case Watercolor: PaintWatercolor(rgba, width, height, amount, cutout); break;
            case Retro: PaintRetro(rgba, width, height, cutout); break;
            default: throw new ArgumentException($"Unknown texture style: {style}");
        }
        return rgba;
    }

    /// <summary>
    /// Альфа — вырез (листва, сетка, надпись на прозрачном), а не маска блеска
    /// или градиент: не меньше 3 % точек прозрачнее половины, видимых не меньше
    /// 0,5 %, и «серединой» (32…223) не больше 40 %.
    /// </summary>
    internal static bool IsCutout(byte[] rgba)
    {
        var count = rgba.Length / 4;
        if (count == 0) return false;
        int hidden = 0, middle = 0;
        for (var at = 3; at < rgba.Length; at += 4)
        {
            var alpha = rgba[at];
            if (alpha < 128) hidden++;
            if (alpha >= 32 && alpha < 224) middle++;
        }
        return hidden * 100 >= count * 3 && (count - hidden) * 200 >= count && middle * 100 <= count * 40;
    }

    /// <summary>
    /// Цвет под вырезом (альфа &lt; 128) — продолжение цвета видимых точек: слой
    /// за слоем, каждая скрытая точка берёт среднее своих видимых соседей из 8
    /// (края оборачиваются). Слой читает только то, что было видно до него, поэтому
    /// порядок обхода ничего не меняет. Альфа та же.
    /// </summary>
    internal static void FillHidden(byte[] rgba, int width, int height)
    {
        var count = width * height;
        var known = new bool[count];
        var pending = new List<int>();
        for (var i = 0; i < count; i++)
        {
            known[i] = rgba[i * 4 + 3] >= 128;
            if (!known[i]) pending.Add(i);
        }
        if (pending.Count == 0 || pending.Count == count) return;
        var found = new List<int>();
        var rest = new List<int>();
        for (var pass = 0; pass < Math.Max(width, height) && pending.Count > 0; pass++)
        {
            found.Clear();
            rest.Clear();
            foreach (var i in pending)
            {
                int x = i % width, y = i / width;
                int r = 0, g = 0, b = 0, n = 0;
                for (var dy = -1; dy <= 1; dy++)
                    for (var dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        var j = ((y + dy + height) % height) * width + (x + dx + width) % width;
                        if (!known[j]) continue;
                        r += rgba[j * 4];
                        g += rgba[j * 4 + 1];
                        b += rgba[j * 4 + 2];
                        n++;
                    }
                if (n == 0)
                {
                    rest.Add(i);
                    continue;
                }
                rgba[i * 4] = (byte)((r + n / 2) / n);
                rgba[i * 4 + 1] = (byte)((g + n / 2) / n);
                rgba[i * 4 + 2] = (byte)((b + n / 2) / n);
                found.Add(i);
            }
            foreach (var i in found) known[i] = true;
            (pending, rest) = (rest, pending);
        }
    }

    /* ── Целочисленные кирпичики ───────────────────────────────────────── */

    private static int Clamp8(int value) => value < 0 ? 0 : value > 255 ? 255 : value;

    /* Яркость 0…255 целыми: 54 + 183 + 19 = 256. */
    private static int Luma(int r, int g, int b) => (54 * r + 183 * g + 19 * b + 128) >> 8;

    /* Насыщенность: scale в 256-х (256 — как была). */
    private static int Saturate(int value, int y, int scale) => Clamp8(y + (((value - y) * scale) >> 8));

    /*
     * Насыщенность без обрезки (задача 35): усиление цвета ×1,3 и больше толкало
     * тёплые текстуры (бордюр, глина, дерево) синим каналом в ноль, а яркие — в 255:
     * картинка в канале становилась плоской и «заливалась одним цветом». Усиление
     * плавно слабеет у краёв: канал ближе SaturateKnee к 0 или к 255 получает
     * только долю усиления (доля — расстояние до края / SaturateKnee), так что
     * рисунок в нём остаётся. Меньше 1 (256) усиление не бывает.
     */
    private const int SaturateKnee = 48;

    private static int SaturationRoom(int r, int g, int b, int scale)
    {
        if (scale <= 256) return scale;
        var top = r > g ? (r > b ? r : b) : g > b ? g : b;
        var bottom = r < g ? (r < b ? r : b) : g < b ? g : b;
        var share = 256;
        if (bottom < SaturateKnee) share = Math.Min(share, bottom * 256 / SaturateKnee);
        if (255 - top < SaturateKnee) share = Math.Min(share, (255 - top) * 256 / SaturateKnee);
        return 256 + (((scale - 256) * share) >> 8);
    }

    /* from → to на долю amount из 255. */
    private static int Mix(int from, int to, int amount) => from + (((to - from) * amount) + 127) / 255;

    /// <summary>Постеризация: яркость 0…255 → одна из levels ступенек; slope — резкость перехода.</summary>
    internal static int BandLevel(int y, int levels, int slope)
    {
        var position = y * (levels - 1);
        var floor = position >> 8;
        var fraction = position & 255;
        var t = (fraction - 128) * slope + 128;
        t = t < 0 ? 0 : t > 256 ? 256 : t;
        var smooth = (t * t * (768 - 2 * t)) >> 16;
        return (((floor << 8) + smooth) * 255) / ((levels - 1) << 8);
    }

    /* Хэш точки в 0…255. */
    private static int Hash(int x, int y, int seed)
    {
        unchecked
        {
            var h = x * 374761393 + y * 668265263 + seed * 2147483647;
            h = (h ^ (int)((uint)h >> 13)) * 1274126177;
            return (h ^ (int)((uint)h >> 16)) & 255;
        }
    }

    /* Зерно бумаги −382…382: три слоя хэша крупнее и крупнее. */
    private static int Grain(int x, int y) => Hash(x, y, 1) + Hash(x >> 1, y >> 1, 2) + Hash(x >> 2, y >> 2, 3) - 382;

    /// <summary>Сколько рисунка остаётся на ступени (0…256): полный от 32 пикселей стороны, к 4 — ноль.</summary>
    internal static int Detail(int width, int height)
    {
        var side = Math.Min(width, height);
        var value = ((side - 4) * 256) / 28;
        return value < 0 ? 0 : value > 256 ? 256 : value;
    }

    /* Сдвиг яркости, урезанный так, чтобы ни один канал не вышел за 0…255. */
    private static int Room(int r, int g, int b, int shift)
    {
        var top = r > g ? (r > b ? r : b) : g > b ? g : b;
        var bottom = r < g ? (r < b ? r : b) : g < b ? g : b;
        return shift > 255 - top ? 255 - top : shift < -bottom ? -bottom : shift;
    }

    /// <summary>
    /// Сколько мелкой фактуры (зерно бумаги, штриховка) остаётся на ступени (0…256):
    /// полная от 128 пикселей стороны, на 64 — треть, от 32 и меньше — ничего. Контуры
    /// (<see cref="Detail"/>) держатся дольше: на ступени в 32 пикселя линия ещё
    /// читается, а зерно на ней — уже шум по всему миру.
    /// </summary>
    internal static int FineDetail(int width, int height)
    {
        var side = Math.Min(width, height);
        var value = ((side - 32) * 256) / 96;
        return value < 0 ? 0 : value > 256 ? 256 : value;
    }

    /* Один канал сглажен [1 2 1] по обеим осям (края оборачиваются). */
    private static byte[] BlurPlane(byte[] plane, int width, int height)
    {
        var middle = new byte[plane.Length];
        var output = new byte[plane.Length];
        for (var y = 0; y < height; y++)
        {
            var row = y * width;
            for (var x = 0; x < width; x++)
            {
                var left = row + (x == 0 ? width - 1 : x - 1);
                var right = row + (x == width - 1 ? 0 : x + 1);
                middle[row + x] = (byte)((plane[left] + 2 * plane[row + x] + plane[right] + 2) >> 2);
            }
        }
        for (var y = 0; y < height; y++)
        {
            var up = (y == 0 ? height - 1 : y - 1) * width;
            var row = y * width;
            var down = (y == height - 1 ? 0 : y + 1) * width;
            for (var x = 0; x < width; x++) output[row + x] = (byte)((middle[up + x] + 2 * middle[row + x] + middle[down + x] + 2) >> 2);
        }
        return output;
    }

    /* Копия сглаженная [1 2 1] по обеим осям, края оборачиваются; альфа прежняя. */
    private static byte[] Blur(byte[] source, int width, int height)
    {
        var middle = new byte[source.Length];
        var output = new byte[source.Length];
        for (var y = 0; y < height; y++)
        {
            var row = y * width;
            for (var x = 0; x < width; x++)
            {
                var left = (row + (x == 0 ? width - 1 : x - 1)) * 4;
                var centre = (row + x) * 4;
                var right = (row + (x == width - 1 ? 0 : x + 1)) * 4;
                for (var k = 0; k < 3; k++) middle[centre + k] = (byte)((source[left + k] + 2 * source[centre + k] + source[right + k] + 2) >> 2);
                middle[centre + 3] = source[centre + 3];
            }
        }
        for (var y = 0; y < height; y++)
        {
            var up = (y == 0 ? height - 1 : y - 1) * width;
            var row = y * width;
            var down = (y == height - 1 ? 0 : y + 1) * width;
            for (var x = 0; x < width; x++)
            {
                var a = (up + x) * 4;
                var b = (row + x) * 4;
                var c = (down + x) * 4;
                for (var k = 0; k < 3; k++) output[b + k] = (byte)((middle[a + k] + 2 * middle[b + k] + middle[c + k] + 2) >> 2);
                output[b + 3] = source[b + 3];
            }
        }
        return output;
    }

    /* Градиент Собеля, максимум по трём каналам (|gx| + |gy|) / 4, 0…255; края оборачиваются. */
    private static byte[] Edges(byte[] source, int width, int height)
    {
        var output = new byte[width * height];
        for (var y = 0; y < height; y++)
        {
            var up = ((y + height - 1) % height) * width;
            var row = y * width;
            var down = ((y + 1) % height) * width;
            for (var x = 0; x < width; x++)
            {
                var xm = (x + width - 1) % width;
                var xp = (x + 1) % width;
                var best = 0;
                for (var k = 0; k < 3; k++)
                {
                    int a = source[(up + xm) * 4 + k];
                    int b = source[(up + x) * 4 + k];
                    int c = source[(up + xp) * 4 + k];
                    int d = source[(row + xm) * 4 + k];
                    int f = source[(row + xp) * 4 + k];
                    int g = source[(down + xm) * 4 + k];
                    int h = source[(down + x) * 4 + k];
                    int i = source[(down + xp) * 4 + k];
                    var gx = c + 2 * f + i - (a + 2 * d + g);
                    var gy = g + 2 * h + i - (a + 2 * b + c);
                    var magnitude = ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy)) >> 2;
                    if (magnitude > best) best = magnitude;
                }
                output[row + x] = (byte)(best > 255 ? 255 : best);
            }
        }
        return output;
    }

    /* Линия из градиента: порог low, усиление gain/16, потом по detail. */
    private static int Stroke(int edge, int low, int gain, int detail)
    {
        var value = ((edge - low) * gain) >> 4;
        return ((value < 0 ? 0 : value > 255 ? 255 : value) * detail) >> 8;
    }

    /* Краска пикселя в буфере: цвет, альфа прежняя. */
    private static void Put(byte[] pixels, int at, int r, int g, int b)
    {
        pixels[at] = (byte)Clamp8(r);
        pixels[at + 1] = (byte)Clamp8(g);
        pixels[at + 2] = (byte)Clamp8(b);
    }

    /* ── Стили ─────────────────────────────────────────────────────────── */

    /* Рисованный: мягкие мазки (8 ступеней яркости внутри яркости текстуры), тонкий тёплый контур, бумажная фактура. */
    private static void PaintPainted(byte[] pixels, int width, int height, int detail, bool cutout)
    {
        var fine = (FineDetail(width, height) * detail) >> 8;
        var soft = Blur(pixels, width, height);
        var edge = Edges(soft, width, height);
        var range = RangeOf(soft, cutout);
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var at = (y * width + x) * 4;
                int r = soft[at], g = soft[at + 1], b = soft[at + 2];
                var lum = Luma(r, g, b);
                var shift = Room(r, g, b, range.Shift(lum, BandLevel(range.Position(lum), 8, 3)));
                r += shift;
                g += shift;
                b += shift;
                var y2 = Luma(r, g, b);
                var boost = SaturationRoom(r, g, b, 288);
                r = Saturate(r, y2, boost);
                g = Saturate(g, y2, boost);
                b = Saturate(b, y2, boost);
                var line = Stroke(edge[y * width + x], 20, 40, detail);
                r = Mix(r, 46, line);
                g = Mix(g, 32, line);
                b = Mix(b, 26, line);
                var paper = (((Grain(x, y) * 22) >> 10) * fine) >> 8;
                /* Зерно бумаги не чернит тёмное: вычитающее зерно ослабляется у точек темнее яркости 64. */
                if (paper < 0) paper = (paper * Math.Min(Luma(r, g, b), 64)) >> 6;
                Put(pixels, at, r + paper, g + paper, b + paper);
            }
    }

    /* Порог градиента, с которого начинается линия комикса (0…255): ниже — зерно камня, асфальта и травы линией не становится. */
    private const int LineLow = 30;

    /*
     * Штриховка комикса: тень — то, что темнее медианы самой текстуры больше чем
     * на HatchBelow, а не абсолютно тёмное: асфальт тёмный весь и не штрихуется
     * весь. Ровный тёмный участок не штрихуется вовсе: штрих ложится там, где
     * рядом есть детали (средняя «колючесть» вокруг точки не ниже HatchActive).
     */
    private const int HatchBelow = 30;
    private const int HatchActive = 12;

    /*
     * Ступени яркости комикса — внутри яркости самой текстуры (задача 35): от
     * 2-го до 98-го процентиля видимых точек, а не от 0 до 255. Пять ступеней
     * от нуля до белого вдавливали тёмную листву и тёмные ночные карточки в
     * чёрное (до половины видимых точек), а ровный тёмный цвет асфальта
     * (яркость 35) подбрасывали на следующую ступень (64) и красили в бирюзу.
     * Теперь чёрным остаётся только контур, ровный цвет остаётся своим, а
     * текстура не светлеет и не темнеет в среднем. Размах яркости меньше
     * BandSpanMin — картинка почти ровная — не постеризуется вовсе, к
     * BandSpanMin + BandSpanRamp постеризация набирает полную силу.
     */
    private const int BandSpanMin = 16;
    private const int BandSpanRamp = 48;

    /* Яркость, ниже которой лежит percent % видимых точек гистограммы. */
    private static int Percentile(int[] histogram, int total, int percent)
    {
        var count = 0;
        for (var value = 0; value < 256; value++)
        {
            count += histogram[value];
            if (count * 100 >= total * percent) return value;
        }
        return 255;
    }

    /*
     * Диапазон ступеней яркости одной текстуры — общий у всех стилей (задача 35: комикс; затем остальные).
     * `Low` и `Span` — 2-й и 98-й процентили яркости видимых точек картинки, которую стиль ступенчато делит;
     * `Banding` (0…256) — сила постеризации: размах меньше `BandSpanMin` — не постеризуется вовсе.
     * Ступени лежат внутри этого диапазона: ни чёрное, ни светлее самой светлой точки текстуры из них не выходит.
     */
    private readonly struct BandRange
    {
        public readonly int Low;
        public readonly int Span;
        public readonly int Banding;

        public BandRange(int low, int span, int banding)
        {
            Low = low;
            Span = span;
            Banding = banding;
        }

        /// <summary>Яркость → 0…255 внутри диапазона (ступени считаются в этой шкале).</summary>
        public int Position(int lum) => Span <= 0 ? 0 : Clamp8((lum - Low) * 255 / Span);

        /// <summary>Сдвиг яркости к ступени <paramref name="level"/> (0…255 внутри диапазона) по силе постеризации.</summary>
        public int Shift(int lum, int level) => Banding <= 0 ? 0 : (((Low + level * Span / 255) - lum) * Banding) >> 8;
    }

    private static BandRange RangeOf(int[] histogram, int counted)
    {
        var low = Percentile(histogram, counted, 2);
        var span = Percentile(histogram, counted, 98) - low;
        return new BandRange(low, span, Math.Clamp((span - BandSpanMin) * 256 / BandSpanRamp, 0, 256));
    }

    /* Гистограмма яркости видимых точек картинки (у вырезной альфы — только видимые). */
    private static int[] Histogram(byte[] image, bool cutout, out int counted)
    {
        var histogram = new int[256];
        counted = 0;
        for (var at = 0; at < image.Length; at += 4)
        {
            if (cutout && image[at + 3] < 128) continue;
            histogram[Luma(image[at], image[at + 1], image[at + 2])]++;
            counted++;
        }
        return histogram;
    }

    private static BandRange RangeOf(byte[] image, bool cutout)
    {
        var histogram = Histogram(image, cutout, out var counted);
        return RangeOf(histogram, counted);
    }

    /* Комикс: плоские цвета (5 ступеней), жирные чёрные контуры, штриховка в тенях. */
    private static void PaintComic(byte[] pixels, int width, int height, int detail, bool cutout)
    {
        var soft = Blur(pixels, width, height);
        /* Контур — по дважды сглаженному: зерно камня и асфальта линиями не становится. */
        var edge = Edges(Blur(soft, width, height), width, height);
        var side = Math.Min(width, height);
        var lines = new byte[width * height];
        for (var i = 0; i < lines.Length; i++) lines[i] = (byte)Stroke(edge[i], LineLow, 72, detail);
        /* Медиана, границы яркости и «колючесть» вокруг каждой точки — по видимым точкам. */
        var histogram = Histogram(soft, cutout, out var counted);
        var median = 0;
        for (var count = 0; median < 255; median++)
        {
            count += histogram[median];
            if (count * 2 >= counted) break;
        }
        var range = RangeOf(histogram, counted);
        var activity = BlurPlane(BlurPlane(edge, width, height), width, height);
        /* Штриховка — на ступенях от 64 пикселей: через 4 пикселя на больших и 3 на малых; мельче гаснет. */
        var hatching = (FineDetail(width, height) * detail) >> 8;
        var period = side >= 96 ? 4 : 3;
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var at = (y * width + x) * 4;
                int r = soft[at], g = soft[at + 1], b = soft[at + 2];
                var lum = Luma(r, g, b);
                var shadow = lum + HatchBelow < median && activity[y * width + x] >= HatchActive;
                var shift = Room(r, g, b, range.Shift(lum, BandLevel(range.Position(lum), 5, 64)));
                r += shift;
                g += shift;
                b += shift;
                lum = Luma(r, g, b);
                var boost = SaturationRoom(r, g, b, 340);
                r = Saturate(r, lum, boost);
                g = Saturate(g, lum, boost);
                b = Saturate(b, lum, boost);
                if (hatching > 0 && shadow && (x + y) % period == 0)
                {
                    var strength = (130 * hatching) >> 8;
                    r = Mix(r, 14, strength);
                    g = Mix(g, 12, strength);
                    b = Mix(b, 18, strength);
                }
                var line = lines[y * width + x];
                Put(pixels, at, Mix(r, 14, line), Mix(g, 12, line), Mix(b, 18, line));
            }
    }

    /* Мультяшный: яркие плоские цвета (6 ступеней внутри яркости текстуры), мягкий контур тёмнее собственного цвета. */
    private static void PaintCartoon(byte[] pixels, int width, int height, int detail, bool cutout)
    {
        var soft = Blur(Blur(pixels, width, height), width, height);
        var edge = Edges(soft, width, height);
        var range = RangeOf(soft, cutout);
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var at = (y * width + x) * 4;
                int r = soft[at], g = soft[at + 1], b = soft[at + 2];
                var lum = Luma(r, g, b);
                /* Середина светлее — лёгкий подъём без float, в шкале диапазона самой текстуры. */
                var position = range.Position(lum);
                var lifted = Clamp8(position + ((position * (255 - position)) >> 11));
                var shift = Room(r, g, b, range.Shift(lum, BandLevel(lifted, 6, 2)));
                r += shift;
                g += shift;
                b += shift;
                lum = Luma(r, g, b);
                var boost = SaturationRoom(r, g, b, 410);
                r = Saturate(r, lum, boost);
                g = Saturate(g, lum, boost);
                b = Saturate(b, lum, boost);
                var line = Stroke(edge[y * width + x], 28, 30, detail);
                /* Контур — тот же цвет, потемнее: 35 % от него. */
                Put(pixels, at, Mix(r, (r * 90) >> 8, line), Mix(g, (g * 90) >> 8, line), Mix(b, (b * 90) >> 8, line));
            }
    }

    /*
     * Акварель: размытые заливки, светлее и бледнее, влажный край пигмента, крупное зерно бумаги.
     * Ступени (8) — внутри яркости текстуры. Бумага светлит заливку: до 14 % к белому, но тёмное она светлит
     * меньше — тёмный пигмент остаётся тёмным, а ровный тёмный цвет (асфальт, бордюр) не уходит в серый: доля
     * бумаги растёт с яркостью до 128 и дальше не меняется.
     */
    private static void PaintWatercolor(byte[] pixels, int width, int height, int detail, bool cutout)
    {
        var fine = (FineDetail(width, height) * detail) >> 8;
        var wash = Blur(Blur(Blur(pixels, width, height), width, height), width, height);
        var edge = Edges(wash, width, height);
        var range = RangeOf(wash, cutout);
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var at = (y * width + x) * 4;
                int r = wash[at], g = wash[at + 1], b = wash[at + 2];
                var lum = Luma(r, g, b);
                var shift = Room(r, g, b, range.Shift(lum, BandLevel(range.Position(lum), 8, 2)));
                r += shift;
                g += shift;
                b += shift;
                lum = Luma(r, g, b);
                r = Saturate(r, lum, 250);
                g = Saturate(g, lum, 250);
                b = Saturate(b, lum, 250);
                /* Бумага светлит заливку: до 14 % к белому, у тёмного — меньше. */
                var paperShare = (36 * Math.Min(lum, 128)) >> 7;
                r += ((255 - r) * paperShare) >> 8;
                g += ((255 - g) * paperShare) >> 8;
                b += ((255 - b) * paperShare) >> 8;
                /* Влажный край: у границ заливки пигмент темнее — тот же цвет, множителем. */
                var rim = Stroke(edge[y * width + x], 8, 44, detail);
                r = Mix(r, (r * 150) >> 8, rim);
                g = Mix(g, (g * 150) >> 8, rim);
                b = Mix(b, (b * 150) >> 8, rim);
                var paper = (((Grain(x, y) * 18) >> 10) * fine) >> 8;
                Put(pixels, at, r + paper, g + paper, b + paper);
            }
    }

    /*
     * Ретро: крупные пиксели (4×4 на 128, 2×2 на 64) и ограниченная палитра — 8
     * ступеней яркости и цвет крупными шагами, без растра: растр на движении даёт
     * муар и мерцание. Яркость и цвет делятся, а не три канала по отдельности: у
     * серой текстуры (асфальт, штукатурка) три канала округлились бы порознь, и
     * она вся стала бы одним плоским серым.
     *
     * Ступени — внутри яркости самой текстуры (по блокам, как их видит игра), а цвет крупными шагами
     * ослабляется вместе с ними: почти ровная текстура (асфальт, штукатурка) остаётся своим цветом,
     * только крупными пикселями, а не подпрыгивает к ближайшей из восьми глобальных ступеней.
     */
    private static void PaintRetro(byte[] pixels, int width, int height, bool cutout)
    {
        var side = Math.Min(width, height);
        var block = side >= 128 ? 4 : side >= 64 ? 2 : 1;
        var source = (byte[])pixels.Clone();
        var blocksX = (width + block - 1) / block;
        var blocksY = (height + block - 1) / block;
        var means = new int[blocksX * blocksY * 3];
        var histogram = new int[256];
        var counted = 0;
        for (var by = 0; by < height; by += block)
            for (var bx = 0; bx < width; bx += block)
            {
                var toX = Math.Min(width, bx + block);
                var toY = Math.Min(height, by + block);
                int r = 0, g = 0, b = 0, count = 0, visible = 0;
                for (var y = by; y < toY; y++)
                    for (var x = bx; x < toX; x++)
                    {
                        var at = (y * width + x) * 4;
                        r += source[at];
                        g += source[at + 1];
                        b += source[at + 2];
                        count++;
                        if (!cutout || source[at + 3] >= 128) visible++;
                    }
                r = (r + (count >> 1)) / count;
                g = (g + (count >> 1)) / count;
                b = (b + (count >> 1)) / count;
                var slot = ((by / block) * blocksX + bx / block) * 3;
                means[slot] = r;
                means[slot + 1] = g;
                means[slot + 2] = b;
                histogram[Luma(r, g, b)] += visible;
                counted += visible;
            }
        var range = RangeOf(histogram, counted);
        /* Цвет крупными шагами: к ближайшему кратному 28 (от нуля вверх и вниз одинаково). */
        static int Snap(int value) => ((value + (value < 0 ? -14 : 14)) / 28) * 28;
        for (var by = 0; by < height; by += block)
            for (var bx = 0; bx < width; bx += block)
            {
                var toX = Math.Min(width, bx + block);
                var toY = Math.Min(height, by + block);
                var slot = ((by / block) * blocksX + bx / block) * 3;
                int r = means[slot], g = means[slot + 1], b = means[slot + 2];
                int rr = r, gg = g, bb = b;
                if (range.Banding > 0)
                {
                    var lum = Luma(r, g, b);
                    var level = (((range.Position(lum) * 7 + 127) / 255) * 255) / 7;
                    var target = lum + range.Shift(lum, level);
                    var chromaR = r - lum;
                    var chromaB = b - lum;
                    rr = Clamp8(target + chromaR + (((Snap(chromaR) - chromaR) * range.Banding) >> 8));
                    bb = Clamp8(target + chromaB + (((Snap(chromaB) - chromaB) * range.Banding) >> 8));
                    /* Зелёный — из яркости: 54 r + 183 g + 19 b = 256 · target. */
                    gg = Clamp8(((target << 8) - 54 * rr - 19 * bb) / 183);
                }
                for (var y = by; y < toY; y++)
                    for (var x = bx; x < toX; x++) Put(pixels, (y * width + x) * 4, rr, gg, bb);
            }
    }
}
