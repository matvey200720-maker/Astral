// Породы растительности по описи игры: какие файлы части к чему относятся и как назвать часть словами.

import inventory from "@modovik/climb-contract/recolor/inventory/vegetation";
import {
  VEGETATION_SPECIES,
  vegetationSpeciesOf,
} from "@modovik/climb-contract/recolor/vegetation";

const EXTRA_LABELS = [
  ["agave", "Агавы"],
  ["cactus", "Кактусы"],
  ["ivy", "Плющ"],
  ["flowers", "Цветы"],
  ["weeds", "Сорняки"],
  ["grass", "Трава"],
  ["ground", "Земля"],
];

// Порядок строк важен: порода plant дробится по первой подходящей.
const PLANT_SPLITS = [
  ["agave", ["agave", "aloe"]],
  ["cactus", ["cact"]],
  ["ivy", ["ivy"]],
  ["flowers", ["flower", "poppy", "lupin", "daisy", "tulip"]],
  ["weeds", ["weed"]],
];

const GRASS_MAP = /_grass_\d+\.ymap$/i;
const MODEL_EXTENSIONS = [".ydr", ".ydd", ".yft"];
const DICTIONARY_EXTENSION = ".ytd";
const TEXTURE_LIMIT = 40;
const MODEL_LIMIT = 3;

function hasExtension(lowerName, extensions) {
  return extensions.some((ext) => lowerName.endsWith(ext));
}

function refineKind(lowerName, species) {
  if (lowerName.includes("weed")) return "weeds";
  if (species !== "plant") return species;
  const split = PLANT_SPLITS.find(([, words]) => words.some((word) => lowerName.includes(word)));
  return split ? split[0] : species;
}

class VegetationAtlas {
  files = new Map();
  leafOwners = new Map();
  lodCards = new Set();
  labels = new Map(VEGETATION_SPECIES.map(({ id, label }) => [id, label]));

  constructor({ trees = [], models = [], treeLods = [] }) {
    for (const [id, label] of EXTRA_LABELS) this.labels.set(id, label);
    for (const tree of trees) this.addTree(tree);
    for (const model of models) this.addModel(model);
    for (const lod of treeLods) {
      for (const texture of lod.textures ?? []) this.lodCards.add(String(texture).toLowerCase());
    }
  }

  addTree({ name, species, leaves = [] }) {
    const file = String(name).toLowerCase();
    const kind = refineKind(file, species || vegetationSpeciesOf(file));
    this.files.set(file, kind);
    for (const leaf of leaves) {
      const key = String(leaf).toLowerCase();
      if (!this.leafOwners.has(key)) this.leafOwners.set(key, []);
      this.leafOwners.get(key).push({ file, kind });
    }
  }

  addModel(name) {
    const file = String(name).toLowerCase();
    if (!this.files.has(file)) this.files.set(file, refineKind(file, vegetationSpeciesOf(file)));
  }

  labelOf(id) {
    return this.labels.get(id) ?? id;
  }

  cardKind(lowerLeaf) {
    return refineKind(lowerLeaf, vegetationSpeciesOf(lowerLeaf));
  }
}

// Опись разбирается при первом обращении.
let cachedAtlas = null;
function atlas() {
  cachedAtlas ??= new VegetationAtlas(inventory);
  return cachedAtlas;
}

export function stockVegetationKind(name) {
  return atlas().files.get(String(name || "").toLowerCase()) ?? null;
}

class GroupBook {
  groups = new Map();

  open(id) {
    if (!this.groups.has(id)) {
      this.groups.set(id, {
        id,
        files: new Set(),
        spellings: new Set(),
        scores: new Map(),
        count: null,
        far: false,
        near: false,
      });
    }
    return this.groups.get(id);
  }

  score(group, file) {
    group.scores.set(file, (group.scores.get(file) ?? 0) + 1);
    group.near = true;
  }

  countsFile(lowerName) {
    return [...this.groups.values()].some((group) => group.files.has(lowerName));
  }

