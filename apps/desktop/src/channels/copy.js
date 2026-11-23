// Тексты двух системных окон главного процесса на шести языках.
// Шаблоны хранят слоты {0}, {1}; подстановка — как в обычной строке-шаблоне.

const FALLBACK_LANGUAGE = "ru";

const SWITCH_TEXTS = {
  ru: {
    title: "Переключить ветку Astral",
    message: "Сейчас открыт {0}. Закрыть его и открыть {1}?",
    detail: "Несохранённое сохранится так же, как при обычном закрытии.",
    confirm: "Закрыть и открыть {0}",
    stay: "Остаться",
  },
  uk: {
    title: "Перемкнути гілку Astral",
    message: "Зараз відкрито {0}. Закрити його й відкрити {1}?",
    detail: "Незбережене збережеться так само, як при звичайному закритті.",
    confirm: "Закрити й відкрити {0}",
    stay: "Залишитися",
  },
  en: {
    title: "Switch Astral branch",
    message: "{0} is open right now. Close it and open {1}?",
    detail: "Unsaved work is handled the same way as on a normal close.",
    confirm: "Close and open {0}",
    stay: "Stay",
  },
  de: {
    title: "Astral-Zweig wechseln",
    message: "{0} ist gerade geöffnet. Schließen und {1} öffnen?",
    detail: "Nicht Gespeichertes wird wie beim normalen Schließen behandelt.",
    confirm: "Schließen und {0} öffnen",
    stay: "Bleiben",
  },
  pl: {
    title: "Przełącz gałąź Astral",
    message: "Teraz otwarty jest {0}. Zamknąć go i otworzyć {1}?",
    detail: "Niezapisane zostanie obsłużone tak samo jak przy zwykłym zamknięciu.",
    confirm: "Zamknij i otwórz {0}",
    stay: "Zostań",
  },
  fr: {
    title: "Changer de branche Astral",
    message: "{0} est actuellement ouvert. Le fermer et ouvrir {1}\u00a0?",
    detail: "Le travail non enregistré est traité comme lors d’une fermeture normale.",
    confirm: "Fermer et ouvrir {0}",
    stay: "Rester",
  },
};

// named — известна ветка, записавшая данные ({1}); generic — неизвестна.
const DATA_TEXTS = {
  ru: {
    title: "Данные Astral новее этой версии",
    named: "Данные записала {1}, и {0} ещё не умеет с ними работать: так их можно повредить.",
    generic: "Данные записала более новая версия Astral, и {0} ещё не умеет с ними работать: так их можно повредить.",
    detail: "Ничего не изменено. Откройте ту ветку, что новее, — она обновит и эту.",
    open: "Открыть {0}",
    close: "Закрыть",
  },
  uk: {
    title: "Дані Astral новіші за цю версію",
    named: "Дані записала {1}, і {0} ще не вміє з ними працювати: так їх можна пошкодити.",
    generic: "Дані записала новіша версія Astral, і {0} ще не вміє з ними працювати: так їх можна пошкодити.",
    detail: "Нічого не змінено. Відкрийте гілку, що новіша, — вона оновить і цю.",
    open: "Відкрити {0}",
    close: "Закрити",
  },
  en: {
    title: "Astral data is newer than this version",
    named: "{1} wrote the data, and {0} can’t work with it yet: it could be damaged.",
    generic: "A newer Astral version wrote the data, and {0} can’t work with it yet: it could be damaged.",
    detail: "Nothing was changed. Open the newer branch — it will update this one too.",
    open: "Open {0}",
    close: "Close",
  },
  de: {
    title: "Die Astral-Daten sind neuer als diese Version",
    named: "{1} hat die Daten geschrieben, und {0} kann damit noch nicht arbeiten: Sie könnten beschädigt werden.",
    generic: "Eine neuere Astral-Version hat die Daten geschrieben, und {0} kann damit noch nicht arbeiten: "
      + "Sie könnten beschädigt werden.",
    detail: "Es wurde nichts geändert. Den neueren Zweig öffnen — er aktualisiert auch diesen.",
    open: "{0} öffnen",
    close: "Schließen",
  },
  pl: {
    title: "Dane Astral są nowsze niż ta wersja",
    named: "Dane zapisała {1}, a {0} jeszcze nie umie z nimi pracować: można je uszkodzić.",
    generic: "Dane zapisała nowsza wersja Astral, a {0} jeszcze nie umie z nimi pracować: można je uszkodzić.",
    detail: "Nic nie zmieniono. Otwórz nowszą gałąź — zaktualizuje także tę.",
    open: "Otwórz {0}",
    close: "Zamknij",
  },
  fr: {
    title: "Les données d’Astral sont plus récentes que cette version",
    named: "Les données ont été écrites par {1}, et {0} ne sait pas encore les traiter\u00a0: "
      + "elles risqueraient d’être endommagées.",
    generic: "Les données ont été écrites par une version plus récente d’Astral, et {0} ne sait pas encore "
      + "les traiter\u00a0: elles risqueraient d’être endommagées.",
    detail: "Rien n’a été modifié. Ouvrez la branche la plus récente — elle mettra aussi à jour celle-ci.",
    open: "Ouvrir {0}",
    close: "Fermer",
  },
};

const fill = (template, values) => template.replace(/\{(\d)\}/g, (_, slot) => `${values[slot]}`);

const perLanguage = (texts, assemble) =>
  Object.fromEntries(Object.entries(texts).map(([language, entry]) => [language, assemble(entry)]));

const SWITCH_COPY = perLanguage(SWITCH_TEXTS, (t) => ({
  title: t.title,
  message: (from, to) => fill(t.message, [from, to]),
  detail: t.detail,
  confirm: (to) => fill(t.confirm, [to]),
  stay: t.stay,
}));

const DATA_COPY = perLanguage(DATA_TEXTS, (t) => ({
  title: t.title,
  message: (own, writer) => fill(writer ? t.named : t.generic, [own, writer]),
  detail: t.detail,
  open: (name) => fill(t.open, [name]),
  close: t.close,
}));

export function pickLanguage(locale) {
  const [head] = String(locale || "").toLowerCase().split(/[-_]/);
  return head in SWITCH_COPY ? head : FALLBACK_LANGUAGE;
}

export function switchCopyFor(locale) {
  return SWITCH_COPY[pickLanguage(locale)];
}

export function dataCopyFor(locale) {
  return DATA_COPY[pickLanguage(locale)];
}
