/*
 * Разница двух отпечатков архива.
 *
 * Редукс — это целый `update.rpf` игры, а не набор модов. Список его
 * содержимого ничего не говорит: `common/data/timecycle/timecycle_mods_1.xml`
 * лежит и в чистой игре. Значение имеет только то, чем содержимое отличается
 * от оригинала, поэтому первый шаг разбора — не просмотр, а сравнение.
 *
 * Сравниваются отпечатки, которые строит нативная команда `index-archive`:
 * путь, размер и SHA-256 расшифрованного содержимого каждой записи. Хэш
 * считается по декодированному виду специально — тот же файл, переупакованный
 * другим инструментом, даёт другой сырой поток при одинаковом содержимом, и
 * разница оказалась бы разницей упаковщиков, а не модов.
 */

/** Путь внутри RPF регистронезависим: игра читает его так же. */
const key = (path) =>
  String(path || "")
    .replace(/\\/g, "/")
    .toLowerCase();

function entryMap(index) {
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  const map = new Map();
  for (const entry of entries) {
    if (!entry?.path) continue;
    map.set(key(entry.path), entry);
  }
  return map;
}

function assertIndex(value, side) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries))
    throw new TypeError(`Отпечаток архива (${side}) не прочитан.`);
  if (value.schema !== undefined && value.schema !== 1)
    throw new TypeError(
      `Отпечаток архива (${side}) собран другой версией индексатора: ${value.schema}.`,
    );
}

/**
 * Считает разницу между опорным отпечатком и отпечатком разбираемого архива.
 *
 * Удалённые записи — такая же правка, как добавленные: редукс, который вырезал
 * траву, отличается от чистой игры именно отсутствием файла, и промолчать об
 * этом значило бы потерять половину смысла «оптимизаций».
 */
export function diffArchiveIndex(baseline, candidate) {
  assertIndex(baseline, "опорный");
  assertIndex(candidate, "разбираемый");

  const base = entryMap(baseline);
  const added = [];
  const changed = [];
  let unchanged = 0;
  let addedBytes = 0;
  let changedBytes = 0;

  for (const entry of candidate.entries) {
    if (!entry?.path) continue;
    const previous = base.get(key(entry.path));
    if (!previous) {
      added.push({ path: entry.path, size: entry.size, sha256: entry.sha256 });
      addedBytes += Number(entry.size) || 0;
      continue;
    }
    base.delete(key(entry.path));
    if (previous.sha256 !== entry.sha256) {
      changed.push({
        path: entry.path,
        size: entry.size,
        sha256: entry.sha256,
        previousSize: previous.size,
        previousSha256: previous.sha256,
      });
      changedBytes += Number(entry.size) || 0;
      continue;
    }
    unchanged += 1;
  }

  const removed = [...base.values()].map((entry) => ({
    path: entry.path,
    size: entry.size,
    sha256: entry.sha256,
  }));

  const order = (left, right) => left.path.localeCompare(right.path, "en");
  added.sort(order);
  changed.sort(order);
  removed.sort(order);

  return {
    added,
    changed,
    removed,
    unchanged,
    totals: {
      baseline: baseline.entries.length,
      candidate: candidate.entries.length,
      added: added.length,
      changed: changed.length,
      removed: removed.length,
      unchanged,
      addedBytes,
      changedBytes,
      touchedBytes: addedBytes + changedBytes,
    },
    /* Архив без единой правки — нормальный ответ, а не ошибка: человек мог
       принести чистый файл или базу не от той сборки игры. Решает вызывающий. */
    identical: !added.length && !changed.length && !removed.length,
  };
}

/** Все тронутые записи одним списком — вход классификатора. */
export function touchedEntries(diff) {
  return [
    ...diff.added.map((entry) => ({ ...entry, change: "added" })),
    ...diff.changed.map((entry) => ({ ...entry, change: "changed" })),
    ...diff.removed.map((entry) => ({ ...entry, change: "removed" })),
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
}
