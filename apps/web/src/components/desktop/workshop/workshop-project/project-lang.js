// locale-self-contained: сообщения проверки проекта мастерской на шести языках
import { createWorkshopLocalization } from "../workshop-localization.js";
import { tr } from "../../../../locales/ui.js";

const LANGUAGES = "ru uk en de pl fr".split(" ");
const SOURCE_LANGUAGE = LANGUAGES[0];
const WINDOW_LANGUAGES = new Set(LANGUAGES);

// Каталог сообщений: строка без отступа — ключ, под ней по строке «язык: шаблон»
// на каждый из шести языков. Вставки {0} и {1} подставляет projectMessage.
const CATALOG = `
unknownProjectModule
  ru: Неизвестный модуль проекта v9: {0}
  uk: Невідомий модуль проєкту v9: {0}
  en: Unknown project v9 module: {0}
  de: Unbekanntes Projektmodul v9: {0}
  pl: Nieznany moduł projektu v9: {0}
  fr: Module de projet v9 inconnu\u00a0: {0}

unknownModule
  ru: Неизвестный модуль: {0}
  uk: Невідомий модуль: {0}
  en: Unknown module: {0}
  de: Unbekanntes Modul: {0}
  pl: Nieznany moduł: {0}
  fr: Module inconnu\u00a0: {0}

noPlatform
  ru: {0} не поддерживает выбранную платформу
  uk: {0} не підтримує вибрану платформу
  en: {0} does not support the selected platform
  de: {0} unterstützt die gewählte Plattform nicht
  pl: {0} nie obsługuje wybranej platformy
  fr: {0} ne prend pas en charge la plateforme choisie

noConfig
  ru: {0}: отсутствует конфигурация
  uk: {0}: конфігурація відсутня
  en: {0}: configuration is missing
  de: {0}: Konfiguration fehlt
  pl: {0}: brak konfiguracji
  fr: {0}\u00a0: configuration manquante

noParam
  ru: {0}: отсутствует параметр «{1}»
  uk: {0}: відсутній параметр «{1}»
  en: {0}: missing setting “{1}”
  de: {0}: Parameter „{1}“ fehlt
  pl: {0}: brak parametru „{1}”
  fr: {0}\u00a0: paramètre «\u00a0{1}\u00a0» manquant

paramRange
  ru: {0}: параметр «{1}» вне допустимого диапазона
  uk: {0}: параметр «{1}» поза допустимим діапазоном
  en: {0}: setting “{1}” is outside the allowed range
  de: {0}: Parameter „{1}“ liegt außerhalb des zulässigen Bereichs
  pl: {0}: parametr „{1}” jest poza dozwolonym zakresem
  fr: {0}\u00a0: le paramètre «\u00a0{1}\u00a0» est hors de la plage autorisée

paramToggle
  ru: {0}: параметр «{1}» должен быть переключателем
  uk: {0}: параметр «{1}» має бути перемикачем
  en: {0}: setting “{1}” must be a toggle
  de: {0}: Parameter „{1}“ muss ein Schalter sein
  pl: {0}: parametr „{1}” musi być przełącznikiem
  fr: {0}\u00a0: le paramètre «\u00a0{1}\u00a0» doit être un interrupteur

badText
  ru: {0}: некорректный текст «{1}»
  uk: {0}: некоректний текст «{1}»
  en: {0}: invalid text “{1}”
  de: {0}: ungültiger Text „{1}“
  pl: {0}: nieprawidłowy tekst „{1}”
  fr: {0}\u00a0: texte «\u00a0{1}\u00a0» non valide

badColor
  ru: {0}: некорректный цвет «{1}»
  uk: {0}: некоректний колір «{1}»
  en: {0}: invalid color “{1}”
  de: {0}: ungültige Farbe „{1}“
  pl: {0}: nieprawidłowy kolor „{1}”
  fr: {0}\u00a0: couleur «\u00a0{1}\u00a0» non valide

unknownValue
  ru: {0}: неизвестное значение «{1}»
  uk: {0}: невідоме значення «{1}»
  en: {0}: unknown value “{1}”
  de: {0}: unbekannter Wert „{1}“
  pl: {0}: nieznana wartość „{1}”
  fr: {0}\u00a0: valeur «\u00a0{1}\u00a0» inconnue

weatherParam
  ru: Погода: некорректный параметр профиля «{0}»
  uk: Погода: некоректний параметр профілю «{0}»
  en: Weather: invalid profile setting “{0}”
  de: Wetter: ungültiger Profilparameter „{0}“
  pl: Pogoda: nieprawidłowy parametr profilu „{0}”
  fr: Météo\u00a0: paramètre de profil «\u00a0{0}\u00a0» non valide

impactParam
  ru: Попадания и декали: некорректный параметр материала «{0}»
  uk: Влучання та декалі: некоректний параметр матеріалу «{0}»
  en: Impacts and decals: invalid material setting “{0}”
  de: Einschläge und Decals: ungültiger Materialparameter „{0}“
  pl: Trafienia i dekale: nieprawidłowy parametr materiału „{0}”
  fr: Impacts et decals\u00a0: paramètre de matériau «\u00a0{0}\u00a0» non valide

timecycleValue
  ru: Таймциклы: некорректное значение «{0}» в ключевой точке
  uk: Таймцикли: некоректне значення «{0}» у ключовій точці
  en: Timecycles: invalid value “{0}” in a keyframe
  de: Timecycles: ungültiger Wert „{0}“ in einem Keyframe
  pl: Timecycle: nieprawidłowa wartość „{0}” w kluczowym punkcie
  fr: Timecycles\u00a0: valeur «\u00a0{0}\u00a0» non valide dans un point clé

paletteColor
  ru: Палитра: некорректный цвет «{0}»
  uk: Палітра: некоректний колір «{0}»
  en: Palette: invalid color “{0}”
  de: Palette: ungültige Farbe „{0}“
  pl: Paleta: nieprawidłowy kolor „{0}”
  fr: Palette\u00a0: couleur «\u00a0{0}\u00a0» non valide

assetTooBig
  ru: Assets: файл «{0}» больше 64 МБ
  uk: Assets: файл «{0}» більший за 64 МБ
  en: Assets: file “{0}” is larger than 64 MB
  de: Assets: Datei „{0}“ ist größer als 64 MB
  pl: Assets: plik „{0}” jest większy niż 64 MB
  fr: Assets\u00a0: le fichier «\u00a0{0}\u00a0» dépasse 64 Mo

assetHash
  ru: Assets: повреждён SHA-256 файла «{0}»
  uk: Assets: пошкоджено SHA-256 файлу «{0}»
  en: Assets: invalid SHA-256 for file “{0}”
  de: Assets: SHA-256 der Datei „{0}“ ist beschädigt
  pl: Assets: uszkodzona suma SHA-256 pliku „{0}”
  fr: Assets\u00a0: le SHA-256 du fichier «\u00a0{0}\u00a0» est corrompu

assetModule
  ru: Assets: файл «{0}» связан с отсутствующим модулем
  uk: Assets: файл «{0}» пов’язано з відсутнім модулем
  en: Assets: file “{0}” references a missing module
  de: Assets: Datei „{0}“ verweist auf ein fehlendes Modul
  pl: Assets: plik „{0}” odwołuje się do nieistniejącego modułu
  fr: Assets\u00a0: le fichier «\u00a0{0}\u00a0» est lié à un module absent

presetUnknownModule
  ru: Пресет не содержит поддерживаемых модулей: неизвестный модуль {0}
  uk: Пресет не містить підтримуваних модулів: невідомий модуль {0}
  en: The preset contains no supported modules: unknown module {0}
  de: Das Preset enthält keine unterstützten Module: unbekanntes Modul {0}
  pl: Preset nie zawiera obsługiwanych modułów: nieznany moduł {0}
  fr: Le preset ne contient aucun module pris en charge\u00a0: module {0} inconnu

packMissing
  ru: В astralpack отсутствует {0}
  uk: В astralpack відсутнє {0}
  en: The astralpack is missing {0}
  de: Im astralpack fehlt {0}
  pl: W astralpack brakuje: {0}
  fr: Il manque {0} dans l'astralpack

jsonBroken
  ru: {0} содержит некорректный JSON
  uk: {0} містить некоректний JSON
  en: {0} contains invalid JSON
  de: {0} enthält ungültiges JSON
  pl: {0} zawiera nieprawidłowy JSON
  fr: {0} contient du JSON non valide

forbiddenFile
  ru: Пакет содержит запрещённый файл: {0}
  uk: Пакет містить заборонений файл: {0}
  en: The package contains a forbidden file: {0}
  de: Das Paket enthält eine verbotene Datei: {0}
  pl: Paczka zawiera zabroniony plik: {0}
  fr: Le paquet contient un fichier interdit\u00a0: {0}

undeclaredPath
  ru: Пакет содержит необъявленный путь: {0}
  uk: Пакет містить неоголошений шлях: {0}
  en: The package contains an undeclared path: {0}
  de: Das Paket enthält einen nicht deklarierten Pfad: {0}
  pl: Paczka zawiera niezadeklarowaną ścieżkę: {0}
  fr: Le paquet contient un chemin non déclaré\u00a0: {0}

duplicatePath
  ru: Пакет содержит дублирующийся путь: {0}
  uk: Пакет містить дубльований шлях: {0}
  en: The package contains a duplicate path: {0}
  de: Das Paket enthält einen doppelten Pfad: {0}
  pl: Paczka zawiera zduplikowaną ścieżkę: {0}
  fr: Le paquet contient un chemin en double\u00a0: {0}

checksumMismatch
  ru: Контрольная сумма не совпадает: {0}
  uk: Контрольна сума не збігається: {0}
  en: Checksum mismatch: {0}
  de: Prüfsumme stimmt nicht überein: {0}
  pl: Suma kontrolna się nie zgadza: {0}
  fr: La somme de contrôle ne correspond pas\u00a0: {0}

unsafeExportPath
  ru: Небезопасный путь экспорта: {0}
  uk: Небезпечний шлях експорту: {0}
  en: Unsafe export path: {0}
  de: Unsicherer Exportpfad: {0}
  pl: Niebezpieczna ścieżka eksportu: {0}
  fr: Chemin d'exportation non sûr\u00a0: {0}

badAsset
  ru: Некорректный asset «{0}»: {1}
  uk: Некоректний asset «{0}»: {1}
  en: Invalid asset “{0}”: {1}
  de: Ungültiges Asset „{0}“: {1}
  pl: Nieprawidłowy asset „{0}”: {1}
  fr: Asset «\u00a0{0}\u00a0» non valide\u00a0: {1}

assetNotInPack
  ru: Asset «{0}» отсутствует в astralpack
  uk: Asset «{0}» відсутній в astralpack
  en: Asset “{0}” is missing from the astralpack
  de: Asset „{0}“ fehlt im astralpack
  pl: Brak assetu „{0}” w astralpack
  fr: L'asset «\u00a0{0}\u00a0» est absent de l'astralpack

assetPathTwice
  ru: Путь asset объявлен повторно: {0}
  uk: Шлях asset оголошено повторно: {0}
  en: Asset path is declared more than once: {0}
  de: Asset-Pfad wurde mehrfach deklariert: {0}
  pl: Ścieżka assetu została zadeklarowana ponownie: {0}
  fr: Le chemin de l'asset est déclaré plusieurs fois\u00a0: {0}

assetMeta
  ru: Метаданные asset «{0}» не совпадают с manifest
  uk: Метадані asset «{0}» не збігаються з manifest
  en: Asset “{0}” metadata does not match the manifest
  de: Die Metadaten des Assets „{0}“ stimmen nicht mit dem Manifest überein
  pl: Metadane assetu „{0}” nie zgadzają się z manifestem
  fr: Les métadonnées de l'asset «\u00a0{0}\u00a0» ne correspondent pas au manifest

assetSize
  ru: Размер asset «{0}» не совпадает с manifest
  uk: Розмір asset «{0}» не збігається з manifest
  en: Asset “{0}” size does not match the manifest
  de: Die Größe des Assets „{0}“ stimmt nicht mit dem Manifest überein
  pl: Rozmiar assetu „{0}” nie zgadza się z manifestem
  fr: La taille de l'asset «\u00a0{0}\u00a0» ne correspond pas au manifest

assetSha
  ru: SHA-256 asset «{0}» не совпадает
  uk: SHA-256 asset «{0}» не збігається
  en: Asset “{0}” SHA-256 does not match
  de: SHA-256 des Assets „{0}“ stimmt nicht überein
  pl: SHA-256 assetu „{0}” się nie zgadza
  fr: Le SHA-256 de l'asset «\u00a0{0}\u00a0» ne correspond pas

undeclaredAsset
  ru: Пакет содержит необъявленный asset: {0}
  uk: Пакет містить неоголошений asset: {0}
  en: The package contains an undeclared asset: {0}
  de: Das Paket enthält ein nicht deklariertes Asset: {0}
  pl: Paczka zawiera niezadeklarowany asset: {0}
  fr: Le paquet contient un asset non déclaré\u00a0: {0}

previewSize
  ru: Preview превышает безопасный размер: {0}
  uk: Preview перевищує безпечний розмір: {0}
  en: Preview exceeds the safe size limit: {0}
  de: Die Vorschau überschreitet die sichere Größe: {0}
  pl: Podgląd przekracza bezpieczny limit rozmiaru: {0}
  fr: L'aperçu dépasse la taille sûre\u00a0: {0}

noStorageKey
  ru: У файла «{0}» отсутствует ключ хранилища
  uk: У файлу «{0}» відсутній ключ сховища
  en: File “{0}” has no storage key
  de: Die Datei „{0}“ hat keinen Speicherschlüssel
  pl: Plik „{0}” nie ma klucza magazynu
  fr: Le fichier «\u00a0{0}\u00a0» n'a pas de clé de stockage

localMissing
  ru: Локальный файл «{0}» не найден
  uk: Локальний файл «{0}» не знайдено
  en: Local file “{0}” was not found
  de: Lokale Datei „{0}“ wurde nicht gefunden
  pl: Nie znaleziono pliku lokalnego „{0}”
  fr: Fichier local «\u00a0{0}\u00a0» introuvable
`;

