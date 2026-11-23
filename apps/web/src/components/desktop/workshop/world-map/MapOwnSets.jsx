import { createElement, useMemo, useReducer } from "react";
import { mapGroups, cleanOwnName, captureOwnSet } from "@modovik/vector-map";
import { FloppyDisk, Stack, Trash, DotsThree } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import TextField from "../../../ui/TextField.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import MenuButton from "../../../ui/MenuButton.jsx";
import { counted } from "../../../../plural.js";
import { PanelSection } from "./MapPanelParts.jsx";
import { useOwnMapPresets, saveOwnSet } from "./own-store.js";
import { useTr, tr } from "../../../../locales/ui.js";
import { trForms, setTitle, mapText, failureText } from "./map-copy.js";

const h = createElement;

// Слова счёта по разделам; переводятся при отрисовке.
const COUNT_WORDS = new Map([
  ["markers", ["подпись", "подписи", "подписей"]],
  ["zones", ["зона", "зоны", "зон"]],
]);

export function saveOfPage(page) {
  if (typeof page !== "string") return null;
  if (page === "save") return { group: null };
  const at = page.indexOf("save:");
  return at === 0 ? { group: page.slice(5) } : null;
}

// ---- состояние экрана сохранения ----
const dropId = (list, id) => list.filter((entry) => entry !== id);

const MOVES = {
  rename: (state, name) => ({ ...state, name, error: "" }),
  tick: (state, { id, on }) => {
    const rest = dropId(state.picked, id);
    return { ...state, picked: on ? [...rest, id] : rest, error: "" };
  },
  fail: (state, error) => ({ ...state, error }),
};
const move = (state, [kind, payload]) => MOVES[kind](state, payload);

function openingState(groups, from) {
  if (from !== null) {
    const origin = groups.find((entry) => entry.id === from);
    return { name: origin ? setTitle(origin.title) : "", picked: [from], error: "" };
  }
  const picked = [];
  for (const entry of groups) {
    if (entry.visible) picked.push(entry.id);
  }
  return { name: "", picked, error: "" };
}

const NOTICES = {
  updated: "Свой набор «{name}» обновлён",
  created: "Набор «{name}» сохранён — он в «Моих наборах» на любой карте",
};

export function SaveSetPage(props) {
  const { kind, section, config, onDone, onNotice } = props;
  const from = props.from === undefined ? null : props.from;
  useTr();
  const groups = useMemo(() => mapGroups(config, section), [config, section]);
  const [state, send] = useReducer(move, null, () => openingState(groups, from));
  const presets = useOwnMapPresets();

  const clean = cleanOwnName(state.name);
  const lowered = clean.toLowerCase();
  const sameName = (entry) => entry.kind === section && entry.name.toLowerCase() === lowered;
  const twin = clean ? presets.sets.find(sameName) : undefined;
  // Только те отмеченные наборы, что ещё есть в проекте.
  const alive = state.picked.filter((id) => groups.some((entry) => entry.id === id));
  const words = trForms(COUNT_WORDS.get(section) || COUNT_WORDS.get("markers"));
  const ready = clean !== "" && alive.length > 0;

  const commit = () => {
    let record;
    try {
      const target = twin ? { id: twin.id, name: twin.name } : { id: "", name: state.name };
      record = captureOwnSet(config, section, alive, target);
      saveOwnSet(record);
    } catch (failure) {
      send(["fail", failureText(failure.message)]);
      return;
    }
    if (onNotice) onNotice(mapText(NOTICES[twin ? "updated" : "created"], { name: record.name }));
    if (onDone) onDone();
  };

  const submitLabel = () => {
    if (twin) return mapText("Обновить «{name}»", { name: twin.name });
    if (alive.length === 0) return tr("Сохранить");
    let total = 0;
    for (const entry of groups) {
      if (alive.includes(entry.id)) total += entry.count;
    }
    return mapText("Сохранить · {count}", { count: counted(total, words) });
  };

  const hint = twin
    ? mapText("Заменит ваш набор «{name}»", { name: twin.name })
    : tr("Набор будет в «Моих наборах» на любой карте");
  const nameField = h(TextField, {
    label: tr("Название набора"),
    value: state.name,
    onChange: (text) => send(["rename", text]),
    maxLength: 40,
    autoFocus: true,
    placeholder: tr(kind === "labels" ? "Например, «Мои капты»" : "Например, «Наши территории»"),
    error: state.error,
    hint,
    onKeyDown: (event) => event.key === "Enter" && ready && commit(),
  });

  const boxes = groups.map((entry) =>
    h(Checkbox, {
      key: entry.id || "own",
      label: setTitle(entry.title),
      hint: counted(entry.count, words),
      checked: state.picked.includes(entry.id),
      onChange: (on) => send(["tick", { id: entry.id, on }]),
    }),
  );
  const pickProps = { className: "wmc-own-pick", role: "group", "aria-label": tr("Наборы, которые войдут") };
  const pick = h("div", pickProps, boxes);
  const submit = h(
    Button,
    { variant: "primary", size: "sm", block: true, icon: h(FloppyDisk), disabled: !ready, onClick: commit },
    submitLabel(),
  );

  return h(
    "div",
    { className: "wmc-own-save", "data-own-save": kind },
    h(PanelSection, { title: tr("Название"), icon: h(FloppyDisk) }, nameField),
    h(
      PanelSection,
      {
        title: tr("Что войдёт"),
        icon: h(Stack),
        hint: tr("Отметьте наборы с карты — они сохранятся одним набором."),
      },
      pick,
    ),
    h("div", { className: "wmc-own-actions" }, submit),
  );
}

// ---- карточка своего набора ----
const MENU_NAMES = { look: "Мой вид «{title}»: ещё", set: "Мой набор «{title}»: ещё" };

export function OwnCard(props) {
  const { id, title, hint, media, onClick, onDelete } = props;
  const selected = props.selected === undefined ? false : props.selected;
  const kind = props.kind === undefined ? "set" : props.kind;
  useTr();
  const tileClass = selected ? "ui-choice wmc-set-card is-selected" : "ui-choice wmc-set-card";
  const tile = h(
    "button",
    { type: "button", className: tileClass, "aria-pressed": selected, title: hint, onClick },
    h("span", { className: "ui-choice-media wmc-set-media" }, media),
    h("span", { className: "ui-choice-copy" }, h("b", null, title), h("small", null, hint)),
  );
  const removal = { value: "delete", label: tr("Удалить из моих"), icon: h(Trash), danger: true };
  const menu = h(MenuButton, {
    className: "wmc-own-menu",
    ariaLabel: mapText(MENU_NAMES[kind === "look" ? "look" : "set"], { title }),
    variant: "ghost",
    align: "end",
    trailing: null,
    icon: h(DotsThree, { weight: "bold" }),
    options: [removal],
    onSelect: (value) => value === "delete" && onDelete && onDelete(),
  });
  return h("div", { className: "wmc-own-card", "data-own": id }, tile, menu);
}
