import { diskGovernor } from "@modovik/install-engine/disk-governor.js";
import { noteDiskPlaces } from "@modovik/install-engine/disk-profile.js";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { isArchiveFixNotApplied, retryArchiveFixNotApplied } from "./archivefix-retry.js";
import { BACKGROUND_COMMANDS, lowerBackgroundPriority } from "./child-priority.js";
import { createLimitsRegistry, limitsLine } from "./engine-limits-line.js";
import { setFastProcessLister } from "./game-processes.js";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  archiveKeysDirectory,
  lastArchiveSupportFailure,
} from "./loader-provisioner.js";
import { explainFolderDenied } from "./folder-access-probe.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { asRestorePointWriter, RESTORE_POINT_COMMANDS } from "./restore-points-move.js";
import { appPackaged, appResourcesPath } from "./runtime-paths.js";
import {
  HOST_STILL_KNOWS,
  RUST_COMMANDS,
  resolveRustExecutable,
  rustEngineEnabled,
  rustShopEnabled,
  rustGraftEnabled,
  rustSkinFromBodyEnabled,
  rustAnimalModelEnabled,
  rustPoseEnabled,
  rustDecorateEnabled,
  rustDecorateV2Enabled,
  rustLampEnabled,
  rustRestyleEnabled,
  rustRestyleModelEnabled,
  rustSkyClipEnabled,
  rustSplitEnabled,
  rustStarClipEnabled,
  rustTakesInput,
  rustTimecycleEnabled,
  rustPlaceTypesEnabled,
  rustManifestEnabled,
  rustPlacementsEnabled,
  rustGen9Enabled,
  rustMinimapEnabled,
  rustPaintMinimapEnabled,
  rustRadarOverlayEnabled,
  rustSignModelsEnabled,
  signRequestHasDonor,
  placeTypesRequestIsEmpty,
  rustEmblemPlatesEnabled,
  rustMegaMallEnabled,
  rustAwcInspectEnabled,
  rustSoundImportEnabled,
  rustWeaponsMetaEnabled,
  rustLampLodEnabled,
  rustLampStudioEnabled,
  LAMP_ROUTE_SWITCHES,
  lampRouteFlags,
  rustSkyRainbowEnabled,
  rustStarModelEnabled,
  rustSkyFlyerEnabled,
  rustMloModelsEnabled,
  emblemRequestHasDonor,
  rustClimbEnabled,
  climbRequestHasDonor,
  isDonorRequestFile,
  rustPackTexturesEnabled,
  rustMapPatchEnabled,
  rustInteriorYtypEnabled,
  rustInteriorYmapEnabled,
  rustMinimapInspectEnabled,
  rustYcdFromXmlEnabled,
  rustMapFilesEnabled,
  rustInteriorLayoutEnabled,
  rustTextureLevelsEnabled,
  rustDownscaleYftEnabled,
  textureLevelsRequestHasFragments,
} from "./native-engine-rust.js";
import { noteRoute } from "./rust-routes.js";
import { engineCrashedError, engineFilesStamp, isEngineCrash } from "./engine-crash-guard.js";
import {
  CANCEL_GRACE_MS,
  INSTALL_ENV_KEYS,
  RUST_SERVE_COMMANDS,
  RUST_SERVE_INSTALL_COMMANDS,
  createRustEngineService,
  rustInstallServeEnabled,
  rustServeEnabled,
} from "./rust-engine-service.js";
import { onHibernate } from "./hibernation-hooks.js";

const execFileAsync = promisify(execFile);
const commands = new Set([
  "health",
  "convert-model",
  "convert-models",
  "read-model-ars2",
  "create-image-card",
  "extract-textures",
  "rename-texture",
  "inspect-interior-ymap",
  "inspect-interior-ytyp",
  "inspect-map-files",
  "convert-scene",
  /* Сцена места мира для 3D-кадра (`world-place-engine.js`): запрос — файл JSON, ответ — файл сцены в кэше. */
  "build-world-place-scene",
  "compile-interior-layout",
  "validate-rpf-patch",
  "install-rpf-patch",
  "compose-rpf",
  "probe-rpf",
  "search-rpf",
  "extract-rpf",
  "extract-many-rpf",
  "inspect-ytd",
  "inspect-ypt",
  /* Выписка и выгрузка правил эффектов (ypt-rule-digest / ypt-rule-export помощника). */
  "read-ypt-digest",
  "read-ypt-export",
  "restore-rpf-point",
  "read-archive-file",
  "list-archive-entries",
  "index-archive",
  "extract-archive-entries",
  "extract-sky-textures",
  "extract-cloud-hats",
  "extract-map-tiles",
  "build-map-patch",
  "minimap-tile-colours",
  "paint-minimap-tiles",
  "stack-minimap-tiles",
  /* Осмотр плиток радара без записи: независимая сверка записанного (`probe-world-map`). */
  "inspect-minimap-tiles",
  /* Словарь клипов из XML CodeWalker (шаг C0 опытов): `xml` и `output`; маршрут — за выключателем. */
  "ycd-from-xml",
  /* Опись банка звуков (`awc-inspect`); маршрут — за выключателем, см. rustAwcInspectEnabled. */
  "awc-inspect",
  /* Импорт WAV в слой без XML (`read-awc`, `awc-layer-from-wav`); маршрут — за выключателем, см. rustSoundImportEnabled. */
  "read-awc",
  "awc-layer-from-wav",
  /* Правка банка потоками (`awc-stream-patch`); маршрут — за тем же выключателем, см. rustSoundImportEnabled. */
  "awc-stream-patch",
  /* Привязка следа и вспышки в weapons.meta (`weapons-meta-tracer-patch`); маршрут — за выключателем, см. rustWeaponsMetaEnabled. */
  "weapons-meta-tracer-patch",
  /* Опись пары карт света LOD (`lamp-lod-inspect-pair`); маршрут — за выключателем, см. rustLampLodEnabled. */
  "lamp-lod-inspect-pair",
  "lamp-lod-patch",
  "lamp-studio-lod",
  /* Правка огней и стекла модели мастерской (`lamp-studio-patch`); маршрут — за выключателем, см. rustLampStudioEnabled. */
  "lamp-studio-patch",
  /* Фонари помощника (`lamp-*`): запрос файлом (`--input`); маршрут — за выключателями группы «Фонари», см. LAMP_ROUTE_SWITCHES. */
  "lamp-inspect",
  "lamp-plan",
  "lamp-patch",
  "lamp-verify",
  "lamp-studio-inspect",
  "lamp-studio-glass",
  "lamp-studio-ytyp",
  "lamp-archive-scan",
  "scan-preview-textures",
  "compile-mega-mall-overlay",
  "compile-sky-rainbow",
  "compile-climb-markers",
  "build-wallbang-base",
  "compile-emblem-plates",
  "compile-star-model",
  /* «Дирижабли» (ТЗ 11.10.2026): модель и клип полёта по кругу. */
  "compile-sky-flyer",
  "compile-sign-models",
  "compile-placements",
  "convert-gen9",
  "graft-drawable",
  /* Вещь педа без весов получает веса тела в самом файле (разбор 02.11.2026). */
  "skin-from-body",
  "decorate-drawable",
  /* «Животные»: метка над животным и свечение — геометрией в словаре моделей педа (a_c_*.ydd). */
  "patch-animal-model",
  "restyle-drawable",
  "restyle-model",
  /* Фонари: столб — краска, прозрачность и украшения в модели. */
  "lamp-pole",
  "compile-timecycle-box",
  "compile-manifest",
  /* Свои модели мест внутри помещения игры (ТЗ 11.10.2026, вечер, задача 1). */
  "compile-mlo-models",
  "compile-place-types",
  "downscale-textures",
  /* `style-pixels` (сверка правила стиля хоста с правилом окна, ТЗ 17.10.2026, задача 10) сюда
     нарочно не входит: она читает и пишет пути из запроса, а приложению не нужна — тест зовёт
     exe хоста напрямую. */
  "pack-textures",
  /* «Интерьеры» снаружи (задача 3 ТЗ 10.10.2026): листы квартала — копией в модель места. */
  "shop-embed-textures",
  /* Свой лист у части модели, что делит лист с соседями (задача 11 ТЗ 17.10.2026). */
  "split-sheet-surfaces",
  "sample-anim-pose",
  /* Вся дорожка клипа одним вызовом (`animations/animation-track-engine.js`, за выключателем ASTRAL_RUST_TRACK). */
  "sample-anim-track",
  /* Правка словаря текстур Legacy (фаза 7Б, группа 1): список правок — файлом. */
  "ytd-texture-patch",
  "ytd-texture-set",
  /* Правка текстур ядра YPT (маршрут — rpf-composer.js, `tryYptTextureOnEngine`): список правок — файлом. */
  "write-ypt-texture-patch",
  /* Весь запрос режима `ypt-texture-patch` помощника (правила, кадры, клоны, сброс, слоты, текстуры) одним проходом (`ypt-patch`, маршрут — rpf-composer.js, `tryYptRulesOnEngine`): запрос файлом. */
  "ypt-patch",
  /* Режимы помощника `ypt-clone-export` и `ypt-own-donor` (маршруты — rpf-composer.js, `tryYptCloneExportOnEngine`, `tryYptOwnDonorOnEngine`): запрос файлом. */
  "ypt-clone-export",
  "ypt-own-donor",
]);

const cleanString = (value, field, { optional = false } = {}) => {
  if ((value === undefined || value === null || value === "") && optional)
    return null;
  if (typeof value !== "string" || !value.trim() || value.length > 4096)
    throw new Error(`Invalid native engine field: ${field}`);
  return value.trim();
};

/* Где точки отката (22.10.2026): в папке кэша, которую выбрал человек. Хост и
   движок её не вычисляют, а получают; без абсолютной папки — их прежняя по умолчанию. */
const restorePointsArgument = () => {
  const root = nativeRestorePointsRoot();
  return path.isAbsolute(root) ? root : null;
};

