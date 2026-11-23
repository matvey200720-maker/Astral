// Мод воды: разбор water.xml обратно в проект редактора прозрачности и перечень того, что редактор не повторит.
import { WATER_VISIBILITY, normalizeWaterProject, waterQuadAlpha } from './water.js';

// Штатная вода (сборка 2026 года): хранятся только отпечатки секций, значения Rockstar — нет.
const STOCK_QUADS = 504;
const STOCK_ALPHA = 26;
const SWAMP_ALPHA = 80;

// «60..65» — полуинтервал номеров подряд, «301» — один номер.
const expandRanges = (spec) =>
  spec.split(' ').flatMap((item) => {
    const [from, to = from] = item.split('..').map(Number);
    return Array.from({ length: to - from + 1 }, (_, step) => from + step);
  });
const SWAMP_QUADS = new Set(expandRanges('60..65 301..302 305 366..367 373 488..490'));

const stockPrint = ([count, print]) => ({ count, print });
const STOCK_WAVES = stockPrint([116, '18001cfb']);
const STOCK_CALMING = stockPrint([542, '29db273f']);
const STOCK_SHAPE = stockPrint([504, 'ccff98b5']);

const CORNER_TAG = /<a[1-4]\s+value="(\d+(?:\.\d+)?)"/gi;
const FIELD_TAG = /<(\w+)\s+value="([^"]*)"/g;
const ITEM = /<Item>[\s\S]*?<\/Item>/g;
const WAVE_FIELDS = ['Amplitude', 'XDirection', 'YDirection'];

const clampTo = (low, high, value) => Math.min(high, Math.max(low, value));

// Пустые и «ложные» значения — пустой текст, остальное — обычное приведение к строке.
const sourceText = (xml) => (xml ? String(xml) : '');

