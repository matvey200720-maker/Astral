// Куда направить внимание на странице пака, открытой из карточки: у карточки пака одежды
// выбрана вещь и расцветка, либо поиск нашёл звук отдельного ствола внутри пака звуков.
// Карточка кладёт значение перед переходом, страница читает при открытии и затем забывает.
// Значение - { item?, look?, sound? }.

// Хранилище на Map, а не на объекте: имена вроде "constructor" не должны задевать обычные свойства.
function createFocusStore() {
  const entries = new Map();
  return {
    // Пустой id или пустое значение - ничего не происходит, прежняя запись не стирается.
    // Значение хранится по ссылке и заменяет прежнее целиком.
    put(modId, value) {
      if (Boolean(modId) && Boolean(value)) entries.set(modId, value);
    },
    // Чтение ничего не забывает: страница в строгом режиме разработки монтируется дважды,
    // и обе попытки должны увидеть запись. Забывает только drop.
    peek: (modId) => entries.get(modId) ?? null,
    drop(modId) {
      entries.delete(modId);
    },
  };
}

const store = createFocusStore();

export const rememberPackFocus = (modId, value) => store.put(modId, value);
export const readPackFocus = (modId) => store.peek(modId);
export const clearPackFocus = (modId) => store.drop(modId);
