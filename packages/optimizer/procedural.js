// procedural.meta — таблица россыпи мелких объектов по поверхности. Файл
// превращается в универсальное дерево элементов, в нём находятся записи
// россыпи и правятся, после чего дерево пишется обратно в XML. Файл берётся
// из архива игрока, поэтому разбор осторожный: DTD запрещены, а размер,
// число элементов, вложенность и длина текста ограничены.
import { SaxesParser } from "saxes";

const ROOT_NAME = "CProceduralInfo";
const SECTION_NAME = "procObjInfos";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ELEMENTS = 200000;
const MAX_DEPTH = 32;
const MAX_TEXT_BYTES = 8192;
const MAX_SPACING = 64;
const MIN_DISTANCE = 1;
const NUMBER_DECIMALS = 6;
const PARSE_PREFIX = "procedural.meta не разобран: ";
const DTD_MARK = /<!(?:DOCTYPE|ENTITY)\b/i;
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

function utf8Length(text) {
  // Buffer есть только в Node.js; в окне байты считает TextEncoder — итог тот же.
  return typeof globalThis.Buffer === "function"
    ? globalThis.Buffer.byteLength(text, "utf8")
    : new TextEncoder().encode(text).length;
}

// Один знак UTF-16 занимает до трёх байт: короткие тексты можно не мерить.
const exceedsBytes = (text, limit) => text.length * 3 > limit && utf8Length(text) > limit;

export function looksLikeProceduralXml(input) {
  const head = (input == null ? "" : String(input)).trimStart();
  if (head.startsWith("<?xml")) return true;
  return head.startsWith(`<${ROOT_NAME}`) && !/^\w/.test(head.slice(ROOT_NAME.length + 1));
}

// Строит дерево из событий разборщика. Запоминает только первую ошибку —
// и разборщика, и свою; все события после неё игнорируются.
class TreeBuilder {
  #failure = null;
  #root = null;
  #open = [];
  #count = 0;

