// Отложенные каналы IPC: таблица модулей и загрузчик, который подключает их по одному
// уже после показа окна (главный процесс Electron).
import { installSettingsPackage, planSettingsPackage } from "./settings-package.js";
import { installRebuilderStubs } from "./layer-works.js";

const words = (text) => text.trim().split(/\s+/);

// Ключи IPC_CHANNELS, которые регистрирует каждый модуль, в порядке регистрации.
const CHANNELS = {
  installer: words(`
    PREPARE_GAME PLAN_PACKAGE INSTALL_PACKAGE SET_DOWNLOADS_ACCELERATED PREFETCH_PACKAGE
    INSTALL_REMOTE_PACKAGE INSTALL_REMOTE_PACKAGES CANCEL_OPERATION UNINSTALL_PACKAGE REDUX_LAYER
    RP_MIGRATE_STATUS RP_MIGRATE_RUN
  `),
  "game-settings": words(`
    READ_GAME_SETTINGS APPLY_GAME_SETTINGS RESTORE_GAME_SETTINGS ANALYZE_GAME_SETTINGS
    READ_MOUSE_SETTINGS APPLY_MOUSE_SETTINGS RESTORE_MOUSE_SETTINGS READ_HARDWARE
    ANALYZE_OPTIMIZATION PLAN_OPTIMIZATION APPLY_OPTIMIZATION ROLLBACK_OPTIMIZATION
    OPTIMIZATION_HISTORY
  `),
  "workshop-resource": words(`
    WORKSHOP_CHOOSE_RESOURCE_ROOT WORKSHOP_PLAN_RESOURCE WORKSHOP_APPLY_RESOURCE
    WORKSHOP_ROLLBACK_RESOURCE WORKSHOP_OPEN_PATH WORKSHOP_OPEN_PROJECT_FOLDER
  `),
  "native-engine": words(`
    NATIVE_HEALTH NATIVE_CONVERT_MODEL NATIVE_READ_MODEL_ARS2 NATIVE_EXTRACT_TEXTURES
    NATIVE_RENAME_TEXTURE NATIVE_VALIDATE_RPF_PATCH NATIVE_INSTALL_RPF_PATCH
    NATIVE_RESTORE_RPF_POINT ENGINE_ASSETS_ORIGIN
  `),
  "mega-mall": words(`
    WORKSHOP_MEGA_MALL_CAPABILITIES WORKSHOP_IMPORT_MEGA_MALL_SOURCE
    WORKSHOP_LIST_MEGA_MALL_SOURCES WORKSHOP_RELEASE_MEGA_MALL_SOURCE
    WORKSHOP_EXPORT_MEGA_MALL_PROJECT WORKSHOP_IMPORT_MEGA_MALL_PROJECT
    WORKSHOP_RENDER_MEGA_MALL_PREVIEW WORKSHOP_MEGA_MALL_BUILDING_MODEL
    WORKSHOP_MEGA_MALL_BUILDING_MODELS WORKSHOP_MEGA_MALL_SECTION WORKSHOP_MEGA_MALL_SECTION_BUNDLE
    WORKSHOP_PLAN_MEGA_MALL WORKSHOP_APPLY_MEGA_MALL WORKSHOP_REMOVE_MEGA_MALL
  `),
  "street-light": words(`
    WORKSHOP_STREET_LIGHT_CAPABILITIES WORKSHOP_PLAN_STREET_LIGHTS WORKSHOP_APPLY_STREET_LIGHTS
    WORKSHOP_REMOVE_STREET_LIGHTS WORKSHOP_DISABLE_STREET_LIGHTS
  `),
  "hud-surface": words(`
    WORKSHOP_READ_GPS WORKSHOP_READ_GPS_GRAPH WORKSHOP_PLAN_GPS WORKSHOP_APPLY_GPS
    WORKSHOP_PLAN_TARGET_HP WORKSHOP_APPLY_TARGET_HP WORKSHOP_READ_GROUP_MARKERS
    WORKSHOP_PLAN_GROUP_MARKERS WORKSHOP_APPLY_GROUP_MARKERS WORKSHOP_READ_BLIP_ICONS
    WORKSHOP_PLAN_BLIP_ICONS WORKSHOP_APPLY_BLIP_ICONS WORKSHOP_PLAN_RETICLE WORKSHOP_APPLY_RETICLE
    WORKSHOP_PLAN_MINIMAP WORKSHOP_APPLY_MINIMAP WORKSHOP_CHECK_MINIMAP_FILM
    WORKSHOP_APPLY_MINIMAP_FILM_REPAIR WORKSHOP_REPORT_MINIMAP_FILM
  `),
  "interior-editor": words(`
    WORKSHOP_INTERIOR_CAPABILITIES WORKSHOP_PLAN_INTERIOR WORKSHOP_APPLY_INTERIOR
    WORKSHOP_REMOVE_INTERIOR
  `),
  "climb-editor": words("WORKSHOP_PLAN_CLIMBS WORKSHOP_APPLY_CLIMBS WORKSHOP_REMOVE_CLIMBS"),
  "sound-pack": words(`
    WORKSHOP_CHOOSE_SOUND_PACK WORKSHOP_SOUND_PACKS_INSTALLED WORKSHOP_PLAN_SOUND_PACK
    WORKSHOP_APPLY_SOUND_PACK WORKSHOP_REMOVE_SOUND_PACK
  `),
  "world-map": words(`
    WORKSHOP_MAP_TILES WORKSHOP_MAP_RADAR_COLOURS WORKSHOP_MAP_ISLAND WORKSHOP_MAP_GEOMETRY
    WORKSHOP_MAP_BEGIN WORKSHOP_MAP_STAGE WORKSHOP_MAP_END WORKSHOP_PLAN_MAP WORKSHOP_APPLY_MAP
    WORKSHOP_MAP_STOCK_STATUS WORKSHOP_MAP_RESTORE_STOCK WORKSHOP_REMOVE_MAP
  `),
  timecycle: words(`
    WORKSHOP_READ_TIMECYCLE WORKSHOP_SKY_TEXTURES WORKSHOP_CLOUD_HATS WORKSHOP_CLOUD_HAT_TEXTURE
    WORKSHOP_PLAN_TIMECYCLE WORKSHOP_SKY_RAINBOW WORKSHOP_SKY_RAINBOW_STATUS WORKSHOP_SKY_SOURCES
    WORKSHOP_SKY_SOURCE WORKSHOP_APPLY_TIMECYCLE
  `),
  "project-interiors": words(`
    WORKSHOP_PROJECT_INTERIORS_STATE WORKSHOP_PROJECT_INTERIORS_ADD_SOURCE
    WORKSHOP_PROJECT_INTERIORS_REMOVE_SOURCE WORKSHOP_PROJECT_INTERIORS_CATALOG
    WORKSHOP_PROJECT_INTERIORS_SCENE WORKSHOP_PROJECT_INTERIORS_SHEETS
    WORKSHOP_PROJECT_INTERIORS_CDN_STATE WORKSHOP_PROJECT_INTERIORS_CDN_FETCH
    WORKSHOP_PROJECT_INTERIORS_CDN_CANCEL WORKSHOP_PROJECT_INTERIORS_CDN_REMOVE
  `),
  "selection-markup": words("WORKSHOP_SELECTION_MARKUP"),
  "lamp-studio": words("WORKSHOP_READ_LAMPS WORKSHOP_PLAN_LAMPS WORKSHOP_APPLY_LAMPS"),
  wallbang: words("WORKSHOP_PLAN_WALLBANG WORKSHOP_APPLY_WALLBANG"),
  animals: words(`
    ANIMALS_LIST ANIMALS_READ WORKSHOP_PLAN_ANIMALS WORKSHOP_APPLY_ANIMALS
  `),
  "wheel-smoke": words(`
    WORKSHOP_READ_WHEEL_SMOKE WORKSHOP_READ_WHEEL_SMOKE_CAR WORKSHOP_PLAN_WHEEL_SMOKE
    WORKSHOP_APPLY_WHEEL_SMOKE
  `),
  recolor: words(`
    WORKSHOP_PLAN_RECOLOR WORKSHOP_CANCEL_RECOLOR_PLAN WORKSHOP_TEXTURES WORKSHOP_SHOP_SCENE
    WORKSHOP_WORLD_PLACE_SCENE WORKSHOP_FONT_SOURCES WORKSHOP_APPLY_ZONES WORKSHOP_APPLY_FACTORY
    WORKSHOP_APPLY_HANGAR WORKSHOP_APPLY_MAPPING WORKSHOP_APPLY_ARENAS WORKSHOP_APPLY_WATER
    WORKSHOP_APPLY_VEGETATION WORKSHOP_APPLY_FONTS WORKSHOP_APPLY_MEGAMALL WORKSHOP_APPLY_YOUTOOL
    WORKSHOP_APPLY_VINEWOOD WORKSHOP_APPLY_BUSSTOPS WORKSHOP_APPLY_MSLZONES
    WORKSHOP_APPLY_FLOATLOGO WORKSHOP_APPLY_AIRSHIPS WORKSHOP_APPLY_SHOPS WORKSHOP_APPLY_BILLBOARDS
    WORKSHOP_APPLY_CAPTZONES WORKSHOP_APPLY_SCHEDULE WORKSHOP_APPLY_FLAGS WORKSHOP_APPLY_ATMS
    WORKSHOP_APPLY_PROJECTINTERIORS WORKSHOP_APPLY_MAJESTICINTERIORS WORKSHOP_APPLY_ROADS
  `),
  "workshop-tools": words("WORKSHOP_TOOLS_STATUS WORKSHOP_TOOLS_PROVISION WORKSHOP_TOOLS_REVEAL"),
  "sound-studio": words(`
    WORKSHOP_SOUND_BANKS WORKSHOP_SOUND_STREAM WORKSHOP_SOUND_SHOT WORKSHOP_SOUND_BANK
    WORKSHOP_SOUND_PROFILE WORKSHOP_SOUND_BEGIN WORKSHOP_SOUND_STAGE WORKSHOP_SOUND_END
    WORKSHOP_SOUND_PLAN WORKSHOP_SOUND_WORKS WORKSHOP_SOUND_HITS_BUDGET WORKSHOP_SOUND_HITS_PLAN
    WORKSHOP_SOUND_WEAPON_PLAN WORKSHOP_SOUND_MIX_PLAN WORKSHOP_SOUND_APPLY
    WORKSHOP_SOUND_HITS_APPLY WORKSHOP_SOUND_WEAPON_APPLY WORKSHOP_SOUND_MIX_APPLY
    WORKSHOP_SOUND_REMOVE
  `),
  optimizer: words(`
    WORKSHOP_PLAN_OPTIMIZATION_LAYER WORKSHOP_APPLY_OPTIMIZATION_LAYER WORKSHOP_PLAN_OPTIMIZER
    WORKSHOP_APPLY_OPTIMIZER WORKSHOP_ROLLBACK_OPTIMIZER
  `),
  ptfx: words(`
    WORKSHOP_READ_PTFX WORKSHOP_PLAN_PTFX WORKSHOP_APPLY_PTFX WORKSHOP_READ_KILL_EFFECT
    WORKSHOP_PLAN_KILL_EFFECT WORKSHOP_APPLY_KILL_EFFECT WORKSHOP_READ_SCREEN_HITS
    WORKSHOP_PLAN_SCREEN_HITS WORKSHOP_APPLY_SCREEN_HITS
  `),
  animations: words(`
    ANIMATIONS_LIST ANIMATIONS_RIG ANIMATIONS_TRACK ANIMATIONS_POSES ANIMATIONS_CHOOSE_SOURCE
    ANIMATIONS_ADD_SOURCE ANIMATIONS_REMOVE_SOURCE ANIMATIONS_PLAN_INSTALL ANIMATIONS_APPLY_INSTALL
    ANIMATIONS_REMOVE_INSTALL ANIMATIONS_INSTALLED
  `),
  gunpack: words(`
    WORKSHOP_LIST_GUNPACKS WORKSHOP_READ_WEAPON_ICONS WORKSHOP_CHOOSE_GUNPACK
    WORKSHOP_IMPORT_GUNPACK WORKSHOP_GUNPACK_MODEL WORKSHOP_GAME_RUNNING WORKSHOP_GAME_WEAPON_MODEL
    WORKSHOP_VERIFY_WEAPON_SKIN WORKSHOP_GAME_WEAPON_IN_HANDS WORKSHOP_GAME_STANDING_BODY
    WORKSHOP_GAME_COMBAT_DECALS WORKSHOP_GAME_CLOTHING_LIST CLOTHING_GAME_TATTOOS
    CLOTHING_GAME_TATTOO_PICTURE CLOTHING_GAME_BEARDS CLOTHING_GAME_BEARD_PICTURE
    CLOTHING_GAME_BEARD_BAKE WORKSHOP_APPLY_GAME_BEARD
    CLOTHING_CATALOG_TATTOO_PICTURES CATALOG_PART_FILES
    CATALOG_PART_GEOMETRY CLOTHING_SERVER_LIST CLOTHING_GAME_ITEMS CLOTHING_SERVER_TATTOO_MODEL
    CLOTHING_MAJESTIC_WIKI CLOTHING_PROJECT_ITEMS CLOTHING_PROJECT_PICTURE
    WORKSHOP_GAME_CLOTHING_MODEL WORKSHOP_CATALOG_CLOTHING_MODEL WORKSHOP_CLOTHING_CHARACTER
    WORKSHOP_APPLY_WEAPON_SKIN WORKSHOP_REMOVE_WEAPON_SKIN WORKSHOP_APPLY_CLOTHING_SKIN
    WORKSHOP_REMOVE_CLOTHING_SKIN WORKSHOP_APPLY_TATTOO_PAINT WORKSHOP_APPLY_SERVER_TATTOO
    WORKSHOP_GUNPACK_STUDIO_LIST WORKSHOP_GUNPACK_STUDIO_CHOOSE WORKSHOP_GUNPACK_STUDIO_OPEN
    WORKSHOP_GUNPACK_STUDIO_READ WORKSHOP_GUNPACK_STUDIO_SAVE_SHOT WORKSHOP_GUNPACK_STUDIO_SHOTS
    WORKSHOP_GUNPACK_STUDIO_SET_LOOK WORKSHOP_GUNPACK_STUDIO_COMPOSE WORKSHOP_GUNPACK_STUDIO_REMOVE
    WORKSHOP_GUNPACK_STUDIO_TO_INBOX WORKSHOP_GUNPACK_STUDIO_MODEL
    WORKSHOP_GUNPACK_STUDIO_FROM_CATALOG WORKSHOP_APPLY_GUNPACK WORKSHOP_REMOVE_GUNPACK WORKSHOP_REMOVE_GUNPACK_MODEL
    WORKSHOP_APPLY_PACK_SKIN WORKSHOP_REMOVE_PACK_SKIN CLOTHING_REPLACE_APPLY
  `),
  publisher: words(`
    PUBLISHER_CHOOSE_REDUX PUBLISHER_CHOOSE_CLEAN_BASE PUBLISHER_CHOOSE_SOURCES
    PUBLISHER_CHOOSE_SOURCE_FOLDER PUBLISHER_INSPECT_REDUX PUBLISHER_INSPECT_SOURCES
    PUBLISHER_BUILD_REDUX_PACKAGES PUBLISHER_PREPARE_DRAFTS PUBLISHER_LIST_INBOX
    PUBLISHER_INBOX_THUMBNAILS PUBLISHER_MARK_PUBLISHED PUBLISHER_DISCARD_DRAFT
    PUBLISHER_REDUX_BASELINES PUBLISHER_FORGET_REDUX_BASELINE PUBLISHER_CAPTURE_REGION
    PUBLISHER_SAVE_DRAFT_FRAME PUBLISHER_UPDATE_DRAFT_MEDIA PUBLISHER_SET_BATCH_SOURCES
    PUBLISHER_WORK_TO_INBOX PUBLISHER_READ_DRAFT_AUDIO PUBLISHER_READ_DRAFT_PART_FILES
    PUBLISHER_RUN_INTAKE_JOB PUBLISHER_OPEN_BATCH
  `),
  arena: words(`
    WORKSHOP_ARENA_HALL_MANIFEST WORKSHOP_ARENA_HALL_PIECE WORKSHOP_ARENA_MOD_HALL
    WORKSHOP_CHOOSE_ARENA_HALL_FOLDER WORKSHOP_CHOOSE_ARENA_SOURCE WORKSHOP_INSPECT_ARENA_SOURCE
    WORKSHOP_PLAN_ARENA WORKSHOP_APPLY_ARENA WORKSHOP_REMOVE_ARENA
  `),
  reshade: words("RESHADE_READ RESHADE_APPLY RESHADE_REMOVE"),
  "stock-reset": words(`
    STOCK_RESET_SCAN STOCK_RESET_PROGRESS STOCK_RESET_APPLY STOCK_RESET_VERIFY
    STOCK_QUARANTINE_LIST STOCK_QUARANTINE_RESTORE
  `),
};

