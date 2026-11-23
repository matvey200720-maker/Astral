/*
 * Строки режима Rockstar (05.11.2026) — вкладка «Настройки › Rockstar Games»:
 * «чужой архив» и пересборка, ручные кнопки, журнал режима и отказы на шести
 * языках (ru, uk, en, de, pl, fr; для остальных — английский). Шапка, способы
 * и «Как это работает» — в `rockstar-panel-copy.js`.
 *
 * Журнал пишут агент и окно кодами событий (`scope:code` + данные,
 * `@modovik/install-engine/rockstar-mode/log.js`), а фразы подбирает окно:
 * `LOG` — таблица «код → [ru, uk, en, de, pl, fr]», `{имя}` подставляется из
 * данных записи, `{rel}` — имя архива без пути.
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

/* Журнал: `scope:code` → [ru, uk, en, de, pl, fr]. */
const LOG = {
  "arm:armed": [
    "Моды подставлены: {rel} ({ms} мс)",
    "Моди підставлено: {rel} ({ms} мс)",
    "Mods put in place: {rel} ({ms} ms)",
    "Mods eingesetzt: {rel} ({ms} ms)",
    "Mody podstawione: {rel} ({ms} ms)",
    "Mods mis en place\u00a0: {rel} ({ms} ms)",
  ],
  "arm:done": [
    "Игра запущена — моды стоят ({files} арх., {ms} мс)",
    "Гру запущено — моди стоять ({files} арх., {ms} мс)",
    "Game started — mods are in ({files} archives, {ms} ms)",
    "Spiel gestartet — Mods sind drin ({files} Archive, {ms} ms)",
    "Gra uruchomiona — mody są na miejscu ({files} arch., {ms} ms)",
    "Jeu lancé — les mods sont en place ({files} archives, {ms} ms)",
  ],
  "arm:busy": [
    "{rel} занят — игра уже открыла архив, повторю через 10 с",
    "{rel} зайнятий — гра вже відкрила архів, повторю через 10 с",
    "{rel} is busy — the game already opened it, retrying in 10 s",
    "{rel} ist belegt — das Spiel hat das Archiv schon geöffnet, neuer Versuch in 10 s",
    "{rel} jest zajęty — gra już otworzyła archiwum, ponowię za 10 s",
    "{rel} est occupé — le jeu a déjà ouvert l'archive, nouvel essai dans 10 s",
  ],
  "arm:error": [
    "Не удалось подставить {rel}",
    "Не вдалося підставити {rel}",
    "Could not put {rel} in place",
    "{rel} konnte nicht eingesetzt werden",
    "Nie udało się podstawić {rel}",
    "Impossible de mettre {rel} en place",
  ],
  "arm:game-updated": [
    "{rel}: игра обновилась, пока моды ждали, — они собраны на старую версию, не ставлю",
    "{rel}: гра оновилась, поки моди чекали, — вони зібрані на стару версію, не ставлю",
    "{rel}: the game was updated while the mods waited — they are built for the old version, not putting them in",
    "{rel}: das Spiel wurde aktualisiert, während die Mods warteten — sie sind für die alte Version gebaut, nicht eingesetzt",
    "{rel}: gra została zaktualizowana, gdy mody czekały — są zbudowane pod starą wersję, nie podstawiam",
    "{rel}\u00a0: le jeu a été mis à jour pendant l'attente des mods — ils sont conçus pour l'ancienne version, je ne les mets pas",
  ],
  "arm:mods-torn": [
    "{rel}: архив с модами повреждён или записан не до конца (ждали {expected} байт, на диске {actual}) — в игру не ставлю",
    "{rel}: архів із модами пошкоджено або записано не до кінця (чекали {expected} байт, на диску {actual}) — у гру не ставлю",
    "{rel}: the archive with mods is damaged or incomplete (expected {expected} bytes, {actual} on disk) — not putting it in",
    "{rel}: das Archiv mit Mods ist beschädigt oder unvollständig (erwartet {expected} Bytes, auf der Platte {actual}) — nicht eingesetzt",
    "{rel}: archiwum z modami jest uszkodzone lub niepełne (oczekiwano {expected} bajtów, na dysku {actual}) — nie podstawiam",
    "{rel}\u00a0: l'archive avec les mods est endommagée ou incomplète ({expected} octets attendus, {actual} sur le disque) — je ne la mets pas",
  ],
  "arm:repair-in-progress": [
    "Лаунчер Rockstar докачивает файлы ({files}) — подстановка ждёт",
    "Лаунчер Rockstar докачує файли ({files}) — підстановка чекає",
    "Rockstar Launcher is still downloading files ({files}) — waiting",
    "Der Rockstar Launcher lädt noch Dateien nach ({files}) — Warten",
    "Launcher Rockstar jeszcze dociąga pliki ({files}) — czekam",
    "Le launcher Rockstar télécharge encore des fichiers ({files}) — la mise en place attend",
  ],
  "arm:writer-busy": [
    "Окно Astral пишет в игру (PID {pid}) — подстановка подождёт",
    "Вікно Astral пише в гру (PID {pid}) — підстановка почекає",
    "The Astral window is writing to the game (PID {pid}) — waiting",
    "Das Astral-Fenster schreibt ins Spiel (PID {pid}) — Warten",
    "Okno Astral zapisuje do gry (PID {pid}) — poczekam",
    "La fenêtre Astral écrit dans le jeu (PID {pid}) — la mise en place attendra",
  ],
  "arm:launcher-alive": [
    "Rockstar Games Launcher запущен ({processes}): он может перекачать файл прямо во время игры",
    "Rockstar Games Launcher запущено ({processes}): він може перекачати файл просто під час гри",
    "Rockstar Games Launcher is running ({processes}): it may re-download a file during the game",
    "Rockstar Games Launcher läuft ({processes}): er kann eine Datei mitten im Spiel neu laden",
    "Rockstar Games Launcher działa ({processes}): może pobrać plik ponownie w trakcie gry",
    "Rockstar Games Launcher est lancé ({processes})\u00a0: il peut retélécharger un fichier en pleine partie",
  ],
  "disarm:returned": [
    "Чистый файл возвращён: {rel} ({ms} мс)",
    "Чистий файл повернуто: {rel} ({ms} мс)",
    "Clean file restored: {rel} ({ms} ms)",
    "Sauberer Stand zurück: {rel} ({ms} ms)",
    "Czysty plik przywrócony: {rel} ({ms} ms)",
    "Fichier d'origine restauré\u00a0: {rel} ({ms} ms)",
  ],
  "disarm:done": [
    "Игра закрыта — файлы Rockstar на месте ({files} арх.)",
    "Гру закрито — файли Rockstar на місці ({files} арх.)",
    "Game closed — Rockstar files are back ({files} archives)",
    "Spiel beendet — Rockstar-Dateien sind zurück ({files} Archive)",
    "Gra zamknięta — pliki Rockstar na miejscu ({files} arch.)",
    "Jeu fermé — les fichiers Rockstar sont revenus ({files} archives)",
  ],
  "disarm:busy": [
    "{rel} занят — верну позже",
    "{rel} зайнятий — поверну пізніше",
    "{rel} is busy — will restore later",
    "{rel} ist belegt — später wieder zurück",
    "{rel} jest zajęty — przywrócę później",
    "{rel} est occupé — restauration plus tard",
  ],
  "disarm:error": [
    "Не удалось вернуть {rel}",
    "Не вдалося повернути {rel}",
    "Could not restore {rel}",
    "{rel} konnte nicht zurückgesetzt werden",
    "Nie udało się przywrócić {rel}",
    "Impossible de restaurer {rel}",
  ],
  "disarm:repair-in-progress": [
    "Лаунчер Rockstar докачивает файлы ({files}) — возврат ждёт",
    "Лаунчер Rockstar докачує файли ({files}) — повернення чекає",
    "Rockstar Launcher is still downloading files ({files}) — restore waits",
    "Der Rockstar Launcher lädt noch Dateien nach ({files}) — Rücksetzen wartet",
    "Launcher Rockstar jeszcze dociąga pliki ({files}) — przywracanie czeka",
    "Le launcher Rockstar télécharge encore des fichiers ({files}) — la restauration attend",
  ],
  "disarm:repair-detected": [
    "{rel}: Rockstar переписал файл во время игры — это уже не наши моды, файл не трогаю",
    "{rel}: Rockstar переписав файл під час гри — це вже не наші моди, файл не чіпаю",
    "{rel}: Rockstar rewrote the file during the game — no longer our mods, leaving it alone",
    "{rel}: Rockstar hat die Datei im Spiel überschrieben — nicht mehr unsere Mods, bleibt unberührt",
    "{rel}: Rockstar nadpisał plik w trakcie gry — to już nie nasze mody, nie ruszam pliku",
    "{rel}\u00a0: Rockstar a réécrit le fichier pendant la partie — ce ne sont plus nos mods, je n'y touche pas",
  ],
  "watch:repair-detected": [
    "{rel}: Rockstar перекачал файл во время игры ({who}) — моды слетели, нужна пересборка",
    "{rel}: Rockstar перекачав файл під час гри ({who}) — моди злетіли, потрібне перезбирання",
    "{rel}: Rockstar re-downloaded the file during the game ({who}) — the mods are gone, rebuild needed",
    "{rel}: Rockstar hat die Datei im Spiel neu geladen ({who}) — die Mods sind weg, Neuaufbau nötig",
    "{rel}: Rockstar pobrał plik ponownie w trakcie gry ({who}) — mody znikły, potrzebna przebudowa",
    "{rel}\u00a0: Rockstar a retéléchargé le fichier pendant la partie ({who}) — les mods ont disparu, reconstruction nécessaire",
  ],
  "watch:game-seen": [
    "Появился процесс игры: {name} (PID {pid})",
    "З'явився процес гри: {name} (PID {pid})",
    "Game process appeared: {name} (PID {pid})",
    "Spielprozess erschienen: {name} (PID {pid})",
    "Pojawił się proces gry: {name} (PID {pid})",
    "Processus du jeu apparu\u00a0: {name} (PID {pid})",
  ],
  "watch:game-gone": [
    "Процесс игры закрылся: {name} (PID {pid})",
    "Процес гри закрився: {name} (PID {pid})",
    "Game process closed: {name} (PID {pid})",
    "Spielprozess beendet: {name} (PID {pid})",
    "Proces gry zakończony: {name} (PID {pid})",
    "Processus du jeu terminé\u00a0: {name} (PID {pid})",
  ],
  "watch:return-cancelled": [
    "Игра снова видна — возврат файлов отменён, сессия продолжается",
    "Гру знову видно — повернення файлів скасовано, сесія триває",
    "The game is back — restore cancelled, the session goes on",
    "Das Spiel ist wieder da — Rücksetzen abgebrochen, die Sitzung läuft weiter",
    "Gra znów jest widoczna — przywracanie anulowane, sesja trwa",
    "Le jeu est de nouveau là — restauration annulée, la session continue",
  ],
  "watch:blockers-killed": [
    "Закрыто процессов Rockstar перед возвратом: {count}",
    "Закрито процесів Rockstar перед поверненням: {count}",
    "Rockstar processes closed before restoring: {count}",
    "Rockstar-Prozesse vor dem Rücksetzen beendet: {count}",
    "Zamknięto procesów Rockstar przed przywróceniem: {count}",
    "Processus Rockstar fermés avant la restauration\u00a0: {count}",
  ],
  "watch:stub-expired": [
    "Лаунчер открыт без игры дольше {minutes} мин — игрой не считаю, чистые файлы возвращаю",
    "Лаунчер відкрито без гри довше {minutes} хв — грою не вважаю, чисті файли повертаю",
    "A launcher has been open without the game for over {minutes} min — not counting it as the game, putting the clean files back",
    "Ein Launcher läuft seit über {minutes} Min. ohne Spiel — zählt nicht als Spiel, saubere Dateien kommen zurück",
    "Launcher działa bez gry dłużej niż {minutes} min — nie liczę go jako gry, przywracam czyste pliki",
    "Un launcher tourne sans jeu depuis plus de {minutes} min — je ne le compte pas comme le jeu, je remets les fichiers d'origine",
  ],
  "recover:returned": [
    "После сбоя вернул чистые файлы ({files} арх.; была фаза «{was}»)",
    "Після збою повернув чисті файли ({files} арх.; була фаза «{was}»)",
    "After a crash, restored the clean files ({files} archives; phase was “{was}”)",
    "Nach einem Absturz saubere Dateien zurückgesetzt ({files} Archive; Phase war „{was}“)",
    "Po awarii przywrócono czyste pliki ({files} arch.; faza „{was}”)",
    "Après un plantage, fichiers d'origine restaurés ({files} archives\u00a0; la phase était «\u00a0{was}\u00a0»)",
  ],
  "recover:session-adopted": [
    "Агент перезапущен посреди игры (PID {pid}) — сессию принял как есть",
    "Агент перезапущено посеред гри (PID {pid}) — сесію прийняв як є",
    "The agent restarted mid-game (PID {pid}) — took over the session as is",
    "Der Agent wurde mitten im Spiel neu gestartet (PID {pid}) — Sitzung unverändert übernommen",
    "Agent uruchomiony ponownie w trakcie gry (PID {pid}) — przejąłem sesję bez zmian",
    "L'agent a redémarré en pleine partie (PID {pid}) — session reprise telle quelle",
  ],
  "recover:file-repaired": [
    "{rel}: обрыв посреди подмены — встал оригинал Rockstar",
    "{rel}: обрив посеред підміни — став оригінал Rockstar",
    "{rel}: swap interrupted midway — the Rockstar original is back",
    "{rel}: Austausch unterbrochen — das Rockstar-Original ist zurück",
    "{rel}: przerwana podmiana — wrócił oryginał Rockstar",
    "{rel}\u00a0: échange interrompu en cours de route — l'original Rockstar est de retour",
  ],
  "recover:repair-detected": [
    "{rel}: файл перезаписан Rockstar во время игры — помечен как чужой",
    "{rel}: файл перезаписано Rockstar під час гри — позначено як чужий",
    "{rel}: file overwritten by Rockstar during the game — marked as foreign",
    "{rel}: Datei von Rockstar im Spiel überschrieben — als fremd markiert",
    "{rel}: plik nadpisany przez Rockstar w trakcie gry — oznaczony jako obcy",
    "{rel}\u00a0: fichier écrasé par Rockstar pendant la partie — marqué comme étranger",
  ],
  "recover:journal-reset": [
    "Журнал фаз сброшен (была «{was}»)",
    "Журнал фаз скинуто (була «{was}»)",
    "Phase journal reset (was “{was}”)",
    "Phasenjournal zurückgesetzt (war „{was}“)",
    "Dziennik faz zresetowany (była „{was}”)",
    "Journal des phases réinitialisé (c'était «\u00a0{was}\u00a0»)",
  ],
  "recover:error": [
    "Восстановление {rel} не удалось",
    "Відновлення {rel} не вдалося",
    "Recovery of {rel} failed",
    "Wiederherstellung von {rel} fehlgeschlagen",
    "Odzyskanie {rel} nie powiodło się",
    "Échec de la récupération de {rel}",
  ],
  "rebuild:dropped": [
    "{rel}: копии модов и оригинала убраны, метка «чужой архив» снята",
    "{rel}: копії модів та оригіналу прибрано, позначку «чужий архів» знято",
    "{rel}: mod and original copies removed, the “foreign archive” mark cleared",
    "{rel}: Kopien von Mods und Original entfernt, Markierung „fremdes Archiv“ gelöscht",
    "{rel}: kopie modów i oryginału usunięte, oznaczenie „obce archiwum” zdjęte",
    "{rel}\u00a0: copies des mods et de l'original supprimées, marque «\u00a0archive étrangère\u00a0» retirée",
  ],
  "manual:waiting": [
    "Жду запуск игры до {minutes} мин — моды встанут в момент старта",
    "Чекаю запуск гри до {minutes} хв — моди стануть у момент старту",
    "Waiting up to {minutes} min for the game — mods go in at launch",
    "Warte bis zu {minutes} Min. auf das Spiel — Mods kommen beim Start rein",
    "Czekam do {minutes} min na grę — mody wejdą w chwili startu",
    "J'attends le lancement du jeu jusqu'à {minutes} min — les mods entreront au démarrage",
  ],
  "manual:return-requested": [
    "Запрошен возврат чистых файлов вручную",
    "Запитано повернення чистих файлів вручну",
    "Manual restore of the clean files requested",
    "Manuelles Zurücksetzen der sauberen Dateien angefordert",
    "Zażądano ręcznego przywrócenia czystych plików",
    "Restauration manuelle des fichiers d'origine demandée",
  ],
  "mode:enabled": [
    "Режим включён: способ «{method}», архивов под подмену — {files}",
    "Режим увімкнено: спосіб «{method}», архівів під підміну — {files}",
    "Mode enabled: method “{method}”, archives to swap — {files}",
    "Modus aktiviert: Methode „{method}“, auszutauschende Archive — {files}",
    "Tryb włączony: metoda „{method}”, archiwów do podmiany — {files}",
    "Mode activé\u00a0: méthode «\u00a0{method}\u00a0», archives à échanger\u00a0: {files}",
  ],
  "mode:disabled": [
    "Режим выключен: моды снова в игре, образ убран",
    "Режим вимкнено: моди знову в грі, образ прибрано",
    "Mode disabled: mods are back in the game, the image is removed",
    "Modus aus: Mods wieder im Spiel, Abbild entfernt",
    "Tryb wyłączony: mody znów w grze, obraz usunięty",
    "Mode désactivé\u00a0: les mods sont de retour dans le jeu, l'image est supprimée",
  ],
  "mode:image-migrated": [
    "Образ режима переехал из папки игры на диск игры",
    "Образ режиму переїхав із теки гри на диск гри",
    "The mode image moved out of the game folder to the game drive",
    "Das Modus-Abbild wurde aus dem Spielordner auf das Spiellaufwerk verschoben",
    "Obraz trybu przeniesiono z folderu gry na dysk gry",
    "L'image du mode a quitté le dossier du jeu pour le disque du jeu",
  ],
  "mode:image-refused": [
    "Образ режима разместить нельзя ({code})",
    "Образ режиму розмістити не можна ({code})",
    "The mode image cannot be placed ({code})",
    "Das Modus-Abbild kann nicht abgelegt werden ({code})",
    "Nie można umieścić obrazu trybu ({code})",
    "Impossible de placer l'image du mode ({code})",
  ],
  "mode:enable-refused": [
    "Режим не включён: запуск агента не вышел",
    "Режим не увімкнено: запуск агента не вдався",
    "Mode not enabled: the agent could not be set up",
    "Modus nicht aktiviert: der Agent ließ sich nicht einrichten",
    "Tryb nie włączony: nie udało się skonfigurować agenta",
    "Mode non activé\u00a0: impossible de configurer l'agent",
  ],
  "mode:enable-failed": [
    "Режим не включён: файлы переложить не удалось, настройки возвращены",
    "Режим не увімкнено: файли перекласти не вдалося, налаштування повернуто",
    "Mode not enabled: the files could not be moved, settings rolled back",
    "Modus nicht aktiviert: Dateien konnten nicht verschoben werden, Einstellungen zurückgesetzt",
    "Tryb nie włączony: nie udało się przenieść plików, ustawienia przywrócone",
    "Mode non activé\u00a0: impossible de déplacer les fichiers, réglages rétablis",
  ],
  "mode:startup-remove-failed": [
    "Задачу автозапуска агента снять не удалось — без работы агент выйдет сам",
    "Завдання автозапуску агента зняти не вдалося — без роботи агент вийде сам",
    "Could not remove the agent's startup task — with nothing to do, the agent exits by itself",
    "Die Autostart-Aufgabe des Agenten ließ sich nicht entfernen — ohne Arbeit beendet sich der Agent selbst",
    "Nie udało się usunąć zadania autostartu agenta — bez pracy agent sam się zakończy",
    "Impossible de retirer la tâche de démarrage de l'agent — sans travail, l'agent se ferme tout seul",
  ],
  "mode:orphan-rebound": [
    "Найден образ режима без привязки ({files} арх.) — привязан заново, способ «{method}»",
    "Знайдено образ режиму без прив'язки ({files} арх.) — прив'язано заново, спосіб «{method}»",
    "Found a mode image with no binding ({files} archives) — bound again, method “{method}”",
    "Modus-Abbild ohne Zuordnung gefunden ({files} Archive) — neu zugeordnet, Methode „{method}“",
    "Znaleziono obraz trybu bez powiązania ({files} arch.) — powiązano ponownie, metoda „{method}”",
    "Image du mode sans rattachement trouvée ({files} archives) — rattachée de nouveau, méthode «\u00a0{method}\u00a0»",
  ],
  "mode:orphan-dropped": [
    "Пустой остаток образа режима убран",
    "Порожній залишок образу режиму прибрано",
    "Empty leftover of the mode image removed",
    "Leerer Rest des Modus-Abbilds entfernt",
    "Pusta pozostałość obrazu trybu usunięta",
    "Reste vide de l'image du mode supprimé",
  ],
  "agent:started": [
    "Агент запущен (PID {pid}, версия {version})",
    "Агент запущено (PID {pid}, версія {version})",
    "Agent started (PID {pid}, version {version})",
    "Agent gestartet (PID {pid}, Version {version})",
    "Agent uruchomiony (PID {pid}, wersja {version})",
    "Agent lancé (PID {pid}, version {version})",
  ],
  "agent:stopped": [
    "Агент остановлен ({reason})",
    "Агент зупинено ({reason})",
    "Agent stopped ({reason})",
    "Agent beendet ({reason})",
    "Agent zatrzymany ({reason})",
    "Agent arrêté ({reason})",
  ],
  "agent:second-instance": [
    "Второй агент не нужен: уже работает другой (PID {pid})",
    "Другий агент не потрібен: уже працює інший (PID {pid})",
    "A second agent is not needed: another one is already running (PID {pid})",
    "Ein zweiter Agent ist unnötig: ein anderer läuft bereits (PID {pid})",
    "Drugi agent nie jest potrzebny: już działa inny (PID {pid})",
    "Un second agent est inutile\u00a0: un autre tourne déjà (PID {pid})",
  ],
  "agent:nothing-to-do": [
    "Режим нигде не включён — агенту делать нечего",
    "Режим ніде не ввімкнено — агентові нема чого робити",
    "The mode is off everywhere — nothing for the agent to do",
    "Der Modus ist nirgends aktiv — der Agent hat nichts zu tun",
    "Tryb nigdzie nie jest włączony — agent nie ma nic do roboty",
    "Le mode est désactivé partout — rien à faire pour l'agent",
  ],
  "agent:control-failed": [
    "Агент не занял канал управления",
    "Агент не зайняв канал керування",
    "The agent could not take the control channel",
    "Der Agent konnte den Steuerkanal nicht belegen",
    "Agent nie zajął kanału sterowania",
    "L'agent n'a pas pu prendre le canal de contrôle",
  ],
  "agent:watcher": [
    "Слежу за процессами игры: {kind}",
    "Стежу за процесами гри: {kind}",
    "Watching game processes: {kind}",
    "Überwache Spielprozesse: {kind}",
    "Śledzę procesy gry: {kind}",
    "Surveillance des processus du jeu\u00a0: {kind}",
  ],
  "agent:startup-registered": [
    "Запуск при входе в Windows: {via} (права администратора: {elevated})",
    "Запуск під час входу в Windows: {via} (права адміністратора: {elevated})",
    "Start at Windows sign-in: {via} (administrator rights: {elevated})",
    "Start bei der Windows-Anmeldung: {via} (Administratorrechte: {elevated})",
    "Start przy logowaniu do Windows: {via} (uprawnienia administratora: {elevated})",
    "Démarrage à l'ouverture de session Windows\u00a0: {via} (droits d'administrateur\u00a0: {elevated})",
  ],
  "agent:startup-removed": [
    "Запуск при входе снят (задача: {task}), агент остановлен: {stopped}",
    "Запуск під час входу знято (завдання: {task}), агент зупинено: {stopped}",
    "Start at sign-in removed (task: {task}), agent stopped: {stopped}",
    "Start bei der Anmeldung entfernt (Aufgabe: {task}), Agent beendet: {stopped}",
    "Start przy logowaniu usunięty (zadanie: {task}), agent zatrzymany: {stopped}",
    "Démarrage à l'ouverture de session retiré (tâche\u00a0: {task}), agent arrêté\u00a0: {stopped}",
  ],
  "agent:stop-for-update-timeout": [
    "Агент не вышел за {waitMs} мс перед обновлением",
    "Агент не вийшов за {waitMs} мс перед оновленням",
    "The agent did not exit within {waitMs} ms before the update",
    "Der Agent beendete sich vor dem Update nicht innerhalb von {waitMs} ms",
    "Agent nie zakończył się w {waitMs} ms przed aktualizacją",
    "L'agent ne s'est pas arrêté en {waitMs} ms avant la mise à jour",
  ],
  "agent:spawn-failed": [
    "Агента не удалось запустить",
    "Агента не вдалося запустити",
    "The agent could not be started",
    "Der Agent konnte nicht gestartet werden",
    "Nie udało się uruchomić agenta",
    "Impossible de lancer l'agent",
  ],
};

