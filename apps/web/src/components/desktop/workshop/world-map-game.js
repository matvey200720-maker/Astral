import { islandColourReport } from "./world-map-island.js";
import { renderMapTiles } from "./world-map-render.js";
import { prepareRadarItems } from "./world-map-radar-render.js";
import { radarLandColour } from "./world-map-radar.js";
import { tiltAvailable } from "./world-map/tilt-gate.js";
import {
  chooseGameInstallation,
  detectInstallations,
  readRadarTileColours,
  readWorldMapGeometry,
  readWorldMapIsland,
  readWorldMapTiles,
} from "../../../api.js";
import { blipIconAssets } from "@modovik/vector-map/blip-icons";
import {
  atlasFromTiles,
  buildMapScene,
  buildRadarOverlay,
  decodeRadarGeometry,
  DEFAULT_ATLAS,
  encodeRadarOverlay,
  ensureLabelMeshes,
  loadMajesticMarks,
  majesticMarksOn,
  normalizeMapZoom,
  normalizeWorldMap,
  parseTileName,
  pauseMapInstallPlan,
  PAUSE_MAP_GAME_SEA,
  pauseMapPlan,
  pauseTileSea,
  radarBuildings,
  radarPlan,
  tileRect,
  worldMapDiffersFromGame,
} from "@modovik/vector-map";

// PNG 1 x 1 для плиток проверочного входа песочницы (68 байт).
const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const BASE64_CHUNK = 0x8000;
const STOCK_ZOOM_LIMIT = 1;

const isRecord = (value) => value !== null && typeof value === "object";
const isEditorLink = (value) => typeof value === "string" && value.startsWith("blob:");
const emptyReport = () => ({ pairs: [], reason: "no-palette" });

