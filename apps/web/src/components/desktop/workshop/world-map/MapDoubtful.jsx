import "./map-doubtful.css";
import { createElement, useMemo, useReducer } from "react";
import { mapText } from "./map-copy.js";
import { PanelSection } from "./MapPanelParts.jsx";
import Button from "../../../ui/Button.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { CheckCircle, MagnifyingGlass } from "../../../ui/icons.jsx";

const h = createElement;

const VISIBLE_LIMIT = 8;
const HINT_KEY =
  "{count} — прочитаны с карты мода неуверенно или кусками. Щелчок — к подписи на карте, текст правится справа";
const ROW_LOOK = { variant: "ghost", size: "sm", block: true, role: "listitem", className: "wmc-doubtful-row" };

// Подписи из packDoubtful в их порядке; карта id -> подпись строится только при смене входов.
function useDoubtfulLabels(config) {
  return useMemo(() => {
    const index = new Map(config.markers.items.map((marker) => [marker.id, marker]));
    const wanted = config.base.packDoubtful || [];
    const resolved = wanted.map((id) => index.get(id));
    return resolved.filter((entry) => entry !== undefined);
  }, [config.base.packDoubtful, config.markers.items]);
}

const flatText = (name) => String(name).replace(/\n/g, " ");

function rowsOf(labels, onFocusObject) {
  return labels.map((marker) => {
    const press = () => onFocusObject && onFocusObject({ kind: "marker", id: marker.id });
    return h(Button, { ...ROW_LOOK, key: marker.id, onClick: press }, flatText(marker.name));
  });
}

function buttonsOf({ total, expanded, onMore, onClear }) {
  const out = [];
  if (total > VISIBLE_LIMIT) {
    const caption = expanded ? tr("Свернуть") : mapText("Показать все {count}", { count: total });
    out.push(h(Button, { key: "more", variant: "ghost", size: "sm", onClick: onMore }, caption));
  }
  out.push(
    h(
      Button,
      {
        key: "done",
        variant: "secondary",
        size: "sm",
        icon: h(CheckCircle, { "aria-hidden": "true" }),
        onClick: onClear,
      },
      tr("Всё проверено"),
    ),
  );
  return out;
}

export default function MapDoubtful({ config, onFocusObject, patchBase }) {
  useTr();
  const labels = useDoubtfulLabels(config);
  const [expanded, flip] = useReducer((open) => !open, false);
  const total = labels.length;
  if (total === 0) return null;

  const visible = expanded ? labels : labels.slice(0, VISIBLE_LIMIT);
  const clear = () => patchBase({ packDoubtful: [] }, tr("Подписи карты мода проверены"), "base.packDoubtful");
  const frame = {
    title: tr("Проверить подписи"),
    icon: h(MagnifyingGlass, { "aria-hidden": "true" }),
    hint: mapText(HINT_KEY, { count: total }),
    className: "wmc-doubtful",
  };
  const list = h("div", { className: "wmc-doubtful-list", role: "list" }, rowsOf(visible, onFocusObject));
  const actions = h(
    "div",
    { className: "wmc-doubtful-actions" },
    buttonsOf({ total, expanded, onMore: flip, onClear: clear }),
  );
  return h(PanelSection, frame, list, actions);
}
