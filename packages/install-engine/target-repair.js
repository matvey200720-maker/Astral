/*
 * Проверка файлов игры, «Вернуть как было» и правки снаружи перед сбросом.
 *
 * Сборка человека (задача 1 ТЗ 07.10.2026): архивы игры могли поменять уже
 * после записи Astral — мод через OpenIV, обновление игры. Прежде «Вернуть
 * как было» копировал прошлую сборку Astral поверх живого архива, а «Вернуть
 * GTA V без модов» — копию с прошлой записи: и то и другое стирало чужую
 * правку. Теперь основа сначала берёт правки из живых архивов
 * (`direct-update-rebase.js`, `archive-rebase.js`), и только потом идёт
 * возврат или пересборка слоёв Astral поверх неё.
 */

import { tailCarriersOfState } from "./rpf-tail-switch.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { parkRevertedArchives, rebasableArchive, rebaseArchiveIfNeeded } from "./archive-rebase.js";
import { reachedByOwnNativeChanges } from "./native-history.js";
import { inOperation } from "./operation-scope.js";
import {
  composeAstralContentRegistry,
  isAstralUpdateTarget,
} from "./registry-composers.js";
import { composeArchiveResource } from "./resource-composition.js";
import { ensureStoredFile } from "./chunk-store.js";
import fs from "node:fs/promises";
import {
  activeBaseline,
  activeBaselinePath,
  DEFAULT_DIR,
  exists,
  statePaths,
} from "./storage-state.js";
import { resolveInside } from "./manifest.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { readState, serializeMutation, writeState } from "./engine-state.js";
import { assertStoredOrComposite } from "./composite-home.js";
import { reduxLayerOf } from "./redux-state.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { recoverPendingTransactions, transact } from "./transactions.js";
import { orderForCarriers } from "./carrier-order.js";

const UPDATE_TARGET = "update/update.rpf";

/**
 * Правки снаружи — в основу, перед сбросом. Сброс — запасной выход: не вышло
 * принять правки — возврат идёт, как раньше, а причина уходит в журнал.
 *
 * @returns {Promise<string[]>} архивы, основа которых сменилась
 */
export async function adoptOutsideChanges({
  target,
  paths,
  targetKey,
  contentXmlProvider,
  dlcListProvider,
  signal,
  /* Архивы, принимать правки которых незачем (сброс 12.10): возврат кладёт
     их байты без оглядки на то, что приняла бы основа (`reset-plan.js`). */
  skip = null,
}) {
  const adopted = [];
  if (
    target.resources?.[UPDATE_TARGET] &&
    typeof contentXmlProvider === "function" &&
    !skip?.has(UPDATE_TARGET)
  ) {
    try {
      if (
        await rebaseDirectUpdateIfNeeded({
          target,
          root: target.gameRoot,
          paths,
          targetKey,
          contentXmlProvider,
          dlcListProvider,
          signal,
          parkRestored: false,
        })
      )
        adopted.push(UPDATE_TARGET);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[astral-engine] Правки update.rpf перед сбросом не приняты: ${error?.message || error}`);
    }
  }
  for (const archiveTarget of Object.keys(target.resources || {})) {
    if (!rebasableArchive(archiveTarget) || skip?.has(archiveTarget)) continue;
    try {
      if (await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal, parkRestored: false }))
        adopted.push(archiveTarget);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[astral-engine] Правки ${archiveTarget} перед сбросом не приняты: ${error?.message || error}`);
    }
  }
  return adopted;
}

/**
 * Сколько установок пишет в архив цели: разные `modId` слоёв по записям архива (`target.archives[путь].entries`). Заменёнка вещи — одна установка на несколько записей (модель и листы).
 * Нужно стражу паков (`clothing-pack-heal.js`): «N заменёнок вернулись в пак».
 */
export function modsInArchive(target, relativePath) {
  const ids = new Set();
  const entries = Object.values(target?.archives?.[relativePath]?.entries || {});
  for (const entry of entries)
    for (const layer of entry?.layers || [])
      if (layer?.modId && layer.action !== "delete") ids.add(layer.modId);
  return ids.size;
}

