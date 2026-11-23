import { PINNED_LOADER_TRUST, pinnedLoaderManifest } from "./loader-policy.js";
import {
  isLocalInteriorManifest,
  LOCAL_INTERIOR_TRUST,
} from "./interior-manifest-trust.js";
import {
  isLocalWorldMapManifest,
  LOCAL_WORLD_MAP_TRUST,
} from "./world-map-manifest-trust.js";
import {
  isLocalArenaManifest,
  LOCAL_ARENA_TRUST,
} from "./arena-manifest-trust.js";
import {
  isLocalClimbManifest,
  LOCAL_CLIMB_TRUST,
} from "./climb-manifest-trust.js";
import {
  isLocalMapPackManifest,
  LOCAL_MAP_PACK_TRUST,
} from "./map-pack-manifest-trust.js";
import {
  isLocalSoundPackManifest,
  LOCAL_SOUND_PACK_TRUST,
} from "./sound-pack-manifest-trust.js";
import {
  isLocalSkyRainbowManifest,
  LOCAL_SKY_RAINBOW_TRUST,
} from "./sky-rainbow-manifest-trust.js";
import {
  isLocalLampLightsManifest,
  LOCAL_LAMP_LIGHTS_TRUST,
} from "./lamp-lights-manifest-trust.js";
import {
  isLocalWallbangManifest,
  LOCAL_WALLBANG_TRUST,
} from "./wallbang-manifest-trust.js";
import { isLocalAnimalsManifest, LOCAL_ANIMALS_TRUST } from "./animals-manifest-trust.js";
import { isLocalDrawDistanceManifest, LOCAL_DRAW_DISTANCE_TRUST } from "./draw-distance-manifest-trust.js";
import {
  isLocalProjectInteriorsManifest,
  LOCAL_PROJECT_INTERIORS_TRUST,
} from "./project-interiors-manifest-trust.js";
import {
  isLocalMajesticInteriorsManifest,
  LOCAL_MAJESTIC_INTERIORS_TRUST,
} from "./majestic-interiors-manifest-trust.js";
import { DEFAULT_DIR } from "./storage-state.js";
import {
  isLocalWeaponSkinManifest,
  LOCAL_WEAPON_SKIN_TRUST,
} from "./weapon-skin-manifest-trust.js";
import {
  isLocalClothingSkinManifest,
  LOCAL_CLOTHING_SKIN_TRUST,
} from "./clothing-skin-manifest-trust.js";
import {
  isLocalClothingReplaceManifest,
  LOCAL_CLOTHING_REPLACE_TRUST,
} from "./clothing-replace-manifest-trust.js";
import {
  isLocalGunpackManifest,
  LOCAL_GUNPACK_TRUST,
} from "./gunpack-manifest-trust.js";
import {
  isLocalMegaMallOverlayManifest,
  LOCAL_MEGA_MALL_OVERLAY_TRUST,
} from "./local-mega-mall-trust.js";
import {
  isLocalSoundManifest,
  LOCAL_SOUND_LAYER_TRUST,
} from "./local-sound-trust.js";
import {
  isLocalServerTattooManifest,
  LOCAL_SERVER_TATTOO_TRUST,
} from "./server-tattoo-manifest-trust.js";
import {
  isLocalTattooPaintManifest,
  LOCAL_TATTOO_PAINT_TRUST,
} from "./tattoo-paint-manifest-trust.js";
import {
  isLocalRecolorManifest,
  LOCAL_RECOLOR_TRUST,
} from "./recolor-manifest-trust.js";
import {
  isLocalOptimizationManifest,
  isLocalOptimizationSetManifest,
  LOCAL_OPTIMIZATION_TRUST,
} from "./optimization-manifest-trust.js";
import { isLocalWaterManifest, LOCAL_WATER_TRUST } from "./water-manifest-trust.js";
import { isLocalTexturesManifest, LOCAL_TEXTURES_TRUST } from "./textures-manifest-trust.js";
import { isLocalRoadsManifest, LOCAL_ROADS_TRUST } from "./roads-manifest-trust.js";
import { isLocalFontsManifest, LOCAL_FONTS_TRUST } from "./fonts-manifest-trust.js";
import { installPackage, installPackageBatch, planPackage } from "./plan-install.js";
import { LOCAL_PLACES_CONTAINER_TRUST, LOCAL_ROADS_CARRIER_TRUST, LOCAL_ROADS_CONTAINER_TRUST, LOCAL_VEGETATION_CARRIER_TRUST, LOCAL_VEGETATION_CONTAINER_TRUST, LOCAL_VEGETATION_TRUST } from "./container-trust-symbols.js";
import { loadContainerTrust, locallyTrusted } from "./local-trust.js";

