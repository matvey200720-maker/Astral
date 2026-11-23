// Карта настроек: тексты левого меню на шести языках, группы, разделы и поиск по ним.
// В таблицах ниже порядок строк в каждой записи всегда один: ru, uk, en, de, pl, fr.
const LANGS = ["ru", "uk", "en", "de", "pl", "fr"];

const GROUP_NAMES = {
  account: ["Аккаунт", "Акаунт", "Account", "Konto", "Konto", "Compte"],
  app: ["Приложение", "Застосунок", "App", "App", "Aplikacja", "Application"],
  game: ["Игра", "Гра", "Game", "Spiel", "Gra", "Jeu"],
  space: ["Место", "Місце", "Storage", "Speicher", "Miejsce", "Stockage"],
  support: [
    "Поддержка",
    "Підтримка",
    "Support",
    "Hilfe",
    "Pomoc",
    "Assistance",
  ],
};

// Раздел: названия и короткие подписи (без точки) на шести языках.
const SECTION_TEXT = {
  profile: {
    names: [
      "Профиль",
      "Профіль",
      "Profile",
      "Profil",
      "Profil",
      "Profil",
    ],
    notes: [
      "Просмотр и правка в одном месте",
      "Перегляд і правка в одному місці",
      "View and edit in one place",
      "Ansehen und Bearbeiten an einem Ort",
      "Podgląd i edycja w jednym miejscu",
      "Consulter et modifier au même endroit",
    ],
  },
  general: {
    names: ["Общее", "Загальне", "General", "Allgemein", "Ogólne", "Général"],
    notes: [
      "Сводка, запуск, язык и папка",
      "Зведення, запуск, мова і тека",
      "Overview, startup, language and folder",
      "Übersicht, Start, Sprache und Ordner",
      "Podsumowanie, uruchamianie, język i folder",
      "Résumé, démarrage, langue et dossier",
    ],
  },
  appearance: {
    names: [
      "Внешний вид",
      "Вигляд",
      "Appearance",
      "Darstellung",
      "Wygląd",
      "Apparence",
    ],
    notes: [
      "Акцент, знак, фон, анимации",
      "Акцент, знак, тло, анімації",
      "Accent, logo, background, animation",
      "Akzent, Logo, Hintergrund, Animation",
      "Akcent, znak, tło, animacje",
      "Accent, logo, arrière-plan, animations",
    ],
  },
  language: {
    names: ["Язык", "Мова", "Language", "Sprache", "Język", "Langue"],
    notes: [
      "Язык интерфейса",
      "Мова інтерфейсу",
      "Interface language",
      "Sprache der App",
      "Język interfejsu",
      "Langue de l'interface",
    ],
  },
  game: {
    names: ["GTA V", "GTA V", "GTA V", "GTA V", "GTA V", "GTA V"],
    notes: [
      "Копии игры, загрузчики и возврат без модов",
      "Копії гри, завантажувачі та повернення без модів",
      "Game copies, loaders and restoring without mods",
      "Spielkopien, Loader und Rückkehr ohne Mods",
      "Kopie gry, loadery i powrót bez modów",
      "Copies du jeu, chargeurs et retour sans mods",
    ],
  },
  rockstar: {
    names: [
      "Rockstar Games",
      "Rockstar Games",
      "Rockstar Games",
      "Rockstar Games",
      "Rockstar Games",
      "Rockstar Games",
    ],
    notes: [
      "Моды и проверка Rockstar Games Launcher",
      "Моди і перевірка Rockstar Games Launcher",
      "Mods and the Rockstar Games Launcher check",
      "Mods und die Prüfung des Rockstar Games Launcher",
      "Mody i sprawdzanie przez Rockstar Games Launcher",
      "Mods et vérification du Rockstar Games Launcher",
    ],
  },
  tools: {
    names: [
      "Инструменты правки",
      "Інструменти правки",
      "Editing tools",
      "Werkzeuge",
      "Narzędzia edycji",
      "Outils de modification",
    ],
    notes: [
      "ArchiveFix и ключи архивов",
      "ArchiveFix і ключі архівів",
      "ArchiveFix and archive keys",
      "ArchiveFix und Archivschlüssel",
      "ArchiveFix i klucze archiwów",
      "ArchiveFix et clés d'archives",
    ],
  },
  storage: {
    names: [
      "Хранилище",
      "Сховище",
      "Storage",
      "Speicher",
      "Pamięć",
      "Stockage",
    ],
    notes: [
      "Кэш, лимит места и папка",
      "Кеш, ліміт місця й тека",
      "Cache, size limit and folder",
      "Cache, Speicherlimit, Ordner",
      "Pamięć podręczna, limit i folder",
      "Cache, limite et dossier de données",
    ],
  },
  logs: {
    names: ["Логи", "Логи", "Logs", "Protokolle", "Logi", "Journaux"],
    notes: [
      "Журнал работы программы",
      "Журнал роботи",
      "App activity log",
      "Was die App aufzeichnet",
      "Co zapisuje aplikacja",
      "Ce que l'application enregistre",
    ],
  },
  maintenance: {
    names: [
      "Диагностика",
      "Діагностика",
      "Diagnostics",
      "Diagnose",
      "Diagnostyka",
      "Diagnostic",
    ],
    notes: [
      "Отчёты об ошибках и удаление Astral",
      "Звіти про помилки та видалення Astral",
      "Error reports and uninstalling Astral",
      "Fehlerberichte und Deinstallation von Astral",
      "Raporty błędów i usuwanie Astral",
      "Rapports d'erreurs et désinstallation d'Astral",
    ],
  },
  about: {
    names: [
      "О программе",
      "Про програму",
      "About",
      "Über",
      "O programie",
      "À propos",
    ],
    notes: [
      "Версия и обновления",
      "Версія й оновлення",
      "Version and updates",
      "Version und Updates",
      "Wersja i aktualizacje",
      "Version et mises à jour",
    ],
  },
};

