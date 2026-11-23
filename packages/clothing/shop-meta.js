/*
 * Магазинные метаданные одежды из игры — `mp_m_freemode_01_<дополнение>_shop.meta`.
 *
 * У каждого дополнения GTA Online (`dlcpacks/mpheist3`, `mpbiker`…) есть пара
 * таких файлов — мужской и женский. Это обычный XML (`ShopPedApparel`), а не
 * двоичная мета: в нём лежит всё, что игра знает о вещах дополнения —
 * ярлык названия (`CLO_H3M_B_0_0`), компонент, номер вещи в папке
 * дополнения и номер расцветки. По нему Astral знает, какие маски, куртки и
 * кепки есть в игре человека и сколько у каждой цветов, — без снимков и без
 * списков из вики.
 *
 * Чего в файлах нет: разбивки по магазинам. У всех вещей `eShopEnum` один и
 * тот же (`CLO_SHOP_LOW`), а какая вещь лежит в Binco, а какая в Ponsonbys,
 * решает скрипт игры. Поэтому «магазином» здесь называется дополнение
 * (коллекция), в котором вещь выпущена, — это то, что игра хранит на самом деле.
 *
 * Номера. `localDrawableIndex` — номер файла в папке дополнения
 * (`berd_003_u.ydd`), `drawableIndex` — номер внутри группы совместимости и
 * как имя файла не годится. У пропсов то же самое: `localPropIndex`.
 *
 * Чистый JS: работает и в окне, и в главном процессе, и в тестах.
 */

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

/**
 * Разбор XML без зависимостей: теги, атрибуты, текст. Комментарии и
 * объявление отбрасываются. Хватает файлов игры; не общий парсер.
 */
