// Эмблемы и надписи в работе: разбор, ключ нарисованной надписи, плашки в игре, код друга.
import { normalizeRecolourHex } from './colour.js';

// ---------- Данные (дословно) ----------

export const EMBLEM_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;
export const EMBLEM_FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;
export const EMBLEM_TEXT_OUTLINES = Object.freeze(['none', 'dark', 'light']);
export const EMBLEM_TEXT_OUTLINE_LABELS = Object.freeze({
  none: 'Без обводки',
  dark: 'Тёмная',
  light: 'Светлая',
});
export const EMBLEM_TEXT_FONTS = Object.freeze([
  'block',
  'wide',
  'modern',
  'serif',
  'stencil',
  'script',
  'mono',
  'custom',
]);
export const EMBLEM_TEXT_FONT_LABELS = Object.freeze({
  block: 'Рубленый',
  wide: 'Широкий',
  modern: 'Современный',
  serif: 'С засечками',
  stencil: 'Трафарет',
  script: 'Рукописный',
  mono: 'Моно',
  custom: 'Свой шрифт',
});
export const EMBLEM_KINDS = Object.freeze(['image', 'text']);
export const EMBLEM_BACKDROP_RATIO = Object.freeze([0.25, 24]);
export const EMBLEM_KIND_LIMIT = 8;
export const EMBLEM_LIMIT = 16;
export const EMBLEM_LABEL_LIMIT = 40;
export const EMBLEM_TEXT_LIMIT = 40;

// ---------- Внутренние помощники ----------

const DEFAULT_TEXT = Object.freeze({ colour: '#f2f2f2', outline: 'dark', font: 'block', ratio: 2 });
const FONT_NAME_LIMIT = 60;
const FONT_NAME_FALLBACK = 'Свой шрифт';
const TITLES = Object.freeze({ image: 'Своя картинка', text: 'Пустая надпись' });
const DRAWN_FORMAT = /^[a-f0-9]{8}$/;
const ID_FORMAT = /^e[1-9][0-9]?$/;
const ID_COUNT = 99;
const PLATE_START = 0.03;
const PLATE_STEP = 0.01;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Ячейки подмены: у снимка кода друга разные виды теряют разные поля.
const BLANK_FOR_IMAGE = Object.freeze({ asset: '', name: '', width: 0, height: 0 });
const BLANK_FOR_TEXT = Object.freeze({ asset: '', width: 0, height: 0 });

const asString = (value) => String(value ?? '');
const isPlainRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const indexes = (length) => Array.from({ length }, (_, at) => at);
const mergeParts = (...parts) => parts.reduce((merged, part) => ({ ...merged, ...part }), {});
const known = (list, candidate, fallback) => (list.includes(candidate) ? candidate : fallback);
const pipeline = (value, ...steps) => steps.reduce((current, step) => step(current), value);

const stripControls = (line) => line
  .split('')
  .filter((unit) => unit.charCodeAt(0) > 31 && unit.charCodeAt(0) !== 127)
  .join('');

const cleanLine = (value, limit) => pipeline(
  value,
  asString,
  stripControls,
  (line) => line.trim(),
  (line) => line.slice(0, limit),
);

const roundTo = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const ratioOf = (value) => {
  const number = Number(value);
  const [floor, ceiling] = EMBLEM_BACKDROP_RATIO;
  if (!Number.isFinite(number)) return DEFAULT_TEXT.ratio;
  return roundTo(Math.max(floor, Math.min(ceiling, number)), 2);
};

