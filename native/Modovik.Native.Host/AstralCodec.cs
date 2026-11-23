using System.Runtime.InteropServices;

namespace Modovik.Native.Host;

/// <summary>
/// Тонкая оболочка над готовой библиотекой astral_codec.dll: разжимает и сжимает уровни текстур
/// блоками BC. Приводит размеры, один раз сверяет версию интерфейса и превращает любой отказ
/// библиотеки в исключение с понятной причиной.
/// </summary>
internal static class AstralCodec
{
    /// <summary>Сколько байт занимают блоки уровня. Арифметика без проверки переполнения.</summary>
    internal static int BlockBytes(uint format, int width, int height)
    {
        int blockSize = format is Bc1 or Bc4 ? 8 : 16;
        return unchecked(blockSize * CellsAcross(height) * CellsAcross(width));
    }

    /// <summary>RGBA8 → блоки BC, новый массив ровно BlockBytes(...) байт.</summary>
    internal static byte[] Encode(uint format, byte[] rgba, int width, int height)
    {
        return Run(true, format, rgba, width, height);
    }

    /// <summary>Блоки BC → RGBA8, новый массив ровно width × height × 4 байт.</summary>
    internal static byte[] Decode(uint format, byte[] data, int width, int height)
    {
        return Run(false, format, data, width, height);
    }

    // Один путь для обеих сторон. Порядок: версия, выделение выхода, длина входа (null падает здесь),
    // нативный вызов, разбор кода возврата.
    private static byte[] Run(bool encoding, uint format, byte[] input, int width, int height)
    {
        _ = AbiChecked.Value;
        byte[] output = new byte[encoding ? BlockBytes(format, width, height) : checked(width * height * 4)];
        nuint inputLength = (nuint)input.Length;
        uint columns = unchecked((uint)width);
        uint rows = unchecked((uint)height);
        int code = encoding
            ? Imports.Encode(format, input, inputLength, columns, rows, output, (nuint)output.Length)
            : Imports.Decode(format, input, inputLength, columns, rows, output, (nuint)output.Length);
        if (code != 0)
            throw Failure(encoding ? "encode" : "decode", format, code);

        return output;
    }

    private static int CellsAcross(int side)
    {
        unchecked
        {
            return (side + 3) / 4;
        }
    }

    // Версия интерфейса сверяется до первого вызова; неудача не запоминается (режим без кэша исключений).
    private static readonly Lazy<bool> AbiChecked = new(CheckAbi, LazyThreadSafetyMode.PublicationOnly);

    private static bool CheckAbi()
    {
        uint found = Imports.AbiVersion();
        if (found == RequiredAbi)
            return true;

        throw new InvalidOperationException(FormattableString.Invariant($"{Imports.Library}: ABI {found}, host needs {RequiredAbi}."));
    }

    private static InvalidOperationException Failure(string operation, uint format, int code)
    {
        string reason = code switch
        {
            1 => "bad arguments",
            2 => "format not supported",
            3 => "buffer length does not match the image",
            4 => "internal error in the codec",
            _ => "unknown codec error",
        };
        return new InvalidOperationException(
            FormattableString.Invariant($"BC codec {operation} (format {format}) failed: {reason} (code {code})."));
    }

    private const uint RequiredAbi = 1;

    // Коды форматов — числа DXGI.
    internal const uint Bc1 = 71, Bc2 = 74, Bc3 = 77, Bc4 = 80, Bc5 = 83, Bc7 = 98;

    // Границы ABI с astral_codec.dll: имена точек входа и соглашение о вызове заданы библиотекой.
    private static class Imports
    {
        internal const string Library = "astral_codec.dll";

        [DllImport(Library, EntryPoint = "astral_codec_abi_version", CallingConvention = CallingConvention.Cdecl)]
        internal static extern uint AbiVersion();

        [DllImport(Library, EntryPoint = "astral_decode_bc", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int Decode(
            uint format, [In] byte[] data, nuint dataLength, uint width, uint height, [Out] byte[] output, nuint outputLength);

        [DllImport(Library, EntryPoint = "astral_encode_bc", CallingConvention = CallingConvention.Cdecl)]
        internal static extern int Encode(
            uint format, [In] byte[] rgba, nuint rgbaLength, uint width, uint height, [Out] byte[] output, nuint outputLength);
    }
}
