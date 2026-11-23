import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { astralQaGunpacks } from "./qa-gunpacks.js";
import { astralQaArenaModHall } from "./qa-arena-mod-hall.js";
import { astralQaStandingBody } from "./qa-standing-body.js";
import { astralQaGameTattoos } from "./qa-game-tattoos.js";
import { astralQaAnimations } from "./qa-animations.js";
import { astralQaAnimals } from "./qa-animals.js";
import { astralQaWearCharacter } from "./qa-wear-character.js";
import { astralQaGameWeapons } from "./qa-game-weapons-reader.js";
import { SHEET_BODY_TYPE, packSheets } from "./src/qa-sheet-body.js";
import { astralQaFxScenes } from "./qa-fx-scenes.js";
import { astralQaSkyClip } from "./qa-sky-clip.js";
import { astralQaBigMapCovers } from "./qa-bigmap-covers.js";
import { qaFilesHandler, qaPackGrant, qaPackPublicKey, qaPacks } from "./qa-project-pack-cdn.js";
import { qaCacheDir } from "./qa-cache-dir.js";
import { astralOcrAssets } from "./ocr-assets.js";
import { astralUiText, uiTextChunk } from "./ui-text-plugin.js";
import { astralCoverStamps } from "./cover-stamps-plugin.js";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const runtimeRoot = fileURLToPath(new URL("../..", import.meta.url));
/* Набор знаков лежит в корне репозитория и делится с сайтом. Псевдоним ведёт
   на исходники, поэтому .jsx проходит через тот же плагин React, что и код
   продукта, и неиспользованные глифы вылетают при сборке. */
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const glyphSource = fileURLToPath(
  new URL("../../../packages/astral-glyphs/src", import.meta.url),
);
const designSource = fileURLToPath(
  new URL("../../../packages/astral-design", import.meta.url),
);
const clothingSlotIds = [
  "armor",
  "tshirts",
  "government-clothing",
  "pants",
  "shoes",
  "hats",
  "accessories",
  "gloves",
  "masks",
  "tattoos",
  "bags",
];

function assertCompleteLocalClothingAssets(environment) {
  if (environment.VITE_ASTRAL_LOCAL_CLOTHING_ASSETS !== "1") return;

  const assetRoot = join(
    webRoot,
    "public",
    "assets",
    "catalog",
    "clothing-local",
  );
  const missingAssets = clothingSlotIds.flatMap((slotId) =>
    ["png", "glb"]
      .map((extension) => `${slotId}.${extension}`)
      .filter((fileName) => !existsSync(join(assetRoot, fileName))),
  );

  if (missingAssets.length > 0) {
    throw new Error(
      `VITE_ASTRAL_LOCAL_CLOTHING_ASSETS=1 requires the complete approved local overlay. Missing: ${missingAssets.join(", ")}`,
    );
  }
}

/*
 * Плитки большой карты для песочницы (`?qa=isolated`).
 *
 * В браузере настольного моста нет, и редактор большой карты открывался на
 * схеме штата: ни перекраску, ни текстуры на настоящей карте было не
 * проверить. Dev-сервер отдаёт песочнице то, что настольное приложение уже
 * прочитало из игры на этой машине, — кэш плиток (`world-map-customizer.js`,
 * `cacheRoot`). Это только dev-сервер (и предпросмотр сборки замера) и только
 * чтение: в сборку ничего не попадает, а без кэша песочница живёт как раньше —
 * на схеме.
 */
function astralQaMapTiles() {
  const cacheRoot = () =>
    join(
      process.env.LOCALAPPDATA || "",
      "Astral",
      "cache",
      "backups",
      "world-map-tiles",
    );
  const latestSet = () => {
    const root = cacheRoot();
    if (!process.env.LOCALAPPDATA || !existsSync(root)) return null;
    const sets = readdirSync(root)
      .map((name) => join(root, name))
      .filter((directory) => existsSync(join(directory, "tiles.json")))
      .sort(
        (left, right) =>
          statSync(join(right, "tiles.json")).mtimeMs -
          statSync(join(left, "tiles.json")).mtimeMs,
      );
    return sets[0] || null;
  };
  const serveTiles = (request, response) => {
    const directory = latestSet();
    const send = (status, type, body) => {
      response.statusCode = status;
      response.setHeader("Content-Type", type);
      response.setHeader("Cache-Control", "no-store");
      response.end(body);
    };
    /* Кэша на этой машине нет — не ошибка: 204, и песочница остаётся на
       схеме. 404 браузер пишет в консоль красным, а это не поломка. */
    if (!directory) return send(204, "application/json", "");
    const name = basename(
      decodeURIComponent((request.url || "/").split("?")[0]),
    );
    if (!name || name === "world-map-tiles") {
      const manifest = JSON.parse(
        readFileSync(join(directory, "tiles.json"), "utf8"),
      );
      return send(
        200,
        "application/json; charset=utf-8",
        JSON.stringify({
          tiles: (manifest.tiles || []).map((tile) => ({
            name: String(tile.texture || ""),
            width: Number(tile.width) || 0,
            height: Number(tile.height) || 0,
            levels: Number(tile.levels) || 1,
            format: String(tile.format || ""),
            png: basename(String(tile.png || "")),
          })),
        }),
      );
    }
    const file = join(directory, name);
    if (!/^[\w.-]+\.png$/i.test(name) || !existsSync(file))
      return send(404, "text/plain", "not found");
    return send(200, "image/png", readFileSync(file));
  };
  /* Векторная карта штата (Т-159): самый свежий файл геометрии, который
     настольное приложение разобрало на этой машине. Нет — 204, и песочница
     рисует растровую подложку, как раньше. */
  /* «Карта из мода» (11.10): геометрия большой карты части, которую
     настольное приложение собрало и сложило в кэш (`part-geometry/<sha256
     minimap.rpf>.apg1.gz`, `catalog-part-geometry.js`). Папка кэша —
     `ASTRAL_QA_PART_GEOMETRY`; нет её или файла — 204, и редактор пишет,
     что карта мода не открылась. */
  const servePartGeometry = (request, response) => {
    const directory = process.env.ASTRAL_QA_PART_GEOMETRY || "";
    const name = basename(
      decodeURIComponent((request.url || "/").split("?")[0]),
    );
    const file =
      directory && /^[a-f0-9]{64}\.apg1\.gz$/i.test(name)
        ? join(directory, name)
        : "";
    response.setHeader("Cache-Control", "no-store");
    if (!file || !existsSync(file)) {
      response.statusCode = 204;
      return response.end("");
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/octet-stream");
    return response.end(readFileSync(file));
  };
  const serveGeometry = (request, response) => {
    const directory = join(cacheRoot(), "..", "world-map-geometry");
    const files = existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => name.endsWith(".bin"))
          .map((name) => join(directory, name))
          .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
      : [];
    response.setHeader("Cache-Control", "no-store");
    if (!process.env.LOCALAPPDATA || !files.length) {
      response.statusCode = 204;
      return response.end("");
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/octet-stream");
    return response.end(readFileSync(files[0]));
  };
  return {
    name: "astral-qa-map-tiles",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/world-map-tiles", serveTiles);
      server.middlewares.use("/__astral/qa/world-map-geometry", serveGeometry);
      server.middlewares.use("/__astral/qa/part-geometry", servePartGeometry);
    },
    /* Сборку замера (`--mode perf`, `npm run perf`) стенд отдаёт через
       `vite preview`, и песочница в ней та же, что на dev-сервере, — с теми
       же плитками. Предпросмотру продуктовой сборки плитки не положены: он
       обязан показывать ровно то, что уедет людям. */
    configurePreviewServer(server) {
      if (server.config.mode !== "perf") return;
      server.middlewares.use("/__astral/qa/world-map-tiles", serveTiles);
      server.middlewares.use("/__astral/qa/world-map-geometry", serveGeometry);
    },
  };
}

