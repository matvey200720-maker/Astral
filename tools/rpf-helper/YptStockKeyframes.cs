using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

/*
 * ПРАВКА ШТАТНЫХ ПРАВИЛ ЯДРА ИГРОКА — «наш Core», слой каталога «правила автора»
 * (Хелпер 20, 29.10.2026).
 *
 * Автор редукса меняет у штатных правил облик: кадры цвета крови, свечение и
 * размер частиц взрыва, свет вспышки, число и срок жизни частиц. Целое ядро
 * автора — файл Rockstar, его не раздаём; переносятся только числа автора —
 * кадры свойств (`[время, x, y, z, w]`), которые он поменял, — и ложатся на
 * те же свойства тех же объектов ядра игрока. Остальное — игрока.
 *
 * Объект — правило эффекта (свои пять свойств: оттенок, масштаб, области
 * данных), эмиттер (его свойства и свойства областей рождения, цели и
 * притяжения) или частица (свойства её поведений) по имени. Кадры пишутся тем
 * же кодом, что у настройки клонов (`YptEffectClones.SetKeyframes`): обратные
 * длины отрезков считаются, как их хранит игра.
 *
 * Правятся только штатные объекты (имена вне `astral_`): свои объекты Astral
 * живут клонами и слотами. Структура не меняется — новых записей нет, а сверка
 * после записи (`VerifyAfterSave`) ждёт изменения ровно этих объектов.
 * `optional` — объекта или свойства у этого варианта ядра нет (hi/lo бывают
 * беднее основного): правка пропускается и называется в отчёте.
 *
 * ВОЗВРАТ. Снятие карточки под работой мастерской возвращает свойству кадры
 * игры (`fromDonor`): они копируются из ядра образца (`stockKeyframesFrom`)
 * как есть, с хранимыми игрой числами, — у Rockstar бывают кадры с одним
 * временем, и правка через проверку кадров их бы отвергла.
 */
internal sealed record YptStockKeyframes(
    string Kind,
    string Name,
    string Prop,
    IReadOnlyList<IReadOnlyList<decimal>>? Values = null,
    bool Optional = false,
    bool FromDonor = false);

internal sealed record YptStockKeyframesReport(
    int Applied,
    IReadOnlyList<string> Objects,
    IReadOnlyList<string> Skipped,
    // Кадры каждого правленого свойства, как они легли в память: с ними
    // сверяется перечитанное ядро.
    IReadOnlyDictionary<string, SharpDX.Vector4[][]> Expected);

