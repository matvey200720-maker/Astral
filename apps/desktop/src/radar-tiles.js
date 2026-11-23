import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { openRpf } from "@modovik/rpf7";
import { inflateRawNode } from "@modovik/rpf7/node";

const RADAR_ARCHIVE = "minimap.rpf";
const VECTOR_KIND = "vector";
const TILE_PREFIX = "minimap_";
const TILE_SUFFIX = ".ydd";

// Последний сегмент пути по «/».
const leafOf = (route) => route.slice(route.lastIndexOf("/") + 1);

const isShortNumber = (text) => text.length >= 1 && text.length <= 2 && [...text].every((ch) => ch >= "0" && ch <= "9");

// minimap_<1–2 цифры>_<1–2 цифры>.ydd, регистр не важен.
function isTileName(leaf) {
  const lower = leaf.toLowerCase();
  if (!lower.startsWith(TILE_PREFIX) || !lower.endsWith(TILE_SUFFIX)) return false;
  const numbers = lower.slice(TILE_PREFIX.length, -TILE_SUFFIX.length).split("_");
  return numbers.length === 2 && numbers.every(isShortNumber);
}

// Имя плитки на конце пути (в том написании, что в пути) или null.
function tileLeaf(value) {
  const leaf = leafOf(String(value));
  return isTileName(leaf) ? leaf : null;
}

const isInside = (root, file) => file.startsWith(root + sep);

// Хэш записи ссылки: пустой — сверки нет, иначе сравнение с приведённым к строчным.
function matchesDigest(entry, bytes) {
  if (!entry.sha256) return true;
  return createHash("sha256").update(bytes).digest("hex") === String(entry.sha256).toLowerCase();
}

const readQuietly = (archive, route) => archive.read(route).catch(() => null);

// Векторные плитки архива по порядку записей; нечитаемые и пустые пропускаются.
async function* readableTiles(archive) {
  for (const entry of archive.entries) {
    const name = tileLeaf(entry.path);
    if (name === null) continue;
    const data = await readQuietly(archive, entry.path);
    if (!data?.length) continue;
    yield { name, bytes: new Uint8Array(data) };
  }
}

export async function archiveTiles(bytes, keys) {
  const archive = await openRpf(bytes, { name: RADAR_ARCHIVE, keys, inflateRaw: inflateRawNode });
  const tiles = [];
  for await (const tile of readableTiles(archive)) tiles.push(tile);
  return tiles;
}

// Кладёт плитку в слой: ключ — имя в нижнем регистре, последняя запись побеждает,
// а место в порядке остаётся за первым появлением ключа.
const stash = (layer, tile) => layer.set(tile.name.toLowerCase(), tile);

// Два слоя плиток: из архивов minimap.rpf и из оверлея (оверлей главнее).
class Layers {
  packed = new Map();
  overlay = new Map();

  constructor(root, keys) {
    this.root = root;
    this.keys = keys;
  }

  async add(entry) {
    if (!entry || entry.kind !== VECTOR_KIND) return;
    const file = resolve(this.root, String(entry.source || ""));
    if (!isInside(this.root, file)) return;
    const bytes = await readFile(file).catch(() => null);
    if (bytes === null || !matchesDigest(entry, bytes)) return;
    const route = String(entry.path || "").replace(/\\/g, "/");
    const leaf = tileLeaf(route);
    if (leaf !== null) {
      stash(this.overlay, { name: leaf, bytes: new Uint8Array(bytes) });
    } else if (leafOf(route).toLowerCase() === RADAR_ARCHIVE) {
      const tiles = await archiveTiles(new Uint8Array(bytes), this.keys).catch(() => []);
      for (const tile of tiles) stash(this.packed, tile);
    }
  }

  result() {
    return [...new Map([...this.packed, ...this.overlay]).values()];
  }
}

const hasEntries = (link) => Boolean(link && link.from && Array.isArray(link.entries));

export async function radarTilesOf(link, { directoryOf, keys = null } = {}) {
  if (!hasEntries(link)) return [];
  const folder = directoryOf ? directoryOf(link.from) : null;
  if (!folder) return [];
  const layers = new Layers(resolve(folder), keys);
  for (const entry of link.entries) await layers.add(entry);
  return layers.result();
}