export function nativeArguments(command, raw = {}) {
  if (!commands.has(command))
    throw new Error("Unsupported native engine command.");
  const input = raw && typeof raw === "object" ? raw : {};
  const args = [command];
  const add = (name, value, config) => {
    const cleaned = cleanString(value, name, config);
    if (cleaned !== null) args.push(`--${name}`, cleaned);
  };
  if (command === "health") return args;
  if (command === "read-ypt-digest" || command === "read-ypt-export") {
    add("input", input.input);
    const names = Array.isArray(input.names) ? input.names : [];
    if (!names.length || names.length > 128) throw new Error("Invalid YPT rule name list.");
    for (const name of names) add("name", name);
    return args;
  }
  if (command === "convert-model") {
    add("input", input.input);
    add("output", input.output);
    const textures = Array.isArray(input.textures) ? input.textures : [];
    if (textures.length > 64) throw new Error("Too many texture dictionaries.");
    for (const texture of textures) add("texture", texture);
    // Словарь моделей бывает целым персонажем по частям: китель полицейского
    // лежит в одном `.ydd` с его же головой и ботинками.
    add("drawable", input.drawable, { optional: true });
    return args;
  }
  if (command === "convert-models") {
    // Партия деталей одного пака: словари текстур у них общие, и нативный
    // хост разбирает их один раз, а не заново на каждую модель.
    const inputs = Array.isArray(input.inputs) ? input.inputs : [];
    if (!inputs.length) throw new Error("Batch conversion requires inputs.");
    if (inputs.length > 256) throw new Error("Too many models in one batch.");
    for (const file of inputs) add("input", file);
    add("output-dir", input.outputDirectory);
    const textures = Array.isArray(input.textures) ? input.textures : [];
    if (textures.length > 64) throw new Error("Too many texture dictionaries.");
    for (const texture of textures) add("texture", texture);
    return args;
  }
  if (command === "create-image-card") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  if (command === "extract-map-tiles") {
    add("game-root", input.gameRoot);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    /* Резервная копия update.rpf вместо живого архива: после своей же
       установки живой несёт уже нашу карту (`MapTiles.ArchiveSlot`). */
    add("base-archive", input.baseArchive, { optional: true });
    return args;
  }
  if (command === "build-map-patch") {
    add("game-root", input.gameRoot);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    add("base-archive", input.baseArchive, { optional: true });
    const tiles = Array.isArray(input.tiles) ? input.tiles : [];
    if (!tiles.length) throw new Error("No map tiles to patch.");
    if (tiles.length > 64) throw new Error("Too many map tiles.");
    for (const tile of tiles) add("tile", tile);
    return args;
  }
  /* Радар: палитра векторных плиток игрока и их перекраска в цвета карты
     (`MinimapRadar.cs`). */
  if (command === "minimap-tile-colours") {
    add("game-root", input.gameRoot);
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "paint-minimap-tiles") {
    add("game-root", input.gameRoot);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    const colours = Array.isArray(input.colours) ? input.colours : [];
    /* Слои большой карты (`MinimapRadar.Overlay.cs`): файлы ARO1, по одному на кусок. */
    const overlays = Array.isArray(input.overlays) ? input.overlays : [];
    if (!colours.length && !overlays.length)
      throw new Error("No radar colours to paint and no overlays to add.");
    if (colours.length > 512) throw new Error("Too many radar colours.");
    if (overlays.length > 64) throw new Error("Too many radar overlay files.");
    for (const colour of colours) add("colour", colour);
    for (const overlay of overlays) add("overlay", overlay);
    return args;
  }
  if (command === "inspect-minimap-tiles") {
    const tiles = Array.isArray(input.tiles) ? input.tiles : [];
    if (!tiles.length) throw new Error("No radar tiles to inspect.");
    if (tiles.length > 256) throw new Error("Too many radar tiles to inspect.");
    for (const tile of tiles) add("input", tile);
    return args;
  }
  if (command === "awc-inspect") {
    add("input", input.input);
    return args;
  }
  if (command === "read-awc") {
    add("input", input.input);
    return args;
  }
  if (command === "awc-stream-patch") {
    add("input", input.input);
    add("output", input.output);
    add("patches", input.patches);
    if (input.limits) add("limits", input.limits);
    return args;
  }
  if (command === "awc-layer-from-wav") {
    add("request", input.request);
    add("output", input.output);
    return args;
  }
  if (command === "weapons-meta-tracer-patch") {
    add("request", input.request);
    return args;
  }
  if (command in LAMP_ROUTE_SWITCHES) {
    add("input", input.input);
    return args;
  }
  if (command === "lamp-lod-inspect-pair") {
    add("lod", input.lod);
    add("distant", input.distant);
    return args;
  }
  if (command === "lamp-lod-patch") {
    add("request", input.request);
    return args;
  }
  if (command === "lamp-studio-lod") {
    add("request", input.request);
    return args;
  }
  if (command === "lamp-studio-patch") {
    add("request", input.request);
    return args;
  }
  if (command === "ycd-from-xml") {
    add("xml", input.xml);
    add("output", input.output);
    return args;
  }
  /* Радар «3D-здания» (21.11): плитки с кварталами в стопку слоёв и палитра карты — `MinimapRadar.StackTiles`. */
  if (command === "stack-minimap-tiles") {
    add("game-root", input.gameRoot);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    add("height-grid", input.heightGrid);
    const number = (name, value) => {
      if (!Number.isFinite(value)) throw new Error(`Radar buildings: ${name} is not a number.`);
      add(name, String(value));
    };
    number("height-scale", input.heightScale);
    number("z-from", input.zFrom);
    number("z-to", input.zTo);
    number("spacing", input.spacing);
    number("layers-max", input.layersMax);
    const pairs = (name, raw, max, label) => {
      const list = Array.isArray(raw) ? raw : [];
      if (list.length > max) throw new Error(`Too many radar ${label}.`);
      for (const pair of list) add(name, pair);
    };
    pairs("block", input.blocks, 64, "block colours");
    pairs("paint", input.paints, 512, "colours");
    if (!Array.isArray(input.blocks) || !input.blocks.length) throw new Error("No radar block colours.");
    return args;
  }
  if (command === "scan-preview-textures") {
    add("game-root", input.gameRoot);
    // Без папки команда только перечисляет найденное — это её режим осмотра.
    add("output", input.output, { optional: true });
    add("keys", input.keys, { optional: true });
    add("dlc", input.dlc, { optional: true });
    if (input.limit !== undefined && input.limit !== null)
      add("limit", String(input.limit));
    const lists = [
      ["archive", input.archives, 64],
      ["dictionary", input.dictionaries, 64],
      ["texture", input.textures, 512],
    ];
    for (const [name, raw, max] of lists) {
      const values = Array.isArray(raw) ? raw : [];
      if (values.length > max)
        throw new Error(`Too many ${name} filters for a preview scan.`);
      for (const value of values) add(name, value);
    }
    return args;
  }
  if (command === "compile-mega-mall-overlay") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  if (command === "compile-sky-rainbow") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  if (command === "compile-climb-markers") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  /* Основа прострелов из архива мода — инструмент разработки
     (`scripts/prepare-wallbang-resources.mjs`): запрос и папка вывода. */
  if (command === "build-wallbang-base") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  /* «Интерьеры» снаружи (задача 3 ТЗ 10.10.2026): запрос и файл модели места. */
  if (command === "shop-embed-textures" || command === "split-sheet-surfaces") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  /* Эмблема в мире (завод): плашки, их типы, место и манифест. Пересадка
     частей модели (лампы штатных ферм в ангар мода): запрос и файл вывода.
     Модели надписи на холме («Вайнвуд»): запрос и папка вывода. */
  if (["compile-emblem-plates", "compile-star-model", "compile-sky-flyer", "compile-sign-models", "graft-drawable", "skin-from-body", "decorate-drawable", "patch-animal-model", "restyle-drawable", "restyle-model", "lamp-pole", "compile-timecycle-box", "compile-manifest", "compile-mlo-models", "compile-place-types", "compile-placements", "downscale-textures", "pack-textures"].includes(command)) {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  /* Правка словаря текстур (Legacy, фаза 7Б): файл-вход, файл-выход и список правок файлом. */
  if (command === "ytd-texture-patch") {
    add("input", input.input);
    add("output", input.output);
    add("patches", input.patches);
    return args;
  }
  /* Правка текстур ядра YPT (`write-ypt-texture-patch`, маршрут — rpf-composer.js): файл-вход, файл-выход и список правок. */
  if (command === "write-ypt-texture-patch") {
    add("input", input.input);
    add("output", input.output);
    add("patches", input.patches);
    return args;
  }
  /* Весь запрос режима `ypt-texture-patch` (`ypt-patch`) и режимы `ypt-clone-export`, `ypt-own-donor`: тело запроса помощника лежит файлом. */
  if (command === "ypt-patch" || command === "ypt-clone-export" || command === "ypt-own-donor") {
    add("request", input.request);
    return args;
  }
  if (command === "ytd-texture-set") {
    add("input", input.input);
    add("output", input.output);
    add("family", input.family);
    add("additions", input.additions);
    return args;
  }
  /* Ресурсы Legacy → Enhanced (gen9): запрос со списком файлов (ТЗ 08.10). */
  if (command === "convert-gen9") {
    add("input", input.input);
    return args;
  }
  if (command === "extract-textures") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  if (command === "rename-texture") {
    add("input", input.input);
    add("output", input.output);
    add("from", input.from);
    add("to", input.to);
    return args;
  }
  if (["inspect-interior-ymap", "inspect-interior-ytyp"].includes(command)) {
    add("input", input.input);
    return args;
  }
  if (command === "compile-interior-layout") {
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  if (command === "inspect-map-files") {
    // Пачка ymap/ytyp/ydd/gtxd одним запуском: секция карты — это сотни
    // файлов, и по процессу на каждый — минута ожидания вместо секунды.
    const inputs = Array.isArray(input.inputs) ? input.inputs : [];
    if (!inputs.length && !input.list)
      throw new Error("Map inspection requires inputs.");
    if (inputs.length > 64)
      throw new Error("Too many map files on the command line; use a list.");
    for (const file of inputs) add("input", file);
    /* Файл-список (JSON-массив путей): сотни ymap не влезают в командную
       строку Windows. */
    add("list", input.list, { optional: true });
    add("output", input.output, { optional: true });
    return args;
  }
  if (command === "convert-scene") {
    // Список деталей и словарей едет файлом запроса: у бандла их сотни, а
    // командная строка Windows ограничена.
    add("input", input.input);
    add("output", input.output);
    return args;
  }
  if (command === "build-world-place-scene") {
    add("request", input.request);
    return args;
  }
  if (command === "restore-rpf-point") {
    add("restore-point", input.restorePointId);
    add("restore-points-root", restorePointsArgument(), { optional: true });
    return args;
  }
  if (command === "read-archive-file") {
    add("game-root", input.gameRoot);
    add("entry", input.entry);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "index-archive") {
    // Разбираемый архив лежит там, куда его скачали, и к папке игры не
    // привязан: путь идёт как есть. Ключи всё равно нужны — их даёт либо
    // папка игры, либо каталог ключей.
    add("input", input.input);
    add("output", input.output);
    add("label", input.label, { optional: true });
    add("game-root", input.gameRoot, { optional: true });
    add("keys", input.keys, { optional: true });
    /* Вложенный архив из распакованного дерева: content.xml у него не свой,
       и разбирать его незачем. */
    if (input.contentXml === false) add("content-xml", "false");
    return args;
  }
  if (command === "extract-archive-entries") {
    add("input", input.input);
    add("output-dir", input.outputDirectory);
    const entries = Array.isArray(input.entries) ? input.entries : [];
    if (!entries.length) throw new Error("Extraction requires entries.");
    if (entries.length > 5000)
      throw new Error("Too many entries in one batch.");
    for (const entry of entries) add("entry", entry);
    add("game-root", input.gameRoot, { optional: true });
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "sample-anim-pose") {
    // Поза из клипа игры (`.ycd`, уже вынутого из архива): без клипа —
    // список клипов словаря, с клипом — повороты костей на кадре `time`.
    add("input", input.input);
    add("clip", input.clip, { optional: true });
    if (input.time !== undefined && input.time !== null)
      add("time", String(Number(input.time) || 0));
    return args;
  }
  if (command === "sample-anim-track") {
    // Вся дорожка клипа: запрос — файлом (его не вместят параметры в 4096 знаков), контейнер ATK1 — в папку хранилища оболочки.
    add("request", input.request);
    add("assets-dir", input.assetsDir, { optional: true });
    return args;
  }
  if (command === "list-archive-entries") {
    // Листинг архива: путь к RPF относительный от корня игры, вложенные rpf
    // движок раскрывает сам. Фильтр — просто подстрока пути, без него команда
    // перечисляет весь архив (до лимита нативного хоста).
    add("game-root", input.gameRoot);
    add("archive", input.archive);
    add("filter", input.filter, { optional: true });
    add("keys", input.keys, { optional: true });
    // Индекс целого архива: сотни тысяч записей в файл, а не в stdout.
    add("output", input.output, { optional: true });
    if (input.maxEntries !== undefined && input.maxEntries !== null)
      add("max-entries", String(input.maxEntries));
    if (input.depth !== undefined && input.depth !== null)
      add("depth", String(input.depth));
    return args;
  }
  if (command === "extract-sky-textures") {
    add("game-root", input.gameRoot);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "extract-cloud-hats") {
    add("game-root", input.gameRoot);
    add("output", input.output);
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "inspect-ytd" || command === "inspect-ypt") {
    add("input", input.input);
    return args;
  }
  if (command === "extract-rpf" || command === "extract-many-rpf") {
    add("request", input.requestFile);
    add("game-root", input.gameRoot, { optional: true });
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "search-rpf") {
    add("request", input.requestFile);
    add("game-root", input.gameRoot, { optional: true });
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "probe-rpf") {
    add("request", input.requestFile);
    add("game-root", input.gameRoot, { optional: true });
    add("keys", input.keys, { optional: true });
    return args;
  }
  if (command === "compose-rpf") {
    // Сборка модов: запрос лежит файлом (операций бывает тысячи — в командной строке не уместятся).
    add("request", input.requestFile);
    add("game-root", input.gameRoot, { optional: true });
    add("archive-fix", input.archiveFix, { optional: true });
    add("keys", input.keys, { optional: true });
    /* Сборка с установкой (`install` в запросе) заводит точку отката. */
    add("restore-points-root", restorePointsArgument(), { optional: true });
    noteDiskPlaces([input.gameRoot]);
    return withWriteLimit(args, command);
  }
  add("patch", input.patch);
  if (command === "install-rpf-patch") {
    add("game-root", input.gameRoot);
    add("archive-fix", input.archiveFix, { optional: true });
    add("keys", input.keys, { optional: true });
    add("restore-points-root", restorePointsArgument(), { optional: true });
    noteDiskPlaces([input.gameRoot]);
  }
  return withWriteLimit(args, command);
}

/* Потолок записи из «Хранилища» — к командам, которые пишут архивы (см. WRITE_LIMITED_COMMANDS). */
function withWriteLimit(args, command) {
  /* Регулятор диска (`disk-governor.js`): команда, которая пишет архивы, — работа с диском; датчик поднимается заранее, а потолки ниже уже учитывают его последние слова. */
  if (WRITE_LIMITED_COMMANDS.has(command)) diskGovernor().touch();
  if (WRITE_LIMITED_COMMANDS.has(command) && writeLimitMbps) {
    args.push("--write-limit-mbps", String(writeLimitMbps));
  }
  /* Прежняя сборка движка незнакомое имя просто не читает: опции ей не мешают. */
  if (WRITE_LIMITED_COMMANDS.has(command) && readLimitMbps) {
    args.push("--read-limit-mbps", String(readLimitMbps));
  }
  return args;
}

export function parseNativeResult(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (typeof parsed?.ok !== "boolean") continue;
      if (!parsed.ok) {
        const failure = new Error(parsed.error?.message || "Native engine failed.");
        /* Код отказа движка (`InvalidDataException`, `ArgumentException`…) раньше терялся: в журнале оставалась одна строка без вида. */
        if (parsed.error?.code) failure.engineCode = String(parsed.error.code);
        throw failure;
      }
      return parsed.result;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error("Native engine returned no JSON result.");
}

/**
 * «Нет JSON» вместе со словами хоста из stderr: хост, умерший до ответа,
 * оставляет там единственное объяснение (исключение .NET, код Windows).
 * Прочие отказы остаются как есть.
 */
function withHostStderr(error, lines) {
  if (!lines?.length || error?.message !== "Native engine returned no JSON result.")
    return error;
  const withCause = new Error(`${error.message} (${lines.join(" ").slice(0, 800)})`);
  withCause.cause = error;
  return withCause;
}

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/*
 * Где лежит движок, если вызывающий не сказал. Главный процесс задаёт это при
 * старте (`setNativeContextDefaults`), поток чтения игры — по окружению, которое
 * ему передал главный процесс (`runtime-paths.js`). Без этого путь к движку не
 * строится: в потоке `resourcesPath` пуст, и `path.join` падал словами «путь
 * должен быть строкой» (альфа 41, мастерская «Дым из-под колёс» 20.10).
 */
export function engineLocationDefaults(options = {}) {
  return { packaged: appPackaged(options), resourcesPath: appResourcesPath(options), projectRoot: PROJECT_ROOT };
}

export function resolveNativeExecutable({
  packaged,
  resourcesPath,
  projectRoot,
}) {
  /* Нет корня — нет и кандидатов: не ищем файл относительно текущей папки. */
  const root = packaged ? resourcesPath : projectRoot;
  const candidates = !root
    ? []
    : packaged
      ? [path.join(root, "native", "Modovik.Native.Host.exe")]
      : [
          path.join(root, "native", "publish", "Modovik.Native.Host.exe"),
          path.join(
            root,
            "native",
            "Modovik.Native.Host",
            "bin",
            "Release",
            "net8.0-windows",
            "Modovik.Native.Host.exe",
          ),
        ];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable)
    throw new Error(
      "Astral Native Engine is not built. Run npm run native:publish.",
    );
  return executable;
}

/*
 * КЛЮЧИ И ОЧЕРЕДЬ — ПРАВИЛА МОСТА, А НЕ КАЖДОГО РЕДАКТОРА
 *
 * Два отказа жили в каждом модуле, который читает архивы игры, и каждый
 * модуль закрывал их сам — или забывал.
 *
 * Ключи. Без `--keys` хост ищет их в исполняемом файле игры, а на свежих
 * Steam-сборках не находит: полминуты разбора GTA5.exe и «could not discover
 * the RPF keys». Небо, вода и эффекты помнили про набор ArchiveFix, а
 * килл-эффект — нет, и его раздел не открывался вовсе.
 *
 * Очередь. Хост — свой процесс на каждый вызов, а архив он открывает с правом
 * записи и без совместного доступа: второе чтение того же `update.rpf`
 * внахлёст падает «being used by another process». Килл-эффект читал два
 * файла разом и падал всегда, небо — через раз: база погоды и текстуры неба
 * уходят в игру одновременно.
 */

/* Команды, которым хост расшифровывает архивы набором ключей. */
/* Потолок записи (МБ/с) для команд, которые пишут архивы игры или кэша: из «Хранилища». */
const WRITE_LIMITED_COMMANDS = new Set(["install-rpf-patch", "compose-rpf"]);
let writeLimitMbps = null;
/**
 * Потолок записи в МБ/с; `null` — без потолка. Ставит главный процесс из настроек.
 * Установка, которая сейчас идёт в резидентном движке (`ASTRAL_ENGINE_INSTALL_SERVE=1`), узнаёт
 * новое значение сразу, не дожидаясь следующей: потолок на ходу, ноль — без тормоза.
 */
export function setNativeWriteLimit(value) {
  const mbps = Math.floor(Number(value));
  writeLimitMbps = Number.isFinite(mbps) && mbps > 0 ? mbps : null;
  pushLimitsToRunningInstalls({ writeLimitMbps });
}
export const nativeWriteLimit = () => writeLimitMbps;
/* Потолок записи, который поставил сам режим скорости, — без долей регулятора диска (`disk-governor-follow.js`). Короткие записи (дозапись каталога, экспресс-установка) идут по нему: мод на 9 МБ не ждёт чужой записи на диске — слово владельца 20.11. `null` — режим не ставил (стенды): берётся общий. */
let modeWriteLimitMbps = null;
export function setNativeModeWriteLimit(value) {
  const mbps = Math.floor(Number(value));
  modeWriteLimitMbps = Number.isFinite(mbps) && mbps >= 0 ? mbps : null;
}
export const nativeModeWriteLimit = () => modeWriteLimitMbps;
/* Потолок чтения (МБ/с) тем же командам: подстройка под диск (`disk-profile.js`). У быстрого диска его нет. */
let readLimitMbps = null;
export function setNativeReadLimit(value) {
  const mbps = Math.floor(Number(value));
  readLimitMbps = Number.isFinite(mbps) && mbps > 0 ? mbps : null;
  pushLimitsToRunningInstalls({ readLimitMbps });
}
export const nativeReadLimit = () => readLimitMbps;
/*
 * «Быстрая установка» (13.11.2026): человек снял тормоз с диска. Командам, которые пишут архивы, не ставится фоновый
 * приоритет — ни процессу (`child-priority.js`), ни вводу-выводу внутри движка (`ASTRAL_ENGINE_BACKGROUND_IO=0`, `disk.rs`).
 * Действует на процессы, запущенные после смены: идущему процессу движка режим не сменить.
 */
let fastInstall = false;
export function setNativeFastInstall(enabled) {
  fastInstall = enabled === true;
}
export const nativeFastInstall = () => fastInstall;
const writerEnvironment = (command, env) =>
  fastInstall && WRITE_LIMITED_COMMANDS.has(command) ? { ...env, ASTRAL_ENGINE_BACKGROUND_IO: "0" } : env;
const staysInBackground = (command) => BACKGROUND_COMMANDS.has(command) && !fastInstall;

/*
 * ЖИВЫЕ УСТАНОВКИ В РЕЗИДЕНТНОМ ДВИЖКЕ (этап 1 «установка на Rust»)
 *
 * Установка, которую ведёт резидентный процесс, управляется сообщениями, а не
 * убийством процесса: потолки записи и чтения меняются на ходу, отмена
 * останавливает команду в безопасной точке. Путь включается
 * `ASTRAL_ENGINE_INSTALL_SERVE=1` (по умолчанию выключен) и только если движок
 * сказал `hello` со строками управления; иначе установка идёт процессом на
 * команду, как раньше.
 */
const runningInstalls = new Set();

/* Мегабайты в секунду для строки управления: `null`, ноль и мусор — без потолка (0). */
const controlMbps = (value) => {
  const mbps = Math.floor(Number(value));
  return Number.isFinite(mbps) && mbps > 0 ? mbps : 0;
};

/**
 * Меняет потолки установок, которые идут сейчас в резидентном движке. Не названный потолок не
 * меняется; `null` и 0 — без потолка (запись без тормоза и без фонового приоритета).
 * Ответ — сколько установок движок подтвердил.
 *
 * @param {{writeLimitMbps?: number|null, readLimitMbps?: number|null}} [limits]
 * @returns {Promise<{applied: number, failed: number}>}
 */
export async function changeRunningInstallLimits({ writeLimitMbps: write, readLimitMbps: read } = {}) {
  const message = { control: "limits" };
  if (write !== undefined) message.writeLimitMbps = controlMbps(write);
  if (read !== undefined) message.readLimitMbps = controlMbps(read);
  const running = [...runningInstalls];
  if (running.length === 0 || (message.writeLimitMbps === undefined && message.readLimitMbps === undefined))
    return { applied: 0, failed: 0 };
  const replies = await Promise.allSettled(
    running.map((entry) => entry.service.control({ ...message, target: entry.id })),
  );
  const applied = replies.filter((reply) => reply.status === "fulfilled" && reply.value?.response?.ok === true).length;
  return { applied, failed: replies.length - applied };
}

function pushLimitsToRunningInstalls(limits) {
  pushLimitsToSingles();
  if (runningInstalls.size === 0) return;
  changeRunningInstallLimits(limits).catch(() => {});
}

/*
 * Команды, что идут сейчас процессом на команду: потолок им меняется строкой в stdin (`engine-limits-line.js`), как резидентному движку — сообщением. Регулятор диска опирается на это:
 * без него потолок записи и чтения оставался бы тем, с каким процесс запущен, до конца 30-секундной сборки.
 */
const runningSingles = createLimitsRegistry();
const currentLimitsLine = () => limitsLine(writeLimitMbps, readLimitMbps);
function trackRunningSingle(child, command) {
  if (!WRITE_LIMITED_COMMANDS.has(command)) return;
  runningSingles.track(child, currentLimitsLine());
  /* Команда идёт десятки секунд: датчик регулятора не гасим, пока она не вышла. */
  const letGo = diskGovernor().hold();
  child.once?.("exit", letGo);
}
function pushLimitsToSingles() {
  if (runningSingles.size() > 0) runningSingles.push(currentLimitsLine());
}

/**
 * Отмена всех установок, что идут в резидентном движке, сообщением: команда останавливается в
 * безопасной точке и убирает за собой; не остановилась за `graceMs` — процесс снимается.
 * Установка, подтвердившая отмену, отказывает как отменённая (`AbortError`).
 *
 * @param {{graceMs?: number}} [options]
 * @returns {Promise<{cancelled: number, killed: number}>}
 */
export async function cancelRunningInstalls({ graceMs = CANCEL_GRACE_MS } = {}) {
  const running = [...runningInstalls];
  for (const entry of running) entry.cancelling = true;
  const outcomes = await Promise.all(running.map((entry) => entry.service.cancel(entry.id, { graceMs })));
  return { cancelled: outcomes.length, killed: outcomes.filter((outcome) => outcome.killed).length };
}

/** Сколько установок идёт сейчас в резидентном движке. */
export const runningInstallCount = () => runningInstalls.size;

const KEYED_COMMANDS = new Set([
  "read-archive-file",
  "list-archive-entries",
  "index-archive",
  "extract-archive-entries",
  "extract-sky-textures",
  "extract-cloud-hats",
  "extract-map-tiles",
  "build-map-patch",
  "minimap-tile-colours",
  "paint-minimap-tiles",
  "stack-minimap-tiles",
  "scan-preview-textures",
  "install-rpf-patch",
  "compose-rpf",
  "probe-rpf",
  "search-rpf",
  "extract-rpf",
  "extract-many-rpf",
]);

/*
 * Что команда держит открытым, пока идёт. Команда над папкой игры занимает её
 * целиком: обход текстур и плиток открывает десяток её архивов, а установка
 * переписывает `update.rpf` и не должна встретить читателя посреди записи.
 * Разбираемый архив — редукс или ганпак — занимает только свой файл и
 * пересекается с игрой, лишь когда лежит внутри её папки.
 */
const ARCHIVE_TARGETS = new Map([
  ["read-archive-file", "gameRoot"],
  ["list-archive-entries", "gameRoot"],
  ["extract-sky-textures", "gameRoot"],
  ["extract-cloud-hats", "gameRoot"],
  ["extract-map-tiles", "gameRoot"],
  ["build-map-patch", "gameRoot"],
  ["minimap-tile-colours", "gameRoot"],
  ["paint-minimap-tiles", "gameRoot"],
  ["stack-minimap-tiles", "gameRoot"],
  ["scan-preview-textures", "gameRoot"],
  ["install-rpf-patch", "gameRoot"],
  ["compose-rpf", "baseArchive"],
  ["probe-rpf", "baseArchive"],
  ["search-rpf", "baseArchive"],
  ["extract-rpf", "baseArchive"],
  ["extract-many-rpf", "baseArchive"],
  ["index-archive", "input"],
  ["extract-archive-entries", "input"],
]);

/* Откат узнаёт папку игры из точки восстановления на диске, мосту она не
   видна. Поэтому он ждёт все архивные вызовы разом, а они — его. */
const EVERY_ARCHIVE = "*";

/*
 * Одно место на диске под разными написаниями — всё ещё одно место: регистр
 * Windows не различает, а библиотеку Steam подключают и ссылкой, и короткими
 * именами 8.3. Несуществующий путь сравнивается как написан: хост откажет,
 * ничего не открыв.
 */
function diskPlace(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  let place = path.resolve(text);
  try {
    place = fs.realpathSync.native(place);
  } catch {}
  return place.toLowerCase();
}

function archiveTargets(command, input) {
  if (command === "restore-rpf-point") return [EVERY_ARCHIVE];
  const field = ARCHIVE_TARGETS.get(command);
  const place = field ? diskPlace(input[field]) : null;
  return place ? [place] : [];
}

const within = (inner, outer) =>
  inner === outer ||
  inner.startsWith(outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`);

const overlapping = (left, right) =>
  left.some((one) =>
    right.some(
      (other) =>
        one === EVERY_ARCHIVE ||
        other === EVERY_ARCHIVE ||
        within(one, other) ||
        within(other, one),
    ),
  );

/*
 * Вызов ждёт только тех, кто пришёл раньше и держит пересекающееся место.
 * Порядок так сохраняется, взаимной блокировки не бывает — ждут лишь старших,
 * — а чтение другой установки или скачанного редукса идёт параллельно.
 */
function archiveQueue() {
  const turns = new Set();
  return async function exclusive(targets, task) {
    if (!targets.length) return task();
    const ahead = [...turns]
      .filter((turn) => overlapping(turn.targets, targets))
      .map((turn) => turn.done);
    let release;
    const turn = {
      targets,
      done: new Promise((resolve) => {
        release = resolve;
      }),
    };
    turns.add(turn);
    try {
      await Promise.all(ahead);
      return await task();
    } finally {
      turns.delete(turn);
      release();
    }
  };
}

/*
 * Набор ключей проверяется один раз на процесс: сверка — это SHA-256 полусотни
 * мегабайт, и платить её за каждое чтение незачем. Неудача помнится минуту:
 * без сети поставка набора падает, и пачка чтений не должна штурмовать
 * загрузку по разу на вызов, но позже попробовать снова стоит.
 */
const KEYS_RETRY_MS = 60 * 1000;

function verifiedKeysOnce(resolveKeys) {
  let attempt = null;
  const stale = ({ failedAt }) =>
    failedAt > 0 && Date.now() - failedAt >= KEYS_RETRY_MS;
  return () => {
    if (attempt && !stale(attempt)) return attempt.keys;
    const current = { failedAt: 0, keys: null };
    current.keys = Promise.resolve()
      .then(() => resolveKeys({}))
      .catch(() => undefined)
      .then((directory) => {
        const keys = typeof directory === "string" ? directory.trim() : "";
        if (!keys) current.failedAt = Date.now();
        return keys || undefined;
      });
    attempt = current;
    return current.keys;
  };
}

const absent = (value) => value === undefined || value === null || value === "";

/* Каталог ключей, заданный хосту окружением, — осознанная настройка
   разработчика, и подставленный `--keys` перебил бы её. */
const hostKeysConfigured = () =>
  Boolean(String(process.env.MODOVIK_GTA_KEYS_PATH || "").trim());

/*
 * ХОД ДОЛГИХ КОМАНД
 *
 * Установка патча — это резервная копия `update.rpf` на два гигабайта,
 * пересборка архива и сверка. На живой игре — сорок пять секунд, и всё это
 * время хост молчал: результат он пишет одной строкой в stdout в самом
 * конце. Окно показывало «Подготовка · 0 %» до последней секунды, и человек
 * честно решал, что установка зависла, — хотя она шла.
 *
 * Теперь хост пишет ход в stderr строками `{"progress":{...}}`: шаг и байты
 * этого шага. stdout не трогается — там по-прежнему итог и журнал
 * ArchiveFix, и разбор итога остаётся прежним. Строки хода читаются по мере
 * прихода; всё, что не похоже на ход (трассировка .NET, чужой вывод), молча
 * пропускается — ход не имеет права уронить установку.
 */
/* Ступени «Ухудшения текстур» читают тысячи словарей игры — минуты, ход
   идёт шагом `compose` (словари из всех). */
const PROGRESS_COMMANDS = new Set(["install-rpf-patch", "compose-rpf", "downscale-textures"]);
const PROGRESS_PHASES = new Set([
  "prepare",
  "backup",
  "compose",
  "verify",
  "commit",
]);
const HOST_OUTPUT_LIMIT = 32 * 1024 * 1024;
/* Строка хода короткая; без предела обрыв строки в выводе .NET копил бы
   stderr в памяти целиком. */
const PROGRESS_LINE_LIMIT = 4096;

const hostTimeout = (command) =>
  ["install-rpf-patch", "compose-rpf", "restore-rpf-point", "downscale-textures"].includes(command)
    ? 60 * 60 * 1000
    : 10 * 60 * 1000;

const hostEnvironment = () => ({
  ...process.env,
  DOTNET_ROLL_FORWARD: "Major",
});

const byteCount = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/**
 * Строка хода хоста — или `null`, если это не она.
 *
 * @param {string} line
 * @returns {{phase: string, copiedBytes: number, totalBytes: number, cancellable: boolean}|null}
 */
export function parseNativeProgress(line) {
  const text = String(line || "").trim();
  if (!text.startsWith("{") || text.length > PROGRESS_LINE_LIMIT) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const progress = parsed?.progress;
  if (!progress || typeof progress !== "object") return null;
  const phase = String(progress.phase || "").toLowerCase();
  if (!PROGRESS_PHASES.has(phase)) return null;
  const totalBytes = byteCount(Number(progress.totalBytes));
  return {
    phase,
    copiedBytes: Math.min(
      byteCount(Number(progress.copiedBytes)),
      totalBytes || Infinity,
    ),
    totalBytes,
    /* Подмену файла игры прерывать уже нельзя — это та самая секунда, на
       которой закрытие окна оставило бы полуживой архив. */
    cancellable: phase !== "commit",
  };
}

/*
 * Хост старше приложения: команду, которой он не знает, он называет своей
 * строкой. В поставке хост приходит вместе с приложением — значит, его
 * обновление. Из дерева разработчика (ярлык, `dev:desktop*`) запуск сам
 * пересобирает хост, когда его исходники разошлись со сборкой
 * (`scripts/ensure-native-host.js`), но только при .NET 8 SDK: без него
 * остаётся прежний хост, и это тоже надо сказать.
 */
const UNKNOWN_COMMAND = /Unsupported native command/i;

/*
 * Нет движка Astral (22.11.2026): без `astral-engine.exe` 30 из 85 команд не имеют запасного пути (`HOST_STILL_KNOWS`), и человек видел
 * одну английскую строку, которую окно не переводило. Теперь слова человека — что случилось и что делать, а прежняя английская
 * строка остаётся в скобках: по ней разбирает поддержка и узнают отказ `world-place-engine.js`, `animation-track-engine.js` и тесты.
 * Слова переводит словарь окна (`apps/web/src/locales/ui-text/zone-engine-missing-2211.js`, `{0}` — строка в скобках).
 */
export const ENGINE_MISSING_TEXT = Object.freeze({
  missing:
    "Не найден движок Astral (astral-engine.exe): его могла убрать антивирусная программа. Добавьте папку Astral в исключения " +
    "антивируса и установите Astral заново с сайта. Игра и моды не затронуты.",
  off:
    "Движок Astral выключен, а эта функция работает только на нём. Уберите выключатель ASTRAL_RUST_ENGINE=off и перезапустите Astral.",
  either:
    "Движок Astral выключен или не найден: его могла убрать антивирусная программа. Установите Astral заново с сайта. " +
    "Игра и моды не затронуты.",
});

export function engineMissingError(kind, detail) {
  const error = new Error(`${ENGINE_MISSING_TEXT[kind]} (${detail})`);
  error.code = "ASTRAL_ENGINE_MISSING";
  return error;
}

export function staleHostMessage(detail) {
  return (
    "Движок Astral старше этой функции. Обновите Astral; если он запущен из " +
    "исходников, перезапустите его — запуск сам пересоберёт движок, когда " +
    `установлен .NET 8 SDK. (${detail})`
  );
}

/*
 * Отказ хоста — словами человека, а не строкой Windows.
 *
 * «The process cannot access the file 'update.rpf' because it is being used
 * by another process» — так 23.09.2026 выглядела установка, у которой
 * ArchiveFix не уложился в отведённые секунды: настоящую причину заслонила
 * уборка занятого временного файла. Кто держит файл, человек знает лучше
 * приложения — игра, лаунчер проекта, OpenIV, антивирус над свежим архивом, —
 * поэтому сообщение называет их и просит повторить, а исходная строка
 * остаётся в скобках для разбора.
 */
const ARCHIVE_BUSY =
  /being used by another process|используется другим процессом|занят другим процессом/i;

/*
 * Ключи архивов не нашлись. Хост говорит это по-английски и ничего не знает о
 * том, откуда набор берётся; в окно такой текст не выходит («Операция не
 * удалась» без единого слова о причине). Причина — в памяти поставки: если
 * набор не скачался, человеку нужны его сеть и антивирус, а не «обновите
 * движок».
 */
const KEYS_MISSING =
  /could not discover the RPF keys|RPF key set is incomplete/i;

/*
 * Windows не дал загрузить файл Astral (журнал бета-тестера 14.10.2026).
 *
 * Хост и помощник RPF — .NET-программы: маленький `.exe` запускает
 * управляемый `.dll`. Политика управления приложениями (Smart App Control или
 * правила организации) пропустила `.exe`, а свежесобранный `.dll` без
 * подписи отвергла: «Could not load file or assembly … (0x800711C7)». Хост
 * умирал до первой строки ответа, и человек видел «Native engine returned no
 * JSON result» (мини-карта, 11:40–11:56), а на следующем обновлении — «помощник
 * старше приложения» (13:43–14:06): опрос `--identity` падал так же и
 * читался как «старый помощник». Корень один, и у него одно лечение.
 *
 * Узнаём по коду Windows, а не по её тексту: текст приходит в OEM-кодировке
 * консоли и на русской Windows нечитаем.
 */
const APP_CONTROL_BLOCK =
  /0x800711C7|0x800704EC|0x800704ED|Application Control policy|App Control for Business|Smart App Control|\bspawn\b.*\b(?:UNKNOWN|EACCES|EPERM)\b/i;
const BLOCKED_FILE = /(?:File name:|assembly)\s*'([^']+)'/i;
const ANY_BINARY = /([\w.-]+\.(?:dll|exe))/i;

/** Как называется файл, который не загрузился: по строке исключения, иначе по запасному имени. */
function blockedFileName(raw, fallback) {
  const named = BLOCKED_FILE.exec(raw)?.[1];
  if (named) return path.win32.basename(named);
  return ANY_BINARY.exec(raw)?.[1] || fallback || "Modovik.Native.Host.dll";
}

/**
 * Отказ из-за блокировки Windows — ошибкой со словами и причиной; всё
 * остальное — `null`. Исходная строка остаётся в скобках: по ней окно относит
 * отказ к семейству «Windows блокирует файлы Astral».
 */
export function explainAppControlBlock(error, { file = "" } = {}) {
  const raw = String(error?.message || error || "");
  if (!APP_CONTROL_BLOCK.test(raw)) return null;
  const explained = new Error(
    `Windows заблокировал файл Astral «${blockedFileName(raw, file)}»: политика управления приложениями ` +
      "(Smart App Control или правила организации) не даёт его загрузить. Так бывает с только что обновлёнными файлами. " +
      "Подождите и нажмите «Повторить»; не помогло — выключите Smart App Control («Безопасность Windows» → " +
      "«Управление приложениями и браузером») либо разрешите Astral в антивирусе и перезапустите Astral. " +
      `(${raw.trim().slice(0, 600)})`,
  );
  explained.code = "ASTRAL_APP_CONTROL";
  explained.cause = error;
  return explained;
}

export function explainHostFailure(error) {
  const message = String(error?.message || error || "");
  const blocked = explainAppControlBlock(error);
  if (blocked) return blocked;
  if (UNKNOWN_COMMAND.test(message)) {
    const stale = new Error(staleHostMessage(message));
    stale.code = "ASTRAL_NATIVE_STALE";
    stale.cause = error;
    return stale;
  }
  if (KEYS_MISSING.test(message)) {
    const reason = lastArchiveSupportFailure("read")?.message;
    const explained = new Error(
      "Не найден набор ключей ArchiveFix: без него архивы GTA V не открываются. " +
        (reason
          ? `Astral не смог его получить: ${reason}. Проверьте интернет (нужен доступ к cdn.astral-mods.online), антивирус и повторите. `
          : "Ключи не подошли к этой сборке игры: обновите Astral и повторите. ") +
        `(${message})`,
    );
    explained.code = "ASTRAL_ARCHIVE_KEYS";
    explained.cause = error;
    return explained;
  }
  if (!ARCHIVE_BUSY.test(message)) return error;
  const explained = new Error(
    "Файл игры занят другим процессом — закройте GTA V, лаунчер проекта и " +
      "OpenIV, дайте антивирусу закончить проверку архива и повторите. " +
      `(${message})`,
  );
  explained.code = "ASTRAL_ARCHIVE_LOCKED";
  explained.cause = error;
  return explained;
}

/*
 * Журнал отказов хоста: последние строки его вывода перед итоговым JSON —
 * `[Injector] …`, `[ArchiveFix] …` — единственный след того, на каком шаге
 * встала установка. В окно они не попадают, а сюда ложатся всегда:
 * %LOCALAPPDATA%\Astral\cache\logs\native-host.log, не больше двух мегабайт.
 */
const HOST_LOG_LIMIT = 2 * 1024 * 1024;
const HOST_LOG_TAIL = 40;

/*
 * Прогон тестов (`scripts/test-core.mjs`, 04.11.2026) ставит `ASTRAL_HOST_LOG` — свой файл журнала в своей папке. Причина: тесты зовут движок на выдуманных архивах и
 * ждут отказа; на этом ПК за один `test:core` в настоящий `native-host.log` легло 343 записи (probe-rpf на «неверный идентификатор», read-ypt на «короче заголовка RSC7»),
 * и в выгрузку «Логи» человека (журнал хоста — её источник) шёл шум тестов вперемешку с настоящими отказами. Переменная действует, пока `LOCALAPPDATA` тот, с каким процесс
 * запущен: тест, что подменил `LOCALAPPDATA` на свою папку и читает журнал оттуда, получает его там же, как и прежде. В приложении переменной нет.
 */
const STARTUP_LOCAL_APP_DATA = process.env.LOCALAPPDATA;

function hostLogFile() {
  const root = process.env.LOCALAPPDATA;
  const own = process.env.ASTRAL_HOST_LOG;
  if (own && root === STARTUP_LOCAL_APP_DATA) return own;
  return root ? path.join(root, "Astral", "cache", "logs", "native-host.log") : null;
}

/*
 * Срыв хоста видит и главный процесс: отчёт об ошибке приложения (Т-130)
 * берёт отсюда сообщение и хвост журнала. Подписчик один, и его отказ не
 * должен мешать записи журнала.
 */
let hostFailureListener = null;
export function onHostFailure(listener) {
  hostFailureListener = typeof listener === "function" ? listener : null;
}

/* Журнал приложения (Т-153) — второй подписчик: свой, чтобы не делить отчёты об ошибках. */
const hostFailureWatchers = new Set();
export function watchHostFailures(listener) {
  hostFailureWatchers.add(listener);
  return () => hostFailureWatchers.delete(listener);
}

/** Где лежит журнал нативного хоста (`null` вне Windows). */
export const hostLogPath = () => hostLogFile();

/*
 * Ответ, а не срыв (жалоба тестера 03.11.2026: журнал человека — два [error]
 * на одно открытие большой карты, и оба — нормальная работа):
 *  • «пока на хосте» — движок Rust не берёт запрос, и его тут же повторяет хост
 *    (`runOrRefuse` ниже); срыв — только если откажет и хост;
 *  • «RPF entry not found» у `extract-rpf` — записи в архиве нет: так отвечает
 *    необязательное чтение (`mapzoomdata.meta` в штатном update.rpf, его кладёт
 *    только мод). Что делать без записи, решает вызывающий.
 * Такой ответ остаётся следом в native-host.log, но не идёт ни в журнал
 * приложения ошибкой, ни отчётом в «авто-ошибки».
 */
export function isExpectedEngineAnswer(command, failure) {
  const message = String(failure?.message ?? failure ?? "");
  if (/пока на хосте/u.test(message)) return true;
  return command === "extract-rpf" && /^RPF entry not found:/u.test(message);
}

/*
 * Как отказ Rust-движка попадает в сводку маршрутов. «Пока на хосте» — не сбой: движок сам отдаёт запрос помощнику (опись фонарей
 * `lamp-studio-inspect`, журнал beta.103), и в сводке это откат, а не «ошибка движка». Настоящий отказ остаётся ошибкой с причиной.
 */
export function engineRefusalRoute(command, failure) {
  return isExpectedEngineAnswer(command, failure)
    ? { command, path: "host", rollback: true, reason: "движок: пока на хосте" }
    : { command, path: "rust", failed: true, reason: String(failure?.message ?? failure) };
}

/* Отчёт о срыве хоста — журналу приложения и «авто-ошибкам»; отчёт — побочное дело, его сбой установку не трогает. */
function notifyHostFailure(command, message, tail) {
  for (const listener of [hostFailureListener, ...hostFailureWatchers]) {
    try {
      listener?.({ command, message, tail });
    } catch {
      /* Отчёт — побочное дело: журнал хоста пишется в любом случае. */
    }
  }
}

/*
 * Отказ «ArchiveFix не зашифровал заголовок» (`archivefix-retry.js`) вызов движка повторяет сам: пока впереди повтор, отказ попытки в журнал приложения и в
 * «авто-ошибки» не идёт ошибкой (иначе три `[error]` на одну удавшуюся установку). Знает об этом только вызов под `callNativeEngine`: вне него (прямой хост,
 * тесты) отчёт уходит сразу, как прежде. Хвост вывода хоста остаётся на ошибке (`hostTail`) — его отдаст отказ, когда попытки кончатся.
 */
const archiveFixRetrying = new AsyncLocalStorage();

/* Повтор вызова: журналу приложения — строка «повтор», чтобы в «Логи» было видно, что файл был занят и вызов прошёл не с первого раза. */
const engineRetryWatchers = new Set();
export function watchEngineRetries(listener) {
  engineRetryWatchers.add(listener);
  return () => engineRetryWatchers.delete(listener);
}

async function recordHostFailure(command, args, stdout, failure, stderrLines = []) {
  const expected = isExpectedEngineAnswer(command, failure);
  const tail = [
    ...String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line && !line.startsWith("[Export TRACE]") && !line.startsWith("{"),
      ),
    ...stderrLines,
  ].slice(-HOST_LOG_TAIL);
  const deferred = !expected && archiveFixRetrying.getStore() === true && isArchiveFixNotApplied(failure);
  if (deferred && failure && typeof failure === "object") {
    try {
      failure.hostTail = tail;
    } catch {
      /* Замороженная ошибка: хвост останется только в журнале хоста. */
    }
  }
  if (!expected && !deferred) notifyHostFailure(command, String(failure?.message || failure), tail);
  await appendHostLog(
    [
      `--- ${new Date().toISOString()} ${command}`,
      `args: ${args.join(" ")}`,
      `${expected ? "answer" : "error"}: ${String(failure?.message || failure)}`,
      ...(failure?.engineCode ? [`code: ${failure.engineCode}`] : []),
      ...tail.map((line) => `  ${line}`),
      "",
    ].join("\n"),
  );
}

/* Журнал хоста: дописать запись; перевалило за предел — файл начинается заново. */
async function appendHostLog(entry) {
  const file = hostLogFile();
  if (!file) return;
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const size = await fs.promises
    .stat(file)
    .then((info) => info.size)
    .catch(() => 0);
  if (size > HOST_LOG_LIMIT) await fs.promises.writeFile(file, entry, "utf8");
  else await fs.promises.appendFile(file, entry, "utf8");
}

/* Вызов движка с повтором при «ArchiveFix не зашифровал заголовок»: см. `archivefix-retry.js`. */
export function withArchiveFixRetry(command, context, run, retryOptions = {}) {
  return retryArchiveFixNotApplied(() => archiveFixRetrying.run(true, run), {
    signal: context?.signal || null,
    ...retryOptions,
    onRetry: ({ attempt, of, delayMs, error }) => {
      const message = String(error?.message || error);
      appendHostLog(`--- ${new Date().toISOString()} ${command}\nretry: попытка ${attempt} из ${of} не удалась, следующая через ${delayMs / 1000} с\n`).catch(() => {});
      for (const listener of engineRetryWatchers) {
        try {
          listener({ command, attempt, of, delayMs, message });
        } catch {
          /* Запись о повторе — побочное дело. */
        }
      }
    },
    onGiveUp: (error) => {
      const tail = Array.isArray(error?.hostTail) ? error.hostTail : Array.isArray(error?.cause?.hostTail) ? error.cause.hostTail : [];
      notifyHostFailure(command, String(error?.message || error), tail);
    },
  });
}

/*
 * Запуск хоста с чтением хода. Отличается от `execFile` только тем, что
 * stderr читается построчно по мере прихода; предел вывода, срок и
 * окружение — те же, а итог, как и прежде, берётся из stdout — в том числе
 * при ненулевом коде выхода: отказ хост пишет туда же строкой `ok: false`.
 */
/* Убить процесс вместе с его дочерними (ArchiveFix и прочие): на Windows — `taskkill /T`, иначе сигнал. */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32")
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
  else child.kill("SIGKILL");
}

function runNativeHostStreaming(executable, args, command, onProgress, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortedError(signal));
    const child = spawn(executable, args, {
      windowsHide: true,
      env: writerEnvironment(command, hostEnvironment()),
    });
    /* Запись и сборка архивов — фон: процессор уступается игре и браузеру (`child-priority.js`). */
    if (staysInBackground(command)) lowerBackgroundPriority(child);
    child.stdin?.on("error", () => {});
    trackRunningSingle(child, command);
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      /* Строка отмены — движку (он удаляет свой стейдж); процесс и его дети снимаются сразу:
         отказ окну и остановка записи не ждут движка. Стейдж при отказе убирает вызывающий. */
      child.stdin?.write("cancel\n");
      killTree(child);
      reject(abortedError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    let stdout = "";
    let tail = "";
    let failure = null;
    const fail = (error) => {
      if (failure) return;
      failure = error;
      child.kill();
    };
    const timer = setTimeout(
      () => fail(new Error("Astral Native Engine не ответил вовремя.")),
      hostTimeout(command),
    );
    /* Не ход, а слова хоста: исключение .NET при запуске приходит сюда и
       больше никуда — без него «Native engine returned no JSON result»
       не говорит, что хост умер, не успев начать. */
    const stderrLines = [];
    const readLine = (line) => {
      const progress = parseNativeProgress(line);
      if (!progress) {
        const text = line.trim();
        if (text && !text.startsWith("{") && stderrLines.length < HOST_LOG_TAIL)
          stderrLines.push(text.slice(0, 1000));
        return;
      }
      try {
        onProgress(progress);
      } catch {
        /* Окно могло закрыться между шагами — установка от этого не падает. */
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > HOST_OUTPUT_LIMIT)
        fail(new Error("Astral Native Engine вернул слишком длинный ответ."));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const lines = `${tail}${chunk}`.split(/\r?\n/);
      tail = lines.pop() || "";
      if (tail.length > PROGRESS_LINE_LIMIT) tail = "";
      for (const line of lines) readLine(line);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (aborted) return;
      if (tail) readLine(tail);
      try {
        resolve(parseNativeResult(stdout));
      } catch (error) {
        /* Установка с ходом отказывает так же, как без него: след в журнале
           хоста и объяснение словами человека, а не строкой Windows. */
        const cause = failure || withHostStderr(error, stderrLines);
        /* Ни слова в stdout и код аварии — процесс упал, а не отказал. */
        const crashed = !failure && !stdout.trim() && (Boolean(closeSignal) || (code !== 0 && code !== 1));
        recordHostFailure(command, args, stdout, cause, stderrLines)
          .catch(() => {})
          .then(() => explainFolderDenied(explainHostFailure(cause)))
          .then((explained) => reject(crashed ? Object.assign(explained, { engineCrash: true }) : explained));
      }
    });
  });
}

/* Отмена установки: тот же отказ, что у прежнего помощника (`rpf-composer.js`), без записи в журнал хоста. */
export const abortedError = (signal) =>
  signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Установка отменена пользователем.", "AbortError");

/*
 * Процесс команды умер, не сказав ни слова (`execFile`: нет stdout, код
 * выхода — авария, а не отказ 1; не снят по сроку): падение движка для
 * предохранителя (`engine-crash-guard.js`).
 */
function markEngineCrash(explained, raw) {
  const code = raw?.code;
  const crashed = !raw?.killed && (Boolean(raw?.signal) || (typeof code === "number" && code !== 0 && code !== 1));
  if (crashed && explained && typeof explained === "object") explained.engineCrash = true;
  return explained;
}

export async function executeNativeHost(
  executable,
  args,
  command,
  { onProgress = null, signal = null } = {},
) {
  if (typeof onProgress === "function" && PROGRESS_COMMANDS.has(command))
    return runNativeHostStreaming(executable, args, command, onProgress, signal);
  if (signal?.aborted) throw abortedError(signal);
  let stdout = "";
  let stderr = "";
  try {
    const run = execFileAsync(executable, args, {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: HOST_OUTPUT_LIMIT,
      timeout: hostTimeout(command),
      env: writerEnvironment(command, hostEnvironment()),
      /* Отмена убивает процесс команды: недописанный архив не продолжает писать на диск. */
      signal: signal || undefined,
    });
    /* Запись и сборка архивов — фон: процессор уступается игре и браузеру (`child-priority.js`). */
    if (staysInBackground(command)) lowerBackgroundPriority(run.child);
    trackRunningSingle(run.child, command);
    ({ stdout } = await run);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortedError(signal);
    /* Хост вышел с ошибкой, но успел сказать словами — итог в его выводе.
       Не успел — его слова в самой ошибке (`Command failed: … + stderr`), и
       блокировку Windows (0x800711C7) узнаёт `explainHostFailure`. */
    if (!error.stdout) throw markEngineCrash(explainHostFailure(error), error);
    stdout = error.stdout;
    stderr = String(error.stderr || "");
  }
  try {
    return parseNativeResult(stdout);
  } catch (failure) {
    const stderrLines = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("{"))
      .slice(-HOST_LOG_TAIL);
    const cause = withHostStderr(failure, stderrLines);
    await recordHostFailure(command, args, stdout, cause, stderrLines).catch(
      () => {},
    );
    throw await explainFolderDenied(explainHostFailure(cause));
  }
}

/**
 * Мост к хосту с общими правилами: недостающие ключи подставляются, а вызовы
 * над одним местом на диске идут по очереди.
 *
 * Зависимости приходят параметрами ради тестов: настоящий хост читает архивы
 * игры, а очередь и ключи проверяются без Windows и установленной GTA V.
 */
/*
 * Читающая команда Rust-движка — в резидентный процесс (фаза 2 плана
 * переписи, `rust-engine-service.js`). Процесс умер посреди неё или режим
 * выключен после падений — та же команда идёт процессом на команду: чтение
 * повторять безопасно, а битый файл, который роняет движок, уронит только
 * свой процесс, как и раньше.
 */
async function executeResident(service, executable, args, command, { onProgress, fallback }) {
  let reply;
  try {
    reply = await service.request(executable, args, { onProgress, timeoutMs: hostTimeout(command) });
  } catch (error) {
    if (error?.code === "ENGINE_STOPPED" || error?.code === "ENGINE_UNAVAILABLE") {
      /* Резидентный упал, и та же команда своим процессом тоже упала — это
         она роняет движок, а не соседний запрос: предохранитель засчитает
         оба падения. */
      const residentCrashed = isEngineCrash(error);
      noteRoute({ command, path: "host", rollback: true, reason: `резидентный процесс: ${error?.message || error?.code}` });
      try {
        return await fallback();
      } catch (failure) {
        if (residentCrashed && isEngineCrash(failure) && failure && typeof failure === "object") failure.residentCrashed = true;
        throw failure;
      }
    }
    if (error?.code === "ENGINE_TIMEOUT") throw new Error("Astral Native Engine не ответил вовремя.");
    throw error;
  }
  return parseNativeResult(JSON.stringify(reply?.response ?? null));
}

/*
 * Резидентный движок умеет строки управления и согласен вести установку: он ответил на
 * `hello`, его окружение не разошлось с нынешним, и команда в его списке установок.
 * Всё остальное — установка процессом на команду, как раньше.
 */
async function residentTakesInstall(service, executable, command) {
  if (typeof service?.hello !== "function" || typeof service?.begin !== "function") return false;
  if (!service.available()) return false;
  if (service.envDiffers?.(INSTALL_ENV_KEYS)?.length) return false;
  const info = await service.hello(executable);
  if (!info) return false;
  const controls = Array.isArray(info.controls) ? info.controls : [];
  const installs = Array.isArray(info.installCommands) ? info.installCommands : [];
  return controls.includes("limits") && controls.includes("cancel") && installs.includes(command);
}

/*
 * Установка в резидентном движке. Ход, ответ и отказ — те же, что у процесса на команду
 * (`runNativeHostStreaming`): те же фазы хода, тот же журнал отказов, те же слова человека.
 * Отличия:
 *  • без потолка записи установка идёт без тормоза и без фонового приоритета (строка `limits`
 *    с нулём сразу за запросом); с потолком — он уже в аргументах;
 *  • потолки меняются на ходу (`changeRunningInstallLimits`);
 *  • отмена — сообщение: команда останавливается в безопасной точке и убирает за собой.
 *    Отказ приходит, когда движок ответил; не ответил за `graceMs` — процесс снимается;
 *  • упавший посреди установки резидент установку не повторяет процессом: след поломки остаётся
 *    для восстановления при старте, а повтор поверх него — не наше решение.
 */
async function executeResidentInstall(service, executable, args, command, { onProgress, signal, graceMs }) {
  if (signal?.aborted) throw abortedError(signal);
  const forward =
    typeof onProgress === "function" && PROGRESS_COMMANDS.has(command)
      ? (raw) => {
          const step = parseNativeProgress(JSON.stringify({ progress: raw }));
          if (!step) return;
          try {
            onProgress(step);
          } catch {
            /* Окно могло закрыться между шагами — установка от этого не падает. */
          }
        }
      : null;
  const started = service.begin(executable, args, { onProgress: forward, timeoutMs: hostTimeout(command) });
  if (started.id === null) return started.promise.then((reply) => parseNativeResult(JSON.stringify(reply?.response ?? null)));
  const entry = { service, id: started.id, command };
  runningInstalls.add(entry);
  const letGo = diskGovernor().hold();
  const onAbort = () => {
    entry.cancelling = true;
    service.cancel(started.id, { graceMs }).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  /* Без потолка записи — без тормоза и без фона; строка идёт сразу за запросом, до его разбора. */
  if (writeLimitMbps === null) service.control({ control: "limits", target: started.id, writeLimitMbps: 0 }).catch(() => {});
  try {
    let reply;
    try {
      reply = await started.promise;
    } catch (error) {
      if (signal?.aborted || entry.cancelling) throw abortedError(signal);
      if (error?.code === "ENGINE_TIMEOUT") throw new Error("Astral Native Engine не ответил вовремя.");
      throw error;
    }
    const response = reply?.response ?? null;
    if (response?.ok === false && response.error?.code === "Cancelled") throw abortedError(signal);
    try {
      return parseNativeResult(JSON.stringify(response));
    } catch (failure) {
      const tail = service.logTail?.() ?? { stdout: "", stderr: [] };
      await recordHostFailure(command, args, tail.stdout, failure, tail.stderr).catch(() => {});
      throw await explainFolderDenied(explainHostFailure(failure));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    runningInstalls.delete(entry);
    letGo();
  }
}

/*
 * Команды, у которых хост считает работу после ЛЮБОГО отказа или сбоя движка, кроме отмены человеком: человек ошибки движка не видит, а ошибка самого хоста
 * доходит до него как есть. Остальным хост передаётся только по слову «пока на хосте» (`isExpectedEngineAnswer`). «Ухудшение текстур» — с 16.11.2026;
 * веса тела вещи и метка животного (`skin-from-body`, `patch-animal-model`) — с 18.11.2026: до того отказ движка доходил до человека, хотя хост умеет то же самое.
 * Знаки (`compile-sign-models`) — тоже с 18.11.2026: новые шейдеры движок собирает на каркасе донора (`request-donor.json`), и сбой движка на такой работе
 * («Применить» знаков каптов, расписания, МСЛ, форм зон и надписи) человеку не нужен — хост собирает то же. Запрос с донором хосту по-прежнему не уходит
 * (`donorRequest` ниже): исходный запрос без донора ему отдаёт `compileWithGameDonor`.
 * Залазы (`compile-climb-markers`) — тоже с 18.11.2026: простой запрос без донора движок собрать не может (он отвечает «Метки без донора: пока на хосте»),
 * и сбой процесса на нём («Применить» залазов) человеку не нужен — хост собирает то же.
 */
const HOST_TAKES_ANY_REFUSAL = new Set(["downscale-textures", "skin-from-body", "patch-animal-model", "compile-sign-models", "compile-climb-markers"]);

/* Предохранитель движка: ставит главный процесс (`native-engine-ipc.js`); в
   тестах и скриптах без Electron его нет — команды идут как раньше. */
let engineCrashGuard = null;
export function setEngineCrashGuard(guard) {
  engineCrashGuard = guard || null;
}

export function createNativeEngine({
  locate = resolveNativeExecutable,
  locateRust = resolveRustExecutable,
  rustEnabled = rustEngineEnabled,
  shopRustEnabled = rustShopEnabled,
  splitRustEnabled = rustSplitEnabled,
  graftRustEnabled = rustGraftEnabled,
  skinFromBodyRustEnabled = rustSkinFromBodyEnabled,
  animalModelRustEnabled = rustAnimalModelEnabled,
  restyleRustEnabled = rustRestyleEnabled,
  restyleModelRustEnabled = rustRestyleModelEnabled,
  decorateRustEnabled = rustDecorateEnabled,
  decorateV2RustEnabled = rustDecorateV2Enabled,
  lampRustEnabled = rustLampEnabled,
  poseRustEnabled = rustPoseEnabled,
  timecycleRustEnabled = rustTimecycleEnabled,
  placeTypesRustEnabled = rustPlaceTypesEnabled,
  manifestRustEnabled = rustManifestEnabled,
  placementsRustEnabled = rustPlacementsEnabled,
  gen9RustEnabled = rustGen9Enabled,
  minimapRustEnabled = rustMinimapEnabled,
  paintMinimapRustEnabled = rustPaintMinimapEnabled,
  radarOverlayRustEnabled = rustRadarOverlayEnabled,
  signModelsRustEnabled = rustSignModelsEnabled,
  emblemPlatesRustEnabled = rustEmblemPlatesEnabled,
  megaMallRustEnabled = rustMegaMallEnabled,
  awcInspectRustEnabled = rustAwcInspectEnabled,
  soundImportRustEnabled = rustSoundImportEnabled,
  weaponsMetaRustEnabled = rustWeaponsMetaEnabled,
  lampLodRustEnabled = rustLampLodEnabled,
  lampStudioRustEnabled = rustLampStudioEnabled,
  climbRustEnabled = rustClimbEnabled,
  packRustEnabled = rustPackTexturesEnabled,
  skyRainbowRustEnabled = rustSkyRainbowEnabled,
  starModelRustEnabled = rustStarModelEnabled,
  skyFlyerRustEnabled = rustSkyFlyerEnabled,
  mloModelsRustEnabled = rustMloModelsEnabled,
  mapPatchRustEnabled = rustMapPatchEnabled,
  interiorYtypRustEnabled = rustInteriorYtypEnabled,
  interiorYmapRustEnabled = rustInteriorYmapEnabled,
  minimapInspectRustEnabled = rustMinimapInspectEnabled,
  ycdFromXmlRustEnabled = rustYcdFromXmlEnabled,
  mapFilesRustEnabled = rustMapFilesEnabled,
  interiorLayoutRustEnabled = rustInteriorLayoutEnabled,
  textureLevelsRustEnabled = rustTextureLevelsEnabled,
  downscaleYftRustEnabled = rustDownscaleYftEnabled,
  starClipRustEnabled = rustStarClipEnabled,
  skyClipRustEnabled = rustSkyClipEnabled,
  execute = executeNativeHost,
  archiveKeys = archiveKeysDirectory,
  resident = null,
  residentEnabled = rustServeEnabled,
  installServeEnabled = rustInstallServeEnabled,
  installCancelGraceMs = CANCEL_GRACE_MS,
  crashGuard = () => engineCrashGuard,
} = {}) {
  const exclusive = archiveQueue();
  const verifiedKeys = verifiedKeysOnce(archiveKeys);
  const nativeEngine = async function nativeEngine(command, input, context) {
    /* Где лежит хост, вызывающий может не знать: скины студий передавали
       только ход записи (`{ onProgress }`), и мост падал на пути к хосту
       («The "path" argument must be of type string») — «Применить» скина
       оружия и одежды в приложении не доходило до игры. Место хоста теперь
       задаёт главный процесс при старте (`setNativeContextDefaults`), поток — окружение. */
    const place = { ...engineLocationDefaults(), ...(nativeContextDefaults || {}), ...(context || {}) };
    /* Команды Rust-движка идут ему. Хост ещё умеет только откат точки и чтение
       архивов (`HOST_STILL_KNOWS`): им запасной путь, если движка нет или он
       выключен (`ASTRAL_RUST_ENGINE=off`); остальным без движка ехать некуда. */
    /* Пустой файл типов места движку не из чего собрать — его собирает хост (`placeTypesRequestIsEmpty`). */
    /* «Ухудшение текстур»: фрагменты `.yft` движок берёт только с `ASTRAL_RUST_DOWNSCALE_YFT`, без него запрос с ними считает хост (запрос читается, только если путь включён); `hostOnly` — записи, которые движок отклонил, повторяет хост. */
    const hostOnlyRequest = (command === "compile-place-types" && (await placeTypesRequestIsEmpty(input?.input))) || (command === "downscale-textures" && (context?.hostOnly === true || (textureLevelsRustEnabled() && !downscaleYftRustEnabled() && (await textureLevelsRequestHasFragments(input?.input)))));
    const rustCommand = !hostOnlyRequest && RUST_COMMANDS.has(command) && rustTakesInput(command, input, { textureLevelsEnabled: textureLevelsRustEnabled(), shopEnabled: shopRustEnabled(), splitEnabled: splitRustEnabled(), graftEnabled: graftRustEnabled(), skinFromBodyEnabled: skinFromBodyRustEnabled(), animalModelEnabled: animalModelRustEnabled(), restyleEnabled: restyleRustEnabled(), restyleModelEnabled: restyleModelRustEnabled(), decorateEnabled: decorateRustEnabled(), lampEnabled: lampRustEnabled(), poseEnabled: poseRustEnabled(), timecycleEnabled: timecycleRustEnabled(), placeTypesEnabled: placeTypesRustEnabled(), manifestEnabled: manifestRustEnabled(), placementsEnabled: placementsRustEnabled(), minimapEnabled: minimapRustEnabled(), paintMinimapEnabled: paintMinimapRustEnabled(), radarOverlayEnabled: radarOverlayRustEnabled(), signModelsEnabled: signModelsRustEnabled(), emblemPlatesEnabled: emblemPlatesRustEnabled(), megaMallEnabled: megaMallRustEnabled(), awcInspectEnabled: awcInspectRustEnabled(), soundImportEnabled: soundImportRustEnabled(), weaponsMetaEnabled: weaponsMetaRustEnabled(), lampLodEnabled: lampLodRustEnabled(), lampStudioEnabled: lampStudioRustEnabled(), skyRainbowEnabled: skyRainbowRustEnabled(), starModelEnabled: starModelRustEnabled(), skyFlyerEnabled: skyFlyerRustEnabled(), climbEnabled: climbRustEnabled(), packEnabled: packRustEnabled(), mloModelsEnabled: mloModelsRustEnabled(), mapPatchEnabled: mapPatchRustEnabled(), interiorYtypEnabled: interiorYtypRustEnabled(), interiorYmapEnabled: interiorYmapRustEnabled(), minimapInspectEnabled: minimapInspectRustEnabled(), ycdFromXmlEnabled: ycdFromXmlRustEnabled(), mapFilesEnabled: mapFilesRustEnabled(), interiorLayoutEnabled: interiorLayoutRustEnabled(), gen9Enabled: gen9RustEnabled(), lampRoutes: lampRouteFlags() });
    const rustOn = rustCommand && rustEnabled();
    if (RUST_COMMANDS.has(command))
      noteRoute({
        command,
        path: rustOn ? "rust" : "host",
        reason: rustOn ? "" : rustEnabled() ? "переключатель выключен или вход не для Rust" : "движок выключен (ASTRAL_RUST_ENGINE)",
      });
    const rustExecutable = rustOn ? locateRust(place) : null;
    if (rustCommand && !rustExecutable && !HOST_STILL_KNOWS.has(command))
      throw rustOn
        ? engineMissingError("missing", `Astral engine (astral-engine.exe) is not built; ${command} needs it.`)
        : engineMissingError("off", `Astral engine is switched off (ASTRAL_RUST_ENGINE); ${command} needs it.`);
    const raw = input && typeof input === "object" ? input : {};
    /* Запрос с донором: хост собрал бы его по своей таблице шейдеров, поэтому без движка он не идёт вовсе,
       и отказ движка хосту не передаётся. */
    const donorRequest = isDonorRequestFile(raw.input) || (command === "compile-sign-models" && (await signRequestHasDonor(raw.input))) || (command === "compile-emblem-plates" && (await emblemRequestHasDonor(raw.input))) || (command === "compile-climb-markers" && (await climbRequestHasDonor(raw.input)));
    if (donorRequest && !rustExecutable)
      throw engineMissingError("either", `Astral engine is switched off or not built; ${command} with a donor needs it.`);
    /* Предохранитель (`engine-crash-guard.js`): команда, что дважды уронила
       движок на этих файлах игры, движку больше не идёт — чтение, которое
       умеет прежний хост, идёт ему, остальное отказывает словами. */
    const guard = rustExecutable ? crashGuard() : null;
    const stamp = guard ? engineFilesStamp(raw) : "";
    let guarded = Boolean(stamp);
    let executable = rustExecutable || locate(place);
    if (guarded && guard.blocked(command, stamp)) {
      const host = HOST_STILL_KNOWS.has(command) ? locate(place) : null;
      if (!host) throw engineCrashedError(command);
      noteRoute({ command, path: "host", rollback: true, reason: "предохранитель: движок уронил на этих файлах" });
      executable = host;
      guarded = false;
    }
    // Кривой вход отказывает до поставки ключей и до места в очереди.
    let args = nativeArguments(command, raw);
    if (
      KEYED_COMMANDS.has(command) &&
      absent(raw.keys) &&
      !hostKeysConfigured()
    ) {
      const keys = await verifiedKeys();
      if (keys) args = nativeArguments(command, { ...raw, keys });
    }
    /* Ход идёт туда, куда его просит контекст: главный процесс кладёт в
       контекст рамку записи в игру, и её полоса двигается сама — ни один
       редактор про ход хоста не знает. */
    const onProgress =
      typeof context?.onProgress === "function" ? context.onProgress : null;
    const viaResident =
      Boolean(resident && rustExecutable) &&
      executable === rustExecutable &&
      RUST_SERVE_COMMANDS.has(command) &&
      residentEnabled() &&
      resident.available();
    /* Установка в резидентном процессе — только по выключателю `ASTRAL_ENGINE_INSTALL_SERVE=1` и если движок
       ответил на `hello` строками управления (`residentTakesInstall`); иначе, как и без выключателя, процессом на команду. */
    const installViaResident =
      Boolean(resident && rustExecutable) &&
      executable === rustExecutable &&
      RUST_SERVE_INSTALL_COMMANDS.has(command) &&
      residentEnabled() &&
      installServeEnabled();
    const run = () =>
      exclusive(archiveTargets(command, raw), async () => {
        if (viaResident)
          return executeResident(resident, executable, args, command, {
            onProgress,
            fallback: () => execute(executable, args, command, { onProgress, signal: context?.signal ?? null }),
          });
        if (installViaResident && (await residentTakesInstall(resident, executable, command)))
          return executeResidentInstall(resident, executable, args, command, {
            onProgress,
            signal: context?.signal ?? null,
            graceMs: installCancelGraceMs,
          });
        return execute(executable, args, command, { onProgress, signal: context?.signal ?? null });
      });
    /* Движок отказал словами «пока на хосте» (декорация с частями, своя модель или модель без скина) — такой
       запрос повторяет хост: движок его не берёт, а не ломается. Только для украшений. */
    const runOrRefuse = async () => {
      try {
        return await run();
      } catch (error) {
        /* Украшения оружия версии 2 (`ASTRAL_RUST_DECORATE_V2`, умолчание — выключен): приложение шлёт версию 2 всегда, и на этом пути любой сбой движка, кроме отмены, считает хост — как у соседних команд. */
        const hostTakesAny = HOST_TAKES_ANY_REFUSAL.has(command) || (command === "decorate-drawable" && decorateV2RustEnabled());
        const host = (command === "decorate-drawable" || command === "compile-place-types" || command === "compile-manifest" || command === "compile-placements" || command === "compile-sign-models" || command === "compile-emblem-plates" || command === "compile-climb-markers" || command === "compile-mega-mall-overlay" || command === "pack-textures" || command === "compile-sky-rainbow" || command === "compile-star-model" || command === "compile-sky-flyer" || command === "compile-mlo-models" || command === "paint-minimap-tiles" || command === "build-map-patch" || command === "inspect-interior-ytyp" || command === "inspect-interior-ymap" || command === "inspect-map-files" || command === "inspect-minimap-tiles" || command === "ycd-from-xml" || command === "inspect-map-files" || hostTakesAny) && executable === rustExecutable && !donorRequest ? locate(place) : null;
        /* «Ухудшение текстур», веса тела, метка животного (`HOST_TAKES_ANY_REFUSAL`): любой отказ движка, кроме отмены человеком, считает хост — человек ошибки не видит. Отмена идёт дальше как есть. */
        const cancelled = Boolean(context?.signal?.aborted) || error?.name === "AbortError";
        const handOver = hostTakesAny ? !cancelled : /пока на хосте/u.test(String(error?.message ?? error));
        if (!host || !handOver) {
          if (rustExecutable && executable === rustExecutable) noteRoute(engineRefusalRoute(command, error));
          throw error;
        }
        noteRoute({ command, path: "host", rollback: true, reason: hostTakesAny ? `движок отказал, считал хост: ${String(error?.message ?? error).slice(0, 200)}` : "движок: пока на хосте" });
        return exclusive(archiveTargets(command, raw), () => execute(host, args, command, { onProgress, signal: context?.signal ?? null }));
      }
    };
    if (!guarded) return runOrRefuse();
    try {
      const result = await runOrRefuse();
      guard.cleared(command, stamp);
      return result;
    } catch (error) {
      if (isEngineCrash(error)) {
        guard.struck(command, stamp, error);
        if (error.residentCrashed) guard.struck(command, stamp, error);
      }
      throw error;
    }
  };
  /*
   * Та же очередь для записи, которую делает не хост, а само приложение:
   * библиотека перематывает update.rpf своей копией, и чтение архива хостом
   * посреди подмены файла видело бы половину старого и половину нового.
   */
  nativeEngine.exclusive = (place, task) => {
    const target = diskPlace(place);
    return exclusive(target ? [target] : [], task);
  };
  /*
   * Клип звезды и полёта на Rust поверх ответа хоста (шаги 5–6 YCD, решение координатора 20.10): хост пишет модель и
   * клип. После его успешного ответа клип `<clipDictionary>.ycd` заменяется выходом `compile-star-clip` /
   * `compile-sky-clip`, если переключатель включён и движок на месте. Ошибка движка оставляет клип хоста. Модель
   * `.ydr` остаётся у хоста.
   */
  const clipRoutes = {
    "compile-star-model": { engine: "compile-star-clip", enabled: starClipRustEnabled },
    "compile-sky-flyer": { engine: "compile-sky-clip", enabled: skyClipRustEnabled },
  };
  const overwriteClip = async (command, input, context) => {
    const route = clipRoutes[command];
    if (!route || !route.enabled() || !rustEnabled()) return;
    const request = typeof input?.input === "string" ? input.input : null;
    const output = typeof input?.output === "string" ? input.output : null;
    if (!request || !output) return;
    let spec;
    try {
      spec = JSON.parse(await fs.promises.readFile(request, "utf8"));
    } catch {
      return;
    }
    const clipName = typeof spec?.clipDictionary === "string" ? spec.clipDictionary : null;
    if (!clipName) return;
    if (command === "compile-star-model" && !spec.motion && !spec.uvAnimation) return;
    const place = { ...(nativeContextDefaults || {}), ...(context || {}) };
    const executable = locateRust(place);
    if (!executable) return;
    const target = path.join(output, `${clipName}.ycd`);
    const staged = `${target}.rust-tmp`;
    try {
      await execute(executable, [route.engine, "--input", request, "--output", staged], route.engine, { onProgress: null, signal: context?.signal ?? null });
      await fs.promises.rename(staged, target);
    } catch {
      await fs.promises.rm(staged, { force: true }).catch(() => {});
    }
  };
  const routed = async function nativeEngineRouted(command, input, context) {
    const result = await nativeEngine(command, input, context);
    await overwriteClip(command, input, context);
    return result;
  };
  routed.exclusive = nativeEngine.exclusive;
  return routed;
}

/* Где хост по умолчанию: `{ packaged, resourcesPath, projectRoot }` главного
   процесса. Явный контекст вызова важнее. */
let nativeContextDefaults = null;
export function setNativeContextDefaults(context) {
  nativeContextDefaults = context
    ? {
        packaged: Boolean(context.packaged),
        resourcesPath: context.resourcesPath,
        projectRoot: context.projectRoot,
      }
    : null;
}
/** Что задано сейчас (поток читателя сверяет, что место движка ему передали). */
export function nativeContextDefaultsOf() {
  return nativeContextDefaults ? { ...nativeContextDefaults } : null;
}

/* Мост один на процесс: очередь, заведённая каждым модулем своя, никого ни от
   кого бы не защищала. */
/*
 * HTTP-канал данных движка (`native/astral-engine/.../http.rs`): окно берёт
 * готовые ассеты у движка по `GET /a/<sha256>`, мимо IPC. Токен — на запуск
 * Astral; окну его не дают: заголовок ставит главный процесс на сетевом
 * уровне (`engineAssetsHeaders`). Origin окна и хранилище ассетов задаёт
 * главный процесс, когда они известны (`configureEngineHttp`).
 */
const engineHttpToken = randomBytes(32).toString("hex");
let engineHttp = null;
export function configureEngineHttp({ origin, assetsDir } = {}) {
  engineHttp = origin && assetsDir ? { origin: String(origin).replace(/\/$/, ""), assetsDir: String(assetsDir) } : null;
}
const residentEnvironment = () => ({
  ...hostEnvironment(),
  ...(engineHttp
    ? {
        ASTRAL_ENGINE_HTTP_TOKEN: engineHttpToken,
        ASTRAL_ENGINE_HTTP_ORIGIN: engineHttp.origin,
        ASTRAL_ENGINE_ASSETS_DIR: engineHttp.assetsDir,
      }
    : {}),
});
const sharedResident = createRustEngineService({ env: residentEnvironment });

const engineOrigin = (port) => (port ? `http://127.0.0.1:${port}` : null);

/**
 * Адрес канала данных для окна: `http://127.0.0.1:<порт>` или `null` (движка
 * нет, резидентный режим выключен, канал не настроен). Если процесс ещё не
 * поднят, он поднимается и ждётся до `wait` мс.
 */
export async function engineAssetsOrigin({ wait = 3000, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!engineHttp || !rustServeEnabled() || !rustEngineEnabled()) return null;
  if (sharedResident.httpPort) return engineOrigin(sharedResident.httpPort);
  const executable = resolveRustExecutable(nativeContextDefaults || {});
  if (!executable || !sharedResident.warm(executable)) return null;
  const deadline = now() + wait;
  while (!sharedResident.httpPort && now() < deadline) await sleep(50);
  return engineOrigin(sharedResident.httpPort);
}

/** Заголовок токена — только запросам окна к ассетам живого канала. */
export function engineAssetsHeaders(url) {
  const origin = engineOrigin(sharedResident.httpPort);
  if (!origin || !String(url || "").startsWith(`${origin}/`)) return null;
  /* Любой запрос окна к каналу — работа движка: выход по простою ждёт (`rust-engine-service.js`). */
  sharedResident.touch();
  return engineTokenRoute(String(url).slice(origin.length)) ? { "X-Astral-Engine-Token": engineHttpToken } : null;
}

/** Токен ждут оба маршрута движка: ассеты `/a/` и звуковые банки `/awc/` (`http.rs`); без него `/awc/` отвечал 401 (02.11.2026). */
export const engineTokenRoute = (path) => /^\/(?:a|awc)\//.test(String(path || ""));
const sharedEngine = createNativeEngine({ resident: sharedResident });

/** Выход приложения: резидентный движок доделывает начатое и выходит сам. */
export function stopResidentEngine() {
  sharedResident.stop();
}

/**
 * Спячка окна: рабочий набор процессов Astral — системе (команда движка `trim-memory`, `K32EmptyWorkingSet`). Только
 * Windows; движок без команды (старая сборка) или без файла — `null`, спячка идёт как шла.
 */
export async function trimProcessMemory(pids, { timeoutMs = 10_000 } = {}) {
  const wanted = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (process.platform !== "win32" || !wanted.length) return null;
  const executable = resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaults || {}) });
  if (!executable) return null;
  try {
    /* `--tree yes`: и процессы, которых нет в метриках Electron (обработчик падений), — движок сам находит дерево Astral. */
    const { stdout } = await execFileAsync(executable, ["trim-memory", "--tree", "yes", ...wanted.flatMap((pid) => ["--pid", String(pid)])], {
      windowsHide: true,
      timeout: timeoutMs,
    });
    const reply = JSON.parse(String(stdout).trim().split(/\r?\n/).pop());
    return reply?.ok === false ? null : (reply?.result ?? reply);
  } catch {
    return null;
  }
}

