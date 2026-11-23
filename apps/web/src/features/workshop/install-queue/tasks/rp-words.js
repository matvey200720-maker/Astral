import { rpFallbackNote, viaUpdateNote } from "./rp-update-notes.js";
import { rpPartialNote } from "./rp-partial-words.js";

/*
 * Слова про GTA 5 RP по СТРУКТУРЕ установки (21.11.2026): запись установки хранит коды (что легло контейнером, что нет, причина отката), а слова на языке окна собираются при показе —
 * в ряду «Загрузок», в уведомлении и в «Библиотеке» (одна и та же запись, пока мод стоит). Режим выключен — структуры нет, слов нет, запись прежняя.
 */

/**
 * Структура для записи установки из плана: `{ set, via?, fallback? }` или `null` (режим выключен — ни `viaUpdate`, ни `rpFallback` в плане нет).
 * Только коды и идентификаторы: слова строятся заново на текущем языке.
 */
export function rpRecordOf(set, plan) {
  const via = plan?.viaUpdate && typeof plan.viaUpdate === "object" ? plan.viaUpdate : null;
  const fallback = plan?.rpFallback && typeof plan.rpFallback === "object" ? plan.rpFallback : null;
  if (!via && !fallback) return null;
  return {
    set,
    ...(via
      ? {
          via: {
            chosen: Array.isArray(via.chosen) ? via.chosen.map(String) : [],
            refused: Array.isArray(via.refused) ? via.refused.map((item) => ({ id: String(item?.id ?? "") })) : [],
            droppedParts: Array.isArray(via.droppedParts) ? via.droppedParts.map(String) : [],
            /* Билборды частью: сколько щитов работы видно на RP из скольких (числа, `billboards-rp-count.js`). */
            ...(Number.isInteger(via.shields?.seen) && Number.isInteger(via.shields?.total) ? { shields: { seen: via.shields.seen, total: via.shields.total, ...(Number.isInteger(via.shields.limited) && via.shields.limited > 0 ? { limited: via.shields.limited } : {}) } } : {}),
          },
        }
      : {}),
    ...(fallback ? { fallback: { container: fallback.container === false ? false : true, reason: String(fallback.reason ?? "") } } : {}),
  };
}

/** Слова про GTA 5 RP по структуре (`rpRecordOf`) на языке окна сейчас; пустая строка — говорить нечего. */
export async function rpWordsOf(record) {
  if (!record || typeof record !== "object") return "";
  const part = (await rpPartialNote(record.set, record.via)) ?? viaUpdateNote(record.set, record.via);
  const fallback = rpFallbackNote(record.fallback);
  return [part, fallback].filter(Boolean).join(" ");
}
