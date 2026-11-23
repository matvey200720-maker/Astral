// Элементы вещи: запись и правка облика, остров развёртки, подгонка картинки, проекция по плоскости и обёртка, слова для списка.

export const ITEM_ELEMENT_FITS = Object.freeze(['cover', 'contain', 'stretch']);
export const ITEM_ELEMENT_FIT = 'cover';
export const ITEM_ELEMENT_LIMIT = 12;
export const ITEM_ELEMENT_WORDS = Object.freeze([
  'Экран',
  'Рамка',
  'Стекло',
  'Штукатурка',
  'Свет',
  'Асфальт',
  'Трава',
  'Земля',
  'Крыша',
  'Пол',
  'Ручка',
  'Дверь',
  'Стена',
  'Дерево',
  'Кожа',
  'Ковёр',
  'Ткань',
  'Мрамор',
  'Плитка',
  'Кирпич',
  'Бетон',
  'Камень',
  'Золото',
  'Металл',
  'Резина',
  'Пластик',
  'Плакат',
  'Знак',
  'Краска',
  'Покрытие',
  'Белое',
  'Светлое',
  'Серое',
  'Тёмное',
  'Чёрное',
  'Коричневое',
  'Красное',
  'Оранжевое',
  'Жёлтое',
  'Зелёное',
  'Голубое',
  'Синее',
  'Фиолетовое',
  'Розовое',
]);

// ---------- Форматы и пороги ----------

const KEY_FORMAT = /^[a-z0-9_.+-]{1,64}$/;
const COLOUR_FORMAT = /^#[0-9a-f]{6}$/i;
const PICTURE_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;
const PICTURE_SIDE_MAX = 8192;
const PICTURE_NAME_LIMIT = 120;
const TINY_AREA = 1e-9;
const TINY_SIZE = 1e-6;
const FALLBACK_FRONT = [0, -1, 0];
const IDENTITY_TURN = [0, 0, 0, 1];
const ISLAND_EPSILON = 1e-12;
const UPRIGHT_NORMAL_Z = 0.7;
const VOTE_SHARE = 0.1;
const COLLAPSED_DENSITY = 1e-5;
const JACOBI_STEPS = 32;
const JACOBI_TOLERANCE = 1e-12;
const PLANE_SIDED_SHARE = 0.2;
const FRAGMENT_PIECES = 4;
const FRAGMENT_LARGEST_SHARE = 0.4;
const PLANE_FACING_MIN = 0.8;
const ROUNDNESS_MIN = 0.35;
const WRAP_SIZE_MAX = 6;
const AXES = [0, 1, 2];

// ---------- Общие помощники ----------

const textOf = (value) => String(value ?? '');
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const indexes = (length) => Array.from({ length }, (_, at) => at);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const roundTo = (value, scale) => Math.round(value * scale) / scale;
const signOf = (value) => (value < 0 ? -1 : 1);
const span = (values) => values.reduce(([low, high], value) => [Math.min(low, value), Math.max(high, value)], [Infinity, -Infinity]);

const zipWith = (a, b, combine) => AXES.map((axis) => combine(a[axis], b[axis]));
const minus = (to, from) => zipWith(to, from, (x, y) => x - y);
const plus = (a, b) => zipWith(a, b, (x, y) => x + y);
const times = (vector, factor) => AXES.map((axis) => vector[axis] * factor);
const dot = (a, b) => zipWith(a, b, (x, y) => x * y).reduce((sum, term) => sum + term);
const lengthOf = (vector) => Math.hypot(...vector);
const cross = (a, b) => AXES.map((axis) => {
  const [next, last] = [(axis + 1) % 3, (axis + 2) % 3];
  return a[next] * b[last] - a[last] * b[next];
});

// Поворот вектора кватернионом (x, y, z, w) без нормирования: v + w·t + c × t, где t = 2·(c × v).
function rotated(vector, [x, y, z, w]) {
  const axis = [x, y, z];
  const lever = times(cross(axis, vector), 2);
  const side = cross(axis, lever);
  return vector.map((part, at) => part + w * lever[at] + side[at]);
}

const cornerOf = (values, index) => AXES.map((axis) => values[index * 3 + axis]);
const sheetPointOf = (mesh, index) => [mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]];

// Сетки, у которых есть все перечисленные поля (список может быть null; не итерируемое значение бросит TypeError).
const meshesWith = (meshes, fields) => [...(meshes ?? [])]
  .filter((mesh) => mesh && fields.every((field) => mesh[field]));
