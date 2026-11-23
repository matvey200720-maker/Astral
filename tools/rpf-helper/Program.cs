using System.Security.Cryptography;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using RageLib.Archives;
using RageLib.GTA5.Archives;
using RageLib.GTA5.ArchiveWrappers;
using RageLib.GTA5.Cryptography;
using RageLib.GTA5.Cryptography.Helpers;

namespace Modovik.RpfHelper;

internal sealed record ComposeOperation(
    string Entry,
    string? Source,
    string? Sha256,
    string? ModId,
    string? Action,
    bool? AllowDelete,
    // Удаление записи, которой в основе может и не быть: движок снимает
    // своё из перебазированной основы, не зная наверняка, что с ней делали.
    bool? AllowMissing = null
);

internal sealed record RpfKeyBundle(
    string? Directory,
    string? AesSha256,
    string? NgKeysSha256,
    string? NgDecryptTablesSha256,
    string? NgEncryptTablesSha256,
    string? NgEncryptLutsSha256,
    string? LutSha256
);

internal sealed record YptTexturePatch(
    string Texture,
    string Source,
    string? Sha256,
    // Прозрачная деталь ствола (задача 2 ТЗ 05.10.2026): в DXT1 альфа —
    // один бит, и текстура цвета становится DXT5 того же размера и числа mip.
    bool? AlphaFormat = null
);

/// <summary>
/// Размер спрайта правила частиц в метрах: ширина поперёк полёта и длина
/// вдоль. Отсутствующая ось остаётся такой, какой была в ядре.
/// </summary>
internal sealed record YptRulePatch(
    string Rule,
    decimal? Width,
    decimal? Length,
    // Кадры цвета частицы — белые: цвет следа целиком из текстуры слота.
    // У донора (bullet_tracer) они оранжевые и умножали бы любой цвет.
    bool? NeutralColour = null,
    // Свой выстрел без следа (задача 14 ТЗ 10.10.2026): след, прошедший
    // ближе From метров к камере, не рисуется, к To — полного размера.
    YptNearHide? NearHide = null
);

/// <summary>Дальность «вблизи следа нет», метры от камеры.</summary>
internal sealed record YptNearHide(decimal From, decimal To);

/// <summary>
/// Привязка ствола: след (<c>TracerFx</c> и шансы) и вспышка у дула
/// (<c>FlashFx</c>). Поле <c>null</c> не трогается — ствол, привязанный ради
/// вспышки, сохраняет свой след, и наоборот (<c>weapons-meta-flash</c>).
/// Пустая строка у следа — ствол без следа (<c>weapons-meta-tracer-clear</c>).
/// </summary>
internal sealed record WeaponTracerBinding(
    string Weapon,
    string? TracerFx,
    decimal? ChanceSP,
    decimal? ChanceMP,
    string? FlashFx = null,
    WeaponMuzzleLook? Look = null
);

/// <summary>
/// Вид выстрела в файле оружия (<c>weapons-meta-muzzle-look</c>): размер
/// вспышки, её свет, дым из ствола и гильзы. Поле <c>null</c> не трогается —
/// установка пишет только то, что меняет, и возвращает журналом то, что было.
/// </summary>
internal sealed record WeaponMuzzleLook(
    decimal? FlashScale = null,
    bool? LightEnabled = null,
    IReadOnlyList<decimal>? LightRgbMin = null,
    IReadOnlyList<decimal>? LightRgbMax = null,
    IReadOnlyList<decimal>? LightIntensity = null,
    IReadOnlyList<decimal>? LightRange = null,
    string? SmokeFx = null,
    decimal? SmokeIncPerShot = null,
    string? ShellFx = null,
    // Вид от первого лица: те же клоны вспышки и дыма, гильзы в паре «_fp».
    string? FlashFxFP = null,
    string? SmokeFxFP = null,
    string? ShellFxFP = null
);

/// <summary>Один файл пачки weapons-meta-tracer-patch: откуда, куда и какие стволы.</summary>
internal sealed record WeaponMetaFile(
    string InputFile,
    string OutputFile,
    IReadOnlyList<WeaponTracerBinding> Bindings
);

internal sealed record AwcStreamPatch(
    string Source,
    string? Sha256,
    IReadOnlyList<string>? Streams,
    // Дорожки основы, которые слой убирает из банка целиком: на них не ведёт
    // ни один звук игры, а место в служебной памяти слота нужно своим пикам.
    IReadOnlyList<string>? Drop = null
);

/// <summary>
/// Пределы слота памяти, в который игра грузит банк (WaveSlot в
/// audioconfig.dat4.rel): конец данных, таблица дорожек и служебные чанки.
/// Больший банк игра копирует за край своих буферов — порча кучи и
/// ERR_MEM_EMBEDDEDALLOC_FREE_2 на первом же освобождении соседа.
/// </summary>
internal sealed record AwcSlotLimits(
    long? Bytes,
    int? Header,
    int? Metadata,
    string? Slot = null
);

internal sealed record RpfRequest(
    string? Mode,
    string? BaseArchive,
    string? OutputArchive,
    string? ArchiveTarget,
    string? Edition,
    string? GameExecutable,
    IReadOnlyList<ComposeOperation>? Operations,
    bool? AllowDeletes,
    string? Entry,
    string? Query,
    string? ExtractOutput,
    RpfKeyBundle? Keys = null,
    IReadOnlyList<string>? Prefixes = null,
    int? MaxMatches = null,
    int? MaxNestedDepth = null,
    IReadOnlyList<string>? ExtractEntries = null,
    string? ExtractOutputDirectory = null,
    string? InputFile = null,
    string? OutputFile = null,
    string? ExpectedInputSha256 = null,
    string? LodInputFile = null,
    string? DistantInputFile = null,
    string? LodOutputFile = null,
    string? DistantOutputFile = null,
    string? ExpectedLodInputSha256 = null,
    string? ExpectedDistantInputSha256 = null,
    string? AssetsDirectory = null,
    string? ArchiveFixExecutable = null,
    IReadOnlyList<YptTexturePatch>? TexturePatches = null,
    IReadOnlyList<YptRulePatch>? RulePatches = null,
    IReadOnlyList<WeaponTracerBinding>? WeaponTracerBindings = null,
    IReadOnlyList<AwcStreamPatch>? AwcStreamPatches = null,
    IReadOnlyList<LampHdMutation>? LampHdMutations = null,
    IReadOnlyList<LampLodMutation>? LampLodMutations = null,
    IReadOnlyList<string>? LampArchetypeNames = null,
    IReadOnlyList<LampWorldAnchor>? LampWorldAnchors = null,
    string? ScanOutputDirectory = null,
    IReadOnlyList<string>? ScanEntries = null,
    // Слоты Astral, которых в ядре эффектов игрока ещё нет: строятся тем же
    // проходом ypt-texture-patch из штатных доноров (YptSlotReservations.cs).
    IReadOnlyList<YptSlotReservation>? SlotReservations = null,
    // Клоны правил эффектов попадания (YptEffectClones.cs) и приставки имён,
    // под которыми прежние клоны удаляются перед сборкой новых.
    IReadOnlyList<YptEffectClone>? EffectClones = null,
    IReadOnlyList<string>? EffectCloneReset = null,
    // Имена правил эффектов для выписки (YptRuleDigest.cs): окно мастерской
    // проигрывает попадание по числам самих правил.
    IReadOnlyList<string>? RuleNames = null,
    // Пачка файлов оружия для weapons-meta-tracer-patch: один запуск на все.
    IReadOnlyList<WeaponMetaFile>? WeaponMetaFiles = null,
    // ytd-texture-set: приставка семейства текстур, которое заменяется
    // целиком (`astral_kill_`), — прежние текстуры семейства снимаются,
    // новые (`TexturePatches`) добавляются.
    string? TextureFamily = null,
    // awc-stream-patch: пределы слота собранного банка (AwcSlotLimits).
    AwcSlotLimits? AwcLimits = null,
    // Редактор фонарей (LampStudioCommands.cs): модели для описи и правки,
    // пары файлов огней вдали с правилом, частицы для описания пропов.
    IReadOnlyList<LampStudioModel>? LampStudioModels = null,
    IReadOnlyList<LampStudioModelPatch>? LampStudioPatches = null,
    IReadOnlyList<LampStudioGlassModel>? LampStudioGlassModels = null,
    IReadOnlyList<LampStudioLodPair>? LampStudioLodPairs = null,
    LampStudioLodRule? LampStudioLodRule = null,
    IReadOnlyList<LampStudioExtension>? LampStudioExtensions = null,
    string? LampStudioExtensionPrefix = null,
    // Кадры штатных правил ядра игрока, которые поменял автор редукса (слой
    // каталога «правила автора», YptStockKeyframes.cs).
    IReadOnlyList<YptStockKeyframes>? StockKeyframes = null,
    // Ядро образца, из которого возвратные кадры (`fromDonor`) копируются как есть.
    string? StockKeyframesFrom = null,
    // Словарь-донор своих правил автора: его собственные листы (остальные — пустые листы игры).
    IReadOnlyList<string>? OwnTextures = null
);

internal static class Program
{
    /*
     * Операций на одну сборку: ступень «Ухудшения текстур» на всю карту —
     * около двадцати тысяч словарей и двадцати тысяч моделей карты в одном
     * пакете (задача 1 ТЗ 05.10.2026). Сборка дерева и запись — линейные,
     * предел держит только разумный верх.
     */
    private const int MaxOperations = 100000;
    private static RageArchiveEncryption7 WriteEncryption = RageArchiveEncryption7.NG;
    private const string ArchiveFixSha256 =
        "83468b4f222ae516fa288f4cc3701950ef6b6a6af23f15dc676b915773941575";
    private static string? ArchiveFixExecutable;
    private static readonly List<string> ArchiveFixSequence = [];
    private static bool SelfTestArchiveFixBypass;

    /// <summary>
    /// Режимы, которые этот helper понимает.
    ///
    /// Список — источник правды и для приёма запроса, и для ответа
    /// <c>--identity</c>: приложение спрашивает, что helper умеет, и не
    /// начинает операцию, которую он не потянет. Новый режим добавляется
    /// сюда ВМЕСТЕ с веткой разбора ниже; забытое имя отвергается на входе,
    /// а не проваливается в конец switch.
    /// </summary>
    private static readonly string[] Modes =
    [
        "compose",
        "create",
        "probe",
        "search",
        "extract",
        "extract-many",
        "ypt-to-xml",
        "ypt-from-xml",
        "ypt-inspect",
        "ypt-texture-patch",
        "ypt-rule-digest",
        "ypt-rule-export",
        "ypt-clone-export",
        "ypt-own-donor",
        "ytd-inspect",
        "ytd-texture-patch",
        "ytd-texture-set",
        "weapons-meta-tracer-patch",
        "awc-inspect",
        "awc-to-xml",
        "awc-from-xml",
        "awc-stream-patch",
        "awc-bank-scan",
        "lamp-inspect",
        "lamp-plan",
        "lamp-patch",
        "lamp-archive-scan",
        "lamp-lod-nearest",
        "lamp-lod-patch",
        "lamp-lod-inspect-pair",
        "lamp-verify",
        // Редактор фонарей мастерской (LampStudioCommands.cs): опись и правка
        // света моделей, огни вдали, частицы у ламп в описании пропов.
        "lamp-studio-inspect",
        "lamp-studio-patch",
        "lamp-studio-lod",
        "lamp-studio-ytyp",
        // Стекло лампы: текстуры светящегося шейдера моделей — в DDS.
        "lamp-studio-glass",
    ];

    /// <summary>
    /// Возможности внутри режимов (см. <c>--identity</c>): составные клоны
    /// эффектов из нескольких доноров (`layers`), настройка дальности клона
    /// (`lod`), донор из чужого словаря (`donorFile`) и режимы перекраски
    /// «два цвета» и «радуга» (`colourMode`) в <c>ypt-texture-patch</c>.
    /// </summary>
    private static readonly string[] Features =
    [
        "effect-clone-layers",
        "effect-clone-lod",
        "effect-clone-donor-file",
        "effect-clone-colour-modes",
        "effect-clone-part-colours",
        // Масштаб правила клона целиком (ptxEffectRule:m_zoomScalarKFP).
        "effect-clone-effect-zoom",
        // Подводный донор на суше: ptxu_ZCull клона гасит частицы под водой, а не
        // над ней (`openAir` в tune). Старый помощник молча оставил бы пузырьки
        // невидимыми на суше.
        "effect-clone-open-air",
        // Один список эволюций на правило клона (UnifyEvolutions): без него
        // составной клон и клон с дальностью роняли игру при попадании.
        "effect-clone-evolutions",
        // Белые кадры цвета у правила следа (`neutralColour` в rulePatches).
        "tracer-rule-colour",
        // След не рисуется вблизи камеры — свой выстрел (`nearHide`).
        "tracer-rule-near-hide",
        // Пустой TracerFx в weapons-meta-tracer-patch: ствол без следа.
        "weapons-meta-tracer-clear",
        // Пачка файлов оружия одним запуском (`weaponMetaFiles`).
        "weapons-meta-tracer-batch",
        // FlashFx в weapons-meta-tracer-patch (вспышка у дула — клон штатной),
        // а TracerFx = null — «след не трогать».
        "weapons-meta-flash",
        // Вид выстрела в weapons-meta-tracer-patch (`look`): FlashFxScale,
        // свет вспышки FlashFxLight*, MuzzleSmokeFx с накоплением и ShellFx.
        "weapons-meta-muzzle-look",
        // Имена в архиве — строчными, папка под другим написанием
        // переименовывается, результат сверяется поиском игры (FindEntry);
        // удаление с `allowMissing` и снятие опустевших контейнеров x64/astral.
        "rpf-lowercase-names",
        // Записи хранятся, как у игры: банк AWC несжатым, сжатое — только если
        // влезает в 24-битное поле оглавления; после сборки каждая запись
        // перечитывается, как её прочтёт игра, и сверяется с источником.
        "rpf-game-storage",
        // Банк AWC и слот памяти игры: awc-inspect называет таблицу дорожек,
        // служебные чанки и конец данных (headerBytes, metadataBytes,
        // contentBytes), awc-stream-patch убирает мёртвые дорожки (`drop`) и
        // не отдаёт банк больше пределов слота (`awcLimits`).
        "awc-slot-budget",
        // lamp-studio-patch меняет и встроенную текстуру стекла (`textures`).
        "lamp-studio-glass-texture",
        // lamp-studio-lod красит огни вдали радугой по подписи лампы (`palette`).
        "lamp-studio-lod-palette",
        // Клон встаёт под штатным именем правила (`replaces`), штатное уходит
        // под скрытое имя и возвращается снятием семейства; свечение клона —
        // `emissiveScale` в tune. Нужны воздушному пакету машины.
        "effect-clone-in-place",
        "effect-clone-emissive",
        // Кадры штатных правил ядра (`stockKeyframes` в ypt-texture-patch):
        // числа автора редукса поверх правил игрока — «наш Core», Х20.
        "stock-keyframes",
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        try
        {
            if (args.Contains("--identity", StringComparer.OrdinalIgnoreCase))
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    status = "ready",
                    protocol = "astral-rpf-helper/v1",
                    helperVersion = "lamp-helper-v1",
                    // Что этот helper умеет — списком. Приложение старше или
                    // младше своего helper'а бывает у любого, кто положил его
                    // в общую папку инструментов однажды и забыл; без списка
                    // расхождение вылезало на середине операции строкой
                    // «Unsupported RPF helper mode», по которой не понять ни
                    // что сломалось, ни что делать.
                    modes = Modes,
                    // Возможности внутри режимов: заказ ypt-texture-patch
                    // старой формы helper принял бы молча, и составной клон
                    // без слоёв вышел бы одним слоем. Приложение спрашивает
                    // про них до работы, как и про режимы.
                    features = Features,
                    lampCommands = new[]
                    {
                        "lamp-inspect",
                        "lamp-plan",
                        "lamp-patch",
                        "lamp-verify",
                        "lamp-lod-inspect-pair",
                        "lamp-lod-patch",
                    },
                }, JsonOptions));
                return 0;
            }
#if DEBUG
            if (args.Contains("--archivefix-probe", StringComparer.OrdinalIgnoreCase))
            {
                Console.WriteLine(JsonSerializer.Serialize(await ArchiveFixProbeAsync(args), JsonOptions));
                return 0;
            }