// Остальные строки блока языка; порядок ключей здесь — порядок в блоке.
const PLAIN_TEXT = {
  back: ["Назад", "Назад", "Back", "Zurück", "Wstecz", "Retour"],
  search: [
    "Поиск настроек",
    "Пошук у налаштуваннях",
    "Search settings",
    "Einstellungen suchen",
    "Szukaj w ustawieniach",
    "Rechercher un paramètre",
  ],
  clear: [
    "Очистить поиск",
    "Очистити пошук",
    "Clear search",
    "Suche leeren",
    "Wyczyść wyszukiwanie",
    "Effacer la recherche",
  ],
  nothing: [
    "Ничего не нашлось",
    "Нічого не знайдено",
    "Nothing found",
    "Nichts gefunden",
    "Nic nie znaleziono",
    "Aucun résultat",
  ],
  nothingHint: [
    "Попробуйте другой запрос: «кэш», «язык», «папка»",
    "Спробуйте інший запит: «кеш», «мова», «тека»",
    "Try another query: “cache”, “language”, “folder”",
    "Versuch einen anderen Begriff: „Cache“, „Sprache“, „Ordner“",
    "Spróbuj innego zapytania: „pamięć”, „język”, „folder”",
    "Essayez une autre recherche\u00a0: «\u00a0cache\u00a0», «\u00a0langue\u00a0», «\u00a0dossier\u00a0»",
  ],
  changed: [
    "есть изменения",
    "є зміни",
    "changed",
    "geändert",
    "zmienione",
    "modifié",
  ],
  menu: [
    "Разделы настроек",
    "Розділи налаштувань",
    "Settings sections",
    "Bereiche der Einstellungen",
    "Sekcje ustawień",
    "Sections des paramètres",
  ],
  crumbs: [
    "Где вы в настройках",
    "Де ви в налаштуваннях",
    "Where you are in settings",
    "Wo Sie in den Einstellungen sind",
    "Gdzie jesteś w ustawieniach",
    "Où vous êtes dans les paramètres",
  ],
  reset: [
    "Сбросить",
    "Скинути",
    "Reset",
    "Zurücksetzen",
    "Resetuj",
    "Réinitialiser",
  ],
};

