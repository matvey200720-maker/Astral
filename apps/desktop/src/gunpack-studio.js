import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import * as zlib from "node:zlib";
import * as packIntake from "@modovik/pack-intake";
import * as rpfReader from "@modovik/pack-intake/rpf-reader";
import * as gunpack from "@modovik/gunpack";
import * as gunpackIds from "@modovik/gunpack/ids";
import * as composing from "./gunpack-compose.js";

const { basename, isAbsolute, join } = nodePath;

const ID_PATTERN = /^[0-9a-f]{24}$/;
const SHOT_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,119}$/;
const READABLE_PATTERN = /\.(ydr|ytd|yft)$/i;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LIMITS = {
  shotBytes: 16 * 1024 * 1024,
  sources: 32,
  readPaths: 16,
  cache: 3,
};

const TEXT = {
  unknownPack: "Неизвестный пак.",
  noPack: "Такого пака в «Моих паках» нет.",
  noSources: "Покажите архив, папку или файлы пака.",
  relative: "Нужны полные пути к файлам пака.",
  noWeapons:
    "В этом архиве нет ни одного ствола (файлов w_*.ydr/ytd) — это не ганпак.",
  tooMany: "Слишком много файлов за один раз.",
  shotName: "Некорректное имя кадра.",
  shotPng: "Кадр должен быть PNG до 16 МБ.",
  noLook: "В паке нет такого ствола.",
  notOwn: "Это не своя сборка, а пак.",
  nested: "Сборку собирают из паков, а не из другой сборки.",
  noFile: (path) => `В паке нет файла ${path}.`,
  notModel: (path) => `Файл ${path} не модель и не текстура.`,
  moved: (name) =>
    `Архив пака «${name}» больше не на своём месте — добавьте пак заново.`,
};

// Таблица проверок входа: имя правила -> условие, код и текст отказа.
const RULES = {
  packId: {
    code: "GUNPACK_ID",
    text: TEXT.unknownPack,
    ok: (id) => ID_PATTERN.test(String(id)),
  },
  sourceCount: {
    code: "GUNPACK_SOURCES",
    text: TEXT.noSources,
    prep: (paths) =>
      (Array.isArray(paths) ? paths : []).filter(Boolean).map((p) => String(p)),
    ok: (list) => list.length > 0 && list.length <= LIMITS.sources,
  },
  sourcePaths: {
    code: "GUNPACK_SOURCES",
    text: TEXT.relative,
    ok: (list) => list.every((p) => isAbsolute(p)),
  },
  weapons: { code: "GUNPACK_NO_WEAPONS", text: TEXT.noWeapons, ok: Boolean },
  readCount: {
    code: "GUNPACK_READ",
    text: TEXT.tooMany,
    prep: (paths) => (Array.isArray(paths) ? paths : []).map((p) => String(p)),
    ok: (list) => list.length > 0 && list.length <= LIMITS.readPaths,
  },
  fileKnown: {
    code: "GUNPACK_READ",
    text: (hit) => TEXT.noFile(hit.path),
    ok: (hit) => Boolean(hit.file),
  },
  fileReadable: {
    code: "GUNPACK_READ",
    text: TEXT.notModel,
    ok: (path) => READABLE_PATTERN.test(path),
  },
  shotName: {
    code: "GUNPACK_SHOT",
    text: TEXT.shotName,
    prep: (key) => String(key || ""),
    ok: (name) => SHOT_KEY_PATTERN.test(name),
  },
  shotImage: {
    code: "GUNPACK_SHOT",
    text: TEXT.shotPng,
    prep: (bytes) =>
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0),
    ok: (bytes) =>
      bytes.length > PNG_SIGNATURE.length &&
      bytes.length <= LIMITS.shotBytes &&
      PNG_SIGNATURE.every((byte, at) => bytes[at] === byte),
  },
  lookKey: {
    code: "GUNPACK_LOOK",
    text: TEXT.noLook,
    prep: (key) => String(key || ""),
    ok: () => true,
  },
  lookTarget: { code: "GUNPACK_LOOK", text: TEXT.noLook, ok: Boolean },
  ownComposition: {
    code: "GUNPACK_COMPOSE",
    text: TEXT.notOwn,
    ok: (pack) => Boolean(pack.composition),
  },
  plainSource: {
    code: "GUNPACK_COMPOSE",
    text: TEXT.nested,
    ok: (pack) => !pack.composition,
  },
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Возвращает значение после нормализации (prep), если оно прошло проверку.
function ensure(rule, value) {
  const { prep, ok, code, text } = RULES[rule];
  const prepared = prep ? prep(value) : value;
  if (!ok(prepared)) {
    throw fail(code, typeof text === "function" ? text(prepared) : text);
  }
  return prepared;
}

