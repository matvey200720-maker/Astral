// Сообщения кастомизатора фасадов торгового центра на шести языках окна.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Шаблоны по порядку LANGUAGES. {0}, {1}… — аргументы по номеру.
// Во французских «ёлочках» и перед «;» стоит неразрывный пробел.
const TEMPLATES = {
  themeApplied: [
    "Применена тема «{0}»",
    "Застосовано тему «{0}»",
    "Theme “{0}” applied",
    "Thema „{0}“ angewendet",
    "Zastosowano motyw „{0}”",
    "Thème « {0} » appliqué",
  ],
  imageAdded: [
    "Изображение {0} × {1} добавлено",
    "Зображення {0} × {1} додано",
    "Image {0} × {1} added",
    "Bild {0} × {1} hinzugefügt",
    "Dodano obraz {0} × {1}",
    "Image {0} × {1} ajoutée",
  ],
  imageBelowMinimum: [
    "Изображение добавлено, но {0} × {1} ниже минимума {2} × {3}",
    "Зображення додано, але {0} × {1} менше за мінімум {2} × {3}",
    "Image added, but {0} × {1} is below the minimum of {2} × {3}",
    "Bild hinzugefügt, aber {0} × {1} liegt unter dem Minimum von {2} × {3}",
    "Obraz dodany, ale {0} × {1} jest poniżej minimum {2} × {3}",
    "Image ajoutée, mais {0} × {1} est inférieur au minimum de {2} × {3}",
  ],
  saved: [
    "Проект «{0}» сохранён локально",
    "Проєкт «{0}» збережено локально",
    "Project “{0}” saved locally",
    "Projekt „{0}“ lokal gespeichert",
    "Projekt „{0}” zapisany lokalnie",
    "Projet « {0} » enregistré localement",
  ],
  // {1} — окончание «s» французского «fichier»
  exported: [
    "Проект и {0} source-файлов экспортированы в .astralpack",
    "Проєкт і {0} source-файлів експортовано в .astralpack",
    "Project and {0} source files exported to .astralpack",
    "Projekt und {0} Source-Dateien nach .astralpack exportiert",
    "Projekt i {0} plików source wyeksportowano do .astralpack",
    "Projet et {0} fichier{1} source exportés vers .astralpack",
  ],
  imported: [
    "Проект и {0} source-файлов импортированы",
    "Проєкт і {0} source-файлів імпортовано",
    "Project and {0} source files imported",
    "Projekt und {0} Source-Dateien importiert",
    "Projekt i {0} plików source zaimportowano",
    "Projet et {0} fichier{1} source importés",
  ],
  installed: [
    "{0} установлен как изолированный Astral DLC в newmods",
    "{0} встановлено як ізольований Astral DLC у newmods",
    "{0} installed as an isolated Astral DLC in newmods",
    "{0} als isoliertes Astral-DLC in newmods installiert",
    "{0} zainstalowano jako izolowany Astral DLC w newmods",
    "{0} installé comme DLC Astral isolé dans newmods",
  ],
  applyFailed: [
    "Не удалось применить план для «{0}»",
    "Не вдалося застосувати план для «{0}»",
    "Could not apply the plan for “{0}”",
    "Der Plan für „{0}“ konnte nicht angewendet werden",
    "Nie udało się zastosować planu dla „{0}”",
    "Impossible d’appliquer le plan pour « {0} »",
  ],
  removed: [
    "Overlay «{0}» удалён; активный набор модов пересобран",
    "Overlay «{0}» видалено; активний набір модів перезібрано",
    "Overlay “{0}” removed; the active mod set was rebuilt",
    "Overlay „{0}“ entfernt; das aktive Mod-Set wurde neu zusammengestellt",
    "Overlay „{0}” usunięty; aktywny zestaw modów przebudowano",
    "Overlay « {0} » supprimé ; l’ensemble de mods actif a été reconstruit",
  ],
  removeFailed: [
    "Не удалось удалить overlay «{0}»",
    "Не вдалося видалити overlay «{0}»",
    "Could not remove overlay “{0}”",
    "Overlay „{0}“ konnte nicht entfernt werden",
    "Nie udało się usunąć overlay „{0}”",
    "Impossible de supprimer l’overlay « {0} »",
  ],
  surfaceOnly: [
    "Меняется только поверхность «{0}»",
    "Змінюється лише поверхня «{0}»",
    "Only the “{0}” surface changes",
    "Es ändert sich nur die Fläche „{0}“",
    "Zmienia się tylko powierzchnia „{0}”",
    "Seule la surface « {0} » est modifiée",
  ],
};

// Единственное число только у самих чисел 0 и 1 (и -0); строка "1" — уже множественное.
const frenchPlural = (count) => (count === 0 || count === 1 ? "" : "s");

function buildCopy(languageIndex) {
  // Аргументы вставляются как есть, без форматирования чисел и экранирования.
  const say = (key, ...values) =>
    TEMPLATES[key][languageIndex].replace(
      /\{(\d)\}/g,
      (_, slot) => values[slot],
    );

  return {
    themeApplied: (label) => say("themeApplied", label),
    imageAdded: (width, height) => say("imageAdded", width, height),
    imageBelowMinimum: (width, height, minWidth, minHeight) =>
      say("imageBelowMinimum", width, height, minWidth, minHeight),
    saved: (name) => say("saved", name),
    exported: (count) => say("exported", count, frenchPlural(count)),
    imported: (count) => say("imported", count, frenchPlural(count)),
    installed: (name) => say("installed", name),
    applyFailed: (name) => say("applyFailed", name),
    removed: (name) => say("removed", name),
    removeFailed: (name) => say("removeFailed", name),
    surfaceOnly: (label) => say("surfaceOnly", label),
  };
}

const COPIES = Object.fromEntries(
  LANGUAGES.map((language, index) => [language, buildCopy(index)]),
);

// Поиск по обычному свойству: «toString» и подобные имена отдают не набор, а
// встроенное значение — так ведёт себя эталон. Всё остальное незнакомое — русский.
export function megaMallCopyFor(language) {
  return COPIES[language] ?? COPIES.ru;
}
