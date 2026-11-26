/*
 * Наборы перекраски в игре: запретные зоны, завод, ангар, маппинг.
 *
 * Набор — файлы мода (`resources/recolor/<набор>`, готовит
 * `scripts/prepare-recolor-sets.mjs`): модели и словари текстур, а где мод их
 * везёт — карта, типы, коллизия и `_manifest.ymf`. Работа человека доезжает
 * до игры правкой файлов на месте: текстуры — новыми пикселями той же длины
 * (`recolor-textures.js` — в моделях, фрагментах и словарях), свечение —
 * числом шейдера (`patchDrawable` из `@modovik/ypt`).
 * Геометрия, места и развороты остаются модовыми.
 *
 * Каждое место ложится в свой потоковый архив пакета мест Astral —
 * `dlcpacks/astral_places/dlc.rpf` → `astral_<набор>.rpf` (фикс 1 ТЗ
 * 06.10.2026; до него — контейнер update.rpf, который пакеты Rockstar
 * перекрывали) — пакетом движка установки. Наборы не делят архив и
 * `_manifest.ymf` ни друг с другом, ни с чужими модами: «Применить» одного
 * не трогает остальные.
 *
 * Пакет детерминирован: тот же облик — тот же id, и повторное «Применить»
 * без правок архив игры не пересобирает.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appExpressInstall } from "./express-install.js";
import { readStockPackSeniority } from "./carrier-seniority-reader.js";
import { readHostSubpackInfo } from "./subpack-lane-check.js";
import { CARRIERS, enabledCarrierIds } from "@modovik/install-engine/carrier-targets.js";
import { mapsReserveFromWork, treesReserveFromWork } from "./trees-reserve.js";
import { isRoadsContainerRefusal, roadsContainerRequest, roadsFellBackToPacks } from "./roads-update-install.js";
import { isVegetationContainerRefusal, vegetationContainerRequest, vegetationFellBackToPacks } from "./vegetation-update-install.js";
import { annotateRpFallback, rpFallbackInfo } from "./rp-fallback.js";
import { composedUnreadableError } from "./composed-source-error.js";
import { rpModeKindsOn, viaContainerOrOld } from "./rp-mode-channel.js";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { discoverGames } from "@modovik/game-discovery";
import { jenkinsHash, patchDrawable, readDrawableShaders } from "@modovik/ypt";
import {
  BLANK_FINISH_SETS,
  FACTORY_GROUPS,
  FACTORY_INVENTORY,
  emblemAssets,
  findMappingLocation,
  mappingItemAt,
  mappingItemModel,
  factoryEmblemDecals,
  factoryFilePatches,
  factoryItemModel,
  factoryRemovedPlaces,
  HANGAR_INVENTORY,
  hangarEmblemDecals,
  hangarProjectIsStock,
  hangarStructure,
  MAPPING_INVENTORY,
  MAPPING_PLATE,
  mappingEmblemDecals,
  mappingEmblemPlates,
  mappingPlateFiles,
  mappingStockEdited,
  normalizeFactoryProject,
  normalizeHangarProject,
  normalizeMappingProject,
  normalizeZonesProject,
  settleBlankFinishes,
  ZONE_KINDS,
  ZONES_INVENTORY,
  zoneShape,
  zonesFilePatches,
  zonesProjectIsHidden,
  zonesShapeChanged,
} from "@modovik/climb-contract/recolor";
import { isHeavyShell, modelPagesFromHead, readFileHead } from "./model-pages.js";
import { hasStockStructure } from "./arena-shell-guard.js";
import { engineInstallEnabled, inspectProfile, planPackage, uninstallPackage } from "@modovik/install-engine";
import { applyRoadsViaCarrier } from "./roads-carrier-apply.js";
import { fingerprintSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { installTraceActive, megabytes, tracedStep, traceNote } from "@modovik/install-engine/install-trace.js";
import {
  installLocalRecolorPackage,
  installLocalVegetationPackage,
  installLocalWaterPackage,
  installLocalFontsPackage,
  installLocalRoadsPackage,
  installLocalProjectInteriorsPackage,
  installLocalMajesticInteriorsPackage,
} from "@modovik/install-engine/local-packages.js";
import { FONTS_LIBRARY_ENTRIES, isFontsModId } from "@modovik/install-engine/fonts-manifest-trust.js";
import { WATER_CONTAINER, isWaterModId } from "@modovik/install-engine/water-manifest-trust.js";
import { isProjectInteriorsModId } from "@modovik/install-engine/project-interiors-manifest-trust.js";
import { PROJECT_INTERIORS_CONTAINER_LABEL, buildProjectInteriorsPackage } from "./project-interiors/install.js";
import { isMajesticInteriorsModId } from "@modovik/install-engine/majestic-interiors-manifest-trust.js";
import { MAJESTIC_INTERIORS_CONTAINER_LABEL, buildMajesticInteriorsPackage } from "./recolor-majestic-interiors.js";
import {
  ROADS_ARCHIVE,
  ROADS_CONTAINER,
  buildRoadsManifest,
  isLocalRoadsManifest,
  isRoadsModId,
} from "@modovik/install-engine/roads-manifest-trust.js";
import { ROADS_DLC_PACKS, roadsArchiveOf, roadsPackOf } from "@modovik/install-engine/roads-dlc.js";
import {
  buildRecolorManifest,
  isLocalRecolorManifest,
  isRecolorModId,
  RECOLOR_SETS,
  recolorRouteOf,
} from "@modovik/install-engine/recolor-manifest-trust.js";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { decodeFinishImages } from "./finish-bake.js";
import { writePackageFiles } from "./package-files.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { readGameMapNames } from "./game-map-names-host.js";
import { createGameReader } from "./optimization-layers.js";
import { buildFactoryEmblems, buildFactoryFiles } from "./recolor-factory.js";
import { buildHangarFiles } from "./recolor-hangar.js";
import { buildAssetPlates } from "./recolor-emblem.js";
import { restyleZoneFiles } from "./recolor-zones.js";
import { shapeZoneFiles } from "./recolor-zone-shapes.js";
import { buildWaterPackage, openWaterGame } from "./recolor-water.js";
import { engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable } from "./native-engine-rust.js";
import { buildFontsPackage, openFontsGame } from "./recolor-fonts.js";
import { astralSetFiles, buildVegetationPackage, openVegetationGame, vegetationStores } from "./recolor-vegetation.js";
import { createVegetationPool } from "./vegetation-build-pool.js";
import { buildVegetationOffThread } from "./vegetation-build-host.js";
import { buildRecolorOffThread } from "./recolor-build-host.js";
import {
  VEGETATION_ARCHIVE,
  VEGETATION_CONTAINER,
  buildVegetationManifest,
  isLocalVegetationManifest,
  isVegetationModId,
} from "@modovik/install-engine/vegetation-manifest-trust.js";
import { VEGETATION_DLC_ALL_PACKS, VEGETATION_DLC_PACK_C, VEGETATION_LAYOUT_THREE_PACKS, VEGETATION_LAYOUT_TWO_PACKS, vegetationArchiveOf, vegetationPackOf } from "@modovik/install-engine/vegetation-dlc.js";
import { isTexturesModId } from "@modovik/install-engine/textures-manifest-trust.js";
import { prepareVegetationDlcHosts, vegetationNeedsThirdPack, vegetationNeedsVarietyHost } from "./vegetation-dlc-host.js";
import { ownDlcVerifier } from "./dlc-archive-check.js";
import { prepareRoadsDlcHosts } from "./roads-dlc-host.js";
import { buildRoadsOffThread } from "./roads-build-host.js";
import { preparePlacesDlcHost } from "./places-dlc-host.js";
import { isMajesticFillerDictionary, PLACES_DLC_TARGET, PLACES_MAP_SETS, placesMirrorEntryOf, refreshPlacesDlcBase } from "@modovik/install-engine/places-dlc.js";
import { placesViaUpdate } from "./places-update-install.js";
import { normalizeVegetationProject } from "@modovik/climb-contract/recolor/vegetation";
import { nearPlateTriangles } from "./recolor-lod.js";
import { readLayerWork, rebuildDependents, rememberLayerWork } from "./layer-works.js";
import { buildMappingFiles, buildMappingLod, buildMappingStockFiles } from "./recolor-mapping.js";
import { buildArenaFiles, interiorRoomBoxes, unsafeDrawables } from "./recolor-arenas.js";
import {
  ARENAS_INVENTORY,
  arenaScene,
  arenaServerInventory,
  arenaEmblemDecals,
  arenaImageAssets,
  arenaReplacementModels,
  normalizeArenasProject,
} from "@modovik/climb-contract/recolor/arenas";
import { patchResourceTextures, readResourceTextures } from "./recolor-textures.js";
import { buildBuildingFiles } from "./recolor-buildings.js";
import { buildVinewoodFiles } from "./recolor-vinewood.js";
import { hidePlaceEntities, joaatName, localizePlaceFiles, readPlaceIsolation, repointPlaceEntities } from "./place-isolation.js";
import { buildPlaceItemCopies } from "./recolor-place-items.js";
import { placeItemLookModels, placeItemMaps, placeItemWorld } from "@modovik/climb-contract/recolor/place-item-looks";
import { VINEWOOD_INVENTORY, normalizeVinewoodProject, vinewoodProjectIsStock } from "@modovik/climb-contract/recolor/vinewood";
import { buildBusStopFiles } from "./recolor-busstops.js";
import { buildMslZonesFiles } from "./recolor-msl-zones.js";
import { buildFloatLogoFiles } from "./recolor-float-logo.js";
import { floatLogoIsStock, normalizeFloatLogoProject } from "@modovik/climb-contract/recolor/float-logo";
import { buildAirshipFiles } from "./recolor-airships.js";
import {
  AIRSHIP_KIND_IDS,
  AIRSHIP_SIGN_SIZE,
  airshipCount,
  airshipDecorated,
  airshipGameRepainted,
  airshipKind,
  normalizeAirshipsProject,
} from "@modovik/climb-contract/recolor/airships";
import { AIRSHIP_SKINS } from "@modovik/climb-contract/recolor/airship-models";
import { MSL_ZONES_INVENTORY, mslZonesIsHidden, normalizeMslZonesProject } from "@modovik/climb-contract/recolor/msl-zones";
import { BUSSTOPS_INVENTORY, busStopsImageAssets, busStopsProjectIsStock, normalizeBusStopsProject } from "@modovik/climb-contract/recolor/busstops";
/* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
import { buildAtmFiles } from "./recolor-atms.js";
import { ATMS_INVENTORY, atmsImageAssets, atmsProjectIsStock, changedAtmCount, changedAtmTypes, normalizeAtmsProject } from "@modovik/climb-contract/recolor/atms";
import { buildShopFiles, shopModelInterior } from "./recolor-shops.js";
import { createShopLightPatcher } from "./shop-lights.js";
import { changedShopInteriors, normalizeShopsProject, shopModelScene, shopsEmblemDecals, shopsImageAssets, shopsProjectIsStock } from "@modovik/climb-contract/recolor/shops";
import { buildBillboardFiles } from "./recolor-billboards.js";
import { billboardsImageAssets, billboardsProjectIsStock, changedBillboards, normalizeBillboardsProject } from "@modovik/climb-contract/recolor/billboards";
import { buildCaptZonesFiles } from "./recolor-capt-zones.js";
import { captZonesOwnCount, normalizeCaptZonesProject } from "@modovik/climb-contract/recolor/capt-zones";
import { buildScheduleFiles } from "./recolor-schedule.js";
import { SCHEDULE_SHEET, changedScheduleRows, normalizeScheduleProject, scheduleIsStock } from "@modovik/climb-contract/recolor/schedule";
/* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
import { buildFlagFiles } from "./recolor-flags.js";
import { changedFlagCount, changedFlagKinds, flagsImageAssets, flagsProjectIsStock, normalizeFlagsProject } from "@modovik/climb-contract/recolor/flags";
import { decodePlaceModelImages, withPlaceModels } from "./recolor-place-models.js";
import { readSetFiles } from "./set-resources.js";
import { PLACE_MODEL_HALLS, PLACE_MODEL_LIMIT } from "@modovik/climb-contract/recolor/place-models";
import { mloInstanceTransform } from "@modovik/climb-contract/recolor/placement";
import {
  BUILDING_SET_IDS,
  buildingItemModel,
  buildingItemsKnown,
  buildingRemovedPlaces,
  buildingCoverJobs,
  buildingImageAssets,
  buildingInventory,
  buildingOrigin,
  buildingSideUsesPanels,
  buildingTextJobs,
  buildingTextPlates,
  buildingTitle,
  normalizeBuildingProject,
} from "@modovik/climb-contract/recolor/buildings";
/* Подмена по умолчанию для установщика («одна запись вместо двух», выключатель `ASTRAL_ENGINE_INSTALL_OPS`). */
import "./ops-install.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_PLANS = 8;
const KEEP_PACKAGES = 4;

/*
 * Под какой режим RP собран план (24.11.2026). Растительность и дороги решают «носителем или прежним пакетом» по окружению при сборке плана, а проверка манифеста на «Применить»
 * (`manifest.js`, `carrierEnabled`) читает то же окружение второй раз. Выбор «Где играю» меняет его на лету, и план, собранный минуты назад, мог попасть под другой режим:
 * движок отвергает носитель, у которого слов носителя в окружении уже нет. Слепок — виды, идущие контейнером, и включённые носители; сравнивается на «Применить».
 */
const rpModeStamp = (env = process.env) => JSON.stringify([rpModeKindsOn(env), enabledCarrierIds(env)]);
const PLAN_STALE = "План установки устарел — нажмите «Применить» ещё раз.";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const exists = (target) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false);

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Наборы
 * ------------------------------------------------------------------ */

/*
 * Что каждый набор делает с работой: как её привести в порядок, какие
 * правки файлов она даёт и что сказать об итоге. `patches` возвращает
 * `[{ file, textures, vectors }]` — файлы без правок едут как есть.
 */
const SETS = {
  /* Зоны: зелёные, запретные, бизвар, ВЗХ и порт одним набором. Ровный цвет —
     на месте, эффект (градиент, радуга, перелив, линия) — полосой через
     нативный хост (`recolor-zones.js`). Дальней прорисовки у оболочек нет. */
  zones: {
    inventory: ZONES_INVENTORY,
    normalize: normalizeZonesProject,
    patches: (project) => zonesFilePatches(project),
    lod: false,
    build: async (project, resources, context) => {
      const built = buildRecolorFiles("zones", project, resources);
      /* Форма не как у мода (ширина, стенка, неон — задача 23 ТЗ 18.10.2026): модели вида строятся заново (`recolor-zone-shapes.js`),
         их эффект и цвет уже в них; рамки архетипов в типах растут до новой сетки. */
      const shaped = await shapeZoneFiles(project, resources, context);
      const restyled = await restyleZoneFiles(
        built.patches.filter((patch) => patch.restyle && !shaped.files.has(patch.file)),
        resources,
        context,
      );
      const bytesOf = (file) => shaped.files.get(file.name) ?? shaped.types.get(file.name) ?? restyled.get(file.name);
      return { ...built, files: built.files.map((file) => (bytesOf(file) ? { name: file.name, bytes: bytesOf(file) } : file)), shape: shaped.report };
    },
    summary: (project, patches) => ({
      zones: ZONES_INVENTORY.zones.filter((zone) => zone.placed).length,
      /* Сколько зон каждого вида в игре (ТЗ 17.10.2026, задача 12). */
      kinds: Object.fromEntries(ZONE_KINDS.map((kind) => [kind, ZONES_INVENTORY.zones.filter((zone) => zone.placed && zone.kind === kind).length])),
      hidden: zonesProjectIsHidden(project),
      ...Object.fromEntries(ZONE_KINDS.map((kind) => [kind, { look: project[kind].look, opacity: project[kind].opacity, perZone: project[kind].perZone, shape: zoneShape(project, kind) }])),
      shaped: ZONE_KINDS.filter((kind) => zonesShapeChanged(project, kind)),
      changed: patches.length,
    }),
  },
  /* Завод: ровный цвет — в листы мода, «Стандарт» и отделка — в штатные
     файлы игры игрока, эмблема — плашкой в мире (`recolor-factory.js`). */
  factory: {
    inventory: FACTORY_INVENTORY,
    normalize: normalizeFactoryProject,
    patches: (project) => factoryFilePatches(project),
    /* Игра нужна штатным листам и дальнему заводу: всякому облику, кроме
       мода целиком (мод дальний завод не трогает). */
    needsGame: (project) =>
      project.removed.length > 0 ||
      project.items.length > 0 ||
      [...FACTORY_GROUPS.map((group) => project[group.id]), ...Object.values(project.parts || {})].some(
        (settings) => !["mod", "buildings"].includes(settings.mode),
      ),
    /* Вещи, убранные по одной («Предметы» → «Удалить», ТЗ 26.10.2026): где стояли — по ним ищутся сущности в картах района. */
    removedPlaces: (project) => factoryRemovedPlaces(project),
    /* Облик вещей («Предметы» → «Своя модель», «Цвет», «Своя картинка», ТЗ 27.10.2026): копии моделей, клоны плана и сущности карт (`recolor-place-items.js`). */
    placeItems: {
      modelOf: (entity) => factoryItemModel(entity),
      worldOf: (entity) => [...FACTORY_INVENTORY.factory.placements[entity - 1].position],
    },
    /* Листы, дальний завод и окружение — `buildFactoryFiles` (`lod` — опись). */
    /* Листы — `buildFactoryFiles`; эмблема — плашкой нативного хоста. */
    build: async (project, resources, context) => {
      const built = await buildFactoryFiles(project, resources, context);
      const plate = await buildFactoryEmblems(project, context.emblems, { compile: context.compile, stateDir: context.stateDir, lod: context.lod, game: context.game, resources });
      return { ...built, files: [...built.files, ...plate], patches: plate.length ? [...built.patches, { file: "emblem", plate: true }] : built.patches };
    },
    summary: (project, patches) => ({
      groups: Object.fromEntries(FACTORY_GROUPS.map((group) => [group.id, project[group.id].mode])),
      parts: Object.fromEntries(Object.entries(project.parts || {}).filter(([, part]) => part.mode !== "buildings").map(([id, part]) => [id, part.mode])),
      /* Граффити на стенах: как в игре или убраны (задача 11 ТЗ 17.10.2026). */
      graffiti: project.graffiti,
      emblem: factoryEmblemDecals(project).length,
      district: FACTORY_INVENTORY.factory.districtLabel,
      changed: patches.length,
    }),
  },
  /*
   * Ангар стандартный (ТЗ 12.10.2026, ночь): основа — штатный ангар
   * ограблений из игры игрока (`recolor-hangar.js`), как у «Зданий»: листы
   * стен и пола на месте, фермы и кран — из модели нутра, лампы — гаснут,
   * эмблемы — плашками, дальний ангар — общей системой LOD. Своих файлов у
   * набора нет; всё «Стандарт GTA» — ставить нечего.
   */
  hangar: {
    inventory: HANGAR_INVENTORY,
    normalize: normalizeHangarProject,
    needsGame: (project) => !hangarProjectIsStock(project),
    build: (project, resources, context) =>
      buildHangarFiles(project, {
        game: context.game,
        images: context.images,
        emblems: context.emblems,
        compile: context.compile,
        stateDir: context.stateDir,
        lod: context.lod,
      }),
    summary: (project, patches) => ({
      outside: project.outside.mode === "colour" ? project.outside.colour : project.outside.mode,
      inside: project.inside.mode === "colour" ? project.inside.colour : project.inside.mode,
      floor: project.floor.mode === "colour" ? project.floor.colour : project.floor.mode,
      /* Железяки нутра и лампы (Ангар стандартный, ТЗ 13.10.2026: ещё вентиляция, галерея, связи, трубы). */
      ...hangarStructure(project),
      /* Разметка пола (ТЗ 17.10.2026). */
      markings: project.markings,
      emblem: hangarEmblemDecals(project).length,
      /* Свет ламп своим цветом (мастерская ангара — цвета, часть А): цвет и сила только когда они едут в игру. */
      ...(project.lights.mode === "colour" ? { lightColour: project.lights.colour, lightPower: project.lights.intensity } : {}),
      changed: patches.filter((patch) => patch.textures || patch.structure || patch.overlays || patch.copies || patch.lamps === false || patch.pipes === false || patch.gallery === false || patch.markings === false || patch.lightColour).length,
    }),
  },
  /* Маппинг — тон каждого места по своим листам (`recolor-mapping.js`);
     издалека — общей системой LOD, если игра прочитана; эмблема — плашкой
     нативного хоста, как у завода. */
  mapping: {
    inventory: MAPPING_INVENTORY,
    normalize: normalizeMappingProject,
    /* Парковка своим цветом (ТЗ 17.10.2026) — штатная парковка из игры игрока. */
    needsGame: (project) => mappingStockEdited(project) || project.items.length > 0,
    /* Облик вещей мест (ТЗ 27.10.2026): вещи фермы, базы байкеров и самолёта — записи карт района; копия строится из штатной модели игры. */
    placeItems: {
      modelOf: (key) => mappingItemModel(key),
      worldOf: (key) => {
        const at = mappingItemAt(key);
        return [...MAPPING_INVENTORY.mapping.locations.find((location) => location.id === at.location).placements[at.entity - 1].position];
      },
    },
    build: async (project, resources, context) => {
      const modBuilt = buildMappingFiles(project, resources);
      const stockBuilt = await buildMappingStockFiles(project, { game: context.game, images: context.images, compile: context.compile, stateDir: context.stateDir });
      const built = { files: [...modBuilt.files, ...stockBuilt.files], patches: [...modBuilt.patches, ...stockBuilt.patches] };
      const plates = mappingEmblemPlates(project);
      /* Перед деталями стен места (задача 11): грани моделей мода на местах игры. */
      const placements = MAPPING_INVENTORY.mapping.locations.flatMap((location) => (location.placements || []).map((placement) => ({ ...placement, at: `${placement.model}.ydr` })));
      const near = plates.length ? await nearPlateTriangles(plates, placements, async (placement) => resources.get(placement.at) || null) : null;
      const plate = await buildAssetPlates({
        plates,
        near,
        images: context.emblems,
        compile: context.compile,
        stateDir: context.stateDir,
        set: "mapping",
        names: { types: MAPPING_PLATE.types, map: MAPPING_PLATE.map },
        files: mappingPlateFiles,
        far: { lod: context.lod, game: context.game },
      });
      const lod = context.lod && context.game ? await buildMappingLod(project, { game: context.game, resources, lod: context.lod, images: context.images }) : null;
      const lodFiles = lod?.files || [];
      return {
        files: [...built.files, ...lodFiles, ...plate],
        patches: [
          ...built.patches,
          ...(lodFiles.length ? [{ file: "lod", lod: true, files: lodFiles.map((file) => file.name) }] : []),
          ...(plate.length ? [{ file: "emblem", plate: true }] : []),
        ],
        ...(lod ? { lodReport: lod.report } : {}),
      };
    },
    summary: (project, patches) => ({
      locations: Object.fromEntries(
        Object.entries(project.locations).map(([id, item]) => [id, item.mode === "colour" ? item.colour : item.mode]),
      ),
      emblem: mappingEmblemDecals(project).length,
      changed: patches.length,
    }),
  },
};

