import fs from "node:fs";
import path from "node:path";

// Что известно о Rust-движке: какие команды он знает, кому отдавать вход,
// где лежит его файл. Сам движок здесь не запускается.

// На Windows — `astral-engine.exe`; на Linux (сервер обложек) тот же движок собирается без суффикса. Rust-командам хост (.NET, только Windows) не нужен.
export const RUST_ENGINE_NAME = process.platform === "win32" ? "astral-engine.exe" : "astral-engine";

const listOf = (text) => text.trim().split(/\s+/);
const pairsOf = (text) => listOf(text).map((pair) => pair.split(":"));

export const RUST_COMMANDS = new Set(
  listOf(`
    convert-model convert-models create-image-card extract-textures rename-texture convert-scene
    build-world-place-scene validate-rpf-patch install-rpf-patch compose-rpf probe-rpf search-rpf extract-rpf
    extract-many-rpf inspect-ytd inspect-ypt read-ypt-digest read-ypt-export restore-rpf-point
    read-archive-file list-archive-entries index-archive extract-archive-entries
    extract-sky-textures extract-cloud-hats extract-map-tiles scan-preview-textures
    ytd-texture-patch ytd-texture-set write-ypt-texture-patch shop-embed-textures
    ypt-patch ypt-clone-export ypt-own-donor
    skin-from-body patch-animal-model
    split-sheet-surfaces graft-drawable compile-timecycle-box compile-place-types
    compile-placements compile-sign-models compile-emblem-plates compile-sky-rainbow
    compile-star-model compile-sky-flyer compile-climb-markers compile-mega-mall-overlay
    awc-inspect read-awc awc-layer-from-wav awc-stream-patch weapons-meta-tracer-patch
    lamp-lod-inspect-pair lamp-lod-patch lamp-studio-lod lamp-studio-patch lamp-inspect lamp-plan
    lamp-patch lamp-verify lamp-studio-inspect lamp-studio-glass lamp-studio-ytyp
    lamp-archive-scan pack-textures restyle-model compile-mlo-models compile-manifest
    inspect-interior-ytyp inspect-interior-ymap inspect-minimap-tiles ycd-from-xml
    compile-interior-layout inspect-map-files minimap-tile-colours paint-minimap-tiles
    build-map-patch restyle-drawable decorate-drawable lamp-pole convert-gen9 sample-anim-pose sample-anim-track
    downscale-textures
  `),
);

// Команды, которые прежний хост ещё умеет сам (запасной путь).
export const HOST_STILL_KNOWS = new Set(
  listOf(`
    compile-place-types compile-manifest compile-sky-flyer compile-placements minimap-tile-colours
    paint-minimap-tiles build-map-patch inspect-interior-ytyp inspect-map-files
    skin-from-body patch-animal-model
    compile-interior-layout restore-rpf-point read-archive-file list-archive-entries
    extract-archive-entries shop-embed-textures split-sheet-surfaces graft-drawable
    restyle-drawable decorate-drawable lamp-pole sample-anim-pose convert-gen9 downscale-textures
  `),
);

export const LAMP_ROUTE_SWITCHES = Object.freeze(
  Object.fromEntries(
    pairsOf(`
      lamp-inspect:ASTRAL_RUST_LAMP_INSPECT lamp-plan:ASTRAL_RUST_LAMP_PLAN
      lamp-patch:ASTRAL_RUST_LAMP_PATCH lamp-verify:ASTRAL_RUST_LAMP_VERIFY
      lamp-studio-inspect:ASTRAL_RUST_LAMP_STUDIO_INSPECT lamp-studio-glass:ASTRAL_RUST_LAMP_GLASS
      lamp-studio-ytyp:ASTRAL_RUST_LAMP_YTYP lamp-archive-scan:ASTRAL_RUST_LAMP_ARCHIVE
    `),
  ),
);

const WORDS_OFF = new Set(listOf("off 0 false no"));
const WORDS_ON = new Set(listOf("on 1 true yes"));

const settingWord = (value) => (value == null ? "" : String(value)).trim().toLowerCase();

