using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

/*
 * Клоны правил эффектов в ядре самого игрока.
 *
 * Эффект попадания в GTA — это не картинка, а правило: сколько эмиттеров, как
 * летят частицы, как гаснут, чем освещены. Прежний слот попаданий был одним
 * эмиттером кровяной пыли с чужой текстурой, и любая «вода» или «искры» в нём
 * летели как кровяная пыль, а цвет съедали тёмно-красные кадры донора.
 *
 * Клон — копия ЛЮБОГО штатного правила ядра целиком, со всеми его эмиттерами:
 * кровь клонируется с крови, вода — со всплеска пули по воде, искры — с искр
 * по металлу. Поведение приходит от донора, а клон настраивается:
 *
 *  • цвет — кадры ptxu_Colour перекрашиваются с сохранением яркости донора
 *    (у крови цвет живёт в правиле: красный канал, зелёный и синий — ноль);
 *  • прозрачность — множитель альфы тех же кадров;
 *  • размер — ZoomScalar событий эффекта;
 *  • густота — кадры spawnRate эмиттеров и их эволюций;
 *  • дальность — DistanceCulling*, чтобы эффект поломки предмета был виден
 *    дальше двадцати метров;
 *  • как вылетает — множители кадров свойств эмиттера: скорость, срок жизни,
 *    ускорение (падение) и размер области цели (разлёт);
 *  • точечно — замена кадров названного свойства (картинка-значок собирается
 *    из одноразового спрайта: число, срок жизни, размер, кадры цвета);
 *  • текстуры — подмена diffuse у названных частиц на новую (своя картинка)
 *    или общую для нескольких клонов (нейтральный лист кровяной пыли).
 *
 * СЛОИ. Одна запись bloodfx.dat называет одно правило, а человек хочет из
 * одной раны и кровь, и искры, и свой значок разом. Поэтому клон бывает
 * составным: каждый слой — свой донор со своими эмиттерами и своей
 * настройкой, а в ядро уезжает ОДНО правило, в котором события всех слоёв
 * стоят подряд. Эмиттеры и частицы у каждого слоя свои (`_l1_e0`, `_l1_p0`),
 * и настройка слоя трогает только их. Длительность составного — самая долгая
 * из слоёв; события остальных сжимаются к своей доле, чтобы каждый слой шёл в
 * своём темпе, а их темп проигрывания и масштаб уровня правила пересчитаны на
 * события — правило одно, а авторские значения у доноров разные.
 *
 * ДАЛЬНОСТЬ. У правил игры есть эволюция «LOD»: игра сама увеличивает брызги
 * с расстояния (у крови размер эмиттера 90 % вблизи и 350 % за сорок метров).
 * Заказ дальности множит кадры этой эволюции (вдали) и базовые кадры размера
 * (вблизи) у каждого эмиттера составного правила; эмиттеру без такой эволюции
 * она достраивается из его же базовых кадров. Дальность видимости — предел
 * отсечения по расстоянию у самого правила.
 *
 * ЧУЖОЙ СЛОВАРЬ. Не всякий донор живёт в core.ypt: клоунские эффекты — те
 * самые «Majestic», где в тело летят звёзды и дым, а в голову цветы, — лежат
 * в словаре миссии `scr_rcbarry2.ypt`, и игра грузит его только на миссии.
 * Слой с `donorFile` берёт правило из этого файла: копия та же, двоичная, а
 * текстуры, которых в ядре нет (четыре клоунских листа), переезжают в ядро
 * под именами `astral_impact_tex_<имя>` — своими, чтобы сняться вместе с
 * семейством. Текстуры, которые в ядре есть под тем же именем (свечение,
 * звезда, дым), берутся из ядра. Модели и порождаемые эффекты чужого файла
 * не переносятся: такой донор отвергается, а не переносится наполовину.
 *
 * ЦВЕТ. Три режима перекраски кадров цвета: один цвет (тон и насыщенность
 * от заказа, яркость от донора), два цвета (нижние кадры — один, верхние —
 * другой: игра выбирает каждой частице случайную долю между ними) и радуга
 * (кадры пересобираются: тон бежит по кругу за жизнь частицы, яркость и
 * прозрачность донора сохраняются).
 *
 * Копия двоичная, как у слотов следа (YptSlotReservations): донор собирается
 * во временный ресурс и читается обратно, поэтому у клона каждое поле донора,
 * а у штатных правил не меняется ни байта. Семейство клонов пересобирается
 * целиком при каждой установке: прежние правила и текстуры под заказанными
 * приставками имён удаляются (`Purge`), иначе выключенная зона так и жила бы
 * в ядре прошлым обликом.
 */

/// <summary>Подмена diffuse-текстуры у частиц клона.</summary>
internal sealed record YptCloneTexture(
    string Texture,
    IReadOnlyList<string>? Particles = null,
    string? DonorTexture = null,
    int? FrameMin = null,
    int? FrameMax = null,
    int? LastFrame = null,
    int? LoopMode = null,
    bool? ScaledOverLife = null,
    bool? Randomised = null);

/// <summary>Замена кадров одного свойства: [время, x, y, z, w].</summary>
internal sealed record YptCloneKeyframes(
    string Scope,
    string Prop,
    IReadOnlyList<IReadOnlyList<decimal>> Values,
    string? Particle = null);

/// <summary>
/// Множитель кадров свойства эмиттера: у скалярных свойств (скорость, срок
/// жизни, ускорение) — пара «от…до» (X, Y), у размеров областей — все три оси.
/// </summary>
internal sealed record YptCloneScale(string Prop, decimal Factor);

/// <summary>
/// Куда летят частицы: поворот точки прицела эмиттера.
///
/// У каждого эмиттера эффекта попадания есть область цели
/// (<c>ptxTargetDomain</c>) — место, КУДА он гонит частицы. У штатных брызг
/// крови она стоит в полуметре по оси Z от раны, то есть строго от
/// поверхности наружу; у струи и капель — на своём расстоянии. Множителем эту
/// точку не повернуть: умножение оставляет вектор на той же оси, а «пусть
/// летит вбок» — это другая ось.
///
/// Поэтому поворот задаётся углами и применяется к тому вектору, который у
/// эмиттера уже есть: <c>Pitch</c> отклоняет его от исходной оси,
/// <c>Yaw</c> вращает это отклонение вокруг неё. Ноль и ноль оставляют
/// эмиттер ровно таким, каким его сделала Rockstar, а разные эмиттеры
/// сохраняют свои разные расстояния — их длина не трогается.
/// </summary>
internal sealed record YptCloneAim(decimal Yaw, decimal Pitch);

/// <summary>Свой цвет одной части слоя — частицы донора по её имени.</summary>
internal sealed record YptClonePartColour(string Particle, IReadOnlyList<decimal> Colour);

internal sealed record YptCloneTune(
    IReadOnlyList<decimal>? Colour = null,
    string? ColourMode = null,
    // Второй цвет режима «два цвета»: верхние кадры цвета.
    IReadOnlyList<decimal>? Colour2 = null,
    // Цвет по частям — поверх общего: клякса-вспышка одним цветом, значки
    // другим. Частица называется именем донора.
    IReadOnlyList<YptClonePartColour>? PartColours = null,
    decimal? AlphaScale = null,
    decimal? ZoomScale = null,
    decimal? SpawnScale = null,
    decimal? MaxDuration = null,
    decimal? CullFade = null,
    decimal? CullDist = null,
    bool? OneShot = null,
    YptCloneAim? Aim = null,
    IReadOnlyList<YptCloneKeyframes>? Keyframes = null,
    IReadOnlyList<YptCloneScale>? Scales = null,
    // Масштаб правила целиком, проценты: кадры ptxEffectRule:m_zoomScalarKFP
    // получают одно значение. Нужен донору, у которого масштаб правила — не
    // сто: у брызг дроби по воде он 8–9 %, и значок жил бы в игре
    // двухсантиметровой точкой. Ставится до слияния слоёв, поэтому соседние
    // слои составного правила пересчитываются уже от нового значения.
    decimal? EffectZoom = null,
    // Свечение: кадры ptxu_Colour:m_emissiveIntensityKFP частиц и их
    // эволюций умножаются. У воздушного пакета машины (`veh_slipstream`)
    // шейдер светит в шестнадцать раз сильнее цвета — «ярче» значит это.
    decimal? EmissiveScale = null,
    // Подводный донор на суше: частицы с ptxu_ZCull «гасить выше уровня воды»
    // (режим 1, пространство 3 — так в ядре настроены только подводные правила,
    // пузыри подлодки в том числе) получают режим 0 — «гасить под водой», как
    // искры и пламя, которые игра рисует на суше. Без этого слой на попадании
    // не виден совсем.
    bool? OpenAir = null);

/// <summary>
/// Слой составного клона: свой донор из ядра игрока (или из чужого словаря
/// <c>DonorFile</c>), какие его частицы оставить, чем подменить текстуры и
/// как настроить. Первый слой задаёт правилу его общие поля (длительность,
/// отсечение, эволюции уровня правила).
/// </summary>
internal sealed record YptCloneLayer(
    string DonorEffect,
    IReadOnlyList<string>? KeepParticles = null,
    IReadOnlyList<YptCloneTexture>? Textures = null,
    YptCloneTune? Tune = null,
    string? DonorFile = null);

/// <summary>
/// Дальность составного правила: множитель размера вблизи (базовые кадры
/// размера эмиттеров) и вдали (кадры эволюции LOD), с какого расстояния
/// начинается «вдали» и до какого расстояния эффект вообще виден.
/// </summary>
internal sealed record YptCloneLod(
    decimal? Near = null,
    decimal? Far = null,
    decimal? Reach = null,
    decimal? DistanceMin = null,
    decimal? DistanceMax = null);

/// <summary>
/// Заказ клона: имя правила эффекта (оно же приставка имён его эмиттеров и
/// частиц) и слои. Заказ прежней формы — один донор в полях самого заказа —
/// читается как единственный слой.
/// </summary>
internal sealed record YptEffectClone(
    string Effect,
    string? DonorEffect = null,
    IReadOnlyList<string>? KeepParticles = null,
    IReadOnlyList<YptCloneTexture>? Textures = null,
    YptCloneTune? Tune = null,
    IReadOnlyList<YptCloneLayer>? Layers = null,
    YptCloneLod? Lod = null,
    // Клон встаёт под штатным именем правила (`veh_slipstream`), а штатное
    // уходит под скрытое имя `astral_wheel_stock_<имя>` — см. SwapIn.
    string? Replaces = null,
    // Приставка, под которой листы чужого словаря переезжают в ядро. По
    // умолчанию — мастерская (`astral_impact_tex_`); свои правила автора из
    // каталога («наш Core») живут под своей, чтобы «Применить» мастерской,
    // которое стирает `astral_impact_*`, их не задевало.
    string? TexturePrefix = null);

internal sealed record YptClonedEffect(
    string Effect,
    string DonorEffect,
    int Emitters,
    int DroppedEmitters,
    IReadOnlyList<string> EmitterRules,
    IReadOnlyList<string> ParticleRules,
    IReadOnlyList<string> Textures,
    int RecolouredKeyframes,
    int SpawnKeyframes,
    int ReplacedProps,
    int ScaledKeyframes = 0,
    int Layers = 1,
    IReadOnlyList<string>? Donors = null,
    int LodKeyframes = 0,
    // Текстуры, перенесённые из чужого словаря под своими именами: по ним
    // установщик дописывает строки ptxclipregions.dat (сетка кадров — от
    // исходного листа).
    IReadOnlyList<YptImportedTexture>? ImportedTextures = null,
    // Скрытое имя штатного правила, уступившего своё имя клону (`Effect` —
    // уже штатное имя). Пусто у обычного клона.
    string? Replaced = null);

/// <summary>Текстура чужого словаря в ядре: своё имя и имя исходного листа.</summary>
internal sealed record YptImportedTexture(string Texture, string Source);

