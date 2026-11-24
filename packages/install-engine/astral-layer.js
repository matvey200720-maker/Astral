/*
 * Слой Astral — прямая схема доставки модов в GTA V Legacy.
 *
 * Игра читает один архив — `update/update.rpf`. Astral держит в нём папку
 * `x64/astral/`, кладёт туда контейнеры `<домен>.rpf` (например
 * `astral_maps.rpf`) и регистрирует каждый непустой контейнер строкой
 * `update:/%PLATFORM%/astral/<домен>.rpf` в корневом `content.xml`. Ни папка
 * `mods`, ни ASI-загрузчик для этого не нужны: игра грузит контейнер сама.
 *
 * Подготовка слоя выполняется один раз после подтверждения GTA V:
 *
 * 1. игра не запущена, лаунчер не обновляет файлы;
 * 2. в живом `update.rpf` нет чужих записей Astral (см. «потерянный профиль»);
 * 3. полная резервная копия `update.rpf` ложится в `bases/<профиль>/`
 *    (SHA-256 записан в состояние — это неизменяемый оригинал пользователя);
 * 4. исходные `content.xml` и `dlclist.xml` вынимаются из копии и кэшируются
 *    по SHA базы — первая установка не тратит время на распаковку;
 * 5. папка `x64/astral` создаётся в живом архиве одной транзакцией с
 *    контрольной точкой (её держит инертная метка, см. ниже) — игра человека
 *    «подключена» сразу после установки приложения;
 * 6. в состояние профиля записывается `astralLayer` с отпечатком живого
 *    архива (размер + время правки), по которому следующий запуск за
 *    миллисекунды понимает, что слой на месте.
 *
 * Регистрации в `content.xml` подготовка не пишет: пустой зарегистрированный
 * контейнер Legacy не переживает (ERR_SYS_FILELOAD). Контейнер и его строка
 * появляются вместе с первым модом; папка при этом уже есть.
 *
 * «Потерянный профиль»: если в живом архиве уже стоят регистрации Astral
 * (`update:/%PLATFORM%/astral/…` в content.xml или `dlcpacks:/astral_…/` в
 * dlclist.xml), а в состоянии этого профиля их никто не помнит, — это следы
 * прежней установки Astral (переустановка, потерянное состояние, игра из
 * резервной копии). До 10.10.2026 подготовка здесь останавливалась со
 * статусом `foreign-layer` и слала человека проверять файлы игры — тупик,
 * когда в игре стоят наши же моды. Теперь основой становится игра без этих
 * следов: файлы контейнеров уходят из копии (`cleanDirectUpdateBase`), строки
 * — из реестров, и это пишется в отчёт цели (`reconcile-report.js`). Цель,
 * переехавшая с игрой в другую папку, узнаётся раньше (`moved-target.js`).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { carrierContentRegistrations } from "./carrier-guard.js";
import { LIVE_CARRIER_TARGETS } from "./carrier-targets.js";
import {
  ASTRAL_UPDATE_TARGET,
  composeDirectDlcRegistry,
  ensureAstralContentBase,
  ensureDirectDlcListBase,
  ownedAstralContainers,
} from "./registry-composers.js";
import {
  ASTRAL_CONTAINER_ROOT,
  astralContentRegistrations,
  astralDlcRegistrations,
} from "./astral-paths.js";
import { ASI_LOADERS, MODS_PLUGINS } from "./loader-policy.js";
import { hasRewoundAbsorption, lastRebaseOf } from "./direct-update-rebase.js";
import { reachedByOwnNativeChanges } from "./native-history.js";
import { parkRevertedArchives } from "./archive-rebase.js";
import { carrierOwnership, carrierVerdict, liveFileIdentity, parkLostCarrierMods, recordCarrierIdentity } from "./carrier-follow.js";
import { sharedManifestsToRelocate } from "./manifest-containers.js";
import { cleanDirectUpdateBase } from "./direct-base-cleanup.js";
import { composeCountOf, ensureArchiveResource } from "./resource-composition.js";
import { packedManifestPath } from "./chunk-store.js";
import { exists } from "./storage-state.js";
import { noteReconcile, reconcileEventsSince } from "./reconcile-report.js";
import { findMovedTarget, moveTarget, repointTarget } from "./moved-target.js";

/*
 * Основа новой цели — игра без следов прежней установки Astral. Очищенная
 * копия встаёт на место защищённой копии оригинала: та сняла архив вместе
 * со следами, и держать две копии по два гигабайта незачем. Без помощника
 * основа остаётся со следами — игра их не читает: реестры собираются без
 * строк Astral.
 */
