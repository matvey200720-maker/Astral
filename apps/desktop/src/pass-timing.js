import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PASS_SECONDS = 40;

const FILE_NAME = "uninstall-timing.json";
const SECONDS_RANGE = [3, 600];
const BLEND = { stored: 0.6, fresh: 0.4 };

const bound = (value, [low, high]) => Math.max(low, Math.min(high, value));

// Годное прежнее значение — объект с конечным passSeconds; всё прочее считается отсутствием.
const toStoredTiming = (parsed) => (Number.isFinite(parsed?.passSeconds) ? parsed : null);

// Замер годен, если проходов не меньше одного и секунд больше нуля.
// Сравнения без ручного приведения: строки и массивы с числом читаются числами.
const isUsableSample = (seconds, passes) => passes >= 1 && seconds > 0;

// Свёртка двух слагаемых с весами: старая оценка × 0,6 + новый замер × 0,4.
const blend = (storedSeconds, freshSeconds) =>
  [
    [storedSeconds, BLEND.stored],
    [freshSeconds, BLEND.fresh],
  ].reduce((total, [seconds, weight]) => total + seconds * weight, 0);

// Запускает fn сразу; исключение, брошенное синхронно, становится отказом обещания.
const attempt = (fn) => new Promise((resolve) => resolve(fn()));

// Файл замеров в папке состояния.
class TimingFile {
  constructor(dir) {
    this.dir = dir;
  }

  // Для нестроковой папки склейка бросает TypeError.
  get location() {
    return path.join(this.dir, FILE_NAME);
  }

  load() {
    if (!this.dir) {
      return Promise.resolve(null);
    }
    return attempt(() => fs.readFile(this.location, "utf8"))
      .then((text) => toStoredTiming(JSON.parse(text)))
      .catch(() => null);
  }

  // Временный файл рядом, затем подмена; при любом сбое временный файл удаляется. Отдаёт, удалась ли запись.
  async save(record) {
    const target = this.location;
    const temp = `${target}.${randomUUID()}.tmp`;
    const replaced = await attempt(() => fs.mkdir(this.dir, { recursive: true }))
      .then(() => fs.writeFile(temp, JSON.stringify(record), "utf8"))
      .then(() => fs.rename(temp, target))
      .then(
        () => true,
        () => false,
      );
    if (!replaced) {
      await attempt(() => fs.rm(temp, { force: true })).catch(() => {});
    }
    return replaced;
  }
}

export async function readPassSeconds(stateDir) {
  const stored = await new TimingFile(stateDir).load();
  return stored ? stored.passSeconds : DEFAULT_PASS_SECONDS;
}

export async function recordPassTiming(stateDir, { seconds, passes }) {
  if (!stateDir || !isUsableSample(seconds, passes)) {
    return null;
  }
  const sample = bound(seconds / passes, SECONDS_RANGE);

  const file = new TimingFile(stateDir);
  const stored = await file.load();
  const estimate = stored ? bound(blend(stored.passSeconds, sample), SECONDS_RANGE) : sample;
  const samples = (stored?.samples || 0) + 1;

  const written = await file.save({ passSeconds: estimate, samples });
  return written ? estimate : null;
}
