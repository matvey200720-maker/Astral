// Слова карточки мода: кнопка «Редактировать», названия и подсказки редакторов, подписи кадров.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Названия редакторов. Часть из них у разных видов совпадает, поэтому живут отдельно.
const TITLES = {
  soundWorkshop: {
    ru: "Мастерская звуков",
    uk: "Майстерня звуків",
    en: "Sound Workshop",
    de: "Sound-Werkstatt",
    pl: "Warsztat dźwięków",
    fr: "Atelier de sons",
  },
  weaponSoundWorkshop: {
    ru: "Мастерская звуков",
    uk: "Майстерня звуків",
    en: "Sound workshop",
    de: "Sound-Werkstatt",
    pl: "Warsztat dźwięków",
    fr: "Atelier de sons",
  },
  weaponWorkshop: {
    ru: "Мастерская оружия",
    uk: "Майстерня зброї",
    en: "Weapon Workshop",
    de: "Waffenwerkstatt",
    pl: "Warsztat broni",
    fr: "Atelier d’armes",
  },
  clothingWorkshop: {
    ru: "Мастерская одежды",
    uk: "Майстерня одягу",
    en: "Clothing Workshop",
    de: "Kleidungswerkstatt",
    pl: "Warsztat ubrań",
    fr: "Atelier de vêtements",
  },
  minimap: {
    ru: "Редактор мини-карты",
    uk: "Редактор мінікарти",
    en: "Minimap editor",
    de: "Minikarten-Editor",
    pl: "Edytor minimapy",
    fr: "Éditeur de minicarte",
  },
  minimapPosition: {
    ru: "Редактор мини-карты",
    uk: "Редактор мінікарти",
    en: "Minimap editor",
    de: "Minimap-Editor",
    pl: "Edytor minimapy",
    fr: "Éditeur de minicarte",
  },
  crosshair: {
    ru: "Редактор прицела",
    uk: "Редактор прицілу",
    en: "Crosshair editor",
    de: "Fadenkreuz-Editor",
    pl: "Edytor celownika",
    fr: "Éditeur de réticule",
  },
  sniperCrosshair: {
    ru: "Редактор снайперского прицела",
    uk: "Редактор снайперського прицілу",
    en: "Sniper scope editor",
    de: "Zielfernrohr-Editor",
    pl: "Edytor lunety",
    fr: "Éditeur de réticule de sniper",
  },
  arenas: {
    ru: "Редактор арен",
    uk: "Редактор арен",
    en: "Arena editor",
    de: "Arena-Editor",
    pl: "Edytor aren",
    fr: "Éditeur d’arènes",
  },
  killEffects: {
    ru: "Редактор килл-эффекта",
    uk: "Редактор кіл-ефекту",
    en: "Kill effect editor",
    de: "Kill-Effekt-Editor",
    pl: "Edytor efektu zabójstwa",
    fr: "Éditeur d’effet de kill",
  },
  sky: {
    ru: "Редактор неба",
    uk: "Редактор неба",
    en: "Sky editor",
    de: "Himmel-Editor",
    pl: "Edytor nieba",
    fr: "Éditeur de ciel",
  },
  water: {
    ru: "Редактор воды",
    uk: "Редактор води",
    en: "Water editor",
    de: "Wasser-Editor",
    pl: "Edytor wody",
    fr: "Éditeur d’eau",
  },
  largeMap: {
    ru: "Редактор большой карты",
    uk: "Редактор великої карти",
    en: "Large map editor",
    de: "Editor der großen Karte",
    pl: "Edytor dużej mapy",
    fr: "Éditeur de grande carte",
  },
  hits: {
    ru: "Редактор попаданий",
    uk: "Редактор влучань",
    en: "Hit effect editor",
    de: "Treffer-Editor",
    pl: "Edytor trafień",
    fr: "Éditeur d’impacts",
  },
  optimization: {
    ru: "Оптимизация Astral",
    uk: "Оптимізація Astral",
    en: "Astral optimization",
    de: "Astral-Optimierung",
    pl: "Optymalizacja Astral",
    fr: "Optimisation Astral",
  },
  screenHits: {
    ru: "Редактор эффектов на экране",
    uk: "Редактор ефектів на екрані",
    en: "Screen hit editor",
    de: "Bildschirmtreffer-Editor",
    pl: "Edytor trafień na ekranie",
    fr: "Éditeur d’effets à l’écran",
  },
};

// Что именно из мода лежит в редакторе. Один и тот же оборот у двух видов — общая константа.
const DERIVED_WORK = {
  ru: "новая работа по мотивам мода, не его правка",
  uk: "нова робота за мотивами моду, не його правка",
  en: "new work based on this mod, not an edit",
  de: "neue Arbeit nach diesem Mod, keine Änderung daran",
  pl: "nowa praca na motywach moda, nie jego edycja",
  fr: "création inspirée de ce mod, sans le modifier",
};

