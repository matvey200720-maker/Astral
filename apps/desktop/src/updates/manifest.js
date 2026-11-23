import crypto from "node:crypto";
import * as semver from "./semver.js";

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MANIFEST_SCHEMA = 1;
export const BASE_ARTIFACT_NAME = "base.zip";

// Списки имён записаны строкой через пробел.
const words = (text) => text.split(" ");

export const CHANNELS = Object.freeze(words("alpha beta release"));
export const NOTE_LANGUAGES = Object.freeze(words("ru uk en de pl fr"));
// Языки, которые понимали клиенты до 0.9.0-beta.72 включительно: все, кроме fr (его они отвергали вместе с манифестом).
export const NOTE_LANGUAGES_OLD_CLIENTS = Object.freeze(NOTE_LANGUAGES.filter((code) => code !== "fr"));

const NOTE_LIMIT = 4000;
const KEY_BYTES = 32;

const PATTERN = {
  kid: /^[A-Za-z0-9._-]{1,64}$/,
  publishedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
  cover: /^updates\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(?:webp|png|jpg|jpeg|avif)$/,
  sha256: /^[0-9a-f]{64}$/,
  signature: /^[A-Za-z0-9+/]{86}==$/,
};

// Наборы полей: порядок важен для сообщений «нет полей …».
const FIELDS = {
  manifest: words("schema kid channel version build sequence minVersion publishedAt notes artifacts"),
  artifacts: words("base web"),
  base: words("name size sha256"),
  web: words("size sha256"),
  keyring: words("kid publicKey"),
};

// Поля, которые собирает serializeManifest до заметок и картинки (порядок записи в файл).
const HEADER_FIELDS = FIELDS.manifest.slice(0, -2);

const TEXT = {
  notBytes: "манифест — не байты",
  size: "размер манифеста вне 1…65536 байт",
  notUtf8: "манифест не в UTF-8",
  notJson: "манифест — не JSON",
  notes: "notes: ожидался объект по языкам",
  noLanguage: "notes: нужен хотя бы один известный язык",
  cover: "cover: путь внутри интерфейса вида updates/имя.webp (png, jpg, avif)",
  signature: "подпись — base64 из 64 байт",
  badSignature: "подпись манифеста не верна",
  rawKey: "публичный ключ Ed25519 — ровно 32 байта в base64",
  ringSource: "связка ключей: ожидался список keys",
};

export class ManifestError extends Error {
  constructor(code, message) {
    super(message);
    Object.assign(this, { name: "ManifestError", code });
  }
}

function refuse(code, message) {
  return new ManifestError(code, message);
}

const refuseField = (message) => refuse("manifest_field", message);

function isRecord(value) {
  if (value === null || Array.isArray(value)) return false;
  return typeof value === "object";
}

function matches(pattern) {
  return (value) => typeof value === "string" && pattern.test(value);
}

function atLeast(minimum) {
  return (value) => Number.isSafeInteger(value) && value >= minimum;
}

function isTimestamp(value) {
  return matches(PATTERN.publishedAt)(value) && !Number.isNaN(Date.parse(value));
}

function isNoteText(text) {
  if (typeof text !== "string") return false;
  return text.length <= NOTE_LIMIT && text.trim() !== "";
}

// Скалярные поля манифеста в порядке проверки: первое негодное значение называется в отказе.
const SCALARS = [
  { field: "schema", accepts: (value) => value === MANIFEST_SCHEMA, message: "schema: поддерживается только 1" },
  { field: "kid", accepts: matches(PATTERN.kid), message: "kid: нужна строка из букв, цифр и . _ -" },
  { field: "channel", accepts: (value) => CHANNELS.includes(value), message: "channel: alpha | beta | release" },
  { field: "version", accepts: semver.isValidVersion, message: "version: нужен semver" },
  { field: "minVersion", accepts: semver.isValidVersion, message: "minVersion: нужен semver" },
  { field: "build", accepts: atLeast(0), message: "build: нужно целое не меньше 0" },
  { field: "sequence", accepts: atLeast(1), message: "sequence: нужно целое не меньше 1" },
  { field: "publishedAt", accepts: isTimestamp, message: "publishedAt: нужна метка времени ISO 8601 в UTC" },
];