const TEXT = {
  method: ["Способ", "Спосіб", "Method", "Methode", "Metoda", "Méthode"],
  recommended: [
    "Рекомендуем",
    "Рекомендуємо",
    "Recommended",
    "Empfohlen",
    "Zalecane",
    "Recommandé",
  ],
  journalBusy: [
    "Идёт подстановка или возврат файлов…",
    "Триває підстановка або повернення файлів…",
    "Putting files in or restoring them…",
    "Dateien werden eingesetzt oder zurückgesetzt …",
    "Trwa podstawianie lub przywracanie plików…",
    "Mise en place ou restauration des fichiers en cours…",
  ],
  staleRepaired: [
    "Rockstar Games Launcher перекачал {file} во время игры — моды из этого файла слетели.",
    "Rockstar Games Launcher перекачав {file} під час гри — моди з цього файлу злетіли.",
    "Rockstar Games Launcher re-downloaded {file} during the game — the mods in that file are gone.",
    "Der Rockstar Games Launcher hat {file} im Spiel neu geladen — die Mods in dieser Datei sind weg.",
    "Rockstar Games Launcher pobrał {file} ponownie w trakcie gry — mody z tego pliku zniknęły.",
    "Le Rockstar Games Launcher a retéléchargé {file} pendant la partie — les mods de ce fichier ont disparu.",
  ],
  staleUpdated: [
    "Игра обновилась ({file}), а моды собраны на прежнюю версию.",
    "Гра оновилась ({file}), а моди зібрані на попередню версію.",
    "The game was updated ({file}) but the mods are built for the old version.",
    "Das Spiel wurde aktualisiert ({file}), die Mods sind aber für die alte Version gebaut.",
    "Gra została zaktualizowana ({file}), a mody są zbudowane pod starą wersję.",
    "Le jeu a été mis à jour ({file}), mais les mods sont conçus pour l'ancienne version.",
  ],
  staleTorn: [
    "Архив с модами {file} повреждён или записан не до конца — в игру он не поставлен.",
    "Архів із модами {file} пошкоджено або записано не до кінця — у гру його не поставлено.",
    "The archive with mods {file} is damaged or incomplete — it was not put into the game.",
    "Das Archiv mit Mods {file} ist beschädigt oder unvollständig — es wurde nicht ins Spiel eingesetzt.",
    "Archiwum z modami {file} jest uszkodzone lub niepełne — nie zostało podstawione do gry.",
    "L'archive avec les mods {file} est endommagée ou incomplète — elle n'a pas été mise dans le jeu.",
  ],
  staleHint: [
    "Нажмите «Пересобрать», затем «Вернуть» в «Библиотеке» — Astral соберёт моды на новые файлы.",
    "Натисніть «Перезібрати», потім «Повернути» в «Бібліотеці» — Astral збере моди на нові файли.",
    "Press “Rebuild”, then “Restore” in the Library — Astral will rebuild the mods on the new files.",
    "„Neu aufbauen“ drücken, dann in der Bibliothek „Wiederherstellen“ — Astral baut die Mods auf den neuen Dateien neu.",
    "Naciśnij „Przebuduj”, potem „Przywróć” w Bibliotece — Astral zbuduje mody na nowych plikach.",
    "Appuyez sur «\u00a0Reconstruire\u00a0», puis sur «\u00a0Restaurer\u00a0» dans la Bibliothèque — Astral reconstruira les mods sur les nouveaux fichiers.",
  ],
  rebuild: [
    "Пересобрать",
    "Перезібрати",
    "Rebuild",
    "Neu aufbauen",
    "Przebuduj",
    "Reconstruire",
  ],
  rebuilding: [
    "Пересобираю…",
    "Перезбираю…",
    "Rebuilding…",
    "Baue neu auf …",
    "Przebudowuję…",
    "Reconstruction…",
  ],
  armNow: [
    "Захожу в игру",
    "Заходжу в гру",
    "I’m starting the game",
    "Ich starte das Spiel",
    "Wchodzę do gry",
    "Je lance le jeu",
  ],
  disarmNow: [
    "Вышел из игры",
    "Вийшов з гри",
    "I’ve quit the game",
    "Ich habe das Spiel beendet",
    "Wyszedłem z gry",
    "J'ai quitté le jeu",
  ],
  logTitle: [
    "Журнал режима",
    "Журнал режиму",
    "Mode journal",
    "Modus-Journal",
    "Dziennik trybu",
    "Journal du mode",
  ],
  logEmpty: [
    "Журнал пока пуст",
    "Журнал поки порожній",
    "The journal is empty so far",
    "Das Journal ist noch leer",
    "Dziennik jest na razie pusty",
    "Le journal est encore vide",
  ],
  logCopy: [
    "Скопировать журнал",
    "Скопіювати журнал",
    "Copy the journal",
    "Journal kopieren",
    "Skopiuj dziennik",
    "Copier le journal",
  ],
  logCopied: [
    "Журнал скопирован",
    "Журнал скопійовано",
    "Journal copied",
    "Journal kopiert",
    "Dziennik skopiowany",
    "Journal copié",
  ],
  logAgent: ["агент", "агент", "agent", "Agent", "agent", "agent"],
  logWindow: ["окно", "вікно", "window", "Fenster", "okno", "fenêtre"],
  yes: ["да", "так", "yes", "ja", "tak", "oui"],
  no: ["нет", "ні", "no", "nein", "nie", "non"],
  viaTask: [
    "задача планировщика",
    "завдання планувальника",
    "scheduled task",
    "geplante Aufgabe",
    "zadanie harmonogramu",
    "tâche planifiée",
  ],
  viaRunKey: [
    "автозагрузка",
    "автозавантаження",
    "startup entry",
    "Autostart-Eintrag",
    "autostart",
    "démarrage automatique",
  ],
  viaNone: [
    "не настроен",
    "не налаштовано",
    "not set up",
    "nicht eingerichtet",
    "nie skonfigurowano",
    "non configuré",
  ],
};

