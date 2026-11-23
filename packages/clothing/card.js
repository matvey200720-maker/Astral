// Блок domain.clothing карточки мода: приводит пришедший объект к строгому виду
// или отказывает ClothingCardError с понятной причиной. Доверять входу нельзя.
import { GARMENT_KINDS } from "./garment-kinds.js";
import { CATEGORIES, COMPONENT_NAMES, SERVERS } from "./taxonomy.js";

export class ClothingCardError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClothingCardError";
  }
}

const GENDERS = ["male", "female"];
const ORIGINS = ["addon", "replace"];
const DLC_SOURCES = ["game", "rockstar", "collection", "dlc"];
const MODEL_SUFFIXES = ["u", "r"];
const CATEGORY_IDS = CATEGORIES.map((category) => category.id);
const SERVER_IDS = SERVERS.map((server) => server.id);

/* Наборов не больше 26: по набору на расцветку, а букв расцветок в пакете 26 (a–z). С пределом 12 карточка молча обрезала расцветки — у «Рюкзака в виде приставки» из 22 расцветок в списке было 12 при 22 в пакете и галерее (11.11.2026). */
const MAX_SETS = 26;
const MAX_VARIANTS = 26;
const MAX_TARGETS = 32;

// Проверки форматов идут над значением, приведённым к строке (так задумано старым кодом).
const SINGLE_LETTER = /^[a-z]$/;
const PACK = /^[a-z0-9._-]{1,80}$/;
const SWATCH = /^#[0-9a-f]{6}$/i;
const FRAME = /^preview\/[A-Za-z0-9._/-]{1,200}\.(?:png|webp|jpe?g)$/i;
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const PED_FOLDER = /^mp_[mf]_freemode_01(?:_p)?(?:_[A-Za-z0-9_]{1,64})?$/i;
const RACE = /^[a-z]{3}$/;

const DLC_TEXT_LIMITS = [
  ["pack", 64],
  ["name", 64],
  ["title", 80],
  ["collection", 64],
];

const isObject = (value) => value !== null && typeof value === "object";

// null и undefined — пустая строка; остальное строкой, края снимаются до обрезки по пределу
function tidy(value, limit) {
  const text = value === null || value === undefined ? "" : String(value);
  return text.trim().slice(0, limit);
}

/**
 * Обходчик схем: схема — список [ключ, читатель, условие включения]; ключи
 * результата идут в порядке списка, поле без условия включается всегда.
 */
function assemble(schema, context) {
  const result = {};
  for (const [key, read, include] of schema) {
    if (!include || include(context)) result[key] = read(context);
  }
  return result;
}

/* ---------- расцветки и наборы ---------- */

function readLetters(raw, fallback) {
  const source = Array.isArray(raw) ? raw : typeof raw === "string" ? [...raw] : [fallback];
  const seen = new Set();
  let letters = "";
  for (const item of source) {
    if (!SINGLE_LETTER.test(item)) continue;
    const letter = String(item);
    if (seen.has(letter)) continue;
    seen.add(letter);
    letters += letter;
  }
  return letters;
}

const frameOrNull = (value) => (FRAME.test(value) ? value : null);

const VARIANT_SCHEMA = [
  ["letter", (raw) => raw.letter],
  ["letters", (raw) => readLetters(raw.letters, raw.letter)],
  ["swatch", (raw) => (SWATCH.test(raw.swatch) ? raw.swatch.toLowerCase() : null)],
  ["preview", (raw) => frameOrNull(raw.preview)],
  ["previewAlt", (raw) => frameOrNull(raw.previewAlt)],
];

const SET_SCHEMA = [
  ["id", ({ body, number }) => tidy(body.id, 80) || `set-${number}`],
  ["label", ({ body, number }) => tidy(body.label, 60) || `Набор ${number}`],
  ["variants", ({ variants }) => variants],
];

function readSet(raw, number) {
  const body = isObject(raw) ? raw : {};
  const variants = (Array.isArray(body.variants) ? body.variants : [])
    .filter((item) => isObject(item) && SINGLE_LETTER.test(item.letter))
    .slice(0, MAX_VARIANTS)
    .map((item) => assemble(VARIANT_SCHEMA, item));
  return variants.length > 0 ? assemble(SET_SCHEMA, { body, number, variants }) : null;
}

const readSets = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .map((item, index) => readSet(item, index + 1))
    .filter(Boolean)
    .slice(0, MAX_SETS);

/* ---------- цели замены ---------- */

const onSpot = ({ spot }) => spot;

const TARGET_SCHEMA = [
  ["server", ({ raw }) => (SERVER_IDS.includes(raw?.server) ? raw.server : null)],
  ["name", ({ name }) => name],
  ["shop", ({ raw }) => tidy(raw?.shop, 80) || null],
  ["allColours", ({ raw }) => Boolean(raw?.allColours)],
  ["part", ({ raw }) => raw.part, ({ raw }) => PART.test(raw?.part ?? "")],
  ["folder", ({ folder }) => folder.toLowerCase(), onSpot],
  ["drawable", ({ drawable }) => drawable, onSpot],
  ["modelSuffix", ({ raw }) => (MODEL_SUFFIXES.includes(raw.modelSuffix) ? raw.modelSuffix : null), onSpot],
  ["race", ({ raw }) => (RACE.test(raw.race) ? raw.race : null), onSpot],
  ["textures", ({ raw }) => Math.min(26, Math.max(1, Number(raw.textures) || 1)), onSpot],
];

