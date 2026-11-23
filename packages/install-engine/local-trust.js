import * as loaderPolicy from "./loader-policy.js";
import * as localMegaMallTrust from "./local-mega-mall-trust.js";
import * as localSoundTrust from "./local-sound-trust.js";
import * as arenaManifestTrust from "./arena-manifest-trust.js";
import * as interiorManifestTrust from "./interior-manifest-trust.js";
import * as climbManifestTrust from "./climb-manifest-trust.js";
import * as mapPackManifestTrust from "./map-pack-manifest-trust.js";
import * as soundPackManifestTrust from "./sound-pack-manifest-trust.js";
import * as worldMapManifestTrust from "./world-map-manifest-trust.js";
import * as skyRainbowManifestTrust from "./sky-rainbow-manifest-trust.js";
import * as lampLightsManifestTrust from "./lamp-lights-manifest-trust.js";
import * as wallbangManifestTrust from "./wallbang-manifest-trust.js";
import * as animalsManifestTrust from "./animals-manifest-trust.js";
import * as projectInteriorsManifestTrust from "./project-interiors-manifest-trust.js";
import * as majesticInteriorsManifestTrust from "./majestic-interiors-manifest-trust.js";
import * as drawDistanceManifestTrust from "./draw-distance-manifest-trust.js";
import * as weaponSkinManifestTrust from "./weapon-skin-manifest-trust.js";
import * as clothingSkinManifestTrust from "./clothing-skin-manifest-trust.js";
import * as clothingReplaceManifestTrust from "./clothing-replace-manifest-trust.js";
import * as gunpackManifestTrust from "./gunpack-manifest-trust.js";
import * as serverTattooManifestTrust from "./server-tattoo-manifest-trust.js";
import * as tattooPaintManifestTrust from "./tattoo-paint-manifest-trust.js";
import * as recolorManifestTrust from "./recolor-manifest-trust.js";
import * as waterManifestTrust from "./water-manifest-trust.js";
import * as texturesManifestTrust from "./textures-manifest-trust.js";
import * as roadsManifestTrust from "./roads-manifest-trust.js";
import { LOCAL_PLACES_CONTAINER_TRUST, LOCAL_ROADS_CARRIER_TRUST, LOCAL_ROADS_CONTAINER_TRUST, LOCAL_VEGETATION_CARRIER_TRUST, LOCAL_VEGETATION_CONTAINER_TRUST, LOCAL_VEGETATION_TRUST } from "./container-trust-symbols.js";
import * as fontsManifestTrust from "./fonts-manifest-trust.js";
import * as optimizationManifestTrust from "./optimization-manifest-trust.js";

// У оптимизации две формы манифеста: слой и набор слоёв; набор проверяется, только если не слой.
const optimizationCheck = (manifest, edition) =>
  [
    optimizationManifestTrust.isLocalOptimizationManifest,
    optimizationManifestTrust.isLocalOptimizationSetManifest,
  ].some((check) => check(manifest, edition));

// Реестр видов: символ доверия -> строгая проверка формы манифеста этого вида.
// Новый вид работы мастерской добавляется строкой сюда, а не веткой в условие.
const CHECKS = new Map([
  [loaderPolicy.PINNED_LOADER_TRUST, loaderPolicy.isPinnedLoaderManifest],
  [localMegaMallTrust.LOCAL_MEGA_MALL_OVERLAY_TRUST, localMegaMallTrust.isLocalMegaMallOverlayManifest],
  [localSoundTrust.LOCAL_SOUND_LAYER_TRUST, localSoundTrust.isLocalSoundManifest],
  [arenaManifestTrust.LOCAL_ARENA_TRUST, arenaManifestTrust.isLocalArenaManifest],
  [interiorManifestTrust.LOCAL_INTERIOR_TRUST, interiorManifestTrust.isLocalInteriorManifest],
  [climbManifestTrust.LOCAL_CLIMB_TRUST, climbManifestTrust.isLocalClimbManifest],
  [mapPackManifestTrust.LOCAL_MAP_PACK_TRUST, mapPackManifestTrust.isLocalMapPackManifest],
  [soundPackManifestTrust.LOCAL_SOUND_PACK_TRUST, soundPackManifestTrust.isLocalSoundPackManifest],
  [worldMapManifestTrust.LOCAL_WORLD_MAP_TRUST, worldMapManifestTrust.isLocalWorldMapManifest],
  [skyRainbowManifestTrust.LOCAL_SKY_RAINBOW_TRUST, skyRainbowManifestTrust.isLocalSkyRainbowManifest],
  [lampLightsManifestTrust.LOCAL_LAMP_LIGHTS_TRUST, lampLightsManifestTrust.isLocalLampLightsManifest],
  [wallbangManifestTrust.LOCAL_WALLBANG_TRUST, wallbangManifestTrust.isLocalWallbangManifest],
  [animalsManifestTrust.LOCAL_ANIMALS_TRUST, animalsManifestTrust.isLocalAnimalsManifest],
  [projectInteriorsManifestTrust.LOCAL_PROJECT_INTERIORS_TRUST, projectInteriorsManifestTrust.isLocalProjectInteriorsManifest],
  [majesticInteriorsManifestTrust.LOCAL_MAJESTIC_INTERIORS_TRUST, majesticInteriorsManifestTrust.isLocalMajesticInteriorsManifest],
  [drawDistanceManifestTrust.LOCAL_DRAW_DISTANCE_TRUST, drawDistanceManifestTrust.isLocalDrawDistanceManifest],
  [weaponSkinManifestTrust.LOCAL_WEAPON_SKIN_TRUST, weaponSkinManifestTrust.isLocalWeaponSkinManifest],
  [clothingSkinManifestTrust.LOCAL_CLOTHING_SKIN_TRUST, clothingSkinManifestTrust.isLocalClothingSkinManifest],
  [clothingReplaceManifestTrust.LOCAL_CLOTHING_REPLACE_TRUST, clothingReplaceManifestTrust.isLocalClothingReplaceManifest],
  [gunpackManifestTrust.LOCAL_GUNPACK_TRUST, gunpackManifestTrust.isLocalGunpackManifest],
  [serverTattooManifestTrust.LOCAL_SERVER_TATTOO_TRUST, serverTattooManifestTrust.isLocalServerTattooManifest],
  [tattooPaintManifestTrust.LOCAL_TATTOO_PAINT_TRUST, tattooPaintManifestTrust.isLocalTattooPaintManifest],
  [recolorManifestTrust.LOCAL_RECOLOR_TRUST, recolorManifestTrust.isLocalRecolorManifest],
  [waterManifestTrust.LOCAL_WATER_TRUST, waterManifestTrust.isLocalWaterManifest],
  [texturesManifestTrust.LOCAL_TEXTURES_TRUST, texturesManifestTrust.isLocalTexturesManifest],
  [roadsManifestTrust.LOCAL_ROADS_TRUST, roadsManifestTrust.isLocalRoadsManifest],
  [fontsManifestTrust.LOCAL_FONTS_TRUST, fontsManifestTrust.isLocalFontsManifest],
  [optimizationManifestTrust.LOCAL_OPTIMIZATION_TRUST, optimizationCheck],
]);

