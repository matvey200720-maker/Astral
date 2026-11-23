/*
 * Инструменты и клавиши студии текстур (ТЗ 18.10.2026, Session 1, задача 6):
 * те же буквы, что у привычных графических редакторов. Чистые данные и разбор
 * нажатия — без DOM, чтобы окно «Все клавиши · F1» и сама студия читали одну
 * таблицу, а тест проверял, что ни одна клавиша не занята дважды.
 */

/**
 * Инструменты: `key` — буква (с Shift листает виды инструмента), `kinds` —
 * виды одного инструмента (первый — по умолчанию). `options` — какие органы
 * в строке настроек сверху: `size`, `hardness`, `opacity`, `flow`,
 * `tolerance`, `feather`, `colour`, `contiguous`, `selectionOp`, `text`,
 * `shape`, `gradient`, `amount`, `range`, `aligned`, `sample`.
 */
export const TOOLS = Object.freeze([
  { id: "move", key: "v", label: "Перемещение", note: "Двигает слой или выделенное; у картинки — ещё и размер", kinds: [], options: ["autoSelect"], group: "view" },
  { id: "marquee", key: "m", label: "Область", note: "Прямоугольная или овальная область", kinds: ["rect", "ellipse"], options: ["selectionOp", "feather"], group: "select" },
  { id: "lasso", key: "l", label: "Лассо", note: "Область от руки или ломаной (щелчки по углам)", kinds: ["free", "polygon"], options: ["selectionOp", "feather"], group: "select" },
  { id: "wand", key: "w", label: "Волшебная палочка", note: "Область по близости цвета", kinds: [], options: ["selectionOp", "tolerance", "contiguous", "sampleAll", "feather"], group: "select" },
  { id: "brush", key: "b", label: "Кисть", note: "Рисует цветом: размер, жёсткость, непрозрачность", kinds: [], options: ["size", "hardness", "opacity", "flow", "colour"], group: "paint" },
  { id: "eraser", key: "e", label: "Ластик", note: "Стирает до прозрачного", kinds: [], options: ["size", "hardness", "opacity"], group: "paint" },
  { id: "fill", key: "g", label: "Заливка", note: "Ведро (по близости цвета) и градиент", kinds: ["bucket", "linear", "radial"], options: ["colour", "opacity", "tolerance", "contiguous", "gradient"], group: "paint" },
  { id: "stamp", key: "s", label: "Штамп", note: "Копирует кусок: Alt — взять образец", kinds: [], options: ["size", "hardness", "opacity", "aligned", "sampleAll"], group: "retouch" },
  { id: "heal", key: "j", label: "Восстанавливающая кисть", note: "Как штамп, но подгоняет цвет и светлоту под место", kinds: [], options: ["size", "hardness", "opacity", "aligned", "sampleAll"], group: "retouch" },
  { id: "tone", key: "o", label: "Осветлитель / затемнитель", note: "Осветляет или затемняет тоном", kinds: ["dodge", "burn"], options: ["size", "hardness", "amount", "range"], group: "retouch" },
  { id: "soften", key: "r", label: "Размытие / резкость / палец", note: "Размывает, подчёркивает или растирает", kinds: ["blur", "sharpen", "smudge"], options: ["size", "hardness", "amount"], group: "retouch" },
  { id: "picker", key: "i", label: "Пипетка", note: "Берёт цвет с холста: Alt — цвет фона", kinds: [], options: ["sampleAll"], group: "paint" },
  { id: "text", key: "t", label: "Текст", note: "Щёлкните по холсту и пишите", kinds: [], options: ["text", "colour"], group: "object" },
  { id: "shape", key: "u", label: "Фигуры", note: "Линия, стрелка, прямоугольник, овал", kinds: ["line", "arrow", "rect", "ellipse"], options: ["shape", "colour"], group: "object" },
  { id: "hand", key: "h", label: "Рука", note: "Двигает холст; пробел — на время", kinds: [], options: [], group: "view" },
  { id: "zoom", key: "z", label: "Масштаб", note: "Щелчок — ближе, Alt — дальше; рамка — на область", kinds: [], options: [], group: "view" },
]);

export const TOOL_IDS = Object.freeze(TOOLS.map((tool) => tool.id));
export const toolOf = (id) => TOOLS.find((tool) => tool.id === id) || TOOLS[0];
export const toolByKey = (key) => TOOLS.find((tool) => tool.key === String(key || "").toLowerCase()) || null;

/** Следующий вид инструмента по кругу (Shift + буква). */
export function nextKind(tool, current) {
  const kinds = toolOf(tool).kinds;
  if (!kinds.length) return current;
  return kinds[(Math.max(0, kinds.indexOf(current)) + 1) % kinds.length];
}

/**
 * Действия по клавишам. `keys` — как их показывает окно «Все клавиши»;
 * `match` — как их узнаёт обработчик (`key` без регистра, `mod` — Ctrl/Cmd,
 * `shift`, `alt`).
 */
