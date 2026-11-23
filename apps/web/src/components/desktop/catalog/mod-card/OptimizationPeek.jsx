import { createElement, useState } from "react";
import { ArrowSquareOut, PencilSimpleLine } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import OptimizationShots from "../../../../features/workshop/OptimizationShots.jsx";
import { optimizationLayerText, optimizationPart, optimizationShotsFor } from "../../../../features/catalog/optimization-part.js";
import { modEditor } from "../../../../features/catalog/mod-editor.js";
import { optimizerCopyFor } from "../../workshop/optimizer/optimizer-copy.js";
import { humanFailure } from "../../../../utils/installFailure.js";
import { usePartInstall } from "./PartActions.jsx";

const EMPTY_INFO = { kind: "", layers: [], facts: [] };

// Что окно знает о части. Тексты слоёв и кадров — только ru или английский; остальные языки окна получают английский.
function readPart(part, windowLanguage) {
  const info = optimizationPart(part) ?? EMPTY_INFO;
  const textLanguage = windowLanguage === "ru" ? "ru" : "en";
  const fps = new Set();
  info.layers.forEach((id) => {
    const text = optimizationLayerText(id, textLanguage);
    if (text?.fps) fps.add(text.fps);
  });
  const facts = info.facts.length > 0 ? info.facts : [part.description].filter(Boolean);
  return { info, facts, fps: [...fps], shots: optimizationShotsFor(info.layers, textLanguage) };
}

// Секции тела окна: «Что меняет» и (если есть кадры) «Как это выглядит в игре».
function bodySections({ peek, info, facts, shots, failure, language }) {
  const note = (text, extra) => createElement("p", { className: "mod-peek-note", ...extra }, text);
  const changes = createElement(
    "section",
    { key: "changes", className: "mod-peek-section", "aria-labelledby": "mod-peek-changes" },
    createElement("h3", { id: "mod-peek-changes" }, peek.changes),
    createElement("ul", { className: "mod-peek-facts" }, facts.map((text, at) => createElement("li", { key: `${at}:${text}` }, text))),
    info.kind === "clouds" ? note(peek.cloudsNote) : null,
    failure ? note(failure, { role: "alert" }) : null,
  );
  if (shots.length === 0) return [changes];

  const words = optimizerCopyFor(language);
  const looks = createElement(
    "section",
    { key: "looks", className: "mod-peek-section", "aria-labelledby": "mod-peek-looks" },
    createElement("h3", { id: "mod-peek-looks" }, peek.looks),
    shots.map((shot) => createElement("div", { className: "mod-peek-shot", key: shot.key }, <OptimizationShots files={shot.files} title={shot.title} caption={shot.caption} copy={words} />)),
    note(peek.shotNote),
  );
  return [changes, looks];
}

export default function OptimizationPeek({ part, title, meta, view, copy, onClose }) {
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const install = usePartInstall(part, view.parts, copy);
  const { info, fps, facts, shots } = readPart(part, view.language);
  const { peek } = copy;
  const editor = view.parts.edit && modEditor(part);

  const runEdit = () => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    // Вызов идёт сразу; отказ, в том числе синхронный, становится причиной в секции «Что меняет».
    new Promise((resolve) => resolve(view.parts.edit(part)))
      .then(() => {
        onClose();
      })
      .catch((error) => setFailure(humanFailure(error) || String(error?.message || "")))
      .finally(() => setBusy(false));
  };

  const goToPage = { variant: "secondary", icon: createElement(ArrowSquareOut, { weight: "bold" }), onClick: () => { onClose(); view.parts.open?.(part); } };
  const editing = editor && { variant: "secondary", icon: createElement(PencilSimpleLine, { weight: "bold" }), title: view.cardCopy?.editor?.[editor.copyKey || editor.kind]?.hint, "aria-busy": busy ? "true" : undefined, onClick: runEdit };
  const working = install.state === "running" || install.state === "queued";
  const putting = { variant: install.variant, icon: install.icon, "aria-disabled": install.onClick ? undefined : "true", "aria-busy": working ? "true" : undefined, onClick: install.onClick };

  const actions = [
    <Button key="page" {...goToPage}>
      {peek.openPage}
    </Button>,
    editing ? (
      <Button key="edit" {...editing}>
        {view.cardCopy?.edit}
      </Button>
    ) : null,
    <Button key="install" {...putting}>
      {install.label}
    </Button>,
  ];
  const description = [meta, ...fps].filter(Boolean).join(" · ") || null;

  return (
    <Dialog open onClose={onClose} kicker={peek.kicker} title={title} description={description} size="lg" className="mod-peek" bodyClassName="mod-peek-body" actions={actions}>
      {bodySections({ peek, info, facts, shots, failure, language: view.language })}
    </Dialog>
  );
}
