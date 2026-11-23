/*
 * Что Astral исправил сам, — словами (задача 1 ТЗ 10.10.2026).
 *
 * Сбои вокруг Astral — перенос кэша, игра в другой папке, update.rpf из
 * старой копии, переустановка, почищенный кэш — движок больше не превращает
 * в отказ: он пересчитывает, что в игре на самом деле, и ставит дальше. Его
 * опись событий приходит в профиле окна (`profile.reconcile[targetId]`), а
 * здесь новые события превращаются в одну короткую строку уведомления.
 * Показанное помнится по времени последнего события на цель: перезапуск
 * окна его не повторяет.
 */

import { useCallback, useRef } from "react";
import { rewriteMovedGameRecords } from "../workshop-library.js";
import { tr } from "../locales/ui.js";

const SEEN_KEY = "astral.reconcile.seen.v1";

/**
 * Обработчик событий отчёта для оболочки: новые события — строкой
 * уведомления (`notify`), переезд игры — ещё и записям установок
 * мастерской. Ссылка на обработчик постоянна: им пользуется
 * `syncInstalledProfile`, который не должен меняться от рендера к рендеру.
 */
export function useReconcileNotices({ language, notify }) {
  const latest = useRef(null);
  latest.current = (events, targetId) => {
    const fresh = takeNewReconcileEvents(events, targetId);
    for (const event of fresh)
      if (event.kind === "game-moved") rewriteMovedGameRecords(event.from, event.to);
    const text = describeReconcileEvents(fresh, language);
    if (text) notify(text);
  };
  return useCallback((events, targetId) => latest.current?.(events, targetId), []);
}

