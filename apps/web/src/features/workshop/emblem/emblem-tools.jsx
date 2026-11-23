/*
 * Инструменты «Эмблемы» и «Текст» — одинаковые у всех редакторов мест
 * (задача 1 ТЗ 04.10.2026): «Завод», «Ангар», «Маппинг», «Арена»,
 * «Мегамолл», «Ашан / Икея». Оба работают над одним списком эмблем работы
 * (`useEmblemEditor`): «Эмблемы» — свои картинки, «Текст» — надписи.
 */

import { Sticker, TextT } from "../../../components/ui/icons.jsx";
import { tr } from "../../../locales/ui.js";

/** Вид эмблем у инструмента: `text` у «Текста», `image` у остальных. */
export const emblemKindOf = (tool) => (tool === "text" ? "text" : "image");

/** Взят ли инструмент списка эмблем: «Эмблемы» или «Текст». */
export const emblemToolActive = (tool) => tool === "emblem" || tool === "text";

/** Что в руке над кадром: «Эмблема в руке» или «Надпись в руке». */
export const emblemPlacingLabel = (tool) => (tool === "text" ? tr("Текст: щёлкните по модели") : tr("Эмблема в руке"));

/**
 * Два инструмента для колонки слева. `where` — где ставятся («завода»,
 * «на фасаде»…), `shortcuts` — горячие клавиши `[эмблемы, текст]`.
 */
export function emblemTools({ where, shortcuts = [] }) {
  return [
    {
      id: "emblem",
      label: tr("Эмблемы"),
      icon: <Sticker />,
      ...(shortcuts[0] ? { shortcut: shortcuts[0] } : {}),
      group: "emblem",
      note: `Свои картинки ${where}`,
      hint: tr("Добавьте картинку справа и ставьте её левой кнопкой прямо на стену — и в полёте тоже; правой — камера"),
    },
    {
      id: "text",
      label: tr("Текст"),
      icon: <TextT />,
      ...(shortcuts[1] ? { shortcut: shortcuts[1] } : {}),
      group: "emblem",
      note: `Надписи ${where}`,
      hint: tr("Щёлкните по модели и печатайте — надпись появится на месте щелчка; двойной щелчок по ней правит слова; шрифт, цвет и размер — справа"),
    },
  ];
}
