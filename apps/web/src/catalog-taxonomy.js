
import { tr } from "./locales/ui.js";
import { WEAPONS, studioSlotOf } from "@modovik/rpf-inspector/weapon-identity";
export const catalogSections = [
  {
    id: "redux",
    labels: { ru: "Редуксы", uk: "Редукси", en: "Redux", de: "Redux", pl: "Redux", fr: "Redux" },
  },
  {
    id: "gunpacks",
    labels: {
      ru: "Ганпаки", uk: "Ганпаки",
      en: "Gunpacks",
      de: "Waffenpacks",
      pl: "Paczki broni",
      fr: "Gunpacks",
    },
  },
  {
    id: "clothing",
    labels: {
      ru: "Одежда", uk: "Одяг",
      en: "Clothing",
      de: "Kleidung",
      pl: "Ubrania",
      fr: "Vêtements",
    },
  },
  {
    id: "optimization",
    labels: {
      ru: "Оптимизация", uk: "Оптимізація",
      en: "Optimization",
      de: "Optimierung",
      pl: "Optymalizacja",
      fr: "Optimisation",
    },
  },
  {
    id: "other",
    labels: { ru: "Другое", uk: "Інше", en: "Other", de: "Andere", pl: "Inne", fr: "Autre" },
  },
  {
    id: "optimization",
    labels: {
      ru: "Оптимизация", uk: "Оптимізація",
      en: "Optimization",
      de: "Optimierung",
      pl: "Optymalizacja",
      fr: "Optimisation",
    },
  },
  {
    id: "settings",
    labels: {
      ru: "Настройки", uk: "Налаштування",
      en: "Settings",
      de: "Einstellungen",
      pl: "Ustawienia",
      fr: "Paramètres",
    },
  },
];

const workshopWeaponTypeLabels = {
  shotgun: { ru: "Дробовик", en: "Shotgun", fr: "Fusil de chasse" },
  pistol: { ru: "Пистолет", en: "Pistol", fr: "Pistolet" },
  smg: { ru: "ПП", en: "SMG", fr: "SMG" },
  assault: { ru: "Штурмовая винтовка", en: "Assault rifle", fr: "Fusil d'assaut" },
  sniper: { ru: "Снайперская винтовка", en: "Sniper rifle", fr: "Fusil de précision" },
  machinegun: { ru: "Пулемёт", en: "Machine gun", fr: "Mitrailleuse" },
  launcher: { ru: "Тяжёлое оружие", en: "Heavy weapon", fr: "Arme lourde" },
  /* Ближний бой и метательное (задача 6 ТЗ 17.10.2026) — модели из игры. */
  melee: { ru: "Ближний бой", en: "Melee", fr: "Corps à corps" },
  thrown: { ru: "Метательное", en: "Throwable", fr: "Arme de jet" },
};

/* `game-v1` — кадр и модель собраны из игры (`build-game-weapon-showcase.mjs`):
   `_hi`, штатный магазин на своей кости, оттенок палитры по умолчанию. */
const workshopWeaponAssetRevisions = Object.freeze({
  carabine_reh: "studio-v5",
  "carbine-rifle-mk2": "studio-v3",
  "heavy-sniper-mk2": "studio-v4",
  "smg-mk2": "game-v1",
  "special-carbine-mk2": "studio-v4",
  "stun-gun": "gta-textures-v1",
  pistol: "game-v1",
  "combat-pistol": "game-v1",
  "ap-pistol": "game-v1",
  "pistol-mk2": "game-v1",
  "pistol-50": "game-v1",
});
const workshopWeaponCatalogRevision = "catalog-v6";
/* 3D-модели всех стволов полки с 04.10.2026 собраны из игры
   (`build-game-weapon-showcase.mjs --model-only`): детали названы
   текстурами игры, магазин на своей кости, оттенок палитры — покраска в
   студии ложится в те же текстуры, что видит игра. `game-v2` — надписи
   оружия (ТЗ 12.10.2026, ночь): модели полки пересобраны без заводских
   надписей (`@modovik/gunpack/inscriptions`); `game-v3` — нарисованные
   надписи закрыты фактурой, кадры полки пересняты (13.10.2026). */
const workshopWeaponModelRevision = "game-v3";

const workshopWeapon = (id, family, type, ru, en) => {
  const revision =
    workshopWeaponAssetRevisions[id] || workshopWeaponCatalogRevision;

  return {
    id,
    family,
    image: `/assets/catalog/weapons/${id}.webp?v=${revision}`,
    model: `/assets/catalog/weapons-3d/${id}.glb?v=${workshopWeaponModelRevision}`,
    labels: { ru, en },
    types: workshopWeaponTypeLabels[type],
    ru,
    type: workshopWeaponTypeLabels[type].ru,
  };
};

