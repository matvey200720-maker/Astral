/*
 * Слои оптимизации: сборка у игрока, план и установка.
 *
 * Раздел в окне присылает только имя слоя. Главный процесс собирает пакет
 * слоя из двух источников и ставит его движком в свой контейнер или на своё
 * место в `update.rpf`:
 *
 *   патч   — файл берётся из игры игрока и правится по смыслу мода
 *            (`@modovik/optimizer/layer-patches.js`): грязь на кузове, дым
 *            колёс, тряска, следы, таймцикл, эмбиент и попадания пуль;
 *   файлы  — опись `resources/optimization/inventory.json`: пустышки мусора
 *            и травы, упрощённые полки, пустые наборы частиц, лёгкие
 *            текстуры. Пустышка встаёт только под именем, которое у игрока
 *            есть; файл мода — только если оригинал у игрока тот же, что у
 *            мода (иначе игра обновилась, и старая копия откатила бы её).
 *
 * Пропущенное не прячется: план отдаёт окну, сколько файлов встанет и
 * сколько и почему нет.
 *
 * Снимается слой корзиной библиотеки или переключателем — как любой мод
 * движка, по `layerModId` записи.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { appResourcesPath } from "./runtime-paths.js";
import { discoverGames } from "@modovik/game-discovery";
import { engineInstallEnabled, inspectProfile, planPackage, sha256File, uninstallPackage } from "@modovik/install-engine";
import { fingerprintSha256, rememberSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { mapLimit } from "@modovik/install-engine/map-limit.js";
import { governedPause } from "@modovik/install-engine/disk-governor.js";
import { smallFileLimit } from "@modovik/install-engine/disk-profile.js";
import { installLocalDrawDistancePackage, installLocalOptimizationPackage, installLocalTexturesPackage } from "@modovik/install-engine/local-packages.js";
import { isDrawDistanceModId } from "@modovik/install-engine/draw-distance-manifest-trust.js";
import {
  OPTIMIZATION_LAYERS_TRUST,
  buildOptimizationManifest,
  buildOptimizationSetManifest,
  isLocalOptimizationManifest,
  isLocalOptimizationSetManifest,
  isOptimizationModId,
  isOptimizationSetModId,
  optimizationLayersOfRecord,
  optimizationSetDigest,
} from "@modovik/install-engine/optimization-manifest-trust.js";
import { installRpfPrebuilt } from "./rpf-composer.js";
import { opsEngineInstall, opsRouteTools } from "./ops-install.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { isVegetationModId } from "@modovik/install-engine/vegetation-ids.js";
import { buildTexturesManifest, isLocalTexturesManifest, isTexturesModId, texturesSourceDigest } from "@modovik/install-engine/textures-manifest-trust.js";
import { TEXTURES_DLC_B_TARGET, TEXTURES_DLC_C_TARGET, texturesPackByTarget } from "@modovik/install-engine/textures-dlc.js";
import { OPTIMIZATION_LAYER_IDS, OPTIMIZATION_LAYER_MAP } from "@modovik/optimizer/layers.js";
import { GENERATED_TEXTURE_LAYERS, TEXTURE_LEVEL_LAYERS, textureLevelAt } from "@modovik/optimizer/texture-levels.js";
import { styleOfStages, textureLookCap, worldDetailOf, worldStages, worldStyleOf } from "@modovik/optimizer/texture-stages.js";
import {
  damageScreenTimecycleXml,
  drugEffectsTimecycleXml,
  isNormalMap,
  patchAmbientEntityFx,
  patchBulletImpacts,
  patchCarDirtDecals,
  patchCollisionParticles,
  patchExplosionShake,
  patchRegionAmbient,
  patchWheelSmoke,
  transparentTexturePayload,
} from "@modovik/optimizer/layer-patches.js";
import { openGameOffThread } from "./game-archive-client.js";

import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import {
  composeRpfArchive,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { patchResourceTextures, readResourceTextures } from "./recolor-textures.js";
import { MODEL_BUILD, textureLevelFiles } from "./texture-levels.js";
import { buildDrawDistancePackage, installedDrawDistance } from "./draw-distance.js";
import { callNativeEngine } from "./native-engine.js";
import { prepareTexturesDlcHost } from "./textures-dlc-host.js";
import { rebuildDependents, rememberLayerWork } from "./layer-works.js";

/* Читатель архивов остаётся здесь для прежних вызовов (`createGameReader`): его вынесли в модуль, который грузится и в потоке. */
export { createGameReader } from "./game-archive-reader.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_PLANS = 8;
const KEEP_PACKAGES = 3;

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
  await fs.rename(temporary, file);
}

function layerOf(layerId) {
  const id = String(layerId || "");
  const layer = OPTIMIZATION_LAYER_MAP[id];
  if (!layer || !OPTIMIZATION_LAYERS_TRUST[id]) throw new Error(`Слоя оптимизации «${id}» нет в этой версии Astral.`);
  return layer;
}

/* ------------------------------------------------------------------ *
 * Файлы рядом с приложением
 * ------------------------------------------------------------------ */

/**
 * Где лежат файлы слоёв: в собранном приложении — рядом с ресурсами, в
 * разработке — в репозитории. Переменная окружения — для тестов.
 */
export async function optimizationResourceRoot() {
  const candidates = [
    process.env.ASTRAL_OPTIMIZATION_RESOURCES,
    appResourcesPath() && path.join(appResourcesPath(), "optimization"),
    path.resolve(dirname, "../../../resources/optimization"),
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(path.join(candidate, "inventory.json"))) return candidate;
  throw new Error("Файлы слоёв оптимизации не найдены рядом с приложением — переустановите Astral.");
}

const inventories = new Map();
async function readInventory(root) {
  if (!inventories.has(root))
    inventories.set(
      root,
      fs.readFile(path.join(root, "inventory.json"), "utf8").then((text) => JSON.parse(text)),
    );
  return inventories.get(root);
}

/* Файл рядом с приложением — сверенный с описью: повреждённый или чужой
   файл уехал бы в игру молча. */
