using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

/*
 * СЛОВАРЬ-ДОНОР СВОИХ ПРАВИЛ АВТОРА — «наш Core», этап 2 (Хелпер 20, 29.10.2026).
 *
 * Бывает, что редукс рисует кровь не штатными правилами, а своими (blink_skye:
 * `mirz_*`, `drain_red`) со своими листами. Ядро автора целиком — файл
 * Rockstar, его не раздаём. Из него собирается маленький словарь: только
 * названные свои правила эффектов, их эмиттеры и частицы и текстуры, которые
 * эти частицы рисуют. Свои листы автора остаются с пикселями; листы игры
 * (имена из штатного ядра) — той же раскладки, но пустые: при установке клон
 * берёт лист под тем же именем из ядра игрока (`YptEffectClones`, чужой
 * словарь), и пиксели Rockstar в словарь не попадают.
 *
 * Модели и порождаемые эффекты в своих частицах не переносятся (клон из
 * чужого словаря их не берёт) — такой словарь не собирается, отказ называет
 * правило.
 */
internal static class YptOwnDonor
{
    internal static object Build(YptFile ypt, IReadOnlyList<string> effectNames, IReadOnlyCollection<string> ownTextures)
    {
        if (effectNames.Count == 0 || effectNames.Count > 64)
            throw new InvalidDataException("YPT own donor needs 1…64 effect rules.");
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        // Порядок словарей ядра автора не проверяется: чужие инструменты пишут их не по хешам (lovershade).
        // Словари донора собираются заново и сортируются — сверка в конце.
        var own = new HashSet<string>(ownTextures, StringComparer.OrdinalIgnoreCase);
        var effects = new HashSet<ParticleEffectRule>(ReferenceEqualityComparer.Instance);
        var emitters = new HashSet<ParticleEmitterRule>(ReferenceEqualityComparer.Instance);
        var particles = new HashSet<ParticleRule>(ReferenceEqualityComparer.Instance);
        var textures = new HashSet<Texture>(ReferenceEqualityComparer.Instance);
        foreach (var name in effectNames)
        {
            var effect = (list.EffectRuleDictionary?.EffectRules?.data_items ?? [])
                .SingleOrDefault(item => string.Equals(item?.Name?.Value, name, StringComparison.Ordinal))
                ?? throw new InvalidDataException($"YPT own effect rule does not exist: {name}");
            effects.Add(effect);
            var events = effect.EventEmitters?.data_items ?? [];
            for (var index = 0; index < Math.Min(effect.EventEmittersCount, events.Length); index += 1)
            {
                if (events[index] is not { } item) continue;
                if (item.EmitterRule is { } emitter) emitters.Add(emitter);
                if (item.ParticleRule is not { } particle) continue;
                particles.Add(particle);
                if ((particle.Drawables?.data_items ?? []).Any(drawable => drawable?.Drawable is not null))
                    throw new InvalidDataException($"YPT own effect {name} draws models; only sprite effects can be carried.");
                // Клон из чужого словаря порождаемых эффектов не берёт — такой донор не собрать.
                if ((particle.EffectSpawnerAtRatio?.EffectRule ?? particle.EffectSpawnerOnCollision?.EffectRule) is { } spawned)
                    throw new InvalidDataException($"YPT own effect {name} spawns effect {spawned.Name?.Value}; only self-contained effects can be carried.");
                foreach (var variable in (particle.ShaderVars?.data_items ?? []).OfType<ParticleShaderVarTexture>())
                    if (variable.Texture is { } texture) textures.Add(texture);
            }
        }

        var effectDictionary = list.EffectRuleDictionary!;
        (effectDictionary.EffectRuleNameHashes!.data_items, effectDictionary.EffectRules!.data_items) =
            Kept(effectDictionary.EffectRuleNameHashes.data_items, effectDictionary.EffectRules.data_items, effects.Contains, "effect");
        var emitterDictionary = list.EmitterRuleDictionary!;
        (emitterDictionary.EmitterRuleNameHashes!.data_items, emitterDictionary.EmitterRules!.data_items) =
            Kept(emitterDictionary.EmitterRuleNameHashes.data_items, emitterDictionary.EmitterRules.data_items, emitters.Contains, "emitter");
        var particleDictionary = list.ParticleRuleDictionary!;
        (particleDictionary.ParticleRuleNameHashes!.data_items, particleDictionary.ParticleRules!.data_items) =
            Kept(particleDictionary.ParticleRuleNameHashes.data_items, particleDictionary.ParticleRules.data_items, particles.Contains, "particle");

        var kept = (list.TextureDictionary?.Textures?.data_items ?? []).Where(textures.Contains).ToList();
        var blanked = new List<string>();
        foreach (var texture in kept)
        {
            if (own.Contains(texture.Name ?? string.Empty)) continue;
            // Лист игры: раскладка остаётся (её читает клон), пикселей Rockstar нет.
            if (texture.Data?.FullData is { } data) Array.Clear(data);
            blanked.Add(texture.Name ?? string.Empty);
        }
        list.TextureDictionary!.BuildFromTextureList(kept);
        YptSlotReservations.VerifyGraph(ypt, []);
        return new
        {
            effects = effects.Select(item => item.Name?.Value).OrderBy(name => name, StringComparer.Ordinal).ToArray(),
            emitters = emitters.Count,
            particles = particles.Count,
            ownTextures = kept.Select(item => item.Name).Where(name => own.Contains(name ?? string.Empty)).OrderBy(name => name, StringComparer.Ordinal).ToArray(),
            gameTextures = blanked.OrderBy(name => name, StringComparer.Ordinal).ToArray(),
        };
    }

    /// <summary>
    /// Хеши словаря фильтруются вместе с записями (у штатных записей хеш словаря может не совпадать с именем) и
    /// сортируются парами по хешу: игра ищет в словаре двоичным поиском.
    /// </summary>
    private static (MetaHash[] Hashes, T[] Items) Kept<T>(MetaHash[] hashes, T[] items, Func<T, bool> keep, string kind)
    {
        if (hashes.Length != items.Length)
            throw new InvalidDataException($"YPT {kind} rule dictionary is inconsistent.");
        var kept = new List<(MetaHash Hash, T Item)>();
        for (var index = 0; index < items.Length; index += 1)
            if (keep(items[index])) kept.Add((hashes[index], items[index]));
        kept.Sort((left, right) => left.Hash.Hash.CompareTo(right.Hash.Hash));
        for (var index = 1; index < kept.Count; index += 1)
            if (kept[index].Hash.Hash == kept[index - 1].Hash.Hash)
                throw new InvalidDataException($"YPT own donor {kind} dictionary has a duplicate hash.");
        return (kept.Select(item => item.Hash).ToArray(), kept.Select(item => item.Item).ToArray());
    }
}