const COPY = {
  ru: {
    lead: "Astral навёл порядок сам",
    "update-restored": () => tr("update.rpf пропал из папки игры — Astral вернул его из своей копии оригинала"),
    "astral-traces-removed": (event) =>
      `в игре нашлись следы прежней установки Astral${list(event)} — они убраны, установка идёт как обычно`,
    "game-moved": () => tr("GTA V теперь в другой папке — установленное переехало вместе с ней"),
    "base-readopted": () =>
      tr("резервная копия архива игры пропала из кэша — основой стала игра как она есть; к штатной её вернёт проверка файлов в Steam"),
    "mods-lost": (event) =>
      `у ${count(event, [tr("мода"), tr("модов"), tr("модов")])} пропали файлы в кэше — они сняты, поставьте их снова`,
    "restored-by-launcher": () => tr("игра была восстановлена, моды сняты — их можно поставить снова одной кнопкой в «Библиотеке»"),
    "carrier-lost": () => "Дороги и растительность нужно поставить заново: игра обновилась, и их файлов в ней больше нет",
    "waiting-for-version": (event) => `после обновления игры ${waitingCount(event)} ждут новой версии — Rockstar изменили их файлы, старые версии в игру не ставятся`,
    "dependents-removed": (event) => `вместе с ядром эффектов снята кровь (${removedCount(event)}) — в ядре не осталось её правил`,
  },
  uk: {
    lead: "Astral навів лад сам",
    "update-restored": () => tr("update.rpf зник з папки гри — Astral повернув його зі своєї копії оригіналу"),
    "astral-traces-removed": (event) =>
      `у грі знайшлися сліди попередньої установки Astral${list(event)} — їх прибрано, установка йде як звичайно`,
    "game-moved": () => tr("GTA V тепер в іншій папці — встановлене переїхало разом з нею"),
    "base-readopted": () =>
      tr("резервна копія архіву гри зникла з кешу — основою стала гра як є; до штатної її поверне перевірка файлів у Steam"),
    "mods-lost": (event) => `у ${count(event, [tr("мода"), tr("модів"), tr("модів")])} зникли файли в кеші — їх знято, поставте знову`,
    "restored-by-launcher": () => tr("гру відновлено, моди знято — їх можна поставити знову однією кнопкою в «Бібліотеці»"),
    "carrier-lost": () => "Дороги та рослинність потрібно поставити знову: гра оновилася, і їхніх файлів у ній більше немає",
    "waiting-for-version": (event) => `після оновлення гри ${waitingCount(event)} чекають нової версії — Rockstar змінили їхні файли, старі версії в гру не ставляться`,
    "dependents-removed": (event) => `разом з ядром ефектів знято кров (${removedCount(event)}) — у ядрі не лишилося її правил`,
  },
  en: {
    lead: "Astral fixed things on its own",
    "update-restored": () => "update.rpf was missing from the game folder — Astral put it back from its copy of the original",
    "astral-traces-removed": (event) =>
      `the game had traces of an earlier Astral install${list(event)} — they were removed and installing goes on as usual`,
    "game-moved": () => "GTA V is in a new folder now — what was installed moved with it",
    "base-readopted": () =>
      "the backup of a game archive was missing from the cache — the game as it is became the base; a Steam file check returns it to stock",
    "mods-lost": (event) => `files of ${event?.modIds?.length || 0} mods were missing from the cache — they were removed, install them again`,
    "restored-by-launcher": () => "the game was restored and the mods were removed — reinstall them with one button in the Library",
    "carrier-lost": () => "Roads and vegetation need to be installed again: the game was updated and their files are no longer in it",
    "waiting-for-version": (event) => `after the game update ${waitingCount(event)} are waiting for a new version — Rockstar changed their files, the old versions are not put into the game`,
    "dependents-removed": (event) => `blood was removed together with the effects core (${removedCount(event)}) — the core no longer has its rules`,
  },
  de: {
    lead: "Astral hat selbst aufgeräumt",
    "update-restored": () => "update.rpf fehlte im Spielordner — Astral hat es aus seiner Kopie des Originals zurückgelegt",
    "astral-traces-removed": (event) =>
      `im Spiel waren Reste einer früheren Astral-Installation${list(event)} — sie wurden entfernt, die Installation läuft normal weiter`,
    "game-moved": () => "GTA V liegt jetzt in einem anderen Ordner — das Installierte ist mitgezogen",
    "base-readopted": () =>
      "die Sicherung eines Spielarchivs fehlte im Cache — das Spiel, wie es ist, wurde zur Basis; eine Dateiprüfung in Steam stellt das Original wieder her",
    "mods-lost": (event) => `bei ${event?.modIds?.length || 0} Mods fehlten Dateien im Cache — sie wurden entfernt, installiere sie erneut`,
    "restored-by-launcher": () => "das Spiel wurde wiederhergestellt, die Mods entfernt — installiere sie mit einem Klick in der Bibliothek neu",
    "carrier-lost": () => "Straßen und Vegetation müssen neu installiert werden: das Spiel wurde aktualisiert, ihre Dateien sind nicht mehr darin",
    "waiting-for-version": (event) => `nach dem Spiel-Update warten ${waitingCount(event)} auf eine neue Version — Rockstar hat ihre Dateien geändert, die alten Versionen kommen nicht ins Spiel`,
    "dependents-removed": (event) => `das Blut wurde zusammen mit dem Effektkern entfernt (${removedCount(event)}) — dem Kern fehlen seine Regeln`,
  },
  pl: {
    lead: "Astral sam zrobił porządek",
    "update-restored": () => "update.rpf zniknął z folderu gry — Astral przywrócił go ze swojej kopii oryginału",
    "astral-traces-removed": (event) =>
      `w grze były ślady wcześniejszej instalacji Astral${list(event)} — usunięto je, instalacja idzie normalnie`,
    "game-moved": () => "GTA V jest teraz w innym folderze — zainstalowane przeniosło się razem z nią",
    "base-readopted": () =>
      "kopia zapasowa archiwum gry zniknęła z pamięci podręcznej — bazą stała się gra taka, jaka jest; do oryginału przywróci ją weryfikacja plików w Steam",
    "mods-lost": (event) => `${event?.modIds?.length || 0} modom zniknęły pliki w pamięci podręcznej — usunięto je, zainstaluj ponownie`,
    "restored-by-launcher": () => "gra została przywrócona, mody usunięte — zainstalujesz je ponownie jednym przyciskiem w Bibliotece",
    "carrier-lost": () => "Drogi i roślinność trzeba zainstalować ponownie: gra została zaktualizowana i nie ma już w niej ich plików",
    "waiting-for-version": (event) => `po aktualizacji gry ${waitingCount(event)} czekają na nową wersję — Rockstar zmienił ich pliki, stare wersje nie trafiają do gry`,
    "dependents-removed": (event) => `krew została usunięta razem z rdzeniem efektów (${removedCount(event)}) — w rdzeniu brakuje jej reguł`,
  },
  fr: {
    /* Неразрывный пробел перед «:» — двоеточие дописывает код ниже. */
    lead: "Astral a remis de l’ordre tout seul\u00a0",
    "update-restored": () => "update.rpf avait disparu du dossier du jeu — Astral l’a restauré depuis sa copie de l’original",
    "astral-traces-removed": (event) =>
      `le jeu contenait des traces d’une ancienne installation d’Astral${list(event)} — elles ont été supprimées et l’installation se poursuit normalement`,
    "game-moved": () => "GTA V se trouve maintenant dans un autre dossier — ce qui était installé a suivi",
    "base-readopted": () =>
      "la sauvegarde de l’archive du jeu avait disparu du cache — le jeu tel quel est devenu la base\u00a0; une vérification des fichiers dans Steam le remettra à l’état d’origine",
    "mods-lost": (event) => {
      const total = event?.modIds?.length || 0;
      return total > 1
        ? `${total} mods ont perdu leurs fichiers dans le cache — ils ont été retirés, réinstallez-les`
        : `${total} mod a perdu ses fichiers dans le cache — il a été retiré, réinstallez-le`;
    },
    "restored-by-launcher": () => "le jeu a été restauré et les mods ont été retirés — vous pouvez les réinstaller d’un clic dans la «\u00a0Bibliothèque\u00a0»",
    "carrier-lost": () => "il faut réinstaller les routes et la végétation\u00a0: le jeu a été mis à jour et leurs fichiers n’y sont plus",
    "waiting-for-version": (event) => `après la mise à jour du jeu, ${waitingCount(event)} attendent une nouvelle version — Rockstar a modifié leurs fichiers, les anciennes versions ne sont pas installées dans le jeu`,
    "dependents-removed": (event) => `le sang a été retiré avec le noyau d’effets (${removedCount(event)})\u00a0: le noyau n’a plus ses règles`,
  },
};

