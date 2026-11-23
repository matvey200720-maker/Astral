import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  UPDATE_ARCHIVE,
  requireGameRoot,
  resolveGameScaleformBase,
} from "./game-scaleform-base.js";
import {
  RETICLE_GFX_ENTRY,
  RETICLE_YTD_ENTRY,
  buildReticlePatch,
  verifyReticleBase,
} from "./reticle-gfx-compiler.js";
import { inspectKillMarkerGfx, stripKillMarkerGfx } from "./kill-marker-gfx.js";
import {
  registerPatchRecomposer,
  writeRecomposeSidecar,
} from "./patch-recompose.js";
import { extractRpfEntries, searchRpfArchive } from "./rpf-composer.js";
import {
  AMMO_HUD_STAGE,
  RETICLE_STAGE,
  activeWeaponReticles,
  ammoCounterLayout,
  damageCounterScale,
  normalizeAmmoCounter,
  normalizeDamageCounter,
  normalizeReloadIndicator,
  ordinaryReticleLayers,
  sniperReticleLayers,
} from "@modovik/reticle-contract";
import { buildReconcileRecord } from "@modovik/minimap-contract/reconcile";
import {
  HUD_GFX_ENTRY,
  HUD_GFX_TARGET,
  compileHudAmmoGfx,
  compileHudReloadGfx,
  hudHasAstralAmmo,
  hudHasAstralReload,
  verifyHudAmmoBase,
} from "./hud-ammo-gfx-compiler.js";
import {
  engineVerifyFacts,
  patchWrittenFiles,
  pixelsPerStagePoint,
  rawGameScreenOf,
  reconcileOrigin,
  safeReconcile,
} from "./hud-reconcile.js";
import {
  reticleHasWeaponLooks,
  resolveReticleWeapons,
} from "./reticle-weapons.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { reloadTimesForGame } from "./reticle-reload-files.js";
import { readRpfEntriesWithRpf7 } from "./rpf7-entries.js";
import { callNativeEngine } from "./native-engine.js";

/*
 * Прицел собирается поверх hud_reticle.gfx самого игрока.
 *
 * Раньше база лежала в приложении (`runtime/gfx-inspection/combined.gfx`, в
 * сборке — `resources/reticle/combined.gfx`), была чужой пересборкой штатного
 * файла и пришита хешем, а план даже не получал папку игры. На настоящей игре
 * компилятор не находил в ней своих мест, и прицел не собирался. Теперь
 * hud_reticle.gfx достаётся из `update.rpf` той игры, в которую ляжет пакет,
 * и проверяется сборкой, а не хешем.
 *
 * Порядок доверия (живой архив → резервная копия Astral → память) и память
 * проверенной базы у прицела общие с мини-картой — `game-scaleform-base.js`.
 */
const SCALEFORM_GENERIC = "x64/data/cdimages/scaleform_generic.rpf";

const RETICLE_BASE = Object.freeze({
  memory: "reticle-bases",
  files: Object.freeze([
    { key: "gfx", entry: RETICLE_GFX_ENTRY, extension: "gfx" },
  ]),
  /* Прицел — или весь scaleform_generic.rpf — из каталога это чужой мод, а не
     игра: тогда база берётся сперва из резервной копии. */
  catalogOwns: (entry) =>
    entry === SCALEFORM_GENERIC ||
    entry.startsWith(`${SCALEFORM_GENERIC}/hud_reticle`),
  /* Знак на килле ставит килл-эффект: база прицела — файл без него, а сам
     знак переносится в сборку из живого файла (`liveKillMarker`). */
  prepare: ({ gfx }) => ({ gfx: stripKillMarkerGfx(gfx) }),
  verify: ({ gfx }) => verifyReticleBase(gfx),
  memoryLabel: "проверенный ранее прицел этой игры",
  missing: "в архиве нет hud_reticle.gfx",
  notFound:
    "Не удалось найти штатный прицел игры, поверх которого собирается твой.",
});

