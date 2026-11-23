import {
  applyColorMap,
  atlasSize,
  classifyRadarColour,
  hexToRgb,
  normalizeAtlas,
  packBand,
  packColorOverrides,
  packElementOf,
  packElements,
  PAUSE_MAP_GAME_SEA,
  vectorBaseStyle,
  waterColorAt,
} from "@modovik/vector-map";

export const RADAR_STOCK_LAND = "#1d1d1d";

export const READABLE = Object.freeze(
  Object.fromEntries([
    ["line", 0.28],
    ["paths", 0.2],
    ["blocks", 0.05],
    ["blocksFromLine", 0.12],
    ["coast", 0.08],
  ]),
);

export const RADAR_LINE_ROLES = Object.freeze("paths freeway roads rail".split(" "));

const DENSE_SAMPLING = 4;
const SPARSE_SAMPLING = 1;
const SPARSE_ABOVE = 400000;
const MIN_SAMPLES = 12;
const TRIM_SHARE = 0.1;
const HIST_CELLS = 256;
const SEA_STEPS = 20;
const STYLE_ROLES = ["land", "blocks", "paths", "freeway", "roads", "rail"];

// Элемент таблицы пака на полосе дорог -> роль радара (остальные элементы не дороги).
const ROAD_ROLE_OF_ELEMENT = new Map([
  ["roads", "roads"],
  ["freeway", "freeway"],
  ["dirt", "paths"],
  ["trails", "paths"],
  ["rail", "rail"],
]);

// Чего не хватает у набора ролей и из чего это достраивается (порядок важен).
const ROLE_FILLERS = [
  ["blocks", (roles) => roles.land],
  ["roads", (roles) => roles.land],
  ["freeway", (roles) => roles.roads],
  ["paths", (roles) => blendRgb(roles.roads, roles.land, 0.45)],
  ["rail", (roles) => blendRgb(roles.roads, roles.freeway, 0.5)],
];

const PALETTE_SOURCE = /^[0-9A-F]{8}$/;
const PAIR_LINE = /^([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})=([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})$/;

function lightOf(rgb) {
  const weighted = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return weighted / 255;
}

