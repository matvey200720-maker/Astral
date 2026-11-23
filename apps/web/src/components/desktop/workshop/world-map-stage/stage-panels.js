// Органы поверх кадра: панель масштаба, «занято», теснота подписей, подсказка, «файл над картой».
import { createElement as h, useLayoutEffect } from "react";
import { MARKER_CATEGORY_MAP } from "@modovik/vector-map";
import { counted } from "../../../../plural.js";
import { tr } from "../../../../locales/ui.js";
import { Warning } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { findObject } from "../world-map-editing.js";
import { tooltipPlace } from "../world-map-frame.js";
import { mapText } from "../world-map/map-copy.js";
import { ZOOM_STEP } from "./numbers.js";

const MINUS = "−";
const HERE = "";

// ——— панель масштаба ———
export function ZoomPanel({ zoom, ctl, gamePreview, onGamePreview }) {
  const plus = h(
    Button,
    {
      className: "is-glass",
      size: "sm",
      "aria-label": tr("Приблизить"),
      title: tr("Приблизить"),
      onClick: () => ctl.zoomBy(ZOOM_STEP),
    },
    "+",
  );
  const minus = h(
    Button,
    {
      className: "is-glass",
      size: "sm",
      "aria-label": tr("Отдалить"),
      title: tr("Отдалить"),
      onClick: () => ctl.zoomBy(1 / ZOOM_STEP),
    },
    MINUS,
  );
  const asGame = onGamePreview
    ? h(
        Button,
        {
          className: gamePreview ? "is-glass wmc-game-view is-on" : "is-glass wmc-game-view",
          size: "sm",
          "aria-pressed": gamePreview ? "true" : "false",
          title: gamePreview
            ? tr(
                "Карта как в игре: все включённые подписи их размером в плитках. Выключите — на общем плане останутся только районы, мелкое появится при приближении",
              )
            : tr(
                "Ярусы для работы: мелкое прячется на общем плане. Включите — карта станет ровно такой, какой уйдёт в игру",
              ),
          onClick: () => onGamePreview(!gamePreview),
        },
        tr("Как в игре"),
      )
    : null;
  const percent = h("output", null, `${Math.round(zoom * 100)}%`);
  return h("div", { className: "wmc-stage-zoom" }, plus, percent, minus, asGame);
}

// ——— «занято» ———
export function busyBadge(busy) {
  // прежний код писал `busy && …`: ложное число 0 попадало в разметку текстом «0»
  if (busy === 0) return 0;
  if (!busy) return null;
  return h(
    "div",
    { className: "wmc-stage-busy", role: "status", "aria-live": "polite" },
    h("i", { "aria-hidden": "true" }),
    typeof busy === "string" ? busy : tr("Перерисовываю карту…"),
  );
}

// ——— теснота подписей ———
export function crowdingWarning(crowding, onFix) {
  if (!crowding?.crowded) return null;
  const forms = [tr("подпись"), tr("подписи"), tr("подписей")];
  const text = mapText("{count} налезут на соседей и не попадут в игру: {examples}…", {
    count: counted(crowding.lost, forms),
    examples: HERE,
  });
  const [before, after = ""] = text.split(HERE);
  const names = crowding.examples.join(", ");
  const action = onFix
    ? h(
        Button,
        { className: "is-glass wmc-stage-warning-action", size: "sm", onClick: onFix },
        tr("Наборы подписей"),
      )
    : null;
  return h(
    "div",
    { className: "wmc-stage-warning", role: "status" },
    h(Warning, { weight: "fill", "aria-hidden": "true" }),
    h("span", null, before, h("span", { lang: "ru", "data-audit-ignore": "caps" }, names), after),
    action,
  );
}

export const dropHint = () =>
  h("div", { className: "wmc-drop", "aria-hidden": "true" }, tr("Отпустите — картинка ляжет сюда"));

// ——— подсказка наведения ———
function tooltipBody(config, hit) {
  const object = findObject(config, hit);
  if (!object) return null;
  if (hit.kind === "zone") {
    const hint = object.hint ? h("small", { key: "s" }, tr(object.hint)) : null;
    return [h("b", { key: "b" }, object.name), hint];
  }
  if (hit.kind === "marker") {
    const title = MARKER_CATEGORY_MAP[object.category]?.title;
    return [h("b", { key: "b" }, object.name), title ? h("small", { key: "s" }, tr(title)) : null];
  }
  if (hit.kind === "stroke") return [h("b", { key: "b" }, object.name)];
  const label = object.kind === "image" ? tr("Картинка") : String(object.text ?? "").replace(/\s+/g, " ");
  return [h("b", { key: "b" }, label)];
}

export function Tooltip({ hover, config, win, tip }) {
  // размер подсказки замеряем при появлении и смене и ставим её в поле окна
  useLayoutEffect(() => {
    const { node } = tip;
    if (!node) return;
    tip.size = { width: node.offsetWidth, height: node.offsetHeight };
    const place = tooltipPlace(hover.left, hover.top, win, tip.size);
    node.style.transform = `translate(${place.x}px, ${place.y}px)`;
  }, [hover, win, tip]);
  const body = tooltipBody(config, hover.hit);
  if (!body) return null;
  return h(
    "div",
    {
      className: "wmc-tooltip",
      ref: (node) => {
        tip.node = node;
      },
      style: { transform: `translate(${hover.left + 14}px, ${hover.top + 12}px)` },
    },
    ...body,
  );
}