// Выключатели: имя функции, переменная окружения, включён ли путь по умолчанию.
// Функция получает имя из ключа литерала: так оно совпадает с именем экспорта.
function makeSwitch(name, variable, onByDefault) {
  const decide = onByDefault ? (word) => !WORDS_OFF.has(word) : (word) => WORDS_ON.has(word);
  const reading = (env) => settingWord(env?.[variable]);
  return {
    [name]: function (env = process.env) {
      return decide(reading(env));
    },
  }[name];
}

export const rustAnimalModelEnabled = makeSwitch("rustAnimalModelEnabled", "ASTRAL_RUST_ANIMAL_MODEL", false);
export const rustAwcInspectEnabled = makeSwitch("rustAwcInspectEnabled", "ASTRAL_RUST_AWC_INSPECT", false);
export const rustClimbEnabled = makeSwitch("rustClimbEnabled", "ASTRAL_RUST_CLIMB", false);
export const rustDecorateEnabled = makeSwitch("rustDecorateEnabled", "ASTRAL_RUST_DECORATE", true);
/* Запросы украшений оружия версии 2 (их шлёт приложение, `weapon-decorations.js`) движок берёт, только если эта же переменная стоит в окружении его процесса (`commands/decorate.rs`); любой его сбой на этом пути считает хост (`native-engine.js`). Умолчание — выключен, под `ASTRAL_RUST_DECORATE`. */
export const rustDecorateV2Enabled = makeSwitch("rustDecorateV2Enabled", "ASTRAL_RUST_DECORATE_V2", false);
/* Фрагменты `.yft` в «Ухудшении текстур»: движок берёт их, только если эта же переменная стоит в окружении его процесса (`commands/levels_yft.rs`, там слова `on` и `1`). Процесс на команду получает окружение приложения целиком, отдельной передачи не нужно. */
export const rustDownscaleYftEnabled = makeSwitch("rustDownscaleYftEnabled", "ASTRAL_RUST_DOWNSCALE_YFT", false);
export const rustEmblemPlatesEnabled = makeSwitch("rustEmblemPlatesEnabled", "ASTRAL_RUST_EMBLEM_PLATES", false);
export const rustEngineEnabled = makeSwitch("rustEngineEnabled", "ASTRAL_RUST_ENGINE", true);
export const rustGen9Enabled = makeSwitch("rustGen9Enabled", "ASTRAL_RUST_GEN9", false);
export const rustGraftEnabled = makeSwitch("rustGraftEnabled", "ASTRAL_RUST_GRAFT", true);
export const rustInteriorLayoutEnabled = makeSwitch("rustInteriorLayoutEnabled", "ASTRAL_RUST_INTERIOR_LAYOUT", true);
export const rustInteriorYmapEnabled = makeSwitch("rustInteriorYmapEnabled", "ASTRAL_RUST_INTERIOR_YMAP", false);
export const rustInteriorYtypEnabled = makeSwitch("rustInteriorYtypEnabled", "ASTRAL_RUST_INTERIOR_YTYP", true);
export const rustLampEnabled = makeSwitch("rustLampEnabled", "ASTRAL_RUST_LAMP", false);
export const rustLampLodEnabled = makeSwitch("rustLampLodEnabled", "ASTRAL_RUST_LAMP_LOD", false);
export const rustLampStudioEnabled = makeSwitch("rustLampStudioEnabled", "ASTRAL_RUST_LAMP_STUDIO", false);
export const rustManifestEnabled = makeSwitch("rustManifestEnabled", "ASTRAL_RUST_MANIFEST", true);
export const rustMapFilesEnabled = makeSwitch("rustMapFilesEnabled", "ASTRAL_RUST_MAP_FILES", true);
export const rustMapPatchEnabled = makeSwitch("rustMapPatchEnabled", "ASTRAL_RUST_MAP_PATCH", true);
export const rustMegaMallEnabled = makeSwitch("rustMegaMallEnabled", "ASTRAL_RUST_MEGA_MALL", false);
export const rustMinimapEnabled = makeSwitch("rustMinimapEnabled", "ASTRAL_RUST_MINIMAP", true);
export const rustMinimapInspectEnabled = makeSwitch("rustMinimapInspectEnabled", "ASTRAL_RUST_MINIMAP_INSPECT", false);
export const rustMloModelsEnabled = makeSwitch("rustMloModelsEnabled", "ASTRAL_RUST_MLO_MODELS", false);
export const rustPackTexturesEnabled = makeSwitch("rustPackTexturesEnabled", "ASTRAL_RUST_PACK_TEXTURES", false);
export const rustPaintMinimapEnabled = makeSwitch("rustPaintMinimapEnabled", "ASTRAL_RUST_PAINT_MINIMAP", true);
export const rustPlaceTypesEnabled = makeSwitch("rustPlaceTypesEnabled", "ASTRAL_RUST_PLACE_TYPES", true);
export const rustPlacementsEnabled = makeSwitch("rustPlacementsEnabled", "ASTRAL_RUST_PLACEMENTS", true);
export const rustPoseEnabled = makeSwitch("rustPoseEnabled", "ASTRAL_RUST_POSE", true);
export const rustRadarOverlayEnabled = makeSwitch("rustRadarOverlayEnabled", "ASTRAL_RUST_RADAR_OVERLAY", false);
export const rustRestyleEnabled = makeSwitch("rustRestyleEnabled", "ASTRAL_RUST_RESTYLE", true);
export const rustRestyleModelEnabled = makeSwitch("rustRestyleModelEnabled", "ASTRAL_RUST_RESTYLE_MODEL", false);
export const rustShopEnabled = makeSwitch("rustShopEnabled", "ASTRAL_RUST_SHOP_EMBED", true);
export const rustSignModelsEnabled = makeSwitch("rustSignModelsEnabled", "ASTRAL_RUST_SIGN_MODELS", false);
export const rustSkinFromBodyEnabled = makeSwitch("rustSkinFromBodyEnabled", "ASTRAL_RUST_SKIN_FROM_BODY", false);
export const rustSkyClipEnabled = makeSwitch("rustSkyClipEnabled", "ASTRAL_RUST_SKY_CLIP", false);
export const rustSkyFlyerEnabled = makeSwitch("rustSkyFlyerEnabled", "ASTRAL_RUST_SKY_FLYER", false);
export const rustSkyRainbowEnabled = makeSwitch("rustSkyRainbowEnabled", "ASTRAL_RUST_SKY_RAINBOW", false);
export const rustSoundImportEnabled = makeSwitch("rustSoundImportEnabled", "ASTRAL_RUST_SOUND_IMPORT", false);
export const rustSplitEnabled = makeSwitch("rustSplitEnabled", "ASTRAL_RUST_SPLIT_SHEET", true);
export const rustStarClipEnabled = makeSwitch("rustStarClipEnabled", "ASTRAL_RUST_STAR_CLIP", false);
export const rustStarModelEnabled = makeSwitch("rustStarModelEnabled", "ASTRAL_RUST_STAR_MODEL", false);
export const rustTextureLevelsEnabled = makeSwitch("rustTextureLevelsEnabled", "ASTRAL_RUST_TEXTURE_LEVELS", false);
export const rustTimecycleEnabled = makeSwitch("rustTimecycleEnabled", "ASTRAL_RUST_TIMECYCLE", true);
export const rustWeaponsMetaEnabled = makeSwitch("rustWeaponsMetaEnabled", "ASTRAL_RUST_WEAPONS_META", false);
export const rustYcdFromXmlEnabled = makeSwitch("rustYcdFromXmlEnabled", "ASTRAL_RUST_YCD_FROM_XML", false);
export const rustYptCloneExportEnabled = makeSwitch("rustYptCloneExportEnabled", "ASTRAL_RUST_YPT_CLONE_EXPORT", false);
export const rustYptInspectEnabled = makeSwitch("rustYptInspectEnabled", "ASTRAL_RUST_YPT_INSPECT", false);
export const rustYptOwnDonorEnabled = makeSwitch("rustYptOwnDonorEnabled", "ASTRAL_RUST_YPT_OWN_DONOR", false);
export const rustYptRulesEnabled = makeSwitch("rustYptRulesEnabled", "ASTRAL_RUST_YPT_RULES", false);
export const rustYptTextureEnabled = makeSwitch("rustYptTextureEnabled", "ASTRAL_RUST_YPT_TEXTURE", false);

