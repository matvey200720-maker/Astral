/*
 * Слова отказа «таблицу кадров частиц изменил другой мод» (22.11.2026, журнал тестера beta.109: «ptxclipregions.dat в архиве игры повреждён: в заголовке 1212 кадров, в таблице 277» — файл, вероятно,
 * не повреждён, таблицу записал редукс с неверным счётчиком). Семейство `clip-table-counts` из `utils/installFailure.js`; окна «Настройка автомобиля», «Фонари» и «Эффекты» и установка модов каталога со строками кадров.
 * Слово одно на оба счётчика заголовка (число текстур у sad redux, число кадров у тестера) и без примеров из одного окна. «Не повреждён» — «вероятно»: обрыв файла ровно по границе строки по счётчикам
 * неотличим от чужого заголовка; в конце совет проверить игру, если других модов нет (тот же {verify}, что у соседних записей). Русская строка → [uk, en, de, pl]; французский — `fr/zone-clip-table-2211.js`.
 */

export const zoneClipTable2211 = {
  "Таблицу эффектов игры изменил другой мод": [
    "Таблицю ефектів гри змінив інший мод",
    "Another mod changed the game’s effects table",
    "Die Effekttabelle des Spiels wurde von einer anderen Mod geändert",
    "Tabelę efektów gry zmienił inny mod",
  ],
  "В таблице кадров частиц неверные счётчики в заголовке — скорее всего, её записал другой мод (редукс). Файл, вероятно, не повреждён, но эта работа меняет ту же таблицу и поверх чужой не ставится. В игру ничего не записано. Всё, что таблицу не трогает, ставится как обычно; либо снимите мод, который изменил таблицу, и нажмите «Повторить». Числа — в «Подробностях». Если других модов нет — проверьте целостность игры: {verify}": [
    "У таблиці кадрів частинок неправильні лічильники в заголовку — найімовірніше, її записав інший мод (редукс). Файл, імовірно, не пошкоджено, але ця робота змінює ту саму таблицю й поверх чужої не ставиться. У гру нічого не записано. Усе, що таблицю не чіпає, ставиться як зазвичай; або зніміть мод, що змінив таблицю, і натисніть «Повторити». Числа — у «Подробицях». Якщо інших модів немає — перевірте цілісність гри: {verify}",
    "The particle frame table has wrong counts in its header, most likely written by another mod (a redux). The file is probably not damaged, but this work changes the same table and will not install on top of someone else’s. Nothing was written to the game. Anything that does not touch the table installs as usual; or remove the mod that changed the table and press “Retry”. The numbers are in Details. If there are no other mods, verify the game files: {verify}",
    "In der Tabelle der Partikel-Frames stehen im Tabellenkopf falsche Zähler – höchstwahrscheinlich hat eine andere Mod (ein Redux) sie geschrieben. Die Datei ist wahrscheinlich nicht beschädigt, aber diese Arbeit ändert dieselbe Tabelle und wird auf eine fremde nicht installiert. Es wurde nichts in das Spiel geschrieben. Alles, was die Tabelle nicht berührt, wird wie gewohnt installiert; oder entferne die Mod, die die Tabelle geändert hat, und klicke auf „Wiederholen“. Die Zahlen stehen unter „Details“. Gibt es keine anderen Mods, überprüfe die Spieldateien: {verify}",
    "W tabeli klatek cząsteczek w nagłówku są błędne liczniki – najpewniej zapisał ją inny mod (redux). Plik prawdopodobnie nie jest uszkodzony, ale ta praca zmienia tę samą tabelę i na cudzą się nie zainstaluje. Do gry nic nie zapisano. Wszystko, co tabeli nie rusza, instaluje się jak zwykle; albo usuń mod, który zmienił tabelę, i kliknij „Ponów”. Liczby są w „Szczegółach”. Jeśli nie ma innych modów, sprawdź integralność gry: {verify}",
  ],
};