const trianglesOf = (mesh) => indexes(Math.floor(mesh.indices.length / 3))
  .map((at) => AXES.map((corner) => mesh.indices[at * 3 + corner]));
const verticesOf = (mesh) => indexes(Math.floor(mesh.positions.length / 3)).map((at) => cornerOf(mesh.positions, at));
const allVertices = (meshes) => meshesWith(meshes, ['positions']).flatMap(verticesOf);
const doubleArea = (mesh, corners) => {
  const [pa, pb, pc] = corners.map((index) => cornerOf(mesh.positions, index));
  return cross(minus(pb, pa), minus(pc, pa));
};

// ---------- Слово элемента ----------

// Знаки границы слова в имени листа: _ - . + и цифры.
const WORD_EDGE = '[_.+0-9-]';
const LAMP_NOT_AFTER_C = '(?<!c)lamp';
const SIGN_NOT_AFTER_DE = `(?<!de)signs?(?:${WORD_EDGE}|$)`;

// Как каждая часть правила превращается в кусок регулярного выражения.
const RULE_PIECES = [
  ['special', (words) => words.join('|')],
  ['inside', (words) => `(?:${words.join('|')})`],
  ['whole', (words) => `(?:^|${WORD_EDGE})(?:${words.join('|')})(?:${WORD_EDGE}|$)`],
  ['tail', (words) => `(?:${words.join('|')})(?:${WORD_EDGE}|$)`],
];

const compileWordRule = (rule) => new RegExp(
  RULE_PIECES.filter(([field]) => rule[field]?.length > 0).map(([field, build]) => build(rule[field])).join('|'),
);

// Строки просматриваются по порядку, берётся слово первой совпавшей.
const WORD_RULES = [
  ['Экран', { inside: ['screen', 'monitor', 'display', 'lcd'], whole: ['tv', 'script_rt'] }],
  ['Рамка', { inside: ['frame', 'border'], whole: ['rim'] }],
  ['Стекло', { inside: ['glass', 'window', 'mirror'] }],
  ['Штукатурка', { inside: ['plaster'] }],
  ['Свет', { inside: ['bulb'], special: [LAMP_NOT_AFTER_C] }],
  ['Асфальт', { inside: ['tarmac', 'asphalt', 'roadmarking'], whole: ['road', 'roads'] }],
  ['Трава', { inside: ['grass', 'weed', 'ground_cover'] }],
  ['Земля', { inside: ['dirt', 'soil', 'ground'] }],
  ['Крыша', { inside: ['roof'] }],
  ['Пол', { inside: ['floor'] }],
  ['Ручка', { inside: ['handle', 'knob'] }],
  ['Дверь', { inside: ['door'] }],
  ['Стена', { inside: ['wall'] }],
  ['Дерево', { inside: ['wood', 'plank', 'timber', 'wdpanel'], whole: ['oak', 'pine', 'wd'] }],
  ['Кожа', { inside: ['leather'] }],
  ['Ковёр', { inside: ['carpet'], whole: ['rug', 'rugs'] }],
  ['Ткань', { inside: ['fabric', 'cloth', 'cushion', 'textile', 'velvet', 'curtain', 'wool'], whole: ['felt'] }],
  ['Мрамор', { inside: ['marble'] }],
  ['Плитка', { inside: ['tile'] }],
  ['Кирпич', { inside: ['brick'] }],
  ['Бетон', { inside: ['concrete', 'cement'], tail: ['conc'] }],
  ['Камень', { inside: ['stone', 'granite'], whole: ['rock', 'rocks'] }],
  ['Золото', { inside: ['gold'] }],
  ['Металл', { inside: ['chrome', 'steel', 'metal', 'brass', 'copper'], whole: ['alu', 'iron'] }],
  ['Резина', { inside: ['rubber', 'tyre'], whole: ['tire', 'tires'] }],
  ['Пластик', { inside: ['plastic'], whole: ['plast'] }],
  ['Плакат', { inside: ['poster', 'banner', 'paper'], whole: ['card', 'cards'] }],
  ['Знак', { inside: ['logo', 'decal', 'sticker', 'label'], special: [SIGN_NOT_AFTER_DE] }],
  ['Свет', { inside: ['light', 'bulb', 'neon', 'glow', 'emis'], special: [LAMP_NOT_AFTER_C] }],
  ['Краска', { inside: ['paint'] }],
].map(([word, rule]) => [word, compileWordRule(rule)]);

