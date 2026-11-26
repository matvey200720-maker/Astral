const { contextBridge, ipcRenderer, webUtils } = require("electron");
const {
  IPC_CHANNELS: IPC,
  assertIpcArguments,
} = require("@modovik/contracts/ipc");
const { createIpcTiming } = require("./ipc-timing.cjs");
const ipcNonceArgument = process.argv.find((value) =>
  value.startsWith("--astral-ipc-nonce="),
);
const ipcNonce = ipcNonceArgument?.slice("--astral-ipc-nonce=".length) || "";
if (ipcNonce.length < 32) throw new Error("Missing IPC capability.");

/*
 * Ошибка главного процесса приходит в окно завёрнутой.
 *
 * Electron склеивает её так: `Error invoking remote method
 * 'modovik:workshop-sound-banks': Error: Unsupported RPF helper mode.` Внутри
 * — то, что главный процесс написал человеку; снаружи — имя канала и слово
 * «Error» дважды. В окне это и показывалось: экран звуков говорил про
 * `modovik:workshop-...` вместо того, чтобы сказать, что делать.
 *
 * Разворачивается здесь, на границе, а не в каждом редакторе. Редакторов
 * два десятка, каналов — сотня, и правило «снять обёртку» одно на всех: место
 * ему там, где обёртка надевается. Имя и код ошибки переносятся, чтобы
 * `AbortError` и `ENOENT` продолжали узнаваться по ним.
 */
const REMOTE_WRAPPER =
  /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/;

const unwrapRemote = (error) => {
  const message = String(error?.message || "");
  const clean = message.replace(REMOTE_WRAPPER, "").trim();
  if (!clean || clean === message) return error;
  const next = new Error(clean);
  if (error?.name) next.name = error.name;
  if (error?.code !== undefined) next.code = error.code;
  return next;
};

const invokeRemote = (channel, ...args) => {
  assertIpcArguments(channel, args);
  return ipcRenderer.invoke(channel, ipcNonce, ...args).catch((error) => {
    throw unwrapRemote(error);
  });
};
/* Замер ожидания IPC — только со стендом: `ASTRAL_PERF_IPC=1` в окружении Electron (`ipc-timing.cjs`). Окно
   наследует окружение главного процесса, и песочный preload его видит. Без флага `invoke` — та же функция. */
const ipcTiming =
  process.env?.ASTRAL_PERF_IPC === "1" ? createIpcTiming() : null;
const invoke = ipcTiming ? ipcTiming.wrap(invokeRemote) : invokeRemote;
const send = (channel, ...args) => {
  assertIpcArguments(channel, args);
  ipcRenderer.send(channel, ipcNonce, ...args);
};

const demoMode = process.argv.includes("--astral-demo=1");
const localDeveloperMode = process.argv.includes("--astral-local-developer=1");
const localFirstRunQaMode = process.argv.includes(
  "--astral-local-first-run-qa=1",
);
/* Реклама — только явно: главный процесс с ASTRAL_ADS_ENABLED=1 (Т-165). */
const adsEnabled = process.argv.includes("--astral-ads=1");
let queuedDeepLink = "";
const deepLinkListeners = new Set();

ipcRenderer.on(IPC.DEEP_LINK, (_event, value) => {
  queuedDeepLink = String(value || "");
  deepLinkListeners.forEach((listener) => listener(queuedDeepLink));
});
const demoManifest = (id, slot) => ({
  id,
  version: "demo",
  adapter: "file-overlay",
  editions: ["Legacy", "Enhanced"],
  requiresLoader: false,
  gameplayChanges: false,
  scope: "mods-only",
  slots: [slot],
  files: [],
});
const demoMods = [
  {
    id: "astral-demo-redux",
    name: "Astral Night Redux",
    author: "ASTRAL LAB",
    description: "Тестовый визуальный пак с ночным освещением и отражениями.",
    category: "graphics",
    categoryLabel: "ГРАФИКА",
    catalogSection: "redux",
    catalogMode: "pack",
    catalogSlot: "redux-pack",
    platforms: ["gta5rp", "majestic", "redux", "story"],
    platformLabel: "Legacy · Enhanced",
    rating: "4.9",
    downloads: "DEMO",
    editions: ["Legacy", "Enhanced"],
    packageStatus: "ready",
    cover: "/media/gta-city-night.jpg",
    manifest: demoManifest("astral-demo-redux", "demo-redux"),
  },
  {
    id: "astral-demo-roads",
    name: "Neon Roads",
    author: "ASTRAL LAB",
    description: "Тестовый набор дорог, разметки и мокрого асфальта.",
    category: "graphics",
    categoryLabel: "ДОРОГИ",
    catalogSection: "redux",
    catalogMode: "selective",
    catalogSlot: "roads",
    platforms: ["gta5rp", "majestic", "redux", "story"],
    platformLabel: "Legacy · Enhanced",
    rating: "4.8",
    downloads: "DEMO",
    editions: ["Legacy", "Enhanced"],
    packageStatus: "ready",
    cover: "/media/gta-night-drive.jpg",
    manifest: demoManifest("astral-demo-roads", "demo-roads"),
  },
  {
    id: "astral-demo-gunpack",
    name: "Tactical Demo Pack",
    author: "ASTRAL LAB",
    description: "Тестовый комплект оружия для проверки каталога и очереди.",
    category: "weapons",
    categoryLabel: "ОРУЖИЕ",
    catalogSection: "gunpacks",
    catalogMode: "pack",
    catalogSlot: "carbine-rifle",
    platforms: ["gta5rp", "majestic"],
    platformLabel: "GTA 5 RP · Majestic",
    rating: "4.7",
    downloads: "DEMO",
    editions: ["Legacy", "Enhanced"],
    packageStatus: "ready",
    cover: "/media/mod-rifle.png",
    manifest: demoManifest("astral-demo-gunpack", "demo-gunpack"),
  },
  {
    id: "astral-demo-shirt",
    name: "Astral Streetwear",
    author: "ASTRAL LAB",
    description: "Тестовый комплект одежды для проверки профилей сборок.",
    category: "clothing",
    categoryLabel: "ОДЕЖДА",
    catalogSection: "clothing",
    catalogMode: "selective",
    catalogSlot: "tshirts",
    platforms: ["gta5rp", "majestic"],
    platformLabel: "GTA 5 RP · Majestic",
    rating: "4.9",
    downloads: "DEMO",
    editions: ["Legacy", "Enhanced"],
    packageStatus: "ready",
    cover: "/media/gta-hero.jpg",
    manifest: demoManifest("astral-demo-shirt", "demo-shirt"),
  },
  {
    id: "astral-demo-smoke",
    name: "Clean Smoke",
    author: "ASTRAL LAB",
    description: "Тестовый эффект дыма без изменения файлов настоящей игры.",
    category: "effects",
    categoryLabel: "ЭФФЕКТЫ",
    catalogSection: "other",
    catalogMode: "selective",
    catalogSlot: "smoke",
    platforms: ["gta5rp", "majestic", "story"],
    platformLabel: "Legacy · Enhanced",
    rating: "4.6",
    downloads: "DEMO",
    editions: ["Legacy", "Enhanced"],
    packageStatus: "ready",
    cover: "/media/redux/tracers.png",
    manifest: demoManifest("astral-demo-smoke", "demo-smoke"),
  },
];

