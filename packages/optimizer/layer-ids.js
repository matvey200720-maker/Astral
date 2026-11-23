/*
 * Имена слоёв оптимизации и ключи их записей — без текстов.
 *
 * Отдельно от `layers.js` нарочно: библиотеке в стартовом куске окна нужны
 * только ключи записей установки, а тексты всех слоёв на двух языках — это
 * килобайты, которые до раздела оптимизации никому не нужны.
 */

export const OPTIMIZATION_LAYER_IDS = Object.freeze([
  "grass",
  "lawn-grass",
  "retexture",
  "particles",
  "wheel-smoke",
  "litter-small",
  "litter-large",
  "street-dirt",
  "shelf-goods",
  "car-dirt",
  "decals",
  "explosion-shake",
  "drug-effects",
  /* Экран при ранении (ТЗ 17.10.2026, вечер, задачи 2 и 4). */
  "damage-screen",
  /* Эмбиент и частицы выстрелов (ТЗ 17.10.2026, задача 2). */
  "ambient",
  "ambient-region",
  "bullet-impacts",
  /* Искры и осколки при столкновениях машин (ТЗ 05.11.2026). */
  "collision-particles",
  /* Ступени «Ухудшения текстур» (задача 9): своя вкладка раздела, в наборе —
     не больше одной (`texture-levels.js`). */
  "textures-128",
  "textures-64",
  "textures-32",
  "textures-16",
]);

/*
 * Имена слоёв: их показывает библиотека в стартовом куске окна, а остальные
 * тексты (`layers.js`) нужны только разделу оптимизации.
 */
export const OPTIMIZATION_LAYER_TITLES = Object.freeze({
  grass: Object.freeze({ ru: "Мелкая трава", uk: "Дрібна трава", en: "Small grass", de: "Kleines Gras", pl: "Drobna trawa", fr: "Herbe basse" }),
  "lawn-grass": Object.freeze({ ru: "Трава на газонах и сорняки", uk: "Трава на газонах і бур'яни", en: "Lawn grass and weeds", de: "Rasengras und Unkraut", pl: "Trawa na trawnikach i chwasty", fr: "Herbe des pelouses et mauvaises herbes" }),
  retexture: Object.freeze({ ru: "Ухудшение текстур: как в моде", uk: "Погіршення текстур: як у моді", en: "Texture downgrade: as in the mod", de: "Texturverschlechterung: wie in der Mod", pl: "Pogorszenie tekstur: jak w modzie", fr: "Dégradation des textures\u00a0: comme dans le mod" }),
  particles: Object.freeze({ ru: "Частицы эффектов", uk: "Частинки ефектів", en: "Effect particles", de: "Effektpartikel", pl: "Cząsteczki efektów", fr: "Particules d'effets" }),
  "wheel-smoke": Object.freeze({ ru: "Дым из-под колёс", uk: "Дим із-під коліс", en: "Tyre smoke", de: "Reifenrauch", pl: "Dym spod kół", fr: "Fumée sous les roues" }),
  "litter-small": Object.freeze({ ru: "Мелкий мусор", uk: "Дрібне сміття", en: "Small litter", de: "Kleinmüll", pl: "Drobne śmieci", fr: "Petits déchets" }),
  "litter-large": Object.freeze({ ru: "Крупный мусор", uk: "Велике сміття", en: "Large litter", de: "Großmüll", pl: "Duże śmieci", fr: "Gros déchets" }),
  "street-dirt": Object.freeze({ ru: "Грязь на улицах", uk: "Бруд на вулицях", en: "Street grime", de: "Straßenschmutz", pl: "Brud na ulicach", fr: "Saleté dans les rues" }),
  "shelf-goods": Object.freeze({ ru: "Товары на полках", uk: "Товари на полицях", en: "Shop shelf goods", de: "Waren in den Regalen", pl: "Towary na półkach", fr: "Produits en rayon" }),
  "car-dirt": Object.freeze({ ru: "Грязь на машинах", uk: "Бруд на машинах", en: "Mud on cars", de: "Schmutz an Fahrzeugen", pl: "Brud na pojazdach", fr: "Saleté sur les voitures" }),
  decals: Object.freeze({ ru: "Следы пуль и крови", uk: "Сліди куль і крові", en: "Bullet and blood marks", de: "Einschuss- und Blutspuren", pl: "Ślady kul i krwi", fr: "Traces de balles et de sang" }),
  "explosion-shake": Object.freeze({ ru: "Тряска от взрывов", uk: "Трус від вибухів", en: "Explosion shake", de: "Explosionswackeln", pl: "Wstrząsy od wybuchów", fr: "Secousses des explosions" }),
  "drug-effects": Object.freeze({ ru: "Алко- и наркоэффекты", uk: "Алко- й наркоефекти", en: "Drunk and drug effects", de: "Alkohol- und Drogeneffekte", pl: "Efekty alkoholu i narkotyków", fr: "Effets d'alcool et de drogue" }),
  "damage-screen": Object.freeze({
    ru: "Экран при ранении",
    uk: "Екран при пораненні",
    en: "Screen when hurt",
    de: "Bildschirm bei Verletzung",
    pl: "Ekran przy zranieniu",
    fr: "Écran en cas de blessure",
  }),
  /* Тексты слоёв ТЗ 17.10.2026 — сразу на шести языках окна (ru, uk, en, de, pl, fr). */
  ambient: Object.freeze({
    ru: "Эмбиент: дым, пар, мошкара и листья",
    uk: "Ембієнт: дим, пара, мошкара й листя",
    en: "Ambience: smoke, steam, bugs and leaves",
    de: "Ambiente: Rauch, Dampf, Insekten und Laub",
    pl: "Otoczenie: dym, para, owady i liście",
    fr: "Ambiance\u00a0: fumée, vapeur, insectes et feuilles",
  }),
  "ambient-region": Object.freeze({
    ru: "Частицы в воздухе по местности",
    uk: "Частинки в повітрі за місцевістю",
    en: "Airborne particles by area",
    de: "Partikel in der Luft je nach Gegend",
    pl: "Cząsteczki w powietrzu według terenu",
    fr: "Particules dans l'air selon la zone",
  }),
  "bullet-impacts": Object.freeze({
    ru: "Частицы от попаданий пуль",
    uk: "Частинки від влучань куль",
    en: "Bullet impact particles",
    de: "Partikel bei Kugeleinschlägen",
    pl: "Cząsteczki od trafień pocisków",
    fr: "Particules d'impact des balles",
  }),
  "collision-particles": Object.freeze({
    ru: "Искры и осколки при столкновениях",
    uk: "Іскри й уламки при зіткненнях",
    en: "Collision sparks and debris",
    de: "Funken und Splitter bei Zusammenstößen",
    pl: "Iskry i odłamki przy zderzeniach",
    fr: "Étincelles et éclats lors des collisions",
  }),
  "textures-128": Object.freeze({ ru: "Ухудшение текстур: до 128 px", uk: "Погіршення текстур: до 128 px", en: "Texture downgrade: up to 128 px", de: "Texturverschlechterung: bis 128 px", pl: "Pogorszenie tekstur: do 128 px", fr: "Dégradation des textures\u00a0: jusqu'à 128 px" }),
  "textures-64": Object.freeze({ ru: "Ухудшение текстур: до 64 px", uk: "Погіршення текстур: до 64 px", en: "Texture downgrade: up to 64 px", de: "Texturverschlechterung: bis 64 px", pl: "Pogorszenie tekstur: do 64 px", fr: "Dégradation des textures\u00a0: jusqu'à 64 px" }),
  "textures-32": Object.freeze({ ru: "Ухудшение текстур: до 32 px", uk: "Погіршення текстур: до 32 px", en: "Texture downgrade: up to 32 px", de: "Texturverschlechterung: bis 32 px", pl: "Pogorszenie tekstur: do 32 px", fr: "Dégradation des textures\u00a0: jusqu'à 32 px" }),
  "textures-16": Object.freeze({ ru: "Ухудшение текстур: до 16 px", uk: "Погіршення текстур: до 16 px", en: "Texture downgrade: up to 16 px", de: "Texturverschlechterung: bis 16 px", pl: "Pogorszenie tekstur: do 16 px", fr: "Dégradation des textures\u00a0: jusqu'à 16 px" }),
});