// Подсказка кнопки = название редактора (или своё начало) + «: » + то, что в нём загружено.
const EDITORS = [
  {
    kind: "sound",
    title: TITLES.soundWorkshop,
    detail: {
      ru: "этот выстрел уже на своём оружии",
      uk: "цей постріл уже на своїй зброї",
      en: "this shot, already set on its own weapon",
      de: "dieser Schuss, der passenden Waffe zugewiesen",
      pl: "ten strzał, od razu przy swojej broni",
      fr: "ce tir est déjà placé sur son arme",
    },
  },
  {
    kind: "weapon",
    title: TITLES.weaponWorkshop,
    detail: {
      ru: "здесь эта модель из мода",
      uk: "тут ця модель із моду",
      en: "this model from the mod",
      de: "dieses Modell aus dem Mod",
      pl: "ten model z moda",
      fr: "ce modèle du mod",
    },
  },
  {
    kind: "clothing",
    title: TITLES.clothingWorkshop,
    detail: {
      ru: "эта вещь из мода",
      uk: "ця річ із моду",
      en: "this item from the mod",
      de: "dieses Teil aus dem Mod",
      pl: "ten element z moda",
      fr: "cet article du mod",
    },
  },
  { kind: "minimap", title: TITLES.minimap, detail: DERIVED_WORK },
  {
    kind: "minimap-part",
    title: TITLES.minimap,
    detail: {
      ru: "полосы HP и брони из этого мода",
      uk: "смуги HP і броні з цього моду",
      en: "HP and armour bars from this mod",
      de: "HP- und Rüstungsleisten aus diesem Mod",
      pl: "paski HP i pancerza z tego moda",
      fr: "barres HP et d’armure issues de ce mod",
    },
  },
  {
    kind: "weapon-sounds",
    title: TITLES.weaponSoundWorkshop,
    detail: {
      ru: "выстрелы всех стволов этого мода",
      uk: "постріли всіх стволів цього моду",
      en: "shots of every weapon in this mod",
      de: "Schüsse aller Waffen aus diesem Mod",
      pl: "strzały ze wszystkich broni tego moda",
      fr: "les tirs de toutes les armes du mod",
    },
  },
  {
    kind: "crosshair",
    title: TITLES.crosshair,
    detail: {
      ru: "обычный прицел из этого мода",
      uk: "звичайний приціл із цього моду",
      en: "the standard crosshair from this mod",
      de: "normales Fadenkreuz aus diesem Mod",
      pl: "zwykły celownik z tego moda",
      fr: "réticule standard de ce mod",
    },
  },
  // Начало подсказки — «Редактор прицела», как у обычного прицела: кнопка открывает тот же редактор.
  {
    kind: "sniper-crosshair",
    title: TITLES.sniperCrosshair,
    lead: TITLES.crosshair,
    detail: DERIVED_WORK,
  },
  {
    kind: "arenas",
    title: TITLES.arenas,
    detail: {
      ru: "правки ложатся слоем поверх мода, мод — основа",
      uk: "правки лягають шаром поверх моду, мод — основа",
      en: "edits layer over the mod, which stays the base",
      de: "Änderungen als Schicht auf dem Mod als Basis",
      pl: "poprawki jako warstwa na bazie moda",
      fr: "modifications en couche sur le mod, qui reste la base",
    },
  },
  {
    kind: "kill-effects",
    title: TITLES.killEffects,
    detail: {
      ru: "загружен эффект из этого мода",
      uk: "завантажено ефект із цього моду",
      en: "the effect from this mod is loaded",
      de: "Effekt aus diesem Mod geladen",
      pl: "wczytany efekt z tego moda",
      fr: "effet de ce mod chargé",
    },
  },
  {
    kind: "timecycle",
    title: TITLES.sky,
    detail: {
      ru: "небо из этого мода",
      uk: "небо з цього моду",
      en: "the sky from this mod",
      de: "Himmel aus diesem Mod",
      pl: "niebo z tego moda",
      fr: "ciel de ce mod",
    },
  },
  {
    kind: "water",
    title: TITLES.water,
    detail: {
      ru: "прозрачность воды из этого мода",
      uk: "прозорість води з цього моду",
      en: "water transparency from this mod",
      de: "Wassertransparenz aus diesem Mod",
      pl: "przezroczystość wody z tego moda",
      fr: "transparence de l’eau de ce mod",
    },
  },
  {
    kind: "large-map",
    title: TITLES.largeMap,
    detail: {
      ru: "карта из этого мода",
      uk: "карта з цього моду",
      en: "map from this mod",
      de: "Karte aus diesem Mod",
      pl: "mapa z tego moda",
      fr: "carte de ce mod",
    },
  },
  {
    kind: "weather",
    title: TITLES.sky,
    detail: {
      ru: "туман, гроза, дождь и снег как в этом моде. Ветер из мода в небо не попадает",
      uk: "туман, гроза, дощ і сніг, як у цьому моді. Вітер із моду в небо не потрапляє",
      en: "fog, storms, rain and snow as made in this mod. Wind from the mod does not reach the sky",
      de: "Nebel, Gewitter, Regen und Schnee wie in diesem Mod. Der Wind des Mods erreicht den Himmel nicht",
      pl: "mgła, burza, deszcz i śnieg jak w tym modzie. Wiatr z moda nie trafia na niebo",
      fr: "brouillard, orage, pluie et neige comme dans ce mod. Le vent du mod n’atteint pas le ciel",
    },
  },
  {
    kind: "clouds",
    title: TITLES.sky,
    detail: {
      ru: "облака из этого мода, видимые в ясную погоду",
      uk: "хмари з цього моду, видимі за ясної погоди",
      en: "clouds from this mod, as seen in clear weather",
      de: "Wolken aus diesem Mod, sichtbar bei klarem Wetter",
      pl: "chmury z tego moda, widoczne przy czystym niebie",
      fr: "nuages de ce mod, visibles par temps clair",
    },
  },
  {
    kind: "blood-routing",
    title: TITLES.hits,
    detail: {
      ru: "кровь из этого мода",
      uk: "кров із цього моду",
      en: "blood from this mod",
      de: "Blut aus diesem Mod",
      pl: "krew z tego moda",
      fr: "sang de ce mod",
    },
  },
  {
    kind: "minimap-position",
    title: TITLES.minimapPosition,
    detail: {
      ru: "положение мини-карты из этого мода",
      uk: "положення мінікарти з цього моду",
      en: "minimap position taken from this mod",
      de: "Position der Minimap aus diesem Mod",
      pl: "położenie minimapy z tego moda",
      fr: "position de la minicarte dans ce mod",
    },
  },
  {
    kind: "optimization",
    title: TITLES.optimization,
    detail: {
      ru: "правки мода повторены слоями, включаются по желанию",
      uk: "правки моду повторено шарами, вмикаються за бажанням",
      en: "the mod's changes are repeated as layers, each optional",
      de: "Mod-Änderungen als zuschaltbare Ebenen nachgebaut",
      pl: "zmiany moda powtórzone jako warstwy, włączane dowolnie",
      fr: "les modifications du mod sont reprises en couches activables",
    },
  },
  {
    kind: "screen",
    title: TITLES.screenHits,
    detail: {
      ru: "красная рамка урона при попадании, из этого мода",
      uk: "червона рамка шкоди при влученні, з цього моду",
      en: "the red damage frame from this mod, shown when hit",
      de: "roter Schadensrahmen aus diesem Mod, angezeigt bei Treffern",
      pl: "czerwona ramka obrażeń z tego moda przy trafieniu",
      fr: "cadre rouge de dégâts de ce mod, à l’impact",
    },
  },
];

