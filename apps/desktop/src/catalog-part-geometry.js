import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";
import * as zlib from "node:zlib";
import { downloadSignedPackage } from "@modovik/install-engine";
import { readDrawable } from "@modovik/rage-drawable";
import { inflateRawNode, keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { decodePackGeometry, encodePackGeometry, parsePackGeometry } from "@modovik/vector-map";

// Правила модуля: формы строк, словари имён и приметы кэша.
const RULES = {
  partId: /^[a-z0-9][a-z0-9._-]{0,95}$/i,
  sha256: /^[0-9a-f]{64}$/i,
  tileTail: /\.ydd$/i,
  radarNames: new Set(["minimap.rpf", "spexvector.rpf"]),
  tileKinds: new Set(["binary", "resource"]),
  archiveName: "minimap.rpf",
  cacheFolder: "part-geometry",
  cacheTag: "b2",
};

// Три отказа модуля: код и видимый человеку текст.
const FAILURES = {
  noPackage: ["PART_PACKAGE", "У этой части нет пакета."],
  noRadar: ["PART_NO_VECTOR", "В этой карте нет векторного радара (minimap.rpf) — редактор её не откроет."],
  noTriangles: ["PART_NO_VECTOR", "В радаре этой карты не нашлось треугольников — редактор её не откроет."],
};

// Поля запроса доверенной загрузки: порядок строк таблицы — порядок ключей в запросе.
const DOWNLOAD_FIELDS = [
  ["manifest", ({ manifest }) => manifest],
  ["baseUrl", ({ input }) => String(input?.baseUrl || "")],
  ["publicKey", ({ deps }) => deps.publicKey],
  ["stateDir", ({ deps }) => deps.stateDir],
  ["downloadsDir", ({ deps }) => deps.downloadsDir || null],
  ["allowInsecureLocalhost", ({ deps }) => Boolean(deps.allowInsecureLocalhost)],
  ["allowedHosts", ({ deps }) => deps.allowedHosts ?? null],
  ["onProgress", ({ context }) => context?.onProgress || null],
];

// Проверки манифеста части; идут по порядку, первая неудача отказывает.
const PACKAGE_CHECKS = [
  (id) => RULES.partId.test(id),
  (id, manifest) => Boolean(manifest.version),
];

function failure(kind) {
  const [code, message] = FAILURES[kind];
  return Object.assign(new Error(message), { code });
}

function identify(input) {
  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  if (!PACKAGE_CHECKS.every((check) => check(id, manifest))) throw failure("noPackage");
  return { id, manifest };
}

// Имя файла в пути записи: звено после последней «/» (обратные черты — часть имени).
function leafOf(file) {
  return String(file.entry || file.target || "").split("/").pop().toLowerCase();
}

function isRadarFile(file) {
  if (!file?.source || file.action === "delete") return false;
  return RULES.radarNames.has(leafOf(file));
}

function findRadar(manifest) {
  return (manifest.files || []).find(isRadarFile);
}

function isTileEntry(entry) {
  return RULES.tileKinds.has(entry.kind) && RULES.tileTail.test(entry.path);
}

function downloadRequest(manifest, input, context, deps) {
  const from = { manifest, input, context, deps };
  return Object.fromEntries(DOWNLOAD_FIELDS.map(([key, pick]) => [key, pick(from)]));
}

// Источник обязан лежать строго внутри папки пакета.
function isInside(root, source) {
  return source.length > root.length && source.startsWith(root) && source[root.length] === nodePath.sep;
}

// Новый ArrayBuffer точной длины с теми же байтами.
function detach(bytes) {
  return new Uint8Array(bytes).buffer;
}

async function readKept(file) {
  try {
    const bytes = await fsp.readFile(file);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

// Копия в кэше годна, только если она целиком: gzip читается до конца (длина и сумма в хвосте ловят обрыв записи),
// а внутри APG1 с заявленным числом групп и вершин и хотя бы одним треугольником. Остальное пересобирается.
function isWholeCopy(bytes) {
  try {
    return Boolean(decodePackGeometry(zlib.gunzipSync(bytes))?.triangles);
  } catch {
    return false;
  }
}

async function loadKeys(directory) {
  if (!directory) return null;
  try {
    return await keysFromDirectory(directory);
  } catch {
    return null;
  }
}

async function* tileBytes(archive) {
  for (const entry of archive.entries || []) {
    if (!isTileEntry(entry)) continue;
    const label = entry.name;
    const raw = await archive.read(entry.path);
    yield { name: label, bytes: new Uint8Array(raw) };
  }
}

// Архив закрывается всегда; отказ закрытия заменяет прочее.
async function collectTiles(archive) {
  try {
    const tiles = [];
    for await (const tile of tileBytes(archive)) tiles.push(tile);
    return tiles;
  } finally {
    if (archive.close) await archive.close();
  }
}

function pack(geometry) {
  const encoded = encodePackGeometry(geometry);
  return zlib.gzipSync(encoded);
}

// Одна работа над частью: кэш, скачивание, плитки, разбор, запись результата.
class PartJob {
  constructor(id, manifest, radar, deps) {
    this.id = id;
    this.manifest = manifest;
    this.radar = radar;
    this.deps = deps;
    this.cacheFolder = null;
    this.cacheFile = null;
  }

  async cached() {
    const { id, radar, deps } = this;
    this.cacheFolder = nodePath.join(deps.stateDir, RULES.cacheFolder);
    const hash = String(radar.sha256 || "");
    if (!RULES.sha256.test(hash)) return null;
    const fileName = `${radar.sha256.toLowerCase()}.${RULES.cacheTag}.apg1.gz`;
    this.cacheFile = nodePath.join(this.cacheFolder, fileName);
    const kept = await readKept(this.cacheFile);
    if (!kept || !isWholeCopy(kept)) return null;
    return { id, bytes: detach(kept) };
  }

  async fetched(input, context) {
    const { manifest, radar, deps } = this;
    const download = deps.download || downloadSignedPackage;
    const reply = await download(downloadRequest(manifest, input, context, deps));
    const root = nodePath.resolve(reply.packageRoot);
    const source = nodePath.resolve(root, radar.source);
    if (!isInside(root, source)) throw failure("noPackage");
    return source;
  }

  async tiles(source) {
    const keys = await loadKeys(this.deps.keysDirectory);
    const openArchive = this.deps.openArchive || openRpfFile;
    return collectTiles(await openArchive(source, { name: RULES.archiveName, keys }));
  }

  parsed(tiles) {
    const geometry = parsePackGeometry(tiles, { readDrawable, inflateRaw: inflateRawNode });
    if (geometry.skipped?.length) {
      const names = geometry.skipped.map((tile) => `${tile.name} (${tile.reason})`);
      console.warn(`[part-geometry] ${this.id}: не прочитались плитки радара — ${names.join(", ")}`);
    }
    if (!geometry.triangles) throw failure("noTriangles");
    return geometry;
  }

  async stored(geometry) {
    const packed = pack(geometry);
    await this.keep(packed);
    return { id: this.id, bytes: detach(packed) };
  }

  async keep(packed) {
    if (!this.cacheFile) return;
    try {
      await fsp.mkdir(this.cacheFolder, { recursive: true });
      await fsp.writeFile(this.cacheFile, packed);
    } catch {
      // кэш необязателен: сбой записи молчит
    }
  }
}

export async function readCatalogPartGeometry(input, context, deps) {
  const { id, manifest } = identify(input);
  const radar = findRadar(manifest);
  if (!radar) throw failure("noRadar");

  const job = new PartJob(id, manifest, radar, deps);
  const kept = await job.cached();
  if (kept) return kept;

  const source = await job.fetched(input, context);
  const geometry = job.parsed(await job.tiles(source));
  return job.stored(geometry);
}
