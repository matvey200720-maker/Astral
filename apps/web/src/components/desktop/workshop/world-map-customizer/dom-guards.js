// Кому принадлежит клавиатура: полю ввода или окну поверх карты.
const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const WINDOW_SELECTOR =
  '[role="dialog"]:not([data-ui-tour]):not(.wmc-plate), [role="alertdialog"]';

export const isFieldTarget = (target) => Boolean(target) && FIELD_TAGS.has(target.tagName);

export const isEditableTarget = (target) => isFieldTarget(target) || Boolean(target && target.isContentEditable);

// Есть окно (в том числе выезжающее меню и подсказки клавиш): карта молчит
export const windowIsOpen = () => Boolean(document.querySelector(WINDOW_SELECTOR));

// Вызов, которому можно отказать (память браузера закрыта): отказ даёт запасное значение
export const attempt = (job, fallback) => {
  let outcome = fallback;
  try {
    outcome = job();
  } catch {
    // отказ: остаётся запасное значение
  }
  return outcome;
};
