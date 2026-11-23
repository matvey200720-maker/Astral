/*
 * Слова для всплывашки стража регистрации DLC одежды (`clothing-registration-heal.js`, 13.11.2026): Astral вернул регистрацию, стёртую снаружи, или не смог и говорит почему.
 * Шесть языков, французский на «vous»; неразрывный пробел записан escape, а не самим символом. Грузится при первом показе (`clothing-registration-notice.js`),
 * чтобы слова не лежали в главном куске оболочки.
 *
 * Итог из главного процесса: `{ outcome: "restored" | "failed" | "held", code, cause, why, packs }`.
 *  - `restored` + `cause` `host-missing` — не нашёлся сам файл DLC одежды; `packs-returned` — пак игры с заменёнкой «на месте» вернули снаружи (`clothing-pack-heal.js`); иначе заменили update.rpf;
 *  - `failed` + `code` — `running` | `launcher-busy` | `space` | `locked` | `other`; сырой текст ошибки остаётся в журнале приложения, не в окне.
 */

const NBSP = "\u00a0";

const COPY = {
  ru: {
    update:
      "Игровой файл update.rpf заменили снаружи — Astral вернул одежду на место",
    host: "Файл с одеждой пропал из игры — Astral вернул одежду на место",
    failed: (reason) =>
      `Не удалось вернуть одежду: ${reason}. Подробности — в «Настройки → Логи».`,
    reasons: {
      running: "игра запущена, закройте её",
      "launcher-busy": "лаунчер обновляет или проверяет игру",
      space: "на диске не хватает места",
      locked: "файл игры занят другой программой (лаунчер, антивирус)",
      other: "причина не определена",
    },
  },
  uk: {
    update:
      "Ігровий файл update.rpf замінили ззовні — Astral повернув одяг на місце",
    host: "Файл з одягом зник із гри — Astral повернув одяг на місце",
    failed: (reason) =>
      `Не вдалося повернути одяг: ${reason}. Подробиці — в «Налаштування → Журнал».`,
    reasons: {
      running: "гру запущено, закрийте її",
      "launcher-busy": "лаунчер оновлює або перевіряє гру",
      space: "на диску не вистачає місця",
      locked: "файл гри зайнятий іншою програмою (лаунчер, антивірус)",
      other: "причину не визначено",
    },
  },
  en: {
    update:
      "The game file update.rpf was replaced from outside — Astral put your clothing back",
    host: "The clothing file disappeared from the game — Astral put your clothing back",
    failed: (reason) =>
      `Could not put your clothing back: ${reason}. Details are in Settings → Logs.`,
    reasons: {
      running: "the game is running, close it",
      "launcher-busy": "a launcher is updating or verifying the game",
      space: "the disk is out of space",
      locked:
        "the game file is in use by another program (a launcher, an antivirus)",
      other: "the cause is unknown",
    },
  },
  de: {
    update:
      "Die Spieldatei update.rpf wurde von außen ersetzt — Astral hat deine Kleidung zurückgebracht",
    host: "Die Kleidungsdatei ist aus dem Spiel verschwunden — Astral hat deine Kleidung zurückgebracht",
    failed: (reason) =>
      `Die Kleidung konnte nicht zurückgebracht werden: ${reason}. Details unter Einstellungen → Protokoll.`,
    reasons: {
      running: "das Spiel läuft, schließe es",
      "launcher-busy": "ein Launcher aktualisiert oder prüft das Spiel",
      space: "auf dem Datenträger ist nicht genug Platz",
      locked:
        "die Spieldatei wird von einem anderen Programm benutzt (Launcher, Antivirus)",
      other: "die Ursache ist unbekannt",
    },
  },
  pl: {
    update:
      "Plik gry update.rpf został podmieniony z zewnątrz — Astral przywrócił ubrania na miejsce",
    host: "Plik z ubraniami zniknął z gry — Astral przywrócił ubrania na miejsce",
    failed: (reason) =>
      `Nie udało się przywrócić ubrań: ${reason}. Szczegóły w Ustawienia → Dziennik.`,
    reasons: {
      running: "gra jest uruchomiona, zamknij ją",
      "launcher-busy": "launcher aktualizuje lub sprawdza grę",
      space: "na dysku brakuje miejsca",
      locked: "plik gry jest używany przez inny program (launcher, antywirus)",
      other: "przyczyna nie jest znana",
    },
  },
  fr: {
    update:
      "Le fichier de jeu update.rpf a été remplacé depuis l’extérieur — Astral a remis vos vêtements en place",
    host: "Le fichier des vêtements a disparu du jeu — Astral a remis vos vêtements en place",
    failed: (reason) =>
      `Impossible de remettre vos vêtements en place${NBSP}: ${reason}. Détails dans Paramètres → Journaux.`,
    reasons: {
      running: "le jeu est lancé, fermez-le",
      "launcher-busy": "un launcher met à jour ou vérifie le jeu",
      space: "il n’y a pas assez de place sur le disque",
      locked:
        "le fichier du jeu est utilisé par un autre programme (launcher, antivirus)",
      other: "la cause est inconnue",
    },
  },
};

