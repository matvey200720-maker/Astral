/*
 * Потолки идущей команды движка в режиме «процесс на команду» (20.11.2026, регулятор диска, `docs/DISK-GOVERNOR-2011.md`).
 *
 * Движок в поставке — процесс на команду: потолки записи и чтения он получает аргументами при запуске, а `compose-rpf` идёт 20–35 с. Регулятор диска меняет потолки по занятости диска,
 * поэтому их нужно менять и посреди команды. Резидентный режим (`serve`) для этого есть (`changeRunningInstallLimits`); процессу на команду потолок шлётся строкой в его stdin — туда же, куда
 * строка отмены: `limits write=<МБ/с> read=<МБ/с>` (ноль — без потолка). Движок с этой возможностью (`disk.rs: change_from_line`) применяет её на ходу; прежний движок читает stdin ради строки
 * `cancel` и все остальные строки отбрасывает, так что лишняя строка ему не мешает.
 */

const whole = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** Строка управления потолками; `null` и мусор — «без потолка». */
export const limitsLine = (writeMbps, readMbps) =>
  `limits write=${whole(writeMbps)} read=${whole(readMbps)}\n`;

/**
 * Реестр идущих команд: `track(child, line)` запоминает процесс и строку, с которой он запущен (его аргументы); `push(line)` шлёт новую строку тем, у кого она другая.
 * Вышедший процесс из реестра уходит сам. Сбой записи в трубу процессу не вредит.
 */
export function createLimitsRegistry() {
  const entries = new Set();
  return {
    track(child, line) {
      if (!child?.stdin || typeof child.stdin.write !== "function")
        return () => {};
      child.stdin.on?.("error", () => {});
      const entry = { child, line };
      entries.add(entry);
      const forget = () => entries.delete(entry);
      child.once?.("exit", forget);
      return forget;
    },
    push(line) {
      let sent = 0;
      for (const entry of entries) {
        if (entry.line === line) continue;
        entry.line = line;
        try {
          if (
            entry.child.stdin.writable !== false &&
            !entry.child.stdin.destroyed
          ) {
            entry.child.stdin.write(line);
            sent += 1;
          }
        } catch {
          /* труба закрыта: команда уже заканчивается */
        }
      }
      return sent;
    },
    size: () => entries.size,
  };
}
