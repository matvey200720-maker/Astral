import { radarRectView } from "./radar-rect.js";
import { MAP_CONTEXT, createBasePass, takeBuildFailures } from "./base-pass.js";
import { effectsStyle } from "./base-effects.js";
import { colourRgb, radarMesh } from "./radar-mesh.js";
import { roleColour } from "./flat-base.js";
import { applyColorMap, packColorOverrides, terrainStyle, atlasSize, normalizeAtlas } from "@modovik/vector-map";

export const PACK_SUPERSAMPLE = 2;
export const PACK_TILE = 512;

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const REASON_LIMIT = 400;
const EFFECTS_REFUSAL =
  "подложка с эффектами, которых GPU не рисует (биомы, рельеф, кромки, подгонка цвета) или масштаб меньше 1";

const refuse = (reason) => ({ reason });
const NO_GL = refuse("нет WebGL2: контекст холста не создан");
const NO_SNAPSHOT = refuse("холст не отдал снимок");

const clip = (text) => text.slice(0, REASON_LIMIT);
const drawingFailed = (error) => refuse(`ошибка рисования: ${error?.message ?? String(error)}`);
const roundAll = (values) => values.map((value) => Math.round(value));

// Ответ с картинкой: пустой снимок — отказ; доп. поля идут после blob.
const delivered = (blob, extra) => (blob ? { blob, ...extra } : NO_SNAPSHOT);

// Первая сработавшая причина из пар «условие, текст» либо null.
function firstRefusal(pairs) {
  const hit = pairs.find(([failed]) => failed);
  return hit ? refuse(hit[1]) : null;
}

function documentCanvas(width, height) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width, height });
  return canvas;
}

// toBlob зовётся сразу, пока буфер холста ещё жив: промис создаётся синхронно.
const photograph = (canvas) =>
  new Promise((done) => {
    canvas.toBlob(done, "image/png");
  });

export function toneColour(hex, colorMap) {
  if (!colorMap) return hex;
  const channels = [[1, 3], [3, 5], [5, 7]].map(([from, to]) => parseInt(hex.slice(from, to), 16));
  const pixel = Uint8ClampedArray.of(...channels, 255);
  applyColorMap(pixel, colorMap);
  const digits = Array.from(pixel.slice(0, 3), (value) => value.toString(16).padStart(2, "0"));
  return "#" + digits.join("");
}

const meshByGeometry = new WeakMap();

function meshOf(geometry, atlas) {
  if (!meshByGeometry.has(geometry)) meshByGeometry.set(geometry, radarMesh(geometry, atlas));
  return meshByGeometry.get(geometry);
}

export function flatMesh({ geometry, atlas, style, colorMap }) {
  const mesh = meshOf(geometry, atlas);
  const kept = [];
  const allValid = mesh.groups.every((group) => {
    const colour = roleColour(style, group.role, group.depth);
    if (colour == null) return true;
    if (!HEX_COLOUR.test(colour)) return false;
    kept.push({ ...group, colour: colourRgb(toneColour(colour, colorMap)) });
    return true;
  });
  if (!allValid || kept.length === 0) return null;
  return { data: mesh.data, groups: kept, vertices: mesh.vertices };
}

// Отсчёты вдоль стороны: шаг tile, пока координата меньше размера.
function* offsets(limit, tile) {
  for (let at = 0; at < limit; at += tile) yield at;
}

export function packTiles(width, height, tile = PACK_TILE) {
  return [...offsets(height, tile)].flatMap((y) =>
    [...offsets(width, tile)].map((x) => ({
      x,
      y,
      width: Math.min(tile, width - x),
      height: Math.min(tile, height - y),
    })));
}

// Почему flatMesh отказал: первая группа с цветом не в виде #rrggbb либо «все слои спрятаны».
function meshRefusal(geometry, atlas, style) {
  const offender = meshOf(geometry, atlas)
    .groups.map(({ role, depth }) => ({ role, colour: roleColour(style, role, depth) }))
    .find(({ colour }) => colour != null && !HEX_COLOUR.test(colour));
  if (!offender) return "нет ролей с цветом";
  return `цвет роли не в виде #rrggbb: ${offender.role} = ${offender.colour}`;
}

