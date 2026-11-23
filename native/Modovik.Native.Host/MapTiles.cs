using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using CodeWalker.Utils;
using RageLib.Archives;
using RageLib.GTA5.ArchiveWrappers;

namespace Modovik.Native.Host;

/// <summary>
/// Плитки большой карты GTA V: поиск у игрока и сборка патча для установщика RPF.
/// В архивы игры ничего не пишет: готовые файлы и manifest.json кладутся в папку патча.
/// </summary>
internal static class MapTiles
{
    /// <summary>ReadPath — откуда читать архив; Archive — за какой архив игры отвечает найденное.</summary>
    internal sealed record ArchiveSlot(string ReadPath, string Archive);

    /// <summary>Entry — путь записи внутри архива через «/», Bytes — сырой экспорт записи.</summary>
    internal sealed record FoundTile(string Archive, string Entry, string FileName, byte[] Bytes);

    private const int TileLimit = 64;
    private const int ReasonLimit = 5;
    private const int DepthLimit = 8;
    private const long SizeLimit = 64L * 1024 * 1024;

    // `$` пускает один «\n» в конце, `\d` — любые десятичные цифры; регистр — по правилам текущей культуры.
    private static readonly Regex TileName =
        new(@"^minimap(?:_sea)?_\d+_\d+\.ytd$", RegexOptions.IgnoreCase);

    // Что отбрасывается от пути архива в виртуальном адресе: весь update/update.rpf (остаётся «update») или только «.rpf» в конце.
    private static readonly Regex ArchiveSuffix = new(@"^update/update\.rpf\z|\.rpf\z", RegexOptions.IgnoreCase);

    // Манифест читает установщик RPF: имена полей как в записях ниже, отступы в 2 пробела.
    private static readonly JsonSerializerOptions ManifestJson = new() { WriteIndented = true };

    private sealed record ManifestAction(
        string Type, string TargetPath, string SourcePath, long Size, string Sha256, bool IsWholeReplaceNestedRpf);

    private sealed record Manifest(
        string ReduxName, DateTime ParsedAt, long TotalPatchSize, IReadOnlyList<ManifestAction> Actions);

    // Ответ команды: имена полей и их порядок читает окно, поэтому строчные.
    private sealed record TileReport(
        string file, string archive, string entry, int textures, string texture,
        int width, int height, string format, int bytes, string sha256);

    private sealed record PatchReport(string patch, long size, IReadOnlyList<TileReport> tiles, IReadOnlyList<string> targets);

    private sealed record BuiltTile(
        string Name, FoundTile Source, Texture Texture, int TextureCount, byte[] Bytes, string Digest, string Address);

    // Где идёт обход: архив слота, путь внутри него, глубина (корень архива слота — 0) и вложенность
    // (внутри архива, раскрытого из записи другого архива, а не в самом архиве слота).
    private readonly record struct Spot(string Archive, string Prefix, int Depth, bool Nested = false)
    {
        public Spot Into(string name) => this with { Prefix = $"{Prefix}{name}/", Depth = Depth + 1 };

        public Spot IntoArchive(string name) => Into(name) with { Nested = true };
    }

    /// <summary>Что не удалось прочитать при обходе: архив слота, запись в нём (пусто — сам архив) и текст ошибки.</summary>
    private sealed record ReadFailure(string Archive, string Entry, string Reason)
    {
        public override string ToString() => $"{(Entry.Length > 0 ? $"{Archive}:{Entry}" : Archive)}: {Reason}";
    }

    /// <summary>
    /// Состояние одного обхода: занятые имена плиток и всё, что не прочиталось. Обычный обход берёт первую
    /// запись с каждым именем; обход копий (only) берёт все записи с одним именем, ничего не занимая.
    /// </summary>
    private sealed class Survey(string? only = null)
    {
        public HashSet<string> Claimed { get; } = new(StringComparer.OrdinalIgnoreCase);

        public List<ReadFailure> Failures { get; } = [];

        public bool Takes(string name) =>
            only is null ? Claimed.Add(name) : name.Equals(only, StringComparison.OrdinalIgnoreCase);

        public void Fail(string archive, string entry, Exception error) =>
            Failures.Add(new ReadFailure(archive, entry, error.Message));
    }

    /// <summary>Итог поиска: первые найденные плитки, слоты, которые успели прочитать, и всё, что не прочиталось.</summary>
    private sealed record TileScan(
        string GameRoot, List<FoundTile> Tiles, IReadOnlyList<ArchiveSlot> Slots, IReadOnlyList<ReadFailure> Failures);

    // Запись вложенного архива не прочиталась: причина уже записана, архив дальше не читается.
    private sealed class ReadAbandoned : Exception;

    // ---------------------------------------------------------------- поиск

