using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Compiles an admitted building customization into an Astral-owned additive
/// drawable. It never reads or patches the vanilla building archives.
/// </summary>
internal static class MegaMallOverlayCommands
{
    private const string RequestFormat = "astral.compile-mega-mall-overlay";
    private const string TargetId = "gta5-legacy-story";
    private const string BuildId = "24129523";
    private const int TextureWidth = 2048;
    private const int TextureHeight = 512;
    private const int TextureMipLevels = 12;
    private const int MaxDdsBytes = 8 * 1024 * 1024;
    private const float DefaultLodDistance = 650f;

    private static readonly OverlaySpec DavisMegaMall = new(
        "davis-mega-mall.overlay.legacy-24129523.v2",
        "astral_davis_megamall_overlay",
        new Vector3(70.89937f, -1773.2747f, 35.434685f),
        DefaultLodDistance,
        [
            new("facade-front", "astral_mall_front", Plane.Oriented(0.766054f, -0.642776f, -5.94f, -34.8402f, 39.8485f, -7.20f, 10.90f)),
            new("facade-right", "astral_mall_right", Plane.Oriented(0.642406f, 0.766365f, 39.81f, -60.3114f, 33.3705f, -7.20f, 10.90f)),
            new("facade-rear", "astral_mall_rear", Plane.Oriented(-0.766052f, 0.642778f, 33.56f, -39.8285f, 34.8609f, -7.20f, 10.90f)),
            new("facade-left", "astral_mall_left", Plane.Oriented(-0.642800f, -0.766034f, 35.06f, -32.9253f, 48.5752f, -7.20f, 10.90f)),
            new("sign-main", "astral_mall_sign", Plane.PositiveX(77.94f, -12f, 7f, -5.8f, 1.1f), true),
        ]);

    private static readonly OverlaySpec YouTool = new(
        "you-tool-ashan.overlay.legacy-24129523.v1",
        "astral_you_tool_overlay",
        new Vector3(2706.7502f, 3480.1733f, 62.7826f),
        DefaultLodDistance,
        [
            // Exact planes come from dominant cs4_02_nmall00 exterior triangle
            // clusters. Only the upper facade bands are covered, so entrance,
            // doors and collision remain vanilla and unobstructed.
            new("facade-front", "astral_youtool_front", Plane.Oriented(0.385351f, 0.922770f, 46.56f, -39.43f, 44.18f, 3.40f, 9.72f)),
            new("facade-right", "astral_youtool_right", Plane.Oriented(0.922679f, -0.385569f, 44.06f, -28.48f, 46.25f, 3.40f, 9.72f)),
            new("facade-rear", "astral_youtool_rear", Plane.Oriented(-0.385320f, -0.922783f, 28.56f, -43.94f, 33.18f, 3.40f, 9.72f)),
            new("facade-left", "astral_youtool_left", Plane.Oriented(-0.922623f, 0.385703f, -14.81f, -46.53f, 28.62f, 3.40f, 9.72f)),
            new("sign-main", "astral_youtool_sign", Plane.Oriented(-0.922623f, 0.385703f, -42.31f, -26.19f, 8.41f, 5.72f, 11.48f), true),
        ]);

