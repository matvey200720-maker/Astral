/*
 * Служебные файлы образа режима Rockstar (05.11.2026): журнал фаз, штампы
 * сессии, метки ремонта, маркер писателя и замок переходов. Все лежат в папке
 * образа рядом с архивами (`store.js`), пишутся через временный файл и
 * переименование, читаются без исключений: битый файл — как будто его нет.
 *
 *   journal.json         — что делает режим сейчас: idle / arming / armed /
 *                          disarming, pid игры, время. По нему восстановление
 *                          отличает «идёт сессия» от «упали посреди подмены»;
 *   armed.json           — штампы архивов в игре на момент подстановки:
 *                          если у архива штамп сменился, его перезаписал кто-то
 *                          другой (лаунчер Rockstar), и это уже не наши моды;
 *   repair.json          — метки «этот архив теперь чужой»: перекачан лаунчером
 *                          во время сессии или игра обновилась. Пока метка
 *                          стоит, возврат этот архив не трогает;
 *   writer.json          — Astral пишет в игру (окно в рамке записи): агент в
 *                          это время ничего не двигает;
 *   transition.lock      — один переход (подставить / вернуть / починить) за
 *                          раз на все процессы Astral.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const PHASES = Object.freeze(["idle", "arming", "armed", "disarming"]);

async function readJson(file, fallback) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stage = `${file}.${process.pid}.stage`;
  await fs.writeFile(stage, JSON.stringify(value, null, 2));
  await fs.rename(stage, file);
}

const remove = (file) => fs.rm(file, { force: true }).catch(() => {});

/* ------------------------------- журнал фаз ------------------------------- */

const journalFile = (folder) => path.join(folder, "journal.json");

/** `{ phase, pid, updatedAt }`; без файла — `idle`. */
export async function readJournal(folder) {
  const value = await readJson(journalFile(folder), {});
  return { phase: PHASES.includes(value.phase) ? value.phase : "idle", pid: Number.isInteger(value.pid) ? value.pid : null, updatedAt: value.updatedAt || null };
}

/** Записать фазу; возвращает прежнюю. */
export async function writeJournal(folder, phase, { pid = null, now = () => new Date() } = {}) {
  if (!PHASES.includes(phase)) throw new Error(`Неизвестная фаза режима: ${phase}`);
  const before = (await readJournal(folder)).phase;
  await writeJson(journalFile(folder), { phase, pid, updatedAt: now().toISOString() });
  return before;
}

/* ------------------------------ штампы сессии ----------------------------- */

const armedFile = (folder) => path.join(folder, "armed.json");

/** `{ <архив>: { size, mtimeMs, ino } }` — что стояло в игре, когда моды встали. */
export const readArmedStamps = (folder) => readJson(armedFile(folder), {});
export const writeArmedStamps = (folder, stamps) => (Object.keys(stamps).length ? writeJson(armedFile(folder), stamps) : remove(armedFile(folder)));
export const dropArmedStamps = (folder) => remove(armedFile(folder));

/* ------------------------------ метки ремонта ----------------------------- */

const repairFile = (folder) => path.join(folder, "repair.json");

/* `mods-torn` (14.11.2026) — архив с модами недописан; окну он показывается так же, как перекачка: «Пересобрать». */
export const REPAIR_REASONS = Object.freeze(["repaired-during-session", "game-updated", "mods-torn"]);

/** `{ files: { <архив>: { reason, was, now, who, at } } }` или `null`, если чужих архивов нет. */
export async function readRepairMarks(folder) {
  const value = await readJson(repairFile(folder), {});
  const files = value.files && typeof value.files === "object" ? value.files : {};
  return Object.keys(files).length ? { files } : null;
}

/** Поставить метку архиву (первая метка не затирается: она точнее). `true` — поставлена новая. */
export async function markRepair(folder, rel, { reason, was = null, now = null, who = "", at = new Date() } = {}) {
  const marks = (await readRepairMarks(folder)) || { files: {} };
  if (marks.files[rel]) return false;
  marks.files[rel] = { reason: REPAIR_REASONS.includes(reason) ? reason : "repaired-during-session", was, now, who, at: at.toISOString() };
  await writeJson(repairFile(folder), marks);
  return true;
}

/** Снять метки (все или одного архива). */
export async function clearRepairMarks(folder, rel = null) {
  const marks = await readRepairMarks(folder);
  if (!marks) return;
  if (rel) delete marks.files[rel];
  else marks.files = {};
  if (Object.keys(marks.files).length) await writeJson(repairFile(folder), marks);
  else await remove(repairFile(folder));
}

/* ------------------------------ маркер писателя --------------------------- */

const writerFile = (folder) => path.join(folder, "writer.json");
const WRITER_MAX_MS = 30 * 60_000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export const markWriter = (folder, { pid = process.pid, now = () => new Date() } = {}) => writeJson(writerFile(folder), { pid, since: now().toISOString() });
export const clearWriter = (folder, { pid = process.pid } = {}) =>
  readJson(writerFile(folder), {}).then((value) => (!value.pid || value.pid === pid ? remove(writerFile(folder)) : undefined));

/** Кто сейчас пишет в игру (живой процесс, не дольше 30 минут) — или `null`. */
export async function activeWriter(folder, { alive = pidAlive, now = Date.now, self = process.pid } = {}) {
  const value = await readJson(writerFile(folder), {});
  if (!Number.isInteger(value.pid) || value.pid === self) return null;
  if (!alive(value.pid) || now() - Date.parse(value.since || 0) > WRITER_MAX_MS) return null;
  return value;
}

/* ------------------------------- замок переходов -------------------------- */

const STALE_LOCK_MS = 2 * 60_000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Один переход за раз на все процессы: файл замка создаётся флагом `wx`.
 * Замок мёртвого процесса или старше двух минут отбирается. Не взяли за
 * `timeoutMs` — ошибка `ROCKSTAR_MODE_LOCK_TIMEOUT`.
 */
export async function withTransitionLock(folder, task, { timeoutMs = 30_000, pollMs = 40, alive = pidAlive, now = Date.now } = {}) {
  const file = path.join(folder, "transition.lock");
  await fs.mkdir(folder, { recursive: true });
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      const handle = await fs.open(file, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() }));
      await handle.close();
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const holder = await readJson(file, {});
      const age = now() - Date.parse(holder.at || 0);
      if (!Number.isInteger(holder.pid) || !alive(holder.pid) || age > STALE_LOCK_MS) {
        await remove(file);
        continue;
      }
      if (now() >= deadline) throw Object.assign(new Error("Режим Rockstar занят другим переходом."), { code: "ROCKSTAR_MODE_LOCK_TIMEOUT" });
      await sleep(pollMs);
    }
  }
  try {
    return await task();
  } finally {
    await remove(file);
  }
}
