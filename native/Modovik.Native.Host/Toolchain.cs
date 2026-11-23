namespace Modovik.Native.Host;

internal static class Toolchain
{
    public static object Health() => new
    {
        product = "Astral Native Engine",
        version = "1.0.0",
        platform = Environment.OSVersion.ToString(),
        capabilities = new[]
        {
            "rpf-rollback",
            "world-map-patch-build",
            "interior-ymap-inspect",
            "interior-ytyp-inspect",
            "interior-layout-compile-v1",
            "map-files-inspect",
            "climb-markers-compile-v2",
            /* Стадии текстур мира после среза (ЧБ-мир, ТЗ 17.10.2026). */
            "texture-stages-v1",
            /* Стили мира — стадия перед ЧБ и сверка их правила (ТЗ 17.10.2026, задача 10). */
            "world-styles-v1",
            /* Стиль красит верхнюю ступень mip, вырезную альфу — по видимым точкам, комикс — внутри яркости текстуры (задача 35). */
            "world-styles-v2",
            /* Эффекты зон пачкой и по листу модели (задача 12 ТЗ 17.10.2026). */
            "restyle-drawable-batch-v2",
            /* Обвесы на кости ствола в его модели (задача 6 ТЗ 17.10.2026). */
            "weapon-attachments-v1",
        },
        tools = new
        {
            archiveFinalizer = new
            {
                available = true,
                provider = "Pinned ArchiveFix + RageLib validation (required)",
                archiveFixSha256 = "83468b4f222ae516fa288f4cc3701950ef6b6a6af23f15dc676b915773941575",
            },
            archiveFix = Find(
                "MODOVIK_ARCHIVE_FIX_PATH",
                Local("Astral", "tools", "ArchiveFix", "ArchiveFix.exe")),
            openIv = Find(
                "MODOVIK_OPENIV_PATH",
                Local("New Technology Studio", "Apps", "OpenIV", "OpenIV.exe")),
            codeWalker = Find(
                "MODOVIK_CODEWALKER_PATH",
                Local("Astral", "tools", "CodeWalker.exe")),
            textureToolkit = Find(
                "MODOVIK_TEXTURE_TOOLKIT_PATH",
                Local("Astral", "tools", "TextureToolkit.exe")),
        },
        keysBundled = false,
    };

    private static object Find(string environmentName, params string[] candidates)
    {
        var configured = Environment.GetEnvironmentVariable(environmentName);
        var all = new[] { configured }
            .Concat(candidates)
            .OfType<string>()
            .Where(x => !string.IsNullOrWhiteSpace(x));
        var path = all.Select(Path.GetFullPath).FirstOrDefault(File.Exists);
        return new { available = path is not null, path, environmentName };
    }

    private static string Local(params string[] parts) =>
        Path.Combine(new[] { Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) }.Concat(parts).ToArray());
}