function clampTo(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function blendRgb(from, to, share) {
  return from.map(function (v, i) {
    return v + (to[i] - v) * share;
  });
}

function bytesOf(hex) {
  return hex
    .match(/../g)
    .slice(0, 3)
    .map((pair) => parseInt(pair, 16));
}

function emptyResult(reason) {
  const result = { pairs: [] };
  result.reason = reason;
  return result;
}

function pairsResult(complete, palette) {
  const pairs = radarPairs(complete, palette);
  const reason = pairs.length === 0 ? "unchanged" : "";
  return { pairs, reason };
}

const byDepth = (a, b) => a.depth - b.depth;

function hexByte(v) {
  const text = Math.round(Math.min(255, Math.max(0, v))).toString(16);
  return (text.length < 2 ? `0${text}` : text).toUpperCase();
}

export function rgbHex(rgb) {
  return rgb.map(hexByte).join("");
}

export function withLuma(rgb, target) {
  const now = lightOf(rgb);
  if (Math.abs(target - now) < 0.0001) return rgb;
  const lighter = target > now;
  const goal = lighter ? [255, 255, 255] : [0, 0, 0];
  const share = lighter ? (target - now) / (1 - now) : (now - target) / now;
  return blendRgb(rgb, goal, share);
}

// ---------------------------------------------------------------------------
// Образцы цвета с картинки под вершинами радара

function triangleTotal(groups) {
  let sum = 0;
  groups.forEach((group) => {
    sum += Math.floor(group.positions.length / 6);
  });
  return sum;
}

// Положение мировой точки на атласе в долях 0…1 по каждой оси.
function unitPosition(frame, span, x, y) {
  return { u: (x - frame.originX) / span.width, v: (frame.originY - y) / span.height };
}

// Буферы выделяются целиком под все треугольники; в них копятся только попавшие в атлас образцы.
function createSampleBuffer(capacity, frame, picture) {
  const span = atlasSize(frame);
  const buffer = {
    pixels: new Uint8ClampedArray(capacity * 4),
    owners: new Uint16Array(capacity),
    used: 0,
  };
  function add(x, y, owner) {
    const { u, v } = unitPosition(frame, span, x, y);
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return;
    const row = Math.floor(v * picture.height);
    const col = Math.floor(u * picture.width);
    copyPixel(picture.data, (row * picture.width + col) * 4, buffer.pixels, buffer.used * 4);
    buffer.owners[buffer.used] = owner;
    buffer.used += 1;
  }
  buffer.add = add;
  return buffer;
}

function copyPixel(data, source, pixels, target) {
  pixels[target] = data[source];
  pixels[target + 1] = data[source + 1];
  pixels[target + 2] = data[source + 2];
  pixels[target + 3] = data[source + 3];
}

const halfwayTo = (centre, vertex) => centre + (vertex - centre) * 0.5;

function sampleTriangle(flat, from, dense, take) {
  const [x1, y1, x2, y2, x3, y3] = [0, 1, 2, 3, 4, 5].map((k) => flat[from + k]);
  const cx = (x1 + x2 + x3) / 3;
  const cy = (y1 + y2 + y3) / 3;
  take(cx, cy);
  if (!dense) return;
  take(halfwayTo(cx, x1), halfwayTo(cy, y1));
  take(halfwayTo(cx, x2), halfwayTo(cy, y2));
  take(halfwayTo(cx, x3), halfwayTo(cy, y3));
}

function collectSamples(groups, frame, picture, total) {
  const dense = !(total > SPARSE_ABOVE);
  const buffer = createSampleBuffer(total * (dense ? DENSE_SAMPLING : SPARSE_SAMPLING), frame, picture);
  groups.forEach((group, owner) => {
    const take = (x, y) => buffer.add(x, y, owner);
    const flat = group.positions;
    const count = Math.floor(flat.length / 6);
    for (let t = 0; t < count; t += 1) sampleTriangle(flat, t * 6, dense, take);
  });
  return buffer;
}

// Гистограмма «байта светлоты»: на ячейку четыре числа (сколько, сумма R, G, B).
function createBin(group) {
  return {
    role: group.role,
    depth: group.depth || 0,
    cells: new Float64Array(HIST_CELLS * 4),
  };
}

// Корзина на роль; у воды своя корзина на каждую группу (у ступени своя глубина).
function binSet(groups) {
  const created = new Map();
  const byOwner = [];
  return {
    forOwner(owner) {
      if (byOwner[owner]) return byOwner[owner];
      const group = groups[owner];
      const key = group.role === "water" ? group : group.role;
      if (!created.has(key)) created.set(key, createBin(group));
      byOwner[owner] = created.get(key);
      return byOwner[owner];
    },
    all: () => [...created.values()],
  };
}

function blendWithSea(pixels, at, seaRgb) {
  const alpha = pixels[at + 3] / 255;
  return [0, 1, 2].map((k) => pixels[at + k] * alpha + seaRgb[k] * (1 - alpha));
}

function addToCell(cells, cell, mixed) {
  cells[cell] += 1;
  cells[cell + 1] += mixed[0];
  cells[cell + 2] += mixed[1];
  cells[cell + 3] += mixed[2];
}

function binSamples(groups, buffer, seaRgb) {
  const bins = binSet(groups);
  for (let i = 0; i < buffer.used; i += 1) {
    const mixed = blendWithSea(buffer.pixels, i * 4, seaRgb);
    const cell = ((mixed[0] * 54 + mixed[1] * 183 + mixed[2] * 19) >> 8) * 4;
    addToCell(bins.forOwner(buffer.owners[i]).cells, cell, mixed);
  }
  return bins.all();
}

// Усечённое среднее: по десятой доле самых тёмных и самых светлых образцов отбрасывается.
function trimmedColour(cells) {
  const counts = Array.from({ length: HIST_CELLS }, (_, c) => cells[c * 4]);
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total < MIN_SAMPLES) return null;

  const lower = total * TRIM_SHARE;
  const upper = total * (1 - TRIM_SHARE);
  const sums = [0, 0, 0];
  let seen = 0;
  let weight = 0;
  for (const [c, n] of counts.entries()) {
    if (seen >= upper) break;
    if (n === 0) continue;
    const start = seen;
    seen = start + n;
    const share = (Math.min(seen, upper) - Math.max(start, lower)) / n;
    if (share <= 0) continue;
    weight += n * share;
    sums.forEach((_, k) => {
      sums[k] += cells[c * 4 + 1 + k] * share;
    });
  }
  if (weight === 0) return null;
  const average = (sum) => sum / weight;
  return { color: sums.map(average), total };
}

