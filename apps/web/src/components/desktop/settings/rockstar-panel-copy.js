/*
 * Строки вкладки «Rockstar Games» (14.11.2026) — «Настройки › Игра ›
 * Rockstar Games»: шапка режима, способы, объяснение «как это работает»,
 * особые случаи, строка-ссылка в разделе «GTA V».
 *
 * Шесть языков (ru, uk, en, de, pl, fr; для остальных — английский), тем же
 * приёмом, что `rockstar-mode-copy.js`: таблица «ключ → [ru, uk, en, de, pl,
 * fr]». Состояния агента, фразы про «чужой архив», ручные кнопки, журнал и
 * отказы режима живут там же — здесь только то, что добавила вкладка.
 */

const ORDER = ["ru", "uk", "en", "de", "pl", "fr"];

const pick = (table, language) => {
  const index = ORDER.indexOf(language);
  return Object.fromEntries(
    Object.entries(table).map(([key, values]) => [
      key,
      values[index < 0 ? 2 : index],
    ]),
  );
};

/* Ключ → [ru, uk, en, de, pl, fr]. Тест `rockstar-panel-copy.test.js` проверяет шесть непустых колонок. */
export const PANEL_TEXT = {
  modeTitle: [
    "Режим Rockstar Games Launcher",
    "Режим Rockstar Games Launcher",
    "Rockstar Games Launcher mode",
    "Rockstar-Games-Launcher-Modus",
    "Tryb Rockstar Games Launcher",
    "Mode Rockstar Games Launcher",
  ],
  modeIntro: [
    "Пока игра закрыта, в её папке лежат чистые файлы Rockstar. Моды встают в момент запуска и уходят после выхода — лаунчер ничего не перекачивает.",
    "Поки гра закрита, у її теці лежать чисті файли Rockstar. Моди стають у мить запуску й зникають після виходу — лаунчер нічого не перекачує.",
    "While the game is closed, its folder holds clean Rockstar files. The mods go in the moment the game starts and leave after you quit — the launcher downloads nothing.",
    "Solange das Spiel geschlossen ist, liegen in seinem Ordner saubere Rockstar-Dateien. Die Mods kommen beim Start hinein und gehen nach dem Beenden wieder — der Launcher lädt nichts nach.",
    "Gdy gra jest zamknięta, w jej folderze leżą czyste pliki Rockstar. Mody wchodzą w chwili startu i znikają po wyjściu — launcher niczego nie pobiera ponownie.",
    "Tant que le jeu est fermé, son dossier contient les fichiers Rockstar d'origine. Les mods se mettent en place au lancement et repartent après la fermeture — le launcher ne retélécharge rien.",
  ],

  /* Строка состояния под шапкой. */
  stateOff: ["Выключен", "Вимкнено", "Off", "Aus", "Wyłączony", "Désactivé"],
  stateAgentOk: [
    "Включён. Astral следит за запуском игры",
    "Увімкнено. Astral стежить за запуском гри",
    "On. Astral watches for the game to start",
    "Ein. Astral beobachtet den Spielstart",
    "Włączony. Astral pilnuje startu gry",
    "Activé. Astral surveille le lancement du jeu",
  ],
  stateAgentDown: [
    "Включён. Фоновая задача не отвечает — пока следит окно Astral",
    "Увімкнено. Фонове завдання не відповідає — поки стежить вікно Astral",
    "On. The background task is not responding — the Astral window is watching for now",
    "Ein. Die Hintergrundaufgabe antwortet nicht — vorerst beobachtet das Astral-Fenster",
    "Włączony. Zadanie w tle nie odpowiada — na razie pilnuje okno Astral",
    "Activé. La tâche en arrière-plan ne répond pas — pour l'instant, c'est la fenêtre Astral qui surveille",
  ],
  stateNoWatcher: [
    "Включён, но за запуском игры пока никто не следит",
    "Увімкнено, але за запуском гри поки ніхто не стежить",
    "On, but nothing is watching for the game to start yet",
    "Ein, aber den Spielstart beobachtet noch niemand",
    "Włączony, ale startu gry na razie nikt nie pilnuje",
    "Activé, mais personne ne surveille encore le lancement du jeu",
  ],
  stateManualIdle: [
    "Включён. Перед игрой нажмите «Захожу в игру»",
    "Увімкнено. Перед грою натисніть «Заходжу в гру»",
    "On. Before you play, press “I’m starting the game”",
    "Ein. Drücken Sie vor dem Spiel „Ich starte das Spiel“",
    "Włączony. Przed grą naciśnij „Wchodzę do gry”",
    "Activé. Avant de jouer, cliquez sur «\u00a0Je lance le jeu\u00a0»",
  ],
  stateManualWaiting: [
    "Жду запуск игры — моды встанут сами",
    "Чекаю запуск гри — моди стануть самі",
    "Waiting for the game to start — the mods will go in by themselves",
    "Warte auf den Spielstart — die Mods kommen von selbst hinein",
    "Czekam na start gry — mody wejdą same",
    "En attente du lancement du jeu — les mods se mettront en place tout seuls",
  ],
  stateArmed: [
    "Идёт игра: моды в игре",
    "Триває гра: моди в грі",
    "Game in progress: the mods are in the game",
    "Spiel läuft: die Mods sind im Spiel",
    "Trwa gra: mody są w grze",
    "Partie en cours\u00a0: les mods sont dans le jeu",
  ],
  stateStale: [
    "Включён, но моды не в игре",
    "Увімкнено, але моди не в грі",
    "On, but the mods are not in the game",
    "Ein, aber die Mods sind nicht im Spiel",
    "Włączony, ale mody nie są w grze",
    "Activé, mais les mods ne sont pas dans le jeu",
  ],
  turningOn: [
    "Включаю… Windows может один раз спросить права администратора",
    "Вмикаю… Windows може один раз запитати права адміністратора",
    "Turning on… Windows may ask for administrator rights once",
    "Schalte ein … Windows fragt eventuell einmal nach Administratorrechten",
    "Włączam… Windows może raz zapytać o uprawnienia administratora",
    "Activation… Windows peut demander une fois les droits d'administrateur",
  ],
  turning: [
    "Применяю…",
    "Застосовую…",
    "Applying…",
    "Wende an …",
    "Stosuję…",
    "Application…",
  ],
  turningOff: [
    "Выключаю…",
    "Вимикаю…",
    "Turning off…",
    "Schalte aus …",
    "Wyłączam…",
    "Désactivation…",
  ],

  /* Способ. */
  methodAutoTitle: [
    "Автоматически",
    "Автоматично",
    "Automatic",
    "Automatisch",
    "Automatycznie",
    "Automatique",
  ],
  methodAutoShort: [
    "Astral сам ловит запуск игры",
    "Astral сам ловить запуск гри",
    "Astral catches the game launch by itself",
    "Astral erkennt den Spielstart selbst",
    "Astral sam wychwytuje start gry",
    "Astral détecte lui-même le lancement du jeu",
  ],
  methodManualTitle: [
    "Вручную",
    "Вручну",
    "Manual",
    "Manuell",
    "Ręcznie",
    "Manuel",
  ],
  methodManualShort: [
    "Две кнопки: до игры и после",
    "Дві кнопки: до гри і після",
    "Two buttons: before the game and after",
    "Zwei Knöpfe: vor dem Spiel und danach",
    "Dwa przyciski: przed grą i po niej",
    "Deux boutons\u00a0: avant le jeu et après",
  ],
  legacyMethod: [
    "Сейчас работает прежний способ «как ReplaceX». Он работает как раньше; выберите другой, чтобы сменить.",
    "Зараз працює попередній спосіб «як ReplaceX». Він працює як раніше; оберіть інший, щоб змінити.",
    "The earlier “ReplaceX-style” method is running now. It works as before; pick another one to switch.",
    "Zurzeit läuft die frühere Methode „wie ReplaceX“. Sie arbeitet wie bisher; wählen Sie eine andere, um zu wechseln.",
    "Teraz działa dawna metoda „jak ReplaceX”. Działa jak dotąd; wybierz inną, aby ją zmienić.",
    "L'ancienne méthode «\u00a0comme ReplaceX\u00a0» est en cours. Elle fonctionne comme avant\u00a0; choisissez-en une autre pour changer.",
  ],
  manualHint: [
    "Нажмите перед запуском GTA V и не закрывайте Astral, пока играете: после выхода он сам вернёт чистые файлы.",
    "Натисніть перед запуском GTA V і не закривайте Astral, поки граєте: після виходу він сам поверне чисті файли.",
    "Press it before launching GTA V and keep Astral open while you play: after you quit, it puts the clean files back by itself.",
    "Drücken Sie vor dem Start von GTA V und lassen Sie Astral geöffnet, solange Sie spielen: Nach dem Beenden setzt es die sauberen Dateien selbst zurück.",
    "Naciśnij przed uruchomieniem GTA V i nie zamykaj Astral, dopóki grasz: po wyjściu sam przywróci czyste pliki.",
    "Cliquez avant de lancer GTA V et gardez Astral ouvert pendant que vous jouez\u00a0: après la fermeture du jeu, il remet lui-même les fichiers d'origine.",
  ],
  cancelWait: [
    "Отменить ожидание",
    "Скасувати очікування",
    "Cancel waiting",
    "Warten abbrechen",
    "Anuluj oczekiwanie",
    "Annuler l'attente",
  ],

  /* «Как это работает». */
  howTitle: [
    "Как это работает",
    "Як це працює",
    "How it works",
    "So funktioniert es",
    "Jak to działa",
    "Comment ça marche",
  ],
  howCheck: [
    "Rockstar Games Launcher при каждом запуске сверяет файлы игры. Найдёт изменённый — скачает свой заново, и моды пропадут. Отключить эту проверку нельзя.",
    "Rockstar Games Launcher під час кожного запуску звіряє файли гри. Знайде змінений — завантажить свій заново, і моди зникнуть. Вимкнути цю перевірку не можна.",
    "Every time the game starts, Rockstar Games Launcher checks the game files. If it finds a changed one, it downloads its own again and the mods are gone. This check cannot be turned off.",
    "Der Rockstar Games Launcher gleicht bei jedem Start die Spieldateien ab. Findet er eine geänderte, lädt er seine eigene neu herunter, und die Mods sind weg. Diese Prüfung lässt sich nicht abschalten.",
    "Rockstar Games Launcher przy każdym uruchomieniu porównuje pliki gry. Gdy znajdzie zmieniony, pobierze własny od nowa, a mody znikną. Tego sprawdzania nie da się wyłączyć.",
    "À chaque lancement, le Rockstar Games Launcher vérifie les fichiers du jeu. S'il en trouve un modifié, il retélécharge le sien et les mods disparaissent. Cette vérification ne peut pas être désactivée.",
  ],
  howSwap: [
    "В этом режиме ему нечего находить. Пока игра закрыта, в папке лежат оригиналы Rockstar, а архивы с модами ждут рядом, вне папки игры. Когда проверка пройдена и игра стартовала, Astral за доли секунды ставит архивы с модами на место, а после выхода возвращает оригиналы.",
    "У цьому режимі йому нічого знаходити. Поки гра закрита, у теці лежать оригінали Rockstar, а архіви з модами чекають поруч, поза текою гри. Коли перевірку пройдено й гра стартувала, Astral за частки секунди ставить архіви з модами на місце, а після виходу повертає оригінали.",
    "In this mode there is nothing for it to find. While the game is closed, the folder holds Rockstar's originals and the archives with the mods wait next to it, outside the game folder. Once the check is passed and the game has started, Astral puts the mod archives in place within a fraction of a second, and puts the originals back after you quit.",
    "In diesem Modus findet er nichts. Solange das Spiel geschlossen ist, liegen im Ordner die Originale von Rockstar, die Archive mit den Mods warten daneben, außerhalb des Spielordners. Ist die Prüfung bestanden und das Spiel gestartet, setzt Astral die Mod-Archive in Sekundenbruchteilen an ihren Platz und legt nach dem Beenden die Originale zurück.",
    "W tym trybie nie ma czego znaleźć. Gdy gra jest zamknięta, w folderze leżą oryginały Rockstar, a archiwa z modami czekają obok, poza folderem gry. Gdy sprawdzanie przejdzie i gra wystartuje, Astral w ułamku sekundy wstawia archiwa z modami na miejsce, a po wyjściu przywraca oryginały.",
    "Dans ce mode, il n'a rien à trouver. Tant que le jeu est fermé, le dossier contient les originaux de Rockstar, et les archives avec les mods attendent à côté, hors du dossier du jeu. Une fois la vérification passée et le jeu lancé, Astral remet en place les archives avec les mods en une fraction de seconde, puis rend les originaux après la fermeture.",
  ],
  howAutoLead: [
    "Автоматически.",
    "Автоматично.",
    "Automatic.",
    "Automatisch.",
    "Automatycznie.",
    "Automatique.",
  ],
  howAuto: [
    "Astral сам замечает запуск и выход, нажимать ничего не нужно. Для этого в Планировщике Windows появляется фоновая задача Astral: она работает и при закрытом приложении, а при выключении режима убирается. При включении Windows один раз спросит права администратора.",
    "Astral сам помічає запуск і вихід, натискати нічого не потрібно. Для цього в Планувальнику Windows з'являється фонове завдання Astral: воно працює й за закритого застосунку, а під час вимкнення режиму прибирається. Під час увімкнення Windows один раз запитає права адміністратора.",
    "Astral notices the launch and the exit by itself, there is nothing to press. For this, a background Astral task appears in Windows Task Scheduler: it works even when the app is closed and is removed when you turn the mode off. When you turn it on, Windows asks for administrator rights once.",
    "Astral erkennt Start und Ende selbst, Sie müssen nichts drücken. Dafür erscheint in der Windows-Aufgabenplanung eine Hintergrundaufgabe von Astral: Sie läuft auch bei geschlossener App und wird beim Ausschalten des Modus entfernt. Beim Einschalten fragt Windows einmal nach Administratorrechten.",
    "Astral sam zauważa start i wyjście, nic nie trzeba naciskać. W tym celu w Harmonogramie zadań Windows pojawia się zadanie Astral w tle: działa także przy zamkniętej aplikacji, a po wyłączeniu trybu jest usuwane. Przy włączaniu Windows raz zapyta o uprawnienia administratora.",
    "Astral remarque lui-même le lancement et la sortie, rien à appuyer. Pour cela, une tâche Astral en arrière-plan apparaît dans le Planificateur de tâches Windows\u00a0: elle fonctionne même quand l'application est fermée et disparaît quand vous désactivez le mode. À l'activation, Windows demande une fois les droits d'administrateur.",
  ],
  howManualLead: [
    "Вручную.",
    "Вручну.",
    "Manual.",
    "Manuell.",
    "Ręcznie.",
    "Manuel.",
  ],
  howManual: [
    "Ничего фонового в системе нет. Перед запуском нажимаете «Захожу в игру» и оставляете Astral открытым на время игры: после выхода он сам вернёт чистые файлы, а «Вышел из игры» возвращает их сразу. Если закрыть Astral во время игры и потом открыть лаунчер Rockstar раньше Astral, лаунчер найдёт моды и скачает свои файлы заново.",
    "У системі нічого фонового немає. Перед запуском натискаєте «Заходжу в гру» і залишаєте Astral відкритим на час гри: після виходу він сам поверне чисті файли, а «Вийшов з гри» повертає їх одразу. Якщо закрити Astral під час гри й потім відкрити лаунчер Rockstar раніше за Astral, лаунчер знайде моди й завантажить свої файли заново.",
    "Nothing runs in the background. Before launching, you press “I’m starting the game” and keep Astral open while you play: after you quit, it puts the clean files back by itself, and “I’ve quit the game” puts them back at once. If you close Astral during the game and then open the Rockstar launcher before Astral, the launcher will find the mods and download its files again.",
    "Im System läuft nichts im Hintergrund. Vor dem Start drücken Sie „Ich starte das Spiel“ und lassen Astral während des Spiels geöffnet: Nach dem Beenden setzt es die sauberen Dateien selbst zurück, und „Ich habe das Spiel beendet“ setzt sie sofort zurück. Schließen Sie Astral während des Spiels und öffnen danach den Rockstar-Launcher vor Astral, findet der Launcher die Mods und lädt seine Dateien neu herunter.",
    "W systemie nic nie działa w tle. Przed uruchomieniem naciskasz „Wchodzę do gry” i zostawiasz Astral otwarty na czas gry: po wyjściu sam przywróci czyste pliki, a „Wyszedłem z gry” przywraca je od razu. Jeśli zamkniesz Astral w trakcie gry, a potem otworzysz launcher Rockstar przed Astral, launcher znajdzie mody i pobierze swoje pliki od nowa.",
    "Rien ne tourne en arrière-plan. Avant le lancement, vous cliquez sur «\u00a0Je lance le jeu\u00a0» et laissez Astral ouvert pendant la partie\u00a0: après la fermeture du jeu, il remet lui-même les fichiers d'origine, et «\u00a0J'ai quitté le jeu\u00a0» les remet immédiatement. Si vous fermez Astral pendant la partie, puis ouvrez le launcher Rockstar avant Astral, le launcher trouvera les mods et retéléchargera ses fichiers.",
  ],
  howSame: [
    "Сама подмена в обоих способах одинаковая. Разница в том, кто даёт команду.",
    "Сама підміна в обох способах однакова. Різниця в тому, хто дає команду.",
    "The swap itself is the same in both methods. The only difference is who gives the command.",
    "Der Austausch selbst ist bei beiden Methoden gleich. Der Unterschied ist nur, wer den Befehl gibt.",
    "Sama podmiana w obu metodach jest taka sama. Różnica polega na tym, kto daje komendę.",
    "L'échange lui-même est identique dans les deux méthodes. La différence tient à qui donne l'ordre.",
  ],
  howInstall: [
    "Ставить и снимать моды можно при включённом режиме: на время записи Astral сам ставит архивы на место и потом убирает обратно.",
    "Ставити й знімати моди можна за ввімкненого режиму: на час запису Astral сам ставить архіви на місце, а потім прибирає назад.",
    "You can install and remove mods while the mode is on: for the duration of the write, Astral puts the archives in place by itself and takes them back afterwards.",
    "Mods lassen sich auch bei eingeschaltetem Modus installieren und entfernen: für die Dauer des Schreibens setzt Astral die Archive selbst an ihren Platz und räumt sie danach wieder weg.",
    "Mody można instalować i usuwać przy włączonym trybie: na czas zapisu Astral sam wstawia archiwa na miejsce, a potem odkłada je z powrotem.",
    "Vous pouvez installer et retirer des mods quand le mode est activé\u00a0: le temps de l'écriture, Astral remet lui-même les archives en place, puis les retire.",
  ],
  howSpace: [
    "Место: копия изменённых архивов, около 2 ГБ на диске игры.",
    "Місце: копія змінених архівів, близько 2 ГБ на диску гри.",
    "Space: a copy of the changed archives, about 2 GB on the game drive.",
    "Speicherplatz: eine Kopie der geänderten Archive, etwa 2 GB auf dem Spiellaufwerk.",
    "Miejsce: kopia zmienionych archiwów, około 2 GB na dysku gry.",
    "Espace\u00a0: une copie des archives modifiées, environ 2 Go sur le disque du jeu.",
  ],
  /* `{path}` — сокращённый путь образа, пока режим включён. */
  howImage: [
    "Образ: {path}",
    "Образ: {path}",
    "Image: {path}",
    "Abbild: {path}",
    "Obraz: {path}",
    "Image\u00a0: {path}",
  ],

  /* Особые случаи. */
  noGame: [
    "Сначала укажите папку GTA V",
    "Спочатку вкажіть теку GTA V",
    "First point Astral to the GTA V folder",
    "Geben Sie zuerst den GTA-V-Ordner an",
    "Najpierw wskaż folder GTA V",
    "Indiquez d'abord le dossier de GTA V",
  ],
  openGame: [
    "Открыть раздел «GTA V»",
    "Відкрити розділ «GTA V»",
    "Open the “GTA V” section",
    "Bereich „GTA V“ öffnen",
    "Otwórz sekcję „GTA V”",
    "Ouvrir la section «\u00a0GTA V\u00a0»",
  ],
  linkedCopy: [
    "Выбрана вторая папка игры: лаунчер Rockstar её не проверяет. Режим — другой способ вместо второй папки: у основной копии он включается, когда второй папки нет.",
    "Вибрано другу теку гри: лаунчер Rockstar її не перевіряє. Режим — інший спосіб замість другої теки: в основної копії він вмикається, коли другої теки немає.",
    "A second game folder is selected: the Rockstar launcher does not check it. The mode is another way instead of a second folder: for the main copy it can be turned on once there is no second folder.",
    "Ein zweiter Spielordner ist ausgewählt: Der Rockstar-Launcher prüft ihn nicht. Der Modus ist ein anderer Weg anstelle eines zweiten Ordners: Bei der Hauptkopie lässt er sich einschalten, sobald es keinen zweiten Ordner gibt.",
    "Wybrano drugi folder gry: launcher Rockstar go nie sprawdza. Tryb to inny sposób zamiast drugiego folderu: przy kopii głównej można go włączyć, gdy drugiego folderu nie ma.",
    "Un second dossier du jeu est sélectionné\u00a0: le launcher Rockstar ne le vérifie pas. Le mode est une autre méthode à la place d'un second dossier\u00a0: sur la copie principale, il s'active quand il n'y a pas de second dossier.",
  ],
  hasCopy: [
    "У игры собрана вторая папка Astral, и моды сейчас ставятся в неё. Режим и вторая папка вместе не работают. Чтобы перейти на режим, удалите вторую папку в блоке «Другой способ» ниже. Моды, которые стоят во второй папке, уйдут вместе с ней — после этого проверьте «Библиотеку» и при необходимости поставьте их заново.",
    "У гри зібрано другу теку Astral, і моди зараз ставляться в неї. Режим і друга тека разом не працюють. Щоб перейти на режим, видаліть другу теку в блоці «Інший спосіб» нижче. Моди, які стоять у другій теці, підуть разом із нею — після цього перевірте «Бібліотеку» й за потреби поставте їх знову.",
    "This game has an Astral second folder, and mods are currently installed into it. The mode and the second folder do not work together. To switch to the mode, delete the second folder in the “Another way” block below. Mods that sit in the second folder go away with it — afterwards check the Library and reinstall them if needed.",
    "Für dieses Spiel gibt es einen zweiten Astral-Ordner, und Mods werden derzeit dort installiert. Der Modus und der zweite Ordner funktionieren nicht zusammen. Um zum Modus zu wechseln, löschen Sie den zweiten Ordner im Block „Anderer Weg“ unten. Mods, die im zweiten Ordner liegen, verschwinden mit ihm — prüfen Sie danach die Bibliothek und installieren Sie sie bei Bedarf neu.",
    "Dla tej gry zbudowano drugi folder Astral i mody są teraz instalowane w nim. Tryb i drugi folder razem nie działają. Aby przejść na tryb, usuń drugi folder w bloku „Inny sposób” poniżej. Mody, które są w drugim folderze, znikną razem z nim — potem sprawdź Bibliotekę i w razie potrzeby zainstaluj je ponownie.",
    "Un second dossier Astral existe pour ce jeu, et les mods y sont installés pour l'instant. Le mode et le second dossier ne fonctionnent pas ensemble. Pour passer au mode, supprimez le second dossier dans le bloc «\u00a0Autre méthode\u00a0» ci-dessous. Les mods qui se trouvent dans le second dossier disparaissent avec lui — vérifiez ensuite la Bibliothèque et réinstallez-les si besoin.",
  ],
  bothOn: [
    "Режим включён, но у игры есть вторая папка Astral — моды ставятся в неё, и режим сейчас ничего не делает. Удалите вторую папку (блок «Другой способ» ниже) или выключите режим.",
    "Режим увімкнено, але в гри є друга тека Astral — моди ставляться в неї, і режим зараз нічого не робить. Видаліть другу теку (блок «Інший спосіб» нижче) або вимкніть режим.",
    "The mode is on, but this game has an Astral second folder — mods go into it, so the mode does nothing right now. Delete the second folder (the “Another way” block below) or turn the mode off.",
    "Der Modus ist eingeschaltet, aber für dieses Spiel gibt es einen zweiten Astral-Ordner — Mods landen darin, der Modus bewirkt derzeit nichts. Löschen Sie den zweiten Ordner (Block „Anderer Weg“ unten) oder schalten Sie den Modus aus.",
    "Tryb jest włączony, ale dla tej gry istnieje drugi folder Astral — mody trafiają do niego, więc tryb na razie nic nie robi. Usuń drugi folder (blok „Inny sposób” poniżej) albo wyłącz tryb.",
    "Le mode est activé, mais un second dossier Astral existe pour ce jeu — les mods y vont, et le mode ne fait donc rien pour l'instant. Supprimez le second dossier (bloc «\u00a0Autre méthode\u00a0» ci-dessous) ou désactivez le mode.",
  ],
  toMain: [
    "Перейти к основной копии",
    "Перейти до основної копії",
    "Go to the main copy",
    "Zur Hauptkopie wechseln",
    "Przejdź do kopii głównej",
    "Aller à la copie principale",
  ],
  enhanced: [
    "У GTA V Enhanced режим пока не работает.",
    "У GTA V Enhanced режим поки не працює.",
    "The mode does not work with GTA V Enhanced yet.",
    "Bei GTA V Enhanced funktioniert der Modus noch nicht.",
    "W GTA V Enhanced tryb na razie nie działa.",
    "Le mode ne fonctionne pas encore avec GTA V Enhanced.",
  ],
  unsupported: [
    "Для этой копии режим пока не включается.",
    "Для цієї копії режим поки не вмикається.",
    "The mode cannot be turned on for this copy yet.",
    "Für diese Kopie lässt sich der Modus noch nicht einschalten.",
    "Dla tej kopii tryb na razie nie włącza się.",
    "Le mode ne peut pas encore être activé pour cette copie.",
  ],
  calmSteam: [
    "Эта копия GTA V — из Steam: он сам файлы игры не возвращает, моды в ней не сбрасываются, и режим обычно не нужен. Включите, если хотите, чтобы файлы игры оставались чистыми, пока она закрыта.",
    "Ця копія GTA V — зі Steam: він сам файли гри не повертає, моди в ній не скидаються, і режим зазвичай не потрібен. Увімкніть, якщо хочете, щоб файли гри лишалися чистими, поки вона закрита.",
    "This copy of GTA V is from Steam: it does not put the game files back by itself, so mods in it are not wiped and the mode is usually not needed. Turn it on if you want the game files to stay clean while the game is closed.",
    "Diese Kopie von GTA V stammt von Steam: Es setzt Spieldateien nicht von selbst zurück, Mods bleiben dort erhalten, und der Modus wird meist nicht gebraucht. Schalten Sie ihn ein, wenn die Spieldateien sauber bleiben sollen, solange das Spiel geschlossen ist.",
    "Ta kopia GTA V pochodzi ze Steam: sam nie przywraca plików gry, mody w niej nie są kasowane, więc tryb zwykle nie jest potrzebny. Włącz go, jeśli chcesz, by pliki gry pozostawały czyste, dopóki gra jest zamknięta.",
    "Cette copie de GTA V vient de Steam\u00a0: il ne remet pas lui-même les fichiers du jeu, les mods n'y sont donc pas effacés, et le mode est en général inutile. Activez-le si vous voulez que les fichiers du jeu restent intacts tant qu'il est fermé.",
  ],
  calmEpic: [
    "Эта копия GTA V — из Epic Games: он сам файлы игры не возвращает, моды в ней не сбрасываются, и режим обычно не нужен. Включите, если хотите, чтобы файлы игры оставались чистыми, пока она закрыта.",
    "Ця копія GTA V — з Epic Games: він сам файли гри не повертає, моди в ній не скидаються, і режим зазвичай не потрібен. Увімкніть, якщо хочете, щоб файли гри лишалися чистими, поки вона закрита.",
    "This copy of GTA V is from Epic Games: it does not put the game files back by itself, so mods in it are not wiped and the mode is usually not needed. Turn it on if you want the game files to stay clean while the game is closed.",
    "Diese Kopie von GTA V stammt von Epic Games: Es setzt Spieldateien nicht von selbst zurück, Mods bleiben dort erhalten, und der Modus wird meist nicht gebraucht. Schalten Sie ihn ein, wenn die Spieldateien sauber bleiben sollen, solange das Spiel geschlossen ist.",
    "Ta kopia GTA V pochodzi z Epic Games: sam nie przywraca plików gry, mody w niej nie są kasowane, więc tryb zwykle nie jest potrzebny. Włącz go, jeśli chcesz, by pliki gry pozostawały czyste, dopóki gra jest zamknięta.",
    "Cette copie de GTA V vient d'Epic Games\u00a0: il ne remet pas lui-même les fichiers du jeu, les mods n'y sont donc pas effacés, et le mode est en général inutile. Activez-le si vous voulez que les fichiers du jeu restent intacts tant qu'il est fermé.",
  ],
  calmOther: [
    "Эта копия GTA V — не из Rockstar Games Launcher: файлы игры никто сам не возвращает, моды в ней не сбрасываются, и режим обычно не нужен. Включите, если хотите, чтобы файлы игры оставались чистыми, пока она закрыта.",
    "Ця копія GTA V — не з Rockstar Games Launcher: файли гри ніхто сам не повертає, моди в ній не скидаються, і режим зазвичай не потрібен. Увімкніть, якщо хочете, щоб файли гри лишалися чистими, поки вона закрита.",
    "This copy of GTA V is not from Rockstar Games Launcher: nothing puts the game files back by itself, so mods in it are not wiped and the mode is usually not needed. Turn it on if you want the game files to stay clean while the game is closed.",
    "Diese Kopie von GTA V stammt nicht aus dem Rockstar Games Launcher: Niemand setzt die Spieldateien von selbst zurück, Mods bleiben dort erhalten, und der Modus wird meist nicht gebraucht. Schalten Sie ihn ein, wenn die Spieldateien sauber bleiben sollen, solange das Spiel geschlossen ist.",
    "Ta kopia GTA V nie pochodzi z Rockstar Games Launcher: nikt sam nie przywraca plików gry, mody w niej nie są kasowane, więc tryb zwykle nie jest potrzebny. Włącz go, jeśli chcesz, by pliki gry pozostawały czyste, dopóki gra jest zamknięta.",
    "Cette copie de GTA V ne vient pas du Rockstar Games Launcher\u00a0: rien ne remet de lui-même les fichiers du jeu, les mods n'y sont donc pas effacés, et le mode est en général inutile. Activez-le si vous voulez que les fichiers du jeu restent intacts tant qu'il est fermé.",
  ],
};

/** Строки вкладки на языке (`ru`, `uk`, `en`, `de`, `pl`, `fr`; иначе английский). */
export function rockstarPanelCopyFor(language) {
  return pick(PANEL_TEXT, language);
}
