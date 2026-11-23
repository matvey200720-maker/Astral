import { tr, useTr } from "../../../../locales/ui.js";
import Checkbox from "../../../ui/Checkbox.jsx";
import Button from "../../../ui/Button.jsx";
import { installBlocker } from "./useGunpackInstall.js";
import { Crosshair, Trash, GameController, CheckCircle, DownloadSimple } from "../../../ui/icons.jsx";
import { shotKey } from "./useGunpackStudio.js";
import * as words from "../gun/gun-copy.js";
import { createElement as h, Fragment } from "react";

/** Экран «В игру»: выбор стволов пака, обвесы и главная кнопка установки. */
export default function GunpackInstallPanel({ variant, shots, install }) {
  useTr();
  if (!variant) return emptyShelf();
  const view = survey(variant, shots, install);
  return h("section", { className: "gun-panel gunpack-install" }, ...LAYOUT.map((build) => build(view)));
}

function emptyShelf() {
  return h(
    "section",
    { className: "gun-panel" },
    h("p", { className: "gun-hint" }, tr("Добавьте ганпак — поставить пока нечего.")),
  );
}

// Все обращения к данным вызывающего собраны тут. Порядок чтения решает,
// какая из возможных ошибок выйдет первой, поэтому переставлять строки нельзя.
function survey(variant, shots, install) {
  const { action, installed, installable, models, attachments } = install;
  const { setAttachments, toggle, selectAll, selectNone } = install;
  const { button, removing, remove } = install;

  const hiddenCount = variant.attachments.filter((item) => item.hidden).length;
  const chosen = models.length;
  const choosable = installable.length;
  const rows = variant.weapons.map((weapon) => examine(weapon, variant, shots, models));
  const attachmentTotal = variant.attachments.length;
  const launch = {
    off: Boolean(action.disabled || action.busy),
    caption: action.busy || action.label,
    title: action.title,
    go: action.onClick,
  };
  const queueHint = button.hint;

  return {
    notice: { installed, removing, remove },
    picker: { chosen, choosable, rows, toggle, bulk: { selectAll, selectNone } },
    extras: { attachmentTotal, hiddenCount, attachments, setAttachments },
    launch,
    queueHint,
  };
}

function examine(weapon, variant, shots, models) {
  const reason = installBlocker(weapon);
  const frame = shots[shotKey(variant, weapon.model)];
  return { weapon, reason, frame, ticked: !reason && models.includes(weapon.model) };
}

function titleNode() {
  return h("h2", null, h(GameController), " ", tr("В игру"));
}

function introNode() {
  return h(
    "p",
    { className: "gun-hint" },
    tr(
      "Стволы встают отдельным DLC Astral поверх игры: патчдей, который велит заменить автор, остаётся штатным, а «Снять» возвращает заводские стволы. Ставятся модели и текстуры; weapons.meta (урон, отдача) — нет, за него банят на RP-серверах.",
    ),
  );
}

function installedNode({ notice }) {
  return notice.installed ? h(InstalledNotice, notice) : null;
}

function pickHeadNode({ picker }) {
  const { chosen, choosable, bulk } = picker;
  const counter = words.fill(tr("{n} из {total}"), { n: chosen, total: choosable });
  const buttons = [
    [tr("Все"), chosen === choosable, bulk.selectAll],
    [tr("Ни одного"), chosen === 0, bulk.selectNone],
  ].map(([caption, off, go]) => h(Button, { variant: "ghost", size: "sm", disabled: off, onClick: go }, caption));

  return h(
    "div",
    { className: "gunpack-pick-head" },
    h("h3", null, tr("Стволы"), " ", h("small", null, counter)),
    ...buttons,
  );
}

function pickListNode({ picker }) {
  const { rows, toggle } = picker;
  return h(
    "ul",
    { className: "gunpack-pick" },
    rows.map((row) => pickItem(row, toggle)),
  );
}

function pickItem({ weapon, reason, frame, ticked }, toggle) {
  const { model, name } = weapon;
  const caption = reason || model;
  const thumb = h(
    "span",
    { className: "gunpack-pick-shot", "aria-hidden": "true" },
    frame ? h("img", { alt: "", src: frame.url }) : h(Crosshair),
  );
  const copy = h(
    "span",
    { className: "gunpack-pick-copy" },
    h("b", null, tr(name)),
    h("small", { title: caption }, caption),
  );
  const box = {
    className: reason ? "gunpack-pick-row is-blocked" : "gunpack-pick-row",
    ariaLabel: tr(name),
    checked: ticked,
    disabled: Boolean(reason),
    onChange: () => toggle(model),
  };
  return h("li", { key: model }, h(Checkbox, box, thumb, copy));
}

function attachmentNode({ extras }) {
  const { attachmentTotal, hiddenCount, attachments, setAttachments } = extras;
  if (!attachmentTotal) return null;
  const hint = hiddenCount
    ? words.fill(
        tr(
          "Прицелы, глушители, фонари — как у автора. Скрытые им ({n}) пропадут и в игре — на всех стволах, не только на стволах пака.",
        ),
        { n: hiddenCount },
      )
    : tr(
        "Прицелы, глушители, фонари — как у автора. Общие обвесы сменятся на всех стволах, не только на стволах пака.",
      );
  return h(Checkbox, {
    label: words.fill(tr("Обвесы пака ({n})"), { n: attachmentTotal }),
    hint,
    checked: Boolean(attachments),
    onChange: setAttachments,
  });
}

function launchNode({ launch }) {
  const { off, caption, title, go } = launch;
  const main = h(
    Button,
    { variant: "primary", size: "sm", icon: h(DownloadSimple), disabled: off, title, onClick: go },
    caption,
  );
  return h("div", { className: "gun-row" }, main);
}

function queueNode({ queueHint }) {
  return queueHint ? h("p", { className: "gun-hint" }, queueHint) : null;
}

// Блок «Стоит в игре» подписан на язык сам: он перерисовывается и без панели.
function InstalledNotice({ installed, removing, remove }) {
  useTr();
  const weaponsText = words.count(installed.models?.length ?? 0, words.trKey("ствол|ствола|стволов"));
  const extraText =
    installed.attachmentCount > 0
      ? words.fill(tr(" и {what}"), {
          what: words.count(installed.attachmentCount, words.trKey("обвес|обвеса|обвесов")),
        })
      : null;
  const skippedNote = installed.skipped?.length
    ? h(
        "p",
        { className: "gun-hint" },
        words.fill(tr("Не встали: {list}"), {
          list: installed.skipped.map((entry) => `${entry.name} — ${tr(entry.reason)}`).join("; "),
        }),
      )
    : null;

  const notice = h(
    "div",
    { className: "gunpack-installed", role: "status" },
    h(CheckCircle, { weight: "fill", "aria-hidden": "true" }),
    h("span", null, h("b", null, tr("Стоит в игре")), h("small", null, weaponsText, extraText)),
    h(
      Button,
      { variant: "ghost", size: "sm", icon: h(Trash), disabled: Boolean(removing), onClick: remove },
      removing ? tr("Снимаю…") : tr("Снять"),
    ),
  );
  return h(Fragment, null, notice, skippedNote);
}

// Порядок детей корня: сверху вниз так, как их видит человек.
const LAYOUT = [
  titleNode,
  introNode,
  installedNode,
  pickHeadNode,
  pickListNode,
  attachmentNode,
  launchNode,
  queueNode,
];