/*
 * База сцены попаданий для песочницы (`?qa=isolated`).
 *
 * Та же мысль, что у плиток карты: редактор попаданий в браузере рисовал
 * частицы схемой по запечённым правилам, и «как в игре» было не проверить.
 * Dev-сервер отдаёт базу, которую на этой машине запёк
 * `scripts/bake-impact-base.mjs` тем же кодом, что читает её настольное
 * приложение: выписки правил, ужатые листы игры, окружение и опись ядра.
 * Только dev-сервер и только чтение; без кэша песочница живёт как раньше.
 */
function astralQaImpactBase() {
  const cacheRoot = () =>
    join(
      process.env.LOCALAPPDATA || "",
      "Astral",
      "cache",
      "backups",
      "impact-base",
    );
  /* База, что держит само приложение (`ptfx-base/<игра>.json`), — тоже: она
     свежее запечённой, как только окно эффектов открывали в настольном
     приложении, и несёт новые поля (объёмное превью окружения). */
  const appRoot = () =>
    join(process.env.LOCALAPPDATA || "", "Astral", "cache", "backups", "ptfx-base");
  const latest = () => {
    if (!process.env.LOCALAPPDATA) return null;
    const root = cacheRoot();
    const baked = existsSync(root)
      ? readdirSync(root)
          .map((name) => ({ file: join(root, name, "base.json"), app: false }))
          .filter((item) => existsSync(item.file))
      : [];
    const apps = existsSync(appRoot())
      ? readdirSync(appRoot())
          .filter((name) => name.endsWith(".json"))
          .map((name) => ({ file: join(appRoot(), name), app: true }))
      : [];
    return (
      [...baked, ...apps].sort(
        (left, right) => statSync(right.file).mtimeMs - statSync(left.file).mtimeMs,
      )[0] || null
    );
  };
  const body = (item) => {
    if (!item.app) return readFileSync(item.file);
    const cached = JSON.parse(readFileSync(item.file, "utf8"));
    return JSON.stringify({
      bakedAt: new Date(statSync(item.file).mtimeMs).toISOString(),
      base: cached?.base || null,
    });
  };
  return {
    name: "astral-qa-impact-base",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/__astral/qa/impact-base",
        (_request, response) => {
          const item = latest();
          /* Нет запечённой базы — 204 «нечего отдать», а не 404. */
          response.statusCode = item ? 200 : 204;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(item ? body(item) : "");
        },
      );
    },
  };
}

/*
 * Фонари для песочницы (`?qa=isolated`).
 *
 * Та же мысль, что у неба и попаданий: без ламп игры кадр фонарей светит
 * описью Legacy, а рой не из чего собрать. Dev-сервер отдаёт то, что на этой
 * машине прочитало настольное приложение (`lamp-base` — опись ламп и правила
 * частиц у ламп с листами ядра). Только dev-сервер и только чтение; без кэша
 * песочница живёт как раньше.
 */
function astralQaLampBase() {
  const latest = () => {
    const root = join(
      process.env.LOCALAPPDATA || "",
      "Astral",
      "cache",
      "backups",
      "lamp-base",
    );
    if (!process.env.LOCALAPPDATA || !existsSync(root)) return null;
    const files = readdirSync(root)
      .filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
      .map((name) => join(root, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    return files[0] || null;
  };
  return {
    name: "astral-qa-lamp-base",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/lamp-base", (_request, response) => {
        const file = latest();
        /* Нет запечённой базы — 204 «нечего отдать», а не 404. */
        response.statusCode = file ? 200 : 204;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(file ? readFileSync(file) : "");
      });
    },
  };
}

/*
 * Дым из-под колёс для песочницы (`?qa=isolated`).
 *
 * Та же мысль, что у фонарей: без правил игры у машины в кадре дыма нет
 * вовсе (подпись кадра это говорит). Dev-сервер отдаёт то, что на этой машине прочитало
 * настольное приложение или `scripts/bake-wheel-smoke-base.mjs` тем же кодом
 * (`wheel-smoke-base` — правила-доноры дыма, искр и огня и их листы ядра).
 * Только dev-сервер и только чтение; без кэша песочница живёт как раньше.
 */
function astralQaWheelSmokeBase() {
  const latest = () => {
    const root = join(
      process.env.LOCALAPPDATA || "",
      "Astral",
      "cache",
      "backups",
      "wheel-smoke-base",
    );
    if (!process.env.LOCALAPPDATA || !existsSync(root)) return null;
    const files = readdirSync(root)
      .filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
      .map((name) => join(root, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    return files[0] || null;
  };
  return {
    name: "astral-qa-wheel-smoke-base",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/__astral/qa/wheel-smoke-base",
        (_request, response) => {
          const file = latest();
          /* Нет запечённой базы — 204 «нечего отдать», а не 404. */
          response.statusCode = file ? 200 : 204;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(file ? readFileSync(file) : "");
        },
      );
    },
  };
}

/*
 * База неба для песочницы (`?qa=isolated`).
 *
 * Та же мысль, что у плиток карты и базы попаданий: редактор неба в браузере
 * рисовал эталон Astral, и «один в один с игрой» было не проверить.
 * Dev-сервер отдаёт то, что на этой машине прочитало настольное приложение
 * (или `scripts/bake-sky-base.mjs` тем же кодом): чистую базу погоды,
 * weather.xml и облака из `sky-bases`, луну и звёзды из `sky-textures`.
 * Только dev-сервер и только чтение; без кэша песочница живёт как раньше.
 */
