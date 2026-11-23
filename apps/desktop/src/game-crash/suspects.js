/*
 * Какой мод Astral виноват (ТЗ владельца 11.11.2026): имя файла из улики → установленный мод, который этот файл положил.
 *
 * Запись установки движка (`install-state.json`, `targets[].installed[]`) хранит `archiveEntries` — какие записи
 * каких архивов положил мод (`{ target, entry }`, например `update/x64/dlcpacks/astral_places/dlc.rpf` →
 * `astral_arenas.rpf/mj_ma_int3_shell.ydr`) — и `resources` для файлов вне архивов. Сравнение идёт по имени файла без
 * пути, регистр не важен. Файл установлен давно, а мод переустановлен после падения — мод всё равно называется, но с
 * пометкой «позже падения»: уверенности меньше.
 *
 * Файл состояния — десятки мегабайт (до 200+), поэтому разбирается в потоке-работнике (`suspects-worker.js`), как
 * профиль установок для окна (`install-profile-reader.js`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { trackedWorker } from "../worker-census.js";

const WORKER_URL = new URL("./suspects-worker.js", import.meta.url);
export const STATE_FILE = "install-state.json";
/** Файл состояния больше этого размера (300 МБ; бывает 50–215 МБ) не разбирается (память потока): отчёт честно говорит «мод не определён». */
export const MAX_STATE_BYTES = 300 * 1024 * 1024;
const FILES_PER_MOD = 6;
const MODS_LISTED = 40;

const leafOf = (value) => String(value || "").split(/[\\/]/).pop().toLowerCase();

/** Имена файлов из текста улики: `Invalid asset X.ydr`, `X.asi`, `X.dll`. */
export function fileNamesIn(text) {
  const names = new Set();
  for (const match of String(text || "").matchAll(/(?<![\w.-])([\w-]{2,80}\.(?:ydr|yft|ytd|ydd|ymap|ytyp|ybn|ycd|ypt|ynv|awc|gfx|rpf|asi|dll|meta|xml))(?![\w])/gi)) names.add(match[1].toLowerCase());
  return [...names];
}

/**
 * Имена, по которым ищем мод: ассеты из журнала клиента (по ним падает Majestic) и модуль, названный Windows, если он
 * не системный и не сам клиент. Пусто — по уликам файла не назвать.
 */
export function wantedFiles({ majestic, rage, wer } = {}) {
  const wanted = new Set();
  for (const asset of majestic?.assets || []) wanted.add(leafOf(asset.name));
  for (const line of rage?.hitLines || []) for (const name of fileNamesIn(line)) wanted.add(name);
  const module = leafOf(wer?.modulePath || wer?.module);
  if (module && wer && !wer.moduleIsSystem && !/^(?:majestic|ragemp|multiplayer|gta5)/i.test(module)) wanted.add(module);
  return [...wanted].filter(Boolean).slice(0, 12);
}

/**
 * Разбор состояния движка: список установленных модов и совпадения имён. Чистая функция — ей пользуются поток-работник
 * и тесты. `state` — разобранный `install-state.json`; `wanted` — имена файлов (нижний регистр, без путей).
 */