// Значения внутри artifacts в порядке проверки.
const ARTIFACT_VALUES = [
  {
    section: "base",
    field: "name",
    accepts: (value) => value === BASE_ARTIFACT_NAME,
    message: "artifacts.base.name: только base.zip",
  },
  {
    section: "base",
    field: "size",
    accepts: atLeast(1),
    message: "artifacts.base.size: нужно целое не меньше 1",
  },
  {
    section: "base",
    field: "sha256",
    accepts: matches(PATTERN.sha256),
    message: "artifacts.base.sha256: нужен sha256 из 64 строчных hex-знаков",
  },
  {
    section: "web",
    field: "size",
    accepts: atLeast(1),
    message: "artifacts.web.size: нужно целое не меньше 1",
  },
  {
    section: "web",
    field: "sha256",
    accepts: matches(PATTERN.sha256),
    message: "artifacts.web.sha256: нужен sha256 из 64 строчных hex-знаков",
  },
];

// Объект с точным набором полей: сначала лишние, потом недостающие.
function requireShape(value, label, required, optional = []) {
  if (!isRecord(value)) {
    throw refuseField(`${label}: ожидался объект`);
  }
  const allowed = new Set(required.concat(optional));
  const problems = [
    ["лишние поля", Object.keys(value).filter((key) => allowed.has(key) === false)],
    ["нет полей", required.filter((key) => Object.hasOwn(value, key) === false)],
  ];
  const found = problems.find(([, names]) => names.length > 0);
  if (found) {
    throw refuseField(`${label}: ${found[0]} ${found[1].join(", ")}`);
  }
}

function deepFreeze(node) {
  if (!node || typeof node !== "object") return node;
  for (const child of Object.values(node)) {
    deepFreeze(child);
  }
  return Object.freeze(node);
}

function guarded(job, message) {
  try {
    return job();
  } catch {
    throw refuse("manifest_json", message);
  }
}

function parseJsonBytes(bytes) {
  const decode = () => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const text = guarded(decode, TEXT.notUtf8);
  const parse = () => JSON.parse(text);
  return guarded(parse, TEXT.notJson);
}

function withinLimits(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  return bytes.length > 0 && bytes.length <= MAX_MANIFEST_BYTES;
}

// Чем негоден вход как манифест (не байты либо размер вне границ); null — годен.
function sizeComplaint(bytes) {
  if (!Buffer.isBuffer(bytes)) return TEXT.notBytes;
  return withinLimits(bytes) ? null : TEXT.size;
}

function readManifestJson(bytes) {
  const complaint = sizeComplaint(bytes);
  if (complaint) throw refuse("manifest_size", complaint);
  return parseJsonBytes(bytes);
}

function checkScalars(value) {
  const failed = SCALARS.find(({ field, accepts }) => !accepts(value[field]));
  if (failed) {
    throw refuseField(failed.message);
  }
}

const isNoteLanguage = (key) => NOTE_LANGUAGES.includes(key);

// Заметки: остаются известные языки в порядке входа, значения не обрезаются.
function pickNotes(source) {
  if (!isRecord(source)) throw refuseField(TEXT.notes);
  const languages = Object.keys(source).filter(isNoteLanguage);
  if (!languages.length) throw refuseField(TEXT.noLanguage);
  const rejected = languages.find((language) => !isNoteText(source[language]));
  if (rejected !== undefined) throw refuseField(`notes.${rejected}: непустая строка до 4000 знаков`);
  return Object.fromEntries(languages.map((language) => [language, source[language]]));
}

function checkCover(value) {
  if (Object.hasOwn(value, "cover") && !matches(PATTERN.cover)(value.cover)) {
    throw refuseField(TEXT.cover);
  }
}

// Разделы artifacts: подпись в сообщении, набор полей, как достать раздел.
const ARTIFACT_SECTIONS = [
  ["artifacts", FIELDS.artifacts, (artifacts) => artifacts],
  ["artifacts.base", FIELDS.base, (artifacts) => artifacts.base],
  ["artifacts.web", FIELDS.web, (artifacts) => artifacts.web],
];

function checkArtifacts(artifacts) {
  for (const [label, names, pick] of ARTIFACT_SECTIONS) {
    requireShape(pick(artifacts), label, names);
  }
  const failed = ARTIFACT_VALUES.find(({ section, field, accepts }) => !accepts(artifacts[section][field]));
  if (failed) {
    throw refuseField(failed.message);
  }
}