function astralQaSkyBase() {
  const cacheRoot = (name) =>
    join(process.env.LOCALAPPDATA || "", "Astral", "cache", "backups", name);
  const latest = (name, marker) => {
    const root = cacheRoot(name);
    if (!process.env.LOCALAPPDATA || !existsSync(root)) return null;
    const sets = readdirSync(root)
      .map((entry) => join(root, entry))
      .filter((directory) => existsSync(join(directory, marker)))
      .sort(
        (left, right) =>
          statSync(join(right, marker)).mtimeMs -
          statSync(join(left, marker)).mtimeMs,
      );
    return sets[0] || null;
  };
  const send = (response, status, type, body) => {
    response.statusCode = status;
    response.setHeader("Content-Type", type);
    response.setHeader("Cache-Control", "no-store");
    response.end(body);
  };
  const serveBase = (_request, response) => {
    const directory = latest("sky-bases", "base.json");
    if (!directory) return send(response, 204, "application/json", "");
    const meta = JSON.parse(readFileSync(join(directory, "base.json"), "utf8"));
    const read = (key) => {
      const entry = meta.files?.[key];
      if (!entry || !/^[\w.-]+$/.test(entry.file)) return null;
      const file = join(directory, entry.file);
      return existsSync(file)
        ? {
            xml: readFileSync(file, "utf8"),
            inUpdate: entry.inUpdate !== false,
          }
        : null;
    };
    const timecycles = {};
    for (const key of Object.keys(meta.files || {})) {
      if (!key.startsWith("timecycle/")) continue;
      const cycle = read(key);
      const name = /<cycle\s+name="([^"]+)"/.exec(cycle?.xml || "")?.[1];
      if (cycle && name) timecycles[name.toUpperCase()] = cycle;
    }
    return send(
      response,
      200,
      "application/json; charset=utf-8",
      JSON.stringify({
        timecycles,
        weather: read("weather.xml"),
        cloudKeyframes: read("cloudkeyframes.xml"),
        clouds: read("clouds.xml"),
        astral: false,
      }),
    );
  };
  const serveTexture = (request, response) => {
    const directory = latest("sky-textures", "moon.png");
    const name = basename(
      decodeURIComponent((request.url || "/").split("?")[0]),
    );
    if (!/^(moon|starfield)\.png$/.test(name))
      return send(response, 404, "text/plain", "not found");
    if (!directory) return send(response, 204, "image/png", "");
    const file = join(directory, name);
    if (!existsSync(file))
      return send(response, 404, "text/plain", "not found");
    return send(response, 200, "image/png", readFileSync(file));
  };
  /* Облачные шапки: опись и листы из той же выкладки, что читает окно
     (`apps/desktop/src/cloud-hats.js`). */
  const serveCloudHats = (request, response) => {
    const directory = latest("cloud-hats", "hats.json");
    const name = basename(
      decodeURIComponent((request.url || "/").split("?")[0]),
    );
    if (!/^(hats\.json|[\w-]+\.png)$/i.test(name))
      return send(response, 404, "text/plain", "not found");
    if (!directory) return send(response, 204, "application/json", "");
    const file = join(directory, name);
    if (!existsSync(file))
      return send(response, 404, "text/plain", "not found");
    return send(
      response,
      200,
      name.endsWith(".json") ? "application/json; charset=utf-8" : "image/png",
      readFileSync(file),
    );
  };
  const mount = (server) => {
    server.middlewares.use("/__astral/qa/sky-base", serveBase);
    server.middlewares.use("/__astral/qa/sky-textures", serveTexture);
    server.middlewares.use("/__astral/qa/cloud-hats", serveCloudHats);
  };
  return {
    name: "astral-qa-sky-base",
    apply: "serve",
    configureServer: mount,
    configurePreviewServer(server) {
      if (server.config.mode === "perf") mount(server);
    },
  };
}

/*
 * Канал игры этой машины — и сборке замера (14.11.2026, работа «Astral быстрее»). Закрытый стенд
 * (`closed-stand.mjs`, `vite preview --mode perf`) без него открывал «Завод», арены, «Ашан» и места мира без листов
 * и секций игры: вход мерился с голой геометрией, то есть без того, чего люди ждут дольше всего. Обёртка ставит те
 * же обработчики предпросмотру сборки замера; предпросмотру продуктовой сборки они не положены.
 */
const alsoInPerfPreview = (plugin) => ({
  ...plugin,
  configurePreviewServer(server) {
    if (server.config.mode === "perf") return plugin.configureServer(server);
  },
});

/*
 * Листы 3D-кадров мастерской для песочницы (`?qa=isolated`).
 *
 * В приложении «Завод», «Ангар» и «Маппинг» берут листы из файлов наборов и
 * из игры игрока (`apps/desktop/src/workshop-textures.js`). Здесь dev-сервер
 * зовёт тот же модуль на этой машине — игра из ASTRAL_QA_GAME или штатной
 * папки Steam. Только dev-сервер и только чтение; нет игры — листов нет, и
 * кадр рисует средним цветом, как у людей без Astral Desktop.
 *
 * `ASTRAL_QA_WORKSHOP_STATE` — своя папка кэша листов для замера: пустая даёт
 * холодный вход (чтение архивов игры), повторный прогон по ней — тёплый.
 *
 * Лист едет телом ответа как есть, а не base64 в JSON (15.11.2026, `src/qa-sheet-body.js`): окно просит его заголовком
 * `Accept: application/octet-stream`; без заголовка отвечает прежний JSON — старые сборки замера на этом же сервере не ломаются.
 * `ASTRAL_QA_WORKSHOP_LOG=<файл>` — по строке JSON на каждую просьбу окна (время, число и размер листов, кто и в каком размере),
 * чтобы видеть, просит ли окно один лист дважды.
 */