// Схемы собираемых записей: ключ, откуда значение, условие и «только на диск».
const OPEN_SCHEMA = [
  { key: "id", get: (c) => c.id },
  { key: "name", get: (c) => gunpack.packLabel(c.tree.name) || c.tree.name },
  { key: "sources", get: (c) => c.sources.map((source) => basename(source)) },
  { key: "openedAt", get: (c) => c.openedAt },
  {
    key: "containers",
    get: (c) => c.tree.containers.map((x) => describeContainer(x)),
  },
  { key: "warnings", get: (c) => c.tree.warnings },
  { key: "weaponFiles", get: (c) => c.scanned.inventory.weaponFiles },
  { key: "total", get: (c) => c.scanned.inventory.total },
  {
    key: "variants",
    get: (c) =>
      c.scanned.inventory.variants.map((v) =>
        pluck(v, VARIANT_FIELDS, c.scanned),
      ),
  },
  { key: "sourcePaths", get: (c) => c.sources, diskOnly: true },
  {
    key: "createdAt",
    get: (c) => c.prev?.createdAt || c.openedAt,
    diskOnly: true,
  },
  { key: "shots", get: (c) => c.prev?.shots || {} },
  {
    key: "looks",
    get: (c) => c.prev.looks,
    when: (c) => Boolean(c.prev?.looks),
  },
  {
    key: "installed",
    get: (c) => c.prev.installed,
    when: (c) => Boolean(c.prev?.installed),
  },
];
const DISK_ONLY_KEYS = new Set(
  OPEN_SCHEMA.filter((field) => field.diskOnly).map((field) => field.key),
);

const COMPOSE_TAIL = [
  { key: "createdAt", get: (c) => c.previous?.createdAt || c.summary.openedAt },
  { key: "shots", get: (c) => c.shots },
  {
    key: "looks",
    get: (c) => c.looks,
    when: (c) => Object.keys(c.looks).length > 0,
  },
  {
    key: "installed",
    get: (c) => c.previous.installed,
    when: (c) => Boolean(c.previous?.installed),
  },
];

function assemble(schema, context) {
  const record = {};
  for (const field of schema) {
    if (!field.when || field.when(context)) {
      record[field.key] = field.get(context);
    }
  }
  return record;
}

// Обходчик по схеме [ключ, значение по умолчанию (если задано), преобразование].
function pluck(source, fields, extra) {
  const picked = {};
  for (const [key, fallback, via] of fields) {
    const value =
      fallback === undefined ? source[key] : (source[key] ?? fallback);
    picked[key] = via ? via(value, source, extra) : value;
  }
  return picked;
}

const CONTAINER_FIELDS = [
  ["path"],
  ["kind"],
  ["encryption", undefined, (value) => value || null],
  ["opened", null],
];
const OIV_FIELDS = [["name"], ["author"]];
const VARIANT_FIELDS = [
  ["key"],
  ["label"],
  ["dlcpacks"],
  ["files"],
  ["bytes"],
  ["weapons", undefined, describeWeapons],
  ["attachments"],
];