function mapValues(table, convert) {
  return Object.fromEntries(
    Object.entries(table).map(([key, value]) => [key, convert(value)]),
  );
}

function buildBlock(index) {
  return {
    groups: mapValues(GROUP_NAMES, (row) => row[index]),
    sections: mapValues(SECTION_TEXT, ({ names, notes }) => [
      names[index],
      notes[index],
    ]),
    ...mapValues(PLAIN_TEXT, (row) => row[index]),
  };
}

const BLOCKS = Object.fromEntries(
  LANGS.map((code, index) => [code, buildBlock(index)]),
);

export function settingsText(language) {
  return Object.hasOwn(BLOCKS, language) ? BLOCKS[language] : BLOCKS.en;
}

export const SETTINGS_GROUPS = Object.freeze(
  [
    ["account", ["profile"]],
    ["app", ["general", "appearance", "language"]],
    ["game", ["game", "rockstar", "tools"]],
    ["space", ["storage"]],
    ["support", ["logs", "maintenance", "about"]],
  ].map(([id, sections]) => ({ id, sections })),
);

export const READY_SECTIONS = Object.freeze([
  "profile",
  "general",
  "appearance",
  "language",
  "game",
  "rockstar",
  "tools",
  "storage",
  "logs",
  "maintenance",
  "about",
]);

export function groupOf(section) {
  return (
    SETTINGS_GROUPS.find((group) => group.sections.includes(section))?.id ??
    null
  );
}

const LANGUAGE_LIST = "Русский, English, Українська, Deutsch, Polski, Français";