export function parseXml(source) {
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  for (const match of String(source).matchAll(TOKEN)) {
    const [, closing, name, attributes, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      if (text.trim()) top.text += text.trim();
      continue;
    }
    if (!name) continue;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { name, attrs: {}, children: [], text: "" };
    for (const attribute of (attributes || "").matchAll(ATTRIBUTE))
      node.attrs[attribute[1]] = attribute[2];
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children[0] || null;
}

const child = (node, name) =>
  node?.children.find((item) => item.name === name) || null;

const textOf = (node, name) => child(node, name)?.text || "";

function numberOf(node, name) {
  const found = child(node, name);
  if (!found) return null;
  const raw = found.attrs.value ?? found.text;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** `PV_COMP_BERD` → `berd`. Что игра зовёт иначе — не вещь. */
export function componentOfType(type) {
  const match = /^PV_COMP_([A-Z]+)$/.exec(String(type || ""));
  return match ? match[1].toLowerCase() : null;
}

const ANCHORS = Object.freeze({
  ANCHOR_HEAD: "p_head",
  ANCHOR_EYES: "p_eyes",
  ANCHOR_EARS: "p_ears",
  ANCHOR_MOUTH: "p_mouth",
  ANCHOR_LEFT_HAND: "p_lhand",
  ANCHOR_RIGHT_HAND: "p_rhand",
  ANCHOR_LEFT_WRIST: "p_lwrist",
  ANCHOR_RIGHT_WRIST: "p_rwrist",
  ANCHOR_HIP: "p_hip",
  ANCHOR_LEFT_FOOT: "p_lfoot",
  ANCHOR_RIGHT_FOOT: "p_rfoot",
});

/** `ANCHOR_HEAD` → `p_head`. */
export const componentOfAnchor = (anchor) =>
  ANCHORS[String(anchor || "")] || null;

function readItem(node, prop) {
  const component = prop
    ? componentOfAnchor(textOf(node, "eAnchorPoint"))
    : componentOfType(textOf(node, "eCompType"));
  if (!component) return null;
  const drawable = prop
    ? (numberOf(node, "localPropIndex") ?? numberOf(node, "propIndex"))
    : (numberOf(node, "localDrawableIndex") ?? numberOf(node, "drawableIndex"));
  const texture = numberOf(node, "textureIndex");
  if (!Number.isInteger(drawable) || drawable < 0) return null;
  return {
    prop,
    component,
    drawable,
    texture: Number.isInteger(texture) && texture >= 0 ? texture : 0,
    label: textOf(node, "textLabel"),
    unique: textOf(node, "uniqueNameHash"),
    lock: textOf(node, "lockHash"),
    shop: textOf(node, "eShopEnum"),
    cost: numberOf(node, "cost"),
    locate: numberOf(node, "locate"),
    restrictions: (child(node, "restrictionTags")?.children || [])
      .map((tag) => textOf(tag, "tagNameHash"))
      .filter(Boolean),
  };
}

/*
 * Быстрый проход по магазинному файлу (31.10.2026, первое открытие одежды). Файлы дополнений — 72 МБ XML на 166 штук, из них 68 МБ — записи `pedComponents`/`pedProps`; общий
 * разборщик (`parseXml`) строил на каждую запись дюжину узлов с объектами атрибутов — 3 с на сборку оглавления. Здесь записи читаются одним проходом без дерева: только поля, которые нужны
 * `readItem`, первое вхождение каждого — как `child()` у общего разборщика. Форма файла проверяется по ходу; всё, что не похоже на файлы игры (вложенность не там, чужой текст внутри поля,
 * неправильные теги и атрибуты), возвращает `undefined` — и файл разбирает общий разборщик. На правильно вложенном XML ответ тот же, что у общего (сверено на 166 настоящих файлах и случайными порчами, `tests/shop-meta-fast.test.js`); общий закрывает элемент любым закрывающим тегом, не глядя на имя, так что на ломаной вложенности ответы могут разойтись.
 */
const ATTRIBUTE_OF_TAG = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
const NAME_END = /[\s/>]/;
const NAME_OK = /^[A-Za-z_][\w:.-]*$/;
const REST_OK = /^(?:\s+[\w:.-]+\s*=\s*"[^"]*")*\s*\/?$/;

/* Поля записи, которые читает `readItem`: имя тега → `[ключ, число?]`. Прочие теги записи пропускаются целиком. */
const FIELDS = new Map([
  ["eCompType", ["compType", false]],
  ["eAnchorPoint", ["anchor", false]],
  ["textLabel", ["label", false]],
  ["uniqueNameHash", ["unique", false]],
  ["lockHash", ["lock", false]],
  ["eShopEnum", ["shop", false]],
  ["localDrawableIndex", ["localDrawable", true]],
  ["drawableIndex", ["drawable", true]],
  ["localPropIndex", ["localProp", true]],
  ["propIndex", ["propPlain", true]],
  ["textureIndex", ["texture", true]],
  ["cost", ["cost", true]],
  ["locate", ["locate", true]],
]);
/* Символы имени тега и пробелы в ASCII: что за пределами — не быстрый путь. */
const NAME_CHAR = new Uint8Array(128);
const SPACE_CHAR = new Uint8Array(128);
for (let code = 0; code < 128; code += 1) {
  const char = String.fromCharCode(code);
  if (/[\w:.-]/.test(char)) NAME_CHAR[code] = 1;
  if (/\s/.test(char)) SPACE_CHAR[code] = 1;
}
const RESTRICTION_TAG = /\s*<Item>\s*<tagNameHash>([^<]*)<\/tagNameHash>\s*<\/Item>\s*/y;

/* Тег, начатый в `at` (`text[at] === "<"`, дальше — имя): `{ name, end, self, value }`; `end` — после `>`. Не тег или обрыв — `null`. */
function readTag(text, at) {
  const first = text.charCodeAt(at + 1);
  /* буква или `_`: имена тегов игры */
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95)) return null;
  const close = text.indexOf(">", at + 1);
  if (close === -1) return null;
  const inner = text.slice(at + 1, close);
  const stop = inner.search(NAME_END);
  const name = stop === -1 ? inner : inner.slice(0, stop);
  if (!NAME_OK.test(name)) return null;
  const rest = stop === -1 ? "" : inner.slice(stop);
  if (rest && !REST_OK.test(rest)) return null;
  const self = rest.endsWith("/");
  let value = null;
  if (rest.includes("=")) {
    ATTRIBUTE_OF_TAG.lastIndex = 0;
    let found;
    while ((found = ATTRIBUTE_OF_TAG.exec(rest))) if (found[1] === "value") value = found[2];
  }
  return { name, end: close + 1, self, value };
}

