import { fileURLToPath } from "node:url";
import { isServiceWindow } from "./service-windows.js";
import { createServiceShooterHost } from "./service-shooter-host.js";

export const PART_SHOOTER_PRELOAD = fileURLToPath(new URL("./part-shooter-preload.cjs", import.meta.url));

const CHANNELS = Object.freeze({
  shoot: "astral:part-shooter:shoot",
  shot: "astral:part-shooter:shot",
  ready: "astral:part-shooter:ready",
});
const INFO_GLOBAL = "__astralPartShooterInfo";
const SERVICE_PAGE = "/app?service=part-shooter";
const CLOSED_WINDOW_MESSAGE = "Окно Astral закрыто — снимать некому.";
const DEFAULT_SHOT_MS = 180000;

// Пределы длин: код работы в запросе и в ответе.
const WORK_CODE_LIMIT = 200000;
const REQUEST_CODE_LIMIT = 300000;

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

const hasMagic = (bytes, offset, magic) => magic.every((byte, i) => bytes[offset + i] === byte);

// ---------- приведения и общий обходчик схем ----------

const clipped = (limit) => (value) => String(value || "").slice(0, limit);
const plainText = clipped(Infinity);
const numberOrZero = (value) => Number(value) || 0;
const copyOfBytes = (value) => new Uint8Array(value);
const copyOrNull = (value) => (value ? new Uint8Array(value) : null);

// Чтение поля: строгое (null в записи — TypeError) и мягкое (через ?.).
const strictRead = (source, key) => source[key];
const softRead = (source, key) => source?.[key];

// Схема записи — список [ключ, приведение]; объект собирается в порядке схемы.
function recordOf(schema, source, read = softRead) {
  const record = {};
  for (const [key, convert] of schema) record[key] = convert(read(source, key));
  return record;
}

const FILE_SCHEMA = [
  ["name", plainText],
  ["bytes", copyOfBytes],
];
const COVER_SCHEMA = [
  ["width", Number],
  ["height", Number],
  ["gap", Number],
];
const SEA_SCHEMA = [["gameRoot", clipped(1024)]];
const STILL_SCHEMA = [
  ["id", clipped(24)],
  ["hour", numberOrZero],
  ["caption", clipped(40)],
  ["bytes", copyOrNull],
];
const CLIP_META_SCHEMA = [
  ["width", numberOrZero],
  ["height", numberOrZero],
  ["duration", numberOrZero],
  ["codec", clipped(12)],
];
const WORK_SCHEMA = [["kind", clipped(40)]];

// ---------- запрос работника → запрос окну ----------

const OMIT = Symbol("omit");

// Поля в порядке, в котором они уходят окну; OMIT — поля нет.
const REQUEST_FIELDS = [
  ["partKind", (request) => plainText(request?.partKind)],
  ["name", (request) => plainText(request?.name)],
  ["palette", (request) => (request?.palette === "author" ? "author" : OMIT)],
  ["exact", (request) => (request?.exact === true ? true : OMIT)],
  ["still", (request) => (request?.still === true ? true : OMIT)],
  ["fx", (request) => request?.fx === true],
  ["fxClip", (request) => (request?.fxClip === true ? true : OMIT)],
  ["fxView", (request) => (request?.fxView === "side" || request?.fxView === "third" ? request.fxView : OMIT)],
  ["code", (request) => (request?.code ? clipped(REQUEST_CODE_LIMIT)(request.code) : OMIT)],
  ["cover", (request) => (request?.cover ? recordOf(COVER_SCHEMA, request.cover, strictRead) : OMIT)],
  ["sea", (request) => (request?.sea?.gameRoot ? recordOf(SEA_SCHEMA, request.sea, strictRead) : OMIT)],
  ["files", (request) => (request?.files || []).map((file) => recordOf(FILE_SCHEMA, file, strictRead))],
];

export function windowRequest(request) {
  const out = {};
  for (const [key, pick] of REQUEST_FIELDS) {
    const value = pick(request);
    if (value !== OMIT) out[key] = value;
  }
  return out;
}

// ---------- ответ окна → ответ работнику (страница — чужой код: всё проверяется) ----------

const cleanLines = (list, limit, most) =>
  Array.isArray(list)
    ? list
        .map(clipped(limit))
        .filter(Boolean)
        .slice(0, most)
    : [];

// Код работы: «ASTRAL-» и четыре отрезка подряд — [допустимый знак, не меньше, не больше].
const WORK_CODE_SEGMENTS = [
  [(ch) => ch >= "A" && ch <= "Z", 1, Infinity],
  [(ch) => ch >= "0" && ch <= "9", 1, 3],
  [(ch) => ch === "-", 1, 1],
  [(ch) => /[A-Za-z0-9_-]/.test(ch), 1, Infinity],
];

function isWorkCode(code) {
  if (code.length > WORK_CODE_LIMIT || !code.startsWith("ASTRAL-")) return false;
  let at = "ASTRAL-".length;
  for (const [accepts, least, most] of WORK_CODE_SEGMENTS) {
    let end = at;
    while (end < code.length && end - at < most && accepts(code[end])) end += 1;
    if (end - at < least) return false;
    at = end;
  }
  return at === code.length;
}

