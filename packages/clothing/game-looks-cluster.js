/*
 * Сверка одинаковых вещей игры — для скрипта, что строит таблицу (`scripts/clothing-looks.mjs`); что считается «одной вещью» и зачем — в `game-looks.js`. Окну это не нужно: оно читает готовую
 * таблицу, а здесь тяжёлое (сетки картинок), поэтому отдельно.
 *
 * Чистый JS: описи содержимого приходят готовыми (хеши геометрии, пикселей, подписи сеток), файлов игры здесь нет.
 */

import { gridDifference } from "./colour-dedupe.js";
import { hammingHex } from "./fingerprint.js";
import { FORM_COMPONENTS } from "./game-looks.js";

/*
 * Допуск «та же картинка» между расцветками разных паков: средняя разница по каналам из 255 и доля клеток с заметной разницей. Строже, чем «пересжатие» каталога (1,5): та же перчатка в
 * Рождестве 3 и в Байкерах отличается на 1,6–1,7, а соседняя перчатка Лета — на 4,3 и 2% клеток; между ними и порог.
 */
export const LOOK_MEAN = 2.5;
export const LOOK_SHARE = 0.004;

/* Сетки одного набора — десятки мегабайт: держатся немногие, остальные читаются заново. */
const MAX_GRIDS = 24;
/* Отсев перед сравнением сеток: хеш картинки первой расцветки (расстояние Хэмминга) и её тон (средний цвет и четверти) — дальше сравниваются только близкие. */
const NEAR_HASH = 6;
const NEAR_TONE = 8;

/* «Почти та же форма» — та же вещь, выпущенная ещё раз (причёска в заплатке, рюкзак в другом паке): те же куски и шейдеры, вершин поровну с точностью до процента, габарит до 5 мм. */
export const NEAR_VERTS = 0.01;
export const NEAR_SIZE = 0.005;

const FORMS = new Set(FORM_COMPONENTS);

/** Одна ли форма «на глаз»: геометрия совпала точно или те же куски, число вершин и габарит почти те же. */
export function sameShape(left, right) {
  if (left.geo === right.geo) return true;
  if (!left.parts || left.parts !== right.parts || !left.dims || !right.dims) return false;
  const top = Math.max(left.verts, right.verts);
  return Math.abs(left.verts - right.verts) <= Math.max(3, top * NEAR_VERTS) && left.dims.every((size, at) => Math.abs(size - right.dims[at]) <= NEAR_SIZE);
}

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");

