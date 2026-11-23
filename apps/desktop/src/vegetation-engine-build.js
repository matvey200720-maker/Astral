/*
 * Файлы растительности — движком (команда `vegetation-build`, крейт `native/astral-engine/crates/astral-recolor`; 16.11.2026, работа
 * «Astral быстрее», слово владельца «переписывай на Rust»).
 *
 * Прежняя сборка — потоки JS (`vegetation-build-worker.js`): «как в моде» 950 файлов и 2 ГБ, «свой цвет» 3243 файла и 6,6 ГБ. Ядра цвета травы
 * (15.11) и кодек DXT уже на Rust, но порядок сборки вёл JS: потоки, склад в каждом потоке, копирование байт между потоками, сборщик мусора. Движок
 * читает файлы из архивов игры сам, держит одну память готовых листов мода на все потоки и пишет готовые файлы; каждый выходит тем же байт в байт, что
 * у JS (`scripts/probe-vegetation-engine.mjs`).
 *
 * Что берёт движок: файлы вида `game`, где правки — только листы мода (`green`), дальние планы (`distant`) и газоны (`lawns`). Листва, карточки, изгороди,
 * палитры, спрайты, карты травы, деревья районов и копии «В разнобой» идут потоками JS. Файл, который движок дословно не повторяет, он отдаёт со статусом
 * `fallback`, и его собирают потоки.
 *
 * Что остаётся здесь: что работа значит. Цвет травы файла (`fileColour`), цели цвета (`grassTarget`: арктангенс и гипотенуза) и полоса цветов эффекта зоны
 * считаются в JS и едут числами (дробные — битами `f64`): последний бит `Math.*` у Node 24 и Electron 43 разный.
 *
 * Выключатель — `ASTRAL_VEGETATION_ENGINE=1` (по умолчанию выключен: движок пока не проверен в игре).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { grassReference, grassTarget } from "@modovik/climb-contract/recolor/grass-colour";
import { NON_PLANT_BATCH_MODELS, isNonPlantBatch, joaatName } from "@modovik/climb-contract/recolor/vegetation";
import { DEFAULT_BLADE } from "./vegetation-build.js";
import { engineBuildThreads, engineScratchDirectory, runEngineCommand } from "./engine-run.js";

const REQUEST_FORMAT = "astral.vegetation-build";

/** Сборка движком включена переменной `ASTRAL_VEGETATION_ENGINE=1` (по умолчанию — потоки JS). */
export const vegetationEngineEnabled = (env = process.env) => ["1", "on", "true"].includes(String(env.ASTRAL_VEGETATION_ENGINE ?? "").trim().toLowerCase());

/** Потоков движка на растительность — общее правило тяжёлой сборки (`engineBuildThreads`); `ASTRAL_VEGETATION_ENGINE_THREADS` — своё число. */
export const vegetationEngineThreads = ({ env = process.env, cores = null } = {}) => engineBuildThreads({ env, cores, envName: "ASTRAL_VEGETATION_ENGINE_THREADS" });

/* Число `f64` битами (десятичная строка `u64`): в JSON оно доезжает до движка тем же до последнего бита. */
const bitsView = new DataView(new ArrayBuffer(8));
const bits = (value) => {
  bitsView.setFloat64(0, Number(value), true);
  return bitsView.getBigUint64(0, true).toString();
};
const targetBits = (target) => [target.gain, target.angle, target.saturation].map(bits);

/* Правки, которые движок умеет; остальное в задании — файл идёт потокам JS. */
const ENGINE_KEYS = new Set(["kind", "name", "zone", "green", "distant", "lawns"]);
/* Карта травы: только цвет травинок своей зоны (`area` — подпись района, на сборку не влияет). */
const GRASS_KEYS = new Set(["kind", "name", "zone", "area", "flowers"]);

/**
 * Файл можно отдать движку: файл игры (`game`) только с листами мода, дальним планом и газонами, либо карта травы (`grass`) только с цветом травинок —
 * без цветов, клумб и «В разнобой». У карты травы зона должна иметь полосу цветов эффекта (`context` — `createVegetationContext`).
 */
export function vegetationEngineEligible(spec, context = null) {
  if (spec?.kind === "grass") {
    if (spec.flowers || spec.beds || spec.variety || !Object.keys(spec).every((key) => GRASS_KEYS.has(key))) return false;
    return Boolean(context?.zones?.[spec.zone || context.zoneOf(spec.name)]?.field?.engine);
  }
  if (spec?.kind !== "game") return false;
  if (!(spec.green || spec.distant || spec.lawns)) return false;
  return Object.keys(spec).every((key) => ENGINE_KEYS.has(key));
}