// Код отказа редактора: строчные латинские буквы и «-», от 1 до 40 знаков.
function isRefusalCode(text) {
  return text.length >= 1 && text.length <= 40 && [...text].every((ch) => (ch >= "a" && ch <= "z") || ch === "-");
}

const isWebpStill = (still) =>
  still.id !== "" &&
  still.bytes !== null &&
  still.bytes.length > 12 &&
  hasMagic(still.bytes, 0, RIFF_MAGIC) &&
  hasMagic(still.bytes, 8, WEBP_MAGIC);

function webmClip(clip) {
  if (!clip?.bytes) return null;
  const bytes = new Uint8Array(clip.bytes);
  if (!hasMagic(bytes, 0, EBML_MAGIC)) return null;
  return { bytes, ...recordOf(CLIP_META_SCHEMA, clip) };
}

export function skyMotionOf(result) {
  const stills = (Array.isArray(result?.stills) ? result.stills : [])
    .map((item) => recordOf(STILL_SCHEMA, item))
    .filter(isWebpStill);
  const clip = webmClip(result?.clip);
  return Object.fromEntries([
    ...(stills.length ? [["stills", stills]] : []),
    ...(clip ? [["clip", clip]] : []),
    ...(result?.clipError ? [["clipError", clipped(200)(result.clipError)]] : []),
  ]);
}

// Правила служебных полей: каждое даёт список пар [ключ, значение].
const STATUS_RULES = [
  (result) => (result?.reason === "nothing" ? [["reason", "nothing"]] : []),
  (result) =>
    result?.framed
      ? [
          ["framed", result.framed === "tracer-off" || result.framed === "hit-off" ? result.framed : true],
          ["note", clipped(200)(result.note)],
        ]
      : [],
  (result) => (result?.fxReason ? [["fxReason", clipped(200)(result.fxReason)]] : []),
];

// «Работа» части мастерской и отказ редактора.
function workEntries(result) {
  const code = String(result?.work?.code || "");
  const lost = cleanLines(result?.lost, 200, 8);
  const refused = result?.refused;
  let entries = [];
  if (isWorkCode(code)) {
    entries = [
      ["work", { ...recordOf(WORK_SCHEMA, result.work, strictRead), code }],
      ["lossless", result.lossless === true],
      ["lost", lost],
    ];
  } else if (lost.length) {
    entries = [
      ["lossless", false],
      ["lost", lost],
    ];
  }
  if (isRefusalCode(String(refused || ""))) {
    entries.push(["refused", refused], ["rules", cleanLines(result?.rules, 80, 8)]);
  }
  return entries;
}

function workerAnswer(result) {
  return {
    png: result?.png ? new Uint8Array(result.png) : null,
    gallery: (result?.gallery || []).filter(Boolean).map(copyOfBytes),
    need: Array.isArray(result?.need) ? result.need : null,
    ...skyMotionOf(result),
    ...Object.fromEntries(STATUS_RULES.flatMap((rule) => rule(result))),
    ...Object.fromEntries(workEntries(result)),
  };
}

// ---------- хозяин ----------

function defaultShotMs() {
  const fromEnv = Number(process.env.ASTRAL_PART_SHOT_MS);
  return fromEnv > 0 ? fromEnv : DEFAULT_SHOT_MS;
}

export function createPartShooterHost(options) {
  return createServiceShooterHost({
    shotMs: defaultShotMs(),
    ...options,
    channels: CHANNELS,
    infoGlobal: INFO_GLOBAL,
    requestOf: (request) => windowRequest(request),
    resultOf: (result) => workerAnswer(result),
  });
}

// ---------- вариант для Desktop ----------

// Первое окно интерфейса (служебные не считаются); по нему ищется страница и решается, закрывать ли съёмщика.
const firstUiWindow = (BrowserWindow) =>
  BrowserWindow.getAllWindows().find((candidate) => !isServiceWindow(candidate));

function pageUrlOf(BrowserWindow) {
  return () => {
    const uiWindow = firstUiWindow(BrowserWindow);
    const address = uiWindow?.webContents.getURL();
    if (!address) throw new Error(CLOSED_WINDOW_MESSAGE);
    return new URL(SERVICE_PAGE, address).href;
  };
}

function closeWhenUiGone(app, BrowserWindow, host) {
  const onClosed = () => {
    if (!firstUiWindow(BrowserWindow)) host.close();
  };
  app.on("browser-window-created", (event, window) => window.once("closed", onClosed));
}

export function desktopPartShooter({ app, BrowserWindow, ipcMain }) {
  const host = createPartShooterHost({
    BrowserWindow,
    ipcMain,
    url: pageUrlOf(BrowserWindow),
    preload: PART_SHOOTER_PRELOAD,
  });
  closeWhenUiGone(app, BrowserWindow, host);
  return host;
}
