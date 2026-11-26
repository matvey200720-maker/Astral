/*
 * Три вопроса главному процессу о запущенной игре: можно ли сейчас менять её файлы, что из найденного похоже на зависшую
 * GTA V и «закрыть» по нажатию человека. Модуль ленивый: в стартовый кусок окна не входит.
 */
const installedBridge = () => globalThis.window?.modovik?.installed;

/**
 * Можно ли сейчас менять игру. Пока человек играет, спрашиваем только список процессов (`workshopGameRunning`, миллисекунды):
 * полная проверка ещё и ищет установки игры по дискам. Игры в списке нет — те же условия, что у самой установки
 * (`inspectInstallRuntime`: заглушка BattlEye, обновление лаунчером). Без Astral Desktop — «можно»; спросить не вышло —
 * «нельзя»: ставить вслепую незачем.
 */
export async function inspectGameWritable(targetId) {
  const guard = installedBridge()?.guard;
  if (!guard) return { ok: true };
  try {
    if ((await globalThis.window?.modovik?.workshopGameRunning?.())?.running)
      return { ok: false, reason: "game-running" };
    return (await guard({ targetId })) || { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function listHungGames() {
  try {
    return (await installedBridge()?.hung?.())?.hung || [];
  } catch {
    return [];
  }
}

export async function closeHungGame(pid) {
  const close = installedBridge()?.closeHung;
  if (!close) return { closed: false, reason: "denied" };
  try {
    return (await close({ pid })) || { closed: false, reason: "denied" };
  } catch {
    return { closed: false, reason: "denied" };
  }
}