export const SHORTCUTS = Object.freeze([
  { id: "undo", keys: "Ctrl + Z", label: "Отменить", match: { key: "z", mod: true, shift: false }, group: "history" },
  { id: "redo", keys: "Ctrl + Shift + Z / Ctrl + Y", label: "Вернуть", match: { key: "z", mod: true, shift: true }, alt: { key: "y", mod: true }, group: "history" },
  { id: "select-all", keys: "Ctrl + A", label: "Выделить всё", match: { key: "a", mod: true }, group: "select" },
  { id: "deselect", keys: "Ctrl + D", label: "Снять выделение", match: { key: "d", mod: true }, group: "select" },
  { id: "invert-selection", keys: "Ctrl + Shift + I", label: "Обратить выделение", match: { key: "i", mod: true, shift: true }, group: "select" },
  { id: "clear", keys: "Delete", label: "Стереть выделенное", match: { key: "delete" }, group: "select" },
  { id: "new-layer", keys: "Ctrl + Shift + N", label: "Новый слой", match: { key: "n", mod: true, shift: true }, group: "layers" },
  { id: "duplicate-layer", keys: "Ctrl + J", label: "Дублировать слой", match: { key: "j", mod: true }, group: "layers" },
  { id: "merge-down", keys: "Ctrl + E", label: "Склеить с нижним", match: { key: "e", mod: true, shift: false }, group: "layers" },
  { id: "export", keys: "Ctrl + Shift + E", label: "Экспорт PNG", match: { key: "e", mod: true, shift: true }, group: "file" },
  { id: "place", keys: "Ctrl + Enter", label: "Поставить на место", match: { key: "enter", mod: true }, group: "file" },
  { id: "fit", keys: "Ctrl + 0", label: "Вписать в окно", match: { key: "0", mod: true }, group: "view" },
  { id: "actual", keys: "Ctrl + 1", label: "100 %", match: { key: "1", mod: true }, group: "view" },
  { id: "zoom-in", keys: "+", label: "Ближе", match: { key: "+" }, alt: { key: "=" }, group: "view" },
  { id: "zoom-out", keys: "−", label: "Дальше", match: { key: "-" }, group: "view" },
  { id: "brush-smaller", keys: "[", label: "Кисть меньше", match: { key: "[" }, group: "paint" },
  { id: "brush-larger", keys: "]", label: "Кисть больше", match: { key: "]" }, group: "paint" },
  { id: "swap-colours", keys: "X", label: "Цвет и фон местами", match: { key: "x" }, group: "paint" },
  { id: "default-colours", keys: "D", label: "Чёрный и белый", match: { key: "d", mod: false }, group: "paint" },
  { id: "commit", keys: "Enter", label: "Принять правку (текст, область)", match: { key: "enter" }, group: "edit" },
  { id: "cancel", keys: "Esc", label: "Отменить правку", match: { key: "escape" }, group: "edit" },
  { id: "help", keys: "F1", label: "Все клавиши", match: { key: "f1" }, group: "help" },
]);

const same = (rule, event) =>
  String(event.key || "").toLowerCase() === rule.key &&
  (rule.mod === undefined || Boolean(event.ctrlKey || event.metaKey) === rule.mod) &&
  (rule.shift === undefined || Boolean(event.shiftKey) === rule.shift) &&
  (rule.alt === undefined || Boolean(event.altKey) === rule.alt);

/**
 * Что значит нажатие: `{ type: "shortcut", id }`, `{ type: "tool", id, cycle }`
 * (буква инструмента; Shift — следующий вид) или `null`.
 */
export function resolveKey(event) {
  const modifier = Boolean(event.ctrlKey || event.metaKey);
  for (const shortcut of SHORTCUTS) {
    if (same(shortcut.match, event) || (shortcut.alt && same(shortcut.alt, event))) return { type: "shortcut", id: shortcut.id };
  }
  if (!modifier && !event.altKey) {
    const tool = toolByKey(event.key);
    if (tool) return { type: "tool", id: tool.id, cycle: Boolean(event.shiftKey) };
  }
  return null;
}

/** Все клавиши без повторов: буквы инструментов не занимают клавиш действий. */
export function keyConflicts() {
  const seen = new Map();
  const conflicts = [];
  const add = (label, rule) => {
    const code = [rule.mod ? "mod" : "", rule.shift ? "shift" : "", rule.alt ? "alt" : "", rule.key].filter(Boolean).join("+");
    if (seen.has(code)) conflicts.push([seen.get(code), label]);
    else seen.set(code, label);
  };
  for (const shortcut of SHORTCUTS) {
    add(shortcut.id, { ...shortcut.match, shift: shortcut.match.shift === true, mod: shortcut.match.mod === true });
    if (shortcut.alt) add(shortcut.id, { ...shortcut.alt, shift: false, mod: shortcut.alt.mod === true });
  }
  for (const tool of TOOLS) add(`tool:${tool.id}`, { key: tool.key, mod: false, shift: false });
  return conflicts;
}
