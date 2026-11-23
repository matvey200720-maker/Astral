import { createElement, useState } from "react";
import { ArrowClockwise, Check, DownloadSimple, Eye, PencilSimpleLine, Stack } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import MenuButton from "../../../ui/MenuButton.jsx";
import CartButton from "../../../../features/cart/CartButton.jsx";
import { catalogWorkEditor, modEditor } from "../../../../features/catalog/mod-editor.js";
import { useQueueProgress } from "../../../../features/downloads/live-progress.js";
import { requestDownloadsPanel } from "../../../../features/downloads/open-requests.js";
import { installMapWorks } from "../../../../features/catalog/bundles/map-works.js";
import { partNamePrefixes } from "../../../../features/catalog/pack-contents.js";
import { humanFailure } from "../../../../utils/installFailure.js";
import ReduxLayerActions from "../../../../features/catalog/redux-layer/ReduxLayerActions.jsx";
import { tr } from "../../../../locales/ui.js";

const bold = (Glyph) => createElement(Glyph, { weight: "bold" });

// Куда «лететь» установке: первая картинка панели части, а вне панели — сама кнопка.
const flightFrom = (button) => button.closest("[data-part-root]")?.querySelector("img") ?? button;

const openDownloads = () => {
  requestDownloadsPanel();
};

// Процент хода: живой ход главнее записи очереди; число, целое, в пределах 0…99.
const percentOf = (live, entry) => {
  const number = Number(live ? live.progress : entry?.progress) || 0;
  return Math.min(99, Math.max(0, Math.round(number)));
};

// Состояния кнопки части в порядке проверки: условие → описание кнопки.
const STATE_RULES = [
  { when: ({ entry }) => entry?.failed, make: ({ parts, copy, entry }) => ({ state: "failed", variant: "secondary", icon: bold(ArrowClockwise), label: copy.retry, onClick: () => { parts.retry(entry.queueId); } }) },
  { when: ({ entry }) => entry?.started, make: ({ copy, percent }) => ({ state: "running", variant: "primary", icon: bold(DownloadSimple), label: copy.running(percent), onClick: openDownloads }) },
  { when: ({ entry }) => entry, make: ({ copy }) => ({ state: "queued", variant: "primary", icon: bold(DownloadSimple), label: copy.queued, onClick: openDownloads }) },
  {
    when: ({ parts, part }) => parts.installed.includes(part.id),
    make: ({ parts, part, copy, name }) => ({
      state: "installed",
      variant: "secondary",
      icon: bold(Check),
      label: parts.remove ? `${copy.installed} · ${copy.remove(name)}` : copy.installed,
      onClick: parts.remove ? () => { parts.remove(part); } : null,
    }),
  },
  { when: () => true, make: ({ parts, part, copy, name }) => ({ state: "idle", variant: "primary", icon: bold(DownloadSimple), label: copy.install(name), onClick: (event) => { parts.install(part, flightFrom(event.currentTarget)); } }) },
];

export function usePartInstall(part, parts, copy, shownName = "") {
  const entry = parts.queue.find((item) => item.id === part.id && item.operation !== "remove");
  const progress = percentOf(useQueueProgress(entry ? entry.queueId : ""), entry);
  const context = { part, parts, copy, entry, percent: progress, name: shownName || copy.partName(part.name, partNamePrefixes(part)) };
  const rule = STATE_RULES.find((one) => one.when(context));
  const { state, ...look } = rule.make(context);
  return { ...look, state, progress };
}

// Кнопка своей карты вместо части: помнит ключ работы, которую уже поставили в очередь.
function useOwnMap(work, parts, copy) {
  const [queuedKey, setQueuedKey] = useState(null);
  if (!work) return null;
  const look = (state, variant, Glyph, label, onClick = null) => ({ state, variant, icon: bold(Glyph), label, onClick });
  if (!work.installed && parts.installed.includes(work.partId)) return look("blocked", "secondary", DownloadSimple, copy.removeMapFirst);
  if (work.installed) return look("installed", "secondary", Check, copy.installed);
  if (queuedKey === work.key) return look("queued", "primary", DownloadSimple, copy.queued, openDownloads);
  return look("idle", "primary", DownloadSimple, copy.install(work.name), () => {
    setQueuedKey(work.key);
    installMapWorks([work]).catch(() => setQueuedKey(null));
  });
}

