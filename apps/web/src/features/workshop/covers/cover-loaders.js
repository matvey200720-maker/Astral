import React from "react";
import { WEB_BUILD } from "./web-build.js";

/*
 * Рисователи обложек — по виду, каждый своим куском.
 *
 * Каждый вид обложки — свой кусок: мини-карта тянет разметку радара, большая
 * карта — свою подложку, эффекты — генератор листов. Полке нужны все разом,
 * но платить за них стартовому куску каталога незачем, поэтому каждый
 * рисователь грузится лениво. Один список на полку (`EditorCover.jsx`) и на
 * печь обложек (`cover-oven.jsx`).
 */
const LOADERS = Object.freeze({
  minimap: () => import("./MinimapCover.jsx"),
  "world-map": () => import("./WorldMapCover.jsx"),
  impact: () => import("./ImpactCover.jsx"),
  tracer: () => import("./TracerCover.jsx"),
  "kill-effect": () => import("./KillEffectCover.jsx"),
  "screen-hits": () => import("./ScreenHitsCover.jsx"),
  gps: () => import("./GpsCover.jsx"),
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  "target-hp": () => import("./TargetHpCover.jsx"),
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "group-markers": () => import("./GroupMarkersCover.jsx"),
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  "wheel-smoke": () => import("./WheelSmokeCover.jsx"),
  fire: () => import("./FireCover.jsx"),
  reticle: () => import("./ReticleCover.jsx"),
  sky: () => import("./SkyCover.jsx"),
  lamps: () => import("./LampCover.jsx"),
  climbs: () => import("./ClimbsCover.jsx"),
  wallbang: () => import("./WallbangCover.jsx"),
  zones: () => import("./ZonesCover.jsx"),
  factory: () => import("./FactoryCover.jsx"),
  hangar: () => import("./HangarCover.jsx"),
  mapping: () => import("./MappingCover.jsx"),
  water: () => import("./WaterCover.jsx"),
  vegetation: () => import("./VegetationCover.jsx"),
  arenas: () => import("./ArenaCover.jsx"),
  megamall: () => import("./BuildingCover.jsx"),
  youtool: () => import("./BuildingCover.jsx"),
  vinewood: () => import("./VinewoodCover.jsx"),
  busstops: () => import("./BusStopsCover.jsx"),
  mslzones: () => import("./MslZonesCover.jsx"),
  floatlogo: () => import("./FloatLogoCover.jsx"),
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: () => import("./AirshipsCover.jsx"),
  shops: () => import("./ShopsCover.jsx"),
  billboards: () => import("./BillboardsCover.jsx"),
  banners: () => import("./BannersCover.jsx"),
  captzones: () => import("./CaptZonesCover.jsx"),
  schedule: () => import("./ScheduleCover.jsx"),
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: () => import("./FlagsCover.jsx"),
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: () => import("./AtmsCover.jsx"),
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  projectinteriors: () => import("./ProjectInteriorsCover.jsx"),
  /* «Интерьеры Majestic RP» (25.10.2026). */
  majesticinteriors: () => import("./MajesticInteriorsCover.jsx"),
  roads: () => import("./RoadsCover.jsx"),
  fonts: () => import("./FontsCover.jsx"),
  sound: () => import("./SoundCover.jsx"),
  /* «Животные» (05.11.2026): штатная картинка — стандартный кабан; без рисователя в списке плитка оставалась пустой. */
  animals: () => import("./AnimalsCover.jsx"),
});

const lazies = new Map();

/** Ленивый компонент обложки вида или `null`. */
export function coverComponent(kind) {
  const load = LOADERS[kind];
  if (!load) return null;
  if (!lazies.has(kind)) lazies.set(kind, React.lazy(load));
  return lazies.get(kind);
}

/*
 * Отпечаток кода рисователя — для ключа готовой картинки.
 *
 * В сборке загрузчик вида — `() => import("./MinimapCover-<хеш>.js")`: хеш
 * куска меняется с его кодом и с кодом всего, что он тянет (имена кусков
 * зависимостей входят в его текст). Поменяли рисователь — у его обложек другой
 * ключ, и печь снимает их заново; соседние виды остаются готовыми. В режиме
 * разработки хешей нет — `null`: готовые картинки там живут только до
 * перезагрузки окна, иначе правка обложки не была бы видна.
 */
const stamps = new Map();

/** Отпечаток по тексту загрузчика: имена кусков сборки, или `null` (режим разработки, закрытый код). */
export function stampFromSource(source) {
  const chunks = String(source || "").match(/[\w.-]+-[\w-]{8}\.js/g);
  return chunks?.length ? chunks.join("+") : null;
}

/** Отпечаток по имени кусков, а если закрытие их спрятало, — по номеру сборки; в разработке `null`. */
export function stampOrBuild(source, build = WEB_BUILD) {
  return stampFromSource(source) ?? (build ? `build-${build}` : null);
}

/* Отпечатки, посчитанные при сборке (`cover-stamps-plugin.js`): закрытие JS их не прячет, и выпуск без правок
   рисователя обложки не сбрасывает. Нет таблицы (разработка, тесты, старая сборка) — по тексту загрузчика. */
export const builtCoverStamp = (kind, table = globalThis.__ASTRAL_COVER_STAMPS__) =>
  (table && typeof table[kind] === "string" && table[kind]) || null;

export function coverCodeStamp(kind) {
  if (stamps.has(kind)) return stamps.get(kind);
  const stamp = builtCoverStamp(kind) ?? stampOrBuild(LOADERS[kind]);
  stamps.set(kind, stamp);
  return stamp;
}