/**
 * Проверка файлов игры вернула архивы с модами Astral к штатному — их моды уходят в «снятые» (`parked-mods.js`), и «Установить снова» (`restoreParkedMods`) кладёт их обратно. Так делает подготовка игры
 * при запуске (`astral-layer.js`); здесь тот же шаг отдельно — его зовёт страж паков (`apps/desktop/src/clothing-pack-heal.js`), чтобы поставить возвращённое обратно без «Вернуть как было»:
 * `repairTarget` на штатном архиве мод только снимает, а не возвращает (находка сценария «второй ПК», 14.11.2026).
 * Файлы игры не трогаются: живой архив уже штатный, меняется только запись состояния.
 *
 * @returns {Promise<{ parked: string[] }>} modId снятых модов; пусто — вернувшихся к штатному архивов нет
 */
export async function parkRevertedMods({ targetId = "default", stateDir = DEFAULT_DIR, signal = null }) {
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const known = ownRecordValue(current.targets, targetKey);
    if (!known || (known.vanillaGuard && known.vanillaGuard.phase !== "restored")) return { parked: [] };
    const next = structuredClone(current);
    const parked = await parkRevertedArchives({ target: ownRecordValue(next.targets, targetKey), signal });
    if (!parked.length) return { parked: [] };
    await writeState(next, stateDir);
    return { parked: [...new Set(parked)] };
  });
}

/**
 * Какие из `modIds` сейчас в «снятых проверкой файлов» и сняты с архивов из `archives` (пути как в состоянии). Страж паков (`clothing-pack-heal.js`) по этому ответу доводит возврат, который
 * сам начал и не закончил (упал после `parkRevertedMods`, приложение закрыли, файл был занят): снятые человеком моды сюда не попадают, потому что страж спрашивает только про свои `modIds`.
 *
 * @returns {Promise<string[]>}
 */
export async function parkedModsInArchives({ targetId = "default", stateDir = DEFAULT_DIR, modIds = [], archives = [] }) {
  const wantedMods = new Set([...modIds].filter(Boolean));
  const normal = (value) => String(value || "").toLowerCase().replace(/\\/g, "/");
  const wantedArchives = new Set([...archives].map(normal));
  if (!wantedMods.size || !wantedArchives.size) return [];
  const state = await readState(stateDir);
  const target = ownRecordValue(state.targets, checkedRecordKey(targetId, "Target ID"));
  const installed = new Set((target?.installed || []).map((item) => item?.modId));
  const out = new Set();
  for (const item of Array.isArray(target?.parked) ? target.parked : [])
    if (
      wantedMods.has(item?.modId) &&
      !installed.has(item.modId) &&
      (item.archives || []).some((archive) => wantedArchives.has(normal(archive)))
    )
      out.add(item.modId);
  return [...out];
}

/** Причина «хвост живого update.rpf короче запаса» в отчёте проверки (код тот же, что у отказа перед подменой, `apps/desktop/src/rpf-tail.js`). */
export const RPF_TAIL_SHORT = "RPF_TAIL_SHORT";

/**
 * `tailCheck({ file, archiveTarget })` — необязательная проверка хвоста живого `update.rpf` (движок: `tail-rpf --check`); ответ `{ ok: false, … }` попадает
 * в отчёт полем `tail`, статус от него не меняется: файл не расходится с состоянием, но игра, возможно, его не прочтёт (съёмка 20.11.2026).
 */
