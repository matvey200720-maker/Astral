/*
 * Запуск команды движка из потока чтения игры: процесс на команду, ответ целиком в памяти потока (в главный процесс он не заходит).
 *
 * Движок — тот же, что у приложения (`resolveRustExecutable`: рядом с приложением или в дереве разработчика). `ASTRAL_RUST_READERS_ENGINE` называет файл движка прямо — для замеров на
 * собранном отдельно движке. Читающая команда ничего не пишет: чужой процесс ей не мешает, а она — ему.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolveRustExecutable } from "../native-engine-rust.js";

export const READERS_ENGINE_VARIABLE = "ASTRAL_RUST_READERS_ENGINE";

/* Предел ожидания ответа: читающие команды идут секунды; зависшая не держит поток дольше. */
const TIMEOUT_MS = 3 * 60 * 1000;
/* Предел размера ответа в байтах: база эффектов — десятки мегабайт, запас в разы. */
const OUTPUT_LIMIT = 512 * 1024 * 1024;

/** Файл движка: названный окружением или найденный по расположению приложения; нет — `null`. */
export function engineExecutable(context, env = process.env) {
  const given = String(env?.[READERS_ENGINE_VARIABLE] ?? "").trim();
  if (given) return fs.existsSync(given) ? given : null;
  return resolveRustExecutable(context ?? {});
}

/** Ответ движка из его вывода: последняя строка вида `{ ok, result }`; отказ — ошибкой с кодом движка. */
export function parseEngineAnswer(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    let parsed;
    try {
      parsed = JSON.parse(lines[at]);
    } catch {
      continue;
    }
    if (typeof parsed?.ok !== "boolean") continue;
    if (parsed.ok) return parsed.result;
    const failure = new Error(parsed.error?.message || "Движок отказал.");
    if (parsed.error?.code) failure.code = parsed.error.code;
    throw failure;
  }
  throw new Error("Движок не вернул ответ.");
}

/** Запускает движок с аргументами и отдаёт разобранный ответ; обрыв, превышение срока и размера — отказом. */
export function runEngine(executable, args, { timeoutMs = TIMEOUT_MS, limit = OUTPUT_LIMIT, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    let size = 0;
    let failure = null;
    const fail = (error) => {
      if (failure) return;
      failure = error;
      child.kill();
    };
    const timer = setTimeout(() => fail(Object.assign(new Error("Движок не ответил вовремя."), { code: "ENGINE_TIMEOUT" })), timeoutMs);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) fail(Object.assign(new Error("Ответ движка слишком велик."), { code: "ENGINE_OUTPUT_LIMIT" }));
      else chunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try {
        resolve(parseEngineAnswer(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}