const COLOUR_UNKNOWN = 'Покрытие';
const GREY_SPREAD = 0.12;
const GREY_STEPS = [[0.8, 'Белое'], [0.55, 'Светлое'], [0.25, 'Серое'], [0.1, 'Тёмное']];
const GREY_DARKEST = 'Чёрное';
// Верхняя граница тона (в градусах), слово и слово для тёмного цвета; красный замыкает круг, поэтому тона от 340 считаются отрицательными.
const HUE_BANDS = [
  [15, 'Красное'],
  [45, 'Оранжевое', 'Коричневое'],
  [70, 'Жёлтое'],
  [165, 'Зелёное'],
  [200, 'Голубое'],
  [255, 'Синее'],
  [290, 'Фиолетовое'],
];
const HUE_LAST = 'Розовое';

function colourWord(colour) {
  const text = String(colour);
  if (!COLOUR_FORMAT.test(text)) return COLOUR_UNKNOWN;
  const channels = [1, 3, 5].map((at) => parseInt(text.slice(at, at + 2), 16) / 255);
  const top = Math.max(...channels);
  const bottom = Math.min(...channels);
  const lightness = (top + bottom) / 2;
  const spread = top - bottom;
  if (spread < GREY_SPREAD) {
    const step = GREY_STEPS.find(([floor]) => lightness > floor);
    return step ? step[1] : GREY_DARKEST;
  }
  const peak = channels.indexOf(top);
  const [next, last] = [(peak + 1) % 3, (peak + 2) % 3];
  const sector = ((channels[next] - channels[last]) / spread + peak * 2) % 6;
  const hue = (sector * 60 + 360) % 360;
  const band = HUE_BANDS.find(([limit]) => (hue >= 340 ? hue - 360 : hue) < limit);
  if (!band) return HUE_LAST;
  const [, word, darkWord] = band;
  return darkWord && lightness < 0.45 ? darkWord : word;
}

export function itemElementWord(texture, colour = '') {
  const name = String(texture || '').toLowerCase();
  const rule = WORD_RULES.find(([, pattern]) => pattern.test(name));
  return rule ? rule[0] : colourWord(colour);
}

export function itemElementNames(elements) {
  const list = elements ?? [];
  const words = list.map((element) => itemElementWord(element.texture, element.colour));
  return list.map((element, at) => {
    const word = words[at];
    const total = words.filter((other) => other === word).length;
    const nth = words.slice(0, at + 1).filter((other) => other === word).length;
    return { texture: element.texture, word, index: total === 1 ? 0 : nth };
  });
}

// ---------- Ключ, элемент, список элементов, облик ----------

export function itemElementKey(name) {
  const key = textOf(name).trim().toLowerCase();
  return KEY_FORMAT.test(key) ? key : null;
}

const pictureSide = (value) => clamp(Math.round(Number(value)) || 1, 1, PICTURE_SIDE_MAX);

function colourElement(texture, value) {
  const colour = textOf(value);
  return COLOUR_FORMAT.test(colour) ? { texture, colour: colour.toLowerCase() } : null;
}

// Поля в заданном порядке; необязательное поле остаётся, только если у него есть значение.
const withoutEmpty = (fields, optionalKey) => Object.fromEntries(
  Object.entries(fields).filter(([key, value]) => key !== optionalKey || value),
);

function imageElement(texture, asset, picture, input) {
  const width = pictureSide(picture.width);
  const height = pictureSide(picture.height);
  const name = textOf(picture.name).replace(/\s+/g, ' ').trim().slice(0, PICTURE_NAME_LIMIT);
  const fit = ITEM_ELEMENT_FITS.find((candidate) => candidate === input.fit) ?? ITEM_ELEMENT_FIT;
  return withoutEmpty({
    texture,
    picture: withoutEmpty({ asset, width, height, name }, 'name'),
    fit,
    around: input.around === true,
  }, 'around');
}

export function normalizeItemElement(input) {
  const texture = isRecord(input) ? itemElementKey(input.texture) : null;
  if (texture === null) return null;
  const picture = isRecord(input.picture) ? input.picture : {};
  const asset = textOf(picture.asset);
  return PICTURE_ASSET.test(asset) ? imageElement(texture, asset, picture, input) : colourElement(texture, input.colour);
}

export function normalizeItemElements(input) {
  if (!Array.isArray(input)) return [];
  const valid = input.map((entry) => normalizeItemElement(entry)).filter(Boolean);
  // У листа остаётся самая поздняя запись, и она стоит там, где встретилась последней.
  const lastAt = new Map(valid.map((element, at) => [element.texture, at]));
  return valid
    .filter((element, at) => lastAt.get(element.texture) === at)
    .slice(-ITEM_ELEMENT_LIMIT)
    .sort((left, right) => Number(left.texture > right.texture) - Number(left.texture < right.texture));
}

