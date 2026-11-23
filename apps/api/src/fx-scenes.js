/*
 * FX-сцены (`docs/fx-scenes.md`) — кадры GTA V с глубиной для предпросмотра эффектов — со своего origin.
 *
 * Окно Astral ходит только на свой origin (CSP `connect-src 'self'`, `img-src 'self'`), а кадры лежат на нашем CDN. У CDN нет своего
 * пути для сцен: набор — папка пакета `<ASTRAL_MEDIA_ORIGIN>sha256/<SET>/`, где `SET` — sha256 её `manifest.json` и константа в коде
 * (`fx-scenes-set.js`). Поэтому окно просит у локального API:
 *
 *   GET /api/fx-scenes/manifest                                        — манифест набора: байты с CDN сверены с `SET`, разобраны `parseManifest`;
 *   GET /api/fx-scenes/file/<mode>/<weaponClass>/<id>/<name>?sha=<hex> — файл сцены (`name` — `clean.png`, `frames/01-depth.png`, закодированный
 *                                                                          как один сегмент): качается с CDN, размер и sha256
 *                                                                          сверяются с манифестом, потом файл ложится в кэш.
 *
 * Не сошлось хоть что-то — в окно не попадает ничего. Манифест не тот, что в коде, — отказ, как и сбой сети: подменить набор на CDN
 * нельзя, а файлы набора сверены с манифестом. Набор неизменяем (его имя — хэш), поэтому манифест, раз принятый, живёт до перезапуска.
 * Адрес файла несёт его хэш из манифеста (`?sha=`), поэтому кэш — вечный. Нет медиа-хоста или набора — 404, и мастерская остаётся
 * со своим 3D-кадром.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MODES, SCENE_ID, WEAPON_CLASSES, isSceneFileName, parseManifest } from "@modovik/fx-scenes/format.js";
import { cloudMediaOrigin } from "./cloud-media.js";
import { FX_SCENES_SET } from "./fx-scenes-set.js";

/* Потолок одного файла сцены: кадр 4K PNG и глубина — десятки МБ. */
export const FX_SCENE_FILE_MAX_BYTES = 64 * 1024 * 1024;
/* Манифест — текст на сотни сцен. */
const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
const HEX = /^[0-9a-f]{64}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const typeOf = (name) => (name.endsWith(".json") ? "application/json" : "image/png");

const failure = (message, status = 502) => Object.assign(new Error(message), { status });

/** Байты ответа с потолком; больше — отказ, не обрезка. */
async function readBody(response, maxBytes) {
  if (!response.ok || !response.body) throw failure("CDN не отдал файл сцены.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw failure("Файл больше потолка.");
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw failure("Файл больше потолка.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/**
 * @param {object} options
 * @param {string} options.origin — медиа-хост (через `cloudMediaOrigin`), пусто — сцен нет
 * @param {string} options.cacheRoot — папка кэша файлов
 * @param {string} [options.set] — sha256 манифеста набора (по умолчанию константа сборки); не 64 знака hex — сцен нет
 */
export function createFxScenesHandlers({ origin, cacheRoot, set = FX_SCENES_SET, fetchImpl = fetch, maxBytes = FX_SCENE_FILE_MAX_BYTES }) {
  let manifest = null;
  let manifestPending = null;
  const inflight = new Map();
  const fileOf = (hex) => path.join(cacheRoot, hex.slice(0, 2), hex);
  /* Папка набора на CDN: пакет с именем-хэшем манифеста. */
  const base = origin && HEX.test(String(set)) ? `${origin}sha256/${set}/` : "";

  /* Манифест: принятый живёт до перезапуска (набор неизменяем); пока не принят — с CDN, сверенный с `set`. Сбой или чужие байты — null. */
  async function currentManifest() {
    if (!base) return null;
    if (manifest) return manifest;
    manifestPending ??= (async () => {
      try {
        const response = await fetchImpl(`${base}manifest.json`, { redirect: "error", credentials: "omit" });
        const bytes = await readBody(response, MANIFEST_MAX_BYTES);
        if (sha256(bytes) !== set) throw failure("Манифест на CDN не тот, что в сборке.");
        manifest = parseManifest(bytes.toString("utf8"));
      } catch {
        /* сцен нет, пока CDN не отдаст тот манифест, чей хэш в сборке */
      }
      return manifest;
    })().finally(() => {
      manifestPending = null;
    });
    return manifestPending;
  }

  async function cached(hex) {
    const file = fileOf(hex);
    try {
      return (await stat(file)).isFile() ? file : null;
    } catch {
      return null;
    }
  }

  async function fetchAndStore(entry, name, file) {
    const url = `${base}${entry.path}/${name}`;
    const bytes = await readBody(await fetchImpl(url, { redirect: "error", credentials: "omit" }), maxBytes);
    if (bytes.byteLength !== file.bytes) throw failure("Размер файла не сошёлся с манифестом.");
    if (sha256(bytes) !== file.sha256) throw failure("Хэш файла не сошёлся с манифестом.");
    const target = fileOf(file.sha256);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx");
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return target;
  }

  return {
    /** `GET /api/fx-scenes/manifest` */
    async manifest(_request, response) {
      const current = await currentManifest();
      if (!current) return response.status(404).end();
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      return response.status(200).end(JSON.stringify(current));
    },

    /** `GET /api/fx-scenes/file/:mode/:weaponClass/:id/:name?sha=<hex>` */
    async file(request, response) {
      const { mode, weaponClass, id, name } = request.params || {};
      const sha = String(request.query?.sha || "");
      if (!MODES.includes(mode) || !WEAPON_CLASSES.includes(weaponClass) || !SCENE_ID.test(String(id || "")) || !isSceneFileName(name) || !HEX.test(sha)) return response.status(404).end();
      const current = await currentManifest();
      const entry = current?.scenes.find((item) => item.mode === mode && item.weaponClass === weaponClass && item.id === id);
      const file = entry?.files[name];
      /* Файла нет в манифесте или хэш в адресе — не его: окно держит старый манифест, пусть перечитает. */
      if (!file || file.sha256 !== sha) return response.status(404).end();
      let target = await cached(sha);
      if (!target) {
        let pending = inflight.get(sha);
        if (!pending) {
          pending = fetchAndStore(entry, name, file).finally(() => inflight.delete(sha));
          inflight.set(sha, pending);
        }
        try {
          target = await pending;
        } catch (error) {
          return response.status(error.status || 502).end();
        }
      }
      response.setHeader("Content-Type", typeOf(name));
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cross-Origin-Resource-Policy", "same-site");
      return response.sendFile(target, { dotfiles: "allow" }, (error) => {
        if (!error || response.headersSent) return;
        response.setHeader("Cache-Control", "no-store");
        response.status(404).end();
      });
    },
  };
}

/** Обработчики с медиа-хостом из `ASTRAL_MEDIA_ORIGIN` и кэшем в runtime. */
export function fxScenesFromEnv(runtimeRoot, env = process.env) {
  return createFxScenesHandlers({ origin: cloudMediaOrigin(env.ASTRAL_MEDIA_ORIGIN), cacheRoot: path.join(runtimeRoot, "fx-scenes") });
}