    internal static List<FoundTile> Find(string gameRoot, IEnumerable<ArchiveSlot> archives) =>
        Scan(gameRoot, archives).Tiles;

    private static TileScan Scan(string gameRoot, IEnumerable<ArchiveSlot> archives)
    {
        var survey = new Survey();
        var tiles = new List<FoundTile>();
        var read = new List<ArchiveSlot>();
        using var pending = archives.GetEnumerator();

        // Предел смотрится между архивами: внутри одного он не режет.
        while (tiles.Count < TileLimit && pending.MoveNext())
        {
            read.Add(pending.Current);
            tiles.AddRange(ScanSlot(gameRoot, pending.Current, survey));
        }

        return new TileScan(gameRoot, tiles, read, survey.Failures);
    }

    // Все копии одной плитки, годные по размеру, в слотах, которые прочитал поиск, и в том же порядке:
    // первая из них — та, что вернул поиск. Читается лениво, по мере того как копии нужны.
    private static IEnumerable<FoundTile> CopiesOf(TileScan scan, string name)
    {
        var survey = new Survey(name);
        return scan.Slots.SelectMany(slot => ScanSlot(scan.GameRoot, slot, survey));
    }

    private static IEnumerable<FoundTile> ScanSlot(string gameRoot, ArchiveSlot slot, Survey survey)
    {
        var path = Path.Combine(gameRoot, slot.ReadPath);
        if (!File.Exists(path))
            return Enumerable.Empty<FoundTile>();

        var archive = slot.Archive.Replace('\\', '/');
        return UntilFailure(ReadSlot(path, archive, survey), error => survey.Fail(archive, "", error));
    }

    private static IEnumerable<FoundTile> ReadSlot(string path, string archive, Survey survey)
    {
        using var rpf = RageArchiveWrapper7.OpenRead(path);
        foreach (var tile in Walk(rpf.Root, new Spot(archive, "", 0), survey))
            yield return tile;
    }

    // Сначала файлы каталога, потом подкаталоги: оба списка идут в порядке оглавления.
    private static IEnumerable<FoundTile> Walk(IArchiveDirectory directory, Spot at, Survey survey) =>
        FilesOf(directory, at, survey).Concat(SubdirectoriesOf(directory, at, survey));

    private static IEnumerable<FoundTile> FilesOf(IArchiveDirectory directory, Spot at, Survey survey)
    {
        foreach (var file in directory.GetFiles())
        {
            switch (file)
            {
                // Вложенный архив раскрывается на месте своей записи; ошибка внутри обрывает только его.
                case IArchiveBinaryFile packed when IsNestedArchive(packed.Name):
                    if (at.Depth < DepthLimit)
                        foreach (var tile in UntilFailure(
                                     ReadNested(packed, at.IntoArchive(packed.Name), survey),
                                     error => survey.Fail(at.Archive, at.Prefix + packed.Name, error)))
                            yield return tile;
                    break;

                // Имя занято уже здесь: пустая или огромная запись не уступает его следующей копии.
                case var plain when TileName.IsMatch(plain.Name) && survey.Takes(plain.Name):
                    var raw = Export(plain, at, survey);
                    if (raw is { LongLength: > 0 and <= SizeLimit })
                        yield return new FoundTile(at.Archive, at.Prefix + plain.Name, plain.Name, raw);
                    break;
            }
        }
    }

    // Запись, которая не читается, запоминается с причиной. В архиве слота она пропускается, и обход идёт
    // дальше; во вложенном по-прежнему обрывается только этот вложенный архив. Имя за ней не держится:
    // копия, которую нельзя прочесть, не мешает найти годную.
    private static byte[]? Export(IArchiveFile file, Spot at, Survey survey)
    {
        try
        {
            return Bytes(file.Export);
        }
        catch (Exception error)
        {
            survey.Fail(at.Archive, at.Prefix + file.Name, error);
            survey.Claimed.Remove(file.Name);
            return at.Nested ? throw new ReadAbandoned() : null;
        }
    }

    private static IEnumerable<FoundTile> SubdirectoriesOf(IArchiveDirectory directory, Spot at, Survey survey)
    {
        if (at.Depth >= DepthLimit) yield break;

        foreach (var tile in directory.GetDirectories().SelectMany(sub => Walk(sub, at.Into(sub.Name), survey)))
            yield return tile;
    }

    private static IEnumerable<FoundTile> ReadNested(IArchiveBinaryFile file, Spot inside, Survey survey)
    {
        // Запись открывается как архив прямо по сырым байтам: сжатие и шифрование записи не смотрятся.
        using var nested = RageArchiveWrapper7.Open(file.GetStream(), file.Name);
        foreach (var tile in Walk(nested.Root, inside, survey))
            yield return tile;
    }

