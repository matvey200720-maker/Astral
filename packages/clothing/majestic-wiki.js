// Каталог одежды вики Majestic: адреса страниц, разбор двух форматов сайта
// (React Router и прежний Next.js) и вычисление файла вещи по калибровке паков.
import { COMPONENTS } from "./taxonomy.js";
import { assortmentItem } from "./assortment.js";
import { pictureAllowed } from "./project-items.js";

export const MAJESTIC_WIKI_HOST = "wiki.majestic-rp.ru";

// Вид вики -> компонент педа. Порядок ключей важен.
export const MAJESTIC_TYPES = Object.freeze({
  top: "jbib",
  legs: "lowr",
  shoes: "feet",
  watch: "p_lwrist",
  mask: "berd",
  decal: "decl",
  accessory: "teef",
  head: "p_head",
  bag: "hand",
  glasses: "p_eyes",
  ear: "p_ears",
  gloves: "uppr",
  undershirt: "accs",
});

const GENDERS = ["male", "female"];
const TYPE_BY_COMPONENT = new Map(Object.entries(MAJESTIC_TYPES).map(([type, component]) => [component, type]));

export function majesticType(component) {
  return TYPE_BY_COMPONENT.get(component) ?? null;
}

export function majesticWikiUrl({ gender, component, page = 1 }) {
  const type = TYPE_BY_COMPONENT.get(component);
  if (!type || !GENDERS.includes(gender)) return null;
  const path = `https://${MAJESTIC_WIKI_HOST}/ru/clothes/${[gender, type].join("/")}`;
  return page > 1 ? `${path}?page=${page}` : path;
}

// ---------- формат потока React Router и вызовы на страницах ----------

const WIRE = {
  maxNodes: 400_000,
  batchDepth: 8,
  nextTailWindow: 200,
  // служебные имена, которые разбор объектов потока пропускает
  reserved: new Set(["__proto__", "constructor", "prototype"]),
  // отрицательные ссылки -> особые значения; прочие отрицательные дают undefined
  specials: new Map([
    [-1, undefined],
    [-2, NaN],
    [-3, Infinity],
    [-4, -Infinity],
    [-5, undefined],
    [-6, -0],
    [-7, null],
  ]),
  enqueueCall: /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g,
  nextPushCall: /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g,
};
const KEY_SLOT = /^_(\d+)$/;

export function decodeTurboStream(flat) {
  if (!Array.isArray(flat) || flat.length === 0 || flat.length > WIRE.maxNodes) return null;

  const built = new Map();
  const remember = (index, value) => {
    built.set(index, value);
    return value;
  };
  // Значение по ссылке из списка или объекта; корень (isNode) берётся как узел.
  // Ссылка не целое число — возвращается как есть.
  function valueOf(ref, isNode = false) {
    if (!isNode) {
      if (!Number.isInteger(ref)) return ref;
      if (ref < 0) return WIRE.specials.get(ref);
      if (ref >= flat.length) return undefined;
    }
    if (built.has(ref)) return built.get(ref);
    const raw = flat[ref];
    if (Array.isArray(raw)) {
      // список с типовой меткой (дата, отложенное, множество) не поддерживается
      if (typeof raw[0] === "string") return remember(ref, null);
      const list = remember(ref, []);
      for (const item of raw) list.push(valueOf(item));
      return list;
    }
    if (raw === null || typeof raw !== "object") return raw;
    const record = remember(ref, {});
    for (const [key, target] of Object.entries(raw)) {
      const slot = KEY_SLOT.exec(key);
      const name = slot ? flat[Number(slot[1])] : undefined;
      if (typeof name === "string" && !WIRE.reserved.has(name)) record[name] = valueOf(target);
    }
    return record;
  }

  try {
    return valueOf(0, true);
  } catch {
    // в том числе переполнение стека на очень глубокой вложенности
    return null;
  }
}

// ---------- разбор страницы ----------

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// тексты вызовов `маркер("…json-строка…")`; негодные дают undefined
const quotedCalls = (page, pattern) => Array.from(page.matchAll(pattern), (match) => parseJson(match[1]));

// Узлы в глубину, сам узел раньше детей; не глубже batchDepth, повторно один узел не отдаётся.
function* nodesOf(node, depth = 0, seen = new Set()) {
  if (node === null || typeof node !== "object" || depth > WIRE.batchDepth || seen.has(node)) return;
  seen.add(node);
  yield node;
  for (const child of Object.values(node)) yield* nodesOf(child, depth + 1, seen);
}

// Порция — узел со списком вещей (results важнее items) и конечным total.
function findBatch(root) {
  for (const node of nodesOf(root)) {
    const list = [node.results, node.items].find(Array.isArray);
    if (list && Number.isFinite(Number(node.total))) return { node, list };
  }
  return null;
}

function readReactRouter(page) {
  const texts = quotedCalls(page, WIRE.enqueueCall).filter((text) => text !== undefined);
  if (texts.length === 0) return null;
  const [firstLine] = texts.join("").split("\n");
  const found = findBatch(decodeTurboStream(parseJson(firstLine)));
  if (!found) return null;
  const { node, list } = found;
  return {
    items: list,
    total: Number(node.total),
    skip: Number(node.skip) || 0,
    limit: Number(node.limit) || list.length,
  };
}