/*
 * Локальные пакеты: тонкие обёртки над планом и установкой, каждая со своей
 * проверкой манифеста. Смысл обёрток в том, что право писать в корень игры
 * или ставить без подписи выдаётся не вообще, а строго определённой форме
 * слоя — и проверка эта стоит здесь, до вызова установки.
 */
export async function installLocalMegaMallOverlayPackage(options) {
  if (!isLocalMegaMallOverlayManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка Davis Mega Mall разрешена только для строгого Astral-owned overlay GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    allowGameRootWrites: false,
    requireSignature: false,
    _internalTrust: LOCAL_MEGA_MALL_OVERLAY_TRUST,
  });
}

export async function installPinnedLoaderPackage({
  packageRoot,
  gameRoot,
  targetId = "default",
  edition,
  stateDir = DEFAULT_DIR,
  onProgress = null,
  signal = null,
  assertRuntimeSafety = null,
}) {
  return installPackage({
    manifest: pinnedLoaderManifest(edition),
    packageRoot,
    gameRoot,
    targetId,
    edition,
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    onProgress,
    signal,
    assertRuntimeSafety,
    _internalTrust: PINNED_LOADER_TRUST,
  });
}

/*
 * План под тем же трастом, что и установка: манифест звукового слоя живёт в
 * корне игры, и без allowGameRootWrites валидация его отвергнет — но право
 * на корень получает только строгая форма слоя, а не любой манифест.
 */
export async function planLocalSoundPackage(options) {
  if (!isLocalSoundManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка звука разрешена только для строгих форм звуков студии GTA V Legacy.",
    );
  }
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalSoundPackage(options) {
  if (!isLocalSoundManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка звука разрешена только для строгих форм звуков студии GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    /* Звуковые банки живут в корне игры — но пишет их всё равно только
       материализатор AWC с подменой потоков, а не произвольный файл. */
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_SOUND_LAYER_TRUST,
  });
}

/*
 * Локальные пакеты мастерской (интерьеры, арены) идут прямой схемой слоя
 * Astral: `update/update.rpf` → `x64/astral/astral_maps.rpf` → content.xml.
 * Право писать в корень игры даёт не вызов этой функции, а строгая форма
 * манифеста: любое отклонение от неё — отказ до обращения к движку.
 */
export async function installLocalInteriorPackage(options) {
  if (!isLocalInteriorManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка интерьера разрешена только для строгого location-scoped additive YMAP GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_INTERIOR_TRUST,
  });
}

/*
 * Большая карта из мастерской: плитки `minimap*.ytd` внутри
 * `scaleform_generic.rpf` заменяются в настоящем update.rpf. План под тем же
 * трастом, что и установка: без allowGameRootWrites валидация отвергла бы
 * манифест, а право на корень получает только строгая форма карты.
 */
export async function planLocalWorldMapPackage(options) {
  if (!isLocalWorldMapManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка большой карты разрешена только для строгого набора плиток minimap в update/update.rpf GTA V Legacy.",
    );
  }
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalWorldMapPackage(options) {
  if (!isLocalWorldMapManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка большой карты разрешена только для строгого набора плиток minimap в update/update.rpf GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_WORLD_MAP_TRUST,
  });
}

/*
 * Залазы — готовые файлы мода с перекрашенными на месте текстурами меток.
 * Тем же слоем Astral и тем же контейнером astral_maps.rpf, что интерьеры и
 * арены: право писать в корень игры даёт строгая форма манифеста, а не вызов.
 */
