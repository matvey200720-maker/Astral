/*
 * «Красить только вещь» — маска листа для вещей, у которых кожа лежит на том же листе (ногти и накладки на руку: у них лист кожи рук и торса с тёмными пятнами ногтей; 16.11.2026, владелец:
 * «чтобы красилась только борода, а на лицо бы, на руки оно бы не заходило… любая одежда»). Кожу рядом с вещью, что лежит отдельным мешем и материалом (`head`, `hand`), закрывает
 * `skin-materials.js`; здесь — когда отдельного материала нет и кожа и вещь на одном листе.
 *
 * Чистый модуль без холста и сцены: сцена даёт острова развёртки (`itemParts`, `gun-scene-islands.js`) с площадью и средним цветом листа, модуль решает, какие острова — вещь, а какие — кожа.
 * Правило: самый большой остров листа и острова его тона — кожа (у ногтей кожа рук и торса занимает почти весь лист), остальное — вещь. Правило честное только когда:
 *   • самый большой остров цветом похож на кожу (чёрная кожаная перчатка или футболка не «кожа»: листа кожи в ней нет, маска не нужна — `applies: false`);
 *   • граница вещь | кожа проходит по границам мешей — меш целиком вещь или целиком кожа (`reliable`): тогда маска ставится сама. Иначе (оба цвета в одном меше) — это догадка, которую
 *     человек подтверждает (`reliable: false`), и сама маска не ставится.
 */

/** Ключ острова в списке вещи: «номер сетки в записи материала : номер острова сетки». */
export const partKey = (meshIndex, island) => `${meshIndex}:${island}`;

/** Расстояние между цветами в долях, 0…1 (евклид по каналам, делённый на длину диагонали куба). */
export const toneDistance = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) / (255 * Math.sqrt(3));

/** Острова, цвет которых ближе этого к цвету главного острова, — кожа. */
export const SAME_TONE = 0.14;

/* «Похожие части» берут только почти тот же цвет (по живому кадру Majestic №5.72: ногти телесного цвета, при 0,14 «похожие» утянули всю кожу пальцев в вещь). */
export const SIMILAR_TONE = 0.05;

/* Окрестность порога, где цвет не решает: от 0,7 до 1,4 порога. По 13 настоящим карточкам ногтей разрыв «кожа | вещь» у GTA 5 RP 0,06 → 0,32 (порог в нём далеко от границ), у Majestic №5.72 и №5.99 — 0,137 → 0,142. */
const CLOSE_BELOW = 0.7;
const CLOSE_ABOVE = 1.4;
/* Чистый разрыв: кожа не дальше 0,6 порога (0,084), вещь не ближе 2 порогов (0,28). Запас по 13 настоящим карточкам ногтей: у кожи худший GTA 5 RP №4.14 — 0,064 (запас 0,020 до 0,084),
   у вещи худший — 0,325 (запас 0,045 до 0,28); неуверенные Majestic №5.72 и №5.99 — кожа 0,133–0,137 (дальше 0,084 на 0,05), вещь 0,141–0,142 (ближе 0,28 на 0,14). */
const SKIN_REACH = 0.6;
const ITEM_REACH = 2;

/* Цвет кожи в листах ped: розово-бежевый и коричневый, не серый и не чёрный, не синий. */
const SKIN = { hue: [0, 50], saturation: [0.1, 0.75], value: [0.22, 0.97] };

