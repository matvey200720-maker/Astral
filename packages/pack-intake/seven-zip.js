import path from "node:path";
import { fileURLToPath } from "node:url";
import childProcess from "node:child_process";
import { hasEncryptedHeaders } from "./archive-encryption.js";
import { parseSevenZipListing } from "./listing.js";

const PROCESS_SCRIPT = fileURLToPath(new URL("./seven-zip-process.js", import.meta.url));
const FORK_OPTIONS = { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] };
const STUB_PASSWORD_ARGUMENT = "-pastral-no-password";
const STDERR_LIMIT = 16384;
const PASSWORD_PATTERN = /wrong password|encrypted/i;
const UNKNOWN_FORMAT = "7-Zip не узнал формат";
const CRASHED_REASON = "7-Zip не смог открыть архив";

// Первая совпавшая строка побеждает.
const REASONS = [
  {
    pattern: /cannot open the file as archive|can not open|is not archive/i,
    text: "7-Zip не узнал формат — возможно, скачалась страница, а не архив",
  },
  {
    pattern: /unexpected end of (archive|data)|truncated|headers error/i,
    text: "архив обрезан — скачался не до конца",
  },
  { pattern: /crc failed|data error|checksum/i, text: "данные архива повреждены" },
  { pattern: /unsupported (method|compression)/i, text: "архив сжат способом, который 7-Zip не знает" },
  { pattern: /not enough (memory|space)|no space/i, text: "не хватило места или памяти" },
];

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const passwordArgument = (password) => (password ? `-p${password}` : STUB_PASSWORD_ARGUMENT);

// Служебные приставки и пути /in, /out из строки stderr убираются.
const NOISE_CLEANERS = [
  [/^ERROR:\s*/i, ""],
  [/\/(?:in|out)\/[^:]*:?/g, ""],
];

const stripServiceNoise = (line) =>
  NOISE_CLEANERS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), line).trim();

function humanReason({ crashed, err }) {
  if (crashed) return CRASHED_REASON;
  const text = err.join("\n");
  const known = REASONS.find(({ pattern }) => pattern.test(text));
  if (known) return known.text;
  return err.map(stripServiceNoise).find(Boolean) ?? "";
}

class SevenZipCall {
  constructor(file, signal, timeoutMs) {
    this.name = path.basename(file);
    this.folder = path.dirname(file);
    this.signal = signal;
    this.timeoutMs = timeoutMs;
  }

  abortReason() {
    return this.signal.reason || refusal("PACK_ABORTED", "Разбор остановлен.");
  }

  timeoutRefusal() {
    const minutes = Math.max(1, Math.round(this.timeoutMs / 60000));
    return refusal(
      "PACK_ARCHIVE_TIMEOUT",
      `Архив «${this.name}» не открылся за ${minutes} мин — 7-Zip остановлен. Такой архив не принимается.`,
    );
  }

  run(args, mounts) {
    return new Promise((resolve, reject) => {
      if (this.signal?.aborted) {
        reject(this.abortReason());
        return;
      }
      const child = childProcess.fork(PROCESS_SCRIPT, [], FORK_OPTIONS);
      const state = { stderr: "", timer: undefined, done: false };
      const finish = (settle, value) => {
        if (state.done) return;
        state.done = true;
        clearTimeout(state.timer);
        this.signal?.removeEventListener("abort", onAbort);
        settle(value);
      };
      const onAbort = () => {
        finish(reject, this.abortReason());
        child.kill();
      };
      const noReply = (code, killedBy) => {
        const text = state.stderr.trim() || `процесс 7-Zip завершился без ответа (${killedBy || code})`;
        finish(resolve, { code: 255, out: [], err: [text], crashed: true });
      };

      child.stderr.on("data", (chunk) => {
        if (state.stderr.length < STDERR_LIMIT) state.stderr += chunk;
      });
      const listeners = [
        ["message", (reply) => finish(resolve, reply)],
        ["error", (error) => finish(reject, error)],
        ["close", noReply],
        ["exit", () => clearTimeout(state.timer)],
      ];
      for (const [event, listener] of listeners) child.once(event, listener);
      if (this.timeoutMs > 0) {
        state.timer = setTimeout(() => {
          finish(reject, this.timeoutRefusal());
          child.kill("SIGKILL");
        }, this.timeoutMs);
      }
      this.signal?.addEventListener("abort", onAbort, { once: true });
      child.send({ args, mounts });
    });
  }
}

function lockedRefusal(name, password, closedText) {
  if (password) return refusal("PACK_PASSWORD", `Пароль к архиву «${name}» не подошёл.`);
  return refusal("PACK_ARCHIVE_ENCRYPTED", closedText);
}

// Аргументы 7z: команда и её ключи, пароль (или заглушка), общие ключи, входной архив в /in.
const sevenZipArguments = (head, password, flags, call) => [
  ...head,
  passwordArgument(password),
  ...flags,
  `/in/${call.name}`,
];

export async function listArchive(file, { signal, timeoutMs = 0, password = null } = {}) {
  const call = new SevenZipCall(file, signal, timeoutMs);
  const args = sevenZipArguments(["l", "-slt"], password, ["-sccUTF-8"], call);
  const reply = await call.run(args, { "/in": call.folder });
  const listing = parseSevenZipListing(reply.out.join("\n"));
  if (reply.code === 0 && listing.type !== null) return listing;
  const locked = PASSWORD_PATTERN.test(reply.err.join("\n")) || (await hasEncryptedHeaders(file));
  if (locked) {
    throw lockedRefusal(
      call.name,
      password,
      `Архив «${call.name}» закрыт паролем — пароль к нему знает только автор.`,
    );
  }
  const reason = humanReason(reply) || UNKNOWN_FORMAT;
  throw refusal("PACK_ARCHIVE_BROKEN", `Архив «${call.name}» не читается: ${reason}.`);
}

export async function extractArchive(file, outputDirectory, { signal, timeoutMs = 0, password = null } = {}) {
  const call = new SevenZipCall(file, signal, timeoutMs);
  const args = sevenZipArguments(["x", "-y"], password, ["-sccUTF-8", "-bd", "-o/out"], call);
  const reply = await call.run(args, { "/in": call.folder, "/out": outputDirectory });
  if (reply.code === 0) return undefined;
  if (PASSWORD_PATTERN.test(reply.err.join("\n"))) {
    throw lockedRefusal(call.name, password, `Часть файлов архива «${call.name}» закрыта паролем.`);
  }
  const reason = humanReason(reply) || `код ${reply.code}`;
  throw refusal("PACK_ARCHIVE_BROKEN", `Архив «${call.name}» распаковался с ошибкой: ${reason}.`);
}