// FNV-1a, 32 бита, по 16-битным единицам строки.
const fnv1a = (source) => {
  const units = indexes(source.length).map((at) => source.charCodeAt(at));
  const hash = units.reduce((state, unit) => Math.imul(state ^ unit, FNV_PRIME), FNV_OFFSET);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const ID_SLOTS = indexes(ID_COUNT).map((at) => `e${at + 1}`);

// Шрифт окна, либо свой шрифт вместе с файлом и именем; без годного файла свой шрифт не держится.
function fontFields(raw) {
  const font = known(EMBLEM_TEXT_FONTS, raw.font, DEFAULT_TEXT.font);
  if (font !== 'custom') return { font };
  const fontAsset = asString(raw.fontAsset);
  if (!EMBLEM_FONT_ASSET.test(fontAsset)) return { font: DEFAULT_TEXT.font };
  return { font, fontAsset, fontName: cleanLine(raw.fontName, FONT_NAME_LIMIT) || FONT_NAME_FALLBACK };
}

// Плашка-вывеска: фон и пропорции появляются только вместе.
function plateFields(raw) {
  const backdrop = normalizeRecolourHex(raw.backdrop, '');
  return backdrop ? { backdrop, ratio: ratioOf(raw.ratio) } : {};
}

// Поля, которые зависят от вида записи, поверх разбора места.
function kindFields(record, kind, placed) {
  const label = cleanLine(record.label, EMBLEM_LABEL_LIMIT);
  if (kind !== 'text') return { label };
  const text = normalizeEmblemText(record.text);
  const drawn = String(record.drawn);
  const trusted = placed.asset && emblemTextFilled(text) && DRAWN_FORMAT.test(drawn);
  return { label, name: text.value.trim(), text, drawn: trusted ? drawn : '' };
}

// Принимает одну запись списка, если для её вида ещё есть место; ведёт счёт видов и занятых id.
function admitRecord(tally, entry, normalizeBase, limit) {
  const record = isPlainRecord(entry) ? entry : {};
  const kind = record.kind === 'text' ? 'text' : 'image';
  if (!(tally.counts[kind] < limit)) return;
  const placed = normalizeBase(record);
  if (kind === 'image' && !placed.asset) return;
  const emblem = { id: '', kind, ...placed, ...kindFields(record, kind, placed) };
  const wanted = String(record.id);
  if (ID_FORMAT.test(wanted) && !tally.claimed.has(wanted)) {
    tally.claimed.add(wanted);
    emblem.id = wanted;
  }
  tally.counts[kind] += 1;
  tally.kept.push(emblem);
}

const holdsContent = (item) => (item.kind === 'text' ? emblemTextFilled(item.text) : Boolean(item.asset));
const hasWords = (item) => item.kind !== 'text' || emblemTextFilled(item.text);
const withoutCustomFont = (text) => (text.font === 'custom' ? normalizeEmblemText({ ...text, font: 'block' }) : text);

const LOSSES = new Map([
  ['image', (item) => Boolean(item.asset)],
  ['text', (item) => item.text?.font === 'custom'],
]);

// ---------- Надпись ----------

export function emblemTextFilled(text) {
  return typeof text === 'object' && text !== null && asString(text.value).trim() !== '';
}

export function normalizeEmblemText(input) {
  const raw = isPlainRecord(input) ? input : {};
  return {
    value: stripControls(asString(raw.value)).slice(0, EMBLEM_TEXT_LIMIT),
    ...fontFields(raw),
    colour: normalizeRecolourHex(raw.colour, DEFAULT_TEXT.colour),
    outline: known(EMBLEM_TEXT_OUTLINES, raw.outline, DEFAULT_TEXT.outline),
    ...plateFields(raw),
  };
}

export function emblemTitle(item) {
  const spoken = () => {
    const words = item.text?.value;
    return (words ? String(words).trim() : '') || TITLES.text;
  };
  return item?.label || (item?.kind === 'text' ? spoken() : item?.name || TITLES.image);
}

export function emblemTextKey(text) {
  const fontPart = text.fontAsset ? `${text.font}:${text.fontAsset}` : text.font;
  const parts = [fontPart, text.colour, text.outline, text.value];
  if (text.backdrop) parts.push(text.backdrop, text.ratio);
  return fnv1a(parts.map((part) => `${part}`).join('|'));
}

// ---------- Список ----------

export function nextEmblemId(items) {
  const taken = new Set(items.map((item) => item.id));
  return ID_SLOTS.find((slot) => !taken.has(slot)) ?? ID_SLOTS.at(-1);
}

export function normalizeEmblemList(source, normalizeBase, { legacyText = null, limit = EMBLEM_KIND_LIMIT } = {}) {
  const modern = Array.isArray(source?.emblems);
  const stored = modern ? source.emblems : [source?.emblem].filter(Boolean);
  const heirloom = !modern && emblemTextFilled(legacyText) ? [{ ...legacyText, kind: 'text', text: legacyText }] : [];

  const tally = { kept: [], counts: { image: 0, text: 0 }, claimed: new Set() };
  [...stored.slice(0, Math.max(32, 2 * limit)), ...heirloom]
    .forEach((entry) => admitRecord(tally, entry, normalizeBase, limit));
  tally.kept
    .filter((emblem) => !emblem.id)
    .forEach((emblem) => {
      emblem.id = nextEmblemId(tally.kept);
    });
  return tally.kept;
}

export function readyEmblems(items) {
  return items.filter((item) => item.asset).filter(hasWords);
}

export function emblemAssets(items) {
  const assets = readyEmblems(items).map((item) => item.asset);
  return assets.filter((asset, at) => assets.indexOf(asset) === at);
}

export function emblemDecal(item, extra = {}) {
  return mergeParts(
    Object.fromEntries(['id', 'asset', 'point', 'normal'].map((key) => [key, item[key]])),
    {
      width: roundTo(item.size * (item.width / Math.max(1, item.height)), 2),
      height: item.size,
      opacity: item.opacity / 100,
      angle: item.angle,
    },
    extra,
  );
}

// ---------- Плашки в игре ----------

export function emblemPlateName(model, index) {
  if (index !== 0) return `${model}_${index + 1}`;
  return model;
}

export function emblemPlateOffset(index) {
  return roundTo(PLATE_START + index * PLATE_STEP, 3);
}

export function emblemPlateFiles({ model, types, map }, count = 1) {
  const names = indexes(Math.max(1, count)).map((at) => emblemPlateName(model, at));
  const models = ['.ydr', '_far.ydr'].flatMap((suffix) => names.map((name) => `${name}${suffix}`));
  const sheets = [[types, '.ytyp'], [map, '.ymap'], [map, '_lod.ymap']].map(([stem, suffix]) => `${stem}${suffix}`);
  return [...models, ...sheets, '_manifest.ymf'];
}

export function emblemPlateModels(model, count = EMBLEM_LIMIT) {
  return indexes(count).map((at) => `${emblemPlateName(model, at)}.ydr`);
}

// ---------- Отпечаток, код друга, чистота работы ----------

export function emblemSignature(items, pick) {
  const ready = readyEmblems(items);
  if (ready.length === 0) return {};
  const [only] = ready;
  const asLegacy = ready.length === 1 && only.kind === 'image' && only.id === 'e1';
  if (asLegacy) return { emblem: pick(only) };
  return { emblems: ready.map((item) => mergeParts({ id: item.id }, pick(item))) };
}

export function shareableEmblems(items) {
  return items.map((item) => (item.kind === 'text'
    ? mergeParts(item, BLANK_FOR_TEXT, { text: withoutCustomFont(item.text), drawn: '' })
    : mergeParts(item, BLANK_FOR_IMAGE)));
}

export function emblemsLostInCode(items) {
  return items.some((item) => LOSSES.get(item.kind)?.(item) === true);
}

export function hasEmblems(items) {
  return items.some(holdsContent);
}
