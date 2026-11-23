/*
 * Что старт доделал за прошлый раз — окну, словами.
 *
 * Приложение, закрытое посреди удаления из «Библиотеки» или посреди сеанса
 * игры без модов (Vanilla Guard), на следующем старте доводит начатое:
 * возвращает прежний архив, доделывает уборку, кладёт моды обратно. Итог этой
 * работы раньше выбрасывался, а сбой уходил только в консоль: человек не
 * знал ни что Astral вернул игру как было, ни что вернуть не вышло и GTA V
 * пока лучше не запускать.
 *
 * Отчёт отдаётся окну один раз: перезагрузка окна не повторяет всплывашки.
 * Восстановление Vanilla Guard идёт уже при открытом окне, поэтому отчёт
 * ждёт его, а не отвечает тем, что успело.
 */
export function createStartupRecovery() {
  let library = null;
  let vanilla = Promise.resolve([]);
  /* Итог стража регистрации DLC одежды (clothing-registration-heal.js): появляется позже старта, поэтому окно забирает его отдельным каналом, не общим отчётом. */
  let clothing = [];
  return {
    /* `"rolled-back" | "committed" | "partial" | "failed" | null` */
    recordLibrary(outcome) {
      library = outcome || null;
    },
    recordVanilla(outcomes) {
      vanilla = Promise.resolve(outcomes).catch(() => []);
    },
    /* `{ outcome: "restored" | "failed" | "held", code, cause, why, packs, at }`: итоги ждут окна по очереди (до восьми, старейший уходит первым), страж паков и страж регистрации могут отчитаться подряд. */
    recordClothing(result) {
      if (!result) return;
      clothing.push(result);
      if (clothing.length > 8) clothing.shift();
    },
    /* Один итог — объектом, несколько — массивом; пусто — `null`. */
    takeClothing() {
      const results = clothing;
      clothing = [];
      return results.length === 0
        ? null
        : results.length === 1
          ? results[0]
          : results;
    },
    async take() {
      const report = { library, vanilla: await vanilla };
      library = null;
      vanilla = Promise.resolve([]);
      return report;
    },
    /* Канал окна: отчёт один раз. */
    register({ IPC, handleIpc, trusted }) {
      handleIpc(IPC.STARTUP_RECOVERY, (event) =>
        trusted(event, () => this.take()),
      );
      handleIpc(IPC.CLOTHING_REGISTRATION_TAKE, (event) =>
        trusted(event, () => this.takeClothing()),
      );
    },
  };
}
