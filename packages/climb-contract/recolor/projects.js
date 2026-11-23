/*
 * Договоры работ наборов перекраски одной таблицей.
 *
 * Редактор, «Мои работы», код для друга и установщик спрашивают у набора
 * одно и то же: пустая работа, разбор, порядок, строка для хранилища,
 * отпечаток для очереди «Применить» и «как в моде» ли она. Таблица —
 * чтобы пятый набор добавлялся строкой, а не правкой четырёх мест.
 */

import {
  applyVinewoodStandard,
  createVinewoodProject,
  normalizeVinewoodProject,
  parseVinewoodProject,
  resetVinewoodProject,
  serializeVinewoodProject,
  shareableVinewoodProject,
  vinewoodLostInCode,
  vinewoodWorkIsStock,
  vinewoodWorkSignature,
} from "./vinewood.js";
import {
  applyBusStopsStandard,
  busStopsLostInCode,
  busStopsProjectIsStock,
  busStopsProjectSignature,
  createBusStopsProject,
  normalizeBusStopsProject,
  parseBusStopsProject,
  resetBusStopsProject,
  serializeBusStopsProject,
  shareableBusStopsProject,
} from "./busstops.js";
import {
  applyRoadsStandard,
  createRoadsProject,
  normalizeRoadsProject,
  parseRoadsProject,
  resetRoadsProject,
  roadsLostInCode,
  roadsProjectIsStock,
  roadsProjectSignature,
  serializeRoadsProject,
  shareableRoadsProject,
} from "./roads.js";
import {
  applyArenasStandard,
  arenasLostInCode,
  arenasProjectIsMod,
  arenasProjectIsStock,
  arenasProjectSignature,
  createArenasProject,
  normalizeArenasProject,
  parseArenasProject,
  resetArenasServer,
  serializeArenasProject,
  shareableArenasProject,
} from "./arenas.js";
import { settleBlankFinishes } from "./finish.js";
import {
  BUILDING_SET_IDS,
  applyBuildingStandard,
  buildingLostInCode,
  buildingProjectIsStock,
  buildingProjectSignature,
  createBuildingProject,
  normalizeBuildingProject,
  parseBuildingProject,
  resetBuildingProject,
  serializeBuildingProject,
  shareableBuildingProject,
} from "./buildings.js";
import {
  createFactoryStartProject,
  factoryLostInCode,
  factoryProjectIsMod,
  factoryProjectIsStandard,
  factoryProjectSignature,
  normalizeFactoryProject,
  parseFactoryProject,
  serializeFactoryProject,
  shareableFactoryProject,
} from "./factory.js";
import {
  createFontsProject,
  fontsLostInCode,
  fontsProjectIsVanilla,
  fontsProjectSignature,
  normalizeFontsProject,
  parseFontsProject,
  serializeFontsProject,
  shareableFontsProject,
} from "./fonts.js";
import {
  applyHangarStandard,
  createHangarProject,
  hangarLostInCode,
  hangarProjectIsStock,
  hangarProjectSignature,
  normalizeHangarProject,
  parseHangarProject,
  resetHangarProject,
  serializeHangarProject,
  shareableHangarProject,
} from "./hangar.js";
import {
  createMappingProject,
  mappingLostInCode,
  mappingProjectIsMod,
  mappingProjectIsStock,
  mappingProjectSignature,
  normalizeMappingProject,
  parseMappingProject,
  serializeMappingProject,
  shareableMappingProject,
} from "./mapping.js";
import {
  createVegetationProject,
  normalizeVegetationProject,
  parseVegetationProject,
  serializeVegetationProject,
  shareableVegetationProject,
  vegetationLostInCode,
  vegetationProjectIsVanilla,
  vegetationProjectSignature,
} from "./vegetation.js";
import {
  createWaterProject,
  normalizeWaterProject,
  parseWaterProject,
  serializeWaterProject,
  waterProjectIsVanilla,
  waterProjectSignature,
} from "./water.js";
import {
  createZonesProject,
  normalizeZonesProject,
  parseZonesProject,
  serializeZonesProject,
  zonesProjectIsMod,
  zonesProjectSignature,
} from "./zones.js";
import {
  createMslZonesProject,
  mslZonesIsMod,
  mslZonesSignature,
  normalizeMslZonesProject,
  parseMslZonesProject,
  serializeMslZonesProject,
} from "./msl-zones.js";
import {
  airshipsIsStock,
  airshipsLostInCode,
  airshipsSignature,
  applyAirshipsStandard,
  createAirshipsProject,
  normalizeAirshipsProject,
  parseAirshipsProject,
  resetAirshipsProject,
  serializeAirshipsProject,
  shareableAirshipsProject,
} from "./airships.js";
import {
  applyFloatLogoStandard,
  createFloatLogoProject,
  floatLogoIsStock,
  floatLogoLostInCode,
  floatLogoSignature,
  normalizeFloatLogoProject,
  parseFloatLogoProject,
  resetFloatLogoProject,
  serializeFloatLogoProject,
  shareableFloatLogoProject,
} from "./float-logo.js";
import {
  applyShopsStandard,
  createShopsProject,
  normalizeShopsProject,
  parseShopsProject,
  resetShopsProject,
  serializeShopsProject,
  shareableShopsProject,
  shopsLostInCode,
  shopsProjectIsStock,
  shopsProjectSignature,
} from "./shops.js";
import {
  applyProjectInteriorsStandard,
  createProjectInteriors,
  normalizeProjectInteriors,
  parseProjectInteriors,
  projectInteriorsIsStock,
  projectInteriorsLostInCode,
  projectInteriorsSignature,
  resetProjectInteriors,
  serializeProjectInteriors,
  shareableProjectInteriors,
} from "./project-interiors.js";
import {
  applyMajesticInteriorsStandard,
  createMajesticInteriors,
  majesticInteriorsIsStock,
  majesticInteriorsLostInCode,
  majesticInteriorsSignature,
  normalizeMajesticInteriors,
  parseMajesticInteriors,
  resetMajesticInteriors,
  serializeMajesticInteriors,
  shareableMajesticInteriors,
} from "./majestic-interiors-project.js";
import {
  applyBillboardsStandard,
  billboardsLostInCode,
  billboardsProjectIsStock,
  billboardsProjectSignature,
  createBillboardsProject,
  normalizeBillboardsProject,
  parseBillboardsProject,
  resetBillboardsProject,
  serializeBillboardsProject,
  shareableBillboardsProject,
} from "./billboards.js";
import {
  applyCaptZonesStandard,
  captZonesIsMod,
  captZonesIsStock,
  captZonesSignature,
  createCaptZonesProject,
  normalizeCaptZonesProject,
  parseCaptZonesProject,
  resetCaptZonesProject,
  serializeCaptZonesProject,
} from "./capt-zones.js";
import {
  applyScheduleStandard,
  createScheduleProject,
  normalizeScheduleProject,
  parseScheduleProject,
  resetScheduleProject,
  scheduleIsStock,
  scheduleLostInCode,
  scheduleSignature,
  serializeScheduleProject,
  shareableScheduleProject,
} from "./schedule.js";
/* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
import {
  applyFlagsStandard,
  createFlagsProject,
  flagsLostInCode,
  flagsProjectIsStock,
  flagsProjectSignature,
  normalizeFlagsProject,
  parseFlagsProject,
  resetFlagsProject,
  serializeFlagsProject,
  shareableFlagsProject,
} from "./flags.js";
/* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
import {
  applyAtmsStandard,
  atmsLostInCode,
  atmsProjectIsStock,
  atmsProjectSignature,
  createAtmsProject,
  normalizeAtmsProject,
  parseAtmsProject,
  resetAtmsProject,
  serializeAtmsProject,
  shareableAtmsProject,
} from "./atms.js";

const RECOLOR_PROJECTS_MUTABLE = {
  zones: Object.freeze({
    set: "zones",
    create: createZonesProject,
    normalize: normalizeZonesProject,
    parse: parseZonesProject,
    serialize: serializeZonesProject,
    signature: zonesProjectSignature,
    isMod: zonesProjectIsMod,
  }),
  /*
   * Завод начинается со «Стандарта GTA» (13.10.2026): `create` — стандарт, а
   * «Как в моде» — один из готовых видов. «Стандарт» (`isStock`) здесь только
   * называет работу в строке состояния: «Применить» его ставит, а не снимает.
   */
  factory: Object.freeze({
    set: "factory",
    create: createFactoryStartProject,
    normalize: normalizeFactoryProject,
    parse: parseFactoryProject,
    serialize: serializeFactoryProject,
    signature: factoryProjectSignature,
    isMod: factoryProjectIsMod,
    isStock: factoryProjectIsStandard,
    /* Своя картинка эмблемы в код не едет. */
    shareable: shareableFactoryProject,
    lostInCode: factoryLostInCode,
  }),
  /*
   * Ангар стандартный (ТЗ 12.10.2026, ночь): исходный облик — штатный ангар
   * игры, «Стандарт» (`isStock`) снимает установку. Своя картинка (эмблема)
   * в код не едет.
   */
  hangar: Object.freeze({
    set: "hangar",
    create: createHangarProject,
    normalize: normalizeHangarProject,
    parse: parseHangarProject,
    serialize: serializeHangarProject,
    signature: hangarProjectSignature,
    isMod: hangarProjectIsStock,
    isStock: hangarProjectIsStock,
    standard: applyHangarStandard,
    reset: resetHangarProject,
    shareable: shareableHangarProject,
    lostInCode: hangarLostInCode,
  }),
  mapping: Object.freeze({
    set: "mapping",
    create: createMappingProject,
    normalize: normalizeMappingProject,
    parse: parseMappingProject,
    serialize: serializeMappingProject,
    signature: mappingProjectSignature,
    isMod: mappingProjectIsMod,
    /* «Стандарт» (10.10.2026, задача 16): все места как в игре — ставить
       нечего, «Применить» снимает установку. */
    isStock: mappingProjectIsStock,
    /* Своя картинка эмблемы в код не едет. */
    shareable: shareableMappingProject,
    lostInCode: mappingLostInCode,
  }),
  /* Вода — набор без файлов мода: исходный облик — сама игра
     (`isMod` — «как в игре»). */
  water: Object.freeze({
    set: "water",
    create: createWaterProject,
    normalize: normalizeWaterProject,
    parse: parseWaterProject,
    serialize: serializeWaterProject,
    signature: waterProjectSignature,
    isMod: waterProjectIsVanilla,
  }),
  /* Растительность — тоже без файлов мода; путь к файлу улучшенных
     деревьев в код не едет. */
  vegetation: Object.freeze({
    set: "vegetation",
    create: createVegetationProject,
    normalize: normalizeVegetationProject,
    parse: parseVegetationProject,
    serialize: serializeVegetationProject,
    signature: vegetationProjectSignature,
    isMod: vegetationProjectIsVanilla,
    shareable: shareableVegetationProject,
    lostInCode: vegetationLostInCode,
  }),
  /* Шрифты — набор без файлов мода: исходный облик — шрифты игры
     (`isMod` — «как в игре»); свой файл шрифта в код не едет. */
  fonts: Object.freeze({
    set: "fonts",
    create: createFontsProject,
    normalize: normalizeFontsProject,
    parse: parseFontsProject,
    serialize: serializeFontsProject,
    signature: fontsProjectSignature,
    isMod: fontsProjectIsVanilla,
    shareable: shareableFontsProject,
    lostInCode: fontsLostInCode,
  }),
  /*
   * Арена — файлы мода сервера (GTA5RP или Majestic) с обликом работы.
   * Исходный облик — «как в моде»; «Стандарт» (`isStock`) — арена игры
   * или сервера, ставить нечего: «Применить» снимает установку. Свои
   * картинки (эмблема, экраны, звезда) в код не едут.
   */
  arenas: Object.freeze({
    set: "arenas",
    create: createArenasProject,
    normalize: normalizeArenasProject,
    parse: parseArenasProject,
    serialize: serializeArenasProject,
    signature: arenasProjectSignature,
    isMod: arenasProjectIsMod,
    isStock: arenasProjectIsStock,
    standard: applyArenasStandard,
    reset: resetArenasServer,
    shareable: shareableArenasProject,
    lostInCode: arenasLostInCode,
  }),
};