// Плоская подложка: заливка ролей без эффектов, без целей.
async function paintFlat(canvas, mesh, view) {
  if (!canvas.getContext("webgl2", MAP_CONTEXT)) return NO_GL;
  const pass = createBasePass(canvas);
  if (!pass) return refuse(clip(`программа не собралась: ${takeBuildFailures()}`));
  const opaque = mesh.groups.map(({ first, count, colour }) => {
    return { first, count, colour, alpha: 1 };
  });
  pass.drawPack({ data: mesh.data, groups: opaque, view });
  return delivered(await photograph(canvas));
}

// До трёх попыток собрать программы (плоская кэшируется контекстом, эффектов — каждый раз заново).
function assemblePass(canvas) {
  const notes = [];
  const attempt = () => {
    const pass = createBasePass(canvas);
    if (pass && pass.ensureEffects()) return pass;
    notes.push(takeBuildFailures());
    return null;
  };
  const pass = [attempt, attempt, attempt].reduce((found, next) => found || next(), null);
  if (pass) return { pass };
  return { failure: refuse(clip(`программа эффектов не собралась: ${notes.join(" | ")}`)) };
}

function strokesFor({ roadHalfWorld: half, style }) {
  if (!half) return null;
  return {
    freeway: { half: half.freeway, colour: colourRgb(style.freeway) },
    roads: { half: half.roads, colour: colourRgb(style.roads) },
  };
}

function effectParams(fx, world) {
  const blurKeys = ["waterBlur", "glowBlur", "outlineWorld"];
  const blurs = Object.fromEntries(blurKeys.map((key) => [key, fx[key]]));
  return {
    ...blurs,
    worldSize: [world.width, world.height],
    glowColour: colourRgb(fx.glowColour),
    outlineColour: colourRgb(fx.style.outline),
    roadStrokes: strokesFor(fx),
    landColour: colourRgb(fx.style.land),
  };
}

async function paintEffects(canvas, mesh, view, fx, world) {
  if (!canvas.getContext("webgl2", MAP_CONTEXT)) return NO_GL;
  const { pass, failure } = assemblePass(canvas);
  if (failure) return failure;

  const { style } = fx;
  const roadsPlain = HEX_COLOUR.test(style.freeway) && HEX_COLOUR.test(style.roads);
  const badColour = firstRefusal([
    [!HEX_COLOUR.test(style.outline), "цвет обводки не в виде #rrggbb"],
    [fx.roadHalfWorld && !roadsPlain, "цвет магистрали или дороги не в виде #rrggbb"],
  ]);
  if (badColour) return badColour;

  const params = effectParams(fx, world);
  const { bytes } = pass.draw({ data: mesh.data, groups: mesh.groups, view, params });
  const blob = await photograph(canvas);
  pass.dispose();
  return delivered(blob, { bytes });
}

const isPlainFrame = (fx) =>
  [fx.waterBlur, fx.glowBlur, fx.outlineWorld].every((amount) => amount === 0) &&
  fx.roadHalfWorld === null;

// Доли атласа для тайла: те же, что у куска, сдвинутые и урезанные по тайлу.
function tilePart(rect, tile, outSize) {
  const [outWidth, outHeight] = outSize;
  return {
    u: rect.u + rect.width * (tile.x / outWidth),
    v: rect.v + rect.height * (tile.y / outHeight),
    width: rect.width * (tile.width / outWidth),
    height: rect.height * (tile.height / outHeight),
  };
}

// Цвет и прозрачность каждой группы пака по порядку (null — группа не рисуется).
function packLooks(geometry, base, colorMap) {
  const overrides = packColorOverrides(geometry, base);
  const hiddenLayers = Array.isArray(base?.hidden) ? base.hidden : [];
  const dropWater = hiddenLayers.includes("water");
  return geometry.groups.map((group) => {
    if (dropWater && group.height < -1) return null;
    const raw = overrides?.get(group) ?? group.color;
    if (!HEX_COLOUR.test(raw)) return null;
    return { colour: colourRgb(toneColour(raw, colorMap)), alpha: group.alpha ?? 1 };
  });
}

