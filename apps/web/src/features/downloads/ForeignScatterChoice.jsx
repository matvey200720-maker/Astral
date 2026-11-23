import Button from "../../components/ui/Button.jsx";
import { useTr } from "../../locales/ui.js";
import { createElement as h } from "react";

export default function ForeignScatterChoice({ onRestore }) {
  const tr = useTr();
  const action = h(Button, { size: "sm", variant: "primary", onClick: onRestore }, tr("Вернуть россыпь штатной"));

  return h(
    "section",
    { className: "foreign-build-choice foreign-scatter-choice", "aria-label": tr("Файл россыпи") },
    h("p", null, tr("Astral вернёт штатный файл россыпи и повторит эту работу.")),
    h("div", { className: "foreign-build-actions" }, action),
  );
}

// Работа карточки оптимизации, упавшая из-за чужого файла россыпи, с сохранённой целью повтора.
export function canRestoreScatter(job) {
  return RESTORE_CONDITIONS.every((holds) => holds(job));
}

export function restoreScatterTarget(job) {
  return Object.assign({}, job.saved, { forceScatter: true });
}

const CARD_KEY_PREFIX = "astral.optimization.card.";

const RESTORE_CONDITIONS = [
  (job) => job?.status === "failed",
  (job) => job.errorKind === "foreign-scatter",
  (job) => String(job.key || "").startsWith(CARD_KEY_PREFIX),
  (job) => Boolean(job.saved?.profile),
];