// Короткое слово на кнопке; tr() зовётся только для слова текущего состояния.
const SHORT_WORD = {
  idle: () => tr("Установить"),
  queued: () => tr("В очереди"),
  running: (percent) => `${tr("Ставится")} ${percent}%`,
  failed: () => tr("Повторить"),
  installed: () => tr("Установлено"),
};

export default function PartActions({ part, parts, copy, editorCopy, versions = null, work = null, view3D = null, editOptions = null, name = "" }) {
  const own = useOwnMap(work, parts, copy);
  const [failure, setFailure] = useState("");
  const [editing, setEditing] = useState(false);
  const standard = usePartInstall(part, parts, copy, name);
  const install = own ?? standard;
  const running = install.state === "running";
  const editor = parts.edit && (modEditor(part) || catalogWorkEditor(part));

  const edit = () => {
    if (editing) return;
    setEditing(true);
    setFailure("");
    new Promise((resolve) => resolve(parts.edit(part, editOptions || undefined)))
      .catch((error) => setFailure(humanFailure(error) || String(error?.message || "")))
      .finally(() => setEditing(false));
  };

  const installProps = {
    variant: install.variant,
    size: "md",
    icon: install.icon,
    ariaLabel: install.label,
    title: install.label,
    "aria-disabled": install.onClick ? undefined : "true",
    "aria-busy": running || install.state === "queued" ? "true" : undefined,
    progress: running ? standard.progress : null,
    onClick: install.onClick ?? undefined,
    className: `mod-part-action is-install is-labelled is-${install.state}`,
  };
  const versionProps = versions && {
    className: "mod-part-versions",
    buttonClassName: "mod-part-action is-versions",
    variant: "secondary",
    size: "md",
    icon: bold(Stack),
    label: versions.count,
    trailing: null,
    ariaLabel: versions.label,
    align: "end",
    value: versions.value,
    options: [{ heading: versions.heading }, ...versions.options],
    onSelect: versions.onSelect,
  };
  const editProps = editor && {
    variant: "secondary",
    size: "md",
    className: failure ? "mod-part-action is-edit is-failed" : "mod-part-action is-edit",
    icon: bold(PencilSimpleLine),
    title: failure || editorCopy[editor.copyKey || editor.kind]?.hint,
    "aria-busy": editing ? "true" : undefined,
    onClick: edit,
  };
  const viewProps = view3D && { variant: "ghost", size: "md", className: "mod-part-action is-view3d", icon: bold(Eye), title: view3D.label, "aria-haspopup": "dialog", onClick: view3D.onOpen };

  return createElement(
    "span",
    { className: "mod-part-actions is-panel" },
    <Button {...installProps}>{SHORT_WORD[install.state]?.(standard.progress) ?? install.label}</Button>,
    /* Часть можно отложить в корзину, пока она не стоит и не ставится (владелец, 16.11.2026: «корзина везде»); своя карта (`work`) — не запись каталога, у неё корзины нет. */
    !work && install.state === "idle" ? <CartButton mod={part} owner={parts.owner} size="md" /> : null,
    versions ? <MenuButton {...versionProps} /> : null,
    editor ? <Button {...editProps}>{tr("Изменить в мастерской")}</Button> : null,
    /* Редукс на новом пути (dlc + слой): состояние и «Выключить / Включить / Освободить место»; у остальных частей молчит. */
    install.state === "installed" && !work ? <ReduxLayerActions modId={part.id} /> : null,
    view3D ? <Button {...viewProps}>{tr("Смотреть в 3D")}</Button> : null,
  );
}
