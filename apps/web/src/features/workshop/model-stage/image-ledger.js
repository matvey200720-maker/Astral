/*
 * Учёт живых картинок листов (17.11.2026, «Astral быстрее», вопрос замерщика: кто держит 545 МБ картинок при пределе кэша 256 МБ — достижимые они или просто ещё не собраны).
 *
 * Работает только с журналом меток (`stage-marks.js`: массив заводит стенд до загрузки страницы или опыт `marks` при создании кадра). Нет журнала — ни один вызов отсюда не делается:
 * места, где `scene-textures.js` и `orbit-stage.js` зовут учёт, закрыты проверкой `stageMarksOn()` (чтение одного свойства), модуль не создаёт ни `WeakRef`, ни `FinalizationRegistry`,
 * не вешает `window.__astralImageLedger`. Включённый учёт кэш листов не меняет: картинки он держит только слабо (`WeakRef`), собранные не оживляет.
 *
 * Что записывается. Каждый лист, что `loadSceneImage` (и `loadSceneSheet`) отдал вызывающему, — одна запись: ключ кэша окна, откуда взят (`reader` — читатель игры, `file` — файл поставки, `own` — свой источник
 * съёмщика частей), размер (ширина × высота × 4 — байты RGBA), слабая ссылка на картинку и на обещание кэша. Блоки BCn (за выключателем сжатых листов) — запись вида `bcn`, байты — сумма уровней.
 * Кто просил: каждый вызов `loadSceneImage` кладёт имя вызывающего (кадр сцены — `frame`, прочие — первая строка стека над вызовом: чанк и позиция, у закрытой сборки имя функции нечитаемо, но чанк и позиция
 * узнаются) по ключу листа; картинка получает всех, кто просил её ключ.
 *
 * `window.__astralImageLedger({ gc })` — снимок. `gc: true` зовёт `globalThis.gc()` до чтения, если окно запущено с `--expose-gc`; иначе перед вызовом собрать мусор снаружи
 * (`HeapProfiler.collectGarbage`), тогда «живы» = достижимы. Без сборки «живы» = достижимы или ещё не собраны, и отличить их нельзя — это и есть вопрос замерщика.
 *
 * Держатели (кто из окна ещё ссылается на картинку): кэш окна `images` (по обещанию, ключ → то же обещание), текстуры кадра (`texture.image`), замены (`sheet-standin.js`). Всё остальное — `unheld`:
 * на листе нет известного держателя; после сборки мусора это держат чужие потребители (имена — в `byCaller`), до неё — к тому же и мусор.
 */

import { stageMarksOn } from "./stage-marks.js";

/** Состояние создаётся при первой записи; до неё и без журнала меток его нет. */
let state = null;

function ensure() {
  if (state) return state;
  state = {
    seq: 0,
    born: performance.now(),
    entries: new Map(),
    byObject: new WeakMap(),
    callers: new Map(),
    holders: new Map(),
    holderSeq: 0,
    cache: null,
    created: { count: 0, bytes: 0, image: 0, bcn: 0 },
    finalized: { count: 0, bytes: 0 },
    finalizedLog: [],
    registry:
      typeof FinalizationRegistry === "function"
        ? new FinalizationRegistry((id) => {
            const record = state?.entries.get(id);
            if (!record) return;
            state.entries.delete(id);
            state.finalized.count += 1;
            state.finalized.bytes += record.bytes;
            state.finalizedLog.push({ at: Math.round(performance.now()), key: record.key, bytes: record.bytes });
            if (state.finalizedLog.length > 200) state.finalizedLog.shift();
          })
        : null,
  };
  globalThis.__astralImageLedger = ledgerSnapshot;
  return state;
}

/** Первая строка стека над вызовом `from`: «имя чанк:строка:столбец». Нет `captureStackTrace` — `other`. */
function callerOf(from) {
  try {
    if (typeof Error.captureStackTrace !== "function") return "other";
    const holder = {};
    Error.captureStackTrace(holder, from);
    const line = String(holder.stack || "")
      .split("\n")
      .find((item) => /^\s*at\s/.test(item));
    if (!line) return "other";
    const match = /^\s*at\s+(?:(.+?)\s+\()?(?:.*[\\/])?([^\\/():\s]+:\d+:\d+)\)?\s*$/.exec(line);
    return match ? `${match[1] ? `${match[1]} ` : ""}${match[2]}` : line.trim().slice(0, 120);
  } catch {
    return "other";
  }
}