async function resourceFile(root, relative, expected) {
  const bytes = await fs.readFile(path.join(root, relative));
  if (expected && sha256(bytes) !== expected) throw new Error(`Файл ${relative} повреждён — переустановите Astral.`);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Игра игрока (только чтение)
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Сборка слоя
 * ------------------------------------------------------------------ */

const LIVE = {
  "car-dirt": "update:common/data/effects/decals.dat",
  "wheel-smoke": "update:common/data/effects/wheelfx.dat",
  "explosion-shake": "update:x64/data/metadata/explosion.ymt",
  decals: "update:x64/textures/fxdecal.ytd",
  ambient: "update:common/data/effects/entityfx.dat",
  "bullet-impacts": "update:common/data/effects/weaponfx.dat",
  /* Местности частиц (ТЗ 17.10.2026): в update.rpf их обычно нет — тогда
     файл берётся из базового архива, где его держит игра. */
  "ambient-region": ["update:x64/data/effects/vfxregioninfo.ymt", "x64a.rpf:data/effects/vfxregioninfo.ymt"],
  /* Частицы ударов и скольжения (ТЗ 05.11.2026): materialfx.dat игра держит
     в common.rpf; копия в update.rpf его перекрывает. */
  "collision-particles": ["update:common/data/effects/materialfx.dat", "common.rpf:data/effects/materialfx.dat"],
};

async function liveFile(reader, layerId) {
  const places = [LIVE[layerId]].flat();
  for (const at of places) {
    const bytes = await reader.read(at);
    if (bytes) return bytes;
  }
  throw new Error(`В архивах игры нет ${places[0].split("/").pop()} — сборка игры не та.`);
}

/* Слой-патч: файл игрока, правленный по смыслу мода. */
async function patchFiles(layerId, reader) {
  switch (layerId) {
    case "car-dirt": {
      const { text, changed } = patchCarDirtDecals((await liveFile(reader, layerId)).toString("latin1"));
      return { files: [{ name: "decals.dat", bytes: Buffer.from(text, "latin1") }], note: { rows: changed } };
    }
    case "wheel-smoke": {
      const { text, changed } = patchWheelSmoke((await liveFile(reader, layerId)).toString("latin1"));
      return { files: [{ name: "wheelfx.dat", bytes: Buffer.from(text, "latin1") }], note: { rows: changed } };
    }
    case "explosion-shake": {
      const { bytes, changed } = patchExplosionShake(await liveFile(reader, layerId));
      return { files: [{ name: "explosion.ymt", bytes: Buffer.from(bytes) }], note: { rows: changed } };
    }
    case "decals": {
      const original = await liveFile(reader, layerId);
      const textures = readResourceTextures(original, "fxdecal.ytd");
      const replacements = Object.fromEntries(
        textures.map((texture) => [
          texture.name,
          transparentTexturePayload(texture.format, texture.bytes, { normal: isNormalMap(texture.name) }),
        ]),
      );
      const { bytes } = patchResourceTextures(original, "fxdecal.ytd", replacements);
      return { files: [{ name: "fxdecal.ytd", bytes }], note: { rows: textures.length } };
    }
    case "drug-effects":
      return { files: [{ name: "timecycle_mods_4.xml", bytes: Buffer.from(drugEffectsTimecycleXml(), "utf8") }], note: {} };
    case "damage-screen":
      return { files: [{ name: "timecycle_mods_1.xml", bytes: Buffer.from(damageScreenTimecycleXml(), "utf8") }], note: {} };
    case "ambient": {
      const { text, changed, groups } = patchAmbientEntityFx((await liveFile(reader, layerId)).toString("latin1"));
      return { files: [{ name: "entityfx.dat", bytes: Buffer.from(text, "latin1") }], note: { rows: changed, groups } };
    }
    case "bullet-impacts": {
      const { text, changed } = patchBulletImpacts((await liveFile(reader, layerId)).toString("latin1"));
      return { files: [{ name: "weaponfx.dat", bytes: Buffer.from(text, "latin1") }], note: { rows: changed } };
    }
    case "collision-particles": {
      const { text, changed, kept } = patchCollisionParticles((await liveFile(reader, layerId)).toString("latin1"));
      return { files: [{ name: "materialfx.dat", bytes: Buffer.from(text, "latin1") }], note: { rows: changed, kept } };
    }
    case "ambient-region": {
      const { bytes, regions, gpu, changed } = patchRegionAmbient(await liveFile(reader, layerId));
      return { files: [{ name: "vfxregioninfo.ymt", bytes: Buffer.from(bytes) }], note: { rows: changed, regions, gpu } };
    }
    default:
      throw new Error(`Слой «${layerId}» собирается не патчем.`);
  }
}

/* Слой из описи: пустышки, файлы мода, лёгкие текстуры. */
async function inventoryFiles(layerId, reader, root) {
  const inventory = await readInventory(root);
  const layer = inventory.layers?.[layerId];
  if (!layer?.files?.length) throw new Error(`В описи нет слоя «${layerId}».`);
  const templates = new Map();
  const template = async (name) => {
    if (!templates.has(name)) templates.set(name, await resourceFile(root, `templates/${name}`, inventory.templates[name]?.sha256));
    return templates.get(name);
  };
  const pack = layer.pack ? await resourceFile(root, layer.pack) : null;
  const files = [];
  const skipped = { missing: 0, changed: 0 };
  for (const file of layer.files) {
    if (file.template) {
      if (!(await reader.has(file.at))) {
        skipped.missing += 1;
        continue;
      }
      files.push({ name: file.name, bytes: await template(file.template) });
      continue;
    }
    if (pack) {
      if (!(await reader.has(file.at))) {
        skipped.missing += 1;
        continue;
      }
      const bytes = pack.subarray(file.offset, file.offset + file.size);
      if (sha256(bytes) !== file.sha256) throw new Error("Файл лёгких текстур повреждён — переустановите Astral.");
      files.push({ name: file.name, bytes: Buffer.from(bytes) });
      continue;
    }
    /* Файл мода встаёт только поверх того же оригинала. Уже стоящий слой
       (запись в update.rpf) — тоже свой: пересборка его не теряет. */
    const original = await reader.read(file.base.at);
    if (!original) {
      skipped.missing += 1;
      continue;
    }
    const current = sha256(original);
    if (current !== file.base.sha256 && current !== file.sha256) {
      skipped.changed += 1;
      continue;
    }
    files.push({ name: file.name, bytes: await resourceFile(root, file.source, file.sha256) });
  }
  if (!files.length)
    throw new Error("Ни один файл слоя не подошёл к этой сборке игры — слой для неё не собрать.");
  return { files, note: { total: layer.files.length, skipped } };
}

/**
 * Собирает пакет слоя: `{ layerId, manifest, packageRoot, note }`.
 * `reader` — чтение игры (`createGameReader`), `root` — папка ресурсов.
 */
async function layerFiles(layerId, reader, resourceRoot) {
  /* Ступени «Ухудшения текстур» с 06.10.2026 ставятся своим пакетом
     дополнения (`planTextures`), а не слоем набора: на всю карту они в
     update.rpf не помещаются. Окно прежние слои из набора переносит. */
  if (GENERATED_TEXTURE_LAYERS.includes(layerId))
    throw new Error("Ступени текстур ставятся своим пакетом — обновите окно Astral и выберите ступень ещё раз.");
  const layer = layerOf(layerId);
  return layer.source === "files" ? inventoryFiles(layerId, reader, resourceRoot || (await optimizationResourceRoot())) : patchFiles(layerId, reader);
}

export async function buildOptimizationLayerPackage(layerId, stateDir, { reader, resourceRoot = null } = {}) {
  const built = await layerFiles(layerId, reader, resourceRoot);
  const described = built.files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: sha256(file.bytes) }));
  const manifest = buildOptimizationManifest(layerId, described);
  if (!isLocalOptimizationManifest(manifest, "Legacy")) throw new Error("Собранный слой не прошёл строгую проверку доверия.");
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "optimization",
    layerId,
    "packages",
    manifest.optimization.sourceDigest.slice("sha256:".length, "sha256:".length + 16),
  );
  for (const file of built.files) {
    const target = path.join(packageRoot, "payload", file.name);
    const current = await fs.readFile(target).catch(() => null);
    if (!current || !current.equals(file.bytes)) await atomicWrite(target, file.bytes);
  }
  await pruneOldPackages(path.dirname(packageRoot), packageRoot, await optimizationReplayNames(stateDir));
  return {
    layerId,
    manifest,
    packageRoot,
    note: built.note,
    files: described.map(({ name, size, sha256: hash }) => ({ name, size, sha256: hash })),
  };
}