  attach(parser) {
    parser.on("error", (error) => this.#fail(error.message));
    parser.on("doctype", () => this.#fail("В procedural.meta не допускается doctype."));
    parser.on("opentag", (tag) => this.#enter(tag));
    parser.on("text", (chunk) => this.#text(chunk));
    parser.on("closetag", () => this.#leave());
  }

  finish() {
    if (this.#failure !== null) throw new Error(PARSE_PREFIX + this.#failure);
    if (this.#root === null) throw new Error("В procedural.meta нет корневого элемента.");
    return this.#root;
  }

  #fail(message) {
    this.#failure ??= message;
  }

  #enter(tag) {
    if (this.#failure !== null) return;
    const isRoot = this.#open.length === 0;
    if (isRoot && this.#root !== null) return; // второй корень: ошибку даст разборщик
    if (isRoot && tag.name !== ROOT_NAME) {
      this.#fail(`Неожиданный корневой элемент procedural.meta: ${tag.name}.`);
      return;
    }
    this.#count += 1;
    if (this.#count > MAX_ELEMENTS) {
      this.#fail("В procedural.meta слишком много элементов.");
      return;
    }
    if (this.#open.length + 1 > MAX_DEPTH) {
      this.#fail("В procedural.meta слишком большая вложенность.");
      return;
    }

    const element = {
      name: tag.name,
      attributes: Object.fromEntries(Object.entries(tag.attributes)),
      children: [],
      text: "",
    };
    if (isRoot) this.#root = element;
    else this.#open.at(-1).element.children.push(element);
    this.#open.push({ element, chunks: [] });
  }

  #text(chunk) {
    if (this.#failure !== null || this.#open.length === 0) return;
    if (exceedsBytes(chunk, MAX_TEXT_BYTES)) {
      this.#fail("В procedural.meta слишком длинное значение.");
      return;
    }
    this.#open.at(-1).chunks.push(chunk);
  }

  #leave() {
    if (this.#failure !== null || this.#open.length === 0) return;
    const { element, chunks } = this.#open.pop();
    // Текст элемента с детьми теряется; у листа — накопленный текст без краёв.
    element.text = element.children.length > 0 ? "" : chunks.join("").trim();
  }
}

export function parseProceduralMeta(input) {
  const text = input == null ? "" : String(input);
  if (text.trim() === "") throw new Error("Файл procedural.meta пуст.");
  if (exceedsBytes(text, MAX_FILE_BYTES)) throw new Error("Файл procedural.meta превышает безопасный размер.");
  if (DTD_MARK.test(text)) throw new Error("В procedural.meta не допускаются DTD и сущности.");

  const builder = new TreeBuilder();
  const parser = new SaxesParser({ xmlns: false });
  builder.attach(parser);
  parser.write(text);
  parser.close();
  return builder.finish();
}

export function childElement(element, name) {
  const kids = element?.children;
  if (kids == null) return null;
  if (!Array.isArray(kids)) throw new TypeError("children элемента должен быть массивом");
  return kids.find((kid) => kid.name === name) ?? null;
}

export function fieldValue(element, name) {
  const field = childElement(element, name);
  if (field === null) return null;
  const fromAttribute = field.attributes?.value;
  if (fromAttribute !== undefined) return fromAttribute;
  return field.text ? field.text : null;
}

export function numericField(element, name) {
  const value = fieldValue(element, name);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function proceduralObjects(document) {
  const section = childElement(document, SECTION_NAME);
  return section === null ? [] : section.children.filter((child) => child.name === "Item");
}

export function proceduralModelName(item) {
  const name = fieldValue(item, "ModelName");
  return name === null ? "" : String(name).trim().toLowerCase();
}

// Число в поле записи: округление до шести знаков, без лишних нулей.
function writeNumber(item, fieldName, value) {
  const field = childElement(item, fieldName);
  const text = String(Number(value.toFixed(NUMBER_DECIMALS)));
  if (field.attributes.value !== undefined) field.attributes.value = text;
  else field.text = text;
}

// Правки полей: ключ действия, имя поля и новое значение по текущему.
const FIELD_ADJUSTMENTS = [
  { action: "spacing", field: "Spacing", next: (now, factor) => Math.min(MAX_SPACING, now * factor) },
  { action: "maxDistance", field: "MaxDistance", next: (now, factor) => Math.max(MIN_DISTANCE, now * factor) },
];

function adjustFields(item, model, action) {
  const report = { model };
  let touched = false;
  for (const { action: key, field, next } of FIELD_ADJUSTMENTS) {
    if (!action[key]) continue;
    const now = numericField(item, field);
    if (now === null || !(now > 0)) continue;
    const value = next(now, Number(action[key]));
    writeNumber(item, field, value);
    report[key] = [now, value];
    touched = true;
  }
  return touched ? report : null;
}

export function applyProceduralRule(document, match, action) {
  const removed = [];
  const adjusted = [];
  const section = childElement(document, SECTION_NAME);
  if (section === null) return { removed, adjusted };

  const kept = [];
  for (const child of section.children) {
    if (child.name !== "Item") {
      kept.push(child);
      continue;
    }
    const model = proceduralModelName(child);
    if (!match(model, child)) {
      kept.push(child);
      continue;
    }
    if (action.remove) {
      removed.push(model);
      continue;
    }
    kept.push(child);
    const report = adjustFields(child, model, action);
    if (report !== null) adjusted.push(report);
  }
  // Новый список детей ставится в самом конце: если match бросил, удалений нет.
  section.children = kept;
  return { removed, adjusted };
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeText = (value) => String(value).replace(/[&<>]/g, (char) => ESCAPES[char]);
const escapeAttribute = (value) => String(value).replace(/[&<>"]/g, (char) => ESCAPES[char]);

function writeElement(element, depth, out) {
  const indent = "  ".repeat(depth);
  const attributes = Object.entries(element.attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  const opening = `${indent}<${element.name}${attributes}`;

  if (element.children.length === 0) {
    out.push(element.text ? `${opening}>${escapeText(element.text)}</${element.name}>` : `${opening} />`);
    return;
  }
  out.push(`${opening}>`);
  for (const child of element.children) writeElement(child, depth + 1, out);
  out.push(`${indent}</${element.name}>`);
}

export function serializeProceduralMeta(document) {
  const lines = [XML_DECLARATION];
  writeElement(document, 0, lines);
  lines.push("");
  return lines.join("\n");
}