contextBridge.exposeInMainWorld("modovik", {
  isDesktop: true,
  /* Только со стендом (`ASTRAL_PERF_IPC=1`): время ответа каналов для отчёта замера. */
  ...(ipcTiming
    ? {
        perfIpc: {
          stats: () => ipcTiming.stats(),
          reset: () => ipcTiming.reset(),
        },
      }
    : {}),
  demoMode,
  localDeveloperMode,
  localFirstRunQaMode,
  adsEnabled,
  demoContext: demoMode
    ? {
        account: {
          id: "astral-demo-user",
          name: "Demo Tester",
          email: "demo@astral.local",
          role: "demo",
        },
        game: {
          id: "astral-demo-gta",
          store: "Demo",
          edition: "Enhanced",
          path: "C:\\ASTRAL-DEMO\\GTA V",
          executable: "GTA5.exe",
          buildId: "demo-1.0",
          installReadiness: "ready",
          loader: "Astral Demo Loader",
          requiredLoader: null,
        },
        mods: demoMods,
      }
    : null,
  nativeHealth: () => invoke(IPC.NATIVE_HEALTH),
  /* Канал данных Rust-движка: `http://127.0.0.1:<порт>` или null. Токен окну не нужен — его ставит главный процесс. */
  engineAssetsOrigin: () => invoke(IPC.ENGINE_ASSETS_ORIGIN),
  loginCloud: (mode = "login") => invoke(IPC.CLOUD_LOGIN, mode),
  /* Отменить вход, который ждёт браузер (кнопка «Отменить вход» в окне). */
  cancelLoginCloud: () => invoke(IPC.CLOUD_LOGIN_CANCEL),
  getCloudLoginLink: () => invoke(IPC.CLOUD_LOGIN_LINK),
  getCloudSession: () => invoke(IPC.CLOUD_SESSION),
  getCloudCatalog: () => invoke(IPC.CLOUD_CATALOG),
  getCloudNews: () => invoke(IPC.CLOUD_NEWS),
  getCloudShowcase: (place) => invoke(IPC.CLOUD_SHOWCASE, place),
  sendCloudShowcaseEvents: (events) =>
    invoke(IPC.CLOUD_SHOWCASE_EVENTS, events),
  getCloudModLink: (modID) => invoke(IPC.CLOUD_MOD_LINK, modID),
  onCloudCatalog: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.CLOUD_CATALOG_UPDATED, wrapped);
    return () => ipcRenderer.removeListener(IPC.CLOUD_CATALOG_UPDATED, wrapped);
  },
  /* `level` — `choice` (по умолчанию), `press` или `background`: очередь выдачи под пределом сервера (`grant-pacer.js`). */
  getCloudDownloadGrant: (modID, level) => (level ? invoke(IPC.CLOUD_DOWNLOAD_GRANT, modID, String(level)) : invoke(IPC.CLOUD_DOWNLOAD_GRANT, modID)),
  getCloudRating: (modID) => invoke(IPC.CLOUD_CATALOG_RATING_GET, modID),
  setCloudRating: (input) => invoke(IPC.CLOUD_CATALOG_RATING_SET, input),
  getCloudFavorites: () => invoke(IPC.CLOUD_LIBRARY_FAVORITES),
  setCloudFavorite: (input) => invoke(IPC.CLOUD_LIBRARY_SET_FAVORITE, input),
  getCloudBuilds: () => invoke(IPC.CLOUD_LIBRARY_BUILDS),
  createCloudBuild: (input) => invoke(IPC.CLOUD_LIBRARY_CREATE_BUILD, input),
  updateCloudBuild: (input) => invoke(IPC.CLOUD_LIBRARY_UPDATE_BUILD, input),
  deleteCloudBuild: (input) => invoke(IPC.CLOUD_LIBRARY_DELETE_BUILD, input),
  shareWorkCode: (input) => invoke(IPC.CLOUD_WORK_CODE_SHARE, input),
  openSharedWorkCode: (input) => invoke(IPC.CLOUD_WORK_CODE_OPEN, input),
  sendCloudEvents: (input) => invoke(IPC.CLOUD_TELEMETRY, input),
  logoutCloud: () => invoke(IPC.CLOUD_LOGOUT),
  getErrorReporting: () => invoke(IPC.APP_ERRORS_STATE),
  setErrorReporting: (enabled) =>
    invoke(IPC.APP_ERRORS_SET_ENABLED, { enabled: enabled === true }),
  reportAppError: (input) => invoke(IPC.APP_ERRORS_REPORT, input),
  listAppLog: (input) => invoke(IPC.APP_LOG_LIST, input),
  writeAppLog: (input) => invoke(IPC.APP_LOG_WRITE, input),
  exportAppLog: () => invoke(IPC.APP_LOG_EXPORT),
  clearAppLog: () => invoke(IPC.APP_LOG_CLEAR),
  /* Журнал падений игры (ТЗ 11.11.2026): список, «Проверить сейчас», отчёт, «показано», событие о новом падении. */
  listGameCrashes: () => invoke(IPC.GAME_CRASH_LIST),
  scanGameCrashes: () => invoke(IPC.GAME_CRASH_SCAN),
  saveGameCrashReport: (input) => invoke(IPC.GAME_CRASH_REPORT, input),
  markGameCrashesNoticed: (ids) => invoke(IPC.GAME_CRASH_NOTICED, { ids }),
  onGameCrash: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.GAME_CRASH_EVENT, wrapped);
    return () => ipcRenderer.removeListener(IPC.GAME_CRASH_EVENT, wrapped);
  },
  getAppInfo: () => invoke(IPC.APP_INFO),
  getRageMpStatus: () => invoke(IPC.RAGE_MP_STATUS),
  /* «Где играю» (настройки → GTA V): выбор GTA 5 RP / Majestic / только сюжет и режим RP (`rp-place.js`). */
  getRpPlace: () => invoke(IPC.RP_PLACE_STATE),
  setRpPlace: (place) => invoke(IPC.RP_PLACE_SET, { place: String(place) }),
  getAppPreferences: () => invoke(IPC.APP_PREFERENCES),
  setAppPreferences: (input) =>
    invoke(IPC.APP_PREFERENCES_SET, {
      ...(typeof input?.openAtLogin === "boolean"
        ? { openAtLogin: input.openAtLogin }
        : {}),
      ...(typeof input?.closeToTray === "boolean"
        ? { closeToTray: input.closeToTray }
        : {}),
      ...(typeof input?.powerfulGpu === "boolean"
        ? { powerfulGpu: input.powerfulGpu }
        : {}),
      ...(typeof input?.askBeforeClose === "boolean"
        ? { askBeforeClose: input.askBeforeClose }
        : {}),
    }),
  /* Вопрос при закрытии окна, пока идёт скачивание (макет В1, 16.11.2026): просьба главного процесса, «показано» и выбор человека. */
  onCloseAsk: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.APP_CLOSE_ASK, wrapped);
    return () => ipcRenderer.removeListener(IPC.APP_CLOSE_ASK, wrapped);
  },
  closeAskShown: (id) => invoke(IPC.APP_CLOSE_SHOWN, { id }),
  answerCloseAsk: (answer) =>
    invoke(IPC.APP_CLOSE_ANSWER, {
      id: answer?.id,
      action: answer?.action,
      dontAsk: answer?.dontAsk === true,
    }),
  convertModel: (input) => invoke(IPC.NATIVE_CONVERT_MODEL, input),
  readModelArs2: (input) => invoke(IPC.NATIVE_READ_MODEL_ARS2, input),
  extractTextures: (input) => invoke(IPC.NATIVE_EXTRACT_TEXTURES, input),
  renameTexture: (input) => invoke(IPC.NATIVE_RENAME_TEXTURE, input),
  validateRpfPatch: (input) => invoke(IPC.NATIVE_VALIDATE_RPF_PATCH, input),
  installRpfPatch: (input) => invoke(IPC.NATIVE_INSTALL_RPF_PATCH, input),
  restoreRpfPoint: (input) => invoke(IPC.NATIVE_RESTORE_RPF_POINT, input),
  planReticle: (input) => invoke(IPC.WORKSHOP_PLAN_RETICLE, input),
  applyReticle: (input) => invoke(IPC.WORKSHOP_APPLY_RETICLE, input),
  planMinimap: (input) => invoke(IPC.WORKSHOP_PLAN_MINIMAP, input),
  applyMinimap: (input) => invoke(IPC.WORKSHOP_APPLY_MINIMAP, input),
  checkMinimapFilm: (input) => invoke(IPC.WORKSHOP_CHECK_MINIMAP_FILM, input),
  applyMinimapFilmRepair: (input) => invoke(IPC.WORKSHOP_APPLY_MINIMAP_FILM_REPAIR, input),
  reportMinimapFilm: (input) => invoke(IPC.WORKSHOP_REPORT_MINIMAP_FILM, input),
  getInteriorCapabilities: (input) =>
    invoke(IPC.WORKSHOP_INTERIOR_CAPABILITIES, input),
  planInterior: (input) => invoke(IPC.WORKSHOP_PLAN_INTERIOR, input),
  applyInterior: (input) => invoke(IPC.WORKSHOP_APPLY_INTERIOR, input),
  removeInterior: (input) => invoke(IPC.WORKSHOP_REMOVE_INTERIOR, input),
  chooseSoundPack: (input) => invoke(IPC.WORKSHOP_CHOOSE_SOUND_PACK, input),
  listSoundPacks: (input) => invoke(IPC.WORKSHOP_SOUND_PACKS_INSTALLED, input),
  planSoundPack: (input) => invoke(IPC.WORKSHOP_PLAN_SOUND_PACK, input),
  applySoundPack: (input) => invoke(IPC.WORKSHOP_APPLY_SOUND_PACK, input),
  removeSoundPack: (input) => invoke(IPC.WORKSHOP_REMOVE_SOUND_PACK, input),
  planClimbs: (input) => invoke(IPC.WORKSHOP_PLAN_CLIMBS, input),
  applyClimbs: (input) => invoke(IPC.WORKSHOP_APPLY_CLIMBS, input),
  removeClimbs: (input) => invoke(IPC.WORKSHOP_REMOVE_CLIMBS, input),
  applyWeaponSkin: (input) => invoke(IPC.WORKSHOP_APPLY_WEAPON_SKIN, input),
  removeWeaponSkin: (input) => invoke(IPC.WORKSHOP_REMOVE_WEAPON_SKIN, input),
  applyClothingSkin: (input) => invoke(IPC.WORKSHOP_APPLY_CLOTHING_SKIN, input),
  removeClothingSkin: (input) =>
    invoke(IPC.WORKSHOP_REMOVE_CLOTHING_SKIN, input),
  applyClothingReplacement: (input) =>
    invoke(IPC.CLOTHING_REPLACE_APPLY, input),
  readGameWeaponModel: (input) => invoke(IPC.WORKSHOP_GAME_WEAPON_MODEL, input),
  readWeaponInHands: (input) =>
    invoke(IPC.WORKSHOP_GAME_WEAPON_IN_HANDS, input),
  readStandingBody: (input) => invoke(IPC.WORKSHOP_GAME_STANDING_BODY, input),
  readCombatDecals: (input) => invoke(IPC.WORKSHOP_GAME_COMBAT_DECALS, input),
  /* «Анимации» (ТЗ 29.10.2026-d): клипы игры и свои файлы, только чтение. */
  listAnimations: (input) => invoke(IPC.ANIMATIONS_LIST, input),
  readAnimationRig: (input) => invoke(IPC.ANIMATIONS_RIG, input),
  readAnimationTrack: (input) => invoke(IPC.ANIMATIONS_TRACK, input),
  readAnimationPoses: (input) => invoke(IPC.ANIMATIONS_POSES, input),
  chooseAnimationSource: (input) => invoke(IPC.ANIMATIONS_CHOOSE_SOURCE, input),
  addAnimationSource: (input) => invoke(IPC.ANIMATIONS_ADD_SOURCE, input),
  removeAnimationSource: (input) => invoke(IPC.ANIMATIONS_REMOVE_SOURCE, input),
  planAnimationInstall: (input) => invoke(IPC.ANIMATIONS_PLAN_INSTALL, input),
  applyAnimationInstall: (input) => invoke(IPC.ANIMATIONS_APPLY_INSTALL, input),
  removeAnimationInstall: (input) => invoke(IPC.ANIMATIONS_REMOVE_INSTALL, input),
  listInstalledAnimations: (input) => invoke(IPC.ANIMATIONS_INSTALLED, input),
  verifyWeaponSkin: (input) => invoke(IPC.WORKSHOP_VERIFY_WEAPON_SKIN, input),
  workshopGameRunning: () => invoke(IPC.WORKSHOP_GAME_RUNNING),
  listGameClothing: (input) => invoke(IPC.WORKSHOP_GAME_CLOTHING_LIST, input),
  listServerClothing: () => invoke(IPC.CLOTHING_SERVER_LIST),
  listGameClothingItems: () => invoke(IPC.CLOTHING_GAME_ITEMS),
  readServerTattooModel: (input) =>
    invoke(IPC.CLOTHING_SERVER_TATTOO_MODEL, input),
  applyServerTattoo: (input) => invoke(IPC.WORKSHOP_APPLY_SERVER_TATTOO, input),
  readMajesticWiki: (input) => invoke(IPC.CLOTHING_MAJESTIC_WIKI, input),
  readProjectClothing: (input) => invoke(IPC.CLOTHING_PROJECT_ITEMS, input),
  readProjectPicture: (input) => invoke(IPC.CLOTHING_PROJECT_PICTURE, input),
  readGameClothingModel: (input) =>
    invoke(IPC.WORKSHOP_GAME_CLOTHING_MODEL, input),
  readCatalogClothingModel: (input) =>
    invoke(IPC.WORKSHOP_CATALOG_CLOTHING_MODEL, input),
  /* «Посмотреть на персонаже»: персонаж из игры в этой вещи (GLB). */
  readClothingCharacter: (input) =>
    invoke(IPC.WORKSHOP_CLOTHING_CHARACTER, input),
  /* Тату игры (задача 10): что можно заменить, картинка и «Применить». */
  listGameTattoos: (input) => invoke(IPC.CLOTHING_GAME_TATTOOS, input),
  readGameTattooPicture: (input) =>
    invoke(IPC.CLOTHING_GAME_TATTOO_PICTURE, input),
  /* «Бороды игры» (Ц3в): штатные бороды игрока и лист бороды для плитки. */
  listGameBeards: (input) => invoke(IPC.CLOTHING_GAME_BEARDS, input),
  readGameBeardPicture: (input) =>
    invoke(IPC.CLOTHING_GAME_BEARD_PICTURE, input),
  bakeGameBeard: (input) => invoke(IPC.CLOTHING_GAME_BEARD_BAKE, input),
  applyGameBeard: (input) => invoke(IPC.WORKSHOP_APPLY_GAME_BEARD, input),
  readCatalogTattooPictures: (input) =>
    invoke(IPC.CLOTHING_CATALOG_TATTOO_PICTURES, input),
  /* Файлы части редукса — «Редактировать» в мастерской (11.10). */
  readCatalogPartFiles: (input) => invoke(IPC.CATALOG_PART_FILES, input),
  /* Геометрия большой карты части — редактор карты (11.10). */
  readCatalogPartGeometry: (input) =>
    invoke(IPC.CATALOG_PART_GEOMETRY, input),
  applyTattooPaint: (input) => invoke(IPC.WORKSHOP_APPLY_TATTOO_PAINT, input),
  readWorldMapTiles: (input) => invoke(IPC.WORKSHOP_MAP_TILES, input),
  readWorldMapGeometry: (input) => invoke(IPC.WORKSHOP_MAP_GEOMETRY, input),
  readRadarTileColours: (input) =>
    invoke(IPC.WORKSHOP_MAP_RADAR_COLOURS, input),
  readWorldMapIsland: (input) => invoke(IPC.WORKSHOP_MAP_ISLAND, input),
  worldMapStockStatus: (input) => invoke(IPC.WORKSHOP_MAP_STOCK_STATUS, input),
  restoreStockWorldMap: (input) =>
    invoke(IPC.WORKSHOP_MAP_RESTORE_STOCK, input),
  beginWorldMapExport: (input) => invoke(IPC.WORKSHOP_MAP_BEGIN, input),
  stageWorldMapTile: (input) => invoke(IPC.WORKSHOP_MAP_STAGE, input),
  endWorldMapExport: (input) => invoke(IPC.WORKSHOP_MAP_END, input),
  planWorldMap: (input) => invoke(IPC.WORKSHOP_PLAN_MAP, input),
  applyWorldMap: (input) => invoke(IPC.WORKSHOP_APPLY_MAP, input),
  removeWorldMap: (input) => invoke(IPC.WORKSHOP_REMOVE_MAP, input),
  listSoundBanks: (input) => invoke(IPC.WORKSHOP_SOUND_BANKS, input),
  readSoundStream: (input) => invoke(IPC.WORKSHOP_SOUND_STREAM, input),
  readWeaponShot: (input) => invoke(IPC.WORKSHOP_SOUND_SHOT, input),
  readSoundBank: (input) => invoke(IPC.WORKSHOP_SOUND_BANK, input),
  readSoundProfile: (input) => invoke(IPC.WORKSHOP_SOUND_PROFILE, input),
  beginSoundSession: (input) => invoke(IPC.WORKSHOP_SOUND_BEGIN, input),
  stageSoundWav: (input) => invoke(IPC.WORKSHOP_SOUND_STAGE, input),
  endSoundSession: (input) => invoke(IPC.WORKSHOP_SOUND_END, input),
  planSound: (input) => invoke(IPC.WORKSHOP_SOUND_PLAN, input),
  applySound: (input) => invoke(IPC.WORKSHOP_SOUND_APPLY, input),
  removeSound: (input) => invoke(IPC.WORKSHOP_SOUND_REMOVE, input),
  listSoundWorks: (input) => invoke(IPC.WORKSHOP_SOUND_WORKS, input),
  readHitSoundBudget: (input) => invoke(IPC.WORKSHOP_SOUND_HITS_BUDGET, input),
  planHitSounds: (input) => invoke(IPC.WORKSHOP_SOUND_HITS_PLAN, input),
  applyHitSounds: (input) => invoke(IPC.WORKSHOP_SOUND_HITS_APPLY, input),
  planWeaponSound: (input) => invoke(IPC.WORKSHOP_SOUND_WEAPON_PLAN, input),
  applyWeaponSound: (input) => invoke(IPC.WORKSHOP_SOUND_WEAPON_APPLY, input),
  planSoundMix: (input) => invoke(IPC.WORKSHOP_SOUND_MIX_PLAN, input),
  applySoundMix: (input) => invoke(IPC.WORKSHOP_SOUND_MIX_APPLY, input),
  readSkyBases: (input) => invoke(IPC.WORKSHOP_READ_TIMECYCLE, input),
  readSkyTextures: (input) => invoke(IPC.WORKSHOP_SKY_TEXTURES, input),
  readCloudHats: (input) => invoke(IPC.WORKSHOP_CLOUD_HATS, input),
  readCloudHatTexture: (input) => invoke(IPC.WORKSHOP_CLOUD_HAT_TEXTURE, input),
  setSkyRainbow: (input) => invoke(IPC.WORKSHOP_SKY_RAINBOW, input),
  inspectSkyRainbow: (input) => invoke(IPC.WORKSHOP_SKY_RAINBOW_STATUS, input),
  listSkySources: (input) => invoke(IPC.WORKSHOP_SKY_SOURCES, input),
  takeSkySource: (input) => invoke(IPC.WORKSHOP_SKY_SOURCE, input),
  readProjectInteriorsState: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_STATE, input),
  addProjectInteriorsSource: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_ADD_SOURCE, input),
  removeProjectInteriorsSource: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_REMOVE_SOURCE, input),
  readProjectInteriorsCatalog: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_CATALOG, input),
  readProjectInteriorsScene: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_SCENE, input),
  readProjectInteriorsSheets: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_SHEETS, input),
  readProjectInteriorsCdnState: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_STATE, input),
  fetchProjectInteriorsPack: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_FETCH, input),
  cancelProjectInteriorsPack: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_CANCEL, input),
  removeProjectInteriorsPack: (input) => invoke(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_REMOVE, input),
  loadSelectionMarkup: (input) => invoke(IPC.WORKSHOP_SELECTION_MARKUP, input),
  planTimecycle: (input) => invoke(IPC.WORKSHOP_PLAN_TIMECYCLE, input),
  applyTimecycle: (input) => invoke(IPC.WORKSHOP_APPLY_TIMECYCLE, input),
  readLampStudio: (input) => invoke(IPC.WORKSHOP_READ_LAMPS, input),
  planLampStudio: (input) => invoke(IPC.WORKSHOP_PLAN_LAMPS, input),
  applyLampStudio: (input) => invoke(IPC.WORKSHOP_APPLY_LAMPS, input),
  planWallbang: (input) => invoke(IPC.WORKSHOP_PLAN_WALLBANG, input),
  applyWallbang: (input) => invoke(IPC.WORKSHOP_APPLY_WALLBANG, input),
  listAnimals: (input) => invoke(IPC.ANIMALS_LIST, input),
  readAnimal: (input) => invoke(IPC.ANIMALS_READ, input),
  planAnimals: (input) => invoke(IPC.WORKSHOP_PLAN_ANIMALS, input),
  applyAnimals: (input) => invoke(IPC.WORKSHOP_APPLY_ANIMALS, input),
  /* Наборы перекраски: план — один канал, «Применить» — канал набора. */
  planRecolor: (input) => invoke(IPC.WORKSHOP_PLAN_RECOLOR, input),
  cancelRecolorPlan: (input) => invoke(IPC.WORKSHOP_CANCEL_RECOLOR_PLAN, input),
  readWorkshopTextures: (input) => invoke(IPC.WORKSHOP_TEXTURES, input),
  /* «Интерьеры»: сцена 3D-кадра помещения из игры игрока (задача 5 ТЗ 11.10.2026). */
  readShopScene: (input) => invoke(IPC.WORKSHOP_SHOP_SCENE, input),
  readWorldPlaceScene: (input) => invoke(IPC.WORKSHOP_WORLD_PLACE_SCENE, input),
  /* Предпросмотр «Шрифтов»: шаблоны Windows и штатная библиотека игрока. */
  readFontSources: (input) => invoke(IPC.WORKSHOP_FONT_SOURCES, input),
  applyRecolor: (input) => {
    const channel = {
      zones: IPC.WORKSHOP_APPLY_ZONES,
      factory: IPC.WORKSHOP_APPLY_FACTORY,
      hangar: IPC.WORKSHOP_APPLY_HANGAR,
      mapping: IPC.WORKSHOP_APPLY_MAPPING,
      arenas: IPC.WORKSHOP_APPLY_ARENAS,
      water: IPC.WORKSHOP_APPLY_WATER,
      vegetation: IPC.WORKSHOP_APPLY_VEGETATION,
      fonts: IPC.WORKSHOP_APPLY_FONTS,
      megamall: IPC.WORKSHOP_APPLY_MEGAMALL,
      youtool: IPC.WORKSHOP_APPLY_YOUTOOL,
      vinewood: IPC.WORKSHOP_APPLY_VINEWOOD,
      busstops: IPC.WORKSHOP_APPLY_BUSSTOPS,
      mslzones: IPC.WORKSHOP_APPLY_MSLZONES,
      floatlogo: IPC.WORKSHOP_APPLY_FLOATLOGO,
      /* «Дирижабли» (ТЗ 11.10.2026). */
      airships: IPC.WORKSHOP_APPLY_AIRSHIPS,
      shops: IPC.WORKSHOP_APPLY_SHOPS,
      billboards: IPC.WORKSHOP_APPLY_BILLBOARDS,
      captzones: IPC.WORKSHOP_APPLY_CAPTZONES,
      schedule: IPC.WORKSHOP_APPLY_SCHEDULE,
      /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
      flags: IPC.WORKSHOP_APPLY_FLAGS,
      /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
      atms: IPC.WORKSHOP_APPLY_ATMS,
      /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
      projectinteriors: IPC.WORKSHOP_APPLY_PROJECTINTERIORS,
      /* «Интерьеры Majestic RP» (Хелпер 7, 25.10.2026). */
      majesticinteriors: IPC.WORKSHOP_APPLY_MAJESTICINTERIORS,
      roads: IPC.WORKSHOP_APPLY_ROADS,
    }[input?.set];
    if (!channel)
      return Promise.reject(new Error("Неизвестный набор перекраски."));
    return invoke(channel, input);
  },
  /* Слои оптимизации: трава, мусор, полки, частицы, следы, таймцикл. */
  planOptimizationLayer: (input) =>
    invoke(IPC.WORKSHOP_PLAN_OPTIMIZATION_LAYER, input),
  applyOptimizationLayer: (input) =>
    invoke(IPC.WORKSHOP_APPLY_OPTIMIZATION_LAYER, input),
  planWater: (input) => invoke(IPC.WORKSHOP_PLAN_WATER, input),
  applyWater: (input) => invoke(IPC.WORKSHOP_APPLY_WATER, input),
  planVegetation: (input) => invoke(IPC.WORKSHOP_PLAN_VEGETATION, input),
  applyVegetation: (input) => invoke(IPC.WORKSHOP_APPLY_VEGETATION, input),
  getWorkshopTools: () => invoke(IPC.WORKSHOP_TOOLS_STATUS),
  provisionWorkshopTools: () => invoke(IPC.WORKSHOP_TOOLS_PROVISION),
  revealWorkshopTools: () => invoke(IPC.WORKSHOP_TOOLS_REVEAL),
  loadArenaHallManifest: (input) =>
    invoke(IPC.WORKSHOP_ARENA_HALL_MANIFEST, input),
  loadArenaHallPiece: (input) => invoke(IPC.WORKSHOP_ARENA_HALL_PIECE, input),
  readArenaModHall: (input) => invoke(IPC.WORKSHOP_ARENA_MOD_HALL, input),
  chooseArenaHallFolder: () => invoke(IPC.WORKSHOP_CHOOSE_ARENA_HALL_FOLDER),
  chooseArenaSource: () => invoke(IPC.WORKSHOP_CHOOSE_ARENA_SOURCE),
  inspectArenaSource: (input) =>
    invoke(IPC.WORKSHOP_INSPECT_ARENA_SOURCE, input),
  planArena: (input) => invoke(IPC.WORKSHOP_PLAN_ARENA, input),
  applyArena: (input) => invoke(IPC.WORKSHOP_APPLY_ARENA, input),
  removeArena: (input) => invoke(IPC.WORKSHOP_REMOVE_ARENA, input),
  planOptimizer: (input) => invoke(IPC.WORKSHOP_PLAN_OPTIMIZER, input),
  chooseReduxArchive: () => invoke(IPC.PUBLISHER_CHOOSE_REDUX),
  chooseReduxCleanBase: () => invoke(IPC.PUBLISHER_CHOOSE_CLEAN_BASE),
  inspectReduxArchive: (input) => invoke(IPC.PUBLISHER_INSPECT_REDUX, input),
  buildReduxPackages: (input) =>
    invoke(IPC.PUBLISHER_BUILD_REDUX_PACKAGES, input),
  openReduxBatch: (input) => invoke(IPC.PUBLISHER_OPEN_BATCH, input),
  listReduxBaselines: () => invoke(IPC.PUBLISHER_REDUX_BASELINES),
  forgetReduxBaseline: (input) =>
    invoke(IPC.PUBLISHER_FORGET_REDUX_BASELINE, input),
  /* Публикация из архива: выбрать источники, разобрать, подготовить
     черновики во входящих, отметить опубликованное. */
  choosePublisherSources: () => invoke(IPC.PUBLISHER_CHOOSE_SOURCES),
  choosePublisherSourceFolder: () => invoke(IPC.PUBLISHER_CHOOSE_SOURCE_FOLDER),
  inspectPublisherSources: (input) =>
    invoke(IPC.PUBLISHER_INSPECT_SOURCES, input),
  preparePublisherDrafts: (input) =>
    invoke(IPC.PUBLISHER_PREPARE_DRAFTS, input),
  listPublisherInbox: () => invoke(IPC.PUBLISHER_LIST_INBOX),
  publisherInboxThumbnails: (input) =>
    invoke(IPC.PUBLISHER_INBOX_THUMBNAILS, input),
  markPublisherDraftPublished: (input) =>
    invoke(IPC.PUBLISHER_MARK_PUBLISHED, input),
  discardPublisherDraft: (input) => invoke(IPC.PUBLISHER_DISCARD_DRAFT, input),
  /* Кадры заявок: снимок области окна (плеер обзора), кадр в заявку,
     порядок и обложка галереи, обзор и авторы партии. */
  capturePublisherRegion: (input) =>
    invoke(IPC.PUBLISHER_CAPTURE_REGION, input),
  savePublisherDraftFrame: (input) =>
    invoke(IPC.PUBLISHER_SAVE_DRAFT_FRAME, input),
  updatePublisherDraftMedia: (input) =>
    invoke(IPC.PUBLISHER_UPDATE_DRAFT_MEDIA, input),
  setPublisherBatchSources: (input) =>
    invoke(IPC.PUBLISHER_SET_BATCH_SOURCES, input),
  readPublisherDraftAudio: (input) =>
    invoke(IPC.PUBLISHER_READ_DRAFT_AUDIO, input),
  /* Файлы части заявки — обложка «Мастерская» в «Кадрах из обзора». */
  readPublisherDraftPartFiles: (input) =>
    invoke(IPC.PUBLISHER_READ_DRAFT_PART_FILES, input),
  sendWorkToInbox: (input) => invoke(IPC.PUBLISHER_WORK_TO_INBOX, input),
  /* Задание на разбор — на этой машине; ход — событиями. */
  runPublisherIntakeJob: (input) => invoke(IPC.PUBLISHER_RUN_INTAKE_JOB, input),
  onPublisherIntakeProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.PUBLISHER_INTAKE_PROGRESS, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC.PUBLISHER_INTAKE_PROGRESS, wrapped);
  },
  /* Перетащенный в окно файл — это путь на диске, и знает его только
     предзагрузчик: у рендерера доступа к путям нет. */
  pathsForFiles: (files) =>
    Array.from(files || [])
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  applyOptimizer: (input) => invoke(IPC.WORKSHOP_APPLY_OPTIMIZER, input),
  rollbackOptimizer: (input) => invoke(IPC.WORKSHOP_ROLLBACK_OPTIMIZER, input),
  getStreetLightCapabilities: () =>
    invoke(IPC.WORKSHOP_STREET_LIGHT_CAPABILITIES),
  planStreetLights: (input) => invoke(IPC.WORKSHOP_PLAN_STREET_LIGHTS, input),
  applyStreetLights: (input) => invoke(IPC.WORKSHOP_APPLY_STREET_LIGHTS, input),
  disableStreetLights: (input) =>
    invoke(IPC.WORKSHOP_DISABLE_STREET_LIGHTS, input),
  removeStreetLights: (input) =>
    invoke(IPC.WORKSHOP_REMOVE_STREET_LIGHTS, input),
  readPtfxBase: (input) => invoke(IPC.WORKSHOP_READ_PTFX, input),
  planPtfx: (input) => invoke(IPC.WORKSHOP_PLAN_PTFX, input),
  applyPtfx: (input) => invoke(IPC.WORKSHOP_APPLY_PTFX, input),
  readKillEffectState: (input) => invoke(IPC.WORKSHOP_READ_KILL_EFFECT, input),
  planKillEffect: (input) => invoke(IPC.WORKSHOP_PLAN_KILL_EFFECT, input),
  applyKillEffect: (input) => invoke(IPC.WORKSHOP_APPLY_KILL_EFFECT, input),
  readScreenHits: (input) => invoke(IPC.WORKSHOP_READ_SCREEN_HITS, input),
  planScreenHits: (input) => invoke(IPC.WORKSHOP_PLAN_SCREEN_HITS, input),
  applyScreenHits: (input) => invoke(IPC.WORKSHOP_APPLY_SCREEN_HITS, input),
  readGps: (input) => invoke(IPC.WORKSHOP_READ_GPS, input),
  readGpsGraph: (input) => invoke(IPC.WORKSHOP_READ_GPS_GRAPH, input),
  planGps: (input) => invoke(IPC.WORKSHOP_PLAN_GPS, input),
  applyGps: (input) => invoke(IPC.WORKSHOP_APPLY_GPS, input),
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  planTargetHp: (input) => invoke(IPC.WORKSHOP_PLAN_TARGET_HP, input),
  applyTargetHp: (input) => invoke(IPC.WORKSHOP_APPLY_TARGET_HP, input),
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  readGroupMarkers: (input) => invoke(IPC.WORKSHOP_READ_GROUP_MARKERS, input),
  planGroupMarkers: (input) => invoke(IPC.WORKSHOP_PLAN_GROUP_MARKERS, input),
  applyGroupMarkers: (input) => invoke(IPC.WORKSHOP_APPLY_GROUP_MARKERS, input),
  /* «Иконки» большой карты (05.11.2026). */
  readBlipIcons: (input) => invoke(IPC.WORKSHOP_READ_BLIP_ICONS, input),
  planBlipIcons: (input) => invoke(IPC.WORKSHOP_PLAN_BLIP_ICONS, input),
  applyBlipIcons: (input) => invoke(IPC.WORKSHOP_APPLY_BLIP_ICONS, input),
  /* «Дым из-под колёс» (задача 1 ТЗ 11.10.2026, вечер). */
  readWheelSmoke: (input) => invoke(IPC.WORKSHOP_READ_WHEEL_SMOKE, input),
  readWheelSmokeCar: (input) => invoke(IPC.WORKSHOP_READ_WHEEL_SMOKE_CAR, input),
  planWheelSmoke: (input) => invoke(IPC.WORKSHOP_PLAN_WHEEL_SMOKE, input),
  applyWheelSmoke: (input) => invoke(IPC.WORKSHOP_APPLY_WHEEL_SMOKE, input),
  readReshade: (input) => invoke(IPC.RESHADE_READ, input),
  applyReshade: (input) => invoke(IPC.RESHADE_APPLY, input),
  removeReshade: (input) => invoke(IPC.RESHADE_REMOVE, input),
  /* «Сбросить GTA до стандартной» (`stock-reset/stock-reset-ipc.js`). */
  scanStockGame: (input) => invoke(IPC.STOCK_RESET_SCAN, input),
  stockScanProgress: (input) => invoke(IPC.STOCK_RESET_PROGRESS, input),
  applyStockReset: (input) => invoke(IPC.STOCK_RESET_APPLY, input),
  openStockVerify: (input) => invoke(IPC.STOCK_RESET_VERIFY, input),
  listStockQuarantine: (input) => invoke(IPC.STOCK_QUARANTINE_LIST, input),
  restoreStockQuarantine: (input) => invoke(IPC.STOCK_QUARANTINE_RESTORE, input),
  readWeaponIcons: (input) => invoke(IPC.WORKSHOP_READ_WEAPON_ICONS, input),
  listGunpacks: () => invoke(IPC.WORKSHOP_LIST_GUNPACKS),
  chooseGunpack: () => invoke(IPC.WORKSHOP_CHOOSE_GUNPACK),
  importGunpack: (input) => invoke(IPC.WORKSHOP_IMPORT_GUNPACK, input),
  readGunpackModel: (input) => invoke(IPC.WORKSHOP_GUNPACK_MODEL, input),
  gunpackStudio: {
    list: () => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_LIST),
    choose: () => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_CHOOSE),
    open: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_OPEN, input),
    read: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_READ, input),
    saveShot: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_SAVE_SHOT, input),
    shots: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_SHOTS, input),
    setLook: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_SET_LOOK, input),
    remove: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_REMOVE, input),
    compose: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_COMPOSE, input),
    toInbox: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_TO_INBOX, input),
    model: (input) => invoke(IPC.WORKSHOP_GUNPACK_STUDIO_MODEL, input),
    fromCatalog: (input) =>
      invoke(IPC.WORKSHOP_GUNPACK_STUDIO_FROM_CATALOG, input),
    install: (input) => invoke(IPC.WORKSHOP_APPLY_GUNPACK, input),
    uninstall: (input) => invoke(IPC.WORKSHOP_REMOVE_GUNPACK, input),
    uninstallModel: (input) => invoke(IPC.WORKSHOP_REMOVE_GUNPACK_MODEL, input),
    installSkin: (input) => invoke(IPC.WORKSHOP_APPLY_PACK_SKIN, input),
    uninstallSkin: (input) => invoke(IPC.WORKSHOP_REMOVE_PACK_SKIN, input),
  },
  getMegaMallCapabilities: () => invoke(IPC.WORKSHOP_MEGA_MALL_CAPABILITIES),
  importMegaMallSource: (input) =>
    invoke(IPC.WORKSHOP_IMPORT_MEGA_MALL_SOURCE, input),
  listMegaMallSources: (input) =>
    invoke(IPC.WORKSHOP_LIST_MEGA_MALL_SOURCES, input),
  releaseMegaMallSource: (input) =>
    invoke(IPC.WORKSHOP_RELEASE_MEGA_MALL_SOURCE, input),
  exportMegaMallProject: (input) =>
    invoke(IPC.WORKSHOP_EXPORT_MEGA_MALL_PROJECT, input),
  importMegaMallProject: (input) =>
    invoke(IPC.WORKSHOP_IMPORT_MEGA_MALL_PROJECT, input),
  loadMegaMallBuildingModel: (input) =>
    invoke(IPC.WORKSHOP_MEGA_MALL_BUILDING_MODEL, input),
  loadMegaMallBuildingModels: (input) =>
    invoke(IPC.WORKSHOP_MEGA_MALL_BUILDING_MODELS, input),
  loadMegaMallSection: (input) => invoke(IPC.WORKSHOP_MEGA_MALL_SECTION, input),
  loadMegaMallSectionBundle: (input) =>
    invoke(IPC.WORKSHOP_MEGA_MALL_SECTION_BUNDLE, input),
  renderMegaMallPreview: (input) =>
    invoke(IPC.WORKSHOP_RENDER_MEGA_MALL_PREVIEW, input),
  planMegaMall: (input) => invoke(IPC.WORKSHOP_PLAN_MEGA_MALL, input),
  applyMegaMall: (input) => invoke(IPC.WORKSHOP_APPLY_MEGA_MALL, input),
  removeMegaMall: (input) => invoke(IPC.WORKSHOP_REMOVE_MEGA_MALL, input),
  setTitlebarTheme: (theme) => send(IPC.SET_TITLEBAR_THEME, theme),
  detectGames: () => invoke(IPC.DETECT_GAMES),
  chooseGame: () => invoke(IPC.CHOOSE_GAME),
  prepareGame: (input) => invoke(IPC.PREPARE_GAME, input),
  getInstallProfile: () => invoke(IPC.INSTALL_PROFILE),
  getStartupRecovery: () => invoke(IPC.STARTUP_RECOVERY),
  /* Страж регистрации DLC одежды: итог, который окно ещё не видело, и событие о новом итоге. */
  takeClothingRegistration: () => invoke(IPC.CLOTHING_REGISTRATION_TAKE),
  onClothingRegistration: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.CLOTHING_REGISTRATION_EVENT, wrapped);
    return () => ipcRenderer.removeListener(IPC.CLOTHING_REGISTRATION_EVENT, wrapped);
  },
  getLibraryStatus: (input) => invoke(IPC.LIBRARY_STATUS, input),
  planLibraryRemoval: (input) => invoke(IPC.LIBRARY_PLAN_REMOVAL, input),
  removeFromLibrary: (input) => invoke(IPC.LIBRARY_REMOVE, input),
  retirePreviousInstalls: (input) => invoke(IPC.LIBRARY_RETIRE, input),
  reinstallAfterRestore: (input) => invoke(IPC.LIBRARY_REINSTALL, input),
  /* «Что стоит в игре» (Т-170). */
  installed: {
    list: (input) => invoke(IPC.INSTALLED_LIST, input),
    plan: (input) => invoke(IPC.INSTALLED_PLAN, input),
    uninstall: (input) => invoke(IPC.INSTALLED_UNINSTALL, input),
    guard: (input) => invoke(IPC.INSTALLED_GUARD, input),
    hung: () => invoke(IPC.INSTALLED_HUNG),
    closeHung: (input) => invoke(IPC.INSTALLED_CLOSE_HUNG, input),
  },
  choosePackage: () => invoke(IPC.CHOOSE_PACKAGE),
  planPackage: (input) => invoke(IPC.PLAN_PACKAGE, input),
  installPackage: (input) => invoke(IPC.INSTALL_PACKAGE, input),
  installRemotePackage: (input) => invoke(IPC.INSTALL_REMOTE_PACKAGE, input),
  installRemotePackages: (input) => invoke(IPC.INSTALL_REMOTE_PACKAGES, input),
  prefetchPackage: (input) => invoke(IPC.PREFETCH_PACKAGE, input),
  cancelOperation: (operationId) => invoke(IPC.CANCEL_OPERATION, operationId),
  setDownloadsAccelerated: (input) =>
    invoke(IPC.SET_DOWNLOADS_ACCELERATED, input),
  /* Ход плана перекраски (растительность, дороги): номер работы и шаг сборки. */
  onPlanProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.WORKSHOP_PLAN_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IPC.WORKSHOP_PLAN_PROGRESS, wrapped);
  },
  onInstallProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.INSTALL_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IPC.INSTALL_PROGRESS, wrapped);
  },
  chooseWorkshopResourceRoot: () => invoke(IPC.WORKSHOP_CHOOSE_RESOURCE_ROOT),
  planWorkshopResource: (input) => invoke(IPC.WORKSHOP_PLAN_RESOURCE, input),
  applyWorkshopResource: (input) => invoke(IPC.WORKSHOP_APPLY_RESOURCE, input),
  rollbackWorkshopResource: (input) =>
    invoke(IPC.WORKSHOP_ROLLBACK_RESOURCE, input),
  openWorkshopPath: (input) => invoke(IPC.WORKSHOP_OPEN_PATH, input),
  openWorkshopProjectFolder: (input) =>
    invoke(IPC.WORKSHOP_OPEN_PROJECT_FOLDER, input),
  onWorkshopProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.WORKSHOP_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IPC.WORKSHOP_PROGRESS, wrapped);
  },
  onWorkshopInstallProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.WORKSHOP_INSTALL_PROGRESS, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC.WORKSHOP_INSTALL_PROGRESS, wrapped);
  },
  uninstallPackage: (input) => invoke(IPC.UNINSTALL_PACKAGE, input),
  reduxLayer: (input) => invoke(IPC.REDUX_LAYER, input),
  resetTarget: (input) => invoke(IPC.RESET_TARGET, input),
  readForeignConflicts: () => invoke(IPC.FOREIGN_CONFLICTS),
  setForeignChoices: (input) => invoke(IPC.SET_FOREIGN_CHOICES, input),
  auditTarget: (input) => invoke(IPC.AUDIT_TARGET, input),
  repairTarget: (input) => invoke(IPC.REPAIR_TARGET, input),
  rpMigrateStatus: (input) => invoke(IPC.RP_MIGRATE_STATUS, input),
  rpMigrateRun: (input) => invoke(IPC.RP_MIGRATE_RUN, input),
  listRestorePoints: (input) => invoke(IPC.LIST_RESTORE_POINTS, input),
  restorePoint: (input) => invoke(IPC.RESTORE_POINT, input),
  getVanillaStatus: (input) => invoke(IPC.VANILLA_STATUS, input),
  launchVanilla: (input) => invoke(IPC.LAUNCH_VANILLA, input),
  launchGame: (input) => invoke(IPC.LAUNCH_GAME, input),
  restoreVanilla: (input) => invoke(IPC.RESTORE_VANILLA, input),
  /* Моды в копию из Rockstar Games Launcher (задача 7). */
  getRockstarDelivery: (input) => invoke(IPC.ROCKSTAR_DELIVERY_STATUS, input),
  setRockstarDelivery: (input) => invoke(IPC.ROCKSTAR_DELIVERY_SET, input),
  chooseRockstarCopyFolder: () => invoke(IPC.ROCKSTAR_COPY_CHOOSE_FOLDER),
  createRockstarCopy: (input) => invoke(IPC.ROCKSTAR_COPY_CREATE, input),
  syncRockstarCopy: (input) => invoke(IPC.ROCKSTAR_COPY_SYNC, input),
  deleteRockstarCopy: (input) => invoke(IPC.ROCKSTAR_COPY_DELETE, input),
  /* Режим Rockstar (05.11.2026). */
  rebuildRockstarMode: (input) => invoke(IPC.ROCKSTAR_MODE_REBUILD, input),
  armRockstarMode: (input) => invoke(IPC.ROCKSTAR_MODE_ARM_NOW, input),
  disarmRockstarMode: (input) => invoke(IPC.ROCKSTAR_MODE_DISARM_NOW, input),
  getRockstarModeLog: (input) => invoke(IPC.ROCKSTAR_MODE_LOG, input),
  onRockstarDelivery: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.ROCKSTAR_DELIVERY_EVENT, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC.ROCKSTAR_DELIVERY_EVENT, wrapped);
  },
  onRockstarCopyProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.ROCKSTAR_COPY_PROGRESS, wrapped);
    return () =>
      ipcRenderer.removeListener(IPC.ROCKSTAR_COPY_PROGRESS, wrapped);
  },
  onVanillaStatus: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.VANILLA_STATUS, wrapped);
    return () => ipcRenderer.removeListener(IPC.VANILLA_STATUS, wrapped);
  },
  copyText: (value) => invoke(IPC.COPY_TEXT, value),
  /* Шрифты компьютера: названия и файл по номеру из списка — путь окну не отдаётся (`system-fonts.js`). */
  listSystemFonts: () => invoke(IPC.SYSTEM_FONTS_LIST),
  readSystemFont: (id) => invoke(IPC.SYSTEM_FONT_READ, String(id)),
  onDeepLink: (listener) => {
    deepLinkListeners.add(listener);
    if (queuedDeepLink) queueMicrotask(() => listener(queuedDeepLink));
    return () => deepLinkListeners.delete(listener);
  },
  applyGameSettings: (input) => invoke(IPC.APPLY_GAME_SETTINGS, input),
  readGameSettings: () => invoke(IPC.READ_GAME_SETTINGS),
  readHardware: () => invoke(IPC.READ_HARDWARE),
  restoreGameSettings: () => invoke(IPC.RESTORE_GAME_SETTINGS),
  readMouseSettings: () => invoke(IPC.READ_MOUSE_SETTINGS),
  applyMouseSettings: (input) => invoke(IPC.APPLY_MOUSE_SETTINGS, input),
  restoreMouseSettings: () => invoke(IPC.RESTORE_MOUSE_SETTINGS),
  analyzeGameSettings: (input) => invoke(IPC.ANALYZE_GAME_SETTINGS, input),
  analyzeOptimization: (input) => invoke(IPC.ANALYZE_OPTIMIZATION, input),
  planOptimization: (input) => invoke(IPC.PLAN_OPTIMIZATION, input),
  applyOptimization: (input) => invoke(IPC.APPLY_OPTIMIZATION, input),
  rollbackOptimization: (input) => invoke(IPC.ROLLBACK_OPTIMIZATION, input),
  getOptimizationHistory: () => invoke(IPC.OPTIMIZATION_HISTORY),
  onOptimizationProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.OPTIMIZATION_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IPC.OPTIMIZATION_PROGRESS, wrapped);
  },
  openExternal: (url) => invoke(IPC.OPEN_EXTERNAL, url),
  openAppsSettings: () => invoke(IPC.OPEN_APPS_SETTINGS),
  getStorageStatus: () => invoke(IPC.STORAGE_STATUS),
  getAppIcon: () => invoke(IPC.APP_ICON_GET),
  /* id готовой раскраски или настройки своего значка `{ star, back, from, to, transparent }`: уходит строкой, цвета проверяет главный процесс. */
  setAppIcon: (value) => invoke(IPC.APP_ICON_SET, typeof value === "string" ? value : JSON.stringify(value ?? null)),
  openCacheDirectory: () => invoke(IPC.OPEN_CACHE_DIRECTORY),
  chooseCacheDirectory: () => invoke(IPC.CHOOSE_CACHE_DIRECTORY),
  resetCacheDirectory: () => invoke(IPC.RESET_CACHE_DIRECTORY),
  setCacheEnabled: (enabled) =>
    invoke(IPC.SET_CACHE_ENABLED, { enabled: Boolean(enabled) }),
  setCacheLimit: (limitBytes) =>
    invoke(IPC.SET_CACHE_LIMIT, { limitBytes: Number(limitBytes) }),
  setFastInstall: (enabled) => invoke(IPC.SET_FAST_INSTALL, { enabled: enabled === true }),
  settleFastInstallOffer: (fast) => invoke(IPC.FAST_INSTALL_OFFER_SETTLE, { fast: fast === true }),
  /* События «Быстрой установки»: { kind: "offer" } — началась первая установка, { kind: "changed", enabled } — режим сменили. */
  onFastInstallEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.FAST_INSTALL_EVENT, wrapped);
    return () => ipcRenderer.removeListener(IPC.FAST_INSTALL_EVENT, wrapped);
  },
  setDownloadLimit: (mbps) => invoke(IPC.SET_DOWNLOAD_LIMIT, { mbps: Number(mbps) }),
  setStorageBudget: (value) => invoke(IPC.SET_STORAGE_BUDGET, { value: value === "auto" ? "auto" : Number(value) }),
  freeStorageKind: (kind) => invoke(IPC.FREE_STORAGE_KIND, { kind: String(kind) }),
  clearCache: () => invoke(IPC.CLEAR_CACHE),
  cancelCacheMove: () => invoke(IPC.CANCEL_CACHE_MOVE),
  onStorageProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC.STORAGE_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IPC.STORAGE_PROGRESS, wrapped);
  },
  /*
   * Внимание к окну: фокус, свёрнутость, блокировка экрана, сон и питание —
   * то, чего страница о себе не знает (`apps/desktop/src/window-attention.js`).
   *
   * Подписка сразу отдаёт текущий снимок, а потом каждое изменение: событие,
   * отправленное до загрузки страницы, никто не услышал, поэтому начальное
   * значение берётся запросом. Если событие успело прийти раньше ответа на
   * запрос, ответ устарел и не отдаётся — иначе старый снимок лёг бы поверх
   * нового.
   */
  /*
   * Автообновление бета-лаунчера (`apps/desktop/src/updates/`). Состояние —
   * снимок `{ phase, channel, current, candidate, progress, error, lastFailure,
   * auto, disabled }`; подписка сразу отдаёт текущий, потом каждое изменение
   * (как у `attention`: событие до загрузки страницы никто не слышит).
   */
  updates: {
    state: () => invoke(IPC.UPDATES_STATE),
    check: () => invoke(IPC.UPDATES_CHECK),
    download: () => invoke(IPC.UPDATES_DOWNLOAD),
    apply: () => invoke(IPC.UPDATES_APPLY),
    cancel: () => invoke(IPC.UPDATES_CANCEL),
    setAuto: (value) => invoke(IPC.UPDATES_SET_AUTO, Boolean(value)),
    ready: () => invoke(IPC.UPDATES_READY),
    dismissFailure: () => invoke(IPC.UPDATES_DISMISS_FAILURE),
    installed: () => invoke(IPC.UPDATES_INSTALLED),
    subscribe: (listener) => {
      let live = true;
      let heard = false;
      const wrapped = (_event, snapshot) => {
        heard = true;
        listener(snapshot);
      };
      ipcRenderer.on(IPC.UPDATES_EVENT, wrapped);
      invoke(IPC.UPDATES_STATE).then(
        (snapshot) => {
          if (live && !heard) listener(snapshot);
        },
        () => {},
      );
      return () => {
        live = false;
        ipcRenderer.removeListener(IPC.UPDATES_EVENT, wrapped);
      };
    },
  },
  /*
   * Ветки Astral на одном ПК (`apps/desktop/src/channels/`,
   * docs/beta/channels-launcher.md). Снимок `{ enabled, ownChannel, branches,
   * denied, switchRequest, dataMode }`; подписка сразу отдаёт текущий, потом
   * каждое изменение (как у `updates`).
   */
  channels: {
    state: () => invoke(IPC.CHANNELS_STATE),
    refresh: () => invoke(IPC.CHANNELS_REFRESH),
    /* Открыть другую ветку: вопрос «закрыть эту и открыть ту?» задаёт главный процесс (снимок `switchRequest`). */
    open: (channel, options) => invoke(IPC.CHANNELS_OPEN, { channel: String(channel), confirm: options?.confirm !== false }),
    answer: (id, accepted) => invoke(IPC.CHANNELS_ANSWER, { id: String(id), accepted: Boolean(accepted) }),
    install: (channel) => invoke(IPC.CHANNELS_INSTALL, String(channel)),
    subscribe: (listener) => {
      let live = true;
      let heard = false;
      const wrapped = (_event, snapshot) => {
        heard = true;
        listener(snapshot);
      };
      ipcRenderer.on(IPC.CHANNELS_EVENT, wrapped);
      invoke(IPC.CHANNELS_STATE).then(
        (snapshot) => {
          if (live && !heard) listener(snapshot);
        },
        () => {},
      );
      return () => {
        live = false;
        ipcRenderer.removeListener(IPC.CHANNELS_EVENT, wrapped);
      };
    },
  },
  /*
   * «Новый движок (проверка)»: переключатели путей Rust по группам, только в альфе
   * (`rust-switches.js`). Вне альфы состояние пустое, установка отказывает.
   */
  rustSwitches: {
    state: () => invoke(IPC.RUST_SWITCHES_STATE),
    set: (group, on) => invoke(IPC.RUST_SWITCHES_SET, { group: String(group), on: Boolean(on) }),
  },
  /*
   * Спячка окна (`hibernation.js` главного процесса): перед сном главный просит снимок (`onPrepare`), окно отвечает
   * `ready({ token, snapshot } | { token, busy })`; после пробуждения `take()` отдаёт снимок один раз, `woke()` —
   * «интерфейс разложен».
   */
  hibernation: {
    onPrepare: (listener) => {
      const wrapped = (_event, request) => listener(request);
      ipcRenderer.on(IPC.HIBERNATION_PREPARE, wrapped);
      return () => ipcRenderer.removeListener(IPC.HIBERNATION_PREPARE, wrapped);
    },
    ready: (payload) => invoke(IPC.HIBERNATION_READY, payload),
    take: () => invoke(IPC.HIBERNATION_TAKE),
    woke: () => invoke(IPC.HIBERNATION_WOKE),
    hold: (reason) => invoke(IPC.HIBERNATION_HOLD, { reason: reason ? String(reason).slice(0, 200) : "" }),
  },
  attention: {
    get: () => invoke(IPC.WINDOW_ATTENTION_GET),
    subscribe: (listener) => {
      let live = true;
      let heard = false;
      const wrapped = (_event, snapshot) => {
        heard = true;
        listener(snapshot);
      };
      ipcRenderer.on(IPC.WINDOW_ATTENTION, wrapped);
      invoke(IPC.WINDOW_ATTENTION_GET).then(
        (snapshot) => {
          if (live && !heard) listener(snapshot);
        },
        () => {},
      );
      return () => {
        live = false;
        ipcRenderer.removeListener(IPC.WINDOW_ATTENTION, wrapped);
      };
    },
  },
});
