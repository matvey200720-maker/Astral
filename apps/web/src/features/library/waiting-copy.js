/*
 * Компонент, который после обновления игры ждёт новой версии (А10, шаг 3; решения ведущей 11.11.2026).
 *
 * Rockstar изменили штатный файл, поверх которого собран компонент «целиком», и движок не накладывает его старую версию на новую основу (`stock-guard.js`):
 * иначе игра берёт устаревшие данные и падает. В «Библиотеке» у такого компонента — строка с причиной и, когда в каталоге есть мод, кнопка «Обновить»
 * (ставится версия каталога, а не старые файлы). Кнопок «поставить силой» нет.
 *
 * Шесть языков окна: ru, uk, en, de, pl, fr (у французского — неразрывный пробел перед «:» и внутри кавычек, в исходнике — escape).
 */

const COPY = {
  ru: {
    title: "Ждут новой версии",
    line: "После обновления игры этот компонент ждёт новой версии — Rockstar изменили его файл",
    hint: "Старая версия в игру не ставится: игра взяла бы устаревшие данные и могла бы упасть.",
    update: "Обновить",
    updating: "Обновляем…",
    missing: "Новой версии в каталоге пока нет — она встанет сама, как только появится.",
    same: "В каталоге пока прежняя версия — новая встанет сама",
    notice: (name) => `${name}: поставили новую версию из каталога — Rockstar изменили файл игры, старая версия не подходила`,
  },
  uk: {
    title: "Чекають нової версії",
    line: "Після оновлення гри цей компонент чекає нової версії — Rockstar змінили його файл",
    hint: "Стара версія в гру не ставиться: гра взяла б застарілі дані й могла б впасти.",
    update: "Оновити",
    updating: "Оновлюємо…",
    missing: "Нової версії в каталозі поки немає — вона стане сама, щойно з’явиться.",
    same: "У каталозі поки що попередня версія — нова стане сама",
    notice: (name) => `${name}: встановили нову версію з каталогу — Rockstar змінили файл гри, стара версія не підходила`,
  },
  en: {
    title: "Waiting for a new version",
    line: "After the game update this component is waiting for a new version — Rockstar changed its file",
    hint: "The old version is not put into the game: it would bring outdated data and could crash the game.",
    update: "Update",
    updating: "Updating…",
    missing: "There is no new version in the catalog yet — it will install itself as soon as it appears.",
    same: "The catalog still has the previous version — the new one will install itself",
    notice: (name) => `${name}: installed the new version from the catalog — Rockstar changed a game file and the old version did not fit`,
  },
  de: {
    title: "Wartet auf eine neue Version",
    line: "Nach dem Spiel-Update wartet diese Komponente auf eine neue Version — Rockstar hat ihre Datei geändert",
    hint: "Die alte Version kommt nicht ins Spiel: sie brächte veraltete Daten mit und könnte das Spiel zum Absturz bringen.",
    update: "Aktualisieren",
    updating: "Wird aktualisiert…",
    missing: "Im Katalog gibt es noch keine neue Version — sie wird von selbst installiert, sobald sie erscheint.",
    same: "Im Katalog liegt noch die vorherige Version — die neue wird von selbst installiert",
    notice: (name) => `${name}: die neue Version aus dem Katalog wurde installiert — Rockstar hat eine Spieldatei geändert, die alte Version passte nicht`,
  },
  pl: {
    title: "Czeka na nową wersję",
    line: "Po aktualizacji gry ten komponent czeka na nową wersję — Rockstar zmienił jego plik",
    hint: "Stara wersja nie trafia do gry: wniosłaby przestarzałe dane i mogłaby zawiesić grę.",
    update: "Zaktualizuj",
    updating: "Aktualizujemy…",
    missing: "W katalogu nie ma jeszcze nowej wersji — zainstaluje się sama, gdy tylko się pojawi.",
    same: "W katalogu wciąż jest poprzednia wersja — nowa zainstaluje się sama",
    notice: (name) => `${name}: zainstalowano nową wersję z katalogu — Rockstar zmienił plik gry i stara wersja nie pasowała`,
  },
  fr: {
    title: "En attente d’une nouvelle version",
    line: "Après la mise à jour du jeu, ce composant attend une nouvelle version — Rockstar a modifié son fichier",
    hint: "L’ancienne version n’est pas installée dans le jeu\u00a0: elle apporterait des données périmées et pourrait faire planter le jeu.",
    update: "Mettre à jour",
    updating: "Mise à jour…",
    missing: "Le catalogue n’a pas encore de nouvelle version — elle s’installera d’elle-même dès qu’elle sera publiée.",
    same: "Le catalogue contient encore l’ancienne version — la nouvelle s’installera d’elle-même",
    notice: (name) => `${name}\u00a0: nouvelle version du catalogue installée — Rockstar a modifié un fichier du jeu, l’ancienne version ne convenait plus`,
  },
};

/** Тексты «ждёт новой версии» на языке окна (неизвестный — английский). */
export const waitingCopyFor = (language) => COPY[language] || COPY.en;
