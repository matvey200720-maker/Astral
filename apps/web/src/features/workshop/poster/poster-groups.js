/*
 * «Афиша редакторов» (дизайн 15.11.2026, мастерская A): полка редакторов собрана по группам.
 *
 * В коде полка плоская — порядок закреплён в `workshop-redux-display.js`. Группы — подписи над частями этой же полки: слот попадает в
 * группу по своему id, незнакомый — в последнюю («Ещё»). Порядок плиток внутри группы — порядок полки; новый редактор встаёт в конец
 * группы и при шестой плитке уходит на следующий ряд сетки (листания вбок нет, решение владельца 15.11.2026).
 */

import {
  Buildings,
  Fire,
  Hexagon,
  MapTrifold,
  Signpost,
  SpeakerHigh,
  Sparkle,
  Sun,
} from "../../../components/ui/icons.jsx";

/** Группы по порядку показа: id, подпись-ключ словаря (русская строка) и знак. */
export const POSTER_GROUPS = Object.freeze([
  { id: "hud", label: "Карта и экран", Icon: MapTrifold },
  { id: "fx", label: "Эффекты", Icon: Fire },
  { id: "nature", label: "Небо и природа", Icon: Sun },
  { id: "buildings", label: "Здания и места", Icon: Buildings },
  { id: "city", label: "Улицы и город", Icon: Signpost },
  { id: "capt", label: "Капты", Icon: Hexagon },
  { id: "sound", label: "Звук", Icon: SpeakerHigh },
  { id: "other", label: "Ещё", Icon: Sparkle },
]);

const GROUP_OF_SLOT = Object.freeze({
  minimap: "hud",
  "large-map": "hud",
  crosshair: "hud",
  "target-hp": "hud",
  fonts: "hud",

  "hit-effects": "fx",
  tracers: "fx",
  "kill-effects": "fx",
  "fire-explosions": "fx",
  "wheel-smoke": "fx",
  /* «Эффекты попадания на экране» — к эффектам, фонари — в «Улицы и город», «Прострелы» — в «Капты» (владелец, 26.11.2026). */
  "screen-hits": "fx",

  timecycle: "nature",
  water: "nature",
  vegetation: "nature",
  roads: "nature",
  animals: "nature",

  arenas: "buildings",
  "mega-mall": "buildings",
  ashan: "buildings",
  shops: "buildings",
  "project-interiors": "buildings",
  "majestic-interiors": "buildings",
  factory: "buildings",
  hangar: "buildings",
  mapping: "buildings",

  /* Метки игры в мире стоят в «Улицах и городе»: в «Карте и экране» их пять, как в макете, и шрифты не висят шестой плиткой одни в ряду. */
  "group-markers": "city",
  lights: "city",
  vinewood: "city",
  busstops: "city",
  billboards: "city",
  banners: "city",
  schedule: "city",
  flags: "city",
  atms: "city",
  "float-logo": "city",
  airships: "city",

  climbing: "capt",
  wallbang: "capt",
  "forbidden-zones": "capt",
  "capt-zones": "capt",
  "msl-zones": "capt",

  sounds: "sound",
});

/** Группа слота; незнакомый слот — «Ещё». */
export function posterGroupOf(slotId) {
  return GROUP_OF_SLOT[slotId] || "other";
}

/** Плитки полки по группам: порядок групп — как в `POSTER_GROUPS`, порядок плиток — как на полке; пустые группы не возвращаются. */
export function groupPosterEntries(entries) {
  const buckets = new Map(POSTER_GROUPS.map((group) => [group.id, []]));
  for (const entry of entries)
    buckets.get(posterGroupOf(entry.slot.id)).push(entry);
  return POSTER_GROUPS.filter((group) => buckets.get(group.id).length > 0).map(
    (group) => ({
      ...group,
      entries: buckets.get(group.id),
    }),
  );
}

/* Редактор → экскурсия по нему (`components/ui/editor-tours.js`): названия её панелей — то, что в редакторе можно менять. */
const TOUR_OF_SLOT = Object.freeze({
  minimap: "minimap",
  "large-map": "world-map",
  crosshair: "reticle",
  "target-hp": "target-hp",
  "group-markers": "group-markers",
  fonts: "fonts",
  "hit-effects": "effects-impact",
  tracers: "effects-tracer",
  "kill-effects": "kill-effect",
  "fire-explosions": "effects-environment",
  "wheel-smoke": "wheel-smoke",
  "screen-hits": "screen-hits",
  timecycle: "timecycle",
  lights: "lamps",
  wallbang: "wallbang",
  "forbidden-zones": "zones",
  "capt-zones": "captzones",
  water: "water",
  vegetation: "vegetation",
  factory: "factory",
  hangar: "hangar",
  mapping: "mapping",
  arenas: "arena",
  "mega-mall": "megamall",
  ashan: "megamall",
  shops: "shops",
  "project-interiors": "projectinteriors",
  "majestic-interiors": "majesticinteriors",
  vinewood: "vinewood",
  busstops: "busstops",
  billboards: "billboards",
  banners: "banners",
  schedule: "schedule",
  flags: "flags",
  atms: "atms",
  "msl-zones": "mslzones",
  "float-logo": "floatlogo",
  airships: "airships",
  roads: "roads",
  climbing: "climbs",
  sounds: "sound-studio",
});

const NOT_A_PANEL = new Set(["frame", "apply", "templates"]);

/** «Что можно менять» в редакторе: заголовки панелей его экскурсии (русские строки словаря), не больше `limit`. */
export function posterChipsOf(slotId, tours, limit = 3) {
  const steps = tours?.[TOUR_OF_SLOT[slotId]];
  if (!Array.isArray(steps)) return [];
  const titles = [];
  for (const step of steps) {
    if (NOT_A_PANEL.has(step.id) || !step.title || titles.includes(step.title))
      continue;
    titles.push(step.title);
    if (titles.length >= limit) break;
  }
  return titles;
}

/** Сколько групп с одним редактором встаёт в один ряд сетки (каждая — одна колонка, плитка как у соседних групп). */
export const POSTER_SINGLES_PER_ROW = 5;
