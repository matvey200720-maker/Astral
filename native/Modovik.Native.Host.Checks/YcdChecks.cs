using System.Text.Json;

namespace Modovik.Native.Host.Checks;

/// <summary>
/// Команды хоста для клипов: ycd-roundtrip принимает только штатный клип (с заголовком RSC7), ycd-from-xml
/// не пишет файл, если ответ о нём построить нельзя. Входы — синтетические, собранные самим писателем клипов.
/// </summary>
internal static class YcdChecks
{
    // Клип опытов: один клип, одна анимация, две дорожки (0/17 и 0/18).
    private const string OneUv = """
<?xml version="1.0" encoding="UTF-8"?>
<ClipDictionary>
<Clips>
<Item>
<Hash>hash_00000001</Hash>
<Name>pack:/a_uv.clip</Name>
<Type value="Animation" />
<Unknown30 value="1" />
<Tags />
<Properties />
<AnimationHash>a_uv</AnimationHash>
<StartTime value="0" />
<EndTime value="0.0666666701" />
<Rate value="1" />
</Item>
</Clips>
<Animations>
<Item>
<Hash>a_uv</Hash>
<Unknown10 value="1" />
<FrameCount value="3" />
<SequenceFrameLimit value="17" />
<Duration value="0.0666666701" />
<Unknown1C>hash_6B002400</Unknown1C>
<BoneIds>
<Item>
<BoneId value="0" />
<Track value="17" />
<Unk0 value="0" />
</Item>
<Item>
<BoneId value="0" />
<Track value="18" />
<Unk0 value="0" />
</Item>
</BoneIds>
<Sequences>
<Item>
<Hash />
<FrameCount value="3" />
<SequenceData>
<Item>
<Channels>
<Item>
<Type value="StaticFloat" />
<Value value="1" />
</Item>
<Item>
<Type value="StaticFloat" />
<Value value="0" />
</Item>
<Item>
<Type value="QuantizeFloat" />
<Quantum value="0.001" />
<Offset value="-1" />
<Values>
0 -0.5 -1
</Values>
</Item>
</Channels>
</Item>
<Item>
<Channels>
<Item>
<Type value="StaticVector3" />
<Value x="0" y="1" z="0" />
</Item>
</Channels>
</Item>
</SequenceData>
</Item>
</Sequences>
</Item>
</Animations>
</ClipDictionary>
""";

    private static string DurationXml(string duration) =>
        OneUv.Replace("<Duration value=\"0.0666666701\" />", $"<Duration value=\"{duration}\" />");

    private static string Folder() => Sandbox.Fresh("ycd");

    // Размер файла для сообщения: подсказка нужна только тогда, когда файл есть.
    private static string Size(string path) => File.Exists(path) ? new FileInfo(path).Length.ToString() : "нет файла";

    private static string WriteXml(string folder, string name, string xml)
    {
        string path = Path.Combine(folder, name);
        File.WriteAllText(path, xml);
        return path;
    }

    /// <summary>Штатный клип: собирается из OneUv тем же писателем, что и клипы опытов.</summary>
    private static byte[] StockBytes()
    {
        string folder = Folder();
        string output = Path.Combine(folder, "stock.ycd");
        YcdRoundtripCommands.FromXml(WriteXml(folder, "one-uv.xml", OneUv), output);
        return File.ReadAllBytes(output);
    }

