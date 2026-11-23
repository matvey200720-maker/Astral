// Горячие клавиши большой карты: справочник для окна подсказок и разбор
// нажатия в имя команды. Буквы узнаются на любой раскладке (через hotkey).
import { hotkey } from "../../../utils/hotkeys.js";
import { tr } from "../../../locales/ui.js";

const platformName = typeof navigator === "undefined" ? "" : navigator.platform || "";

export const MOD = /Mac|iPhone|iPad/.test(platformName) ? "\u2318" : "Ctrl";

const row = (keys, label) => ({ keys, label });
const withMod = (...rest) => [MOD, ...rest];

// Справочник собирается по-русски: перевод делает mapShortcutGroups при вызове.
export const MAP_SHORTCUTS = Object.freeze([
  {
    group: "Объект",
    items: [
      row(["F2"], "Переименовать в «Слоях» (или двойной щелчок по строке)"),
      row(["Enter"], "Надпись — править текст на карте, остальное — переименовать"),
      row(["Delete"], "Удалить выбранное"),
      row(withMod("D"), "Дублировать"),
      row(withMod("C"), "Копировать"),
      row(withMod("V"), "Вставить в середину кадра"),
      row(withMod("G"), "Сгруппировать выделенное"),
      row(withMod("Shift", "G"), "Разгруппировать"),
      row(withMod("]"), "Выше в «Слоях»"),
      row(withMod("["), "Ниже в «Слоях»"),
      row(["Shift", "щелчок"], "Добавить к выделению или убрать"),
      row(["Shift", "протяжка"], "Выделить рамкой"),
      row(["Двойной щелчок"], "Объект внутри группы"),
      row(withMod("Shift", "H"), "Скрыть или показать"),
      row(withMod("Shift", "L"), "Закрепить или открепить"),
      row(["\u2190", "\u2191", "\u2192", "\u2193"], "Сдвинуть на точку экрана"),
      row(["Shift", "стрелка"], "Сдвинуть на десять"),
      row(["Esc"], "Снять выбор, выйти из инструмента"),
    ],
  },
  {
    group: "Карта",
    items: [
      row(["Пробел", "мышь"], "Двигать карту при любом инструменте"),
      row(["ПКМ"], "Меню объекта; с протяжкой — двигать карту"),
      row(["Колесо"], "Приблизить к курсору; щипок — тоже"),
      row(["Shift", "1"], "Весь штат"),
      row(["Shift", "2"], "К выбранному объекту"),
    ],
  },
  {
    group: "Панели",
    items: [row(withMod("F"), "Найти слой"), row(["?"], "Эта подсказка")],
  },
  {
    group: "Правка",
    items: [row(withMod("Z"), "Отменить"), row(withMod("Shift", "Z"), "Вернуть")],
  },
]);

const translateGroup = ({ group, items }) => ({
  group: tr(group),
  items: items.map(({ keys, label }) => ({ keys: keys.map((key) => tr(key)), label: tr(label) })),
});

export function mapShortcutGroups(tools = []) {
  const groups = MAP_SHORTCUTS.map(translateGroup);
  const lettered = tools.filter((tool) => tool.shortcut && !tool.hidden);
  if (lettered.length === 0) return groups;
  const toolGroup = {
    group: tr("Инструменты"),
    items: lettered.map((tool) => ({
      keys: [String(tool.shortcut).toUpperCase()],
      label: tool.label,
    })),
  };
  return [toolGroup, ...groups];
}

// Клавиша-буква -> команда: отдельно для Ctrl/Cmd и для Ctrl/Cmd + Shift.
const WITH_MODIFIER = new Map([
  ["g", "group"],
  ["d", "duplicate"],
  ["c", "copy"],
  ["v", "paste"],
  ["f", "find"],
]);
const WITH_MODIFIER_SHIFT = new Map([
  ["g", "ungroup"],
  ["h", "toggle-hidden"],
  ["l", "toggle-locked"],
]);

export function mapCommand(event) {
  if (event.key === "F2") return "rename";
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);
  const code = event.code;

  if (event.ctrlKey || event.metaKey) {
    if (alt) return null;
    if (code === "BracketRight") return "forward";
    if (code === "BracketLeft") return "backward";
    const table = shift ? WITH_MODIFIER_SHIFT : WITH_MODIFIER;
    return table.get(hotkey(event)) ?? null;
  }
  if (alt) return null;

  if (shift && code === "Digit1") return "zoom-fit";
  if (shift && code === "Digit2") return "zoom-selection";
  if (event.key === "?" || (shift && code === "Slash")) return "shortcuts";
  return event.key.startsWith("Arrow") ? "nudge" : null;
}
