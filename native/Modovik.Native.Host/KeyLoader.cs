using RageLib.GTA5.Cryptography;

namespace Modovik.Native.Host;

internal static class KeyLoader
{
    public static string EnsureLoaded(string gameRoot, string? configuredDirectory = null)
    {
        if (GTA5Constants.PC_AES_KEY is { Length: > 0 } &&
            GTA5Constants.PC_NG_KEYS is { Length: > 0 }) return "already-loaded";

        var keyDirectory = configuredDirectory ?? Environment.GetEnvironmentVariable("MODOVIK_GTA_KEYS_PATH");
        if (!string.IsNullOrWhiteSpace(keyDirectory))
        {
            var directory = Path.GetFullPath(keyDirectory);
            GTA5Constants.LoadFromPath(directory);
            Validate();
            return "configured-key-directory";
        }

        var executable = new[] { "GTA5.exe", "GTA5_Enhanced.exe" }
            .Select(name => Path.Combine(gameRoot, name))
            .FirstOrDefault(File.Exists)
            ?? throw new FileNotFoundException("GTA V executable was not found for in-memory key discovery.");
        try
        {
            GTA5Constants.Generate(File.ReadAllBytes(executable));
            Validate();
            return "licensed-game-executable-memory";
        }
        catch (Exception error)
        {
            throw new InvalidOperationException(
                "Astral could not discover the RPF keys in this GTA V build. " +
                "Update the native engine or configure MODOVIK_GTA_KEYS_PATH. Keys are never uploaded or committed.",
                error);
        }
    }

    private static void Validate()
    {
        if (GTA5Constants.PC_AES_KEY is not { Length: 32 } ||
            GTA5Constants.PC_NG_KEYS is not { Length: > 0 } ||
            GTA5Constants.PC_NG_DECRYPT_TABLES is not { Length: > 0 } ||
            GTA5Constants.PC_LUT is not { Length: > 0 })
            throw new InvalidDataException("The GTA V RPF key set is incomplete.");
    }
}
