import { applyWorkshopWork, workshopInstallStatusOf } from "../install-queue/index.js";
import { readInstallRecord, rollbackInstallRecord } from "../useInstallRecord.js";
import { readWorkCode } from "../works/work-transfer.js";
import { WorkInstallUnsupported, prepareWorkInstall } from "./work-installers.js";
import { tr } from "../../../locales/ui.js";

const NO_DATA_TEXT = "в коде работы нет данных";
const LAYER_NAMES = ["world-map"];
// Причины отката, при которых работу отдельно не снять: архив пересобирали поверх неё.
const STUCK_REASONS = ["buried", "unknown", "foreign-archive", "missing", "game-updated"];
// Состояния очереди, при которых работу ставить заново не нужно.
const BUSY_STATES = ["running", "queued"];

const INSTALL_BUCKETS = ["queued", "already", "unsupported", "failed"];
const REMOVE_BUCKETS = ["removed", "notInstalled", "otherVersion", "unsupported", "stuck", "failed"];

// Работы-слои заново собирают архив движком, поэтому ставятся первыми, а снимаются последними.
export const LAYER_KINDS = Object.freeze(new Set(LAYER_NAMES));

export function installOrder(entries) {
  const rankOf = (entry) => (LAYER_KINDS.has(entry?.workKind) ? 0 : 1);
  return [...(entries || [])]
    .map((entry, at) => ({ entry, at, rank: rankOf(entry) }))
    .sort((left, right) => left.rank - right.rank || left.at - right.at)
    .map(({ entry }) => entry);
}

// Почему не вышло, по-человечески: сообщение, сама строка или запасное слово.
function failureText(error) {
  return error?.message || (error ? String(error) : tr("ошибка"));
}

const isUnsupported = (error) => error instanceof WorkInstallUnsupported;

// Таблицы отказов: первое подошедшее правило решает, в какую корзину попадёт причина.
const INSTALL_FAILURES = [
  [isUnsupported, "unsupported", (error) => error.reason],
  [() => true, "failed", failureText],
];
const REMOVE_FAILURES = [
  [isUnsupported, "unsupported", (error) => error.reason],
  [(error) => STUCK_REASONS.includes(error?.reason), "stuck", (error) => error.message],
  [() => true, "failed", failureText],
];

// Итог шага: в какую корзину и что туда положить.
const into = (bucket, payload) => ({ bucket, payload });

// Параметр, который не передан (undefined), заменяется; null остаётся как есть.
const optionOr = (options, name, fallback) => (options[name] === undefined ? fallback : options[name]);

// Ответ читателя кода превращается в шаблон нужного вида (а если такого нет, в первый).
async function templateOf(entry, read) {
  const answer = await read(entry.code);
  const templates = Array.isArray(answer?.templates) ? answer.templates : [];
  const found = templates.find((item) => item.kind === entry.workKind) ?? templates[0];
  if (!found) throw new Error(NO_DATA_TEXT);
  return found;
}

// Общий обходчик: работы идут по одной, шаг возвращает метку исхода, отказ раскладывает таблица правил.
async function tally(entries, bucketNames, step, failures) {
  const ledger = Object.fromEntries(bucketNames.map((name) => [name, []]));
  for (const entry of entries) {
    const verdict = await step(entry).catch((error) => {
      const [, bucket, reasonOf] = failures.find(([matches]) => matches(error));
      return into(bucket, { name: entry.name, reason: reasonOf(error) });
    });
    ledger[verdict.bucket].push(verdict.payload);
  }
  return ledger;
}

export async function installBuildWorks(entries, options = {}) {
  const apply = optionOr(options, "apply", applyWorkshopWork);
  const notify = optionOr(options, "notify", () => {});
  const read = optionOr(options, "read", readWorkCode);
  const errorsOnly = (text, tone) => {
    if (tone === "error") notify(text, tone);
  };

  const installOne = async (entry) => {
    const template = await templateOf(entry, read);
    const request = await prepareWorkInstall(entry.workKind, template, { entry });
    const { spec } = request;
    const standing = request.installedSignature(readInstallRecord(request.recordKey));

    if (typeof request.isCurrent === "function") {
      if (request.isCurrent()) return into("already", entry.name);
    } else if (standing && standing === spec.signature) {
      return into("already", entry.name);
    }

    if (request.enqueue) {
      const accepted = await request.enqueue({ notify: errorsOnly });
      return into(accepted ? "queued" : "already", entry.name);
    }

    if (BUSY_STATES.includes(workshopInstallStatusOf(spec.key, spec.signature))) {
      return into("already", entry.name);
    }

    const cover = entry.cover ? { catalogCover: entry.cover } : {};
    const started = await apply({ ...spec, ...cover, notify: errorsOnly });
    if (started) return into("queued", entry.name);
    return into("failed", { name: entry.name, reason: tr("не встала в очередь") });
  };

  return tally(installOrder(entries), INSTALL_BUCKETS, installOne, INSTALL_FAILURES);
}

export async function removeBuildWorks(entries, options = {}) {
  const read = optionOr(options, "read", readWorkCode);
  const rollback = optionOr(options, "rollback", rollbackInstallRecord);
  const rolledBack = new Set();

  const removeOne = async (entry) => {
    const template = await templateOf(entry, read);
    const request = await prepareWorkInstall(entry.workKind, template, { create: false, entry });

    if (request.remove) {
      const standing = Boolean(request.isCurrent?.());
      if (standing) await request.remove();
      return into(standing ? "removed" : "notInstalled", entry.name);
    }

    const key = request.recordKey;
    const seen = rolledBack.has(key);
    const record = seen ? null : readInstallRecord(key);
    if (!record) {
      let leftover = false;
      if (!seen && request.alsoRemove) leftover = await request.alsoRemove();
      return into(leftover ? "removed" : "notInstalled", entry.name);
    }

    const differs = request.installedSignature(record) !== request.spec.signature;
    if (differs || (request.sharedParts && !request.soleInstalled(record))) {
      return into("otherVersion", entry.name);
    }

    await rollback(key);
    rolledBack.add(key);
    await request.alsoRemove?.();
    return into("removed", entry.name);
  };

  const ledger = await tally(installOrder(entries).reverse(), REMOVE_BUCKETS, removeOne, REMOVE_FAILURES);
  const names = (entries || []).map((entry) => entry.name);
  const placeOf = (item) => Math.max(names.indexOf(typeof item === "string" ? item : item.name), 0);
  for (const bucket of Object.values(ledger)) bucket.sort((left, right) => placeOf(left) - placeOf(right));
  return ledger;
}
