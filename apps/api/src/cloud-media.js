// Облачные медиа по хэшу: определение типа, адрес медиа-хоста, кэширующий обработчик.
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { audioKind, videoKind } from "@modovik/publishing/node";
import { createThumbCacheKeeper, createThumbnailer, thumbFileOf, thumbWidthOf } from "./media-thumb.js";

export const CLOUD_MEDIA_MAX_BYTES = 64 * 2 ** 20;
export const NEWS_MEDIA_MAX_BYTES = 1572864;

const NEWS_PATH = "api/v1/public/news/media/";
const isHash = (text) => /^[0-9a-f]{64}$/.test(text);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const NEWS_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const ascii = (text) => Array.from(text, (ch) => ch.charCodeAt(0));
const matchesAt = (bytes, offset, pattern) => pattern.every((byte, i) => bytes[offset + i] === byte);

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff];
const [RIFF, WEBP, GLTF] = ["RIFF", "WEBP", "glTF"].map(ascii);

// Версия контейнера glTF лежит по смещению 4, порядок байтов обратный.
function gltfVersion(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true);
}

// Порядок важен: побеждает первая подошедшая сигнатура.
const SIGNATURES = [
  ["image/png", (b) => b.length >= 8 && matchesAt(b, 0, PNG_HEAD)],
  ["image/jpeg", (b) => b.length >= 3 && matchesAt(b, 0, JPEG_HEAD)],
  ["image/webp", (b) => b.length >= 12 && matchesAt(b, 0, RIFF) && matchesAt(b, 8, WEBP)],
  ["model/gltf-binary", (b) => b.length >= 12 && matchesAt(b, 0, GLTF) && gltfVersion(b) === 2],
  ["video/webm", (b) => videoKind(b) === "webm"],
];

const AUDIO_TYPES = { wav: "audio/wav", ogg: "audio/ogg", mp3: "audio/mpeg" };

export function sniffCloudMedia(bytes) {
  const image = SIGNATURES.find(([, fits]) => fits(bytes));
  if (image) return image[0];
  return AUDIO_TYPES[audioKind(bytes)] ?? null;
}

// Причины отказать адресу медиа-хоста; хоть одна сработала — адрес не годится.
const ORIGIN_REFUSALS = [
  (url) => !(url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))),
  (url) => url.username !== "" || url.password !== "",
  (url) => url.search !== "" || url.hash !== "",
  (url) => url.pathname !== "/",
];

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function cloudMediaOrigin(value) {
  const url = value ? parseUrl(value) : null;
  if (!url || ORIGIN_REFUSALS.some((refuses) => refuses(url))) return "";
  return new URL("/", url).href;
}

export function newsMediaOrigin(value) {
  const base = cloudMediaOrigin(value);
  return base && base + NEWS_PATH;
}

/*
 * Пределы ожидания походов на медиа-хост (16.11.2026, зависшая обложка). Раньше `fetch` ждал без предела, отмены и повтора: CDN иногда зависает (1 запрос из 68 не ответил за 20 с), а зависший поход держал
 * соединение окна с локальной службой до пяти минут (предел undici). Соединений к одному адресу у окна шесть: шесть зависших обложек — и стояло всё с этого адреса, включая статические знаки проектов.
 * Теперь: предел до первых байт и предел «нет данных» между кусками тела (оба обрывают поход через `AbortController` и освобождают соединение), два повтора с нарастающей паузой и быстрый 504; походов на CDN
 * одновременно не больше `concurrency` — остальные ждут своей очереди (их собственное ожидание — тоже под пределами предыдущих). Ошибки, у которых повтор ничего не изменит (чужой хэш, тип, размер, 4xx), не повторяются.
 */
export const MEDIA_TIMING = Object.freeze({ firstByteMs: 8000, idleMs: 15000, retries: 2, pausesMs: Object.freeze([300, 900]), jitter: 0.3, concurrency: 6 });
/* Очередь службы — 6 (решение ведущей 16.11.2026): очередь 4 замедляла обычную страницу на треть (CDN отдаёт ~0,45 МБ/с на соединение), а защита от зависшего запроса теперь стоит в окне (`LOAD_SLOTS` в `Skeleton.jsx`: 5 мест для картинок плиток, соединение окна всегда свободно остальному). */

