// Кадры спрайта: размещения, метки и список отображения на нужном кадре.
import { SwfReader } from "./bits.js";
import { TAG, readTags } from "./file.js";

// ---------- фильтры PlaceObject3 (тела пропускаются) ----------

const fixedFilter = (size) => () => size;
const gradientFilter = (r) => 5 * r.u8() + 19;

// Номер фильтра → имя и длина тела после байта номера.
const FILTERS = [
  ["drop-shadow", fixedFilter(23)],
  ["blur", fixedFilter(9)],
  ["glow", fixedFilter(15)],
  ["bevel", fixedFilter(27)],
  ["gradient-glow", gradientFilter],
  ["convolution", (r) => 8 + 4 * r.u8() * r.u8() + 5],
  ["color-matrix", fixedFilter(80)],
  ["gradient-bevel", gradientFilter],
];

function skipFilters(r) {
  const names = [];
  for (let count = r.u8(); count > 0; count--) {
    const kind = r.u8();
    if (!FILTERS[kind]) throw new Error(`GFX: неизвестный фильтр ${kind}.`);
    const [name, bodySize] = FILTERS[kind];
    const skip = bodySize(r);
    r.need(skip);
    r.offset += skip;
    names.push(name);
  }
  return names;
}

// ---------- разбор размещений по таблице флагов ----------
// Строка таблицы: [какой байт флагов, маска, ключ (null — прочитать и выбросить), чтение].
// Строки идут в порядке полей в байтах. Имя класса есть при флаге 0x08 второго байта
// или при 0x10 второго вместе с «есть символ» первого — это особая строка.

const FIRST = 0;
const SECOND = 1;

const PLACE2_FIELDS = [
  [(f) => f[SECOND] & 0x08 || (f[SECOND] & 0x10 && f[FIRST] & 0x02), "className", (r) => r.string()],
  [(f) => f[FIRST] & 0x02, "characterId", (r) => r.u16()],
  [(f) => f[FIRST] & 0x04, "matrix", (r) => r.matrix()],
  [(f) => f[FIRST] & 0x08, "cxform", (r) => r.colorTransform(true)],
  [(f) => f[FIRST] & 0x10, "ratio", (r) => r.u16()],
  [(f) => f[FIRST] & 0x20, "name", (r) => r.string()],
  [(f) => f[FIRST] & 0x40, "clipDepth", (r) => r.u16()],
  [(f) => f[SECOND] & 0x01, "filters", skipFilters],
  [(f) => f[SECOND] & 0x02, "blend", (r) => r.u8()],
  [(f) => f[SECOND] & 0x04, null, (r) => r.u8()],
  [(f) => f[SECOND] & 0x20, "visible", (r) => r.u8() !== 0],
];

// PlaceObject (1): поля без флагов; цветовое преобразование — если в теге осталось место.
function placeObject1(r, tag) {
  const placement = { move: false, characterId: r.u16(), depth: r.u16(), matrix: r.matrix() };
  if (r.offset < tag.end) placement.cxform = r.colorTransform(false);
  return placement;
}

// PlaceObject2/3: байты флагов (у третьего — два), глубина, дальше поля по таблице.
const flaggedPlacement = (flagBytes) => (r) => {
  const flags = [r.u8(), flagBytes === 2 ? r.u8() : 0];
  const placement = { move: (flags[FIRST] & 0x01) !== 0, depth: r.u16() };
  for (const [present, key, read] of PLACE2_FIELDS) {
    if (!present(flags)) continue;
    const value = read(r);
    if (key !== null) placement[key] = value;
  }
  return placement;
};

const placeObject2 = flaggedPlacement(1);

// Прочие коды читаются как PlaceObject2.
const PLACEMENT_READERS = new Map([
  [TAG.PLACE_OBJECT, placeObject1],
  [TAG.PLACE_OBJECT2, placeObject2],
  [TAG.PLACE_OBJECT3, flaggedPlacement(2)],
]);

export function readPlacement(bytes, tag) {
  const reader = new SwfReader(bytes, tag.start, tag.end);
  return (PLACEMENT_READERS.get(tag.code) ?? placeObject2)(reader, tag);
}

// ---------- спрайты ----------

