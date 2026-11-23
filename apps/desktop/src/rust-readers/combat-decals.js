/*
 * Раны и кровь для предпросмотров боя на команде движка `read-combat-decals` (`ASTRAL_RUST_READERS=combat-decals`).
 *
 * Работает в потоке чтения игры вместо `readCombatDecals` из `combat-decals.js` и отвечает тем же: `{ pedDamage, decals, sheets, from }`, листы-каналы — `ArrayBuffer`, а не
 * `{ $bytes }` движка. Читается один раз на игру и запоминается на запуск, как у прежнего читателя; отказ не запоминается. Возврат на прежнего читателя — как у `ptfx-base.js`:
 * нет движка, отказ, нет поля — одна строка в журнал приложения (без путей и текста отказа), и чтение за прежним.
 */
import path from "node:path";
import { appLog } from "../app-log.js";
import { errorClass } from "../game-read-trace.js";
import { engineExecutable, runEngine } from "./engine-run.js";

const COMMAND = "read-combat-decals";
const BYTES_TAG = "$bytes";
const FIELDS = Object.freeze(["pedDamage", "decals", "sheets", "from"]);

/* Прежний читатель: грузится, только когда нужен. */
const oldReader = (...call) => import("../combat-decals.js").then((module) => module.readCombatDecals(...call));

/* Прочитанное на игру: ключ — путь папки в нижнем регистре, значение — обещание ответа. */
const cache = new Map();

/** Байты из base64 ровно в своём `ArrayBuffer`: буфер Node может лежать в общем пуле, а читатель отдавал отдельный буфер листа. */
function arrayBufferOf(encoded) {
  const buffer = Buffer.from(encoded, "base64");
  const own = buffer.byteOffset === 0 && buffer.length === buffer.buffer.byteLength;
  return own ? buffer.buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
}

/** Почему ответ нельзя отдать как есть: слово причины или `null`. */
function refusalOf(answer) {
  if (!answer || typeof answer !== "object") return "ответ не объект";
  const bad = FIELDS.find((name) => !(name in answer) || answer[name] == null);
  if (bad) return `нет поля ${bad}`;
  const sheets = Object.values(answer.sheets);
  if (sheets.some((sheet) => typeof sheet?.data?.[BYTES_TAG] !== "string")) return "лист без байтов";
  return null;
}

/** Ответ движка в форме прежнего читателя. */
function shaped(answer) {
  const sheets = Object.fromEntries(
    Object.entries(answer.sheets).map(([name, sheet]) => [name, { width: sheet.width, height: sheet.height, channels: sheet.channels, data: arrayBufferOf(sheet.data[BYTES_TAG]) }]),
  );
  return { pedDamage: answer.pedDamage, decals: answer.decals, sheets, from: answer.from };
}

/**
 * Раны и кровь — как `readCombatDecals`: `(запрос, контекст, папка состояния, инструменты)`. Пятый параметр — для проверок: движок, прежний читатель и журнал подставляются.
 */
export async function readCombatDecals(input, context, stateDir, tools = {}, deps = {}) {
  const { executable = engineExecutable, run = runEngine, fallback = oldReader, log = (entry) => appLog.record(entry) } = deps;
  const former = () => fallback(input, context, stateDir, tools);
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) return former();
  const key = gameRoot.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const state = { handedOver: false };
  const handOver = (why) => {
    state.handedOver = true;
    log({ level: "info", source: "rust-readers", message: `Читатель combat-decals: ${COMMAND} не взят (${why}), читает прежний.` });
    return former();
  };
  const pending = (async () => {
    const engine = executable(context);
    if (!engine) return handOver("движка нет");
    let answer;
    try {
      answer = await run(engine, [COMMAND, "--game-root", gameRoot, ...(input.keys ? ["--keys", String(input.keys)] : [])]);
    } catch (error) {
      return handOver(errorClass(error));
    }
    const why = refusalOf(answer);
    return why ? handOver(why) : shaped(answer);
  })();
  cache.set(key, pending);
  /* Запоминается только то, что прочитал движок: отказ и чтение прежним читателем (у него своя память) не запоминаются, следующий заход пробует движок снова. */
  const forget = () => {
    if (cache.get(key) === pending) cache.delete(key);
  };
  pending.then(() => state.handedOver && forget(), forget);
  return pending;
}