// Пункты поиска: раздел, id, затем название и описание на ru и на en.
// Порядок строк задаёт порядок выдачи, поэтому «game/restore» стоит после пунктов диагностики.
const ITEM_ROWS = [
  [
    "profile",
    "account",
    "Аккаунт Astral",
    "Имя, аватар и роль",
    "Astral account",
    "Name, avatar and role",
  ],
  [
    "profile",
    "sign-out",
    "Выйти из аккаунта",
    "Следующий старт — с экрана входа",
    "Sign out",
    "Next launch opens the sign-in screen",
  ],
  [
    "general",
    "overview",
    "Сводка",
    "GTA V, место на диске и версия",
    "Overview",
    "GTA V, disk space and version",
  ],
  [
    "general",
    "startup",
    "Запуск",
    "Автозапуск с Windows и что открывать при старте",
    "Startup",
    "Run with Windows; what opens first",
  ],
  [
    "general",
    "close",
    "Закрытие окна",
    "Уйти в трей или выйти",
    "Closing the window",
    "Minimize to tray or quit",
  ],
  [
    "general",
    "folder",
    "Папка Astral",
    "Здесь лежат кэш и резервные копии",
    "Astral folder",
    "Holds the cache and backups",
  ],
  [
    "general",
    "hints",
    "Подсказки",
    "Подсказки в редакторах; «Пропустить» выключает их везде",
    "Hints",
    "Editor hints; “Skip” turns them off everywhere",
  ],
  [
    "appearance",
    "motion",
    "Анимации интерфейса",
    "Переходы и подвижный фон",
    "Interface animation",
    "Screen transitions and moving background",
  ],
  [
    "appearance",
    "look",
    "Акцент, знак и фон",
    "Цвет главной кнопки и знака, фон за окнами: свет, волны, линии",
    "Accent, logo and background",
    "Main button and logo color; window background: light, waves or lines",
  ],
  [
    "language",
    "language",
    "Язык интерфейса",
    LANGUAGE_LIST,
    "Interface language",
    LANGUAGE_LIST,
  ],
  [
    "game",
    "folder",
    "Папка GTA V",
    "Где лежит игра и как сменить",
    "GTA V folder",
    "Where the game is and how to change it",
  ],
  [
    "game",
    "loaders",
    "Загрузчики",
    "Архивы и плагины ASI",
    "Loaders",
    "Archives and ASI plugins",
  ],
  [
    "game",
    "copies",
    "Найденные копии",
    "Какая копия основная: Steam, Epic, Rockstar",
    "Found copies",
    "Which copy is main: Steam, Epic, Rockstar",
  ],
  [
    "game",
    "add-folder",
    "Добавить папку вручную",
    "Если Astral не нашёл игру",
    "Add a folder manually",
    "If Astral cannot find the game",
  ],
  [
    "game",
    "check",
    "Проверить файлы игры",
    "Сверка файлов, которые меняет Astral",
    "Check game files",
    "Compares the files Astral changes",
  ],
  [
    "rockstar",
    "mode",
    "Режим Rockstar Games Launcher",
    "Чистые файлы Rockstar, пока игра закрыта; моды встают при запуске",
    "Rockstar Games Launcher mode",
    "Clean Rockstar files while the game is closed; mods go in at launch",
  ],
  [
    "rockstar",
    "method",
    "Способ: автоматически или вручную",
    "Кто даёт команду на подмену: Astral сам или вы двумя кнопками",
    "Method: automatic or manual",
    "Who triggers the swap: Astral by itself or you with two buttons",
  ],
  [
    "rockstar",
    "how",
    "Как это работает",
    "Почему лаунчер Rockstar не стирает моды",
    "How it works",
    "Why the Rockstar launcher does not wipe the mods",
  ],
  [
    "rockstar",
    "log",
    "Журнал режима",
    "Что делал режим: запуск, подмена, возврат",
    "Mode journal",
    "What the mode did: launch, swap, restore",
  ],
  [
    "tools",
    "toolkit",
    "ArchiveFix и ключи архивов",
    "Готовит ArchiveFix с ключами к архивам",
    "ArchiveFix and archive keys",
    "Prepares ArchiveFix with archive keys",
  ],
  [
    "storage",
    "usage",
    "Занято Astral",
    "Сколько места занимают кэш и копии игры",
    "Storage used by Astral",
    "How much space the cache and game backups take",
  ],
  [
    "storage",
    "limit",
    "Лимит хранилища",
    "Старые загрузки удаляются",
    "Storage limit",
    "Past the limit, oldest are removed",
  ],
  [
    "storage",
    "folder",
    "Папка данных",
    "Открыть или перенести на другой диск",
    "Data folder",
    "Open or move to another disk",
  ],
  [
    "storage",
    "clear",
    "Очистить кэш",
    "Очистка кэша удалит пакеты",
    "Clear cache",
    "Deletes downloaded packages",
  ],
  [
    "storage",
    "cache",
    "Кэшировать скачанные моды",
    "Моды ставятся повторно без загрузки",
    "Cache downloaded mods",
    "Reinstall mods without downloading",
  ],
  [
    "storage",
    "backups",
    "Резервные копии игры",
    "Оригинальные файлы GTA V для возврата без модов",
    "Game backups",
    "Original GTA V files used to restore a mod-free game",
  ],
  [
    "logs",
    "log",
    "Журнал приложения",
    "Ошибки и установки; выгрузить в тикет",
    "App log",
    "Errors and installs; export for support",
  ],
  [
    "maintenance",
    "reports",
    "Отправлять отчёты об ошибках",
    "Отправляются без личных данных",
    "Send error reports",
    "Sent without personal data",
  ],
  [
    "game",
    "restore",
    "Вернуть GTA V без модов",
    "Удалит из игры все моды Astral",
    "Restore GTA V without mods",
    "Removes all Astral mods from the game",
  ],
  [
    "maintenance",
    "uninstall",
    "Удалить Astral из Windows",
    "Откроет удаление программ",
    "Uninstall Astral from Windows",
    "Opens Windows app removal",
  ],
  [
    "about",
    "version",
    "Версия Astral",
    "Номер версии и сборки",
    "Astral version",
    "Version and build number",
  ],
  [
    "about",
    "updates",
    "Обновления",
    "Канал, установленная версия и ход скачивания новой",
    "Updates",
    "Channel, installed version and progress of the new download",
  ],
  [
    "about",
    "updates-auto",
    "Скачивать обновления сами",
    "Новая версия качается в фоне",
    "Download updates automatically",
    "New versions download in the background",
  ],
  [
    "about",
    "updates-notes",
    "Что нового",
    "Заметки к версии",
    "What’s new",
    "Release notes",
  ],
  [
    "about",
    "branches",
    "Версии Astral",
    "Основная, Beta и Alpha: любую можно открыть или установить",
    "Astral versions",
    "Main, Beta and Alpha: open or install any of them",
  ],
  [
    "about",
    "community",
    "Сообщество",
    "Ссылки на Discord и Telegram",
    "Community",
    "Discord and Telegram links",
  ],
];

