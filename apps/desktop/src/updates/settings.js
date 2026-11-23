import { writeFileAtomic } from "../atomic-file.js";
import path from "node:path";
import { readFileSync } from "node:fs";

const FILE_NAME = "updates.json";
const NOT_READ = "настройки обновлений не прочитаны: ";
const NOT_WRITTEN = "настройки обновлений не записаны: ";
// Коды ошибок чтения, о которых молчим: файла (или папки) просто нет.
const SILENT_CODES = new Set(["ENOENT"]);

export const DEFAULT_UPDATE_SETTINGS = Object.freeze({ autoDownload: true });

// Чистая функция «текст файла → значение настроек или null»: берётся только булево поле.
function settingsFromText(text) {
  const parsed = JSON.parse(text);
  return parsed && typeof parsed.autoDownload === "boolean" ? { autoDownload: parsed.autoDownload } : null;
}

// Выполняет работу и отдаёт либо результат, либо перехваченную причину отказа.
function attempt(job) {
  try {
    return { done: true, value: job() };
  } catch (failure) {
    return { done: false, failure };
  }
}

function reportUnreadable(failure, log) {
  if (!SILENT_CODES.has(failure.code)) {
    log(`${NOT_READ}${failure.message}`);
  }
}

function recall(file, log) {
  const outcome = attempt(() => settingsFromText(readFileSync(file, "utf8")));
  if (!outcome.done) {
    reportUnreadable(outcome.failure, log);
    return { ...DEFAULT_UPDATE_SETTINGS };
  }
  return outcome.value ?? { ...DEFAULT_UPDATE_SETTINGS };
}

// Живое значение хранилища и очередь его записей на диск (по одной, в порядке вызовов).
class Holder {
  constructor(file, log, value) {
    this.file = file;
    this.log = log;
    this.value = value;
    this.tail = Promise.resolve();
  }

  change(patch) {
    const next = { ...this.value };
    if (typeof patch?.autoDownload === "boolean") {
      next.autoDownload = patch.autoDownload;
    }
    this.value = next;
    this.enqueue(JSON.stringify(next) + "\n");
  }

  // Очередь — цепочка: запись после предыдущей, отказ записи уходит в журнал и очередь живёт дальше.
  enqueue(body) {
    const { file, log } = this;
    const steps = [
      ["then", () => writeFileAtomic(file, body)],
      ["catch", (failure) => log(`${NOT_WRITTEN}${failure.message}`)],
    ];
    this.tail = steps.reduce((promise, [method, handler]) => promise[method](handler), this.tail);
  }
}

export function createSettingsStore(directory, { log = () => {} } = {}) {
  const file = path.join(directory, FILE_NAME);
  const holder = new Holder(file, log, recall(file, log));
  return {
    get: () => holder.value,
    set(patch) {
      holder.change(patch);
    },
    flush: () => holder.tail,
  };
}
