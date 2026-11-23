import path from "node:path";
import * as discovery from "@modovik/game-discovery";
import * as attachmentsApi from "@modovik/rpf-inspector/weapon-attachments";
import * as identity from "@modovik/rpf-inspector/weapon-identity";
import * as appLogApi from "./app-log.js";
import * as looksApi from "./attachment-looks.js";
import * as trustApi from "./catalog-trust.js";
import * as partFiles from "./catalog-part-files.js";
import * as partGeometry from "./catalog-part-geometry.js";
import * as indexWarm from "./clothing-index-warm.js";
import * as cards from "./clothing-cards.js";
import * as models from "./clothing-models.js";
import * as packPlace from "./clothing-pack-place.js";
import { majesticGamePath } from "./launcher-game-paths.js";
import * as paint from "./clothing-paint.js";
import * as replace from "./clothing-replace.js";
import * as clothingSkin from "./clothing-skin.js";
import * as readHost from "./game-read-host.js";
import * as orderApi from "./game-clothing-order.js";
import * as clothingItems from "./game-clothing-items.js";
import * as tattoos from "./game-tattoos.js";
import * as gameBeards from "./game-beards.js";
import * as gameBeardsInstall from "./game-beards-install.js";
import * as library from "./gunpack-library.js";
import * as studio from "./gunpack-studio-ipc.js";
import * as safety from "./install-safety.js";
import * as guardApi from "./legacy-runtime-guard.js";
import * as provisioner from "./loader-provisioner.js";
import * as wikiApi from "./majestic-wiki.js";
import * as projects from "./project-clothing.js";
import * as serverClothing from "./server-clothing.js";
import * as serverTattoos from "./server-tattoos.js";
import * as sound from "./sound-studio.js";
import * as tattooPaint from "./tattoo-paint.js";
import * as tattooSet from "./tattoo-set.js";
import * as tattooBody from "./tattoo-body.js";
import * as watchApi from "./weapon-read-watch.js";
import * as icons from "./weapon-icons.js";
import * as verify from "./weapon-skin-verify.js";
import * as weaponSkin from "./weapon-skin.js";

const NO_CATALOG = "Каталог недоступен в этой сборке.";
const REASON_LIMIT = 200;
const FIRST_PACK_DRAWABLE = 2000;
const BASE_FOLDER = /^mp_[mf]_freemode_01(?:_p)?$/;

// Родительный падеж для охранника и подлежащее для отказа.
const KIND_WORDS = new Map([
  ["weapon", ["скина оружия", "Скин оружия"]],
  ["clothing", ["покраски одежды", "Покраска одежды"]],
  ["gunpack", ["ганпака", "Ганпак"]],
  ["clothing-replace", ["замены одежды", "Замена одежды"]],
]);
const DLC_DIALOG = {
  title: "Выберите dlc.rpf ганпака",
  properties: ["openFile"],
  filters: [{ name: "Ганпак", extensions: ["rpf"] }],
};
const SKIN_BUILD = { transfer: true, progressAt: 2 };

// Признак в запросе каталога, который отдаёт его отдельному соседу вместо чтения модели.
const CATALOG_MODES = [
  ["femalePairs", paint.suggestCatalogFemalePairs],
  ["transferPreview", paint.previewClothingTransfer],
];

// Потоки-читатели получают адрес модуля целиком, разрешённый от этого файла.
const moduleAddress = (relative) => new URL(relative, import.meta.url).href;

const sameFolder = (a, b) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Первая причина отказа в записи или null; слово вида ищется, только когда оно нужно.
function gameProblem(game, gamePath, subjectOf) {
  if (!sameFolder(game.path, gamePath)) {
    return "Выбранная папка GTA V не совпадает с найденной установкой Astral.";
  }
  if (String(game.edition || "").toLowerCase() !== "legacy") {
    return `${subjectOf()} ставится только в GTA V Legacy.`;
  }
  if (game.launcherState?.busy) {
    return "Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.";
  }
  return null;
}