// Символы, которым разрешены особые возможности пакета.
const PRIVILEGED = {
  maskEntries: [weaponSkinManifestTrust.LOCAL_WEAPON_SKIN_TRUST],
  nestedRpf: [mapPackManifestTrust.LOCAL_MAP_PACK_TRUST, worldMapManifestTrust.LOCAL_WORLD_MAP_TRUST],
  storeByLink: [
    LOCAL_VEGETATION_TRUST,
    texturesManifestTrust.LOCAL_TEXTURES_TRUST,
    roadsManifestTrust.LOCAL_ROADS_TRUST,
    LOCAL_ROADS_CONTAINER_TRUST,
    LOCAL_ROADS_CARRIER_TRUST,
    LOCAL_VEGETATION_CONTAINER_TRUST,
    LOCAL_VEGETATION_CARRIER_TRUST,
  ],
};

/*
 * Контейнерные формы (дороги, растительность, места на GTA 5 RP): строгие проверки лежат в своих файлах и в стартовый граф главного процесса не входят. Какой файл и какая функция
 * отвечают символу, знает ТОЛЬКО эта внутренняя таблица (не экспортируется); `loadContainerTrust` грузит СВОЙ файл по ней и кладёт проверку в реестр. Подложить чужую проверку нельзя:
 * экспортируемой регистрации нет. Не загружено — символ не засчитывается (закрыто по умолчанию).
 */
const CONTAINER_FORMS = new Map([
  [LOCAL_VEGETATION_TRUST, () => import("./vegetation-manifest-trust.js").then((module) => module.isLocalVegetationManifest)],
  [LOCAL_ROADS_CONTAINER_TRUST, () => import("./roads-container-manifest-trust.js").then((module) => module.isLocalRoadsContainerManifest)],
  [LOCAL_ROADS_CARRIER_TRUST, () => import("./roads-carrier-manifest-trust.js").then((module) => module.isLocalRoadsCarrierManifest)],
  [LOCAL_VEGETATION_CONTAINER_TRUST, () => import("./vegetation-container-manifest-trust.js").then((module) => module.isLocalVegetationContainerManifest)],
  [LOCAL_VEGETATION_CARRIER_TRUST, () => import("./vegetation-carrier-manifest-trust.js").then((module) => module.isLocalVegetationCarrierManifest)],
  [LOCAL_PLACES_CONTAINER_TRUST, () => import("./places-container-manifest-trust.js").then((module) => module.isLocalPlacesContainerManifest)],
]);

/** Загружает строгую проверку формы (контейнерные формы и пакетная форма растительности) по её символу. Неизвестный символ — отказ. */
export async function loadContainerTrust(trust) {
  const load = CONTAINER_FORMS.get(trust);
  if (!load) throw new Error("Этот символ доверия не относится к формам, что проверяются по вызову.");
  if (!CHECKS.has(trust)) CHECKS.set(trust, await load());
}

// Засчитывается ли символ этому манифесту: символ из реестра и манифест строго своей формы.
// Неизвестный символ — false, манифест при этом не читается.
export function locallyTrusted(trust, manifest, edition) {
  const strict = CHECKS.get(trust);
  if (strict === undefined) return false;
  return Boolean(strict(manifest, edition));
}

// Запись без подписи, удаляющая запись маской, разрешена только скину ствола.
export function mayMaskEntries(trust) {
  return PRIVILEGED.maskEntries.includes(trust);
}

// Вложенный .rpf целиком: готовая карта и своя карта из мастерской.
export function mayCarryNestedRpf(trust) {
  return PRIVILEGED.nestedRpf.includes(trust);
}

// Файлы кладут в хранилище жёсткой ссылкой, а не копией: растительность, ступени текстур, дороги.
export function mayStoreByLink(trust) {
  return PRIVILEGED.storeByLink.includes(trust);
}
