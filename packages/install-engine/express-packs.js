// Состав своего dlc для экспресс-установки (`express-dlc.js`) из того же запроса, по которому старый путь собирает
// архив (16.11.2026, работа «Astral быстрее»).
//
// Старый путь описывает свой пакет дополнения как «основа хоста + слои работ»: `composeArchiveResource`
// (`resource-composition.js`) собирает из состояния список операций (`{ entry, action, source, sha256 }`) и отдаёт его
// сборщику вместе с архивом-основой. Экспресс-путь своей модели состояния не заводит (решение 16.11, записка
// `docs/INSTALL-RUST-EXPRESS.md`, раздел 13): он берёт те же основу и операции и кладёт в игру тот же состав другой
// дорогой — `build-rpf-dlc` пишет архив сразу на место. Здесь — только перевод «основа + операции» в список `packs`
// для `installExpressDlc`: что лежит в корне архива и что в каждом вложенном.
//
// Основа приходит уже разложенной файлами (`baseEntries`): движку нужны пути к файлам на диске, а записи основы живут
// внутри её архива. Раскладывает основу приложение; здесь её записи только читаются.
//
// Правила те же, что у сборщика старого пути: `import` на занятое место и `replace` на пустое — отказ, `upsert` кладёт
// поверх, `delete` убирает (нет записи — отказ, если не сказано `allowMissing`). Имена сравниваются без учёта регистра.
// Порядок записей и вложенных архивов — по имени: один и тот же состав даёт один и тот же список, а недостроенную
// сборку движок продолжает только по тому же списку.
//
// Модуль чистый: файлов не пишет, движок не зовёт. Видимых пользователю строк нет: у ошибок `code` и служебное сообщение.
import { describeFile, ExpressDlcError } from "./express-dlc.js";

const PACK_TARGET = /^update\/x64\/dlcpacks\/([a-z0-9_]+)\/dlc\.rpf$/i;
const NESTED_NAME = /\.rpf$/i;

/** Имя папки своего пакета в `dlcpacks` по архиву-цели; не свой пакет — `null`. */
export const expressPackNameOf = (archiveTarget) => PACK_TARGET.exec(String(archiveTarget ?? ""))?.[1]?.toLowerCase() ?? null;

const refuse = (message) => new ExpressDlcError("ARGUMENTS", `Express dlc: ${message}`, { phase: "arguments" });