function astralQaWorkshopTextures() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  const state = process.env.ASTRAL_QA_WORKSHOP_STATE || qaCacheDir("qa-workshop");
  const logFile = process.env.ASTRAL_QA_WORKSHOP_LOG || "";
  return {
    name: "astral-qa-workshop-textures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/workshop-textures", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const { readWorkshopTextures } = await import("../desktop/src/workshop-textures.js");
            const keys = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
            const started = performance.now();
            const result = await readWorkshopTextures(
              { ...input, gameRoot: existsSync(game) ? game : "", keys: existsSync(keys) ? keys : undefined },
              state,
            );
            if (logFile) {
              const line = {
                at: Date.now(),
                ms: Math.round(performance.now() - started),
                count: result.textures.length,
                bytes: result.textures.reduce((sum, item) => sum + (item ? item.byteLength : 0), 0),
                textures: (input.textures || []).map((item) => `${item.game || `${item.set}/${item.file}`}|${item.name}|${item.size}`),
              };
              appendFileSync(logFile, JSON.stringify(line) + "\n");
            }
            response.statusCode = 200;
            response.setHeader("Cache-Control", "no-store");
            if (String(request.headers.accept || "").includes(SHEET_BODY_TYPE)) {
              response.setHeader("Content-Type", SHEET_BODY_TYPE);
              response.end(packSheets(result));
              return;
            }
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(
              JSON.stringify({
                textures: result.textures.map((item) => (item ? Buffer.from(item).toString("base64") : null)),
                status: result.status,
              }),
            );
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error?.message || error));
          }
        });
      });
    },
  };
}

/*
 * Дрифт-машина кадра «Дыма из-под колёс» для песочницы: тем же модулем
 * настольного приложения (`apps/desktop/src/wheel-smoke-car.js`) из игры этой
 * машины — ASTRAL_QA_GAME или штатная папка Steam, ключи ArchiveFix из
 * ASTRAL_QA_KEYS или папки Astral. GLB — телом, опись — заголовком
 * `X-Astral-Car`. Только dev-сервер и только чтение; нет игры — 204, кадр
 * на запасном кузове.
 */
function astralQaWheelSmokeCar() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  return {
    name: "astral-qa-wheel-smoke-car",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/wheel-smoke-car", async (_request, response) => {
        try {
          const { readWheelSmokeCar } = await import("../desktop/src/wheel-smoke-car.js");
          const keys =
            process.env.ASTRAL_QA_KEYS ||
            join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
          const result = await readWheelSmokeCar(
            { gameRoot: existsSync(game) ? game : "", keys: existsSync(keys) ? keys : undefined },
            qaCacheDir("qa-workshop"),
          );
          response.setHeader("Cache-Control", "no-store");
          if (result.status !== "ready") {
            response.statusCode = 204;
            response.end("");
            return;
          }
          response.statusCode = 200;
          response.setHeader("Content-Type", "model/gltf-binary");
          response.setHeader("X-Astral-Car", encodeURIComponent(JSON.stringify(result.car)));
          response.end(Buffer.from(result.glb));
        } catch (error) {
          response.statusCode = 500;
          response.end(String(error?.message || error));
        }
      });
    },
  };
}

/*
 * Небо, которое уже стоит в игре (ТЗ 17.10.2026, вечер, задача 3), для
 * песочницы: список найденного и небо выбранного — тем же модулем
 * настольного приложения (`apps/desktop/src/sky-sources.js`) из игры этой
 * машины. Только dev-сервер и только чтение; нет игры — список пуст.
 */
function astralQaSkySources() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  const keys = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
  const answer = (response, status, body) => {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(body));
  };
  return {
    name: "astral-qa-sky-sources",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/sky-sources", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            if (!existsSync(game)) return answer(response, 200, { sources: [] });
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const { listSkySources, takeSkySource } = await import("../desktop/src/sky-sources.js");
            const keysDirectory = existsSync(keys) ? keys : undefined;
            if (input.id) {
              const taken = await takeSkySource({ gameRoot: game, keys: keysDirectory, id: String(input.id) });
              return answer(response, 200, taken);
            }
            return answer(response, 200, { sources: await listSkySources({ gameRoot: game, keys: keysDirectory }) });
          } catch (error) {
            return answer(response, 500, { error: String(error?.message || error) });
          }
        });
      });
    },
  };
}

/*
 * Секции карты целиком (Мега Молл, квартал «Венис-Бич» с морем, эстакада) для песочницы (ТЗ 27.10.2026, превью воды и
 * таймциклов): настоящий квартал из игры этой машины — тем же поставщиком настольного приложения
 * (`apps/desktop/src/mega-mall-section-model.js`, нативный движок, ключи ArchiveFix). Без него песочница отвечает «Только в Astral
 * Desktop», и плитка «Вода» выходит с рисованным морем. Манифест и бандлы GLB кладутся в кэш `qa-mega-mall`; байты бандла едут
 * в окно base64. Только dev-сервер и только чтение.
 */
function astralQaMegaMallSections() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  const keys = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
  let host = null;
  const answer = (response, status, body) => {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(body));
  };
  const hostOnce = async () => {
    if (host) return host;
    const { createMegaMallSectionHost } = await import("../desktop/src/mega-mall-section-host.js");
    host = createMegaMallSectionHost({
      gameRoot: game,
      keys: existsSync(keys) ? keys : undefined,
      cacheRoot: qaCacheDir("qa-mega-mall"),
      context: { packaged: false, resourcesPath: undefined, projectRoot: runtimeRoot, onProgress() {} },
    });
    return host;
  };
  return {
    name: "astral-qa-mega-mall-sections",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/mega-mall", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            if (!existsSync(game)) return answer(response, 200, { status: "unavailable", reason: "Игра не найдена на этой машине." });
            const operation = String(request.url || "").replace(/^\/+/, "").split("?")[0];
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const sections = await hostOnce();
            if (operation === "section") return answer(response, 200, await sections.section(input));
            if (operation === "bundle") return answer(response, 200, await sections.bundle(input));
            if (operation === "capabilities") return answer(response, 200, { sectionModel: true, sections: sections.sections() });
            return answer(response, 404, { error: "нет такой операции" });
          } catch (error) {
            return answer(response, 500, { error: String(error?.message || error) });
          }
        });
      });
    },
  };
}

/*
 * «Интерьеры» (задача 5 ТЗ 11.10.2026): сцена помещения для песочницы — тем
 * же сборщиком настольного приложения из игры этой машины. Модули сборщика,
 * плана и описи берутся заново, когда меняются на диске (прогон
 * `prepare-shops.mjs` не требует перезапуска сервера). Только dev-сервер и
 * только чтение.
 */
function astralQaShopScene() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  const fresh = (relative) => {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    return import(`${new URL(relative, import.meta.url).href}?t=${Math.round(statSync(file).mtimeMs)}`);
  };
  return {
    name: "astral-qa-shop-scene",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/shop-scene", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const { readShopScene } = await fresh("../desktop/src/recolor-shops-scene.js");
            const plan = (await fresh("../../packages/climb-contract/recolor/inventory/shops-scenes.js")).default;
            const inventory = (await fresh("../../packages/climb-contract/recolor/inventory/shops.js")).default;
            const keys = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
            const result = await readShopScene(
              { interior: input.interior, models: input.models, gameRoot: existsSync(game) ? game : "", keys: existsSync(keys) ? keys : undefined },
              qaCacheDir("qa-workshop"),
              { plan, interiorOf: (id) => inventory.interiors.find((item) => item.id === id) || null },
            );
            if (!result.scene) {
              response.statusCode = 404;
              response.end(result.reason || "");
              return;
            }
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Cache-Control", "no-store");
            response.end(Buffer.from(result.scene));
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error?.message || error));
          }
        });
      });
    },
  };
}