export const weaponCatalogSlots = [
  // GTA Online usage order reconstructed from the supplied in-game recording.
  workshopWeapon(
    "heavy-pistol",
    "pistol",
    "pistol",
    "Тяжёлый пистолет",
    "Heavy Pistol",
  ),
  workshopWeapon("revolver", "pistol", "pistol", "Револьвер", "Heavy Revolver"),
  workshopWeapon("stun-gun", "pistol", "pistol", "Тазер", "Stun Gun"),
  /* Обычные пистолеты — с ними на RP-серверах ходят чаще всего. Кадр и
     модель собраны из игры на Windows (`build-game-weapon-showcase.mjs`). */
  workshopWeapon("pistol", "pistol", "pistol", "Пистолет", "Pistol"),
  workshopWeapon(
    "combat-pistol",
    "pistol",
    "pistol",
    "Боевой пистолет",
    "Combat Pistol",
  ),
  workshopWeapon(
    "ap-pistol",
    "pistol",
    "pistol",
    "Автоматический пистолет",
    "AP Pistol",
  ),
  workshopWeapon("pistol-mk2", "pistol", "pistol", "Пистолет MK2", "Pistol MK2"),
  workshopWeapon("pistol-50", "pistol", "pistol", "Пистолет .50", "Pistol .50"),
  workshopWeapon(
    "carbine-rifle",
    "rifle",
    "assault",
    "Карабинная винтовка",
    "Carbine Rifle",
  ),
  /* Служебный карабин (WEAPON_TACTICALRIFLE, модель w_ar_carbinerifle_reh):
     имя — как в опознании стволов (`weapon-identity.js`), id прежний. */
  workshopWeapon(
    "carabine_reh",
    "rifle",
    "assault",
    "Служебный карабин",
    "Service Carbine",
  ),
  workshopWeapon(
    "carbine-rifle-mk2",
    "rifle",
    "assault",
    "Карабинная винтовка MK2",
    "Carbine Rifle MK2",
  ),
  workshopWeapon(
    "assault-rifle",
    "rifle",
    "assault",
    "Штурмовая винтовка",
    "Assault Rifle",
  ),
  workshopWeapon(
    "bullpup-rifle",
    "rifle",
    "assault",
    "Булл-пап винтовка",
    "Bullpup Rifle",
  ),
  workshopWeapon(
    "special-carbine",
    "rifle",
    "assault",
    "Специальный карабин",
    "Special Carbine",
  ),
  workshopWeapon(
    "special-carbine-mk2",
    "rifle",
    "assault",
    "Спец. карабин MK2",
    "Special Carbine MK2",
  ),
  workshopWeapon(
    "pump-shotgun",
    "shotgun",
    "shotgun",
    "Помповый дробовик",
    "Pump Shotgun",
  ),
  workshopWeapon(
    "assault-shotgun",
    "shotgun",
    "shotgun",
    "Штурмовой дробовик",
    "Assault Shotgun",
  ),
  workshopWeapon(
    "heavy-sniper",
    "sniper",
    "sniper",
    "Тяжёлая снайперская винтовка",
    "Heavy Sniper",
  ),
  workshopWeapon(
    "heavy-sniper-mk2",
    "sniper",
    "sniper",
    "Тяжёлая снайперская MK2",
    "Heavy Sniper MK2",
  ),
  workshopWeapon(
    "marksman-rifle",
    "sniper",
    "sniper",
    "Марксманская винтовка",
    "Marksman Rifle",
  ),
  workshopWeapon(
    "advanced-rifle",
    "rifle",
    "assault",
    "Улучшенная винтовка",
    "Advanced Rifle",
  ),
  workshopWeapon(
    "combat-mg",
    "machinegun",
    "machinegun",
    "Боевой пулемёт",
    "Combat MG",
  ),
  workshopWeapon("combat-pdw", "smg", "smg", "Боевой PDW", "Combat PDW"),
  workshopWeapon("smg-mk2", "smg", "smg", "ПП MK2", "SMG MK2"),
  workshopWeapon("smg", "smg", "smg", "Пистолет-пулемёт", "SMG"),
  workshopWeapon("mini-smg", "smg", "smg", "Мини ПП", "Mini SMG"),
  workshopWeapon("micro-smg", "smg", "smg", "Микро ПП", "Micro SMG"),
  workshopWeapon("assault-smg", "smg", "smg", "Штурмовой ПП", "Assault SMG"),
  workshopWeapon(
    "heavy-shotgun",
    "shotgun",
    "shotgun",
    "Тяжёлый дробовик",
    "Heavy Shotgun",
  ),
  workshopWeapon(
    "bullpup-shotgun",
    "shotgun",
    "shotgun",
    "Булл-пап дробовик",
    "Bullpup Shotgun",
  ),
  workshopWeapon(
    "double-barrel-shotgun",
    "shotgun",
    "shotgun",
    "Двуствольный дробовик",
    "Double Barrel Shotgun",
  ),
  workshopWeapon(
    "sawed-off-shotgun",
    "shotgun",
    "shotgun",
    "Обрез",
    "Sawed-Off Shotgun",
  ),
  workshopWeapon(
    "sniper-rifle",
    "sniper",
    "sniper",
    "Снайперская винтовка",
    "Sniper Rifle",
  ),
  workshopWeapon("mg", "machinegun", "machinegun", "Пулемёт", "MG"),
  workshopWeapon(
    "gusenberg-sweeper",
    "machinegun",
    "machinegun",
    "Автомат Гузенберга",
    "Gusenberg Sweeper",
  ),
  workshopWeapon(
    "grenade-launcher",
    "launcher",
    "launcher",
    "Гранатомёт",
    "Grenade Launcher",
  ),
];

export const weaponModelAssets = Object.fromEntries(
  weaponCatalogSlots.map((slot) => [slot.id, slot.model]),
);

/*
 * Стволы без кадра в поставке. Витринная модель и рендер собираются из игры
 * на Windows (`scripts/build-game-weapon-showcase.mjs`); пока их нет,
 * мастерская берёт модель из игры самого игрока через Astral Desktop, а
 * плитка снимает кадр с неё сама (`useGameWeaponPreview`) и говорит словами,
 * если модель не прочиталась — рисунка вместо кадра из игры здесь нет. Когда
 * кадр придёт, ствол переезжает в `weaponCatalogSlots` через `workshopWeapon`.
 *
 * Подписи переводятся при чтении (геттеры), а не при загрузке модуля: тогда
 * язык ещё русский.
 */
const gameWeapon = (id, family, type, ru, en) => ({
  id,
  family,
  image: "",
  model: "",
  fromGame: true,
  labels: {
    ru,
    /* Английское имя — своё, если оно есть; иначе — перевод. */
    get en() {
      return en || tr(ru);
    },
    get uk() {
      return tr(ru);
    },
    get de() {
      return tr(ru);
    },
    get pl() {
      return tr(ru);
    },
    get fr() {
      return tr(ru);
    },
  },
  types: workshopWeaponTypeLabels[type],
  note: {
    get ru() {
      return tr("Модель — из вашей игры");
    },
    get uk() {
      return tr("Модель — из вашей игры");
    },
    en: "Model from your game",
    get de() {
      return tr("Модель — из вашей игры");
    },
    get pl() {
      return tr("Модель — из вашей игры");
    },
    get fr() {
      return tr("Модель — из вашей игры");
    },
  },
  ru,
  type: workshopWeaponTypeLabels[type].ru,
});