export function rustLampRouteEnabled(command, env = process.env) {
  const variable = LAMP_ROUTE_SWITCHES[String(command || "")];
  if (!variable) return false;
  return WORDS_ON.has(settingWord(env?.[variable]));
}

export function lampRouteFlags(env = process.env) {
  const flags = {};
  for (const command of Object.keys(LAMP_ROUTE_SWITCHES)) flags[command] = rustLampRouteEnabled(command, env);
  return flags;
}

function outputExtension(input) {
  const named = input?.output;
  return path.extname(named == null ? "" : String(named)).toLowerCase();
}

// Слои радара есть, только если overlays — настоящий непустой список
// (свойство читается отдельно для проверки списка и для длины).
function hasOverlayLayers(input) {
  return Array.isArray(input?.overlays) ? input.overlays.length > 0 : false;
}

// Команда -> имя параметра, который сам и решает, отдавать ли вход движку.
const PLAIN_FLAGS = new Map(
  pairsOf(`
    restyle-drawable:restyleEnabled restyle-model:restyleModelEnabled sample-anim-pose:poseEnabled
    convert-gen9:gen9Enabled compile-timecycle-box:timecycleEnabled
    compile-placements:placementsEnabled compile-sign-models:signModelsEnabled
    compile-emblem-plates:emblemPlatesEnabled compile-sky-rainbow:skyRainbowEnabled
    compile-star-model:starModelEnabled compile-sky-flyer:skyFlyerEnabled
    compile-climb-markers:climbEnabled compile-mega-mall-overlay:megaMallEnabled
    awc-inspect:awcInspectEnabled read-awc:soundImportEnabled
    awc-layer-from-wav:soundImportEnabled awc-stream-patch:soundImportEnabled
    weapons-meta-tracer-patch:weaponsMetaEnabled lamp-lod-inspect-pair:lampLodEnabled
    lamp-lod-patch:lampLodEnabled lamp-studio-lod:lampLodEnabled
    lamp-studio-patch:lampStudioEnabled pack-textures:packEnabled
    compile-mlo-models:mloModelsEnabled inspect-interior-ytyp:interiorYtypEnabled
    inspect-interior-ymap:interiorYmapEnabled inspect-minimap-tiles:minimapInspectEnabled
    ycd-from-xml:ycdFromXmlEnabled compile-interior-layout:interiorLayoutEnabled
    inspect-map-files:mapFilesEnabled minimap-tile-colours:minimapEnabled
    build-map-patch:mapPatchEnabled downscale-textures:textureLevelsEnabled
  `),
);

