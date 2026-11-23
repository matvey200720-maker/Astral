// Плоский список файлов мода одежды -> список вещей с моделями и наборами расцветок.
// Заодно: штатный ли контейнер у файла, корень набора, какие вещи показывать как мод
// и какие расцветки лежат без модели (перекраска).
import { isRockstarPack } from "@modovik/pack-intake/dlc-packs";
import { parseClothingPath } from "./names.js";
import { categoryOfComponent } from "./taxonomy.js";

const STREAM_LABEL = "стрим игры";
const UNNAMED_SET = "Основной";

// ложное значение — пустая строка, остальное — строкой
const asText = (value) => (value ? String(value) : "");
const lower = (text = "") => text.toLowerCase();
const pick = (record, names) => Object.fromEntries(names.map((name) => [name, record[name]]));

/* ---------- штатный контейнер: разбор пути по частям ---------- */

const PED_PREFIXES = ["mp_m_freemode_01", "mp_f_freemode_01"];
const X64_ARCHIVE = /x64[a-z]?\.rpf$/;
const PACK_SUFFIXES = ["_male", "_female"];

const isRpfFile = (part) => part.length > ".rpf".length && lower(part).endsWith(".rpf");

// Хвост …/x64/models/cdimages/<файл>.rpf: имя файла без «.rpf» или null.
function cdimagesFile(parts) {
  const last = parts.length - 1;
  if (last < 3 || !isRpfFile(parts[last])) return null;
  const [x64, models, cdimages] = parts.slice(last - 3, last).map((part) => lower(part));
  return x64 === "x64" && models === "models" && cdimages === "cdimages" ? parts[last].slice(0, -".rpf".length) : null;
}

// Стрим самой игры: x64[буква].rpf/models/cdimages/streamed….rpf, путь впереди любой.
function isGameStream(parts) {
  return parts.some((part, at) => {
    if (!X64_ARCHIVE.test(lower(part))) return false;
    if (lower(parts[at + 1]) !== "models" || lower(parts[at + 2]) !== "cdimages") return false;
    const tail = lower(parts.slice(at + 3).join("/"));
    return tail.length >= "streamed.rpf".length && tail.startsWith("streamed") && tail.endsWith(".rpf");
  });
}

// <имя>_male / <имя>_female, после них необязательное _p
function authorPackName(base) {
  const variants = lower(base).endsWith("_p") ? [base.slice(0, -2), base] : [base];
  for (const variant of variants) {
    const suffix = PACK_SUFFIXES.find((candidate) => lower(variant).endsWith(candidate));
    if (suffix && variant.length > suffix.length) return lower(variant.slice(0, -suffix.length));
  }
  return undefined;
}

// <имя> или <имя>_p; у пустого остатка «_p» остаётся именем целиком
function plainPackName(base) {
  return lower(base).endsWith("_p") && base.length > 2 ? base.slice(0, -2) : base;
}

const hasCollection = (folder) =>
  PED_PREFIXES.some((prefix) => lower(folder).startsWith(`${prefix}_`) && folder.length > prefix.length + 1);

const rockstarName = (name) => (name && isRockstarPack(name) ? lower(name) : undefined);

// Правила идут по порядку; undefined — «не мои», null — «дальше искать нечего».
const STOCK_RULES = [
  (parts) => (isGameStream(parts) ? STREAM_LABEL : undefined),
  (parts) => {
    const base = cdimagesFile(parts);
    return base === null ? undefined : authorPackName(base);
  },
  (parts, folder) => (hasCollection(folder) ? undefined : null),
  // <папка>/dlc.rpf/x64/models/cdimages/<любое>.rpf: DLC называет целая папка перед dlc.rpf
  (parts) => {
    const last = parts.length - 1;
    if (cdimagesFile(parts) === null || last < 5 || lower(parts[last - 4]) !== "dlc.rpf") return undefined;
    return rockstarName(parts[last - 5]);
  },
  (parts) => {
    const base = cdimagesFile(parts);
    return base === null ? undefined : rockstarName(plainPackName(base));
  },
];

export function stockDlcOf(container, folder) {
  const parts = asText(container).split("/");
  const ped = asText(folder);
  for (const rule of STOCK_RULES) {
    const found = rule(parts, ped);
    if (found !== undefined) return found;
  }
  return null;
}

