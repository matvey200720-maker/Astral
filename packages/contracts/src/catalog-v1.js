const maximumPageBytes = 2 * 1024 * 1024;
/* Потолки — как у v2 (`catalog-v2.js`): 5 000 модов живой каталог перерос
   03.11.2026, и дошедший до потолка каталог теперь обрезается, а не падает. */
const maximumCatalogItems = 25_000;
const maximumPages = 1_000;
const pageLimit = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,99}$/;
const categoryPattern = /^[a-z0-9_-]{1,40}$/;
const cursorPattern = /^[A-Za-z0-9_-]{22}$/;

export class CatalogV1Error extends Error {
  constructor(message = "Astral Catalog returned invalid data.") {
    super(message);
    this.name = "CatalogV1Error";
    this.code = "INVALID_CATALOG_V1";
  }
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

function boundedString(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    value === value.trim() &&
    !value.includes("\0")
  );
}

function catalogSection(category) {
  if (category === "redux" || category === "graphics") return "redux";
  if (category === "weapons" || category === "gunpacks") return "gunpacks";
  if (category === "clothing") return "clothing";
  return "other";
}

function presentation(item) {
  return Object.freeze({
    id: item.id,
    slug: item.slug,
    name: item.title,
    description: item.description,
    category: item.category,
    categoryLabel: item.category_label,
    catalogSection: catalogSection(item.category),
    platformLabel: item.platform_label,
    rating: item.rating.toFixed(1),
    downloads: String(item.downloads),
    isNew: item.is_new,
    icon: item.category === "weapons" ? "Zap" : "Sparkles",
    tone: "violet",
    packageStatus: "preview",
    releaseId: item.current_release_id || "",
  });
}

export function parseCatalogV1Page(payload) {
  const keys = Object.keys(payload || {})
    .sort()
    .join(",");
  if (keys !== "items" && keys !== "items,next_cursor") {
    throw new CatalogV1Error();
  }
  if (!Array.isArray(payload.items) || payload.items.length > pageLimit) {
    throw new CatalogV1Error();
  }
  const nextCursor = payload.next_cursor || "";
  if (nextCursor && !cursorPattern.test(nextCursor)) {
    throw new CatalogV1Error();
  }
  const items = payload.items.map((item) => {
    if (
      !exactKeys(item, [
        "id",
        "slug",
        "title",
        "description",
        "category",
        "category_label",
        "platform_label",
        "rating",
        "downloads",
        "is_new",
        "current_release_id",
      ]) ||
      !uuidPattern.test(item.id || "") ||
      !slugPattern.test(item.slug || "") ||
      !boundedString(item.title, 1, 160) ||
      typeof item.description !== "string" ||
      item.description.length > 4_000 ||
      item.description.includes("\0") ||
      !categoryPattern.test(item.category || "") ||
      !boundedString(item.category_label, 1, 40) ||
      !boundedString(item.platform_label, 1, 40) ||
      !Number.isFinite(item.rating) ||
      item.rating < 0 ||
      item.rating > 5 ||
      !Number.isSafeInteger(item.downloads) ||
      item.downloads < 0 ||
      typeof item.is_new !== "boolean" ||
      (item.current_release_id !== "" &&
        !uuidPattern.test(item.current_release_id || ""))
    ) {
      throw new CatalogV1Error();
    }
    return presentation(item);
  });
  return Object.freeze({ items: Object.freeze(items), nextCursor });
}

function validateOrigin(raw) {
  let value;
  try {
    value = new URL(raw);
  } catch {
    throw new CatalogV1Error("Astral Catalog origin is invalid.");
  }
  if (
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash ||
    !["https:", "http:"].includes(value.protocol)
  ) {
    throw new CatalogV1Error("Astral Catalog origin is invalid.");
  }
  if (
    value.protocol === "http:" &&
    !["127.0.0.1", "localhost"].includes(value.hostname)
  ) {
    throw new CatalogV1Error("Astral Catalog requires HTTPS.");
  }
  return value.origin;
}