async function renderPack(request) {
  const { geometry, atlas, base, colorMap, rect, width, height } = request;
  if (terrainStyle(base)) return refuse("рельеф пака: растр");

  const looks = packLooks(geometry, base, colorMap);
  const mesh = meshOf(geometry, atlas);
  const layers = looks.flatMap((look, index) => {
    if (!look) return [];
    const { first, count } = mesh.groups[index];
    return [{ first, count, ...look }];
  });

  const { packTile, canvasFactory, output } = request;
  const factor = request.supersample > 1 ? request.supersample : 1;
  const outSize = roundAll([width, height]);
  const tiles = packTiles(...outSize, packTile);
  const canvas = canvasFactory(...outSize.map((side) => Math.min(packTile, side) * factor));
  if (!canvas.getContext("webgl2", MAP_CONTEXT)) return NO_GL;
  const pass = createBasePass(canvas);
  if (!pass) return refuse(clip(`программа прохода не собралась: ${takeBuildFailures()}`));

  const shrunk = output(...outSize);
  const ctx = shrunk.getContext?.("2d");
  if (!ctx) return refuse("уменьшение суперсэмплинга: нет 2D-контекста");
  Object.assign(ctx, { imageSmoothingEnabled: true, imageSmoothingQuality: "high" });

  // Тайл рисуется и сразу копируется: между drawPack и drawImage нет ожиданий.
  const paintTile = (tile) => {
    const area = { width: tile.width * factor, height: tile.height * factor };
    const view = radarRectView(tilePart(rect, tile, outSize));
    const { bytes } = pass.drawPack({ data: mesh.data, groups: layers, view, size: area });
    // Область рисования GL — нижний левый угол холста, отсюда вертикальный сдвиг.
    const fromTop = canvas.height - area.height;
    ctx.drawImage(
      canvas, 0, fromTop, area.width, area.height, tile.x, tile.y, tile.width, tile.height,
    );
    return bytes;
  };

  try {
    const peak = Math.max(0, ...tiles.map(paintTile));
    const blob = await photograph(shrunk);
    return delivered(blob, { bytes: peak + outSize[0] * outSize[1] * 4 });
  } catch (error) {
    return drawingFailed(error);
  }
}

async function renderVector(request) {
  const { geometry, atlas, base, rect, width, height, canvasFactory } = request;
  try {
    const world = atlasSize(normalizeAtlas(atlas));
    const fx = effectsStyle(base, width / (rect.width * world.width));
    if (!fx) return refuse(EFFECTS_REFUSAL);
    const mesh = flatMesh({ geometry, atlas, style: fx.style, colorMap: null });
    if (!mesh) return refuse(meshRefusal(geometry, atlas, fx.style));

    const canvas = canvasFactory(...roundAll([width, height]));
    const view = radarRectView(rect);
    const paint = isPlainFrame(fx) ? paintFlat : paintEffects;
    return await paint(canvas, mesh, view, fx, world);
  } catch (error) {
    return drawingFailed(error);
  }
}

// Подстановка умолчаний только на undefined (null остаётся как есть).
function withDefaults(options) {
  const resolved = { ...options };
  const defaults = {
    canvasFactory: documentCanvas,
    supersample: PACK_SUPERSAMPLE,
    packTile: PACK_TILE,
    output: documentCanvas,
  };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (resolved[key] === undefined) resolved[key] = fallback;
  }
  return resolved;
}

export async function renderBaseDetailGpu(options) {
  const { geometry, colorMap, textured = false, rect, width, height } = options;
  const early = firstRefusal([
    [!geometry?.groups?.length, "нет геометрии радара"],
    [!(width > 0 && height > 0 && rect?.width > 0), "пустой кусок"],
    [textured, "текстурный слой"],
  ]);
  if (early) return early;

  const request = withDefaults(options);
  if (geometry.kind === "pack") return renderPack(request);

  const late = firstRefusal([
    [!geometry.groups.some((group) => group.role), "геометрия без ролей радара: растр"],
    [colorMap, "таблица цвета подложки"],
  ]);
  return late || renderVector(request);
}
