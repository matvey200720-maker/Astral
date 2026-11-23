using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CodeWalker;
using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

internal sealed record LampRgb(byte R, byte G, byte B);

internal sealed record LampHdMutation(
    int LightIndex,
    string ExpectedFingerprint,
    LampRgb? Color = null,
    float? Intensity = null,
    float? Falloff = null,
    float? FalloffExponent = null,
    float? CoronaIntensity = null,
    float? CoronaSize = null,
    float? CoronaZBias = null,
    float? VolumeIntensity = null,
    float? VolumeSizeScale = null,
    LampRgb? VolumeOuterColor = null,
    float? VolumeOuterIntensity = null,
    float? VolumeOuterExponent = null,
    byte? LightFadeDistance = null,
    byte? VolumetricFadeDistance = null,
    uint? FlagsValue = null,
    uint? OwnedFlagsMask = null
);

internal sealed record LampEntityOccurrence(
    string YmapEntry,
    int EntityIndex,
    string ArchetypeName,
    string ArchetypeHash,
    string EntityGuid,
    float PositionX,
    float PositionY,
    float PositionZ,
    float RotationX,
    float RotationY,
    float RotationZ,
    float RotationW,
    float ScaleX,
    float ScaleY,
    float ScaleZ
);

internal sealed record LampWorldAnchor(string AnchorId, float X, float Y, float Z);

internal sealed record LampDistantLightCandidate(
    string AnchorId,
    string YmapEntry,
    int AlignedLightIndex,
    float Distance,
    float PositionX,
    float PositionY,
    float PositionZ,
    byte ColorR,
    byte ColorG,
    byte ColorB,
    byte Intensity
);

internal sealed record LampLodMutation(
    int AlignedLightIndex,
    string ExpectedFingerprint,
    LampRgb? Color = null,
    byte? Intensity = null,
    float? Falloff = null,
    float? FalloffExponent = null,
    byte? CoronaIntensity = null
);

internal static class LampLightCommands
{
    private const int MaxMutations = 256;
    private static readonly JsonSerializerOptions CanonicalJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public static Task<bool> SelfTestAsync(string root)
    {
        RpfManager.IsGen9 = false;
        _ = root;
        var light = new LightAttributes
        {
            ColorR = 255,
            ColorG = 120,
            ColorB = 10,
            Intensity = 32,
            Falloff = 18,
            FalloffExponent = 96,
            BoneId = 42,
            Type = LightType.Spot,
            TimeFlags = 0x00EFFFFF,
            Flags = 0x580,
            VolumeIntensity = 1,
            VolumeSizeScale = 1,
            VolumeOuterColorR = 255,
            VolumeOuterColorG = 255,
            VolumeOuterColorB = 255,
            VolumeOuterIntensity = 0.133f,
            VolumeOuterExponent = 1,
            CoronaIntensity = 0.133f,
            CoronaSize = 3,
            CoronaZBias = 0.1f,
            Direction = new SharpDX.Vector3(0, 0, -1),
            Tangent = new SharpDX.Vector3(1, 0, 0),
            ConeInnerAngle = 10,
            ConeOuterAngle = 70,
            Extent = SharpDX.Vector3.One,
        };
        var immutableBefore = ImmutableFingerprint(light);
        var mutation = new LampHdMutation(
            0,
            Fingerprint(light),
            Color: new LampRgb(80, 210, 255),
            Intensity: 40,
            Falloff: 20,
            VolumeIntensity: 1.2f);
        ApplyMutation(light, mutation);
        AssertMutation(light, mutation);
        return Task.FromResult(
            light.ColorR == 80 && light.ColorG == 210 && light.ColorB == 255 &&
            light.Intensity == 40 && light.Falloff == 20 && light.VolumeIntensity == 1.2f &&
            ImmutableFingerprint(light).Equals(immutableBefore, StringComparison.OrdinalIgnoreCase));
    }

    public static async Task<object> InspectAsync(string? inputFile)
    {
        var input = RequireInput(inputFile);
        RpfManager.IsGen9 = false;
        var bytes = await File.ReadAllBytesAsync(input);
        var extension = Path.GetExtension(input).ToLowerInvariant();
        var inventory = extension switch
        {
            ".yft" => InspectYft(bytes),
            ".ydr" => InspectYdr(bytes),
            ".ydd" => InspectYdd(bytes),
            ".ymap" => InspectYmap(bytes),
            _ => throw new InvalidDataException(
                "lamp-inspect supports only Legacy YFT, YDR, YDD and YMAP resources."),
        };
        return new
        {
            status = "ready",
            mode = "lamp-inspect",
            edition = "legacy",
            input,
            bytes = bytes.Length,
            sha256 = Sha256(bytes),
            inventory,
        };
    }

