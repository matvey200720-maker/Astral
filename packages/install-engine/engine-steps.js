// Звенья истории точек отката: движок называет свои операции над update.rpf
// и отдаёт их обработчику, который регистрирует приложение.
import { randomUUID } from "node:crypto";

const RECORDER_ERROR = "Запись звена истории должна быть функцией.";

const asFingerprint = (value) => String(value ?? "").toLowerCase();

// Пары, дающие одну склеенную строку, не различаются.
const identityOf = (bases, targetKey) => [bases, targetKey].map(String).join("::");

// Ожидающая операция: номер, отпечаток живого архива до правки, признак «основа переняла».
class LiveOperation {
  absorbed = false;

  constructor(before) {
    this.id = randomUUID();
    this.before = before;
  }
}

class OperationLedger {
  #open = new Map();

  // Тот же живой архив — прежний номер; иначе операция начинается заново.
  begin(bases, targetKey, before) {
    const identity = identityOf(bases, targetKey);
    const known = this.#open.get(identity);
    if (known?.before === before) return known.id;

    const fresh = new LiveOperation(before);
    this.#open.set(identity, fresh);
    return fresh.id;
  }

  absorb(bases, targetKey) {
    const operation = this.#open.get(identityOf(bases, targetKey));
    if (operation) operation.absorbed = true;
  }

  drop(bases, targetKey) {
    this.#open.delete(identityOf(bases, targetKey));
  }

  // Достаёт операцию и забывает её.
  take(bases, targetKey) {
    const identity = identityOf(bases, targetKey);
    const operation = this.#open.get(identity);
    this.#open.delete(identity);
    return operation;
  }
}

const ledger = new OperationLedger();
let recorder = null;

// Звено нужно, если архив изменился, основа переняла правку или менялся состав модов.
function deservesLink(operation, finalPrint, installed, removed) {
  if (operation.before !== finalPrint || operation.absorbed) return true;
  return installed.length !== 0 || removed.length !== 0;
}

async function deliver(record, link) {
  try {
    await record(link);
    return true;
  } catch {
    return false;
  }
}

export function setEngineStepRecorder(record = null) {
  if (record !== null && typeof record !== "function") throw new TypeError(RECORDER_ERROR);
  recorder = record;
}

export function noteLiveBefore({ bases, targetKey, sha256 }) {
  return ledger.begin(bases, targetKey, asFingerprint(sha256));
}

export function noteAbsorbed({ bases, targetKey }) {
  ledger.absorb(bases, targetKey);
}

export function dropLiveBefore({ bases, targetKey }) {
  ledger.drop(bases, targetKey);
}

export async function recordEngineStep({
  bases,
  targetKey,
  gameRoot,
  targetId,
  after,
  installed = [],
  removed = [],
}) {
  // Операция забывается при любом исходе, раньше, чем решается судьба звена.
  const operation = ledger.take(bases, targetKey);
  const record = recorder;
  if (!record || !operation?.before) return false;

  const finalPrint = asFingerprint(after);
  if (!finalPrint || !deservesLink(operation, finalPrint, installed, removed)) return false;

  return deliver(record, {
    gameRoot,
    targetId,
    before: operation.before,
    after: finalPrint,
    installed,
    removed,
    step: operation.id,
  });
}