// Команда -> параметр и расширение выходного файла, при которых вход берёт движок.
const EXTENSION_GATES = new Map(
  pairsOf(`
    shop-embed-textures:shopEnabled:.ydr split-sheet-surfaces:splitEnabled:.ydr
    skin-from-body:skinFromBodyEnabled:.ydd patch-animal-model:animalModelEnabled:.ydd
    graft-drawable:graftEnabled:.ydr decorate-drawable:decorateEnabled:.ydr
    lamp-pole:lampEnabled:.yft compile-place-types:placeTypesEnabled:.ytyp
    compile-manifest:manifestEnabled:.ymf
  `).map(([command, flag, extension]) => [command, [flag, extension]]),
);

// Параметры читаются все сразу и в этом порядке; не заданный параметр означает «выключено».
const FLAG_NAMES = listOf(`
  lampRoutes gen9Enabled shopEnabled splitEnabled graftEnabled restyleEnabled restyleModelEnabled
  decorateEnabled lampEnabled poseEnabled timecycleEnabled placeTypesEnabled manifestEnabled placementsEnabled
  minimapEnabled paintMinimapEnabled radarOverlayEnabled signModelsEnabled emblemPlatesEnabled
  skyRainbowEnabled starModelEnabled skyFlyerEnabled climbEnabled packEnabled mloModelsEnabled mapPatchEnabled
  interiorYtypEnabled interiorYmapEnabled minimapInspectEnabled ycdFromXmlEnabled mapFilesEnabled
  interiorLayoutEnabled megaMallEnabled awcInspectEnabled soundImportEnabled weaponsMetaEnabled
  skinFromBodyEnabled animalModelEnabled
  lampLodEnabled lampStudioEnabled textureLevelsEnabled
`);