    private static readonly IReadOnlyDictionary<string, OverlaySpec> Profiles =
        new[] { DavisMegaMall, YouTool }.ToDictionary(spec => spec.ProfileId, StringComparer.Ordinal);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 12,
        Converters = { new JsonStringEnumConverter() },
    };

    public static async Task<object> CompileAsync(string input, string outputDirectory)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > 256 * 1024)
            throw new InvalidDataException("Mega Mall compile request must be between 1 byte and 256 KiB.");
        var request = JsonSerializer.Deserialize<CompileRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Mega Mall compile request is empty.");
        if (!Profiles.TryGetValue(request.ProfileId, out var spec))
            throw new InvalidDataException("Building overlay profile is not admitted.");
        ValidateRequest(request, spec);

        var output = Path.GetFullPath(outputDirectory);
        if (File.Exists(output)) throw new InvalidDataException("Mega Mall output must be a directory.");
        Directory.CreateDirectory(output);
        if (new DirectoryInfo(output).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Mega Mall output cannot be a reparse point.");
        if (Directory.EnumerateFileSystemEntries(output).Any())
            throw new InvalidDataException("Mega Mall output directory must be empty.");

        var validated = new Dictionary<string, ValidatedSurface>(StringComparer.Ordinal);
        foreach (var surfaceSpec in spec.Surfaces)
        {
            var surface = request.Surfaces.Single(item => item.SurfaceId == surfaceSpec.Id);
            validated[surfaceSpec.Id] = await ValidateDdsAsync(surface, surfaceSpec);
        }

        var ydrPath = Path.Combine(output, spec.AssetName + ".ydr");
        var ytdPath = Path.Combine(output, spec.AssetName + ".ytd");
        var ytypPath = Path.Combine(output, spec.AssetName + ".ytyp");
        var ymapPath = Path.Combine(output, spec.AssetName + ".ymap");

        var ydr = XmlYdr.GetYdr(BuildYdrXml(spec), output);
        if (ydr.Drawable is null) throw new InvalidDataException("Generated overlay YDR XML has no drawable.");
        var ydrBytes = ydr.Save();
        await File.WriteAllBytesAsync(ydrPath, ydrBytes);

        var ytdAssets = Path.Combine(output, ".texture-assets");
        Directory.CreateDirectory(ytdAssets);
        try
        {
            foreach (var surfaceSpec in spec.Surfaces)
                await File.WriteAllBytesAsync(Path.Combine(ytdAssets, surfaceSpec.TextureName + ".dds"), validated[surfaceSpec.Id].Bytes);
            var ytd = XmlYtd.GetYtd(BuildYtdXml(spec), ytdAssets);
            if (ytd.TextureDict is null) throw new InvalidDataException("Generated overlay YTD XML has no dictionary.");
            await File.WriteAllBytesAsync(ytdPath, ytd.Save());
        }
        finally
        {
            Directory.Delete(ytdAssets, true);
        }

        var assetHash = new MetaHash(JenkHash.GenHash(spec.AssetName));
        var archetypeDefinition = new CBaseArchetypeDef
        {
            lodDist = spec.LodDistance,
            flags = 0,
            specialAttribute = 0,
            bbMin = spec.BoundsMin,
            bbMax = spec.BoundsMax,
            bsCentre = spec.BoundsCenter,
            bsRadius = spec.BoundsRadius,
            hdTextureDist = 220f,
            name = assetHash,
            textureDictionary = assetHash,
            assetType = rage__fwArchetypeDef__eAssetType.ASSET_TYPE_DRAWABLE,
            assetName = assetHash,
        };
        var ytyp = new YtypFile
        {
            Name = spec.AssetName + ".ytyp",
            NameHash = JenkHash.GenHash(spec.AssetName),
            CMapTypes = new CMapTypes(),
        };
        var archetype = new Archetype();
        archetype.Init(ytyp, ref archetypeDefinition);
        ytyp.AllArchetypes = [archetype];
        await File.WriteAllBytesAsync(ytypPath, ytyp.Save());

        var entityDefinition = new CEntityDef
        {
            archetypeName = assetHash,
            flags = 1572864,
            guid = JenkHash.GenHash(request.DesignHash + ":overlay"),
            position = spec.WorldPosition,
            rotation = new Vector4(0, 0, 0, 1),
            scaleXY = 1,
            scaleZ = 1,
            parentIndex = -1,
            lodDist = spec.LodDistance,
            childLodDist = 0,
            lodLevel = rage__eLodType.LODTYPES_DEPTH_ORPHANHD,
            numChildren = 0,
            priorityLevel = rage__ePriorityLevel.PRI_REQUIRED,
            ambientOcclusionMultiplier = 255,
            artificialAmbientOcclusion = 255,
            tintValue = 0,
        };
        var entity = new YmapEntityDef(null, 0, ref entityDefinition);
        entity.SetOrientation(Quaternion.Identity);
        entity.SetArchetype(archetype);
        var mapName = spec.AssetName + "_map";
        var ymap = new YmapFile
        {
            Name = mapName + ".ymap",
            CMapData = new CMapData
            {
                name = new MetaHash(JenkHash.GenHash(mapName)),
                parent = new MetaHash(0),
            },
            AllEntities = [entity],
            BlockExportedBy = "Astral Mega Mall Overlay Compiler 1",
            BlockTime = "01 January 1970 00:00",
        };
        ymap.CalcFlags();
        ymap.CalcExtents();
        await File.WriteAllBytesAsync(ymapPath, ymap.Save());

        var artifacts = await ReopenAndDescribeAsync(ydrPath, ytdPath, ytypPath, ymapPath, assetHash, spec);
        return new
        {
            format = "astral.mega-mall-overlay-artifacts",
            version = 1,
            profileId = spec.ProfileId,
            request.DesignHash,
            assetName = spec.AssetName,
            worldPosition = new { x = spec.WorldPosition.X, y = spec.WorldPosition.Y, z = spec.WorldPosition.Z },
            overlay = new
            {
                independentSurfaceCount = spec.Surfaces.Length,
                trianglesPerLod = spec.Surfaces.Length * 2,
                triangleCountAcrossHighAndLow = spec.Surfaces.Length * 4,
                lodStrategy = "unified-ultra-low-poly",
                lodDistance = spec.LodDistance,
                vanillaArchivesModified = false,
            },
            artifacts,
        };
    }

    private static void ValidateRequest(CompileRequest request, OverlaySpec spec)
    {
        if (request.Format != RequestFormat || request.Version != 1 || request.TargetId != TargetId ||
            request.ProfileId != spec.ProfileId || request.BuildId != BuildId)
            throw new InvalidDataException("Mega Mall compile request does not match the pinned Legacy profile.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(request.DesignHash ?? "", "^sha256:[a-f0-9]{64}$"))
            throw new InvalidDataException("Mega Mall designHash is invalid.");
        if (request.Surfaces is null || request.Surfaces.Length != spec.Surfaces.Length)
            throw new InvalidDataException("Mega Mall compile request must contain exactly five surfaces.");
        var ids = request.Surfaces.Select(surface => surface.SurfaceId).ToArray();
        if (ids.Distinct(StringComparer.Ordinal).Count() != spec.Surfaces.Length ||
            spec.Surfaces.Any(surface => !ids.Contains(surface.Id, StringComparer.Ordinal)))
            throw new InvalidDataException("Mega Mall compile request has an unexpected surface set.");
    }

    private static async Task<ValidatedSurface> ValidateDdsAsync(CompileSurface surface, SurfaceSpec spec)
    {
        if (surface.TextureName != spec.TextureName || surface.Width != TextureWidth ||
            surface.Height != TextureHeight || surface.Format != "BC3" || surface.MipLevels != TextureMipLevels)
            throw new InvalidDataException($"Surface {spec.Id} does not match its pinned DDS target.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(surface.DdsSha256 ?? "", "^sha256:[a-f0-9]{64}$"))
            throw new InvalidDataException($"Surface {spec.Id} has an invalid DDS SHA-256.");
        var file = Path.GetFullPath(surface.DdsPath ?? "");
        if (!File.Exists(file)) throw new FileNotFoundException($"DDS for {spec.Id} was not found.", file);
        var info = new FileInfo(file);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is < 128 or > MaxDdsBytes)
            throw new InvalidDataException($"DDS for {spec.Id} has an unsafe file type or size.");
        var bytes = await File.ReadAllBytesAsync(file);
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "DDS " ||
            BitConverter.ToInt32(bytes, 12) != TextureHeight ||
            BitConverter.ToInt32(bytes, 16) != TextureWidth ||
            BitConverter.ToInt32(bytes, 28) != TextureMipLevels ||
            Encoding.ASCII.GetString(bytes, 84, 4) != "DXT5")
            throw new InvalidDataException($"DDS header for {spec.Id} is not 2048x512 BC3 with 12 mips.");
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (surface.DdsSha256 != "sha256:" + digest)
            throw new InvalidDataException($"DDS SHA-256 mismatch for {spec.Id}.");
        return new ValidatedSurface(bytes, digest);
    }

    private static string BuildYtdXml(OverlaySpec profile)
    {
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<TextureDictionary>\n");
        foreach (var spec in profile.Surfaces)
        {
            xml.Append(" <Item>\n")
                .Append("  <Name>").Append(spec.TextureName).Append("</Name>\n")
                .Append("  <Unk32 value=\"128\" />\n")
                .Append("  <Usage>DIFFUSE</Usage>\n")
                .Append("  <UsageFlags>NOT_HALF, HD_SPLIT, X32, X64, X128, X512, UNK24</UsageFlags>\n")
                .Append("  <ExtraFlags value=\"0\" />\n")
                .Append("  <Width value=\"").Append(TextureWidth).Append("\" />\n")
                .Append("  <Height value=\"").Append(TextureHeight).Append("\" />\n")
                .Append("  <MipLevels value=\"").Append(TextureMipLevels).Append("\" />\n")
                .Append("  <Format>D3DFMT_DXT5</Format>\n")
                .Append("  <FileName>").Append(spec.TextureName).Append(".dds</FileName>\n")
                .Append(" </Item>\n");
        }
        return xml.Append("</TextureDictionary>\n").ToString();
    }

    private static string BuildYdrXml(OverlaySpec profile)
    {
        var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Drawable>\n")
            .Append(" <Name>").Append(profile.AssetName).Append(".#dr</Name>\n")
            .Append(VectorElement("BoundingSphereCenter", profile.BoundsCenter))
            .Append(" <BoundingSphereRadius value=\"").Append(F(profile.BoundsRadius)).Append("\" />\n")
            .Append(VectorElement("BoundingBoxMin", profile.BoundsMin))
            .Append(VectorElement("BoundingBoxMax", profile.BoundsMax))
            .Append(" <LodDistHigh value=\"650\" />\n <LodDistMed value=\"650\" />\n <LodDistLow value=\"650\" />\n <LodDistVlow value=\"650\" />\n")
            .Append(" <FlagsHigh value=\"1\" />\n <FlagsMed value=\"0\" />\n <FlagsLow value=\"1\" />\n <FlagsVlow value=\"0\" />\n")
            .Append(" <ShaderGroup>\n  <TextureDictionary />\n  <Shaders>\n");
        foreach (var spec in profile.Surfaces)
        {
            xml.Append("   <Item>\n")
                .Append("    <Name>").Append(spec.Emissive ? "emissivenight" : "default").Append("</Name>\n")
                .Append("    <FileName>").Append(spec.Emissive ? "hash_557DB6E4" : "hash_5B380B60").Append("</FileName>\n")
                .Append("    <RenderBucket value=\"").Append(spec.Emissive ? "0" : "3").Append("\" />\n")
                .Append("    <Parameters>\n")
                .Append("     <Item name=\"DiffuseSampler\" type=\"Texture\"><Name>").Append(spec.TextureName).Append("</Name></Item>\n")
                .Append("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />\n")
                .Append("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n")
                .Append("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />\n");
            if (spec.Emissive)
                xml.Append("     <Item name=\"emissiveMultiplier\" type=\"Vector\" x=\"1.35\" y=\"0\" z=\"0\" w=\"0\" />\n");
            else
                xml.Append("     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"0.15\" y=\"0\" z=\"0\" w=\"0\" />\n")
                    .Append("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />\n")
                    .Append("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />\n");
            xml.Append("    </Parameters>\n   </Item>\n");
        }
        xml.Append("  </Shaders>\n </ShaderGroup>\n")
            .Append(BuildDrawableModel("DrawableModelsHigh", profile))
            .Append(BuildDrawableModel("DrawableModelsLow", profile))
            .Append("</Drawable>\n");
        return xml.ToString();
    }

    private static string BuildDrawableModel(string element, OverlaySpec profile)
    {
        var xml = new StringBuilder(" <").Append(element).Append(">\n  <Item>\n")
            .Append("   <RenderMask value=\"255\" />\n   <Flags value=\"0\" />\n   <HasSkin value=\"0\" />\n")
            .Append("   <BoneIndex value=\"0\" />\n   <Unknown1 value=\"0\" />\n   <Geometries>\n");
        for (var index = 0; index < profile.Surfaces.Length; index++)
        {
            var plane = profile.Surfaces[index].Plane;
            xml.Append("    <Item>\n     <ShaderIndex value=\"").Append(index).Append("\" />\n")
                .Append(Vector4Element("BoundingBoxMin", plane.Min))
                .Append(Vector4Element("BoundingBoxMax", plane.Max))
                .Append("     <VertexBuffer>\n      <Flags value=\"0\" />\n      <Layout type=\"GTAV1\"><Position /><Normal /><Colour0 /><TexCoord0 /></Layout>\n      <Data>\n");
            var uv = new[] { (0f, 1f), (1f, 1f), (1f, 0f), (0f, 0f) };
            for (var vertex = 0; vertex < 4; vertex++)
            {
                var p = plane.Vertices[vertex];
                xml.Append("       ").Append(F(p.X)).Append(' ').Append(F(p.Y)).Append(' ').Append(F(p.Z)).Append("   ")
                    .Append(F(plane.Normal.X)).Append(' ').Append(F(plane.Normal.Y)).Append(' ').Append(F(plane.Normal.Z))
                    .Append("   255 255 255 255   ").Append(F(uv[vertex].Item1)).Append(' ').Append(F(uv[vertex].Item2)).Append("\n");
            }
            xml.Append("      </Data>\n     </VertexBuffer>\n     <IndexBuffer><Data>0 1 2 0 2 3</Data></IndexBuffer>\n    </Item>\n");
        }
        return xml.Append("   </Geometries>\n  </Item>\n </").Append(element).Append(">\n").ToString();
    }

    private static async Task<object[]> ReopenAndDescribeAsync(
        string ydrPath, string ytdPath, string ytypPath, string ymapPath, MetaHash assetHash, OverlaySpec profile)
    {
        var ydrBytes = await File.ReadAllBytesAsync(ydrPath);
        var ydr = new YdrFile { Name = Path.GetFileName(ydrPath) };
        ydr.Load(ydrBytes);
        if (!ydr.Loaded || ydr.Drawable is null)
            throw new InvalidDataException("Compiled overlay YDR failed semantic reopen.");

        var ytdBytes = await File.ReadAllBytesAsync(ytdPath);
        var ytd = new YtdFile { Name = Path.GetFileName(ytdPath) };
        ytd.Load(ytdBytes);
        var textureCount = ytd.TextureDict?.Textures?.data_items?.Length ?? 0;
        if (!ytd.Loaded || textureCount != profile.Surfaces.Length)
            throw new InvalidDataException("Compiled overlay YTD failed semantic reopen.");

        var ytypBytes = await File.ReadAllBytesAsync(ytypPath);
        var ytyp = new YtypFile { Name = Path.GetFileName(ytypPath) };
        ytyp.Load(ytypBytes);
        if (!ytyp.Loaded || ytyp.AllArchetypes?.Length != 1 ||
            (uint)ytyp.AllArchetypes[0]._BaseArchetypeDef.name != (uint)assetHash)
            throw new InvalidDataException("Compiled overlay YTYP failed semantic reopen.");

        var ymapBytes = await File.ReadAllBytesAsync(ymapPath);
        var ymap = new YmapFile { Name = Path.GetFileName(ymapPath) };
        ymap.Load(ymapBytes);
        var entities = ymap.AllEntities ?? [];
        if (!ymap.Loaded || entities.Length != 1 ||
            (uint)entities[0].CEntityDef.archetypeName != (uint)assetHash ||
            Vector3.Distance(entities[0].Position, profile.WorldPosition) > 0.01f)
            throw new InvalidDataException("Compiled overlay YMAP failed semantic reopen.");

        return
        [
            Describe(ydrPath, ydrBytes, new { semanticReopen = true, geometryCount = profile.Surfaces.Length * 2 }),
            Describe(ytdPath, ytdBytes, new { semanticReopen = true, textureCount }),
            Describe(ytypPath, ytypBytes, new { semanticReopen = true, archetypeCount = 1 }),
            Describe(ymapPath, ymapBytes, new { semanticReopen = true, entityCount = 1 }),
        ];
    }

    private static object Describe(string file, byte[] bytes, object semantic) => new
    {
        file = Path.GetFileName(file),
        bytes = bytes.Length,
        sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
        semantic,
    };

    private static string F(float value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static string VectorElement(string name, Vector3 value) =>
        $" <{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" />\n";
    private static string Vector4Element(string name, Vector3 value) =>
        $"     <{name} x=\"{F(value.X)}\" y=\"{F(value.Y)}\" z=\"{F(value.Z)}\" w=\"{F(value.X)}\" />\n";

    private sealed record CompileRequest(
        string Format,
        int Version,
        string TargetId,
        string ProfileId,
        string BuildId,
        string DesignHash,
        CompileSurface[] Surfaces);

    private sealed record CompileSurface(
        string SurfaceId,
        string TextureName,
        int Width,
        int Height,
        string Format,
        int MipLevels,
        string DdsPath,
        string DdsSha256);

    private sealed record OverlaySpec(
        string ProfileId,
        string AssetName,
        Vector3 WorldPosition,
        float LodDistance,
        SurfaceSpec[] Surfaces)
    {
        private IEnumerable<Vector3> Vertices => Surfaces.SelectMany(surface => surface.Plane.Vertices);
        public Vector3 BoundsMin => new(
            Vertices.Min(vertex => vertex.X) - 0.1f,
            Vertices.Min(vertex => vertex.Y) - 0.1f,
            Vertices.Min(vertex => vertex.Z) - 0.1f);
        public Vector3 BoundsMax => new(
            Vertices.Max(vertex => vertex.X) + 0.1f,
            Vertices.Max(vertex => vertex.Y) + 0.1f,
            Vertices.Max(vertex => vertex.Z) + 0.1f);
        public Vector3 BoundsCenter => (BoundsMin + BoundsMax) * 0.5f;
        public float BoundsRadius => Vector3.Distance(BoundsCenter, BoundsMax);
    }

    private sealed record SurfaceSpec(string Id, string TextureName, Plane Plane, bool Emissive = false);
    private sealed record ValidatedSurface(byte[] Bytes, string Sha256);

    private sealed record Plane(Vector3[] Vertices, Vector3 Normal, Vector3 Min, Vector3 Max)
    {
        private static Plane Create(Vector3[] vertices, Vector3 normal) => new(
            vertices,
            normal,
            new Vector3(vertices.Min(v => v.X), vertices.Min(v => v.Y), vertices.Min(v => v.Z)),
            new Vector3(vertices.Max(v => v.X), vertices.Max(v => v.Y), vertices.Max(v => v.Z)));

        public static Plane PositiveX(float x, float minY, float maxY, float minZ, float maxZ) => Create(
            [new(x, minY, minZ), new(x, maxY, minZ), new(x, maxY, maxZ), new(x, minY, maxZ)], Vector3.UnitX);
        public static Plane NegativeX(float x, float minY, float maxY, float minZ, float maxZ) => Create(
            [new(x, maxY, minZ), new(x, minY, minZ), new(x, minY, maxZ), new(x, maxY, maxZ)], -Vector3.UnitX);
        public static Plane PositiveY(float y, float minX, float maxX, float minZ, float maxZ) => Create(
            [new(minX, y, minZ), new(minX, y, maxZ), new(maxX, y, maxZ), new(maxX, y, minZ)], Vector3.UnitY);
        public static Plane NegativeY(float y, float minX, float maxX, float minZ, float maxZ) => Create(
            [new(maxX, y, minZ), new(maxX, y, maxZ), new(minX, y, maxZ), new(minX, y, minZ)], -Vector3.UnitY);

        public static Plane Oriented(
            float normalX,
            float normalY,
            float distance,
            float minTangent,
            float maxTangent,
            float minZ,
            float maxZ)
        {
            var normal2 = new Vector2(normalX, normalY);
            normal2.Normalize();
            var tangent = new Vector2(-normal2.Y, normal2.X);
            var origin = normal2 * distance;
            var bottomStart = origin + tangent * minTangent;
            var bottomEnd = origin + tangent * maxTangent;
            return Create(
                [
                    new(bottomStart.X, bottomStart.Y, minZ),
                    new(bottomEnd.X, bottomEnd.Y, minZ),
                    new(bottomEnd.X, bottomEnd.Y, maxZ),
                    new(bottomStart.X, bottomStart.Y, maxZ),
                ],
                new Vector3(normal2.X, normal2.Y, 0f));
        }
    }
}