/*
 * Процессы Windows из резидентного движка (`running-processes`, 14.11.2026): снимок за миллисекунды вместо секунды
 * `tasklist` на каждый вопрос «не запущена ли игра». `names` — имена файлов (или `null` — все процессы). Ответ —
 * строки `{ name, pid }`; `null` — спросить не вышло (не Windows, движка нет, резидентный режим выключен, сборка
 * движка без этой команды, отказ): вызывающий идёт запасным путём (`game-processes.js`). Срок запроса большой: по
 * его истечении резидентный процесс снимается целиком, а сам снимок занимает миллисекунды.
 */
let engineKnowsProcesses = true;
export async function engineRunningProcesses(names = null, { timeoutMs = 15_000, service = sharedResident } = {}) {
  if (process.platform !== "win32" || !engineKnowsProcesses || !rustEngineEnabled() || !rustServeEnabled()) return null;
  const executable = resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaults || {}) });
  if (!executable) return null;
  const argv = ["running-processes", ...(Array.isArray(names) ? names : []).flatMap((name) => ["--name", String(name)])];
  let reply;
  try {
    reply = await service.request(executable, argv, { timeoutMs });
  } catch {
    return null;
  }
  const answer = reply?.response;
  const processes = answer?.ok === true && answer.result?.supported === true ? answer.result.processes : null;
  if (!Array.isArray(processes)) {
    /* Прежняя сборка движка команды не знает: до перезапуска приложения больше не спрашиваем. */
    if (answer?.ok === false) engineKnowsProcesses = false;
    return null;
  }
  return processes;
}
setFastProcessLister(engineRunningProcesses);

