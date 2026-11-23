using System.Text.Json;

namespace Modovik.Native.Host.Checks;

/// <summary>Общие помощники проверок плиток: слоты, «игра» из синтетических архивов, вызов сборки патча.</summary>
internal static class TileGames
{
    public static MapTiles.ArchiveSlot Slot(string path) => new(path, path);

    public static MapTiles.ArchiveSlot X64a => Slot("x64a.rpf");

    public static MapTiles.ArchiveSlot Update => Slot("update/update.rpf");

    /// <summary>Плитка-ресурс с меткой в теле (разбирать как YTD её не нужно: ищется только по имени).</summary>
    public static Res Tile(string name, char label) => new(name, F.Blob(label));

    /// <summary>Запись ресурса, чей размер в оглавлении меньше 16 байт: Export у неё бросает OverflowException.</summary>
    public static Res Unreadable(string name) => new(name, F.Blob('b', 30)) { Declared = 8 };

    /// <summary>Плитка, у которой есть заголовок RSC7, но тело не разбирается как YTD.</summary>
    public static Res Corrupt(string name, int seed) => new(name, [.. F.Blob('x')[..16], .. F.Rand(64, seed)]);

    public static string Put(string folder, string relative, byte[] data)
    {
        string path = Path.Combine(folder, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, data);
        return path;
    }

    /// <summary>Находит плитки и возвращает «архив:запись» через «; » в порядке нахождения.</summary>
    public static string Entries(string game, params MapTiles.ArchiveSlot[] slots) =>
        string.Join("; ", MapTiles.Find(game, slots).Select(t => $"{t.Archive}:{t.Entry}"));

    /// <summary>DDS 8×8 в формате DXT1: картинка для замены, как её присылает мастерская.</summary>
    public static string WriteDds(string folder, string name = "picture")
    {
        byte[] dds = Dds.Make(DdsKind.Dxt1, 8, 8, 1, F.Pat(32, 185));
        return Put(folder, name + ".dds", dds);
    }

    /// <summary>Собирает патч для одной плитки; возвращает исключение или разобранный ответ.</summary>
    public static (JsonElement? Report, Exception? Error, string Output) Build(
        string game, string tile, string ddsPath, params MapTiles.ArchiveSlot[] slots)
    {
        Keys.Ensure();
        string output = Path.Combine(Sandbox.Fresh("out"), "patch");
        try
        {
            object report = MapTiles.BuildPatch(game, slots, new Dictionary<string, string> { [tile] = ddsPath }, output);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(report));
            return (document.RootElement.Clone(), null, output);
        }
        catch (Exception error)
        {
            return (null, error, output);
        }
    }

    /// <summary>Поле tiles[0] ответа сборки.</summary>
    public static string TileField(JsonElement report, string field) =>
        report.GetProperty("tiles")[0].GetProperty(field).ToString();
}