export async function auditTarget({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  tailCheck = null,
}) {
  await recoverPendingTransactions({ stateDir });
  const state = await readState(stateDir);
  const targetKey = checkedRecordKey(targetId, "Target ID");
  const target = ownRecordValue(state.targets, targetKey);
  if (!target)
    return {
      targetId,
      status: "not-configured",
      checked: 0,
      healthy: 0,
      drift: [],
    };
  if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
    return {
      targetId,
      status: "suspended",
      checked: 0,
      healthy: 0,
      drift: [],
      vanillaGuard: target.vanillaGuard.phase,
    };
  const drift = [];
  const ownNative = [];
  let healthy = 0;
  for (const [relativePath, resource] of Object.entries(
    target.resources || {},
  )) {
    const top = resource.layers?.at(-1);
    const baseline = activeBaseline(target, resource);
    const expectedPath =
      top?.cachePath || (baseline.exists ? baseline.path : null);
    const expectedHash = top?.sha256 || baseline.sha256 || null;
    const livePath = resolveInside(target.gameRoot, relativePath);
    const liveExists = await exists(livePath);
    if (!expectedPath) {
      if (liveExists)
        drift.push({ relativePath, reason: "unexpected-file", owner: null });
      else healthy++;
      continue;
    }
    if (!liveExists) {
      drift.push({
        relativePath,
        reason: "missing",
        owner: top?.modId || "original",
        baselineHash: baseline.sha256 || null,
        mods: modsInArchive(target, relativePath),
      });
      continue;
    }
    /*
     * Отпечаток по записи файла (задача 6 ТЗ 10.10.2026): проверка идёт при
     * каждом запуске и честным чтением брала все архивы цели — у владельца
     * 12,9 ГБ (update.rpf и девять своих DLC) за запуск. Файл, который с
     * прошлой проверки не трогали, не перечитывается; правленый — читается.
     */
    const actualHash = await fingerprintSha256(livePath);
    /*
     * update.rpf, который с записи движка сменили наши же нативные правки (работа мастерской: прицел, мини-карта, частицы), — не расхождение (17.11.2026). Хост пишет архив мимо
     * состояния, и запись об `update.rpf` остаётся прежней; проверка принимала это за «изменено не через Astral», а страж одежды говорил про это красным окном. От записанного
     * отпечатка к живому файлу ведёт цепочка точек отката (`native-history.js`) — так же перебазирование отличает нашу правку от обновления игры.
     */
    if (
      expectedHash &&
      actualHash !== expectedHash &&
      relativePath === UPDATE_TARGET &&
      (await inOperation(() =>
        reachedByOwnNativeChanges({ gameRoot: target.gameRoot, known: [expectedHash], live: actualHash }),
      ))
    ) {
      ownNative.push(relativePath);
      healthy++;
      continue;
    }
    if (expectedHash && actualHash !== expectedHash)
      drift.push({
        relativePath,
        reason: "modified",
        owner: top?.modId || "original",
        expectedHash,
        actualHash,
        /* Отпечаток файла, каким он был до первой записи Astral: `actualHash` равен ему — файл вернули к штатному; не равен ни ему, ни `expectedHash` — файл сменился на что-то третье (обновление игры, чужой мод). */
        baselineHash: baseline.sha256 || null,
        mods: modsInArchive(target, relativePath),
      });
    else healthy++;
  }
  const tail = [];
  if (typeof tailCheck === "function") {
    /* Носители хвоста: update.rpf и update2.rpf (`rpf-tail-switch.js: TAIL_CARRIERS`); у кого нет записи состояния, того не проверяем. */
    for (const carrier of tailCarriersOfState(target)) {
      if (!target.resources?.[carrier]) continue;
      const livePath = resolveInside(target.gameRoot, carrier);
      if (!(await exists(livePath))) continue;
      const answer = await tailCheck({ file: livePath, archiveTarget: carrier }).catch(() => null);
      if (answer && answer.ok === false)
        tail.push({ relativePath: carrier, reason: RPF_TAIL_SHORT, distance: answer.distance ?? null, min: answer.min ?? null, len: answer.len ?? null });
    }
  }
  return {
    targetId,
    status: drift.length ? "drift" : "healthy",
    checked: healthy + drift.length,
    healthy,
    drift,
    ...(tail.length ? { tail } : {}),
    /* Архивы, которые сменили наши нативные правки: они в `healthy`, а здесь названы, чтобы это было видно. */
    ...(ownNative.length ? { ownNative } : {}),
  };
}

/*
 * «Вернуть как было» для архива: основа по живому архиву и слои Astral
 * заново поверх неё — вместо копии прошлой сборки.
 */