/*
 * Набор слоёв (задача 8, 05.10.2026): все включённые слои — одним пакетом
 * движка (`buildOptimizationSetManifest`). Переключение карточки — одна
 * пересборка update.rpf на все её слои, а выключение — замена набора без
 * этого слоя, а не снятие корзиной (перемотка архива и повтор каждой работы
 * мастерской сверху). Файлы слоёв — те же; набор из тех же файлов — тот же
 * id, и движок берёт сборку из кэша. `{ layers, manifest, packageRoot, notes }`.
 */
export async function buildOptimizationSetPackage(layerIds, stateDir, { reader, resourceRoot = null } = {}) {
  const layers = [...new Set(layerIds.map(String))].sort();
  if (!layers.length) throw new Error("Набор без слоёв.");
  if (layers.filter((layerId) => TEXTURE_LEVEL_LAYERS.includes(layerId)).length > 1)
    throw new Error("Ступень «Ухудшения текстур» в наборе может быть только одна.");
  const built = [];
  const notes = {};
  for (const layerId of layers) {
    const files = await layerFiles(layerId, reader, resourceRoot);
    built.push({ layerId, files: files.files });
    notes[layerId] = files.note;
  }
  /* Файл слоя — байтами (собран в памяти) или путём с готовыми размером и
     отпечатком (ступень текстур из кэша). */
  const describe = (file) =>
    file.bytes ? { name: file.name, size: file.bytes.length, sha256: sha256(file.bytes) } : { name: file.name, size: file.size, sha256: file.sha256 };
  const manifest = buildOptimizationSetManifest(
    built.map(({ layerId, files }) => ({ layerId, files: files.map(describe) })),
  );
  if (!isLocalOptimizationSetManifest(manifest, "Legacy")) throw new Error("Собранный набор слоёв не прошёл строгую проверку доверия.");
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "optimization",
    "set",
    "packages",
    manifest.optimization.sourceDigest.slice("sha256:".length, "sha256:".length + 16),
  );
  for (const { layerId, files } of built)
    for (const file of files) {
      const target = path.join(packageRoot, "payload", layerId, file.name);
      if (!file.bytes) {
        await placeFile(file.path, target, file.size);
        continue;
      }
      const current = await fs.readFile(target).catch(() => null);
      if (!current || !current.equals(file.bytes)) await atomicWrite(target, file.bytes);
    }
  await pruneOldPackages(path.dirname(packageRoot), packageRoot, await optimizationReplayNames(stateDir));
  return { layers, manifest, packageRoot, notes };
}

/*
 * Ступень «Ухудшения текстур» на всю карту — своим пакетом движка в пакете
 * дополнения `astral_textures` (задача 1 ТЗ 05.10.2026). Файлы — словари
 * ступени из кэша (`texture-levels.js`) жёсткими ссылками.
 * `{ cap, manifest, packageRoot }`.
 */
export async function buildTexturesPackage(cap, files, stateDir) {
  /* `pack: "b"` — модель ЧБ-мира во втором пакете (`textureLevelFiles`). */
  const described = files.map((file) => ({ name: file.name, size: file.size, sha256: file.sha256, ...(file.pack && file.pack !== "a" ? { pack: file.pack } : {}) }));
  /* Сборка моделей — в манифест: по ней окно узнаёт пакет прежней сборки (`textures.modelBuild`, ТЗ 19.10.2026). */
  const manifest = buildTexturesManifest(cap, described, { modelBuild: MODEL_BUILD });
  if (!isLocalTexturesManifest(manifest, "Legacy")) throw new Error("Собранная ступень текстур не прошла строгую проверку доверия.");
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "optimization",
    "textures",
    "packages",
    manifest.textures.sourceDigest.slice("sha256:".length, "sha256:".length + 16),
  );
  await fs.mkdir(path.join(packageRoot, "payload"), { recursive: true });
  /* Сорок тысяч файлов — разом, а не по одному (06.10.2026, вечер), и
     отпечаток каждого запоминается: движок и проверка перед установкой
     берут его из памяти, а не перечитывают 2,4 ГБ. */
  await mapLimit(files, smallFileLimit(packageRoot), async (file) => {
    await governedPause(packageRoot);
    return placeFile(file.path, path.join(packageRoot, "payload", file.name), file.size, file.sha256);
  });
  await pruneOldPackages(path.dirname(packageRoot), packageRoot);
  return { cap, manifest, packageRoot };
}

/*
 * Ступень текстур на движке (шаг 3 фазы 7, многоархивный): DLC пакета (`astral_textures`, `_b`, `_c`) и регистрация
 * в update.rpf — одна точка и одна транзакция за флагом `ASTRAL_ENGINE_INSTALL=optimization-textures`. Запись
 * переигрывания держит файлы пакета с путями, размерами и отпечатками; предел ступени — в записи, чтобы дайджест
 * пересобрался тем же способом, что при сборке.
 */
