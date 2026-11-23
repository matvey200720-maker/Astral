/*
 * Сессия режима Rockstar: подставить моды, вернуть чистые файлы, починить
 * после сбоя, заметить перекачку лаунчером (05.11.2026).
 *
 * Над покадровой подменой одного архива (`../rockstar-swap.js`, движок
 * `rename`) здесь — всё, что делает режим надёжным вне окна:
 *
 *   — переходы идут под общим замком (`mode-files.js`): окно и агент не
 *     двигают файлы одновременно, а пока окно пишет в игру (маркер писателя),
 *     агент ждёт;
 *   — журнал фаз (`idle → arming → armed → disarming → idle`) говорит
 *     восстановлению, на каком шаге оборвалась работа;
 *   — перед подстановкой и возвратом смотрится докачка лаунчера
 *     (`environment.js`): под идущую докачку файлы не трогаем;
 *   — штампы сессии: после подстановки запоминается, как выглядит каждый архив
 *     в игре. Если штамп сменился, архив перезаписал лаунчер Rockstar — на
 *     нём ставится метка, возврат его не трогает и окно просит «Пересобрать»;
 *   — каждое действие пишется в журнал режима (`log.js`).
 *
 * Сессия не знает про процессы игры, таймеры и окно: ей говорят «игра
 * появилась» (`arm`) и «игра закрылась» (`disarm`). Это делает хозяин —
 * агент или окно (`apps/desktop/src/rockstar-mode/host.js`).
 */

import { armSwap, inspectSwap, parkSwap, repairSwap, swappedRels, swapPaths, unparkSwap, UPDATE_RPF } from "../rockstar-swap.js";
import { clearRepairMarks, clearWriter, dropArmedStamps, markRepair, markWriter, readArmedStamps, readJournal, readRepairMarks, withTransitionLock, writeArmedStamps, writeJournal, activeWriter } from "./mode-files.js";
import { describeProcesses, launcherAlive, scanPartials, snapshotProcesses } from "./environment.js";
import fs from "node:fs/promises";

/** Движок «переименование»: те же вызовы, что у `rockstar-swap.js`. */
export const renameEngine = Object.freeze({ inspect: inspectSwap, unpark: unparkSwap, park: parkSwap, repair: repairSwap, arm: armSwap });

const sameStat = (a, b) => Boolean(a && b && a.size === b.size && a.mtimeMs === b.mtimeMs && (!a.ino || !b.ino || a.ino === b.ino));
const messageOf = (error) => String(error?.message || error);

/**
 * @param {object} options
 * @param {string} options.gameRoot
 * @param {() => Promise<string[]>} options.listRels  архивы подмены, update.rpf — первым
 * @param {typeof renameEngine} [options.engine]
 * @param {() => Promise<{name: string, pid?: number}[]>} [options.listProcesses]
 * @param {(scope: string, code: string, data?: object, detail?: string) => Promise<unknown>} [options.log]
 */