/*
 * «Зоны»: место мира по координатам для песочницы (ТЗ 01.11.2026) — тем же сборщиком настольного приложения из игры этой машины. Только dev-сервер и
 * только чтение; кэш сцен — в кэше песочницы.
 */
function astralQaWorldPlace() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  return {
    name: "astral-qa-world-place",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/world-place", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const { readWorldPlaceScene } = await import("../desktop/src/world-place-scene.js");
            const keys = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
            const result = await readWorldPlaceScene({ ...input, gameRoot: existsSync(game) ? game : "", keys: existsSync(keys) ? keys : undefined }, qaCacheDir("qa-workshop"));
            if (!result.scene) {
              response.statusCode = 404;
              response.end(result.reason || "");
              return;
            }
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Cache-Control", "no-store");
            response.end(Buffer.from(result.scene));
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error?.message || error));
          }
        });
      });
    },
  };
}

/*
 * «Интерьеры проектов» для песочницы (ТЗ 17.10.2026, вечер, задача 10): те же
 * модули настольного приложения (`apps/desktop/src/project-interiors/`),
 * что и у главного процесса, на файлах этой машины. Только dev-сервер и
 * только чтение. Диалога выбора папки у песочницы нет: «Добавить папку»
 * берёт путь из `<кэш песочницы>/project-interiors-folders.json`
 * (`{ "majestic": "…", "gta5rp": "…" }`) — файл лежит вне репозитория.
 */
/*
 * Паки «Интерьеров Majestic RP» для песочницы (Хелпер 7, 25.10.2026): `ASTRAL_QA_MAJESTIC_PACKS` — папка со сборкой паков владельца
 * (`%TEMP%/astral-projint-bundle/majestic/packages`: `projint-mj-<имя>/<версия>`, по пакету на запись реестра интерьеров). Каждый пакет
 * записи реестра встаёт отдельным источником проекта Majestic — как пакет, скачанный игроком с CDN. Источников больше предела обычного
 * диалога «Добавить папку» (8), поэтому запись в `sources.json` — прямая, один раз на папку: повторный запрос состояния ничего не пишет.
 */
async function qaAddMajesticPacks(root, stateDir) {
  const { MAJESTIC_INTERIORS } = await import(new URL("../../packages/climb-contract/recolor/majestic-interiors.js", import.meta.url).href);
  const file = join(stateDir, "project-interiors", "sources.json");
  let sources = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version === 1 && Array.isArray(parsed.sources)) sources = parsed.sources;
  } catch {
    sources = [];
  }
  const known = new Set(sources.map((item) => item.id));
  let added = 0;
  for (const slug of new Set(MAJESTIC_INTERIORS.flatMap((entry) => entry.packs.map((pack) => pack.slug)))) {
    const versions = existsSync(join(root, slug)) ? readdirSync(join(root, slug)).sort() : [];
    if (!versions.length) continue;
    const folder = join(root, slug, versions[versions.length - 1]);
    const id = createHash("sha1").update(`majestic|${folder.toLowerCase()}`).digest("hex").slice(0, 10);
    if (known.has(id)) continue;
    sources.push({ id, project: "majestic", kind: "folder", path: folder, label: slug, added: new Date().toISOString() });
    added += 1;
  }
  if (!added) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, sources }, null, 2));
}

