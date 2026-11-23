/*
 * Готовые персонажи режима «одеть» (blob-адреса GLB) живут между слотами, пока открыто окно: слот переключают — мастерская собирается заново, а персонаж берётся из памяти, а не из Desktop.
 * Ключ — состав надетого и облик (`characterCacheKey`); сверх предела старейший отзывается.
 */
export const DRESS_URLS = new Map();
export const DRESS_LIMIT = 8;

/*
 * Персонажи, собранные не целиком (03.11.2026): вещь каталога не встала — пакет не выдали (облако отказало, предел ссылок) или Desktop не разобрал его. Такой персонаж показывается, но
 * «навсегда» не запоминается: прежде он лежал в памяти до закрытия окна под ключом с этой вещью, и вещь больше не появлялась, сколько её ни выбирай. Ключи — те же, что у кэшей персонажей.
 */
export const INCOMPLETE_CHARACTERS = new Set();

/** Готовый персонаж по ключу; собранный не целиком забывается (адрес отзывается) — следующий запрос собирает его заново. */
export function keptCharacter(cache, key) {
  if (!cache.has(key)) return null;
  if (!INCOMPLETE_CHARACTERS.has(key)) return cache.get(key);
  const stale = cache.get(key);
  cache.delete(key);
  INCOMPLETE_CHARACTERS.delete(key);
  void stale.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  return null;
}

/** Забыть всех готовых персонажей (тесты; смена папки игры). */
export function forgetDressCharacters() {
  for (const pending of DRESS_URLS.values()) void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  DRESS_URLS.clear();
  INCOMPLETE_CHARACTERS.clear();
}