internal static class YptStockKeyframesPatch
{
    private static readonly Regex ObjectName = new("^[a-z0-9_]{1,96}$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex PropName = new("^[a-z0-9_]{1,48}:[a-z0-9_]{1,64}$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private const int MaxPatches = 4096;

    internal static YptStockKeyframesReport Apply(YptFile ypt, IReadOnlyList<YptStockKeyframes> patches, ParticleEffectsList? donor = null)
    {
        if (patches.Count > MaxPatches)
            throw new InvalidDataException($"YPT stock keyframe patch count must not exceed {MaxPatches}.");
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var objects = new SortedSet<string>(StringComparer.Ordinal);
        var skipped = new List<string>();
        var expected = new Dictionary<string, SharpDX.Vector4[][]>(StringComparer.OrdinalIgnoreCase);
        var applied = 0;
        foreach (var patch in patches)
        {
            var kind = (patch.Kind ?? string.Empty).Trim().ToLowerInvariant();
            var name = (patch.Name ?? string.Empty).Trim();
            var prop = (patch.Prop ?? string.Empty).Trim();
            if (kind is not ("effect" or "emitter" or "particle"))
                throw new InvalidDataException($"YPT stock keyframe kind is invalid: {patch.Kind}");
            if (!ObjectName.IsMatch(name) || name.StartsWith("astral_", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"YPT stock keyframe object must be a stock name: {patch.Name}");
            if (!PropName.IsMatch(prop))
                throw new InvalidDataException($"YPT stock keyframe property is invalid: {patch.Prop}");
            var key = $"{kind}:{name}:{prop}";
            if (!seen.Add(key))
                throw new InvalidDataException($"YPT stock keyframe is patched twice: {key}");
            var hash = new ParticleKeyframePropName(prop).Hash;
            var targets = Targets(list, kind, name)?
                .Where(item => item is not null && item.Name.Hash == hash)
                .Distinct()
                .ToList();
            if (targets is null || targets.Count == 0)
            {
                if (!patch.Optional)
                    throw new InvalidDataException(
                        targets is null
                            ? $"YPT core has no stock {kind} {name}."
                            : $"YPT stock {kind} {name} has no keyframe property {prop}.");
                skipped.Add(key);
                continue;
            }
            if (patch.FromDonor)
            {
                if (donor is null)
                    throw new InvalidDataException($"YPT stock keyframes need a donor core: {key}");
                var sources = Targets(donor, kind, name)?
                    .Where(item => item is not null && item.Name.Hash == hash)
                    .Distinct()
                    .ToList();
                if (sources is null || sources.Count != targets.Count)
                {
                    if (!patch.Optional)
                        throw new InvalidDataException($"YPT donor core does not match {key}");
                    skipped.Add(key);
                    continue;
                }
                for (var index = 0; index < targets.Count; index += 1)
                {
                    targets[index]!.Values ??= new ResourceSimpleList64<ParticleKeyframePropValue>();
                    targets[index]!.Values.data_items = (sources[index]!.Values?.data_items ?? [])
                        .Select(item => new ParticleKeyframePropValue { KeyframeTime = item.KeyframeTime, KeyframeValue = item.KeyframeValue })
                        .ToArray();
                    applied += 1;
                }
            }
            else
            {
                if (patch.Values is null)
                    throw new InvalidDataException($"YPT stock keyframes have no values: {key}");
                foreach (var target in targets)
                {
                    YptEffectClones.SetKeyframes(target!, patch.Values, key);
                    applied += 1;
                }
            }
            expected[key] = targets
                .SelectMany(target => (target!.Values?.data_items ?? []).Select(item => new[] { item.KeyframeTime, item.KeyframeValue }))
                .ToArray();
            objects.Add(name);
        }
        return new YptStockKeyframesReport(applied, objects.ToArray(), skipped, expected);
    }

    /// <summary>Свойства объекта ядра по виду и имени; <c>null</c> — объекта нет.</summary>
    private static IEnumerable<ParticleKeyframeProp?>? Targets(ParticleEffectsList list, string kind, string name)
    {
        bool Named(string? value) => string.Equals(value, name, StringComparison.OrdinalIgnoreCase);
        if (kind == "effect")
        {
            var effect = (list.EffectRuleDictionary?.EffectRules?.data_items ?? []).FirstOrDefault(item => Named(item?.Name?.Value));
            return effect is null
                ? null
                : [effect.ColourTintMinKFP, effect.ColourTintMaxKFP, effect.ZoomScalarKFP, effect.DataSphereKFP, effect.DataCapsuleKFP];
        }
        if (kind == "emitter")
        {
            var emitter = (list.EmitterRuleDictionary?.EmitterRules?.data_items ?? []).FirstOrDefault(item => Named(item?.Name?.Value));
            if (emitter is null) return null;
            IEnumerable<ParticleKeyframeProp?> owned = emitter.KeyframeProps ?? [];
            foreach (var domain in new[] { emitter.CreationDomainObj, emitter.TargetDomainObj, emitter.AttractorDomainObj })
                if (domain is not null)
                    owned = owned.Concat([domain.PositionKFP, domain.RotationKFP, domain.SizeOuterKFP, domain.SizeInnerKFP]);
            return owned;
        }
        var particle = (list.ParticleRuleDictionary?.ParticleRules?.data_items ?? []).FirstOrDefault(item => Named(item?.Name?.Value));
        return particle is null
            ? null
            : YptEffectClones.Behaviours(particle).Distinct().SelectMany(behaviour => behaviour.KeyframeProps?.data_items ?? []);
    }

    /// <summary>
    /// Перечитанное ядро: у каждого правленого свойства — ровно те кадры (время, обратная длина отрезка, значения),
    /// что легли в память перед записью. Иначе отказ до записи в игру.
    /// </summary>
    internal static void VerifyAfterSave(YptFile reloaded, IReadOnlyList<YptStockKeyframes> patches, YptStockKeyframesReport report)
    {
        var list = reloaded.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var skipped = report.Skipped.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var patch in patches)
        {
            var kind = patch.Kind.Trim().ToLowerInvariant();
            var key = $"{kind}:{patch.Name.Trim()}:{patch.Prop.Trim()}";
            if (skipped.Contains(key)) continue;
            var hash = new ParticleKeyframePropName(patch.Prop.Trim()).Hash;
            var frames = (Targets(list, kind, patch.Name.Trim()) ?? [])
                .Where(item => item is not null && item.Name.Hash == hash)
                .Distinct()
                .SelectMany(target => (target!.Values?.data_items ?? []).Select(item => new[] { item.KeyframeTime, item.KeyframeValue }))
                .ToArray();
            if (!report.Expected.TryGetValue(key, out var wanted) || frames.Length != wanted.Length)
                throw new InvalidDataException($"YPT stock keyframes did not survive the save: {key}");
            for (var index = 0; index < frames.Length; index += 1)
                if (!Same(frames[index][0], wanted[index][0]) || !Same(frames[index][1], wanted[index][1]))
                    throw new InvalidDataException($"YPT stock keyframes did not survive the save: {key}");
        }
    }

    private static bool Same(SharpDX.Vector4 left, SharpDX.Vector4 right) =>
        left.X.Equals(right.X) && left.Y.Equals(right.Y) && left.Z.Equals(right.Z) && left.W.Equals(right.W);
}
