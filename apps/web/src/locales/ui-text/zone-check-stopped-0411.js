/*
 * Слова отказа «проверка перед записью остановила установку» (04.11.2026): сборка звука, карты и
 * правки клипов проверяют собранное и пишут «… — установка отменена». Раньше окно принимало такой
 * текст за отмену. Вставка `{logs}` — именованная, подставляет `failureWords`.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneCheckStopped0411 = {
  "Проверка перед записью остановила установку": [
    "Перевірка перед записом зупинила встановлення",
    "A check before writing stopped the installation",
    "Eine Prüfung vor dem Schreiben hat die Installation gestoppt",
    "Kontrola przed zapisem zatrzymała instalację",
  ],
  "Astral собрал результат, но проверка перед записью нашла расхождение, поэтому установка остановлена. Нажмите «Повторить». Не помогло — скачайте журнал ({logs}) и пришлите в поддержку. Что не сошлось — в «Подробностях».":
    [
      "Astral зібрав результат, але перевірка перед записом знайшла розбіжність, тому встановлення зупинено. Натисніть «Повторити». Не допомогло — завантажте журнал ({logs}) і надішліть у підтримку. Що не збіглося — у «Подробицях».",
      "Astral built the result, but the check before writing found a mismatch, so the installation was stopped. Press “Retry”. If that does not help, download the log ({logs}) and send it to support. What did not match is under “Details”.",
      "Astral hat das Ergebnis gebaut, aber die Prüfung vor dem Schreiben hat eine Abweichung gefunden, deshalb wurde die Installation gestoppt. Drücke „Wiederholen“. Hilft das nicht, lade das Protokoll herunter ({logs}) und schicke es an den Support. Was nicht übereinstimmte, steht unter „Details“.",
      "Astral zbudował wynik, ale kontrola przed zapisem wykryła rozbieżność, więc instalację zatrzymano. Naciśnij „Ponów”. Jeśli to nie pomoże, pobierz dziennik ({logs}) i wyślij go do wsparcia. Co się nie zgadza — w „Szczegółach”.",
    ],
};
