// Построители входов для проверок: RPF7 без шифрования с оглавлением в заданном порядке, DDS и YTD.
// Перенесены из справочного набора проверок MapTiles; ниже — общие данные (F) и поддельные ключи.
using System.Text;
using CodeWalker.GameFiles;
using CodeWalker.Utils;

namespace Modovik.Native.Host.Checks;

// ---- синтетические архивы RPF7 без шифрования: оглавление пишется вручную, в нужном порядке ----

internal abstract record Node(string Name);

internal sealed record Dir(string Name, params Node[] Kids) : Node(Name);

internal sealed record Bin(string Name, byte[] Data) : Node(Name)
{
    /// <summary>Поле «размер сжатого» заполнено (запись считается сжатой).</summary>
    public bool Packed { get; init; }
    public uint? Plain { get; init; }
    public uint? PackedSize { get; init; }
    public bool Encrypted { get; init; }
    public int? BlockOffset { get; init; }
}

internal sealed record Res(string Name, byte[] Data) : Node(Name)
{
    public int? Declared { get; init; }
    public int? BlockOffset { get; init; }
}

internal static class Rpf
{
    public const uint Open = 0x4E45504F; // «OPEN» — без шифрования
    public const uint Aes = 0x0FFFFFF9;
    public const uint Ng = 0x0FEFFFFF;

    public static byte[] Build(Dir root, uint marker = Open)
    {
        // Порядок записей: корень, его дети, потом дети каждого подкаталога по очереди.
        var flat = new List<Node> { root };
        var first = new Dictionary<Dir, int>(ReferenceEqualityComparer.Instance);
        var queue = new Queue<Dir>();
        queue.Enqueue(root);
        while (queue.Count > 0)
        {
            var dir = queue.Dequeue();
            first[dir] = flat.Count;
            flat.AddRange(dir.Kids);
            foreach (var kid in dir.Kids)
                if (kid is Dir sub) queue.Enqueue(sub);
        }

        var names = new MemoryStream();
        names.WriteByte(0);
        var nameOffsets = new Dictionary<string, int> { [""] = 0 };
        foreach (var node in flat.Skip(1))
        {
            if (nameOffsets.ContainsKey(node.Name)) continue;
            nameOffsets[node.Name] = (int)names.Length;
            var bytes = Encoding.UTF8.GetBytes(node.Name);
            names.Write(bytes);
            names.WriteByte(0);
        }
        while (names.Length % 16 != 0) names.WriteByte(0);

        var headerSize = 16 + 16 * flat.Count + (int)names.Length;
        var nextBlock = (headerSize + 511) / 512;
        var blocks = new Dictionary<Node, int>(ReferenceEqualityComparer.Instance);
        foreach (var node in flat)
        {
            switch (node)
            {
                case Bin b when b.BlockOffset is { } over:
                    blocks[b] = over;
                    break;
                case Res r when r.BlockOffset is { } over:
                    blocks[r] = over;
                    break;
                case Bin b:
                    blocks[b] = nextBlock;
                    nextBlock += (b.Data.Length + 511) / 512;
                    break;
                case Res r:
                    blocks[r] = nextBlock;
                    nextBlock += (r.Data.Length + 511) / 512;
                    break;
            }
        }

        var file = new MemoryStream();
        var w = new BinaryWriter(file);
        w.Write(0x52504637u);
        w.Write((uint)flat.Count);
        w.Write((uint)names.Length);
        w.Write(marker);

        foreach (var node in flat)
        {
            switch (node)
            {
                case Dir d:
                    w.Write((uint)nameOffsets[d.Name]);
                    w.Write(0x7FFFFF00u);
                    w.Write((uint)first[d]);
                    w.Write((uint)d.Kids.Length);
                    break;
                case Bin b:
                    var size = b.PackedSize ?? (b.Packed ? (uint)b.Data.Length : 0u);
                    w.Write((ushort)nameOffsets[b.Name]);
                    Write3(w, size);
                    Write3(w, (uint)blocks[b]);
                    w.Write(b.Plain ?? (uint)b.Data.Length);
                    w.Write(b.Encrypted ? 1u : 0u);
                    break;
                case Res r:
                    w.Write((ushort)nameOffsets[r.Name]);
                    Write3(w, (uint)(r.Declared ?? r.Data.Length));
                    Write3(w, (uint)blocks[r] | 0x800000u);
                    var (sys, gfx) = Flags(r.Data);
                    w.Write(sys);
                    w.Write(gfx);
                    break;
            }
        }

        w.Write(names.ToArray());
        file.SetLength(Math.Max(file.Length, (long)nextBlock * 512));
        foreach (var node in flat)
        {
            switch (node)
            {
                case Bin b when b.BlockOffset is null && b.Data.Length > 0:
                    file.Position = blocks[b] * 512L;
                    file.Write(b.Data);
                    break;
                case Res r when r.BlockOffset is null && r.Data.Length > 0:
                    file.Position = blocks[r] * 512L;
                    file.Write(r.Data);
                    break;
            }
        }

        return file.ToArray();
    }

