namespace Modovik.Native.Host.Checks;

/// <summary>
/// MapTiles.Find и «не найдена»: что случается с записью, которая не читается, и куда уходит причина.
/// Ошибка чтения не должна обрывать обход верхнего архива без следа.
/// </summary>
internal static class MapTilesReadChecks
{
    private static readonly string Overflow = new OverflowException().Message;

    private static string Folder() => Sandbox.Fresh("game");

    // Верхний архив: годная, нечитаемая, годная, затем каталог d с плиткой.
    private static string GameWithBrokenEntry()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("",
            TileGames.Tile("minimap_1_0.ytd", 'a'),
            TileGames.Unreadable("minimap_1_1.ytd"),
            TileGames.Tile("minimap_1_2.ytd", 'c'),
            new Dir("d", TileGames.Tile("minimap_1_3.ytd", 'd')))));
        return game;
    }

    private static string NotFoundMessage(string game, string tile, params MapTiles.ArchiveSlot[] slots)
    {
        var (report, error, _) = TileGames.Build(game, tile, TileGames.WriteDds(Folder()), slots);
        Expect.True(report is null && error is FileNotFoundException, $"ожидалось FileNotFoundException «не найдена», получено: {Expect.Describe(error)}");
        return error!.Message;
    }

    [Check("Find: нечитаемая запись верхнего архива пропускается, остальные плитки и каталоги читаются")]
    public static void BrokenTopLevelEntryIsSkipped()
    {
        Keys.Ensure();
        string got = TileGames.Entries(GameWithBrokenEntry(), TileGames.X64a);

        Expect.Equal(
            "x64a.rpf:minimap_1_0.ytd; x64a.rpf:minimap_1_2.ytd; x64a.rpf:d/minimap_1_3.ytd",
            got,
            "после нечитаемой записи (Бт18) обход продолжается: следующий файл и каталог того же архива не потеряны");
    }

    [Check("BuildPatch: «не найдена» называет причину чтения записи верхнего архива")]
    public static void NotFoundNamesTheTopLevelReadFailure()
    {
        string message = NotFoundMessage(GameWithBrokenEntry(), "minimap_1_1.ytd", TileGames.X64a);

        Expect.True(message.StartsWith("Плитка minimap_1_1.ytd не найдена в архивах игры."), $"текст «не найдена» остаётся началом сообщения: {message}");
        Expect.True(message.Contains("x64a.rpf:minimap_1_1.ytd"), $"в сообщении должны быть архив и запись, которые не прочитались: {message}");
        Expect.True(message.Contains(Overflow), $"в сообщении должен быть текст ошибки чтения («{Overflow}»): {message}");
    }

    [Check("BuildPatch: «не найдена» без сбоев чтения — прежний текст дословно")]
    public static void NotFoundWithoutFailuresKeepsTheOldText()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", TileGames.Tile("minimap_0_0.ytd", 'a'))));

        Expect.Equal(
            "Плитка minimap_9_9.ytd не найдена в архивах игры.",
            NotFoundMessage(game, "minimap_9_9.ytd", TileGames.X64a, TileGames.Update),
            "сбоев чтения не было (архива update.rpf просто нет): сообщение прежнее");
    }

    // Вложенный архив: годная, нечитаемая, годная; в родителе после него ещё плитка.
    private static string GameWithBrokenNestedEntry()
    {
        string game = Folder();
        byte[] inner = Rpf.Build(new Dir("",
            TileGames.Tile("minimap_2_0.ytd", 'a'),
            TileGames.Unreadable("minimap_2_1.ytd"),
            TileGames.Tile("minimap_2_2.ytd", 'c')));
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", new Bin("n.rpf", inner), TileGames.Tile("minimap_2_3.ytd", 'e'))));
        return game;
    }

    [Check("Find: ошибка во вложенном архиве обрывает только этот архив, родитель идёт дальше")]
    public static void NestedFailureStopsOnlyTheNestedArchive()
    {
        Keys.Ensure();
        string got = TileGames.Entries(GameWithBrokenNestedEntry(), TileGames.X64a);

        Expect.Equal(
            "x64a.rpf:n.rpf/minimap_2_0.ytd; x64a.rpf:minimap_2_3.ytd",
            got,
            "Бт19: найденное во вложенном архиве до ошибки остаётся, остаток архива не читается, плитка родителя найдена");
    }

    [Check("BuildPatch: «не найдена» называет причину, из-за которой оборван вложенный архив")]
    public static void NotFoundNamesTheNestedReadFailure()
    {
        string message = NotFoundMessage(GameWithBrokenNestedEntry(), "minimap_2_2.ytd", TileGames.X64a);

        Expect.True(message.StartsWith("Плитка minimap_2_2.ytd не найдена в архивах игры."), $"текст «не найдена» остаётся началом сообщения: {message}");
        Expect.True(message.Contains("x64a.rpf:n.rpf/minimap_2_1.ytd"), $"в сообщении должен быть путь записи во вложенном архиве: {message}");
        Expect.True(message.Contains(Overflow), $"в сообщении должен быть текст ошибки чтения («{Overflow}»): {message}");
    }

    [Check("BuildPatch: «не найдена» называет вложенный архив, который не открылся")]
    public static void NotFoundNamesTheNestedArchiveThatWontOpen()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", new Bin("n.rpf", F.Rand(300, 3)))));

        string message = NotFoundMessage(game, "minimap_2_2.ytd", TileGames.X64a);

        Expect.True(message.StartsWith("Плитка minimap_2_2.ytd не найдена в архивах игры."), $"текст «не найдена» остаётся началом сообщения: {message}");
        Expect.True(message.Contains("x64a.rpf:n.rpf"), $"в сообщении должен быть вложенный архив, который не открылся: {message}");
    }

    [Check("BuildPatch: «не найдена» называет архив слота, который не открылся")]
    public static void NotFoundNamesTheSlotArchiveThatWontOpen()
    {
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", F.Rand(1000, 21));

        string message = NotFoundMessage(game, "minimap_0_0.ytd", TileGames.X64a);

        Expect.True(message.StartsWith("Плитка minimap_0_0.ytd не найдена в архивах игры."), $"текст «не найдена» остаётся началом сообщения: {message}");
        Expect.True(message.Contains("x64a.rpf"), $"в сообщении должен быть архив слота, который не открылся: {message}");
    }

    [Check("Find: нечитаемая копия плитки не занимает имя, годная копия из следующего слота берётся")]
    public static void UnreadableCopyDoesNotClaimTheName()
    {
        Keys.Ensure();
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("", TileGames.Unreadable("minimap_0_0.ytd"))));
        TileGames.Put(game, "update/update.rpf", F.Update(TileGames.Tile("minimap_0_0.ytd", 'U')));

        Expect.Equal(
            $"update/update.rpf:{F.Cdi}/minimap_0_0.ytd",
            TileGames.Entries(game, TileGames.X64a, TileGames.Update),
            "копия, которая не читается, пропущена, как будто её нет: берётся копия из update.rpf");
    }

    [Check("Find: годные входы без сбоев — прежний порядок и состав (Пр3)")]
    public static void HealthyOrderIsUnchanged()
    {
        Keys.Ensure();
        string game = Folder();
        TileGames.Put(game, "x64a.rpf", Rpf.Build(new Dir("",
            new Dir("d1", TileGames.Tile("minimap_1_0.ytd", 'a')),
            new Bin("n.rpf", Rpf.Build(new Dir("", new Dir("sub", TileGames.Tile("minimap_2_2.ytd", 'b')), TileGames.Tile("minimap_2_1.ytd", 'c')))),
            TileGames.Tile("minimap_3_0.ytd", 'd'),
            new Dir("d2", TileGames.Tile("minimap_4_0.ytd", 'e')),
            TileGames.Tile("minimap_5_0.ytd", 'f'))));

        Expect.Equal(
            "x64a.rpf:n.rpf/minimap_2_1.ytd; x64a.rpf:n.rpf/sub/minimap_2_2.ytd; x64a.rpf:minimap_3_0.ytd; x64a.rpf:minimap_5_0.ytd; x64a.rpf:d1/minimap_1_0.ytd; x64a.rpf:d2/minimap_4_0.ytd",
            TileGames.Entries(game, TileGames.X64a),
            "сначала файлы каталога (вложенный архив раскрывается на месте записи), потом подкаталоги");
    }
}
