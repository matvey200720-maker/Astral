/*
 * Обложки редакторов — что у какой плитки вместо картинки.
 *
 * Плитка редактора показывала чужой снимок: у «Большой карты» висел постер
 * чужого редукса, у «Эффектов попадания» и «Килл-эффекта» — один и тот же
 * кадр с огнём на голове, у «Огня и взрывов» — яхта. Человек не видел на
 * плитке ни того, что редактор правит, ни того, что у него уже стоит в игре.
 *
 * Обложка — сама вещь, нарисованная тем же кодом, что и предпросмотр в
 * редакторе: мини-карта с полосами, карта паузы, силуэт с брызгами, след
 * пули, метка залаза. Пока человек ничего не ставил, вещь стандартная — как
 * в игре; поставил своё — обложка показывает его работу.
 *
 * Этот файл лёгкий нарочно: полка каталога спрашивает у него только «есть ли
 * у слота обложка», а сами рисователи приезжают отдельными кусками
 * (`EditorCover.jsx`) — карта паузы и кодек листов эффектов стартовому куску
 * каталога ни к чему.
 */

/* Слот плитки → вид обложки. Уточняющие плитки карт ведут в тот же редактор
   и показывают ту же вещь. */
const COVER_KIND_BY_SLOT = Object.freeze({
  minimap: "minimap",
  "minimap-zoom": "minimap",
  "minimap-position": "minimap",
  "large-map": "world-map",
  "large-map-zoom": "world-map",
  "hit-effects": "impact",
  tracers: "tracer",
  "kill-effects": "kill-effect",
  "screen-hits": "screen-hits",
  blips: "gps",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  "target-hp": "target-hp",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "group-markers": "group-markers",
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  "wheel-smoke": "wheel-smoke",
  "fire-explosions": "fire",
  crosshair: "reticle",
  timecycle: "sky",
  lights: "lamps",
  climbing: "climbs",
  wallbang: "wallbang",
  /* «Животные» (05.11.2026): штатная обложка — кабан из файлов игры, снят с предпросмотра редактора. */
  animals: "animals",
  "forbidden-zones": "zones",
  factory: "factory",
  hangar: "hangar",
  mapping: "mapping",
  water: "water",
  vegetation: "vegetation",
  arenas: "arenas",
  "mega-mall": "megamall",
  ashan: "youtool",
  vinewood: "vinewood",
  busstops: "busstops",
  "msl-zones": "mslzones",
  "float-logo": "floatlogo",
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: "airships",
  shops: "shops",
  billboards: "billboards",
  banners: "banners",
  "capt-zones": "captzones",
  schedule: "schedule",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "flags",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "atms",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  "project-interiors": "projectinteriors",
  /* «Интерьеры Majestic RP» (25.10.2026). */
  "majestic-interiors": "majesticinteriors",
  roads: "roads",
  fonts: "fonts",
  sounds: "sound",
  /* Звук в библиотеке — по карточкам: стволы и попадания в голову и тело.
     У каждой — знак звука: ствол на карточке «Звуков оружия» читался как
     оружие, а не как его звук (владелец, 26.09.2026), а какая именно
     вещь стоит, говорит подпись карточки. */
  "weapon-sounds": "sound",
  "hit-sounds": "sound",
  "hit-sounds-head": "sound",
  "hit-sounds-body": "sound",
  /* Окружение студии звуков — тот же динамик (ТЗ 17.10.2026, задача 5). */
  "ambient-noise": "sound",
});

/** Вид обложки слота или `null`, если обложку рисовать нечем. */
export const editorCoverKind = (slotId) =>
  COVER_KIND_BY_SLOT[String(slotId || "")] || null;

export const hasEditorCover = (slotId) => Boolean(editorCoverKind(slotId));

/** Первый слот каждого вида — по нему печь греет обложки полки после запуска. */
export const COVER_SLOT_PER_KIND = Object.freeze(
  Object.entries(COVER_KIND_BY_SLOT).reduce((slots, [slotId, kind]) => {
    if (!slots[kind]) slots[kind] = slotId;
    return slots;
  }, {}),
);