/* Дальний план зоны для запроса: `null` — для зоны его нет (трава как в игре; у «как в моде» город вдали не трогается). */
function distantZoneOf(context, zone) {
  const options = context.distantOptions(zone);
  if (!options) return null;
  const part = context.zones[zone];
  if (part.mod) {
    return {
      greens: options.greens,
      sand: options.sand,
      albedo: bits(options.albedo),
      targets: [targetBits(context.modTarget)],
      field: null,
      zoneCentre: [bits(0), bits(0)],
    };
  }
  const field = part.field?.engine;
  if (!field) return undefined;
  return {
    greens: options.greens,
    sand: options.sand,
    albedo: bits(options.albedo),
    targets: field.palette.map((colour) => targetBits(grassTarget(colour, { gain: options.gain }))),
    field: {
      steps: field.steps,
      direction: field.direction,
      line: field.line,
      width: bits(field.width),
      box: [field.box.west, field.box.south, field.box.east, field.box.north].map(bits),
      centre: field.centre.map(bits),
      radius: bits(field.radius),
    },
    zoneCentre: field.centre.map(bits),
  };
}

/**
 * Строки заданий движка по файлам `jobs` (`[{ spec, at, output, file? }]`; `file` — файл на диске вместо архива игры, стенды и тесты без игры): `{ rows, paints, distants }` или `null`, если работа движку не годится
 * (нет склада травы, цвет зоны без полосы). `context` — `createVegetationContext`, `plan` — `sandy.plan` (места файлов).
 */
export function vegetationEngineRequest({ jobs, context, plan }) {
  const paints = [];
  const paintOf = new Map();
  const paintIndex = (hex) => {
    if (!hex) return null;
    if (!paintOf.has(hex)) {
      paintOf.set(hex, paints.length);
      paints.push({ key: hex, rgb: hexBytes(hex), target: targetBits(grassTarget(hex)) });
    }
    return paintOf.get(hex);
  };
  const distants = {};
  const places = plan?.places || {};
  const rows = [];
  const grassZones = {};
  for (const { spec, at, output, file } of jobs) {
    const zone = spec.zone || context.zoneOf(spec.name);
    if (spec.kind === "grass") {
      const shape = context.zones[zone]?.field?.engine;
      if (!shape) return null;
      grassZones[zone] ||= {
        targets: shape.palette.map((colour) => targetBits(grassTarget(colour))),
        field: { steps: shape.steps, direction: shape.direction, line: shape.line, width: bits(shape.width), box: [shape.box.west, shape.box.south, shape.box.east, shape.box.north].map(bits), centre: shape.centre.map(bits), radius: bits(shape.radius) },
      };
      rows.push({ kind: "grass", name: spec.name, ...(file ? { file } : { at }), output, zone });
      continue;
    }
    const colour = context.fileColour(spec.name, zone);
    const row = { name: spec.name, ...(file ? { file } : { at }), output, country: zone === "country", paint: paintIndex(colour) };
    if (spec.green) row.green = spec.green.map(([name, image, tint]) => [name, image, tint ? 1 : 0]);
    if (spec.distant) {
      if (!(zone in distants)) distants[zone] = distantZoneOf(context, zone);
      if (distants[zone] === undefined) return null;
      if (distants[zone]) row.distant = { zone, place: places[spec.name] ? places[spec.name].map(bits) : null };
    }
    /* Газоны красятся только своим цветом: без цвета файла их правка — пустая. */
    if (spec.lawns && colour) row.lawns = spec.lawns;
    rows.push(row);
  }
  for (const zone of Object.keys(distants)) if (!distants[zone]) delete distants[zone];
  return { rows, paints, distants, grassZones };
}

/**
 * Файлы мода для движка: описание картинок плана и их байты первых уровней одним файлом (`images.bin`). Нужны все картинки, на которые
 * ссылаются задания, и листы мода по имени (`modSheets`).
 */
function sandyImages(sandy, rows, modSheets) {
  const wanted = new Set();
  for (const row of rows) for (const [, image] of row.green || []) wanted.add(image);
  for (const [, [image]] of modSheets.exact) wanted.add(image);
  for (const [, [image]] of modSheets.base) wanted.add(image);
  const images = {};
  const parts = [];
  let offset = 0;
  for (const id of wanted) {
    const picture = sandy.plan.images[id];
    if (!picture) continue;
    const entry = { width: picture.width, height: picture.height, format: picture.format || "DXT1", offset: 0, length: 0 };
    if (picture.flat) entry.flat = hexBytes(picture.flat);
    else {
      const payload = sandy.image(id);
      if (!payload) continue;
      entry.offset = offset;
      entry.length = payload.length;
      parts.push(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength));
      offset += payload.length;
    }
    images[id] = entry;
  }
  return { images, bytes: Buffer.concat(parts) };
}