internal static class YptEffectClones
{
    private const int MaxClones = 16;
    private const int MaxLayers = 8;
    private const int MaxKeyframes = 16;
    private const string LodEvolution = "LOD";
    private static readonly Regex CloneName =
        new("^astral_[a-z0-9_]{1,48}$", RegexOptions.CultureInvariant);
    private static readonly Regex DonorName =
        new("^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant);
    /* Текстуры чужого словаря живут в ядре под этой приставкой: семейство
       снимается по ней целиком вместе с правилами. */
    private const string ImportedTexturePrefix = "astral_impact_tex_";
    private static readonly Regex TexturePrefixName =
        new("^astral_[a-z0-9_]{1,32}_$", RegexOptions.CultureInvariant);
    private static readonly string[] ColourModes = ["recolour", "duo", "rainbow"];
    /* ptxu_ZCull: что значат числа, снято по всем частицам ядра Legacy
       (31.10.2026). Режим 1 + пространство 3 — 33 подводные частицы, режим 0 +
       пространство 3 — искры и пламя, которых игра рисует на суше. */
    private const int ZCullUnderReference = 0;
    private const int ZCullOverReference = 1;
    private const int ZCullSpaceWater = 3;
    /* Сколько кадров несёт радуга: семь ступеней тона на жизнь частицы. */
    private const int RainbowSteps = 8;
    /* Множить можно только свойства эмиттера и его областей: у частиц кадры —
       цвет и размер, для них есть свои органы заказа. */
    private static readonly Regex ScaleProp =
        new("^ptx(EmitterRule|CreationDomain|TargetDomain|AttractorDomain):m_[A-Za-z]{1,48}$", RegexOptions.CultureInvariant);
    private static readonly Regex PropName =
        new("^ptx[A-Za-z_]{1,40}:m_[A-Za-z]{1,48}$", RegexOptions.CultureInvariant);
    private static readonly uint DiffuseVariable = JenkHash.GenHash("diffusetex2");
    private static readonly uint SpawnRateProp =
        new ParticleKeyframePropName("ptxEmitterRule:m_spawnRateOverTimeKFP").Hash;
    private static readonly uint SizeScalarProp =
        new ParticleKeyframePropName("ptxEmitterRule:m_sizeScalarKFP").Hash;
    private static readonly uint EmissiveProp =
        new ParticleKeyframePropName("ptxu_Colour:m_emissiveIntensityKFP").Hash;
    /* Свойства эмиттера в процентах по осям X, Y, Z; W у них — сотня. */
    private static readonly HashSet<uint> PercentScalarProps =
    [
        new ParticleKeyframePropName("ptxEmitterRule:m_accnScalarKFP").Hash,
        new ParticleKeyframePropName("ptxEmitterRule:m_dampeningScalarKFP").Hash,
        new ParticleKeyframePropName("ptxEmitterRule:m_sizeScalarKFP").Hash,
        new ParticleKeyframePropName("ptxEmitterRule:m_matrixWeightScalarKFP").Hash,
    ];

    /// <summary>
    /// Записи словарей ядра под приставками имён — в виде ключей описи.
    /// <paramref name="restored"/> получает ключи штатных правил, которые
    /// вернулись под своё имя (<see cref="Unswap"/>): после сохранения они
    /// «новые» для сверки отпечатков, и сверка должна их ждать.
    /// </summary>
    internal static HashSet<string> Purge(YptFile ypt, IReadOnlyList<string> prefixes, ISet<string>? restored = null)
    {
        var removed = new HashSet<string>(StringComparer.Ordinal);
        if (prefixes.Count == 0) return removed;
        foreach (var prefix in prefixes)
            if (!CloneName.IsMatch(prefix ?? string.Empty))
                throw new InvalidDataException($"YPT clone reset prefix must live in the astral_ namespace: {prefix}");
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        YptSlotReservations.AssertDictionaries(list);
        bool Matches(string? name) =>
            !string.IsNullOrEmpty(name) &&
            prefixes.Any(prefix => name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));

        // Штатное правило, уступившее имя клону, возвращается первым: ниже
        // клоны снимаются по приставке вместе с его копией, и без возврата
        // игра осталась бы без правила под своим именем.
        Unswap(list, Matches, removed, restored);

        // Хеши словаря фильтруются вместе с правилами, а не считаются заново:
        // у штатных правил с заглавными буквами в имени хеш словаря взят от
        // строчного имени и с собственным хешем правила не совпадает.
        var effects = list.EffectRuleDictionary!;
        (effects.EffectRuleNameHashes!.data_items, effects.EffectRules!.data_items) = Without(
            effects.EffectRuleNameHashes.data_items,
            effects.EffectRules.data_items,
            item => item?.Name?.Value,
            "effect");

        var emitters = list.EmitterRuleDictionary!;
        (emitters.EmitterRuleNameHashes!.data_items, emitters.EmitterRules!.data_items) = Without(
            emitters.EmitterRuleNameHashes.data_items,
            emitters.EmitterRules.data_items,
            item => item?.Name?.Value,
            "emitter");

        var particles = list.ParticleRuleDictionary!;
        (particles.ParticleRuleNameHashes!.data_items, particles.ParticleRules!.data_items) = Without(
            particles.ParticleRuleNameHashes.data_items,
            particles.ParticleRules.data_items,
            item => item?.Name?.Value,
            "particle");
        var keptParticles = particles.ParticleRules.data_items;

        (MetaHash[] Hashes, T[] Items) Without<T>(MetaHash[] hashes, T[] items, Func<T, string?> name, string kind)
        {
            if (hashes.Length != items.Length)
                throw new InvalidDataException($"YPT {kind} rule dictionary is inconsistent.");
            var keptHashes = new List<MetaHash>(hashes.Length);
            var keptItems = new List<T>(items.Length);
            for (var index = 0; index < items.Length; index += 1)
            {
                if (Matches(name(items[index])))
                {
                    removed.Add($"{kind}:{name(items[index])}");
                    continue;
                }
                keptHashes.Add(hashes[index]);
                keptItems.Add(items[index]);
            }
            return (keptHashes.ToArray(), keptItems.ToArray());
        }

        var textures = list.TextureDictionary!;
        var keptTextures = textures.Textures!.data_items.Where(item => !Matches(item?.Name)).ToList();
        foreach (var item in textures.Textures.data_items.Where(item => Matches(item?.Name)))
            removed.Add($"texture:{item.Name}");
        if (keptTextures.Count != textures.Textures.data_items.Length)
            textures.BuildFromTextureList(keptTextures);

        // Штатное правило не имеет права ссылаться на удалённое: приставки
        // astral_ принадлежат Astral, и снаружи на них никто не указывает.
        var gone = new HashSet<string>(
            removed.Where(key => key.StartsWith("texture:", StringComparison.Ordinal))
                .Select(key => key["texture:".Length..]),
            StringComparer.OrdinalIgnoreCase);
        foreach (var particle in keptParticles)
            foreach (var variable in (particle.ShaderVars?.data_items ?? []).OfType<ParticleShaderVarTexture>())
                if (variable.Texture?.Name is { } name && gone.Contains(name))
                    throw new InvalidDataException(
                        $"YPT particle rule {particle.Name?.Value} still draws a purged texture: {name}");
        return removed;
    }

    /*
     * КЛОН ПОД ШТАТНЫМ ИМЕНЕМ.
     *
     * Воздушный пакет за машиной (`veh_slipstream`) игра зовёт по имени из
     * своего кода: ни в одном файле данных его имени нет, и клону под своим
     * именем она не дала бы ни одного кадра. Поэтому клон встаёт под штатным
     * именем, а штатное правило целиком, со всеми своими эмиттерами и
     * частицами, уходит под скрытое `astral_wheel_stock_<имя>` — оно
     * принадлежит семейству Astral, и снятие семейства (`Purge`) переименовывает
     * его обратно. Штатные эмиттеры и частицы не трогаются ни в чём: байты
     * оригинала целы, а «как в игре» — это обратное переименование, а не
     * попытка вернуть числа по памяти. Имя клону уступает только правило из
     * списка ниже: у остальных штатных правил есть данные, которыми их можно
     * подменить без этого.
     */
    private static readonly string[] SwappableEffects = ["veh_slipstream"];
    private const string StockPrefix = "astral_wheel_stock_";

    private static ParticleEffectRule? FindEffect(ParticleEffectRuleDictionary dictionary, string name) =>
        (dictionary.EffectRules?.data_items ?? [])
            .SingleOrDefault(item => string.Equals(item?.Name?.Value, name, StringComparison.Ordinal));

    private static void RemoveEffects(ParticleEffectRuleDictionary dictionary, params ParticleEffectRule[] rules)
    {
        var hashes = dictionary.EffectRuleNameHashes!.data_items;
        var items = dictionary.EffectRules!.data_items;
        if (hashes.Length != items.Length)
            throw new InvalidDataException("YPT effect rule dictionary is inconsistent.");
        var keptHashes = new List<MetaHash>(hashes.Length);
        var keptItems = new List<ParticleEffectRule>(items.Length);
        for (var index = 0; index < items.Length; index += 1)
        {
            if (rules.Any(rule => ReferenceEquals(rule, items[index]))) continue;
            keptHashes.Add(hashes[index]);
            keptItems.Add(items[index]);
        }
        dictionary.EffectRuleNameHashes.data_items = keptHashes.ToArray();
        dictionary.EffectRules.data_items = keptItems.ToArray();
    }

    private static void Rename(ParticleEffectRule rule, string name)
    {
        rule.Name = (string_r)name;
        rule.NameHash = JenkHash.GenHash(name);
    }

    /// <summary>Клон уже собран под своим именем: он и штатное правило меняются именами.</summary>
    private static YptClonedEffect SwapIn(ParticleEffectsList list, YptClonedEffect report, string stockName)
    {
        var dictionary = list.EffectRuleDictionary!;
        var hidden = StockPrefix + stockName;
        var stock = FindEffect(dictionary, stockName)
            ?? throw new InvalidDataException($"YPT core has no effect rule to replace: {stockName}");
        var custom = FindEffect(dictionary, report.Effect)
            ?? throw new InvalidDataException($"YPT clone effect rule is missing: {report.Effect}");
        if (FindEffect(dictionary, hidden) is not null)
            throw new InvalidDataException($"YPT core already holds the stock copy of {stockName}.");
        // Хеш словаря у штатного правила обязан быть от его имени: чужую запись
        // (ядро из мода с другим хешем) Astral подменять не берётся.
        var index = Array.FindIndex(dictionary.EffectRules!.data_items, item => ReferenceEquals(item, stock));
        if (dictionary.EffectRuleNameHashes!.data_items[index].Hash != JenkHash.GenHash(stockName))
            throw new InvalidDataException($"YPT effect rule {stockName} carries a foreign name hash.");
        RemoveEffects(dictionary, stock, custom);
        Rename(stock, hidden);
        Rename(custom, stockName);
        YptSlotReservations.InsertEffect(dictionary, stock);
        YptSlotReservations.InsertEffect(dictionary, custom);
        JenkIndex.Ensure(hidden);
        return report with { Effect = stockName, Replaced = hidden };
    }

    /// <summary>
    /// Обратное <see cref="SwapIn"/>: скрытое штатное правило под выбранными
    /// приставками возвращается под своё имя, клон под этим именем уходит.
    /// Клон снимается целиком, поэтому его эмиттеры и частицы тоже обязаны
    /// попадать под приставки — иначе они остались бы в ядре сиротами.
    /// </summary>
    private static void Unswap(
        ParticleEffectsList list,
        Func<string?, bool> matches,
        ISet<string> removed,
        ISet<string>? restored)
    {
        var dictionary = list.EffectRuleDictionary!;
        var hiddenRules = (dictionary.EffectRules?.data_items ?? [])
            .Where(item => item?.Name?.Value is { } name &&
                name.StartsWith(StockPrefix, StringComparison.OrdinalIgnoreCase) &&
                matches(name))
            .ToArray();
        foreach (var hiddenRule in hiddenRules)
        {
            var hiddenName = hiddenRule.Name!.Value!;
            var stockName = hiddenName[StockPrefix.Length..];
            if (!SwappableEffects.Contains(stockName, StringComparer.Ordinal))
                throw new InvalidDataException($"YPT core holds an unknown stock copy: {hiddenName}");
            var custom = FindEffect(dictionary, stockName);
            if (custom is not null)
            {
                foreach (var item in (custom.EventEmitters?.data_items ?? []).Take(custom.EventEmittersCount))
                    if (item is not null && (!matches(item.EmitterRule?.Name?.Value) || !matches(item.ParticleRule?.Name?.Value)))
                        throw new InvalidDataException(
                            $"YPT effect rule {stockName} cannot be restored: its clone lives outside the reset prefixes.");
                RemoveEffects(dictionary, hiddenRule, custom);
                removed.Add($"effect:{stockName}");
            }
            else RemoveEffects(dictionary, hiddenRule);
            removed.Add($"effect:{hiddenName}");
            Rename(hiddenRule, stockName);
            YptSlotReservations.InsertEffect(dictionary, hiddenRule);
            restored?.Add($"effect:{stockName}");
        }
    }

    /// <summary>Слои заказа: названные или единственный из полей самого заказа.</summary>
    private static IReadOnlyList<YptCloneLayer> LayersOf(YptEffectClone clone)
    {
        if (clone.Layers is { Count: > 0 })
        {
            if (clone.DonorEffect is not null || clone.KeepParticles is not null || clone.Textures is not null)
                throw new InvalidDataException($"YPT clone {clone.Effect} names both layers and a single donor.");
            return clone.Layers;
        }
        if (string.IsNullOrEmpty(clone.DonorEffect))
            throw new InvalidDataException($"YPT clone {clone.Effect} names no donor effect rule.");
        return [new YptCloneLayer(clone.DonorEffect, clone.KeepParticles, clone.Textures, clone.Tune)];
    }

