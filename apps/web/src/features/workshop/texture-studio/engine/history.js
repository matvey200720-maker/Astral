/*
 * История студии (ТЗ 18.10.2026, Session 1, задача 6): до 60 шагов, бюджет
 * памяти, склейка одинаковых правок, переход по любому шагу («Щелчок по шагу
 * возвращает к нему»). Чистая бухгалтерия — шаг не знает, как откатить
 * пиксели: он несёт данные (`patches` до и после, документ после), а
 * `apply(entry, "undo" | "redo")` вызывающего их применяет.
 *
 * Шаг: `{ id, label, doc, patches, bytes, mergeKey?, at }`:
 *   doc      — документ ПОСЛЕ шага (структура слоёв; лёгкий JSON);
 *   patches  — `[{ layer, x, y, width, height, before, after }]`: куски
 *              пикселей слоя до и после (одна кисть — один кусок, а не весь
 *              холст в 41 МБ); `before`/`after` — `Uint8ClampedArray` RGBA;
 *   bytes    — сколько памяти занимает шаг (пиксели патчей, считает сам);
 *   mergeKey — одинаковая правка подряд (ползунок коррекции, перетаскивание
 *              картинки) склеивается: остаются первые `before` и последние
 *              `after`.
 * Исходное состояние — шаг `0` («Открыто»): он без патчей, документ — тот,
 * с которым студию открыли.
 */

export const HISTORY_LIMIT = 60;
/** Бюджет пикселей истории, байт: больше — старые шаги уходят, как и за лимитом. */
export const HISTORY_BUDGET = 640 * 1024 * 1024;
/** Одинаковые правки склеиваются, если между ними прошло не больше (мс). */
export const MERGE_WINDOW_MS = 1500;

/** Сколько байт занимают патчи шага. */
export const patchBytes = (patches) => (patches || []).reduce((sum, patch) => sum + (patch.before?.byteLength || 0) + (patch.after?.byteLength || 0), 0);

/**
 * История: `entries[0]` — «Открыто», `index` — текущий шаг. Методы возвращают
 * новую историю (неизменяемая): состояние держит хук студии.
 */
export function createHistory(doc, { limit = HISTORY_LIMIT, budget = HISTORY_BUDGET, now = () => Date.now() } = {}) {
  return { limit, budget, now, index: 0, serial: 1, entries: [{ id: 0, label: "Открыто", doc, patches: [], bytes: 0, at: now() }] };
}

const totalBytes = (entries) => entries.reduce((sum, entry) => sum + entry.bytes, 0);

/* Обрезка: лишнее с начала — но шаг «Открыто» остаётся первым, поэтому старейший уходящий шаг становится новым началом (его doc — основа). */
function trim(history) {
  let { entries, index } = history;
  while (entries.length > history.limit + 1 || (entries.length > 2 && totalBytes(entries) > history.budget)) {
    /* Первый шаг после начала уходит, а начало получает его документ: откатить «за» него уже нельзя. */
    const [open, next, ...rest] = entries;
    entries = [{ ...open, doc: next.doc, label: open.label }, ...rest];
    index = Math.max(0, index - 1);
  }
  return { ...history, entries, index };
}

/**
 * Новый шаг после текущего (шаги «после» отбрасываются). `mergeKey` — склейка с
 * предыдущим шагом, если тот того же ключа и свежий.
 */
export function pushEntry(history, { label, doc, patches = [], mergeKey = null }) {
  const at = history.now();
  const last = history.entries[history.index];
  const bytes = patchBytes(patches);
  if (mergeKey && history.index > 0 && last.mergeKey === mergeKey && at - last.at <= MERGE_WINDOW_MS) {
    /* Склейка: первые `before`, последние `after` по каждому куску; куски новых мест — добавляются. */
    const merged = mergePatches(last.patches, patches);
    const entry = { ...last, label, doc, patches: merged, bytes: patchBytes(merged), at };
    const entries = [...history.entries.slice(0, history.index), entry];
    return trim({ ...history, entries });
  }
  const entry = { id: history.serial, label, doc, patches, bytes, mergeKey, at };
  const entries = [...history.entries.slice(0, history.index + 1), entry];
  return trim({ ...history, entries, index: entries.length - 1, serial: history.serial + 1 });
}

/* Два набора кусков одного слоя: где место то же — `before` первого и `after` второго. Иначе — оба куска остаются, второй после первого. */
function mergePatches(first, second) {
  const out = [...first];
  for (const patch of second) {
    const same = out.findIndex((item) => item.layer === patch.layer && item.x === patch.x && item.y === patch.y && item.width === patch.width && item.height === patch.height);
    if (same >= 0) out[same] = { ...out[same], after: patch.after };
    else out.push(patch);
  }
  return out;
}

export const canUndo = (history) => history.index > 0;
export const canRedo = (history) => history.index < history.entries.length - 1;
export const currentEntry = (history) => history.entries[history.index];

/**
 * Один шаг назад: `{ history, steps }`, где `steps` — что применить по порядку
 * (`[{ entry, direction }]`). Нечего откатывать — `steps` пуст.
 */
export function undoStep(history) {
  if (!canUndo(history)) return { history, steps: [] };
  return { history: { ...history, index: history.index - 1 }, steps: [{ entry: history.entries[history.index], direction: "undo" }] };
}

export function redoStep(history) {
  if (!canRedo(history)) return { history, steps: [] };
  return { history: { ...history, index: history.index + 1 }, steps: [{ entry: history.entries[history.index + 1], direction: "redo" }] };
}

/**
 * Перейти к шагу `target`: назад — откаты шагов от текущего вниз, вперёд —
 * повторы вверх. Порядок применения — как у настоящих шагов.
 */
export function jumpTo(history, target) {
  const to = Math.min(history.entries.length - 1, Math.max(0, target));
  if (to === history.index) return { history, steps: [] };
  const steps = [];
  if (to < history.index) for (let at = history.index; at > to; at -= 1) steps.push({ entry: history.entries[at], direction: "undo" });
  else for (let at = history.index + 1; at <= to; at += 1) steps.push({ entry: history.entries[at], direction: "redo" });
  return { history: { ...history, index: to }, steps };
}

/** Документ текущего шага. */
export const historyDocument = (history) => history.entries[history.index].doc;

/** Применить кусок пикселей к слою: `target` — `{ data, width, height }` пикселей слоя, `direction` — `undo` берёт `before`, `redo` — `after`. */
export function applyPatch(target, patch, direction) {
  const source = direction === "undo" ? patch.before : patch.after;
  if (!source) return;
  for (let row = 0; row < patch.height; row += 1) {
    const y = patch.y + row;
    if (y < 0 || y >= target.height) continue;
    const from = row * patch.width * 4;
    const x0 = Math.max(0, patch.x);
    const x1 = Math.min(target.width, patch.x + patch.width);
    if (x1 <= x0) continue;
    const skip = (x0 - patch.x) * 4;
    target.data.set(source.subarray(from + skip, from + skip + (x1 - x0) * 4), (y * target.width + x0) * 4);
  }
}

/** Прямоугольник, охватывающий два (для «грязной» области). */
export function unionRect(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