#endif
            if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
            {
                Console.WriteLine(JsonSerializer.Serialize(await SelfTestAsync(), JsonOptions));
                return 0;
            }
            var json = await Console.In.ReadToEndAsync();
            var request = JsonSerializer.Deserialize<RpfRequest>(json, JsonOptions)
                ?? throw new InvalidDataException("Empty RPF compose request.");
            var protocolOutput = Console.Out;
            try
            {
                Console.SetOut(TextWriter.Null);
                var mode = (request.Mode ?? "compose").Trim().ToLowerInvariant();
                // Незнакомый режим отвергается здесь, до чтения ключей и до
                // открытия архива: дальше идут минуты работы, и падать на них
                // ради имени, которое видно сразу, незачем. Сообщение называет
                // и режим, и то, что helper умеет, — по нему видно, кто из
                // двоих отстал, приложение или helper.
                if (!Modes.Contains(mode, StringComparer.Ordinal))
                    throw new InvalidDataException(
                        $"Unsupported RPF helper mode: {mode}. This helper supports: {string.Join(", ", Modes)}.");
                // Standalone YPT/AWC resources are self-contained files. They
                // do not require GTA archive keys, and requiring GTA5.exe here
                // would prevent authoring/validation in an isolated staging area.
                // Archive operations still initialize and validate keys below.
                var selfContained = mode is "ypt-to-xml" or
                    "ypt-from-xml" or
                    "ypt-inspect" or
                    "ypt-texture-patch" or
                    "ypt-rule-digest" or
                    "ypt-rule-export" or
                    "ypt-clone-export" or
                    "ypt-own-donor" or
                    "ytd-inspect" or
                    "ytd-texture-patch" or
                    "ytd-texture-set" or
                    "weapons-meta-tracer-patch" or
                    "awc-inspect" or
                    "awc-to-xml" or
                    "awc-from-xml" or
                    "awc-stream-patch" or
                    "lamp-studio-inspect" or
                    "lamp-studio-patch" or
                    "lamp-studio-lod" or
                    "lamp-studio-ytyp" or
                    "lamp-studio-glass";
                var awcMode = mode is "awc-inspect" or
                    "awc-to-xml" or
                    "awc-from-xml" or
                    "awc-stream-patch";
                if (!selfContained)
                    await InitializeGameKeysAsync(
                        request.GameExecutable,
                        request.Keys,
                        writable: mode is "compose" or "create");
                // Живые оружейные банки WEAPONS_PLAYER/RESIDENT зашифрованы
                // RSXXTEA и требуют PC_AWC_KEY: «self-contained» верно лишь для
                // незашифрованных standalone-файлов. Когда ключи переданы —
                // грузим их, чтобы банк расшифровался; без ключей изолированный
                // авторинг незашифрованного AWC по-прежнему возможен.
                else if (awcMode &&
                    (request.Keys is not null ||
                     !string.IsNullOrWhiteSpace(request.GameExecutable)))
                    await InitializeGameKeysAsync(request.GameExecutable, request.Keys);
                if (mode is "compose" or "create" &&
                    (GTA5Constants.PC_NG_ENCRYPT_TABLES is not { Length: > 0 } ||
                     GTA5Constants.PC_NG_ENCRYPT_LUTs is not { Length: > 0 }))
                {
                    throw new InvalidDataException(
                        "Verified ArchiveFix NG encryption tables are required for writable RPF operations.");
                }
                if (mode is "compose" or "create")
                    await InitializeArchiveFixAsync(request.ArchiveFixExecutable);
            }
            finally
            {
                Console.SetOut(protocolOutput);
            }
            var result = (request.Mode ?? "compose").Trim().ToLowerInvariant() switch
            {
                "compose" => await ComposeAsync(request),
                "create" => await CreateAsync(request),
                "probe" => await ProbeAsync(request),
                "search" => await SearchAsync(request),
                "extract" => await ExtractAsync(request),
                "extract-many" => await ExtractManyAsync(request),
                "ypt-to-xml" => await YptToXmlAsync(request),
                "ypt-from-xml" => await YptFromXmlAsync(request),
                "ypt-inspect" => await YptInspectAsync(request),
                "ypt-texture-patch" => await YptTexturePatchAsync(request),
                "ypt-rule-digest" => await YptRuleDigestAsync(request),
                "ypt-rule-export" => await YptRuleExportAsync(request),
                "ypt-clone-export" => await YptCloneExportAsync(request),
                "ypt-own-donor" => await YptOwnDonorAsync(request),
                "ytd-inspect" => await YtdInspectAsync(request),
                "ytd-texture-patch" => await YtdTexturePatchAsync(request),
                "ytd-texture-set" => await YtdTextureSetAsync(request),
                "weapons-meta-tracer-patch" => await WeaponsMetaTracerPatchAsync(request),
                "awc-inspect" => await AwcInspectAsync(request),
                "awc-to-xml" => await AwcToXmlAsync(request),
                "awc-from-xml" => await AwcFromXmlAsync(request),
                "awc-stream-patch" => await AwcStreamPatchAsync(request),
                "awc-bank-scan" => await AwcBankScanAsync(request),
                "lamp-inspect" => await LampLightCommands.InspectAsync(request.InputFile),
                "lamp-studio-inspect" => LampStudioCommands.Inspect(request.LampStudioModels),
                "lamp-studio-patch" => await LampStudioCommands.PatchModelsAsync(request.LampStudioPatches),
                "lamp-studio-glass" => LampStudioCommands.ExportGlass(request.LampStudioGlassModels),
                "lamp-studio-lod" => await LampStudioCommands.PatchLodAsync(request.LampStudioLodPairs, request.LampStudioLodRule),
                "lamp-studio-ytyp" => await LampStudioCommands.PatchYtypAsync(
                    request.InputFile,
                    request.OutputFile,
                    request.LampStudioExtensions,
                    request.LampStudioExtensionPrefix),
                "lamp-plan" => request.LodInputFile is not null
                    ? await LampLightCommands.PlanLodPairAsync(
                        request.LodInputFile,
                        request.DistantInputFile,
                        request.ExpectedLodInputSha256,
                        request.ExpectedDistantInputSha256,
                        request.LampLodMutations)
                    : await LampLightCommands.PlanAsync(
                        request.InputFile,
                        request.ExpectedInputSha256,
                        request.LampHdMutations),
                "lamp-patch" => await LampLightCommands.PatchAsync(
                    request.InputFile,
                    request.OutputFile,
                    request.ExpectedInputSha256,
                    request.LampHdMutations),
                "lamp-archive-scan" => await LampArchiveScanAsync(request),
                "lamp-lod-nearest" => await LampLodNearestAsync(request),
                "lamp-lod-patch" => await LampLightCommands.PatchLodPairAsync(
                    request.LodInputFile,
                    request.DistantInputFile,
                    request.LodOutputFile,
                    request.DistantOutputFile,
                    request.ExpectedLodInputSha256,
                    request.ExpectedDistantInputSha256,
                    request.LampLodMutations),
                "lamp-lod-inspect-pair" => await LampLightCommands.InspectLodPairAsync(
                    request.LodInputFile,
                    request.DistantInputFile),
                "lamp-verify" => request.LodInputFile is not null
                    ? await LampLightCommands.VerifyLodPairAsync(
                        request.LodInputFile,
                        request.DistantInputFile,
                        request.LodOutputFile,
                        request.DistantOutputFile,
                        request.ExpectedLodInputSha256,
                        request.ExpectedDistantInputSha256,
                        request.LampLodMutations)
                    : await LampLightCommands.VerifyAsync(
                        request.InputFile,
                        request.OutputFile,
                        request.ExpectedInputSha256,
                        request.LampHdMutations),
                _ => throw new InvalidDataException("Unsupported RPF helper mode."),
            };
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
            return 0;
        }
        catch (Exception error)
        {
            /* `detail` — полный текст исключения со стеком для журнала приложения (бета 14.10:
               «Exception of type 'System.Exception' was thrown» без единой зацепки, где упало).
               Окно его не показывает: главный процесс пишет его только в «Логи». */
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            {
                error = ExceptionMessage(error),
                type = error.GetType().Name,
                detail = error.ToString(),
            }, JsonOptions));
            return 1;
        }
    }

    /* Текст `new Exception()` без сообщения: после настоящей причины — шум. */
    private static readonly string BareExceptionMessage = new Exception().Message;

    private static string ExceptionMessage(Exception error)
    {
        var messages = new List<string>();
        for (Exception? current = error; current is not null; current = current.InnerException)
        {
            var message = current.Message?.Trim();
            /* Внутреннее сообщение, уже вошедшее во внешнее, не повторяется. */
            if (!string.IsNullOrWhiteSpace(message) &&
                !messages.Any(seen => seen.Contains(message, StringComparison.Ordinal)) &&
                !(messages.Count > 0 && message == BareExceptionMessage))
            {
                messages.Add(message);
            }
        }
        return messages.Count > 0
            ? string.Join(" -> ", messages)
            : error.GetType().Name;
    }

    private static CodeWalker.GameFiles.AwcFile LoadAwc(string input)
    {
        if (string.IsNullOrWhiteSpace(input) || !File.Exists(input))
            throw new FileNotFoundException("AWC input file was not found.", input);
        var bytes = File.ReadAllBytes(input);
        var entry = new CodeWalker.GameFiles.RpfBinaryFileEntry
        {
            Name = Path.GetFileName(input),
        };
        var awc = new CodeWalker.GameFiles.AwcFile();
        awc.Load(bytes, entry);
        if (!string.IsNullOrWhiteSpace(awc.ErrorMessage))
            throw new InvalidDataException($"Invalid AWC {Path.GetFileName(input)}: {awc.ErrorMessage}");
        if (awc.Streams is null)
            throw new InvalidDataException($"AWC {Path.GetFileName(input)} has no stream table.");
        return awc;
    }

    /*
     * Описание банка для студии звука. Общее для одиночной инспекции и
     * пакетного скана: кодек и число сэмплов решают, заменяема ли дорожка и
     * какой длины заголовок ей писать; payloadSha256 — SHA-256 канонического
     * WAV дорожки, по нему студия сверяет собранный слой байт-в-байт.
     */
    private static object DescribeAwc(CodeWalker.GameFiles.AwcFile awc)
    {
        var streams = awc.Streams.Where(stream => stream is not null).Select(stream =>
        {
            byte[]? media = null;
            try { media = stream.GetWavFile(); }
            catch { }
            var format = stream.FormatChunk;
            var chunkInfos = (stream.Chunks ?? []).Select(chunk => chunk?.ChunkInfo).Where(info => info is not null).ToArray();
            return new
            {
                name = stream.Name,
                hash = $"0x{((uint)stream.HashAdjusted):X8}",
                type = stream.Type,
                codec = (format?.Codec ?? stream.StreamFormat?.Codec)?.ToString(),
                sampleRate = stream.SamplesPerSecond,
                samples = stream.SampleCount,
                seconds = stream.Length,
                bytes = stream.ByteLength,
                peak = format?.Peak is not null,
                loopBegin = format is null ? (int?)null : format.LoopBegin,
                loopEnd = format is null ? (int?)null : format.LoopEnd,
                playBegin = format is null ? (int?)null : format.PlayBegin,
                playEnd = format is null ? (int?)null : format.PlayEnd,
                payloadSha256 = media is null ? null : Convert.ToHexString(SHA256.HashData(media)).ToLowerInvariant(),
                chunks = chunkInfos.Select(info => info!.Type.ToString()).ToArray(),
                // Служебные байты дорожки: всё, кроме данных (формат, пики, метки).
                metadataBytes = chunkInfos.Where(info => info!.Type != CodeWalker.GameFiles.AwcChunkType.data).Sum(info => (long)info!.Size),
            };
        }).ToArray();
        var budget = MeasureAwc(awc);
        return new
        {
            awc.Name,
            awc.Version,
            awc.Flags,
            awc.WholeFileEncrypted,
            awc.MultiChannelFlag,
            awc.SingleChannelEncryptFlag,
            awc.MultiChannelEncryptFlag,
            streamCount = streams.Length,
            headerBytes = budget.Header,
            metadataBytes = budget.Metadata,
            contentBytes = budget.Content,
            streams,
        };
    }

    private sealed record AwcBudget(int Header, long Metadata, long Content);

    /*
     * Сколько банк займёт в слоте памяти игры. Слот (WaveSlot в
     * audioconfig.dat4.rel) держит три отдельных предела, и у каждого
     * постоянного банка RESIDENT они ровно по нему самому (сверено по всем 15
     * банкам Legacy 27.09.2026): таблица дорожек — DataOffset (16 байт шапки,
     * индексы, 4 байта на дорожку, 8 на чанк), служебные чанки — сумма всех
     * чанков, кроме данных (формат, пики, метки), и конец данных — без
     * хвостового выравнивания под шифрование. Банк, чьи служебные чанки на 4
     * байта больше слота, ронял игру ERR_MEM_EMBEDDEDALLOC_FREE_2.
     */
    private static AwcBudget MeasureAwc(CodeWalker.GameFiles.AwcFile awc)
    {
        long metadata = 0;
        long content = 0;
        foreach (var info in awc.ChunkInfos ?? [])
        {
            if (info is null) continue;
            if (info.Type != CodeWalker.GameFiles.AwcChunkType.data) metadata += info.Size;
            content = Math.Max(content, (long)info.Offset + info.Size);
        }
        return new AwcBudget(awc.DataOffset, metadata, content);
    }

    private static void EnforceAwcLimits(AwcBudget budget, AwcSlotLimits? limits)
    {
        if (limits is null) return;
        var over = new List<string>();
        if (limits.Header is int header && budget.Header > header)
            over.Add($"header {budget.Header}/{header}");
        if (limits.Metadata is int metadata && budget.Metadata > metadata)
            over.Add($"metadata {budget.Metadata}/{metadata}");
        if (limits.Bytes is long bytes && budget.Content > bytes)
            over.Add($"content {budget.Content}/{bytes}");
        if (over.Count > 0)
            throw new InvalidDataException(
                $"AWC slot budget exceeded ({limits.Slot ?? "slot"}): {string.Join(", ", over)}.");
    }

    private static async Task<object> AwcInspectAsync(RpfRequest request)
    {
        var input = Path.GetFullPath(request.InputFile
            ?? throw new InvalidDataException("awc-inspect requires inputFile."));
        var awc = LoadAwc(input);
        return new
        {
            status = "ready",
            mode = "awc-inspect",
            input,
            sha256 = await HashFileAsync(input),
            resource = DescribeAwc(awc),
        };
    }

    private static readonly Regex BankNamePattern =
        new("^[a-z0-9][a-z0-9._-]{0,118}$", RegexOptions.Compiled);

    /*
     * Пакетный скан звукового архива: один процесс, одно открытие архива — все
     * банки корня извлечены в <outputDirectory>/<bank>/bank.awc и описаны.
     * По одному банку на процесс первый список банков занимал десятки секунд
     * (каждый запуск — старт .NET и расшифровка оглавления). Сбой одного
     * банка не прячет остальные: он возвращается рядом с ними полем error.
     */
    private static async Task<object> AwcBankScanAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var outputDirectory = RequireAbsoluteDirectoryPath(
            request.ScanOutputDirectory ?? string.Empty);
        var wanted = (request.ScanEntries ?? [])
            .Select(value => (value ?? string.Empty).Trim().ToLowerInvariant())
            .Where(value => value.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
        Directory.CreateDirectory(outputDirectory);
        var banks = new List<object>();
        await using var stream = OpenArchiveReadOnly(archivePath);
        using var archive = OpenArchive(
            stream, GetLogicalArchiveName(request, archivePath), leaveOpen: true);
        var files = archive.Root.GetFiles()
            .Where(file => file.Name.EndsWith(".awc", StringComparison.OrdinalIgnoreCase))
            .Where(file => wanted.Count == 0 || wanted.Contains(file.Name.ToLowerInvariant()))
            .OrderBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .Take(200)
            .ToArray();
        foreach (var file in files)
        {
            var bank = Path.GetFileNameWithoutExtension(file.Name).ToLowerInvariant();
            if (!BankNamePattern.IsMatch(bank)) continue;
            var directory = Path.GetFullPath(Path.Combine(outputDirectory, bank));
            EnsureWithinDirectory(outputDirectory, directory);
            var output = Path.Combine(directory, "bank.awc");
            try
            {
                Directory.CreateDirectory(directory);
                var staged = $"{output}.extract-{Guid.NewGuid():N}";
                try
                {
                    ExportEntry(archive, [file.Name], staged);
                    File.Move(staged, output, overwrite: true);
                }
                catch
                {
                    if (File.Exists(staged)) File.Delete(staged);
                    throw;
                }
                var awc = LoadAwc(output);
                banks.Add(new
                {
                    entry = file.Name,
                    bank,
                    output,
                    bytes = new FileInfo(output).Length,
                    sha256 = await HashFileAsync(output),
                    resource = DescribeAwc(awc),
                });
            }
            catch (Exception error)
            {
                banks.Add(new { entry = file.Name, bank, error = ExceptionMessage(error) });
            }
        }
        return new
        {
            status = "ready",
            mode = "awc-bank-scan",
            archive = archivePath,
            outputDirectory,
            banks,
        };
    }

    private static async Task<object> AwcToXmlAsync(RpfRequest request)
    {
        var input = Path.GetFullPath(request.InputFile
            ?? throw new InvalidDataException("awc-to-xml requires inputFile."));
        var output = Path.GetFullPath(request.OutputFile
            ?? throw new InvalidDataException("awc-to-xml requires outputFile."));
        var assets = Path.GetFullPath(request.AssetsDirectory
            ?? throw new InvalidDataException("awc-to-xml requires assetsDirectory."));
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        Directory.CreateDirectory(assets);
        var awc = LoadAwc(input);
        var xml = CodeWalker.GameFiles.AwcXml.GetXml(awc, assets);
        await File.WriteAllTextAsync(output, xml, new UTF8Encoding(false));
        return new
        {
            status = "ready",
            mode = "awc-to-xml",
            input,
            output,
            assetsDirectory = assets,
            streams = awc.Streams.Length,
            sha256 = await HashFileAsync(output),
        };
    }

    private static async Task<object> AwcFromXmlAsync(RpfRequest request)
    {
        var input = Path.GetFullPath(request.InputFile
            ?? throw new InvalidDataException("awc-from-xml requires inputFile."));
        var output = Path.GetFullPath(request.OutputFile
            ?? throw new InvalidDataException("awc-from-xml requires outputFile."));
        var assets = Path.GetFullPath(request.AssetsDirectory
            ?? throw new InvalidDataException("awc-from-xml requires assetsDirectory."));
        if (!File.Exists(input)) throw new FileNotFoundException("AWC XML input was not found.", input);
        if (!Directory.Exists(assets)) throw new DirectoryNotFoundException($"AWC assets directory was not found: {assets}");
        var xml = await File.ReadAllTextAsync(input);
        var awc = CodeWalker.GameFiles.XmlAwc.AwcYft(xml, assets);
        if (awc is null || awc.Streams is null)
            throw new InvalidDataException("AWC XML did not produce a valid stream table.");
        var bytes = awc.Save();
        if (bytes.Length < 16) throw new InvalidDataException("AWC encoder produced an empty resource.");
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        await File.WriteAllBytesAsync(output, bytes);
        var verify = LoadAwc(output);
        if (verify.Streams.Length != awc.Streams.Length)
            throw new InvalidDataException("AWC round-trip changed the stream count.");
        return new
        {
            status = "ready",
            mode = "awc-from-xml",
            input,
            output,
            assetsDirectory = assets,
            streams = verify.Streams.Length,
            bytes = bytes.Length,
            sha256 = await HashFileAsync(output),
        };
    }

    private static uint ParseAwcStreamId(string value)
    {
        var clean = (value ?? "").Trim();
        if (clean.StartsWith("0x", StringComparison.OrdinalIgnoreCase) &&
            uint.TryParse(clean[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var hex))
            return hex & 0x1FFFFFFF;
        if (uint.TryParse(clean, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
            return number & 0x1FFFFFFF;
        throw new InvalidDataException($"Invalid AWC stream identifier: {value}");
    }

    private static string AwcStreamPayloadHash(CodeWalker.GameFiles.AwcStream stream)
    {
        return Convert.ToHexString(SHA256.HashData(stream.GetWavFile())).ToLowerInvariant();
    }

    private static async Task<object> AwcStreamPatchAsync(RpfRequest request)
    {
        var input = Path.GetFullPath(request.InputFile
            ?? throw new InvalidDataException("awc-stream-patch requires inputFile."));
        var output = Path.GetFullPath(request.OutputFile
            ?? throw new InvalidDataException("awc-stream-patch requires outputFile."));
        var patches = request.AwcStreamPatches
            ?? throw new InvalidDataException("awc-stream-patch requires awcStreamPatches.");
        if (patches.Count == 0) throw new InvalidDataException("At least one AWC stream patch is required.");
        var baseAwc = LoadAwc(input);
        if (baseAwc.MultiChannelFlag)
            throw new InvalidDataException("Per-stream composition of multichannel AWC files is not supported.");
        var originalById = baseAwc.Streams.ToDictionary(stream => ((uint)stream.Hash) & 0x1FFFFFFF);
        var expectedPayloads = originalById.ToDictionary(pair => pair.Key, pair => AwcStreamPayloadHash(pair.Value));
        var replaced = new HashSet<uint>();
        var dropped = new HashSet<uint>();
        foreach (var patch in patches)
        {
            foreach (var identifier in patch.Drop ?? [])
            {
                var id = ParseAwcStreamId(identifier);
                if (!originalById.ContainsKey(id))
                    throw new InvalidDataException($"AWC base does not contain stream 0x{id:X8} to drop.");
                if (!dropped.Add(id))
                    throw new InvalidDataException($"AWC stream 0x{id:X8} is claimed by multiple active layers.");
            }
        }
        foreach (var patch in patches)
        {
            var source = Path.GetFullPath(patch.Source);
            if (!File.Exists(source)) throw new FileNotFoundException("AWC patch source was not found.", source);
            if (!string.IsNullOrWhiteSpace(patch.Sha256) &&
                !string.Equals(await HashFileAsync(source), patch.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"AWC patch checksum mismatch: {Path.GetFileName(source)}");
            var sourceAwc = LoadAwc(source);
            if (sourceAwc.MultiChannelFlag || sourceAwc.Version != baseAwc.Version)
                throw new InvalidDataException($"Incompatible AWC source: {Path.GetFileName(source)}");
            var sourceById = sourceAwc.Streams.ToDictionary(stream => ((uint)stream.Hash) & 0x1FFFFFFF);
            var identifiers = patch.Streams ?? [];
            if (identifiers.Count == 0)
                throw new InvalidDataException($"AWC patch has no declared streams: {Path.GetFileName(source)}");
            foreach (var identifier in identifiers)
            {
                var id = ParseAwcStreamId(identifier);
                if (!replaced.Add(id) || dropped.Contains(id))
                    throw new InvalidDataException($"AWC stream 0x{id:X8} is claimed by multiple active layers.");
                if (!sourceById.TryGetValue(id, out var replacement))
                    throw new InvalidDataException($"AWC source does not contain stream 0x{id:X8}.");
                if (!originalById.ContainsKey(id))
                    throw new InvalidDataException($"AWC base does not contain stream 0x{id:X8}.");
                replacement.Awc = baseAwc;
                var index = Array.FindIndex(baseAwc.Streams, stream => (((uint)stream.Hash) & 0x1FFFFFFF) == id);
                baseAwc.Streams[index] = replacement;
                expectedPayloads[id] = AwcStreamPayloadHash(replacement);
            }
        }
        if (dropped.Count > 0)
        {
            // Таблица дорожек пересобирается из списка: убранная дорожка
            // уходит вместе со своими чанками, порядок остальных прежний.
            baseAwc.Streams = baseAwc.Streams
                .Where(stream => !dropped.Contains(((uint)stream.Hash) & 0x1FFFFFFF))
                .ToArray();
            foreach (var id in dropped) expectedPayloads.Remove(id);
        }
        baseAwc.StreamCount = baseAwc.Streams.Length;
        baseAwc.BuildPeakChunks();
        baseAwc.BuildChunkIndices();
        baseAwc.BuildStreamInfos();
        baseAwc.BuildStreamDict();
        var bytes = baseAwc.Save();
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        await File.WriteAllBytesAsync(output, bytes);
        AwcBudget budget;
        try
        {
            var verify = LoadAwc(output);
            if (verify.Streams.Length != originalById.Count - dropped.Count)
                throw new InvalidDataException("AWC stream patch changed the stream count.");
            foreach (var stream in verify.Streams)
            {
                var id = ((uint)stream.Hash) & 0x1FFFFFFF;
                if (dropped.Contains(id))
                    throw new InvalidDataException($"AWC stream 0x{id:X8} survived its drop.");
                if (!expectedPayloads.TryGetValue(id, out var expected) ||
                    !string.Equals(AwcStreamPayloadHash(stream), expected, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"AWC stream validation failed for 0x{id:X8}.");
            }
            // Банк, что не помещается в слот, в игру не уходит: игра скопировала
            // бы его за край своих буферов.
            budget = MeasureAwc(verify);
            EnforceAwcLimits(budget, request.AwcLimits);
        }
        catch
        {
            File.Delete(output);
            throw;
        }
        return new
        {
            status = "ready",
            mode = "awc-stream-patch",
            input,
            output,
            streams = originalById.Count - dropped.Count,
            replaced = replaced.Select(id => $"0x{id:X8}").OrderBy(value => value).ToArray(),
            dropped = dropped.Select(id => $"0x{id:X8}").OrderBy(value => value).ToArray(),
            bytes = bytes.Length,
            headerBytes = budget.Header,
            metadataBytes = budget.Metadata,
            contentBytes = budget.Content,
            sha256 = await HashFileAsync(output),
        };
    }

    private static async Task<object> SelfTestAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"modovik-rpf-helper-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            InitializeSyntheticKeys();
            ArchiveFixSequence.Clear();
            SelfTestArchiveFixBypass = true;
            var baseArchive = Path.Combine(root, "fixture.rpf");
            var outputArchive = Path.Combine(root, "composed.rpf");
            var replacement = Path.Combine(root, "weapon.dat");
            var addition = Path.Combine(root, "added.dat");
            var extracted = Path.Combine(root, "extracted.dat");
            var createdArchive = Path.Combine(root, "created.rpf");
            var soundBank = Path.Combine(root, "bank.awc");
            var hugeEntry = Path.Combine(root, "huge.dat");
            await File.WriteAllTextAsync(replacement, "modovik-entry-ready");
            await File.WriteAllTextAsync(addition, "modovik-import-ready");
            await File.WriteAllTextAsync(soundBank, new string('a', 4096));
            // Несжимаемые 17 МБ: сжатое больше 24-битного поля оглавления.
            var hugeBytes = new byte[17 * 1024 * 1024];
            RandomNumberGenerator.Fill(hugeBytes);
            await File.WriteAllBytesAsync(hugeEntry, hugeBytes);
            using (var outer = RageArchiveWrapper7.Create(baseArchive))
            {
                outer.Encryption = RageArchiveEncryption7.None;
                var x64 = outer.Root.CreateDirectory();
                x64.Name = "x64";
                var models = x64.CreateDirectory();
                models.Name = "models";
                using var nestedStream = new MemoryStream();
                byte[] nestedBytes;
                using (var nested = RageArchiveWrapper7.Create(
                    nestedStream,
                    "weapons.rpf",
                    leaveOpen: true))
                {
                    nested.Encryption = RageArchiveEncryption7.None;
                    var weapon = nested.Root.CreateBinaryFile();
                    weapon.Name = "weapon.dat";
                    using var vanilla = new MemoryStream("vanilla"u8.ToArray());
                    weapon.ImportCompressed(vanilla);
                    var obsolete = nested.Root.CreateBinaryFile();
                    obsolete.Name = "obsolete.dat";
                    using var obsoleteContent = new MemoryStream("obsolete"u8.ToArray());
                    obsolete.ImportCompressed(obsoleteContent);
                    nested.Flush();
                    nestedBytes = nestedStream.ToArray();
                }
                var nestedFile = models.CreateBinaryFile();
                nestedFile.Name = "weapons.rpf";
                using var nestedPayload = new MemoryStream(nestedBytes);
                nestedFile.Import(nestedPayload);
                outer.Flush();
            }

            var baseHash = await HashFileAsync(baseArchive);
            var replacementHash = await HashFileAsync(replacement);
            var additionHash = await HashFileAsync(addition);
            await ComposeAsync(new RpfRequest(
                "compose", baseArchive, outputArchive, "mods/fixture.rpf", "Legacy", null,
                [
                    new ComposeOperation(
                        "x64/models/weapons.rpf/weapon.dat",
                        replacement,
                        replacementHash,
                        "self-test",
                        "replace",
                        false),
                    new ComposeOperation(
                        "x64/models/weapons.rpf/added.dat",
                        addition,
                        additionHash,
                        "self-test",
                        "import",
                        false),
                    new ComposeOperation(
                        "x64/models/weapons.rpf/bank.awc",
                        soundBank,
                        await HashFileAsync(soundBank),
                        "self-test",
                        "import",
                        false),
                    new ComposeOperation(
                        "x64/models/huge.dat",
                        hugeEntry,
                        await HashFileAsync(hugeEntry),
                        "self-test",
                        "import",
                        false),
                    new ComposeOperation(
                        "x64/models/weapons.rpf/obsolete.dat",
                        null,
                        null,
                        "self-test",
                        "delete",
                        true),
                ],
                true, null, null, null));

            await CreateAsync(new RpfRequest(
                "create", null, createdArchive, "newmods/dlcpacks/fixture/dlc.rpf",
                "Legacy", null,
                [
                    new ComposeOperation(
                        "content.xml", replacement, replacementHash, "self-test", "import", false),
                    new ComposeOperation(
                        "x64/models/cdimages/weapons.rpf/weapon.dat",
                        addition, additionHash, "self-test", "import", false),
                ],
                false, null, null, null));

            var outputHash = await HashFileAsync(outputArchive);
            using var composedStream = OpenArchiveReadOnly(outputArchive);
            using var composed = OpenArchive(
                composedStream,
                "fixture.rpf",
                leaveOpen: true);
            var x64Directory = composed.Root.GetDirectory("x64")
                ?? throw new InvalidDataException("Self-test directory missing.");
            var modelsDirectory = x64Directory.GetDirectory("models")
                ?? throw new InvalidDataException("Self-test directory missing.");
            var nestedBinary = modelsDirectory.GetFile("weapons.rpf") as IArchiveBinaryFile
                ?? throw new InvalidDataException("Self-test nested archive missing.");
            using var nestedArchive = OpenArchive(
                nestedBinary.GetStream(),
                nestedBinary.Name,
                leaveOpen: true);
            var entry = nestedArchive.Root.GetFile("weapon.dat") as IArchiveBinaryFile
                ?? throw new InvalidDataException("Self-test entry missing.");
            using var content = new MemoryStream();
            entry.ExportUncompressed(content);
            var actual = System.Text.Encoding.UTF8.GetString(content.ToArray());
            if (actual != "modovik-entry-ready")
                throw new InvalidDataException("Self-test entry content mismatch.");
            var imported = nestedArchive.Root.GetFile("added.dat") as IArchiveBinaryFile
                ?? throw new InvalidDataException("Self-test import missing.");
            if (nestedArchive.Root.GetFile("obsolete.dat") is not null)
                throw new InvalidDataException("Self-test delete failed.");
            using var importedContent = new MemoryStream();
            imported.ExportUncompressed(importedContent);
            if (System.Text.Encoding.UTF8.GetString(importedContent.ToArray()) != "modovik-import-ready")
                throw new InvalidDataException("Self-test import content mismatch.");
            if (!entry.IsCompressed)
                throw new InvalidDataException("Self-test: a small binary entry must stay compressed.");
            var bankEntry = nestedArchive.Root.GetFile("bank.awc") as IArchiveBinaryFile
                ?? throw new InvalidDataException("Self-test sound bank missing.");
            if (bankEntry.IsCompressed)
                throw new InvalidDataException("Self-test: a sound bank must be stored uncompressed.");
            var hugeBinary = modelsDirectory.GetFile("huge.dat") as IArchiveBinaryFile
                ?? throw new InvalidDataException("Self-test large entry missing.");
            if (hugeBinary.IsCompressed || hugeBinary.UncompressedSize != hugeBytes.Length)
                throw new InvalidDataException("Self-test: an entry whose compressed size overflows the table must be stored as is.");
            nestedArchive.Dispose();
            composed.Dispose();

            var probe = await ProbeAsync(new RpfRequest(
                "probe", outputArchive, null, "mods/fixture.rpf", "Legacy", null,
                [new ComposeOperation(
                    "x64/models/weapons.rpf/weapon.dat", null, null, null, "replace", false)],
                false, null, null, null));
            var search = await SearchAsync(new RpfRequest(
                "search", outputArchive, null, null, "Legacy", null, null,
                false, null, "added.dat", null));
            await ExtractAsync(new RpfRequest(
                "extract", outputArchive, null, null, "Legacy", null, null,
                false, "x64/models/weapons.rpf/weapon.dat", null, extracted));
            var badOutput = Path.Combine(root, "bad.rpf");
            var failedSafely = false;
            try
            {
                await ComposeAsync(new RpfRequest(
                    "compose", baseArchive, badOutput, null, "Legacy", null,
                    [new ComposeOperation(
                        "x64/models/weapons.rpf/weapon.dat",
                        replacement,
                        new string('0', 64),
                        null,
                        "replace",
                        false)],
                    false, null, null, null));
            }
            catch (InvalidDataException)
            {
                failedSafely = !File.Exists(badOutput);
            }
            bool createReady;
            using (var created = OpenArchive(createdArchive))
            {
                createReady = EntryExists(
                    created,
                    NormalizeEntry("x64/models/cdimages/weapons.rpf/weapon.dat"));
            }
            var lampLightPatching = await LampLightCommands.SelfTestAsync(root);
            var yptForeignNameHashes = YptSlotReservations.SelfTestForeignNameHashes();
            var yptCloneInPlace = YptEffectClones.SelfTestSwap();
            var yptDanglingRefs = YptSlotReservations.SelfTestDanglingRefs();
            return new
            {
                status = "ready",
                nestedRpf = true,
                create = File.Exists(createdArchive) && createReady,
                atomicOutput = File.Exists(outputArchive),
                sha256 = outputHash,
                import = true,
                replace = true,
                delete = true,
                stagedValidation = baseHash == await HashFileAsync(baseArchive),
                readOnlyProbe = probe is not null && baseHash == await HashFileAsync(baseArchive),
                readOnlySearch = search is not null,
                readOnlyExtract = await File.ReadAllTextAsync(extracted) == "modovik-entry-ready",
                crashSafety = failedSafely,
                archiveFixCrashDialogsOff = SuppressChildCrashDialogs(),
                lampLightPatching,
                yptForeignNameHashes,
                yptCloneInPlace,
                yptDanglingRefs,
            };
        }
        finally
        {
            SelfTestArchiveFixBypass = false;
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class CreateTree
    {
        public Dictionary<string, CreateTree> Directories { get; } =
            new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, CreateTree> Archives { get; } =
            new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> Files { get; } =
            new(StringComparer.OrdinalIgnoreCase);
    }

    private static async Task<object> CreateAsync(RpfRequest request)
    {
        var outputArchive = RequireAbsolutePath(request.OutputArchive ?? string.Empty);
        if (!outputArchive.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Created archive must use the .rpf extension.");
        if (request.Operations is null || request.Operations.Count == 0)
            throw new InvalidDataException("At least one RPF create operation is required.");
        if (request.Operations.Count > MaxOperations)
            throw new InvalidDataException("RPF operation limit exceeded.");

        var tree = new CreateTree();
        var completed = new List<string>();
        foreach (var operation in request.Operations.OrderBy(
            item => item.Entry,
            StringComparer.OrdinalIgnoreCase))
        {
            var action = NormalizeAction(operation.Action);
            if (action == "delete")
                throw new InvalidDataException("Delete is not supported while creating an RPF.");
            var source = RequireAbsoluteFile(operation.Source ?? string.Empty);
            if (!string.IsNullOrWhiteSpace(operation.Sha256))
            {
                var actual = await HashFileAsync(source);
                if (!actual.Equals(operation.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Payload checksum mismatch: {operation.Entry}");
            }
            AddCreateEntry(tree, NormalizeEntry(operation.Entry), source);
            completed.Add(operation.Entry.Replace('\\', '/'));
        }

        Directory.CreateDirectory(Path.GetDirectoryName(outputArchive)!);
        var logicalArchiveName = GetLogicalArchiveName(request, outputArchive);
        var stagingDirectory = Path.Combine(
            Path.GetDirectoryName(outputArchive)!,
            $".astral-create-{Guid.NewGuid():N}");
        Directory.CreateDirectory(stagingDirectory);
        var stagedArchive = Path.Combine(stagingDirectory, logicalArchiveName);
        try
        {
            await using (var stream = new FileStream(
                stagedArchive,
                FileMode.CreateNew,
                FileAccess.ReadWrite,
                FileShare.Read,
                ComposeStreamBuffer,
                FileOptions.None))
            using (var archive = RageArchiveWrapper7.Create(
                stream,
                logicalArchiveName,
                leaveOpen: true))
            {
                archive.Encryption = WriteEncryption;
                var touchedArchives = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                await PopulateCreatedArchiveAsync(archive.Root, tree, "", touchedArchives);
                await FinalizeTouchedArchivesAsync(archive, touchedArchives);
                archive.Flush();
                await stream.FlushAsync();
            }
            await RunArchiveFixAsync(stagedArchive, logicalArchiveName, logicalArchiveName);
            ValidateArchive(stagedArchive, logicalArchiveName, request.Operations);
            File.Move(stagedArchive, outputArchive, overwrite: true);
        }
        catch
        {
            if (File.Exists(stagedArchive)) File.Delete(stagedArchive);
            throw;
        }
        finally
        {
            if (Directory.Exists(stagingDirectory))
                Directory.Delete(stagingDirectory, recursive: true);
        }

        return new
        {
            status = "ready",
            mode = "create",
            outputArchive,
            outputBytes = new FileInfo(outputArchive).Length,
            outputSha256 = await HashFileAsync(outputArchive),
            entries = completed,
            archiveFix = new
            {
                executableSha256 = ArchiveFixSha256,
                sequence = ArchiveFixSequence.ToArray(),
            },
        };
    }

    private static async Task<object> YptToXmlAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var output = RequireAbsolutePath(request.OutputFile ?? string.Empty);
        if (!output.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("YPT XML output must use the .xml extension.");
        var assets = RequireAbsoluteDirectoryPath(
            request.AssetsDirectory ?? Path.Combine(
                Path.GetDirectoryName(output)!,
                $"{Path.GetFileNameWithoutExtension(output)}-assets"));
        Directory.CreateDirectory(assets);
        var ypt = new CodeWalker.GameFiles.YptFile();
        ypt.Load(await File.ReadAllBytesAsync(input));
        if (!string.IsNullOrWhiteSpace(ypt.ErrorMessage) || ypt.PtfxList is null)
            throw new InvalidDataException(ypt.ErrorMessage ?? "YPT could not be decoded.");
        var xml = CodeWalker.GameFiles.YptXml.GetXml(ypt, assets);
        var staged = $"{output}.ypt-xml-{Guid.NewGuid():N}";
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        try
        {
            await File.WriteAllTextAsync(staged, xml, new UTF8Encoding(false));
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }
        return new
        {
            status = "ready",
            mode = "ypt-to-xml",
            input,
            output,
            assets,
            outputBytes = new FileInfo(output).Length,
            outputSha256 = await HashFileAsync(output),
        };
    }

    private static async Task<object> YptFromXmlAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".xml");
        var output = RequireAbsolutePath(request.OutputFile ?? string.Empty);
        if (!output.EndsWith(".ypt", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("YPT output must use the .ypt extension.");
        var assets = RequireAbsoluteDirectory(
            request.AssetsDirectory ?? Path.GetDirectoryName(input)!);
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = 128 * 1024 * 1024,
        };
        var document = new XmlDocument { XmlResolver = null };
        using (var reader = XmlReader.Create(input, settings)) document.Load(reader);
        CodeWalker.GameFiles.RpfManager.IsGen9 =
            string.Equals(request.Edition, "Enhanced", StringComparison.OrdinalIgnoreCase);
        var ypt = CodeWalker.GameFiles.XmlYpt.GetYpt(document, assets);
        var data = ypt.Save();
        if (data.Length < 16)
            throw new InvalidDataException("Encoded YPT is empty.");
        var staged = $"{output}.ypt-build-{Guid.NewGuid():N}";
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        try
        {
            await File.WriteAllBytesAsync(staged, data);
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }
        return new
        {
            status = "ready",
            mode = "ypt-from-xml",
            input,
            output,
            assets,
            outputBytes = data.Length,
            outputSha256 = await HashFileAsync(output),
        };
    }

    private static CodeWalker.GameFiles.YptFile LoadYpt(string input, string? edition)
    {
        CodeWalker.GameFiles.RpfManager.IsGen9 =
            string.Equals(edition, "Enhanced", StringComparison.OrdinalIgnoreCase);
        var ypt = new CodeWalker.GameFiles.YptFile();
        var bytes = ReadResourceFile(input);
        WithResourceName(input, () => ypt.Load(bytes));
        if (!string.IsNullOrWhiteSpace(ypt.ErrorMessage) || ypt.PtfxList is null)
            throw new InvalidDataException(ypt.ErrorMessage ?? "YPT could not be decoded.");
        return ypt;
    }

    /*
     * Ресурс игрока с диска — со сверкой заголовка до разжатия (бета 15.10.2026).
     *
     * `.ypt` из редукса у тестера разжимался без предела: помощник падал с
     * OutOfMemoryException, а Windows, которой не хватило памяти, роняла заодно
     * видеопроцесс и окно Astral (база эффектов запускает три помощника над
     * одним ядром рядом). Теперь разжатие не идёт дальше заявленного в
     * заголовке RSC7 с небольшим запасом (`ResourceBuilder.Decompress` в
     * CodeWalker.Core), а здесь до него отсекается то, что ресурсом быть не
     * может: файл без заголовка, без страниц или заявляющий больше потолка.
     * Отказ — словами, с именем файла, а не OutOfMemoryException.
     */
    private static byte[] ReadResourceFile(string input)
    {
        var bytes = File.ReadAllBytes(input);
        var name = Path.GetFileName(input);
        if (!CodeWalker.GameFiles.RpfFile.HasResourceHeader(bytes))
            throw new InvalidDataException(
                $"Ресурс без заголовка RSC7 — файл повреждён или нестандартный: {name}");
        var declared = CodeWalker.GameFiles.ResourceBuilder.DeclaredResourceSize(
            BitConverter.ToUInt32(bytes, 8),
            BitConverter.ToUInt32(bytes, 12));
        if (declared <= 0)
            throw new InvalidDataException(
                $"Ресурс без страниц в заголовке RSC7 — файл повреждён или нестандартный: {name}");
        if (declared > CodeWalker.GameFiles.ResourceBuilder.MaxDecompressedBytes)
            throw new InvalidDataException(
                $"Ресурс заявляет {declared / (1024 * 1024)} МБ, больше предела " +
                $"{CodeWalker.GameFiles.ResourceBuilder.MaxDecompressedBytes / (1024 * 1024)} МБ — " +
                $"файл повреждён или нестандартный: {name}");
        return bytes;
    }

    /// <summary>Отказ разжатия CodeWalker — с именем файла игрока (сам CodeWalker его не знает).</summary>
    private static void WithResourceName(string input, Action load)
    {
        try
        {
            load();
        }
        catch (CodeWalker.GameFiles.ResourceDecompressLimitException error)
        {
            if (string.IsNullOrWhiteSpace(error.ResourceName))
                error.ResourceName = Path.GetFileName(input);
            throw;
        }
    }

    private static object DescribeYpt(CodeWalker.GameFiles.YptFile ypt)
    {
        var textures = ypt.PtfxList?.TextureDictionary?.Textures?.data_items ?? [];
        var effectRules = ypt.PtfxList?.EffectRuleDictionary?.EffectRules?.data_items ?? [];
        var particleRules = ypt.PtfxList?.ParticleRuleDictionary?.ParticleRules?.data_items ?? [];
        var emitterRules = ypt.PtfxList?.EmitterRuleDictionary?.EmitterRules?.data_items ?? [];
        return new
        {
            name = ypt.PtfxList?.Name?.Value,
            textures = textures
                .Where(item => item is not null)
                .Select(item => new
                {
                    item.Name,
                    item.Width,
                    item.Height,
                    item.Levels,
                    format = item.Format.ToString(),
                    bytes = item.Data?.FullData?.LongLength ?? 0,
                    payloadSha256 = item.Data?.FullData is { Length: > 0 } data
                        ? Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant()
                        : null,
                })
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            effectRules = effectRules
                .Where(item => item is not null)
                .Select(item => item.Name?.Value)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            particleRules = particleRules
                .Where(item => item is not null)
                .Select(item => item.Name?.Value)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            emitterRules = emitterRules
                .Where(item => item is not null)
                .Select(item => item.Name?.Value)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            // Клоны Astral, чьи эволюции расходятся с данными Rockstar: так
            // собирались составные эффекты попадания до 24.09.2026, и на
            // попадании они роняли игру. Окно просит пересобрать набор.
            cloneProblems = effectRules
                .Where(item => item?.Name?.Value?.StartsWith("astral_", StringComparison.OrdinalIgnoreCase) == true)
                .Select(item => new
                {
                    effect = item.Name!.Value,
                    problem = YptEffectClones.EvolutionProblem(
                        item,
                        (item.EventEmitters?.data_items ?? []).Take(item.EventEmittersCount).ToArray()),
                })
                .Where(item => item.problem is not null)
                .OrderBy(item => item.effect, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
        };
    }

    private static async Task<object> YptInspectAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var ypt = LoadYpt(input, request.Edition);
        return new
        {
            status = "ready",
            mode = "ypt-inspect",
            input,
            inputBytes = new FileInfo(input).Length,
            inputSha256 = await HashFileAsync(input),
            resource = DescribeYpt(ypt),
        };
    }

    /// <summary>
    /// Выписка правил эффектов по именам — числа, по которым окно
    /// мастерской проигрывает попадание (YptRuleDigest.cs). Только чтение.
    /// </summary>
    private static async Task<object> YptRuleDigestAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var names = request.RuleNames ?? [];
        if (names.Count == 0)
            throw new InvalidDataException("YPT rule digest needs at least one rule name.");
        var ypt = LoadYpt(input, request.Edition);
        return new
        {
            status = "ready",
            mode = "ypt-rule-digest",
            input,
            inputSha256 = await HashFileAsync(input),
            rules = YptRuleDigest.Describe(ypt, names),
        };
    }

    /// <summary>
    /// Словарь-донор своих правил автора редукса (YptOwnDonor.cs): из ядра
    /// автора — только названные правила, их эмиттеры, частицы и листы.
    /// </summary>
    private static async Task<object> YptOwnDonorAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var output = Path.GetFullPath(request.OutputFile ?? string.Empty);
        if (!output.EndsWith(".ypt", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("YPT output must use the .ypt extension.");
        var ypt = LoadYpt(input, request.Edition);
        var report = YptOwnDonor.Build(ypt, request.RuleNames ?? [], request.OwnTextures ?? []);
        var encoded = ypt.Save();
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var staged = $"{output}.own-{Guid.NewGuid():N}";
        try
        {
            await File.WriteAllBytesAsync(staged, encoded);
            // Перечитанный словарь — тот же граф: правила на месте, ссылки внутри словаря.
            var reloaded = LoadYpt(staged, request.Edition);
            YptSlotReservations.VerifyGraph(reloaded, []);
            File.Move(staged, output, overwrite: true);
        }
        finally
        {
            if (File.Exists(staged)) File.Delete(staged);
        }
        return new
        {
            status = "ready",
            mode = "ypt-own-donor",
            input,
            output,
            outputBytes = new FileInfo(output).Length,
            outputSha256 = await HashFileAsync(output),
            donor = report,
        };
    }

    /// <summary>
    /// Правила эффектов целиком (эмиттеры, частицы, эволюции, шейдер) — для
    /// движка частиц окна мастерской. Только чтение.
    /// </summary>
    private static async Task<object> YptRuleExportAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var names = request.RuleNames ?? [];
        if (names.Count == 0)
            throw new InvalidDataException("YPT rule export needs at least one rule name.");
        var ypt = LoadYpt(input, request.Edition);
        return new
        {
            status = "ready",
            mode = "ypt-rule-export",
            input,
            inputSha256 = await HashFileAsync(input),
            export = YptRuleExport.Export(ypt, names),
        };
    }

    /// <summary>
    /// Клоны заказа — в памяти, без записи: ядро читается, прежние клоны тех
    /// же имён снимаются, новые собираются тем же <see cref="YptEffectClones"/>,
    /// что при установке, и выписываются как <c>ypt-rule-export</c>. Так окно
    /// мастерской сверяет свою сборку клона (packages/ptfx-runtime/clone.js) с
    /// установщиком на ядре самого игрока.
    /// </summary>
    private static async Task<object> YptCloneExportAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var clones = request.EffectClones ?? [];
        if (clones.Count == 0)
            throw new InvalidDataException("YPT clone export needs at least one effect clone.");
        var patches = request.TexturePatches ?? [];
        var ypt = LoadYpt(input, request.Edition);
        // В ядре игрока могут жить клоны и листы прошлой установки под теми
        // же именами: установка снимает их сбросом семейства, здесь — поимённо.
        var swapTextures = clones
            .SelectMany(item => (item?.Textures ?? []).Concat((item?.Layers ?? []).SelectMany(layer => layer?.Textures ?? [])))
            .Select(item => item?.Texture ?? string.Empty);
        YptEffectClones.Purge(
            ypt,
            (request.EffectCloneReset ?? []).Concat(clones.Select(item => item.Effect ?? string.Empty)).Concat(swapTextures)
                .Where(name => name.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList());
        var donorFiles = clones
            .SelectMany(item => item?.Layers ?? [])
            .Select(layer => layer?.DonorFile)
            .Where(file => !string.IsNullOrWhiteSpace(file))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                file => file!,
                file => LoadYpt(RequireAbsoluteFile(file!, ".ypt"), request.Edition).PtfxList!,
                StringComparer.OrdinalIgnoreCase);
        var cloned = YptEffectClones.Apply(
            ypt,
            clones,
            await ReadTexturePayloadsAsync(
                clones.SelectMany(item =>
                        (item?.Textures ?? []).Concat(
                            (item?.Layers ?? []).SelectMany(layer => layer?.Textures ?? [])))
                    .Select(item => item?.Texture),
                patches),
            donorFiles);
        return new
        {
            status = "ready",
            mode = "ypt-clone-export",
            input,
            inputSha256 = await HashFileAsync(input),
            cloned,
            export = YptRuleExport.Export(ypt, cloned.Select(item => item.Effect).ToList()),
        };
    }

    private static async Task<object> YptTexturePatchAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ypt");
        var output = RequireAbsolutePath(request.OutputFile ?? string.Empty);
        if (!output.EndsWith(".ypt", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("YPT output must use the .ypt extension.");
        var clones = request.EffectClones ?? [];
        var cloneReset = request.EffectCloneReset ?? [];
        var stockKeyframes = request.StockKeyframes ?? [];
        // Клон без своей текстуры (вода, искры) патча текстур не несёт, и
        // сброс прежних клонов — тоже правка сама по себе; кадры штатных
        // правил — тоже.
        var patches = request.TexturePatches ?? [];
        if (patches.Count == 0 && clones.Count == 0 && cloneReset.Count == 0 && stockKeyframes.Count == 0)
            throw new InvalidDataException("YPT texture patches are required.");
        if (patches.Count > 64)
            throw new InvalidDataException("YPT texture patch count must not exceed 64.");
        var duplicate = patches
            .GroupBy(item => item.Texture?.Trim(), StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidDataException("YPT texture patch names must be unique and non-empty.");

        var ypt = LoadYpt(input, request.Edition);
        // Слоты Astral, которых в ядре ещё нет, строятся до патча текстур: их
        // текстуры создаются из тех же DDS, а размер следа ложится уже на
        // построенное правило. Отпечатки штатных записей снимаются заранее —
        // после записи перечитанное ядро сверяется с ними поимённо.
        var reservations = request.SlotReservations ?? [];
        // Кадры штатных правил тоже сверяются отпечатками: меняться вправе
        // ровно заказанные объекты.
        var restructured = reservations.Count > 0 || clones.Count > 0 || cloneReset.Count > 0 || stockKeyframes.Count > 0;
        // Записи словарей с чужим хешем имени (ядро из мода) переносятся как
        // есть и называются в отчёте — сборку они не останавливают.
        var nameHashRemarks = restructured
            ? YptSlotReservations.AssertDictionaries(
                ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing."))
            : Array.Empty<YptNameHashRemark>();
        var reservationDigest = restructured ? YptSlotReservations.Digest(ypt) : null;
        // Ссылки исходного ядра за словарём (ядро из редукса): их правило мы не
        // трогаем, и стоять из-за них всей установке незачем. Допуск — только
        // для того, что было в исходнике; новая или своя ссылка — по-прежнему отказ.
        var graphBaseline = restructured ? YptSlotReservations.GraphDefects(ypt) : null;
        var graphRemarks = new SortedSet<string>(StringComparer.Ordinal);
        // Прежние клоны эффектов уходят до сборки новых: семейство
        // пересобирается целиком, и выключенная зона не остаётся в ядре.
        var restoredStock = new HashSet<string>(StringComparer.Ordinal);
        var purged = YptEffectClones.Purge(ypt, cloneReset, restoredStock);
        // Кадры автора у штатных правил — до постройки слотов: слот следа
        // каталога клонируется с донора bullet_tracer уже с числами автора
        // (размер и свечение следа редукса), как в его ядре.
        var stockDonor = string.IsNullOrWhiteSpace(request.StockKeyframesFrom)
            ? null
            : LoadYpt(RequireAbsoluteFile(request.StockKeyframesFrom, ".ypt"), request.Edition).PtfxList;
        var stockReport = stockKeyframes.Count > 0 ? YptStockKeyframesPatch.Apply(ypt, stockKeyframes, stockDonor) : null;
        var reserved = reservations.Count > 0
            ? YptSlotReservations.Apply(
                ypt,
                reservations,
                await ReadTexturePayloadsAsync(reservations.Select(item => item?.Texture), patches))
            : Array.Empty<YptReservedSlot>();
        // Чужие словари доноров (клоунские эффекты живут в scr_rcbarry2.ypt):
        // каждый файл читается один раз, сколько бы слоёв на него ни ссылалось.
        var donorFiles = clones
            .SelectMany(item => item?.Layers ?? [])
            .Select(layer => layer?.DonorFile)
            .Where(file => !string.IsNullOrWhiteSpace(file))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                file => file!,
                file => LoadYpt(RequireAbsoluteFile(file!, ".ypt"), request.Edition).PtfxList!,
                StringComparer.OrdinalIgnoreCase);
        var cloned = clones.Count > 0
            ? YptEffectClones.Apply(
                ypt,
                clones,
                await ReadTexturePayloadsAsync(
                    // Текстуры живут в слоях; заказ прежней формы носит их у
                    // самого клона, и оба вида собираются одним списком.
                    clones.SelectMany(item =>
                            (item?.Textures ?? []).Concat(
                                (item?.Layers ?? []).SelectMany(layer => layer?.Textures ?? [])))
                        .Select(item => item?.Texture),
                    patches),
                donorFiles)
            : Array.Empty<YptClonedEffect>();
        // Правило, которое клон занял под штатным именем, — не «штатное, не
        // изменившееся», а заменённое: сверка отпечатков его не сравнивает с
        // исходником (оригинал стоит рядом под скрытым именем).
        purged.UnionWith(cloned.Where(item => item.Replaced is not null).Select(item => $"effect:{item.Effect}"));
        var textures = ypt.PtfxList?.TextureDictionary?.Textures?.data_items
            ?? throw new InvalidDataException("YPT texture dictionary is missing.");
        var completed = new List<object>();
        foreach (var patch in patches)
        {
            var source = RequireAbsoluteFile(patch.Source, ".dds");
            if (!string.IsNullOrWhiteSpace(patch.Sha256))
            {
                var actualSha256 = await HashFileAsync(source);
                if (!actualSha256.Equals(patch.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"YPT texture checksum mismatch: {patch.Texture}");
            }
            var target = textures.SingleOrDefault(item =>
                item is not null && string.Equals(
                    item.Name,
                    patch.Texture.Trim(),
                    StringComparison.OrdinalIgnoreCase));
            if (target is null)
                throw new InvalidDataException($"YPT texture does not exist: {patch.Texture}");
            var replacement = CodeWalker.Utils.DDSIO.GetTexture(await File.ReadAllBytesAsync(source));
            if (replacement?.Data?.FullData is null)
                throw new InvalidDataException($"DDS could not be decoded: {patch.Texture}");
            if (target.Width != replacement.Width ||
                target.Height != replacement.Height ||
                target.Depth != replacement.Depth ||
                target.Levels != replacement.Levels ||
                target.Format != replacement.Format ||
                target.Data?.FullData?.Length != replacement.Data.FullData.Length)
            {
                throw new InvalidDataException(
                    $"DDS layout must match the existing YPT texture exactly: {patch.Texture}");
            }

            // Preserve the original Texture object and all of its RAGE metadata.
            // Particle shader variables already point to this object, so swapping
            // only the verified payload cannot orphan rule/drawable references.
            target.Data.FullData = replacement.Data.FullData.ToArray();
            completed.Add(new
            {
                texture = target.Name,
                source,
                target.Width,
                target.Height,
                target.Levels,
                format = target.Format.ToString(),
                bytes = target.Data.FullData.Length,
                sourceSha256 = await HashFileAsync(source),
            });
        }

        // Размер спрайта правится тем же проходом: ядро читается и пишется
        // один раз. Структура при этом не меняется — только значения кадров.
        var rulePatches = request.RulePatches ?? [];
        if (rulePatches.Count > 64)
            throw new InvalidDataException("YPT rule patch count must not exceed 64.");
        var duplicateRule = rulePatches
            .GroupBy(item => item.Rule?.Trim(), StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() > 1);
        if (duplicateRule is not null)
            throw new InvalidDataException("YPT rule patch names must be unique and non-empty.");
        var completedRules = rulePatches.Select(patch => ApplyTracerShape(ypt, patch)).ToList();

        // Граф с построенными слотами проверяется до записи: лишняя копия,
        // оставшаяся в графе, ушла бы в ресурс мимо описи словарей.
        if (reservationDigest is not null)
            YptSlotReservations.VerifyGraph(
                ypt, reservations.Select(item => item.Effect), graphBaseline, graphRemarks);
        var sourceDescription = JsonSerializer.Serialize(DescribeYpt(ypt), JsonOptions);
        var encoded = ypt.Save();
        if (encoded.Length < 16)
            throw new InvalidDataException("Patched YPT is empty.");
        var staged = $"{output}.ypt-patch-{Guid.NewGuid():N}";
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        object? reservationReport = null;
        try
        {
            await File.WriteAllBytesAsync(staged, encoded);
            var verified = LoadYpt(staged, request.Edition);
            var verifiedDescription = JsonSerializer.Serialize(DescribeYpt(verified), JsonOptions);
            if (!sourceDescription.Equals(verifiedDescription, StringComparison.Ordinal))
                throw new InvalidDataException("YPT structure changed while applying texture patches.");
            if (stockReport is not null)
                YptStockKeyframesPatch.VerifyAfterSave(verified, stockKeyframes, stockReport);
            foreach (var report in completedRules)
            {
                var reread = ReadTracerShape(verified, report.Rule);
                if (!SameSize(reread.Width, report.Width) || !SameSize(reread.Length, report.Length))
                    throw new InvalidDataException($"YPT rule shape did not survive the save: {report.Rule}");
                if (report.NeutralColourFrames > 0 && !TracerColourIsNeutral(verified, report.Rule))
                    throw new InvalidDataException($"YPT rule colour did not survive the save: {report.Rule}");
                if (report.NearHideEmitters > 0 &&
                    !YptEffectClones.TracerHiddenNearCamera(verified, report.Rule, report.NearFrom, report.NearTo))
                    throw new InvalidDataException($"YPT rule near-hide did not survive the save: {report.Rule}");
            }
            // Штатные правила и текстуры перечитанного ядра сверяются с
            // отпечатками исходника; меняться вправе только то, что заказано.
            if (reservationDigest is not null)
            {
                reservationReport = YptSlotReservations.VerifyAfterSave(
                    verified,
                    reservations,
                    reservationDigest,
                    patches.Select(item => item.Texture.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase),
                    rulePatches.Select(item => item.Rule.Trim())
                        .Concat(stockReport?.Objects ?? [])
                        .ToHashSet(StringComparer.OrdinalIgnoreCase),
                    purged,
                    YptEffectClones.ExpectedKeys(cloned, restoredStock),
                    graphBaseline,
                    graphRemarks);
                YptEffectClones.VerifyClones(verified, cloned);
            }
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }

        return new
        {
            status = "ready",
            mode = "ypt-texture-patch",
            input,
            output,
            inputSha256 = await HashFileAsync(input),
            outputSha256 = await HashFileAsync(output),
            outputBytes = new FileInfo(output).Length,
            patches = completed,
            rules = completedRules.Select(report => new
            {
                rule = report.Rule,
                before = new { width = report.BeforeWidth, length = report.BeforeLength },
                width = report.Width,
                length = report.Length,
                proportional = report.Proportional,
                keyframes = report.Keyframes,
            }).ToArray(),
            slotReservations = reservationDigest is null
                ? null
                : new { reserved, verification = reservationReport },
            stockKeyframes = stockReport is null
                ? null
                : new { applied = stockReport.Applied, objects = stockReport.Objects, skipped = stockReport.Skipped },
            effectClones = clones.Count == 0 && cloneReset.Count == 0
                ? null
                : new { cloned, purged = purged.OrderBy(key => key, StringComparer.Ordinal).ToArray() },
            // Чужие хеши имён в словарях исходного ядра: перенесены как есть.
            nameHashRemarks = nameHashRemarks.Count == 0
                ? null
                : new { count = nameHashRemarks.Count, entries = nameHashRemarks.Take(32).ToArray() },
            // Ссылки исходного ядра за словарём, допущенные как есть: "вид:имя".
            graphRemarks = graphRemarks.Count == 0
                ? null
                : new { count = graphRemarks.Count, entries = graphRemarks.Take(32).ToArray() },
            validation = new
            {
                reopened = true,
                structurePreserved = true,
                atomicOutput = true,
                vanillaDigestsCompared = reservationDigest is not null,
            },
        };
    }

    /// <summary>
    /// DDS для новых текстур (слотов и клонов): те же файлы, что у патчей
    /// текстур, с той же сверкой SHA-256 — без своего payload текстура не
    /// строится. Общая текстура нескольких клонов читается один раз.
    /// </summary>
    private static async Task<IReadOnlyDictionary<string, byte[]>> ReadTexturePayloadsAsync(
        IEnumerable<string?> textures,
        IReadOnlyList<YptTexturePatch> patches)
    {
        var payloads = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var texture in textures)
        {
            var name = texture?.Trim() ?? string.Empty;
            if (payloads.ContainsKey(name)) continue;
            var patch = patches.SingleOrDefault(item =>
                    string.Equals(item.Texture?.Trim(), name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidDataException($"YPT slot texture has no payload: {name}");
            var source = RequireAbsoluteFile(patch.Source, ".dds");
            var bytes = await File.ReadAllBytesAsync(source);
            if (!string.IsNullOrWhiteSpace(patch.Sha256) &&
                !Convert.ToHexString(SHA256.HashData(bytes)).Equals(patch.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YPT texture checksum mismatch: {name}");
            payloads[name] = bytes;
        }
        return payloads;
    }

    private sealed record TracerShapeReport(
        string Rule,
        double BeforeWidth,
        double BeforeLength,
        double Width,
        double Length,
        bool Proportional,
        int Keyframes,
        int NeutralColourFrames = 0,
        int NearHideEmitters = 0,
        float NearFrom = 0f,
        float NearTo = 0f);

    private sealed record TracerShape(
        double Width,
        double Length,
        bool Proportional,
        int Keyframes,
        CodeWalker.GameFiles.ParticleBehaviourSize[] Behaviours);

    private static bool SameSize(double actual, double expected) =>
        Math.Abs(actual - expected) <= 1e-4 * Math.Max(1.0, Math.Abs(expected));

    /*
     * Размер спрайта следа: ширина и длина в метрах.
     *
     * У трассеров игры (bullet_tracer и все клоны с него) поведение ptxu_Size
     * стоит в пропорциональном режиме: высота выводится из ширины и пропорции
     * текстуры, а прямое значение высоты («500») не используется. Видимые
     * размеры задают масштабы краёв tblr: верх и низ — вдоль полёта, лево и
     * право — поперёк. Ширина = whd.x × (l + r), длина = основа × (t + b), где
     * основа — whd.x × пропорция текстуры в пропорциональном режиме и whd.y в
     * обычном. Значения берутся из самого правила, а не из констант: слот
     * клонирован с чужого донора, и его числа могут отличаться от ванильных.
     */
    private static TracerShape ReadTracerShape(CodeWalker.GameFiles.YptFile ypt, string name)
    {
        var rules = ypt.PtfxList?.ParticleRuleDictionary?.ParticleRules?.data_items
            ?? throw new InvalidDataException("YPT particle rule dictionary is missing.");
        var rule = rules.SingleOrDefault(item =>
            item is not null &&
            string.Equals(item.Name?.Value, name, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException($"YPT particle rule does not exist: {name}");
        var behaviours = new[]
            {
                rule.AllBehaviours,
                rule.InitBehaviours,
                rule.UpdateBehaviours,
                rule.UpdateFinalizeBehaviours,
                rule.DrawBehaviours,
            }
            .SelectMany(list => list?.data_items ?? [])
            .OfType<CodeWalker.GameFiles.ParticleBehaviourSize>()
            .Distinct()
            .ToArray();
        if (behaviours.Length == 0)
            throw new InvalidDataException($"YPT particle rule has no size behaviour: {name}");
        var size = behaviours[0];
        var whd = size.WhdMaxKFP?.Values?.data_items is { Length: > 0 } maxItems
            ? maxItems
            : size.WhdMinKFP?.Values?.data_items ?? [];
        var tblr = size.TblrScalarKFP?.Values?.data_items ?? [];
        if (whd.Length == 0 || tblr.Length == 0)
            throw new InvalidDataException($"YPT particle rule has no size keyframes: {name}");
        var widthBase = whd.Max(item => (double)item.KeyframeValue.X);
        var proportional = size.IsProportional != 0;
        var lengthBase = proportional
            ? widthBase * TextureAspect(ypt, rule)
            : whd.Max(item => (double)item.KeyframeValue.Y);
        var edges = tblr[0].KeyframeValue;
        return new TracerShape(
            widthBase * (edges.Z + edges.W),
            lengthBase * (edges.X + edges.Y),
            proportional,
            tblr.Length,
            behaviours);
    }

    /// <summary>Пропорция текстуры правила (высота / ширина); 2 — для слота 128×256.</summary>
    private static double TextureAspect(
        CodeWalker.GameFiles.YptFile ypt,
        CodeWalker.GameFiles.ParticleRule rule)
    {
        var textureName = (rule.ShaderVars?.data_items ?? [])
            .OfType<CodeWalker.GameFiles.ParticleShaderVarTexture>()
            .Select(item => item.TextureName?.Value)
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
        var texture = (ypt.PtfxList?.TextureDictionary?.Textures?.data_items ?? [])
            .FirstOrDefault(item =>
                item is not null &&
                string.Equals(item.Name, textureName, StringComparison.OrdinalIgnoreCase));
        return texture is { Width: > 0, Height: > 0 }
            ? (double)texture.Height / texture.Width
            : 2.0;
    }

    private static TracerShapeReport ApplyTracerShape(
        CodeWalker.GameFiles.YptFile ypt,
        YptRulePatch patch)
    {
        var name = patch.Rule.Trim();
        var current = ReadTracerShape(ypt, name);
        if (current.Width <= 0 || current.Length <= 0)
            throw new InvalidDataException($"YPT particle rule has a degenerate size: {name}");
        var targetWidth = patch.Width is decimal width ? (double)width : current.Width;
        var targetLength = patch.Length is decimal length ? (double)length : current.Length;
        if (targetWidth is <= 0 or > 10 || targetLength is <= 0 or > 100)
            throw new InvalidDataException($"YPT rule shape is out of range: {name}");
        var widthFactor = (float)(targetWidth / current.Width);
        var lengthFactor = (float)(targetLength / current.Length);
        // Меняются только множители краёв, у каждого кадра — и число кадров, и
        // whd, и всё остальное остаются исходными; асимметрия краёв (например,
        // след только назад от точки) переживает масштабирование.
        foreach (var behaviour in current.Behaviours)
        {
            foreach (var item in behaviour.TblrScalarKFP?.Values?.data_items ?? [])
            {
                var value = item.KeyframeValue;
                item.KeyframeValue = new SharpDX.Vector4(
                    value.X * lengthFactor,
                    value.Y * lengthFactor,
                    value.Z * widthFactor,
                    value.W * widthFactor);
            }
        }
        var applied = ReadTracerShape(ypt, name);
        var neutral = patch.NeutralColour == true ? NeutraliseTracerColour(ypt, name) : 0;
        var nearFrom = patch.NearHide is { } near ? (float)near.From : 0f;
        var nearTo = patch.NearHide is { } far ? (float)far.To : 0f;
        var hidden = patch.NearHide is not null ? YptEffectClones.HideTracerNearCamera(ypt, name, nearFrom, nearTo) : 0;
        return new TracerShapeReport(
            name,
            current.Width,
            current.Length,
            applied.Width,
            applied.Length,
            applied.Proportional,
            applied.Keyframes,
            neutral,
            hidden,
            nearFrom,
            nearTo);
    }

    /// <summary>Поведения цвета частицы правила следа.</summary>
    private static CodeWalker.GameFiles.ParticleBehaviourColour[] TracerColours(
        CodeWalker.GameFiles.YptFile ypt,
        string name)
    {
        var rule = (ypt.PtfxList?.ParticleRuleDictionary?.ParticleRules?.data_items ?? [])
            .SingleOrDefault(item =>
                item is not null &&
                string.Equals(item.Name?.Value, name, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException($"YPT particle rule does not exist: {name}");
        return new[]
            {
                rule.AllBehaviours,
                rule.InitBehaviours,
                rule.UpdateBehaviours,
                rule.UpdateFinalizeBehaviours,
                rule.DrawBehaviours,
            }
            .SelectMany(list => list?.data_items ?? [])
            .OfType<CodeWalker.GameFiles.ParticleBehaviourColour>()
            .Distinct()
            .ToArray();
    }

    /*
     * Кадры цвета следа — белые.
     *
     * Частица штатного следа (и клон с неё в слоте Astral) красит спрайт
     * кадрами (1; 0,6; 0,2) — оранжевым, — а шейдер умножает на них текстуру.
     * Для ванильного белого листа это и есть цвет следа, а для нашей цветной
     * текстуры — порча: синий #3b82f6 × оранжевый выходил грязно-зелёным.
     * Цвет следа Astral живёт в текстуре (один, переход, радуга), поэтому
     * кадры становятся белыми; прозрачность (W) и свечение не трогаются —
     * как след гаснет и насколько светит, остаётся от донора.
     */
    private static int NeutraliseTracerColour(CodeWalker.GameFiles.YptFile ypt, string name)
    {
        var colours = TracerColours(ypt, name);
        if (colours.Length == 0)
            throw new InvalidDataException($"YPT tracer rule has no colour behaviour: {name}");
        var frames = 0;
        foreach (var colour in colours)
        {
            foreach (var prop in new[] { colour.RGBAMinKFP, colour.RGBAMaxKFP })
            {
                foreach (var item in prop?.Values?.data_items ?? [])
                {
                    if (item is null) continue;
                    var value = item.KeyframeValue;
                    item.KeyframeValue = new SharpDX.Vector4(1f, 1f, 1f, value.W);
                    frames += 1;
                }
            }
        }
        if (frames == 0)
            throw new InvalidDataException($"YPT tracer rule has no colour keyframes: {name}");
        return frames;
    }

    /// <summary>Все ли кадры цвета правила следа белые — сверка после записи.</summary>
    private static bool TracerColourIsNeutral(CodeWalker.GameFiles.YptFile ypt, string name) =>
        TracerColours(ypt, name)
            .SelectMany(colour => new[] { colour.RGBAMinKFP, colour.RGBAMaxKFP })
            .SelectMany(prop => prop?.Values?.data_items ?? [])
            .Where(item => item is not null)
            .All(item =>
                Math.Abs(item.KeyframeValue.X - 1f) < 1e-4f &&
                Math.Abs(item.KeyframeValue.Y - 1f) < 1e-4f &&
                Math.Abs(item.KeyframeValue.Z - 1f) < 1e-4f);

    private static CodeWalker.GameFiles.YtdFile LoadYtd(string input, string? edition)
    {
        CodeWalker.GameFiles.RpfManager.IsGen9 =
            string.Equals(edition, "Enhanced", StringComparison.OrdinalIgnoreCase);
        var ytd = new CodeWalker.GameFiles.YtdFile();
        var bytes = ReadResourceFile(input);
        WithResourceName(input, () => ytd.Load(bytes));
        if (ytd.TextureDict?.Textures?.data_items is not { Length: > 0 })
            throw new InvalidDataException("YTD could not be decoded or contains no textures.");
        return ytd;
    }

    private static object DescribeYtd(CodeWalker.GameFiles.YtdFile ytd)
    {
        var textures = ytd.TextureDict?.Textures?.data_items ?? [];
        return new
        {
            textures = textures
                .Where(item => item is not null)
                .Select(item => new
                {
                    item.Name,
                    item.Width,
                    item.Height,
                    item.Depth,
                    item.Levels,
                    format = item.Format.ToString(),
                    bytes = item.Data?.FullData?.LongLength ?? 0,
                    payloadSha256 = item.Data?.FullData is { Length: > 0 } data
                        ? Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant()
                        : null,
                })
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
        };
    }

    private static async Task<object> YtdInspectAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ytd");
        var ytd = LoadYtd(input, request.Edition);
        return new
        {
            status = "ready",
            mode = "ytd-inspect",
            input,
            inputBytes = new FileInfo(input).Length,
            inputSha256 = await HashFileAsync(input),
            resource = DescribeYtd(ytd),
        };
    }

    private static async Task<object> YtdTexturePatchAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ytd");
        var output = RequireAbsolutePath(request.OutputFile ?? string.Empty);
        if (!output.EndsWith(".ytd", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("YTD output must use the .ytd extension.");
        var patches = request.TexturePatches
            ?? throw new InvalidDataException("YTD texture patches are required.");
        if (patches.Count is < 1 or > 64)
            throw new InvalidDataException("YTD texture patch count must be between 1 and 64.");
        var duplicate = patches
            .GroupBy(item => item.Texture?.Trim(), StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidDataException("YTD texture patch names must be unique and non-empty.");

        var ytd = LoadYtd(input, request.Edition);
        var textures = ytd.TextureDict?.Textures?.data_items
            ?? throw new InvalidDataException("YTD texture dictionary is missing.");
        var completed = new List<object>();
        foreach (var patch in patches)
        {
            var source = RequireAbsoluteFile(patch.Source, ".dds");
            if (!string.IsNullOrWhiteSpace(patch.Sha256))
            {
                var actualSha256 = await HashFileAsync(source);
                if (!actualSha256.Equals(patch.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"YTD texture checksum mismatch: {patch.Texture}");
            }
            var target = textures.SingleOrDefault(item =>
                item is not null && string.Equals(
                    item.Name,
                    patch.Texture.Trim(),
                    StringComparison.OrdinalIgnoreCase));
            if (target is null)
                throw new InvalidDataException($"YTD texture does not exist: {patch.Texture}");
            var replacement = CodeWalker.Utils.DDSIO.GetTexture(await File.ReadAllBytesAsync(source));
            if (replacement?.Data?.FullData is null)
                throw new InvalidDataException($"DDS could not be decoded: {patch.Texture}");
            // DXT1 → DXT5 того же размера — только по явной просьбе и только
            // так: данных ровно вдвое больше, остальное совпадает.
            var alphaUpgrade = patch.AlphaFormat == true &&
                target.Format == CodeWalker.GameFiles.TextureFormat.D3DFMT_DXT1 &&
                replacement.Format == CodeWalker.GameFiles.TextureFormat.D3DFMT_DXT5 &&
                target.Data?.FullData?.Length * 2 == replacement.Data.FullData.Length;
            if (target.Width != replacement.Width ||
                target.Height != replacement.Height ||
                target.Depth != replacement.Depth ||
                target.Levels != replacement.Levels ||
                (target.Format != replacement.Format && !alphaUpgrade) ||
                (!alphaUpgrade && target.Data?.FullData?.Length != replacement.Data.FullData.Length))
            {
                throw new InvalidDataException(
                    $"DDS layout must match the existing YTD texture exactly: {patch.Texture}");
            }

            // Keep the original RAGE texture metadata and replace only the
            // independently validated payload bytes (and, for the alpha
            // upgrade, the format and the row pitch that go with them).
            if (alphaUpgrade)
            {
                target.Format = replacement.Format;
                target.Stride = (ushort)(target.Stride * 2);
            }
            target.Data.FullData = replacement.Data.FullData.ToArray();
            completed.Add(new
            {
                texture = target.Name,
                source,
                target.Width,
                target.Height,
                target.Levels,
                format = target.Format.ToString(),
                bytes = target.Data.FullData.Length,
                sourceSha256 = await HashFileAsync(source),
            });
        }

        var patchedDescription = JsonSerializer.Serialize(DescribeYtd(ytd), JsonOptions);
        var encoded = ytd.Save();
        if (encoded.Length < 16)
            throw new InvalidDataException("Patched YTD is empty.");
        var staged = $"{output}.ytd-patch-{Guid.NewGuid():N}";
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        try
        {
            await File.WriteAllBytesAsync(staged, encoded);
            var verified = LoadYtd(staged, request.Edition);
            var verifiedDescription = JsonSerializer.Serialize(DescribeYtd(verified), JsonOptions);
            if (!patchedDescription.Equals(verifiedDescription, StringComparison.Ordinal))
                throw new InvalidDataException("YTD structure changed while applying texture patches.");
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }

        return new
        {
            status = "ready",
            mode = "ytd-texture-patch",
            input,
            output,
            inputSha256 = await HashFileAsync(input),
            outputSha256 = await HashFileAsync(output),
            outputBytes = new FileInfo(output).Length,
            patches = completed,
            validation = new
            {
                reopened = true,
                structurePreserved = true,
                atomicOutput = true,
            },
        };
    }

    private static readonly System.Text.RegularExpressions.Regex YtdFamilyPattern =
        new("^[a-z][a-z0-9_]{2,31}_$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    private static readonly System.Text.RegularExpressions.Regex YtdTextureNamePattern =
        new("^[a-z][a-z0-9_]{2,63}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>
    /// Семейство своих текстур в словаре: прежнее снимается целиком, новое
    /// кладётся рядом со штатными.
    ///
    /// Нужен знаку на килле: кадры своей картинки — текстуры в
    /// <c>hud_reticle.ytd</c>, из которого Scaleform прицела берёт картинки
    /// по имени (<c>DefineExternalImage2</c>). Штатные текстуры словаря не
    /// меняются ни в одном байте — это сверяется после записи, как у
    /// <c>ytd-texture-patch</c>. Метаданные новой текстуры (назначение, флаги)
    /// — у штатной текстуры того же формата: так словарь выглядит так, будто
    /// текстуру положил экспортёр Rockstar.
    /// </summary>
    private static async Task<object> YtdTextureSetAsync(RpfRequest request)
    {
        var input = RequireAbsoluteFile(request.InputFile ?? string.Empty, ".ytd");
        var output = RequireAbsolutePath(request.OutputFile ?? string.Empty);
        if (!output.EndsWith(".ytd", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("YTD output must use the .ytd extension.");
        var family = (request.TextureFamily ?? string.Empty).Trim();
        if (!YtdFamilyPattern.IsMatch(family))
            throw new InvalidDataException("YTD texture family must be a lowercase prefix ending with '_'.");
        var additions = request.TexturePatches ?? [];
        if (additions.Count > 64)
            throw new InvalidDataException("YTD texture set must not add more than 64 textures.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var addition in additions)
        {
            var name = addition.Texture?.Trim() ?? string.Empty;
            if (!YtdTextureNamePattern.IsMatch(name) || !name.StartsWith(family, StringComparison.Ordinal))
                throw new InvalidDataException($"YTD texture name must be lowercase and belong to the family: {name}");
            if (!names.Add(name))
                throw new InvalidDataException($"YTD texture names must be unique: {name}");
        }

        var ytd = LoadYtd(input, request.Edition);
        var dictionary = ytd.TextureDict
            ?? throw new InvalidDataException("YTD texture dictionary is missing.");
        var original = dictionary.Textures.data_items.Where(item => item is not null).ToList();
        var kept = original
            .Where(item => !(item.Name ?? string.Empty).ToLowerInvariant().StartsWith(family, StringComparison.Ordinal))
            .ToList();
        if (kept.Count == 0)
            throw new InvalidDataException("YTD would lose every stock texture — refusing to rebuild it.");
        var keptFingerprints = kept.ToDictionary(
            item => item.NameHash,
            item => Convert.ToHexString(SHA256.HashData(item.Data?.FullData ?? [])));

        var added = new List<object>();
        var built = new List<CodeWalker.GameFiles.Texture>(kept);
        foreach (var addition in additions)
        {
            var name = addition.Texture.Trim();
            var source = RequireAbsoluteFile(addition.Source, ".dds");
            var bytes = await File.ReadAllBytesAsync(source);
            if (!string.IsNullOrWhiteSpace(addition.Sha256) &&
                !Convert.ToHexString(SHA256.HashData(bytes)).Equals(addition.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YTD texture checksum mismatch: {name}");
            var texture = CodeWalker.Utils.DDSIO.GetTexture(bytes);
            if (texture?.Data?.FullData is not { Length: > 0 })
                throw new InvalidDataException($"DDS could not be decoded: {name}");
            if (texture.Width is < 4 or > 1024 || texture.Height is < 4 or > 1024 ||
                (texture.Width & (texture.Width - 1)) != 0 || (texture.Height & (texture.Height - 1)) != 0)
                throw new InvalidDataException($"YTD texture must be a power of two between 4 and 1024: {name}");
            if (texture.Depth != 1 || texture.Levels is < 1 or > 11)
                throw new InvalidDataException($"YTD texture layout is not supported: {name}");
            var donor = kept.FirstOrDefault(item => item.Format == texture.Format) ?? kept[0];
            var result = new CodeWalker.GameFiles.Texture
            {
                VFT = donor.VFT,
                Unknown_4h = donor.Unknown_4h,
                Unknown_8h = donor.Unknown_8h,
                Unknown_Ch = donor.Unknown_Ch,
                Unknown_10h = donor.Unknown_10h,
                Unknown_14h = donor.Unknown_14h,
                Unknown_18h = donor.Unknown_18h,
                Unknown_1Ch = donor.Unknown_1Ch,
                Unknown_20h = donor.Unknown_20h,
                Unknown_24h = donor.Unknown_24h,
                Unknown_30h = donor.Unknown_30h,
                Unknown_32h = donor.Unknown_32h,
                Unknown_34h = donor.Unknown_34h,
                Unknown_38h = donor.Unknown_38h,
                Unknown_3Ch = donor.Unknown_3Ch,
                UsageData = donor.UsageData,
                Unknown_44h = donor.Unknown_44h,
                ExtraFlags = donor.ExtraFlags,
                Unknown_4Ch = donor.Unknown_4Ch,
                Unknown_5Ch = donor.Unknown_5Ch,
                Unknown_5Eh = donor.Unknown_5Eh,
                Unknown_60h = donor.Unknown_60h,
                Unknown_64h = donor.Unknown_64h,
                Unknown_68h = donor.Unknown_68h,
                Unknown_6Ch = donor.Unknown_6Ch,
                Unknown_78h = donor.Unknown_78h,
                Unknown_7Ch = donor.Unknown_7Ch,
                Unknown_80h = donor.Unknown_80h,
                Unknown_84h = donor.Unknown_84h,
                Unknown_88h = donor.Unknown_88h,
                Unknown_8Ch = donor.Unknown_8Ch,
                Width = texture.Width,
                Height = texture.Height,
                Depth = texture.Depth,
                Stride = texture.Stride,
                Format = texture.Format,
                Levels = texture.Levels,
                Data = texture.Data,
                Name = name,
                NameHash = CodeWalker.GameFiles.JenkHash.GenHash(name),
            };
            built.Add(result);
            added.Add(new
            {
                texture = name,
                result.Width,
                result.Height,
                result.Levels,
                format = result.Format.ToString(),
                bytes = result.Data.FullData.Length,
                sourceSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            });
        }
        var collisions = built.GroupBy(item => item.NameHash).FirstOrDefault(group => group.Count() > 1);
        if (collisions is not null)
            throw new InvalidDataException("YTD texture names collide by hash.");
        dictionary.BuildFromTextureList(built);

        var encoded = ytd.Save();
        if (encoded.Length < 16)
            throw new InvalidDataException("Rebuilt YTD is empty.");
        var staged = $"{output}.ytd-set-{Guid.NewGuid():N}";
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        try
        {
            await File.WriteAllBytesAsync(staged, encoded);
            var verified = LoadYtd(staged, request.Edition).TextureDict.Textures.data_items
                .Where(item => item is not null)
                .ToList();
            var expected = new HashSet<string>(kept.Select(item => item.Name), StringComparer.OrdinalIgnoreCase);
            expected.UnionWith(names);
            if (verified.Count != expected.Count ||
                verified.Any(item => !expected.Contains(item.Name ?? string.Empty)))
                throw new InvalidDataException("YTD texture list changed while rebuilding it.");
            foreach (var item in verified)
            {
                if (!keptFingerprints.TryGetValue(item.NameHash, out var fingerprint)) continue;
                if (!Convert.ToHexString(SHA256.HashData(item.Data?.FullData ?? [])).Equals(fingerprint, StringComparison.Ordinal))
                    throw new InvalidDataException($"Stock YTD texture changed while rebuilding: {item.Name}");
            }
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }

        return new
        {
            status = "ready",
            mode = "ytd-texture-set",
            input,
            output,
            family,
            inputSha256 = await HashFileAsync(input),
            outputSha256 = await HashFileAsync(output),
            outputBytes = new FileInfo(output).Length,
            removed = original.Count - kept.Count,
            kept = kept.Count,
            added,
            validation = new
            {
                reopened = true,
                stockTexturesPreserved = true,
                atomicOutput = true,
            },
        };
    }

    /*
     * Привязка следа к стволам — в одном файле или пачкой.
     *
     * У трассеров мастерской стволы живут в десятках файлов: базовый
     * weapons.meta и по файлу на каждый ствол дополнения (MK2, тяжёлая
     * винтовка…). По запуску помощника на файл «всё оружие» стоило бы сорок
     * семь запусков — четверть минуты одного только старта процесса. Пачка
     * (`weaponMetaFiles`) правит их все одним запуском, по тем же правилам.
     */
    private static async Task<object> WeaponsMetaTracerPatchAsync(RpfRequest request)
    {
        if (request.WeaponMetaFiles is not { Count: > 0 } files)
            return await PatchWeaponsMetaFileAsync(
                request.InputFile, request.OutputFile, request.WeaponTracerBindings);
        if (files.Count > 128)
            throw new InvalidDataException("Weapons metadata batch must not exceed 128 files.");
        var outputs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var results = new List<object>(files.Count);
        foreach (var file in files)
        {
            if (file is null)
                throw new InvalidDataException("Weapons metadata batch contains an empty item.");
            if (!outputs.Add(Path.GetFullPath(file.OutputFile ?? string.Empty)))
                throw new InvalidDataException("Weapons metadata batch writes one output twice.");
            results.Add(await PatchWeaponsMetaFileAsync(file.InputFile, file.OutputFile, file.Bindings));
        }
        return new
        {
            status = "ready",
            mode = "weapons-meta-tracer-patch",
            files = results,
        };
    }

    private static async Task<object> PatchWeaponsMetaFileAsync(
        string? inputFile,
        string? outputFile,
        IReadOnlyList<WeaponTracerBinding>? bindingList)
    {
        var input = RequireAbsoluteFile(inputFile ?? string.Empty, ".meta");
        var output = RequireAbsolutePath(outputFile ?? string.Empty);
        if (!output.EndsWith(".meta", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Weapons metadata output must use the .meta extension.");
        var bindings = bindingList
            ?? throw new InvalidDataException("Weapon tracer bindings are required.");
        if (bindings.Count is < 1 or > 256)
            throw new InvalidDataException("Weapon tracer binding count must be between 1 and 256.");
        var duplicate = bindings
            .GroupBy(item => item.Weapon?.Trim(), StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => string.IsNullOrWhiteSpace(group.Key) || group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidDataException("Weapon tracer bindings must use unique, non-empty weapon names.");

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = 32 * 1024 * 1024,
            MaxCharactersFromEntities = 0,
        };
        var document = new XmlDocument { PreserveWhitespace = true, XmlResolver = null };
        using (var reader = XmlReader.Create(input, settings)) document.Load(reader);

        static XmlElement? DirectChild(XmlNode node, string name) =>
            node.ChildNodes
                .OfType<XmlElement>()
                .FirstOrDefault(child => child.Name.Equals(name, StringComparison.Ordinal));
        static void ValidateIdentifier(string value, string label)
        {
            if (string.IsNullOrWhiteSpace(value) ||
                value.Length > 96 ||
                value.Any(character =>
                    !(char.IsAsciiLetterOrDigit(character) || character == '_')))
                throw new InvalidDataException($"Invalid {label} identifier.");
        }
        static string ChanceValue(decimal value)
        {
            if (value is < 0 or > 1)
                throw new InvalidDataException("Tracer chance must be between 0 and 1.");
            return value.ToString("0.000000", CultureInfo.InvariantCulture);
        }
        static string BoundedValue(decimal value, decimal min, decimal max, string label)
        {
            if (value < min || value > max)
                throw new InvalidDataException($"{label} must be between {min} and {max}.");
            return value.ToString("0.000000", CultureInfo.InvariantCulture);
        }
        static void SetValue(XmlElement fx, string name, string value, string weapon)
        {
            var node = DirectChild(fx, name)
                ?? throw new InvalidDataException($"Weapon {name} is missing: {weapon}");
            node.SetAttribute("value", value);
        }
        static void SetVector(
            XmlElement fx,
            string name,
            IReadOnlyList<decimal> values,
            int count,
            decimal max,
            string weapon)
        {
            if (values.Count != count)
                throw new InvalidDataException($"Weapon {name} needs {count} numbers: {weapon}");
            var node = DirectChild(fx, name)
                ?? throw new InvalidDataException($"Weapon {name} is missing: {weapon}");
            string[] axes = ["x", "y", "z"];
            for (var index = 0; index < count; index += 1)
                node.SetAttribute(axes[index], BoundedValue(values[index], 0, max, name));
        }
        // Правило эффекта: имя или пустое — «без эффекта» (как пишет Rockstar).
        static void SetEffect(XmlElement fx, string name, string value, string weapon)
        {
            var node = DirectChild(fx, name)
                ?? throw new InvalidDataException($"Weapon {name} is missing: {weapon}");
            var trimmed = value.Trim();
            if (trimmed.Length > 0)
            {
                ValidateIdentifier(trimmed, name);
                node.InnerText = trimmed;
            }
            else node.IsEmpty = true;
        }
        static void ApplyMuzzleLook(XmlElement fx, WeaponMuzzleLook look, string weapon)
        {
            if (look.FlashScale is decimal scale)
                SetValue(fx, "FlashFxScale", BoundedValue(scale, 0, 10, "FlashFxScale"), weapon);
            if (look.LightEnabled is bool enabled)
                SetValue(fx, "FlashFxLightEnabled", enabled ? "true" : "false", weapon);
            if (look.LightRgbMin is { } rgbMin)
                SetVector(fx, "FlashFxLightRGBAMin", rgbMin, 3, 255, weapon);
            if (look.LightRgbMax is { } rgbMax)
                SetVector(fx, "FlashFxLightRGBAMax", rgbMax, 3, 255, weapon);
            if (look.LightIntensity is { } intensity)
                SetVector(fx, "FlashFxLightIntensityMinMax", intensity, 2, 64, weapon);
            if (look.LightRange is { } range)
                SetVector(fx, "FlashFxLightRangeMinMax", range, 2, 64, weapon);
            if (look.SmokeFx is { } smoke) SetEffect(fx, "MuzzleSmokeFx", smoke, weapon);
            if (look.SmokeIncPerShot is decimal increment)
                SetValue(fx, "MuzzleSmokeFxIncPerShot", BoundedValue(increment, 0, 1, "MuzzleSmokeFxIncPerShot"), weapon);
            if (look.ShellFx is { } shell) SetEffect(fx, "ShellFx", shell, weapon);
            if (look.FlashFxFP is { } flashFp) SetEffect(fx, "FlashFxFP", flashFp, weapon);
            if (look.SmokeFxFP is { } smokeFp) SetEffect(fx, "MuzzleSmokeFxFP", smokeFp, weapon);
            if (look.ShellFxFP is { } shellFp) SetEffect(fx, "ShellFxFP", shellFp, weapon);
        }

        var patched = new List<object>();
        var items = document.SelectNodes("//*[local-name()='Item']")
            ?.OfType<XmlElement>()
            .ToArray() ?? [];
        foreach (var binding in bindings)
        {
            var weapon = binding.Weapon.Trim();
            // Пустое имя — ствол без следа: так у штатных дробовиков, и так
            // установка возвращает их, когда трассер с них сняли. null — след
            // не трогается: ствол привязан только ради вспышки.
            var tracer = binding.TracerFx?.Trim();
            var flash = binding.FlashFx?.Trim();
            ValidateIdentifier(weapon, "weapon");
            if (tracer is { Length: > 0 }) ValidateIdentifier(tracer, "tracer effect");
            if (flash is { Length: > 0 }) ValidateIdentifier(flash, "flash effect");
            if (tracer is null && flash is null && binding.Look is null)
                throw new InvalidDataException($"Weapon binding changes nothing: {weapon}");
            var item = items.SingleOrDefault(candidate =>
                string.Equals(
                    DirectChild(candidate, "Name")?.InnerText?.Trim(),
                    weapon,
                    StringComparison.OrdinalIgnoreCase));
            if (item is null)
                throw new InvalidDataException($"Weapon was not found in metadata: {weapon}");
            var fx = DirectChild(item, "Fx")
                ?? throw new InvalidDataException($"Weapon Fx block is missing: {weapon}");
            if (tracer is not null)
            {
                var tracerNode = DirectChild(fx, "TracerFx")
                    ?? throw new InvalidDataException($"Weapon TracerFx is missing: {weapon}");
                if (tracer.Length > 0) tracerNode.InnerText = tracer;
                // Пустой — самозакрывающийся, как пишет его Rockstar: `<TracerFx />`.
                else tracerNode.IsEmpty = true;
                if (binding.ChanceSP is decimal chanceSP)
                {
                    var node = DirectChild(fx, "TracerFxChanceSP")
                        ?? throw new InvalidDataException($"Weapon TracerFxChanceSP is missing: {weapon}");
                    node.SetAttribute("value", ChanceValue(chanceSP));
                }
                if (binding.ChanceMP is decimal chanceMP)
                {
                    var node = DirectChild(fx, "TracerFxChanceMP")
                        ?? throw new InvalidDataException($"Weapon TracerFxChanceMP is missing: {weapon}");
                    node.SetAttribute("value", ChanceValue(chanceMP));
                }
            }
            if (flash is not null)
            {
                // Вспышка у дула: клон штатной или сама штатная при снятии.
                var flashNode = DirectChild(fx, "FlashFx")
                    ?? throw new InvalidDataException($"Weapon FlashFx is missing: {weapon}");
                if (flash.Length > 0) flashNode.InnerText = flash;
                else flashNode.IsEmpty = true;
            }
            if (binding.Look is { } look) ApplyMuzzleLook(fx, look, weapon);
            patched.Add(new
            {
                weapon,
                tracerFx = tracer,
                chanceSP = tracer is null ? null : binding.ChanceSP,
                chanceMP = tracer is null ? null : binding.ChanceMP,
                flashFx = flash,
                look = binding.Look,
            });
        }

        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var staged = $"{output}.weapons-meta-{Guid.NewGuid():N}";
        try
        {
            var writerSettings = new XmlWriterSettings
            {
                Async = true,
                Encoding = new UTF8Encoding(false),
                Indent = false,
                NewLineHandling = NewLineHandling.None,
            };
            await using (var stream = new FileStream(
                staged,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.Read,
                1024 * 1024,
                FileOptions.WriteThrough))
            using (var writer = XmlWriter.Create(stream, writerSettings))
            {
                document.Save(writer);
                await writer.FlushAsync();
                await stream.FlushAsync();
                stream.Flush(flushToDisk: true);
            }
            var verified = new XmlDocument { XmlResolver = null };
            using (var reader = XmlReader.Create(staged, settings)) verified.Load(reader);
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }

        return new
        {
            status = "ready",
            mode = "weapons-meta-tracer-patch",
            input,
            output,
            inputSha256 = await HashFileAsync(input),
            outputSha256 = await HashFileAsync(output),
            outputBytes = new FileInfo(output).Length,
            bindings = patched,
            validation = new { reopened = true, atomicOutput = true },
        };
    }

    private static void AddCreateEntry(
        CreateTree root,
        IReadOnlyList<string> segments,
        string source)
    {
        var current = root;
        for (var index = 0; index < segments.Count - 1; index++)
        {
            var name = segments[index];
            var collection = name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase)
                ? current.Archives
                : current.Directories;
            var conflicting = name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase)
                ? current.Directories
                : current.Archives;
            if (conflicting.ContainsKey(name) || current.Files.ContainsKey(name))
                throw new InvalidDataException($"Conflicting RPF create path: {name}");
            if (!collection.TryGetValue(name, out var next))
            {
                next = new CreateTree();
                collection.Add(name, next);
            }
            current = next;
        }
        var fileName = segments[^1];
        if (current.Directories.ContainsKey(fileName) ||
            current.Archives.ContainsKey(fileName) ||
            !current.Files.TryAdd(fileName, source))
        {
            throw new InvalidDataException(
                $"Duplicate or conflicting RPF create entry: {string.Join('/', segments)}");
        }
    }

    private static async Task PopulateCreatedArchiveAsync(
        IArchiveDirectory destination,
        CreateTree tree,
        string currentPath,
        ISet<string> touchedArchives)
    {
        foreach (var item in tree.Directories.OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase))
        {
            var directory = destination.CreateDirectory();
            directory.Name = item.Key;
            await PopulateCreatedArchiveAsync(
                directory,
                item.Value,
                $"{currentPath}{item.Key}/",
                touchedArchives);
        }
        foreach (var item in tree.Archives.OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase))
        {
            using var nestedStream = new MemoryStream();
            using (var nested = RageArchiveWrapper7.Create(
                nestedStream,
                item.Key,
                leaveOpen: true))
            {
                nested.Encryption = WriteEncryption;
                await PopulateCreatedArchiveAsync(
                    nested.Root,
                    item.Value,
                    $"{currentPath}{item.Key}/",
                    touchedArchives);
                nested.Flush();
            }
            var binary = destination.CreateBinaryFile();
            binary.Name = item.Key;
            binary.IsEncrypted = false;
            nestedStream.Position = 0;
            binary.Import(nestedStream);
            touchedArchives.Add($"{currentPath}{item.Key}");
        }
        foreach (var item in tree.Files.OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase))
            ImportNewEntry(destination, item.Key, item.Value);
    }

    private static async Task<object> ComposeAsync(RpfRequest request)
    {
        var baseArchive = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var outputArchive = RequireAbsolutePath(request.OutputArchive ?? string.Empty);
        if (Path.GetFullPath(baseArchive).Equals(
            Path.GetFullPath(outputArchive),
            StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Output archive must differ from the protected base.");
        }
        if (request.Operations is null || request.Operations.Count == 0)
            throw new InvalidDataException("At least one RPF entry operation is required.");
        if (request.Operations.Count > MaxOperations)
            throw new InvalidDataException("RPF operation limit exceeded.");

        var tree = BuildComposeTree(request);

        Directory.CreateDirectory(Path.GetDirectoryName(outputArchive)!);
        var logicalArchiveName = GetLogicalArchiveName(request, outputArchive);
        var stagingDirectory = Path.Combine(
            Path.GetDirectoryName(outputArchive)!,
            $".astral-compose-{Guid.NewGuid():N}");
        Directory.CreateDirectory(stagingDirectory);
        var stagedArchive = Path.Combine(stagingDirectory, logicalArchiveName);
        var completed = new List<string>();
        long outputBytes;
        PhaseMilliseconds.Clear();
        var watch = Stopwatch.StartNew();
        try
        {
            /* Вложенные архивы, что не открывались и в основе, — не вина сборки. */
            var brokenBefore = BrokenNestedArchives(baseArchive, logicalArchiveName);
            File.Copy(baseArchive, stagedArchive, overwrite: false);
            AddPhase("copyBase", watch);
            /*
             * Без WriteThrough (05.10.2026): каждый кусок записи уходил на диск
             * мимо кэша системы, и пакет растительности в 1,7 ГБ писался почти
             * минуту. Оборванная сборка архивом не становится: имя выхода она
             * получает только после проверки.
             */
            await using (var stream = new FileStream(
                stagedArchive,
                FileMode.Open,
                FileAccess.ReadWrite,
                FileShare.Read,
                ComposeStreamBuffer,
                FileOptions.None))
            {
                using var outer = OpenArchive(
                    stream,
                    logicalArchiveName,
                    leaveOpen: true);
                await ApplyComposeNodeAsync(outer, tree, completed);
                outer.Encryption = WriteEncryption;
                outer.Flush();
                /* Без сброса на диск: сборка — файл кэша, а не игры. Ждать,
                   пока система допишет два гигабайта копии основы, ей незачем:
                   в игру сборку кладёт движок, и он сверяет её байты по
                   SHA-256 этого ответа и сбрасывает на диск уже копию в игре. */
                await stream.FlushAsync();
                outputBytes = stream.Length;
            }
            AddPhase("apply", watch);
            await RunArchiveFixAsync(stagedArchive, logicalArchiveName, logicalArchiveName);
            AddPhase("archiveFix", watch);
            ValidateArchive(
                stagedArchive,
                logicalArchiveName,
                request.Operations);
            var brokenAfter = BrokenNestedArchives(stagedArchive, logicalArchiveName);
            brokenAfter.ExceptWith(brokenBefore);
            if (brokenAfter.Count > 0)
                throw new InvalidDataException(
                    $"RPF compose damaged nested archives: {string.Join(", ", brokenAfter.Take(5))}");
            AddPhase("validate", watch);
            File.Move(stagedArchive, outputArchive, overwrite: true);
        }
        catch
        {
            if (File.Exists(stagedArchive)) File.Delete(stagedArchive);
            throw;
        }
        finally
        {
            if (Directory.Exists(stagingDirectory))
                Directory.Delete(stagingDirectory, recursive: true);
        }
        /* Архив за архивом, а в ответе — по путям, как шли операции. */
        completed.Sort(StringComparer.OrdinalIgnoreCase);
        var sha256 = await HashFileAsync(outputArchive);
        AddPhase("hash", watch);

        return new
        {
            status = "ready",
            archive = request.ArchiveTarget,
            edition = request.Edition,
            operations = completed.Count,
            entries = completed,
            bytes = outputBytes,
            sha256,
            archiveFix = new
            {
                executableSha256 = ArchiveFixSha256,
                sequence = ArchiveFixSequence.ToArray(),
            },
            timings = new Dictionary<string, long>(PhaseMilliseconds),
        };
    }

    /*
     * Время фаз сборки, мс, — в ответе helper'а (`timings`): по нему видно,
     * на чём стоит медленная установка у игрока. Фазы вложенных архивов
     * входят и в `apply`.
     */
    private static readonly Dictionary<string, long> PhaseMilliseconds = new(StringComparer.Ordinal);

    private static void AddPhase(string phase, Stopwatch watch)
    {
        PhaseMilliseconds[phase] = PhaseMilliseconds.GetValueOrDefault(phase) + watch.ElapsedMilliseconds;
        watch.Restart();
    }

    /* Кусок копирования и сверки содержимого записей — 4 МБ. */
    private const int ArchiveStreamBuffer = 4 * 1024 * 1024;

    /*
     * Буфер файла сборки — 64 КБ: большие куски (импорт, перенос блоков)
     * идут мимо него, а мелкие чтения оглавлений вложенных архивов в разных
     * местах файла не тянут за собой по 4 МБ каждое.
     */
    private const int ComposeStreamBuffer = 64 * 1024;

    private static string NormalizeAction(string? value)
    {
        var action = (value ?? "replace").Trim().ToLowerInvariant();
        return action is "replace" or "import" or "upsert" or "delete"
            ? action
            : throw new InvalidDataException($"Unsupported RPF action: {action}");
    }

    /// <summary>
    /// Операции одного архива сборки: записи в нём самом и вложенные архивы,
    /// в которых что-то меняется (05.10.2026).
    ///
    /// Прежде вложенный архив правился на месте — потоком внутри потока
    /// внешнего архива, — а в конце выносился во временный файл ради
    /// ArchiveFix и вносился обратно: пакет растительности (1,7 ГБ) три раза
    /// проходил через диск, а больше 2 ГБ не проходил вовсе. Теперь вложенный
    /// архив выносится один раз, правится обычным файлом и вносится обратно
    /// один раз — самый глубокий первым.
    /// </summary>
    private sealed class ComposeArchiveNode
    {
        public List<ComposeLeaf> Leaves { get; } = [];
        public SortedDictionary<string, ComposeNestedArchive> Nested { get; } =
            new(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Запись операции внутри своего архива (путь от его корня).</summary>
    private sealed record ComposeLeaf(
        ComposeOperation Operation,
        string Action,
        string? Source,
        IReadOnlyList<string> LocalSegments);

    /// <summary>
    /// Вложенный архив сборки: путь внутри родителя, полный путь от корня
    /// внешнего архива (для журнала и правил слоя Astral) и его операции.
    /// </summary>
    private sealed class ComposeNestedArchive(IReadOnlyList<string> localSegments, string label)
    {
        public IReadOnlyList<string> LocalSegments { get; } = localSegments;
        public string Label { get; } = label;
        public ComposeArchiveNode Node { get; } = new();
        public bool MayCreate { get; set; }
    }

    private static ComposeArchiveNode BuildComposeTree(RpfRequest request)
    {
        var root = new ComposeArchiveNode();
        foreach (var operation in request.Operations!.OrderBy(
            item => item.Entry,
            StringComparer.OrdinalIgnoreCase))
        {
            var action = NormalizeAction(operation.Action);
            string? source = null;
            if (action != "delete")
                source = RequireAbsoluteFile(operation.Source ?? string.Empty);
            else if (request.AllowDeletes != true || operation.AllowDelete != true)
                throw new InvalidDataException($"RPF delete is not authorized: {operation.Entry}");
            var segments = NormalizeEntry(
                operation.Entry,
                allowArchiveContainerLeaf: action != "delete");
            var node = root;
            var start = 0;
            for (var index = 0; index < segments.Count - 1; index++)
            {
                if (!segments[index].EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
                    continue;
                var local = segments.Skip(start).Take(index - start + 1).ToArray();
                var key = string.Join('/', local);
                if (!node.Nested.TryGetValue(key, out var nested))
                {
                    nested = new ComposeNestedArchive(local, string.Join('/', segments.Take(index + 1)));
                    node.Nested.Add(key, nested);
                }
                if (action is "import" or "upsert") nested.MayCreate = true;
                node = nested.Node;
                start = index + 1;
            }
            node.Leaves.Add(new ComposeLeaf(operation, action, source, segments.Skip(start).ToArray()));
        }
        return root;
    }

    /// <summary>
    /// Операции архива: сначала его собственные записи (в порядке путей),
    /// затем вложенные архивы. Целиком внесённый архив (`x.rpf`) тоже
    /// проходит как вложенный: его оглавление шифруется ключом его имени.
    /// </summary>
    private static async Task ApplyComposeNodeAsync(
        RageArchiveWrapper7 archive,
        ComposeArchiveNode node,
        List<string> completed,
        string labelPrefix = "")
    {
        foreach (var leaf in node.Leaves)
        {
            var entry = leaf.Operation.Entry.Replace('\\', '/');
            try
            {
                if (leaf.Action == "delete" && leaf.Operation.AllowMissing == true &&
                    !LocalEntryExists(archive.Root, leaf.LocalSegments))
                {
                    completed.Add(entry);
                    continue;
                }
                ApplyLocalEntry(archive.Root, leaf.LocalSegments, leaf.Action, leaf.Source);
            }
            catch (Exception error)
            {
                throw new InvalidDataException(
                    $"RPF operation failed at {leaf.Operation.Entry}: {error.Message}",
                    error);
            }
            var name = leaf.LocalSegments[^1];
            if (leaf.Action != "delete" && name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                var key = string.Join('/', leaf.LocalSegments);
                if (!node.Nested.ContainsKey(key))
                    node.Nested.Add(key, new ComposeNestedArchive(leaf.LocalSegments, labelPrefix + key));
            }
            completed.Add(entry);
        }
        foreach (var nested in node.Nested.Values)
        {
            try
            {
                await ApplyNestedArchiveAsync(archive, nested, completed);
            }
            catch (InvalidDataException)
            {
                throw;
            }
            catch (Exception error)
            {
                throw new InvalidDataException(
                    $"RPF operation failed at {nested.Label}: {error.Message}",
                    error);
            }
        }
    }

    /// <summary>
    /// Вложенный архив правится на месте, внутри родителя: его записи пишутся
    /// прямо в файл сборки, оглавление сбрасывается ключом его имени и
    /// размера, когда правки его и глубже закончены. Растущий архив RageLib
    /// один раз переносит в конец родителя, дальше он растёт без переносов.
    /// Прежде он ещё выносился во временный файл ради ArchiveFix и вносился
    /// обратно — два лишних прохода по диску; ArchiveFix на архиве, который
    /// RageLib уже зашифровал NG, ничего не делает («already encrypted»).
    /// Контейнер слоя Astral, из которого сняли всё, уходит целиком: пустой
    /// зарегистрированный архив — ERR_SYS_FILELOAD.
    /// </summary>
    private static async Task ApplyNestedArchiveAsync(
        RageArchiveWrapper7 parent,
        ComposeNestedArchive nested,
        List<string> completed)
    {
        var segments = nested.LocalSegments;
        var name = segments[^1];
        var directory = WalkLocalDirectories(
            parent.Root,
            segments.Take(segments.Count - 1),
            create: nested.MayCreate,
            renameToLowercase: true);
        var existing = directory.GetFile(name);
        if (existing is not null and not IArchiveBinaryFile)
            throw new InvalidDataException($"Nested RPF is not a binary entry: {nested.Label}");
        var binary = existing as IArchiveBinaryFile;
        if (binary is null)
        {
            if (!nested.MayCreate)
                throw new FileNotFoundException($"Nested RPF not found: {name}");
            using var created = new MemoryStream();
            using (var archive = RageArchiveWrapper7.Create(created, name, leaveOpen: true))
            {
                archive.Encryption = WriteEncryption;
                /* Первый сброс шифрует оглавление ключом пустого потока
                   (длина 0), а пишет 48 байт: открыть такой архив можно
                   только перебором всех ключей — по полсекунды на контейнер.
                   Второй сброс — ключом настоящей длины. */
                archive.Flush();
                archive.Flush();
            }
            binary = directory.CreateBinaryFile();
            binary.Name = name;
            binary.IsEncrypted = false;
            created.Position = 0;
            binary.Import(created);
        }
        if (binary.IsCompressed || binary.IsEncrypted)
            throw new InvalidDataException($"Nested RPF is stored compressed or encrypted: {nested.Label}");

        bool empty;
        RageArchiveWrapper7 opened;
        try
        {
            opened = OpenArchive(binary.GetStream(), name, leaveOpen: true);
        }
        catch (InvalidDataException error)
        {
            /* Путь архива в update.rpf — в отказ: имя одно на несколько мест. */
            throw new InvalidDataException($"RPF operation failed at {nested.Label}: {error.Message}", error);
        }
        using (var archive = opened)
        {
            /*
             * Место под все записи — заранее, одним ростом. Иначе каждая
             * добавленная запись растила контейнер внутри родителя, а
             * родитель на каждый рост перебирал и сортировал всё своё
             * оглавление: у update.rpf это двадцать тысяч записей на каждый
             * из полутора тысяч словарей «Ухудшения текстур». Открыт архив
             * до роста — ключ оглавления берётся от его прежней длины.
             */
            var pending = PendingImportBytes(nested.Node);
            using var sized = binary.GetStream();
            if (pending > 0) sized.SetLength(sized.Length + pending);
            await ApplyComposeNodeAsync(archive, nested.Node, completed, nested.Label + "/");
            empty = !archive.Root.GetFiles().Any() && !archive.Root.GetDirectories().Any();
            if (!(empty && nested.Label.StartsWith("x64/astral/", StringComparison.OrdinalIgnoreCase)))
            {
                /* Лишнее место уходит до записи оглавления: ключ NG — от
                   окончательной длины. */
                if (pending > 0) sized.SetLength(archive.GetDataEnd());
                archive.Encryption = WriteEncryption;
                archive.Flush();
            }
        }
        if (empty && nested.Label.StartsWith("x64/astral/", StringComparison.OrdinalIgnoreCase))
        {
            directory.DeleteFile(binary);
            return;
        }
        using (var stream = binary.GetStream())
            AssertGameKey(stream, name, nested.Label);
        ArchiveFixSequence.Add(nested.Label);
    }

    /// <summary>
    /// Сколько места возьмут записи архива и всех вложенных в него: файлы
    /// по блокам RPF и запас под рост оглавления. Ноль — записей нет.
    /// </summary>
    private static long PendingImportBytes(ComposeArchiveNode node)
    {
        const long block = 512;
        long total = 0;
        foreach (var leaf in node.Leaves)
            if (leaf.Action != "delete" && leaf.Source is not null)
                total += (new FileInfo(leaf.Source).Length + block - 1) / block * block;
        foreach (var child in node.Nested.Values)
            total += PendingImportBytes(child.Node);
        return total == 0 ? 0 : total + 1024 * 1024;
    }

    /// <summary>
    /// Папки на пути записи внутри одного архива. Поиск helper'а — без
    /// регистра, игры — с ним: папка, найденная под другим написанием
    /// (прежняя `Astral`), переименовывается в строчное.
    /// </summary>
    private static IArchiveDirectory WalkLocalDirectories(
        IArchiveDirectory root,
        IEnumerable<string> segments,
        bool create,
        bool renameToLowercase)
    {
        var directory = root;
        foreach (var segment in segments)
        {
            var next = directory.GetDirectory(segment);
            if (next is null && create)
            {
                next = directory.CreateDirectory();
                next.Name = segment;
            }
            if (next is not null && renameToLowercase &&
                !string.Equals(next.Name, segment, StringComparison.Ordinal))
                next.Name = segment;
            directory = next
                ?? throw new DirectoryNotFoundException($"RPF directory not found: {segment}");
        }
        return directory;
    }

    private static bool LocalEntryExists(IArchiveDirectory root, IReadOnlyList<string> segments)
    {
        var directory = root;
        for (var index = 0; index < segments.Count - 1; index++)
        {
            directory = directory.GetDirectory(segments[index]);
            if (directory is null) return false;
        }
        return directory.GetFile(segments[^1]) is not null;
    }

    private static void ApplyLocalEntry(
        IArchiveDirectory root,
        IReadOnlyList<string> segments,
        string action,
        string? source)
    {
        var directory = WalkLocalDirectories(
            root,
            segments.Take(segments.Count - 1),
            create: action is "import" or "upsert",
            renameToLowercase: action != "delete");
        var name = segments[^1];
        var file = directory.GetFile(name);
        if (file is not null && action != "delete" &&
            !name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(file.Name, name, StringComparison.Ordinal))
            file.Name = name;
        if (action == "delete")
        {
            if (file is null)
                throw new FileNotFoundException($"RPF entry not found: {string.Join('/', segments)}");
            directory.DeleteFile(file);
        }
        else if (action == "import")
        {
            if (file is not null)
                throw new InvalidDataException($"RPF import target already exists: {string.Join('/', segments)}");
            ImportNewEntry(directory, name, source!);
        }
        else if (file is IArchiveResourceFile resource)
        {
            resource.Import(source!);
        }
        else if (file is IArchiveBinaryFile binary)
        {
            binary.IsEncrypted = false;
            if (name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                binary.IsCompressed = false;
                binary.UncompressedSize = 0;
                binary.Import(source!);
            }
            else
                ImportBinaryContent(binary, name, source!);
        }
        else if (file is null && action == "upsert")
        {
            ImportNewEntry(directory, name, source!);
        }
        else if (file is null)
        {
            throw new FileNotFoundException($"RPF entry not found: {string.Join('/', segments)}");
        }
        else
        {
            throw new NotSupportedException($"Unsupported RPF entry: {name}");
        }
    }

    /// <summary>
    /// Оглавление архива читается ровно тем ключом, которым его прочтёт
    /// игра: по имени и размеру файла. Чтение RageLib при неудаче перебирает
    /// все ключи и такой архив открыло бы, а игра — нет; ArchiveFix на уже
    /// зашифрованном архиве ничего не делает и этого не ловит.
    /// </summary>
    private static void AssertGameKey(Stream stream, string logicalName, string label)
    {
        var position = stream.Position;
        try
        {
            stream.Position = 0;
            var header = new RageArchive7(stream, leaveOpen: true);
            header.ReadHeader(
                GTA5Constants.PC_AES_KEY,
                GTA5Crypto.GetKey(logicalName, (uint)stream.Length));
            if (header.Encryption != WriteEncryption)
                throw new InvalidDataException($"RPF finalization failed: {label}");
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new InvalidDataException(
                $"GTA V could not read the table of contents of {label}: {error.Message}",
                error);
        }
        finally
        {
            stream.Position = position;
        }
    }

    private static void ImportNewEntry(IArchiveDirectory directory, string name, string source)
    {
        Span<byte> magic = stackalloc byte[4];
        using (var stream = File.OpenRead(source))
        {
            _ = stream.Read(magic);
        }
        if (System.Text.Encoding.ASCII.GetString(magic) == "RSC7")
        {
            var resource = directory.CreateResourceFile();
            resource.Name = name;
            resource.Import(source);
            return;
        }
        var binary = directory.CreateBinaryFile();
        binary.Name = name;
        binary.IsEncrypted = false;
        if (name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            binary.Import(source);
        else
            ImportBinaryContent(binary, name, source);
    }

    /*
     * Размер сжатой записи в оглавлении RPF7 — 24 бита. Больше 16 МБ туда не
     * влезает: поле молча переполняется, игра читает обрезанный поток и падает
     * на загрузке с ERR_GEN_ZLIB_2. Так 26.09.2026 сломался weapons.awc
     * (19 МБ) в RESIDENT.rpf после «Применить» звука карабина.
     */
    private const long RpfCompressedSizeLimit = 0xFFFFFF;

    /*
     * Банк звука AWC лежит несжатым — так у всех банков самой игры (размер
     * сжатого в оглавлении 0) и так его пишет CodeWalker: звуковой движок
     * читает банк из архива напрямую.
     */
    private static bool StoresUncompressed(string name)
        => name.EndsWith(".awc", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Двоичная запись так, как её хранит Rockstar: сжатой, если сжатое
    /// помещается в оглавление, иначе — как есть. Поток сжатия закрывается
    /// до записи: у него есть последний блок, и распаковка знает, где конец.
    /// </summary>
    private static void ImportBinaryContent(IArchiveBinaryFile binary, string name, string source)
    {
        binary.IsEncrypted = false;
        var content = File.ReadAllBytes(source);
        if (!StoresUncompressed(name))
        {
            var packed = Deflate(content);
            if (packed.Length <= RpfCompressedSizeLimit)
            {
                binary.UncompressedSize = content.Length;
                binary.IsCompressed = true;
                using var compressed = new MemoryStream(packed, writable: false);
                binary.Import(compressed);
                return;
            }
        }
        binary.IsCompressed = false;
        binary.UncompressedSize = content.Length;
        using var raw = new MemoryStream(content, writable: false);
        binary.Import(raw);
    }

    private static byte[] Deflate(byte[] content)
    {
        using var output = new MemoryStream();
        using (var deflate = new System.IO.Compression.DeflateStream(
            output,
            System.IO.Compression.CompressionLevel.Optimal,
            leaveOpen: true))
            deflate.Write(content);
        return output.ToArray();
    }

    private static byte[] ReadStored(Stream stream)
    {
        using var buffer = new MemoryStream();
        stream.Position = 0;
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    private static byte[] ReadInflated(Stream inflate)
    {
        using var output = new MemoryStream();
        inflate.CopyTo(output);
        return output.ToArray();
    }

    private static async Task FinalizeTouchedArchivesAsync(
        RageArchiveWrapper7 outer,
        IEnumerable<string> archivePaths)
    {
        foreach (var archivePath in archivePaths
                     .Distinct(StringComparer.OrdinalIgnoreCase)
                     .OrderByDescending(item => item.Count(character => character == '/'))
                     .ThenBy(item => item, StringComparer.OrdinalIgnoreCase))
        {
            await FinalizeNestedArchiveAsync(outer, archivePath);
        }
    }

    private static async Task FinalizeNestedArchiveAsync(
        RageArchiveWrapper7 outer,
        string archivePath)
    {
        var segments = NormalizeEntry(archivePath, allowArchiveContainerLeaf: true);
        if (!segments[^1].EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"ArchiveFix target is not an RPF: {archivePath}");

        var opened = new List<RageArchiveWrapper7>();
        try
        {
            IArchiveDirectory directory = outer.Root;
            for (var index = 0; index < segments.Count - 1; index++)
            {
                var segment = segments[index];
                if (segment.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
                {
                    var container = directory.GetFile(segment) as IArchiveBinaryFile
                        ?? throw new FileNotFoundException($"Nested RPF not found: {segment}");
                    var nested = OpenArchive(
                        container.GetStream(),
                        segment,
                        leaveOpen: true);
                    opened.Add(nested);
                    directory = nested.Root;
                }
                else
                {
                    directory = directory.GetDirectory(segment)
                        ?? throw new DirectoryNotFoundException(
                            $"RPF directory not found: {segment}");
                }
            }

            var name = segments[^1];
            var binary = directory.GetFile(name) as IArchiveBinaryFile
                ?? throw new InvalidDataException($"ArchiveFix target is not binary: {archivePath}");
            // Контейнер слоя Astral, из которого сняли всё, уходит целиком:
            // пустой архив в папке слоя — мусор, а зарегистрированный —
            // ERR_SYS_FILELOAD. Чужие вложенные архивы не трогаются никогда.
            if (archivePath.StartsWith("x64/astral/", StringComparison.OrdinalIgnoreCase) &&
                IsEmptyArchive(binary, name))
                directory.DeleteFile(binary);
            else
                await FinalizeBinaryArchiveAsync(binary, name, archivePath);

            for (var index = opened.Count - 1; index >= 0; index--)
            {
                opened[index].Encryption = WriteEncryption;
                opened[index].Flush();
            }
        }
        finally
        {
            for (var index = opened.Count - 1; index >= 0; index--)
                opened[index].Dispose();
        }
    }

    private static bool IsEmptyArchive(IArchiveBinaryFile binary, string logicalName)
    {
        using var nested = OpenArchive(binary.GetStream(), logicalName, leaveOpen: true);
        return !nested.Root.GetFiles().Any() && !nested.Root.GetDirectories().Any();
    }

    /*
     * Оглавление вложенного архива RageLib уже пишет ключом NG его имени и
     * размера, а ArchiveFix на зашифрованном архиве ничего не делает
     * («already encrypted»). Вынос во временный файл и внос обратно ради него
     * были лишним проходом по диску: проверяется ключ, как его возьмёт игра.
     */
    private static Task FinalizeBinaryArchiveAsync(
        IArchiveBinaryFile binary,
        string logicalName,
        string traceLabel)
    {
        using (var stream = binary.GetStream())
            AssertGameKey(stream, logicalName, traceLabel);
        ArchiveFixSequence.Add(traceLabel.Replace('\\', '/'));
        return Task.CompletedTask;
    }

    private static async Task InitializeArchiveFixAsync(string? executable)
    {
        var resolved = RequireAbsoluteFile(executable ?? string.Empty, ".exe");
        if (!Path.GetFileName(resolved).Equals("ArchiveFix.exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("ArchiveFix executable name is invalid.");
        var actual = await HashFileAsync(resolved);
        if (!actual.Equals(ArchiveFixSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("ArchiveFix executable checksum mismatch.");
        ArchiveFixExecutable = resolved;
        ArchiveFixSequence.Clear();
    }

    // ArchiveFix 1.3.3.7 в конце вызывает Console.ReadKey; на перенаправленном вводе это
    // исключение .NET (код 0xE0434352) уже ПОСЛЕ записи архива. Без этого вызова Windows
    // показывает человеку окно «ArchiveFix.exe: ошибка приложения» (Windows Error Reporting,
    // салтик, 18.10.2026), с ним — процесс умирает тихо и быстрее. Режим ошибок процесса
    // наследуют дочерние процессы, поэтому достаточно выставить его до запуска ArchiveFix.
    private const uint SemFailCriticalErrors = 0x0001;
    private const uint SemNoGpFaultErrorBox = 0x0002;
    private const uint SemNoOpenFileErrorBox = 0x8000;
    private const uint ChildCrashDialogsOff = SemFailCriticalErrors | SemNoGpFaultErrorBox | SemNoOpenFileErrorBox;

    [DllImport("kernel32.dll")]
    private static extern uint SetErrorMode(uint mode);

    [DllImport("kernel32.dll")]
    private static extern uint GetErrorMode();

    private static bool SuppressChildCrashDialogs()
    {
        if (!OperatingSystem.IsWindows()) return true;
        var current = GetErrorMode();
        if ((current & ChildCrashDialogsOff) == ChildCrashDialogsOff) return true;
        SetErrorMode(current | ChildCrashDialogsOff);
        return (GetErrorMode() & ChildCrashDialogsOff) == ChildCrashDialogsOff;
    }

    private static async Task RunArchiveFixAsync(
        string archive,
        string logicalName,
        string traceLabel)
    {
        if (!Path.GetFileName(archive).Equals(logicalName, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(
                $"ArchiveFix filename mismatch: expected {logicalName}.");
        // The synthetic self-test writes AES archives with generated in-memory keys.
        // ArchiveFix only supports real GTA NG archives, so invoking it here would
        // make the deterministic helper test depend on a production game binary.
        // Production requests can never enable this private process-local flag and
        // still fail closed unless the pinned ArchiveFix executable is initialized.
        if (SelfTestArchiveFixBypass)
        {
            ValidateArchiveHeader(archive, logicalName);
            ArchiveFixSequence.Add(traceLabel.Replace('\\', '/'));
            return;
        }
        if (ArchiveFixExecutable is null)
            throw new InvalidOperationException("ArchiveFix is not initialized.");

        SuppressChildCrashDialogs();
        var startInfo = new ProcessStartInfo
        {
            FileName = ArchiveFixExecutable,
            WorkingDirectory = Path.GetDirectoryName(ArchiveFixExecutable)!,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
#if DEBUG
        foreach (var extra in ArchiveFixProbeArguments)
            startInfo.ArgumentList.Add(extra);
#endif
        startInfo.ArgumentList.Add(archive);
        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
            throw new InvalidOperationException("ArchiveFix process did not start.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        // «Нажмите любую клавишу» для ArchiveFix: перевод строки в его stdin. Если он уже вышел,
        // канал закрыт («Идет закрытие канала», IOException 232) — это не отказ: решают код выхода
        // и проверка файла ниже. Причина единичного сбоя установки не доказана (кандидат, 1 из ~8).
        try
        {
            await process.StandardInput.WriteLineAsync();
            process.StandardInput.Close();
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException)
        {
            try { process.StandardInput.Close(); } catch { }
        }
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException($"ArchiveFix timed out: {logicalName}");
        }
        _ = await stdout;
        var stderrText = await stderr;

        // ArchiveFix 1.3.3.7 writes the corrected archive and then calls
        // Console.ReadKey. In a hidden redirected process that final prompt raises
        // a known .NET console exception. The archive validation below is therefore
        // authoritative; a non-zero exit never bypasses structural verification.
        try
        {
            ValidateArchiveHeader(archive, logicalName);
        }
        catch (Exception error)
        {
            // Код выхода и stderr ArchiveFix — к отказу проверки: без них по журналу не видно, что сказал ArchiveFix.
            throw new InvalidDataException(
                $"{error.Message} (ArchiveFix exit code {process.ExitCode}; stderr: {SanitizeArchiveFixStderr(stderrText)})",
                error);
        }
        ArchiveFixSequence.Add(traceLabel.Replace('\\', '/'));
    }

#if DEBUG
    // Дополнительные аргументы ArchiveFix — только для пробы `--archivefix-probe` (поддельный ArchiveFix в тесте).
    private static string[] ArchiveFixProbeArguments = Array.Empty<string>();
#endif

    private static readonly Regex ArchiveFixPathPattern = new(
        @"(?:[A-Za-z]:[\\/]|\\\\)[^\s""'<>|*?]*|(?<![\w.])/(?:[\w.-]+/)+[\w.-]*",
        RegexOptions.Compiled);

    // stderr ArchiveFix — в сообщение ошибки, которое доходит до журнала: коротко, без путей (в них имя профиля и папка ключей).
    private static string SanitizeArchiveFixStderr(string? text)
    {
        var clean = Regex.Replace(ArchiveFixPathPattern.Replace(text ?? string.Empty, "<path>"), @"\s+", " ").Trim();
        return clean.Length > 400 ? clean[..400] + "…" : clean;
    }

#if DEBUG
    // Проба: настоящий путь RunArchiveFixAsync с поддельным ArchiveFix. Только `--archivefix-probe <exe> <archive> [аргументы…]`.
    private static async Task<object> ArchiveFixProbeAsync(string[] args)
    {
        var at = Array.FindIndex(args, value => value.Equals("--archivefix-probe", StringComparison.OrdinalIgnoreCase));
        if (args.Length < at + 3)
            throw new InvalidDataException("--archivefix-probe needs <archivefix.exe> <archive>.");
        ArchiveFixExecutable = Path.GetFullPath(args[at + 1]);
        ArchiveFixProbeArguments = args.Skip(at + 3).ToArray();
        var archive = Path.GetFullPath(args[at + 2]);
        try
        {
            await RunArchiveFixAsync(archive, Path.GetFileName(archive), "probe");
            return new { status = "ok" };
        }
        catch (Exception error)
        {
            return new { status = "failed", exceptionType = error.GetType().Name, message = error.Message };
        }
        finally
        {
            ArchiveFixExecutable = null;
            ArchiveFixProbeArguments = Array.Empty<string>();
        }
    }
#endif

    /// <summary>
    /// Вложенные архивы двух верхних уровней, которые не открываются, —
    /// путями от корня. Бета 15.10 (kevake, beta.17): вложенный архив
    /// update.rpf перестал читаться («The identifier 9EB616EE…»), а проверка
    /// сборки смотрела только записи операций. Глубже двух уровней у редукса
    /// тысячи архивов (минуты), и туда сборка без операции не пишет.
    /// </summary>
    private static HashSet<string> BrokenNestedArchives(string archivePath, string logicalName)
    {
        using var stream = new FileStream(
            archivePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1,
            FileOptions.RandomAccess);
        using var archive = OpenArchive(stream, logicalName, leaveOpen: true);
        var broken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectBrokenNested(archive.Root, "", broken, 1);
        return broken;
    }

    private const int NestedCheckDepth = 2;

    private static void CollectBrokenNested(IArchiveDirectory root, string prefix, HashSet<string> broken, int depth)
    {
        foreach (var directory in root.GetDirectories())
            CollectBrokenNested(directory, $"{prefix}{directory.Name}/", broken, depth);
        foreach (var file in root.GetFiles())
        {
            if (file is not IArchiveBinaryFile binary ||
                !file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase)) continue;
            var path = prefix + file.Name;
            try
            {
                using var nested = OpenArchive(binary.GetStream(), binary.Name, leaveOpen: true);
                if (depth < NestedCheckDepth)
                    CollectBrokenNested(nested.Root, path + "/", broken, depth + 1);
                else
                    _ = nested.Root.GetFiles().Count();
            }
            catch (Exception)
            {
                broken.Add(path);
            }
        }
    }

    private static void ValidateArchiveHeader(string archivePath, string logicalName)
    {
        using var stream = new FileStream(
            archivePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1024 * 1024,
            FileOptions.SequentialScan);
        using var archive = OpenArchive(stream, logicalName, leaveOpen: true);
        if (archive.Encryption != WriteEncryption)
            throw new InvalidDataException($"ArchiveFix validation failed: {logicalName}");
    }

    /*
     * Архив, который не открывается, — с причиной (Hubby, 16.10.2026).
     *
     * RageLib, не подобрав ключ к оглавлению, бросает `new Exception()` без
     * текста: в журнале оставалось «RPF operation failed at
     * x64/textures/waterfog_txds_dx.rpf: Exception of type 'System.Exception'
     * was thrown», и понять, битый архив, чужой или не архив вовсе, было
     * нельзя. Заголовок читается до открытия — после отказа поток может быть
     * уже закрыт, — и отказ говорит, что в нём лежит.
     */
    private static RageArchiveWrapper7 OpenArchive(Stream stream, string fileName, bool leaveOpen = false)
    {
        var header = PeekArchiveHeader(stream);
        try
        {
            return RageArchiveWrapper7.Open(stream, fileName, leaveOpen);
        }
        catch (Exception error)
        {
            throw new InvalidDataException(
                $"Archive {fileName} cannot be opened: {DescribeArchiveHeader(header, error)}",
                error);
        }
    }

    private static RageArchiveWrapper7 OpenArchive(string fileName)
    {
        ArchiveHeaderPeek header;
        using (var peek = new FileStream(fileName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            header = PeekArchiveHeader(peek);
        try
        {
            return RageArchiveWrapper7.Open(fileName);
        }
        catch (Exception error)
        {
            throw new InvalidDataException(
                $"Archive {Path.GetFileName(fileName)} cannot be opened: {DescribeArchiveHeader(header, error)}",
                error);
        }
    }

    private sealed record ArchiveHeaderPeek(byte[] Bytes, long Length, string? Problem);

    /// <summary>Первые 16 байт архива и его длина; позиция потока не меняется.</summary>
    private static ArchiveHeaderPeek PeekArchiveHeader(Stream stream)
    {
        try
        {
            if (!stream.CanSeek || !stream.CanRead)
                return new ArchiveHeaderPeek(Array.Empty<byte>(), -1, "stream is not seekable");
            var position = stream.Position;
            var bytes = new byte[16];
            stream.Position = 0;
            var read = 0;
            while (read < bytes.Length)
            {
                var chunk = stream.Read(bytes, read, bytes.Length - read);
                if (chunk <= 0) break;
                read += chunk;
            }
            var length = stream.Length;
            stream.Position = position;
            return new ArchiveHeaderPeek(bytes[..read], length, null);
        }
        catch (Exception error)
        {
            return new ArchiveHeaderPeek(Array.Empty<byte>(), -1, $"header unreadable ({error.GetType().Name})");
        }
    }

    /// <summary>Что лежит в заголовке архива, который RageLib не открыл.</summary>
    private static string DescribeArchiveHeader(ArchiveHeaderPeek header, Exception error)
    {
        /* Своё сообщение RageLib (не тот пустой отказ перебора) — дописывается. */
        var inner = error.GetType() == typeof(Exception) || string.IsNullOrWhiteSpace(error.Message)
            ? ""
            : $" ({error.Message})";
        if (header.Problem is not null) return header.Problem + inner;
        if (header.Bytes.Length < 16)
            return $"only {header.Length} bytes, too short for an RPF7 header{inner}";
        var ident = BitConverter.ToUInt32(header.Bytes, 0);
        if (ident != 0x52504637)
            return $"not an RPF7 archive (starts with {Convert.ToHexString(header.Bytes, 0, 4)}), {header.Length} bytes{inner}";
        var entries = BitConverter.ToUInt32(header.Bytes, 4);
        var names = BitConverter.ToUInt32(header.Bytes, 8);
        var encryption = (RageArchiveEncryption7)BitConverter.ToUInt32(header.Bytes, 12);
        var encryptionName = Enum.IsDefined(encryption)
            ? encryption.ToString()
            : $"0x{(uint)encryption:X8} (unknown)";
        var table = 16 + 16L * entries + names;
        if (table > header.Length)
            return $"RPF7, encryption {encryptionName}, {entries} entries: the table of contents ({table} bytes) runs past the end of the archive ({header.Length} bytes) - the archive is truncated{inner}";
        if (encryption is RageArchiveEncryption7.NG or RageArchiveEncryption7.AES)
            return $"RPF7, encryption {encryptionName}, {entries} entries, {header.Length} bytes: no game key decrypts its table of contents - the archive is damaged or encrypted for another game build{inner}";
        return $"RPF7, encryption {encryptionName}, {entries} entries, {header.Length} bytes: its table of contents is damaged{inner}";
    }

    private static string GetLogicalArchiveName(RpfRequest request, string fallbackPath)
    {
        var target = (request.ArchiveTarget ?? string.Empty).Replace('\\', '/').TrimEnd('/');
        var name = target.Length > 0 ? target.Split('/')[^1] : Path.GetFileName(fallbackPath);
        if (!name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Logical RPF target name is missing.");
        return name;
    }

    /// <summary>
    /// Проверка собранного архива так, как его прочтёт игра: оглавление —
    /// ключом по имени и размеру, путь каждой записи — посимвольно (игра
    /// ищет строчными), содержимое — по SHA-256 операции. Каждый вложенный
    /// архив открывается один раз на все свои записи: прежде три открытия на
    /// запись (наличие, поиск игры, содержимое), и у пакета растительности в
    /// полторы тысячи файлов это были тысячи разборов оглавления.
    /// </summary>
    private static void ValidateArchive(
        string archivePath,
        string logicalName,
        IReadOnlyList<ComposeOperation>? operations)
    {
        /* Без буфера потока: записи читаются кусками нужной длины, а буфер
           в 4 МБ на каждое чтение маленькой записи вычитывал бы 4 МБ. */
        using var stream = new FileStream(
            archivePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1,
            FileOptions.RandomAccess);
        AssertGameKey(stream, logicalName, logicalName);
        using var archive = OpenArchive(stream, logicalName, leaveOpen: true);
        if (archive.Encryption != WriteEncryption)
            throw new InvalidDataException($"RPF finalization failed: {logicalName}");
        var exact = new Dictionary<string, RageArchiveWrapper7?>(StringComparer.Ordinal);
        var loose = new Dictionary<string, RageArchiveWrapper7?>(StringComparer.OrdinalIgnoreCase);
        /* Один буфер на всю проверку: по 4 МБ на запись у набора в три с
           половиной тысячи записей — четырнадцать гигабайт мусора. */
        var buffer = new byte[ArchiveStreamBuffer];
        try
        {
            foreach (var operation in (operations ?? []).OrderBy(
                item => item.Entry,
                StringComparer.OrdinalIgnoreCase))
            {
                var action = NormalizeAction(operation.Action);
                var segments = NormalizeEntry(
                    operation.Entry,
                    allowArchiveContainerLeaf: action != "delete");
                if (action == "delete")
                {
                    if (FindEntry(archive, segments, loose, exactNames: false) is not null)
                        throw new InvalidDataException($"RPF staged validation failed: {operation.Entry}");
                    continue;
                }
                var file = FindEntry(archive, segments, exact, exactNames: true);
                if (file is null)
                {
                    if (FindEntry(archive, segments, loose, exactNames: false) is null)
                        throw new InvalidDataException($"RPF staged validation failed: {operation.Entry}");
                    throw new InvalidDataException(
                        $"GTA V would not find {operation.Entry}: an archive name on its path is not lowercase.");
                }
                if (string.IsNullOrWhiteSpace(operation.Source) ||
                    segments[^1].EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
                    continue;
                VerifyStoredContent(file, segments[^1], operation.Source, operation.Sha256, operation.Entry, buffer);
            }
        }
        finally
        {
            foreach (var nested in exact.Values.Concat(loose.Values))
                nested?.Dispose();
        }
    }

    /// <summary>
    /// Запись по пути: `exactNames` — как ищет игра (имена посимвольно),
    /// иначе — без регистра, как helper. Вложенные архивы открываются один
    /// раз и помнятся в `opened` по пути до них.
    /// </summary>
    private static IArchiveFile? FindEntry(
        RageArchiveWrapper7 outer,
        IReadOnlyList<string> segments,
        Dictionary<string, RageArchiveWrapper7?> opened,
        bool exactNames)
    {
        IArchiveDirectory directory = outer.Root;
        for (var index = 0; index < segments.Count - 1; index++)
        {
            var segment = segments[index];
            if (segment.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                var key = string.Join('/', segments.Take(index + 1));
                if (!opened.TryGetValue(key, out var nested))
                {
                    var container = (exactNames
                        ? directory.GetFiles().FirstOrDefault(file => string.Equals(file.Name, segment, StringComparison.Ordinal))
                        : directory.GetFile(segment)) as IArchiveBinaryFile;
                    nested = container is null
                        ? null
                        : OpenArchive(container.GetStream(), container.Name, leaveOpen: true);
                    opened[key] = nested;
                }
                if (nested is null) return null;
                directory = nested.Root;
            }
            else
            {
                var next = exactNames
                    ? directory.GetDirectories().FirstOrDefault(item => string.Equals(item.Name, segment, StringComparison.Ordinal))
                    : directory.GetDirectory(segment);
                if (next is null) return null;
                directory = next;
            }
        }
        var name = segments[^1];
        return exactNames
            ? directory.GetFiles().FirstOrDefault(file => string.Equals(file.Name, name, StringComparison.Ordinal))
            : directory.GetFile(name);
    }

    /// <summary>
    /// Запись, прочитанная так, как её прочтёт игра, обязана совпасть с тем,
    /// что в неё клали. Сверка — по SHA-256 операции, одним чтением записи:
    /// прежде каждый файл пакета читался заново с диска и сравнивался байт в
    /// байт. Первые 16 байт ресурса — заголовок RSC7: у ресурса больше 16 МБ
    /// оглавление кладёт в него свой размер, поэтому они берутся из файла
    /// пакета. Без отпечатка в операции — прежнее сравнение байт в байт.
    /// </summary>
    private static void VerifyStoredContent(
        IArchiveFile file,
        string name,
        string source,
        string? expectedSha256,
        string label,
        byte[] buffer)
    {
        if (string.IsNullOrWhiteSpace(expectedSha256))
        {
            VerifyStoredBytes(file, name, File.ReadAllBytes(source), label);
            return;
        }
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long length = 0;
        switch (file)
        {
            case IArchiveBinaryFile binary:
            {
                if (binary.IsEncrypted)
                    throw new InvalidDataException($"RPF entry was left encrypted: {label}");
                using var stored = binary.GetStream();
                stored.Position = 0;
                if (binary.IsCompressed)
                {
                    if (StoresUncompressed(name))
                        throw new InvalidDataException($"Sound bank stored compressed: {label}");
                    using var buffered = new BufferedStream(stored, 1024 * 1024);
                    using var inflate = new System.IO.Compression.DeflateStream(
                        buffered,
                        System.IO.Compression.CompressionMode.Decompress);
                    length = AppendStream(hash, inflate, buffer);
                    if (length != binary.UncompressedSize)
                        throw new InvalidDataException(
                            $"RPF entry inflates to {length} bytes instead of {binary.UncompressedSize}: {label}");
                }
                else
                    length = AppendStream(hash, stored, buffer);
                break;
            }
            case IArchiveResourceFile resource:
            {
                using var stored = resource.GetStream();
                var header = new byte[16];
                long sourceLength;
                using (var payload = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 1))
                {
                    sourceLength = payload.Length;
                    payload.ReadExactly(header);
                }
                if (stored.Length != sourceLength || stored.Length < 16)
                    throw new InvalidDataException($"RPF resource differs from its payload: {label}");
                hash.AppendData(header);
                stored.Position = 16;
                length = 16 + AppendStream(hash, stored, buffer);
                break;
            }
            default:
                throw new InvalidDataException($"RPF content check: entry missing at {label}");
        }
        var actual = Convert.ToHexString(hash.GetHashAndReset());
        if (!actual.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"RPF entry content differs from its payload: {label}");
    }

    private static long AppendStream(IncrementalHash hash, Stream stream, byte[] buffer)
    {
        long total = 0;
        int read;
        while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
        {
            hash.AppendData(buffer, 0, read);
            total += read;
        }
        return total;
    }

    /// <summary>Прежняя сверка байт в байт — для операций без отпечатка.</summary>
    private static void VerifyStoredBytes(IArchiveFile file, string name, byte[] expected, string label)
    {
        switch (file)
        {
            case IArchiveBinaryFile binary:
            {
                if (binary.IsEncrypted)
                    throw new InvalidDataException($"RPF entry was left encrypted: {label}");
                byte[] stored;
                using (var stream = binary.GetStream())
                    stored = ReadStored(stream);
                byte[] content;
                if (binary.IsCompressed)
                {
                    if (StoresUncompressed(name))
                        throw new InvalidDataException($"Sound bank stored compressed: {label}");
                    using var inflate = new System.IO.Compression.DeflateStream(
                        new MemoryStream(stored, writable: false),
                        System.IO.Compression.CompressionMode.Decompress);
                    content = ReadInflated(inflate);
                    if (content.Length != binary.UncompressedSize)
                        throw new InvalidDataException(
                            $"RPF entry inflates to {content.Length} bytes instead of {binary.UncompressedSize}: {label}");
                }
                else
                {
                    content = stored;
                }
                if (!content.AsSpan().SequenceEqual(expected))
                    throw new InvalidDataException($"RPF entry content differs from its payload: {label}");
                break;
            }
            case IArchiveResourceFile resource:
            {
                byte[] stored;
                using (var stream = resource.GetStream())
                    stored = ReadStored(stream);
                if (stored.Length != expected.Length || stored.Length < 16 ||
                    !stored.AsSpan(16).SequenceEqual(expected.AsSpan(16)))
                    throw new InvalidDataException($"RPF resource differs from its payload: {label}");
                break;
            }
            default:
                throw new InvalidDataException($"RPF content check: entry missing at {label}");
        }
    }

    private static FileStream OpenArchiveReadOnly(string archive)
        => new(
            archive,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            1024 * 1024,
            FileOptions.SequentialScan);

    private static async Task<object> ProbeAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var operations = request.Operations ?? [];
        if (operations.Count > MaxOperations)
            throw new InvalidDataException("RPF operation limit exceeded.");
        await using var stream = OpenArchiveReadOnly(archivePath);
        using var archive = OpenArchive(
            stream,
            GetLogicalArchiveName(request, archivePath),
            leaveOpen: true);
        var checkedEntries = new List<object>();
        foreach (var operation in operations)
        {
            var action = NormalizeAction(operation.Action);
            var exists = EntryExists(
                archive,
                NormalizeEntry(
                    operation.Entry,
                    allowArchiveContainerLeaf: action != "delete"));
            if (action == "import" ? exists : action == "upsert" ? false : !exists)
                throw new InvalidDataException($"RPF preflight failed: {operation.Entry}");
            checkedEntries.Add(new
            {
                entry = operation.Entry.Replace('\\', '/'),
                action,
                exists,
            });
        }
        return new
        {
            status = "ready",
            mode = "read-only",
            bytes = stream.Length,
            checkedOperations = checkedEntries.Count,
            operations = checkedEntries,
        };
    }

    private static bool EntryExists(RageArchiveWrapper7 outer, IReadOnlyList<string> segments)
    {
        var opened = new List<RageArchiveWrapper7>();
        try
        {
            IArchiveDirectory directory = outer.Root;
            for (var index = 0; index < segments.Count - 1; index++)
            {
                var segment = segments[index];
                if (segment.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
                {
                    var container = directory.GetFile(segment) as IArchiveBinaryFile;
                    if (container is null) return false;
                    var nested = OpenArchive(
                        container.GetStream(), container.Name, leaveOpen: true);
                    opened.Add(nested);
                    directory = nested.Root;
                }
                else
                {
                    var next = directory.GetDirectory(segment);
                    if (next is null) return false;
                    directory = next;
                }
            }
            return directory.GetFile(segments[^1]) is not null;
        }
        finally
        {
            for (var index = opened.Count - 1; index >= 0; index--)
                opened[index].Dispose();
        }
    }

    private static async Task<object> SearchAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var query = (request.Query ?? string.Empty).Trim();
        var prefixes = (request.Prefixes ?? [])
            .Select(value => (value ?? string.Empty).Trim())
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if ((query.Length == 0 && prefixes.Length == 0) || query.Length > 240 ||
            prefixes.Any(value => value.Length > 240))
            throw new InvalidDataException("Invalid RPF search selector.");
        var limit = Math.Clamp(request.MaxMatches ?? 1000, 1, 5000);
        var maxDepth = Math.Clamp(request.MaxNestedDepth ?? 12, 0, 24);
        await using var stream = OpenArchiveReadOnly(archivePath);
        using var archive = OpenArchive(
            stream, GetLogicalArchiveName(request, archivePath), leaveOpen: true);
        var matches = new List<object>();
        var unreadable = new List<object>();
        SearchDirectory(
            archive.Root,
            string.Empty,
            query,
            prefixes,
            matches,
            unreadable,
            limit,
            maxDepth,
            0);
        return new
        {
            status = "ready",
            mode = "read-only",
            query,
            prefixes,
            matches,
            /* Вложенные архивы, которые не открылись: поиск идёт дальше. */
            unreadable,
            truncated = matches.Count >= limit,
            keyMode = request.Keys is null ? "game-executable" : "external-verified-local",
        };
    }

    private static void SearchDirectory(
        IArchiveDirectory directory,
        string prefix,
        string query,
        IReadOnlyList<string> prefixes,
        List<object> matches,
        List<object> unreadable,
        int limit,
        int maxDepth,
        int depth)
    {
        foreach (var file in directory.GetFiles())
        {
            var candidate = string.IsNullOrEmpty(prefix) ? file.Name : $"{prefix}/{file.Name}";
            var selected = query.Length > 0 &&
                candidate.Contains(query, StringComparison.OrdinalIgnoreCase);
            selected = selected || prefixes.Any(value =>
                file.Name.StartsWith(value, StringComparison.OrdinalIgnoreCase));
            if (selected)
                matches.Add(new
                {
                    entry = candidate,
                    name = file.Name,
                    size = file.Size,
                    kind = file is IArchiveResourceFile ? "resource" : "binary",
                });
            if (matches.Count >= limit) return;
            if (depth < maxDepth && file is IArchiveBinaryFile binary &&
                file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                /*
                 * Один нечитаемый вложенный архив не роняет весь поиск (Hubby,
                 * 16.10: из-за waterfog_txds_dx.rpf падали и GPS, и мини-карта,
                 * которым вода не нужна). Он уходит в `unreadable` с причиной;
                 * тому, кому нужно именно его содержимое, откажет чтение по пути.
                 */
                RageArchiveWrapper7 nested;
                try
                {
                    nested = OpenArchive(binary.GetStream(), binary.Name, leaveOpen: true);
                }
                catch (InvalidDataException error)
                {
                    unreadable.Add(new { entry = candidate, error = ExceptionMessage(error) });
                    continue;
                }
                using (nested)
                    SearchDirectory(
                        nested.Root,
                        candidate,
                        query,
                        prefixes,
                        matches,
                        unreadable,
                        limit,
                        maxDepth,
                        depth + 1);
                if (matches.Count >= limit) return;
            }
        }
        foreach (var child in directory.GetDirectories())
        {
            var candidate = string.IsNullOrEmpty(prefix) ? child.Name : $"{prefix}/{child.Name}";
            SearchDirectory(
                child,
                candidate,
                query,
                prefixes,
                matches,
                unreadable,
                limit,
                maxDepth,
                depth);
            if (matches.Count >= limit) return;
        }
    }

    private sealed class LampArchiveScanState
    {
        public int ArchiveCount { get; set; } = 1;
        public int EntryCount { get; set; }
        public int YmapCount { get; set; }
        public List<string> EntryPaths { get; } = [];
        public List<LampEntityOccurrence> Occurrences { get; } = [];
        public List<object> ParseErrors { get; } = [];
    }

    private static async Task<object> LampArchiveScanAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var names = (request.LampArchetypeNames ?? [])
            .Select(value => (value ?? string.Empty).Trim().ToLowerInvariant())
            .ToArray();
        if (names.Length is < 1 or > 64 ||
            names.Distinct(StringComparer.Ordinal).Count() != names.Length ||
            names.Any(value => value.Length is < 1 or > 128 ||
                value.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '_' and not '-')))
        {
            throw new InvalidDataException("lamp-archive-scan requires 1-64 unique safe archetype names.");
        }
        var archetypes = names.ToDictionary(
            CodeWalker.GameFiles.JenkHash.GenHash,
            value => value);
        var maxDepth = Math.Clamp(request.MaxNestedDepth ?? 12, 0, 24);
        await using var stream = OpenArchiveReadOnly(archivePath);
        using var archive = OpenArchive(
            stream, GetLogicalArchiveName(request, archivePath), leaveOpen: true);
        var state = new LampArchiveScanState();
        ScanLampDirectory(archive.Root, string.Empty, archetypes, state, maxDepth, 0);
        var sortedEntries = state.EntryPaths.Order(StringComparer.OrdinalIgnoreCase).ToArray();
        var inventoryBytes = Encoding.UTF8.GetBytes(string.Join('\n', sortedEntries));
        var inventorySha256 = Convert.ToHexString(SHA256.HashData(inventoryBytes)).ToLowerInvariant();
        return new
        {
            status = state.ParseErrors.Count == 0 ? "ready" : "incomplete",
            mode = "lamp-archive-scan",
            edition = request.Edition,
            archive = request.ArchiveTarget,
            archiveSha256 = await HashFileAsync(archivePath),
            archiveCount = state.ArchiveCount,
            entryCount = state.EntryCount,
            ymapCount = state.YmapCount,
            inventorySha256,
            archetypes = archetypes.Select(pair => new
            {
                name = pair.Value,
                hash = $"0x{pair.Key:X8}",
            }).OrderBy(item => item.name).ToArray(),
            occurrences = state.Occurrences
                .OrderBy(item => item.YmapEntry, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.EntityIndex)
                .ToArray(),
            parseErrors = state.ParseErrors,
            complete = state.ParseErrors.Count == 0,
            keyMode = request.Keys is null ? "game-executable" : "external-verified-local",
        };
    }

    private static void ScanLampDirectory(
        IArchiveDirectory directory,
        string prefix,
        IReadOnlyDictionary<uint, string> archetypes,
        LampArchiveScanState state,
        int maxDepth,
        int depth)
    {
        foreach (var file in directory.GetFiles())
        {
            var entry = string.IsNullOrEmpty(prefix) ? file.Name : $"{prefix}/{file.Name}";
            state.EntryCount++;
            state.EntryPaths.Add(entry);
            if (file.Name.EndsWith(".ymap", StringComparison.OrdinalIgnoreCase))
            {
                state.YmapCount++;
                try
                {
                    using var resource = new MemoryStream();
                    ExportArchiveFileUncompressed(file, resource);
                    state.Occurrences.AddRange(
                        LampLightCommands.ScanYmapOccurrences(resource.ToArray(), entry, archetypes));
                }
                catch (Exception error)
                {
                    state.ParseErrors.Add(new
                    {
                        entry,
                        error = ExceptionMessage(error),
                    });
                }
            }
            if (depth < maxDepth && file is IArchiveBinaryFile binary &&
                file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    using var nested = OpenArchive(
                        binary.GetStream(), binary.Name, leaveOpen: true);
                    state.ArchiveCount++;
                    ScanLampDirectory(
                        nested.Root,
                        entry,
                        archetypes,
                        state,
                        maxDepth,
                        depth + 1);
                }
                catch (Exception error)
                {
                    state.ParseErrors.Add(new
                    {
                        entry,
                        error = ExceptionMessage(error),
                    });
                }
            }
        }
        foreach (var child in directory.GetDirectories())
        {
            var entry = string.IsNullOrEmpty(prefix) ? child.Name : $"{prefix}/{child.Name}";
            ScanLampDirectory(child, entry, archetypes, state, maxDepth, depth);
        }
    }

    private sealed class LampLodNearestState
    {
        public int YmapCount { get; set; }
        public List<LampDistantLightCandidate> Candidates { get; } = [];
        public List<object> ParseErrors { get; } = [];
    }

    private static async Task<object> LampLodNearestAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var anchors = request.LampWorldAnchors ?? [];
        if (anchors.Count is < 1 or > 1024 ||
            anchors.Select(item => item.AnchorId).Distinct(StringComparer.Ordinal).Count() != anchors.Count)
        {
            throw new InvalidDataException("lamp-lod-nearest requires 1-1024 unique anchors.");
        }
        foreach (var anchor in anchors)
        {
            if (string.IsNullOrWhiteSpace(anchor.AnchorId) || anchor.AnchorId.Length > 160 ||
                anchor.AnchorId.Any(character =>
                    !char.IsAsciiLetterOrDigit(character) && character is not '_' and not '-' and not ':' and not '.'))
                throw new InvalidDataException("Invalid lamp world anchor ID.");
            if (!float.IsFinite(anchor.X) || !float.IsFinite(anchor.Y) || !float.IsFinite(anchor.Z) ||
                MathF.Abs(anchor.X) > 20_000 || MathF.Abs(anchor.Y) > 20_000 || MathF.Abs(anchor.Z) > 20_000)
                throw new InvalidDataException("Lamp world anchor is outside the GTA V coordinate envelope.");
        }
        var maxDepth = Math.Clamp(request.MaxNestedDepth ?? 12, 0, 24);
        await using var stream = OpenArchiveReadOnly(archivePath);
        using var archive = OpenArchive(
            stream, GetLogicalArchiveName(request, archivePath), leaveOpen: true);
        var state = new LampLodNearestState();
        ScanLampLodDirectory(archive.Root, string.Empty, anchors, state, maxDepth, 0);
        var candidates = state.Candidates
            .OrderBy(item => item.AnchorId, StringComparer.Ordinal)
            .ThenBy(item => item.Distance)
            .ThenBy(item => item.YmapEntry, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.AlignedLightIndex)
            .ToArray();
        var matched = candidates.Select(item => item.AnchorId).ToHashSet(StringComparer.Ordinal);
        return new
        {
            status = state.ParseErrors.Count == 0 ? "ready" : "incomplete",
            mode = "lamp-lod-nearest",
            edition = request.Edition,
            archive = request.ArchiveTarget,
            maximumDistance = 5,
            ymapCount = state.YmapCount,
            anchors = anchors.Count,
            candidates,
            unmatchedAnchorIds = anchors.Select(item => item.AnchorId)
                .Where(anchorId => !matched.Contains(anchorId))
                .Order(StringComparer.Ordinal)
                .ToArray(),
            parseErrors = state.ParseErrors,
            complete = state.ParseErrors.Count == 0,
        };
    }

    private static void ScanLampLodDirectory(
        IArchiveDirectory directory,
        string prefix,
        IReadOnlyList<LampWorldAnchor> anchors,
        LampLodNearestState state,
        int maxDepth,
        int depth)
    {
        foreach (var file in directory.GetFiles())
        {
            var entry = string.IsNullOrEmpty(prefix) ? file.Name : $"{prefix}/{file.Name}";
            if (file.Name.EndsWith(".ymap", StringComparison.OrdinalIgnoreCase))
            {
                state.YmapCount++;
                try
                {
                    using var resource = new MemoryStream();
                    ExportArchiveFileUncompressed(file, resource);
                    state.Candidates.AddRange(LampLightCommands.ScanYmapDistantCandidates(
                        resource.ToArray(), entry, anchors, maximumDistance: 5));
                }
                catch (Exception error)
                {
                    state.ParseErrors.Add(new { entry, error = ExceptionMessage(error) });
                }
            }
            if (depth < maxDepth && file is IArchiveBinaryFile binary &&
                file.Name.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    using var nested = OpenArchive(
                        binary.GetStream(), binary.Name, leaveOpen: true);
                    ScanLampLodDirectory(nested.Root, entry, anchors, state, maxDepth, depth + 1);
                }
                catch (Exception error)
                {
                    state.ParseErrors.Add(new { entry, error = ExceptionMessage(error) });
                }
            }
        }
        foreach (var child in directory.GetDirectories())
        {
            var entry = string.IsNullOrEmpty(prefix) ? child.Name : $"{prefix}/{child.Name}";
            ScanLampLodDirectory(child, entry, anchors, state, maxDepth, depth);
        }
    }

    private static void ExportArchiveFileUncompressed(IArchiveFile file, Stream output)
    {
        if (file is IArchiveBinaryFile binary) ExportBinaryUncompressed(binary, output);
        else file.Export(output);
    }

    private static void ExportBinaryUncompressed(IArchiveBinaryFile binary, string output)
    {
        using var file = new FileStream(output, FileMode.Create);
        ExportBinaryUncompressed(binary, file);
    }

    /// <summary>
    /// Содержимое двоичной записи так, как его читает игра. Нативный хост
    /// пишет правленный вложенный архив с оглавлением OPEN (его RageLib не
    /// умеет писать NG-оглавление), а записи в нём остаются зашифрованными
    /// NG поштучно — игра и CodeWalker читают такие записи как NG («если не
    /// AES — NG», правка для файлов OpenIV). <c>ExportUncompressed</c> же
    /// расшифровывает только AES и NG: запись OPEN-архива шла в Inflate
    /// шифртекстом, и каждая нетронутая запись <c>scaleform_generic.rpf</c>
    /// после килл-эффекта, прицела, мини-карты или GPS отвечала «The archive
    /// entry was compressed using an unsupported compression method»
    /// (14.10.2026: за ними падали «Завод» и «Зоны каптов»). Остальное — как
    /// у RageLib.
    /// </summary>
    private static void ExportBinaryUncompressed(IArchiveBinaryFile binary, Stream output)
    {
        if (binary is not RageArchiveBinaryFileWrapper7 wrapper ||
            !wrapper.IsEncrypted ||
            wrapper.Encryption is RageArchiveEncryption7.AES or RageArchiveEncryption7.NG)
        {
            binary.ExportUncompressed(output);
            return;
        }
        byte[] stored;
        using (var stream = wrapper.GetStream())
            stored = ReadStored(stream);
        var uncompressedSize = checked((uint)wrapper.UncompressedSize);
        GTA5Crypto.DecryptData(stored.AsSpan(), GTA5Crypto.GetKey(wrapper.Name, uncompressedSize));
        if (!wrapper.IsCompressed)
        {
            output.Write(stored, 0, (int)Math.Min(stored.Length, uncompressedSize));
            return;
        }
        using var inflate = new System.IO.Compression.DeflateStream(
            new MemoryStream(stored, writable: false),
            System.IO.Compression.CompressionMode.Decompress);
        var content = ReadInflated(inflate);
        if (content.Length != uncompressedSize)
            throw new InvalidDataException(
                $"RPF entry inflates to {content.Length} bytes instead of {uncompressedSize}: {wrapper.Name}");
        output.Write(content, 0, content.Length);
    }

    private static async Task<object> ExtractManyAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var outputDirectory = RequireAbsoluteDirectoryPath(
            request.ExtractOutputDirectory ?? string.Empty);
        var entries = (request.ExtractEntries ?? [])
            .Select(value => NormalizeEntry(
                value ?? string.Empty,
                allowArchiveContainerLeaf: true))
            .ToArray();
        if (entries.Length == 0 || entries.Length > 5000)
            throw new InvalidDataException("Invalid RPF extraction entry count.");
        if (entries.Select(value => string.Join('/', value))
            .Distinct(StringComparer.OrdinalIgnoreCase).Count() != entries.Length)
            throw new InvalidDataException("Duplicate RPF extraction entry.");

        Directory.CreateDirectory(outputDirectory);
        var extracted = new List<object>();
        await using var stream = OpenArchiveReadOnly(archivePath);
        using var archive = OpenArchive(
            stream, GetLogicalArchiveName(request, archivePath), leaveOpen: true);
        foreach (var segments in entries)
        {
            var entry = string.Join('/', segments);
            var output = Path.GetFullPath(Path.Combine(outputDirectory, Path.Combine(segments.ToArray())));
            EnsureWithinDirectory(outputDirectory, output);
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            var staged = $"{output}.extract-{Guid.NewGuid():N}";
            try
            {
                ExportEntry(archive, segments, staged);
                File.Move(staged, output, overwrite: false);
            }
            catch
            {
                if (File.Exists(staged)) File.Delete(staged);
                throw;
            }
            extracted.Add(new
            {
                entry,
                output,
                bytes = new FileInfo(output).Length,
                sha256 = await HashFileAsync(output),
            });
        }
        return new
        {
            status = "ready",
            mode = "read-only",
            extracted,
            keyMode = request.Keys is null ? "game-executable" : "external-verified-local",
        };
    }

    private static async Task<object> ExtractAsync(RpfRequest request)
    {
        var archivePath = RequireAbsoluteFile(request.BaseArchive ?? string.Empty, ".rpf");
        var output = RequireAbsolutePath(request.ExtractOutput ?? string.Empty);
        var segments = NormalizeEntry(
            request.Entry ?? string.Empty,
            allowArchiveContainerLeaf: true);
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var staged = $"{output}.extract-{Guid.NewGuid():N}";
        try
        {
            await using var stream = OpenArchiveReadOnly(archivePath);
            using var archive = OpenArchive(
                stream, GetLogicalArchiveName(request, archivePath), leaveOpen: true);
            ExportEntry(archive, segments, staged);
            File.Move(staged, output, overwrite: true);
        }
        catch
        {
            if (File.Exists(staged)) File.Delete(staged);
            throw;
        }
        return new
        {
            status = "ready",
            mode = "read-only",
            entry = string.Join('/', segments),
            output,
            bytes = new FileInfo(output).Length,
            sha256 = await HashFileAsync(output),
        };
    }

    private static void ExportEntry(
        RageArchiveWrapper7 outer,
        IReadOnlyList<string> segments,
        string output)
    {
        var opened = new List<RageArchiveWrapper7>();
        try
        {
            IArchiveDirectory directory = outer.Root;
            for (var index = 0; index < segments.Count - 1; index++)
            {
                var segment = segments[index];
                if (segment.EndsWith(".rpf", StringComparison.OrdinalIgnoreCase))
                {
                    var container = directory.GetFile(segment) as IArchiveBinaryFile
                        ?? throw new FileNotFoundException($"Nested RPF not found: {segment}");
                    var nested = OpenArchive(
                        container.GetStream(), container.Name, leaveOpen: true);
                    opened.Add(nested);
                    directory = nested.Root;
                }
                else
                {
                    directory = directory.GetDirectory(segment)
                        ?? throw new DirectoryNotFoundException($"RPF directory not found: {segment}");
                }
            }
            var file = directory.GetFile(segments[^1])
                ?? throw new FileNotFoundException($"RPF entry not found: {string.Join('/', segments)}");
            if (file is IArchiveBinaryFile binary) ExportBinaryUncompressed(binary, output);
            else file.Export(output);
        }
        finally
        {
            for (var index = opened.Count - 1; index >= 0; index--)
                opened[index].Dispose();
        }
    }

    private static void InitializeSyntheticKeys()
    {
        WriteEncryption = RageArchiveEncryption7.AES;
        GTA5Constants.PC_AES_KEY = new byte[32];
        GTA5Constants.PC_LUT = Enumerable.Range(0, 256).Select(value => (byte)value).ToArray();
        GTA5Constants.PC_NG_KEYS = Enumerable.Range(0, 101)
            .Select(_ => new byte[0x110])
            .ToArray();
        GTA5Hash.LUT = GTA5Constants.PC_LUT;
    }

    // Читать архив хватает четырёх файлов набора ключей; таблицы шифрования
    // (51 МБ одним файлом) нужны только записи через ArchiveFix. Раньше
    // сверялись все шесть при любом чтении: у тестера беты 19.10.2026 большой
    // файл ещё не доехал, и чтение падало на «Input file not found …
    // gtav_ng_encrypt_luts.dat», хотя читать нечего было, кроме ядра на диске.
    private static async Task InitializeGameKeysAsync(
        string? executable,
        RpfKeyBundle? keys,
        bool writable = false)
    {
        if (keys is not null)
        {
            var directory = RequireAbsoluteDirectory(keys.Directory ?? string.Empty);
            var expected = new Dictionary<string, string?>
            {
                ["gtav_aes_key.dat"] = keys.AesSha256,
                ["gtav_ng_key.dat"] = keys.NgKeysSha256,
                ["gtav_ng_decrypt_tables.dat"] = keys.NgDecryptTablesSha256,
                ["gtav_hash_lut.dat"] = keys.LutSha256,
            };
            if (writable)
            {
                expected["gtav_ng_encrypt_tables.dat"] = keys.NgEncryptTablesSha256;
                expected["gtav_ng_encrypt_luts.dat"] = keys.NgEncryptLutsSha256;
            }
            foreach (var item in expected)
            {
                if (item.Value is null || item.Value.Length != 64)
                    throw new InvalidDataException($"Missing pinned hash for {item.Key}.");
                var file = RequireAbsoluteFile(Path.Combine(directory, item.Key));
                if (!string.Equals(
                    await HashFileAsync(file),
                    item.Value,
                    StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"RPF key checksum mismatch: {item.Key}");
            }
            GTA5Constants.LoadFromPath(directory);
            GTA5Hash.LUT = GTA5Constants.PC_LUT;
            WriteEncryption = RageArchiveEncryption7.NG;
            EnsureAwcKey();
            return;
        }
        var gameExecutable = RequireAbsoluteFile(executable ?? string.Empty, ".exe");
        var executableHash = await HashFileAsync(gameExecutable);
        var cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Astral",
            "cache",
            "rpf-keys",
            executableHash[..24]);
        try
        {
            GTA5Constants.PC_AES_KEY = await File.ReadAllBytesAsync(Path.Combine(cacheRoot, "aes.dat"));
            GTA5Constants.PC_NG_KEYS = CryptoIO.ReadNgKeys(Path.Combine(cacheRoot, "ng-keys.dat"));
            GTA5Constants.PC_NG_DECRYPT_TABLES = CryptoIO.ReadNgTables(
                Path.Combine(cacheRoot, "ng-decrypt.dat"));
            GTA5Constants.PC_LUT = await File.ReadAllBytesAsync(Path.Combine(cacheRoot, "hash-lut.dat"));
            GTA5Hash.LUT = GTA5Constants.PC_LUT;
            EnsureAwcKey();
            return;
        }
        catch
        {
            Directory.CreateDirectory(cacheRoot);
        }

        var executableBytes = await File.ReadAllBytesAsync(gameExecutable);
        try
        {
            GTA5Constants.Generate(executableBytes);
        }
        catch
        {
            CodeWalker.GameFiles.GTA5Keys.LoadFromPath(
                Path.GetDirectoryName(gameExecutable)!);
            GTA5Constants.PC_AES_KEY = CodeWalker.GameFiles.GTA5Keys.PC_AES_KEY;
            GTA5Constants.PC_NG_KEYS = CodeWalker.GameFiles.GTA5Keys.PC_NG_KEYS;
            GTA5Constants.PC_NG_DECRYPT_TABLES =
                CodeWalker.GameFiles.GTA5Keys.PC_NG_DECRYPT_TABLES;
            GTA5Constants.PC_LUT = CodeWalker.GameFiles.GTA5Keys.PC_LUT;
        }
        GTA5Hash.LUT = GTA5Constants.PC_LUT;
        EnsureAwcKey();
        await File.WriteAllBytesAsync(Path.Combine(cacheRoot, "aes.dat"), GTA5Constants.PC_AES_KEY);
        CryptoIO.WriteNgKeys(Path.Combine(cacheRoot, "ng-keys.dat"), GTA5Constants.PC_NG_KEYS);
        CryptoIO.WriteNgTables(
            Path.Combine(cacheRoot, "ng-decrypt.dat"),
            GTA5Constants.PC_NG_DECRYPT_TABLES);
        await File.WriteAllBytesAsync(Path.Combine(cacheRoot, "hash-lut.dat"), GTA5Constants.PC_LUT);
    }

    /*
     * AWC-дешифровка (RSXXTEA) живёт в CodeWalker.Core и берёт собственный
     * PC_AWC_KEY, а не ключи RageLib. Без него awc-inspect/-to-xml/-from-xml
     * падают NullReferenceException на живом зашифрованном банке — на это и
     * налетела студия звука. Ключ выводится из того же PC_AES_KEY, что уже
     * загружен для RPF: CodeWalker дешифрует им встроенный magic-блоб и
     * достаёт из него PC_AWC_KEY (и заодно NG-таблицы).
     */
    private static void EnsureAwcKey()
    {
        if (CodeWalker.GameFiles.GTA5Keys.PC_AWC_KEY is not null) return;
        var aes = GTA5Constants.PC_AES_KEY;
        if (aes is null || aes.Length != 32) return;
        CodeWalker.GameFiles.GTA5Keys.LoadFromPath(
            AppContext.BaseDirectory,
            false,
            Convert.ToBase64String(aes));
    }

    private static string RequireAbsoluteDirectory(string value)
    {
        var directory = RequireAbsoluteDirectoryPath(value);
        if (!Directory.Exists(directory))
            throw new DirectoryNotFoundException($"RPF key directory not found: {directory}");
        var info = new DirectoryInfo(directory);
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("RPF key directory cannot be a reparse point.");
        return directory;
    }

    private static string RequireAbsoluteDirectoryPath(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
            throw new InvalidDataException("Absolute directory path required.");
        return Path.GetFullPath(value);
    }

    private static void EnsureWithinDirectory(string root, string candidate)
    {
        var normalizedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)) +
            Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("RPF extraction escaped the output directory.");
    }

    /// <summary>
    /// Путь записи — строчными. Игра ищет запись, приведя путь к нижнему
    /// регистру и сравнивая имена оглавления посимвольно, поэтому имя с
    /// заглавной буквой для неё не существует: папка <c>x64/Astral</c> так
    /// делала невидимыми все контейнеры Astral (ERR_SYS_FILELOAD «Игровые
    /// данные повреждены»). Всё, что helper пишет или ищет, идёт этой формой.
    /// </summary>
    private static IReadOnlyList<string> NormalizeEntry(
        string value,
        bool allowArchiveContainerLeaf = false)
    {
        var normalized = (value ?? string.Empty).Trim().Replace('\\', '/').ToLowerInvariant();
        if (normalized.Length == 0 || normalized.Length > 1000 || normalized.StartsWith('/'))
            throw new InvalidDataException("Invalid RPF entry path.");
        var segments = normalized.Split('/');
        if (segments.Any(item =>
            item.Length == 0 || item is "." or ".." || item.Contains(':') || item.Contains('\0')))
        {
            throw new InvalidDataException("Unsafe RPF entry path.");
        }
        if (
            segments[^1].EndsWith(".rpf", StringComparison.OrdinalIgnoreCase) &&
            !allowArchiveContainerLeaf)
            throw new InvalidDataException("RPF entry must point to a file inside the archive.");
        return segments;
    }

    private static string RequireAbsolutePath(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
            throw new InvalidDataException("Helper paths must be absolute.");
        return Path.GetFullPath(value);
    }

    private static string RequireAbsoluteFile(string value, string? extension = null)
    {
        var resolved = RequireAbsolutePath(value);
        if (!File.Exists(resolved)) throw new FileNotFoundException("Input file not found.", resolved);
        if (extension is not null && !resolved.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Expected a {extension} archive.");
        return resolved;
    }

    private static async Task<string> HashFileAsync(string file)
    {
        // Кусками до 4 МБ (задача 8, 05.10.2026): SHA256.HashDataAsync читает
        // поток по 4 КБ, и отпечаток собранного update.rpf (2 ГБ) шёл секунды.
        await using var stream = new FileStream(
            file,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            1,
            FileOptions.SequentialScan);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[(int)Math.Clamp(stream.Length, 1L, 4L * 1024 * 1024)];
        int read;
        while ((read = await stream.ReadAsync(buffer)) > 0)
            hash.AppendData(buffer, 0, read);
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
}