/** Цвет [r, g, b] 0…255 → { hue 0…360, saturation 0…1, value 0…1 }. */
export function hsvOf([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const top = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const span = top - low;
  let hue = 0;
  if (span > 0) {
    if (top === r) hue = ((g - b) / span) % 6;
    else if (top === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: top === 0 ? 0 : span / top, value: top };
}

const within = (value, [from, to]) => value >= from && value <= to;

/** Похож ли цвет на кожу листа: оттенок от красного к жёлтому, не серый и не слишком тёмный. */
export function looksLikeSkin(tone) {
  if (!Array.isArray(tone) || tone.length < 3) return false;
  const { hue, saturation, value } = hsvOf(tone);
  return within(hue, SKIN.hue) && within(saturation, SKIN.saturation) && within(value, SKIN.value);
}

/**
 * Какие острова — вещь, какие — кожа. `islands` — `[{ key, mesh, area, tone }]` (`tone` — средний [r, g, b] листа под островом, null — нечем мерить).
 * Ответ: `applies` — на листе есть кожа, маска нужна; `reliable` — догадка уверена (граница по границам мешей ИЛИ чистый разрыв тонов), маска ставится сама; `item`, `skin` — ключи;
 * `reason` — `by-mesh`, `by-tone`, `inside-mesh` (кожа и вещь в одном меше, цвет не чист), `close-tones` (цвета на границе порога); `maxSkin`, `minItem` — расстояния для проверки запаса.
 */
export function guessItemIslands(islands, { sameTone = SAME_TONE } = {}) {
  const known = (islands ?? []).filter((island) => island && island.tone && island.area > 0);
  const nothing = (reason) => ({ applies: false, reliable: false, item: [], skin: [], reason });
  if (known.length < 2) return nothing("few-islands");
  const main = known.reduce((best, island) => (island.area > best.area ? island : best));
  if (!looksLikeSkin(main.tone)) return nothing("no-skin");

  const skin = [];
  const item = [];
  for (const island of known) (toneDistance(island.tone, main.tone) <= sameTone ? skin : item).push(island);
  if (!item.length) return { applies: false, reliable: false, item: [], skin: skin.map((island) => island.key), reason: "all-skin" };

  /* Граница по границам мешей: каждая сетка целиком вещь или целиком кожа. */
  const side = new Map();
  let mixed = false;
  for (const [kind, list] of [["item", item], ["skin", skin]]) {
    for (const island of list) {
      const seen = side.get(island.mesh);
      if (seen && seen !== kind) mixed = true;
      side.set(island.mesh, kind);
    }
  }
  /* Острова на самой границе порога (цвет почти кожи — ногти телесного цвета у Majestic №5.72, №5.99: кожа до 0,137, вещь от 0,142) — цвет не решает: догадка неуверенная, даже когда граница идёт по мешам. */
  const distanceOf = (island) => toneDistance(island.tone, main.tone);
  const close = known.some((island) => {
    const gap = distanceOf(island);
    return gap >= sameTone * CLOSE_BELOW && gap <= sameTone * CLOSE_ABOVE;
  });
  /* Чистый разрыв тонов: самый «некожий» остров кожи не дальше `SKIN_REACH` порога, самый «кожий» остров вещи не ближе `ITEM_REACH` порогов. Тогда граница ясна и без границы по мешам (GTA 5 RP: кожа до 0,013–0,064, вещь от 0,32). */
  const maxSkin = Math.max(...skin.map(distanceOf));
  const minItem = Math.min(...item.map(distanceOf));
  const clean = maxSkin <= sameTone * SKIN_REACH && minItem >= sameTone * ITEM_REACH;
  const reliable = clean || (!mixed && !close);
  let reason = "by-mesh";
  if (clean && mixed) reason = "by-tone";
  else if (!reliable) reason = close ? "close-tones" : "inside-mesh";
  return { applies: true, reliable, item: item.map((island) => island.key), skin: skin.map((island) => island.key), reason, maxSkin, minItem };
}

/** Площади и цвета островов по замерам: `tones[i]` — цвет `islands[i]`; остров без цвета остаётся с `tone: null`. */
export const withTones = (islands, tones) => islands.map((island, at) => ({ ...island, tone: tones?.[at] ?? null }));

/** Треугольники нескольких островов одним массивом (по шесть чисел на треугольник): так маска рисуется одним проходом. */
export function joinTriangles(parts) {
  const total = parts.reduce((sum, part) => sum + part.triangles.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part.triangles, at);
    at += part.triangles.length;
  }
  return out;
}

/** Площадь треугольников острова в долях листа (по шесть чисел u, v на треугольник). */
export function areaOf(triangles) {
  let total = 0;
  for (let at = 0; at + 6 <= triangles.length; at += 6) {
    const ax = triangles[at];
    const ay = triangles[at + 1];
    total += Math.abs((triangles[at + 2] - ax) * (triangles[at + 5] - ay) - (triangles[at + 4] - ax) * (triangles[at + 3] - ay)) / 2;
  }
  return total;
}

/**
 * Что делать с листом (`parts` — острова листа, `guess` — `guessItemIslands`, `marked` — ключи, которые отметил человек, или пусто):
 *   • `marked` — человек отметил, что красить: маска по его отметке (ключи, которых нет на листе, не считаются; ничего не осталось — отметки как бы нет);
 *   • `auto` — догадка уверена (граница по мешам): маска по ней;
 *   • `closed` — на листе кожа есть, граница не ясна: красить пока нечего, человек отмечает вещь сам (`suggest` — догадка для подсветки);
 *   • `none` — кожи на листе нет: маски нет, красится вся вещь, как было.
 */
export function decideItemMask(parts, guess, marked) {
  const present = new Set((parts ?? []).map((part) => part.key));
  const own = [...new Set(marked ?? [])].filter((key) => present.has(key));
  if (own.length > 0) return { state: "marked", item: own, suggest: guess?.item ?? [] };
  if (guess?.applies && guess.reliable) return { state: "auto", item: guess.item, suggest: guess.item };
  if (guess?.applies) return { state: "closed", item: [], suggest: guess.item };
  return { state: "none", item: [], suggest: [] };
}

/**
 * Переключение части вещи по щелчку: шаг — сетка целиком, если на листе несколько сеток, иначе остров. `current` — ключи вещи сейчас, `key` — часть под щелчком.
 * Ответ — новый список ключей: часть была вещью — уходит, не была — становится.
 */
export function toggleItemPart(parts, current, key) {
  const list = parts ?? [];
  const hit = list.find((part) => part.key === key);
  if (!hit) return [...(current ?? [])];
  const meshes = new Set(list.map((part) => part.mesh));
  const group = meshes.size > 1 ? list.filter((part) => part.mesh === hit.mesh) : [hit];
  const now = new Set(current ?? []);
  const on = group.every((part) => now.has(part.key));
  for (const part of group) {
    if (on) now.delete(part.key);
    else now.add(part.key);
  }
  return [...now];
}

/**
 * «Похожие»: к отмеченному добавляются части того же цвета (расстояние до среднего цвета отмеченного не больше `sameTone`). Нечего сравнивать (нет отмеченного или цветов) — список как был.
 */
export function addSimilarParts(parts, current, { sameTone = SIMILAR_TONE } = {}) {
  const list = (parts ?? []).filter((part) => part.tone);
  const chosen = list.filter((part) => (current ?? []).includes(part.key));
  if (!chosen.length) return [...(current ?? [])];
  const weight = chosen.reduce((sum, part) => sum + (part.area || 1), 0);
  const mean = [0, 1, 2].map((channel) => chosen.reduce((sum, part) => sum + part.tone[channel] * (part.area || 1), 0) / weight);
  const now = new Set(current);
  for (const part of list) if (toneDistance(part.tone, mean) <= sameTone) now.add(part.key);
  return [...now];
}
