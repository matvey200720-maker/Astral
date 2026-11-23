/*
 * Растительность: пакет из файлов игры игрока и складов поставки.
 *
 * Устройство — `@modovik/climb-contract/recolor/vegetation`:
 *
 *  • листва моделей рядом — листы материалов `trees_*` в файлах описи
 *    (`inventory/vegetation.js`, по породам): цвет и густота;
 *  • карточки деревьев вдали — листы в словарях дальних планов районов:
 *    те же цвет и густота, только на листовых пикселях (ствол остаётся);
 *  • «Реалистичные деревья» — модели мода владельца из склада поставки
 *    (`resources/vegetation/improved-trees.asp.*`): встают под именами
 *    моделей игры и красятся так же;
 *  • «Трава по миру» (прежде «Зелёный Сэнди Шорс») — две зоны, город и
 *    всё за городом, у каждой своя трава (как в игре, как в моде или свой
 *    цвет). Зелёные листы мода владельца — из склада (`green-sandy.asp.*`)
 *    по плану `green-sandy.json`: файл берётся из игры игрока, в нём
 *    меняются только эти текстуры (размер, формат и цепочка mip — как у
 *    штатной); свой цвет красит и штатную траву зоны (`lawns`: газоны,
 *    парки, трава холмов), и травинки карт травы зоны;
 *  • дальние планы зоны (задача 10, 05.10.2026) — песок и сухая трава
 *    атласов LOD/SLOD загорода в траву, газоны атласов города — в свой цвет
 *    (`recolourDistantSand`): издалека трава такая же, как вблизи;
 *  • зона файла — из плана (`zones`, по тому, где стоят его вещи); цвет
 *    травы — эффект мастерской по месту в своей зоне: у словаря — по его
 *    середине, у атласа дальнего плана — по точке под каждым текселем, у
 *    травинки — по её точке;
 *  • большие кусты и живые изгороди (задача 2 ТЗ 10.10.2026, вечер) —
 *    листва моделей кустов, их карточки вдали и листы изгородей карт
 *    районов (`world.json`) своим цветом, «как листва» или как в игре;
 *  • цветы — пачки мелкой травы карт травы выбранных районов становятся
 *    пачками цветов Rockstar (или наоборот — «без цветов»);
 *  • деревья районов — виды перемешки на местах деревьев Rockstar и
 *    засаженность: новые деревья в тех же картах районов, на земле под
 *    травой (`map-entities-append.js`);
 *  • файл, который уже везёт другой набор Astral (Завод, Маппинг, Вода),
 *    берётся в его виде: пакет растительности грузится после update.rpf и
 *    иначе спрятал бы правку набора;
 *  • «В разнобой» (задача 7 ТЗ 17.10.2026) — деревья и кусты одного вида
 *    разными цветами палитры: копии моделей (и словарей с листом) своего
 *    цвета, постоянные типы копий (нативный хост, `compile-place-types`) и
 *    карты районов, где сущности смотрят на копии по своему месту; трава —
 *    цветом экземпляров пятнами (`vegetation-variety.js`).
 *
 * Каждый файл читается один раз, и все правки его (листва, карточки,
 * земля) ложатся вместе (`vegetation-build.js`). Файл, который правка не
 * меняет, в пакет не едет.
 *
 * Скорость (05.10.2026). Файлы собираются потоками (`vegetation-build-pool.js`)
 * — на всех ядрах, а не на одном. Собранный файл запоминается по тому, из
 * чего он собран (`build-index.json`): та же работа над тем же файлом игры
 * берётся из хранилища движка жёсткой ссылкой, без пересборки и без второй
 * копии на диске. Так смена оптимизации, задевшая пару сотен словарей, не
 * пересобирает остальные полторы тысячи. Пакет пишется на диск по файлу, а
 * не копится в памяти главного процесса (полный набор — два с половиной
 * гигабайта).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { keysFromDirectory } from "@modovik/rpf7/node";
import VEGETATION_INVENTORY from "@modovik/climb-contract/recolor/inventory/vegetation";
import VEGETATION_PACKS from "@modovik/climb-contract/recolor/inventory/vegetation-packs";
import {
  VARIETY_TYPES,
  areaOfMapName,
  bushStyleOf,
  compileVegetationLooks,
  grassZoneSettings,
  isBushCard,
  isBushFile,
  isGroundCoverCard,
  isGroundCoverFile,
  normalizeVegetationProject,
  sharedGrassZone,
  joaatName,
  varietyActive,
  varietyCloneName,
  varietyPainted,
  varietySlots,
  varietyTypesOf,
  vegetationNeedsGrassPlan,
  vegetationProjectIsVanilla,
} from "@modovik/climb-contract/recolor/vegetation";
import { rememberSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { statePaths } from "@modovik/install-engine/storage-state.js";
import {
  VEGETATION_DLC_ALL_PACKS,
  VEGETATION_DLC_PACKS,
  VEGETATION_LAYOUT_THREE_PACKS,
  VEGETATION_LAYOUT_TWO_PACKS,
  vegetationArchiveOf,
  vegetationPackOf,
} from "@modovik/install-engine/vegetation-dlc.js";
import { copyBuiltFile, writeBuiltFile } from "@modovik/install-engine/built-file-write.js";
import {
  buildVegetationManifest,
  chooseVegetationLayout,
  isLocalVegetationManifest,
  isVegetationModId,
  vegetationThirdPackMode,
} from "@modovik/install-engine/vegetation-manifest-trust.js";
import { gameMapNames } from "./game-map-names.js";
import { vegetationMapCandidates } from "./map-name-candidates.js";
import { texturesPackByTarget } from "@modovik/install-engine/textures-dlc.js";
import { PLACES_DLC_TARGET } from "@modovik/install-engine/places-dlc.js";
import { isTexturesModId } from "@modovik/install-engine/textures-manifest-trust.js";
import { isRoadsModId } from "@modovik/install-engine/roads-manifest-trust.js";
import { roadsPackByTarget } from "@modovik/install-engine/roads-dlc.js";
import { carrierEntryRoot, carrierOfTarget } from "@modovik/install-engine/carrier-targets.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { createGameReader } from "./optimization-layers.js";
import { VegetationPoolBroken } from "./vegetation-build-pool.js";
/* Файлы с листами мода, дальними планами и газонами — движком, за выключателем `ASTRAL_VEGETATION_ENGINE=1` (16.11.2026). */
import { buildVegetationOnEngine, vegetationEngineEligible, vegetationEngineThreads } from "./vegetation-engine-build.js";
/* Посадка: план засаженности — ряды вдоль дорог, полосы и клумбы (ТЗ 11.10.2026). */
import { PLANTING_VERSION, densityForestsIn, plantingSelection } from "@modovik/climb-contract/recolor/vegetation-planting";
import { renameWhenFree } from "./atomic-file.js";
import { composedUnreadableError } from "./composed-source-error.js";
import { openVegetationPlanting } from "./vegetation-build.js";
import {
  createVegetationContext,
  grassGroundPoints,
  openGrassPlan,
  openGreenSandy,
  openImprovedTrees,
  openVegetationVariety,
  openVegetationWorld,
  processVegetationJob,
} from "./vegetation-build.js";

export {
  distantModSheets,
  distantSheetBase,
  grassGroundPoints,
  greenTexturePayload,
  isDistantAtlas,
  modSheetsOf,
  openGrassPlan,
  openGreenSandy,
  openImprovedTrees,
  openVegetationVariety,
  openVegetationWorld,
  patchForestMap,
  patchGrassColours,
  patchGrassMap,
  patchGreenFile,
  readGrassInstances,
  recolourDistantFile,
  recolourLeafFile,
  vegetationResourceRoot,
} from "./vegetation-build.js";

/* Пакет растительности — сотни мегабайт: хранится один (текущий). */
const KEEP_PACKAGES = 1;
/*
 * Версия сборки файлов: меняется, когда тот же файл с той же работой стал
 * собираться иначе, — запомненные файлы прежней сборки тогда не берутся.
 */
/* 2 — «Трава по миру» (06.10.2026): зоны, цвет травы сдвигом с рисунком, штатная трава, травинки под лист модели;
   3 — атласы земли городских кварталов и «мех» газонов;
   4 — карточки деревьев вдали темнее листвы рядом, как у Rockstar, и красятся до общего хвоста mip (07.10.2026);
   5 — кусты и живые изгороди своим обликом, цветы на траве (трава мира цветы не красит), деревья перемешкой и засаженность (10.10.2026);
   6 — покраска (11.10.2026): цветы Rockstar красятся с травой (своими остаются только посаженные), камни карт травы — нет,
       процедурная трава, палитры тинта земли и изгородей, изгороди — только листовые пиксели, общий хвост mip у травы. */
const VEGETATION_BUILD_VERSION = 6;
const GiB = 1024 * 1024 * 1024;
/*
 * Сколько файлов движок берёт в пакет растительности (`manifest.js`,
 * `validateManifest`: 8 000 с согласия владельца, ТЗ 11.10.2026). Здесь —
 * чтобы сказать словами, что именно не поместилось, а не «слишком много файлов».
 */
export const VEGETATION_FILE_LIMIT = 8000;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = () => new Promise((resolve) => setImmediate(resolve));

/* ------------------------------------------------------------------ *
 * Игра
 * ------------------------------------------------------------------ */

/**
 * Чтение растительности: файлы игры игрока и склады поставки — только те,
 * что работе нужны (`improved`, `sandy`). `tools` в тестах подменяют.
 */
export async function openVegetationGame({ gameRoot, stateDir, improved = false, sandy = false, keysDirectory = undefined }, tools = {}) {
  if (tools.openVegetationGame) return tools.openVegetationGame({ gameRoot, stateDir, improved, sandy });
  /* Поток сборки получает папку ключей готовой: подготовка ArchiveFix — дело главного процесса. */
  const directory = keysDirectory === undefined ? await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport }) : keysDirectory;
  const keys = await keysFromDirectory(directory || "");
  const game = createGameReader(gameRoot, keys);
  try {
    /* Архивы игры, открытые впервые: строка прогресса говорит «Читаю архивы игры · N из M» (`onArchive`). */
    const opened = new Set();
    const handle = {
      gameRoot,
      onArchive: null,
      read(at) {
        const label = String(at).split(":")[0];
        if (!opened.has(label)) {
          opened.add(label);
          handle.onArchive?.(label, opened.size);
        }
        return game.read(at);
      },
      /* Размер записи в архиве игры по оглавлению, без чтения файла: оценка пакета до сборки. */
      sizeOf: (at) => game.sizeOf(at),
      /* Имена, что игра включает только наборами `GROUP_MAP` (26.10.2026): их файлы — в архив сетевой карты, как `hei_`; кэш по отпечатку игры. */
      mapNames: async () => (await gameMapNames({ gameRoot, keys, candidates: vegetationMapCandidates(), stateDir }).catch(() => null))?.names || null,
      improved: improved ? await openImprovedTrees() : null,
      sandy: sandy ? await openGreenSandy() : null,
      async close() {
        await game.close().catch(() => {});
      },
    };
    return handle;
  } catch (error) {
    await game.close().catch(() => {});
    throw error;
  }
}

