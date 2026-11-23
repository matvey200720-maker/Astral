using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// «Животные» мастерской: метка над животным и свечение — новой геометрией
/// прямо в словаре моделей педа (`a_c_boar.ydd`, `head_000_r.ydd` собаки…).
///
/// RP-серверы (Majestic, GTA5RP) не пускают скрипты и ASI: в игру едут только
/// заменённые файлы. Значок над головой и мягкое свечение вокруг тела — это
/// геометрия, и она живёт в самой модели животного:
///   • `marker` — сетка метки (позиции в метрах в осях RAGE, Z вверх, начало —
///     корень педа; развёртка; индексы) во все непустые уровни детализации
///     выбранного drawable (по хэшу имени: 2540683012 — `head_000_r`). Геометрия
///     скинована: у каждой вершины вес 255 на корневую кость скелета (индекс 0),
///     палитра костей — та же, что у соседних геометрий модели (у животных это
///     0…N−1, то есть слот и есть кость), поэтому метка идёт за корнем педа;
///   • `glow` — «оболочка»: копия каждой геометрии каждого drawable из списка,
///     вершины сдвинуты по нормали на `inflate` метров, веса, номера костей и
///     палитра — как у исходной вершины, поэтому оболочка гнётся вместе с телом;
///   • шейдер обеих частей — `emissive` (`emissive_alpha.sps`, корзина 1) с
///     `emissiveMultiplier` из запроса, лист цвета (DXT5 с мипами) лежит во
///     встроенном словаре текстур группы шейдеров этого drawable — как у
///     украшений стволов (`DecorateDrawableCommands`);
///   • вершинная раскладка новых геометрий — та, что проверена в игре у
///     скинованных стволов: позиция, веса, номера костей, нормаль, цвет,
///     развёртка (`GTAV1`, без касательных и второй развёртки);
///   • рамки drawable (коробка и сфера), рамки моделей и маски корзин (`Flags…`
///     уровня и маска модели) считаются заново с учётом новых шейдеров и точек.
/// Всё остальное — другие drawable словаря, их геометрии, шейдеры, текстуры,
/// кости, имена — те же данные: пересобирается только контейнер ресурса.
/// `.yft` рядом не открывается и не меняется (физика и хитбокс прежние).
///
/// Правка идёт на открытых объектах CodeWalker (как у `skin-from-body`): новые
/// геометрии строятся сразу в памяти, шейдеры и листы — из тех же фрагментов
/// XML, что у `decorate-drawable`. Результат читается заново из записанных
/// байт и сверяется: каждая исходная геометрия — те же вершины, индексы, веса,
/// палитра; чужие drawable — без единого отличия; кости скелета — те же.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
///
/// Вызов: `patch-animal-model --input <запрос.json> --output <результат.ydd>`. Запрос:
/// <code>
/// { "format": "astral.animal-model", "version": 1,
///   "input": "…/a_c_boar.ydd", "output": "…/out/a_c_boar.ydd",            // output — по желанию, обязан совпасть с --output
///   "marker": { "drawable": 2540683012, "positions": […], "uvs": […], "indices": […],
///               "normals": […],                                              // по желанию, иначе считаются по сетке
///               "texture": "…/marker.dds", "emissive": 2.5 },
///   "glow":   { "drawables": [2540683012], "inflate": 0.02, "texture": "…/glow.dds", "emissive": 1.5 } }
/// </code>
/// `marker` и `glow` — любой может быть null, но не оба. Ответ: `status`, `file`, `output`, `bytes`, `sha256`,
/// `input` (`bytes`, `sha256`) и `semantic` — по каждому изменённому drawable уровни (геометрий было и стало,
/// сколько оболочек и меток, маска уровня до и после), шейдеры, листы и рамки до и после.
/// </summary>
internal static class PatchAnimalModelCommands
{
    private const string RequestFormat = "astral.animal-model";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 16 * 1024 * 1024;
    private const int MaxModelBytes = 64 * 1024 * 1024;
    private const int MaxDdsBytes = 2 * 1024 * 1024;
    /* Метка — маленькая картинка-значок, а не модель: пределы с запасом, но с потолком. */
    private const int MaxMarkerVertices = 20000;
    private const float MaxExtent = 64f;
    private const float MaxUv = 64f;
    private const float MaxEmissive = 16f;
    private const float MaxInflate = 0.5f;
    private const int MaxGlowDrawables = 64;

    /* Имена листов во встроенном словаре: у метки и у свечения свои. */
    internal const string MarkerTextureName = "astral_animal_marker";
    internal const string GlowTextureName = "astral_animal_glow";

    /* GTAV1: Position F3, Weights/Indices/Colour — по 4 байта, Normal F3, TexCoord — F2. */
    private const ulong DeclarationTypes = 0x7755555555996996UL;
    private const uint SkinnedFlags = (1u << 0) | (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) | (1u << 6);
    private const uint RigidFlags = (1u << 0) | (1u << 3) | (1u << 4) | (1u << 6);
    private const byte AlphaBucketBit = 1 << 1;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    private static readonly string[] LodNames = ["high", "medium", "low", "veryLow"];