const BRACKET_OR_QUOTE = /["[\]{}]/g;
const QUOTED_TEXT = /"[^"\\]*(?:\\[\s\S][^"\\]*)*"/y;

// Позиция скобки, закрывающей массив, открытый в start. Сканер прыгает от одного
// значимого знака к другому; скобки считаются без различия вида, строки в кавычках
// пропускаются целиком. -1, если массив (или строка внутри) не закрылся.
function closingIndex(text, start) {
  let open = 0;
  BRACKET_OR_QUOTE.lastIndex = start;
  for (let hit = BRACKET_OR_QUOTE.exec(text); hit; hit = BRACKET_OR_QUOTE.exec(text)) {
    if (hit[0] === '"') {
      QUOTED_TEXT.lastIndex = hit.index;
      if (!QUOTED_TEXT.test(text)) return -1;
      BRACKET_OR_QUOTE.lastIndex = QUOTED_TEXT.lastIndex;
    } else {
      open += "[{".includes(hit[0]) ? 1 : -1;
      if (open === 0) return hit.index;
    }
  }
  return -1;
}

// Места, где может начинаться порция: сначала все `"results":[`, потом все `"items":[`.
const BATCH_MARKERS = [/"results":\[/g, /"items":\[/g];
const batchStarts = (text) =>
  BATCH_MARKERS.flatMap((marker) => Array.from(text.matchAll(marker), (hit) => hit.index + hit[0].length - 1));

const TOTAL_TAIL = /,"total":(\d+)/y;

// За массивом без пробела должно идти `,"total":<цифры>`, а сам массив — читаться как JSON.
function batchAt(text, start) {
  const end = closingIndex(text, start);
  if (end < 0) return null;
  TOTAL_TAIL.lastIndex = end + 1;
  const total = TOTAL_TAIL.exec(text);
  const items = total ? parseJson(text.slice(start, end + 1)) : undefined;
  if (items === undefined) return null;

  const tail = text.slice(end + 1, end + 1 + WIRE.nextTailWindow);
  const numberAfter = (key) => {
    const hit = new RegExp(`"${key}":(\\d+)`).exec(tail);
    return hit ? Number(hit[1]) : null;
  };
  return {
    items,
    total: Number(total[1]),
    skip: numberAfter("skip") ?? 0,
    limit: numberAfter("limit") ?? items.length,
  };
}

function readNext(page) {
  const text = quotedCalls(page, WIRE.nextPushCall)
    .map((chunk) => chunk ?? "")
    .join("");
  for (const start of batchStarts(text)) {
    const batch = batchAt(text, start);
    if (batch) return batch;
  }
  return null;
}

// формат React Router проверяется первым, прежний Next.js — запасной
const PAGE_READERS = [readReactRouter, readNext];

export function parseMajesticWikiPage(html) {
  const page = String(html || "");
  return PAGE_READERS.reduce((found, read) => found ?? read(page), null);
}

// ---------- вещь вики в своей форме ----------

const MAX_COLOURS = 26;
const MAX_COLOUR_NAME = 120;
const MAX_IMAGE_URL = 400;
const MAX_WIKI_NUMBER = 99_999;
const IMAGE_URL = /^https:\/\/[a-z0-9.-]+\//i;

function colourOf(entry) {
  const name = String(entry?.name ?? "").split(/\s+/).filter(Boolean).join(" ");
  const url = String(entry?.imageUrl ?? "");
  const usable = IMAGE_URL.test(url) && url.length < MAX_IMAGE_URL;
  return { name: name.slice(0, MAX_COLOUR_NAME), image: usable ? url : "" };
}

const summarize = (colours) => ({
  names: colours.flatMap((colour) => (colour.name ? [colour.name] : [])),
  images: colours.map((colour) => colour.image),
  textures: Math.max(1, colours.length),
});

export function normalizeWikiItem(raw) {
  const component = MAJESTIC_TYPES[raw?.type];
  if (!component || !GENDERS.includes(raw.gender)) return null;
  const drawable = Number(raw.drawable);
  const inRange = Number.isInteger(drawable) && Math.min(Math.max(drawable, 0), MAX_WIKI_NUMBER) === drawable;
  if (!inRange) return null;

  const listed = Array.isArray(raw.textures) ? raw.textures : [];
  const colours = Array.from({ length: Math.min(listed.length, MAX_COLOURS) }, (_, i) => colourOf(listed[i]));
  return Object.assign({ gender: raw.gender, component, drawable }, summarize(colours));
}

// ---------- калибровка ----------

const comparable = (name) =>
  String(name || "")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

const kindKey = (gender, component) => JSON.stringify([gender, component]);
const colourKey = (gender, component, name) => JSON.stringify([gender, component, name]);

// (пол, вид, имя расцветки) -> вещи вики
function colourIndex(wikiItems) {
  const index = new Map();
  for (const item of wikiItems) {
    for (const name of new Set(item.names.map(comparable))) {
      const slot = colourKey(item.gender, item.component, name);
      const bucket = index.get(slot) ?? new Set();
      bucket.add(item);
      index.set(slot, bucket);
    }
  }
  return index;
}

// Якорь годится, если его имя указывает ровно на одну вещь вики того же пола и вида.
function wikiItemFor(anchor, index) {
  if (anchor?.server !== "majestic" || !anchor.folder || !anchor.name) return null;
  const found = index.get(colourKey(anchor.gender, anchor.component, comparable(anchor.name)));
  return found?.size === 1 ? [...found][0] : null;
}

const PACK_STATUS = { 1: "single", 2: "range" };

// Якоря одного пака: сквозной номер вещи вики минус номер файла даёт сдвиг пака.
class PackLedger {
  constructor(folder, item) {
    this.key = `${item.gender}|${item.component}|${folder}`;
    this.folder = folder;
    this.gender = item.gender;
    this.component = item.component;
    this.anchors = [];
  }

  note(anchor, item) {
    if (this.anchors.every((known) => known.global !== item.drawable)) {
      this.anchors.push({ name: anchor.name, local: anchor.drawable, global: item.drawable });
    }
  }

  report() {
    const shifts = new Set(this.anchors.map(({ local, global }) => global - local));
    const [from, to] = this.anchors.reduce(
      ([low, high], { global }) => [Math.min(low, global), Math.max(high, global)],
      [Infinity, -Infinity],
    );
    const disputed = shifts.size > 1;
    return {
      key: this.key,
      folder: this.folder,
      gender: this.gender,
      component: this.component,
      anchors: this.anchors,
      status: disputed ? "conflict" : PACK_STATUS[Math.min(this.anchors.length, 2)],
      offset: disputed ? null : [...shifts][0],
      from,
      to,
    };
  }
}

function collectPacks(anchors, index) {
  const ledgers = new Map();
  for (const anchor of anchors) {
    const item = wikiItemFor(anchor, index);
    if (!item) continue;
    const draft = new PackLedger(anchor.folder, item);
    const ledger = ledgers.get(draft.key) ?? draft;
    ledger.note(anchor, item);
    ledgers.set(ledger.key, ledger);
  }
  return Array.from(ledgers.values(), (ledger) => ledger.report());
}

function firstAllowedPicture(images) {
  for (const url of images ?? []) {
    if (pictureAllowed(url)) return url;
  }
  return null;
}

// Колонки отключённой вещи в том порядке, в каком они выдаются наружу.
const DISABLED_COLUMNS = [
  "key",
  "server",
  "gender",
  "component",
  "prop",
  "folder",
  "collection",
  "drawable",
  "textures",
  "name",
  "shop",
  "preview",
  "aliases",
  "sources",
  "mods",
  "disabled",
];

function disabledItem(item, name, preview) {
  const values = {
    sources: ["external"],
    disabled: true,
    mods: 0,
    aliases: item.names,
    preview,
    shop: null,
    name,
    textures: item.textures,
    drawable: item.drawable,
    collection: null,
    folder: null,
    prop: Boolean(COMPONENTS[item.component]?.prop),
    component: item.component,
    gender: item.gender,
    server: "majestic",
    key: `wiki|${item.gender}|${item.component}|${item.drawable}`,
  };
  return Object.fromEntries(DISABLED_COLUMNS.map((column) => [column, values[column]]));
}

// Вещь вики -> вещь ассортимента: по месту в игре, по единственному паку-владельцу или отключённая.
function resolveItem(item, packsByKind) {
  const preview = firstAllowedPicture(item.images);
  const pictureKind = preview ? "official" : null;
  const name = item.names[0] ?? null;
  const external = (folder, drawable, textures) =>
    assortmentItem(
      { server: "majestic", folder, drawable, component: item.component, textures, name, preview },
      "external",
    );

  const attempts = [
    () => {
      if (!item.place) return null;
      const placed = external(item.place.folder, item.place.drawable, item.place.textures || item.textures);
      return placed && { ...placed, aliases: item.names, pictureKind, byGame: true };
    },
    () => {
      const owners = (packsByKind.get(kindKey(item.gender, item.component)) ?? []).filter(
        (pack) => pack.status !== "conflict" && pack.from <= item.drawable && item.drawable <= pack.to,
      );
      if (owners.length !== 1) return null;
      const computed = external(owners[0].folder, item.drawable - owners[0].offset, item.textures);
      return computed && { ...computed, aliases: item.names, pictureKind, computed: true };
    },
  ];
  for (const attempt of attempts) {
    const made = attempt();
    if (made) return made;
  }
  return disabledItem(item, name, preview);
}

export function calibrateMajestic(wikiItems, anchors) {
  const index = colourIndex(wikiItems);
  const packs = collectPacks(anchors, index);
  const packsByKind = new Map();
  for (const pack of packs) {
    const kind = kindKey(pack.gender, pack.component);
    packsByKind.set(kind, [...(packsByKind.get(kind) ?? []), pack]);
  }
  return { packs, items: wikiItems.map((item) => resolveItem(item, packsByKind)) };
}