export function rockstarDlc(name) {
  const text = asText(name);
  return text === STREAM_LABEL || Boolean(isRockstarPack(text));
}

/* ---------- корень и подпись набора ---------- */

const ARCHIVE_NAME = /\.(?:7z|zip|rar|oiv|rpf)$/i;
// служебные папки игры: у `dlc.rpf` вещи лежат в `x64/models/cdimages/<пак>.rpf` — это не название набора расцветок
const GAME_FOLDERS = new Set(["dlcpacks", "dlc_patch", "update", "x64", "mods", "cdimages"]);
const SCATTER_FOLDERS = new Set([
  "model", "models", "texture", "textures", "ydd", "ytd", "stream", "male", "female", "men", "women", "m", "f",
]);
const GENDERED_WORD = /^(?:муж|жен)\p{L}*$/iu;

const isScatter = (part) => SCATTER_FOLDERS.has(lower(part)) || GENDERED_WORD.test(part);
const isPedFolder = (part) => PED_PREFIXES.some((prefix) => lower(part).startsWith(prefix));

export function setRootOf(path) {
  const parts = asText(path).replaceAll("\\", "/").split("/");
  // «/<папка>/dlc.rpf»: корень — всё, что стоит перед первой такой парой
  const dlcAt = parts.findIndex((part, at) => at > 0 && part !== "" && lower(parts[at + 1]) === "dlc.rpf");
  if (dlcAt > 0) return parts.slice(0, dlcAt).join("/");
  const pedAt = parts.findIndex(isPedFolder);
  return parts.slice(0, pedAt > 0 ? pedAt : -1).join("/");
}

function labelOf(root) {
  const meaningful = (part) =>
    part && !ARCHIVE_NAME.test(part) && !isScatter(part) && !GAME_FOLDERS.has(lower(part));
  return root.split("/").findLast(meaningful) ?? UNNAMED_SET;
}

const newSet = (root, model) => ({ id: root, label: labelOf(root), root, model, textures: [] });

/* ---------- записи вещей ---------- */

const itemKey = (gender, collection, prop, component, drawable) =>
  [gender || "?", lower(collection || ""), prop ? "p" : "", component, drawable].join("|");

const keyOf = (entry) => itemKey(entry.gender, entry.collection, entry.prop, entry.component, entry.drawable);

// Поля вещи в порядке выдачи: null — взять из записи как есть, функция — вычислить.
const ITEM_FIELDS = [
  ["key", keyOf],
  ["gender", null],
  ["genderKnown", (record) => Boolean(record.gender)],
  ["ped", null],
  ["collection", null],
  ["folder", null],
  ["component", null],
  ["prop", null],
  ["drawable", null],
  ["modelSuffix", null],
  ["category", (record) => categoryOfComponent(record.component)?.id ?? null],
  ["models", () => []],
  ["sets", () => []],
  ["bundled", () => true],
];

// У перекраски нет моделей: суффикса нет, вещь не штатная, добавлен признак.
const REPAINT_OVERRIDES = [
  ["modelSuffix", () => null],
  ["bundled", () => false],
  ["retexture", () => true],
];

function buildItem(record, overrides = []) {
  const plan = new Map(ITEM_FIELDS);
  for (const [name, derive] of overrides) plan.set(name, derive);
  return Object.fromEntries([...plan].map(([name, derive]) => [name, derive ? derive(record) : record[name]]));
}

/* ---------- расцветки ---------- */

const stampOf = (colour) => Number(colour.file.modifiedMs) || 0;

// по букве; при равных — свежая раньше; от каждой буквы остаётся первая
function settleColours(colours) {
  const ordered = [...colours].sort((a, b) => {
    if (a.letter !== b.letter) return a.letter < b.letter ? -1 : 1;
    return stampOf(b) - stampOf(a);
  });
  const seen = new Set();
  return ordered.filter(({ letter }) => {
    if (seen.has(letter)) return false;
    seen.add(letter);
    return true;
  });
}

// Набор для текстуры: с тем же корнем, иначе единственный, иначе тот, у кого
// общее начало пути строго длиннее всех (при ничьей — никакой).
function closestSet(sets, root) {
  const exact = sets.find((set) => set.root === root);
  if (exact) return exact;
  if (sets.length === 1) return sets[0];
  const wanted = root.split("/");
  let best = null;
  let level = -1;
  for (const set of sets) {
    const have = set.root.split("/");
    let score = 0;
    while (score < wanted.length && score < have.length && wanted[score] === have[score]) score++;
    if (score > level) {
      best = set;
      level = score;
    } else if (score === level) {
      best = null;
    }
  }
  return best;
}