// Простые надписи карточки.
const LABELS = {
  edit: {
    ru: "Редактировать",
    uk: "Редагувати",
    en: "Edit",
    de: "Bearbeiten",
    pl: "Edytuj",
    fr: "Modifier",
  },
  frames: {
    ru: "Кадры",
    uk: "Кадри",
    en: "Media",
    de: "Bilder",
    pl: "Kadry",
    fr: "Images",
  },
  openFrame: {
    ru: "Открыть кадр",
    uk: "Відкрити кадр",
    en: "Open shot",
    de: "Bild öffnen",
    pl: "Otwórz kadr",
    fr: "Ouvrir l’image",
  },
  closeFrame: {
    ru: "Закрыть кадр",
    uk: "Закрити кадр",
    en: "Close shot",
    de: "Bild schließen",
    pl: "Zamknij kadr",
    fr: "Fermer l’image",
  },
  watchVideo: {
    ru: "Смотреть видео",
    uk: "Дивитися відео",
    en: "Watch video",
    de: "Video ansehen",
    pl: "Obejrzyj wideo",
    fr: "Regarder la vidéo",
  },
  rollbackValue: {
    ru: "Откат в один клик",
    uk: "Відкат в один клік",
    en: "One-click rollback",
    de: "Rückgängig mit einem Klick",
    pl: "Cofnięcie jednym kliknięciem",
    fr: "Restauration en un clic",
  },
};

// Между началом подсказки и пояснением: во французском перед двоеточием неразрывный пробел.
function separator(language) {
  return language === "fr" ? "\u00a0: " : ": ";
}

function hintFor(editor, language) {
  const lead = (editor.lead ?? editor.title)[language];
  return lead + separator(language) + editor.detail[language];
}

function buildTable(language) {
  const editorGroup = {};
  for (const editor of EDITORS) {
    editorGroup[editor.kind] = {
      name: editor.title[language],
      hint: hintFor(editor, language),
    };
  }
  return {
    edit: LABELS.edit[language],
    editor: editorGroup,
    frames: LABELS.frames[language],
    openFrame: LABELS.openFrame[language],
    closeFrame: LABELS.closeFrame[language],
    watchVideo: LABELS.watchVideo[language],
    rollbackValue: LABELS.rollbackValue[language],
  };
}

const TABLES = new Map(
  LANGUAGES.map((language) => [language, buildTable(language)]),
);

export function modCardCopy(language) {
  return TABLES.get(language) ?? TABLES.get("en");
}