function summariseBins(bins) {
  const parts = bins.reduce(
    (acc, bin) => {
      const trimmed = trimmedColour(bin.cells);
      if (trimmed) (bin.role === "water" ? acc.water : acc.dry).push([bin, trimmed]);
      return acc;
    },
    { dry: [], water: [] },
  );

  const roles = {};
  for (const [bin, trimmed] of parts.dry) roles[bin.role] = trimmed.color;
  const stageOf = ([bin, trimmed]) => ({
    depth: bin.depth,
    color: trimmed.color,
    weight: trimmed.total,
  });
  return { roles, water: parts.water.map(stageOf).sort(byDepth) };
}

const hasPictureData = (picture) =>
  Boolean(picture && picture.data && picture.width && picture.height);

export function sampleRadarRoles({
  geometry,
  atlas,
  picture,
  colorMap = null,
  sea = PAUSE_MAP_GAME_SEA,
}) {
  const groups = geometry && geometry.groups;
  if (!Array.isArray(groups) || !groups.length || !hasPictureData(picture)) return null;

  const buffer = collectSamples(groups, normalizeAtlas(atlas), picture, triangleTotal(groups));
  if (buffer.used === 0) return null;

  if (colorMap) applyColorMap(buffer.pixels.subarray(0, buffer.used * 4), colorMap);
  return summariseBins(binSamples(groups, buffer, hexToRgb(sea)));
}

// ---------------------------------------------------------------------------
// Цвета ролей готового пака

// Группа пака -> { weight, color, band } либо null, если её нужно пропустить.
function weighPackGroup(group, overrides) {
  if ((group.alpha ?? 1) < 0.5) return null;
  const weight = group.positions.length / 6;
  if (!weight) return null;
  const color = hexToRgb((overrides && overrides.get(group)) || group.color);
  return { group, weight, color, band: packBand(group.height) };
}

// Роль группы: вода / суша / кварталы / одна из дорожных ролей, либо null (не дорога).
function packRole(item, elements) {
  const { band, group } = item;
  if (band === "water" || band === "land" || band === "blocks") return band;
  if (elements.length === 0) return "roads";
  const hit = packElementOf(elements, group);
  return hit && hit.own ? ROAD_ROLE_OF_ELEMENT.get(hit.element.id) ?? null : null;
}

// Глубина ступени пака по её светлоте: самая светлая — 0, самая тёмная — 1.
function depthOfLight(light, brightest, darkest) {
  if (!(brightest > darkest)) return 0;
  const ratio = (brightest - light) / (brightest - darkest);
  return Math.round(ratio * 1000) / 1000;
}

// Две ступени одной глубины сливаются в одну: цвет — среднее по весам.
function blendStages(old, stage) {
  const sum = old.weight + stage.weight;
  const color = old.color.map((v, k) => (v * old.weight + stage.color[k] * stage.weight) / sum);
  return { depth: old.depth, color, weight: sum };
}

function mergePackWater(stages) {
  if (stages.length === 0) return [];
  const lights = stages.map((stage) => stage.light);
  const brightest = Math.max(...lights);
  const darkest = Math.min(...lights);
  const merged = stages.reduce((byLevel, stage) => {
    const depth = depthOfLight(stage.light, brightest, darkest);
    const old = byLevel.get(depth);
    const next = old
      ? blendStages(old, stage)
      : { depth, color: [...stage.color], weight: stage.weight };
    return byLevel.set(depth, next);
  }, new Map());
  return [...merged.values()].sort(byDepth);
}

const meanColour = (slot) => slot.sums.map((s) => s / slot.weight);

export function packRadarRoles(geometry, base) {
  const groups = geometry && geometry.groups;
  if (!Array.isArray(groups) || groups.length === 0) return null;

  const overrides = packColorOverrides(geometry, base);
  const elements = base && base.source === "template" ? packElements(base.templateId) : [];
  const items = groups.map((group) => weighPackGroup(group, overrides)).filter(Boolean);

  const dry = new Map();
  const stages = [];
  items.forEach((item) => {
    const role = packRole(item, elements);
    if (role === "water") {
      stages.push({ color: item.color, weight: item.weight, light: lightOf(item.color) });
    } else if (role) {
      const slot = dry.get(role) ?? { weight: 0, sums: [0, 0, 0] };
      slot.weight += item.weight;
      slot.sums = slot.sums.map((s, k) => s + item.color[k] * item.weight);
      dry.set(role, slot);
    }
  });

  const roles = {};
  for (const [role, slot] of dry) roles[role] = meanColour(slot);
  return { roles, water: mergePackWater(stages) };
}

// ---------------------------------------------------------------------------
// Защита читаемости