function readCatalog(source) {
  const tables = Object.create(null);
  for (const code of LANGUAGES) tables[code] = Object.create(null);

  let key = "";
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    if (!line.startsWith(" ")) {
      key = line;
      continue;
    }
    const colon = line.indexOf(": ");
    const table = tables[line.slice(0, colon).trim()];
    if (!table)
      throw new Error(`Unknown language in project messages: ${line}`);
    table[key] = line.slice(colon + 2);
  }
  return tables;
}

// Шаблоны по языкам: TEMPLATES[язык][ключ]. Таблицы без прототипа, чтобы
// имена вроде toString не принимались за ключи.
const TEMPLATES = readCatalog(CATALOG);

// Запоминает результат по имени: любой, даже undefined; если вычисление
// бросило исключение, ничего не запоминается и в следующий раз оно повторится.
function rememberBy(compute) {
  const answers = Object.create(null);
  return (name) => {
    if (!(name in answers)) answers[name] = compute(name);
    return answers[name];
  };
}

const localizationOf = rememberBy(createWorkshopLocalization);

// Подставляет значения вместо {цифра} за один проход: вставленный текст
// заново не разбирается. Лишние значения игнорируются, недостающее даёт «undefined».
function fillSlots(template, values) {
  const [head, ...chunks] = template.split("{");
  let text = head;
  for (const chunk of chunks) {
    const isSlot = chunk[1] === "}" && chunk[0] >= "0" && chunk[0] <= "9";
    text += isSlot ? String(values[chunk[0]]) + chunk.slice(2) : `{${chunk}`;
  }
  return text;
}

