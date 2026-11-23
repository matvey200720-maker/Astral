// Окна поверх экрана: «Прервать установку?» (два вида) и три окна «Подождите…».
import { h } from "../dom.js";
import { button } from "../parts.js";

// Кнопка окна: [ключ подписи, вид, действие окна].
const STAY = ["closing.stay", "primary", "dismissDialog"];
const GOT_IT = ["closing.ok", "primary", "dismissDialog"];
// Вид окна → [ключ заголовка, ключ текста, ...кнопки]. Слова у closing (крестик, выход из установщика)
// и cancel (кнопка на скачивании, возврат к вводу кода) общие, различается вторая кнопка.
const KINDS = {
  closing: ["closing.title", "closing.text", STAY, ["closing.quit", "danger", "confirmClose"]],
  cancel: ["closing.title", "closing.text", STAY, ["closing.cancel", "danger", "confirmCancel"]],
  "busy-update": ["closing.busyUpdateTitle", "closing.busyUpdateText", GOT_IT],
  "busy-side": ["closing.busySideTitle", "closing.busySideText", GOT_IT],
  "busy-uninstall": ["closing.busyUninstallTitle", "closing.busyUninstallText", GOT_IT],
};

// Узел по описанию [«тег.класс#id», свойства?, ...дети]; дети — узлы, строки или такие же описания.
const node = (spec) => {
  if (!Array.isArray(spec)) return spec;
  const [selector, ...kids] = spec;
  const [tag, ...marks] = selector.split(/(?=[.#])/);
  const props = kids[0]?.constructor === Object ? kids.shift() : {};
  const named = (sign) => marks.filter((m) => m[0] === sign).map((m) => m.slice(1));
  const [cls, [id]] = [named(".").join(" "), named("#")];
  return h(tag, { ...(cls && { class: cls }), ...(id && { id }), ...props }, ...kids.map(node));
};

// Слова всех видов окна. Словарь опрашивается для каждого вида при каждом вызове,
// в порядке таблицы (17 вызовов): на этот порядок рассчитаны подставные `t`.
const wordsOf = (t) =>
  Object.fromEntries(
    Object.entries(KINDS).map(([kind, [title, text, ...keys]]) => [
      kind,
      { title: t(title), text: t(text), buttons: keys.map(([label, ...rest]) => [t(label), ...rest]) },
    ]),
  );

export function renderDialog(type, { t, actions }) {
  const found = wordsOf(t)[type];
  if (!found) return null;
  // Имя из прототипа таблицы («constructor» и т. п.) находится, но кнопок у него нет — TypeError.
  const actionsRow = found.buttons.map(([label, variant, act]) => button({ label, variant, block: true, onClick: () => actions[act]() }));
  return node([
    "div.dialog",
    { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "dialog-title", "aria-describedby": "dialog-text" },
    ["h2.dialog-title#dialog-title", found.title],
    ["p.dialog-text#dialog-text", found.text],
    ["div.dialog-actions", ...actionsRow],
  ]);
}