// ---------- сборка аргумента для фабрики регистрации ----------

const same = (names) => names.map((name) => [name, name]);

/** Читает поля контекста строго по очереди: пара «ключ аргумента, поле контекста». */
function gather(context, pairs) {
  const picked = {};
  for (const [key, field] of pairs) picked[key] = context[field];
  return picked;
}

/** Пункт из трёх элементов — охранник `legacyRuntimeGuard(родительный, подлежащее)`, из двух — поле контекста. */
function assemble(context, items) {
  const built = {};
  for (const [key, first, second] of items) {
    built[key] = second === undefined ? context[first] : context.legacyRuntimeGuard(first, second);
  }
  return built;
}

/** Зависимости мастерской (копия) и добавки; `after` дописывает члены, не читающие контекст сразу. */
const extend = (items, after) => (context) => ({
  ...context.workshopDeps,
  ...assemble(context, items),
  ...after?.(context),
});

/** Собственный аргумент без зависимостей мастерской. */
const direct = (items, after) => (context) => ({ ...assemble(context, items), ...after?.(context) });

const asIs = (context) => context.workshopDeps;

const calling = (factory, recipe) => (loaded, context) => loaded[factory](recipe(context));

const lazy = (id, load, factory, recipe) => ({ id, load, register: calling(factory, recipe) });

