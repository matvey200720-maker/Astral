import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  MAJESTIC_WIKI_HOST,
  majesticType,
  majesticWikiUrl,
  normalizeWikiItem,
  parseMajesticWikiPage,
} from "@modovik/clothing/majestic-wiki";

const PAGE_CEILING = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const PAGES_PER_KIND = 40;
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_FOLDER = "majestic-wiki";

// Отказы: код → текст (HTTP подставляет статус).
const REFUSAL_TEXT = {
  WIKI_HOST: () => "Вики Majestic читается только с её сайта.",
  WIKI_HTTP: (status) => `Вики ответила ${status}.`,
  WIKI_SIZE: () => "Страница вики слишком велика.",
  WIKI_FORMAT: () => "Вики сменила формат.",
};

function refuse(code, detail) {
  const failure = new Error(REFUSAL_TEXT[code](detail));
  failure.code = code;
  return failure;
}

// Единственное место, где живёт таймер запроса: заводится до вызова, снимается при любом исходе.
async function withDeadline(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const isWikiAddress = (address) => (
  address.protocol === "https:" && address.hostname === MAJESTIC_WIKI_HOST
);
const overCeiling = (size) => size > PAGE_CEILING;
const declaresTooMuch = (response) => overCeiling(Number(response.headers.get("content-length")));

// Накопитель байтов с удвоением: текст декодируется один раз в конце, поэтому
// многобайтовые знаки, разорванные между порциями, читаются верно.
class ByteSink {
  constructor() {
    this.bytes = Buffer.allocUnsafe(64 * 1024);
    this.length = 0;
  }

  push(chunk) {
    const needed = this.length + chunk.length;
    if (needed > this.bytes.length) {
      const grown = Buffer.allocUnsafe(Math.max(needed, this.bytes.length * 2));
      this.bytes.copy(grown, 0, 0, this.length);
      this.bytes = grown;
    }
    this.bytes.set(chunk, this.length);
    this.length = needed;
  }

  text() {
    return this.bytes.toString("utf8", 0, this.length);
  }
}

// Отказ самой отмены потока не важен: наружу идёт WIKI_SIZE.
const abandon = (reader) => Promise.resolve().then(() => reader.cancel()).catch(() => {});

async function drain(reader) {
  const sink = new ByteSink();
  for (let step = await reader.read(); !step.done; step = await reader.read()) {
    if (overCeiling(sink.length + step.value.length)) {
      await abandon(reader);
      throw refuse("WIKI_SIZE");
    }
    sink.push(step.value);
  }
  return sink.text();
}

export async function fetchWikiPage(url, fetchImpl = fetch) {
  const address = new URL(url);
  if (!isWikiAddress(address)) throw refuse("WIKI_HOST");
  return withDeadline(async (signal) => {
    const response = await fetchImpl(address.href, {
      redirect: "error",
      signal,
      headers: { accept: "text/html" },
    });
    if (!response.ok) throw refuse("WIKI_HTTP", response.status);
    if (declaresTooMuch(response)) throw refuse("WIKI_SIZE");
    return drain(response.body.getReader());
  });
}

const answer = (status, fetchedAt, items) => ({ status, fetchedAt, items });

const holdsItems = (stored) => Array.isArray(stored?.items);

// Годен только файл с массивом items; любая ошибка чтения или разбора — «кэша нет».
const readCache = (file) => readFile(file, "utf8")
  .then(JSON.parse)
  .then((stored) => (holdsItems(stored) ? stored : null))
  .catch(() => null);

const isFresh = (stored, now) => stored !== null && now - stored.fetchedAt < CACHE_TTL_MS;

// Страницы вики по очереди; разбор, не узнавший страницу, — отказ WIKI_FORMAT.
async function* wikiPages({ gender, component }, fetchImpl) {
  for (let page = 1; page <= PAGES_PER_KIND; page += 1) {
    const text = await fetchWikiPage(majesticWikiUrl({ gender, component, page }), fetchImpl);
    const parsed = parseMajesticWikiPage(text);
    if (!parsed) throw refuse("WIKI_FORMAT");
    yield parsed;
  }
}

// Таблица вещей по сквозному номеру: повтор заменяет запись, но не двигает её с места.
class ItemTable {
  constructor({ gender, component }) {
    this.gender = gender;
    this.component = component;
    this.rows = new Map();
    this.expected = Infinity;
  }

  isRequested(item) {
    return item !== null && item.gender === this.gender && item.component === this.component;
  }

  // Берёт страницу; ложь — страниц больше не нужно (пустая страница или набрано «всего»).
  absorb(page) {
    this.expected = page.total;
    if (page.items.length === 0) return false;
    page.items
      .map((raw) => normalizeWikiItem(raw))
      .filter((item) => this.isRequested(item))
      .forEach((item) => this.rows.set(item.drawable, item));
    return this.rows.size < this.expected;
  }

  list() {
    return [...this.rows.values()];
  }
}

async function collectItems(request, fetchImpl) {
  const table = new ItemTable(request);
  for await (const page of wikiPages(request, fetchImpl)) {
    if (!table.absorb(page)) break;
  }
  return table.list();
}

function describeRequest(input) {
  const gender = input?.gender;
  const component = String(input?.component || "");
  const kind = majesticType(component);
  return kind && (gender === "male" || gender === "female") ? { gender, component, kind } : null;
}

// Любой сбой перекачки: старый кэш (даже просроченный) лучше, чем ничего.
function fallbackAnswer(stored, failure) {
  if (stored) return answer("stale", stored.fetchedAt, stored.items);
  return answer(failure.code === "WIKI_FORMAT" ? "format" : "unavailable", null, []);
}

export async function readMajesticWiki(input, options = {}) {
  const { stateDir, fetchImpl = fetch, now = Date.now() } = options;
  const request = describeRequest(input);
  if (request === null) return answer("unsupported", null, []);

  const file = join(stateDir, CACHE_FOLDER, `${request.gender}-${request.kind}.json`);
  const stored = await readCache(file);
  if (isFresh(stored, now)) return answer("cached", stored.fetchedAt, stored.items);

  const refill = async () => {
    const items = await collectItems(request, fetchImpl);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ fetchedAt: now, items }));
    return items;
  };
  return refill().then(
    (items) => answer("fresh", now, items),
    (failure) => fallbackAnswer(stored, failure),
  );
}
