// apps/desktop/src/app-log.js
// Локальный журнал приложения: запись на диск с чисткой следов человека,
// журнал-одиночка на процесс, обёртка IPC-каналов «Нового движка», IPC вкладки «Логи».

import { scrubText } from "@modovik/contracts/app-errors";
import { isCancellation } from "./operation-cancel.js";
import { routeSummary, withRouteSession } from "./rust-routes.js";
import { workerCensusLine } from "./worker-census.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_LOG_FILE = "app-log.jsonl";

export const APP_LOG_LIMITS = Object.freeze({
  fileBytes: 1048576,
  keepLines: 1500,
  message: 1200,
  detail: 4000,
  recent: 500,
  sourceLines: 200,
  sourceBytes: 40960,
  repeatMs: 60000,
  kind: 32,
  dataBytes: 12288,
  exportBytes: 1048576,
});

export const APP_LOG_LEVELS = Object.freeze(["error", "warn", "info"]);

/*
 * Виды структурных записей, которые окно вправе писать само (`APP_LOG_WRITE` с `kind` и `data`). Остальные виды — только
 * главный процесс (`game-crash`): окно не должно подделывать журнал падений. «Сверка с игрой» (ТЗ H1, 14.11.2026) — запись
 * `hud-reconcile` после каждого «Применить» экрана игры.
 */
export const APP_LOG_WINDOW_KINDS = Object.freeze(["hud-reconcile"]);

export const EXPECTED_REFUSAL_CODES = Object.freeze(
  new Set(["GAME_ITEM_SHOT", "CLOTHING_PLACEHOLDER", "ANIMATION_EMPTY", "CLOTHING_REPLACE_MAJESTIC_PACK", "PROJECT_OFFLINE"])
);

const SOURCE_FIELD_CAP = 32;
const REPLAY_BACKLOG_CAP = 200;
const PLATFORM_NAMES = new Map([
  ["win32", "Windows"],
  ["darwin", "macOS"],
  ["linux", "Linux"],
]);

// Текст как шаблон регулярного выражения: спецсимволы экранируются по одному.
const SPECIAL_CHARS = new Set(".*+?^${}()|[]\\");
const literalPattern = (text) => [...text].map((ch) => (SPECIAL_CHARS.has(ch) ? `\\${ch}` : ch)).join("");

// Пять написаний пути: как есть, с прямыми, с обратными, с удвоенными обратными косыми, как адрес.
function spellingsOf(root) {
  const slashed = root.split("\\").join("/");
  const backslashed = root.split("/").join("\\");
  return [root, slashed, backslashed, backslashed.split("\\").join("\\\\"), encodeURI(slashed)];
}

export function createScrubber(settings = {}) {
  const home = settings.home === undefined ? os.homedir() : settings.home;
  const username = settings.username === undefined ? "" : settings.username;
  const extraPaths = settings.extraPaths === undefined ? [] : settings.extraPaths;
  const roots = [...extraPaths, home]
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item).trim())
    .filter((item) => item.length > 3);
  const matchers = [...new Set(roots.flatMap(spellingsOf))]
    .sort((a, b) => b.length - a.length)
    .map((spelling) => new RegExp(literalPattern(spelling), "gi"));

  const alias = String(username ?? "").trim();
  const aliasMatcher = alias.length >= 3 ? new RegExp(`\\b${literalPattern(alias)}\\b`, "gi") : null;

  return (value, limit) => {
    const start = value === null || value === undefined ? "" : String(value);
    const masked = matchers.reduce((text, matcher) => text.replace(matcher, "~"), start);
    const cleaned = scrubText(masked, limit === undefined ? 3000 : limit);
    return aliasMatcher ? cleaned.replace(aliasMatcher, "<user>") : cleaned;
  };
}

const errorText = (err) => (err && err.message ? err.message : String(err));