/* Элемент целиком: после открывающего тега — до `</имя>`. Лист (`<a>текст</a>`) → `{ text, end }`; контейнер с тегами внутри → `{ text: null, end }`; такого же имени внутри — `null`. */
function readElement(text, tag) {
  if (tag.self) return { text: "", end: tag.end };
  const next = text.indexOf("<", tag.end);
  if (next === -1) return null;
  if (text.charCodeAt(next + 1) === 47 && text.startsWith(tag.name, next + 2) && text.charCodeAt(next + 2 + tag.name.length) === 62)
    return { text: text.slice(tag.end, next).trim(), end: next + 3 + tag.name.length };
  const closing = `</${tag.name}>`;
  const close = text.indexOf(closing, tag.end);
  if (close === -1) return null;
  /* такое же имя внутри — вложенность, которую общий разборщик считает иначе: назад от закрытия, до начала элемента, а не вперёд до конца файла */
  if (text.lastIndexOf(`<${tag.name}`, close) >= tag.end) return null;
  return { text: null, end: close + closing.length, inner: text.slice(tag.end, close) };
}

/* Ограничения записи → имена тегов. Обычная форма — `<Item><tagNameHash>ИМЯ</tagNameHash></Item>` подряд; любая другая (пустой `<tagNameHash />`, запись внутри записи — такая есть в файле
   Import/Export у самой игры) читается деревом, но только этот кусок, а не весь файл: так же, как `readItem` — по первому `tagNameHash` каждого ребёнка. */
function readRestrictions(inner) {
  const names = [];
  let at = 0;
  RESTRICTION_TAG.lastIndex = 0;
  let plain = true;
  while (at < inner.length) {
    if (!inner.slice(at).trim()) break;
    RESTRICTION_TAG.lastIndex = at;
    const match = RESTRICTION_TAG.exec(inner);
    if (!match) {
      plain = false;
      break;
    }
    const name = match[1].trim();
    if (name) names.push(name);
    at = RESTRICTION_TAG.lastIndex;
  }
  if (plain) return names;
  const node = parseXml(`<restrictionTags>${inner}</restrictionTags>`);
  return (node?.children || []).map((tag) => textOf(tag, "tagNameHash")).filter(Boolean);
}

/* Одна запись: `at` — после `<Item>`; `{ fields, restrictions, end }` или `undefined`. Частые формы тегов (`<имя>`, `<имя/>`, `<имя value="…" />`) читаются по символам без срезов; остальное — через `readTag`/`readElement`. */
function scanItem(text, at) {
  const fields = {
    compType: undefined,
    anchor: undefined,
    label: undefined,
    unique: undefined,
    lock: undefined,
    shop: undefined,
    localDrawable: undefined,
    drawable: undefined,
    localProp: undefined,
    propPlain: undefined,
    texture: undefined,
    cost: undefined,
    locate: undefined,
  };
  let restrictions = [];
  let restricted = false;
  let position = at;
  for (;;) {
    const next = text.indexOf("<", position);
    if (next === -1) return undefined;
    const kind = text.charCodeAt(next + 1);
    if (kind === 33) {
      /* комментарий */
      if (!text.startsWith("<!--", next)) return undefined;
      const end = text.indexOf("-->", next + 4);
      if (end === -1) return undefined;
      position = end + 3;
      continue;
    }
    if (kind === 47) {
      if (!text.startsWith("</Item>", next)) return undefined;
      return { fields, restrictions, end: next + 7 };
    }
    let value = null;
    let self = false;
    /* быстрый путь: имя из символов имени, затем `>`, `/>` или единственный ` value="…"` */
    let q = next + 1;
    let code = text.charCodeAt(q);
    while (code < 128 && NAME_CHAR[code] === 1) code = text.charCodeAt(++q);
    const nameEnd = q;
    let simple = nameEnd > next + 1;
    if (simple) {
      if (code === 62) q += 1;
      else if (code === 47 && text.charCodeAt(q + 1) === 62) {
        self = true;
        q += 2;
      } else if (code === 32 && text.startsWith('value="', q + 1)) {
        const close = text.indexOf('"', q + 8);
        if (close === -1) simple = false;
        else {
          value = text.slice(q + 8, close);
          q = close + 1;
          code = text.charCodeAt(q);
          if (code === 62) q += 1;
          else if (code === 47 && text.charCodeAt(q + 1) === 62) {
            self = true;
            q += 2;
          } else if (code === 32 && text.charCodeAt(q + 1) === 47 && text.charCodeAt(q + 2) === 62) {
            self = true;
            q += 3;
          } else simple = false;
        }
      } else simple = false;
    }
    let name;
    let content;
    let inner = null;
    let end;
    if (!simple) {
      /* необычная форма тега: общий путь со срезами и проверкой по шаблону */
      const tag = readTag(text, next);
      if (!tag) return undefined;
      const element = readElement(text, tag);
      if (!element) return undefined;
      name = tag.name;
      value = tag.value;
      content = element.text;
      inner = element.inner ?? null;
      end = element.end;
    } else {
      name = text.slice(next + 1, nameEnd);
      if (self) {
        content = "";
        end = q;
      } else {
        const lt = text.indexOf("<", q);
        if (lt === -1) return undefined;
        if (text.charCodeAt(lt + 1) === 47 && text.startsWith(name, lt + 2) && text.charCodeAt(lt + 2 + name.length) === 62) {
          content = text.slice(q, lt).trim();
          end = lt + 3 + name.length;
        } else {
          const element = readElement(text, { name, end: q, self: false });
          if (!element) return undefined;
          content = element.text;
          inner = element.inner ?? null;
          end = element.end;
        }
      }
    }
    position = end;
    if (name === "restrictionTags") {
      if (restricted) continue;
      restricted = true;
      if (content !== null) {
        if (content) return undefined;
        continue;
      }
      const names = readRestrictions(inner);
      if (!names) return undefined;
      restrictions = names;
      continue;
    }
    const field = FIELDS.get(name);
    if (!field || fields[field[0]] !== undefined) continue;
    /* поле с вложенными тегами — не форма файлов игры */
    if (content === null) return undefined;
    if (field[1]) {
      const number = Number(value ?? content);
      fields[field[0]] = Number.isFinite(number) ? number : null;
    } else fields[field[0]] = content;
  }
}

