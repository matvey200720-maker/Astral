import Button from "../../components/ui/Button.jsx";
import { failureTicket } from "../../utils/installFailure.js";
import { createElement as h, useState } from "react";

export default function FailureDetails(props) {
  const [copied, setCopied] = useState(false);
  const { detail, onOpenLogs } = props;
  if (!detail && !onOpenLogs) return null;

  const [summary, copyLabel, copiedLabel, logsLabel] = wordsFor(props.language);
  const confirmCopied = () => {
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), CONFIRM_MS);
  };
  const copy = () => writeClipboard(failureTicket({ title: props.title, kind: props.kind, detail }), confirmCopied);

  return h(
    "div",
    { className: "failure-details" },
    detail ? expandable(summary, detail, linkButton(copied ? copiedLabel : copyLabel, copy)) : null,
    onOpenLogs ? linkButton(logsLabel, onOpenLogs) : null,
  );
}

// Незнакомый язык (и null) — английские слова; не заданный — русские.
function wordsFor(language = "ru") {
  return WORDS.get(language) ?? WORDS.get("en");
}

function linkButton(text, onClick) {
  return h(Button, { variant: "link", size: "sm", onClick }, text);
}

function expandable(summary, raw, copyButton) {
  return h("details", null, h("summary", null, summary), h("pre", null, raw), copyButton);
}

// Отказ буфера (в том числе его отсутствие) не показываем: текст остаётся на экране.
function writeClipboard(text, onWritten) {
  let pending;
  try {
    pending = navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  Promise.resolve(pending).then(onWritten, () => {});
}

const CONFIRM_MS = 2000;

// Порядок слов: заголовок блока, копирование, подтверждение, логи.
const WORDS = new Map([
  ["ru", ["Подробности", "Скопировать для тикета", "Скопировано", "Открыть логи"]],
  ["uk", ["Подробиці", "Скопіювати для тікета", "Скопійовано", "Відкрити логи"]],
  ["en", ["Details", "Copy for a ticket", "Copied", "Open logs"]],
  ["de", ["Details", "Für Ticket kopieren", "Kopiert", "Protokolle öffnen"]],
  ["pl", ["Szczegóły", "Skopiuj do zgłoszenia", "Skopiowano", "Otwórz logi"]],
  ["fr", ["Détails", "Copier pour un ticket", "Copié", "Ouvrir les journaux"]],
]);