// Подпись параметра: первый контрол модуля с ключом, строго равным key.
function labelOf(definition, key) {
  if (definition === undefined || definition === null) return undefined;
  for (const control of definition.controls) {
    if (control.key === key) return control.label;
  }
  return undefined;
}

// Значение, если оно ровно одно из допустимых (без приведения типов), иначе запасное.
const oneOf = (allowed, value, fallback) =>
  allowed.has(value) ? value : fallback;

// Язык окна узнаём по ответу tr на служебную строку: у не-русских языков
// перевод этой строки равен коду языка, у русского перевода нет.
export const projectLanguage = () =>
  oneOf(WINDOW_LANGUAGES, tr("Язык окна"), SOURCE_LANGUAGE);

// Значение у соседа; в русском окне соседа не зовут, а пустое значение
// заменяется исходным (оно возвращается как есть).
const localized = (fallback, pick) => {
  const language = projectLanguage();
  const found =
    language === SOURCE_LANGUAGE ? undefined : pick(localizationOf(language));
  return found || fallback;
};

export const projectMessage = (key, ...values) => {
  const language = projectLanguage();
  const id = String(key);
  const template = TEMPLATES[language][id];
  if (template === undefined)
    throw new TypeError(`Unknown project message: ${id}`);
  return fillSlots(template, values);
};

export const moduleTitle = (moduleId, fallback) =>
  localized(
    fallback,
    (localization) => localization.moduleMap[moduleId]?.title,
  );

export const controlLabel = (moduleId, key, fallback) =>
  localized(fallback, ({ moduleMap }) => labelOf(moduleMap[moduleId], key));