    public static async Task<object> PatchAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException($"Запрос должен быть от 1 байта до {MaxRequestBytes / (1024 * 1024)} МиБ.");
        AnimalRequest request;
        try
        {
            request = JsonSerializer.Deserialize<AnimalRequest>(requestBytes, JsonOptions)
                ?? throw new InvalidDataException("Запрос пуст.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Запрос не разобран: " + error.Message);
        }
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Запрос неизвестного вида: нужен format \"astral.animal-model\" версии 1.");
        if (request.Marker is null && request.Glow is null)
            throw new InvalidDataException("В запросе нет ни метки (marker), ни свечения (glow): модель менять нечем.");

        var outputPath = Path.GetFullPath(output);
        if (!outputPath.EndsWith(".ydd", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Результат должен быть файлом .ydd.");
        if (!string.IsNullOrWhiteSpace(request.Output) && !SamePath(Path.GetFullPath(request.Output), outputPath))
            throw new InvalidDataException("Путь результата в запросе (output) не совпадает с --output.");
        var modelPath = Path.GetFullPath(request.Input ?? "");
        if (string.IsNullOrWhiteSpace(request.Input) || !modelPath.EndsWith(".ydd", StringComparison.OrdinalIgnoreCase) || !File.Exists(modelPath))
            throw new InvalidDataException("Исходная модель (input) должна быть существующим файлом .ydd.");
        if (SamePath(modelPath, outputPath))
            throw new InvalidDataException("Результат не может лечь поверх исходной модели: исходный файл не меняется.");

        var marker = request.Marker is null ? null : ValidMarker(request.Marker);
        var glow = request.Glow is null ? null : ValidGlow(request.Glow);

        var modelBytes = await File.ReadAllBytesAsync(modelPath);
        if (modelBytes.Length is 0 or > MaxModelBytes)
            throw new InvalidDataException("Исходная модель пуста или слишком велика.");
        var (ydd, names) = LoadYdd(modelBytes, modelPath);
        var items = ydd.DrawableDict.Drawables.data_items;
        var hashes = ydd.DrawableDict.Hashes;
        var known = hashes.ToHashSet();
        if (marker is not null && !known.Contains(marker.Drawable))
            throw new InvalidDataException($"Метка: в словаре нет drawable {marker.Drawable}. Есть: {string.Join(", ", hashes)}.");
        foreach (var hash in glow?.Drawables ?? [])
            if (!known.Contains(hash))
                throw new InvalidDataException($"Свечение: в словаре нет drawable {hash}. Есть: {string.Join(", ", hashes)}.");

        /* До правки: отпечаток каждой геометрии и всего, что обязано остаться прежним. */
        var before = new Dictionary<uint, DrawablePrint>();
        for (var index = 0; index < items.Length; index += 1)
            before[hashes[index]] = PrintDrawable(items[index], hashes[index]);

        var work = Path.Combine(Path.GetTempPath(), "astral-animal-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        var reports = new Dictionary<uint, DrawableReport>();
        var staged = outputPath + ".astral-tmp";
        try
        {
            /* Имена drawable — из файла игры (`head_000_r.#dd`): Load подменил их на hash_…, а в файле было другое. */
            for (var index = 0; index < items.Length; index += 1)
                items[index].Name = names[index];
            for (var index = 0; index < items.Length; index += 1)
            {
                var hash = hashes[index];
                var isMarker = marker is not null && marker.Drawable == hash;
                var isGlow = glow is not null && glow.Drawables.Contains(hash);
                if (!isMarker && !isGlow) continue;
                reports[hash] = PatchDrawable(items[index], hash, isMarker ? marker : null, isGlow ? glow : null, work);
            }

            var bytes = ydd.Save();
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            await File.WriteAllBytesAsync(staged, bytes);

            /* Читаем заново с диска — то, что ляжет в игру, а не то, что осталось в памяти. Не сошлось — результата нет. */
            var reopened = Reopen(await File.ReadAllBytesAsync(staged), hashes, names, before, reports, marker, glow);
            File.Move(staged, outputPath, true);
            return Answer(outputPath, bytes, modelBytes, reopened);
        }
        finally
        {
            try
            {
                if (File.Exists(staged)) File.Delete(staged);
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

    private static bool SamePath(string left, string right) =>
        string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);

    /* ------------------------------------------------------------------ *
     * Запрос.
     * ------------------------------------------------------------------ */

    private sealed record Marker(
        uint Drawable, float[] Positions, float[] Normals, float[] Uvs, ushort[] Indices, DdsSheet Sheet, float Emissive);

    private sealed record Glow(HashSet<uint> Drawables, float Inflate, DdsSheet Sheet, float Emissive);

    private sealed record DdsSheet(string Name, string File, byte[] Bytes, int Width, int Height, int Levels);

    private static Marker ValidMarker(MarkerRequest marker)
    {
        if (marker.Drawable == 0) throw new InvalidDataException("Метка: не указан drawable (хэш имени).");
        var positions = marker.Positions ?? [];
        var uvs = marker.Uvs ?? [];
        var indices = marker.Indices ?? [];
        var count = positions.Length / 3;
        if (count < 3 || count > MaxMarkerVertices || positions.Length != count * 3)
            throw new InvalidDataException($"Метка: нужно от 3 до {MaxMarkerVertices} вершин (positions — тройки чисел).");
        if (uvs.Length != count * 2)
            throw new InvalidDataException("Метка: развёрток (uvs) должно быть по паре чисел на вершину.");
        if (indices.Length < 3 || indices.Length % 3 != 0 || indices.Any(value => value < 0 || value >= count))
            throw new InvalidDataException("Метка: индексы (indices) — тройки номеров вершин внутри сетки.");
        if (positions.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxExtent))
            throw new InvalidDataException($"Метка: позиции должны быть конечными и в пределах ±{MaxExtent} м.");
        if (uvs.Any(value => !float.IsFinite(value) || Math.Abs(value) > MaxUv))
            throw new InvalidDataException("Метка: развёртка вне разумной сетки повторов.");
        var normals = marker.Normals;
        if (normals is not null)
        {
            if (normals.Length != positions.Length || normals.Any(value => !float.IsFinite(value) || Math.Abs(value) > 1.01f))
                throw new InvalidDataException("Метка: нормали (normals) — тройки на вершину, длиной не больше единицы.");
        }
        else
        {
            normals = SmoothNormals(positions, indices);
        }
        var emissive = Emissive("Метка", marker.Emissive);
        var sheet = ReadDds("Метка", MarkerTextureName, marker.Texture);
        return new Marker(marker.Drawable, positions, normals, uvs, indices.Select(value => (ushort)value).ToArray(), sheet, emissive);
    }

    private static Glow ValidGlow(GlowRequest glow)
    {
        var drawables = glow.Drawables ?? [];
        if (drawables.Length is 0 or > MaxGlowDrawables)
            throw new InvalidDataException($"Свечение: нужен список из 1–{MaxGlowDrawables} drawable (drawables).");
        var set = new HashSet<uint>(drawables);
        if (set.Count != drawables.Length || set.Contains(0))
            throw new InvalidDataException("Свечение: хэши drawable должны быть ненулевыми и не повторяться.");
        if (glow.Inflate is not float inflate || !float.IsFinite(inflate) || inflate <= 0 || inflate > MaxInflate)
            throw new InvalidDataException($"Свечение: inflate — число метров больше нуля и не больше {MaxInflate}.");
        var emissive = Emissive("Свечение", glow.Emissive);
        var sheet = ReadDds("Свечение", GlowTextureName, glow.Texture);
        return new Glow(set, inflate, sheet, emissive);
    }

    private static float Emissive(string label, float? value)
    {
        if (value is not float emissive || !float.IsFinite(emissive) || emissive < 0 || emissive > MaxEmissive)
            throw new InvalidDataException($"{label}: emissive — число от 0 до {MaxEmissive}.");
        return emissive;
    }

    /* Нормали метки, если окно их не дало: по площади соседних треугольников. */
    private static float[] SmoothNormals(float[] positions, int[] indices)
    {
        var sums = new double[positions.Length];
        for (var at = 0; at < indices.Length; at += 3)
        {
            var a = indices[at] * 3;
            var b = indices[at + 1] * 3;
            var c = indices[at + 2] * 3;
            double ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            double vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            var nx = uy * vz - uz * vy;
            var ny = uz * vx - ux * vz;
            var nz = ux * vy - uy * vx;
            foreach (var vertex in new[] { a, b, c })
            {
                sums[vertex] += nx;
                sums[vertex + 1] += ny;
                sums[vertex + 2] += nz;
            }
        }
        var normals = new float[positions.Length];
        for (var at = 0; at < normals.Length; at += 3)
        {
            var length = Math.Sqrt(sums[at] * sums[at] + sums[at + 1] * sums[at + 1] + sums[at + 2] * sums[at + 2]);
            if (length < 1e-12)
            {
                normals[at + 2] = 1;
                continue;
            }
            normals[at] = (float)(sums[at] / length);
            normals[at + 1] = (float)(sums[at + 1] / length);
            normals[at + 2] = (float)(sums[at + 2] / length);
        }
        return normals;
    }

    /*
     * Лист цвета: DXT5, степень двойки 4–1024; для листа больше 4×4 — полная
     * цепочка mip (меньше — игра рисует его серыми ступенями), для 4×4 допустим
     * и один уровень. Заголовок и размер должны сходиться байт в байт.
     */
    private static DdsSheet ReadDds(string label, string name, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidDataException($"{label}: не указан лист цвета (texture).");
        var file = Path.GetFullPath(path);
        if (!File.Exists(file)) throw new FileNotFoundException($"{label}: лист цвета не найден: {file}");
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"{label}: лист цвета — небезопасный тип или размер файла.");
        var bytes = File.ReadAllBytes(file);
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " || Encoding.ASCII.GetString(bytes, 84, 4) != "DXT5")
            throw new InvalidDataException($"{label}: лист цвета должен быть DDS в формате DXT5.");
        var height = BitConverter.ToInt32(bytes, 12);
        var width = BitConverter.ToInt32(bytes, 16);
        var levels = Math.Max(1, BitConverter.ToInt32(bytes, 28));
        if (width is < 4 or > 1024 || height is < 4 or > 1024 || (width & (width - 1)) != 0 || (height & (height - 1)) != 0)
            throw new InvalidDataException($"{label}: лист цвета — степень двойки от 4 до 1024 по обеим сторонам.");
        var full = (int)Math.Log2(Math.Max(width, height)) + 1;
        if (levels > full || (levels != full && (width > 4 || height > 4)))
            throw new InvalidDataException($"{label}: у листа {width}x{height} нужна полная цепочка mip ({full} уровней), а в файле {levels}.");
        if (bytes.Length != 128 + Dxt5Bytes(width, height, levels))
            throw new InvalidDataException($"{label}: файл листа обрезан или с лишним хвостом.");
        return new DdsSheet(name, name + ".dds", bytes, width, height, levels);
    }

    private static int Dxt5Bytes(int width, int height, int levels)
    {
        var total = 0;
        for (var level = 0; level < levels; level += 1)
        {
            var w = Math.Max(1, width >> level);
            var h = Math.Max(1, height >> level);
            total += Math.Max(1, (w + 3) / 4) * Math.Max(1, (h + 3) / 4) * 16;
        }
        return total;
    }

    /* ------------------------------------------------------------------ *
     * Открытие словаря.
     * ------------------------------------------------------------------ */

    /*
     * Словарь моделей и настоящие имена его drawable. `YddFile.Load` подменяет
     * имя, не совпавшее с хэшем (у игры там `head_000_r.#dd`), на `hash_…`:
     * исходное читаем вторым проходом тем же читателем и возвращаем в модель,
     * чтобы пересборка не меняла строку, которой в файле игры было другое.
     */
    private static (YddFile Ydd, string?[] Names) LoadYdd(byte[] bytes, string path)
    {
        var ydd = new YddFile { Name = Path.GetFileName(path) };
        try
        {
            ydd.Load(bytes);
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            throw new InvalidDataException("Модель не открывается как словарь .ydd Legacy: " + error.Message);
        }
        var items = ydd.DrawableDict?.Drawables?.data_items;
        var hashes = ydd.DrawableDict?.Hashes;
        if (!ydd.Loaded || items is null || items.Length == 0 || hashes is null || hashes.Length != items.Length || items.Any(item => item is null))
            throw new InvalidDataException("Модель не открывается: в словаре нет drawable или хэши не сходятся с числом моделей.");
        if (hashes.Distinct().Count() != hashes.Length)
            throw new InvalidDataException("В словаре два drawable с одним хэшем: правка однозначной не будет.");

        var names = ReadNames(bytes, items.Length);
        return (ydd, names);
    }

    /* Имена drawable так, как они лежат в файле: null — имени в файле нет. */
    private static string?[] ReadNames(byte[] bytes, int count)
    {
        var names = new string?[count];
        var data = bytes;
        var entry = RpfFile.CreateResourceFileEntry(ref data, 165);
        data = RpfFile.HasResourceHeader(bytes) ? ResourceBuilder.DecompressResource(data, entry) : ResourceBuilder.Decompress(data);
        var dictionary = new ResourceDataReader(entry, data).ReadBlock<DrawableDictionary>();
        var original = dictionary?.Drawables?.data_items;
        for (var index = 0; index < names.Length; index += 1)
            names[index] = original is not null && index < original.Length ? original[index]?.Name : null;
        return names;
    }

    /* ------------------------------------------------------------------ *
     * Отпечатки: что было до правки.
     * ------------------------------------------------------------------ */

    private sealed class GeometryPrint
    {
        public string Hash = "";
        public int ShaderIndex;
        public int Vertices;
        public int Indices;
        public bool Skinned;
        public ushort[]? Palette;
    }

    private sealed class ModelPrint
    {
        public byte HasSkin;
        public byte BoneIndex;
        public byte RenderMask;
        public List<GeometryPrint> Geometries = [];
    }

    private sealed class ShaderPrint
    {
        public uint Name;
        public uint File;
        public byte Bucket;
        public int Parameters;
        public string Textures = "";
    }

    private sealed class DrawablePrint
    {
        public uint Hash;
        public string? Name;
        public string[] Bones = [];
        public ShaderPrint[] Shaders = [];
        public string[] Textures = [];
        public ModelPrint[][] Lods = new ModelPrint[4][];
        public uint[] LodFlags = new uint[4];
        public BoxInfo Box = new();
    }

    private sealed class BoxInfo
    {
        public float[] Min = [0, 0, 0];
        public float[] Max = [0, 0, 0];
        public float[] Center = [0, 0, 0];
        public float Radius;
    }

    private static DrawablePrint PrintDrawable(Drawable drawable, uint hash)
    {
        var print = new DrawablePrint
        {
            Hash = hash,
            Name = drawable.Name,
            Bones = drawable.Skeleton?.Bones?.Items?.Select(bone => bone?.Name ?? "").ToArray() ?? [],
            Shaders = (drawable.ShaderGroup?.Shaders?.data_items ?? []).Select(PrintShader).ToArray(),
            Textures = (drawable.ShaderGroup?.TextureDictionary?.Textures?.data_items ?? []).Select(texture => (texture.Name ?? "").ToLowerInvariant()).ToArray(),
            LodFlags = [drawable.RenderMaskFlagsHigh, drawable.RenderMaskFlagsMed, drawable.RenderMaskFlagsLow, drawable.RenderMaskFlagsVlow],
            Box = BoundsOf(drawable),
        };
        for (var lod = 0; lod < 4; lod += 1)
            print.Lods[lod] = (ModelsOf(drawable, lod) ?? []).Select(PrintModel).ToArray();
        return print;
    }

    private static ShaderPrint PrintShader(ShaderFX shader) => new()
    {
        Name = shader.Name.Hash,
        File = shader.FileName.Hash,
        Bucket = shader.RenderBucket,
        Parameters = shader.ParametersList?.Count ?? 0,
        Textures = string.Join("|", (shader.ParametersList?.Parameters ?? []).Select(parameter => parameter.Data is TextureBase texture ? (texture.Name ?? "").ToLowerInvariant() : "v")),
    };

    private static ModelPrint PrintModel(DrawableModel model)
    {
        var print = new ModelPrint { HasSkin = model.HasSkin, BoneIndex = model.BoneIndex, RenderMask = model.RenderMask };
        var geometries = model.Geometries ?? [];
        for (var index = 0; index < geometries.Length; index += 1)
            print.Geometries.Add(PrintGeometry(geometries[index], model.ShaderMapping is { } map && index < map.Length ? map[index] : geometries[index].ShaderID));
        return print;
    }

    private static GeometryPrint PrintGeometry(DrawableGeometry geometry, int shaderIndex)
    {
        var buffer = geometry.VertexBuffer;
        var info = buffer?.Info;
        var data = buffer?.Data1 ?? buffer?.Data2;
        var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        if (info is not null)
        {
            hash.AppendData(BitConverter.GetBytes(info.Flags));
            hash.AppendData(BitConverter.GetBytes((ulong)info.Types));
            hash.AppendData(BitConverter.GetBytes(info.Stride));
        }
        if (data?.VertexBytes is { } vertexBytes) hash.AppendData(vertexBytes);
        var indices = geometry.IndexBuffer?.Indices ?? [];
        hash.AppendData(MemoryMarshal.AsBytes(indices.AsSpan()));
        if (geometry.BoneIds is { } palette) hash.AppendData(MemoryMarshal.AsBytes(palette.AsSpan()));
        return new GeometryPrint
        {
            Hash = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
            ShaderIndex = shaderIndex,
            Vertices = data?.VertexCount ?? 0,
            Indices = indices.Length,
            Skinned = info is not null && CarriesSkin(info),
            Palette = geometry.BoneIds is { } ids ? (ushort[])ids.Clone() : null,
        };
    }

    private static bool CarriesSkin(VertexDeclaration info) =>
        (info.Flags & 6u) == 6u &&
        VertexComponentTypes.GetSizeInBytes(info.GetComponentType(1)) == 4 &&
        VertexComponentTypes.GetSizeInBytes(info.GetComponentType(2)) == 4;

    private static BoxInfo BoundsOf(Drawable drawable) => new()
    {
        Min = [drawable.BoundingBoxMin.X, drawable.BoundingBoxMin.Y, drawable.BoundingBoxMin.Z],
        Max = [drawable.BoundingBoxMax.X, drawable.BoundingBoxMax.Y, drawable.BoundingBoxMax.Z],
        Center = [drawable.BoundingCenter.X, drawable.BoundingCenter.Y, drawable.BoundingCenter.Z],
        Radius = drawable.BoundingSphereRadius,
    };

    private static DrawableModel[]? ModelsOf(DrawableBase drawable, int lod)
    {
        var block = drawable.DrawableModels;
        if (block is null) return null;
        return lod switch { 0 => block.High, 1 => block.Med, 2 => block.Low, _ => block.VLow };
    }

    /* ------------------------------------------------------------------ *
     * Правка одного drawable.
     * ------------------------------------------------------------------ */

    private sealed class LodReport
    {
        public string Lod = "";
        public int Models;
        public int Before;
        public int After;
        public int Glow;
        public int Marker;
        public uint FlagsBefore;
        public uint FlagsAfter;
    }

    private sealed class DrawableReport
    {
        public uint Hash;
        public string? Name;
        public bool Marker;
        public bool Glow;
        public List<LodReport> Lods = [];
        public int ShadersBefore;
        public int ShadersAfter;
        public int MarkerShader = -1;
        public int GlowShader = -1;
        public string[] AddedTextures = [];
        public BoxInfo BoundsBefore = new();
        public BoxInfo BoundsAfter = new();
        public float MarkerMaxZ = float.NegativeInfinity;
        public int ExpectedGeometries;
    }

    private static DrawableReport PatchDrawable(Drawable drawable, uint hash, Marker? marker, Glow? glow, string work)
    {
        var group = drawable.ShaderGroup ?? throw new InvalidDataException($"У drawable {hash} нет группы шейдеров: шейдеру метки некуда встать.");
        if (group.Shaders?.data_items is null) throw new InvalidDataException($"У drawable {hash} нет списка шейдеров.");
        if (drawable.DrawableModels is null) throw new InvalidDataException($"У drawable {hash} нет моделей.");
        var report = new DrawableReport
        {
            Hash = hash,
            Name = drawable.Name,
            Marker = marker is not null,
            Glow = glow is not null,
            ShadersBefore = group.Shaders.data_items.Length,
            BoundsBefore = BoundsOf(drawable),
        };

        /* Листы — во встроенный словарь группы (есть — дополняем, нет — заводим), шейдеры — в конец списка. */
        var textures = (group.TextureDictionary?.Textures?.data_items ?? []).ToList();
        var shaders = group.Shaders.data_items.ToList();
        var fresh = new List<ShaderFX>();
        var added = new List<string>();
        foreach (var sheet in new[] { marker?.Sheet, glow?.Sheet })
        {
            if (sheet is null) continue;
            if (textures.Any(texture => string.Equals(texture.Name, sheet.Name, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException($"В drawable {hash} уже есть лист {sheet.Name}: файл уже правили.");
            File.WriteAllBytes(Path.Combine(work, sheet.File), sheet.Bytes);
            var texture = new Texture();
            texture.ReadXml(Fragment(TextureXml(sheet)), work);
            texture.VFT = EmbeddedTextureVft;
            textures.Add(texture);
            added.Add(sheet.Name);
        }
        if (marker is not null)
        {
            report.MarkerShader = shaders.Count + fresh.Count;
            fresh.Add(ShaderOf(marker.Sheet.Name, marker.Emissive));
        }
        if (glow is not null)
        {
            report.GlowShader = shaders.Count + fresh.Count;
            fresh.Add(ShaderOf(glow.Sheet.Name, glow.Emissive));
        }
        if (group.TextureDictionary is null)
            group.TextureDictionary = new TextureDictionary { FileVFT = EmbeddedDictionaryVft, FileUnknown = 1 };
        group.TextureDictionary.BuildFromTextureList(textures);
        foreach (var shader in fresh)
        {
            /* Параметр-лист ссылается на встроенную текстуру (тот же объект): так её пишет и сам CodeWalker. */
            foreach (var parameter in shader.ParametersList.Parameters)
                if (parameter.Data is TextureBase reference && group.TextureDictionary.Lookup(reference.NameHash) is { } embedded)
                    parameter.Data = embedded;
            shaders.Add(shader);
        }
        group.Shaders.data_items = shaders.ToArray();
        report.ShadersAfter = shaders.Count;
        report.AddedTextures = added.ToArray();

        var touched = new List<(Vector3 Min, Vector3 Max)>();
        var anyLod = false;
        for (var lod = 0; lod < 4; lod += 1)
        {
            var models = ModelsOf(drawable, lod);
            var lodReport = new LodReport
            {
                Lod = LodNames[lod],
                Models = models?.Length ?? 0,
                Before = models?.Sum(model => model?.Geometries?.Length ?? 0) ?? 0,
                FlagsBefore = LodFlagsOf(drawable, lod),
            };
            report.Lods.Add(lodReport);
            if (models is null || lodReport.Before == 0)
            {
                lodReport.After = lodReport.Before;
                lodReport.FlagsAfter = lodReport.FlagsBefore;
                continue;
            }
            anyLod = true;
            var plan = new List<(DrawableModel Model, List<DrawableGeometry> Add)>();
            /* Свечение — копия каждой исходной геометрии каждой части уровня (до того, как встанет метка). */
            foreach (var model in models)
            {
                var add = new List<DrawableGeometry>();
                plan.Add((model, add));
                if (glow is null || model.Geometries is null) continue;
                foreach (var geometry in model.Geometries)
                {
                    add.Add(ShellOf(geometry, model, glow.Inflate, report.GlowShader, hash, lod));
                    lodReport.Glow += 1;
                }
            }
            if (marker is not null)
            {
                var target = plan.FirstOrDefault(item => item.Model.HasSkin == 1 && (item.Model.Geometries?.Length ?? 0) > 0);
                if (target.Model is null)
                    throw new InvalidDataException($"Метка: у drawable {hash} на уровне {LodNames[lod]} нет скинованной модели — метку не к чему привязать.");
                target.Add.Add(MarkerOf(marker, target.Model, report.MarkerShader, hash, lod));
                lodReport.Marker += 1;
            }
            foreach (var (model, add) in plan)
            {
                if (add.Count == 0) continue;
                Append(model, add);
                foreach (var geometry in add) touched.Add((new Vector3(geometry.AABB.Min.X, geometry.AABB.Min.Y, geometry.AABB.Min.Z), new Vector3(geometry.AABB.Max.X, geometry.AABB.Max.Y, geometry.AABB.Max.Z)));
            }
            /* Маски корзин: у шейдера `emissive_alpha` корзина 1 — бит 2 у уровня и у частей. */
            foreach (var (model, add) in plan)
                if (add.Count > 0) model.RenderMask = (byte)(model.RenderMask | AlphaBucketBit);
            SetLodFlags(drawable, lod, (byte)(LodFlagsOf(drawable, lod) & 0xFF | AlphaBucketBit), models.Aggregate((byte)0, (mask, model) => (byte)(mask | model.RenderMask)));
            lodReport.After = models.Sum(model => model.Geometries?.Length ?? 0);
            lodReport.FlagsAfter = LodFlagsOf(drawable, lod);
        }
        if (!anyLod) throw new InvalidDataException($"У drawable {hash} нет ни одного уровня детализации с геометрией.");
        report.ExpectedGeometries = report.Lods.Sum(item => item.After);

        /* Рамки drawable: коробка — прежняя плюс новые точки, сфера — вокруг коробки и прежней сферы. */
        var min = drawable.BoundingBoxMin;
        var max = drawable.BoundingBoxMax;
        foreach (var (low, high) in touched)
        {
            min = Vector3.Min(min, low);
            max = Vector3.Max(max, high);
        }
        var oldCentre = drawable.BoundingCenter;
        var oldRadius = drawable.BoundingSphereRadius;
        var centre = (min + max) / 2f;
        var radius = (max - min).Length() / 2f;
        radius = Math.Max(radius, (centre - oldCentre).Length() + oldRadius);
        drawable.BoundingBoxMin = min;
        drawable.BoundingBoxMax = max;
        drawable.BoundingCenter = centre;
        drawable.BoundingSphereRadius = radius;
        report.BoundsAfter = BoundsOf(drawable);
        if (marker is not null)
            report.MarkerMaxZ = marker.Positions.Where((_, at) => at % 3 == 2).Max();

        drawable.BuildAllModels();
        drawable.BuildVertexDecls();
        drawable.AssignGeometryShaders(group);
        return report;
    }

    /* Как у встроенных листов и словарей игры (проверено на образцах): таблицы виртуальных функций. */
    private const uint EmbeddedTextureVft = 1080128872;
    private const uint EmbeddedDictionaryVft = 1079473560;

    private static uint LodFlagsOf(DrawableBase drawable, int lod) => lod switch
    {
        0 => drawable.RenderMaskFlagsHigh,
        1 => drawable.RenderMaskFlagsMed,
        2 => drawable.RenderMaskFlagsLow,
        _ => drawable.RenderMaskFlagsVlow,
    };

    /* Маска уровня: младший байт — корзины его шейдеров, второй — маска частей. */
    private static void SetLodFlags(DrawableBase drawable, int lod, byte flags, byte renderMask)
    {
        switch (lod)
        {
            case 0:
                drawable.FlagsHigh = flags;
                drawable.RenderMaskHigh = renderMask;
                break;
            case 1:
                drawable.FlagsMed = flags;
                drawable.RenderMaskMed = renderMask;
                break;
            case 2:
                drawable.FlagsLow = flags;
                drawable.RenderMaskLow = renderMask;
                break;
            default:
                drawable.FlagsVlow = flags;
                drawable.RenderMaskVlow = renderMask;
                break;
        }
    }

    /* Новые геометрии — в конец модели: карты шейдеров и рамок собираются заново. */
    private static void Append(DrawableModel model, List<DrawableGeometry> add)
    {
        var old = model.Geometries ?? [];
        var all = old.Concat(add).ToArray();
        var mapping = new ushort[all.Length];
        for (var index = 0; index < old.Length; index += 1)
            mapping[index] = model.ShaderMapping is { } existing && index < existing.Length ? existing[index] : old[index].ShaderID;
        for (var index = 0; index < add.Count; index += 1)
            mapping[old.Length + index] = add[index].ShaderID;
        var boxes = all.Select(geometry => geometry.AABB).ToArray();
        var min = model.BoundsData is { Length: > 1 } outer ? outer[0].Min : boxes[0].Min;
        var max = model.BoundsData is { Length: > 1 } outerMax ? outerMax[0].Max : boxes[0].Max;
        foreach (var box in boxes)
        {
            min = Vector4.Min(min, box.Min);
            max = Vector4.Max(max, box.Max);
        }
        model.Geometries = all;
        model.ShaderMapping = mapping;
        model.BoundsData = all.Length > 1 ? new[] { new AABB_s { Min = min, Max = max } }.Concat(boxes).ToArray() : [boxes[0]];
        model.GeometriesCount1 = model.GeometriesCount2 = model.GeometriesCount3 = (ushort)all.Length;
    }

    /* ------------------------------------------------------------------ *
     * Новые геометрии.
     * ------------------------------------------------------------------ */

    private static DrawableGeometry MarkerOf(Marker marker, DrawableModel model, int shaderIndex, uint hash, int lod)
    {
        /* Палитра — как у соседней скинованной геометрии; слот, под которым в ней корень (кость 0). */
        var template = (model.Geometries ?? []).FirstOrDefault(geometry => geometry.VertexBuffer?.Info is { } info && CarriesSkin(info))
            ?? throw new InvalidDataException($"Метка: в модели drawable {hash} ({LodNames[lod]}) нет скинованной геометрии для образца палитры костей.");
        ushort[]? palette = null;
        var slot = 0;
        if (template.BoneIds is { Length: > 0 } source)
        {
            slot = Array.IndexOf(source, (ushort)0);
            if (slot >= 0)
            {
                palette = (ushort[])source.Clone();
            }
            else
            {
                palette = [0];
                slot = 0;
            }
        }
        var count = marker.Positions.Length / 3;
        var weights = new byte[count * 4];
        var bones = new byte[count * 4];
        for (var vertex = 0; vertex < count; vertex += 1)
        {
            /* Вес 255 в третьей колонке и номер в той же — так лежат вершины самих животных и стволов игры. */
            weights[vertex * 4 + 2] = 255;
            bones[vertex * 4 + 2] = (byte)slot;
        }
        return BuildGeometry(marker.Positions, marker.Normals, marker.Uvs, weights, bones, marker.Indices, skinned: true, palette, shaderIndex);
    }

    private static DrawableGeometry ShellOf(DrawableGeometry source, DrawableModel model, float inflate, int shaderIndex, uint hash, int lod)
    {
        var buffer = source.VertexBuffer;
        var info = buffer?.Info;
        var data = buffer?.Data1 ?? buffer?.Data2;
        var place = $"drawable {hash}, уровень {LodNames[lod]}";
        if (info is null || data?.VertexBytes is null || source.IndexBuffer?.Indices is null)
            throw new InvalidDataException($"Свечение: у геометрии нет буферов вершин или индексов ({place}).");
        if ((info.Flags & 1u) == 0 || info.GetComponentType(0) != VertexComponentType.Float3)
            throw new InvalidDataException($"Свечение: позиции вершин не float3 ({place}).");
        if ((info.Flags & (1u << 3)) == 0 || info.GetComponentType(3) != VertexComponentType.Float3)
            throw new InvalidDataException($"Свечение: у геометрии нет нормалей float3 — сдвигать вершины не по чему ({place}).");
        if ((info.Flags & (1u << 6)) == 0 || info.GetComponentType(6) != VertexComponentType.Float2)
            throw new InvalidDataException($"Свечение: у геометрии нет развёртки float2 ({place}).");
        var skinned = model.HasSkin == 1;
        if (skinned && !CarriesSkin(info))
            throw new InvalidDataException($"Свечение: модель скинована, а у геометрии нет весов и костей ({place}).");
        var count = data.VertexCount;
        var stride = info.Stride;
        if (count < 1 || data.VertexBytes.Length < count * stride)
            throw new InvalidDataException($"Свечение: буфер вершин короче заявленного ({place}).");
        var bytes = data.VertexBytes;
        var positionAt = info.GetComponentOffset(0);
        var normalAt = info.GetComponentOffset(3);
        var uvAt = info.GetComponentOffset(6);
        var weightsAt = skinned ? info.GetComponentOffset(1) : 0;
        var indicesAt = skinned ? info.GetComponentOffset(2) : 0;
        var positions = new float[count * 3];
        var normals = new float[count * 3];
        var uvs = new float[count * 2];
        var weights = skinned ? new byte[count * 4] : null;
        var bones = skinned ? new byte[count * 4] : null;
        for (var vertex = 0; vertex < count; vertex += 1)
        {
            var at = vertex * stride;
            float nx = BitConverter.ToSingle(bytes, at + normalAt);
            float ny = BitConverter.ToSingle(bytes, at + normalAt + 4);
            float nz = BitConverter.ToSingle(bytes, at + normalAt + 8);
            var length = MathF.Sqrt(nx * nx + ny * ny + nz * nz);
            var scale = length > 1e-6f ? inflate / length : 0f;
            positions[vertex * 3] = BitConverter.ToSingle(bytes, at + positionAt) + nx * scale;
            positions[vertex * 3 + 1] = BitConverter.ToSingle(bytes, at + positionAt + 4) + ny * scale;
            positions[vertex * 3 + 2] = BitConverter.ToSingle(bytes, at + positionAt + 8) + nz * scale;
            normals[vertex * 3] = nx;
            normals[vertex * 3 + 1] = ny;
            normals[vertex * 3 + 2] = nz;
            uvs[vertex * 2] = BitConverter.ToSingle(bytes, at + uvAt);
            uvs[vertex * 2 + 1] = BitConverter.ToSingle(bytes, at + uvAt + 4);
            if (!skinned) continue;
            Buffer.BlockCopy(bytes, at + weightsAt, weights!, vertex * 4, 4);
            Buffer.BlockCopy(bytes, at + indicesAt, bones!, vertex * 4, 4);
        }
        var palette = source.BoneIds is { Length: > 0 } ids ? (ushort[])ids.Clone() : null;
        return BuildGeometry(positions, normals, uvs, weights, bones, (ushort[])source.IndexBuffer.Indices.Clone(), skinned, palette, shaderIndex);
    }

    /*
     * Геометрия, собранная прямо в памяти: раскладка GTAV1 (скинованная —
     * позиция, веса, номера костей, нормаль, цвет, развёртка), белый цвет вершин,
     * один буфер вершин на обе ссылки, 16-битные индексы — как у разобранных из файла.
     */
    private static DrawableGeometry BuildGeometry(float[] positions, float[] normals, float[] uvs, byte[]? weights, byte[]? bones, ushort[] indices, bool skinned, ushort[]? palette, int shaderIndex)
    {
        var count = positions.Length / 3;
        if (count < 3 || count > ushort.MaxValue)
            throw new InvalidDataException("Геометрия: число вершин вне 3…65535 (индексы игры — 16 бит).");
        var info = new VertexDeclaration
        {
            Flags = skinned ? SkinnedFlags : RigidFlags,
            Types = (VertexDeclarationTypes)DeclarationTypes,
            Unknown_6h = 0,
        };
        info.UpdateCountAndStride();
        var stride = info.Stride;
        var bytes = new byte[count * stride];
        var positionAt = info.GetComponentOffset(0);
        var weightsAt = info.GetComponentOffset(1);
        var indicesAt = info.GetComponentOffset(2);
        var normalAt = info.GetComponentOffset(3);
        var colourAt = info.GetComponentOffset(4);
        var uvAt = info.GetComponentOffset(6);
        var low = new Vector3(float.MaxValue);
        var high = new Vector3(float.MinValue);
        for (var vertex = 0; vertex < count; vertex += 1)
        {
            var at = vertex * stride;
            for (var axis = 0; axis < 3; axis += 1)
            {
                var position = positions[vertex * 3 + axis];
                Buffer.BlockCopy(BitConverter.GetBytes(position), 0, bytes, at + positionAt + axis * 4, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(normals[vertex * 3 + axis]), 0, bytes, at + normalAt + axis * 4, 4);
                low[axis] = Math.Min(low[axis], position);
                high[axis] = Math.Max(high[axis], position);
            }
            if (skinned)
            {
                Buffer.BlockCopy(weights!, vertex * 4, bytes, at + weightsAt, 4);
                Buffer.BlockCopy(bones!, vertex * 4, bytes, at + indicesAt, 4);
            }
            for (var channel = 0; channel < 4; channel += 1) bytes[at + colourAt + channel] = 255;
            Buffer.BlockCopy(BitConverter.GetBytes(uvs[vertex * 2]), 0, bytes, at + uvAt, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(uvs[vertex * 2 + 1]), 0, bytes, at + uvAt + 4, 4);
        }
        var data = new VertexData
        {
            VertexStride = stride,
            VertexCount = count,
            Info = info,
            VertexType = (VertexType)info.Flags,
            VertexBytes = bytes,
        };
        var buffer = new VertexBuffer { VertexStride = (ushort)stride, Info = info, Data1 = data, Data2 = data };
        return new DrawableGeometry
        {
            VertexBuffer = buffer,
            VertexData = data,
            IndexBuffer = new IndexBuffer { Indices = indices, IndicesCount = (uint)indices.Length },
            BoneIds = palette,
            ShaderID = (ushort)shaderIndex,
            /* Рамка геометрии у Rockstar: четвёртая компонента повторяет первую. */
            AABB = new AABB_s { Min = new Vector4(low.X, low.Y, low.Z, low.X), Max = new Vector4(high.X, high.Y, high.Z, high.X) },
        };
    }

    /* ------------------------------------------------------------------ *
     * Шейдер и лист — те же фрагменты XML, что у `decorate-drawable`.
     * ------------------------------------------------------------------ */

    private static ShaderFX ShaderOf(string texture, float emissive)
    {
        var xml = new StringBuilder()
            .Append("<Item>")
            .Append("<Name>emissive</Name>")
            .Append("<FileName>emissive_alpha.sps</FileName>")
            .Append("<RenderBucket value=\"1\" />")
            .Append("<Parameters>")
            .Append("<Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(texture).Append("</Name></Item>")
            .Append("<Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />")
            .Append("<Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"").Append(F(emissive)).Append("\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />")
            .Append("<Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />")
            .Append("</Parameters></Item>");
        var shader = new ShaderFX();
        shader.ReadXml(Fragment(xml.ToString()));
        return shader;
    }

    private static string TextureXml(DdsSheet sheet)
    {
        var side = Math.Max(sheet.Width, sheet.Height);
        var flags = new List<string> { "NOT_HALF", "X32", "X64", "X128" };
        if (side >= 512) flags.Add("X512");
        if (side >= 1024) flags.Add("X1024");
        flags.Add("UNK24");
        return new StringBuilder()
            .Append("<Item>")
            .Append("<Name>").Append(sheet.Name).Append("</Name>")
            .Append("<Unk32 value=\"128\" />")
            .Append("<Usage>DIFFUSE</Usage>")
            .Append("<UsageFlags>").Append(string.Join(", ", flags)).Append("</UsageFlags>")
            .Append("<ExtraFlags value=\"0\" />")
            .Append("<Width value=\"").Append(sheet.Width).Append("\" />")
            .Append("<Height value=\"").Append(sheet.Height).Append("\" />")
            .Append("<MipLevels value=\"").Append(sheet.Levels).Append("\" />")
            .Append("<Format>D3DFMT_DXT5</Format>")
            .Append("<FileName>").Append(sheet.File).Append("</FileName>")
            .Append("</Item>")
            .ToString();
    }

    private static XmlElement Fragment(string xml)
    {
        var holder = new XmlDocument();
        holder.LoadXml(xml);
        return holder.DocumentElement!;
    }

    private static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);

    /* ------------------------------------------------------------------ *
     * Чтение заново и сверка.
     * ------------------------------------------------------------------ */

    private sealed class Reopened
    {
        public int Drawables;
        public int Unchanged;
        public List<object> Changed = [];
    }

    private static Reopened Reopen(byte[] bytes, uint[] hashes, string?[] names, Dictionary<uint, DrawablePrint> before, Dictionary<uint, DrawableReport> reports, Marker? marker, Glow? glow)
    {
        var ydd = new YddFile();
        try
        {
            ydd.Load(bytes);
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            throw new InvalidDataException("Собранная модель не открывается заново: " + error.Message);
        }
        var items = ydd.DrawableDict?.Drawables?.data_items;
        var again = ydd.DrawableDict?.Hashes;
        if (!ydd.Loaded || items is null || again is null || !again.SequenceEqual(hashes) || items.Length != hashes.Length)
            throw new InvalidDataException("Собранная модель после открытия заново: хэши drawable не те, что были.");

        /* Имена drawable в файле — прежние (читаются тем же вторым проходом, что и до правки). */
        var namesNow = ReadNames(bytes, items.Length);
        for (var index = 0; index < names.Length; index += 1)
            if (!string.Equals(names[index], namesNow[index], StringComparison.Ordinal))
                throw new InvalidDataException($"drawable {hashes[index]}: имя в файле изменилось ('{names[index]}' → '{namesNow[index]}').");

        var result = new Reopened { Drawables = items.Length };
        for (var index = 0; index < items.Length; index += 1)
        {
            var hash = hashes[index];
            var drawable = items[index];
            var was = before[hash];
            var now = PrintDrawable(drawable, hash);
            reports.TryGetValue(hash, out var report);
            var changed = report is not null;

            /* Скелет, имена и прежние шейдеры — те же во всех drawable. */
            if (!now.Bones.SequenceEqual(was.Bones, StringComparer.Ordinal))
                throw new InvalidDataException($"drawable {hash}: кости скелета изменились при пересборке.");
            if (changed ? now.Shaders.Length != was.Shaders.Length + (report!.ShadersAfter - report.ShadersBefore) : now.Shaders.Length != was.Shaders.Length)
                throw new InvalidDataException($"drawable {hash}: число шейдеров не то, что собирали.");
            for (var shader = 0; shader < was.Shaders.Length; shader += 1)
                if (!SameShader(was.Shaders[shader], now.Shaders[shader]))
                    throw new InvalidDataException($"drawable {hash}: прежний шейдер {shader} изменился.");
            foreach (var texture in was.Textures)
                if (!now.Textures.Contains(texture))
                    throw new InvalidDataException($"drawable {hash}: прежний встроенный лист {texture} пропал.");

            if (!changed)
            {
                /* Чужой drawable — без единого отличия. */
                if (!SameDrawable(was, now))
                    throw new InvalidDataException($"drawable {hash}: он не в запросе, но изменился.");
                if (now.Textures.Length != was.Textures.Length)
                    throw new InvalidDataException($"drawable {hash}: у нетронутого drawable изменился встроенный словарь.");
                if (!BoundsEqual(was.Box, now.Box) || !was.LodFlags.SequenceEqual(now.LodFlags))
                    throw new InvalidDataException($"drawable {hash}: у нетронутого drawable изменились рамки или маски.");
                result.Unchanged += 1;
                continue;
            }

            var lodRows = new List<object>();
            for (var lod = 0; lod < 4; lod += 1)
            {
                var lodReport = report!.Lods[lod];
                var oldModels = was.Lods[lod];
                var newModels = now.Lods[lod];
                if (oldModels.Length != newModels.Length)
                    throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: число частей модели изменилось.");
                var markerGeometries = 0;
                var glowGeometries = 0;
                for (var m = 0; m < oldModels.Length; m += 1)
                {
                    var old = oldModels[m];
                    var current = newModels[m];
                    if (old.HasSkin != current.HasSkin || old.BoneIndex != current.BoneIndex)
                        throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: привязка части модели к скелету изменилась.");
                    for (var g = 0; g < old.Geometries.Count; g += 1)
                    {
                        if (g >= current.Geometries.Count || old.Geometries[g].Hash != current.Geometries[g].Hash || old.Geometries[g].ShaderIndex != current.Geometries[g].ShaderIndex)
                            throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: исходная геометрия {g} изменилась (вершины, индексы, веса, палитра или шейдер).");
                    }
                    for (var g = old.Geometries.Count; g < current.Geometries.Count; g += 1)
                    {
                        var print = current.Geometries[g];
                        var isMarkerShader = print.ShaderIndex == report!.MarkerShader;
                        var isGlowShader = print.ShaderIndex == report.GlowShader;
                        if (!isMarkerShader && !isGlowShader)
                            throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: новая геометрия смотрит на чужой шейдер {print.ShaderIndex}.");
                        if (current.HasSkin == 1 && !print.Skinned)
                            throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: новая геометрия без весов в скинованной модели.");
                        if (isMarkerShader) markerGeometries += 1;
                        else glowGeometries += 1;
                    }
                    if ((current.RenderMask & AlphaBucketBit) == 0 && current.Geometries.Count > old.Geometries.Count)
                        throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: у части нет бита корзины прозрачности.");
                }
                if (markerGeometries != lodReport.Marker || glowGeometries != lodReport.Glow)
                    throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: после чтения новых геометрий {markerGeometries}+{glowGeometries}, собирали {lodReport.Marker}+{lodReport.Glow}.");
                var total = newModels.Sum(model => model.Geometries.Count);
                if (total != lodReport.After || oldModels.Sum(model => model.Geometries.Count) != lodReport.Before)
                    throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: число геометрий после чтения {total}, собирали {lodReport.After}.");
                if ((lodReport.Marker + lodReport.Glow) > 0 && (now.LodFlags[lod] & AlphaBucketBit) == 0)
                    throw new InvalidDataException($"drawable {hash}, {LodNames[lod]}: в масках уровня нет корзины прозрачности.");
                lodRows.Add(new
                {
                    lod = LodNames[lod],
                    models = newModels.Length,
                    geometriesBefore = lodReport.Before,
                    geometriesAfter = total,
                    glow = glowGeometries,
                    marker = markerGeometries,
                    flagsBefore = was.LodFlags[lod],
                    flagsAfter = now.LodFlags[lod],
                });
            }

            /* Шейдеры: корзина 1, emissive_alpha.sps, лист — свой. */
            var shaders = drawable.ShaderGroup!.Shaders!.data_items;
            var embedded = drawable.ShaderGroup.TextureDictionary?.Textures?.data_items ?? [];
            var expectedFile = JenkHash.GenHash("emissive_alpha.sps");
            var shaderRows = new List<object>();
            foreach (var (shaderIndex, sheet, emissive) in new[] { (report!.MarkerShader, marker?.Sheet, marker?.Emissive ?? 0f), (report.GlowShader, glow?.Sheet, glow?.Emissive ?? 0f) })
            {
                if (shaderIndex < 0 || sheet is null) continue;
                var shader = shaders[shaderIndex];
                var texture = embedded.FirstOrDefault(item => string.Equals(item.Name, sheet.Name, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidDataException($"drawable {hash}: лист {sheet.Name} не нашёлся во встроенном словаре.");
                if (shader.FileName.Hash != expectedFile || shader.RenderBucket != 1)
                    throw new InvalidDataException($"drawable {hash}: шейдер {shaderIndex} — не emissive_alpha.sps в корзине 1.");
                if (!shader.ParametersList.Parameters.Any(parameter => ReferenceEquals(parameter.Data, texture)))
                    throw new InvalidDataException($"drawable {hash}: шейдер {shaderIndex} не смотрит на встроенный лист {sheet.Name}.");
                if (texture.Format != TextureFormat.D3DFMT_DXT5 || texture.Width != sheet.Width || texture.Height != sheet.Height || texture.Levels != sheet.Levels)
                    throw new InvalidDataException($"drawable {hash}: лист {sheet.Name} после чтения не {sheet.Width}x{sheet.Height} DXT5 с {sheet.Levels} уровнями.");
                shaderRows.Add(new
                {
                    index = shaderIndex,
                    texture = sheet.Name,
                    shader = "emissive_alpha.sps",
                    bucket = (int)shader.RenderBucket,
                    emissive,
                    width = (int)texture.Width,
                    height = (int)texture.Height,
                    mipLevels = (int)texture.Levels,
                });
            }

            /* Рамка drawable вмещает всё: и прежнюю рамку, и каждую новую точку. */
            var box = now.Box;
            for (var axis = 0; axis < 3; axis += 1)
                if (box.Min[axis] > was.Box.Min[axis] + 1e-6f || box.Max[axis] < was.Box.Max[axis] - 1e-6f)
                    throw new InvalidDataException($"drawable {hash}: рамка сузилась.");
            if (marker is not null && marker.Drawable == hash)
            {
                var markerBox = BoxOf(marker.Positions);
                for (var axis = 0; axis < 3; axis += 1)
                    if (box.Min[axis] > markerBox.Min[axis] + 1e-5f || box.Max[axis] < markerBox.Max[axis] - 1e-5f)
                        throw new InvalidDataException($"drawable {hash}: рамка не вмещает метку.");
            }
            result.Changed.Add(new
            {
                hash,
                name = now.Name,
                marker = report.Marker,
                glow = report.Glow,
                lods = lodRows,
                shaders = new { before = was.Shaders.Length, after = now.Shaders.Length, added = shaderRows },
                textures = new { before = was.Textures, after = now.Textures },
                bounds = new { before = Describe(was.Box), after = Describe(now.Box) },
                boneCount = now.Bones.Length,
            });
        }
        return result;
    }

    private static BoxInfo BoxOf(float[] positions)
    {
        var box = new BoxInfo { Min = [float.MaxValue, float.MaxValue, float.MaxValue], Max = [float.MinValue, float.MinValue, float.MinValue] };
        for (var at = 0; at < positions.Length; at += 3)
            for (var axis = 0; axis < 3; axis += 1)
            {
                box.Min[axis] = Math.Min(box.Min[axis], positions[at + axis]);
                box.Max[axis] = Math.Max(box.Max[axis], positions[at + axis]);
            }
        return box;
    }

    private static bool BoundsEqual(BoxInfo left, BoxInfo right) =>
        left.Min.SequenceEqual(right.Min) && left.Max.SequenceEqual(right.Max) && left.Center.SequenceEqual(right.Center) && left.Radius == right.Radius;

    private static object Describe(BoxInfo box) => new { min = box.Min, max = box.Max, center = box.Center, radius = box.Radius };

    private static bool SameShader(ShaderPrint left, ShaderPrint right) =>
        left.Name == right.Name && left.File == right.File && left.Bucket == right.Bucket && left.Parameters == right.Parameters && left.Textures == right.Textures;

    /* Нетронутый drawable: каждая часть, геометрия, шейдер и маска — прежние. */
    private static bool SameDrawable(DrawablePrint left, DrawablePrint right)
    {
        for (var lod = 0; lod < 4; lod += 1)
        {
            if (left.Lods[lod].Length != right.Lods[lod].Length) return false;
            for (var m = 0; m < left.Lods[lod].Length; m += 1)
            {
                var a = left.Lods[lod][m];
                var b = right.Lods[lod][m];
                if (a.HasSkin != b.HasSkin || a.BoneIndex != b.BoneIndex || a.RenderMask != b.RenderMask || a.Geometries.Count != b.Geometries.Count) return false;
                for (var g = 0; g < a.Geometries.Count; g += 1)
                    if (a.Geometries[g].Hash != b.Geometries[g].Hash || a.Geometries[g].ShaderIndex != b.Geometries[g].ShaderIndex) return false;
            }
        }
        return true;
    }

    /* ------------------------------------------------------------------ *
     * Ответ.
     * ------------------------------------------------------------------ */

    private static object Answer(string path, byte[] bytes, byte[] modelBytes, Reopened reopened) => new
    {
        status = "ok",
        file = Path.GetFileName(path),
        output = path,
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        input = new { bytes = modelBytes.Length, sha256 = Convert.ToHexString(SHA256.HashData(modelBytes)).ToLowerInvariant() },
        semantic = new
        {
            semanticReopen = true,
            drawables = reopened.Drawables,
            unchangedDrawables = reopened.Unchanged,
            changed = reopened.Changed,
            markerTexture = MarkerTextureName,
            glowTexture = GlowTextureName,
        },
    };

    private sealed record AnimalRequest(
        string? Format = null,
        int Version = 0,
        string? Input = null,
        string? Output = null,
        MarkerRequest? Marker = null,
        GlowRequest? Glow = null);

    private sealed record MarkerRequest(
        uint Drawable = 0,
        float[]? Positions = null,
        float[]? Normals = null,
        float[]? Uvs = null,
        int[]? Indices = null,
        string? Texture = null,
        float? Emissive = null);

    private sealed record GlowRequest(
        uint[]? Drawables = null,
        float? Inflate = null,
        string? Texture = null,
        float? Emissive = null);
}
