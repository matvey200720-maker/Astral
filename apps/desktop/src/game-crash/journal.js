/*
 * Запись о падении в журнале приложения и текстовый отчёт для тикета (ТЗ владельца 11.11.2026).
 *
 * В журнал (`app-log.jsonl`) падение попадает записью `kind: "game-crash"`: короткое сообщение — для строки журнала,
 * подробности — построчно (то, что видит поддержка в выгрузке), `data` — структура для окна. Отчёт «Сохранить отчёт»
 * и источник выгрузки собираются из тех же записей. Всё, что уходит наружу, проходит вычистку (`scrubGameText`).
 */
import { WHERE_LABELS } from "./classify.js";
import { scrubGameText } from "./scrub.js";

const MESSAGE_LIMIT = 900;
const DATA_MODS = 40;

/** Короткая подпись мода для поддержки: название из каталога, иначе по слоту, иначе идентификатор. */
export function describeSlots(slots = []) {
  const first = String(slots[0] || "");
  const table = [
    [/^recolor-arenas?$/, "Арены (перекраска)"],
    [/^recolor-hangar/, "Ангар (перекраска)"],
    [/^recolor-(.+)$/, (m) => `Перекраска: ${m[1]}`],
    [/^large-map$/, "Большая карта"],
    [/^sky-/, "Небо"],
    [/^sound-/, "Звук"],
    [/^clothing-/, "Одежда"],
    [/^weapon-/, "Оружие (ганпак)"],
  ];
  for (const [pattern, label] of table) {
    const match = pattern.exec(first);
    if (match) return typeof label === "function" ? label(match) : label;
  }
  return first;
}

export const modLabel = (mod) => mod.title || describeSlots(mod.slots) || mod.modId;

const when = (iso) => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, "Z") : "—");