    /// <param name="donors">Чужие словари по пути файла — для слоёв с <c>DonorFile</c>.</param>
    public static IReadOnlyList<YptClonedEffect> Apply(
        YptFile ypt,
        IReadOnlyList<YptEffectClone> clones,
        IReadOnlyDictionary<string, byte[]> payloads,
        IReadOnlyDictionary<string, ParticleEffectsList>? donors = null)
    {
        if (RpfManager.IsGen9)
            throw new NotSupportedException("Astral effect clones support Legacy cores only.");
        if (clones.Count is < 1 or > MaxClones)
            throw new InvalidDataException($"YPT effect clone count must be between 1 and {MaxClones}.");
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        YptSlotReservations.AssertDictionaries(list);
        var files = donors ?? new Dictionary<string, ParticleEffectsList>(StringComparer.OrdinalIgnoreCase);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var clone in clones)
        {
            if (clone is null || !CloneName.IsMatch(clone.Effect ?? string.Empty))
                throw new InvalidDataException($"YPT clone names must live in the astral_ namespace: {clone?.Effect}");
            var layers = LayersOf(clone);
            if (layers.Count > MaxLayers)
                throw new InvalidDataException($"YPT clone {clone.Effect} has more than {MaxLayers} layers.");
            foreach (var layer in layers)
            {
                if (layer is null || !DonorName.IsMatch(layer.DonorEffect ?? string.Empty))
                    throw new InvalidDataException($"YPT clone donor name is invalid: {clone.Effect}");
                if (layer.DonorFile is not null && !files.ContainsKey(layer.DonorFile))
                    throw new InvalidDataException($"YPT clone donor file is not loaded: {layer.DonorFile}");
            }
            if (!names.Add(clone.Effect!))
                throw new InvalidDataException($"YPT effect is cloned twice: {clone.Effect}");
            if (clone.Replaces is not null)
            {
                if (!SwappableEffects.Contains(clone.Replaces, StringComparer.Ordinal))
                    throw new InvalidDataException($"YPT effect rule cannot be replaced in place: {clone.Replaces}");
                if (!names.Add(clone.Replaces))
                    throw new InvalidDataException($"YPT effect is replaced twice: {clone.Replaces}");
            }
        }
        // Текстуры, общие для нескольких клонов, создаются один раз.
        var created = new Dictionary<string, Texture>(StringComparer.OrdinalIgnoreCase);
        return clones.Select(clone =>
        {
            var report = Clone(list, files, clone, payloads, created);
            return clone.Replaces is null ? report : SwapIn(list, report, clone.Replaces);
        }).ToList();
    }

    /// <summary>Имя, под которым текстура чужого словаря живёт в ядре.</summary>
    internal static string ImportedTextureName(string original, string? prefix = null)
    {
        var name = original.Trim().ToLowerInvariant();
        if (name.StartsWith("ptfx_", StringComparison.Ordinal)) name = name[5..];
        var clean = Regex.Replace(name, "[^a-z0-9_]", "_");
        prefix ??= ImportedTexturePrefix;
        if (!TexturePrefixName.IsMatch(prefix))
            throw new InvalidDataException($"YPT imported texture prefix must live in the astral_ namespace: {prefix}");
        var imported = prefix + clean;
        if (!CloneName.IsMatch(imported))
            throw new InvalidDataException($"YPT donor texture name cannot be imported: {original}");
        return imported;
    }

    /// <summary>Ключи описи, которые обязаны появиться в ядре после клонов.</summary>
    internal static HashSet<string> ExpectedKeys(IEnumerable<YptClonedEffect> cloned, IEnumerable<string>? restored = null)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        if (restored is not null) keys.UnionWith(restored);
        foreach (var item in cloned)
        {
            keys.Add($"effect:{item.Effect}");
            if (item.Replaced is not null) keys.Add($"effect:{item.Replaced}");
            foreach (var name in item.EmitterRules) keys.Add($"emitter:{name}");
            foreach (var name in item.ParticleRules) keys.Add($"particle:{name}");
            foreach (var name in item.Textures) keys.Add($"texture:{name}");
        }
        return keys;
    }

    /// <summary>Собранный слой: копия правила донора со своими эмиттерами и частицами.</summary>
    private sealed record LayerBuild(
        ParticleEffectRule Copy,
        List<ParticleEventEmitter> Kept,
        List<ParticleEmitterRule> Emitters,
        List<ParticleRule> Particles,
        List<string> EmitterNames,
        List<string> ParticleNames,
        List<string> TextureNames,
        List<YptImportedTexture> Imported,
        TuneReport Report,
        int DonorEvents,
        string Donor);

    private static YptClonedEffect Clone(
        ParticleEffectsList list,
        IReadOnlyDictionary<string, ParticleEffectsList> files,
        YptEffectClone request,
        IReadOnlyDictionary<string, byte[]> payloads,
        Dictionary<string, Texture> created)
    {
        var effects = list.EffectRuleDictionary!.EffectRules!.data_items;
        if (effects.Any(item => string.Equals(item?.Name?.Value, request.Effect, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidDataException($"YPT already contains rule {request.Effect}.");
        var layers = LayersOf(request);
        var builds = new List<LayerBuild>(layers.Count);
        for (var index = 0; index < layers.Count; index += 1)
        {
            var layer = layers[index];
            var source = layer.DonorFile is null ? list : files[layer.DonorFile];
            builds.Add(BuildLayer(list, source, request.Effect, index, layer, payloads, created, request.TexturePrefix));
        }

        var composite = builds[0].Copy;
        var kept = Merge(composite, builds, request.Effect);
        var lodKeyframes = request.Lod is { } lod ? ApplyLod(composite, kept, lod, request.Effect) : 0;
        // Последним: эволюции слоёв и достроенный LOD сводятся в один список правила.
        UnifyEvolutions(composite, kept, request.Effect);

        YptSlotReservations.InsertEffect(list.EffectRuleDictionary!, composite);
        foreach (var build in builds)
        {
            foreach (var rule in build.Emitters) YptSlotReservations.InsertEmitter(list.EmitterRuleDictionary!, rule);
            foreach (var rule in build.Particles) YptSlotReservations.InsertParticle(list.ParticleRuleDictionary!, rule);
        }
        JenkIndex.Ensure(request.Effect);
        var emitterNames = builds.SelectMany(build => build.EmitterNames).ToList();
        var particleNames = builds.SelectMany(build => build.ParticleNames).ToList();
        var textureNames = builds.SelectMany(build => build.TextureNames)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var importedNames = builds.SelectMany(build => build.Imported)
            .GroupBy(item => item.Texture, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
        foreach (var name in emitterNames.Concat(particleNames).Concat(textureNames)) JenkIndex.Ensure(name);

        return new YptClonedEffect(
            request.Effect,
            builds[0].Donor,
            kept.Count,
            builds.Sum(build => build.DonorEvents - build.Kept.Count),
            emitterNames,
            particleNames,
            textureNames,
            builds.Sum(build => build.Report.Recoloured),
            builds.Sum(build => build.Report.Spawn),
            builds.Sum(build => build.Report.Replaced),
            builds.Sum(build => build.Report.Scaled),
            builds.Count,
            builds.Select(build => build.Donor).ToList(),
            lodKeyframes,
            importedNames);
    }

    /// <summary>
    /// Копия донора слоя под именами клона: оставленные события, свои
    /// эмиттеры и частицы, подмены текстур и настройка самого слоя. В словари
    /// ничего не вставляется — это делает составной клон, когда все слои
    /// собраны и проверены. <paramref name="source"/> — словарь, в котором
    /// живёт донор: само ядро или чужой файл.
    /// </summary>
    private static LayerBuild BuildLayer(
        ParticleEffectsList list,
        ParticleEffectsList source,
        string effect,
        int layerIndex,
        YptCloneLayer layer,
        IReadOnlyDictionary<string, byte[]> payloads,
        Dictionary<string, Texture> created,
        string? texturePrefix = null)
    {
        var foreign = !ReferenceEquals(source, list);
        var effects = source.EffectRuleDictionary?.EffectRules?.data_items
            ?? throw new InvalidDataException($"YPT donor dictionary has no effect rules: {layer.DonorFile}");
        var donors = effects
            .Where(item => string.Equals(item?.Name?.Value, layer.DonorEffect, StringComparison.Ordinal))
            .ToArray();
        if (donors.Length != 1)
            throw new InvalidDataException(donors.Length == 0
                ? $"YPT donor effect rule does not exist: {layer.DonorEffect}"
                : $"YPT donor effect rule is ambiguous: {layer.DonorEffect}");
        var donor = donors[0];
        var donorEvents = donor.EventEmitters?.data_items ?? [];
        var count = Math.Min(donor.EventEmittersCount, donorEvents.Length);

        var copy = YptSlotReservations.CopyEffect(donor);
        var copyEvents = copy.EventEmitters?.data_items
            ?? throw new InvalidDataException($"YPT donor copy lost its emitters: {layer.DonorEffect}");
        if (copyEvents.Length != donorEvents.Length || copy.EventEmittersCount != donor.EventEmittersCount)
            throw new InvalidDataException($"YPT donor copy differs from its donor: {layer.DonorEffect}");

        // Какие события остаются: все или только рисующие названные частицы.
        var keepNames = layer.KeepParticles is { Count: > 0 }
            ? new HashSet<string>(layer.KeepParticles, StringComparer.Ordinal)
            : null;
        var keptIndices = new List<int>();
        for (var index = 0; index < count; index += 1)
        {
            var item = donorEvents[index];
            if (item?.ParticleRule is null || item.EmitterRule is null) continue;
            if (keepNames is null || keepNames.Contains(item.ParticleRuleName?.Value ?? string.Empty))
                keptIndices.Add(index);
        }
        if (keptIndices.Count == 0)
            throw new InvalidDataException(
                $"YPT donor effect {layer.DonorEffect} emits none of the requested particle rules.");
        if (keepNames is not null)
        {
            var found = keptIndices.Select(index => donorEvents[index].ParticleRuleName?.Value).ToHashSet(StringComparer.Ordinal);
            var missing = keepNames.Where(name => !found.Contains(name)).ToArray();
            if (missing.Length > 0)
                throw new InvalidDataException(
                    $"YPT donor effect {layer.DonorEffect} does not emit particle rule {string.Join(", ", missing)}.");
        }

        // Ёмкость массива событий у правила эффекта сохраняется; оставшиеся
        // события встают в начало и перенумеровываются.
        var kept = new List<ParticleEventEmitter>(keptIndices.Count);
        var slots = new ParticleEventEmitter[copyEvents.Length];
        for (var position = 0; position < keptIndices.Count; position += 1)
        {
            slots[position] = copyEvents[keptIndices[position]];
            slots[position].Index = (uint)position;
            kept.Add(slots[position]);
        }
        copy.EventEmitters!.data_items = slots;
        copy.EventEmittersCount = (ushort)keptIndices.Count;

        // Свои эмиттеры и частицы у клона: штатные правила общие для многих
        // эффектов (пыль крови рисуют и попадание, и хедшот), а делить их —
        // значит править счётчики ссылок ванильных правил.
        var emitterOrder = new List<ParticleEmitterRule>();
        var particleOrder = new List<ParticleRule>();
        var donorParticleOf = new Dictionary<ParticleRule, ParticleRule>(ReferenceEqualityComparer.Instance);
        for (var position = 0; position < keptIndices.Count; position += 1)
        {
            var item = kept[position];
            var original = donorEvents[keptIndices[position]];
            if (item.EmitterRule is null || item.ParticleRule is null)
                throw new InvalidDataException($"YPT donor copy lost a rule: {layer.DonorEffect}");
            if (!emitterOrder.Any(rule => ReferenceEquals(rule, item.EmitterRule))) emitterOrder.Add(item.EmitterRule);
            if (!particleOrder.Any(rule => ReferenceEquals(rule, item.ParticleRule)))
            {
                particleOrder.Add(item.ParticleRule);
                donorParticleOf[item.ParticleRule] = original.ParticleRule;
            }
        }

        // Первый слой носит имя клона, остальные — с номером слоя: так семейство
        // узнаётся по приставке целиком, а слои не спорят за имена.
        var prefix = layerIndex == 0 ? effect : $"{effect}_l{layerIndex}";
        if (layerIndex == 0)
        {
            copy.Name = (string_r)effect;
            copy.NameHash = JenkHash.GenHash(effect);
            copy.RefCount = 1;
        }
        var emitterNames = new List<string>();
        var particleNames = new List<string>();
        for (var index = 0; index < emitterOrder.Count; index += 1)
        {
            var name = $"{prefix}_e{index}";
            var rule = emitterOrder[index];
            rule.Name = (string_r)name;
            rule.NameHash = JenkHash.GenHash(name);
            rule.RefCount = (uint)(1 + kept.Count(item => ReferenceEquals(item.EmitterRule, rule)));
            emitterNames.Add(name);
        }
        for (var index = 0; index < particleOrder.Count; index += 1)
        {
            var name = $"{prefix}_p{index}";
            var rule = particleOrder[index];
            rule.Name = (string_r)name;
            rule.NameHash = JenkHash.GenHash(name);
            rule.RefCount = (uint)(1 + kept.Count(item => ReferenceEquals(item.ParticleRule, rule)));
            particleNames.Add(name);
        }
        foreach (var item in kept)
        {
            item.EmitterRuleName = (string_r)item.EmitterRule!.Name!.Value;
            item.ParticleRuleName = (string_r)item.ParticleRule!.Name!.Value;
        }

        // Внешние ссылки копии ведут в штатные объекты ядра: порождаемые
        // эффекты, модели и текстуры. При копировании эффекты и модели были
        // отцеплены, а текстуры скопировались вместе с пикселями — копии
        // возвращаются на общие штатные объекты, кроме заказанных подмен.
        // У донора из чужого словаря штатных объектов в ядре нет: эффекты и
        // модели переносить некуда (такой донор отвергается), а текстуры
        // либо находятся в ядре по имени, либо переезжают под своими.
        var coreTextures = list.TextureDictionary?.Textures?.data_items
            ?? throw new InvalidDataException("YPT texture dictionary is missing.");
        var textureNames = new List<string>();
        var importedNames = new List<YptImportedTexture>();
        foreach (var particle in particleOrder)
        {
            var original = donorParticleOf[particle];
            var spawned = original.EffectSpawnerAtRatio?.EffectRule ?? original.EffectSpawnerOnCollision?.EffectRule;
            if (foreign && spawned is not null)
                throw new InvalidDataException(
                    $"YPT donor {layer.DonorEffect} spawns effect {spawned.Name?.Value} from another file; only self-contained donors can be borrowed.");
            if (particle.EffectSpawnerAtRatio is { } atRatio)
                atRatio.EffectRule = original.EffectSpawnerAtRatio?.EffectRule;
            if (particle.EffectSpawnerOnCollision is { } onCollision)
                onCollision.EffectRule = original.EffectSpawnerOnCollision?.EffectRule;
            var copyDrawables = particle.Drawables?.data_items ?? [];
            var donorDrawables = original.Drawables?.data_items ?? [];
            if (copyDrawables.Length != donorDrawables.Length)
                throw new InvalidDataException($"YPT donor copy changed its drawables: {original.Name?.Value}");
            if (foreign && donorDrawables.Any(drawable => drawable?.Drawable is not null))
                throw new InvalidDataException(
                    $"YPT donor {layer.DonorEffect} draws models from another file; only sprite donors can be borrowed.");
            for (var index = 0; index < copyDrawables.Length; index += 1)
                if (copyDrawables[index] is { } drawable)
                    drawable.Drawable = donorDrawables[index]?.Drawable;

            var copyVariables = particle.ShaderVars?.data_items ?? [];
            var donorVariables = original.ShaderVars?.data_items ?? [];
            if (copyVariables.Length != donorVariables.Length)
                throw new InvalidDataException($"YPT donor copy changed its shader variables: {original.Name?.Value}");
            for (var index = 0; index < copyVariables.Length; index += 1)
            {
                if (copyVariables[index] is not ParticleShaderVarTexture variable) continue;
                var donorVariable = donorVariables[index] as ParticleShaderVarTexture
                    ?? throw new InvalidDataException($"YPT donor copy changed its shader variables: {original.Name?.Value}");
                var textureName = donorVariable.TextureName?.Value ?? donorVariable.Texture?.Name;
                var swap = variable.Name.Hash == DiffuseVariable && donorVariable.Texture is not null
                    ? FindSwap(layer.Textures, original.Name?.Value, textureName)
                    : null;
                if (swap is not null)
                {
                    var texture = SwapTexture(list, swap, variable, payloads, created);
                    if (!textureNames.Contains(texture.Name, StringComparer.OrdinalIgnoreCase)) textureNames.Add(texture.Name);
                    ApplyFrames(particle, swap, effect);
                    continue;
                }
                if (!foreign)
                {
                    variable.Texture = donorVariable.Texture;
                    continue;
                }
                // Чужой донор: лист ядра под тем же именем — общий, иначе
                // лист переезжает из копии (она привезла его пиксели).
                if (string.IsNullOrEmpty(textureName) || string.Equals(textureName, "None", StringComparison.OrdinalIgnoreCase))
                {
                    variable.Texture = null;
                    continue;
                }
                var shared = coreTextures.FirstOrDefault(item =>
                    item is not null && string.Equals(item.Name, textureName, StringComparison.OrdinalIgnoreCase));
                if (shared is not null)
                {
                    variable.Texture = shared;
                    variable.TextureName = (string_r)shared.Name;
                    variable.TextureNameHash = shared.NameHash;
                    continue;
                }
                if (donorVariable.Texture is null)
                    throw new InvalidDataException(
                        $"YPT donor {layer.DonorEffect} draws texture {textureName}, which neither its file nor the core carries.");
                var imported = ImportTexture(list, variable, textureName, created, texturePrefix);
                if (!textureNames.Contains(imported.Name, StringComparer.OrdinalIgnoreCase)) textureNames.Add(imported.Name);
                if (!importedNames.Any(item => string.Equals(item.Texture, imported.Name, StringComparison.OrdinalIgnoreCase)))
                    importedNames.Add(new YptImportedTexture(imported.Name, textureName));
            }
        }
        foreach (var swap in layer.Textures ?? [])
            if (!textureNames.Contains(swap.Texture ?? string.Empty, StringComparer.OrdinalIgnoreCase))
                throw new InvalidDataException(
                    $"YPT clone {effect} has no particle drawing the texture to replace with {swap.Texture}.");

        var report = ApplyTune(copy, kept, emitterOrder, particleOrder, donorParticleOf, layer.Tune, effect);
        return new LayerBuild(
            copy, kept, emitterOrder, particleOrder, emitterNames, particleNames, textureNames, importedNames,
            report, count, layer.DonorEffect);
    }

    /// <summary>
    /// Текстура чужого словаря — в ядро под своим именем. Пиксели и раскладка
    /// уже в копии (двоичный клон привёз её вместе с частицей); меняется
    /// только имя. Одна и та же текстура нескольких слоёв и клонов переезжает
    /// один раз.
    /// </summary>
    private static Texture ImportTexture(
        ParticleEffectsList list,
        ParticleShaderVarTexture variable,
        string original,
        Dictionary<string, Texture> created,
        string? texturePrefix)
    {
        var name = ImportedTextureName(original, texturePrefix);
        if (!created.TryGetValue(name, out var texture))
        {
            var dictionary = list.TextureDictionary!;
            var hash = JenkHash.GenHash(name.ToLowerInvariant());
            if (dictionary.TextureNameHashes!.data_items.Contains(hash))
                throw new InvalidDataException($"YPT already contains texture {name}.");
            texture = variable.Texture
                ?? throw new InvalidDataException($"YPT donor copy lost its texture: {original}");
            if (texture.Data?.FullData is not { Length: > 0 })
                throw new InvalidDataException($"YPT donor texture has no pixels: {original}");
            texture.Name = name;
            texture.NameHash = hash;
            dictionary.BuildFromTextureList(dictionary.Textures!.data_items.Append(texture).ToList());
            created[name] = texture;
        }
        variable.Texture = texture;
        variable.TextureName = (string_r)texture.Name;
        variable.TextureNameHash = texture.NameHash;
        return texture;
    }

    /// <summary>Масштаб уровня правила: первый кадр ptxEffectRule:m_zoomScalarKFP, проценты.</summary>
    private static float EffectZoom(ParticleEffectRule rule)
    {
        var frames = rule.ZoomScalarKFP?.Values?.data_items;
        if (frames is not { Length: > 0 } || frames[0] is null) return 100f;
        var zoom = frames[0].KeyframeValue.X;
        return zoom > 0f ? zoom : 100f;
    }

    /// <summary>
    /// События всех слоёв — в одно правило. Правило остаётся правилом первого
    /// слоя (его длительность, отсечение, свойства уровня правила), события
    /// остальных слоёв встают следом, а их темп и масштаб пересчитаны так,
    /// чтобы каждый слой выглядел, как у своего донора. Эволюции всех слоёв
    /// сводятся в один список позже (<see cref="UnifyEvolutions"/>).
    /// </summary>
    private static List<ParticleEventEmitter> Merge(ParticleEffectRule composite, List<LayerBuild> builds, string effect)
    {
        var capacity = composite.EventEmitters?.data_items?.Length
            ?? throw new InvalidDataException($"YPT clone {effect} lost its event list.");
        var total = builds.Sum(build => build.Kept.Count);
        if (total > Math.Min(capacity, MaxEventEmitters))
            throw new InvalidDataException(
                $"YPT clone {effect} would carry {total} emitters; GTA plays at most {Math.Min(capacity, MaxEventEmitters)} per effect rule.");
        if (builds.Count > 1)
        {
            var durationMax = builds.Max(build => build.Copy.DurationMax);
            var durationMin = builds.Max(build => build.Copy.DurationMin);
            var zoom = EffectZoom(composite);
            foreach (var build in builds)
            {
                var own = build.Copy;
                // Слой короче правила идёт в своей доле его времени: у искр
                // длительность 0,1 с, у крови — секунда, и искры не должны
                // растягиваться на всю секунду.
                var ratio = durationMax > 0f && own.DurationMax > 0f ? own.DurationMax / durationMax : 1f;
                var playMin = composite.PlaybackRateScalarMin > 0f ? own.PlaybackRateScalarMin / composite.PlaybackRateScalarMin : 1f;
                var playMax = composite.PlaybackRateScalarMax > 0f ? own.PlaybackRateScalarMax / composite.PlaybackRateScalarMax : 1f;
                var scale = EffectZoom(own) / zoom;
                if (ReferenceEquals(own, composite)) { playMin = 1f; playMax = 1f; scale = 1f; }
                foreach (var item in build.Kept)
                {
                    item.StartRatio = Math.Clamp(item.StartRatio * ratio, 0f, 1f);
                    item.EndRatio = Math.Clamp(item.EndRatio * ratio, 0f, 1f);
                    item.PlaybackRateScalarMin *= playMin;
                    item.PlaybackRateScalarMax *= playMax;
                    item.ZoomScalarMin *= scale;
                    item.ZoomScalarMax *= scale;
                }
            }
            composite.DurationMin = durationMin;
            composite.DurationMax = durationMax;
            composite.DistanceCullingCullDist = builds.Max(build => build.Copy.DistanceCullingCullDist);
            composite.DistanceCullingFadeDist = Math.Min(
                composite.DistanceCullingCullDist,
                builds.Max(build => build.Copy.DistanceCullingFadeDist));
            composite.ViewportCullingSphereRadius = builds.Max(build => build.Copy.ViewportCullingSphereRadius);
            // Дальность LOD — у первого слоя, а если её у него нет (дымка
            // blood_nose: 0…0), — самая широкая из слоёв, у которых она есть:
            // иначе кадры LOD соседних слоёв считались бы делением на ноль.
            if (composite.LodEvoDistanceMax <= composite.LodEvoDistanceMin)
            {
                var ranged = builds.Select(build => build.Copy)
                    .Where(rule => rule.LodEvoDistanceMax > rule.LodEvoDistanceMin)
                    .ToList();
                if (ranged.Count > 0)
                {
                    composite.LodEvoDistanceMin = ranged.Min(rule => rule.LodEvoDistanceMin);
                    composite.LodEvoDistanceMax = ranged.Max(rule => rule.LodEvoDistanceMax);
                }
            }
        }
        var slots = new ParticleEventEmitter[capacity];
        var kept = new List<ParticleEventEmitter>(total);
        foreach (var build in builds)
            foreach (var item in build.Kept)
            {
                item.Index = (uint)kept.Count;
                slots[kept.Count] = item;
                kept.Add(item);
            }
        composite.EventEmitters!.data_items = slots;
        composite.EventEmittersCount = (ushort)kept.Count;
        return kept;
    }

    /// <summary>
    /// Дальность: размер вблизи — базовые кадры размера эмиттера, вдали —
    /// кадры его эволюции LOD (у эмиттера без неё она достраивается из
    /// базовых), предел видимости — отсечение по расстоянию у правила.
    /// </summary>
    private static int ApplyLod(ParticleEffectRule effect, IReadOnlyList<ParticleEventEmitter> kept, YptCloneLod lod, string label)
    {
        var near = lod.Near is decimal nearValue ? Bounded(nearValue, 0.1m, 8m, "lod near", label) : 1f;
        var far = lod.Far is decimal farValue ? Bounded(farValue, 0.1m, 8m, "lod far", label) : 1f;
        if (lod.DistanceMin is decimal distanceMin)
            effect.LodEvoDistanceMin = Bounded(distanceMin, 0m, 1000m, "lod distanceMin", label);
        if (lod.DistanceMax is decimal distanceMax)
            effect.LodEvoDistanceMax = Bounded(distanceMax, 1m, 1000m, "lod distanceMax", label);
        // Правило без дальности (дымка blood_nose: 0…0) берёт её у крови
        // игры — 5…40 м; заданная заказом дальность не подменяется.
        if (lod.DistanceMin is null && lod.DistanceMax is null &&
            effect.LodEvoDistanceMin == 0f && effect.LodEvoDistanceMax == 0f)
        {
            effect.LodEvoDistanceMin = BloodLodDistanceMin;
            effect.LodEvoDistanceMax = BloodLodDistanceMax;
        }
        if (effect.LodEvoDistanceMax <= effect.LodEvoDistanceMin)
            throw new InvalidDataException($"YPT clone {label} lod distances are out of order.");
        if (lod.Reach is decimal reachValue)
        {
            var reach = Bounded(reachValue, 5m, 2000m, "lod reach", label);
            effect.DistanceCullingCullDist = reach;
            // Гаснуть начинает на последних 13 % пути — та же доля, что у
            // штатной крови (130 из 150 метров).
            effect.DistanceCullingFadeDist = Math.Max(1f, reach * 0.87f);
        }
        // «Вдали» — по событиям и от исходных кадров размера; «вблизи» — по
        // одному разу на эмиттер. Эмиттер, общий для двух событий, иначе
        // получал бы «вблизи» дважды, а эволюция второго события строилась бы
        // из уже умноженных кадров. Окно (packages/ptfx-runtime/clone.js)
        // считает так же.
        var touched = 0;
        ParticleKeyframeProp? SizeOf(ParticleEventEmitter? item)
        {
            var prop = (item?.EmitterRule?.KeyframeProps ?? []).FirstOrDefault(candidate => candidate is not null && candidate.Name.Hash == SizeScalarProp);
            return prop?.Values?.data_items is { Length: > 0 } ? prop : null;
        }
        if (far != 1f)
            foreach (var item in kept)
            {
                var baseProp = SizeOf(item);
                if (baseProp is null) continue;
                var evolved = LodKeyframes(item!, SizeScalarProp);
                touched += evolved is not null
                    ? ScaleXY(evolved.Keyframe?.data_items, far)
                    : CreateLodKeyframes(item!, baseProp, far);
            }
        if (near != 1f)
        {
            var done = new HashSet<ParticleEmitterRule>(ReferenceEqualityComparer.Instance);
            foreach (var item in kept)
            {
                var baseProp = SizeOf(item);
                if (baseProp is null || !done.Add(item!.EmitterRule!)) continue;
                touched += ScaleXY(baseProp.Values!.data_items, near);
            }
        }
        return touched;
    }

    /*
     * СВОЙ ВЫСТРЕЛ БЕЗ СЛЕДА (задача 14 ТЗ 10.10.2026).
     *
     * Кто стрелял, файлы игры не знают: `TracerFx` и шансы у ствола одни на
     * всех персонажей. Ближайшее, что делается файлом, — дальность LOD правила
     * следа: игра меряет её от камеры до ближайшей к ней точки следа (замер в
     * игре 10.10.2026). Свой след начинается у своего дула — в метрах от
     * камеры; чужой, пролетевший рядом с ней, — тоже без следа. Базовые
     * кадры размера эмиттера — ноль (вблизи следа нет), кадры
     * эволюции LOD — сто процентов (к `to` след полного размера), дальность
     * LOD — от `from` до `to`. Списки эволюций не меняются — только значения
     * кадров и две дальности правила.
     */
    internal static int HideTracerNearCamera(YptFile ypt, string name, float from, float to)
    {
        if (!(from >= 0.5f && from < to && to <= 100f))
            throw new InvalidDataException($"YPT tracer near-hide distances are out of range: {name}");
        var effect = (ypt.PtfxList?.EffectRuleDictionary?.EffectRules?.data_items ?? [])
            .SingleOrDefault(item => item is not null && string.Equals(item.Name?.Value, name, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException($"YPT effect rule does not exist: {name}");
        var touched = 0;
        foreach (var item in effect.EventEmitters?.data_items ?? [])
        {
            if (item?.EmitterRule is null) continue;
            var size = (item.EmitterRule.KeyframeProps ?? []).FirstOrDefault(prop => prop is not null && prop.Name.Hash == SizeScalarProp)
                ?? throw new InvalidDataException($"YPT tracer emitter has no size scalar: {name}");
            var lod = LodKeyframes(item, SizeScalarProp)
                ?? throw new InvalidDataException($"YPT tracer event has no LOD size evolution: {name}");
            lod.Keyframe = new ResourceSimpleList64<ParticleKeyframePropValue>
            {
                data_items = BuildFrames([(0f, new SharpDX.Vector4(100f, 100f, 100f, 0f))], name),
            };
            size.Values = new ResourceSimpleList64<ParticleKeyframePropValue>
            {
                data_items = BuildFrames([(0f, new SharpDX.Vector4(0f, 0f, 0f, 100f))], name),
            };
            touched += 1;
        }
        if (touched == 0) throw new InvalidDataException($"YPT tracer has no emitter to hide: {name}");
        effect.LodEvoDistanceMin = from;
        effect.LodEvoDistanceMax = to;
        return touched;
    }

    /// <summary>Пережило ли сохранение «вблизи следа нет» — сверка после записи.</summary>
    internal static bool TracerHiddenNearCamera(YptFile ypt, string name, float from, float to)
    {
        var effect = (ypt.PtfxList?.EffectRuleDictionary?.EffectRules?.data_items ?? [])
            .SingleOrDefault(item => item is not null && string.Equals(item.Name?.Value, name, StringComparison.OrdinalIgnoreCase));
        if (effect is null || Math.Abs(effect.LodEvoDistanceMin - from) > 1e-3f || Math.Abs(effect.LodEvoDistanceMax - to) > 1e-3f)
            return false;
        foreach (var item in effect.EventEmitters?.data_items ?? [])
        {
            if (item?.EmitterRule is null) continue;
            var size = (item.EmitterRule.KeyframeProps ?? []).FirstOrDefault(prop => prop is not null && prop.Name.Hash == SizeScalarProp);
            var frames = size?.Values?.data_items ?? [];
            if (frames.Length == 0 || frames.Any(frame => frame is null || frame.KeyframeValue.X != 0f || frame.KeyframeValue.Y != 0f || frame.KeyframeValue.Z != 0f))
                return false;
            var far = LodKeyframes(item, SizeScalarProp)?.Keyframe?.data_items ?? [];
            if (far.Length == 0 || far.Any(frame => frame is null || Math.Abs(frame.KeyframeValue.X - 100f) > 1e-3f))
                return false;
        }
        return true;
    }

    /*
     * ОДИН СПИСОК ЭВОЛЮЦИЙ НА ПРАВИЛО.
     *
     * У Rockstar список эволюций события либо пуст, либо слово в слово тот же,
     * что у его правила: так в ядре игрока у 2340 событий из 2357, остальные —
     * пустые правила с одним LOD, где кадров эволюций нет вовсе. Номер
     * эволюции в кадрах события (`EvolutionID`) игра, по всему видно, берёт
     * как номер в значениях эволюций экземпляра эффекта, а их столько, сколько
     * эволюций у правила. Составной клон нарушал это: правило — от первого
     * слоя (у тления — один LOD), события крови — со своим списком (LOD и
     * angle). Второе значение писалось за конец массива экземпляра, затирало
     * соседний указатель, и игра падала на попадании (24.09.2026: оба краша —
     * GTA5.exe+0x1282f28, чтение по указателю с чужой старшей половиной).
     *
     * Поэтому список правила — объединение списков всех событий в порядке
     * появления (первым — список первого слоя, его номера не меняются), а
     * каждое событие с непустым списком получает ровно его, с перенумерованными
     * кадрами. Больше пяти эволюций у правил игры не бывает; лишние сверх пяти
     * снимаются, начиная с тех, что попаданию никто не задаёт (скорость, дым,
     * ветер — не LOD, не angle и не size), вместе со своими кадрами: их значение
     * в попадании всегда ноль, и в игре они ничего не меняли.
     *
     * 05.10.2026: тот же краш вернулся с клоном, у которого эволюции уже были
     * сведены, — тело из трёх слоёв, 11 событий. Все три дампа (и оба от
     * 24.09) падают на обходе восьмого эмиттера экземпляра (счётчик цикла 7):
     * игра держит у эффекта не больше семи событий. Так и в её данных — у
     * 5 028 правил в 400 словарях update.rpf событий от одного до семи. Массив
     * событий в ресурсе рассчитан на 32, но это не предел игры.
     */
    private const int MaxEvolutions = 5;
    internal const int MaxEventEmitters = 7;
    // Дальность LOD штатной крови (blood_entry, blood_exit …): 5…40 м.
    private const float BloodLodDistanceMin = 5f;
    private const float BloodLodDistanceMax = 40f;
    private static readonly string[] DrivenEvolutions = [LodEvolution, "angle", "size"];

    private static void UnifyEvolutions(ParticleEffectRule rule, IReadOnlyList<ParticleEventEmitter> kept, string label)
    {
        static IEnumerable<string> Names(ParticleEvolutionList? list) =>
            (list?.Evolutions?.data_items ?? [])
                .Select(item => item?.Name?.Value ?? string.Empty);
        var union = new List<string>();
        void Add(IEnumerable<string> names)
        {
            foreach (var name in names)
                if (name.Length > 0 && !union.Contains(name, StringComparer.OrdinalIgnoreCase)) union.Add(name);
        }
        Add(Names(rule.EvolutionList));
        foreach (var item in kept) Add(Names(item?.EvolutionList));
        while (union.Count > MaxEvolutions)
        {
            var spare = union.FindLastIndex(name =>
                !DrivenEvolutions.Contains(name, StringComparer.OrdinalIgnoreCase));
            if (spare < 0)
                throw new InvalidDataException($"YPT clone {label} needs more than {MaxEvolutions} evolutions.");
            union.RemoveAt(spare);
        }
        if (union.Count == 0) return;
        foreach (var name in union) JenkIndex.Ensure(name);

        rule.EvolutionList = Renumber(rule.EvolutionList, union, keepEmpty: false);
        foreach (var item in kept)
            if (item is not null) item.EvolutionList = Renumber(item.EvolutionList, union, keepEmpty: true);
    }

    /*
     * Список эволюций под общий: кадры перенумерованы по имени, кадры снятых
     * эволюций убраны вместе со свойствами, у которых кадров не осталось.
     * Пустой список события остаётся пустым — так бывает и у Rockstar.
     */
    private static ParticleEvolutionList? Renumber(ParticleEvolutionList? list, List<string> union, bool keepEmpty)
    {
        var names = (list?.Evolutions?.data_items ?? []).Select(item => item?.Name?.Value ?? string.Empty).ToArray();
        var props = (list?.EvolvedKeyframeProps?.data_items ?? []).Where(prop => prop is not null).ToList();
        if (keepEmpty && names.Length == 0 && props.Count == 0) return list;
        foreach (var prop in props)
        {
            var frames = new List<ParticleEvolvedKeyframes>();
            foreach (var entry in prop.EvolvedKeyframes?.data_items ?? [])
            {
                if (entry is null || entry.EvolutionID < 0 || entry.EvolutionID >= names.Length) continue;
                var index = union.FindIndex(name => string.Equals(name, names[entry.EvolutionID], StringComparison.OrdinalIgnoreCase));
                if (index < 0) continue;
                entry.EvolutionID = index;
                frames.Add(entry);
            }
            prop.EvolvedKeyframes ??= new ResourceSimpleList64<ParticleEvolvedKeyframes>();
            prop.EvolvedKeyframes.data_items = frames.ToArray();
        }
        props = props.Where(prop => prop.EvolvedKeyframes!.data_items.Length > 0).ToList();
        var result = list ?? new ParticleEvolutionList();
        result.Evolutions = new ResourceSimpleList64<ParticleEvolutions>
        {
            data_items = union.Select(name => new ParticleEvolutions { Name = (string_r)name }).ToArray(),
        };
        result.EvolvedKeyframeProps ??= new ResourceSimpleList64<ParticleEvolvedKeyframeProps>();
        result.EvolvedKeyframeProps.data_items = props.ToArray();
        // Карта свойств — по хешу имени, как её строит CodeWalker из XML.
        result.EvolvedKeyframePropMap ??= new ResourceSimpleList64<ParticleEvolvedKeyframePropMap>();
        result.EvolvedKeyframePropMap.data_items = props
            .Select(prop => new ParticleEvolvedKeyframePropMap { Name = prop.Name, Item = prop })
            .OrderBy(entry => entry.Name.Hash)
            .ToArray();
        return result;
    }

    /// <summary>Кадры эволюции LOD названного свойства у события или <c>null</c>.</summary>
    private static ParticleEvolvedKeyframes? LodKeyframes(ParticleEventEmitter item, uint prop)
    {
        foreach (var evolved in item.EvolutionList?.EvolvedKeyframeProps?.data_items ?? [])
        {
            if (evolved is null || evolved.Name.Hash != prop) continue;
            foreach (var frames in evolved.EvolvedKeyframes?.data_items ?? [])
                if (frames is not null && frames.IsLodEvolution != 0) return frames;
        }
        return null;
    }

    /// <summary>
    /// Эволюция LOD для свойства, у которого её не было: те же кадры, что у
    /// базового свойства, умноженные на «вдали». Список эволюций события и
    /// карта свойств достраиваются так же, как их читает XML CodeWalker'а.
    /// </summary>
    private static int CreateLodKeyframes(ParticleEventEmitter item, ParticleKeyframeProp baseProp, float far)
    {
        var list = item.EvolutionList ??= new ParticleEvolutionList
        {
            Evolutions = new ResourceSimpleList64<ParticleEvolutions>(),
            EvolvedKeyframeProps = new ResourceSimpleList64<ParticleEvolvedKeyframeProps>(),
            EvolvedKeyframePropMap = new ResourceSimpleList64<ParticleEvolvedKeyframePropMap>(),
        };
        list.Evolutions ??= new ResourceSimpleList64<ParticleEvolutions>();
        list.EvolvedKeyframeProps ??= new ResourceSimpleList64<ParticleEvolvedKeyframeProps>();
        list.EvolvedKeyframePropMap ??= new ResourceSimpleList64<ParticleEvolvedKeyframePropMap>();

        var evolutions = (list.Evolutions.data_items ?? []).ToList();
        var index = evolutions.FindIndex(evolution =>
            string.Equals(evolution?.Name?.Value, LodEvolution, StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            evolutions.Add(new ParticleEvolutions { Name = (string_r)LodEvolution });
            index = evolutions.Count - 1;
            list.Evolutions.data_items = evolutions.ToArray();
            JenkIndex.Ensure(LodEvolution);
        }

        var props = (list.EvolvedKeyframeProps.data_items ?? []).Where(prop => prop is not null).ToList();
        var prop = props.FirstOrDefault(candidate => candidate.Name.Hash == baseProp.Name.Hash);
        if (prop is null)
        {
            prop = new ParticleEvolvedKeyframeProps
            {
                Name = baseProp.Name,
                BlendMode = 1,
                EvolvedKeyframes = new ResourceSimpleList64<ParticleEvolvedKeyframes>(),
            };
            props.Add(prop);
        }
        prop.EvolvedKeyframes ??= new ResourceSimpleList64<ParticleEvolvedKeyframes>();
        var frames = (baseProp.Values?.data_items ?? [])
            .Where(frame => frame is not null)
            .Select(frame => new ParticleKeyframePropValue
            {
                KeyframeTime = frame.KeyframeTime,
                KeyframeValue = new SharpDX.Vector4(
                    frame.KeyframeValue.X * far,
                    frame.KeyframeValue.Y * far,
                    frame.KeyframeValue.Z,
                    frame.KeyframeValue.W),
            })
            .ToArray();
        var items = (prop.EvolvedKeyframes.data_items ?? []).Where(entry => entry is not null).ToList();
        items.Add(new ParticleEvolvedKeyframes
        {
            EvolutionID = index,
            IsLodEvolution = 1,
            Keyframe = new ResourceSimpleList64<ParticleKeyframePropValue> { data_items = frames },
        });
        prop.EvolvedKeyframes.data_items = items.ToArray();
        list.EvolvedKeyframeProps.data_items = props.ToArray();
        // Карта свойств — по хешу имени, как её строит CodeWalker из XML.
        list.EvolvedKeyframePropMap.data_items = props
            .Select(entry => new ParticleEvolvedKeyframePropMap { Name = entry.Name, Item = entry })
            .OrderBy(entry => entry.Name.Hash)
            .ToArray();
        return frames.Length;
    }

    private static YptCloneTexture? FindSwap(
        IReadOnlyList<YptCloneTexture>? swaps,
        string? donorParticle,
        string? donorTexture)
    {
        foreach (var swap in swaps ?? [])
        {
            if (swap is null) continue;
            var byParticle = swap.Particles is { Count: > 0 } &&
                swap.Particles.Contains(donorParticle ?? string.Empty, StringComparer.Ordinal);
            var byTexture = !string.IsNullOrEmpty(swap.DonorTexture) &&
                string.Equals(swap.DonorTexture, donorTexture, StringComparison.OrdinalIgnoreCase);
            if (byParticle || byTexture) return swap;
        }
        return null;
    }

    /// <summary>
    /// Текстура клона: метаданные — копия текстуры донора (её привёз двоичный
    /// клон вместе с частицей), пиксели и раскладка — из DDS приложения.
    /// </summary>
    private static Texture SwapTexture(
        ParticleEffectsList list,
        YptCloneTexture swap,
        ParticleShaderVarTexture variable,
        IReadOnlyDictionary<string, byte[]> payloads,
        Dictionary<string, Texture> created)
    {
        if (!CloneName.IsMatch(swap.Texture ?? string.Empty))
            throw new InvalidDataException($"YPT clone texture must live in the astral_ namespace: {swap.Texture}");
        if (!created.TryGetValue(swap.Texture!, out var texture))
        {
            if (!payloads.TryGetValue(swap.Texture!, out var bytes))
                throw new InvalidDataException($"YPT clone texture has no payload: {swap.Texture}");
            var source = CodeWalker.Utils.DDSIO.GetTexture(bytes);
            if (source?.Data?.FullData is not { Length: > 0 })
                throw new InvalidDataException($"DDS could not be decoded: {swap.Texture}");
            var dictionary = list.TextureDictionary!;
            var hash = JenkHash.GenHash(swap.Texture!.ToLowerInvariant());
            if (dictionary.TextureNameHashes!.data_items.Contains(hash))
                throw new InvalidDataException($"YPT already contains texture {swap.Texture}.");
            texture = variable.Texture
                ?? throw new InvalidDataException($"YPT donor particle lost its texture: {swap.Texture}");
            texture.Name = swap.Texture;
            texture.NameHash = hash;
            texture.Width = source.Width;
            texture.Height = source.Height;
            texture.Depth = source.Depth;
            texture.Levels = source.Levels;
            texture.Format = source.Format;
            texture.Stride = source.Stride;
            texture.Data = source.Data;
            dictionary.BuildFromTextureList(dictionary.Textures!.data_items.Append(texture).ToList());
            created[swap.Texture!] = texture;
        }
        variable.Texture = texture;
        variable.TextureName = (string_r)texture.Name;
        variable.TextureNameHash = texture.NameHash;
        return texture;
    }

    private static void ApplyFrames(ParticleRule particle, YptCloneTexture swap, string effect)
    {
        if (swap.FrameMin is int min) particle.TexFrameIDMin = (uint)Math.Max(0, min);
        if (swap.FrameMax is int max) particle.TexFrameIDMax = (uint)Math.Max(0, max);
        if (particle.TexFrameIDMax < particle.TexFrameIDMin)
            throw new InvalidDataException($"YPT clone frames are out of order: {effect}");
        if (swap.LastFrame is null && swap.LoopMode is null && swap.ScaledOverLife is null && swap.Randomised is null) return;
        foreach (var animation in Behaviours(particle).OfType<ParticleBehaviourAnimateTexture>().Distinct())
        {
            if (swap.LastFrame is int last) animation.LastFrameID = last;
            if (swap.LoopMode is int loop) animation.LoopMode = loop;
            if (swap.ScaledOverLife is bool scaled)
                animation.IsScaledOverParticleLife = (byte)(scaled ? 1 : 0);
            if (swap.Randomised is bool randomised)
                animation.IsRandomised = (byte)(randomised ? 1 : 0);
        }
    }

    private sealed record TuneReport(int Recoloured, int Spawn, int Replaced, int Scaled = 0);

    private static TuneReport ApplyTune(
        ParticleEffectRule effect,
        IReadOnlyList<ParticleEventEmitter> kept,
        List<ParticleEmitterRule> emitters,
        List<ParticleRule> particles,
        Dictionary<ParticleRule, ParticleRule> donorParticleOf,
        YptCloneTune? tune,
        string label)
    {
        if (tune is null) return new TuneReport(0, 0, 0, 0);
        var recoloured = 0;
        var spawn = 0;
        var replaced = 0;

        if (tune.MaxDuration is decimal maxDuration)
        {
            var limit = Bounded(maxDuration, 0.05m, 30m, "maxDuration", label);
            effect.DurationMin = Math.Min(effect.DurationMin, limit);
            effect.DurationMax = Math.Min(effect.DurationMax, limit);
        }
        if (tune.CullDist is decimal cullDist)
            effect.DistanceCullingCullDist = Math.Max(
                effect.DistanceCullingCullDist, Bounded(cullDist, 5m, 1000m, "cullDist", label));
        if (tune.CullFade is decimal cullFade)
            effect.DistanceCullingFadeDist = Math.Min(
                effect.DistanceCullingCullDist,
                Math.Max(effect.DistanceCullingFadeDist, Bounded(cullFade, 5m, 1000m, "cullFade", label)));

        if (tune.EffectZoom is decimal effectZoom)
        {
            var value = Bounded(effectZoom, 1m, 1000m, "effectZoom", label);
            var frames = effect.ZoomScalarKFP?.Values?.data_items;
            if (frames is not { Length: > 0 })
                throw new InvalidDataException($"YPT clone {label} has no rule zoom keyframes to set.");
            foreach (var frame in frames)
            {
                if (frame is null) continue;
                var current = frame.KeyframeValue;
                frame.KeyframeValue = new SharpDX.Vector4(value, value, current.Z, current.W);
            }
        }

        if (tune.ZoomScale is decimal zoomScale)
        {
            var factor = Bounded(zoomScale, 0.05m, 8m, "zoomScale", label);
            foreach (var item in kept)
            {
                if (item is null) continue;
                item.ZoomScalarMin *= factor;
                item.ZoomScalarMax *= factor;
            }
        }

        if (tune.OneShot is bool oneShot)
            foreach (var emitter in emitters) emitter.IsOneShot = (byte)(oneShot ? 1 : 0);

        if (tune.OpenAir == true)
            foreach (var particle in particles)
                foreach (var cull in Behaviours(particle).OfType<ParticleBehaviourZCull>().Distinct())
                    if (cull.CullMode == ZCullOverReference && cull.ReferenceSpace == ZCullSpaceWater)
                        cull.CullMode = ZCullUnderReference;

        if (tune.SpawnScale is decimal spawnScale)
        {
            var factor = Bounded(spawnScale, 0.1m, 8m, "spawnScale", label);
            foreach (var emitter in emitters)
                foreach (var prop in emitter.KeyframeProps ?? [])
                    if (prop is not null && prop.Name.Hash == SpawnRateProp)
                        spawn += ScaleXY(prop.Values?.data_items, factor);
            // Эволюции (LOD, угол) подменяют кадры густоты своими: без них
            // «вдвое гуще» действовало бы только вблизи и анфас.
            foreach (var item in kept)
                foreach (var evolved in item?.EvolutionList?.EvolvedKeyframeProps?.data_items ?? [])
                    if (evolved is not null && evolved.Name.Hash == SpawnRateProp)
                        foreach (var frames in evolved.EvolvedKeyframes?.data_items ?? [])
                            spawn += ScaleXY(frames?.Keyframe?.data_items, factor);
        }

        var colour = tune.Colour is { Count: 3 }
            ? tune.Colour.Select(value => Bounded(value, 0m, 4m, "colour", label)).ToArray()
            : null;
        if (tune.Colour is not null && colour is null)
            throw new InvalidDataException($"YPT clone colour must have three channels: {label}");
        var mode = tune.ColourMode ?? "recolour";
        if (!ColourModes.Contains(mode, StringComparer.Ordinal))
            throw new InvalidDataException($"YPT clone colour mode is not supported: {tune.ColourMode}");
        var colour2 = tune.Colour2 is { Count: 3 }
            ? tune.Colour2.Select(value => Bounded(value, 0m, 4m, "colour2", label)).ToArray()
            : null;
        if (tune.Colour2 is not null && colour2 is null)
            throw new InvalidDataException($"YPT clone second colour must have three channels: {label}");
        if (mode == "duo" && (colour is null || colour2 is null))
            throw new InvalidDataException($"YPT clone colour mode duo needs two colours: {label}");
        if (mode == "rainbow" && colour is null)
            throw new InvalidDataException($"YPT clone colour mode rainbow needs a colour: {label}");
        var alpha = tune.AlphaScale is decimal alphaScale
            ? Bounded(alphaScale, 0.05m, 4m, "alphaScale", label)
            : (float?)null;
        if (colour is not null || alpha is not null)
        {
            // Верхние кадры цвета: второй цвет режима «два цвета», иначе тот же.
            var upper = mode == "duo" ? colour2 : colour;
            // Свет от искр и вспышек красится вместе с ними: синяя молния с
            // жёлтым отсветом выдаёт подделку. Радуге свет — белый.
            var lightColour = mode == "rainbow" ? new[] { 1f, 1f, 1f } : colour;
            foreach (var particle in particles)
            {
                foreach (var behaviour in Behaviours(particle).Distinct())
                {
                    if (behaviour is ParticleBehaviourColour paint)
                    {
                        recoloured += mode == "rainbow"
                            ? Rainbow(paint.RGBAMinKFP, 0f, alpha, label) + Rainbow(paint.RGBAMaxKFP, 0.5f, alpha, label)
                            : Repaint(paint.RGBAMinKFP?.Values?.data_items, colour, alpha)
                                + Repaint(paint.RGBAMaxKFP?.Values?.data_items, upper, alpha);
                    }
                    else if (behaviour is ParticleBehaviourLight light && lightColour is not null)
                    {
                        recoloured += Repaint(light.RGBMinKFP?.Values?.data_items, lightColour, null);
                        recoloured += Repaint(light.RGBMaxKFP?.Values?.data_items, lightColour, null);
                        recoloured += Repaint(light.CoronaRGBMinKFP?.Values?.data_items, lightColour, null);
                        recoloured += Repaint(light.CoronaRGBMaxKFP?.Values?.data_items, lightColour, null);
                    }
                }
            }
            // Эволюции цвета (у крови кадры цвета вдали свои) красятся так же:
            // иначе синяя кровь за сорок метров становилась бы красной.
            foreach (var item in kept)
                foreach (var evolved in item?.EvolutionList?.EvolvedKeyframeProps?.data_items ?? [])
                {
                    if (evolved is null || !IsColourProp(evolved.Name)) continue;
                    var isUpper = evolved.Name.Hash == ColourProps[1];
                    foreach (var frames in evolved.EvolvedKeyframes?.data_items ?? [])
                    {
                        if (frames?.Keyframe is null) continue;
                        recoloured += mode == "rainbow"
                            ? RainbowList(frames.Keyframe, isUpper ? 0.5f : 0f, alpha, label)
                            : Repaint(frames.Keyframe.data_items, isUpper ? upper : colour, alpha);
                    }
                }
        }

        /*
         * Цвет по частям — после общего цвета: у названной частицы свой тон,
         * яркость — от кадра, каким он стал. Часть, которой у донора нет, —
         * ошибка заказа, а не молча пропущенное пожелание.
         */
        foreach (var part in tune.PartColours ?? [])
        {
            if (part is null || !DonorName.IsMatch(part.Particle ?? string.Empty))
                throw new InvalidDataException($"YPT clone part colour names no particle: {label}");
            if (part.Colour is not { Count: 3 })
                throw new InvalidDataException($"YPT clone part colour must have three channels: {part.Particle}");
            var tint = part.Colour.Select(value => Bounded(value, 0m, 4m, "part colour", label)).ToArray();
            var found = false;
            foreach (var particle in particles)
            {
                if (!string.Equals(donorParticleOf[particle].Name?.Value, part.Particle, StringComparison.Ordinal)) continue;
                found = true;
                foreach (var behaviour in Behaviours(particle).Distinct())
                {
                    if (behaviour is ParticleBehaviourColour paint)
                    {
                        recoloured += Repaint(paint.RGBAMinKFP?.Values?.data_items, tint, null);
                        recoloured += Repaint(paint.RGBAMaxKFP?.Values?.data_items, tint, null);
                    }
                    else if (behaviour is ParticleBehaviourLight light)
                    {
                        recoloured += Repaint(light.RGBMinKFP?.Values?.data_items, tint, null);
                        recoloured += Repaint(light.RGBMaxKFP?.Values?.data_items, tint, null);
                        recoloured += Repaint(light.CoronaRGBMinKFP?.Values?.data_items, tint, null);
                        recoloured += Repaint(light.CoronaRGBMaxKFP?.Values?.data_items, tint, null);
                    }
                }
            }
            if (!found)
                throw new InvalidDataException($"YPT clone {label} has no part {part.Particle} to colour.");
            foreach (var item in kept)
            {
                if (item?.ParticleRule is null ||
                    !string.Equals(donorParticleOf[item.ParticleRule].Name?.Value, part.Particle, StringComparison.Ordinal))
                    continue;
                foreach (var evolved in item.EvolutionList?.EvolvedKeyframeProps?.data_items ?? [])
                    if (evolved is not null && IsColourProp(evolved.Name))
                        foreach (var frames in evolved.EvolvedKeyframes?.data_items ?? [])
                            recoloured += Repaint(frames?.Keyframe?.data_items, tint, null);
            }
        }

        foreach (var patch in tune.Keyframes ?? [])
        {
            if (patch is null || !PropName.IsMatch(patch.Prop ?? string.Empty))
                throw new InvalidDataException($"YPT clone keyframe property is invalid: {patch?.Prop}");
            if (patch.Values is not { Count: >= 1 and <= MaxKeyframes })
                throw new InvalidDataException($"YPT clone keyframe count is out of range: {patch.Prop}");
            var hash = new ParticleKeyframePropName(patch.Prop!).Hash;
            var targets = new List<ParticleKeyframeProp>();
            if (string.Equals(patch.Scope, "emitter", StringComparison.Ordinal))
            {
                foreach (var item in kept)
                {
                    if (item?.EmitterRule is null) continue;
                    if (patch.Particle is not null &&
                        !string.Equals(donorParticleOf[item.ParticleRule!].Name?.Value, patch.Particle, StringComparison.Ordinal))
                        continue;
                    // Свойства эмиттера — его собственные десять и по четыре у
                    // каждой области (где рождаются частицы, куда летят).
                    var emitter = item.EmitterRule;
                    var owned = (emitter.KeyframeProps ?? []).AsEnumerable();
                    foreach (var domain in new[] { emitter.CreationDomainObj, emitter.TargetDomainObj, emitter.AttractorDomainObj })
                        if (domain is not null)
                            owned = owned.Concat([domain.PositionKFP, domain.RotationKFP, domain.SizeOuterKFP, domain.SizeInnerKFP]);
                    targets.AddRange(owned.Where(prop => prop is not null && prop.Name.Hash == hash));
                }
            }
            else if (string.Equals(patch.Scope, "particle", StringComparison.Ordinal))
            {
                foreach (var particle in particles)
                {
                    if (patch.Particle is not null &&
                        !string.Equals(donorParticleOf[particle].Name?.Value, patch.Particle, StringComparison.Ordinal))
                        continue;
                    foreach (var behaviour in Behaviours(particle).Distinct())
                        targets.AddRange((behaviour.KeyframeProps?.data_items ?? [])
                            .Where(prop => prop is not null && prop.Name.Hash == hash));
                }
            }
            else throw new InvalidDataException($"YPT clone keyframe scope is invalid: {patch.Scope}");
            targets = targets.Distinct().ToList();
            if (targets.Count == 0)
                throw new InvalidDataException(
                    $"YPT clone {label} has no keyframe property {patch.Prop} in scope {patch.Scope}.");
            foreach (var target in targets)
            {
                SetKeyframes(target, patch.Values, label);
                replaced += 1;
            }
        }

        /*
         * Множители идут последними: заменённые выше кадры (картинка-значок
         * задаёт свою скорость и срок жизни) масштабируются так же, как
         * кадры донора. Свойства, которого у эмиттера нет (у всплеска нет
         * области цели), просто нечего умножать — это не ошибка заказа.
         */
        var scaled = 0;
        if (tune.EmissiveScale is decimal emissiveScale)
        {
            var factor = Bounded(emissiveScale, 0.05m, 8m, "emissiveScale", label);
            foreach (var particle in particles)
                foreach (var behaviour in Behaviours(particle).Distinct())
                    if (behaviour is ParticleBehaviourColour paint)
                        scaled += ScaleXY(paint.EmissiveIntensityKFP?.Values?.data_items, factor);
            // Эволюции подменяют кадры свечения своими (у воздушного пакета оно
            // целиком живёт в эволюции): без них множитель не доходил бы до игры.
            foreach (var item in kept)
                foreach (var evolved in item?.EvolutionList?.EvolvedKeyframeProps?.data_items ?? [])
                    if (evolved is not null && evolved.Name.Hash == EmissiveProp)
                        foreach (var frames in evolved.EvolvedKeyframes?.data_items ?? [])
                            scaled += ScaleXY(frames?.Keyframe?.data_items, factor);
        }
        foreach (var scale in tune.Scales ?? [])
        {
            if (scale is null || !ScaleProp.IsMatch(scale.Prop ?? string.Empty))
                throw new InvalidDataException($"YPT clone scale property is invalid: {scale?.Prop}");
            var factor = Bounded(scale.Factor, 0m, 8m, "scale", label);
            var hash = new ParticleKeyframePropName(scale.Prop!).Hash;
            // Проценты по осям (ускорение, гашение, размер, вес матрицы) —
            // три оси, как размеры областей; у скорости, жизни и густоты
            // x и y — это «от» и «до». Гравитация — ось Z ускорения, и
            // множитель по одним X и Y её не трогал вовсе.
            var percent = PercentScalarProps.Contains(hash);
            var axes = percent || scale.Prop!.Contains("Domain:", StringComparison.Ordinal) ? 3 : 2;
            foreach (var emitter in emitters)
            {
                var owned = (emitter.KeyframeProps ?? []).AsEnumerable();
                foreach (var domain in new[] { emitter.CreationDomainObj, emitter.TargetDomainObj, emitter.AttractorDomainObj })
                    if (domain is not null)
                        owned = owned.Concat([domain.PositionKFP, domain.RotationKFP, domain.SizeOuterKFP, domain.SizeInnerKFP]);
                foreach (var prop in owned.Where(prop => prop is not null && prop.Name.Hash == hash).Distinct())
                {
                    // Пустое процентное свойство игра читает как штатные 100 %
                    // (у 78 из 93 эмиттеров ядра ускорение пусто, а падают их
                    // частицы как положено): множитель ложится одним кадром.
                    if (percent && prop.Values?.data_items is not { Length: > 0 })
                    {
                        var value = 100f * factor;
                        SetKeyframes(prop, [[0m, (decimal)value, (decimal)value, (decimal)value, 100m]], label);
                        scaled += 1;
                        continue;
                    }
                    scaled += ScaleAxes(prop.Values?.data_items, factor, axes);
                }
            }
            // Эволюции событий подменяют кадры своими — как у густоты.
            foreach (var item in kept)
                foreach (var evolved in item?.EvolutionList?.EvolvedKeyframeProps?.data_items ?? [])
                    if (evolved is not null && evolved.Name.Hash == hash)
                        foreach (var frames in evolved.EvolvedKeyframes?.data_items ?? [])
                            scaled += ScaleAxes(frames?.Keyframe?.data_items, factor, axes);
        }
        /*
         * Прицел — последним, поверх всего: он вращает вектор, который к этому
         * моменту уже получил свой множитель дальности. Эмиттер без области
         * цели (у всплеска её нет) просто нечего вращать — это не ошибка
         * заказа, а его устройство.
         */
        var aimed = 0;
        if (tune.Aim is { } aim)
        {
            var yaw = (double)Bounded(aim.Yaw, -180m, 180m, "aim yaw", label);
            var pitch = (double)Bounded(aim.Pitch, -90m, 90m, "aim pitch", label);
            foreach (var emitter in emitters)
                aimed += AimDomain(emitter.TargetDomainObj?.PositionKFP?.Values?.data_items, yaw, pitch);
        }
        return new TuneReport(recoloured, spawn, replaced, scaled + aimed);
    }

    private static readonly uint[] ColourProps =
    [
        new ParticleKeyframePropName("ptxu_Colour:m_rgbaMinKFP").Hash,
        new ParticleKeyframePropName("ptxu_Colour:m_rgbaMaxKFP").Hash,
    ];

    private static bool IsColourProp(ParticleKeyframePropName name) => ColourProps.Contains(name.Hash);

    /// <summary>Радуга по кадрам свойства: <see cref="RainbowList"/> для его списка значений.</summary>
    private static int Rainbow(ParticleKeyframeProp? prop, float offset, float? alpha, string label)
    {
        if (prop?.Values is null) return 0;
        return RainbowList(prop.Values, offset, alpha, label);
    }

    /*
     * Радуга: кадры цвета пересобираются заново. Тон бежит по кругу за жизнь
     * частицы (с семью ступенями хватает, чтобы переход был плавным, а не
     * мигал), яркость и прозрачность берутся у донора в тот же миг жизни —
     * так брызги гаснут, когда гасли, и ярчат, где ярчали. Верхние кадры
     * сдвинуты на полкруга: каждая частица начинает со своего тона, и облако
     * пёстрое, а не одноцветное.
     */
    private static int RainbowList(ResourceSimpleList64<ParticleKeyframePropValue> list, float offset, float? alpha, string label)
    {
        var source = (list.data_items ?? []).Where(frame => frame is not null).ToArray();
        if (source.Length == 0) return 0;
        var frames = new (float Time, SharpDX.Vector4 Value)[RainbowSteps];
        for (var step = 0; step < RainbowSteps; step += 1)
        {
            var time = (float)step / (RainbowSteps - 1);
            var sampled = Sample(source, time);
            var intensity = Math.Max(sampled.X, Math.Max(sampled.Y, sampled.Z));
            var opacity = alpha is float scale ? Math.Clamp(sampled.W * scale, 0f, 1f) : sampled.W;
            var (red, green, blue) = Hue((time + offset) % 1f, intensity);
            frames[step] = (time, new SharpDX.Vector4(red, green, blue, opacity));
        }
        list.data_items = BuildFrames(frames, label);
        return frames.Length;
    }

    /// <summary>Значение кадров в момент <paramref name="time"/> — линейно между соседями.</summary>
    private static SharpDX.Vector4 Sample(ParticleKeyframePropValue[] frames, float time)
    {
        var ordered = frames.OrderBy(frame => frame.KeyframeTime.X).ToArray();
        if (time <= ordered[0].KeyframeTime.X) return ordered[0].KeyframeValue;
        for (var index = 1; index < ordered.Length; index += 1)
        {
            var next = ordered[index];
            if (time > next.KeyframeTime.X) continue;
            var previous = ordered[index - 1];
            var span = next.KeyframeTime.X - previous.KeyframeTime.X;
            var amount = span > 1e-6f ? (time - previous.KeyframeTime.X) / span : 1f;
            return SharpDX.Vector4.Lerp(previous.KeyframeValue, next.KeyframeValue, amount);
        }
        return ordered[^1].KeyframeValue;
    }

    /// <summary>Чистый тон радуги с заданной яркостью (насыщенность полная).</summary>
    private static (float, float, float) Hue(float hue, float value)
    {
        var sector = hue * 6f;
        var index = (int)Math.Floor(sector) % 6;
        var fraction = sector - (float)Math.Floor(sector);
        var rising = value * fraction;
        var falling = value * (1f - fraction);
        return index switch
        {
            0 => (value, rising, 0f),
            1 => (falling, value, 0f),
            2 => (0f, value, rising),
            3 => (0f, falling, value),
            4 => (rising, 0f, value),
            _ => (value, 0f, falling),
        };
    }

    /// <summary>Кадры из пар «время — значение» с обратными длинами отрезков, как их хранит игра.</summary>
    private static ParticleKeyframePropValue[] BuildFrames((float Time, SharpDX.Vector4 Value)[] frames, string label)
    {
        var result = new ParticleKeyframePropValue[frames.Length];
        var previous = -1f;
        for (var index = 0; index < frames.Length; index += 1)
        {
            var (time, value) = frames[index];
            if (time < 0f || time > 1f || time <= previous)
                throw new InvalidDataException($"YPT clone keyframe times must rise within 0…1: {label}");
            result[index] = new ParticleKeyframePropValue
            {
                KeyframeTime = new SharpDX.Vector4(time, index == 0 ? 0f : 1f / (time - previous), 0f, 0f),
                KeyframeValue = value,
            };
            previous = time;
        }
        return result;
    }

    /// <summary>
    /// Поворот точки прицела: отклонить на <paramref name="pitch"/> от её
    /// собственной оси и провернуть отклонение на <paramref name="yaw"/>
    /// вокруг неё. Длина вектора не меняется — расстояние задаёт множитель,
    /// а не прицел, и у разных эмиттеров оно разное.
    /// </summary>
    private static int AimDomain(ParticleKeyframePropValue[]? frames, double yaw, double pitch)
    {
        var count = 0;
        var yawRad = yaw * Math.PI / 180.0;
        var pitchRad = pitch * Math.PI / 180.0;
        foreach (var frame in frames ?? [])
        {
            if (frame is null) continue;
            var value = frame.KeyframeValue;
            var axis = new SharpDX.Vector3(value.X, value.Y, value.Z);
            var length = axis.Length();
            // Вектор нулевой длины оси не задаёт: поворачивать нечего, и
            // выдумывать ему направление — значит выдумывать эффект.
            if (length < 1e-5f) continue;
            axis /= length;
            // Любая ось, не совпадающая с исходной, годится в первую
            // поперечную: берётся дальняя от неё, иначе на полюсе получился бы
            // нулевой вектор.
            var seed = Math.Abs(axis.Z) < 0.9f
                ? new SharpDX.Vector3(0f, 0f, 1f)
                : new SharpDX.Vector3(1f, 0f, 0f);
            var right = SharpDX.Vector3.Cross(axis, seed);
            right.Normalize();
            var up = SharpDX.Vector3.Cross(axis, right);
            var tilt = (float)Math.Sin(pitchRad);
            var forward = (float)Math.Cos(pitchRad);
            var side = (float)Math.Cos(yawRad) * tilt;
            var lift = (float)Math.Sin(yawRad) * tilt;
            var turned = (axis * forward + right * side + up * lift) * length;
            frame.KeyframeValue = new SharpDX.Vector4(turned.X, turned.Y, turned.Z, value.W);
            count += 1;
        }
        return count;
    }

    private static float Bounded(decimal value, decimal min, decimal max, string label, string effect)
    {
        if (value < min || value > max)
            throw new InvalidDataException($"YPT clone {label} is out of range for {effect}: {value}");
        return (float)value;
    }

    private static int ScaleAxes(ParticleKeyframePropValue[]? frames, float factor, int axes)
    {
        if (axes == 2) return ScaleXY(frames, factor);
        var count = 0;
        foreach (var frame in frames ?? [])
        {
            if (frame is null) continue;
            var value = frame.KeyframeValue;
            frame.KeyframeValue = new SharpDX.Vector4(value.X * factor, value.Y * factor, value.Z * factor, value.W);
            count += 1;
        }
        return count;
    }

    private static int ScaleXY(ParticleKeyframePropValue[]? frames, float factor)
    {
        var count = 0;
        foreach (var frame in frames ?? [])
        {
            if (frame is null) continue;
            var value = frame.KeyframeValue;
            frame.KeyframeValue = new SharpDX.Vector4(value.X * factor, value.Y * factor, value.Z, value.W);
            count += 1;
        }
        return count;
    }

    /*
     * Перекраска кадра: тон и насыщенность — от заказанного цвета, яркость —
     * от самого кадра (старший канал). У крови кадры — (0,15…0,6; 0; 0): вся
     * игра света и тени брызг живёт в красном канале, и плоская заливка одним
     * цветом убила бы её.
     */
    private static int Repaint(ParticleKeyframePropValue[]? frames, float[]? colour, float? alpha)
    {
        var count = 0;
        foreach (var frame in frames ?? [])
        {
            if (frame is null) continue;
            var value = frame.KeyframeValue;
            var red = value.X;
            var green = value.Y;
            var blue = value.Z;
            if (colour is not null)
            {
                var intensity = Math.Max(value.X, Math.Max(value.Y, value.Z));
                red = Math.Clamp(colour[0] * intensity, 0f, 1f);
                green = Math.Clamp(colour[1] * intensity, 0f, 1f);
                blue = Math.Clamp(colour[2] * intensity, 0f, 1f);
            }
            var opacity = alpha is float scale ? Math.Clamp(value.W * scale, 0f, 1f) : value.W;
            frame.KeyframeValue = new SharpDX.Vector4(red, green, blue, opacity);
            count += 1;
        }
        return count;
    }

    /*
     * Кадр свойства — время и значение. Во втором числе времени игра хранит
     * обратную длину отрезка до предыдущего кадра (1 / (t[i] − t[i−1])), чтобы
     * не делить на каждом кадре частицы; у первого кадра там ноль. Проверено
     * на живом ядре: 0,132137 → 7,567903 = 1 / 0,132137.
     */
    internal static void SetKeyframes(
        ParticleKeyframeProp target,
        IReadOnlyList<IReadOnlyList<decimal>> values,
        string effect)
    {
        var frames = new ParticleKeyframePropValue[values.Count];
        var previous = -1f;
        for (var index = 0; index < values.Count; index += 1)
        {
            var row = values[index];
            if (row is not { Count: 5 })
                throw new InvalidDataException($"YPT clone keyframe must be [time, x, y, z, w]: {effect}");
            var time = (float)row[0];
            if (time < 0f || time > 1f || time <= previous)
                throw new InvalidDataException($"YPT clone keyframe times must rise within 0…1: {effect}");
            if (index == 0 && time != 0f)
                throw new InvalidDataException($"YPT clone keyframes must start at zero: {effect}");
            foreach (var number in row)
                if (number < -100000m || number > 100000m)
                    throw new InvalidDataException($"YPT clone keyframe value is out of range: {effect}");
            frames[index] = new ParticleKeyframePropValue
            {
                KeyframeTime = new SharpDX.Vector4(time, index == 0 ? 0f : 1f / (time - previous), 0f, 0f),
                KeyframeValue = new SharpDX.Vector4((float)row[1], (float)row[2], (float)row[3], (float)row[4]),
            };
            previous = time;
        }
        target.Values ??= new ResourceSimpleList64<ParticleKeyframePropValue>();
        target.Values.data_items = frames;
    }

    internal static IEnumerable<ParticleBehaviour> Behaviours(ParticleRule rule) =>
        new[]
        {
            rule.AllBehaviours,
            rule.InitBehaviours,
            rule.UpdateBehaviours,
            rule.UpdateFinalizeBehaviours,
            rule.DrawBehaviours,
        }
        .SelectMany(list => list?.data_items ?? [])
        .Where(item => item is not null);

    /// <summary>
    /// Клоны после сохранения: свой набор правил под своими именами, верные
    /// счётчики ссылок и заказанные текстуры у заказанных частиц.
    /// </summary>
    internal static void VerifyClones(YptFile reloaded, IReadOnlyList<YptClonedEffect> cloned)
    {
        var list = reloaded.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var effects = list.EffectRuleDictionary!.EffectRules!.data_items;
        var textures = list.TextureDictionary!.Textures!.data_items;
        foreach (var report in cloned)
        {
            var effect = effects.SingleOrDefault(item => item.Name?.Value == report.Effect)
                ?? throw new InvalidDataException($"YPT clone effect rule is missing: {report.Effect}");
            var events = (effect.EventEmitters?.data_items ?? []).Take(effect.EventEmittersCount).ToArray();
            if (effect.RefCount != 1 || events.Length != report.Emitters || events.Any(item => item is null))
                throw new InvalidDataException($"YPT clone did not keep its emitters: {report.Effect}");
            foreach (var item in events)
            {
                var emitter = item.EmitterRule?.Name?.Value;
                var particle = item.ParticleRule?.Name?.Value;
                if (emitter is null || particle is null ||
                    !report.EmitterRules.Contains(emitter) || !report.ParticleRules.Contains(particle) ||
                    item.EmitterRuleName?.Value != emitter || item.ParticleRuleName?.Value != particle)
                    throw new InvalidDataException($"YPT clone emitter does not point at its own rules: {report.Effect}");
                var emitterUsers = events.Count(other => ReferenceEquals(other.EmitterRule, item.EmitterRule));
                var particleUsers = events.Count(other => ReferenceEquals(other.ParticleRule, item.ParticleRule));
                if (item.EmitterRule!.RefCount != 1 + emitterUsers || item.ParticleRule!.RefCount != 1 + particleUsers)
                    throw new InvalidDataException($"YPT clone reference counts are inconsistent: {report.Effect}");
            }
            foreach (var name in report.Textures)
            {
                var texture = textures.SingleOrDefault(item => string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase))
                    ?? throw new InvalidDataException($"YPT clone texture is missing: {name}");
                var drawn = events.Any(item => (item.ParticleRule?.ShaderVars?.data_items ?? [])
                    .OfType<ParticleShaderVarTexture>()
                    .Any(variable => ReferenceEquals(variable.Texture, texture)));
                if (!drawn)
                    throw new InvalidDataException($"YPT clone does not draw its texture: {report.Effect}/{name}");
            }
            VerifyEvolutions(effect, events, report.Effect);
        }
    }

    /*
     * Правило — как у Rockstar: событий не больше семи, у события список
     * эволюций пуст или равен списку правила, номера кадров — внутри списка,
     * эволюций не больше пяти. Клон, который нарушает это, в игру не уезжает:
     * на попадании он ронял её.
     */
    internal static void VerifyEvolutions(ParticleEffectRule effect, IReadOnlyList<ParticleEventEmitter> events, string label)
    {
        if (EvolutionProblem(effect, events) is { } problem)
            throw new InvalidDataException($"YPT clone {label} {problem}");
    }

    /// <summary>
    /// Чем правило расходится с данными Rockstar (события, эволюции), или
    /// <c>null</c>. Опись ядра спрашивает это у клонов, уже стоящих в игре:
    /// собранные до исправления роняли её на попадании, и человеку надо
    /// сказать, что их пора пересобрать.
    /// </summary>
    internal static string? EvolutionProblem(ParticleEffectRule effect, IReadOnlyList<ParticleEventEmitter?> events)
    {
        static string[] Names(ParticleEvolutionList? list) =>
            (list?.Evolutions?.data_items ?? []).Select(item => item?.Name?.Value ?? string.Empty).ToArray();
        static bool FramesInside(ParticleEvolutionList? list, int count) =>
            (list?.EvolvedKeyframeProps?.data_items ?? []).All(prop =>
                (prop?.EvolvedKeyframes?.data_items ?? []).All(entry =>
                    entry is null || (entry.EvolutionID >= 0 && entry.EvolutionID < count)));
        if (events.Count > MaxEventEmitters)
            return $"carries {events.Count} emitters; GTA plays at most {MaxEventEmitters} per effect rule.";
        var rule = Names(effect.EvolutionList);
        if (rule.Length > MaxEvolutions)
            return $"carries {rule.Length} evolutions; game rules carry at most {MaxEvolutions}.";
        if (!FramesInside(effect.EvolutionList, rule.Length))
            return "has evolution frames outside its evolution list.";
        foreach (var item in events)
        {
            var own = Names(item?.EvolutionList);
            if (own.Length > 0 && !own.SequenceEqual(rule, StringComparer.OrdinalIgnoreCase))
                return $"has an emitter whose evolutions ({string.Join(", ", own)}) differ from its rule ({string.Join(", ", rule)}).";
            if (!FramesInside(item?.EvolutionList, own.Length))
                return "has evolution frames outside its evolution list.";
        }
        return null;
    }

    /*
     * Самопроверка клона под штатным именем на словарях без файла: имена
     * меняются местами, словарь остаётся упорядоченным по хешу, снятие
     * семейства возвращает штатное правило тем же объектом, чужой хеш и имя,
     * которому нельзя уступить, — отказ. Настоящее ядро игрока проверяет
     * `scripts/probe-clone-in-place.mjs`.
     */
    internal static bool SelfTestSwap()
    {
        static ParticleEffectRule Rule(string name) =>
            new() { Name = (string_r)name, NameHash = JenkHash.GenHash(name), RefCount = 1 };
        static YptFile Core(params ParticleEffectRule[] rules)
        {
            var sorted = rules.OrderBy(item => item.NameHash.Hash).ToArray();
            return new YptFile
            {
                PtfxList = new ParticleEffectsList
                {
                    Name = (string_r)"core",
                    EffectRuleDictionary = new ParticleEffectRuleDictionary
                    {
                        EffectRuleNameHashes = new ResourceSimpleList64_s<MetaHash>
                        {
                            data_items = sorted.Select(item => (MetaHash)item.NameHash.Hash).ToArray(),
                        },
                        EffectRules = new ResourcePointerList64<ParticleEffectRule> { data_items = sorted },
                    },
                    EmitterRuleDictionary = new ParticleEmitterRuleDictionary
                    {
                        EmitterRuleNameHashes = new ResourceSimpleList64_s<MetaHash> { data_items = [] },
                        EmitterRules = new ResourcePointerList64<ParticleEmitterRule> { data_items = [] },
                    },
                    ParticleRuleDictionary = new ParticleRuleDictionary
                    {
                        ParticleRuleNameHashes = new ResourceSimpleList64_s<MetaHash> { data_items = [] },
                        ParticleRules = new ResourcePointerList64<ParticleRule> { data_items = [] },
                    },
                    TextureDictionary = new TextureDictionary
                    {
                        TextureNameHashes = new ResourceSimpleList64_uint { data_items = [] },
                        Textures = new ResourcePointerList64<Texture> { data_items = [] },
                    },
                },
            };
        }
        static bool Refused(Action action)
        {
            try { action(); return false; }
            catch (InvalidDataException) { return true; }
        }

        const string Stock = "veh_slipstream";
        const string Hidden = StockPrefix + Stock;
        var stock = Rule(Stock);
        var custom = Rule("astral_wheel_slipstream");
        var bystander = Rule("veh_backfire");
        var ypt = Core(stock, custom, bystander);
        var list = ypt.PtfxList!;
        var report = new YptClonedEffect("astral_wheel_slipstream", Stock, 1, 0, [], [], [], 0, 0, 0);

        var swapped = SwapIn(list, report, Stock);
        var dictionary = list.EffectRuleDictionary!;
        YptSlotReservations.AssertDictionaries(list);
        var swappedOk = swapped.Effect == Stock && swapped.Replaced == Hidden &&
            ReferenceEquals(FindEffect(dictionary, Stock), custom) &&
            ReferenceEquals(FindEffect(dictionary, Hidden), stock) &&
            FindEffect(dictionary, "astral_wheel_slipstream") is null &&
            ReferenceEquals(FindEffect(dictionary, "veh_backfire"), bystander) &&
            dictionary.EffectRules!.data_items.Length == 3 &&
            ExpectedKeys([swapped]).Contains($"effect:{Hidden}");

        var restored = new HashSet<string>(StringComparer.Ordinal);
        var purged = Purge(ypt, ["astral_wheel_"], restored);
        YptSlotReservations.AssertDictionaries(list);
        var restoredOk = ReferenceEquals(FindEffect(dictionary, Stock), stock) &&
            FindEffect(dictionary, Hidden) is null &&
            ReferenceEquals(FindEffect(dictionary, "veh_backfire"), bystander) &&
            dictionary.EffectRules!.data_items.Length == 2 &&
            restored.SetEquals([$"effect:{Stock}"]) &&
            purged.Contains($"effect:{Hidden}") && purged.Contains($"effect:{Stock}") &&
            stock.Name?.Value == Stock;

        // Нечему уступать, не из списка, чужой хеш, уже уступлено — отказ.
        var missing = Refused(() => SwapIn(Core(Rule("astral_wheel_slipstream")).PtfxList!, report, Stock));
        var unlisted = Refused(() => Apply(
            Core(Rule("veh_backfire"), Rule("astral_wheel_x")),
            [new YptEffectClone("astral_wheel_x", "veh_backfire", Replaces: "veh_backfire")],
            new Dictionary<string, byte[]>()));
        var foreign = Core(Rule(Stock), Rule("astral_wheel_slipstream"));
        foreign.PtfxList!.EffectRuleDictionary!.EffectRuleNameHashes!.data_items[
            Array.FindIndex(foreign.PtfxList.EffectRuleDictionary.EffectRules!.data_items, item => item.Name?.Value == Stock)] =
            (MetaHash)(JenkHash.GenHash(Stock) ^ 0x5A5A5A5Au);
        var foreignRefused = Refused(() => SwapIn(foreign.PtfxList, report, Stock));
        var twice = Core(Rule(Stock), Rule("astral_wheel_slipstream"), Rule(Hidden));
        var twiceRefused = Refused(() => SwapIn(twice.PtfxList!, report, Stock));
        return swappedOk && restoredOk && missing && unlisted && foreignRefused && twiceRefused;
    }
}