export function itemElementOf(look, texture) {
  const key = look?.kind === 'elements' ? itemElementKey(texture) : null;
  if (key === null) return null;
  return look.elements.find((element) => element.texture === key) ?? null;
}

export function withItemElement(look, element) {
  const current = look?.kind === 'elements' ? look : null;
  const key = itemElementKey(element?.texture);
  if (key === null) return current;
  const remaining = current ? current.elements.filter((item) => item.texture !== key) : [];
  const replacement = element.picture || element.colour ? [{ ...element, texture: key }] : [];
  const elements = normalizeItemElements([...remaining, ...replacement]);
  return elements.length > 0 ? { kind: 'elements', elements } : null;
}

// ---------- Остров развёртки ----------

// Диапазон развёртки по одной оси: [рамка в листе, повторяется ли лист].
function sheetSpan([low, high]) {
  const base = Math.floor(low + 1e-6);
  const repeats = high - low > 1.001 || base !== Math.floor(high - 1e-6);
  return repeats ? [[0, 1], true] : [[clamp(low - base, 0, 1), clamp(high - base, 0, 1)], false];
}

// Явный ли перевес условия: площадь, где оно истинно, минус остальная больше десятой доли площади голосующих.
function leans(voters, test) {
  const [total, balance] = voters.reduce(
    ([sum, net], item) => [sum + item.area, net + (test(item) ? item.area : -item.area)],
    [0, 0],
  );
  return balance > total * VOTE_SHARE;
}

// Все треугольники с конечной развёрткой.
function sheetSamples(meshes) {
  return meshesWith(meshes, ['positions', 'uvs', 'indices'])
    .flatMap((mesh) => trianglesOf(mesh).map((corners) => ({
      mesh,
      corners,
      sheet: corners.map((index) => sheetPointOf(mesh, index)),
    })))
    .filter(({ sheet }) => sheet.flat().every(Number.isFinite));
}

// Невырожденный треугольник с весом-площадью, нормалью и производными положения по u и по v; иначе null.
function weigh({ mesh, corners, sheet }) {
  const [[ua, va], [ub, vb], [uc, vc]] = sheet;
  const determinant = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
  const [pa, pb, pc] = corners.map((index) => cornerOf(mesh.positions, index));
  const toB = minus(pb, pa);
  const toC = minus(pc, pa);
  const winding = cross(toB, toC);
  const area = lengthOf(winding) / 2;
  if (!(Math.abs(determinant) > ISLAND_EPSILON && area > ISLAND_EPSILON)) return null;

  const direction = mesh.normals ? corners.map((index) => cornerOf(mesh.normals, index)).reduce(plus) : winding;
  const size = lengthOf(direction);
  if (!(size > 0)) return null;
  return {
    area,
    normal: times(direction, 1 / size),
    alongU: times(minus(times(toB, vc - va), times(toC, vb - va)), 1 / determinant),
    alongV: times(minus(times(toC, ub - ua), times(toB, uc - ua)), 1 / determinant),
  };
}

const rightOf = (item) => [-item.normal[1], item.normal[0], 0];
// Условия, по которым голосуют площади треугольников.
const VOTES = {
  zDominates: (item) => Math.abs(item.alongU[2]) > Math.abs(item.alongV[2]),
  uRises: (item) => item.alongU[2] > 0,
  vRises: (item) => item.alongV[2] > 0,
  uLeftwards: (item) => dot(item.alongU, rightOf(item)) < 0,
  vLeftwards: (item) => dot(item.alongV, rightOf(item)) < 0,
  faceUp: (item) => dot(cross(item.alongU, item.alongV), item.normal) > 0,
};

// Зеркала и поворот развёртки относительно вещи, как они видны по голосам площадей.
function islandOrientation(items) {
  const areaOf = (list) => list.reduce((sum, item) => sum + item.area, 0);
  const upright = (item) => Math.abs(item.normal[2]) < UPRIGHT_NORMAL_Z;
  const standing = areaOf(items.filter(upright)) >= areaOf(items) / 2;
  const voters = items.filter((item) => upright(item) === standing);
  const vote = (name) => leans(voters, VOTES[name]);

  if (!standing) return { swap: false, flipU: vote('faceUp'), flipV: false };
  const swap = vote('zDominates');
  const [flipU, flipV] = swap ? [vote('uRises'), vote('vLeftwards')] : [vote('uLeftwards'), vote('vRises')];
  return { swap, flipU, flipV };
}