// Вызывает чтение сразу (синхронно), а сбой любого рода превращает в null.
function attemptOrNull(read) {
  try {
    return Promise.resolve(read()).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

// ---------------------------------------------------------------------------
// Свои картинки: ссылки редактора и значки карты

// Ссылки blob: читаются сразу; свои ссылки заявки выдаются на каждом проходе заново.
function createLinkKeeper(sceneContext) {
  const assets = sceneContext ? sceneContext.assets : undefined;
  const entries = isRecord(assets) ? Object.entries(assets) : [];
  const reads = entries.map(([, value]) =>
    isEditorLink(value) ? attemptOrNull(() => fetch(value).then((reply) => reply.blob())) : null,
  );
  const issued = [];

  return {
    async fresh() {
      const blobs = await Promise.all(reads);
      const pairs = entries.map(([key, value], at) => {
        if (!blobs[at]) return [key, value];
        issued.push(URL.createObjectURL(blobs[at]));
        return [key, issued[issued.length - 1]];
      });
      return Object.fromEntries(pairs);
    },
    drop() {
      issued.splice(0).forEach((link) => URL.revokeObjectURL(link));
    },
  };
}

function toBase64(bytes) {
  const pieces = Math.ceil(bytes.length / BASE64_CHUNK);
  const text = Array.from({ length: pieces }, (_, n) =>
    String.fromCharCode(...bytes.subarray(n * BASE64_CHUNK, (n + 1) * BASE64_CHUNK)),
  );
  return btoa(text.join(""));
}

function readIconPicture(address) {
  if (typeof address !== "string") return Promise.resolve("");
  const encoded = attemptOrNull(() =>
    fetch(address)
      .then((reply) => reply.blob())
      .then((blob) => blob.arrayBuffer())
      .then((buffer) => toBase64(new Uint8Array(buffer))),
  );
  return encoded.then((text) => text || "");
}

// id -> base64; чтение стартует при создании заявки, ответ собирается по требованию.
function startIconPictures(ids, sceneContext) {
  const assets = sceneContext ? sceneContext.assets : undefined;
  const table = isRecord(assets) ? assets : {};
  const jobs = ids.map((id) => readIconPicture(table[id]));
  return () =>
    Promise.all(jobs).then((texts) =>
      Object.fromEntries(ids.map((id, at) => [id, texts[at]]).filter(([, text]) => text)),
    );
}

// ---------------------------------------------------------------------------
// Заявка на установку

async function renderGameTiles(env, { onProgress, onTile }) {
  const { config, snapshot, raster } = env;
  if (majesticMarksOn(config.majestic)) await loadMajesticMarks();
  await ensureLabelMeshes(config);
  const scene = await env.scene();

  const settings = config.export;
  const params = {
    resolution: settings.resolution,
    format: settings.format,
    detail: settings.detail,
  };
  params.source = raster ? snapshot.exportSource(config.base) : null;
  Object.assign(params, {
    radar: radarPlan(config).mode,
    seaColor: pauseMapPlan(config).seaColor,
    pauseSea: pauseTileSea(config),
    pauseOpaque: !config.base.bare,
    onProgress,
    onTile,
  });
  return renderMapTiles(scene, params);
}

async function readRadarPalette(env, gameRoot) {
  if (!env.loadRadarColours) return emptyReport();
  const palette = await env.loadRadarColours(gameRoot);
  const colours = palette?.colours;
  if (!Array.isArray(colours) || colours.length === 0) return emptyReport();
  const sea = pauseMapPlan(env.config).seaColor || PAUSE_MAP_GAME_SEA;
  return env.snapshot.radarReport(env.config.base, colours, { sea });
}

async function readIslandPalette(env, gameRoot) {
  if (!env.loadIsland) return emptyReport();
  const island = await env.loadIsland(gameRoot);
  return islandColourReport({
    processor: env.snapshot,
    config: env.config,
    palette: island?.palette,
  });
}

function overlayOptions(env, plan, pairs, painter) {
  const { config, radarGeometry } = env;
  const entries = [
    ["tintAlpha", plan.tint],
    ["backdrop", radarLandColour(pairs)],
  ];
  if (radarGeometry?.groups?.length) entries.push(["ground", { geometry: radarGeometry, pairs }]);
  entries.push(["markers", config.markers]);
  if (painter) entries.push(["items", { env: painter.env, textScale: plan.textScale }]);
  return Object.fromEntries(entries);
}

async function buildGameOverlay(env, pairs) {
  const plan = radarPlan(env.config);
  if (!plan.layers) return null;

  await ensureLabelMeshes(env.config);
  const scene = await env.scene();
  const painter = plan.items ? await prepareRadarItems(scene) : null;
  try {
    const overlay = buildRadarOverlay(scene, overlayOptions(env, plan, pairs, painter));
    return overlay.triangleCount
      ? { chunks: encodeRadarOverlay(overlay), stats: overlay.stats }
      : null;
  } finally {
    (painter?.images ?? []).forEach((image) => image?.close?.());
  }
}

// Наклон радара, который уйдёт в игру: `{ strength }` или undefined. Только там, где окно показывает строку «Наклон радара»
// (`world-map/tilt-gate.js`): включённый наклон, скрытый закрытым гейтом, не должен молча ложиться в игру.
const radarTiltOf = (config) =>
  tiltAvailable(normalizeWorldMap(config)) ? radarPlan(config).tilt : undefined;

export function worldMapGamePayload({
  config,
  source,
  processor,
  sceneContext,
  radarGeometry = null,
  loadIsland = null,
  loadRadarColours = null,
}) {
  const iconWork = config.blipIcons;
  const snapshot = typeof processor?.fork === "function" ? processor.fork() : processor;
  const keeper = createLinkKeeper(sceneContext);
  const iconIds = blipIconAssets(iconWork);
  const iconPictures = iconIds.length ? startIconPictures(iconIds, sceneContext) : null;

  const raster = source !== "schematic";
  const env = {
    config,
    snapshot,
    raster,
    radarGeometry,
    loadIsland,
    loadRadarColours,
    scene: async () =>
      buildMapScene(config, {
        ...sceneContext,
        assets: await keeper.fresh(),
        baseRaster: null,
        baseProcessed: raster,
        templateTiles: true,
      }),
  };

  const differs = worldMapDiffersFromGame(config);
  const installPlan = radarPlan(config);
  // Без наклона и без зданий в заявке нет ключей radarTilt и radarBuildings.
  const tilt = radarTiltOf(config);
  const buildings = radarBuildings(config);
  return Object.fromEntries([
    ["config", config],
    ["source", source],
    ["renderTiles", async ({ onProgress, onTile }) => renderGameTiles(env, { onProgress, onTile })],
    ["release", keeper.drop],
    ["vectorLayer", !differs],
    ["pauseMap", pauseMapInstallPlan(config)],
    ["radar", installPlan.mode],
    ["radarColours", async ({ gameRoot = "" } = {}) => readRadarPalette(env, gameRoot)],
    ["radarLayers", async ({ pairs = [] } = {}) => buildGameOverlay(env, pairs)],
    ["radarMask", installPlan.opaque],
    // Наклон «как в машине»: `{ strength }` — доля от штатного радара в машине, поля minimap.ymt считает главный процесс по файлу игрока.
    ...(tilt ? [["radarTilt", tilt]] : []),
    // Настоящие здания в плитках радара: `{ heightScale }` — высота зданий к районной.
    ...(buildings ? [["radarBuildings", buildings]] : []),
    ["island", differs],
    ["islandColours", async ({ gameRoot = "" } = {}) => readIslandPalette(env, gameRoot)],
    ["blipIcons", iconPictures ? { work: iconWork, pictures: iconPictures } : { work: iconWork }],
    ["stock", worldMapIsStock(config)],
  ]);
}

// ---------------------------------------------------------------------------
// Оценка «карта равна игровой»

export function worldMapIsStock(config) {
  const zoom = config.zoom;
  const conditions = [
    () => !worldMapDiffersFromGame(config),
    () => !pauseMapPlan(config).needed,
    () => radarPlan(config).mode === "game",
    // Наклон радара и настоящие здания в нём — правки файлов игры: с ними карта не штатная.
    () => !radarTiltOf(config),
    () => !radarBuildings(config),
    () => normalizeMapZoom(zoom).distance <= STOCK_ZOOM_LIMIT,
  ];
  return conditions.every((holds) => holds());
}

// ---------------------------------------------------------------------------
// Поиск игры игрока

async function legacyInstallPath() {
  return detectInstallations().then((installs) => {
    const legacy = installs.find(
      (item) => item.path && String(item.edition || "Legacy").toLowerCase() === "legacy",
    );
    return legacy ? legacy.path : null;
  });
}

function knownGameRoot(gameRoot) {
  const given = typeof gameRoot === "string" ? gameRoot.trim() : "";
  return given ? Promise.resolve(given) : legacyInstallPath();
}

function readerWithRoot(read) {
  return (gameRoot = "") =>
    knownGameRoot(gameRoot).then((root) => (root ? read({ gameRoot: root }) : null));
}

export const loadWorldMapRadarColours = readerWithRoot((args) => readRadarTileColours(args));
export const loadWorldMapIsland = readerWithRoot((args) => readWorldMapIsland(args));

export function releaseWorldMapGameTiles(loaded) {
  const lists = [loaded && loaded.tiles, loaded && loaded.landTiles];
  lists.forEach((list) => {
    for (const tile of list || []) {
      if (tile.href?.startsWith("blob:")) URL.revokeObjectURL(tile.href);
    }
  });
}

// ---------------------------------------------------------------------------
// Чтение плиток игры

const stockOf = (value) => (value === null ? value : value || undefined);

function tileEntry(tile, parsed, atlas) {
  return {
    name: tile.name,
    layer: parsed.layer,
    href: URL.createObjectURL(new Blob([tile.png], { type: "image/png" })),
    rect: tileRect(parsed.column, parsed.row, atlas),
    format: tile.format,
    levels: tile.levels,
    width: tile.width || null,
    height: tile.height || null,
  };
}

function layoutGameTiles(loaded, vector) {
  const parsedNames = loaded.tiles.map((tile) => parseTileName(tile.name));
  const ymt = vector && vector.atlas;
  const atlasHints = ymt
    ? { atlas: { ...DEFAULT_ATLAS, originX: ymt.originX, originY: ymt.originY }, tileUnits: ymt.tileUnits }
    : {};
  const atlas = atlasFromTiles(loaded.tiles, atlasHints);

  const families = { sea: [], land: [] };
  loaded.tiles.forEach((tile, at) => {
    if (parsedNames[at]) families[parsedNames[at].layer].push(tileEntry(tile, parsedNames[at], atlas));
  });
  const [tiles, landTiles] = families.sea.length
    ? [families.sea, families.land]
    : [families.land, []];

  const zones = vector && vector.zoneNames;
  return {
    tiles,
    landTiles,
    atlas,
    geometry: vector && vector.geometry ? decodeRadarGeometry(vector.geometry) : null,
    zoneNames: isRecord(zones) ? zones : null,
    stock: stockOf(loaded.stock),
    live: loaded.live || null,
  };
}

// Проверочный вход песочницы: радар из файлов рядом со страницей, игра не нужна.
function sandboxFixtureStem() {
  const query = new URLSearchParams(globalThis.location?.search ?? "");
  const stem = query.get("radarFixture");
  const usable = query.get("qa") === "isolated" && stem && stem.startsWith("/");
  return usable ? stem : null;
}

function stubTile(name, png) {
  return {
    name: name.replace("minimap_", "minimap_sea_"),
    png,
    format: "png",
    levels: 1,
    width: 1,
    height: 1,
  };
}

async function readSandboxRadar() {
  const stem = sandboxFixtureStem();
  if (stem === null) return null;

  const replies = await Promise.all([".bin", ".json"].map((ext) => fetch(stem + ext)));
  if (replies.some((reply) => !reply.ok)) return null;

  const [geometry, info] = await Promise.all([replies[0].arrayBuffer(), replies[1].json()]);
  const pixel = Uint8Array.from(atob(FIXTURE_PNG_BASE64), (char) => char.charCodeAt(0));
  return layoutGameTiles(
    { tiles: info.tiles.map((name) => stubTile(name, pixel)), stock: undefined, live: null },
    { atlas: info.atlas, geometry: new Uint8Array(geometry), zoneNames: info.zoneNames },
  );
}

async function pickGameRoot() {
  const chosen = await chooseGameInstallation();
  return chosen && chosen.path;
}

export async function loadWorldMapGameTiles({ chooseGame = true } = {}) {
  const sandbox = await readSandboxRadar();
  if (sandbox) return sandbox;

  const root = (await legacyInstallPath()) || (chooseGame ? await pickGameRoot() : null);
  if (!root) return null;

  const tilesRead = readWorldMapTiles({ gameRoot: root, live: true });
  const geometryRead = attemptOrNull(() => readWorldMapGeometry({ gameRoot: root }));
  const [loaded, vector] = await Promise.all([tilesRead, geometryRead]);
  return loaded?.tiles?.length ? layoutGameTiles(loaded, vector) : null;
}
