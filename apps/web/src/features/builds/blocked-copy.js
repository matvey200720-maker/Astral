/*
 * Почему сборку не поставить — словами на языке окна.
 *
 * План (`install-plan.js`) называет причину ключом; здесь она становится
 * фразой. Всплывашка называет сборку, моды и что с ними не так, окно сборки
 * — причину под строкой мода. Раньше было одно «В сборке есть недоступные
 * или конфликтующие модификации»: человек не знал, какие и что делать.
 *
 * Причины сформулированы без числа («без подписи…», а не «пакет не
 * подписан»), чтобы одна фраза годилась и для одного мода, и для трёх.
 */

import { describeInstallFailure } from "../../utils/installFailure.js";
import { modList } from "./mod-list.js";

const COPY = {
  ru: {
    quotes: ["«", "»"],
    andMore: "и ещё",
    head: (build) => `Сборку ${build} не поставить`,
    conflict: (first, second) =>
      `${first} и ${second} меняют одно и то же в игре`,
    unpick: "Снимите отметку в окне сборки — остальное встанет.",
    repair:
      "Проверьте целостность файлов игры и повторите — или снимите отметку в окне сборки, остальное встанет.",
    missingTitle: "Мод не найден",
    reasons: {
      missing: "удалён из каталога — поставить нельзя",
      stale: "в сборке сохранена прежняя версия",
      unsigned: "без подписи ключом каталога, нужна новая версия Astral",
      "no-package": "нет проверенного установочного пакета",
      "release-mismatch": "каталог выдал не ту версию, что сохранена в сборке",
      loader: "не настроен безопасный загрузчик mods",
      unavailable: "пакет сейчас не получить",
    },
  },
  uk: {
    quotes: ["«", "»"],
    andMore: "і ще",
    head: (build) => `Збірку ${build} не встановити`,
    conflict: (first, second) =>
      `${first} і ${second} змінюють одне й те саме в грі`,
    unpick: "Зніміть позначку у вікні збірки — решта встановиться.",
    repair:
      "Перевірте цілісність файлів гри й повторіть — або зніміть позначку у вікні збірки, решта встановиться.",
    missingTitle: "Мод не знайдено",
    reasons: {
      missing: "видалений з каталогу — встановити не можна",
      stale: "у збірці збережено попередню версію",
      unsigned: "без підпису ключем каталогу, потрібна нова версія Astral",
      "no-package": "немає перевіреного інсталяційного пакета",
      "release-mismatch": "каталог видав не ту версію, що збережена в збірці",
      loader: "не налаштовано безпечний завантажувач mods",
      unavailable: "пакет зараз не отримати",
    },
  },
  en: {
    quotes: ["“", "”"],
    andMore: "and",
    head: (build) => `The build ${build} can’t be installed`,
    conflict: (first, second) =>
      `${first} and ${second} change the same thing in the game`,
    unpick: "Untick it in the build window and the rest will install.",
    repair:
      "Verify the game files and try again, or untick it in the build window and the rest will install.",
    missingTitle: "Mod not found",
    reasons: {
      missing: "removed from the catalog — can’t be installed",
      stale: "the build keeps an older version",
      unsigned: "not signed with the catalog key, a newer Astral is needed",
      "no-package": "no verified install package",
      "release-mismatch":
        "the catalog issued a different version than the build keeps",
      loader: "the safe mods loader is not set up",
      unavailable: "the package can’t be fetched right now",
    },
  },
  de: {
    quotes: ["„", "“"],
    andMore: "und",
    head: (build) => `Die Sammlung ${build} lässt sich nicht installieren`,
    conflict: (first, second) =>
      `${first} und ${second} ändern dasselbe im Spiel`,
    unpick:
      "Entferne das Häkchen im Sammlungsfenster — der Rest wird installiert.",
    repair:
      "Prüfe die Spieldateien und versuche es erneut — oder entferne das Häkchen im Sammlungsfenster, der Rest wird installiert.",
    missingTitle: "Mod nicht gefunden",
    reasons: {
      missing: "aus dem Katalog entfernt — nicht installierbar",
      stale: "die Sammlung enthält eine ältere Version",
      unsigned:
        "nicht mit dem Katalogschlüssel signiert, eine neuere Astral-Version ist nötig",
      "no-package": "kein geprüftes Installationspaket",
      "release-mismatch":
        "der Katalog lieferte eine andere Version als die in der Sammlung",
      loader: "der sichere mods-Loader ist nicht eingerichtet",
      unavailable: "das Paket ist gerade nicht abrufbar",
    },
  },
  pl: {
    quotes: ["„", "”"],
    andMore: "i jeszcze",
    head: (build) => `Nie można zainstalować zestawu ${build}`,
    conflict: (first, second) =>
      `${first} i ${second} zmieniają to samo w grze`,
    unpick: "Odznacz w oknie zestawu — reszta się zainstaluje.",
    repair:
      "Sprawdź integralność plików gry i spróbuj ponownie — albo odznacz w oknie zestawu, reszta się zainstaluje.",
    missingTitle: "Nie znaleziono moda",
    reasons: {
      missing: "usunięty z katalogu — nie da się zainstalować",
      stale: "zestaw zawiera poprzednią wersję",
      unsigned: "bez podpisu kluczem katalogu, potrzebna nowsza wersja Astral",
      "no-package": "brak zweryfikowanego pakietu instalacyjnego",
      "release-mismatch": "katalog wydał inną wersję niż zapisana w zestawie",
      loader: "bezpieczny loader mods nie jest skonfigurowany",
      unavailable: "pakietu nie da się teraz pobrać",
    },
  },
  fr: {
    quotes: ["«\u00a0", "\u00a0»"],
    andMore: "et",
    head: (build) => `Le build ${build} ne peut pas être installé`,
    conflict: (first, second) =>
      `${first} et ${second} modifient la même chose dans le jeu`,
    unpick: "Décochez-le dans la fenêtre du build — le reste sera installé.",
    repair:
      "Vérifiez l’intégrité des fichiers du jeu et réessayez — ou décochez-le dans la fenêtre du build, le reste sera installé.",
    missingTitle: "Mod introuvable",
    reasons: {
      missing: "supprimé du catalogue — installation impossible",
      stale: "le build contient une ancienne version",
      unsigned:
        "non signé avec la clé du catalogue, une version plus récente d’Astral est nécessaire",
      "no-package": "aucun paquet d’installation vérifié",
      "release-mismatch":
        "le catalogue a fourni une autre version que celle enregistrée dans le build",
      loader: "le chargeur sécurisé mods n’est pas configuré",
      unavailable: "le paquet est indisponible pour le moment",
    },
  },
};

