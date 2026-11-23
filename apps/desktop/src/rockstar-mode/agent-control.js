/*
 * Канал управления агентом режима Rockstar (05.11.2026): именованный канал
 * (Windows) или сокет в временной папке (тесты на macOS и Linux). Он же —
 * замок единственного экземпляра: кто занял имя, тот и агент.
 *
 * Запрос — одна строка JSON `{ "cmd": "…" }`, ответ — одна строка JSON и
 * закрытие. Команды: `ping`, `status`, `stop` (агент выходит, файлы игры не
 * трогает), `arm-now`, `disarm-now` (ручные способы).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const AGENT_PIPE_ENV = "ASTRAL_ROCKSTAR_AGENT_PIPE";

export function agentPipeName(env = process.env, { platform = process.platform, user = () => os.userInfo().username } = {}) {
  if (env[AGENT_PIPE_ENV]) return env[AGENT_PIPE_ENV];
  const id = createHash("sha1").update(String(user()).toLowerCase()).digest("hex").slice(0, 12);
  return platform === "win32" ? `\\\\.\\pipe\\astral-rockstar-agent-${id}` : path.join(os.tmpdir(), `astral-rockstar-agent-${id}.sock`);
}

/**
 * Занять канал и отвечать на команды. Имя занято живым агентом — ошибка с
 * кодом `EADDRINUSE`. `handle(command)` возвращает ответ (или обещание).
 */
export function serveAgentControl({ name = agentPipeName(), handle }) {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      let command = null;
      try {
        command = JSON.parse(buffer.slice(0, end));
      } catch {
        return void socket.end(`${JSON.stringify({ ok: false, error: "bad-request" })}\n`);
      }
      buffer = "";
      Promise.resolve()
        .then(() => handle(command || {}))
        .then(
          (answer) => socket.end(`${JSON.stringify({ ok: true, ...answer })}\n`),
          (error) => socket.end(`${JSON.stringify({ ok: false, error: String(error?.code || error?.message || error) })}\n`),
        );
    });
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(name, () => {
        server.off("error", reject);
        resolve({ name, close: () => new Promise((done) => server.close(() => done())) });
      });
    });
  return listen().catch(async (error) => {
    /* Сокет мёртвого агента остаётся файлом (не Windows): живого за ним нет — файл убираем. */
    if (error?.code === "EADDRINUSE" && process.platform !== "win32" && !(await askAgent({ cmd: "ping" }, { name, timeoutMs: 300 }))) {
      fs.rmSync(name, { force: true });
      return listen();
    }
    throw error;
  });
}

/** Спросить агента. Ответ или `null`, если агента нет (канал не открывается, молчит). */
export function askAgent(command, { name = agentPipeName(), timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(name);
    let buffer = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on("connect", () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        finish(JSON.parse(buffer.slice(0, end)));
      } catch {
        finish(null);
      }
    });
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
  });
}