    private static string WriteStock(string name, byte[] bytes)
    {
        string path = Path.Combine(Folder(), name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    private static byte[] WithFlags(byte[] stock, uint system, uint graphics)
    {
        var bytes = (byte[])stock.Clone();
        BitConverter.GetBytes(system).CopyTo(bytes, 8);
        BitConverter.GetBytes(graphics).CopyTo(bytes, 12);
        return bytes;
    }

    private static (JsonElement? Report, Exception? Error) RunRoundtrip(string input)
    {
        try
        {
            object report = YcdRoundtripCommands.Run(input, null);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(report));
            return (document.RootElement.Clone(), null);
        }
        catch (Exception error)
        {
            return (null, error);
        }
    }

    private static int ClipsIn(JsonElement report) => report.GetProperty("stock").GetProperty("summary").GetArrayLength();

    private static string AcceptedAsEmpty(JsonElement report) =>
        $"команда ответила успехом, в сводке штатного клипа записей: {ClipsIn(report)}";

    // ---------------------------------------------------------------- ycd-roundtrip

    [Check("ycd-roundtrip: штатный клип без заголовка RSC7 — ошибка, а не пустая сводка")]
    public static void StockWithoutHeaderIsAnError()
    {
        string path = WriteStock("e-nohdr.ycd", StockBytes()[16..]);

        var (report, error) = RunRoundtrip(path);

        Expect.True(report is null, "файл без заголовка RSC7 принят за пустой словарь: " + (report is { } r ? AcceptedAsEmpty(r) : ""));
        Expect.True(error is InvalidDataException, $"ожидалось InvalidDataException, получено {Expect.Describe(error)}");
        Expect.True(error!.Message.Contains("RSC7") && error.Message.Contains("e-nohdr.ycd"), $"текст должен называть файл и заголовок RSC7: {error.Message}");
    }

    [Check("ycd-roundtrip: штатный клип с нулевыми флагами ресурса — ошибка, а не пустая сводка")]
    public static void StockWithZeroFlagsIsAnError()
    {
        string path = WriteStock("e-flags0.ycd", WithFlags(StockBytes(), 0, 0));

        var (report, error) = RunRoundtrip(path);

        Expect.True(report is null, "клип с нулевыми флагами принят за пустой словарь: " + (report is { } r ? AcceptedAsEmpty(r) : ""));
        Expect.True(error is InvalidDataException, $"ожидалось InvalidDataException, получено {Expect.Describe(error)}");
        Expect.True(error!.Message.Contains("RSC7") && error.Message.Contains("e-flags0.ycd"), $"текст должен называть файл и заголовок RSC7: {error.Message}");
    }

    [Check("ycd-roundtrip: нулевые системные флаги при ненулевых графических — тоже ошибка")]
    public static void StockWithZeroSystemFlagsIsAnError()
    {
        byte[] stock = StockBytes();
        uint graphics = BitConverter.ToUInt32(stock, 12);
        string path = WriteStock("e-sys0.ycd", WithFlags(stock, 0, graphics));

        var (report, error) = RunRoundtrip(path);

        Expect.True(report is null, "клип без системных страниц принят за пустой словарь: " + (report is { } r ? AcceptedAsEmpty(r) : ""));
        Expect.True(error is InvalidDataException, $"ожидалось InvalidDataException, получено {Expect.Describe(error)}");
    }

    [Check("ycd-roundtrip: годный клип и пустой словарь писателя принимаются как раньше")]
    public static void HealthyStockStillAccepted()
    {
        var (report, error) = RunRoundtrip(WriteStock("good.ycd", StockBytes()));
        Expect.True(report is not null, $"годный клип должен приниматься: {Expect.Describe(error)}");
        Expect.Equal(1, ClipsIn(report.Value), "в сводке одна анимация");
        Expect.True(report.Value.GetProperty("roundtrip").GetProperty("byteIdentical").GetBoolean(), "круг «клип → XML → клип» даёт те же байты");

        // Графические флаги не нужны для разбора: клип с ненулевыми системными принимается, как в Ош17.
        byte[] stock = StockBytes();
        var (graphicsOnly, graphicsError) = RunRoundtrip(WriteStock("gfx.ycd", WithFlags(stock, BitConverter.ToUInt32(stock, 8), BitConverter.ToUInt32(stock, 12) + 1)));
        Expect.True(graphicsOnly is not null, $"отличие только в графических флагах ошибкой не считается: {Expect.Describe(graphicsError)}");

        // Пустой словарь, собранный писателем, — настоящий файл с заголовком и ненулевыми флагами.
        string folder = Folder();
        string empty = Path.Combine(folder, "empty.ycd");
        YcdRoundtripCommands.FromXml(WriteXml(folder, "empty.xml", "<Foo />"), empty);
        var (emptyReport, emptyError) = RunRoundtrip(empty);
        Expect.True(emptyReport is not null, $"пустой словарь с настоящим заголовком принимается: {Expect.Describe(emptyError)}");
        Expect.Equal(0, ClipsIn(emptyReport.Value), "в сводке пустого словаря нет записей");
    }

    [Check("ycd-roundtrip: прежние отказы по штатному файлу не изменились")]
    public static void OtherStockErrorsAreUnchanged()
    {
        byte[] stock = StockBytes();
        string Failure(string name, byte[] bytes)
        {
            var (report, error) = RunRoundtrip(WriteStock(name, bytes));
            return report is null ? Expect.Describe(error) : "успех";
        }

        // Одно слово и обрезок не дочитываются до заголовка: ошибка соседа.
        Expect.Equal("ArgumentException", Failure("e-1b.ycd", [1]).Split(':')[0], "1 байт");
        Expect.Equal("ArgumentException", Failure("e-15b.ycd", stock[..15]).Split(':')[0], "15 байт");
        // Заголовок без тела и чужая сигнатура: ошибка распаковки соседа.
        Expect.Equal("InvalidDataException", Failure("e-hdr.ycd", stock[..16]).Split(':')[0], "только заголовок");
        byte[] rsc8 = (byte[])stock.Clone();
        rsc8[3] = (byte)'8';
        Expect.Equal("InvalidDataException", Failure("e-rsc8.ycd", rsc8).Split(':')[0], "сигнатура RSC8");
        // Системные флаги +1: заголовок есть, но словарь не собирается.
        Expect.Equal(
            "InvalidDataException: e-flags1.ycd: not a clip dictionary.",
            Failure("e-flags1.ycd", WithFlags(stock, BitConverter.ToUInt32(stock, 8) + 1, BitConverter.ToUInt32(stock, 12))),
            "системные флаги +1");
        Expect.Equal("InvalidDataException: YCD input must be an existing file up to 16 MB.", Failure("e-empty.ycd", []), "пустой файл");
    }

    // ---------------------------------------------------------------- ycd-from-xml

    [Check("ycd-from-xml: NaN в длительности — ошибка и файл не пишется")]
    public static void NanDurationWritesNoFile()
    {
        string folder = Folder();
        string xml = WriteXml(folder, "nan.xml", DurationXml("NaN"));
        string output = Path.Combine(folder, "nan.ycd");

        var error = Expect.Failure(() => YcdRoundtripCommands.FromXml(xml, output));

        Expect.True(error is ArgumentException, $"сборка с NaN должна отказать ArgumentException до записи файла (число не записать в JSON, ответ всё равно не построить), получено {Expect.Describe(error)}");
        Expect.Equal(
            Expect.Describe(Expect.Failure(() => JsonSerializer.Serialize(float.NaN))),
            Expect.Describe(error),
            "ошибка та же, что даёт сборка ответа");
        Expect.True(!File.Exists(output), $"файл записан ({Size(output)} байт), а ответ — ошибка: вызывающий решит, что файла нет");
    }

    [Check("ycd-from-xml: бесконечность в длительности — ошибка и файл не пишется")]
    public static void InfiniteDurationWritesNoFile()
    {
        string folder = Folder();
        string xml = WriteXml(folder, "inf.xml", DurationXml("Infinity"));
        string output = Path.Combine(folder, "inf.ycd");

        var error = Expect.Failure(() => YcdRoundtripCommands.FromXml(xml, output));

        Expect.True(error is not null, "длительность «Infinity» должна давать ошибку до записи файла (бесконечность не записать в JSON)");
        Expect.True(!File.Exists(output), $"файл записан ({Size(output)} байт), а ответ — ошибка");
    }

    [Check("ycd-from-xml: NaN не трогает уже лежащий файл вывода")]
    public static void NanDurationLeavesAnExistingFile()
    {
        string folder = Folder();
        string xml = WriteXml(folder, "nan.xml", DurationXml("NaN"));
        string output = Path.Combine(folder, "keep.ycd");
        byte[] before = [1, 2, 3, 4, 5];
        File.WriteAllBytes(output, before);

        var error = Expect.Failure(() => YcdRoundtripCommands.FromXml(xml, output));

        Expect.True(error is ArgumentException, $"сборка с NaN должна отказать ArgumentException, получено {Expect.Describe(error)}");
        Expect.True(File.ReadAllBytes(output).AsSpan().SequenceEqual(before), "прежний файл вывода перезаписан, хотя сборка закончилась ошибкой");
    }

    [Check("ycd-from-xml: годный XML — файл записан, ответ описывает его же")]
    public static void SuccessfulBuildWritesTheFile()
    {
        string folder = Folder();
        string xml = WriteXml(folder, "one-uv.xml", OneUv);
        string output = Path.Combine(folder, "out", "one-uv.ycd");
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);

        object report = YcdRoundtripCommands.FromXml(xml, output);

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(report));
        byte[] written = File.ReadAllBytes(output);
        Expect.Equal(written.Length, document.RootElement.GetProperty("bytes").GetInt32(), "размер в ответе равен размеру файла");
        Expect.Equal(
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(written)).ToLowerInvariant(),
            document.RootElement.GetProperty("sha256").GetString()!,
            "sha256 в ответе равен хешу файла");
        Expect.Equal(1, document.RootElement.GetProperty("summary").GetArrayLength(), "в сводке одна анимация");
    }
}
