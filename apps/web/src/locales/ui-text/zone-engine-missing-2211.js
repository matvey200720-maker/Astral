/*
 * Нет движка Astral (22.11.2026): отказ главного процесса `engineMissingError` из `apps/desktop/src/native-engine.js`. Без
 * `astral-engine.exe` (чаще всего его убирает антивирусная программа) команды без запасного пути отказывают; раньше человек видел одну
 * английскую строку. `{0}` — прежняя английская строка в скобках, она остаётся как есть (по ней разбирает поддержка).
 * Русская строка → [uk, en, de, pl]; французский — в `fr/zone-engine-missing-2211.js`.
 */

export const zoneEngineMissing2211 = {
  "Не найден движок Astral (astral-engine.exe): его могла убрать антивирусная программа. Добавьте папку Astral в исключения антивируса и установите Astral заново с сайта. Игра и моды не затронуты. ({0})": [
    "Не знайдено рушій Astral (astral-engine.exe): його могла прибрати антивірусна програма. Додайте теку Astral до винятків антивіруса й встановіть Astral заново з сайту. Гру та моди не зачеплено. ({0})",
    "The Astral engine (astral-engine.exe) was not found: an antivirus program may have removed it. Add the Astral folder to your antivirus exclusions and install Astral again from the website. The game and your mods are not touched. ({0})",
    "Die Astral-Engine (astral-engine.exe) wurde nicht gefunden: Möglicherweise hat sie ein Virenscanner entfernt. Füge den Astral-Ordner zu den Ausnahmen deines Virenscanners hinzu und installiere Astral erneut von der Website. Das Spiel und deine Mods bleiben unberührt. ({0})",
    "Nie znaleziono silnika Astral (astral-engine.exe): mógł go usunąć program antywirusowy. Dodaj folder Astral do wyjątków antywirusa i zainstaluj Astral ponownie ze strony. Gra i Twoje mody pozostaną nietknięte. ({0})",
  ],
  "Движок Astral выключен, а эта функция работает только на нём. Уберите выключатель ASTRAL_RUST_ENGINE=off и перезапустите Astral. ({0})": [
    "Рушій Astral вимкнено, а ця функція працює лише на ньому. Приберіть перемикач ASTRAL_RUST_ENGINE=off і перезапустіть Astral. ({0})",
    "The Astral engine is switched off, and this feature works only on it. Remove the ASTRAL_RUST_ENGINE=off switch and restart Astral. ({0})",
    "Die Astral-Engine ist ausgeschaltet, diese Funktion läuft aber nur auf ihr. Entferne den Schalter ASTRAL_RUST_ENGINE=off und starte Astral neu. ({0})",
    "Silnik Astral jest wyłączony, a ta funkcja działa tylko na nim. Usuń przełącznik ASTRAL_RUST_ENGINE=off i uruchom Astral ponownie. ({0})",
  ],
  "Движок Astral выключен или не найден: его могла убрать антивирусная программа. Установите Astral заново с сайта. Игра и моды не затронуты. ({0})": [
    "Рушій Astral вимкнено або не знайдено: його могла прибрати антивірусна програма. Встановіть Astral заново з сайту. Гру та моди не зачеплено. ({0})",
    "The Astral engine is switched off or was not found: an antivirus program may have removed it. Install Astral again from the website. The game and your mods are not touched. ({0})",
    "Die Astral-Engine ist ausgeschaltet oder wurde nicht gefunden: Möglicherweise hat sie ein Virenscanner entfernt. Installiere Astral erneut von der Website. Das Spiel und deine Mods bleiben unberührt. ({0})",
    "Silnik Astral jest wyłączony lub nie został znaleziony: mógł go usunąć program antywirusowy. Zainstaluj Astral ponownie ze strony. Gra i Twoje mody pozostaną nietknięte. ({0})",
  ],
};