/*
 * Здания из игры (Мегамолл, Ашан / Икея) — по договору на место: работа
 * одна по устройству, опись своя. Исходный облик — штатное здание игры:
 * «Стандарт» (`isStock`) снимает установку.
 */
const buildingContracts = Object.fromEntries(
  BUILDING_SET_IDS.map((place) => [
    place,
    Object.freeze({
      set: place,
      create: () => createBuildingProject(place),
      normalize: (input) => normalizeBuildingProject(place, input),
      parse: (text) => parseBuildingProject(place, text),
      serialize: (project) => serializeBuildingProject(place, project),
      signature: (project) => buildingProjectSignature(place, project),
      isMod: (project) => buildingProjectIsStock(place, project),
      isStock: (project) => buildingProjectIsStock(place, project),
      standard: (project) => applyBuildingStandard(place, project),
      reset: (project) => resetBuildingProject(place, project),
      shareable: (project) => shareableBuildingProject(place, project),
      lostInCode: (project) => buildingLostInCode(place, project),
    }),
  ]),
);
Object.assign(RECOLOR_PROJECTS_MUTABLE, buildingContracts);

/*
 * «Вайнвуд» — своя надпись на холме: исходный облик — штатная надпись
 * VINEWOOD, «Стандарт» снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.vinewood = Object.freeze({
  set: "vinewood",
  create: createVinewoodProject,
  normalize: normalizeVinewoodProject,
  parse: parseVinewoodProject,
  serialize: serializeVinewoodProject,
  /* Своими моделями у холма (задача 1 ТЗ 11.10.2026, вечер) работа — уже не «как в игре». */
  signature: vinewoodWorkSignature,
  isMod: vinewoodWorkIsStock,
  isStock: vinewoodWorkIsStock,
  standard: applyVinewoodStandard,
  reset: resetVinewoodProject,
  shareable: shareableVinewoodProject,
  lostInCode: vinewoodLostInCode,
});
/*
 * «Остановки» — облик автобусных остановок всей карты: исходный облик —
 * остановки игры, «Стандарт» снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.busstops = Object.freeze({
  set: "busstops",
  create: createBusStopsProject,
  normalize: normalizeBusStopsProject,
  parse: parseBusStopsProject,
  serialize: serializeBusStopsProject,
  signature: busStopsProjectSignature,
  isMod: busStopsProjectIsStock,
  isStock: busStopsProjectIsStock,
  standard: applyBusStopsStandard,
  reset: resetBusStopsProject,
  shareable: shareableBusStopsProject,
  lostInCode: busStopsLostInCode,
});
/*
 * «Дороги» — асфальт, грунтовки, тротуары и разметка всей карты: исходный
 * облик — дороги игры, «Стандарт» снимает установку (задача 6 ТЗ 07.10.2026).
 */
