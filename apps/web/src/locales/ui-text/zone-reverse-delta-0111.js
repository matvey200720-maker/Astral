/*
 * Отказ отката и возврата, когда копию архива не собрать (обратная разница, 01.11.2026): часть байт
 * оригинала лежала только в файле игры, а его изменили снаружи. Вставка `{verify}` — пункты меню магазинов.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-reverse-delta-0111.js`.
 */
export const zoneReverseDelta0111 = {
  "Копию файла игры не собрать": [
    "Копію файлу гри не зібрати",
    "The backup of the game file can't be rebuilt",
    "Die Sicherung der Spieldatei lässt sich nicht wiederherstellen",
    "Nie da się odtworzyć kopii pliku gry",
  ],
  "Astral не хранит то, что и так лежит в файлах игры, а этот файл изменили снаружи: обновление, проверка файлов или OpenIV. Игра не тронута. Верните оригинальные файлы проверкой целостности: {verify} Затем нажмите «Повторить»: Astral сверит файл и примет его.":
    [
      "Astral не зберігає те, що й так лежить у файлах гри, а цей файл змінили ззовні: оновлення, перевірка файлів або OpenIV. Гру не зачеплено. Поверніть оригінальні файли перевіркою цілісності: {verify} Потім натисніть «Повторити»: Astral звірить файл і прийме його.",
      "Astral doesn't keep what's already in the game files, and this file was changed from outside: an update, a file check or OpenIV. The game wasn't touched. Restore the original files with an integrity check: {verify} Then press “Retry”: Astral will compare the file and accept it.",
      "Astral speichert nicht, was ohnehin in den Spieldateien liegt, und diese Datei wurde von außen geändert: durch ein Update, eine Dateiprüfung oder OpenIV. Das Spiel blieb unberührt. Stelle die Originaldateien mit einer Integritätsprüfung wieder her: {verify} Drücke dann „Wiederholen“: Astral gleicht die Datei ab und übernimmt sie.",
      "Astral nie przechowuje tego, co i tak leży w plikach gry, a ten plik zmieniono z zewnątrz: aktualizacją, sprawdzeniem plików albo w OpenIV. Gra nie została ruszona. Przywróć oryginalne pliki, sprawdzając spójność: {verify} Potem naciśnij „Ponów”: Astral porówna plik i go przyjmie.",
    ],
};
