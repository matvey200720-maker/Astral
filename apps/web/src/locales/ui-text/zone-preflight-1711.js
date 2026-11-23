/*
 * Слова отказа проверки перед установкой (17.11.2026): «RPF preflight failed» с кодом `rpf-preflight-exists` (запись уже лежит в архиве) и без кода
 * (сторону отказа определить нечем) — раньше окно сборки говорило «пакет сейчас не получить». Семейства — `utils/installFailure.js`
 * (`game-entry-present`, `game-entry-conflict`); отказ «записи нет» идёт в готовое `game-file-missing`.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-preflight-1711.js`.
 */
export const zonePreflight1711 = {
  "В архиве игры уже лежит файл {file}": [
    "В архіві гри вже лежить файл {file}",
    "The game archive already has {file}",
    "Im Spielarchiv liegt {file} bereits",
    "W archiwum gry już leży plik {file}",
  ],
  "Его оставила прежняя установка или другая сборка, а пакет добавляет его как новый. Верните оригинальные файлы проверкой целостности игры: {verify} Моды из update.rpf при этом пропадут. Затем поставьте нужное через Astral и нажмите «Повторить». Не помогло — скачайте журнал ({logs}) и пришлите в поддержку. Путь к файлу — в «Подробностях». В игру ничего не записано.":
    [
      "Його залишило попереднє встановлення або інша збірка, а пакет додає його як новий. Поверніть оригінальні файли перевіркою цілісності гри: {verify} Моди з update.rpf при цьому зникнуть. Потім встановіть потрібне через Astral і натисніть «Повторити». Не допомогло — завантажте журнал ({logs}) і надішліть у підтримку. Шлях до файлу — у «Подробицях». У гру нічого не записано.",
      "An earlier installation or another build left it there, while the package adds it as new. Restore the original files by verifying the game: {verify} Mods inside update.rpf will be removed. Then install what you need through Astral and press “Retry”. If that does not help, download the log ({logs}) and send it to support. The file path is under “Details”. Nothing was written to the game.",
      "Eine frühere Installation oder ein anderes Paket hat sie dort hinterlassen, während das Paket sie als neu hinzufügt. Stelle die Originaldateien wieder her, indem du das Spiel überprüfst: {verify} Mods in update.rpf gehen dabei verloren. Installiere dann das Gewünschte über Astral und drücke „Wiederholen“. Hilft das nicht, lade das Protokoll herunter ({logs}) und schicke es an den Support. Der Dateipfad steht unter „Details“. Im Spiel wurde nichts verändert.",
      "Zostawiła go wcześniejsza instalacja albo inna paczka, a pakiet dodaje go jako nowy. Przywróć oryginalne pliki, weryfikując grę: {verify} Mody w update.rpf zostaną przy tym usunięte. Potem zainstaluj potrzebne rzeczy przez Astral i naciśnij „Ponów”. Jeśli to nie pomoże, pobierz dziennik ({logs}) i wyślij go do wsparcia. Ścieżka pliku jest w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
  "Файл {file} в архиве игры не сходится с пакетом": [
    "Файл {file} в архіві гри не збігається з пакетом",
    "File {file} in the game archive does not match the package",
    "Datei {file} im Spielarchiv passt nicht zum Paket",
    "Plik {file} w archiwum gry nie zgadza się z pakietem",
  ],
  "Пакет рассчитан на другое состояние файлов игры. Верните оригинальные файлы проверкой целостности игры: {verify} Моды из update.rpf при этом пропадут. Затем поставьте нужное через Astral и нажмите «Повторить». Не помогло — скачайте журнал ({logs}) и пришлите в поддержку. Путь к файлу — в «Подробностях». В игру ничего не записано.":
    [
      "Пакет розрахований на інший стан файлів гри. Поверніть оригінальні файли перевіркою цілісності гри: {verify} Моди з update.rpf при цьому зникнуть. Потім встановіть потрібне через Astral і натисніть «Повторити». Не допомогло — завантажте журнал ({logs}) і надішліть у підтримку. Шлях до файлу — у «Подробицях». У гру нічого не записано.",
      "The package expects a different state of the game files. Restore the original files by verifying the game: {verify} Mods inside update.rpf will be removed. Then install what you need through Astral and press “Retry”. If that does not help, download the log ({logs}) and send it to support. The file path is under “Details”. Nothing was written to the game.",
      "Das Paket geht von einem anderen Zustand der Spieldateien aus. Stelle die Originaldateien wieder her, indem du das Spiel überprüfst: {verify} Mods in update.rpf gehen dabei verloren. Installiere dann das Gewünschte über Astral und drücke „Wiederholen“. Hilft das nicht, lade das Protokoll herunter ({logs}) und schicke es an den Support. Der Dateipfad steht unter „Details“. Im Spiel wurde nichts verändert.",
      "Pakiet jest przygotowany pod inny stan plików gry. Przywróć oryginalne pliki, weryfikując grę: {verify} Mody w update.rpf zostaną przy tym usunięte. Potem zainstaluj potrzebne rzeczy przez Astral i naciśnij „Ponów”. Jeśli to nie pomoże, pobierz dziennik ({logs}) i wyślij go do wsparcia. Ścieżka pliku jest w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
};