/**
 * Файлы, которые везут другие поставленные работы Astral в update.rpf
 * (`Map<имя, { at, owner }>`): Завод, Маппинг, Вода правят те же словари
 * дальних планов, слои оптимизации («Ухудшение текстур», ретекстур, трава
 * газонов) — словари земли и карты травы. Пакет растительности грузится
 * после update.rpf, поэтому такой файл собирается поверх их вида, а не из
 * игры (задача 10): зелень мода ложится и в ужатые текстуры.
 */
export async function astralSetFiles({ gameRoot, stateDir, readState, except = isVegetationModId, rpOnly = false }) {
  const files = new Map();
  const state = readState ? await readState({ stateDir }).catch(() => null) : null;
  const targets = state?.targets && typeof state.targets === "object" ? Object.values(state.targets) : [];
  const target = targets.find((item) => item?.gameRoot && path.resolve(item.gameRoot).toLowerCase() === path.resolve(gameRoot).toLowerCase());
  /* `except` — чья работа собирает (её файлы не соседские): у растительности — она сама, у дорог — дороги (`recolor-customizer.js`). */
  const installed = (target?.installed || []).filter((item) => !except(item?.modId));
  for (const item of installed) {
    for (const entry of item.archiveEntries || []) {
      if (String(entry?.target).toLowerCase() !== "update/update.rpf") continue;
      const place = String(entry.entry || "").toLowerCase();
      if (!/^x64\/astral\/[a-z0-9_]+\.rpf\/[^/]+$/.test(place)) continue;
      files.set(place.split("/").pop(), { at: `update:${place}`, owner: item.modId });
    }
  }
  /* Носители Astral (`update/update2.rpf` и штатные паки, GTA 5 RP, 21.11.2026): контейнеры чужих работ — в `x64/astral` у update2 и в `x64/levels/gta5` у пака (`carrierEntryRoot`). Дороги в
     них красят общие словари (`globalroads`, `cityeastrd`…), а контейнеры травы регистрируются позже и перекрывали бы их штатным видом: трава собирается ПОВЕРХ дорожной копии. */
  for (const item of installed) {
    for (const entry of item.archiveEntries || []) {
      const carrier = carrierOfTarget(entry?.target);
      if (!carrier) continue;
      const place = String(entry.entry || "").toLowerCase();
      const root = carrierEntryRoot(carrier);
      const container = carrier.registration === "pack-content" || carrier.registration === "pack-sub" ? "astral_[a-z0-9_]+" : "[a-z0-9_]+";
      if (!new RegExp(`^${root}/${container}\\.rpf/[^/]+$`).test(place)) continue;
      files.set(place.split("/").pop(), { at: `${carrier.target}:${place}`, owner: item.modId });
    }
  }
  /* Только контейнеры способа RP (update.rpf, носители, штатные паки): места мастерской собираются поверх них, а пакетные формы (старые дороги, ступень текстур, пакет мест) остаются как были. */
  if (rpOnly) return files;
  /* Дороги — два своих пакета дополнения (задача 6 ТЗ 07.10.2026): выше
     update.rpf, ниже ступени текстур. Словари земли с газонами несут и
     грунтовки: растительность ложится поверх перекрашенных дорог. */
  for (const item of installed) {
    if (!isRoadsModId(item?.modId)) continue;
    for (const entry of item.archiveEntries || []) {
      const pack = roadsPackByTarget(entry?.target);
      const place = String(entry?.entry || "").toLowerCase();
      /* Части пакета (astral_roads_2.rpf…) и архив его сетевой карты (astral_roads_mp.rpf, astral_roads_b_mp.rpf, 12.10.2026). */
      if (!pack || !/^astral_roads(?:_\d|_mp|_b_mp)?\.rpf\/[^/]+$/.test(place)) continue;
      files.set(place.split("/").pop(), { at: `${pack.target}:${place}`, owner: item.modId });
    }
  }
  /* Ступень «Ухудшения текстур» — свой пакет дополнения (задача 1 ТЗ
     05.10.2026): он грузится после update.rpf, и словарь из него главнее
     того же словаря работы в update.rpf (он и собран поверх неё). ЧБ-мир
     (ТЗ 17.10.2026) везёт модели и во втором пакете (`astral_textures_b`):
     растительность — поверх обоих, иначе её модели вернули бы цвет в серый
     мир. */
  for (const item of installed) {
    if (!isTexturesModId(item?.modId)) continue;
    for (const entry of item.archiveEntries || []) {
      /* Словари ступени лежат в первом пакете и, на 256 px, во втором и третьем (ТЗ 17.10.2026). */
      const pack = texturesPackByTarget(entry?.target);
      if (!pack) continue;
      const place = String(entry.entry || "").toLowerCase();
      const parts = place.split("/");
      if (parts.length !== 2 || !pack.streams.includes(parts[0])) continue;
      files.set(parts[1], { at: `${pack.target}:${place}`, owner: item.modId });
    }
  }
  /* Места мастерской — свой пакет выше ступени текстур (фикс 1 ТЗ
     06.10.2026): их словарь в игре главнее и ступени, и update.rpf. */
  for (const item of installed) {
    for (const entry of item.archiveEntries || []) {
      if (String(entry?.target).toLowerCase() !== PLACES_DLC_TARGET) continue;
      const place = String(entry.entry || "").toLowerCase();
      if (!/^astral_[a-z0-9_]+\.rpf\/[^/]+$/.test(place)) continue;
      files.set(place.split("/").pop(), { at: `${PLACES_DLC_TARGET}:${place}`, owner: item.modId });
    }
  }
  return files;
}

/**
 * Байты файла, что везёт другая работа Astral (`other` из `astralSetFiles`). Не читается (метка не открылась, записи нет) — отказ: раньше сборка молча брала штатный файл игры, и копия травы несла штатную
 * разметку и перекрывала дорожную (блокер ступени 2, 21.11.2026). «Молча штатное» — брак, а не запасной путь.
 */
export async function readComposedFile(game, name, other) {
  const bytes = await game.read(other.at).catch(() => null);
  if (bytes) return bytes;
  throw composedUnreadableError(name, other.at, "vegetation");
}

/* ------------------------------------------------------------------ *
 * Память собранных файлов
 * ------------------------------------------------------------------ */

/*
 * Ключ собранного файла: что с ним делали (часть работы, которая его
 * касается) и из чего (файл игры). Части работы — по делу: листва и
 * карточки зависят только от деревьев, земля и трава — только от травы своей зоны;
 * смена цвета травы не пересобирает модели деревьев.
 */
function jobKey(job, identity, project) {
  const spec = job.spec;
  /* Копия «в разнобой» несёт всё в задании: цвет, густоту, листы — и файл, с которого снята. */
  if (spec.kind === "variety") return sha256(JSON.stringify({ version: VEGETATION_BUILD_VERSION, spec, source: identity }));
  /* Листва деревьев нужна деревьям, карточкам вдали и кустам «как листва»;
     облик кустов — кустам, карточкам и изгородям. Смена цвета кустов не
     пересобирает деревья, а цвета деревьев — кусты со своим цветом. */
  const bush = bushStyleOf(project);
  const bushes = spec.cards || spec.hedges || spec.hedgePalettes || spec.group === "bush" || (spec.kind === "improved" && isBushFile(spec.name));
  const trees =
    (spec.kind === "improved" && !isBushFile(spec.name)) ||
    (spec.leaves && spec.group !== "bush") ||
    spec.cards ||
    (bushes && bush?.follow);
  const sandy = spec.kind === "grass" || spec.green || spec.distant || spec.lawns || spec.palettes || spec.plants;
  /* Трава — только своей зоны: смена цвета города не пересобирает загород. «Обе сразу» — его трава у обеих зон. */
  const zone = sandy ? grassZoneSettings(project.sandy, spec.zone || "country") : null;
  const flowers = spec.flowers ? project.flowers : null;
  /* Земля для новых деревьев — тысячи чисел: в ключ — их отпечаток. */
  const plant = spec.plant ? { count: spec.plant.count, points: sha256(JSON.stringify(spec.plant.points)) } : null;
  /* Посадка: ряды и клумбы — готовые сущности и пачки плана: в ключ — их
     отпечаток и версия посадки (рощи, ряды и клумбы собираются её правилами). */
  const rows = spec.rows ? sha256(JSON.stringify(spec.rows)) : null;
  const beds = spec.beds ? sha256(JSON.stringify(spec.beds)) : null;
  const planted = plant || rows || beds ? { ...spec, ...(plant ? { plant } : {}), ...(rows ? { rows } : {}), ...(beds ? { beds } : {}) } : null;
  return sha256(
    JSON.stringify({
      version: VEGETATION_BUILD_VERSION,
      ...(planted ? { planting: PLANTING_VERSION } : {}),
      spec: planted || spec,
      ...(plant && project.forest.enabled ? { mixKinds: project.forest.kinds, mixAreas: project.forest.areas } : {}),
      trees: trees ? project.trees : null,
      ...(bushes ? { bushes: bush ? { follow: bush.follow, look: bush.look, hedges: bush.hedges } : null } : {}),
      sandy: zone ? { zone: spec.zone || "country", grass: zone.grass, look: zone.grass === "colour" ? zone.look : null } : null,
      /* Покраска: процедурная трава и наземные растения — цветом травы своей зоны. */
      ...(spec.plants ? { plants: { zone: spec.plantZone, look: grassZoneSettings(project.sandy, spec.plantZone || "country")?.look || null } } : {}),
      ...(flowers ? { flowers: { mode: flowers.mode, kinds: flowers.kinds, share: flowers.share } } : {}),
      ...(spec.kind === "forest" ? { forest: { kinds: project.forest.kinds, share: project.forest.share } } : {}),
      /* «В разнобой»: карта и травинки — по палитре, сиду и группам (копии несут цвет в самом задании). */
      ...(spec.variety ? { variety: project.variety } : {}),
      plan: sandy ? VEGETATION_PACKS.sandy.planSha256 : null,
      pack: sandy ? VEGETATION_PACKS.sandy.sha256 : null,
      source: identity,
    }),
  );
}

/**
 * Опись собранных файлов (`recolor/vegetation/build-index.json`): ключ →
 * SHA-256 и размер файла, виды правок и счёт для отчёта. Сами файлы — в
 * хранилище движка (`payloads/<мод растительности>/<sha256>`), опись их не
 * держит: файла там нет — значит, собрать заново. Помнятся записи этой
 * сборки и прошлой (выключил и включил — то же).
 */
