/*
 * Геометрия радара для большой карты на команде движка `read-radar-geometry` (`ASTRAL_RUST_READERS=radar-geometry`).
 *
 * Работает в потоке чтения игры вместо `readWorldMapGeometry` из `world-map-geometry.js` и отвечает тем же: `{ atlas, tiles, triangles, zoneNames, geometry, cached }`. Кэш на диске —
 * тот же файл и тот же отпечаток состояния игры, что у прежнего читателя: что собрал один, читает другой. Движок даёт геометрию (в файл вывода: двоичное в ответ не кладётся),
 * атлас и счёт плиток; имена районов он не знает — их берёт этот переходник: запись `global.gxt2` читает тот же движок (`read-archive-file`), разбирает тот же JS-разбор GXT2.
 * Возврат на прежнего читателя — как у `ptfx-base.js`: одна строка в журнал приложения (без путей и текстов отказа), чтение за прежним.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { workerData } from "node:worker_threads";
import * as gxt from "@modovik/clothing/gxt2";
import * as vectorMap from "@modovik/vector-map";
import { appLog } from "../app-log.js";
import { errorClass } from "../game-read-trace.js";
import { engineExecutable, runEngine } from "./engine-run.js";

/* Всё ниже до `joinOrBuild` повторяет кэш прежнего читателя (`world-map-geometry.js`) слово в слово: файл должен читаться обоими. Проверка — тест «кэш тот же». */
const ARCHIVES = "x64e.rpf x64a.rpf x64b.rpf".split(" ");
const ZONE_NAMES_ENTRY = "x64b:/data/lang/russian_rel.rpf/global.gxt2";
const CACHE_FOLDER = "world-map-geometry";
const HEADER_TAG = "h2";
const KEEP_FRESH = 2;
const ZONE_NAME_MAX = 80;
const COMMAND = "read-radar-geometry";

/* Прежний читатель: грузится, только когда нужен. */
const oldReader = (...call) => import("../world-map-geometry.js").then((module) => module.readWorldMapGeometry(...call));

const buildsInFlight = new Map();