/** Кто-то просит лист `key`. `via` — известный вызывающий (`frame`); пусто — читается стек над `from`. */
export function noteImageCall(key, via, from) {
  const ledger = ensure();
  const label = via || callerOf(from);
  let per = ledger.callers.get(key);
  if (!per) ledger.callers.set(key, (per = new Map()));
  per.set(label, (per.get(label) || 0) + 1);
}

const bcnBytes = (levels) => (Array.isArray(levels) ? levels.reduce((sum, level) => sum + (level?.data?.length || 0), 0) : 0);

/**
 * Лист получен: `target` — ImageBitmap (`kind: "image"`) или массив уровней блоков (`kind: "bcn"`). `promise` — обещание кэша, что его принесло; `cache` — вид кэша окна
 * (функция, что отдаёт `{ entries, sized, accounted, budget, holds(key, promise) }`), она нужна снимку.
 */
export function noteImageLoaded(key, target, kind, origin, promise, cache) {
  const ledger = ensure();
  ledger.cache = cache;
  if (!target || typeof target !== "object" || ledger.byObject.has(target)) return;
  const width = kind === "bcn" ? target[0]?.width || 0 : target.width || 0;
  const height = kind === "bcn" ? target[0]?.height || 0 : target.height || 0;
  const bytes = kind === "bcn" ? bcnBytes(target) : Math.max(1, width * height * 4);
  const record = {
    id: (ledger.seq += 1),
    key,
    kind,
    origin,
    at: performance.now(),
    width,
    height,
    bytes,
    ref: typeof WeakRef === "function" ? new WeakRef(target) : null,
    promise: typeof WeakRef === "function" && promise ? new WeakRef(promise) : null,
  };
  ledger.entries.set(record.id, record);
  ledger.byObject.set(target, record);
  ledger.registry?.register(target, record.id);
  ledger.created.count += 1;
  ledger.created.bytes += bytes;
  ledger.created[kind] += 1;
}

/**
 * Кадр (или другой держатель) называет, какие картинки у него в руках: `lists` — `{ имя: () => массив объектов }`. Возвращает «снять».
 * Вызывается только при журнале меток; список читается лишь при снимке.
 */
export function registerImageHolders(lists) {
  const ledger = ensure();
  const id = (ledger.holderSeq += 1);
  ledger.holders.set(id, lists);
  return () => {
    state?.holders.delete(id);
  };
}

/** Картинки и уровни блоков из списка текстур three (`texture.image`, `texture.mipmaps`) — то, чем текстура кадра ссылается на лист. */
export function imagesOfTextures(textures) {
  const out = [];
  for (const texture of textures) {
    if (texture?.image) out.push(texture.image);
    if (texture?.mipmaps) out.push(texture.mipmaps);
  }
  return out;
}

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const total = () => ({ count: 0, bytes: 0, mb: 0 });
function add(group, bytes) {
  group.count += 1;
  group.bytes += bytes;
  group.mb = mb(group.bytes);
}

