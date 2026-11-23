using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

/*
 * Выписка правил эффектов — числа, по которым окно мастерской проигрывает
 * эффект попадания.
 *
 * Правило эффекта в GTA — это не картинка, а набор чисел: сколько частиц
 * родится, как долго живут, с какой скоростью и куда летят, как растут,
 * какого они цвета в каждый миг жизни, каким листом нарисованы и как этот
 * лист листается. До сих пор предпросмотр рисовал «примерно кровь» по
 * числам, подобранным на глаз, и человек видел на сцене одно, а в игре —
 * другое. Выписка отдаёт числа самого правила из ядра игрока (или из чужого
 * словаря — клоунские эффекты живут в `scr_rcbarry2.ypt`), и сцена считает
 * выброс по ним: те же кадры размера, цвета и скорости, что клон унесёт в
 * игру.
 *
 * Здесь только чтение и только те поля, что нужны сцене. Ничего не пишется.
 */
internal static class YptRuleDigest
{
    private const int MaxRules = 128;
    private static readonly Regex RuleName =
        new("^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant);
    private static readonly uint DiffuseVariable = JenkHash.GenHash("diffusetex2");

    /// <summary>Правила по именам: выписка или <c>null</c> у отсутствующего.</summary>
    public static IReadOnlyDictionary<string, object?> Describe(YptFile ypt, IReadOnlyList<string?> names)
    {
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var effects = list.EffectRuleDictionary?.EffectRules?.data_items ?? [];
        var rules = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var raw in names)
        {
            var name = raw?.Trim() ?? string.Empty;
            if (!RuleName.IsMatch(name))
                throw new InvalidDataException($"YPT rule name is invalid: {raw}");
            if (rules.ContainsKey(name)) continue;
            if (rules.Count >= MaxRules)
                throw new InvalidDataException($"YPT rule digest names at most {MaxRules} rules.");
            var rule = effects.FirstOrDefault(item =>
                string.Equals(item?.Name?.Value, name, StringComparison.Ordinal));
            rules[name] = rule is null ? null : DescribeEffect(rule);
        }
        return rules;
    }

    private static object DescribeEffect(ParticleEffectRule rule)
    {
        var events = (rule.EventEmitters?.data_items ?? [])
            .Take(rule.EventEmittersCount)
            .Where(item => item?.EmitterRule is not null && item.ParticleRule is not null)
            .Select(DescribeEvent!)
            .ToArray();
        return new
        {
            duration = Pair(rule.DurationMin, rule.DurationMax),
            playback = Pair(rule.PlaybackRateScalarMin, rule.PlaybackRateScalarMax),
            loops = rule.NumLoops,
            cull = Pair(rule.DistanceCullingFadeDist, rule.DistanceCullingCullDist),
            lod = Pair(rule.LodEvoDistanceMin, rule.LodEvoDistanceMax),
            zoom = Frames(rule.ZoomScalarKFP),
            events,
        };
    }

    private static object DescribeEvent(ParticleEventEmitter item) => new
    {
        emitter = item.EmitterRuleName?.Value ?? item.EmitterRule?.Name?.Value,
        particle = item.ParticleRuleName?.Value ?? item.ParticleRule?.Name?.Value,
        start = Round(item.StartRatio),
        end = Round(item.EndRatio),
        zoom = Pair(item.ZoomScalarMin, item.ZoomScalarMax),
        playback = Pair(item.PlaybackRateScalarMin, item.PlaybackRateScalarMax),
        evolutions = (item.EvolutionList?.Evolutions?.data_items ?? [])
            .Select(evolution => evolution?.Name?.Value)
            .Where(name => !string.IsNullOrEmpty(name))
            .ToArray(),
        emitterRule = DescribeEmitter(item.EmitterRule!),
        particleRule = DescribeParticle(item.ParticleRule!),
    };

    private static object DescribeEmitter(ParticleEmitterRule rule) => new
    {
        oneShot = rule.IsOneShot != 0,
        props = Props(rule.KeyframeProps ?? []),
        creation = Domain(rule.CreationDomainObj),
        target = Domain(rule.TargetDomainObj),
        attractor = Domain(rule.AttractorDomainObj),
    };

    private static object? Domain(ParticleDomain? domain)
    {
        if (domain is null) return null;
        return new
        {
            type = domain.DomainType.ToString().ToLowerInvariant(),
            worldSpace = domain.IsWorldSpace != 0,
            pointRelative = domain.IsPointRelative != 0,
            position = Frames(domain.PositionKFP),
            rotation = Frames(domain.RotationKFP),
            sizeOuter = Frames(domain.SizeOuterKFP),
            sizeInner = Frames(domain.SizeInnerKFP),
        };
    }

