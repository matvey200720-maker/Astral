/*
 * Слова отказов установки на четырёх языках (24.10.2026, бюджет стартового куска): раньше таблица `WORDS` в `utils/installFailure.js` лежала в
 * главном `main-*.js` сразу на пяти языках, теперь русские слова — ключи, перевод приходит куском языка окна (`trIn`). Тексты те же.
 * Вставки `{logs}`, `{verify}`, `{file}`, `{path}`, `{folder}` — именованные: подставляет `failureWords`.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneH2FailureCopy2410 = {
  "Движок Astral оборвался, не закончив работу": [
    "Рушій Astral обірвався, не завершивши роботу",
    "The Astral engine stopped before finishing",
    "Die Astral-Engine hat mittendrin aufgehört",
    "Silnik Astral przerwał pracę w połowie",
  ],
  "Чаще всего его останавливает антивирус или нехватка оперативной памяти. Добавьте папку Astral (%LOCALAPPDATA%\\Astral) в исключения антивируса, закройте тяжёлые программы и нажмите «Повторить». Если повторится — скачайте журнал ({logs}) и приложите его к тикету в поддержку Astral.":
    [
      "Найчастіше його зупиняє антивірус або брак оперативної пам'яті. Додайте папку Astral (%LOCALAPPDATA%\\Astral) до винятків антивіруса, закрийте важкі програми й натисніть «Повторити». Якщо повториться — завантажте журнал ({logs}) і додайте його до тікета в підтримку Astral.",
      "Most often an antivirus stops it or the PC runs out of memory. Add the Astral folder (%LOCALAPPDATA%\\Astral) to your antivirus exclusions, close heavy programs and press “Retry”. If it happens again, download the log ({logs}) and attach it to a ticket for Astral support.",
      "Meist stoppt sie ein Virenscanner oder der Arbeitsspeicher reicht nicht. Füge den Astral-Ordner (%LOCALAPPDATA%\\Astral) den Ausnahmen des Virenscanners hinzu, schließe speicherhungrige Programme und drücke „Wiederholen“. Passiert es wieder, lade das Protokoll herunter ({logs}) und hänge es an ein Ticket für den Astral-Support.",
      "Najczęściej zatrzymuje go antywirus albo brakuje pamięci RAM. Dodaj folder Astral (%LOCALAPPDATA%\\Astral) do wyjątków antywirusa, zamknij ciężkie programy i naciśnij „Ponów”. Jeśli się powtórzy, pobierz dziennik ({logs}) i dołącz go do zgłoszenia do wsparcia Astral.",
    ],
  "В игре нет файла, из которого собирается выбранный эффект": [
    "У грі немає файлу, з якого збирається вибраний ефект",
    "The game has no file the chosen effect is built from",
    "Im Spiel fehlt die Datei, aus der der gewählte Effekt gebaut wird",
    "W grze brakuje pliku, z którego budowany jest wybrany efekt",
  ],
  "Его вырезал или переложил редукс. Выберите в мастерской другой эффект и снова нажмите «Применить» — или верните оригинальные файлы проверкой целостности игры: {verify} Моды из update.rpf при этом пропадут. Какой файл нужен — в «Подробностях». В игру ничего не записано.":
    [
      "Його вирізав або переклав редукс. Виберіть у майстерні інший ефект і знову натисніть «Застосувати» — або поверніть оригінальні файли перевіркою цілісності гри: {verify} Моди з update.rpf при цьому зникнуть. Який файл потрібен — у «Подробицях». У гру нічого не записано.",
      "A redux removed or moved it. Pick another effect in the workshop and press “Apply” again — or restore the original files by verifying the game: {verify} Mods inside update.rpf will be removed. Which file is needed is under “Details”. Nothing was written to the game.",
      "Ein Redux hat sie entfernt oder verschoben. Wähle in der Werkstatt einen anderen Effekt und drücke erneut „Anwenden“ — oder stelle die Originaldateien wieder her, indem du das Spiel überprüfst: {verify} Mods in update.rpf gehen dabei verloren. Welche Datei fehlt, steht unter „Details“. Im Spiel wurde nichts verändert.",
      "Redux go usunął albo przeniósł. Wybierz w warsztacie inny efekt i znów naciśnij „Zastosuj” — albo przywróć oryginalne pliki, weryfikując grę: {verify} Mody w update.rpf zostaną przy tym usunięte. Jaki plik jest potrzebny — w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
  "В архивах игры нет файла {file}": [
    "В архівах гри немає файлу {file}",
    "The game archives have no {file}",
    "In den Spielarchiven fehlt {file}",
    "W archiwach gry brakuje pliku {file}",
  ],
  "Скорее всего его убрал или переложил редукс либо другая сборка. Верните оригинальные файлы проверкой целостности игры: {verify} Моды из update.rpf при этом пропадут. Затем поставьте нужное через Astral и нажмите «Повторить». Путь к файлу — в «Подробностях». В игру ничего не записано.":
    [
      "Найімовірніше, його прибрав або переклав редукс чи інша збірка. Поверніть оригінальні файли перевіркою цілісності гри: {verify} Моди з update.rpf при цьому зникнуть. Потім встановіть потрібне через Astral і натисніть «Повторити». Шлях до файлу — у «Подробицях». У гру нічого не записано.",
      "Most likely a redux or another pack removed or moved it. Restore the original files by verifying the game: {verify} Mods inside update.rpf will be removed. Then install what you need through Astral and press “Retry”. The file path is under “Details”. Nothing was written to the game.",
      "Meist hat ein Redux oder ein anderes Paket die Datei entfernt oder verschoben. Stelle die Originaldateien wieder her, indem du das Spiel überprüfst: {verify} Mods in update.rpf gehen dabei verloren. Installiere dann das Gewünschte über Astral und drücke „Wiederholen“. Der Dateipfad steht unter „Details“. Im Spiel wurde nichts verändert.",
      "Najpewniej usunął go albo przeniósł redux lub inna paczka. Przywróć oryginalne pliki, weryfikując grę: {verify} Mody w update.rpf zostaną przy tym usunięte. Potem zainstaluj potrzebne rzeczy przez Astral i naciśnij „Ponów”. Ścieżka pliku jest w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
  "В папке игры нет файла {file}": [
    "У теці гри немає файлу {file}",
    "The game folder has no {file}",
    "Im Spielordner fehlt {file}",
    "W folderze gry brakuje pliku {file}",
  ],
  "Проверьте, ту ли папку видит Astral: Настройки → GTA V. Основной должна быть папка, где лежит GTA5.exe; если это не она — нажмите «Сделать основной» у нужной копии или «Добавить папку вручную» → «Выбрать папку». Папка верная, а файла нет — проверьте целостность игры: {verify} Затем нажмите «Повторить». В игру ничего не записано.":
    [
      "Перевірте, чи ту теку бачить Astral: Налаштування → GTA V. Основною має бути тека, де лежить GTA5.exe; якщо це не вона — натисніть «Зробити основною» біля потрібної копії або «Додати теку вручну» → «Вибрати теку». Тека правильна, а файлу немає — перевірте цілісність гри: {verify} Потім натисніть «Повторити». У гру нічого не записано.",
      "Check that Astral looks at the right folder: Settings → GTA V. The main copy must be the folder with GTA5.exe; if it is not, press “Make main” on the right copy or “Add a folder manually” → “Choose folder”. If the folder is right but the file is missing, verify the game: {verify} Then press “Retry”. Nothing was written to the game.",
      "Prüfe, ob Astral den richtigen Ordner sieht: Einstellungen → GTA V. Hauptkopie muss der Ordner mit GTA5.exe sein; ist er es nicht, drücke „Als Hauptkopie“ bei der richtigen Kopie oder „Ordner manuell hinzufügen“ → „Ordner wählen“. Stimmt der Ordner, aber die Datei fehlt, überprüfe das Spiel: {verify} Drücke dann „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Sprawdź, czy Astral widzi właściwy folder: Ustawienia → GTA V. Główną kopią musi być folder z GTA5.exe; jeśli to nie on — naciśnij „Ustaw jako główną” przy właściwej kopii albo „Dodaj folder ręcznie” → „Wybierz folder”. Folder jest dobry, a pliku nie ma — zweryfikuj grę: {verify} Potem naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
  "Windows блокирует файлы Astral": [
    "Windows блокує файли Astral",
    "Windows is blocking Astral files",
    "Windows blockiert Astral-Dateien",
    "Windows blokuje pliki Astral",
  ],
  "Политика управления приложениями (Smart App Control или правила организации) не даёт загрузить файл Astral — обычно это только что обновлённый файл, который Windows ещё не знает. Подождите несколько минут и нажмите «Повторить». Не помогло — выключите Smart App Control («Безопасность Windows» → «Управление приложениями и браузером»; в части версий Windows включить его обратно можно только переустановкой системы) или разрешите Astral в антивирусе, перезапустите Astral и повторите. В игру ничего не записано.":
    [
      "Політика керування застосунками (Smart App Control або правила організації) не дає завантажити файл Astral — зазвичай це щойно оновлений файл, якого Windows ще не знає. Зачекайте кілька хвилин і натисніть «Повторити». Не допомогло — вимкніть Smart App Control («Безпека Windows» → «Керування додатками та браузером»; у частині версій Windows увімкнути його назад можна лише перевстановленням системи) або дозвольте Astral в антивірусі, перезапустіть Astral і повторіть. У гру нічого не записано.",
      "An app control policy (Smart App Control or your organization’s rules) will not let an Astral file load — usually a freshly updated file that Windows does not know yet. Wait a few minutes and press “Retry”. If that does not help, turn off Smart App Control (Windows Security → App & browser control; on some Windows versions it can only be turned back on by reinstalling the system) or allow Astral in your antivirus, restart Astral and retry. Nothing was written to the game.",
      "Eine App-Steuerungsrichtlinie (Smart App Control oder Regeln deiner Organisation) lässt das Laden einer Astral-Datei nicht zu — meist eine frisch aktualisierte Datei, die Windows noch nicht kennt. Warte ein paar Minuten und drücke „Wiederholen“. Hilft das nicht, schalte Smart App Control aus (Windows-Sicherheit → App- & Browsersteuerung; bei manchen Windows-Versionen lässt es sich nur durch Neuinstallation des Systems wieder einschalten) oder erlaube Astral im Virenscanner, starte Astral neu und wiederhole. Ins Spiel wurde nichts geschrieben.",
      "Zasady kontroli aplikacji (Smart App Control lub reguły organizacji) nie pozwalają załadować pliku Astral — zwykle to świeżo zaktualizowany plik, którego Windows jeszcze nie zna. Poczekaj kilka minut i naciśnij „Ponów”. Jeśli nie pomoże, wyłącz Smart App Control (Zabezpieczenia Windows → Kontrola aplikacji i przeglądarki; w części wersji Windows włączyć go z powrotem można tylko przez ponowną instalację systemu) albo zezwól Astral w antywirusie, uruchom Astral ponownie i ponów. Do gry nic nie zapisano.",
    ],
  "Игра читает копию архива из папки mods": [
    "Гра читає копію архіву з папки mods",
    "The game reads a copy of the archive from the mods folder",
    "Das Spiel liest eine Kopie des Archivs aus dem Ordner mods",
    "Gra czyta kopię archiwum z folderu mods",
  ],
  "Рядом с игрой стоит ASI-загрузчик (например, OpenIV): он подменяет update.rpf копией mods\\update\\update.rpf, и то, что Astral кладёт в настоящий update.rpf, в игре не появится. Переименуйте или уберите этот файл (его путь — в «Подробностях») либо отключите загрузчик, затем нажмите «Повторить». В игру ничего не записано.":
    [
      "Поруч із грою стоїть ASI-завантажувач (наприклад, OpenIV): він підміняє update.rpf копією mods\\update\\update.rpf, і те, що Astral кладе в справжній update.rpf, у грі не з’явиться. Перейменуйте або приберіть цей файл (його шлях — у «Подробицях») чи вимкніть завантажувач, потім натисніть «Повторити». У гру нічого не записано.",
      "An ASI loader (for example OpenIV) is installed next to the game: it replaces update.rpf with the copy in mods\\update\\update.rpf, so what Astral writes into the real update.rpf will not show up in the game. Rename or remove that file (its path is under “Details”) or turn the loader off, then press “Retry”. Nothing was written to the game.",
      "Neben dem Spiel liegt ein ASI-Loader (z. B. OpenIV): Er ersetzt update.rpf durch die Kopie in mods\\update\\update.rpf, deshalb erscheint im Spiel nicht, was Astral in die echte update.rpf schreibt. Benenne diese Datei um oder entferne sie (ihr Pfad steht unter „Details“) oder schalte den Loader aus, dann drücke „Wiederholen“. Ins Spiel wurde nichts geschrieben.",
      "Obok gry stoi loader ASI (np. OpenIV): podmienia update.rpf kopią z mods\\update\\update.rpf, więc to, co Astral zapisze w prawdziwym update.rpf, nie pojawi się w grze. Zmień nazwę tego pliku albo go usuń (jego ścieżka jest w „Szczegółach”) lub wyłącz loader, potem naciśnij „Ponów”. Do gry nic nie zapisano.",
    ],
  "Это действие дважды обрывало движок Astral на файлах вашей игры": [
    "Ця дія двічі обривала рушій Astral на файлах вашої гри",
    "This action crashed the Astral engine twice on your game files",
    "Diese Aktion hat die Astral-Engine mit deinen Spieldateien zweimal abstürzen lassen",
    "Ta czynność dwa razy wywróciła silnik Astral na plikach gry",
  ],
  "Чтобы движок не падал по кругу, Astral пока его не выполняет — сам Astral при этом работает. Обычно так бывает с редуксом, который меняет файлы игры. Astral попробует снова, когда файлы игры изменятся (после проверки файлов игры или смены редукса) или когда Astral обновится.":
    [
      "Щоб рушій не падав по колу, Astral поки її не виконує — сам Astral при цьому працює. Зазвичай так буває з редуксом, який змінює файли гри. Astral спробує знову, коли файли гри зміняться (після перевірки файлів гри або зміни редуксу) або коли Astral оновиться.",
      "To keep the engine from crashing over and over, Astral won't run it for now — Astral itself keeps working. This usually happens with a redux that changes game files. Astral will try again once your game files change (after verifying game files or switching the redux) or after Astral updates.",
      "Damit die Engine nicht immer wieder abstürzt, führt Astral sie vorerst nicht aus – Astral selbst läuft weiter. Meist liegt das an einem Redux, der Spieldateien ändert. Astral versucht es erneut, sobald sich die Spieldateien ändern (nach der Überprüfung der Spieldateien oder einem Redux-Wechsel) oder nach einem Astral-Update.",
      "Żeby silnik nie wywracał się w kółko, Astral na razie jej nie wykonuje — sam Astral działa dalej. Zwykle tak bywa z reduxem, który zmienia pliki gry. Astral spróbuje ponownie, gdy pliki gry się zmienią (po weryfikacji plików gry albo zmianie reduxa) albo po aktualizacji Astral.",
    ],
  "Это действие дважды обрывало Astral на файлах вашей игры": [
    "Ця дія двічі обривала Astral на файлах вашої гри",
    "This action crashed Astral twice on your game files",
    "Diese Aktion hat Astral mit den Spieldateien zweimal abstürzen lassen",
    "Ta czynność dwa razy wywróciła Astral na plikach gry",
  ],
  "Чтобы Astral больше не вылетал, он пока его не выполняет. Обычно так бывает с редуксом, который меняет файлы игры. Astral попробует снова, когда файлы игры изменятся (после проверки файлов игры или смены редукса) или когда Astral обновится.":
    [
      "Щоб Astral більше не вилітав, він поки її не виконує. Зазвичай так буває з редуксом, який змінює файли гри. Astral спробує знову, коли файли гри зміняться (після перевірки файлів гри або зміни редукса) або коли Astral оновиться.",
      "To keep Astral from crashing, it skips this action for now. This usually happens with a redux that changes the game files. Astral will try again once the game files change (after verifying the game files or switching the redux) or after an Astral update.",
      "Damit Astral nicht mehr abstürzt, führt es sie vorerst nicht aus. Das passiert meist mit einem Redux, der die Spieldateien ändert. Astral versucht es erneut, sobald sich die Spieldateien ändern (nach der Überprüfung der Spieldateien oder einem Redux-Wechsel) oder nach einem Astral-Update.",
      "Żeby Astral już się nie wywracał, na razie jej nie wykonuje. Zwykle tak bywa z reduxem, który zmienia pliki gry. Astral spróbuje ponownie, gdy pliki gry się zmienią (po weryfikacji plików gry albo zmianie reduxa) albo po aktualizacji Astral.",
    ],
  "Помещение не собралось из файлов вашей игры: не хватило памяти": [
    "Приміщення не зібралося з файлів вашої гри: забракло пам'яті",
    "The room could not be built from your game files: not enough memory",
    "Der Raum ließ sich aus den Spieldateien nicht aufbauen: zu wenig Speicher",
    "Pomieszczenie nie złożyło się z plików gry: zabrakło pamięci",
  ],
  "Обычно так бывает с редуксом, который меняет интерьеры. Astral при этом не вылетает и соберёт помещение снова, когда файлы игры изменятся (после проверки файлов игры или смены редукса).":
    [
      "Зазвичай так буває з редуксом, який змінює інтер'єри. Astral при цьому не вилітає і збере приміщення знову, коли файли гри зміняться (після перевірки файлів гри або зміни редукса).",
      "This usually happens with a redux that changes interiors. Astral does not crash and will build the room again once the game files change (after verifying the game files or switching the redux).",
      "Das passiert meist mit einem Redux, der Innenräume ändert. Astral stürzt dabei nicht ab und baut den Raum erneut auf, sobald sich die Spieldateien ändern (nach der Überprüfung der Spieldateien oder einem Redux-Wechsel).",
      "Zwykle tak bywa z reduxem, który zmienia wnętrza. Astral się przy tym nie wywraca i złoży pomieszczenie ponownie, gdy pliki gry się zmienią (po weryfikacji plików gry albo zmianie reduxa).",
    ],
  "Файлы эффектов в игре нестандартные, их чтение обрывало Astral": [
    "Файли ефектів у грі нестандартні, їх читання обривало Astral",
    "The game's effect files are non-standard, and reading them crashed Astral",
    "Die Effektdateien des Spiels sind nicht standardmäßig, ihr Einlesen hat Astral abstürzen lassen",
    "Pliki efektów w grze są niestandardowe, a ich odczyt wywracał Astral",
  ],
  "Обычно эффекты меняет редукс или графический пак. Чтобы Astral больше не вылетал, он сам их не читает, а редакторы эффектов работают на эталоне Astral. Когда файлы игры изменятся (например, после проверки файлов игры или смены редукса), Astral прочитает их заново.":
    [
      "Зазвичай ефекти змінює редукс або графічний пак. Щоб Astral більше не вилітав, він сам їх не читає, а редактори ефектів працюють на еталоні Astral. Коли файли гри зміняться (наприклад, після перевірки файлів гри або зміни редукса), Astral прочитає їх знову.",
      "Effects are usually changed by a redux or a graphics pack. To keep Astral from crashing, it no longer reads them on its own, and the effect editors work on the Astral reference. Once the game files change (for example after verifying the game files or switching the redux), Astral will read them again.",
      "Effekte ändert meist ein Redux oder ein Grafikpaket. Damit Astral nicht mehr abstürzt, liest es sie nicht mehr selbst, und die Effekt-Editoren arbeiten mit der Astral-Referenz. Sobald sich die Spieldateien ändern (zum Beispiel nach der Überprüfung der Spieldateien oder einem Redux-Wechsel), liest Astral sie erneut.",
      "Efekty zwykle zmienia redux albo pakiet graficzny. Żeby Astral już się nie wywracał, sam ich nie odczytuje, a edytory efektów działają na wzorcu Astral. Gdy pliki gry się zmienią (na przykład po weryfikacji plików gry albo zmianie reduxa), Astral odczyta je ponownie.",
    ],
  "Не удалось получить набор ArchiveFix": [
    "Не вдалося отримати набір ArchiveFix",
    "Could not get the ArchiveFix kit",
    "Das ArchiveFix-Set konnte nicht beschafft werden",
    "Nie udało się pobrać zestawu ArchiveFix",
  ],
  "Это ключи и программа, которыми Astral открывает и правит архивы GTA V; он скачивает их сам. Проверьте интернет (нужен доступ к cdn.astral-mods.online), добавьте %LOCALAPPDATA%\\Astral в исключения антивируса и нажмите «Повторить» — докачается только недостающее. Набор можно подготовить и вручную: Настройки → Инструменты правки → «Подготовить набор». В игру ничего не записано.":
    [
      "Це ключі й програма, якими Astral відкриває та правит архіви GTA V; він завантажує їх сам. Перевірте інтернет (потрібен доступ до cdn.astral-mods.online), додайте %LOCALAPPDATA%\\Astral до винятків антивіруса й натисніть «Повторити» — докачається лише відсутнє. Набір можна підготувати й вручну: Налаштування → Інструменти правки → «Підготувати набір». У гру нічого не записано.",
      "These are the keys and the tool Astral uses to open and edit GTA V archives; it downloads them itself. Check your internet (access to cdn.astral-mods.online is needed), add %LOCALAPPDATA%\\Astral to your antivirus exclusions and press “Retry” — only the missing files are fetched. You can also prepare the kit by hand: Settings → Editing tools → “Prepare the set”. Nothing was written to the game.",
      "Das sind die Schlüssel und das Werkzeug, mit denen Astral GTA-V-Archive öffnet und bearbeitet; es lädt sie selbst herunter. Prüfe das Internet (Zugriff auf cdn.astral-mods.online nötig), füge %LOCALAPPDATA%\\Astral den Ausnahmen des Virenscanners hinzu und drücke „Wiederholen“ — nur Fehlendes wird nachgeladen. Du kannst das Set auch von Hand vorbereiten: Einstellungen → Werkzeuge → „Set vorbereiten“. Ins Spiel wurde nichts geschrieben.",
      "To klucze i narzędzie, którymi Astral otwiera i edytuje archiwa GTA V; pobiera je sam. Sprawdź internet (potrzebny dostęp do cdn.astral-mods.online), dodaj %LOCALAPPDATA%\\Astral do wyjątków antywirusa i naciśnij „Ponów” — pobierze się tylko brakujące. Zestaw można też przygotować ręcznie: Ustawienia → Narzędzia edycji → „Przygotuj zestaw”. Do gry nic nie zapisano.",
    ],
  "Этот мод сейчас недоступен": [
    "Цей мод зараз недоступний",
    "This mod is unavailable right now",
    "Diese Mod ist gerade nicht verfügbar",
    "Ten mod jest teraz niedostępny",
  ],
  "Установить его сейчас нельзя — загляните позже. В игру ничего не записано.":
    [
      "Встановити його зараз не можна — зазирніть пізніше. У гру нічого не записано.",
      "It can’t be installed at the moment — check back later. Nothing was written to the game.",
      "Sie lässt sich im Moment nicht installieren — schau später wieder vorbei. Im Spiel wurde nichts verändert.",
      "Nie można go teraz zainstalować — zajrzyj później. Nic nie zostało zapisane w grze.",
    ],
  "Файлы набора не той версии, что код Astral": [
    "Файли набору не тієї версії, що код Astral",
    "The set files don’t match this version of Astral",
    "Die Set-Dateien passen nicht zur Version von Astral",
    "Pliki zestawu nie pasują do wersji Astral",
  ],
  "Так бывает, когда в сборке Astral файлы набора остались от прежней версии (реже — файл повредился на диске). Переустановка той же сборки не поможет: обновите Astral — Настройки → О программе → «Проверить сейчас». Если новой версии ещё нет, подождите выпуска. Если после обновления то же самое — скачайте журнал ({logs}) и пришлите в поддержку; какой файл не сошёлся, видно в «Подробностях». В игру ничего не записано.":
    [
      "Так буває, коли у збірці Astral файли набору лишилися від попередньої версії (рідше — файл пошкодився на диску). Перевстановлення тієї самої збірки не допоможе: оновіть Astral — Налаштування → Про програму → «Перевірити зараз». Якщо нової версії ще немає, зачекайте на випуск. Якщо після оновлення те саме — завантажте журнал ({logs}) і надішліть його в підтримку; який файл не зійшовся, видно в «Подробицях». У гру нічого не записано.",
      "This happens when the Astral build still carries set files from an earlier version (less often, a file got damaged on disk). Reinstalling the same build won’t help: update Astral — Settings → About → “Check now”. If there’s no new version yet, wait for the release. If it still fails after updating, download the log ({logs}) and send it to support; “Details” shows which file didn’t match. Nothing was written to the game.",
      "Das passiert, wenn in der Astral-Version noch Set-Dateien einer früheren Version liegen (seltener ist eine Datei auf dem Datenträger beschädigt). Eine Neuinstallation derselben Version hilft nicht: Aktualisiere Astral — Einstellungen → Über → „Jetzt prüfen“. Gibt es noch keine neue Version, warte auf das Release. Klappt es nach dem Update immer noch nicht, lade das Protokoll herunter ({logs}) und schicke es an den Support; unter „Details“ steht, welche Datei nicht passt. Im Spiel wurde nichts verändert.",
      "Tak bywa, gdy w kompilacji Astral zostały pliki zestawu z poprzedniej wersji (rzadziej plik uszkodził się na dysku). Ponowna instalacja tej samej kompilacji nie pomoże: zaktualizuj Astral — Ustawienia → O programie → „Sprawdź teraz”. Jeśli nowej wersji jeszcze nie ma, poczekaj na wydanie. Jeśli po aktualizacji jest tak samo, pobierz dziennik ({logs}) i wyślij go do wsparcia; w „Szczegółach” widać, który plik się nie zgadza. Nic nie zostało zapisane w grze.",
    ],
  "Файлы набора не найдены рядом с приложением": [
    "Файли набору не знайдено поруч із програмою",
    "The set files weren’t found next to the app",
    "Die Set-Dateien wurden neben dem Programm nicht gefunden",
    "Nie znaleziono plików zestawu obok programu",
  ],
  "Так бывает, когда установка Astral неполная или антивирус убрал часть файлов программы. Закройте Astral, запустите установщик Astral ещё раз и добавьте папку программы Astral в исключения антивируса. Не помогло — скачайте журнал ({logs}) и пришлите в поддержку; какого набора не хватает, видно в «Подробностях». В игру ничего не записано.":
    [
      "Так буває, коли встановлення Astral неповне або антивірус прибрав частину файлів програми. Закрийте Astral, запустіть установник Astral ще раз і додайте папку програми Astral до винятків антивіруса. Не допомогло — завантажте журнал ({logs}) і надішліть його в підтримку; якого набору бракує, видно в «Подробицях». У гру нічого не записано.",
      "This happens when the Astral installation is incomplete or an antivirus removed some of the program files. Close Astral, run the Astral installer again and add the Astral program folder to your antivirus exclusions. If that doesn’t help, download the log ({logs}) and send it to support; “Details” shows which set is missing files. Nothing was written to the game.",
      "Das passiert, wenn die Astral-Installation unvollständig ist oder ein Virenscanner einen Teil der Programmdateien entfernt hat. Schließe Astral, starte das Astral-Installationsprogramm noch einmal und nimm den Programmordner von Astral in die Ausnahmen deines Virenscanners auf. Hilft das nicht, lade das Protokoll herunter ({logs}) und schicke es an den Support; unter „Details“ steht, welchem Set Dateien fehlen. Im Spiel wurde nichts verändert.",
      "Tak bywa, gdy instalacja Astral jest niepełna albo antywirus usunął część plików programu. Zamknij Astral, uruchom instalator Astral jeszcze raz i dodaj folder programu Astral do wyjątków antywirusa. Jeśli to nie pomoże, pobierz dziennik ({logs}) i wyślij go do wsparcia; w „Szczegółach” widać, któremu zestawowi brakuje plików. Nic nie zostało zapisane w grze.",
    ],
  "Файл {file} в игре испорчен другим модом": [
    "Файл {file} у грі зіпсовано іншим модом",
    "The game file {file} is broken by another mod",
    "Die Spieldatei {file} wurde von einem anderen Mod beschädigt",
    "Plik gry {file} został uszkodzony przez inny mod",
  ],
  "Astral не может его прочитать — так бывает после редукса, который правили вручную. Верните оригинальные файлы проверкой целостности игры: {verify} Моды из update.rpf при этом пропадут. Потом поставьте нужное через Astral и нажмите «Повторить». В игру ничего не записано.":
    [
      "Astral не може його прочитати — так буває після редукса, який правили вручну. Поверніть оригінальні файли перевіркою цілісності гри: {verify} Моди з update.rpf при цьому зникнуть. Потім поставте потрібне через Astral і натисніть «Повторити». У гру нічого не записано.",
      "Astral can't read it — this happens after a redux that was edited by hand. Restore the original files by verifying the game: {verify} Mods inside update.rpf will be removed. Then install what you need through Astral and press “Retry”. Nothing was written to the game.",
      "Astral kann sie nicht lesen — das passiert nach einem von Hand bearbeiteten Redux. Stelle die Originaldateien wieder her, indem du das Spiel überprüfst: {verify} Mods in update.rpf gehen dabei verloren. Installiere dann das Gewünschte über Astral und drücke „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Astral nie może go odczytać — tak bywa po reduxie edytowanym ręcznie. Przywróć oryginalne pliki, weryfikując grę: {verify} Mody w update.rpf zostaną przy tym usunięte. Potem zainstaluj potrzebne rzeczy przez Astral i naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
  "Архив игры переделан другой сборкой": [
    "Архів гри перероблено іншою збіркою",
    "The game archive was rebuilt by another mod pack",
    "Das Spielarchiv wurde von einem anderen Mod-Paket umgebaut",
    "Archiwum gry zostało przebudowane przez inną paczkę",
  ],
  "Эффекты игры в update.rpf изменены другой сборкой (файлов нет на штатных местах или ядро собрано иначе), и эффекты и трассеры Astral на них не лягут. Верните оригинал проверкой целостности игры: {verify} Чужие сборки из update.rpf при этом пропадут. Затем поставьте сборку из каталога Astral и нажмите «Повторить». Причина — в «Подробностях». В игру ничего не записано.":
    [
      "Ефекти гри в update.rpf змінені іншою збіркою (файлів немає на штатних місцях або ядро зібрано інакше), і ефекти та трасери Astral на них не ляжуть. Поверніть оригінал перевіркою цілісності гри: {verify} Чужі збірки з update.rpf при цьому зникнуть. Потім встановіть збірку з каталогу Astral і натисніть «Повторити». Причина — у «Подробицях». У гру нічого не записано.",
      "The game’s effects in update.rpf were changed by another pack (files are not in the standard places or the core is built differently), so Astral’s effects and tracers can’t go onto them. Restore the original by verifying the game: {verify} Other packs inside update.rpf will be removed. Then install a pack from the Astral catalogue and press “Retry”. The reason is in Details. Nothing was written to the game.",
      "Die Spieleffekte in update.rpf wurden von einem anderen Paket verändert (Dateien liegen nicht an den Standardorten oder der Kern ist anders gebaut), deshalb können die Effekte und Tracer von Astral nicht darauf. Stelle das Original wieder her, indem du das Spiel überprüfst: {verify} Fremde Pakete in update.rpf verschwinden dabei. Installiere danach ein Paket aus dem Astral-Katalog und drücke „Wiederholen“. Den Grund findest du unter „Details“. Im Spiel wurde nichts verändert.",
      "Efekty gry w update.rpf zostały zmienione przez inną paczkę (pliki nie leżą w standardowych miejscach albo rdzeń jest zbudowany inaczej), więc efekty i tracery Astral nie mogą na nich zadziałać. Przywróć oryginał, weryfikując grę: {verify} Obce paczki w update.rpf znikną. Potem zainstaluj paczkę z katalogu Astral i naciśnij „Ponów”. Powód jest w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
  "Файл игры повреждён или нестандартный": [
    "Файл гри пошкоджений або нестандартний",
    "A game file is damaged or non-standard",
    "Eine Spieldatei ist beschädigt oder nicht standardgemäß",
    "Plik gry jest uszkodzony lub niestandardowy",
  ],
  "При распаковке он выходит больше, чем заявлено в нём самом, или у него нет заголовка — так бывает с повреждёнными файлами и с файлами некоторых редуксов. Astral не стал его разбирать, чтобы не занять всю память компьютера. Верните оригинал проверкой целостности игры: {verify} Моды из update.rpf при этом пропадут. Затем нажмите «Повторить». Имя файла — в «Подробностях». В игру ничего не записано.":
    [
      "Під час розпакування він виходить більшим, ніж заявлено в ньому самому, або в нього немає заголовка — так буває з пошкодженими файлами і з файлами деяких редуксів. Astral не став його розбирати, щоб не зайняти всю пам'ять комп'ютера. Поверніть оригінал перевіркою цілісності гри: {verify} Моди з update.rpf при цьому зникнуть. Потім натисніть «Повторити». Назва файлу — у «Подробицях». У гру нічого не записано.",
      "When unpacked it comes out larger than the file itself declares, or it has no header — this happens with damaged files and with files from some reduxes. Astral didn’t read it so as not to use up all of your computer’s memory. Restore the original by verifying the game: {verify} Mods inside update.rpf will be removed. Then press “Retry”. The file name is in Details. Nothing was written to the game.",
      "Beim Entpacken wird sie größer, als sie selbst angibt, oder ihr fehlt der Header — das passiert bei beschädigten Dateien und bei Dateien mancher Reduxe. Astral hat sie nicht gelesen, um nicht den ganzen Arbeitsspeicher des Computers zu belegen. Stelle das Original wieder her, indem du das Spiel überprüfst: {verify} Mods in update.rpf gehen dabei verloren. Drücke dann „Wiederholen“. Der Dateiname steht unter „Details“. Im Spiel wurde nichts verändert.",
      "Po rozpakowaniu wychodzi większy, niż sam deklaruje, albo nie ma nagłówka — tak bywa z uszkodzonymi plikami i z plikami niektórych reduxów. Astral go nie odczytał, żeby nie zająć całej pamięci komputera. Przywróć oryginał, weryfikując grę: {verify} Mody w update.rpf zostaną przy tym usunięte. Potem naciśnij „Ponów”. Nazwa pliku jest w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
  "Файл update.rpf в игре не читается": [
    "Файл update.rpf у грі не читається",
    "The game’s update.rpf can’t be read",
    "Die update.rpf des Spiels lässt sich nicht lesen",
    "Nie da się odczytać pliku update.rpf w grze",
  ],
  "Он повреждён или записан не так, как ждёт Astral: чаще всего после того, как в него вписали файл вручную (например, через OpenIV) или поставили чужую сборку. Верните оригинал проверкой целостности игры: {verify} Всё, что лежало в update.rpf, пропадёт. Затем поставьте нужное через Astral и нажмите «Повторить». update.rpf руками не правьте. В игру ничего не записано.":
    [
      "Він пошкоджений або записаний не так, як чекає Astral: найчастіше після того, як у нього вписали файл вручну (наприклад, через OpenIV) або поставили чужу збірку. Поверніть оригінал перевіркою цілісності гри: {verify} Усе, що лежало в update.rpf, зникне. Потім встановіть потрібне через Astral і натисніть «Повторити». update.rpf руками не правте. У гру нічого не записано.",
      "It is damaged or written in a way Astral doesn’t expect: most often after a file was added to it by hand (for example with OpenIV) or another pack was installed. Restore the original by verifying the game: {verify} Everything that was inside update.rpf will be removed. Then install what you need through Astral and press “Retry”. Don’t edit update.rpf by hand. Nothing was written to the game.",
      "Sie ist beschädigt oder anders geschrieben, als Astral es erwartet: meist nachdem von Hand eine Datei hineingeschrieben wurde (zum Beispiel mit OpenIV) oder ein fremdes Paket installiert wurde. Stelle das Original wieder her, indem du das Spiel überprüfst: {verify} Alles, was in update.rpf lag, verschwindet. Installiere danach das Gewünschte über Astral und drücke „Wiederholen“. Bearbeite update.rpf nicht von Hand. Im Spiel wurde nichts verändert.",
      "Jest uszkodzony albo zapisany inaczej, niż oczekuje Astral: najczęściej po ręcznym dopisaniu do niego pliku (na przykład w OpenIV) albo po instalacji obcej paczki. Przywróć oryginał, weryfikując grę: {verify} Wszystko, co było w update.rpf, zniknie. Potem zainstaluj potrzebne rzeczy przez Astral i naciśnij „Ponów”. Nie edytuj update.rpf ręcznie. Nic nie zostało zapisane w grze.",
    ],
  "Сборка повредила вложенный архив": [
    "Збірка пошкодила вкладений архів",
    "The build damaged a nested archive",
    "Der Aufbau hat ein verschachteltes Archiv beschädigt",
    "Budowa uszkodziła zagnieżdżone archiwum",
  ],
  "Astral проверил собранный архив перед записью, не стал менять архив игры, и в игру ничего не попало. Нажмите «Повторить». Если повторится снова — скачайте журнал ({logs}) и пришлите его в поддержку. В игру ничего не записано.":
    [
      "Astral перевірив зібраний архів перед записом, не став змінювати архів гри, і в гру нічого не потрапило. Натисніть «Повторити». Якщо повториться знову — завантажте журнал ({logs}) і надішліть його в підтримку. У гру нічого не записано.",
      "Astral checked the rebuilt archive before writing it, left the game archive alone, and nothing reached the game. Press Retry. If it happens again, download the log ({logs}) and send it to support. Nothing was written to the game.",
      "Astral hat das neu gebaute Archiv vor dem Schreiben geprüft, das Spielarchiv nicht verändert, und nichts ist ins Spiel gelangt. Drücke „Wiederholen“. Falls es wieder passiert, lade das Protokoll herunter ({logs}) und schicke es an den Support. Im Spiel wurde nichts verändert.",
      "Astral sprawdził zbudowane archiwum przed zapisem, nie zmienił archiwum gry i nic nie trafiło do gry. Naciśnij „Ponów”. Jeśli powtórzy się znowu, pobierz dziennik ({logs}) i wyślij go do wsparcia. Nic nie zostało zapisane w grze.",
    ],
  "Astral не нашёл свои копии файлов игры": [
    "Astral не знайшов свої копії файлів гри",
    "Astral could not find its copies of the game files",
    "Astral hat seine Kopien der Spieldateien nicht gefunden",
    "Astral nie znalazł swoich kopii plików gry",
  ],
  "Обычно это после чистки кэша, переноса папки Astral или антивируса. Нажмите «Повторить» — Astral соберёт их заново из файлов игры. Не помогло — проверьте целостность игры: {verify} Затем снова нажмите «Повторить». В игру ничего не записано.":
    [
      "Зазвичай це після чищення кешу, перенесення папки Astral або антивіруса. Натисніть «Повторити» — Astral збере їх заново з файлів гри. Не допомогло — перевірте цілісність гри: {verify} Потім знову натисніть «Повторити». У гру нічого не записано.",
      "This usually follows a cache cleanup, moving the Astral folder or an antivirus. Press “Retry” — Astral rebuilds them from the game files. If that does not help, verify the game: {verify} Then press “Retry” again. Nothing was written to the game.",
      "Meist nach einer Cache-Bereinigung, dem Verschieben des Astral-Ordners oder durch einen Virenscanner. Drücke „Wiederholen“ — Astral baut sie aus den Spieldateien neu auf. Hilft das nicht, überprüfe das Spiel: {verify} Drücke dann erneut „Wiederholen“. Ins Spiel wurde nichts geschrieben.",
      "Zwykle po czyszczeniu pamięci podręcznej, przeniesieniu folderu Astral albo przez antywirus. Naciśnij „Ponów” — Astral odbuduje je z plików gry. Jeśli nie pomoże — zweryfikuj grę: {verify} Potem znów naciśnij „Ponów”. Do gry nic nie zapisano.",
    ],
  "Эти файлы игры у тебя уже изменены другим модом": [
    "Ці файли гри у тебе вже змінені іншим модом",
    "Another mod already changes these game files",
    "Ein anderer Mod ändert diese Spieldateien bereits",
    "Inny mod już zmienia te pliki gry",
  ],
  "Выбери ниже: оставить своё или заменить — и Astral продолжит. В игру ничего не записано.":
    [
      "Обери нижче: залишити своє чи замінити — і Astral продовжить. У гру нічого не записано.",
      "Choose below: keep yours or replace — and Astral will continue. Nothing was written to the game.",
      "Wähle unten: deine behalten oder ersetzen — dann macht Astral weiter. Ins Spiel wurde nichts geschrieben.",
      "Wybierz poniżej: zostaw swoje albo zamień — Astral będzie kontynuować. Do gry nic nie zapisano.",
    ],
  "Файл россыпи (мелкие предметы и мусор на земле) менял другой мод": [
    "Файл розсипу (дрібні предмети й сміття на землі) змінював інший мод",
    "Another mod changed the scatter file (small objects and litter on the ground)",
    "Ein anderer Mod hat die Streuungsdatei geändert (kleine Gegenstände und Müll am Boden)",
    "Inny mod zmienił plik rozsypki (drobne przedmioty i śmieci na ziemi)",
  ],
  "Можно вернуть его к штатному кнопкой «Вернуть россыпь штатной» — правки этого мода в россыпи пропадут, остальное останется.":
    [
      "Його можна повернути до штатного кнопкою «Повернути розсип штатним» — правки цього мода в розсипі зникнуть, решта залишиться.",
      "You can put it back to stock with “Restore stock scatter” — that mod’s scatter edits will be lost, everything else stays.",
      "Du kannst sie mit „Standard-Streuung wiederherstellen“ zurücksetzen — die Streuungs-Änderungen dieses Mods gehen verloren, alles andere bleibt.",
      "Możesz przywrócić go do standardowego przyciskiem „Przywróć standardową rozsypkę” — zmiany tego moda w rozsypce znikną, reszta zostanie.",
    ],
  "Не удалось вернуть файлы игры после отмены": [
    "Не вдалося повернути файли гри після скасування",
    "Could not restore the game files after cancelling",
    "Spieldateien nach dem Abbruch nicht wiederhergestellt",
    "Nie udało się przywrócić plików gry po anulowaniu",
  ],
  "Установка остановлена, но игра не вернулась к прежнему состоянию. Закройте GTA V и откройте Настройки → GTA V → «Вернуть GTA V без модов» — игра вернётся целиком. Подробности — в журнале ({logs}).":
    [
      "Встановлення зупинено, але гра не повернулася до попереднього стану. Закрийте GTA V і відкрийте Налаштування → GTA V → «Повернути GTA V без модів» — гра повернеться повністю. Подробиці — у журналі ({logs}).",
      "The installation was stopped, but the game did not return to its previous state. Close GTA V and open Settings → GTA V → “Restore GTA V without mods” — the game will be restored in full. Details are in the log ({logs}).",
      "Die Installation wurde gestoppt, aber das Spiel ist nicht in den vorherigen Zustand zurückgekehrt. Schließe GTA V und öffne Einstellungen → GTA V → „GTA V ohne Mods wiederherstellen“ — das Spiel wird vollständig zurückgesetzt. Details stehen im Protokoll ({logs}).",
      "Instalacja została zatrzymana, ale gra nie wróciła do poprzedniego stanu. Zamknij GTA V i otwórz Ustawienia → GTA V → „Przywróć GTA V bez modów” — gra wróci w całości. Szczegóły są w dzienniku ({logs}).",
    ],
  "Astral переносит точки отката": [
    "Astral переносить точки відкату",
    "Astral is moving rollback points",
    "Astral verschiebt Wiederherstellungspunkte",
    "Astral przenosi punkty cofnięcia",
  ],
  "Точки отката переезжают в новую папку кэша. Дождитесь конца переноса и нажмите «Повторить». В игру ничего не записано.":
    [
      "Точки відкату переїжджають до нової папки кешу. Дочекайтеся кінця перенесення і натисніть «Повторити». У гру нічого не записано.",
      "Rollback points are moving to the new cache folder. Wait until the move finishes, then press “Retry”. Nothing was written to the game.",
      "Die Wiederherstellungspunkte ziehen in den neuen Cache-Ordner um. Warte, bis der Umzug fertig ist, und drücke „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Punkty cofnięcia przenoszą się do nowego folderu pamięci podręcznej. Poczekaj na koniec przenoszenia i naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
  "Копия точек отката не совпала": [
    "Копія точок відкату не збіглася",
    "The rollback point copy did not match",
    "Die Kopie der Wiederherstellungspunkte stimmt nicht",
    "Kopia punktów cofnięcia się nie zgadza",
  ],
  "Точки отката остались на прежнем месте, кэш не перенесён. Проверьте диск, на который переносите кэш, и попробуйте снова.":
    [
      "Точки відкату лишилися на старому місці, кеш не перенесено. Перевірте диск, на який переносите кеш, і спробуйте знову.",
      "Rollback points stayed where they were and the cache was not moved. Check the drive you are moving the cache to and try again.",
      "Die Wiederherstellungspunkte sind am alten Ort geblieben, der Cache wurde nicht verschoben. Prüfe das Laufwerk, auf das du den Cache verschiebst, und versuche es erneut.",
      "Punkty cofnięcia zostały na starym miejscu, pamięć podręczna nie została przeniesiona. Sprawdź dysk, na który przenosisz pamięć podręczną, i spróbuj ponownie.",
    ],
  "GTA V обновляется": [
    "GTA V оновлюється",
    "GTA V is being updated",
    "GTA V wird aktualisiert",
    "GTA V jest aktualizowane",
  ],
  "Steam, Epic Games или Rockstar Games Launcher обновляет или проверяет файлы игры. Дождитесь конца и нажмите «Повторить». В игру ничего не записано.":
    [
      "Steam, Epic Games або Rockstar Games Launcher оновлює чи перевіряє файли гри. Дочекайтеся кінця і натисніть «Повторити». У гру нічого не записано.",
      "Steam, Epic Games or the Rockstar Games Launcher is updating or verifying the game files. Wait until it finishes, then press “Retry”. Nothing was written to the game.",
      "Steam, Epic Games oder der Rockstar Games Launcher aktualisiert oder prüft die Spieldateien. Warte, bis er fertig ist, und drücke „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Steam, Epic Games lub Rockstar Games Launcher aktualizuje albo sprawdza pliki gry. Poczekaj, aż skończy, i naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
  "Не удалось проверить, запущена ли GTA V": [
    "Не вдалося перевірити, чи запущена GTA V",
    "Couldn’t check whether GTA V is running",
    "Konnte nicht prüfen, ob GTA V läuft",
    "Nie udało się sprawdzić, czy GTA V jest uruchomione",
  ],
  "Astral спрашивает у Windows список процессов (команда tasklist) и не получил ответа, поэтому установка остановлена на всякий случай. Проверьте антивирус: разрешите Astral запускать системные команды. Закройте Astral, откройте снова и нажмите «Повторить». Причина — в «Подробностях». В игру ничего не записано.":
    [
      "Astral питає в Windows список процесів (команда tasklist) і не отримав відповіді, тому установку зупинено про всяк випадок. Перевірте антивірус: дозвольте Astral запускати системні команди. Закрийте Astral, відкрийте знову й натисніть «Повторити». Причина — у «Подробицях». У гру нічого не записано.",
      "Astral asks Windows for the process list (the tasklist command) and got no answer, so the install was stopped to be safe. Check your antivirus: let Astral run system commands. Close Astral, open it again and press “Retry”. The reason is in Details. Nothing was written to the game.",
      "Astral fragt Windows nach der Prozessliste (Befehl tasklist) und bekam keine Antwort, deshalb wurde die Installation sicherheitshalber gestoppt. Prüfe dein Antivirenprogramm: erlaube Astral, Systembefehle auszuführen. Schließe Astral, öffne es neu und drücke „Wiederholen“. Den Grund findest du unter „Details“. Im Spiel wurde nichts verändert.",
      "Astral pyta Windows o listę procesów (polecenie tasklist) i nie dostał odpowiedzi, więc instalację zatrzymano dla bezpieczeństwa. Sprawdź antywirus: pozwól Astralowi uruchamiać polecenia systemowe. Zamknij Astral, otwórz go ponownie i naciśnij „Ponów”. Powód jest w „Szczegółach”. Nic nie zostało zapisane w grze.",
    ],
  "GTA V запущена": [
    "GTA V запущена",
    "GTA V is running",
    "GTA V läuft",
    "GTA V jest uruchomione",
  ],
  "Закройте игру, лаунчеры GTA5RP и Majestic и нажмите «Повторить». В игру ничего не записано.":
    [
      "Закрийте гру, лаунчери GTA5RP і Majestic і натисніть «Повторити». У гру нічого не записано.",
      "Close the game and the GTA5RP and Majestic launchers, then press “Retry”. Nothing was written to the game.",
      "Schließe das Spiel sowie die Launcher von GTA5RP und Majestic und drücke „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Zamknij grę oraz launchery GTA5RP i Majestic, a potem naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
  "Не хватает места на диске": [
    "Не вистачає місця на диску",
    "Not enough disk space",
    "Nicht genug Speicherplatz",
    "Za mało miejsca na dysku",
  ],
  "Освободите место на диске с игрой и на системном диске (обычно C:) — там папка Astral с копиями файлов игры. Папку данных Astral можно перенести на другой диск: Настройки → Место → Хранилище. Затем нажмите «Повторить». В игру ничего не записано.":
    [
      "Звільніть місце на диску з грою і на системному диску (зазвичай C:) — там папка Astral з копіями файлів гри. Папку даних Astral можна перенести на інший диск: Налаштування → Місце → Сховище. Потім натисніть «Повторити». У гру нічого не записано.",
      "Free up space on the game drive and on the system drive (usually C:) — that is where the Astral folder with copies of game files lives. You can move the Astral data folder to another drive: Settings → Storage. Then press “Retry”. Nothing was written to the game.",
      "Schaffe Platz auf dem Laufwerk des Spiels und auf dem Systemlaufwerk (meist C:) — dort liegt der Astral-Ordner mit Kopien der Spieldateien. Den Datenordner von Astral kannst du auf ein anderes Laufwerk verschieben: Einstellungen → Speicher. Drücke dann „Wiederholen“. Im Spiel wurde nichts verändert.",
      "Zwolnij miejsce na dysku z grą i na dysku systemowym (zwykle C:) — tam jest folder Astral z kopiami plików gry. Folder danych Astral możesz przenieść na inny dysk: Ustawienia → Miejsce → Pamięć. Potem naciśnij „Ponów”. Nic nie zostało zapisane w grze.",
    ],
  "Windows не даёт Astral создавать папки в {path}": [
    "Windows не дає Astral створювати папки в {path}",
    "Windows does not let Astral create folders in {path}",
    "Windows lässt Astral in {path} keine Ordner anlegen",
    "Windows nie pozwala Astral tworzyć folderów w {path}",
  ],
  "Создайте папку, например {folder}, и выберите её. Если не поможет — разрешите Astral в «Контролируемом доступе к папкам» Защитника Windows.":
    [
      "Створіть папку, наприклад {folder}, і виберіть її. Якщо не допоможе — дозвольте Astral у «Контрольованому доступі до папок» Захисника Windows.",
      "Create a folder, for example {folder}, and choose it. If that does not help, allow Astral in Windows Defender “Controlled folder access”.",
      "Lege einen Ordner an, zum Beispiel {folder}, und wähle ihn aus. Hilft das nicht, erlaube Astral im „Überwachten Ordnerzugriff“ von Windows Defender.",
      "Utwórz folder, na przykład {folder}, i wybierz go. Jeśli nie pomoże, zezwól Astral w „Kontrolowanym dostępie do folderów” Windows Defender.",
    ],
  "Не удалось скачать": [
    "Не вдалося завантажити",
    "Download failed",
    "Download fehlgeschlagen",
    "Nie udało się pobrać",
  ],
  "Проверьте интернет и нажмите «Повторить» — загрузка продолжится с того места, где оборвалась. В игру ничего не записано.":
    [
      "Перевірте інтернет і натисніть «Повторити» — завантаження продовжиться з того місця, де обірвалося. У гру нічого не записано.",
      "Check your internet connection and press “Retry” — the download continues from where it stopped. Nothing was written to the game.",
      "Prüfe die Internetverbindung und drücke „Wiederholen“ — der Download geht dort weiter, wo er abgebrochen ist. Im Spiel wurde nichts verändert.",
      "Sprawdź internet i naciśnij „Ponów” — pobieranie będzie kontynuowane od miejsca, w którym się przerwało. Nic nie zostało zapisane w grze.",
    ],
  "Файл мода пришёл повреждённым": [
    "Файл мода прийшов пошкодженим",
    "The mod file arrived damaged",
    "Die Mod-Datei kam beschädigt an",
    "Plik moda dotarł uszkodzony",
  ],
  "Нажмите «Повторить» — файл скачается заново. Если снова — файл в каталоге битый: напишите автору мода.":
    [
      "Натисніть «Повторити» — файл завантажиться заново. Якщо знову — файл у каталозі битий: напишіть автору мода.",
      "Press “Retry” — the file is downloaded again. If it happens again, the file in the catalog is broken: contact the mod author.",
      "Drücke „Wiederholen“ — die Datei wird neu geladen. Passiert es erneut, ist die Datei im Katalog defekt: schreib dem Mod-Autor.",
      "Naciśnij „Ponów” — plik zostanie pobrany od nowa. Jeśli znowu — plik w katalogu jest uszkodzony: napisz do autora moda.",
    ],
  "Антивирус заблокировал файл": [
    "Антивірус заблокував файл",
    "Your antivirus blocked a file",
    "Der Virenscanner hat eine Datei blockiert",
    "Antywirus zablokował plik",
  ],
  "Он принял файл мода или Astral за угрозу и не дал его записать. Добавьте папку игры и папку Astral (%LOCALAPPDATA%\\Astral) в исключения антивируса и нажмите «Повторить». В игру ничего не записано.":
    [
      "Він прийняв файл мода або Astral за загрозу й не дав його записати. Додайте папку гри та папку Astral (%LOCALAPPDATA%\\Astral) до винятків антивіруса й натисніть «Повторити». У гру нічого не записано.",
      "It took a mod or Astral file for a threat and stopped it from being written. Add the game folder and the Astral folder (%LOCALAPPDATA%\\Astral) to your antivirus exclusions and press “Retry”. Nothing was written to the game.",
      "Er hat eine Mod- oder Astral-Datei für eine Bedrohung gehalten und das Schreiben verhindert. Füge den Spielordner und den Astral-Ordner (%LOCALAPPDATA%\\Astral) den Ausnahmen hinzu und drücke „Wiederholen“. Ins Spiel wurde nichts geschrieben.",
      "Uznał plik moda lub Astral za zagrożenie i nie pozwolił go zapisać. Dodaj folder gry i folder Astral (%LOCALAPPDATA%\\Astral) do wyjątków antywirusa i naciśnij „Ponów”. Do gry nic nie zapisano.",
    ],
  "Рабочая папка сборки пропала": [
    "Робоча папка збірки зникла",
    "The build work folder disappeared",
    "Der Arbeitsordner des Builds ist verschwunden",
    "Folder roboczy budowania zniknął",
  ],
  "Пока Astral собирал плашки, их рабочую папку кто-то убрал (чаще всего антивирус или чистильщик диска) — или хост её не видит. Добавьте папку Astral (%LOCALAPPDATA%\\Astral) в исключения антивируса и нажмите «Повторить». В игру ничего не записано.":
    [
      "Поки Astral збирав плашки, їхню робочу папку хтось прибрав (найчастіше антивірус або чистильник диска) — або хост її не бачить. Додайте папку Astral (%LOCALAPPDATA%\\Astral) до винятків антивіруса й натисніть «Повторити». У гру нічого не записано.",
      "While Astral was building the panels, something removed their work folder (most often an antivirus or a disk cleaner) — or the host cannot see it. Add the Astral folder (%LOCALAPPDATA%\\Astral) to your antivirus exclusions and press “Retry”. Nothing was written to the game.",
      "Während Astral die Tafeln gebaut hat, hat etwas ihren Arbeitsordner entfernt (meist ein Virenscanner oder eine Datenträgerbereinigung) — oder der Host sieht ihn nicht. Füge den Astral-Ordner (%LOCALAPPDATA%\\Astral) den Ausnahmen des Virenscanners hinzu und drücke „Wiederholen“. Ins Spiel wurde nichts geschrieben.",
      "Gdy Astral budował tabliczki, coś usunęło ich folder roboczy (najczęściej antywirus lub czyszczenie dysku) — albo host go nie widzi. Dodaj folder Astral (%LOCALAPPDATA%\\Astral) do wyjątków antywirusa i naciśnij „Ponów”. Do gry nic nie zapisano.",
    ],
  "Нет прав на запись в папку": [
    "Немає прав на запис у папку",
    "No permission to write to the folder",
    "Keine Schreibrechte für den Ordner",
    "Brak uprawnień do zapisu w folderze",
  ],
  "Windows не даёт Astral писать сюда. Если игра в Program Files — дайте своей учётной записи права на папку игры (Свойства → Безопасность) или перенесите игру. Папка обычная — проверьте «Контролируемый доступ к папкам» Защитника Windows и антивирус (добавьте Astral в разрешённые) или запустите Astral от имени администратора. Потом нажмите «Повторить». В игру ничего не записано.":
    [
      "Windows не дає Astral писати сюди. Якщо гра в Program Files — дайте своєму обліковому запису права на папку гри (Властивості → Безпека) або перенесіть гру. Папка звичайна — перевірте «Контрольований доступ до папок» Захисника Windows та антивірус (додайте Astral до дозволених) або запустіть Astral від імені адміністратора. Потім натисніть «Повторити». У гру нічого не записано.",
      "Windows does not let Astral write here. If the game is in Program Files, give your account rights to the game folder (Properties → Security) or move the game. If the folder is an ordinary one, check Windows Defender “Controlled folder access” and your antivirus (allow Astral) or run Astral as administrator. Then press “Retry”. Nothing was written to the game.",
      "Windows lässt Astral hier nicht schreiben. Liegt das Spiel unter Program Files, gib deinem Konto Rechte am Spielordner (Eigenschaften → Sicherheit) oder verschiebe das Spiel. Ist der Ordner ein gewöhnlicher, prüfe den „Überwachten Ordnerzugriff“ von Windows Defender und dein Antivirenprogramm (erlaube Astral) oder starte Astral als Administrator. Dann drücke „Wiederholen“. Ins Spiel wurde nichts geschrieben.",
      "Windows nie pozwala Astral tu pisać. Jeśli gra jest w Program Files, daj swojemu kontu prawa do folderu gry (Właściwości → Zabezpieczenia) albo przenieś grę. Jeśli folder jest zwykły, sprawdź „Kontrolowany dostęp do folderów” Windows Defender i antywirus (zezwól Astral) albo uruchom Astral jako administrator. Potem naciśnij „Ponów”. Do gry nic nie zapisano.",
    ],
  "Файл игры занят": [
    "Файл гри зайнятий",
    "A game file is in use",
    "Eine Spieldatei ist belegt",
    "Plik gry jest zajęty",
  ],
  "Закройте GTA V, лаунчер сервера, OpenIV и CodeWalker. Не помогло — добавьте папку игры в исключения антивируса и повторите. В игру ничего не записано.":
    [
      "Закрийте GTA V, лаунчер сервера, OpenIV і CodeWalker. Не допомогло — додайте папку гри до винятків антивіруса і повторіть. У гру нічого не записано.",
      "Close GTA V, the server launcher, OpenIV and CodeWalker. If that does not help, add the game folder to your antivirus exclusions and retry. Nothing was written to the game.",
      "Schließe GTA V, den Server-Launcher, OpenIV und CodeWalker. Hilft das nicht, füge den Spielordner den Ausnahmen des Virenscanners hinzu und wiederhole. Ins Spiel wurde nichts geschrieben.",
      "Zamknij GTA V, launcher serwera, OpenIV i CodeWalker. Jeśli nie pomoże — dodaj folder gry do wyjątków antywirusa i ponów. Do gry nic nie zapisano.",
    ],
  "Не найдена папка GTA V": [
    "Не знайдено папку GTA V",
    "GTA V folder not found",
    "GTA-V-Ordner nicht gefunden",
    "Nie znaleziono folderu GTA V",
  ],
  "Откройте Настройки → GTA V → «Добавить папку вручную» → «Выбрать папку» и укажите папку, где лежит GTA5.exe. Затем нажмите «Повторить».":
    [
      "Відкрийте Налаштування → GTA V → «Додати теку вручну» → «Вибрати теку» і вкажіть теку, де лежить GTA5.exe. Потім натисніть «Повторити».",
      "Open Settings → GTA V → “Add a folder manually” → “Choose folder” and pick the folder with GTA5.exe. Then press “Retry”.",
      "Öffne Einstellungen → GTA V → „Ordner manuell hinzufügen“ → „Ordner wählen“ und wähle den Ordner mit GTA5.exe. Drücke dann „Wiederholen“.",
      "Otwórz Ustawienia → GTA V → „Dodaj folder ręcznie” → „Wybierz folder” i wskaż folder z GTA5.exe. Potem naciśnij „Ponów”.",
    ],
  "Мод для другой версии GTA V": [
    "Мод для іншої версії GTA V",
    "The mod is for another GTA V version",
    "Die Mod ist für eine andere GTA-V-Version",
    "Mod do innej wersji GTA V",
  ],
  "Он сделан для другой редакции игры (Legacy или Enhanced), поставить его сюда нельзя.":
    [
      "Його зроблено для іншої редакції гри (Legacy або Enhanced), встановити його сюди не можна.",
      "It was made for a different edition of the game (Legacy or Enhanced) and cannot be installed here.",
      "Sie wurde für eine andere Spielausgabe (Legacy oder Enhanced) gemacht und lässt sich hier nicht installieren.",
      "Został zrobiony dla innej edycji gry (Legacy lub Enhanced) i nie da się go tu zainstalować.",
    ],
  "Операция не удалась": [
    "Операція не вдалася",
    "The operation failed",
    "Der Vorgang ist fehlgeschlagen",
    "Operacja nie powiodła się",
  ],
  "Нажмите «Повторить». Если снова — скачайте журнал ({logs}) и приложите его к тикету в поддержку Astral.":
    [
      "Натисніть «Повторити». Якщо знову — завантажте журнал ({logs}) і додайте його до тікета в підтримку Astral.",
      "Press “Retry”. If it happens again, download the log ({logs}) and attach it to a ticket for Astral support.",
      "Drücke „Wiederholen“. Passiert es erneut, lade das Protokoll herunter ({logs}) und hänge es an ein Ticket für den Astral-Support.",
      "Naciśnij „Ponów”. Jeśli znowu — pobierz dziennik ({logs}) i dołącz go do zgłoszenia do wsparcia Astral.",
    ],
  "Steam — правой кнопкой по игре в библиотеке → Свойства → Установленные файлы → Проверить целостность файлов игры; Rockstar Games Launcher — Настройки → Мои установленные игры → Grand Theft Auto V → Проверить целостность; Epic Games — Библиотека → «…» у GTA V → Управление → Проверить.":
    [
      "Steam — правою кнопкою по грі в бібліотеці → Властивості → Встановлені файли → Перевірити цілісність файлів гри; Rockstar Games Launcher — Налаштування → Мої встановлені ігри → Grand Theft Auto V → Перевірити цілісність; Epic Games — Бібліотека → «…» біля GTA V → Керування → Перевірити.",
      "Steam — right-click the game in your library → Properties → Installed Files → Verify integrity of game files; Rockstar Games Launcher — Settings → My installed games → Grand Theft Auto V → Verify Integrity; Epic Games — Library → “…” next to GTA V → Manage → Verify.",
      "Steam — Rechtsklick auf das Spiel in der Bibliothek → Eigenschaften → Installierte Dateien → Spieldateien auf Fehler überprüfen; Rockstar Games Launcher — Einstellungen → Meine installierten Spiele → Grand Theft Auto V → Integrität überprüfen; Epic Games — Bibliothek → „…“ bei GTA V → Verwalten → Überprüfen.",
      "Steam — prawy przycisk na grze w bibliotece → Właściwości → Zainstalowane pliki → Zweryfikuj spójność plików gry; Rockstar Games Launcher — Ustawienia → Moje zainstalowane gry → Grand Theft Auto V → Zweryfikuj integralność; Epic Games — Biblioteka → „…” przy GTA V → Zarządzaj → Zweryfikuj.",
    ],
  "Настройки → Логи → «Скачать для тикета»": [
    "Налаштування → Логи → «Завантажити для тікета»",
    "Settings → Logs → “Download for a ticket”",
    "Einstellungen → Protokolle → „Für ein Ticket herunterladen“",
    "Ustawienia → Logi → „Pobierz do zgłoszenia”",
  ],
  Отменено: ["Скасовано", "Cancelled", "Abgebrochen", "Anulowano"],
};
