// Логика показа веток Astral (релиз, бета, альфа) по нормализованному снимку веток
// (docs/beta/channels-launcher.md, §5). Функции читают только нужные поля: недостающие - ложные.

// Ветка без сведений и без файлов в списке не нужна; со снятым доступом остаётся (файлы не трогаются)
export const visibleBranches = (state) =>
  state.branches.filter(
    (b) => b.access === "denied" || b.current || (b.available && b.access === "ok") || b.installed || b.busy,
  );

// Порядок важен: ошибка выше всего, занятая выше открытой, открытая выше снятого доступа
export function branchKind(b) {
  if (b.busy?.phase === "error") return "error";
  if (b.busy) return "busy";
  if (b.current) return "current";
  if (b.access === "denied") return "denied";
  return b.installed ? "installed" : "available";
}

export function branchAction(b) {
  const kind = branchKind(b);
  if (kind === "available") return "install";
  if (kind === "installed" || (kind === "error" && b.installed)) return "open";
  return kind === "error" && b.available && b.access === "ok" ? "retry" : null;
}

// Предлагаем первую подходящую в порядке списка (его задаёт главный процесс); knownAt строго null -
// сервер ещё не отвечал, по неполным сведениям не предлагаем
export function offerCandidate(state, options = {}) {
  const { dismissed = () => false } = options;
  if (state.knownAt === null || !state.enabled) return null;
  for (const b of state.branches) {
    if (b.access === "ok" && b.available && !(b.current || b.installed || b.busy) && !dismissed(b.channel)) return b;
  }
  return null;
}

export const hasOtherBranches = (state) => !visibleBranches(state).every((b) => b.current);

// Ошибка установки тоже возвращается: карточка покажет её
export function installingBranch(state, options = {}) {
  const { hidden = () => false } = options;
  for (const b of state.enabled ? state.branches : []) {
    if (b.busy?.kind === "install" && !hidden(b.channel)) return b;
  }
  return null;
}

// Ход установки ветки приводится к виду хода скачивания, чтобы строка хода была общей
export function busyFacts(busy) {
  if (!busy?.transfer) return null;
  const facts = { ...busy.transfer, percent: busy.percent ?? 0 };
  return { ...facts, share: facts.percent / 100 };
}