function describeContainer(container) {
  const base = pluck(container, CONTAINER_FIELDS);
  return container.oiv
    ? { ...base, oiv: pluck(container.oiv, OIV_FIELDS) }
    : base;
}

function describeWeapons(weapons, variant, scanned) {
  return weapons.map((weapon) => {
    const slot = [variant.key, weapon.model].join("|");
    const [inspection, fingerprint] = [
      scanned.inspections,
      scanned.fingerprints,
    ].map((table) => table[slot]);
    return {
      ...weapon,
      checks: [...(weapon.checks || []), ...(inspection?.checks || [])],
      stats: inspection?.stats || null,
      parts: inspection?.parts || {},
      fingerprint: fingerprint || null,
    };
  });
}

// ---- слой диска ----
class PackStore {
  constructor(stateDir) {
    this.root = join(stateDir, "gunpacks");
    this.workDir = join(this.root, ".intake");
  }

  dir(id) {
    return join(this.root, id);
  }

  async load(id) {
    ensure("packId", id);
    const file = join(this.dir(id), "pack.json");
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (!text) {
      throw fail("GUNPACK_MISSING", TEXT.noPack);
    }
    return JSON.parse(text);
  }

  // undefined, если файла нет или JSON не разбирается
  async peek(id) {
    try {
      return JSON.parse(
        await fs.readFile(join(this.dir(id), "pack.json"), "utf8"),
      );
    } catch {
      return undefined;
    }
  }

