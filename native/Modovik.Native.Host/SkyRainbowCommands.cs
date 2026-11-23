using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Радуга над Лос-Сантосом — своя модель Astral, а не данные Rockstar.
///
/// Своей радуги у GTA V нет, и собрать её из неба нельзя: у облачных шапок
/// цвет не из листа, а из света набора, а звёздный лист повторяется по куполу
/// двенадцать раз. Поэтому радуга — объект мира: одна дуга на 42° в
/// вертикальной плоскости в трёх километрах к востоку от центра города, над
/// холмами. Одна и в одном месте — по слову владельца (26.09.2026): прежние
/// утренняя дуга над морем и вечерняя над холмами, да ещё побочная дуга над
/// главной, читались как «две радуги».
///
/// Всё, что уходит в игру, повторяет ванильные образцы, найденные в архивах
/// самой игры: шейдер `emissive_additive_alpha` (корзина 1, параметры
/// `DiffuseSampler`, `matMaterialColorScale`, `useTessellation`,
/// `emissiveMultiplier` — как у `v_16_barglow.ydr`), вершины
/// Position/Normal/Colour0/TexCoord0 с шагом 36 байт, объект по часам —
/// `CTimeArchetypeDef` с битом 24, как у ночных окон центра. Связь ymap с его
/// ytyp — `_manifest.ymf`, без него расстановка не грузится.
///
/// Маска корзин модели (`FlagsHigh`) — ровно биты корзин её шейдеров: так у
/// всех 169 моделей ванильного `v_int_16.rpf` без исключений. Первая радуга
/// объявляла непрозрачную корзину (1) при прозрачном шейдере, и игра рисовала
/// от неё обрывки — «видно только кусок и только под углом» (26.09.2026).
///
/// Излучение модели постоянно, а небо от полудня к полуночи темнеет на
/// девять с половиной стопов: дуга с дневной яркостью ночью сияла с ореолом
/// (27.09.2026). Поэтому дуга одна, а моделей у неё несколько — ступени
/// яркости по часам (`packages/timecycle/rainbow-light.js`): каждая видна в
/// свои часы, все стоят в одном месте, и в каждый час радуга — та же доля
/// неба игрока, что и в полдень. Так же Rockstar разводит день и ночь у фар
/// машин (`visualsettings.dat`).
///
/// Команда детерминирована: одинаковый запрос даёт те же байты, а значит — тот
/// же пакет в движке установки.
/// </summary>
internal static class SkyRainbowCommands
{
    private const string RequestFormat = "astral.compile-sky-rainbow";
    private const int RequestVersion = 4;
    private const string TextureName = "astral_rainbow";
    private const string DictionaryName = "astral_rainbow";
    private const string TypesName = "astral_rainbow";
    /* Модель ступени — `astral_rainbow_<n>`, n = 1…MaxTiers, ярчайшая первой.
       Те же имена ждёт траст пакета (`sky-rainbow-manifest-trust.js`). */
    private const string ModelPrefix = "astral_rainbow_";
    private const int MaxTiers = 5;
    private const string MapName = "astral_rainbow_map";
    private const float LodDistance = 9000f;
    /* Яркость в полдень ясного дня — ниже ванильных вывесок (экраны Вайнвуда —
       4, лампы интерьеров — до 16): радуга прибавляет свет к дневному небу, и
       при 6 дуга на ярком небе уходила в белое. Дневная ступень в среднем на
       полстопа темнее полудня — при 3.5 она светит как прежние 2.5: полоса
       заметна и остаётся цветной. `brightness` ступени — доля от этого числа:
       ползунок человека, умноженный на свет её часов. Те же 3.5 — у кадра
       (`RAINBOW_EMISSIVE` в `packages/timecycle/rainbow.js`). */
    private const float BaseEmissiveMultiplier = 3.5f;
    /* Ползунок 0.25…3 и ночной пол в 256 раз ниже полудня. */
    private const float MinBrightness = 0.25f / 256f;
    private const float MaxBrightness = 3f;

    /* Прозрачная корзина: шейдер рисуется поверх уже собранного кадра и
       прибавляет свет. Маска корзин модели выводится отсюда, а не пишется
       числом — иначе они снова разойдутся. */
    private const int RenderBucket = 1;
    private const int BucketMask = 1 << RenderBucket;

