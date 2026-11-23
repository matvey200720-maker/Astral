// Слова страницы мода: шапка, кадры, полки, ссылка, установка и удаление.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Слово, одинаковое на всех языках.
function everywhere(text) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text]));
}

// Ключ — путь в таблице через точку. Если языка в записи нет, ключа в его таблице тоже нет.
const WORDS = {
  workshop: {
    ru: "Мастерская",
    uk: "Майстерня",
    en: "Workshop",
    de: "Werkstatt",
    pl: "Warsztat",
    fr: "Atelier",
  },
  category: {
    ru: "Редуксы",
    uk: "Редукси",
    en: "Redux",
    de: "Redux",
    pl: "Redux",
    fr: "Redux",
  },
  back: {
    ru: "Вернуться к редуксам",
    uk: "Повернутися до редуксів",
    en: "Back to Redux",
    de: "Zurück zu Redux",
    pl: "Wróć do Redux",
    fr: "Retour aux Redux",
  },
  author: {
    ru: "Автор",
    uk: "Автор",
    en: "Author",
    de: "Autor",
    pl: "Autor",
    fr: "Auteur",
  },
  game: {
    ru: "Для GTA V",
    uk: "Для GTA V",
    en: "For GTA V",
    de: "Für GTA V",
    pl: "Dla GTA V",
    fr: "Pour GTA V",
  },
  compatibility: everywhere("Legacy · Enhanced"),
  added: {
    ru: "Дата добавления",
    uk: "Дата додавання",
    en: "Date added",
    de: "Hinzugefügt",
    pl: "Data dodania",
    fr: "Date d’ajout",
  },
  size: {
    ru: "Размер",
    uk: "Розмір",
    en: "Size",
    de: "Größe",
    pl: "Rozmiar",
    fr: "Taille",
  },
  installation: {
    ru: "Установка",
    uk: "Встановлення",
    en: "Installation",
    de: "Installation",
    pl: "Instalacja",
    fr: "Installation",
  },
  safe: {
    ru: "Безопасная",
    uk: "Безпечне",
    en: "Safe",
    de: "Sicher",
    pl: "Bezpieczna",
    fr: "Sécurisée",
  },
  "downloadForms.one": {
    ru: "загрузка",
    uk: "завантаження",
    en: "download",
    de: "Download",
    pl: "pobranie",
    fr: "téléchargement",
  },
  "downloadForms.few": {
    ru: "загрузки",
    uk: "завантаження",
    pl: "pobrania",
    fr: "téléchargements",
  },
  "downloadForms.many": {
    ru: "загрузок",
    uk: "завантажень",
    pl: "pobrań",
    fr: "téléchargements",
  },
  "downloadForms.other": {
    ru: "загрузки",
    uk: "завантаження",
    en: "downloads",
    de: "Downloads",
    pl: "pobrania",
    fr: "téléchargements",
  },
  favorites: {
    ru: "В избранном",
    uk: "В обраному",
    en: "Favorites",
    de: "Favoriten",
    pl: "Ulubione",
    fr: "Dans les favoris",
  },
  install: {
    ru: "Установить Redux",
    uk: "Встановити Redux",
    en: "Install Redux",
    de: "Redux installieren",
    pl: "Zainstaluj Redux",
    fr: "Installer Redux",
  },
  installing: {
    ru: "Установка",
    uk: "Встановлення",
    en: "Installing",
    de: "Installation",
    pl: "Instalowanie",
    fr: "Installation",
  },
  remove: {
    ru: "Удалить",
    uk: "Видалити",
    en: "Remove",
    de: "Entfernen",
    pl: "Usuń",
    fr: "Supprimer",
  },
  removing: {
    ru: "Удаление",
    uk: "Видалення",
    en: "Removing",
    de: "Entfernen",
    pl: "Usuwanie",
    fr: "Suppression",
  },
  addFavorite: {
    ru: "В избранное",
    uk: "До обраного",
    en: "Add to favorites",
    de: "Zu Favoriten",
    pl: "Do ulubionych",
    fr: "Ajouter aux favoris",
  },
  removeFavorite: {
    ru: "В избранном",
    uk: "В обраному",
    en: "In favorites",
    de: "In Favoriten",
    pl: "W ulubionych",
    fr: "Dans les favoris",
  },
  previous: {
    ru: "Предыдущее изображение",
    uk: "Попереднє зображення",
    en: "Previous image",
    de: "Vorheriges Bild",
    pl: "Poprzedni obraz",
    fr: "Image précédente",
  },
  next: {
    ru: "Следующее изображение",
    uk: "Наступне зображення",
    en: "Next image",
    de: "Nächstes Bild",
    pl: "Następny obraz",
    fr: "Image suivante",
  },
  openMedia: {
    ru: "Открыть изображение",
    uk: "Відкрити зображення",
    en: "Open image",
    de: "Bild öffnen",
    pl: "Otwórz obraz",
    fr: "Ouvrir l’image",
  },
  similar: {
    ru: "Похожие моды",
    uk: "Схожі моди",
    en: "Similar mods",
    de: "Ähnliche Mods",
    pl: "Podobne mody",
    fr: "Mods similaires",
  },
  inPack: {
    ru: "Состав пака",
    uk: "Склад пака",
    en: "In this pack",
    de: "In diesem Paket",
    pl: "W tej paczce",
    fr: "Contenu du pack",
  },
  partOfPack: {
    ru: "Входит в пак",
    uk: "Входить до пака",
    en: "Part of a pack",
    de: "Teil eines Pakets",
    pl: "Część paczki",
    fr: "Fait partie d’un pack",
  },
  previousRelated: {
    ru: "Предыдущие похожие моды",
    uk: "Попередні схожі моди",
    en: "Previous similar mods",
    de: "Vorherige ähnliche Mods",
    pl: "Poprzednie podobne mody",
    fr: "Mods similaires précédents",
  },
  nextRelated: {
    ru: "Следующие похожие моды",
    uk: "Наступні схожі моди",
    en: "Next similar mods",
    de: "Nächste ähnliche Mods",
    pl: "Następne podobne mody",
    fr: "Mods similaires suivants",
  },
  previousShelf: {
    ru: "Предыдущие моды",
    uk: "Попередні моди",
    en: "Previous mods",
    de: "Vorherige Mods",
    pl: "Poprzednie mody",
    fr: "Mods précédents",
  },
  nextShelf: {
    ru: "Следующие моды",
    uk: "Наступні моди",
    en: "Next mods",
    de: "Nächste Mods",
    pl: "Następne mody",
    fr: "Mods suivants",
  },
  "backTo.catalog": {
    ru: "Каталог",
    uk: "Каталог",
    en: "Catalog",
    de: "Katalog",
    pl: "Katalog",
    fr: "Catalogue",
  },
  "backTo.workshop": {
    ru: "Мастерская",
    uk: "Майстерня",
    en: "Workshop",
    de: "Werkstatt",
    pl: "Warsztat",
    fr: "Atelier",
  },
  "backTo.search": {
    ru: "Поиск",
    uk: "Пошук",
    en: "Search",
    de: "Suche",
    pl: "Wyszukiwanie",
    fr: "Recherche",
  },
  "backTo.profiles": {
    ru: "Сборки",
    uk: "Збірки",
    en: "Builds",
    de: "Sammlungen",
    pl: "Zestawy",
    fr: "Builds",
  },
  "backTo.profile": {
    ru: "Профиль",
    uk: "Профіль",
    en: "Profile",
    de: "Profil",
    pl: "Profil",
    fr: "Profil",
  },
  about: {
    ru: "Описание",
    uk: "Опис",
    en: "Description",
    de: "Beschreibung",
    pl: "Opis",
    fr: "Description",
  },
  readMore: {
    ru: "Читать описание",
    uk: "Читати опис",
    en: "Read the description",
    de: "Beschreibung lesen",
    pl: "Czytaj opis",
    fr: "Lire la description",
  },
  copyLink: {
    ru: "Скопировать ссылку",
    uk: "Скопіювати посилання",
    en: "Copy link",
    de: "Link kopieren",
    pl: "Kopiuj link",
    fr: "Copier le lien",
  },
  linkField: {
    ru: "Ссылка на мод",
    uk: "Посилання на мод",
    en: "Mod link",
    de: "Mod-Link",
    pl: "Link do moda",
    fr: "Lien du mod",
  },
  fromPost: {
    fr: "Du même post",
  },

  // Дальше — тексты, написанные заново.
  descriptionFallback: {
    ru: "Через Astral этот готовый графический комплект для GTA V ставится безопасно.",
    uk: "Через Astral цей готовий графічний комплект для GTA V встановлюється безпечно.",
    en: "A ready-made graphics set for GTA V that installs safely through Astral.",
    de: "Das fertige Grafikpaket für GTA V wird sicher über Astral installiert.",
    pl: "Gotowy pakiet grafiki do GTA V instaluje się bezpiecznie przez Astral.",
    fr: "Ce pack graphique prêt à l’emploi pour GTA V s’installe sans risque via Astral.",
  },
  noMedia: {
    ru: "Кадров пока нет",
    uk: "Кадрів поки немає",
    en: "No shots yet",
    de: "Noch keine Bilder",
    pl: "Brak jeszcze kadrów",
    fr: "Pas encore d’images",
  },
  linkCopied: {
    ru: "Ссылка скопирована — вставь в Discord",
    uk: "Посилання скопійовано — встав у Discord",
    en: "Link copied — paste it in Discord",
    de: "Link kopiert — in Discord einfügen",
    pl: "Link skopiowany — wklej go na Discordzie",
    fr: "Lien copié — collez-le dans Discord",
  },
  linkFailed: {
    ru: "Не удалось скопировать ссылку",
    uk: "Не вдалося скопіювати посилання",
    en: "Could not copy the link",
    de: "Link konnte nicht kopiert werden",
    pl: "Nie udało się skopiować linku",
    fr: "Impossible de copier le lien",
  },
  linkManual: {
    ru: "Скопируй ссылку вручную",
    uk: "Скопіюй посилання вручну",
    en: "Copy the link manually",
    de: "Link manuell kopieren",
    pl: "Skopiuj link ręcznie",
    fr: "Copiez le lien à la main",
  },
};

