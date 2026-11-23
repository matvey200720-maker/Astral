/* Адрес сайта облака (сборка под другое облако переназначает его переменной окружения, как у ссылки на мод — `ModShareLink.jsx`). */
const SITE_ORIGIN =
  import.meta.env?.VITE_MODOVIK_SITE_URL || "https://astral-mods.online";

/** Профиль человека на сайте: там меняют имя и привязывают Discord. */
export const siteProfileUrl = (origin = SITE_ORIGIN) =>
  new URL("/profile", origin).toString();
