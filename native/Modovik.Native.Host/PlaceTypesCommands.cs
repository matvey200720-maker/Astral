using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Постоянные типы места мастерской — `astral_&lt;набор&gt;_local.ytyp`
/// (фикс 2 ТЗ 06.10.2026).
///
/// Вещь, которую ставит игра и в месте работы, и по всему миру (контейнер,
/// забор, общий словарь соседних зданий), красится только у своего места:
/// месту достаётся копия вещи под своим именем — копия архетипа из типов
/// игры со своим именем, моделью и словарём, а сущности карт района,
/// которые стоят в месте, смотрят на копию. Копии архетипов собираются
/// здесь одним файлом типов на место; пакет мест (`astral_places`) держит
/// их постоянно (`DLC_ITYP_REQUEST`), как пакеты Rockstar — свои пропы.
///
/// Без копий получается пустой файл типов — основа пакета мест держит такой
/// у каждого места, чтобы запрос типов не смотрел в пустоту.
///
/// Команда детерминирована: одинаковый запрос даёт те же байты.
/// </summary>
internal static class PlaceTypesCommands
{
    private const string RequestFormat = "astral.compile-place-types";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 512 * 1024;
    private const int MaxSources = 64;
    private const int MaxClones = 512;
    private const long MaxSourceBytes = 64L * 1024 * 1024;

    private static readonly Regex AssetName = new("^[a-z0-9][a-z0-9_]{0,62}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    public static async Task<object> CompileAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Place types request must be between 1 byte and 512 KiB.");
        var request = JsonSerializer.Deserialize<PlaceTypesRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Place types request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Place types request has an unknown format.");
        var typesName = request.TypesName ?? "";
        if (!AssetName.IsMatch(typesName))
            throw new InvalidDataException("Place types name must be lowercase letters, digits and underscores.");
        var sources = request.Sources ?? [];
        var clones = request.Clones ?? [];
        if (sources.Length > MaxSources) throw new InvalidDataException($"Place types take at most {MaxSources} source files.");
        if (clones.Length > MaxClones) throw new InvalidDataException($"Place types take at most {MaxClones} copies.");

        /* Типы игры, из которых берутся архетипы-образцы. */
        var loaded = new Dictionary<string, YtypFile>(StringComparer.Ordinal);
        foreach (var source in sources)
        {
            if (source is null || string.IsNullOrWhiteSpace(source.Id) || string.IsNullOrWhiteSpace(source.File))
                throw new InvalidDataException("Place types source needs an id and a file.");
            if (loaded.ContainsKey(source.Id)) throw new InvalidDataException($"Place types source {source.Id} repeats.");
            var file = Path.GetFullPath(source.File);
            var info = new FileInfo(file);
            if (!info.Exists || info.Length is 0 or > MaxSourceBytes)
                throw new InvalidDataException($"Place types source {source.Id} is missing or too large.");
            var ytyp = new YtypFile { Name = Path.GetFileName(file) };
            ytyp.Load(await File.ReadAllBytesAsync(file));
            if (!ytyp.Loaded) throw new InvalidDataException($"Place types source {source.Id} is not a types file.");
            loaded[source.Id] = ytyp;
        }