function list(event) {
  const names = [...(event?.containers || []), ...(event?.dlcs || [])]
    .map((name) => String(name).replace(/\.rpf$/i, "").replace(/^astral_/i, ""))
    .filter(Boolean);
  return names.length ? ` (${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""})` : "";
}

function waitingCount(event) {
  return `(${Array.isArray(event?.modIds) ? event.modIds.length : 0})`;
}

function removedCount(event) {
  return Array.isArray(event?.dependents) ? event.dependents.length : 0;
}

function count(event, [one, few, many]) {
  const value = Number(event?.modIds?.length || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${value} ${word}`;
}

function readSeen(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SEEN_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/**
 * События цели, которых окно ещё не показывало, и отметка, что показало.
 * Первое знакомство с целью (отметки нет) показывает события только этого
 * часа: старые сбои давно позади.
 */
export function takeNewReconcileEvents(events, targetId, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const list = Array.isArray(events) ? events.filter((event) => event?.kind && event?.at) : [];
  if (!targetId || !list.length) return [];
  const seen = readSeen(storage);
  const since = seen[targetId] || new Date(now - 60 * 60 * 1000).toISOString();
  const fresh = list.filter((event) => String(event.at) > since);
  const latest = list.map((event) => String(event.at)).sort().at(-1);
  if (latest && latest !== seen[targetId]) {
    try {
      storage?.setItem(SEEN_KEY, JSON.stringify({ ...seen, [targetId]: latest }));
    } catch {
      /* Хранилище окна недоступно — покажем ещё раз, не страшно. */
    }
  }
  return fresh;
}

/** Одна строка уведомления о новых событиях, или пустая строка. */
export function describeReconcileEvents(events, language = "ru") {
  const copy = COPY[language] || COPY.en;
  const parts = [];
  const seenKinds = new Set();
  for (const event of events || []) {
    const describe = copy[event?.kind];
    if (typeof describe !== "function" || seenKinds.has(event.kind)) continue;
    seenKinds.add(event.kind);
    parts.push(describe(event));
  }
  return parts.length ? `${copy.lead}: ${parts.join("; ")}.` : "";
}