function astralQaProjectInteriors() {
  let casinoSource = null;
  let packsSource = null;
  let dumpSource = null;
  const fresh = (relative) => {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    return import(`${new URL(relative, import.meta.url).href}?t=${Math.round(statSync(file).mtimeMs)}`);
  };
  const mount = (server) => {
    /* Файлы паков из готового бандла — как CDN, с Range (`qa-project-pack-cdn.js`). */
    server.middlewares.use("/__astral/qa/project-interiors-files", (request, response) => qaFilesHandler(request, response));
    server.middlewares.use("/__astral/qa/project-interiors", (request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", async () => {
        try {
          const operation = String(request.url || "").replace(/^\/+/, "").split("?")[0];
          const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          const stateDir = qaCacheDir("qa-project-interiors");
          mkdirSync(stateDir, { recursive: true });
          const { discoverGames } = await import("../../packages/game-discovery/index.js");
          const game = (await discoverGames()).find((item) => String(item.edition || "").toLowerCase() === "legacy")?.path || "";
          const keysDirectory = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
          const withGame = { ...input, gameRoot: game, keys: existsSync(keysDirectory) ? keysDirectory : undefined };
          const actions = await fresh("../desktop/src/project-interiors/actions.js");
          let result;
          /*
           * «Интерьеры Majestic RP» (Хелпер 7, 25.10.2026): у редактора казино нет вкладки «Источники», а песочнице нужен
           * кадр — папка казино ставится источником проекта Majestic сама. Папка — `ASTRAL_QA_MAJESTIC_CASINO` (например,
           * `…\Interiors Majestic\Интерьеры\Казино\файлы`) или поле `majestic` в `project-interiors-folders.json`.
           */
          if (operation === "state" && input.project === "majestic") {
            let casinoFolder = process.env.ASTRAL_QA_MAJESTIC_CASINO || "";
            if (!casinoFolder) {
              try {
                casinoFolder = JSON.parse(readFileSync(join(stateDir, "project-interiors-folders.json"), "utf8")).majestic || "";
              } catch {
                casinoFolder = "";
              }
            }
            /* Окно спрашивает состояние несколько раз подряд: запись источника — одна на папку (параллельные записи `sources.json` на Windows падают EPERM). */
            if (casinoFolder) {
              casinoSource = casinoSource?.folder === casinoFolder ? casinoSource : { folder: casinoFolder, done: actions.addProjectSource({ project: "majestic", pick: true }, stateDir, { gameRoot: game, chooseFolder: async () => casinoFolder }) };
              await casinoSource.done;
            }
            /*
             * Выгрузка владельца (`?qa-majestic=dump`, ТЗ 29.10.2026-e): `ASTRAL_QA_MAJESTIC_DUMP` — папка с паками, вынутыми из `Majestic_Dump.rar`
             * (`<имя пака>/dlc.rpf`; вынимает `tar.exe`, `scripts/probe-majestic-dump.mjs` показывает, что в ней читается). Вся папка — один источник
             * проекта Majestic: соседние паки — общие библиотеки пропсов, как в приложении у владельца, выбравшего эту папку. Без флага страницы и без
             * переменной песочница ведёт себя как прежде. Только чтение, файлы выгрузки в git и на CDN не попадают.
             */
            const dumpRoot = input.qaDump ? process.env.ASTRAL_QA_MAJESTIC_DUMP || "" : "";
            if (dumpRoot && existsSync(dumpRoot)) {
              dumpSource = dumpSource?.root === dumpRoot ? dumpSource : { root: dumpRoot, done: actions.addProjectSource({ project: "majestic", pick: true }, stateDir, { gameRoot: game, chooseFolder: async () => dumpRoot }) };
              await dumpSource.done;
            }
            /* Паки остальных интерьеров: `ASTRAL_QA_MAJESTIC_PACKS`, один раз на папку. */
            const packsRoot = process.env.ASTRAL_QA_MAJESTIC_PACKS || "";
            if (packsRoot) {
              packsSource = packsSource?.root === packsRoot ? packsSource : { root: packsRoot, done: qaAddMajesticPacks(packsRoot, stateDir) };
              await packsSource.done;
            }
          }
          if (operation === "state") result = await actions.readProjectState(input, stateDir, { discover: async () => [] });
          else if (operation === "add") {
            const folders = JSON.parse(readFileSync(join(stateDir, "project-interiors-folders.json"), "utf8"));
            result = await actions.addProjectSource(input, stateDir, { gameRoot: game, chooseFolder: async (project) => folders[project] || null });
          } else if (operation === "remove") result = await actions.removeProjectSource(input, stateDir);
          else if (operation === "catalog") result = await (await fresh("../desktop/src/project-interiors/catalog.js")).readCatalog(withGame, stateDir);
          else if (operation === "scene") {
            const answer = await (await fresh("../desktop/src/project-interiors/scene.js")).readProjectScene(withGame, stateDir);
            result = { ...answer, scene: answer.scene ? Buffer.from(answer.scene).toString("base64") : null };
          } else if (operation === "sheets") {
            const answer = await (await fresh("../desktop/src/project-interiors/sheets.js")).readProjectSheets(withGame, stateDir);
            result = { status: answer.status, textures: answer.textures.map((item) => (item ? Buffer.from(item).toString("base64") : null)) };
          } else if (operation === "packs") result = qaPacks();
          else if (operation === "cdn-grant") {
            const { canonicalManifest } = await import("../../packages/install-engine/index.js");
            result = await qaPackGrant(input.id, `http://${request.headers.host}`, canonicalManifest);
          } else if (operation.startsWith("cdn-")) {
            const cdn = await fresh("../desktop/src/project-interiors/cdn.js");
            if (operation === "cdn-state") result = await cdn.readCdnState(input, stateDir);
            else if (operation === "cdn-fetch") result = await cdn.fetchPack(input, stateDir, { publicKey: qaPackPublicKey, allowInsecureLocalhost: true, allowedHosts: null });
            else if (operation === "cdn-cancel") result = cdn.cancelFetch(input);
            else if (operation === "cdn-remove") result = await cdn.removeFetched(input, stateDir);
            else {
              response.statusCode = 404;
              response.end("нет такой операции");
              return;
            }
          } else {
            response.statusCode = 404;
            response.end("нет такой операции");
            return;
          }
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(result ?? null));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: String(error?.message || error) }));
        }
      });
    });
  };
  return {
    name: "astral-qa-project-interiors",
    apply: "serve",
    configureServer: mount,
    /* Сборка замера (`vite build --mode perf`, закрытая сборка): тот же канал, чтобы мерить настоящие интерьеры, а не пустышки. */
    configurePreviewServer(server) {
      if (server.config.mode === "perf") mount(server);
    },
  };
}

/*
 * Исходники предпросмотра «Шрифтов» для песочницы: шаблоны из папки шрифтов
 * Windows этой машины и штатная библиотека шрифтов игры — тем же модулем
 * настольного приложения. Только dev-сервер и только чтение.
 */
function astralQaFontSources() {
  const game =
    process.env.ASTRAL_QA_GAME ||
    "C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V";
  return {
    name: "astral-qa-font-sources",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/font-sources", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", async () => {
          try {
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const { readFontSources } = await import("../desktop/src/recolor-fonts.js");
            const { keysFromDirectory, openRpfFile } = await import("@modovik/rpf7/node");
            const keysDirectory = join(process.env.LOCALAPPDATA || "", "Astral", "tools", "ArchiveFix");
            /* Живой архив этой машины: основы движка у песочницы нет. */
            const openGame = async ({ gameRoot }) => {
              const keys = await keysFromDirectory(existsSync(keysDirectory) ? keysDirectory : "");
              const update = await openRpfFile(join(gameRoot, "update", "update.rpf"), { keys });
              const index = new Map(update.entries.map((entry) => [entry.path.toLowerCase(), entry]));
              return {
                source: "live",
                read: async (entry) => {
                  const found = index.get(String(entry).toLowerCase());
                  return found ? Buffer.from(await update.read(found.path)) : null;
                },
                close: async () => update.close?.(),
              };
            };
            const answer = await readFontSources(
              { ...input, gameRoot: existsSync(game) ? game : "" },
              { stateDir: qaCacheDir("qa-workshop"), openGame },
            );
            const base64 = (bytes) => Buffer.from(bytes).toString("base64");
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            response.end(
              JSON.stringify({
                ...(answer.templates ? { templates: answer.templates } : {}),
                ...(answer.template
                  ? {
                      template: answer.template.bytes
                        ? { id: answer.template.id, bytes: base64(answer.template.bytes) }
                        : answer.template,
                    }
                  : {}),
                ...("game" in answer
                  ? { game: answer.game ? { source: answer.game.source, bytes: base64(answer.game.bytes) } : null }
                  : {}),
              }),
            );
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error?.message || error));
          }
        });
      });
    },
  };
}

/*
 * Снимок холста песочницы в файл — для проверки кадра, когда панель
 * браузера не рисует скриншоты (окно спрятано). Только dev-сервер: PNG из
 * `data:` ложится в %TEMP%/astral-qa-shots/<имя>.png.
 */
