import fs from "node:fs/promises";
import path from "node:path";
import { listBesideCopies } from "./restore-point-beside.js";

const words = (text) => text.split(" ");

export const STORAGE_KINDS = Object.freeze(
  Object.fromEntries(
    words(
      "downloads:A engineAssets:A vegetationContent:A rebuildCache:A workPackages:A derived:A chromiumCache:A updates:A mods:B works:W restorePoints:C copyStore:C original:C rebases:C dlc:C composites:C recipes:C patches:C originals:C other:C",
    ).map((pair) => pair.split(":")),
  ),
);

export const CHROMIUM_CACHE_DIRS = Object.freeze("Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache".split("|"));

// Если у файла несколько мест в Astral, он числится за видом, стоящим в списке раньше.
const KIND_PRIORITY = words(
  "original restorePoints copyStore rebases dlc composites recipes works mods patches originals other vegetationContent rebuildCache workPackages derived engineAssets downloads chromiumCache updates",
);

// Производные кэши, у которых единица вытеснения — первые три звена пути.
const DERIVED_CACHES = new Set(
  words(
    "weapon-icons part-geometry world-map-geometry world-map-tiles world-map-sessions clothing-index majestic-wiki pack-sources bootstrap loader-cache weapon-models combat-decals foreign-check cloud-hats workshop-textures shop-scenes world-place-scenes",
  ),
);

const ORIGINALS_SUFFIXES = words("-base -bases -originals");

// Разобранный путь: lower — звенья для сравнения, orig — те же звенья в исходном написании.
function reading(relative) {
  const orig = relative.split("/").filter(Boolean);
  const lower = orig.map((part) => part.toLowerCase());
  return { orig, lower, size: orig.length, head: (count) => orig.slice(0, count).join("/"), last: lower.at(-1) };
}

const verdict = (kind, unit) => ({ kind, unit: unit === undefined ? null : unit });

const nativeKind = (third, last) => {
  if (third === "chunks") return "copyStore";
  if (third !== "anchors") return "restorePoints";
  return last.endsWith(".rpf") ? "original" : "copyStore";
};

function payloadVerdict(third, view) {
  if (third === "_rpf-composites") return verdict("composites");
  if (/^[_@]/.test(third)) return verdict("other");
  return verdict(third.startsWith("local-") ? "works" : "mods", view.head(3));
}

function backupsRoot(view) {
  const [, area, third] = view.lower;
  switch (area) {
    case "native-rpf":
      return verdict(nativeKind(third, view.last));
    case "bases":
      if (view.lower.includes("update-rebases")) return verdict("rebases");
      return verdict(view.last.endsWith(".original.rpf") ? "original" : "dlc");
    /* Рецепты сборок «одной записи вместо двух» и закреплённые в них источники (`recipes/<цель>/sources`): нужны «Починить», уборка их не трогает. */
    case "recipes":
      return verdict("recipes");
    case "payloads":
      return view.size > 2 ? payloadVerdict(third, view) : null;
    default:
      return null;
  }
}

const RECOLOR_AREAS = [
  [(area) => area === "content" || area.startsWith("build-index"), (view) => verdict("vegetationContent", view.head(3) + "/content")],
  [(area) => area === "cache", (view) => verdict("rebuildCache", view.head(4))],
  [(area, view) => area === "packages" && view.size > 5, (view) => verdict("workPackages", view.head(5))],
];

function recolorSet(view) {
  if (view.lower[1] !== "recolor" || view.size <= 3) return null;
  const area = view.lower[3];
  const rule = RECOLOR_AREAS.find(([matches]) => matches(area, view));
  return rule ? rule[1](view) : null;
}

function packagesFolder(view) {
  const at = view.lower.findIndex((part, index) => index > 1 && part === "packages");
  if (at < 0) return null;
  const clothing = view.lower[1] === "clothing-replacements";
  const depth = at + (clothing ? 3 : 2);
  const complete = view.size > depth && (!clothing || view.lower[at + 2] === "payload");
  if (complete) return verdict("workPackages", view.head(depth));
  return clothing ? verdict("other") : null;
}

function namedWorkFolder(view) {
  if (!view.lower[1].endsWith("-work")) return null;
  return view.size > 3 ? verdict("workPackages", view.head(3)) : null;
}

// Глубина единицы вытеснения по первому звену; 0 — правило не сработало.
const DERIVED_AREAS = new Map([
  ["optimization", (third) => ((third ?? "").startsWith("texture-levels") ? 4 : 0)],
  [
    "arena-editor",
    (third, fourth) => {
      if (third === "hall-models") return 4;
      return third === "mod-hall" && (fourth === "hall-models" || fourth === "majestic-halls") ? 5 : 0;
    },
  ],
  ["mega-mall-editor", (third) => (third === "section-models" || third === "building-models" ? 4 : 0)],
  ["sound-studio", (third) => (words("banks vanilla-banks audio-meta").includes(third) ? 5 : 0)],
  ["clothing-models", (third, fourth, size) => (third !== "catalog" && size > 3 ? 3 : 0)],
]);

function derivedFolder(view) {
  const [, area, third, fourth] = view.lower;
  const measure = DERIVED_AREAS.get(area);
  const depth = (measure ? measure(third, fourth, view.size) : 0) || (DERIVED_CACHES.has(area) ? 3 : 0);
  return depth ? verdict("derived", view.head(depth)) : null;
}

function suffixedFolder(view) {
  const area = view.lower[1];
  const kinds = [
    ["patches", area.endsWith("-patches")],
    ["originals", ORIGINALS_SUFFIXES.some((suffix) => area.endsWith(suffix)) || area === "sky-textures"],
  ];
  const hit = kinds.find(([, matched]) => matched);
  return hit ? verdict(hit[0]) : null;
}