  async save(id, record) {
    const file = join(this.dir(id), "pack.json");
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(record, null, 2)}\n`);
    await fs.rename(temp, file);
  }

  async create(id, record) {
    await fs.mkdir(this.dir(id), { recursive: true });
    await this.save(id, record);
  }

  async ids() {
    const entries = await fs
      .readdir(this.root, { withFileTypes: true })
      .catch(() => []);
    return entries
      .filter((e) => e.isDirectory() && ID_PATTERN.test(e.name))
      .map((e) => e.name);
  }

  async putShot(id, key, bytes) {
    await fs.mkdir(join(this.dir(id), "shots"), { recursive: true });
    await fs.writeFile(join(this.dir(id), "shots", `${key}.png`), bytes);
  }

  async getShot(id, key) {
    try {
      const file = await fs.readFile(join(this.dir(id), "shots", `${key}.png`));
      return new Uint8Array(file.buffer, file.byteOffset, file.length);
    } catch {
      return null;
    }
  }

  async resetShots(id) {
    await fs.rm(join(this.dir(id), "shots"), { recursive: true, force: true });
    await fs.mkdir(join(this.dir(id), "shots"), { recursive: true });
  }

  async copyShot(fromId, from, toId, to) {
    const source = join(this.dir(fromId), "shots", `${from}.png`);
    const target = join(this.dir(toId), "shots", `${to}.png`);
    return fs.copyFile(source, target).then(
      () => true,
      () => false,
    );
  }

  erase(id) {
    return fs.rm(this.dir(id), { recursive: true, force: true });
  }
}

// Отказ close() глотается, но синхронный сбой или не-промис уходят наружу.
async function closeQuietly(tree) {
  await tree.close().catch(() => {});
}

// ---- кэш деревьев: самые давние вытесняются ----
class TreeCache {
  #items = new Map();

  touch(id) {
    const tree = this.#items.get(id);
    if (tree) {
      this.#items.delete(id);
      this.#items.set(id, tree);
    }
    return tree;
  }

  async put(id, tree) {
    const doomed = [];
    const replaced = this.#items.get(id);
    if (replaced && replaced !== tree) {
      doomed.push(replaced);
    }
    this.#items.delete(id);
    this.#items.set(id, tree);
    while (this.#items.size > LIMITS.cache) {
      const [oldest] = this.#items.keys();
      doomed.push(this.#items.get(oldest));
      this.#items.delete(oldest);
    }
    for (const old of doomed) {
      await closeQuietly(old);
    }
  }

  async drop(id) {
    const tree = this.#items.get(id);
    this.#items.delete(id);
    if (tree) {
      await closeQuietly(tree);
    }
  }

  async clear() {
    const all = [...this.#items.values()];
    this.#items.clear();
    await Promise.all(all.map((tree) => closeQuietly(tree)));
  }
}

// ---- очередь правок pack.json: по одной цепочке на пак ----
class WriteQueue {
  #tails = new Map();

  run(id, job) {
    const result = (this.#tails.get(id) ?? Promise.resolve()).then(job);
    const tail = result.catch(() => {});
    this.#tails.set(id, tail);
    tail.then(() => {
      if (this.#tails.get(id) === tail) {
        this.#tails.delete(id);
      }
    });
    return result;
  }
}

// ---- приём источников ----
// Закрывает принятые деревья разом и ждёт все; ошибка закрытия важнее причины.
async function releaseAll(trees, cause) {
  const outcomes = await Promise.allSettled(trees.map((tree) => tree.close()));
  const refused = outcomes.find((outcome) => outcome.status === "rejected");
  throw refused ? refused.reason : cause;
}

// Источники принимаются по очереди.
async function receiveEach(list, options, accepted = []) {
  if (accepted.length === list.length) {
    return accepted;
  }
  let next;
  try {
    next = await packIntake.intakePack(list[accepted.length], options);
  } catch (cause) {
    await releaseAll(accepted, cause);
  }
  return receiveEach(list, options, [...accepted, next]);
}

async function intakeSources(sources, options) {
  const trees = await receiveEach(sources, options);
  if (trees.length === 1) {
    return trees[0];
  }
  const joined = (field) => trees.flatMap((tree) => tree[field]);
  return {
    name: trees.map((tree) => tree.name).join(", "),
    digest: null,
    files: joined("files"),
    containers: joined("containers"),
    warnings: joined("warnings"),
    close: () => Promise.all(trees.map((tree) => tree.close())),
  };
}

async function present(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function fingerprintOf(sources) {
  const hash = crypto.createHash("sha256");
  for (const source of [...sources].sort()) {
    const info = await fs.stat(source).catch(() => ({ size: 0, mtimeMs: 0 }));
    hash.update(`${source}\0${info.size}\0${info.mtimeMs}\n`);
  }
  return hash.digest("hex").slice(0, 24);
}

function inflateRaw(bytes) {
  // только виды (TypedArray/Buffer): у голого ArrayBuffer нет .buffer, Buffer.from откажет
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = zlib.inflateRawSync(view, {
    finishFlush: zlib.constants.Z_SYNC_FLUSH,
  });
  return new Uint8Array(out);
}

async function sourcesPresent(pack) {
  const found = await Promise.all(
    (pack.sourcePaths || []).map((path) => present(path)),
  );
  return found.every(Boolean);
}

async function compositionPresent(pack, records) {
  const wanted = pack.composition.picks.map((pick) => pick.packId);
  if (pack.composition.attachments) {
    wanted.push(pack.composition.attachments.packId);
  }
  for (const id of wanted) {
    const origin = records.get(id);
    if (!origin || (!origin.composition && !(await sourcesPresent(origin)))) {
      return false;
    }
  }
  return true;
}

class GunpackStudio {
  #rpf = null;

  constructor(store, hooks) {
    this.store = store;
    this.hooks = hooks;
    this.cache = new TreeCache();
    this.queue = new WriteQueue();
  }

  async #intakeWith(sources, extra) {
    const openRpf = await this.#rpfOpener();
    return this.hooks.intake(sources, {
      workDir: this.store.workDir,
      openRpf,
      ...extra,
    });
  }

  // ключи спрашиваются один раз; отказ тоже запоминается
  #rpfOpener() {
    const { keysDirectory } = this.hooks;
    this.#rpf ??= keysDirectory().then((dir) =>
      rpfReader.createRpfReader({ keysDirectory: dir || null }),
    );
    return this.#rpf;
  }

  // change получает запись и возвращает новую; undefined — менять нечего
  #amend(id, change) {
    return this.queue.run(id, async () => {
      const next = await change(await this.store.load(id));
      if (next !== undefined) {
        await this.store.save(id, next);
      }
    });
  }

  async open({ paths, onProgress } = {}) {
    const sources = ensure("sourceCount", paths);
    ensure("sourcePaths", sources);

    const tree = await this.#intakeWith(sources, { onProgress });
    try {
      const id = tree.digest
        ? tree.digest.slice(0, 24)
        : await fingerprintOf(sources);
      const scanned = await this.hooks.scan(tree, {
        name: tree.name,
        inflateRaw,
        onProgress,
      });
      ensure("weapons", scanned.inventory.weaponFiles);
      ensure("packId", id);

      const prev = await this.store.peek(id);
      const record = assemble(OPEN_SCHEMA, {
        id,
        tree,
        sources,
        scanned,
        prev,
        openedAt: this.hooks.now(),
      });
      await this.store.create(id, record);
      await this.cache.put(id, tree);
      return Object.fromEntries(
        Object.entries(record).filter(([key]) => !DISK_ONLY_KEYS.has(key)),
      );
    } catch (error) {
      await closeQuietly(tree);
      throw error;
    }
  }

  async list() {
    const records = new Map();
    for (const id of await this.store.ids()) {
      const pack = await this.store.peek(id);
      if (pack) {
        records.set(id, pack);
      }
    }
    const listed = [];
    for (const [id, pack] of records) {
      const available = pack.composition
        ? await compositionPresent(pack, records)
        : await sourcesPresent(pack);
      const entry = { ...pack, id, available };
      delete entry.sourcePaths;
      listed.push(entry);
    }
    return listed.sort((a, b) =>
      String(b.openedAt).localeCompare(String(a.openedAt)),
    );
  }

  async #originsOf(composition) {
    const wanted = new Set(composition.picks.map((pick) => pick.packId));
    if (composition.attachments) {
      wanted.add(composition.attachments.packId);
    }
    const origins = new Map();
    for (const id of wanted) {
      const pack = await this.store.load(id);
      ensure("plainSource", pack);
      origins.set(id, pack);
    }
    return origins;
  }

  async #carryShots(id, pairs, origins) {
    await this.store.resetShots(id);
    const shots = {};
    const looks = {};
    for (const { packId, from, to } of pairs) {
      const origin = origins.get(packId);
      if (
        origin.shots?.[from] &&
        (await this.store.copyShot(packId, from, id, to))
      ) {
        shots[to] = origin.shots[from];
      }
      if (origin.looks?.[from]) {
        looks[to] = origin.looks[from];
      }
    }
    return { shots, looks };
  }

  async compose(input = {}) {
    const composition = composing.normalizeComposition(input);
    const requested = String(input.id || "");
    const previous = requested ? await this.store.load(requested) : null;
    if (previous) {
      ensure("ownComposition", previous);
    }
    const id =
      requested || crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    const origins = await this.#originsOf(composition);

    const openedAt = this.hooks.now();
    const { summary, shots: pairs } = composing.composeSummary({
      id,
      composition,
      sources: origins,
      now: openedAt,
    });
    const carried = await this.#carryShots(id, pairs, origins);
    const record = {
      ...summary,
      ...assemble(COMPOSE_TAIL, { previous, summary, ...carried }),
    };
    await this.store.save(id, record);
    return { ...record, available: true };
  }

  async tree(packId) {
    const held = this.cache.touch(packId);
    if (held) {
      return held;
    }
    const pack = await this.store.load(packId);
    if (pack.composition) {
      return composing.composedTree(pack, (id) => this.tree(id));
    }
    const sources = pack.sourcePaths ?? [];
    for (const source of sources) {
      if (!(await present(source))) {
        throw fail("GUNPACK_SOURCE_GONE", TEXT.moved(basename(source)));
      }
    }
    const tree = await this.#intakeWith(sources, {});
    await this.cache.put(packId, tree);
    return tree;
  }

  async read({ packId, paths } = {}) {
    const wanted = ensure("readCount", paths);
    const tree = await this.tree(packId);
    const index = new Map(tree.files.map((file) => [file.path, file]));
    return wanted.reduce(async (done, path) => {
      const collected = await done;
      const file = index.get(path);
      ensure("fileKnown", { path, file });
      ensure("fileReadable", path);
      return [...collected, { path, bytes: await file.read() }];
    }, Promise.resolve([]));
  }

  async saveShot({ packId, key, bytes, meta } = {}) {
    const name = ensure("shotName", key);
    const image = ensure("shotImage", bytes);
    await this.store.load(packId);

    await this.store.putShot(packId, name, image);
    const length = Number(meta?.length);
    const entry = {
      savedAt: this.hooks.now(),
      ...(Number.isFinite(length) && length > 0 && length < 100 && { length }),
    };
    await this.#amend(packId, (pack) => ({
      ...pack,
      shots: { ...pack.shots, [name]: entry },
    }));
    return { key, ...entry };
  }

  async setLook({ packId, key, look } = {}) {
    const pack = await this.store.load(packId);
    const wanted = ensure("lookKey", key);
    const known = (pack.variants || []).some((variant) =>
      (variant.weapons || []).some(
        (weapon) =>
          weapon.kind !== "parts" &&
          gunpackIds.shotKey(variant, weapon.model) === wanted,
      ),
    );
    ensure("lookTarget", known);
    const text = gunpack.lookInput(look);
    await this.#amend(packId, (current) => {
      const looks = { ...current.looks };
      delete looks[wanted];
      return { ...current, looks: text ? { ...looks, [wanted]: text } : looks };
    });
    return { key: wanted, look: text };
  }

  async shots({ packId } = {}) {
    const pack = await this.store.load(packId);
    const recorded = pack.shots ? Object.keys(pack.shots) : [];
    const frames = {};
    for (const key of recorded.filter((name) => SHOT_KEY_PATTERN.test(name))) {
      const frame = await this.store.getShot(packId, key);
      if (frame) {
        frames[key] = frame;
      }
    }
    return frames;
  }

  async remove({ packId } = {}) {
    ensure("packId", packId);
    await this.cache.drop(packId);
    await this.store.erase(packId);
    return { removed: packId };
  }

  async pack(packId) {
    const { sourcePaths, ...rest } = await this.store.load(packId);
    void sourcePaths; // путь источника окну не отдаём
    return rest;
  }

  async setInstalled(packId, record) {
    await this.#amend(packId, (pack) => {
      const { installed, ...rest } = pack;
      void installed; // прежняя запись заменяется или снимается
      return record ? { ...rest, installed: record } : rest;
    });
    return record || null;
  }

  close() {
    return this.cache.clear();
  }
}

export function createGunpackStudio({
  stateDir,
  keysDirectory = async () => null,
  intake = intakeSources,
  scan = gunpack.scanGunpack,
  now = () => new Date().toISOString(),
}) {
  const studio = new GunpackStudio(new PackStore(stateDir), {
    keysDirectory,
    intake,
    scan,
    now,
  });
  return {
    open: (args) => studio.open(args),
    list: () => studio.list(),
    compose: (args) => studio.compose(args),
    read: (args) => studio.read(args),
    saveShot: (args) => studio.saveShot(args),
    setLook: (args) => studio.setLook(args),
    shots: (args) => studio.shots(args),
    remove: (args) => studio.remove(args),
    tree: (packId) => studio.tree(packId),
    pack: (packId) => studio.pack(packId),
    setInstalled: (packId, record) => studio.setInstalled(packId, record),
    close: () => studio.close(),
  };
}