function astralQaSnapshots() {
  return {
    name: "astral-qa-snapshots",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__astral/qa/snapshot", (request, response) => {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          try {
            const { name, data } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const safe = String(name || "shot").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "shot";
            const base64 = String(data || "").replace(/^data:image\/\w+;base64,/, "");
            const directory = join(process.env.TEMP || process.env.TMP || ".", "astral-qa-shots");
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, `${safe}.png`), Buffer.from(base64, "base64"));
            response.statusCode = 200;
            response.end("ok");
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error?.message || error));
          }
        });
      });
    },
  };
}

/*
 * Песочница — только в dev, тестах и сборке замера (ТЗ 06.10.2026, вечер):
 * в продуктовой сборке вместо `qa-desktop-bridge.js` — пустышка
 * `qa-desktop-bridge.prod.js`. Песочница со всеми заглушками (пакет студии
 * звуков, графика оптимизатора) сидела в стартовом куске окна.
 */
function astralQaBridgeStub(mode) {
  const stub = fileURLToPath(new URL("src/qa-desktop-bridge.prod.js", import.meta.url));
  return {
    name: "astral-qa-bridge-stub",
    apply: "build",
    enforce: "pre",
    resolveId(source) {
      if (mode === "perf") return null;
      return /(?:^|\/)qa-desktop-bridge\.js$/.test(source) ? stub : null;
    },
  };
}

function astralRuntimeIdentity() {
  return {
    name: "astral-runtime-identity",
    configureServer(server) {
      server.middlewares.use("/__astral/runtime", (_request, response) => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({ runtimeRoot }));
      });
    },
  };
}

/*
 * Сборка замера производительности — `vite build --mode perf`.
 *
 * Это продуктовая сборка (NODE_ENV=production, React без двойной отрисовки
 * StrictMode), в которую дополнительно едут песочница (`?qa=isolated`) и проба
 * `window.__astralPerf`: оба включаются условием `MODE === "perf"`. Мерить
 * dev-сервер — значит мерить то, чего у людей не бывает.
 *
 * Отличий от продуктовой два, и оба — ради отчёта, а не ради скорости. Сборка
 * ложится в `.perf/build`, а не в `dist`: иначе гейт размера бандла
 * (`verify-web-architecture.js`) мерил бы её вместо продуктовой. И она не
 * минифицируется: имена функций остаются, и профиль отвечает «EffectsStudio →
 * drawTracer», а не «a → t». Выполнение от этого не медленнее: минификатор
 * укорачивает имена и текст, а работу за кадр оставляет той же.
 */
const perfOutDir = fileURLToPath(new URL("../../.perf/build", import.meta.url));

