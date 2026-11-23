const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);
const EDIT_TAGS = ["delete", "xml", "text", "defragmentation"];
// Имя «constructor» ищется в обычном объекте и находит функцию Object.
const OBJECT_SOURCE = "function Object() { [native code] }";

const ENTITY = /&(?:([A-Za-z]+)|#([0-9]+)|#[xX]([0-9A-Fa-f]+));/g;

const decodeEntities = (text) =>
  text.replace(ENTITY, (whole, name, decimal, hex) => {
    if (name !== undefined) {
      const lower = name.toLowerCase();
      return lower === "constructor" ? OBJECT_SOURCE : (NAMED_ENTITIES.get(lower) ?? whole);
    }
    const code = decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });

// Вырезает отрезки «open … close» (до ближайшего close), подставляя render(содержимое).
const mapSpans = (text, open, close, render) => {
  let out = "";
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    const end = start < 0 ? -1 : text.indexOf(close, start + open.length);
    if (end < 0) return out + text.slice(from);
    out += text.slice(from, start) + render(text.slice(start + open.length, end));
    from = end + close.length;
  }
};

const protectCdata = (inner) => inner.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const prepare = (xml) => {
  const noComments = mapSpans(xml, "<!--", "-->", () => "");
  const noInstructions = mapSpans(noComments, "<?", "?>", () => "");
  return mapSpans(noInstructions, "<![CDATA[", "]]>", protectCdata);
};

const isLatin = (char) => /[A-Za-z]/.test(char);
const isNameChar = (char) => /[A-Za-z0-9_:.-]/.test(char);
const isSpace = (char) => /\s/.test(char);

const skipSpaces = (text, from) => {
  let at = from;
  while (at < text.length && isSpace(text[at])) at += 1;
  return at;
};

// После имени атрибута: «= "значение"» или «= 'значение'»; иначе null.
const readQuoted = (source, from) => {
  const equals = skipSpaces(source, from);
  if (source[equals] !== "=") return null;
  const quoteAt = skipSpaces(source, equals + 1);
  const quote = source[quoteAt];
  if (quote !== '"' && quote !== "'") return null;
  const start = quoteAt + 1;
  const end = source.indexOf(quote, start);
  return end < 0 ? null : { value: source.slice(start, end), end: end + 1 };
};

const readAttributes = (source) => {
  const attributes = new Map();
  let at = 0;
  while (at < source.length) {
    if (!(isLatin(source[at]) || source[at] === "_" || source[at] === ":")) {
      at += 1;
      continue;
    }
    let nameEnd = at + 1;
    while (nameEnd < source.length && isNameChar(source[nameEnd])) nameEnd += 1;
    const quoted = readQuoted(source, nameEnd);
    if (quoted) attributes.set(source.slice(at, nameEnd), decodeEntities(quoted.value));
    at = quoted ? quoted.end : nameEnd;
  }
  return attributes;
};

// Тег, начинающийся в позиции lt, либо null (тогда «<» просто теряется).
const readTag = (text, lt) => {
  const closing = text[lt + 1] === "/";
  const nameFrom = lt + (closing ? 2 : 1);
  const first = text[nameFrom];
  if (first === undefined || !(isLatin(first) || first === "_")) return null;
  let nameEnd = nameFrom + 1;
  while (nameEnd < text.length && isNameChar(text[nameEnd])) nameEnd += 1;
  const gt = text.indexOf(">", nameEnd);
  if (gt < 0) return null;
  const inner = text.slice(nameEnd, gt);
  const selfClosing = !closing && inner.endsWith("/");
  return {
    closing,
    selfClosing,
    name: text.slice(nameFrom, nameEnd).toLowerCase(),
    attributes: closing ? new Map() : readAttributes(selfClosing ? inner.slice(0, -1) : inner),
    end: gt + 1,
  };
};

function* scan(text) {
  let at = 0;
  while (at < text.length) {
    const lt = text.indexOf("<", at);
    if (lt < 0) {
      yield { chunk: text.slice(at) };
      return;
    }
    if (lt > at) yield { chunk: text.slice(at, lt) };
    const tag = readTag(text, lt);
    if (tag) yield tag;
    at = tag ? tag.end : lt + 1;
  }
}

const gamePath = (value) => {
  const text = String(value).replaceAll("\\", "/");
  let from = 0;
  while (text[from] === "/") from += 1;
  return text.slice(from).trim();
};

const startTarget = (state, attributes, name) => {
  state.current = { action: name, source: gamePath(attributes.get("source") ?? "") };
};

const addEdit = (state, attributes, name) => {
  const path = attributes.get("path") || attributes.get("source") || "";
  state.result.edits.push({ action: name, archives: [...state.chain], path: gamePath(path) });
};

const finishTarget = (state, value) => {
  if (!state.current) return;
  const { action, source } = state.current;
  state.result.targets.push({ action, source, archives: [...state.chain], path: gamePath(value) });
  state.current = null;
};

const underParent = (parent, action) => (state, value, actualParent) => {
  if (actualParent === parent) action(state, value);
};

const setMeta = (key) => (state, value) => {
  state.result[key] = value;
};

const addPart = (state, value) => {
  state.parts.push(value);
};

const closeVersion = (state) => {
  state.result.version = state.parts.filter(Boolean).join(".");
  state.parts = [];
};

const openPackage = (state, attributes) => {
  state.result.target = attributes.get("target") ?? "";
};

const openArchive = (state, attributes) => {
  state.chain.push(gamePath(attributes.get("path") ?? ""));
};

const closeArchive = (state) => {
  state.chain.pop();
};

const ON_OPEN = new Map([
  ["package", openPackage],
  ["archive", openArchive],
  ["add", startTarget],
  ["replace", startTarget],
  ...EDIT_TAGS.map((tag) => [tag, addEdit]),
]);

const ON_CLOSE = new Map([
  ["archive", closeArchive],
  ["add", finishTarget],
  ["replace", finishTarget],
  ["name", underParent("metadata", setMeta("name"))],
  ["description", underParent("metadata", setMeta("description"))],
  ["displayname", underParent("author", setMeta("author"))],
  ["major", underParent("version", addPart)],
  ["minor", underParent("version", addPart)],
  ["tag", underParent("version", addPart)],
  ["version", underParent("metadata", closeVersion)],
]);

class AssemblyReader {
  constructor() {
    this.stack = [];
    this.text = "";
    this.chain = [];
    this.parts = [];
    this.current = null;
    this.result = {
      name: "",
      version: "",
      author: "",
      description: "",
      target: "",
      targets: [],
      edits: [],
    };
  }

  open(name, attributes) {
    this.text = "";
    this.stack.push(name);
    ON_OPEN.get(name)?.(this, attributes, name);
  }

  close() {
    const name = this.stack.pop();
    const value = this.text.trim();
    this.text = "";
    ON_CLOSE.get(name)?.(this, value, this.stack[this.stack.length - 1]);
  }

  feed(token) {
    if (token.chunk !== undefined) {
      this.text += decodeEntities(token.chunk);
      return;
    }
    if (token.closing) {
      this.close();
      return;
    }
    this.open(token.name, token.attributes);
    if (token.selfClosing) this.close();
  }
}

export const parseOivAssembly = (xml) => {
  const reader = new AssemblyReader();
  for (const token of scan(prepare(String(xml || "")))) reader.feed(token);
  return reader.result;
};
