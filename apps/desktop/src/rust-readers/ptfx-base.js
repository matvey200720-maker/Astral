/*
 * База эффектов для мастерской на команде движка `read-ptfx-base` (`ASTRAL_RUST_READERS=ptfx-base`).
 *
 * Работает в потоке чтения игры вместо `readPtfxBase` из `ptfx-customizer.js` и отвечает тем же: те же разделы в том же порядке, листы — буферами PNG, а не
 * `{ $bytes }` движка. Большой ответ (десятки мегабайт) разбирается здесь, в потоке; в главный процесс уходит готовое.
 *
 * Тихий возврат на прежнего читателя — в каждом случае, где движок не даёт то же, что дал бы он: движка или команды нет, он отказал или не ответил, в ответе нет раздела или раздел
 * не собрался (`…Error`), в хранилище оригиналов есть листы «под карточкой» (их движок не знает), в запросе нет папки игры. В журнал приложения идёт одна строка с причиной одним словом:
 * без путей и без текста отказа. Отказ пользователю показывает тот, кого вызвали последним, — прежний читатель, прежними словами.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appLog } from "../app-log.js";
import { errorClass } from "../game-read-trace.js";
import { originalsDirectory } from "../ptfx-originals.js";
import { engineExecutable, runEngine } from "./engine-run.js";

const COMMAND = "read-ptfx-base";
const STORE_VERSION = 1;
const BYTES_TAG = "$bytes";
/* Листы сцен и импакта движок отдаёт строкой `data:` в поле `png`; прежний читатель — буфером с 19.10.2026 (`ptfx-base-cache.js`). */
const PNG_DATA = "data:image/png;base64,";

/* Разделы ответа прежнего читателя в его порядке. Пары `<раздел>Error` у шести: отказ раздела движок кладёт туда, как и прежний читатель. */
const SECTIONS = Object.freeze([
  "bloodfx",
  "version",
  "entries",
  "core",
  "clipProblems",
  "environment",
  "environmentError",
  "environmentScene",
  "environmentSceneError",
  "tracerScene",
  "tracerSceneError",
  "rangeScene",
  "rangeSceneError",
  "impact",
  "impactError",
  "light",
  "lightError",
]);
const REFUSALS = Object.freeze(SECTIONS.filter((name) => name.endsWith("Error")));

/* Прежний читатель: грузится, только когда нужен, — чтение на движке его модуль не поднимает. */
const oldReader = (...call) => import("../ptfx-customizer.js").then((module) => module.readPtfxBase(...call));

/** Папка игры из запроса так, как её берёт прежний читатель; негодная — `null`. */
function gameRootOf(input) {
  const given = String(input?.gameRoot || "").trim();
  return given && path.isAbsolute(given) ? path.resolve(given) : null;
}

/** Есть ли в хранилище оригиналов листы под карточкой каталога: `plain` движок не знает, он читает хранилище без них. */
async function holdsCardPaint(directory) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(path.join(directory, "index.json"), "utf8"));
    if (parsed?.version !== STORE_VERSION) return false;
    return Object.values(parsed.textures ?? {}).some((entry) => entry?.plain);
  } catch {
    return false;
  }
}

/** Заменители байтов `{ $bytes }` и листы-строки `data:` в поле `png` → буферы, на месте (ответ свой, копия не нужна). */
function decodeBytes(value) {
  if (Array.isArray(value)) {
    for (let at = 0; at < value.length; at += 1) value[at] = decodeBytes(value[at]);
    return value;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === BYTES_TAG && typeof value[BYTES_TAG] === "string") return Buffer.from(value[BYTES_TAG], "base64");
    for (const key of keys) {
      const inner = value[key];
      value[key] = key === "png" && typeof inner === "string" && inner.startsWith(PNG_DATA) ? Buffer.from(inner.slice(PNG_DATA.length), "base64") : decodeBytes(inner);
    }
  }
  return value;
}

/** Почему ответ нельзя отдать как есть: слово причины или `null`. Нет раздела — движок старше приложения; раздел с отказом — читатель не уверен. */
function refusalOf(answer) {
  if (!answer || typeof answer !== "object") return "ответ не объект";
  const missing = SECTIONS.find((name) => !(name in answer));
  if (missing) return `нет раздела ${missing}`;
  const refused = REFUSALS.find((name) => answer[name] != null);
  return refused ? `раздел отказал: ${refused}` : null;
}

/** Ответ движка в форме прежнего читателя. */
function shaped(answer) {
  return Object.fromEntries(SECTIONS.map((name) => [name, decodeBytes(answer[name])]));
}

/**
 * База эффектов — как `readPtfxBase`: `(запрос, контекст, папка состояния, инструменты)`. Пятый параметр — для проверок: движок, прежний читатель и журнал подставляются.
 */
export async function readPtfxBase(input, context, stateDir, tools = {}, deps = {}) {
  const { executable = engineExecutable, run = runEngine, fallback = oldReader, log = (entry) => appLog.record(entry) } = deps;
  const former = () => fallback(input, context, stateDir, tools);
  const gameRoot = gameRootOf(input);
  /* Негодный запрос — дело прежнего читателя: его слово человек уже знает. */
  if (!gameRoot) return former();
  const handOver = (why) => {
    log({ level: "info", source: "rust-readers", message: `Читатель ptfx-base: ${COMMAND} не взят (${why}), читает прежний.` });
    return former();
  };
  const engine = executable(context);
  if (!engine) return handOver("движка нет");
  const originals = originalsDirectory(stateDir || os.tmpdir(), gameRoot);
  if (await holdsCardPaint(originals)) return handOver("в хранилище оригиналов листы под карточкой");
  const args = [COMMAND, "--game-root", gameRoot, ...(input.keys ? ["--keys", String(input.keys)] : []), "--originals", originals];
  let answer;
  try {
    answer = await run(engine, args);
  } catch (error) {
    return handOver(errorClass(error));
  }
  const why = refusalOf(answer);
  return why ? handOver(why) : shaped(answer);
}
