// Счётчики нужны только стенду замеров (editor-cpu.mjs --counts, 19.10.2026): вне стенда
// каждый вызов — один поиск свойства, без разбора и записи. Объект стенда читается заново
// при каждом вызове, поэтому подмена стендом обнуляет счёт. Округление идёт на каждом
// прибавлении, а не при выводе: доли меньше 0.005 мс не копятся.
const bump = (name, ms) => {
  const book = globalThis.__astralCounts;
  const row = book && (book[name] || (book[name] = { n: 0, ms: 0 }));
  if (row) {
    row.n++;
    row.ms = Math.round(100 * (ms + row.ms)) / 100;
  }
  return row;
};

// Начало замера: функция окончания или ничего, если счётчиков нет (тогда и часы не читаются).
const start = (name) => {
  if (!globalThis.__astralCounts) return;
  const t0 = performance.now();
  return () => bump(name, performance.now() - t0);
};

export const perfCount = (name) => {
  bump(name, 0);
};

export const perfValue = (name, value) => {
  const row = bump(name, 0);
  if (row) row.max = Math.max(value, row.max || 0);
};

export const perfTimed = (name, run) => {
  const end = start(name);
  try {
    return run();
  } finally {
    end?.();
  }
};

export const perfTimedAsync = (name, run) => {
  const end = start(name);
  return end ? run().finally(end) : run();
};