export function weaponSkinDependencies({
  targetId,
  onProgress,
  kind = "weapon",
  guard = guardApi.legacyRuntimeGuard(...KIND_WORDS.get(kind)),
  locate = guardApi.findGame,
  nativeContext = null,
}) {
  const hostContext = () => nativeContext;
  return {
    nativeContext,
    assertGameReady: async (gamePath, options = {}) => {
      const mutate = options.mutate;
      const game = await locate(targetId);
      const problem = gameProblem(
        game,
        gamePath,
        () => KIND_WORDS.get(kind)[1],
      );
      if (problem !== null) throw new Error(problem);
      if (mutate) await guard.assertRuntimeSafety(path.resolve(gamePath));
      return game;
    },
    assertRuntimeSafety: safety.assertInstallRuntimeSafe,
    onProgress,
    /* Папка игры в Majestic — для проверки «та же, куда писали» после установки одежды (`clothing-registration-check.js`). */
    readMajestic: majesticGamePath,
    /* Строки об установке одежды (куда легла вещь) — в журнал приложения, раздел «install» (`clothing-write-note.js`). */
    journal: (entry) =>
      appLogApi.appLog.record({ source: "install", ...entry }),
    buildSkin: async (request, stateDir, context) => {
      const { onProgress: progress, ...rest } = context || {};
      const host = readHost.gameReadHostFor(
        moduleAddress("./weapon-skin.js"),
        hostContext,
      );
      const params = { ...SKIN_BUILD, onProgress: progress };
      return host.callWithTools(
        "buildWeaponSkinInThread",
        [request, stateDir, rest],
        null,
        params,
      );
    },
  };
}

const reasonOf = (error) =>
  String(error?.message || error).slice(0, REASON_LIMIT);

// Вещь вики получает место в игре: номер ниже границы паков, папка базовая или число расцветок то же.
function withPlace(item, listFor) {
  const drawable = item.drawable;
  if (!(drawable < FIRST_PACK_DRAWABLE)) return { ...item };
  const place = listFor(item.gender, item.component)?.[drawable];
  /* Номер вещи ранней коллекции игрой не подтверждён целиком — места не даём (`game-clothing-order.js`). */
  if (place?.unconfirmed) return { ...item };
  const fits =
    place &&
    (BASE_FOLDER.test(place.folder) || place.textures === item.textures);
  return fits ? { ...item, place } : { ...item };
}

async function installedGames() {
  try {
    return await discovery.discoverGames();
  } catch {
    return [];
  }
}

async function keysFor(stateDir) {
  try {
    return await provisioner.archiveKeysDirectory({ stateDir });
  } catch {
    return null;
  }
}

/* Где вещь-цель лежит в паке игры (`clothing-pack-place.js`): замена каталога и покраска мастерской ставят штатную вещь и вещь Majestic на месте в паке — маршрут по цели (`clothing-route.js`). */
const packPlaceDeps = (value, stateDir) => {
  const lookup = (find) => async (target) => {
    const keysDirectory = await keysFor(stateDir);
    return find({
      gameRoot: String(value.gameRoot || ""),
      stateDir,
      keysDirectory,
      target,
    });
  };
  return {
    packPlace: lookup(packPlace.findPackPlace),
    gamePlace: lookup(packPlace.findGamePlace),
  };
};

const firstGameRoot = async () =>
  clothingItems.pickGameRoot(await installedGames());

async function readGameOrder(stateDir) {
  const gameRoot = await firstGameRoot();
  if (!gameRoot) return null;
  const keysDirectory = await keysFor(stateDir);
  return orderApi.readGameClothingOrder({ gameRoot, stateDir, keysDirectory });
}

async function trustFields(catalog) {
  const { allowedHosts, allowInsecureLocalhost } = catalog;
  return {
    publicKey: await catalog.publicKey(),
    allowedHosts,
    allowInsecureLocalhost,
  };
}

function withPlaces(wiki, order) {
  const lists = new Map();
  const listFor = (gender, component) => {
    const key = `${gender}|${component}`;
    if (!lists.has(key))
      lists.set(key, orderApi.clothingOrder(order, gender, component));
    return lists.get(key);
  };
  const items = [];
  for (const item of wiki.items) items.push(withPlace(item, listFor));
  return { ...wiki, items };
}