/* Арена: облик выбранного сервера (`recolor-arenas.js`) — листы модов,
   штатные листы игры у плашек, сущности интерьера GTA5RP, эмблема плашкой,
   дальний фасад общей системой LOD. Игра нужна всегда: «Стандарт», файл
   интерьера, банкомат и дальний фасад читаются из неё. */
SETS.arenas = {
  inventory: ARENAS_INVENTORY,
  /* Файлы набора — стандартная арена Majestic (`majestic/…`); GTA 5 RP берёт основу из игры и их не читает. */
  resourceFiles: (project) => ARENAS_INVENTORY.files.filter((file) => file.name.startsWith(`${project.server}/`)),
  normalize: normalizeArenasProject,
  needsGame: () => true,
  /* Собирается поверх поставленного мода арены (`modFilesUnder`). */
  overMods: true,
  build: (project, resources, context) =>
    buildArenaFiles(project, resources, {
      game: context.game,
      pictures: context.pictures || {},
      images: context.images,
      compile: context.compile,
      stateDir: context.stateDir,
      lod: context.lod,
      /* Полотна по одному — сущностями помещения зала GTA 5 RP. */
      hall: () => arenaHallInterior(context.game),
      /* Модели сервера своими (Majestic): картинки и сетки замен. */
      replacements: context.replacements || null,
      /* Поставленный мод арены — основа файлов с его именами (16.10). */
      over: context.over || null,
    }),
  summary: (project, patches) => ({
    server: project.server,
    changed: patches.length,
    emblem: arenaEmblemDecals(project).length,
    entities: patches.find((patch) => patch.entities)?.entities || 0,
  }),
};

/*
 * Здания из игры — «Мегамолл», «Ашан / Икея» (`recolor-buildings.js`):
 * штатные файлы игры игрока с правками на месте, плашки сторон, логотипов и
 * надписи, дальние планы общей системой LOD. Своих файлов у набора нет —
 * игра нужна всегда.
 */
for (const place of BUILDING_SET_IDS)
  SETS[place] = {
    inventory: buildingInventory(place),
    normalize: (input) => normalizeBuildingProject(place, input),
    needsGame: () => true,
    /* Вещи здания по одной (ТЗ 27.10.2026): «Удалить» и облик предмета — у здания с описью карт района (Мегамолл). */
    ...(buildingItemsKnown(place)
      ? {
          removedPlaces: (project) => buildingRemovedPlaces(place, project),
          placeItems: { modelOf: (entity) => buildingItemModel(place, entity), worldOf: (entity) => placeItemWorld(place, entity, place) },
        }
      : {}),
    build: (project, resources, context) =>
      buildBuildingFiles(place, project, {
        game: context.game,
        pictures: context.pictures || {},
        images: context.images,
        compile: context.compile,
        stateDir: context.stateDir,
        lod: context.lod,
      }),
    summary: (project, patches) => ({
      place,
      changed: patches.filter((patch) => patch.textures).length,
      plates: patches.find((patch) => patch.plates)?.plates.length || 0,
    }),
  };

/*
 * «Вайнвуд» — надпись на холме (`recolor-vinewood.js`): буквы из масок
 * глифов окна, леса, пустые детали, дальние планы и ночное свечение —
 * штатные модели игры игрока под своими именами. Игра нужна всегда.
 */
SETS.vinewood = {
  inventory: VINEWOOD_INVENTORY,
  normalize: normalizeVinewoodProject,
  needsGame: (project) => !vinewoodProjectIsStock(project),
  lod: false,
  build: (project, resources, context) =>
    buildVinewoodFiles(project, {
      game: context.game,
      pictures: context.pictures || {},
      compile: context.compile,
      stateDir: context.stateDir,
    }),
  summary: (project, patches) => ({
    mode: project.mode,
    models: patches.find((patch) => patch.models)?.models.length || 0,
  }),
};

/*
 * МСЛ-зоны (ТЗ 08.10.2026, задача 3) — линии зон на земле
 * (`recolor-msl-zones.js`): свои модели лент и стенок плитками из геометрии
 * мода в поставке, своя расстановка и манифест. Игра не нужна.
 */
SETS.mslzones = {
  inventory: MSL_ZONES_INVENTORY,
  normalize: normalizeMslZonesProject,
  lod: false,
  build: (project, resources, context) => buildMslZonesFiles(project, { compile: context.compile, stateDir: context.stateDir }),
  summary: (project, patches) => ({
    models: patches.find((patch) => patch.models)?.models.length || 0,
    drawDistance: project.drawDistance,
    width: project.width,
    height: project.height,
    opacity: project.opacity,
    hidden: mslZonesIsHidden(project),
  }),
};

/*
 * «Летающее лого» (ТЗ 08.10.2026, задача 4) — своя картинка или надпись над
 * центром города (`recolor-float-logo.js`): объёмная фигура по контуру со
 * свечением, клип движения, свой архетип и сущность. Игра не нужна;
 * «Стандарт» (лого нет) снимает установку.
 */
SETS.floatlogo = {
  inventory: Object.freeze({ set: "floatlogo", title: "Летающее лого", files: [] }),
  normalize: normalizeFloatLogoProject,
  lod: false,
  build: (project, resources, context) =>
    buildFloatLogoFiles(project, { image: context.pictures?.logo || null, compile: context.compile, stateDir: context.stateDir }),
  summary: (project) => ({ mode: project.mode, motion: project.motion, size: project.size, height: project.height, drawDistance: project.drawDistance }),
};

/*
 * «Дирижабли» (ТЗ 11.10.2026) — облик дирижабля игры и что летает в небе
 * (`recolor-airships.js`): лист надписи работы (рисует окно), копия словаря
 * штатного дирижабля, модели с клипом полёта и их расстановка. Игра нужна,
 * когда в работе есть дирижабль: его модель и словарь — из игры игрока.
 * «Стандарт» (лист как в игре, в небе пусто) снимает установку.
 */
SETS.airships = {
  inventory: Object.freeze({ set: "airships", title: "Дирижабли", files: [] }),
  normalize: normalizeAirshipsProject,
  needsGame: (project) => airshipGameRepainted(project) || project.fleet.blimp.count > 0,
  lod: false,
  build: (project, resources, context) =>
    buildAirshipFiles(project, { sheet: context.pictures?.sign || null, skins: context.pictures?.skins || {}, game: context.game, compile: context.compile, stateDir: context.stateDir }),
  summary: (project, patches) => ({
    sign: project.blimp.sign,
    game: airshipGameRepainted(project),
    flying: airshipCount(project),
    area: project.area,
    entities: patches.find((patch) => patch.entities)?.entities || 0,
  }),
};

/*
 * «Остановки» — автобусные остановки всей карты (`recolor-busstops.js`):
 * штатные модели остановок игры игрока и их словари высокой чёткости с
 * правленными листами частей; прозрачность — прозрачными шейдерами игры
 * (нативный хост). Игра нужна всегда, дальних планов у остановок нет.
 */
SETS.busstops = {
  inventory: BUSSTOPS_INVENTORY,
  normalize: normalizeBusStopsProject,
  needsGame: (project) => !busStopsProjectIsStock(project),
  lod: false,
  build: (project, resources, context) =>
    buildBusStopFiles(project, {
      game: context.game,
      images: context.images,
      compile: context.compile,
      stateDir: context.stateDir,
    }),
  summary: (project, patches) => ({
    types: [...new Set(patches.map((patch) => patch.type).filter(Boolean))],
    /* Плашки гифок — модели, а не файлы листов: в счёт изменённых файлов они не входят. */
    changed: patches.filter((patch) => patch.file !== "models").length,
    transparent: patches.filter((patch) => patch.transparent).length,
    live: patches.find((patch) => patch.file === "models")?.live || 0,
  }),
};

/*
 * «Банкоматы» (задача 4 ТЗ 17.10.2026) — банкоматы всей карты
 * (`recolor-atms.js`): штатные модели банкоматов игры игрока и их словари
 * высокой чёткости — листы частей на месте, палитры корпуса и рамки,
 * свечение экрана и вывески. Игра нужна всегда, дальних моделей у
 * банкоматов нет (второй уровень детализации — в той же модели).
 */
SETS.atms = {
  inventory: ATMS_INVENTORY,
  normalize: normalizeAtmsProject,
  needsGame: (project) => !atmsProjectIsStock(project),
  lod: false,
  build: (project, resources, context) => buildAtmFiles(project, { game: context.game, images: context.images, compile: context.compile, stateDir: context.stateDir }),
  summary: (project, patches) => ({
    types: changedAtmTypes(project),
    atms: changedAtmCount(project),
    changed: patches.length,
  }),
};

/*
 * «Интерьеры» (задача 3 ТЗ 10.10.2026) — помещения магазинов и заведений
 * (`recolor-shops.js`): штатные файлы помещений игры игрока — листы стен,
 * пола и потолка на месте, убранные вещи — дальностью сущностей интерьера.
 * Игра нужна всегда; «Стандарт» снимает установку.
 */
SETS.shops = {
  inventory: Object.freeze({ set: "shops", title: "Интерьеры", files: [] }),
  normalize: normalizeShopsProject,
  needsGame: (project) => !shopsProjectIsStock(project),
  lod: false,
  /* Снаружи (второй заход): листы квартала — копией в модели мест, свои колонки станций — копиями (нативный хост). */
  build: (project, resources, context) =>
    buildShopFiles(project, { game: context.game, images: context.images, compile: context.compile, stateDir: context.stateDir, emblems: context.emblems, lights: context.lights }),
  summary: (project, patches) => ({
    interiors: changedShopInteriors(project),
    changed: patches.length,
    hidden: patches.reduce((sum, patch) => sum + (patch.entities || 0), 0),
    /* Снаружи: места, колонки и свои колонки станций. */
    outside: [...new Set(patches.map((patch) => patch.place).filter(Boolean))].length,
    pumps: patches.some((patch) => patch.pump && !patch.station),
    stations: [...new Set(patches.map((patch) => patch.station).filter(Boolean))].length,
    emblems: patches.filter((patch) => patch.plate && /\.ydr$/.test(patch.file)).length,
  }),
};

/*
 * «Билборды» (задача 4 ТЗ 10.10.2026, вечер) — рекламные щиты всей карты
 * (`recolor-billboards.js`): штатные модели и словари районов игры игрока —
 * картинка на месте щита на листе вблизи, в высокой чёткости и вдали,
 * свечение ночью — множителем шейдера щита. Игра нужна всегда; «Стандарт»
 * снимает установку.
 */
SETS.billboards = {
  inventory: Object.freeze({ set: "billboards", title: "Билборды", files: [] }),
  normalize: normalizeBillboardsProject,
  needsGame: (project) => !billboardsProjectIsStock(project),
  lod: false,
  build: (project, resources, context) => buildBillboardFiles(project, { game: context.game, images: context.images, compile: context.compile, stateDir: context.stateDir }),
  summary: (project, patches) => ({
    boards: changedBillboards(project).length,
    /* Плашки гифок — модели, а не файлы листов: в счёт изменённых файлов они не входят. */
    changed: patches.filter((patch) => patch.file !== "models").length,
    glow: patches.reduce((sum, patch) => sum + (patch.glow?.length || 0), 0),
    live: patches.find((patch) => patch.file === "models")?.live || 0,
  }),
};

/*
 * «Зоны каптов» (задача 8 ТЗ 10.10.2026, вечер) — шайбы мода `heix` над
 * районами каптов и ареной (`recolor-capt-zones.js`): свои модели формы мода
 * в облике работы, своя расстановка и манифест. Игра не нужна; «Стандарт»
 * снимает установку.
 */
SETS.captzones = {
  inventory: Object.freeze({ set: "captzones", title: "Зоны каптов", files: [] }),
  normalize: normalizeCaptZonesProject,
  lod: false,
  build: (project, resources, context) => buildCaptZonesFiles(project, { compile: context.compile, stateDir: context.stateDir }),
  summary: (project, patches) => ({
    zones: patches.find((patch) => patch.models)?.models.length || 0,
    own: captZonesOwnCount(project),
    opacity: project.opacity,
    glow: project.glow,
    height: project.height,
    roof: project.roof,
    distance: project.distance,
  }),
};

/*
 * «Расписание» (задача 11 ТЗ 10.10.2026, вечер) — табло сервера Majestic
 * (`recolor-schedule.js`): свои модели табло с листом, нарисованным окном,
 * на местах табло сервера, своя расстановка и манифест. Игра не нужна;
 * «Как на сервере» снимает установку.
 */
SETS.schedule = {
  inventory: Object.freeze({ set: "schedule", title: "Расписание", files: [] }),
  normalize: normalizeScheduleProject,
  lod: false,
  build: (project, resources, context) =>
    buildScheduleFiles(project, { sheet: context.pictures?.sheet || null, compile: context.compile, stateDir: context.stateDir }),
  summary: (project, patches) => ({
    models: patches.find((patch) => patch.models)?.models.length || 0,
    rows: changedScheduleRows(project).length,
    hidden: project.rows.filter((row) => row.hidden).length,
    glow: project.glow,
  }),
};

/*
 * «Флаги» (задача 7 ТЗ 10.10.2026, вечер) — флаги на флагштоках всей карты
 * (`recolor-flags.js`): штатные модели флагов игры игрока с тканью — лист
 * полотнища на месте (флаг страны или своя картинка), сетка, ткань и ветер —
 * байт в байт как в игре. Игра нужна всегда; «Стандарт» снимает установку.
 */
SETS.flags = {
  inventory: Object.freeze({ set: "flags", title: "Флаги", files: [] }),
  normalize: normalizeFlagsProject,
  needsGame: (project) => !flagsProjectIsStock(project),
  lod: false,
  build: (project, resources, context) => buildFlagFiles(project, { game: context.game, images: context.images }),
  summary: (project, patches) => ({
    kinds: changedFlagKinds(project).length,
    flags: changedFlagCount(project),
    changed: patches.length,
  }),
};

/*
 * Свои модели мест (задача 1 ТЗ 11.10.2026, вечер): где список в работе и
 * где в мире начало каждой сцены кадра (`null` — у сцены нет места в мире:
 * места маппинга, что ставит сервер).
 */
