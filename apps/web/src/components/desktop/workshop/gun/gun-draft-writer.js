/*
 * Запись черновика ствола не на каждое движение.
 *
 * Ползунок отдаёт десятки правок в секунду, а запись — это разбор и перезапись всего хранилища черновиков окна (`gun-draft-store.js`). В составе ганпака правки уходят в него сами, без «Сохранить», поэтому писать надо
 * так, чтобы кисть и ползунок не лагали: одна запись за окно задержки, и в неё — самая свежая версия. Мазок кисти кончается отпусканием, и его правка приходит уже готовой.
 *
 * Что не пишется вовремя, дописывается: выход из редактора, закрытие окна и уход вкладки в фон снимают задержку (`flush`).
 */

export const DRAFT_WRITE_MS = 400;

/**
 * @param {{ write: (slot: string, project: object) => void, delay?: number }} options
 */
export function createDraftWriter({ write, delay = DRAFT_WRITE_MS }) {
  let pending = null;
  let timer = 0;

  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending) return false;
    const job = pending;
    pending = null;
    write(job.slot, job.project);
    return true;
  };

  return {
    /** Запомнить версию; запись — через `delay`, и она одна на все версии за это время. */
    push(slot, project) {
      pending = { slot, project };
      if (!timer) timer = setTimeout(flush, delay);
    },
    flush,
    /** Есть ли версия, что ещё не записана. */
    get dirty() {
      return pending !== null;
    },
    /** Забыть, что не записано (скрытая студия, закрытая без выхода). */
    cancel() {
      clearTimeout(timer);
      timer = 0;
      pending = null;
    },
  };
}
