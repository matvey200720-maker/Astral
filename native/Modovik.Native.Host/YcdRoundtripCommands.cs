using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Команды хоста для клипов анимаций: <c>ycd-roundtrip</c> (клип → XML → клип с тремя сверками и
/// необязательным черновиком) и <c>ycd-from-xml</c> (XML → файл .ycd). Разбор и сборку делает CodeWalker.
/// </summary>
internal static class YcdRoundtripCommands
{
    private const uint ResourceVersion = 46;
    private const long MaxStockBytes = 16L * 1024 * 1024;
    private const string TrackSeparator = " | ";

    /// <summary>Круг «клип → XML → клип» на штатном .ycd; с черновиком — ещё и сравнение устройства.</summary>
    public static object Run(string input, string? draft)
    {
        StockClip stock = StockClip.Open(input);
        RoundtripResult cycle = stock.CloseCycle();
        DraftReport? verdict = draft is null ? null : stock.JudgeDraft(draft);

        return new RoundtripReport(stock.Report(), cycle, verdict);
    }

    /// <summary>Собирает из XML словарь клипов и пишет .ycd; сводка читается заново из собранных байт.</summary>
    public static object FromXml(string xml, string output)
    {
        var (bytes, _, summary) = Assemble(File.ReadAllText(xml, Encoding.UTF8), Path.GetFileName(output));

        // Файл пишется, только если ответ о нём можно построить: иначе вызывающий получит ошибку и решит,
        // что файла нет, а он был бы на диске.
        RequireSerializable(summary);
        File.WriteAllBytes(output, bytes);
        return new BuildReport(Path.GetFileName(output), bytes.Length, Sha256Hex(bytes), summary);
    }

    // ---- штатный клип ----

    /// <summary>
    /// Штатный клип игры: файл прочитан, открыт как словарь клипов и признан целым; сводка снята один раз.
    /// Дальше от него нужны только три вещи: ответ о нём, круг через XML и сравнение с черновиком.
    /// </summary>
    private sealed class StockClip(string name, byte[] file, YcdFile dictionary, ClipSummary[] summary)
    {
        public static StockClip Open(string path)
        {
            byte[] file = ReadFile(path);
            string name = Path.GetFileName(path);
            YcdFile dictionary = OpenClip(file, name);
            RequireResourceHeader(file, name);
            return new StockClip(name, file, dictionary, Summarize(dictionary));
        }

        public StockReport Report() => new(name, file.Length, Sha256Hex(file), summary);

        public RoundtripResult CloseCycle()
        {
            string xml = YcdXml.GetXml(dictionary);
            var (bytes, reopened, again) = Assemble(xml, "roundtrip.ycd");

            return new RoundtripResult(
                bytes.Length,
                Sha256Hex(bytes),
                file.AsSpan().SequenceEqual(bytes),
                xml == YcdXml.GetXml(reopened),
                SameJson(summary, again));
        }

        public DraftReport JudgeDraft(string path)
        {
            var (bytes, _, drafted) = Assemble(File.ReadAllText(path, Encoding.UTF8), "draft.ycd");
            string[] notes = ShapeNotes(summary, drafted);
            return new DraftReport(Path.GetFileName(path), bytes.Length, Sha256Hex(bytes), drafted, notes.Length == 0, notes);
        }

        private static byte[] ReadFile(string path)
        {
            var info = new FileInfo(path);
            long size = info.Exists ? info.Length : -1;
            if (size is < 1 or > MaxStockBytes)
                throw new InvalidDataException("YCD input must be an existing file up to 16 MB.");
            return File.ReadAllBytes(path);
        }

        // Сосед открывает файл без заголовка RSC7 или с нулевыми системными флагами как пустой словарь, и сводка
        // выходит пустой, а команда отвечает успехом. Штатный клип игры такого вида иметь не может: это порча.
        // Проверка идёт после разбора, поэтому остальные отказы по файлу (соседа и «не словарь клипов») прежние.
        private static void RequireResourceHeader(byte[] file, string name)
        {
            if (!RpfFile.HasResourceHeader(file))
                throw new InvalidDataException($"{name}: RSC7 resource header is missing.");
            if (BitConverter.ToUInt32(file, 8) == 0)
                throw new InvalidDataException($"{name}: RSC7 resource header has zero system flags.");
        }
    }

    // ---- общие шаги ----

    private static YcdFile OpenClip(byte[] bytes, string name)
    {
        var clip = new YcdFile { Name = name };
        RpfFile.LoadResourceFile(clip, bytes, ResourceVersion);
        return clip.ClipDictionary is null ? throw new InvalidDataException($"{name}: not a clip dictionary.") : clip;
    }

    // NaN и бесконечность в длительности не записать в JSON: ошибка здесь — та же, что дала бы сборка ответа.
    private static void RequireSerializable(ClipSummary[] summary) => JsonSerializer.Serialize(summary);

    // XML → клип → сохранённые байты → те же байты, открытые заново под заданным именем, и сводка по ним.
    private static (byte[] Bytes, YcdFile Reopened, ClipSummary[] Summary) Assemble(string xml, string reopenAs)
    {
        byte[] bytes = XmlYcd.GetYcd(xml).Save();
        YcdFile reopened = OpenClip(bytes, reopenAs);
        return (bytes, reopened, Summarize(reopened));
    }

    // Сводки сравниваются по их JSON: NaN в длительности здесь бросает ArgumentException.
    private static bool SameJson(ClipSummary[] left, ClipSummary[] right) =>
        JsonSerializer.Serialize(left) == JsonSerializer.Serialize(right);

    private static string Sha256Hex(byte[] bytes) => string.Concat(SHA256.HashData(bytes).Select(b => b.ToString("x2")));

    // ---- сводка клипа ----

    private static ClipSummary[] Summarize(YcdFile ycd) =>
        (ycd.AnimMapEntries ?? [])
            .Where(entry => entry?.Animation is not null)
            .Select(entry => Describe(entry.Hash.Hash, entry.Animation))
            .OrderBy(row => row.Hash)
            .ToArray();

    private static ClipSummary Describe(uint hash, Animation animation) =>
        new(hash, animation.Frames, animation.SequenceFrameLimit, animation.Duration,
            animation.Unknown_1Ch.Hash, BoneList(animation), ChannelList(animation));

    // «КостьId/Дорожка/Unk0» через пробел, в порядке файла.
    private static string BoneList(Animation animation)
    {
        var bones = animation.BoneIds?.data_items ?? [];
        return string.Join(' ', bones.Select(bone => $"{bone.BoneId}/{bone.Track}/{bone.Unk0}"));
    }

    // Строка каналов каждой дорожки каждого блока, подряд, через « | ».
    private static string ChannelList(Animation animation)
    {
        var lines =
            from block in animation.Sequences?.data_items ?? []
            from track in block?.Sequences ?? []
            where track is not null
            select string.Join(',', (track.Channels ?? []).Where(channel => channel is not null).Select(channel => channel.Type));

        return string.Join(TrackSeparator, lines);
    }

    // ---- сравнение устройства ----

    private static string[] ShapeNotes(ClipSummary[] stock, ClipSummary[] draft)
    {
        // Сравниваются только первые записи: анимации с наименьшим хешем.
        if (stock.Length == 0 || draft.Length == 0)
            return ["в одном из клипов нет анимаций"];

        return ShapeDifferences(stock[0], draft[0]).ToArray();
    }

    // Порядок заметок — порядок проверок.
    private static IEnumerable<string> ShapeDifferences(ClipSummary s, ClipSummary d)
    {
        if (s.BoneIds != d.BoneIds)
            yield return $"дорожки: штатный «{s.BoneIds}», черновик «{d.BoneIds}»";
        if (s.Signature != d.Signature)
            yield return $"подпись: штатный {s.Signature:X8}, черновик {d.Signature:X8}";
        if (FrameMargin(s) != FrameMargin(d))
            yield return $"запас кадров: штатный {FrameMargin(s)}, черновик {FrameMargin(d)}";
        if (CanonicalChannels(s.Channels) != CanonicalChannels(d.Channels))
            yield return $"каналы: штатный «{s.Channels}», черновик «{d.Channels}»";
    }

    private static int FrameMargin(ClipSummary summary) => summary.SequenceFrameLimit - summary.Frames;

    // Каналы сравниваются как наборы: порядок внутри дорожки и порядок дорожек не важен.
    private static string CanonicalChannels(string channels)
    {
        var tracks = new List<string>();
        foreach (string track in Pieces(channels, TrackSeparator))
        {
            List<string> names = Pieces(track, ",");
            names.Sort(StringComparer.Ordinal);
            tracks.Add(string.Join(',', names));
        }

        tracks.Sort(StringComparer.Ordinal);
        return string.Join(TrackSeparator, tracks);
    }

    // Как string.Split по разделителю-строке без опций: у пустого текста один пустой кусок.
    private static List<string> Pieces(string text, string separator)
    {
        var pieces = new List<string>();
        int start = 0;
        for (int at = text.IndexOf(separator, StringComparison.Ordinal); at >= 0; at = text.IndexOf(separator, start, StringComparison.Ordinal))
        {
            pieces.Add(text[start..at]);
            start = at + separator.Length;
        }

        pieces.Add(text[start..]);
        return pieces;
    }

    // ---- формы ответа; имена полей закреплены атрибутами, чтобы не зависеть от политики кодировщика ----

    internal sealed record ClipSummary(
        [property: JsonPropertyName("hash")] uint Hash,
        [property: JsonPropertyName("frames")] ushort Frames,
        [property: JsonPropertyName("sequenceFrameLimit")] ushort SequenceFrameLimit,
        [property: JsonPropertyName("duration")] float Duration,
        [property: JsonPropertyName("signature")] uint Signature,
        [property: JsonPropertyName("boneIds")] string BoneIds,
        [property: JsonPropertyName("channels")] string Channels);

    internal sealed record StockReport(
        [property: JsonPropertyName("file")] string FileName,
        [property: JsonPropertyName("bytes")] int Bytes,
        [property: JsonPropertyName("sha256")] string Sha256,
        [property: JsonPropertyName("summary")] ClipSummary[] Summary);

    internal sealed record RoundtripResult(
        [property: JsonPropertyName("bytes")] int Bytes,
        [property: JsonPropertyName("sha256")] string Sha256,
        [property: JsonPropertyName("byteIdentical")] bool ByteIdentical,
        [property: JsonPropertyName("xmlIdentical")] bool XmlIdentical,
        [property: JsonPropertyName("summaryIdentical")] bool SummaryIdentical);

    internal sealed record DraftReport(
        [property: JsonPropertyName("file")] string FileName,
        [property: JsonPropertyName("bytes")] int Bytes,
        [property: JsonPropertyName("sha256")] string Sha256,
        [property: JsonPropertyName("summary")] ClipSummary[] Summary,
        [property: JsonPropertyName("sameShapeAsStock")] bool SameShapeAsStock,
        [property: JsonPropertyName("shapeNotes")] string[] ShapeNotes);

    internal sealed record RoundtripReport(
        [property: JsonPropertyName("stock")] StockReport Stock,
        [property: JsonPropertyName("roundtrip")] RoundtripResult Roundtrip,
        [property: JsonPropertyName("draft")] DraftReport? Draft);

    internal sealed record BuildReport(
        [property: JsonPropertyName("file")] string FileName,
        [property: JsonPropertyName("bytes")] int Bytes,
        [property: JsonPropertyName("sha256")] string Sha256,
        [property: JsonPropertyName("summary")] ClipSummary[] Summary);
}
