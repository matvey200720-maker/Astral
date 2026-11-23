import { createElement as h } from "react";
import { ArrowClockwise, Check, DownloadSimple } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { requestDownloadsPanel } from "../../../../features/downloads/open-requests.js";
import { tr } from "../../../../locales/ui.js";

/*
 * Кнопка установки компонента из нескольких пакетов (ТЗ ведущей 10.11.2026: «таймцикл — два пакета одного слота, одна строка»): одна кнопка на весь слот.
 * Состояния те же, что у кнопки одной части (`PartActions`): «Установить», «В очереди», «Ставится N %», «Повторить», «Установлено · Снять» — только
 * считаются по всем пакетам. Ставятся не стоящие, снимаются стоящие; ход идёт через ту же очередь «Загрузок», что и кнопки частей.
 */

const bold = (Glyph) => h(Glyph, { weight: "bold" });

const percentOf = (entries) => {
  const started = entries.filter((entry) => entry.started);
  const sum = started.reduce((total, entry) => total + (Number(entry.progress) || 0), 0);
  return Math.min(99, Math.max(0, Math.round(started.length ? sum / started.length : 0)));
};

// Состояние по всем пакетам: отказ главнее хода, ход — «стоит», «стоит» — «не стоит».
function stateOf(packages, parts) {
  const queued = (parts.queue || []).filter((item) => packages.some((part) => part.id === item.id) && item.operation !== "remove");
  const failed = queued.find((item) => item.failed);
  if (failed) return { state: "failed", entry: failed };
  if (queued.length) return { state: queued.some((item) => item.started) ? "running" : "queued", entries: queued };
  if (packages.every((part) => parts.installed.includes(part.id))) return { state: "installed" };
  return { state: "idle" };
}

/**
 * @param {{ packages: object[], parts: object, copy: object, name: string }} props `copy` — слова окна «Компоненты» (`packContentsCopy`), `name` — имя компонента.
 */
export default function ComponentPackages({ packages, parts, copy, name }) {
  const found = stateOf(packages, parts);
  const source = () => document.querySelector("[data-part-root] img") || document.body;
  const look = {
    failed: { variant: "secondary", icon: bold(ArrowClockwise), label: copy.retry, onClick: () => parts.retry?.(found.entry.queueId) },
    running: { variant: "primary", icon: bold(DownloadSimple), label: copy.running(percentOf(found.entries || [])), onClick: () => requestDownloadsPanel() },
    queued: { variant: "primary", icon: bold(DownloadSimple), label: copy.queued, onClick: () => requestDownloadsPanel() },
    installed: {
      variant: "secondary",
      icon: bold(Check),
      label: parts.remove ? `${copy.installed} · ${copy.remove(name)}` : copy.installed,
      onClick: parts.remove ? () => packages.forEach((part) => parts.remove(part)) : null,
    },
    idle: {
      variant: "primary",
      icon: bold(DownloadSimple),
      label: copy.install(name),
      onClick: () => packages.filter((part) => !parts.installed.includes(part.id)).forEach((part) => parts.install(part, source())),
    },
  }[found.state];
  return (
    <span className="mod-part-actions is-panel">
      <Button
        variant={look.variant}
        size="md"
        icon={look.icon}
        ariaLabel={look.label}
        title={look.label}
        aria-disabled={look.onClick ? undefined : "true"}
        aria-busy={found.state === "running" || found.state === "queued" ? "true" : undefined}
        className={`mod-part-action is-install is-labelled is-${found.state}`}
        onClick={look.onClick ?? undefined}
      >
        {tr(
          { idle: "Установить", queued: "В очереди", running: "Ставится", failed: "Повторить", installed: "Установлено" }[found.state],
        ) + (found.state === "running" ? ` ${percentOf(found.entries || [])}%` : "")}
      </Button>
    </span>
  );
}