export const SETTINGS_ITEMS = Object.freeze(
  ITEM_ROWS.map(([section, id, ruTitle, ruHint, enTitle, enHint]) => ({
    id,
    section,
    words: { ru: [ruTitle, ruHint], en: [enTitle, enHint] },
  })),
);

// ---- Поиск ----

const fold = (text) =>
  String(text).toLocaleLowerCase("ru").replaceAll("ё", "е");

// Все названия и подписи раздела на шести языках одной строкой.
const SECTION_HAYSTACK = mapValues(SECTION_TEXT, ({ names, notes }) =>
  fold([...names, ...notes].join(" ")),
);

// Три слоя текста каждого пункта: только названия, названия с описаниями, всё вместе с текстом раздела.
const ITEM_INDEX = SETTINGS_ITEMS.map((item) => {
  const pairs = Object.values(item.words);
  const details = fold(pairs.flat().join(" "));
  return {
    item,
    titles: fold(pairs.map(([title]) => title).join(" ")),
    details,
    everything: `${details} ${SECTION_HAYSTACK[item.section]}`,
  };
});

// Название и описание пункта на языке окна, иначе на английском, иначе на русском.
function itemWords(item, language) {
  const code = [language, "en", "ru"].find((candidate) =>
    Object.hasOwn(item.words, candidate),
  );
  return code ? item.words[code] : ["", ""];
}

export function searchSettings(query, language, available) {
  if (typeof query !== "string") return [];
  const needles = fold(query).split(/\s+/).filter(Boolean);
  if (needles.length === 0) return [];

  const allowed = available ? new Set(available) : null;
  const shown = (section) =>
    READY_SECTIONS.includes(section) &&
    (allowed === null || allowed.has(section));
  const covers = (text) => needles.every((needle) => text.includes(needle));

  const byRank = [[], [], [], []];
  const sectionsWithItems = new Set();

  for (const { item, titles, details, everything } of ITEM_INDEX) {
    if (!shown(item.section) || !covers(everything)) continue;
    const rank = covers(titles) ? 0 : covers(details) ? 1 : 2;
    const [title, hint] = itemWords(item, language);
    byRank[rank].push({
      hint,
      id: item.id,
      rank,
      section: item.section,
      title,
    });
    sectionsWithItems.add(item.section);
  }

  const labels = settingsText(language).sections;
  for (const section of SETTINGS_GROUPS.flatMap((group) => group.sections)) {
    if (
      !shown(section) ||
      sectionsWithItems.has(section) ||
      !covers(SECTION_HAYSTACK[section])
    ) {
      continue;
    }
    const [title, hint] = labels[section];
    byRank[3].push({ hint, id: null, rank: 3, section, title });
  }

  if (byRank[0].length > 0 || byRank[1].length > 0) byRank[2] = [];
  return byRank.flat();
}