async function readBoundedJSON(response) {
  if (
    !(response.headers.get("content-type") || "").includes("application/json")
  ) {
    throw new CatalogV1Error();
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumPageBytes) {
    throw new CatalogV1Error("Astral Catalog page exceeds the client limit.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CatalogV1Error();
  }
}

/*
 * Страницы v1 — в каталог: одни и те же проверки для сети и для запомненных
 * страниц (`catalogV1FromPages`, Т-27).
 */
function catalogV1Assembler({
  maximumItems = maximumCatalogItems,
  maximumPageCount = maximumPages,
} = {}) {
  const mods = [];
  const ids = new Set();
  const slugs = new Set();
  const seenCursors = new Set();
  let pages = 0;
  let cursor = "";
  let done = false;
  let truncated = false;
  const snapshot = () => {
    const categories = [
      ...new Map(
        mods.map((item) => [
          item.category,
          Object.freeze({ id: item.category, name: item.categoryLabel }),
        ]),
      ).values(),
    ];
    return Object.freeze({
      platforms: Object.freeze([]),
      categories: Object.freeze(categories),
      mods: Object.freeze([...mods]),
      source: "astral-go-v1",
      ...(truncated && { truncated: true }),
    });
  };
  return {
    get pages() {
      return pages;
    },
    get cursor() {
      return cursor;
    },
    add(payload) {
      if (done)
        throw new CatalogV1Error(
          "Astral Catalog has a page after its last one.",
        );
      pages += 1;
      const page = parseCatalogV1Page(payload);
      for (const item of page.items) {
        if (ids.has(item.id) || slugs.has(item.slug)) {
          throw new CatalogV1Error("Astral Catalog contains a duplicate item.");
        }
        if (mods.length >= maximumItems) {
          truncated = true;
          break;
        }
        ids.add(item.id);
        slugs.add(item.slug);
        mods.push(item);
      }
      if (page.nextCursor && seenCursors.has(page.nextCursor)) {
        throw new CatalogV1Error("Astral Catalog cursor cycle was rejected.");
      }
      if (page.nextCursor) seenCursors.add(page.nextCursor);
      /* Потолок: следующую страницу не спрашиваем, пришедшее — каталог. */
      if (
        page.nextCursor &&
        (mods.length >= maximumItems || pages >= maximumPageCount)
      ) {
        truncated = true;
      }
      cursor = truncated ? "" : page.nextCursor;
      done = !cursor;
      return cursor;
    },
    snapshot,
    result() {
      if (!done)
        throw new CatalogV1Error("Astral Catalog ended before its last page.");
      return snapshot();
    },
  };
}

/**
 * Весь каталог v1 страницами. `onPage` — как у `fetchCatalogV2`: после
 * каждой проверенной страницы, с самой страницей и каталогом из пришедших.
 */
export async function fetchCatalogV1({
  origin,
  fetchImpl = fetch,
  signal,
  onPage = null,
  /* Потолки модов и страниц (по умолчанию — `catalogV1Limits`); меньше — в тестах. */
  maximumItems,
  maximumPageCount,
} = {}) {
  const cloudOrigin = validateOrigin(origin);
  const catalog = catalogV1Assembler({ maximumItems, maximumPageCount });
  do {
    const target = new URL("/api/v1/public/catalog", cloudOrigin);
    target.searchParams.set("limit", String(pageLimit));
    if (catalog.cursor) target.searchParams.set("cursor", catalog.cursor);
    const response = await fetchImpl(target.toString(), {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new CatalogV1Error("Astral Catalog is temporarily unavailable.");
    }
    const requested = catalog.cursor;
    const payload = await readBoundedJSON(response);
    const cursor = catalog.add(payload);
    await onPage?.({
      page: catalog.pages,
      cursor: requested,
      payload,
      done: !cursor,
      snapshot: catalog.snapshot,
    });
  } while (catalog.cursor);
  return catalog.result();
}

/**
 * Каталог v1 из запомненных страниц `[{ cursor, payload }]` — с теми же
 * проверками, что у сети, и той же цепочкой курсоров.
 */
export function catalogV1FromPages(
  pages,
  { maximumItems, maximumPageCount } = {},
) {
  if (!Array.isArray(pages) || !pages.length) throw new CatalogV1Error();
  const catalog = catalogV1Assembler({ maximumItems, maximumPageCount });
  for (const entry of pages) {
    if (entry?.cursor !== catalog.cursor) {
      throw new CatalogV1Error("Astral Catalog pages are out of order.");
    }
    if (
      new TextEncoder().encode(JSON.stringify(entry.payload)).byteLength >
      maximumPageBytes
    ) {
      throw new CatalogV1Error("Astral Catalog page exceeds the client limit.");
    }
    catalog.add(entry.payload);
  }
  return catalog.result();
}

export const catalogV1Limits = Object.freeze({
  maximumPageBytes,
  maximumCatalogItems,
  maximumPages,
  pageLimit,
});