    private const int TextureWidth = 64;
    private const int TextureHeight = 128;
    private const int ArcSegments = 96;

    /* Точка, откуда радугу строят: центр Лос-Сантоса на уровне глаз. Место —
       то же, что у кадра редактора (`RAINBOW_PLACEMENT` в
       `packages/timecycle/rainbow.js`): восток-северо-восток, над холмами. */
    private static readonly Vector3 Viewpoint = new(-150f, -850f, 40f);
    private static readonly Vector2 Direction = new(0.97f, 0.25f);
    private const float Distance = 3000f;
    /* Антисолнечная точка на 17° под горизонтом — солнце, при котором радуга
       и бывает. Отсюда высота дуги: 42° − 17° = 25° над горизонтом. */
    private const float AntisolarDepressionDegrees = 17f;
    private const float RadiusDegrees = 42f;
    private const float WidthDegrees = 2.2f;

    private sealed record Tier(string Asset, int[] Hours, float Brightness);

    /// <summary>
    /// Ступени запроса: от одной до пяти, у каждой свои часы 0…23 (ни один
    /// час не у двух ступеней сразу — иначе в этот час стояли бы две радуги) и
    /// яркость в пределах. Невидимую радугу не собирают.
    /// </summary>
    private static Tier[] ResolveTiers(CompileRequest request)
    {
        var tiers = request.Tiers
            ?? throw new InvalidDataException("Rainbow compile request must name its tiers.");
        if (tiers.Length is 0 or > MaxTiers)
            throw new InvalidDataException($"A rainbow has 1…{MaxTiers} tiers.");
        var taken = new HashSet<int>();
        var resolved = new Tier[tiers.Length];
        for (var index = 0; index < tiers.Length; index++)
        {
            var hours = tiers[index].Hours
                ?? throw new InvalidDataException("Every rainbow tier must name its hours.");
            if (hours.Length is 0 or > 24 || hours.Any(hour => hour is < 0 or > 23))
                throw new InvalidDataException("Rainbow hours must be 0…23.");
            var sorted = hours.Distinct().OrderBy(hour => hour).ToArray();
            if (sorted.Any(hour => !taken.Add(hour)))
                throw new InvalidDataException("Two rainbow tiers cannot share an hour.");
            var brightness = tiers[index].Brightness;
            if (!float.IsFinite(brightness) || brightness < MinBrightness * 0.999f || brightness > MaxBrightness)
                throw new InvalidDataException($"Rainbow brightness must be {MinBrightness}…{MaxBrightness}.");
            resolved[index] = new Tier(ModelPrefix + (index + 1).ToString(CultureInfo.InvariantCulture), sorted, brightness);
        }
        return resolved;
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 6,
    };