// Подпись «сколько кадров у мода»; число идёт в самом конце после двоеточия.
const MEDIA_COUNT_LABELS = {
  ru: "Кадров у мода",
  uk: "Кадрів у моду",
  en: "Shots in mod",
  de: "Bilder im Mod",
  pl: "Kadry w modzie",
  fr: "Images du mod",
};

function hasValue(value) {
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    !Number.isNaN(value)
  );
}

function mediaCountFor(language) {
  const label = MEDIA_COUNT_LABELS[language];
  const colon = language === "fr" ? "\u00a0:" : ":";
  return (count) => (hasValue(count) ? `${label}${colon} ${count}` : label);
}

// Кладёт значение по пути «группа.ключ», создавая группу при первом обращении.
function put(table, path, value) {
  const steps = path.split(".");
  const last = steps.pop();
  let node = table;
  for (const step of steps) {
    node[step] ??= {};
    node = node[step];
  }
  node[last] = value;
}

function buildTable(language) {
  const table = {};
  for (const [path, texts] of Object.entries(WORDS)) {
    if (texts[language] !== undefined) {
      put(table, path, texts[language]);
    }
  }
  table.mediaCount = mediaCountFor(language);
  return table;
}

const TABLES = new Map(
  LANGUAGES.map((language) => [language, buildTable(language)]),
);

export function modDetailCopy(language) {
  return TABLES.get(language) ?? TABLES.get("en");
}
