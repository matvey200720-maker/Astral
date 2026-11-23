using System.Text.Json;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host.Checks;

/// <summary>
/// MapTiles.BuildPatch: у плитки бывает несколько копий (x64a.rpf, update.rpf, ...). Если первая найденная
/// не разбирается как YTD, патч собирается из следующей; падает он только когда годных копий нет.
/// </summary>
internal static class MapTilesCopyChecks
{
    private const string Tile = "minimap_0_0.ytd";
    private const string UpdateEntry = F.Cdi + "/" + Tile;

    private static string Folder() => Sandbox.Fresh("game");

    private static MapTiles.ArchiveSlot X64b => TileGames.Slot("x64b.rpf");

    private static byte[] Good(uint usage = 0x1234, int seed = 185) => F.Src("minimap_0_0", usage, 1, seed);

    private static Res CorruptCopy(int seed) => TileGames.Corrupt(Tile, seed);

    // Что сосед (CodeWalker) отвечает на байты первой найденной копии: сравнение идёт с ним, а не с английской строкой.
    private static Exception? NeighborError(string game, MapTiles.ArchiveSlot slot)
    {
        Keys.Ensure();
        var found = MapTiles.Find(game, new[] { slot }).Single(t => t.FileName == Tile);
        var error = Expect.Failure(() => new YtdFile().Load(found.Bytes));
        Expect.True(error is not null, "испорченная копия должна не разбираться и у соседа (CodeWalker)");
        return error;
    }

    private static (JsonElement Report, string Output) BuildOrFail(string game, params MapTiles.ArchiveSlot[] slots)
    {
        var (report, error, output) = TileGames.Build(game, Tile, TileGames.WriteDds(Folder()), slots);
        Expect.True(report is not null, $"сборка должна пройти, но упала: {Expect.Describe(error)}");
        return (report.Value, output);
    }

    private static byte[] Payload(string output) => File.ReadAllBytes(Path.Combine(output, "payload", Tile));

    [Check("BuildPatch: испорченная первая копия плитки (Сб47) — берётся следующая из другого слота")]
    public static void BrokenFirstCopyFallsBackToTheNextSlot()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", CorruptCopy(33))));
        TileGames.Put(game, "update/update.rpf", F.Update(new Res(Tile, Good())));

        var (report, output) = BuildOrFail(game, TileGames.X64a, TileGames.Update);

        Expect.Equal("update/update.rpf", TileGames.TileField(report, "archive"), "собрано из копии update.rpf");
        Expect.Equal(UpdateEntry, TileGames.TileField(report, "entry"), "запись внутри update.rpf");
        Expect.Equal($"update:/{UpdateEntry}", report.GetProperty("targets")[0].GetString()!, "патч целится в ту копию, из которой собран");