    public static async Task<object> CompileAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > 4096)
            throw new InvalidDataException("Rainbow compile request must be between 1 byte and 4 KiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Rainbow compile request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Rainbow compile request has an unknown format.");
        var tiers = ResolveTiers(request);

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Rainbow output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Rainbow output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Rainbow output directory must be empty.");

        /* Лист спектра. */
        var ytdPath = Path.Combine(output, DictionaryName + ".ytd");
        var assets = Path.Combine(output, ".texture-assets");
        Directory.CreateDirectory(assets);
        try
        {
            await File.WriteAllBytesAsync(Path.Combine(assets, TextureName + ".dds"), BuildSpectrumDds());
            var ytd = XmlYtd.GetYtd(BuildYtdXml(), assets);
            if (ytd.TextureDict is null) throw new InvalidDataException("Generated rainbow YTD has no dictionary.");
            await File.WriteAllBytesAsync(ytdPath, ytd.Save());
        }
        finally
        {
            Directory.Delete(assets, true);
        }

        /* Дуга — модель с разворотом, запечённым в вершины: у объекта остаётся
           нулевой поворот, как у проверенного оверлея. Одна геометрия на все
           ступени: они отличаются только излучением. */
        var geometry = BuildArc();
        var ydrPaths = new List<string>();
        foreach (var tier in tiers)
        {
            var ydrPath = Path.Combine(output, tier.Asset + ".ydr");
            var ydr = XmlYdr.GetYdr(BuildYdrXml(tier.Asset, geometry, BaseEmissiveMultiplier * tier.Brightness), output);
            if (ydr.Drawable is null) throw new InvalidDataException("Generated rainbow YDR has no drawable.");
            await File.WriteAllBytesAsync(ydrPath, ydr.Save());
            ydrPaths.Add(ydrPath);
        }

        var ytyp = new YtypFile
        {
            Name = TypesName + ".ytyp",
            NameHash = JenkHash.GenHash(TypesName),
            CMapTypes = new CMapTypes(),
        };
        var archetypes = new List<Archetype>();
        var entities = new List<YmapEntityDef>();
        foreach (var tier in tiers)
        {
            var assetHash = new MetaHash(JenkHash.GenHash(tier.Asset));
            var definition = new CTimeArchetypeDef
            {
                _BaseArchetypeDef = new CBaseArchetypeDef
                {
                    lodDist = LodDistance,
                    flags = 0,
                    specialAttribute = 0,
                    bbMin = geometry.Min,
                    bbMax = geometry.Max,
                    bsCentre = geometry.Centre,
                    bsRadius = geometry.Radius,
                    hdTextureDist = LodDistance,
                    name = assetHash,
                    textureDictionary = new MetaHash(JenkHash.GenHash(DictionaryName)),
                    assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
                    assetName = assetHash,
                },
                _TimeArchetypeDef = new CTimeArchetypeDefData { timeFlags = TimeFlags(tier.Hours) },
            };
            var archetype = new TimeArchetype();
            archetype.Init(ytyp, ref definition);
            archetypes.Add(archetype);

            var entityDefinition = new CEntityDef
            {
                archetypeName = assetHash,
                /* Тени радуга не отбрасывает (бит 22). */
                flags = 0x400000,
                guid = JenkHash.GenHash("astral:" + tier.Asset),
                position = geometry.Origin,
                rotation = new Vector4(0, 0, 0, 1),
                scaleXY = 1,
                scaleZ = 1,
                parentIndex = -1,
                lodDist = LodDistance,
                childLodDist = 0,
                lodLevel = rage__eLodType.LODTYPES_DEPTH_ORPHANHD,
                numChildren = 0,
                priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
                ambientOcclusionMultiplier = 255,
                artificialAmbientOcclusion = 255,
                tintValue = 0,
            };
            var entity = new YmapEntityDef(null, entities.Count, ref entityDefinition);
            entity.SetOrientation(Quaternion.Identity);
            entity.SetArchetype(archetype);
            entities.Add(entity);
        }
        ytyp.AllArchetypes = archetypes.ToArray();
        var ytypPath = Path.Combine(output, TypesName + ".ytyp");
        await File.WriteAllBytesAsync(ytypPath, ytyp.Save());

        var ymap = new YmapFile
        {
            Name = MapName + ".ymap",
            CMapData = new CMapData
            {
                name = new MetaHash(JenkHash.GenHash(MapName)),
                parent = new MetaHash(0),
            },
            AllEntities = entities.ToArray(),
            BlockExportedBy = "Astral Sky Rainbow Compiler 3",
            BlockTime = "01 January 1970 00:00",
        };
        ymap.CalcFlags();
        ymap.CalcExtents();
        var ymapPath = Path.Combine(output, MapName + ".ymap");
        await File.WriteAllBytesAsync(ymapPath, ymap.Save());

        var manifestPath = Path.Combine(output, "_manifest.ymf");
        await File.WriteAllBytesAsync(manifestPath, BuildManifest());

        var files = await ReopenAndDescribeAsync(tiers, ydrPaths, ytdPath, ytypPath, ymapPath, manifestPath);
        return new
        {
            format = "astral.sky-rainbow-artifacts",
            version = 3,
            tiers = tiers.Select(tier => new { asset = tier.Asset, hours = tier.Hours, brightness = tier.Brightness }).ToArray(),
            files,
        };
    }

    /* Часы видимости — биты 0…23; бит 24 разрешает объекту исчезнуть, пока на
       него смотрят (так у ванильных ночных окон): иначе радуга висела бы до
       тех пор, пока камера не отвернётся. */
    private static uint TimeFlags(IEnumerable<int> hours)
    {
        uint flags = 1u << 24;
        foreach (var hour in hours) flags |= 1u << hour;
        return flags;
    }

    private sealed record Geometry(
        Vector3 Origin,
        Vector3 Min,
        Vector3 Max,
        Vector3 Centre,
        float Radius,
        Vector3 Normal,
        Vector3[] Positions,
        Vector2[] Uvs,
        int[] Indices);

    /*
     * Дуга строится в вертикальной плоскости поперёк взгляда из центра города.
     * Центр окружности — антисолнечная точка на 17° под горизонтом, радиус —
     * угловой радиус радуги. Низ дуги уходит под землю: концы прячут холмы,
     * как у настоящей радуги.
     */
    private static Geometry BuildArc()
    {
        var direction = Vector2.Normalize(Direction);
        var origin = new Vector3(Viewpoint.X + direction.X * Distance, Viewpoint.Y + direction.Y * Distance, Viewpoint.Z);
        var right = new Vector3(direction.Y, -direction.X, 0f);
        var normal = new Vector3(-direction.X, -direction.Y, 0f);
        var depth = Distance * MathF.Tan(Radians(AntisolarDepressionDegrees));
        var centre = new Vector3(0f, 0f, -depth);

        /* Радиус в плоскости: верх дуги на (радиус − 17°) над горизонтом. */
        var top = Distance * MathF.Tan(Radians(RadiusDegrees - AntisolarDepressionDegrees));
        var radius = top + depth;
        var halfWidth = Distance * MathF.Tan(Radians(WidthDegrees)) * 0.5f;
        /* Дуга доходит до земли и на полсотни метров под неё. */
        var limit = MathF.Asin(Math.Clamp((depth - 50f) / (radius + halfWidth), -1f, 1f));
        var positions = new List<Vector3>();
        var uvs = new List<Vector2>();
        for (var step = 0; step <= ArcSegments; step++)
        {
            var t = step / (float)ArcSegments;
            var angle = limit + (MathF.PI - 2f * limit) * t;
            var along = new Vector3(MathF.Cos(angle), 0f, MathF.Sin(angle));
            foreach (var (edge, v) in new[] { (radius - halfWidth, 0f), (radius + halfWidth, 1f) })
            {
                var local = centre + along * edge;
                positions.Add(right * local.X + new Vector3(0f, 0f, local.Z));
                uvs.Add(new Vector2(t, v));
            }
        }
        var indices = new List<int>();
        for (var step = 0; step < ArcSegments; step++)
        {
            var a = step * 2;
            indices.AddRange(new[] { a, a + 1, a + 3, a, a + 3, a + 2 });
        }
        var min = new Vector3(positions.Min(p => p.X), positions.Min(p => p.Y), positions.Min(p => p.Z)) - new Vector3(1f);
        var max = new Vector3(positions.Max(p => p.X), positions.Max(p => p.Y), positions.Max(p => p.Z)) + new Vector3(1f);
        var boxCentre = (min + max) * 0.5f;
        return new Geometry(origin, min, max, boxCentre, Vector3.Distance(boxCentre, max), normal,
            positions.ToArray(), uvs.ToArray(), indices.ToArray());
    }

    private static string BuildYdrXml(string asset, Geometry geometry, float emissive)
    {
        var lod = F(LodDistance);
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Drawable>\n")
            .Append(" <Name>").Append(asset).Append(".#dr</Name>\n")
            .Append(VectorElement(" ", "BoundingSphereCenter", geometry.Centre))
            .Append(" <BoundingSphereRadius value=\"").Append(F(geometry.Radius)).Append("\" />\n")
            .Append(VectorElement(" ", "BoundingBoxMin", geometry.Min))
            .Append(VectorElement(" ", "BoundingBoxMax", geometry.Max))
            .Append(" <LodDistHigh value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistMed value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistLow value=\"").Append(lod).Append("\" />\n")
            .Append(" <LodDistVlow value=\"").Append(lod).Append("\" />\n")
            .Append(" <FlagsHigh value=\"").Append(BucketMask).Append("\" />\n")
            .Append(" <FlagsMed value=\"0\" />\n <FlagsLow value=\"0\" />\n <FlagsVlow value=\"0\" />\n")
            .Append(" <ShaderGroup>\n  <TextureDictionary />\n  <Shaders>\n")
            .Append("   <Item>\n")
            .Append("    <Name>emissive_additive_alpha</Name>\n")
            .Append("    <FileName>emissive_additive_alpha.sps</FileName>\n")
            .Append("    <RenderBucket value=\"").Append(RenderBucket).Append("\" />\n")
            .Append("    <Parameters>\n")
            .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(TextureName).Append("</Name></Item>\n")
            .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
            .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("     <Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"").Append(F(emissive)).Append("\" y=\"0\" z=\"0\" w=\"0\" />\n")
            .Append("    </Parameters>\n")
            .Append("   </Item>\n")
            .Append("  </Shaders>\n </ShaderGroup>\n")
            .Append(" <DrawableModelsHigh>\n  <Item>\n")
            .Append("   <RenderMask value=\"255\" />\n   <Flags value=\"0\" />\n   <HasSkin value=\"0\" />\n")
            .Append("   <BoneIndex value=\"0\" />\n   <Unknown1 value=\"0\" />\n   <Geometries>\n")
            .Append("    <Item>\n     <ShaderIndex value=\"0\" />\n")
            .Append(Vector4Element("     ", "BoundingBoxMin", geometry.Min))
            .Append(Vector4Element("     ", "BoundingBoxMax", geometry.Max))
            .Append("     <VertexBuffer>\n      <Flags value=\"0\" />\n")
            .Append("      <Layout type=\"GTAV1\"><Position /><Normal /><Colour0 /><TexCoord0 /></Layout>\n      <Data>\n");
        for (var index = 0; index < geometry.Positions.Length; index++)
        {
            var p = geometry.Positions[index];
            var uv = geometry.Uvs[index];
            xml.Append("       ").Append(F(p.X)).Append(' ').Append(F(p.Y)).Append(' ').Append(F(p.Z)).Append("   ")
                .Append(F(geometry.Normal.X)).Append(' ').Append(F(geometry.Normal.Y)).Append(' ').Append(F(geometry.Normal.Z))
                .Append("   255 255 255 255   ").Append(F(uv.X)).Append(' ').Append(F(uv.Y)).Append('\n');
        }
        xml.Append("      </Data>\n     </VertexBuffer>\n     <IndexBuffer><Data>")
            .Append(string.Join(' ', geometry.Indices.Select(i => i.ToString(CultureInfo.InvariantCulture))))
            .Append("</Data></IndexBuffer>\n    </Item>\n");
        return xml.Append("   </Geometries>\n  </Item>\n </DrawableModelsHigh>\n</Drawable>\n").ToString();
    }

    private static string BuildYtdXml() =>
        new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<TextureDictionary>\n")
            .Append(" <Item>\n")
            .Append("  <Name>").Append(TextureName).Append("</Name>\n")
            .Append("  <Unk32 value=\"128\" />\n")
            .Append("  <Usage>DIFFUSE</Usage>\n")
            .Append("  <UsageFlags>NOT_HALF, X32, X64, X128, UNK24</UsageFlags>\n")
            .Append("  <ExtraFlags value=\"0\" />\n")
            .Append("  <Width value=\"").Append(TextureWidth).Append("\" />\n")
            .Append("  <Height value=\"").Append(TextureHeight).Append("\" />\n")
            .Append("  <MipLevels value=\"").Append(MipLevels()).Append("\" />\n")
            .Append("  <Format>D3DFMT_A8R8G8B8</Format>\n")
            .Append("  <FileName>").Append(TextureName).Append(".dds</FileName>\n")
            .Append(" </Item>\n</TextureDictionary>\n")
            .ToString();

    private static int MipLevels() => (int)Math.Log2(Math.Max(TextureWidth, TextureHeight)) + 1;

    /*
     * Лист: по U — вдоль дуги (концы гаснут), по V — поперёк полосы: внутри
     * фиолетовый, снаружи красный. Цвет — пастельный: настоящая радуга
     * разбавлена светом неба, и чистый спектр читался бы наклейкой.
     */
    private static byte[] BuildSpectrumDds()
    {
        var levels = MipLevels();
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);
        writer.Write(Encoding.ASCII.GetBytes("DDS "));
        writer.Write(124u); // dwSize
        writer.Write(0x1u | 0x2u | 0x4u | 0x8u | 0x1000u | 0x20000u); // caps|height|width|pitch|pixelformat|mipmapcount
        writer.Write((uint)TextureHeight);
        writer.Write((uint)TextureWidth);
        writer.Write((uint)(TextureWidth * 4)); // pitch
        writer.Write(0u); // depth
        writer.Write((uint)levels);
        for (var index = 0; index < 11; index++) writer.Write(0u);
        writer.Write(32u); // ddspf.dwSize
        writer.Write(0x40u | 0x1u); // RGB | ALPHAPIXELS
        writer.Write(0u); // fourCC
        writer.Write(32u); // bit count
        writer.Write(0x00FF0000u);
        writer.Write(0x0000FF00u);
        writer.Write(0x000000FFu);
        writer.Write(0xFF000000u);
        writer.Write(0x1000u | 0x400000u | 0x8u); // TEXTURE | MIPMAP | COMPLEX
        writer.Write(0u);
        writer.Write(0u);
        writer.Write(0u);
        writer.Write(0u);

        var level = BuildSpectrumPixels();
        int width = TextureWidth, height = TextureHeight;
        for (var mip = 0; mip < levels; mip++)
        {
            for (var y = 0; y < height; y++)
                for (var x = 0; x < width; x++)
                {
                    var pixel = level[y * width + x];
                    writer.Write(ToByte(pixel.Z));
                    writer.Write(ToByte(pixel.Y));
                    writer.Write(ToByte(pixel.X));
                    writer.Write(ToByte(pixel.W));
                }
            if (width == 1 && height == 1) break;
            var nextWidth = Math.Max(1, width / 2);
            var nextHeight = Math.Max(1, height / 2);
            var next = new Vector4[nextWidth * nextHeight];
            for (var y = 0; y < nextHeight; y++)
                for (var x = 0; x < nextWidth; x++)
                {
                    var sum = Vector4.Zero;
                    var count = 0;
                    for (var dy = 0; dy < 2; dy++)
                        for (var dx = 0; dx < 2; dx++)
                        {
                            var sx = Math.Min(x * 2 + dx, width - 1);
                            var sy = Math.Min(y * 2 + dy, height - 1);
                            sum += level[sy * width + sx];
                            count++;
                        }
                    next[y * nextWidth + x] = sum / count;
                }
            level = next;
            width = nextWidth;
            height = nextHeight;
        }
        writer.Flush();
        return stream.ToArray();
    }

    private static Vector4[] BuildSpectrumPixels()
    {
        var pixels = new Vector4[TextureWidth * TextureHeight];
        for (var y = 0; y < TextureHeight; y++)
        {
            /* Поперёк полосы: 0 — внутренний край (фиолетовый), 1 — внешний. */
            var across = (y + 0.5f) / TextureHeight;
            var colour = Spectrum(across);
            /* Плоская вершина: у настоящей радуги красный и фиолетовый так же
               ярки, как середина. Синус гасил края, и на светлом небе оставалась
               жёлто-белая нитка. */
            var envelope = SmoothStep(0f, 0.18f, across) * SmoothStep(0f, 0.18f, 1f - across);
            for (var x = 0; x < TextureWidth; x++)
            {
                var u = (x + 0.5f) / TextureWidth;
                var ends = SmoothStep(0f, 0.12f, u) * SmoothStep(0f, 0.12f, 1f - u);
                var alpha = envelope * ends;
                pixels[y * TextureWidth + x] = new Vector4(colour.X * alpha, colour.Y * alpha, colour.Z * alpha, alpha);
            }
        }
        return pixels;
    }

    private static readonly (float At, Vector3 Colour)[] SpectrumStops =
    {
        (0.00f, new Vector3(0.56f, 0.32f, 1.00f)),
        (0.18f, new Vector3(0.28f, 0.46f, 1.00f)),
        (0.36f, new Vector3(0.28f, 0.92f, 0.48f)),
        (0.54f, new Vector3(1.00f, 0.95f, 0.38f)),
        (0.72f, new Vector3(1.00f, 0.62f, 0.24f)),
        (0.90f, new Vector3(1.00f, 0.28f, 0.22f)),
        (1.00f, new Vector3(0.95f, 0.22f, 0.22f)),
    };

    private static Vector3 Spectrum(float t)
    {
        t = Math.Clamp(t, 0f, 1f);
        for (var index = 0; index < SpectrumStops.Length - 1; index++)
        {
            var (a, colourA) = SpectrumStops[index];
            var (b, colourB) = SpectrumStops[index + 1];
            if (t > b) continue;
            var blend = (t - a) / (b - a);
            var mixed = Vector3.Lerp(colourA, colourB, blend);
            /* Свет неба в радуге: к спектру подмешано чуть белого. */
            return Vector3.Lerp(mixed, Vector3.One, 0.05f);
        }
        return SpectrumStops[^1].Colour;
    }

    private static byte[] BuildManifest()
    {
        var xml = new XmlDocument();
        xml.LoadXml(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<CPackFileMetaData>\n" +
            " <MapDataGroups />\n" +
            " <HDTxdBindingArray />\n" +
            " <imapDependencies />\n" +
            " <imapDependencies_2>\n" +
            "  <Item>\n" +
            "   <imapName>" + MapName + "</imapName>\n" +
            "   <manifestFlags />\n" +
            "   <itypDepArray>\n" +
            "    <Item>" + TypesName + "</Item>\n" +
            "   </itypDepArray>\n" +
            "  </Item>\n" +
            " </imapDependencies_2>\n" +
            " <itypDependencies_2 />\n" +
            " <Interiors />\n" +
            "</CPackFileMetaData>\n");
        var pso = XmlPso.GetPso(xml) ?? throw new InvalidDataException("Rainbow manifest PSO was not built.");
        return pso.Save();
    }

    /* Излучение модели, как его прочтёт игра: параметр `emissiveMultiplier`
       единственного шейдера. */
    private static float? EmissiveOf(ShaderFX shader)
    {
        var list = shader.ParametersList;
        if (list?.Parameters is null || list.Hashes is null) return null;
        var index = Array.FindIndex(list.Hashes, hash => (uint)hash == JenkHash.GenHash("emissivemultiplier"));
        return index >= 0 && index < list.Parameters.Length && list.Parameters[index].Data is Vector4 value
            ? value.X
            : null;
    }

    private static async Task<object[]> ReopenAndDescribeAsync(
        Tier[] tiers, IReadOnlyList<string> ydrPaths, string ytdPath, string ytypPath, string ymapPath, string manifestPath)
    {
        var described = new List<object>();

        for (var index = 0; index < tiers.Length; index++)
        {
            var ydrPath = ydrPaths[index];
            var ydrBytes = await File.ReadAllBytesAsync(ydrPath);
            var ydr = new YdrFile { Name = Path.GetFileName(ydrPath) };
            ydr.Load(ydrBytes);
            var drawable = ydr.Drawable;
            var shaders = drawable?.ShaderGroup?.Shaders?.data_items;
            var geometries = drawable?.DrawableModels?.High?.SelectMany(model => model.Geometries ?? []).ToArray() ?? [];
            var expected = BaseEmissiveMultiplier * tiers[index].Brightness;
            var emissive = shaders is { Length: 1 } ? EmissiveOf(shaders[0]) : null;
            if (!ydr.Loaded || drawable is null || shaders is not { Length: 1 } ||
                shaders[0].Name.Hash != JenkHash.GenHash("emissive_additive_alpha") ||
                shaders[0].RenderBucket != RenderBucket ||
                /* Маска корзин модели — ровно корзина её шейдера. */
                drawable.FlagsHigh != BucketMask ||
                geometries.Length != 1 ||
                geometries.Any(geometry => geometry.VertexBuffer?.Info?.Flags != 89 || geometry.VertexStride != 36) ||
                /* Ступень светит тем, что заказано: XML модели пишет шесть
                   знаков после запятой, отсюда допуск. */
                emissive is not { } value || MathF.Abs(value - expected) > MathF.Max(expected * 1e-3f, 1e-6f))
                throw new InvalidDataException($"Compiled rainbow {Path.GetFileName(ydrPath)} failed semantic reopen.");
            described.Add(Describe(ydrPath, ydrBytes, new
            {
                semanticReopen = true,
                geometries = geometries.Length,
                bucketMask = (int)drawable.FlagsHigh,
                emissive,
            }));
        }

        var ytdBytes = await File.ReadAllBytesAsync(ytdPath);
        var ytd = new YtdFile { Name = Path.GetFileName(ytdPath) };
        ytd.Load(ytdBytes);
        var texture = ytd.TextureDict?.Textures?.data_items?.FirstOrDefault();
        if (!ytd.Loaded || texture is null || texture.Width != TextureWidth || texture.Height != TextureHeight)
            throw new InvalidDataException("Compiled rainbow YTD failed semantic reopen.");
        described.Add(Describe(ytdPath, ytdBytes, new { semanticReopen = true, textures = 1 }));

        var ytypBytes = await File.ReadAllBytesAsync(ytypPath);
        var ytyp = new YtypFile { Name = Path.GetFileName(ytypPath) };
        ytyp.Load(ytypBytes);
        var times = ytyp.AllArchetypes?.OfType<TimeArchetype>().ToArray() ?? [];
        /* Каждая ступень — свой объект со своими часами (что часы ступеней не
           пересекаются, проверил разбор запроса): в любой час в небе не больше
           одной радуги. */
        if (!ytyp.Loaded || times.Length != tiers.Length ||
            (ytyp.AllArchetypes?.Length ?? 0) != tiers.Length ||
            tiers.Where((tier, index) =>
                (uint)times[index]._BaseArchetypeDef.name != JenkHash.GenHash(tier.Asset) ||
                times[index].TimeFlags != TimeFlags(tier.Hours)).Any())
            throw new InvalidDataException("Compiled rainbow YTYP failed semantic reopen.");
        described.Add(Describe(ytypPath, ytypBytes, new { semanticReopen = true, archetypes = times.Length }));

        var ymapBytes = await File.ReadAllBytesAsync(ymapPath);
        var ymap = new YmapFile { Name = Path.GetFileName(ymapPath) };
        ymap.Load(ymapBytes);
        var placed = ymap.AllEntities?.Select(entity => (uint)entity._CEntityDef.archetypeName).ToArray() ?? [];
        if (!ymap.Loaded || placed.Length != tiers.Length ||
            !tiers.Select(tier => JenkHash.GenHash(tier.Asset)).SequenceEqual(placed))
            throw new InvalidDataException("Compiled rainbow YMAP failed semantic reopen.");
        described.Add(Describe(ymapPath, ymapBytes, new { semanticReopen = true, entities = placed.Length }));

        var manifestBytes = await File.ReadAllBytesAsync(manifestPath);
        var manifest = new YmfFile();
        manifest.Load(manifestBytes, new RpfBinaryFileEntry());
        var dependency = manifest.imapDependencies2?.FirstOrDefault();
        if (manifest.Pso is null || manifest.imapDependencies2?.Length != 1 ||
            dependency?.Dep.imapName.Hash != JenkHash.GenHash(MapName) ||
            dependency.itypDepArray?.Length != 1 ||
            dependency.itypDepArray[0].Hash != JenkHash.GenHash(TypesName))
            throw new InvalidDataException("Compiled rainbow _manifest.ymf failed semantic reopen.");
        described.Add(Describe(manifestPath, manifestBytes, new { semanticReopen = true, imapDependencies = 1 }));
        return described.ToArray();
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private static float Radians(float degrees) => degrees * MathF.PI / 180f;
    private static float SmoothStep(float edge0, float edge1, float x)
    {
        var t = Math.Clamp((x - edge0) / (edge1 - edge0), 0f, 1f);
        return t * t * (3f - 2f * t);
    }
    private static byte ToByte(float value) => (byte)Math.Clamp((int)MathF.Round(value * 255f), 0, 255);
    private static string F(float value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static string VectorElement(string indent, string name, Vector3 value) =>
        $"{indent}<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" />\n";
    private static string Vector4Element(string indent, string name, Vector3 value) =>
        $"{indent}<{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" w=\"0\" />\n";

    private sealed record TierRequest(int[]? Hours, float Brightness);

    private sealed record CompileRequest(
        string Format,
        int Version,
        TierRequest[]? Tiers = null);
}