/** Снимок учёта. Обычный объект: числа, имена, короткие списки — можно отдавать стенду через `evaluate`. */
export function ledgerSnapshot({ gc = false } = {}) {
  const ledger = state;
  if (!ledger) return null;
  let gcState = "skipped";
  if (gc) {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
      gcState = "called";
    } else gcState = "absent";
  }
  const now = performance.now();
  const view = typeof ledger.cache === "function" ? ledger.cache() : null;
  const marks = new Map();
  for (const lists of ledger.holders.values()) {
    for (const [name, list] of Object.entries(lists)) {
      let objects = [];
      try {
        objects = list() || [];
      } catch {
        objects = [];
      }
      for (const object of objects) {
        const record = object && typeof object === "object" ? ledger.byObject.get(object) : null;
        if (!record) continue;
        let names = marks.get(record.id);
        if (!names) marks.set(record.id, (names = new Set()));
        names.add(name);
      }
    }
  }
  const alive = total();
  const closed = { count: 0 };
  const holders = { cache: total(), frame: total(), standIn: total() };
  const unheld = total();
  const byKind = { image: total(), bcn: total() };
  const byOrigin = {};
  const byCaller = {};
  const unheldList = [];
  let pendingFinalize = 0;
  let pendingBytes = 0;
  for (const record of ledger.entries.values()) {
    const target = record.ref ? record.ref.deref() : undefined;
    if (!target) {
      pendingFinalize += 1;
      pendingBytes += record.bytes;
      continue;
    }
    if (record.kind === "image" && target.width === 0 && target.height === 0) {
      closed.count += 1;
      continue;
    }
    add(alive, record.bytes);
    add(byKind[record.kind], record.bytes);
    add((byOrigin[record.origin] ||= total()), record.bytes);
    const names = marks.get(record.id) || new Set();
    const inCache = Boolean(view?.holds && record.promise && view.holds(record.key, record.promise.deref()));
    if (inCache) {
      names.add("cache");
      add(holders.cache, record.bytes);
    }
    if (names.has("frame")) add(holders.frame, record.bytes);
    if (names.has("standIn")) add(holders.standIn, record.bytes);
    const held = names.size > 0;
    if (!held) {
      add(unheld, record.bytes);
      if (unheldList.length < 400) unheldList.push(record);
    }
    for (const label of ledger.callers.get(record.key)?.keys() || []) {
      const row = (byCaller[label] ||= { calls: 0, alive: 0, bytes: 0, unheld: 0, unheldBytes: 0 });
      row.alive += 1;
      row.bytes += record.bytes;
      if (!held) {
        row.unheld += 1;
        row.unheldBytes += record.bytes;
      }
    }
  }
  for (const per of ledger.callers.values()) {
    for (const [label, calls] of per) {
      const row = (byCaller[label] ||= { calls: 0, alive: 0, bytes: 0, unheld: 0, unheldBytes: 0 });
      row.calls += calls;
    }
  }
  const waiting = { count: pendingFinalize, bytes: pendingBytes, mb: mb(pendingBytes) };
  const collected = { count: ledger.finalized.count + pendingFinalize, bytes: ledger.finalized.bytes + pendingBytes, mb: mb(ledger.finalized.bytes + pendingBytes) };
  unheldList.sort((left, right) => right.bytes - left.bytes);
  return {
    atMs: Math.round(now),
    sinceMs: Math.round(now - ledger.born),
    gc: gcState,
    created: { ...ledger.created, mb: mb(ledger.created.bytes) },
    /* Объект ещё есть (слабая ссылка отвечает), память не освобождена (`close()` не звали). До сборки мусора сюда входят и недостижимые, но не собранные. */
    alive,
    closed,
    collected,
    /* Собрано, но обратный вызов реестра ещё не пришёл (обычно следующий такт). */
    collectedPending: waiting,
    byKind,
    byOrigin,
    cache: view
      ? { entries: view.entries, sized: view.sized, accountedBytes: view.accounted, accountedMb: mb(view.accounted), budgetBytes: view.budget, budgetMb: mb(view.budget) }
      : null,
    /* Кто из известных держателей ссылается на живой лист (держатели пересекаются: лист в кэше может стоять и на текстуре кадра). */
    holders,
    unheld,
    byCaller,
    unheldTop: unheldList.slice(0, 20).map((record) => ({ key: record.key, kind: record.kind, origin: record.origin, bytes: record.bytes, ageMs: Math.round(now - record.at), callers: [...(ledger.callers.get(record.key)?.keys() || [])] })),
    collectedLog: ledger.finalizedLog.slice(-20),
  };
}

/** Для тестов: забыть всё, как при свежей загрузке страницы. */
export function resetImageLedger() {
  state = null;
  delete globalThis.__astralImageLedger;
}

/** Учёт включён (журнал меток есть)? Зовут места, что собираются что-то записать. */
export const imageLedgerOn = () => stageMarksOn();