// Отдаёт ли движок этот вход этой команды. Результат бывает не булевым:
// выражения возвращают сам ключ параметров, если он ложный.
export function rustTakesInput(command, input, flags = {}) {
  const given = Object.fromEntries(FLAG_NAMES.map((name) => [name, flags[name]]));
  const lampRoutes = given.lampRoutes === undefined ? {} : given.lampRoutes;
  const extension = outputExtension(input);
  const flagOf = (name) => (given[name] === undefined ? false : given[name]);

  if (command in LAMP_ROUTE_SWITCHES) return lampRoutes[command] === true;

  const gate = EXTENSION_GATES.get(command);
  if (gate) {
    const open = flagOf(gate[0]);
    return open && extension === gate[1];
  }
  if (command === "paint-minimap-tiles") {
    const painting = flagOf("paintMinimapEnabled");
    return painting && (!hasOverlayLayers(input) || flagOf("radarOverlayEnabled"));
  }
  return PLAIN_FLAGS.has(command) ? flagOf(PLAIN_FLAGS.get(command)) : true;
}

// Файл запроса читается и разбирается заново при каждом вызове;
// любой сбой чтения или разбора означает «нет».
async function judgeRequest(requestPath, verdict) {
  let judged = false;
  try {
    judged = verdict(JSON.parse(await fs.promises.readFile(requestPath, "utf8")));
  } catch {
    judged = false;
  }
  return judged;
}

const isObjectRoot = (root) => typeof root === "object" && Boolean(root);

const rootHasDonor = (root) => isObjectRoot(root) && "donor" in root;

function someModelHasDonor(root) {
  const models = root?.models;
  return Array.isArray(models) && models.some(rootHasDonor);
}

function lacksSources(root) {
  if (!isObjectRoot(root)) return false;
  return !Array.isArray(root.sources) || root.sources.length === 0;
}

export const climbRequestHasDonor = async (requestPath) => judgeRequest(requestPath, rootHasDonor);

/*
 * Запрос с путями доноров (`game-donor.js` кладёт его рядом с исходным под этим именем). Хост такой файл не читает: его разбор
 * строгий, лишнее поле — отказ `JsonException`. Поэтому отказ движка на таком запросе хосту тем же файлом не передаётся
 * (находка сверки 16.11.2026: у звезды, радуги, дирижаблей и мегамолла «Применить» падало) — хосту идёт исходный запрос,
 * это делает `compileWithGameDonor`.
 */
export const DONOR_REQUEST_FILE = "request-donor.json";
/* Имя файла — после последней прямой или обратной черты: путь Windows узнаётся и там, где тесты идут не на Windows. */
export const isDonorRequestFile = (requestPath) =>
  String(requestPath || "")
    .split(/[\\/]/)
    .pop()
    .toLowerCase() === DONOR_REQUEST_FILE;

export const emblemRequestHasDonor = async (requestPath) => judgeRequest(requestPath, rootHasDonor);

/* Знаки: донор бывает у модели (`models[].donor`, путь «на донора») и в корне запроса (новые шейдеры на каркасе донора, 18.11.2026) — хост не читает ни то, ни другое. */
export const signRequestHasDonor = async (requestPath) => judgeRequest(requestPath, (root) => rootHasDonor(root) || someModelHasDonor(root));

export const placeTypesRequestIsEmpty = async (requestPath) => judgeRequest(requestPath, lacksSources);

// Фрагмент `.yft` движок не берёт («фрагменты .yft ещё не перенесены»): запись с таким именем в запросе — хосту.
// Имя читается так же, как у обоих исполнителей: последняя часть пути, регистр не важен.
const FRAGMENT_NAME = /\.yft$/i;

function someItemIsFragment(root) {
  const items = root?.items;
  if (!Array.isArray(items)) return false;
  return items.some((item) => FRAGMENT_NAME.test(String(item?.name ?? "").split(/[/\\]/).pop()));
}

export const textureLevelsRequestHasFragments = async (requestPath) => judgeRequest(requestPath, someItemIsFragment);

// Места, где лежит собранный движок в дереве разработчика, по порядку проверки.
const DEV_ENGINE_DIRS = listOf(`
  native/astral-engine/prebuilt
  native/publish
  native/astral-engine/target/x86_64-pc-windows-msvc/release
  native/astral-engine/target/release
`);

export function resolveRustExecutable(options = {}) {
  const { packaged, resourcesPath, projectRoot } = options;
  const candidates = packaged
    ? [path.join(resourcesPath || "", "native", RUST_ENGINE_NAME)]
    : DEV_ENGINE_DIRS.map((dirs) => path.join(projectRoot || "", dirs, RUST_ENGINE_NAME));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