const isColourFolder = (set, root) =>
  root.startsWith(`${set.root}/`) && !isScatter(root.slice(root.lastIndexOf("/") + 1));

function placeTexture(set, entry) {
  if (entry.textureKind === "diffuse") {
    set.textures.push(pick(entry, ["letter", "race", "path", "file"]));
  } else if (entry.textureKind === "normal" || entry.textureKind === "specular") {
    set[entry.textureKind] = pick(entry, ["path", "file"]);
  }
}

/* ---------- группировка ---------- */

const containerOf = (path) => {
  const end = path.lastIndexOf(".rpf/");
  return end < 0 ? null : path.slice(0, end + ".rpf".length);
};

// Накопитель вещей: сначала принимает модели (они задают вещи), потом текстуры.
class Wardrobe {
  items = new Map();
  unmatched = [];

  addModel(entry) {
    const key = keyOf(entry);
    if (!this.items.has(key)) this.items.set(key, buildItem(entry));
    const item = this.items.get(key);
    const root = setRootOf(entry.path);
    const container = containerOf(entry.path);
    item.models.push({ ...pick(entry, ["path"]), root, container, file: entry.file });
    if (!container || stockDlcOf(container, entry.folder) === null) item.bundled = false;
    const set = item.sets.find((candidate) => candidate.root === root);
    if (set) set.model = entry.file;
    else item.sets.push(newSet(root, entry.file));
  }

  addTexture(entry) {
    const item = this.items.get(keyOf(entry));
    if (!item) {
      this.unmatched.push(entry);
      return;
    }
    const root = setRootOf(entry.path);
    let set = closestSet(item.sets, root);
    if (!set) {
      set = newSet(root, item.models[0].file);
      item.sets.push(set);
    } else if (isColourFolder(set, root)) {
      set = { ...newSet(root, set.model), from: set.id };
      item.sets.push(set);
    }
    placeTexture(set, entry);
  }

  harvest() {
    const items = [...this.items.values()];
    for (const item of items) {
      // набор модели, чьи расцветки целиком ушли в цветные папки, больше не нужен
      item.sets = item.sets.filter(
        (set) => set.textures.length > 0 || !item.sets.some((other) => other.from === set.id),
      );
      for (const set of item.sets) set.textures = settleColours(set.textures);
    }
    return items;
  }
}

export function groupClothingItems(files) {
  const byRole = new Map([["meta", []], ["model", []], ["texture", []]]);
  for (const file of files || []) {
    const parsed = parseClothingPath(file.path);
    if (parsed) byRole.get(parsed.role)?.push({ ...parsed, file });
  }
  const wardrobe = new Wardrobe();
  byRole.get("model").forEach((entry) => wardrobe.addModel(entry));
  byRole.get("texture").forEach((entry) => wardrobe.addTexture(entry));
  return { items: wardrobe.harvest(), meta: byRole.get("meta"), unmatched: wardrobe.unmatched };
}

/* ---------- какие вещи показывать ---------- */

export function modItems(items) {
  const own = items.filter((item) => !item.bundled);
  if (own.length === 0) return { shown: items, hidden: [] };
  return { shown: own, hidden: items.filter((item) => item.bundled) };
}

/* ---------- перекраска: расцветки без модели ---------- */

export function retextureItems(orphans) {
  const found = [...(orphans || [])].reduce((drafts, orphan) => {
    if (orphan.textureKind !== "diffuse") return drafts;
    const key = keyOf(orphan);
    const item = drafts.get(key) ?? buildItem(orphan, REPAINT_OVERRIDES);
    const root = setRootOf(orphan.file.path);
    let set = item.sets.find((candidate) => candidate.root === root);
    if (!set) {
      set = newSet(root, null);
      item.sets.push(set);
    }
    set.textures.push({ ...pick(orphan, ["letter", "race"]), path: orphan.file.path, file: orphan.file });
    return drafts.set(key, item);
  }, new Map());

  const items = [...found.values()];
  for (const item of items) {
    for (const set of item.sets) set.textures = settleColours(set.textures);
  }
  return items;
}
