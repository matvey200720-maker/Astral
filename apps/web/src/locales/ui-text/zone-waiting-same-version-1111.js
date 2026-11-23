/*
 * Слова отказа «ждущему новой версии компоненту (после обновления игры) ставят прежний файл» (А10, 11.11.2026): каталог под новым номером релиза ещё отдаёт файл
 * под прежнюю версию игры, движок его не кладёт (`stock-guard.js`, код waiting-same-version). Строки — семейство `waiting-same-version` в `utils/installFailure.js`.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-waiting-same-version-1111.js`.
 */
export const zoneWaitingSameVersion1111 = {
  "В каталоге пока прежняя версия компонента": [
    "У каталозі поки що попередня версія компонента",
    "The catalog still has the previous version of this component",
    "Im Katalog liegt noch die vorherige Version dieser Komponente",
    "W katalogu wciąż jest poprzednia wersja tego komponentu",
  ],
  "Rockstar изменили файл игры, а в каталоге ещё лежит файл под прежнюю версию — поверх нового он не ляжет. Новая версия встанет сама, как только её выложат. В игру ничего не записано.":
    [
      "Rockstar змінили файл гри, а в каталозі ще лежить файл під попередню версію — поверх нового він не ляже. Нова версія стане сама, щойно її викладуть. У гру нічого не записано.",
      "Rockstar changed a game file, and the catalog still holds the file made for the old version, so it will not be put over the new one. The new version will install itself as soon as it is published. Nothing was written to the game.",
      "Rockstar hat eine Spieldatei geändert, und im Katalog liegt noch die Datei für die alte Version — sie wird nicht über die neue gelegt. Die neue Version wird von selbst installiert, sobald sie veröffentlicht ist. Ins Spiel wurde nichts geschrieben.",
      "Rockstar zmienił plik gry, a w katalogu nadal leży plik pod starą wersję — nie trafi on na nowy. Nowa wersja zainstaluje się sama, gdy tylko zostanie opublikowana. Do gry nic nie zapisano.",
    ],
};
