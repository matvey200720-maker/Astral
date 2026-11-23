/*
 * Чужие правки в остальных архивах игры (задача 1 ТЗ 07.10.2026).
 *
 * update.rpf принимает правки снаружи давно (`direct-update-rebase.js`).
 * Остальные архивы, куда пишет Astral, — звуковые `x64/audio/sfx/*.rpf`,
 * штатные пакеты дополнений, — собирались от копии, снятой при первом
 * касании: мод, который человек поставил туда через OpenIV уже после Astral,
 * следующая установка или снятие молча стирали.
 *
 * Теперь так же, как у update.rpf: живой архив сменили в обход движка —
 * новая основа = живой архив, а записи, которые положил Astral, получают
 * прежний вид из прежней основы. Наша ли запись в живом архиве, видно по
 * последнему собранному архиву: лежит ровно то, что положил Astral, — наша;
 * иначе её после нас поменял кто-то ещё, и она остаётся его (слой Astral
 * ляжет поверх, а снятие вернёт её).
 *
 * Без помощника RPF (тесты, браузер) — всё как раньше.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveInside, sha256File } from "./manifest.js";
import { composedSha256, fingerprintSha256, rememberSha256 } from "./file-fingerprint.js";
import { resolveBaseTools } from "./direct-base-cleanup.js";
import { throwIfAborted } from "./runtime-guard.js";
import { copyFileCancellable } from "./transaction.js";
import { ownRewindInProgress } from "./native-history.js";
import { modsInArchives, parkMods } from "./parked-mods.js";
import { noteReconcile } from "./reconcile-report.js";
import { CARRIER_TARGETS, SUBPACK_HOST_ONLY_TARGETS, carrierOfTarget, subpackCarriersOf } from "./carrier-targets.js";
import { settleCarrierResources } from "./carrier-follow.js";

import { storedFileSize } from "./chunk-store.js";
import { ensureBaseFile } from "./base-recovery.js";
import { exists } from "./storage-state.js";

const UPDATE_TARGET = "update/update.rpf";
const lower = (value) => String(value || "").toLowerCase();


/* Свои пакеты Astral (`dlcpacks/astral_*`): чужих правок в них не бывает, а
   изменённый хост и так останавливает установку (`fast-weapon-dlc.js`). */
const OWN_DLC_HOST = /(^|\/)dlcpacks\/astral_[^/]+\/dlc\.rpf$/i;

/** Архив, который это перебазирование знает: RPF игры, кроме update.rpf и своих DLC. */
export const rebasableArchive = (archiveTarget) =>
  /\.rpf$/i.test(String(archiveTarget || "")) &&
  lower(archiveTarget) !== UPDATE_TARGET &&
  !OWN_DLC_HOST.test(String(archiveTarget));

/* Записи архива: какие есть и их SHA-256 (одним запуском помощника). */
async function readEntries(tools, request, archivePath, entries, work) {
  const out = new Map();
  if (!archivePath || !entries.length) return out;
  const present = new Set(
    [...(await tools.entryProbe({ ...request, archivePath, entries }))].map(lower),
  );
  const wanted = entries.filter((entry) => present.has(lower(entry)));
  if (!wanted.length) return out;
  const extracted = await tools.entryReader({
    ...request,
    archivePath,
    entries: wanted,
    outputDirectory: path.join(work, randomUUID()),
  });
  for (const item of extracted || []) {
    const entry = wanted.find((candidate) => lower(candidate) === lower(item.entry));
    if (entry) out.set(entry, { file: item.file, sha256: item.sha256 || (await sha256File(item.file)) });
  }
  return out;
}