export default defineConfig(({ mode, command }) => {
  assertCompleteLocalClothingAssets(loadEnv(mode, webRoot, "VITE_"));
  const perfBuild = mode === "perf";

  return {
    /* Номер сборки интерфейса для ключа готовых обложек (`covers/cover-loaders.js`). Закрытие JS
       прячет из текста загрузчика имена кусков, по которым ключ строится в открытой сборке; номер
       приходит константой и переживает закрытие. В dev-сервере его нет: правка обложки видна сразу. */
    define: command === "build" ? { __ASTRAL_WEB_BUILD__: JSON.stringify(process.env.ASTRAL_WEB_BUILD_ID || Date.now().toString(36)) } : {},
    plugins: [
      astralQaBridgeStub(mode),
      react(),
      astralRuntimeIdentity(),
      astralQaMapTiles(),
      astralQaImpactBase(),
      /* `ASTRAL_QA_FX=real`: настоящий набор сцен — прокси `/api` (`ASTRAL_API_PROXY`) к локальному API, а он берёт кадры с CDN;
         без этого песочница отвечает рисованными сценами (`qa-fx-scenes.js`). Так снимают обложки (`scripts/stock-covers-live/`). */
      ...(process.env.ASTRAL_QA_FX === "real" ? [] : [astralQaFxScenes()]),
      astralQaSkyClip(),
      astralQaBigMapCovers(),
      astralQaSkyBase(),
      astralQaLampBase(),
      astralQaWheelSmokeBase(),
      astralQaWheelSmokeCar(),
      alsoInPerfPreview(astralQaWorkshopTextures()),
      alsoInPerfPreview(astralQaArenaModHall()),
      astralQaSkySources(),
      alsoInPerfPreview(astralQaMegaMallSections()),
      alsoInPerfPreview(astralQaShopScene()),
      alsoInPerfPreview(astralQaWorldPlace()),
      astralQaProjectInteriors(),
      astralQaFontSources(),
      astralQaSnapshots(),
      astralQaGunpacks(),
      astralQaStandingBody(),
      /* Тату игры и в предпросмотре сборки замера (15.11.2026): без этого окно «Тело · татуировки» на закрытой сборке получает пустой список (стенд мастерской одежды, `wear-window.mjs`). */
      alsoInPerfPreview(astralQaGameTattoos()),
      astralQaAnimations(),
      astralQaAnimals(),
      astralQaWearCharacter(),
      astralQaGameWeapons(),
      astralOcrAssets(),
      astralUiText(),
      astralCoverStamps(),
    ],
    resolve: {
      /* Общий пакет живёт вне node_modules: без этого Vite разрешает для него
         второй экземпляр React, и хуки внутри общих компонентов падают. */
      dedupe: ["react", "react-dom", "@phosphor-icons/react"],
      alias: {
        "@astral/glyphs": glyphSource,
        "@astral/design": designSource,
        /* Время каждого компонента (`selfBaseDuration`) пишет только профилирующая сборка React. Она
           медленнее обычной, поэтому только по просьбе и только в сборке замера — для разбора «кто
           дорогой», не для цифр (21.10, `docs/perf/ui-bench-plan.md`, пункт з). */
        ...(perfBuild && process.env.ASTRAL_PERF_REACT_PROFILING === "1"
          ? { "react-dom/client": "react-dom/profiling" }
          : {}),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      fs: { allow: [repositoryRoot] },
      proxy: {
        "/api/v1": "http://127.0.0.1:8080",
        /* Каталог v2 живёт на том же крае, что и v1 (Go edge или стенд
           `scripts/perf/catalog-v2-stand.js`): песочница с `?catalog=v2`
           спрашивает его отсюда. */
        "/api/v2": "http://127.0.0.1:8080",
        /* Несколько сессий разработки держат свои API на разных портах:
           ASTRAL_API_PROXY направляет окно к своему, а не к чужому 4174. */
        "/api": process.env.ASTRAL_API_PROXY || "http://127.0.0.1:4174",
      },
    },
    build: {
      outDir: perfBuild ? perfOutDir : "dist",
      /* Папка замера лежит вне корня веба, и без явного разрешения Vite не
         чистит её перед сборкой — в ней копились бы старые куски. */
      ...(perfBuild ? { emptyOutDir: true, minify: false } : {}),
      rollupOptions: {
        /*
         * Вторая страница — стенд окна превью (preview-lab.html).
         *
         * Он существует потому, что приложение целиком в браузере не
         * поднимается: api.js требует настольный мост и обрывает запуск словами
         * «Облачная сессия доступна только в Astral Desktop», так что сцену не
         * посмотреть глазами через обычный dev-сервер. Стенд монтирует одну лишь
         * сцену — ни каталога, ни авторизации, ни облака.
         *
         * В продуктовую сборку он не едет. Дальше dist лежит пакет настольного
         * приложения, и страница с отладочными ползунками, которую никто не
         * открывает намеренно, — это лишний вес и лишняя поверхность. Флаг
         * ASTRAL_PREVIEW_LAB=1 включает её обратно, когда стенд нужен именно на
         * собранном билде.
         *
         * Dev-сервер флага не спрашивает: по адресу /preview-lab.html страница
         * обязана открываться всегда — это рабочий инструмент, а не артефакт
         * сборки. Здесь описан только вход для rollup, то есть build.
         */
        input: {
          main: fileURLToPath(new URL("index.html", import.meta.url)),
          ...(process.env.ASTRAL_PREVIEW_LAB === "1"
            ? {
                "preview-lab": fileURLToPath(
                  new URL("preview-lab.html", import.meta.url),
                ),
              }
            : {}),
        },
        output: {
          manualChunks(id) {
            /* Словарь интерфейса по языкам (бюджет бандла 18.10.2026): каждый кусок языка — свой файл, окно грузит только свой язык. */
            const uiText = uiTextChunk(id);
            if (uiText) return uiText;
            const normal = id.split("\\").join("/");
            /* Пакет векторной карты (~230 КБ gzip одним куском перешагивал потолок гейта): листья без зависимостей внутри пакета — отдельным куском, база остаётся ниже потолка. */
            if (/\/packages\/vector-map\/(dds|stroke-curve|glyphs|mapzoom|districts|upscale|label-fit|label-tones|radar-geometry)\.js$/.test(normal)) return "vector-map-leaf";
            /* Свой набор значков Astral и его имена Phosphor
               (`packages/astral-glyphs`, `components/ui/icons.jsx`, 17–18.10)
               — в чанке иконок: иначе знаки ложились в главный чанк и
               выводили его за потолок. */
            if (
              id.includes("astral-glyphs") ||
              /components\/ui\/icons\.jsx$/.test(id.replaceAll("\\", "/"))
            )
              return "icons";
            /* Опись «Интерьеров» (40 помещений, сотни килобайт) — своим куском: вместе с кодом редактора она перешагивала потолок гейта (ТЗ 17.10.2026). */
            if (id.split("\\").join("/").endsWith("/recolor/inventory/shops.js")) return "shops-inventory";
            /* Горячие пиксельные циклы оптимизатора (ЧБ кадра, маска краёв) — своим куском: закрытие
               интерфейса закрывает его уровнем light (`LIGHT_WEB_CHUNKS`, `scripts/protect/obfuscate-app.mjs`),
               а остальной код оптимизатора остаётся на standard. */
            if (/\/packages\/optimizer\/texture-stages\.js$|\/workshop\/optimizer\/edge-alpha\.js$/.test(id.split("\\").join("/"))) return "texture-pixels";
            /* Генератор текстуры трассера (пиксельный цикл на каждый шаг ползунка цвета и свечения) — тем же
               путём: на standard мёртвый код и массив строк делали шаг в 4 раза дороже, ползунок отставал от
               руки (владелец, 19.10.2026). Модуль листовой, без импортов: кусок не замыкается сам на себя. */
            if (normal.endsWith("/packages/ptfx-studio/shapes.js")) return "tracer-texture";
            /* Имена частей публикации (лист без импортов) — своим куском (22.11.2026, альфа beta.109): главный кусок сборной стоял
               на самой границе бюджета (225 100–225 289 Б gzip при пределе 225 280) — в нём растёт карта зависимостей ленивых кусков,
               каждый новый редактор добавляет имена файлов. Кусок грузится вместе с главным, поведение не меняется; выносить так
               можно только модуль без импортов, иначе куски зациклятся (docs/UI-TEXT-BUNDLE.md). */
            if (normal.endsWith("/packages/publishing/part-names.js")) return "part-names";
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("/three/") || id.includes("\\three\\")) {
              return "three-viewer";
            }
            /* Иконки — не React: `@phosphor-icons/react` раньше попадал в
               чанк фреймворка по слову «react» в пути, и каждая новая иконка
               любой фичи раздувала его до потолка гейта. */
            if (id.includes("lucide-react") || id.includes("@phosphor-icons"))
              return "icons";
            if (id.includes("react-router")) return "router";
            if (id.includes("react")) return "react";
            return "vendor";
          },
        },
      },
    },
    test: {
      /* Общий пакет разрешается как внешняя зависимость, и Vitest грузит для
         него второй React. Инлайним — тогда он проходит тем же конвейером,
         что и код продукта. */
      server: { deps: { inline: [/@astral\/design/, /@astral\/glyphs/] } },
      /* Значки окна идут из `@astral/glyphs/phosphor.jsx`, а тот делает
         `export * from "@phosphor-icons/react"`: в сборке лишнее выбрасывается, а
         Vitest грузит библиотеку целиком — тысячи мелких модулей, ~12 с холодного
         входа в каждом файле со значком, и в полном прогоне это таймауты в разных
         файлах при каждом запуске (22.10). Оптимизатор предсобирает её одним
         модулем (кэш `node_modules/.vite/vitest`, в git не попадает). Только
         тесты: продуктовая сборка не меняется. */
      deps: { optimizer: { web: { enabled: true, include: ["@phosphor-icons/react"] } } },
      environment: "jsdom",
      setupFiles: "./src/test/setup.js",
      css: false,
      /*
       * Потолок времени на тест — пятнадцать секунд вместо пяти.
       *
       * Половина набора строит настоящие сцены: поле травы со всеми покровами,
       * сутки таймцикла, кадр килл-эффекта. По одному такой тест идёт около
       * секунды, а восемью файлами разом упирается в процессор и перешагивает
       * пять секунд — набор краснел на разных файлах при каждом прогоне, ни
       * разу не поймав ничего настоящего.
       *
       * Пятнадцать — это всё ещё в семьдесят раз больше обычного теста:
       * зависание такой потолок ловит, а очередь на процессоре — нет. Набор,
       * который краснеет случайно, приучает не смотреть на красное, и это
       * дороже любого таймаута.
       */
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  };
});