async function adoptBaseWithoutTraces({ target, traces, paths, targetKey, signal }) {
  const resource = target.resources?.[ASTRAL_UPDATE_TARGET];
  const base = resource?.compositionBase;
  if (base?.exists && traces?.containers?.length) {
    let cleaned = null;
    try {
      cleaned = await cleanDirectUpdateBase({
        target,
        source: { path: base.path, sha256: base.sha256 },
        references: [],
        foreignContainers: traces.containers,
        paths,
        targetKey,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[astral-engine] Следы прежней установки Astral не убраны из основы: ${error?.message || error}`);
    }
    if (cleaned?.changed) {
      await fs.rm(base.path, { force: true });
      /* Прежняя опись кусков называла другие байты (`chunk-store.js`). */
      await fs.rm(packedManifestPath(base.path), { force: true }).catch(() => {});
      await fs.rename(cleaned.path, base.path);
      const baseline = {
        exists: true,
        path: base.path,
        sha256: cleaned.sha256,
        verified: true,
        withoutAstral: true,
        liveSha256: base.sha256,
      };
      resource.base = baseline;
      resource.compositionBase = baseline;
      resource.original = { ...baseline };
      resource.clean = { ...baseline, verified: false };
    }
  }
  noteReconcile(target, {
    kind: "astral-traces-removed",
    containers: traces?.containers || [],
    dlcs: traces?.dlcs || [],
  });
}

export {
  ASTRAL_CONTAINER_ROOT,
  astralContentRegistrations,
  astralDlcRegistrations,
};

/*
 * Тень папки mods.
 *
 * ASI-загрузчик OpenIV подменяет игре чтение архивов: если рядом с игрой лежит
 * `mods/update/update.rpf`, читается он, а настоящий `update/update.rpf`
 * игру больше не касается. Наш слой в этом случае лёг бы в файл, который никто
 * не открывает, — и человек увидел бы ровно то, с чего начинают все жалобы:
 * «установилось, а в игре ничего нет».
 *
 * Одной копии архива мало, чтобы объявить тень: без загрузчика папка `mods`
 * лежит мёртвым грузом, и пугать ею владельца незачем. Тень объявляется, когда
 * есть и копия, и то, чем её читают, — перехватчик (`dinput8.dll` и соседи) и
 * плагин (`OpenIV.asi` и соседи).
 */
export const MODS_SHADOW_ARCHIVE = "mods/update/update.rpf";

const present = async (root, names, exists) => {
  const found = [];
  for (const name of names)
    if (await exists(path.join(root, name))) found.push(name);
  return found;
};

/** Что в папке игры делает наш архив невидимым для неё. */
export async function inspectModsShadow(root, exists) {
  const archive = path.join(root, "mods", "update", "update.rpf");
  if (!(await exists(archive)))
    return { shadowed: false, archive: false, hooks: [], plugins: [] };
  const hooks = await present(root, ASI_LOADERS, exists);
  const plugins = await present(root, MODS_PLUGINS, exists);
  return {
    shadowed: hooks.length > 0 && plugins.length > 0,
    archive: true,
    hooks,
    plugins,
  };
}

export const ASTRAL_LAYER_SCHEMA = 1;
/*
 * Папка `x64/astral` создаётся уже на подготовке — так решено: человек
 * ставит приложение, и его игра сразу «подключена». Пустых папок в RPF не
 * бывает, поэтому папку держит один инертный файл-метка. Он не
 * регистрируется в content.xml и игрой не читается; контейнеры модов ложатся
 * рядом с ним. Байты метки постоянны, чтобы отпечаток сборки не менялся от
 * запуска к запуску.
 */
export const ASTRAL_LAYER_MARKER_ENTRY = `${ASTRAL_CONTAINER_ROOT}/astral_layer.json`;
export const ASTRAL_LAYER_MOD_ID = "@astral-layer";
const ASTRAL_LAYER_MARKER_BYTES = Buffer.from(
  `${JSON.stringify({ product: "Astral", layer: ASTRAL_LAYER_SCHEMA, container: ASTRAL_CONTAINER_ROOT })}\n`,
  "utf8",
);

const unique = (values) =>
  [...new Set(values.map((value) => value.toLowerCase()))].sort((a, b) =>
    a.localeCompare(b),
  );

export class AstralLayerError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "AstralLayerError";
    this.code = code;
    Object.assign(this, details);
  }
}

function foreignLayerMessage(registrations) {
  const found = [
    ...registrations.containers.map((name) => `${ASTRAL_CONTAINER_ROOT}/${name}`),
    ...registrations.dlcs.map((name) => `dlcpacks:/${name}/`),
  ].join(", ");
  return (
    `В update.rpf уже есть слой Astral (${found}), но резервной копии оригинала в этом профиле нет. ` +
    "Верните оригинальный архив: Steam → свойства GTA V → Установленные файлы → " +
    "«Проверить целостность файлов игры» (в Rockstar Games Launcher и Epic Games — проверка файлов), " +
    "затем повторите подготовку в Astral."
  );
}


/**
 * Регистрации Astral в произвольном архиве update.rpf. Провайдеры вынимают
 * XML во временные файлы рядом с базами профиля; файлы удаляются всегда.
 * Возвращает null, если провайдеров нет (нечем прочитать архив).
 */
export async function inspectAstralRegistrations({
  archivePath,
  gameRoot,
  edition,
  paths,
  targetKey,
  contentXmlProvider,
  dlcListProvider,
}) {
  if (
    typeof contentXmlProvider !== "function" ||
    typeof dlcListProvider !== "function"
  ) {
    return null;
  }
  const directory = path.join(paths.bases, targetKey, "astral-layer");
  await fs.mkdir(directory, { recursive: true });
  const stamp = randomUUID();
  const contentStage = path.join(directory, `${stamp}.content.xml.stage`);
  const dlcListStage = path.join(directory, `${stamp}.dlclist.xml.stage`);
  try {
    await contentXmlProvider({
      baseArchive: archivePath,
      gameRoot,
      edition,
      output: contentStage,
    });
    await dlcListProvider({
      baseArchive: archivePath,
      gameRoot,
      edition,
      output: dlcListStage,
    });
    return {
      containers: astralContentRegistrations(
        await fs.readFile(contentStage, "utf8"),
      ),
      dlcs: astralDlcRegistrations(await fs.readFile(dlcListStage, "utf8")),
    };
  } finally {
    await fs.rm(contentStage, { force: true }).catch(() => {});
    await fs.rm(dlcListStage, { force: true }).catch(() => {});
  }
}

/**
 * Регистрации, которыми владеет состояние профиля: контейнеры — по записям
 * архива с пометкой astralContent, DLC — по прямым регистрациям.
 */
export function ownedAstralRegistrations(target) {
  const archive = target?.archives?.[ASTRAL_UPDATE_TARGET];
  return {
    containers: ownedAstralContainers(archive).map((entry) =>
      entry.slice(`${ASTRAL_CONTAINER_ROOT}/`.length).toLowerCase(),
    ),
    dlcs: unique(Object.keys(target?.directDlcRegistrations || {})),
  };
}

/**
 * Чужие регистрации = живые минус те, что помнит профиль. Бросает
 * AstralLayerError(ASTRAL_FOREIGN_LAYER), если такие есть. Возвращает
 * найденные живые регистрации (или null без провайдеров).
 */
export async function assertNoForeignAstralLayer({
  target,
  root,
  paths,
  targetKey,
  contentXmlProvider,
  dlcListProvider,
  rpfProbe = null,
  resolveInside,
}) {
  const livePath = resolveInside(root, ASTRAL_UPDATE_TARGET);
  if (!(await exists(livePath))) {
    throw new AstralLayerError(
      "update/update.rpf не найден. Восстановите файлы GTA V перед подготовкой Astral.",
      "ASTRAL_UPDATE_MISSING",
    );
  }
  const live = await inspectAstralRegistrations({
    archivePath: livePath,
    gameRoot: root,
    edition: target.edition,
    paths,
    targetKey,
    contentXmlProvider,
    dlcListProvider,
  });
  if (!live) return null;
  const owned = ownedAstralRegistrations(target);
  const foreign = {
    containers: live.containers.filter(
      (name) => !owned.containers.includes(name),
    ),
    dlcs: live.dlcs.filter((name) => !owned.dlcs.includes(name)),
  };
  if (foreign.containers.length || foreign.dlcs.length) {
    throw new AstralLayerError(
      foreignLayerMessage(foreign),
      "ASTRAL_FOREIGN_LAYER",
      { registrations: foreign },
    );
  }
  // Одна метка без регистраций — не мод: архив в остальном оригинален, и
  // гнать человека на переустановку двух гигабайт ради неё незачем. Такая
  // метка усыновляется: слой запишет её через replace, а не import.
  let marker = null;
  if (typeof rpfProbe === "function") {
    const probe = await rpfProbe({
      archivePath: livePath,
      archiveTarget: ASTRAL_UPDATE_TARGET,
      gameRoot: root,
      edition: target.edition,
      operations: [{ entry: ASTRAL_LAYER_MARKER_ENTRY, action: "upsert" }],
    });
    marker = Boolean(
      (probe?.operations || []).find(
        (item) =>
          String(item.entry || "").toLowerCase() ===
          ASTRAL_LAYER_MARKER_ENTRY.toLowerCase(),
      )?.exists,
    );
  }
  return { ...live, marker };
}

/**
 * Следы прежней установки Astral в живом архиве цели без своей копии
 * оригинала: `{ containers, dlcs }` или `null`, если их нет. Первая прямая
 * запись (установка без подготовки, свои пакеты DLC) спрашивает это до
 * копии архива и убирает следы после неё (`settleForeignAstralTraces`) —
 * вместо прежнего отказа «В update.rpf уже есть слой Astral…».
 */
export async function foreignAstralTraces(options) {
  try {
    await assertNoForeignAstralLayer(options);
    return null;
  } catch (error) {
    if (error?.code === "ASTRAL_FOREIGN_LAYER") return error.registrations;
    throw error;
  }
}

/**
 * Основа update.rpf только что снята с живого архива со следами: она — игра
 * без них, а DLC прежней установки уходят из dlclist.xml (иначе игра грузила
 * бы пакет, о котором Astral не знает и который не снимет).
 */
export async function settleForeignAstralTraces({
  target,
  traces,
  paths,
  targetKey,
  dlcListProvider = null,
  signal = null,
}) {
  if (!traces) return false;
  await adoptBaseWithoutTraces({ target, traces, paths, targetKey, signal });
  if (
    traces.dlcs?.length &&
    typeof dlcListProvider === "function" &&
    target.archives?.[ASTRAL_UPDATE_TARGET]
  )
    await composeDirectDlcRegistry({
      target,
      targetKey,
      paths,
      dlcListProvider,
      archiveTarget: ASTRAL_UPDATE_TARGET,
    });
  return true;
}

/**
 * Первая прямая запись в update.rpf цели без подготовки слоя (установка
 * пакета сразу): следы прежней установки Astral ищутся до копии архива и
 * убираются из неё сразу после (`settleForeignAstralTraces`).
 */
export async function adoptFreshUpdateBase({ target, root, paths, targetKey, dlcListProvider, signal = null, onProgress = null, ...probe }) {
  const traces = await foreignAstralTraces({ target, root, paths, targetKey, dlcListProvider, ...probe });
  if (!traces) return false;
  await ensureArchiveResource({ target, archiveTarget: ASTRAL_UPDATE_TARGET, root, paths, targetKey, signal, onProgress });
  return settleForeignAstralTraces({ target, traces, paths, targetKey, dlcListProvider, signal });
}

/** Метка папки в состоянии архива: есть ли слой и не удалён ли он. */
function markerLayer(target) {
  const top =
    target?.archives?.[ASTRAL_UPDATE_TARGET]?.entries?.[
      ASTRAL_LAYER_MARKER_ENTRY
    ]?.layers?.at(-1);
  return top && top.action !== "delete" ? top : null;
}

async function changedFile(relativePath, sourcePath, root, deps) {
  const { resolveInside, sha256File } = deps;
  const livePath = resolveInside(root, relativePath);
  /* Отпечаток собранного — подмена сверит байты по дороге и запомнит его
     за живым архивом (задача 8). */
  const sourceSha256 = await sha256File(sourcePath);
  const change = { relativePath, livePath, sourcePath, sha256: sourceSha256 };
  if (!(await exists(livePath))) return change;
  const [sourceStat, liveStat] = await Promise.all([
    fs.lstat(sourcePath),
    fs.lstat(livePath),
  ]);
  if (
    !sourceStat.isFile() ||
    sourceStat.isSymbolicLink() ||
    !liveStat.isFile() ||
    liveStat.isSymbolicLink()
  ) {
    throw new Error(`Небезопасный файл в транзакции: ${relativePath}`);
  }
  if (
    sourceStat.size === liveStat.size &&
    sourceSha256 === (await sha256File(livePath))
  ) {
    return null;
  }
  return change;
}

async function liveIdentity(livePath) {
  const stat = await fs.lstat(livePath);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  return { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
}

function sameIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.size === right.size &&
    Math.trunc(left.mtimeMs) === Math.trunc(right.mtimeMs),
  );
}

/**
 * Состояние слоя без записи: `ready` — живой архив совпадает с тем, что
 * профиль считает текущим; `changed` — архив изменился снаружи (обновление
 * игры или чужая правка), нужна повторная подготовка; `missing` — слой не
 * подготовлен. Дорогой SHA-256 считается только когда дешёвый отпечаток
 * (размер + время) разошёлся.
 *
 * `acceptOwnEdits` (подготовка игры): архив, отличный от собранного движком только нашими
 * нативными правками мастерской (мини-карта, прицел, небо), тоже `ready` — пересобирать
 * нечего, метка и реестры на месте, а следующая операция движка сама примет правку в основу
 * (`direct-update-rebase.js`). Раньше каждое «Применить» стоило подготовке двух гигабайт записи
 * (26–84 с, проба 04.11.2026 на копии игры). Чужая подмена (обновление игры, проверка файлов,
 * другая сборка) не наша — путь прежний.
 */
export async function astralLayerStatus(target, { resolveInside, sha256File, acceptOwnEdits = false }) {
  const layer = target?.astralLayer;
  if (layer?.schema !== ASTRAL_LAYER_SCHEMA) {
    return { status: "missing", prepared: false };
  }
  const resource = target.resources?.[ASTRAL_UPDATE_TARGET];
  const expectedHash =
    resource?.layers?.at(-1)?.sha256 || resource?.compositionBase?.sha256;
  const livePath = resolveInside(target.gameRoot, ASTRAL_UPDATE_TARGET);
  let identity = null;
  try {
    identity = await liveIdentity(livePath);
  } catch {
    identity = null;
  }
  if (!identity || !expectedHash) {
    return { status: "changed", prepared: true, identity };
  }
  if (sameIdentity(identity, layer.updateIdentity)) {
    return { status: "ready", prepared: true, identity };
  }
  const liveHash = await sha256File(livePath);
  if (liveHash === expectedHash)
    return { status: "ready", prepared: true, identity, refreshedIdentity: true };
  if (
    acceptOwnEdits &&
    (await reachedByOwnNativeChanges({
      gameRoot: target.gameRoot,
      /* Только от собранного движком архива: архив «основа плюс работы» без слоёв (после перемотки и
         повтора работ) — тоже наши правки, но слоёв каталога в нём нет, и их надо положить. */
      known: [expectedHash],
      live: liveHash,
    }))
  )
    return { status: "ready", prepared: true, identity, refreshedIdentity: true, ownEdits: true };
  return { status: "changed", prepared: true, identity, refreshedIdentity: false };
}

/*
 * Слой ляжет поверх работы на записях возвращённых работ (регистр не важен): запись «работа поверх слоя» о них забывается.
 * Исключение — порядок, который был в игре до снятия (`keep`): работа лежала над этим же слоем и осталась над ним, снимали
 * другую вещь. Такая запись восстанавливается, если сверху всё тот же слой.
 */
function forgetWorkOverOn(resource, entries, keep, archive) {
  const base = resource?.compositionBase;
  if (!base) return;
  const gone = new Set(entries.map((entry) => String(entry).replaceAll("\\", "/").toLowerCase()));
  const over = { ...(base.workOver || {}) };
  for (const entry of Object.keys(over)) if (gone.has(entry.toLowerCase())) delete over[entry];
  for (const [entry, was] of Object.entries(keep || {})) {
    if (!gone.has(entry.toLowerCase())) continue;
    const top = archive?.entries?.[entry]?.layers?.at(-1);
    if (top && top.action !== "delete" && top.modId === was?.modId && top.sha256 === was?.sha256) over[entry] = { modId: was.modId, sha256: was.sha256 };
  }
  if (Object.keys(over).length) base.workOver = over;
  else delete base.workOver;
}

/* Проверка файлов сняла все моды цели этой подготовкой. */
const parkedEverything = (target, since) =>
  !(target.installed || []).length &&
  reconcileEventsSince(target, since).some((event) => event?.kind === "restored-by-launcher" || event?.kind === "carrier-lost");

function summarize(target, status, extra = {}) {
  const resource = target?.resources?.[ASTRAL_UPDATE_TARGET];
  const owned = ownedAstralRegistrations(target);
  const marker = markerLayer(target);
  return {
    status,
    ready: status === "ready" || status === "backup-only",
    schema: ASTRAL_LAYER_SCHEMA,
    container: ASTRAL_CONTAINER_ROOT,
    target: ASTRAL_UPDATE_TARGET,
    backup: resource?.compositionBase?.exists
      ? {
          path: resource.compositionBase.path,
          sha256: resource.compositionBase.sha256,
          original: resource.original?.sha256 || null,
        }
      : null,
    folder: {
      entry: ASTRAL_LAYER_MARKER_ENTRY,
      materialized: Boolean(marker),
      adopted: marker?.action === "replace",
    },
    registryReady: Boolean(target?.astralLayer?.registryReady),
    registered: owned.containers.map(
      (name) => `${ASTRAL_CONTAINER_ROOT}/${name}`,
    ),
    directDlcs: owned.dlcs,
    preparedAt: target?.astralLayer?.preparedAt || null,
    ...extra,
  };
}

/**
 * Отпечаток живого update.rpf в состоянии профиля обновляется после каждой
 * транзакции, которая его трогала: иначе следующий запуск считал бы SHA-256
 * двух гигабайт, чтобы убедиться, что архив изменили мы сами.
 */
export async function refreshAstralLayerIdentity({
  state,
  targetId,
  affected,
  stateDir,
  resolveInside,
  writeState,
  ownRecordValue,
}) {
  const target = ownRecordValue(state.targets || {}, targetId);
  if (target?.astralLayer?.schema !== ASTRAL_LAYER_SCHEMA) return false;
  /* Носитель `update2.rpf`: его отпечаток после нашей записи — основа страховки «носитель потерян» (`carrier-follow.js`): файл прежний — пробу не зовём. Нет файла или не прочитался — запись убирается. */
  const touchedCarriers = (affected || []).map((item) => String(item.relativePath || "").toLowerCase()).filter((relative) => LIVE_CARRIER_TARGETS.includes(relative));
  let carrierChanged = false;
  for (const carrier of touchedCarriers) {
    const identity = await liveFileIdentity(resolveInside(target.gameRoot, carrier)).catch(() => null);
    carrierChanged = recordCarrierIdentity(target, { [carrier]: identity }) || carrierChanged;
  }
  if (
    !(affected || []).some((item) => item.relativePath === ASTRAL_UPDATE_TARGET)
  ) {
    if (!carrierChanged) return false;
    await writeState(state, stateDir);
    return true;
  }
  try {
    const identity = await liveIdentity(
      resolveInside(target.gameRoot, ASTRAL_UPDATE_TARGET),
    );
    target.astralLayer.updateIdentity = identity;
  } catch {
    target.astralLayer.updateIdentity = null;
  }
  await writeState(state, stateDir);
  return true;
}

/**
 * Стоят ли в ЖИВОМ `update.rpf` регистрации `update2:/…` (читается только `content.xml` провайдером). Не прочиталось — `true`: безопаснее пересобрать слой, чем оставить регистрации без контейнера.
 */
async function liveHasCarrierRegistrations({ root, edition, contentXmlProvider, signal = null }) {
  if (typeof contentXmlProvider !== "function") return true;
  const output = path.join(os.tmpdir(), `astral-layer-live-content-${process.pid}-${randomUUID()}.xml`);
  try {
    await contentXmlProvider({ baseArchive: path.join(root, ...ASTRAL_UPDATE_TARGET.split("/")), gameRoot: root, edition, output, signal });
    return carrierContentRegistrations(await fs.readFile(output, "utf8")).length > 0;
  } catch {
    return true;
  } finally {
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

export async function prepareAstralLayerCore(
  {
    gameRoot,
    targetId,
    edition,
    stateDir,
    contentXmlProvider,
    dlcListProvider,
    rpfComposer,
    rpfProbe,
    signal,
    assertRuntimeSafety,
    onProgress,
    /* Сборщики слоёв update.rpf (трассеры, PTFX, кровь): папка Astral
       ложится в тот же архив, и он пересобирается со всеми слоями. */
    materializers = {},
    /* Возврат слоёв после перемотки (снятие вещи из библиотеки): записи, которые правят работы, возвращённые до этой
       пересборки. Эти работы стояли в стопке ниже слоя — слой встал после них и обязан лечь поверх; остальные работы
       (не перематывались) остаются над слоем, как были. Правки мастерской здесь не принимаются за готовое. */
    layersOverEntries = [],
    /* Записи, где работа лежала поверх слоя ещё до снятия (`workOver` основы): их порядок снятие другой вещи не меняет. */
    keepWorkOver = {},
    /* Сверка нашла, что живой архив не несёт записанного движком (`engine-layer-gaps.js`): быстрый путь «ready» пропускается, слой собирается заново. */
    force = false,
    /* Носитель `update2.rpf` (`carrier-guard.js`): `async ({ target }) => Set<имя> | null` — какие контейнеры лежат в нём сейчас. Нет — регистрации по состоянию. */
    carrierPresence = null,
  },
  deps,
) {
  const {
    assertGameRoot,
    assertRuntimeSafe,
    checkedRecordKey,
    exists,
    composeArchiveResource,
    composeAstralContentRegistry,
    ensureArchiveResource,
    ownRecordValue,
    readState,
    rebaseDirectUpdateIfNeeded,
    recoverPendingTransactions,
    resolveInside,
    serializeMutation,
    setRecordValue,
    sha256File,
    statePaths,
    targetKeyFor,
    transact,
    writeState,
  } = deps;
  return serializeMutation(async () => {
    if (edition !== "Legacy") {
      return {
        status: "unsupported-edition",
        ready: false,
        changed: false,
        reason: "unsupported-edition",
      };
    }
    const root = path.resolve(gameRoot);
    await assertGameRoot(root);
    /* С какого мгновения события отчёта цели — этой подготовки. */
    const startedAt = new Date(Date.now() - 1).toISOString();
    /*
     * Тень mods проверяется до всего остального — и на уже подготовленном
     * профиле тоже: загрузчик ставят и после подготовки, а слой при этом
     * молча перестаёт доезжать до игры.
     */
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed) {
      return {
        status: "shadowed",
        ready: false,
        changed: false,
        reason: "mods-shadow",
        shadow,
        message:
          "Игра читает mods/update/update.rpf, а не свой update.rpf: рядом стоит загрузчик " +
          `(${[...shadow.hooks, ...shadow.plugins].join(", ")}). ` +
          "Уберите копию архива из папки mods или отключите загрузчик — иначе установленное в игре не появится.",
      };
    }
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-astral-layer");
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = targetKeyFor(targetId, root);
    checkedRecordKey(targetKey, "Target ID");
    let currentTarget = ownRecordValue(current.targets, targetKey);
    /* Игра переехала (задача 1 ТЗ 10.10.2026): та же цель на новой папке,
       если прежней нет, — или прежняя цель под новым id вместе со всем
       установленным (`moved-target.js`). */
    let moved = false;
    if (currentTarget && path.resolve(currentTarget.gameRoot) !== root) {
      if (!(await repointTarget(currentTarget, root)))
        throw new Error(
          "Идентификатор профиля уже связан с другой папкой GTA V.",
        );
      moved = true;
    }
    if (!currentTarget) {
      const found = await findMovedTarget(current, {
        targetKey,
        root,
        edition,
        liveSha: () => sha256File(resolveInside(root, ASTRAL_UPDATE_TARGET)),
      });
      if (found) {
        moveTarget(current, { fromKey: found[0], toKey: targetKey, root, edition });
        currentTarget = ownRecordValue(current.targets, targetKey);
        moved = true;
      }
    }
    const providersReady =
      typeof contentXmlProvider === "function" &&
      typeof dlcListProvider === "function";
    const composerReady = providersReady && typeof rpfComposer === "function";
    const finalStatus = (target) =>
      target.astralLayer?.registryReady && markerLayer(target)
        ? "ready"
        : "backup-only";
    if (!force && currentTarget?.astralLayer?.schema === ASTRAL_LAYER_SCHEMA) {
      const status = await astralLayerStatus(currentTarget, {
        resolveInside,
        sha256File,
        acceptOwnEdits: layersOverEntries.length === 0,
      });
      const wantRegistry =
        providersReady && !currentTarget.astralLayer.registryReady;
      const wantFolder = composerReady && !markerLayer(currentTarget);
      /* Слой, подготовленный до 26.09.2026, лежит в `x64/astral` — игра
         эту папку не находит (`astral-paths.js`). Такой архив пересобирается
         сразу, при запуске приложения: человек не должен искать, какую
         кнопку нажать, чтобы игра перестала падать. */
      const wantCaseRepair =
        composerReady &&
        currentTarget.astralLayer.container !== ASTRAL_CONTAINER_ROOT;
      // Быстрый путь: архив на месте, и ничего из недоделанного делать
      // по-прежнему нечем. Появившиеся инструменты дочитывают реестр и
      // создают папку медленным путём без второй резервной копии.
      /* Снятие перемотало операцию, чью правку основа вобрала: архив на месте
         побайтно, но основа под ним уже не та (`direct-update-rebase.js`). */
      const wantRewind = await hasRewoundAbsorption({
        target: currentTarget,
        gameRoot: root,
      });
      /* Работа с манифестом в общем контейнере (задача 3 ТЗ 10.10.2026) —
         переезжает в свой сразу (`manifest-containers.js`). */
      const wantManifestSplit =
        composerReady && sharedManifestsToRelocate(currentTarget);
      /* Регистрация следует за фактом (`carrier-follow.js`): работа носителя стоит в состоянии, а контейнеров в живом `update2.rpf` нет (патч игры, проверка файлов) — быстрого пути нет,
         слой пересобирается без регистраций этой работы. Дёшево: читается оглавление носителя, и только когда в состоянии есть наши контейнеры в нём. */
      const carrierCheck = await carrierVerdict({
        target: currentTarget,
        root,
        edition,
        signal,
        presence: typeof carrierPresence === "function" ? ((await carrierPresence({ target: currentTarget }).catch(() => null)) ?? false) : null,
      }).catch(() => ({ lost: null, identities: {} }));
      const wantCarrierRepair = carrierCheck.lost?.length > 0;
      /* Проба нашла всё на изменившемся носителе — его отпечаток запоминается, следующие старты пробу не зовут. */
      const carrierIdentityChanged = !wantCarrierRepair && recordCarrierIdentity(currentTarget, carrierCheck.identities);
      if (
        status.status === "ready" &&
        !wantRegistry &&
        !wantFolder &&
        !wantCaseRepair &&
        !wantRewind &&
        !wantManifestSplit &&
        !wantCarrierRepair
      ) {
        if (status.refreshedIdentity) currentTarget.astralLayer.updateIdentity = status.identity;
        if (status.refreshedIdentity || moved || carrierIdentityChanged) await writeState(current, stateDir);
        return summarize(currentTarget, finalStatus(currentTarget), {
          changed: moved,
          /* Архив отличается от собранного только правками мастерской: пересборка не нужна (`astralLayerStatus`). */
          ...(status.ownEdits ? { ownEdits: true } : {}),
          reconcile: reconcileEventsSince(currentTarget, startedAt),
        });
      }
    }
    /* Для журнала подготовки: архив, который Astral оставил в прошлый раз, и тот, что застали сейчас. */
    const identityBefore = currentTarget?.astralLayer?.updateIdentity || null;
    const identityFound = await liveIdentity(resolveInside(root, ASTRAL_UPDATE_TARGET)).catch(() => null);
    const next = structuredClone(current);
    const target = currentTarget
      ? ownRecordValue(next.targets, targetKey)
      : {
          id: targetKey,
          gameRoot: root,
          edition,
          baselineMode: "original",
          installed: [],
          resources: {},
          archives: {},
          dlcRegistrations: {},
          directDlcRegistrations: {},
        };
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored") {
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );
    }
    target.gameRoot = root;
    target.edition = edition;
    target.resources ||= {};
    target.archives ||= {};
    target.dlcRegistrations ||= {};
    target.directDlcRegistrations ||= {};
    setRecordValue(next.targets, targetKey, target);
    const paths = statePaths(stateDir);
    const freshBaseline = !target.resources[ASTRAL_UPDATE_TARGET];
    onProgress?.({ phase: "astral-layer-inspect", percent: 2 });
    // Чужой слой ищется ДО резервной копии: модовый архив не должен
    // записаться в состояние как «оригинал».
    let liveMarker = false;
    /* Слой прежней установки Astral в архиве (переустановка Astral,
       потерянное состояние, игра из резервной копии): раньше подготовка на
       нём останавливалась и слала человека проверять файлы игры. Это следы
       самого Astral — основой становится игра без них (задача 1 ТЗ
       10.10.2026). */
    let foreignTraces = null;
    if (freshBaseline) {
      try {
        const live = await assertNoForeignAstralLayer({
          target,
          root,
          paths,
          targetKey,
          contentXmlProvider,
          dlcListProvider,
          rpfProbe,
          resolveInside,
        });
        liveMarker = Boolean(live?.marker);
      } catch (error) {
        if (error?.code !== "ASTRAL_FOREIGN_LAYER") throw error;
        foreignTraces = error.registrations;
      }
    }
    const { archive } = await ensureArchiveResource({
      target,
      archiveTarget: ASTRAL_UPDATE_TARGET,
      root,
      paths,
      targetKey,
      signal,
      onProgress: (progress) =>
        onProgress?.({
          ...progress,
          phase: "astral-layer-backup",
          percent:
            progress.totalBytes > 0
              ? 5 +
                Math.floor((progress.copiedBytes / progress.totalBytes) * 80)
              : 5,
        }),
    });
    if (foreignTraces)
      await adoptBaseWithoutTraces({
        target,
        traces: foreignTraces,
        paths,
        targetKey,
        signal,
      });
    const rebased = await rebaseDirectUpdateIfNeeded({
      target,
      root,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
    if (layersOverEntries.length)
      forgetWorkOverOn(target.resources?.[ASTRAL_UPDATE_TARGET], layersOverEntries, keepWorkOver, target.archives?.[ASTRAL_UPDATE_TARGET]);
    /* Проверка файлов (задача 2 ТЗ 10.10.2026) вернула и другие архивы с
       модами — их моды тоже уходят в «снятые». Сняла всё — игра остаётся
       штатной, как после «Вернуть GTA V без модов»: ни метки слоя, ни
       реестров до «Установить снова» или первой установки (`stock-hold.js`). */
    /* Были ли в состоянии работы носителя ДО проверки файлов: проверка могла вернуть штатный `update2.rpf` и запарковать их сама, а регистрации остались в `update.rpf` (Н-6). */
    const hadCarrierWork = carrierOwnership(target).size > 0;
    await parkRevertedArchives({ target, signal });
    /* Работы носителя, чьих контейнеров в живом `update2.rpf` нет, — в «снятые»: регистрация следует за фактом (`carrier-follow.js`). */
    const lostCarriers = await parkLostCarrierMods({
      target,
      root,
      edition,
      signal,
      presence: typeof carrierPresence === "function" ? ((await carrierPresence({ target }).catch(() => null)) ?? false) : null,
    }).catch(() => ({ lost: [], modIds: [], checked: false }));
    recordCarrierIdentity(target, lostCarriers.identities);
    /* Подменил ли архив кто-то снаружи (обновление игры, проверка файлов, чужой лаунчер), — а не наша правка. */
    const swap =
      rebased && lastRebaseOf(target)?.own === false
        ? { outside: true, before: identityBefore, found: identityFound }
        : null;
    /* Ранний «всё запарковано» только пишет состояние: если в живом `update.rpf` стоят регистрации носителя (проверка вернула штатным лишь `update2.rpf`), слой пересобирается ниже без
       них (Н-6). Вернула штатными оба файла — регистраций уже нет, 2 ГБ на старте не пишем и метку слоя в игре, которую человек вернул штатной, не ставим (замечание (б) ревью). */
    if (parkedEverything(target, startedAt) && !(hadCarrierWork && (await liveHasCarrierRegistrations({ root, edition, contentXmlProvider, signal })))) {
      target.stockHold = { mode: "parked", since: new Date().toISOString() };
      const saved = ownRecordValue((await writeState(next, stateDir)).targets, targetKey);
      return summarize(saved, "stock", {
        changed: true,
        stockHold: saved.stockHold,
        ...(swap ? { swap } : {}),
        reconcile: reconcileEventsSince(saved, startedAt),
      });
    }
    let registryReady = Boolean(target.astralLayer?.registryReady);
    if (providersReady) {
      onProgress?.({ phase: "astral-layer-registry", percent: 88 });
      await ensureAstralContentBase({
        target,
        targetKey,
        paths,
        contentXmlProvider,
        archiveTarget: ASTRAL_UPDATE_TARGET,
      });
      await ensureDirectDlcListBase({
        target,
        targetKey,
        paths,
        dlcListProvider,
        archiveTarget: ASTRAL_UPDATE_TARGET,
      });
      registryReady = true;
    }
    const affected = [];
    /* Счёт записей сборки (ответ движка) — в журнал подготовки (`prepare-log.js`). */
    let composeCounts = null;
    if (composerReady) {
      // Папка держится меткой-слоем движка: она собирается в архив тем же
      // путём, что и моды, и переживает снятие последнего мода, но уходит с
      // «Вернуть без модов» вместе со всеми слоями.
      if (!markerLayer(target)) {
        const markerHash = createHash("sha256")
          .update(ASTRAL_LAYER_MARKER_BYTES)
          .digest("hex");
        const cachePath = path.join(
          paths.payloads,
          ASTRAL_LAYER_MOD_ID,
          markerHash,
        );
        if (!(await exists(cachePath))) {
          await fs.mkdir(path.dirname(cachePath), { recursive: true });
          const stage = `${cachePath}.${randomUUID()}.stage`;
          await fs.writeFile(stage, ASTRAL_LAYER_MARKER_BYTES);
          await fs.rename(stage, cachePath);
        }
        const entryState =
          ownRecordValue(archive.entries, ASTRAL_LAYER_MARKER_ENTRY) ||
          setRecordValue(archive.entries, ASTRAL_LAYER_MARKER_ENTRY, {
            layers: [],
          });
        entryState.layers = [
          {
            modId: ASTRAL_LAYER_MOD_ID,
            version: String(ASTRAL_LAYER_SCHEMA),
            /* Над следами прежней установки метка могла остаться в основе:
               `upsert` кладёт её, есть она там или нет. */
            action: foreignTraces ? "upsert" : liveMarker ? "replace" : "import",
            cachePath,
            sha256: markerHash,
          },
        ];
      }
      await composeAstralContentRegistry({
        target,
        targetKey,
        paths,
        contentXmlProvider,
        archiveTarget: ASTRAL_UPDATE_TARGET,
        carrierPresent: typeof carrierPresence === "function" ? ((await carrierPresence({ target }).catch(() => null)) ?? false) : null,
      });
      /* DLC прежней установки — строки dlclist.xml без них: иначе игра
         грузила бы пакет, о котором Astral не знает и который не снимет. */
      if (foreignTraces?.dlcs?.length && typeof dlcListProvider === "function")
        await composeDirectDlcRegistry({
          target,
          targetKey,
          paths,
          dlcListProvider,
          archiveTarget: ASTRAL_UPDATE_TARGET,
        });
      onProgress?.({ phase: "astral-layer-folder", percent: 90 });
      const source = await composeArchiveResource({
        target,
        archiveTarget: ASTRAL_UPDATE_TARGET,
        targetKey,
        edition,
        gameRoot: root,
        paths,
        rpfComposer,
        ...materializers,
        signal,
        assertRuntimeSafety,
        onProgress: (progress) =>
          onProgress?.({ ...progress, phase: "astral-layer-folder" }),
      });
      /* Первая подготовка: основа снята с живого `update.rpf` в начале хода. Если файл за время сборки изменился (Rockstar Launcher, проверка файлов или обновление пишут в него на месте), основа была смесью
         версий, а подмена положила бы собранное из неё на чужой файл — отказ до подмены (23.11.2026). Позже основа живёт отдельно, и подмену снаружи ловят `swap` и `rebased`. */
      if (freshBaseline && identityFound) {
        const identityAfterCompose = await liveIdentity(resolveInside(root, ASTRAL_UPDATE_TARGET)).catch(() => null);
        if (!sameIdentity(identityFound, identityAfterCompose))
          throw new Error(
            `RPF live archive changed during the first preparation: update.rpf was ${identityFound.size} bytes, now ${identityAfterCompose ? identityAfterCompose.size : "missing"}.`,
          );
      }
      composeCounts = composeCountOf(source);
      const change = await changedFile(ASTRAL_UPDATE_TARGET, source, root, {
        resolveInside,
        sha256File,
      });
      if (change) affected.push(change);
    }
    target.astralLayer = {
      schema: ASTRAL_LAYER_SCHEMA,
      container: ASTRAL_CONTAINER_ROOT,
      preparedAt: new Date().toISOString(),
      baseSha256: target.resources[ASTRAL_UPDATE_TARGET].compositionBase.sha256,
      registryReady,
      updateIdentity: await liveIdentity(
        resolveInside(root, ASTRAL_UPDATE_TARGET),
      ),
    };
    let result;
    if (affected.length) {
      onProgress?.({
        phase: "astral-layer-commit",
        percent: 98,
        cancellable: false,
      });
      await assertRuntimeSafe(
        assertRuntimeSafety,
        signal,
        "before-astral-layer-commit",
      );
      result = await transact({
        stateDir,
        current,
        next,
        targetId: targetKey,
        affected,
        action: "prepare-astral-layer",
        signal,
      });
    } else {
      result = await writeState(next, stateDir);
    }
    const saved = ownRecordValue(result.targets, targetKey);
    onProgress?.({ phase: "astral-layer-ready", percent: 100 });
    return summarize(saved, finalStatus(saved), {
      changed: true,
      committed: affected.length > 0,
      rebased,
      freshBaseline,
      ...(composeCounts ? { compose: composeCounts } : {}),
      ...(swap ? { swap } : {}),
      reconcile: reconcileEventsSince(saved, startedAt),
    });
  });
}
