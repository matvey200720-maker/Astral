import { createRequire } from "node:module";
import zlib from "node:zlib";
import { isMainThread } from "node:worker_threads";

export const RUST_ADDON = "./astral-rs.win32-x64-msvc.node";
export const RUST_PREBUILT = "./prebuilt/astral-rs.win32-x64.node";
export const SLOW_CALL_MS = 500;
export const MAX_INFLATED_RESOURCE_BYTES = 1073741824;
export const NG_SELF_TEST_EXPECTED =
  "43e37effbe872634b38f631efd909634a9cf6dc1756270d7833ca3b39adbae01b5e8ec1a6506daa3e3772aad8ac639f00027a30a56cd34597a661b2c3c256e53c3cad1d8df";

const DEFAULT_LEVEL = zlib.constants.Z_BEST_COMPRESSION;
const INFLATE_SLACK_BYTES = 1048576;
const MEBIBYTE = 1048576;
const OVERSIZED_CODE = "ASTRAL_RESOURCE_OVERSIZED";

// ---------------------------------------------------------------------------
// Общие помощники

// Текст брошенного значения: message, а если его нет или он пуст, само значение.
const thrownText = (thrown) => thrown?.message || String(thrown);

// Единственное место с try/catch для «выполнить, а при отказе ответить иначе».
function settle(run, onThrow) {
  try {
    return run();
  } catch (thrown) {
    return onThrow(thrown);
  }
}

// Первый ответ правил, который не null; правила получают одни и те же аргументы.
function firstOutcome(rules, ...args) {
  for (const rule of rules) {
    const outcome = rule(...args);
    if (outcome !== null) return outcome;
  }
  return null;
}

// Вид на те же байты без копирования; Buffer идёт как есть.
function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  const storage = bytes.buffer;
  return Buffer.from(storage, bytes.byteOffset, bytes.byteLength);
}

const toFreshBytes = (buffer) => new Uint8Array(buffer);

// ---------------------------------------------------------------------------
// Входы самопроверки

const NG_KEY_WORDS = 68;
const NG_TABLE_WORDS = 17 * 16 * 256;
const NG_PLAIN_BYTES = 69;
const NG_KEY_SEED = 0x9e3779b9;
const NG_TABLE_SEED = 0x85ebca6b;

function* xorshift32(seed) {
  let state = seed;
  for (;;) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    yield state >>> 0;
  }
}

const wordsFromSeed = (seed, count) => {
  const stream = xorshift32(seed);
  return Uint32Array.from({ length: count }, () => stream.next().value);
};

let ngSelfTestMaster = null;

export function ngSelfTestInput() {
  ngSelfTestMaster ??= {
    key: wordsFromSeed(NG_KEY_SEED, NG_KEY_WORDS),
    tables: wordsFromSeed(NG_TABLE_SEED, NG_TABLE_WORDS),
    plain: Uint8Array.from({ length: NG_PLAIN_BYTES }, (_, i) => i * 7 + 3),
  };
  const { key, tables, plain } = ngSelfTestMaster;
  return { key: key.slice(), tables: tables.slice(), plain: plain.slice() };
}

const SAMPLE_BYTES = 6000;
const SAMPLE_SEED = 0x2545f491;
const SELF_TEST_LEVELS = [6, 9];

const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;

function* lcgStates(seed) {
  let state = seed;
  for (;;) {
    const scaled = Math.imul(LCG_MULTIPLIER, state);
    state = (scaled + LCG_INCREMENT) >>> 0;
    yield state;
  }
}

// Байт образца по номеру: срабатывает первое подходящее правило.
const SAMPLE_BYTE_RULES = [
  { applies: (i) => i % 512 < 256, byteOf: (i) => i },
  { applies: (i) => i % 5 === 0, byteOf: (i, state) => state >>> 24 },
  { applies: () => true, byteOf: (i) => i >> 4 },
];