async function rebuildArchiveOver({
  target,
  archiveTarget,
  targetKey,
  paths,
  rpfComposer,
  contentXmlProvider,
  dlcListProvider,
  signal,
}) {
  if (archiveTarget === UPDATE_TARGET)
    await rebaseDirectUpdateIfNeeded({
      target,
      root: target.gameRoot,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
  else await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal });
  if (isAstralUpdateTarget(archiveTarget))
    await composeAstralContentRegistry({
      target,
      targetKey,
      paths,
      contentXmlProvider,
      archiveTarget,
    });
  return composeArchiveResource({
    target,
    archiveTarget,
    targetKey,
    edition: target.edition,
    gameRoot: target.gameRoot,
    paths,
    rpfComposer,
    signal,
  });
}

/*
 * Копия, из которой «Вернуть как было» кладёт файл в игру, — только из
 * хранилища движка (бета 13.10.2026): после переноса кэша на другой диск
 * путь прежнего корня вёл копию с C:, которой уже нет (`ENOENT`), а то и
 * устаревшую, если старая папка не удалилась. Пути состояния к новому
 * корню переносит `relocateStateFile` при запуске и `loadState` при чтении.
 */
const storedSource = (paths, file) =>
  file ? assertStoredOrComposite(paths, file) : file;

/* Файл хранилища на месте — целиком или кусками (`chunk-store.js` поднимает его обратно). */
async function storedFileIsThere(file, signal) {
  await ensureStoredFile(file, { signal }).catch(() => {});
  return fs.stat(file).then(
    (stat) => stat.isFile(),
    () => false,
  );
}

