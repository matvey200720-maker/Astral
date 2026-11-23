// Подтверждение удаления одной ветки Astral.
// Данные (настройки, вход, кэш) общие у всех веток: пока стоит другая ветка, галочка
// «Удалить мои данные» недоступна, а выключена она по умолчанию по просьбе команды (13.10.2026).
import { h } from "../dom.js";
import { productName } from "../format.js";
import { button, callout, check, kv, screen } from "../parts.js";

// Кнопки подвала: [ключ подписи, вид, значок слева, действие окна].
const FOOT = [
  ["uninstall.confirm", "danger", "trash", "uninstall"],
  ["uninstall.keep", "ghost", null, "quit"],
];

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

export function mountUninstall(ctx) {
  const { t } = ctx;
  let current = ctx.state.uninstall;
  const { channel, installed } = current;
  const shared = Boolean(installed?.length);
  const hint = shared
    ? t("uninstall.deleteDataShared", { names: installed.map((entry) => productName(entry.channel)).join(", ") })
    : t("uninstall.deleteDataHint");

  const notice = node(["div", { role: "status" }]);
  const toggle = check({
    disabled: shared,
    hint,
    label: t("uninstall.deleteData"),
    onChange: (value) => ctx.actions.setDeleteUserData(value),
  });
  // Что удалится и что останется: по BRIDGE.md «Режим удаления» хост всегда стирает папку ветки, её ярлыки и ключ удаления, а файлы игры и моды
  // не трогает никогда; общие данные уходят только с галочкой и только когда других веток нет. Строка «останется» следит за галочкой.
  const stayValue = node(["span"]);
  const summary = kv([
    { label: t("uninstall.willGo"), value: t("uninstall.willGoText") },
    { label: t("uninstall.willStay"), value: stayValue },
  ]);
  const listing = node(["pre.details"]);
  const folders = node(["div", { hidden: true }, ["div.field-label-row", t("uninstall.folders")], listing]);

  const [dropBtn, keepBtn] = FOOT.map(([key, variant, iconName, act]) =>
    button({
      block: variant === "danger",
      iconName,
      label: t(key),
      onClick: () => ctx.actions[act](),
      variant,
    }),
  );

  const paint = () => {
    const { appRunning, deleteUserData, userDataDirs } = current;
    const dirs = userDataDirs ?? [];
    const warnings = appRunning ? [callout({ text: t("uninstall.running"), tone: "warning" })] : [];
    notice.replaceChildren(...warnings);
    toggle.control.checked = Boolean(deleteUserData);
    // Данные Astral уходят только с галочкой и когда других веток нет; иначе они остаются вместе с играми и модами.
    stayValue.textContent = t(deleteUserData && !shared ? "uninstall.stayGame" : "uninstall.stayAll");
    folders.hidden = !(deleteUserData && dirs.length > 0);
    listing.textContent = dirs.join("\n");
  };
  paint();

  return {
    el: screen("uninstall", {
      body: [node(["div.body-center", notice, summary, toggle, folders])],
      foot: [dropBtn, node(["div.screen-foot-row", ["span"], keepBtn])],
      text: t("uninstall.text"),
      title: t("uninstall.title", { name: productName(channel) }),
    }),
    update(fresh) {
      current = fresh.uninstall;
      paint();
    },
  };
}
