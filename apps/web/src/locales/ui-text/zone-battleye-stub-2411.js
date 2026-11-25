/*
 * Слова отказа «остался только процесс-заглушка BattlEye» (T-0002, 24.11.2026): игры уже нет, а окно BattlEye Launcher
 * (`GTA5_BE.exe`) висит, и Astral не меняет файлы игры, пока оно живо. Семейство — `utils/installFailure.js` (`game-stub`),
 * {process} в совете заменяется именем найденного процесса. Русская строка → [uk, en, de, pl]; французский — `fr/zone-battleye-stub-2411.js`.
 */
export const zoneBattleyeStub2411 = {
  "Открыто окно BattlEye Launcher": [
    "Відкрито вікно BattlEye Launcher",
    "The BattlEye Launcher window is open",
    "Das Fenster von BattlEye Launcher ist offen",
    "Okno BattlEye Launcher jest otwarte",
  ],
  "Игры уже нет, но окно BattlEye Launcher осталось. Пока оно открыто, Astral не меняет файлы игры. Закройте это окно, а если его не видно, снимите {process} в диспетчере задач. Потом нажмите «Повторить». В игру ничего не записано.":
    [
      "Гри вже немає, але вікно BattlEye Launcher залишилося. Поки воно відкрите, Astral не змінює файли гри. Закрийте це вікно, а якщо його не видно, зніміть {process} у диспетчері завдань. Потім натисніть «Повторити». У гру нічого не записано.",
      "The game is already gone, but the BattlEye Launcher window is still there. While it is open, Astral does not change the game files. Close that window, and if you cannot see it, end {process} in Task Manager. Then press “Retry”. Nothing was written to the game.",
      "Das Spiel ist schon beendet, aber das Fenster von BattlEye Launcher ist noch da. Solange es offen ist, ändert Astral keine Spieldateien. Schließe dieses Fenster, und falls du es nicht siehst, beende {process} im Task-Manager. Drücke danach „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Gry już nie ma, ale okno BattlEye Launcher zostało otwarte. Dopóki jest otwarte, Astral nie zmienia plików gry. Zamknij to okno, a jeśli go nie widać, zakończ {process} w Menedżerze zadań. Potem naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
};
