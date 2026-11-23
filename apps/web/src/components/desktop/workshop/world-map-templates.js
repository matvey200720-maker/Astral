// Готовые карты из паков: адреса картинок и плиток шаблона, векторная геометрия
// шаблона (geometry.apgz, один раз на окно) и геометрия подложки без игры.
import { loadWorldMapPackGeometry } from "./world-map-pack-source.js";
import {
  mapTemplateFiles as filesOfTemplate,
  mapTemplateFolder,
  tileRect,
  packBaseGeometry as baseWithoutOverlay,
  packRadarGeometry,
  decodePackGeometry,
  MAP_TEMPLATE_MAP,
  STARTER_MAP_TEMPLATE,
  DEFAULT_ATLAS,
} from "@modovik/vector-map";

const GRID = Object.freeze({ rows: 3, columns: 2 });

// Шаблон ищется обычным обращением к свойству: имена вроде constructor «находятся».
const templateById = (templateId) => MAP_TEMPLATE_MAP[templateId];

const tileAt = (files, grid, row, column) => {
  const href = files.tile(row, column);
  const rect = tileRect(column, row, grid);
  return { row, column, href, rect };
};

const describeTemplate = (template, atlas) => {
  const head = { id: template.id, title: template.title };
  if (template.virtual) return { ...head, image: null, card: null, state: null, tiles: [] };

  const files = filesOfTemplate(template.id);
  const grid = { ...atlas, ...GRID };
  const tiles = Array.from({ length: GRID.rows * GRID.columns }, (_, slot) =>
    tileAt(files, grid, Math.floor(slot / GRID.columns), slot % GRID.columns),
  );
  const { map: image, card, state } = files;
  return { ...head, image, card, state, tiles };
};

export const mapTemplateSource = (templateId, atlas = DEFAULT_ATLAS) => {
  const template = templateById(templateId);
  return template ? describeTemplate(template, atlas) : null;
};

// Файл шаблона по имени поля: карточка или «весь штат мелко».
const fileOfTemplate = (field) => (templateId) =>
  templateById(templateId) ? filesOfTemplate(templateId)[field] : null;

const mapTemplateCard = fileOfTemplate("card");
const mapTemplateState = fileOfTemplate("state");

const sumBy = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

// Группы без накладки: высота «не меньше границы» отсекает группу.
const trimOverlay = (geometry, from) => {
  const groups = [];
  geometry.groups.forEach((group) => {
    if (!(group.height >= from)) groups.push(group);
  });
  const triangles = sumBy(groups, (group) => group.positions.length / 6);
  return Object.assign({}, geometry, { groups, triangles });
};

export const withoutOverlay = (geometry, overlayFrom = null) => {
  const applicable = Boolean(geometry) && Number.isFinite(overlayFrom);
  return applicable ? trimOverlay(geometry, overlayFrom) : geometry;
};

const geometryForConfig = (geometry, config) => {
  const split = config?.base?.packLayers === "split";
  return split && geometry ? baseWithoutOverlay(geometry) : geometry;
};

// Запись обещания в кэш идёт раньше работы: параллельные вызовы не плодят запросов.
const rememberPromise = (store, key, produce) => {
  if (!store.has(key)) {
    let adopt;
    store.set(key, new Promise((resolve) => (adopt = resolve)));
    adopt(produce());
  }
  return store.get(key);
};

const geometriesByFolder = new Map();
const radarSlot = new Map();

// Тело ответа, распакованное gzip-потоком платформы.
const inflateGzipBody = async (body) => {
  const packed = body.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(packed).arrayBuffer());
};

const downloadGeometry = (templateId, template) => {
  if (typeof DecompressionStream !== "function") return Promise.resolve(null);
  const address = () => `${mapTemplateFolder(templateId)}/geometry.apgz`;
  return new Promise((resolve) => resolve(fetch(address())))
    .then((response) => (response.ok && response.body ? inflateGzipBody(response.body) : null))
    .then((bytes) => bytes && withoutOverlay(decodePackGeometry(bytes), template.overlayFrom))
    .catch(() => null);
};

// Откуда берётся геометрия шаблона: нет — векторной нет; из мода; из кэша раздачи окна.
const strategyFor = (template) => {
  if (template?.kind !== "vector") return () => Promise.resolve(null);
  if (template.virtual) return (_templateId, origin) => loadWorldMapPackGeometry(origin);
  return (templateId) =>
    rememberPromise(geometriesByFolder, template.assets, () =>
      downloadGeometry(templateId, template),
    );
};

const loadMapTemplateGeometry = (templateId, origin = null) =>
  strategyFor(templateById(templateId))(templateId, origin);

const radarFromStarter = async () => {
  const geometry = await loadMapTemplateGeometry(STARTER_MAP_TEMPLATE);
  return geometry ? packRadarGeometry(geometry) : null;
};

const loadBundledRadarGeometry = () =>
  rememberPromise(radarSlot, "radar", () => radarFromStarter().catch(() => null));

export {
  geometryForConfig,
  loadBundledRadarGeometry,
  loadMapTemplateGeometry,
  mapTemplateCard,
  mapTemplateState,
};
