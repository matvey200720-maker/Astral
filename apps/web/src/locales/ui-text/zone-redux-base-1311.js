/*
 * Зона «Основа редукса», 13.11.2026 (владелец: «вообще все файлы должны быть один в один»): служебный пакет с файлами автора, которым нет своего раздела в каталоге
 * (дорожные узлы, отдельные меты уровня, настройки эффектов вне штатных путей). В каталог карточкой он не идёт, внутри редукса — строка окна «Компоненты» (`redux-base`).
 * Слово вида в самом окне — таблица `pack-contents-copy.js` (`kinds["redux-base"]`) и `part-name.js`; здесь та же строка нужна слою разметки и надписям, что берут её из данных.
 * Французский — `fr/zone-redux-base-1311.js`. Русская строка → [uk, en, de, pl].
 */

export const zoneReduxBase1311 = {
  /* Имя строки: «Основа редукса» / «Base files» владелец не понял (13.11.2026) — зовётся прямо. */
  "Остальные файлы": ["Інші файли", "Other files", "Weitere Dateien", "Pozostałe pliki"],
  /* Пояснение под именем строки в окне «Компоненты» (`ModContents.jsx: tileCaption`). */
  "Файлы автора без своего раздела в каталоге: ставятся вместе с редуксом": [
    "Файли автора без власного розділу в каталозі: встановлюються разом із редуксом",
    "Author's files without a catalog section of their own: installed together with the redux",
    "Dateien des Autors ohne eigenen Katalogbereich: werden zusammen mit dem Redux installiert",
    "Pliki autora bez własnego działu w katalogu: instalowane razem z reduxem",
  ],
};