        // Результат тот же, что у игры, где испорченной копии нет вовсе.
        string alone = Folder();
        TileGames.Put(alone, "update/update.rpf", F.Update(new Res(Tile, Good())));
        var (referenceReport, referenceOutput) = BuildOrFail(alone, TileGames.Update);
        Expect.Equal(TileGames.TileField(referenceReport, "sha256"), TileGames.TileField(report, "sha256"), "sha256 готового файла");
        Expect.True(Payload(referenceOutput).AsSpan().SequenceEqual(Payload(output)), "файл в payload побайтно тот же");
    }

    [Check("BuildPatch: порядок предпочтения копий при запасной — по слотам")]
    public static void FallbackKeepsTheSlotOrder()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", CorruptCopy(33))));
        TileGames.Put(game, "update/update.rpf", F.Update(new Res(Tile, Good(0x1234))));
        TileGames.Put(game, "x64b.rpf", Rpf.Build(new Dir("", new Res(Tile, Good(0x7777, 190)))));

        var (report, _) = BuildOrFail(game, TileGames.X64a, TileGames.Update, X64b);

        Expect.Equal("update/update.rpf", TileGames.TileField(report, "archive"), "следующая годная копия по порядку слотов, а не последняя");
    }

    [Check("BuildPatch: запасная копия берётся и из каталога ниже в том же архиве")]
    public static void FallbackReachesALaterCopyInTheSameArchive()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("",
            CorruptCopy(33),
            new Dir("d", new Res(Tile, Good())))));

        var (report, _) = BuildOrFail(game, TileGames.X64a);

        Expect.Equal($"d/{Tile}", TileGames.TileField(report, "entry"), "годная копия лежит в каталоге d того же архива");
    }

    [Check("BuildPatch: все копии не разбираются — ошибка называет каждую копию и причину")]
    public static void AllCopiesBrokenNamesEveryCopy()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", CorruptCopy(33))));
        TileGames.Put(game, "update/update.rpf", F.Update(CorruptCopy(34)));

        var (report, error, _) = TileGames.Build(game, Tile, TileGames.WriteDds(Folder()), TileGames.X64a, TileGames.Update);

        Expect.True(report is null && error is InvalidDataException, $"ожидалось InvalidDataException, получено: {Expect.Describe(error)}");
        string message = error!.Message;
        Expect.True(message.Contains($"x64a.rpf:{Tile}"), $"в сообщении должна быть первая копия: {message}");
        Expect.True(message.Contains($"update/update.rpf:{UpdateEntry}"), $"в сообщении должна быть вторая копия: {message}");
        Expect.True(message.Contains(NeighborError(game, TileGames.X64a)!.Message), $"в сообщении должна быть причина, по которой копия не разобралась: {message}");
    }

    [Check("BuildPatch: единственная испорченная копия — исключение соседа без изменений (Сб16)")]
    public static void SingleBrokenCopyKeepsTheNeighborError()
    {
        string game = Folder();
        TileGames.Put(game, "update/update.rpf", F.Update(CorruptCopy(31)));

        var (report, error, _) = TileGames.Build(game, Tile, TileGames.WriteDds(Folder()), TileGames.Update);

        Expect.True(report is null, "сборка из единственной испорченной копии должна падать");
        Expect.Equal(Expect.Describe(NeighborError(game, TileGames.Update)), Expect.Describe(error), "тип и текст ошибки те же, что у соседа, без обёртки");
    }

    [Check("BuildPatch: годная первая копия — вторая не читается совсем (одна строка трассы Export)")]
    public static void HealthyFirstCopyDoesNotReadTheOthers()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", new Res(Tile, Good(0x1234)))));
        TileGames.Put(game, "update/update.rpf", F.Update(CorruptCopy(34)));

        var capture = new StringWriter();
        var previous = Console.Out;
        Console.SetOut(capture);
        try
        {
            var (report, _) = BuildOrFail(game, TileGames.X64a, TileGames.Update);
            Expect.Equal("x64a.rpf", TileGames.TileField(report, "archive"), "годная первая копия побеждает");
        }
        finally
        {
            Console.SetOut(previous);
        }

        Expect.Equal(1, Regex.Matches(capture.ToString(), @"\[Export TRACE\]").Count, "прочитана одна копия: запасные читаются только по нужде");
    }

    [Check("Find: у плитки одна копия — первая найденная (Пр1)")]
    public static void FindStillReturnsOneCopyPerName()
    {
        Keys.Ensure();
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", TileGames.Tile(Tile, 'A'))));
        TileGames.Put(game, "update/update.rpf", F.Update(TileGames.Tile(Tile, 'B')));

        Expect.Equal(
            $"x64a.rpf:{Tile}",
            TileGames.Entries(game, TileGames.X64a, TileGames.Update),
            "запасные копии не попадают в результат Find");
    }

    [Check("BuildPatch: пропущенная по размеру запись по-прежнему занимает имя (Ог1)")]
    public static void SkippedBySizeStillClaimsTheName()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("",
            new Bin(Tile, []),
            new Dir("d", new Res(Tile, Good())))));

        var (report, error, _) = TileGames.Build(game, Tile, TileGames.WriteDds(Folder()), TileGames.X64a);

        Expect.True(report is null && error is FileNotFoundException, $"пустая запись держит имя: годная копия ниже не берётся; получено {Expect.Describe(error)}");
        Expect.Equal($"Плитка {Tile} не найдена в архивах игры.", error!.Message, "сбоев чтения не было, текст прежний");
    }
}
