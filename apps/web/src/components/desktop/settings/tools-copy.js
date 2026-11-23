// locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) записаны в этом файле, словарь окна не нужен.
import { formatSize } from "../../../catalog-utils.js";

/* Порядок языков в каждой строке таблиц ниже. */
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
const FALLBACK = LANGUAGES.indexOf("en");

const TITLE = [
  "Инструменты правки",
  "Інструменти правки",
  "Editing tools",
  "Werkzeuge",
  "Narzędzia edycji",
  "Outils de modification",
];

const LEDE = [
  "ArchiveFix и ключи для архивов игры. Astral загружает всё сам, искать в интернете не нужно. Каждый файл проверяется побайтово.",
  "ArchiveFix і ключі до архівів гри. Astral завантажує все сам, шукати в інтернеті не треба. Кожен файл перевіряється побайтово.",
  "ArchiveFix and keys for game archives. Astral downloads them itself, no need to search online. Every file is checked byte by byte.",
  "ArchiveFix und die Schlüssel für Spielarchive. Astral lädt sie selbst herunter, im Netz suchen musst du nichts. Jede Datei wird Byte für Byte geprüft.",
  "ArchiveFix i klucze do archiwów gry. Astral sam je pobiera, nie trzeba ich szukać w sieci. Każdy plik jest sprawdzany co do bajtu.",
  "ArchiveFix et les clés des archives du jeu. Astral télécharge tout lui-même, inutile de chercher en ligne. Chaque fichier est vérifié octet par octet.",
];

const BROWSER_ONLY = [
  "Набор ArchiveFix есть только в «Astral для Windows». Браузеру недоступны файлы GTA V, поэтому скачивать набор здесь не нужно.",
  "Набір ArchiveFix є лише в «Astral для Windows». Браузеру недоступні файли GTA V, тому завантажувати набір тут не потрібно.",
  "The ArchiveFix set exists only in “Astral for Windows”. A browser cannot reach the GTA V files, so downloading the set here makes no sense.",
  "Das ArchiveFix-Set gibt es nur in „Astral für Windows“. Ein Browser hat keinen Zugriff auf die GTA-V-Dateien, daher ist ein Download hier sinnlos.",
  "Zestaw ArchiveFix jest tylko w „Astral dla Windows”. Przeglądarka nie ma dostępu do plików GTA V, więc pobieranie zestawu tutaj nie ma sensu.",
  "Le kit ArchiveFix n'existe que dans «\u00a0Astral pour Windows\u00a0». Un navigateur n'a pas accès aux fichiers de GTA V, le télécharger ici n'a donc aucun sens.",
];

const BUSY = [
  "Готовим…",
  "Готуємо…",
  "Preparing…",
  "Wird vorbereitet…",
  "Przygotowujemy…",
  "Préparation…",
];

const RECHECK = [
  "Проверить заново",
  "Перевірити знову",
  "Check again",
  "Erneut prüfen",
  "Sprawdź ponownie",
  "Vérifier à nouveau",
];

const PREPARE = [
  "Подготовить набор",
  "Підготувати набір",
  "Prepare the set",
  "Set vorbereiten",
  "Przygotuj zestaw",
  "Préparer le kit",
];

/* Строка состояния «готово»: files — уже собранное «число и слово», size — общий размер. */
const READY = [
  (files, size) =>
    `Набор готов: ${files} на ${size}. Установки из мастерской без докачки.`,
  (files, size) =>
    `Набір готовий: ${files} на ${size}. Встановлення з майстерні без докачування.`,
  (files, size) =>
    `The set is ready: ${files} totaling ${size}. Workshop installs need no extra downloads.`,
  (files, size) =>
    `Das Set ist bereit: ${files} mit ${size}. Werkstatt-Installationen laden nichts nach.`,
  (files, size) =>
    `Zestaw gotowy: ${files}, razem ${size}. Instalacje z warsztatu bez dopobierania.`,
  (files, size) =>
    `Le kit est prêt\u00a0: ${files}, ${size}. Rien à compléter lors des installations.`,
];

