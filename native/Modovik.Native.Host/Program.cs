using System.IO.Compression;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;
using RageLib.Archives;
using RageLib.GTA5.Archives;
using RageLib.GTA5.ArchiveWrappers;
using RageLib.GTA5.Cryptography;

namespace Modovik.Native.Host;

internal static class Program
{
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter() },
    };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 0) throw new ArgumentException("A native command is required.");
            var command = args[0].Trim().ToLowerInvariant();
            var options = ParseOptions(args.Skip(1).ToArray());
            object result = command switch
            {
                "health" => Toolchain.Health(),
                "inspect-interior-ymap" => await InteriorYmapCommands.InspectAsync(
                    ExistingFile(Required(options, "input"), ".ymap")),
                "inspect-interior-ytyp" => await InteriorYmapCommands.InspectYtypAsync(
                    ExistingFile(Required(options, "input"), ".ytyp")),
                "compile-interior-layout" => await InteriorYmapCommands.CompileAsync(
                    ExistingFile(Required(options, "input"), ".json"),
                    OutputFile(Required(options, "output"), ".ymap")),
                // Секция карты одним запуском: пачка ymap/ytyp/ydd/gtxd и
                // бандл деталей с общими текстурами и LOD-уровнями.
                "inspect-map-files" => await MapSectorCommands.InspectFilesAsync(
                    MapSectorCommands.ReadInputList(
                        Values(options, "input").Select(value => ExistingFile(value)),
                        Optional(options, "list")),
                    Optional(options, "output")),
                "restore-rpf-point" => await RestorePatchAsync(options),
                "read-archive-file" => await ReadArchiveFileAsync(options),
                "extract-archive-entries" => ExtractArchiveEntries(options),
                "list-archive-entries" => ListArchiveEntries(options),
                "build-map-patch" => BuildMapPatch(options),
                "minimap-tile-colours" => MinimapTileColours(options),
                "paint-minimap-tiles" => PaintMinimapTiles(options),
                // Осмотр плиток радара без записи: рисовалки, модели, маски, высоты слоёв.
                "inspect-minimap-tiles" => MinimapRadar.InspectTiles(
                    Values(options, "input").Select(value => ExistingFile(value, ".ydd")).ToList()),
                // Проба «объёмная карта» (21.11.2026) и 3D-здания мини-карты: высоты плиток для пробы, подъём вершин, кварталы стопкой слоёв.
                "scan-radar-tiles" => InspectMinimapTiles(options),
                "lift-minimap-tiles" => LiftMinimapTiles(options),
                "stack-minimap-tiles" => StackMinimapTiles(options),
                "compile-mega-mall-overlay" => await MegaMallOverlayCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                "compile-sky-rainbow" => await SkyRainbowCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Пять моделей залазов заново: плашка с текстурой на месте значка мода.
                "compile-climb-markers" => await ClimbMarkerCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Прострелы: из архива мода — только укрытия, своими типами,
                // расстановкой и манифестом (залазы того же архива не едут).
                "build-wallbang-base" => await WallbangCommands.BuildBaseAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Дозор процессов игры: «Моды при запуске игры» у копии из Rockstar Games Launcher.
                "watch-processes" => await ProcessWatchCommands.WatchAsync(
                    Values(options, "name"),
                    Optional(options, "interval")),
                // Эмблема в мире: плашка с картинкой, свой архетип, место и манифест.
                "compile-emblem-plates" => await EmblemPlateCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Надпись на холме: буквы, леса, дальние планы и свечение из сеток окна.
                "compile-sign-models" => await SignModelCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Звезда арены: своя картинка объёмной моделью и клип её движения.
                "compile-star-model" => await StarModelCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // «Дирижабли»: модель со скелетом сушилки и клип полёта по кругу (ТЗ 11.10.2026).
                "compile-sky-flyer" => await SkyFlyerCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Части одной модели — в другую: лампы штатных ферм в ангар мода.
                "graft-drawable" => await GraftDrawableCommands.GraftAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Вещь педа без весов — веса ближайших вершин тела игры (разбор 02.11.2026).
                "skin-from-body" => await BodySkinCommands.SkinAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Украшения оружия: свои геометрии в модели ствола (задача 13).
                "decorate-drawable" => await DecorateDrawableCommands.DecorateAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // «Животные»: метка над животным и свечение — геометрией в словаре моделей педа (a_c_*.ydd).
                "patch-animal-model" => await PatchAnimalModelCommands.PatchAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Манифест контейнера: карты и их типы одним файлом (два мода в одном наборе).
                "compile-manifest" => await ManifestCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                /* Свои модели мест внутри помещения игры (ТЗ 11.10.2026, вечер, задача 1). */
                "compile-mlo-models" => await MloModelCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Ресурсы Legacy → Enhanced (gen9): модели и текстуры для GTA V Enhanced (ТЗ 08.10).
                "convert-gen9" => await Gen9Commands.ConvertAsync(
                    Required(options, "input")),
                // Расстановка своих моделей: типы, карта и манифест (МСЛ-зоны, ТЗ 08.10).
                "compile-placements" => await PlacementCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Постоянные типы места: копии вещей места под своими именами (фикс 2).
                "compile-place-types" => await PlaceTypesCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Ступени «Ухудшения текстур»: словари игры со срезанными верхними mip.
                "downscale-textures" => await TextureLevelCommands.BuildAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Стиль мира на кадре RGBA (сверка правила хоста с правилом окна, ТЗ 17.10.2026).
                "style-pixels" => await TextureStyles.PixelsAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Стиль мира на настоящей текстуре с цепочкой mip (сверка и тест, задача 35).
                "style-texture" => await TextureStyles.TextureAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Свои маленькие словари из листов DDS — полотна арены по одному (задача 10).
                "pack-textures" => await TextureDictionaryCommands.PackAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // «Интерьеры» снаружи (задача 3 ТЗ 10.10.2026): листы общего словаря квартала — копией в модель места.
                "shop-embed-textures" => await ShopCommands.EmbedTexturesAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Свой лист у части модели, что делит лист с соседями (задача 11 ТЗ 17.10.2026).
                "split-sheet-surfaces" => await SheetSplitCommands.SplitAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Новая текстура и развёртка по оси — цветовые эффекты зон.
                "restyle-drawable" => await RestyleDrawableCommands.RestyleAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Листы и прозрачность модели игры (DXT5, шейдеры _alpha) — «Остановки».
                "restyle-model" => await RestyleModelCommands.RestyleAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Фонари: столб — краска корпуса, блеск, прозрачность и украшения в модели (.yft).
                "lamp-pole" => await LampPoleCommands.BuildAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Карта с коробкой модификатора таймцикла на всю карту — «Дальность прорисовки».
                "compile-timecycle-box" => await TimecycleBoxCommands.CompileAsync(
                    Required(options, "input"),
                    Required(options, "output")),
                // Круг «клип → XML → клип» на настоящем клипе игры и черновике XML опытов (C0).
                "ycd-roundtrip" => YcdRoundtripCommands.Run(
                    ExistingFile(Required(options, "input"), ".ycd"),
                    Optional(options, "xml") is { } draftXml ? ExistingFile(draftXml, ".xml") : null),
                // XML клипа → .ycd (опытный DLC astral_exp).
                "ycd-from-xml" => YcdRoundtripCommands.FromXml(
                    ExistingFile(Required(options, "xml"), ".xml"),
                    OutputFile(Required(options, "output"), ".ycd")),
                // Поза из клипа игры — «В руках» мастерской оружия (ТЗ 06.10, вечер, задача 2).
                "sample-anim-pose" => AnimPoseCommands.Sample(
                    ExistingFile(Required(options, "input"), ".ycd"),
                    Optional(options, "clip"),
                    Optional(options, "time")),
                _ => throw new ArgumentException($"Unsupported native command: {command}"),
            };
            WriteJson(new { ok = true, command, result });
            return 0;
        }
        catch (Exception error)
        {
            WriteJson(new
            {
                ok = false,
                error = new { code = error.GetType().Name, message = error.Message },
            });
            return 1;
        }
    }

    private static async Task<object> RestorePatchAsync(Dictionary<string, List<string>> options)
    {
        var restorePointId = Required(options, "restore-point");
        if (restorePointId.Length > 80 || restorePointId.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
            throw new ArgumentException("Invalid restore point identifier.");

        var restorePointsRoot = RestorePointsRoot(options);
        var restoreRoot = Inside(restorePointsRoot, restorePointId);
        var manifestPath = Inside(restoreRoot, "restore.json");
        if (!File.Exists(manifestPath)) throw new FileNotFoundException("Restore point manifest was not found.");

        var manifest = JsonSerializer.Deserialize<RestoreManifest>(
            await File.ReadAllTextAsync(manifestPath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException("Restore point manifest is invalid.");
        var gameRoot = Path.GetFullPath(manifest.GameRoot ?? "");
        if (!Directory.Exists(gameRoot)) throw new DirectoryNotFoundException("The original GTA V directory was not found.");
        if (manifest.Archives is not { Count: > 0 }) throw new InvalidDataException("Restore point has no archives.");

        var items = new List<RestoreItem>();
        foreach (var archive in manifest.Archives)
        {
            var relative = NormalizeRelative(archive.RelativePath);
            var backup = Inside(restoreRoot, relative);
            var live = Inside(gameRoot, relative);
            if (!File.Exists(backup)) throw new FileNotFoundException($"Restore archive is missing: {relative}");
            if (!string.Equals(await Sha256Async(backup), archive.Sha256Before, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Restore archive checksum mismatch: {relative}");
            // Архив обязан быть ровно тем, который оставила установка. Иначе
            // копия прежнего архива стёрла бы всё, что легло в него позже, —
            // чужие моды, другую работу мастерской, обновление игры.
            if (!string.IsNullOrWhiteSpace(archive.Sha256After))
            {
                if (!File.Exists(live)) throw new FileNotFoundException($"Live RPF is missing: {relative}");
                if (!string.Equals(await Sha256Async(live), archive.Sha256After, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException(
                        $"{relative} изменился после этой установки: в него ставили другие моды или игра обновилась. " +
                        "Откат вернул бы прежний архив и молча стёр бы эти изменения. Сначала откатите то, что ставили позже, " +
                        "а если обновлялась сама GTA V — проверьте файлы игры в Steam.");
            }
            items.Add(new RestoreItem(relative, backup, live, live + ".astral-current-stage"));
        }

        try
        {
            foreach (var item in items)
            {
                if (!File.Exists(item.LivePath)) throw new FileNotFoundException($"Live RPF is missing: {item.RelativePath}");
                File.Copy(item.LivePath, item.CurrentStagePath, true);
            }
            foreach (var item in items) File.Copy(item.BackupPath, item.LivePath, true);
        }
        catch
        {
            foreach (var item in items.Where(item => File.Exists(item.CurrentStagePath)))
                File.Copy(item.CurrentStagePath, item.LivePath, true);
            throw;
        }
        finally
        {
            foreach (var item in items.Where(item => File.Exists(item.CurrentStagePath)))
                File.Delete(item.CurrentStagePath);
        }

        // Точка использована: живой архив теперь байт в байт её копия. Два
        // гигабайта ей больше незачем занимать, а повторный откат той же точки
        // после новых установок был бы ровно той ошибкой, от которой защищает
        // проверка отпечатка выше. Не удалилась — не беда: откат уже случился.
        try
        {
            Directory.Delete(restoreRoot, recursive: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }

        return new { id = restorePointId, gameRoot, archives = items.Select(item => item.RelativePath).ToArray() };
    }

    // Точки отката живут в папке кэша, которую выбрал человек (22.10.2026): приложение передаёт её
    // аргументом. Без аргумента — прежняя папка в LocalApplicationData, как у старых вызовов.
    private static string RestorePointsRoot(Dictionary<string, List<string>> options)
    {
        var chosen = Optional(options, "restore-points-root");
        if (string.IsNullOrWhiteSpace(chosen))
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Astral", "cache", "backups", "native-rpf", "restore-points");
        if (!Path.IsPathFullyQualified(chosen))
            throw new ArgumentException("--restore-points-root must be an absolute path.");
        return Path.GetFullPath(chosen);
    }

    /// <summary>
    /// Читает один файл из архива игры и кладёт его на диск.
    ///
    /// Редактор неба правит поверх ТОГО файла, который реально стоит у игрока:
    /// ванильного или уже заменённого чужим графическим модом. Без чтения из
    /// архива пришлось бы возить в установщике копию данных Rockstar и
    /// применять правку вслепую. Команда только читает и ничего не пишет в игру.
    /// </summary>
    private static async Task<object> ReadArchiveFileAsync(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);

        var entryPath = Required(options, "entry");
        var archiveRelative = ResolveRootArchive(entryPath)
            ?? throw new ArgumentException($"Unsupported archive entry: {entryPath}");
        var archivePath = Inside(gameRoot, archiveRelative);
        if (!File.Exists(archivePath))
            throw new FileNotFoundException($"Archive was not found: {archiveRelative}");

        var inner = NormalizeRelative(StripArchivePrefix(entryPath));
        var output = Path.GetFullPath(Required(options, "output"));
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);

        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        using var archive = RageArchiveWrapper7.OpenRead(archivePath);
        var bytes = ExtractEntry(archive.Root, inner.Split('/'), 0, archive.archive_.Encryption)
            ?? throw new FileNotFoundException($"Archive entry was not found: {entryPath}");
        // Читаемый файл — это текст конфигурации, а не ресурс: сотня мегабайт
        // здесь означала бы, что путь ведёт не туда, куда думает вызывающий.
        if (bytes.Length > 32 * 1024 * 1024)
            throw new InvalidDataException($"Archive entry is too large to read: {entryPath}");
        await File.WriteAllBytesAsync(output, bytes);
        return new
        {
            entry = entryPath,
            archive = archiveRelative,
            output,
            bytes = bytes.Length,
            sha256 = Convert.ToHexString(SHA256.HashData(bytes)),
            keySource,
        };
    }

    private static string StripArchivePrefix(string value)
    {
        var path = (value ?? "").Replace('\\', '/').Trim();
        var colon = path.IndexOf(':');
        return colon >= 0 ? path[(colon + 1)..] : path;
    }

    /// Файлы найденного мода из чужого архива — в папку будущего пакета.
    private static object ExtractArchiveEntries(Dictionary<string, List<string>> options)
    {
        var input = ExistingFile(Required(options, "input"), ".rpf");
        var outputDirectory = Path.GetFullPath(Required(options, "output-dir"));
        KeyLoader.EnsureLoaded(Optional(options, "game-root") ?? string.Empty, Optional(options, "keys"));
        return ArchiveIndexCommands.Extract(input, outputDirectory, Values(options, "entry"));
    }

    private static object ListArchiveEntries(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var archiveRelative = NormalizeRelative(Required(options, "archive"));
        var archivePath = Inside(gameRoot, archiveRelative);
        if (!File.Exists(archivePath))
            throw new FileNotFoundException($"Archive was not found: {archiveRelative}");
        var filter = (Optional(options, "filter") ?? "").Trim();
        // Лимит по умолчанию прежний; индексу целого архива (сотни тысяч
        // записей) нужен и больший потолок, и файл вместо stdout.
        var maxEntries = Math.Clamp(
            int.TryParse(Optional(options, "max-entries"), out var requestedMax) ? requestedMax : 4000,
            1,
            1_000_000);
        var maxDepth = Math.Clamp(
            int.TryParse(Optional(options, "depth"), out var requestedDepth) ? requestedDepth : 3,
            0,
            6);
        var output = Optional(options, "output");

        KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        using var archive = RageArchiveWrapper7.OpenRead(archivePath);
        var entries = new List<object>();
        var truncated = false;

        void Walk(IArchiveDirectory directory, string prefix, int depth)
        {
            if (truncated) return;
            foreach (var file in directory.GetFiles())
            {
                var path = prefix + file.Name;
                var nested = file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase);
                if (!nested || depth >= maxDepth)
                {
                    if (filter.Length == 0 ||
                        path.Contains(filter, StringComparison.OrdinalIgnoreCase))
                    {
                        if (entries.Count >= maxEntries) { truncated = true; return; }
                        entries.Add(new { path, size = file.Size });
                    }
                }
                if (nested && depth < maxDepth && file is IArchiveBinaryFile binary)
                {
                    // Вложенный архив листается, даже если сам не прошёл
                    // фильтр: искомые записи лежат внутри него.
                    try
                    {
                        using var inner = RageArchiveWrapper7.Open(binary.GetStream(), file.Name, leaveOpen: true);
                        Walk(inner.Root, path + "/", depth + 1);
                    }
                    catch
                    {
                        // Нечитаемый вложенный архив — не повод ронять листинг
                        // целиком: его имя уже в списке, дальше пусто.
                    }
                }
            }
            foreach (var child in directory.GetDirectories())
                Walk(child, prefix + child.Name + "/", depth);
        }

        Walk(archive.Root, "", 0);
        if (!string.IsNullOrWhiteSpace(output))
        {
            var target = Path.GetFullPath(output);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, JsonSerializer.Serialize(
                new { archive = archiveRelative, filter, truncated, count = entries.Count, entries },
                JsonOptions));
            return new { archive = archiveRelative, filter, truncated, count = entries.Count, output = target };
        }
        return new { archive = archiveRelative, filter, truncated, count = entries.Count, entries };
    }

    /// Спуск по вложенным каталогам архива; последний сегмент — искомый файл.
    private static byte[]? ExtractEntry(IArchiveDirectory directory, string[] segments, int depth,
        RageArchiveEncryption7 encryption)
    {
        if (directory is null || depth >= segments.Length) return null;
        var name = segments[depth];
        if (depth == segments.Length - 1)
        {
            var file = directory.GetFiles()
                .FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
            if (file is null) return null;
            using var buffer = new MemoryStream();
            file.Export(buffer);
            var raw = buffer.ToArray();
            // Export двоичной записи отдаёт сырое содержимое как оно лежит в
            // архиве. На старых сборках update.rpf это был готовый текст, и
            // казалось, что Export расшифровывает сам; на свежих Steam-сборках
            // записи зашифрованы NG и сжаты deflate, и «текст конфигурации»
            // без этого шага — высокоэнтропийный мусор, который валит разбор
            // выше по течению. Ресурсные записи (.ytd и родня) идут прежним
            // путём: их собирает в RSC7 сам Export, а эта команда читает
            // текстовые конфигурации.
            if (file is IArchiveBinaryFile binary)
                raw = DecodeBinaryEntry(binary, encryption, raw);
            return raw;
        }
        var next = directory.GetDirectories()
            .FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
        if (next is not null)
            return ExtractEntry(next, segments, depth + 1, encryption);

        // Сегмент — не каталог, а вложенный архив (ptfx.rpf/core.ypt,
        // x18dlc_int_01.rpf/…): открываем его как архив и спускаемся дальше
        // уже с его собственным шифрованием. Листинг архива это умел, чтение
        // записи — нет, и ядро эффектов «не находилось» в живом update.rpf.
        if (!name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase)) return null;
        var nestedFile = directory.GetFiles()
            .FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
        if (nestedFile is not IArchiveBinaryFile nestedBinary) return null;
        using var inner = RageArchiveWrapper7.Open(nestedBinary.GetStream(), nestedFile.Name, leaveOpen: true);
        return ExtractEntry(inner.Root, segments, depth + 1, inner.archive_.Encryption);
    }

    /// <summary>
    /// Двоичная запись RPF7 в открытый вид: расшифровка по режиму архива и
    /// распаковка deflate. Формула выбора NG-ключа — та же, что при чтении
    /// заголовка (<see cref="RageArchiveWrapper7.Open(string)"/>), но, как и в
    /// эталонном CodeWalker, от ИМЕНИ ЗАПИСИ и её НЕСЖАТОГО размера.
    ///
    /// Зашифрованная запись архива не-AES — это NG, каким бы ни был маркер
    /// оглавления («если не AES — NG», как у игры и CodeWalker). Оглавление
    /// OPEN оставляет OpenIV после правки update.rpf, и его же пишет RageLib
    /// (RageArchive7.Flush не умеет NG-оглавление); записи, которых правка не
    /// коснулась, остаются зашифрованными NG поштучно. Прежде такая запись
    /// уходила в Inflate шифртекстом, и чтение отвечало «The archive entry was
    /// compressed using an unsupported compression method» (бета 14–15.10:
    /// bloodfx.dat и соседи у игроков с редуксами, поставленными через OpenIV).
    /// </summary>
    private static byte[] DecodeBinaryEntry(IArchiveBinaryFile file, RageArchiveEncryption7 encryption, byte[] raw)
    {
        var data = raw;
        if (file.IsEncrypted)
        {
            if (encryption != RageArchiveEncryption7.AES)
            {
                if (GTA5Constants.PC_LUT is null || GTA5Constants.PC_NG_KEYS is null)
                    throw new InvalidOperationException("NG-encrypted entry requires the GTA V key set.");
                var index =
                    (RageLib.GTA5.Cryptography.GTA5Hash.CalculateHash(file.Name)
                        + (uint)file.UncompressedSize + (101 - 40)) % 0x65;
                data = GTA5Crypto.Decrypt(data, GTA5Constants.PC_NG_KEYS[index]);
            }
            else
            {
                if (GTA5Constants.PC_AES_KEY is null)
                    throw new InvalidOperationException("AES-encrypted entry requires the GTA V key set.");
                // AES-ECB без набивки, шифруются только полные 16-байтовые
                // блоки; хвост короче блока хранится открытым.
                using var aes = Aes.Create();
                aes.Key = GTA5Constants.PC_AES_KEY;
                aes.Mode = CipherMode.ECB;
                aes.Padding = PaddingMode.None;
                var whole = data.Length - (data.Length % 16);
                using var transform = aes.CreateDecryptor();
                var decrypted = new byte[data.Length];
                if (whole > 0)
                    transform.TransformBlock(data, 0, whole, decrypted, 0);
                Array.Copy(data, whole, decrypted, whole, data.Length - whole);
                data = decrypted;
            }
        }
        if (file.IsCompressed)
        {
            using var source = new MemoryStream(data);
            using var inflate = new DeflateStream(source, CompressionMode.Decompress);
            using var output = new MemoryStream(
                file.UncompressedSize > 0 && file.UncompressedSize < int.MaxValue
                    ? (int)file.UncompressedSize
                    : 0);
            inflate.CopyTo(output);
            data = output.ToArray();
        }
        return data;
    }

    private static string GameRoot(Dictionary<string, List<string>> options)
    {
        var gameRoot = Path.GetFullPath(Required(options, "game-root"));
        if (!Directory.Exists(gameRoot) ||
            !new[] { "GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe" }.Any(x => File.Exists(Path.Combine(gameRoot, x))))
            throw new DirectoryNotFoundException("The selected directory is not a GTA V installation.");
        return gameRoot;
    }

    /// <summary>
    /// Порядок, в котором просматриваются архивы игры. Сначала те, где файл
    /// лежит обычно, затем остальные x64-архивы — чтобы сборка с переложенным
    /// содержимым не оставила предпросмотр ни с чем.
    /// </summary>
    private static IEnumerable<string> ArchiveSearchOrder(string gameRoot)
    {
        foreach (var archive in Vanilla())
        {
            // Слой mods читает не папка, а загрузчик: без него игра берёт
            // ванильный архив, и предпочесть mods значило бы соврать в другую
            // сторону — забытая папка пережила бы удаление загрузчика.
            var layered = ModsLayer(gameRoot, archive);
            yield return layered ?? archive;
        }

        IEnumerable<string> Vanilla()
        {
            yield return "x64a.rpf";
            yield return Path.Combine("update", "update.rpf");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "x64a.rpf" };
            foreach (var file in Directory.EnumerateFiles(gameRoot, "x64*.rpf", SearchOption.TopDirectoryOnly)
                         .Select(Path.GetFileName)
                         .Where(x => !string.IsNullOrEmpty(x))
                         .OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                if (seen.Add(file!)) yield return file!;
        }
    }

    /// <summary>
    /// Копия архива в слое `mods`, если игра её действительно читает.
    ///
    /// Признаком служит загрузчик OpenIV рядом с игрой, а не наличие папки:
    /// `mods` без `dinput8.dll` игра не открывает, и брать оттуда содержимое
    /// значило бы показать человеку не его игру. Копии нет — возвращается
    /// null, и вызывающий остаётся на ванильном архиве.
    /// </summary>
    private static string? ModsLayer(string gameRoot, string archive)
    {
        if (!ModsLoaderPresent(gameRoot)) return null;
        var relative = Path.Combine("mods", archive);
        return File.Exists(Path.Combine(gameRoot, relative)) ? relative : null;
    }

    /*
     * Чем игру заставляют читать `mods`. Нужны ОБА: загрузчик без плагина
     * ничего не подменяет, плагин без загрузчика не запускается.
     *
     * Пара `dinput8.dll` + `OpenIV.asi` — не единственная и даже не самая
     * частая у наших людей: сам Astral ставит `RageOpenV.asi`, а Enhanced
     * грузится через `xinput1_4.dll`. Проверка по одной паре означала бы, что
     * у человека, чей слой появился от нашего же установщика, карта читается
     * из ванильного архива, пока игра читает `mods`.
     *
     * Списки повторяют `ASI_LOADERS` и `MODS_PLUGINS` из
     * `apps/desktop/src/game-archive-layer.js`; хост на JS не смотрит, поэтому
     * совпадение держит тест `tests/world-map-customizer.test.js`.
     */
    private static readonly string[] AsiLoaders =
        ["dinput8.dll", "xinput1_4.dll", "dsound.dll"];

    private static readonly string[] ModsPlugins =
        ["OpenIV.asi", "RageOpenV.asi", "OpenRPF.asi", "ClosedIV.asi"];

    private static bool ModsLoaderPresent(string gameRoot) =>
        AsiLoaders.Any(name => File.Exists(Path.Combine(gameRoot, name))) &&
        ModsPlugins.Any(name => File.Exists(Path.Combine(gameRoot, name)));

    private static string? ResolveRootArchive(string value)
    {
        var path = (value ?? "").Replace('\\', '/').Trim();
        if (path.Equals("setup2.xml", StringComparison.OrdinalIgnoreCase) ||
            path.Equals("assembly.xml", StringComparison.OrdinalIgnoreCase)) return null;
        if (path.StartsWith("common:/", StringComparison.OrdinalIgnoreCase)) return "common.rpf";
        if (path.StartsWith("update:/", StringComparison.OrdinalIgnoreCase)) return "update/update.rpf";
        var colon = path.IndexOf(':');
        if (colon > 0)
        {
            var prefix = path[..colon];
            return prefix.Equals("update", StringComparison.OrdinalIgnoreCase)
                ? "update/update.rpf"
                : NormalizeRelative(prefix + ".rpf");
        }
        return "update/update.rpf";
    }

    private static Dictionary<string, List<string>> ParseOptions(string[] args)
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            var token = args[index];
            if (!token.StartsWith("--", StringComparison.Ordinal) || token.Length < 3)
                throw new ArgumentException($"Invalid native option: {token}");
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
                throw new ArgumentException($"A value is required for {token}.");
            var key = token[2..];
            if (!result.TryGetValue(key, out var values)) result[key] = values = [];
            values.Add(args[++index]);
        }
        return result;
    }

    private static string Required(Dictionary<string, List<string>> options, string key) =>
        Optional(options, key) ?? throw new ArgumentException($"--{key} is required.");
    private static string? Optional(Dictionary<string, List<string>> options, string key) =>
        options.TryGetValue(key, out var values) ? values.LastOrDefault() : null;
    private static IReadOnlyList<string> Values(Dictionary<string, List<string>> options, string key) =>
        options.TryGetValue(key, out var values) ? values : [];
    private static string ExistingFile(string value, params string[] extensions)
    {
        var file = Path.GetFullPath(value);
        if (!File.Exists(file)) throw new FileNotFoundException($"File was not found: {file}");
        if (extensions.Length > 0 && !extensions.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase))
            throw new ArgumentException($"Unsupported file extension: {Path.GetExtension(file)}");
        return file;
    }
    private static string OutputFile(string value, params string[] extensions)
    {
        var file = Path.GetFullPath(value);
        if (!extensions.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase))
            throw new ArgumentException($"Unsupported output extension: {Path.GetExtension(file)}");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        return file;
    }
    private static string NormalizeRelative(string value)
    {
        var path = (value ?? "").Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrWhiteSpace(path) || Path.IsPathRooted(path) || path.Split('/').Any(x => x is "" or "." or ".."))
            throw new InvalidDataException($"Unsafe relative path: {value}");
        return path;
    }
    private static string Inside(string root, string relative)
    {
        var basePath = Path.GetFullPath(root);
        var target = Path.GetFullPath(Path.Combine(basePath, NormalizeRelative(relative)));
        var diff = Path.GetRelativePath(basePath, target);
        if (diff.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(diff))
            throw new InvalidDataException($"Path escapes its allowed directory: {relative}");
        return target;
    }

    /// <summary>
    /// Плитки большой карты из установки игрока — подложка редактора.
    /// Читаются, как и текстуры неба, из его собственной игры: вместе с уже
    /// стоящим у него графическим модом и без единой записи в архив.
    /// </summary>
    /*
     * Где искать плитки карты и за какой архив игры отвечает найденное.
     *
     * `--base-archive` подменяет `update/update.rpf`: после установки своей
     * карты живой архив несёт уже её плитки, и основой для редактора должна
     * служить резервная копия, снятая до первой установки, — иначе «как в
     * игре» возвращало бы не карту Rockstar, а прошлую правку. Патч при этом
     * по-прежнему целит в живой архив.
     */
    private static IEnumerable<MapTiles.ArchiveSlot> MapArchiveSlots(
        string gameRoot,
        string? baseArchive)
    {
        foreach (var archive in ArchiveSearchOrder(gameRoot))
        {
            var normalized = archive.Replace(Path.DirectorySeparatorChar, '/');
            var isUpdate = normalized.EndsWith("update/update.rpf", StringComparison.OrdinalIgnoreCase);
            yield return new MapTiles.ArchiveSlot(
                isUpdate && baseArchive is not null ? baseArchive : archive,
                archive);
        }
    }

    private static string? MapBaseArchive(Dictionary<string, List<string>> options)
    {
        var value = Optional(options, "base-archive");
        return value is null ? null : ExistingFile(value, ".rpf");
    }

    /// <summary>
    /// Собирает патч большой карты: подменяет пиксели плиток игрока новыми DDS
    /// и пишет манифест, который дальше применяет общий установщик RPF.
    /// </summary>
    private static object BuildMapPatch(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var output = Path.GetFullPath(Required(options, "output"));
        Directory.CreateDirectory(output);
        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        var replacements = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in Values(options, "tile"))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0)
                throw new ArgumentException("Плитка задаётся как имя=путь к DDS.");
            var name = pair[..separator].Trim();
            var file = ExistingFile(pair[(separator + 1)..].Trim(), ".dds");
            if (Path.GetFileName(name) != name)
                throw new ArgumentException($"Недопустимое имя плитки: {name}");
            replacements[name] = file;
        }
        var baseArchive = MapBaseArchive(options);
        return new
        {
            keySource,
            baseArchive,
            map = MapTiles.BuildPatch(
                gameRoot,
                MapArchiveSlots(gameRoot, baseArchive),
                replacements,
                output),
        };
    }

    /// <summary>Архив игрока, в котором лежат векторные плитки радара.</summary>
    private static IEnumerable<string> RadarArchives(string gameRoot) =>
        ArchiveSearchOrder(gameRoot)
            .Where(archive => Path.GetFileName(archive)
                .Equals("x64e.rpf", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Палитра векторных плиток радара: какие цвета в них есть. Окно красит
    /// их тем же конвейером, что и растровую карту.
    /// </summary>
    private static object MinimapTileColours(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        return new
        {
            keySource,
            radar = MinimapRadar.TileColours(gameRoot, RadarArchives(gameRoot)),
        };
    }

    /// <summary>
    /// Перекрашивает векторные плитки радара парами «было=стало», дописывает
    /// слои большой карты из файлов `--overlay` (`MinimapRadar.Overlay.cs`) и
    /// выкладывает изменённые плитки файлами.
    /// </summary>
    private static object PaintMinimapTiles(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var output = Path.GetFullPath(Required(options, "output"));
        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        var overlays = Values(options, "overlay").Select(value => ExistingFile(value, ".aro")).ToList();
        var colours = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in Values(options, "colour"))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0)
                throw new ArgumentException("Цвет задаётся как RRGGBBAA=RRGGBBAA.");
            var from = pair[..separator].Trim();
            var to = pair[(separator + 1)..].Trim();
            if (!RadarColour.IsMatch(from) || !RadarColour.IsMatch(to))
                throw new ArgumentException($"Недопустимая пара цветов: {pair}");
            colours[from] = to;
        }
        return new
        {
            keySource,
            radar = MinimapRadar.PaintTiles(gameRoot, RadarArchives(gameRoot), colours, output, overlays),
        };
    }

    /// <summary>ТОЛЬКО ЧТЕНИЕ: высоты, цвета, шейдеры и габариты штатных плиток радара.</summary>
    private static object InspectMinimapTiles(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        return new
        {
            keySource,
            radar = MinimapRadar.InspectTiles(gameRoot, RadarArchives(gameRoot)),
        };
    }

    /// <summary>
    /// Проба: поднимает вершины цветов `--lift RRGGBBAA=dz` (по желанию в окне
    /// высот `--z-from`…`--z-to`) и перекрашивает поднятые `--tint RRGGBBAA=RRGGBBAA`.
    /// </summary>
    private static object LiftMinimapTiles(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var output = Path.GetFullPath(Required(options, "output"));
        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        var lifts = new Dictionary<string, float>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in Values(options, "lift"))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0)
                throw new ArgumentException("Подъём задаётся как RRGGBBAA=метры.");
            var colour = pair[..separator].Trim();
            if (!RadarColour.IsMatch(colour) ||
                !float.TryParse(pair[(separator + 1)..].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var rise) ||
                !float.IsFinite(rise) || Math.Abs(rise) > 500f)
                throw new ArgumentException($"Недопустимая пара подъёма: {pair}");
            lifts[colour] = rise;
        }
        var tints = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in Values(options, "tint"))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0)
                throw new ArgumentException("Цвет задаётся как RRGGBBAA=RRGGBBAA.");
            var from = pair[..separator].Trim();
            var to = pair[(separator + 1)..].Trim();
            if (!RadarColour.IsMatch(from) || !RadarColour.IsMatch(to))
                throw new ArgumentException($"Недопустимая пара цветов: {pair}");
            tints[from] = to;
        }
        float? Height(string name)
        {
            var text = Optional(options, name);
            if (string.IsNullOrWhiteSpace(text)) return null;
            if (!float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) || !float.IsFinite(value))
                throw new ArgumentException($"Недопустимая высота --{name}: {text}");
            return value;
        }
        return new
        {
            keySource,
            radar = MinimapRadar.LiftTiles(
                gameRoot, RadarArchives(gameRoot), lifts, tints, Height("z-from"), Height("z-to"), output),
        };
    }

    /// <summary>
    /// Проба «здания со стенками»: к кварталам (цвета `--colour RRGGBBAA`, высотное окно `--z-from`…`--z-to`) добавляются слои до крыши.
    /// Высоты — из сетки `--height-grid` (JSON: x0, y0, cell, cols, rows, fallback, values), шаг слоёв `--spacing` (м), потолок слоёв `--layers-max`.
    /// </summary>
    private static object StackMinimapTiles(Dictionary<string, List<string>> options)
    {
        var gameRoot = GameRoot(options);
        var output = Path.GetFullPath(Required(options, "output"));
        var keySource = KeyLoader.EnsureLoaded(gameRoot, Optional(options, "keys"));
        var colours = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var colour in Values(options, "colour"))
        {
            if (!RadarColour.IsMatch(colour)) throw new ArgumentException($"Недопустимый цвет: {colour}");
            colours.Add(colour.ToUpperInvariant());
        }
        /* `--block RRGGBBAA=RRGGBBAA`: цвет квартала в плитках → его цвет по палитре карты (от него считаются стенки и крыша);
           `--paint RRGGBBAA=RRGGBBAA`: перекраска остальных вершин (как paint-minimap-tiles). Оба — по палитре карты игрока. */
        Dictionary<string, byte[]> Pairs(string name)
        {
            var result = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in Values(options, name))
            {
                var separator = pair.IndexOf('=');
                if (separator <= 0) throw new ArgumentException($"Пара --{name} задаётся как RRGGBBAA=RRGGBBAA.");
                var from = pair[..separator].Trim();
                var to = pair[(separator + 1)..].Trim();
                if (!RadarColour.IsMatch(from) || !RadarColour.IsMatch(to)) throw new ArgumentException($"Недопустимая пара цветов: {pair}");
                result[from] = Convert.FromHexString(to);
            }
            return result;
        }
        var blockFinal = Pairs("block");
        foreach (var from in blockFinal.Keys) colours.Add(from.ToUpperInvariant());
        var paint = Pairs("paint");
        if (blockFinal.Count > 64 || paint.Count > 512) throw new ArgumentException("Слишком много цветов в одном запросе.");
        float Number(string name, float fallback)
        {
            var text = Optional(options, name);
            if (string.IsNullOrWhiteSpace(text)) return fallback;
            if (!float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) || !float.IsFinite(value))
                throw new ArgumentException($"Недопустимое число --{name}: {text}");
            return value;
        }
        MinimapRadar.HeightGrid? grid = null;
        var gridPath = Optional(options, "height-grid");
        if (!string.IsNullOrWhiteSpace(gridPath))
        {
            using var document = JsonDocument.Parse(File.ReadAllBytes(Path.GetFullPath(gridPath)));
            var root = document.RootElement;
            grid = new MinimapRadar.HeightGrid
            {
                X0 = root.GetProperty("x0").GetDouble(),
                Y0 = root.GetProperty("y0").GetDouble(),
                Cell = root.GetProperty("cell").GetDouble(),
                Cols = root.GetProperty("cols").GetInt32(),
                Rows = root.GetProperty("rows").GetInt32(),
                Fallback = root.TryGetProperty("fallback", out var fallback) ? fallback.GetInt32() : 12,
                Values = root.GetProperty("values").EnumerateArray().Select(item => item.GetInt32()).ToArray(),
            };
            if (grid.Cell <= 0 || grid.Cols <= 0 || grid.Rows <= 0 || grid.Values.Length != grid.Cols * grid.Rows)
                throw new ArgumentException("Сетка высот неполная: ячеек не cols × rows.");
        }
        return new
        {
            keySource,
            radar = MinimapRadar.StackTiles(
                gameRoot,
                RadarArchives(gameRoot),
                colours,
                Number("z-from", 5f),
                Number("z-to", 13f),
                grid,
                Number("spacing", 2.5f),
                (int)Number("layers-max", 40f),
                output,
                blockFinal.Count > 0 ? blockFinal : null,
                paint.Count > 0 ? paint : null,
                Number("height-scale", 1f)),
        };
    }

    private static readonly Regex RadarColour = new("^[0-9a-fA-F]{8}$", RegexOptions.Compiled);

    private static async Task<string> Sha256Async(string file)
    {
        await using var stream = File.OpenRead(file);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream));
    }
    private static void WriteJson(object value) => Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions));

    // `Sha256Before` — null, пока резервная копия — жёсткая ссылка, а отпечаток
    // ещё не снят инжектором (`NativeLinks`).
    private sealed record ArchiveBackup(string RelativePath, string LivePath, string BackupPath, string? Sha256Before, string? Sha256After = null);
    private sealed record RestoreManifest(string? GameRoot, List<RestoreArchive>? Archives);
    // `Sha256After` нет у точек первой схемы: для них откат ведёт себя как раньше.
    private sealed record RestoreArchive(string RelativePath, string Sha256Before, string? Sha256After = null);
    private sealed record RestoreItem(string RelativePath, string BackupPath, string LivePath, string CurrentStagePath);
}