// Журнал на диске: записи в памяти, очередь на запись, предел файла, чужие источники.
class DiskJournal {
  #file;
  #disk;
  #now;
  #limits;
  #flushMs;
  #scrub;
  #platform;
  #release;
  #appVersion;
  #entries = [];
  #nextN = 1;
  #bytes = 0;
  #lastBirth = -Infinity;
  #pending = [];
  #timer = null;
  #flushing = false;
  #sources = new Map();

  constructor(options) {
    const pick = (key, fallback) => (options[key] === undefined ? fallback : options[key]);
    this.#file = path.join(options.userData, APP_LOG_FILE);
    this.#disk = pick("fsImpl", fs);
    this.#now = pick("now", Date.now);
    this.#limits = { ...APP_LOG_LIMITS, ...pick("limits", {}) };
    this.#flushMs = this.#limits.flushMs ?? 250;
    this.#platform = pick("platform", process.platform);
    this.#release = pick("release", os.release());
    this.#appVersion = pick("appVersion", "");

    let account = pick("username", "");
    if (!account) {
      try {
        account = os.userInfo().username || "";
      } catch {
        account = "";
      }
    }
    this.#scrub = createScrubber({ home: pick("home", os.homedir()), username: account });
    this.#restore();
  }

  get file() {
    return this.#file;
  }