/*
 * Слова стража паков (`clothing-pack-heal.js`, 14.11.2026). Страж пишет в файлы игры, поэтому окно говорит о каждом его шаге и о каждом отказе:
 *  - `restored` + `packs-returned`: «N заменёнок вернулись в пак X — его вернули к штатному снаружи»;
 *  - `held` + `why`: `repeat` (пак вернули снова вскоре после починки — заменёнка на этом клиенте не удержится, решает человек), `changed` (пак стал не штатным или пропал — поверх чужого страж
 *    не пишет), `other-drift` (разошёлся не только пак: файлы игры изменили не через Astral; паков в итоге нет — слова про файлы без слов про паки, 17.11.2026).
 * `packs` — `[{ name, mods }]`: имя пака и сколько заменёнок в нём. Кнопка — та, что уже есть в «Настройки → Игра» («Вернуть как было»): всплывашка кнопок не несёт, слова называют, где её искать.
 */
const form = (language, count) => new Intl.PluralRules(language).select(count);
const countOf = (packs) =>
  packs.reduce((sum, pack) => sum + (Number(pack?.mods) || 0), 0);
const whereOf = (packs) =>
  packs.length === 1
    ? String(packs[0].name)
    : `${packs
        .slice(0, 4)
        .map((pack) => `${pack.name} (${Number(pack.mods) || 0})`)
        .join(", ")}${packs.length > 4 ? ` +${packs.length - 4}` : ""}`;

