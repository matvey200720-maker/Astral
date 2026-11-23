// Выбор ветки Astral: карточки строятся один раз, update переставляет только признаки выбора.
import { h, icon } from "../dom.js";
import { branchList } from "../branches.js";
import { productName, shortenPath } from "../format.js";
import { button, screen, stepper } from "../parts.js";

// Стрелки группы: шаг по кругу вперёд (+1) или назад (-1). Остальные клавиши группа не трогает.
const ARROWS = new Map([
  ["ArrowDown", 1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
  ["ArrowLeft", -1],
]);

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

// Куда ведёт стрелка. С выбранной карточки — по кругу; без выбранной (или если её нет
// в списке) вперёд идёт на первую, назад — на последнюю (правка 07.11.2026).
const landing = (at, step, count) => {
  const edge = step > 0 ? 0 : count - 1;
  return at < 0 ? edge : (at + step + count) % count;
};

export function mountBranch({ actions, state, t }) {
  const branches = branchList(state.confirmed);
  const standing = new Set(
    (state.confirmed?.installed ?? state.init?.installed ?? []).map((entry) => entry.channel),
  );
  let chosen = state.selected;

  const cards = branches.map(({ channel, installDir, version }) => {
    const copyParts = [
      ["b", productName(channel)],
      ["small.selectable", version ? t("branch.version", { version }) : t("branch.versionUnknown")],
    ];
    if (installDir) copyParts.push(["small.branch-dir.selectable", shortenPath(installDir)]);
    const parts = [
      node(["span.branch-radio", { "aria-hidden": "true" }, icon("check", { strokeWidth: 3 })]),
      node(["span.branch-copy", ...copyParts]),
    ];
    if (standing.has(channel)) parts.push(node(["span.chip", t("branch.installed")]));
    return h(
      "button",
      {
        type: "button",
        class: "branch-card",
        role: "radio",
        "data-branch": channel,
        onClick: () => actions.chooseBranch(channel),
      },
      ...parts,
    );
  });

  const indexOfChosen = () => branches.findIndex((entry) => entry.channel === chosen);

  const paint = () => {
    cards.forEach((card, at) => {
      const picked = branches[at].channel === chosen;
      const word = String(picked);
      const entryPoint = !chosen && at === 0;
      card.setAttribute("aria-checked", word);
      card.setAttribute("data-selected", word);
      card.setAttribute("tabindex", picked || entryPoint ? "0" : "-1");
    });
  };

  const onArrow = (event) => {
    const step = ARROWS.get(event.key);
    if (step === undefined || cards.length === 0) return;
    event.preventDefault();
    const target = landing(indexOfChosen(), step, cards.length);
    actions.chooseBranch(branches[target].channel);
    cards[target].focus();
  };

  const group = node([
    "div.branch-list",
    { role: "radiogroup", "aria-label": t("branch.label"), onKeydown: onArrow },
    ...cards,
  ]);
  const proceed = button({
    block: true,
    label: t("branch.continue"),
    onClick: () => actions.continueFromBranch(),
    trailingIcon: "arrow",
    variant: "primary",
  });

  paint();

  return {
    el: screen("branch", {
      body: [group],
      foot: [proceed],
      lead: stepper(t, 3),
      text: t("branch.text"),
      title: t("branch.title"),
    }),
    focus() {
      const at = indexOfChosen();
      if (at >= 0) cards[at].focus();
    },
    update(fresh) {
      chosen = fresh.selected;
      paint();
    },
  };
}