export async function openVegetationBuildCache({ stateDir, stores = [] }) {
  const file = path.join(stateDir, "recolor", "vegetation", "build-index.json");
  let index = { version: VEGETATION_BUILD_VERSION, generation: 0, entries: {} };
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    if (saved?.version === VEGETATION_BUILD_VERSION && saved.entries && typeof saved.entries === "object") index = saved;
  } catch {
    /* Описи нет или она битая — всё собирается заново. */
  }
  const generation = (Number(index.generation) || 0) + 1;
  const touched = new Map();
  return {
    /** Запись описи и путь к файлу в хранилище; `null` — собирать. */
    async lookup(key) {
      const entry = index.entries[key];
      if (!entry) return null;
      if (!entry.sha256) return { ...entry, path: null };
      for (const store of stores) {
        const candidate = path.join(store, entry.sha256);
        const stat = await fs.stat(candidate).catch(() => null);
        if (stat?.isFile() && stat.size === entry.size) return { ...entry, path: candidate };
      }
      return null;
    },
    touch(key) {
      if (index.entries[key]) touched.set(key, index.entries[key]);
    },
    remember(key, entry) {
      touched.set(key, {
        sha256: entry.sha256 || null,
        size: entry.size || 0,
        kinds: entry.kinds || [],
        counts: entry.counts || {},
      });
    },
    async save() {
      const entries = {};
      for (const [key, entry] of Object.entries(index.entries))
        if ((Number(entry.generation) || 0) >= generation - 1) entries[key] = entry;
      for (const [key, entry] of touched) entries[key] = { ...entry, generation };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, Buffer.from(JSON.stringify({ version: VEGETATION_BUILD_VERSION, generation, entries })));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

const labelOf = (at) => String(at).slice(0, String(at).indexOf(":"));

/**
 * Файлы пакета под работу и отчёт.
 *
 * `pool` — потоки сборки (`createVegetationPool`), без него — главный
 * процесс. `cache` — память собранных файлов (`openVegetationBuildCache`),
 * `place(path, name)` кладёт запомненный файл в пакет (ссылкой) и отвечает,
 * легло ли. `sink(file)` — запись собранного файла сразу на диск: тогда
 * байты в ответе не держатся. Без `sink` файлы — `{ kind, name, bytes }`.
 */
/* Причины отбора задания: какие правки затянули файл в пакет (для пробного прохода `planOnly`). */
const PLAN_REASONS = ["leaves", "cards", "plants", "green", "distant", "lawns", "palettes", "hedges", "hedgePalettes"];
function planReasons(spec) {
  return [spec.kind, ...PLAN_REASONS.filter((key) => (Array.isArray(spec[key]) ? spec[key].length > 0 : Boolean(spec[key])))];
}

/*
 * Этап задания для строки прогресса: копии «В разнобой», модели (листва в моделях) или карты и трава
 * (карты районов, травинки, палитры, изгороди). Порядок и подписи — в окне.
 */
const MAP_REASONS = ["plants", "green", "distant", "lawns", "palettes", "hedges", "hedgePalettes"];
export function vegetationStageOf(spec) {
  if (spec.kind === "variety") return "copies";
  if (spec.kind === "improved") return "models";
  return MAP_REASONS.some((key) => (Array.isArray(spec[key]) ? spec[key].length > 0 : Boolean(spec[key]))) ? "maps" : "models";
}

/* Подсчёт до сборки: сколько заданий и по каким этапам, без чтения файлов. Строка прогресса берёт «N из M» отсюда. */
export async function countVegetationPlan(input, game, { composed = new Map(), compile = null, cache = null, sizes = false, onCount = null } = {}) {
  const { planned } = await buildVegetationFiles(input, game, { planOnly: "count", composed, compile, cache, planSizes: sizes, onCount });
  /* Архивы, из которых план берёт файлы: M для строки «Читаю архивы игры · N из M». */
  const archives = [...new Set(planned.map((item) => String(item.at || "").split(":")[0]).filter(Boolean))];
  /* Файлы, которые память сборки уже знает (`cache`): имя и точный размер — по ним размер пакета сверяется до сборки. */
  const known = planned.filter((item) => item.known > 0).map((item) => ({ name: item.name, size: item.known }));
  /* Оценка пакета по плану (`sizes`): точный размер из памяти сборки, иначе размер исходника — запись в оглавлении архива
     игры или файл склада. По ней — отказ до сборки, когда пакет заведомо не поместится, и «сделано из всего» в строке хода. */
  const estimated = planned.filter((item) => item.estimate > 0).map((item) => ({ name: item.name, size: item.estimate }));
  return {
    total: planned.length,
    stageOf: new Map(planned.map((item) => [item.name, item.stage])),
    archives,
    known,
    estimated,
    totalBytes: estimated.reduce((sum, item) => sum + item.size, 0),
  };
}

export async function buildVegetationFiles(
  input,
  game,
  { onProgress = null, composed = new Map(), pool = null, cache = null, place = null, sink = null, compile = null, staging = null, planOnly = false, plan = null, engine = null, onFile = null, planSizes = false, onCount = null } = {},
) {
  const project = normalizeVegetationProject(input);
  const looks = compileVegetationLooks(project);
  const inventory = VEGETATION_INVENTORY;
  const files = [];
  /* Готовый файл лёг в итог: `onFile` считает размер пакета по ходу и останавливает сборку, как только он перерос предел (18.11.2026). */
  let admittedBytes = 0;
  const admit = (file) => {
    files.push(file);
    admittedBytes += Number(file.size) || 0;
    onFile?.(file);
  };
  /* Пробный проход (`planOnly`): записи заданий с причинами отбора и размером исходника, без работы над файлами. */
  const planned = [];
  const report = {
    trees: 0,
    lods: 0,
    improved: 0,
    grass: 0,
    instances: 0,
    sandy: 0,
    lawns: 0,
    lawnTextures: 0,
    textures: 0,
    stubs: 0,
    distant: 0,
    distantSheets: 0,
    bushes: 0,
    hedges: 0,
    /* Покраска: палитры тинта изгородей и земли, спрайты процедурной травы. */
    hedgePalettes: 0,
    palettes: 0,
    plants: 0,
    plantSprites: 0,
    flowerMaps: 0,
    flowerBatches: 0,
    grassBatches: 0,
    forestMaps: 0,
    forestTrees: 0,
    plantedMaps: 0,
    plantedTrees: 0,
    /* Посадка: ряды вдоль дорог и деревья полос (карты районов), клумбы (карты травы). */
    rowMaps: 0,
    rowTrees: 0,
    bedMaps: 0,
    bedBatches: 0,
    /* «В разнобой»: копии моделей и словарей, файлы типов, карт и сущностей на копиях. */
    varietyModels: 0,
    varietyDictionaries: 0,
    varietyTypes: 0,
    varietyMaps: 0,
    varietyTrees: 0,
    missing: [],
    composed: [],
  };
  const sandy = looks.sandy.enabled ? game.sandy : null;
  if (looks.sandy.enabled && !sandy) throw new Error("Склад «Травы по миру» не открыт — переустановите Astral.");
  /* Карты травы — у цветов и без «Травы по миру»: план без склада картинок. */
  const grassPlan = sandy?.plan || (vegetationNeedsGrassPlan(project) ? game.grassPlan || (await openGrassPlan()) : null);
  /* Изгороди и деревья районов — опись мира (`world.json`). */
  const bushLook = looks.bushes;
  /* Покраска: и у листвы деревьев — листва в моделях карт (`leaves`). */
  const needsWorld = Boolean(bushLook?.hedges) || looks.trees.active || project.forest.enabled || project.density.value > 0;
  const world = needsWorld ? game.world || (await openVegetationWorld()) : null;
  let context = null;
  const inlineContext = () => (context ||= createVegetationContext(project, sandy));
  const treesActive = looks.trees.active;
  const allowed = new Set(inventory.models);
  /* Файлы, что уже легли в пакет (модели «Реалистичных деревьев» — первыми). */
  const taken = new Set();
  let done = 0;
  /* Строка прогресса: этапы и файлы по ним — из подсчёта до сборки (`plan`), байты — что уже записано. */
  const stageOf = plan?.stageOf || new Map();
  const stageTotal = new Map();
  for (const stage of stageOf.values()) stageTotal.set(stage, (stageTotal.get(stage) || 0) + 1);
  const stageDone = new Map();
  let bytesWritten = 0;
  /* Движок собирает пачку файлов разом: пока он идёт, строка хода считает по его счёту (`engineShown`), а когда файлы пачки встанут в пакет по порядку, — догоняет его. */
  const engineShown = { done: 0, maps: 0 };
  const progressOf = (stage, lastName) => ({
    step: "vegetation",
    phase: "build",
    done: Math.max(done, engineShown.done),
    total: plan?.total ?? null,
    stage,
    stageDone: Math.max(stageDone.get(stage) || 0, stage === "maps" ? engineShown.maps : 0),
    stageTotal: stageTotal.get(stage) || 0,
    /* Все этапы сразу — строка прогресса рисует полосу по этапам, а не только по текущему. */
    stages: Object.fromEntries(["models", "copies", "maps"].map((id) => [id, { done: Math.max(stageDone.get(id) || 0, id === "maps" ? engineShown.maps : 0), total: stageTotal.get(id) || 0 }])),
    bytes: bytesWritten,
    /* Байты собранного и оценка пакета по плану: окно пока считает по ним процент (ветка «Загрузок» 18.11). Основное поле — доля
       `fraction` (её ставит `vegetationProgressFraction`); байты уйдут из хода, когда окно перейдёт на долю. */
    doneBytes: admittedBytes,
    ...(plan?.totalBytes > 0 ? { totalBytes: Math.max(plan.totalBytes, admittedBytes) } : {}),
    lastName,
  });
  const step = async (file = null) => {
    done += 1;
    if (!file) return;
    const stage = stageOf.get(file.name) || "maps";
    stageDone.set(stage, (stageDone.get(stage) || 0) + 1);
    bytesWritten += file.size;
    onProgress?.(progressOf(stage, file.name));
    await pause();
  };

  /* Файл в виде другого набора Astral, если тот его везёт, иначе — из игры. */
  const counted = new Set();
  const readOriginal = async (name, at) => {
    const other = composed.get(name);
    if (other) {
      const bytes = await readComposedFile(game, name, other);
      /* Повторное чтение (поток сборки упал с байтами) в отчёт не идёт. */
      if (!counted.has(name)) report.composed.push({ name, owner: other.owner });
      counted.add(name);
      return bytes;
    }
    return game.read(at);
  };
  /*
   * Байты файла для работы: `{ bytes, plain }`. Склад «Реалистичных деревьев»
   * отдаёт файл без последнего сжатия (`plain`: за заголовком RSC7 — данные
   * ресурса): работа над файлом всё равно разожмёт его, а сжатие девятым
   * уровнем шло подряд в этом потоке (13.10.2026).
   */
  const fromImproved = (job) => job.spec.kind === "improved" || job.spec.from === "improved";
  const readSource = async (job) => {
    /* Копия «в разнобой» читает файл, с которого снята: модель игры, другого набора или «Реалистичных деревьев». */
    if (!fromImproved(job)) return { bytes: await readOriginal(job.spec.source || job.spec.name, job.at), plain: false };
    if (game.improved.readPlain) return (await game.improved.readPlain(job.entry)) ?? { bytes: null, plain: false };
    return { bytes: await game.improved.read(job.entry), plain: false };
  };
  /* Задание потоку: признак `plain` не входит в ключ памяти собранного — ключ считается по `job.spec`. */
  const specOf = (prepared) => (prepared.plain ? { ...prepared.job.spec, plain: true } : prepared.job.spec);

  /* Отпечаток архива игры: базовые архивы и пакеты дополнений меняет только
     обновление игры, а update.rpf — каждая установка Astral. */
  const stamps = new Map();
  const stampOf = async (label) => {
    if (!game.gameRoot || label === "update" || !/^(x64[a-z]\.rpf|update\/x64\/dlcpacks\/[a-z0-9_]{1,40}\/dlc\.rpf)$/i.test(label))
      return null;
    if (!stamps.has(label))
      stamps.set(
        label,
        fs
          .stat(path.join(game.gameRoot, ...label.split("/")))
          .then((stat) => `${stat.size}:${Math.round(stat.mtimeMs)}`)
          .catch(() => null),
      );
    return stamps.get(label);
  };

  /*
   * Что известно о файле до работы над ним: запомненный (`hit`), байты для
   * работы или пропуск (`missing`). Идёт по порядку — так и отчёт о
   * пропусках и чужих наборах тот же, что у прежней сборки.
   */
  const prepare = async (job, engineBatch = null) => {
    let identity = null;
    if (fromImproved(job)) identity = `improved:${VEGETATION_PACKS.improved.sha256}:${job.entry}`;
    else if (!composed.has(job.spec.source || job.spec.name)) {
      const stamp = await stampOf(labelOf(job.at));
      if (stamp) identity = `${job.at}@${stamp}`;
    }
    const claim = async (key) => {
      const hit = await cache.lookup(key);
      if (!hit) return null;
      if (hit.sha256 && !(await place?.(hit.path, job.spec.name))) return null;
      cache.touch(key);
      return { job, hit };
    };
    if (cache && identity) {
      const claimed = await claim(jobKey(job, identity, project));
      if (claimed) return claimed;
    }
    /* Файл уже собрал движок (`engineBatchOf`): исходник не читается. */
    const built = engineBatch?.get(job);
    if (built?.status === "missing") {
      report.missing.push(job.spec.name);
      return { job, missing: true };
    }
    if (built && (built.status === "built" || built.status === "unchanged")) return { job, key: built.key, engine: built };
    const { bytes, plain } = await readSource(job);
    if (!bytes) {
      report.missing.push(job.spec.name);
      return { job, missing: true };
    }
    identity ||= `sha:${sha256(bytes)}`;
    const key = cache ? jobKey(job, identity, project) : null;
    if (key) {
      const claimed = await claim(key);
      if (claimed) return claimed;
    }
    return { job, bytes, plain, key };
  };

  /* Размер файла из памяти сборки — тем же ключом, что у `prepare`, но без чтения исходника; 0 — память его не знает. */
  const knownSizeOf = async (job) => {
    let identity = null;
    if (fromImproved(job)) identity = `improved:${VEGETATION_PACKS.improved.sha256}:${job.entry}`;
    else if (!composed.has(job.spec.source || job.spec.name)) {
      const stamp = await stampOf(labelOf(job.at));
      if (stamp) identity = `${job.at}@${stamp}`;
    }
    const hit = identity ? await cache.lookup(jobKey(job, identity, project)).catch(() => null) : null;
    return hit?.sha256 ? Number(hit.size) || 0 : 0;
  };

  /*
   * Размер исходника без чтения файла — оценка размера собранного (18.11.2026). Файл игры — запись в оглавлении архива:
   * перекраска формат и размеры листов не меняет, сжатый файл выходит близким к исходному. Файл склада «Реалистичных
   * деревьев» в описи лежит несжатым, в пакет идёт сжатым: берётся доля `IMPROVED_PACKED_SHARE` (оценка, не замер).
   * Файл чужой работы Astral и игра без оглавлений (тесты) — 0: оценка занижается, заранее по ней не откажем.
   */
  const sourceSizeOf = async (job) => {
    try {
      if (fromImproved(job)) return Math.round((Number(game.improved?.sizeOf?.(job.entry)) || 0) * IMPROVED_PACKED_SHARE);
      if (composed.has(job.spec.source || job.spec.name) || typeof game.sizeOf !== "function" || !job.at) return 0;
      return Number(await game.sizeOf(job.at)) || 0;
    } catch {
      return 0;
    }
  };

  /* На что ушло время раздатчика (14.11.2026, работа «Astral быстрее»): подготовка файла (память сборки, чтение из игры), ожидание
     самого старого файла у потоков, приём итога (отчёт и запись в пакет). Замер тестового ПК на «своём цвете» (3243 файла, 6,6 ГБ):
     сборка упирается в процессор — шесть потоков JS заняты целиком; запись файлов разом и широкое окно раздачи времени не меняют
     (171–180 с во всех вариантах), а очередь медленного диска растят. Подробно — `docs/INSTALL-SPEED.md`, «Растительность». */
  const clock = { prepareMs: 0, waitMs: 0, absorbMs: 0, jobs: 0, built: 0 };
  /* Файлы, что взял движок: сколько, сколько отдал потокам (и почему), время самого движка и его этапов (`engine`, сумма по потокам). */
  const engineClock = { jobs: 0, built: 0, fallbacks: [], ms: 0, stages: null };

  /* Работа над файлом — потоком пула или здесь же, если пула нет или он сломан. */
  let poolAlive = Boolean(pool);
  const work = async (prepared) => {
    if (prepared.engine) {
      /* Файл готов и лежит в пакете: движок уже написал его и посчитал SHA-256. */
      const done = prepared.engine;
      const result =
        done.status === "built"
          ? { bytes: null, written: true, size: done.bytes, kinds: done.kinds || [], counts: done.counts || {}, sha256: done.sha256 }
          : { bytes: null, kinds: [], counts: {}, sha256: null };
      if (cache && prepared.key) cache.remember(prepared.key, { sha256: result.sha256, size: result.size || 0, kinds: result.kinds, counts: result.counts });
      return { ...prepared, engine: null, result };
    }
    if (!prepared.bytes) return prepared;
    let result = null;
    if (poolAlive) {
      try {
        result = await pool.run(specOf(prepared), prepared.bytes);
      } catch (error) {
        if (!(error instanceof VegetationPoolBroken)) throw error;
        poolAlive = false;
        /* Байты ушли в упавший поток — файл читается заново. */
        ({ bytes: prepared.bytes, plain: prepared.plain } = await readSource(prepared.job));
      }
    }
    if (!result) {
      const own = processVegetationJob(specOf(prepared), prepared.bytes, inlineContext());
      result = { ...own, sha256: own.bytes ? sha256(own.bytes) : null };
    }
    if (cache && prepared.key)
      cache.remember(prepared.key, { sha256: result.sha256, size: result.bytes?.length || 0, kinds: result.kinds, counts: result.counts });
    return { ...prepared, bytes: null, result };
  };

  /* Итог файла — по порядку: пакет, отчёт, занятые имена. */
  const absorb = async (outcome) => {
    if (outcome.missing) return;
    let produced = null;
    const { kind: jobKind, name } = outcome.job.spec;
    const known = outcome.hit || outcome.result;
    for (const [key, value] of Object.entries(known.counts || {})) report[key] = (report[key] || 0) + value;
    if (known.sha256) {
      const kind = jobKind === "game" ? (known.kinds || []).join("+") : jobKind;
      const file = { kind, name, sha256: known.sha256, size: outcome.hit ? outcome.hit.size : (outcome.result.size ?? outcome.result.bytes.length) };
      if (outcome.hit) file.path = outcome.hit.path;
      else if (outcome.result.written) await engine.adopt(file);
      else if (sink) await sink({ ...file, bytes: outcome.result.bytes });
      else file.bytes = outcome.result.bytes;
      admit(file);
      taken.add(name);
      produced = file;
    }
    await step(produced);
  };

  /*
   * Файлы, которые собирает движок (`vegetation-engine-build.js`): вид `game` с листами мода, дальними планами и газонами, не поверх другого набора
   * Astral и из архива с отпечатком (у `update` отпечатка нет — их читают потоки). Запомненные файлы движку не отдаются: их берёт `prepare`.
   * Движок собирает всю пачку разом и пишет файлы прямо в пакет; что он не взял (`fallback`), собирают потоки. Отказ движка целиком — тоже потоки.
   */
  const engineBatchOf = async (jobs) => {
    if (!engine?.executable || !engine.outputDir || !sandy || planOnly) return null;
    const picked = [];
    for (const job of jobs) {
      if (!vegetationEngineEligible(job.spec, inlineContext()) || composed.has(job.spec.source || job.spec.name)) continue;
      const stamp = await stampOf(labelOf(job.at));
      if (!stamp) continue;
      const key = jobKey(job, `${job.at}@${stamp}`, project);
      if (cache && (await cache.lookup(key))) continue;
      picked.push({ job, key });
    }
    if (!picked.length) return null;
    const from = Date.now();
    let results;
    try {
      results = await buildVegetationOnEngine({
        executable: engine.executable,
        gameRoot: game.gameRoot,
        keysDirectory: engine.keysDirectory || "",
        context: inlineContext(),
        sandy,
        jobs: picked.map(({ job }) => ({ spec: job.spec, at: job.at, output: path.join(engine.outputDir, job.spec.name) })),
        threads: engine.threads ?? vegetationEngineThreads(),
        onSpawn: engine.onSpawn,
        scratchRoot: engine.scratch,
        onProgress: (progress) => {
          engineShown.done = Math.max(engineShown.done, done + progress.done);
          engineShown.maps = Math.max(engineShown.maps, (stageDone.get("maps") || 0) + progress.done);
          onProgress?.(progressOf("maps", null));
        },
        /* Пачек у сборки несколько (файлы игры, карты травы): время потоков — суммой по всем, число потоков — наибольшее. */
        onTimings: ({ threads, ...stages }) => {
          const total = engineClock.stages || { threads: 0 };
          for (const [stage, ms] of Object.entries(stages)) total[stage] = (total[stage] || 0) + ms;
          total.threads = Math.max(total.threads, threads || 0);
          engineClock.stages = total;
        },
      });
    } catch (error) {
      engineClock.fallbacks.push({ name: "*", reason: String(error?.message || error).slice(0, 160) });
      return null;
    } finally {
      engineClock.ms += Date.now() - from;
    }
    const batch = new Map();
    picked.forEach(({ job, key }, index) => {
      const result = results[index];
      engineClock.jobs += 1;
      if (result.status === "fallback") engineClock.fallbacks.push({ name: job.spec.name, reason: String(result.reason || "").slice(0, 160) });
      else {
        if (result.status === "built") engineClock.built += 1;
        batch.set(job, { ...result, key });
      }
    });
    return batch;
  };

  /* Файлы идут по порядку на подготовке и в итог; работа над ними — разом. */
  const run = async (jobs) => {
    if (planOnly) {
      for (const job of jobs) {
        /* `count` — только список заданий и их этапы, файлы не читаются (подсчёт до сборки). */
        const counting = planOnly === "count";
        const { bytes, plain } = counting ? { bytes: null, plain: false } : await readSource(job).catch(() => ({ bytes: null, plain: false }));
        const record = {
          name: job.spec.name,
          group: job.spec.group || "",
          at: job.at,
          bytes: bytes ? bytes.length : 0,
          missing: !counting && !bytes,
          reasons: planReasons(job.spec),
          stage: vegetationStageOf(job.spec),
        };
        /* Обратный вызов — для замера: по файлу с байтами источника (сжатый выход — то, что идёт в пакет). */
        if (typeof planOnly === "function" && bytes) Object.assign(record, await planOnly({ job, bytes, plain }));
        /* Подсчёт с памятью сборки: файл, который она уже собирала из того же исходника, известен с точным размером — без чтения игры. */
        if (counting && cache) record.known = await knownSizeOf(job);
        if (counting && planSizes) record.estimate = record.known || (await sourceSizeOf(job));
        /* Подсчёт с размерами открывает оглавления архивов и идёт десятки секунд: окно видит, что он движется. */
        if (counting && onCount && (planned.length + 1) % COUNT_REPORT_EVERY === 0) onCount(planned.length + 1);
        planned.push(record);
        taken.add(job.spec.name);
      }
      return;
    }
    const engineBatch = await engineBatchOf(jobs);
    const limit = poolAlive ? Math.max(1, pool.size) * 2 : 1;
    const flight = [];
    const settle = async () => {
      const waitFrom = Date.now();
      const outcome = await flight.shift();
      clock.waitMs += Date.now() - waitFrom;
      const absorbFrom = Date.now();
      await absorb(outcome);
      clock.absorbMs += Date.now() - absorbFrom;
    };
    try {
      for (const job of jobs) {
        const prepareFrom = Date.now();
        const prepared = await prepare(job, engineBatch);
        clock.prepareMs += Date.now() - prepareFrom;
        clock.jobs += 1;
        if (prepared.bytes || prepared.engine) clock.built += 1;
        const task = work(prepared);
        /* Ошибка дождётся своей очереди в `settle`, а не всплывёт без хозяина. */
        task.catch(() => {});
        flight.push(task);
        while (flight.length >= limit) await settle();
      }
      while (flight.length) await settle();
    } finally {
      await Promise.allSettled(flight);
    }
  };

  /* Улучшенные модели — первыми: их имена занимают места моделей игры. */
  if (project.improved.enabled && game.improved) {
    const jobs = [];
    for (const entry of game.improved.entries) {
      const name = entry.split("/").pop().toLowerCase();
      if (!allowed.has(name) || taken.has(name)) continue;
      taken.add(name);
      jobs.push({ entry, spec: { kind: "improved", name } });
    }
    await run(jobs);
  }

  /*
   * «В разнобой»: копии моделей и словарей на каждое место палитры, кроме
   * нулевого (его несут сами модели игры). Копия снимается с того, что
   * стоит под именем модели в игре: «Реалистичные деревья», если они
   * включены, иначе модель игры (или её вид у другого набора Astral).
   */
  const variety = varietyActive(project.variety) && (project.variety.trees || project.variety.bushes) ? project.variety : null;
  const slots = variety ? varietySlots(variety) : [];
  const varietyPlan = slots.length > 1 ? game.variety || (await openVegetationVariety()) : null;
  const clones = [];
  if (varietyPlan) {
    const improvedEntries = project.improved.enabled && game.improved ? new Map(game.improved.entries.map((entry) => [entry.split("/").pop().toLowerCase(), entry])) : new Map();
    const dictionaries = new Map((varietyPlan.dictionaries || []).map((entry) => [entry.name, entry]));
    const jobs = [];
    const wantedDictionaries = new Map();
    /* Вид со своим цветом палитру побеждает: его деревья — модели игры, перекрашенные цветом вида (`trees.bySpecies`), копий нет. */
    const painted = varietyPainted(project);
    for (const item of varietyPlan.archetypes) {
      if (!(item.group === "bush" ? variety.bushes : variety.trees)) continue;
      if (painted(item)) continue;
      const entry = improvedEntries.get(item.model) || null;
      const ext = item.model.split(".").pop();
      /* Густота — как у листвы деревьев; у кустов — как в игре (у кустов своей густоты нет). */
      const foliage = item.group === "bush" ? 100 : project.trees.foliage;
      const txdLeaves = entry ? item.improvedTxdLeaves || [] : item.txdLeaves;
      for (let slot = 1; slot < slots.length; slot += 1) {
        const name = varietyCloneName(item.name, slot);
        jobs.push({
          at: item.modelAt,
          ...(entry ? { entry } : {}),
          spec: { kind: "variety", name: `${name}.${ext}`, source: item.model, from: entry ? "improved" : "game", group: item.group, colour: slots[slot].colour, foliage },
        });
        const txd = txdLeaves.length && item.txd && dictionaries.has(item.txd) ? varietyCloneName(item.txd, slot) : null;
        if (txd && !wantedDictionaries.has(txd)) {
          const own = dictionaries.get(item.txd);
          wantedDictionaries.set(txd, {
            at: own.at,
            spec: { kind: "variety", name: `${txd}.ytd`, source: `${item.txd}.ytd`, from: "game", group: item.group, colour: slots[slot].colour, foliage, leaves: own.leaves },
          });
        }
        clones.push({ slot, ytyp: item.ytyp, archetype: item.name, name, model: `${name}.${ext}`, ...(txd ? { txd } : {}) });
      }
    }
    await run([...jobs, ...wantedDictionaries.values()].filter((job) => !taken.has(job.spec.name)));
    /* Карты районов смотрят на копии по месту: копии без модели или словаря
       в пакете — дерево-невидимка в игре. Не легла хоть одна — отказ словами. */
    const lost = [...new Set(clones.flatMap((clone) => [clone.model, ...(clone.txd ? [`${clone.txd}.ytd`] : [])]))].filter((name) => !taken.has(name));
    if (lost.length) throw new Error(`Копии «В разнобой» не собрались: нет ${lost.slice(0, 4).join(", ")}${lost.length > 4 ? ` и ещё ${lost.length - 4}` : ""} — файлы игры не прочитались.`);
  }
  /* Склад деревьев — около 770 МБ в памяти; дальше (файлы игры, пакет, помощник RPF) он не нужен:
     на ПК с 8 ГБ эти гигабайты были разницей между сборкой и подкачкой (13.10.2026). */
  /* Подсчёт до сборки (`planOnly`) склад не отпускает: сборка за ним придёт следом и читает его (ошибка «уже отпущен»). */
  if (!planOnly) game.improved?.release?.();
  /* Постоянные типы копий — все копии легли в пакет (иначе отказ выше). */
  if (clones.length && !planOnly) await varietyTypes(clones);

  /*
   * Файлы игры с правками: листва моделей, карточки вдали и трава зон.
   * Один словарь бывает и тем, и другим (карточки деревьев и земля района в
   * одном словаре дальнего плана) — правки ложатся вместе за одно чтение.
   */
  const jobs = new Map();
  const jobOf = (name, at, zone = null) => {
    if (!jobs.has(name)) jobs.set(name, { at, spec: { kind: "game", name } });
    const spec = jobs.get(name).spec;
    if (zone) spec.zone = zone;
    return spec;
  };
  /* Покраска: зона, чьим цветом травы красятся спрайты процедурной травы и
     наземные растения (одни файлы на весь мир). Только когда своим цветом
     красятся обе зоны, — иначе цвет одной зоны лёг бы и на другую
     (`sharedGrassZone`, владелец 25.10.2026). */
  const plantZone = sandy ? sharedGrassZone(project) : null;
  /* У словаря с местом (дальний план квартала с карточками растений) — своя
     зона: город как в игре — его карточки тоже как в игре. */
  const plantZoneOf = (name) => {
    const area = areaOfMapName(name);
    const own = sandy?.plan.zones?.[name] || (area === "city" ? "city" : area ? "country" : null);
    return own ? (looks.sandy.zones[own]?.look ? own : null) : plantZone;
  };
  /* Листва: деревья — облик деревьев, кусты — облик кустов (свой цвет, как
     листва или как в игре). Карточки вдали — каждая своим. Покраска: наземные
     растения (группы растений, клевер, папоротники) при своём цвете травы —
     цветом травы, как трава вокруг них. */
  for (const tree of inventory.trees) {
    const groundZone = isGroundCoverFile(tree.name) ? plantZoneOf(tree.name) : null;
    if (groundZone) {
      Object.assign(jobOf(tree.name, tree.at), { plants: tree.leaves, plantZone: groundZone });
      continue;
    }
    const group = isBushFile(tree.name) ? "bush" : "tree";
    if (group === "bush" ? bushLook : treesActive) Object.assign(jobOf(tree.name, tree.at), { leaves: tree.leaves, species: tree.species, group });
  }
  /* Покраска: листва деревьев шейдерами `trees_*` в моделях карт (кедры дальних
     групп `*_props_combo*_slod_children`, пальмы отражений) — обликом деревьев. */
  if (treesActive)
    for (const item of world?.leaves || []) {
      const spec = jobOf(item.name, item.at);
      if (!spec.leaves) Object.assign(spec, { leaves: item.textures, species: item.species, group: "tree" });
    }
  for (const lod of inventory.treeLods) {
    const groundZone = plantZoneOf(lod.name);
    const ground = groundZone ? lod.textures.filter((texture) => isGroundCoverCard(texture)) : [];
    const cards = lod.textures.filter((texture) => !ground.includes(texture) && (isBushCard(texture) ? bushLook : treesActive));
    if (cards.length) jobOf(lod.name, lod.at).cards = cards;
    if (ground.length) Object.assign(jobOf(lod.name, lod.at), { plants: ground, plantZone: groundZone });
  }
  /* Живые изгороди карт районов: листы по имени в своих словарях и моделях.
     Покраска: и палитры тинта изгородей и плюща (`bh1_18_bigivy_pal`). */
  if (bushLook?.hedges && bushLook.compiled)
    for (const hedge of world?.hedges || []) {
      const spec = jobOf(hedge.name, hedge.at);
      if (hedge.textures?.length) spec.hedges = hedge.textures;
      if (hedge.palettes?.length) spec.hedgePalettes = hedge.palettes;
    }
  /* Трава зон: только включённые; зона файла — из плана. */
  const zoneLook = (zone) => looks.sandy.zones[zone || "country"] || { enabled: false };
  const zoneOf = (item) => item.zone || sandy?.plan.zones?.[item.name] || "country";
  if (sandy) {
    for (const target of sandy.plan.targets) if (zoneLook(zoneOf(target)).enabled) jobOf(target.name, target.at, zoneOf(target)).green = target.textures;
    /* Дальние планы: за городом — у мода и у своего цвета, в городе — газоны
       атласов только у своего цвета (мод город вдали не трогает). */
    for (const item of sandy.plan.distant || []) {
      const zone = zoneOf(item);
      const part = zoneLook(zone);
      if (part.enabled && (zone === "country" || part.look)) jobOf(item.name, item.at, zone).distant = true;
    }
    /* Штатная трава зоны — у своего цвета. */
    for (const item of sandy.plan.lawns || []) if (zoneLook(zoneOf(item)).look) jobOf(item.name, item.at, zoneOf(item)).lawns = item.textures;
    /* Покраска: палитры тинта земли с травой — у своего цвета зоны. */
    for (const item of sandy.plan.palettes || []) if (zoneLook(zoneOf(item)).look) jobOf(item.name, item.at, zoneOf(item)).palettes = item.textures;
    /* Покраска: процедурная трава — одни спрайты на весь мир. */
    if (plantZone) for (const item of sandy.plan.plants || []) Object.assign(jobOf(item.name, item.at), { plants: item.textures, plantZone });
  }
  await run([...jobs.values()].filter((job) => !taken.has(job.spec.name)));
  if (planOnly) return { planned, report, files: [] };

  if (sandy) {
    /* Наклейки краёв пустыни, которые мод опустошил, — его пустышками. */
    for (const stub of sandy.plan.stubs) {
      if (taken.has(stub.name) || !zoneLook(zoneOf(stub)).enabled) continue;
      const bytes = sandy.stub(stub.name);
      if (!bytes) continue;
      const file = { kind: "stub", name: stub.name, sha256: sha256(bytes), size: bytes.length };
      if (sink) await sink({ ...file, bytes });
      else file.bytes = bytes;
      admit(file);
      taken.add(stub.name);
      report.stubs += 1;
    }
  }
  /* Карты травы: экземпляры травы зоны (и из дополнений: пакет
     растительности грузится после них) — своим цветом травы по точке каждой
     травинки, у мода и «как в игре» их цвет штатный; цветы — на месте
     мелкой травы выбранных районов (или «без цветов»). Одна карта — одной
     сборкой. */
  /* Посадка: что встаёт по плану засаженности — ряды и деревья полос в
     карты районов, клумбы в карты травы (`plantingSelection`). */
  const planting =
    project.density.value > 0 && (project.density.roads || project.density.medians)
      ? plantingSelection(game.planting || (await openVegetationPlanting()), project)
      : null;
  const varietyGrass = varietyActive(project.variety) && project.variety.grass && varietySlots(project.variety).length > 1;
  if (grassPlan) {
    const flowersOn = project.flowers.mode !== "game";
    const grassMaps = grassPlan.grass || inventory.sandy.grass.map((item) => ({ ...item, zone: "country" }));
    const grassZoneOf = (item) => item.zone || grassPlan.zones?.[item.name] || "country";
    await run(
      grassMaps
        .map((grass) => {
          const area = areaOfMapName(grass.name);
          const flowers = flowersOn && Boolean(area) && project.flowers.areas.includes(area);
          const colour = Boolean(sandy) && Boolean(zoneLook(grassZoneOf(grass)).look);
          /* Посадка: клумбы — новые пачки цветов той же карты. */
          const beds = planting?.beds.get(grass.name)?.batches;
          /* «В разнобой»: травинки всех карт травы — пятнами палитры. */
          const varied = varietyGrass;
          return flowers || colour || beds || varied
            ? { at: grass.at, spec: { kind: "grass", name: grass.name, zone: grassZoneOf(grass), area, flowers, ...(beds ? { beds } : {}), ...(varied ? { variety: true } : {}) } }
            : null;
        })
        .filter((job) => job && !taken.has(job.spec.name)),
    );
  }
  /* Деревья районов из описи мира: виды перемешки и засаженность — только
     в выбранных районах, одной правкой карты. Посадка: леса гуще — часть
     «Леса» (не в городе), ряды вдоль дорог и деревья полос — в те же карты
     районов или в свои карты-хозяйки плана. */
  const mixIn = (area) => project.forest.enabled && project.forest.areas.includes(area);
  const plantIn = (area) => densityForestsIn(project.density, area);
  const rowsOf = (name) => planting?.rows.get(name)?.rows || null;
  /* «В разнобой»: карты, где стоят деревья (кусты) включённой группы. */
  const varietyMaps = new Map(
    (varietyPlan?.maps || []).filter((map) => (variety.trees && map.trees) || (variety.bushes && map.bushes)).map((map) => [map.name, map]),
  );
  const forestMaps = (world?.forest?.maps || []).filter((map) => (mixIn(map.area) || plantIn(map.area) || rowsOf(map.name) || varietyMaps.has(map.name)) && !taken.has(map.name));
  const forestNames = new Set(forestMaps.map((map) => map.name));
  const rowHosts = [...(planting?.rows.values() || [])].filter((item) => !forestNames.has(item.name) && !taken.has(item.name));
  const rowNames = new Set(rowHosts.map((item) => item.name));
  const varietyOnly = [...varietyMaps.values()].filter((map) => !forestNames.has(map.name) && !rowNames.has(map.name) && !taken.has(map.name));
  if (forestMaps.length || rowHosts.length || varietyOnly.length) {
    const ground = forestMaps.some((map) => plantIn(map.area)) ? await groundOf(project.density.areas.filter((area) => plantIn(area))) : null;
    await run([
      ...forestMaps.map((map) => {
        const plant = plantIn(map.area) ? { count: Math.round((map.trees * project.density.value) / 100), points: ground.within(map.box) } : null;
        const rows = rowsOf(map.name);
        return {
          at: map.at,
          spec: {
            kind: "forest",
            name: map.name,
            area: map.area,
            mix: mixIn(map.area),
            ...(plant?.points.length ? { plant } : {}),
            ...(rows ? { rows } : {}),
            ...(varietyMaps.has(map.name) ? { variety: true } : {}),
          },
        };
      }),
      ...rowHosts.map((item) => ({
        at: item.at,
        spec: { kind: "forest", name: item.name, area: item.area, mix: false, rows: item.rows, ...(varietyMaps.has(item.name) ? { variety: true } : {}) },
      })),
      ...varietyOnly.map((map) => ({ at: map.at, spec: { kind: "forest", name: map.name, area: map.area, mix: false, variety: true } })),
    ]);
  }
  /* Время раздатчика — отдельно от отчёта: отчёт двух сборок одного и того же обязан совпадать, а секунды у них свои. */
  return {
    files,
    report,
    timings: engineClock.jobs || engineClock.fallbacks.length
      ? { ...clock, engineJobs: engineClock.jobs, engineBuilt: engineClock.built, engineMs: engineClock.ms, ...(engineClock.stages ? { engine: engineClock.stages } : {}), engineFallbacks: engineClock.fallbacks.slice(0, 12) }
      : clock,
  };

  /*
   * «В разнобой»: постоянные типы копий — копии архетипов из типов игры
   * (нативный хост, `compile-place-types`, как у копий мест): имя и модель —
   * копии, словарь — копия словаря, если лист лежит в нём. Цвета 1–3 — в
   * первом файле, 4–5 — во втором (по 512 копий на файл). Собранные типы
   * помнятся по запросу и отпечаткам типов игры.
   */
  async function varietyTypes(list) {
    if (!list.length) return;
    if (typeof compile !== "function") throw new Error("Сборщик типов копий «В разнобой» не подключён — обновите Astral.");
    const byFile = new Map();
    for (const clone of list) {
      const name = varietyTypesOf(clone.slot);
      if (!byFile.has(name)) byFile.set(name, []);
      byFile.get(name).push(clone);
    }
    const root = staging || path.join(os.tmpdir(), "astral-vegetation-types");
    for (const typesName of VARIETY_TYPES) {
      const own = byFile.get(typesName);
      if (!own?.length || taken.has(`${typesName}.ytyp`)) continue;
      const directory = path.join(root, `${typesName}-${randomUUID()}`);
      await fs.mkdir(directory, { recursive: true });
      try {
        const sources = [];
        const ids = new Map();
        const stamps = [];
        for (const address of [...new Set(own.map((clone) => clone.ytyp))].sort()) {
          const bytes = await readOriginal(address.split("/").pop().toLowerCase(), address).catch(() => null);
          if (!bytes) throw new Error(`Типы игры ${address.split("/").pop()} не прочитались — копии «В разнобой» не собрать.`);
          const id = `s${ids.size + 1}`;
          const file = path.join(directory, `${id}.ytyp`);
          await fs.writeFile(file, bytes);
          ids.set(address, id);
          sources.push({ id, file });
          stamps.push(sha256(bytes));
        }
        const clones = own.map((clone) => ({
          source: ids.get(clone.ytyp),
          archetypeHash: joaatName(clone.archetype),
          name: clone.name,
          assetName: clone.name,
          ...(clone.txd ? { textureDictionary: clone.txd } : {}),
        }));
        const key = sha256(JSON.stringify({ version: VEGETATION_BUILD_VERSION, typesName, clones, stamps }));
        const hit = cache ? await cache.lookup(key) : null;
        let file = null;
        if (hit?.sha256 && (await place?.(hit.path, `${typesName}.ytyp`))) {
          cache.touch(key);
          file = { kind: "variety", name: `${typesName}.ytyp`, sha256: hit.sha256, size: hit.size, path: hit.path };
        } else {
          const request = path.join(directory, "request.json");
          const output = path.join(directory, `${typesName}.ytyp`);
          await fs.writeFile(request, JSON.stringify({ format: "astral.compile-place-types", version: 1, typesName, sources, clones }));
          await compile("compile-place-types", { input: request, output });
          const bytes = await fs.readFile(output);
          file = { kind: "variety", name: `${typesName}.ytyp`, sha256: sha256(bytes), size: bytes.length };
          cache?.remember(key, { sha256: file.sha256, size: file.size, kinds: ["variety"], counts: { varietyTypes: 1 } });
          if (sink) await sink({ ...file, bytes });
          else file.bytes = bytes;
        }
        admit(file);
        taken.add(file.name);
        report.varietyTypes += 1;
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /*
   * Земля под травой районов засаженности: места травинок карт травы,
   * одно на клетку 8 м, с поиском по рамке карты района (клетка 64 м).
   */
  async function groundOf(areas) {
    const cells = new Map();
    const CELL = 64;
    for (const grass of grassPlan?.grass || []) {
      if (!areas.includes(areaOfMapName(grass.name))) continue;
      const bytes = await readOriginal(grass.name, grass.at).catch(() => null);
      if (!bytes) continue;
      grassGroundPoints(bytes, (x, y, z) => {
        const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10);
      });
      await pause();
    }
    return {
      /* Точки в рамке деревьев карты с полем 20 м: новые деревья — среди старых. */
      within([minX, minY, maxX, maxY]) {
        const out = [];
        const margin = 20;
        for (let cx = Math.floor((minX - margin) / CELL); cx <= Math.floor((maxX + margin) / CELL); cx += 1)
          for (let cy = Math.floor((minY - margin) / CELL); cy <= Math.floor((maxY + margin) / CELL); cy += 1) {
            const list = cells.get(`${cx},${cy}`);
            if (!list) continue;
            for (let at = 0; at < list.length; at += 3)
              if (list[at] >= minX - margin && list[at] <= maxX + margin && list[at + 1] >= minY - margin && list[at + 1] <= maxY + margin)
                out.push(list[at], list[at + 1], list[at + 2]);
          }
        return out;
      },
    };
  }
}

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  await fs.rename(temporary, file);
}

/* Файл в пакет жёсткой ссылкой (то же хранилище — тот же диск), иначе копией — под тормозом записи, как любая запись сборки. */
async function linkOrCopy(source, target) {
  try {
    await fs.link(source, target);
  } catch {
    await copyBuiltFile(source, target);
  }
}

/*
 * Пределы пакета словами, до манифеста: доверие движка отвергло бы такой
 * пакет молча (`vegetation-manifest-trust.js`).
 *
 * Пакетов дополнения два, каждый — до 3,75 ГБ файлов: архив пакета держит меньше 4 ГиБ, самый большой у Rockstar
 * (`mpbattle`) — 3,98 млрд байт, то есть 3,71 ГиБ. Выше этого игру никто не проверял, поэтому потолок не поднят (18.11.2026).
 */
const PACK_LIMIT = 3.75 * GiB;
const STREAM_LIMIT = 1.5 * GiB;
/* Что делать человеку. Собранное остаётся в памяти сборки, пока помещается в предел кэша (`trimBuildMemory`), — обещать это словами нельзя. */
const SIZE_ADVICE = "Выключите «Реалистичные деревья» или одну из зон «Травы по миру» и нажмите «Применить» ещё раз.";
if (VEGETATION_DLC_PACKS.length !== 2 || VEGETATION_DLC_ALL_PACKS.length !== 3)
  throw new Error("Слова отказа по размеру растительности написаны под два пакета и под три — поправьте их вместе с числом пакетов.");
/*
 * Третий пакет (19.11.2026, `vegetation-dlc.js`): работа, которой двух пакетов мало, ложится в три — когда третий пакет включён
 * (`ASTRAL_VEGETATION_THIRD_PACK`, по умолчанию выключен: в игре три пакета не проверены). Раскладку выбирает
 * `chooseVegetationLayout` по собранным файлам; ранние отказы (оценка плана, счёт по ходу) при включённом третьем пакете считают
 * по трём пакетам — иначе они остановили бы работу, которая в три помещается.
 */
/** Раскладка, по которой считают ранние отказы: три пакета, если третий включён, иначе два. */
export const vegetationRefusalLayout = (env = process.env) => (vegetationThirdPackMode(env) === "off" ? VEGETATION_LAYOUT_TWO_PACKS : VEGETATION_LAYOUT_THREE_PACKS);
const threePacks = (layout) => layout === VEGETATION_LAYOUT_THREE_PACKS;

/*
 * Доля хода сборки 0…1 для строки «Подготовка» (владелец 18.11.2026: «оставь просто проценты», процент идёт с первой секунды
 * и не пропадает). Подсчёт заданий — первые 5 %: сколько заданий будет, до его конца не известно, поэтому доля растёт по
 * числу уже посчитанных и к пределу только приближается. Сборка — до 98 % по числу готовых файлов из всех. Упаковка — 98 %;
 * 100 % ставит окно, когда план ответил.
 */
const COUNT_REPORT_EVERY = 100;
const COUNT_SHARE = 0.05;
const BUILD_SHARE = 0.93;
const COUNT_HALF_AT = 1500;

/** Обёртка хода: каждое событие получает `fraction` — долю 0…1, которая не убывает. */
export function vegetationProgressFraction(onProgress) {
  let fraction = 0;
  return (progress) => {
    let next = fraction;
    if (progress?.phase === "count") next = COUNT_SHARE * (1 - Math.exp(-(Number(progress.counted) || 0) / COUNT_HALF_AT));
    else if (progress?.phase === "read") next = COUNT_SHARE;
    else if (progress?.phase === "build" && progress.total > 0) next = COUNT_SHARE + BUILD_SHARE * Math.min(1, (Number(progress.done) || 0) / progress.total);
    else if (progress?.phase === "pack") next = COUNT_SHARE + BUILD_SHARE;
    fraction = Math.min(1, Math.max(fraction, next));
    onProgress?.({ ...progress, fraction });
  };
}

/* Какая доля несжатого файла склада «Реалистичных деревьев» остаётся после сжатия в пакете — для оценки по плану. */
const IMPROVED_PACKED_SHARE = 0.8;
/* Оценка по плану не точна: заранее отказываем, только когда пакет выходит больше предела с запасом; на границе решает счёт по ходу. */
const ESTIMATE_REFUSAL_MARGIN = 1.04;

/** Отказ до сборки по оценке плана: `{0}` — сколько примерно выйдет, гигабайт. */
export const vegetationWillNotFitText = (totalBytes, layout = VEGETATION_LAYOUT_TWO_PACKS) =>
  threePacks(layout)
    ? `Растительность не поместится в игру: по расчёту выйдет около ${(totalBytes / GiB).toFixed(1)} ГБ, а три её пакета держат не больше 3,75 ГБ каждый. Выключите «Реалистичные деревья» или одну из зон «Травы по миру» и нажмите «Применить» ещё раз.`
    : `Растительность не поместится в игру: по расчёту выйдет около ${(totalBytes / GiB).toFixed(1)} ГБ, а два её пакета держат не больше 3,75 ГБ каждый. Выключите «Реалистичные деревья» или одну из зон «Травы по миру» и нажмите «Применить» ещё раз.`;

/** Пакет, который по оценке плана заведомо не поместится: байты по пакетам; `null` — помещается или оценка на границе. */
export function vegetationEstimateOverflow(estimated, { packLimit = PACK_LIMIT, margin = ESTIMATE_REFUSAL_MARGIN, layout = VEGETATION_LAYOUT_TWO_PACKS } = {}) {
  const packs = new Map();
  for (const file of estimated || []) {
    const pack = vegetationPackOf(file.name, layout).name;
    packs.set(pack, (packs.get(pack) || 0) + (Number(file.size) || 0));
  }
  return [...packs.values()].some((bytes) => bytes > packLimit * margin) ? packs : null;
}

/** Отказ «не помещается» после полной сборки: сколько вышло всего. Вставка `{0}` — число гигабайт (шаблон словаря окна). */
export const vegetationTooBigText = (totalBytes, layout = VEGETATION_LAYOUT_TWO_PACKS) =>
  threePacks(layout)
    ? `Растительность вышла ${(totalBytes / GiB).toFixed(1)} ГБ и не помещается в игру: три её пакета держат не больше 3,75 ГБ каждый. ${SIZE_ADVICE}`
    : `Растительность вышла ${(totalBytes / GiB).toFixed(1)} ГБ и не помещается в игру: два её пакета держат не больше 3,75 ГБ каждый. ${SIZE_ADVICE}`;
/** Отказ по ходу сборки: пакет перерос предел, дальше собирать незачем. */
export const VEGETATION_TOO_BIG_EARLY = `Растительность не помещается в игру: один из двух её пакетов выходит больше 3,75 ГБ. ${SIZE_ADVICE}`;
/** То же у работы на три пакета. */
export const VEGETATION_TOO_BIG_EARLY_THREE = `Растительность не помещается в игру: один из трёх её пакетов выходит больше 3,75 ГБ. ${SIZE_ADVICE}`;
export const VEGETATION_STREAM_TOO_BIG = "Растительность не делится на части пакета по 1,5 ГБ — отключите одну из зон «Травы по миру».";

/**
 * Счёт размера пакетов по ходу сборки: `add(file)` бросает отказ, как только пакет перерос предел. Прежде размер
 * сверялся один раз, после всей сборки: тестер альфы 0.9.0-beta.108 ждал 6,5 минуты с диском под 100 % ради отказа.
 */
export function createVegetationSizeTally({ packLimit = PACK_LIMIT, layout = VEGETATION_LAYOUT_TWO_PACKS } = {}) {
  const packs = new Map();
  let total = 0;
  return {
    add(file) {
      const pack = vegetationPackOf(file.name, layout).name;
      const size = Number(file.size) || 0;
      const bytes = (packs.get(pack) || 0) + size;
      packs.set(pack, bytes);
      total += size;
      if (bytes > packLimit) throw new Error(threePacks(layout) ? VEGETATION_TOO_BIG_EARLY_THREE : VEGETATION_TOO_BIG_EARLY);
    },
    packs: () => new Map(packs),
    /** Сколько байт пакета уже собрано. */
    total: () => total,
  };
}

export function assertPackageSize(files, mapNames = null, { packLimit = PACK_LIMIT, streamLimit = STREAM_LIMIT, layout = VEGETATION_LAYOUT_TWO_PACKS } = {}) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const packs = new Map();
  for (const file of files) {
    const pack = vegetationPackOf(file.name, layout).name;
    packs.set(pack, (packs.get(pack) || 0) + file.size);
  }
  if ([...packs.values()].some((bytes) => bytes > packLimit)) throw new Error(vegetationTooBigText(total, layout));
  const streams = new Map();
  /* Архив файла в пакете: часть по имени, файлы сетевой карты — в архиве `GROUP_MAP`. */
  for (const file of files) {
    const stream = vegetationArchiveOf(file.name, mapNames, layout);
    streams.set(stream, (streams.get(stream) || 0) + file.size);
  }
  if ([...streams.values()].some((bytes) => bytes > streamLimit)) throw new Error(VEGETATION_STREAM_TOO_BIG);
}

/*
 * Число файлов пакета словами: движок отказал бы «Пакет содержит слишком
 * много файлов» (`VEGETATION_FILE_LIMIT`). Больше всех файлов даёт
 * «В разнобой» у кустов — кусты стоят в четырёх тысячах карт районов.
 */
export function vegetationFileLimitText(count, input, report = {}) {
  if (count <= VEGETATION_FILE_LIMIT) return null;
  const project = normalizeVegetationProject(input);
  const variety = varietyActive(project.variety);
  const hint =
    variety && project.variety.bushes
      ? `«В разнобой» у кустов правит ${report.varietyMaps || 0} карт районов — выключите его у кустов или засаженность.`
      : variety
        ? "Уберите цвет из палитры «В разнобой» или выключите засаженность."
        : "Выключите засаженность или одну из зон «Травы по миру».";
  return `Растительность вышла ${count} файлов — больше ${VEGETATION_FILE_LIMIT}, сколько игра берёт в пакет. ${hint}`;
}

/*
 * Переименование папки пакета с терпением (18.11.2026). Windows отказывает (`EPERM`), пока хоть один файл внутри папки
 * кто-то держит: антивирус проверяет только что записанное, перепись кэша (`storage-census.js`) обходит папку. На стенде
 * в Electron сборка 4,9 ГБ за две минуты дошла до конца и упала на этом переименовании — вся работа насмарку. Держат
 * такие файлы миллисекунды, перепись — секунды: ждём до 15 с.
 */
const PACKAGE_RENAME = Object.freeze({ retries: 60, pauseMs: 250 });
export const renamePackageFolder = (from, to, options = {}) => renameWhenFree(from, to, { ...PACKAGE_RENAME, ...options });

/**
 * Пакет растительности под работу: `{ setId, manifest, packageRoot, project, summary }`.
 *
 * `pool` — потоки сборки; `stores` — хранилища движка с файлами стоящей
 * растительности (`payloads/<мод>`): из них берутся запомненные файлы.
 */
export async function buildVegetationPackage(
  input,
  stateDir,
  { game, onProgress = null, composed = new Map(), pool = null, stores = [], compile = null, engine = null, sizeLimits = null } = {},
) {
  const project = normalizeVegetationProject(input);
  if (vegetationProjectIsVanilla(project)) throw new Error("Растительность как в игре — ставить нечего: снимите свою «Откатить».");
  const packages = path.join(stateDir || os.tmpdir(), "recolor", "vegetation", "packages");
  /* Файлы пишутся по мере сборки в черновик пакета; имя пакета (по его
     содержимому) известно только в конце. */
  const draft = path.join(packages, `.build-${randomUUID()}`);
  const payload = path.join(draft, "payload");
  await fs.mkdir(payload, { recursive: true });
  /* Память сборки пишется и при отказе (18.11.2026): собранные файлы уже лежат в хранилище содержимого, и повтор после
     «не помещается» или сбоя берёт их готовыми, а не красит заново. Запись без файла в хранилище память не находит (`lookup`). */
  let cache = null;
  let cacheSaved = false;
  try {
    /* Хранилище содержимого (`content`): каждый собранный файл лежит тут под своим SHA-256, чтобы
       повтор того же плана взял его, а не перекрашивал (пункт 1 ТЗ, 22.10): до этого хранилищем
       служили только установленные пакеты, и плана без установки повтор не находил ничего. */
    const content = stateDir ? path.join(stateDir, "recolor", "vegetation", "content") : null;
    cache = stateDir ? await openVegetationBuildCache({ stateDir, stores: content ? [...stores, content] : stores }) : null;
    const place = async (source, name) => {
      try {
        await linkOrCopy(source, path.join(payload, name));
        return true;
      } catch {
        return false;
      }
    };
    /* Отпечаток файла уже посчитан тем, кто его собрал (`file.sha256`: поток сборки или эта же функция): второй раз 6,6 ГБ
       пакета здесь не хэшируются; папка хранилища заводится один раз, а не на каждый файл (14.11.2026). */
    let contentReady = null;
    /* Файл уже лежит в пакете (его написал движок): остаётся положить его и в хранилище содержимого. */
    const keep = async (file) => {
      if (!content) return;
      contentReady ||= fs.mkdir(content, { recursive: true });
      await contentReady;
      const kept = path.join(content, file.sha256);
      if (await fs.stat(kept).catch(() => null)) return;
      await linkOrCopy(path.join(payload, file.name), kept).catch(() => {});
    };
    /* Запись собранного — под потолком и отдыхом диска обычного режима (`built-file-write.js`): прежде она шла без тормоза. */
    const sink = async (file) => {
      await writeBuiltFile(path.join(payload, file.name), file.bytes, { flag: "wx" });
      await keep(file);
    };
    const staging = path.join(stateDir || os.tmpdir(), "recolor", "vegetation", "types");
    /* Ход с долей 0…1: с этого места все события идут через обёртку. */
    const emit = onProgress ? vegetationProgressFraction(onProgress) : null;
    /* Подсчёт заданий до сборки: «N из M» в строке — честное число, а не оценка наперёд. */
    emit?.({ step: "vegetation", phase: "count", counted: 0 });
    const plan = emit
      ? await countVegetationPlan(project, game, {
          composed,
          compile,
          cache,
          sizes: true,
          onCount: (counted) => emit({ step: "vegetation", phase: "count", counted }),
        })
      : null;
    /* Проверка размера до сборки (18.11.2026): файлы, что память сборки уже знает, считаются с точным размером. Их одних
       хватило на перерост пакета — отказ сразу, без чтения игры и диска под 100 %. Первая сборка такой работы памяти
       не имеет: её останавливает счёт по ходу (`createVegetationSizeTally`). */
    /* Третий пакет включён — ранние отказы считают по трём пакетам: работа, что в два не лезет, а в три помещается, должна собраться. */
    const earlyLimits = { ...(sizeLimits || {}), layout: vegetationRefusalLayout() };
    if (plan?.known?.length) {
      const before = createVegetationSizeTally(earlyLimits);
      for (const file of plan.known) before.add(file);
    }
    /* Оценка по плану: размеры исходников из оглавлений архивов игры и описи склада. Пакет выходит больше предела с запасом —
       отказ сейчас, за десятки секунд, а не после минут перекраски и гигабайт записи. */
    if (plan && vegetationEstimateOverflow(plan.estimated, earlyLimits)) throw new Error(vegetationWillNotFitText(plan.totalBytes, earlyLimits.layout));
    /* Размер пакетов считается по ходу: перерос — сборка останавливается сразу, а не после последнего файла. */
    const tally = createVegetationSizeTally(earlyLimits);
    /* Байты рядом с долей — пока окно читает их (см. `progressOf`): те же числа, что у событий сборки. */
    const byteProgress = () => (plan?.totalBytes > 0 ? { doneBytes: tally.total(), totalBytes: Math.max(plan.totalBytes, tally.total()) } : { doneBytes: tally.total() });
    /* Каждый архив игры, открытый впервые, — событие «Читаю архивы»: N из M по плану. */
    if (plan && typeof game?.read === "function") {
      game.onArchive = (label, opened) =>
        emit?.({ step: "vegetation", phase: "read", archivesDone: opened, archivesTotal: plan.archives.length, lastName: label, ...byteProgress() });
    }
    /* Движок пишет готовые файлы прямо в пакет (`payload`); без выключателя `ASTRAL_VEGETATION_ENGINE=1` и пути к движку — потоки JS, как было. */
    const engineRun = engine?.executable ? { ...engine, outputDir: payload, adopt: keep } : null;
    const { files, report, timings } = await buildVegetationFiles(project, game, {
      onProgress: emit,
      composed,
      pool,
      cache,
      place,
      sink,
      compile,
      staging,
      plan,
      engine: engineRun,
      onFile: tally.add,
    });
    if (!files.length) throw new Error("Правка растительности не меняет ни одного файла игры — ставить нечего.");
    const mapNames = typeof game?.mapNames === "function" ? await game.mapNames().catch(() => null) : null;
    /* Раскладка работы: два пакета, пока она в них помещается; три — только когда двух мало и третий пакет включён. */
    const layout = chooseVegetationLayout(files, { mapNames });
    assertPackageSize(files, mapNames, { ...(sizeLimits || {}), layout });
    emit?.({ step: "vegetation", phase: "pack", ...byteProgress() });
    const tooMany = vegetationFileLimitText(files.length, project, report);
    if (tooMany) throw new Error(tooMany);
    const described = files.map((file) => ({ name: file.name, size: file.size, sha256: file.sha256 }));
    const manifest = buildVegetationManifest(described, { mapNames, layout });
    if (!isLocalVegetationManifest(manifest, "Legacy")) throw new Error("Собранная растительность не прошла строгую проверку доверия.");
    const packageRoot = path.join(packages, manifest.vegetation.sourceDigest.slice(7, 23));
    /* Пакет с тем же именем (тот же состав) уходит целиком, черновик встаёт
       на его место: недоубранный прежний не смешается с новым. */
    if (await fs.stat(packageRoot).catch(() => null)) {
      const old = `${packageRoot}.old-${randomUUID()}`;
      await renamePackageFolder(packageRoot, old);
      await fs.rm(old, { recursive: true, force: true }).catch(() => {});
    }
    await renamePackageFolder(draft, packageRoot);
    /* Отпечатки файлов известны — движку не нужно перечитывать пакет. */
    for (const file of files) await rememberSha256(path.join(packageRoot, "payload", file.name), file.sha256);
    cacheSaved = true;
    await cache?.save().catch(() => {});
    await pruneOldPackages(packages, packageRoot);
    return {
      setId: "vegetation",
      manifest,
      packageRoot,
      project,
      /* Отпечатки файлов пакета — для памяти отпечатков главного процесса,
         когда сборка шла в своём потоке (`vegetation-build-host.js`). */
      payloadFiles: files.map((file) => ({ name: file.name, sha256: file.sha256 })),
      summary: {
        trees: report.trees,
        lods: report.lods,
        improved: report.improved,
        grass: report.grass,
        instances: report.instances,
        /* «Трава по миру»: файлов земли мода, зелёных листов, пустышек краёв. */
        ground: report.sandy,
        /* Штатная трава зон в свой цвет: словарей и листов. */
        lawns: report.lawns,
        lawnTextures: report.lawnTextures,
        greenTextures: report.textures,
        stubs: report.stubs,
        /* Дальние планы зоны: файлов и листов мода, легших в них по имени. */
        distant: report.distant,
        distantSheets: report.distantSheets,
        /* Кусты своим обликом: файлов листвы кустов и словарей с листами изгородей. */
        bushes: report.bushes,
        hedges: report.hedges,
        /* Покраска: палитры тинта изгородей и земли с травой; словарей и спрайтов процедурной травы. */
        hedgePalettes: report.hedgePalettes,
        palettes: report.palettes,
        plants: report.plants,
        plantSprites: report.plantSprites,
        /* Цветы: карт травы, пачек цветов (и пачек травы у «без цветов»). */
        flowerMaps: report.flowerMaps,
        flowerBatches: report.flowerBatches,
        grassBatches: report.grassBatches,
        /* Деревья перемешки: карт районов и деревьев другого вида. */
        forestMaps: report.forestMaps,
        forestTrees: report.forestTrees,
        /* Засаженность: карт районов и новых деревьев. */
        plantedMaps: report.plantedMaps,
        plantedTrees: report.plantedTrees,
        /* Посадка: карт районов и деревьев рядов и полос, карт травы и пачек клумб. */
        rowMaps: report.rowMaps,
        rowTrees: report.rowTrees,
        bedMaps: report.bedMaps,
        bedBatches: report.bedBatches,
        /* «В разнобой»: цветов палитры, копий моделей и словарей, файлов типов, карт и сущностей на копиях. */
        variety: varietyActive(project.variety)
          ? {
              colours: varietySlots(project.variety).length,
              models: report.varietyModels,
              dictionaries: report.varietyDictionaries,
              types: report.varietyTypes,
              maps: report.varietyMaps,
              trees: report.varietyTrees,
            }
          : null,
        /* Файлы, собранные поверх правок других работ Astral (наборы и оптимизация): сколько и чьи. */
        composed: { count: report.composed.length, owners: [...new Set(report.composed.map((item) => item.owner))].slice(0, 12) },
        foliage: project.trees.foliage,
        sandy: project.sandy.enabled,
        missing: report.missing.slice(0, 8),
        changed: files.length,
        bytes: described.reduce((sum, file) => sum + file.size, 0),
        /* Оценка пакета по плану до сборки (0 — её не было): рядом с настоящим размером, чтобы сверять по журналам. */
        estimatedBytes: plan?.totalBytes || 0,
        /* Время раздатчика сборки: подготовка файлов, ожидание потоков, приём итогов; заданий всего и ушло в работу. */
        timings: timings ? { ...timings } : null,
        /* Отпечаток состава пакета (имена и SHA-256 файлов): по нему стенды сверяют, что сборка та же байт в байт. */
        sourceDigest: manifest.vegetation.sourceDigest,
      },
    };
  } finally {
    if (!cacheSaved) await cache?.save().catch(() => {});
    await fs.rm(draft, { recursive: true, force: true }).catch(() => {});
  }
}

/** Хранилища движка с файлами стоящей растительности — память сборки. */
export function vegetationStores(stateDir, installed = []) {
  return installed
    .map((item) => item?.modId)
    .filter((modId) => isVegetationModId(modId))
    .map((modId) => path.join(statePaths(stateDir).payloads, modId));
}

async function pruneOldPackages(directory, current) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (full === current) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}