/**
 * Текст под язык окна: русский и английский написаны у всех, у слоёв ТЗ
 * 17.10.2026 — все шесть языков; где языка нет, читается английский (как у
 * переключателей раздела).
 */
export function layerText(field, locale = "ru") {
  if (!field) return "";
  return field[locale] || field.en || field.ru || "";
}

/** Имя слоя под язык окна. */
export const optimizationLayerTitle = (layerId, locale = "ru") =>
  layerText(OPTIMIZATION_LAYER_TITLES[layerId], locale) || layerId;

/** Ключ записи установки слоя в хранилище окна. */
export const optimizationLayerRecordKey = (layerId) =>
  `astral.optimization.${layerId}.install.v1`;

export const OPTIMIZATION_LAYER_RECORD_KEYS = Object.freeze(
  OPTIMIZATION_LAYER_IDS.map(optimizationLayerRecordKey),
);

/** Запись установки набора слоёв (задача 8): все включённые слои одним пакетом. */
export const OPTIMIZATION_SET_RECORD_KEY = "astral.optimization.set.install.v1";

/*
 * Запись установки «Ухудшения текстур» (задача 1 ТЗ 05.10.2026): ступень —
 * свой пакет дополнения `astral_textures`, а не слой набора.
 */
export const OPTIMIZATION_TEXTURES_RECORD_KEY = "astral.optimization.textures.install.v1";

/*
 * Запись установки «Дальности прорисовки» (задача 7 ТЗ 06.10.2026): свой
 * пакет движка — модификатор таймцикла и карта с его коробкой.
 */
export const OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY = "astral.optimization.draw-distance.install.v1";

/** Все записи оптимизации в хранилище окна: набор, ступень текстур, дальность и прежние записи слоёв. */
export const OPTIMIZATION_RECORD_KEYS = Object.freeze([
  ...OPTIMIZATION_LAYER_RECORD_KEYS,
  OPTIMIZATION_SET_RECORD_KEY,
  OPTIMIZATION_TEXTURES_RECORD_KEY,
  OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY,
]);

/** Контейнер слоя в `update.rpf`: имена — строчными, игра ищет так. */
export const optimizationContainer = (layerId) =>
  `x64/astral/astral_opt_${String(layerId).replace(/-/g, "_")}.rpf`;
