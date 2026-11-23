import { workshopPreviewFor } from "../../../workshop-visuals.js";

/*
 * Разделы публичного каталога, у которых есть свой редактор в мастерской.
 *
 * Каталог показывает только опубликованные пакеты, и пока в «Интерфейсе»
 * никто ничего не опубликовал, вкладка «Прицелы» была тупиком: серое имя в
 * навигации и «пока нет модификаций». При этом прицел, мини-карту и большую
 * карту человек собирает сам в мастерской — и ставит в игру так же, как мод
 * из каталога. Поэтому пустой раздел ведёт не в никуда, а к редактору.
 *
 * Ключи подразделов — подписи из catalogSections.js: они и есть идентификатор
 * подраздела в каталоге, другого у него нет. Маршрут стоит только там, где
 * за ним есть редактор из реестра `features/workshop/useWorkshopEditors.jsx`:
 * HUD, звуки, интерьеры и фонари в мастерской теперь каталожные карточки,
 * и «собрать самому» они больше не обещают.
 */
const INTERFACE_ROUTES = Object.freeze({
  "Мини-карты": ["minimap"],
  Прицелы: ["crosshair"],
  "Снайперские прицелы": ["sniper-crosshair"],
  "Большая карта": ["large-map"],
});
const EFFECT_ROUTES = Object.freeze({
  Трейсеры: ["tracers"],
  Попадания: ["hit-effects"],
  Погода: ["timecycle"],
});
const ROUTES = Object.freeze({
  interface: INTERFACE_ROUTES,
  effects: EFFECT_ROUTES,
  /* «Для редуксов» (вечер 15.10) — подразделы по редакторам мастерской
     (`redux-editors.js`): ключ — редактор полки, а не подпись. Пустой
     подраздел ведёт к своему редактору. */
  "for-redux": Object.freeze({
    minimap: ["minimap"],
    crosshair: ["crosshair", "sniper-crosshair"],
    "large-map": ["large-map"],
    tracers: ["tracers"],
    "hit-effects": ["hit-effects"],
    timecycle: ["timecycle"],
  }),
});

const CARDS = Object.freeze({
  crosshair: {
    ru: ["Прицел", "Обычный и снайперский прицел"],
    uk: ["Приціл", "Звичайний і снайперський приціл"],
    en: ["Crosshair", "Standard and sniper crosshair"],
    de: ["Fadenkreuz", "Normales und Sniper-Fadenkreuz"],
    pl: ["Celownik", "Zwykły i snajperski celownik"],
    fr: ["Réticule", "Réticule normal et de sniper"],
  },
  "sniper-crosshair": {
    ru: ["Прицел на снайперку", "Сетка и оформление снайперского прицела"],
    uk: ["Приціл на снайперку", "Сітка й оформлення снайперського приціла"],
    en: ["Sniper scope", "Reticle and styling for sniper scopes"],
    de: ["Zielfernrohr", "Absehen und Gestaltung des Zielfernrohrs"],
    pl: ["Luneta snajperska", "Siatka i wygląd lunety snajperskiej"],
    fr: ["Réticule de sniper", "Grille et habillage du réticule de sniper"],
  },
  minimap: {
    ru: ["Мини-карта", "Форма, отдаление и положение мини-карты"],
    uk: ["Мінікарта", "Форма, віддалення й положення мінікарти"],
    en: ["Minimap", "Shape, zoom and position of the minimap"],
    de: ["Minikarte", "Form, Zoom und Position der Minikarte"],
    pl: ["Minimapa", "Kształt, oddalenie i położenie minimapy"],
    fr: ["Minicarte", "Forme, zoom et position de la minicarte"],
    cover: "/media/redux/minimap.png",
  },
  "large-map": {
    ru: ["Большая карта", "Значки, зоны и подложка карты паузы"],
    uk: ["Велика карта", "Значки, зони й підкладка карти паузи"],
    en: ["World map", "Icons, zones and the pause-map backdrop"],
    de: ["Große Karte", "Symbole, Zonen und Hintergrund der Pausenkarte"],
    pl: ["Duża mapa", "Ikony, strefy i tło mapy pauzy"],
    fr: ["Grande carte", "Icônes, zones et fond de la carte de pause"],
  },
  tracers: {
    ru: ["Трейсеры", "Цвет и след пуль"],
    uk: ["Трасери", "Колір і слід куль"],
    en: ["Tracers", "Bullet color and trail"],
    de: ["Leuchtspuren", "Farbe und Spur der Kugeln"],
    pl: ["Smugacze", "Kolor i ślad pocisków"],
    fr: ["Traceurs", "Couleur et trajectoire des balles"],
  },
  "hit-effects": {
    ru: ["Эффекты попадания", "Кровь и брызги по зонам попадания"],
    uk: ["Ефекти влучання", "Кров і бризки за зонами влучання"],
    en: ["Hit effects", "Blood and spray by hit zone"],
    de: ["Treffereffekte", "Blut und Spritzer nach Trefferzone"],
    pl: ["Efekty trafienia", "Krew i rozbryzgi według stref trafienia"],
    fr: ["Effets d'impact", "Sang et éclaboussures selon la zone touchée"],
  },
  timecycle: {
    ru: ["Таймциклы", "Погода, небо и свет времени суток"],
    uk: ["Таймцикли", "Погода, небо й світло пори доби"],
    en: ["Timecycles", "Weather, sky and light of the day"],
    de: ["Timecycles", "Wetter, Himmel und Licht der Tageszeit"],
    pl: ["Timecycle", "Pogoda, niebo i światło pory dnia"],
    fr: ["Timecycles", "Météo, ciel et lumière selon l'heure du jour"],
  },
});

function card(slot, locale) {
  const copy = CARDS[slot]?.[locale] || CARDS[slot]?.en;
  return {
    slot,
    title: copy?.[0] || slot,
    description: copy?.[1] || "",
    cover: CARDS[slot]?.cover || workshopPreviewFor("redux", slot),
  };
}

/* «Мини-карта, прицел и HUD»: в перечислении строчная буква, кроме
   аббревиатур — «hud» читалось бы как опечатка. */
export function routeListLabel(routes, and = "и") {
  const names = routes.map(({ title }) =>
    title === title.toUpperCase()
      ? title
      : title[0].toLowerCase() + title.slice(1),
  );
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
}

/** Есть ли у раздела каталога хоть один редактор в мастерской. */
export function catalogHasWorkshopRoutes(categoryId) {
  return Boolean(ROUTES[categoryId]);
}

/**
 * Карточки «собрать в мастерской» для раздела или подраздела каталога.
 * Подраздел без редактора и чужой раздел дают пустой список: там тупика
 * нет, там просто нечего предлагать.
 */
export function workshopRoutesFor(categoryId, subcategory = "", locale = "ru") {
  const category = ROUTES[categoryId];
  if (!category) return [];
  if (subcategory)
    return (Object.hasOwn(category, subcategory) ? category[subcategory] : []).map(
      (slot) => card(slot, locale),
    );
  const seen = new Set();
  return Object.values(category)
    .flat()
    .filter((slot) => !seen.has(slot) && seen.add(slot))
    .map((slot) => card(slot, locale));
}