/*
 * Счётчик патронов (задача 12 ТЗ 10.10.2026) — блок оружия в hud.gfx той же
 * игры (`hud-ammo-gfx-compiler.js`), тем же порядком доверия. Каталогу он
 * не «принадлежит»: чужой hud.gfx (карта из каталога) — тоже основа, счётчик
 * ложится поверх неё, а не стирает её правки. Свой счётчик основой не бывает
 * — такой файл проверка отвергает, и база берётся из резервной копии.
 */
const HUD_BASE = Object.freeze({
  memory: "hud-bases",
  files: Object.freeze([
    { key: "gfx", entry: HUD_GFX_ENTRY, extension: "gfx" },
  ]),
  catalogOwns: () => false,
  verify: ({ gfx }) => verifyHudAmmoBase(gfx),
  memoryLabel: "проверенный ранее hud.gfx этой игры",
  missing: "в архиве нет hud.gfx",
  notFound:
    "Не удалось найти штатный hud.gfx игры, поверх которого собирается счётчик патронов.",
});

/*
 * Полоска HP над игроком (mp_gamer_info.gfx) утром 11.10.2026 ехала этим же
 * пакетом, а днём стала своим редактором «Полоска HP»
 * (`target-hp-customizer.js`). Прицел метку игрока больше не читает и не
 * пишет — иначе его «Применить» стирало бы полоску того редактора.
 */

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
});

function boundedConfiguration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Reticle configuration is required.");
  const serialized = JSON.stringify(input);
  /* Свои прицелы стволов (до 64) — по килобайту настроек каждый. */
  if (Buffer.byteLength(serialized, "utf8") > 512 * 1024)
    throw new RangeError("Reticle configuration exceeds 512 KB.");
  return JSON.parse(serialized);
}

/**
 * Штатный hud_reticle.gfx этой игры — путь к проверенной копии.
 * `tools` заменяют распаковку и состояние в тестах; в бою это функции
 * приложения.
 */
export async function resolveReticleBase({ gameRoot, stateDir }, tools = {}) {
  return resolveGameScaleformBase({ gameRoot, stateDir }, RETICLE_BASE, tools);
}

const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

const LIVE_ENTRIES = Object.freeze([
  RETICLE_GFX_ENTRY,
  RETICLE_YTD_ENTRY,
  HUD_GFX_ENTRY,
]);

/*
 * Те же записи — читателем @modovik/rpf7 (`rpf7-entries.js`): после
 * установки прицела нативный хост пересобирает scaleform_generic.rpf, и
 * нетронутые записи в нём (hud.gfx) помощник RPF больше не раздувает.
 * Второе «Применить» прицела не падает на чтении игры.
 */
const readLiveWithRpf7 = readRpfEntriesWithRpf7;

/*
 * hud_reticle.gfx и его словарь, что лежат в игре сейчас. Нет архива или
 * файла — `null`.
 */
