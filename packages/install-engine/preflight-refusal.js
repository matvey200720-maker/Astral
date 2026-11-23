/*
 * Отказ предварительной проверки архива — словами, а не голой строкой движка.
 *
 * Команда `probe-rpf` сверяет операции пакета с архивом-основой и отказывает
 * одним и тем же текстом — «RPF preflight failed: <запись>» с кодом
 * `InvalidDataException` — в двух противоположных случаях: `import` над записью,
 * которая в основе уже есть, и `replace`/`delete` над записью, которой в основе
 * нет (`archives/probe.rs`, `refused`). Из строки не понять, какой из двух, в
 * каком архиве и какой основе, — и окно показывало «пакет сейчас не получить»
 * (журнал человека 17.11.2026: `x64/levels/gta5/minimap.rpf`, четыре отказа
 * подряд, `docs/beta/incident-2026-11-17-bigmap-preflight.md`).
 *
 * Здесь отказ получает недостающее у вызывающего, который знает, что он
 * отправил: операцию по этой записи (действие определяет сторону отказа), архив
 * и вид основы, на которой шла проверка. Код и деталь идут в сообщение — оно
 * попадает в журнал приложения (`[ipc] plan-package: …`) и в окно, которое по
 * коду в сообщении подбирает слова на шести языках (`installFailure.js`).
 * Исходная строка движка остаётся в конце сообщения, как была.
 *
 * Чистый модуль: ни файлов, ни зависимостей.
 */

const REFUSAL = /RPF preflight failed:\s*([^\r\n]+)/i;

/** Коды отказа: запись уже есть (`import`), записи нет (`replace`, `delete`), сторону определить нечем. */
export const PREFLIGHT_CODES = Object.freeze({
  exists: "rpf-preflight-exists",
  missing: "rpf-preflight-missing",
  unknown: "rpf-preflight",
});

/** Код ошибки приложения у объяснённого отказа. */
export const PREFLIGHT_ERROR_CODE = "ASTRAL_RPF_PREFLIGHT";

/** На какой основе шла проверка — слова журнала («в …»). */
const BASE_WORDS = Object.freeze({
  composition: "основе сборки",
  "stored-copy": "сохранённой копии",
  live: "живом архиве игры",
  "own-host": "собранном хосте Astral",
});

const key = (value) =>
  String(value ?? "")
    .replaceAll("\\", "/")
    .trim()
    .toLowerCase();

/** Сторона отказа по действию операции; `null` — действие отказать не может (`upsert`) или незнакомо. */
const sideOf = (action) => {
  const word = String(action ?? "").toLowerCase();
  if (word === "import") return "exists";
  if (word === "replace" || word === "delete") return "missing";
  return null;
};

/**
 * Разбор отказа: какая запись, какое действие и с какой стороны отказ.
 *
 * @param {unknown} error ошибка вызова проверки
 * @param {Array<{ entry: string, action?: string }>} operations что отправлено в проверку
 * @returns {null | { entry: string, action: string | null, side: "exists" | "missing" | null }}
 *   `null` — это не отказ предварительной проверки
 */
export function preflightRefusalOf(error, operations = []) {
  const found = REFUSAL.exec(String(error?.message ?? error ?? ""));
  if (!found) return null;
  const entry = found[1].trim();
  const same = (Array.isArray(operations) ? operations : []).filter(
    (operation) => key(operation?.entry) === key(entry),
  );
  const refusing = same.find((operation) => sideOf(operation.action)) || same[0];
  const action = refusing ? String(refusing.action ?? "").toLowerCase() || null : null;
  return { entry, action, side: sideOf(action) };
}

function sentence({ code, entry, action, archiveTarget, base, modId }) {
  const where = [BASE_WORDS[base] || "основе", archiveTarget].filter(Boolean).join(" ");
  const head = `Проверка перед установкой остановила пакет${modId ? ` «${modId}»` : ""}: `;
  const tail = `Код ${code}; движок: RPF preflight failed: ${entry}`;
  if (code === PREFLIGHT_CODES.exists)
    return `${head}запись ${entry} уже лежит в ${where}, а пакет добавляет её как новую (${action}). Её оставила прежняя установка или другая сборка. ${tail}`;
  if (code === PREFLIGHT_CODES.missing)
    return `${head}записи ${entry} нет в ${where}, а пакет её ${action === "delete" ? "удаляет" : "заменяет"} (${action}). ${tail}`;
  return `${head}запись ${entry} не подходит архиву ${archiveTarget || "игры"}: пакет рассчитан на другое состояние его файлов. ${tail}`;
}

/**
 * Отказ проверки — ошибкой со словами и кодом; всё остальное возвращается как есть.
 *
 * @param {unknown} error ошибка вызова `rpfProbe`
 * @param {object} context
 * @param {string} [context.archiveTarget] архив игры, например `update/update.rpf`
 * @param {Array<{ entry: string, action?: string }>} [context.operations] отправленные операции
 * @param {"composition"|"stored-copy"|"live"|"own-host"} [context.baseKind] на какой основе шла проверка
 * @param {string} [context.modId] пакет, который проверялся
 */
export function explainPreflightRefusal(error, { archiveTarget = "", operations = [], baseKind = "", modId = "" } = {}) {
  if (!error || String(error.message ?? "").includes(PREFLIGHT_CODES.unknown)) return error;
  const refusal = preflightRefusalOf(error, operations);
  if (!refusal) return error;
  const code = refusal.side ? PREFLIGHT_CODES[refusal.side] : PREFLIGHT_CODES.unknown;
  const detail = {
    code,
    entry: refusal.entry,
    action: refusal.action,
    archiveTarget: archiveTarget || null,
    base: baseKind || null,
    modId: modId || null,
  };
  const explained = new Error(sentence({ ...detail, archiveTarget, base: baseKind, modId }));
  explained.code = PREFLIGHT_ERROR_CODE;
  explained.preflight = detail;
  explained.cause = error;
  return explained;
}
