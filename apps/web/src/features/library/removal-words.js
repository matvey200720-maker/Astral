/*
 * Почему снять из библиотеки не вышло — на языке окна.
 *
 * Корзина живёт в главном процессе (apps/desktop/src/library-removal.js) и
 * говорит по-русски: окно показывало её фразы как есть, и на английском,
 * немецком, польском и французском человек читал «Не хватает места на диске…» и
 * «Дождитесь окончания установок…». Главный процесс называет проблему
 * ключом (`code`, `reason`, `reasonCode`) — по ключу окно и выбирает слова.
 * Отказ, брошенный целиком (игра запущена, очередь занята), узнаётся по
 * тексту, как отказ установки (`describeInstallFailure`). Незнакомое
 * остаётся исходным текстом: спрятать причину хуже, чем показать её
 * по-русски.
 */

import { formatSize } from "../../catalog-utils.js";
import { describeInstallFailure } from "../../utils/installFailure.js";
import { joinSentences } from "../../utils/join-sentences.js";

const WORDS = {
  ru: {
    queueBusy:
      "В «Загрузках» идёт установка или удаление. Дождитесь конца и повторите.",
    workshopBusy:
      "Мастерская сейчас применяет изменения в игру. Дождитесь конца и повторите.",
    noArchive:
      "В папке игры нет update/update.rpf — проверьте файлы игры в Steam, Epic Games или Rockstar Games Launcher.",
    problems: {
      overlap:
        "Работа и мод правят одну и ту же запись игры. Снять их по отдельности без остатков нельзя: верните GTA V без модов.",
      "vanilla-guard":
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль модов.",
      "engine-blocked":
        "Поверх модов каталога лежат работы мастерской, которые нельзя временно снять: удаление модов сотрёт их. Удалите сначала эти работы.",
      "backup-missing":
        "Резервной копии архива под этой работой уже нет — Astral убрал её из кэша, когда поверх легли другие изменения. Снять работу отдельно нельзя: верните штатный вид в её редакторе и примените.",
      space: (size, root) =>
        `Не хватает места на диске ${root}: для удаления нужно ${size} свободного места.`,
    },
    natives: {
      "game-updated":
        "Откат недоступен после обновления игры: Astral принял новую версию GTA V, а копия архива до этой работы к ней не подходит. Верните штатный вид в редакторе работы или «Вернуть GTA V без модов».",
      buried:
        "Поверх этой работы архив игры пересобирали моды каталога или другой инструмент — снять её отдельно Astral не может.",
      unknown:
        "Архив игры изменён не через Astral — обновление игры, проверка файлов или другой мод. Что осталось от этой работы, неизвестно.",
      "foreign-archive":
        "Эта работа меняла не только update.rpf — отдельно её снять нельзя.",
    },
    replay: {
      "patch-missing": "файлы её сборки не найдены.",
      "other-archives": "она меняет не только update.rpf.",
      invalid: "её сборку не удалось проверить.",
    },
  },
  uk: {
    queueBusy:
      "У «Завантаженнях» триває встановлення або видалення. Дочекайтеся кінця і повторіть.",
    workshopBusy:
      "Майстерня зараз застосовує зміни в гру. Дочекайтеся кінця і повторіть.",
    noArchive:
      "У папці гри немає update/update.rpf — перевірте файли гри в Steam, Epic Games або Rockstar Games Launcher.",
    problems: {
      overlap:
        "Робота й мод правлять один і той самий запис гри. Зняти їх окремо без залишків не можна: поверніть GTA V без модів.",
      "vanilla-guard":
        "Спершу завершіть сеанс Vanilla Guard і відновіть профіль модів.",
      "engine-blocked":
        "Поверх модів каталогу лежать роботи майстерні, які не можна тимчасово зняти: видалення модів зітре їх. Спершу видаліть ці роботи.",
      "backup-missing":
        "Резервної копії архіву під цією роботою вже немає — Astral прибрав її з кешу, коли поверх лягли інші зміни. Зняти роботу окремо не можна: поверніть штатний вигляд у її редакторі й застосуйте.",
      space: (size, root) =>
        `Бракує місця на диску ${root}: для видалення потрібно ${size} вільного місця.`,
    },
    natives: {
      "game-updated":
        "Відкат недоступний після оновлення гри: Astral прийняв нову версію GTA V, а копія архіву до цієї роботи до неї не підходить. Поверніть штатний вигляд у редакторі роботи або «Повернути GTA V без модів».",
      buried:
        "Поверх цієї роботи архів гри перезбирали моди каталогу або інший інструмент — зняти її окремо Astral не може.",
      unknown:
        "Архів гри змінено не через Astral — оновлення гри, перевірка файлів або інший мод. Що лишилося від цієї роботи, невідомо.",
      "foreign-archive":
        "Ця робота змінювала не лише update.rpf — окремо її зняти не можна.",
    },
    replay: {
      "patch-missing": "файли її збірки не знайдено.",
      "other-archives": "вона змінює не лише update.rpf.",
      invalid: "її збірку не вдалося перевірити.",
    },
  },
  en: {
    queueBusy:
      "Downloads are installing or removing something. Wait until it finishes and try again.",
    workshopBusy:
      "The workshop is applying changes to the game right now. Wait until it finishes and try again.",
    noArchive:
      "The game folder has no update/update.rpf — verify the game files in Steam, Epic Games or the Rockstar Games Launcher.",
    problems: {
      overlap:
        "A work and a mod edit the same game entry. They cannot be removed separately without leftovers: restore GTA V without mods.",
      "vanilla-guard":
        "Finish the Vanilla Guard session and restore the mod profile first.",
      "engine-blocked":
        "Workshop edits sit on top of the catalog mods and cannot be taken off for a moment: removing the mods would erase them. Remove those edits first.",
      "backup-missing":
        "The archive backup under this edit is gone — Astral cleared it from the cache once other changes were applied on top. It cannot be removed on its own: restore the stock look in its editor and apply.",
      space: (size, root) =>
        `Not enough space on ${root}: removal needs ${size} free.`,
    },
    natives: {
      "game-updated":
        "Rollback is unavailable after a game update: Astral accepted the new GTA V version, and the archive copy taken before this work does not fit it. Restore the stock look in the work's editor or use “Restore GTA V without mods”.",
      buried:
        "Catalog mods or another tool rebuilt the game archive on top of this edit — Astral cannot take it off on its own.",
      unknown:
        "The game archive was changed outside Astral — a game update, a file check or another mod. What is left of this edit is unknown.",
      "foreign-archive":
        "This edit changed more than update.rpf — it cannot be removed on its own.",
    },
    replay: {
      "patch-missing": "its build files are missing.",
      "other-archives": "it changes more than update.rpf.",
      invalid: "its build could not be checked.",
    },
  },
  de: {
    queueBusy:
      "In den Downloads läuft gerade eine Installation oder Entfernung. Warte, bis sie fertig ist, und versuche es erneut.",
    workshopBusy:
      "Die Werkstatt wendet gerade Änderungen im Spiel an. Warte, bis sie fertig ist, und versuche es erneut.",
    noArchive:
      "Im Spielordner fehlt update/update.rpf — prüfe die Spieldateien in Steam, Epic Games oder dem Rockstar Games Launcher.",
    problems: {
      overlap:
        "Eine Arbeit und ein Mod ändern denselben Spieleintrag. Sie lassen sich nicht einzeln ohne Reste entfernen: stelle GTA V ohne Mods wieder her.",
      "vanilla-guard":
        "Beende zuerst die Vanilla-Guard-Sitzung und stelle das Mod-Profil wieder her.",
      "engine-blocked":
        "Über den Katalog-Mods liegen Werkstatt-Arbeiten, die sich nicht vorübergehend abnehmen lassen: Das Entfernen der Mods würde sie löschen. Entferne zuerst diese Arbeiten.",
      "backup-missing":
        "Die Archivsicherung unter dieser Arbeit gibt es nicht mehr — Astral hat sie aus dem Cache entfernt, als weitere Änderungen darübergelegt wurden. Einzeln entfernen geht nicht: Stelle im Editor den Originalzustand her und wende ihn an.",
      space: (size, root) =>
        `Nicht genug Speicherplatz auf ${root}: Zum Entfernen werden ${size} frei benötigt.`,
    },
    natives: {
      "game-updated":
        "Nach einem Spielupdate ist kein Zurücksetzen möglich: Astral hat die neue GTA-V-Version übernommen, und die Archivkopie vor dieser Arbeit passt nicht mehr. Stelle im Editor den Originalzustand her oder nutze „GTA V ohne Mods wiederherstellen“.",
      buried:
        "Über dieser Arbeit haben Katalog-Mods oder ein anderes Werkzeug das Spielarchiv neu gebaut — Astral kann sie nicht einzeln abnehmen.",
      unknown:
        "Das Spielarchiv wurde außerhalb von Astral geändert — durch ein Spielupdate, eine Dateiprüfung oder eine andere Mod. Was von dieser Arbeit übrig ist, ist unbekannt.",
      "foreign-archive":
        "Diese Arbeit hat mehr als update.rpf geändert — einzeln entfernen geht nicht.",
    },
    replay: {
      "patch-missing": "ihre Build-Dateien fehlen.",
      "other-archives": "sie ändert mehr als update.rpf.",
      invalid: "ihr Build ließ sich nicht prüfen.",
    },
  },
  pl: {
    queueBusy:
      "W „Pobranych” trwa instalacja albo usuwanie. Poczekaj, aż się skończy, i spróbuj ponownie.",
    workshopBusy:
      "Warsztat właśnie wprowadza zmiany do gry. Poczekaj, aż skończy, i spróbuj ponownie.",
    noArchive:
      "W folderze gry nie ma update/update.rpf — sprawdź pliki gry w Steam, Epic Games albo Rockstar Games Launcher.",
    problems: {
      overlap:
        "Praca i mod zmieniają ten sam wpis gry. Nie da się ich zdjąć osobno bez pozostałości: przywróć GTA V bez modów.",
      "vanilla-guard":
        "Najpierw zakończ sesję Vanilla Guard i przywróć profil modów.",
      "engine-blocked":
        "Nad modami z katalogu leżą prace warsztatu, których nie da się chwilowo zdjąć: usunięcie modów je zetrze. Najpierw usuń te prace.",
      "backup-missing":
        "Kopii zapasowej archiwum pod tą pracą już nie ma — Astral usunął ją z pamięci podręcznej, gdy nałożono kolejne zmiany. Nie da się jej zdjąć osobno: przywróć domyślny wygląd w jej edytorze i zastosuj.",
      space: (size, root) =>
        `Za mało miejsca na dysku ${root}: do usunięcia potrzeba ${size} wolnego miejsca.`,
    },
    natives: {
      "game-updated":
        "Wycofanie jest niedostępne po aktualizacji gry: Astral przyjął nową wersję GTA V, a kopia archiwum sprzed tej pracy już do niej nie pasuje. Przywróć wygląd domyślny w edytorze pracy lub użyj „Przywróć GTA V bez modów”.",
      buried:
        "Nad tą pracą archiwum gry przebudowały mody z katalogu albo inne narzędzie — Astral nie zdejmie jej osobno.",
      unknown:
        "Archiwum gry zmieniono poza Astral — aktualizacją gry, sprawdzeniem plików albo innym modem. Nie wiadomo, co zostało z tej pracy.",
      "foreign-archive":
        "Ta praca zmieniała nie tylko update.rpf — nie da się jej zdjąć osobno.",
    },
    replay: {
      "patch-missing": "nie znaleziono plików jej kompilacji.",
      "other-archives": "zmienia nie tylko update.rpf.",
      invalid: "nie udało się sprawdzić jej kompilacji.",
    },
  },
  fr: {
    queueBusy:
      "Une installation ou une suppression est en cours dans «\u00a0Téléchargements\u00a0». Attendez la fin, puis réessayez.",
    workshopBusy:
      "L’atelier applique actuellement des modifications au jeu. Attendez la fin, puis réessayez.",
    noArchive:
      "Le dossier du jeu ne contient pas update/update.rpf — vérifiez les fichiers du jeu dans Steam, Epic Games ou le Rockstar Games Launcher.",
    problems: {
      overlap:
        "Une création et un mod modifient la même entrée du jeu. Impossible de les retirer séparément sans résidus\u00a0: restaurez GTA V sans mods.",
      "vanilla-guard":
        "Terminez d’abord la session Vanilla Guard et restaurez le profil de mods.",
      "engine-blocked":
        "Des créations de l’atelier recouvrent les mods du catalogue et ne peuvent pas être retirées temporairement\u00a0: la suppression des mods les effacerait. Supprimez d’abord ces créations.",
      "backup-missing":
        "La sauvegarde de l’archive sous cette création n’existe plus — Astral l’a supprimée du cache lorsque d’autres modifications ont été appliquées par-dessus. Impossible de retirer la création seule\u00a0: rétablissez l’aspect d’origine dans son éditeur, puis appliquez.",
      space: (size, root) =>
        `Espace insuffisant sur le disque ${root}\u00a0: la suppression nécessite ${size} d’espace libre.`,
    },
    natives: {
      "game-updated":
        "La restauration est indisponible après une mise à jour du jeu\u00a0: Astral a pris en compte la nouvelle version de GTA V, et la copie de l’archive d’avant cette création ne lui correspond plus. Rétablissez l’aspect d’origine dans l’éditeur de la création ou utilisez «\u00a0Restaurer GTA V sans mods\u00a0».",
      buried:
        "Des mods du catalogue ou un autre outil ont reconstruit l’archive du jeu par-dessus cette création — Astral ne peut pas la retirer seule.",
      unknown:
        "L’archive du jeu a été modifiée en dehors d’Astral — mise à jour du jeu, vérification des fichiers ou autre mod. On ne sait pas ce qui reste de cette création.",
      "foreign-archive":
        "Cette création a modifié plus que update.rpf — impossible de la retirer seule.",
    },
    replay: {
      "patch-missing": "les fichiers de son build sont introuvables.",
      "other-archives": "elle modifie plus que update.rpf.",
      invalid: "son build n’a pas pu être vérifié.",
    },
  },
};