  finish(labelOf) {
    const rows = [...this.groups.values()].map((group) => ({
      id: group.id,
      label: labelOf(group.id),
      count: group.count ?? group.files.size,
      textures: [...group.spellings].sort().slice(0, TEXTURE_LIMIT),
      models: [...group.scores]
        .sort(([, left], [, right]) => right - left)
        .slice(0, MODEL_LIMIT)
        .map(([file]) => file),
      lod: group.far && !group.near,
    }));
    return rows.sort(
      (a, b) =>
        Number(b.id === "ground") - Number(a.id === "ground") ||
        b.textures.length - a.textures.length ||
        b.count - a.count,
    );
  }
}

function addLeaf(book, map, lowerName, leaf) {
  const key = String(leaf).toLowerCase();
  const owners = map.leafOwners.get(key);
  if (owners) {
    for (const { file, kind } of owners) {
      const group = book.open(kind);
      group.files.add(lowerName);
      group.spellings.add(leaf);
      book.score(group, file);
    }
  } else if (map.lodCards.has(key)) {
    const group = book.open(map.cardKind(key));
    group.files.add(lowerName);
    group.spellings.add(leaf);
    group.far = true;
  }
}

export function vegetationGroupsOf(files = [], { grassMaps = 0, ground = false } = {}) {
  const map = atlas();
  const book = new GroupBook();
  const replacedModels = [];

  for (const file of files) {
    const lowerName = String(file.name || "").toLowerCase();
    const kind = map.files.get(lowerName);
    if (kind) {
      const group = book.open(kind);
      group.files.add(lowerName);
      book.score(group, lowerName);
      if (hasExtension(lowerName, MODEL_EXTENSIONS)) replacedModels.push(lowerName);
    }
    for (const leaf of file.textures ?? []) {
      if (leaf) addLeaf(book, map, lowerName, leaf);
    }
  }

  if (grassMaps) {
    const group = book.open("grass");
    group.count = grassMaps;
    group.near = true;
  }

  if (ground) {
    const leftovers = files.filter((file) => {
      const lowerName = String(file.name || "").toLowerCase();
      return lowerName.endsWith(DICTIONARY_EXTENSION) && !book.countsFile(lowerName);
    });
    if (leftovers.length) book.open("ground").count = leftovers.length;
  }

  if (book.groups.size === 0) return null;
  return {
    groups: book.finish((id) => map.labelOf(id)),
    replacedModels: replacedModels.sort(),
  };
}

export function vegetationTitle(groups = [], { limit = 3 } = {}) {
  const clear = groups.filter((group) => !group.lod);
  const shown = (clear.length ? clear : groups).slice(0, limit);
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0].label ?? "";

  const [first, ...others] = shown;
  const words = others.map((group) => group.label.toLowerCase());
  const last = words.pop();
  return `${[first.label ?? "", ...words].join(", ")} и ${last}`;
}

export function vegetationWords(groups = [], { limit = 4 } = {}) {
  return vegetationTitle(groups, { limit });
}

const PART_EXTENSIONS = [DICTIONARY_EXTENSION, ...MODEL_EXTENSIONS];

// Сбой чтения или разбора оставляет файл без листов, но не отклоняет весь вызов.
// Запись, а не список: обещание из textureNames не должно разворачиваться при возврате.
async function recordOfFile(file, name, textureNames) {
  if (!textureNames) return { name, textures: [] };
  try {
    const bytes = new Uint8Array(await file.read());
    return { name, textures: textureNames(name, bytes) || [] };
  } catch {
    return { name, textures: [] };
  }
}

export async function vegetationOfFiles(files = [], { textureNames = null, ground = false } = {}) {
  const records = [];
  let grassMaps = 0;
  for (const file of files) {
    const name = String(file?.name || "");
    if (GRASS_MAP.test(name)) {
      grassMaps += 1;
    } else if (hasExtension(name.toLowerCase(), PART_EXTENSIONS)) {
      records.push(await recordOfFile(file, name, textureNames));
    }
  }
  return vegetationGroupsOf(records, { grassMaps, ground });
}