const PLACE_MODEL_SETS = Object.freeze({
  factory: { models: (project) => project.models, origin: () => FACTORY_INVENTORY.factory.centre },
  hangar: { models: (project) => project.models, origin: () => HANGAR_INVENTORY.hangar.centre },
  mapping: {
    models: (project) => project.models,
    origin: (scene) => (findMappingLocation(scene)?.placed ? MAPPING_INVENTORY.scenes.find((item) => item.id === scene)?.origin || null : null),
  },
  arenas: {
    models: (project) => project[project.server]?.models,
    origin: (scene, project) =>
      String(scene).startsWith(`${project.server}-`) ? arenaScene(project.server, String(scene).slice(project.server.length + 1))?.origin || null : null,
    /* Зал GTA 5 RP — помещение игры (v_int_62), залы Majestic — помещения
       сервера (их типы — в наборе, если подготовка их сняла): модели — их
       сущностями. */
    interior: (scene, project, game, resources, point) =>
      scene === "gta5rp-inside" && project.server === "gta5rp"
        ? arenaHallInterior(game)
        : scene === "majestic-inside" && project.server === "majestic"
          ? majesticHallInterior(resources, point)
          : null,
    /* Залы Majestic без типов помещений (ТЗ 11.10.2026, ночь): модели — в модель зала (`PLACE_MODEL_HALLS`). */
    hall: (scene, project, game, resources) => {
      const hall = PLACE_MODEL_HALLS[scene];
      return hall && scene === `${project.server}-inside` ? { file: hall.file, read: async () => resources.get(hall.resource) || null } : null;
    },
  },
  ...Object.fromEntries(BUILDING_SET_IDS.map((place) => [place, { models: (project) => project.models, origin: () => buildingOrigin(place) }])),
  vinewood: { models: (project) => project.models, origin: () => VINEWOOD_INVENTORY.scenes?.[0]?.origin || null },
  /*
   * «Интерьеры»: изнутри сцена — в осях помещения (начало — ноль), модель
   * встаёт сущностью его MLO во все магазины вида; снаружи — начало сцены
   * места, модель — своей картой.
   */
  shops: {
    models: (project) => project.models,
    origin: (scene) => {
      const where = shopModelScene(scene);
      return where?.inside ? [0, 0, 0] : where?.outside?.scene.origin || null;
    },
    interior: (scene, project, game) => shopModelInterior(scene, game),
  },
});

/*
 * Помещение зала GTA 5 RP для своих моделей: файл, MLO и его экземпляр в
 * мире. Места экземпляра в описи нет — оно выводится из звезды: её место в
 * сцене «внутри» (мир = начало сцены + точка) и в осях помещения.
 */
export function arenaHallInterior(game) {
  const inventory = arenaServerInventory("gta5rp");
  const interior = inventory?.interior;
  const star = inventory?.star;
  const origin = arenaScene("gta5rp", "inside")?.origin;
  if (!interior?.ytyp || !star?.local || !star?.point || !origin) return null;
  const rotation = interior.rotation || [0, 0, 0, 1];
  const turned = mloInstanceTransform({ position: [0, 0, 0], rotation })(star.local);
  const world = star.point.map((value, axis) => value + origin[axis]);
  return {
    file: interior.ytyp.split("/").pop(),
    mlo: Number(interior.name) >>> 0,
    instance: { position: world.map((value, axis) => value - turned[axis]), rotation },
    read: () => (game ? game.read(interior.ytyp) : Promise.resolve(null)),
  };
}

/*
 * Помещение Majestic, в котором стоит точка мира (задача 2 ТЗ 11.10.2026,
 * вечер): у каждого из трёх залов — свои типы и экземпляр (`mlos` описи);
 * берётся тот, в рамке которого точка, иначе ближайший. `null` — типов
 * залов в наборе нет (подготовка без архива сервера).
 */
export function majesticHallInterior(resources, point) {
  const mlos = (arenaServerInventory("majestic")?.mlos || []).filter((item) => resources?.has?.(`majestic/${item.ytyp}`));
  if (!mlos.length || !point) return null;
  /* Расстояние от точки до ближайшей комнаты помещения (ноль — точка в комнате): рамки комнат из его файла типов, оси помещения. */
  const distance = (item) => {
    const local = mloInstanceTransform({ position: [0, 0, 0], rotation: [-item.instance.rotation[0], -item.instance.rotation[1], -item.instance.rotation[2], item.instance.rotation[3]] })(
      point.map((value, axis) => value - item.instance.position[axis]),
    );
    const boxes = interiorRoomBoxes(resources.get(`majestic/${item.ytyp}`));
    if (!boxes.length) return Math.hypot(...local);
    return Math.min(...boxes.map((box) => Math.hypot(...local.map((value, axis) => Math.max(box.min[axis] - value, 0, value - box.max[axis])))));
  };
  /* Точка в комнатах нескольких помещений или ни в одной — ближайшее; при равенстве — с меньшим номером (порядок описи). */
  const best = mlos.reduce((found, item) => (distance(item) < distance(found) ? item : found));
  return {
    file: best.ytyp,
    ...(best.mlo ? { mlo: best.mlo } : {}),
    instance: best.instance,
    inside: distance(best) === 0,
    read: async () => resources.get(`majestic/${best.ytyp}`) || null,
  };
}

/* Картинка эмблемы: не больше 1024 px по длинной стороне и 8 МБ файла. */
const EMBLEM_LIMIT = Object.freeze({ bytes: 8 * 1024 * 1024, side: 1024 });

/**
 * Картинки работы из окна: `{ emblems: { <asset>: { data: base64 PNG/JPEG/WebP } } }`
 * → `{ emblems: Map(asset → { rgba, width, height }) }` (base64 — потому что
 * вход канала проходит через JSON, как у залазов и знака на килле). Нужна ли
 * картинка, решает работа: эмблема без картинки — отказ, лишняя не читается.
 */
export async function decodeRecolorImages(setId, project, images = {}) {
  /* Свои картинки отделки поверхностей (завод, ангар). */
  const surfaces =
    setId === "factory"
      ? FACTORY_GROUPS.map((group) => project[group.id])
      : setId === "hangar"
        ? [project.outside, project.inside, project.floor]
        : /* Отделка штатной парковки маппинга (ТЗ 17.10.2026). */
          setId === "mapping"
          ? Object.values(project.locations)
          : [];
  const assets = [...new Set(surfaces.filter((item) => item?.mode === "image" && item.image?.asset).map((item) => item.image.asset))];
  const finishes = assets.length ? await decodeFinishImages(assets, images?.finishes || {}) : new Map();
  if (setId === "factory") return { finishes, emblems: await decodeEmblemImages(factoryEmblemDecals(project), images) };
  if (setId === "mapping") return { finishes, emblems: await decodeEmblemImages(mappingEmblemDecals(project), images) };
  if (setId === "arenas") return decodeArenaImages(project, images || {});
  if (BUILDING_SET_IDS.includes(setId)) return decodeBuildingImages(setId, project, images || {});
  if (setId === "vinewood") return decodeVinewoodImages(project, images || {});
  /* Летающее лого: своя картинка или нарисованная окном надпись — одной картинкой. */
  if (setId === "floatlogo") return { pictures: floatLogoIsStock(project) ? {} : { logo: await decodeDecalImage(images?.logo, "Картинка лого") } };
  /* Дирижабли: лист надписи, нарисованный окном по работе (512 × 256), — когда
     в работе есть дирижабль со своей надписью (штатный или летающий). */
  if (setId === "airships") {
    const needsSheet = project.blimp.sign !== "game" && (project.game || project.fleet.blimp.count > 0);
    const pictures = needsSheet ? { sign: await decodeAirshipSheet(images?.sign) } : {};
    /* Лого и своя текстура своих моделей (ТЗ 11.10.2026, вечер): лист картинки вида, нарисованный окном. */
    const skins = AIRSHIP_KIND_IDS.filter((id) => project.fleet[id].count > 0 && airshipDecorated(id, project));
    if (skins.length) {
      pictures.skins = {};
      for (const id of skins) pictures.skins[id] = await decodeAirshipSheet(images?.skins?.[id], AIRSHIP_SKINS[id], `Лист картинки «${airshipKind(id).label}»`);
    }
    return { pictures };
  }
  /* Расписание: лист табло, нарисованный окном по работе (2048 × 1024). */
  if (setId === "schedule") return { pictures: scheduleIsStock(project) ? {} : { sheet: await decodeScheduleSheet(images?.sheet) } };
  /* Остановки: свои картинки отделки частей. */
  if (setId === "busstops") {
    const wanted = [...busStopsImageAssets(project).keys()];
    return { finishes: wanted.length ? await decodeFinishImages(wanted, images?.finishes || {}) : new Map() };
  }
  /* Интерьеры: свои картинки стен, пола и потолка меняемых помещений. */
  if (setId === "shops") {
    const wanted = [...shopsImageAssets(project).keys()];
    /* Снаружи (второй заход): ещё и эмблемы и надписи на фасадах — плашками. */
    return {
      finishes: wanted.length ? await decodeFinishImages(wanted, images?.finishes || {}) : new Map(),
      emblems: await decodeEmblemImages(shopsEmblemDecals(project), images),
    };
  }
  /* Банкоматы (задача 4 ТЗ 17.10.2026): свои картинки панели, экрана, вывески и полосы (ключи — как у отделки). */
  if (setId === "atms") {
    const wanted = [...atmsImageAssets(project).keys()];
    return { finishes: wanted.length ? await decodeFinishImages(wanted, images?.finishes || {}) : new Map() };
  }
  /* Флаги (задача 7 ТЗ 10.10.2026, вечер): свои картинки флагов, что уходят в игру (ключи — как у отделки). */
  if (setId === "flags") {
    const wanted = [...flagsImageAssets(project).keys()];
    return { finishes: wanted.length ? await decodeFinishImages(wanted, images?.finishes || {}) : new Map() };
  }
  /* Билборды: свои картинки щитов, что уходят в игру (ключи — как у отделки). */
  if (setId === "billboards") {
    const wanted = [...billboardsImageAssets(project).keys()];
    return { finishes: wanted.length ? await decodeFinishImages(wanted, images?.finishes || {}) : new Map() };
  }
  if (setId !== "hangar") return { finishes };
  return { finishes, emblems: await decodeEmblemImages(hangarEmblemDecals(project), images) };
}

/* Картинки эмблем работы по `asset`: нужные — разобраны, лишние не читаются. */
async function decodeEmblemImages(decals, images) {
  const out = new Map();
  for (const asset of emblemAssets(decals)) out.set(asset, await decodeEmblemImage(images?.emblems?.[asset]));
  return out;
}

/*
 * Картинки арены: отделка поверхностей (фасад, пол, стены, потолок) и свои
 * картинки разделов — эмблема на фасаде, экраны, таблички, эмблемы зала,
 * плакаты, звезда. Нужна ли картинка, решает работа (`arenaImageAssets`):
 * лишняя не читается.
 */
const ARENA_PICTURE_LABELS = Object.freeze({
  screens: "Картинка экранов",
  signs: "Картинка табличек",
  logos: "Картинка эмблем зала",
  posters: "Картинка плакатов",
  star: "Картинка звезды",
  mazeSign: "Надпись Maze Bank Arena",
  outLogos: "Картинка логотипа снаружи",
  outBanners: "Картинка баннеров у входов",
  sign: "Надпись на домике",
  mod: "Картинка листа мода",
});
async function decodeArenaImages(project, images) {
  const settings = project[project.server];
  const surfaces = ["facade", "floor", "walls", "ceiling"].map((id) => settings[id]);
  const assets = [...new Set(surfaces.filter((item) => item?.mode === "image" && item.image?.asset).map((item) => item.image.asset))];
  const finishes = assets.length ? await decodeFinishImages(assets, images?.finishes || {}) : new Map();
  const wanted = arenaImageAssets(project);
  const pictures = {};
  pictures.emblems = new Map();
  for (const asset of wanted.emblems || []) pictures.emblems.set(asset, await decodeEmblemImage(images?.emblems?.[asset]));
  /* Картинки разделов и их элементов (задача 10: `<раздел>:<элемент>`). */
  for (const key of Object.keys(wanted)) {
    if (key === "emblems") continue;
    const [section, element] = key.split(":");
    const label = ARENA_PICTURE_LABELS[section];
    if (!label) continue;
    pictures[key] = await decodeDecalImage(images?.[key], element && section !== "sign" ? `${label} (${element})` : label);
  }
  /* Свои модели вместо моделей сервера (Majestic) — тем же разбором, что «Модели» мест. */
  const models = arenaReplacementModels(project);
  const replacements = models.length ? await decodeModelsInBatches(models, images || {}) : null;
  return { finishes, pictures, ...(replacements ? { replacements } : {}) };
}

/*
 * Разбор картинок и сеток пачками по пределу списка «Моделей» (`PLACE_MODEL_LIMIT`): у арены их больше одного списка — замены сервера,
 * облики вещей (до шестнадцати групп) и картинки на элементах вещей, а `decodePlaceModelImages` берёт список «Моделей» места и хвост
 * сверх предела отбросил бы молча («Картинка не пришла» на «Применить»).
 */
async function decodeModelsInBatches(models, images) {
  const pictures = new Map();
  const meshes = new Map();
  for (let at = 0; at < models.length; at += PLACE_MODEL_LIMIT) {
    const part = await decodePlaceModelImages(models.slice(at, at + PLACE_MODEL_LIMIT), images);
    for (const [key, value] of part.pictures) pictures.set(key, value);
    for (const [key, value] of part.meshes) meshes.set(key, value);
  }
  return { pictures, meshes };
}

/*
 * Картинки здания: отделка частей, баннеры сторон (до 2048 px — лист
 * плашки), эмблемы и надписи общей системы (до 1024, по отпечатку — как у
 * завода и арены), текст надписи и табличек — картинками островов,
 * надпись-плашка. Нужна ли картинка, решает работа: лишняя не
 * читается, недостающая — отказ с понятной причиной.
 */
async function decodeBuildingImages(place, project, images) {
  const surfaces = [project.building, ...Object.values(project.parts || {})];
  const assets = [...new Set(surfaces.filter((item) => item?.mode === "image" && item.image?.asset).map((item) => item.image.asset))];
  const finishes = assets.length ? await decodeFinishImages(assets, images?.finishes || {}) : new Map();
  const pictures = {};
  const { emblems = [], walls = [], ...banners } = buildingImageAssets(project, place);
  for (const key of Object.keys(banners)) {
    /* Баннер широкой стены, что ложится панелями (задача 6Б), едет в полном разрешении — до 8192 px и 20 МБ. */
    const wide = key.startsWith("side:") && buildingSideUsesPanels(project, place, key.slice("side:".length));
    pictures[key] = await decodeDecalImage(images?.[key], "Картинка баннера", wide ? WALL_IMAGE_LIMIT : null);
  }
  pictures.emblems = new Map();
  for (const asset of emblems) pictures.emblems.set(asset, await decodeEmblemImage(images?.emblems?.[asset]));
  /* Развёрнутые стены (3В): плашка до 2048 px, не эмблема (у эмблем потолок 1024). */
  pictures.walls = new Map();
  for (const asset of walls) pictures.walls.set(asset, await decodeDecalImage(images?.walls?.[asset], "Картинка стены", WALL_PLATE_LIMIT));
  for (const job of buildingTextJobs(project, place))
    for (const [regionIndex, region] of job.regions.entries())
      for (let islandIndex = 0; islandIndex < region.islands.length; islandIndex += 1) {
        const key = `text:${job.key}:${regionIndex}:${islandIndex}`;
        pictures[key] = await decodeDecalImage(images?.[key], "Картинка надписи");
      }
  /* Плашки поверх объёмных букв (название и таблички-модели). */
  for (const job of buildingCoverJobs(project, place)) pictures[job.key] = await decodeDecalImage(images?.[job.key], "Картинка надписи");
  /* Места разошедшихся надписей и табличек со своим текстом (фикс 3): окно
     рисует их картинками `mark:…`, без разбора здесь установка отказывала
     «Картинка надписи не пришла». */
  for (const mark of buildingTextPlates(project, place))
    if (mark.kind === "text") pictures[mark.key] = await decodeDecalImage(images?.[mark.key], "Картинка надписи");
  const title = buildingTitle(place);
  if (title?.kind === "plate" && project.title.mode === "text" && project.title.lines.some((line) => line.trim())) {
    const aspect = Number(images?.title?.aspect);
    pictures.title = { ...(await decodeDecalImage(images?.title, "Картинка надписи")), aspect: Number.isFinite(aspect) ? Math.min(12, Math.max(1, aspect)) : 4 };
  }
  return { finishes, pictures };
}

/*
 * Картинки надписи на холме: маски глифов окна (`glyph:<n>` — PNG с альфой и
 * высота заглавных, базовая линия, края чернил в пикселях маски) и логотип.
 * Маски — не больше 2048 px; лишняя картинка не читается.
 */
const GLYPH_LIMIT = Object.freeze({ side: 2048, cap: [24, 1024] });
async function decodeVinewoodImages(project, images) {
  const pictures = {};
  if (vinewoodProjectIsStock(project)) return { pictures };
  if (project.mode === "logo") pictures.logo = await decodeDecalImage(images?.logo, "Картинка логотипа");
  if (project.mode !== "text") return { pictures };
  const chars = [...project.text];
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] === " ") continue;
    const image = images?.[`glyph:${index}`];
    /* Знака нет в шрифте — окно его не рисует, он встанет пробелом. */
    if (!image) continue;
    const data = typeof image?.data === "string" ? image.data : "";
    if (!data || data.length > Math.ceil((4 * 1024 * 1024) / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("Буквы надписи не пришли — нажмите «Применить» ещё раз.");
    let decoded;
    try {
      decoded = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: GLYPH_LIMIT.side * GLYPH_LIMIT.side }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch {
      throw new RangeError("Буква надписи — не картинка: нажмите «Применить» ещё раз.");
    }
    const { data: pixels, info } = decoded;
    const cap = Number(image.cap);
    const baseline = Number(image.baseline);
    const ink = Array.isArray(image.ink) ? image.ink.map(Number) : [];
    if (info.width > GLYPH_LIMIT.side || info.height > GLYPH_LIMIT.side) throw new RangeError("Буква надписи больше 2048 px.");
    if (!Number.isFinite(cap) || cap < GLYPH_LIMIT.cap[0] || cap > GLYPH_LIMIT.cap[1] || !Number.isFinite(baseline) || baseline < 1 || baseline > info.height)
      throw new RangeError("У буквы надписи нет высоты заглавных — нажмите «Применить» ещё раз.");
    if (ink.length !== 2 || !ink.every(Number.isFinite) || ink[0] < 0 || ink[1] > info.width || ink[1] <= ink[0]) throw new RangeError("У буквы надписи нет краёв.");
    const alpha = new Uint8Array(info.width * info.height);
    for (let at = 0; at < alpha.length; at += 1) alpha[at] = pixels[at * 4 + 3];
    pictures[`glyph:${index}`] = { alpha, width: info.width, height: info.height, cap, baseline, ink };
  }
  return { pictures };
}