// Правила для путей внутри backups/, первое сработавшее побеждает.
const inBackups = (view) =>
  backupsRoot(view) ??
  recolorSet(view) ??
  packagesFolder(view) ??
  namedWorkFolder(view) ??
  derivedFolder(view) ??
  suffixedFolder(view) ??
  verdict("other");

export function classify(relative) {
  const view = reading(relative);
  const top = view.lower[0];
  switch (top) {
    case "downloads":
      return verdict("downloads", view.head(3));
    case "engine-assets":
      return verdict("engineAssets", relative);
    case "backups":
      return view.size < 2 ? verdict("other") : inBackups(view);
    default:
      return verdict("other");
  }
}

// Обход стеком: файлы папки считаются сразу, подпапки берутся с последней по порядку чтения.
async function walkFiles(root, onFile) {
  const visit = async (dir, trail) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const folders = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        folders.push(entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      let info;
      try {
        info = await fs.stat(path.join(dir, entry.name), { bigint: true });
      } catch {
        continue;
      }
      onFile({ trail: [...trail, entry.name], info });
    }
    for (const name of folders.reverse()) await visit(path.join(dir, name), [...trail, name]);
  };
  await visit(root, []);
}

// Учёт файлов по паре «устройство:номер»: одна и та же жёсткая ссылка не считается дважды.
function createLedger() {
  const files = new Map();

  const add = (info, place) => {
    const key = [info.dev, info.ino].map(String).join(":");
    const touched = Math.max(Number(info.mtimeMs), Number(info.atimeMs));
    const known = files.get(key);
    if (known) {
      known.places.push(place);
      known.lastUsed = Math.max(known.lastUsed, touched);
    } else {
      files.set(key, { size: Number(info.size), links: Number(info.nlink), places: [place], lastUsed: touched });
    }
  };

  const rank = (place) => KIND_PRIORITY.indexOf(place.kind);
  const unitOf = (units, main, file) => {
    if (!units.has(main.unit)) {
      units.set(main.unit, { kind: main.kind, path: main.unit, bytes: 0, freeable: 0, lastUsed: file.lastUsed });
    }
    return units.get(main.unit);
  };

  const report = () => {
    const all = [...files.values()];
    const sharedFiles = all.filter((file) => file.links > file.places.length);
    const owned = all.filter((file) => !(file.links > file.places.length));
    const kinds = Object.fromEntries(Object.keys(STORAGE_KINDS).map((kind) => [kind, { bytes: 0, freeable: 0, files: 0 }]));
    const units = new Map();

    owned.forEach((file) => {
      const main = file.places.reduce((best, place) => (rank(place) < rank(best) ? place : best));
      const alone = file.places.every((place) => place.kind === main.kind && place.unit === main.unit);
      const stat = kinds[main.kind];
      stat.bytes += file.size;
      stat.files += 1;
      if (alone) stat.freeable += file.size;
      if (!main.unit) return;
      const unit = unitOf(units, main, file);
      unit.bytes += file.size;
      if (alone) unit.freeable += file.size;
      unit.lastUsed = Math.max(unit.lastUsed, file.lastUsed);
    });

    return {
      bytes: owned.reduce((total, file) => total + file.size, 0),
      sharedWithGame: sharedFiles.reduce((total, file) => total + file.size, 0),
      kinds,
      units: [...units.values()].sort((a, b) => a.lastUsed - b.lastUsed),
    };
  };

  return { add, report };
}

export async function censusAstral(options) {
  const { cacheRoot } = options;
  const pointsFolder = options.pointsFolder === undefined ? null : options.pointsFolder;
  const userDataRoot = options.userDataRoot === undefined ? null : options.userDataRoot;
  const updates = options.updates === undefined ? null : options.updates;
  const ledger = createLedger();
  const root = path.resolve(cacheRoot);

  const inCache = ({ trail, info }) => {
    const { kind, unit } = classify(trail.join("/"));
    ledger.add(info, { kind, unit: unit && path.join(root, ...unit.split("/")) });
  };
  await walkFiles(root, inCache);

  const outside = pointsFolder ? path.relative(root, path.resolve(pointsFolder)).startsWith("..") : false;
  if (outside) {
    await walkFiles(path.resolve(pointsFolder), ({ trail, info }) => {
      const { kind } = classify("backups/native-rpf/" + trail.join("/"));
      ledger.add(info, { kind, unit: null });
    });
  }

  // «До» рядом с живым архивом (установка из операций на другом томе, `restore-point-beside.js`): файл Astral в папке игры,
  // место точки отката. Номер файла тот же, что у ссылки в кэше, если она есть, — один файл считается один раз.
  const pointsHome = pointsFolder ? path.resolve(pointsFolder) : path.join(root, "backups", "native-rpf");
  for (const { file } of await listBesideCopies(path.join(pointsHome, "restore-points"))) {
    try {
      ledger.add(await fs.stat(file, { bigint: true }), { kind: "restorePoints", unit: null });
    } catch {
      // файл ушёл, пока считали, — его и нет
    }
  }

  // Папки, которые считаются целиком одной единицей: кэш Chromium, затем устаревшие обновления.
  // Каждая следующая папка определяется после обхода предыдущей.
  const wholeFolder = (kind, dir) => walkFiles(dir, ({ info }) => ledger.add(info, { kind, unit: dir }));
  if (userDataRoot) {
    for (const name of CHROMIUM_CACHE_DIRS) await wholeFolder("chromiumCache", path.join(userDataRoot, name));
  }
  for (const dir of [...(updates?.stale || [])]) await wholeFolder("updates", dir);
  if (updates?.appOld) await wholeFolder("updates", updates.appOld);

  return ledger.report();
}
