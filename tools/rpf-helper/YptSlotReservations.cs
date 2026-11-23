using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

/*
 * Зарезервированные слоты Astral в ядре эффектов самого игрока.
 *
 * Мастерская «Попадания и трейсеры» пишет след и попадание в правила
 * astral_tracer_NNN / astral_impact_NNN. Раньше их приносил только
 * подписанный пакет astral-ptfx-core-base, которого на обычном компьютере
 * нет, — и редактор отказывал ещё до записи в игру. Здесь слот строится из
 * ядра, которое уже лежит у игрока, в том же проходе, что патч текстур.
 *
 * Почему в памяти, а не через XML. CodeWalker пишет в XML не всё, что читает
 * из ресурса (VFT, UIData, служебные поля), и пересборка ядра из XML
 * переписала бы девятьсот с лишним штатных правил. Здесь штатные объекты не
 * трогаются вовсе: копия донора делается двоичной — донор собирается во
 * временный ресурс и читается обратно тем же кодом, что читает всё ядро, —
 * поэтому у копии каждое поле донора, а у ванильных правил не меняется ни
 * байта. Это та же операция загрузки и сохранения, на которую уже опирается
 * патч текстур, плюс новые объекты.
 *
 * Правила копии, проверенные на живом ядре Legacy:
 *  • у эмиттеров и частиц RefCount = 1 + число событий, которые на них
 *    ссылаются (1993 из 1993 и 1736 из 1736), у правил эффекта — 1. Слот
 *    получает собственные эмиттер и частицы, а не делит штатные: иначе
 *    пришлось бы править счётчики ванильных правил;
 *  • у копии остаётся один эмиттер — тот, чьи частицы рисуют текстуру
 *    слота. Остальные эмиттеры донора рисовали бы штатную кровь поверх
 *    облика, который человек собрал в редакторе;
 *  • сетку кадров игра берёт не из ядра, а из ptxclipregions.dat, поэтому
 *    кадры частиц переводятся на сетку текстуры слота, а таблицу правит
 *    вызывающая сторона;
 *  • словари ядра отсортированы по хешу имени — вставка сохраняет порядок.
 *
 * После сохранения ядро перечитывается: штатные правила и текстуры
 * сверяются по отпечаткам с исходником, новых записей ровно столько, сколько
 * заказано, и каждая ссылка графа указывает внутрь словарей.
 */

/// <summary>Сетка кадров текстуры слота, как в ptxclipregions.dat.</summary>
internal sealed record YptSlotSheet(int Columns, int Rows);

/// <summary>
/// Кадры частиц слота: начальный кадр и, если у донора есть анимация
/// листа, последний кадр, режим повтора и растяжение на жизнь частицы.
/// </summary>
internal sealed record YptSlotFrames(
    int Min,
    int Max,
    int? Last = null,
    int? LoopMode = null,
    bool? ScaledOverLife = null);

/// <summary>
/// Заказ слота: имя правила (эффект, эмиттер и частицы носят одно имя),
/// имя текстуры и донор из ядра игрока.
/// </summary>
internal sealed record YptSlotReservation(
    string Effect,
    string Texture,
    string DonorEffect,
    string DonorParticle,
    YptSlotSheet Sheet,
    YptSlotFrames Frames);

internal sealed record YptReservedSlot(
    string Effect,
    string Texture,
    string DonorEffect,
    string DonorEmitter,
    string DonorParticle,
    string DonorTexture,
    int DroppedEmitters,
    int Width,
    int Height,
    int Levels,
    string Format,
    int Columns,
    int Rows,
    uint FrameMin,
    uint FrameMax,
    int? LastFrame);

/// <summary>
/// Чужая запись словаря ядра: хеш не от строчного имени. <c>Form</c> —
/// <c>case-sensitive</c> (хеш от имени как есть, так собирает CodeWalker из
/// XML) или <c>foreign</c> (ни от одного написания имени).
/// </summary>
internal sealed record YptNameHashRemark(string Dictionary, int Index, string Name, string Hash, string Form);

internal static class YptSlotReservations
{
    private const string AstralPrefix = "astral_";
    private const int MaxReservations = 32;
    private const int MaxSheetEdge = 16;
    private static readonly Regex SlotName =
        new("^astral_[a-z0-9_]{1,56}$", RegexOptions.CultureInvariant);
    private static readonly Regex DonorName =
        new("^[a-z0-9_]{1,64}$", RegexOptions.CultureInvariant);
    private static readonly uint DiffuseVariable = JenkHash.GenHash("diffusetex2");

    public static IReadOnlyList<YptReservedSlot> Apply(
        YptFile ypt,
        IReadOnlyList<YptSlotReservation> reservations,
        IReadOnlyDictionary<string, byte[]> payloads)
    {
        // Enhanced хранит текстуры иначе, а редактор эффектов — только Legacy:
        // молча собрать ресурс не того поколения хуже честного отказа.
        if (RpfManager.IsGen9)
            throw new NotSupportedException("Astral slot reservation supports Legacy cores only.");
        if (reservations.Count is < 1 or > MaxReservations)
            throw new InvalidDataException(
                $"YPT slot reservation count must be between 1 and {MaxReservations}.");
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        AssertDictionaries(list);
        ValidateRequests(list, reservations);
        var reserved = new List<YptReservedSlot>();
        foreach (var reservation in reservations)
            reserved.Add(Reserve(list, reservation, payloads));
        return reserved;
    }

