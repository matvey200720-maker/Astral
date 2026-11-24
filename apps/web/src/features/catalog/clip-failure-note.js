import { writeWindowLog } from "../app-errors/report.js";

/*
 * Журнал ролика (23.11.2026, владелец: «не грузится ролик у звуков», плашка «Ролик не загрузился»): окно глотало причину — `<video onError>` ставил плашку и всё, код и текст `MediaError` не читались, а сбой `fetch` ролика в память
 * (`clip 502`) терялся в `catch`. Журнал приложения был пуст, и по нему нельзя было сказать, что случилось: служба окна не отдала файл (`apps/api/src/cloud-clip.js`: нет на CDN, нет имени, хэш, сигнатура), `<video>` не принял кодек или файл долго качался.
 * Одна запись на попытку и причину за запуск окна. Подключается по `import()` из `ui/ClipPlayer.jsx` только при сбое: в главный кусок не входит. Сбой записи окно не роняет.
 *
 * Причину отказа службы `<video>` не получает (ему видно только, что не вышло), поэтому после его отказа окно спрашивает её у службы (`GET <ролик>/reason`: `{ error, code }` или 204, по запросу ничего не качается). В ответе сбоя `fetch` она есть в теле.
 * Возвращается `code` причины службы (человеку по нему подбираются слова плашки: `storage-unavailable` — «нет связи с хранилищем роликов») или пустая строка.
 */

const noted = new Set();
const NOTED_LIMIT = 40;
const LINE_LIMIT = 200;
const REASON_WAIT_MS = 4000;

/** Хвост адреса ролика: sha256 — не секрет, но в строке хватает последних знаков. */
const tailOf = (src) => String(src || "").split("/").pop().slice(-12);

/** Причина последнего отказа службы по ролику, если она её помнит; иначе `null`. */
async function askReason(src) {
  if (!String(src || "").startsWith("/api/media/clip/")) return null;
  try {
    const answer = await fetch(`${src}/reason`, { cache: "no-store", signal: AbortSignal.timeout(REASON_WAIT_MS) });
    if (answer.status !== 200) return null;
    const body = await answer.json();
    return body && typeof body.code === "string" ? { code: body.code.slice(0, 40), error: String(body.error || "").slice(0, LINE_LIMIT) } : null;
  } catch {
    return null;
  }
}

/**
 * `stage` — «поток» (`<video>` отказал) или «в память» (`fetch` ролика не вышел); `error` — `MediaError` у `<video>` (`code` 1–4, `message`) или ошибка `fetch` (у неё может быть `service` — код причины из тела ответа службы);
 * `mode` — `blob` или `stream`; `bytes` — размер из карточки; `src` — адрес ролика. Ответ — код причины службы или `""`.
 */
export async function noteClipFailure({ stage = "поток", error = null, mode = "", bytes = 0, src = "" } = {}) {
  try {
    const why = stage === "поток" ? await askReason(src) : null;
    const service = why?.code || String(error?.service || "");
    const code = error?.code ?? "";
    const text = String(error?.message ?? error ?? "").split("\n")[0].trim().slice(0, LINE_LIMIT) || "без слов";
    const key = `${stage}|${code}|${text}|${service}|${tailOf(src)}`;
    if (!noted.has(key)) {
      if (noted.size >= NOTED_LIMIT) noted.clear();
      noted.add(key);
      writeWindowLog({
        /* Отказ на этапе «в память» — `info`, пока окно пробует поток (служба слов не дала); ответ службы словами — конечный отказ, потока не будет: `warn`. */
        level: stage === "в память" && !service ? "info" : "warn",
        source: "clip",
        message: `Ролик не загрузился (${stage})${code === "" ? "" : ` [${code}]`}: ${text}${why ? `; служба: ${why.error} (${why.code})` : ""}`,
        detail: `способ: ${mode || "?"}; размер по карточке: ${Number(bytes) || 0} Б; ролик …${tailOf(src)}`,
      });
    }
    return service;
  } catch {
    return "";
  }
}

/** Забыть записанное (тесты). */
export const forgetClipNotes = () => noted.clear();