        var result = new YtypFile
        {
            Name = typesName + ".ytyp",
            NameHash = JenkHash.GenHash(typesName),
            CMapTypes = new CMapTypes(),
        };
        var names = new HashSet<string>(StringComparer.Ordinal);
        var archetypes = new List<Archetype>();
        foreach (var clone in clones)
        {
            if (clone is null) throw new InvalidDataException("Place types copy is empty.");
            var name = clone.Name ?? "";
            var asset = clone.AssetName ?? "";
            if (!AssetName.IsMatch(name) || !AssetName.IsMatch(asset))
                throw new InvalidDataException($"Place types copy {name} needs lowercase names.");
            if (!names.Add(name)) throw new InvalidDataException($"Place types copy {name} repeats.");
            if (clone.Source is null || !loaded.TryGetValue(clone.Source, out var ytyp))
                throw new InvalidDataException($"Place types copy {name} names an unknown source.");
            var wanted = clone.ArchetypeHash ?? JenkHash.GenHash((clone.Archetype ?? "").ToLowerInvariant());
            var original = (ytyp.AllArchetypes ?? []).FirstOrDefault(item => item._BaseArchetypeDef.name.Hash == wanted)
                ?? throw new InvalidDataException($"Place types copy {name}: archetype {clone.Archetype ?? wanted.ToString()} is not in {ytyp.Name}.");
            if (original is MloArchetype)
                throw new InvalidDataException($"Place types copy {name}: interiors are not copied.");

            Archetype copy;
            if (original is TimeArchetype time)
            {
                var definition = time._TimeArchetypeDef;
                definition._BaseArchetypeDef = Rename(definition._BaseArchetypeDef, name, asset, clone);
                var timed = new TimeArchetype();
                timed.Init(result, ref definition);
                copy = timed;
            }
            else
            {
                var definition = Rename(original._BaseArchetypeDef, name, asset, clone);
                copy = new Archetype();
                copy.Init(result, ref definition);
            }
            /* Огни, частицы, звук — расширения образца едут с копией как есть. */
            copy.Extensions = original.Extensions;
            archetypes.Add(copy);
        }
        result.AllArchetypes = archetypes.ToArray();
        var bytes = result.Save();

        var path = Path.GetFullPath(output);
        if (!path.EndsWith(".ytyp", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Place types output must be a .ytyp file.");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, bytes);

        /* Повторное открытие: столько же архетипов, те же имена и словари. */
        var reopened = new YtypFile { Name = Path.GetFileName(path) };
        reopened.Load(bytes);
        var got = reopened.AllArchetypes ?? [];
        if (!reopened.Loaded || got.Length != clones.Length)
            throw new InvalidDataException("Compiled place types failed semantic reopen.");
        foreach (var clone in clones)
        {
            var hash = JenkHash.GenHash(clone.Name!);
            var match = got.SingleOrDefault(item => item._BaseArchetypeDef.name.Hash == hash)
                ?? throw new InvalidDataException($"Compiled place types lost {clone.Name}.");
            if (match._BaseArchetypeDef.assetName.Hash != JenkHash.GenHash(clone.AssetName!))
                throw new InvalidDataException($"Compiled place types changed the model of {clone.Name}.");
            if (clone.TextureDictionary is { Length: > 0 } txd && match._BaseArchetypeDef.textureDictionary.Hash != JenkHash.GenHash(txd))
                throw new InvalidDataException($"Compiled place types changed the dictionary of {clone.Name}.");
        }
        return new
        {
            file = Path.GetFileName(path),
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            semantic = new
            {
                semanticReopen = true,
                archetypes = got.Length,
                /* Копии со своим словарём физики: коллизия у них — из словаря образца. */
                physics = got.Count(item => item._BaseArchetypeDef.physicsDictionary.Hash != 0),
            },
        };
    }

    private static CBaseArchetypeDef Rename(CBaseArchetypeDef source, string name, string asset, PlaceTypeClone clone)
    {
        var definition = source;
        definition.name = new MetaHash(JenkHash.GenHash(name));
        definition.assetName = new MetaHash(JenkHash.GenHash(asset));
        if (clone.TextureDictionary is { Length: > 0 } txd)
        {
            if (!AssetName.IsMatch(txd)) throw new InvalidDataException($"Place types copy {name}: dictionary name is not valid.");
            definition.textureDictionary = new MetaHash(JenkHash.GenHash(txd));
        }
        if (clone.DrawableDictionary is { Length: > 0 } ydd)
        {
            if (!AssetName.IsMatch(ydd)) throw new InvalidDataException($"Place types copy {name}: drawable dictionary name is not valid.");
            definition.drawableDictionary = new MetaHash(JenkHash.GenHash(ydd));
        }
        return definition;
    }

    private sealed record PlaceTypesSource(string? Id = null, string? File = null);

    private sealed record PlaceTypeClone(
        string? Source = null,
        string? Archetype = null,
        uint? ArchetypeHash = null,
        string? Name = null,
        string? AssetName = null,
        string? TextureDictionary = null,
        string? DrawableDictionary = null);

    private sealed record PlaceTypesRequest(
        string Format,
        int Version,
        string? TypesName = null,
        PlaceTypesSource[]? Sources = null,
        PlaceTypeClone[]? Clones = null);
}