const PACK_WORDS = {
  ru: {
    restored: (n, where, several) =>
      several || n < 1
        ? `Заменёнки вернулись в ${several ? "паки" : "пак"} ${where} — ${several ? "их" : "его"} вернули к штатному снаружи`
        : `${n} ${{ one: "заменёнка вернулась", few: "заменёнки вернулись" }[form("ru", n)] ?? "заменёнок вернулись"} в пак ${where} — его вернули к штатному снаружи`,
    repeat: (where) =>
      `Пак ${where} снова вернули к штатному вскоре после починки — лаунчер сервера или проверка файлов делает это на каждом запуске. Заменёнка на этом клиенте не удержится, Astral больше не ставит её сам. Вернуть её на время можно двумя шагами: «Настройки → Игра → Вернуть как было» переложит её в «Библиотеку» как снятую проверкой файлов, а «Установить снова» там поставит её на место`,
    changed: (where) =>
      `Пак ${where} стал не штатным, а другим (обновление игры или чужой мод) или пропал — заменёнки в нём не видны. Astral сам поверх чужого не пишет: «Настройки → Игра → Вернуть как было» соберёт их заново`,
    other: () =>
      `Файлы игры изменили не через Astral. Что именно, покажет «Настройки → Игра»`,
    otherWithPacks: () =>
      `Файлы игры изменили не через Astral, и не только паки, поэтому Astral ничего не трогает. Что именно, покажет «Настройки → Игра». Заменёнки в паках, возвращённых к штатному, поставит «Установить снова» в «Библиотеке»`,
    failed: (reason, parked) =>
      parked
        ? `Не удалось вернуть заменёнки в паки игры: ${reason}. Они лежат в «Библиотеке» как снятые проверкой файлов: «Установить снова» вернёт их, а Astral доведёт возврат при следующем запуске`
        : `Не удалось вернуть заменёнки в паки игры: ${reason}. Подробности — в «Настройки → Логи»`,
    resume: (where) =>
      `Заменёнки пака ${where} Astral уже снял и пока не смог вернуть — они в «Библиотеке» как снятые проверкой файлов: «Установить снова» вернёт их, а Astral доведёт возврат при следующем запуске`,
    waiting: (where, kind) =>
      kind === "game"
        ? `Паки игры (${where}) вернули к штатному, но игра запущена — Astral поставит заменёнки на место, когда вы её закроете`
        : `Паки игры (${where}) вернули к штатному, но открыт лаунчер сервера — Astral поставит заменёнки на место, когда вы его закроете`,
  },
  uk: {
    restored: (n, where, several) =>
      several || n < 1
        ? `Заміни повернулись у ${several ? "паки" : "пак"} ${where} — ${several ? "їх" : "його"} повернули до штатного стану ззовні`
        : `${n} ${{ one: "заміна повернулась", few: "заміни повернулись" }[form("uk", n)] ?? "замін повернулись"} у пак ${where} — його повернули до штатного стану ззовні`,
    repeat: (where) =>
      `Пак ${where} знову повернули до штатного невдовзі після виправлення — лаунчер сервера або перевірка файлів робить це при кожному запуску. Заміна на цьому клієнті не втримається, Astral більше не ставить її сам. Повернути її на певний час можна двома кроками: «Налаштування → Гра → Повернути як було» перекладе її в «Бібліотеку» як знятий перевіркою файлів мод, а «Встановити знову» там поставить її на місце`,
    changed: (where) =>
      `Пак ${where} став не штатним, а іншим (оновлення гри або чужий мод) або зник — заміни в ньому не видно. Astral сам поверх чужого не пише: «Налаштування → Гра → Повернути як було» збере їх заново`,
    other: () =>
      `Файли гри змінили не через Astral. Що саме, покаже «Налаштування → Гра»`,
    otherWithPacks: () =>
      `Файли гри змінили не через Astral, і не лише паки, тому Astral нічого не чіпає. Що саме, покаже «Налаштування → Гра». Заміни в паках, повернених до штатного стану, поставить «Встановити знову» в «Бібліотеці»`,
    failed: (reason, parked) =>
      parked
        ? `Не вдалося повернути заміни в паки гри: ${reason}. Вони лежать у «Бібліотеці» як зняті перевіркою файлів: «Встановити знову» поверне їх, а Astral доведе повернення під час наступного запуску`
        : `Не вдалося повернути заміни в паки гри: ${reason}. Подробиці — в «Налаштування → Журнал»`,
    resume: (where) =>
      `Заміни паку ${where} Astral уже зняв і поки не зміг повернути — вони в «Бібліотеці» як зняті перевіркою файлів: «Встановити знову» поверне їх, а Astral доведе повернення під час наступного запуску`,
    waiting: (where, kind) =>
      kind === "game"
        ? `Паки гри (${where}) повернули до штатного стану, але гру запущено — Astral поставить заміни на місце, коли ви її закриєте`
        : `Паки гри (${where}) повернули до штатного стану, але відкрито лаунчер сервера — Astral поставить заміни на місце, коли ви його закриєте`,
  },
  en: {
    restored: (n, where, several) =>
      several || n < 1
        ? `Replacements are back in the ${several ? "packs" : "pack"} ${where} — ${several ? "they were" : "it was"} reset to stock from outside`
        : `${n} ${n === 1 ? "replacement is" : "replacements are"} back in the ${where} pack — it was reset to stock from outside`,
    repeat: (where) =>
      `The ${where} pack was reset to stock again soon after the repair — a server launcher or a file check does this on every launch. The replacement will not stay on this client, and Astral will not put it back by itself. You can bring it back for a while in two steps: Settings → Game → “Restore the original” moves it to the Library as removed by a file check, and “Install again” there puts it back`,
    changed: (where) =>
      `The ${where} pack is no longer the stock one but something else (a game update or someone else’s mod), or it is gone — the replacements in it are not visible. Astral does not write over a foreign file by itself: Settings → Game → “Restore the original” rebuilds them`,
    other: () =>
      `Game files were changed outside Astral. Settings → Game shows which`,
    otherWithPacks: () =>
      `Game files were changed outside Astral, and not only the packs, so Astral touches nothing. Settings → Game shows which. Replacements in packs reset to stock come back with “Install again” in the Library`,
    failed: (reason, parked) =>
      parked
        ? `Could not put the replacements back into the game packs: ${reason}. They are in the Library as removed by a file check: “Install again” brings them back, and Astral will finish the return on the next launch`
        : `Could not put the replacements back into the game packs: ${reason}. Details are in Settings → Logs`,
    resume: (where) =>
      `Astral already took the replacements of the ${where} pack out and could not put them back yet — they are in the Library as removed by a file check: “Install again” brings them back, and Astral will finish the return on the next launch`,
    waiting: (where, kind) =>
      kind === "game"
        ? `The game packs (${where}) were reset to stock, but the game is running — Astral will put the replacements back when you close it`
        : `The game packs (${where}) were reset to stock, but a server launcher is open — Astral will put the replacements back when you close it`,
  },
  de: {
    restored: (n, where, several) =>
      several || n < 1
        ? `Ersetzungen sind wieder in den ${several ? "Packs" : "Pack"} ${where} — ${several ? "sie wurden" : "es wurde"} von außen auf den Originalzustand zurückgesetzt`
        : `${n} ${n === 1 ? "Ersetzung ist" : "Ersetzungen sind"} wieder im Pack ${where} — es wurde von außen auf den Originalzustand zurückgesetzt`,
    repeat: (where) =>
      `Das Pack ${where} wurde kurz nach der Reparatur erneut auf den Originalzustand zurückgesetzt — ein Server-Launcher oder die Dateiprüfung macht das bei jedem Start. Die Ersetzung hält auf diesem Client nicht, Astral setzt sie nicht mehr selbst ein. Für eine Weile geht sie in zwei Schritten zurück: Einstellungen → Spiel → „Original wiederherstellen“ legt sie in die Bibliothek als von der Dateiprüfung entfernt, „Wieder installieren“ dort setzt sie ein`,
    changed: (where) =>
      `Das Pack ${where} ist nicht mehr das Originalpack, sondern ein anderes (Spielupdate oder fremde Mod), oder es fehlt — die Ersetzungen darin sind nicht sichtbar. Astral schreibt nicht selbst über Fremdes: Einstellungen → Spiel → „Original wiederherstellen“ baut sie neu auf`,
    other: () =>
      `Spieldateien wurden außerhalb von Astral geändert. Einstellungen → Spiel zeigt, welche`,
    otherWithPacks: () =>
      `Spieldateien wurden außerhalb von Astral geändert, nicht nur die Packs, deshalb fasst Astral nichts an. Einstellungen → Spiel zeigt, welche. Ersetzungen in auf den Originalzustand zurückgesetzten Packs bringt „Wieder installieren“ in der Bibliothek zurück`,
    failed: (reason, parked) =>
      parked
        ? `Die Ersetzungen konnten nicht in die Spiel-Packs zurückgebracht werden: ${reason}. Sie liegen in der Bibliothek als von der Dateiprüfung entfernt: „Wieder installieren“ bringt sie zurück, Astral beendet die Rückführung beim nächsten Start`
        : `Die Ersetzungen konnten nicht in die Spiel-Packs zurückgebracht werden: ${reason}. Details unter Einstellungen → Protokoll`,
    resume: (where) =>
      `Astral hat die Ersetzungen des Packs ${where} schon herausgenommen und noch nicht zurückbringen können — sie liegen in der Bibliothek als von der Dateiprüfung entfernt: „Wieder installieren“ bringt sie zurück, Astral beendet die Rückführung beim nächsten Start`,
    waiting: (where, kind) =>
      kind === "game"
        ? `Die Spiel-Packs (${where}) wurden auf den Originalzustand zurückgesetzt, aber das Spiel läuft — Astral setzt die Ersetzungen wieder ein, sobald du es schließt`
        : `Die Spiel-Packs (${where}) wurden auf den Originalzustand zurückgesetzt, aber ein Server-Launcher ist offen — Astral setzt die Ersetzungen wieder ein, sobald du ihn schließt`,
  },
  pl: {
    restored: (n, where, several) =>
      several || n < 1
        ? `Zamienniki wróciły do ${several ? "paczek" : "paczki"} ${where} — zresetowano ${several ? "je" : "ją"} z zewnątrz do stanu fabrycznego`
        : `${n} ${{ one: "zamiennik wrócił", few: "zamienniki wróciły" }[form("pl", n)] ?? "zamienników wróciło"} do paczki ${where} — zresetowano ją z zewnątrz do stanu fabrycznego`,
    repeat: (where) =>
      `Paczkę ${where} znowu zresetowano do stanu fabrycznego tuż po naprawie — launcher serwera albo sprawdzanie plików robi to przy każdym uruchomieniu. Zamiennik nie utrzyma się na tym kliencie, a Astral nie wstawi go już sam. Na jakiś czas można go przywrócić dwoma krokami: Ustawienia → Gra → „Przywróć oryginał” przeniesie go do Biblioteki jako usunięty przez sprawdzanie plików, a „Zainstaluj ponownie” tam wstawi go z powrotem`,
    changed: (where) =>
      `Paczka ${where} nie jest już fabryczna, tylko inna (aktualizacja gry lub cudzy mod) albo zniknęła — zamienników w niej nie widać. Astral sam nie pisze po cudzych plikach: Ustawienia → Gra → „Przywróć oryginał” zbuduje je od nowa`,
    other: () =>
      `Pliki gry zostały zmienione poza Astralem. Ustawienia → Gra pokaże, które`,
    otherWithPacks: () =>
      `Pliki gry zostały zmienione poza Astralem, i to nie tylko paczki, więc Astral niczego nie rusza. Ustawienia → Gra pokaże, które. Zamienniki w paczkach zresetowanych do stanu fabrycznego przywraca „Zainstaluj ponownie” w Bibliotece`,
    failed: (reason, parked) =>
      parked
        ? `Nie udało się przywrócić zamienników do paczek gry: ${reason}. Leżą w Bibliotece jako usunięte przez sprawdzanie plików: „Zainstaluj ponownie” je przywróci, a Astral dokończy powrót przy następnym uruchomieniu`
        : `Nie udało się przywrócić zamienników do paczek gry: ${reason}. Szczegóły w Ustawienia → Dziennik`,
    resume: (where) =>
      `Astral zdjął już zamienniki paczki ${where} i na razie nie zdołał ich przywrócić — są w Bibliotece jako usunięte przez sprawdzanie plików: „Zainstaluj ponownie” je przywróci, a Astral dokończy powrót przy następnym uruchomieniu`,
    waiting: (where, kind) =>
      kind === "game"
        ? `Paczki gry (${where}) zresetowano do stanu fabrycznego, ale gra jest uruchomiona — Astral wstawi zamienniki z powrotem, gdy ją zamkniesz`
        : `Paczki gry (${where}) zresetowano do stanu fabrycznego, ale otwarty jest launcher serwera — Astral wstawi zamienniki z powrotem, gdy go zamkniesz`,
  },
  fr: {
    restored: (n, where, several) =>
      several || n < 1
        ? `Des remplacements sont revenus dans ${several ? "les packs" : "le pack"} ${where} — ${several ? "ils avaient été remis" : "il avait été remis"} à l’état d’origine depuis l’extérieur`
        : `${n} ${n === 1 ? "remplacement est revenu" : "remplacements sont revenus"} dans le pack ${where} — il avait été remis à l’état d’origine depuis l’extérieur`,
    repeat: (where) =>
      `Le pack ${where} a de nouveau été remis à l’état d’origine peu après la réparation — un launcher de serveur ou la vérification des fichiers le fait à chaque lancement. Le remplacement ne tiendra pas sur ce client et Astral ne le remettra plus tout seul. On peut le ramener un moment en deux étapes${NBSP}: Paramètres → Jeu → «${NBSP}Restaurer l’original${NBSP}» le place dans la Bibliothèque comme retiré par la vérification des fichiers, puis «${NBSP}Installer à nouveau${NBSP}» l’y remet`,
    changed: (where) =>
      `Le pack ${where} n’est plus le pack d’origine mais un autre (mise à jour du jeu ou mod tiers), ou il a disparu — les remplacements qu’il contient ne sont pas visibles. Astral n’écrit pas tout seul par-dessus un fichier étranger${NBSP}: Paramètres → Jeu → «${NBSP}Restaurer l’original${NBSP}» les reconstruit`,
    other: () =>
      `Des fichiers du jeu ont été modifiés en dehors d’Astral. Paramètres → Jeu montre lesquels`,
    otherWithPacks: () =>
      `Des fichiers du jeu ont été modifiés en dehors d’Astral, et pas seulement les packs, donc Astral ne touche à rien. Paramètres → Jeu montre lesquels. Les remplacements des packs remis à l’état d’origine reviennent avec «${NBSP}Installer à nouveau${NBSP}» dans la Bibliothèque`,
    failed: (reason, parked) =>
      parked
        ? `Impossible de remettre les remplacements dans les packs du jeu${NBSP}: ${reason}. Ils sont dans la Bibliothèque comme retirés par la vérification des fichiers${NBSP}: «${NBSP}Installer à nouveau${NBSP}» les remet, et Astral terminera le retour au prochain lancement`
        : `Impossible de remettre les remplacements dans les packs du jeu${NBSP}: ${reason}. Détails dans Paramètres → Journaux`,
    resume: (where) =>
      `Astral a déjà retiré les remplacements du pack ${where} et n’a pas encore pu les remettre — ils sont dans la Bibliothèque comme retirés par la vérification des fichiers${NBSP}: «${NBSP}Installer à nouveau${NBSP}» les remet, et Astral terminera le retour au prochain lancement`,
    waiting: (where, kind) =>
      kind === "game"
        ? `Les packs du jeu (${where}) ont été remis à l’état d’origine, mais le jeu est lancé — Astral remettra les remplacements en place quand vous le fermerez`
        : `Les packs du jeu (${where}) ont été remis à l’état d’origine, mais un launcher de serveur est ouvert — Astral remettra les remplacements en place quand vous le fermerez`,
  },
};