function checkTopFields(value) {
  requireShape(value, "manifest", FIELDS.manifest, ["cover"]);
}

function normaliseNotes(value) {
  value.notes = pickNotes(value.notes);
}

function checkArtifactsOf(value) {
  checkArtifacts(value.artifacts);
}

// Этапы разбора в порядке проверки; результат — тот же объект JSON, замороженный целиком.
const PARSE_STAGES = [checkTopFields, checkScalars, normaliseNotes, checkCover, checkArtifactsOf];

export function parseManifest(bytes) {
  const value = readManifestJson(bytes);
  PARSE_STAGES.forEach((stage) => stage(value));
  return deepFreeze(value);
}

// Приставка DER (SubjectPublicKeyInfo) открытого ключа Ed25519; за ней идут 32 байта ключа.
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export function publicKeyFromRaw(base64) {
  const text = String(base64 ?? "");
  const decoded = Buffer.from(text, "base64");
  if (decoded.length !== KEY_BYTES) throw refuse("keyring", TEXT.rawKey);
  const der = Buffer.concat([SPKI_ED25519, decoded]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

const derOf = (publicKey) => publicKey.export({ type: "spki", format: "der" });

export function rawPublicKey(keyObject) {
  const isPrivate = keyObject.type === "private";
  const exported = derOf(isPrivate ? crypto.createPublicKey(keyObject) : keyObject);
  return exported.subarray(-KEY_BYTES).toString("base64");
}

// Запись связки: форма, kid и повтор; возвращает kid.
function keyringKid(entry, ring) {
  requireShape(entry, "keyring entry", FIELDS.keyring);
  const { kid } = entry;
  if (!matches(PATTERN.kid)(kid)) throw refuse("keyring", `неверный kid: ${kid}`);
  if (ring.has(kid)) throw refuse("keyring", `kid повторяется: ${kid}`);
  return kid;
}

function ringEntries(source) {
  if (Array.isArray(source)) return source;
  return source?.keys;
}

export function loadKeyring(source) {
  const list = ringEntries(source);
  if (!Array.isArray(list)) throw refuse("keyring", TEXT.ringSource);
  const ring = new Map();
  for (const entry of list) ring.set(keyringKid(entry, ring), publicKeyFromRaw(entry.publicKey));
  return ring;
}

export function parseSignature(text) {
  const candidate = String(text ?? "").trim();
  if (!PATTERN.signature.test(candidate)) throw refuse("signature_format", TEXT.signature);
  return Buffer.from(candidate, "base64");
}

function lookupKey(keyring, kid) {
  if (typeof kid !== "string") return undefined;
  return keyring.get(kid);
}

export function verifyManifest(request) {
  const { bytes, signature, keyring } = request;
  if (!withinLimits(bytes)) throw refuse("manifest_size", TEXT.size);
  const kid = parseJsonBytes(bytes)?.kid;
  const key = lookupKey(keyring, kid);
  if (!key) throw refuse("unknown_key", `ключ ${kid} не входит в связку`);
  const detached = parseSignature(signature);
  if (!crypto.verify(null, bytes, key, detached)) throw refuse("bad_signature", TEXT.badSignature);
  return parseManifest(bytes);
}

export function signManifestBytes(bytes, privateKey) {
  const signature = crypto.sign(null, bytes, privateKey);
  return signature.toString("base64");
}

function artifactSection(manifest, name, keys) {
  const source = manifest.artifacts?.[name];
  const entries = keys.map((key) => [key, source?.[key]]);
  return Object.fromEntries(entries);
}

export function serializeManifest(manifest) {
  const given = manifest.notes ?? {};
  const notes = {};
  for (const language of NOTE_LANGUAGES) {
    if (Object.hasOwn(given, language)) {
      notes[language] = given[language];
    }
  }

  const record = {};
  for (const field of HEADER_FIELDS) {
    record[field] = manifest[field];
  }
  record.notes = notes;
  if (manifest.cover !== undefined) {
    record.cover = manifest.cover;
  }
  record.artifacts = {
    base: artifactSection(manifest, "base", FIELDS.base),
    web: artifactSection(manifest, "web", FIELDS.web),
  };

  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  parseManifest(bytes);
  return bytes;
}

export function isRequiredUpdate(manifest, installedVersion) {
  return semver.compareVersions(installedVersion, manifest.minVersion) < 0;
}