export async function installLocalClimbPackage(options) {
  if (!isLocalClimbManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка залазов разрешена только для строгого набора ресурсов climbs в update/update.rpf GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_CLIMB_TRUST,
  });
}

/*
 * Готовая большая карта из папки мода: плитки, `.gfx`, `minimap.ymt`,
 * `mapzoomdata.meta` и вложенный `minimap.rpf` ложатся на свои места в
 * настоящем update.rpf. План идёт под тем же трастом, что и установка: без
 * allowGameRootWrites валидация отвергла бы манифест.
 */
export async function planLocalMapPackPackage(options) {
  if (!isLocalMapPackManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Установка готовой карты разрешена только для строгого набора файлов миникарты в update/update.rpf GTA V Legacy.",
    );
  }
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalMapPackPackage(options) {
  if (!isLocalMapPackManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Установка готовой карты разрешена только для строгого набора файлов миникарты в update/update.rpf GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_MAP_PACK_TRUST,
  });
}

/*
 * Готовый набор звуков из папки мода: банки `.awc` ложатся на свои места в
 * звуковых архивах игры. План идёт под тем же трастом, что и установка: без
 * allowGameRootWrites валидация отвергла бы манифест ещё до проверки формы.
 */
const SOUND_PACK_REFUSAL =
  "Установка готового набора звуков разрешена только для банков .awc известных звуковых архивов GTA V Legacy.";

export async function planLocalSoundPackPackage(options) {
  if (!isLocalSoundPackManifest(options?.manifest, options?.edition))
    throw new Error(SOUND_PACK_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalSoundPackPackage(options) {
  if (!isLocalSoundPackManifest(options?.manifest, options?.edition))
    throw new Error(SOUND_PACK_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_SOUND_PACK_TRUST,
  });
}

/*
 * Радуга неба — своя модель Astral тем же слоем, что арены и залазы, но в
 * своём контейнере `x64/astral/astral_sky.rpf`. Право писать в корень игры
 * даёт строгая форма манифеста: известные файлы и ничего сверх.
 */
const SKY_RAINBOW_REFUSAL =
  "Установка радуги разрешена только для файлов модели радуги Astral в x64/astral/astral_sky.rpf GTA V Legacy.";

export async function installLocalSkyRainbowPackage(options) {
  if (!isLocalSkyRainbowManifest(options?.manifest, options?.edition))
    throw new Error(SKY_RAINBOW_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_SKY_RAINBOW_TRUST,
  });
}

/*
 * Фонари мастерской — правленые модели фонарей и описание пропов в своём
 * контейнере `x64/astral/astral_lights.rpf`. Право писать в корень игры даёт
 * строгая форма манифеста: модели групп редактора и ничего сверх.
 */
const LAMP_LIGHTS_REFUSAL =
  "Установка фонарей разрешена только для моделей фонарей Astral в x64/astral/astral_lights.rpf GTA V Legacy.";

export async function installLocalLampLightsPackage(options) {
  if (!isLocalLampLightsManifest(options?.manifest, options?.edition))
    throw new Error(LAMP_LIGHTS_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_LAMP_LIGHTS_TRUST,
  });
}

/*
 * Прострелы мастерской — оболочки укрытий из мода prostrel, перекрашенные
 * на месте, с их типами, расстановкой и манифестом в своём контейнере
 * `x64/astral/astral_wallbang.rpf`. Залазы живут в `astral_maps.rpf` своим
 * пакетом: прострелы их не ставят и не снимают. Право писать в корень игры
 * даёт строгая форма манифеста: файлы набора и ничего сверх.
 */
const WALLBANG_REFUSAL =
  "Установка прострелов разрешена только для набора Astral в x64/astral/astral_wallbang.rpf GTA V Legacy.";

export async function installLocalWallbangPackage(options) {
  if (!isLocalWallbangManifest(options?.manifest, options?.edition))
    throw new Error(WALLBANG_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_WALLBANG_TRUST,
  });
}

/*
 * «Животные» мастерской (05.11.2026) — перекраска, свечение и метка над животными базовой игры: листы цвета и модели тела
 * под их же именами в своём контейнере `x64/astral/astral_animals.rpf`. Право писать в корень игры даёт строгая форма
 * манифеста: файлы животных по описи имён и ничего сверх (`animals-manifest-trust.js`); физика (`.yft`) в пакет не входит.
 */
