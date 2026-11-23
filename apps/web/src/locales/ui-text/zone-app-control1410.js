/*
 * Windows не даёт загрузить файлы Astral (журнал бета-тестера, 14.10.2026):
 * отказы главного процесса `explainAppControlBlock` (`native-engine.js`) и
 * `helperStartMessage` (`rpf-composer.js`). В скобках — исходная строка
 * хоста или помощника, она остаётся как есть.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneAppControl1410 = {
  "Windows заблокировал файл Astral «{0}»: политика управления приложениями (Smart App Control или правила организации) не даёт его загрузить. Так бывает с только что обновлёнными файлами. Подождите и нажмите «Повторить»; не помогло — выключите Smart App Control («Безопасность Windows» → «Управление приложениями и браузером») либо разрешите Astral в антивирусе и перезапустите Astral. ({1})": [
    "Windows заблокувала файл Astral «{0}»: політика керування застосунками (Smart App Control або правила організації) не дає його завантажити. Так буває зі щойно оновленими файлами. Зачекайте й натисніть «Повторити»; не допомогло — вимкніть Smart App Control («Безпека Windows» → «Керування додатками та браузером») або дозвольте Astral в антивірусі та перезапустіть Astral. ({1})",
    "Windows blocked the Astral file “{0}”: an app control policy (Smart App Control or organization rules) will not let it load. This happens with freshly updated files. Wait and press “Retry”; if that does not help, turn off Smart App Control (Windows Security → App & browser control) or allow Astral in your antivirus, then restart Astral. ({1})",
    "Windows hat die Astral-Datei „{0}“ blockiert: Eine App-Steuerungsrichtlinie (Smart App Control oder Regeln der Organisation) lässt das Laden nicht zu. Das passiert bei frisch aktualisierten Dateien. Warte kurz und drücke „Wiederholen“; hilft das nicht, schalte Smart App Control aus (Windows-Sicherheit → App- & Browsersteuerung) oder erlaube Astral im Virenscanner und starte Astral neu. ({1})",
    "Windows zablokował plik Astral „{0}”: zasady kontroli aplikacji (Smart App Control lub reguły organizacji) nie pozwalają go załadować. Tak bywa ze świeżo zaktualizowanymi plikami. Poczekaj i naciśnij „Ponów”; jeśli nie pomoże, wyłącz Smart App Control (Zabezpieczenia Windows → Kontrola aplikacji i przeglądarki) albo zezwól Astral w antywirusie i uruchom Astral ponownie. ({1})",
  ],
  "Встроенный помощник Astral не запустился: его файлы не загрузились или он не ответил. Перезапустите Astral; не помогло — переустановите Astral или добавьте его папку в исключения антивируса. ({0})": [
    "Вбудований помічник Astral не запустився: його файли не завантажилися або він не відповів. Перезапустіть Astral; не допомогло — перевстановіть Astral або додайте його папку до винятків антивіруса. ({0})",
    "The built-in Astral helper did not start: its files failed to load or it did not respond. Restart Astral; if that does not help, reinstall Astral or add its folder to your antivirus exclusions. ({0})",
    "Der integrierte Astral-Helfer ist nicht gestartet: Seine Dateien konnten nicht geladen werden oder er hat nicht geantwortet. Starte Astral neu; hilft das nicht, installiere Astral neu oder füge seinen Ordner den Ausnahmen des Virenscanners hinzu. ({0})",
    "Wbudowany pomocnik Astral nie uruchomił się: jego pliki się nie załadowały albo nie odpowiedział. Uruchom Astral ponownie; jeśli nie pomoże, zainstaluj Astral od nowa albo dodaj jego folder do wyjątków antywirusa. ({0})",
  ],
};