const gameItems = [
  ["findGame", "findGame"],
  ["gameProcessRunning", "gameProcessRunning"],
];

const soundPackDialogOptions = () => ({
  title: "Выберите папку или архив с готовым набором звуков",
  properties: ["openFile", "openDirectory"],
  filters: [
    { name: "Набор звуков", extensions: ["zip", "oiv"] },
    { name: "Все файлы", extensions: ["*"] },
  ],
});

const askSoundPack = (context) => async () => {
  const reply = await context.dialog.showOpenDialog(soundPackDialogOptions());
  return reply.canceled ? null : reply.filePaths[0];
};

function installerArgument(context) {
  const have = gather(
    context,
    same([
      "IPC", "app", "handleIpc", "trusted", "safeInput", "findGame", "desktopStorage", "catalogPublicKey", "activeOperations",
      "downloadHostAllowlist", "localDevelopmentBuild", "gtaSettingsPath", "gtaSettingsStateDir", "workshopOperations",
      "callNativeEngine", "nativeContext", "rockstar",
    ]),
  );
  const { gtaSettingsPath, gtaSettingsStateDir, workshopOperations: operations, callNativeEngine, nativeContext } = have;
  // Путь и папка состояния подставляются поверх того, что пришло от вызывающего.
  const withSettingsFiles = async (input) => {
    const settingsPath = gtaSettingsPath();
    const stateDir = await gtaSettingsStateDir();
    return { ...input, settingsPath, stateDir };
  };
  return {
    IPC: have.IPC,
    handleIpc: have.handleIpc,
    trusted: have.trusted,
    safeInput: have.safeInput,
    app: have.app,
    findGame: have.findGame,
    desktopStorage: have.desktopStorage,
    catalogPublicKey: have.catalogPublicKey,
    activeOperations: have.activeOperations,
    downloadHostAllowlist: have.downloadHostAllowlist,
    localDevelopmentBuild: have.localDevelopmentBuild,
    settingsPlanner: async (input) => planSettingsPackage(await withSettingsFiles(input)),
    settingsInstaller: async (input) => installSettingsPackage(await withSettingsFiles(input)),
    gtaSettingsPath,
    gtaSettingsStateDir,
    workshopBusy: () => operations.isBusy(),
    trackPrepare: (task) => operations.trackPrepare(task),
    compileNative: (command, input) => callNativeEngine(command, input, nativeContext()),
    rockstarDelivery: have.rockstar.delivery,
  };
}

