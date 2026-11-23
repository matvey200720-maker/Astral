import { modList } from "./mod-list.js";

/*
 * Слова сводки и плиток окна сборки (ТЗ 24.10.2026, вечер, п. C) на языке окна: слева — «Всего / Заменят ваши / Новых /
 * Из каталога / Своих», справа — плитки модов и работ с жёлтым «!» у тех, что встанут вместо вашего. Подмешиваются в слова
 * раздела (`buildsCopyFor`), поэтому те же `copy`, что у окна. Вынесены отдельным файлом, чтобы слова раздела
 * (`builds-copy.js`) не правили две сессии разом.
 */

const COPY = {
  ru: {
    factTotal: "Всего в сборке",
    factCatalog: "Из каталога",
    factOwn: "Своих (из мастерской)",
    factNew: "Новых",
    factReplaceAny: "Заменят ваши",
    contentsTitle: "Состав сборки",
    replacesAnyBadge: (list) => `Осторожно: заменит то, что у вас стоит — ${list}`,
    replaceAnyWarning: (list) => `Осторожно: встанут вместо того, что у вас стоит — ${list}.`,
    ownEditorNote: "ставится из «Моих работ»",
  },
  uk: {
    factTotal: "Усього у збірці",
    factCatalog: "З каталогу",
    factOwn: "Своїх (з майстерні)",
    factNew: "Нових",
    factReplaceAny: "Замінять ваші",
    contentsTitle: "Склад збірки",
    replacesAnyBadge: (list) => `Обережно: замінить те, що у вас стоїть — ${list}`,
    replaceAnyWarning: (list) => `Обережно: стануть замість того, що у вас стоїть — ${list}.`,
    ownEditorNote: "ставиться з «Моїх робіт»",
  },
  en: {
    factTotal: "In the build",
    factCatalog: "From the catalog",
    factOwn: "Your own (workshop)",
    factNew: "New",
    factReplaceAny: "Replace yours",
    contentsTitle: "Build contents",
    replacesAnyBadge: (list) => `Careful: replaces what you have installed — ${list}`,
    replaceAnyWarning: (list) => `Careful: these will replace what you have installed — ${list}.`,
    ownEditorNote: "installs from “My works”",
  },
  de: {
    factTotal: "In der Sammlung",
    factCatalog: "Aus dem Katalog",
    factOwn: "Eigene (Werkstatt)",
    factNew: "Neu",
    factReplaceAny: "Ersetzen deine",
    contentsTitle: "Inhalt der Sammlung",
    replacesAnyBadge: (list) => `Vorsicht: ersetzt, was bei dir installiert ist — ${list}`,
    replaceAnyWarning: (list) => `Vorsicht: ersetzen, was bei dir installiert ist — ${list}.`,
    ownEditorNote: "wird aus „Meine Arbeiten“ installiert",
  },
  pl: {
    factTotal: "W zestawie",
    factCatalog: "Z katalogu",
    factOwn: "Własnych (z warsztatu)",
    factNew: "Nowych",
    factReplaceAny: "Zastąpią twoje",
    contentsTitle: "Zawartość zestawu",
    replacesAnyBadge: (list) => `Uwaga: zastąpi to, co masz zainstalowane — ${list}`,
    replaceAnyWarning: (list) => `Uwaga: zastąpią to, co masz zainstalowane — ${list}.`,
    ownEditorNote: "instaluje się z „Moich prac”",
  },
  fr: {
    factTotal: "Total dans le build",
    factCatalog: "Du catalogue",
    factOwn: "Les vôtres (atelier)",
    factNew: "Nouveaux",
    factReplaceAny: "Remplacent les vôtres",
    contentsTitle: "Contenu du build",
    replacesAnyBadge: (list) => `Attention\u00a0: remplacera ce que vous avez installé — ${list}`,
    replaceAnyWarning: (list) => `Attention\u00a0: ils remplaceront ce que vous avez installé — ${list}.`,
    ownEditorNote: "s’installe depuis «\u00a0Mes créations\u00a0»",
  },
};

/**
 * @param {string} language
 * @param {{ andMore: string, quotes: [string, string] }} base слова раздела: «и ещё» и кавычки языка
 */
export function buildContentsCopyFor(language, base) {
  const lang = COPY[language] ? language : "en";
  const copy = COPY[lang];
  const list = (items) => modList(lang, items, base.andMore, base.quotes);
  return {
    ...copy,
    replacesAnyBadgeText: (items) => copy.replacesAnyBadge(list(items)),
    replaceAnyWarningText: (items) => copy.replaceAnyWarning(list(items)),
  };
}
