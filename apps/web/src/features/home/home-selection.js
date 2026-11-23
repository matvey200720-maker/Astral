import { shelfCatalogMods } from "../../catalog-utils.js";
import { modIsNew } from "../catalog/post-order.js";
import { advantageRisk } from "../catalog/recommend.js";

// Подборка Главной (ТЗ 05.10.2026, задачи 10-11): до двадцати модов, сначала новые, порядок
// случаен, но задан номером четырёхчасового окна по UTC. Персонализации нет, сервер ничего
// не хранит.
export const HOME_REFRESH_MS = 4 * 60 * 60 * 1000;
export const HOME_SELECTION_LIMIT = 20;

// Память окна: новый мод посреди окна не сдвигает уже показанную подборку.
const SLOT = "astral.home.selection.v1";

// Нет хранилища, квота, запрет доступа: подборка от этого не портится.
function safely(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// Фишер - Йетс с конца: позиция top от последней до первой кроме нулевой. Из 0 и 1 элемента
// генератор не трогается.
export const shuffled = (list, random) => {
  const deck = [...list];
  let top = deck.length;
  while (top-- > 1) {
    const j = Math.floor((top + 1) * random());
    const held = deck[top];
    deck[top] = deck[j];
    deck[j] = held;
  }
  return deck;
};

export function homeWindow(now = Date.now()) {
  return Math.floor(now / HOME_REFRESH_MS);
}

export const nextHomeRefresh = (now) => HOME_REFRESH_MS * (homeWindow(now) + 1);

// mulberry32: шаг состояния и два одинаковых по форме перемешивания битов. Uint32Array сам
// приводит зерно к беззнаковому 32-битному и складывает по модулю 2^32.
const mix = (x, shift, bit) => Math.imul(x ^ (x >>> shift), x | bit);

export function seededRandom(seed) {
  const cell = new Uint32Array([seed, 0]);
  return () => {
    cell[0] += 0x6d2b79f5;
    const a = mix(cell[0], 15, 1);
    const b = (a + mix(a, 7, 61)) ^ a;
    cell[1] = b ^ (b >>> 14);
    return cell[1] / 4294967296;
  };
}

const indexById = (list) => new Map(Array.from(list, (m) => [m.id, m]));

// Порядок по кодовым единицам строки id нужен лишь повторимости подборки: localeCompare и
// Intl.Collator убраны 30-31.10.2026, на тысячах модов они в разы дороже простого сравнения.
const sortedById = (list) =>
  list
    .map((m) => [String(m.id), m])
    .sort(([a], [b]) => (a < b ? -1 : +(a > b)))
    .map(([, m]) => m);

const buildPool = (mods) => {
  const live = shelfCatalogMods(mods).filter((m) => Boolean(m) && !m.internal);
  const known = indexById(live);
  // Т-78: моды с преимуществом в перестрелке на Главную не попадают (бан на GTA5RP).
  const list = sortedById(live.filter((m) => !advantageRisk(m, known)));
  return { list, byId: indexById(list) };
};

// Кандидаты запоминаются по ссылке на массив каталога (замер при x4: Главная и миниатюра берут одну
// подборку). Каталог заменяют новым массивом, а не правят на месте. Не-массив сюда не доходит:
// shelfCatalogMods бросает TypeError раньше, чем что-то попадёт в кэш.
const memo = new WeakMap();
const poolOf = (mods) => memo.get(mods) ?? memo.set(mods, buildPool(mods)).get(mods);

// «Новое» считается на конец окна, чтобы ответ был один на всё окно: сперва новые, потом остальные.
export function pickHomeSelection(mods = [], opts = {}) {
  const { limit = HOME_SELECTION_LIMIT, now = Date.now() } = opts;
  const { list } = poolOf(mods),
    end = nextHomeRefresh(now),
    draw = seededRandom(homeWindow(now) * 2654435761);
  const fresh = list.filter((m) => modIsNew(m, end)),
    seen = new Set(fresh);
  return shuffled(fresh, draw)
    .concat(shuffled(list.filter((m) => !seen.has(m)), draw))
    .slice(0, limit);
}

export function homeSelection(mods = [], opts = {}) {
  const {
    storage = safely(() => globalThis.localStorage),
    limit = HOME_SELECTION_LIMIT,
    now = Date.now(),
  } = opts;
  const win = homeWindow(now),
    { list, byId } = poolOf(mods);
  const ids = safely(() => {
    const rec = JSON.parse(storage.getItem(SLOT));
    return rec.window === win && Array.isArray(rec.ids) ? rec.ids : [];
  }, []);
  // Память доверенная: все её id должны быть среди кандидатов и их должно хватать.
  const saved = ids.map(byId.get, byId);
  if (saved.length && saved.every(Boolean) && saved.length >= Math.min(limit, list.length)) {
    return saved.slice(0, limit);
  }
  const picks = pickHomeSelection(mods, { limit, now });
  if (picks.length) {
    safely(() => {
      storage.setItem(SLOT, JSON.stringify({ window: win, ids: picks.map((m) => m.id) }));
    });
  }
  return picks;
}

export function bannerOrder(selection = [], opts = {}) {
  const { now = Date.now() } = opts;
  const seed = homeWindow(now) * 40503 + 7;
  return shuffled(selection, seededRandom(seed));
}