/*
 * Ключи блока `install`, которые понимает готовый движок (`hello.installKeys`, 19.11.2026): по ним приложение решает,
 * можно ли вести установку в два шага — `hold` → проверка стейджа → `commit` (`INSTALL-RUST-HOLD.md`, раздел 8). Спрашивается
 * у резидентного движка: это тот же файл, что запускается процессом на команду. Пустой список — прежний движок, движка
 * нет, резидентный режим выключен или он не ответил: вызывающий идёт прежним путём установки.
 */
export async function engineInstallKeys({ service = sharedResident } = {}) {
  if (!rustEngineEnabled() || !rustServeEnabled()) return [];
  const executable = resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaults || {}) });
  if (!executable || typeof service?.hello !== "function") return [];
  try {
    const info = await service.hello(executable);
    return Array.isArray(info?.installKeys) ? info.installKeys.map(String) : [];
  } catch {
    return [];
  }
}

/* Спячка окна: резидентный движок выходит (поднимется по первому запросу), пока он занят — спячка ждёт. */
onHibernate("resident-engine", {
  busy: () => (sharedResident.pendingCount ? `движок: запросов ${sharedResident.pendingCount}` : null),
  sleep: () => sharedResident.stop({ planned: true }),
});

/*
 * След вызовов движка для замеров (04.11.2026, `ASTRAL_ENGINE_TRACE=<файл>`): строка JSON на вызов — команда, сколько шла, потолки записи и чтения,
 * время фаз самого движка (`timings`: prepare, apply, write, validate, hash) и сколько байт он собрал. Без переменной — ничего не делает.
 */
