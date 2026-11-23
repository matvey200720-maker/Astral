/*
 * ArchiveFix не доделал архив: файл в этот миг держала другая программа (разбор журнала тестера 04.11.2026, `workshop-apply-minimap`:
 * «ArchiveFix did not encrypt the archive header: scaleform_minimap.rpf», при этом «[ArchiveFix] Завершён за 0.4 с»).
 *
 * Что происходит на самом деле (воспроизведено на маленьком архиве с настоящим ArchiveFix, 04.11.2026):
 *  • ArchiveFix открывает файл `new FileStream(path, FileMode.Open)` — чтение и запись, чужим писателям доступ закрыт. Пока любой другой процесс держит
 *    тот же файл открытым на запись (антивирус, который проверяет только что записанный файл, облачная синхронизация, индексатор), открытие падает
 *    `IOException: файл используется другим процессом`; ArchiveFix печатает «Failed performing tasks», доходит до «Press the any key», падает на
 *    `Console.ReadKey` (как падает на каждом запуске, код 0xE0434352) и выходит за 0,3–0,4 с — как после успеха. Файл не тронут: заголовок остаётся «OPEN».
 *  • Движок кода выхода не смотрит (он одинаков в обоих случаях), вывод ArchiveFix выбрасывает и ловит только повторное чтение заголовка: «did not encrypt».
 *    Игра цела — установка откатилась, но человек видит голую английскую фразу, а следующая попытка почти всегда проходит.
 *  • Не размер и не имя: ключ NG, который выбирает ArchiveFix, совпал с ключом движка на 111 длинах архива подряд (все 101 остаток по модулю).
 *
 * Поэтому такой отказ — повод повторить вызов целиком: движок при отказе откатывает точку и убирает свой стейдж, повтор безопасен. Повтор самого
 * ArchiveFix в движке (на файле в 6 МБ это 0,4 с, а не весь пересбор) — заявка на движок: `docs/beta/incident-2026-11-04-archivefix-header.md`.
 */

export const ARCHIVEFIX_NOT_APPLIED = /ArchiveFix did not encrypt the archive header/i;

/** Пауза перед второй и третьей попыткой: пересбор архива и так занимает секунды, а проверка антивируса маленького файла — доли секунды. */
export const ARCHIVEFIX_RETRY_DELAYS_MS = Object.freeze([2000, 5000]);

export const isArchiveFixNotApplied = (failure) => ARCHIVEFIX_NOT_APPLIED.test(String(failure?.message ?? failure ?? ""));

/** Пауза, которую отмена установки прерывает сразу (причина отмены — отказ ожидания). */
export function sleepUnlessAborted(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Установка отменена пользователем.", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Установка отменена пользователем.", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Выполняет `run(попытка)`; отказ «ArchiveFix не зашифровал заголовок» повторяет после паузы из `delays`, остальные отказы пробрасывает сразу.
 * `onRetry({ attempt, of, delayMs, error })` — перед паузой (запись в журнал), `onGiveUp(error, attempts)` — когда попытки кончились.
 * `sleep(ms, signal)` подменяют тесты; отмена установки (`signal`) обрывает паузу, и вызывающий получает причину отмены.
 */
export async function retryArchiveFixNotApplied(run, { delays = ARCHIVEFIX_RETRY_DELAYS_MS, sleep = sleepUnlessAborted, signal = null, onRetry = null, onGiveUp = null } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      if (!isArchiveFixNotApplied(error)) throw error;
      const delay = delays[attempt];
      if (delay === undefined || signal?.aborted) {
        onGiveUp?.(error, attempt + 1);
        throw error;
      }
      onRetry?.({ attempt: attempt + 1, of: delays.length + 1, delayMs: delay, error });
      await sleep(delay, signal);
    }
  }
}
