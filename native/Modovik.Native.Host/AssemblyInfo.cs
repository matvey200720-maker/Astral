using System.Runtime.CompilerServices;

// Проекту проверок нужны внутренние типы хоста (HostProgress, MapTiles, YcdRoundtripCommands).
[assembly: InternalsVisibleTo("Modovik.Native.Host.Checks")]
