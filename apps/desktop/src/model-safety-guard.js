import fs from "node:fs/promises";
import { modelKindOf, modelVerdict } from "./model-guard-check.js";

/*
 * Сторож моделей-пустышек на пути каталога и редуксов (21.11.2026): модель без группы шейдеров игра Legacy 3889 не переживает (`model-guard-check.js`: ACCESS_VIOLATION по адресу 0x18, дамп 03.10.2026;
 * редукс Andy Lord: `0xc0000005` через ~15 с после входа в сюжет, пустышки лежали в `optimization-world` (42) и `arenas` (2)). Пакет подписан, файлы автора ложатся как есть (`rpf-resource-layer-v1`),
 * поэтому сторож стоит там, где слои складываются в архив (`resource-composition.js`, сборщик `modelSafetyGuard`): через него идут и уже опубликованные карточки, и будущие, и снятие, и «Починить».
 *
 * Файл-пустышка в архив НЕ кладётся: вещь остаётся штатной (замысел автора «спрятана» теряется, зато сюжет живёт). Заглушку с группой шейдеров мы пока не генерируем: безопасный байтовый вид без
 * проверки игрой не выпускаем; `.ydd` и `.yft` разбирает та же проверка, поэтому снимаются так же. Файл, который наш читатель не разобрал (в том числе обрывок и мусор), и файл без единой модели не снимаются (вердикты `unreadable`, `none`): снимаем только доказанное — модель без группы шейдеров. Вердикт запоминается по sha256 файла.
 *
 * Отчёт ведётся по пакету и записи: установка забирает свой (`takeGuardReport`) и кладёт строку в журнал и число с именами в итог для окна.
 */
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_REMEMBERED = 4000;
const SHOWN_NAMES = 12;

const verdicts = new Map();
const dropped = new Map();

const remember = (map, key, value) => {
  if (map.size >= MAX_REMEMBERED) map.delete(map.keys().next().value);
  map.set(key, value);
};

/**
 * Вызов движка для записи слоя (`resource-composition.js`): `null` — класть как есть; `{ drop: true }` — запись не кладётся. Аргументы: `{ entry, source, sha256, modId }`.
 */
export async function guardModelEntry({ entry, source, sha256, modId } = {}) {
  if (!modelKindOf(entry)) return null;
  let verdict = sha256 ? verdicts.get(sha256) : undefined;
  if (verdict === undefined) {
    const size = (await fs.stat(source)).size;
    verdict =
      size > MAX_BYTES ? "ok" : modelVerdict(await fs.readFile(source), entry);
    if (sha256) remember(verdicts, sha256, verdict);
  }
  if (verdict !== "empty") return null;
  const key = `${modId}\n${entry}`;
  if (!dropped.has(key)) {
    remember(dropped, key, { modId: String(modId || ""), entry });
    console.warn(
      `[astral] Модель-пустышка не положена в игру: ${String(entry).split("/").pop()} (мод ${modId || "?"}): без группы шейдеров, такие роняют обычную игру.`,
    );
  }
  return { drop: true, reason: "no-shader-group" };
}

/**
 * Забирает отчёт по этим пакетам: `{ count, names }` (`names` — имена файлов, без повторов, по алфавиту) или `null`, если ничего не снято. Забранное из памяти уходит.
 */
export function takeGuardReport(modIds = []) {
  const wanted = new Set(modIds.filter(Boolean).map(String));
  const names = new Set();
  for (const [key, item] of dropped) {
    if (!wanted.has(item.modId)) continue;
    names.add(String(item.entry).split("/").pop());
    dropped.delete(key);
  }
  return names.size ? { count: names.size, names: [...names].sort() } : null;
}

/** Строка журнала установки: число и имена (не больше `SHOWN_NAMES`). */
export function guardReportLine(report) {
  const shown = report.names.slice(0, SHOWN_NAMES).join(", ");
  const rest =
    report.names.length > SHOWN_NAMES
      ? ` и ещё ${report.names.length - SHOWN_NAMES}`
      : "";
  return `В сборке моделей-пустышек (без группы шейдеров): ${report.count}. Такие роняют обычную игру, поэтому они не положены, вещи остались штатными: ${shown}${rest}.`;
}

/** Результат установки с отчётом сторожа (`modelGuard`) для окна, если что-то снято; без снятого — тот же объект. */
export function withGuardReport(result, modIds) {
  const report = takeGuardReport(modIds);
  if (!report) return { result, line: null };
  return {
    result:
      result && typeof result === "object"
        ? { ...result, modelGuard: report }
        : result,
    line: guardReportLine(report),
  };
}

/** Для тестов: забыть всё запомненное. */
export function resetModelGuard() {
  verdicts.clear();
  dropped.clear();
}
