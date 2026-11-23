import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  mergeAstralContentXml,
  mergeDlcListXml,
  sha256File,
  stripAstralContentXml,
  stripAstralDlcListXml,
} from "./manifest.js";
import { astralContainerOf } from "./astral-paths.js";
import { UPDATE_CONTENT_CARRIER_TARGETS } from "./carrier-targets.js";
import { parkLostCarrierMods } from "./carrier-follow.js";
import { registrableCarrierContainers } from "./carrier-guard.js";
import { exists } from "./storage-state.js";
import { setRecordValue } from "./state-record.js";
import { dropLostLayers, ensureBaseFile } from "./base-recovery.js";
import { relocateSharedManifests } from "./manifest-containers.js";

export const MANAGED_DLC_LIST_TARGET = "newmods/common/data/dlclist.xml";
export const ASTRAL_UPDATE_TARGET = "update/update.rpf";
export const LEGACY_ASTRAL_UPDATE_TARGET = "mods/update/update.rpf";
export const DIRECT_DLC_LIST_ENTRY = "common/data/dlclist.xml";
export const isAstralUpdateTarget = (value) =>
  [ASTRAL_UPDATE_TARGET, LEGACY_ASTRAL_UPDATE_TARGET].includes(
    String(value || "").toLowerCase(),
  );
const ASTRAL_CONTENT_ENTRY = "content.xml";
const ASTRAL_CONTENT_LAYER = "@astral-content-registry";
const ASTRAL_DIRECT_DLC_LAYER = "@astral-direct-dlc-registry";


const activeBaselinePath = (target, resource) => {
  const baseline =
    target?.baselineMode === "clean" ? resource?.clean : resource?.original;
  return baseline?.exists ? baseline.path : null;
};

/*
 * Что должно лежать в игре на месте управляемого DLC: верхний слой, а без
 * слоёв — исходный файл (тот, что вернула бы сборка, `activeBaselinePath`),
 * и только если его нет — основа Astral. Проверки готовности DLC оружия и
 * одежды ждали основу и без слоёв отказывали «DLC не подготовлен или
 * изменён» на игре, где DLC лежал до Astral (живая игра, 04.10.2026).
 */
export function expectedManagedHostSha256(target, resource) {
  const baseline =
    target?.baselineMode === "clean" ? resource?.clean : resource?.original;
  return (
    resource?.layers?.at(-1)?.sha256 ||
    (baseline?.exists ? baseline.sha256 : "") ||
    resource?.compositionBase?.sha256 ||
    ""
  );
}

export async function composeManagedDlcList({ target, targetKey, paths }) {
  const resource = target.resources?.[MANAGED_DLC_LIST_TARGET];
  const base = resource?.compositionBase || resource?.base;
  if (!resource || !base?.exists) {
    throw new Error("Состояние управляемого dlclist.xml повреждено.");
  }
  const names = Object.keys(target.dlcRegistrations || {}).sort((a, b) =>
    a.localeCompare(b),
  );
  if (!names.length) {
    resource.layers = [];
    return activeBaselinePath(target, resource);
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ base: base.sha256, names }))
    .digest("hex");
  const output = path.join(
    paths.payloads,
    "_dlc-lists",
    targetKey,
    `${fingerprint}.xml`,
  );
  if (!(await exists(output))) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const stage = `${output}.${randomUUID()}.stage`;
    try {
      const xml = mergeDlcListXml(await fs.readFile(base.path, "utf8"), names);
      await fs.writeFile(stage, xml, "utf8");
      await fs.rename(stage, output);
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
  }
  resource.layers = [
    {
      modId: "@managed-dlc-list",
      version: fingerprint.slice(0, 12),
      cachePath: output,
      sha256: await sha256File(output),
    },
  ];
  return output;
}

/**
 * Контейнеры `x64/astral/<имя>.rpf`, которыми владеет состояние архива: у
 * записи есть верхний слой с пометкой astralContent. Именно этот список
 * попадает в content.xml — и по нему же слой Astral отличает свои
 * регистрации от чужих.
 */
