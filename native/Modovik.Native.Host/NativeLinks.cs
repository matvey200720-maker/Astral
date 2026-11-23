using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Modovik.Native.Host;

/// <summary>
/// Жёсткие ссылки для точек восстановления (05.10.2026): резервная копия
/// архива — вторым именем того же файла, а не копией двух гигабайт.
/// </summary>
internal static class NativeLinks
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

    // FILETIME в системной структуре — два DWORD с выравниванием 4, а не long
    // с выравниванием 8: без Pack = 4 поля после времени съезжали бы на 4 байта.
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public long CreationTime;
        public long LastAccessTime;
        public long LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle hFile, out ByHandleFileInformation lpFileInformation);

    /// <summary>
    /// Второе имя файла <paramref name="existing"/> по пути <paramref name="link"/>.
    /// <c>false</c> — ссылки быть не может (другой том, FAT): тогда копия.
    /// </summary>
    public static bool TryCreateHardLink(string link, string existing)
    {
        if (!OperatingSystem.IsWindows()) return false;
        if (File.Exists(link)) File.Delete(link);
        return CreateHardLink(link, existing, IntPtr.Zero);
    }

    /// <summary>Два пути — один и тот же файл на диске (том и номер записи).</summary>
    public static bool SameFile(string first, string second)
    {
        if (!OperatingSystem.IsWindows()) return false;
        static (uint, uint, uint)? Identity(string path)
        {
            using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return GetFileInformationByHandle(handle, out var info)
                ? (info.VolumeSerialNumber, info.FileIndexHigh, info.FileIndexLow)
                : null;
        }
        try
        {
            var left = Identity(first);
            return left is not null && left == Identity(second);
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }
}