export function indexInstalled(state, wanted = []) {
  const wantedSet = new Set(wanted.map(leafOf));
  const mods = [];
  const seen = new Set();
  const targets = state && typeof state === "object" && state.targets && typeof state.targets === "object" ? Object.values(state.targets) : [];
  for (const target of targets) {
    for (const item of Array.isArray(target?.installed) ? target.installed : []) {
      if (!item?.modId) continue;
      const files = [];
      for (const entry of item.archiveEntries || []) {
        const leaf = leafOf(entry?.entry);
        if (wantedSet.has(leaf)) files.push({ name: leaf, entry: String(entry.entry), target: String(entry.target || "") });
      }
      for (const resource of item.resources || []) {
        const leaf = leafOf(resource);
        if (wantedSet.has(leaf)) files.push({ name: leaf, entry: String(resource), target: "" });
      }
      const record = {
        modId: String(item.modId),
        version: String(item.version || ""),
        installedAt: item.installedAt || null,
        title: String(item.origin?.title || item.title || ""),
        catalogModId: String(item.origin?.catalogModId || ""),
        slots: Array.isArray(item.slots) ? item.slots.map(String).slice(0, 12) : [],
        adapter: String(item.adapter || ""),
        files: files.slice(0, FILES_PER_MOD),
      };
      const key = `${record.modId}@${record.installedAt || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        mods.push(record);
      }
    }
  }
  return { mods, total: mods.length };
}

/**
 * Итог по индексу и времени падения `t` (мс): подозреваемые (мод, положивший названный файл), моды, стоявшие в момент
 * падения, и файлы, которых Astral не ставил (`foreign` — проект или игра, а не мод).
 */
export function resolveSuspects(index, { wanted = [], t = Date.now() } = {}) {
  const mods = index?.mods || [];
  const when = (record) => (record.installedAt ? Date.parse(record.installedAt) : NaN);
  const before = (record) => !Number.isFinite(when(record)) || when(record) <= t + 1000;
  const matched = new Set();
  const suspects = [];
  const wantedSet = new Set(wanted.map(leafOf));
  for (const original of mods) {
    /* Индекс мог быть собран сразу для нескольких падений: у этого падения считаются только его файлы. */
    const record = { ...original, files: original.files.filter((file) => wantedSet.has(file.name)) };
    if (!record.files.length) continue;
    for (const file of record.files) matched.add(file.name);
    suspects.push({
      modId: record.modId,
      catalogModId: record.catalogModId,
      version: record.version,
      title: record.title,
      slots: record.slots,
      installedAt: record.installedAt,
      files: record.files.map((file) => file.name),
      timing: before(record) ? "before" : "after",
    });
  }
  suspects.sort((a, b) => (a.timing === b.timing ? 0 : a.timing === "before" ? -1 : 1));
  /* «Файл не из Astral» — только когда записи установки прочитаны: нет файла состояния или он не разобран — вывода нет. */
  const trusted = !(index?.missing || index?.tooBig || index?.unreadable);
  const foreign = trusted ? wanted.map(leafOf).filter((name) => !matched.has(name)) : [];
  const installed = mods
    .filter(before)
    .sort((a, b) => (Date.parse(b.installedAt) || 0) - (Date.parse(a.installedAt) || 0))
    .slice(0, MODS_LISTED)
    .map(({ modId, catalogModId, version, title, slots, installedAt }) => ({ modId, catalogModId, version, title, slots, installedAt }));
  return { suspects, foreign, installed, installedTotal: mods.filter(before).length };
}

/** Сколько ждём работника: файл состояния разбирается за секунды, дольше — зависание (11.11.2026, замечание приёмки). */
export const WORKER_TIMEOUT_MS = 20 * 1000;
/** Потолок памяти работника: разбор файла в 200–300 МБ занимает около гигабайта; больше — отказ, а не вытеснение остального приложения. */
export const WORKER_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 1536, maxYoungGenerationSizeMb: 64 });

const UNREADABLE = () => ({ mods: [], total: 0, unreadable: true });

/**
 * Чтение индекса в потоке-работнике. Отказ, сбой памяти, выход без ответа и зависание дольше `timeoutMs` — `{ unreadable: true }`:
 * разбор файла на главном потоке не повторяется (JSON до 300 МБ его останавливал, и дважды), а ожидание не бывает вечным.
 * `stateDir` — папка с `install-state.json`; `spawn` подменяется в тестах.
 */
export async function readInstallIndex(stateDir, wanted = [], { workerUrl = WORKER_URL, stat = fs.stat, spawn = trackedWorker, timeoutMs = WORKER_TIMEOUT_MS } = {}) {
  const file = path.join(path.resolve(String(stateDir || "")), STATE_FILE);
  const info = await stat(file).catch(() => null);
  if (!info) return { mods: [], total: 0, missing: true };
  if (info.size > MAX_STATE_BYTES) return { mods: [], total: 0, tooBig: true };
  return new Promise((resolve) => {
    let settled = false;
    let worker = null;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
      void Promise.resolve(worker?.terminate?.()).catch(() => {});
    };
    try {
      worker = spawn("game-crash-suspects", workerUrl, { workerData: { file, wanted }, resourceLimits: WORKER_LIMITS });
    } catch {
      finish(UNREADABLE());
      return;
    }
    timer = setTimeout(() => finish(UNREADABLE()), timeoutMs);
    timer.unref?.();
    worker.once("message", (index) => finish(index && typeof index === "object" ? index : UNREADABLE()));
    worker.once("error", () => finish(UNREADABLE()));
    worker.once("exit", () => finish(UNREADABLE()));
  });
}
