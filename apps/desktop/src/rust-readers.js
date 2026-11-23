/*
 * Читатели вкладок мастерской на командах движка Rust (`read-ptfx-base`, `read-combat-decals`, `read-radar-geometry`).
 *
 * Выключатель — переменная окружения `ASTRAL_RUST_READERS`: имена читателей через запятую (`ptfx-base,combat-decals,radar-geometry`), `all` или слово панели «Новый движок» (`on`, `1`,
 * `true`, `yes`) — все три. По умолчанию пусто: путь прежний, байт в байт. Общий выключатель движка `ASTRAL_RUST_ENGINE=off` (`off`, `0`, `false`, `no`) выключает и читателей. Включённый читатель идёт в свой переходник (`rust-readers/<имя>.js`) внутри потока чтения игры: переходник просит ответ у движка, приводит его к форме прежнего читателя
 * и сам, в потоке, разбирает большой ответ; чего не умеет — отдаёт чтение прежнему читателю и пишет строку в журнал приложения (`game-read-host.js` подменяет модуль на вызове).
 */

export const RUST_READERS_VARIABLE = "ASTRAL_RUST_READERS";

/* Имя читателя, файл прежнего читателя и его экспорт. Пара «файл + экспорт» подменяется целиком; другие экспорты того же файла идут как раньше. */
const READERS = Object.freeze([
  Object.freeze({ id: "ptfx-base", file: "ptfx-customizer.js", exportName: "readPtfxBase" }),
  Object.freeze({ id: "combat-decals", file: "combat-decals.js", exportName: "readCombatDecals" }),
  Object.freeze({ id: "radar-geometry", file: "world-map-geometry.js", exportName: "readWorldMapGeometry" }),
]);

/* «Все читатели»: `all` и слова панели (`setGroupSwitches` пишет `on`; те же слова, что у `switchOn`). */
const EVERY = new Set(["all", "on", "1", "true", "yes"]);
/* Слова «выключено» у общего выключателя движка (`native-engine-rust.js`: `rustEngineEnabled`); модуль не подключаем — он тянет движок в каждый поток чтения. */
const ENGINE_VARIABLE = "ASTRAL_RUST_ENGINE";
const ENGINE_OFF = new Set(["off", "0", "false", "no"]);
const ADAPTERS = new URL("./rust-readers/", import.meta.url).href;

const NONE = Object.freeze(new Set());
let lastRaw = "";
let lastSet = NONE;

/** Включённые читатели по окружению: имена через запятую, `all` или слово панели (`on`), лишнее пропускается. Разбор запоминается по тексту значения. */
export function enabledRustReaders(env = process.env) {
  const raw = String(env?.[RUST_READERS_VARIABLE] ?? "").trim().toLowerCase();
  if (raw === lastRaw) return lastSet;
  const words = raw.split(",").map((word) => word.trim());
  const known = READERS.map((reader) => reader.id);
  const chosen = words.some((word) => EVERY.has(word)) ? known : known.filter((id) => words.includes(id));
  lastRaw = raw;
  lastSet = chosen.length ? Object.freeze(new Set(chosen)) : NONE;
  return lastSet;
}

/** Список читателей (только чтение): им пользуется сторож тестов — у каждой записи адрес переходника сам не подменяется. */
export const RUST_READER_TABLE = READERS;

/* Сегменты адреса или пути модуля без запроса и решётки: последний — файл, перед ним — папка. */
function segmentsOf(module) {
  const text = String(module ?? "").split(/[?#]/)[0];
  return text.split(/[\\/]/).filter(Boolean);
}

/* Папка переходников; имя папки — свойство устройства: что в ней лежит, подмене не подлежит (`rustReaderFor`). */
const ADAPTER_FOLDER = "rust-readers";

/**
 * Адрес переходника для пары «модуль + экспорт»; `null` — читатель прежний (выключено, другая пара). Выключено — одна проверка переменной.
 * Модуль из папки переходников не подменяется никогда: хост переходника заворачивается в ту же подмену, а файл переходника зовётся так же, как файл прежнего читателя
 * (`combat-decals.js`) — по одному имени файла вызов в переходник шёл бы в переходник снова, пока не кончался стек (замер в Electron 18.11.2026, `RangeError`).
 */
export function rustReaderFor(module, exportName, env = process.env) {
  if (!env?.[RUST_READERS_VARIABLE]) return null;
  if (ENGINE_OFF.has(String(env?.[ENGINE_VARIABLE] ?? "").trim().toLowerCase())) return null;
  const enabled = enabledRustReaders(env);
  if (enabled.size === 0) return null;
  const segments = segmentsOf(module);
  if (segments.at(-2) === ADAPTER_FOLDER) return null;
  const file = segments.at(-1) ?? "";
  const reader = READERS.find((one) => one.file === file && one.exportName === exportName);
  return reader && enabled.has(reader.id) ? `${ADAPTERS}${reader.id}.js` : null;
}
