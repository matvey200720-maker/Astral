using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.Core.Utils;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Ресурсы Legacy → Enhanced (ТЗ 08.10.2026, задача 5).
///
/// GTA V Enhanced читает ресурсы нового поколения («gen9»): у словаря
/// текстур версия 5, у моделей 159, раскладка блоков и параметры шейдеров
/// другие. Файл Legacy в Enhanced роняет игру. Преобразует их конвертер
/// CodeWalker (`Gen9Converter`, тот же, что в его «RPF Explorer → Tools»):
/// файл открывается как Legacy и сохраняется уже в формате gen9. Файлы,
/// которым преобразование не нужно (карты, типы, метаданные, звук), и уже
/// gen9 едут как есть.
///
/// Запрос: `{ format: "astral.convert-gen9", version: 1, files: [{ input,
/// output }] }`. Ответ — по файлу: преобразован ли, размер и SHA-256.
/// </summary>
internal static class Gen9Commands
{
    private const string RequestFormat = "astral.convert-gen9";
    private const int RequestVersion = 1;
    private const int MaxRequestBytes = 1024 * 1024;
    private const int MaxFiles = 4000;
    private const long MaxFileBytes = 256L * 1024 * 1024;
    private static readonly HashSet<string> Convertible = new(StringComparer.OrdinalIgnoreCase) { ".ytd", ".ydr", ".ydd", ".yft", ".ypt" };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 6,
    };

    public static async Task<object> ConvertAsync(string input)
    {
        var requestBytes = await File.ReadAllBytesAsync(input);
        if (requestBytes.Length is 0 or > MaxRequestBytes)
            throw new InvalidDataException("Gen9 request must be between 1 byte and 1 MiB.");
        var request = JsonSerializer.Deserialize<ConvertRequest>(requestBytes, JsonOptions)
            ?? throw new InvalidDataException("Gen9 request is empty.");
        if (request.Format != RequestFormat || request.Version != RequestVersion)
            throw new InvalidDataException("Gen9 request has an unknown format.");
        var files = request.Files ?? [];
        if (files.Length is 0 or > MaxFiles) throw new InvalidDataException($"Gen9 request needs 1…{MaxFiles} files.");

        var described = new List<object>();
        var previous = RpfManager.IsGen9;
        try
        {
            foreach (var file in files)
            {
                var source = Path.GetFullPath(file?.Input ?? "");
                var target = Path.GetFullPath(file?.Output ?? "");
                var info = new FileInfo(source);
                if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length is 0 or > MaxFileBytes)
                    throw new InvalidDataException($"Gen9 input {source} is missing or has an unsafe size.");
                if (string.Equals(source, target, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Gen9 output must differ from input.");
                var data = await File.ReadAllBytesAsync(source);
                var extension = Path.GetExtension(source);
                byte[] output = data;
                var converted = false;
                if (Convertible.Contains(extension))
                {
                    /* Формат сохранения CodeWalker берёт из общего флага
                       менеджера архивов — как у его конвертера, флаг включён на
                       всё время: версию файла при загрузке он узнаёт сам. */
                    RpfManager.IsGen9 = true;
                    var result = Gen9Converter.TryConvert(data, extension.ToLowerInvariant(), (_) => { }, source, true, out converted);
                    if (result is null) throw new InvalidDataException($"{Path.GetFileName(source)} не преобразуется в формат Enhanced.");
                    output = result;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await File.WriteAllBytesAsync(target, output);
                described.Add(new
                {
                    file = Path.GetFileName(target),
                    converted,
                    bytes = output.Length,
                    sha256 = Convert.ToHexString(SHA256.HashData(output)).ToLowerInvariant(),
                });
            }
        }
        finally
        {
            RpfManager.IsGen9 = previous;
        }
        return new { format = "astral.gen9", version = 1, files = described };
    }

    private sealed record FileRequest(string? Input = null, string? Output = null);

    private sealed record ConvertRequest(string Format, int Version, FileRequest[]? Files = null);
}
