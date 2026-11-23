/* locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) написаны в этом файле, словарь `ui-text` ему не нужен. */
/*
 * «Последние падения игры» на языке окна (ТЗ владельца 11.11.2026, журнал падений). Причина падения приходит из
 * приложения кодом и параметрами (`reason.code`, `reason.params`), а не готовой строкой: русская строка из журнала
 * поддержки в окне не показывается. Неразрывные пробелы французского — только escape `\u00a0` (правило репозитория).
 */

const COPY = {
  ru: {
    title: "Последние падения игры",
    lede: "После выхода из игры Astral сам смотрит журналы Windows, Majestic и RAGE MP и записывает, где и из-за чего она упала. Ничего не отправляется само.",
    empty: "За последние дни игра не падала.",
    starting: "Журнал падений ещё запускается.",
    scan: "Проверить сейчас",
    scanning: "Проверяем…",
    scanBusy: "Проверка уже идёт",
    download: "Скачать логи для тикета",
    downloadHint: "Приложи этот архив к тикету целиком — со всеми журналами",
    supportDone: (name) =>
      `Журнал сохранён: ${name}. Приложите его к тикету в Discord.`,
    canceled: "Сохранение отменено",
    failed: "Не получилось",
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "Игра",
    },
    kind: { crash: "Падение", hang: "Зависание" },
    reason: {
      "invalid-asset": ({ asset, count, more }) =>
        `Не загрузился файл «${asset}»${count > 1 ? ` (${count} раз подряд)` : ""}${more > 0 ? `, ещё файлов: ${more}` : ""}, и клиент аварийно закрыл игру`,
      "out-of-memory": () => "Не хватило памяти",
      hang: () => "Игра перестала отвечать, Windows её закрыла",
      "client-fatal": ({ line }) =>
        `Клиент записал критическую ошибку: «${line}»`,
      "access-violation": () => "Обращение к недоступной памяти",
      "fail-fast": () => "Аварийное завершение процесса",
      "illegal-instruction": () =>
        "Недопустимая инструкция (чаще всего битый или перекрытый модуль)",
      "stack-overflow": () => "Переполнение стека",
      "heap-corruption": () => "Повреждена память (heap)",
      "divide-by-zero": () => "Деление на ноль",
      "in-page-error": () => "Не удалось прочитать файл с диска",
      "dll-init": () => "Не запустилась библиотека",
      "dll-missing": () => "Не нашлась нужная библиотека",
      "cpp-exception": () => "Необработанная ошибка в коде",
      breakpoint: () => "Внутренняя ошибка",
      "internal-error": () => "Внутренняя ошибка",
      unknown: ({ hex }) =>
        hex ? `Исключение 0x${hex}` : "Причина не записана",
    },
    foreign: (name) => `Файл «${name}» не из Astral.`,
    noMods: "Моды не проверялись: записи об установке недоступны.",
    details: "Подробности",
    process: "Процесс",
    module: "Модуль",
    exception: "Код",
    mods: (count) => `Модов Astral стояло: ${count}`,
    evidence: "Что записано в журналах",
    notice: (where) =>
      `Игра упала (${where}). Подробности — в «Настройки → Логи».`,
  },
  uk: {
    title: "Останні падіння гри",
    lede: "Після виходу з гри Astral сам дивиться журнали Windows, Majestic і RAGE MP та записує, де і через що вона впала. Нічого не надсилається саме.",
    empty: "За останні дні гра не падала.",
    starting: "Журнал падінь ще запускається.",
    scan: "Перевірити зараз",
    scanning: "Перевіряємо…",
    scanBusy: "Перевірка вже триває",
    download: "Завантажити логи для тікета",
    downloadHint: "Додай цей архів до тікета цілком — з усіма журналами",
    supportDone: (name) =>
      `Журнал збережено: ${name}. Додайте його до тікета в Discord.`,
    canceled: "Збереження скасовано",
    failed: "Не вийшло",
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "Гра",
    },
    kind: { crash: "Падіння", hang: "Зависання" },
    reason: {
      "invalid-asset": ({ asset, count, more }) =>
        `Не завантажився файл «${asset}»${count > 1 ? ` (${count} разів поспіль)` : ""}${more > 0 ? `, ще файлів: ${more}` : ""}, і клієнт аварійно закрив гру`,
      "out-of-memory": () => "Не вистачило пам'яті",
      hang: () => "Гра перестала відповідати, Windows її закрила",
      "client-fatal": ({ line }) =>
        `Клієнт записав критичну помилку: «${line}»`,
      "access-violation": () => "Звернення до недоступної пам'яті",
      "fail-fast": () => "Аварійне завершення процесу",
      "illegal-instruction": () =>
        "Недопустима інструкція (найчастіше пошкоджений або перекритий модуль)",
      "stack-overflow": () => "Переповнення стека",
      "heap-corruption": () => "Пошкоджено пам'ять (heap)",
      "divide-by-zero": () => "Ділення на нуль",
      "in-page-error": () => "Не вдалося прочитати файл із диска",
      "dll-init": () => "Не запустилася бібліотека",
      "dll-missing": () => "Не знайшлася потрібна бібліотека",
      "cpp-exception": () => "Необроблена помилка в коді",
      breakpoint: () => "Внутрішня помилка",
      "internal-error": () => "Внутрішня помилка",
      unknown: ({ hex }) => (hex ? `Виняток 0x${hex}` : "Причину не записано"),
    },
    foreign: (name) => `Файл «${name}» не з Astral.`,
    noMods: "Моди не перевірялися: записи про встановлення недоступні.",
    details: "Подробиці",
    process: "Процес",
    module: "Модуль",
    exception: "Код",
    mods: (count) => `Модів Astral стояло: ${count}`,
    evidence: "Що записано в журналах",
    notice: (where) =>
      `Гра впала (${where}). Подробиці — в «Налаштування → Журнал».`,
  },
  en: {
    title: "Recent game crashes",
    lede: "After you quit the game, Astral reads the Windows, Majestic and RAGE MP logs and notes where and why it crashed. Nothing is sent on its own.",
    empty: "No game crashes in recent days.",
    starting: "The crash log is still starting.",
    scan: "Check now",
    scanning: "Checking…",
    scanBusy: "A check is already running",
    download: "Download logs for a ticket",
    downloadHint:
      "Attach this archive to your ticket as a whole — with all the logs",
    supportDone: (name) =>
      `Log saved: ${name}. Attach it to a ticket on Discord.`,
    canceled: "Saving canceled",
    failed: "Did not work",
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "Game",
    },
    kind: { crash: "Crash", hang: "Freeze" },
    reason: {
      "invalid-asset": ({ asset, count, more }) =>
        `The file “${asset}” failed to load${count > 1 ? ` (${count} times in a row)` : ""}${more > 0 ? `, plus ${more} more` : ""}, and the client shut the game down`,
      "out-of-memory": () => "Out of memory",
      hang: () => "The game stopped responding and Windows closed it",
      "client-fatal": ({ line }) =>
        `The client logged a critical error: “${line}”`,
      "access-violation": () => "Access to unavailable memory",
      "fail-fast": () => "The process was terminated abruptly",
      "illegal-instruction": () =>
        "Illegal instruction (usually a broken or overwritten module)",
      "stack-overflow": () => "Stack overflow",
      "heap-corruption": () => "Heap memory corrupted",
      "divide-by-zero": () => "Division by zero",
      "in-page-error": () => "A file could not be read from the disk",
      "dll-init": () => "A library failed to start",
      "dll-missing": () => "A required library was not found",
      "cpp-exception": () => "Unhandled error in code",
      breakpoint: () => "Internal error",
      "internal-error": () => "Internal error",
      unknown: ({ hex }) => (hex ? `Exception 0x${hex}` : "Cause not recorded"),
    },
    foreign: (name) => `The file “${name}” is not from Astral.`,
    noMods: "Mods were not checked: install records are unavailable.",
    details: "Details",
    process: "Process",
    module: "Module",
    exception: "Code",
    mods: (count) => `Astral mods installed: ${count}`,
    evidence: "What the logs say",
    notice: (where) =>
      `The game crashed (${where}). Details are in Settings → Logs.`,
  },
  de: {
    title: "Letzte Spielabstürze",
    lede: "Nach dem Beenden des Spiels liest Astral die Protokolle von Windows, Majestic und RAGE MP und vermerkt, wo und warum es abgestürzt ist. Nichts wird von selbst gesendet.",
    empty: "In den letzten Tagen gab es keine Spielabstürze.",
    starting: "Das Absturzprotokoll startet noch.",
    scan: "Jetzt prüfen",
    scanning: "Wird geprüft…",
    scanBusy: "Es läuft bereits eine Prüfung",
    download: "Protokolle für ein Ticket herunterladen",
    downloadHint:
      "Hänge dieses Archiv vollständig an dein Ticket — mit allen Protokollen",
    supportDone: (name) =>
      `Protokoll gespeichert: ${name}. Füge es dem Ticket auf Discord bei.`,
    canceled: "Speichern abgebrochen",
    failed: "Hat nicht geklappt",
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "Spiel",
    },
    kind: { crash: "Absturz", hang: "Hänger" },
    reason: {
      "invalid-asset": ({ asset, count, more }) =>
        `Die Datei „${asset}“ ließ sich nicht laden${count > 1 ? ` (${count}-mal hintereinander)` : ""}${more > 0 ? `, dazu ${more} weitere` : ""}, und der Client hat das Spiel abgebrochen`,
      "out-of-memory": () => "Nicht genug Speicher",
      hang: () =>
        "Das Spiel reagierte nicht mehr und wurde von Windows beendet",
      "client-fatal": ({ line }) =>
        `Der Client hat einen kritischen Fehler protokolliert: „${line}“`,
      "access-violation": () => "Zugriff auf nicht verfügbaren Speicher",
      "fail-fast": () => "Prozess abrupt beendet",
      "illegal-instruction": () =>
        "Ungültiger Befehl (meist ein defektes oder überschriebenes Modul)",
      "stack-overflow": () => "Stapelüberlauf",
      "heap-corruption": () => "Speicher (Heap) beschädigt",
      "divide-by-zero": () => "Division durch null",
      "in-page-error": () =>
        "Eine Datei ließ sich nicht von der Festplatte lesen",
      "dll-init": () => "Eine Bibliothek ließ sich nicht starten",
      "dll-missing": () => "Eine nötige Bibliothek wurde nicht gefunden",
      "cpp-exception": () => "Unbehandelter Fehler im Code",
      breakpoint: () => "Interner Fehler",
      "internal-error": () => "Interner Fehler",
      unknown: ({ hex }) =>
        hex ? `Ausnahme 0x${hex}` : "Ursache nicht protokolliert",
    },
    foreign: (name) => `Die Datei „${name}“ stammt nicht von Astral.`,
    noMods: "Mods wurden nicht geprüft: Installationsdaten nicht verfügbar.",
    details: "Details",
    process: "Prozess",
    module: "Modul",
    exception: "Code",
    mods: (count) => `Astral-Mods installiert: ${count}`,
    evidence: "Was die Protokolle zeigen",
    notice: (where) =>
      `Das Spiel ist abgestürzt (${where}). Details unter Einstellungen → Protokoll.`,
  },
  pl: {
    title: "Ostatnie awarie gry",
    lede: "Po wyjściu z gry Astral czyta dzienniki Windows, Majestic i RAGE MP i zapisuje, gdzie i dlaczego gra uległa awarii. Nic nie jest wysyłane samo.",
    empty: "W ostatnich dniach nie było awarii gry.",
    starting: "Dziennik awarii jeszcze się uruchamia.",
    scan: "Sprawdź teraz",
    scanning: "Sprawdzam…",
    scanBusy: "Sprawdzanie już trwa",
    download: "Pobierz dzienniki do zgłoszenia",
    downloadHint:
      "Dołącz to archiwum do zgłoszenia w całości — ze wszystkimi dziennikami",
    supportDone: (name) =>
      `Dziennik zapisany: ${name}. Dołącz go do zgłoszenia na Discordzie.`,
    canceled: "Zapis anulowany",
    failed: "Nie udało się",
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "Gra",
    },
    kind: { crash: "Awaria", hang: "Zawieszenie" },
    reason: {
      "invalid-asset": ({ asset, count, more }) =>
        `Nie wczytał się plik „${asset}”${count > 1 ? ` (${count} razy z rzędu)` : ""}${more > 0 ? `, jeszcze plików: ${more}` : ""}, a klient awaryjnie zamknął grę`,
      "out-of-memory": () => "Zabrakło pamięci",
      hang: () => "Gra przestała odpowiadać i Windows ją zamknął",
      "client-fatal": ({ line }) => `Klient zapisał błąd krytyczny: „${line}”`,
      "access-violation": () => "Odwołanie do niedostępnej pamięci",
      "fail-fast": () => "Awaryjne zakończenie procesu",
      "illegal-instruction": () =>
        "Niedozwolona instrukcja (najczęściej uszkodzony lub nadpisany moduł)",
      "stack-overflow": () => "Przepełnienie stosu",
      "heap-corruption": () => "Uszkodzona pamięć (sterta)",
      "divide-by-zero": () => "Dzielenie przez zero",
      "in-page-error": () => "Nie udało się odczytać pliku z dysku",
      "dll-init": () => "Biblioteka nie uruchomiła się",
      "dll-missing": () => "Nie znaleziono potrzebnej biblioteki",
      "cpp-exception": () => "Nieobsłużony błąd w kodzie",
      breakpoint: () => "Błąd wewnętrzny",
      "internal-error": () => "Błąd wewnętrzny",
      unknown: ({ hex }) =>
        hex ? `Wyjątek 0x${hex}` : "Przyczyna nie została zapisana",
    },
    foreign: (name) => `Plik „${name}” nie pochodzi z Astral.`,
    noMods: "Mody nie były sprawdzane: brak danych instalacji.",
    details: "Szczegóły",
    process: "Proces",
    module: "Moduł",
    exception: "Kod",
    mods: (count) => `Zainstalowanych modów Astral: ${count}`,
    evidence: "Co zapisano w dziennikach",
    notice: (where) =>
      `Gra uległa awarii (${where}). Szczegóły w Ustawienia → Dziennik.`,
  },
  fr: {
    title: "Derniers plantages du jeu",
    lede: "Après la fermeture du jeu, Astral lit les journaux de Windows, de Majestic et de RAGE MP et note où et pourquoi il a planté. Rien n'est envoyé automatiquement.",
    empty: "Aucun plantage du jeu ces derniers jours.",
    starting: "Le journal des plantages est encore en cours de démarrage.",
    scan: "Vérifier maintenant",
    scanning: "Vérification…",
    scanBusy: "Une vérification est déjà en cours",
    download: "Télécharger les journaux pour un ticket",
    downloadHint:
      "Joignez cette archive au ticket en entier — avec tous les journaux",
    supportDone: (name) =>
      `Journal enregistré\u00a0: ${name}. Joignez-le au ticket sur Discord.`,
    canceled: "Enregistrement annulé",
    failed: "Ça n'a pas marché",
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "Jeu",
    },
    kind: { crash: "Plantage", hang: "Blocage" },
    reason: {
      "invalid-asset": ({ asset, count, more }) =>
        `Le fichier «\u00a0${asset}\u00a0» n'a pas pu être chargé${count > 1 ? ` (${count} fois de suite)` : ""}${more > 0 ? `, ainsi que ${more} autre${more > 1 ? "s" : ""}` : ""}, puis le client a fermé le jeu en urgence`,
      "out-of-memory": () => "Mémoire insuffisante",
      hang: () => "Le jeu ne répondait plus et Windows l'a fermé",
      "client-fatal": ({ line }) =>
        `Le client a enregistré une erreur critique\u00a0: «\u00a0${line}\u00a0»`,
      "access-violation": () => "Accès à une mémoire indisponible",
      "fail-fast": () => "Arrêt brutal du processus",
      "illegal-instruction": () =>
        "Instruction illégale (le plus souvent un module endommagé ou écrasé)",
      "stack-overflow": () => "Dépassement de pile",
      "heap-corruption": () => "Mémoire (tas) corrompue",
      "divide-by-zero": () => "Division par zéro",
      "in-page-error": () => "Impossible de lire un fichier sur le disque",
      "dll-init": () => "Une bibliothèque n'a pas pu démarrer",
      "dll-missing": () => "Une bibliothèque nécessaire est introuvable",
      "cpp-exception": () => "Erreur non gérée dans le code",
      breakpoint: () => "Erreur interne",
      "internal-error": () => "Erreur interne",
      unknown: ({ hex }) =>
        hex ? `Exception 0x${hex}` : "Cause non enregistrée",
    },
    foreign: (name) =>
      `Le fichier «\u00a0${name}\u00a0» ne vient pas d'Astral.`,
    noMods: "Mods non vérifiés\u00a0: données d'installation indisponibles.",
    details: "Détails",
    process: "Processus",
    module: "Module",
    exception: "Code",
    mods: (count) => `Mods Astral installés\u00a0: ${count}`,
    evidence: "Ce que disent les journaux",
    notice: (where) =>
      `Le jeu a planté (${where}). Détails dans Paramètres → Journaux.`,
  },
};

export const gameCrashCopyFor = (language) => COPY[language] || COPY.en;

/** Причина падения словами окна по коду и параметрам из записи. */
export function reasonText(language, reason) {
  const table = gameCrashCopyFor(language).reason;
  const make = table[reason?.code] || table.unknown;
  return make({
    asset: "",
    count: 1,
    more: 0,
    line: "",
    hex: "",
    ...(reason?.params || {}),
  });
}
