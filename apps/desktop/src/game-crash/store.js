/*
 * Память журнала падений: не больше 10 последних падений, метка последней проверки, какие падения человеку уже
 * показывали (ТЗ владельца 11.11.2026). Файл лежит в данных приложения (`game-crashes.json`) и пишется атомарно.
 *
 * Дубли одного события не множатся: падение с тем же местом в пределах двух минут от уже записанного — то же падение
 * (событие Windows и строка журнала клиента приходят в разное время, а описывают один сбой); запись дополняется, а не
 * дублируется.
 */
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../atomic-file.js";
import { isRageLauncherAbort } from "./classify.js";

export const STORE_FILE = "game-crashes.json";
export const KEEP_CRASHES = 10;
export const SAME_CRASH_MS = 2 * 60 * 1000;
const SCHEMA = 1;
/** Предел «не показывали»: падение старше двух суток уже не новость (первая проверка после обновления находит и недельные — они только в разделе). */
const NOTICE_AGE_MS = 2 * 24 * 3600 * 1000;

const empty = () => ({ schema: SCHEMA, checkedAt: 0, crashes: [], noticed: [] });

function sanitize(raw) {
  if (!raw || typeof raw !== "object") return empty();
  const crashes = (Array.isArray(raw.crashes) ? raw.crashes : [])
    .filter((item) => item && typeof item.id === "string" && Number.isFinite(item.t))
    .sort((a, b) => b.t - a.t)
    .slice(0, KEEP_CRASHES);
  return {
    schema: SCHEMA,
    checkedAt: Number.isFinite(raw.checkedAt) ? raw.checkedAt : 0,
    crashes,
    noticed: (Array.isArray(raw.noticed) ? raw.noticed : []).filter((id) => typeof id === "string").slice(-50),
  };
}

/** Более богатая запись побеждает: больше улик, определённое место, названный мод. */
function richness(record) {
  return (
    (record.where && record.where !== "unknown" ? 4 : 0) +
    (record.suspects?.length ? 3 : 0) +
    (record.evidence?.length || 0) +
    (record.process ? 1 : 0)
  );
}

export function createCrashStore({ userData, fsImpl = fs, now = Date.now } = {}) {
  const file = path.join(userData, STORE_FILE);
  let state = empty();
  try {
    state = sanitize(JSON.parse(fsImpl.readFileSync(file, "utf8")));
  } catch {
    // файла нет или он испорчен — начинаем с пустого
  }

  const save = () => {
    try {
      writeFileAtomicSync(file, JSON.stringify(state), { fsImpl, retries: 3 });
    } catch {
      // диск не принял — запись остаётся в памяти до выхода
    }
  };

  return {
    file,
    get checkedAt() {
      return state.checkedAt;
    },
    list: () => state.crashes.map((record) => ({ ...record })),
    get: (id) => state.crashes.find((record) => record.id === id) || null,
    setCheckedAt(ms) {
      state.checkedAt = ms;
      save();
    },
    /** Записывает падение; `isNew` — такого ещё не было (по времени и месту). */
    upsert(record) {
      const same = state.crashes.find((item) => item.where === record.where && Math.abs(item.t - record.t) <= SAME_CRASH_MS)
        || state.crashes.find((item) => item.id === record.id)
        || state.crashes.find((item) => (item.where === "unknown" || record.where === "unknown") && Math.abs(item.t - record.t) <= SAME_CRASH_MS);
      if (same) {
        if (richness(record) > richness(same)) {
          const keptId = same.id;
          Object.assign(same, record, { id: keptId, t: Math.min(same.t, record.t) });
          save();
          return { record: { ...same }, isNew: false, changed: true };
        }
        return { record: { ...same }, isNew: false, changed: false };
      }
      state.crashes = [...state.crashes, record].sort((a, b) => b.t - a.t).slice(0, KEEP_CRASHES);
      save();
      return { record: { ...record }, isNew: true, changed: true };
    },
    /** Падения, которых человеку ещё не показывали (не старше двух суток). */
    unnoticed() {
      const floor = now() - NOTICE_AGE_MS;
      /* Обрыв лаунчера RAGE MP, записанный прошлой версией, всплывать не должен. */
      const ofLauncher = (record) => isRageLauncherAbort({ name: record.process?.name, exception: record.exception, module: record.module?.name });
      return state.crashes.filter((record) => record.t >= floor && !state.noticed.includes(record.id) && !ofLauncher(record)).map((record) => ({ ...record }));
    },
    markNoticed(ids) {
      const known = new Set(state.crashes.map((record) => record.id));
      const fresh = (Array.isArray(ids) ? ids : []).filter((id) => known.has(id) && !state.noticed.includes(id));
      if (!fresh.length) return;
      state.noticed = [...state.noticed, ...fresh].slice(-50);
      save();
    },
    clear() {
      state = { ...empty(), checkedAt: state.checkedAt };
      save();
    },
  };
}
