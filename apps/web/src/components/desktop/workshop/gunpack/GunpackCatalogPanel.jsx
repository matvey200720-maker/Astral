import { tr, useTr } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";
import { Storefront, WarningCircle, CheckCircle, Camera, ArrowSquareOut } from "../../../ui/icons.jsx";
import { trKey, plural, fill, count } from "../gun/gun-copy.js";
import { createElement as h } from "react";

const MARK = { weight: "fill", "aria-hidden": "true" };

/** Раздел «В каталог»: что уйдёт во входящие «Публикации» и кнопка отправки. */
export default function GunpackCatalogPanel({ catalog, onShootAll }) {
  useTr();
  const { state, weapons, shot, cover } = catalog;
  const { send, open, canOpen } = catalog;
  const status = state.status;
  const gap = weapons - shot;
  const phase = PHASES.get(status) ?? RESTING;
  const lines = [frameLine(gap, weapons, shot), coverLine(cover), backdropLine()];

  return h(
    "section",
    { className: "gun-panel gunpack-catalog" },
    h("h2", null, h(Storefront), " ", tr("В каталог")),
    h(
      "p",
      { className: "gun-hint" },
      tr(
        "Пак и каждый ствол лягут во входящие «Публикации»: там права, авторы и «Опубликовать». Отсюда в каталог ничего не уходит само.",
      ),
    ),
    h("ul", { className: "gunpack-catalog-checks" }, ...lines.map(checkItem)),
    gap > 0 ? shootButton(status === "working", onShootAll) : null,
    h(
      "div",
      { className: "gun-row" },
      h(
        Button,
        {
          variant: "primary",
          size: "sm",
          icon: h(Storefront),
          disabled: status === "working" || !weapons,
          onClick: send,
        },
        phase.caption(state),
      ),
    ),
    phase.tail ? phase.tail({ state, open, canOpen }) : null,
  );
}

function checkItem([ok, text]) {
  return h("li", { className: ok ? "is-ok" : "is-warn" }, h(ok ? CheckCircle : WarningCircle, MARK), h("span", null, text));
}

// Пара «в порядке ли, текст». Строгое равенство нулю: лишние кадры и NaN дают предупреждение.
function frameLine(gap, weapons, shot) {
  if (gap === 0) {
    return [true, fill(tr("Кадры всех {what}"), { what: count(weapons, trKey("ствола|стволов|стволов")) })];
  }
  return [
    false,
    fill(tr("Кадр есть у {shot} из {total}: остальные лягут заявками «ждёт кадр»"), { shot, total: weapons }),
  ];
}

const coverLine = (cover) =>
  cover
    ? [true, tr("Обложка пака собрана")]
    : [false, tr("Обложки нет — соберётся из кадров стволов")];

function backdropLine() {
  return [true, tr("Карточки и обложка — без подложки, стволы на прозрачном фоне")];
}

function shootButton(locked, onShootAll) {
  return h(
    Button,
    { variant: "secondary", size: "sm", icon: h(Camera), disabled: locked, onClick: onShootAll },
    tr("Доснять стволы"),
  );
}

function sentBlock({ state, open, canOpen }) {
  const { drafts, waiting } = state;
  const pending = waiting ? fill(tr(", ждут кадр: {n}"), { n: waiting }) : null;
  const toInbox = canOpen
    ? h(Button, { variant: "ghost", size: "sm", icon: h(ArrowSquareOut), onClick: open }, tr("Открыть"))
    : null;

  return h(
    "div",
    { className: "gunpack-installed", role: "status" },
    h(CheckCircle, MARK),
    h(
      "span",
      null,
      h("b", null, tr("Во входящих")),
      h("small", null, drafts, " ", plural(drafts, trKey("заявка|заявки|заявок")), pending),
    ),
    toInbox,
  );
}

function failedNote({ state }) {
  return h("p", { className: "gun-hint gunpack-catalog-error", role: "alert" }, state.message);
}

const sendLabel = () => tr("Отправить во входящие");

// Статус отправки → подпись кнопки и то, что рисуется под строкой отправки.
const RESTING = { caption: sendLabel };
const PHASES = new Map([
  ["working", { caption: (state) => state.step }],
  ["sent", { caption: () => tr("Отправить заново"), tail: sentBlock }],
  ["failed", { caption: sendLabel, tail: failedNote }],
]);
