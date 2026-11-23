import { trKey } from "./gun-copy.js";

// Перечень клавиш мастерской. Строки — ключи словаря интерфейса (русские,
// дословно): перевод подставляет окно подсказки при показе.

const RMB = trKey("ПКМ");
const MMB = trKey("СКМ");
const WHEEL = trKey("Колесо");
const wheel = trKey("колесо");
const click = trKey("щелчок");

// Поле weaponOnly есть только у помеченных записей и групп.
const row = (keys, label, weaponOnly = false) =>
  weaponOnly ? { keys, label: trKey(label), weaponOnly: true } : { keys, label: trKey(label) };

const section = (title, items, weaponOnly = false) =>
  weaponOnly
    ? { group: trKey(title), weaponOnly: true, items }
    : { group: trKey(title), items };

// Заморожен только внешний массив: группы и записи остаются обычными объектами.
export const GUN_SHORTCUTS = Object.freeze([
  section("Инструменты", [
    row(["V"], "Модели — левая кнопка крутит модель"),
    row(["M"], "Оружие — размер и материал ствола"),
    row(["B"], "Кисть"),
    row(["E"], "Ластик"),
    row(["G"], "Заливка детали"),
    row(["I"], "Пипетка"),
    row(["S"], "Наклейки — эмблемы и свои картинки"),
    row(["T"], "Текст — надписи"),
    row(["K"], "Украшения — цветы, лоза, голограмма, звёздочки, брелоки, логотип", true),
  ]),
  section("Камера", [
    row([RMB], "Вращать — при любом инструменте"),
    row([MMB], "Сдвинуть"),
    row([WHEEL], "Приблизить или отдалить"),
  ]),
  section("Шаблоны", [row(["D"], "Случайный скин")]),
  section("Кисть и наклейки", [
    row(["[", "]"], "Размер кисти"),
    row([WHEEL], "Повернуть наклейку в руке"),
    row(["Shift", wheel], "Размер наклейки в руке"),
    row(["Shift", click], "Приклеить и оставить в руке"),
    row(["Q", "E"], "Повернуть выбранную наклейку"),
    row(["R"], "Повернуть на 90°"),
    row(["Delete"], "Удалить выбранную наклейку"),
    row(["Esc"], "Убрать из руки или снять выбор"),
  ]),
  section(
    "Украшения",
    [
      row([WHEEL], "Повернуть украшение в руке"),
      row(["Shift", wheel], "Размер украшения в руке"),
      row(["Shift", click], "Поставить и оставить в руке"),
      row(["Q", "E"], "Повернуть выбранное украшение"),
      row(["R"], "Повернуть на 90°"),
      row(["Delete"], "Снять выбранное украшение"),
    ],
    true,
  ),
  section("Правка", [
    row(["Ctrl", "Z"], "Отменить"),
    row(["Ctrl", "Y"], "Вернуть (или Ctrl + Shift + Z)"),
    row(["?"], "Эта подсказка"),
  ]),
]);