function traceEngineCall(command, started, result, failure) {
  const file = process.env.ASTRAL_ENGINE_TRACE;
  if (!file) return;
  try {
    const line = { at: started, ms: Date.now() - started, command, writeLimit: writeLimitMbps, readLimit: readLimitMbps };
    if (result && typeof result === "object") {
      if (result.timings) line.timings = result.timings;
      if (Number.isFinite(result.bytes)) line.bytes = result.bytes;
      /* SHA-256 готового архива (compose-rpf отдаёт его в ответе): сверка режимов выключателей по следу. */
      if (typeof result.sha256 === "string") line.sha256 = result.sha256;
    }
    if (failure) line.error = String(failure?.message || failure).slice(0, 200);
    fs.appendFileSync(file, `${JSON.stringify(line)}
`);
  } catch {
    /* След — удобство замера: сбой записи установку не трогает. */
  }
}

export async function callNativeEngine(command, input, context) {
  const started = Date.now();
  try {
    /* Команды, что заводят или откатывают точки, во время переезда точек отказывают словами (`restore-points-move.js`). */
    const run = () => withArchiveFixRetry(command, context, () => callEngineUnguarded(command, input, context));
    const result = RESTORE_POINT_COMMANDS.has(command) ? await asRestorePointWriter(run) : await run();
    traceEngineCall(command, started, result, null);
    return result;
  } catch (error) {
    traceEngineCall(command, started, null, error);
    throw error;
  }
}

