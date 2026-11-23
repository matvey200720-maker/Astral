/* locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) написаны в этом файле, словарь `ui-text` ему не нужен. */
/*
 * Окно «Закрыть Astral?», пока идёт скачивание (макет В1 «Короткий вопрос», 16.11.2026). Названия загрузок приходят из очереди готовыми, проценты
 * собираются по языку (`Intl`): «62 %» у русского, немецкого и французского, «62%» у английского и польского. Число загрузок — со склонением по
 * `Intl.PluralRules`, но без чисел меньше двух: одна загрузка называется по имени. Неразрывный пробел французского — только escape (правило репозитория).
 */

const NBSP = String.fromCharCode(0xa0);

const LOCALES = { ru: "ru-RU", uk: "uk-UA", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" };

// Слово «загрузка» по числу: для языков со сложным склонением — по категориям Intl, иначе одно слово.
const forms = (language, table) => (count) => {
  const rule = new Intl.PluralRules(LOCALES[language]).select(count);
  return table[rule] ?? table.other;
};

const COPY = {
  ru: {
    title: "Закрыть Astral?",
    updateName: "обновление Astral",
    one: (name, percent) => ["Ещё скачивается ", { strong: name }, ` — ${percent}. Если закрыть, скачивание продолжится с того же места при следующем запуске.`],
    many: (count, word) => [`Ещё скачивается ${count} ${word}. Если закрыть, скачивание продолжится с того же места при следующем запуске.`],
    downloads: forms("ru", { few: "загрузки", many: "загрузок", other: "загрузок" }),
    tray: "Свернуть в трей",
    quit: "Закрыть",
    cancel: "Отмена",
    dontAsk: "Больше не спрашивать",
    ring: (percent) => `Скачано: ${percent}`,
  },
  uk: {
    title: "Закрити Astral?",
    updateName: "оновлення Astral",
    one: (name, percent) => ["Ще завантажується ", { strong: name }, ` — ${percent}. Якщо закрити, завантаження продовжиться з того самого місця під час наступного запуску.`],
    many: (count, word) => [`Ще завантажується ${count} ${word}. Якщо закрити, завантаження продовжиться з того самого місця під час наступного запуску.`],
    downloads: forms("uk", { few: "завантаження", many: "завантажень", other: "завантажень" }),
    tray: "Згорнути в трей",
    quit: "Закрити",
    cancel: "Скасувати",
    dontAsk: "Більше не питати",
    ring: (percent) => `Завантажено: ${percent}`,
  },
  en: {
    title: "Close Astral?",
    updateName: "the Astral update",
    one: (name, percent) => ["Still downloading ", { strong: name }, ` — ${percent}. If you close Astral, the download will resume from where it stopped the next time you start it.`],
    many: (count, word) => [`${count} ${word} are still in progress. If you close Astral, they will resume from where they stopped the next time you start it.`],
    downloads: forms("en", { one: "download", other: "downloads" }),
    tray: "Minimize to tray",
    quit: "Close",
    cancel: "Cancel",
    dontAsk: "Don’t ask again",
    ring: (percent) => `Downloaded: ${percent}`,
  },
  de: {
    title: "Astral schließen?",
    updateName: "das Astral-Update",
    one: (name, percent) => ["Es wird noch heruntergeladen: ", { strong: name }, ` — ${percent}. Wenn du Astral schließt, wird der Download beim nächsten Start an derselben Stelle fortgesetzt.`],
    many: (count, word) => [`Es laufen noch ${count} ${word}. Wenn du Astral schließt, werden sie beim nächsten Start an derselben Stelle fortgesetzt.`],
    downloads: forms("de", { one: "Download", other: "Downloads" }),
    tray: "In den Infobereich",
    quit: "Schließen",
    cancel: "Abbrechen",
    dontAsk: "Nicht mehr fragen",
    ring: (percent) => `Heruntergeladen: ${percent}`,
  },
  pl: {
    title: "Zamknąć Astral?",
    updateName: "aktualizacja Astral",
    one: (name, percent) => ["Nadal pobiera się ", { strong: name }, ` — ${percent}. Jeśli zamkniesz Astral, pobieranie zostanie wznowione od tego samego miejsca przy następnym uruchomieniu.`],
    many: (count, word) => [`Nadal trwa pobieranie: ${count} ${word}. Jeśli zamkniesz Astral, zostanie wznowione od tego samego miejsca przy następnym uruchomieniu.`],
    downloads: forms("pl", { few: "pobrania", many: "pobrań", other: "pobrań" }),
    tray: "Do zasobnika",
    quit: "Zamknij",
    cancel: "Anuluj",
    dontAsk: "Nie pytaj więcej",
    ring: (percent) => `Pobrano: ${percent}`,
  },
  fr: {
    title: `Fermer Astral${NBSP}?`,
    updateName: "la mise à jour d’Astral",
    one: (name, percent) => [{ strong: name }, ` est encore en cours de téléchargement${NBSP}: ${percent}. Si vous fermez Astral, le téléchargement reprendra là où il s’est arrêté au prochain lancement.`],
    many: (count, word) => [`${count} ${word} sont encore en cours. Si vous fermez Astral, ils reprendront là où ils se sont arrêtés au prochain lancement.`],
    downloads: forms("fr", { one: "téléchargement", other: "téléchargements" }),
    tray: "Réduire dans le systray",
    quit: "Fermer",
    cancel: "Annuler",
    dontAsk: "Ne plus demander",
    ring: (percent) => `Téléchargé${NBSP}: ${percent}`,
  },
};

export const closeAskCopyFor = (language) => COPY[language] ?? COPY.ru;

/** Процент по обычаям языка: «62 %» (ru, de, fr), «62%» (en, pl). */
export function closeAskPercent(language, percent) {
  return new Intl.NumberFormat(LOCALES[language] ?? LOCALES.ru, { style: "percent", maximumFractionDigits: 0 }).format(percent / 100);
}

/** Слова под итог из `closeAskSummary`: список кусков — строки и `{ strong }` для названия. */
export function closeAskText(language, summary) {
  const copy = closeAskCopyFor(language);
  const percent = closeAskPercent(language, summary.percent);
  if (summary.kind === "many") return copy.many(summary.count, copy.downloads(summary.count));
  return copy.one(summary.kind === "update" ? copy.updateName : summary.name || "…", percent);
}