export function itemElementIsland(meshes) {
  const samples = sheetSamples(meshes);
  const weighted = samples.map((sample) => weigh(sample)).filter(Boolean);
  if (weighted.length === 0) return null;

  const [rectU, tiledU] = sheetSpan(span(samples.flatMap(({ sheet }) => sheet.map((point) => point[0]))));
  const [rectV, tiledV] = sheetSpan(span(samples.flatMap(({ sheet }) => sheet.map((point) => point[1]))));
  // Средние длины производных, взвешенные по площади, набираются за один проход.
  const [totalArea, weightedU, weightedV] = weighted.reduce(
    ([area, alongU, alongV], item) => [
      area + item.area,
      alongU + item.area * lengthOf(item.alongU),
      alongV + item.area * lengthOf(item.alongV),
    ],
    [0, 0, 0],
  );
  const width = (rectU[1] - rectU[0]) * (weightedU / totalArea);
  const height = (rectV[1] - rectV[0]) * (weightedV / totalArea);
  if (width <= 0 || height <= 0) return null;

  const { swap, flipU, flipV } = islandOrientation(weighted);
  return {
    rect: [rectU[0], rectV[0], rectU[1], rectV[1]],
    aspect: roundTo(swap ? height / width : width / height, 10000),
    flipU,
    flipV,
    swap,
    tiled: [tiledU, tiledV],
  };
}

// ---------- Подгонка картинки в остров ----------

const pictureRatio = (picture) => Math.max(1, Number(picture?.width) || 1) / Math.max(1, Number(picture?.height) || 1);

export function itemElementPlacement(island, picture, fit = ITEM_ELEMENT_FIT) {
  const imageRatio = pictureRatio(picture);
  const islandRatio = Math.max(island.aspect, 0) || 1;
  const fitting = islandRatio / imageRatio;
  const scaledBy = (factor) => [imageRatio * factor, factor];
  const sizeByFit = new Map([['stretch', [islandRatio, 1]], ['contain', scaledBy(Math.min(fitting, 1))]]);
  const [shownWidth, shownHeight] = sizeByFit.get(fit) ?? scaledBy(Math.max(fitting, 1));
  const [left, top, right, bottom] = island.rect;

  // Точка картинки (alpha вправо, beta вниз) — в доли листа.
  const onSheet = ([alpha, beta]) => {
    const across = (islandRatio / 2 + (alpha - 0.5) * shownWidth) / islandRatio;
    const down = 0.5 + (beta - 0.5) * shownHeight;
    const [lengthwise, crosswise] = island.swap ? [down, across] : [across, down];
    const sigma = island.flipU ? 1 - lengthwise : lengthwise;
    const tau = island.flipV ? 1 - crosswise : crosswise;
    return [left + sigma * (right - left), top + tau * (bottom - top)];
  };
  const [origin, rightEdge, downEdge] = [[0, 0], [1, 0], [0, 1]].map(onSheet);
  const offsetFrom = (point) => [point[0] - origin[0], point[1] - origin[1]];
  return { origin, u: offsetFrom(rightEdge), v: offsetFrom(downEdge) };
}

// ---------- Развёртка «в точку», плоскость, изрезанность, круглость ----------

export function itemElementCollapsed(meshes) {
  const faces = meshesWith(meshes, ['positions', 'uvs', 'indices']).flatMap((mesh) => trianglesOf(mesh).map((corners) => {
    const area = lengthOf(doubleArea(mesh, corners)) / 2;
    const [[ua, va], [ub, vb], [uc, vc]] = corners.map((index) => sheetPointOf(mesh, index));
    const sheetArea = Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va)) / 2;
    return { area, pointlike: !Number.isFinite(sheetArea) || sheetArea / area < COLLAPSED_DENSITY };
  })).filter(({ area }) => area > TINY_AREA);
  const areaOf = (list) => list.reduce((sum, face) => sum + face.area, 0);
  return areaOf(faces.filter((face) => face.pointlike)) > areaOf(faces) / 2;
}

const OFFDIAGONAL_PAIRS = [[0, 1], [0, 2], [1, 2]];

// Поворот Якоби, обнуляющий элемент (p, q): тангенс, косинус и синус угла.
function jacobiAngle(diagP, diagQ, pivot) {
  const theta = (diagQ - diagP) / (2 * pivot);
  const tangent = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
  const cosine = 1 / Math.sqrt(tangent * tangent + 1);
  return { tangent, cosine, sine: tangent * cosine };
}