/* Семейство ствола → вид подписи плитки. */
const TYPE_OF_FAMILY = Object.freeze({
  pistol: "pistol",
  smg: "smg",
  rifle: "assault",
  shotgun: "shotgun",
  sniper: "sniper",
  machinegun: "machinegun",
  launcher: "launcher",
  melee: "melee",
  thrown: "thrown",
});

/*
 * Стволы только из игры игрока (задача 6 ТЗ 17.10.2026: «увеличить
 * редактор ганов… ближнего боя и мк2 и т.д.»): все стволы таблицы оружия
 * (`weapon-identity.js`), у которых нет кадра в поставке, — остальные
 * пистолеты и винтовки, все MK2, тяжёлое, холодное и метательное. Полка —
 * слот ствола в каталоге (`studioSlotOf`): моды каталога этого ствола и его
 * скин лежат в одном месте. Модель достаёт Astral Desktop из игры игрока,
 * иконку — меню паузы самой игры (`useGameWeaponIcons`).
 */
const bundledShelves = new Set(weaponCatalogSlots.map((slot) => slot.id));
const asciiName = (value) => (/^[ -~]+$/.test(String(value || "")) ? value : "");
export const weaponGameSlots = WEAPONS.filter(
  (weapon) => !bundledShelves.has(studioSlotOf(weapon)) && TYPE_OF_FAMILY[weapon.family],
).map((weapon) =>
  gameWeapon(
    studioSlotOf(weapon),
    weapon.family,
    TYPE_OF_FAMILY[weapon.family],
    weapon.name,
    asciiName(weapon.catalog),
  ),
);
export { gameWeapon };

/**
 * Полка оружия мастерской: стволы с кадром в поставке и стволы из игры.
 * Стволы из игры стоят сразу за стволами своего семейства с кадром — полка
 * идёт по семействам; ближний бой и метательное — в конце.
 */
export const workshopWeaponSlots = (() => {
  const shelf = [...weaponCatalogSlots];
  for (const slot of weaponGameSlots) {
    const after = shelf.findLastIndex((item) => item.family === slot.family);
    shelf.splice(after < 0 ? shelf.length : after + 1, 0, slot);
  }
  return shelf;
})();

const landingSlot = (id, title, description, assets = {}) => ({
  id,
  title,
  description,
  ...assets,
});

/* Карточки лицом в камеру (ТЗ 04.10.2026, задача 5): новые снимки и модели. */
const clothingAssetRevision = "cards-front-v10";
const localClothingAssetsEnabled =
  import.meta.env?.VITE_ASTRAL_LOCAL_CLOTHING_ASSETS === "1";

const clothingLandingSlot = (id, title, description) => {
  /* У сумок теперь свой знак. Раньше его не нарисовали, и карточка брала
     чужой: в сетке стояли две одинаковые картинки под разными именами. */
  const fallbackImage = `/assets/catalog/clothing/${id}.svg`;
  const localAssets = localClothingAssetsEnabled
    ? {
        image: `/assets/catalog/clothing-local/${id}.png?v=${clothingAssetRevision}`,
        model: `/assets/catalog/clothing-local/${id}.glb?v=${clothingAssetRevision}`,
        fallbackImage,
      }
    : { image: fallbackImage };

  return landingSlot(id, title, description, localAssets);
};