/* Модель травинки для запроса: средний лист и средняя травинка (`grassReference`) — считает JS, у него `atan2` и `hypot` те же, что у приложения. */
function bladeRequest(info) {
  const reference = grassReference();
  reference.add(info.mean[0] * info.sheet[0], info.mean[1] * info.sheet[1], info.mean[2] * info.sheet[2]);
  const result = reference.result();
  return { sheet: info.sheet.map(bits), reference: [result.y, result.angle, result.saturation].map(bits) };
}

/** Карты травы для запроса: зоны, модели травинок плана, травинка «по умолчанию» и хэши камней с бревнами; `null` — камни считаются иначе, чем у движка. */
function grassRequest(grassZones, plan) {
  const nonPlant = NON_PLANT_BATCH_MODELS.map(joaatName);
  if (!nonPlant.every((hash) => isNonPlantBatch(hash))) return null;
  const blades = {};
  for (const [hash, info] of Object.entries(plan?.blades || {})) blades[hash] = bladeRequest(info);
  return { zones: grassZones, blades, default: bladeRequest(DEFAULT_BLADE), nonPlant };
}

/** Листы мода по имени (`modSheetsOf`) в запросе: `[имя, картинка, оттенок]`. */
const sheetRows = (map) => [...map].map(([name, [image, tint]]) => [name, image, tint ? 1 : 0]);

/**
 * Собрать файлы движком. `jobs` — `[{ spec, at, output }]`: задание (`vegetationEngineEligible`), место в игре и куда писать готовый файл.
 * `context` — `createVegetationContext`, `sandy` — открытый склад (`openGreenSandy`). Итог — по заданию, в том же порядке:
 * `{ status: "built", bytes, sha256, kinds, counts }`, `{ status: "unchanged" }`, `{ status: "missing" }` или `{ status: "fallback", reason }`.
 * Отказ движка целиком — исключение (вызывающий собирает всё потоками JS).
 */
export async function buildVegetationOnEngine({
  executable,
  gameRoot,
  keysDirectory = "",
  context,
  sandy,
  jobs,
  threads = undefined,
  memoBytes = null,
  archive = "",
  onProgress = null,
  onSpawn = null,
  /* `scratchRoot` — корень рабочих папок, назначенный хозяином сборки (`vegetation-build-host.js`): снятый отменой поток до своего `finally` не доходит, и корень убирает хозяин. */
  scratchRoot = "",
  /* `onTimings({ threads, readMs, parseMs, … })` — время потоков движка по этапам (суммой по потокам): на чём сборка стоит. */
  onTimings = null,
  signal = null,
}) {
  if (!jobs.length) return [];
  const request = vegetationEngineRequest({ jobs, context, plan: sandy.plan });
  if (!request) return jobs.map(() => ({ status: "fallback", reason: "облик зоны не для движка" }));
  const grass = Object.keys(request.grassZones).length ? grassRequest(request.grassZones, sandy.plan) : undefined;
  if (grass === null) return jobs.map(() => ({ status: "fallback", reason: "камни карт травы считаются иначе, чем у движка" }));
  const modSheets = { exact: context.modSheets.exact, base: context.modSheets.base };
  const scratch = await engineScratchDirectory("astral-vegetation-engine-", scratchRoot);
  try {
    const { images, bytes } = sandyImages(sandy, request.rows, modSheets);
    const imagesFile = path.join(scratch, "images.bin");
    await fs.writeFile(imagesFile, bytes);
    const requestFile = path.join(scratch, `${randomUUID()}.json`);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        format: REQUEST_FORMAT,
        version: 1,
        gameRoot,
        threads: Math.max(1, Math.floor(threads ?? vegetationEngineThreads()) || 1),
        ...(Number.isInteger(memoBytes) && memoBytes > 0 ? { memoBytes } : {}),
        ...(archive ? { archives: { base: archive } } : {}),
        imagesFile,
        images,
        modSheets: { exact: sheetRows(modSheets.exact), base: sheetRows(modSheets.base) },
        paints: request.paints,
        distants: request.distants,
        ...(grass ? { grass } : {}),
        jobs: request.rows,
      }),
    );
    const result = await runEngineCommand(executable, ["vegetation-build", "--request", requestFile, ...(keysDirectory ? ["--keys", keysDirectory] : [])], {
      onProgress: (progress) => progress.phase === "vegetation" && onProgress?.({ done: progress.done, total: progress.total }),
      onSpawn,
      signal,
      background: true,
    });
    const files = Array.isArray(result.files) ? result.files : [];
    if (files.length !== jobs.length) throw new Error("Движок сборки растительности ответил не по всем файлам.");
    if (result.timings && typeof result.timings === "object") onTimings?.({ threads: result.threads ?? null, ...result.timings });
    return files;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