/* Живой архив снова штатный, а собранного Astral в нём нет: моды архива — в «снятые». */
async function parkIfStock({ target, archiveTarget, resource, liveHash, withSubpacks = false }) {
  const composite = resource.layers?.at(-1) || null;
  const stock = [resource.pristine?.sha256, resource.original?.sha256].filter(Boolean);
  if (!composite || liveHash === composite.sha256 || !stock.includes(liveHash)) return [];
  if (await ownRewindInProgress({ gameRoot: target.gameRoot })) return [];
  /* Носитель (`update2.rpf`) вернули штатным: человеку нужны слова про дороги и растительность (`carrier-lost`), а не общее «игра восстановлена»; ожидание собранного сбрасывается — иначе «Проверить файлы» видит drift. */
  /* Хозяин подпакета без формы М (штатный пакет, куда пишут и другие работы, одежда): «носитель» только когда в состоянии стоит работа его подпакета; иначе парковка как у любого архива (`restored`), без слов про
     дороги и растительность и без сброса слоя сборки (ревью выключенной ступени 2). */
  const lowerTarget = String(archiveTarget).toLowerCase();
  const hostWithSubpackWork =
    SUBPACK_HOST_ONLY_TARGETS.includes(lowerTarget) &&
    subpackCarriersOf(carrierOfTarget(lowerTarget)).some((row) => Object.values(target?.archives?.[row.target]?.entries || {}).some((entry) => (entry?.layers || []).length > 0));
  const carrier = CARRIER_TARGETS.includes(lowerTarget) || hostWithSubpackWork;
  /* Хозяин вернулся штатным (регистрация и число подпакетов лежали в нём), а `dlc<N>.rpf` с нашими контейнерами остался рядом: игра их больше не монтирует, и работы подпакетов уходят
     в «снятые» вместе с хозяйскими (иначе «числятся, но не видны»). У подпакета основы нет (файла в чистой игре не бывает), поэтому сравнение со штатным хэшем у него не годится: решает хозяин. */
  const archives = [archiveTarget, ...(carrier && withSubpacks ? subpackCarriersOf(carrierOfTarget(archiveTarget)).map((row) => row.target) : [])];
  const parked = parkMods(target, {
    modIds: modsInArchives(target, archives),
    reason: carrier ? "carrier-lost" : "restored",
    archives,
  });
  if (parked.length) noteReconcile(target, { kind: carrier ? "carrier-lost" : "restored-by-launcher", modIds: parked, archive: archiveTarget });
  if (carrier) settleCarrierResources(target);
  return parked;
}

/* Размер копии, что лежит кусками, — из описи: ради размера она не собирается. */
const sizeOf = (file) => storedFileSize(file);

/**
 * Подготовка при запуске (задача 2 ТЗ 10.10.2026): проверка файлов вернула
 * и другие архивы с модами Astral (звуковые банки, эффекты) — их моды тоже
 * уходят в «снятые». Дёшево: архив читается целиком, только если его размер
 * — штатный и не тот, что у сборки Astral.
 */
export async function parkRevertedArchives({ target, signal = null }) {
  const parked = [];
  for (const [archiveTarget, resource] of Object.entries(target?.resources || {})) {
    if (archiveTarget === "update/update.rpf" || !rebasableArchive(archiveTarget)) continue;
    const composite = resource?.layers?.at(-1);
    if (!composite?.cachePath || !resource?.compositionBase?.exists) continue;
    throwIfAborted(signal);
    const livePath = resolveInside(target.gameRoot, archiveTarget);
    const liveSize = await sizeOf(livePath);
    if (liveSize == null || liveSize === (await sizeOf(composite.cachePath))) continue;
    const stockSizes = [await sizeOf(resource.pristine?.path), await sizeOf(resource.original?.path)];
    if (!stockSizes.includes(liveSize)) continue;
    /* Путь запуска (сторож, подготовка слоя): вместе с хозяином паркуются и работы его подпакетов. Путь «Починить» и установки (`rebaseArchiveIfNeeded`) их не трогает: хозяин пересобирается из слоёв состояния, число и регистрации возвращаются. */
    parked.push(...(await parkIfStock({ target, archiveTarget, resource, liveHash: await fingerprintSha256(livePath), withSubpacks: true })));
  }
  return parked;
}

/**
 * Основа архива — по живому архиву, если его сменили в обход движка.
 * Зовётся до того, как слои архива поменяются (установка, снятие, сброс,
 * «Вернуть как было»), и только для архива, который эта же операция
 * пересоберёт или вернёт.
 *
 * @returns {Promise<false | { absorbed: string[], restored: string[] }>}
 *   `false` — основа та же; иначе — какие записи Astral вернулись к прежнему
 *   виду и какие после нас поменял кто-то ещё
 */