class MediaStall extends Error {
  constructor(stage) {
    super(`Медиа-хост не ответил вовремя (${stage}).`);
    this.status = 504;
    this.retryable = true;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ограничитель числа одновременных походов: лишние ждут в очереди по порядку.
function createGate(limit) {
  let running = 0;
  const waiting = [];
  const release = () => {
    running -= 1;
    const next = waiting.shift();
    if (next) next();
  };
  return async function run(work) {
    if (running >= limit) await new Promise((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

// Ждёт `promise`, но не дольше `ms`: тогда обрывает поход (`controller`) и бросает `MediaStall`.
function within(promise, ms, controller, stage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new MediaStall(stage));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Тело ответа кусками; сумма длин не должна превышать потолок; между кусками не дольше `idleMs`.
async function drain(body, ceiling, { idleMs = 0, controller = null } = {}) {
  const reader = body.getReader();
  const pieces = [];
  let total = 0;
  for (;;) {
    const { done, value } = idleMs && controller
      ? await within(reader.read(), idleMs, controller, "тело").catch(async (error) => {
          if (error instanceof MediaStall) await reader.cancel().catch(() => {});
          throw error;
        })
      : await reader.read();
    if (done) return Buffer.concat(pieces);
    total += value.length;
    if (total > ceiling) {
      await reader.cancel().catch(() => {});
      throw new Error("Объект больше потолка.");
    }
    pieces.push(value);
  }
}

function vetReply(reply, ceiling) {
  if (!reply.ok || !reply.body) {
    const refusal = new Error("Медиа-хост не отдал объект.");
    /* 5xx и «слишком часто» стоит повторить; 404 и прочие 4xx — нет: объекта там нет, повтор ничего не изменит. */
    refusal.retryable = reply.status >= 500 || reply.status === 429;
    throw refusal;
  }
  const declared = Number(reply.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ceiling) throw new Error("Объект больше потолка.");
}

function vetBytes(bytes, hash, accept) {
  const same = createHash("sha256").update(bytes).digest("hex") === hash;
  if (!same) throw new Error("Хэш объекта не сошёлся.");
  const type = sniffCloudMedia(bytes);
  if (type === null || (accept && !accept.has(type))) {
    throw new Error("Объект — не картинка, не модель, не звук и не видео.");
  }
  return type;
}

// Запись «объект + тип»: сначала во временный файл, потом метка типа и переименование; при сбое временный файл убирается.
async function publishFile({ folder, file, bytes, type }) {
  const scratch = `${file}.${randomUUID()}.tmp`;
  await mkdir(folder, { recursive: true });
  try {
    const handle = await open(scratch, "wx");
    await handle.writeFile(bytes).finally(() => handle.close());
    await writeFile(`${file}.type`, type);
    await rename(scratch, file);
  } catch (error) {
    await rm(scratch, { force: true }).catch(() => {});
    throw error;
  }
}

// Кэш объектов по хэшу и общая загрузка: одновременные запросы одного хэша делят один поход.
class ObjectStore {
  constructor({ origin, cacheRoot, fetchImpl, maxBytes, accept, timing = MEDIA_TIMING }) {
    Object.assign(this, { origin, cacheRoot, fetchImpl, maxBytes, accept, timing });
    this.pending = new Map();
    this.gate = createGate(Math.max(1, timing.concurrency));
  }

  folderOf(hash) {
    return join(this.cacheRoot, hash.slice(0, 2));
  }

  pathOf(hash) {
    return join(this.folderOf(hash), hash);
  }

  // Тип из кэша либо null, если пары файлов нет. Содержимое не проверяется.
  cachedType(hash) {
    const file = this.pathOf(hash);
    return stat(file)
      .then((info) => (info.isFile() ? readFile(`${file}.type`, "utf8").then((text) => text.trim()) : null))
      .catch(() => null);
  }

  // Один поход: предел до первых байт, предел простоя тела, отмена при обоих.
  async attempt(hash) {
    const controller = new AbortController();
    const { firstByteMs, idleMs } = this.timing;
    const reply = await within(
      Promise.resolve().then(() => this.fetchImpl(this.urlOf(hash), { redirect: "error", credentials: "omit", signal: controller.signal })),
      firstByteMs,
      controller,
      "первые байты",
    );
    vetReply(reply, this.maxBytes);
    const bytes = await drain(reply.body, this.maxBytes, { idleMs, controller });
    const type = this.vet(bytes, hash);
    await this.save(hash, bytes, type);
    return type;
  }

  // Адрес объекта на медиа-хосте, проверка пришедших байтов и запись в кэш: у превью (ниже) своё.
  urlOf(hash) {
    return `${this.origin}sha256/${hash}`;
  }

  vet(bytes, hash) {
    return vetBytes(bytes, hash, this.accept);
  }

  save(hash, bytes, type) {
    return publishFile({ folder: this.folderOf(hash), file: this.pathOf(hash), bytes, type });
  }

  /* Поход с повторами: сбой сети, зависание и 5xx повторяются с нарастающей паузой (вне очереди — паузу не держит место), остальное — сразу отказ. Исчерпано — ошибка с кодом (зависание — 504). */
  async download(hash) {
    const { retries, pausesMs } = this.timing;
    for (let attemptNo = 0; ; attemptNo += 1) {
      try {
        return await this.gate(() => this.attempt(hash));
      } catch (error) {
        /* Зависание повторяется один раз: оно уже стоило полного предела, а соединение окна всё это время занято; третий такой круг только задерживает остальные обложки (плита фото сама попросит ещё раз). */
        const limit = error instanceof MediaStall ? Math.min(retries, 1) : retries;
        const again = attemptNo < limit && (error?.retryable || error?.name === "TypeError" || error?.name === "AbortError");
        if (!again) throw error;
        /* Пауза с разбросом ±`jitter`: плитки, что споткнулись вместе, не идут на хост повторно все в один миг. */
        const pause = pausesMs[Math.min(attemptNo, pausesMs.length - 1)] ?? 0;
        await sleep(Math.round(pause * (1 + (Math.random() * 2 - 1) * (this.timing.jitter ?? 0))));
      }
    }
  }

  obtain(hash) {
    if (!this.pending.has(hash)) {
      this.pending.set(hash, this.download(hash).finally(() => this.pending.delete(hash)));
    }
    return this.pending.get(hash);
  }

  // { type } — объект есть; { status } — отвечать этим кодом.
  async acquire(hash) {
    const type = await this.cachedType(hash);
    if (type !== null) return { type };
    if (!this.origin) return { status: 404 };
    return this.obtain(hash).then(
      (loaded) => ({ type: loaded }),
      (error) => ({ status: error?.status || 502 }),
    );
  }
}

/*
 * Готовое превью с медиа-хоста раньше оригинала (16.11.2026, слово владельца: «почему фото карточек так долго прогружаются»). Раньше на запрос `?w=360` служба качала весь оригинал (PNG 1200×675, 240–340 КБ; кадр расцветки 512×512,
 * ~115 КБ) и только потом уменьшала у себя, а CDN отдаёт ~0,4–0,5 МБ/с на соединение: плитка стоила секунд. Теперь, если назван набор превью (`READY_THUMBS.set`), служба для ширины из набора сначала идёт за готовым webp на хосте
 * (20–40 КБ) и кладёт его туда, где лежало бы своё уменьшение (`<оригинал>.w<ширина>.webp`: тот же кэш, тот же сторож объёма, тот же файл для следующего запроса, оригинал не нужен вовсе). Нет превью (404, сбой, зависание, не webp,
 * больше потолка) или набор не назван — путь прежний: оригинал и уменьшение у себя. Набор лежит на CDN как пакет по образцу зеркала фото одежды (`packages/clothing/photos.js`):
 *
 *   <origin>/sha256/<набор>/<ширина>/<sha256 оригинала>.webp      <набор> — sha256 файла manifest.tsv набора (файл, байты, sha256 каждой картинки)
 *
 * Проверка: тип (webp по сигнатуре) и потолок размера. Хэш не сверяется: превью — не оригинал, его sha256 в каталоге нет; набор привязан к хосту и своему хэшу манифеста, а байты в кэше после записи не меняются. Не удалось — пять минут
 * этот адрес не просится заново (запись на ключ «ширина/хэш»), чтобы плитка без превью не ходила на хост дважды на каждый показ. Ходит по той же очереди и под теми же пределами, что оригиналы; повтор — без своих повторов: запасной путь есть.
 */
/* Ширины набора (решение ведущей 16.11.2026): 360 и 540 — у всех картинок, 720 — только у обложек (плитки при масштабе 150–200 %, шапка карточки при 1,5×; кадрам расцветок 512×512 он не нужен); 960 идёт оригиналом.
   Ширины, которой для этого файла в наборе нет, — запрос за превью получает 404, запоминается на пять минут, и дальше всё идёт за оригиналом. Качество превью в наборе — webp q85 (описание формата для того, кто его готовит, не проверка здесь). */
/* Набор e251cfd7…: 94 249 webp q85 (360 и 540 — по 44 722, 720 — 4 805 обложек), выложен на CDN 16.11.2026 в 14:44 UTC, манифест сверен (sha256 = имени набора). */
/* 18.11.2026 (выкладка `manifest-add-1811-gallery.tsv` в каталог набора, `docs/runbooks/catalog-import.md`, «Превью галерей»): к одежде добавлены ганпаки, редуксы и «Прочее» — обложки и кадры галерей, у каждой картинки шире 540 ярусы от 360 до родного (1200 → до 1280, 1600 → до 1600; у кадров расцветок 512 — 360 и 540). Кадр открытой карточки просит ярусы 960–1600. Картинки не шире 540 ярусов выше 540 не имеют — окно их и не просит (`utils/stage-photo.js`). */
export const READY_THUMBS = Object.freeze({
  set: "e251cfd7f767612fc90725435ff2859bd67e177b46079af45a62737fddf083d6",
  widths: Object.freeze([360, 540, 720, 960, 1280, 1600]),
});
const READY_THUMB_MAX_BYTES = 512 * 1024;
const READY_THUMB_RETRY_MS = 5 * 60_000;
const READY_THUMB_MEMORY = 4096;
const WEBP_TYPE = "image/webp";

class ReadyThumbStore extends ObjectStore {
  constructor(parent, set) {
    super({
      origin: parent.origin,
      cacheRoot: parent.cacheRoot,
      fetchImpl: parent.fetchImpl,
      maxBytes: READY_THUMB_MAX_BYTES,
      accept: null,
      timing: { ...parent.timing, retries: 0 },
    });
    this.gate = parent.gate;
    this.parent = parent;
    this.set = set;
    this.failed = new Map();
  }

  // Ключ — «ширина/хэш оригинала».
  hashOf(key) {
    return key.slice(key.indexOf("/") + 1);
  }

  widthOf(key) {
    return Number(key.slice(0, key.indexOf("/")));
  }

  urlOf(key) {
    return `${this.origin}sha256/${this.set}/${this.widthOf(key)}/${this.hashOf(key)}.webp`;
  }

  folderOf(key) {
    return this.parent.folderOf(this.hashOf(key));
  }

  pathOf(key) {
    return thumbFileOf(this.parent.pathOf(this.hashOf(key)), this.widthOf(key));
  }

  vet(bytes) {
    const webp = bytes.length >= 12 && matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP);
    if (!webp) throw new Error("Превью — не webp.");
    return WEBP_TYPE;
  }

  async save(key, bytes) {
    const file = this.pathOf(key);
    const scratch = `${file}.${randomUUID()}.tmp`;
    await mkdir(this.folderOf(key), { recursive: true });
    try {
      await writeFile(scratch, bytes, { flag: "wx" });
      await rename(scratch, file);
    } catch (error) {
      await rm(scratch, { force: true }).catch(() => {});
      throw error;
    }
  }

  /* Файл превью ширины `width` для оригинала `hash`: из кэша, иначе с хоста; пусто — превью нет, идти за оригиналом. */
  async fileFor(hash, width) {
    const key = `${width}/${hash}`;
    const file = this.pathOf(key);
    if (await stat(file).then((info) => info.isFile(), () => false)) return file;
    const failedAt = this.failed.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < READY_THUMB_RETRY_MS) return "";
    try {
      await this.obtain(key);
      return file;
    } catch {
      this.failed.delete(key);
      this.failed.set(key, Date.now());
      while (this.failed.size > READY_THUMB_MEMORY) this.failed.delete(this.failed.keys().next().value);
      return "";
    }
  }
}

const finish = (response, status) => response.status(status).end();

const successHeaders = (type) => [
  ["Content-Type", type],
  ["Cache-Control", "public, max-age=31536000, immutable"],
  ["X-Content-Type-Options", "nosniff"],
  ["Cross-Origin-Resource-Policy", "same-site"],
];

// Сбой отдачи файла до отправки заголовков: ответ не кэшируется, статус 404.
function failSend(response, error) {
  if (!error || response.headersSent) return;
  response.setHeader("Cache-Control", "no-store");
  finish(response, 404);
}

// Сигнал, который гаснет, если окно закрыло запрос раньше конца ответа.
function closeSignal(response) {
  const guard = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) guard.abort();
  });
  return guard.signal;
}

// Миниатюра вместо оригинала; null — окно закрыло запрос, пока шло уменьшение.
async function pickRendition(response, thumbnail, original, width) {
  const signal = closeSignal(response);
  const small = await thumbnail(original.file, original.type, width, signal);
  return signal.aborted ? null : small || original;
}

function deliver(response, served) {
  for (const [name, value] of successHeaders(served.type)) response.setHeader(name, value);
  response.sendFile(served.file, { dotfiles: "allow" }, (error) => failSend(response, error));
}

export function createCloudMediaHandler({
  cacheRoot,
  origin,
  accept = null,
  maxBytes = CLOUD_MEDIA_MAX_BYTES,
  thumbnail = createThumbnailer(),
  fetchImpl = (...args) => fetch(...args),
  timing = MEDIA_TIMING,
  thumbs = READY_THUMBS,
}) {
  const store = new ObjectStore({ origin, cacheRoot, fetchImpl, maxBytes, accept, timing: { ...MEDIA_TIMING, ...timing } });
  /* Набор превью не назван (или адрес медиа-хоста пуст) — путь прежний. */
  const ready = origin && isHash(String(thumbs?.set || "")) ? new ReadyThumbStore(store, thumbs.set) : null;
  const readyWidths = new Set(thumbs?.widths ?? []);

  return async function serveCloudMedia(request, response) {
    const hash = request.params.sha256 || "";
    if (!isHash(hash)) return finish(response, 404);

    const width = thumbWidthOf(request.query?.w);
    if (ready && readyWidths.has(width)) {
      const file = await ready.fileFor(hash, width);
      if (file) {
        deliver(response, { file, type: WEBP_TYPE });
        return undefined;
      }
    }
    const resizing = Boolean(width && thumbnail);
    if (resizing) thumbnail.prepare?.();

    const found = await store.acquire(hash);
    if (found.status) return finish(response, found.status);

    const original = { file: store.pathOf(hash), type: found.type };
    const served = resizing ? await pickRendition(response, thumbnail, original, width) : original;
    if (served) deliver(response, served);
    return undefined;
  };
}

// Окружение → настройки обработчика: папка кэша, переменная адреса, пределы и сторож превью.
const PROFILES = {
  cloud: {
    folder: "cloud-media",
    variable: "ASTRAL_MEDIA_ORIGIN",
    toOrigin: cloudMediaOrigin,
    limits: {},
    watchesThumbs: true,
    /* Набор превью можно назвать и снаружи (проверка стенда до выкладки новой версии окна); пусто — константа `READY_THUMBS.set`. */
    thumbsVariable: "ASTRAL_MEDIA_THUMB_SET",
    /* Ярусы набора — тоже подменяемы снаружи (стенд замера до выкладки новых ярусов 960/1280/1600 на CDN): список через запятую, только из ряда `THUMB_WIDTHS`; пусто — константа `READY_THUMBS.widths`. */
    thumbsWidthsVariable: "ASTRAL_MEDIA_THUMB_WIDTHS",
  },
  news: {
    folder: "news-media",
    variable: "ASTRAL_NEWS_ORIGIN",
    toOrigin: newsMediaOrigin,
    limits: { maxBytes: NEWS_MEDIA_MAX_BYTES, accept: NEWS_TYPES },
    watchesThumbs: false,
  },
};

function supervisedThumbnailer(cacheRoot) {
  const keeper = createThumbCacheKeeper(cacheRoot);
  keeper.start();
  const onMade = (size) => keeper.made(size);
  return createThumbnailer({ onMade });
}

function handlerFromProfile(profile, runtimeRoot, env) {
  const cacheRoot = join(runtimeRoot, profile.folder);
  const settings = { origin: profile.toOrigin(env[profile.variable]), cacheRoot, ...profile.limits };
  if (profile.watchesThumbs) settings.thumbnail = supervisedThumbnailer(cacheRoot);
  if (profile.thumbsVariable) {
    const named = String(env[profile.thumbsVariable] || "").trim().toLowerCase();
    const widths = String(env[profile.thumbsWidthsVariable] || "")
      .split(",")
      .map((item) => thumbWidthOf(item.trim()))
      .filter(Boolean);
    settings.thumbs = { ...READY_THUMBS, set: named || READY_THUMBS.set, ...(widths.length ? { widths } : {}) };
  }
  return createCloudMediaHandler(settings);
}

export const cloudMediaFromEnv = (runtimeRoot, env = process.env) => handlerFromProfile(PROFILES.cloud, runtimeRoot, env);

export const newsMediaFromEnv = (runtimeRoot, env = process.env) => handlerFromProfile(PROFILES.news, runtimeRoot, env);
