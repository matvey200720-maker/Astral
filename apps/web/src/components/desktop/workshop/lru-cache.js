// При переполнении уходит ровно одна самая давняя запись (24.09.2026): очистка целиком
// выбросила бы и то, что на экране, и следующий шаг ползунка пересчитал бы все плитки.
// Предел читается как есть, без проверки типа; отрицательный предел цикл вытеснения не
// переживает (вытеснять нечего, а размер «больше»), в продукте таких пределов нет.
export const createLruCache = (limit) => {
  const store = new Map();
  // Карта помнит порядок вставки: чтобы запись стала свежей, её кладут заново в конец.
  const touch = (key, value) => (store.delete(key), store.set(key, value), value);
  return {
    get: (key) => (store.has(key) ? touch(key, store.get(key)) : undefined),
    has: store.has.bind(store),
    set: (key, value) => {
      touch(key, value);
      while (limit < store.size) store.delete(store.keys().next().value);
      return value;
    },
    get size() {
      return store.size;
    },
    delete: store.delete.bind(store),
    clear: store.clear.bind(store),
  };
};