function completeRoles(input, sea) {
  const land = input && input.roles && input.roles.land;
  if (!land) return null;

  const roles = { ...input.roles };
  ROLE_FILLERS.forEach(([name, make]) => {
    roles[name] = roles[name] || make(roles);
  });
  const given = input.water;
  const fallback = [0, 1].map((depth) => ({ depth, color: hexToRgb(sea), weight: 1 }));
  return { roles, water: given.length ? given : fallback };
}

// Ступени воды не светлеют с глубиной: нарушители сливаются в блок со средней светлотой.
function mergeBlocks(below, top) {
  const weight = below.weight + top.weight;
  const light = (below.light * below.weight + top.light * top.weight) / weight;
  return { light, weight, first: below.first, last: top.last };
}

function settleWater(stages) {
  const blocks = stages.reduce((stack, stage, index) => {
    let top = { light: lightOf(stage.color), weight: stage.weight, first: index, last: index };
    while (stack.length > 0 && stack[stack.length - 1].light < top.light) {
      top = mergeBlocks(stack.pop(), top);
    }
    stack.push(top);
    return stack;
  }, []);

  const lightOfStage = new Array(stages.length);
  blocks.forEach((block) => lightOfStage.fill(block.light, block.first, block.last + 1));
  return stages.map((stage, at) => ({ ...stage, color: withLuma(stage.color, lightOfStage[at]) }));
}

// Сколько светлоты остаётся от суши в сторону direction (+1 светлее, -1 темнее).
const roomToward = (direction, land) => (direction > 0 ? 1 - land : land);
const fits = (direction, land, need) => roomToward(direction, land) >= need;
const darkerIsDefault = (land) => (land < 0.5 ? 1 : -1);

// Дороги идут от суши в ту сторону, где они уже лежат (вплотную — туда, где больше места).
function roadsSide(land, roadsLight, need) {
  const gap = roadsLight - land;
  const wanted = Math.abs(gap) >= 0.01 ? Math.sign(gap) : darkerIsDefault(land);
  return fits(wanted, land, need) ? wanted : -wanted;
}

// Отодвигает линию от суши; возвращает сдвиг либо null, если линия по другую сторону.
function pushLine(roles, name, land, side, limits) {
  const need = name === "paths" ? limits.paths : limits.line;
  let shift = (lightOf(roles[name]) - land) * side;
  if (shift <= -need) return null;
  shift = shift < need ? need : shift;
  roles[name] = withLuma(roles[name], clampTo(land + side * shift, 0, 1));
  return shift;
}

function separateBlocks(roles, land, side, limits, shifts) {
  let block = (lightOf(roles.blocks) - land) * side;
  block = Math.abs(block) < limits.blocks ? limits.blocks : block;
  if (block > 0 && shifts.length > 0) {
    const smallest = Math.min(...shifts);
    const ceiling = Math.max(limits.blocks, smallest - limits.blocksFromLine);
    block = clampTo(block, limits.blocks, ceiling);
  }
  roles.blocks = withLuma(roles.blocks, clampTo(land + side * block, 0, 1));
}

// Береговая черта: мелководье не должно сливаться с сушей.
function parkCoast(water, land, limits) {
  const shallow = lightOf(water[0].color);
  const coast = shallow - land;
  if (!(Math.abs(coast) < limits.coast)) return water;

  const direction = Math.sign(coast) || darkerIsDefault(land);
  const bankSide = fits(direction, land, limits.coast) ? direction : -direction;
  const offset = land + bankSide * limits.coast - shallow;
  const shifted = (stage) => {
    const target = clampTo(lightOf(stage.color) + offset, 0, 1);
    return { ...stage, color: withLuma(stage.color, target) };
  };
  return settleWater(water.map(shifted));
}

export function readableRadarRoles(sampled, { sea = PAUSE_MAP_GAME_SEA, limits = READABLE } = {}) {
  const complete = completeRoles(sampled, sea);
  if (!complete) return null;

  const roles = complete.roles;
  const land = lightOf(roles.land);
  const roadsLight = lightOf(roles.roads);
  const side = roadsSide(land, roadsLight, limits.line);
  const shifts = RADAR_LINE_ROLES.map((name) => pushLine(roles, name, land, side, limits)).filter(
    (shift) => shift !== null,
  );
  separateBlocks(roles, land, side, limits, shifts);

  const water = parkCoast(settleWater(complete.water), land, limits);
  return { roles, water };
}

// ---------------------------------------------------------------------------
// Пары «было=стало»