function readTarget(raw) {
  const name = tidy(raw?.name, 120) || null;
  const folder = tidy(raw?.folder, 96);
  const drawable = Number(raw?.drawable);
  const spot = PED_FOLDER.test(folder) && Number.isInteger(drawable) && drawable >= 0 && drawable <= 999;
  return name !== null || spot ? assemble(TARGET_SCHEMA, { raw, name, folder, drawable, spot }) : null;
}

const readTargets = (raw) =>
  (Array.isArray(raw) ? raw : []).map(readTarget).filter(Boolean).slice(0, MAX_TARGETS);

/* ---------- откуда вещь ---------- */

const DLC_SCHEMA = [
  ["source", ({ raw }) => raw.source],
  ...DLC_TEXT_LIMITS.map(([key]) => [key, ({ text }) => text[key], ({ text }) => text[key] !== ""]),
];

function readDlc(raw) {
  if (!isObject(raw) || !DLC_SOURCES.includes(raw.source)) return null;
  const text = Object.fromEntries(DLC_TEXT_LIMITS.map(([key, limit]) => [key, tidy(raw[key], limit)]));
  return assemble(DLC_SCHEMA, { raw, text });
}

/* ---------- черновик блока и таблица отказов ---------- */

// Читатели исходных полей; каждый срабатывает лениво и один раз, поэтому порядок
// отказов (и ошибок платформы при непреобразуемых значениях) задаёт таблица ниже.
const DRAFT_READERS = {
  category: (block) => tidy(block.category, 40),
  gender: (block) => (GENDERS.includes(block.gender) ? block.gender : null),
  component: (block) => tidy(block.component, 16).toLowerCase(),
  garment: (block) => tidy(block.garment, 24),
  sets: (block) => readSets(block.sets),
  dlc: (block) => readDlc(block.dlc),
  replaces: (block) => readTargets(block.replaces),
};

function draftOf(block) {
  const draft = { block };
  for (const [name, read] of Object.entries(DRAFT_READERS)) {
    let value;
    let ready = false;
    Object.defineProperty(draft, name, {
      get() {
        if (!ready) {
          value = read(block);
          ready = true;
        }
        return value;
      },
    });
  }
  return draft;
}

// Побеждает первое сработавшее правило: [отказ ли, текст отказа].
const REFUSALS = [
  [(card) => card.gender === null && card.category !== "tattoos", () => "Не указан пол вещи: мужская или женская."],
  [(card) => !CATEGORY_IDS.includes(card.category), (card) => `Неизвестная категория одежды: «${card.category}».`],
  [
    (card) => card.component !== "" && !COMPONENT_NAMES.includes(card.component),
    (card) => `Неизвестный компонент педа: «${card.component}».`,
  ],
  [(card) => card.sets.length === 0, () => "У вещи нет ни одной расцветки."],
];

// Вид кроя годится, только если он есть у компонента (регистр важен).
const fitsComponent = (card) => GARMENT_KINDS[card.component]?.some((kind) => kind.id === card.garment) === true;
const given = (name) => ({ block }) => block[name] === true;

// Схема результата: порядок ключей — порядок в списке; необязательные поля — с условием.
const CARD_SCHEMA = [
  ["gender", (card) => card.gender],
  ["category", (card) => card.category],
  ["component", (card) => card.component || null],
  ["prop", ({ block }) => Boolean(block.prop)],
  ["drawable", ({ block }) => (Number.isInteger(block.drawable) ? block.drawable : null)],
  ["coverLetter", ({ block }) => block.coverLetter, ({ block }) => SINGLE_LETTER.test(block.coverLetter)],
  ["retexture", () => true, given("retexture")],
  ["ownPlaces", () => true, given("ownPlaces")],
  ["garment", (card) => card.garment, fitsComponent],
  ["pack", ({ block }) => block.pack, ({ block }) => typeof block.pack === "string" && PACK.test(block.pack)],
  ["origin", ({ block }) => block.origin, ({ block }) => ORIGINS.includes(block.origin)],
  ["dlc", (card) => card.dlc, (card) => card.dlc !== null],
  ["sets", (card) => card.sets],
  ["replaces", (card) => card.replaces],
];

export function normalizeClothingCard(block) {
  if (!block || typeof block !== "object") throw new ClothingCardError("Нет блока одежды.");
  const draft = draftOf(block);
  for (const [refuses, describe] of REFUSALS) {
    if (refuses(draft)) throw new ClothingCardError(describe(draft));
  }
  return assemble(CARD_SCHEMA, draft);
}
