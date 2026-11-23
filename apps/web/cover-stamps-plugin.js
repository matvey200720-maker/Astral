import { createHash } from "node:crypto";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Путь строится только строками: глобальный URL в jsdom (vitest) — не node:url и file-адрес не разберёт.
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const LOADERS_FILE = join(PLUGIN_DIR, "src", "features", "workshop", "covers", "cover-loaders.js");
const COVERS_DIR = "/src/features/workshop/covers/";
const PACKAGES_DIR = "/node_modules/";
const UNKNOWN_VERSION = "?";
const STAMP_LENGTH = 16;

// Запись загрузчика с начала строки: ключ (кавычки по желанию) -> () => import("./Файл.js[x]")
const LOADER_RECORD = new RegExp(
  [
    "^\\s*",
    '"?([\\w-]+)"?',
    "\\s*:\\s*",
    "\\(\\)\\s*=>\\s*",
    'import\\("\\./([\\w-]+\\.jsx?)"',
  ].join(""),
  "gm",
);

function sha1Hex(data) {
  const hash = createHash("sha1");
  hash.update(data);
  return hash.digest("hex");
}

const forwardSlashes = (path) => path.split("\\").join("/");
const afterLastSrc = (path) => path.replace(/^.*\/src\//s, "");
const isPackagePath = (id) => forwardSlashes(id).includes(PACKAGES_DIR);

export function coverLoaderFiles(source) {
  const records = Array.from(String(source).matchAll(LOADER_RECORD), ([, kind, file]) => [kind, file]);
  return records.reduce((files, [kind, file]) => {
    files[kind] = file;
    return files;
  }, {});
}

export function moduleStampPart(id, options) {
  const code = options.code;
  // виртуальные модули Vite начинаются с NUL: у них нет файла, отпечаток берётся от кода
  if (id.startsWith("\0")) return `${id}:${sha1Hex(code || "")}`;
  const { read, packageOf } = options;

  const [file] = id.split("?");
  return packageOf(file) || `${afterLastSrc(forwardSlashes(file))}:${sha1Hex(read(file))}`;
}

export function graphStamp(parts) {
  const unique = Array.from(new Set(parts));
  const digest = sha1Hex(unique.sort().join("\n"));
  return `src-${digest.slice(0, STAMP_LENGTH)}`;
}

// Значение по ключу считается один раз и запоминается.
class Memo {
  #values = new Map();
  #compute;

  constructor(compute) {
    this.#compute = compute;
  }

  get(key) {
    if (!this.#values.has(key)) this.#values.set(key, this.#compute(key));
    return this.#values.get(key);
  }
}

// Нечитаемый файл считается пустым.
function readOrEmpty(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function manifestVersion(manifest) {
  try {
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version || UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

// Корень node_modules и имя пакета по пути файла; для не-пакета — null.
function splitPackagePath(file) {
  const path = forwardSlashes(file);
  const at = path.lastIndexOf(PACKAGES_DIR);
  if (at < 0) return null;
  const root = path.slice(0, at + PACKAGES_DIR.length);
  const [first, second] = path.slice(root.length).split("/");
  return { root, name: first.startsWith("@") ? `${first}/${second}` : first };
}

// «имя@версия»; манифест каждого пакета читается один раз за сборку.
class PackageIndex {
  #versions = new Memo(manifestVersion);

  describe(file) {
    const located = splitPackagePath(file);
    if (located === null) return null;
    return `${located.name}@${this.#versions.get(`${located.root}${located.name}/package.json`)}`;
  }
}

// Модули графа от корня: статические и ленивые импорты, пакеты не раскрываются. Пары [id, сведения].
function reachableModules(context, rootId) {
  const order = [rootId];
  const queued = new Set(order);
  const modules = [];
  for (let cursor = 0; cursor < order.length; cursor += 1) {
    const id = order[cursor];
    const info = context.getModuleInfo(id);
    modules.push([id, info]);
    if (!info || isPackagePath(id)) continue;
    [...info.importedIds, ...info.dynamicallyImportedIds]
      .filter((next) => !queued.has(next))
      .forEach((next) => {
        queued.add(next);
        order.push(next);
      });
  }
  return modules;
}

const findRoot = (ids, file) =>
  ids.find((id) => forwardSlashes(id.split("?")[0]).endsWith(`${COVERS_DIR}${file}`));

const scriptTag = (stampsJson) => ({
  tag: "script",
  children: `globalThis.__ASTRAL_COVER_STAMPS__=${stampsJson};`,
  injectTo: "head-prepend",
});

// Таблица «вид -> отпечаток» одного плагина.
class StampTable {
  #stamps = {};

  rebuild({ loaders, ids, context }) {
    const files = new Memo(readOrEmpty);
    const packages = new PackageIndex();
    const sources = { read: (file) => files.get(file), packageOf: (file) => packages.describe(file) };

    // прежняя таблица забывается; при ошибке посреди видов остаются уже готовые
    const stamps = (this.#stamps = {});
    Object.entries(loaders).forEach(([kind, file]) => {
      const root = findRoot(ids, file);
      if (root === undefined) return;
      const parts = reachableModules(context, root).map(([id, info]) =>
        moduleStampPart(id, { ...sources, code: info?.code }),
      );
      stamps[kind] = graphStamp(parts);
    });
  }

  tags() {
    if (Object.keys(this.#stamps).length === 0) return [];
    return [scriptTag(JSON.stringify(this.#stamps))];
  }
}

export function astralCoverStamps() {
  const table = new StampTable();

  return {
    name: "astral-cover-stamps",
    apply: "build",
    buildEnd() {
      const loaders = coverLoaderFiles(fs.readFileSync(LOADERS_FILE, "utf8"));
      table.rebuild({ loaders, ids: [...this.getModuleIds()], context: this });
    },
    transformIndexHtml: {
      order: "post",
      handler: () => table.tags(),
    },
  };
}