function buildSample() {
  const states = lcgStates(SAMPLE_SEED);
  const bytes = Array.from({ length: SAMPLE_BYTES }, (_, i) => {
    const state = states.next().value;
    return SAMPLE_BYTE_RULES.find((rule) => rule.applies(i)).byteOf(i, state);
  });
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Самопроверка модуля

const verdict = (ok, ng, reason) => ({ ok, ng, reason });

// Выполняет пробу: её результат — причина отказа или null; брошенное становится причиной.
const probe = (run, prefix) => settle(run, (thrown) => `${prefix}: ${thrownText(thrown)}`);

const referenceStream = (sample) => zlib.deflateRawSync(sample, { level: DEFAULT_LEVEL });

const deflateStep = (level) => (addon, sample) => {
  const packed = addon.deflateRaw(sample, level);
  const restored = zlib.inflateRawSync(Buffer.from(packed));
  return restored.equals(sample)
    ? null
    : `сжатие уровня ${level}: zlib разжал не то, что сжато`;
};

// Шаги проверки сжатия и распаковки; каждый отвечает причиной отказа или null.
const CODEC_STEPS = [
  ...SELF_TEST_LEVELS.map(deflateStep),
  (addon, sample) => {
    const unpacked = addon.inflateRaw(referenceStream(sample), sample.length);
    return Buffer.from(unpacked).equals(sample) ? null : "распаковка: результат не совпал с zlib";
  },
  (addon, sample) =>
    settle(
      () => {
        addon.inflateRaw(referenceStream(sample), sample.length + 1);
        return "распаковка приняла чужую длину";
      },
      () => null,
    ),
];

const findCodecFault = (addon) => firstOutcome(CODEC_STEPS, addon, buildSample());

const selfTestNgArguments = () => {
  const input = ngSelfTestInput();
  return [Buffer.from(input.plain), input.key, input.tables];
};

const NG_EXPECTED_BYTES = Buffer.from(NG_SELF_TEST_EXPECTED, "hex");

function findNgFault(addon) {
  const answer = addon.ngDecrypt(...selfTestNgArguments());
  if (NG_EXPECTED_BYTES.equals(Buffer.from(answer))) return null;
  return "расшифровка NG не совпала с JS";
}

export function checkAddon(addon) {
  const codecFault = probe(() => findCodecFault(addon), "сжатие и распаковка");
  if (codecFault !== null) return verdict(false, false, codecFault);
  if (typeof addon.ngDecrypt !== "function") {
    return verdict(true, false, "в модуле нет расшифровки NG");
  }
  const ngFault = probe(() => findNgFault(addon), "расшифровка NG");
  return ngFault === null ? verdict(true, true, "") : verdict(true, false, ngFault);
}

// ---------------------------------------------------------------------------
// Загрузка модуля Rust (при импорте, один раз)

// Ворота загрузки: каждые отвечают причиной, если закрыты, иначе null; порядок важен.
const LOAD_GATES = [
  () => (process.env.ASTRAL_RUST === "0" ? "выключен ASTRAL_RUST=0" : null),
  () =>
    process.platform !== "win32" || process.arch !== "x64" ? "модуль собран под Windows x64" : null,
];

const CANDIDATES = [
  { source: "build", path: RUST_ADDON },
  { source: "prebuilt", path: RUST_PREBUILT },
];

const withoutAddon = (reason) => ({ addon: null, ng: false, source: null, reason });

// Кандидаты по очереди; следующий не трогается, пока потребитель не попросит.
// Находка: { source, note } для отказа (note может быть null) или { source, addon, result } для годного.
function* inspectCandidates(requireModule) {
  for (const { source, path } of CANDIDATES) {
    const loaded = settle(
      () => ({ addon: requireModule(path) }),
      (thrown) => ({ thrown }),
    );
    if ("thrown" in loaded) {
      const missing = loaded.thrown?.code === "MODULE_NOT_FOUND";
      yield { source, note: missing ? null : `${source}: ${thrownText(loaded.thrown)}` };
      continue;
    }
    const result = checkAddon(loaded.addon);
    yield result.ok
      ? { source, addon: loaded.addon, result }
      : { source, note: `${source}: ${result.reason}` };
  }
}

const summarizeNotes = (notes) =>
  notes.length > 0 ? `самопроверка не пройдена (${notes.join("; ")})` : "модуль не найден";

function acquireAddon() {
  const closedReason = firstOutcome(LOAD_GATES);
  if (closedReason !== null) return withoutAddon(closedReason);

  const notes = [];
  for (const finding of inspectCandidates(createRequire(import.meta.url))) {
    if (finding.result) {
      const { ng, reason } = finding.result;
      return { addon: finding.addon, ng, source: finding.source, reason };
    }
    if (finding.note !== null) notes.push(finding.note);
  }
  return withoutAddon(summarizeNotes(notes));
}

// ---------------------------------------------------------------------------
// Состояние модуля

const statusOf = ({ addon, ng, source, reason }) =>
  Object.freeze(Object.assign({ available: addon !== null }, { ng, source, reason }));

const found = acquireAddon();

export const rustStatus = statusOf(found);
export const rustAvailable = rustStatus.available;

// Сам модуль нужен только вызовам ниже.
const rustAddon = found.addon;

export function describeRustStatus(status = rustStatus) {
  if (!status.available) {
    return `модуль Rust не загружен — сборка и чтение архивов идут на JS, медленнее: ${status.reason}`;
  }
  const origin = status.source === "prebuilt" ? "готовый из поставки" : "собранный на этой машине";
  const ngPart = status.ng ? "расшифровка NG" : `расшифровка NG на JS (${status.reason})`;
  return `модуль Rust загружен (${origin}): сжатие libdeflate, ${ngPart}`;
}

// ---------------------------------------------------------------------------
// Замер медленных вызовов

const meter = { sink: null, thresholdMs: SLOW_CALL_MS };

export function attachSlowCallReport(next, options = {}) {
  const requested = options.thresholdMs;
  meter.thresholdMs = requested === undefined ? SLOW_CALL_MS : requested;
  meter.sink = typeof next === "function" ? next : null;
}

// Сбой приёмника не должен менять исход вызова.
const deliver = (sink, report) => settle(() => sink(report), () => undefined);

// Начинает замер, если он нужен: приёмник подключён и поток главный.
// Возвращает функцию «закончить замер с исходом вызова» или null.
function beginWatch(call, bytes) {
  if (!isMainThread || meter.sink === null) return null;
  const { sink, thresholdMs } = meter;
  const startedAt = performance.now();
  return (outcome) => {
    const finishedAt = performance.now();
    const spent = finishedAt - startedAt;
    if (!(spent >= thresholdMs)) return;
    const report = { call, bytes, out: "thrown" in outcome ? null : outcome.value.byteLength };
    report.ms = Math.round(spent);
    deliver(sink, report);
  };
}

// Секундомер для одного вида вызовов.
function stopwatch(call) {
  return (bytes, work) => {
    const finish = beginWatch(call, bytes);
    if (finish === null) return work();
    const outcome = settle(
      () => ({ value: work() }),
      (thrown) => ({ thrown }),
    );
    finish(outcome);
    if ("thrown" in outcome) throw outcome.thrown;
    return outcome.value;
  };
}

// ---------------------------------------------------------------------------
// Предел разжатия и отказ «больше заявленного»

const isPositiveFinite = (value) => Number.isFinite(value) && value > 0;

const inflateSlack = (size) => Math.max(INFLATE_SLACK_BYTES, Math.floor(size / 8));

export function resourceInflateLimit(size = null) {
  return isPositiveFinite(size)
    ? Math.min(MAX_INFLATED_RESOURCE_BYTES, size + inflateSlack(size))
    : MAX_INFLATED_RESOURCE_BYTES;
}

const KIBIBYTE_UNIT = {
  label: "КБ",
  amount: (bytes) => Math.max(1, Math.ceil(bytes / 1024)),
};
const MEBIBYTE_UNIT = {
  label: "МБ",
  amount: (bytes) => Math.round((bytes / MEBIBYTE) * 10) / 10,
};

function sizeInWords(bytes) {
  const unit = bytes < MEBIBYTE ? KIBIBYTE_UNIT : MEBIBYTE_UNIT;
  return `${unit.amount(bytes)} ${unit.label}`;
}

// Чем назвать превышение: заявленным размером, если он известен и предел ниже потолка, иначе пределом.
const NAMING_RULES = [
  (size, limit) =>
    isPositiveFinite(size) && limit < MAX_INFLATED_RESOURCE_BYTES ? sizeInWords(size) : null,
  (size, limit) => `предел ${sizeInWords(limit)}`,
];

export function oversizedResourceError(size, limit, cause = null) {
  return Object.assign(
    new Error(
      `Ресурс разжимается больше заявленного размера (${firstOutcome(NAMING_RULES, size, limit)}) — файл повреждён или нестандартный`,
    ),
    { code: OVERSIZED_CODE },
    cause ? { cause } : null,
  );
}

// Отказ zlib «слишком большой буфер» становится отказом по размеру, остальное идёт как есть.
const refuseInflate = (size, limit) => (failure) => {
  throw failure?.code === "ERR_BUFFER_TOO_LARGE"
    ? oversizedResourceError(size, limit, failure)
    : failure;
};

function inflateUnder(input, size, limit) {
  const options = { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: limit };
  return settle(() => zlib.inflateRawSync(input, options), refuseInflate(size, limit));
}

export function inflateRawBounded(input, size = null) {
  return inflateUnder(input, size, resourceInflateLimit(size));
}

// ---------------------------------------------------------------------------
// Сжатие, распаковка, расшифровка

const timedDeflate = stopwatch("deflateRaw");
const timedInflate = stopwatch("inflateResource");
const timedNgDecrypt = stopwatch("ngDecrypt");

// Модуль Rust берёт только то, что zlib понимает так же: байты (строка, ArrayBuffer, вид на буфер)
// и целый уровень 1…9. Остальное — уровень 0 («без сжатия»), -1, дробный, вне 1…9, чужой тип входа —
// идёт в zlib: он принимает и отказывает одинаково на обоих путях.
function rustDeflateInput(bytes) {
  if (typeof bytes === "string" || bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  return ArrayBuffer.isView(bytes) ? asBuffer(bytes) : null;
}

const rustDeflateLevel = (level) => (Number.isInteger(level) && level >= 1 && level <= 9 ? level : null);

function deflateWith(bytes, level) {
  const input = rustAddon === null ? null : rustDeflateInput(bytes);
  const rustLevel = rustDeflateLevel(level);
  return input === null || rustLevel === null
    ? zlib.deflateRawSync(bytes, { level })
    : rustAddon.deflateRaw(input, rustLevel);
}

export function deflateRaw(bytes, options = {}) {
  const requested = options.level;
  const level = requested === undefined ? DEFAULT_LEVEL : requested;
  const length = bytes.byteLength;
  return timedDeflate(length, () => deflateWith(bytes, level));
}

const declaredLength = (size) => (Number.isInteger(size) && size > 0 ? size : null);

// Способы получить байты ресурса, по порядку: модуль Rust (если есть, длина известна и укладывается
// в тот же предел, что у zlib), затем zlib.
const INFLATE_ATTEMPTS = [
  (input, declared) =>
    rustAddon !== null && declared !== null && declared <= resourceInflateLimit(declared)
      ? settle(() => rustAddon.inflateRaw(input, declared), () => null)
      : null,
  (input, declared) => inflateRawBounded(input, declared),
];

const unpackResource = (input, size) =>
  timedInflate(input.byteLength, () =>
    toFreshBytes(firstOutcome(INFLATE_ATTEMPTS, input, declaredLength(size))),
  );

export function inflateResource(bytes, size = null) {
  return unpackResource(asBuffer(bytes), size);
}

function makeNgDecrypt() {
  return (bytes, key, tables) => {
    const length = bytes.byteLength;
    return timedNgDecrypt(length, () =>
      toFreshBytes(rustAddon.ngDecrypt(asBuffer(bytes), key, tables)),
    );
  };
}

export const ngDecrypt = rustStatus.ng ? makeNgDecrypt() : null;

// ---------------------------------------------------------------------------
// Ядра цвета травы (15.11.2026): `crates/astral-recolor/src/grass.rs`, мост — `native/astral-rs/src/grass.rs`
//
// Ядра считают то же, что `grass-colour.js`, байт в байт, и берут из JS только байты и числа. Подставляет их
// в `grass-colour.js` сторона Node (`setNativeGrassKernels`): окно с предпросмотром модуль Rust не грузит.
// Выключатель `ASTRAL_RECOLOR_KERNELS=0` возвращает JS. Нет модуля или нет ядер в старом бинарнике — ядер нет.
//
// Синус, косинус и арктангенс ядро не считает: у V8 они свои и разные в Node 24 (fdlibm) и в Electron 43
// (у 3 % синусов и 18 % арктангенсов другой последний бит), а байты обязаны совпасть с тем, что насчитал бы
// JS в этом же процессе. Поэтому ядро сдвига зовётся трижды с одними и теми же входами: «какие арктангенсы
// тебе нужны» → JS считает `Math.atan2` → «какие углы» → JS считает `Math.sin` и `Math.cos` → «ответь».
// Чисел таблиц немного: это разные цвета листа (у листов мода ~4 % от числа пикселей), а не пиксели.

const GRASS_KERNELS_VERSION = 2;
const GRASS_FORMAT_CODES = Object.freeze({ DXT1: 1, DXT3: 3, DXT5: 5 });
const GRASS_PROBE_ARGUMENTS = 4096;
const GRASS_PROBE_SEED = 0x6a09e667;
const GRASS_DARK = 0.04;
const NO_NUMBERS = new Float64Array(0);
// Разных цветов больше этой доли от числа пикселей (шум, а не лист): таблицы дороже самого счёта на JS — ядро отказывается.
const GRASS_VARIED_SHARE = 0.35;

// Проба `Math.hypot`: его порт в ядре — чистая арифметика, и у Node 24, и у Electron 43 он совпал с V8.
// Если у какой-то сборки V8 расходится — ядер нет.
const GRASS_HYPOT_EDGES = [0, 0, 0, -0.3, -0, -0.3, 0.3, 0, 0.3, -0, 1e-5, 0.5, 0.5, 1e-5, -0.4, 1e-9, 1e-300, 1, 0.1, 0.1];

function grassHypotInput() {
  const states = xorshift32(GRASS_PROBE_SEED);
  const input = new Float64Array(GRASS_PROBE_ARGUMENTS * 2);
  for (let at = 0; at < input.length; at += 1) input[at] = (states.next().value / 4294967296 * 2 - 1) * 0.6;
  input.set(GRASS_HYPOT_EDGES);
  return input;
}

function findGrassFault(addon) {
  const input = grassHypotInput();
  const answer = addon.grassTrig(3, input);
  for (let at = 0; at < answer.length; at += 1) {
    if (!Object.is(answer[at], Math.hypot(input[at * 2], input[at * 2 + 1]))) return "Math.hypot в этом процессе не совпал с портом ядра";
  }
  return null;
}

const asClamped = (bytes) => new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length);
const asPlain = (bytes) => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
// `undefined` — ядро отказалось (считает JS), `null` — ответ «менять нечего», иначе — байты.
const orNull = (value, convert) => (value === undefined ? undefined : value === null ? null : convert(value));

// Отказ ядра «шум» (много разных цветов, таблицы дороже счёта) — не сбой: ответ `undefined`, считает JS.
const declinable = (call) => {
  try {
    return call();
  } catch (error) {
    if (error?.code === "Cancelled") return undefined;
    throw error;
  }
};

// Три вызова ядра сдвига с таблицами значений, которые считает сам JS (`call(tables)` → ответ ядра).
// `limit` — сколько разных арктангенсов и углов выносит счёт через таблицы; больше — `undefined` (шум: проще посчитать на JS).
function viaTables(call, limit = Infinity) {
  let reply = call({ mode: 1, atanArgs: NO_NUMBERS, atanValues: NO_NUMBERS, angles: NO_NUMBERS, sines: NO_NUMBERS, cosines: NO_NUMBERS });
  if (reply.done) return reply.bytes ?? null;
  const atanArgs = reply.askAtan;
  if (atanArgs.length / 2 > limit) return undefined;
  const atanValues = new Float64Array(atanArgs.length / 2);
  for (let at = 0; at < atanValues.length; at += 1) atanValues[at] = Math.atan2(atanArgs[at * 2], atanArgs[at * 2 + 1]);
  reply = call({ mode: 2, atanArgs, atanValues, angles: NO_NUMBERS, sines: NO_NUMBERS, cosines: NO_NUMBERS });
  const angles = reply.askAngles;
  if (angles.length > limit) return undefined;
  const sines = new Float64Array(angles.length);
  const cosines = new Float64Array(angles.length);
  for (let at = 0; at < angles.length; at += 1) {
    sines[at] = Math.sin(angles[at]);
    cosines[at] = Math.cos(angles[at]);
  }
  reply = call({ mode: 3, atanArgs, atanValues, angles, sines, cosines });
  if (!reply.done) throw new Error("ядро травы не дало ответа с таблицами");
  return reply.bytes ?? null;
}

// Средняя трава по суммам ядра — `grassReference().result()` слово в слово (арктангенс и гипотенуза — у JS).
function referenceOfSums([weight, sumY, sumCb, sumCr]) {
  if (weight <= 0) return undefined;
  const y = sumY / weight;
  const cb = sumCb / weight;
  const cr = sumCr / weight;
  return [y, Math.atan2(cr, cb), Math.max(0.02, Math.hypot(cb, cr) / Math.max(y, GRASS_DARK))];
}

const withReferences = (found) =>
  found === undefined ? undefined : found ? { grass: found.grass, sandy: found.sandy, touched: found.touched, grassRef: referenceOfSums(found.grassSum), sandRef: referenceOfSums(found.sandSum) } : null;

// Ядра для `grass-colour.js`: байты в `Uint8Array`/`Uint8ClampedArray` той же формы, что у JS-пути; отказ ядра — исключение.
function makeGrassKernels(addon) {
  return Object.freeze({
    version: GRASS_KERNELS_VERSION,
    // recolourGrass: `null` — травы на листе нет.
    recolourGrass: (rgba, target) =>
      orNull(declinable(() => viaTables((tables) => addon.grassRecolour(asBuffer(rgba), target.gain, target.angle, target.saturation, tables), (rgba.length / 4) * GRASS_VARIED_SHARE)), asClamped),
    // recolourDistantBlocks, первая половина: веса опорных цветов, тронутые блоки и средние травы и песка; `null` — менять нечего.
    distantBlocksWeights: (bytes, format, width, height, greens, sand) =>
      withReferences(addon.grassBlocksWeights(asBuffer(bytes), GRASS_FORMAT_CODES[format], width, height, greens, sand)),
    // вторая: `slots` — номер цели у блока (-1 — не трогать), `targets` — gain, angle, saturation на цель.
    distantBlocksShift: (bytes, format, width, height, weights, targets, slots, albedo) =>
      orNull(
        viaTables((tables) =>
          addon.grassBlocksShift(asBuffer(bytes), GRASS_FORMAT_CODES[format], width, height, weights.grass, weights.sandy, weights.grassRef, weights.sandRef, targets, slots, albedo, tables),
        ),
        asPlain,
      ),
    // recolourDistantSand: то же по пикселям листа RGBA.
    distantRgbaWeights: (rgba, greens, sand) => withReferences(declinable(() => addon.grassRgbaWeights(asBuffer(rgba), greens, sand))),
    distantRgbaShift: (rgba, weights, targets, slots, albedo) =>
      orNull(
        viaTables((tables) => addon.grassRgbaShift(asBuffer(rgba), weights.grass, weights.sandy, weights.grassRef, weights.sandRef, targets, slots, albedo, tables), (rgba.length / 4) * GRASS_VARIED_SHARE),
        asClamped,
      ),
    // grassInstanceColour пачкой: `r, g, b` подряд на выходе, у экземпляра без цели — как был.
    instanceColours: (instances, slots, targets, sheet, reference) =>
      orNull(declinable(() => viaTables((tables) => addon.grassInstanceColours(asBuffer(instances), slots, targets, sheet, reference, tables), (instances.length / 3) * GRASS_VARIED_SHARE)), asPlain),
    // Порт `fdlibm` ядра (Node 24) — для сверки с `Math.*` в тестах; приложение им не пользуется.
    trig: (kind, input) => addon.grassTrig(kind, input),
  });
}

const withoutKernels = (reason) => ({ kernels: null, reason });

const GRASS_GATES = [
  () => (process.env.ASTRAL_RECOLOR_KERNELS === "0" ? "выключено ASTRAL_RECOLOR_KERNELS=0" : null),
  () => (rustAddon === null ? "модуль Rust не загружен" : null),
  () =>
    typeof rustAddon.grassKernelsVersion === "function" && rustAddon.grassKernelsVersion() === GRASS_KERNELS_VERSION
      ? null
      : "в модуле нет ядер травы (бинарник старее исходников)",
  () => probe(() => findGrassFault(rustAddon), "ядра травы"),
];

function acquireGrassKernels() {
  const closed = firstOutcome(GRASS_GATES);
  return closed === null ? { kernels: makeGrassKernels(rustAddon), reason: "" } : withoutKernels(closed);
}

const grassFound = acquireGrassKernels();

/** Ядра цвета травы на Rust или `null`: тогда всё считает JS. */
export const grassKernels = grassFound.kernels;
export const grassKernelsStatus = Object.freeze({ available: grassFound.kernels !== null, reason: grassFound.reason });

// ---------------------------------------------------------------------------
// Предупреждение о негодном модуле: только в главном потоке

if (!rustStatus.available && rustStatus.reason.startsWith("самопроверка") && isMainThread) {
  console.warn(`[native-rs] ${describeRustStatus(rustStatus)}`);
}

// ---------------------------------------------------------------------------
// Сжатие блоков текстур DXT1/3/5 (ядро `native/astral-rs/src/dxt.rs`, 15.11.2026)
//
// Тот же кодек, что `packages/dds/block-codec.js`, байт в байт. Берёт только то, что JS-кодек читает
// так же: RGBA байтами (Uint8Array, Uint8ClampedArray, Buffer) точной длины, целые стороны от 1,
// формат DXT1/DXT3/DXT5. Остальное, как и любой отказ (выключатель ASTRAL_NATIVE_DXT=0, нет модуля,
// старый модуль без этой функции, провал самопроверки, ошибка вызова), — `null`: тогда сжимает JS.

export const DXT_SELF_TEST_EXPECTED =
  // DXT1, DXT3, DXT5 подряд (32 + 64 + 64 байта: у образца 6×5 четыре блока на формат).
  "6b9e4b420aabbff55ddf5edffffffcff719bdde63434343400000000ffffffff" +
  "ffffffffffffffff6b9e4b420aabbff5050004000a0001004cd7cf595755fcaa8ff08ff08ff08ff07bfed13ad3d3d3d3000000000000000075f4160c01010101" +
  "ffff0000000000006b9e4b420aabbff5ab004cd22448f2244cd7cf595755fcaaff006000066000067bfed13ad3d3d3d3070048822448822475f4160c01010101";

const DXT_BLOCK_BYTES = { DXT1: 8, DXT3: 16, DXT5: 16 };
const DXT_SELF_TEST_FORMATS = ["DXT1", "DXT3", "DXT5"];
const DXT_SELF_TEST_WIDTH = 6;
const DXT_SELF_TEST_HEIGHT = 5;
const DXT_SELF_TEST_SEED = 0x7a1c5e03;

// Образец самопроверки: плавный блок слева сверху, остальное — шум с разной альфой. Края не кратны четырём.
export function dxtSelfTestInput() {
  const states = lcgStates(DXT_SELF_TEST_SEED);
  const rgba = new Uint8Array(DXT_SELF_TEST_WIDTH * DXT_SELF_TEST_HEIGHT * 4);
  for (let pixel = 0; pixel < DXT_SELF_TEST_WIDTH * DXT_SELF_TEST_HEIGHT; pixel += 1) {
    const state = states.next().value;
    const x = pixel % DXT_SELF_TEST_WIDTH;
    const y = Math.floor(pixel / DXT_SELF_TEST_WIDTH);
    const alpha = [255, (state >>> 4) & 255, 0][pixel % 3];
    const colour =
      x < 4 && y < 4
        ? [40 + x * 50, 200 - y * 40, 90, 255]
        : [state >>> 24, (state >>> 16) & 255, (state >>> 8) & 255, alpha];
    rgba.set(colour, pixel * 4);
  }
  return { rgba, width: DXT_SELF_TEST_WIDTH, height: DXT_SELF_TEST_HEIGHT };
}

const dxtBlocksLength = (format, width, height) =>
  Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * DXT_BLOCK_BYTES[format];

// Блоки пишутся прямо в буфер JS: результат — его обычный Uint8Array, без копии.
function runDxt(addon, format, rgba, width, height) {
  const blocks = new Uint8Array(dxtBlocksLength(format, width, height));
  addon.encodeDxtBlocks(format, asBuffer(rgba), width, height, asBuffer(blocks));
  return blocks;
}

function findDxtFault(addon) {
  const { rgba, width, height } = dxtSelfTestInput();
  const answer = DXT_SELF_TEST_FORMATS.map((format) =>
    Buffer.from(runDxt(addon, format, rgba, width, height)).toString("hex"),
  ).join("");
  return answer === DXT_SELF_TEST_EXPECTED ? null : "блоки DXT не совпали с JS";
}

// Ворота ядра: каждые отвечают причиной отказа или null; порядок важен. Выключатель читается при первом сжатии.
const DXT_GATES = [
  (addon, env) => (env.ASTRAL_NATIVE_DXT === "0" ? "выключено ASTRAL_NATIVE_DXT=0" : null),
  (addon) => (addon === null ? "модуль Rust не загружен" : null),
  (addon) =>
    typeof addon.encodeDxtBlocks === "function"
      ? null
      : "в модуле нет сжатия блоков DXT (старая сборка)",
  (addon) => probe(() => findDxtFault(addon), "сжатие блоков DXT"),
];

// Причина, по которой модуль `addon` (или его отсутствие, null) не годится для сжатия блоков; null — годится.
export function findDxtRefusal(addon, env = process.env) {
  return firstOutcome(DXT_GATES, addon, env);
}

const isDxtPicture = (format, rgba, width, height) =>
  Object.hasOwn(DXT_BLOCK_BYTES, format) &&
  (rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) &&
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width >= 1 &&
  height >= 1 &&
  rgba.length === width * height * 4;

const timedDxt = stopwatch("encodeBlocks");

// Сжатие блоков одним модулем. Самопроверка — один раз на процесс, при первом вызове: потоки, которые
// ничего не сжимают, ядро не трогают. Сбой вызова снимает ядро совсем: дальше всё идёт на JS без повторных падений.
export function createBlockEncoder(addon, env = process.env) {
  let verdict = null;
  const state = () => (verdict ??= { reason: findDxtRefusal(addon, env) });
  const retire = (thrown) => {
    verdict = { reason: `сбой вызова: ${thrownText(thrown)}` };
    return null;
  };
  return {
    // Доступно ли нативное сжатие блоков и почему нет (для журналов и тестов).
    status() {
      const { reason } = state();
      return Object.freeze({ available: reason === null, reason: reason ?? "" });
    },
    // RGBA → блоки DXT нативным ядром; Uint8Array или null («сжимай сам»).
    encode(format, rgba, width, height) {
      if (!isDxtPicture(format, rgba, width, height) || state().reason !== null) return null;
      return settle(
        () => timedDxt(rgba.byteLength, () => runDxt(addon, format, rgba, width, height)),
        retire,
      );
    },
  };
}

const dxtEncoder = createBlockEncoder(rustAddon);

export const dxtNativeStatus = dxtEncoder.status;
export const encodeBlocksNative = dxtEncoder.encode;

// ---------------------------------------------------------------------------
// Приоритет ввода-вывода дочернего процесса (`native/astral-rs/src/io_priority.rs`, 18.11.2026)
//
// `os.setPriority` меняет класс приоритета процесса, а его ввод-вывод остаётся обычным: чтения и записи
// установки стоят в одной очереди с игрой и браузером. Ступень ввода-вывода ставит только система
// (`NtSetInformationProcess`), поэтому функция живёт в модуле Rust. Нет модуля, старый модуль без неё,
// выключатель ASTRAL_RUST=0, отказ системы — ответ `false` (или `null` у чтения): установка идёт как шла.

/** Ступени ввода-вывода, которые ставятся процессу: «очень низкий» — фоновый ввод-вывод Windows. */
export const IO_PRIORITY = Object.freeze({ veryLow: 0, low: 1, normal: 2 });

const IO_PRIORITY_LEVELS = new Set(Object.values(IO_PRIORITY));
const isProcessId = (pid) => Number.isInteger(pid) && pid > 0 && pid <= 0xffffffff;
const hasAddonFunction = (addon, name) => addon !== null && typeof addon[name] === "function";

// Обе функции над модулем `addon` (или его отсутствием, null): так их проверяют тесты на подставном модуле.
export function createIoPriority(addon) {
  const canSet = hasAddonFunction(addon, "setProcessIoPriority");
  const canRead = hasAddonFunction(addon, "processIoPriority");
  return Object.freeze({
    available: canSet,
    // Поставить ступень процессу `pid`; `true` — сменилась.
    set(pid, level) {
      if (!canSet || !isProcessId(pid) || !IO_PRIORITY_LEVELS.has(level)) return false;
      return settle(() => addon.setProcessIoPriority(pid, level) === true, () => false);
    },
    // Ступень процесса `pid` числом Windows (0…4) или null, если узнать не вышло.
    read(pid) {
      if (!canRead || !isProcessId(pid)) return null;
      const level = settle(() => addon.processIoPriority(pid), () => null);
      return Number.isInteger(level) ? level : null;
    },
  });
}

const ioPriority = createIoPriority(rustAddon);

/** Есть ли в загруженном модуле смена приоритета ввода-вывода. */
export const processIoPriorityAvailable = ioPriority.available;
export const setProcessIoPriority = ioPriority.set;
export const processIoPriority = ioPriority.read;

// ---------------------------------------------------------------------------
// Приоритет ввода-вывода открытого файла (`io_priority.rs`, 18.11.2026)
//
// Копии и загрузки идут в главном процессе: ступень процесса задела бы и окно, а асинхронный ввод-вывод Node
// выполняет общий пул потоков, так что и ступень потока не годится. Ступень ставится самому открытому файлу
// (`FileIoPriorityHintInformation`): её получают чтения и записи через него, в каком бы потоке они ни шли, а
// остальные файлы процесса она не задевает. `file` — номер файла (`fs.openSync`) или `FileHandle` (`fs.promises.open`).

const fileNumberOf = (file) => (Number.isInteger(file) ? file : Number.isInteger(file?.fd) ? file.fd : -1);

// Обе функции над модулем `addon` (или его отсутствием, null) — для тестов на подставном модуле.
export function createFileIoPriority(addon) {
  const canSet = hasAddonFunction(addon, "setFileIoPriority");
  const canRead = hasAddonFunction(addon, "fileIoPriority");
  return Object.freeze({
    available: canSet,
    // Поставить ступень открытому файлу; `true` — сменилась.
    set(file, level) {
      const fd = fileNumberOf(file);
      if (!canSet || fd < 0 || !IO_PRIORITY_LEVELS.has(level)) return false;
      return settle(() => addon.setFileIoPriority(fd, level) === true, () => false);
    },
    // Ступень открытого файла числом Windows или null, если узнать не вышло.
    read(file) {
      const fd = fileNumberOf(file);
      if (!canRead || fd < 0) return null;
      const level = settle(() => addon.fileIoPriority(fd), () => null);
      return Number.isInteger(level) ? level : null;
    },
  });
}

const fileIoPriorityOf = createFileIoPriority(rustAddon);

/** Есть ли в загруженном модуле смена ступени ввода-вывода у открытого файла. */
export const fileIoPriorityAvailable = fileIoPriorityOf.available;
export const setFileIoPriority = fileIoPriorityOf.set;
export const fileIoPriority = fileIoPriorityOf.read;

// ---------------------------------------------------------------------------
// Занятость физического диска (`native/astral-rs/src/disk_perf.rs`, 20.11.2026, регулятор диска)
//
// Накопительные счётчики драйвера диска (`IOCTL_DISK_PERFORMANCE`): простой, время запросов, очередь, байты. Разность двух отсчётов даёт «Активное время» Диспетчера задач, очередь и отклик
// (`packages/install-engine/disk-sensor.js: createNativeSensor`). Нет модуля, старый модуль без функции, не том, отказ системы — `null`: регулятор берёт запасной датчик.

// Функция над модулем `addon` (или его отсутствием, null) — для тестов на подставном модуле.
export function createDiskPerformance(addon) {
  const can = hasAddonFunction(addon, "diskPerformance");
  return Object.freeze({
    available: can,
    // Счётчики диска тома `volume` («C», «c:», «C:») или null.
    read(volume) {
      if (!can || typeof volume !== "string") return null;
      const letter = volume.trim().replace(/:$/, "");
      if (!/^[A-Za-z]$/.test(letter)) return null;
      const value = settle(() => addon.diskPerformance(letter), () => null);
      return value !== null && typeof value === "object" ? value : null;
    },
  });
}

const diskPerformanceOf = createDiskPerformance(rustAddon);

/** Есть ли в загруженном модуле чтение счётчиков физического диска. */
export const diskPerformanceAvailable = diskPerformanceOf.available;
export const diskPerformance = diskPerformanceOf.read;