const ANIMALS_REFUSAL =
  "Установка животных разрешена только для набора Astral в x64/astral/astral_animals.rpf GTA V Legacy.";

export async function installLocalAnimalsPackage(options) {
  if (!isLocalAnimalsManifest(options?.manifest, options?.edition))
    throw new Error(ANIMALS_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_ANIMALS_TRUST,
  });
}

/*
 * «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер) — интерьеры из
 * файлов самого игрока, каждый в своём контейнере
 * `x64/astral/astral_proj_<номер>.rpf`. Право писать в корень игры даёт
 * строгая форма манифеста: комплекты по описи имён выбранного пака и
 * ничего сверх (`project-interiors-manifest-trust.js`).
 */
const PROJECT_INTERIORS_REFUSAL =
  "Установка интерьеров проектов разрешена только для комплектов Astral в x64/astral/astral_proj_<номер>.rpf GTA V Legacy.";

export async function installLocalProjectInteriorsPackage(options) {
  if (!isLocalProjectInteriorsManifest(options?.manifest, options?.edition))
    throw new Error(PROJECT_INTERIORS_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_PROJECT_INTERIORS_TRUST,
  });
}

/*
 * «Интерьеры Majestic RP» (Хелпер 7, 25.10.2026) — листы интерьеров сервера,
 * перекрашенные поверх файлов игрока, в контейнере
 * `x64/astral/astral_majestic.rpf`. Право писать в корень игры даёт строгая
 * форма манифеста: закрытый список имён файлов и ничего сверх
 * (`majestic-interiors-manifest-trust.js`).
 */
const MAJESTIC_INTERIORS_REFUSAL =
  "Установка интерьеров Majestic RP разрешена только для перекрашенных файлов из закрытого списка Astral в x64/astral/astral_majestic.rpf GTA V Legacy.";

export async function installLocalMajesticInteriorsPackage(options) {
  if (!isLocalMajesticInteriorsManifest(options?.manifest, options?.edition)) throw new Error(MAJESTIC_INTERIORS_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_MAJESTIC_INTERIORS_TRUST,
  });
}

/*
 * «Дальность прорисовки» (задача 7 ТЗ 06.10.2026): модификатор таймцикла
 * объединением в timecycle_mods_2.xml и карта с коробкой этого модификатора
 * на всю карту в своём контейнере. Право писать в корень игры даёт строгая
 * форма манифеста: эти два файла и ничего сверх.
 */
const DRAW_DISTANCE_REFUSAL =
  "Установка дальности прорисовки разрешена только для пакета Astral: модификатор AstralDrawDistance и карта с его коробкой.";

export async function installLocalDrawDistancePackage(options) {
  if (!isLocalDrawDistanceManifest(options?.manifest, options?.edition)) throw new Error(DRAW_DISTANCE_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_DRAW_DISTANCE_TRUST,
  });
}

/*
 * Наборы перекраски мастерской — запретные зоны, завод, ангар, маппинг:
 * файлы мода, перекрашенные на месте, в своём контейнере
 * `x64/astral/astral_<набор>.rpf`. Право писать в корень игры даёт строгая
 * форма манифеста: ровно файлы набора и ничего сверх.
 */
const RECOLOR_REFUSAL =
  "Установка перекраски разрешена только для наборов Astral в x64/astral/astral_<набор>.rpf GTA V Legacy.";

export async function installLocalRecolorPackage(options) {
  /* Две формы одной работы: файлы в пакете `astral_places` или (GTA 5 RP, `places-update-route.js`) в контейнере набора в `update.rpf`. */
  /* Контейнерная форма: её строгая проверка грузится по вызову (стартовый граф главного процесса, `tests/main-startup-imports.test.js`) через `loadContainerTrust`. */
  await loadContainerTrust(LOCAL_PLACES_CONTAINER_TRUST);
  const container = locallyTrusted(LOCAL_PLACES_CONTAINER_TRUST, options?.manifest, options?.edition);
  if (!container && !isLocalRecolorManifest(options?.manifest, options?.edition))
    throw new Error(RECOLOR_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: container ? LOCAL_PLACES_CONTAINER_TRUST : LOCAL_RECOLOR_TRUST,
  });
}

