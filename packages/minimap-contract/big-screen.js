/*
 * Индикатор HP на увеличенном (развёрнутом) радаре (владелец, 21.11.2026: «отдельные настройки для увеличенного радара»).
 *
 * В обычной мини-карте элементы HP и брони стоят там, где их поставили в `layout.widgets` (доли радара, а при «HP отдельно от карты» ещё и по экрану). На развёрнутом
 * радаре человек хочет поставить их иначе — этот файл хранит такие места: поле проекта `layout.bigScreen = { places: { <элемент>: { x, y } } }`.
 *
 *   — `x` и `y` — центр элемента в долях ЭКРАНА игры (0…1, три знака), а не радара: развёрнутый радар стоит по-своему, и человек думает «правее середины экрана».
 *   — Элемент без записи стоит там же, где в обычной мини-карте; пустое поле — «как в стандартной» (так и пишется по умолчанию, и так читается проект без поля).
 *   — Мусор (чужие ключи, не-числа, пустые строки, записи без второй координаты) отбрасывается, числа зажимаются в 0…1.
 *
 * Здесь только данные: окно ставит элементы по этим местам в кадре «Экран» (предпросмотр «Увеличенная»), сборка игры эти места пока не читает.
 */

/** Элементы, у которых есть своё место на увеличенном радаре: значки, цифры и полосы HP и брони. */
export const MINIMAP_BIG_SCREEN_IDS = Object.freeze([
  "healthIcon",
  "armorIcon",
  "healthNumber",
  "armorNumber",
  "healthBar",
  "armorBar",
]);

/** Мест нет: увеличенный радар повторяет обычную мини-карту. */
export const DEFAULT_MINIMAP_BIG_SCREEN = Object.freeze({
  places: Object.freeze({}),
});

/** Знаков после запятой у доли экрана. */
const DIGITS = 1000;

/** Доля экрана: число или строка с числом, зажатое в 0…1 и округлённое до трёх знаков. Всё остальное (в том числе `null`, `""`, `true`) — `null`. */
function fraction(value) {
  let number = null;
  if (typeof value === "number") number = value;
  else if (typeof value === "string" && value.trim() !== "")
    number = Number(value);
  if (number === null || !Number.isFinite(number)) return null;
  return Math.round(Math.min(1, Math.max(0, number)) * DIGITS) / DIGITS;
}

/**
 * Блок `layout.bigScreen` проекта. Без поля, с мусором вместо него и с пустыми местами выходит `{ places: {} }`.
 * Идемпотентна: повторная нормализация даёт то же.
 * @param {unknown} [input]
 * @returns {{ places: Record<string, { x: number, y: number }> }}
 */
export function normalizeMinimapBigScreen(input) {
  const source = input && typeof input === "object" ? input : {};
  const stored =
    source.places && typeof source.places === "object" ? source.places : {};
  const places = {};
  for (const id of MINIMAP_BIG_SCREEN_IDS) {
    const entry = stored[id];
    if (!entry || typeof entry !== "object") continue;
    const x = fraction(entry.x);
    const y = fraction(entry.y);
    if (x === null || y === null) continue;
    places[id] = { x, y };
  }
  return { places };
}

/**
 * Место элемента на увеличенном радаре: `{ x, y }` в долях экрана или `null`, если человек его не ставил (тогда элемент стоит как в обычной мини-карте).
 * @param {unknown} bigScreen блок `layout.bigScreen` (можно сырой)
 * @param {string} id
 */
export function minimapBigScreenPlace(bigScreen, id) {
  if (!MINIMAP_BIG_SCREEN_IDS.includes(id)) return null;
  const place = normalizeMinimapBigScreen(bigScreen).places[id];
  return place ? { x: place.x, y: place.y } : null;
}

/** Есть ли хоть одно своё место на увеличенном радаре. */
export const minimapBigScreenActive = (bigScreen) =>
  Object.keys(normalizeMinimapBigScreen(bigScreen).places).length > 0;

/**
 * Блок `layout.bigScreen` с местом `place` (`{ x, y }`, доли экрана) у элемента `id`; остальные места те же. Место без чисел или чужой элемент — блок без изменений.
 * `place: null` убирает место элемента: он снова стоит как в обычной мини-карте.
 */
export function minimapBigScreenWithPlace(bigScreen, id, place) {
  const current = normalizeMinimapBigScreen(bigScreen);
  if (!MINIMAP_BIG_SCREEN_IDS.includes(id)) return current;
  const places = { ...current.places };
  if (place === null) delete places[id];
  else {
    const x = fraction(place?.x);
    const y = fraction(place?.y);
    if (x === null || y === null) return current;
    places[id] = { x, y };
  }
  return normalizeMinimapBigScreen({ places });
}