// Единичный собственный вектор наименьшего собственного числа симметричной матрицы 3 × 3.
function weakestDirection(matrix) {
  const a = matrix.map((row) => [...row]);
  const vectors = AXES.map((row) => AXES.map((column) => Number(row === column)));
  for (let step = 0; step < JACOBI_STEPS; step += 1) {
    const [p, q] = OFFDIAGONAL_PAIRS.reduce((best, pair) => (
      Math.abs(a[pair[0]][pair[1]]) > Math.abs(a[best[0]][best[1]]) ? pair : best
    ));
    const pivot = a[p][q];
    if (Math.abs(pivot) < JACOBI_TOLERANCE) break;

    const { tangent, cosine, sine } = jacobiAngle(a[p][p], a[q][q], pivot);
    const other = 3 - p - q;
    const [viaP, viaQ] = [a[other][p], a[other][q]];
    a[p][p] -= tangent * pivot;
    a[q][q] += tangent * pivot;
    a[p][q] = 0;
    a[q][p] = 0;
    a[other][p] = cosine * viaP - sine * viaQ;
    a[p][other] = a[other][p];
    a[other][q] = cosine * viaQ + sine * viaP;
    a[q][other] = a[other][q];
    vectors.forEach((row) => {
      const [vp, vq] = [row[p], row[q]];
      row[p] = cosine * vp - sine * vq;
      row[q] = sine * vp + cosine * vq;
    });
  }
  const weakest = AXES.reduce((best, axis) => (a[axis][axis] < a[best][best] ? axis : best), 0);
  return vectors.map((row) => row[weakest]);
}

const planeFaces = (meshes) => meshesWith(meshes, ['positions', 'indices'])
  .flatMap((mesh) => trianglesOf(mesh).map((corners) => {
    const turn = doubleArea(mesh, corners);
    const [pa, pb, pc] = corners.map((index) => cornerOf(mesh.positions, index));
    return { area: lengthOf(turn) / 2, turn, centroid: times(plus(plus(pa, pb), pc), 1 / 3) };
  }))
  .filter((face) => face.area > TINY_AREA);