    private static void Write3(BinaryWriter w, uint value)
    {
        w.Write((byte)(value & 0xFF));
        w.Write((byte)((value >> 8) & 0xFF));
        w.Write((byte)((value >> 16) & 0xFF));
    }

    private static (uint sys, uint gfx) Flags(byte[] data) =>
        data.Length >= 16
            ? (BitConverter.ToUInt32(data, 8), BitConverter.ToUInt32(data, 12))
            : (0x00020000u, 0xD0020000u);
}

// ---- DDS: заголовки пишутся вручную ----

internal enum DdsKind { Dxt1, Dxt3, Dxt5, A8R8G8B8, Bc7, Rgba32F, Abcd }

internal static class Dds
{
    public static byte[] Make(DdsKind kind, uint width, uint height, uint mips, byte[] data)
    {
        var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        w.Write(0x20534444u); // «DDS »
        w.Write(124u);
        w.Write(0x000A1007u); // CAPS|HEIGHT|WIDTH|PIXELFORMAT|MIPMAPCOUNT|LINEARSIZE
        w.Write(height);
        w.Write(width);
        w.Write((uint)data.Length);
        w.Write(0u);
        w.Write(mips);
        for (var i = 0; i < 11; i++) w.Write(0u);

        // DDS_PIXELFORMAT
        w.Write(32u);
        switch (kind)
        {
            case DdsKind.A8R8G8B8:
                w.Write(0x41u); w.Write(0u); w.Write(32u);
                w.Write(0x00FF0000u); w.Write(0x0000FF00u); w.Write(0x000000FFu); w.Write(0xFF000000u);
                break;
            default:
                w.Write(4u);
                w.Write(kind switch
                {
                    DdsKind.Dxt1 => FourCc("DXT1"),
                    DdsKind.Dxt3 => FourCc("DXT3"),
                    DdsKind.Dxt5 => FourCc("DXT5"),
                    DdsKind.Abcd => FourCc("ABCD"),
                    _ => FourCc("DX10"),
                });
                w.Write(0u); w.Write(0u); w.Write(0u); w.Write(0u); w.Write(0u);
                break;
        }

        w.Write(0x00401008u); // caps: COMPLEX|MIPMAP|TEXTURE
        w.Write(0u); w.Write(0u); w.Write(0u); w.Write(0u);

        if (kind is DdsKind.Bc7 or DdsKind.Rgba32F)
        {
            w.Write(kind == DdsKind.Bc7 ? 98u : 2u); // BC7_UNORM / R32G32B32A32_FLOAT
            w.Write(3u); // TEXTURE2D
            w.Write(0u);
            w.Write(1u);
            w.Write(0u);
        }

        w.Write(data);
        return ms.ToArray();
    }

    private static uint FourCc(string s) => BitConverter.ToUInt32(Encoding.ASCII.GetBytes(s));
}

// ---- YTD: через YtdFile и DDSIO из CodeWalker ----

internal sealed record Tex(string Name, byte[] Dds, uint Usage = 0, uint Extra = 0);

internal static class Ytd
{
    public static byte[] Make(Tex[] textures, uint[]? header = null, bool keepOrder = false)
    {
        var dict = new TextureDictionary();
        if (header is { Length: 4 })
        {
            dict.Unknown_10h = header[0];
            dict.Unknown_14h = header[1];
            dict.Unknown_18h = header[2];
            dict.Unknown_1Ch = header[3];
        }

        var list = new List<CodeWalker.GameFiles.Texture>();
        foreach (var t in textures)
        {
            var tex = DDSIO.GetTexture(t.Dds);
            tex.Name = t.Name;
            tex.NameHash = JenkHash.GenHash(t.Name.ToLowerInvariant());
            tex.UsageData = t.Usage;
            tex.ExtraFlags = t.Extra;
            list.Add(tex);
        }

        var order = list.ToArray();
        dict.BuildFromTextureList(list);
        if (keepOrder)
        {
            dict.Textures.data_items = order;
            dict.TextureNameHashes.data_items = order.Select(t => t.NameHash).ToArray();
        }

        return new YtdFile { TextureDict = dict }.Save();
    }