const METHODS = {
  "agent-same": {
    title: [
      "Агент следит сам",
      "Агент стежить сам",
      "The agent watches by itself",
      "Der Agent beobachtet selbst",
      "Agent pilnuje sam",
      "L'agent surveille tout seul",
    ],
  },
  "manual-same": {
    title: [
      "Вручную: «Захожу в игру» / «Вышел»",
      "Вручну: «Заходжу в гру» / «Вийшов»",
      "Manual: “I’m starting” / “I’ve quit”",
      "Manuell: „Ich starte“ / „Beendet“",
      "Ręcznie: „Wchodzę” / „Wyszedłem”",
      "Manuel\u00a0: «\u00a0Je lance le jeu\u00a0» / «\u00a0J'ai quitté\u00a0»",
    ],
  },
  replacex: {
    title: [
      "Как ReplaceX: закрывает Rockstar перед возвратом",
      "Як ReplaceX: закриває Rockstar перед поверненням",
      "Like ReplaceX: closes Rockstar before restoring",
      "Wie ReplaceX: schließt Rockstar vor dem Rücksetzen",
      "Jak ReplaceX: zamyka Rockstar przed przywróceniem",
      "Comme ReplaceX\u00a0: ferme Rockstar avant la restauration",
    ],
  },
};

const ERRORS = {
  ROCKSTAR_MODE_UAC_DECLINED: [
    "Режим не включён: нужен один запрос Windows на права администратора (для запуска агента при входе), а вы его отклонили. Папка игры без этих прав не пишется.",
    "Режим не ввімкнено: потрібен один запит Windows на права адміністратора (для запуску агента під час входу), а ви його відхилили. Тека гри без цих прав не пишеться.",
    "The mode was not enabled: Windows needs one administrator-rights prompt (to start the agent at sign-in) and you declined it. The game folder cannot be written without those rights.",
    "Der Modus wurde nicht aktiviert: Windows braucht eine Administrator-Abfrage (für den Agent-Start bei der Anmeldung), die Sie abgelehnt haben. Ohne diese Rechte ist der Spielordner nicht beschreibbar.",
    "Tryb nie został włączony: Windows potrzebuje jednego pytania o uprawnienia administratora (do startu agenta przy logowaniu), a je odrzucono. Bez tych uprawnień nie można zapisać w folderze gry.",
    "Le mode n'a pas été activé\u00a0: Windows demande une fois les droits d'administrateur (pour lancer l'agent à l'ouverture de session) et vous avez refusé. Sans ces droits, le dossier du jeu n'est pas modifiable.",
  ],
  ROCKSTAR_MODE_NO_AGENT: [
    "Режим не включён: не удалось настроить запуск агента при входе в Windows.",
    "Режим не ввімкнено: не вдалося налаштувати запуск агента під час входу в Windows.",
    "The mode was not enabled: the agent could not be set up to start at Windows sign-in.",
    "Der Modus wurde nicht aktiviert: der Agent ließ sich nicht für den Start bei der Windows-Anmeldung einrichten.",
    "Tryb nie został włączony: nie udało się skonfigurować startu agenta przy logowaniu do Windows.",
    "Le mode n'a pas été activé\u00a0: impossible de configurer le lancement de l'agent à l'ouverture de session Windows.",
  ],
  ROCKSTAR_MODE_OTHER_VOLUME: [
    "Образ режима можно держать только на диске игры, а там негде его создать. Освободите место или выберите «Вторую папку игры».",
    "Образ режиму можна тримати лише на диску гри, а там ніде його створити. Звільніть місце або виберіть «Другу теку гри».",
    "The mode image can only live on the game drive, and there is nowhere to create it. Free up space or choose “Second game folder”.",
    "Das Modus-Abbild darf nur auf dem Spiellaufwerk liegen, dort lässt es sich nicht anlegen. Platz schaffen oder „Zweiter Spielordner“ wählen.",
    "Obraz trybu może leżeć tylko na dysku gry, a tam nie da się go utworzyć. Zwolnij miejsce lub wybierz „Drugi folder gry”.",
    "L'image du mode ne peut se trouver que sur le disque du jeu, et il n'y a nulle part où la créer. Libérez de l'espace ou choisissez «\u00a0Second dossier du jeu\u00a0».",
  ],
  ROCKSTAR_MODE_NOT_WRITABLE: [
    "Нет прав создать образ режима на диске игры. Запустите Astral от имени администратора.",
    "Немає прав створити образ режиму на диску гри. Запустіть Astral від імені адміністратора.",
    "No permission to create the mode image on the game drive. Run Astral as administrator.",
    "Keine Berechtigung, das Modus-Abbild auf dem Spiellaufwerk anzulegen. Astral als Administrator starten.",
    "Brak uprawnień do utworzenia obrazu trybu na dysku gry. Uruchom Astral jako administrator.",
    "Pas d'autorisation pour créer l'image du mode sur le disque du jeu. Lancez Astral en tant qu'administrateur.",
  ],
  ROCKSTAR_MODE_UNSUPPORTED: [
    "Для этой копии игры режим не включается.",
    "Для цієї копії гри режим не вмикається.",
    "The mode cannot be turned on for this copy of the game.",
    "Für diese Kopie des Spiels lässt sich der Modus nicht einschalten.",
    "Dla tej kopii gry nie można włączyć trybu.",
    "Le mode ne peut pas être activé pour cette copie du jeu.",
  ],
  ROCKSTAR_MODE_HAS_COPY: [
    "У игры собрана вторая папка Astral: моды ставятся в неё, и режим вместе с ней не работает. Сначала удалите вторую папку (блок «Другой способ» ниже).",
    "У гри зібрано другу теку Astral: моди ставляться в неї, і режим разом із нею не працює. Спочатку видаліть другу теку (блок «Інший спосіб» нижче).",
    "This game has an Astral second folder: mods go into it, and the mode does not work together with it. Delete the second folder first (the “Another way” block below).",
    "Für dieses Spiel gibt es einen zweiten Astral-Ordner: Mods landen darin, und der Modus funktioniert nicht zusammen damit. Löschen Sie zuerst den zweiten Ordner (Block „Anderer Weg“ unten).",
    "Dla tej gry zbudowano drugi folder Astral: mody trafiają do niego, a tryb razem z nim nie działa. Najpierw usuń drugi folder (blok „Inny sposób” poniżej).",
    "Un second dossier Astral existe pour ce jeu\u00a0: les mods y vont, et le mode ne fonctionne pas avec lui. Supprimez d'abord le second dossier (bloc «\u00a0Autre méthode\u00a0» ci-dessous).",
  ],
  ROCKSTAR_MODE_BLOCKS_COPY: [
    "Режим включён — вторая папка не нужна. Чтобы собрать её, сначала выключите режим.",
    "Режим увімкнено — друга тека не потрібна. Щоб зібрати її, спочатку вимкніть режим.",
    "The mode is on — a second folder is not needed. To build one, turn the mode off first.",
    "Der Modus ist eingeschaltet — ein zweiter Ordner wird nicht gebraucht. Um ihn anzulegen, schalten Sie zuerst den Modus aus.",
    "Tryb jest włączony — drugi folder nie jest potrzebny. Aby go zbudować, najpierw wyłącz tryb.",
    "Le mode est activé — un second dossier est inutile. Pour en construire un, désactivez d'abord le mode.",
  ],
  ROCKSTAR_MODE_IMAGE: [
    "Не удалось разместить образ режима рядом с игрой.",
    "Не вдалося розмістити образ режиму поруч із грою.",
    "Could not place the mode image next to the game.",
    "Das Modus-Abbild konnte nicht neben dem Spiel abgelegt werden.",
    "Nie udało się umieścić obrazu trybu obok gry.",
    "Impossible de placer l'image du mode à côté du jeu.",
  ],
  ROCKSTAR_MODE_MANUAL: [
    "Агент не выполнил команду — нажмите ещё раз.",
    "Агент не виконав команду — натисніть ще раз.",
    "The agent did not carry out the command — press it again.",
    "Der Agent hat den Befehl nicht ausgeführt — bitte noch einmal drücken.",
    "Agent nie wykonał polecenia — naciśnij jeszcze raz.",
    "L'agent n'a pas exécuté la commande — appuyez de nouveau.",
  ],
  ROCKSTAR_MODE_OFF: [
    "Режим для этой игры выключен — сначала включите его.",
    "Режим для цієї гри вимкнено — спочатку увімкніть його.",
    "The mode is off for this game — turn it on first.",
    "Der Modus ist für dieses Spiel aus — schalten Sie ihn zuerst ein.",
    "Tryb dla tej gry jest wyłączony — najpierw go włącz.",
    "Le mode est désactivé pour ce jeu — activez-le d'abord.",
  ],
  ROCKSTAR_MODE_LOCK_TIMEOUT: [
    "Режим Rockstar сейчас занят другим переключением — подождите минуту и повторите.",
    "Режим Rockstar зараз зайнятий іншим перемиканням — зачекайте хвилину й повторіть.",
    "Rockstar mode is busy with another switch right now — wait a minute and try again.",
    "Der Rockstar-Modus ist gerade mit einem anderen Wechsel beschäftigt — warten Sie eine Minute und versuchen Sie es erneut.",
    "Tryb Rockstar jest teraz zajęty innym przełączeniem — poczekaj minutę i spróbuj ponownie.",
    "Le mode Rockstar est occupé par un autre changement — attendez une minute et réessayez.",
  ],
  ROCKSTAR_MODE_GAME_RUNNING: [
    "GTA V запущена — сначала закройте игру.",
    "GTA V запущено — спочатку закрийте гру.",
    "GTA V is running — close the game first.",
    "GTA V läuft — Spiel zuerst schließen.",
    "GTA V jest uruchomiona — najpierw zamknij grę.",
    "GTA V est lancé — fermez d'abord le jeu.",
  ],
};

