/*
 * Ленивая загрузка модуля читателя (18.11.2026): `lazyModule(() => import("./x.js"))` отдаёт функцию, что при первом вызове грузит модуль, а потом возвращает его же. Одновременные первые вызовы
 * ждут один `import()`; удачная загрузка запоминается, неудачная — нет: следующий вызов пробует снова (отказ загрузки — отказ вызова, а не вечный отказ потока).
 */
export function lazyModule(load) {
  let pending = null;
  return () => {
    if (pending) return pending;
    const attempt = (async () => load())();
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
    return attempt;
  };
}