async function callEngineUnguarded(command, input, context) {
  /* Копия точки отката кусками (задача 5 ТЗ 10.10.2026): хост читает файл
     сам — он собирается на прежнем месте до вызова. */
  if (command === "restore-rpf-point" && /^[A-Za-z0-9_-]{1,80}$/.test(String(input?.restorePointId || ""))) {
    const { pointChunksRoot } = await import("./native-restore-chain.js");
    const { materializeRestoreCopy } = await import("./restore-point-chunks.js");
    const directory = path.join(nativeRestorePointsRoot(), input.restorePointId);
    await materializeRestoreCopy({
      backupPath: path.join(directory, "update", "update.rpf"),
      chunksRoot: pointChunksRoot(directory),
    }).catch(() => {});
  }
  /* Архив, который команда читает из кэша, может лежать кусками (`chunk-store.js`). */
  const archiveInput = ARCHIVE_TARGETS.get(command);
  const stored = [input?.baseArchive, archiveInput && archiveInput !== "gameRoot" ? input?.[archiveInput] : null].filter((file) => typeof file === "string" && file);
  if (stored.length) {
    const { ensureStoredFile } = await import("@modovik/install-engine/chunk-store.js");
    for (const file of new Set(stored)) await ensureStoredFile(file);
  }
  return sharedEngine(command, input, context);
}

/** Выполнить запись в архивы игры в общей очереди с нативным хостом. */
export function withGameArchives(gameRoot, task) {
  return sharedEngine.exclusive(gameRoot, task);
}
