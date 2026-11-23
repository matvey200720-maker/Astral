/*
 * Отмена установки крестиком возвращает файлы игры (правка владельца 24.10
 * вечером, ref/20: «Безопасная отмена» ничего не возвращала).
 *
 * Установка пакета из каталога делает в игре два вида записи. Саму подмену
 * архива ведёт транзакция движка (`transaction.js`): до начала подмены отмена
 * откатывает её журналом, после — не разрешена («Запись в архив игры прерывать
 * нельзя»). А до плана пакета, скачивания и самой транзакции идёт подготовка
 * игры: после «Вернуть GTA V без модов» игра «удержана штатной» (`stockHold`),
 * и первая установка снимает удержание и кладёт в `update.rpf` метку слоя
 * Astral (+9563 байта пустой оболочки `x64/astral`, шаг движка с точкой отката).
 * Это запись вне транзакции пакета: отмена, пришедшая позже, оставляла игру
 * изменённой, а строка «Безопасная отмена» говорила, что в игре ничего не
 * поменялось.
 *
 * Поэтому отмена установки, которая сама подготовила игру, возвращает игру
 * тем же движком, что и «Вернуть GTA V без модов» (`restoreOriginalTarget`):
 * `update.rpf` — к копии «до Astral», удержание штатной — на место. Отказ
 * возврата — отдельная ошибка словами, а не молчаливая «отмена»: человек должен
 * знать, что файлы не вернулись, и чем это лечится.
 */

/** Отменена ли операция: сигнал сработал или движок бросил `AbortError`. */
export const isCancelledOperation = (error, signal) =>
  Boolean(signal?.aborted) || error?.name === "AbortError";

const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || low));

/**
 * Вернуть игру после отмены, если установка сама её подготовила.
 *
 * @param {object} input
 * @param {boolean} input.prepared  эта установка сняла удержание штатной и подготовила игру
 * @param {unknown} input.error     то, чем закончилась установка
 * @param {AbortSignal|null} input.signal  сигнал отмены операции
 * @param {(options: { onProgress: Function }) => Promise<unknown>} input.restore  возврат к копии «до Astral»
 * @param {(progress: object) => void} [input.onProgress]  ход возврата для окна (`phase: "restoring"`)
 * @returns {Promise<boolean>} `true` — игру вернули; `false` — возвращать было нечего
 */
export async function returnGameAfterCancel({ prepared, error, signal = null, restore, onProgress = null }) {
  if (!prepared || !isCancelledOperation(error, signal)) return false;
  onProgress?.({ phase: "restoring", percent: 6, cancellable: false });
  let last = 6;
  try {
    await restore({
      onProgress: (progress) => {
        /* Полоса идёт только вперёд и не доходит до конца: «готово» говорит сама операция. */
        last = Math.max(last, clamp(progress?.percent, 6, 98));
        onProgress?.({ phase: "restoring", percent: last, cancellable: false });
      },
    });
  } catch (cause) {
    /* Слов «отменена» и «aborted» здесь нет нарочно: окно считает такой текст отменой и не покажет отказ. */
    const detail = String(cause?.message || cause || "").trim();
    throw Object.assign(
      new Error(
        `Не удалось вернуть файлы игры после отмены установки${detail ? `: ${detail}` : ""}. Откройте Настройки → GTA V → «Вернуть GTA V без модов» — игра вернётся целиком.`,
      ),
      { name: "InstallRollbackError", cause },
    );
  }
  return true;
}