/* Картинка эмблемы из окна: base64 PNG/JPEG/WebP → RGBA не больше 1024 px. */
async function decodeEmblemImage(image) {
  const data = typeof image?.data === "string" ? image.data : "";
  if (!data) throw new Error("Картинка эмблемы не пришла — выберите её ещё раз.");
  if (data.length > Math.ceil(EMBLEM_LIMIT.bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new RangeError("Картинка эмблемы не читается или больше 8 МБ.");
  let decoded;
  try {
    decoded = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: 64 * 1024 * 1024 })
      .rotate()
      .resize(EMBLEM_LIMIT.side, EMBLEM_LIMIT.side, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new RangeError("Эмблема — не картинка (нужны PNG, JPEG или WebP).");
  }
  const { data: pixels, info } = decoded;
  return { rgba: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), width: info.width, height: info.height };
}

/* Предел картинки стены-плашки (3В): 2048 px по длинной стороне — лист плашки, 8 МБ файла. */
const WALL_PLATE_LIMIT = Object.freeze({ side: 2048, bytes: 8 * 1024 * 1024 });

/* Предел картинки баннера широкой стены: 8192 px по длинной стороне, 20 МБ файла (как `WALL_IMAGE_LIMITS` окна). */
const WALL_IMAGE_LIMIT = Object.freeze({ side: 8192, bytes: 20 * 1024 * 1024 });

/* Картинка наклейки из окна (надпись рисует окно): PNG base64 → RGBA. `limit` — свой предел (`WALL_IMAGE_LIMIT`). */
async function decodeDecalImage(image, label, limit = null) {
  const data = typeof image?.data === "string" ? image.data : "";
  const bytes = limit?.bytes || EMBLEM_LIMIT.bytes;
  const side = limit?.side || EMBLEM_LIMIT.side * 2;
  if (!data) throw new Error(`${label} не пришла — нажмите «Применить» ещё раз.`);
  if (data.length > Math.ceil(bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new RangeError(`${label} не читается или больше ${Math.round(bytes / 1048576)} МБ.`);
  try {
    const { data: pixels, info } = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: 64 * 1024 * 1024 })
      .rotate()
      .resize(side, side, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { rgba: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), width: info.width, height: info.height };
  } catch {
    throw new RangeError(`${label} — не картинка.`);
  }
}

/*
 * Лист «Дирижаблей» из окна: PNG ровно своего размера, без вписывания —
 * лист надписи дирижабля (512 × 256, как у игры) или лист картинки своей
 * модели (`AIRSHIP_SKINS`).
 */
async function decodeAirshipSheet(image, { width, height } = AIRSHIP_SIGN_SIZE, label = "Лист дирижабля") {
  const data = typeof image?.data === "string" ? image.data : "";
  if (!data) throw new Error(`${label} не пришёл — нажмите «Применить» ещё раз.`);
  if (data.length > Math.ceil(EMBLEM_LIMIT.bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new RangeError(`${label} не читается или больше 8 МБ.`);
  let decoded;
  try {
    decoded = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: width * height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new RangeError(`${label} — не картинка.`);
  }
  const { data: pixels, info } = decoded;
  if (info.width !== width || info.height !== height || info.channels !== 4)
    throw new RangeError(`${label} — ${info.width} × ${info.height}, а нужен ${width} × ${height}.`);
  return { rgba: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), width, height };
}

/* Лист «Расписания» из окна: PNG ровно размера листа модели, без вписывания. */
async function decodeScheduleSheet(image) {
  const data = typeof image?.data === "string" ? image.data : "";
  if (!data) throw new Error("Лист расписания не пришёл — нажмите «Применить» ещё раз.");
  if (data.length > Math.ceil(EMBLEM_LIMIT.bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new RangeError("Лист расписания не читается или больше 8 МБ.");
  let decoded;
  try {
    decoded = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: SCHEDULE_SHEET.width * SCHEDULE_SHEET.height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new RangeError("Лист расписания — не картинка.");
  }
  const { data: pixels, info } = decoded;
  if (info.width !== SCHEDULE_SHEET.width || info.height !== SCHEDULE_SHEET.height || info.channels !== 4)
    throw new RangeError(`Лист расписания — ${info.width} × ${info.height}, а нужен ${SCHEDULE_SHEET.width} × ${SCHEDULE_SHEET.height}.`);
  return { rgba: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), width: info.width, height: info.height };
}

/* Что сделала изоляция места — для итога «Применить» и журнала. */
function isolationSummary(report) {
  return {
    copies: report.copies.length,
    clones: report.clones,
    entities: report.entities,
    maps: report.maps,
    ...(report.dropped.length ? { dropped: report.dropped.length } : {}),
    types: report.types,
    ...(report.mismatched ? { mismatched: report.mismatched } : {}),
    ...(report.skipped.length ? { skipped: report.skipped.slice(0, 8) } : {}),
  };
}

/* Что сделала дальняя прорисовка — для итога «Применить» и журнала. */
function lodSummary(report) {
  return {
    levels: report.levels.filter((item) => item.near).length,
    files: report.files.length,
    painted: report.paintedTexels,
    blocked: report.blockedTexels,
    isolated: report.isolated.reduce((sum, item) => sum + item.archetypes, 0),
    skipped: report.skipped.slice(0, 8),
  };
}

/*
 * Наборы без файлов мода: всё собирается из игры игрока своим сборщиком и
 * ставится своим пакетом движка. Вода — плитки тумана и квады в update.rpf,
 * туман рек в контейнере (`recolor-water.js`).
 */
const GAME_SETS = Object.freeze({
  water: Object.freeze({
    container: WATER_CONTAINER,
    isModId: isWaterModId,
    install: "installWater",
    async build(input, { gameRoot, stateDir, tools, onProgress }) {
      const game = await (tools.openWaterGame || openWaterGame)({ gameRoot, stateDir, readState: tools.readState });
      try {
        /* Плитки тумана красит движок (`water-engine-build.js`): готовый exe поставки или сборки разработчика; нет его — прежний код в пуле потоков. */
        const executable =
          tools.waterEngineExecutable !== undefined ? tools.waterEngineExecutable : resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) });
        return await buildWaterPackage(input?.project, stateDir, { game, onProgress, engine: executable ? { executable } : null });
      } finally {
        await game.close?.().catch(() => {});
      }
    },
  }),
  /* Растительность — листва, карточки вдали, трава и земля Сэнди-Шорс;
     «Реалистичные деревья» и зелёные листы «Травы по миру» — из складов поставки
     (`recolor-vegetation.js`). */
  vegetation: Object.freeze({
    container: VEGETATION_CONTAINER,
    /* Свой пакет дополнения (задача 10): основу собирает приложение. */
    archive: VEGETATION_ARCHIVE,
    host: "vegetationHost",
    /* Игра должна открыть собранные пакеты: строгая самопроверка до записи в игру (26.10.2026). */
    verifyOwnDlc: true,
    /* «В разнобой»: работа с постоянными типами копий ставится на свою основу (запросы типов). */
    hostOptions: (built) => ({ variety: vegetationNeedsVarietyHost(built?.manifest), thirdPack: vegetationNeedsThirdPack(built?.manifest) }),
    isModId: isVegetationModId,
    install: "installVegetation",
    async build(input, { gameRoot, stateDir, tools, onProgress, targetId, signal = null }) {
      const project = normalizeVegetationProject(input?.project);
      /* Растительность в контейнеры update.rpf (GTA 5 RP, `ASTRAL_VEGETATION_VIA_UPDATE=container`): без выключателя — `null`, и всё как всегда. */
      const container = await vegetationContainerRequest({
        statUpdate: async () => (await fs.stat(path.join(gameRoot, "update", "update.rpf"))).size,
        /* Носитель `update2.rpf` (`ASTRAL_VEGETATION_VIA_UPDATE=carrier`): длина настоящего файла цели, в ней уже стоящие дороги. */
        /* Длина настоящего файла носителя: без аргумента — update2.rpf, штатный пакет (`ASTRAL_CARRIERS`) — по своей цели. */
        statCarrier: async (carrierTarget = "update/update2.rpf") => (await fs.stat(path.join(gameRoot, ...String(carrierTarget).split("/")))).size,
        /* Имена с одноимённым файлом в штатных паках (старшинство паков): читается только когда включён пак-носитель. */
        readOverlap: () => readStockPackSeniority({ gameRoot, stateDir }),
        readSubpackHost: (carrier) => readHostSubpackInfo({ gameRoot, carrier }),
        readState: tools.readState,
        targetId,
        stateDir,
      });
      /* Режим включился сам (`rp-mode-channel.js`): отказ режима уходит строкой в журнал, растительность ставится прежним путём (ниже); явный выключатель отказывает, как раньше. */
      /* Откат на прежний пакет не тихий: ответ несёт `rpFallback` (`rp-fallback.js`), окно говорит, что на GTA 5 RP работы не видно. */
      let fallbackCode = vegetationFellBackToPacks(container) ? "packs-standing" : null;
      if (container) {
        const { built, fellBack, refusal } = await viaContainerOrOld({
          auto: container.auto === true,
          container: () => buildVegetationViaUpdate({ project, container, gameRoot, stateDir, tools, onProgress, signal, targetId }),
          old: () => null,
          isRefusal: isVegetationContainerRefusal,
          note: (line) => console.warn(`[astral] ${line}`),
          label: "Растительность",
        });
        if (!fellBack) return built;
        fallbackCode = refusal?.code || "other";
      }
      const markFallback = (result) => (fallbackCode ? annotateRpFallback(result, rpFallbackInfo("vegetation", fallbackCode)) : result);
      /* Файлы других работ Astral (Завод, Маппинг, Вода, слои оптимизации)
         растительность собирает поверх их правок: её пакет грузится после
         update.rpf (задача 10). */
      const composed = await astralSetFiles({ gameRoot, stateDir, readState: tools.readState });
      /* Файлы стоящей растительности — память сборки: неизменившееся не
         пересобирается (`build-index.json`). */
      const stores = targetId
        ? vegetationStores(stateDir, await installedRecolor(tools.readState, stateDir, targetId, "vegetation").catch(() => []))
        : [];
      /* Сборка — в своём потоке (фикс 1 ТЗ 07.10.2026): главный поток окна
         больше не стоит минутами. Тесты подменяют чтение игры или потоки —
         тогда сборка идёт здесь же, как прежде. */
      if (!tools.openVegetationGame && !tools.vegetationPool)
        return markFallback(await (tools.buildVegetationOffThread || buildVegetationOffThread)({ project, stateDir, gameRoot, composed, stores }, { onProgress, compile: tools.compile, signal }));
      const game = await (tools.openVegetationGame || openVegetationGame)({
        gameRoot,
        stateDir,
        improved: project.improved.enabled,
        sandy: project.sandy.enabled,
      });
      /* Потоки сборки — на всех ядрах; в тестах их подменяют или выключают. */
      const makePool = tools.vegetationPool || (tools.openVegetationGame ? () => null : createVegetationPool);
      const pool = makePool({ project, sandy: Boolean(game.sandy) });
      try {
        return markFallback(await buildVegetationPackage(project, stateDir, { game, onProgress, composed, pool, stores, compile: tools.compile }));
      } finally {
        await pool?.close().catch(() => {});
        await game.close?.().catch(() => {});
      }
    },
  }),
  /*
   * Дороги — асфальт, грунтовки, тротуары и разметка по всей карте сразу
   * (задача 6 ТЗ 07.10.2026): словари карты игрока с перекрашенными листами
   * в двух своих пакетах дополнения (`recolor-roads.js`). Сборка — в своём
   * потоке; тесты подменяют её (`tools.buildRoads`).
   */
  roads: Object.freeze({
    container: ROADS_CONTAINER,
    archive: ROADS_ARCHIVE,
    host: "roadsHost",
    /* Игра должна открыть собранные пакеты дорог: строгая самопроверка до записи в игру (26.10.2026). */
    verifyOwnDlc: true,
    isModId: isRoadsModId,
    install: "installRoads",
    async build(input, { gameRoot, stateDir, tools, onProgress, signal = null, targetId = "" }) {
      const request = { project: input?.project, images: input?.images || null, stateDir, gameRoot };
      /* Дороги в контейнеры update.rpf (GTA 5 RP, `ASTRAL_ROADS_VIA_UPDATE=container`): без выключателя — `null`, и всё как всегда. */
      const container = await roadsContainerRequest({
        statUpdate: async () => (await fs.stat(path.join(gameRoot, "update", "update.rpf"))).size,
        /* Носитель `update2.rpf` (`ASTRAL_ROADS_VIA_UPDATE=carrier`): длина настоящего файла цели. */
        statCarrier: async (carrierTarget = "update/update2.rpf") => (await fs.stat(path.join(gameRoot, ...String(carrierTarget).split("/")))).size,
        /* Второй носитель раскладки по файлам — сам `update.rpf` (длина настоящего файла). */
        statSpill: async () => (await fs.stat(path.join(gameRoot, "update", "update.rpf"))).size,
        readOverlap: () => readStockPackSeniority({ gameRoot, stateDir }),
        readSubpackHost: (carrier) => readHostSubpackInfo({ gameRoot, carrier }),
        /* Запас деревьев в update.rpf: растительность с деревьями уже стоит — её деревья в живой длине, запас 0; иначе умолчание (`trees-reserve.js`). */
        readTreesReserve: async () => treesReserveFromWork(await readLayerWork({ stateDir, targetId, set: "vegetation" })),
        /* Запас под карты травы и цветы в update2.rpf: растительность с картами уже стоит — запас 0 (`mapsReserveFromWork`). */
        readMapsReserve: async () => mapsReserveFromWork(await readLayerWork({ stateDir, targetId, set: "vegetation" })),
        readState: tools.readState,
        targetId,
        stateDir,
      });
      const run = (given) =>
        tools.buildRoads ? tools.buildRoads(given, { onProgress }) : (tools.buildRoadsOffThread || buildRoadsOffThread)(given, { onProgress, signal });
      if (!container) {
        const built = await run(request);
        return roadsFellBackToPacks(container) ? annotateRpFallback(built, rpFallbackInfo("roads", "packs-standing")) : built;
      }
      /* Режим включился сам (`rp-mode-channel.js`): отказ режима (не влезло, глобальная разметка…) уходит строкой в журнал, а дороги ставятся прежним путём; явный выключатель отказывает, как раньше. */
      const { built, fellBack, refusal } = await viaContainerOrOld({
        auto: container.auto === true,
        container: async () => {
          /* Общие имена, что уже занимают другие работы Astral (растительность, билборды, места), дороги собирают ПОВЕРХ их файлов, а не штатных: иначе поздний носитель перекрыл бы дорожную копию штатным видом (или наоборот). */
          const standing = await astralSetFiles({ gameRoot, stateDir, readState: tools.readState, except: isRoadsModId });
          return run({ ...request, container, ...(standing.size ? { composed: [...standing] } : {}) });
        },
        old: () => run(request),
        isRefusal: isRoadsContainerRefusal,
        note: (line) => console.warn(`[astral] ${line}`),
        label: "Дороги",
      });
      if (fellBack) return annotateRpFallback(built, rpFallbackInfo("roads", refusal?.code || "other"));
      for (const line of built?.summary?.viaUpdate?.lines || []) console.warn(`[astral] ${line}`);
      return { ...built, viaUpdate: true };
    },
  }),
  /*
   * «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер, фаза 3) — интерьеры
   * Majestic и GTA 5 РП из файлов самого игрока, каждый в своём контейнере
   * `x64/astral/astral_proj_<номер>.rpf` (`project-interiors/install.js`).
   * Сборка читает папки игрока и его игру; тесты подменяют сборщик.
   */
  projectinteriors: Object.freeze({
    container: PROJECT_INTERIORS_CONTAINER_LABEL,
    isModId: isProjectInteriorsModId,
    install: "installProjectInteriors",
    async build(input, { gameRoot, stateDir, tools, onProgress, targetId }) {
      const build = tools.buildProjectInteriors || buildProjectInteriorsPackage;
      /* `targetId` — игра в состоянии движка: по ней сборка узнаёт, сколько места освободит прежний набор. */
      return build(input?.project, stateDir, { gameRoot, onProgress, keys: input?.keys, targetId, ...(tools.readState ? { tools: { readState: tools.readState } } : {}) });
    },
  }),
  /*
   * «Интерьеры Majestic RP» (Хелпер 7, 25.10.2026) — листы интерьеров сервера (сейчас казино), перекрашенные поверх файлов пака у самого
   * игрока, в контейнере `x64/astral/astral_majestic.rpf` под именами пака (`recolor-majestic-interiors.js`). Сборка читает папки игрока и
   * его игру; тесты подменяют сборщик.
   */
  majesticinteriors: Object.freeze({
    container: MAJESTIC_INTERIORS_CONTAINER_LABEL,
    isModId: isMajesticInteriorsModId,
    install: "installMajesticInteriors",
    /* Контейнер пишет .NET-помощник: корень на нуле, как у архивов игры (движок создаёт новый вложенный архив с корнем «по файлу» — `rpf-composer.js`, `composesOnEngine`). Убрать, когда движок пересоберут с исправлением `compose.rs`. */
    writer: "helper",
    async build(input, { gameRoot, stateDir, tools, onProgress, targetId }) {
      const build = tools.buildMajesticInteriors || buildMajesticInteriorsPackage;
      return build(input?.project, stateDir, { gameRoot, onProgress, keys: input?.keys, targetId, images: input?.images, ...(tools.readState ? { tools: { readState: tools.readState } } : {}) });
    },
  }),
  /*
   * Шрифты — библиотеки шрифтов Scaleform игры со своими глифами на своих
   * местах в update.rpf (`recolor-fonts.js`). Шрифт человека — шаблон из
   * Windows этого компьютера или свой файл, приехавший с работой.
   */
  fonts: Object.freeze({
    container: FONTS_LIBRARY_ENTRIES["font_lib_efigs_pc.gfx"],
    isModId: isFontsModId,
    install: "installFonts",
    async build(input, { gameRoot, stateDir, tools, onProgress }) {
      const game = await (tools.openFontsGame || openFontsGame)({ gameRoot, stateDir, readState: tools.readState });
      try {
        return await buildFontsPackage(input?.project, stateDir, {
          game,
          images: input?.images,
          onProgress,
          ...(tools.readFontTemplate ? { readTemplate: tools.readFontTemplate } : {}),
        });
      } finally {
        await game.close?.().catch(() => {});
      }
    },
  }),
});