export function texturesReplayRecord(built) {
  return {
    module: "optimization-textures",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.textures.sourceDigest,
    multi: true,
    order: {
      cap: built.manifest.textures.cap,
      files: built.manifest.files.map((file) => ({ source: file.source, target: file.target, entry: file.entry, size: file.size, sha256: file.sha256 })),
    },
  };
}

/*
 * Пакет ступени для переигрывания: файлы на месте, их размеры и SHA-256 — те, что в записи, и дайджест, пересобранный
 * из них, даёт тот же дайджест. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function texturesReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "ступень текстур");
  const digest = String(replay?.sourceDigest || "");
  const cap = replay?.order?.cap;
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !Number.isInteger(cap) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте ступень текстур заново.`);
  const packageRoot = path.join(path.resolve(String(stateDir || "")), "optimization", "textures", "packages", digest.slice("sha256:".length, "sha256:".length + 16));
  const files = [];
  for (const item of listed) {
    const file = path.join(packageRoot, String(item?.source || ""));
    const stat = item?.source ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите ступень текстур.`);
    const hash = await sha256File(file);
    if (hash !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите ступень текстур.`);
    files.push({ name: path.basename(String(item.source)), sha256: hash, pack: texturesPackByTarget(item.target)?.id || "a" });
  }
  if (`sha256:${texturesSourceDigest(cap, files)}` !== digest)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите ступень текстур.`);
  return { packageRoot, files };
}

/*
 * Файл кэша в пакет — жёсткой ссылкой, где том тот же (сотни мегабайт
 * ступени не копируются), иначе копией. Пакет движок только читает.
 */