export async function rebaseArchiveIfNeeded({
  target,
  archiveTarget,
  paths,
  targetKey,
  baseTools = {},
  signal = null,
  /* Архив снова штатный — его моды в «снятые проверкой файлов»
     (`parked-mods.js`, задача 2 ТЗ 10.10.2026); у «Установить снова» — нет. */
  parkRestored = true,
}) {
  if (!rebasableArchive(archiveTarget)) return false;
  const resource = target.resources?.[archiveTarget];
  const base = resource?.compositionBase;
  if (!base?.exists || !base.path) return false;
  const livePath = resolveInside(target.gameRoot, archiveTarget);
  if (!(await exists(livePath))) return false;
  throwIfAborted(signal);
  const liveHash = await fingerprintSha256(livePath);
  const composite = resource.layers?.at(-1) || null;
  if (liveHash === (composite?.sha256 || base.sha256) || (!composite && liveHash === base.sha256)) return false;
  /* Проверка файлов вернула архив, каким он был до Astral: моды этого
     архива в игре больше не стоят — они ждут «Установить снова». Основа,
     снятая с того же штатного архива (`liveSha256`), — не повод молчать. */
  if (parkRestored) await parkIfStock({ target, archiveTarget, resource, liveHash });
  if (liveHash === base.liveSha256) return false;
  const tools = resolveBaseTools(baseTools);
  if (!tools) return false;
  const owned = Object.entries(target.archives?.[archiveTarget]?.entries || {})
    .filter(([, record]) => (record?.layers || []).length > 0)
    .map(([entry]) => entry)
    .sort((a, b) => a.localeCompare(b));
  const directory = path.join(paths.bases, targetKey, "archive-rebases");
  await fs.mkdir(directory, { recursive: true });
  const work = path.join(directory, `.work-${randomUUID()}`);
  const request = { archiveTarget, edition: target.edition, gameRoot: target.gameRoot, signal };
  try {
    const compositePath =
      composite?.cachePath && (await exists(composite.cachePath)) ? composite.cachePath : null;
    const live = await readEntries(tools, request, livePath, owned, work);
    const wrote = compositePath ? await readEntries(tools, request, compositePath, owned, work) : null;
    /* Основа — образец прежнего вида записей: она могла остыть (куски и опись, файла нет) или пропасть из кэша — вернуть до чтения (`base-recovery.js`; журнал тестера beta.109, 22.11.2026). */
    await ensureBaseFile({ target, archiveTarget, paths, targetKey, gameRoot: target.gameRoot, signal });
    const prior = await readEntries(tools, request, resource.compositionBase?.path || base.path, owned, work);
    const operations = [];
    const absorbed = [];
    const restored = [];
    for (const entry of owned) {
      throwIfAborted(signal);
      const now = live.get(entry)?.sha256 || null;
      /* Без собранного архива доказать нечем — запись считается нашей: чужой
         мод редко правит ровно наши записи, а наша, принятая за игру, осталась
         бы в основе навсегда. */
      const ours = wrote ? now === (wrote.get(entry)?.sha256 || null) : true;
      if (!ours) {
        absorbed.push(entry);
        continue;
      }
      const was = prior.get(entry);
      if (was) {
        if (was.sha256 === now) continue;
        operations.push({ entry, action: now ? "replace" : "upsert", source: was.file, sha256: was.sha256 });
        restored.push(entry);
      } else if (now) {
        operations.push({ entry, action: "delete", allowDelete: true, allowMissing: true });
        restored.push(entry);
      }
    }
    let output;
    if (operations.length) {
      const stage = path.join(directory, `.rebase-${randomUUID()}.stage`);
      try {
        const composed = await tools.rpfComposer({
          baseArchive: livePath,
          outputArchive: stage,
          archiveTarget,
          edition: target.edition,
          gameRoot: target.gameRoot,
          operations,
          allowDeletes: operations.some((operation) => operation.action === "delete"),
          signal,
        });
        /* Помощник сам считает SHA-256 записанного (как в `resource-composition.js`): второе чтение архива не нужно (02.11.2026). */
        const sha256 = composedSha256(composed) || (await sha256File(stage));
        output = { path: path.join(directory, `${sha256}.rpf`), sha256 };
        if (await exists(output.path)) await fs.rm(stage, { force: true });
        else await fs.rename(stage, output.path);
        await rememberSha256(output.path, sha256).catch(() => {});
      } catch (error) {
        await fs.rm(stage, { force: true }).catch(() => {});
        throw error;
      }
    } else {
      const copy = path.join(directory, `${liveHash}.rpf`);
      if (!(await exists(copy))) {
        const stage = `${copy}.${randomUUID()}.stage`;
        await copyFileCancellable(livePath, stage, signal);
        await fs.rename(stage, copy);
      }
      output = { path: copy, sha256: liveHash };
    }
    const baseline = {
      exists: true,
      path: output.path,
      sha256: output.sha256,
      verified: true,
      withoutAstral: true,
      liveSha256: liveHash,
    };
    resource.base = baseline;
    resource.compositionBase = baseline;
    resource.original = baseline;
    resource.clean = { ...baseline, verified: false };
    /* Сборка человека сменилась: «до Astral» теперь — она, а не копия с
       первого касания (как у update.rpf после чужой правки). */
    delete resource.pristine;
    resource.layers = [];
    if (target.archives?.[archiveTarget]) {
      delete target.archives[archiveTarget].lastBuilt;
      /* Запись, которую слой добавлял, могла остаться в основе (чужая правка
         поверх неё) — класть её снова надо «есть или нет». */
      for (const record of Object.values(target.archives[archiveTarget].entries || {}))
        for (const layer of record?.layers || []) if (layer?.action === "import") layer.action = "upsert";
    }
    return { absorbed, restored };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