// Цвет воды заданной глубины между ступенями (список ступеней упорядочен по глубине).
function colourBetween(near, far, depth) {
  const span = far.depth - near.depth;
  if (!(span > 0)) return far.color;
  return blendRgb(near.color, far.color, (depth - near.depth) / span);
}

function waterAt(stages, depth) {
  const [first, last] = [stages[0], stages[stages.length - 1]];
  if (depth <= first.depth) return first.color;
  if (depth >= last.depth) return last.color;

  const at = stages.findIndex((stage, i) => i > 0 && stage.depth >= depth);
  return at < 0 ? last.color : colourBetween(stages[at - 1], stages[at], depth);
}

const colourOfRole = (complete, role, depth) =>
  role === "water" ? waterAt(complete.water, depth) : complete.roles[role];

function pairFor(complete, entry) {
  const from = String((entry && entry.rgba) || "").toUpperCase();
  if (!PALETTE_SOURCE.test(from)) return null;
  const { role, depth } = classifyRadarColour(...bytesOf(from), 0);
  const color = colourOfRole(complete, role, depth);
  if (!color) return null;
  const to = rgbHex(color) + "FF";
  return to === from ? null : from + "=" + to;
}

export function radarPairs(complete, palette) {
  if (!Array.isArray(palette)) return [];
  return palette.map((entry) => pairFor(complete, entry)).filter((pair) => pair !== null);
}

// Строка пары суши радара: { source, target } либо null.
function landPair(item) {
  const parsed = PAIR_LINE.exec(String(item || ""));
  if (!parsed) return null;
  const [r, g, b] = bytesOf(parsed[1]);
  if (classifyRadarColour(r, g, b, 0).role !== "land") return null;
  return { source: "#" + parsed[1].toLowerCase(), target: "#" + parsed[3].toLowerCase() };
}

export function radarLandColour(pairs) {
  if (!Array.isArray(pairs)) return RADAR_STOCK_LAND;
  const lands = pairs.map(landPair).filter(Boolean);
  const chosen = lands.find((land) => land.source === RADAR_STOCK_LAND) ?? lands[0];
  return chosen ? chosen.target : RADAR_STOCK_LAND;
}

// ---------------------------------------------------------------------------
// Итоговые ответы по источникам цвета

function retone(rgb, colorMap) {
  const pixel = Uint8ClampedArray.of(rgb[0], rgb[1], rgb[2], 255);
  applyColorMap(pixel, colorMap);
  return Array.from(pixel.subarray(0, 3));
}

export function toneRoles(complete, colorMap) {
  if (!colorMap) return complete;
  const tone = (color) => retone(color, colorMap);
  const toned = Object.entries(complete.roles).map(([name, color]) => [name, tone(color)]);
  const water = complete.water.map((stage) => ({ ...stage, color: tone(stage.color) }));
  return { roles: Object.fromEntries(toned), water };
}

export function radarFromPicture({
  picture,
  geometry,
  palette,
  atlas,
  colorMap = null,
  sea = PAUSE_MAP_GAME_SEA,
}) {
  const missing = !picture ? "no-picture" : geometry?.groups?.length ? null : "no-geometry";
  if (missing) return emptyResult(missing);

  const sampled = sampleRadarRoles({ geometry, atlas, picture, colorMap, sea });
  const readable = sampled ? readableRadarRoles(sampled, { sea }) : null;
  if (!readable) return emptyResult("no-colours");
  return pairsResult(readable, palette);
}

export function radarFromPack({
  base,
  geometry,
  palette,
  colorMap = null,
  sea = PAUSE_MAP_GAME_SEA,
}) {
  const hasTable = base?.source === "template" && packElements(base.templateId).length > 0;
  if (!hasTable) return emptyResult("no-table");

  const packed = packRadarRoles(geometry, base);
  const complete = packed ? completeRoles(packed, sea) : null;
  if (!complete) return emptyResult("no-colours");
  return pairsResult(toneRoles(complete, colorMap), palette);
}

export function radarFromStyle({ base, palette, colorMap }) {
  const style = vectorBaseStyle(base);
  const roles = {};
  for (const name of STYLE_ROLES) roles[name] = hexToRgb(style[name]);
  const water = Array.from({ length: SEA_STEPS + 1 }, (_, step) => {
    const depth = step / SEA_STEPS;
    return { depth, color: hexToRgb(waterColorAt(style, depth)), weight: 1 };
  });
  return pairsResult(toneRoles({ roles, water }, colorMap), palette);
}
