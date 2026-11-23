/*
 * Самопроверка своих пакетов дополнения Astral (Хелпер 15, 26.10.2026): слова отказа главного процесса
 * `dlc-archive-check.js` — «Игра не откроет собранный пакет Astral «…»: …». Вставка `{logs}` — именованная, подставляет `failureWords`.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneH15OwnDlc = {
  "Игра не откроет собранный пакет Astral": [
    "Гра не відкриє зібраний пакет Astral",
    "The game won’t be able to open the package Astral built",
    "Das Spiel könnte das von Astral gebaute Paket nicht öffnen",
    "Gra nie otworzy zbudowanego przez Astral pakietu",
  ],
  "Astral собрал пакет, но проверка перед записью показала, что игра его не прочтёт (какой архив и почему — в «Подробностях»). Поэтому в игру ничего не записано, а в библиотеку работа не добавлена. Нажмите «Повторить» — пакет соберётся заново. Не помогло — скачайте журнал ({logs}) и пришлите в поддержку.":
    [
      "Astral зібрав пакет, але перевірка перед записом показала, що гра його не прочитає (який архів і чому — у «Подробицях»). Тому в гру нічого не записано, а в бібліотеку роботу не додано. Натисніть «Повторити» — пакет збереться заново. Не допомогло — завантажте журнал ({logs}) і надішліть у підтримку.",
      "Astral built the package, but the check before writing showed the game would not be able to read it (which archive and why is under “Details”). So nothing was written to the game and the work was not added to the library. Press “Retry” — the package will be rebuilt. If that does not help, download the log ({logs}) and send it to support.",
      "Astral hat das Paket gebaut, aber die Prüfung vor dem Schreiben hat gezeigt, dass das Spiel es nicht lesen könnte (welches Archiv und warum, steht unter „Details“). Deshalb wurde nichts in das Spiel geschrieben und die Arbeit nicht in die Bibliothek aufgenommen. Drücke „Wiederholen“ — das Paket wird neu gebaut. Hilft das nicht, lade das Protokoll herunter ({logs}) und schicke es an den Support.",
      "Astral zbudował pakiet, ale kontrola przed zapisem wykazała, że gra go nie odczyta (które archiwum i dlaczego — w „Szczegółach”). Dlatego nic nie zapisano w grze, a pracy nie dodano do biblioteki. Naciśnij „Ponów” — pakiet zostanie zbudowany od nowa. Jeśli to nie pomoże, pobierz dziennik ({logs}) i wyślij go do wsparcia.",
    ],
};