// Теги спрайта с номером кадра: кадр тега — сколько ShowFrame было до него.
function* framed(tags) {
  let frame = 0;
  for (const tag of tags) {
    yield [frame, tag];
    if (tag.code === TAG.SHOW_FRAME) frame += 1;
  }
}

// Прочитанные спрайты: оглавление → (номер → спрайт). Оглавление не удерживается.
const spriteCache = new WeakMap();

function cachedSprites(gfx) {
  let sprites = spriteCache.get(gfx);
  if (!sprites) spriteCache.set(gfx, (sprites = new Map()));
  return sprites;
}

export function readSprite(gfx, id) {
  const cached = spriteCache.get(gfx)?.get(id);
  if (cached) return cached;

  const definition = gfx.definitions.get(id);
  if (!definition || definition.code !== TAG.DEFINE_SPRITE) return null;

  const head = new SwfReader(gfx.bytes, definition.start, definition.end);
  head.u16();
  const frameCount = head.u16();
  const tags = readTags(gfx.bytes, head.offset, definition.end);

  // Метка — первому кадру, где встретилась.
  const labels = new Map();
  for (const [frame, tag] of framed(tags)) {
    if (tag.code !== TAG.FRAME_LABEL) continue;
    const label = new SwfReader(gfx.bytes, tag.start, tag.end).string();
    if (!labels.has(label)) labels.set(label, frame);
  }

  const sprite = { id, frameCount, tags, labels };
  cachedSprites(gfx).set(id, sprite);
  return sprite;
}

export function frameIndex(sprite, frame) {
  if (typeof frame === "string") return sprite.labels.get(frame) ?? null;
  const index = Number(frame) || 0;
  const frames = Math.max(1, sprite.frameCount);
  return index >= 0 && index < frames ? index : null;
}

// ---------- сцена: действия тегов над картой глубин ----------

// Ключи записи в порядке, в каком размещение их переносит.
const RECORD_KEYS = ["characterId", "matrix", "cxform", "ratio", "name", "clipDepth", "visible", "filters", "blend"];

function putOnStage(depths, placement) {
  const base = placement.move && depths.get(placement.depth);
  const record = base ? { ...base } : { depth: placement.depth, visible: true };
  for (const key of RECORD_KEYS) {
    if (placement[key] !== undefined) record[key] = placement[key];
  }
  // Без символа запись на сцену не ставится (прежняя на глубине остаётся).
  if (record.characterId !== undefined) depths.set(placement.depth, record);
}

// Снятие: глубина u16 из тела без проверки длины (у RemoveObject — после номера символа).
const removeAt = (skip) => (depths, bytes, tag) => {
  const at = tag.start + skip;
  depths.delete(bytes[at] | (bytes[at + 1] << 8));
};
const place = (depths, bytes, tag) => putOnStage(depths, readPlacement(bytes, tag));

const STAGE_ACTIONS = new Map([
  [TAG.PLACE_OBJECT, place],
  [TAG.PLACE_OBJECT2, place],
  [TAG.PLACE_OBJECT3, place],
  [TAG.REMOVE_OBJECT, removeAt(2)],
  [TAG.REMOVE_OBJECT2, removeAt(0)],
]);

export function displayList(gfx, spriteId, frame = 0) {
  const sprite = readSprite(gfx, spriteId);
  if (!sprite) return [];
  const target = frameIndex(sprite, frame);
  if (target === null) return [];

  // Свёртка тегов над картой глубин до ShowFrame нужного кадра. Дробный номер ни с одним
  // кадром не совпадает — тогда проходит весь спрайт.
  const depths = new Map();
  for (const [at, tag] of framed(sprite.tags)) {
    if (tag.code === TAG.SHOW_FRAME && at === target) break;
    STAGE_ACTIONS.get(tag.code)?.(depths, gfx.bytes, tag);
  }
  return [...depths.values()].sort((a, b) => a.depth - b.depth);
}

export function spritesWithLabels(gfx, names) {
  const found = [];
  for (const [id, tag] of gfx.definitions) {
    if (tag.code !== TAG.DEFINE_SPRITE) continue;
    const { labels } = readSprite(gfx, id);
    if (names.every((label) => labels.has(label))) found.push(id);
  }
  return found;
}