    private static bool IsNestedArchive(string name) => name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase);

    private static byte[] Bytes(Action<Stream> write)
    {
        var sink = new MemoryStream();
        write(sink);
        return sink.ToArray();
    }

    // Ошибка источника не доходит до читателя: то, что уже отдано, остаётся, остальное не читается.
    // Причина уходит в onFailure (кроме ReadAbandoned: её причина записана на месте).
    private static IEnumerable<T> UntilFailure<T>(IEnumerable<T> source, Action<Exception> onFailure)
    {
        using var cursor = source.GetEnumerator();
        while (TryAdvance(cursor, onFailure, out var item))
            yield return item;

        static bool TryAdvance(IEnumerator<T> from, Action<Exception> onFailure, out T item)
        {
            try
            {
                if (from.MoveNext())
                {
                    item = from.Current;
                    return true;
                }
            }
            catch (ReadAbandoned)
            {
                // причина уже записана
            }
            catch (Exception error)
            {
                onFailure(error);
            }

            item = default!;
            return false;
        }
    }

    // ---------------------------------------------------------------- сборка

    internal static object BuildPatch(
        string gameRoot, IEnumerable<ArchiveSlot> archives, IReadOnlyDictionary<string, string> replacements, string output)
    {
        var complaint = replacements.Count switch
        {
            0 => "Не передано ни одной плитки для замены.",
            > TileLimit => "Слишком много плиток в одном патче.",
            _ => null,
        };
        if (complaint != null) throw new ArgumentException(complaint);

        var scan = Scan(gameRoot, archives);
        var index = scan.Tiles.ToLookup(t => t.FileName, StringComparer.OrdinalIgnoreCase);
        var payload = Path.Combine(output, "payload");
        Directory.CreateDirectory(payload);

        // OrderBy устойчив: имена, равные без учёта регистра, остаются в порядке словаря.
        var built = replacements
            .OrderBy(r => r.Key, StringComparer.OrdinalIgnoreCase)
            .Select(r => Place(payload, Rebuild(r.Key, r.Value, scan, index)))
            .ToList();

        WriteManifest(output, built);
        return new PatchReport(output, TotalBytes(built), built.ConvertAll(Describe), built.ConvertAll(b => b.Address));
    }

    private static BuiltTile Place(string payload, BuiltTile tile)
    {
        File.WriteAllBytes(Path.Combine(payload, tile.Name), tile.Bytes);
        return tile;
    }

    private static long TotalBytes(IEnumerable<BuiltTile> tiles) => tiles.Sum(t => (long)t.Bytes.Length);

    private static TileReport Describe(BuiltTile b) => new(
        b.Name, b.Source.Archive, b.Source.Entry, b.TextureCount, b.Texture.Name,
        b.Texture.Width, b.Texture.Height, b.Texture.Format.ToString(), b.Bytes.Length, b.Digest);

    private static void WriteManifest(string output, List<BuiltTile> built)
    {
        var actions = built.ConvertAll(b => new ManifestAction(
            "Replace", b.Address, $"payload/{b.Name}", b.Bytes.Length, b.Digest, false));
        var manifest = new Manifest("Astral world map", DateTime.UtcNow, TotalBytes(built), actions);
        File.WriteAllText(Path.Combine(output, "manifest.json"), JsonSerializer.Serialize(manifest, ManifestJson));
    }

    // Один YTD игрока → тот же YTD с новой картинкой в одной текстуре. Порядок отказов виден снаружи.
    private static BuiltTile Rebuild(string name, string ddsPath, TileScan scan, ILookup<string, FoundTile> index)
    {
        var first = index[name].FirstOrDefault()
            ?? throw new FileNotFoundException(NotFound(name, scan.Failures));
        var dds = ReadDds(name, ddsPath);

        var (source, ytd) = LoadUsableCopy(name, first, scan);
        var textures = LiveTextures(ytd) is { Count: > 0 } live
            ? live
            : throw new InvalidDataException($"Плитка {name} не содержит текстур.");

        var slot = PickSlot(name, textures);
        var fresh = Graft(
            DDSIO.GetTexture(dds) ?? throw new InvalidDataException($"DDS для плитки {name} не читается."),
            textures[slot]);
        var swapped = textures.Select((t, i) => i == slot ? fresh : t).ToList();

        ytd.TextureDict!.BuildFromTextureList(swapped);
        var file = ytd.Save();
        if (file is not { Length: > 0 })
            throw new InvalidDataException($"Не удалось собрать плитку {name}.");

        return new BuiltTile(
            name, source, fresh, swapped.Count, file, Convert.ToHexString(SHA256.HashData(file)),
            TargetPath(source.Archive, source.Entry));
    }

    // Первая копия плитки, которая разбирается как YTD. Берётся найденная поиском; если она не разобралась,
    // по порядку поиска пробуются следующие копии (другой слот, вложенный архив, каталог ниже). Следующие
    // копии читаются только в этом случае, поэтому у годных входов ничего лишнего не читается.
    private static (FoundTile Source, YtdFile Ytd) LoadUsableCopy(string name, FoundTile first, TileScan scan)
    {
        var broken = new List<(FoundTile Copy, Exception Error)>();
        foreach (var copy in AlternativesAfter(first, CopiesOf(scan, name)))
        {
            var ytd = new YtdFile();
            try
            {
                ytd.Load(copy.Bytes);
                return (copy, ytd);
            }
            catch (Exception error)
            {
                broken.Add((copy, error));
            }
        }

        // Единственная копия: отказ соседа выходит как есть. Несколько: названа каждая и причина по ней.
        if (broken.Count == 1)
            ExceptionDispatchInfo.Capture(broken[0].Error).Throw();

        var causes = broken.Select(b => $"{b.Copy.Archive}:{b.Copy.Entry}: {b.Error.Message}");
        throw new InvalidDataException(
            $"Плитка {name} не разобрана ни в одной из {broken.Count} копий: {string.Join("; ", causes)}");
    }

    // Найденная поиском копия идёт первой, затем остальные в порядке обхода (её саму повторно не читать).
    private static IEnumerable<FoundTile> AlternativesAfter(FoundTile first, IEnumerable<FoundTile> copies)
    {
        yield return first;
        foreach (var copy in copies.Where(c => c.Archive != first.Archive || c.Entry != first.Entry))
            yield return copy;
    }

    // Если при поиске что-то не прочиталось, «не найдена» называет причины: плитка могла лежать там.
    // Те, где названа сама плитка, идут первыми; в тексте не больше ReasonLimit причин.
    private static string NotFound(string name, IReadOnlyList<ReadFailure> failures)
    {
        var text = $"Плитка {name} не найдена в архивах игры.";
        if (failures.Count == 0)
            return text;

        var shown = failures.OrderBy(f => !NamesTile(f, name)).Take(ReasonLimit).ToList();
        var rest = failures.Count - shown.Count;
        return $"{text} Не удалось прочитать: {string.Join("; ", shown)}{(rest > 0 ? $"; и ещё {rest}" : "")}";
    }

    private static bool NamesTile(ReadFailure failure, string name) =>
        failure.Entry.Equals(name, StringComparison.OrdinalIgnoreCase)
        || failure.Entry.EndsWith("/" + name, StringComparison.OrdinalIgnoreCase);

    private static byte[] ReadDds(string tile, string path) =>
        File.ReadAllBytes(path) switch
        {
            { Length: 0 } or { LongLength: > SizeLimit } => throw new InvalidDataException($"Некорректный DDS для плитки {tile}."),
            var whole => whole,
        };

    // Текстуры словаря без пустых ссылок; список новый, массив словаря не трогается.
    private static List<Texture> LiveTextures(YtdFile ytd) =>
        (ytd.TextureDict?.Textures?.data_items ?? []).Where(t => t != null).ToList();

    // Первая текстура с именем плитки (без учёта регистра); единственная текстура берётся при любом имени.
    private static int PickSlot(string tile, IReadOnlyList<Texture> textures)
    {
        var stem = Path.GetFileNameWithoutExtension(tile);
        var named = Enumerable.Range(0, textures.Count)
            .Where(i => string.Equals(textures[i].Name, stem, StringComparison.OrdinalIgnoreCase))
            .Select(i => (int?)i)
            .FirstOrDefault();

        return (named, textures.Count) switch
        {
            ({ } hit, _) => hit,
            (null, 1) => 0,
            _ => throw new InvalidDataException(
                $"В плитке {tile} нет текстуры {stem}: {string.Join(", ", textures.Select(t => t.Name))}"),
        };
    }

    // Новая картинка наследует у старой текстуры имя, хеш имени и оба набора флагов; остальное — из DDS.
    private static Texture Graft(Texture fresh, Texture old)
    {
        (fresh.Name, fresh.NameHash, fresh.UsageData, fresh.ExtraFlags) = (old.Name, old.NameHash, old.UsageData, old.ExtraFlags);
        return fresh;
    }

    // ---------------------------------------------------------------- виртуальный адрес

    // «update:/…» для update/update.rpf, «<путь без .rpf>:/…» для остальных архивов, регистр сохраняется.
    private static string TargetPath(string archive, string entry) =>
        ArchiveSuffix.Replace(archive.Replace('\\', '/'), m => m.Length > 4 ? "update" : "", 1) + ":/" + entry;
}