function resourceArgument(context) {
  const have = gather(
    context,
    same(["IPC", "app", "handleIpc", "trusted", "safeInput", "dialog", "shell", "workshopOperations", "presence", "broadcastWorkshopProgress"]),
  );
  const { app, workshopOperations: operations, presence } = have;
  const consentReset = () => presence.resetCloseConsent();
  return {
    IPC: have.IPC,
    handleIpc: have.handleIpc,
    trusted: have.trusted,
    safeInput: have.safeInput,
    dialog: have.dialog,
    shell: have.shell,
    userDataDir: () => app.getPath("userData"),
    onProgress: have.broadcastWorkshopProgress,
    operationGate: {
      isBusy: () => operations.isBusy(),
      begin() {
        operations.begin("FiveM resource");
        consentReset();
      },
      end() {
        operations.end();
        consentReset();
      },
    },
  };
}

/** Охранник оптимизации вычисляется раньше, чем читается путь к настройкам. */
function optimizerArgument(context) {
  const deps = context.workshopDeps;
  const runtimeGuard = context.legacyRuntimeGuard("оптимизации", "Оптимизация");
  return { ...deps, gtaSettingsPath: context.gtaSettingsPath, runtimeGuard };
}

// Порядок строк — порядок загрузки при loadAll. Модули, нужные всем, грузятся первыми и сразу после окна.
const MODULES = [
  {
    id: "installer",
    eager: true,
    load: () => import("./installer-ipc.js"),
    register(loaded, context) {
      loaded.registerInstallerIpc(installerArgument(context));
    },
  },
  {
    id: "game-settings",
    eager: true,
    load: () => import("./game-settings-ipc.js"),
    register: calling(
      "registerGameSettingsIpc",
      extend([
        ["gtaSettingsPath", "gtaSettingsPath"],
        ["gtaSettingsStateDir", "gtaSettingsStateDir"],
        ...gameItems,
        ["emitOptimizationProgress", "broadcastOptimizationProgress"],
      ]),
    ),
  },
  {
    id: "workshop-resource",
    eager: true,
    load: () => import("./workshop-resource-ipc.js"),
    register(loaded, context) {
      loaded.registerWorkshopResourceIpc(resourceArgument(context));
    },
  },
  {
    id: "native-engine",
    eager: true,
    load: () => import("./native-engine-ipc.js"),
    register: calling("registerNativeEngineIpc", asIs),
  },
  lazy(
    "mega-mall",
    () => import("./mega-mall-desktop-ipc.js"),
    "registerMegaMallDesktopIpc",
    direct([
      ["IPC", "IPC"], ["handleIpc", "guardedIpc"], ["trusted", "trusted"], ["safeInput", "safeInput"], ["desktopStorage", "desktopStorage"],
      ["dialog", "dialog"], ["fs", "fs"], ["findGame", "findGame"], ["nativeContext", "nativeContext"],
    ]),
  ),
  lazy(
    "street-light",
    () => import("./street-light-ipc.js"),
    "registerStreetLightIpc",
    direct([
      ["IPC", "IPC"], ["handleIpc", "guardedIpc"], ["trusted", "trusted"], ["safeInput", "safeInput"], ["desktopStorage", "desktopStorage"],
      ["listGames", "discoverGames"], ["gameProcessRunning", "gameProcessRunning"],
    ], () => ({
      /* Прежним фонарям нужна пара загрузчиков: ставится перед планом, уходит со снятием (`loaders-on-demand.js`, 23.11.2026). */
      loaders: {
        ensure: async (input) => (await import("./loaders-on-demand.js")).ensureLoadersForLegacy(input),
        retire: async (input) => (await import("./loaders-on-demand.js")).retireLoadersForLegacy(input),
      },
    })),
  ),
  lazy(
    "hud-surface",
    () => import("./hud-surface-ipc.js"),
    "registerHudSurfaceIpc",
    extend([
      ["reticleGuard", "прицела", "Прицел"],
      ["minimapGuard", "мини-карты", "Мини-карта"],
      ["gtaSettingsPath", "gtaSettingsPath"],
      ["gpsGuard", "меток и GPS", "Метки и GPS"],
      ["targetHpGuard", "полоски HP", "Полоска HP"],
      ["groupMarkersGuard", "групповых меток", "Групповые метки"],
      ["blipIconsGuard", "значков карты", "Значки карты"],
    ]),
  ),
  lazy(
    "interior-editor",
    () => import("./interior-editor-ipc.js"),
    "registerInteriorEditorIpc",
    extend(gameItems, (context) => ({
      compileNative: (input) => context.callNativeEngine("compile-interior-layout", input, context.nativeContext()),
    })),
  ),
  lazy("climb-editor", () => import("./climb-editor-ipc.js"), "registerClimbEditorIpc", extend(gameItems)),
  lazy(
    "sound-pack",
    () => import("./sound-pack-ipc.js"),
    "registerSoundPackIpc",
    extend(gameItems, (context) => ({ chooseFolder: askSoundPack(context) })),
  ),
  lazy("world-map", () => import("./world-map-ipc.js"), "registerWorldMapIpc", extend([["runtimeGuard", "большой карты", "Большая карта"]])),
  lazy("timecycle", () => import("./timecycle-ipc.js"), "registerTimecycleIpc", extend([["runtimeGuard", "неба", "Небо"]])),
  lazy("project-interiors", () => import("./project-interiors-ipc.js"), "registerProjectInteriorsIpc", extend([["dialog", "dialog"]])),
  lazy("selection-markup", () => import("./selection-markup-ipc.js"), "registerSelectionMarkupIpc", asIs),
  lazy("lamp-studio", () => import("./lamp-studio-ipc.js"), "registerLampStudioIpc", asIs),
  lazy("wallbang", () => import("./wallbang-ipc.js"), "registerWallbangIpc", asIs),
  lazy("animals", () => import("./animals/animals-ipc.js"), "registerAnimalsIpc", asIs),
  lazy("wheel-smoke", () => import("./wheel-smoke-ipc.js"), "registerWheelSmokeIpc", asIs),
  lazy("recolor", () => import("./recolor-ipc.js"), "registerRecolorIpc", asIs),
  lazy("workshop-tools", () => import("./workshop-tools-ipc.js"), "registerWorkshopToolsIpc", extend([["shell", "shell"]])),
  lazy("sound-studio", () => import("./sound-studio-ipc.js"), "registerSoundStudioIpc", extend([["runtimeGuard", "звукового пака", "Звуковой пак"]])),
  lazy("optimizer", () => import("./optimizer-ipc.js"), "registerOptimizerIpc", optimizerArgument),
  lazy(
    "ptfx",
    () => import("./ptfx-ipc.js"),
    "registerPtfxIpc",
    extend([
      ["ptfxGuard", "эффектов попадания", "Эффекты попадания"],
      ["killEffectGuard", "килл-эффекта", "Килл-эффект"],
      ["screenHitsGuard", "эффектов попадания на экране", "Эффекты попадания на экране"],
    ]),
  ),
  lazy(
    "animations",
    () => import("./animations/animations-ipc.js"),
    "registerAnimationsIpc",
    extend([
      ["dialog", "dialog"],
      ["installGuard", "замены анимаций", "Анимации"],
    ]),
  ),
  lazy(
    "gunpack",
    () => import("./gunpack-ipc.js"),
    "registerGunpackIpc",
    extend([
      ["dialog", "dialog"],
      ["ops", "workshopOperations"],
    ]),
  ),
  lazy(
    "publisher",
    () => import("./publisher-ipc.js"),
    "registerPublisherIpc",
    extend([
      ["dialog", "dialog"],
      ["shell", "shell"],
      ["clothingShots", "clothingShots"],
    ]),
  ),
  lazy(
    "arena",
    () => import("./arena-ipc.js"),
    "registerArenaIpc",
    extend([
      ["dialog", "dialog"],
      ["findGame", "findGame"],
    ]),
  ),
  lazy("reshade", () => import("./reshade-ipc.js"), "registerReshadeIpc", extend([])),
  lazy(
    "stock-reset",
    () => import("./stock-reset/stock-reset-ipc.js"),
    "registerStockResetIpc",
    direct(
      [
        ["IPC", "IPC"], ["handleIpc", "guardedIpc"], ["trusted", "trusted"], ["safeInput", "safeInput"], ["shell", "shell"],
        ["findGame", "findGame"], ["gameProcessRunning", "gameProcessRunning"],
      ],
      // Хранилище и папка данных запрашиваются при каждом вызове, без кэша.
      (context) => ({
        installOptions: () => context.desktopStorage().installOptions(),
        userDataDir: () => context.app.getPath("userData"),
      }),
    ),
  ),
];