RECOLOR_PROJECTS_MUTABLE.roads = Object.freeze({
  set: "roads",
  create: createRoadsProject,
  normalize: normalizeRoadsProject,
  parse: parseRoadsProject,
  serialize: serializeRoadsProject,
  signature: roadsProjectSignature,
  isMod: roadsProjectIsStock,
  isStock: roadsProjectIsStock,
  standard: applyRoadsStandard,
  reset: resetRoadsProject,
  shareable: shareableRoadsProject,
  lostInCode: roadsLostInCode,
});
/*
 * «МСЛ-зоны» (ТЗ 08.10, задача 3) — линии зон на земле: исходный облик —
 * как в моде (палитра, лента 0,4 м, 1,5 км); линии ставятся всегда, в том
 * числе «как в моде»: у человека мода может не быть.
 */
RECOLOR_PROJECTS_MUTABLE.mslzones = Object.freeze({
  set: "mslzones",
  create: createMslZonesProject,
  normalize: normalizeMslZonesProject,
  parse: parseMslZonesProject,
  serialize: serializeMslZonesProject,
  signature: mslZonesSignature,
  isMod: mslZonesIsMod,
});
/*
 * «Летающее лого» (ТЗ 08.10, задача 4) — своя картинка или надпись над
 * центром города: исходный облик — лого нет, «Стандарт» снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.floatlogo = Object.freeze({
  set: "floatlogo",
  create: createFloatLogoProject,
  normalize: normalizeFloatLogoProject,
  parse: parseFloatLogoProject,
  serialize: serializeFloatLogoProject,
  signature: floatLogoSignature,
  isMod: floatLogoIsStock,
  isStock: floatLogoIsStock,
  standard: applyFloatLogoStandard,
  reset: resetFloatLogoProject,
  shareable: shareableFloatLogoProject,
  lostInCode: floatLogoLostInCode,
});
/*
 * «Дирижабли» (ТЗ 11.10.2026) — облик дирижабля игры и что летает в небе:
 * исходный облик — дирижабль с надписью «Это всё о’кей» и он же в небе;
 * «Стандарт» (как в игре, небо пустое) снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.airships = Object.freeze({
  set: "airships",
  create: createAirshipsProject,
  normalize: normalizeAirshipsProject,
  parse: parseAirshipsProject,
  serialize: serializeAirshipsProject,
  signature: airshipsSignature,
  isMod: airshipsIsStock,
  isStock: airshipsIsStock,
  standard: applyAirshipsStandard,
  reset: resetAirshipsProject,
  shareable: shareableAirshipsProject,
  lostInCode: airshipsLostInCode,
});
/*
 * «Интерьеры» (задача 3 ТЗ 10.10.2026) — облик помещений магазинов и
 * заведений: исходный облик — помещения игры, «Стандарт» снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.shops = Object.freeze({
  set: "shops",
  create: createShopsProject,
  normalize: normalizeShopsProject,
  parse: parseShopsProject,
  serialize: serializeShopsProject,
  signature: shopsProjectSignature,
  isMod: shopsProjectIsStock,
  isStock: shopsProjectIsStock,
  standard: applyShopsStandard,
  reset: resetShopsProject,
  shareable: shareableShopsProject,
  lostInCode: shopsLostInCode,
});
/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10) — интерьеры Majestic
 * и GTA 5 РП из папок игрока: ничего не поставлено — «Стандарт», он снимает
 * установку.
 */
