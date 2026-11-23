import { workshopFallbackMediaBySlot } from "../../../workshop-visuals.js";
import {
  mapTemplateSource,
  loadMapTemplateGeometry,
  loadBundledRadarGeometry,
} from "../../../components/desktop/workshop/world-map-templates.js";
import { createMapBaseProcessor, baseRasterKey } from "../../../components/desktop/workshop/world-map-base.js";
import { baseRendersVector, baseRasterActive, MAP_TEMPLATE_MAP, DEFAULT_ATLAS } from "@modovik/vector-map";

export const WORLD_MAP_PICTURE = workshopFallbackMediaBySlot["large-map"][0];

const DRAFT_QUALITY = "draft";

const cover = (mode, raster = null, template = null) => ({ mode, raster, template });

// Одно замороженное значение на все основы, которым считать нечего.
const AS_IS = Object.freeze(cover("picture"));

// ---- режим основы ----

// Первое подходящее правило решает, чем рисовать; иначе картинка раздела.
const MODE_RULES = [
  ["template", (base) => base.source === "template" && Boolean(MAP_TEMPLATE_MAP[base.templateId])],
  ["vector", (base) => base.source === "schematic" || (base.source === "game" && baseRendersVector(base))],
];

export function coverBaseMode(base) {
  const subject = base ?? {};
  const rule = MODE_RULES.find(([, fits]) => fits(subject));
  return rule ? rule[0] : "picture";
}

// ---- память: ни результат, ни неудача не вытесняются ----

function rememberBy(compute) {
  const store = new Map();
  return (key, ...args) => {
    let entry = store.get(key);
    if (entry === undefined) {
      entry = compute(...args);
      store.set(key, entry);
    }
    return entry;
  };
}

// Обработчики подложки: один на вид; неудача подготовки запоминается как null.
const handlerFor = rememberBy((boot) => boot().catch(() => null));

// ---- подготовка обработчиков ----

async function bootPicture() {
  const handler = createMapBaseProcessor();
  await handler.loadPicture(WORLD_MAP_PICTURE);
  return handler;
}

async function bootVector() {
  const geometry = await loadBundledRadarGeometry();
  if (geometry) {
    const handler = createMapBaseProcessor();
    handler.setGeometry(geometry, DEFAULT_ATLAS);
    return handler;
  }
  return null;
}

async function bootTemplate(templateId, origin, template) {
  if (!template) return null;
  const handler = createMapBaseProcessor();
  handler.setTemplate(template);
  const geometry = await loadMapTemplateGeometry(templateId, origin);
  handler.setTemplateGeometry(geometry);
  await handler.loadPicture(template.image ?? null);
  return handler;
}

// Адрес растра основы; null, если обрабатывать нечего.
async function rasterFor(handler, base) {
  const frame = handler.active(base) ? await handler.preview(base, DRAFT_QUALITY) : null;
  return frame?.href || null;
}

// ---- попытки: покрытие или null («здесь показать нечего, пробуем следующую») ----

async function attemptPicture(base) {
  const asImage = { ...base, source: "image" };
  const untouched = !asImage.recolor && !baseRasterActive(asImage, []);
  if (untouched) return null;
  const handler = await handlerFor("picture", bootPicture);
  const raster = handler && (await rasterFor(handler, asImage));
  return raster ? cover("picture", raster) : null;
}

async function attemptVector(base) {
  const handler = await handlerFor("vector", bootVector);
  const raster = handler && (await rasterFor(handler, base));
  return raster ? cover("vector", raster) : null;
}

const originSlug = (origin) => (origin ? `${origin.modId}|${origin.partId}` : "");

async function attemptTemplate(base) {
  const { templateId } = base;
  const origin = base.packOrigin ?? null;
  const template = mapTemplateSource(templateId, DEFAULT_ATLAS);
  const slot = `template:${templateId}:${originSlug(origin)}`;
  const handler = await handlerFor(slot, () => bootTemplate(templateId, origin, template));
  if (!handler) return null;
  const raster = await rasterFor(handler, base);
  return raster || template.image ? cover("template", raster, template) : null;
}

const ATTEMPTS = { template: attemptTemplate, vector: attemptVector, picture: attemptPicture };

// Картинка раздела: запасной путь всех режимов; если и она падает, остаётся «как есть».
const pictureOrAsIs = (base) => attemptPicture(base).then((found) => found ?? AS_IS, () => AS_IS);

// Свой путь режима; когда показать нечего, вектор и шаблон отдают очередь картинке раздела.
async function runMode(mode, base) {
  const own = await ATTEMPTS[mode](base);
  if (own) return own;
  if (mode === "picture") return AS_IS;
  return (await attemptPicture(base)) ?? AS_IS;
}

// Исключение внутри режима (вместе с его запасным путём) даёт ещё один заход через картинку раздела.
async function computeCover(mode, base) {
  try {
    return await runMode(mode, base);
  } catch {
    return pictureOrAsIs(base);
  }
}

const coverFor = rememberBy(computeCover);

function coverKey(mode, base) {
  if (mode === "picture") return ["picture", baseRasterKey({ ...base, source: "image" })].join("|");
  const { templateId, packOrigin } = base;
  const parts = [mode, templateId, packOrigin?.modId, packOrigin?.partId, baseRasterKey(base)];
  return parts.map((part) => part || "").join("|");
}

export function coverBase(base) {
  const mode = coverBaseMode(base);
  return coverFor(coverKey(mode, base), mode, base);
}
