using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// «Дирижабли» (ТЗ 11.10.2026): то, что летает по кругу в небе GTA V, —
/// дирижабль с нашей надписью, дракон, шар, фонарики, НЛО, кит.
///
/// Летит оно как «анимированная постройка» игры: модель со скелетом и клип
/// в своём словаре (`.ycd`); архетип с флагами 0x80200 и `clipDictionary`,
/// сущность в своей карте ставит `compile-placements`. Скелет, подписи
/// скелета и анимации и восемь дорожек клипа — те же, что у звезды арены и
/// летающего лого (`StarModelCommands`): штатная сушилка типографии
/// `bkr_prop_prtmachine_dryer_spin`. Всё, что видно, висит на кости
/// барабана (метка 40657, вес 255); в `.ydr` вершины лежат сдвинутыми на
/// её место в покое, а в клипе у барабана место = place(t) и поворот =
/// q(t), так что вершина модели v в момент t оказывается в
/// place(t) + q(t)·v в осях сущности. Оси модели: метры, Z вверх, нос +Y,
/// правый борт +X.
///
/// Отличия от звезды: несколько листов (DXT1 или DXT5) и до 16 геометрий
/// со своими шейдерами (`default`, `emissive`, `emissive_alpha` — набор
/// параметров тот же, что у звезды), у клипа — произвольный полёт.
///
/// Как устроен клип полёта и откуда это взято (разбор всех 24 986 `.ycd`
/// игры игрока CodeWalker'ом, 11.10.2026):
///   • поворот — четыре хранимые составляющие и метка CachedQuaternion2 с
///     QuatIndex 0: [Q x, Q y, Q z, Q w, C2:0], постоянная составляющая —
///     StaticFloat. Так у самой сушилки: барабан [S, Q11, S, Q12, C2:0],
///     «Innards» [Q8, Q11, Q8, Q12, C2:0]; так у кувыркающихся обломков
///     (`clipmax.rpf/cropduster_s.ycd`, разрушения `des_*`) и у винтов
///     дронов `reh_prop_reh_drones`. В игре CachedQuaternion1 (три хранимые
///     + восстановление QuatIndex-й через sqrt ≥ 0) встречается только там,
///     где эта составляющая не меняет знак во всём куске клипа (винт дрона
///     [S, S, Q13, C1:2] — z ≥ 0 при w от 1 до −1, колесо обозрения меняет
///     QuatIndex 3↔0 от куска к куску), а где знак меняют все четыре —
///     хранятся все четыре (C2, 46 617 дорожек, QuatIndex всегда 0). Курс
///     дирижабля идёт 0…2π, и окно присылает кватернионы непрерывными по
///     знаку (q(2π) = −q(0)): знак меняют все составляющие, поэтому только
///     C2 — без восстановления и без приведения знака;
///   • место — три QuantizeFloat (StaticFloat у постоянной оси), шаг ≤ 2 мм:
///     у разрушений игры место квантуется до 17 бит на 2,6 км размаха
///     (`des_methtrailer`), бит в игре бывает до 24;
///   • частота: ни один клип игры не реже 5 кадров/с (30 — у 228 тыс. из
///     252 тыс., у всех клипов построек — 30; 15, 10 и 5 — у клипов
///     персонажей). Поэтому редкие кадры окна (сотни на минуты полёта)
///     здесь пересчитываются на 30 кадров/с (15, 10 или 5 — если иначе
///     выйдет больше 9001 кадра) той же линейной интерполяцией, что делает
///     игра между кадрами: место — отрезками, поворот — нормированной
///     смесью соседних кватернионов. Самый длинный клип постройки —
///     `vw_des_vine_casino_doors` (10 000 кадров, 333 с, 30 кадров/с);
///   • куски (sequences): до 1504 кадров — один кусок, SequenceFrameLimit =
///     16k − 1 ≥ кадров − 1 (так у всех одиночных кусков игры: 61 → 63, 301
///     → 303, 10 000 → 9999); длиннее — куски по 1504 кадра с общим кадром
///     на стыке и SequenceFrameLimit 1503 (клип диджея ночного клуба
///     `anim@scripted@nightclub@dj@kmuzk@rampa@`: 9019 кадров, 300,6 с,
///     шесть кусков по 1504; у клипов построек SequenceFrameLimit бывает
///     от 31 до 3855). Подпись куска (Hash) у игры одинакова у кусков
///     с одинаковыми данными — здесь это JenkHash текста куска;
///   • Unknown10 = 1 (клипы построек), подпись анимации F3A95F25 — у сушилки
///     с тем же набором дорожек.
///
/// Рамки `.ydr` (у Drawable и у каждой геометрии) и ответ `bounds`
/// охватывают весь путь с запасом на радиус модели (и модель в покое): по
/// ним игра отсекает сущность, у архетипа — те же bbMin/bbMax.
///
/// «Местное» движение частей (ТЗ 11.10.2026, вечер, задача 3: «чтобы у них
/// двигались крылья»). Новых костей нет — вторая подвижная кость шаблона,
/// «Innards» (метка 64297, номер 3), сестра барабана под «Main». Вершина с
/// долей гибкости w (`geometries[i].flex`, 0…1) висит на двух костях:
/// веса «0 0 (255 − w) w», номера «0 0 2 3» (та же пара слотов, что у
/// сушилки, плюс четвёртый). Клип «Innards» — поворот q(t)·r(t) и место
/// place(t) + q(t)·(f(t) + r(t)·(rest_innards − rest_drum)), где (f, r) —
/// «местная» поза в осях модели (`path.local.frames`: [fx, fy, fz, qx, qy,
/// qz, qw] равномерно на круг). Скиннинг игры (матрица кости на обратную
/// матрицу её покоя) ведёт вершину с барабана в place + q·v, с «Innards» —
/// в place + q·(r·v + f), смесь весов — в place + q·((1 − w)·v + w·(r·v +
/// f)): корни крыльев стоят, концы машут. Без `flex` и `path.local` файлы
/// байт в байт прежние: все веса на барабане, «Innards» стоит в покое.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class SkyFlyerCommands
{
    private const string RequestFormat = "astral.compile-sky-flyer";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 64 * 1024 * 1024;
    private const int MaxDdsBytes = 8 * 1024 * 1024;
    private const int MaxTextures = 8;
    private const int MaxGeometries = 16;
    private const int MaxGeometryVertices = 65000;
    private const int MaxTotalVertices = 150000;
    private const int MaxGeometryIndices = 390000;
    private const int MaxTotalIndices = 900000;
    private const float MaxExtent = 80f;
    private const float MaxUv = 64f;
    private const float MaxEmissive = 64f;
    private const float MinLodDistance = 10f;
    private const float MaxLodDistance = 6000f;
    private const int MinPathFrames = 2;
    private const int MaxPathFrames = 1024;
    private const double MinDuration = 1;
    private const double MaxDuration = 1800;
    private const double MaxPlanar = 3000;
    private const double MinHeight = -100;
    private const double MaxHeight = 2000;
    private const double UnitTolerance = 0.01;
    private const float BoundsMargin = 1f;
    private const string ExportedBy = "Astral Sky Flyer 1";

    /* Частоты клипа: штатные (30 — у построек), от частой к редкой. */
    private static readonly int[] ClipRates = [30, 15, 10, 5];
    private const int MaxClipSteps = 9000;
    private const int LongSequenceLimit = 1503;

    /* Шаг квантования: место — 2 мм (до 20 бит), поворот — 2/65535 (16 бит). */
    private const double PlaceStep = 0.002;
    private const int MaxPlaceBits = 20;
    private const double TurnStep = 2.0 / 65535;
    private const int MaxTurnBits = 16;
    private const int MinBits = 4;
    private const float StaticPlace = 1e-4f;
    private const float StaticTurn = 1e-6f;

    /* Сверка повторным открытием: место — до 0,1 м, поворот — до 1e-2. */
    private const double PlaceTolerance = 0.1;
    private const double TurnTolerance = 1e-2;

    /* «Местное» движение: вторая кость шаблона, кадров — до круга в 300 с при
       30 кадрах/с, сдвиг — до 40 м, стык круга — до 1 см и полградуса. */
    private const int FlexBone = 3;
    private const int MaxLocalFrames = 9001;
    private const double MaxLocalShift = 40;
    private const double LocalLoopPlace = 0.01;
    private const double LocalLoopDegrees = 0.5;

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> CompileAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Sky flyer request must be between 1 byte and 64 MiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Sky flyer request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Sky flyer request has an unknown format.");
        var name = ValidName(request.Name, "model");
        var clipName = ValidName(request.ClipDictionary, "clip dictionary");
        if (clipName == name) throw new InvalidDataException("Sky flyer model and clip dictionary need different names.");
        if (!float.IsFinite(request.LodDist) || request.LodDist < MinLodDistance || request.LodDist > MaxLodDistance)
            throw new InvalidDataException("Sky flyer draw distance must be 10…6000 m.");
        var textures = await ReadTexturesAsync(request.Textures);
        var geometries = ValidateGeometries(request.Geometries, textures);
        var path = ValidatePath(request.Path);
        var local = ValidateLocal(request.Path?.Local);
        var flexes = geometries.Any(geometry => geometry.Flexes);
        if (flexes && local is null) throw new InvalidDataException("Sky flyer flex needs path.local motion.");
        if (local is not null && !flexes) throw new InvalidDataException("Sky flyer path.local needs flex vertices.");

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Sky flyer output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Sky flyer output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Sky flyer output directory must be empty.");

        /* Шейдеры — по одному на сочетание пресета, листа и свечения. */
        var shaders = new List<Shader>();
        var shaderOf = new int[geometries.Length];
        for (var index = 0; index < geometries.Length; index++)
        {
            var wanted = geometries[index].Shader;
            var found = shaders.IndexOf(wanted);
            if (found < 0)
            {
                shaders.Add(wanted);
                found = shaders.Count - 1;
            }
            shaderOf[index] = found;
        }
        var mask = shaders.Aggregate(0, (bits, shader) => bits | shader.Mask);

        var clip = Resample(path, local);
        var rest = StarModelCommands.Bones[StarModelCommands.MovingBone].Translation;
        var (min, max, radius, shift, swing) = Reach(geometries, path, rest, local);

        var described = new List<object>();
        var assets = Path.Combine(output, ".texture-assets");
        Directory.CreateDirectory(assets);
        try
        {
            foreach (var texture in textures)
                await File.WriteAllBytesAsync(Path.Combine(assets, texture.Name + ".dds"), texture.Bytes);
            var xml = BuildYdrXml(name, textures, shaders, geometries, shaderOf, rest, min, max, mask);
            var ydr = XmlYdr.GetYdr(xml, assets);
            if (ydr.Drawable is null) throw new InvalidDataException("Generated sky flyer model has no drawable.");
            var bytes = ydr.Save();
            var file = Path.Combine(output, name + ".ydr");
            await File.WriteAllBytesAsync(file, bytes);
            described.Add(ReopenDrawable(file, bytes, textures, shaders, geometries, shaderOf, mask));
        }
        finally
        {
            Directory.Delete(assets, true);
        }

        {
            var ycd = XmlYcd.GetYcd(BuildYcdXml(name, clip));
            var bytes = ycd.Save();
            var file = Path.Combine(output, clipName + ".ycd");
            await File.WriteAllBytesAsync(file, bytes);
            described.Add(ReopenClip(file, bytes, name, clip, path));
        }

        var last = path.Count - 1;
        return new
        {
            format = "astral.sky-flyer",
            version = 1,
            exportedBy = ExportedBy,
            name,
            clipDictionary = clipName,
            lodDist = request.LodDist,
            bounds = new { min = new[] { min.X, min.Y, min.Z }, max = new[] { max.X, max.Y, max.Z } },
            radius = (float)radius,
            /* «Местное» движение: сколько вершин гнётся, наибольший сдвиг и поворот. */
            local = local is null
                ? null
                : new
                {
                    frames = local.Count,
                    flexVertices = geometries.Sum(geometry => geometry.Weights.Count(weight => weight > 0)),
                    maxShift = (float)shift,
                    maxDegrees = (float)swing,
                },
            clip = new
            {
                frames = clip.Count,
                fps = clip.Rate,
                duration = (float)clip.Duration,
                sequences = clip.SequenceCount,
                sequenceFrameLimit = clip.Limit,
                requestFrames = path.Count,
                /* Стык круга: последний кадр против первого (поворот — с учётом знака). */
                loopGap = new
                {
                    place = (float)Distance(path.X[0], path.Y[0], path.Z[0], path.X[last], path.Y[last], path.Z[last]),
                    degrees = (float)TurnDegrees(path.Turn(0), path.Turn(last)),
                },
            },
            files = described,
        };
    }

    /* ------------------------------------------------------------------ */

    private static string ValidName(string? value, string label)
    {
        var name = value ?? "";
        if (!AssetName.IsMatch(name))
            throw new InvalidDataException($"Sky flyer {label} name must be lowercase letters, digits and underscores.");
        return name;
    }

    /* Шейдер геометрии: пресет игры, лист и множитель свечения. */
    private sealed record Shader(string Name, string File, int Bucket, float Emissive, string Texture)
    {
        public int Mask => 1 << Bucket;
        public bool Glows => Name == "emissive";
    }

    private static Shader ValidateShader(string? name, float? emissive, string texture)
    {
        var preset = name ?? "default";
        if (preset == "default")
        {
            if (emissive is not null) throw new InvalidDataException("Sky flyer emissive applies only to emissive shaders.");
            return new Shader("default", "default.sps", 0, 0f, texture);
        }
        var glow = emissive ?? 1f;
        if (!float.IsFinite(glow) || glow < 0f || glow > MaxEmissive) throw new InvalidDataException("Sky flyer emissive must be 0…64.");
        return preset switch
        {
            "emissive" => new Shader("emissive", "emissive.sps", 0, glow, texture),
            "emissive_alpha" => new Shader("emissive", "emissive_alpha.sps", 1, glow, texture),
            _ => throw new InvalidDataException("Sky flyer shader must be default, emissive or emissive_alpha."),
        };
    }

    private sealed record Texture(string Name, byte[] Bytes, int Width, int Height, int Levels, string Format, string Sha256);

    private static bool IsPowerOfTwo(int value) => value > 0 && (value & (value - 1)) == 0;

    private static async Task<Texture[]> ReadTexturesAsync(TextureRequest[]? sources)
    {
        if (sources is null || sources.Length is 0 or > MaxTextures)
            throw new InvalidDataException($"Sky flyer needs 1…{MaxTextures} textures.");
        var textures = new List<Texture>();
        foreach (var source in sources)
        {
            if (source is null) throw new InvalidDataException("Sky flyer texture entry is empty.");
            var name = ValidName(source.Name, "texture");
            if (textures.Any(texture => texture.Name == name))
                throw new InvalidDataException("Sky flyer texture names must be unique.");
            if (!IsPowerOfTwo(source.Width) || !IsPowerOfTwo(source.Height) || source.Width is < 4 or > 2048 || source.Height is < 4 or > 2048)
                throw new InvalidDataException("Sky flyer texture must be a power of two, 4…2048 px.");
            var file = Path.GetFullPath(source.File ?? "");
            if (!File.Exists(file)) throw new FileNotFoundException("Sky flyer texture was not found.", file);
            var info = new FileInfo(file);
            if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
                throw new InvalidDataException("Sky flyer texture has an unsafe file type or size.");
            var bytes = await File.ReadAllBytesAsync(file);
            var levels = BitConverter.ToInt32(bytes, 28);
            var full = (int)Math.Log2(Math.Max(source.Width, source.Height)) + 1;
            var format = Encoding.ASCII.GetString(bytes, 84, 4);
            if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " ||
                BitConverter.ToInt32(bytes, 12) != source.Height ||
                BitConverter.ToInt32(bytes, 16) != source.Width ||
                levels != full ||
                format is not ("DXT1" or "DXT5"))
                throw new InvalidDataException($"Sky flyer texture {name} is not {source.Width}x{source.Height} DXT1/DXT5 with a full mip chain.");
            var block = format == "DXT1" ? 8 : 16;
            var expected = 128;
            for (var level = 0; level < levels; level++)
            {
                var w = Math.Max(1, source.Width >> level);
                var h = Math.Max(1, source.Height >> level);
                expected += Math.Max(1, (w + 3) / 4) * Math.Max(1, (h + 3) / 4) * block;
            }
            if (bytes.Length != expected) throw new InvalidDataException($"Sky flyer texture {name} is truncated or padded.");
            var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            if (source.Sha256 != "sha256:" + digest)
                throw new InvalidDataException($"Sky flyer texture {name} SHA-256 mismatch.");
            textures.Add(new Texture(name, bytes, source.Width, source.Height, levels, format, digest));
        }
        return textures.ToArray();
    }

    /* `Weights` — доля «Innards» у вершины, 0…255 (0 — вся вершина на барабане). */
    private sealed record Geometry(Shader Shader, Vector3[] Positions, float[] Normals, float[] Uvs, int[] Indices, byte[] Weights)
    {
        public int VertexCount => Positions.Length;
        public bool Flexes => Weights.Any(weight => weight > 0);
    }

    private static Geometry[] ValidateGeometries(GeometryRequest[]? sources, Texture[] textures)
    {
        if (sources is null || sources.Length is 0 or > MaxGeometries)
            throw new InvalidDataException($"Sky flyer needs 1…{MaxGeometries} geometries.");
        var geometries = new List<Geometry>();
        var vertices = 0;
        var indices = 0;
        foreach (var source in sources)
        {
            if (source?.Positions is null || source.Normals is null || source.Uvs is null || source.Indices is null)
                throw new InvalidDataException("Sky flyer geometry is incomplete.");
            var texture = ValidName(source.Texture, "geometry texture");
            if (textures.All(item => item.Name != texture))
                throw new InvalidDataException($"Sky flyer geometry texture {texture} is not in textures.");
            var shader = ValidateShader(source.Shader, source.Emissive, texture);
            var count = source.Positions.Length / 3;
            if (count < 3 || count > MaxGeometryVertices || source.Positions.Length != count * 3 || source.Normals.Length != count * 3 ||
                source.Uvs.Length != count * 2)
                throw new InvalidDataException($"Sky flyer geometry must have 3…{MaxGeometryVertices} vertices with matching normals and uvs.");
            if (source.Indices.Length is 0 or > MaxGeometryIndices || source.Indices.Length % 3 != 0)
                throw new InvalidDataException("Sky flyer geometry indices must be whole triangles.");
            vertices += count;
            indices += source.Indices.Length;
            if (vertices > MaxTotalVertices || indices > MaxTotalIndices)
                throw new InvalidDataException($"Sky flyer model must have at most {MaxTotalVertices} vertices and {MaxTotalIndices} indices.");
            if (!source.Positions.All(value => float.IsFinite(value) && Math.Abs(value) <= MaxExtent))
                throw new InvalidDataException($"Sky flyer model must fit within {MaxExtent} m.");
            if (!source.Normals.All(float.IsFinite) || !source.Uvs.All(value => float.IsFinite(value) && Math.Abs(value) <= MaxUv))
                throw new InvalidDataException("Sky flyer normals or uvs are out of range.");
            if (source.Indices.Any(index => index < 0 || index >= count))
                throw new InvalidDataException("Sky flyer geometry index points outside the geometry.");
            var positions = new Vector3[count];
            for (var index = 0; index < count; index++)
                positions[index] = new Vector3(source.Positions[index * 3], source.Positions[index * 3 + 1], source.Positions[index * 3 + 2]);
            var weights = new byte[count];
            if (source.Flex is not null)
            {
                if (source.Flex.Length != count)
                    throw new InvalidDataException("Sky flyer flex must give one share per vertex.");
                for (var index = 0; index < count; index++)
                {
                    var share = source.Flex[index];
                    if (!float.IsFinite(share) || share < 0f || share > 1f)
                        throw new InvalidDataException("Sky flyer flex share must be 0…1.");
                    weights[index] = (byte)Math.Round(share * 255f, MidpointRounding.AwayFromZero);
                }
            }
            geometries.Add(new Geometry(shader, positions, source.Normals, source.Uvs, source.Indices, weights));
        }
        return geometries.ToArray();
    }

    /* Путь в осях сущности: кадры — место и поворот (единичный, непрерывный по знаку). */
    private sealed record FlightPath(double Duration, double[] X, double[] Y, double[] Z, double[] Qx, double[] Qy, double[] Qz, double[] Qw)
    {
        public int Count => X.Length;
        public (double X, double Y, double Z, double W) Turn(int index) => (Qx[index], Qy[index], Qz[index], Qw[index]);
    }

    private static FlightPath ValidatePath(PathRequest? source)
    {
        if (source?.Frames is null || source.Frames.Length is < MinPathFrames or > MaxPathFrames)
            throw new InvalidDataException($"Sky flyer path must list {MinPathFrames}…{MaxPathFrames} frames.");
        if (!double.IsFinite(source.Duration) || source.Duration < MinDuration || source.Duration > MaxDuration)
            throw new InvalidDataException("Sky flyer path duration must be 1…1800 s.");
        var count = source.Frames.Length;
        var path = new FlightPath(source.Duration, new double[count], new double[count], new double[count],
            new double[count], new double[count], new double[count], new double[count]);
        for (var index = 0; index < count; index++)
        {
            var frame = source.Frames[index];
            if (frame is not { Length: 7 } || !frame.All(double.IsFinite))
                throw new InvalidDataException("Sky flyer path frame must be [x, y, z, qx, qy, qz, qw].");
            if (Math.Abs(frame[0]) > MaxPlanar || Math.Abs(frame[1]) > MaxPlanar || frame[2] < MinHeight || frame[2] > MaxHeight)
                throw new InvalidDataException("Sky flyer path must stay within ±3000 m and −100…2000 m high.");
            var length = Math.Sqrt(frame[3] * frame[3] + frame[4] * frame[4] + frame[5] * frame[5] + frame[6] * frame[6]);
            if (Math.Abs(length - 1) > UnitTolerance)
                throw new InvalidDataException("Sky flyer path rotation must be a unit quaternion.");
            path.X[index] = frame[0];
            path.Y[index] = frame[1];
            path.Z[index] = frame[2];
            path.Qx[index] = frame[3] / length;
            path.Qy[index] = frame[4] / length;
            path.Qz[index] = frame[5] / length;
            path.Qw[index] = frame[6] / length;
            /* Игра смешивает соседние кадры по составляющим: соседи с разным
               знаком повели бы поворот через полсферы. Знак не исправляется —
               его держит окно (курс 0…2π: q(2π) = −q(0)). */
            if (index > 0 && Dot(path.Turn(index - 1), path.Turn(index)) < 0)
                throw new InvalidDataException($"Sky flyer path rotation flips sign between frames {index - 1} and {index}; send sign-continuous quaternions.");
        }
        return path;
    }

    /* «Местная» поза по кадрам круга: сдвиг f и поворот r в осях модели (v → r·v + f). */
    private sealed record LocalMotion(double[] X, double[] Y, double[] Z, double[] Qx, double[] Qy, double[] Qz, double[] Qw)
    {
        public int Count => X.Length;
        public (double X, double Y, double Z, double W) Turn(int index) => (Qx[index], Qy[index], Qz[index], Qw[index]);
    }

    private static LocalMotion? ValidateLocal(LocalRequest? source)
    {
        if (source is null) return null;
        if (source.Frames is null || source.Frames.Length is < 2 or > MaxLocalFrames)
            throw new InvalidDataException($"Sky flyer local motion must list 2…{MaxLocalFrames} frames.");
        var count = source.Frames.Length;
        var local = new LocalMotion(new double[count], new double[count], new double[count], new double[count], new double[count], new double[count], new double[count]);
        for (var index = 0; index < count; index++)
        {
            var frame = source.Frames[index];
            if (frame is not { Length: 7 } || !frame.All(double.IsFinite))
                throw new InvalidDataException("Sky flyer local frame must be [fx, fy, fz, qx, qy, qz, qw].");
            if (Math.Sqrt(frame[0] * frame[0] + frame[1] * frame[1] + frame[2] * frame[2]) > MaxLocalShift)
                throw new InvalidDataException($"Sky flyer local motion must stay within {MaxLocalShift} m.");
            var length = Math.Sqrt(frame[3] * frame[3] + frame[4] * frame[4] + frame[5] * frame[5] + frame[6] * frame[6]);
            if (Math.Abs(length - 1) > UnitTolerance)
                throw new InvalidDataException("Sky flyer local rotation must be a unit quaternion.");
            local.X[index] = frame[0];
            local.Y[index] = frame[1];
            local.Z[index] = frame[2];
            local.Qx[index] = frame[3] / length;
            local.Qy[index] = frame[4] / length;
            local.Qz[index] = frame[5] / length;
            local.Qw[index] = frame[6] / length;
            /* Как у пути: соседи смешиваются по составляющим — знак держит окно. */
            if (index > 0 && Dot(local.Turn(index - 1), local.Turn(index)) < 0)
                throw new InvalidDataException($"Sky flyer local rotation flips sign between frames {index - 1} and {index}.");
        }
        /* Клип играет кругом: последний кадр — та же поза, что первый. */
        var last = count - 1;
        if (Distance(local.X[0], local.Y[0], local.Z[0], local.X[last], local.Y[last], local.Z[last]) > LocalLoopPlace ||
            TurnDegrees(local.Turn(0), local.Turn(last)) > LocalLoopDegrees)
            throw new InvalidDataException("Sky flyer local motion must end where it starts.");
        return local;
    }

    /* Дорожки одной кости по кадрам клипа: место и поворот. */
    private sealed record Track(float[] X, float[] Y, float[] Z, float[] Qx, float[] Qy, float[] Qz, float[] Qw)
    {
        public static Track Of(int count) => new(new float[count], new float[count], new float[count], new float[count], new float[count], new float[count], new float[count]);
    }

    /* Клип: кадры по штатной частоте, куски по штатным границам. `Inner` — дорожки «Innards» («местное» движение) или `null`. */
    private sealed record Clip(double Duration, int Rate, int Steps, int Limit, int SequenceCount, Track Drum, Track? Inner)
    {
        public int Count => Steps + 1;
        public int Start(int sequence) => sequence * Limit;
        public int Frames(int sequence) => Math.Min(Start(sequence) + Limit, Steps) - Start(sequence) + 1;
    }

    /* Произведение кватернионов (сначала поворачивает `b`, потом `a`) и поворот точки. */
    private static (double X, double Y, double Z, double W) Multiply((double X, double Y, double Z, double W) a, (double X, double Y, double Z, double W) b) => (
        a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
        a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
        a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
        a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z);

    private static (double X, double Y, double Z) Rotate((double X, double Y, double Z, double W) q, (double X, double Y, double Z) v)
    {
        var (x, y, z, _) = Multiply(Multiply(q, (v.X, v.Y, v.Z, 0)), (-q.X, -q.Y, -q.Z, q.W));
        return (x, y, z);
    }

    private static Clip Resample(FlightPath path, LocalMotion? local)
    {
        var rate = ClipRates.First(item => Math.Round(path.Duration * item) <= MaxClipSteps);
        var steps = Math.Max(1, (int)Math.Round(path.Duration * rate));
        var count = steps + 1;
        int limit;
        int sequences;
        if (steps <= LongSequenceLimit)
        {
            limit = 16 * ((count + 15) / 16) - 1;
            sequences = 1;
        }
        else
        {
            limit = LongSequenceLimit;
            sequences = (steps + limit - 1) / limit;
        }
        var drum = Track.Of(count);
        var inner = local is null ? null : Track.Of(count);
        /* Покой «Innards» от покоя барабана: (rest_innards − rest_drum). */
        var restOffset = StarModelCommands.Bones[FlexBone].Translation - StarModelCommands.Bones[StarModelCommands.MovingBone].Translation;
        var offset = ((double)restOffset.X, (double)restOffset.Y, (double)restOffset.Z);
        (double X, double Y, double Z, double W) previous = default;
        var last = path.Count - 1;
        for (var frame = 0; frame < count; frame++)
        {
            var (i, a) = Segment((double)frame * last / steps, last);
            var place = (X: Lerp(path.X[i], path.X[i + 1], a), Y: Lerp(path.Y[i], path.Y[i + 1], a), Z: Lerp(path.Z[i], path.Z[i + 1], a));
            var q = Blend(path.Turn(i), path.Turn(i + 1), a);
            Put(drum, frame, place, q);
            if (local is null || inner is null) continue;
            /* «Местная» поза в момент кадра (кадры движения — равномерно на круг). */
            var (j, b) = Segment((double)frame * (local.Count - 1) / steps, local.Count - 1);
            var shift = (Lerp(local.X[j], local.X[j + 1], b), Lerp(local.Y[j], local.Y[j + 1], b), Lerp(local.Z[j], local.Z[j + 1], b));
            var turn = Blend(local.Turn(j), local.Turn(j + 1), b);
            var turned = Rotate(turn, offset);
            var moved = Rotate(q, (shift.Item1 + turned.X, shift.Item2 + turned.Y, shift.Item3 + turned.Z));
            var whole = Multiply(q, turn);
            if (frame > 0 && Dot(previous, whole) < 0) whole = (-whole.X, -whole.Y, -whole.Z, -whole.W);
            previous = whole;
            Put(inner, frame, (place.X + moved.X, place.Y + moved.Y, place.Z + moved.Z), whole);
        }
        return new Clip(path.Duration, rate, steps, limit, sequences, drum, inner);
    }

    private static void Put(Track track, int frame, (double X, double Y, double Z) place, (double X, double Y, double Z, double W) turn)
    {
        track.X[frame] = (float)place.X;
        track.Y[frame] = (float)place.Y;
        track.Z[frame] = (float)place.Z;
        track.Qx[frame] = (float)turn.X;
        track.Qy[frame] = (float)turn.Y;
        track.Qz[frame] = (float)turn.Z;
        track.Qw[frame] = (float)turn.W;
    }

    private static (int Index, double Alpha) Segment(double position, int last)
    {
        var index = Math.Clamp((int)Math.Floor(position), 0, last - 1);
        return (index, Math.Clamp(position - index, 0, 1));
    }

    private static double Lerp(double from, double to, double alpha) => from + (to - from) * alpha;

    private static (double X, double Y, double Z, double W) Blend((double X, double Y, double Z, double W) from, (double X, double Y, double Z, double W) to, double alpha)
    {
        var x = Lerp(from.X, to.X, alpha);
        var y = Lerp(from.Y, to.Y, alpha);
        var z = Lerp(from.Z, to.Z, alpha);
        var w = Lerp(from.W, to.W, alpha);
        var length = Math.Sqrt(x * x + y * y + z * z + w * w);
        return (x / length, y / length, z / length, w / length);
    }

    private static double Dot((double X, double Y, double Z, double W) a, (double X, double Y, double Z, double W) b) =>
        a.X * b.X + a.Y * b.Y + a.Z * b.Z + a.W * b.W;

    /* Угол между поворотами (q и −q — один поворот): 4·atan2(|a − b|, |a + b|)
       устойчив и у почти равных, и у чуть неединичных кватернионов. */
    private static double TurnDegrees((double X, double Y, double Z, double W) a, (double X, double Y, double Z, double W) b)
    {
        var sign = Dot(a, b) < 0 ? -1 : 1;
        var apart = Math.Sqrt(Square(a.X - sign * b.X) + Square(a.Y - sign * b.Y) + Square(a.Z - sign * b.Z) + Square(a.W - sign * b.W));
        var along = Math.Sqrt(Square(a.X + sign * b.X) + Square(a.Y + sign * b.Y) + Square(a.Z + sign * b.Z) + Square(a.W + sign * b.W));
        return 4 * Math.Atan2(apart, along) * 180 / Math.PI;
    }

    private static double Square(double value) => value * value;

    private static double Distance(double x0, double y0, double z0, double x1, double y1, double z1) =>
        Math.Sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0));

    /*
     * Рамка: место кадров (между кадрами — отрезки внутри той же рамки) плюс
     * радиус модели вокруг оси барабана — так модель не выходит из рамки при
     * любом повороте; плюс модель в покое, пока клип не играет.
     */
    /*
     * У гнущейся вершины запас ещё на «местное» движение: её точка
     * (1 − w)·v + w·(r·v + f) отходит от v не дальше w·(2|v|·sin(θ/2) + |f|),
     * где θ и |f| — наибольшие поворот и сдвиг позы за круг.
     */
    private static (Vector3 Min, Vector3 Max, double Radius, double Shift, double Degrees) Reach(Geometry[] geometries, FlightPath path, Vector3 rest, LocalMotion? local)
    {
        var shift = 0.0;
        var degrees = 0.0;
        if (local is not null)
            for (var index = 0; index < local.Count; index++)
            {
                shift = Math.Max(shift, Math.Sqrt(local.X[index] * local.X[index] + local.Y[index] * local.Y[index] + local.Z[index] * local.Z[index]));
                degrees = Math.Max(degrees, TurnDegrees((0, 0, 0, 1), local.Turn(index)));
            }
        var swing = 2 * Math.Sin(Math.Min(Math.PI, degrees * Math.PI / 180) / 2);
        var radius = 0.0;
        var min = new Vector3(float.MaxValue);
        var max = new Vector3(float.MinValue);
        foreach (var geometry in geometries)
            for (var index = 0; index < geometry.VertexCount; index++)
            {
                var point = geometry.Positions[index];
                var length = (double)point.Length();
                radius = Math.Max(radius, length + geometry.Weights[index] / 255.0 * (length * swing + shift));
                min = Vector3.Min(min, point + rest);
                max = Vector3.Max(max, point + rest);
            }
        var reach = (float)radius + BoundsMargin;
        for (var index = 0; index < path.Count; index++)
        {
            var place = new Vector3((float)path.X[index], (float)path.Y[index], (float)path.Z[index]);
            min = Vector3.Min(min, place - new Vector3(reach));
            max = Vector3.Max(max, place + new Vector3(reach));
        }
        return (min, max, radius, shift, degrees);
    }

    private static string BuildYdrXml(string name, Texture[] textures, List<Shader> shaders, Geometry[] geometries, int[] shaderOf,
        Vector3 rest, Vector3 min, Vector3 max, int mask)
    {
        var centre = (min + max) * 0.5f;
        var radius = Vector3.Distance(centre, max);
        var bones = StarModelCommands.Bones;
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Drawable>\n")
            .Append(" <Name>").Append(name).Append("</Name>\n")
            .Append(Vector3Element(" ", "BoundingSphereCenter", centre))
            .Append(" <BoundingSphereRadius value=\"").Append(F(radius)).Append("\" />\n")
            .Append(Vector3Element(" ", "BoundingBoxMin", min))
            .Append(Vector3Element(" ", "BoundingBoxMax", max))
            .Append(" <LodDistHigh value=\"9998\" />\n <LodDistMed value=\"9998\" />\n")
            .Append(" <LodDistLow value=\"9998\" />\n <LodDistVlow value=\"9998\" />\n")
            .Append(" <FlagsHigh value=\"").Append(mask).Append("\" />\n")
            .Append(" <FlagsMed value=\"0\" />\n <FlagsLow value=\"0\" />\n <FlagsVlow value=\"0\" />\n")
            .Append(" <ShaderGroup>\n  <TextureDictionary>\n");
        foreach (var texture in textures)
            xml.Append("   <Item>\n")
                .Append("    <Name>").Append(texture.Name).Append("</Name>\n")
                .Append("    <Unk32 value=\"128\" />\n    <Usage>DIFFUSE</Usage>\n")
                .Append("    <UsageFlags>").Append(StarModelCommands.UsageFlags(texture.Width, texture.Height)).Append("</UsageFlags>\n")
                .Append("    <ExtraFlags value=\"0\" />\n")
                .Append("    <Width value=\"").Append(texture.Width).Append("\" />\n")
                .Append("    <Height value=\"").Append(texture.Height).Append("\" />\n")
                .Append("    <MipLevels value=\"").Append(texture.Levels).Append("\" />\n")
                .Append("    <Format>D3DFMT_").Append(texture.Format).Append("</Format>\n")
                .Append("    <FileName>").Append(texture.Name).Append(".dds</FileName>\n")
                .Append("   </Item>\n");
        xml.Append("  </TextureDictionary>\n  <Shaders>\n");
        /* Параметры — ровно набор пресета, как у звезды и летающего лого. */
        foreach (var shader in shaders)
            xml.Append("   <Item>\n")
                .Append("    <Name>").Append(shader.Name).Append("</Name>\n    <FileName>").Append(shader.File).Append("</FileName>\n")
                .Append("    <RenderBucket value=\"").Append(shader.Bucket).Append("\" />\n")
                .Append("    <Parameters>\n")
                .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(shader.Texture).Append("</Name></Item>\n")
                .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
                .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append(shader.Glows
                    ? "     <Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"" + F(shader.Emissive) + "\" y=\"0\" z=\"0\" w=\"0\" />\n"
                    : "     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("    </Parameters>\n   </Item>\n");
        xml.Append("  </Shaders>\n </ShaderGroup>\n")
            .Append(" <Skeleton>\n")
            .Append("  <Unknown1C value=\"").Append(StarModelCommands.SkeletonUnknown1C).Append("\" />\n")
            .Append("  <Unknown50 value=\"").Append(StarModelCommands.SkeletonSignature50).Append("\" />\n")
            .Append("  <Unknown54 value=\"").Append(StarModelCommands.SkeletonSignature54).Append("\" />\n")
            .Append("  <Unknown58 value=\"").Append(StarModelCommands.SkeletonSignature58).Append("\" />\n")
            .Append("  <Bones>\n");
        for (var index = 0; index < bones.Length; index++)
        {
            var bone = bones[index];
            xml.Append("   <Item>\n")
                .Append("    <Name>").Append(bone.Name).Append("</Name>\n")
                .Append("    <Tag value=\"").Append(bone.Tag).Append("\" />\n")
                .Append("    <Index value=\"").Append(index).Append("\" />\n")
                .Append("    <ParentIndex value=\"").Append(bone.Parent).Append("\" />\n")
                .Append("    <SiblingIndex value=\"").Append(bone.Sibling).Append("\" />\n")
                .Append("    <Flags>").Append(bone.Flags).Append("</Flags>\n")
                .Append(Vector3Element("    ", "Translation", bone.Translation))
                .Append("    <Rotation x=\"0\" y=\"0\" z=\"0\" w=\"1\" />\n")
                .Append("    <Scale x=\"1\" y=\"1\" z=\"1\" />\n")
                .Append("    <TransformUnk x=\"0\" y=\"4\" z=\"-3\" w=\"0\" />\n")
                .Append("   </Item>\n");
        }
        xml.Append("  </Bones>\n </Skeleton>\n")
            .Append(" <DrawableModelsHigh>\n  <Item>\n")
            .Append("   <RenderMask value=\"255\" />\n")
            .Append("   <Flags value=\"1\" />\n")
            .Append("   <HasSkin value=\"1\" />\n")
            .Append("   <BoneIndex value=\"0\" />\n")
            .Append("   <Unknown1 value=\"").Append(bones.Length).Append("\" />\n")
            .Append("   <Geometries>\n");
        for (var part = 0; part < geometries.Length; part++)
        {
            var geometry = geometries[part];
            xml.Append("    <Item>\n     <ShaderIndex value=\"").Append(shaderOf[part]).Append("\" />\n")
                .Append(Vector4Element("     ", "BoundingBoxMin", min))
                .Append(Vector4Element("     ", "BoundingBoxMax", max))
                .Append("     <BoneIDs>").Append(string.Join(", ", Enumerable.Range(0, bones.Length))).Append("</BoneIDs>\n")
                .Append("     <VertexBuffer>\n      <Flags value=\"0\" />\n")
                .Append("      <Layout type=\"GTAV1\"><Position /><BlendWeights /><BlendIndices /><Normal /><Colour0 /><TexCoord0 /></Layout>\n")
                .Append("      <Data>\n");
            for (var index = 0; index < geometry.VertexCount; index++)
            {
                var point = geometry.Positions[index] + rest;
                var weight = geometry.Weights[index];
                xml.Append("       ").Append(F(point.X)).Append(' ').Append(F(point.Y)).Append(' ').Append(F(point.Z));
                /* Вес целиком на кости барабана (третий из четырёх весов и номеров, как у сушилки);
                   у гнущейся — доля w на «Innards» четвёртым весом и номером. */
                if (weight == 0) xml.Append("   0 0 255 0   0 0 ").Append(StarModelCommands.MovingBone).Append(" 0");
                else
                    xml.Append("   0 0 ").Append(255 - weight).Append(' ').Append(weight)
                        .Append("   0 0 ").Append(StarModelCommands.MovingBone).Append(' ').Append(FlexBone);
                xml.Append("   ").Append(F(geometry.Normals[index * 3])).Append(' ').Append(F(geometry.Normals[index * 3 + 1])).Append(' ').Append(F(geometry.Normals[index * 3 + 2]))
                    .Append("   255 255 0 255   ").Append(F(geometry.Uvs[index * 2])).Append(' ').Append(F(geometry.Uvs[index * 2 + 1])).Append('\n');
            }
            xml.Append("      </Data>\n     </VertexBuffer>\n     <IndexBuffer><Data>");
            for (var index = 0; index < geometry.Indices.Length; index++)
            {
                if (index > 0) xml.Append(index % 24 == 0 ? '\n' : ' ');
                xml.Append(geometry.Indices[index]);
            }
            xml.Append("</Data></IndexBuffer>\n    </Item>\n");
        }
        xml.Append("   </Geometries>\n  </Item>\n </DrawableModelsHigh>\n</Drawable>\n");
        return xml.ToString();
    }

    /*
     * Клип — восемь дорожек сушилки в её порядке и с её подписью; движется
     * только барабан. Каждый кусок — свои каналы: постоянная составляющая —
     * StaticFloat, меняющаяся — QuantizeFloat со своим началом и шагом.
     */
    private static string BuildYcdXml(string name, Clip clip)
    {
        var bones = StarModelCommands.Bones;
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ClipDictionary>\n <Clips>\n  <Item>\n")
            .Append("   <Hash>").Append(name).Append("</Hash>\n")
            .Append("   <Name>pack:/").Append(name).Append(".clip</Name>\n")
            .Append("   <Type value=\"Animation\" />\n   <Unknown30 value=\"1\" />\n   <Tags />\n")
            .Append("   <Properties>\n    <Item>\n     <NameHash>hash_BF6A5D60</NameHash>\n     <UnkHash>hash_996C3B27</UnkHash>\n")
            .Append("     <Attributes>\n      <Item>\n       <NameHash>hash_BF6A5D60</NameHash>\n       <Type value=\"Int\" />\n       <Value value=\"32\" />\n")
            .Append("      </Item>\n     </Attributes>\n    </Item>\n   </Properties>\n")
            .Append("   <AnimationHash>").Append(name).Append("</AnimationHash>\n")
            .Append("   <StartTime value=\"0\" />\n")
            .Append("   <EndTime value=\"").Append(R((float)clip.Duration)).Append("\" />\n")
            .Append("   <Rate value=\"1\" />\n  </Item>\n </Clips>\n <Animations>\n  <Item>\n")
            .Append("   <Hash>").Append(name).Append("</Hash>\n")
            .Append("   <Unknown10 value=\"1\" />\n")
            .Append("   <FrameCount value=\"").Append(clip.Count).Append("\" />\n")
            .Append("   <SequenceFrameLimit value=\"").Append(clip.Limit).Append("\" />\n")
            .Append("   <Duration value=\"").Append(R((float)clip.Duration)).Append("\" />\n")
            .Append("   <Unknown1C>").Append(StarModelCommands.AnimationSignature).Append("</Unknown1C>\n")
            .Append("   <BoneIds>\n");
        foreach (var track in new[] { 0, 1 })
            for (var index = 0; index < bones.Length; index++)
                xml.Append("    <Item>\n     <BoneId value=\"").Append(bones[index].Tag).Append("\" />\n")
                    .Append("     <Track value=\"").Append(track).Append("\" />\n")
                    .Append("     <Unk0 value=\"").Append(track).Append("\" />\n    </Item>\n");
        xml.Append("   </BoneIds>\n   <Sequences>\n");
        for (var sequence = 0; sequence < clip.SequenceCount; sequence++)
        {
            var data = SequenceData(clip, sequence);
            /* Подпись куска: у игры одинаковые данные — одинаковая подпись. */
            var signature = JenkHash.GenHash(Encoding.UTF8.GetBytes(data));
            if (signature == 0) signature = 1;
            xml.Append("    <Item>\n     <Hash>hash_").Append(signature.ToString("X8", CultureInfo.InvariantCulture)).Append("</Hash>\n")
                .Append("     <FrameCount value=\"").Append(clip.Frames(sequence)).Append("\" />\n     <SequenceData>\n")
                .Append(data)
                .Append("     </SequenceData>\n    </Item>\n");
        }
        xml.Append("   </Sequences>\n  </Item>\n </Animations>\n</ClipDictionary>\n");
        return xml.ToString();
    }

    private static string SequenceData(Clip clip, int sequence)
    {
        var bones = StarModelCommands.Bones;
        var start = clip.Start(sequence);
        var frames = clip.Frames(sequence);
        float[] Slice(float[] values) => values.AsSpan(start, frames).ToArray();
        var xml = new StringBuilder();
        /* Дорожки кости: у барабана — полёт, у «Innards» — полёт с «местным» движением (если оно есть). */
        Track? TrackOf(int index) => index == StarModelCommands.MovingBone ? clip.Drum : index == FlexBone ? clip.Inner : null;
        /* Места костей: у барабана — место кадра. */
        for (var index = 0; index < bones.Length; index++)
        {
            xml.Append("      <Item>\n       <Channels>\n");
            var track = TrackOf(index);
            var axes = track is null ? null : new[] { Slice(track.X), Slice(track.Y), Slice(track.Z) };
            if (axes is not null && axes.Any(values => Spread(values) >= StaticPlace))
                foreach (var values in axes)
                    xml.Append(Spread(values) < StaticPlace ? StaticFloat(values[0]) : Quantized(values, PlaceStep, MaxPlaceBits));
            else
            {
                var place = axes is null ? bones[index].Translation : new Vector3(axes[0][0], axes[1][0], axes[2][0]);
                xml.Append("        <Item>\n         <Type value=\"StaticVector3\" />\n")
                    .Append("         <Value x=\"").Append(R(place.X)).Append("\" y=\"").Append(R(place.Y)).Append("\" z=\"").Append(R(place.Z)).Append("\" />\n")
                    .Append("        </Item>\n");
            }
            xml.Append("       </Channels>\n      </Item>\n");
        }
        /* Повороты: у барабана — четыре составляющие и метка CachedQuaternion2. */
        for (var index = 0; index < bones.Length; index++)
        {
            xml.Append("      <Item>\n       <Channels>\n");
            var track = TrackOf(index);
            var parts = track is null ? null : new[] { Slice(track.Qx), Slice(track.Qy), Slice(track.Qz), Slice(track.Qw) };
            if (parts is not null && parts.Any(values => Spread(values) >= StaticTurn))
            {
                foreach (var values in parts)
                    xml.Append(Spread(values) < StaticTurn ? StaticFloat(values[0]) : Quantized(values, TurnStep, MaxTurnBits));
                xml.Append("        <Item>\n         <Type value=\"CachedQuaternion2\" />\n         <QuatIndex value=\"0\" />\n        </Item>\n");
            }
            else
            {
                /* Постоянный поворот: игра хранит x, y, z и восстанавливает w ≥ 0. */
                var (x, y, z, w) = parts is null ? (0f, 0f, 0f, 1f) : (parts[0][0], parts[1][0], parts[2][0], parts[3][0]);
                if (w < 0) (x, y, z, w) = (-x, -y, -z, -w);
                xml.Append("        <Item>\n         <Type value=\"StaticQuaternion\" />\n")
                    .Append("         <Value x=\"").Append(R(x)).Append("\" y=\"").Append(R(y)).Append("\" z=\"").Append(R(z)).Append("\" w=\"").Append(R(w)).Append("\" />\n")
                    .Append("        </Item>\n");
            }
            xml.Append("       </Channels>\n      </Item>\n");
        }
        return xml.ToString();
    }

    private static float Spread(float[] values) => values.Max() - values.Min();

    private static string StaticFloat(float value) =>
        "        <Item>\n         <Type value=\"StaticFloat\" />\n         <Value value=\"" + R(value) + "\" />\n        </Item>\n";

    /* Квантованный ряд: начало — наименьшее, шаг — размах на 2^бит − 1. */
    private static string Quantized(float[] values, double step, int maxBits)
    {
        var low = values.Min();
        var range = (double)values.Max() - low;
        var bits = Math.Clamp((int)Math.Ceiling(Math.Log2(range / step + 1)), MinBits, maxBits);
        var quantum = (float)(range / ((1 << bits) - 1));
        var sb = new StringBuilder("        <Item>\n         <Type value=\"QuantizeFloat\" />\n")
            .Append("         <Quantum value=\"").Append(R(quantum)).Append("\" />\n")
            .Append("         <Offset value=\"").Append(R(low)).Append("\" />\n")
            .Append("         <Values>\n");
        for (var index = 0; index < values.Length; index += 10)
            sb.Append("          ").Append(string.Join(' ', values.Skip(index).Take(10).Select(R))).Append('\n');
        return sb.Append("         </Values>\n        </Item>\n").ToString();
    }

    private static object ReopenDrawable(string path, byte[] bytes, Texture[] textures, List<Shader> wanted, Geometry[] geometries, int[] shaderOf, int mask)
    {
        var ydr = new YdrFile { Name = Path.GetFileName(path) };
        ydr.Load(bytes);
        var drawable = ydr.Drawable;
        var shaders = drawable?.ShaderGroup?.Shaders?.data_items;
        var sheets = drawable?.ShaderGroup?.TextureDictionary?.Textures?.data_items;
        var models = drawable?.DrawableModels?.High ?? [];
        var parts = models.SelectMany(model => model.Geometries ?? []).ToArray();
        var bones = drawable?.Skeleton?.Bones?.Items;
        if (!ydr.Loaded || drawable is null || shaders is null || shaders.Length != wanted.Count || drawable.FlagsHigh != mask ||
            sheets is null || sheets.Length != textures.Length || models.Length != 1 || models[0].HasSkin != 1 || parts.Length != geometries.Length)
            throw new InvalidDataException("Compiled sky flyer model failed semantic reopen.");
        for (var index = 0; index < wanted.Count; index++)
            if (shaders[index].Name.Hash != JenkHash.GenHash(wanted[index].Name) || shaders[index].FileName.Hash != JenkHash.GenHash(wanted[index].File) ||
                shaders[index].RenderBucket != wanted[index].Bucket)
                throw new InvalidDataException("Compiled sky flyer shader failed semantic reopen.");
        foreach (var texture in textures)
        {
            var sheet = sheets.FirstOrDefault(item => item?.Name == texture.Name);
            if (sheet is null || sheet.Width != texture.Width || sheet.Height != texture.Height || sheet.Levels != texture.Levels ||
                sheet.Format.ToString() != "D3DFMT_" + texture.Format)
                throw new InvalidDataException($"Compiled sky flyer texture {texture.Name} failed semantic reopen.");
        }
        for (var index = 0; index < geometries.Length; index++)
            if (parts[index].VerticesCount != geometries[index].VertexCount || parts[index].IndicesCount != geometries[index].Indices.Length ||
                parts[index].ShaderID != shaderOf[index])
                throw new InvalidDataException("Compiled sky flyer geometry failed semantic reopen.");
        /* Веса скиннинга дошли до вершин: барабан — (255 − w), «Innards» — w. */
        for (var index = 0; index < geometries.Length; index++)
        {
            var data = parts[index].VertexData ?? throw new InvalidDataException("Compiled sky flyer geometry has no vertex data.");
            for (var vertex = 0; vertex < geometries[index].VertexCount; vertex++)
            {
                var weight = geometries[index].Weights[vertex];
                var weights = data.GetColour(vertex, (int)VertexSemantics.BlendWeights);
                var slots = data.GetColour(vertex, (int)VertexSemantics.BlendIndices);
                if (weights.R != 0 || weights.G != 0 || weights.B != 255 - weight || weights.A != weight ||
                    slots.B != StarModelCommands.MovingBone || slots.A != (weight > 0 ? FlexBone : 0))
                    throw new InvalidDataException("Compiled sky flyer skin weights failed semantic reopen.");
            }
        }
        if (bones is not { Length: 4 } || !bones.Select(bone => bone.Tag).SequenceEqual(StarModelCommands.Bones.Select(bone => bone.Tag)) ||
            drawable.Skeleton!.Unknown_50h.Hash != StarModelCommands.SkeletonSignature50)
            throw new InvalidDataException("Compiled sky flyer skeleton failed semantic reopen.");
        return Describe(path, bytes, new
        {
            semanticReopen = true,
            shaders = shaders.Length,
            flagsHigh = (int)drawable.FlagsHigh,
            geometries = parts.Length,
            vertices = geometries.Sum(geometry => geometry.VertexCount),
            triangles = geometries.Sum(geometry => geometry.Indices.Length / 3),
            skeleton = bones.Length,
            textures = textures.Select(texture => new
            {
                name = texture.Name,
                format = texture.Format,
                width = texture.Width,
                height = texture.Height,
                mipLevels = texture.Levels,
                sha256 = texture.Sha256,
            }).ToArray(),
        });
    }

    /*
     * Клип открывается заново и считается так, как его играет игра: кадр —
     * время на длительность, кусок — кадр на SequenceFrameLimit, между
     * соседними кадрами — смесь каналов (поворот затем нормируется). Сверка —
     * на каждом кадре клипа (квантование) и в моменты кадров запроса (путь).
     */
    private static object ReopenClip(string path, byte[] bytes, string name, Clip clip, FlightPath request)
    {
        var ycd = new YcdFile { Name = Path.GetFileName(path) };
        RpfFile.LoadResourceFile(ycd, bytes, 46);
        var hash = JenkHash.GenHash(name);
        var clips = ycd.ClipMapEntries ?? [];
        var animations = (ycd.AnimMapEntries ?? []).Select(entry => entry?.Animation).Where(item => item is not null).ToArray();
        if (clips.Length != 1 || clips[0].Hash.Hash != hash || clips[0].Clip is not ClipAnimation single || single.Animation is null ||
            animations.Length != 1)
            throw new InvalidDataException("Compiled sky flyer clip failed semantic reopen.");
        var animation = animations[0]!;
        if (animation.Frames != clip.Count || animation.SequenceFrameLimit != clip.Limit ||
            Math.Abs(animation.Duration - clip.Duration) > 1e-3 || Math.Abs(single.EndTime - clip.Duration) > 1e-3 ||
            animation.Sequences?.data_items?.Length != clip.SequenceCount ||
            animation.BoneIds?.data_items?.Length != StarModelCommands.Bones.Length * 2 ||
            animation.Unknown_1Ch.Hash != XmlMeta.GetHash(StarModelCommands.AnimationSignature).Hash)
            throw new InvalidDataException("Compiled sky flyer animation failed semantic reopen.");
        var drum = StarModelCommands.Bones[StarModelCommands.MovingBone].Tag;
        var placeTrack = animation.FindBoneIndex(drum, 0);
        var turnTrack = animation.FindBoneIndex(drum, 1);
        if (placeTrack < 0 || turnTrack < 0) throw new InvalidDataException("Compiled sky flyer clip has no drum tracks.");

        /* «Innards»: с «местным» движением — свои дорожки, без него — покой. */
        var flexTag = StarModelCommands.Bones[FlexBone].Tag;
        var flexPlaceTrack = animation.FindBoneIndex(flexTag, 0);
        var flexTurnTrack = animation.FindBoneIndex(flexTag, 1);
        if (flexPlaceTrack < 0 || flexTurnTrack < 0) throw new InvalidDataException("Compiled sky flyer clip has no Innards tracks.");

        var placeError = 0.0;
        var turnError = 0.0;
        var turnDegrees = 0.0;
        var samples = 0;
        void Check(double time, double x, double y, double z, (double X, double Y, double Z, double W) turn) => CheckTrack(placeTrack, turnTrack, time, x, y, z, turn);
        void CheckTrack(int placeIndex, int turnIndex, double time, double x, double y, double z, (double X, double Y, double Z, double W) turn)
        {
            var (place, actual) = Sample(animation, placeIndex, turnIndex, time);
            placeError = Math.Max(placeError, Distance(place.X, place.Y, place.Z, x, y, z));
            var straight = Math.Max(Math.Max(Math.Abs(actual.X - turn.X), Math.Abs(actual.Y - turn.Y)), Math.Max(Math.Abs(actual.Z - turn.Z), Math.Abs(actual.W - turn.W)));
            var flipped = Math.Max(Math.Max(Math.Abs(actual.X + turn.X), Math.Abs(actual.Y + turn.Y)), Math.Max(Math.Abs(actual.Z + turn.Z), Math.Abs(actual.W + turn.W)));
            turnError = Math.Max(turnError, Math.Min(straight, flipped));
            turnDegrees = Math.Max(turnDegrees, TurnDegrees(actual, turn));
            samples++;
        }
        var drumTrack = clip.Drum;
        for (var frame = 0; frame < clip.Count; frame++)
            Check(clip.Duration * frame / clip.Steps, drumTrack.X[frame], drumTrack.Y[frame], drumTrack.Z[frame], (drumTrack.Qx[frame], drumTrack.Qy[frame], drumTrack.Qz[frame], drumTrack.Qw[frame]));
        var rest = StarModelCommands.Bones[FlexBone].Translation;
        for (var frame = 0; frame < clip.Count; frame++)
        {
            var time = clip.Duration * frame / clip.Steps;
            if (clip.Inner is { } inner)
                CheckTrack(flexPlaceTrack, flexTurnTrack, time, inner.X[frame], inner.Y[frame], inner.Z[frame], (inner.Qx[frame], inner.Qy[frame], inner.Qz[frame], inner.Qw[frame]));
            else if (frame == 0)
                CheckTrack(flexPlaceTrack, flexTurnTrack, time, rest.X, rest.Y, rest.Z, (0, 0, 0, 1));
        }
        for (var frame = 0; frame < request.Count; frame++)
            Check(request.Duration * frame / (request.Count - 1), request.X[frame], request.Y[frame], request.Z[frame], request.Turn(frame));
        if (!(placeError <= PlaceTolerance) || !(turnError <= TurnTolerance))
            throw new InvalidDataException(FormattableString.Invariant(
                $"Compiled sky flyer clip drifts from the path: {placeError:0.###} m, rotation {turnError:0.#####}."));
        return Describe(path, bytes, new
        {
            semanticReopen = true,
            frames = (int)animation.Frames,
            duration = animation.Duration,
            sequences = animation.Sequences!.data_items!.Length,
            sequenceFrameLimit = (int)animation.SequenceFrameLimit,
            samples,
            maxPlaceError = (float)placeError,
            maxRotationError = (float)turnError,
            maxRotationDegrees = (float)turnDegrees,
        });
    }

    private static ((double X, double Y, double Z) Place, (double X, double Y, double Z, double W) Turn) Sample(Animation animation, int placeTrack, int turnTrack, double time)
    {
        var position = time / animation.Duration * (animation.Frames - 1);
        var (frame, alpha) = Segment(position, animation.Frames - 1);
        var sequences = animation.Sequences.data_items;
        var block = Math.Min(frame / animation.SequenceFrameLimit, sequences.Length - 1);
        var local = frame - block * animation.SequenceFrameLimit;
        var tracks = sequences[block].Sequences;
        var p0 = tracks[placeTrack].EvaluateVector(local);
        var p1 = tracks[placeTrack].EvaluateVector(local + 1);
        var q0 = tracks[turnTrack].EvaluateVector(local);
        var q1 = tracks[turnTrack].EvaluateVector(local + 1);
        var place = (Lerp(p0.X, p1.X, alpha), Lerp(p0.Y, p1.Y, alpha), Lerp(p0.Z, p1.Z, alpha));
        var turn = Blend((q0.X, q0.Y, q0.Z, q0.W), (q1.X, q1.Y, q1.Z, q1.W), alpha);
        return (place, turn);
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private static string F(float value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    /* Клип — без округления: начало и шаг квантования должны дойти точно. */
    private static string R(float value) => value.ToString(CultureInfo.InvariantCulture);
    private static string Vector3Element(string indent, string name, Vector3 value) =>
        $"{indent}<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" />\n";
    private static string Vector4Element(string indent, string name, Vector3 value) =>
        $"{indent}<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" w=\"0\" />\n";

    private sealed record CompileRequest(
        string Format,
        int Version,
        string? Name = null,
        string? ClipDictionary = null,
        float LodDist = 0,
        TextureRequest[]? Textures = null,
        GeometryRequest[]? Geometries = null,
        PathRequest? Path = null);

    private sealed record TextureRequest(string? Name, string? File, string? Sha256, int Width = 0, int Height = 0);

    private sealed record GeometryRequest(string? Shader, string? Texture, float? Emissive, float[]? Positions, float[]? Normals, float[]? Uvs, int[]? Indices, float[]? Flex = null);

    private sealed record PathRequest(double Duration, double[][]? Frames, LocalRequest? Local = null);

    private sealed record LocalRequest(double[][]? Frames);
}