RECOLOR_PROJECTS_MUTABLE.projectinteriors = Object.freeze({
  set: "projectinteriors",
  create: createProjectInteriors,
  normalize: normalizeProjectInteriors,
  parse: parseProjectInteriors,
  serialize: serializeProjectInteriors,
  signature: projectInteriorsSignature,
  isMod: projectInteriorsIsStock,
  isStock: projectInteriorsIsStock,
  standard: applyProjectInteriorsStandard,
  reset: resetProjectInteriors,
  shareable: shareableProjectInteriors,
  lostInCode: projectInteriorsLostInCode,
});
/*
 * «Интерьеры Majestic RP» (25.10.2026) — интерьеры сервера Majestic: пока
 * казино (покрытия и подсветка); ничего не правлено — «Стандарт», он снимает
 * установку.
 */
RECOLOR_PROJECTS_MUTABLE.majesticinteriors = Object.freeze({
  set: "majesticinteriors",
  create: createMajesticInteriors,
  normalize: normalizeMajesticInteriors,
  parse: parseMajesticInteriors,
  serialize: serializeMajesticInteriors,
  signature: majesticInteriorsSignature,
  isMod: majesticInteriorsIsStock,
  isStock: majesticInteriorsIsStock,
  standard: applyMajesticInteriorsStandard,
  reset: resetMajesticInteriors,
  shareable: shareableMajesticInteriors,
  lostInCode: majesticInteriorsLostInCode,
});
/*
 * «Билборды» (задача 4 ТЗ 10.10.2026, вечер) — рекламные щиты всей карты:
 * исходный облик — щиты игры, «Стандарт» снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.billboards = Object.freeze({
  set: "billboards",
  create: createBillboardsProject,
  normalize: normalizeBillboardsProject,
  parse: parseBillboardsProject,
  serialize: serializeBillboardsProject,
  signature: billboardsProjectSignature,
  isMod: billboardsProjectIsStock,
  isStock: billboardsProjectIsStock,
  standard: applyBillboardsStandard,
  reset: resetBillboardsProject,
  shareable: shareableBillboardsProject,
  lostInCode: billboardsLostInCode,
});
/*
 * «Зоны каптов» (задача 8 ТЗ 10.10.2026, вечер) — шайбы мода `heix` над
 * районами каптов и ареной: исходный облик — как в моде (зоны ставятся и
 * тогда — своего мода у человека может не быть), «Стандарт» — зон нет,
 * «Применить» снимает установку.
 */