async function placeFile(source, target, size, sha256 = "") {
  const stat = await fs.stat(target).catch(() => null);
  if (stat?.size !== size) {
    await fs.rm(target, { force: true });
    try {
      await fs.link(source, target);
    } catch {
      await fs.copyFile(source, target);
    }
  }
  /* Файл кэша назван своим SHA-256 и не переписывается на месте: его
     отпечаток известен без чтения. */
  if (sha256) await rememberSha256(target, sha256);
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
 * Запись переигрывания слоя оптимизации (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=optimization-layers`):
 * слой или набор слоёв, пакет, дайджест и список файлов. Файлы лежат в постоянной папке пакета в `stateDir`.
 */
export function optimizationLayerReplayRecord(built) {
  return {
    module: "optimization-layers",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.optimization.sourceDigest,
    order: { kind: "layer", layerId: built.layerId, files: built.files.map(({ name, size, sha256: hash }) => ({ name, size, sha256: hash })) },
  };
}

export function optimizationSetReplayRecord(built) {
  return {
    module: "optimization-layers",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.optimization.sourceDigest,
    order: {
      kind: "set",
      files: built.manifest.files.map((file) => ({ source: file.source, entry: file.entry, size: file.size, sha256: file.sha256 })),
    },
  };
}

/*
 * Пакет слоя для переигрывания: файлы на месте, их SHA-256 и размеры — те, что в записи, а дайджест,
 * пересобранный из них, даёт тот же дайджест. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function optimizationReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "слой оптимизации");
  const digest = String(replay?.sourceDigest || "");
  const order = replay?.order || {};
  const listed = Array.isArray(order.files) ? order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !listed.length || !["layer", "set"].includes(order.kind))
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте слой заново из мастерской.`);
  const root = path.resolve(String(stateDir || ""));
  const hex = digest.slice("sha256:".length, "sha256:".length + 16);
  const packageRoot = order.kind === "set"
    ? path.join(root, "optimization", "set", "packages", hex)
    : path.join(root, "optimization", String(order.layerId || ""), "packages", hex);
  const files = [];
  for (const item of listed) {
    const rel = order.kind === "set" ? String(item?.source || "") : `payload/${String(item?.name || "")}`;
    const file = path.join(packageRoot, rel);
    const stat = rel ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите слой из мастерской.`);
    const hash = await fingerprintSha256(file);
    if (hash !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите слой из мастерской.`);
    files.push(order.kind === "set"
      ? { layer: rel.split("/")[1], entry: item.entry, sha256: hash }
      : { name: item.name, size: stat.size, sha256: hash });
  }
  const same = order.kind === "set"
    ? optimizationSetDigest(files) === digest.slice("sha256:".length)
    : buildOptimizationManifest(order.layerId, files).optimization.sourceDigest === digest;
  if (!same)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите слой из мастерской.`);
  return { packageRoot, files };
}

/*
 * Пакеты слоёв, на которые ссылается установленная работа: их не уносит уборка. `null` — состояние не прочиталось.
 */
async function optimizationReplayNames(stateDir) {
  const profile = await inspectProfile({ stateDir }).catch(() => null);
  if (!profile) return null;
  const names = new Set();
  for (const target of Object.values(profile.targets || {}))
    for (const item of target?.installed || []) {
      const replay = item?.engineReplay;
      if (replay?.module === "optimization-layers")
        names.add(String(replay.sourceDigest || "").slice("sha256:".length, "sha256:".length + 16));
    }
  return names;
}

async function assertPackageIntact(built) {
  /* Разом и с отпечатками из памяти, где файл с тех пор не менялся (запись
     на томе, время, размер — `file-fingerprint.js`), иначе честным чтением. */
  await mapLimit(built.manifest.files, smallFileLimit(built.packageRoot, { fast: 32 }), async (file) => {
    await governedPause(built.packageRoot);
    const payload = path.join(built.packageRoot, file.source);
    if ((await fingerprintSha256(payload).catch(() => null)) !== file.sha256)
      throw new Error(`Файл слоя ${path.basename(payload)} изменился после проверки — включите слой ещё раз.`);
  });
}

/* ------------------------------------------------------------------ *
 * Игра и движок
 * ------------------------------------------------------------------ */

const defaultTools = () => ({
  discover: discoverGames,
  readState: inspectProfile,
  plan: planPackage,
  install: installLocalOptimizationPackage,
  installPrebuilt: installRpfPrebuilt,
  uninstall: uninstallPackage,
  composeRpf: composeRpfArchive,
  probeRpf: probeRpfArchive,
  provideContentXml: provideUpdateContentXml,
  provideDlcList: provideLegacyDlcList,
  archiveSupport: provisionArchiveSupport,
  /* Читатель архивов — в рабочем потоке (20.10): главный процесс не расшифровывает и не распаковывает записи. */
  openGame: async (gameRoot, keysDirectory) => openGameOffThread(gameRoot, keysDirectory),
  textureLevels: textureLevelFiles,
  installTextures: installLocalTexturesPackage,
  texturesHost: prepareTexturesDlcHost,
  installDrawDistance: installLocalDrawDistancePackage,
  /* Нативный хост (карта с коробкой дальности) — по контексту службы. */
  compile: null,
});

async function confirmedGame(gameRoot, discover) {
  const games = await discover();
  const game = (games || []).find(
    (item) => item?.path && path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase(),
  );
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
    throw new Error("Слои оптимизации ставятся только в GTA V Legacy.");
  if (game.launcherState?.busy) throw new Error("Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.");
  return game;
}

/** Пакеты слоя, которые движок числит за этой игрой (слой сам по себе или в наборе). */
export async function installedOptimizationLayer(readState, stateDir, targetId, layerId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  return (target?.installed || []).filter((item) => optimizationLayersOfRecord(item).includes(layerId));
}

/** Пакеты «Ухудшения текстур» этой игры (своим пакетом дополнения). */
export async function installedTextures(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  return (state?.targets?.[targetId]?.installed || []).filter((item) => isTexturesModId(item?.modId));
}

/** Все пакеты оптимизации этой игры: слои и наборы. */
async function installedOptimization(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  return (target?.installed || []).filter((item) => isOptimizationModId(item?.modId) || isOptimizationSetModId(item?.modId));
}

/*
 * Растительность — свой пакет дополнения, он грузится после update.rpf и
 * собирает словари земли поверх слоёв оптимизации (задача 10). Сколько
 * файлов из `entries` (записи прежнего и нового набора) лежит в её пакете и
 * какой он — окно по этому собирает её заново поверх нового набора.
 */
export async function vegetationOver(readState, stateDir, targetId, entries) {
  const state = await readState({ stateDir });
  const vegetation = (state?.targets?.[targetId]?.installed || []).find((item) => isVegetationModId(item?.modId));
  if (!vegetation) return null;
  const leaf = (entry) => String(entry || "").split("/").pop().toLowerCase();
  const own = new Set((vegetation.archiveEntries || []).map((entry) => leaf(entry?.entry)));
  const files = new Set(entries.map(leaf).filter((name) => name && own.has(name))).size;
  return files ? { files, modId: vegetation.modId } : null;
}

function engineOptions(built, gameRoot, targetId, stateDir, tools) {
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
  };
}

const summaryOf = (built) => ({
  layer: built.layerId,
  modId: built.manifest.id,
  files: built.manifest.files.length,
  archive: "update/update.rpf",
  edition: "Legacy",
  restartRequired: true,
  note: built.note,
});

/*
 * Планы живут в главном процессе: установка ставит ровно собранный слой,
 * второй раз через мост окна он не едет.
 */
export function createOptimizationService({
  stateDir,
  tools: overrides = {},
  resourceRoot = null,
  onProgress = null,
  clock = Date.now,
  /* Нативный хост для ступеней текстур: `{ packaged, projectRoot }`. */
  nativeContext = () => ({}),
}) {
  const tools = { ...defaultTools(), ...overrides };
  const plans = new Map();
  const prune = () => {
    const now = clock();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
    while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value);
  };

  /*
   * План набора: `layers` — все слои, что должны стоять после
   * переключения. Пустой набор — снять всё, что стоит из оптимизации.
   */
  async function planSet(input) {
    const layers = [...new Set(input.layers.map(String))].filter((layerId) => OPTIMIZATION_LAYER_IDS.includes(layerId)).sort();
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    const current = await installedOptimization(tools.readState, stateDir, targetId);
    prune();
    const planId = randomUUID();
    if (!layers.length) {
      plans.set(planId, { set: true, built: null, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
      return { planId, status: current.length ? "remove" : "unchanged", layers: [], removes: current.map((item) => item.modId) };
    }
    const keys = await archiveKeysDirectory({ stateDir, provision: tools.archiveSupport });
    const reader = await tools.openGame(gameRoot, keys);
    let built;
    try {
      built = await buildOptimizationSetPackage(layers, stateDir, { reader, resourceRoot });
    } finally {
      await reader.close();
    }
    plans.set(planId, { set: true, built, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    return {
      planId,
      status: same ? "unchanged" : "install",
      layers,
      modId: built.manifest.id,
      files: built.manifest.files.length,
      replaces: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
      notes: built.notes,
    };
  }

  /* Снять из игры пакеты оптимизации движком (не корзиной: без перемотки работ). */
  async function uninstallAll(modIds, gameRoot, targetId, assertRuntimeSafety) {
    for (const modId of modIds)
      await tools.uninstall({
        modId,
        targetId,
        stateDir,
        rpfComposer: tools.composeRpf,
        contentXmlProvider: tools.provideContentXml,
        dlcListProvider: tools.provideDlcList,
        assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
        onProgress,
      });
  }

  /**
   * Поставить набор по плану одним движением движка: прежний набор и слои,
   * что входят в новый, уходят заменой в той же пересборке; слои прежнего
   * вида, которых в наборе нет, снимаются движком перед ней.
   */
  async function applySet(planned, { assertRuntimeSafety } = {}) {
    const { built, gameRoot, targetId } = planned;
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    const current = await installedOptimization(tools.readState, stateDir, targetId);
    /* Файлы прежнего и нового набора, которые растительность собрала поверх
       себя: окно соберёт её заново (задача 10). */
    const touched = [
      ...current.flatMap((item) => (item.archiveEntries || []).map((entry) => entry?.entry)),
      ...(built?.manifest.files || []).map((file) => file.entry),
    ];
    const covered = await vegetationOver(tools.readState, stateDir, targetId, touched).catch(() => null);
    /* Растительность собрана поверх — она собирается заново здесь же, той
       же работой (`layer-works.js`, задача 3 ТЗ 10.10.2026); нечем —
       `underVegetation`, и её соберёт окно по своей записи. */
    const withVegetation = async (result) =>
      covered && result.status !== "unchanged"
        ? { ...result, ...(await rebuildDependents({ stateDir, targetId, gameRoot, covered: { vegetation: covered }, assertRuntimeSafety, onStage: (stage) => onProgress?.({ dependent: { ...stage, base: "textures" } }) })) }
        : result;
    if (!built) {
      await uninstallAll(
        current.map((item) => item.modId),
        gameRoot,
        targetId,
        assertRuntimeSafety,
      );
      return withVegetation({ status: current.length ? "removed" : "unchanged", removed: current.map((item) => item.modId), layers: [], gameRoot, targetId });
    }
    await assertPackageIntact(built);
    if (current.length === 1 && current[0].modId === built.manifest.id)
      return { status: "unchanged", layerModId: built.manifest.id, layers: built.layers, gameRoot, targetId, files: built.manifest.files.length };
    /* Слои прежнего вида без места в новом наборе заменой не уйдут (у них с
       ним нет общего слота) — их снимает движок, один раз при переходе. */
    const orphans = current.filter((item) => !isOptimizationSetModId(item.modId) && !optimizationLayersOfRecord(item).some((layerId) => built.layers.includes(layerId)));
    await uninstallAll(
      orphans.map((item) => item.modId),
      gameRoot,
      targetId,
      assertRuntimeSafety,
    );
    const options = { ...engineOptions(built, gameRoot, targetId, stateDir, tools) };
    const enginePlan = await tools.plan(options);
    /* Чужой мод на тех же записях не снимается и не мешает (задача 3 ТЗ
       10.10.2026): набор ложится поверх, мод ждёт под ним и вернётся, когда
       набор снимут (`over` — для слов окна; библиотека зовёт его «под
       модом»). */
    const own = (modId) => isOptimizationModId(modId) || isOptimizationSetModId(modId);
    const over = (enginePlan?.conflicts || []).map((item) => item.modId).filter((modId) => modId && !own(modId));
    const orphanIds = new Set(orphans.map((item) => item.modId));
    const replaceModIds = [
      ...new Set([...(enginePlan?.conflicts || []).map((item) => item.modId).filter(own), ...current.map((item) => item.modId).filter((modId) => !orphanIds.has(modId))]),
    ]
      .filter((modId) => modId && modId !== built.manifest.id)
      .sort();
    /* Флаг `ASTRAL_ENGINE_INSTALL=optimization-layers`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
    const engineInstall = engineInstallEnabled("optimization-layers")
      ? {
          install: tools.installPrebuilt ?? installRpfPrebuilt,
          edition: "Legacy",
          gameRoot,
          pointsRoot: nativeRestorePointsRoot(),
          replay: built.layers ? optimizationSetReplayRecord(built) : optimizationLayerReplayRecord(built),
          ...opsRouteTools(),
        }
      : /* «Одна запись вместо двух» (`ASTRAL_ENGINE_INSTALL_OPS=optimization-layers`, `ops-install.js`): без слова — `null`, прежний путь. */
        opsEngineInstall({ module: "optimization-layers", gameRoot, workId: built.manifest.id, tools });
    await tools.install({
      ...options,
      replaceModIds,
      rpfComposer: tools.composeRpf,
      contentXmlProvider: tools.provideContentXml,
      dlcListProvider: tools.provideDlcList,
      assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
      onProgress,
      ...(engineInstall ? { engineInstall } : {}),
    });
    return withVegetation({
      status: "installed",
      layerModId: built.manifest.id,
      layers: built.layers,
      replaced: [...replaceModIds, ...orphanIds],
      ...(over.length ? { over } : {}),
      gameRoot,
      targetId,
      files: built.manifest.files.length,
      installedAt: new Date(clock()).toISOString(),
    });
  }

  /*
   * Ступень «Ухудшения текстур» (задача 1 ТЗ 05.10.2026): `textures` — номер
   * ступени (0 — «Как в игре»: пакет снимается). Перепись карты и ступени —
   * у игрока; собранное помнится, повторная ступень — из кэша.
   *
   * `gray` — ЧБ-мир (ТЗ 17.10.2026, задача 10): тот же пакет, те же словари и
   * модели, поверх ступени — стадия ЧБ (`texture-stages.js`). Без ступени
   * ЧБ-мир ставится с пределом `GRAY_WORLD_CAP`: вся карта в полном размере
   * в пакет дополнения не помещается.
   *
   * `style` — стиль мира (там же, `texture-styles.js`): рисованный, комикс,
   * мультяшный, акварель, ретро. Стадия стоит перед ЧБ: при включённом ЧБ
   * стилизованные текстуры тоже серые. Предел у стиля без ступени — тот же,
   * что у ЧБ.
   *
   * `detail` — чёткость ЧБ-мира и стиля без ступени: 128 (по умолчанию) или
   * 256 px, три пакета (`textures-dlc.js`). Со ступенью «Ухудшения» предел
   * её, чёткость ни на что не влияет.
   */
  /* Что не поместилось в пакеты и осталось как в игре (`texture-levels.js`): словари и модели; ничего — нет поля. */
  const leftOutOf = (note) => {
    const dictionaries = Number(note?.dictionariesOverBudget) || 0;
    const models = Number(note?.modelsOverBudget) || 0;
    return dictionaries || models ? { leftOut: { dictionaries, models } } : {};
  };

  /* Сколько моделей карты в пакете и какой они сборки: окно по этому узнаёт пакет прежней сборки (ТЗ 19.10.2026). */
  const modelsOf = (manifest) => {
    const models = manifest.files.filter((file) => /\.(?:ydr|ydd|yft)$/.test(file.entry)).length;
    return models ? { models, modelBuild: manifest.textures?.modelBuild ?? 0 } : {};
  };

  /* Оружие в пакете: окно по этому знает, что стоящий пакет придётся собрать заново, когда у игрока появятся скины и стволы мастерской (задача 35 (б)). */
  const weaponsOf = (note) => (Number(note?.weaponFiles) > 0 ? { weapons: Number(note.weaponFiles) } : {});

  async function planTextures(input) {
    const level = textureLevelAt(input.textures);
    const gray = input?.gray === true;
    const style = worldStyleOf(input?.style);
    const detail = worldDetailOf(input?.detail);
    const stages = worldStages(style, gray);
    const cap = textureLookCap(level.cap, gray, style, detail);
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    const current = await installedTextures(tools.readState, stateDir, targetId);
    prune();
    const planId = randomUUID();
    if (!cap) {
      plans.set(planId, { textures: true, built: null, step: 0, gray: false, style: null, detail: 128, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
      return { planId, status: current.length ? "remove" : "unchanged", step: 0, gray: false, style: null, detail: 128, removes: current.map((item) => item.modId) };
    }
    const keys = await archiveKeysDirectory({ stateDir, provision: tools.archiveSupport });
    const levelFiles = await tools.textureLevels({
      cap,
      ...(stages.length ? { stages } : {}),
      gameRoot,
      stateDir,
      keysDirectory: keys,
      resourceRoot: resourceRoot || (await optimizationResourceRoot().catch(() => null)),
      nativeContext: nativeContext() || {},
      onProgress,
    });
    const built = await buildTexturesPackage(cap, levelFiles.files, stateDir);
    built.note = levelFiles.note;
    plans.set(planId, { textures: true, built, step: level.step, gray, style, detail, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    return {
      planId,
      status: same ? "unchanged" : "install",
      step: level.step,
      gray,
      style,
      detail,
      cap,
      modId: built.manifest.id,
      files: built.manifest.files.length,
      ...modelsOf(built.manifest),
      bytes: levelFiles.note.bytes,
      replaces: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
      ...leftOutOf(levelFiles.note),
      note: levelFiles.note,
    };
  }

  /**
   * Поставить ступень по плану: пакет текстур заменяет прежний тем же
   * движением, «Как в игре» снимает его (пакет выключается в dlclist.xml).
   * Растительность собрана поверх ступени — окно соберёт её заново
   * (`underVegetation`).
   */
  async function applyTextures(planned, { assertRuntimeSafety } = {}) {
    const { built, gameRoot, targetId, step, gray = false, style = null, detail = 128 } = planned;
    /* ЧБ-мир и стиль помнятся стадиями работы: снизу сменился словарь —
       ступень соберётся заново той же — серой, в том же стиле
       (`layer-works.js`). */
    const stages = worldStages(style, gray);
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    const current = await installedTextures(tools.readState, stateDir, targetId);
    const touched = [
      ...current.flatMap((item) => (item.archiveEntries || []).map((entry) => entry?.entry)),
      ...(built?.manifest.files || []).map((file) => file.entry),
    ];
    const covered = await vegetationOver(tools.readState, stateDir, targetId, touched).catch(() => null);
    /* Растительность собрана поверх — она собирается заново здесь же, той
       же работой (`layer-works.js`, задача 3 ТЗ 10.10.2026); нечем —
       `underVegetation`, и её соберёт окно по своей записи. */
    const withVegetation = async (result) =>
      covered && result.status !== "unchanged"
        ? { ...result, ...(await rebuildDependents({ stateDir, targetId, gameRoot, covered: { vegetation: covered }, assertRuntimeSafety, onStage: (stage) => onProgress?.({ dependent: { ...stage, base: "textures" } }) })) }
        : result;
    if (!built) {
      await uninstallAll(
        current.map((item) => item.modId),
        gameRoot,
        targetId,
        assertRuntimeSafety,
      );
      return withVegetation({ status: current.length ? "removed" : "unchanged", removed: current.map((item) => item.modId), step: 0, gray: false, style: null, detail: 128, gameRoot, targetId });
    }
    await assertPackageIntact(built);
    if (current.length === 1 && current[0].modId === built.manifest.id) {
      await rememberLayerWork({ stateDir, targetId, set: "textures", modId: built.manifest.id, step, stages, detail });
      return { status: "unchanged", layerModId: built.manifest.id, step, gray, style, detail, cap: built.cap, ...leftOutOf(built.note), ...weaponsOf(built.note), ...modelsOf(built.manifest), gameRoot, targetId, files: built.manifest.files.length };
    }
    const host = await tools.texturesHost({ stateDir, gameRoot });
    /* Второй и третий пакеты — только если в них что-то едет (то, что не влезло в первый). */
    const hostB = built.manifest.files.some((file) => file.target === TEXTURES_DLC_B_TARGET)
      ? await tools.texturesHost({ stateDir, gameRoot, pack: "b" })
      : null;
    const hostC = built.manifest.files.some((file) => file.target === TEXTURES_DLC_C_TARGET)
      ? await tools.texturesHost({ stateDir, gameRoot, pack: "c" })
      : null;
    const options = {
      ...engineOptions(built, gameRoot, targetId, stateDir, tools),
      texturesDlcHost: host,
      ...(hostB ? { texturesDlcBHost: hostB } : {}),
      ...(hostC ? { texturesDlcCHost: hostC } : {}),
    };
    const enginePlan = await tools.plan(options);
    /* Чужой мод в том же пакете — под ступенью, не снимается (задача 3). */
    const over = (enginePlan?.conflicts || []).map((item) => item.modId).filter((modId) => modId && !isTexturesModId(modId));
    const replaceModIds = [...new Set([...(enginePlan?.conflicts || []).map((item) => item.modId).filter((modId) => isTexturesModId(modId)), ...current.map((item) => item.modId)])]
      .filter((modId) => modId && modId !== built.manifest.id)
      .sort();
    /* Флаг `ASTRAL_ENGINE_INSTALL=optimization-textures`: несколько архивов (DLC и update.rpf) — одна точка, одна транзакция. */
    const engineInstall = engineInstallEnabled("optimization-textures")
      ? { install: tools.installPrebuilt ?? installRpfPrebuilt, edition: "Legacy", gameRoot, pointsRoot: nativeRestorePointsRoot(), multi: true, replay: texturesReplayRecord(built) }
      : null;
    await tools.installTextures({
      ...options,
      replaceModIds,
      rpfComposer: tools.composeRpf,
      contentXmlProvider: tools.provideContentXml,
      dlcListProvider: tools.provideDlcList,
      assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
      onProgress,
      ...(engineInstall ? { engineInstall } : {}),
    });
    /* Ступень помнится: работа снизу сменилась — ступень соберётся заново
       здесь же, без окна (`layer-works.js`). */
    await rememberLayerWork({ stateDir, targetId, set: "textures", modId: built.manifest.id, step, stages, detail });
    return withVegetation({
      status: "installed",
      layerModId: built.manifest.id,
      step,
      gray,
      style,
      detail,
      cap: built.cap,
      replaced: replaceModIds,
      ...(over.length ? { over } : {}),
      ...leftOutOf(built.note),
      ...weaponsOf(built.note),
      ...modelsOf(built.manifest),
      gameRoot,
      targetId,
      files: built.manifest.files.length,
      note: built.note,
      installedAt: new Date(clock()).toISOString(),
    });
  }

  /*
   * «Дальность прорисовки» (задача 7 ТЗ 06.10.2026): `drawDistance` —
   * `{ distance, look }`; дальности нет («Как в игре») — пакет снимается.
   */
  const compile = (command, input) => (tools.compile ? tools.compile(command, input) : callNativeEngine(command, input, nativeContext() || {}));
  async function planDrawDistance(input) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    const current = await installedDrawDistance(tools.readState, stateDir, targetId);
    prune();
    const planId = randomUUID();
    const distance = input.drawDistance?.distance ?? null;
    if (distance === null) {
      plans.set(planId, { drawDistance: true, built: null, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
      return { planId, status: current.length ? "remove" : "unchanged", distance: null, removes: current.map((item) => item.modId) };
    }
    const built = await buildDrawDistancePackage(input.drawDistance, stateDir, { compile });
    plans.set(planId, { drawDistance: true, built, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    return {
      planId,
      status: same ? "unchanged" : "install",
      distance: built.settings.distance,
      modId: built.manifest.id,
      files: built.manifest.files.length,
      replaces: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
    };
  }

  /* Поставить дальность по плану: прежний пакет уходит заменой, «Как в игре» снимает его. */
  async function applyDrawDistance(planned, { assertRuntimeSafety } = {}) {
    const { built, gameRoot, targetId } = planned;
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    const current = await installedDrawDistance(tools.readState, stateDir, targetId);
    if (!built) {
      await uninstallAll(
        current.map((item) => item.modId),
        gameRoot,
        targetId,
        assertRuntimeSafety,
      );
      return { status: current.length ? "removed" : "unchanged", removed: current.map((item) => item.modId), distance: null, gameRoot, targetId };
    }
    await assertPackageIntact(built);
    if (current.length === 1 && current[0].modId === built.manifest.id)
      return { status: "unchanged", layerModId: built.manifest.id, distance: built.settings.distance, gameRoot, targetId, files: built.manifest.files.length };
    const options = engineOptions(built, gameRoot, targetId, stateDir, tools);
    const enginePlan = await tools.plan(options);
    /* Чужой мод на тех же записях — под дальностью, не снимается (задача 3). */
    const over = (enginePlan?.conflicts || []).map((item) => item.modId).filter((modId) => modId && !isDrawDistanceModId(modId));
    const replaceModIds = [...new Set([...(enginePlan?.conflicts || []).map((item) => item.modId).filter((modId) => isDrawDistanceModId(modId)), ...current.map((item) => item.modId)])]
      .filter((modId) => modId && modId !== built.manifest.id)
      .sort();
    await tools.installDrawDistance({
      ...options,
      replaceModIds,
      rpfComposer: tools.composeRpf,
      contentXmlProvider: tools.provideContentXml,
      dlcListProvider: tools.provideDlcList,
      assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
      onProgress,
    });
    return {
      status: "installed",
      layerModId: built.manifest.id,
      distance: built.settings.distance,
      replaced: replaceModIds,
      ...(over.length ? { over } : {}),
      gameRoot,
      targetId,
      files: built.manifest.files.length,
      installedAt: new Date(clock()).toISOString(),
    };
  }

  async function plan(input) {
    if (input?.drawDistance !== undefined) return planDrawDistance(input);
    if (input?.textures !== undefined && input?.textures !== null) return planTextures(input);
    if (Array.isArray(input?.layers)) return planSet(input);
    const layerId = String(input?.layer || "");
    layerOf(layerId);
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    const keys = await archiveKeysDirectory({ stateDir, provision: tools.archiveSupport });
    const reader = await tools.openGame(gameRoot, keys);
    let built;
    try {
      built = await buildOptimizationLayerPackage(layerId, stateDir, { reader, resourceRoot });
    } finally {
      await reader.close();
    }
    const current = await installedOptimizationLayer(tools.readState, stateDir, targetId, layerId);
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    prune();
    const planId = randomUUID();
    plans.set(planId, { built, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
    return {
      planId,
      status: same ? "unchanged" : "install",
      replaces: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
      ...summaryOf(built),
    };
  }

  /**
   * Включить слой по плану. Прежняя версия этого же слоя уходит тем же
   * движением; чужой мод на тех же записях — отказ с именем: снимать чужое
   * молча слой не вправе.
   */
  async function apply(input, { assertRuntimeSafety } = {}) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const planId = String(input?.planId || "");
    const planned = plans.get(planId);
    plans.delete(planId);
    if (!planned || planned.gameRoot.toLowerCase() !== gameRoot.toLowerCase())
      throw new Error("План слоя устарел — включите слой ещё раз.");
    if (planned.drawDistance) return applyDrawDistance(planned, { assertRuntimeSafety });
    if (planned.textures) return applyTextures(planned, { assertRuntimeSafety });
    if (planned.set) return applySet(planned, { assertRuntimeSafety });
    const { built, targetId } = planned;
    if (input?.layer && input.layer !== built.layerId) throw new Error("План собран для другого слоя — включите слой ещё раз.");
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    await assertPackageIntact(built);

    const current = await installedOptimizationLayer(tools.readState, stateDir, targetId, built.layerId);
    if (current.length === 1 && current[0].modId === built.manifest.id)
      return { status: "unchanged", layerModId: built.manifest.id, gameRoot, targetId, ...summaryOf(built) };

    const options = engineOptions(built, gameRoot, targetId, stateDir, tools);
    const enginePlan = await tools.plan(options);
    /* Чужой мод на тех же записях — под слоем, не снимается (задача 3). */
    const own = (modId) => isOptimizationModId(modId, built.layerId);
    const over = (enginePlan?.conflicts || []).map((item) => item.modId).filter((modId) => modId && !own(modId));
    const replaceModIds = [
      ...new Set([...(enginePlan?.conflicts || []).map((item) => item.modId).filter(own), ...current.map((item) => item.modId)]),
    ]
      .filter((modId) => modId && modId !== built.manifest.id)
      .sort();
    /* Флаг `ASTRAL_ENGINE_INSTALL=optimization-layers`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
    const engineInstall = engineInstallEnabled("optimization-layers")
      ? {
          install: tools.installPrebuilt ?? installRpfPrebuilt,
          edition: "Legacy",
          gameRoot,
          pointsRoot: nativeRestorePointsRoot(),
          replay: built.layers ? optimizationSetReplayRecord(built) : optimizationLayerReplayRecord(built),
          ...opsRouteTools(),
        }
      : /* «Одна запись вместо двух» (`ASTRAL_ENGINE_INSTALL_OPS=optimization-layers`, `ops-install.js`): без слова — `null`, прежний путь. */
        opsEngineInstall({ module: "optimization-layers", gameRoot, workId: built.manifest.id, tools });
    await tools.install({
      ...options,
      replaceModIds,
      rpfComposer: tools.composeRpf,
      contentXmlProvider: tools.provideContentXml,
      dlcListProvider: tools.provideDlcList,
      assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
      onProgress,
      ...(engineInstall ? { engineInstall } : {}),
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
    };
  }

  /* Ступень той же работой поверх сменившихся словарей (`layer-works.js`): ЧБ-мир — тоже серым, стиль — тем же. */
  async function rebuildTextures(work, { gameRoot, assertRuntimeSafety } = {}) {
    const gray = Array.isArray(work.stages) && work.stages.includes("grayscale");
    const style = styleOfStages(work.stages);
    const { planId } = await planTextures({ textures: work.step, gray, style, detail: work.detail, gameRoot });
    return apply({ gameRoot, planId }, { assertRuntimeSafety });
  }

  return Object.freeze({ plan, apply, rebuildTextures });
}