/** Секунды → «41 с», «2 мин 33 с», «1 ч 2 мин» (от часа секунды не называем). */
export function uptimeText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total} с`;
  if (total < 3600) return `${Math.floor(total / 60)} мин${total % 60 ? ` ${total % 60} с` : ""}`;
  return `${Math.floor(total / 3600)} ч${Math.floor((total % 3600) / 60) ? ` ${Math.floor((total % 3600) / 60)} мин` : ""}`;
}

/** Строка «Проработал до падения»: сколько жил процесс (по времени запуска из события Windows) — проверка слов «через две минуты после старта». */
function uptimeLine(record) {
  if (!Number.isFinite(record.uptimeSec)) return "";
  const started = Number.isFinite(record.process?.startedAt) ? ` (запущен ${when(new Date(record.process.startedAt).toISOString())})` : "";
  return `Проработал до ${record.event === "hang" ? "закрытия Windows" : "падения"}: ${uptimeText(record.uptimeSec)}${started}`;
}

function suspectLine(record) {
  const [first] = record.suspects || [];
  if (first) {
    const files = first.files.join(", ");
    /* Мод поставлен уже после падения — виновным его называть слабо: на момент падения стоял его прежний вариант или не стоял вовсе. */
    if (first.timing === "after") return `файл ${files} есть у мода «${modLabel(first)}» ${first.version}, но он поставлен ${when(first.installedAt)}, уже после падения — вряд ли дело в нём`;
    return `вероятно, из-за мода «${modLabel(first)}» ${first.version}: файл ${files} положил он (установлен ${when(first.installedAt)}, до падения)`;
  }
  if (record.foreign?.length) return `файл ${record.foreign.join(", ")} не из Astral`;
  if (record.index === "ok" && !record.wanted?.length) return "по уликам файл не назвать — мод не определён";
  return "";
}

/** Запись в журнал приложения: сообщение, подробности и структура. */
export function journalEntry(record) {
  const suspect = suspectLine(record);
  /* Время самого падения стоит в сообщении: запись в журнал приложения ложится позже (при старте — пачкой), а одинаковые падения не должны склеиваться в одну строку. */
  const moment = String(record.iso || "").slice(0, 16).replace("T", " ");
  const message = `${record.event === "hang" ? "Зависание игры" : "Падение игры"} [${WHERE_LABELS[record.where] || record.where}] ${moment} UTC: ${record.reason.text}${suspect ? `; ${suspect}` : ""}`;
  const detail = detailLines(record).join("\n");
  return {
    level: "error",
    source: "game-crash",
    kind: "game-crash",
    message: scrubGameText(message, { limit: MESSAGE_LIMIT }),
    detail: scrubGameText(detail, { limit: 4000 }),
    data: {
      id: record.id,
      t: record.t,
      where: record.where,
      event: record.event,
      process: record.process,
      uptimeSec: record.uptimeSec,
      module: record.module,
      exception: record.exception,
      offset: record.offset,
      reason: record.reason,
      wanted: record.wanted,
      suspects: record.suspects,
      foreign: record.foreign,
      index: record.index,
      modsTotal: record.modsTotal,
      mods: (record.mods || []).slice(0, DATA_MODS).map(({ modId, version }) => ({ modId, version })),
    },
  };
}

function detailLines(record) {
  const lines = [
    `Время: ${record.iso}`,
    `Где: ${WHERE_LABELS[record.where] || record.where}`,
    `Что: ${record.event === "hang" ? "зависание" : "падение"}`,
    record.process && `Процесс: ${record.process.name} ${record.process.version || ""}${record.process.pid ? ` (PID ${record.process.pid})` : ""}`.trim(),
    uptimeLine(record),
    record.module &&`Модуль: ${record.module.name} ${record.module.version}${record.module.system ? " (системный)" : ""}`.trim(),
    record.exception && `Исключение: 0x${record.exception}${record.offset ? `, смещение ${record.offset}` : ""}`,
    `Причина: ${record.reason.text}`,
  ].filter(Boolean);
  const suspect = suspectLine(record);
  if (suspect) lines.push(`Мод: ${suspect}`);
  if (record.modsTotal) lines.push(`Модов Astral на момент падения: ${record.modsTotal}`);
  for (const mod of (record.mods || []).slice(0, DATA_MODS)) lines.push(`  • ${modLabel(mod)} ${mod.version} (${mod.modId}), с ${when(mod.installedAt)}`);
  if (record.index && record.index !== "ok") lines.push(`Записи установки: ${INDEX_NOTES[record.index] || record.index}`);
  if (record.plugins?.length) lines.push(`Модули .asi в папке игры: ${record.plugins.join(", ")}`);
  for (const evidence of record.evidence || []) {
    if (evidence.source === "windows") {
      lines.push(`Улика [Windows, ${evidence.event}${evidence.bucket ? `, ${evidence.bucket}` : ""}]: ${evidence.process} ${evidence.version}, модуль ${evidence.module || "—"} ${evidence.moduleVersion || ""}, исключение ${evidence.exception || "—"}, смещение ${evidence.offset || "—"}`.replace(/\s+/g, " "));
      if (evidence.path) lines.push(`  путь: ${evidence.path}`);
    } else {
      lines.push(`Улика [${SOURCE_LABELS[evidence.source] || evidence.source}, ${evidence.file}]:`);
      for (const line of evidence.lines || []) lines.push(`  ${line}`);
    }
  }
  return lines;
}

const INDEX_NOTES = {
  missing: "файл состояния установки не найден, мод не определялся",
  "too-big": "файл состояния слишком велик, мод не определялся",
  unreadable: "файл состояния не разобран, мод не определялся",
};
const SOURCE_LABELS = { "majestic-client": "журнал клиента Majestic", "ragemp-log": "журнал RAGE MP", "gta-plugin-log": "журнал модуля GTA V", "gta-crashlogs": "папка CrashLogs игры" };

/** Отчёт по падениям (или одному) текстом: то, что человек прикладывает к тикету. */
export function reportText(records, { appVersion = "", now = Date.now() } = {}) {
  const lines = [
    "Astral — отчёт о падениях игры",
    `Версия Astral: ${appVersion || "—"}`,
    `Составлен: ${new Date(now).toISOString()}`,
    "Пути и имя пользователя заменены на «~» и «<user>», токены, ключи, cookie и адреса вычищены.",
    "",
  ];
  if (!records.length) lines.push("Падений игры за последние дни не найдено.");
  for (const record of records) lines.push(`== ${record.iso} · ${WHERE_LABELS[record.where] || record.where} ==`, ...detailLines(record), "");
  return `${scrubGameText(lines.join("\n"), { limit: 200000 })}\n`;
}