    /// <summary>Строка вида «словарь[10h=… 14h=… 18h=… 1Ch=…] имя#ХЕШ WxH ФОРМАТ L1 S4 U1234 E1 D32 | …».</summary>
    public static string Describe(byte[] file)
    {
        var ytd = new YtdFile();
        ytd.Load(file);
        var d = ytd.TextureDict;
        var items = d.Textures.data_items.Select(t =>
            $"{t.Name}#{t.NameHash:X8} {t.Width}x{t.Height} {t.Format} L{t.Levels} S{t.Stride} U{t.UsageData:X} E{t.ExtraFlags} D{t.Data.FullData.Length}");
        return $"словарь[10h={d.Unknown_10h:X8} 14h={d.Unknown_14h:X8} 18h={d.Unknown_18h:X8} 1Ch={d.Unknown_1Ch:X8}] "
               + string.Join(" | ", items);
    }
}

// ---- общие входы: узор данных, плитки, «update.rpf» игрока ----

internal static class F
{
    public const string Cdi = "x64/data/cdimages/scaleform_generic.rpf";

    /// <summary>Узор данных DDS: (основа + i*11) ^ (i/8).</summary>
    public static byte[] Pat(int n, int b) =>
        Enumerable.Range(0, n).Select(i => (byte)((b + i * 11) ^ (i / 8))).ToArray();

    /// <summary>Заголовок RSC7 версии 13, как у файлов CodeWalker, и один байт-метка.</summary>
    public static byte[] Blob(char label, int extra = 0)
    {
        var data = new byte[17 + extra];
        BitConverter.GetBytes(0x37435352u).CopyTo(data, 0);
        BitConverter.GetBytes(13u).CopyTo(data, 4);
        BitConverter.GetBytes(0x00020000u).CopyTo(data, 8);
        BitConverter.GetBytes(0xD0020000u).CopyTo(data, 12);
        data[16] = (byte)label;
        for (var i = 17; i < data.Length; i++) data[i] = (byte)'x';
        return data;
    }

    public static byte[] Rand(int n, int seed)
    {
        var data = new byte[n];
        new Random(seed).NextBytes(data);
        return data;
    }

    /// <summary>YTD с одной текстурой DXT1 8×8, как у плиток «живого» update.rpf.</summary>
    public static byte[] Src(string name, uint usage, uint extra, int seed = 185) =>
        Ytd.Make([new Tex(name, Dds.Make(DdsKind.Dxt1, 8, 8, 1, Pat(32, seed)), usage, extra)]);

    /// <summary>update.rpf: x64/data/cdimages/scaleform_generic.rpf, а в нём плитки.</summary>
    public static byte[] Update(params Node[] tiles) =>
        Rpf.Build(new Dir("",
            new Dir("x64",
                new Dir("data",
                    new Dir("cdimages",
                        new Bin("scaleform_generic.rpf", Rpf.Build(new Dir("", tiles))))))));

    public static string Sha(byte[] data) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(data));
}

/// <summary>Поддельный набор ключей правильных размеров: настоящих ключей игры здесь нет.</summary>
internal static class Keys
{
    private static bool _loaded;

    private static byte[] Noise(int n, int seed)
    {
        var data = new byte[n];
        new Random(seed).NextBytes(data);
        return data;
    }

    public static void Ensure()
    {
        if (_loaded)
            return;

        RageLib.GTA5.Cryptography.GTA5Constants.PC_AES_KEY = Noise(32, 1);
        RageLib.GTA5.Cryptography.GTA5Constants.PC_NG_KEYS = Enumerable.Range(0, 101).Select(i => Noise(0x110, 100 + i)).ToArray();
        var tables = new uint[17][][];
        for (var i = 0; i < 17; i++)
        {
            tables[i] = new uint[16][];
            for (var j = 0; j < 16; j++) tables[i][j] = new uint[256];
        }

        RageLib.GTA5.Cryptography.GTA5Constants.PC_NG_DECRYPT_TABLES = tables;
        RageLib.GTA5.Cryptography.GTA5Constants.PC_LUT = Noise(256, 2);
        _loaded = true;
    }
}