/** Слова про паки: `{ text, tone }` или `null` (итог не про паки). */
function packNotice(result, language) {
  const words = PACK_WORDS[language] ?? PACK_WORDS.en;
  const reasons = (COPY[language] ?? COPY.en).reasons;
  const packs = Array.isArray(result?.packs)
    ? result.packs.filter((pack) => pack?.name)
    : [];
  const where = whereOf(packs);
  if (result.outcome === "restored")
    return {
      text: words.restored(countOf(packs), where, packs.length > 1),
      tone: "info",
    };
  /* «Писать нельзя сейчас» — не ошибка: заменёнки вернутся, когда закроется игра или лаунчер сервера (ревью, №9). */
  if (result.outcome === "waiting")
    return {
      text: words.waiting(
        where,
        result.why === "game-running" ? "game" : "launcher",
      ),
      tone: "info",
    };
  if (result.outcome === "failed")
    return {
      text: words.failed(
        reasons[result.code] ?? reasons.other,
        Number(result.parked) || 0,
      ),
      tone: "error",
    };
  if (result.outcome === "held")
    return {
      text:
        result.why === "repeat"
          ? words.repeat(where)
          : result.why === "changed"
            ? words.changed(where)
            : result.why === "resume-failed"
              ? words.resume(where)
              : /* Паки не расходятся вовсе (разошёлся один update.rpf) — слова про паки здесь лишние. */
                packs.length
                ? words.otherWithPacks()
                : words.other(),
      tone: "error",
    };
  return null;
}

/** Уведомление окну по итогу стража: `{ text, tone }` или `null`, если сказать нечего. Язык неизвестен — английский. */
export function clothingNotice(result, language = "ru") {
  const words = COPY[language] ?? COPY.en;
  if (
    result?.outcome === "held" ||
    result?.outcome === "waiting" ||
    (result?.outcome === "failed" && result.cause === "packs-returned") ||
    (result?.outcome === "restored" && result.cause === "packs-returned")
  )
    return packNotice(result, language);
  if (result?.outcome === "restored")
    return {
      text: result.cause === "host-missing" ? words.host : words.update,
      tone: "info",
    };
  if (result?.outcome === "failed")
    return {
      text: words.failed(words.reasons[result.code] ?? words.reasons.other),
      tone: "error",
    };
  return null;
}
