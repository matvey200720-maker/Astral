// Новости Astral: договор ответа облака, деление тела новости, проверка адреса облака.

export const NEWS_LANGUAGES = Object.freeze(["ru", "en", "uk", "de", "pl", "fr"]);

const TEXT_INVALID_DATA = "Astral news returned invalid data.";
const TEXT_BAD_ORIGIN = "Astral news origin is invalid.";
const TEXT_UNAVAILABLE = "Astral news is unavailable.";
const TEXT_TOO_LARGE = "Astral news exceeds the client limit.";

const MAX_ITEMS = 50;
const DEFAULT_REQUEST_LIMIT = 20;
const MAX_REPLY_BYTES = 524288;

export class NewsV1Error extends Error {
  constructor(message = TEXT_INVALID_DATA) {
    super(message);
    this.name = "NewsV1Error";
    this.code = "INVALID_NEWS_V1";
  }
}

// --- Деление тела: строка разбирается по знакам, без регулярного выражения на весь пункт.

const BULLET_SIGNS = new Set(["-", "•", "*", "–", "—"]);
const INNER_LINE_BREAK = /[\r\u2028\u2029]/;

const isBlank = (ch) => ch.trim() === "";
const isAsciiDigit = (ch) => ch >= "0" && ch <= "9";

function skipBlanks(line, from) {
  let at = from;
  while (at < line.length && isBlank(line[at])) at += 1;
  return at;
}

// Позиция сразу за знаком пункта или -1, если знака нет.
function afterBulletMark(line, at) {
  if (BULLET_SIGNS.has(line[at])) return at + 1;
  let end = at;
  while (end < line.length && isAsciiDigit(line[end])) end += 1;
  return end > at && (line[end] === "." || line[end] === ")") ? end + 1 : -1;
}

function bulletTextOf(line) {
  const markEnd = afterBulletMark(line, skipBlanks(line, 0));
  if (markEnd < 0) return null;
  const textStart = skipBlanks(line, markEnd);
  if (textStart === markEnd || textStart === line.length) return null;
  const text = line.slice(textStart);
  return INNER_LINE_BREAK.test(text) ? null : text.trimEnd();
}

export function splitNewsBody(body) {
  const summary = [];
  const details = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const bullet = bulletTextOf(line);
    if (bullet !== null) details.push(bullet);
    else if (line.trim()) summary.push(line.trim());
  }
  return { summary: summary.join(" "), details };
}

// --- Адрес облака.

const PLAIN_HTTP_HOSTS = new Set(["127.0.0.1", "localhost"]);

function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function cloudOriginOf(raw) {
  const url = parseUrl(raw);
  const clean = url && !url.username && !url.password
    && url.pathname === "/" && !url.search && !url.hash;
  const schemeAllowed = clean && (url.protocol === "https:"
    || (url.protocol === "http:" && PLAIN_HTTP_HOSTS.has(url.hostname)));
  if (!schemeAllowed) throw new NewsV1Error(TEXT_BAD_ORIGIN);
  return url.origin;
}

// --- Договор ответа: запись описана таблицей «поле результата → чтение из сырой записи».

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_LINK = /^https:\/\/\S+$/;
const APP_VERSION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const IMAGE_HASH = /^[0-9a-f]{64}$/;

function refuse() {
  throw new NewsV1Error();
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isAbsent = (value) => value === null || value === undefined;

function matching(value, shape) {
  if (typeof value !== "string" || !shape.test(value)) refuse();
  return value;
}

function boundedText(value, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) refuse();
  return value;
}

function publishedDate(value) {
  if (typeof value !== "string") refuse();
  const moment = Date.parse(value);
  if (Number.isNaN(moment)) refuse();
  return new Date(moment).toISOString();
}

function localizedText(value, maxLength) {
  if (!isRecord(value)) refuse();
  const kept = {};
  for (const [language, text] of Object.entries(value)) {
    if (!NEWS_LANGUAGES.includes(language)) refuse();
    if (boundedText(text, maxLength).trim()) kept[language] = text;
  }
  if (!Object.hasOwn(kept, "ru")) refuse();
  return kept;
}

function linkOf(value) {
  if (isAbsent(value) || value === "") return "";
  return matching(boundedText(value, 2000), HTTPS_LINK);
}

const ITEM_FIELDS = {
  id: (raw) => matching(raw.id, UUID_SHAPE).toLowerCase(),
  publishedAt: (raw) => publishedDate(raw.published_at),
  title: (raw) => localizedText(raw.title, 160),
  body: (raw) => localizedText(raw.body, 4000),
  link: (raw) => linkOf(raw.link),
  // Длина подписи бракует запись и без ссылки: проверка идёт раньше отбрасывания.
  linkLabel: (raw, draft) => {
    const label = isAbsent(raw.link_label) ? "" : boundedText(raw.link_label, 40);
    return draft.link ? label.trim() : "";
  },
  image: (raw) => (isAbsent(raw.image) ? "" : matching(raw.image, IMAGE_HASH)),
  appVersion: (raw) => (isAbsent(raw.app_version) ? "" : matching(raw.app_version, APP_VERSION_SHAPE)),
};

function readItem(raw) {
  if (!isRecord(raw)) refuse();
  const draft = {};
  for (const [field, read] of Object.entries(ITEM_FIELDS)) draft[field] = read(raw, draft);
  return draft;
}

export function validateNewsV1(payload, { limit = MAX_ITEMS } = {}) {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || !Array.isArray(payload.items)) refuse();
  // limit сравнивается как есть: NaN и нечисловая строка снимают и предел 50.
  if (payload.items.length > Math.min(limit, MAX_ITEMS)) refuse();
  return payload.items.map(readItem);
}

// --- Запрос.

async function readReplyJson(response) {
  if (!response.ok) throw new NewsV1Error(TEXT_UNAVAILABLE);
  if (!String(response.headers.get("content-type") || "").includes("application/json")) refuse();
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_REPLY_BYTES) throw new NewsV1Error(TEXT_TOO_LARGE);
  try {
    return JSON.parse(text);
  } catch {
    return refuse();
  }
}

export async function fetchNewsV1({
  origin,
  fetchImpl = globalThis.fetch,
  signal,
  limit = DEFAULT_REQUEST_LIMIT,
} = {}) {
  const url = new URL("/api/v1/public/news", cloudOriginOf(origin));
  url.searchParams.set("limit", String(limit));
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    headers: { Accept: "application/json" },
    signal,
  });
  return validateNewsV1(await readReplyJson(response), { limit });
}