/** Код отказа режима (`ROCKSTAR_MODE_…`) из ошибки → фраза на языке; иначе `null`. */
export function modeFailureText(failure, language) {
  const code = /ROCKSTAR_MODE_[A-Z_]+/.exec(
    String(failure?.message || failure || ""),
  )?.[0];
  return (code && rockstarModeCopyFor(language).errors[code]) || null;
}

/** Строки экрана на языке (`ru`, `uk`, `en`, `de`, `pl`, `fr`; иначе английский). */
export function rockstarModeCopyFor(language) {
  const text = pick(TEXT, language);
  const methods = Object.fromEntries(
    Object.entries(METHODS).map(([id, entry]) => [id, pick(entry, language)]),
  );
  return { ...text, methods, errors: pick(ERRORS, language) };
}

const basename = (value) =>
  String(value || "")
    .split(/[\\/]/)
    .pop();

/**
 * Запись журнала → строка на языке. Неизвестный код — `scope:code` и
 * технический текст: журнал не должен молчать о том, чего окно не знает.
 */
export function renderModeLogLine(record, language) {
  const index = ORDER.indexOf(language);
  const template =
    LOG[`${record.scope}:${record.code}`]?.[index < 0 ? 2 : index];
  const data = { ...(record.data || {}), rel: basename(record.data?.rel) };
  const t = pick(
    {
      yes: TEXT.yes,
      no: TEXT.no,
      task: TEXT.viaTask,
      "run-key": TEXT.viaRunKey,
      none: TEXT.viaNone,
    },
    language,
  );
  if (data.elevated !== undefined) data.elevated = data.elevated ? t.yes : t.no;
  if (data.stopped !== undefined) data.stopped = data.stopped ? t.yes : t.no;
  if (data.via !== undefined) data.via = t[data.via] || data.via;
  if (METHODS[data.method])
    data.method = pick(METHODS[data.method], language).title;
  if (Array.isArray(data.files)) data.files = data.files.join(", ");
  const text = template
    ? template.replace(/\{(\w+)\}/g, (_, key) =>
        data[key] === undefined || data[key] === null ? "" : String(data[key]),
      )
    : `${record.scope}:${record.code}`;
  return record.detail ? `${text} — ${record.detail}` : text;
}
