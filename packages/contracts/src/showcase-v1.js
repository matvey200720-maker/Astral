// Витрина: карточки мест показа по договору, случайный выбор по весам, пачки событий.

import { cloudOriginOf } from "./news-v1.js";

export const SHOWCASE_PLACES = Object.freeze(["home", "feed", "mod", "news"]);
export const SHOWCASE_EVENT_KINDS = Object.freeze(["view", "click"]);

const TEXT_INVALID_DATA = "Astral showcase returned invalid data.";
const TEXT_UNKNOWN_PLACE = "Astral showcase place is unknown.";
const TEXT_UNAVAILABLE = "Astral showcase is unavailable.";
const TEXT_TOO_LARGE = "Astral showcase exceeds the client limit.";
const TEXT_BATCH_SIZE = "Showcase events must hold 1 to 50 entries.";
const TEXT_BAD_EVENT = "Showcase event is invalid.";
const TEXT_EVENTS_REFUSED = "Astral showcase events refused.";

const MAX_CARDS = 20;
const MAX_EVENTS = 50;
const MAX_REPLY_BYTES = 262144;

export class ShowcaseV1Error extends Error {
  constructor(message = TEXT_INVALID_DATA) {
    super(message);
    this.name = "ShowcaseV1Error";
    this.code = "INVALID_SHOWCASE_V1";
  }
}

const CARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HTTPS_LINK = /^https:\/\/\S+$/;
const ERID_SHAPE = /^[A-Za-z0-9]{10,64}$/;
const INN_SHAPE = /^(?:\d{10}|\d{12})$/;

function refuse() {
  throw new ShowcaseV1Error();
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isAbsent = (value) => value === null || value === undefined;

function matching(value, shape) {
  if (typeof value !== "string" || !shape.test(value)) refuse();
  return value;
}

function httpsAddress(value) {
  if (typeof value === "string" && value.length > 2000) refuse();
  return matching(value, HTTPS_LINK);
}

function sponsorName(value) {
  if (typeof value !== "string" || value.length > 120) refuse();
  const name = value.trim();
  if (!name) refuse();
  return name;
}

function caption(value) {
  if (isAbsent(value)) return "";
  if (typeof value !== "string" || value.length > 160) refuse();
  return value;
}

function innOf(value) {
  if (isAbsent(value) || value === "") return "";
  return matching(value, INN_SHAPE);
}

function weightOf(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) refuse();
  return value;
}

// Порядок записей таблицы задаёт порядок ключей карточки.
const CARD_FIELDS = {
  id: (raw) => matching(raw.id, CARD_ID),
  image: (raw) => httpsAddress(raw.image),
  link: (raw) => httpsAddress(raw.link),
  alt: (raw) => caption(raw.alt),
  sponsor: (raw) => sponsorName(raw.sponsor),
  inn: (raw) => innOf(raw.inn),
  erid: (raw) => matching(raw.erid, ERID_SHAPE),
  weight: (raw) => weightOf(raw.weight),
};

// Метка — параметр erid ссылки (так её ставит adminctl), равный erid карточки. Раньше хватало
// подстроки: проходили «xerid=…» и «erid=…X», то есть в ссылке могла стоять чужая метка.
function eridOfLink(link) {
  try {
    return new URL(link).searchParams.get("erid");
  } catch {
    return null;
  }
}

function readCard(raw) {
  if (!isRecord(raw)) refuse();
  const card = {};
  for (const [field, read] of Object.entries(CARD_FIELDS)) card[field] = read(raw);
  if (eridOfLink(card.link) !== card.erid) refuse();
  return card;
}

export function validateShowcaseV1(payload) {
  if (!isRecord(payload) || Object.keys(payload).length !== 1) refuse();
  const { items } = payload;
  if (!Array.isArray(items) || items.length > MAX_CARDS) refuse();
  return items.map(readCard);
}

export function pickWeighted(items, random = Math.random) {
  if (!items?.length) return null;
  // Веса не проверяются: сумма идёт обычным сложением, и точка сравнивается с ней как есть.
  const point = random() * items.reduce((sum, item) => sum + item.weight, 0);
  let reached = 0;
  for (const item of items) {
    reached += item.weight;
    if (reached > point) return item;
  }
  return items[items.length - 1];
}

function readEvent(raw) {
  const valid = isRecord(raw) && typeof raw.id === "string" && CARD_ID.test(raw.id)
    && SHOWCASE_EVENT_KINDS.includes(raw.kind);
  if (!valid) throw new ShowcaseV1Error(TEXT_BAD_EVENT);
  return { id: raw.id, kind: raw.kind };
}

export function validateShowcaseEvents(events) {
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS) {
    throw new ShowcaseV1Error(TEXT_BATCH_SIZE);
  }
  return events.map(readEvent);
}

const addressOn = (origin, path) => new URL(path, cloudOriginOf(origin));

async function readReplyJson(response) {
  if (!response.ok) throw new ShowcaseV1Error(TEXT_UNAVAILABLE);
  if (!String(response.headers.get("content-type") || "").includes("application/json")) refuse();
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_REPLY_BYTES) throw new ShowcaseV1Error(TEXT_TOO_LARGE);
  try {
    return JSON.parse(text);
  } catch {
    return refuse();
  }
}

export async function fetchShowcaseV1({ origin, place, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!SHOWCASE_PLACES.includes(place)) throw new ShowcaseV1Error(TEXT_UNKNOWN_PLACE);
  const url = addressOn(origin, "/api/v1/public/showcase");
  url.searchParams.set("place", place);
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    headers: { Accept: "application/json" },
    signal,
  });
  return validateShowcaseV1(await readReplyJson(response));
}

export async function postShowcaseEventsV1({ origin, events, fetchImpl = globalThis.fetch, signal } = {}) {
  const batch = validateShowcaseEvents(events);
  const url = addressOn(origin, "/api/v1/public/showcase/views");
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: batch }),
    signal,
  });
  if (!response.ok) throw new ShowcaseV1Error(TEXT_EVENTS_REFUSED);
}
