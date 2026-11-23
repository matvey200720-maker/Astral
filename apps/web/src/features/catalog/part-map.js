import { cloudCatalogIDPattern } from "../../catalog-utils.js";
import { partKindOf } from "./part-kind.js";

// Большую карту из редукса можно открыть в редакторе карт, поправить и поставить в сборку
// вместо исходной. Работа «Карта из мода» хранит только ссылку { modId, partId }, а геометрию
// (плитки радара APG1) по ссылке отдаёт каталог окна. Редактору нужна только векторная карта;
// растровые плитки паузы (.ytd) ему ничего не дают.
// Файл радара обычно minimap.rpf, в формате E — spexvector.rpf. В формате C настоящие плитки
// паузы лежат в scaleform_generic.rpf, а minimap.rpf пуст, радара нет — часть не открывается.
// Плитка порядка 300 байт у векторных карт — пустышка.
const RADAR_NAMES = new Set(["minimap.rpf", "spexvector.rpf"]);
const PAUSE_TILE = new RegExp(String.raw`(?:^|[\\/])scaleform_generic\.rpf[\\/]minimap_(?:sea_)?\d{1,2}_\d{1,2}\.ytd$`, "i");
const MIN_REAL_TILE_BYTES = 1000;

// Состояние окна: каталог, которым пользуется загрузчик геометрии, и признак подключения.
const source = { mods: [], connected: false };

// Подгрузчики возвращают само обещание импорта: число тактов ожидания остаётся таким же.
const loadApi = () => import("../../api.js");
const loadRegistry = () => import("../../components/desktop/workshop/world-map-pack-source.js");

const manifestPath = (file) => String(file?.entry || file?.target || "");

// Роль файла манифеста: радар, растровая плитка паузы или ничего.
function fileRole(file) {
  const path = manifestPath(file);
  const name = path.split(/[\\/]/).pop().toLowerCase();
  const roles = [
    ["radar", () => RADAR_NAMES.has(name)],
    ["raster", () => PAUSE_TILE.test(path) && Number(file?.size) > MIN_REAL_TILE_BYTES],
  ];
  const found = roles.find(([, matches]) => matches());
  return found ? found[0] : "";
}

const isLargeMap = (mod) => Boolean(mod?.id) && partKindOf(mod) === "large-map";

// Радар есть, растровых плиток паузы нет, и у части известен адрес пакета.
function hasOnlyVectorRadar(mod, files) {
  const roles = files.map(fileRole);
  return Boolean(mod.packageBaseUrl) && roles.includes("radar") && !roles.includes("raster");
}

export function isVectorMapPart(mod) {
  if (!isLargeMap(mod)) return false;
  const { files } = mod.manifest ?? {};
  // Облачные моды приходят без манифеста: его даст разрешение на скачивание при чтении.
  return Array.isArray(files) ? hasOnlyVectorRadar(mod, files) : cloudCatalogIDPattern.test(mod.id);
}

// Откуда взять манифест: у самой части («local»), через облако («cloud») или нигде (null).
function routeOf(part, partId) {
  if (part?.manifest && part?.packageBaseUrl) return "local";
  return cloudCatalogIDPattern.test(partId) ? "cloud" : null;
}

function bytesOf(answer) {
  if (!answer?.bytes) return null;
  return new Uint8Array(answer.bytes);
}

export async function readPartMapGeometry(origin, { mods = source.mods, deps } = {}) {
  const partId = origin?.partId ? String(origin.partId) : "";
  if (!partId) return null;
  let api = deps?.api;
  if (api == null) api = await loadApi();
  const part = mods.find((mod) => mod?.id === partId);

  const route = routeOf(part, partId);
  if (route === null) return null;
  // Манифест и адрес пакета лежат под одними именами и у самой части, и в разрешении на скачивание.
  const holder = route === "cloud" ? await api.getCloudDownloadGrant(partId) : part;
  const input = { manifest: holder.manifest, baseUrl: holder.packageBaseUrl };

  return bytesOf(await api.readCatalogPartGeometry(input));
}

export async function connectPartMapSource(mods = []) {
  if (Array.isArray(mods)) source.mods = mods;
  else source.mods = [];
  // Признак выставляется до конца импорта, чтобы два вызова подряд подключили загрузчик один раз.
  const wasConnected = source.connected;
  source.connected = true;
  if (wasConnected) return;
  const { registerWorldMapPackSource } = await loadRegistry();
  registerWorldMapPackSource((origin) => readPartMapGeometry(origin));
}