RECOLOR_PROJECTS_MUTABLE.captzones = Object.freeze({
  set: "captzones",
  create: createCaptZonesProject,
  normalize: normalizeCaptZonesProject,
  parse: parseCaptZonesProject,
  serialize: serializeCaptZonesProject,
  signature: captZonesSignature,
  isMod: captZonesIsMod,
  isStock: captZonesIsStock,
  standard: applyCaptZonesStandard,
  reset: resetCaptZonesProject,
});
/*
 * «Расписание» (задача 11 ТЗ 10.10.2026, вечер) — табло сервера Majestic:
 * исходный облик — «Как на сервере» (ставить нечего, «Применить» снимает
 * установку); своё табло — своими моделями на местах табло сервера.
 * Исходный облик — `isMod` без `isStock`: окно зовёт его «Как на сервере»,
 * а не «Стандарт».
 */
RECOLOR_PROJECTS_MUTABLE.schedule = Object.freeze({
  set: "schedule",
  create: createScheduleProject,
  normalize: normalizeScheduleProject,
  parse: parseScheduleProject,
  serialize: serializeScheduleProject,
  signature: scheduleSignature,
  isMod: scheduleIsStock,
  standard: applyScheduleStandard,
  reset: resetScheduleProject,
  shareable: shareableScheduleProject,
  lostInCode: scheduleLostInCode,
});
/*
 * «Флаги» (задача 7 ТЗ 10.10.2026, вечер) — флаги на флагштоках всей карты:
 * исходный облик — флаги игры, «Стандарт» снимает установку; ткань и ветер
 * штатные, меняется только лист полотнища.
 */
