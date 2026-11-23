/*
 * Имена и категории вещей по внутреннему имени модели игры — общее у редакторов, где опись вещей даёт только имена моделей
 * (маппинг, Мегамолл, Ашан / Икея; арены и интерьеры называют вещи своими таблицами). Таблицы правил лежат в контракте
 * (`@modovik/climb-contract/recolor/scene-item-rules`): их читает и выпечка (род вещи, оболочка), и окно (имя и категория).
 * Правило называет и категорию, и имя; шаблон — русская фраза (ключ словаря), `{0}` — число из имени модели; нет числа —
 * шаблон без вставки. Модель, которой в таблице нет, уходит в последнюю категорию, имя — внутреннее.
 *
 * Без React и three: тесты проверяют таблицы редакторов на настоящих описях.
 */

import { itemRuleOf, itemRuleTexts, plainNumber } from "@modovik/climb-contract/recolor/scene-item-rules";
import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

export { itemRuleTexts, plainNumber };

/** Категория модели: из таблицы или `fallback`. */
export const itemCategoryOf = (rules, model, fallback = "other") => itemRuleOf(rules, model?.name)?.category || fallback;

/** Имя модели для человека на языке окна; нет в таблице — внутреннее имя. */
export function itemTitleOf(rules, model) {
  const rule = itemRuleOf(rules, model?.name);
  if (!rule) return model?.name || "";
  if (!rule.title.includes("{0}")) return tr(rule.title);
  /* «Поле фермы» без числа в имени — просто «Поле фермы»: вставка только там, где число есть. */
  return rule.number ? trFill(rule.title, rule.number) : tr(rule.title.replace(/[\s,]*\{0\}/, ""));
}