export const RECOLOR_SET_IDS = Object.freeze([...Object.keys(SETS), ...Object.keys(GAME_SETS)]);

function setOf(id) {
  const set = SETS[id];
  if (!set || !RECOLOR_SETS[id]) throw new Error(`Набора перекраски «${id}» нет в этой версии Astral.`);
  return { ...set, trust: RECOLOR_SETS[id] };
}

/**
 * Где лежат файлы наборов: в собранном приложении — рядом с ресурсами, в
 * разработке — в репозитории. Переменная окружения — для тестов.
 */
export async function recolorResourceRoot(setId) {
  const candidates = [
    process.env.ASTRAL_RECOLOR_RESOURCES && path.join(process.env.ASTRAL_RECOLOR_RESOURCES, setId),
    process.resourcesPath && path.join(process.resourcesPath, "recolor", setId),
    path.resolve(dirname, "../../../resources/recolor", setId),
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(path.join(candidate, SETS[setId].inventory.files[0].name))) return candidate;
  throw new Error("Файлы набора не найдены рядом с приложением — переустановите Astral.");
}

/*
 * Опись дальней прорисовки набора (`resources/recolor-lod/<набор>.json`,
 * готовит `scripts/prepare-recolor-sets.mjs`): цепочки LOD моделей места,
 * маски общих листов и словари под изоляцию. Нет описи — набор ставится без
 * дальней прорисовки, как раньше.
 */
export async function readRecolorLod(setId) {
  const candidates = [
    process.env.ASTRAL_RECOLOR_LOD && path.join(process.env.ASTRAL_RECOLOR_LOD, `${setId}.json`),
    process.resourcesPath && path.join(process.resourcesPath, "recolor-lod", `${setId}.json`),
    path.resolve(dirname, "../../../resources/recolor-lod", `${setId}.json`),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const text = await fs.readFile(candidate, "utf8").catch(() => null);
    if (!text) continue;
    try {
      const lod = JSON.parse(text);
      if (lod?.set === setId && Array.isArray(lod.levels)) return lod;
    } catch {
      /* битая опись — как будто её нет */
    }
  }
  return null;
}

/*
 * Правка, которая ничего не меняет (облик мода), не трогает файл: иначе
 * модель пережалась бы заново — те же текстуры и свечение, но другие байты,
 * и «Как в моде» ставило бы не файлы автора, а их пересборку.
 */
function patchChangesNothing(source, name, patch) {
  const textures = Object.entries(patch.textures || {});
  if (textures.length) {
    const current = new Map(readResourceTextures(source, name).map((texture) => [texture.name.toLowerCase(), texture.payload]));
    for (const [texture, payload] of textures) {
      const existing = current.get(texture.toLowerCase());
      if (!existing || Buffer.compare(Buffer.from(existing), Buffer.from(payload)) !== 0) return false;
    }
  }
  const vectors = Object.entries(patch.vectors || {});
  if (vectors.length) {
    const parameters = readDrawableShaders(source).shaders.flatMap((shader) => shader.parameters);
    for (const [parameter, values] of vectors) {
      const hash = jenkinsHash(parameter.toLowerCase());
      const found = parameters.filter((parameter) => parameter.hash === hash);
      if (!found.length) return false;
      for (const parameter of found)
        for (const vector of parameter.vectors)
          if (values.some((value, axis) => Math.abs((vector[axis] ?? 0) - value) > 1e-6)) return false;
    }
  }
  return true;
}

/** Файлы набора под эту работу: правленые — на месте, остальные — как есть. */
export function buildRecolorFiles(setId, project, resources) {
  const set = setOf(setId);
  const patches = set.patches(project);
  const byFile = new Map(patches.map((patch) => [patch.file, patch]));
  const files = [];
  for (const { name } of set.inventory.files) {
    const source = resources.get(name);
    if (!source) throw new Error(`В наборе нет файла ${name}.`);
    const patch = byFile.get(name);
    /* Правку с пересборкой (`restyle` зон) делает сам набор. */
    if (!patch || patch.restyle) {
      files.push({ name, bytes: source });
      continue;
    }
    if (patchChangesNothing(source, name, patch)) {
      files.push({ name, bytes: source });
      continue;
    }
    /* Свечение правит только модель (.ydr) — у зон; текстуры — любой файл. */
    const { bytes } = Object.keys(patch.vectors || {}).length
      ? patchDrawable(source, { textures: patch.textures, vectors: patch.vectors })
      : patchResourceTextures(source, name, patch.textures);
    files.push({ name, bytes: Buffer.from(bytes) });
  }
  for (const file of byFile.keys())
    if (!set.inventory.files.some((item) => item.name === file)) throw new Error(`Правка для чужого файла ${file}.`);
  return { files, patches };
}

/* Архив сетевой карты места (`astral_<место>_mp.rpf`, `…_mp_metadata.rpf`): туда идут файлы, что игра включает наборами `GROUP_MAP`. */
const onPlacesMapStream = (entry) => /^astral_[a-z0-9]+_mp(?:_metadata)?\.rpf$/.test(String(entry?.entry || "").toLowerCase().split("/")[0]);

/** Файлы, что манифест места положил в архив сетевой карты (по списку игры): для записи переигрывания. */
function mappedNamesOf(manifest) {
  const nameOfSource = (file) => String(file.source).slice("payload/".length);
  const files = manifest.files || [];
  const names = new Set(files.map(nameOfSource));
  /* Фасад Majestic в сетевой карте (зеркало и словарь-наполнитель, 26.11.2026) — не по списку игры: «в сетевой карте» эти записи не числятся. */
  return new Set(files.filter((file) => onPlacesMapStream(file) && file.entry !== placesMirrorEntryOf(manifest.recolor?.set, nameOfSource(file), names)).map(nameOfSource));
}

/*
 * Фасад Мегамолла на сетевой карте (26.11.2026, `places-dlc.js`: `MAJESTIC_MIRROR_FILES`). DLC Majestic `mall_txt_repl` подменяет все семь файлов, поэтому
 * пакет Мегамолла везёт все семь: нетронутые работой — штатными из игры игрока. Иначе вблизи или вдали остался бы фасад Majestic, а модель без своего
 * словаря (и словарь без модели) в сетевую карту не идут.
 */
const MALL_BLOCK = "x64k.rpf:levels/gta5/_citye/scentral_01/sc1_22.rpf";
const MALL_DISTRICT = "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf";
export const MAJESTIC_STOCK_SOURCES = Object.freeze({
  megamall: Object.freeze({
    "sc1_22_mall_04bb.ydr": `${MALL_BLOCK}/sc1_22_mall_04bb.ydr`,
    "sc1_22_mall_dec.ydr": `${MALL_BLOCK}/sc1_22_mall_dec.ydr`,
    "sc1_22_hd.ytd": `${MALL_BLOCK}/sc1_22_hd.ytd`,
    "sc1_22_lod.ytd": `${MALL_BLOCK}/sc1_22_lod.ytd`,
    "sc1_22_slod1_children.ydd": `${MALL_DISTRICT}/sc1_22_slod1_children.ydd`,
    "sc1_lod_21_22_27_28_34_children.ydd": `${MALL_DISTRICT}/sc1_lod_21_22_27_28_34_children.ydd`,
    "sc1_lod_21_22_27_28_34_children.ytd": `${MALL_DISTRICT}/sc1_lod_21_22_27_28_34_children.ytd`,
  }),
});
/*
 * Новая раскладка фасада у этих мест — только с новым «Применить»: поставленное раньше подготовка игры не переставляет (слово ведущей 26.11.2026: первым на
 * Majestic подмену моделей увидит человек, поэтому по его нажатию). Автоперенос — после захода на Majestic: убрать место из списка и добирать в переносе
 * недостающие файлы фасада из игры.
 */
export const MAJESTIC_APPLY_ONLY_SETS = Object.freeze(["megamall"]);

/** Штатные файлы фасада из игры: `[{ name, bytes }]`, все до одного — половина фасада на сетевой карте хуже, чем ничего. */
async function majesticStockFiles(setId, game) {
  const found = [];
  const lost = [];
  for (const [name, at] of Object.entries(MAJESTIC_STOCK_SOURCES[setId] || {})) {
    const bytes = await game?.read(at).catch(() => null);
    if (bytes) found.push({ name, bytes });
    else lost.push(name);
  }
  if (lost.length) throw new Error(`Не прочитаны файлы игры (${lost.join(", ")}): без них место не встанет на Majestic — проверьте целостность игры.`);
  return found;
}

/**
 * Набор в кэше под хэшем содержимого: повторная сборка копий не плодит.
 * `openGame()` — чтение штатных файлов игры игрока (завод: «Стандарт» и
 * отделка); зовётся, только если работе они нужны.
 */
/** Читатель игры, что по имени файла отдаёт копию другой работы Astral (`readOverNeighbours`). */
export function withNeighbours(game, neighbours) {
  const nameOf = (at) => String(at).split("/").pop().toLowerCase();
  const read = async (at, ...rest) => {
    const name = nameOf(at);
    const other = neighbours.get(name);
    if (!other?.at) return game.read(at, ...rest);
    const bytes = await game.read(other.at).catch(() => null);
    if (bytes) return bytes;
    throw composedUnreadableError(name, other.at, "places");
  };
  /* Прочие методы читателя (`createGameReader`: verify, has, sizeOf, read, list, close): `has` и `sizeOf` по имени соседа смотрят в его копию (размер копии, а не штатного файла), `list` отдаёт имена каталога, не содержимое, `verify`
     и `close` — без имён файлов. `root` и `engineHooks` убраны: сборка билбордов движком (`billboards-engine-build.js`, `ASTRAL_BILLBOARDS_ENGINE=1`) читает игру по `game.root` сама и обошла бы соседа молча — с соседями идёт путь JS. */
  const has = async (at) => (neighbours.get(nameOf(at))?.at ? game.has(neighbours.get(nameOf(at)).at) : game.has(at));
  const sizeOf = async (at) => (neighbours.get(nameOf(at))?.at ? game.sizeOf(neighbours.get(nameOf(at)).at) : game.sizeOf(at));
  return { ...game, read, has, sizeOf, root: undefined, engineHooks: undefined };
}

export async function buildRecolorPackage(
  setId,
  input,
  stateDir,
  { resourceRoot = null, images = null, openGame = null, compile = null, readLod = null, readIsolation = null, held = null, over = null, neighbours = null, lights = null, mapNames: readMapNames = null } = {},
) {
  const set = setOf(setId);
  /* «Картинка» без файла не красит: поверхность встаёт «Стандартом» (как в кадре), а не отказ «картинка не пришла». */
  const normal = set.normalize(input);
  const project = BLANK_FINISH_SETS.includes(setId) ? settleBlankFinishes(normal) : normal;
  /* Набор без своих файлов (здания из игры) — читать рядом с приложением нечего.
     Файлы набора как они лежат рядом с приложением сверяются с описью (`set-resources.js`);
     набор с `resourceFiles` читает только нужные работе — арена GTA 5 RP собирается из игры,
     и устаревшие файлы Majestic ей не мешают. */
  const needed = set.resourceFiles ? set.resourceFiles(project) : set.inventory.files;
  const resources = needed?.length ? await readSetFiles(resourceRoot || (await recolorResourceRoot(setId)), needed, set.inventory.title) : new Map();
  const decoded = await decodeRecolorImages(setId, project, images || {});
  const lod = set.lod === false ? null : await (readLod || readRecolorLod)(setId);
  /* Своё место — своими копиями общих вещей (фикс 2 ТЗ 06.10.2026). */
  let isolation = await (readIsolation || readPlaceIsolation)(setId);
  const required = Boolean(set.needsGame?.(project));
  let game = null;
  if ((required || lod || isolation) && openGame) {
    try {
      game = await openGame();
      /* Нет ключей к архивам — говорим сразу: иначе чтения с `.catch(() => null)`
         у флагов, завода и соседей возвращают пусто, и человек читает «нет
         штатного файла — проверьте целостность игры» или «ставить нечего». */
      await game.verify?.();
      /* Файл другой работы Astral читается вместо штатного (`neighbours`); не читается — отказ словами, а не молча штатное. */
      if (neighbours?.size) game = withNeighbours(game, neighbours);
    } catch (error) {
      /* Без игры не собрать «Стандарт» и отделку; дальняя прорисовка
         без игры просто не едет. */
      if (required) throw error;
      await game?.close?.().catch(() => {});
      game = null;
    }
  }
  let built;
  /* Штатные файлы фасада для сетевой карты читаются, пока игра открыта; в пакет — после уступок, если работе есть что ставить. */
  let facadeStock = [];
  try {
    built = set.build
      ? await set.build(project, resources, {
          ...decoded,
          images: decoded.finishes || new Map(),
          game,
          lod: game ? lod : null,
          compile,
          stateDir: stateDir || os.tmpdir(),
          over,
          lights,
        })
      : buildRecolorFiles(setId, project, resources);
    /* Свои модели места — своими моделями, картой и типами в контейнере места. */
    const placeModels = PLACE_MODEL_SETS[setId];
    const models = placeModels?.models(project) || [];
    if (models.length) {
      const sources = await decodePlaceModelImages(models, images || {});
      built = await withPlaceModels(setId, models, built, {
        ...sources,
        origin: (scene) => placeModels.origin(scene, project),
        ...(placeModels.interior ? { interior: (scene, point) => placeModels.interior(scene, project, game, resources, point) } : {}),
        ...(placeModels.hall ? { hall: (scene) => placeModels.hall(scene, project, game, resources) } : {}),
        compile,
        stateDir: stateDir || os.tmpdir(),
      });
    }
    /* Карты вещей, которых нет в плане изоляции (здания, прицепы и реквизит, чьи модели стоят только в месте): вещи убираются и меняются по описи вещей набора. */
    if (isolation && (project.items?.length || project.removed?.length || set.removedPlaces?.(project)?.length)) isolation = { ...isolation, maps: [...new Set([...(isolation.maps || []), ...placeItemMaps(setId)])] };
    /* Облик вещей места: копии моделей — файлами набора, их клоны — в план изоляции (типы копий и переименование файлов делает она), сущности — на копии. */
    let itemCopies = null;
    if (set.placeItems && project.items?.length) {
      if (!isolation) throw new Error("Облик вещей места поставить нечем: у набора нет описи карт района.");
      /* Картинки и сетки обликов: модели групп и картинки на элементах — пачками, хвост сверх списка «Моделей» не теряется. */
      const itemSources = await decodeModelsInBatches(placeItemLookModels(project.items), images || {});
      itemCopies = await buildPlaceItemCopies({
        setId,
        items: project.items,
        modelOf: set.placeItems.modelOf,
        worldOf: set.placeItems.worldOf,
        game,
        compile,
        stateDir: stateDir || os.tmpdir(),
        sources: itemSources,
      });
      built = { ...built, files: [...built.files, ...itemCopies.files], patches: [...(built.patches || []), { file: "облик вещей", ...itemCopies.report }] };
      isolation = { ...isolation, clones: [...(isolation.clones || []), ...itemCopies.clones] };
    }
    /* Общие словари и вещи, что игра ставит и вне места, — копиями под
       своими именами, сущности места — на копии (`place-isolation.js`). */
    if (isolation) {
      const local = await localizePlaceFiles(setId, built.files, {
        plan: isolation,
        game,
        compile,
        stateDir: stateDir || os.tmpdir(),
        unchanged: (name, bytes) => {
          const source = resources.get(name);
          return Boolean(source) && Buffer.compare(Buffer.from(source), Buffer.from(bytes)) === 0;
        },
      });
      built = { ...built, files: local.files, isolationReport: local.report };
    }
    /* Вещи со своим обликом: сущности в картах района — на копии. Не нашлась хоть одна — файлы игры не той версии: вещь осталась бы прежней. */
    if (itemCopies?.entities.length) {
      const done = await repointPlaceEntities(built.files, { plan: isolation, game, entities: itemCopies.entities });
      if (done.report.mismatched)
        throw new Error(`Вещи с обликом не нашлись в картах игры (${done.report.mismatched} из ${itemCopies.entities.length}): файлы игры не той версии — проверьте целостность игры.`);
      built = { ...built, files: done.files, patches: [...(built.patches || []), { file: "карты района", itemsRepointed: done.report.repointed, maps: done.report.maps }] };
    }
    /* Вещи, убранные по одной: их сущности в картах района прячутся (`place-isolation.js: hidePlaceEntities`). Не нашлась хоть одна —
       файлы игры не той версии: молча оставить вещь на месте значило бы соврать, что она убрана. */
    const hidden = set.removedPlaces?.(project) || [];
    if (hidden.length) {
      if (!isolation) throw new Error("Вещи места убрать нечем: у набора нет описи карт района.");
      const done = await hidePlaceEntities(built.files, {
        plan: isolation,
        game,
        entities: hidden.map((item) => ({ archetype: joaatName(item.model), position: item.position })),
      });
      if (done.report.mismatched)
        throw new Error(`Убранные вещи не нашлись в картах игры (${done.report.mismatched} из ${hidden.length}): файлы игры не той версии — проверьте целостность игры.`);
      built = {
        ...built,
        files: done.files,
        patches: [...(built.patches || []), { file: "карты района", hidden: done.report.hidden, maps: done.report.maps }],
        hiddenReport: done.report,
      };
    }
    if (built.files.length && MAJESTIC_STOCK_SOURCES[setId]) facadeStock = await majesticStockFiles(setId, game);
  } finally {
    await game?.close?.().catch(() => {});
  }
  const { patches } = built;
  /* Файлы, что уже везёт другой поставленный набор, уступаются ему. */
  const yielded = yieldedFiles(built.files, held, lod);
  const own = built.files.filter((file) => !yielded.names.has(file.name.toLowerCase()));
  if (!own.length) throw new Error("Всё как в игре — ставить нечего: снимите набор «Откатить».");
  /* Фасад Majestic — все семь, нетронутые штатными. Модель-наполнитель — на старте и в сетевой карте; словарь-наполнитель (и уступленный другому набору) —
     только в сетевой карте: имя на старте остаётся свободным для «Билбордов». */
  const present = new Set(own.map((file) => file.name.toLowerCase()));
  const files = [...own, ...facadeStock.filter((file) => !present.has(file.name)).map((file) => ({ ...file, filler: true, mapOnly: isMajesticFillerDictionary(setId, file.name) }))];
  /* Сторож краша для всех наборов: модель без группы шейдеров GTA не
     переживает (пустышки мода арены роняли игру 03.10.2026). */
  const unsafe = unsafeDrawables(files);
  if (unsafe.length) throw new Error(`Модель без шейдеров не поедет в игру — она уронила бы GTA: ${unsafe.join(", ")}.`);
  const described = files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: sha256(file.bytes), ...(file.mapOnly ? { mapOnly: true } : {}) }));
  /* Места с архивами сетевой карты: кроме `hei_` туда идут и файлы, что игра включает наборами `GROUP_MAP` (`game-map-names.js`, 26.10.2026). Игру прочитать
     не вышло — прежнее правило `hei_`. */
  const mapNames = PLACES_MAP_SETS.includes(setId) && typeof readMapNames === "function" ? (await Promise.resolve(readMapNames()).catch(() => null)) || null : null;
  const manifest = buildRecolorManifest(setId, described, { mapNames });
  if (!isLocalRecolorManifest(manifest, "Legacy")) throw new Error("Собранный набор не прошёл строгую проверку доверия.");
  const mapped = mappedNamesOf(manifest);
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "recolor",
    setId,
    "packages",
    manifest.recolor.sourceDigest.slice("sha256:".length, "sha256:".length + 16),
  );
  /* Разом и без переименования свежих файлов (`package-files.js`). */
  await writePackageFiles(
    files.map((file, index) => ({ target: path.join(packageRoot, "payload", file.name), bytes: file.bytes, sha256: described[index].sha256 })),
  );
  await pruneOldPackages(path.dirname(packageRoot), packageRoot, await replayPackageNames(stateDir, setId));
  return {
    setId,
    manifest,
    packageRoot,
    project,
    /* Отпечатки файлов пакета — для главного процесса, когда сборка шла в
       своём потоке (`recolor-build-host.js`). */
    /* `filler` — штатный наполнитель фасада Majestic: пакету мест он нужен, контейнеру update.rpf (GTA 5 RP) — нет (`places-update-install.js`). */
    payloadFiles: described.map((file, index) => ({ name: file.name, sha256: file.sha256, ...(files[index].filler ? { filler: true } : {}) })),
    /* Файлы пакета с размерами — для записи переигрывания (`recolorReplayRecord`). `mapped` — собрано по списку игры: файл в архиве сетевой карты (true) или в архиве
       на старте (false); без списка (запасное правило `hei_`) пометки нет. */
    files: described.map(({ name, size, sha256, mapOnly }) => ({ name, size, sha256, ...(mapNames ? { mapped: mapped.has(name) } : {}), ...(mapOnly ? { mapOnly } : {}) })),
    summary: {
      ...set.summary(project, patches),
      ...(built.lodReport ? { lod: lodSummary(built.lodReport) } : {}),
      ...(built.isolationReport ? { isolation: isolationSummary(built.isolationReport) } : {}),
      ...(built.modelsReport ? { models: built.modelsReport.models } : {}),
      ...(yielded.names.size ? { yielded: { files: yielded.names.size, owners: yielded.owners } } : {}),
      /* Собрано поверх поставленных модов (арена, 16.10): чьи файлы основа.
         `atop`, а не `over`: `over` ответа установки — моды каталога, что
         остались под работой на тех же записях (`apply`), и сводка его
         затирала. */
      /* Majestic не принимает пересобранные модели зала (`arena-shell-guard.js`): что не выражается перекраской листов — человеку словами. */
      ...(built.report?.safeModels ? { safeModels: summarySafeModels(built.report.safeModels) } : {}),
      ...(built.report?.over?.length
        ? { atop: { files: built.report.over.length, owners: [...new Set(built.report.over.map((item) => item.owner).filter(Boolean))] } }
        : {}),
    },
  };
}