export async function repairTarget({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  rpfComposer = null,
  contentXmlProvider = null,
  dlcListProvider = null,
  signal = null,
  /* Проверка установленных редуксов (`redux-state.js`): `async ({ items, target, gameRoot, stateDir, signal })` → `{ lost: [modId] }`.
     Потерянный (dlc не цел или слоя в движке нет) уходит из установленного — окно предложит поставить заново. */
  reduxRepairer = null,
}) {
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    let current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    let target = ownRecordValue(current.targets, targetKey);
    if (!target) throw new Error("Игровой профиль не найден.");
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );
    const reduxItems = (target.installed || []).filter((item) => reduxLayerOf(item));
    if (typeof reduxRepairer === "function" && reduxItems.length) {
      const verdict = await reduxRepairer({ items: structuredClone(reduxItems), target: structuredClone(target), gameRoot: target.gameRoot, stateDir, signal });
      const lost = new Set(Array.isArray(verdict?.lost) ? verdict.lost : []);
      if (lost.size) {
        const next = structuredClone(current);
        const nextTarget = ownRecordValue(next.targets, targetKey);
        nextTarget.installed = (nextTarget.installed || []).filter((item) => !(reduxLayerOf(item) && lost.has(item.modId)));
        await writeState(next, stateDir);
        current = next;
        target = nextTarget;
      }
    }
    const report = await auditTarget({ targetId, stateDir });
    if (!report.drift.length) return { state: current, report };
    const paths = statePaths(stateDir);
    /* Изменённый архив со слоями Astral — пересборкой поверх сборки
       человека; не вышло — как раньше, копией прошлой сборки. */
    const rebuildable = report.drift.filter(
      (item) =>
        item.reason === "modified" &&
        typeof rpfComposer === "function" &&
        target.archives?.[item.relativePath] &&
        (item.relativePath !== UPDATE_TARGET || typeof contentXmlProvider === "function"),
    );
    if (rebuildable.length) {
      const next = structuredClone(current);
      const nextTarget = ownRecordValue(next.targets, targetKey);
      try {
        const affected = [];
        for (const item of report.drift) {
          const livePath = resolveInside(nextTarget.gameRoot, item.relativePath);
          if (rebuildable.includes(item)) {
            affected.push({
              relativePath: item.relativePath,
              livePath,
              sourcePath: await rebuildArchiveOver({
                target: nextTarget,
                archiveTarget: item.relativePath,
                targetKey,
                paths,
                rpfComposer,
                contentXmlProvider,
                dlcListProvider,
                signal,
              }),
            });
            continue;
          }
          const resource = nextTarget.resources[item.relativePath];
          const top = resource.layers?.at(-1);
          affected.push({
            relativePath: item.relativePath,
            livePath,
            sourcePath: storedSource(paths, top?.cachePath || activeBaselinePath(nextTarget, resource)),
          });
        }
        const state = await transact({
          stateDir,
          current,
          next,
          targetId,
          affected: orderForCarriers(affected, "install"),
          action: "repair",
          signal,
        });
        /* Признак принятия чужой основы (решение первого лида по П3, 21.11.2026): пересборка поверх файла человека приняла его как основу (`resource.adoptedUpdate`, `direct-update-rebase.js`),
           то есть чужая запись внутри архива осталась как есть, а проверка стала зелёной. Список архивов — полем, без текста; без принятия поля нет и ответ прежний. */
        const adopted = rebuildable
          .map((item) => item.relativePath)
          .filter((relativePath) => String(nextTarget.resources?.[relativePath]?.adoptedUpdate?.at || "") !== String(target.resources?.[relativePath]?.adoptedUpdate?.at || ""));
        return { state, report: await auditTarget({ targetId, stateDir }), ...(adopted.length ? { adopted } : {}) };
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn(`[astral-engine] Пересборка поверх сборки человека не вышла, «Вернуть как было» — копией: ${error?.message || error}`);
      }
    }
    const next = structuredClone(current);
    const nextTarget = ownRecordValue(next.targets, targetKey);
    const affected = [];
    const patchesNotAdopted = [];
    for (const item of report.drift) {
      const resource = nextTarget.resources[item.relativePath];
      const top = resource.layers?.at(-1);
      let sourcePath = storedSource(paths, top?.cachePath || activeBaselinePath(nextTarget, resource));
      /* Копии сборки в кэше может не быть: с «одной записью вместо двух» она перенесена в игру (`transactions.js:
         shouldMove`) или её собрал движок рядом с живым файлом. Тогда архив собирается заново из основы и слоёв состояния —
         тот же отпечаток, тот же путь; собрать нечем — отказ словами, а не «файл не найден». */
      if (top?.cachePath && sourcePath && !(await storedFileIsThere(sourcePath, signal))) {
        if (typeof rpfComposer !== "function" || !nextTarget.archives?.[item.relativePath])
          throw new Error(`«Починить»: сборки ${item.relativePath} нет в кэше, а собрать её заново нечем — переустановите моды этого архива.`);
        /* К5 (22.11.2026): сборка из прежней основы стёрла бы нативные правки мастерской, сделанные после неё, — основа вбирает их до сборки, как в основном пути выше. */
        /* Не принял правки (чужая правка не читается, помощник не ответил) — «Починить» не отказывает: собирает из прежней основы, как до К5, и называет архив в `patchesNotAdopted` (окно скажет применить правки мастерской снова). */
        if (item.relativePath === UPDATE_TARGET && typeof contentXmlProvider === "function")
          try {
            await rebaseDirectUpdateIfNeeded({ target: nextTarget, root: nextTarget.gameRoot, paths, targetKey, contentXmlProvider, dlcListProvider, signal });
          } catch (error) {
            if (signal?.aborted) throw error;
            console.warn(`[astral-engine] Правки update.rpf перед запасной сборкой не приняты: ${error?.message || error}`);
            patchesNotAdopted.push(UPDATE_TARGET);
          }
        sourcePath = storedSource(
          paths,
          await composeArchiveResource({
            target: nextTarget,
            archiveTarget: item.relativePath,
            targetKey,
            edition: nextTarget.edition,
            gameRoot: nextTarget.gameRoot,
            paths,
            rpfComposer,
            signal,
          }),
        );
      }
      affected.push({ relativePath: item.relativePath, livePath: resolveInside(nextTarget.gameRoot, item.relativePath), sourcePath });
    }
    const state = await transact({
      stateDir,
      current,
      next,
      targetId,
      affected: orderForCarriers(affected, "install"),
      action: "repair",
    });
    return { state, report: await auditTarget({ targetId, stateDir }), ...(patchesNotAdopted.length ? { patchesNotAdopted } : {}) };
  });
}
