/*
 * Какие сборки пришли по коду (дизайн 15.11.2026: вкладки «Мои / По коду» и ряд «Пришли по коду»).
 *
 * В самой сборке не записано, откуда она взялась: у собранной вручную и у прочитанной из кода друга одни и те же поля. Поэтому в момент чтения кода
 * («Прочитать код» → `importFlow`) номер сборки запоминается здесь, на этом ПК: `{ id: время чтения }`. Сборки, прочитанные раньше этой записи, узнаются
 * по номеру, который даёт чтение кода (`local-import-…`, `portable-code.js`); в облачном режиме сервер выдаёт свой номер, и такие сборки, прочитанные до
 * записи, остаются среди «Моих». Автора кода в коде нет, поэтому и показывать его нечем.
 */

const KEY = "astral.builds.from-code.v1";
const LIMIT = 500;
const IMPORTED_ID = /^local-import-/;

const isPlain = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function attempt(job, fallback) {
  try {
    return job();
  } catch {
    return fallback;
  }
}

/** `{ id: ISO-время }` всех запомненных; повреждённая запись — пусто. */
export function readFromCode() {
  const parsed = attempt(
    () => JSON.parse(globalThis.localStorage.getItem(KEY)),
    null,
  );
  return isPlain(parsed) ? parsed : {};
}

function write(record) {
  const pairs = Object.entries(record);
  const kept =
    pairs.length > LIMIT ? Object.fromEntries(pairs.slice(-LIMIT)) : record;
  attempt(
    () => globalThis.localStorage.setItem(KEY, JSON.stringify(kept)),
    undefined,
  );
}

/** Сборка с этим номером прочитана из кода. */
export function rememberFromCode(id, at = new Date().toISOString()) {
  if (!id) return;
  write({ ...readFromCode(), [id]: at });
}

/** Сборку удалили: пометка уходит вместе с ней. */
export function forgetFromCode(id) {
  const record = readFromCode();
  if (!Object.hasOwn(record, id)) return;
  const { [id]: _gone, ...rest } = record;
  write(rest);
}

/** Пришла ли сборка по коду: по записи этого ПК или по номеру, который выдаёт чтение кода. */
export function isFromCode(profile, record = readFromCode()) {
  const id = String(profile?.id ?? "");
  return Boolean(id) && (Object.hasOwn(record, id) || IMPORTED_ID.test(id));
}

/** Делит сборки на свои и пришедшие по коду, порядок каждой части прежний. */
export function splitByOrigin(profiles, record = readFromCode()) {
  const mine = [];
  const byCode = [];
  for (const profile of profiles)
    (isFromCode(profile, record) ? byCode : mine).push(profile);
  return { mine, byCode };
}