/* Строка «набор неполный»: missing — объём недостающего, total — объём всего набора. */
const MISSING = [
  (missing, total) =>
    `Набор неполный: не хватает ${missing} из ${total}. Установка мода из мастерской докачает остальное сама, но придётся подождать.`,
  (missing, total) =>
    `Набір неповний: бракує ${missing} із ${total}. Встановлення моду з майстерні докачає решту саме, але доведеться зачекати.`,
  (missing, total) =>
    `The set is incomplete: ${missing} of ${total} is missing. Installing a mod from the workshop will fetch the rest itself, but you will have to wait.`,
  (missing, total) =>
    `Das Set ist unvollständig: Es fehlen ${missing} von ${total}. Die Installation eines Mods aus der Werkstatt lädt den Rest selbst nach, du musst aber warten.`,
  (missing, total) =>
    `Zestaw jest niepełny: brakuje ${missing} z ${total}. Instalacja moda z warsztatu sama dopobierze resztę, ale trzeba będzie poczekać.`,
  (missing, total) =>
    `Le kit est incomplet\u00a0: il manque ${missing} sur ${total}. L'installation d'un mod depuis l'atelier téléchargera le reste, mais il faudra patienter.`,
];

/* Формы слова «файл» по категориям Intl.PluralRules; у en, de, fr только one и other. */
const FILE_FORMS = [
  { one: "файл", few: "файла", many: "файлов", other: "файла" },
  { one: "файл", few: "файли", many: "файлів", other: "файлу" },
  { one: "file", other: "files" },
  { one: "Datei", other: "Dateien" },
  { one: "plik", few: "pliki", many: "plików", other: "pliku" },
  { one: "fichier", other: "fichiers" },
];

const STATE = {
  ready: ["готов", "готовий", "ready", "bereit", "gotowy", "prêt"],
  missing: ["нет", "немає", "missing", "fehlt", "brak", "absent"],
  stale: [
    "не совпадает",
    "не збігається",
    "mismatch",
    "stimmt nicht",
    "niezgodny",
    "non conforme",
  ],
};

const OPEN_FOLDER = [
  "Открыть папку",
  "Відкрити папку",
  "Open folder",
  "Ordner öffnen",
  "Otwórz folder",
  "Ouvrir le dossier",
];

const UNKNOWN_DETAIL = [
  "Элемент набора ArchiveFix",
  "Елемент набору ArchiveFix",
  "Part of the ArchiveFix set",
  "Teil des ArchiveFix-Sets",
  "Element zestawu ArchiveFix",
  "Élément du kit ArchiveFix",
];

