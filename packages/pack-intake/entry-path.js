import { nameSegmentProblem, nameSegmentReason } from "../mod-targets/file-names.js";

/* Правило звена — одно на установку, распаковку и бандлы (`mod-targets/file-names.js`); окно берёт его отсюда (`@modovik/pack-intake/entry-path`). */
export { nameSegmentProblem, nameSegmentReason };

const KNOWN_EXTENSIONS = ".zip .oiv .7z .rar".split(" ");

export const ARCHIVE_KINDS = Object.freeze(Object.fromEntries(KNOWN_EXTENSIONS.map((ext) => [ext, ext.slice(1)])));

const JUNK_FOLDERS = new Set("__macosx".split(" "));
const JUNK_FILES = new Set("desktop.ini thumbs.db .ds_store".split(" "));
const MAX_SEGMENT = 200;
const LETTER_RANGES = [
  [65, 90],
  [97, 122],
];

const textOf = (value) => String(value || "");

// Срезает подряд идущие `char` с одного края строки.
const trimEdge = (text, char, fromStart) => {
  const pieces = [...text];
  if (!fromStart) pieces.reverse();
  const firstOther = pieces.findIndex((piece) => piece !== char);
  const kept = firstOther < 0 ? [] : pieces.slice(firstOther);
  return (fromStart ? kept : kept.reverse()).join("");
};

export const archiveKindOf = (name) => {
  const text = textOf(name).toLowerCase();
  const dot = text.lastIndexOf(".");
  const extension = dot < 0 ? "" : text.slice(dot);
  const crossesFolder = [...extension].some((ch) => ch === "/" || ch === "\\");
  return dot < 0 || crossesFolder ? null : (ARCHIVE_KINDS[extension] ?? null);
};

export const isRpfName = (name) => textOf(name).toLowerCase().endsWith(".rpf");

const isDriveLetter = (code) => LETTER_RANGES.some(([low, high]) => code >= low && code <= high);

const isAbsoluteEntry = (text) => {
  const [first, second] = [text.charCodeAt(0), text[1]];
  return text.startsWith("/") || (second === ":" && isDriveLetter(first));
};

const isJunk = (parts) =>
  JUNK_FOLDERS.has(parts[0].toLowerCase()) || JUNK_FILES.has(parts.at(-1).toLowerCase());

/* Имя в сообщении: управляющие знаки и знаки направления — кодами, чтобы строка в журнале читалась так, как она записана. */
const visible = (text) =>
  [...text]
    .map((ch) => (/^(?:character|direction)$/.test(nameSegmentProblem(ch)) ? `<U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>` : ch))
    .join("");

const tooLong = (piece) => piece.length > MAX_SEGMENT;

// Вердикты идут в порядке проверок; побеждает первый, что вернул ответ (иначе — undefined).
const RULINGS = [
  ({ text }) => (text === "" ? { unsafe: "пустое имя" } : undefined),
  ({ text }) => (isAbsoluteEntry(text) ? { unsafe: `абсолютный путь «${text}»` } : undefined),
  ({ text, rough }) => (rough.includes("..") ? { unsafe: `путь наружу папки «${text}»` } : undefined),
  ({ rough }) => (rough.some((piece) => piece.includes("\0")) ? { unsafe: "нулевой символ в имени" } : undefined),
  ({ text, parts }) => (parts.length === 0 ? { unsafe: `пустой путь «${text}»` } : undefined),
  ({ parts }) => (isJunk(parts) ? { junk: true } : undefined),
  ({ text, parts }) => {
    const bad = parts.find((piece) => nameSegmentProblem(piece));
    if (bad === undefined) return undefined;
    return { unsafe: `недопустимое имя в пути «${visible(text)}»: ${nameSegmentReason(nameSegmentProblem(bad))}`, badName: true };
  },
  ({ parts }) => (parts.some(tooLong) ? { unsafe: "слишком длинное имя" } : undefined),
];

export const classifyEntryPath = (name) => {
  const text = String(name ?? "").replaceAll("\\", "/");
  const rough = text.split("/").filter(Boolean);
  const entry = { text, rough, parts: rough.filter((piece) => piece !== ".") };
  for (const ruling of RULINGS) {
    const verdict = ruling(entry);
    if (verdict !== undefined) return verdict;
  }
  return { path: entry.parts.join("/") };
};

export const safeArchiveEntry = (name) => classifyEntryPath(name).path ?? null;

export const joinVirtual = (container, path) => {
  const head = trimEdge(textOf(container), "/", false);
  const tail = trimEdge(textOf(path), "/", true);
  return [head, tail].filter(Boolean).join("/");
};

export const baseName = (path) => textOf(path).split("/").at(-1);