async function liveReticleFiles(gameRoot, stateDir, tools) {
  const extract = tools.extract || extractRpfEntries;
  const archivePath = path.join(gameRoot, "update", "update.rpf");
  if (!(await fs.stat(archivePath).catch(() => null))) return null;
  const directory = path.join(
    stateDir,
    "reticle-bases",
    `live-${randomUUID()}`,
  );
  try {
    const request = {
      archivePath,
      archiveTarget: UPDATE_ARCHIVE,
      entries: [...LIVE_ENTRIES],
      outputDirectory: directory,
      gameRoot,
      edition: "Legacy",
    };
    const result = await extract(request).catch(async (error) => {
      const fallback =
        tools.readArchive || (tools.extract ? null : readLiveWithRpf7);
      if (!fallback) throw error;
      return fallback({
        ...request,
        outputDirectory: path.join(directory, "rpf7"),
      }).catch(() => {
        throw error;
      });
    });
    const files = new Map(
      (result?.extracted || []).map((item) => [
        normalizeEntry(item.entry),
        item.output,
      ]),
    );
    const gfxFile = files.get(RETICLE_GFX_ENTRY);
    if (!gfxFile) return null;
    const ytdFile = files.get(RETICLE_YTD_ENTRY);
    const hudFile = files.get(HUD_GFX_ENTRY);
    return {
      gfx: await fs.readFile(gfxFile),
      ytd: ytdFile ? await fs.readFile(ytdFile) : null,
      hud: hudFile ? await fs.readFile(hudFile) : null,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Знак на килле, который стоит в игре сейчас (его ставит килл-эффект в тот же
 * hud_reticle.gfx). Прицел собирается поверх штатного файла, и знак
 * переносится в сборку из живого — иначе «Применить» прицела его стирало бы.
 * Нет знака, нет архива, файл чужой и неразборчивый — переносить нечего.
 */
function liveKillMarker(live) {
  if (!live?.gfx) return null;
  try {
    if (!inspectKillMarkerGfx(live.gfx).installed) return null;
  } catch {
    return null;
  }
  return live;
}

/*
 * Свои прицелы стволов (задача 4 ТЗ 07.10.2026): что поменять в файлах
 * оружия игры (`reticle-weapons.js`). Файлы оружия читаются, когда есть что
 * ставить или в игре стоит прицел с рисунками стволов — тогда стволам,
 * выпавшим из набора, возвращается штатный прицел.
 */
async function weaponReticlePlan(
  { gameRoot, configuration, live },
  stateDir,
  tools,
) {
  const staging = path.join(
    stateDir,
    "reticle-bases",
    `weapons-${randomUUID()}`,
  );
  try {
    return await resolveReticleWeapons(
      {
        gameRoot,
        weapons: activeWeaponReticles(configuration.ordinary),
        scanAll: reticleHasWeaponLooks(live?.gfx),
        staging,
        damage: normalizeDamageCounter(configuration.damage),
      },
      {
        searchArchive: tools.search || searchRpfArchive,
        extractMany: tools.extract || extractRpfEntries,
      },
    );
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * hud.gfx пакета: со счётчиком патронов и (или) перехватом для индикатора
 * перезарядки (`compileHudReloadGfx`) — когда они включены; штатный — когда
 * оба выключены, а в игре стоит прежний hud.gfx этой работы (иначе он
 * остался бы после «Применить» без них); иначе hud.gfx не трогается.
 */
const liveHasAstralHud = (live) => {
  if (!live?.hud) return false;
  try {
    return hudHasAstralAmmo(live.hud) || hudHasAstralReload(live.hud);
  } catch {
    return false;
  }
};

async function ammoHud({ gameRoot, configuration, live }, stateDir, tools) {
  const counter = normalizeAmmoCounter(configuration.ammo);
  const reload = normalizeReloadIndicator(configuration.reload);
  const installed = liveHasAstralHud(live);
  if (!counter.enabled && !reload.enabled && !installed)
    return { gfx: null, counter, reload, restored: false, file: null };
  const base = await resolveGameScaleformBase(
    { gameRoot, stateDir },
    HUD_BASE,
    tools,
  );
  const stock = await fs.readFile(base.gfxFile);
  if (!counter.enabled && !reload.enabled)
    return { gfx: stock, counter, reload, restored: true, file: null };
  const compiled = counter.enabled ? compileHudAmmoGfx(stock, counter) : null;
  const withAmmo = compiled ? compiled.buffer : stock;
  /* Перехват перезарядки ставится последним — поверх счётчика или штатного блока. */
  const gfx = reload.enabled ? compileHudReloadGfx(withAmmo).buffer : withAmmo;
  /* `file` — числа блока, что компилятор поставил в hud.gfx: их и пишет запись сверки. */
  return {
    gfx,
    counter,
    reload,
    restored: false,
    file: compiled ? compiled.file : null,
  };
}

/*
 * Длительности перезарядки стволов из файлов игры (`reticle-reload-files.js`) — только когда индикатор включён.
 * Не прочиталось — пустая таблица: у стволов нет заливки по ходу, есть дозаливка в конце (честная запасная ветка),
 * а установка прицела не падает. `tools.reloadTimes` заменяет чтение в тестах.
 */
async function reloadTimesPlan({ gameRoot, configuration }, stateDir, tools) {
  if (!normalizeReloadIndicator(configuration.reload).enabled) return null;
  try {
    if (tools.reloadTimes) return await tools.reloadTimes({ gameRoot });
    const support = await (tools.archiveSupport || provisionArchiveSupport)({
      stateDir,
    });
    const keys = await keysFromDirectory(support.directory);
    return await reloadTimesForGame({ gameRoot, keys });
  } catch (error) {
    return {
      table: {},
      weapons: [],
      found: 0,
      total: 0,
      unread: [String(error?.message || error)],
    };
  }
}

const reloadTimesSummary = (times) =>
  times
    ? {
        found: times.found,
        total: times.total,
        unread: times.unread?.length || 0,
      }
    : null;

async function materialize(input, stateDir, tools) {
  const gameRoot = requireGameRoot(input);
  const configuration = boundedConfiguration(input.configuration);
  const base = await resolveReticleBase({ gameRoot, stateDir }, tools);
  const live = await liveReticleFiles(gameRoot, stateDir, tools);
  const weapons = await weaponReticlePlan(
    { gameRoot, configuration, live },
    stateDir,
    tools,
  );
  const hud = await ammoHud({ gameRoot, configuration, live }, stateDir, tools);
  const reloadTimes = await reloadTimesPlan(
    { gameRoot, configuration },
    stateDir,
    tools,
  );
  const generated = await buildReticlePatch({
    baseGfx: base.gfxFile,
    configuration: {
      ...configuration,
      weaponStyles: weapons.styles,
      damageTable: weapons.damageTable,
      reloadTimes: reloadTimes?.table || null,
    },
    cacheRoot: path.join(stateDir, "reticle-patches"),
    killMarker: liveKillMarker(live),
    weaponFiles: weapons.files,
    hudGfx: hud.gfx,
  });
  /* Записка пересборки: удаляя из библиотеки то, что лежит под прицелом,
     приложение соберёт его заново поверх нового архива (patch-recompose.js). */
  await writeRecomposeSidecar(generated.patch, {
    kind: "reticle",
    configuration,
  });
  return {
    ...generated,
    gameRoot,
    base: {
      source: base.source,
      label: base.label,
      gfxSha256: base.gfxSha256,
    },
    weapons: weaponSummary(weapons),
    ammo: { enabled: hud.counter.enabled, restored: hud.restored },
    /* Стволов с длительностью из файлов / всех стволов с обоймой (`times`): только у включённого индикатора. */
    reload: hud.reload.enabled
      ? { enabled: true, times: reloadTimesSummary(reloadTimes) }
      : { enabled: false },
    /* Числа блока патронов в hud.gfx (`hudAmmoFileValues`): место и масштаб — для записи сверки; `null` — счётчик не собирался. */
    ammoFile: hud.file,
    damage: {
      enabled: normalizeDamageCounter(configuration.damage).enabled,
      server: normalizeDamageCounter(configuration.damage).server,
      named: weapons.damageTable?.own.length || 0,
      byStyle: weapons.damageByStyle || [],
      unread: Boolean(weapons.damageUnread),
    },
  };
}

/* Что окно скажет о стволах: сколько получили свой прицел, кому не встал. */
const weaponSummary = (plan) => ({
  styled: plan.styles.flatMap((style) => style.weapons),
  skipped: plan.skipped,
  restored: plan.restored.map((item) => item.weapon),
});

export async function planReticleCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, stateDir, tools);
  const validation = await native(
    "validate-rpf-patch",
    { patch: generated.patch },
    context,
  );
  return {
    ...generated,
    validation,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: UPDATE_ARCHIVE,
  };
}

/*
 * Записи сверки с игрой (ТЗ H1, 14.11.2026): «Применить» прицела ставит до трёх вещей
 * одним пакетом — прицел и оружие (`hud_reticle.gfx`), счётчик патронов (`hud.gfx`) и
 * счётчик урона (тоже в `hud_reticle.gfx`), — и на каждую поставленную пишется своя запись.
 * Окно рисует сцену 1280×720 (16:9), игра растягивает её на экран по высоте: точка
 * сцены — `pixelsPerPoint` пикселей.
 */
/* `inset` не задан: у сцены нет отступа безопасной зоны (запись пишет `null`). */
const RETICLE_WINDOW_SCREEN = Object.freeze({
  aspect: 16 / 9,
  form: "16:9",
  source: "stage",
});

/* Число форм и слоёв, что ушли в hud_reticle.gfx: обычный прицел, прицелы стволов, снайперка. */
function reticleShapeCount(configuration) {
  const ordinary = (config) => {
    const layers = ordinaryReticleLayers(config);
    return layers.fill.length + layers.outline.length;
  };
  const sniper = sniperReticleLayers(configuration.sniper);
  return (
    ordinary(configuration.ordinary) +
    configuration.weaponStyles.reduce(
      (sum, style) => sum + ordinary(style.config),
      0,
    ) +
    sniper.lines.length +
    sniper.centre.length +
    sniper.glow.length
  );
}

const picked = (source, keys) =>
  Object.fromEntries(keys.map((key) => [key, source?.[key] ?? null]));

/**
 * Записи сверки «Применить» прицела — массив: «reticle» всегда, «ammo» — когда блок патронов
 * записан в hud.gfx (счётчик включён или снят штатным файлом), «damage» — когда включён счётчик урона.
 * Индикатор перезарядки — часть записи «reticle»: его клип в hud_reticle.gfx, а hud.gfx с одним
 * перехватом (без счётчика) записи «ammo» не даёт — тогда этот файл тоже в «reticle».
 * `written` — файлы пакета, как их записал движок (`[{ target, size, sha256 }]`).
 */
export function reticleReconcileRecords({
  input,
  generated,
  installed,
  written = [],
}) {
  const gameScreen = rawGameScreenOf(input);
  const configuration = generated.configuration;
  const engine = engineVerifyFacts(installed);
  const common = {
    trigger: "apply",
    ...reconcileOrigin(input),
    gameScreen,
    windowScreen: RETICLE_WINDOW_SCREEN,
    verify: { engine, frontend: null },
    problems: engine ? [] : ["verify-missing"],
  };
  const stage = { width: RETICLE_STAGE.width, height: RETICLE_STAGE.height };
  const pixelsPerPoint = pixelsPerStagePoint(gameScreen, RETICLE_STAGE.height);
  const files = (predicate) => written.filter((file) => predicate(file.target));
  const ammoRecord = Boolean(
    generated.ammo?.enabled || generated.ammo?.restored,
  );
  const reload = normalizeReloadIndicator(input.configuration?.reload);
  const records = [
    buildReconcileRecord({
      ...common,
      editor: "reticle",
      chosen: {
        ordinary: picked(configuration.ordinary, [
          "color",
          "opacity",
          "scale",
          "length",
          "thickness",
          "gap",
          "rotation",
          "visibilityMode",
        ]),
        sniper: picked(configuration.sniper, ["reticle", "opacity"]),
        weaponStyles: configuration.weaponStyles.length,
        reload: reload.enabled
          ? picked(reload, ["kind", "icon", "size", "opacity", "x", "y"])
          : { enabled: false },
      },
      computed: {
        stage,
        pixelsPerPoint,
        shapes: reticleShapeCount(configuration),
        weaponStyles: configuration.weaponStyles.length,
        /* Индикатор перезарядки: сдвиг от середины в точках сцены 1280×720 и размер клипа. */
        reload: reload.enabled
          ? { x: reload.x, y: reload.y, size: reload.size }
          : null,
      },
      written: files((target) => !ammoRecord || target !== HUD_GFX_TARGET),
    }),
  ];
  if (ammoRecord) {
    const counter = normalizeAmmoCounter(input.configuration?.ammo);
    const layout = ammoCounterLayout(counter);
    records.push(
      buildReconcileRecord({
        ...common,
        editor: "ammo",
        chosen: generated.ammo.enabled
          ? picked(counter, [
              "x",
              "y",
              "size",
              "align",
              "font",
              "format",
              "icon",
              "plate",
              "visibility",
            ])
          : { enabled: false },
        computed: generated.ammo.enabled
          ? {
              stage: { ...AMMO_HUD_STAGE },
              pixelsPerPoint: pixelsPerStagePoint(
                gameScreen,
                AMMO_HUD_STAGE.height,
              ),
              /* Что стоит в hud.gfx: место блока (доли экрана без безопасной зоны, выравнивание «I») и масштаб. */
              file: generated.ammoFile,
              /* Те же числа в точках сцены: точка счётчика и масштаб клипа. */
              layout: {
                x: layout.x,
                y: layout.y,
                scale: layout.scale,
                fieldTop: layout.fieldTop,
              },
              /* Пиксели — ПРИМЕРНО: как если бы `posX` была долей всей ширины экрана игры. Как игра раскладывает блок на не-16:9,
                 ещё не измерено (H2), и окно считает место по-своему (`reticleStageFit`) — это число не обещание, а допущение. */
              screenPxAssumed: {
                x: gameScreen?.width > 0 ? counter.x * gameScreen.width : null,
                y:
                  gameScreen?.height > 0 ? counter.y * gameScreen.height : null,
              },
            }
          : { restored: true },
        written: files((target) => target === HUD_GFX_TARGET),
      }),
    );
  }
  if (generated.damage?.enabled) {
    const damage = configuration.damage;
    records.push(
      buildReconcileRecord({
        ...common,
        editor: "damage",
        chosen: picked(damage, [
          "server",
          "font",
          "size",
          "colorMode",
          "color",
          "x",
          "y",
        ]),
        computed: {
          stage,
          pixelsPerPoint,
          /* Точка счётчика в точках сцены 1280×720 и масштаб клипа (кегль поля в файле один — размер это масштаб). */
          x: damage.x,
          y: damage.y,
          size: damage.size,
          scale: damageCounterScale(damage.size),
        },
        written: files((target) => target.endsWith("/hud_reticle.gfx")),
      }),
    );
  }
  return records;
}

export async function applyReticleCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await assertRuntimeSafety?.(gameRoot);
  const generated = await materialize(input, stateDir, tools);
  /* Файлы пакета по его манифесту — что движок запишет (читается до установки: пакет ещё на месте). */
  const written = await patchWrittenFiles(generated.patch);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  return {
    ...installed,
    patch: generated.patch,
    target: generated.target,
    size: generated.size,
    sha256: generated.sha256,
    base: generated.base,
    weapons: generated.weapons,
    ammo: generated.ammo,
    reload: generated.reload,
    damage: generated.damage,
    /* Экран игры, под который ставилось, и записи сверки с игрой — по одной на каждую поставленную вещь (массив). */
    gameScreen: rawGameScreenOf(input),
    reconcile:
      safeReconcile(() =>
        reticleReconcileRecords({ input, generated, installed, written }),
      ) ?? [],
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
  };
}

registerPatchRecomposer(
  "reticle",
  async ({ sidecar, gameRoot, stateDir, tools = {} }) => {
    const generated = await materialize(
      { gameRoot, configuration: sidecar.configuration },
      stateDir,
      tools,
    );
    return { patch: generated.patch };
  },
);