const wordsFor = (language) => WORDS[language] || WORDS.en;

/* Отказы корзины, брошенные целиком, — по их тексту в library-removal-ipc.js,
   workshop-operations.js и library-removal.js. */
const THROWN = [
  [/Дождитесь окончания установок и удалений/, "queueBusy"],
  [/Мастерская уже применяет изменения/, "workshopBusy"],
  [/нет update\/update\.rpf/, "noArchive"],
];

/**
 * Проблема плана, из-за которой снять нельзя (`plan.problems`).
 *
 * @param {{ code: string, message?: string, requiredBytes?: number, root?: string }} problem
 * @param {string} language
 */
export function removalProblemText(problem, language) {
  const words = wordsFor(language).problems;
  if (problem?.code === "space" && problem.requiredBytes > 0)
    return words.space(
      formatSize(problem.requiredBytes, language),
      problem.root || "",
    );
  return words[problem?.code] || problem?.message || "";
}

/** Почему работу мастерской не снять отдельно (`plan.natives[].reason`). */
export function nativeBlockText(item, language) {
  return wordsFor(language).natives[item?.reason] || item?.message || "";
}

/** Почему работу поверх не вернуть на место (`problem.reasonCode`). */
export function replayReasonText(problem, language) {
  return wordsFor(language).replay[problem?.reasonCode] || problem?.reason;
}

/**
 * Отказ плана или снятия целиком — словами окна; незнакомый — как есть.
 *
 * @param {unknown} error
 * @param {string} language
 */
export function removalErrorText(error, language) {
  const detail = String(error?.message || error || "");
  const words = wordsFor(language);
  const known = THROWN.find(([test]) => test.test(detail));
  if (known) return words[known[1]];
  const failure = describeInstallFailure(detail, language);
  if (failure && failure.kind !== "unknown")
    return joinSentences(failure.reason, failure.advice);
  return detail;
}

/** Мод, который снять не удалось (`result.failedMods[].message`). */
export function modFailureText(message, language) {
  const failure = describeInstallFailure(message, language);
  return failure && failure.kind !== "unknown" ? failure.reason : message;
}