async function settleTo(task, fallback) {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

function rootOf(input) {
  const given = String(input?.gameRoot || "");
  return path.isAbsolute(given) ? path.resolve(given) : null;
}

async function archiveStamp(root, name) {
  return settleTo(async () => {
    const info = await fs.stat(path.join(root, name));
    return `${name}:${info.size}:${Math.floor(info.mtimeMs)}`;
  }, null);
}

async function fingerprintOf(root) {
  const [main, ...others] = ARCHIVES;
  const mainStamp = await archiveStamp(root, main);
  if (mainStamp === null) return null;
  const rest = [];
  for (const name of others) rest.push((await archiveStamp(root, name)) ?? `${name}:-`);
  return [`v${vectorMap.RADAR_GEOMETRY_VERSION}`, HEADER_TAG, mainStamp, ...rest].join("|");
}

const keyOf = (stamp) => crypto.createHash("sha256").update(stamp).digest("hex").slice(0, 16);

function cacheSlot(stateDir, key) {
  const dir = path.join(stateDir, CACHE_FOLDER);
  return { dir, file: path.join(dir, `${key}.bin`) };
}

/* Файл кэша: [uint32 длина заголовка][JSON-заголовок][двоичная геометрия]. */
function encodeCacheFile({ atlas, tiles, triangles, zoneNames, geometry }) {
  const head = Buffer.from(JSON.stringify({ atlas, tiles, triangles, zoneNames }), "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32LE(head.length, 0);
  return Buffer.concat([size, head, Buffer.from(geometry)]);
}

async function loadSlot(slot) {
  return settleTo(async () => {
    const bytes = await fs.readFile(slot.file);
    const headEnd = 4 + bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.subarray(4, headEnd).toString("utf8"));
    const geometry = new Uint8Array(bytes.subarray(headEnd));
    return vectorMap.decodeRadarGeometry(geometry) ? { ...header, geometry, cached: true } : null;
  }, null);
}

async function saveSlot(slot, answer) {
  await fs.mkdir(slot.dir, { recursive: true });
  const temp = `${slot.file}.${process.pid}.tmp`;
  await fs.writeFile(temp, encodeCacheFile(answer));
  await fs.rename(temp, slot.file);
}

/* Оставляет самые свежие копии и только что записанную; ошибки не важны. */
function tidySlot(slot) {
  return settleTo(async () => {
    const names = (await fs.readdir(slot.dir)).filter((name) => name.endsWith(".bin"));
    const probes = await Promise.allSettled(names.map(async (name) => ({ name, time: (await fs.stat(path.join(slot.dir, name))).mtimeMs })));
    const dated = probes.filter((probe) => probe.status === "fulfilled").map((probe) => probe.value);
    dated.sort((a, b) => b.time - a.time);
    const keep = new Set(dated.slice(0, KEEP_FRESH).map((item) => item.name));
    keep.add(path.basename(slot.file));
    await Promise.allSettled(dated.filter((item) => !keep.has(item.name)).map((item) => fs.rm(path.join(slot.dir, item.name), { force: true })));
  });
}

/* ------------------------------------------------------------------ сборка на движке */

/** Имена районов из `global.gxt2`: те же ярлыки и обрезка, что у прежнего читателя. */
function zoneNamesFrom(raw) {
  const table = gxt.parseGxt2(new Uint8Array(raw));
  const entries = [];
  for (const district of vectorMap.WORLD_DISTRICTS) {
    const name = table.get(district.zoneCode);
    if (name) entries.push([district.zoneCode, name.slice(0, ZONE_NAME_MAX)]);
  }
  return entries.length ? Object.fromEntries(entries) : null;
}

/** Файл вывода команды: путь рядом с кэшем, чтение и удаление. */
async function withOutput(slot, tag, task) {
  await fs.mkdir(slot.dir, { recursive: true });
  const output = path.join(slot.dir, `${path.basename(slot.file, ".bin")}.${process.pid}.${tag}.tmp`);
  try {
    return await task(output);
  } finally {
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

async function build({ root, keys, slot, tools, handOver }) {
  const { engine, run } = tools;
  const asked = (output) => [COMMAND, "--game-root", root, "--keys", keys, "--output", output];
  let answer;
  let geometry;
  try {
    [answer, geometry] = await withOutput(slot, "radar", async (output) => {
      const reply = await run(engine, asked(output));
      return [reply, new Uint8Array(await fs.readFile(output))];
    });
  } catch (error) {
    return handOver(errorClass(error));
  }
  if (!vectorMap.decodeRadarGeometry(geometry)) return handOver("геометрия не читается");
  if (!answer?.triangles || !Number.isFinite(answer.tiles)) return handOver("нет треугольников");
  const zoneNames = await settleTo(
    () =>
      withOutput(slot, "zones", async (output) => {
        await run(engine, ["read-archive-file", "--game-root", root, "--keys", keys, "--entry", ZONE_NAMES_ENTRY, "--output", output]);
        return zoneNamesFrom(await fs.readFile(output));
      }),
    null,
  );
  const gathered = { atlas: answer.atlas ?? null, tiles: answer.tiles, triangles: answer.triangles, zoneNames, geometry };
  await saveSlot(slot, gathered);
  await tidySlot(slot);
  return Object.assign({}, gathered, { cached: false });
}

/** Общая сборка на файл кэша: второй вызов получает то же обещание. */
function joinOrBuild(slot, work) {
  const key = slot.file;
  if (buildsInFlight.has(key)) return buildsInFlight.get(key);
  const started = work().finally(() => buildsInFlight.delete(key));
  buildsInFlight.set(key, started);
  return started;
}

/**
 * Геометрия радара — как `readWorldMapGeometry`: `(запрос, папка состояния, параметры)`. Четвёртый параметр — для проверок: движок, прежний читатель, журнал и контекст приложения подставляются.
 */
export async function readWorldMapGeometry(input = {}, stateDir, options = {}, deps = {}) {
  const { executable = engineExecutable, run = runEngine, fallback = oldReader, log = (entry) => appLog.record(entry), context = workerData?.context ?? {} } = deps;
  const former = () => fallback(input, stateDir, options);
  const root = rootOf(input);
  /* Негодный запрос — дело прежнего читателя: его слово человек уже знает. */
  if (!root) return former();
  const stamp = await fingerprintOf(root);
  if (stamp === null) return null;
  const slot = cacheSlot(stateDir, keyOf(stamp));
  const cached = await loadSlot(slot);
  if (cached) return cached;
  const handOver = (why) => {
    log({ level: "info", source: "rust-readers", message: `Читатель radar-geometry: ${COMMAND} не взят (${why}), читает прежний.` });
    return former();
  };
  const keys = String(input?.keys || "").trim();
  if (!keys) return handOver("ключей нет");
  const engine = executable(context);
  if (!engine) return handOver("движка нет");
  return joinOrBuild(slot, () => build({ root, keys, slot, tools: { engine, run }, handOver }));
}
