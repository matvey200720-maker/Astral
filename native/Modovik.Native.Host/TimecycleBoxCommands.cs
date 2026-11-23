using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using SharpDX;

namespace Modovik.Native.Host;

/// <summary>
/// Карта с коробкой модификатора таймцикла — «Дальность прорисовки» (задача 7
/// ТЗ 06.10.2026).
///
/// Модификатор таймцикла игра включает сама, пока камера внутри его коробки
/// из карты (`CMapData.timeCycleModifiers`): так Rockstar задаёт свет и туман
/// в туннелях, лесах и помещениях. Здесь коробка одна и накрывает всю карту,
/// а модификатор — свой (дальность, `lod_mult` и стена тумана; его кладёт
/// движок в `timecycle_mods` объединением по имени). Карта без сущностей:
/// только коробка, её рамки потоковой подгрузки — рамки коробки, поэтому
/// карта в памяти всегда, где бы ни была камера.
///
/// Запрос: `{ format: "astral.timecycle-box", version: 1, name, modifier,
/// min: [x, y, z], max: [x, y, z], percentage, range, startHour, endHour }`.
/// Вывод — `&lt;name&gt;.ymap`. Команда детерминирована.
/// </summary>
internal static class TimecycleBoxCommands
{
    private const string RequestFormat = "astral.timecycle-box";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 16 * 1024;
    private const float WorldLimit = 20000f;

    private static readonly Regex MapName = new("^[a-z0-9_]{1,48}$", RegexOptions.CultureInvariant);
    private static readonly Regex ModifierName = new("^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 6,
    };

    public static async Task<object> CompileAsync(string input, string output)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Timecycle-box request must be between 1 byte and 16 KiB.");
        var request = JsonSerializer.Deserialize<TimecycleBoxRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Timecycle-box request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Timecycle-box request has an unknown format.");
        var name = (request.Name ?? "").Trim();
        var modifier = (request.Modifier ?? "").Trim();
        if (!MapName.IsMatch(name)) throw new InvalidDataException("Timecycle-box map name is not valid.");
        if (!ModifierName.IsMatch(modifier)) throw new InvalidDataException("Timecycle-box modifier name is not valid.");
        var min = Vector(request.Min, "min");
        var max = Vector(request.Max, "max");
        if (min.X >= max.X || min.Y >= max.Y || min.Z >= max.Z) throw new InvalidDataException("Timecycle-box min must be below max.");
        var percentage = request.Percentage ?? 100f;
        var range = request.Range ?? 0f;
        if (!float.IsFinite(percentage) || percentage is < 0f or > 100f) throw new InvalidDataException("Timecycle-box percentage must be 0…100.");
        if (!float.IsFinite(range) || range is < 0f or > 2000f) throw new InvalidDataException("Timecycle-box range must be 0…2000.");
        var startHour = request.StartHour ?? 0u;
        var endHour = request.EndHour ?? 24u;
        if (startHour > 24 || endHour > 24) throw new InvalidDataException("Timecycle-box hours must be 0…24.");

        var outputDirectory = Path.GetFullPath(output);
        Directory.CreateDirectory(outputDirectory);
        var box = new CTimeCycleModifier
        {
            name = new MetaHash(JenkHash.GenHash(modifier.ToLowerInvariant())),
            minExtents = min,
            maxExtents = max,
            percentage = percentage,
            range = range,
            startHour = startHour,
            endHour = endHour,
        };
        /* Подгрузка карты — по её рамкам: рамки коробки с запасом на спад. */
        var reach = new Vector3(range);
        var ymap = new YmapFile
        {
            Name = name + ".ymap",
            CMapData = new CMapData
            {
                name = new MetaHash(JenkHash.GenHash(name)),
                parent = new MetaHash(0),
                streamingExtentsMin = min - reach,
                streamingExtentsMax = max + reach,
                entitiesExtentsMin = min,
                entitiesExtentsMax = max,
            },
            CTimeCycleModifiers = [box],
            BlockExportedBy = "Astral",
            BlockTime = "06 October 2026 00:00",
        };
        var bytes = ymap.Save();
        var mapPath = Path.Combine(outputDirectory, name + ".ymap");
        await File.WriteAllBytesAsync(mapPath, bytes);

        /* Проверка: карта открывается и несёт ровно эту коробку. */
        var reopened = new YmapFile { Name = name + ".ymap" };
        reopened.Load(bytes);
        var boxes = reopened.CTimeCycleModifiers ?? [];
        if (boxes.Length != 1 || boxes[0].name.Hash != box.name.Hash || Math.Abs(boxes[0].percentage - percentage) > 0.001f)
            throw new InvalidDataException("Timecycle-box map lost its box.");
        return new
        {
            file = name + ".ymap",
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            modifierHash = box.name.Hash,
            semantic = new { semanticReopen = true, boxes = boxes.Length },
        };
    }

    private static Vector3 Vector(float[]? values, string label)
    {
        if (values is not { Length: 3 } || values.Any(value => !float.IsFinite(value) || Math.Abs(value) > WorldLimit))
            throw new InvalidDataException($"Timecycle-box {label} must be three numbers within the world.");
        return new Vector3(values[0], values[1], values[2]);
    }

    private sealed record TimecycleBoxRequest(
        string Format,
        int Version,
        string? Name = null,
        string? Modifier = null,
        float[]? Min = null,
        float[]? Max = null,
        float? Percentage = null,
        float? Range = null,
        uint? StartHour = null,
        uint? EndHour = null);
}