export function itemElementPlane(meshes) {
  const faces = planeFaces(meshes);
  if (faces.length === 0) return null;
  const totalArea = faces.reduce((sum, face) => sum + face.area, 0);
  const centre = times(faces.reduce((sum, face) => plus(sum, times(face.centroid, face.area)), [0, 0, 0]), 1 / totalArea);
  const offsets = faces.map((face) => minus(face.centroid, centre));
  const scatter = AXES.map((row) => AXES.map((column) => (
    faces.reduce((sum, face, at) => sum + face.area * offsets[at][row] * offsets[at][column], 0) / totalArea
  )));

  // Лицо решается перевесом граней: нормаль разворачивается, если грани смотрят в основном против неё.
  const axis = weakestDirection(scatter);
  const lean = faces.reduce((sum, face) => sum + dot(face.turn, axis), 0);
  const normal = lean < -PLANE_SIDED_SHARE * totalArea ? times(axis, -1) : axis;

  const vertical = Math.abs(normal[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const lifted = minus(vertical, times(normal, dot(vertical, normal)));
  const up = times(lifted, 1 / (lengthOf(lifted) || 1));
  const right = cross(times(normal, -1), up);

  const readings = allVertices(meshes).map((vertex) => [dot(vertex, right), dot(vertex, up), dot(vertex, normal)]);
  const [acrossSpan, upSpan, depthSpan] = AXES.map((at) => span(readings.map((reading) => reading[at])));
  const width = Math.max(acrossSpan[1] - acrossSpan[0], TINY_SIZE);
  const height = Math.max(upSpan[1] - upSpan[0], TINY_SIZE);
  const thickness = depthSpan[1] - depthSpan[0];
  const facing = faces.map((face) => Math.abs(dot(face.turn, normal)) / 2).reduce((sum, part) => sum + part, 0) / totalArea;

  return {
    normal,
    right,
    up,
    flat: thickness < 0.03 || thickness < 0.05 * width,
    rect: [acrossSpan[0], upSpan[0], acrossSpan[1], upSpan[1]],
    aspect: roundTo(width / height, 10000),
    facing: roundTo(facing, 1000),
    sided: Math.abs(lean) > PLANE_SIDED_SHARE * totalArea,
    centre,
  };
}

// Площади кусков сетки: вершины с одним положением и одной развёрткой — одна, куски связаны общими вершинами.
function meshPieces(mesh) {
  const slots = new Map();
  const slotOf = (index) => {
    const key = [...cornerOf(mesh.positions, index), ...sheetPointOf(mesh, index)].join(',');
    if (!slots.has(key)) slots.set(key, slots.size);
    return slots.get(key);
  };
  const triangles = trianglesOf(mesh).map((corners) => ({
    ids: corners.map(slotOf),
    area: lengthOf(doubleArea(mesh, corners)) / 2,
  }));

  const parent = indexes(slots.size);
  const rootOf = (id) => {
    let node = id;
    while (parent[node] !== node) node = parent[node];
    return node;
  };
  triangles.forEach(({ ids }) => {
    const anchor = rootOf(ids[0]);
    ids.slice(1).forEach((id) => {
      parent[rootOf(id)] = anchor;
    });
  });

  const pieces = new Map();
  triangles
    .filter(({ area }) => area > 0)
    .forEach(({ ids, area }) => pieces.set(rootOf(ids[0]), (pieces.get(rootOf(ids[0])) ?? 0) + area));
  return [...pieces.values()];
}

export function itemElementFragmented(meshes) {
  const pieces = meshesWith(meshes, ['positions', 'uvs', 'indices']).flatMap((mesh) => meshPieces(mesh));
  const total = pieces.reduce((sum, area) => sum + area, 0);
  const largest = pieces.reduce((best, area) => Math.max(best, area), 0);
  return pieces.length >= FRAGMENT_PIECES && largest < FRAGMENT_LARGEST_SHARE * total;
}

export function itemElementRoundness(meshes) {
  const plan = allVertices(meshes);
  if (plan.length === 0) return 0;
  const meanX = plan.reduce((sum, [x]) => sum + x, 0) / plan.length;
  const meanY = plan.reduce((sum, [, y]) => sum + y, 0) / plan.length;
  const xx = plan.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  const xy = plan.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const yy = plan.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);
  const half = (xx + yy) / 2;
  const spread = Math.sqrt(((xx - yy) / 2) ** 2 + xy ** 2);
  const major = half + spread;
  const minor = Math.max(0, half - spread);
  return major > 0 ? Math.sqrt(minor / major) : 0;
}

// ---------- Лицо, рамка, обёртка, проекция ----------

export function itemElementFront(place = null) {
  const turned = rotated(FALLBACK_FRONT, place?.rotation ?? IDENTITY_TURN);
  const flatLength = Math.hypot(turned[0], turned[1]);
  return flatLength <= TINY_SIZE ? [...FALLBACK_FRONT] : [turned[0] / flatLength, turned[1] / flatLength, 0];
}

export function itemMeshesFrame(meshes) {
  const readings = meshesWith(meshes, ['positions'])
    .flatMap((mesh) => Array.from(mesh.positions, (value, at) => [at % 3, value]));
  if (readings.length === 0) return null;
  const spans = AXES.map((axis) => span(readings.filter(([which]) => which === axis).map(([, value]) => value)));
  return { min: spans.map((pair) => pair[0]), max: spans.map((pair) => pair[1]) };
}

export function itemElementWrap(meshes, front = null, frame = null) {
  const vertices = allVertices(meshes);
  if (vertices.length === 0) return null;

  const [frontX = 0, frontY = 0] = front ?? [];
  const planar = Math.hypot(frontX, frontY);
  const forward = planar > TINY_SIZE ? [frontX / planar, frontY / planar] : [0, -1];
  const sideways = [-forward[1], forward[0]];

  // Прямоугольник обхвата в осях (вправо, вперёд): по углам рамки вещи, если она задана, иначе по вершинам.
  const sample = frame
    ? [[frame.min[0], frame.min[1]], [frame.max[0], frame.min[1]], [frame.min[0], frame.max[1]], [frame.max[0], frame.max[1]]]
    : vertices;
  const alongOf = (direction) => sample.map(([x, y]) => x * direction[0] + y * direction[1]);
  const [acrossLow, acrossHigh] = span(alongOf(sideways));
  const [aheadLow, aheadHigh] = span(alongOf(forward));
  const [bottom, top] = span(frame ? [frame.min[2], frame.max[2]] : vertices.map((vertex) => vertex[2]));
  const axes = [Math.max((acrossHigh - acrossLow) / 2, TINY_SIZE), Math.max((aheadHigh - aheadLow) / 2, TINY_SIZE)];
  return {
    kind: 'wrap',
    front: [forward[0], forward[1], 0],
    right: [sideways[0], sideways[1], 0],
    centre: [(acrossLow + acrossHigh) / 2, (aheadLow + aheadHigh) / 2],
    axes,
    bottom,
    top,
    aspect: roundTo((2 * (axes[0] + axes[1])) / Math.max(top - bottom, TINY_SIZE), 10000),
    flat: false,
  };
}

// Плоскость элемента, если его развёртка «в точку» и грани смотрят в основном в одну сторону.
function frontalPlane(meshes) {
  if (!itemElementCollapsed(meshes)) return null;
  const plane = itemElementPlane(meshes);
  return plane.facing >= PLANE_FACING_MIN ? plane : null;
}

// Обычная развёртка игры не годится: она «в точку» или изрезана, а вещь объёмная и не вытянутая в плане.
function needsWrap(meshes) {
  if (!itemElementCollapsed(meshes) && !itemElementFragmented(meshes)) return false;
  return !itemElementPlane(meshes).flat && itemElementRoundness(meshes) >= ROUNDNESS_MIN;
}

export function itemElementProjection(meshes, { front = null, frame = null, around = false, wrap = true } = {}) {
  const frontal = around ? null : frontalPlane(meshes);
  if (frontal) return frontal;
  if (!wrap || (!around && !needsWrap(meshes))) return null;

  const box = frame ?? itemMeshesFrame(meshes);
  const reach = box ? Math.max(...AXES.map((axis) => box.max[axis] - box.min[axis])) : 0;
  return reach > WRAP_SIZE_MAX ? null : itemElementWrap(meshes, front, frame);
}

// Путь вдоль периметра от середины лицевой кромки (вправо — плюс).
function perimeterPath(xi, eta, halfRight, halfAhead, full) {
  if (!(Math.abs(eta) >= Math.abs(xi))) return signOf(xi) * (halfRight + (1 - eta / Math.abs(xi)) * halfAhead);
  const along = eta === 0 ? 0 : (xi / Math.abs(eta)) * halfRight;
  return eta >= 0 ? along : signOf(along) * (full - Math.abs(along));
}

// Спереди картинка идёт слева направо, сзади зеркально — шва нет.
function wrapCoords(plane, [x, y, z]) {
  const [halfRight, halfAhead] = plane.axes;
  const full = 2 * (halfRight + halfAhead);
  const xi = (x * plane.right[0] + y * plane.right[1] - plane.centre[0]) / halfRight;
  const eta = (x * plane.front[0] + y * plane.front[1] - plane.centre[1]) / halfAhead;
  const path = perimeterPath(xi, eta, halfRight, halfAhead, full);
  const visible = Math.abs(path) <= full / 2 ? path : signOf(path) * (full - Math.abs(path));
  return [0.5 + visible / full, (plane.top - z) / Math.max(plane.top - plane.bottom, TINY_SIZE)];
}

function planeCoords(plane, point) {
  const width = Math.max(plane.rect[2] - plane.rect[0], TINY_SIZE);
  const height = Math.max(plane.rect[3] - plane.rect[1], TINY_SIZE);
  return [(dot(point, plane.right) - plane.rect[0]) / width, (plane.rect[3] - dot(point, plane.up)) / height];
}

export function itemElementProjectedUvs(meshes, plane) {
  return (meshes ?? []).map((mesh) => {
    const { positions } = mesh;
    const sheet = new Float32Array((positions.length / 3) * 2);
    indexes(Math.floor(positions.length / 3)).forEach((vertex) => {
      const point = cornerOf(positions, vertex);
      sheet.set(plane.kind === 'wrap' ? wrapCoords(plane, point) : planeCoords(plane, point), vertex * 2);
    });
    return sheet;
  });
}

export function itemElementProjectedIsland(plane) {
  return {
    rect: [0, 0, 1, 1],
    aspect: plane.aspect,
    ...Object.fromEntries(['flipU', 'flipV', 'swap'].map((flag) => [flag, false])),
    tiled: [false, false],
  };
}

// ---------- Сетки на месте вещи ----------

export function itemElementMeshesPlaced(meshes, place) {
  if (!place?.rotation) return meshes;
  const [planeScale, heightScale] = place.scale ?? [1, 1];
  const transformed = (values, prepare) => {
    if (values.length % 3 !== 0) throw new RangeError('Invalid typed array length');
    return Float64Array.from(indexes(values.length / 3).flatMap((at) => rotated(prepare(cornerOf(values, at)), place.rotation)));
  };
  return meshes.map((mesh) => ({
    ...mesh,
    positions: transformed(mesh.positions, ([x, y, z]) => [x * planeScale, y * planeScale, z * heightScale]),
    normals: mesh.normals ? transformed(mesh.normals, ([x, y, z]) => [x / planeScale, y / planeScale, z / heightScale]) : null,
  }));
}
