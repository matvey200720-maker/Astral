import path from "node:path";
import fs from "node:fs";
import { writeFileAtomicSync } from "../atomic-file.js";

export const DATA_SCHEMA = 1;
export const DATA_MARKER_FILE = "astral-data.json";

// Пределы длины текстовых полей метки, в знаках UTF-16.
const LIMITS = { channel: 16, version: 64, at: 40 };

// Поля автора метки в порядке записи.
const AUTHOR_KEYS = ["channel", "version"];

// Вердикт сверки по результату сравнения «метка новее нашей схемы?».
const VERDICT_BY_COMPARISON = new Map([[true, "newer"], [false, "ok"]]);

const within = (size, low, high) => size >= low && size <= high;

const optionOr = (options, key, fallback) => (options[key] === undefined ? fallback : options[key]);

// Текстовое поле метки: строка длиной от 1 знака до предела, иначе null.
function field(value, limit) {
  if (typeof value !== "string") return null;
  return within(value.length, 1, limit) ? value : null;
}

function isUsableSchema(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

// Сравнение числовое: строка приводится к числу, NaN сравнение не проходит.
function outranks(marker, schema) {
  return marker.schema > schema;
}

function authorOf(source) {
  return Object.fromEntries(AUTHOR_KEYS.map((key) => [key, field(source[key], LIMITS[key])]));
}

function parseMarkerFile(userData, fsImpl) {
  let document = null;
  try {
    const location = path.join(userData, DATA_MARKER_FILE);
    document = JSON.parse(fsImpl.readFileSync(location, "utf8"));
  } catch {
    document = null;
  }
  return document;
}

export function readDataMarker(options) {
  const { userData } = options;
  const fsImpl = optionOr(options, "fsImpl", fs);
  const document = parseMarkerFile(userData, fsImpl);
  if (!isUsableSchema(document?.schema)) return null;
  const { schema, writtenBy, at } = document;
  return { schema, writtenBy: authorOf(writtenBy ?? {}), at: field(at, LIMITS.at) };
}

export function checkDataVersion(options) {
  const { userData } = options;
  const schema = optionOr(options, "schema", DATA_SCHEMA);
  const fsImpl = optionOr(options, "fsImpl", fs);
  const marker = readDataMarker({ userData, fsImpl });
  if (!marker) return { mode: "fresh", marker };
  return { mode: VERDICT_BY_COMPARISON.get(outranks(marker, schema)), marker };
}

// Содержимое файла метки: одна строка JSON и перевод строки.
function compose({ channel, version, schema, at }) {
  const writtenBy = authorOf({ channel, version });
  return JSON.stringify({ schema, writtenBy, at }) + "\n";
}

export function stampDataVersion(options) {
  const { userData, channel, version } = options;
  const schema = optionOr(options, "schema", DATA_SCHEMA);
  const now = optionOr(options, "now", () => new Date());
  const fsImpl = optionOr(options, "fsImpl", fs);

  const held = readDataMarker({ userData, fsImpl });
  if (held !== null && outranks(held, schema)) return false;

  fsImpl.mkdirSync(userData, { recursive: true });
  const text = compose({ channel, version, schema, at: now().toISOString() });
  const target = path.join(userData, DATA_MARKER_FILE);
  writeFileAtomicSync(target, text, { makeDirectory: false, fsImpl });
  return true;
}
