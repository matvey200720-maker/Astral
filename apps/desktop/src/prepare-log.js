/*
 * Что подготовка игры сделала с update.rpf — строкой в журнал (04.11.2026).
 *
 * Подготовка идёт при запуске и после правок, пересборка занимает до двух минут и два гигабайта
 * записи, а в журнале её не было: канал `prepare-game` не из каналов установки. В тикете по
 * жалобе «мини-карта и прицел пропали» нечем было доказать, когда и почему архив пересобрали и
 * кто его подменил. Теперь пересборка и подмена снаружи пишут по строке `[install]`.
 *
 * Отказ проверки поверхности (`surface.verify`) здесь не повторяется: его пишет свой обработчик.
 */
import { appLog } from "./app-log.js";

const SOURCE = "install";

const pad = (value) => String(value).padStart(2, "0");

/** Размер словами с тонкими пробелами заменёнными на обычные: журнал читают глазами и ищут по тексту. */
export const bytesText = (size) =>
  Number.isFinite(size) ? `${Math.round(size).toLocaleString("ru-RU").replace(/\s/g, " ")} байт` : "размер неизвестен";

/** `дд.мм чч:мм:сс` по местному времени — так время подписано и в Discord. */
export function stampText(ms) {
  if (!Number.isFinite(ms)) return "время неизвестно";
  const date = new Date(ms);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const fileText = (identity) =>
  identity && Number.isFinite(identity.size)
    ? `${bytesText(identity.size)} от ${stampText(identity.mtimeMs)}`
    : "неизвестный файл";

const secondsText = (seconds) => `${seconds.toFixed(1).replace(".", ",")} с`;

/** Мёртвого места в основе больше этого — отдельная строка уровня warn (след чужой сборки, 23.11.2026). */
export const DEAD_SPACE_WARN_BYTES = 16 * 1024 * 1024;

const megabytesText = (size) => `${(size / 1048576).toFixed(1).replace(".", ",")} МБ`;

/* Счёт записей сборки (`compose` в ответе подготовки, поля движка `compose-rpf`): «записей N → M, мёртвого места K МБ». Нет числа — нет и куска. */
function countText(compose) {
  if (!compose || !Number.isFinite(compose.entriesBefore) || !Number.isFinite(compose.entriesAfter)) return "";
  const dead = Number.isFinite(compose.deadBytesBefore) ? `, мёртвого места ${megabytesText(compose.deadBytesBefore)}` : "";
  return `; записей ${compose.entriesBefore} → ${compose.entriesAfter}${dead}`;
}

/* Причина пересборки: что именно заставило подготовку переписать архив. */
function reasonOf(result) {
  if (result.freshBaseline) return "первая подготовка игры";
  if (result.swap?.outside) return "архив подменён снаружи";
  if (result.rebased) return "правка мастерской вошла в основу";
  return "метка слоя или реестры Astral";
}

/* Что решено с модами при подмене: снятые проверкой файлов, игра штатная или слои легли обратно. */
function modsText(result) {
  const parked = [
    ...new Set(
      (result.reconcile || [])
        .filter((event) => event?.kind === "restored-by-launcher")
        .flatMap((event) => event.modIds || []),
    ),
  ];
  if (parked.length)
    return `моды сняты проверкой файлов и ждут «Установить снова»: ${parked.join(", ")}${result.stockHold ? "; игра остаётся штатной" : ""}`;
  if (result.stockHold) return "игра остаётся штатной";
  return "моды не снимались, слои Astral легли поверх нового архива";
}

/**
 * Строки журнала по ответу подготовки.
 *
 * @param {{result: object | null, before: object | null, after: object | null, seconds: number}} input
 *   `before`/`after` — `{ size, mtimeMs }` update.rpf до подготовки и после неё.
 * @returns {Array<{level: string, source: string, message: string}>}
 */
export function prepareLogEntries({ result, before = null, after = null, seconds = 0 }) {
  if (!result || typeof result !== "object") return [];
  const entries = [];
  /* Подготовка слоя отказала (в том числе страховкой: основа менялась в ходе снятия, архив беднее основы, `lost entries`): отказ в журнал, чтобы он был виден в «Логах». Это журнал, не интерфейс. */
  if (result.status === "unavailable")
    entries.push({
      level: "warn",
      source: SOURCE,
      message: `подготовка игры: слой Astral не подготовлен (${secondsText(seconds)}) — ${result.reason ? String(result.reason).slice(0, 600) : "причина не названа"}`,
    });
  if (result.swap?.outside)
    entries.push({
      level: "warn",
      source: SOURCE,
      message: `подготовка игры: update.rpf подменён снаружи — был ${fileText(result.swap.before)}, стал ${fileText(result.swap.found)}; ${modsText(result)}`,
    });
  if (result.committed) {
    entries.push({
      level: "info",
      source: SOURCE,
      message: `подготовка игры: архив пересобран за ${secondsText(seconds)} — причина: ${reasonOf(result)}; update.rpf ${bytesText(before?.size)} → ${bytesText(after?.size)}${countText(result.compose)}`,
    });
    if (Number.isFinite(result.compose?.deadBytesBefore) && result.compose.deadBytesBefore > DEAD_SPACE_WARN_BYTES)
      entries.push({
        level: "warn",
        source: SOURCE,
        message: `подготовка игры: в архиве игры было ${megabytesText(result.compose.deadBytesBefore)} данных вне оглавления (след чужой сборки) — в новый архив они не вошли`,
      });
  }
  else if (result.ownEdits)
    entries.push({
      level: "info",
      source: SOURCE,
      message: `подготовка игры: в архиве только правки мастерской, пересборка не нужна (${secondsText(seconds)}); update.rpf ${bytesText(after?.size)}`,
    });
  return entries;
}

/** Пишет строки подготовки в журнал процесса. Журнал не вправе уронить подготовку. */
export function logPrepare(input, log = appLog) {
  try {
    for (const entry of prepareLogEntries(input)) log.record(entry);
  } catch {
    /* Строка журнала — не часть подготовки. */
  }
}
