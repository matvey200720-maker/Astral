import { describe as describeUpdate } from "../../updates/model.js";
import { readQueueProgress, withLiveProgress } from "../live-progress.js";

/*
 * Что сказать в окне «Закрыть Astral?» (макет В1, 16.11.2026): что именно ещё скачивается и на сколько процентов. Названия и проценты берутся из
 * настоящей очереди окна (строки установки каталога с живым ходом) и из состояния обновления Astral; главный процесс знает только, что что-то идёт.
 * Удаления и сброс скачиванием не считаются: вопрос нужен там, где закрытие обрывает загрузку.
 */

const clampPercent = (value) => Math.round(Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0)));

const isDownloading = (row) => !row.failed && row.operation === "install";

/**
 * Итог для окна: `{ kind, count, name, percent }` или `null`, если скачивать нечего (тогда окно закрывается молча).
 * `kind`: «update» — идёт обновление Astral, «one» — одна загрузка из очереди, «many» — несколько; у «many» `percent` — среднее по загрузкам.
 */
export function closeAskSummary({ queue = [], updateState = null, readLive = readQueueProgress } = {}) {
  const rows = queue.filter(isDownloading).map((row) => {
    const live = withLiveProgress(row, readLive(row.queueId));
    return { name: String(live.name || live.title || "").trim(), percent: clampPercent(live.progress), started: Boolean(row.started) };
  });
  const update = describeUpdate(updateState);
  const updating = update.mode === "downloading";
  const updatePercent = clampPercent(update.facts?.percent);
  const count = rows.length + (updating ? 1 : 0);
  if (count === 0) return null;
  if (count > 1) {
    const percents = [...rows.map((row) => row.percent), ...(updating ? [updatePercent] : [])];
    return { kind: "many", count, name: "", percent: clampPercent(percents.reduce((sum, value) => sum + value, 0) / percents.length) };
  }
  if (updating) return { kind: "update", count, name: "", percent: updatePercent };
  const [only] = rows;
  return { kind: "one", count, name: only.name, percent: only.percent };
}
