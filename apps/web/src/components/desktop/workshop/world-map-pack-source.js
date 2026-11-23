// Источник геометрии «Карты из мода»: каталог подключает загрузчик частей мода,
// а модуль отдаёт готовую геометрию и держит кэш по ссылке на часть.
// Пакет векторной карты подгружается только при первом разборе (холодный старт).

const GZIP_MAGIC = Object.freeze([0x1f, 0x8b]);

const isPart = (origin) => Boolean(origin?.modId && origin?.partId);
const partKey = ({ modId, partId }) => `${modId}|${partId}`;

const gunzip = async (view) => {
  const stream = new Blob([view]).stream();
  const unpacked = stream.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(unpacked).arrayBuffer());
};

const viewOf = (payload) => {
  if (payload instanceof Uint8Array) return payload;
  return payload instanceof ArrayBuffer ? new Uint8Array(payload) : null;
};

const hasGroups = (geometry) => (geometry?.groups?.length ?? 0) > 0;

// Байты APG1 (как есть или в gzip) -> геометрия; любая неудача -> null.
const geometryFromBytes = async (payload) => {
  try {
    const raw = viewOf(payload);
    if (!raw?.length) return null;
    const packed = raw[0] === GZIP_MAGIC[0] && raw[1] === GZIP_MAGIC[1];
    if (packed && typeof DecompressionStream !== "function") return null;
    const view = packed ? await gunzip(raw) : raw;
    const decode = (await import("@modovik/vector-map")).decodePackGeometry;
    const geometry = decode(view);
    return hasGroups(geometry) ? geometry : null;
  } catch {
    return null;
  }
};

// Загрузчик каталога и кэш «мод|часть» -> обещание геометрии (или null).
class PartCache {
  constructor() {
    this.loader = null;
    this.byKey = new Map();
  }

  reset() {
    this.loader = null;
    this.byKey.clear();
  }

  prime(origin, bytes) {
    if (isPart(origin)) this.byKey.set(partKey(origin), geometryFromBytes(bytes));
  }

  load(origin) {
    if (!isPart(origin)) return Promise.resolve(null);
    const key = partKey(origin);
    return this.byKey.get(key) ?? this.start(origin, key);
  }

  start(origin, key) {
    const ask = this.loader;
    if (!ask) return Promise.resolve(null);
    const job = this.obtain(ask, origin, key);
    this.byKey.set(key, job);
    return job;
  }

  // Загрузчик зовётся со следующей микрозадачи; неудача из кэша убирается.
  async obtain(ask, origin, key) {
    await undefined;
    let geometry = null;
    try {
      geometry = await geometryFromBytes(await ask(origin));
    } catch {
      geometry = null;
    }
    if (!geometry) this.byKey.delete(key);
    return geometry;
  }
}

const cache = new PartCache();

const registerWorldMapPackSource = (next) => {
  cache.loader = typeof next === "function" ? next : null;
};

const worldMapPackSourceReady = () => cache.loader !== null;

const primeWorldMapPack = (origin, bytes) => cache.prime(origin, bytes);

const loadWorldMapPackGeometry = (origin) => cache.load(origin);

const resetWorldMapPackSourceForTests = () => cache.reset();

export {
  loadWorldMapPackGeometry,
  primeWorldMapPack,
  registerWorldMapPackSource,
  resetWorldMapPackSourceForTests,
  worldMapPackSourceReady,
};