RECOLOR_PROJECTS_MUTABLE.flags = Object.freeze({
  set: "flags",
  create: createFlagsProject,
  normalize: normalizeFlagsProject,
  parse: parseFlagsProject,
  serialize: serializeFlagsProject,
  signature: flagsProjectSignature,
  isMod: flagsProjectIsStock,
  isStock: flagsProjectIsStock,
  standard: applyFlagsStandard,
  reset: resetFlagsProject,
  shareable: shareableFlagsProject,
  lostInCode: flagsLostInCode,
});
/*
 * «Банкоматы» (задача 4 ТЗ 17.10.2026) — банкоматы всей карты: исходный
 * облик — банкоматы игры, «Стандарт» снимает установку; правка — листы и
 * палитры в штатных моделях банкоматов, видна на всех банкоматах модели.
 */
RECOLOR_PROJECTS_MUTABLE.atms = Object.freeze({
  set: "atms",
  create: createAtmsProject,
  normalize: normalizeAtmsProject,
  parse: parseAtmsProject,
  serialize: serializeAtmsProject,
  signature: atmsProjectSignature,
  isMod: atmsProjectIsStock,
  isStock: atmsProjectIsStock,
  standard: applyAtmsStandard,
  reset: resetAtmsProject,
  shareable: shareableAtmsProject,
  lostInCode: atmsLostInCode,
});
/*
 * Наборы с общей отделкой поверхностей (`finish.js`): «Картинка» без файла в
 * них не красит — поверхность встаёт «Стандартом» (`settleBlankFinishes`),
 * как её рисует кадр редактора. Установщик собирает такую работу тем же
 * способом, а окно считает «стандарт» и отпечаток по ней же: работа из одних
 * пустых «Картинок» — «как в игре», а не «картинка не пришла».
 */
export const BLANK_FINISH_SETS = Object.freeze(["factory", "hangar", "busstops", "shops", "arenas", "atms", ...BUILDING_SET_IDS, "mapping"]);

const settledContract = (contract) => {
  const settled = (project) => settleBlankFinishes(contract.normalize(project));
  return Object.freeze({
    ...contract,
    signature: (project) => contract.signature(settled(project)),
    isMod: (project) => contract.isMod(settled(project)),
    ...(contract.isStock ? { isStock: (project) => contract.isStock(settled(project)) } : {}),
  });
};
for (const set of BLANK_FINISH_SETS) RECOLOR_PROJECTS_MUTABLE[set] = settledContract(RECOLOR_PROJECTS_MUTABLE[set]);

export const RECOLOR_PROJECTS = Object.freeze(RECOLOR_PROJECTS_MUTABLE);

/** Договор работы вида `kind` или `null`. */
export const recolorProject = (kind) => RECOLOR_PROJECTS[kind] || null;