// FNV-1a, 32 бита, по 16-битным единицам строки.
const fnv1a = (text) => {
  const hash = Array.prototype.reduce.call(text, (state, unit) => Math.imul(state ^ unit.charCodeAt(0), 0x01000193), 0x811c9dc5);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

// Содержимое первой секции <Имя>…</Имя> (тег без атрибутов, без учёта регистра) или null.
const sectionBody = (text, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(text)?.[1] ?? null;

// Значение поля так, как его прочтёт игра: конечное число — своим записью, иначе строка из файла.
const gameValue = (raw) => (Number.isFinite(Number(raw)) ? String(Number(raw)) : raw);

const recordFields = (record) => Array.from(record.matchAll(FIELD_TAG), ([, name, raw]) => [name, gameValue(raw)]);

const firstValue = (fields, wanted) => fields.find(([name]) => name === wanted)?.[1] ?? '';

// Как описывается запись каждой секции: из полей получается строка, по которой считается отпечаток.
const DESCRIBERS = {
  WaveQuads: (fields) => WAVE_FIELDS.map((name) => firstValue(fields, name)).join(','),
  CalmingQuads: (fields) => firstValue(fields, 'fDampening'),
  WaterQuads: (fields) =>
    fields
      .filter(([name]) => !/^a[1-4]$/.test(name))
      .map(([name, value]) => `${name}=${value}`)
      .join(','),
};

const sectionPrint = (text, tag) => {
  const body = sectionBody(text, tag);
  if (body === null) return null;
  const records = body.match(ITEM) ?? [];
  const lines = records.map((record) => DESCRIBERS[tag](recordFields(record)));
  return Object.assign({ count: records.length }, { print: fnv1a(lines.join(';')) });
};

export function waterPrints(xml) {
  const text = sourceText(xml);
  return Object.fromEntries([
    ['waves', sectionPrint(text, 'WaveQuads')],
    ['calming', sectionPrint(text, 'CalmingQuads')],
    ['shape', sectionPrint(text, 'WaterQuads')],
  ]);
}

export function waterTransparencyOfAlpha(alpha) {
  const { k, min, max } = WATER_VISIBILITY;
  const clamped = clampTo(1, 255, Number(alpha) || 1);
  const share = Math.log(k / (clamped * clamped) / min) / Math.log(max / min);
  return Math.round(clampTo(0, 1, share) * 1000) / 10;
}

export function waterQuadAlphas(xml) {
  const body = sectionBody(sourceText(xml), 'WaterQuads');
  return body === null ? [] : [...body.matchAll(CORNER_TAG)].map((match) => Number(match[1]));
}

// Самое частое значение; при равенстве — то, что встретилось раньше.
const mostCommon = (values) => {
  const counts = values.reduce((tally, value) => tally.set(value, (tally.get(value) ?? 0) + 1), new Map());
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [undefined, 0])[0];
};

// Отсутствующая секция считается штатной.
const isStock = (found, stock) => found === null || ['count', 'print'].every((key) => found[key] === stock[key]);

export function waterProjectFromXml(xml, options) {
  return (waterFromXml(xml, options) ?? { project: null }).project ?? null;
}

// «Квад» — каждое четвёртое значение подряд; штатная раскладка применима только к ровно 504 таким значениям.
const quadVerdicts = (alphas, transparency) => {
  const firstCorners = Array.from({ length: Math.ceil(alphas.length / 4) }, (_, quad) => alphas[quad * 4]);
  const indexed = firstCorners.length === STOCK_QUADS;
  const verdicts = firstCorners.map((alpha, quad) => {
    const inSwamp = indexed && SWAMP_QUADS.has(quad);
    const stock = inSwamp ? SWAMP_ALPHA : STOCK_ALPHA;
    return { alpha, inSwamp, edited: alpha !== stock, own: alpha !== waterQuadAlpha(stock, transparency) };
  });
  return {
    indexed,
    stockKept: verdicts.every((one) => !one.edited),
    swamp: verdicts.filter((one) => one.own && one.inSwamp).map((one) => one.alpha),
    ownCount: verdicts.filter((one) => one.own && !one.inSwamp).length,
  };
};

export function waterFromXml(xml, { name = '' } = {}) {
  const alphas = waterQuadAlphas(xml);
  if (alphas.length === 0) return null;

  const transparency = waterTransparencyOfAlpha(mostCommon(alphas));
  const project = normalizeWaterProject({ name, sea: { transparency }, under: { mode: 'game' } });
  const { indexed, stockKept, swamp, ownCount } = quadVerdicts(alphas, transparency);

  const prints = waterPrints(xml);
  const stockFlags = [
    ['shape', STOCK_SHAPE],
    ['waves', STOCK_WAVES],
    ['calming', STOCK_CALMING],
  ].map(([section, stock]) => isStock(prints[section], stock));
  const [shapeStock, wavesStock, calmingStock] = stockFlags;

  // Каждое замечание: условие и (лениво) его текст.
  const remarks = [
    [
      swamp.length > 0,
      () => {
        const author = mostCommon(swamp);
        const editor = waterQuadAlpha(SWAMP_ALPHA, transparency);
        return `болото Санкудо: у автора альфа ${author}, редактор ставит ${editor} — болото у него ${editor > author ? 'мутнее' : 'прозрачнее'}`;
      },
    ],
    [ownCount > 0, () => `у ${ownCount} квадов воды своя прозрачность — редактор ставит одну на всю воду`],
    [!shapeStock, () => 'границы, высота или флаги квадов воды у автора свои — редактор прозрачности их не правит'],
    [!wavesStock, () => 'волны мода (WaveQuads) — редактор прозрачности их не правит'],
    [!calmingStock, () => 'гашение волн у берегов (CalmingQuads) — редактор прозрачности его не правит'],
  ];
  const lost = remarks.filter(([applies]) => applies).map(([, text]) => text());

  return { project, lost, same: [indexed, stockKept, ...stockFlags].every(Boolean) };
}