/** Запись состава: куда её положить. Первый отрезок пути с хвостом `.rpf` — вложенный архив, остальное — путь внутри. */
export function expressEntryPlace(entry) {
  const parts = String(entry ?? "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) throw refuse("an entry path is empty.");
  if (parts.length === 1 || !NESTED_NAME.test(parts[0])) {
    if (parts.slice(0, -1).some((part) => NESTED_NAME.test(part))) throw refuse(`${entry}: a nested archive may sit only at the root of the pack.`);
    return { nested: null, path: parts.join("/") };
  }
  const inside = parts.slice(1);
  if (inside.slice(0, -1).some((part) => NESTED_NAME.test(part))) throw refuse(`${entry}: an archive inside a nested archive is not supported.`);
  return { nested: parts[0], path: inside.join("/") };
}

const byName = (pick) => (a, b) => {
  const left = pick(a).toLowerCase();
  const right = pick(b).toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
};

// Не больше `limit` описаний одновременно: каждое открывает файл и читает его первые 16 байт.
async function mapLimited(list, limit, task) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      out[index] = await task(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return out;
}

/**
 * Состав одного пакета для `installExpressDlc`.
 *
 * @param {object}   options
 * @param {string}   options.archiveTarget  архив пакета от корня игры: `update/x64/dlcpacks/<имя>/dlc.rpf`
 * @param {Array}    options.baseEntries    записи основы файлами: `{ path, kind, size, source, words?, unpacked?, sha256? }`, где `path` —
 *                                          путь в архиве (`content.xml`, `astral_vegetation.rpf/astral_host.json`). Сами вложенные
 *                                          архивы строками не идут: архив есть, пока в нём есть запись
 * @param {Array}    options.operations     операции старого пути: `{ entry, action, source?, sha256?, allowMissing? }`
 * @param {Function} [options.describe]     `(file, entryPath, extra) => запись`: вид, размер и слова файла-источника (`describeFile`)
 * @param {number}   [options.atOnce=32]    сколько источников описывается одновременно
 * @returns {Promise<{ name, entries, nested: Array<{ name, entries }>, files, bytes }>} `files` и `bytes` — счёт записей и их размеров
 */
export async function expressPackOf({ archiveTarget, baseEntries = [], operations = [], describe = describeFile, atOnce = 32 } = {}) {
  const name = expressPackNameOf(archiveTarget);
  if (!name) throw refuse(`${archiveTarget}: not an own dlc archive.`);
  if (!Array.isArray(baseEntries) || !Array.isArray(operations)) throw refuse("baseEntries and operations are lists.");

  // ключ — «вложенный/путь» строчными; значение — куда и что
  const laid = new Map();
  const keyOf = (place) => `${place.nested ?? ""}\n${place.path}`.toLowerCase();
  for (const row of baseEntries) {
    if (!row || typeof row.path !== "string" || !row.source) throw refuse("a base entry needs path and source.");
    const place = expressEntryPlace(row.path);
    const key = keyOf(place);
    if (laid.has(key)) throw refuse(`${row.path}: the base lists the entry twice.`);
    const { path: _whole, ...facts } = row;
    laid.set(key, { place, entry: { path: place.path, ...facts } });
  }

  // операции меняют состав по порядку; источники описываются потом, разом
  const pending = [];
  for (const operation of operations) {
    if (!operation || typeof operation.entry !== "string") throw refuse("an operation needs an entry.");
    const place = expressEntryPlace(operation.entry);
    const key = keyOf(place);
    const action = operation.action || "replace";
    if (action === "delete") {
      if (!laid.has(key) && operation.allowMissing !== true) throw refuse(`${operation.entry}: nothing to delete.`);
      laid.delete(key);
      continue;
    }
    if (action !== "import" && action !== "replace" && action !== "upsert") throw refuse(`${operation.entry}: unknown action ${action}.`);
    if (!operation.source) throw refuse(`${operation.entry}: the operation has no source.`);
    if (action === "import" && laid.has(key)) throw refuse(`${operation.entry}: import onto an existing entry.`);
    if (action === "replace" && !laid.has(key)) throw refuse(`${operation.entry}: replace of a missing entry.`);
    const slot = { place, entry: null };
    laid.set(key, slot);
    pending.push({ slot, operation });
  }
  const live = pending.filter(({ slot }) => laid.get(keyOf(slot.place)) === slot);
  await mapLimited(live, atOnce, async ({ slot, operation }) => {
    slot.entry = await describe(operation.source, slot.place.path, operation.sha256 ? { sha256: operation.sha256 } : {});
  });

  const root = [];
  const nested = new Map();
  for (const { place, entry } of laid.values()) {
    if (!place.nested) {
      root.push(entry);
      continue;
    }
    const key = place.nested.toLowerCase();
    if (!nested.has(key)) nested.set(key, { name: place.nested, entries: [] });
    nested.get(key).entries.push(entry);
  }
  for (const entry of root) if (nested.has(entry.path.toLowerCase())) throw refuse(`${entry.path}: a root entry and a nested archive share the name.`);
  const sorted = [...nested.values()].sort(byName((item) => item.name));
  for (const item of sorted) item.entries.sort(byName((entry) => entry.path));
  root.sort(byName((entry) => entry.path));
  const all = [...root, ...sorted.flatMap((item) => item.entries)];
  if (!all.length) throw refuse(`${name}: the pack is empty.`);
  return {
    name,
    entries: root,
    nested: sorted,
    files: all.length,
    bytes: all.reduce((total, entry) => total + (Number(entry.size) || 0), 0),
  };
}
