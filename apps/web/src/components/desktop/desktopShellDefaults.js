import { withStoredWorks } from "../../features/builds/build-works-store.js";

export const covers = [
  "/media/gta-city-night.jpg",
  "/media/gta-hero.jpg",
  "/media/gta-vista.jpg",
  "/media/gta-night-drive.jpg",
  "/media/gta-car.jpg",
  "/media/gta-pursuit.jpg",
];

export { cloudCatalogIDPattern } from "../../catalog-utils.js";

export const localDeveloperAccount = Object.freeze({
  id: "019fe8aa-0000-7000-8000-000000000001",
  name: "Astral Developer",
  displayName: "Astral Developer",
  email: "developer@astral.local",
  role: "developer",
});

export const localFirstRunQaAccount = Object.freeze({
  id: "019febfb-0000-7000-8000-000000000001",
  name: "Astral Local Admin",
  displayName: "Astral Local Admin",
  email: "admin@astral.local",
  role: "admin",
});

/*
 * Сообщество Astral (ТЗ 05.10, задача 9): Discord-сервер и Telegram-канал
 * @astralmodsss. Сборку под другое сообщество переназначают переменными
 * окружения, не правкой кода.
 */
export const communityLinks = {
  discord:
    import.meta.env.VITE_MODOVIK_DISCORD_URL || "https://discord.gg/H78q7hwbZU",
  telegram:
    import.meta.env.VITE_MODOVIK_TELEGRAM_URL || "https://t.me/astralmodsss",
};

/* Имя канала для подсказки рядом с ссылкой: «@astralmodsss». */
export function telegramHandle(url) {
  const match = /^https?:\/\/t\.me\/([A-Za-z0-9_]{3,})\/?$/.exec(
    String(url || ""),
  );
  return match ? `@${match[1]}` : "";
}

/* Наборы с дальними копиями плашек: имена для всплывашки, переводятся при показе. */
export const FAR_PLATE_WORK_NAMES = Object.freeze({
  factory: "Завод",
  hangar: "Ангар",
  mapping: "Маппинг",
  arenas: "Арена",
  megamall: "Мегамолл",
  youtool: "Ашан / Икея",
});

function defaultLocalProfiles() {
  return [
    {
      id: "majestic",
      name: "Majestic · Main",
      code: "MDVK-MAJESTIC-7Q2F",
      modIds: [],
    },
    {
      id: "light",
      name: "GTA 5 RP · Light",
      code: "MDVK-5RP-LIGHT",
      modIds: [],
    },
  ];
}
export function readStoredLocalProfiles() {
  try {
    const saved = JSON.parse(localStorage.getItem("modovik-builds") || "null");
    if (Array.isArray(saved)) return withStoredWorks(saved);
  } catch {}
  return defaultLocalProfiles();
}