export function createModeSession({ gameRoot, listRels, engine = renameEngine, listProcesses = async () => [], log = async () => {}, now = () => new Date(), alive, lockTimeoutMs = 30_000 } = {}) {
  const folderOf = () => swapPaths(gameRoot).folder;
  const locked = (task) => withTransitionLock(folderOf(), task, { timeoutMs: lockTimeoutMs, ...(alive ? { alive } : {}) });
  /* Архивы с подменой на диске (update.rpf — первым): дёшево — без разбора состояния движка, а он на «горячем»
     пути между стартом игры и чтением архива стоил бы сотни миллисекунд. Подставлять, возвращать и чинить
     есть что только у тех, у кого подмена уже лежит на диске. */
  const relsOf = () => relsWithSwap(gameRoot, []);
  /* Архивы, куда писал Astral (по состоянию движка), и с подменой на диске: после записи паркуются все. */
  const allRelsOf = async () => relsWithSwap(gameRoot, await listRels());

  async function whoIsAround() {
    return describeProcesses(await snapshotProcesses(listProcesses));
  }

  /**
   * Игра появилась: моды — в игру. Горячий путь: сперва переименования, потом
   * всё медленное (список процессов для журнала). `{ ok, reason?, results }`;
   * `kind` у архива: `live`, `already`, `busy`, `stale`, `foreign`, `error`, `none`.
   */
  async function arm({ pid = null } = {}) {
    const started = Date.now();
    const folder = folderOf();
    const writer = await activeWriter(folder, alive ? { alive } : {});
    if (writer) {
      await log("arm", "writer-busy", { pid: writer.pid });
      return { ok: false, reason: "writer", results: [] };
    }
    const outcome = await locked(async () => {
      const rels = await relsOf();
      const partials = await scanPartials(gameRoot, rels, { now: () => now().getTime() });
      if (partials.length) {
        await log("arm", "repair-in-progress", { files: partials });
        return { ok: false, reason: "repair-in-progress", files: partials, results: [] };
      }
      const marks = await readRepairMarks(folder);
      await writeJournal(folder, "arming", { pid, now });
      const results = [];
      const stamps = {};
      for (const rel of rels) {
        if (marks?.files[rel]) {
          results.push({ rel, kind: "foreign" });
          continue;
        }
        const at = Date.now();
        const step = await engine.unpark(gameRoot, rel).catch((error) => ({ error }));
        if (step.error) {
          results.push({ rel, kind: "error", message: messageOf(step.error) });
          await log("arm", "error", { rel }, messageOf(step.error));
        } else if (step.changed) {
          stamps[rel] = step.live;
          results.push({ rel, kind: "live" });
          await log("arm", "armed", { rel, ms: Date.now() - at });
        } else if (step.stale) {
          await markRepair(folder, rel, { reason: "game-updated", was: step.meta?.original || null, now: step.live || null, at: now() });
          results.push({ rel, kind: "stale" });
          await log("arm", "game-updated", { rel });
        } else if (step.torn) {
          /* Архив с модами с момента парковки сменил длину — в игру его не ставим: игра с таким архивом не стартует.
             Метка «чужой» даёт окну «Пересобрать»: копии уходят, моды Astral ставит заново. */
          await markRepair(folder, rel, { reason: "mods-torn", was: step.meta?.mods || null, now: step.mods || null, at: now() });
          results.push({ rel, kind: "torn" });
          await log("arm", "mods-torn", { rel, expected: step.meta?.mods?.size ?? null, actual: step.mods?.size ?? null });
        } else if (step.missed) {
          results.push({ rel, kind: "busy", reason: step.reason });
          await log("arm", "busy", { rel, reason: step.reason });
        } else if (step.phase === "live") {
          stamps[rel] = (await readArmedStamps(folder))[rel] || step.live;
          results.push({ rel, kind: "already" });
        } else results.push({ rel, kind: "none" });
      }
      await writeArmedStamps(folder, stamps);
      const anyLive = results.some((item) => item.kind === "live" || item.kind === "already");
      const anyBusy = results.some((item) => item.kind === "busy" || item.kind === "error");
      await writeJournal(folder, anyLive ? "armed" : anyBusy ? "arming" : "idle", { pid, now });
      return { ok: !anyBusy, results, ms: Date.now() - started };
    });
    if (outcome.results.length) {
      const live = outcome.results.filter((item) => item.kind === "live").length;
      if (live) await log("arm", "done", { files: live, ms: outcome.ms });
      const around = await snapshotProcesses(listProcesses);
      if (live && launcherAlive(around)) await log("arm", "launcher-alive", { processes: describeProcesses(around) });
    }
    return outcome;
  }

  /**
   * Игра закрылась: чистые файлы — на место. Архив с меткой «чужой» и архив,
   * чей штамп сменился (лаунчер перекачал его в сессии), не трогаются.
   * `{ ok, busy?, reason?, results }`; `kind`: `returned`, `idle`, `busy`,
   * `foreign`, `error`, `none`. `busy` — файл занят, повторить позже.
   */
  async function disarm() {
    const folder = folderOf();
    return locked(async () => {
      const rels = await relsOf();
      const partials = await scanPartials(gameRoot, rels, { now: () => now().getTime() });
      if (partials.length) {
        await log("disarm", "repair-in-progress", { files: partials });
        return { ok: false, reason: "repair-in-progress", files: partials, results: [] };
      }
      const marks = await readRepairMarks(folder);
      const stamps = await readArmedStamps(folder);
      const results = [];
      let touched = false;
      for (const rel of rels) {
        const state = await engine.inspect(gameRoot, rel).catch(() => null);
        if (!state || state.phase !== "live") continue;
        if (marks?.files[rel]) {
          results.push({ rel, kind: "foreign" });
          continue;
        }
        if (!touched) {
          await writeJournal(folder, "disarming", { now });
          touched = true;
        }
        const at = Date.now();
        const step = await engine.park(gameRoot, { rel, expectedMods: stamps[rel] || null }).catch((error) => ({ error }));
        if (step.error) {
          results.push({ rel, kind: "error", message: messageOf(step.error) });
          await log("disarm", "error", { rel }, messageOf(step.error));
        } else if (step.lost) {
          await markRepair(folder, rel, { reason: "repaired-during-session", was: stamps[rel] || null, now: state.live, who: await whoIsAround(), at: now() });
          results.push({ rel, kind: "foreign" });
          await log("disarm", "repair-detected", { rel });
        } else if (step.busy) {
          results.push({ rel, kind: "busy", reason: step.reason });
          await log("disarm", "busy", { rel, reason: step.reason });
        } else if (step.changed) {
          results.push({ rel, kind: "returned" });
          await log("disarm", "returned", { rel, ms: Date.now() - at });
        } else if (step.idle) results.push({ rel, kind: "idle" });
        else results.push({ rel, kind: "none" });
      }
      const pending = results.some((item) => item.kind === "busy" || item.kind === "error");
      if (!pending) {
        await dropArmedStamps(folder);
        await writeJournal(folder, "idle", { now });
        if (touched) await log("disarm", "done", { files: results.filter((item) => item.kind === "returned").length });
      }
      return { ok: !pending, busy: results.some((item) => item.kind === "busy"), results };
    });
  }

  /**
   * Лаунчер Rockstar перекачал архив прямо во время сессии? Сверяет штампы
   * подставленных архивов с тем, что лежит в игре. Нашла — ставит метку и
   * говорит, какой архив (`{ rel, was, now }`), иначе `null`.
   */
  async function detectRepair() {
    const folder = folderOf();
    const stamps = await readArmedStamps(folder);
    for (const [rel, stamp] of Object.entries(stamps)) {
      const state = await engine.inspect(gameRoot, rel).catch(() => null);
      if (!state?.live || sameStat(state.live, stamp)) continue;
      const who = await whoIsAround();
      const fresh = await markRepair(folder, rel, { reason: "repaired-during-session", was: stamp, now: state.live, who, at: now() });
      if (fresh) await log("watch", "repair-detected", { rel, who });
      return { rel, was: stamp, now: state.live, fresh };
    }
    return null;
  }

  /**
   * Что осталось после сбоя (выключили ПК, закрыли агента, упал Astral):
   * — нет живого архива → встаёт оригинал (для лаунчера это безопасная сторона);
   * — игры нет, а моды в игре → возвращаются чистые файлы;
   * — игра идёт, а режим «взведён» → сессию принимаем как есть (агент
   *   перезапущен посреди игры);
   * — архив с меткой «чужой» не трогается.
   * `{ action: "none" | "returned" | "adopted" | "repaired", returned, repaired }`.
   */
  async function recover({ gameAlive = false } = {}) {
    const folder = folderOf();
    /* Окно пишет в игру: архивы в игре — его рабочие, парковать их нельзя. */
    if (await activeWriter(folder, alive ? { alive } : {})) return { action: "none", returned: 0, repaired: 0, writer: true };
    return locked(async () => {
      const rels = await relsOf();
      const journal = await readJournal(folder);
      const marks = await readRepairMarks(folder);
      const stamps = await readArmedStamps(folder);
      let repaired = 0;
      let returned = 0;
      let busy = false;
      for (const rel of rels) {
        let state = await engine.inspect(gameRoot, rel).catch(() => null);
        if (!state || (state.phase === "missing" && rel !== UPDATE_RPF)) continue;
        if (state.phase === "broken" || state.phase === "missing") {
          state = await engine.repair(gameRoot, rel);
          repaired += 1;
          await log("recover", "file-repaired", { rel, phase: state.phase });
        }
        if (gameAlive || state.phase !== "live" || marks?.files[rel]) continue;
        const step = await engine.park(gameRoot, { rel, expectedMods: stamps[rel] || null }).catch((error) => ({ error }));
        if (step.error) await log("recover", "error", { rel }, messageOf(step.error));
        else if (step.lost) {
          await markRepair(folder, rel, { reason: "repaired-during-session", was: stamps[rel] || null, now: step.live || null, at: now() });
          await log("recover", "repair-detected", { rel });
        } else if (step.busy) busy = true;
        else if (step.changed || step.idle) returned += 1;
      }
      if (gameAlive) {
        if (journal.phase === "armed" || journal.phase === "arming") await log("recover", "session-adopted", { pid: journal.pid });
        return { action: journal.phase === "armed" || journal.phase === "arming" ? "adopted" : "none", returned: 0, repaired };
      }
      if (!busy) {
        await dropArmedStamps(folder);
        if (journal.phase !== "idle") {
          await writeJournal(folder, "idle", { now });
          await log("recover", "journal-reset", { was: journal.phase });
        }
      }
      if (returned) await log("recover", "returned", { files: returned, was: journal.phase });
      return { action: returned ? "returned" : repaired ? "repaired" : "none", returned, repaired, busy };
    });
  }

  /**
   * «Пересобрать»: архивы с меткой «чужой» (перекачаны лаунчером или игра
   * обновилась) освобождаются от подмены — копии модов и оригинала уходят,
   * метка снимается. Дальше Astral ставит моды на новую основу как обычно.
   * Только при закрытой игре.
   */
  async function rebuild() {
    const folder = folderOf();
    return locked(async () => {
      const marks = await readRepairMarks(folder);
      if (!marks) return { rebuilt: [] };
      const rebuilt = [];
      for (const rel of Object.keys(marks.files)) {
        const paths = swapPaths(gameRoot, rel);
        await Promise.all([paths.mods, paths.original, paths.meta].map((file) => fs.rm(file, { force: true })));
        await clearRepairMarks(folder, rel);
        rebuilt.push(rel);
        await log("rebuild", "dropped", { rel });
      }
      await dropArmedStamps(folder);
      await writeJournal(folder, "idle", { now });
      return { rebuilt };
    });
  }

  /** Окно собирается писать в игру: моды на время записи на место, агент ждёт. */
  async function holdForWrite({ pid = process.pid } = {}) {
    const folder = folderOf();
    await markWriter(folder, { pid, now });
    return locked(async () => {
      const events = [];
      const marks = await readRepairMarks(folder);
      for (const rel of await relsOf()) {
        if (marks?.files[rel]) continue;
        const step = await engine.unpark(gameRoot, rel).catch((error) => ({ error }));
        if (step.stale || step.torn) {
          await fs.rm(step.paths.mods, { force: true }).catch(() => {});
          events.push({ rel, kind: step.torn ? "torn" : "stale" });
        } else if (step.missed) events.push({ rel, kind: "busy" });
        else if (step.error) events.push({ rel, kind: "error", message: messageOf(step.error) });
      }
      return events;
    });
  }

  /** Запись закончилась: моды снова на парковку (`arm` — по «игре до Astral» из движка). */
  async function releaseAfterWrite({ originals = [], pid = process.pid } = {}) {
    const folder = folderOf();
    try {
      return await locked(async () => {
        const events = [];
        for (const rel of await allRelsOf()) {
          try {
            const original = originals.find((item) => item.rel.toLowerCase() === rel.toLowerCase()) || null;
            const armed = original ? await engine.arm({ gameRoot, original, rel }) : await engine.park(gameRoot, { rel });
            if (armed.waiting || (!original && !armed.changed)) continue;
            events.push({ rel, kind: armed.idle ? "idle" : "parked" });
          } catch (error) {
            events.push({ rel, kind: "error", message: messageOf(error) });
          }
        }
        await dropArmedStamps(folder);
        await writeJournal(folder, "idle", { now });
        return events;
      });
    } finally {
      await clearWriter(folder, { pid });
    }
  }

  /** Запись кончилась, а игра идёт: маркер писателя снимается, моды остаются на месте. */
  const endWrite = ({ pid = process.pid } = {}) => clearWriter(folderOf(), { pid });

  /** Состояние для окна: фаза журнала, фазы архивов, метки. */
  async function snapshot() {
    const folder = folderOf();
    const [journal, marks] = await Promise.all([readJournal(folder), readRepairMarks(folder)]);
    const files = [];
    for (const rel of await relsOf()) {
      const state = await engine.inspect(gameRoot, rel).catch(() => null);
      if (state && !(state.phase === "missing" && rel !== UPDATE_RPF)) files.push({ rel, phase: state.phase });
    }
    return { journal, marks, files, folder };
  }

  return { arm, disarm, detectRepair, recover, rebuild, holdForWrite, releaseAfterWrite, endWrite, snapshot, folder: folderOf };
}

/** Архивы, у которых на диске есть подмена, плюс известные движку (update.rpf — первым). */
export async function relsWithSwap(gameRoot, known = []) {
  const seen = new Set();
  const rels = [];
  for (const rel of [UPDATE_RPF, ...known, ...(await swappedRels(gameRoot).catch(() => []))]) {
    const key = rel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rels.push(rel);
  }
  return rels;
}
