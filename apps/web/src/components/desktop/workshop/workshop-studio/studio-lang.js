// Три готовых сообщения студии. В шаблонах {value} — подставляемое число
// или название, {s} — окончание слова (нужно только французскому тексту).

const FIVEM_INSTALLED = {
  ru: "FiveM resource установлен · {value} runtime-параметров",
  uk: "FiveM resource встановлено · {value} runtime-параметрів",
  en: "FiveM resource installed · {value} runtime parameters",
  de: "FiveM-Resource installiert · {value} Runtime-Parameter",
  pl: "FiveM resource zainstalowany · {value} parametrów runtime",
  fr: "FiveM resource installé · {value} paramètre{s} runtime",
};

const MAP_SAVED_STOCK = {
  ru: "«{value}» сохранена — возвращаем игре штатную карту",
  uk: "«{value}» збережено — повертаємо грі штатну карту",
  en: "“{value}” saved — restoring the stock map in the game",
  de: "„{value}“ gespeichert — die Standardkarte wird dem Spiel zurückgegeben",
  pl: "„{value}” zapisana — przywracamy grze standardową mapę",
  fr: "« {value} » enregistrée — la carte d’origine est restaurée dans le jeu",
};

const MAP_TILES_DONE = {
  ru: "Карта в игре: плиток записано {value} — перезапустите GTA V",
  uk: "Карта в грі, записано плиток: {value} — перезапустіть GTA V",
  en: "Map in the game, tiles written: {value} — restart GTA V",
  de: "Karte im Spiel, Kacheln geschrieben: {value} — starten Sie GTA V neu",
  pl: "Mapa w grze, zapisano kafelków: {value} — uruchom ponownie GTA V",
  fr: "Carte dans le jeu, tuiles écrites : {value} — redémarrez GTA V",
};

// Одним проходом: подставленное значение заново не разбирается.
function render(templates, language, value, ending = "") {
  // Запасной язык — английский. Поиск прямо по объекту: имя встроенного
  // свойства вместо языка даёт не шаблон, а функцию, и её вызывают со
  // значением без this, как в эталоне (TypeError, если это не функция).
  const entry = templates[language] || templates.en;
  if (typeof entry !== "string") return entry(value);
  return entry.replace(/\{(value|s)\}/g, (label, name) =>
    name === "s" ? ending : value,
  );
}

export function fivemInstalledNote(language, count) {
  // Единственное число во французском — только для числа 0 и числа 1.
  const ending = count === 0 || count === 1 ? "" : "s";
  return render(FIVEM_INSTALLED, language, count, ending);
}

export function mapSavedStockNote(language, name) {
  return render(MAP_SAVED_STOCK, language, name);
}

export function mapTilesDoneNote(language, tiles) {
  return render(MAP_TILES_DONE, language, tiles);
}