/* Сводка защиты моделей сервера для окна: что не применено и какие модели остались штатными. */
function summarySafeModels(safe) {
  return {
    unexpressed: Object.fromEntries(Object.entries(safe.unexpressed || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : Number(value) || 1])),
    refused: (safe.refused || []).map((item) => item.name),
    /* Цвета поверхностей, поднятые до нижнего порога яркости (чисто чёрный в игре невидим). */
    lifted: (safe.lifted || []).map((item) => ({ group: item.group, from: item.from, to: item.to })),
    /* Полотна, что показаны пикселями листа (картинка владельца видна, без вшивки в модель зала). */
    onSheets: (safe.onSheets || []).length,
    /* Полотна, что стоят плашками-сущностями помещения зала (любая картинка, без делёжки острова). */
    entities: (safe.entities || []).length,
    /* Плиты «картинка → объём» на местах аирдропов (способ Б2): номера вещей. */
    slabs: (safe.slabs || []).length,
    /* Плиты перед экранами (arena10): откуда взято место (`offset` — смещение человека, `front` — перед экраном) и где встала. */
    screenPlates: (safe.screenPlates || []).map((plate) => ({ keys: plate.keys, source: plate.source, centre: plate.centre })),
  };
}

/*
 * Два контейнера Astral с одним и тем же файлом спорят, чей виден в игре, и
 * правка одного из наборов молча пропадает. Чаще всего это общие файлы
 * дальней прорисовки района (You Tool и самолёт «Маппинга» — оба в cs4_02):
 * файл, что уже везёт другой поставленный набор, остаётся ему; правка
 * типов изоляции (`ytyp`) уступается вместе с копиями словаря листов и
 * словарей моделей, которыми без неё никто не пользуется. `held` — `Map`
 * имя файла строчными → чей.
 */
export function yieldedFiles(files, held, lod = null) {
  const names = new Set();
  const owners = new Set();
  if (!held?.size) return { names, owners: [] };
  for (const file of files) {
    const key = file.name.toLowerCase();
    if (!held.has(key)) continue;
    names.add(key);
    owners.add(held.get(key));
  }
  for (const entry of lod?.isolate || []) {
    const taken = (entry.ytyps || []).some((address) => names.has(String(address).split("/").pop().toLowerCase()));
    if (!taken) continue;
    if (entry.copy) names.add(`${entry.copy}.ytd`.toLowerCase());
    for (const ydd of entry.ydds || []) if (ydd.copy) names.add(`${ydd.copy}.ydd`.toLowerCase());
  }
  return { names, owners: [...owners].sort() };
}

const SET_TITLES = Object.freeze({
  zones: "Зоны",
  factory: "Завод",
  hangar: "Ангар",
  mapping: "Маппинг",
  water: "Вода",
  vegetation: "Растительность",
  arenas: "Арена",
  megamall: "Мегамолл",
  youtool: "Ашан / Икея",
  vinewood: "Вайнвуд",
  busstops: "Остановки",
  mslzones: "МСЛ-зоны",
  floatlogo: "Летающее лого",
  /* «Дирижабли» (ТЗ 11.10.2026). */
  airships: "Дирижабли",
  shops: "Интерьеры",
  billboards: "Билборды",
  captzones: "Зоны каптов",
  schedule: "Расписание",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "Флаги",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "Банкоматы",
  fonts: "Шрифты",
  wallbang: "Прострелы",
  maps: "Залазы",
});

/**
 * Файлы поставленных модов каталога в update.rpf (`x64/astral/<архив>.rpf/
 * <имя>`): `Map` имя строчными → `{ at, owner }`. Набор с `overMods`
 * (арена, 16.10) собирает свои файлы поверх них, а не из игры: его пакет
 * мест грузится после update.rpf и иначе закрыл бы мод штатной перекраской.
 * Позже поставленный мод с тем же файлом — главнее, как в игре.
 */
export async function modFilesUnder(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  const files = new Map();
  for (const item of state?.targets?.[targetId]?.installed || [])
    for (const entry of item?.archiveEntries || []) {
      if (String(entry?.target || "").toLowerCase() !== "update/update.rpf") continue;
      const place = String(entry?.entry || "").toLowerCase();
      if (!/^x64\/astral\/[a-z0-9_]+\.rpf\/[^/]+$/.test(place)) continue;
      files.set(place.split("/").pop(), { at: `update:${place}`, owner: String(item.modId || "") });
    }
  return files;
}

/**
 * Файлы других мест пакета мест Astral, что стоят в игре: `Map` имя файла
 * строчными → название раздела. Своё место не в счёт. Места, что ещё лежат
 * в контейнерах update.rpf (поставлены до 06.10.2026), не в счёт тоже:
 * пакет мест грузится после update.rpf, и его файл в игре всё равно главнее.
 */
export async function heldByOtherSets(readState, stateDir, targetId, setId) {
  const state = await readState({ stateDir });
  const held = new Map();
  for (const item of state?.targets?.[targetId]?.installed || [])
    for (const entry of item?.archiveEntries || []) {
      if (String(entry?.target || "").toLowerCase() !== PLACES_DLC_TARGET) continue;
      /* `_mp` — архивы сетевой карты места (12.10.2026): это то же место, а
         не место «hangar_mp» — иначе свои hei_ файлы ангар уступал себе же,
         и набор без них не проходил проверку доверия. */
      const match = /^astral_([a-z0-9_]+?)(?:_mp)?(?:_metadata)?\.rpf\/(.+)$/i.exec(String(entry?.entry || ""));
      if (!match || match[1].toLowerCase() === setId) continue;
      const owner = match[1].toLowerCase();
      const name = match[2].split("/").pop().toLowerCase();
      /* Словарь фасада Majestic в сетевой карте имени не занимает (26.11.2026): штатный наполнитель стоит только там, а крашеный занят записью на старте.
         Иначе «Билборды», поставленные после Мегамолла, уступили бы ему свои щиты на этих листах. */
      if (isMajesticFillerDictionary(owner, name) && String(entry.entry).toLowerCase().startsWith(`astral_${owner}_mp.rpf/`)) continue;
      /* `_manifest.ymf` у каждого контейнера свой (связь его карты плашек с
         его типами), общим файлом он не бывает. Уступленный «Заводу» или
         «Ангару», он пропадал у Мегамолла, «Ашана» и Арены, и их плашки —
         стороны, надписи, эмблемы, щиты — в игре не появлялись (05.10.2026). */
      if (name === CONTAINER_MANIFEST) continue;
      held.set(name, SET_TITLES[owner] || owner);
    }
  return held;
}

const CONTAINER_MANIFEST = "_manifest.ymf";

/*
 * Собранный набор нужен только между планом и установкой: движок кладёт
 * файлы пакета в своё хранилище. Старые папки уходят, несколько последних
 * остаются — планы ещё не нажатых «Применить».
 */
/*
 * Пакеты набора, на которые ссылается установленная работа (`engineReplay`, шаг 3 фазы 7): их не
 * уносит ни уборка, ни снятие — иначе «Установить снова» переиграть будет нечем.
 */
async function replayPackageNames(stateDir, setId) {
  const profile = await inspectProfile({ stateDir }).catch(() => null);
  /* Состояние не прочиталось — `null`: тогда ничего не удаляем. */
  if (!profile) return null;
  const names = new Set();
  for (const target of Object.values(profile?.targets || {}))
    for (const item of target?.installed || []) {
      const replay = item?.engineReplay;
      if (replay?.module === "recolor-customizer" && replay.order?.setId === setId)
        names.add(String(replay.sourceDigest || "").slice("sha256:".length, "sha256:".length + 16));
    }
  return names;
}

async function pruneOldPackages(directory, current, keep = new Set()) {
  if (keep === null) return;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (full === current || keep.has(entry.name)) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}

/*
 * После установки собранный пакет больше не нужен: движок переложил его
 * файлы в своё хранилище (`payloads/<мод>/<sha256>`), и состояние ссылается
 * только туда. Папка пакета была ещё одной полной копией набора на диске
 * игрока — у растительности это сотни мегабайт (задача 5, 03.10.2026).
 * Папки, на которые ещё смотрят живые планы, остаются; брошенные убирает
 * уборка кэша (`cache-housekeeping.js`).
 */
async function releasePackage(built, plans, stateDir) {
  const root = path.resolve(built.packageRoot);
  for (const plan of plans.values()) if (path.resolve(plan.built.packageRoot) === root) return;
  const kept = await replayPackageNames(stateDir, built.setId);
  if (kept === null || kept.has(path.basename(root))) return;
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}

/* Размер пакета для журнала фаз установки: число файлов и их байты. */
async function packageSize(built) {
  const sizes = await Promise.all(
    built.manifest.files.map((file) =>
      fs.stat(path.join(built.packageRoot, file.source)).then(
        (stat) => stat.size,
        () => 0,
      ),
    ),
  );
  return `${built.manifest.files.length} файлов, ${megabytes(sizes.reduce((sum, size) => sum + size, 0))}`;
}

/* Ставится ровно то, что посчитано в манифесте. */
async function assertPackageIntact(built) {
  for (const file of built.manifest.files) {
    const payload = path.join(built.packageRoot, file.source);
    const actual = await fingerprintSha256(payload).catch(() => null);
    if (actual !== file.sha256)
      throw new Error(`Файл набора ${path.basename(payload)} изменился после проверки — нажмите «Применить» ещё раз.`);
  }
}

/* ------------------------------------------------------------------ *
 * Игра
 * ------------------------------------------------------------------ */

const defaultTools = () => ({
  discover: discoverGames,
  /* Имена, что игра включает только наборами `GROUP_MAP` (`game-map-names.js`, 26.10.2026), — для переноса поставленного дорог и растительности. */
  mapNames: readGameMapNames,
  /* Штатные файлы игры — прямым чтением архивов, только чтение. */
  openGame: async (gameRoot, stateDir) => {
    const keys = await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport });
    return createGameReader(gameRoot, await keysFromDirectory(keys || ""));
  },
  /* Нативный хост (плашка эмблемы завода) — его даёт мост окна. */
  compile: null,
  readState: inspectProfile,
  plan: planPackage,
  install: installLocalRecolorPackage,
  installWater: installLocalWaterPackage,
  installVegetation: installLocalVegetationPackage,
  installFonts: installLocalFontsPackage,
  installRoads: installLocalRoadsPackage,
  installProjectInteriors: installLocalProjectInteriorsPackage,
  installMajesticInteriors: installLocalMajesticInteriorsPackage,
  vegetationHost: prepareVegetationDlcHosts,
  /* Самопроверка своих пакетов до подмены файлов в игре (`dlc-archive-check.js`): набор подключает её флагом `verifyOwnDlc`. */
  verifyOwnDlc: ownDlcVerifier(),
  roadsHost: prepareRoadsDlcHosts,
  placesHost: preparePlacesDlcHost,
  refreshPlacesBase: refreshPlacesDlcBase,
  composeRpf: composeRpfArchive,
  installPrebuilt: installRpfPrebuilt,
  probeRpf: probeRpfArchive,
  provideContentXml: provideUpdateContentXml,
  provideDlcList: provideLegacyDlcList,
});

/* Установка идёт только в копию игры, которую подтвердил поиск Astral. */
async function confirmedGame(gameRoot, discover) {
  const games = await discover();
  const game = (games || []).find(
    (item) => item?.path && path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase(),
  );
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
    throw new Error("Наборы мастерской ставятся только в GTA V Legacy.");
  if (game.launcherState?.busy) throw new Error("Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.");
  return game;
}

/** Пакеты набора, которые движок числит за этой игрой. */
export async function installedRecolor(readState, stateDir, targetId, setId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  const own = GAME_SETS[setId] ? (modId) => GAME_SETS[setId].isModId(modId) : (modId) => isRecolorModId(modId, setId);
  return (target?.installed || []).filter((item) => own(item?.modId));
}

/*
 * Растительность ставится своим пакетом дополнения, а он грузится после
 * update.rpf: общие с ней дальние планы (Завод, Маппинг, Вода — 61 словарь
 * в зоне «Сэнди») в игре берутся из её сборки. Сколько файлов набора она
 * закрывает и какой её пакет — окно по этому собирает растительность заново
 * поверх новой правки (задача 10).
 */
export async function underVegetation(readState, stateDir, targetId, built, previous = []) {
  if (built.setId === "vegetation") return null;
  const [vegetation] = await installedRecolor(readState, stateDir, targetId, "vegetation");
  if (!vegetation) return null;
  const leaf = (entry) => String(entry || "").split("/").pop().toLowerCase();
  const names = new Set((vegetation.archiveEntries || []).map((entry) => leaf(entry?.entry)));
  /* Файлы и прежней установки набора (задача 3 ТЗ 10.10.2026): часть,
     вернувшаяся к «Стандарту», больше не едет, а растительность всё ещё
     держит её прежний вид — собрать её заново надо и тогда. */
  const files = new Set(
    [...built.manifest.files.map((file) => file.entry), ...previous.flatMap((item) => (item.archiveEntries || []).map((entry) => entry?.entry))]
      .map(leaf)
      .filter((name) => names.has(name)),
  ).size;
  return files ? { files, modId: vegetation.modId } : null;
}

/*
 * Ступень «Ухудшения текстур» — тоже свой пакет дополнения (задача 1 ТЗ
 * 05.10.2026), и собрана она из словарей работ Astral: перекрашенный
 * Мегамолл мылится в своём цвете. Набор сменил свои словари (или убрал их)
 * — ступень надо собрать заново, иначе пакет текстур показал бы прежний
 * вид. Сколько словарей набора и какой пакет ступени — окно по этому
 * ставит ту же ступень ещё раз.
 */
export async function underTextures(readState, stateDir, targetId, built, previous = []) {
  if (built.setId === "vegetation") return null;
  /* Места — в своём пакете выше ступени (107 > 105): их файлы игра берёт
     у места, ступень их не перекрывает, и пересобирать её незачем. */
  if (SETS[built.setId]) return null;
  const state = await readState({ stateDir });
  const textures = (state?.targets?.[targetId]?.installed || []).find((item) => isTexturesModId(item?.modId));
  if (!textures) return null;
  const leaf = (entry) => String(entry || "").split("/").pop().toLowerCase();
  /* Модели карты пакет везёт тоже (со своими текстурами внутри): модель
     набора, которая уже лежит в пакете ступени, пакет перекрыл бы прежним
     видом. Свои новые модели набора (плашки) в пакет не входят. */
  const packaged = new Set((textures.archiveEntries || []).map((entry) => leaf(entry?.entry)));
  const names = new Set(
    [...built.manifest.files.map((file) => file.entry), ...previous.flatMap((item) => (item.archiveEntries || []).map((entry) => entry?.entry))]
      .map(leaf)
      .filter((name) => name.endsWith(".ytd") || (/\.(?:ydr|ydd|yft)$/.test(name) && packaged.has(name))),
  );
  return names.size ? { files: names.size, modId: textures.modId } : null;
}

/*
 * Дороги — свои пакеты дополнения выше update.rpf (задача 6 ТЗ 07.10.2026):
 * словарь, который дороги везут, игра берёт у них. Работа, что правит те же
 * словари в update.rpf (вода — дальние планы со своим туманом), иначе
 * осталась бы в игре невидимой: дороги собираются заново поверх её новой
 * правки, той же работой. Места (пакет мест, 107), ступень текстур (105) и
 * растительность (110) выше дорог — им пересборка дорог не нужна.
 */