/*
 * Вода мастерской — плитки тумана и квады воды на своих местах в
 * update.rpf, туман рек — в контейнере `x64/astral/astral_water.rpf`.
 * Право писать в корень игры даёт строгая форма манифеста воды.
 */
const WATER_REFUSAL = "Установка воды разрешена только для пакета воды Astral в update/update.rpf GTA V Legacy.";

export async function installLocalWaterPackage(options) {
  if (!isLocalWaterManifest(options?.manifest, options?.edition)) throw new Error(WATER_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_WATER_TRUST,
  });
}

/*
 * Растительность мастерской — листва, карточки вдали, трава и земля
 * Сэнди-Шорс и улучшенные модели в своём пакете дополнения
 * `astral_vegetation` (`vegetation-dlc.js`, с 05.10.2026); имена — копия
 * описи.
 */
const VEGETATION_REFUSAL = "Установка растительности разрешена только для пакета растительности Astral в его пакете дополнения GTA V Legacy.";

export async function installLocalVegetationPackage(options) {
  /* Две формы одной работы: файлы в пакетах `astral_vegetation*` или (GTA 5 RP, `vegetation-update-route.js`) в контейнерах `update.rpf`. */
  /* Контейнерная форма: её строгая проверка грузится по вызову (стартовый граф главного процесса, `tests/main-startup-imports.test.js`) через `loadContainerTrust`. */
  await loadContainerTrust(LOCAL_VEGETATION_CONTAINER_TRUST);
  await loadContainerTrust(LOCAL_VEGETATION_TRUST);
  /* Третья форма: трава и изгороди в носителе `update2.rpf` (`vegetation-carrier-manifest-trust.js`); без выключателя `ASTRAL_CARRIERS=update2` её манифест отказывает на разборе. */
  await loadContainerTrust(LOCAL_VEGETATION_CARRIER_TRUST);
  const container = locallyTrusted(LOCAL_VEGETATION_CONTAINER_TRUST, options?.manifest, options?.edition);
  const carrier = !container && locallyTrusted(LOCAL_VEGETATION_CARRIER_TRUST, options?.manifest, options?.edition);
  if (!container && !carrier && !locallyTrusted(LOCAL_VEGETATION_TRUST, options?.manifest, options?.edition)) throw new Error(VEGETATION_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: carrier ? LOCAL_VEGETATION_CARRIER_TRUST : container ? LOCAL_VEGETATION_CONTAINER_TRUST : LOCAL_VEGETATION_TRUST,
  });
}

/*
 * «Ухудшение текстур» на всю карту — словари игры игрока с урезанными
 * ступенями mip в своём пакете дополнения `astral_textures`
 * (`textures-dlc.js`, задача 1 ТЗ 05.10.2026).
 */
const TEXTURES_REFUSAL = "Установка ухудшенных текстур разрешена только для пакета текстур Astral в его пакете дополнения GTA V Legacy.";

export async function installLocalTexturesPackage(options) {
  if (!isLocalTexturesManifest(options?.manifest, options?.edition)) throw new Error(TEXTURES_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_TEXTURES_TRUST,
  });
}

/*
 * «Дороги» — словари карты игрока с перекрашенными листами дорог в своих
 * пакетах дополнения `astral_roads` и `astral_roads_b` (`roads-dlc.js`,
 * задача 6 ТЗ 07.10.2026). Право писать даёт строгая форма манифеста дорог.
 */
const ROADS_REFUSAL = "Установка дорог разрешена только для пакета дорог Astral в его пакетах дополнения GTA V Legacy.";