const silencerTarget = (value) => ({
  gameRoot: value.gameRoot,
  targetId: value.targetId || "default",
});
const tattooHost = (context) =>
  readHost.gameReadHostFor(moduleAddress("./server-tattoos.js"), context);

const warnAbout = (label) => (error) =>
  console.warn(`[astral] ${label}: ${error?.message || error}`);

export function registerGunpackIpc(deps) {
  const {
    IPC,
    handleIpc,
    trusted,
    safeInput,
    nativeContext,
    installOptions,
    dialog,
  } = deps;
  const catalogPackages = deps.catalogPackages ?? null;
  const ops = deps.ops ?? null;
  const reads = (address, name, ...options) =>
    readHost.createGameReader(
      moduleAddress(address),
      name,
      nativeContext,
      ...options,
    );
  const toolsOptions = () => ({
    argsOf: (request, context, ...rest) => [request, context, rest.at(-1)],
    toolsAt: [2, "tools"],
  });
  const readWeaponInHands = reads("./weapon-in-hands.js", "readWeaponInHands");
  const readStandingBody = reads("./weapon-in-hands.js", "readStandingBody");
  const readCombatDecals = reads("./combat-decals.js", "readCombatDecals");
  const readGameItemShot = reads(
    "./game-item-shot.js",
    "readGameItemShot",
    toolsOptions(),
  );
  const readBodyZoneShot = reads(
    "./tattoo-body.js",
    "readBodyZoneShot",
    toolsOptions(),
  );
  const readGameItems = reads(
    "./game-clothing-items.js",
    "listGameClothingItemsInThread",
    toolsOptions(),
  );
  // Тесты ищут эти объявления читателей по тексту файла одной строкой — не переносить.
  // prettier-ignore
  const readGameTextureList = reads("./clothing-list-reader.js", "readGameTextureList");
  // prettier-ignore
  const readGameClothingList = reads("./clothing-list-reader.js", "listGameClothing");
  const readGamePairsList = reads("./clothing-list-reader.js", "listGamePairs");
  const readClothingCharacterAhead = reads(
    "./clothing-ahead.js",
    "readClothingCharacterAhead",
    toolsOptions(),
  );
  const warmWearItem = reads(
    "./clothing-ahead.js",
    "warmWearItem",
    toolsOptions(),
  );
  /* «Бороды игры»: запекание бороды-вещи в лист штатной бороды — в потоке чтения, как персонаж (голова и вещь читаются из игры и каталога). */
  const bakeGameBeardRead = reads(
    "./game-beards-bake.js",
    "bakeGameBeard",
    toolsOptions(),
  );

  const weaponReads = watchApi.createWeaponReads({ log: appLogApi.appLog });
  const resolveLooks = looksApi.createLooksResolver({
    installOptions,
    catalogPackages,
  });

  const guarded = (action) => (event, input) =>
    trusted(event, () => action(input));
  const relay = (status) => ops?.report(status);
  const warmClothingReader = (address) =>
    readHost
      .gameReadHostFor(moduleAddress(address), nativeContext)
      .call("warmReader");
  const needCatalog = () => {
    if (!catalogPackages) throw new Error(NO_CATALOG);
  };
  const settleIndex = async () => {
    indexWarm.noteClothingIndexDemand();
    await indexWarm.clothingIndexWarmupSettled();
  };
  const fullTrust = async (catalog, { stateDir, downloadsDir }) => ({
    stateDir,
    downloadsDir,
    ...(await trustFields(catalog)),
  });
  const writeDeps = (value, kind, withContext = false) =>
    weaponSkinDependencies({
      targetId: String(value.targetId || "default"),
      onProgress: relay,
      kind,
      nativeContext: withContext ? nativeContext() : null,
    });
  const optionalTrust = async (wanted) =>
    wanted && catalogPackages ? trustFields(catalogPackages()) : {};
  const stateFolder = async () => (await installOptions()).stateDir;
  const pickGunpack = async () => {
    const answer = await dialog.showOpenDialog(structuredClone(DLC_DIALOG));
    if (answer.canceled) return null;
    return { source: answer.filePaths[0] };
  };

  // Как собирается обращение к соседу: что читается до него и что ему отдаётся.
  const LAUNCHERS = {
    free: (row) => guarded((input) => row.call(input)),
    options: (row) =>
      guarded(async (input) => row.call(input, await installOptions())),
    keys: (row) =>
      guarded(async (input) => {
        const options = await installOptions();
        return row.call(input, options, await keysFor(options.stateDir));
      }),
    value: (row) =>
      guarded(async (input) => {
        const value = safeInput(input);
        return row.call(value, await installOptions());
      }),
    valueKeys: (row) =>
      guarded(async (input) => {
        const value = safeInput(input);
        const options = await installOptions();
        return row.call(value, options, await keysFor(options.stateDir));
      }),
    folder: (row) =>
      guarded(async (input) => {
        const stateDir = await stateFolder();
        return row.call(safeInput(input), stateDir);
      }),
    context: (row) =>
      guarded(async (input) => {
        const stateDir = await stateFolder();
        const value = safeInput(input);
        return row.call(value, nativeContext(), stateDir);
      }),
    catalog: (row) =>
      guarded(async (input) => {
        needCatalog();
        const options = await installOptions();
        const catalog = catalogPackages();
        const extra = row.keyed ? [await keysFor(options.stateDir)] : [];
        const value = safeInput(input);
        const context = nativeContext();
        return row.call(
          value,
          context,
          await fullTrust(catalog, options),
          ...extra,
        );
      }),
    skin: (row) =>
      guarded(async (input) => {
        const value = await resolveLooks(safeInput(input));
        const stateDir = await stateFolder();
        return row.call(value, stateDir, writeDeps(value, row.kind, true));
      }),
  };
  const bind = (rows) => {
    for (const row of rows) handleIpc(IPC[row.key], LAUNCHERS[row.via](row));
  };

  bind([
    {
      key: "WORKSHOP_LIST_GUNPACKS",
      via: "options",
      call: (input, { stateDir }) =>
        library.listGunpacks({}, nativeContext(), stateDir),
    },
    {
      key: "WORKSHOP_READ_WEAPON_ICONS",
      via: "folder",
      call: icons.readWeaponIcons,
    },
    { key: "WORKSHOP_CHOOSE_GUNPACK", via: "free", call: pickGunpack },
    {
      key: "WORKSHOP_IMPORT_GUNPACK",
      via: "context",
      call: library.importGunpack,
    },
    {
      key: "WORKSHOP_GUNPACK_MODEL",
      via: "context",
      call: library.readGunpackModel,
    },
    {
      key: "WORKSHOP_GAME_RUNNING",
      via: "free",
      call: async () => ({
        running: await guardApi.gameProcessRunning({ executable: "GTA5.exe" }),
      }),
    },
    {
      key: "WORKSHOP_GAME_WEAPON_MODEL",
      via: "options",
      call: async (input, { stateDir }) => {
        const request = await resolveLooks(safeInput(input));
        return weaponReads.run(request, async (signal, noteProgress) => {
          const context = nativeContext();
          const onProgress = (status) => {
            noteProgress(status);
            context?.onProgress?.(status);
          };
          return weaponSkin.readGameWeaponModel(
            request,
            { ...context, onProgress },
            stateDir,
            { signal },
          );
        });
      },
    },
    {
      key: "WORKSHOP_VERIFY_WEAPON_SKIN",
      via: "context",
      call: verify.verifyWeaponSkin,
    },
    {
      key: "WORKSHOP_GAME_WEAPON_IN_HANDS",
      via: "folder",
      call: readWeaponInHands,
    },
    {
      key: "WORKSHOP_GAME_STANDING_BODY",
      via: "folder",
      call: readStandingBody,
    },
    {
      key: "WORKSHOP_GAME_COMBAT_DECALS",
      via: "folder",
      call: readCombatDecals,
    },
  ]);

  handleIpc(IPC.WORKSHOP_GAME_CLOTHING_LIST, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      if (value?.warm) {
        await warmClothingReader("./clothing-list-reader.js");
        return { warm: true };
      }
      const { stateDir } = await installOptions();
      if (value?.slot === "tattoos") return tattooBody.listTattooBody(value);
      await settleIndex();
      return value?.pairs
        ? readGamePairsList(value, stateDir)
        : readGameClothingList(value, stateDir);
    }),
  );

  handleIpc(IPC.CLOTHING_GAME_TATTOOS, (event, input) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      const keysDirectory = await keysFor(stateDir);
      const gameRoot = String(safeInput(input)?.gameRoot || "");
      const found = await tattoos.readGameTattoos({
        gameRoot,
        stateDir,
        keysDirectory,
      });
      return { tattoos: found.tattoos };
    }),
  );

  bind([
    {
      key: "CLOTHING_GAME_TATTOO_PICTURE",
      via: "keys",
      call: (input, { stateDir }, keysDirectory) =>
        tattoos.readGameTattooPicture(safeInput(input), {
          stateDir,
          keysDirectory,
        }),
    },
    {
      key: "CLOTHING_GAME_BEARDS",
      via: "keys",
      call: async (input, { stateDir }, keysDirectory) => {
        const found = await gameBeards.readGameBeards({
          gameRoot: String(safeInput(input)?.gameRoot || ""),
          stateDir,
          keysDirectory,
        });
        return { version: found.version, beards: found.beards };
      },
    },
    {
      key: "CLOTHING_GAME_BEARD_PICTURE",
      via: "keys",
      call: (input, { stateDir }, keysDirectory) =>
        gameBeards.readGameBeardPicture(safeInput(input), {
          stateDir,
          keysDirectory,
        }),
    },
    {
      key: "CLOTHING_CATALOG_TATTOO_PICTURES",
      via: "catalog",
      call: tattoos.readCatalogTattooPictures,
    },
    {
      key: "CATALOG_PART_FILES",
      via: "catalog",
      call: partFiles.readCatalogPartFiles,
    },
    {
      key: "CATALOG_PART_GEOMETRY",
      via: "catalog",
      keyed: true,
      call: (value, context, trust, keysDirectory) =>
        partGeometry.readCatalogPartGeometry(value, context, {
          ...trust,
          keysDirectory,
        }),
    },
    {
      key: "CLOTHING_SERVER_LIST",
      via: "keys",
      call: async (input, { stateDir }, keysDirectory) => {
        const servers = await serverClothing.listServerClothing({
          stateDir,
          keysDirectory,
        });
        return {
          ...servers,
          tattooApply: serverTattoos.serverTattooApplyEnabled(),
        };
      },
    },
    {
      key: "CLOTHING_GAME_ITEMS",
      via: "options",
      call: async (input, { stateDir }) => {
        const gameRoot = await firstGameRoot();
        if (!gameRoot) return { status: "no-game", rows: [] };
        await settleIndex();
        try {
          return await readGameItems({ gameRoot }, stateDir, { stateDir });
        } catch (error) {
          return { status: "unreadable", reason: reasonOf(error), rows: [] };
        }
      },
    },
    {
      key: "CLOTHING_SERVER_TATTOO_MODEL",
      via: "keys",
      call: (input, options, keysDirectory) => {
        const args = [safeInput(input), { keysDirectory }];
        return tattooHost(nativeContext).callWithTools(
          "readServerTattooModel",
          args,
          null,
          { transfer: true },
        );
      },
    },
    {
      key: "CLOTHING_MAJESTIC_WIKI",
      via: "options",
      call: async (input, { stateDir }) => {
        const wiki = await wikiApi.readMajesticWiki(safeInput(input), {
          stateDir,
        });
        if (!wiki?.items || wiki.items.length === 0) return wiki;
        const order = await readGameOrder(stateDir).catch(() => null);
        return order ? withPlaces(wiki, order) : wiki;
      },
    },
    {
      key: "CLOTHING_PROJECT_ITEMS",
      via: "options",
      call: (input, { stateDir }) =>
        projects.readProjectClothing(safeInput(input), {
          stateDir,
          order: () => readGameOrder(stateDir),
        }),
    },
    {
      key: "CLOTHING_PROJECT_PICTURE",
      via: "options",
      call: (input, { stateDir }) =>
        projects.readProjectPicture(safeInput(input), { stateDir }),
    },
  ]);

  handleIpc(IPC.WORKSHOP_GAME_CLOTHING_MODEL, (event, input) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      const value = safeInput(input);
      if (value?.card)
        return cards.readClothingCard(value, nativeContext(), stateDir);
      if (value?.itemShot)
        return readGameItemShot(value, stateDir, { stateDir });
      if (value?.bodyZoneShot)
        return readBodyZoneShot(value, stateDir, { stateDir });
      if (value?.textureList) return readGameTextureList(value, stateDir);
      if (value?.transferPreview)
        return paint.previewClothingTransfer(value, stateDir, {});
      if (value?.slot === "tattoos")
        return tattooBody.readTattooBody(value, nativeContext(), { stateDir });
      return models.readGameClothingModel(value, nativeContext(), stateDir);
    }),
  );

  bind([
    {
      key: "WORKSHOP_CATALOG_CLOTHING_MODEL",
      via: "free",
      call: async (input) => {
        needCatalog();
        const options = await installOptions();
        const catalog = catalogPackages();
        const value = safeInput(input);
        const trust = await fullTrust(catalog, options);
        const mode = CATALOG_MODES.find(([flag]) => value[flag]);
        if (mode) return mode[1](value, options.stateDir, trust);
        return models.readCatalogClothingModel(value, nativeContext(), trust);
      },
    },
  ]);

  handleIpc(IPC.CLOTHING_GAME_BEARD_BAKE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const options = await installOptions();
      const fromCatalog = trustApi.usesCatalogPackages(value);
      if (fromCatalog && !catalogPackages) throw new Error(NO_CATALOG);
      const extra = fromCatalog
        ? await fullTrust(catalogPackages(), options)
        : { stateDir: options.stateDir, downloadsDir: options.downloadsDir };
      return bakeGameBeardRead(value, options.stateDir, extra);
    }),
  );

  handleIpc(IPC.WORKSHOP_CLOTHING_CHARACTER, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      if (value?.warm) {
        await warmClothingReader("./clothing-ahead.js");
        /* Тело и «одеть» заранее (15.11.2026): человек идёт в мастерскую одежды — файлы тела, скелет, дорожка и готовые GLB собираются в потоке, пока он нажимает. Не ждём: ответ окну — сразу. */
        void (async () => {
          const { stateDir } = await installOptions();
          const gameRoot = String(value.gameRoot || "") || (await firstGameRoot());
          if (gameRoot) await indexWarm.warmWearBase({ gameRoot, stateDir, nativeContext, look: value.look });
        })().catch(() => {});
        return { warm: true };
      }
      const options = await installOptions();
      /* Оглавление игры нужно, только когда в запросе есть вещь игры: тело без вещей и «одеть» без надетого не ждут прогрев, что строит его 94 архивами (15.11.2026). */
      if (indexWarm.requestNeedsIndex(value)) await settleIndex();
      const fromCatalog = trustApi.usesCatalogPackages(value);
      if (fromCatalog && !catalogPackages) throw new Error(NO_CATALOG);
      const extra = fromCatalog
        ? await fullTrust(catalogPackages(), options)
        : { stateDir: options.stateDir, downloadsDir: options.downloadsDir };
      const read = value.warmItem ? warmWearItem : readClothingCharacterAhead;
      return read(value, options.stateDir, extra);
    }),
  );

  bind([
    {
      key: "WORKSHOP_APPLY_WEAPON_SKIN",
      via: "skin",
      kind: "weapon",
      call: async (value, stateDir, deps) => {
        const result = await weaponSkin.applyWeaponSkin(value, stateDir, deps);
        const weaponId = identity.weaponByModel(value.model)?.id;
        if (!weaponId) return result;
        const attached = attachmentsApi.resolveAttachments(
          weaponId,
          value.attachments,
        );
        const embedded = attached.some((one) => one.component?.kind === "supp");
        const link = {
          ...silencerTarget(value),
          weapon: weaponId,
          embedded,
          skinModId: result.modId,
        };
        await sound
          .syncWeaponSilencerLink(link, stateDir)
          .catch(warnAbout("Звук глушителя не применился"));
        return result;
      },
    },
    {
      key: "WORKSHOP_REMOVE_WEAPON_SKIN",
      via: "skin",
      kind: "weapon",
      call: async (value, stateDir, deps) => {
        const result = await weaponSkin.removeWeaponSkin(value, stateDir, deps);
        const link = { ...silencerTarget(value), modId: value.modId };
        await sound
          .forgetSkinSilencerLinks(link, stateDir)
          .catch(warnAbout("Звук глушителя не снялся"));
        return result;
      },
    },
    {
      key: "WORKSHOP_APPLY_CLOTHING_SKIN",
      via: "value",
      call: async (value, { stateDir, downloadsDir }) => {
        const deps = writeDeps(value, "clothing");
        if (!Array.isArray(value.targets))
          return clothingSkin.applyClothingSkin(value, stateDir, deps);
        const trust = await optionalTrust(value.source?.kind === "catalog");
        /* Покраска на вещь Majestic и на штатную вещь ложится в пак игры, где вещь лежит: без места в паке (`packPlace`) она отказывала «Не удалось найти вещь в файлах игры» (разбор 14.11.2026). */
        return paint.applyClothingPaint(value, stateDir, {
          ...deps,
          ...packPlaceDeps(value, stateDir),
          downloadsDir,
          ...trust,
        });
      },
    },
    {
      key: "WORKSHOP_REMOVE_CLOTHING_SKIN",
      via: "skin",
      kind: "clothing",
      call: clothingSkin.removeClothingSkin,
    },
    {
      key: "WORKSHOP_APPLY_TATTOO_PAINT",
      via: "valueKeys",
      call: async (value, { stateDir, downloadsDir }, keysDirectory) => {
        const deps = { ...writeDeps(value, "clothing"), keysDirectory };
        if (!value.tattooSet)
          return tattooPaint.applyTattooPaint(value, stateDir, deps);
        needCatalog();
        const trust = await trustFields(catalogPackages());
        return tattooSet.applyTattooSet(value, stateDir, {
          ...deps,
          downloadsDir,
          ...trust,
        });
      },
    },
    {
      /* «Бороды игры»: лист бороды (PNG из окна, base64) пакетом Astral Clothing DLC, как покраска тату. Снимается тем же «Снять из игры» (`WORKSHOP_REMOVE_CLOTHING_SKIN`, `local-tattoo-paint-*`). */
      key: "WORKSHOP_APPLY_GAME_BEARD",
      via: "valueKeys",
      call: (value, { stateDir }, keysDirectory) =>
        gameBeardsInstall.installGameBeard(value, stateDir, {
          ...writeDeps(value, "clothing"),
          keysDirectory,
        }),
    },
    {
      key: "WORKSHOP_APPLY_SERVER_TATTOO",
      via: "valueKeys",
      call: (value, { stateDir }, keysDirectory) => {
        const buildPackage = (request, packStateDir) =>
          tattooHost(() => nativeContext).callWithTools(
            "buildServerTattooPackageInThread",
            [request, packStateDir, { keysDirectory }],
            null,
          );
        return serverTattoos.applyServerTattoo(value, stateDir, {
          ...writeDeps(value, "clothing"),
          keysDirectory,
          buildPackage,
        });
      },
    },
  ]);

  const gameAttachmentFiles = (request, stateDir) =>
    weaponSkin.readGameAttachmentFiles(
      { ...request, context: nativeContext() },
      stateDir,
    );
  const writeDependencies = (targetId) =>
    weaponSkinDependencies({ targetId, onProgress: relay, kind: "gunpack" });
  studio.registerGunpackStudioIpc({
    IPC,
    handleIpc,
    trusted,
    safeInput,
    installOptions,
    dialog,
    catalogPackages,
    gameAttachmentFiles,
    writeDependencies,
  });

  bind([
    {
      key: "CLOTHING_REPLACE_APPLY",
      via: "free",
      call: async (input) => {
        needCatalog();
        const value = safeInput(input);
        const { stateDir, downloadsDir } = await installOptions();
        const catalog = catalogPackages();
        const deps = writeDeps(value, "clothing-replace");
        const trust = await trustFields(catalog);
        return replace.applyClothingReplacement(value, stateDir, {
          ...deps,
          ...packPlaceDeps(value, stateDir),
          downloadsDir,
          ...trust,
        });
      },
    },
  ]);
}