export async function underRoads(readState, stateDir, targetId, built, previous = []) {
  if (built.setId === "roads" || built.setId === "vegetation" || SETS[built.setId]) return null;
  const [roads] = await installedRecolor(readState, stateDir, targetId, "roads");
  if (!roads) return null;
  const leaf = (entry) => String(entry || "").split("/").pop().toLowerCase();
  const carried = new Set((roads.archiveEntries || []).map((entry) => leaf(entry?.entry)));
  const names = new Set(
    [...built.manifest.files.map((file) => file.entry), ...previous.flatMap((item) => (item.archiveEntries || []).map((entry) => entry?.entry))]
      .map(leaf)
      .filter((name) => carried.has(name)),
  );
  return names.size ? { files: names.size, modId: roads.modId } : null;
}

/* `hosts` — основы своих пакетов дополнения набора: `{ <опция движка>: путь }`. */
function engineOptions(built, gameRoot, targetId, stateDir, tools, hosts = null) {
  return {
    manifest: built.manifest,
    packageRoot: built.packageRoot,
    gameRoot,
    targetId,
    edition: "Legacy",
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    ...(typeof tools.probeRpf === "function" ? { rpfProbe: tools.probeRpf } : {}),
    ...(hosts || {}),
  };
}

/* Растительность в контейнерах update.rpf (GTA 5 RP): сборка идёт тем же потоком, с запросом режима (`vegetation-container-build.js`); строки о снятом — в журнал. */
async function buildVegetationViaUpdate({ project, container, gameRoot, stateDir, tools, onProgress, signal, targetId }) {
  const composed = await astralSetFiles({ gameRoot, stateDir, readState: tools.readState });
  const stores = targetId ? vegetationStores(stateDir, await installedRecolor(tools.readState, stateDir, targetId, "vegetation").catch(() => [])) : [];
  const built = await (tools.buildVegetationOffThread || buildVegetationOffThread)({ project, stateDir, gameRoot, composed, stores, container }, { onProgress, compile: tools.compile, signal });
  for (const line of built?.summary?.viaUpdate?.lines || []) console.warn(`[astral] ${line}`);
  return { ...built, viaUpdate: true };
}

/* Основы пакетов дополнения набора: растительность и дороги — по два своих
   пакета (задача 4 ТЗ 06.10.2026, задача 6 ТЗ 07.10.2026), места — пакет
   мест (фикс 1 ТЗ 06.10.2026). */
async function setHost(setId, { gameRoot, stateDir, tools, built = null }) {
  /* Дороги в контейнерах update.rpf пакетов не имеют: основы пакетов не готовятся. */
  if (built?.viaUpdate) return null;
  if (SETS[setId]) return { placesDlcHost: await tools.placesHost({ stateDir, gameRoot, edition: "Legacy", compile: tools.compile }) };
  if (!GAME_SETS[setId]?.host) return null;
  const extra = GAME_SETS[setId].hostOptions?.(built) || {};
  return tools[GAME_SETS[setId].host]({ stateDir, gameRoot, edition: "Legacy", ...(Object.keys(extra).length ? { ...extra, compile: tools.compile } : {}) });
}

/* Дороги в полосе штатного пака или подпакета: метка записи называет эту полосу (`x64/levels/gta5/astral_rp_road_<полоса>(_b|_c|_d).rpf` в её архиве), а не `x64/astral` у update2: это метка сводки, не путь записи, и в слова окна не идёт. */
const packLaneOf = (built) => {
  if (built.setId !== "roads") return null;
  for (const id of built.summary?.viaUpdate?.lanes || []) {
    const carrier = CARRIERS.find((item) => item.id === id);
    if (carrier && (carrier.registration === "pack-content" || carrier.registration === "pack-sub")) return carrier;
  }
  return null;
};

const summaryOf = (built) => ({
  set: built.setId,
  modId: built.manifest.id,
  entry: built.viaUpdate ? (packLaneOf(built) ? `x64/levels/gta5/astral_rp_road_${packLaneOf(built).id}(_b|_c|_d).rpf` : built.setId === "vegetation" ? "x64/astral/astral_rp_vegetation(_b).rpf" : "x64/astral/astral_rp_road(_b).rpf") : (GAME_SETS[built.setId] || RECOLOR_SETS[built.setId]).container,
  archive: built.viaUpdate ? (packLaneOf(built)?.target ?? "update/update.rpf") : GAME_SETS[built.setId]?.archive || RECOLOR_SETS[built.setId]?.archive || "update/update.rpf",
  /* Файлы работы, а не записи манифеста: у фасада Мегамолла их по две (на старте и зеркалом в сетевой карте). */
  files: new Set(built.manifest.files.map((file) => file.source)).size,
  edition: "Legacy",
  restartRequired: true,
  ...built.summary,
});

/*
 * Места, поставленные до 06.10.2026, лежат в контейнерах update.rpf
 * (`x64/astral/astral_<набор>.rpf`), и пакеты Rockstar перекрывают в игре их
 * типы и карты района: копия словаря дальних моделей не подключалась, и
 * вдали было видно штатное здание (фикс 1). Перенос — те же файлы работы из
 * хранилища движка, без пересборки и без окна: пакет места схемы 2 в пакете
 * мест, прежний уходит заменой. Ответ — `{ migrated: [{ set, from, to }] }`:
 * окно по нему переписывает свою запись установки на новый id.
 */
/*
 * Растительность и дороги (12.10.2026): их `hei_` файлы — районы mpheist,
 * которые игра включает только в сетевой карте, — теперь в архиве
 * `GROUP_MAP` своего пакета (`vegetationArchiveOf`, `roadsArchiveOf`).
 * Поставленное раньше лежит в частях на старте и переезжает тем же
 * переносом: те же файлы из хранилища движка, новый id. Переносится только
 * работа, что уже стоит в своих пакетах, — прежние раскладки уходят
 * заменой со следующей установкой, как раньше.
 *
 * С 26.10.2026 в архив сетевой карты идут и файлы без `hei_`, что игра включает только наборами `GROUP_MAP` (`apa_*`, `lr_*`, `xm_*`…): их список —
 * `mapNames` из игры игрока (`game-map-names.js`). Игру прочитать не вышло (`mapNames` — `null`) — прежнее правило `hei_`, и файлы, уже лежащие в архиве
 * сетевой карты, на месте и остаются: перенос не гоняет их туда и обратно из-за недоступных ключей.
 */
const onMapStream = (entry) => String(entry?.entry || "").toLowerCase().split("/")[0].endsWith("_mp.rpf");
/* Раскладка поставленной растительности: работа на три пакета — схема 5 (версия `5.…`) либо хоть один файл в третьем пакете. Перенос
   её не меняет: работа, что не поместилась в два пакета, в два и не вернётся. */
const vegetationLayoutOfInstalled = (item) =>
  /^5\./.test(String(item?.version || "")) || (item?.archiveEntries || []).some((entry) => String(entry?.target || "").toLowerCase() === VEGETATION_DLC_PACK_C.target)
    ? VEGETATION_LAYOUT_THREE_PACKS
    : VEGETATION_LAYOUT_TWO_PACKS;
const MOVING_GAME_SETS = Object.freeze({
  vegetation: Object.freeze({
    targets: VEGETATION_DLC_ALL_PACKS.map((pack) => pack.target),
    layoutOf: vegetationLayoutOfInstalled,
    route: (name, mapNames = null, layout = VEGETATION_LAYOUT_TWO_PACKS) => ({ target: vegetationPackOf(name, layout).target, entry: `${vegetationArchiveOf(name, mapNames, layout)}/${name}` }),
    build: (described, mapNames = null, layout = VEGETATION_LAYOUT_TWO_PACKS) => buildVegetationManifest(described, { mapNames, layout }),
    trusted: isLocalVegetationManifest,
    onMapStream,
  }),
  roads: Object.freeze({
    targets: ROADS_DLC_PACKS.map((pack) => pack.target),
    route: (name, mapNames = null) => ({ target: roadsPackOf(name).target, entry: `${roadsArchiveOf(name, mapNames)}/${name}` }),
    build: (described, mapNames = null) => buildRoadsManifest(described, { mapNames }),
    trusted: isLocalRoadsManifest,
    onMapStream,
  }),
});

/* Файл работы из хранилища движка — в пакет переноса жёсткой ссылкой: у
   растительности это гигабайты, и движок кладёт пакет из своей папки в
   хранилище тоже ссылкой. Другой том — копия. Размер — для манифеста. */