export async function installLocalRoadsPackage(options) {
  /* Две формы одной работы: файлы в пакетах `astral_roads*` или (GTA 5 RP, `roads-update-route.js`) в контейнерах `update.rpf`. */
  /* Контейнерная форма: её строгая проверка грузится по вызову (стартовый граф главного процесса, `tests/main-startup-imports.test.js`) через `loadContainerTrust`. */
  await loadContainerTrust(LOCAL_ROADS_CONTAINER_TRUST);
  /* Третья форма: контейнеры в носителе `update2.rpf` (`roads-carrier-manifest-trust.js`); без выключателя `ASTRAL_CARRIERS=update2` её манифест отказывает уже при разборе. */
  await loadContainerTrust(LOCAL_ROADS_CARRIER_TRUST);
  const container = locallyTrusted(LOCAL_ROADS_CONTAINER_TRUST, options?.manifest, options?.edition);
  const carrier = !container && locallyTrusted(LOCAL_ROADS_CARRIER_TRUST, options?.manifest, options?.edition);
  if (!container && !carrier && !isLocalRoadsManifest(options?.manifest, options?.edition)) throw new Error(ROADS_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: carrier ? LOCAL_ROADS_CARRIER_TRUST : container ? LOCAL_ROADS_CONTAINER_TRUST : LOCAL_ROADS_TRUST,
  });
}

/*
 * Шрифты мастерской — библиотеки шрифтов Scaleform игры со своими глифами
 * на своих местах в update.rpf. Право писать в корень игры даёт строгая
 * форма манифеста шрифтов: две известные записи и ничего сверх.
 */
const FONTS_REFUSAL = "Установка шрифтов разрешена только для библиотек шрифтов Astral в update/update.rpf GTA V Legacy.";

export async function installLocalFontsPackage(options) {
  if (!isLocalFontsManifest(options?.manifest, options?.edition)) throw new Error(FONTS_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_FONTS_TRUST,
  });
}

/*
 * Слои оптимизации мастерской — трава, мусор, полки, частицы, лёгкие
 * текстуры в своих контейнерах `x64/astral/astral_opt_<слой>.rpf`, и
 * файлы игры, правленные на файле игрока (`decals.dat`, `wheelfx.dat`,
 * `explosion.ymt`, `fxdecal.ytd`, таймцикл). Право писать в корень игры
 * даёт строгая форма манифеста своего слоя.
 */
const OPTIMIZATION_REFUSAL =
  "Установка слоя оптимизации разрешена только для слоёв Astral в update/update.rpf GTA V Legacy.";

export async function installLocalOptimizationPackage(options) {
  if (!isLocalOptimizationManifest(options?.manifest, options?.edition) && !isLocalOptimizationSetManifest(options?.manifest, options?.edition))
    throw new Error(OPTIMIZATION_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_OPTIMIZATION_TRUST,
  });
}

export async function installLocalArenaPackage(options) {
  // Fail-closed на входе: сначала строгий траст, и только затем установка
  // в слой Astral без требования подписи (пакет собран локально).
  if (!isLocalArenaManifest(options?.manifest, options?.edition)) {
    throw new Error(
      "Локальная установка арены разрешена только для строгого набора Astral-ресурсов в update/update.rpf GTA V Legacy.",
    );
  }
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_ARENA_TRUST,
  });
}

/*
 * Скин оружия из мастерской: запечённые текстуры ствола ложатся в
 * подготовленный Astral Weapons DLC. План — под тем же трастом, что и
 * установка: без allowGameRootWrites валидация отвергла бы манифест, а право
 * на корень получает только строгая форма скина одной модели.
 */
const WEAPON_SKIN_REFUSAL =
  "Установка скина оружия разрешена только для текстур .ytd одной модели оружия в Astral Weapons DLC GTA V Legacy.";