export const DEFERRED_MODULES = Object.freeze(
  MODULES.map(({ id, eager, load, register }) =>
    Object.freeze(Object.assign({ id }, eager && { eager }, { load, register, channels: Object.freeze(CHANNELS[id] ?? []) })),
  ),
);

// ---------- загрузчик ----------

const yieldToWindow = () => new Promise((resolve) => setTimeout(resolve, 0));

/* Наборы, чьи сборщики пакетов поверх (`layer-works.js`) регистрирует ленивый модуль канала: заглушки на старте догружают его по первому вызову. */
export const REBUILDER_OWNERS = Object.freeze({ roads: "recolor", vegetation: "recolor", arenas: "recolor", textures: "optimizer" });

export function createDeferredIpc(context, modules = DEFERRED_MODULES) {
  const { IPC, settleIpc } = context;
  const roster = [];
  const channelNames = new Map(); // запись -> имена её каналов
  const ownerOf = new Map(); // имя канала -> запись; при совпадении имён побеждает последняя
  for (const entry of modules) {
    const names = [];
    for (const key of entry.channels) names.push(IPC[key]);
    roster.push(entry);
    channelNames.set(entry, names);
    for (const name of names) ownerOf.set(name, entry);
  }
  const loading = new Map(); // запись -> обещание её загрузки; сбои тоже запоминаются
  const ensureModule = (id) => {
    const entry = roster.find((item) => item.id === id);
    return entry ? loadEntry(entry) : Promise.reject(new Error(`Модуль каналов «${id}» не найден.`));
  };
  installRebuilderStubs(
    Object.keys(REBUILDER_OWNERS).filter((set) => roster.some((item) => item.id === REBUILDER_OWNERS[set])),
    (set) => ensureModule(REBUILDER_OWNERS[set]),
  );

  function loadEntry(entry) {
    let pending = loading.get(entry);
    if (pending === undefined) {
      const names = channelNames.get(entry);
      const registerLoaded = (loaded) => entry.register(loaded, context);
      const refuseChannels = (error) => {
        settleIpc((channel) => names.includes(channel));
        throw error;
      };
      pending = entry.load().then(registerLoaded).catch(refuseChannels);
      loading.set(entry, pending);
    }
    return pending;
  }

  // Записи грузятся по одной; после каждой окну отдаётся нулевой таймер.
  async function drain(entries) {
    const failures = [];
    for (const entry of entries) {
      try {
        await loadEntry(entry);
      } catch (error) {
        failures.push(error);
      }
      await yieldToWindow();
    }
    if (failures.length > 0) throw failures[0];
  }

  async function drainThenSettle(entries, rejected) {
    try {
      await drain(entries);
    } finally {
      settleIpc(rejected);
    }
  }

  let eagerRun;
  let allRun;

  const loadAll = () => (allRun ??= drainThenSettle(roster, () => true));
  const loadEager = () =>
    (eagerRun ??= drainThenSettle(
      roster.filter((entry) => entry.eager),
      (channel) => !ownerOf.has(channel),
    ));
  const loadFor = (channel) => (ownerOf.has(channel) ? loadEntry(ownerOf.get(channel)) : loadAll());

  return { loadEager, loadFor, loadAll };
}