  // Жр-1: последние годные строки файла, следующий номер, стартовый размер.
  #restore() {
    let text;
    try {
      text = this.#disk.readFileSync(this.#file, "utf8");
      this.#bytes = this.#disk.statSync(this.#file).size;
    } catch {
      return;
    }
    const usable = [];
    let maxN = 0;
    for (const line of text.split(/\r\n|\n/)) {
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const wellFormed =
        parsed && typeof parsed.t === "string" && APP_LOG_LEVELS.includes(parsed.level) && typeof parsed.message === "string";
      if (!wellFormed) continue;
      if (Number.isInteger(parsed.n)) maxN = Math.max(maxN, parsed.n);
      usable.push(parsed);
    }
    this.#entries = usable.slice(-this.#limits.recent);
    this.#nextN = maxN + 1;
  }

  #trimIfHuge() {
    if (this.#bytes <= this.#limits.fileBytes) return;
    this.#bytes = 0;
    try {
      const rows = this.#disk.readFileSync(this.#file, "utf8").split(/\r\n|\n/).filter((row) => row.length > 0);
      const kept = rows.slice(-this.#limits.keepLines);
      this.#disk.writeFileSync(this.#file, kept.length ? `${kept.join("\n")}\n` : "");
    } catch {
      // обрезка не удалась — файл остаётся длинным
    }
  }

  #writeSync(lines) {
    const chunk = lines.join("");
    try {
      this.#disk.mkdirSync(path.dirname(this.#file), { recursive: true });
      this.#disk.appendFileSync(this.#file, chunk);
      this.#bytes += Buffer.byteLength(chunk, "utf8");
      this.#trimIfHuge();
    } catch {
      // ошибка диска молчит: записи остаются в памяти этого запуска
    }
  }

  async #writeBackground(lines) {
    const chunk = lines.join("");
    const promised = this.#disk.promises;
    try {
      if (promised?.mkdir) await promised.mkdir(path.dirname(this.#file), { recursive: true });
      else this.#disk.mkdirSync(path.dirname(this.#file), { recursive: true });
      if (promised?.appendFile) await promised.appendFile(this.#file, chunk);
      else this.#disk.appendFileSync(this.#file, chunk);
      this.#bytes += Buffer.byteLength(chunk, "utf8");
      this.#trimIfHuge();
    } catch {
      // ошибка диска молчит
    }
  }

  #armTimer() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#startBackgroundBatch();
    }, this.#flushMs);
    this.#timer.unref?.();
  }

  #startBackgroundBatch() {
    if (this.#flushing || this.#pending.length === 0) return;
    this.#flushing = true;
    const batch = this.#pending;
    this.#pending = [];
    this.#writeBackground(batch).then(() => {
      this.#flushing = false;
      if (this.#pending.length > 0) this.#armTimer();
    });
  }

  flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#pending.length === 0) return;
    const batch = this.#pending;
    this.#pending = [];
    this.#writeSync(batch);
  }

  #field(value, fallback, cap) {
    const raw = value === undefined || value === null ? "" : String(value);
    return raw === "" ? fallback : this.#scrub(raw, cap);
  }

  /* Структурные данные записи: JSON, каждая строка вычищена, весь объём не больше `dataBytes`; не влезло — не пишется. */
  #structured(value) {
    if (value === undefined || value === null || typeof value !== "object") return undefined;
    try {
      const cleaned = JSON.parse(JSON.stringify(value), (_key, item) => (typeof item === "string" ? this.#scrub(item, this.#limits.detail) : item));
      return Buffer.byteLength(JSON.stringify(cleaned), "utf8") <= this.#limits.dataBytes ? cleaned : undefined;
    } catch {
      return undefined;
    }
  }

  record(input = {}) {
    const read = (key, fallback) => (input[key] === undefined ? fallback : input[key]);
    const level = read("level", "info");
    const source = read("source", "app");
    const message = read("message", "");
    const detail = read("detail", "");
    // Номер берётся сразу: склеенный повтор тоже расходует номер.
    const n = this.#nextN++;
    const entryLevel = APP_LOG_LEVELS.includes(level) ? level : "info";
    const entrySource = this.#field(source, "app", SOURCE_FIELD_CAP);
    const entryMessage = this.#field(message, "—", this.#limits.message);
    const entryDetail = detail ? this.#scrub(String(detail), this.#limits.detail) : undefined;
    const entryKind = typeof input.kind === "string" && input.kind ? input.kind.replace(/[^a-z0-9._-]/gi, "").slice(0, this.#limits.kind) : "";
    const entryData = entryKind ? this.#structured(input.data) : undefined;

    const moment = this.#now();
    const previous = this.#entries.at(-1);
    /* Структурные записи (`kind`) не склеиваются: у каждой свои данные, а счётчик «×2» их бы выбросил. */
    const sameSeries =
      !entryKind &&
      previous &&
      previous.level === entryLevel &&
      previous.source === entrySource &&
      previous.message === entryMessage &&
      moment - this.#lastBirth < this.#limits.repeatMs;
    if (sameSeries) {
      previous.count = (previous.count || 1) + 1;
      return previous;
    }

    const entry = { n, t: new Date(moment).toISOString(), level: entryLevel, source: entrySource, message: entryMessage };
    if (entryDetail !== undefined) entry.detail = entryDetail;
    /* Запись с видом (`kind`) — структурная: окно и отчёт читают её поля, а не разбирают сообщение (журнал падений игры). */
    if (entryKind) entry.kind = entryKind;
    if (entryData !== undefined) entry.data = entryData;
    this.#lastBirth = moment;

    this.#entries.push(entry);
    if (this.#entries.length > this.#limits.recent) this.#entries.shift();

    this.#pending.push(`${JSON.stringify(entry)}\n`);
    if (entryLevel === "error") this.flush();
    else this.#armTimer();
    return entry;
  }

  recent(query = {}) {
    const limit = query.limit === undefined ? 500 : query.limit;
    const level = query.level === undefined ? "" : query.level;
    const pool = APP_LOG_LEVELS.includes(level) ? this.#entries.filter((e) => e.level === level) : this.#entries;
    const asked = Number(limit);
    const usable = Number.isFinite(asked) && asked !== 0 ? asked : 500;
    const take = usable < 0 ? 1 : Math.min(usable, 500);
    return pool.slice(-take).map((e) => ({ ...e }));
  }

  clear() {
    this.#entries = [];
    this.#bytes = 0;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = [];
    try {
      this.#disk.rmSync(this.#file, { force: true });
    } catch {
      // ошибка стирания молчит
    }
    return { cleared: true };
  }

  registerSource({ id, label, read } = {}) {
    if (id === undefined || id === null || typeof read !== "function") return () => {};
    const key = String(id);
    if (key === "") return () => {};
    this.#sources.set(key, { label: label ? String(label) : key, read });
    return () => {
      this.#sources.delete(key);
    };
  }

  listSources() {
    return [...this.#sources].map(([id, source]) => ({ id, label: source.label }));
  }

  async #readSource(read) {
    let text;
    try {
      text = await read();
    } catch (err) {
      return `(не прочитать: ${this.#scrub(errorText(err), 200)})`;
    }
    const asText = text === null || text === undefined ? "" : String(text);
    const tail = asText.split(/\r\n|\n/).slice(-this.#limits.sourceLines).join("\n").slice(-this.#limits.sourceBytes);
    return this.#scrub(tail, this.#limits.sourceBytes) || "(пусто)";
  }

  async buildExport() {
    const stamp = new Date(this.#now()).toISOString();
    const system = PLATFORM_NAMES.get(this.#platform) ?? String(this.#platform);
    const blocks = this.#entries.map((e) => ({
      crash: e.kind === "game-crash",
      text: [
        `${e.t} [${e.level}] [${e.source}] ${e.message}${e.count > 1 ? ` (×${e.count})` : ""}`,
        ...(e.detail ? e.detail.split(/\r\n|\n/).map((row) => `    ${row}`) : []),
      ].join("\n"),
    }));

    const sourceLines = [];
    for (const { label, read } of this.#sources.values()) {
      sourceLines.push("", `== Источник: ${label} ==`, await this.#readSource(read));
    }
    const head = [
      "Astral — журнал приложения",
      `Версия: ${this.#appVersion || "—"} · ${system} ${this.#release}`,
      `Выгружено: ${stamp}`,
      "Пути и имя пользователя заменены на «~» и «<user>», токены и адреса вычищены.",
      "",
    ];

    /* Предел всей выгрузки: источники режутся каждый по своему пределу выше, события — здесь. Записи о падениях игры
       (`kind: "game-crash"`, не больше десяти последних) остаются всегда, прочие берутся от новых к старым, пока влезают. */
    const bytes = (text) => Buffer.byteLength(text, "utf8") + 1;
    const fixed = bytes(head.join("\n")) + bytes(sourceLines.join("\n")) + 120;
    let room = Math.max(0, this.#limits.exportBytes - fixed);
    const keep = new Set();
    /* Падения игры резервируются первыми (иначе шум, записанный позже, съел бы место), потом остальное — от новых к старым. */
    let crashes = 0;
    for (let at = blocks.length - 1; at >= 0 && crashes < 10; at -= 1) {
      if (!blocks[at].crash) continue;
      crashes += 1;
      keep.add(at);
      room -= bytes(blocks[at].text);
    }
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const size = bytes(blocks[at].text);
      if (!blocks[at].crash && size <= room) {
        keep.add(at);
        room -= size;
      }
    }
    const shown = blocks.filter((_, at) => keep.has(at));
    const omitted = blocks.length - shown.length;
    const lines = [
      ...head,
      `== События (${shown.length}${omitted ? ` из ${blocks.length}: старые опущены, предел размера файла` : ""}) ==`,
      ...shown.map((block) => block.text),
      ...sourceLines,
    ];
    return { fileName: `astral-log-${stamp.slice(0, 10)}.txt`, text: `${lines.join("\n")}\n` };
  }

  install(target = process) {
    const crash = (message, cause) =>
      this.record({ level: "error", source: "main", message, detail: cause && cause.stack ? cause.stack : "" });
    target.on("exit", () => this.flush());
    target.on("uncaughtExceptionMonitor", (error, origin) => {
      const kind = origin === "unhandledRejection" ? "необработанный отказ" : "исключение";
      crash(`Падение приложения (${kind}): ${errorText(error)}`, error);
    });
    target.on("unhandledRejection", (reason) => {
      crash(`Необработанный отказ: ${errorText(reason)}`, reason);
    });
  }
}

export function createAppLog(options = {}) {
  const journal = new DiskJournal(options);
  return {
    file: journal.file,
    record: (entry) => journal.record(entry),
    flush: () => journal.flush(),
    recent: (query) => journal.recent(query),
    clear: () => journal.clear(),
    registerSource: (source) => journal.registerSource(source),
    listSources: () => journal.listSources(),
    buildExport: () => journal.buildExport(),
    install: (target) => journal.install(target),
  };
}

// ---- appLog: журнал-одиночка на процесс (до start записи копятся в очереди) ----
const processLog = { journal: null, backlog: [] };

// Методы — обычные перезаписываемые поля (game-read-worker подменяет record пересылкой в главный
// процесс); current только для чтения. Внутренние вызовы идут через этот же объект.
export const appLog = Object.defineProperties(
  {},
  {
    start: {
      enumerable: true,
      writable: true,
      configurable: true,
      value(options = {}) {
        if (processLog.journal) return processLog.journal;
        const fresh = createAppLog(options);
        processLog.journal = fresh;
        for (const entry of processLog.backlog.splice(0)) fresh.record(entry);
        return fresh;
      },
    },
    record: {
      enumerable: true,
      writable: true,
      configurable: true,
      value(entry) {
        if (processLog.journal) return processLog.journal.record(entry);
        if (processLog.backlog.length < REPLAY_BACKLOG_CAP) processLog.backlog.push(entry);
        return null;
      },
    },
    registerSource: {
      enumerable: true,
      writable: true,
      configurable: true,
      value: (source) => (processLog.journal ? processLog.journal.registerSource(source) : () => {}),
    },
    current: {
      enumerable: true,
      get: () => processLog.journal,
    },
    reset: {
      enumerable: true,
      writable: true,
      configurable: true,
      value() {
        processLog.journal = null;
        processLog.backlog = [];
      },
    },
  }
);

// ---- метка «приложение выходит» ----
const exitMark = { set: false };
export const noteAppLeaving = () => {
  exitMark.set = true;
};
export const appIsLeaving = () => exitMark.set;
export const forgetAppLeaving = () => {
  exitMark.set = false;
};

// ---- observeIpc: обёртка IPC-обработчиков «Нового движка» ----
/* `reinstall` — «Установить снова» (`library-reinstall`): слово целиком, поэтому от `install` его не отличить без своей записи. */
const TRACK_PHRASES = ["apply", "install", "reinstall", "rollback", "remove", "restore", "uninstall", "reset-target", "retire"];
const QUIET_PHRASES = ["progress", "capabilities", "installed", "restore-points", "list"];

const bareName = (channel) => String(channel).replace(/^[A-Za-z]+:/, "");

function hasPhrase(words, phrase) {
  const parts = phrase.split("-");
  return words.some((_word, at) => parts.every((part, offset) => words[at + offset] === part));
}

function isTracked(name) {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return TRACK_PHRASES.some((p) => hasPhrase(words, p)) && !QUIET_PHRASES.some((p) => hasPhrase(words, p));
}

// Результат с собственной функцией then (настоящее обещание или самодельный thenable)
// обрабатывается одним его вызовом then; наличие catch не важно.
const hasThen = (value) => value != null && typeof value.then === "function";

const secondsText = (ms) => (ms / 1000).toFixed(1).replace(".", ",");

function noteWorkers(trail) {
  trail.log.record({ level: "info", source: "workers", message: `после ${trail.name}: потоки ${workerCensusLine()}` });
}

function noteSuccess(trail) {
  if (!trail.tracked) return;
  const spent = Math.max(0, trail.clock() - trail.startedAt);
  const paths = routeSummary(trail.session);
  /* Пустое чтение под словом install не пишется. */
  if (trail.name === "install-profile" && !paths && spent < 50) return;
  const message = `${trail.name}: готово за ${secondsText(spent)} с${paths ? ` · ${paths}` : ""}`;
  trail.log.record({ level: "info", source: "install", message });
  noteWorkers(trail);
}

function noteFailure(trail, err) {
  const code = err?.code;
  const expected = typeof code === "string" && EXPECTED_REFUSAL_CODES.has(code);
  const exiting = !expected && trail.leaving();
  /* Отмена — не сбой (журнал 17.11.2026: отмена окна шла `[error]` со стеком, как падение): событие без стека. Выход из приложения называется точнее и важнее. */
  const cancelled = !expected && !exiting && isCancellation(err);
  const text = errorText(err);
  const paths = trail.tracked ? routeSummary(trail.session) : "";
  const suffix = paths ? ` · ${paths}` : "";

  const message = exiting
    ? `${trail.name}: прервано выходом из приложения — ${text}${suffix}`
    : cancelled
      ? `${trail.name}: отменено${suffix}`
      : `${trail.name}: ${text}${expected ? ` (${code})` : ""}${suffix}`;
  const level = expected ? "warn" : exiting || cancelled ? "info" : "error";
  const stack = expected || exiting || cancelled ? "" : err && err.stack ? err.stack : "";

  trail.log.record({ level, source: trail.tracked ? "install" : "ipc", message, detail: stack });
  if (trail.tracked) noteWorkers(trail);
}

export function observeIpc(channel, handler, settings = {}) {
  const pick = (key, fallback) => (settings[key] === undefined ? fallback : settings[key]);
  const log = pick("log", appLog);
  const clock = pick("clock", Date.now);
  const leaving = pick("leaving", appIsLeaving);
  const name = bareName(channel);
  const tracked = isTracked(name);

  return (...args) => {
    const trail = { name, tracked, log, clock, leaving, startedAt: clock(), session: null };
    const run = tracked
      ? () =>
          withRouteSession((session) => {
            trail.session = session;
            return handler(...args);
          })
      : () => handler(...args);

    let outcome;
    try {
      outcome = run();
    } catch (err) {
      noteFailure(trail, err);
      throw err;
    }
    if (!hasThen(outcome)) {
      noteSuccess(trail);
      return outcome;
    }
    return outcome.then(
      (value) => {
        noteSuccess(trail);
        return value;
      },
      (err) => {
        noteFailure(trail, err);
        throw err;
      }
    );
  };
}

// ---- registerAppLogIpc: каналы IPC вкладки «Логи» ----
const clip = (value, fallback, cap) => String(value || fallback).slice(0, cap);

export function registerAppLogIpc(wiring) {
  const { IPC, handleIpc, trusted, showSaveDialog } = wiring;
  const log = wiring.log === undefined ? appLog : wiring.log;
  const writeFile = wiring.writeFile === undefined ? fs.promises.writeFile : wiring.writeFile;
  const journal = () => {
    const current = log.current;
    if (!current) throw new Error("Журнал ещё не запущен.");
    return current;
  };

  const channels = [
    [
      "APP_LOG_LIST",
      (input) => {
        const current = journal();
        return {
          entries: current.recent({ limit: input?.limit, level: input?.level }),
          sources: current.listSources(),
          file: path.basename(current.file),
        };
      },
    ],
    [
      "APP_LOG_WRITE",
      (input) => {
        const current = journal();
        const level = APP_LOG_LEVELS.includes(input?.level) ? input.level : "info";
        current.record({
          level,
          source: clip(input?.source, "window", SOURCE_FIELD_CAP),
          message: clip(input?.message, "", 2000),
          detail: clip(input?.detail, "", 8000),
          ...(APP_LOG_WINDOW_KINDS.includes(input?.kind) ? { kind: input.kind, data: input.data } : {}),
        });
        return { ok: true };
      },
    ],
    ["APP_LOG_CLEAR", () => journal().clear()],
    [
      "APP_LOG_EXPORT",
      async () => {
        const { fileName, text } = await journal().buildExport();
        if (typeof showSaveDialog !== "function") return { saved: false, text };

        const picked = await showSaveDialog({
          title: "Сохранить журнал Astral",
          defaultPath: fileName,
          filters: [{ name: "Текст", extensions: ["txt"] }],
        });
        if (picked.canceled || !picked.filePath) return { saved: false, canceled: true };

        await writeFile(picked.filePath, text, "utf8");
        return { saved: true, fileName: picked.filePath.split(/[\\/]/).pop() };
      },
    ],
  ];

  for (const [name, work] of channels) {
    handleIpc(IPC[name], (event, input) => trusted(event, () => work(input)));
  }
}