export async function planLocalWeaponSkinPackage(options) {
  if (!isLocalWeaponSkinManifest(options?.manifest, options?.edition))
    throw new Error(WEAPON_SKIN_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalWeaponSkinPackage(options) {
  if (!isLocalWeaponSkinManifest(options?.manifest, options?.edition))
    throw new Error(WEAPON_SKIN_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_WEAPON_SKIN_TRUST,
  });
}

const CLOTHING_SKIN_REFUSAL =
  "Установка покраски одежды разрешена только для одной текстуры .ytd одной вещи мужского персонажа в Astral Clothing DLC GTA V Legacy.";

export async function planLocalClothingSkinPackage(options) {
  if (!isLocalClothingSkinManifest(options?.manifest, options?.edition))
    throw new Error(CLOTHING_SKIN_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalClothingSkinPackage(options) {
  if (!isLocalClothingSkinManifest(options?.manifest, options?.edition))
    throw new Error(CLOTHING_SKIN_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_CLOTHING_SKIN_TRUST,
  });
}

const CLOTHING_REPLACE_REFUSAL =
  "Замена одежды ставится только одной вещью — модель и её расцветки под папкой персонажа — в Astral Clothing DLC GTA V Legacy.";

export async function planLocalClothingReplacePackage(options) {
  if (!isLocalClothingReplaceManifest(options?.manifest, options?.edition))
    throw new Error(CLOTHING_REPLACE_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalClothingReplacePackage(options) {
  if (!isLocalClothingReplaceManifest(options?.manifest, options?.edition))
    throw new Error(CLOTHING_REPLACE_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_CLOTHING_REPLACE_TRUST,
  });
}

/*
 * Несколько заменёнок одной транзакцией (02.11.2026): набор перчаток Majestic ложится на 14 вещей
 * в трёх паках игры, и по одной каждая пересобирала 3-гигабайтный dlc.rpf целиком. Каждый пакет —
 * та же строгая форма, что у одиночной установки; `packages` — `[{ manifest, packageRoot, replaceModIds, origin }]`.
 */
export async function installLocalClothingReplacePackages({ packages, ...options }) {
  for (const item of packages || [])
    if (!isLocalClothingReplaceManifest(item?.manifest, options?.edition))
      throw new Error(CLOTHING_REPLACE_REFUSAL);
  return installPackageBatch({
    ...options,
    packages: (packages || []).map((item) => ({ ...item, _internalTrust: LOCAL_CLOTHING_REPLACE_TRUST })),
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

/*
 * Ганпак из студии «Ганпаки»: модели и текстуры стволов чужого пака ложатся
 * в тот же Astral Weapons DLC, что и скины, а не заменой патчдея игры.
 */
const GUNPACK_REFUSAL =
  "Установка ганпака разрешена только для моделей и текстур оружия (w_*.ydr, w_*.ytd) в Astral Weapons DLC GTA V Legacy.";

export async function planLocalGunpackPackage(options) {
  if (!isLocalGunpackManifest(options?.manifest, options?.edition))
    throw new Error(GUNPACK_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalGunpackPackage(options) {
  if (!isLocalGunpackManifest(options?.manifest, options?.edition))
    throw new Error(GUNPACK_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_GUNPACK_TRUST,
  });
}

/*
 * Тату сервера из мастерской: одна картинка наложения под её именем в
 * Astral Clothing DLC (`server-tattoo-manifest-trust.js`).
 */
const SERVER_TATTOO_REFUSAL =
  "Тату сервера ставится только одной картинкой наложения под её именем в Astral Clothing DLC GTA V Legacy.";

export async function planLocalServerTattooPackage(options) {
  if (!isLocalServerTattooManifest(options?.manifest, options?.edition))
    throw new Error(SERVER_TATTOO_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalServerTattooPackage(options) {
  if (!isLocalServerTattooManifest(options?.manifest, options?.edition))
    throw new Error(SERVER_TATTOO_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_SERVER_TATTOO_TRUST,
  });
}

/*
 * Покраска тату игры из мастерской (задача 10): картинки наложений под
 * своими именами в Astral Clothing DLC (`tattoo-paint-manifest-trust.js`).
 */
const TATTOO_PAINT_REFUSAL =
  "Покраска тату ставится только картинками наложений под их именами в Astral Clothing DLC GTA V Legacy.";

export async function planLocalTattooPaintPackage(options) {
  if (!isLocalTattooPaintManifest(options?.manifest, options?.edition))
    throw new Error(TATTOO_PAINT_REFUSAL);
  return planPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
  });
}

export async function installLocalTattooPaintPackage(options) {
  if (!isLocalTattooPaintManifest(options?.manifest, options?.edition))
    throw new Error(TATTOO_PAINT_REFUSAL);
  return installPackage({
    ...options,
    allowGameRootWrites: true,
    requireSignature: false,
    _internalTrust: LOCAL_TATTOO_PAINT_TRUST,
  });
}
