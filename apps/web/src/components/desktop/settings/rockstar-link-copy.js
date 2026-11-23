/*
 * Строка-ссылка в разделе «Настройки › GTA V» (14.11.2026): у копии из
 * Rockstar Games Launcher и у второй папки игры вместо прежнего большого
 * раздела — одна строка, ведущая на вкладку «Rockstar Games». Отдельный
 * маленький файл: раздел «GTA V» грузится раньше вкладки, и тексты самой
 * вкладки (`rockstar-panel-copy.js`) тянуть за собой ему незачем.
 *
 * Ключ → [ru, uk, en, de, pl, fr].
 */

const ORDER = ["ru", "uk", "en", "de", "pl", "fr"];

const LINK_TEXT = {
  linkTitle: [
    "Rockstar Games Launcher",
    "Rockstar Games Launcher",
    "Rockstar Games Launcher",
    "Rockstar Games Launcher",
    "Rockstar Games Launcher",
    "Rockstar Games Launcher",
  ],
  linkNote: [
    "Как моды переживают проверку лаунчера — на вкладке «Rockstar Games»",
    "Як моди переживають перевірку лаунчера — на вкладці «Rockstar Games»",
    "How mods survive the launcher's check — on the “Rockstar Games” tab",
    "Wie Mods die Prüfung des Launchers überstehen — im Reiter „Rockstar Games“",
    "Jak mody przetrwają sprawdzanie launchera — na karcie „Rockstar Games”",
    "Comment les mods survivent à la vérification du launcher — dans l'onglet «\u00a0Rockstar Games\u00a0»",
  ],
  linkOpen: ["Открыть", "Відкрити", "Open", "Öffnen", "Otwórz", "Ouvrir"],
};

/** Строки ссылки на языке (`ru`, `uk`, `en`, `de`, `pl`, `fr`; иначе английский). */
export function rockstarLinkCopyFor(language) {
  const index = ORDER.indexOf(language);
  return Object.fromEntries(
    Object.entries(LINK_TEXT).map(([key, values]) => [
      key,
      values[index < 0 ? 2 : index],
    ]),
  );
}
