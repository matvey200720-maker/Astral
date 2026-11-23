/*
 * Текстуры сцены по содержимому (31.10.2026, ТЗ владельца: «выбрал другую модель — быстро отобразилась на персонаже»).
 *
 * Замер (`scripts/perf/baseline/wear-variant.mjs`, закрытая сборка, ×4): после ответа Desktop окно тратит на смену варианта 0,8–1,7 с главного потока. GLB персонажа несёт 12 картинок
 * (диффуз и нормаль у шести материалов), из них 10 не меняются — тело (голова, причёска, торс), низ и обувь, — а окно разбирало все заново и заливало в видеочип (Blob и
 * ImageBitmap на картинку, `uploadTexture`, `texSubImage2D`). Desktop кладёт в `extras` каждой картинки ключ содержимого (`astralKey`, `imageContentKey` в `rage-drawable/glb.js`);
 * здесь сцена по этому ключу узнаёт текстуру, уже стоящую в видеочипе, и отдаёт её новой модели вместо разбора.
 *
 * Как устроено. `GLTFLoader` получает плагин (`textureReusePlugin`): `loadTexture` отдаёт готовую текстуру по ключу, а `afterRoot` запоминает загруженные новые. Текстуры считаются по
 * ссылкам: каждая загрузка модели держит набор ключей (`token`), модель ушла — `release(token)` снимает ссылки, и текстура без ссылок освобождается (`dispose`). Новая модель
 * берёт ссылки ДО того, как уходит прежняя (`gun-scene.js`, `load`), поэтому общие текстуры не перезаливаются. Кэш принадлежит одной сцене; `dispose()` освобождает всё, что осталось
 * (то же, что делала сцена с текстурами модели). Модели без ключей (оружие, интерьеры, вещи из кэша старой сборки) идут прежним путём: плагин ничего не берёт и не запоминает.
 * Общую текстуру нельзя освобождать `texture.dispose()` напрямую — `disposeTexture` отдаёт её кэшу.
 */

/** Роли текстур в материалах GLB: номер текстуры → буквы ролей (диффуз, нормаль, свечение...). Картинка с теми же байтами в другой роли — другая текстура: у роли свой цветовой режим. */
function usagesOf(json) {
  const roles = new Map();
  const add = (reference, letter) => {
    if (!Number.isInteger(reference?.index)) return;
    if (!roles.has(reference.index)) roles.set(reference.index, new Set());
    roles.get(reference.index).add(letter);
  };
  for (const material of json.materials || []) {
    const pbr = material.pbrMetallicRoughness || {};
    add(pbr.baseColorTexture, "b");
    add(pbr.metallicRoughnessTexture, "r");
    add(material.normalTexture, "n");
    add(material.occlusionTexture, "o");
    add(material.emissiveTexture, "e");
  }
  return roles;
}

/** Ключ текстуры в кэше: содержимое картинки, сэмплер (повторение и фильтры входят в текстуру) и роль в материале. */
function keyOfDefinition(json, textureIndex, usages) {
  const definition = json.textures?.[textureIndex];
  const source = definition ? json.images?.[definition.source] : null;
  const content = source?.extras?.astralKey;
  if (!content) return "";
  const role = [...(usages.get(textureIndex) || [])].sort().join("");
  return `${content}:${definition.sampler ?? ""}:${role}`;
}

export function createTextureCache() {
  const entries = new Map();

  const owns = (texture) => {
    const key = texture?.userData?.astralTextureKey;
    return Boolean(key) && entries.get(key)?.texture === texture;
  };

  return {
    /** Набор ссылок одной загрузки модели. */
    begin: () => ({ keys: new Set(), released: false }),

    /** Готовая текстура по ключу (и ссылка на неё за этой загрузкой), `null` — такой нет. */
    take(token, key) {
      const entry = entries.get(key);
      if (!entry || token.released) return null;
      if (!token.keys.has(key)) {
        token.keys.add(key);
        entry.refs += 1;
      }
      return entry.texture;
    },

    /** Загруженная заново текстура становится общей: ссылка за этой загрузкой. Ключ уже занят другой текстурой — эта остаётся «личной» и освобождается как раньше. */
    put(token, key, texture) {
      if (token.released) return false;
      const known = entries.get(key);
      if (known && known.texture !== texture) return false;
      if (!known) {
        texture.userData.astralTextureKey = key;
        entries.set(key, { texture, refs: 0 });
      }
      if (!token.keys.has(key)) {
        token.keys.add(key);
        entries.get(key).refs += 1;
      }
      return true;
    },

    /** Загрузка (или модель) ушла: ссылки сняты; текстуры без ссылок освобождены. Повторный вызов ничего не делает. */
    release(token) {
      if (!token || token.released) return;
      token.released = true;
      for (const key of token.keys) {
        const entry = entries.get(key);
        if (!entry) continue;
        entry.refs -= 1;
        if (entry.refs <= 0) {
          entries.delete(key);
          entry.texture.dispose?.();
        }
      }
      token.keys.clear();
    },

    owns,

    /** Освободить текстуру, не трогая общую: у общей свой счёт ссылок. */
    disposeTexture(texture) {
      if (!texture || owns(texture)) return;
      texture.dispose?.();
    },

    /** Сцена уходит: освободить всё. */
    dispose() {
      for (const entry of entries.values()) entry.texture.dispose?.();
      entries.clear();
    },

    /** Сколько текстур сейчас общих (тесты и стенд). */
    get size() {
      return entries.size;
    },
  };
}

/**
 * Плагин `GLTFLoader` (`loader.register(textureReusePlugin(cache, token))`): на каждый разбор — свой экземпляр. Для картинок с ключом отдаёт готовую текстуру и запоминает новые.
 */
export function textureReusePlugin(cache, token) {
  return (parser) => {
    let usages = null;
    const keyOf = (textureIndex) => keyOfDefinition(parser.json, textureIndex, (usages ||= usagesOf(parser.json)));
    return {
      name: "ASTRAL_texture_reuse",
      loadTexture(textureIndex) {
        const key = keyOf(textureIndex);
        if (!key) return null;
        const texture = cache.take(token, key);
        if (!texture) return null;
        parser.associations.set(texture, { textures: textureIndex });
        return Promise.resolve(texture);
      },
      async afterRoot() {
        const loaded = await Promise.all(Object.values(parser.textureCache || {}));
        for (const texture of loaded) {
          const index = parser.associations.get(texture)?.textures;
          const key = index === undefined ? "" : keyOf(index);
          if (key && !texture.userData.astralTextureKey) cache.put(token, key, texture);
        }
      },
    };
  };
}