function copyFor(language) {
  const lang = COPY[language] ? language : "en";
  return { lang, copy: COPY[lang] };
}

/* Причина одного мода: ключ плана, а для отказа сервера или движка — его
   семья (сеть, запущенная игра, место на диске), если она узнаваема. */
function reasonOf(entry, language) {
  const { copy } = copyFor(language);
  if (entry.reason === "unavailable" && entry.failure) {
    const failure = describeInstallFailure(entry.failure, language);
    if (failure && failure.kind !== "unknown") return failure.reason;
  }
  return copy.reasons[entry.reason] || copy.reasons.unavailable;
}

/* Отказ про файлы игры (проверка перед установкой нашла, что пакет не сходится с архивом): снять отметку мало, сначала — вернуть файлы игры в порядок. */
const GAME_FILE_KINDS = new Set([
  "game-entry-present",
  "game-entry-conflict",
  "game-file-missing",
]);

function blamesGameFiles(entry, language) {
  if (entry.reason !== "unavailable" || !entry.failure) return false;
  const failure = describeInstallFailure(entry.failure, language);
  return Boolean(failure) && GAME_FILE_KINDS.has(failure.kind);
}

/**
 * Причина под строкой мода в окне сборки; пустая строка — мод встанет.
 *
 * @param {string} reason ключ из `knownBlockReason`
 * @param {string} language
 */
export function blockReasonText(reason, language) {
  return reason ? copyFor(language).copy.reasons[reason] || "" : "";
}

/** Заголовок строки мода, которого больше нет в каталоге. */
export function missingModTitle(language) {
  return copyFor(language).copy.missingTitle;
}

/**
 * Всплывашка об отказе сборки: сборка, моды по причинам и что делать.
 *
 * @param {{ build: string, blocked: object[], internalConflicts: object[] }} plan
 * @param {string} language
 */
export function buildBlockedNotice(
  { build, blocked = [], internalConflicts = [] },
  language,
) {
  const { lang, copy } = copyFor(language);
  const [open, close] = copy.quotes;
  const quote = (name) => `${open}${name}${close}`;
  const groups = new Map();
  for (const entry of blocked) {
    const reason = reasonOf(entry, lang);
    groups.set(reason, [...(groups.get(reason) || []), entry]);
  }
  const parts = [...groups].map(
    ([reason, mods]) =>
      `${modList(lang, mods, copy.andMore, copy.quotes)} — ${reason}`,
  );
  if (!parts.length && internalConflicts.length) {
    const [{ first, second }] = internalConflicts;
    parts.push(copy.conflict(quote(first.name), quote(second.name)));
  }
  const next = blocked.some((entry) => blamesGameFiles(entry, lang))
    ? copy.repair
    : copy.unpick;
  return `${copy.head(quote(build))}: ${parts.join("; ")}. ${next}`;
}
