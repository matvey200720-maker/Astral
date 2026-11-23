const PAIR_SEPARATOR = " = ";
const MIN_RULE_DASHES = 5;
const UNIX_LINK_LENGTH = 10;

const TYPE_MAP = new Map([
  ["zip", "zip"],
  ["7z", "7z"],
  ["rar", "rar"],
  ["rar5", "rar"],
]);

const RULE = Symbol("rule");

const isRuleLine = (line) =>
  line.length >= MIN_RULE_DASHES && [...line].every((char) => char === "-");

// Строка вывода → «пустая» | «пара» | «разделитель» | undefined (пропуск).
const classifyLine = (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return { blank: true };
  const at = line.indexOf(PAIR_SEPARATOR);
  const dangling = at < 0 && line.endsWith(" =");
  if (at >= 0 || dangling) {
    const cut = dangling ? line.length - 2 : at;
    const value = dangling ? "" : line.slice(at + PAIR_SEPARATOR.length);
    return { key: line.slice(0, cut).trim(), value: value.trim() };
  }
  return isRuleLine(trimmed) ? { rule: true } : undefined;
};

// Блоки «ключ = значение», разделённые пустой строкой; линейка — отдельная метка между блоками.
const collectBlocks = (lines) => {
  const blocks = [];
  let open = null;
  const close = () => {
    if (open) blocks.push(open);
    open = null;
  };
  for (const item of lines.map(classifyLine)) {
    if (!item) continue;
    if (item.blank) close();
    else if (item.rule) {
      close();
      blocks.push(RULE);
    } else {
      open ??= new Map();
      if (item.key !== "__proto__") open.set(item.key, item.value);
    }
  }
  close();
  return blocks;
};

const numberOf = (text) => Number(text) || 0;

const isUnixLinkAt = (text, at) => {
  const isWord = (char) => char !== undefined && /\w/.test(char);
  const body = text.slice(at + 1, at + UNIX_LINK_LENGTH);
  return (
    text[at] === "l" &&
    !isWord(text[at - 1]) &&
    body.length === UNIX_LINK_LENGTH - 1 &&
    [...body].every((char) => "rwx-".includes(char)) &&
    isWord(text[at + UNIX_LINK_LENGTH - 1]) !== isWord(text[at + UNIX_LINK_LENGTH])
  );
};

const hasUnixLink = (attributes) =>
  attributes.split("").some((_, at) => isUnixLinkAt(attributes, at));

const isFolderAttributes = (attributes) =>
  attributes.split(/\s+/).some((word) => word.startsWith("D"));

const toEntry = (block) => {
  const field = (key) => block.get(key) ?? "";
  const attributes = field("Attributes");
  return {
    path: field("Path"),
    folder: field("Folder") === "+" || isFolderAttributes(attributes),
    size: numberOf(field("Size")),
    packedSize: numberOf(field("Packed Size")),
    encrypted: field("Encrypted") === "+",
    link:
      field("Symbolic Link") || field("Hard Link") || (hasUnixLink(attributes) ? "unix-link" : null),
  };
};

export const parseSevenZipListing = (text) => {
  const blocks = collectBlocks(String(text || "").split(/\r?\n/));
  const ruleAt = blocks.indexOf(RULE);
  const head = ruleAt < 0 ? blocks : blocks.slice(0, ruleAt);
  const body = ruleAt < 0 ? [] : blocks.slice(ruleAt + 1);
  const archive = head.find((block) => block.get("Type"));
  const rawType = archive?.get("Type") ?? null;
  return {
    type: rawType === null ? null : (TYPE_MAP.get(rawType.toLowerCase()) ?? null),
    rawType,
    physicalSize: archive ? numberOf(archive.get("Physical Size")) : 0,
    encryptedHeaders: archive?.get("Encrypted") === "+",
    entries: body.filter((block) => block !== RULE && block.has("Path")).map(toEntry),
  };
};