    private static object DescribeParticle(ParticleRule rule)
    {
        string? texture = null;
        foreach (var variable in (rule.ShaderVars?.data_items ?? []).OfType<ParticleShaderVarTexture>())
        {
            if (variable.Name.Hash != DiffuseVariable) continue;
            texture = variable.TextureName?.Value ?? variable.Texture?.Name;
        }
        var behaviours = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var behaviour in Behaviours(rule).Distinct())
        {
            var key = behaviour.Type.ToString();
            if (behaviours.ContainsKey(key)) continue;
            behaviours[key] = DescribeBehaviour(behaviour);
        }
        return new
        {
            texture = string.IsNullOrEmpty(texture) || texture == "None" ? null : texture,
            drawType = rule.DrawType,
            blendSet = rule.BlendSet,
            lit = rule.IsLit != 0,
            soft = rule.IsSoft != 0,
            technique = rule.ShaderTechnique?.Value,
            frames = new[] { rule.TexFrameIDMin, rule.TexFrameIDMax },
            drawables = rule.Drawables?.data_items?.Count(item => item?.Drawable is not null) ?? 0,
            behaviours,
        };
    }

    /// <summary>
    /// Поведение частицы: его кадры и те скалярные поля, от которых зависит
    /// проигрывание (как листается лист, накапливается ли угол, тянет ли
    /// тяжесть). Остальные поля — про свет и тени, сцене они ни к чему.
    /// </summary>
    private static object DescribeBehaviour(ParticleBehaviour behaviour)
    {
        var props = Props(behaviour.KeyframeProps?.data_items ?? []);
        return behaviour switch
        {
            ParticleBehaviourAnimateTexture animation => new
            {
                props,
                lastFrame = animation.LastFrameID,
                loopMode = animation.LoopMode,
                randomised = animation.IsRandomised != 0,
                scaledOverLife = animation.IsScaledOverParticleLife != 0,
                heldOnLastFrame = animation.IsHeldOnLastFrame != 0,
            },
            ParticleBehaviourAcceleration acceleration => new
            {
                props,
                gravity = acceleration.EnableGravity != 0,
                affectedByZoom = acceleration.IsAffectedByZoom != 0,
            },
            ParticleBehaviourRotation rotation => new
            {
                props,
                initMode = rotation.InitRotationMode,
                updateMode = rotation.UpdateRotationMode,
                accumulate = rotation.AccumulateAngle != 0,
            },
            ParticleBehaviourSize size => new { props, proportional = size.IsProportional != 0 },
            ParticleBehaviourColour colour => new
            {
                props,
                maxEnabled = colour.RGBAMaxEnable != 0,
                proportional = colour.RGBAProportional != 0,
            },
            ParticleBehaviourTrail trail => new { props, wrapOverLife = trail.WrapTextureOverParticleLife != 0 },
            ParticleBehaviourDampening dampening => new { props, airResistance = dampening.EnableAirResistance != 0 },
            ParticleBehaviourLight light => new { props, lightType = light.LightType },
            _ => new { props },
        };
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

    /// <summary>Кадры свойств по коротким именам: <c>m_spawnRateOverTimeKFP</c> → <c>spawnRateOverTime</c>.</summary>
    private static Dictionary<string, float[][]> Props(IEnumerable<ParticleKeyframeProp?> props)
    {
        var result = new Dictionary<string, float[][]>(StringComparer.Ordinal);
        foreach (var prop in props)
        {
            if (prop is null) continue;
            var frames = Frames(prop);
            if (frames.Length == 0) continue;
            var key = ShortName(prop.Name.ToString());
            if (string.IsNullOrEmpty(key) || result.ContainsKey(key)) continue;
            result[key] = frames;
        }
        return result;
    }

    private static string ShortName(string name)
    {
        var colon = name.IndexOf(':');
        var tail = colon >= 0 ? name[(colon + 1)..] : name;
        if (tail.StartsWith("m_", StringComparison.Ordinal)) tail = tail[2..];
        if (tail.EndsWith("KFP", StringComparison.Ordinal)) tail = tail[..^3];
        return tail;
    }

    /// <summary>Кадры свойства: [время, x, y, z, w]. Обратная длина отрезка (второе число времени) сцене не нужна.</summary>
    private static float[][] Frames(ParticleKeyframeProp? prop) =>
        (prop?.Values?.data_items ?? [])
            .Where(frame => frame is not null)
            .Select(frame => new[]
            {
                Round(frame.KeyframeTime.X),
                Round(frame.KeyframeValue.X),
                Round(frame.KeyframeValue.Y),
                Round(frame.KeyframeValue.Z),
                Round(frame.KeyframeValue.W),
            })
            .ToArray();

    private static float[] Pair(float min, float max) => [Round(min), Round(max)];

    private static float Round(float value) =>
        float.IsFinite(value) ? (float)Math.Round(value, 4) : 0f;
}