const grouped = (list, keyOf) => {
  const groups = new Map();
  for (const entry of list) {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
};

/**
 * Одинаковы ли расцветки на вид: столько же цветов, и каждый цвет — та же картинка (`gridDifference` по сеткам `textureGrid`). `left`, `right` — `[{ width, height, grid }]` по цветам
 * в порядке букв.
 */
export function sameLookColours(left, right, { mean = LOOK_MEAN, share = LOOK_SHARE } = {}) {
  if (!left?.length || left.length !== right?.length) return false;
  return left.every((a, index) => {
    const b = right[index];
    if (!a?.grid || !b?.grid) return false;
    if (Math.abs(a.width / a.height - b.width / b.height) >= 0.01) return false;
    const difference = gridDifference(a.grid, b.grid, "same");
    return difference.mean <= mean && difference.share <= share;
  });
}

/* Группа — «лицо» первым (самая полная модель, при равенстве — меньший номер), остальные по месту: порядок не зависит от порядка входа. */
const ordered = (list) =>
  [...list]
    .sort((left, right) => (right.verts || 0) - (left.verts || 0) || left.drawable - right.drawable || (left.place < right.place ? -1 : 1))
    .map((entry) => entry.place);

/* У одной геометрии — по имени: игра, назвавшая вещи по-разному, их различает. Без имени присоединяется к единственному названному набору. */
function splitByName(list, stats) {
  const named = grouped(
    list.filter((entry) => entry.name),
    (entry) => fold(entry.name),
  );
  const bare = list.filter((entry) => !entry.name);
  if (!named.size) return [bare];
  if (named.size === 1) return [[...[...named.values()][0], ...bare]];
  /* Тот же вид и те же расцветки, а игра назвала по-разному: в магазине разные, на плитке одинаковые. */
  if (stats) stats.sameLookOtherName = (stats.sameLookOtherName || 0) + named.size - 1;
  return [...named.values(), ...(bare.length > 1 ? [bare] : [])];
}

/**
 * Группы одинаковых вещей по описи содержимого.
 *
 * `entries` — `[{ place, gender, component, drawable, name, verts, geo, parts, dims, pix, pre, grids }]`: `geo` — хеш содержимого модели, `parts` — её куски с шейдерами строкой, `dims` — габарит по осям, `pix` — хеши пикселей расцветок по буквам (точное совпадение),
 * `pre` — дешёвая подпись первой расцветки `{ hash, tone }` (отсев перед сравнением сеток), `grids` — `() => Promise<[{ width, height, grid }]>`, сетки всех расцветок (читаются, только если дело
 * дошло до сравнения). `options.stats` копит, чего НЕ слито: `sameTexturesOtherShape` — те же расцветки, другая форма (общий лист причёсок, другой крой), `sameLookOtherName` — то же содержимое, другие имена в игре.
 * Возвращает `[{ kind: "same" | "forms", members: [place, …] }]`, в группе минимум два места, первое — «лицо».
 */
export async function clusterLooks(entries, options = {}) {
  const out = [];
  for (const list of grouped(entries, (entry) => `${entry.gender}|${entry.component}|${entry.pix.length}`).values()) {
    /* 1. Те же пиксели всех расцветок — один набор текстур. */
    const sets = [...grouped(list, (entry) => entry.pix.join("+")).values()];
    /* 2. Наборы, что на вид те же при другом кодировании: отсев по подписи, потом сетки. */
    const root = sets.map((_, index) => index);
    const find = (index) => {
      while (root[index] !== index) index = root[index] = root[root[index]];
      return index;
    };
    const near = (a, b) => {
      const left = a[0].pre;
      const right = b[0].pre;
      return Boolean(left && right && hammingHex(left.hash, right.hash) <= NEAR_HASH && left.tone.every((value, at) => Math.abs(value - right.tone[at]) <= NEAR_TONE));
    };
    const gridsOf = new Map();
    const load = async (index) => {
      if (!gridsOf.has(index)) {
        if (gridsOf.size >= MAX_GRIDS) gridsOf.delete(gridsOf.keys().next().value);
        gridsOf.set(index, await sets[index][0].grids());
      }
      return gridsOf.get(index);
    };
    for (let i = 0; i < sets.length; i += 1)
      for (let j = i + 1; j < sets.length; j += 1) {
        if (find(i) === find(j) || !near(sets[i], sets[j])) continue;
        if (sameLookColours(await load(i), await load(j), options)) root[find(j)] = find(i);
      }
    const textureSets = [...grouped(sets.map((set, index) => ({ set, index })), (entry) => find(entry.index)).values()].map((parts) => parts.flatMap((part) => part.set));
    for (const set of textureSets) {
      if (set.length < 2) continue;
      if (FORMS.has(set[0].component)) {
        out.push({ kind: "forms", members: ordered(set) });
        continue;
      }
      /* Не торсовый вид: та же форма (геометрия точно или «почти», те же куски и шейдеры) — та же вещь; другая — другая вещь с теми же текстурами (общий лист причёсок). */
      const shapeRoot = set.map((_, index) => index);
      const shapeOf = (index) => {
        while (shapeRoot[index] !== index) index = shapeRoot[index] = shapeRoot[shapeRoot[index]];
        return index;
      };
      for (let i = 0; i < set.length; i += 1)
        for (let j = i + 1; j < set.length; j += 1) if (shapeOf(i) !== shapeOf(j) && sameShape(set[i], set[j])) shapeRoot[shapeOf(j)] = shapeOf(i);
      const shapes = [...grouped(set.map((entry, index) => ({ entry, index })), (item) => shapeOf(item.index)).values()];
      if (options.stats && shapes.length > 1) options.stats.sameTexturesOtherShape = (options.stats.sameTexturesOtherShape || 0) + shapes.length - 1;
      for (const same of shapes)
        for (const part of splitByName(same.map((item) => item.entry), options.stats)) if (part.length > 1) out.push({ kind: "same", members: ordered(part) });
    }
  }
  return out;
}

/**
 * Все пары наборов расцветок с разной точной картинкой в одном виде, поле и числе расцветок — как их мерит сверка (`sameLookColours`): `mean` и `share` — худшие по расцветкам. Отсев ослаблен
 * (хеш до `hash`, тон до `tone`): нужен, чтобы показать, где проходит порог, а не чтобы решать. Для отчёта о допуске (`scripts/clothing-looks.mjs --pairs`).
 * Возвращает `[{ a, b, names, component, gender, colours, mean, share, mergeable }]` — `a`, `b` — места первых вещей наборов.
 */
export async function scanLookPairs(entries, { hash = 16, tone = 30 } = {}) {
  const pairs = [];
  for (const list of grouped(entries, (entry) => `${entry.gender}|${entry.component}|${entry.pix.length}`).values()) {
    const sets = [...grouped(list, (entry) => entry.pix.join("+")).values()];
    const close = (a, b) => {
      const left = a[0].pre;
      const right = b[0].pre;
      return Boolean(left && right && hammingHex(left.hash, right.hash) <= hash && left.tone.every((value, at) => Math.abs(value - right.tone[at]) <= tone));
    };
    const candidates = [];
    for (let i = 0; i < sets.length; i += 1) for (let j = i + 1; j < sets.length; j += 1) if (close(sets[i], sets[j])) candidates.push([i, j]);
    /* Сетки набора читаются один раз на вид: после вида они не держатся. */
    const grids = new Map();
    const load = async (index) => {
      if (!grids.has(index)) grids.set(index, await sets[index][0].grids());
      return grids.get(index);
    };
    for (const [i, j] of candidates) {
      const left = await load(i);
      const right = await load(j);
      let mean = 0;
      let share = 0;
      let comparable = left.length === right.length;
      for (let at = 0; comparable && at < left.length; at += 1) {
        const a = left[at];
        const b = right[at];
        if (!a?.grid || !b?.grid || Math.abs(a.width / a.height - b.width / b.height) >= 0.01) {
          comparable = false;
          break;
        }
        const difference = gridDifference(a.grid, b.grid, "same");
        mean = Math.max(mean, difference.mean);
        share = Math.max(share, difference.share);
      }
      /* `mergeable` — слилась бы пара, пройди она по картинке: у видов под торс любая форма, у прочих — та же форма (точно или «почти»). */
      const first = sets[i][0];
      const second = sets[j][0];
      if (comparable)
        pairs.push({ a: first.place, b: second.place, names: [first.name, second.name], component: first.component, gender: first.gender, colours: left.length, mean, share, mergeable: FORMS.has(first.component) || sameShape(first, second) });
    }
  }
  return pairs;
}