/* Семь файлов набора: имя на диске, названия и описания по языкам. */
const TOOL_ROWS = [
  [
    "ArchiveFix.exe",
    [
      "ArchiveFix",
      "ArchiveFix",
      "ArchiveFix",
      "ArchiveFix",
      "ArchiveFix",
      "ArchiveFix",
    ],
    [
      "Пересобирает архив игры после правок, без неё патч не установить",
      "Перезбирає архів гри після змін, без неї патч не встановити",
      "Rebuilds the game archive after edits, without it a patch cannot be installed",
      "Baut das Spielarchiv nach Änderungen neu auf, ohne sie lässt sich kein Patch installieren",
      "Składa archiwum gry po zmianach, bez niego nie da się zainstalować łatki",
      "Reconstruit l'archive du jeu après les modifications\u00a0; sans lui, pas de patch possible",
    ],
  ],
  [
    "gtav_aes_key.dat",
    [
      "Ключ AES",
      "Ключ AES",
      "AES key",
      "AES-Schlüssel",
      "Klucz AES",
      "Clé AES",
    ],
    [
      "Ключ чтения служебных записей архивов",
      "Ключ читання службових записів архівів",
      "Key to the archives' internal records",
      "Schlüssel für interne Archiveinträge",
      "Klucz do wewnętrznych wpisów archiwów",
      "Clé de lecture des entrées internes des archives",
    ],
  ],
  [
    "gtav_ng_key.dat",
    ["Ключ NG", "Ключ NG", "NG key", "NG-Schlüssel", "Klucz NG", "Clé NG"],
    [
      "Ключ для записей в новых сборках игры",
      "Ключ до записів у новіших збірках гри",
      "Key for records in later game builds",
      "Schlüssel für Einträge neuerer Builds",
      "Klucz do wpisów nowszych wersji gry",
      "Clé pour les entrées des versions récentes du jeu",
    ],
  ],
  [
    "gtav_ng_decrypt_tables.dat",
    [
      "Таблицы расшифровки",
      "Таблиці розшифрування",
      "Decryption tables",
      "Entschlüsselungstabellen",
      "Tabele deszyfrowania",
      "Tables de déchiffrement",
    ],
    [
      "Для чтения: расшифровывают файл из архива",
      "Для читання: розшифровують файл з архіву",
      "For reading: decrypt a file from an archive",
      "Zum Lesen: Entschlüsselung einer Archivdatei",
      "Do odczytu: deszyfrują plik wyjęty z archiwum",
      "Pour lire\u00a0: déchiffrent un fichier de l'archive",
    ],
  ],
  [
    "gtav_ng_encrypt_tables.dat",
    [
      "Таблицы шифрования",
      "Таблиці шифрування",
      "Encryption tables",
      "Verschlüsselungstabellen",
      "Tabele szyfrowania",
      "Tables de chiffrement",
    ],
    [
      "Для записи: шифруют файл перед возвратом в архив",
      "Для запису: шифрують файл, що йде в архів",
      "For writing: encrypt a file for the archive",
      "Zum Schreiben: Verschlüsselung einer Archivdatei",
      "Do zapisu: szyfrują plik przed powrotem do archiwum",
      "Pour écrire\u00a0: chiffrent le fichier remis dans l'archive",
    ],
  ],
  [
    "gtav_ng_encrypt_luts.dat",
    [
      "Справочник шифрования",
      "Довідник шифрування",
      "Encryption lookup",
      "Verschlüsselungsverzeichnis",
      "Słownik szyfrowania",
      "Répertoire de chiffrement",
    ],
    [
      "Самый тяжёлый файл набора, качается дольше остальных",
      "Найважчий файл набору, завантажується найдовше",
      "The heaviest file in the set, so it downloads longest",
      "Die größte Datei des Sets, der Download dauert am längsten",
      "Najcięższy plik zestawu, pobiera się najdłużej",
      "Le fichier le plus lourd du kit, d'où un téléchargement plus long",
    ],
  ],
  [
    "gtav_hash_lut.dat",
    [
      "Таблица имён",
      "Таблиця імен",
      "Name table",
      "Namenstabelle",
      "Tabela nazw",
      "Table des noms",
    ],
    [
      "Превращает имя файла из архива в хеш",
      "Перетворює назву файлу з архіву на хеш",
      "Turns a file name from the archive into a hash",
      "Macht aus einem Archiv-Dateinamen einen Hash",
      "Zamienia nazwę pliku z archiwum na hash",
      "Transforme le nom d'un fichier de l'archive en hash",
    ],
  ],
];

/* Правила множественного числа создаются по запросу, по одному на язык. */
const pluralRules = new Map();

function categoryOf(language, count) {
  if (!Number.isFinite(count)) return "other";
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return rules.select(count);
}

const isFilled = (value) => typeof value === "string" && value.length > 0;

/**
 * Слова раздела «Инструменты» для языка окна. Незнакомый язык получает английские.
 * Каждый вызов возвращает новый объект.
 */
export function toolsCopyFor(language) {
  const found = LANGUAGES.indexOf(language);
  const index = found < 0 ? FALLBACK : found;
  const code = LANGUAGES[index];
  const forms = FILE_FORMS[index];
  const unknownDetail = UNKNOWN_DETAIL[index];
  const tools = Object.fromEntries(
    TOOL_ROWS.map(([file, titles, details]) => [
      file,
      [titles[index], details[index]],
    ]),
  );

  return {
    title: TITLE[index],
    lede: LEDE[index],
    browserOnly: BROWSER_ONLY[index],
    busy: BUSY[index],
    recheck: RECHECK[index],
    prepare: PREPARE[index],
    ready: READY[index],
    missing: MISSING[index],
    files: { ...forms },
    state: {
      ready: STATE.ready[index],
      missing: STATE.missing[index],
      stale: STATE.stale[index],
    },
    openFolder: OPEN_FOLDER[index],
    unknownDetail,
    tools,
    // Слова самого приложения (title, detail) берутся только на русском: иначе русский просочится в чужой язык.
    describe: (tool) => {
      const name = tool?.name;
      const known = Object.hasOwn(tools, name) ? tools[name] : [];
      const fromApp = code === "ru" ? tool : null;
      return {
        detail: [known[1], fromApp?.detail, unknownDetail].find(isFilled),
        title: [known[0], fromApp?.title, name].find(isFilled),
      };
    },
    fileCount: (count) =>
      `${count} ${forms[categoryOf(code, count)] ?? forms.other}`,
    size: (bytes) => formatSize(bytes, code),
  };
}