export const catalogLandingSlots = {
  redux: [
    landingSlot(
      "redux-pack",
      {
        ru: "Готовые редуксы", uk: "Готові редукси",
        en: "Redux packs",
        de: "Redux-Pakete",
        pl: "Paczki Redux",
        fr: "Redux prêts à l'emploi",
      },
      {
        ru: "Полные визуальные сборки", uk: "Повні візуальні збірки",
        en: "Complete visual packs",
        de: "Komplette Grafikpakete",
        pl: "Kompletne pakiety graficzne",
        fr: "Builds visuels complets",
      },
    ),
    landingSlot(
      "minimap",
      { ru: "Мини-карта", uk: "Міні-карта", en: "Minimap", de: "Minikarte", pl: "Minimapa", fr: "Minicarte" },
      {
        ru: "Форма и оформление радара", uk: "Форма й оформлення радара",
        en: "Radar shape and style",
        de: "Form und Stil des Radars",
        pl: "Kształt i styl radaru",
        fr: "Forme et style du radar",
      },
    ),
    landingSlot(
      "minimap-zoom",
      {
        ru: "Отдаление мини-карты", uk: "Віддалення міні-карти",
        en: "Minimap zoom",
        de: "Minikarten-Zoom",
        pl: "Oddalenie minimapy",
        fr: "Dézoom de la minicarte",
      },
      {
        ru: "Масштаб и дальность обзора радара", uk: "Масштаб і дальність огляду радара",
        en: "Radar scale and viewing distance",
        de: "Maßstab und Sichtweite des Radars",
        pl: "Skala i zasięg widoku radaru",
        fr: "Échelle et portée de vue du radar",
      },
    ),
    landingSlot(
      "minimap-position",
      {
        ru: "Положение мини-карты", uk: "Положення міні-карти",
        en: "Minimap position",
        de: "Minikartenposition",
        pl: "Pozycja minimapy",
        fr: "Position de la minicarte",
      },
      {
        ru: "Позиция и отступы радара на экране", uk: "Позиція і відступи радара на екрані",
        en: "Radar position and screen offsets",
        de: "Position und Bildschirmabstände des Radars",
        pl: "Pozycja i odstępy radaru na ekranie",
        fr: "Position et marges du radar à l'écran",
      },
    ),
    /* «Метки и GPS» (плитка `blips`) убрана с полки — владелец, ТЗ 11.10.2026
       (утро), задача 1: метка и маршрут — инструменты мини-карты. Слот жив в
       реестре редакторов (`STUDIO_SLOTS.blips` открывает мини-карту на «Метке
       GPS») и в библиотеке (`RECORD_KEYS.blips`): прежние установки снимаются,
       работы открываются в мини-карте. */
    landingSlot(
      "large-map",
      {
        ru: "Большая карта", uk: "Велика карта",
        en: "World map",
        de: "Weltkarte",
        pl: "Mapa świata",
        fr: "Grande carte",
      },
      {
        ru: "Зоны, обозначения, цвет и своя эмблема", uk: "Зони, позначення, колір і власна емблема",
        en: "Zones, labels, colours and your own emblem",
        de: "Zonen, Beschriftungen, Farben und eigenes Emblem",
        pl: "Strefy, oznaczenia, kolory i własny emblemat",
        fr: "Zones, légendes, couleur et emblème personnalisé",
      },
    ),
    landingSlot(
      "large-map-zoom",
      {
        ru: "Отдаление большой карты", uk: "Віддалення великої карти",
        en: "World map zoom",
        de: "Weltkarten-Zoom",
        pl: "Oddalenie dużej mapy",
        fr: "Dézoom de la grande carte",
      },
      {
        ru: "Масштаб и уровни приближения карты мира", uk: "Масштаб і рівні наближення карти світу",
        en: "World map scale and zoom levels",
        de: "Maßstab und Zoomstufen der Weltkarte",
        pl: "Skala i poziomy zbliżenia mapy świata",
        fr: "Échelle et niveaux de zoom de la carte du monde",
      },
    ),
    /* Шрифты — тексты самой игры: меню, подсказки, уведомления, деньги. */
    landingSlot(
      "fonts",
      { ru: "Шрифты", uk: "Шрифти", en: "Fonts", de: "Schriften", pl: "Czcionki", fr: "Polices" },
      {
        ru: "Свой шрифт в текстах игры", uk: "Власний шрифт у текстах гри",
        en: "Your font in game texts",
        de: "Eigene Schrift in Spieltexten",
        pl: "Własna czcionka w tekstach gry",
        fr: "Police personnalisée dans les textes du jeu",
      },
    ),
    landingSlot(
      "roads",
      { ru: "Дороги", uk: "Дороги", en: "Roads", de: "Straßen", pl: "Drogi", fr: "Routes" },
      {
        ru: "Покрытие и разметка", uk: "Покриття і розмітка",
        en: "Surfaces and markings",
        de: "Belag und Markierungen",
        pl: "Nawierzchnia i oznakowanie",
        fr: "Revêtement et marquage",
      },
    ),
    landingSlot(
      "timecycle",
      { ru: "Таймциклы", uk: "Таймцикли", en: "Timecycles", de: "Timecycles", pl: "Timecycle", fr: "Timecycles" },
      {
        ru: "Погода, свет и атмосфера", uk: "Погода, світло й атмосфера",
        en: "Weather, light and atmosphere",
        de: "Wetter, Licht und Atmosphäre",
        pl: "Pogoda, światło i atmosfera",
        fr: "Météo, lumière et ambiance",
      },
    ),
    landingSlot(
      "vegetation",
      {
        ru: "Растительность", uk: "Рослинність",
        en: "Vegetation",
        de: "Vegetation",
        pl: "Roślinność",
        fr: "Végétation",
      },
      {
        ru: "Листва, кусты, цветы и времена года", uk: "Листя, кущі, квіти і пори року",
        en: "Leaves, bushes, flowers and seasons",
        de: "Laub, Büsche, Blumen und Jahreszeiten",
        pl: "Liście, krzewy, kwiaty i pory roku",
        fr: "Feuillage, buissons, fleurs et saisons",
      },
    ),
    landingSlot(
      "arenas",
      { ru: "Арены", uk: "Арени", en: "Arenas", de: "Arenen", pl: "Areny", fr: "Arènes" },
      {
        ru: "Арены GTA 5 RP и Majestic", uk: "Арени GTA 5 RP і Majestic",
        en: "GTA 5 RP and Majestic arenas",
        de: "Arenen GTA 5 RP und Majestic",
        pl: "Areny GTA 5 RP i Majestic",
        fr: "Arènes GTA 5 RP et Majestic",
      },
    ),
    /* Davis Mega Mall — фасады, эмблемы и вывеска торгового центра; правка
       мира, как Ашан, поэтому стоит рядом с ареной, а не с интерьерами. */
    landingSlot(
      "mega-mall",
      {
        ru: "Мегамолл", uk: "Мегамолл",
        en: "Mega Mall",
        de: "Mega Mall",
        pl: "Mega Mall",
        fr: "Mega Mall",
      },
      {
        ru: "Надписи и цвет Davis Mega Mall", uk: "Написи й колір Davis Mega Mall",
        en: "Davis Mega Mall signs and colour",
        de: "Davis Mega Mall: Schilder, Farbe",
        pl: "Napisy i kolory Davis Mega Mall",
        fr: "Inscriptions et couleur du Davis Mega Mall",
      },
    ),
    landingSlot(
      "lights",
      {
        ru: "Фонари", uk: "Ліхтарі",
        en: "Street lights",
        de: "Straßenlaternen",
        pl: "Latarnie",
        fr: "Lampadaires",
      },
      {
        ru: "Цвет, луч, блик и бабочки у фонарей", uk: "Колір, промінь, відблиск і метелики біля ліхтарів",
        en: "Color, beams, glare and butterflies around street lamps",
        de: "Farbe, Lichtkegel, Blendung und Schmetterlinge an Laternen",
        pl: "Kolor, snopy światła, blask i motyle przy latarniach",
        fr: "Couleur, faisceau, éclat et papillons autour des lampadaires",
      },
    ),
    landingSlot(
      "water",
      { ru: "Вода", uk: "Вода", en: "Water", de: "Wasser", pl: "Woda", fr: "Eau" },
      {
        ru: "Цвет и прозрачность моря, озёр и рек", uk: "Колір і прозорість моря, озер і річок",
        en: "Colour and clarity of the sea, lakes and rivers",
        de: "Farbe und Klarheit von Meer, Seen und Flüssen",
        pl: "Kolor i przejrzystość morza, jezior i rzek",
        fr: "Couleur et transparence de la mer, des lacs et des rivières",
      },
    ),
    landingSlot(
      "effects",
      {
        ru: "Эффекты окружения", uk: "Ефекти довкілля",
        en: "Environment effects",
        de: "Umgebungseffekte",
        pl: "Efekty otoczenia",
        fr: "Effets d'environnement",
      },
      {
        ru: "Визуальные эффекты окружения", uk: "Візуальні ефекти довкілля",
        en: "World visual effects",
        de: "Visuelle Welteffekte",
        pl: "Efekty wizualne świata",
        fr: "Effets visuels de l'environnement",
      },
    ),
    landingSlot(
      "tracers",
      { ru: "Трейсеры", uk: "Трасери", en: "Tracers", de: "Leuchtspuren", pl: "Smugi", fr: "Traceurs" },
      {
        ru: "Следы и цвет полёта пули", uk: "Сліди та колір польоту кулі",
        en: "Bullet trails and colors",
        de: "Geschossspuren und Farben",
        pl: "Ślady i kolory pocisków",
        fr: "Traînées et couleur de la trajectoire des balles",
      },
    ),
    /* Зоны попаданий из bloodfx.dat: кровь и брызги по частям тела. Слот
       `effects` рядом — это окружение (дым, вспышки), он давно не про это. */
    landingSlot(
      "hit-effects",
      {
        ru: "Эффекты попадания", uk: "Ефекти влучання",
        en: "Hit effects",
        de: "Treffereffekte",
        pl: "Efekty trafień",
        fr: "Effets d'impact",
      },
      {
        ru: "Кровь и брызги по зонам попадания", uk: "Кров і бризки за зонами влучання",
        en: "Blood and spray by hit zone",
        de: "Blut und Spritzer nach Trefferzone",
        pl: "Krew i rozbryzgi według strefy trafienia",
        fr: "Sang et éclaboussures selon la zone touchée",
      },
    ),
    /* Слот ставит `hud_def_desat_cold_kill` — эффект на экране после убийства,
       а не эффект попадания пули. Прежнее название («Эффекты при попадании»)
       называло соседний слот `effects` и уводило от того, что здесь есть. */
    landingSlot(
      "kill-effects",
      {
        ru: "Килл-эффект", uk: "Кілл-ефект",
        en: "Kill effect",
        de: "Kill-Effekt",
        pl: "Efekt zabójstwa",
        fr: "Effet de kill",
      },
      {
        ru: "Вспышка на экране в момент убийства", uk: "Спалах на екрані в момент вбивства",
        en: "Screen effect on the moment of a kill",
        de: "Bildschirmeffekt im Moment des Kills",
        pl: "Efekt ekranowy w chwili zabójstwa",
        fr: "Flash à l'écran au moment du kill",
      },
    ),
    /* След по краю экрана, когда попадают по самому игроку (задача 3,
       05.10.2026): misc.DamageOverlay и капля dmg_overlay_fade. */
    landingSlot(
      "screen-hits",
      {
        ru: "Эффекты попадания на экране", uk: "Ефекти влучання на екрані",
        en: "On-screen hit effects",
        de: "Treffereffekte auf dem Bildschirm",
        pl: "Efekty trafień na ekranie",
        fr: "Effets d'impact à l'écran",
      },
      {
        ru: "След на экране, когда попадают по вам", uk: "Слід на екрані, коли влучають у вас",
        en: "Screen marks when you get hit",
        de: "Bildschirmspuren, wenn Sie getroffen werden",
        pl: "Ślady na ekranie, gdy ktoś cię trafi",
        fr: "Marques à l'écran quand vous êtes touché",
      },
    ),
    landingSlot(
      "gun-smoke",
      {
        ru: "Дым от стрельбы", uk: "Дим від стрільби",
        en: "Gun smoke",
        de: "Waffenrauch",
        pl: "Dym po strzale",
        fr: "Fumée des tirs",
      },
      {
        ru: "Дым после выстрелов", uk: "Дим після пострілів",
        en: "Smoke produced by gunfire",
        de: "Rauch nach Schüssen",
        pl: "Dym powstający po strzałach",
        fr: "Fumée après les tirs",
      },
    ),
    landingSlot(
      "vehicle-smoke",
      {
        ru: "Отстрел от авто", uk: "Вистріли від авто",
        en: "Vehicle backfire",
        de: "Fehlzündungen",
        pl: "Wystrzały z wydechu",
        fr: "Retours de flamme des véhicules",
      },
      {
        ru: "Выхлоп, прострелы и эффекты транспорта", uk: "Вихлоп, постріли й ефекти транспорту",
        en: "Exhaust, backfire and vehicle effects",
        de: "Auspuff, Fehlzündungen und Fahrzeugeffekte",
        pl: "Wydech, wystrzały i efekty pojazdów",
        fr: "Échappement, retours de flamme et effets des véhicules",
      },
    ),
    landingSlot(
      "drift-smoke",
      {
        ru: "Дым от дрифта", uk: "Дим від дрифту",
        en: "Drift smoke",
        de: "Driftrauch",
        pl: "Dym podczas driftu",
        fr: "Fumée de drift",
      },
      {
        ru: "Следы дыма от шин", uk: "Сліди диму від шин",
        en: "Tire smoke trails",
        de: "Rauchspuren der Reifen",
        pl: "Smugi dymu z opon",
        fr: "Traînées de fumée des pneus",
      },
    ),
    landingSlot(
      "weapon-flashes",
      {
        ru: "Вспышки оружия", uk: "Спалахи зброї",
        en: "Weapon flashes",
        de: "Mündungsfeuer",
        pl: "Błyski broni",
        fr: "Flammes de bouche",
      },
      {
        ru: "Вспышки при выстрелах", uk: "Спалахи при пострілах",
        en: "Muzzle flashes when firing",
        de: "Mündungsfeuer beim Schießen",
        pl: "Błyski przy oddawaniu strzałów",
        fr: "Flammes de bouche à chaque tir",
      },
    ),
    landingSlot(
      "fire-explosions",
      {
        ru: "Огонь и взрывы", uk: "Вогонь і вибухи",
        en: "Fire and explosions",
        de: "Feuer und Explosionen",
        pl: "Ogień i eksplozje",
        fr: "Feu et explosions",
      },
      {
        ru: "Пламя, искры, взрывные волны и частицы", uk: "Полум’я, іскри, вибухові хвилі та частинки",
        en: "Flames, sparks, blast waves and particles",
        de: "Flammen, Funken, Druckwellen und Partikel",
        pl: "Płomienie, iskry, fale uderzeniowe i cząsteczki",
        fr: "Flammes, étincelles, ondes de choc et particules",
      },
    ),
    landingSlot(
      "explosions",
      {
        ru: "Взрывы", uk: "Вибухи",
        en: "Explosions",
        de: "Explosionen",
        pl: "Eksplozje",
        fr: "Explosions",
      },
      {
        ru: "Взрывные волны, вспышки и частицы", uk: "Вибухові хвилі, спалахи та частинки",
        en: "Blast waves, flashes and particles",
        de: "Druckwellen, Lichtblitze und Partikel",
        pl: "Fale uderzeniowe, błyski i cząsteczki",
        fr: "Ondes de choc, flashs et particules",
      },
    ),
    landingSlot(
      "sounds",
      { ru: "Звуки", uk: "Звуки", en: "Sounds", de: "Sounds", pl: "Dźwięki", fr: "Sons" },
      {
        ru: "Оружие, спецсигналы и окружение", uk: "Зброя, спецсигнали і довкілля",
        en: "Weapons, emergency signals and ambience",
        de: "Waffen, Sondersignale und Umgebung",
        pl: "Broń, sygnały specjalne i otoczenie",
        fr: "Armes, signaux d'urgence et ambiance",
      },
    ),
    landingSlot(
      "weapon-sounds",
      {
        ru: "Звуки оружия", uk: "Звуки зброї",
        en: "Weapon sounds",
        de: "Waffensounds",
        pl: "Dźwięki broni",
        fr: "Sons des armes",
      },
      {
        ru: "Выстрелы и перезарядка", uk: "Постріли й перезарядка",
        en: "Gunfire and reload sounds",
        de: "Schüsse und Nachladen",
        pl: "Strzały i przeładowanie",
        fr: "Tirs et rechargement",
      },
    ),
    landingSlot(
      "hit-sounds",
      {
        ru: "Звуки при попадании", uk: "Звуки при влучанні",
        en: "Hit sounds",
        de: "Treffersounds",
        pl: "Dźwięki trafień",
        fr: "Sons de touche",
      },
      {
        ru: "Звуки подтверждения попаданий", uk: "Звуки підтвердження влучань",
        en: "Hit confirmation sounds",
        de: "Sounds zur Trefferbestätigung",
        pl: "Dźwięki potwierdzające trafienie",
        fr: "Sons de confirmation des touches",
      },
    ),
    landingSlot(
      "loading-music",
      {
        ru: "Музыка при загрузке", uk: "Музика під час завантаження",
        en: "Loading music",
        de: "Lademusik",
        pl: "Muzyka podczas ładowania",
        fr: "Musique de chargement",
      },
      {
        ru: "Музыка на экране загрузки", uk: "Музика на екрані завантаження",
        en: "Music played on the loading screen",
        de: "Musik auf dem Ladebildschirm",
        pl: "Muzyka na ekranie ładowania",
        fr: "Musique de l'écran de chargement",
      },
    ),
    landingSlot(
      "emergency-signals",
      {
        ru: "Спецсигналы", uk: "Спецсигнали",
        en: "Emergency signals",
        de: "Sondersignale",
        pl: "Sygnały pojazdów uprzywilejowanych",
        fr: "Signaux d'urgence",
      },
      {
        ru: "Сирены и сигналы спецтранспорта", uk: "Сирени й сигнали спецтранспорту",
        en: "Sirens and emergency vehicle signals",
        de: "Sirenen und Signale von Einsatzfahrzeugen",
        pl: "Syreny i sygnały pojazdów uprzywilejowanych",
        fr: "Sirènes et signaux des véhicules d'urgence",
      },
    ),
    landingSlot(
      "ambient-noise",
      {
        ru: "Фоновый шум", uk: "Фоновий шум",
        en: "Ambient noise",
        de: "Umgebungsgeräusche",
        pl: "Dźwięki otoczenia",
        fr: "Bruit de fond",
      },
      {
        ru: "Звуки города и окружения", uk: "Звуки міста й довкілля",
        en: "City and environmental ambience",
        de: "Stadt- und Umgebungsgeräusche",
        pl: "Dźwięki miasta i otoczenia",
        fr: "Sons de la ville et de l'environnement",
      },
    ),
    landingSlot(
      "gas-stations",
      {
        ru: "Заправки", uk: "Заправки",
        en: "Gas stations",
        de: "Tankstellen",
        pl: "Stacje paliw",
        fr: "Stations-service",
      },
      {
        ru: "Модели, вывески и окружение заправок", uk: "Моделі, вивіски й довкілля заправок",
        en: "Models, signs and gas station surroundings",
        de: "Modelle, Schilder und Tankstellenumgebung",
        pl: "Modele, szyldy i otoczenie stacji paliw",
        fr: "Modèles, enseignes et abords des stations-service",
      },
    ),
    landingSlot(
      "mapping",
      {
        ru: "Маппинг", uk: "Мапінг",
        en: "Mapping",
        de: "Mapping",
        pl: "Mapowanie",
        fr: "Mapping",
      },
      {
        ru: "Цвет мест: ферма, база, самолёт", uk: "Колір місць: ферма, база, літак",
        en: "Place colours: farm, base, plane",
        de: "Ortsfarben: Farm, Basis, Flugzeug",
        pl: "Kolory miejsc: farma, baza, samolot",
        fr: "Couleur des lieux\u00a0: ferme, base, avion",
      },
    ),
    landingSlot(
      "motion-blur",
      {
        ru: "Размытие в движении", uk: "Розмиття в русі",
        en: "Motion blur",
        de: "Bewegungsunschärfe",
        pl: "Rozmycie ruchu",
        fr: "Flou de mouvement",
      },
      {
        ru: "Интенсивность и характер размытия камеры", uk: "Інтенсивність і характер розмиття камери",
        en: "Camera blur intensity and style",
        de: "Intensität und Stil der Kameraunschärfe",
        pl: "Intensywność i styl rozmycia kamery",
        fr: "Intensité et style du flou de la caméra",
      },
    ),
  ],
  clothing: [
    clothingLandingSlot(
      "armor",
      {
        ru: "Бронежилеты", uk: "Бронежилети",
        en: "Body armor",
        de: "Schutzwesten",
        pl: "Kamizelki",
        fr: "Gilets pare-balles",
      },
      {
        ru: "Замена моделей брони", uk: "Заміна моделей броні",
        en: "Armor model replacements",
        de: "Alternative Rüstungsmodelle",
        pl: "Zamienniki modeli pancerza",
        fr: "Remplacement des modèles de gilets",
      },
    ),
    clothingLandingSlot(
      "tshirts",
      { ru: "Футболки", uk: "Футболки", en: "T-shirts", de: "T-Shirts", pl: "Koszulki", fr: "T-shirts" },
      {
        ru: "Верхняя одежда", uk: "Верхній одяг",
        en: "Upper-body clothing",
        de: "Oberbekleidung",
        pl: "Odzież górna",
        fr: "Vêtements du haut",
      },
    ),
    /* Госодежда (форма служб) снята с полки — co-founder, видео 26.09:
       «госодежду пока убираем». Картинка и модель слота остаются. */
    clothingLandingSlot(
      "pants",
      { ru: "Штаны", uk: "Штани", en: "Pants", de: "Hosen", pl: "Spodnie", fr: "Pantalons" },
      {
        ru: "Нижняя часть комплекта", uk: "Нижня частина комплекту",
        en: "Lower-body clothing",
        de: "Unterbekleidung",
        pl: "Dolna część stroju",
        fr: "Bas de la tenue",
      },
    ),
    clothingLandingSlot(
      "shoes",
      { ru: "Обувь", uk: "Взуття", en: "Shoes", de: "Schuhe", pl: "Buty", fr: "Chaussures" },
      {
        ru: "Кроссовки и ботинки", uk: "Кросівки й черевики",
        en: "Sneakers and boots",
        de: "Sneaker und Stiefel",
        pl: "Sneakersy i buty",
        fr: "Baskets et bottes",
      },
    ),
    clothingLandingSlot(
      "hats",
      {
        ru: "Головные уборы", uk: "Головні убори",
        en: "Headwear",
        de: "Kopfbedeckungen",
        pl: "Nakrycia głowy",
        fr: "Couvre-chefs",
      },
      {
        ru: "Кепки, шапки и маски", uk: "Кепки, шапки й маски",
        en: "Caps, hats and masks",
        de: "Kappen, Mützen und Masken",
        pl: "Czapki i maski",
        fr: "Casquettes, bonnets et masques",
      },
    ),
    clothingLandingSlot(
      "accessories",
      {
        ru: "Аксессуары", uk: "Аксесуари",
        en: "Accessories",
        de: "Accessoires",
        pl: "Akcesoria",
        fr: "Accessoires",
      },
      {
        ru: "Украшения и мелочи образа", uk: "Прикраси й дрібниці образу",
        en: "Jewelry and extra outfit elements",
        de: "Schmuck und zusätzliche Outfit-Elemente",
        pl: "Biżuteria i dodatkowe elementy stroju",
        fr: "Bijoux et petits détails de la tenue",
      },
    ),
    clothingLandingSlot(
      "gloves",
      { ru: "Перчатки", uk: "Рукавички", en: "Gloves", de: "Handschuhe", pl: "Rękawiczki", fr: "Gants" },
      {
        ru: "Тактические и повседневные модели", uk: "Тактичні й повсякденні моделі",
        en: "Tactical and casual models",
        de: "Taktische und alltägliche Modelle",
        pl: "Modele taktyczne i codzienne",
        fr: "Modèles tactiques et de tous les jours",
      },
    ),
    clothingLandingSlot(
      "masks",
      { ru: "Маски", uk: "Маски", en: "Masks", de: "Masken", pl: "Maski", fr: "Masques" },
      {
        ru: "Маски и закрытие лица", uk: "Маски й закриття обличчя",
        en: "Masks and face coverings",
        de: "Masken und Gesichtsschutz",
        pl: "Maski i osłony twarzy",
        fr: "Masques et protections du visage",
      },
    ),
    clothingLandingSlot(
      "tattoos",
      { ru: "Татуировки", uk: "Татуювання", en: "Tattoos", de: "Tattoos", pl: "Tatuaże", fr: "Tatouages" },
      {
        ru: "Рисунки для тела персонажа", uk: "Малюнки для тіла персонажа",
        en: "Character body artwork",
        de: "Körpermotive für Charaktere",
        pl: "Wzory na ciało postaci",
        fr: "Motifs pour le corps du personnage",
      },
    ),
    clothingLandingSlot(
      "bags",
      { ru: "Сумки", uk: "Сумки", en: "Bags", de: "Taschen", pl: "Torby", fr: "Sacs" },
      {
        ru: "Рюкзаки и сумки", uk: "Рюкзаки й сумки",
        en: "Backpacks, bags and carried gear",
        de: "Rucksäcke, Taschen und tragbare Ausrüstung",
        pl: "Plecaki, torby i przenoszone wyposażenie",
        fr: "Sacs à dos et sacs",
      },
    ),
  ],
  other: [
    landingSlot(
      "vehicles",
      { ru: "Транспорт", uk: "Транспорт", en: "Vehicles", de: "Fahrzeuge", pl: "Pojazdy", fr: "Véhicules" },
      {
        ru: "Модели, материалы и поведение транспорта", uk: "Моделі, матеріали й поведінка транспорту",
        en: "Vehicle models, materials and handling",
        de: "Fahrzeugmodelle, Materialien und Fahrverhalten",
        pl: "Modele, materiały i prowadzenie pojazdów",
        fr: "Modèles, matériaux et comportement des véhicules",
      },
    ),
    landingSlot(
      "sounds",
      { ru: "Звуки", uk: "Звуки", en: "Sounds", de: "Sounds", pl: "Dźwięki", fr: "Sons" },
      {
        ru: "Оружие, транспорт и окружение", uk: "Зброя, транспорт і довкілля",
        en: "Weapons, vehicles and environment",
        de: "Waffen, Fahrzeuge und Umgebung",
        pl: "Broń, pojazdy i otoczenie",
        fr: "Armes, véhicules et environnement",
      },
    ),
    landingSlot(
      "animations",
      { ru: "Анимации", uk: "Анімації", en: "Animations", de: "Animationen", pl: "Animacje", fr: "Animations" },
      {
        ru: "Движения персонажей и игровые действия", uk: "Рухи персонажів і ігрові дії",
        en: "Character motion and gameplay actions",
        de: "Charakterbewegungen und Spielaktionen",
        pl: "Ruch postaci i akcje w grze",
        fr: "Mouvements des personnages et actions de jeu",
      },
    ),
    landingSlot(
      "game-effects",
      { ru: "Эффекты", uk: "Ефекти", en: "Effects", de: "Effekte", pl: "Efekty", fr: "Effets" },
      {
        ru: "Дым, частицы, попадания и следы", uk: "Дим, частинки, влучання й сліди",
        en: "Smoke, particles, impacts and trails",
        de: "Rauch, Partikel, Treffer und Spuren",
        pl: "Dym, cząsteczki, trafienia i smugi",
        fr: "Fumée, particules, impacts et traînées",
      },
    ),
    landingSlot(
      "interface",
      { ru: "Интерфейс", uk: "Інтерфейс", en: "Interface", de: "Interface", pl: "Interfejs", fr: "Interface" },
      {
        ru: "HUD, меню и дополнительные индикаторы", uk: "HUD, меню та додаткові індикатори",
        en: "HUD, menus and additional indicators",
        de: "HUD, Menüs und zusätzliche Anzeigen",
        pl: "HUD, menu i dodatkowe wskaźniki",
        fr: "HUD, menus et indicateurs supplémentaires",
      },
    ),
    landingSlot(
      "world-objects",
      {
        ru: "Игровые объекты", uk: "Ігрові об’єкти",
        en: "Game objects",
        de: "Spielobjekte",
        pl: "Obiekty gry",
        fr: "Objets du jeu",
      },
      {
        ru: "Дополнительные предметы и элементы мира", uk: "Додаткові предмети та елементи світу",
        en: "Additional props and world elements",
        de: "Zusätzliche Requisiten und Weltelemente",
        pl: "Dodatkowe rekwizyty i elementy świata",
        fr: "Objets et éléments du monde supplémentaires",
      },
    ),
    landingSlot(
      "user-files",
      {
        ru: "Пользовательские файлы", uk: "Користувацькі файли",
        en: "Custom files",
        de: "Eigene Dateien",
        pl: "Pliki użytkownika",
        fr: "Fichiers personnalisés",
      },
      {
        ru: "Локальные моды и файлы для ручной привязки", uk: "Локальні моди й файли для ручної прив’язки",
        en: "Local mods and files for manual mapping",
        de: "Lokale Mods und Dateien zur manuellen Zuordnung",
        pl: "Lokalne mody i pliki do ręcznego przypisania",
        fr: "Mods locaux et fichiers à associer manuellement",
      },
    ),
    landingSlot(
      "minimap-position",
      {
        ru: "Положение мини-карты", uk: "Положення міні-карти",
        en: "Minimap position",
        de: "Minikartenposition",
        pl: "Pozycja minimapy",
        fr: "Position de la minicarte",
      },
      {
        ru: "Размер и позиция интерфейса", uk: "Розмір і положення інтерфейсу",
        en: "Interface size and position",
        de: "Größe und Position",
        pl: "Rozmiar i pozycja interfejsu",
        fr: "Taille et position de l'interface",
      },
    ),
    landingSlot(
      "tracers",
      {
        ru: "Трейсеры", uk: "Трасери",
        en: "Tracers",
        de: "Leuchtspuren",
        pl: "Smugi pocisków",
        fr: "Traceurs",
      },
      {
        ru: "Вид следа от пули", uk: "Вигляд сліду від кулі",
        en: "Bullet trail appearance",
        de: "Aussehen der Geschossspur",
        pl: "Wygląd śladu pocisku",
        fr: "Aspect de la traînée de balle",
      },
    ),
    landingSlot(
      "smoke",
      { ru: "Дым", uk: "Дим", en: "Smoke", de: "Rauch", pl: "Dym", fr: "Fumée" },
      {
        ru: "Эффекты оружия", uk: "Ефекти зброї",
        en: "Weapon effects",
        de: "Waffeneffekte",
        pl: "Efekty broni",
        fr: "Effets des armes",
      },
    ),
    landingSlot(
      "fast-entry",
      {
        ru: "Быстрый заход", uk: "Швидкий вхід",
        en: "Fast entry",
        de: "Schneller Einstieg",
        pl: "Szybkie wejście",
        fr: "Entrée rapide",
      },
      {
        ru: "Настройка появления персонажа", uk: "Налаштування появи персонажа",
        en: "Character spawn behavior",
        de: "Charakter-Spawn",
        pl: "Ustawienia pojawiania postaci",
        fr: "Réglage de l'apparition du personnage",
      },
    ),
    landingSlot(
      "climbing",
      { ru: "Залазы", uk: "Залази", en: "Climbing", de: "Klettern", pl: "Wspinaczka", fr: "Climbs" },
      {
        ru: "Точки паркура для серверов", uk: "Точки паркуру для серверів",
        en: "Server parkour points",
        de: "Parkourpunkte für Server",
        pl: "Punkty parkour dla serwerów",
        fr: "Points de parkour pour les serveurs",
      },
    ),
  ],
};