    public static async Task<object> PlanAsync(
        string? inputFile,
        string? expectedInputSha256,
        IReadOnlyList<LampHdMutation>? mutations)
    {
        var input = RequireInput(inputFile);
        if (!Path.GetExtension(input).Equals(".yft", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("lamp-plan currently accepts only verified Legacy YFT assets.");
        if (mutations is null || mutations.Count is < 1 or > MaxMutations)
            throw new InvalidDataException($"lamp-plan requires 1-{MaxMutations} mutations.");
        if (mutations.Select(item => item.LightIndex).Distinct().Count() != mutations.Count)
            throw new InvalidDataException("Each lamp light index may be planned only once.");
        ValidateSha256(expectedInputSha256, "expectedInputSha256");

        RpfManager.IsGen9 = false;
        var bytes = await File.ReadAllBytesAsync(input);
        var inputSha256 = Sha256(bytes);
        if (!inputSha256.Equals(expectedInputSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Lamp plan input SHA-256 does not match the approved base.");
        var file = LoadYft(bytes);
        var lights = file.Fragment?.LightAttributes?.data_items
            ?? throw new InvalidDataException("YFT has no fragment light array.");
        foreach (var mutation in mutations.OrderBy(item => item.LightIndex))
        {
            if (mutation.LightIndex < 0 || mutation.LightIndex >= lights.Length)
                throw new InvalidDataException($"YFT light index is out of range: {mutation.LightIndex}.");
            ValidateSha256(mutation.ExpectedFingerprint, "expectedFingerprint");
            var light = lights[mutation.LightIndex]
                ?? throw new InvalidDataException($"YFT light {mutation.LightIndex} is null.");
            if (!Fingerprint(light).Equals(mutation.ExpectedFingerprint, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YFT light fingerprint changed at index {mutation.LightIndex}.");
            var immutable = ImmutableFingerprint(light);
            ApplyMutation(light, mutation);
            AssertMutation(light, mutation);
            if (!ImmutableFingerprint(light).Equals(immutable, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Planned YFT mutation owns immutable fields at index {mutation.LightIndex}.");
        }
        return new
        {
            status = "ready",
            mode = "lamp-plan",
            edition = "legacy",
            input,
            inputSha256,
            plannedLightIndices = mutations.Select(item => item.LightIndex).Order().ToArray(),
            validation = new
            {
                readOnly = true,
                exactInputSha256 = true,
                exactLightFingerprints = true,
                immutableFieldsPreserved = true,
            },
        };
    }

    public static async Task<object> VerifyAsync(
        string? inputFile,
        string? outputFile,
        string? expectedInputSha256,
        IReadOnlyList<LampHdMutation>? mutations)
    {
        var input = RequireInput(inputFile);
        var output = RequireInput(outputFile);
        if (!Path.GetExtension(input).Equals(".yft", StringComparison.OrdinalIgnoreCase) ||
            !Path.GetExtension(output).Equals(".yft", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("lamp-verify requires Legacy YFT input and output.");
        if (input.Equals(output, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("lamp-verify input and output must be different files.");
        if (mutations is null || mutations.Count is < 1 or > MaxMutations)
            throw new InvalidDataException($"lamp-verify requires 1-{MaxMutations} mutations.");
        if (mutations.Select(item => item.LightIndex).Distinct().Count() != mutations.Count)
            throw new InvalidDataException("Each lamp light index may be verified only once.");
        ValidateSha256(expectedInputSha256, "expectedInputSha256");

        RpfManager.IsGen9 = false;
        var inputBytes = await File.ReadAllBytesAsync(input);
        var outputBytes = await File.ReadAllBytesAsync(output);
        var inputSha256 = Sha256(inputBytes);
        if (!inputSha256.Equals(expectedInputSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Lamp verify input SHA-256 does not match the approved base.");
        var inputLights = LoadYft(inputBytes).Fragment?.LightAttributes?.data_items
            ?? throw new InvalidDataException("Input YFT has no fragment light array.");
        var outputLights = LoadYft(outputBytes).Fragment?.LightAttributes?.data_items
            ?? throw new InvalidDataException("Output YFT has no fragment light array.");
        if (inputLights.Length != outputLights.Length)
            throw new InvalidDataException("Verified YFT changed the light array topology.");
        var mutationByIndex = mutations.ToDictionary(item => item.LightIndex);
        for (var index = 0; index < inputLights.Length; index++)
        {
            var before = inputLights[index]
                ?? throw new InvalidDataException($"Input YFT light {index} is null.");
            var after = outputLights[index]
                ?? throw new InvalidDataException($"Output YFT light {index} is null.");
            if (!mutationByIndex.TryGetValue(index, out var mutation))
            {
                if (!Fingerprint(after).Equals(Fingerprint(before), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Unowned YFT light changed at index {index}.");
                continue;
            }
            ValidateSha256(mutation.ExpectedFingerprint, "expectedFingerprint");
            if (!Fingerprint(before).Equals(mutation.ExpectedFingerprint, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YFT base fingerprint changed at index {index}.");
            if (!ImmutableFingerprint(after).Equals(
                ImmutableFingerprint(before),
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YFT immutable fields changed at index {index}.");
            AssertMutation(after, mutation);
        }
        return new
        {
            status = "ready",
            mode = "lamp-verify",
            edition = "legacy",
            inputSha256,
            outputSha256 = Sha256(outputBytes),
            verifiedLightIndices = mutations.Select(item => item.LightIndex).Order().ToArray(),
            validation = new
            {
                reopened = true,
                exactInputSha256 = true,
                exactLightFingerprints = true,
                lightTopologyPreserved = true,
                immutableFieldsPreserved = true,
                unownedLightsPreserved = true,
            },
        };
    }

    public static IReadOnlyList<LampEntityOccurrence> ScanYmapOccurrences(
        byte[] bytes,
        string ymapEntry,
        IReadOnlyDictionary<uint, string> archetypes)
    {
        RpfManager.IsGen9 = false;
        // A small number of vanilla maps are stored as PSO (PSIN), not RSC7
        // Meta resources. CodeWalker's YmapFile does not materialize PSO map
        // entities. A target archetype is nevertheless always a uint hash in
        // CEntityDef, so an endian-independent byte scan can safely prove
        // absence. Presence remains fail-closed until a typed PSO entity
        // decoder is added; it must never be treated as an occurrence with
        // guessed coordinates.
        using (var stream = new MemoryStream(bytes, writable: false))
        {
            if (PsoFile.IsPSO(stream))
            {
                var hits = archetypes.Keys
                    .Where(hash => ContainsUInt32EitherEndian(bytes, hash))
                    .Select(hash => $"0x{hash:X8}")
                    .Order(StringComparer.Ordinal)
                    .ToArray();
                if (hits.Length == 0) return [];
                throw new InvalidDataException(
                    $"PSO YMAP contains requested archetype hashes ({string.Join(", ", hits)}); " +
                    "typed occurrence decoding is required.");
            }
        }
        var file = new YmapFile();
        file.Load(bytes);
        var matches = new List<LampEntityOccurrence>();
        foreach (var entity in file.AllEntities ?? [])
        {
            var hash = entity.CEntityDef.archetypeName.Hash;
            if (!archetypes.TryGetValue(hash, out var archetypeName)) continue;
            var position = entity.Position;
            var rotation = entity.Orientation;
            var scale = entity.Scale;
            matches.Add(new LampEntityOccurrence(
                ymapEntry,
                entity.Index,
                archetypeName,
                $"0x{hash:X8}",
                $"0x{entity.EntityHash:X8}",
                Finite(position.X, "entity.position.x"),
                Finite(position.Y, "entity.position.y"),
                Finite(position.Z, "entity.position.z"),
                Finite(rotation.X, "entity.rotation.x"),
                Finite(rotation.Y, "entity.rotation.y"),
                Finite(rotation.Z, "entity.rotation.z"),
                Finite(rotation.W, "entity.rotation.w"),
                Finite(scale.X, "entity.scale.x"),
                Finite(scale.Y, "entity.scale.y"),
                Finite(scale.Z, "entity.scale.z")));
        }
        return matches;
    }

    private static bool ContainsUInt32EitherEndian(byte[] bytes, uint value)
    {
        var little0 = (byte)value;
        var little1 = (byte)(value >> 8);
        var little2 = (byte)(value >> 16);
        var little3 = (byte)(value >> 24);
        for (var index = 0; index <= bytes.Length - sizeof(uint); index++)
        {
            if ((bytes[index] == little0 &&
                 bytes[index + 1] == little1 &&
                 bytes[index + 2] == little2 &&
                 bytes[index + 3] == little3) ||
                (bytes[index] == little3 &&
                 bytes[index + 1] == little2 &&
                 bytes[index + 2] == little1 &&
                 bytes[index + 3] == little0))
                return true;
        }
        return false;
    }

    public static IReadOnlyList<LampDistantLightCandidate> ScanYmapDistantCandidates(
        byte[] bytes,
        string ymapEntry,
        IReadOnlyList<LampWorldAnchor> anchors,
        float maximumDistance)
    {
        RpfManager.IsGen9 = false;
        var file = new YmapFile();
        file.Load(bytes);
        var positions = file.DistantLODLights?.positions ?? [];
        var colors = file.DistantLODLights?.colours ?? [];
        if (positions.Length != colors.Length)
            throw new InvalidDataException("YMAP distant position/RGBI arrays are not aligned.");
        var maximumDistanceSquared = maximumDistance * maximumDistance;
        var matches = new List<LampDistantLightCandidate>();
        for (var index = 0; index < positions.Length; index++)
        {
            var position = positions[index].ToVector3();
            foreach (var anchor in anchors)
            {
                var dx = position.X - anchor.X;
                var dy = position.Y - anchor.Y;
                var dz = position.Z - anchor.Z;
                var distanceSquared = dx * dx + dy * dy + dz * dz;
                if (!float.IsFinite(distanceSquared) || distanceSquared > maximumDistanceSquared)
                    continue;
                var packed = colors[index];
                matches.Add(new LampDistantLightCandidate(
                    anchor.AnchorId,
                    ymapEntry,
                    index,
                    MathF.Sqrt(distanceSquared),
                    position.X,
                    position.Y,
                    position.Z,
                    (byte)((packed >> 16) & 0xFF),
                    (byte)((packed >> 8) & 0xFF),
                    (byte)(packed & 0xFF),
                    (byte)((packed >> 24) & 0xFF)));
            }
        }
        return matches;
    }

    public static async Task<object> PatchAsync(
        string? inputFile,
        string? outputFile,
        string? expectedInputSha256,
        IReadOnlyList<LampHdMutation>? mutations)
    {
        var input = RequireInput(inputFile);
        var output = RequireOutput(outputFile, input);
        if (!Path.GetExtension(input).Equals(".yft", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("lamp-patch currently accepts only verified Legacy YFT assets.");
        if (mutations is null || mutations.Count is < 1 or > MaxMutations)
            throw new InvalidDataException($"lamp-patch requires 1-{MaxMutations} mutations.");
        if (mutations.Select(item => item.LightIndex).Distinct().Count() != mutations.Count)
            throw new InvalidDataException("Each lamp light index may be mutated only once.");
        ValidateSha256(expectedInputSha256, "expectedInputSha256");

        RpfManager.IsGen9 = false;
        var inputBytes = await File.ReadAllBytesAsync(input);
        var inputSha256 = Sha256(inputBytes);
        if (!inputSha256.Equals(expectedInputSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Lamp input SHA-256 does not match the approved plan.");

        var file = LoadYft(inputBytes);
        var lights = file.Fragment?.LightAttributes?.data_items
            ?? throw new InvalidDataException("YFT has no fragment light array.");
        var before = lights.Select(light => new
        {
            Fingerprint = Fingerprint(light),
            ImmutableFingerprint = ImmutableFingerprint(light),
        }).ToArray();
        foreach (var mutation in mutations.OrderBy(item => item.LightIndex))
        {
            if (mutation.LightIndex < 0 || mutation.LightIndex >= lights.Length)
                throw new InvalidDataException($"YFT light index is out of range: {mutation.LightIndex}.");
            ValidateSha256(mutation.ExpectedFingerprint, "expectedFingerprint");
            var light = lights[mutation.LightIndex]
                ?? throw new InvalidDataException($"YFT light {mutation.LightIndex} is null.");
            if (!Fingerprint(light).Equals(mutation.ExpectedFingerprint, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YFT light fingerprint changed at index {mutation.LightIndex}.");
            ApplyMutation(light, mutation);
        }

        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var staged = $"{output}.lamp-{Guid.NewGuid():N}";
        try
        {
            var outputBytes = file.Save();
            await File.WriteAllBytesAsync(staged, outputBytes);
            var reopenedBytes = await File.ReadAllBytesAsync(staged);
            var reopened = LoadYft(reopenedBytes);
            var reopenedLights = reopened.Fragment?.LightAttributes?.data_items
                ?? throw new InvalidDataException("Patched YFT lost its fragment light array.");
            if (reopenedLights.Length != before.Length)
                throw new InvalidDataException("Patched YFT changed the light array topology.");

            var mutationByIndex = mutations.ToDictionary(item => item.LightIndex);
            for (var index = 0; index < reopenedLights.Length; index++)
            {
                var current = reopenedLights[index]
                    ?? throw new InvalidDataException($"Patched YFT light {index} is null.");
                if (!mutationByIndex.TryGetValue(index, out var mutation))
                {
                    if (!Fingerprint(current).Equals(before[index].Fingerprint, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException($"Unowned YFT light changed at index {index}.");
                    continue;
                }
                if (!ImmutableFingerprint(current).Equals(
                    before[index].ImmutableFingerprint,
                    StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException(
                        $"YFT immutable light fields changed at index {index}.");
                }
                AssertMutation(current, mutation);
            }
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }

        var finalBytes = await File.ReadAllBytesAsync(output);
        var finalFile = LoadYft(finalBytes);
        return new
        {
            status = "ready",
            mode = "lamp-patch",
            edition = "legacy",
            input,
            output,
            inputSha256,
            outputSha256 = Sha256(finalBytes),
            outputBytes = finalBytes.Length,
            mutatedLightIndices = mutations.Select(item => item.LightIndex).Order().ToArray(),
            inventory = InspectYftFile(finalFile),
            validation = new
            {
                reopened = true,
                exactInputSha256 = true,
                exactLightFingerprints = true,
                lightTopologyPreserved = true,
                immutableFieldsPreserved = true,
                atomicOutput = true,
            },
        };
    }

    public static async Task<object> PatchLodPairAsync(
        string? lodInputFile,
        string? distantInputFile,
        string? lodOutputFile,
        string? distantOutputFile,
        string? expectedLodInputSha256,
        string? expectedDistantInputSha256,
        IReadOnlyList<LampLodMutation>? mutations)
    {
        var lodInput = RequireYmapInput(lodInputFile, "LOD input");
        var distantInput = RequireYmapInput(distantInputFile, "distant input");
        var lodOutput = RequireNewYmapOutput(lodOutputFile, lodInput, "LOD output");
        var distantOutput = RequireNewYmapOutput(distantOutputFile, distantInput, "distant output");
        if (!string.Equals(
            Path.GetDirectoryName(lodOutput),
            Path.GetDirectoryName(distantOutput),
            StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("LOD pair outputs must share one staging directory.");
        }
        ValidateSha256(expectedLodInputSha256, "expectedLodInputSha256");
        ValidateSha256(expectedDistantInputSha256, "expectedDistantInputSha256");
        if (mutations is null || mutations.Count is < 1 or > 4096)
            throw new InvalidDataException("lamp-lod-patch requires 1-4096 mutations.");
        if (mutations.Select(item => item.AlignedLightIndex).Distinct().Count() != mutations.Count)
            throw new InvalidDataException("Each aligned LOD index may be mutated only once.");

        RpfManager.IsGen9 = false;
        var lodInputBytes = await File.ReadAllBytesAsync(lodInput);
        var distantInputBytes = await File.ReadAllBytesAsync(distantInput);
        var lodInputSha256 = Sha256(lodInputBytes);
        var distantInputSha256 = Sha256(distantInputBytes);
        if (!lodInputSha256.Equals(expectedLodInputSha256, StringComparison.OrdinalIgnoreCase) ||
            !distantInputSha256.Equals(expectedDistantInputSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("LOD pair input SHA-256 does not match the approved plan.");

        var lodFile = LoadYmap(lodInputBytes, lodInput);
        var distantFile = LoadYmap(distantInputBytes, distantInput);
        var count = ValidateDedicatedLodPair(lodFile, distantFile);
        var lodEnvelopeValuesBefore = YmapEnvelopeValues(lodFile);
        var distantEnvelopeValuesBefore = YmapEnvelopeValues(distantFile);
        var lodEnvelopeBefore = HashObject(lodEnvelopeValuesBefore);
        var distantEnvelopeBefore = HashObject(distantEnvelopeValuesBefore);
        var before = Enumerable.Range(0, count).Select(index => new
        {
            Fingerprint = LodFingerprint(lodFile, distantFile, index),
            ImmutableFingerprint = LodImmutableFingerprint(lodFile, distantFile, index),
        }).ToArray();

        foreach (var mutation in mutations.OrderBy(item => item.AlignedLightIndex))
        {
            var index = mutation.AlignedLightIndex;
            if (index < 0 || index >= count)
                throw new InvalidDataException($"Aligned LOD index is out of range: {index}.");
            ValidateSha256(mutation.ExpectedFingerprint, "expectedFingerprint");
            if (!before[index].Fingerprint.Equals(
                mutation.ExpectedFingerprint,
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"LOD light fingerprint changed at index {index}.");
            ApplyLodMutation(lodFile, distantFile, mutation);
        }

        Directory.CreateDirectory(Path.GetDirectoryName(lodOutput)!);
        var stagedLod = $"{lodOutput}.lamp-lod-{Guid.NewGuid():N}";
        var stagedDistant = $"{distantOutput}.lamp-dist-{Guid.NewGuid():N}";
        var movedLod = false;
        var movedDistant = false;
        try
        {
            // CodeWalker keeps CLOD attributes and CDistant positions in
            // separate sibling YMAPs. Rehydrate the aligned editor objects so
            // YmapFile.Save() rebuilds the CLOD SOA instead of clearing it.
            lodFile.LODLights!.BuildLodLights(distantFile.DistantLODLights!);
            await File.WriteAllBytesAsync(stagedLod, lodFile.Save());
            await File.WriteAllBytesAsync(stagedDistant, distantFile.Save());
            var reopenedLod = LoadYmap(await File.ReadAllBytesAsync(stagedLod), lodOutput);
            var reopenedDistant = LoadYmap(
                await File.ReadAllBytesAsync(stagedDistant),
                distantOutput);
            if (ValidateDedicatedLodPair(reopenedLod, reopenedDistant) != count)
                throw new InvalidDataException("Patched LOD pair changed aligned array topology.");
            var reopenedLodEnvelope = YmapEnvelopeValues(reopenedLod);
            var reopenedDistantEnvelope = YmapEnvelopeValues(reopenedDistant);
            if (!HashObject(reopenedLodEnvelope).Equals(
                    lodEnvelopeBefore,
                    StringComparison.OrdinalIgnoreCase) ||
                !HashObject(reopenedDistantEnvelope).Equals(
                    distantEnvelopeBefore,
                    StringComparison.OrdinalIgnoreCase))
            {
                static IEnumerable<string> Diff(
                    IReadOnlyDictionary<string, string> beforeValues,
                    IReadOnlyDictionary<string, string> afterValues,
                    string prefix) => beforeValues.Keys.Union(afterValues.Keys)
                        .Where(key => !beforeValues.TryGetValue(key, out var before) ||
                            !afterValues.TryGetValue(key, out var after) || before != after)
                        .Select(key => $"{prefix}.{key}");
                var changed = Diff(lodEnvelopeValuesBefore, reopenedLodEnvelope, "lod")
                    .Concat(Diff(
                        distantEnvelopeValuesBefore,
                        reopenedDistantEnvelope,
                        "distant"))
                    .Order(StringComparer.Ordinal)
                    .ToArray();
                throw new InvalidDataException(
                    $"Patched LOD pair changed non-light envelope fields: {string.Join(", ", changed)}.");
            }
            var mutationByIndex = mutations.ToDictionary(item => item.AlignedLightIndex);
            for (var index = 0; index < count; index++)
            {
                if (!mutationByIndex.TryGetValue(index, out var mutation))
                {
                    if (!LodFingerprint(reopenedLod, reopenedDistant, index).Equals(
                        before[index].Fingerprint,
                        StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException($"Unowned LOD light changed at index {index}.");
                    continue;
                }
                if (!LodImmutableFingerprint(reopenedLod, reopenedDistant, index).Equals(
                    before[index].ImmutableFingerprint,
                    StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Immutable LOD fields changed at index {index}.");
                AssertLodMutation(reopenedLod, reopenedDistant, mutation);
            }
            File.Move(stagedLod, lodOutput, overwrite: false);
            movedLod = true;
            File.Move(stagedDistant, distantOutput, overwrite: false);
            movedDistant = true;
        }
        catch
        {
            if (File.Exists(stagedLod)) File.Delete(stagedLod);
            if (File.Exists(stagedDistant)) File.Delete(stagedDistant);
            if (movedLod && File.Exists(lodOutput)) File.Delete(lodOutput);
            if (movedDistant && File.Exists(distantOutput)) File.Delete(distantOutput);
            throw;
        }

        var finalLodBytes = await File.ReadAllBytesAsync(lodOutput);
        var finalDistantBytes = await File.ReadAllBytesAsync(distantOutput);
        return new
        {
            status = "ready",
            mode = "lamp-lod-patch",
            edition = "legacy",
            inputs = new
            {
                lod = new { path = lodInput, sha256 = lodInputSha256 },
                distant = new { path = distantInput, sha256 = distantInputSha256 },
            },
            outputs = new
            {
                lod = new { path = lodOutput, sha256 = Sha256(finalLodBytes), bytes = finalLodBytes.Length },
                distant = new { path = distantOutput, sha256 = Sha256(finalDistantBytes), bytes = finalDistantBytes.Length },
            },
            mutatedAlignedLightIndices = mutations.Select(item => item.AlignedLightIndex).Order().ToArray(),
            validation = new
            {
                reopened = true,
                exactInputSha256 = true,
                exactLightFingerprints = true,
                alignedTopologyPreserved = true,
                immutableFieldsPreserved = true,
                nonLightEnvelopePreserved = true,
                stagingOnly = true,
            },
        };
    }

    public static async Task<object> InspectLodPairAsync(
        string? lodInputFile,
        string? distantInputFile)
    {
        var lodInput = RequireYmapInput(lodInputFile, "LOD input");
        var distantInput = RequireYmapInput(distantInputFile, "distant input");
        RpfManager.IsGen9 = false;
        var lodBytes = await File.ReadAllBytesAsync(lodInput);
        var distantBytes = await File.ReadAllBytesAsync(distantInput);
        var lodFile = LoadYmap(lodBytes, lodInput);
        var distantFile = LoadYmap(distantBytes, distantInput);
        var count = ValidateDedicatedLodPair(lodFile, distantFile);
        var lod = lodFile.LODLights!;
        var distant = distantFile.DistantLODLights!;
        return new
        {
            status = "ready",
            mode = "lamp-lod-inspect-pair",
            edition = "legacy",
            inputs = new
            {
                lod = new { path = lodInput, sha256 = Sha256(lodBytes), bytes = lodBytes.Length },
                distant = new { path = distantInput, sha256 = Sha256(distantBytes), bytes = distantBytes.Length },
            },
            alignedLightCount = count,
            lights = Enumerable.Range(0, count).Select(index =>
            {
                var packed = distant.colours[index];
                return new
                {
                    alignedLightIndex = index,
                    fingerprint = LodFingerprint(lodFile, distantFile, index),
                    immutableFingerprint = LodImmutableFingerprint(lodFile, distantFile, index),
                    position = Vector(distant.positions[index]),
                    direction = Vector(lod.direction[index]),
                    color = new
                    {
                        r = (byte)((packed >> 16) & 0xFF),
                        g = (byte)((packed >> 8) & 0xFF),
                        b = (byte)(packed & 0xFF),
                    },
                    intensity = (byte)(packed >> 24),
                    falloff = Finite(lod.falloff[index], "lod.falloff"),
                    falloffExponent = Finite(
                        lod.falloffExponent[index],
                        "lod.falloffExponent"),
                    timeAndStateFlags = lod.timeAndStateFlags[index],
                    hash = $"0x{lod.hash[index]:X8}",
                    coneInnerAngle = lod.coneInnerAngle[index],
                    coneOuterAngleOrCapExt = lod.coneOuterAngleOrCapExt[index],
                    coronaIntensity = lod.coronaIntensity[index],
                };
            }).ToArray(),
            validation = new
            {
                dedicatedLightOnlyMaps = true,
                exactlyAligned = true,
                nonLightEnvelopeFingerprints = new
                {
                    lod = YmapEnvelopeFingerprint(lodFile),
                    distant = YmapEnvelopeFingerprint(distantFile),
                },
            },
        };
    }

    public static async Task<object> PlanLodPairAsync(
        string? lodInputFile,
        string? distantInputFile,
        string? expectedLodInputSha256,
        string? expectedDistantInputSha256,
        IReadOnlyList<LampLodMutation>? mutations)
    {
        var lodInput = RequireYmapInput(lodInputFile, "LOD input");
        var distantInput = RequireYmapInput(distantInputFile, "distant input");
        ValidateSha256(expectedLodInputSha256, "expectedLodInputSha256");
        ValidateSha256(expectedDistantInputSha256, "expectedDistantInputSha256");
        if (mutations is null || mutations.Count is < 1 or > 4096)
            throw new InvalidDataException("lamp-plan requires 1-4096 LOD mutations.");
        if (mutations.Select(item => item.AlignedLightIndex).Distinct().Count() != mutations.Count)
            throw new InvalidDataException("Each aligned LOD index may be planned only once.");

        RpfManager.IsGen9 = false;
        var lodBytes = await File.ReadAllBytesAsync(lodInput);
        var distantBytes = await File.ReadAllBytesAsync(distantInput);
        var lodSha256 = Sha256(lodBytes);
        var distantSha256 = Sha256(distantBytes);
        if (!lodSha256.Equals(expectedLodInputSha256, StringComparison.OrdinalIgnoreCase) ||
            !distantSha256.Equals(expectedDistantInputSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("LOD plan input SHA-256 does not match the approved base.");
        var lodFile = LoadYmap(lodBytes, lodInput);
        var distantFile = LoadYmap(distantBytes, distantInput);
        var count = ValidateDedicatedLodPair(lodFile, distantFile);
        foreach (var mutation in mutations.OrderBy(item => item.AlignedLightIndex))
        {
            var index = mutation.AlignedLightIndex;
            if (index < 0 || index >= count)
                throw new InvalidDataException($"Aligned LOD index is out of range: {index}.");
            ValidateSha256(mutation.ExpectedFingerprint, "expectedFingerprint");
            if (!LodFingerprint(lodFile, distantFile, index).Equals(
                mutation.ExpectedFingerprint,
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"LOD light fingerprint changed at index {index}.");
            var immutable = LodImmutableFingerprint(lodFile, distantFile, index);
            ApplyLodMutation(lodFile, distantFile, mutation);
            AssertLodMutation(lodFile, distantFile, mutation);
            if (!LodImmutableFingerprint(lodFile, distantFile, index).Equals(
                immutable,
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Planned LOD mutation owns immutable fields at index {index}.");
        }
        return new
        {
            status = "ready",
            mode = "lamp-plan",
            edition = "legacy",
            inputs = new
            {
                lod = new { path = lodInput, sha256 = lodSha256 },
                distant = new { path = distantInput, sha256 = distantSha256 },
            },
            plannedAlignedLightIndices = mutations
                .Select(item => item.AlignedLightIndex)
                .Order()
                .ToArray(),
            validation = new
            {
                readOnly = true,
                exactInputSha256 = true,
                exactLightFingerprints = true,
                alignedTopologyPreserved = true,
                immutableFieldsPreserved = true,
            },
        };
    }

    public static async Task<object> VerifyLodPairAsync(
        string? lodInputFile,
        string? distantInputFile,
        string? lodOutputFile,
        string? distantOutputFile,
        string? expectedLodInputSha256,
        string? expectedDistantInputSha256,
        IReadOnlyList<LampLodMutation>? mutations)
    {
        var lodInput = RequireYmapInput(lodInputFile, "LOD input");
        var distantInput = RequireYmapInput(distantInputFile, "distant input");
        var lodOutput = RequireYmapInput(lodOutputFile, "LOD output");
        var distantOutput = RequireYmapInput(distantOutputFile, "distant output");
        if (lodInput.Equals(lodOutput, StringComparison.OrdinalIgnoreCase) ||
            distantInput.Equals(distantOutput, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("lamp-verify LOD inputs and outputs must differ.");
        ValidateSha256(expectedLodInputSha256, "expectedLodInputSha256");
        ValidateSha256(expectedDistantInputSha256, "expectedDistantInputSha256");
        if (mutations is null || mutations.Count is < 1 or > 4096)
            throw new InvalidDataException("lamp-verify requires 1-4096 LOD mutations.");
        if (mutations.Select(item => item.AlignedLightIndex).Distinct().Count() != mutations.Count)
            throw new InvalidDataException("Each aligned LOD index may be verified only once.");

        RpfManager.IsGen9 = false;
        var lodInputBytes = await File.ReadAllBytesAsync(lodInput);
        var distantInputBytes = await File.ReadAllBytesAsync(distantInput);
        var lodOutputBytes = await File.ReadAllBytesAsync(lodOutput);
        var distantOutputBytes = await File.ReadAllBytesAsync(distantOutput);
        var lodInputSha256 = Sha256(lodInputBytes);
        var distantInputSha256 = Sha256(distantInputBytes);
        if (!lodInputSha256.Equals(expectedLodInputSha256, StringComparison.OrdinalIgnoreCase) ||
            !distantInputSha256.Equals(expectedDistantInputSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("LOD verify input SHA-256 does not match the approved base.");

        var beforeLod = LoadYmap(lodInputBytes, lodInput);
        var beforeDistant = LoadYmap(distantInputBytes, distantInput);
        var afterLod = LoadYmap(lodOutputBytes, lodOutput);
        var afterDistant = LoadYmap(distantOutputBytes, distantOutput);
        var count = ValidateDedicatedLodPair(beforeLod, beforeDistant);
        if (ValidateDedicatedLodPair(afterLod, afterDistant) != count)
            throw new InvalidDataException("Verified LOD pair changed aligned array topology.");
        if (!YmapEnvelopeFingerprint(beforeLod).Equals(
                YmapEnvelopeFingerprint(afterLod),
                StringComparison.OrdinalIgnoreCase) ||
            !YmapEnvelopeFingerprint(beforeDistant).Equals(
                YmapEnvelopeFingerprint(afterDistant),
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Verified LOD pair changed non-light envelope fields.");

        var mutationByIndex = mutations.ToDictionary(item => item.AlignedLightIndex);
        for (var index = 0; index < count; index++)
        {
            if (!mutationByIndex.TryGetValue(index, out var mutation))
            {
                if (!LodFingerprint(afterLod, afterDistant, index).Equals(
                    LodFingerprint(beforeLod, beforeDistant, index),
                    StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Unowned LOD light changed at index {index}.");
                continue;
            }
            ValidateSha256(mutation.ExpectedFingerprint, "expectedFingerprint");
            if (!LodFingerprint(beforeLod, beforeDistant, index).Equals(
                mutation.ExpectedFingerprint,
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"LOD base fingerprint changed at index {index}.");
            if (!LodImmutableFingerprint(afterLod, afterDistant, index).Equals(
                LodImmutableFingerprint(beforeLod, beforeDistant, index),
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Immutable LOD fields changed at index {index}.");
            AssertLodMutation(afterLod, afterDistant, mutation);
        }
        return new
        {
            status = "ready",
            mode = "lamp-verify",
            edition = "legacy",
            inputs = new
            {
                lod = new { path = lodInput, sha256 = lodInputSha256 },
                distant = new { path = distantInput, sha256 = distantInputSha256 },
            },
            outputs = new
            {
                lod = new { path = lodOutput, sha256 = Sha256(lodOutputBytes) },
                distant = new { path = distantOutput, sha256 = Sha256(distantOutputBytes) },
            },
            verifiedAlignedLightIndices = mutations
                .Select(item => item.AlignedLightIndex)
                .Order()
                .ToArray(),
            validation = new
            {
                reopened = true,
                exactInputSha256 = true,
                exactLightFingerprints = true,
                alignedTopologyPreserved = true,
                immutableFieldsPreserved = true,
                nonLightEnvelopePreserved = true,
                unownedLightsPreserved = true,
            },
        };
    }

    private static YmapFile LoadYmap(byte[] bytes, string sourcePath)
    {
        var file = new YmapFile();
        file.Load(bytes);
        if (file.Meta is null) throw new InvalidDataException("Invalid Legacy YMAP meta resource.");
        // The raw-resource overload cannot infer the RPF entry name. YmapFile.Save()
        // deliberately hashes Name back into CMapData.name, so leaving it null
        // would silently replace the map identity with the hash of an empty name.
        file.Name = Path.GetFileName(sourcePath);
        return file;
    }

    private static int ValidateDedicatedLodPair(YmapFile lodFile, YmapFile distantFile)
    {
        static void RequireEmptyMapPayload(YmapFile file, string label)
        {
            var map = file.CMapData;
            if ((file.AllEntities?.Length ?? 0) != 0 ||
                (file.CarGenerators?.Length ?? 0) != 0 ||
                (file.TimeCycleModifiers?.Length ?? 0) != 0 ||
                (file.GrassInstanceBatches?.Length ?? 0) != 0 ||
                (file.BoxOccluders?.Length ?? 0) != 0 ||
                (file.OccludeModels?.Length ?? 0) != 0 ||
                (file.physicsDictionaries?.Length ?? 0) != 0 ||
                map.containerLods.Count1 != 0 ||
                map.instancedData.PropInstanceList.Count1 != 0)
            {
                throw new InvalidDataException(
                    $"{label} is not a dedicated light-only YMAP and cannot use the V1 safe writer.");
            }
        }
        RequireEmptyMapPayload(lodFile, "LOD input");
        RequireEmptyMapPayload(distantFile, "Distant input");
        var lod = lodFile.LODLights
            ?? throw new InvalidDataException("LOD input has no CLODLight arrays.");
        var distant = distantFile.DistantLODLights
            ?? throw new InvalidDataException("Distant input has no CDistantLODLight arrays.");
        if (lodFile.DistantLODLights is not null || distantFile.LODLights is not null)
            throw new InvalidDataException("LOD pair files contain mixed HD/distant arrays.");
        var counts = new[]
        {
            lod.direction?.Length ?? 0,
            lod.falloff?.Length ?? 0,
            lod.falloffExponent?.Length ?? 0,
            lod.timeAndStateFlags?.Length ?? 0,
            lod.hash?.Length ?? 0,
            lod.coneInnerAngle?.Length ?? 0,
            lod.coneOuterAngleOrCapExt?.Length ?? 0,
            lod.coronaIntensity?.Length ?? 0,
            distant.positions?.Length ?? 0,
            distant.colours?.Length ?? 0,
        };
        if (counts[0] == 0 || counts.Any(count => count != counts[0]))
            throw new InvalidDataException("LOD/distant SOA arrays are not exactly aligned.");
        return counts[0];
    }

    private static string YmapEnvelopeFingerprint(YmapFile file) =>
        HashObject(YmapEnvelopeValues(file));

    private static IReadOnlyDictionary<string, string> YmapEnvelopeValues(YmapFile file)
    {
        var map = file.CMapData;
        static string Bits(float value) => $"0x{BitConverter.SingleToInt32Bits(value):X8}";
        static string Vec(SharpDX.Vector3 value) =>
            $"{Bits(value.X)},{Bits(value.Y)},{Bits(value.Z)}";
        return new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["unused0"] = map.Unused0.ToString(CultureInfo.InvariantCulture),
            ["unused1"] = map.Unused1.ToString(CultureInfo.InvariantCulture),
            ["name"] = $"0x{map.name.Hash:X8}",
            ["parent"] = $"0x{map.parent.Hash:X8}",
            ["flags"] = map.flags.ToString(CultureInfo.InvariantCulture),
            ["contentFlags"] = map.contentFlags.ToString(CultureInfo.InvariantCulture),
            ["unused2"] = map.Unused2.ToString(CultureInfo.InvariantCulture),
            ["unused3"] = map.Unused3.ToString(CultureInfo.InvariantCulture),
            ["streamingExtentsMin"] = Vec(map.streamingExtentsMin),
            ["unused4"] = Bits(map.Unused4),
            ["streamingExtentsMax"] = Vec(map.streamingExtentsMax),
            ["unused5"] = Bits(map.Unused5),
            ["entitiesExtentsMin"] = Vec(map.entitiesExtentsMin),
            ["unused6"] = Bits(map.Unused6),
            ["entitiesExtentsMax"] = Vec(map.entitiesExtentsMax),
            ["unused7"] = Bits(map.Unused7),
            ["entities"] = map.entities.Count1.ToString(CultureInfo.InvariantCulture),
            ["containerLods"] = map.containerLods.Count1.ToString(CultureInfo.InvariantCulture),
            ["boxOccluders"] = map.boxOccluders.Count1.ToString(CultureInfo.InvariantCulture),
            ["occludeModels"] = map.occludeModels.Count1.ToString(CultureInfo.InvariantCulture),
            ["physicsDictionaries"] = map.physicsDictionaries.Count1.ToString(CultureInfo.InvariantCulture),
            ["propInstances"] = map.instancedData.PropInstanceList.Count1.ToString(CultureInfo.InvariantCulture),
            ["grassInstances"] = map.instancedData.GrassInstanceList.Count1.ToString(CultureInfo.InvariantCulture),
            ["timeCycleModifiers"] = map.timeCycleModifiers.Count1.ToString(CultureInfo.InvariantCulture),
            ["carGenerators"] = map.carGenerators.Count1.ToString(CultureInfo.InvariantCulture),
            ["distantNumStreetLights"] = file.DistantLODLights is null
                ? "absent"
                : file.DistantLODLights.CDistantLODLight.numStreetLights
                    .ToString(CultureInfo.InvariantCulture),
            ["distantCategory"] = file.DistantLODLights is null
                ? "absent"
                : file.DistantLODLights.CDistantLODLight.category
                    .ToString(CultureInfo.InvariantCulture),
        };
    }

    private static string LodFingerprint(YmapFile lodFile, YmapFile distantFile, int index)
    {
        var lod = lodFile.LODLights!;
        var distant = distantFile.DistantLODLights!;
        return HashObject(new
        {
            immutable = LodImmutableDescriptor(lodFile, distantFile, index),
            falloff = Finite(lod.falloff[index], "lod.falloff"),
            falloffExponent = Finite(
                lod.falloffExponent[index],
                "lod.falloffExponent"),
            coronaIntensity = lod.coronaIntensity[index],
            rgbi = distant.colours[index],
        });
    }

    private static string LodImmutableFingerprint(YmapFile lodFile, YmapFile distantFile, int index) =>
        HashObject(LodImmutableDescriptor(lodFile, distantFile, index));

    private static object LodImmutableDescriptor(YmapFile lodFile, YmapFile distantFile, int index)
    {
        var lod = lodFile.LODLights!;
        var distant = distantFile.DistantLODLights!;
        return new
        {
            direction = Vector(lod.direction[index]),
            timeAndStateFlags = lod.timeAndStateFlags[index],
            hash = lod.hash[index],
            coneInnerAngle = lod.coneInnerAngle[index],
            coneOuterAngleOrCapExt = lod.coneOuterAngleOrCapExt[index],
            position = Vector(distant.positions[index]),
        };
    }

    private static void ApplyLodMutation(
        YmapFile lodFile,
        YmapFile distantFile,
        LampLodMutation mutation)
    {
        var index = mutation.AlignedLightIndex;
        var lod = lodFile.LODLights!;
        var distant = distantFile.DistantLODLights!;
        SetFinite(mutation.Falloff, value => lod.falloff[index] = value, "lod.falloff", 0.01f, 10_000);
        SetFinite(
            mutation.FalloffExponent,
            value => lod.falloffExponent[index] = value,
            "lod.falloffExponent",
            0.01f,
            128);
        if (mutation.CoronaIntensity is byte corona) lod.coronaIntensity[index] = corona;
        var packed = distant.colours[index];
        var intensity = mutation.Intensity ?? (byte)((packed >> 24) & 0xFF);
        var color = mutation.Color ?? new LampRgb(
            (byte)((packed >> 16) & 0xFF),
            (byte)((packed >> 8) & 0xFF),
            (byte)(packed & 0xFF));
        distant.colours[index] =
            ((uint)intensity << 24) |
            ((uint)color.R << 16) |
            ((uint)color.G << 8) |
            color.B;
    }

    private static void AssertLodMutation(
        YmapFile lodFile,
        YmapFile distantFile,
        LampLodMutation mutation)
    {
        var index = mutation.AlignedLightIndex;
        var lod = lodFile.LODLights!;
        var packed = distantFile.DistantLODLights!.colours[index];
        AssertOptional(mutation.Falloff, lod.falloff[index], "lod.falloff");
        AssertOptional(mutation.FalloffExponent, lod.falloffExponent[index], "lod.falloffExponent");
        if (mutation.CoronaIntensity is byte corona && lod.coronaIntensity[index] != corona)
            throw new InvalidDataException("Patched LOD failed exact corona verification.");
        if (mutation.Intensity is byte intensity && (byte)(packed >> 24) != intensity)
            throw new InvalidDataException("Patched LOD failed exact intensity verification.");
        if (mutation.Color is not null &&
            ((byte)(packed >> 16) != mutation.Color.R ||
             (byte)(packed >> 8) != mutation.Color.G ||
             (byte)packed != mutation.Color.B))
            throw new InvalidDataException("Patched LOD failed exact RGB verification.");
    }

    private static object InspectYft(byte[] bytes) => InspectYftFile(LoadYft(bytes));

    private static object InspectYftFile(YftFile file)
    {
        var lights = file.Fragment?.LightAttributes?.data_items ?? [];
        var bones = file.Fragment?.Drawable?.Skeleton?.BonesMap;
        return new
        {
            assetKind = "yft-fragment",
            lightArrayOwner = "FragType.LightAttributes",
            lightCount = lights.Length,
            lights = lights.Select((light, index) =>
            {
                var transform = SharpDX.Matrix.Identity;
                if (light is not null && bones is not null &&
                    bones.TryGetValue(light.BoneId, out var bone))
                {
                    transform = bone.AbsTransform;
                }
                var modelPosition = light is null
                    ? (SharpDX.Vector3?)null
                    : transform.Multiply(light.Position);
                return DescribeHdLight(light, index, modelPosition);
            }).ToArray(),
        };
    }

    private static object InspectYdr(byte[] bytes)
    {
        var file = new YdrFile();
        file.Load(bytes);
        var lights = file.Drawable?.LightAttributes?.data_items ?? [];
        return new
        {
            assetKind = "ydr-drawable",
            lightCount = lights.Length,
            lights = lights.Select((light, index) => DescribeHdLight(light, index)).ToArray(),
        };
    }

    private static object InspectYdd(byte[] bytes)
    {
        var file = new YddFile();
        file.Load(bytes);
        var hashes = file.DrawableDict?.Hashes ?? [];
        var drawables = file.DrawableDict?.Drawables?.data_items ?? [];
        var count = Math.Min(hashes.Length, drawables.Length);
        return new
        {
            assetKind = "ydd-dictionary",
            drawableCount = count,
            drawables = Enumerable.Range(0, count).Select(index =>
            {
                var lights = drawables[index]?.LightAttributes?.data_items ?? [];
                return new
                {
                    drawableIndex = index,
                    drawableHash = $"0x{hashes[index]:X8}",
                    lightCount = lights.Length,
                    lights = lights.Select((light, lightIndex) => DescribeHdLight(light, lightIndex)).ToArray(),
                };
            }).ToArray(),
        };
    }

    private static object InspectYmap(byte[] bytes)
    {
        var file = new YmapFile();
        file.Load(bytes);
        var lod = file.LODLights;
        var distant = file.DistantLODLights;
        var counts = new Dictionary<string, int>
        {
            ["direction"] = lod?.direction?.Length ?? 0,
            ["falloff"] = lod?.falloff?.Length ?? 0,
            ["falloffExponent"] = lod?.falloffExponent?.Length ?? 0,
            ["timeAndStateFlags"] = lod?.timeAndStateFlags?.Length ?? 0,
            ["hash"] = lod?.hash?.Length ?? 0,
            ["coneInnerAngle"] = lod?.coneInnerAngle?.Length ?? 0,
            ["coneOuterAngleOrCapExt"] = lod?.coneOuterAngleOrCapExt?.Length ?? 0,
            ["coronaIntensity"] = lod?.coronaIntensity?.Length ?? 0,
            ["position"] = distant?.positions?.Length ?? 0,
            ["rgbi"] = distant?.colours?.Length ?? 0,
        };
        var nonZeroLodCounts = counts.Where(pair =>
            pair.Key is not "position" and not "rgbi" && pair.Value > 0).Select(pair => pair.Value).Distinct().ToArray();
        var nonZeroDistantCounts = counts.Where(pair =>
            pair.Key is "position" or "rgbi" && pair.Value > 0).Select(pair => pair.Value).Distinct().ToArray();
        if (nonZeroLodCounts.Length > 1 || nonZeroDistantCounts.Length > 1)
            throw new InvalidDataException("YMAP light SOA arrays are not aligned.");
        return new
        {
            assetKind = "ymap-lod",
            aligned = true,
            counts,
            lod = Enumerable.Range(0, nonZeroLodCounts.FirstOrDefault()).Select(index => new
            {
                index,
                direction = Vector(lod!.direction[index]),
                falloff = Finite(lod.falloff[index], "lod.falloff"),
                falloffExponent = Finite(lod.falloffExponent[index], "lod.falloffExponent"),
                timeAndStateFlags = lod.timeAndStateFlags[index],
                hash = $"0x{lod.hash[index]:X8}",
                coneInnerAngle = lod.coneInnerAngle[index],
                coneOuterAngleOrCapExt = lod.coneOuterAngleOrCapExt[index],
                coronaIntensity = lod.coronaIntensity[index],
            }).ToArray(),
            distant = Enumerable.Range(0, nonZeroDistantCounts.FirstOrDefault()).Select(index =>
            {
                var packed = distant!.colours[index];
                return new
                {
                    index,
                    position = Vector(distant.positions[index]),
                    color = new
                    {
                        r = (byte)((packed >> 16) & 0xFF),
                        g = (byte)((packed >> 8) & 0xFF),
                        b = (byte)(packed & 0xFF),
                    },
                    intensity = (byte)((packed >> 24) & 0xFF),
                    rgbi = $"0x{packed:X8}",
                };
            }).ToArray(),
        };
    }

    private static YftFile LoadYft(byte[] bytes)
    {
        var file = new YftFile();
        file.Load(bytes);
        if (file.Fragment is null)
            throw new InvalidDataException("Invalid Legacy YFT fragment resource.");
        return file;
    }

    private static object DescribeHdLight(
        LightAttributes? light,
        int index = -1,
        SharpDX.Vector3? modelPosition = null)
    {
        if (light is null) throw new InvalidDataException("Light array contains a null item.");
        return new
        {
            index,
            fingerprint = Fingerprint(light),
            immutableFingerprint = ImmutableFingerprint(light),
            boneTag = light.BoneId,
            type = light.Type.ToString().ToLowerInvariant(),
            flags = light.Flags,
            timeFlags = light.TimeFlags,
            position = Vector(light.Position),
            modelPosition = modelPosition.HasValue ? Vector(modelPosition.Value) : null,
            color = new { r = light.ColorR, g = light.ColorG, b = light.ColorB },
            intensity = Finite(light.Intensity, "intensity"),
            falloff = Finite(light.Falloff, "falloff"),
            falloffExponent = Finite(light.FalloffExponent, "falloffExponent"),
            lightFadeDistance = light.LightFadeDistance,
            volume = new
            {
                intensity = Finite(light.VolumeIntensity, "volumeIntensity"),
                sizeScale = Finite(light.VolumeSizeScale, "volumeSizeScale"),
                outerColor = new
                {
                    r = light.VolumeOuterColorR,
                    g = light.VolumeOuterColorG,
                    b = light.VolumeOuterColorB,
                },
                outerIntensity = Finite(light.VolumeOuterIntensity, "volumeOuterIntensity"),
                outerExponent = Finite(light.VolumeOuterExponent, "volumeOuterExponent"),
                fadeDistance = light.VolumetricFadeDistance,
            },
            corona = new
            {
                intensity = Finite(light.CoronaIntensity, "coronaIntensity"),
                size = Finite(light.CoronaSize, "coronaSize"),
                zBias = Finite(light.CoronaZBias, "coronaZBias"),
            },
            direction = Vector(light.Direction),
            tangent = Vector(light.Tangent),
            coneInnerAngle = Finite(light.ConeInnerAngle, "coneInnerAngle"),
            coneOuterAngle = Finite(light.ConeOuterAngle, "coneOuterAngle"),
            extent = Vector(light.Extent),
            projectedTextureHash = $"0x{light.ProjectedTextureHash.Hash:X8}",
        };
    }

    private static string Fingerprint(LightAttributes light) => HashObject(new
    {
        immutable = ImmutableDescriptor(light),
        light.ColorR,
        light.ColorG,
        light.ColorB,
        light.Intensity,
        light.Falloff,
        light.FalloffExponent,
        light.CoronaIntensity,
        light.CoronaSize,
        light.CoronaZBias,
        light.VolumeIntensity,
        light.VolumeSizeScale,
        light.VolumeOuterColorR,
        light.VolumeOuterColorG,
        light.VolumeOuterColorB,
        light.VolumeOuterIntensity,
        light.VolumeOuterExponent,
        light.LightFadeDistance,
        light.VolumetricFadeDistance,
        light.Flags,
    });

    private static string ImmutableFingerprint(LightAttributes light) => HashObject(ImmutableDescriptor(light));

    private static object ImmutableDescriptor(LightAttributes light) => new
    {
        light.Unknown_0h,
        light.Unknown_4h,
        position = Vector(light.Position),
        light.Unknown_14h,
        light.Flashiness,
        light.BoneId,
        type = (byte)light.Type,
        light.GroupId,
        light.TimeFlags,
        cullingPlaneNormal = Vector(light.CullingPlaneNormal),
        light.CullingPlaneOffset,
        light.ShadowBlur,
        light.Unknown_45h,
        light.Unknown_46h,
        light.Unknown_48h,
        light.LightHash,
        light.ShadowFadeDistance,
        light.SpecularFadeDistance,
        light.ShadowNearClip,
        direction = Vector(light.Direction),
        tangent = Vector(light.Tangent),
        light.ConeInnerAngle,
        light.ConeOuterAngle,
        extent = Vector(light.Extent),
        projectedTextureHash = light.ProjectedTextureHash.Hash,
        light.Unknown_A4h,
    };

    private static void ApplyMutation(LightAttributes light, LampHdMutation mutation)
    {
        if (mutation.Color is not null)
            (light.ColorR, light.ColorG, light.ColorB) =
                (mutation.Color.R, mutation.Color.G, mutation.Color.B);
        SetFinite(mutation.Intensity, value => light.Intensity = value, "intensity", 0, 100_000);
        SetFinite(mutation.Falloff, value => light.Falloff = value, "falloff", 0.01f, 10_000);
        SetFinite(mutation.FalloffExponent, value => light.FalloffExponent = value, "falloffExponent", 0.01f, 128);
        SetFinite(mutation.CoronaIntensity, value => light.CoronaIntensity = value, "coronaIntensity", 0, 10_000);
        SetFinite(mutation.CoronaSize, value => light.CoronaSize = value, "coronaSize", 0, 10_000);
        SetFinite(mutation.CoronaZBias, value => light.CoronaZBias = value, "coronaZBias", -10_000, 10_000);
        SetFinite(mutation.VolumeIntensity, value => light.VolumeIntensity = value, "volumeIntensity", 0, 10_000);
        SetFinite(mutation.VolumeSizeScale, value => light.VolumeSizeScale = value, "volumeSizeScale", 0, 10_000);
        if (mutation.VolumeOuterColor is not null)
            (light.VolumeOuterColorR, light.VolumeOuterColorG, light.VolumeOuterColorB) =
                (mutation.VolumeOuterColor.R, mutation.VolumeOuterColor.G, mutation.VolumeOuterColor.B);
        SetFinite(mutation.VolumeOuterIntensity, value => light.VolumeOuterIntensity = value, "volumeOuterIntensity", 0, 10_000);
        SetFinite(mutation.VolumeOuterExponent, value => light.VolumeOuterExponent = value, "volumeOuterExponent", 0.01f, 128);
        if (mutation.LightFadeDistance is byte lightFade) light.LightFadeDistance = lightFade;
        if (mutation.VolumetricFadeDistance is byte volumetricFade)
            light.VolumetricFadeDistance = volumetricFade;
        if (mutation.FlagsValue.HasValue != mutation.OwnedFlagsMask.HasValue)
            throw new InvalidDataException("flagsValue and ownedFlagsMask must be provided together.");
        if (mutation.FlagsValue is uint flags && mutation.OwnedFlagsMask is uint mask)
        {
            if (mask == 0) throw new InvalidDataException("ownedFlagsMask cannot be zero.");
            if ((flags & ~mask) != 0)
                throw new InvalidDataException("flagsValue contains bits outside ownedFlagsMask.");
            light.Flags = (light.Flags & ~mask) | flags;
        }
    }

    private static void AssertMutation(LightAttributes light, LampHdMutation mutation)
    {
        void Equal<T>(T expected, T actual, string field) where T : IEquatable<T>
        {
            if (!actual.Equals(expected))
                throw new InvalidDataException($"Patched YFT failed exact verification for {field}.");
        }
        if (mutation.Color is not null)
        {
            Equal(mutation.Color.R, light.ColorR, "color.r");
            Equal(mutation.Color.G, light.ColorG, "color.g");
            Equal(mutation.Color.B, light.ColorB, "color.b");
        }
        AssertOptional(mutation.Intensity, light.Intensity, "intensity");
        AssertOptional(mutation.Falloff, light.Falloff, "falloff");
        AssertOptional(mutation.FalloffExponent, light.FalloffExponent, "falloffExponent");
        AssertOptional(mutation.CoronaIntensity, light.CoronaIntensity, "coronaIntensity");
        AssertOptional(mutation.CoronaSize, light.CoronaSize, "coronaSize");
        AssertOptional(mutation.CoronaZBias, light.CoronaZBias, "coronaZBias");
        AssertOptional(mutation.VolumeIntensity, light.VolumeIntensity, "volumeIntensity");
        AssertOptional(mutation.VolumeSizeScale, light.VolumeSizeScale, "volumeSizeScale");
        if (mutation.VolumeOuterColor is not null)
        {
            Equal(mutation.VolumeOuterColor.R, light.VolumeOuterColorR, "volumeOuterColor.r");
            Equal(mutation.VolumeOuterColor.G, light.VolumeOuterColorG, "volumeOuterColor.g");
            Equal(mutation.VolumeOuterColor.B, light.VolumeOuterColorB, "volumeOuterColor.b");
        }
        AssertOptional(mutation.VolumeOuterIntensity, light.VolumeOuterIntensity, "volumeOuterIntensity");
        AssertOptional(mutation.VolumeOuterExponent, light.VolumeOuterExponent, "volumeOuterExponent");
        if (mutation.LightFadeDistance is byte lightFade) Equal(lightFade, light.LightFadeDistance, "lightFadeDistance");
        if (mutation.VolumetricFadeDistance is byte volumetricFade)
            Equal(volumetricFade, light.VolumetricFadeDistance, "volumetricFadeDistance");
        if (mutation.FlagsValue is uint flags && mutation.OwnedFlagsMask is uint mask)
            Equal(flags, light.Flags & mask, "ownedFlags");
    }

    private static void AssertOptional(float? expected, float actual, string field)
    {
        if (expected is float value && BitConverter.SingleToInt32Bits(value) != BitConverter.SingleToInt32Bits(actual))
            throw new InvalidDataException($"Patched YFT failed exact verification for {field}.");
    }

    private static void SetFinite(float? value, Action<float> setter, string field, float minimum, float maximum)
    {
        if (value is not float number) return;
        if (!float.IsFinite(number) || number < minimum || number > maximum)
            throw new InvalidDataException($"Lamp {field} is outside the helper safety envelope.");
        setter(number);
    }

    private static object Vector(SharpDX.Vector3 value) => new
    {
        x = Finite(value.X, "vector.x"),
        y = Finite(value.Y, "vector.y"),
        z = Finite(value.Z, "vector.z"),
    };

    private static object Vector(MetaVECTOR3 value) => new
    {
        x = Finite(value.x, "vector.x"),
        y = Finite(value.y, "vector.y"),
        z = Finite(value.z, "vector.z"),
    };

    private static float Finite(float value, string field) => float.IsFinite(value)
        ? value
        : throw new InvalidDataException($"Lamp resource contains non-finite {field}.");

    private static string HashObject(object value) => Sha256(
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, CanonicalJson)));

    private static string Sha256(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static string RequireInput(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
            throw new InvalidDataException("Lamp input must be an absolute path.");
        var fullPath = Path.GetFullPath(value);
        if (!File.Exists(fullPath)) throw new FileNotFoundException("Lamp input was not found.", fullPath);
        if (new FileInfo(fullPath).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Lamp input cannot be a reparse point.");
        return fullPath;
    }

    private static string RequireYmapInput(string? value, string label)
    {
        var input = RequireInput(value);
        if (!Path.GetExtension(input).Equals(".ymap", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"{label} must be a YMAP file.");
        return input;
    }

    private static string RequireNewYmapOutput(string? value, string input, string label)
    {
        var output = RequireOutput(value, input);
        if (!Path.GetExtension(output).Equals(".ymap", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"{label} must be a YMAP file.");
        if (File.Exists(output))
            throw new InvalidDataException($"{label} must be a new staging path.");
        var parent = Path.GetDirectoryName(output)!;
        if (Directory.Exists(parent) &&
            new DirectoryInfo(parent).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException($"{label} parent cannot be a reparse point.");
        return output;
    }

    private static string RequireOutput(string? value, string input)
    {
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
            throw new InvalidDataException("Lamp output must be an absolute path.");
        var fullPath = Path.GetFullPath(value);
        if (fullPath.Equals(input, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Lamp output must differ from the protected input.");
        return fullPath;
    }

    private static void ValidateSha256(string? value, string field)
    {
        if (value is null || value.Length != 64 || value.Any(character => !Uri.IsHexDigit(character)))
            throw new InvalidDataException($"{field} must be a 64-character SHA-256 value.");
    }
}