    private static void ValidateRequests(
        ParticleEffectsList list,
        IReadOnlyList<YptSlotReservation> reservations)
    {
        var effects = Names(list.EffectRuleDictionary!.EffectRules!.data_items.Select(item => item?.Name?.Value));
        var emitters = Names(list.EmitterRuleDictionary!.EmitterRules!.data_items.Select(item => item?.Name?.Value));
        var particles = Names(list.ParticleRuleDictionary!.ParticleRules!.data_items.Select(item => item?.Name?.Value));
        var textures = Names(list.TextureDictionary!.Textures!.data_items.Select(item => item?.Name));
        var slots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var slotTextures = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var reservation in reservations)
        {
            if (reservation is null || reservation.Sheet is null || reservation.Frames is null)
                throw new InvalidDataException("YPT slot reservation is incomplete.");
            if (!SlotName.IsMatch(reservation.Effect ?? string.Empty) ||
                !SlotName.IsMatch(reservation.Texture ?? string.Empty))
                throw new InvalidDataException(
                    $"YPT slot names must live in the astral_ namespace: {reservation.Effect}/{reservation.Texture}");
            if (!DonorName.IsMatch(reservation.DonorEffect ?? string.Empty) ||
                !DonorName.IsMatch(reservation.DonorParticle ?? string.Empty))
                throw new InvalidDataException($"YPT slot donor names are invalid: {reservation.Effect}");
            if (!slots.Add(reservation.Effect!) || !slotTextures.Add(reservation.Texture!))
                throw new InvalidDataException($"YPT slot is reserved twice: {reservation.Effect}");
            if (effects.Contains(reservation.Effect!) || emitters.Contains(reservation.Effect!) ||
                particles.Contains(reservation.Effect!))
                throw new InvalidDataException($"YPT already contains rule {reservation.Effect}.");
            if (textures.Contains(reservation.Texture!))
                throw new InvalidDataException($"YPT already contains texture {reservation.Texture}.");
            var sheet = reservation.Sheet;
            if (sheet.Columns is < 1 or > MaxSheetEdge || sheet.Rows is < 1 or > MaxSheetEdge)
                throw new InvalidDataException($"YPT slot sheet is out of range: {reservation.Effect}");
            var frames = sheet.Columns * sheet.Rows;
            var wanted = reservation.Frames;
            if (wanted.Min < 0 || wanted.Max < wanted.Min || wanted.Max >= frames ||
                wanted.Last is < 0 || wanted.Last >= frames || wanted.LoopMode is < 0 or > 8)
                throw new InvalidDataException($"YPT slot frames do not fit its sheet: {reservation.Effect}");
        }
    }

    private static HashSet<string> Names(IEnumerable<string?> names) =>
        names.Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static YptReservedSlot Reserve(
        ParticleEffectsList list,
        YptSlotReservation reservation,
        IReadOnlyDictionary<string, byte[]> payloads)
    {
        var effects = list.EffectRuleDictionary!.EffectRules!.data_items;
        var donors = effects
            .Where(item => string.Equals(item?.Name?.Value, reservation.DonorEffect, StringComparison.Ordinal))
            .ToArray();
        if (donors.Length != 1)
            throw new InvalidDataException(donors.Length == 0
                ? $"YPT donor effect rule does not exist: {reservation.DonorEffect}"
                : $"YPT donor effect rule is ambiguous: {reservation.DonorEffect}");
        var donor = donors[0];
        var donorEvents = donor.EventEmitters?.data_items ?? [];
        var primaryIndex = -1;
        for (var index = 0; index < Math.Min(donor.EventEmittersCount, donorEvents.Length); index += 1)
        {
            var candidate = donorEvents[index];
            if (candidate?.ParticleRule is null || candidate.EmitterRule is null) continue;
            if (!string.Equals(candidate.ParticleRuleName?.Value, reservation.DonorParticle, StringComparison.Ordinal))
                continue;
            primaryIndex = index;
            break;
        }
        if (primaryIndex < 0)
            throw new InvalidDataException(
                $"YPT donor effect {reservation.DonorEffect} does not emit particle rule {reservation.DonorParticle}.");
        var donorEvent = donorEvents[primaryIndex];
        var donorParticle = donorEvent.ParticleRule;

        var copy = CopyEffect(donor);
        var copyEvents = copy.EventEmitters?.data_items
            ?? throw new InvalidDataException($"YPT donor copy lost its emitters: {reservation.DonorEffect}");
        if (copyEvents.Length != donorEvents.Length || copy.EventEmittersCount != donor.EventEmittersCount)
            throw new InvalidDataException($"YPT donor copy differs from its donor: {reservation.DonorEffect}");
        var primary = copyEvents[primaryIndex]
            ?? throw new InvalidDataException($"YPT donor copy lost its emitter: {reservation.DonorEffect}");
        var emitter = primary.EmitterRule
            ?? throw new InvalidDataException($"YPT donor copy lost its emitter rule: {reservation.DonorEffect}");
        var particle = primary.ParticleRule
            ?? throw new InvalidDataException($"YPT donor copy lost its particle rule: {reservation.DonorEffect}");

        // Один эмиттер на слот: он первый и единственный. Ёмкость массива
        // событий у правила эффекта всегда 32 — она сохраняется.
        var kept = new ParticleEventEmitter[copyEvents.Length];
        kept[0] = primary;
        primary.Index = 0;
        var dropped = Math.Max(0, copy.EventEmittersCount - 1);
        copy.EventEmitters!.data_items = kept;
        copy.EventEmittersCount = 1;

        var hash = JenkHash.GenHash(reservation.Effect);
        copy.Name = (string_r)reservation.Effect;
        copy.NameHash = hash;
        copy.RefCount = 1;
        emitter.Name = (string_r)reservation.Effect;
        emitter.NameHash = hash;
        emitter.RefCount = 2;
        particle.Name = (string_r)reservation.Effect;
        particle.NameHash = hash;
        particle.RefCount = 2;
        primary.EmitterRuleName = (string_r)reservation.Effect;
        primary.ParticleRuleName = (string_r)reservation.Effect;

        // Внешние ссылки копии ведут в штатные объекты ядра: эффекты, которые
        // частица рождает, и модели. При копировании они были отцеплены, чтобы
        // не тащить за собой чужие графы.
        if (particle.EffectSpawnerAtRatio is { } atRatio)
            atRatio.EffectRule = donorParticle.EffectSpawnerAtRatio?.EffectRule;
        if (particle.EffectSpawnerOnCollision is { } onCollision)
            onCollision.EffectRule = donorParticle.EffectSpawnerOnCollision?.EffectRule;
        var copyDrawables = particle.Drawables?.data_items ?? [];
        var donorDrawables = donorParticle.Drawables?.data_items ?? [];
        if (copyDrawables.Length != donorDrawables.Length)
            throw new InvalidDataException($"YPT donor copy changed its drawables: {reservation.DonorParticle}");
        for (var index = 0; index < copyDrawables.Length; index += 1)
            if (copyDrawables[index] is { } drawable)
                drawable.Drawable = donorDrawables[index]?.Drawable;

        var copyVariables = particle.ShaderVars?.data_items ?? [];
        var donorVariables = donorParticle.ShaderVars?.data_items ?? [];
        if (copyVariables.Length != donorVariables.Length)
            throw new InvalidDataException($"YPT donor copy changed its shader variables: {reservation.DonorParticle}");
        ParticleShaderVarTexture? diffuse = null;
        var donorTexture = string.Empty;
        for (var index = 0; index < copyVariables.Length; index += 1)
        {
            if (copyVariables[index] is not ParticleShaderVarTexture variable) continue;
            var original = donorVariables[index] as ParticleShaderVarTexture
                ?? throw new InvalidDataException($"YPT donor copy changed its shader variables: {reservation.DonorParticle}");
            if (variable.Name.Hash == DiffuseVariable && variable.Texture is not null)
            {
                if (diffuse is not null)
                    throw new InvalidDataException($"YPT donor particle has several diffuse textures: {reservation.DonorParticle}");
                diffuse = variable;
                donorTexture = original.TextureName?.Value ?? original.Texture?.Name ?? string.Empty;
                continue;
            }
            variable.Texture = original.Texture;
        }
        if (diffuse?.Texture is null)
            throw new InvalidDataException($"YPT donor particle has no diffuse texture: {reservation.DonorParticle}");

        // Текстура слота: метаданные — копия текстуры донора, пиксели и
        // раскладка — из DDS, который собрало приложение.
        if (!payloads.TryGetValue(reservation.Texture, out var bytes))
            throw new InvalidDataException($"YPT slot texture has no payload: {reservation.Texture}");
        var source = CodeWalker.Utils.DDSIO.GetTexture(bytes);
        if (source?.Data?.FullData is not { Length: > 0 })
            throw new InvalidDataException($"DDS could not be decoded: {reservation.Texture}");
        if (source.Width % reservation.Sheet.Columns != 0 || source.Height % reservation.Sheet.Rows != 0)
            throw new InvalidDataException($"YPT slot texture does not divide into its sheet: {reservation.Texture}");
        var texture = diffuse.Texture;
        texture.Name = reservation.Texture;
        texture.NameHash = JenkHash.GenHash(reservation.Texture.ToLowerInvariant());
        texture.Width = source.Width;
        texture.Height = source.Height;
        texture.Depth = source.Depth;
        texture.Levels = source.Levels;
        texture.Format = source.Format;
        texture.Stride = source.Stride;
        texture.Data = source.Data;
        diffuse.TextureName = (string_r)reservation.Texture;
        diffuse.TextureNameHash = texture.NameHash;

        particle.TexFrameIDMin = (uint)reservation.Frames.Min;
        particle.TexFrameIDMax = (uint)reservation.Frames.Max;
        var animations = Behaviours(particle).OfType<ParticleBehaviourAnimateTexture>().Distinct().ToArray();
        var wantsAnimation = reservation.Frames.Last is not null ||
            reservation.Frames.LoopMode is not null ||
            reservation.Frames.ScaledOverLife is not null;
        if (wantsAnimation && animations.Length == 0)
            throw new InvalidDataException($"YPT donor particle does not animate its sheet: {reservation.DonorParticle}");
        foreach (var animation in animations)
        {
            if (reservation.Frames.Last is int last) animation.LastFrameID = last;
            if (reservation.Frames.LoopMode is int loop) animation.LoopMode = loop;
            if (reservation.Frames.ScaledOverLife is bool scaled)
                animation.IsScaledOverParticleLife = (byte)(scaled ? 1 : 0);
            if (animation.LastFrameID < 0 || animation.LastFrameID >= reservation.Sheet.Columns * reservation.Sheet.Rows)
                throw new InvalidDataException($"YPT slot animation runs past its sheet: {reservation.Effect}");
        }

        InsertEffect(list.EffectRuleDictionary!, copy);
        InsertEmitter(list.EmitterRuleDictionary!, emitter);
        InsertParticle(list.ParticleRuleDictionary!, particle);
        var textureDictionary = list.TextureDictionary!;
        if (textureDictionary.TextureNameHashes!.data_items.Contains(texture.NameHash))
            throw new InvalidDataException($"YPT texture name hash is already taken: {reservation.Texture}");
        textureDictionary.BuildFromTextureList(textureDictionary.Textures!.data_items.Append(texture).ToList());

        JenkIndex.Ensure(reservation.Effect);
        JenkIndex.Ensure(reservation.Texture);
        return new YptReservedSlot(
            reservation.Effect,
            reservation.Texture,
            reservation.DonorEffect,
            donorEvent.EmitterRuleName?.Value ?? string.Empty,
            reservation.DonorParticle,
            donorTexture,
            dropped,
            texture.Width,
            texture.Height,
            texture.Levels,
            texture.Format.ToString(),
            reservation.Sheet.Columns,
            reservation.Sheet.Rows,
            particle.TexFrameIDMin,
            particle.TexFrameIDMax,
            animations.Length > 0 ? animations[0].LastFrameID : null);
    }

    /*
     * Двоичная копия правила эффекта со всеми его эмиттерами и частицами.
     *
     * Донор собирается во временный ресурс и читается обратно. Эффекты,
     * которые частицы рождают, и модели на время сборки отцепляются — иначе
     * вместе с донором скопировались бы чужие графы, — и возвращаются на
     * место в finally, что бы ни случилось.
     */
    internal static ParticleEffectRule CopyEffect(ParticleEffectRule donor)
    {
        var restore = new List<Action>();
        try
        {
            var particles = (donor.EventEmitters?.data_items ?? [])
                .Select(item => item?.ParticleRule)
                .Where(item => item is not null)
                .Distinct()
                .ToArray();
            foreach (var particle in particles)
            {
                foreach (var spawner in new[] { particle!.EffectSpawnerAtRatio, particle.EffectSpawnerOnCollision })
                {
                    if (spawner?.EffectRule is not { } spawned) continue;
                    var owner = spawner;
                    owner.EffectRule = null;
                    restore.Add(() => owner.EffectRule = spawned);
                }
                foreach (var drawable in particle.Drawables?.data_items ?? [])
                {
                    if (drawable?.Drawable is not { } model) continue;
                    var owner = drawable;
                    owner.Drawable = null;
                    restore.Add(() => owner.Drawable = model);
                }
            }
            var carrier = new ParticleEffectsList
            {
                Name = (string_r)"astral_slot_donor",
                EffectRuleDictionary = new ParticleEffectRuleDictionary
                {
                    EffectRuleNameHashes = new ResourceSimpleList64_s<MetaHash> { data_items = [donor.NameHash] },
                    EffectRules = new ResourcePointerList64<ParticleEffectRule> { data_items = [donor] },
                },
            };
            var bytes = ResourceBuilder.Build(carrier, 68, true, false);
            var copy = new YptFile();
            copy.Load(bytes);
            if (!string.IsNullOrWhiteSpace(copy.ErrorMessage))
                throw new InvalidDataException($"YPT donor could not be copied: {copy.ErrorMessage}");
            return copy.PtfxList?.EffectRuleDictionary?.EffectRules?.data_items?.SingleOrDefault()
                ?? throw new InvalidDataException($"YPT donor copy is empty: {donor.Name?.Value}");
        }
        finally
        {
            foreach (var action in restore) action();
        }
    }

    private static IEnumerable<ParticleBehaviour> Behaviours(ParticleRule rule) =>
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

    internal static void InsertEffect(ParticleEffectRuleDictionary dictionary, ParticleEffectRule rule)
    {
        var (hashes, items) = Inserted(
            dictionary.EffectRuleNameHashes!.data_items, dictionary.EffectRules!.data_items, rule.NameHash.Hash, rule);
        dictionary.EffectRuleNameHashes.data_items = hashes;
        dictionary.EffectRules.data_items = items;
    }

    internal static void InsertEmitter(ParticleEmitterRuleDictionary dictionary, ParticleEmitterRule rule)
    {
        var (hashes, items) = Inserted(
            dictionary.EmitterRuleNameHashes!.data_items, dictionary.EmitterRules!.data_items, rule.NameHash.Hash, rule);
        dictionary.EmitterRuleNameHashes.data_items = hashes;
        dictionary.EmitterRules.data_items = items;
    }

    internal static void InsertParticle(ParticleRuleDictionary dictionary, ParticleRule rule)
    {
        var (hashes, items) = Inserted(
            dictionary.ParticleRuleNameHashes!.data_items, dictionary.ParticleRules!.data_items, rule.NameHash.Hash, rule);
        dictionary.ParticleRuleNameHashes.data_items = hashes;
        dictionary.ParticleRules.data_items = items;
    }

    private static (MetaHash[] Hashes, T[] Items) Inserted<T>(MetaHash[] hashes, T[] items, uint hash, T item)
    {
        var index = 0;
        while (index < hashes.Length && hashes[index].Hash < hash) index += 1;
        if (index < hashes.Length && hashes[index].Hash == hash)
            throw new InvalidDataException("YPT dictionary already contains this name hash.");
        var nextHashes = new MetaHash[hashes.Length + 1];
        var nextItems = new T[items.Length + 1];
        Array.Copy(hashes, 0, nextHashes, 0, index);
        Array.Copy(items, 0, nextItems, 0, index);
        nextHashes[index] = hash;
        nextItems[index] = item;
        Array.Copy(hashes, index, nextHashes, index + 1, hashes.Length - index);
        Array.Copy(items, index, nextItems, index + 1, items.Length - index);
        return (nextHashes, nextItems);
    }

    /*
     * Словари отсортированы по хешу имени, и у каждой записи есть имя.
     *
     * Хеш словаря у штатных правил — от строчного имени (RAGE хеширует
     * имена в нижнем регистре). Ядро из мода бывает собрано иначе: CodeWalker,
     * собирая ядро из XML, берёт хеш от имени как есть, и у правил с
     * заглавными буквами (wheel_fric_gravel_Bike) хеш словаря — от имени с
     * заглавными. Такие записи и записи с хешем, не похожим ни на одно
     * написание имени, — чужие: Astral их не трогает, переносит в ядро как
     * есть (хеш и имя из файла) и называет в отчёте. Файлы игры игрока
     * обязаны собираться, даже если в них моды.
     *
     * Строго проверяются только записи Astral (`astral_…`): их хеш всегда от
     * строчного имени, и расхождение у них — порча, а не мод.
     */
    internal static IReadOnlyList<YptNameHashRemark> AssertDictionaries(ParticleEffectsList list)
    {
        var remarks = new List<YptNameHashRemark>();
        var effects = list.EffectRuleDictionary;
        AssertSorted("effect rule", effects?.EffectRules?.data_items,
            effects?.EffectRuleNameHashes?.data_items?.Select(item => item.Hash).ToArray(),
            item => item?.Name?.Value, remarks);
        var emitters = list.EmitterRuleDictionary;
        AssertSorted("emitter rule", emitters?.EmitterRules?.data_items,
            emitters?.EmitterRuleNameHashes?.data_items?.Select(item => item.Hash).ToArray(),
            item => item?.Name?.Value, remarks);
        var particles = list.ParticleRuleDictionary;
        AssertSorted("particle rule", particles?.ParticleRules?.data_items,
            particles?.ParticleRuleNameHashes?.data_items?.Select(item => item.Hash).ToArray(),
            item => item?.Name?.Value, remarks);
        var textures = list.TextureDictionary;
        AssertSorted("texture", textures?.Textures?.data_items, textures?.TextureNameHashes?.data_items,
            item => item?.Name, remarks);
        return remarks;
    }

    private static void AssertSorted<T>(
        string label,
        T[]? items,
        uint[]? hashes,
        Func<T, string?> name,
        List<YptNameHashRemark> remarks)
    {
        if (items is null || hashes is null)
            throw new InvalidDataException($"YPT {label} dictionary is missing.");
        if (items.Length != hashes.Length)
            throw new InvalidDataException(
                $"YPT {label} dictionary is inconsistent: {items.Length} items, {hashes.Length} hashes.");
        for (var index = 0; index < items.Length; index += 1)
        {
            var itemName = name(items[index]);
            if (string.IsNullOrEmpty(itemName))
                throw new InvalidDataException($"YPT {label} dictionary has a nameless entry at {index}.");
            var hash = hashes[index];
            if (JenkHash.GenHash(itemName.ToLowerInvariant()) != hash)
            {
                if (itemName.StartsWith(AstralPrefix, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException(
                        $"YPT {label} dictionary hash does not match its name at {index}: {itemName}.");
                remarks.Add(new YptNameHashRemark(
                    label,
                    index,
                    itemName,
                    hash.ToString("x8"),
                    JenkHash.GenHash(itemName) == hash ? "case-sensitive" : "foreign"));
            }
            if (index > 0 && hash <= hashes[index - 1])
                throw new InvalidDataException($"YPT {label} dictionary is not sorted by name hash.");
        }
    }

    /// <summary>
    /// Хеш словаря рядом с отпечатком записи. Записи правил словари хранят
    /// парой «хеш → правило», и вставка с удалением переносят пару как есть;
    /// раз хеш чужой записи больше не выводится из имени, он сверяется сам.
    /// </summary>
    private static string DictionaryHash(MetaHash[]? hashes, int index) =>
        hashes is not null && index < hashes.Length ? $"\n#dictionary-hash {hashes[index].Hash:x8}" : string.Empty;

    private const string DefectEmitter = "emitter";
    private const string DefectParticle = "particle";
    private const string DefectTexture = "texture";

    /*
     * Давний изъян чужого ядра, не наш: ссылка правила уходит за словарь
     * (так бывает у ядра из редукса — тестер беты 19.10.2026, «ent_brk_wood_planks
     * points at an emitter rule outside the dictionary»). Игра играет с таким
     * ядром и до нас, а мы это правило не трогаем — стоять из-за него всей
     * установке незачем. Допускается только то, что было в исходнике (tolerated),
     * и только не у записей Astral: новая или собственная ссылка за словарём
     * по-прежнему отказ. Допущенное уходит в remarks — отчёт называет его.
     */
    private static bool Tolerated(
        ISet<string>? tolerated,
        ICollection<string>? remarks,
        string kind,
        string? name)
    {
        if (tolerated is null || string.IsNullOrEmpty(name)) return false;
        var key = $"{kind}:{name}";
        if (!tolerated.Contains(key)) return false;
        remarks?.Add(key);
        return true;
    }

    /*
     * Ссылки исходного ядра за словарём: ключи "вид:имя" (эффект с событием
     * в чужое правило, правило частицы с чужой текстурой). Снимается до
     * любой правки и годится как tolerated в VerifyGraph. Записи Astral в
     * список не попадают — к ним допуск не относится.
     */
    internal static HashSet<string> GraphDefects(YptFile ypt)
    {
        var defects = new HashSet<string>(StringComparer.Ordinal);
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var emitters = new HashSet<ParticleEmitterRule>(
            list.EmitterRuleDictionary?.EmitterRules?.data_items ?? [], ReferenceEqualityComparer.Instance);
        var particles = new HashSet<ParticleRule>(
            list.ParticleRuleDictionary?.ParticleRules?.data_items ?? [], ReferenceEqualityComparer.Instance);
        var textures = new HashSet<Texture>(
            list.TextureDictionary?.Textures?.data_items ?? [], ReferenceEqualityComparer.Instance);
        void Add(string kind, string? name)
        {
            if (string.IsNullOrEmpty(name) ||
                name.StartsWith("astral_", StringComparison.OrdinalIgnoreCase)) return;
            defects.Add($"{kind}:{name}");
        }
        foreach (var effect in list.EffectRuleDictionary?.EffectRules?.data_items ?? [])
        {
            var events = effect.EventEmitters?.data_items ?? [];
            for (var index = 0; index < Math.Min(effect.EventEmittersCount, events.Length); index += 1)
            {
                if (events[index] is not { } item) continue;
                if (item.EmitterRule is { } emitter && !emitters.Contains(emitter))
                    Add(DefectEmitter, effect.Name?.Value);
                if (item.ParticleRule is { } particle && !particles.Contains(particle))
                    Add(DefectParticle, effect.Name?.Value);
            }
        }
        foreach (var particle in list.ParticleRuleDictionary?.ParticleRules?.data_items ?? [])
            foreach (var variable in (particle.ShaderVars?.data_items ?? []).OfType<ParticleShaderVarTexture>())
                if (variable.Texture is { } texture && !textures.Contains(texture))
                    Add(DefectTexture, particle.Name?.Value);
        return defects;
    }

    /*
     * Граф ядра замкнут: события эффектов ведут в эмиттеры и частицы из
     * словарей, текстуры частиц — в словарь текстур, у слотов верные
     * счётчики ссылок. Лишняя копия, случайно оставшаяся в графе, была бы
     * записана в ресурс незаметно для описи — поэтому проверка до записи.
     */
    internal static void VerifyGraph(
        YptFile ypt,
        IEnumerable<string> slots,
        ISet<string>? tolerated = null,
        ICollection<string>? remarks = null)
    {
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        AssertDictionaries(list);
        var effects = list.EffectRuleDictionary!.EffectRules!.data_items;
        var emitterRules = list.EmitterRuleDictionary!.EmitterRules!.data_items;
        var particleRules = list.ParticleRuleDictionary!.ParticleRules!.data_items;
        var emitters = new HashSet<ParticleEmitterRule>(emitterRules, ReferenceEqualityComparer.Instance);
        var particles = new HashSet<ParticleRule>(particleRules, ReferenceEqualityComparer.Instance);
        var textures = new HashSet<Texture>(list.TextureDictionary!.Textures!.data_items, ReferenceEqualityComparer.Instance);
        var emitterUsers = new Dictionary<ParticleEmitterRule, int>(ReferenceEqualityComparer.Instance);
        var particleUsers = new Dictionary<ParticleRule, int>(ReferenceEqualityComparer.Instance);
        foreach (var effect in effects)
        {
            var events = effect.EventEmitters?.data_items ?? [];
            for (var index = 0; index < Math.Min(effect.EventEmittersCount, events.Length); index += 1)
            {
                if (events[index] is not { } item) continue;
                if (item.EmitterRule is { } emitter)
                {
                    if (!emitters.Contains(emitter))
                    {
                        if (!Tolerated(tolerated, remarks, DefectEmitter, effect.Name?.Value))
                            throw new InvalidDataException(
                                $"YPT effect {effect.Name?.Value} points at an emitter rule outside the dictionary.");
                    }
                    else
                        emitterUsers[emitter] = emitterUsers.GetValueOrDefault(emitter) + 1;
                }
                if (item.ParticleRule is { } particle)
                {
                    if (!particles.Contains(particle))
                    {
                        if (!Tolerated(tolerated, remarks, DefectParticle, effect.Name?.Value))
                            throw new InvalidDataException(
                                $"YPT effect {effect.Name?.Value} points at a particle rule outside the dictionary.");
                    }
                    else
                        particleUsers[particle] = particleUsers.GetValueOrDefault(particle) + 1;
                }
            }
        }
        foreach (var particle in particleRules)
        {
            foreach (var variable in (particle.ShaderVars?.data_items ?? []).OfType<ParticleShaderVarTexture>())
            {
                if (variable.Texture is { } texture && !textures.Contains(texture) &&
                    !Tolerated(tolerated, remarks, DefectTexture, particle.Name?.Value))
                    throw new InvalidDataException(
                        $"YPT particle rule {particle.Name?.Value} points at a texture outside the dictionary.");
            }
        }
        foreach (var slot in slots)
        {
            var effect = effects.SingleOrDefault(item => item.Name?.Value == slot)
                ?? throw new InvalidDataException($"YPT slot effect rule is missing: {slot}");
            var emitter = emitterRules.SingleOrDefault(item => item.Name?.Value == slot)
                ?? throw new InvalidDataException($"YPT slot emitter rule is missing: {slot}");
            var particle = particleRules.SingleOrDefault(item => item.Name?.Value == slot)
                ?? throw new InvalidDataException($"YPT slot particle rule is missing: {slot}");
            if (effect.RefCount != 1 ||
                emitter.RefCount != 1 + emitterUsers.GetValueOrDefault(emitter) ||
                particle.RefCount != 1 + particleUsers.GetValueOrDefault(particle))
                throw new InvalidDataException($"YPT slot reference counts are inconsistent: {slot}");
        }
    }

    /*
     * Отпечаток каждого правила и каждой текстуры ядра.
     *
     * Правила — через их же XML-описание (всё, что CodeWalker о них знает,
     * включая RefCount и ссылки по именам), текстуры — раскладка, служебные
     * поля и SHA-256 пикселей. Отпечатки до и после сверяются поимённо.
     */
    internal static Dictionary<string, string> Digest(YptFile ypt)
    {
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var text = new StringBuilder(1 << 16);
        void Add(string key, string value)
        {
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
            if (!result.TryAdd(key, digest))
                throw new InvalidDataException($"YPT contains a duplicate {key}.");
        }
        var effects = list.EffectRuleDictionary?.EffectRules?.data_items ?? [];
        var effectHashes = list.EffectRuleDictionary?.EffectRuleNameHashes?.data_items;
        for (var index = 0; index < effects.Length; index += 1)
        {
            var effect = effects[index];
            text.Clear();
            effect.WriteXml(text, 0);
            text.Append(DictionaryHash(effectHashes, index));
            Add($"effect:{effect.Name?.Value}", text.ToString());
        }
        var emitters = list.EmitterRuleDictionary?.EmitterRules?.data_items ?? [];
        var emitterHashes = list.EmitterRuleDictionary?.EmitterRuleNameHashes?.data_items;
        for (var index = 0; index < emitters.Length; index += 1)
        {
            var emitter = emitters[index];
            text.Clear();
            emitter.WriteXml(text, 0);
            text.Append(DictionaryHash(emitterHashes, index));
            Add($"emitter:{emitter.Name?.Value}", text.ToString());
        }
        var particles = list.ParticleRuleDictionary?.ParticleRules?.data_items ?? [];
        var particleHashes = list.ParticleRuleDictionary?.ParticleRuleNameHashes?.data_items;
        for (var index = 0; index < particles.Length; index += 1)
        {
            var particle = particles[index];
            text.Clear();
            particle.WriteXml(text, 0, string.Empty);
            text.Append(DictionaryHash(particleHashes, index));
            Add($"particle:{particle.Name?.Value}", text.ToString());
        }
        foreach (var texture in list.TextureDictionary?.Textures?.data_items ?? [])
        {
            var pixels = texture.Data?.FullData is { Length: > 0 } data
                ? Convert.ToHexString(SHA256.HashData(data))
                : "none";
            Add(
                $"texture:{texture.Name}",
                $"{texture.Width}|{texture.Height}|{texture.Depth}|{texture.Levels}|{texture.Format}|" +
                $"{texture.Stride}|{texture.Unknown_32h}|{texture.UsageData}|{texture.ExtraFlags}|{pixels}");
        }
        return result;
    }

    /*
     * `purged` — записи, которые установка удалила сама (прежние клоны
     * эффектов под приставками Astral): их отпечатки «до» не сверяются, а
     * одноимённые записи «после» считаются новыми. `cloneKeys` — записи,
     * которые обязаны появиться от клонов (YptEffectClones).
     */
    internal static object VerifyAfterSave(
        YptFile reloaded,
        IReadOnlyList<YptSlotReservation> reservations,
        IReadOnlyDictionary<string, string> before,
        ISet<string> patchedTextures,
        ISet<string> patchedRules,
        ISet<string>? purged = null,
        ISet<string>? cloneKeys = null,
        ISet<string>? toleratedGraph = null,
        ICollection<string>? graphRemarks = null)
    {
        VerifyGraph(reloaded, reservations.Select(item => item.Effect), toleratedGraph, graphRemarks);
        var after = Digest(reloaded);
        var unchanged = 0;
        var intended = 0;
        foreach (var (key, digest) in before)
        {
            if (purged is not null && purged.Contains(key)) continue;
            if (!after.TryGetValue(key, out var current))
                throw new InvalidDataException($"YPT lost {key} while reserving Astral slots.");
            var name = key[(key.IndexOf(':') + 1)..];
            var patched = key.StartsWith("texture:", StringComparison.Ordinal)
                ? patchedTextures.Contains(name)
                : patchedRules.Contains(name);
            if (patched)
            {
                intended += 1;
                continue;
            }
            if (!string.Equals(current, digest, StringComparison.Ordinal))
                throw new InvalidDataException($"YPT {key} changed while reserving Astral slots.");
            unchanged += 1;
        }
        var expected = reservations
            .SelectMany(item => new[]
            {
                $"effect:{item.Effect}",
                $"emitter:{item.Effect}",
                $"particle:{item.Effect}",
                $"texture:{item.Texture}",
            })
            .ToHashSet(StringComparer.Ordinal);
        if (cloneKeys is not null) expected.UnionWith(cloneKeys);
        var added = after.Keys
            .Where(key => !before.ContainsKey(key) || (purged is not null && purged.Contains(key)))
            .ToHashSet(StringComparer.Ordinal);
        if (!added.SetEquals(expected))
            throw new InvalidDataException(
                "YPT entries changed unexpectedly while reserving Astral slots: " +
                string.Join(", ", added.Except(expected).Concat(expected.Except(added))));
        var purgedForGood = purged?.Count(key => !after.ContainsKey(key)) ?? 0;
        var list = reloaded.PtfxList!;
        foreach (var reservation in reservations) VerifySlot(list, reservation);
        return new
        {
            vanillaUnchanged = unchanged,
            intentionallyPatched = intended,
            added = added.Count,
            purged = purgedForGood,
            effectRules = list.EffectRuleDictionary!.EffectRules!.data_items.Length,
            emitterRules = list.EmitterRuleDictionary!.EmitterRules!.data_items.Length,
            particleRules = list.ParticleRuleDictionary!.ParticleRules!.data_items.Length,
            textures = list.TextureDictionary!.Textures!.data_items.Length,
        };
    }

    /*
     * Самопроверка (--self-test): ядро, где у штатного эффекта событие ведёт
     * в эмиттер за словарём (тестер беты 19.10.2026: «ent_brk_wood_planks
     * points at an emitter rule outside the dictionary»). Без допуска граф
     * отвергается; с допуском, снятым с исходника, — проходит и называет
     * запись; та же беда у записи Astral или у эффекта, которого в исходнике
     * не было, — по-прежнему отказ.
     */
    internal static bool SelfTestDanglingRefs()
    {
        static ParticleEmitterRule Emitter(string name) =>
            new() { Name = (string_r)name, NameHash = JenkHash.GenHash(name), RefCount = 1 };
        static ParticleEffectRule Effect(string name, ParticleEmitterRule emitter) =>
            new()
            {
                Name = (string_r)name,
                NameHash = JenkHash.GenHash(name),
                RefCount = 1,
                EventEmittersCount = 1,
                EventEmitters = new ResourcePointerArray64<ParticleEventEmitter>
                {
                    data_items =
                    [
                        new ParticleEventEmitter
                        {
                            EmitterRuleName = (string_r)emitter.Name!.Value,
                            EmitterRule = emitter,
                        },
                    ],
                },
            };
        static bool Refused(Action action)
        {
            try { action(); return false; }
            catch (InvalidDataException) { return true; }
        }

        var inside = Emitter("inside_emitter");
        inside.RefCount = 2;
        var stray = Emitter("stray_emitter");
        var effects = new[]
        {
            Effect("ent_brk_wood_planks", stray),
            Effect("ent_brk_healthy", inside),
        }.OrderBy(item => JenkHash.GenHash(item.Name!.Value!)).ToArray();
        var ypt = new YptFile
        {
            PtfxList = new ParticleEffectsList
            {
                Name = (string_r)"core",
                EffectRuleDictionary = new ParticleEffectRuleDictionary
                {
                    EffectRuleNameHashes = new ResourceSimpleList64_s<MetaHash>
                    {
                        data_items = effects.Select(item => (MetaHash)JenkHash.GenHash(item.Name!.Value!)).ToArray(),
                    },
                    EffectRules = new ResourcePointerList64<ParticleEffectRule> { data_items = effects },
                },
                EmitterRuleDictionary = new ParticleEmitterRuleDictionary
                {
                    EmitterRuleNameHashes = new ResourceSimpleList64_s<MetaHash>
                    {
                        data_items = [(MetaHash)JenkHash.GenHash("inside_emitter")],
                    },
                    EmitterRules = new ResourcePointerList64<ParticleEmitterRule> { data_items = [inside] },
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

        var strict = Refused(() => VerifyGraph(ypt, []));
        var baseline = GraphDefects(ypt);
        var named = baseline.SetEquals(["emitter:ent_brk_wood_planks"]);
        var remarks = new SortedSet<string>(StringComparer.Ordinal);
        VerifyGraph(ypt, [], baseline, remarks);
        var reported = remarks.SetEquals(["emitter:ent_brk_wood_planks"]);

        // Новая беда не прощается: запись Astral (в список допуска не попадает)
        // и эффект, которого в исходнике не было.
        var dictionary = ypt.PtfxList.EffectRuleDictionary!;
        InsertEffect(dictionary, Effect("astral_impact_new", stray));
        var astralStrict = Refused(() => VerifyGraph(ypt, [], baseline, new SortedSet<string>()));
        var astralSkipped = !GraphDefects(ypt).Any(key => key.Contains("astral_", StringComparison.Ordinal));
        Remove(dictionary, "astral_impact_new");
        InsertEffect(dictionary, Effect("ent_brk_new_stray", stray));
        var newStrict = Refused(() => VerifyGraph(ypt, [], baseline, new SortedSet<string>()));
        return strict && named && reported && astralStrict && astralSkipped && newStrict;

        static void Remove(ParticleEffectRuleDictionary dictionary, string name)
        {
            var keep = dictionary.EffectRules!.data_items
                .Select((rule, index) => (rule, hash: dictionary.EffectRuleNameHashes!.data_items[index]))
                .Where(item => item.rule.Name?.Value != name)
                .ToArray();
            dictionary.EffectRules.data_items = keep.Select(item => item.rule).ToArray();
            dictionary.EffectRuleNameHashes!.data_items = keep.Select(item => item.hash).ToArray();
        }
    }

    private static void VerifySlot(ParticleEffectsList list, YptSlotReservation reservation)
    {
        var effect = list.EffectRuleDictionary!.EffectRules!.data_items
            .Single(item => item.Name?.Value == reservation.Effect);
        var events = effect.EventEmitters?.data_items ?? [];
        if (effect.EventEmittersCount != 1 || events.Length == 0 || events[0] is not { } primary)
            throw new InvalidDataException($"YPT slot must keep exactly one emitter: {reservation.Effect}");
        if (primary.EmitterRuleName?.Value != reservation.Effect ||
            primary.ParticleRuleName?.Value != reservation.Effect ||
            primary.EmitterRule?.Name?.Value != reservation.Effect ||
            primary.ParticleRule?.Name?.Value != reservation.Effect)
            throw new InvalidDataException($"YPT slot emitter does not point at its own rules: {reservation.Effect}");
        var particle = primary.ParticleRule;
        var diffuse = (particle.ShaderVars?.data_items ?? [])
            .OfType<ParticleShaderVarTexture>()
            .SingleOrDefault(item => item.Name.Hash == DiffuseVariable && item.Texture is not null)
            ?? throw new InvalidDataException($"YPT slot particle lost its texture: {reservation.Effect}");
        var texture = list.TextureDictionary!.Textures!.data_items
            .SingleOrDefault(item => string.Equals(item.Name, reservation.Texture, StringComparison.OrdinalIgnoreCase));
        if (texture is null || !ReferenceEquals(diffuse.Texture, texture) ||
            diffuse.TextureName?.Value != reservation.Texture ||
            diffuse.TextureNameHash.Hash != JenkHash.GenHash(reservation.Texture.ToLowerInvariant()))
            throw new InvalidDataException($"YPT slot particle does not draw its texture: {reservation.Effect}");
        if (particle.TexFrameIDMin != reservation.Frames.Min || particle.TexFrameIDMax != reservation.Frames.Max)
            throw new InvalidDataException($"YPT slot frames did not survive the save: {reservation.Effect}");
        var frames = reservation.Sheet.Columns * reservation.Sheet.Rows;
        foreach (var animation in Behaviours(particle).OfType<ParticleBehaviourAnimateTexture>().Distinct())
        {
            if ((reservation.Frames.Last is int last && animation.LastFrameID != last) ||
                animation.LastFrameID >= frames)
                throw new InvalidDataException($"YPT slot animation did not survive the save: {reservation.Effect}");
        }
    }

    /*
     * Самопроверка (--self-test): словарь правил, как в ядре из мода,
     * собранном CodeWalker из XML (тестер беты 14.10: «hash does not match
     * its name at 81: wheel_fric_gravel_Bike»). У правила с заглавными
     * буквами хеш словаря — от имени как есть, у ещё одного — ни от одного
     * написания. Сброс прежнего клона и новый клон проходят, чужие пары
     * «хеш → правило» остаются как были, а подмена их хеша, своя запись
     * Astral с чужим хешем и словарь не по порядку — отказ.
     */
    internal static bool SelfTestForeignNameHashes()
    {
        static ParticleEffectRule Rule(string name) =>
            new() { Name = (string_r)name, NameHash = JenkHash.GenHash(name), RefCount = 1 };
        static YptFile Core(params (string Name, uint Hash)[] entries)
        {
            var sorted = entries.OrderBy(item => item.Hash).ToArray();
            return new YptFile
            {
                PtfxList = new ParticleEffectsList
                {
                    Name = (string_r)"core",
                    EffectRuleDictionary = new ParticleEffectRuleDictionary
                    {
                        EffectRuleNameHashes = new ResourceSimpleList64_s<MetaHash>
                        {
                            data_items = sorted.Select(item => (MetaHash)item.Hash).ToArray(),
                        },
                        EffectRules = new ResourcePointerList64<ParticleEffectRule>
                        {
                            data_items = sorted.Select(item => Rule(item.Name)).ToArray(),
                        },
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

        const string CaseName = "wheel_fric_gravel_Bike";
        var foreignHash = JenkHash.GenHash("foreign_rule") ^ 0xA5A5A5A5u;
        (string, uint)[] modded =
        [
            ("bul_gravel", JenkHash.GenHash("bul_gravel")),
            (CaseName, JenkHash.GenHash(CaseName)),
            ("foreign_rule", foreignHash),
            ("astral_impact_old", JenkHash.GenHash("astral_impact_old")),
        ];
        var ypt = Core(modded);
        var remarks = AssertDictionaries(ypt.PtfxList!);
        var tolerated = remarks.Count == 2 &&
            remarks.Any(item => item.Name == CaseName && item.Form == "case-sensitive") &&
            remarks.Any(item => item.Name == "foreign_rule" && item.Form == "foreign");

        var before = Digest(ypt);
        var purged = YptEffectClones.Purge(ypt, ["astral_impact_"]);
        InsertEffect(ypt.PtfxList!.EffectRuleDictionary!, Rule("astral_impact_new"));
        var expected = new HashSet<string>(StringComparer.Ordinal) { "effect:astral_impact_new" };
        VerifyAfterSave(ypt, [], before, new HashSet<string>(), new HashSet<string>(), purged, expected);
        var dictionary = ypt.PtfxList.EffectRuleDictionary!;
        var kept = dictionary.EffectRules!.data_items
            .Select((rule, index) => (rule.Name?.Value, dictionary.EffectRuleNameHashes!.data_items[index].Hash))
            .ToArray();
        var preserved = kept.Contains((CaseName, JenkHash.GenHash(CaseName))) &&
            kept.Contains(("foreign_rule", foreignHash)) &&
            purged.SetEquals(["effect:astral_impact_old"]);

        // Хеш чужой записи «починился» при записи — это уже не тот файл.
        var renamed = Core(
            ("bul_gravel", JenkHash.GenHash("bul_gravel")),
            (CaseName, JenkHash.GenHash(CaseName.ToLowerInvariant())),
            ("foreign_rule", foreignHash));
        var rehashCaught = Refused(() => VerifyAfterSave(
            renamed, [], Digest(Core(modded[..3])), new HashSet<string>(), new HashSet<string>()));
        var astralStrict = Refused(() => AssertDictionaries(Core(
            ("bul_gravel", JenkHash.GenHash("bul_gravel")),
            ("astral_impact_bad", JenkHash.GenHash("astral_impact_bad") ^ 1u)).PtfxList!));
        var unsorted = Core(modded[..2]);
        Array.Reverse(unsorted.PtfxList!.EffectRuleDictionary!.EffectRuleNameHashes!.data_items);
        Array.Reverse(unsorted.PtfxList.EffectRuleDictionary.EffectRules!.data_items);
        var orderStrict = Refused(() => AssertDictionaries(unsorted.PtfxList));
        return tolerated && preserved && rehashCaught && astralStrict && orderStrict;
    }
}