export function ownedAstralContainers(archive) {
  return [
    ...new Set(
      Object.entries(archive?.entries || {})
        .map(([entry, entryState]) => {
          const top = entryState.layers?.at(-1);
          if (!(entry !== ASTRAL_CONTENT_ENTRY && top?.astralContent === true))
            return null;
          return astralContainerOf(entry);
        })
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Контейнеры `x64/astral/<имя>.rpf` в носителях (`carrier-targets.js`): свои записи архива `update2.rpf` с пометкой astralContent. Регистрация лежит в `content.xml`
 * файла `update.rpf` (у носителя своего нет), строкой `update2:/%PLATFORM%/astral/<имя>.rpf`.
 */
export function ownedCarrierContainers(target) {
  return [
    ...new Set(
      UPDATE_CONTENT_CARRIER_TARGETS.flatMap((carrier) => ownedAstralContainers(target?.archives?.[carrier])),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Затронут носитель — затронут и `update.rpf`: регистрация контейнера лежит в его `content.xml`. Добавляет `update.rpf` во множество затронутых архивов, если слой Astral в нём
 * подготовлен; вернёт, добавлен ли. Порядок записи (носитель → `update.rpf`) множество не задаёт.
 */
export function addCarrierRegistryArchive(target, archives) {
  if (!touchesCarrierRegistry(target, archives)) return false;
  archives.add(ASTRAL_UPDATE_TARGET);
  return true;
}

/**
 * Станет ли `update.rpf` пересобираться из-за регистрации контейнера в носителе: среди `archives` (множество или список целей) есть носитель с регистрацией в `content.xml` `update.rpf`
 * (`UPDATE_CONTENT_CARRIER_TARGETS`) и слой Astral в `update.rpf` подготовлен. Одно условие для `addCarrierRegistryArchive` и для перебазирования перед снятием (`rebaseBeforeUninstall`): работа,
 * у которой все записи лежат в носителе, не называет `update/update.rpf` в своей описи, но снятие всё равно собирает его заново.
 */
export function touchesCarrierRegistry(target, archives) {
  const has = archives instanceof Set ? (item) => archives.has(item) : (item) => [...archives].includes(item);
  if (!UPDATE_CONTENT_CARRIER_TARGETS.some(has)) return false;
  return Boolean(target?.archives?.[ASTRAL_UPDATE_TARGET] && target?.resources?.[ASTRAL_UPDATE_TARGET]);
}

function compositionBaseArchive(target, archiveTarget) {
  const resource = target.resources?.[archiveTarget];
  const baseArchive = resource?.compositionBase || resource?.base;
  if (!baseArchive?.path || !baseArchive.sha256) {
    throw new Error("The update.rpf composition baseline is unavailable.");
  }
  return baseArchive;
}

/*
 * Основа реестра — XML из базы архива без строк Astral (`stripAstral*` в
 * manifest.js) и опись того, что из неё снято. Кэшируется по SHA-256 базы;
 * `v2` в имени отделяет очищенный кэш от прежнего, где строки оставались.
 * Опись пишется раньше XML: есть XML — есть и она.
 */
async function ensureRegistryBase({
  target,
  paths,
  targetKey,
  archiveTarget,
  folder,
  suffix,
  provider,
  validate,
  strip,
}) {
  /* Копия основы пропала из кэша — реестр берётся с основы по живому
     архиву (`base-recovery.js`). */
  await ensureBaseFile({ target, archiveTarget, paths, targetKey });
  const baseArchive = compositionBaseArchive(target, archiveTarget);
  const baseDirectory = path.join(paths.bases, targetKey, folder);
  const baseXml = path.join(baseDirectory, `${baseArchive.sha256}.v2${suffix}`);
  const baseNote = `${baseXml}.json`;
  if (!(await exists(baseXml))) {
    await fs.mkdir(baseDirectory, { recursive: true });
    const stamp = randomUUID();
    const stage = `${baseXml}.${stamp}.stage`;
    const noteStage = `${baseNote}.${stamp}.stage`;
    try {
      await provider({
        baseArchive: baseArchive.path,
        gameRoot: target.gameRoot,
        edition: target.edition,
        output: stage,
      });
      const stripped = strip(await fs.readFile(stage, "utf8"));
      validate(stripped.xml);
      await fs.writeFile(stage, stripped.xml, "utf8");
      await fs.writeFile(
        noteStage,
        `${JSON.stringify({ removed: stripped.removed })}\n`,
        "utf8",
      );
      await fs.rename(noteStage, baseNote);
      await fs.rename(stage, baseXml);
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      await fs.rm(noteStage, { force: true }).catch(() => {});
      throw error;
    }
  }
  let removed = [];
  try {
    const note = JSON.parse(await fs.readFile(baseNote, "utf8"));
    removed = Array.isArray(note?.removed) ? note.removed.map(String) : [];
  } catch {
    removed = [];
  }
  return { path: baseXml, removed };
}

/**
 * Исходный content.xml базы update.rpf без регистраций Astral. Вынимается
 * провайдером один раз на базу и проверяется на структуру GTA V до того,
 * как попадёт в кэш.
 */
export async function ensureAstralContentBase({
  target,
  targetKey,
  paths,
  contentXmlProvider,
  archiveTarget = ASTRAL_UPDATE_TARGET,
}) {
  if (typeof contentXmlProvider !== "function") {
    throw new Error(
      "Astral content.xml provider is not available. Update or repair Astral.",
    );
  }
  return ensureRegistryBase({
    target,
    paths,
    targetKey,
    archiveTarget,
    folder: "astral-content",
    suffix: ".content.xml",
    provider: contentXmlProvider,
    validate: (xml) => mergeAstralContentXml(xml, []),
    strip: stripAstralContentXml,
  });
}

/** Исходный dlclist.xml базы update.rpf без регистраций DLC Astral. */
export async function ensureDirectDlcListBase({
  target,
  targetKey,
  paths,
  dlcListProvider,
  archiveTarget = ASTRAL_UPDATE_TARGET,
}) {
  if (typeof dlcListProvider !== "function") {
    throw new Error(
      "Astral direct dlclist.xml provider is unavailable. Update or repair Astral.",
    );
  }
  return ensureRegistryBase({
    target,
    paths,
    targetKey,
    archiveTarget,
    folder: "direct-dlc-list",
    suffix: ".xml",
    provider: dlcListProvider,
    validate: (xml) => mergeDlcListXml(xml, []),
    strip: stripAstralDlcListXml,
  });
}

export async function composeAstralContentRegistry({
  target,
  targetKey,
  paths,
  contentXmlProvider,
  archiveTarget = ASTRAL_UPDATE_TARGET,
  /* Контейнеры, что лежат в носителе сейчас (`Set` строчных имён), или `null` — не прочитан/не спрашивали: регистрации по состоянию, как прежде.
     Задан — регистрируются только лежащие: регистрация без файла роняет игру (`carrier-guard.js`). Установке не передаётся: её контейнер пишется той же транзакцией позже. */
  carrierPresent = null,
  /* Носители, что вызывающий пишет в этой же транзакции: их контейнеры появятся вместе с записью (`carrier-follow.js`). */
  carrierWriting = null,
}) {
  if (!isAstralUpdateTarget(archiveTarget)) {
    throw new Error(
      "Astral content registry received an unsupported update.rpf target.",
    );
  }
  const archive = target.archives?.[archiveTarget];
  if (!archive) return false;
  /* Мод, чьих файлов больше нет в хранилище, снимается до реестра: иначе
     content.xml зарегистрировал бы пустой контейнер — его Legacy не
     переживает (ERR_SYS_FILELOAD). */
  await dropLostLayers({ target, archiveTarget, paths });
  /* Работы со своим `_manifest.ymf` — каждая в своём контейнере (задача 3
     ТЗ 10.10.2026): поставленные в общий `astral_maps.rpf` переезжают. */
  relocateSharedManifests(target);
  const contentEntry =
    archive.entries[ASTRAL_CONTENT_ENTRY] ||
    setRecordValue(archive.entries, ASTRAL_CONTENT_ENTRY, { layers: [] });
  contentEntry.layers = (contentEntry.layers || []).filter(
    (layer) => layer.modId !== ASTRAL_CONTENT_LAYER,
  );
  /* Регистрация следует за фактом: работа носителя, чьих контейнеров нет в живом `update2.rpf`, паркуется ДО сборки строк — из какого бы пути ни пришли (`carrier-follow.js`). */
  await parkLostCarrierMods({
    target,
    root: target.gameRoot,
    edition: target.edition,
    presence: carrierPresent === undefined ? null : carrierPresent,
    trustCarriers: carrierWriting,
  }).catch(() => null);
  const registrations = ownedAstralContainers(archive);
  const carrierRegistrations = registrableCarrierContainers(ownedCarrierContainers(target), carrierPresent instanceof Set ? carrierPresent : null);
  /* Без контейнеров и без их прежних строк в основе писать нечего: основа
     и есть нужный content.xml. Проверка основы — только когда есть чем её
     вынуть; без провайдера регистраций нет и не было. */
  if (!registrations.length && !carrierRegistrations.length && typeof contentXmlProvider !== "function")
    return true;
  const base = await ensureAstralContentBase({
    target,
    targetKey,
    paths,
    contentXmlProvider,
    archiveTarget,
  });
  if (!registrations.length && !carrierRegistrations.length && !base.removed.length) return true;
  const baseXml = base.path;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ base: await sha256File(baseXml), registrations, ...(carrierRegistrations.length ? { carrierRegistrations } : {}) }))
    .digest("hex");
  const output = path.join(
    paths.payloads,
    "_astral-content",
    targetKey,
    `${fingerprint}.xml`,
  );
  if (!(await exists(output))) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const stage = `${output}.${randomUUID()}.stage`;
    try {
      const xml = mergeAstralContentXml(
        await fs.readFile(baseXml, "utf8"),
        registrations,
        carrierRegistrations,
      );
      await fs.writeFile(stage, xml, "utf8");
      await fs.rename(stage, output);
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
  }
  contentEntry.layers.push({
    modId: ASTRAL_CONTENT_LAYER,
    version: fingerprint.slice(0, 12),
    action: "replace",
    cachePath: output,
    sha256: await sha256File(output),
  });
  return true;
}

export async function composeDirectDlcRegistry({
  target,
  targetKey,
  paths,
  dlcListProvider,
  archiveTarget = ASTRAL_UPDATE_TARGET,
}) {
  if (!isAstralUpdateTarget(archiveTarget)) {
    throw new Error(
      "Astral direct DLC registry received an unsupported update.rpf target.",
    );
  }
  const archive = target.archives?.[archiveTarget];
  if (!archive) return false;
  const listEntry =
    archive.entries[DIRECT_DLC_LIST_ENTRY] ||
    setRecordValue(archive.entries, DIRECT_DLC_LIST_ENTRY, { layers: [] });
  listEntry.layers = (listEntry.layers || []).filter(
    (layer) => layer.modId !== ASTRAL_DIRECT_DLC_LAYER,
  );
  const registrations = Object.keys(target.directDlcRegistrations || {}).sort(
    (a, b) => a.localeCompare(b),
  );
  if (!registrations.length && typeof dlcListProvider !== "function")
    return true;
  const base = await ensureDirectDlcListBase({
    target,
    targetKey,
    paths,
    dlcListProvider,
    archiveTarget,
  });
  if (!registrations.length && !base.removed.length) return true;
  const baseXml = base.path;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ base: await sha256File(baseXml), registrations }))
    .digest("hex");
  const output = path.join(
    paths.payloads,
    "_direct-dlc-lists",
    targetKey,
    `${fingerprint}.xml`,
  );
  if (!(await exists(output))) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const stage = `${output}.${randomUUID()}.stage`;
    try {
      const xml = mergeDlcListXml(
        await fs.readFile(baseXml, "utf8"),
        registrations,
      );
      await fs.writeFile(stage, xml, "utf8");
      await fs.rename(stage, output);
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
  }
  listEntry.layers.push({
    modId: ASTRAL_DIRECT_DLC_LAYER,
    version: fingerprint.slice(0, 12),
    action: "replace",
    cachePath: output,
    sha256: await sha256File(output),
  });
  return true;
}