/* Запись магазинного файла по полям: то же, что `readItem` по дереву. */
function itemOfFields(scanned, prop) {
  const { fields, restrictions } = scanned;
  const component = prop ? componentOfAnchor(fields.anchor ?? "") : componentOfType(fields.compType ?? "");
  if (!component) return null;
  const drawable = prop ? (fields.localProp ?? fields.propPlain ?? null) : (fields.localDrawable ?? fields.drawable ?? null);
  const texture = fields.texture ?? null;
  if (!Number.isInteger(drawable) || drawable < 0) return null;
  return {
    prop,
    component,
    drawable,
    texture: Number.isInteger(texture) && texture >= 0 ? texture : 0,
    label: fields.label ?? "",
    unique: fields.unique ?? "",
    lock: fields.lock ?? "",
    shop: fields.shop ?? "",
    cost: fields.cost ?? null,
    locate: fields.locate ?? null,
    restrictions,
  };
}

/* Корень `ShopPedApparel` по детям: шапка, `pedComponents`, `pedProps`; всё остальное (`pedOutfits`, ярлыки) пропускается. `undefined` — форма не та, пусть разберёт общий разборщик. */
function scanShopMeta(source) {
  const text = String(source);
  const start = text.indexOf("<ShopPedApparel>");
  if (start === -1) return undefined;
  if (start > 0 && !/^\s*(?:<\?[\s\S]*?\?>\s*)?$/.test(text.slice(0, start))) return undefined;
  const header = {};
  const sections = new Map();
  let position = start + "<ShopPedApparel>".length;
  for (;;) {
    const next = text.indexOf("<", position);
    if (next === -1) return undefined;
    const kind = text.charCodeAt(next + 1);
    if (kind === 33) {
      if (!text.startsWith("<!--", next)) return undefined;
      const end = text.indexOf("-->", next + 4);
      if (end === -1) return undefined;
      position = end + 3;
      continue;
    }
    if (kind === 47) {
      if (!text.startsWith("</ShopPedApparel>", next)) return undefined;
      break;
    }
    const tag = readTag(text, next);
    if (!tag) return undefined;
    if (tag.name === "pedComponents" || tag.name === "pedProps") {
      if (sections.has(tag.name)) {
        const skipped = readElement(text, tag);
        if (!skipped) return undefined;
        position = skipped.end;
        continue;
      }
      const prop = tag.name === "pedProps";
      const items = [];
      sections.set(tag.name, items);
      if (tag.self) {
        position = tag.end;
        continue;
      }
      position = tag.end;
      for (;;) {
        const inside = text.indexOf("<", position);
        if (inside === -1) return undefined;
        const mark = text.charCodeAt(inside + 1);
        if (mark === 33) {
          if (!text.startsWith("<!--", inside)) return undefined;
          const end = text.indexOf("-->", inside + 4);
          if (end === -1) return undefined;
          position = end + 3;
          continue;
        }
        if (mark === 47) {
          if (!text.startsWith(`</${tag.name}>`, inside)) return undefined;
          position = inside + tag.name.length + 3;
          break;
        }
        if (!text.startsWith("<Item>", inside)) return undefined;
        const scanned = scanItem(text, inside + 6);
        if (!scanned) return undefined;
        position = scanned.end;
        const item = itemOfFields(scanned, prop);
        if (item) items.push(item);
      }
      continue;
    }
    const element = readElement(text, tag);
    if (!element) return undefined;
    position = element.end;
    if ((tag.name === "pedName" || tag.name === "dlcName" || tag.name === "fullDlcName") && !(tag.name in header)) {
      if (element.text === null) return undefined;
      header[tag.name] = element.text;
    }
  }
  return { header, items: [...(sections.get("pedComponents") || []), ...(sections.get("pedProps") || [])] };
}