async function stageStoredFile(file, destination) {
  if ((await fingerprintSha256(file.cachePath)) !== file.sha256) throw new Error(`Файл ${file.name} в хранилище движка изменился.`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.link(file.cachePath, destination).catch(() => fs.copyFile(file.cachePath, destination));
  return (await fs.stat(destination)).size;
}

/* Перенос идёт один за раз: подготовку игры окно зовёт и при запуске, и по
   кнопкам — второй вызов ждёт первый и видит уже перенесённое. */
let migrationRunning = null;
export function migrateInstalledPlaces(input) {
  const run = (migrationRunning || Promise.resolve()).catch(() => {}).then(() => migratePlacesOnce(input));
  migrationRunning = run;
  return run;
}

async function migratePlacesOnce({ gameRoot, targetId, stateDir, tools: overrides = {}, onProgress = null, assertRuntimeSafety = null }) {
  const tools = { ...defaultTools(), ...overrides };
  const state = await tools.readState({ stateDir });
  const target = state?.targets?.[targetId];
  const migrated = [];
  const failed = [];
  if (!target) return { status: "no-target", migrated, failed };
  const nameOf = (entry) => String(entry?.entry || "").split("/").pop().toLowerCase();
  /* Имена `GROUP_MAP` игры — один раз на набор за вызов, и только если набор уже стоит (читает свой поток, кэш по отпечатку игры). */
  const mapNamesBySet = new Map();
  const mapNamesOf = async (setId) => {
    if (!mapNamesBySet.has(setId)) mapNamesBySet.set(setId, (await Promise.resolve(tools.mapNames?.({ setId, gameRoot, stateDir })).catch(() => null)) || null);
    return mapNamesBySet.get(setId);
  };
  for (const item of target.installed || []) {
    const gameSet = Object.keys(MOVING_GAME_SETS).find((id) => GAME_SETS[id].isModId(item?.modId)) || null;
    const moving = gameSet ? MOVING_GAME_SETS[gameSet] : null;
    const setId = gameSet || Object.keys(SETS).find((id) => isRecolorModId(item?.modId, id));
    if (!setId) continue;
    /* Переносится место, чьи файлы лежат не там, где их кладёт нынешняя
       схема: в контейнере update.rpf (до 06.10) или одним архивом пакета
       мест (схема 2 того же дня — она роняла игру на загрузке). */
    const entries = item.archiveEntries || [];
    /* Места с архивами сетевой карты (`PLACES_MAP_SETS`) читают список так же, как дороги и растительность: один список на все места (`placesMapCandidates`). */
    const mapped = moving ? moving.onMapStream : PLACES_MAP_SETS.includes(setId) ? onPlacesMapStream : null;
    const mapNames = mapped && entries.length ? await mapNamesOf(moving ? gameSet : "places") : null;
    /* Раскладка работы (у растительности — два пакета или три): место файла считается в ней же. */
    const layout = moving?.layoutOf ? moving.layoutOf(item) : undefined;
    const present = new Set(entries.map(nameOf));
    const mirrorOfEntry = (entry) => {
      const mirror = moving ? null : placesMirrorEntryOf(setId, nameOf(entry), present);
      return Boolean(mirror) && String(entry?.target).toLowerCase() === PLACES_DLC_TARGET && String(entry?.entry || "").toLowerCase() === mirror;
    };
    /* Мегамолл без фасада в сетевой карте (поставлен до 26.11.2026) в новую раскладку не переносится: она — только с новым «Применить». */
    const facade = !MAJESTIC_APPLY_ONLY_SETS.includes(setId) || entries.some(mirrorOfEntry);
    const current = (entry) => {
      /* Зеркало и наполнитель фасада Majestic на своём месте. */
      if (facade && mirrorOfEntry(entry)) return true;
      const route = moving ? moving.route(nameOf(entry), mapNames, layout) : recolorRouteOf(setId, nameOf(entry), mapNames, { facade });
      if (String(entry?.target).toLowerCase() === route.target && String(entry?.entry || "").toLowerCase() === route.entry.toLowerCase()) return true;
      /* Список из игры не прочитан: файл, уже лежащий в архиве сетевой карты своего пакета, остаётся там. */
      return Boolean(mapped && !mapNames && String(entry?.target).toLowerCase() === route.target && mapped(entry));
    };
    /* Файл фасада только в сетевой карте и не наполнитель — стена арены с 21.11 по 26.11: на старте её нет, и сюжет показывает штатную. Переносится. */
    const startNames = new Set(entries.filter((entry) => !mirrorOfEntry(entry)).map(nameOf));
    const mapOnlyFacade = facade && entries.some((entry) => mirrorOfEntry(entry) && !startNames.has(nameOf(entry)) && !isMajesticFillerDictionary(setId, nameOf(entry)));
    if (!entries.length || (entries.every(current) && !mapOnlyFacade)) continue;
    if (moving && !entries.every((entry) => moving.targets.includes(String(entry?.target).toLowerCase()))) continue;
    /* Место могли уже перенести или снять, пока шли предыдущие. */
    const now = await tools.readState({ stateDir });
    if (!(now?.targets?.[targetId]?.installed || []).some((current) => current?.modId === item.modId)) continue;
    let packageRoot = null;
    try {
      const files = [];
      const taken = new Set();
      for (const entry of entries) {
        const name = nameOf(entry);
        /* Зеркало — вторая запись того же файла: в пакет он идёт один раз. */
        if (taken.has(name)) continue;
        taken.add(name);
        const layer = (target.archives?.[entry.target]?.entries?.[entry.entry]?.layers || []).find((candidate) => candidate.modId === item.modId);
        if (!layer?.cachePath || !layer?.sha256) throw new Error(`Файла ${name} нет в хранилище движка.`);
        files.push({ name, cachePath: layer.cachePath, sha256: layer.sha256 });
      }
      packageRoot = path.join(stateDir, "recolor", setId, "packages", `migrate-${item.modId.slice(-12)}-${randomUUID().slice(0, 8)}`);
      const described = [];
      for (const file of files) {
        if (moving) {
          const size = await stageStoredFile(file, path.join(packageRoot, "payload", file.name));
          described.push({ name: file.name, size, sha256: file.sha256 });
          continue;
        }
        const bytes = await fs.readFile(file.cachePath);
        if (sha256(bytes) !== file.sha256) throw new Error(`Файл ${file.name} в хранилище движка изменился.`);
        await atomicWrite(path.join(packageRoot, "payload", file.name), bytes);
        /* Словарь-наполнитель фасада стоял только в сетевой карте — там и остаётся. */
        const mapOnly = facade && isMajesticFillerDictionary(setId, file.name) && entries.filter((entry) => nameOf(entry) === file.name).every(mirrorOfEntry);
        described.push({ name: file.name, size: bytes.length, sha256: file.sha256, ...(mapOnly ? { mapOnly } : {}) });
      }
      const manifest = moving ? moving.build(described, mapNames, layout) : buildRecolorManifest(setId, described, { mapNames, facade });
      if (!(moving ? moving.trusted(manifest, "Legacy") : isLocalRecolorManifest(manifest, "Legacy")))
        throw new Error("Перенесённый набор не прошёл строгую проверку доверия.");
      const built = { setId, manifest, packageRoot };
      /* Работе на три пакета нужна и основа третьего; у остальных перенос берёт основу как раньше. */
      const host = await setHost(setId, { gameRoot, stateDir, tools, built: layout === VEGETATION_LAYOUT_THREE_PACKS ? built : null });
      await (moving ? tools[GAME_SETS[setId].install] : tools.install)({
        ...engineOptions(built, gameRoot, targetId, stateDir, tools, host),
        replaceModIds: [item.modId],
        rpfComposer: tools.composeRpf,
        contentXmlProvider: tools.provideContentXml,
        dlcListProvider: tools.provideDlcList,
        assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
        onProgress,
        /* Перенесённое читается тем же читателем игры до подмены, что и обычная установка. */
        ...(moving && GAME_SETS[setId].verifyOwnDlc && typeof tools.verifyOwnDlc === "function" ? { dlcVerifier: tools.verifyOwnDlc } : {}),
      });
      /* Запомненная работа пакета (пересборка поверх других наборов) — на новый id. */
      if (moving) {
        const work = await readLayerWork({ stateDir, targetId, set: setId });
        if (work?.modId === item.modId) await rememberLayerWork({ ...work, stateDir, targetId, set: setId, modId: manifest.id });
      }
      migrated.push({ set: setId, from: item.modId, to: manifest.id });
    } catch (error) {
      failed.push({ set: setId, modId: item.modId, reason: String(error?.message || error) });
    } finally {
      /* Пакет переноса нужен только движку на время установки. */
      if (packageRoot) await fs.rm(packageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
  /* Основа пакета мест сменилась (схема хоста) — те же места поверх новой
     основы. Так уходят и пустые «постоянные типы» первой основы 06.10.2026,
     ронявшие игру на загрузке. */
  let base = { status: "current" };
  const placed = (await tools.readState({ stateDir }))?.targets?.[targetId]?.resources?.[PLACES_DLC_TARGET];
  if (placed?.layers?.length) {
    try {
      const host = await tools.placesHost({ stateDir, gameRoot, edition: "Legacy", compile: tools.compile });
      base = await tools.refreshPlacesBase({ targetId, stateDir, host, rpfComposer: tools.composeRpf, assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot), onProgress });
    } catch (error) {
      base = { status: "failed", reason: String(error?.message || error) };
    }
  }
  const current = (await tools.readState({ stateDir }))?.targets?.[targetId];
  return {
    status: migrated.length ? "migrated" : failed.length ? "failed" : "current",
    migrated,
    failed,
    base,
    sharedFarPlates: sharedFarPlates(current?.installed),
    heavyShells: await heavyShells(current).catch(() => []),
    rebuiltShells: await rebuiltServerModels(current).catch(() => []),
  };
}

/*
 * Поставленные работы, где дальняя копия плашки зовёт модель самой плашки: так
 * собирали до 30.10.2026, и клиент Majestic на них зависает или падает в меню.
 * Вылечить может только новая сборка из работы («Применить»): картинок здесь нет.
 * `[{ set, modId }]` — окно скажет человеку, какие работы применить заново.
 */
export function sharedFarPlates(installed) {
  const stale = [];
  for (const item of installed || []) {
    const set = Object.keys(SETS).find((id) => isRecolorModId(item?.modId, id));
    if (!set) continue;
    const names = (item.archiveEntries || []).map((entry) => String(entry?.entry || "").split("/").pop().toLowerCase());
    if (names.some((name) => /^astral_.*_marks_map_lod\.ymap$/.test(name)) && !names.some((name) => name.endsWith("_far.ydr"))) stale.push({ set, modId: item.modId });
  }
  return stale;
}

/*
 * Поставленные работы, где оболочка зала раздута нулевым хвостом страниц: так собирали до 10.11.2026
 * (43 МБ графики и страница 16 МБ при 24 МБ данных; клиент Majestic писал «Invalid asset
 * mj_ma_int3_shell.ydr» и падал, разбор — `docs/beta/incident-2026-11-10-majestic-arena-shell.md`).
 * Файл работы лежит в хранилище движка (`layers[].cachePath`), о размере говорят первые 16 байт его заголовка.
 * Вылечить может только новая сборка из работы («Применить»). `[{ set, modId, name, graphicsMb }]`.
 */
export async function heavyShells(target, { readHead = readFileHead } = {}) {
  const heavy = [];
  for (const item of target?.installed || []) {
    const set = Object.keys(SETS).find((id) => isRecolorModId(item?.modId, id));
    if (!set) continue;
    for (const entry of item.archiveEntries || []) {
      const name = String(entry?.entry || "").split("/").pop().toLowerCase();
      if (!/_shell\.ydr$/.test(name)) continue;
      const layer = (target.archives?.[entry.target]?.entries?.[entry.entry]?.layers || []).find((candidate) => candidate.modId === item.modId);
      const pages = layer?.cachePath ? modelPagesFromHead(await readHead(layer.cachePath)) : null;
      if (!isHeavyShell(pages)) continue;
      heavy.push({ set, modId: item.modId, name, graphicsMb: Math.round(pages.graphics.total / 1048576) });
      break;
    }
  }
  return heavy;
}

/*
 * Поставленные работы «Арена», где модель с именем сервера Majestic собрана не со штатным строением: так собирали до 20.11.2026
 * (отдельные листы под поверхности, вшитые полотна и картинки, пересобранная оболочка), и клиент Majestic отвечает
 * «Invalid asset <модель>.ydr» и `abort()` (разбор — `docs/beta/incident-2026-11-20-majestic-arena-shell-rebuilt.md`). Файл работы лежит в
 * хранилище движка (`layers[].cachePath`), штатный образец — в наборе (`resources/recolor/arenas/majestic`). Вылечить может только
 * «Пересобрать безопасно» (новая сборка из работы) или «Снять». `[{ set, modId, names }]`; без набора или файла — пусто.
 */
export async function rebuiltServerModels(target, { readBytes = (file) => fs.readFile(file).then((bytes) => new Uint8Array(bytes)).catch(() => null), stockOf = null } = {}) {
  const stock = stockOf || (async (name) => (await readBytes(path.join(await recolorResourceRoot("arenas"), "majestic", name))) || null);
  const found = [];
  for (const item of target?.installed || []) {
    if (!isRecolorModId(item?.modId, "arenas")) continue;
    const names = [];
    for (const entry of item.archiveEntries || []) {
      const name = String(entry?.entry || "").split("/").pop().toLowerCase();
      if (!/.(ydr|ydd|yft)$/.test(name)) continue;
      const base = await stock(name);
      if (!base) continue;
      const layer = (target.archives?.[entry.target]?.entries?.[entry.entry]?.layers || []).find((candidate) => candidate.modId === item.modId);
      const bytes = layer?.cachePath ? await readBytes(layer.cachePath) : null;
      if (bytes && !hasStockStructure(bytes, base, name)) names.push(name);
    }
    if (names.length) found.push({ set: "arenas", modId: item.modId, names });
  }
  return found;
}

/*
 * Планы живут в главном процессе: установка ставит ровно собранный набор, и
 * работа второй раз через мост окна не едет.
 */
/*
 * Запись переигрывания набора (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=recolor-customizer`):
 * набор, имя пакета, отпечаток и список файлов. Сами файлы лежат в постоянной папке пакета в `stateDir`.
 */
export function recolorReplayRecord(built) {
  return {
    module: "recolor-customizer",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.recolor.sourceDigest,
    order: {
      setId: built.setId,
      files: built.files.map(({ name, size, sha256: hash, mapped, mapOnly }) => ({ name, size, sha256: hash, ...(typeof mapped === "boolean" ? { mapped } : {}), ...(mapOnly ? { mapOnly } : {}) })),
    },
  };
}

/*
 * Пакет набора для переигрывания: файлы на месте, их SHA-256 и размеры — те, что в записи, а манифест,
 * пересобранный из них, даёт тот же дайджест. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function recolorReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "набор перекраски");
  const digest = String(replay?.sourceDigest || "");
  const setId = String(replay?.order?.setId || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !setId || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте набор заново из мастерской.`);
  const packageRoot = path.join(
    path.resolve(String(stateDir || "")),
    "recolor",
    setId,
    "packages",
    digest.slice("sha256:".length, "sha256:".length + 16),
  );
  const files = [];
  for (const item of listed) {
    const name = String(item?.name || "");
    const file = path.join(packageRoot, "payload", name);
    const stat = name ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите набор из мастерской.`);
    const hash = await fingerprintSha256(file);
    if (hash !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите набор из мастерской.`);
    files.push({ name, size: stat.size, sha256: hash, ...(item.mapOnly === true ? { mapOnly: true } : {}) });
  }
  /* Собрано по списку игры (`game-map-names.js`): в записи у каждого файла пометка `mapped` — архив сетевой карты или архив на старте. Пометок нет — собрано
     по запасному правилу `hei_`. */
  const byList = listed.some((item) => typeof item?.mapped === "boolean");
  const mapNames = byList ? new Set(listed.filter((item) => item.mapped === true).map((item) => String(item.name).toLowerCase())) : null;
  /* Тот же манифест, что в записи: нынешней раскладкой или, у записи до 26.11.2026, прежней (без фасада в сетевой карте). У записи с наполнителем фасада
     прежней раскладки не бывает. */
  const recorded = (facade) => {
    try {
      const rebuilt = buildRecolorManifest(setId, files, { mapNames, facade });
      return rebuilt.recolor.sourceDigest === digest && rebuilt.id === replay.workId;
    } catch {
      return false;
    }
  };
  if (!recorded(true) && !(files.every((file) => !file.mapOnly) && recorded(false)))
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите набор из мастерской.`);
  return { packageRoot, files };
}

export function createRecolorService({
  stateDir,
  tools: overrides = {},
  resourceRoot = null,
  onProgress = null,
  clock = Date.now,
}) {
  const tools = { ...defaultTools(), ...overrides };
  const plans = new Map();
  const prune = () => {
    const now = clock();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
    while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value);
  };

  /**
   * План: собрать набор и сказать, что сделает «Применить». `status` —
   * `install` (набора в игре нет или он другой) или `unchanged`.
   */
  async function plan(input, { signal = null } = {}) {
    /* Режим RP до сборки: выбор «Где играю» может смениться, пока план собирается (замка записи он не берёт). */
    const modeStamp = rpModeStamp();
    const setId = String(input?.set || "");
    const gameSet = GAME_SETS[setId] || null;
    if (!gameSet) setOf(setId);
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    const root = typeof resourceRoot === "function" ? resourceRoot(setId) : resourceRoot;
    /* Сборка места — в своём потоке (фикс 1 ТЗ 07.10.2026): дальние планы
       стояли в главном потоке до 10 с подряд. Тесты, что подменяют игру или
       папку набора, собирают здесь же, как прежде. */
    const inline = typeof overrides.openGame === "function" || Boolean(root) || overrides.recolorInline === true;
    const held = gameSet ? null : await heldByOtherSets(tools.readState, stateDir, targetId, setId);
    const over = !gameSet && SETS[setId]?.overMods ? await modFilesUnder(tools.readState, stateDir, targetId) : null;
    /* Места способом RP собираются ПОВЕРХ файлов других работ Astral (дороги, растительность, другие места), что стоят в контейнерах: общее имя иначе выходило бы в игре штатным из-за контейнера, смонтированного выше (`neighbours`, `readOverNeighbours`). */
    const neighbours = !gameSet && rpModeKindsOn(process.env).places ? await astralSetFiles({ gameRoot, stateDir, readState: tools.readState, except: (modId) => isRecolorModId(modId, setId), rpOnly: true }) : null;
    /* Места в контейнеры update.rpf (GTA 5 RP, `ASTRAL_PLACES_VIA_UPDATE=container`): без выключателя `placesViaUpdate` отдаёт ровно прежнюю сборку. */
    const buildPlaces = async () =>
      gameSet
      ? await gameSet.build(input, { gameRoot, stateDir, tools, onProgress, targetId, signal })
      : inline
        ? await buildRecolorPackage(setId, input?.project, stateDir, {
            resourceRoot: root,
            images: input?.images,
            openGame: () => tools.openGame(gameRoot, stateDir),
            compile: tools.compile,
            held,
            over,
            neighbours,
            /* Свет ламп помещений — помощником RPF (`shop-lights.js`); тесты подменяют `tools.lights`. */
            lights: tools.lights || createShopLightPatcher({ gameRoot, stateDir }),
            /* Имена сетевой карты мест (`game-map-names.js`): читает свой поток, кэш по отпечатку игры. */
            mapNames: PLACES_MAP_SETS.includes(setId) ? async () => tools.mapNames?.({ setId: "places", gameRoot, stateDir }) : null,
          })
        : await (tools.buildRecolorOffThread || buildRecolorOffThread)(
            { setId, input: input?.project, stateDir, images: input?.images, held, over, neighbours, gameRoot },
            /* Отмена окна снимает поток сборки и процесс движка в нём (`recolor-build-host.js`). */
            { compile: tools.compile, signal },
          );
    const built = gameSet
      ? await buildPlaces()
      : await placesViaUpdate({
          setId,
          statUpdate: async () => (await fs.stat(path.join(gameRoot, "update", "update.rpf"))).size,
          readState: tools.readState,
          targetId,
          stateDir,
          build: buildPlaces,
          /* Манифест частичной арены на RP собирается заново по едущим файлам (`partialArenaManifest`). */
          compile: tools.compile,
          /* Билборды на RP частью: «видно N из M щитов» считается по проекту работы (`billboards-rp-count.js`). */
          project: input?.project,
        });
    const current = await installedRecolor(tools.readState, stateDir, targetId, setId);
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    prune();
    const planId = randomUUID();
    /* Работа едет с планом: встанет — её запомнит главный процесс
       (`layer-works.js`), и пакет поверх неё он соберёт заново сам. */
    const work = {
      project: input?.project && typeof input.project === "object" ? input.project : null,
      images: input?.images && typeof input.images === "object" ? input.images : null,
      state: typeof input?.state === "string" ? input.state : null,
    };
    /* Пакет, собранный под режим RP (носитель, контейнер), помнит его: на «Применить» режим мог смениться. */
    plans.set(planId, { built, gameRoot, targetId, work, expiresAt: clock() + PLAN_TTL_MS, ...(built.viaUpdate ? { modeStamp } : {}) });
    return {
      planId,
      status: same ? "unchanged" : "install",
      replaces: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
      ...summaryOf(built),
    };
  }

  /**
   * «Применить» по плану. Прежний пакет этого набора уходит тем же движением
   * (`replaceModIds`): набор в игре один. Пакеты других наборов и модов не
   * трогаются.
   */
  async function apply(input, { assertRuntimeSafety, rebuiltForMode = false } = {}) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const planId = String(input?.planId || "");
    const planned = plans.get(planId);
    plans.delete(planId);
    if (!planned || planned.gameRoot.toLowerCase() !== gameRoot.toLowerCase()) throw new Error(PLAN_STALE);
    const { built, targetId } = planned;
    if (input?.set && input.set !== built.setId) throw new Error("План собран для другого набора — нажмите «Применить» ещё раз.");
    /* Игра та же и не запущена — до любой работы: при запущенной игре человек сразу слышит «Закройте GTA V», а не после минут сборки. Повторный заход после пересборки проверит оба ещё раз: игру могли запустить за время сборки. */
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    /* Режим RP сменился между сборкой плана и «Применить» («Где играю» меняет окружение на лету): пакет собран под прежний режим, и движок такой манифест отвергает — справедливо,
       проверку не трогаем. Собираем заново той же работой под режим, что действует сейчас; один раз — если режим снова сменился, говорим «устарел», а не крутимся. */
    if (planned.modeStamp !== undefined && planned.modeStamp !== rpModeStamp()) {
      if (rebuiltForMode) throw new Error(PLAN_STALE);
      const again = await plan({ set: built.setId, gameRoot, ...(planned.work || {}) });
      return apply({ ...input, planId: again.planId }, { assertRuntimeSafety, rebuiltForMode: true });
    }
    const remember = () =>
      rememberLayerWork({ stateDir, targetId, set: built.setId, modId: built.manifest.id, ...(planned.work || {}), over: built.summary?.atop?.owners || null });

    const current = await installedRecolor(tools.readState, stateDir, targetId, built.setId);
    if (current.length === 1 && current[0].modId === built.manifest.id) {
      await releasePackage(built, plans, stateDir);
      await remember();
      return { status: "unchanged", layerModId: built.manifest.id, gameRoot, targetId, ...summaryOf(built) };
    }
    await tracedStep("проверка пакета", () => assertPackageIntact(built));
    if (installTraceActive()) traceNote("пакет", await packageSize(built));

    const host = await tracedStep("основа растительности", () => setHost(built.setId, { gameRoot, stateDir, tools, built }));
    const options = engineOptions(built, gameRoot, targetId, stateDir, tools, host);
    const install = GAME_SETS[built.setId] ? tools[GAME_SETS[built.setId].install] : tools.install;
    /* Набор, чей контейнер должен писать помощник (`writer`), — собственным исполнителем сборки. */
    const setWriter = GAME_SETS[built.setId]?.writer || "";
    const enginePlan = await tracedStep("план установки", () => tools.plan(options));
    /*
     * Сменяются прежний пакет этого же набора и работы мастерской на тех же
     * записях — как раньше. Мод каталога раньше уходил из игры молча
     * (задача 3 ТЗ 10.10.2026): теперь набор ложится поверх, мод ждёт под
     * ним и вернётся, когда набор снимут (`over` — для слов окна; библиотека
     * зовёт его «под модом»).
     */
    const ownSet = (modId) =>
      String(modId).startsWith("local-") || (GAME_SETS[built.setId] ? GAME_SETS[built.setId].isModId(modId) : isRecolorModId(modId, built.setId));
    const conflicting = (enginePlan?.conflicts || []).map((item) => item.modId).filter(Boolean);
    const over = conflicting.filter((modId) => !ownSet(modId) && !current.some((item) => item.modId === modId));
    const replaceModIds = [...new Set([...conflicting.filter(ownSet), ...current.map((item) => item.modId)])]
      .filter((modId) => modId !== built.manifest.id)
      .sort();
    /* Флаг `ASTRAL_ENGINE_INSTALL=recolor-customizer` — только основной набор (не хосты): подмену
       `update.rpf` ведёт движок, точка получает `replay.json`. */
    const engineInstall =
      !GAME_SETS[built.setId] && engineInstallEnabled("recolor-customizer")
        ? {
            install: tools.installPrebuilt ?? installRpfPrebuilt,
            edition: "Legacy",
            gameRoot,
            pointsRoot: nativeRestorePointsRoot(),
            replay: recolorReplayRecord(built),
          }
        : null;
    /* Экспресс-установка своего dlc (`express-install.js`, «Astral быстрее»): `null`, пока выключатель `ASTRAL_ENGINE_EXPRESS_DLC` пуст. */
    const expressInstall = appExpressInstall({ stateDir, onProgress });
    const runInstall = (replace) =>
      install({
        ...options,
        replaceModIds: replace,
        ...(expressInstall ? { expressInstall } : {}),
        rpfComposer: setWriter ? (request) => tools.composeRpf({ ...request, writer: setWriter }) : tools.composeRpf,
        contentXmlProvider: tools.provideContentXml,
        dlcListProvider: tools.provideDlcList,
        assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
        onProgress,
        ...(engineInstall ? { engineInstall } : {}),
        ...(!built.viaUpdate && GAME_SETS[built.setId]?.verifyOwnDlc && typeof tools.verifyOwnDlc === "function" ? { dlcVerifier: tools.verifyOwnDlc } : {}),
      });
    /* Дороги через носитель `update2.rpf`: повторное применение — две записи подряд (снять прежнее, поставить новое), `roads-carrier-apply.js`. */
    if ((built.setId === "roads" || built.setId === "vegetation") && built.summary?.viaUpdate?.carrier === true) {
      await applyRoadsViaCarrier({
        label: built.setId === "vegetation" ? "Растительность" : "Дороги",
        standing: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
        uninstall: (modId) =>
          (tools.uninstall || uninstallPackage)({
            modId,
            targetId,
            stateDir,
            rpfComposer: tools.composeRpf,
            contentXmlProvider: tools.provideContentXml,
            dlcListProvider: tools.provideDlcList,
            assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
            onProgress,
          }),
        install: (removed) => runInstall(replaceModIds.filter((modId) => !removed.has(modId))),
      });
    } else await runInstall(replaceModIds);
    await releasePackage(built, plans, stateDir);
    await remember();
    const covered = await underVegetation(tools.readState, stateDir, targetId, built, current).catch(() => null);
    const textured = await underTextures(tools.readState, stateDir, targetId, built, current).catch(() => null);
    const roaded = await underRoads(tools.readState, stateDir, targetId, built, current).catch(() => null);
    /* Пакеты поверх набора (дороги, ступень текстур, растительность)
       собираются заново здесь же, той же работой, что стоит в игре; собрать
       нечем — `underRoads`/`underTextures`/`underVegetation` для окна. */
    const dependents = await rebuildDependents({
      stateDir,
      targetId,
      gameRoot,
      covered: { roads: roaded, textures: textured, vegetation: covered },
      assertRuntimeSafety,
      /* Окно называет ступень словами («Пересобираем растительность поверх дорог») и не рисует застывшее «Применение» — 22.11.2026. */
      onStage: (stage) => onProgress?.({ dependent: { ...stage, base: built.setId } }),
    });
    return {
      status: "installed",
      layerModId: built.manifest.id,
      replaced: replaceModIds,
      ...(over.length ? { over } : {}),
      gameRoot,
      targetId,
      installedAt: new Date(clock()).toISOString(),
      ...summaryOf(built),
      ...dependents,
    };
  }

  /* Пакет набора той же работой — поверх сменившихся файлов снизу. */
  async function rebuild(set, work, { gameRoot, assertRuntimeSafety } = {}) {
    const { planId } = await plan({
      set,
      gameRoot,
      project: work.project,
      ...(work.images ? { images: work.images } : {}),
      ...(work.state ? { state: work.state } : {}),
    });
    return apply({ set, gameRoot, planId }, { assertRuntimeSafety });
  }

  return Object.freeze({ plan, apply, rebuild });
}