/** Берёт ли файл быстрый проход (а не общий разборщик): для тестов и стенда — тихий уход в общий путь сделал бы сборку оглавления втрое медленнее. */
export const shopMetaFastOk = (source) => scanShopMeta(source) !== undefined;

/**
 * Файл дополнения → `{ ped, gender, collection, folder, items }`. `folder` —
 * папка вещей в архиве моделей (`mp_m_freemode_01_mp_m_heist3`, строчными),
 * `items` — по записи на каждую расцветку каждой вещи. Не магазинный файл —
 * `null`. Быстрый проход по записям (`scanShopMeta`), а чего он не берёт —
 * общий разборщик (`parseShopMetaGeneric`).
 */
export function parseShopMeta(source) {
  const fast = scanShopMeta(source);
  if (fast) {
    const ped = fast.header.pedName || "";
    const gender = /^mp_f_/i.test(ped) ? "female" : /^mp_m_/i.test(ped) ? "male" : null;
    const folder = (fast.header.fullDlcName || "").toLowerCase();
    if (!gender || !folder) return null;
    return { ped, gender, collection: fast.header.dlcName || "", folder, items: fast.items };
  }
  return parseShopMetaGeneric(source);
}

/** Тот же разбор по дереву `parseXml`: любой вход, но в разы медленнее; эталон для сверки быстрого прохода. */
export function parseShopMetaGeneric(source) {
  const root = parseXml(source);
  if (!root || root.name !== "ShopPedApparel") return null;
  const ped = textOf(root, "pedName");
  const gender = /^mp_f_/i.test(ped)
    ? "female"
    : /^mp_m_/i.test(ped)
      ? "male"
      : null;
  const folder = textOf(root, "fullDlcName").toLowerCase();
  if (!gender || !folder) return null;
  const items = [];
  for (const node of child(root, "pedComponents")?.children || []) {
    const item = readItem(node, false);
    if (item) items.push(item);
  }
  for (const node of child(root, "pedProps")?.children || []) {
    const item = readItem(node, true);
    if (item) items.push(item);
  }
  return {
    ped,
    gender,
    collection: textOf(root, "dlcName"),
    folder,
    items,
  };
}

/**
 * Записи расцветок → вещи: одна вещь на (компонент, номер), число
 * расцветок — по наибольшему номеру, название — ярлык первой расцветки.
 */
export function summarizeShopItems(items) {
  const things = new Map();
  for (const item of items) {
    const key = `${item.component}|${item.drawable}`;
    const thing = things.get(key) || {
      prop: item.prop,
      component: item.component,
      drawable: item.drawable,
      textures: 0,
      label: "",
      locate: item.locate,
      restrictions: [],
    };
    thing.textures = Math.max(thing.textures, item.texture + 1);
    if (!thing.label || (item.texture === 0 && item.label))
      thing.label = item.label || thing.label;
    for (const tag of item.restrictions)
      if (!thing.restrictions.includes(tag)) thing.restrictions.push(tag);
    things.set(key, thing);
  }
  return [...things.values()].sort(
    (left, right) =>
      left.component.localeCompare(right.component) ||
      left.drawable - right.drawable,
  );
}
